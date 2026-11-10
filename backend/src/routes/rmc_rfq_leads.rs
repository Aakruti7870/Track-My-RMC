//! Smart quotation capture. Google-sourced suppliers cannot receive requests until approved.
//! We keep only a Place ID from Google and customer-authored enquiry details.
use crate::auth::control_center::WebAdmin;
use crate::{
    auth::{middleware::check_role, AuthUser},
    error::AppError,
    routes::customer_routes::CustomerRfqPayload,
    state::AppState,
};
use axum::http::HeaderMap;
use axum::{
    extract::{Path, State},
    response::IntoResponse,
    Json,
};
use chrono::{NaiveDate, Utc};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::Row;
use uuid::Uuid;

#[derive(Debug, Deserialize)]
pub struct NewRmcRfq {
    pub request_key: Uuid,
    pub google_place_id: Option<String>,
    pub plant_id: Option<Uuid>,
    pub customer_name: String,
    pub customer_email: Option<String>,
    pub customer_gstin: Option<String>,
    pub grade: String,
    pub quantity_m3: f64,
    pub site_address: String,
    pub site_lat: Option<f64>,
    pub site_lng: Option<f64>,
    pub delivery_date: NaiveDate,
    pub pump_required: bool,
    pub site_contact_phone: String,
    pub share_with_supplier: bool,
}

fn validate(input: &NewRmcRfq) -> Result<(), AppError> {
    if !input.share_with_supplier {
        return Err(AppError::BadRequest(
            "Supplier-sharing permission is required".into(),
        ));
    }
    if input.google_place_id.is_some() == input.plant_id.is_some() {
        return Err(AppError::BadRequest("Choose exactly one supplier".into()));
    }
    if !(2..=160).contains(&input.customer_name.trim().len())
        || !(5..=500).contains(&input.site_address.trim().len())
    {
        return Err(AppError::BadRequest(
            "Enter a valid customer name and site address".into(),
        ));
    }
    if input.customer_email.as_ref().is_some_and(|email| {
        email.len() > 254
            || email.contains(char::is_whitespace)
            || !email.contains('@')
            || !email
                .split('@')
                .nth(1)
                .is_some_and(|domain| domain.contains('.'))
    }) {
        return Err(AppError::BadRequest("Invalid customer email".into()));
    }
    if input
        .customer_gstin
        .as_ref()
        .is_some_and(|gst| gst.len() != 15 || !gst.bytes().all(|c| c.is_ascii_alphanumeric()))
    {
        return Err(AppError::BadRequest(
            "GSTIN must contain 15 alphanumeric characters".into(),
        ));
    }
    let phone: String = input
        .site_contact_phone
        .chars()
        .filter(|c| c.is_ascii_digit())
        .collect();
    if !(10..=15).contains(&phone.len()) || input.site_contact_phone.len() > 20 {
        return Err(AppError::BadRequest(
            "Enter a valid site contact number".into(),
        ));
    }
    let grade = crate::services::customer_order::canonical_grade(&input.grade);
    if ![
        "M10", "M15", "M20", "M25", "M30", "M35", "M40", "M45", "M50", "M55", "M60",
    ]
    .contains(&grade.strip_suffix("PILE").unwrap_or(&grade))
    {
        return Err(AppError::BadRequest("Unsupported concrete grade".into()));
    }
    if !input.quantity_m3.is_finite()
        || input.quantity_m3 <= 0.0
        || input.quantity_m3 > 10000.0
        || ((input.quantity_m3 * 100.0).round() - input.quantity_m3 * 100.0).abs() > 0.00001
    {
        return Err(AppError::BadRequest(
            "Quantity must be 0.01–10000 m3 with at most two decimals".into(),
        ));
    }
    if input.delivery_date < Utc::now().date_naive() {
        return Err(AppError::BadRequest(
            "Delivery date cannot be in the past".into(),
        ));
    }
    if input.site_lat.is_some() != input.site_lng.is_some()
        || input
            .site_lat
            .is_some_and(|v| !v.is_finite() || !(-90.0..=90.0).contains(&v))
        || input
            .site_lng
            .is_some_and(|v| !v.is_finite() || !(-180.0..=180.0).contains(&v))
    {
        return Err(AppError::BadRequest("Invalid site coordinates".into()));
    }
    if let Some(id) = input.google_place_id.as_deref() {
        if id.is_empty() || id.len() > 256 || !id.chars().all(|c| c.is_ascii_graphic()) {
            return Err(AppError::BadRequest("Invalid Google Place ID".into()));
        }
    }
    Ok(())
}

