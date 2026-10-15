use crate::{
    auth::{middleware::check_role, AuthUser},
    error::AppError,
    models::plant::CreatePlantRequest,
    repositories::plant_repo,
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
            "plant_owner",
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
        "owner" | "plant_owner" => {
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
    check_role(&auth_user, &["owner", "plant_owner", "admin"])?;

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
    check_role(&auth_user, &["owner", "plant_owner", "admin"])?;
    let plant = plant_repo::create_plant(
        &state.db,
        crate::repositories::plant_repo::NewPlant {
            owner_id: auth_user.user_id,
            name: &req.name,
            code: &req.code,
            lat: req.latitude,
            lng: req.longitude,
            address_line: &req.address_line,
            city: &req.city,
            state: &req.state,
            pincode: &req.pincode,
            contact_phone: &req.contact_phone,
            contact_email: req.contact_email.as_deref(),
            capacity: req.capacity_m3_per_hr.unwrap_or(60.0),
        },
    )
    .await?;

    Ok(Json(json!({ "success": true, "plant": plant })))
}

pub async fn get_billing_overview(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["owner", "plant_owner", "admin"])?;

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

pub async fn get_owner_home(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["owner", "plant_owner", "admin"])?;

    let plants_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM rmc_plants WHERE owner_id = $1 AND is_active = TRUE",
    )
    .bind(auth_user.user_id)
    .fetch_one(&state.db)
    .await?;

    let pending_orders: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM orders o INNER JOIN rmc_plants p ON p.id = o.plant_id WHERE p.owner_id = $1 AND o.status = 'pending'"
    )
    .bind(auth_user.user_id)
    .fetch_one(&state.db)
    .await?;

    let in_transit: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM transit_mixers m INNER JOIN rmc_plants p ON p.id = m.plant_id WHERE p.owner_id = $1 AND m.status IN ('dispatched', 'in_transit', 'pouring')"
    )
    .bind(auth_user.user_id)
    .fetch_one(&state.db)
    .await?;

    let revenue_month: bigdecimal::BigDecimal = sqlx::query_scalar(
        r#"
        SELECT COALESCE(SUM(o.total_amount), 0)
        FROM orders o
        INNER JOIN rmc_plants p ON p.id = o.plant_id
        WHERE p.owner_id = $1 AND o.payment_status = 'paid'
          AND o.created_at >= date_trunc('month', CURRENT_DATE)
        "#,
    )
    .bind(auth_user.user_id)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(json!({
        "success": true,
        "kpis": {
            "total_plants": plants_count,
            "pending_orders": pending_orders,
            "in_transit_mixers": in_transit,
            "month_revenue": revenue_month
        }
    })))
}

pub async fn list_owner_orders(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["owner", "plant_owner", "admin"])?;

    let rows = sqlx::query(
        r#"
        SELECT o.id, o.order_number, o.concrete_grade, o.total_quantity_m3, o.delivery_date,
               o.total_amount, o.status, o.payment_status, o.created_at,
               p.name as plant_name, u.full_name as customer_name, s.name as site_name
        FROM orders o
        INNER JOIN rmc_plants p ON p.id = o.plant_id
        INNER JOIN users u ON u.id = o.customer_id
        INNER JOIN customer_sites s ON s.id = o.site_id
        WHERE p.owner_id = $1 OR $2 = 'admin'
        ORDER BY o.created_at DESC
        "#,
    )
    .bind(auth_user.user_id)
    .bind(&auth_user.role)
    .fetch_all(&state.db)
    .await?;

    let orders: Vec<_> = rows
        .into_iter()
        .map(|r| {
            let id: Uuid = r.get("id");
            let order_number: String = r.get("order_number");
            let plant_name: String = r.get("plant_name");
            let customer_name: String = r.get("customer_name");
            let site_name: String = r.get("site_name");
            let grade: String = r.get("concrete_grade");
            let quantity_m3: bigdecimal::BigDecimal = r.get("total_quantity_m3");
            let delivery_date: chrono::NaiveDate = r.get("delivery_date");
            let total_amount: bigdecimal::BigDecimal = r.get("total_amount");
            let status: String = r.get("status");
            let payment_status: String = r.get("payment_status");
            let created_at: chrono::DateTime<chrono::Utc> = r.get("created_at");

            json!({
                "id": id,
                "order_number": order_number,
                "plant_name": plant_name,
                "customer_name": customer_name,
                "site_name": site_name,
                "grade": grade,
                "quantity_m3": quantity_m3,
                "delivery_date": delivery_date,
                "total_amount": total_amount,
                "status": status,
                "payment_status": payment_status,
                "created_at": created_at
            })
        })
        .collect();

    Ok(Json(json!({ "success": true, "orders": orders })))
}

