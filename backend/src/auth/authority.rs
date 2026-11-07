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
            return Err(AppError::Forbidden("Dedicated Authority web session required".into()));
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
            "SELECT jsonb_build_object('customer_id',p.user_id,'customer',u.full_name,'status',p.kyc_status,'updated_at',p.updated_at) FROM user_profiles p JOIN users u ON u.id=p.user_id WHERE u.role='customer' AND u.is_active AND p.kyc_status='pending' ORDER BY p.updated_at LIMIT $1 OFFSET $2",
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
            "admin_access.manage", "session.view", "audit.view",
            "automation.manage", "reviewer_access.manage",
            "payment.manage", "owner.assign", "plant_owners.manage",
        ] {
            assert!(!is_delegable(forbidden), "{forbidden} must remain Central Admin only");
        }
        assert!(is_delegable("kyc.review"));
        assert!(is_delegable("support.view"));
    }
}
