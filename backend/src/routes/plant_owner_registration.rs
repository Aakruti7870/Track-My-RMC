//! Five-field public contact intake; never grants a Plant Owner account.
use crate::{auth::control_center::WebAdmin, error::AppError, state::AppState};
use axum::{
    extract::{Path, State},
    http::HeaderMap,
    Json,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RegistrationRequest {
    pub owner_name: String,
    pub business_name: String,
    pub business_address: String,
    pub email: String,
    pub whatsapp_number: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ContactedRequest {
    pub reason: String,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct RegistrationRecord {
    pub id: Uuid,
    pub request_number: String,
    pub owner_name: String,
    pub business_name: String,
    pub business_address: String,
    pub email: String,
    pub whatsapp_number: String,
    pub status: String,
    pub alert_status: String,
    pub created_at: DateTime<Utc>,
}

fn bounded(value: &str, min: usize, max: usize, label: &str) -> Result<String, AppError> {
    let value = value.trim();
    if value.chars().count() < min
        || value.chars().count() > max
        || value.chars().any(char::is_control)
    {
        return Err(AppError::BadRequest(format!(
            "{label} must contain {min}-{max} printable characters"
        )));
    }
    Ok(value.to_owned())
}

// The mobile form accepts multiline addresses. Normalize line breaks to
// printable spaces, while bounded() rejects all other control characters.
fn registered_address(value: &str) -> Result<String, AppError> {
    let normalized = value.replace(['\r', '\n'], " ");
    bounded(&normalized, 5, 500, "Registered business address")
}

fn official_email(value: &str) -> Result<String, AppError> {
    let email = bounded(value, 6, 254, "Email")?.to_ascii_lowercase();
    let Some((local, domain)) = email.split_once('@') else {
        return Err(AppError::BadRequest("Enter a valid official email".into()));
    };
    if local.is_empty()
        || !domain.contains('.')
        || domain.starts_with('.')
        || domain.ends_with('.')
        || email.matches('@').count() != 1
        || email.chars().any(char::is_whitespace)
    {
        return Err(AppError::BadRequest("Enter a valid official email".into()));
    }
    Ok(email)
}

fn indian_whatsapp(value: &str) -> Result<String, AppError> {
    let text = value.trim();
    if text
        .chars()
        .any(|c| !(c.is_ascii_digit() || c == '+' || c == ' ' || c == '-'))
        || text.matches('+').count() > 1
        || (text.contains('+') && !text.starts_with('+'))
    {
        return Err(AppError::BadRequest(
            "Enter a 10-digit WhatsApp number".into(),
        ));
    }
    let digits: String = text.chars().filter(char::is_ascii_digit).collect();
    let formatted = if digits.len() == 10 {
        format!("91{digits}")
    } else {
        digits
    };
    if formatted.len() != 12 || !formatted.starts_with("91") {
        return Err(AppError::BadRequest(
            "Enter a 10-digit Indian WhatsApp number".into(),
        ));
    }
    Ok(formatted)
}

pub async fn submit(
    State(state): State<AppState>,
    Json(body): Json<RegistrationRequest>,
) -> Result<Json<Value>, AppError> {
    let owner_name = bounded(&body.owner_name, 2, 120, "Plant Owner name")?;
    let business_name = bounded(&body.business_name, 2, 160, "Registered business name")?;
    let business_address = registered_address(&body.business_address)?;
    let email = official_email(&body.email)?;
    let whatsapp = indian_whatsapp(&body.whatsapp_number)?;

    // No authorization comes from this public form. An existing account must
    // always use login, never register a parallel identity.
    let registered: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM users
         WHERE LOWER(email)=$1 OR REPLACE(phone,'+','')=$2)",
    )
    .bind(&email)
    .bind(&whatsapp)
    .fetch_one(&state.db)
    .await?;
    if registered {
        return Err(AppError::Conflict(
            "This email or WhatsApp number already has an account. Use Login.".into(),
        ));
    }

    let mut tx = state.db.begin().await?;
    // Public contact forms need a backend-side abuse ceiling in addition
    // to Nginx / edge throttling. Serialize count + insert across API replicas.
    // Operationally configurable; defaults to 60 new leads per hour.
    sqlx::query("SELECT pg_advisory_xact_lock(184, 20261110)")
        .execute(&mut *tx)
        .await?;
    let hourly: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM plant_owner_registration_requests
         WHERE created_at > NOW() - INTERVAL '1 hour'",
    )
    .fetch_one(&mut *tx)
    .await?;
    let limit = std::env::var("PLANT_OWNER_REGISTRATION_HOURLY_LIMIT")
        .ok()
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(60)
        .clamp(1, 1000);
    if hourly >= limit {
        return Err(AppError::RateLimited(
            "Registration is temporarily busy. Please try again later.".into(),
        ));
    }
    let (id, number): (Uuid, String) = sqlx::query_as(
        "INSERT INTO plant_owner_registration_requests
          (owner_name,business_name,business_address,email,whatsapp_number)
         VALUES ($1,$2,$3,$4,$5) RETURNING id,request_number",
    )
    .bind(&owner_name)
    .bind(&business_name)
    .bind(&business_address)
    .bind(&email)
    .bind(&whatsapp)
    .fetch_one(&mut *tx)
    .await
    .map_err(|error| match &error {
        sqlx::Error::Database(db) if db.code().as_deref() == Some("23505") => AppError::Conflict(
            "A registration request for this email or number is already pending.".into(),
        ),
        _ => AppError::from(error),
    })?;

    sqlx::query(
        "INSERT INTO notifications(user_id,title,body,notification_type,reference_id)
         SELECT id,'New Plant Owner registration',$1,'plant_owner_registration',$2
         FROM users WHERE role='central_admin' AND is_active=TRUE",
    )
    .bind(format!(
        "Request {number}: {business_name} ({owner_name}). Review the contact details in the Plant Owner approval workspace."
    ))
    .bind(id.to_string())
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        "INSERT INTO audit_logs(user_id,action,resource_type,resource_id,metadata)
         VALUES(NULL,'plant_owner_registration.submit','plant_owner_registration',$1,$2)",
    )
    .bind(id.to_string())
    .bind(json!({"request_number": number, "status": "PENDING"}))
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    Ok(Json(json!({
        "status": "PENDING",
        "request_id": number,
        "message": "Official email registration request received for Super Admin review.",
        "whatsapp_alert": "QUEUED"
    })))
}

