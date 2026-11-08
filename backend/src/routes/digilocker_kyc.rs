//! Sandbox.co.in DigiLocker integration. Test environment only and disabled by default.
//! Callback is a browser trampoline, never an identity-verification source of truth.
use crate::{
    auth::{middleware::check_role, AuthUser},
    error::AppError,
    state::AppState,
};
use axum::{extract::State, Json};
use chrono::{Duration, Utc};
use reqwest::{header, Client};
use serde_json::{json, Value};
use sqlx::Row;
use std::{env, time::Duration as StdDuration};
use uuid::Uuid;

const SANDBOX_HOST: &str = "https://test-api.sandbox.co.in";
const LIVE_HOST: &str = "https://api.sandbox.co.in";
const REDIRECT_URL: &str = "https://trackmyrmc.com/kyc/return";
const MAX_PROVIDER_BODY: usize = 262_144;

// Evaluate the same enablement, approved live policy and credential checks
// used by actual provider requests; never trust a client-supplied environment.
pub(crate) fn approved_provider_environment() -> Result<&'static str, AppError> {
    Ok(Provider::enabled()?.environment)
}

/// Switching to live mode must not turn a historic sandbox KYC approval into
/// a production-verified identity, even if the live provider is temporarily
/// disabled or its credentials are missing.
pub(crate) fn live_approval_required() -> bool {
    env::var("TRACKMYRMC_KYC_ENV").as_deref() == Ok("live")
}

/// Normalize customer-facing identity state at response time rather than
/// modifying historical sandbox approvals during deployment. This prevents
/// mobile UI from presenting a stale verified shield while live mode is active.
pub(crate) async fn effective_customer_kyc_status(
    db: &sqlx::PgPool,
    customer_id: Uuid,
    stored: &str,
) -> Result<String, AppError> {
    if !stored.eq_ignore_ascii_case("verified") || !live_approval_required() {
        return Ok(stored.to_owned());
    }
    let approved: bool = sqlx::query_scalar(LIVE_APPROVAL_SQL)
        .bind(customer_id)
        .fetch_one(db)
        .await?;
    Ok(if approved { "verified" } else { "unverified" }.to_owned())
}

/// A live consent session is not sufficient by itself: an independent privileged
/// reviewer must have approved THAT environment after the consent was verified.
/// Only the latest customer KYC review counts, so reset/rejection invalidate the
/// earlier approval even if the user profile was later restored incorrectly.
/// Legacy review audit events without provider_environment are deliberately denied.
pub(crate) const LIVE_APPROVAL_SQL: &str = r#"
SELECT EXISTS (
    SELECT 1
    FROM audit_logs a
    JOIN customer_digilocker_sessions d ON d.user_id=$1
    WHERE a.id=(
        SELECT last_review.id
        FROM audit_logs last_review
        WHERE last_review.resource_type='customer'
          AND last_review.resource_id=$1::text
          AND last_review.action IN ('authority.kyc.review','control_center.kyc.review')
        ORDER BY last_review.id DESC LIMIT 1
    )
      AND a.metadata->>'provider_environment'='live'
      AND (a.metadata->>'status'='verified'
           OR a.metadata->>'kyc_status'='verified')
      AND d.provider_environment='live'
      AND d.status='PENDING'
      AND d.verified_at IS NOT NULL
      AND a.created_at>=d.verified_at
)"#;