async fn verify_google_place(state: &AppState, place_id: &str) -> Result<(), AppError> {
    let key = state
        .config
        .google_places_api_key
        .as_deref()
        .ok_or_else(|| AppError::InternalError("Google Places is not configured".into()))?;
    let mut url = reqwest::Url::parse("https://places.googleapis.com/v1/places/")
        .map_err(|_| AppError::InternalError("Invalid Google Places endpoint".into()))?;
    url.path_segments_mut()
        .map_err(|_| AppError::InternalError("Invalid Google Places endpoint".into()))?
        .pop_if_empty()
        .push(place_id);
    let response = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|_| AppError::InternalError("Google Places client unavailable".into()))?
        .get(url)
        .header("X-Goog-Api-Key", key)
        .header("X-Goog-FieldMask", "id")
        .send()
        .await
        .map_err(|_| AppError::InternalError("Google Places verification unavailable".into()))?;
    if !response.status().is_success() {
        return Err(AppError::BadRequest(
            "Selected Google business could not be verified".into(),
        ));
    }
    let result: Value = response
        .json()
        .await
        .map_err(|_| AppError::InternalError("Invalid Google Places response".into()))?;
    if result["id"].as_str() != Some(place_id) {
        return Err(AppError::BadRequest("Google Place ID did not match".into()));
    }
    Ok(())
}

