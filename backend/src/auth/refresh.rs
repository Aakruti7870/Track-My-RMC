//! Opaque, single-use, rotating refresh tokens bound to the one active account session.
//! Only OTP/MFA completion may mint the first credential; access tokens never renew
//! themselves. The secret is never written to the database or logged.
use crate::{
    auth::{account_sessions, jwt::verify_token},
    error::AppError,
    state::AppState,
};
use axum::{
    http::{header::{COOKIE, ORIGIN, SET_COOKIE}, HeaderMap, HeaderValue},
    response::{IntoResponse, Response},
    Json,
};
use chrono::{DateTime, Duration, Utc};
use rand::RngCore;
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use uuid::Uuid;

const REFRESH_LIFETIME_DAYS: i64 = 90;
const COOKIE_NAME: &str = "__Host-tmrmc-refresh";

pub struct RefreshBundle {
    pub token: String,
    pub refresh_token: String,
}

fn new_credential() -> (Uuid, String, String) {
    let id = Uuid::new_v4();
    let mut secret = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut secret);
    let raw = format!("{id}.{}", hex::encode(secret));
    let digest = hex::encode(Sha256::digest(raw.as_bytes()));
    (id, raw, digest)
}

fn parse_credential(raw: &str) -> Result<Uuid, AppError> {
    let (id, secret) = raw.split_once('.')
        .ok_or_else(|| AppError::Unauthorized("Invalid refresh credential".into()))?;
    if secret.len() != 64 || !secret.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(AppError::Unauthorized("Invalid refresh credential".into()));
    }
    Uuid::parse_str(id).map_err(|_| AppError::Unauthorized("Invalid refresh credential".into()))
}

// Compare the digests without an early-exit byte comparison.
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() { return false; }
    let mut diff = 0u8;
    for (&left, &right) in a.iter().zip(b.iter()) { diff |= left ^ right; }
    diff == 0
}

pub async fn issue_after_auth(
    state: &AppState,
    user: Uuid,
    role: &str,
    phone: &str,
    email: Option<&str>,
    lifetime_hours: i64,
) -> Result<RefreshBundle, AppError> {
    // Central Admin remains authenticator-only with its existing short-lived
    // step-up-bound session: silent refresh would bypass mandatory re-auth.
    if matches!(role, "admin" | "central_admin" | "authority") {
        return Err(AppError::Forbidden("Privileged console sessions cannot be silently renewed".into()));
    }
    let mut tx = state.db.begin().await?;
    let access = account_sessions::issue_in_tx(
        &mut tx, user, role, phone, email, &state.config.jwt_secret, lifetime_hours,
    ).await?;
    let (id, raw, hash) = new_credential();
    sqlx::query(
        "INSERT INTO account_refresh_tokens(user_id,token_id,token_hash,expires_at)
         VALUES($1,$2,$3,$4)
         ON CONFLICT(user_id) DO UPDATE SET token_id=EXCLUDED.token_id,
           token_hash=EXCLUDED.token_hash,expires_at=EXCLUDED.expires_at,
           rotated_at=clock_timestamp()",
    )
    .bind(user).bind(id).bind(hash)
    .bind(Utc::now() + Duration::days(REFRESH_LIFETIME_DAYS))
    .execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(RefreshBundle { token: access, refresh_token: raw })
}

pub async fn rotate(state: &AppState, raw: &str) -> Result<RefreshBundle, AppError> {
    let id = parse_credential(raw)?;
    let mut tx = state.db.begin().await?;
    let user: Uuid = sqlx::query_scalar("SELECT user_id FROM account_refresh_tokens WHERE token_id=$1")
        .bind(id).fetch_optional(&mut *tx).await?
        .ok_or_else(|| AppError::Unauthorized("Refresh credential expired or replaced".into()))?;

    // Consistent lock order with OTP/MFA login: users row, then refresh row.
    let identity: (String, String, Option<String>, bool, Option<Uuid>) = sqlx::query_as(
        "SELECT role,phone,email,is_active,active_session_jti FROM users WHERE id=$1 FOR UPDATE",
    ).bind(user).fetch_one(&mut *tx).await?;

    let (stored_id, hash, expires): (Uuid, String, DateTime<Utc>) = sqlx::query_as(
        "SELECT token_id,token_hash,expires_at FROM account_refresh_tokens WHERE user_id=$1 FOR UPDATE",
    ).bind(user).fetch_one(&mut *tx).await?;

    let digest = hex::encode(Sha256::digest(raw.as_bytes()));
    if stored_id != id || !constant_time_eq(hash.as_bytes(), digest.as_bytes())
        || expires <= Utc::now() || !identity.3 || identity.4.is_none()
        || matches!(identity.0.as_str(), "admin" | "central_admin" | "authority")
    {
        return Err(AppError::Unauthorized("Refresh credential expired or replaced".into()));
    }
    let access = account_sessions::issue_in_tx(
        &mut tx, user, &identity.0, &identity.1, identity.2.as_deref(),
        &state.config.jwt_secret, state.config.jwt_expiration_hours,
    ).await?;
    // A successful rotation invalidates the prior access JTI as well.
    let (next_id, next_raw, next_hash) = new_credential();
    sqlx::query(
        "UPDATE account_refresh_tokens SET token_id=$2,token_hash=$3,
         expires_at=$4,rotated_at=clock_timestamp() WHERE user_id=$1",
    )
    .bind(user).bind(next_id).bind(next_hash)
    .bind(Utc::now() + Duration::days(REFRESH_LIFETIME_DAYS))
    .execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(RefreshBundle { token: access, refresh_token: next_raw })
}

