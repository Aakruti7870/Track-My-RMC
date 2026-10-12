use crate::{
    auth::{middleware::check_role, AuthUser},
    error::AppError,
    models::plant::CreatePlantRequest,
    repositories::plant_repo,
    state::AppState,
};
use axum::{extract::State, response::IntoResponse, Json};
use serde_json::json;

/// Lists only the plants visible to the authenticated account. This matches
/// the frontend's /master/my-plants selector without granting cross-plant access.
pub async fn my_plants(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<impl IntoResponse, AppError> {
    check_role(
        &auth_user,
        &[
            "owner",
            "admin",
            "dispatcher",
            "operator",
            "supervisor",
            "quality_engineer",
            "store_manager",
            "accountant",
            "fleet_manager",
        ],
    )?;

    let rows: Vec<(uuid::Uuid, String, String)> = match auth_user.role.as_str() {
        "admin" => {
            sqlx::query_as(
                "SELECT p.id, p.name, p.city FROM rmc_plants p WHERE p.is_active = TRUE AND NOT EXISTS (SELECT 1 FROM play_review_fixtures f WHERE f.plant_id = p.id) ORDER BY p.name",
            )
            .fetch_all(&state.db)
            .await?
        }
        "owner" => {
            sqlx::query_as(
                "SELECT id, name, city FROM rmc_plants WHERE owner_id = $1 AND is_active = TRUE ORDER BY name",
            )
            .bind(auth_user.user_id)
            .fetch_all(&state.db)
            .await?
        }
        _ => {
            sqlx::query_as(
                "SELECT p.id, p.name, p.city
                 FROM rmc_plants p
                 INNER JOIN plant_staff ps ON ps.plant_id = p.id
                 WHERE ps.user_id = $1 AND ps.is_active = TRUE AND p.is_active = TRUE
                 ORDER BY p.name",
            )
            .bind(auth_user.user_id)
            .fetch_all(&state.db)
            .await?
        }
    };

    let plants: Vec<_> = rows
        .into_iter()
        .map(|(id, name, city)| json!({ "id": id, "name": name, "city": city }))
        .collect();

    Ok(Json(json!({ "success": true, "plants": plants })))
}

pub async fn list_owner_plants(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["owner", "admin"])?;

    // Scope owners to their own plants; platform admins may view all plants.
    let plants = if auth_user.role == "admin" {
        sqlx::query_as::<_, crate::models::plant::RmcPlant>(
            "SELECT p.id, p.owner_id, p.name, p.code, p.latitude, p.longitude, p.address_line, p.city, p.state, p.pincode, p.contact_phone, p.contact_email, p.capacity_m3_per_hr, p.rating, p.is_active, p.created_at, p.updated_at FROM rmc_plants p WHERE NOT EXISTS (SELECT 1 FROM play_review_fixtures f WHERE f.plant_id = p.id) ORDER BY p.created_at DESC",
        )
        .fetch_all(&state.db)
        .await?
    } else {
        sqlx::query_as::<_, crate::models::plant::RmcPlant>(
            "SELECT id, owner_id, name, code, latitude, longitude, address_line, city, state, pincode, contact_phone, contact_email, capacity_m3_per_hr, rating, is_active, created_at, updated_at FROM rmc_plants WHERE owner_id = $1 ORDER BY created_at DESC",
        )
        .bind(auth_user.user_id)
        .fetch_all(&state.db)
        .await?
    };

    Ok(Json(json!({ "success": true, "plants": plants })))
}

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
        sqlx::query_scalar("SELECT COUNT(*) FROM transit_mixers tm WHERE tm.status <> 'inactive' AND NOT EXISTS (SELECT 1 FROM play_review_fixtures f WHERE f.mixer_id = tm.id)")
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
            "SELECT COALESCE(SUM(o.total_quantity_m3), 0)::double precision
             FROM orders o
             WHERE o.created_at >= date_trunc('month', CURRENT_DATE)
               AND NOT EXISTS (SELECT 1 FROM play_review_fixtures f WHERE f.order_id = o.id)",
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