struct Provider {
    client: Client,
    host: &'static str,
    label: &'static str,
    environment: &'static str,
    api_key: String,
    api_secret: String,
}
impl Provider {
    fn enabled() -> Result<Self, AppError> {
        if env::var("TRACKMYRMC_KYC_ENABLED").as_deref() != Ok("true") {
            return Err(AppError::Conflict("DigiLocker KYC is not enabled".into()));
        }
        // Sandbox Test keys are NOT interchangeable with production Live keys.
        // A separate, explicit live approval flag prevents accidental escalation.
        let (host, label, environment, key_var, secret_var) = match env::var("TRACKMYRMC_KYC_ENV")
            .as_deref()
        {
            Ok("sandbox") => (
                SANDBOX_HOST,
                "sandbox_digilocker",
                "sandbox",
                "SANDBOX_KYC_API_KEY",
                "SANDBOX_KYC_API_SECRET",
            ),
            Ok("live") if env::var("TRACKMYRMC_KYC_LIVE_APPROVED").as_deref() == Ok("true") => (
                LIVE_HOST,
                "live_digilocker",
                "live",
                "LIVE_KYC_API_KEY",
                "LIVE_KYC_API_SECRET",
            ),
            _ => {
                return Err(AppError::Conflict(
                    "DigiLocker KYC environment is not approved".into(),
                ))
            }
        };
        let api_key = env::var(key_var).unwrap_or_default();
        let api_secret = env::var(secret_var).unwrap_or_default();
        if api_key.trim().is_empty() || api_secret.trim().is_empty() {
            return Err(AppError::Conflict(
                "DigiLocker KYC is not configured".into(),
            ));
        }
        let client = Client::builder()
            .timeout(StdDuration::from_secs(12))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|_| AppError::InternalError("KYC HTTP client unavailable".into()))?;
        Ok(Self {
            client,
            host,
            label,
            environment,
            api_key,
            api_secret,
        })
    }
    async fn read(response: reqwest::Response) -> Result<Value, AppError> {
        if !response.status().is_success() {
            return Err(AppError::Conflict(
                "DigiLocker provider request failed".into(),
            ));
        }
        if response
            .content_length()
            .is_some_and(|n| n > MAX_PROVIDER_BODY as u64)
        {
            return Err(AppError::Conflict(
                "Invalid DigiLocker provider response".into(),
            ));
        }
        let bytes = response
            .bytes()
            .await
            .map_err(|_| AppError::Conflict("DigiLocker provider unavailable".into()))?;
        if bytes.len() > MAX_PROVIDER_BODY {
            return Err(AppError::Conflict(
                "Invalid DigiLocker provider response".into(),
            ));
        }
        let body: Value = serde_json::from_slice(&bytes)
            .map_err(|_| AppError::Conflict("Invalid DigiLocker provider response".into()))?;
        if body.get("code").and_then(Value::as_i64) != Some(200)
            || !body.get("data").is_some_and(Value::is_object)
        {
            return Err(AppError::Conflict(
                "DigiLocker provider returned an error".into(),
            ));
        }
        Ok(body)
    }
    async fn access_token(&self) -> Result<String, AppError> {
        let res = self
            .client
            .post(format!("{}/authenticate", self.host))
            .header("x-api-key", &self.api_key)
            .header("x-api-secret", &self.api_secret)
            .send()
            .await
            .map_err(|_| AppError::Conflict("DigiLocker authentication unavailable".into()))?;
        let body = Self::read(res).await?;
        body.pointer("/data/access_token")
            .and_then(Value::as_str)
            .filter(|v| !v.is_empty() && v.len() < 8192)
            .map(str::to_owned)
            .ok_or_else(|| AppError::Conflict("DigiLocker authentication failed".into()))
    }
    async fn post(&self, token: &str, path: &str, payload: Value) -> Result<Value, AppError> {
        let res = self
            .client
            .post(format!("{}{path}", self.host))
            .header("Authorization", token)
            .header("x-api-key", &self.api_key)
            .header(header::CONTENT_TYPE, "application/json")
            .json(&payload)
            .send()
            .await
            .map_err(|_| AppError::Conflict("DigiLocker provider unavailable".into()))?;
        Self::read(res).await
    }
    async fn get(&self, token: &str, path: &str) -> Result<Value, AppError> {
        let res = self
            .client
            .get(format!("{SANDBOX_HOST}{path}"))
            .header("Authorization", token)
            .header("x-api-key", &self.api_key)
            .send()
            .await
            .map_err(|_| AppError::Conflict("DigiLocker provider unavailable".into()))?;
        Self::read(res).await
    }
}

fn safe_authorization_url(raw: &str) -> bool {
    // Never relay a provider-supplied arbitrary URL to the client's browser.
    // Permit only the documented DigiLocker host and its HTTPS path.
    raw.starts_with("https://digilocker.meripehchaan.gov.in/")
        && !(raw.contains('\r') || raw.contains('\n') || raw.contains('\\'))
        && raw.len() < 8192
}
fn display_status(db: &str) -> &'static str {
    match db.to_ascii_lowercase().as_str() {
        "verified" => "VERIFIED",
        "pending" => "PENDING",
        "rejected" => "REJECTED",
        "requires_reverification" => "REQUIRES_REVERIFICATION",
        _ => "NOT_STARTED",
    }
}
fn session_status(status: &str) -> &'static str {
    match status {
        "STARTING" | "IN_PROGRESS" => "IN_PROGRESS",
        "PENDING" => "PENDING",
        "REJECTED" | "EXPIRED" | "FAILED" => "REQUIRES_REVERIFICATION",
        _ => "NOT_STARTED",
    }
}
fn comparable_name(name: &str) -> String {
    name.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}
