use crate::{
    auth::{middleware::check_role, AuthUser},
    error::AppError,
    state::AppState,
};
use axum::{
    extract::{Path, State},
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;

async fn ensure_plant_staff_or_owner(
    state: &AppState,
    auth_user: &AuthUser,
    plant_id: Uuid,
) -> Result<(), AppError> {
    if auth_user.role == "admin" {
        return Ok(());
    }
    if auth_user.role == "owner" || auth_user.role == "plant_owner" {
        let is_owner: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM rmc_plants WHERE id = $1 AND owner_id = $2)",
        )
        .bind(plant_id)
        .bind(auth_user.user_id)
        .fetch_one(&state.db)
        .await?;
        if is_owner {
            return Ok(());
        }
    }
    let is_staff: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM plant_staff WHERE plant_id = $1 AND user_id = $2 AND is_active = TRUE)",
    )
    .bind(plant_id)
    .bind(auth_user.user_id)
    .fetch_one(&state.db)
    .await?;
    if !is_staff {
        return Err(AppError::Forbidden(
            "You are not authorized for this plant".to_string(),
        ));
    }
    Ok(())
}

#[derive(Debug, Deserialize, Serialize)]
pub struct CreateMaterialPayload {
    pub name: String,
    pub material_type: String,
    pub unit: Option<String>,
    pub current_stock: Option<f64>,
    pub minimum_stock: Option<f64>,
}

pub async fn list_materials(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(plant_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    ensure_plant_staff_or_owner(&state, &auth_user, plant_id).await?;

    let rows = sqlx::query!(
        "SELECT id, name, material_type, unit, current_stock, minimum_stock FROM plant_materials WHERE plant_id = $1 ORDER BY name",
        plant_id
    )
    .fetch_all(&state.db)
    .await?;

    let materials: Vec<_> = rows
        .into_iter()
        .map(|r| {
            json!({
                "id": r.id,
                "name": r.name,
                "material_type": r.material_type,
                "unit": r.unit,
                "current_stock": r.current_stock,
                "minimum_stock": r.minimum_stock
            })
        })
        .collect();

    Ok(Json(json!({ "success": true, "materials": materials })))
}

pub async fn create_material(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(plant_id): Path<Uuid>,
    Json(payload): Json<CreateMaterialPayload>,
) -> Result<impl IntoResponse, AppError> {
    check_role(
        &auth_user,
        &["owner", "plant_owner", "admin", "store_manager", "supervisor"],
    )?;
    ensure_plant_staff_or_owner(&state, &auth_user, plant_id).await?;

    let unit = payload.unit.unwrap_or_else(|| "kg".to_string());
    let current = payload.current_stock.unwrap_or(0.0);
    let minimum = payload.minimum_stock.unwrap_or(0.0);

    let id = sqlx::query_scalar!(
        r#"
        INSERT INTO plant_materials (plant_id, name, material_type, unit, current_stock, minimum_stock)
        VALUES ($1, $2, $3, $4, $5::numeric, $6::numeric)
        RETURNING id
        "#,
        plant_id,
        payload.name,
        payload.material_type,
        unit,
        bigdecimal::BigDecimal::try_from(current).unwrap_or_default(),
        bigdecimal::BigDecimal::try_from(minimum).unwrap_or_default()
    )
    .fetch_one(&state.db)
    .await?;

    Ok(Json(json!({ "success": true, "id": id, "message": "Material created" })))
}

#[derive(Debug, Deserialize, Serialize)]
pub struct AdjustMaterialPayload {
    pub quantity_change: f64,
    pub reason: String,
}

pub async fn adjust_material_stock(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path((plant_id, material_id)): Path<(Uuid, Uuid)>,
    Json(payload): Json<AdjustMaterialPayload>,
) -> Result<impl IntoResponse, AppError> {
    check_role(
        &auth_user,
        &["owner", "plant_owner", "admin", "store_manager", "supervisor"],
    )?;
    ensure_plant_staff_or_owner(&state, &auth_user, plant_id).await?;

    let change = bigdecimal::BigDecimal::try_from(payload.quantity_change).unwrap_or_default();

    let mut tx = state.db.begin().await?;

    sqlx::query!(
        r#"
        UPDATE plant_materials
        SET current_stock = current_stock + $1::numeric, updated_at = NOW()
        WHERE id = $2 AND plant_id = $3
        "#,
        change,
        material_id,
        plant_id
    )
    .execute(&mut *tx)
    .await?;

    sqlx::query!(
        r#"
        INSERT INTO plant_material_adjustments (material_id, adjusted_by, quantity_change, reason)
        VALUES ($1, $2, $3::numeric, $4)
        "#,
        material_id,
        auth_user.user_id,
        change,
        payload.reason
    )
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    Ok(Json(json!({ "success": true, "message": "Stock adjusted successfully" })))
}

#[derive(Debug, Deserialize, Serialize)]
pub struct CreateVehiclePayload {
    pub registration_number: String,
    pub capacity_m3: Option<f64>,
    pub driver_id: Option<Uuid>,
}

pub async fn list_vehicles(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(plant_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    ensure_plant_staff_or_owner(&state, &auth_user, plant_id).await?;

    let rows = sqlx::query!(
        r#"
        SELECT m.id, m.registration_number, m.capacity_m3, m.status, m.driver_id,
               u.full_name as driver_name, u.phone as driver_phone
        FROM transit_mixers m
        LEFT JOIN users u ON u.id = m.driver_id
        WHERE m.plant_id = $1
        ORDER BY m.registration_number
        "#,
        plant_id
    )
    .fetch_all(&state.db)
    .await?;

    let vehicles: Vec<_> = rows
        .into_iter()
        .map(|r| {
            json!({
                "id": r.id,
                "registration_number": r.registration_number,
                "capacity_m3": r.capacity_m3,
                "status": r.status,
                "driver_id": r.driver_id,
                "driver_name": r.driver_name,
                "driver_phone": r.driver_phone
            })
        })
        .collect();

    Ok(Json(json!({ "success": true, "vehicles": vehicles })))
}

pub async fn create_vehicle(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(plant_id): Path<Uuid>,
    Json(payload): Json<CreateVehiclePayload>,
) -> Result<impl IntoResponse, AppError> {
    check_role(
        &auth_user,
        &["owner", "plant_owner", "admin", "fleet_manager", "dispatcher"],
    )?;
    ensure_plant_staff_or_owner(&state, &auth_user, plant_id).await?;

    let cap = payload.capacity_m3.unwrap_or(6.0);

    let id = sqlx::query_scalar!(
        r#"
        INSERT INTO transit_mixers (plant_id, registration_number, capacity_m3, driver_id, status)
        VALUES ($1, $2, $3::numeric, $4, 'idle')
        RETURNING id
        "#,
        plant_id,
        payload.registration_number,
        bigdecimal::BigDecimal::try_from(cap).unwrap_or_default(),
        payload.driver_id
    )
    .fetch_one(&state.db)
    .await?;

    Ok(Json(json!({ "success": true, "id": id, "message": "Vehicle added" })))
}

#[derive(Debug, Deserialize, Serialize)]
pub struct UpdateVehicleStatusPayload {
    pub status: String,
}

pub async fn update_vehicle_status(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path((plant_id, vehicle_id)): Path<(Uuid, Uuid)>,
    Json(payload): Json<UpdateVehicleStatusPayload>,
) -> Result<impl IntoResponse, AppError> {
    check_role(
        &auth_user,
        &["owner", "plant_owner", "admin", "fleet_manager", "dispatcher"],
    )?;
    ensure_plant_staff_or_owner(&state, &auth_user, plant_id).await?;

    sqlx::query!(
        "UPDATE transit_mixers SET status = $1 WHERE id = $2 AND plant_id = $3",
        payload.status,
        vehicle_id,
        plant_id
    )
    .execute(&state.db)
    .await?;

    Ok(Json(json!({ "success": true, "message": "Vehicle status updated" })))
}

#[derive(Debug, Deserialize, Serialize)]
pub struct AddStaffPayload {
    pub user_id: Uuid,
    pub role: String,
}

pub async fn add_plant_staff(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(plant_id): Path<Uuid>,
    Json(payload): Json<AddStaffPayload>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["owner", "plant_owner", "admin"])?;
    ensure_plant_staff_or_owner(&state, &auth_user, plant_id).await?;

    sqlx::query!(
        r#"
        INSERT INTO plant_staff (plant_id, user_id, role, is_active)
        VALUES ($1, $2, $3, TRUE)
        ON CONFLICT (plant_id, user_id) DO UPDATE SET role = EXCLUDED.role, is_active = TRUE
        "#,
        plant_id,
        payload.user_id,
        payload.role
    )
    .execute(&state.db)
    .await?;

    Ok(Json(json!({ "success": true, "message": "Staff member assigned" })))
}

pub async fn suspend_plant_staff(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path((plant_id, user_id)): Path<(Uuid, Uuid)>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["owner", "plant_owner", "admin"])?;
    ensure_plant_staff_or_owner(&state, &auth_user, plant_id).await?;

    sqlx::query!(
        "UPDATE plant_staff SET is_active = FALSE WHERE plant_id = $1 AND user_id = $2",
        plant_id,
        user_id
    )
    .execute(&state.db)
    .await?;

    Ok(Json(json!({ "success": true, "message": "Staff member suspended" })))
}