pub async fn list(State(state): State<AppState>, admin: WebAdmin) -> Result<Json<Value>, AppError> {
    admin.require("plant_owners.manage")?;
    let requests = sqlx::query_as::<_, RegistrationRecord>(
        "SELECT id,request_number,owner_name,business_name,business_address,
                email,whatsapp_number,status,alert_status,created_at
         FROM plant_owner_registration_requests
         WHERE status IN ('PENDING','CONTACTED')
         ORDER BY created_at DESC LIMIT 200",
    )
    .fetch_all(&state.db)
    .await?;
    Ok(Json(json!({"success": true, "requests": requests})))
}

pub async fn mark_contacted(
    State(state): State<AppState>,
    admin: WebAdmin,
    Path(request_id): Path<Uuid>,
    headers: HeaderMap,
    Json(body): Json<ContactedRequest>,
) -> Result<Json<Value>, AppError> {
    admin.require("plant_owners.manage")?;
    crate::routes::control_center_routes::require_recent_step_up(&state, &admin, &headers).await?;
    let reason = bounded(&body.reason, 10, 500, "Follow-up reason")?;
    let mut tx = state.db.begin().await?;
    let changed: Option<(String,)> = sqlx::query_as(
        "UPDATE plant_owner_registration_requests SET status='CONTACTED',
                reviewed_by=$2,reviewed_at=NOW(),review_reason=$3,updated_at=NOW()
         WHERE id=$1 AND status='PENDING' RETURNING request_number",
    )
    .bind(request_id)
    .bind(admin.user_id)
    .bind(&reason)
    .fetch_optional(&mut *tx)
    .await?;
    let Some((number,)) = changed else {
        return Err(AppError::Conflict(
            "Only pending registration requests can be marked contacted.".into(),
        ));
    };
    sqlx::query(
        "INSERT INTO audit_logs(user_id,action,resource_type,resource_id,metadata)
         VALUES($1,'plant_owner_registration.contacted','plant_owner_registration',$2,$3)",
    )
    .bind(admin.user_id)
    .bind(request_id.to_string())
    .bind(json!({"request_number": number, "reason": reason}))
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(
        json!({"success":true,"status":"CONTACTED","request_number":number}),
    ))
}

#[cfg(test)]
mod tests {
    use super::{indian_whatsapp, official_email, registered_address};

    #[test]
    fn accepts_multiline_registered_business_address() {
        assert_eq!(
            registered_address("Plot 7\nIndustrial Road\r\nPanvel").unwrap(),
            "Plot 7 Industrial Road  Panvel"
        );
    }

    #[test]
    fn accepts_indian_whatsapp_and_lowercases_emails() {
        assert_eq!(indian_whatsapp("79779 10374").unwrap(), "917977910374");
        assert_eq!(indian_whatsapp("+91 79779 10374").unwrap(), "917977910374");
        assert_eq!(
            official_email(" Owner@Example.COM ").unwrap(),
            "owner@example.com"
        );
    }

    #[test]
    fn rejects_invalid_whatsapp_and_email() {
        assert!(indian_whatsapp("123456").is_err());
        assert!(indian_whatsapp("+44 7700 900123").is_err());
        assert!(indian_whatsapp("abc7977910374").is_err());
        assert!(official_email("owner@invalid").is_err());
    }
}
