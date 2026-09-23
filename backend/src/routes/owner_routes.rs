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
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["owner", "admin"])?;

    let active_mixers: i64 = if auth_user.role == "admin" {
        sqlx::query_scalar("SELECT COUNT(*) FROM transit_mixers WHERE status <> 'inactive'")
            .fetch_one(&state.db)
            .await?
    } else {
        sqlx::query_scalar(
            "SELECT COUNT(*)
             FROM transit_mixers tm
             JOIN rmc_plants p ON p.id = tm.plant_id
             WHERE p.owner_id = $1 AND tm.status <> 'inactive'",
        )
        .bind(auth_user.user_id)
        .fetch_one(&state.db)
        .await?
    };

    let monthly_volume_m3: f64 = if auth_user.role == "admin" {
        sqlx::query_scalar(
            "SELECT COALESCE(SUM(total_quantity_m3), 0)::double precision
             FROM orders
             WHERE created_at >= date_trunc('month', CURRENT_DATE)",
        )
        .fetch_one(&state.db)
        .await?
    } else {
        sqlx::query_scalar(
            "SELECT COALESCE(SUM(o.total_quantity_m3), 0)::double precision
             FROM orders o
             JOIN rmc_plants p ON p.id = o.plant_id
             WHERE p.owner_id = $1
               AND o.created_at >= date_trunc('month', CURRENT_DATE)",
        )
        .bind(auth_user.user_id)
        .fetch_one(&state.db)
        .await?
    };

    Ok(Json(json!({
        "success": true,
        "plan": "not_configured",
        "credits_remaining": null,
        "active_mixers": active_mixers,
        "monthly_volume_m3": monthly_volume_m3
    })))
}
