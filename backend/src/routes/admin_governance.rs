//! Central Admin plant trust, order intake and consent-only CRM.
//! Every mutation is WebAdmin + permission + recent authenticator step-up.
//! No marketing-send handler or alternate staff invitation path exists here.
use crate::{auth::control_center::WebAdmin, error::AppError, state::AppState};
use axum::{
    extract::{Path, State},
    http::HeaderMap,
    Json,
};
use chrono::{NaiveDate, Utc};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

fn reason(value: &str) -> Result<&str, AppError> {
    let value = value.trim();
    if !(10..=500).contains(&value.chars().count()) || value.chars().any(char::is_control) {
        return Err(AppError::BadRequest(
            "An audit reason of 10 to 500 printable characters is required".into(),
        ));
    }
    Ok(value)
}

fn label(value: &str, max: usize) -> Result<&str, AppError> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > max || value.chars().any(char::is_control) {
        return Err(AppError::BadRequest("Invalid name or label".into()));
    }
    Ok(value)
}

fn valid_certificate(source: &Value, key: &str, until: NaiveDate) -> bool {
    let v = |field: &str| {
        source
            .get(field)
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
    };
    let expiry_field = format!("{key}_expiry");
    let number_field = format!("{key}_number");
    let document_field = format!("{key}_document");
    v(key) == "yes"
        && !v(&number_field).is_empty()
        && !v(&document_field).is_empty()
        && NaiveDate::parse_from_str(v(&expiry_field), "%Y-%m-%d").is_ok_and(|date| date >= until)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PlantDecision {
    pub kind: String,
    pub value: String,
    pub valid_until: Option<NaiveDate>,
    pub reason: String,
}

pub async fn plant_governance(
    State(state): State<AppState>,
    admin: WebAdmin,
    Path(plant): Path<Uuid>,
) -> Result<Json<Value>, AppError> {
    admin.require("plant.view")?;
    let row: Option<Value> = sqlx::query_scalar(
        "SELECT jsonb_build_object(
            'plant_id',p.id,'plant_name',p.name,'active',p.is_active,
            'intake_mode',COALESCE(c.order_intake_mode,'DIRECT'),
            'trust_status',COALESCE(t.status,'NOT_VERIFIED'),
            'trust_until',t.valid_until,
            'trust_current',COALESCE(t.status='VERIFIED' AND t.valid_until>=CURRENT_DATE
                AND p.is_active AND EXISTS(
                    SELECT 1 FROM plant_listing_requests lr WHERE lr.plant_id=p.id AND lr.status='APPROVED'
                ) AND EXISTS(
                    SELECT 1 FROM plant_profile_sections s WHERE s.plant_id=p.id
                      AND s.section_key='identification' AND s.published_data IS NOT NULL
                ) AND EXISTS(
                    SELECT 1 FROM plant_profile_sections s WHERE s.plant_id=p.id
                      AND s.section_key='certifications' AND s.published_data IS NOT NULL
                      AND (
                        (s.published_data->>'cto'='yes'
                         AND (s.published_data->>'cto_expiry')::date >= CURRENT_DATE
                         AND (s.published_data->>'cto_expiry')::date >= t.valid_until)
                        OR
                        (s.published_data->>'license'='yes'
                         AND (s.published_data->>'license_expiry')::date >= CURRENT_DATE
                         AND (s.published_data->>'license_expiry')::date >= t.valid_until)
                      )
                ),FALSE))
         FROM rmc_plants p
         LEFT JOIN plant_admin_controls c ON c.plant_id=p.id
         LEFT JOIN plant_trust_reviews t ON t.plant_id=p.id
         WHERE p.id=$1",
    )
    .bind(plant)
    .fetch_optional(&state.db)
    .await?;
    Ok(Json(row.ok_or_else(|| {
        AppError::NotFound("Plant not found".into())
    })?))
}