fn cookie_value(secret: &str) -> String {
    // __Host- cookies cannot be set by subdomains; HttpOnly shields the token
    // from browser JavaScript, while SameSite=Strict limits cross-site requests.
    format!("{COOKIE_NAME}={secret}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age={}",
        REFRESH_LIFETIME_DAYS * 86400)
}

pub fn clear_cookie(response: &mut Response) {
    response.headers_mut().append(
        SET_COOKIE,
        HeaderValue::from_static("__Host-tmrmc-refresh=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0"),
    );
}

pub fn login_response(
    mut body: crate::models::user::AuthResponse,
    request_headers: &HeaderMap,
) -> Response {
    let raw = body.refresh_token.clone();
    // Browsers receive the refresh credential in an HttpOnly cookie only.
    // Native clients (no Origin header) receive it for expo-secure-store.
    if request_headers.contains_key(ORIGIN) { body.refresh_token = None; }
    let mut response = Json(body).into_response();
    if let Some(secret) = raw {
        if let Ok(header) = HeaderValue::from_str(&cookie_value(&secret)) {
            response.headers_mut().append(SET_COOKIE, header);
        }
    }
    response
}

#[derive(Deserialize, Default)]
pub struct RefreshRequest {
    pub refresh_token: Option<String>,
}

pub fn presented_refresh(headers: &HeaderMap, body: RefreshRequest) -> Result<String, AppError> {
    if let Some(raw) = body.refresh_token {
        if !raw.is_empty() { return Ok(raw); }
    }
    let cookies = headers.get(COOKIE).and_then(|v| v.to_str().ok()).unwrap_or("");
    cookies.split(';').map(str::trim)
        .find_map(|part| part.strip_prefix(&format!("{COOKIE_NAME}=")))
        .filter(|s| !s.is_empty()).map(str::to_owned)
        .ok_or_else(|| AppError::Unauthorized("Refresh credential required".into()))
}

pub async fn refresh(
    axum::extract::State(state): axum::extract::State<AppState>,
    headers: HeaderMap,
    Json(body): Json<RefreshRequest>,
) -> Result<Response, AppError> {
    let raw = presented_refresh(&headers, body)?;
    let new = rotate(&state, &raw).await?;
    let mut json_body = json!({"success":true,"token":new.token,"access_token":new.token});
    if !headers.contains_key(ORIGIN) {
        json_body["refresh_token"] = json!(new.refresh_token);
    }
    let mut response = Json(json_body).into_response();
    let cookie = HeaderValue::from_str(&cookie_value(&new.refresh_token))
        .map_err(|_| AppError::InternalError("Refresh cookie error".into()))?;
    response.headers_mut().append(SET_COOKIE, cookie);
    Ok(response)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn credential_is_random_and_never_stored_plaintext() {
        let (first_id, first, hashed) = new_credential();
        let (second_id, second, _) = new_credential();
        assert_ne!(first_id, second_id);
        assert_ne!(first, second);
        assert_eq!(parse_credential(&first).unwrap(), first_id);
        assert!(!hashed.contains(&first));
        assert!(constant_time_eq(hashed.as_bytes(), hex::encode(Sha256::digest(first.as_bytes())).as_bytes()));
        assert!(parse_credential("not-a-token").is_err());
    }
    #[test]
    fn no_browser_script_access_to_cookie() {
        let c = cookie_value("synthetic");
        assert!(c.contains("HttpOnly; Secure; SameSite=Strict"));
        assert!(c.starts_with("__Host-tmrmc-refresh="));
    }
}
