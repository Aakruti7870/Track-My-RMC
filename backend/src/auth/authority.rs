//! Dedicated, browser-only delegated Authority sessions.
//! These are deliberately NOT Central Admin sessions and cannot access WebAdmin routes.
use crate::{
    auth::{control_center, AuthUser},
    error::AppError,
    state::AppState,
};
use axum::{
    async_trait,
    extract::{FromRef, FromRequestParts, Path, Query, State},
    http::{request::Parts, HeaderMap},
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::Digest;
use std::ops::Deref;

pub const DELEGABLE: &[&str] = &[
    "user.view",
    "plant.view",
    "order.view",
    "support.view",
    "kyc.view",
    "kyc.review",
];

pub fn is_delegable(permission: &str) -> bool {
    DELEGABLE.contains(&permission)
}

pub struct WebAuthority {
    pub user: AuthUser,
    pub permissions: Vec<String>,
    pub token_hash: String,
}

impl Deref for WebAuthority {
    type Target = AuthUser;

    fn deref(&self) -> &AuthUser {
        &self.user
    }
}

impl WebAuthority {
    pub fn require(&self, permission: &str) -> Result<(), AppError> {
        if is_delegable(permission) && self.permissions.iter().any(|p| p == permission) {
            Ok(())
        } else {
            Err(AppError::Forbidden("Authority permission denied".into()))
        }
    }
}

#[async_trait]
impl<S> FromRequestParts<S> for WebAuthority
where
    AppState: FromRef<S>,
    S: Send + Sync,
{
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, AppError> {
        let user = AuthUser::from_request_parts(parts, state).await?;
        if user.role != "authority" {
            return Err(AppError::Forbidden(
                "Dedicated Authority web session required".into(),
            ));
        }
        let token_hash = control_center::token_hash(&parts.headers)?;
        let app = AppState::from_ref(state);
        let raw: Vec<String> = sqlx::query_scalar(
            "SELECT a.permissions FROM control_center_access a
             JOIN control_center_sessions s ON s.user_id=a.user_id
             WHERE a.user_id=$1 AND a.approved=TRUE AND s.token_hash=$2
             AND s.revoked_at IS NULL AND s.expires_at>NOW()",
        )
        .bind(user.user_id)
        .bind(&token_hash)
        .fetch_optional(&app.db)
        .await?
        .ok_or_else(|| AppError::Forbidden("Approved Authority web session required".into()))?;
        let permissions = raw.into_iter().filter(|p| is_delegable(p)).collect();
        Ok(Self {
            user,
            permissions,
            token_hash,
        })
    }
}

pub async fn login(
    State(state): State<AppState>,
    Json(body): Json<control_center::AdminLogin>,
) -> Result<Json<Value>, AppError> {
    control_center::login_for_role(state, body, "authority").await
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AuthorityPasswordEnrollment {
    pub challenge_token: String,
    pub password: String,
    pub code: String,
}

/// One-time enrollment: approved Authority + delivered email OTP + enrolled TOTP.
/// A web-only password can only be set while the account has the initial
/// non-hash sentinel. Existing passwords cannot be reset through this endpoint.
pub async fn set_initial_password(
    State(state): State<AppState>,
    Json(body): Json<AuthorityPasswordEnrollment>,
) -> Result<Json<Value>, AppError> {
    if !(16..=128).contains(&body.password.len())
        || body.challenge_token.len() != 48
        || body.code.len() != 6
        || !body.code.bytes().all(|c| c.is_ascii_digit())
    {
        return Err(AppError::BadRequest(
            "Initial Authority password requires 16-128 bytes and an authenticator code".into(),
        ));
    }
    let hash = hex::encode(sha2::Sha256::digest(body.challenge_token.as_bytes()));
    let user: Option<uuid::Uuid> = sqlx::query_scalar(
        "SELECT c.user_id FROM staff_mfa_challenges c
         JOIN users u ON u.id=c.user_id
         JOIN control_center_access a ON a.user_id=u.id
         JOIN user_totp_credentials t ON t.user_id=u.id AND t.is_enabled=TRUE
         WHERE c.token_hash=$1 AND c.purpose='login' AND c.consumed_at IS NULL
           AND c.expires_at>NOW() AND c.attempts<c.max_attempts
           AND u.role='authority' AND u.is_active AND u.work_email_verified_at IS NOT NULL
           AND u.hashed_password='!web-only-no-password!' AND a.approved=TRUE",
    )
    .bind(&hash)
    .fetch_optional(&state.db)
    .await?;
    let user = user.ok_or_else(|| {
        AppError::Unauthorized("Authority enrollment challenge is invalid or expired".into())
    })?;
    if let Err(error) =
        crate::auth::totp::verify_staff_totp_login(&state.db, user, &body.code).await
    {
        sqlx::query(
            "UPDATE staff_mfa_challenges SET attempts=attempts+1
             WHERE token_hash=$1 AND consumed_at IS NULL AND expires_at>NOW()",
        )
        .bind(&hash)
        .execute(&state.db)
        .await?;
        return Err(error);
    }
    let password_hash = crate::auth::password::hash_password(&body.password)?;
    let mut tx = state.db.begin().await?;
    let consumed: Option<uuid::Uuid> = sqlx::query_scalar(
        "UPDATE staff_mfa_challenges SET consumed_at=clock_timestamp()
         WHERE token_hash=$1 AND user_id=$2 AND purpose='login'
           AND consumed_at IS NULL AND expires_at>NOW() AND attempts<max_attempts
         RETURNING user_id",
    )
    .bind(&hash)
    .bind(user)
    .fetch_optional(&mut *tx)
    .await?;
    if consumed != Some(user) {
        return Err(AppError::Unauthorized(
            "Authority enrollment was already consumed".into(),
        ));
    }
    let updated = sqlx::query(
        "UPDATE users SET hashed_password=$2,updated_at=NOW()
         WHERE id=$1 AND role='authority' AND is_active=TRUE
           AND hashed_password='!web-only-no-password!'
           AND work_email_verified_at IS NOT NULL
           AND EXISTS(SELECT 1 FROM control_center_access a
                      WHERE a.user_id=users.id AND a.approved=TRUE)",
    )
    .bind(user)
    .bind(password_hash)
    .execute(&mut *tx)
    .await?;
    if updated.rows_affected() != 1 {
        return Err(AppError::Forbidden(
            "Authority initial password cannot be reset here".into(),
        ));
    }
    sqlx::query(
        "INSERT INTO audit_logs(user_id,action,resource_type,resource_id,metadata)
         VALUES($1,'authority.password.enrolled','authority',$2,'{}')",
    )
    .bind(user)
    .bind(user.to_string())
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(
        json!({"success":true,"message":"Authority password enrolled. Sign in using password and authenticator."}),
    ))
}

pub async fn change_password(
    State(state): State<AppState>,
    authority: WebAuthority,
    Json(body): Json<control_center::PasswordRotation>,
) -> Result<Json<Value>, AppError> {
    control_center::rotate_password(&state, authority.user_id, &authority.token_hash, body).await
}

pub async fn me(authority: WebAuthority) -> Json<Value> {
    Json(json!({
        "user": {"id": authority.user_id, "email": authority.email, "role": "authority"},
        "permissions": authority.permissions,
    }))
}

pub async fn logout(
    State(state): State<AppState>,
    authority: WebAuthority,
    headers: HeaderMap,
) -> Result<Json<Value>, AppError> {
    let jti = crate::auth::account_sessions::header_session_jti(
        &headers,
        &state.config.jwt_secret,
        authority.user_id,
    )?;
    let mut tx = state.db.begin().await?;
    sqlx::query(
        "UPDATE control_center_sessions SET revoked_at=NOW()
         WHERE user_id=$1 AND token_hash=$2",
    )
    .bind(authority.user_id)
    .bind(&authority.token_hash)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "UPDATE users SET active_session_jti=NULL, auth_revoked_at=clock_timestamp(), updated_at=NOW()
         WHERE id=$1 AND active_session_jti=$2",
    )
    .bind(authority.user_id)
    .bind(jti)
    .execute(&mut *tx)
    .await?;
    sqlx::query("DELETE FROM control_center_step_ups WHERE user_id=$1 AND token_hash=$2")
        .bind(authority.user_id)
        .bind(&authority.token_hash)
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        "INSERT INTO audit_logs (user_id, action, resource_type, metadata)
         VALUES ($1,'authority.session.logout','web_session','{}')",
    )
    .bind(authority.user_id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(json!({"success":true})))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StepUp {
    pub code: String,
}

