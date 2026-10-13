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

async fn get_staff_plant_id(state: &AppState, auth_user: &AuthUser) -> Result<Uuid, AppError> {
    if auth_user.role == "owner" || auth_user.role == "plant_owner" {
        let plant_id: Option<Uuid> =
            sqlx::query_scalar("SELECT id FROM rmc_plants WHERE owner_id = $1 AND is_active = TRUE LIMIT 1")
                .bind(auth_user.user_id)
                .fetch_optional(&state.db)
                .await?;
        if let Some(id) = plant_id {
            return Ok(id);
        }
    }
    let plant_id: Option<Uuid> = sqlx::query_scalar(
        "SELECT plant_id FROM plant_staff WHERE user_id = $1 AND is_active = TRUE LIMIT 1",
    )
    .bind(auth_user.user_id)
    .fetch_optional(&state.db)
    .await?;

    plant_id.ok_or_else(|| AppError::Forbidden("No active plant assignment found for your staff account".to_string()))
}

pub async fn get_staff_home(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<impl IntoResponse, AppError> {
    check_role(
        &auth_user,
        &[
            "dispatcher",
            "operator",
            "supervisor",
            "quality_engineer",
            "fleet_manager",
            "store_manager",
            "accountant",
            "owner",
            "plant_owner",
            "admin",
        ],
    )?;

    let plant_id = get_staff_plant_id(&state, &auth_user).await?;

    let pending_orders: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM orders WHERE plant_id = $1 AND status IN ('pending', 'confirmed')",
    )
    .bind(plant_id)
    .fetch_one(&state.db)
    .await?;

    let in_transit_mixers: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM transit_mixers WHERE plant_id = $1 AND status IN ('dispatched', 'in_transit', 'pouring')",
    )
    .bind(plant_id)
    .fetch_one(&state.db)
    .await?;

    let available_mixers: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM transit_mixers WHERE plant_id = $1 AND status = 'idle'",
    )
    .bind(plant_id)
    .fetch_one(&state.db)
    .await?;

    let today_attendance: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM workforce_attendance WHERE plant_id = $1 AND attendance_date = CURRENT_DATE AND status = 'present'",
    )
    .bind(plant_id)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(json!({
        "success": true,
        "plant_id": plant_id,
        "metrics": {
            "pending_orders": pending_orders,
            "in_transit_mixers": in_transit_mixers,
            "available_mixers": available_mixers,
            "today_attendance": today_attendance
        }
    })))
}

