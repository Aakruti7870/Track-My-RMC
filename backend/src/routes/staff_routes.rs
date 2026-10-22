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
    let plant_name: String =
        sqlx::query_scalar("SELECT name FROM rmc_plants WHERE id = $1 AND is_active = TRUE")
            .bind(plant_id)
            .fetch_one(&state.db)
            .await?;
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
        "plant_name": plant_name,
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
    super::staff_module_permissions::require(
        &state,
        &auth_user,
        plant_id,
        "fleet_availability",
        super::staff_module_permissions::Action::View,
    )
    .await?;

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
    super::staff_module_permissions::require(
        &state,
        &auth_user,
        plant_id,
        "fleet_availability",
        super::staff_module_permissions::Action::View,
    )
    .await?;

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

    super::loads_routes::ensure_order_access(&state, &auth_user, order_id, false).await?;
    super::staff_module_permissions::require_order(
        &state,
        &auth_user,
        order_id,
        "dispatch_queue",
        super::staff_module_permissions::Action::View,
    )
    .await?;
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

    super::loads_routes::ensure_order_access(&state, &auth_user, order_id, false).await?;
    super::staff_module_permissions::require_order(
        &state,
        &auth_user,
        order_id,
        "dispatch_queue",
        super::staff_module_permissions::Action::Edit,
    )
    .await?;
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

    let belongs: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM order_loads WHERE id=$1 AND order_id=$2)")
            .bind(load_id)
            .bind(order_id)
            .fetch_one(&state.db)
            .await?;
    if !belongs {
        return Err(AppError::NotFound("Load not found for this order".into()));
    }
    let driver:Option<Uuid>=sqlx::query_scalar("SELECT COALESCE(m.driver_id,l.driver_id) FROM transit_mixers m CROSS JOIN order_loads l WHERE m.id=$1 AND l.id=$2").bind(payload.mixer_id).bind(load_id).fetch_optional(&state.db).await?.flatten();
    let mixer = payload.mixer_id;
    let driver = driver.ok_or_else(|| {
        AppError::Conflict("Select both mixer and driver through the load assignment form".into())
    })?;
    Ok(super::loads_routes::assign_load_mixer_driver(
        State(state),
        auth_user,
        Path(load_id),
        Json(super::loads_routes::AssignLoadPayload {
            vehicle_id: None,
            mixer_id: Some(mixer),
            driver_id: Some(driver),
        }),
    )
    .await?
    .into_response())
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

    super::loads_routes::ensure_order_access(&state, &auth_user, order_id, false).await?;
    super::staff_module_permissions::require_order(
        &state,
        &auth_user,
        order_id,
        "dispatch_queue",
        super::staff_module_permissions::Action::Edit,
    )
    .await?;
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

    let belongs: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM order_loads WHERE id=$1 AND order_id=$2)")
            .bind(load_id)
            .bind(order_id)
            .fetch_one(&state.db)
            .await?;
    if !belongs {
        return Err(AppError::NotFound("Load not found for this order".into()));
    }
    let mixer: Option<Uuid> = sqlx::query_scalar("SELECT mixer_id FROM order_loads WHERE id=$1")
        .bind(load_id)
        .fetch_one(&state.db)
        .await?;
    let mixer = mixer.ok_or_else(|| {
        AppError::Conflict("Select a mixer and driver through the load assignment form".into())
    })?;
    let driver = payload.driver_id;
    Ok(super::loads_routes::assign_load_mixer_driver(
        State(state),
        auth_user,
        Path(load_id),
        Json(super::loads_routes::AssignLoadPayload {
            vehicle_id: None,
            mixer_id: Some(mixer),
            driver_id: Some(driver),
        }),
    )
    .await?
    .into_response())
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

    super::loads_routes::ensure_order_access(&state, &auth_user, order_id, false).await?;
    super::staff_module_permissions::require_order(
        &state,
        &auth_user,
        order_id,
        "challan_gate_pass",
        super::staff_module_permissions::Action::Edit,
    )
    .await?;
    let load:Uuid=sqlx::query_scalar("SELECT id FROM order_loads WHERE order_id=$1 AND status<>'cancelled' ORDER BY load_number LIMIT 1").bind(order_id).fetch_optional(&state.db).await?.ok_or_else(||AppError::NotFound("No active load for this order".into()))?;
    crate::services::load_lifecycle::advance(&state.db, load, auth_user.user_id, "prepare").await?;
    let (id, number): (Uuid, String) =
        sqlx::query_as("SELECT id,challan_number FROM challans WHERE load_id=$1")
            .bind(load)
            .fetch_one(&state.db)
            .await?;
    Ok(Json(
        json!({"success":true,"challan_id":id,"challan_number":number}),
    ))
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

    super::loads_routes::ensure_order_access(&state, &auth_user, order_id, false).await?;
    super::staff_module_permissions::require_order(
        &state,
        &auth_user,
        order_id,
        "dispatch_queue",
        super::staff_module_permissions::Action::Edit,
    )
    .await?;
    let loads:Vec<Uuid>=sqlx::query_scalar("SELECT id FROM order_loads WHERE order_id=$1 AND status NOT IN ('cancelled','completed','delivered') ORDER BY load_number").bind(order_id).fetch_all(&state.db).await?;
    if loads.len() != 1 {
        return Err(AppError::Conflict(
            "Dispatch each delivery load through its individual dispatch action".into(),
        ));
    }
    crate::services::load_lifecycle::advance(&state.db, loads[0], auth_user.user_id, "dispatch")
        .await?;
    Ok(Json(json!({"success":true,"message":"Load dispatched"})))
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
    pub sample_date: Option<chrono::NaiveDate>,
    pub tested_on: Option<chrono::NaiveDate>,
    pub request_id: Option<String>,
}