fn normalized_mobile(raw: &str) -> Option<String> {
    let digits: String = raw.chars().filter(|c| c.is_ascii_digit()).collect();
    if digits.len() == 10 {
        Some(digits)
    } else if digits.len() == 12 && digits.starts_with("91") {
        Some(digits[2..].to_string())
    } else {
        None
    }
}
fn profile_matches(account_name: &str, account_phone: &str, data: &Value) -> bool {
    // A DigiLocker profile must explicitly attest Aadhaar presence and match THIS customer.
    let name = data.get("name").and_then(Value::as_str).unwrap_or("");
    let phone = data.get("mobile").and_then(Value::as_str).unwrap_or("");
    data.get("eaadhaar").and_then(Value::as_bool) == Some(true)
        && !comparable_name(name).is_empty()
        && comparable_name(name) == comparable_name(account_name)
        && normalized_mobile(phone).is_some()
        && normalized_mobile(phone) == normalized_mobile(account_phone)
}
fn provider_completed(s: &str) -> bool {
    matches!(
        s,
        "consented" | "completed" | "success" | "succeeded" | "consent_received"
    )
}
fn provider_rejected(s: &str) -> bool {
    matches!(
        s,
        "cancelled" | "canceled" | "failed" | "expired" | "rejected" | "denied"
    )
}

pub async fn start(State(state): State<AppState>, user: AuthUser) -> Result<Json<Value>, AppError> {
    check_role(&user, &["customer"])?;
    let provider = Provider::enabled()?;
    let mut tx = state.db.begin().await?;
    let account = sqlx::query(
        "SELECT u.is_active, u.full_name, u.phone, coalesce(p.kyc_status,'unverified') AS kyc_status
         FROM users u JOIN user_profiles p ON p.user_id=u.id WHERE u.id=$1 FOR UPDATE OF p"
    ).bind(user.user_id).fetch_optional(&mut *tx).await?
        .ok_or_else(|| AppError::NotFound("Customer profile not found".into()))?;
    if !account.get::<bool, _>("is_active") {
        return Err(AppError::Forbidden("Inactive customer".into()));
    }
    let stored_verified = display_status(&account.get::<String, _>("kyc_status")) == "VERIFIED";
    let approved_for_live = if stored_verified && live_approval_required() {
        sqlx::query_scalar::<_, bool>(LIVE_APPROVAL_SQL)
            .bind(user.user_id)
            .fetch_one(&mut *tx)
            .await?
    } else {
        true
    };
    if stored_verified && approved_for_live {
        return Err(AppError::Conflict(
            "Customer KYC is already verified".into(),
        ));
    }
    // Enforce one active attempt at a time, with a minimum retry interval.
    let active = sqlx::query(
        "SELECT id,created_at FROM customer_digilocker_sessions
         WHERE user_id=$1 AND status IN ('STARTING','IN_PROGRESS') FOR UPDATE",
    )
    .bind(user.user_id)
    .fetch_optional(&mut *tx)
    .await?;
    if let Some(row) = active {
        let created: chrono::DateTime<Utc> = row.get("created_at");
        if Utc::now() - created < Duration::seconds(65) {
            return Err(AppError::RateLimited(
                "Please wait before restarting DigiLocker".into(),
            ));
        }
        let id: Uuid = row.get("id");
        sqlx::query(
            "UPDATE customer_digilocker_sessions SET status='EXPIRED',updated_at=NOW() WHERE id=$1",
        )
        .bind(id)
        .execute(&mut *tx)
        .await?;
    }
    let id: Uuid = sqlx::query_scalar(
        "INSERT INTO customer_digilocker_sessions(user_id,provider_environment) VALUES($1,$2) RETURNING id",
    )
    .bind(user.user_id)
    .bind(provider.environment)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;

    let initiate = async {
        let token = provider.access_token().await?;
        let body = provider
            .post(
                &token,
                "/kyc/digilocker/sessions/init",
                json!({
                    "@entity":"in.co.sandbox.kyc.digilocker.session.request",
                    "flow":"signin", "redirect_url":REDIRECT_URL,
                    "doc_types":["aadhaar"],"purpose":"TrackMyRMC Customer Verification",
                    "requestor_name":"TrackMyRMC"
                }),
            )
            .await?;
        let data = &body["data"];
        let session_id: Uuid = data
            .get("session_id")
            .and_then(Value::as_str)
            .and_then(|s| Uuid::parse_str(s).ok())
            .ok_or_else(|| AppError::Conflict("Invalid DigiLocker session".into()))?;
        let url = data
            .get("authorization_url")
            .and_then(Value::as_str)
            .filter(|s| safe_authorization_url(s))
            .ok_or_else(|| AppError::Conflict("Invalid DigiLocker authorization link".into()))?;
        Ok::<(Uuid, String), AppError>((session_id, url.to_string()))
    }
    .await;
    match initiate {
        Ok((session_id, url)) => {
            sqlx::query(
                "UPDATE customer_digilocker_sessions SET status='IN_PROGRESS',
                 provider_session_id=$2,updated_at=NOW() WHERE id=$1 AND status='STARTING'",
            )
            .bind(id)
            .bind(session_id)
            .execute(&state.db)
            .await?;
            Ok(Json(
                json!({"status":"IN_PROGRESS","provider":provider.label,
                           "authorization_url":url}),
            ))
        }
        Err(err) => {
            sqlx::query("UPDATE customer_digilocker_sessions SET status='FAILED',updated_at=NOW() WHERE id=$1")
                .bind(id).execute(&state.db).await?;
            Err(err)
        }
    }
}

