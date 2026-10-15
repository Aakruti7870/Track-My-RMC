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

async fn get_staff_plant_id(state: &AppState, auth_user: &AuthUser) -> Result<Uuid, AppError> {
    if auth_user.role == "owner" || auth_user.role == "plant_owner" {
        let plant_id: Option<Uuid> = sqlx::query_scalar(
            "SELECT id FROM rmc_plants WHERE owner_id = $1 AND is_active = TRUE LIMIT 1",
        )
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

    plant_id.ok_or_else(|| {
        AppError::Forbidden("No active plant assignment found for your staff account".to_string())
    })
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
    let display_name: String = sqlx::query_scalar("SELECT full_name FROM users WHERE id = $1")
        .bind(auth_user.user_id)
        .fetch_one(&state.db)
        .await?;
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
        "SELECT COUNT(*) FROM transit_mixers WHERE plant_id = $1 AND status IN ('idle','available')",
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

    // The mobile StaffHome screen expects role/name/kpis/primary. The previous Rust
    // endpoint returned only metrics, so every operational role rendered an empty home.
    let role = auth_user.role.as_str();
    let (role_label, title, kind) = match role {
        "dispatcher" => ("Dispatcher", "Dispatch Queue", "dispatch"),
        "operator" => ("Plant Operator", "Production Queue", "production"),
        "supervisor" => ("Supervisor", "Open Incidents", "incidents"),
        "accountant" => ("Accountant", "Invoices", "invoices"),
        "quality_engineer" => ("Quality Engineer", "Quality Register", "quality"),
        "fleet_manager" => ("Fleet Manager", "Fleet", "fleet"),
        "store_manager" => ("Store Manager", "Stock Levels", "inventory"),
        "owner" | "plant_owner" => ("Plant Owner", "Recent Orders", "orders"),
        _ => ("Admin", "Recent Orders", "orders"),
    };

    let mut kpis = json!([
        { "label": "Pending Orders", "value": pending_orders, "icon": "hourglass-outline" },
        { "label": "In Transit TMs", "value": in_transit_mixers, "icon": "navigate-outline" },
        { "label": "Available TMs", "value": available_mixers, "icon": "bus-outline" },
        { "label": "Staff Present Today", "value": today_attendance, "icon": "people-outline" }
    ]);

    if role == "store_manager" {
        let stock: (i64, i64) = sqlx::query_as(
            "SELECT COUNT(*), COUNT(*) FILTER (WHERE current_stock <= minimum_stock) FROM plant_materials WHERE plant_id = $1",
        )
        .bind(plant_id).fetch_one(&state.db).await?;
        kpis = json!([
            { "label": "Materials", "value": stock.0, "icon": "cube-outline" },
            { "label": "Low Stock", "value": stock.1, "icon": "alert-circle-outline" },
            { "label": "Items OK", "value": stock.0 - stock.1, "icon": "checkmark-circle-outline" },
            { "label": "Staff Present Today", "value": today_attendance, "icon": "people-outline" }
        ]);
    } else if role == "accountant" {
        let billed: (i64, f64) = sqlx::query_as(
            "SELECT COUNT(*), COALESCE(SUM(total_amount), 0)::double precision FROM plant_invoices WHERE plant_id = $1",
        )
        .bind(plant_id).fetch_one(&state.db).await?;
        let received: f64 = sqlx::query_scalar(
            "SELECT COALESCE(SUM(amount),0)::double precision FROM plant_payments WHERE plant_id = $1 AND invoice_id IS NOT NULL",
        )
        .bind(plant_id).fetch_one(&state.db).await?;
        kpis = json!([
            { "label": "Billed", "value": billed.1, "icon": "receipt-outline", "unit": "₹" },
            { "label": "Received", "value": received, "icon": "cash-outline", "unit": "₹" },
            { "label": "Outstanding", "value": (billed.1 - received).max(0.0), "icon": "alert-circle-outline", "unit": "₹" },
            { "label": "Invoices", "value": billed.0, "icon": "document-text-outline" }
        ]);
    } else if role == "fleet_manager" {
        let fleet_total: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM transit_mixers WHERE plant_id = $1")
                .bind(plant_id)
                .fetch_one(&state.db)
                .await?;
        let drivers: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM plant_staff ps JOIN users u ON u.id = ps.user_id WHERE ps.plant_id = $1 AND ps.is_active = TRUE AND u.role = 'driver'",
        )
        .bind(plant_id).fetch_one(&state.db).await?;
        kpis = json!([
            { "label": "Total TMs", "value": fleet_total, "icon": "bus-outline" },
            { "label": "Available", "value": available_mixers, "icon": "checkmark-circle-outline" },
            { "label": "On Trip", "value": in_transit_mixers, "icon": "navigate-outline" },
            { "label": "Drivers", "value": drivers, "icon": "people-outline" }
        ]);
    } else if role == "supervisor" {
        let open_incidents: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM driver_sos_alerts a JOIN order_loads l ON l.id = a.load_id JOIN orders o ON o.id = l.order_id WHERE o.plant_id = $1 AND upper(a.status) <> 'RESOLVED'",
        )
        .bind(plant_id).fetch_one(&state.db).await?;
        kpis = json!([
            { "label": "Open Incidents", "value": open_incidents, "icon": "warning-outline" },
            { "label": "In Transit TMs", "value": in_transit_mixers, "icon": "navigate-outline" },
            { "label": "Pending Orders", "value": pending_orders, "icon": "hourglass-outline" },
            { "label": "Staff Present Today", "value": today_attendance, "icon": "people-outline" }
        ]);
    }

    Ok(Json(json!({
        "success": true,
        "role": auth_user.role,
        "role_label": role_label,
        "name": display_name,
        "primary": { "title": title, "kind": kind },
        "kpis": kpis,
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
    let plant_id = get_staff_plant_id(&state, &auth_user).await?;

    let rows = sqlx::query(
        r#"
        SELECT m.id, m.registration_number, m.capacity_m3, m.status,
               m.last_latitude, m.last_longitude, m.last_ping_at,
               u.full_name as driver_name, u.phone as driver_phone
        FROM transit_mixers m
        LEFT JOIN users u ON u.id = m.driver_id
        WHERE m.plant_id = $1
        ORDER BY m.registration_number
        "#,
    )
    .bind(plant_id)
    .fetch_all(&state.db)
    .await?;

    let fleet: Vec<_> = rows
        .into_iter()
        .map(|r| {
            let id: Uuid = r.get("id");
            let reg: String = r.get("registration_number");
            let cap: bigdecimal::BigDecimal = r.get("capacity_m3");
            let st: String = r.get("status");
            let driver_name: Option<String> = r.get("driver_name");
            let driver_phone: Option<String> = r.get("driver_phone");
            let lat: Option<f64> = r.get("last_latitude");
            let lon: Option<f64> = r.get("last_longitude");
            let ping: Option<chrono::DateTime<chrono::Utc>> = r.get("last_ping_at");
            json!({
                "id": id,
                "registration_number": reg,
                "capacity_m3": cap,
                "status": st,
                "driver_name": driver_name,
                "driver_phone": driver_phone,
                "last_latitude": lat,
                "last_longitude": lon,
                "last_ping_at": ping
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
        &[
            "dispatcher",
            "fleet_manager",
            "supervisor",
            "owner",
            "plant_owner",
            "admin",
        ],
    )?;
    let plant_id = get_staff_plant_id(&state, &auth_user).await?;

    let rows = sqlx::query(
        r#"
        SELECT u.id, u.full_name, u.phone, u.email,
               m.registration_number as assigned_vehicle
        FROM plant_staff ps
        INNER JOIN users u ON u.id = ps.user_id
        LEFT JOIN transit_mixers m ON m.driver_id = u.id AND m.plant_id = $1
        WHERE ps.plant_id = $1 AND (ps.role = 'driver' OR u.role = 'driver') AND ps.is_active = TRUE
        ORDER BY u.full_name
        "#,
    )
    .bind(plant_id)
    .fetch_all(&state.db)
    .await?;

    let drivers: Vec<_> = rows
        .into_iter()
        .map(|r| {
            let id: Uuid = r.get("id");
            let name: String = r.get("full_name");
            let phone: Option<String> = r.get("phone");
            let email: Option<String> = r.get("email");
            let vehicle: Option<String> = r.get("assigned_vehicle");
            json!({
                "id": id,
                "name": name,
                "phone": phone,
                "email": email,
                "assigned_vehicle": vehicle
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

    let order_row = sqlx::query(
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
    )
    .bind(order_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Order not found".to_string()))?;

    let loads = sqlx::query(
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
    )
    .bind(order_id)
    .fetch_all(&state.db)
    .await?;

    let o_id: Uuid = order_row.get("id");
    let o_num: String = order_row.get("order_number");
    let c_name: String = order_row.get("customer_name");
    let c_phone: Option<String> = order_row.get("customer_phone");
    let s_name: String = order_row.get("site_name");
    let s_addr: String = order_row.get("site_address");
    let grade: String = order_row.get("concrete_grade");
    let qty: bigdecimal::BigDecimal = order_row.get("total_quantity_m3");
    let deliv_date: chrono::NaiveDate = order_row.get("delivery_date");
    let slot: Option<String> = order_row.get("delivery_time_slot");
    let pump: bool = order_row.get("pump_required");
    let st: String = order_row.get("status");
    let total: bigdecimal::BigDecimal = order_row.get("total_amount");
    let pay_st: String = order_row.get("payment_status");

    Ok(Json(json!({
        "success": true,
        "order": {
            "id": o_id,
            "order_number": o_num,
            "customer_name": c_name,
            "customer_phone": c_phone,
            "site_name": s_name,
            "site_address": s_addr,
            "grade": grade,
            "quantity_m3": qty,
            "delivery_date": deliv_date,
            "time_slot": slot,
            "pump_required": pump,
            "status": st,
            "total_amount": total,
            "payment_status": pay_st
        },
        "loads": loads.into_iter().map(|l| {
            let lid: Uuid = l.get("id");
            let lnum: i32 = l.get("load_number");
            let lqty: bigdecimal::BigDecimal = l.get("quantity_m3");
            let lst: String = l.get("status");
            let mixer: Option<String> = l.get("mixer_number");
            let driver: Option<String> = l.get("driver_name");
            let disp: Option<chrono::DateTime<chrono::Utc>> = l.get("dispatched_at");
            let arr: Option<chrono::DateTime<chrono::Utc>> = l.get("arrived_at");
            let ret: Option<chrono::DateTime<chrono::Utc>> = l.get("returned_at");
            json!({
                "id": lid,
                "load_number": lnum,
                "quantity_m3": lqty,
                "status": lst,
                "mixer_number": mixer,
                "driver_name": driver,
                "dispatched_at": disp,
                "arrived_at": arr,
                "returned_at": ret
            })
        }).collect::<Vec<_>>()
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

    let load_id: Uuid = match payload.load_id {
        Some(id) => id,
        None => {
            let id_opt: Option<Uuid> = sqlx::query_scalar(
                "SELECT id FROM order_loads WHERE order_id = $1 ORDER BY load_number LIMIT 1",
            )
            .bind(order_id)
            .fetch_optional(&state.db)
            .await?;
            id_opt.ok_or_else(|| AppError::NotFound("No loads found for this order".to_string()))?
        }
    };

    sqlx::query("UPDATE order_loads SET mixer_id = $1 WHERE id = $2")
        .bind(payload.mixer_id)
        .bind(load_id)
        .execute(&state.db)
        .await?;

    Ok(Json(
        json!({ "success": true, "message": "Mixer assigned to load" }),
    ))
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

    let load_id: Uuid = match payload.load_id {
        Some(id) => id,
        None => {
            let id_opt: Option<Uuid> = sqlx::query_scalar(
                "SELECT id FROM order_loads WHERE order_id = $1 ORDER BY load_number LIMIT 1",
            )
            .bind(order_id)
            .fetch_optional(&state.db)
            .await?;
            id_opt.ok_or_else(|| AppError::NotFound("No loads found for this order".to_string()))?
        }
    };

    sqlx::query("UPDATE order_loads SET driver_id = $1 WHERE id = $2")
        .bind(payload.driver_id)
        .bind(load_id)
        .execute(&state.db)
        .await?;

    Ok(Json(
        json!({ "success": true, "message": "Driver assigned to load" }),
    ))
}

pub async fn generate_order_challan(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(order_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    check_role(
        &auth_user,
        &[
            "dispatcher",
            "supervisor",
            "operator",
            "owner",
            "plant_owner",
            "admin",
        ],
    )?;

    let order_row = sqlx::query(
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
    )
    .bind(order_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Order not found".to_string()))?;

    let load_row = sqlx::query(
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
    )
    .bind(order_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("No loads planned for this order".to_string()))?;

    let plant_code: String = order_row.get("plant_code");
    let customer_name: String = order_row.get("customer_name");
    let site_address: String = order_row.get("site_address");
    let concrete_grade: String = order_row.get("concrete_grade");

    let load_id: Uuid = load_row.get("id");
    let quantity_m3: bigdecimal::BigDecimal = load_row.get("quantity_m3");
    let mixer_number: String = load_row.get("mixer_number");
    let driver_name: String = load_row.get("driver_name");

    let challan_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM challans")
        .fetch_one(&state.db)
        .await?;
    let challan_number = format!("CH-{}-{:04}", plant_code, challan_count + 1);

    let challan_id: Uuid = sqlx::query_scalar(
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
    )
    .bind(load_id)
    .bind(&challan_number)
    .bind(&plant_code)
    .bind(&customer_name)
    .bind(&site_address)
    .bind(&concrete_grade)
    .bind(quantity_m3)
    .bind(&mixer_number)
    .bind(&driver_name)
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
    check_role(
        &auth_user,
        &["dispatcher", "supervisor", "owner", "plant_owner", "admin"],
    )?;

    sqlx::query("UPDATE orders SET status = 'dispatched', updated_at = NOW() WHERE id = $1")
        .bind(order_id)
        .execute(&state.db)
        .await?;

    sqlx::query(
        "UPDATE order_loads SET status = 'dispatched', dispatched_at = NOW() WHERE order_id = $1 AND status = 'planned'",
    )
    .bind(order_id)
    .execute(&state.db)
    .await?;

    Ok(Json(
        json!({ "success": true, "message": "Order loads dispatched" }),
    ))
}

pub async fn get_production_status(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(order_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    check_role(
        &auth_user,
        &[
            "operator",
            "dispatcher",
            "supervisor",
            "quality_engineer",
            "owner",
            "plant_owner",
            "admin",
        ],
    )?;

    super::loads_routes::ensure_order_access(&state, &auth_user, order_id, false).await?;
    let data:serde_json::Value=sqlx::query_scalar("SELECT jsonb_build_object('success',TRUE,'order_id',o.id,'order_number',o.order_number,'grade',o.concrete_grade,'status',UPPER(o.status),'ordered_quantity',o.total_quantity_m3::DOUBLE PRECISION,'required',o.total_quantity_m3::DOUBLE PRECISION,'batches',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',b.id,'quantity',b.quantity::DOUBLE PRECISION,'batch_reference',b.batch_reference,'remarks',b.remarks,'created_at',b.created_at,'mix_design_version',b.mix_design_version,'material_consumption',b.material_consumption) ORDER BY b.created_at) FROM production_batches b WHERE b.order_id=o.id),'[]'::jsonb)) FROM orders o WHERE id=$1")
      .bind(order_id).fetch_one(&state.db).await?;
    let produced: f64 = sqlx::query_scalar(crate::services::production_service::PRODUCED_SQL)
        .bind(order_id)
        .fetch_one(&state.db)
        .await?;
    let mut data = data;
    let ordered = data["required"].as_f64().unwrap_or(0.0);
    data["produced_quantity"] = json!(produced);
    data["produced"] = json!(produced);
    data["remaining_quantity"] = json!((ordered - produced).max(0.0));
    Ok(Json(data))
}

pub async fn start_production(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(order_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    check_role(
        &auth_user,
        &[
            "operator",
            "dispatcher",
            "supervisor",
            "owner",
            "plant_owner",
            "admin",
        ],
    )?;

    super::loads_routes::ensure_order_access(&state, &auth_user, order_id, false).await?;
    let mut tx = state.db.begin().await?;
    let current: String = sqlx::query_scalar("SELECT status FROM orders WHERE id=$1 FOR UPDATE")
        .bind(order_id)
        .fetch_one(&mut *tx)
        .await?;
    if !matches!(
        current.as_str(),
        "confirmed" | "scheduled" | "in_production"
    ) {
        return Err(AppError::Conflict(
            "Order must be approved before production".into(),
        ));
    }
    sqlx::query("UPDATE orders SET status='in_production',updated_at=NOW() WHERE id=$1")
        .bind(order_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("UPDATE order_loads SET status='batching',batch_started_at=COALESCE(batch_started_at,NOW()) WHERE order_id=$1 AND status IN ('planned','assigned')")
        .bind(order_id).execute(&mut *tx).await?;
    tx.commit().await?;

    Ok(Json(
        json!({ "success": true, "message": "Production started" }),
    ))
}

pub use crate::services::production_service::LoadBatch as RecordBatchPayload;

pub async fn record_batch(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(order_id): Path<Uuid>,
    Json(payload): Json<crate::services::production_service::BatchInput>,
) -> Result<impl IntoResponse, AppError> {
    check_role(
        &auth_user,
        &["operator", "supervisor", "owner", "plant_owner", "admin"],
    )?;
    super::loads_routes::ensure_order_access(&state, &auth_user, order_id, false).await?;
    Ok(Json(
        crate::services::production_service::record(
            &state.db,
            order_id,
            auth_user.user_id,
            payload,
        )
        .await?,
    ))
}

pub async fn complete_production(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(order_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    check_role(
        &auth_user,
        &[
            "operator",
            "dispatcher",
            "supervisor",
            "owner",
            "plant_owner",
            "admin",
        ],
    )?;

    super::loads_routes::ensure_order_access(&state, &auth_user, order_id, false).await?;
    let mut tx = state.db.begin().await?;
    let current: String = sqlx::query_scalar("SELECT status FROM orders WHERE id=$1 FOR UPDATE")
        .bind(order_id)
        .fetch_one(&mut *tx)
        .await?;
    if !matches!(current.as_str(), "in_production" | "produced") {
        return Err(AppError::Conflict("Order is not in production".into()));
    }
    let produced: f64 = sqlx::query_scalar(crate::services::production_service::PRODUCED_SQL)
        .bind(order_id)
        .fetch_one(&mut *tx)
        .await?;
    let required: f64 =
        sqlx::query_scalar("SELECT total_quantity_m3::DOUBLE PRECISION FROM orders WHERE id=$1")
            .bind(order_id)
            .fetch_one(&mut *tx)
            .await?;
    if required <= 0.0 || produced + 0.001 < required * 0.98 {
        return Err(AppError::Conflict(
            "Record the required production quantity before completion".into(),
        ));
    }
    sqlx::query("UPDATE orders SET status='produced',updated_at=NOW() WHERE id=$1")
        .bind(order_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;

    Ok(Json(
        json!({ "success": true, "message": "Production completed" }),
    ))
}

#[derive(Debug, Deserialize, Serialize)]
pub struct QualityTestPayload {
    pub order_id: Option<Uuid>,
    pub load_id: Option<Uuid>,
    pub slump_mm: Option<i32>,
    pub slump_tested_mm: Option<i32>,
    pub cube_7d: Option<f64>,
    pub cube_28d: Option<f64>,
    pub actual_cement: Option<f64>,
    pub actual_water: Option<f64>,
    pub result: Option<String>,
    pub remarks: Option<String>,
    pub temperature_celsius: Option<f64>,
    pub visual_inspection: Option<String>,
}

pub async fn record_quality_test(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Json(payload): Json<QualityTestPayload>,
) -> Result<impl IntoResponse, AppError> {
    check_role(
        &auth_user,
        &[
            "quality_engineer",
            "supervisor",
            "owner",
            "plant_owner",
            "admin",
        ],
    )?;

    let target_order_id = match payload.order_id {
        Some(oid) => oid,
        None => {
            if let Some(lid) = payload.load_id {
                let oid_opt: Option<Uuid> =
                    sqlx::query_scalar("SELECT order_id FROM order_loads WHERE id = $1")
                        .bind(lid)
                        .fetch_optional(&state.db)
                        .await?;
                oid_opt.ok_or_else(|| AppError::BadRequest("Invalid load_id".to_string()))?
            } else {
                return Err(AppError::BadRequest(
                    "order_id or load_id is required".to_string(),
                ));
            }
        }
    };

    let slump = payload.slump_mm.or(payload.slump_tested_mm);
    let s7 = payload
        .cube_7d
        .and_then(|v| format!("{:.2}", v).parse::<bigdecimal::BigDecimal>().ok());
    let s28 = payload
        .cube_28d
        .and_then(|v| format!("{:.2}", v).parse::<bigdecimal::BigDecimal>().ok());
    let actual_cement = payload
        .actual_cement
        .and_then(|v| format!("{:.2}", v).parse::<bigdecimal::BigDecimal>().ok());
    let actual_water = payload
        .actual_water
        .and_then(|v| format!("{:.2}", v).parse::<bigdecimal::BigDecimal>().ok());
    let result_str = payload.result.clone().unwrap_or_else(|| "PASS".to_string());
    let remarks = payload.remarks.or(payload.visual_inspection);
    let passed = result_str.to_uppercase() == "PASS";
    let exp_strength: bigdecimal::BigDecimal = "30.00".parse().unwrap();
    let act_strength: bigdecimal::BigDecimal =
        s28.clone().unwrap_or_else(|| "0.00".parse().unwrap());

    let id: Uuid = sqlx::query_scalar(
        r#"
        INSERT INTO cube_tests (
            order_id, load_id, slump_mm, compressive_strength_7d_mpa, compressive_strength_28d_mpa,
            actual_cement, actual_water, result, remarks, sample_date, test_interval_days,
            test_date, testing_date, expected_strength_mpa, actual_strength_mpa, passed, tested_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_DATE, 28, CURRENT_DATE, CURRENT_DATE, $10, $11, $12, $13)
        RETURNING id
        "#,
    )
    .bind(target_order_id)
    .bind(payload.load_id)
    .bind(slump)
    .bind(s7)
    .bind(s28)
    .bind(actual_cement)
    .bind(actual_water)
    .bind(&result_str)
    .bind(&remarks)
    .bind(exp_strength)
    .bind(act_strength)
    .bind(passed)
    .bind(auth_user.user_id)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(
        json!({ "success": true, "test_id": id, "result": result_str, "message": "Quality inspection recorded" }),
    ))
}

pub async fn record_order_quality_test(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(order_id): Path<Uuid>,
    Json(mut payload): Json<QualityTestPayload>,
) -> Result<impl IntoResponse, AppError> {
    payload.order_id = Some(order_id);
    record_quality_test(State(state), auth_user, Json(payload)).await
}

pub async fn get_quality_details(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(order_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    check_role(
        &auth_user,
        &[
            "quality_engineer",
            "supervisor",
            "dispatcher",
            "operator",
            "owner",
            "plant_owner",
            "admin",
        ],
    )?;

    let order = sqlx::query(
        r#"
        SELECT o.id, o.order_number, o.concrete_grade, CAST(o.total_quantity_m3 AS DOUBLE PRECISION) as quantity,
               o.status, COALESCE(u.full_name, 'Customer') as customer_name,
               COALESCE(s.name, 'Main Site') as site_name
        FROM orders o
        LEFT JOIN users u ON u.id = o.customer_id
        LEFT JOIN customer_sites s ON s.id = o.site_id
        WHERE o.id = $1
        "#,
    )
    .bind(order_id)
    .fetch_optional(&state.db)
    .await?;

    let latest_test = sqlx::query(
        r#"
        SELECT id, slump_mm,
               CAST(compressive_strength_7d_mpa AS DOUBLE PRECISION) as c7,
               CAST(compressive_strength_28d_mpa AS DOUBLE PRECISION) as c28,
               CAST(actual_cement AS DOUBLE PRECISION) as act_cement,
               CAST(actual_water AS DOUBLE PRECISION) as act_water,
               result, remarks
        FROM cube_tests
        WHERE order_id = $1
        ORDER BY created_at DESC
        LIMIT 1
        "#,
    )
    .bind(order_id)
    .fetch_optional(&state.db)
    .await?;

    let tests = sqlx::query(
        r#"
        SELECT t.id, t.load_id, t.slump_mm, t.compressive_strength_7d_mpa,
               t.compressive_strength_28d_mpa, t.testing_date,
               u.full_name as tester_name
        FROM cube_tests t
        LEFT JOIN users u ON u.id = t.tested_by
        WHERE t.order_id = $1
        ORDER BY t.created_at DESC
        "#,
    )
    .bind(order_id)
    .fetch_all(&state.db)
    .await?;

    let results: Vec<_> = tests
        .into_iter()
        .map(|t| {
            let id: Uuid = t.get("id");
            let load_id: Option<Uuid> = t.get("load_id");
            let slump: Option<i32> = t.get("slump_mm");
            let s7: Option<bigdecimal::BigDecimal> = t.get("compressive_strength_7d_mpa");
            let s28: Option<bigdecimal::BigDecimal> = t.get("compressive_strength_28d_mpa");
            let tdate: Option<chrono::NaiveDate> = t.get("testing_date");
            let tname: Option<String> = t.get("tester_name");
            json!({
                "id": id,
                "load_id": load_id,
                "slump_mm": slump,
                "compressive_strength_7d_mpa": s7,
                "compressive_strength_28d_mpa": s28,
                "testing_date": tdate,
                "tester_name": tname
            })
        })
        .collect();

    let test_json = latest_test.map(|t| {
        let slump: Option<i32> = t.get("slump_mm");
        let c7: Option<f64> = t.get("c7");
        let c28: Option<f64> = t.get("c28");
        let act_cement: Option<f64> = t.get("act_cement");
        let act_water: Option<f64> = t.get("act_water");
        let result: Option<String> = t.get("result");
        let remarks: Option<String> = t.get("remarks");
        json!({
            "slump_mm": slump,
            "cube_7d": c7,
            "cube_28d": c28,
            "actual_cement": act_cement,
            "actual_water": act_water,
            "result": result.unwrap_or_else(|| "PASS".to_string()),
            "remarks": remarks
        })
    });

    let order_json = order.map(|o| {
        let id: Uuid = o.get("id");
        let order_number: String = o.get("order_number");
        let grade: String = o.get("concrete_grade");
        let qty: Option<f64> = o.get("quantity");
        let status: String = o.get("status");
        let customer_name: String = o.get("customer_name");
        let site_name: String = o.get("site_name");
        json!({
            "id": id,
            "order_number": order_number,
            "grade": grade,
            "quantity": qty.unwrap_or(0.0),
            "status": status,
            "customer_name": customer_name,
            "site_name": site_name
        })
    });

    let order_num_val = order_json
        .as_ref()
        .and_then(|o| o.get("order_number"))
        .cloned();
    let grade_val = order_json.as_ref().and_then(|o| o.get("grade")).cloned();
    let qty_val = order_json.as_ref().and_then(|o| o.get("quantity")).cloned();
    let site_val = order_json
        .as_ref()
        .and_then(|o| o.get("site_name"))
        .cloned();

    Ok(Json(json!({
        "success": true,
        "order": order_json,
        "order_number": order_num_val,
        "grade": grade_val,
        "quantity": qty_val,
        "site_name": site_val,
        "test": test_json,
        "quality_tests": results
    })))
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

    let inv_row =
        sqlx::query("SELECT plant_id, order_id, total_amount FROM plant_invoices WHERE id = $1")
            .bind(invoice_id)
            .fetch_optional(&state.db)
            .await?
            .ok_or_else(|| AppError::NotFound("Invoice not found".to_string()))?;

    let plant_id: Uuid = inv_row.get("plant_id");
    let order_id: Option<Uuid> = inv_row.get("order_id");

    let pay_id: Uuid = sqlx::query_scalar(
        r#"
        INSERT INTO plant_payments (invoice_id, order_id, plant_id, amount, payment_method, transaction_ref, notes)
        VALUES ($1, $2, $3, $4::numeric, $5, $6, $7)
        RETURNING id
        "#,
    )
    .bind(invoice_id)
    .bind(order_id)
    .bind(plant_id)
    .bind(bigdecimal::BigDecimal::try_from(payload.amount).unwrap_or_default())
    .bind(payload.payment_method.unwrap_or_else(|| "bank_transfer".to_string()))
    .bind(payload.transaction_ref)
    .bind(payload.notes)
    .fetch_one(&state.db)
    .await?;

    sqlx::query("UPDATE plant_invoices SET status = 'PAID' WHERE id = $1")
        .bind(invoice_id)
        .execute(&state.db)
        .await?;

    if let Some(oid) = order_id {
        sqlx::query("UPDATE orders SET payment_status = 'paid', updated_at = NOW() WHERE id = $1")
            .bind(oid)
            .execute(&state.db)
            .await?;
    }

    Ok(Json(
        json!({ "success": true, "payment_id": pay_id, "message": "Payment recorded" }),
    ))
}

pub async fn approve_customer_kyc(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(profile_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["admin", "owner", "plant_owner"])?;

    sqlx::query(
        "UPDATE user_profiles SET kyc_status = 'verified', updated_at = NOW() WHERE id = $1",
    )
    .bind(profile_id)
    .execute(&state.db)
    .await?;

    Ok(Json(
        json!({ "success": true, "message": "KYC profile approved" }),
    ))
}

pub async fn reject_customer_kyc(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(profile_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["admin", "owner", "plant_owner"])?;

    sqlx::query(
        "UPDATE user_profiles SET kyc_status = 'rejected', updated_at = NOW() WHERE id = $1",
    )
    .bind(profile_id)
    .execute(&state.db)
    .await?;

    Ok(Json(
        json!({ "success": true, "message": "KYC profile rejected" }),
    ))
}

pub async fn reset_customer_kyc(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(profile_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["admin", "owner", "plant_owner"])?;

    sqlx::query(
        "UPDATE user_profiles SET kyc_status = 'unverified', updated_at = NOW() WHERE id = $1",
    )
    .bind(profile_id)
    .execute(&state.db)
    .await?;

    Ok(Json(
        json!({ "success": true, "message": "KYC profile reset for re-verification" }),
    ))
}