pub async fn decide_plant(
    State(state): State<AppState>,
    admin: WebAdmin,
    Path(plant): Path<Uuid>,
    headers: HeaderMap,
    Json(body): Json<PlantDecision>,
) -> Result<Json<Value>, AppError> {
    admin.require("plant.view")?;
    admin.require("plant_owners.manage")?;
    let why = reason(&body.reason)?;
    crate::routes::control_center_routes::require_recent_step_up(&state, &admin, &headers).await?;
    let mut tx = state.db.begin().await?;
    let active: Option<bool> =
        sqlx::query_scalar("SELECT is_active FROM rmc_plants WHERE id=$1 FOR UPDATE")
            .bind(plant)
            .fetch_optional(&mut *tx)
            .await?;
    let active = active.ok_or_else(|| AppError::NotFound("Plant not found".into()))?;
    match body.kind.as_str() {
        "intake" => {
            admin.require("order.view")?;
            if !matches!(
                body.value.as_str(),
                "DIRECT" | "ADMIN_REVIEW" | "RFQ_ONLY" | "DISABLED"
            ) {
                return Err(AppError::BadRequest("Unknown order intake mode".into()));
            }
            if body.value == "DIRECT" && !active {
                return Err(AppError::Conflict(
                    "Inactive plants cannot accept direct orders".into(),
                ));
            }
            sqlx::query("INSERT INTO plant_admin_controls(plant_id,order_intake_mode,changed_by,change_reason)
                VALUES($1,$2,$3,$4) ON CONFLICT(plant_id) DO UPDATE SET
                order_intake_mode=EXCLUDED.order_intake_mode,changed_by=EXCLUDED.changed_by,
                change_reason=EXCLUDED.change_reason,updated_at=NOW()")
                .bind(plant).bind(&body.value).bind(admin.user_id).bind(why)
                .execute(&mut *tx).await?;
        }
        "trust" => {
            if !matches!(body.value.as_str(), "VERIFIED" | "REVOKED") {
                return Err(AppError::BadRequest("Unknown verification decision".into()));
            }
            if body.value == "VERIFIED" {
                if !active {
                    return Err(AppError::Conflict("Plant is inactive".into()));
                }
                let expiry = body.valid_until.ok_or_else(|| {
                    AppError::BadRequest("A verification expiry date is required".into())
                })?;
                if expiry <= Utc::now().date_naive()
                    || expiry > Utc::now().date_naive() + chrono::Duration::days(366)
                {
                    return Err(AppError::BadRequest(
                        "Verification expiry must be within the next 366 days".into(),
                    ));
                }
                let approved: bool = sqlx::query_scalar(
                    "SELECT EXISTS(SELECT 1 FROM plant_listing_requests WHERE plant_id=$1 AND status='APPROVED')",
                ).bind(plant).fetch_one(&mut *tx).await?;
                let identification: bool = sqlx::query_scalar(
                    "SELECT EXISTS(SELECT 1 FROM plant_profile_sections WHERE plant_id=$1
                        AND section_key='identification' AND published_data IS NOT NULL)",
                )
                .bind(plant)
                .fetch_one(&mut *tx)
                .await?;
                let cert: Option<Value> = sqlx::query_scalar(
                    "SELECT published_data FROM plant_profile_sections WHERE plant_id=$1
                     AND section_key='certifications' AND published_data IS NOT NULL",
                )
                .bind(plant)
                .fetch_optional(&mut *tx)
                .await?
                .flatten();
                if !approved
                    || !identification
                    || !cert.as_ref().is_some_and(|source| {
                        valid_certificate(source, "cto", expiry)
                            || valid_certificate(source, "license", expiry)
                    })
                {
                    return Err(AppError::Conflict("TMRMC Verified requires approved onboarding and published current CTO or local licence evidence".into()));
                }
            }
            sqlx::query("INSERT INTO plant_trust_reviews(plant_id,status,valid_until,reviewed_by,review_reason)
                VALUES($1,$2,$3,$4,$5) ON CONFLICT(plant_id) DO UPDATE SET
                status=EXCLUDED.status,valid_until=EXCLUDED.valid_until,
                reviewed_by=EXCLUDED.reviewed_by,review_reason=EXCLUDED.review_reason,reviewed_at=NOW()")
                .bind(plant).bind(&body.value)
                .bind(if body.value == "VERIFIED" {body.valid_until} else {None})
                .bind(admin.user_id).bind(why).execute(&mut *tx).await?;
        }
        _ => {
            return Err(AppError::BadRequest(
                "Unknown plant governance action".into(),
            ))
        }
    }
    sqlx::query(
        "INSERT INTO audit_logs(user_id,action,resource_type,resource_id,metadata)
        VALUES($1,'control_center.plant_governance','plant',$2,$3)",
    )
    .bind(admin.user_id)
    .bind(plant.to_string())
    .bind(json!({"kind":body.kind,"value":body.value,"valid_until":body.valid_until,"reason":why}))
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(
        json!({"success":true,"kind":body.kind,"value":body.value}),
    ))
}