pub async fn approve_order(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(order_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["owner", "plant_owner", "admin"])?;

    sqlx::query("UPDATE orders SET status = 'confirmed', updated_at = NOW() WHERE id = $1")
        .bind(order_id)
        .execute(&state.db)
        .await?;

    Ok(Json(
        json!({ "success": true, "message": "Order approved" }),
    ))
}

pub async fn reject_order(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(order_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["owner", "plant_owner", "admin"])?;

    sqlx::query("UPDATE orders SET status = 'rejected', updated_at = NOW() WHERE id = $1")
        .bind(order_id)
        .execute(&state.db)
        .await?;

    Ok(Json(
        json!({ "success": true, "message": "Order rejected" }),
    ))
}

pub async fn list_owner_fleet(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["owner", "plant_owner", "admin"])?;

    let rows = sqlx::query(
        r#"
        SELECT m.id, m.registration_number, m.capacity_m3, m.status,
               m.last_latitude, m.last_longitude, m.last_ping_at,
               p.name as plant_name, u.full_name as driver_name
        FROM transit_mixers m
        INNER JOIN rmc_plants p ON p.id = m.plant_id
        LEFT JOIN users u ON u.id = m.driver_id
        WHERE p.owner_id = $1 OR $2 = 'admin'
        ORDER BY p.name, m.registration_number
        "#,
    )
    .bind(auth_user.user_id)
    .bind(&auth_user.role)
    .fetch_all(&state.db)
    .await?;

    let fleet: Vec<_> = rows
        .into_iter()
        .map(|r| {
            let id: Uuid = r.get("id");
            let reg: String = r.get("registration_number");
            let cap: bigdecimal::BigDecimal = r.get("capacity_m3");
            let st: String = r.get("status");
            let plant_name: String = r.get("plant_name");
            let driver_name: Option<String> = r.get("driver_name");
            let lat: Option<f64> = r.get("last_latitude");
            let lon: Option<f64> = r.get("last_longitude");
            let ping: Option<chrono::DateTime<chrono::Utc>> = r.get("last_ping_at");

            json!({
                "id": id,
                "registration_number": reg,
                "capacity_m3": cap,
                "status": st,
                "plant_name": plant_name,
                "driver_name": driver_name,
                "last_latitude": lat,
                "last_longitude": lon,
                "last_ping_at": ping
            })
        })
        .collect();

    Ok(Json(json!({ "success": true, "fleet": fleet })))
}

pub async fn list_owner_drivers(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["owner", "plant_owner", "admin"])?;

    let rows = sqlx::query(
        r#"
        SELECT u.id, u.full_name, u.phone, u.email,
               p.name as plant_name, m.registration_number as vehicle
        FROM plant_staff ps
        INNER JOIN rmc_plants p ON p.id = ps.plant_id
        INNER JOIN users u ON u.id = ps.user_id
        LEFT JOIN transit_mixers m ON m.driver_id = u.id AND m.plant_id = p.id
        WHERE (p.owner_id = $1 OR $2 = 'admin') AND (ps.role = 'driver' OR u.role = 'driver')
        ORDER BY p.name, u.full_name
        "#,
    )
    .bind(auth_user.user_id)
    .bind(&auth_user.role)
    .fetch_all(&state.db)
    .await?;

    let drivers: Vec<_> = rows
        .into_iter()
        .map(|r| {
            let id: Uuid = r.get("id");
            let name: String = r.get("full_name");
            let phone: Option<String> = r.get("phone");
            let email: Option<String> = r.get("email");
            let plant_name: String = r.get("plant_name");
            let vehicle: Option<String> = r.get("vehicle");

            json!({
                "id": id,
                "name": name,
                "phone": phone,
                "email": email,
                "plant_name": plant_name,
                "assigned_vehicle": vehicle
            })
        })
        .collect();

    Ok(Json(json!({ "success": true, "drivers": drivers })))
}