/// A recent authenticator proof is required before delegated KYC decisions.
pub async fn step_up(
    State(state): State<AppState>,
    authority: WebAuthority,
    Json(body): Json<StepUp>,
) -> Result<Json<Value>, AppError> {
    authority.require("kyc.review")?;
    let code = body.code.trim();
    if code.len() != 6 || !code.bytes().all(|c| c.is_ascii_digit()) {
        return Err(AppError::Unauthorized(
            "A six-digit authenticator code is required".into(),
        ));
    }
    let attempts: i32 = sqlx::query_scalar(
        "UPDATE control_center_sessions SET
         step_up_attempts=CASE WHEN step_up_window_started_at<NOW()-INTERVAL '5 minutes'
         THEN 1 ELSE step_up_attempts+1 END,
         step_up_window_started_at=CASE WHEN step_up_window_started_at<NOW()-INTERVAL '5 minutes'
         THEN NOW() ELSE step_up_window_started_at END
         WHERE user_id=$1 AND token_hash=$2 AND revoked_at IS NULL AND expires_at>NOW()
         RETURNING step_up_attempts",
    )
    .bind(authority.user_id)
    .bind(&authority.token_hash)
    .fetch_one(&state.db)
    .await?;
    if attempts > 5 {
        return Err(AppError::Forbidden(
            "Authenticator verification temporarily locked".into(),
        ));
    }
    crate::auth::totp::verify_staff_totp_login(&state.db, authority.user_id, code).await?;
    sqlx::query(
        "INSERT INTO control_center_step_ups(user_id,token_hash,expires_at)
         VALUES($1,$2,NOW()+INTERVAL '5 minutes')
         ON CONFLICT(user_id,token_hash) DO UPDATE SET expires_at=EXCLUDED.expires_at",
    )
    .bind(authority.user_id)
    .bind(&authority.token_hash)
    .execute(&state.db)
    .await?;
    Ok(Json(json!({"success":true,"expires_in_seconds":300})))
}

