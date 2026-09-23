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

pub async fn get_plant_fleet(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(plant_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["dispatcher", "owner", "fleet_manager", "admin"])?;
    let fleet = dispatch_repo::list_plant_mixers(&state.db, plant_id).await?;
    Ok(Json(json!({ "success": true, "fleet": fleet })))
}

pub async fn assign_load(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Json(payload): Json<AssignLoadRequest>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["dispatcher", "owner", "admin"])?;
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
    order_repo::update_order_status(&state.db, order_id, &payload.status).await?;
    Ok(Json(json!({ "success": true, "status": payload.status })))
}