pub async fn list_owner_incidents(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["owner", "plant_owner", "admin"])?;

    let rows = sqlx::query(
        r#"
        SELECT s.id, s.alert_type, s.message, s.status, s.latitude, s.longitude, s.created_at, s.resolved_at,
               u.full_name as driver_name, u.phone as driver_phone
        FROM driver_sos_alerts s
        INNER JOIN users u ON u.id = s.driver_id
        ORDER BY s.created_at DESC
        LIMIT 50
        "#,
    )
    .fetch_all(&state.db)
    .await?;

    let incidents: Vec<_> = rows
        .into_iter()
        .map(|r| {
            let id: Uuid = r.get("id");
            let alert_type: String = r.get("alert_type");
            let message: Option<String> = r.get("message");
            let status: String = r.get("status");
            let lat: Option<f64> = r.get("latitude");
            let lon: Option<f64> = r.get("longitude");
            let created_at: chrono::DateTime<chrono::Utc> = r.get("created_at");
            let resolved_at: Option<chrono::DateTime<chrono::Utc>> = r.get("resolved_at");
            let driver_name: String = r.get("driver_name");
            let driver_phone: Option<String> = r.get("driver_phone");

            json!({
                "id": id,
                "alert_type": alert_type,
                "message": message,
                "status": status,
                "latitude": lat,
                "longitude": lon,
                "driver_name": driver_name,
                "driver_phone": driver_phone,
                "created_at": created_at,
                "resolved_at": resolved_at
            })
        })
        .collect();

    Ok(Json(json!({ "success": true, "incidents": incidents })))
}

pub async fn resolve_incident(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(incident_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["owner", "plant_owner", "admin"])?;

    sqlx::query(
        "UPDATE driver_sos_alerts SET status = 'RESOLVED', resolved_by = $1, resolved_at = NOW() WHERE id = $2",
    )
    .bind(auth_user.user_id)
    .bind(incident_id)
    .execute(&state.db)
    .await?;

    Ok(Json(
        json!({ "success": true, "message": "Incident resolved" }),
    ))
}

pub async fn list_owner_invoices(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["owner", "plant_owner", "admin"])?;

    let rows = sqlx::query(
        r#"
        SELECT i.id, i.invoice_number, i.invoice_date, i.subtotal_amount, i.tax_amount,
               i.total_amount, i.status, i.created_at,
               p.name as plant_name, u.full_name as customer_name
        FROM plant_invoices i
        INNER JOIN rmc_plants p ON p.id = i.plant_id
        LEFT JOIN users u ON u.id = i.customer_id
        WHERE p.owner_id = $1 OR $2 = 'admin'
        ORDER BY i.created_at DESC
        "#,
    )
    .bind(auth_user.user_id)
    .bind(&auth_user.role)
    .fetch_all(&state.db)
    .await?;

    let invoices: Vec<_> = rows
        .into_iter()
        .map(|r| {
            let id: Uuid = r.get("id");
            let inv_num: String = r.get("invoice_number");
            let inv_date: chrono::NaiveDate = r.get("invoice_date");
            let subtotal: bigdecimal::BigDecimal = r.get("subtotal_amount");
            let tax: bigdecimal::BigDecimal = r.get("tax_amount");
            let total: bigdecimal::BigDecimal = r.get("total_amount");
            let status: String = r.get("status");
            let plant_name: String = r.get("plant_name");
            let customer_name: Option<String> = r.get("customer_name");
            let created_at: chrono::DateTime<chrono::Utc> = r.get("created_at");

            json!({
                "id": id,
                "invoice_number": inv_num,
                "invoice_date": inv_date,
                "subtotal_amount": subtotal,
                "tax_amount": tax,
                "total_amount": total,
                "status": status,
                "plant_name": plant_name,
                "customer_name": customer_name,
                "created_at": created_at
            })
        })
        .collect();

    Ok(Json(json!({ "success": true, "invoices": invoices })))
}

#[derive(Debug, Deserialize, Serialize)]
pub struct OwnerPaymentPayload {
    pub invoice_id: Option<Uuid>,
    pub amount: f64,
    pub payment_method: Option<String>,
    pub transaction_ref: Option<String>,
}

pub async fn record_owner_invoice_payment(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(invoice_id): Path<Uuid>,
    Json(payload): Json<OwnerPaymentPayload>,
) -> Result<impl IntoResponse, AppError> {
    record_owner_payment_internal(&state, &auth_user, invoice_id, payload).await
}

pub async fn record_owner_payment(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Json(payload): Json<OwnerPaymentPayload>,
) -> Result<impl IntoResponse, AppError> {
    let invoice_id = payload
        .invoice_id
        .ok_or_else(|| AppError::BadRequest("invoice_id is required".to_string()))?;
    record_owner_payment_internal(&state, &auth_user, invoice_id, payload).await
}