pub async fn record_quality_test(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Json(payload): Json<QualityTestPayload>,
) -> Result<impl IntoResponse, AppError> {
    Ok(Json(
        crate::services::quality_service::record(&state, &auth_user, payload).await?,
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

    super::loads_routes::ensure_order_access(&state, &auth_user, order_id, false).await?;
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

    let tests: Vec<serde_json::Value> = sqlx::query_scalar(
        "SELECT jsonb_build_object('id',t.id,'load_id',t.load_id,'slump_mm',t.slump_mm,
          'cube_7d',t.compressive_strength_7d_mpa::DOUBLE PRECISION,
          'cube_28d',t.compressive_strength_28d_mpa::DOUBLE PRECISION,
          'compressive_strength_7d_mpa',t.compressive_strength_7d_mpa::DOUBLE PRECISION,
          'compressive_strength_28d_mpa',t.compressive_strength_28d_mpa::DOUBLE PRECISION,
          'actual_cement',t.actual_cement::DOUBLE PRECISION,'actual_water',t.actual_water::DOUBLE PRECISION,
          'temperature_celsius',t.temperature_celsius::DOUBLE PRECISION,'visual_inspection',t.visual_inspection,
          'result',t.result,'remarks',t.remarks,'sample_date',t.sample_date,'testing_date',t.testing_date,
          'record_source',t.record_source,'recorded_at',t.created_at,'tester_name',u.full_name)
         FROM cube_tests t LEFT JOIN users u ON u.id=t.tested_by WHERE t.order_id=$1
         ORDER BY t.created_at DESC,t.id DESC LIMIT 500",
    ).bind(order_id).fetch_all(&state.db).await?;
    let test_json = tests.first().cloned();
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
        "quality_tests": tests
    })))
}

#[derive(Debug, Deserialize, Serialize)]
pub struct RecordInvoicePaymentPayload {
    pub amount: f64,
    pub payment_method: Option<String>,
    pub transaction_ref: Option<String>,
    pub notes: Option<String>,
    pub request_id: Option<String>,
}

pub async fn record_invoice_payment(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(invoice_id): Path<Uuid>,
    Json(payload): Json<RecordInvoicePaymentPayload>,
) -> Result<impl IntoResponse, AppError> {
    Ok(Json(
        crate::services::billing_service::payment(
            &state,
            &auth_user,
            invoice_id,
            crate::services::billing_service::PaymentInput {
                amount: payload.amount,
                payment_method: payload.payment_method,
                transaction_ref: payload.transaction_ref,
                notes: payload.notes,
                request_id: payload.request_id,
            },
        )
        .await?,
    ))
}

// Only the Authority's independently approved review session may invoke this
// helper. The public route contains a *customer user ID*, not user_profiles.id.
// Keep the update and immutable audit record in one transaction.
async fn update_reviewed_customer_kyc(
    db: &sqlx::PgPool,
    actor: Uuid,
    customer_id: Uuid,
    new_status: &'static str,
) -> Result<(), AppError> {
    let mut tx = db.begin().await?;
    let updated: Option<Uuid> = sqlx::query_scalar(
        "UPDATE user_profiles AS p SET kyc_status=$2, updated_at=NOW()
         FROM users AS u
         WHERE p.user_id=$1 AND u.id=p.user_id
           AND u.role='customer' AND u.is_active=TRUE
         RETURNING p.user_id",
    )
    .bind(customer_id)
    .bind(new_status)
    .fetch_optional(&mut *tx)
    .await?;
    if updated != Some(customer_id) {
        return Err(AppError::NotFound(
            "Active customer KYC profile not found".into(),
        ));
    }
    sqlx::query(
        "INSERT INTO audit_logs (user_id, action, resource_type, resource_id, metadata)
         VALUES ($1,'authority.kyc.review','customer',$2,$3)",
    )
    .bind(actor)
    .bind(customer_id.to_string())
    .bind(json!({"kyc_status": new_status}))
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}

