use crate::{
    auth::{middleware::check_role, AuthUser},
    error::AppError,
    models::{
        challan::{SignChallanRequest, SubmitPodRequest},
        telemetry::LocationUpdateRequest,
    },
    repositories::dispatch_repo,
    services::{dispatch_service, tracking_service},
    state::AppState,
};
use axum::{
    extract::{Path, State},
    response::IntoResponse,
    Json,
};
use serde_json::json;
use uuid::Uuid;

pub async fn get_driver_trips(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["driver"])?;
    let trips = dispatch_repo::find_driver_active_trips(&state.db, auth_user.user_id).await?;
    Ok(Json(json!({ "success": true, "trips": trips })))
}

pub async fn update_location(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Json(payload): Json<LocationUpdateRequest>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["driver"])?;
    tracking_service::record_driver_location(&state, auth_user.user_id, payload).await?;
    Ok(Json(json!({ "success": true, "message": "Location updated" })))
}

pub async fn sign_challan(
    State(state): State<AppState>,
    Path(load_id): Path<Uuid>,
    Json(payload): Json<SignChallanRequest>,
) -> Result<impl IntoResponse, AppError> {
    dispatch_service::sign_digital_challan(&state, load_id, payload).await?;
    Ok(Json(json!({ "success": true, "message": "Challan signed" })))
}

pub async fn submit_pod(
    State(state): State<AppState>,
    Path(load_id): Path<Uuid>,
    Json(payload): Json<SubmitPodRequest>,
) -> Result<impl IntoResponse, AppError> {
    let pod = dispatch_service::complete_delivery_pod(&state, load_id, payload).await?;
    Ok(Json(json!({ "success": true, "pod": pod })))
}