pub async fn create(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(payload): Json<NewRmcRfq>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth, &["customer"])?;
    validate(&payload)?;
    // Idempotency: repeat taps return the original lead, never create a second RFQ.
    let previous: Option<(Uuid,String,Option<Uuid>)> = sqlx::query_as(
        "SELECT id,status,canonical_request_id FROM rmc_rfq_leads WHERE customer_id=$1 AND request_key=$2"
    ).bind(auth.user_id).bind(payload.request_key).fetch_optional(&state.db).await?;
    if let Some((id, status, canonical_request_id)) = previous {
        return Ok(Json(
            json!({"id":id,"status":status,"canonical_request_id":canonical_request_id,"idempotent_replay":true}),
        ));
    }
    let recent: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM rmc_rfq_leads WHERE customer_id=$1 AND created_at > NOW() - INTERVAL '1 hour'"
    ).bind(auth.user_id).fetch_one(&state.db).await?;
    if recent >= 10 {
        return Err(AppError::RateLimited(
            "Quotation request limit reached. Please try later".into(),
        ));
    }
    // A held registered Google business must never fall through into a new
    // unregistered-supplier lead or the approved-plant quotation path.
    if let Some(place_id) = payload.google_place_id.as_deref() {
        let held: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM rmc_plants p
             JOIN plant_admin_controls c ON c.plant_id=p.id
             WHERE p.google_place_id=$1 AND NOT c.discovery_visible)
             OR EXISTS(SELECT 1 FROM google_plant_visibility_exclusions x
                       WHERE x.place_id=$1 AND NOT x.is_visible)",
        )
        .bind(place_id)
        .fetch_one(&state.db)
        .await?;
        if held {
            return Err(AppError::Conflict("Selected plant is not available".into()));
        }
    }
    let approved_plant = if let Some(plant_id) = payload.plant_id {
        let exists: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM rmc_plants p WHERE id=$1 AND is_active
                 AND NOT EXISTS(SELECT 1 FROM plant_admin_controls c WHERE c.plant_id=p.id AND NOT c.discovery_visible)
                 AND NOT EXISTS(SELECT 1 FROM google_plant_visibility_exclusions x WHERE x.place_id=p.google_place_id AND NOT x.is_visible)
                 AND EXISTS(SELECT 1 FROM plant_listing_requests r WHERE r.plant_id=p.id AND r.status='APPROVED'))"
        ).bind(plant_id).fetch_one(&state.db).await?;
        if !exists {
            return Err(AppError::Conflict("Selected plant is not approved".into()));
        }
        Some(plant_id)
    } else {
        let place = payload
            .google_place_id
            .as_deref()
            .expect("validated source");
        let linked: Option<Uuid> = sqlx::query_scalar(
            "SELECT p.id FROM rmc_plants p WHERE p.google_place_id=$1 AND p.is_active
                 AND NOT EXISTS(SELECT 1 FROM plant_admin_controls c WHERE c.plant_id=p.id AND NOT c.discovery_visible)
                 AND NOT EXISTS(SELECT 1 FROM google_plant_visibility_exclusions x WHERE x.place_id=p.google_place_id AND NOT x.is_visible)
                 AND EXISTS(SELECT 1 FROM plant_listing_requests r WHERE r.plant_id=p.id AND r.status='APPROVED') LIMIT 1"
        ).bind(place).fetch_optional(&state.db).await?;
        if linked.is_none() {
            verify_google_place(&state, place).await?;
        }
        linked
    };
    if let Some(plant) = approved_plant {
        let rfq_id = crate::services::commercial_service::request(
            &state,
            auth.user_id,
            CustomerRfqPayload {
                plant_id: plant,
                site_id: None,
                site_name: Some("Delivery site".into()),
                site_address: Some(payload.site_address.clone()),
                grade: payload.grade.clone(),
                quantity_m3: Some(payload.quantity_m3),
                quantity: None,
                required_date: Some(payload.delivery_date.to_string()),
                pump_required: Some(payload.pump_required),
                notes: None,
                lead: Some(crate::routes::customer_routes::CustomerRfqLeadDetails {
                    request_key: payload.request_key,
                    google_place_id: payload.google_place_id.clone(),
                    customer_name: payload.customer_name.clone(),
                    customer_email: payload.customer_email.clone(),
                    customer_gstin: payload.customer_gstin.clone(),
                    site_address: payload.site_address.clone(),
                    site_lat: payload.site_lat,
                    site_lng: payload.site_lng,
                    site_contact_phone: payload.site_contact_phone.clone(),
                    share_with_supplier: payload.share_with_supplier,
                }),
            },
        )
        .await?;
        let lead_id: Uuid =
            sqlx::query_scalar("SELECT id FROM rmc_rfq_leads WHERE canonical_request_id=$1")
                .bind(rfq_id)
                .fetch_one(&state.db)
                .await?;
        return Ok(Json(
            json!({"id":lead_id,"canonical_request_id":rfq_id,"status":"REQUESTED","message":"Quotation request submitted to the approved plant"}),
        ));
    }
    let mut tx = state.db.begin().await?;
    let inserted: Option<Uuid> = sqlx::query_scalar(
        "INSERT INTO rmc_rfq_leads(customer_id,request_key,google_place_id,customer_name,customer_email,customer_gstin,grade,quantity_m3,site_address,site_lat,site_lng,delivery_date,pump_required,site_contact_phone,sharing_consent_at,status)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW(),'PENDING_SUPPLIER')
         ON CONFLICT(customer_id,request_key) DO NOTHING RETURNING id"
    )
    .bind(auth.user_id).bind(payload.request_key).bind(payload.google_place_id.as_deref())
    .bind(payload.customer_name.trim()).bind(payload.customer_email.as_deref())
    .bind(payload.customer_gstin.as_deref()).bind(crate::services::customer_order::canonical_grade(&payload.grade))
    .bind(payload.quantity_m3).bind(payload.site_address.trim()).bind(payload.site_lat).bind(payload.site_lng)
    .bind(payload.delivery_date).bind(payload.pump_required).bind(payload.site_contact_phone.trim())
    .fetch_optional(&mut *tx).await?;
    let lead_id = match inserted {
        Some(id) => id,
        None => {
            let existing: (Uuid, String, Option<Uuid>) = sqlx::query_as(
                "SELECT id,status,canonical_request_id FROM rmc_rfq_leads
                 WHERE customer_id=$1 AND request_key=$2",
            )
            .bind(auth.user_id)
            .bind(payload.request_key)
            .fetch_one(&mut *tx)
            .await?;
            return Ok(Json(json!({
                "id":existing.0,"status":existing.1,
                "canonical_request_id":existing.2,"idempotent_replay":true
            })));
        }
    };
    sqlx::query(
        "INSERT INTO notifications(user_id,title,body,notification_type,reference_id)
         SELECT id,'New RMC supplier enquiry',$1,'rmc_rfq_lead',$2 FROM users WHERE role IN ('admin','central_admin') AND is_active"
    ).bind(format!("Enquiry {} needs supplier onboarding and admin follow-up",lead_id))
    .bind(lead_id.to_string()).execute(&mut *tx).await?;
    sqlx::query(
        "INSERT INTO audit_logs(user_id,action,resource_type,resource_id,metadata)
         VALUES($1,'rmc_rfq_lead.create','rmc_rfq_lead',$2,$3)",
    )
    .bind(auth.user_id)
    .bind(lead_id.to_string())
    .bind(json!({"status":"PENDING_SUPPLIER"}))
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(
        json!({"id":lead_id,"status":"PENDING_SUPPLIER","message":"Enquiry saved for TrackMyRMC assistance. Supplier has not been contacted."}),
    ))
}