pub async fn marketing_overview(
    State(state): State<AppState>,
    admin: WebAdmin,
) -> Result<Json<Value>, AppError> {
    admin.require("support.manage")?;
    let segments:Vec<Value>=sqlx::query_scalar(
        "SELECT jsonb_build_object('id',s.id,'name',s.name,'members',COUNT(m.contact_id))
         FROM admin_marketing_segments s LEFT JOIN admin_marketing_memberships m ON s.id=m.segment_id
         GROUP BY s.id ORDER BY s.name LIMIT 100"
    ).fetch_all(&state.db).await?;
    let totals: Value = sqlx::query_scalar(
        "SELECT jsonb_build_object('all',COUNT(*),
          'opted_in',COUNT(*) FILTER (WHERE consent_status='OPTED_IN'),
          'unverified',COUNT(*) FILTER (WHERE consent_status='UNVERIFIED'),
          'opted_out',COUNT(*) FILTER (WHERE consent_status='OPTED_OUT'))
          FROM admin_marketing_contacts",
    )
    .fetch_one(&state.db)
    .await?;
    let campaigns: Vec<Value> = sqlx::query_scalar(
        "SELECT jsonb_build_object('id',c.id,'name',c.name,'segment',s.name,
         'template',c.whatsapp_template,'status',c.status)
         FROM admin_marketing_campaign_drafts c JOIN admin_marketing_segments s ON s.id=c.segment_id
         ORDER BY c.created_at DESC LIMIT 40",
    )
    .fetch_all(&state.db)
    .await?;
    Ok(Json(
        json!({"segments":segments,"contacts":totals,"campaigns":campaigns,
        "send_enabled":false,"contact_import_requires_independent_opt_in":true}),
    ))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SegmentInput {
    name: String,
    reason: String,
}
pub async fn create_segment(
    State(state): State<AppState>,
    admin: WebAdmin,
    headers: HeaderMap,
    Json(body): Json<SegmentInput>,
) -> Result<Json<Value>, AppError> {
    admin.require("support.manage")?;
    let why = reason(&body.reason)?;
    let name = label(&body.name, 100)?;
    if name.chars().count() < 3 {
        return Err(AppError::BadRequest(
            "Group name must be 3+ characters".into(),
        ));
    }
    crate::routes::control_center_routes::require_recent_step_up(&state, &admin, &headers).await?;
    let mut tx = state.db.begin().await?;
    let id: Uuid = sqlx::query_scalar(
        "INSERT INTO admin_marketing_segments(name,created_by) VALUES($1,$2) RETURNING id",
    )
    .bind(name)
    .bind(admin.user_id)
    .fetch_one(&mut *tx)
    .await?;
    sqlx::query(
        "INSERT INTO audit_logs(user_id,action,resource_type,resource_id,metadata)
       VALUES($1,'marketing.segment.create','marketing_segment',$2,$3)",
    )
    .bind(admin.user_id)
    .bind(id.to_string())
    .bind(json!({"name":name,"reason":why}))
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(json!({"id":id,"name":name,"success":true})))
}