/// An asynchronously completed second consent must not undo a concurrently
/// committed independent reviewer approval. Lock the profile before checking
/// its CURRENT status and current live evidence, not the stale status read
/// before the network provider request.
async fn complete_consent_profile_transition(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    customer_id: Uuid,
    name: &str,
    live_mode: bool,
) -> Result<bool, AppError> {
    let stored: String =
        sqlx::query_scalar("SELECT kyc_status FROM user_profiles WHERE user_id=$1 FOR UPDATE")
            .bind(customer_id)
            .fetch_one(&mut **tx)
            .await?;

    let already_approved = if stored.eq_ignore_ascii_case("verified") {
        if live_mode {
            // Evidence cannot be inferred from a sandbox/legacy approval. The
            // approval/revocation audit read occurs WHILE the profile lock is
            // held, so an overlapping reviewer transaction is serialized.
            sqlx::query_scalar::<_, bool>(LIVE_APPROVAL_SQL)
                .bind(customer_id)
                .fetch_one(&mut **tx)
                .await?
        } else {
            true
        }
    } else {
        false
    };
    if already_approved {
        return Ok(false);
    }
    sqlx::query(
        "UPDATE user_profiles SET kyc_status='pending',verified_name=$2,updated_at=NOW()
         WHERE user_id=$1",
    )
    .bind(customer_id)
    .bind(name)
    .execute(&mut **tx)
    .await?;
    Ok(true)
}