#[derive(Deserialize)]
pub struct Page {
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

/// Read-only, allowlisted workspaces. Never expose admin credentials, session hashes,
/// audit internals, global payment mutations or customer messaging APIs here.
pub async fn collection(
    State(state): State<AppState>,
    authority: WebAuthority,
    Path(kind): Path<String>,
    Query(page): Query<Page>,
) -> Result<Json<Value>, AppError> {
    let (permission, query) = match kind.as_str() {
        "users" => (
            "user.view",
            "SELECT jsonb_build_object('id',id,'name',full_name,'role',role,'active',is_active) FROM users ORDER BY id LIMIT $1 OFFSET $2",
        ),
        "plants" => (
            "plant.view",
            "SELECT jsonb_build_object('id',id,'name',name,'city',city,'active',is_active) FROM rmc_plants ORDER BY id LIMIT $1 OFFSET $2",
        ),
        "orders" => (
            "order.view",
            "SELECT jsonb_build_object('id',id,'number',order_number,'plant_id',plant_id,'status',status) FROM orders ORDER BY id LIMIT $1 OFFSET $2",
        ),
        "support" => (
            "support.view",
            "SELECT jsonb_build_object('id',id,'subject',subject,'status',status,'created_at',created_at) FROM support_cases ORDER BY created_at DESC LIMIT $1 OFFSET $2",
        ),
        "service_enquiries" => (
            "support.view",
            "SELECT jsonb_build_object('id',id,'service_type',service_type,'status',status,'created_at',created_at) FROM customer_service_enquiries ORDER BY created_at DESC LIMIT $1 OFFSET $2",
        ),
        "rmc_rfq_leads" => (
            "support.view",
            "SELECT jsonb_build_object('id',id,'grade',grade,'quantity_m3',quantity_m3::DOUBLE PRECISION,'status',status,'outreach_status',outreach_status,'created_at',created_at) FROM rmc_rfq_leads ORDER BY created_at DESC LIMIT $1 OFFSET $2",
        ),
        "kyc" => (
            "kyc.view",
            "SELECT jsonb_build_object('customer_id',p.user_id,'customer',u.full_name,'verified_name',p.verified_name,'status',p.kyc_status,'updated_at',p.updated_at,'evidence_verified',EXISTS(SELECT 1 FROM customer_digilocker_sessions d WHERE d.user_id=p.user_id AND d.status='PENDING' AND d.verified_at IS NOT NULL)) FROM user_profiles p JOIN users u ON u.id=p.user_id WHERE u.role='customer' AND u.is_active AND p.kyc_status='pending' ORDER BY p.updated_at LIMIT $1 OFFSET $2",
        ),
        _ => return Err(AppError::NotFound("Authority workspace not found".into())),
    };
    authority.require(permission)?;
    let limit = page.limit.unwrap_or(25).clamp(1, 100);
    let offset = page.offset.unwrap_or(0);
    if !(0..=10000).contains(&offset) {
        return Err(AppError::BadRequest("Invalid page offset".into()));
    }
    let rows: Vec<Value> = sqlx::query_scalar(query)
        .bind(limit)
        .bind(offset)
        .fetch_all(&state.db)
        .await?;
    Ok(Json(json!({"items":rows,"limit":limit,"offset":offset})))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn delegated_permissions_never_include_platform_root_capabilities() {
        for forbidden in [
            "admin_access.manage",
            "session.view",
            "audit.view",
            "automation.manage",
            "reviewer_access.manage",
            "payment.manage",
            "owner.assign",
            "plant_owners.manage",
        ] {
            assert!(
                !is_delegable(forbidden),
                "{forbidden} must remain Central Admin only"
            );
        }
        assert!(is_delegable("kyc.review"));
        assert!(is_delegable("support.view"));
    }
}