async fn record_owner_payment_internal(
    state: &AppState,
    auth_user: &AuthUser,
    invoice_id: Uuid,
    payload: OwnerPaymentPayload,
) -> Result<axum::response::Response, AppError> {
    check_role(auth_user, &["owner", "plant_owner", "admin"])?;

    let inv_row = sqlx::query("SELECT plant_id, order_id FROM plant_invoices WHERE id = $1")
        .bind(invoice_id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("Invoice not found".to_string()))?;

    let plant_id: Uuid = inv_row.get("plant_id");
    let order_id: Option<Uuid> = inv_row.get("order_id");

    let id: Uuid = sqlx::query_scalar(
        r#"
        INSERT INTO plant_payments (invoice_id, order_id, plant_id, amount, payment_method, transaction_ref)
        VALUES ($1, $2, $3, $4::numeric, $5, $6)
        RETURNING id
        "#,
    )
    .bind(invoice_id)
    .bind(order_id)
    .bind(plant_id)
    .bind(bigdecimal::BigDecimal::try_from(payload.amount).unwrap_or_default())
    .bind(payload.payment_method.unwrap_or_else(|| "bank_transfer".to_string()))
    .bind(payload.transaction_ref)
    .fetch_one(&state.db)
    .await?;

    sqlx::query("UPDATE plant_invoices SET status = 'PAID' WHERE id = $1")
        .bind(invoice_id)
        .execute(&state.db)
        .await?;

    Ok(
        Json(json!({ "success": true, "payment_id": id, "message": "Payment recorded" }))
            .into_response(),
    )
}

pub async fn get_owner_ledger(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["owner", "plant_owner", "admin"])?;

    let payments = sqlx::query(
        r#"
        SELECT p.id, p.amount, p.payment_method, p.transaction_ref, p.payment_date,
               pl.name as plant_name, i.invoice_number
        FROM plant_payments p
        INNER JOIN rmc_plants pl ON pl.id = p.plant_id
        LEFT JOIN plant_invoices i ON i.id = p.invoice_id
        WHERE pl.owner_id = $1 OR $2 = 'admin'
        ORDER BY p.payment_date DESC, p.created_at DESC
        LIMIT 50
        "#,
    )
    .bind(auth_user.user_id)
    .bind(&auth_user.role)
    .fetch_all(&state.db)
    .await?;

    let expenses = sqlx::query(
        r#"
        SELECT e.id, e.category, e.amount, e.expense_date, e.vendor, e.payment_method,
               pl.name as plant_name
        FROM plant_expenses e
        INNER JOIN rmc_plants pl ON pl.id = e.plant_id
        WHERE pl.owner_id = $1 OR $2 = 'admin'
        ORDER BY e.expense_date DESC, e.created_at DESC
        LIMIT 50
        "#,
    )
    .bind(auth_user.user_id)
    .bind(&auth_user.role)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(json!({
        "success": true,
        "credits": payments.into_iter().map(|p| {
            let id: Uuid = p.get("id");
            let amount: bigdecimal::BigDecimal = p.get("amount");
            let method: String = p.get("payment_method");
            let reference: Option<String> = p.get("transaction_ref");
            let date: chrono::DateTime<chrono::Utc> = p.get("payment_date");
            let plant_name: String = p.get("plant_name");
            let invoice_number: Option<String> = p.get("invoice_number");
            json!({
                "id": id,
                "amount": amount,
                "method": method,
                "reference": reference,
                "date": date,
                "plant_name": plant_name,
                "invoice_number": invoice_number
            })
        }).collect::<Vec<_>>(),
        "debits": expenses.into_iter().map(|e| {
            let id: Uuid = e.get("id");
            let category: String = e.get("category");
            let amount: bigdecimal::BigDecimal = e.get("amount");
            let date: chrono::NaiveDate = e.get("expense_date");
            let vendor: Option<String> = e.get("vendor");
            let method: Option<String> = e.get("payment_method");
            let plant_name: String = e.get("plant_name");
            json!({
                "id": id,
                "category": category,
                "amount": amount,
                "date": date,
                "vendor": vendor,
                "method": method,
                "plant_name": plant_name
            })
        }).collect::<Vec<_>>()
    })))
}

pub async fn get_owner_insights(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["owner", "plant_owner", "admin"])?;

    let grade_distribution = sqlx::query(
        r#"
        SELECT o.concrete_grade, COUNT(o.id) as order_count, SUM(o.total_quantity_m3) as total_m3
        FROM orders o
        INNER JOIN rmc_plants p ON p.id = o.plant_id
        WHERE p.owner_id = $1 OR $2 = 'admin'
        GROUP BY o.concrete_grade
        ORDER BY total_m3 DESC
        "#,
    )
    .bind(auth_user.user_id)
    .bind(&auth_user.role)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(json!({
        "success": true,
        "insights": {
            "top_grades": grade_distribution.into_iter().map(|g| {
                let grade: String = g.get("concrete_grade");
                let count: i64 = g.get("order_count");
                let volume: Option<bigdecimal::BigDecimal> = g.get("total_m3");
                json!({
                    "grade": grade,
                    "orders": count,
                    "volume_m3": volume
                })
            }).collect::<Vec<_>>()
        }
    })))
}
