use crate::{
    auth::jwt::{verify_token, Claims},
    error::AppError,
    state::AppState,
};
use axum::{
    async_trait,
    extract::{FromRef, FromRequestParts},
    http::{header::AUTHORIZATION, request::Parts},
};
use sqlx::Row;
use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct AuthUser {
    pub user_id: Uuid,
    pub role: String,
    pub phone: String,
    pub email: Option<String>,
}

#[async_trait]
impl<S> FromRequestParts<S> for AuthUser
where
    AppState: FromRef<S>,
    S: Send + Sync,
{
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let app_state = AppState::from_ref(state);
        let auth_header = parts.headers.get(AUTHORIZATION)
            .and_then(|h| h.to_str().ok())
            .ok_or_else(|| AppError::Unauthorized("Missing Authorization header".to_string()))?;

        let token = auth_header.strip_prefix("Bearer ")
            .ok_or_else(|| AppError::Unauthorized("Invalid Authorization format. Must be Bearer <token>".to_string()))?;

        let claims: Claims = verify_token(token, &app_state.config.jwt_secret)?;

        let row = sqlx::query(
            "SELECT is_active, auth_revoked_at FROM users WHERE id=$1"
        )
        .bind(claims.sub)
        .fetch_optional(&app_state.db)
        .await?
        .ok_or_else(|| AppError::Unauthorized("Account not found".to_string()))?;

        let is_active: bool = row.get("is_active");
        if !is_active {
            return Err(AppError::Forbidden("Account is inactive".to_string()));
        }

        let revoked_at: Option<chrono::DateTime<chrono::Utc>> = row.get("auth_revoked_at");
        if revoked_at.is_some_and(|ts| claims.iat as i64 <= ts.timestamp()) {
            return Err(AppError::Unauthorized("Session revoked".to_string()));
        }

        Ok(AuthUser {
            user_id: claims.sub,
            role: claims.role,
            phone: claims.phone,
            email: claims.email,
        })
    }
}

pub fn check_role(user: &AuthUser, allowed_roles: &[&str]) -> Result<(), AppError> {
    if allowed_roles.contains(&user.role.as_str()) {
        Ok(())
    } else {
        Err(AppError::Forbidden(format!(
            "Role '{}' is not authorized to access this resource",
            user.role
        )))
    }
}