pub async fn list_customer(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth, &["customer"])?;
    let rows: Vec<Value> = sqlx::query_scalar(
        "SELECT jsonb_build_object(
          'id',id,'status',status,'canonical_request_id',canonical_request_id,
          'grade',grade,'quantity_m3',quantity_m3::DOUBLE PRECISION,
          'site_address',site_address,'delivery_date',delivery_date,
          'pump_required',pump_required,'created_at',created_at,'expires_at',expires_at
         ) FROM rmc_rfq_leads WHERE customer_id=$1 ORDER BY created_at DESC LIMIT 100",
    )
    .bind(auth.user_id)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(json!({"leads":rows})))
}

/// A matched Google supplier receives personal details only after the customer
/// explicitly reconfirms an unexpired enquiry. No auto-forwarding on onboarding.
pub async fn confirm_match(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(lead_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth, &["customer"])?;
    let row = sqlx::query(
        "SELECT * FROM rmc_rfq_leads
         WHERE id=$1 AND customer_id=$2 AND expires_at>NOW()",
    )
    .bind(lead_id)
    .bind(auth.user_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Active enquiry not found".into()))?;
    let status: String = row.get("status");
    if status == "REQUESTED" {
        if let Some(rfq_id) = row.get::<Option<Uuid>, _>("canonical_request_id") {
            return Ok(Json(
                json!({"id":lead_id,"canonical_request_id":rfq_id,"status":"REQUESTED","idempotent_replay":true}),
            ));
        }
    }
    if status != "MATCHED_RECONFIRMATION_REQUIRED" {
        return Err(AppError::Conflict(
            "Enquiry is not ready for reconfirmation".into(),
        ));
    }
    let plant_id = row
        .get::<Option<Uuid>, _>("plant_id")
        .ok_or_else(|| AppError::Conflict("Supplier has not been linked".into()))?;
    let request_key: Uuid = row.get("request_key");
    let site_address: String = row.get("site_address");
    let grade: String = row.get("grade");
    let quantity_m3: f64 = row
        .get::<bigdecimal::BigDecimal, _>("quantity_m3")
        .to_string()
        .parse()
        .map_err(|_| AppError::Conflict("Invalid stored quantity".into()))?;
    let required_date: NaiveDate = row.get("delivery_date");
    let rfq_id = crate::services::commercial_service::request(
        &state,
        auth.user_id,
        CustomerRfqPayload {
            plant_id,
            site_id: None,
            site_name: Some("Delivery site".into()),
            site_address: Some(site_address.clone()),
            grade,
            quantity_m3: Some(quantity_m3),
            quantity: None,
            required_date: Some(required_date.to_string()),
            pump_required: Some(row.get("pump_required")),
            notes: None,
            lead: Some(crate::routes::customer_routes::CustomerRfqLeadDetails {
                request_key,
                google_place_id: row.get("google_place_id"),
                customer_name: row.get("customer_name"),
                customer_email: row.get("customer_email"),
                customer_gstin: row.get("customer_gstin"),
                site_address,
                site_lat: row.get("site_lat"),
                site_lng: row.get("site_lng"),
                site_contact_phone: row.get("site_contact_phone"),
                share_with_supplier: true,
            }),
        },
    )
    .await?;
    Ok(Json(
        json!({"id":lead_id,"canonical_request_id":rfq_id,"status":"REQUESTED"}),
    ))
}

#[derive(Debug, Deserialize)]
pub struct AdminOutreachUpdate {
    pub outreach_status: String,
    pub notes: Option<String>,
}

/// Record manual, permission-based supplier outreach. This never sends a message.
/// Outreach is restricted to unresolved Google-listed plants, with an audit trail.
pub async fn update_admin_outreach(
    State(state): State<AppState>,
    admin: WebAdmin,
    headers: HeaderMap,
    Path(lead_id): Path<Uuid>,
    Json(payload): Json<AdminOutreachUpdate>,
) -> Result<Json<Value>, AppError> {
    admin.require("support.manage")?;
    super::control_center_routes::require_recent_step_up(&state, &admin, &headers).await?;
    record_admin_outreach(&state, admin.user_id, lead_id, payload).await
}

/// Central Authority: an MFA-authenticated web session plus recent authenticator
/// step-up is required before recording supplier outreach.
pub async fn update_control_center_outreach(
    State(state): State<AppState>,
    admin: WebAdmin,
    headers: HeaderMap,
    Path(lead_id): Path<Uuid>,
    Json(payload): Json<AdminOutreachUpdate>,
) -> Result<Json<Value>, AppError> {
    admin.require("support.manage")?;
    super::control_center_routes::require_recent_step_up(&state, &admin, &headers).await?;
    record_admin_outreach(&state, admin.user_id, lead_id, payload).await
}

async fn record_admin_outreach(
    state: &AppState,
    actor: Uuid,
    lead_id: Uuid,
    payload: AdminOutreachUpdate,
) -> Result<Json<Value>, AppError> {
    if !matches!(
        payload.outreach_status.as_str(),
        "NOT_CONTACTED" | "INVITATION_SHARED" | "CONTACTED" | "DECLINED"
    ) {
        return Err(AppError::BadRequest("Invalid outreach status".into()));
    }
    let notes = payload.notes.as_deref().unwrap_or("").trim();
    if notes.len() > 1000 || notes.chars().any(char::is_control) {
        return Err(AppError::BadRequest(
            "Outreach note is too long or invalid".into(),
        ));
    }
    let mut tx = state.db.begin().await?;
    let changed: Option<Uuid> = sqlx::query_scalar(
        "UPDATE rmc_rfq_leads SET outreach_status=$2,
         outreach_notes=$3, outreach_updated_by=$4,
         outreach_updated_at=NOW(),updated_at=NOW()
         WHERE id=$1 AND status='PENDING_SUPPLIER' AND expires_at>NOW()
         RETURNING id",
    )
    .bind(lead_id)
    .bind(&payload.outreach_status)
    .bind(if notes.is_empty() { None } else { Some(notes) })
    .bind(actor)
    .fetch_optional(&mut *tx)
    .await?;
    if changed.is_none() {
        return Err(AppError::Conflict(
            "Only active unregistered-supplier enquiries may be updated".into(),
        ));
    }
    sqlx::query(
        "INSERT INTO audit_logs(user_id,action,resource_type,resource_id,metadata)
         VALUES($1,'rmc_rfq_lead.outreach','rmc_rfq_lead',$2,$3)",
    )
    .bind(actor)
    .bind(lead_id.to_string())
    .bind(json!({"outreach_status":payload.outreach_status}))
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(
        json!({"success":true,"id":lead_id,"outreach_status":payload.outreach_status}),
    ))
}

