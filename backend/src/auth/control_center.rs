use crate::{
    auth::{account_sessions, totp::TotpEngine, AuthUser},
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

type PrivilegedWebIdentity = (Uuid, Option<String>, Option<String>, String, String, String);

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AdminLogin {
    pub identifier: String,
    pub password: String,
    pub code: String,
}

pub async fn method() -> Json<Value> {
    Json(json!({"status":"PASSWORD_AND_AUTHENTICATOR_REQUIRED", "method":"password_totp"}))
}

pub async fn login(
    State(state): State<AppState>,
    Json(body): Json<AdminLogin>,
) -> Result<Json<Value>, AppError> {
    login_for_role(state, body, "central_admin").await
}

/// The role is server-selected by the route; no request can choose its own role.
pub async fn login_for_role(
    state: AppState,
    body: AdminLogin,
    role: &'static str,
) -> Result<Json<Value>, AppError> {
    if !matches!(role, "central_admin" | "authority") {
        return Err(AppError::Forbidden("Unknown privileged web role".into()));
    }
    let identifier = body.identifier.trim().to_lowercase();
    if identifier.len() < 3
        || identifier.len() > 254
        || !(12..=128).contains(&body.password.len())
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
    let identity: Option<PrivilegedWebIdentity> = sqlx::query_as(
        "SELECT u.id, u.phone, u.email, u.full_name, t.secret_key, u.hashed_password FROM users u
         JOIN control_center_access a ON a.user_id=u.id
         JOIN user_totp_credentials t ON t.user_id=u.id AND t.is_enabled=TRUE
         WHERE LOWER(u.email)=$1 AND u.role=$2 AND u.is_active=TRUE AND a.approved=TRUE",
    )
    .bind(&identifier)
    .bind(role)
    .fetch_optional(&mut *tx)
    .await?;
    // Independently prove knowledge of the Argon2id password and possession of
    // the enrolled authenticator. Placeholder and legacy hashes fail closed.
    let valid_password = identity.as_ref().is_some_and(|i| {
        i.5.starts_with("$argon2id$")
            && crate::auth::password::verify_password(&body.password, &i.5).unwrap_or(false)
    });
    let verified_step = identity.as_ref().filter(|_| valid_password).and_then(|i| {
        [-1_i64, 0, 1]
            .into_iter()
            .map(|offset| now.timestamp() / 30 + offset)
            .find(|step| {
                last_step.is_none_or(|last| *step > last)
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
    let (id, phone, email, full_name, secret, _) = identity.expect("verified identity");
    // All privileged proof surfaces share the credential counter. Updating it in
    // this transaction serializes concurrent login/step-up/enrollment proofs.
    let accepted = sqlx::query(
        "UPDATE user_totp_credentials SET last_login_totp_step=$2
         WHERE user_id=$1 AND is_enabled AND secret_key=$3
           AND (last_login_totp_step IS NULL OR last_login_totp_step<$2)",
    )
    .bind(id)
    .bind(step)
    .bind(&secret)
    .execute(&mut *tx)
    .await?;
    if accepted.rows_affected() != 1 {
        sqlx::query("INSERT INTO audit_logs (action,resource_type,metadata) VALUES ('admin.auth.failed','admin_session','{}')")
            .execute(&mut *tx).await?;
        tx.commit().await?;
        return Err(AppError::Unauthorized("Authentication failed".into()));
    }
    let token = account_sessions::issue_in_tx(
        &mut tx,
        id,
        role,
        phone.as_deref().unwrap_or(""),
        email.as_deref(),
        &state.config.jwt_secret,
        1,
    )
    .await?;
    // This web surface also has its own session table and step-up grants.
    sqlx::query(
        "UPDATE control_center_sessions SET revoked_at=clock_timestamp()
                 WHERE user_id=$1 AND revoked_at IS NULL",
    )
    .bind(id)
    .execute(&mut *tx)
    .await?;
    sqlx::query("DELETE FROM control_center_step_ups WHERE user_id=$1")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    let hash = format!("{:x}", Sha256::digest(token.as_bytes()));
    sqlx::query("INSERT INTO control_center_sessions (token_hash,user_id,expires_at) VALUES ($1,$2,NOW()+INTERVAL '1 hour')")
        .bind(hash).bind(id).execute(&mut *tx).await?;
    sqlx::query("UPDATE control_center_login_limits SET attempts=0,last_totp_step=$2 WHERE identifier_hash=$1")
        .bind(key).bind(step).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO audit_logs (user_id,action,resource_type,metadata) VALUES ($1,'admin.auth.succeeded','admin_session','{\"auth_surface\":\"control_center_web\",\"factors\":[\"argon2id_password\",\"totp\"]}')")
        .bind(id).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(
        json!({"success":true,"token":token,"access_token":token,"role":role,
        "user":{"id":id,"email":email,"full_name":full_name,"role":role}}),
    ))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PasswordRotation {
    pub current_password: String,
    pub new_password: String,
    pub code: String,
    pub reason: String,
}

/// Self-service rotation never re-enrolls an authenticator or creates a JWT.
/// The caller must already hold a valid, dedicated, role-bound web session.
pub(crate) async fn rotate_password(
    state: &AppState,
    user_id: Uuid,
    session_hash: &str,
    body: PasswordRotation,
) -> Result<Json<Value>, AppError> {
    let reason = body.reason.trim();
    if !(12..=128).contains(&body.current_password.len())
        || !(16..=128).contains(&body.new_password.len())
        || !(10..=500).contains(&reason.len())
        || body.new_password == body.current_password
        || body.code.len() != 6
        || !body.code.bytes().all(|b| b.is_ascii_digit())
    {
        return Err(AppError::BadRequest(
            "Use a distinct password (16-128 bytes), current authenticator and audit reason".into(),
        ));
    }
    // Commit the throttle even when a proof fails: rolled-back counters invite guessing.
    let attempts: i32 = sqlx::query_scalar(
        "UPDATE control_center_sessions SET
         step_up_attempts=CASE WHEN step_up_window_started_at<NOW()-INTERVAL '5 minutes'
         THEN 1 ELSE step_up_attempts+1 END,
         step_up_window_started_at=CASE WHEN step_up_window_started_at<NOW()-INTERVAL '5 minutes'
         THEN NOW() ELSE step_up_window_started_at END
         WHERE user_id=$1 AND token_hash=$2 AND revoked_at IS NULL AND expires_at>NOW()
         RETURNING step_up_attempts",
    )
    .bind(user_id)
    .bind(session_hash)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::Unauthorized("Privileged session expired".into()))?;
    if attempts > 5 {
        return Err(AppError::Forbidden(
            "Credential rotation temporarily locked".into(),
        ));
    }
    let original: String = sqlx::query_scalar(
        "SELECT hashed_password FROM users WHERE id=$1 AND is_active
         AND role IN ('central_admin','authority')",
    )
    .bind(user_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::Unauthorized("Privileged account is unavailable".into()))?;
    if !original.starts_with("$argon2id$")
        || !crate::auth::password::verify_password(&body.current_password, &original)
            .unwrap_or(false)
    {
        return Err(AppError::Unauthorized(
            "Current credentials are invalid".into(),
        ));
    }
    crate::auth::totp::verify_staff_totp_login(&state.db, user_id, &body.code).await?;
    let replacement = crate::auth::password::hash_password(&body.new_password)?;
    let mut tx = state.db.begin().await?;
    let updated = sqlx::query(
        "UPDATE users SET hashed_password=$2,active_session_jti=NULL,
         auth_revoked_at=clock_timestamp(),updated_at=NOW()
         WHERE id=$1 AND hashed_password=$3 AND is_active",
    )
    .bind(user_id)
    .bind(replacement)
    .bind(&original)
    .execute(&mut *tx)
    .await?;
    if updated.rows_affected() != 1 {
        return Err(AppError::Conflict(
            "Credential state changed; restart rotation".into(),
        ));
    }
    sqlx::query(
        "UPDATE control_center_sessions SET revoked_at=clock_timestamp()
         WHERE user_id=$1 AND revoked_at IS NULL",
    )
    .bind(user_id)
    .execute(&mut *tx)
    .await?;
    sqlx::query("DELETE FROM control_center_step_ups WHERE user_id=$1")
        .bind(user_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM account_refresh_tokens WHERE user_id=$1")
        .bind(user_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        "INSERT INTO audit_logs(user_id,action,resource_type,resource_id,metadata)
         VALUES($1,'control_center.password.rotated','privileged_user',$2,$3)",
    )
    .bind(user_id)
    .bind(user_id.to_string())
    .bind(json!({"reason":reason}))
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(json!({"success":true,"session_revoked":true})))
}

pub async fn change_admin_password(
    State(state): State<AppState>,
    admin: WebAdmin,
    Json(body): Json<PasswordRotation>,
) -> Result<Json<Value>, AppError> {
    rotate_password(&state, admin.user_id, &admin.token_hash, body).await
}

pub async fn me(admin: WebAdmin) -> Json<Value> {
    Json(
        json!({"user":{"id":admin.user_id,"email":admin.email,"role":admin.role},"permissions":admin.permissions}),
    )
}

pub async fn logout(
    State(state): State<AppState>,
    admin: WebAdmin,
    headers: HeaderMap,
) -> Result<Json<Value>, AppError> {
    let jti = crate::auth::account_sessions::header_session_jti(
        &headers,
        &state.config.jwt_secret,
        admin.user_id,
    )?;
    let mut tx = state.db.begin().await?;
    sqlx::query(
        "UPDATE control_center_sessions SET revoked_at=NOW() WHERE user_id=$1 AND token_hash=$2",
    )
    .bind(admin.user_id)
    .bind(&admin.token_hash)
    .execute(&mut *tx)
    .await?;
    sqlx::query("DELETE FROM control_center_step_ups WHERE user_id=$1 AND token_hash=$2")
        .bind(admin.user_id)
        .bind(&admin.token_hash)
        .execute(&mut *tx)
        .await?;
    // Revoke only this account JTI, never a newer session that won a login race.
    sqlx::query(
        "UPDATE users SET active_session_jti=NULL,
                 auth_revoked_at=clock_timestamp(),updated_at=NOW()
                 WHERE id=$1 AND active_session_jti=$2",
    )
    .bind(admin.user_id)
    .bind(jti)
    .execute(&mut *tx)
    .await?;
    sqlx::query("INSERT INTO audit_logs (user_id,action,resource_type,metadata) VALUES ($1,'admin.session.logout','admin_session','{}')")
        .bind(admin.user_id).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(json!({"success":true})))
}
