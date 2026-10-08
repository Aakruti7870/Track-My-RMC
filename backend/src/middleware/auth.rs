use crate::{
    auth::jwt::{verify_token, Claims},
    error::AppError,
    state::AppState,
};
use chrono::{DateTime, Utc};
use axum::{
    async_trait,
    extract::{FromRef, FromRequestParts},
    http::{header::AUTHORIZATION, request::Parts},
};
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
        let auth_header = parts
            .headers
            .get(AUTHORIZATION)
            .and_then(|h| h.to_str().ok())
            .ok_or_else(|| AppError::Unauthorized("Missing Authorization header".to_string()))?;

        let token = if auth_header.starts_with("Bearer ") {
            &auth_header[7..]
        } else {
            return Err(AppError::Unauthorized(
                "Invalid Authorization format. Must be Bearer <token>".to_string(),
            ));
        };

        let claims: Claims = verify_token(token, &app_state.config.jwt_secret)?;

        // Enforce account deactivation and logout revocation on every authenticated request.
        // A valid signature alone must not keep a logged-out session alive.
        let account: Option<(bool, Option<DateTime<Utc>>)> = sqlx::query_as(
            "SELECT is_active, auth_revoked_at FROM users WHERE id = $1"
        )
        .bind(claims.sub)
        .fetch_optional(&app_state.db)
        .await?;

        let (is_active, auth_revoked_at) = account
            .ok_or_else(|| AppError::Unauthorized("Invalid or expired token".to_string()))?;
        if !is_active {
            return Err(AppError::Forbidden("Account is inactive. Contact support.".to_string()));
        }
        if auth_revoked_at
            .map(|revoked_at| claims.iat as i64 <= revoked_at.timestamp())
            .unwrap_or(false)
        {
            return Err(AppError::Unauthorized("Session has been revoked. Please sign in again.".to_string()));
        }

        Ok(AuthUser {
            user_id: claims.sub,
            role: claims.role,
            phone: claims.phone,
            email: claims.email,
        })
    }
}