fn normalize_phone(raw: &str) -> Result<String, AppError> {
    let text = raw.trim();
    if text.is_empty()
        || !text
            .chars()
            .all(|c| c.is_ascii_digit() || matches!(c, '+' | ' ' | '-' | '(' | ')'))
    {
        return Err(AppError::BadRequest("Invalid phone number format".into()));
    }
    let digits: String = text.chars().filter(char::is_ascii_digit).collect();
    let normalized = if digits.len() == 10 {
        format!("+91{digits}")
    } else {
        format!("+{digits}")
    };
    if digits.len() < 8
        || digits.len() > 15
        || digits.starts_with('0')
        || (!text.starts_with('+') && digits.len() != 10)
    {
        return Err(AppError::BadRequest(
            "Contact phone must be an E.164 number (+country) or Indian ten-digit mobile".into(),
        ));
    }
    Ok(normalized)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ImportedContact {
    phone: String,
    name: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ImportContacts {
    segment_id: Uuid,
    contacts: Vec<ImportedContact>,
    reason: String,
}

pub async fn import_contacts(
    State(state): State<AppState>,
    admin: WebAdmin,
    headers: HeaderMap,
    Json(body): Json<ImportContacts>,
) -> Result<Json<Value>, AppError> {
    admin.require("support.manage")?;
    let why = reason(&body.reason)?;
    if body.contacts.is_empty() || body.contacts.len() > 100 {
        return Err(AppError::BadRequest(
            "Import one to 100 contacts per request".into(),
        ));
    }
    // Validate all lines before touching persistent data.
    let mut clean = Vec::new();
    for c in &body.contacts {
        let phone = normalize_phone(&c.phone)?;
        let name = if c.name.trim().is_empty() {
            String::new()
        } else {
            label(&c.name, 120)?.to_owned()
        };
        clean.push((phone, name));
    }
    crate::routes::control_center_routes::require_recent_step_up(&state, &admin, &headers).await?;
    let mut tx = state.db.begin().await?;
    let exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM admin_marketing_segments WHERE id=$1)")
            .bind(body.segment_id)
            .fetch_one(&mut *tx)
            .await?;
    if !exists {
        return Err(AppError::NotFound("Contact group not found".into()));
    }
    for (phone, name) in &clean {
        // Import never grants opt-in and never reverses an opt-out.
        let id:Uuid=sqlx::query_scalar(
            "INSERT INTO admin_marketing_contacts(phone_e164,display_name,last_changed_by)
             VALUES($1,$2,$3) ON CONFLICT(phone_e164) DO UPDATE SET
             display_name=CASE WHEN EXCLUDED.display_name='' THEN admin_marketing_contacts.display_name
               ELSE EXCLUDED.display_name END,
             updated_at=NOW() RETURNING id"
        ).bind(phone).bind(name).bind(admin.user_id).fetch_one(&mut *tx).await?;
        sqlx::query(
            "INSERT INTO admin_marketing_memberships(segment_id,contact_id)
            VALUES($1,$2) ON CONFLICT DO NOTHING",
        )
        .bind(body.segment_id)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    }
    sqlx::query(
        "INSERT INTO audit_logs(user_id,action,resource_type,resource_id,metadata)
      VALUES($1,'marketing.contacts.import','marketing_segment',$2,$3)",
    )
    .bind(admin.user_id)
    .bind(body.segment_id.to_string())
    .bind(json!({"count":clean.len(),"reason":why,"opt_in_granted":false}))
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(
        json!({"success":true,"processed":clean.len(),"consent_status":"UNVERIFIED",
      "message":"Contacts imported for internal organization only. Import does not grant marketing consent."}),
    ))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CampaignDraft {
    segment_id: Uuid,
    name: String,
    template: String,
    reason: String,
}
pub async fn create_campaign_draft(
    State(state): State<AppState>,
    admin: WebAdmin,
    headers: HeaderMap,
    Json(body): Json<CampaignDraft>,
) -> Result<Json<Value>, AppError> {
    admin.require("support.manage")?;
    let why = reason(&body.reason)?;
    let name = label(&body.name, 120)?;
    let template = label(&body.template, 120)?;
    if !template
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
    {
        return Err(AppError::BadRequest(
            "Use the official template identifier (lowercase and underscores)".into(),
        ));
    }
    crate::routes::control_center_routes::require_recent_step_up(&state, &admin, &headers).await?;
    let mut tx = state.db.begin().await?;
    let id: Uuid = sqlx::query_scalar(
        "INSERT INTO admin_marketing_campaign_drafts(segment_id,name,whatsapp_template,created_by)
         VALUES($1,$2,$3,$4) RETURNING id",
    )
    .bind(body.segment_id)
    .bind(name)
    .bind(template)
    .bind(admin.user_id)
    .fetch_one(&mut *tx)
    .await?;
    sqlx::query(
        "INSERT INTO audit_logs(user_id,action,resource_type,resource_id,metadata)
       VALUES($1,'marketing.campaign.draft','marketing_campaign',$2,$3)",
    )
    .bind(admin.user_id)
    .bind(id.to_string())
    .bind(
        json!({"segment_id":body.segment_id,"template":template,"reason":why,"send_enabled":false}),
    )
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(json!({"id":id,"status":"DRAFT","send_enabled":false})))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn contact_normalization_is_bounded_and_requires_country() {
        assert_eq!(normalize_phone("9876543210").unwrap(), "+919876543210");
        assert_eq!(normalize_phone("+919876543210").unwrap(), "+919876543210");
        assert!(normalize_phone("123").is_err());
        assert!(normalize_phone("9876543210;attack").is_err());
        assert!(normalize_phone("00919876543210").is_err());
    }
    #[test]
    fn invalid_verification_evidence_does_not_pass() {
        let source = json!({"cto":"yes","cto_number":"CTO/1","cto_expiry":"2020-01-01",
            "cto_document":"trackmyrmc/plant_cert/example.pdf"});
        assert!(!valid_certificate(&source, "cto", Utc::now().date_naive()));
    }
}
