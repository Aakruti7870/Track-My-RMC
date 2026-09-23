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

        Ok(AuthUser {
            user_id: claims.sub,
            role: claims.role,
            phone: claims.phone,
            email: claims.email,
        })
    }
}
