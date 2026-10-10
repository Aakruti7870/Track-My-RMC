use crate::{
    auth::{middleware::check_role, AuthUser},
    error::AppError,
    state::AppState,
};
use axum::{extract::State, response::IntoResponse, Json};
use serde_json::json;

#[derive(Debug, serde::Deserialize)]
pub struct AdminOtpLoginRequest {
    pub email: String,
    pub otp: String,
}

pub async fn admin_login(
    Json(payload): Json<AdminOtpLoginRequest>,
) -> Result<axum::response::Response, AppError> {
    // Do not hard-code or disclose a privileged administrator email in source.
    // This endpoint remains fail-closed until the admin UI uses the complete
    // challenge-bound email OTP + TOTP/recovery flow.
    let _ = payload;
    Err(AppError::Forbidden(
        "Administrator login is temporarily unavailable until multi-factor verification is completed.".to_string(),
    ))
}

pub async fn portal_overview(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["admin"])?;

    let user_count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM users")
        .fetch_one(&state.db)
        .await?;

    let plant_count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM rmc_plants")
        .fetch_one(&state.db)
        .await?;

    let order_count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM orders")
        .fetch_one(&state.db)
        .await?;

    Ok(Json(json!({
        "success": true,
        "overview": {
            "total_users": user_count.0,
            "total_plants": plant_count.0,
            "total_orders": order_count.0,
            "engine_status": "active"
        }
    })))
}
