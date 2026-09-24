use crate::{
    auth::{middleware::check_role, AuthUser},
    error::AppError,
    models::order::{AssignLoadRequest, UpdateOrderStatusRequest},
    repositories::{dispatch_repo, order_repo},
    state::AppState,
};
use axum::{
    extract::{Path, State},
    response::IntoResponse,
    Json,
};
use serde_json::json;
use uuid::Uuid;

async fn ensure_plant_access(state: &AppState, auth_user: &AuthUser, plant_id: Uuid) -> Result<(), AppError> {
    if matches!(auth_user.role.as_str(), "owner" | "admin") {
        return Ok(());
    }
    let allowed: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM plant_staff WHERE plant_id = $1 AND user_id = $2 AND is_active = TRUE)",
    )
    .bind(plant_id)
    .bind(auth_user.user_id)
    .fetch_one(&state.db)
    .await?;
    if !allowed {
        return Err(AppError::Forbidden("You are not assigned to this plant".to_string()));
    }
    Ok(())
}

pub async fn get_plant_fleet(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(plant_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["dispatcher", "owner", "fleet_manager", "admin"])?;
    ensure_plant_access(&state, &auth_user, plant_id).await?;
    let fleet = dispatch_repo::list_plant_mixers(&state.db, plant_id).await?;
    Ok(Json(json!({ "success": true, "fleet": fleet })))
}

pub async fn assign_load(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Json(payload): Json<AssignLoadRequest>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["dispatcher", "owner", "admin"])?;
    let plant_id: Uuid = sqlx::query_scalar("SELECT plant_id FROM orders WHERE id = $1")
        .bind(payload.order_id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("Order not found".to_string()))?;
    ensure_plant_access(&state, &auth_user, plant_id).await?;
    let load = dispatch_repo::assign_order_load(
        &state.db,
        payload.order_id,
        payload.load_number,
        payload.mixer_id,
        payload.driver_id,
        payload.quantity_m3,
    )
    .await?;

    Ok(Json(json!({ "success": true, "load": load })))
}

pub async fn update_order_status(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(order_id): Path<Uuid>,
    Json(payload): Json<UpdateOrderStatusRequest>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["dispatcher", "operator", "owner", "admin"])?;
    let plant_id: Uuid = sqlx::query_scalar("SELECT plant_id FROM orders WHERE id = $1")
        .bind(order_id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("Order not found".to_string()))?;
    ensure_plant_access(&state, &auth_user, plant_id).await?;
    order_repo::update_order_status(&state.db, order_id, &payload.status).await?;
    Ok(Json(json!({ "success": true, "status": payload.status })))
}