pub async fn activate_plant_staff(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path((plant_id, user_id)): Path<(Uuid, Uuid)>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["owner", "plant_owner", "admin"])?;
    ensure_plant_staff_or_owner(&state, &auth_user, plant_id).await?;

    sqlx::query!(
        "UPDATE plant_staff SET is_active = TRUE WHERE plant_id = $1 AND user_id = $2",
        plant_id,
        user_id
    )
    .execute(&state.db)
    .await?;

    Ok(Json(json!({ "success": true, "message": "Staff member activated" })))
}

pub async fn list_plant_customers(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(plant_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    ensure_plant_staff_or_owner(&state, &auth_user, plant_id).await?;

    let rows = sqlx::query!(
        r#"
        SELECT DISTINCT u.id, u.full_name, u.phone, u.email,
               COUNT(o.id) as total_orders
        FROM orders o
        INNER JOIN users u ON u.id = o.customer_id
        WHERE o.plant_id = $1
        GROUP BY u.id, u.full_name, u.phone, u.email
        ORDER BY u.full_name
        "#,
        plant_id
    )
    .fetch_all(&state.db)
    .await?;

    let customers: Vec<_> = rows
        .into_iter()
        .map(|r| {
            json!({
                "id": r.id,
                "name": r.full_name,
                "phone": r.phone,
                "email": r.email,
                "total_orders": r.total_orders
            })
        })
        .collect();

    Ok(Json(json!({ "success": true, "customers": customers })))
}