pub async fn approve_customer_kyc(
    State(state): State<AppState>,
    auth_user: AuthUser,
    headers: axum::http::HeaderMap,
    Path(customer_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    ensure_authority_review_session(&state, &auth_user, &headers).await?;
    update_reviewed_customer_kyc(&state.db, auth_user.user_id, customer_id, "verified").await?;
    Ok(Json(
        json!({ "success": true, "message": "KYC profile approved" }),
    ))
}

pub async fn reject_customer_kyc(
    State(state): State<AppState>,
    auth_user: AuthUser,
    headers: axum::http::HeaderMap,
    Path(customer_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    ensure_authority_review_session(&state, &auth_user, &headers).await?;
    update_reviewed_customer_kyc(&state.db, auth_user.user_id, customer_id, "rejected").await?;
    Ok(Json(
        json!({ "success": true, "message": "KYC profile rejected" }),
    ))
}

pub async fn reset_customer_kyc(
    State(state): State<AppState>,
    auth_user: AuthUser,
    headers: axum::http::HeaderMap,
    Path(customer_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    ensure_authority_review_session(&state, &auth_user, &headers).await?;
    update_reviewed_customer_kyc(&state.db, auth_user.user_id, customer_id, "unverified").await?;
    Ok(Json(
        json!({ "success": true, "message": "KYC profile reset for re-verification" }),
    ))
}

async fn ensure_authority_review_session(
    state: &AppState,
    user: &AuthUser,
    headers: &axum::http::HeaderMap,
) -> Result<(), AppError> {
    check_role(user, &["authority"])?;
    let hash = crate::auth::control_center::token_hash(headers)?;
    let approved:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM control_center_sessions s JOIN control_center_access a ON a.user_id=s.user_id WHERE s.token_hash=$1 AND s.user_id=$2 AND s.revoked_at IS NULL AND s.expires_at>NOW() AND a.approved=TRUE AND 'kyc.review'=ANY(a.permissions))").bind(hash).bind(user.user_id).fetch_one(&state.db).await?;
    if !approved {
        return Err(AppError::Forbidden(
            "Approved Authority review session is required".into(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod authority_kyc_customer_scope_tests {
    use super::update_reviewed_customer_kyc;
    use crate::error::AppError;
    use uuid::Uuid;

    #[sqlx::test]
    async fn review_uses_customer_user_id_rejects_noncustomers_and_writes_audit(
        pool: sqlx::PgPool,
    ) {
        let actor: Uuid = sqlx::query_scalar(
            "INSERT INTO users(phone,hashed_password,full_name,role)
             VALUES('kyc-auth-review','unused','Authority Reviewer','authority') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let customer: Uuid = sqlx::query_scalar(
            "INSERT INTO users(phone,hashed_password,full_name,role)
             VALUES('kyc-review-customer','unused','Customer','customer') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let owner: Uuid = sqlx::query_scalar(
            "INSERT INTO users(phone,hashed_password,full_name,role)
             VALUES('kyc-review-owner','unused','Plant Owner','plant_owner') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let profile: Uuid =
            sqlx::query_scalar("INSERT INTO user_profiles(user_id) VALUES($1) RETURNING id")
                .bind(customer)
                .fetch_one(&pool)
                .await
                .unwrap();
        sqlx::query("INSERT INTO user_profiles(user_id) VALUES($1)")
            .bind(owner)
            .execute(&pool)
            .await
            .unwrap();

        // The route uses the customer's users.id, which differs from user_profiles.id.
        assert_ne!(profile, customer);
        update_reviewed_customer_kyc(&pool, actor, customer, "verified")
            .await
            .unwrap();
        let status: String =
            sqlx::query_scalar("SELECT kyc_status FROM user_profiles WHERE user_id=$1")
                .bind(customer)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(status, "verified");
        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM audit_logs
             WHERE user_id=$1 AND resource_id=$2 AND action='authority.kyc.review'",
        )
        .bind(actor)
        .bind(customer.to_string())
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(count, 1);

        // Passing a profile primary key or a different role cannot approve KYC.
        for id in [profile, owner, Uuid::new_v4()] {
            assert!(matches!(
                update_reviewed_customer_kyc(&pool, actor, id, "verified").await,
                Err(AppError::NotFound(_))
            ));
        }
        let owner_status: String =
            sqlx::query_scalar("SELECT kyc_status FROM user_profiles WHERE user_id=$1")
                .bind(owner)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(owner_status, "unverified");
        update_reviewed_customer_kyc(&pool, actor, customer, "rejected")
            .await
            .unwrap();
        update_reviewed_customer_kyc(&pool, actor, customer, "unverified")
            .await
            .unwrap();
        let audit_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM audit_logs
             WHERE user_id=$1 AND resource_id=$2 AND action='authority.kyc.review'",
        )
        .bind(actor)
        .bind(customer.to_string())
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(audit_count, 3);
    }
}
