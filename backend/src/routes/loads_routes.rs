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
    auth_user: AuthUser,
    Path(order_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    ensure_order_access(&state, &auth_user, order_id, true).await?;
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

    ensure_order_access(&state, &auth_user, order_id, false).await?;
    if !payload.quantity_m3.is_finite() || payload.quantity_m3 <= 0.0 {
        return Err(AppError::BadRequest(
            "A positive load quantity is required".into(),
        ));
    }
    use bigdecimal::FromPrimitive;
    let quantity = bigdecimal::BigDecimal::from_f64(payload.quantity_m3)
        .ok_or_else(|| AppError::BadRequest("Invalid quantity".into()))?;
    let mut tx = state.db.begin().await?;
    let (status, total): (String, bigdecimal::BigDecimal) =
        sqlx::query_as("SELECT status,total_quantity_m3 FROM orders WHERE id=$1 FOR UPDATE")
            .bind(order_id)
            .fetch_one(&mut *tx)
            .await?;
    if matches!(
        status.as_str(),
        "cancelled" | "rejected" | "delivered" | "completed"
    ) {
        return Err(AppError::Conflict("Order cannot accept new loads".into()));
    }
    let allocated: bigdecimal::BigDecimal = sqlx::query_scalar("SELECT COALESCE(SUM(quantity_m3),0) FROM order_loads WHERE order_id=$1 AND status<>'cancelled'")
        .bind(order_id).fetch_one(&mut *tx).await?;
    if allocated + &quantity > total {
        return Err(AppError::Conflict(
            "Planned loads exceed the order quantity".into(),
        ));
    }
    if payload.mixer_id.is_some() || payload.driver_id.is_some() {
        return Err(AppError::BadRequest(
            "Create the load, then use its assignment endpoint".into(),
        ));
    }
    let next_load_number: i32 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(load_number),0)+1 FROM order_loads WHERE order_id=$1",
    )
    .bind(order_id)
    .fetch_one(&mut *tx)
    .await?;
    let id: Uuid=sqlx::query_scalar("INSERT INTO order_loads (order_id,load_number,quantity_m3,status) VALUES ($1,$2,$3,'planned') RETURNING id")
        .bind(order_id).bind(next_load_number).bind(quantity).fetch_one(&mut *tx).await?;
    tx.commit().await?;

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

    ensure_load_access(&state, &auth_user, load_id).await?;
    let mixer = payload
        .mixer_id
        .or(payload.vehicle_id)
        .ok_or_else(|| AppError::BadRequest("Mixer is required".into()))?;
    let driver = payload
        .driver_id
        .ok_or_else(|| AppError::BadRequest("Driver is required".into()))?;
    let mut tx = state.db.begin().await?;
    let (plant,status,quantity):(Uuid,String,bigdecimal::BigDecimal)=sqlx::query_as(
        "SELECT o.plant_id,l.status,l.quantity_m3 FROM order_loads l JOIN orders o ON o.id=l.order_id WHERE l.id=$1 FOR UPDATE OF o,l",
    ).bind(load_id).fetch_one(&mut *tx).await?;
    if !matches!(
        status.as_str(),
        "planned" | "assigned" | "batching" | "batched"
    ) {
        return Err(AppError::Conflict(
            "Load assignment is already committed".into(),
        ));
    }
    let (mplant, capacity, assigned): (Uuid, bigdecimal::BigDecimal, Option<Uuid>) =
        sqlx::query_as(
            "SELECT plant_id,capacity_m3,driver_id FROM transit_mixers WHERE id=$1 FOR UPDATE",
        )
        .bind(mixer)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| AppError::NotFound("Mixer not found".into()))?;
    if plant != mplant || quantity > capacity || assigned.is_some_and(|d| d != driver) {
        return Err(AppError::Conflict(
            "Mixer is incompatible with this load".into(),
        ));
    }
    let valid:bool=sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM users u WHERE u.id=$1 AND u.role='driver' AND u.is_active=TRUE
         AND (EXISTS(SELECT 1 FROM plant_staff WHERE user_id=u.id AND plant_id=$2 AND is_active=TRUE)
              OR EXISTS(SELECT 1 FROM transit_mixers WHERE driver_id=u.id AND plant_id=$2)))",
    ).bind(driver).bind(plant).fetch_one(&mut *tx).await?;
    if !valid {
        return Err(AppError::Forbidden(
            "Driver is not assigned to this plant".into(),
        ));
    }
    sqlx::query("UPDATE order_loads SET mixer_id=$2,driver_id=$3,status=CASE WHEN status='planned' THEN 'assigned' ELSE status END WHERE id=$1")
        .bind(load_id).bind(mixer).bind(driver).execute(&mut *tx).await?;
    tx.commit().await?;

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

    ensure_load_access(&state, &auth_user, load_id).await?;
    let status =
        crate::services::load_lifecycle::advance(&state.db, load_id, auth_user.user_id, "prepare")
            .await?;

    Ok(Json(
        json!({ "success": true, "status": status.to_uppercase(), "message": "Load prepare complete" }),
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

    ensure_load_access(&state, &auth_user, load_id).await?;
    let status =
        crate::services::load_lifecycle::advance(&state.db, load_id, auth_user.user_id, "dispatch")
            .await?;

    Ok(Json(
        json!({ "success": true, "status": status.to_uppercase(), "message": "Load dispatch complete" }),
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

    ensure_load_access(&state, &auth_user, load_id).await?;
    let status =
        crate::services::load_lifecycle::advance(&state.db, load_id, auth_user.user_id, "cancel")
            .await?;

    Ok(Json(
        json!({ "success": true, "status": status.to_uppercase(), "message": "Load cancel complete" }),
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

    ensure_load_access(&state, &auth_user, payload.load_id).await?;
    let eligible: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM order_loads l JOIN challans c ON c.load_id=l.id WHERE l.id=$1 AND l.status='ready_to_dispatch')")
        .bind(payload.load_id).fetch_one(&state.db).await?;
    if !eligible {
        return Err(AppError::Conflict(
            "Prepare the load and challan before issuing a gate pass".into(),
        ));
    }
    let pass_number = format!("GP-{}", payload.load_id.simple());
    let (id, pass_number): (Uuid, String) = sqlx::query_as(
        r#"
        INSERT INTO gate_passes (load_id, pass_number, security_name, remarks)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (load_id) DO UPDATE SET security_name = EXCLUDED.security_name, remarks = EXCLUDED.remarks
        RETURNING id, pass_number
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

pub(crate) async fn ensure_order_access(
    state: &AppState,
    user: &AuthUser,
    order_id: Uuid,
    allow_customer: bool,
) -> Result<(), AppError> {
    let (plant_id, customer_id): (Uuid, Uuid) =
        sqlx::query_as("SELECT plant_id, customer_id FROM orders WHERE id = $1")
            .bind(order_id)
            .fetch_optional(&state.db)
            .await?
            .ok_or_else(|| AppError::NotFound("Order not found".to_string()))?;
    if allow_customer && user.role == "customer" && user.user_id == customer_id {
        return Ok(());
    }
    check_role(
        user,
        &[
            "dispatcher",
            "fleet_manager",
            "operator",
            "supervisor",
            "owner",
            "plant_owner",
            "admin",
        ],
    )?;
    super::business_routes::ensure_plant_staff_or_owner(state, user, plant_id).await
}

async fn ensure_load_access(
    state: &AppState,
    user: &AuthUser,
    load_id: Uuid,
) -> Result<(), AppError> {
    let order_id: Uuid = sqlx::query_scalar("SELECT order_id FROM order_loads WHERE id = $1")
        .bind(load_id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("Load not found".to_string()))?;
    ensure_order_access(state, user, order_id, false).await
}