pub async fn status(
    State(state): State<AppState>,
    user: AuthUser,
) -> Result<Json<Value>, AppError> {
    check_role(&user, &["customer"])?;
    let account = sqlx::query(
        "SELECT u.full_name,coalesce(u.phone,'') AS phone,coalesce(p.kyc_status,'unverified') AS kyc_status
         FROM users u LEFT JOIN user_profiles p ON p.user_id=u.id WHERE u.id=$1",
    )
    .bind(user.user_id)
    .fetch_one(&state.db)
    .await?;
    let kyc: String = account.get("kyc_status");
    let stored_status = display_status(&kyc);
    let live_approved = if stored_status == "VERIFIED" && live_approval_required() {
        sqlx::query_scalar::<_, bool>(LIVE_APPROVAL_SQL)
            .bind(user.user_id)
            .fetch_one(&state.db)
            .await?
    } else {
        true
    };
    let effective_status = if stored_status == "VERIFIED" && !live_approved {
        "REQUIRES_REVERIFICATION"
    } else {
        stored_status
    };
    // Legacy status is displayed while the provider is disabled unless the
    // application is explicitly in live mode, which requires live approval.
    let provider = match Provider::enabled() {
        Ok(p) => p,
        Err(_) => {
            return Ok(Json(json!({
                "status": effective_status,
                "kyc_status": if live_approved {kyc.clone()} else {"unverified".to_string()},
                "provider": "unavailable",
                "refresh_failed": false
            })))
        }
    };
    // Approved status always comes from the database, never callback query parameters.
    if effective_status == "VERIFIED" {
        return Ok(Json(json!({"status":"VERIFIED","provider":provider.label})));
    }
    let latest = sqlx::query(
        "SELECT id,provider_session_id,status,expires_at
         FROM customer_digilocker_sessions WHERE user_id=$1 AND provider_environment=$2
         ORDER BY created_at DESC LIMIT 1",
    )
    .bind(user.user_id)
    .bind(provider.environment)
    .fetch_optional(&state.db)
    .await?;
    let Some(latest) = latest else {
        return Ok(Json(
            json!({"status":effective_status,"provider":provider.label}),
        ));
    };
    let id: Uuid = latest.get("id");
    let previous: String = latest.get("status");
    if previous != "IN_PROGRESS" {
        // Authority rejection/reset takes precedence over a former consent session.
        let profile_state = effective_status;
        let status = if profile_state != "NOT_STARTED" {
            profile_state
        } else if previous == "PENDING" {
            "NOT_STARTED"
        } else {
            session_status(&previous)
        };
        return Ok(Json(json!({"status":status,"provider":provider.label})));
    }
    let expiry: chrono::DateTime<Utc> = latest.get("expires_at");
    if Utc::now() > expiry {
        sqlx::query("UPDATE customer_digilocker_sessions SET status='EXPIRED',updated_at=NOW() WHERE id=$1 AND status='IN_PROGRESS'")
            .bind(id).execute(&state.db).await?;
        return Ok(Json(
            json!({"status":"REQUIRES_REVERIFICATION","provider":provider.label}),
        ));
    }
    let Some(provider_id) = latest.get::<Option<Uuid>, _>("provider_session_id") else {
        return Ok(Json(
            json!({"status":"IN_PROGRESS","provider":provider.label,"refresh_failed":true}),
        ));
    };
    let refresh = async {
        let token = provider.access_token().await?;
        let body = provider.get(&token, &format!("/kyc/digilocker/sessions/{provider_id}/status")).await?;
        let value = body.pointer("/data/status").and_then(Value::as_str).unwrap_or("").to_ascii_lowercase();
        if provider_rejected(&value) {
            sqlx::query("UPDATE customer_digilocker_sessions SET status='REJECTED',updated_at=NOW() WHERE id=$1 AND status='IN_PROGRESS'")
                .bind(id).execute(&state.db).await?;
            return Ok::<&'static str,AppError>("REQUIRES_REVERIFICATION");
        }
        if !provider_completed(&value) {
            return Ok("IN_PROGRESS");
        }
        // Consent must cover an actual UIDAI-issued Aadhaar document, not just profile access.
        // Inspect provider document metadata only; never fetch or persist the presigned file.
        let document = provider.get(&token, &format!("/kyc/digilocker/sessions/{provider_id}/documents/aadhaar")).await?;
        let aadhaar_consented = document.pointer("/data/files").and_then(Value::as_array)
            .is_some_and(|files| files.iter().any(|file|
                file.pointer("/metadata/issuer_id").and_then(Value::as_str) == Some("in.gov.uidai")));
        if !aadhaar_consented {
            return Err(AppError::Conflict("Consented Aadhaar document was not confirmed".into()));
        }
        let profile = provider.get(&token, &format!("/kyc/digilocker/sessions/{provider_id}/user/profile")).await?;
        let data = &profile["data"];
        if !profile_matches(&account.get::<String,_>("full_name"), &account.get::<String,_>("phone"), data) {
            // Identity mismatches are not auto-approved or written as verified_name.
            sqlx::query("UPDATE customer_digilocker_sessions SET status='REJECTED',updated_at=NOW() WHERE id=$1 AND status='IN_PROGRESS'")
                .bind(id).execute(&state.db).await?;
            return Ok("REQUIRES_REVERIFICATION");
        }
        let name = data.get("name").and_then(Value::as_str).unwrap_or("");
        let mut tx = state.db.begin().await?;
        let changed = sqlx::query(
            "UPDATE customer_digilocker_sessions SET status='PENDING',verified_at=NOW(),updated_at=NOW()
             WHERE id=$1 AND user_id=$2 AND status='IN_PROGRESS'"
        ).bind(id).bind(user.user_id).execute(&mut *tx).await?.rows_affected();
        let mut effective_result = "PENDING";
        if changed == 1 {
            // Re-read and lock the CURRENT approval before any profile mutation.
            // The first consent may have been independently approved while this
            // handler was awaiting provider HTTP responses for a second consent.
            let reopened = complete_consent_profile_transition(
                &mut tx,
                user.user_id,
                name,
                provider.environment == "live",
            )
            .await?;
            if !reopened {
                effective_result = "VERIFIED";
            }
            sqlx::query(
                "INSERT INTO audit_logs(user_id,action,resource_type,resource_id,metadata)
                 VALUES($1,'kyc.digilocker.consent_verified','customer',$2,$3)"
            ).bind(user.user_id).bind(user.user_id.to_string())
            .bind(json!({"provider":provider.label,
                         "session_id":provider_id.to_string(),
                         "result":if reopened {"pending_authority_review"} else {"already_approved"}}))
            .execute(&mut *tx).await?;
        }
        tx.commit().await?;
        Ok(effective_result)
    }.await;
    match refresh {
        Ok(status) => Ok(Json(json!({"status":status,"provider":provider.label}))),
        Err(_) => Ok(Json(
            json!({"status":"IN_PROGRESS","provider":provider.label,"refresh_failed":true}),
        )),
    }
}
#[cfg(test)]
mod tests {
    use super::*;

