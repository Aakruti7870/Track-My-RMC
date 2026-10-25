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
const REDIRECT_URL: &str = "https://trackmyrmc.com/kyc/return";
const MAX_PROVIDER_BODY: usize = 262_144;

struct Provider {
    client: Client,
    api_key: String,
    api_secret: String,
}
impl Provider {
    fn enabled() -> Result<Self, AppError> {
        // Production environment alone never turns on this integration.
        if env::var("TRACKMYRMC_KYC_ENABLED").as_deref() != Ok("true")
            || env::var("TRACKMYRMC_KYC_ENV").as_deref() != Ok("sandbox")
        {
            return Err(AppError::Conflict("DigiLocker KYC is not enabled".into()));
        }
        let api_key = env::var("SANDBOX_KYC_API_KEY")
            .or_else(|_| env::var("KYC_API_KEY"))
            .unwrap_or_default();
        let api_secret = env::var("SANDBOX_KYC_API_SECRET")
            .or_else(|_| env::var("KYC_API_SECRET"))
            .unwrap_or_default();
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
            .post(format!("{SANDBOX_HOST}/authenticate"))
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
            .post(format!("{SANDBOX_HOST}{path}"))
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
    matches!(s, "consented" | "completed" | "success")
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
    if display_status(&account.get::<String, _>("kyc_status")) == "VERIFIED" {
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
        "INSERT INTO customer_digilocker_sessions(user_id) VALUES($1) RETURNING id",
    )
    .bind(user.user_id)
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
                json!({"status":"IN_PROGRESS","provider":"sandbox_digilocker",
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
    // Production currently has no DigiLocker session migration. Keep the
    // existing KYC screen functional while provider activation is disabled.
    // Never query a staged/not-yet-applied table in fail-closed mode.
    if Provider::enabled().is_err() {
        return Ok(Json(json!({
            "status": display_status(&kyc),
            "kyc_status": kyc,
            "provider": "unavailable",
            "refresh_failed": false
        })));
    }
    // Approved status always comes from the database, never callback query parameters.
    if display_status(&kyc) == "VERIFIED" {
        return Ok(Json(
            json!({"status":"VERIFIED","provider":"sandbox_digilocker"}),
        ));
    }
    let latest = sqlx::query(
        "SELECT id,provider_session_id,status,expires_at
         FROM customer_digilocker_sessions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1",
    )
    .bind(user.user_id)
    .fetch_optional(&state.db)
    .await?;
    let Some(latest) = latest else {
        return Ok(Json(
            json!({"status":display_status(&kyc),"provider":"sandbox_digilocker"}),
        ));
    };
    let id: Uuid = latest.get("id");
    let previous: String = latest.get("status");
    if previous != "IN_PROGRESS" {
        // Authority rejection/reset takes precedence over a former consent session.
        let profile_state = display_status(&kyc);
        let status = if profile_state != "NOT_STARTED" {
            profile_state
        } else if previous == "PENDING" {
            "NOT_STARTED"
        } else {
            session_status(&previous)
        };
        return Ok(Json(
            json!({"status":status,"provider":"sandbox_digilocker"}),
        ));
    }
    let expiry: chrono::DateTime<Utc> = latest.get("expires_at");
    if Utc::now() > expiry {
        sqlx::query("UPDATE customer_digilocker_sessions SET status='EXPIRED',updated_at=NOW() WHERE id=$1 AND status='IN_PROGRESS'")
            .bind(id).execute(&state.db).await?;
        return Ok(Json(
            json!({"status":"REQUIRES_REVERIFICATION","provider":"sandbox_digilocker"}),
        ));
    }
    // If configuration is unavailable, preserve the last known state; do not fake success.
    let provider = match Provider::enabled() {
        Ok(p) => p,
        Err(_) => {
            return Ok(Json(
                json!({"status":"IN_PROGRESS","provider":"sandbox_digilocker","refresh_failed":true}),
            ))
        }
    };
    let Some(provider_id) = latest.get::<Option<Uuid>, _>("provider_session_id") else {
        return Ok(Json(
            json!({"status":"IN_PROGRESS","provider":"sandbox_digilocker","refresh_failed":true}),
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
        if changed == 1 {
            // DigiLocker consent and identity are evidence for Authority review, not approval.
            sqlx::query(
                "UPDATE user_profiles SET kyc_status='pending',verified_name=$2,updated_at=NOW()
                 WHERE user_id=$1 AND kyc_status <> 'verified'"
            ).bind(user.user_id).bind(name).execute(&mut *tx).await?;
            sqlx::query(
                "INSERT INTO audit_logs(user_id,action,resource_type,resource_id,metadata)
                 VALUES($1,'kyc.digilocker.consent_verified','customer',$2,$3)"
            ).bind(user.user_id).bind(user.user_id.to_string())
            .bind(json!({"provider":"sandbox_digilocker","session_id":provider_id.to_string(),"result":"pending_authority_review"}))
            .execute(&mut *tx).await?;
        }
        tx.commit().await?;
        Ok("PENDING")
    }.await;
    match refresh {
        Ok(status) => Ok(Json(
            json!({"status":status,"provider":"sandbox_digilocker"}),
        )),
        Err(_) => Ok(Json(
            json!({"status":"IN_PROGRESS","provider":"sandbox_digilocker","refresh_failed":true}),
        )),
    }
}
#[cfg(test)]
mod tests {
    use super::*;
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
        assert!(!provider_completed("created"));
        assert!(!provider_completed("pending"));
    }
}
