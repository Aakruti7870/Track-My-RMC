use crate::{
    auth::control_center::WebAdmin, auth::otp::OtpEngine, auth::AuthUser, error::AppError,
    repositories::user_repo, services::whatsapp_service::WhatsAppService, state::AppState,
};
use axum::{
    extract::{Path, State},
    http::HeaderMap,
    response::IntoResponse,
    Json,
};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use uuid::Uuid;

const DELETION_OTP_PURPOSE: &str = "account_deletion";
const DELETE_CONFIRMATION: &str = "DELETE";

#[derive(Debug, Deserialize)]
pub struct PublicDeletionOtpRequest {
    pub identifier: String,
}

#[derive(Debug, Deserialize)]
pub struct DeletionRequestBody {
    pub confirm: String,
    pub code: String,
    pub reason: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct PublicDeletionRequestBody {
    pub identifier: String,
    pub code: String,
    pub confirm: String,
    pub reason: Option<String>,
}

type DeletionRow = (
    Uuid,
    String,
    Option<String>,
    DateTime<Utc>,
    Option<DateTime<Utc>>,
);

fn normalize_identifier(raw: &str) -> Result<(String, &'static str), AppError> {
    let value = raw.trim();
    if value.is_empty() || value.len() > 254 {
        return Err(AppError::BadRequest(
            "Enter a valid registered mobile number or email".to_string(),
        ));
    }

    if value.contains('@') {
        let email = value.to_ascii_lowercase();
        let Some((local, domain)) = email.split_once('@') else {
            return Err(AppError::BadRequest(
                "Enter a valid registered mobile number or email".to_string(),
            ));
        };
        if local.is_empty()
            || domain.is_empty()
            || !domain.contains('.')
            || email.chars().any(char::is_whitespace)
            || email.matches('@').count() != 1
        {
            return Err(AppError::BadRequest(
                "Enter a valid registered mobile number or email".to_string(),
            ));
        }
        return Ok((email, "email"));
    }

    if !value
        .chars()
        .all(|c| c.is_ascii_digit() || matches!(c, '+' | ' ' | '-' | '(' | ')'))
    {
        return Err(AppError::BadRequest(
            "Enter a valid registered mobile number or email".to_string(),
        ));
    }
    let phone = WhatsAppService::normalize_phone(value);
    if !(10..=15).contains(&phone.len()) || !phone.bytes().all(|b| b.is_ascii_digit()) {
        return Err(AppError::BadRequest(
            "Enter a valid registered mobile number or email".to_string(),
        ));
    }
    Ok((phone, "whatsapp"))
}

fn normalized_reason(reason: Option<String>) -> Result<Option<String>, AppError> {
    let reason = reason
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    if reason.as_ref().is_some_and(|value| value.len() > 1000) {
        return Err(AppError::BadRequest(
            "Reason must be 1000 characters or fewer".to_string(),
        ));
    }
    Ok(reason)
}

fn identifier_digest(identifier: &str) -> String {
    hex::encode(Sha256::digest(identifier.as_bytes()))
}

fn public_otp_response(channel: &str) -> Json<Value> {
    Json(json!({
        "success": true,
        "channel": channel,
        "message": "If an active account matches the supplied identifier, a verification code will be sent."
    }))
}

fn request_json(row: DeletionRow) -> Value {
    json!({
        "id": row.0,
        "status": row.1,
        "reason": row.2,
        "created_at": row.3,
        "completed_at": row.4
    })
}

async fn record_request(
    pool: &PgPool,
    user_id: Uuid,
    identifier: &str,
    reason: Option<String>,
    requested_via: &'static str,
) -> Result<DeletionRow, AppError> {
    let mut tx = pool.begin().await?;
    let row: DeletionRow = sqlx::query_as(
        "INSERT INTO account_deletion_requests (user_id, identifier_hash, reason, requested_via)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id) WHERE status = 'PENDING' AND user_id IS NOT NULL
         DO UPDATE SET reason = COALESCE(EXCLUDED.reason, account_deletion_requests.reason),
                       updated_at = NOW()
         RETURNING id, status, reason, created_at, completed_at",
    )
    .bind(user_id)
    .bind(identifier_digest(identifier))
    .bind(reason)
    .bind(requested_via)
    .fetch_one(&mut *tx)
    .await?;

    sqlx::query(
        "INSERT INTO audit_logs (user_id, action, resource_type, resource_id, metadata)
         VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(user_id)
    .bind("account_deletion.requested")
    .bind("account_deletion_request")
    .bind(row.0.to_string())
    .bind(json!({ "requested_via": requested_via }))
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(row)
}

// Reuse the same deletion-purpose OTP creation and delivery in both flows.
async fn send_deletion_otp(
    state: &AppState,
    destination: &str,
    channel: &str,
) -> Result<(), AppError> {
    state.otp_delivery.validate(channel)?;
    let (otp, salt, hashed_otp) = OtpEngine::generate_secure_otp(&state.config.otp_pepper);
    let session_id = OtpEngine::create_pending_session(
        &state.db,
        crate::auth::otp::OtpSessionInput {
            destination,
            channel,
            purpose: DELETION_OTP_PURPOSE,
            salt: &salt,
            hashed_otp: &hashed_otp,
            expiration_minutes: state.config.otp_expiration_minutes,
            max_attempts: state.config.otp_max_verification_attempts,
        },
    )
    .await?;

    let delivery = state
        .otp_delivery
        .send(channel, destination, &otp, "Account Deletion")
        .await;

    if let Err(error) = delivery {
        let _ = OtpEngine::discard_pending_session(&state.db, session_id).await;
        return Err(error);
    }

    OtpEngine::activate_pending_session(
        &state.db,
        session_id,
        destination,
        channel,
        DELETION_OTP_PURPOSE,
    )
    .await?;

    Ok(())
}

pub async fn send_signed_in_otp(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<impl IntoResponse, AppError> {
    let user = user_repo::find_by_id(&state.db, auth_user.user_id)
        .await?
        .filter(|user| user.is_active)
        .ok_or_else(|| AppError::Unauthorized("Account unavailable".into()))?;
    let identifier = deletion_identifier(&user.role, &user.phone, user.email.as_deref())?;
    let (destination, channel) = normalize_identifier(&identifier)?;
    // The signed-in flow reports cooldown errors instead of claiming a code was sent.
    OtpEngine::check_rate_limit(&state.db, &destination, state.config.otp_cooldown_seconds).await?;
    send_deletion_otp(&state, &destination, channel).await?;
    Ok(Json(json!({"success":true,"channel":channel})))
}

pub async fn send_public_otp(
    State(state): State<AppState>,
    Json(payload): Json<PublicDeletionOtpRequest>,
) -> Result<impl IntoResponse, AppError> {
    let (destination, channel) = normalize_identifier(&payload.identifier)?;
    let user = user_repo::find_by_phone_or_email(&state.db, &destination).await?;
    let Some(user) = user.filter(|user| user.is_active) else {
        return Ok(public_otp_response(channel));
    };

    let identifier_matches = if channel == "email" {
        user.email
            .as_deref()
            .is_some_and(|email| email.eq_ignore_ascii_case(&destination))
    } else {
        user.phone == destination || WhatsAppService::normalize_phone(&user.phone) == destination
    };
    if !identifier_matches {
        return Ok(public_otp_response(channel));
    }

    // Customer/driver phone verification uses WhatsApp. Staff and owners must
    // use their registered email, preserving the existing authentication split.
    if channel == "whatsapp" && !matches!(user.role.as_str(), "customer" | "driver") {
        return Ok(public_otp_response(channel));
    }

    match OtpEngine::check_rate_limit(&state.db, &destination, state.config.otp_cooldown_seconds)
        .await
    {
        Ok(()) => {}
        Err(AppError::BadRequest(_) | AppError::Forbidden(_)) => {
            // Keep the public response non-enumerating and avoid exposing rate-limit internals.
            return Ok(public_otp_response(channel));
        }
        Err(error) => return Err(error),
    }

    send_deletion_otp(&state, &destination, channel).await?;

    Ok(public_otp_response(channel))
}

pub async fn submit_public_request(
    State(state): State<AppState>,
    Json(payload): Json<PublicDeletionRequestBody>,
) -> Result<impl IntoResponse, AppError> {
    if payload.confirm.trim() != DELETE_CONFIRMATION {
        return Err(AppError::BadRequest(
            "Type DELETE to confirm the request".to_string(),
        ));
    }
    let reason = normalized_reason(payload.reason)?;
    let (destination, channel) = normalize_identifier(&payload.identifier)?;

    // The OTP is bound to the exact normalized identifier, channel, and deletion purpose.
    OtpEngine::verify_otp(
        &state,
        &destination,
        channel,
        DELETION_OTP_PURPOSE,
        &payload.code,
    )
    .await?;
    let user = user_repo::find_by_phone_or_email(&state.db, &destination)
        .await?
        .filter(|user| user.is_active)
        .ok_or_else(|| {
            AppError::Unauthorized("Invalid or expired verification code".to_string())
        })?;

    let identifier_matches = if channel == "email" {
        user.email
            .as_deref()
            .is_some_and(|email| email.eq_ignore_ascii_case(&destination))
    } else {
        user.phone == destination || WhatsAppService::normalize_phone(&user.phone) == destination
    };
    if !identifier_matches
        || (channel == "whatsapp" && !matches!(user.role.as_str(), "customer" | "driver"))
    {
        return Err(AppError::Unauthorized(
            "Invalid or expired verification code".to_string(),
        ));
    }

    let row = record_request(&state.db, user.id, &destination, reason, "public_verified").await?;
    Ok(Json(
        json!({ "success": true, "request": request_json(row) }),
    ))
}

pub async fn status(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<impl IntoResponse, AppError> {
    let row: Option<DeletionRow> = sqlx::query_as(
        "SELECT id, status, reason, created_at, completed_at
         FROM account_deletion_requests
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT 1",
    )
    .bind(auth_user.user_id)
    .fetch_optional(&state.db)
    .await?;

    Ok(Json(json!({
        "success": true,
        "request": row.map(request_json)
    })))
}

pub async fn submit_signed_in_request(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Json(payload): Json<DeletionRequestBody>,
) -> Result<impl IntoResponse, AppError> {
    if payload.confirm.trim() != DELETE_CONFIRMATION {
        return Err(AppError::BadRequest(
            "Type DELETE to confirm the request".to_string(),
        ));
    }
    let reason = normalized_reason(payload.reason)?;
    // Bind fresh deletion-purpose verification to the current database identity,
    // never to an identifier supplied by the caller or a stale token claim.
    let user = user_repo::find_by_id(&state.db, auth_user.user_id)
        .await?
        .filter(|user| user.is_active)
        .ok_or_else(|| AppError::Unauthorized("Account unavailable".into()))?;
    let identifier = deletion_identifier(&user.role, &user.phone, user.email.as_deref())?;
    let (destination, channel) = normalize_identifier(&identifier)?;
    OtpEngine::verify_otp(
        &state,
        &destination,
        channel,
        DELETION_OTP_PURPOSE,
        &payload.code,
    )
    .await?;
    let row = record_request(
        &state.db,
        auth_user.user_id,
        &destination,
        reason,
        "signed_in",
    )
    .await?;
    Ok(Json(
        json!({ "success": true, "request": request_json(row) }),
    ))
}

/// Only the dedicated Central Admin may execute this irreversible operation.
/// The permission is intentionally *not* assigned by default; operators must
/// authorize the privacy workflow separately after a verified restore rehearsal.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FulfillDeletionBody {
    pub confirm: String,
}

pub async fn fulfill_verified_request(
    State(state): State<AppState>,
    admin: WebAdmin,
    headers: HeaderMap,
    Path(request_id): Path<Uuid>,
    Json(payload): Json<FulfillDeletionBody>,
) -> Result<impl IntoResponse, AppError> {
    admin.require("account.delete")?;
    crate::routes::control_center_routes::require_recent_step_up(&state, &admin.user, &headers)
        .await?;
    if payload.confirm != "DELETE_ACCOUNT" {
        return Err(AppError::BadRequest(
            "Type DELETE_ACCOUNT to confirm permanent erasure".into(),
        ));
    }
    fulfill_eligible_verified_request(&state.db, request_id, admin.user_id).await?;
    Ok(Json(
        json!({"success":true,"status":"COMPLETED","request_id":request_id}),
    ))
}

/// Purges a strictly limited, verified, low-risk account in a single transaction.
/// Financial, personnel, KYC, trip and uploaded-file records are never silently
/// removed: those cases require an independently reviewed erasure/retention plan.
/// This helper is testable on isolated databases without granting an API admin role.
pub async fn fulfill_eligible_verified_request(
    db: &PgPool,
    request_id: Uuid,
    actor_id: Uuid,
) -> Result<(), AppError> {
    let mut tx = db.begin().await?;
    let identity: Option<(Uuid, String, String, Option<String>)> = sqlx::query_as(
        "SELECT u.id, u.role, u.phone, u.email
         FROM account_deletion_requests r JOIN users u ON u.id=r.user_id
         WHERE r.id=$1 AND r.status='PENDING'
         FOR UPDATE OF r,u",
    )
    .bind(request_id)
    .fetch_optional(&mut *tx)
    .await?;
    let (user_id, role, phone, email) = identity.ok_or_else(|| {
        AppError::NotFound("No pending, verified account deletion request".into())
    })?;
    if !matches!(role.as_str(), "customer" | "driver") || user_id == actor_id {
        return Err(AppError::Forbidden(
            "Privileged, staff and plant-owner identities require a separate legal handover".into(),
        ));
    }

    // Any retained operational or third-party document must be reviewed before
    // completion. Do not infer that CASCADE automatically erases S3/vendor data.
    let retain: bool = sqlx::query_scalar(
        "SELECT
            EXISTS(SELECT 1 FROM rmc_plants WHERE owner_id=$1)
            OR EXISTS(SELECT 1 FROM orders WHERE customer_id=$1)
            OR EXISTS(SELECT 1 FROM order_loads WHERE driver_id=$1)
            OR EXISTS(SELECT 1 FROM transit_mixers WHERE driver_id=$1)
            OR EXISTS(SELECT 1 FROM gps_telemetry WHERE driver_id=$1)
            OR EXISTS(SELECT 1 FROM stored_files WHERE uploaded_by=$1)
            OR EXISTS(SELECT 1 FROM customer_digilocker_sessions WHERE user_id=$1)
            OR EXISTS(SELECT 1 FROM plant_invoices WHERE customer_id=$1)
            OR EXISTS(SELECT 1 FROM driver_employment_profiles WHERE driver_id=$1)
            OR EXISTS(SELECT 1 FROM user_profiles
                     WHERE user_id=$1 AND (LOWER(kyc_status) NOT IN
                       ('unverified','not_started','pending') OR verified_name IS NOT NULL))",
    )
    .bind(user_id)
    .fetch_one(&mut *tx)
    .await?;
    if retain {
        return Err(AppError::Conflict(
            "Retained commercial, KYC, staff, location or file records need reviewed erasure and legal retention before completion".into(),
        ));
    }

    // Account-linked OTPs must be discarded as well as tokens/passkeys (which
    // cascade from users) so deleted identities cannot reuse an old challenge.
    sqlx::query("DELETE FROM otp_verifications WHERE destination=$1 OR destination=$2")
        .bind(&phone)
        .bind(email.as_deref().unwrap_or(""))
        .execute(&mut *tx)
        .await?;

    // Keep the immutable action ledger but detach identifiers and free-form
    // metadata; never retain plaintext personal data in audit metadata.
    sqlx::query("UPDATE audit_logs SET user_id=NULL, metadata='{}'::jsonb, ip_address=NULL WHERE user_id=$1")
        .bind(user_id).execute(&mut *tx).await?;

    // FK RESTRICT failures are fail-closed; PostgreSQL rolls the whole
    // transaction back. We do not mark completed unless hard deletion succeeds.
    let deleted = sqlx::query("DELETE FROM users WHERE id=$1")
        .bind(user_id)
        .execute(&mut *tx)
        .await?;
    if deleted.rows_affected() != 1 {
        return Err(AppError::Conflict(
            "Account deletion was not completed".into(),
        ));
    }
    sqlx::query(
        "UPDATE account_deletion_requests
         SET status='COMPLETED', user_id=NULL, reason=NULL,
             identifier_hash=repeat('0',32)||replace(id::text,'-',''),
             completed_at=NOW(), updated_at=NOW()
         WHERE id=$1 AND status='PENDING'",
    )
    .bind(request_id)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "INSERT INTO audit_logs(user_id,action,resource_type,resource_id,metadata)
         VALUES($1,'account_deletion.fulfilled','account_deletion_request',$2,
                jsonb_build_object('status','COMPLETED','identity_erased',true))",
    )
    .bind(actor_id)
    .bind(request_id.to_string())
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}

fn deletion_identifier(role: &str, phone: &str, email: Option<&str>) -> Result<String, AppError> {
    if matches!(role, "customer" | "driver") {
        let (destination, channel) = normalize_identifier(phone)?;
        if channel != "whatsapp" {
            return Err(AppError::BadRequest(
                "A registered mobile number is required".into(),
            ));
        }
        Ok(destination)
    } else {
        let (destination, channel) = normalize_identifier(email.unwrap_or_default())?;
        if channel != "email" {
            return Err(AppError::BadRequest(
                "A registered email is required".into(),
            ));
        }
        Ok(destination)
    }
}

pub async fn cancel(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<impl IntoResponse, AppError> {
    let mut tx = state.db.begin().await?;
    let row: Option<(Uuid,)> = sqlx::query_as(
        "UPDATE account_deletion_requests
         SET status = 'CANCELLED', updated_at = NOW()
         WHERE user_id = $1 AND status = 'PENDING'
         RETURNING id",
    )
    .bind(auth_user.user_id)
    .fetch_optional(&mut *tx)
    .await?;

    let Some((request_id,)) = row else {
        return Err(AppError::NotFound(
            "No pending deletion request was found".to_string(),
        ));
    };

    sqlx::query(
        "INSERT INTO audit_logs (user_id, action, resource_type, resource_id, metadata)
         VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(auth_user.user_id)
    .bind("account_deletion.cancelled")
    .bind("account_deletion_request")
    .bind(request_id.to_string())
    .bind(json!({ "requested_via": "signed_in" }))
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(Json(json!({ "success": true, "status": "CANCELLED" })))
}

#[cfg(test)]
mod tests {
    use super::{deletion_identifier, normalize_identifier, DeletionRequestBody};

    #[test]
    fn signed_in_deletion_requires_a_code_and_uses_role_bound_contact() {
        assert!(serde_json::from_value::<DeletionRequestBody>(
            serde_json::json!({"confirm":"DELETE"})
        )
        .is_err());
        assert_eq!(
            deletion_identifier("customer", "+91 98765-43210", Some("customer@example.com"))
                .unwrap(),
            "919876543210"
        );
        assert_eq!(
            deletion_identifier("plant_owner", "9876543210", Some("OWNER@EXAMPLE.COM")).unwrap(),
            "owner@example.com"
        );
        assert!(deletion_identifier("plant_owner", "9876543210", None).is_err());
        assert!(deletion_identifier("customer", "", Some("customer@example.com")).is_err());
    }

    #[test]
    fn normalizes_email_case_and_whitespace() {
        let (value, channel) = normalize_identifier("  USER@Example.com ").unwrap();
        assert_eq!(value, "user@example.com");
        assert_eq!(channel, "email");
    }

    #[test]
    fn normalizes_indian_mobile_for_whatsapp() {
        let (value, channel) = normalize_identifier("+91 98765-43210").unwrap();
        assert_eq!(value, "919876543210");
        assert_eq!(channel, "whatsapp");
    }

    #[test]
    fn rejects_non_phone_identifiers() {
        assert!(normalize_identifier("abc9876543210").is_err());
        assert!(normalize_identifier("user@localhost").is_err());
    }
}
