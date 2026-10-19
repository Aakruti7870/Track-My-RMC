use crate::{
    auth::{middleware::check_role, AuthUser},
    error::AppError,
    models::order::{AssignLoadRequest, UpdateOrderStatusRequest},
    repositories::dispatch_repo,
    state::AppState,
};
use axum::{
    extract::{Path, State},
    response::IntoResponse,
    Json,
};
use serde_json::json;
use uuid::Uuid;

async fn ensure_plant_access(
    state: &AppState,
    auth_user: &AuthUser,
    plant_id: Uuid,
) -> Result<(), AppError> {
    super::business_routes::ensure_plant_staff_or_owner(state, auth_user, plant_id).await
}

pub async fn get_plant_fleet(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(plant_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    check_role(
        &auth_user,
        &["dispatcher", "owner", "fleet_manager", "admin"],
    )?;
    ensure_plant_access(&state, &auth_user, plant_id).await?;
    super::staff_module_permissions::require(&state, &auth_user, plant_id, "fleet_availability", super::staff_module_permissions::Action::View).await?;
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
    super::staff_module_permissions::require(&state, &auth_user, plant_id, "dispatch_queue", super::staff_module_permissions::Action::Edit).await?;
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
    let current: String = sqlx::query_scalar("SELECT status FROM orders WHERE id=$1")
        .bind(order_id)
        .fetch_one(&state.db)
        .await?;
    if current != payload.status {
        return Err(AppError::Conflict("Use the dedicated approval, production, load-dispatch or delivery workflow to change order status".into()));
    }
    Ok(Json(json!({ "success": true, "status": current })))
}
