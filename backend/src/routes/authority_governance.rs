//! Super Admin-owned Authority invitations, delegated permissions, and revocation.
//! Never upgrades an existing customer, staff member, or administrator to Authority.
use crate::{
    auth::{authority::is_delegable, control_center::WebAdmin},
    error::AppError,
    routes::control_center_routes::require_recent_step_up,
    state::AppState,
};
use axum::{extract::State, http::HeaderMap, Json};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::Row;
use uuid::Uuid;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AuthorityGrant {
    pub email: String,
    pub full_name: String,
    pub enabled: bool,
    pub permissions: Vec<String>,
    pub reason: String,
}

fn validate_grants(grants: &[String]) -> Result<(), AppError> {
    if grants.len() > 6
        || grants.iter().any(|p| !is_delegable(p))
        || grants.iter().enumerate().any(|(i, p)| grants[..i].contains(p))
    {
        return Err(AppError::BadRequest(
            "Authority permissions must be distinct, explicitly delegable capabilities".into(),
        ));
    }
    Ok(())
}

pub async fn list(
    State(state): State<AppState>,
    admin: WebAdmin,
) -> Result<Json<Value>, AppError> {
    admin.require("admin_access.manage")?;
    let rows = sqlx::query(
        "SELECT u.id,u.email,u.full_name,u.is_active,a.approved,a.permissions,
                EXISTS(SELECT 1 FROM user_totp_credentials t
                       WHERE t.user_id=u.id AND t.is_enabled) AS mfa_enrolled
         FROM users u LEFT JOIN control_center_access a ON a.user_id=u.id
         WHERE u.role='authority' ORDER BY u.created_at DESC LIMIT 100",
    )
    .fetch_all(&state.db)
    .await?;
    let accounts: Vec<Value> = rows
        .iter()
        .map(|r| {
            let raw: Option<Vec<String>> = r.get("permissions");
            let grants: Vec<String> = raw
                .unwrap_or_default()
                .into_iter()
                .filter(|p| is_delegable(p))
                .collect();
            json!({
                "id":r.get::<Uuid,_>("id"),
                "email":r.get::<Option<String>,_>("email"),
                "full_name":r.get::<String,_>("full_name"),
                "enabled":r.get::<bool,_>("is_active") && r.get::<Option<bool>,_>("approved")==Some(true),
                "mfa_enrolled":r.get::<bool,_>("mfa_enrolled"),
                "permissions":grants,
            })
        })
        .collect();
    Ok(Json(json!({"success":true,"accounts":accounts})))
}

pub async fn upsert(
    State(state): State<AppState>,
    admin: WebAdmin,
    headers: HeaderMap,
    Json(payload): Json<AuthorityGrant>,
) -> Result<Json<Value>, AppError> {
    admin.require("admin_access.manage")?;
    require_recent_step_up(&state, &admin, &headers).await?;
    let email = payload.email.trim().to_ascii_lowercase();
    let name = payload.full_name.trim();
    if email.len() < 5
        || email.len() > 254
        || !email.contains('@')
        || name.len() < 2
        || name.len() > 100
        || payload.reason.trim().len() < 10
        || payload.reason.len() > 500
    {
        return Err(AppError::BadRequest("Invalid Authority identity or audit reason".into()));
    }
    validate_grants(&payload.permissions)?;
    let mut tx = state.db.begin().await?;
    let existing: Option<(Uuid, String)> = sqlx::query_as(
        "SELECT id,role FROM users WHERE LOWER(email)=$1 FOR UPDATE",
    )
    .bind(&email)
    .fetch_optional(&mut *tx)
    .await?;
    let id = if let Some((id, role)) = existing {
        if role != "authority" {
            return Err(AppError::Forbidden(
                "An existing account cannot be promoted or reassigned to Authority".into(),
            ));
        }
        sqlx::query("UPDATE users SET full_name=$2,is_active=$3,updated_at=NOW() WHERE id=$1")
            .bind(id)
            .bind(name)
            .bind(payload.enabled)
            .execute(&mut *tx)
            .await?;
        id
    } else {
        let id = Uuid::new_v4();
        // No password, mobile phone or public registration path is issued.
        // Nullable phone is enabled by migration 0011.
        sqlx::query(
            "INSERT INTO users(id,phone,email,hashed_password,full_name,role,is_active,is_verified)
             VALUES($1,NULL,$2,'!web-only-no-password!',$3,'authority',$4,FALSE)",
        )
        .bind(id)
        .bind(&email)
        .bind(name)
        .bind(payload.enabled)
        .execute(&mut *tx)
        .await?;
        id
    };
    sqlx::query(
        "INSERT INTO control_center_access(user_id,approved,permissions)
         VALUES($1,$2,$3)
         ON CONFLICT (user_id) DO UPDATE
         SET approved=EXCLUDED.approved,permissions=EXCLUDED.permissions,updated_at=NOW()",
    )
    .bind(id)
    .bind(payload.enabled)
    .bind(&payload.permissions)
    .execute(&mut *tx)
    .await?;
    // Every policy change invalidates already-issued sessions. This prevents
    // stale grants from continuing after a delegation is narrowed or revoked.
    sqlx::query(
        "UPDATE control_center_sessions SET revoked_at=clock_timestamp()
         WHERE user_id=$1 AND revoked_at IS NULL",
    )
    .bind(id)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "UPDATE users SET active_session_jti=NULL,auth_revoked_at=clock_timestamp(),
         updated_at=NOW() WHERE id=$1",
    )
    .bind(id)
    .execute(&mut *tx)
    .await?;
    sqlx::query("DELETE FROM account_refresh_tokens WHERE user_id=$1")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM control_center_step_ups WHERE user_id=$1")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        "INSERT INTO audit_logs(user_id,action,resource_type,resource_id,metadata)
         VALUES($1,'authority.access.updated','authority',$2,$3)",
    )
    .bind(admin.user_id)
    .bind(id.to_string())
    .bind(json!({
        "enabled":payload.enabled,
        "permissions":payload.permissions,
        "reason":payload.reason.trim(),
    }))
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(json!({
        "success":true,
        "authority_id":id,
        "enabled":payload.enabled,
        "message":"Authority policy saved. Any previous session was revoked.",
    })))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn restricted_permission_grants_fail_closed() {
        assert!(validate_grants(&["support.view".into(),"kyc.review".into()]).is_ok());
        assert!(validate_grants(&["admin_access.manage".into()]).is_err());
        assert!(validate_grants(&["kyc.review".into(),"kyc.review".into()]).is_err());
    }
}
