//! Compact, server-driven RMC plant profiles. Nothing becomes public on an owner save.
use crate::{
    auth::{control_center::WebAdmin, AuthUser},
    error::AppError,
    state::AppState,
};
use axum::{
    extract::{Path, State},
    http::{header, HeaderMap},
    response::Response,
    Json,
};
use chrono::{NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use sqlx::{PgPool, Postgres, Row, Transaction};
use uuid::Uuid;

const SECTIONS: [(&str, &str); 6] = [
    ("identification", "Plant Identification"),
    ("certifications", "Clearances & Quality Certifications"),
    ("specifications", "Plant Specifications"),
    ("materials", "Raw Material Sources"),
    ("quality", "Mix Designs & Quality"),
    ("fleet", "Fleet Management"),
];
const CERTIFICATES: [&str; 5] = ["cte", "cto", "qci", "bis", "license"];

#[derive(Clone, Copy, Serialize)]
pub struct Field {
    key: &'static str,
    label: &'static str,
    kind: &'static str,
    #[serde(skip_serializing_if = "str::is_empty")]
    depends_on: &'static str,
}
const fn f(key: &'static str, label: &'static str, kind: &'static str) -> Field {
    Field {
        key,
        label,
        kind,
        depends_on: "",
    }
}
const fn dependent(
    key: &'static str,
    label: &'static str,
    kind: &'static str,
    depends_on: &'static str,
) -> Field {
    Field {
        key,
        label,
        kind,
        depends_on,
    }
}
const IDENTIFICATION: &[Field] = &[
    f("registered_name", "Registered Company Name", "text"),
    f("plant_name", "Plant / Facility Name", "text"),
    f("address", "Plant Address", "text"),
    f("latitude", "GPS Latitude", "latitude"),
    f("longitude", "GPS Longitude", "longitude"),
    f("gstin", "GSTIN", "text"),
    f("technical_contact", "Technical Contact Person", "text"),
    f("phone", "Contact Phone", "phone"),
    f("email", "Contact Email", "email"),
];
const CERTIFICATIONS: &[Field] = &[
    f("cte", "Consent to Establish (SPCB)", "yesno"),
    dependent("cte_number", "CTE Certificate Number", "text", "cte"),
    dependent("cte_expiry", "CTE Valid Until", "date", "cte"),
    dependent("cte_document", "CTE Document", "attachment", "cte"),
    f("cto", "Consent to Operate (SPCB)", "yesno"),
    dependent("cto_number", "CTO Certificate Number", "text", "cto"),
    dependent("cto_expiry", "CTO Valid Until", "date", "cto"),
    dependent("cto_document", "CTO Document", "attachment", "cto"),
    f("qci", "QCI RMC Plant Certification (Voluntary)", "yesno"),
    dependent("qci_number", "QCI Certificate Number", "text", "qci"),
    dependent("qci_expiry", "QCI Valid Until", "date", "qci"),
    dependent("qci_document", "QCI Document", "attachment", "qci"),
    f("bis", "BIS IS 4926 Process Certification", "yesno"),
    dependent("bis_number", "BIS License Number", "text", "bis"),
    dependent("bis_expiry", "BIS Valid Until", "date", "bis"),
    dependent("bis_document", "BIS Document", "attachment", "bis"),
    f("license", "Applicable Local / Factory License", "yesno"),
    dependent("license_number", "License Number", "text", "license"),
    dependent("license_expiry", "License Valid Until", "date", "license"),
    dependent(
        "license_document",
        "License Document",
        "attachment",
        "license",
    ),
];
const SPECIFICATIONS: &[Field] = &[
    f("manufacturer", "Batching Plant Make", "text"),
    f("model", "Plant Model", "text"),
    f("capacity", "Rated Capacity (m3/hour)", "number"),
    f(
        "control",
        "Control System",
        "choice:Fully Automatic|PLC / SCADA|Semi-Automatic",
    ),
    f("aggregate_bins", "Aggregate Storage Bins", "integer"),
    f("cement_silos", "Cement Silos", "integer"),
    f("cement_storage", "Cement Storage (MT)", "number"),
    f("scm_silos", "Fly Ash / GGBS Silos", "integer"),
    f("scm_storage", "Fly Ash / GGBS Capacity (MT)", "number"),
    f(
        "calibration",
        "Weighing & Meter Calibration Current",
        "yesno",
    ),
];
const MATERIALS: &[Field] = &[
    f(
        "cement_grade",
        "Cement Grade",
        "choice:OPC 43|OPC 53|PPC|PSC|Other",
    ),
    f("cement_brand", "Cement Brand", "text"),
    f("fly_ash", "Fly Ash Used", "yesno"),
    f("ggbs", "GGBS Used", "yesno"),
    f("coarse_source", "Coarse Aggregate Source / Quarry", "text"),
    f(
        "fine_type",
        "Fine Aggregate Type",
        "choice:M-Sand|River Sand|Blended",
    ),
    f("fine_source", "Fine Aggregate Source", "text"),
    f("admixture", "Chemical Admixture Brand", "text"),
    f(
        "water",
        "Mixing Water Source",
        "choice:Borewell|Municipal|Treated / Recycled|Other",
    ),
    f("mtc", "Latest Material Test Reports Available", "yesno"),
];
const QUALITY: &[Field] = &[
    f(
        "grades",
        "Approved Grades (comma-separated, e.g. M20, M25)",
        "grades",
    ),
    f(
        "mix_design",
        "Approved Mix Design Reports Available",
        "yesno",
    ),
    f(
        "laboratory",
        "In-House Laboratory",
        "choice:Fully Equipped|Partially Equipped|None",
    ),
    f("slump", "Slump Testing Kit", "yesno"),
    f("curing", "Cube Curing Facility", "yesno"),
    f("ctm", "Compression Testing Machine", "yesno"),
    dependent("ctm_capacity", "CTM Capacity (kN)", "number", "ctm"),
    f("batch_slip", "Automated Batching Slip", "yesno"),
    f("external_lab", "External Testing Laboratory", "yesno"),
];
const FLEET: &[Field] = &[
    f("mixers", "Transit Mixer Quantity", "integer"),
    f(
        "drum_capacity",
        "Standard Mixer Drum Capacity (m3)",
        "number",
    ),
    f("gps", "GPS Tracking Enabled", "yesno"),
    f("boom", "Boom Pump Available", "yesno"),
    dependent("boom_reach", "Boom Pump Reach (m)", "number", "boom"),
    f("line_pump", "Line Pump Available", "yesno"),
    f("daily_dispatch", "Maximum Daily Dispatch (m3)", "number"),
    f("batch_times", "Batching / Dispatch Time Records", "yesno"),
    f(
        "water_policy",
        "No Unauthorized Water Addition Policy",
        "yesno",
    ),
];
fn fields(section: &str) -> Option<&'static [Field]> {
    match section {
        "identification" => Some(IDENTIFICATION),
        "certifications" => Some(CERTIFICATIONS),
        "specifications" => Some(SPECIFICATIONS),
        "materials" => Some(MATERIALS),
        "quality" => Some(QUALITY),
        "fleet" => Some(FLEET),
        _ => None,
    }
}
fn checked_fields(section: &str) -> Result<&'static [Field], AppError> {
    fields(section).ok_or_else(|| AppError::BadRequest("Unknown Plant Profile section".into()))
}
fn value_string<'a>(data: &'a Value, key: &str) -> &'a str {
    data.get(key).and_then(Value::as_str).unwrap_or("")
}
fn valid_date(value: &str) -> bool {
    NaiveDate::parse_from_str(value, "%Y-%m-%d").is_ok()
}
fn visible_fields(section: &str, source: &Value) -> Vec<Value> {
    let Some(defs) = fields(section) else {
        return Vec::new();
    };
    defs.iter()
        .filter_map(|field| {
            if !field.depends_on.is_empty() && value_string(source, field.depends_on) != "yes" {
                return None;
            }
            let value = value_string(source, field.key);
            if value.is_empty() || value == "no" || value == "unknown" {
                return None;
            }
            if section == "certifications" && CERTIFICATES.contains(&field.key) {
                let expiry = value_string(source, &format!("{}_expiry", field.key));
                let valid = NaiveDate::parse_from_str(expiry, "%Y-%m-%d")
                    .map(|date| date >= Utc::now().date_naive())
                    .unwrap_or(false);
                let has_evidence = !value_string(source, &format!("{}_document", field.key))
                    .is_empty()
                    && !value_string(source, &format!("{}_number", field.key)).is_empty();
                if !valid || !has_evidence {
                    return None;
                }
            }
            if field.kind == "attachment" {
                // Documents are accessed through a strictly authorization-checked route.
                return None;
            }
            if field.kind == "date" && !valid_date(value) {
                return None;
            }
            Some(json!({"key":field.key,"label":field.label,"value":value,"kind":field.kind}))
        })
        .collect()
}
fn public_documents(plant: Uuid, source: &Value) -> Vec<Value> {
    let today = Utc::now().date_naive();
    CERTIFICATES
        .iter()
        .filter_map(|key| {
            if value_string(source, key) != "yes" {
                return None;
            }
            let expires = NaiveDate::parse_from_str(
                value_string(source, &format!("{key}_expiry")),
                "%Y-%m-%d",
            )
            .ok()?;
            if expires < today {
                return None;
            }
            let number = value_string(source, &format!("{key}_number"));
            let path = value_string(source, &format!("{key}_document"));
            if number.is_empty() || path.is_empty() {
                return None;
            }
            Some(json!({
                "key":key,"title": CERTIFICATIONS.iter().find(|f|f.key==*key)?.label,
                "certificate_number":number,"valid_until":expires.to_string(),
                "download_path":format!("/plant-profile/{plant}/document/{key}")
            }))
        })
        .collect()
}
fn clean_answers(section: &str, answers: Value) -> Result<Value, AppError> {
    let defs = checked_fields(section)?;
    let object = answers
        .as_object()
        .ok_or_else(|| AppError::BadRequest("Answers must be a JSON object".into()))?;
    let mut clean = Map::new();
    for (key, value) in object {
        let field = defs.iter().find(|f| f.key == key).ok_or_else(|| {
            AppError::BadRequest(format!("Unexpected Plant Profile field: {key}"))
        })?;
        let value = value
            .as_str()
            .ok_or_else(|| AppError::BadRequest(format!("Field {key} must be text")))?;
        let value = value.trim();
        if value.len() > 500 || value.chars().any(|c| c.is_control() && c != '\n') {
            return Err(AppError::BadRequest(format!("Invalid field: {key}")));
        }
        let valid = match field.kind {
            "yesno" => value.is_empty() || matches!(value, "yes" | "no" | "unknown"),
            "integer" => {
                value.is_empty() || value.parse::<u32>().map(|v| v <= 100_000).unwrap_or(false)
            }
            "number" => {
                value.is_empty()
                    || value
                        .parse::<f64>()
                        .map(|v| v.is_finite() && (0.0..=1_000_000.0).contains(&v))
                        .unwrap_or(false)
            }
            "latitude" => {
                value.is_empty()
                    || value
                        .parse::<f64>()
                        .map(|v| (-90.0..=90.0).contains(&v))
                        .unwrap_or(false)
            }
            "longitude" => {
                value.is_empty()
                    || value
                        .parse::<f64>()
                        .map(|v| (-180.0..=180.0).contains(&v))
                        .unwrap_or(false)
            }
            "date" => value.is_empty() || valid_date(value),
            "phone" => {
                value.is_empty()
                    || (value.len() <= 20
                        && value
                            .chars()
                            .all(|c| c.is_ascii_digit() || "+- ()".contains(c)))
            }
            "email" => {
                value.is_empty()
                    || (value.len() <= 254 && value.contains('@') && !value.contains(' '))
            }
            "grades" => {
                value.is_empty()
                    || (value.len() <= 150
                        && value.split(',').all(|g| {
                            let g = g.trim();
                            g.starts_with('M')
                                && g[1..]
                                    .parse::<u16>()
                                    .map(|n| (5..=100).contains(&n))
                                    .unwrap_or(false)
                        }))
            }
            "attachment" => {
                value.is_empty()
                    || (value.len() <= 180
                        && value.starts_with("trackmyrmc/plant_cert/")
                        && value.bytes().all(|c| {
                            c.is_ascii_alphanumeric() || matches!(c, b'/' | b'.' | b'-' | b'_')
                        }))
            }
            kind if kind.starts_with("choice:") => {
                value.is_empty()
                    || kind
                        .trim_start_matches("choice:")
                        .split('|')
                        .any(|s| s == value)
            }
            _ => true,
        };
        if !valid {
            return Err(AppError::BadRequest(format!("Invalid value for {key}")));
        }
        if !value.is_empty() {
            clean.insert(key.to_owned(), Value::String(value.to_owned()));
        }
    }
    Ok(Value::Object(clean))
}
async fn editable(
    tx: &mut Transaction<'_, Postgres>,
    user: &AuthUser,
    plant: Uuid,
    section: &str,
) -> Result<(), AppError> {
    checked_fields(section)?;
    let owner: Option<Uuid> = sqlx::query_scalar(
        "SELECT owner_id FROM rmc_plants WHERE id=$1 AND is_active=TRUE FOR SHARE",
    )
    .bind(plant)
    .fetch_optional(&mut **tx)
    .await?;
    if owner.is_none() {
        return Err(AppError::NotFound("Active plant not found".into()));
    }
    if matches!(user.role.as_str(), "owner" | "plant_owner") && owner == Some(user.user_id) {
        return Ok(());
    }
    let staff: Option<String> = sqlx::query_scalar(
        "SELECT ps.role FROM plant_staff ps JOIN users u ON u.id=ps.user_id \
         WHERE ps.plant_id=$1 AND ps.user_id=$2 AND ps.is_active=TRUE \
         AND ps.removed_at IS NULL AND ps.employment_status='ACTIVE' AND u.is_active=TRUE AND u.role=ps.role \
         FOR SHARE OF ps,u")
        .bind(plant).bind(user.user_id).fetch_optional(&mut **tx).await?;
    if staff.as_deref() != Some(user.role.as_str()) {
        return Err(AppError::Forbidden(
            "Active plant staff assignment required".into(),
        ));
    }
    let manager: Option<Uuid> = sqlx::query_scalar(
        "SELECT user_id FROM plant_staff_manager_delegations \
         WHERE plant_id=$1 AND user_id=$2 AND revoked_at IS NULL FOR SHARE",
    )
    .bind(plant)
    .bind(user.user_id)
    .fetch_optional(&mut **tx)
    .await?;
    if manager.is_some() {
        return Ok(());
    }
    let required_module = match (user.role.as_str(), section) {
        ("quality_engineer", "materials" | "quality") => Some("quality_register"),
        ("store_manager", "materials") => Some("material_inventory"),
        ("operator" | "supervisor", "specifications") => Some("production_queue"),
        ("fleet_manager" | "dispatcher", "fleet") => Some("fleet_availability"),
        _ => None,
    }
    .ok_or_else(|| AppError::Forbidden("Role cannot edit this Plant Profile section".into()))?;
    let grant: Option<bool> = sqlx::query_scalar(
        "SELECT can_edit FROM plant_staff_module_permissions \
         WHERE plant_id=$1 AND user_id=$2 AND module_key=$3 AND can_view=TRUE FOR SHARE",
    )
    .bind(plant)
    .bind(user.user_id)
    .bind(required_module)
    .fetch_optional(&mut **tx)
    .await?;
    if grant != Some(true) {
        return Err(AppError::Forbidden(
            "Owner has not granted edit access to this module".into(),
        ));
    }
    Ok(())
}
async fn authorized_sections(
    state: &AppState,
    user: &AuthUser,
    plant: Uuid,
) -> Result<Vec<&'static str>, AppError> {
    let mut keys = Vec::new();
    for (key, _) in SECTIONS {
        let mut tx = state.db.begin().await?;
        if editable(&mut tx, user, plant, key).await.is_ok() {
            keys.push(key);
        }
        tx.rollback().await?;
    }
    Ok(keys)
}
async fn validate_files(db: &PgPool, user: Uuid, answers: &Value) -> Result<(), AppError> {
    for key in CERTIFICATES {
        let path = value_string(answers, &format!("{key}_document"));
        if path.is_empty() {
            continue;
        }
        let ok:bool=sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM stored_files WHERE file_path=$1 \
             AND uploaded_by=$2 AND content_type IN ('application/pdf','image/jpeg','image/png','image/webp'))")
            .bind(path).bind(user).fetch_one(db).await?;
        if !ok {
            return Err(AppError::Forbidden(
                "Certificate must be uploaded by the current account".into(),
            ));
        }
    }
    Ok(())
}
async fn save_tx(
    tx: &mut Transaction<'_, Postgres>,
    plant: Uuid,
    section: &str,
    answers: Value,
    expected_revision: i64,
    editor: Uuid,
) -> Result<Value, AppError> {
    let updated=sqlx::query(
        "INSERT INTO plant_profile_sections(plant_id,section_key,draft_data,draft_revision,status,edited_by) \
         VALUES ($1,$2,$3,1,'draft',$5) \
         ON CONFLICT(plant_id,section_key) DO UPDATE SET draft_data=EXCLUDED.draft_data, \
         draft_revision=plant_profile_sections.draft_revision+1, \
         status='draft', edited_by=$5, updated_at=NOW() \
         WHERE plant_profile_sections.draft_revision=$4 \
         RETURNING draft_revision")
        .bind(plant).bind(section).bind(answers).bind(expected_revision).bind(editor)
        .fetch_optional(&mut **tx).await?;
    let row = updated.ok_or_else(|| {
        AppError::BadRequest("Profile was edited elsewhere. Refresh before saving.".into())
    })?;
    let revision: i64 = row.get("draft_revision");
    sqlx::query(
        "INSERT INTO audit_logs(user_id,action,resource_type,resource_id,metadata) \
         VALUES($1,'plant_profile.draft','plant',$2,$3)",
    )
    .bind(editor)
    .bind(plant)
    .bind(json!({"section":section,"revision":revision}))
    .execute(&mut **tx)
    .await?;
    Ok(json!({"saved":true,"draft_revision":revision,"status":"draft"}))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SaveRequest {
    answers: Value,
    expected_revision: i64,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DecisionRequest {
    approve: bool,
    reason: String,
}
pub async fn schema() -> Json<Value> {
    Json(json!({"sections": SECTIONS.iter().map(|(key,title)|json!({
        "key":key,"title":title,"fields":fields(key).unwrap_or(&[])
    })).collect::<Vec<_>>()}))
}
pub async fn public_profile(
    State(state): State<AppState>,
    Path(plant): Path<Uuid>,
) -> Result<Json<Value>, AppError> {
    let item = sqlx::query("SELECT name FROM rmc_plants WHERE id=$1 AND is_active=TRUE")
        .bind(plant)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("Plant not found".into()))?;
    let rows = sqlx::query(
        "SELECT section_key,published_data,published_at FROM plant_profile_sections \
       WHERE plant_id=$1 AND published_data IS NOT NULL",
    )
    .bind(plant)
    .fetch_all(&state.db)
    .await?;
    let sections: Vec<_> = SECTIONS
        .iter()
        .map(|(key, title)| {
            let source = rows
                .iter()
                .find(|r| r.get::<String, _>("section_key") == *key)
                .map(|r| r.get::<Value, _>("published_data"))
                .unwrap_or_else(|| json!({}));
            let details = visible_fields(key, &source);
            json!({"key":key,"title":title,"details":details,"available":!details.is_empty()})
        })
        .collect();
    let docs = rows
        .iter()
        .find(|r| r.get::<String, _>("section_key") == "certifications")
        .map(|r| public_documents(plant, &r.get::<Value, _>("published_data")))
        .unwrap_or_default();
    Ok(Json(
        json!({"plant_id":plant,"plant_name":item.get::<String,_>("name"),
        "sections":sections,"documents":docs}),
    ))
}
pub async fn editor(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(plant): Path<Uuid>,
) -> Result<Json<Value>, AppError> {
    let allowed = authorized_sections(&state, &auth, plant).await?;
    if allowed.is_empty() {
        return Err(AppError::Forbidden(
            "No editable Plant Profile sections".into(),
        ));
    }
    let rows = sqlx::query(
        "SELECT section_key,draft_data,draft_revision,status,review_note \
       FROM plant_profile_sections WHERE plant_id=$1",
    )
    .bind(plant)
    .fetch_all(&state.db)
    .await?;
    let sections: Vec<_> = SECTIONS
        .iter()
        .filter(|(key, _)| allowed.contains(key))
        .map(|(key, title)| {
            let row = rows
                .iter()
                .find(|r| r.get::<String, _>("section_key") == *key);
            json!({"key":key,"title":title,"fields":fields(key).unwrap_or(&[]),
               "answers":row.map(|r|r.get::<Value,_>("draft_data")).unwrap_or_else(||json!({})),
               "draft_revision":row.map(|r|r.get::<i64,_>("draft_revision")).unwrap_or(0),
               "status":row.map(|r|r.get::<String,_>("status")).unwrap_or_else(||"draft".into()),
               "review_note":row.and_then(|r|r.get::<Option<String>,_>("review_note"))
            })
        })
        .collect();
    Ok(Json(json!({"plant_id":plant,"sections":sections})))
}
pub async fn save(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((plant, section)): Path<(Uuid, String)>,
    Json(request): Json<SaveRequest>,
) -> Result<Json<Value>, AppError> {
    if request.expected_revision < 0 {
        return Err(AppError::BadRequest("Invalid revision".into()));
    }
    let clean = clean_answers(&section, request.answers)?;
    validate_files(&state.db, auth.user_id, &clean).await?;
    let mut tx = state.db.begin().await?;
    editable(&mut tx, &auth, plant, &section).await?;
    let response = save_tx(
        &mut tx,
        plant,
        &section,
        clean,
        request.expected_revision,
        auth.user_id,
    )
    .await?;
    tx.commit().await?;
    Ok(Json(response))
}
pub async fn submit(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((plant, section)): Path<(Uuid, String)>,
) -> Result<Json<Value>, AppError> {
    let mut tx = state.db.begin().await?;
    editable(&mut tx, &auth, plant, &section).await?;
    let row=sqlx::query("UPDATE plant_profile_sections SET submitted_data=draft_data,\
       submitted_revision=draft_revision, submitted_by=$3,submitted_at=NOW(),status='pending_review',\
       review_note=NULL,updated_at=NOW() WHERE plant_id=$1 AND section_key=$2 \
       AND draft_data <> '{}'::jsonb RETURNING draft_revision")
        .bind(plant).bind(&section).bind(auth.user_id)
        .fetch_optional(&mut *tx).await?
        .ok_or_else(||AppError::BadRequest("Save nonempty details before submission".into()))?;
    let revision: i64 = row.get("draft_revision");
    sqlx::query(
        "INSERT INTO audit_logs(user_id,action,resource_type,resource_id,metadata) \
       VALUES($1,'plant_profile.submit','plant',$2,$3)",
    )
    .bind(auth.user_id)
    .bind(plant)
    .bind(json!({"section":section,"revision":revision}))
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(
        json!({"submitted":true,"status":"pending_review","revision":revision}),
    ))
}
pub async fn pending(
    State(state): State<AppState>,
    admin: WebAdmin,
) -> Result<Json<Value>, AppError> {
    admin.require("plant.view")?;
    let rows = sqlx::query(
        "SELECT s.plant_id,s.section_key,s.submitted_data,s.submitted_revision,\
        s.submitted_at,p.name FROM plant_profile_sections s JOIN rmc_plants p ON p.id=s.plant_id \
        WHERE s.status='pending_review' ORDER BY s.submitted_at ASC LIMIT 100",
    )
    .fetch_all(&state.db)
    .await?;
    Ok(Json(json!({"items":rows.iter().map(|r|json!({
        "plant_id":r.get::<Uuid,_>("plant_id"),"plant_name":r.get::<String,_>("name"),
        "section":r.get::<String,_>("section_key"),
        "revision":r.get::<Option<i64>,_>("submitted_revision"),
        "answers":r.get::<Option<Value>,_>("submitted_data"),
        "submitted_at":r.get::<Option<chrono::DateTime<Utc>>,_>("submitted_at")
    })).collect::<Vec<_>>()})))
}
pub async fn decide(
    State(state): State<AppState>,
    admin: WebAdmin,
    Path((plant, section)): Path<(Uuid, String)>,
    headers: HeaderMap,
    Json(request): Json<DecisionRequest>,
) -> Result<Json<Value>, AppError> {
    admin.require("plant_owners.manage")?;
    super::control_center_routes::require_recent_step_up(&state, &admin, &headers).await?;
    checked_fields(&section)?;
    if request.reason.trim().len() > 500 || (!request.approve && request.reason.trim().len() < 10) {
        return Err(AppError::BadRequest(
            "Provide a review reason (10–500 characters) for rejection".into(),
        ));
    }
    let mut tx = state.db.begin().await?;
    let row = sqlx::query(
        "SELECT submitted_data,submitted_revision FROM plant_profile_sections \
        WHERE plant_id=$1 AND section_key=$2 AND status='pending_review' FOR UPDATE",
    )
    .bind(plant)
    .bind(&section)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::BadRequest("No pending section to review".into()))?;
    let submitted: Value = row
        .get::<Option<Value>, _>("submitted_data")
        .ok_or_else(|| AppError::BadRequest("Missing submitted snapshot".into()))?;
    let revision: Option<i64> = row.get("submitted_revision");
    if request.approve && section == "certifications" {
        let today = Utc::now().date_naive();
        for key in CERTIFICATES {
            if value_string(&submitted, key) != "yes" {
                continue;
            }
            let number = value_string(&submitted, &format!("{key}_number"));
            let doc = value_string(&submitted, &format!("{key}_document"));
            let expiry = value_string(&submitted, &format!("{key}_expiry"));
            if number.is_empty() || doc.is_empty() || !valid_date(expiry) {
                return Err(AppError::BadRequest(format!(
                    "Certificate {key}: number, expiry and uploaded evidence required"
                )));
            }
            if NaiveDate::parse_from_str(expiry, "%Y-%m-%d")
                .ok()
                .is_some_and(|d| d < today)
            {
                return Err(AppError::BadRequest(format!(
                    "Certificate {key} has expired"
                )));
            }
        }
    }
    sqlx::query(
        "UPDATE plant_profile_sections SET status=$3,\
        published_data=CASE WHEN $4 THEN submitted_data ELSE published_data END,\
        reviewed_revision=$5,reviewed_by=$6,reviewed_at=NOW(),\
        published_at=CASE WHEN $4 THEN NOW() ELSE published_at END,\
        review_note=$7,updated_at=NOW() WHERE plant_id=$1 AND section_key=$2",
    )
    .bind(plant)
    .bind(&section)
    .bind(if request.approve {
        "published"
    } else {
        "rejected"
    })
    .bind(request.approve)
    .bind(revision)
    .bind(admin.user_id)
    .bind(request.reason.trim())
    .execute(&mut *tx)
    .await?;
    sqlx::query("INSERT INTO audit_logs(user_id,action,resource_type,resource_id,metadata)\
        VALUES($1,'plant_profile.review','plant',$2,$3)")
        .bind(admin.user_id).bind(plant)
        .bind(json!({"section":section,"approved":request.approve,"revision":revision,"reason":request.reason}))
        .execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(json!({"approved":request.approve,"section":section})))
}
async fn certificate_file(
    db: &PgPool,
    plant: Uuid,
    cert: &str,
    pending: bool,
) -> Result<Response, AppError> {
    if !CERTIFICATES.contains(&cert) {
        return Err(AppError::NotFound("Certificate not found".into()));
    }
    let column = if pending {
        "submitted_data"
    } else {
        "published_data"
    };
    let sql=format!("SELECT {column} AS data FROM plant_profile_sections WHERE plant_id=$1 \
       AND section_key='certifications' AND {} AND EXISTS(SELECT 1 FROM rmc_plants p WHERE p.id=$1 AND p.is_active=TRUE)",
       if pending{"status='pending_review'"}else{"published_data IS NOT NULL"});
    let row = sqlx::query(&sql)
        .bind(plant)
        .fetch_optional(db)
        .await?
        .ok_or_else(|| AppError::NotFound("Document not available".into()))?;
    let source: Value = row
        .get::<Option<Value>, _>("data")
        .ok_or_else(|| AppError::NotFound("Document not available".into()))?;
    if value_string(&source, cert) != "yes" {
        return Err(AppError::NotFound("Document not available".into()));
    }
    if !pending {
        let expiry =
            NaiveDate::parse_from_str(value_string(&source, &format!("{cert}_expiry")), "%Y-%m-%d")
                .ok();
        if expiry.is_none_or(|date| date < Utc::now().date_naive()) {
            return Err(AppError::NotFound("Document is expired".into()));
        }
    }
    let path = value_string(&source, &format!("{cert}_document"));
    if path.is_empty() {
        return Err(AppError::NotFound("Document not available".into()));
    }
    let row=sqlx::query("SELECT file_name,content_type,file_data FROM stored_files \
       WHERE file_path=$1 AND content_type IN ('application/pdf','image/jpeg','image/png','image/webp')")
        .bind(path).fetch_optional(db).await?
        .ok_or_else(||AppError::NotFound("Document not found".into()))?;
    let name: String = row.get("file_name");
    let mime: String = row.get("content_type");
    let bytes: Vec<u8> = row
        .get::<Option<Vec<u8>>, _>("file_data")
        .ok_or_else(|| AppError::NotFound("Document unavailable".into()))?;
    Response::builder()
        .header(header::CONTENT_TYPE, mime)
        .header(header::CACHE_CONTROL, "private, no-store")
        .header("X-Content-Type-Options", "nosniff")
        .header(
            header::CONTENT_DISPOSITION,
            format!(
                "attachment; filename=\"{}\"",
                name.replace(['\r', '\n', '"', '\\'], "_")
            ),
        )
        .body(axum::body::Body::from(bytes))
        .map_err(|_| AppError::InternalError("Could not stream certificate".into()))
}
pub async fn public_document(
    State(state): State<AppState>,
    _auth: AuthUser,
    Path((plant, cert)): Path<(Uuid, String)>,
) -> Result<Response, AppError> {
    certificate_file(&state.db, plant, &cert, false).await
}
pub async fn review_document(
    State(state): State<AppState>,
    admin: WebAdmin,
    Path((plant, cert)): Path<(Uuid, String)>,
) -> Result<Response, AppError> {
    admin.require("plant.view")?;
    certificate_file(&state.db, plant, &cert, true).await
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn no_and_unanswered_are_hidden() {
        let sample = json!({"gps":"no","boom":"yes","boom_reach":"35","line_pump":"unknown"});
        let output = visible_fields("fleet", &sample);
        assert_eq!(output.len(), 2);
        assert!(!output.iter().any(|v| v["key"] == "gps"));
    }
    #[test]
    fn malformed_and_unknown_values_rejected() {
        assert!(clean_answers("fleet", json!({"boom":"maybe"})).is_err());
        assert!(clean_answers("fleet", json!({"hidden":"yes"})).is_err());
        assert!(clean_answers("specifications", json!({"capacity":"-12"})).is_err());
        assert!(clean_answers("certifications", json!({"cte_expiry":"2026-55-55"})).is_err());
    }
    #[test]
    fn valid_profile_answers() {
        assert!(clean_answers("fleet", json!({"gps":"yes","mixers":"8"})).is_ok());
        assert!(clean_answers("quality", json!({"grades":"M20,M25,M35"})).is_ok());
    }
}