pub async fn list_staff_fleet(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<impl IntoResponse, AppError> {
    check_role(
        &auth_user,
        &["dispatcher", "fleet_manager", "operator", "supervisor", "owner", "plant_owner", "admin"],
    )?;
    let plant_id = get_staff_plant_id(&state, &auth_user).await?;

    let rows = sqlx::query!(
        r#"
        SELECT m.id, m.registration_number, m.capacity_m3, m.status,
               m.last_latitude, m.last_longitude, m.last_ping_at,
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

    let fleet: Vec<_> = rows
        .into_iter()
        .map(|r| {
            json!({
                "id": r.id,
                "registration_number": r.registration_number,
                "capacity_m3": r.capacity_m3,
                "status": r.status,
                "driver_name": r.driver_name,
                "driver_phone": r.driver_phone,
                "last_latitude": r.last_latitude,
                "last_longitude": r.last_longitude,
                "last_ping_at": r.last_ping_at
            })
        })
        .collect();

    Ok(Json(json!({ "success": true, "fleet": fleet })))
}

pub async fn list_staff_drivers(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<impl IntoResponse, AppError> {
    check_role(
        &auth_user,
        &["dispatcher", "fleet_manager", "supervisor", "owner", "plant_owner", "admin"],
    )?;
    let plant_id = get_staff_plant_id(&state, &auth_user).await?;

    let rows = sqlx::query!(
        r#"
        SELECT u.id, u.full_name, u.phone, u.email,
               m.registration_number as assigned_vehicle
        FROM plant_staff ps
        INNER JOIN users u ON u.id = ps.user_id
        LEFT JOIN transit_mixers m ON m.driver_id = u.id AND m.plant_id = $1
        WHERE ps.plant_id = $1 AND (ps.role = 'driver' OR u.role = 'driver') AND ps.is_active = TRUE
        ORDER BY u.full_name
        "#,
        plant_id
    )
    .fetch_all(&state.db)
    .await?;

    let drivers: Vec<_> = rows
        .into_iter()
        .map(|r| {
            json!({
                "id": r.id,
                "name": r.full_name,
                "phone": r.phone,
                "email": r.email,
                "assigned_vehicle": r.assigned_vehicle
            })
        })
        .collect();

    Ok(Json(json!({ "success": true, "drivers": drivers })))
}

pub async fn get_staff_order(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(order_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    let order = sqlx::query!(
        r#"
        SELECT o.id, o.order_number, o.plant_id, o.customer_id, o.concrete_grade,
               o.total_quantity_m3, o.delivery_date, o.delivery_time_slot, o.pump_required,
               o.special_instructions, o.total_amount, o.status, o.payment_status, o.created_at,
               u.full_name as customer_name, u.phone as customer_phone,
               s.name as site_name, s.address_line as site_address
        FROM orders o
        INNER JOIN users u ON u.id = o.customer_id
        INNER JOIN customer_sites s ON s.id = o.site_id
        WHERE o.id = $1
        "#,
        order_id
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Order not found".to_string()))?;

    let loads = sqlx::query!(
        r#"
        SELECT l.id, l.load_number, l.quantity_m3, l.status,
               l.dispatched_at, l.arrived_at, l.returned_at,
               m.registration_number as mixer_number,
               u.full_name as driver_name
        FROM order_loads l
        LEFT JOIN transit_mixers m ON m.id = l.mixer_id
        LEFT JOIN users u ON u.id = l.driver_id
        WHERE l.order_id = $1
        ORDER BY l.load_number
        "#,
        order_id
    )
    .fetch_all(&state.db)
    .await?;

    Ok(Json(json!({
        "success": true,
        "order": {
            "id": order.id,
            "order_number": order.order_number,
            "customer_name": order.customer_name,
            "customer_phone": order.customer_phone,
            "site_name": order.site_name,
            "site_address": order.site_address,
            "grade": order.concrete_grade,
            "quantity_m3": order.total_quantity_m3,
            "delivery_date": order.delivery_date,
            "time_slot": order.delivery_time_slot,
            "pump_required": order.pump_required,
            "status": order.status,
            "total_amount": order.total_amount,
            "payment_status": order.payment_status
        },
        "loads": loads.into_iter().map(|l| json!({
            "id": l.id,
            "load_number": l.load_number,
            "quantity_m3": l.quantity_m3,
            "status": l.status,
            "mixer_number": l.mixer_number,
            "driver_name": l.driver_name,
            "dispatched_at": l.dispatched_at,
            "arrived_at": l.arrived_at,
            "returned_at": l.returned_at
        })).collect::<Vec<_>>()
    })))
}

#[derive(Debug, Deserialize, Serialize)]
pub struct AssignTmPayload {
    pub mixer_id: Uuid,
    pub load_id: Option<Uuid>,
}

pub async fn assign_tm_to_order(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(order_id): Path<Uuid>,
    Json(payload): Json<AssignTmPayload>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["dispatcher", "fleet_manager", "owner", "plant_owner", "admin"])?;

    let load_id = match payload.load_id {
        Some(id) => id,
        None => {
            sqlx::query_scalar!("SELECT id FROM order_loads WHERE order_id = $1 ORDER BY load_number LIMIT 1", order_id)
                .fetch_optional(&state.db)
                .await?
                .ok_or_else(|| AppError::NotFound("No loads found for this order".to_string()))?
        }
    };

    sqlx::query!("UPDATE order_loads SET mixer_id = $1 WHERE id = $2", payload.mixer_id, load_id)
        .execute(&state.db)
        .await?;

    Ok(Json(json!({ "success": true, "message": "Mixer assigned to load" })))
}

#[derive(Debug, Deserialize, Serialize)]
pub struct AssignDriverPayload {
    pub driver_id: Uuid,
    pub load_id: Option<Uuid>,
}

pub async fn assign_driver_to_order(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(order_id): Path<Uuid>,
    Json(payload): Json<AssignDriverPayload>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["dispatcher", "fleet_manager", "owner", "plant_owner", "admin"])?;

    let load_id = match payload.load_id {
        Some(id) => id,
        None => {
            sqlx::query_scalar!("SELECT id FROM order_loads WHERE order_id = $1 ORDER BY load_number LIMIT 1", order_id)
                .fetch_optional(&state.db)
                .await?
                .ok_or_else(|| AppError::NotFound("No loads found for this order".to_string()))?
        }
    };

    sqlx::query!("UPDATE order_loads SET driver_id = $1 WHERE id = $2", payload.driver_id, load_id)
        .execute(&state.db)
        .await?;

    Ok(Json(json!({ "success": true, "message": "Driver assigned to load" })))
}

pub async fn generate_order_challan(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(order_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["dispatcher", "supervisor", "operator", "owner", "plant_owner", "admin"])?;

    let order = sqlx::query!(
        r#"
        SELECT o.id, o.order_number, o.concrete_grade, o.total_quantity_m3,
               p.code as plant_code,
               u.full_name as customer_name,
               s.address_line as site_address
        FROM orders o
        INNER JOIN rmc_plants p ON p.id = o.plant_id
        INNER JOIN users u ON u.id = o.customer_id
        INNER JOIN customer_sites s ON s.id = o.site_id
        WHERE o.id = $1
        "#,
        order_id
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Order not found".to_string()))?;

    let load = sqlx::query!(
        r#"
        SELECT l.id, l.load_number, l.quantity_m3,
               COALESCE(m.registration_number, 'TM-PENDING') as mixer_number,
               COALESCE(u.full_name, 'Driver Pending') as driver_name
        FROM order_loads l
        LEFT JOIN transit_mixers m ON m.id = l.mixer_id
        LEFT JOIN users u ON u.id = l.driver_id
        WHERE l.order_id = $1
        ORDER BY l.load_number
        LIMIT 1
        "#,
        order_id
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("No loads planned for this order".to_string()))?;

    let challan_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM challans")
        .fetch_one(&state.db)
        .await?;
    let challan_number = format!("CH-{}-{:04}", order.plant_code, challan_count + 1);

    let challan_id = sqlx::query_scalar!(
        r#"
        INSERT INTO challans (
            load_id, challan_number, plant_code, customer_name, site_address,
            concrete_grade, quantity_m3, slump_mm, water_cement_ratio, batch_time,
            mixer_number, driver_name, status
        )
        VALUES (
            $1, $2, $3, $4, $5, $6, $7, 120, 0.45, NOW(), $8, $9, 'generated'
        )
        ON CONFLICT (load_id) DO UPDATE SET challan_number = EXCLUDED.challan_number
        RETURNING id
        "#,
        load.id,
        challan_number,
        order.plant_code,
        order.customer_name,
        order.site_address,
        order.concrete_grade,
        load.quantity_m3,
        load.mixer_number,
        load.driver_name
    )
    .fetch_one(&state.db)
    .await?;

    Ok(Json(json!({
        "success": true,
        "challan_id": challan_id,
        "challan_number": challan_number,
        "message": "Challan generated"
    })))
}

pub async fn dispatch_order(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(order_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["dispatcher", "supervisor", "owner", "plant_owner", "admin"])?;

    sqlx::query!("UPDATE orders SET status = 'dispatched', updated_at = NOW() WHERE id = $1", order_id)
        .execute(&state.db)
        .await?;

    sqlx::query!(
        "UPDATE order_loads SET status = 'dispatched', dispatched_at = NOW() WHERE order_id = $1 AND status = 'planned'",
        order_id
    )
    .execute(&state.db)
    .await?;

    Ok(Json(json!({ "success": true, "message": "Order loads dispatched" })))
}

pub async fn get_production_status(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(order_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    let order = sqlx::query!(
        "SELECT id, order_number, concrete_grade, total_quantity_m3, status FROM orders WHERE id = $1",
        order_id
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Order not found".to_string()))?;

    let loads = sqlx::query!(
        r#"
        SELECT l.id, l.load_number, l.quantity_m3, l.status,
               l.batch_started_at, l.batch_completed_at,
               m.registration_number as mixer_number
        FROM order_loads l
        LEFT JOIN transit_mixers m ON m.id = l.mixer_id
        WHERE l.order_id = $1
        ORDER BY l.load_number
        "#,
        order_id
    )
    .fetch_all(&state.db)
    .await?;

    Ok(Json(json!({
        "success": true,
        "order": {
            "id": order.id,
            "order_number": order.order_number,
            "grade": order.concrete_grade,
            "total_quantity": order.total_quantity_m3,
            "status": order.status
        },
        "batches": loads.into_iter().map(|l| json!({
            "load_id": l.id,
            "load_number": l.load_number,
            "quantity_m3": l.quantity_m3,
            "status": l.status,
            "mixer_number": l.mixer_number,
            "batch_started_at": l.batch_started_at,
            "batch_completed_at": l.batch_completed_at
        })).collect::<Vec<_>>()
    })))
}

pub async fn start_production(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(order_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["operator", "dispatcher", "supervisor", "owner", "plant_owner", "admin"])?;

    sqlx::query!("UPDATE orders SET status = 'in_production', updated_at = NOW() WHERE id = $1", order_id)
        .execute(&state.db)
        .await?;

    sqlx::query!(
        "UPDATE order_loads SET status = 'batching', batch_started_at = NOW() WHERE order_id = $1 AND status = 'planned'",
        order_id
    )
    .execute(&state.db)
    .await?;

    Ok(Json(json!({ "success": true, "message": "Production started" })))
}

#[derive(Debug, Deserialize, Serialize)]
pub struct RecordBatchPayload {
    pub load_id: Uuid,
    pub batch_number: Option<i32>,
    pub actual_weights: serde_json::Value,
    pub target_weights: Option<serde_json::Value>,
}

pub async fn record_batch(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(_order_id): Path<Uuid>,
    Json(payload): Json<RecordBatchPayload>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["operator", "supervisor", "owner", "plant_owner", "admin"])?;

    let target = payload.target_weights.unwrap_or(json!({}));
    let batch_num = payload.batch_number.unwrap_or(1);

    let id = sqlx::query_scalar!(
        r#"
        INSERT INTO batch_production_records (load_id, operator_id, batch_number, actual_weights, target_weights, status, completed_at)
        VALUES ($1, $2, $3, $4, $5, 'COMPLETED', NOW())
        RETURNING id
        "#,
        payload.load_id,
        auth_user.user_id,
        batch_num,
        payload.actual_weights,
        target
    )
    .fetch_one(&state.db)
    .await?;

    sqlx::query!(
        "UPDATE order_loads SET batch_completed_at = NOW(), status = 'batched' WHERE id = $1",
        payload.load_id
    )
    .execute(&state.db)
    .await?;

    Ok(Json(json!({ "success": true, "batch_id": id, "message": "Batch weights recorded" })))
}

pub async fn complete_production(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(order_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["operator", "dispatcher", "supervisor", "owner", "plant_owner", "admin"])?;

    sqlx::query!("UPDATE orders SET status = 'produced', updated_at = NOW() WHERE id = $1", order_id)
        .execute(&state.db)
        .await?;

    Ok(Json(json!({ "success": true, "message": "Production completed" })))
}

#[derive(Debug, Deserialize, Serialize)]
pub struct QualityTestPayload {
    pub load_id: Uuid,
    pub slump_tested_mm: i32,
    pub temperature_celsius: Option<f64>,
    pub visual_inspection: Option<String>,
}

pub async fn record_quality_test(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Json(payload): Json<QualityTestPayload>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["quality_engineer", "supervisor", "owner", "plant_owner", "admin"])?;

    let id = sqlx::query_scalar!(
        r#"
        INSERT INTO cube_tests (load_id, slump_mm, testing_date, tested_by)
        VALUES ($1, $2, CURRENT_DATE, $3)
        RETURNING id
        "#,
        payload.load_id,
        payload.slump_tested_mm,
        auth_user.user_id
    )
    .fetch_one(&state.db)
    .await?;

    Ok(Json(json!({ "success": true, "test_id": id, "message": "Quality inspection recorded" })))
}

pub async fn get_quality_details(
    State(state): State<AppState>,
    _auth_user: AuthUser,
    Path(order_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    let tests = sqlx::query!(
        r#"
        SELECT t.id, t.load_id, t.slump_mm, t.compressive_strength_7d_mpa,
               t.compressive_strength_28d_mpa, t.testing_date,
               u.full_name as tester_name
        FROM cube_tests t
        INNER JOIN order_loads l ON l.id = t.load_id
        LEFT JOIN users u ON u.id = t.tested_by
        WHERE l.order_id = $1
        "#,
        order_id
    )
    .fetch_all(&state.db)
    .await?;

    let results: Vec<_> = tests
        .into_iter()
        .map(|t| {
            json!({
                "id": t.id,
                "load_id": t.load_id,
                "slump_mm": t.slump_mm,
                "compressive_strength_7d_mpa": t.compressive_strength_7d_mpa,
                "compressive_strength_28d_mpa": t.compressive_strength_28d_mpa,
                "testing_date": t.testing_date,
                "tester_name": t.tester_name
            })
        })
        .collect();

    Ok(Json(json!({ "success": true, "quality_tests": results })))
}

#[derive(Debug, Deserialize, Serialize)]
pub struct RecordInvoicePaymentPayload {
    pub amount: f64,
    pub payment_method: Option<String>,
    pub transaction_ref: Option<String>,
    pub notes: Option<String>,
}

pub async fn record_invoice_payment(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(invoice_id): Path<Uuid>,
    Json(payload): Json<RecordInvoicePaymentPayload>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["accountant", "owner", "plant_owner", "admin"])?;

    let inv = sqlx::query!("SELECT plant_id, order_id, total_amount FROM plant_invoices WHERE id = $1", invoice_id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("Invoice not found".to_string()))?;

    let pay_id = sqlx::query_scalar!(
        r#"
        INSERT INTO plant_payments (invoice_id, order_id, plant_id, amount, payment_method, transaction_ref, notes)
        VALUES ($1, $2, $3, $4::numeric, $5, $6, $7)
        RETURNING id
        "#,
        invoice_id,
        inv.order_id,
        inv.plant_id,
        bigdecimal::BigDecimal::try_from(payload.amount).unwrap_or_default(),
        payload.payment_method.unwrap_or_else(|| "bank_transfer".to_string()),
        payload.transaction_ref,
        payload.notes
    )
    .fetch_one(&state.db)
    .await?;

    sqlx::query!("UPDATE plant_invoices SET status = 'PAID' WHERE id = $1", invoice_id)
        .execute(&state.db)
        .await?;

    if let Some(oid) = inv.order_id {
        sqlx::query!("UPDATE orders SET payment_status = 'paid', updated_at = NOW() WHERE id = $1", oid)
            .execute(&state.db)
            .await?;
    }

    Ok(Json(json!({ "success": true, "payment_id": pay_id, "message": "Payment recorded" })))
}

pub async fn approve_customer_kyc(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(profile_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["admin", "owner", "plant_owner"])?;

    sqlx::query!(
        "UPDATE user_profiles SET kyc_status = 'verified', updated_at = NOW() WHERE id = $1",
        profile_id
    )
    .execute(&state.db)
    .await?;

    Ok(Json(json!({ "success": true, "message": "KYC profile approved" })))
}

pub async fn reject_customer_kyc(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(profile_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["admin", "owner", "plant_owner"])?;

    sqlx::query!(
        "UPDATE user_profiles SET kyc_status = 'rejected', updated_at = NOW() WHERE id = $1",
        profile_id
    )
    .execute(&state.db)
    .await?;

    Ok(Json(json!({ "success": true, "message": "KYC profile rejected" })))
}

pub async fn reset_customer_kyc(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(profile_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["admin", "owner", "plant_owner"])?;

    sqlx::query!(
        "UPDATE user_profiles SET kyc_status = 'unverified', updated_at = NOW() WHERE id = $1",
        profile_id
    )
    .execute(&state.db)
    .await?;

    Ok(Json(json!({ "success": true, "message": "KYC profile reset for re-verification" })))
}
