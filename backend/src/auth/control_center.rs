use crate::{
    auth::{
        account_sessions,
        otp::OtpEngine,
        totp::{hash_backup_code, TotpEngine},
        AuthUser,
    },
    central_admin_bootstrap::{pending_primary_id, PRIMARY_PERMISSIONS},
    error::AppError,
    services::auth_service::{challenge_digest, create_staff_challenge, deliver_email_otp},
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

const ADMIN_OTP_PURPOSE: &str = "central_admin_login";
const ADMIN_LOGIN: &str = "admin_login";
const ADMIN_ENROLLMENT: &str = "admin_enrollment";
const ADMIN_RECOVERY: &str = "admin_recovery";
const NO_STORE: [(axum::http::HeaderName, &str); 1] =
    [(axum::http::header::CACHE_CONTROL, "no-store")];

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AdminEmail {
    email: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AdminEmailProof {
    email: String,
    otp: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AdminChallengeProof {
    challenge_token: String,
    code: String,
}

pub async fn method() -> Json<Value> {
    Json(json!({"status":"EMAIL_OTP_AND_AUTHENTICATOR_REQUIRED","method":"email_otp_totp"}))
}

fn admin_auth_failed() -> AppError {
    AppError::Unauthorized("Invalid or expired Central Admin verification".into())
}

#[derive(sqlx::FromRow)]
struct AdminIdentity {
    id: Uuid,
    email: String,
    phone: Option<String>,
    full_name: String,
    is_active: bool,
}

async fn eligible_admin(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    email: Option<&str>,
    challenge: Option<&str>,
) -> Result<AdminIdentity, AppError> {
    let user: AdminIdentity = sqlx::query_as(
        "SELECT u.id,u.email,u.phone,u.full_name,u.is_active FROM users u
         WHERE u.role='central_admin' AND u.email IS NOT NULL AND
           (($1::text IS NOT NULL AND lower(u.email)=$1) OR
            ($2::text IS NOT NULL AND EXISTS(
                SELECT 1 FROM staff_mfa_challenges c WHERE c.user_id=u.id AND c.token_hash=$2
                 AND c.purpose IN ('admin_login','admin_enrollment','admin_recovery')
                 AND c.consumed_at IS NULL AND c.expires_at>clock_timestamp())))
         FOR UPDATE OF u",
    )
    .bind(email)
    .bind(challenge)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or_else(admin_auth_failed)?;

    // Read the current approval and credential after acquiring the user lock.
    let eligible = if user.is_active {
        sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM control_center_access a
             JOIN user_totp_credentials t ON t.user_id=a.user_id
             WHERE a.user_id=$1 AND a.approved AND t.is_enabled)",
        )
        .bind(user.id)
        .fetch_one(&mut **tx)
        .await?
    } else {
        pending_primary_id(tx).await? == Some(user.id)
    };
    if !eligible {
        return Err(admin_auth_failed());
    }
    Ok(user)
}

pub async fn send_email_otp(
    State(state): State<AppState>,
    Json(body): Json<AdminEmail>,
) -> Result<Json<Value>, AppError> {
    let email = body.email.trim().to_ascii_lowercase();
    let mut tx = state.db.begin().await?;
    let user = eligible_admin(&mut tx, Some(&email), None).await?;
    tx.commit().await?;
    deliver_email_otp(
        &state,
        &user.email.to_ascii_lowercase(),
        ADMIN_OTP_PURPOSE,
        "Central Admin Portal",
    )
    .await?;
    Ok(Json(json!({"status":"EMAIL_OTP_SENT"})))
}

fn enrollment_details(state: &AppState, email: &str, token: &str) -> Value {
    let secret = TotpEngine::admin_enrollment_secret(&state.config.otp_pepper, token);
    json!({
        "account": email,
        "otpauth_uri": TotpEngine::get_otpauth_uri(&secret, email),
        "manual_key": secret,
    })
}

pub async fn verify_email_otp(
    State(state): State<AppState>,
    Json(body): Json<AdminEmailProof>,
) -> Result<impl axum::response::IntoResponse, AppError> {
    let email = body.email.trim().to_ascii_lowercase();
    // The shared OTP engine consumes a correctly verified code exactly once.
    OtpEngine::verify_otp(&state, &email, "email", ADMIN_OTP_PURPOSE, &body.otp).await?;
    let mut tx = state.db.begin().await?;
    let user = eligible_admin(&mut tx, Some(&email), None).await?;
    sqlx::query(
        "UPDATE staff_mfa_challenges SET consumed_at=clock_timestamp()
         WHERE user_id=$1 AND consumed_at IS NULL
           AND purpose IN ('admin_login','admin_enrollment','admin_recovery')",
    )
    .bind(user.id)
    .execute(&mut *tx)
    .await?;
    let purpose = if user.is_active {
        ADMIN_LOGIN
    } else {
        ADMIN_ENROLLMENT
    };
    let (token, expires_in) = create_staff_challenge(&mut *tx, user.id, purpose).await?;
    let setup = (!user.is_active).then(|| enrollment_details(&state, &user.email, &token));
    tx.commit().await?;
    Ok((
        NO_STORE,
        Json(json!({"challenge_token":token,"expires_in":expires_in,"enrollment":setup})),
    ))
}

/// Retain the privileged identity throttle across new email OTP challenges.
async fn begin_admin_proof(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    user: &AdminIdentity,
    digest: &str,
) -> Result<Option<String>, AppError> {
    let purpose = sqlx::query_scalar(
        "UPDATE staff_mfa_challenges SET attempts=attempts+1
         WHERE user_id=$1 AND token_hash=$2 AND consumed_at IS NULL
           AND expires_at>clock_timestamp() AND attempts<max_attempts
         RETURNING purpose",
    )
    .bind(user.id)
    .bind(digest)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or_else(admin_auth_failed)?;
    let key = challenge_digest(&user.email.to_ascii_lowercase());
    let attempts: i32 = sqlx::query_scalar(
        "INSERT INTO control_center_login_limits(identifier_hash,attempts) VALUES ($1,1)
         ON CONFLICT (identifier_hash) DO UPDATE SET
           attempts=CASE WHEN control_center_login_limits.window_started_at<=NOW()-INTERVAL '15 minutes'
                        THEN 1 ELSE LEAST(control_center_login_limits.attempts+1,6) END,
           window_started_at=CASE WHEN control_center_login_limits.attempts=0 OR
             control_center_login_limits.window_started_at<=NOW()-INTERVAL '15 minutes'
             THEN NOW() ELSE control_center_login_limits.window_started_at END
         RETURNING attempts",
    )
    .bind(key)
    .fetch_one(&mut **tx)
    .await?;
    Ok((attempts <= 5).then_some(purpose))
}

async fn fail_admin_proof(
    mut tx: sqlx::Transaction<'_, sqlx::Postgres>,
    user_id: Uuid,
) -> Result<AppError, AppError> {
    sqlx::query("INSERT INTO audit_logs(user_id,action,resource_type,metadata)
                 VALUES($1,'admin.auth.failed','admin_session','{\"auth_surface\":\"control_center_web\"}')")
        .bind(user_id).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(admin_auth_failed())
}

pub async fn recover(
    State(state): State<AppState>,
    Json(body): Json<AdminChallengeProof>,
) -> Result<impl axum::response::IntoResponse, AppError> {
    let digest = challenge_digest(&body.challenge_token);
    let mut tx = state.db.begin().await?;
    let user = eligible_admin(&mut tx, None, Some(&digest)).await?;
    let purpose = begin_admin_proof(&mut tx, &user, &digest).await?;
    if purpose.as_deref() != Some(ADMIN_LOGIN) || !user.is_active {
        return Err(fail_admin_proof(tx, user.id).await?);
    }
    let stored: String = sqlx::query_scalar(
        "SELECT secret_key FROM user_totp_credentials WHERE user_id=$1 AND is_enabled FOR UPDATE",
    )
    .bind(user.id)
    .fetch_one(&mut *tx)
    .await?;
    let secret = state.config.totp_keyring.open(user.id, &stored)?;
    let normalized = body.code.trim();
    if !matches!(normalized.len(), 8 | 9)
        || !normalized
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-')
    {
        return Err(fail_admin_proof(tx, user.id).await?);
    }
    let hash = hash_backup_code(&body.code, &secret);
    let removed = sqlx::query(
        "UPDATE user_totp_credentials SET backup_codes=array_remove(backup_codes,$2),updated_at=NOW()
         WHERE user_id=$1 AND $2=ANY(backup_codes)",
    )
    .bind(user.id)
    .bind(hash)
    .execute(&mut *tx)
    .await?;
    if removed.rows_affected() != 1 {
        return Err(fail_admin_proof(tx, user.id).await?);
    }
    // Exchange the proof for a separate one-use recovery challenge. Only the
    // replacement authenticator can complete it; a backup code issues no session.
    consume_admin_challenge(&mut tx, &digest).await?;
    let (token, expires_in) = create_staff_challenge(&mut *tx, user.id, ADMIN_RECOVERY).await?;
    sqlx::query("UPDATE control_center_login_limits SET attempts=0 WHERE identifier_hash=$1")
        .bind(challenge_digest(&user.email.to_ascii_lowercase()))
        .execute(&mut *tx)
        .await?;
    let enrollment = enrollment_details(&state, &user.email, &token);
    sqlx::query(
        "INSERT INTO audit_logs(user_id,action,resource_type,metadata)
                 VALUES($1,'admin.auth.recovery_started','central_admin','{}')",
    )
    .bind(user.id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok((
        NO_STORE,
        Json(json!({"challenge_token":token,"expires_in":expires_in,"enrollment":enrollment})),
    ))
}

async fn consume_admin_challenge(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    digest: &str,
) -> Result<(), AppError> {
    let result = sqlx::query(
        "UPDATE staff_mfa_challenges SET consumed_at=clock_timestamp()
         WHERE token_hash=$1 AND consumed_at IS NULL AND expires_at>clock_timestamp()",
    )
    .bind(digest)
    .execute(&mut **tx)
    .await?;
    if result.rows_affected() != 1 {
        return Err(admin_auth_failed());
    }
    Ok(())
}

pub async fn login(
    State(state): State<AppState>,
    Json(body): Json<AdminChallengeProof>,
) -> Result<impl axum::response::IntoResponse, AppError> {
    let digest = challenge_digest(&body.challenge_token);
    let mut tx = state.db.begin().await?;
    let user = eligible_admin(&mut tx, None, Some(&digest)).await?;
    let purpose = begin_admin_proof(&mut tx, &user, &digest).await?;
    let purpose = match (user.is_active, purpose.as_deref()) {
        (true, Some(ADMIN_LOGIN)) => ADMIN_LOGIN,
        (true, Some(ADMIN_RECOVERY)) => ADMIN_RECOVERY,
        (false, Some(ADMIN_ENROLLMENT)) => ADMIN_ENROLLMENT,
        _ => return Err(fail_admin_proof(tx, user.id).await?),
    };
    let secret = if purpose == ADMIN_LOGIN {
        let stored: String = sqlx::query_scalar(
            "SELECT secret_key FROM user_totp_credentials WHERE user_id=$1 AND is_enabled FOR UPDATE",
        )
        .bind(user.id)
        .fetch_one(&mut *tx)
        .await?;
        state.config.totp_keyring.open(user.id, &stored)?
    } else {
        TotpEngine::admin_enrollment_secret(&state.config.otp_pepper, &body.challenge_token)
    };
    let Some(step) = TotpEngine::verified_step(&secret, &body.code)? else {
        return Err(fail_admin_proof(tx, user.id).await?);
    };

    let mut recovery_codes = Vec::new();
    if purpose == ADMIN_LOGIN {
        let updated = sqlx::query(
            "UPDATE user_totp_credentials SET last_login_totp_step=$2
             WHERE user_id=$1 AND (last_login_totp_step IS NULL OR last_login_totp_step<$2)",
        )
        .bind(user.id)
        .bind(step)
        .execute(&mut *tx)
        .await?;
        if updated.rows_affected() != 1 {
            return Err(fail_admin_proof(tx, user.id).await?);
        }
    } else {
        recovery_codes = TotpEngine::generate_backup_codes();
        let hashes: Vec<String> = recovery_codes
            .iter()
            .map(|code| hash_backup_code(code, &secret))
            .collect();
        let encrypted = state.config.totp_keyring.seal(user.id, &secret)?;
        if purpose == ADMIN_ENROLLMENT {
            sqlx::query("INSERT INTO user_totp_credentials(user_id,secret_key,is_enabled,backup_codes,last_login_totp_step)
                         VALUES($1,$2,TRUE,$3,$4)")
                .bind(user.id).bind(&encrypted).bind(&hashes).bind(step).execute(&mut *tx).await?;
            sqlx::query("INSERT INTO control_center_access(user_id,approved,permissions) VALUES($1,TRUE,$2)")
                .bind(user.id).bind(PRIMARY_PERMISSIONS).execute(&mut *tx).await?;
            sqlx::query("UPDATE users SET is_active=TRUE,is_verified=TRUE,hashed_password='!web-only-no-password!',
                         updated_at=NOW() WHERE id=$1")
                .bind(user.id).execute(&mut *tx).await?;
        } else {
            sqlx::query("UPDATE user_totp_credentials SET secret_key=$2,backup_codes=$3,last_login_totp_step=$4,
                         updated_at=NOW() WHERE user_id=$1 AND is_enabled")
                .bind(user.id).bind(&encrypted).bind(&hashes).bind(step).execute(&mut *tx).await?;
        }
        let action = if purpose == ADMIN_ENROLLMENT {
            "control_center.bootstrap.first_admin"
        } else {
            "admin.auth.recovery_completed"
        };
        sqlx::query(
            "INSERT INTO audit_logs(user_id,action,resource_type,resource_id,metadata)
                     VALUES($1,$2,'central_admin',$3,'{\"method\":\"email_otp_totp\"}')",
        )
        .bind(user.id)
        .bind(action)
        .bind(user.id.to_string())
        .execute(&mut *tx)
        .await?;
    }
    consume_admin_challenge(&mut tx, &digest).await?;
    sqlx::query("UPDATE users SET work_email_verified_at=clock_timestamp() WHERE id=$1")
        .bind(user.id)
        .execute(&mut *tx)
        .await?;
    let token = issue_web_session(
        &mut tx,
        &state,
        user.id,
        "central_admin",
        user.phone.as_deref().unwrap_or(""),
        Some(&user.email),
    )
    .await?;
    sqlx::query("UPDATE control_center_login_limits SET attempts=0,last_totp_step=$2 WHERE identifier_hash=$1")
        .bind(challenge_digest(&user.email.to_ascii_lowercase())).bind(step).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO audit_logs(user_id,action,resource_type,metadata)
                 VALUES($1,'admin.auth.succeeded','admin_session','{\"auth_surface\":\"control_center_web\",\"factors\":[\"email_otp\",\"totp\"]}')")
        .bind(user.id).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok((
        NO_STORE,
        Json(
            json!({"success":true,"token":token,"access_token":token,"role":"central_admin",
        "recovery_codes":recovery_codes,
        "user":{"id":user.id,"email":user.email,"full_name":user.full_name,"role":"central_admin"}}),
        ),
    ))
}

/// The role is server-selected by the route; no request can choose its own role.
pub async fn login_for_role(
    state: AppState,
    body: AdminLogin,
    role: &'static str,
) -> Result<Json<Value>, AppError> {
    if role != "authority" {
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
    // Serialize the entire proof and issuance with password rotation and access
    // governance. Taking this lock only inside issue_in_tx permits a password
    // or approval read before revocation to create a fresh session afterwards.
    // Read joined credentials/access in a NEW statement after acquiring the
    // lock: READ COMMITTED must see any policy change committed while we waited.
    let _: Option<Uuid> =
        sqlx::query_scalar("SELECT id FROM users WHERE LOWER(email)=$1 AND role=$2 FOR UPDATE")
            .bind(&identifier)
            .bind(role)
            .fetch_optional(&mut *tx)
            .await?;
    let identity: Option<PrivilegedWebIdentity> = sqlx::query_as(
        "SELECT u.id, u.phone, u.email, u.full_name, t.secret_key, u.hashed_password FROM users u
         JOIN control_center_access a ON a.user_id=u.id
         JOIN user_totp_credentials t ON t.user_id=u.id AND t.is_enabled=TRUE
         WHERE LOWER(u.email)=$1 AND u.role=$2 AND u.is_active=TRUE AND a.approved=TRUE
         FOR UPDATE OF t",
    )
    .bind(&identifier)
    .bind(role)
    .fetch_optional(&mut *tx)
    .await?;
    // Independently prove knowledge of the Argon2id password and possession of
    // the enrolled authenticator. Placeholder and legacy hashes fail closed.
    // Keep expensive Argon2 work off Tokio's request workers. Unknown/disabled
    // identities perform the same password work without ever becoming valid.
    let stored_hash = identity.as_ref().map(|i| i.5.clone());
    let password = body.password;
    let valid_password = tokio::task::spawn_blocking(move || {
        const DUMMY_HASH: &str = "$argon2id$v=19$m=19456,t=2,p=1$SvWTeNFS61/Ui+SOXVyNJw$JGIBa6UrWI3fvkiDP+jDI+a6plEeoYVpTM72VyGddR8";
        let usable_hash = stored_hash.as_deref().filter(|hash| hash.starts_with("$argon2id$"));
        let verified = crate::auth::password::verify_password(&password, usable_hash.unwrap_or(DUMMY_HASH)).unwrap_or(false);
        usable_hash.is_some() && verified
    })
    .await
    .map_err(|_| AppError::InternalError("Password verification unavailable".into()))?;
    let verified_step = if let Some(identity) = identity.as_ref().filter(|_| valid_password) {
        let secret = state.config.totp_keyring.open(identity.0, &identity.4)?;
        TotpEngine::verified_step(&secret, &body.code)?
            .filter(|step| last_step.is_none_or(|last| *step > last))
    } else {
        None
    };
    let Some(step) = verified_step else {
        sqlx::query("INSERT INTO audit_logs (action,resource_type,metadata) VALUES ('admin.auth.failed','admin_session','{}')")
            .execute(&mut *tx).await?;
        tx.commit().await?;
        return Err(AppError::Unauthorized("Authentication failed".into()));
    };
    let (id, phone, email, full_name, _, _) = identity.expect("verified identity");
    // All privileged proof surfaces share the credential counter. Updating it in
    // this transaction serializes concurrent login/step-up/enrollment proofs.
    let accepted = sqlx::query(
        "UPDATE user_totp_credentials SET last_login_totp_step=$2
         WHERE user_id=$1 AND is_enabled
           AND (last_login_totp_step IS NULL OR last_login_totp_step<$2)",
    )
    .bind(id)
    .bind(step)
    .execute(&mut *tx)
    .await?;
    if accepted.rows_affected() != 1 {
        sqlx::query("INSERT INTO audit_logs (action,resource_type,metadata) VALUES ('admin.auth.failed','admin_session','{}')")
            .execute(&mut *tx).await?;
        tx.commit().await?;
        return Err(AppError::Unauthorized("Authentication failed".into()));
    }
    let token = issue_web_session(
        &mut tx,
        &state,
        id,
        role,
        phone.as_deref().unwrap_or(""),
        email.as_deref(),
    )
    .await?;
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

async fn issue_web_session(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    state: &AppState,
    id: Uuid,
    role: &str,
    phone: &str,
    email: Option<&str>,
) -> Result<String, AppError> {
    let token =
        account_sessions::issue_in_tx(tx, id, role, phone, email, &state.config.jwt_secret, 1)
            .await?;
    // This web surface also has its own session table and step-up grants.
    sqlx::query(
        "UPDATE control_center_sessions SET revoked_at=clock_timestamp()
                 WHERE user_id=$1 AND revoked_at IS NULL",
    )
    .bind(id)
    .execute(&mut **tx)
    .await?;
    sqlx::query("DELETE FROM control_center_step_ups WHERE user_id=$1")
        .bind(id)
        .execute(&mut **tx)
        .await?;
    let hash = format!("{:x}", Sha256::digest(token.as_bytes()));
    sqlx::query("INSERT INTO control_center_sessions (token_hash,user_id,expires_at) VALUES ($1,$2,NOW()+INTERVAL '1 hour')")
        .bind(hash).bind(id).execute(&mut **tx).await?;
    Ok(token)
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
         AND role='authority'",
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
    crate::auth::totp::verify_staff_totp_login(state, user_id, &body.code).await?;
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
