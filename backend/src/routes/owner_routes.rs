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

    let plants=sqlx::query_as::<_,crate::models::plant::RmcPlant>("SELECT p.* FROM rmc_plants p WHERE p.owner_id=$1 OR ($2='admin' AND EXISTS(SELECT 1 FROM plant_staff ps WHERE ps.plant_id=p.id AND ps.user_id=$1 AND ps.is_active=TRUE)) ORDER BY p.created_at DESC")
      .bind(auth_user.user_id).bind(&auth_user.role).fetch_all(&state.db).await?;

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

    let active_mixers:i64=sqlx::query_scalar("SELECT COUNT(*) FROM transit_mixers tm JOIN rmc_plants p ON p.id=tm.plant_id WHERE tm.status<>'inactive' AND (p.owner_id=$1 OR ($2='admin' AND EXISTS(SELECT 1 FROM plant_staff ps WHERE ps.plant_id=p.id AND ps.user_id=$1 AND ps.is_active=TRUE)))").bind(auth_user.user_id).bind(&auth_user.role).fetch_one(&state.db).await?;
    let monthly_volume_m3:f64=sqlx::query_scalar("SELECT COALESCE(SUM(o.total_quantity_m3),0)::DOUBLE PRECISION FROM orders o JOIN rmc_plants p ON p.id=o.plant_id WHERE o.created_at>=date_trunc('month',CURRENT_DATE) AND (p.owner_id=$1 OR ($2='admin' AND EXISTS(SELECT 1 FROM plant_staff ps WHERE ps.plant_id=p.id AND ps.user_id=$1 AND ps.is_active=TRUE)))").bind(auth_user.user_id).bind(&auth_user.role).fetch_one(&state.db).await?;

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

    let query=format!("{} WHERE p.owner_id=$1 OR ($2='admin' AND EXISTS(SELECT 1 FROM plant_staff ps WHERE ps.plant_id=p.id AND ps.user_id=$1 AND ps.is_active=TRUE)) ORDER BY o.created_at DESC LIMIT 500",crate::services::order_service::MOBILE_ORDER_SELECT);
    let orders: Vec<serde_json::Value> = sqlx::query_scalar(&query)
        .bind(auth_user.user_id)
        .bind(&auth_user.role)
        .fetch_all(&state.db)
        .await?;
    Ok(Json(json!({"success":true,"orders":orders})))
}

pub async fn approve_order(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(order_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["owner", "plant_owner", "admin"])?;

    super::loads_routes::ensure_order_access(&state, &auth_user, order_id, false).await?;
    let mut tx = state.db.begin().await?;
    let current: String = sqlx::query_scalar("SELECT status FROM orders WHERE id=$1 FOR UPDATE")
        .bind(order_id)
        .fetch_one(&mut *tx)
        .await?;
    if current != "confirmed" && current != "pending" {
        return Err(AppError::Conflict(
            "Only a pending order can be reviewed".into(),
        ));
    }
    if current != "confirmed" {
        sqlx::query("UPDATE orders SET status=$2,updated_at=NOW() WHERE id=$1")
            .bind(order_id)
            .bind("confirmed")
            .execute(&mut *tx)
            .await?;
        sqlx::query("INSERT INTO audit_logs(user_id,action,resource_type,resource_id,metadata) VALUES($1,'order_review','order',$2,$3)").bind(auth_user.user_id).bind(order_id.to_string()).bind(json!({"from":current,"to":"confirmed"})).execute(&mut *tx).await?;
    }
    tx.commit().await?;

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

    super::loads_routes::ensure_order_access(&state, &auth_user, order_id, false).await?;
    let mut tx = state.db.begin().await?;
    let current: String = sqlx::query_scalar("SELECT status FROM orders WHERE id=$1 FOR UPDATE")
        .bind(order_id)
        .fetch_one(&mut *tx)
        .await?;
    if current != "rejected" && current != "pending" {
        return Err(AppError::Conflict(
            "Only a pending order can be reviewed".into(),
        ));
    }
    if current != "rejected" {
        sqlx::query("UPDATE orders SET status=$2,updated_at=NOW() WHERE id=$1")
            .bind(order_id)
            .bind("rejected")
            .execute(&mut *tx)
            .await?;
        sqlx::query("INSERT INTO audit_logs(user_id,action,resource_type,resource_id,metadata) VALUES($1,'order_review','order',$2,$3)").bind(auth_user.user_id).bind(order_id.to_string()).bind(json!({"from":current,"to":"rejected"})).execute(&mut *tx).await?;
    }
    tx.commit().await?;

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
        WHERE p.owner_id = $1 OR ($2='admin' AND EXISTS(SELECT 1 FROM plant_staff scope WHERE scope.plant_id=p.id AND scope.user_id=$1 AND scope.is_active=TRUE))
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
        WHERE (p.owner_id = $1 OR ($2='admin' AND EXISTS(SELECT 1 FROM plant_staff scope WHERE scope.plant_id=p.id AND scope.user_id=$1 AND scope.is_active=TRUE))) AND (ps.role = 'driver' OR u.role = 'driver')
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
        WHERE EXISTS(SELECT 1 FROM rmc_plants p WHERE (p.owner_id=$1 OR ($2='admin' AND EXISTS(SELECT 1 FROM plant_staff a WHERE a.plant_id=p.id AND a.user_id=$1 AND a.is_active=TRUE))) AND (EXISTS(SELECT 1 FROM order_loads l JOIN orders o ON o.id=l.order_id WHERE l.id=s.load_id AND o.plant_id=p.id) OR (s.load_id IS NULL AND EXISTS(SELECT 1 FROM plant_staff d WHERE d.plant_id=p.id AND d.user_id=s.driver_id AND d.is_active=TRUE))))
        ORDER BY s.created_at DESC
        LIMIT 50
        "#,
    )
    .bind(auth_user.user_id).bind(&auth_user.role)
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

    let updated=sqlx::query("UPDATE driver_sos_alerts s SET status='RESOLVED',resolved_by=$1,resolved_at=COALESCE(resolved_at,NOW()) WHERE s.id=$3 AND EXISTS(SELECT 1 FROM rmc_plants p WHERE (p.owner_id=$1 OR ($2='admin' AND EXISTS(SELECT 1 FROM plant_staff a WHERE a.plant_id=p.id AND a.user_id=$1 AND a.is_active=TRUE))) AND (EXISTS(SELECT 1 FROM order_loads l JOIN orders o ON o.id=l.order_id WHERE l.id=s.load_id AND o.plant_id=p.id) OR (s.load_id IS NULL AND EXISTS(SELECT 1 FROM plant_staff d WHERE d.plant_id=p.id AND d.user_id=s.driver_id AND d.is_active=TRUE))))").bind(auth_user.user_id).bind(&auth_user.role).bind(incident_id).execute(&state.db).await?;
    if updated.rows_affected() != 1 {
        return Err(AppError::NotFound(
            "Incident not found in your plants".into(),
        ));
    }

    Ok(Json(
        json!({ "success": true, "message": "Incident resolved" }),
    ))
}