    #[sqlx::test]
    async fn duplicate_consent_cannot_downgrade_committed_live_approval(db: sqlx::PgPool) {
        let customer: Uuid = sqlx::query_scalar(
            "INSERT INTO users(phone,hashed_password,full_name,role)
             VALUES($1,'test-only','Approved Customer','customer') RETURNING id",
        )
        .bind(format!("kyc{}", &Uuid::new_v4().simple().to_string()[..12]))
        .fetch_one(&db)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO user_profiles(user_id,kyc_status,verified_name)
             VALUES($1,'verified','Approved Customer')",
        )
        .bind(customer)
        .execute(&db)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO customer_digilocker_sessions
             (user_id,provider_environment,status,verified_at)
             VALUES($1,'live','PENDING',NOW()-INTERVAL '2 minutes')",
        )
        .bind(customer)
        .execute(&db)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO audit_logs(action,resource_type,resource_id,metadata)
             VALUES('control_center.kyc.review','customer',$1,$2)",
        )
        .bind(customer.to_string())
        .bind(json!({"status":"verified","provider_environment":"live"}))
        .execute(&db)
        .await
        .unwrap();

        let mut tx = db.begin().await.unwrap();
        let reopened =
            complete_consent_profile_transition(&mut tx, customer, "New Consent Name", true)
                .await
                .unwrap();
        tx.commit().await.unwrap();
        assert!(
            !reopened,
            "the live review committed before the profile lock wins"
        );
        let status: (String, Option<String>) =
            sqlx::query_as("SELECT kyc_status,verified_name FROM user_profiles WHERE user_id=$1")
                .bind(customer)
                .fetch_one(&db)
                .await
                .unwrap();
        assert_eq!(status.0, "verified");
        assert_eq!(status.1.as_deref(), Some("Approved Customer"));

        // A subsequently revoked approval must allow new evidence to open
        // a new pending independent-review cycle.
        sqlx::query(
            "INSERT INTO audit_logs(action,resource_type,resource_id,metadata)
             VALUES('authority.kyc.review','customer',$1,$2)",
        )
        .bind(customer.to_string())
        .bind(json!({"kyc_status":"unverified","provider_environment":null}))
        .execute(&db)
        .await
        .unwrap();
        let mut tx = db.begin().await.unwrap();
        assert!(
            complete_consent_profile_transition(&mut tx, customer, "Fresh Consent", true)
                .await
                .unwrap()
        );
        tx.commit().await.unwrap();
        let status: String =
            sqlx::query_scalar("SELECT kyc_status FROM user_profiles WHERE user_id=$1")
                .bind(customer)
                .fetch_one(&db)
                .await
                .unwrap();
        assert_eq!(status, "pending");
    }

    #[sqlx::test]
    async fn live_kyc_requires_latest_environment_matched_audited_approval(db: sqlx::PgPool) {
        let customer: Uuid = sqlx::query_scalar(
            "INSERT INTO users(phone,hashed_password,full_name,role)
             VALUES($1,'test-only','Synthetic KYC Customer','customer') RETURNING id",
        )
        .bind(format!(
            "proof{}",
            &Uuid::new_v4().simple().to_string()[..12]
        ))
        .fetch_one(&db)
        .await
        .unwrap();
        let approved = || sqlx::query_scalar::<_, bool>(LIVE_APPROVAL_SQL).bind(customer);
        assert!(!approved().fetch_one(&db).await.unwrap());

        sqlx::query(
            "INSERT INTO customer_digilocker_sessions
             (user_id,provider_environment,status,verified_at)
             VALUES($1,'sandbox','PENDING',NOW()-INTERVAL '2 minutes')",
        )
        .bind(customer)
        .execute(&db)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO audit_logs(action,resource_type,resource_id,metadata)
             VALUES('authority.kyc.review','customer',$1,$2)",
        )
        .bind(customer.to_string())
        .bind(json!({"kyc_status":"verified","provider_environment":"sandbox"}))
        .execute(&db)
        .await
        .unwrap();
        assert!(!approved().fetch_one(&db).await.unwrap());

        sqlx::query(
            "INSERT INTO customer_digilocker_sessions
             (user_id,provider_environment,status,verified_at)
             VALUES($1,'live','PENDING',NOW()-INTERVAL '1 minute')",
        )
        .bind(customer)
        .execute(&db)
        .await
        .unwrap();
        assert!(!approved().fetch_one(&db).await.unwrap());

        sqlx::query(
            "INSERT INTO audit_logs(action,resource_type,resource_id,metadata)
             VALUES('control_center.kyc.review','customer',$1,$2)",
        )
        .bind(customer.to_string())
        .bind(json!({"status":"verified","provider_environment":"live"}))
        .execute(&db)
        .await
        .unwrap();
        assert!(approved().fetch_one(&db).await.unwrap());

        sqlx::query(
            "INSERT INTO audit_logs(action,resource_type,resource_id,metadata)
             VALUES('authority.kyc.review','customer',$1,$2)",
        )
        .bind(customer.to_string())
        .bind(json!({"kyc_status":"unverified","provider_environment":null}))
        .execute(&db)
        .await
        .unwrap();
        assert!(!approved().fetch_one(&db).await.unwrap());
    }

    #[test]
    fn contract_normalization_and_strict_identity_match() {
        assert_eq!(display_status("verified"), "VERIFIED");
        assert_eq!(display_status("unverified"), "NOT_STARTED");
        assert_eq!(session_status("IN_PROGRESS"), "IN_PROGRESS");
        assert!(!safe_authorization_url("https://evil.example/kyc"));
        assert!(safe_authorization_url(
            "https://digilocker.meripehchaan.gov.in/public/oauth2/1/authorize"
        ));
        assert!(profile_matches(
            "Ramesh Kumar",
            "+919876543210",
            &json!({"name":"Ramesh   Kumar","mobile":"9876543210","eaadhaar":true})
        ));
        assert!(!profile_matches(
            "Ramesh Kumar",
            "9876543210",
            &json!({"name":"Another Person","mobile":"9876543210","eaadhaar":true})
        ));
        assert!(!profile_matches(
            "Ramesh Kumar",
            "9876543210",
            &json!({"name":"Ramesh Kumar","mobile":"0000000000","eaadhaar":true})
        ));
        assert!(!profile_matches(
            "Ramesh Kumar",
            "9876543210",
            &json!({"name":"Ramesh Kumar","mobile":"9876543210","eaadhaar":false})
        ));
        assert!(provider_completed("succeeded"));
        assert!(provider_completed("consent_received"));
        assert!(!provider_completed("created"));
        assert!(!provider_completed("pending"));
    }
}
