use crate::{
    auth::{jwt::generate_token, totp::TotpEngine, AuthUser},
    error::AppError,
    state::AppState,
};
use axum::{
    async_trait,
    extract::{FromRef, FromRequestParts, State},
    http::{header::AUTHORIZATION, request::Parts, HeaderMap},
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::ops::Deref;
use uuid::Uuid;

pub fn token_hash(headers: &HeaderMap) -> Result<String, AppError> {
    let token = headers
        .get(AUTHORIZATION)
        .and_then(|h| h.to_str().ok())
        .and_then(|h| h.strip_prefix("Bearer "))
        .filter(|h| !h.trim().is_empty())
        .ok_or_else(|| AppError::Unauthorized("Missing bearer session".into()))?;
    Ok(format!("{:x}", Sha256::digest(token.as_bytes())))
}

pub struct WebAdmin {
    pub user: AuthUser,
    pub permissions: Vec<String>,
    pub token_hash: String,
}

impl Deref for WebAdmin {
    type Target = AuthUser;
    fn deref(&self) -> &AuthUser {
        &self.user
    }
}

impl WebAdmin {
    pub fn require(&self, permission: &str) -> Result<(), AppError> {
        if self.permissions.iter().any(|p| p == permission) {
            Ok(())
        } else {
            Err(AppError::Forbidden(
                "Control Center permission denied".into(),
            ))
        }
    }
}

#[async_trait]
impl<S> FromRequestParts<S> for WebAdmin
where
    AppState: FromRef<S>,
    S: Send + Sync,
{
    type Rejection = AppError;
    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, AppError> {
        let user = AuthUser::from_request_parts(parts, state).await?;
        if user.role != "central_admin" {
            return Err(AppError::Forbidden(
                "Dedicated Central Admin session required".into(),
            ));
        }
        let hash = token_hash(&parts.headers)?;
        let app = AppState::from_ref(state);
        let permissions: Vec<String> = sqlx::query_scalar(
            "SELECT a.permissions FROM control_center_access a
             JOIN control_center_sessions s ON s.user_id = a.user_id
             WHERE a.user_id = $1 AND a.approved = TRUE AND s.token_hash = $2
             AND s.revoked_at IS NULL AND s.expires_at > NOW()",
        )
        .bind(user.user_id)
        .bind(&hash)
        .fetch_optional(&app.db)
        .await?
        .ok_or_else(|| AppError::Forbidden("Approved web MFA session required".into()))?;
        Ok(Self {
            user,
            permissions,
            token_hash: hash,
        })
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AdminLogin {
    pub identifier: String,
    pub code: String,
}

pub async fn method() -> Json<Value> {
    Json(json!({"status":"AUTHENTICATOR_REQUIRED", "method":"totp"}))
}

pub async fn login(
    State(state): State<AppState>,
    Json(body): Json<AdminLogin>,
) -> Result<Json<Value>, AppError> {
    let identifier = body.identifier.trim().to_lowercase();
    if identifier.len() < 3
        || identifier.len() > 254
        || body.code.len() != 6
        || !body.code.bytes().all(|b| b.is_ascii_digit())
    {
        return Err(AppError::Unauthorized("Authentication failed".into()));
    }
    let key = format!("{:x}", Sha256::digest(identifier.as_bytes()));
    let mut tx = state.db.begin().await?;
    sqlx::query("INSERT INTO control_center_login_limits (identifier_hash) VALUES ($1) ON CONFLICT DO NOTHING")
        .bind(&key).execute(&mut *tx).await?;
    let (attempts, started, last_step): (i32, chrono::DateTime<chrono::Utc>, Option<i64>) = sqlx::query_as(
        "SELECT attempts, window_started_at, last_totp_step FROM control_center_login_limits WHERE identifier_hash=$1 FOR UPDATE",
    ).bind(&key).fetch_one(&mut *tx).await?;
    let now = chrono::Utc::now();
    let attempts = if now - started >= chrono::Duration::minutes(15) {
        0
    } else {
        attempts
    };
    if attempts >= 5 {
        return Err(AppError::Forbidden(
            "Authentication temporarily locked; retry later".into(),
        ));
    }
    sqlx::query("UPDATE control_center_login_limits SET attempts=$2, window_started_at=CASE WHEN $2=1 THEN NOW() ELSE window_started_at END WHERE identifier_hash=$1")
        .bind(&key).bind(attempts+1).execute(&mut *tx).await?;
    let identity: Option<(Uuid, String, Option<String>, String, String)> = sqlx::query_as(
        "SELECT u.id, u.phone, u.email, u.full_name, t.secret_key FROM users u
         JOIN control_center_access a ON a.user_id=u.id
         JOIN user_totp_credentials t ON t.user_id=u.id AND t.is_enabled=TRUE
         WHERE LOWER(u.email)=$1 AND u.role='central_admin' AND u.is_active=TRUE AND a.approved=TRUE",
    ).bind(&identifier).fetch_optional(&mut *tx).await?;
    let verified_step = identity.as_ref().and_then(|i| {
        [-1_i64, 0, 1]
            .into_iter()
            .map(|offset| now.timestamp() / 30 + offset)
            .find(|step| {
                last_step.map_or(true, |last| *step > last)
                    && TotpEngine::compute_code(&i.4, (*step * 30) as u64)
                        .is_ok_and(|code| code == body.code)
            })
    });
    let Some(step) = verified_step else {
        sqlx::query("INSERT INTO audit_logs (action,resource_type,metadata) VALUES ('admin.auth.failed','admin_session','{}')")
            .execute(&mut *tx).await?;
        tx.commit().await?;
        return Err(AppError::Unauthorized("Authentication failed".into()));
    };
    let (id, phone, email, full_name, _) = identity.expect("verified identity");
    let token = generate_token(
        id,
        "central_admin",
        &phone,
        email.as_deref(),
        &state.config.jwt_secret,
        1,
    )?;
    let hash = format!("{:x}", Sha256::digest(token.as_bytes()));
    sqlx::query("INSERT INTO control_center_sessions (token_hash,user_id,expires_at) VALUES ($1,$2,NOW()+INTERVAL '1 hour')")
        .bind(hash).bind(id).execute(&mut *tx).await?;
    sqlx::query("UPDATE control_center_login_limits SET attempts=0,last_totp_step=$2 WHERE identifier_hash=$1")
        .bind(key).bind(step).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO audit_logs (user_id,action,resource_type,metadata) VALUES ($1,'admin.auth.succeeded','admin_session','{\"auth_surface\":\"control_center_web\"}')")
        .bind(id).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(
        json!({"success":true,"token":token,"access_token":token,"role":"central_admin",
        "user":{"id":id,"email":email,"full_name":full_name,"role":"central_admin"}}),
    ))
}

pub async fn me(admin: WebAdmin) -> Json<Value> {
    Json(
        json!({"user":{"id":admin.user_id,"email":admin.email,"role":admin.role},"permissions":admin.permissions}),
    )
}
