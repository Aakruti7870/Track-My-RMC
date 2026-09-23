use crate::{
    auth::{middleware::check_role, AuthUser},
    error::AppError,
    models::plant::CreatePlantRequest,
    repositories::plant_repo,
    state::AppState,
};
use axum::{
    extract::State,
    response::IntoResponse,
    Json,
};
use serde_json::json;

pub async fn create_plant(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Json(req): Json<CreatePlantRequest>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["owner", "admin"])?;
    let plant = plant_repo::create_plant(
        &state.db,
        auth_user.user_id,
        &req.name,
        &req.code,
        req.latitude,
        req.longitude,
        &req.address_line,
        &req.city,
        &req.state,
        &req.pincode,
        &req.contact_phone,
        req.contact_email.as_deref(),
        req.capacity_m3_per_hr.unwrap_or(60.0),
    )
    .await?;

    Ok(Json(json!({ "success": true, "plant": plant })))
}

pub async fn get_billing_overview(
    _auth_user: AuthUser,
) -> Result<impl IntoResponse, AppError> {
    Ok(Json(json!({
        "success": true,
        "plan": "enterprise_tier",
        "credits_remaining": 15000,
        "active_mixers": 12,
        "monthly_volume_m3": 4820.5
    })))
}