pub async fn list_owner_invoices(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["owner", "plant_owner", "admin"])?;

    let invoices:Vec<serde_json::Value>=sqlx::query_scalar("SELECT jsonb_build_object('id',i.id,'invoice_number',i.invoice_number,'invoice_date',i.invoice_date,'order_number',o.order_number,'customer_name',u.full_name,'grade',o.concrete_grade,'quantity',o.total_quantity_m3::DOUBLE PRECISION,'subtotal_amount',i.subtotal_amount::DOUBLE PRECISION,'tax_amount',i.tax_amount::DOUBLE PRECISION,'total_amount',i.total_amount::DOUBLE PRECISION,'total',i.total_amount::DOUBLE PRECISION,'paid',COALESCE(pay.paid,0)::DOUBLE PRECISION,'balance',(i.total_amount-COALESCE(pay.paid,0))::DOUBLE PRECISION,'status',i.status,'plant_name',p.name) FROM plant_invoices i JOIN rmc_plants p ON p.id=i.plant_id LEFT JOIN orders o ON o.id=i.order_id LEFT JOIN users u ON u.id=i.customer_id LEFT JOIN LATERAL(SELECT SUM(amount) paid FROM plant_payments WHERE invoice_id=i.id) pay ON TRUE WHERE p.owner_id=$1 OR ($2='admin' AND EXISTS(SELECT 1 FROM plant_staff s WHERE s.plant_id=p.id AND s.user_id=$1 AND s.is_active=TRUE)) ORDER BY i.created_at DESC")
 .bind(auth_user.user_id).bind(&auth_user.role).fetch_all(&state.db).await?;
    let billed: f64 = invoices
        .iter()
        .map(|v| v["total"].as_f64().unwrap_or(0.0))
        .sum();
    let received: f64 = invoices
        .iter()
        .map(|v| v["paid"].as_f64().unwrap_or(0.0))
        .sum();
    Ok(Json(
        json!({"success":true,"invoices":invoices,"summary":{"billed":billed,"received":received,"outstanding":billed-received}}),
    ))
}

#[derive(Debug, Deserialize, Serialize)]
pub struct OwnerPaymentPayload {
    pub invoice_id: Option<Uuid>,
    pub amount: f64,
    pub payment_method: Option<String>,
    pub transaction_ref: Option<String>,
    pub request_id: Option<String>,
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
    let result = crate::services::billing_service::payment(
        state,
        auth_user,
        invoice_id,
        crate::services::billing_service::PaymentInput {
            amount: payload.amount,
            payment_method: payload.payment_method,
            transaction_ref: payload.transaction_ref,
            notes: None,
            request_id: payload.request_id,
        },
    )
    .await?;
    Ok(Json(result).into_response())
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
        WHERE pl.owner_id = $1 OR ($2='admin' AND EXISTS(SELECT 1 FROM plant_staff scope WHERE scope.plant_id=pl.id AND scope.user_id=$1 AND scope.is_active=TRUE))
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
        WHERE pl.owner_id = $1 OR ($2='admin' AND EXISTS(SELECT 1 FROM plant_staff scope WHERE scope.plant_id=pl.id AND scope.user_id=$1 AND scope.is_active=TRUE))
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
            let date: chrono::NaiveDate = p.get("payment_date");
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
        WHERE p.owner_id = $1 OR ($2='admin' AND EXISTS(SELECT 1 FROM plant_staff scope WHERE scope.plant_id=p.id AND scope.user_id=$1 AND scope.is_active=TRUE))
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

pub async fn create_order_invoice(
    State(state): State<AppState>,
    user: AuthUser,
    Path(order): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    Ok(Json(
        crate::services::billing_service::create_invoice(&state, &user, order).await?,
    ))
}
