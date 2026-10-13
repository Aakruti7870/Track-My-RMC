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
use sqlx::Row;
use uuid::Uuid;

pub async fn list_order_loads(
    State(state): State<AppState>,
    _auth_user: AuthUser,
    Path(order_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    let loads = sqlx::query(
        r#"
        SELECT l.id, l.order_id, l.load_number, l.quantity_m3, l.status,
               l.mixer_id, l.driver_id, l.batch_started_at, l.batch_completed_at,
               l.dispatched_at, l.arrived_at, l.pour_started_at, l.pour_completed_at,
               l.returned_at, l.created_at,
               m.registration_number as mixer_number,
               u.full_name as driver_name, u.phone as driver_phone
        FROM order_loads l
        LEFT JOIN transit_mixers m ON m.id = l.mixer_id
        LEFT JOIN users u ON u.id = l.driver_id
        WHERE l.order_id = $1
        ORDER BY l.load_number
        "#,
    )
    .bind(order_id)
    .fetch_all(&state.db)
    .await?;

    let result: Vec<_> = loads
        .into_iter()
        .map(|l| {
            let id: Uuid = l.get("id");
            let order_id: Uuid = l.get("order_id");
            let load_number: i32 = l.get("load_number");
            let quantity_m3: bigdecimal::BigDecimal = l.get("quantity_m3");
            let status: String = l.get("status");
            let mixer_id: Option<Uuid> = l.get("mixer_id");
            let mixer_number: Option<String> = l.get("mixer_number");
            let driver_id: Option<Uuid> = l.get("driver_id");
            let driver_name: Option<String> = l.get("driver_name");
            let driver_phone: Option<String> = l.get("driver_phone");
            let dispatched_at: Option<chrono::DateTime<chrono::Utc>> = l.get("dispatched_at");
            let arrived_at: Option<chrono::DateTime<chrono::Utc>> = l.get("arrived_at");
            let created_at: chrono::DateTime<chrono::Utc> = l.get("created_at");

            json!({
                "id": id,
                "order_id": order_id,
                "load_number": load_number,
                "quantity_m3": quantity_m3,
                "status": status,
                "mixer_id": mixer_id,
                "mixer_number": mixer_number,
                "driver_id": driver_id,
                "driver_name": driver_name,
                "driver_phone": driver_phone,
                "dispatched_at": dispatched_at,
                "arrived_at": arrived_at,
                "created_at": created_at
            })
        })
        .collect();

    Ok(Json(json!({ "success": true, "loads": result })))
}

#[derive(Debug, Deserialize, Serialize)]
pub struct CreateLoadPayload {
    pub quantity_m3: f64,
    pub mixer_id: Option<Uuid>,
    pub driver_id: Option<Uuid>,
}

pub async fn create_order_load(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(order_id): Path<Uuid>,
    Json(payload): Json<CreateLoadPayload>,
) -> Result<impl IntoResponse, AppError> {
    check_role(
        &auth_user,
        &["dispatcher", "supervisor", "owner", "plant_owner", "admin"],
    )?;

    let max_load: Option<i32> =
        sqlx::query_scalar("SELECT MAX(load_number) FROM order_loads WHERE order_id = $1")
            .bind(order_id)
            .fetch_one(&state.db)
            .await?;

    let next_load_number = max_load.unwrap_or(0) + 1;

    let id: Uuid = sqlx::query_scalar(
        r#"
        INSERT INTO order_loads (order_id, load_number, mixer_id, driver_id, quantity_m3, status)
        VALUES ($1, $2, $3, $4, $5::numeric, 'planned')
        RETURNING id
        "#,
    )
    .bind(order_id)
    .bind(next_load_number)
    .bind(payload.mixer_id)
    .bind(payload.driver_id)
    .bind(payload.quantity_m3)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(json!({
        "success": true,
        "load_id": id,
        "load_number": next_load_number,
        "message": "Order load created"
    })))
}

#[derive(Debug, Deserialize, Serialize)]
pub struct AssignLoadPayload {
    pub vehicle_id: Option<Uuid>,
    pub mixer_id: Option<Uuid>,
    pub driver_id: Option<Uuid>,
}

pub async fn assign_load_mixer_driver(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(load_id): Path<Uuid>,
    Json(payload): Json<AssignLoadPayload>,
) -> Result<impl IntoResponse, AppError> {
    check_role(
        &auth_user,
        &[
            "dispatcher",
            "fleet_manager",
            "owner",
            "plant_owner",
            "admin",
        ],
    )?;

    let target_mixer = payload.mixer_id.or(payload.vehicle_id);

    sqlx::query(
        "UPDATE order_loads SET mixer_id = COALESCE($1, mixer_id), driver_id = COALESCE($2, driver_id) WHERE id = $3",
    )
    .bind(target_mixer)
    .bind(payload.driver_id)
    .bind(load_id)
    .execute(&state.db)
    .await?;

    Ok(Json(
        json!({ "success": true, "message": "Load assignment updated" }),
    ))
}

pub async fn prepare_load(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(load_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    check_role(
        &auth_user,
        &[
            "dispatcher",
            "operator",
            "supervisor",
            "owner",
            "plant_owner",
            "admin",
        ],
    )?;

    sqlx::query("UPDATE order_loads SET status = 'batching' WHERE id = $1")
        .bind(load_id)
        .execute(&state.db)
        .await?;

    Ok(Json(
        json!({ "success": true, "message": "Load prepared for batching" }),
    ))
}

pub async fn dispatch_load(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(load_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    check_role(
        &auth_user,
        &["dispatcher", "supervisor", "owner", "plant_owner", "admin"],
    )?;

    sqlx::query(
        "UPDATE order_loads SET status = 'dispatched', dispatched_at = NOW() WHERE id = $1",
    )
    .bind(load_id)
    .execute(&state.db)
    .await?;

    Ok(Json(
        json!({ "success": true, "message": "Load dispatched" }),
    ))
}

pub async fn cancel_load(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(load_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    check_role(
        &auth_user,
        &["dispatcher", "supervisor", "owner", "plant_owner", "admin"],
    )?;

    sqlx::query("UPDATE order_loads SET status = 'cancelled' WHERE id = $1")
        .bind(load_id)
        .execute(&state.db)
        .await?;

    Ok(Json(
        json!({ "success": true, "message": "Load cancelled" }),
    ))
}

#[derive(Debug, Deserialize, Serialize)]
pub struct GatePassPayload {
    pub load_id: Uuid,
    pub security_name: Option<String>,
    pub remarks: Option<String>,
}

pub async fn issue_gate_pass(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Json(payload): Json<GatePassPayload>,
) -> Result<impl IntoResponse, AppError> {
    check_role(
        &auth_user,
        &["dispatcher", "supervisor", "owner", "plant_owner", "admin"],
    )?;

    let pass_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM gate_passes")
        .fetch_one(&state.db)
        .await?;
    let pass_number = format!("GP-{:05}", pass_count + 1);

    let id: Uuid = sqlx::query_scalar(
        r#"
        INSERT INTO gate_passes (load_id, pass_number, security_name, remarks)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (load_id) DO UPDATE SET security_name = EXCLUDED.security_name, remarks = EXCLUDED.remarks
        RETURNING id
        "#,
    )
    .bind(payload.load_id)
    .bind(&pass_number)
    .bind(&payload.security_name)
    .bind(&payload.remarks)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(json!({
        "success": true,
        "id": id,
        "pass_number": pass_number,
        "message": "Gate pass issued"
    })))
}