pub async fn list_admin(
    State(state): State<AppState>,
    admin: WebAdmin,
) -> Result<impl IntoResponse, AppError> {
    admin.require("support.view")?;
    let rows: Vec<Value> = sqlx::query_scalar(
        "SELECT to_jsonb(l) FROM rmc_rfq_leads l ORDER BY created_at DESC LIMIT 200",
    )
    .fetch_all(&state.db)
    .await?;
    Ok(Json(json!({"leads":rows})))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn valid() -> NewRmcRfq {
        NewRmcRfq {
            request_key: Uuid::new_v4(),
            google_place_id: Some("ChIJ_example".into()),
            plant_id: None,
            customer_name: "Customer Example".into(),
            customer_email: None,
            customer_gstin: None,
            grade: "M25".into(),
            quantity_m3: 12.5,
            site_address: "Plot 123, Panvel, Maharashtra".into(),
            site_lat: None,
            site_lng: None,
            delivery_date: Utc::now().date_naive(),
            pump_required: false,
            site_contact_phone: "9876543210".into(),
            share_with_supplier: true,
        }
    }
    #[test]
    fn requires_consent_and_exactly_one_supplier() {
        let mut lead = valid();
        assert!(validate(&lead).is_ok());
        lead.share_with_supplier = false;
        assert!(validate(&lead).is_err());
        lead.share_with_supplier = true;
        lead.plant_id = Some(Uuid::new_v4());
        assert!(validate(&lead).is_err());
    }
    #[test]
    fn rejects_malformed_contact_and_grade_and_quantity() {
        let mut lead = valid();
        lead.site_contact_phone = "123".into();
        assert!(validate(&lead).is_err());
        lead.site_contact_phone = "9876543210".into();
        lead.grade = "M999".into();
        assert!(validate(&lead).is_err());
        lead.grade = "M25".into();
        lead.quantity_m3 = 0.0;
        assert!(validate(&lead).is_err());
    }
}
