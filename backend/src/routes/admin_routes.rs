use crate::{
    auth::{middleware::check_role, AuthUser},
    error::AppError,
    models::user::LoginRequest,
    services::auth_service,
    state::AppState,
};
use axum::{
    extract::State,
    response::IntoResponse,
    Json,
};
use serde_json::json;

pub async fn admin_login(
    State(state): State<AppState>,
    Json(payload): Json<LoginRequest>,
) -> Result<impl IntoResponse, AppError> {
    let auth_res = auth_service::login(&state, payload).await?;
    if auth_res.role != "admin" {
        return Err(AppError::Forbidden("Administrative privileges required".to_string()));
    }
    Ok(Json(auth_res))
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
