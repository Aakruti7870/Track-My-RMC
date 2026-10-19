use crate::{
    auth::{middleware::check_role, AuthUser},
    error::AppError,
    models::plant::CreatePlantRequest,
    repositories::plant_repo,
    state::AppState,
};
use axum::{
    extract::{Path, Query, State},
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

async fn visible_plant_ids(state: &AppState, user: &AuthUser) -> Result<Vec<Uuid>, AppError> {
    sqlx::query_scalar("SELECT p.id FROM rmc_plants p WHERE p.is_active AND (p.owner_id=$1 OR ($2='admin' AND EXISTS(SELECT 1 FROM plant_staff ps WHERE ps.plant_id=p.id AND ps.user_id=$1 AND ps.is_active))) ORDER BY p.id")
        .bind(user.user_id).bind(&user.role).fetch_all(&state.db).await.map_err(AppError::from)
}

pub async fn get_owner_home(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["owner", "plant_owner", "admin"])?;
    let ids = visible_plant_ids(&state, &auth_user).await?;
    let plants:Vec<serde_json::Value>=sqlx::query_scalar("SELECT jsonb_build_object('id',id,'name',name) FROM rmc_plants WHERE id=ANY($1) ORDER BY name,id").bind(&ids).fetch_all(&state.db).await?;
    let cards:serde_json::Value=sqlx::query_scalar(r#"SELECT jsonb_build_object(
        'pending_approvals',(SELECT count(*) FROM orders WHERE plant_id=ANY($1) AND lower(status)='pending'),
        'todays_orders',(SELECT count(*) FROM orders WHERE plant_id=ANY($1) AND delivery_date=CURRENT_DATE AND lower(status) NOT IN('draft','cancelled','rejected')),
        'ordered_qty',(SELECT coalesce(sum(total_quantity_m3),0)::double precision FROM orders WHERE plant_id=ANY($1) AND delivery_date=CURRENT_DATE AND lower(status) NOT IN('draft','cancelled','rejected')),
        'dispatched_qty',(SELECT coalesce(sum(l.quantity_m3),0)::double precision FROM order_loads l JOIN orders o ON o.id=l.order_id WHERE o.plant_id=ANY($1) AND l.dispatched_at::date=CURRENT_DATE),
        'delivered_qty',(SELECT coalesce(sum(d.delivered_quantity),0)::double precision FROM proof_of_deliveries d JOIN order_loads l ON l.id=d.load_id JOIN orders o ON o.id=l.order_id WHERE o.plant_id=ANY($1) AND d.delivered_at::date=CURRENT_DATE),
        'dispatched_loads',(SELECT count(*) FROM order_loads l JOIN orders o ON o.id=l.order_id WHERE o.plant_id=ANY($1) AND l.dispatched_at::date=CURRENT_DATE),
        'active_staff',(SELECT count(DISTINCT user_id) FROM plant_staff WHERE plant_id=ANY($1) AND is_active=TRUE),
        'active_mixers',(SELECT count(*) FROM transit_mixers WHERE plant_id=ANY($1) AND status IN('dispatched','in_transit','pouring'))
    )"#).bind(&ids).fetch_one(&state.db).await?;
    let query=format!("{} WHERE o.plant_id=ANY($1) AND lower(o.status)='pending' ORDER BY o.created_at,o.id LIMIT 50",crate::services::order_service::MOBILE_ORDER_SELECT);
    let pending: Vec<serde_json::Value> = sqlx::query_scalar(&query)
        .bind(&ids)
        .fetch_all(&state.db)
        .await?;
    let received:f64=sqlx::query_scalar("SELECT coalesce(sum(amount),0)::double precision FROM plant_payments WHERE plant_id=ANY($1) AND invoice_id IS NOT NULL AND payment_date>=date_trunc('month',CURRENT_DATE)::date").bind(&ids).fetch_one(&state.db).await?;
    Ok(Json(
        json!({"plant_count":plants.len(),"plants":plants,"cards":cards,"pending_orders":pending,"window_date":chrono::Utc::now().date_naive(),"kpis":{"total_plants":ids.len(),"pending_orders":cards["pending_approvals"],"in_transit_mixers":cards["active_mixers"],"month_revenue":received}}),
    ))
}

/// Optional filters retain the legacy 500-record response for existing callers.
/// The owner dashboard opts into bounded 30-record pages. All predicates are
/// parameterized and remain inside the original owner/admin plant boundary.
#[derive(Debug, Default, Deserialize)]
pub struct OwnerOrderQuery {
    limit: Option<i64>,
    offset: Option<i64>,
    status: Option<String>,
    q: Option<String>,
    date_from: Option<chrono::NaiveDate>,
    date_to: Option<chrono::NaiveDate>,
    plant_id: Option<Uuid>,
    grade: Option<String>,
    today: Option<bool>,
}

fn owner_order_states(status: &str) -> Result<Vec<String>, AppError> {
    let states: &[&str] = match status {
        "all" | "" => &[],
        "pending" => &["pending"],
        "processing" => &[
            "confirmed",
            "accepted",
            "scheduled",
            "in_production",
            "produced",
            "production_complete",
            "tm_assigned",
            "driver_assigned",
            "ready_to_dispatch",
            "dispatched",
            "in_transit",
            "en_route",
            "at_site",
            "pouring",
            "unloading",
            "pod_pending",
        ],
        "delivered" => &["completed", "delivered"],
        "cancelled" => &["cancelled", "rejected"],
        "draft" => &["draft"],
        _ => return Err(AppError::BadRequest("Unsupported order filter".into())),
    };
    Ok(states.iter().map(|state| (*state).to_string()).collect())
}

pub async fn list_owner_orders(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Query(filters): Query<OwnerOrderQuery>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["owner", "plant_owner", "admin"])?;
    let limit = filters.limit.unwrap_or(500).clamp(1, 500);
    let offset = filters.offset.unwrap_or(0).max(0);
    let statuses = owner_order_states(filters.status.as_deref().unwrap_or("all"))?;
    if filters
        .date_from
        .zip(filters.date_to)
        .is_some_and(|(from, to)| from > to)
    {
        return Err(AppError::BadRequest("Invalid delivery date range".into()));
    }
    let search = filters.q.unwrap_or_default().trim().to_lowercase();
    // strpos treats percent/underscore literally, unlike an unescaped LIKE query.
    let query = format!(
        r#"{} WHERE
        (p.owner_id=$1 OR ($2='admin' AND EXISTS(SELECT 1 FROM plant_staff ps WHERE ps.plant_id=p.id AND ps.user_id=$1 AND ps.is_active=TRUE)))
        AND (cardinality($3::text[])=0 OR lower(o.status)=ANY($3))
        AND ($4='' OR strpos(lower(concat_ws(' ',o.order_number,u.full_name,s.name,s.address_line)), $4)>0)
        AND ($5::date IS NULL OR o.delivery_date >= $5)
        AND ($6::date IS NULL OR o.delivery_date <= $6)
        AND ($7::uuid IS NULL OR o.plant_id=$7)
        AND ($8::text IS NULL OR lower(o.concrete_grade)=lower($8))
        AND (NOT $9::boolean OR o.delivery_date=CURRENT_DATE)
        ORDER BY o.created_at DESC,o.id DESC LIMIT $10 OFFSET $11"#,
        crate::services::order_service::MOBILE_ORDER_SELECT
    );
    let mut orders: Vec<serde_json::Value> = sqlx::query_scalar(&query)
        .bind(auth_user.user_id)
        .bind(&auth_user.role)
        .bind(&statuses)
        .bind(&search)
        .bind(filters.date_from)
        .bind(filters.date_to)
        .bind(filters.plant_id)
        .bind(filters.grade.filter(|grade| !grade.trim().is_empty()))
        .bind(filters.today.unwrap_or(false))
        .bind(limit + 1)
        .bind(offset)
        .fetch_all(&state.db)
        .await?;
    let has_more = orders.len() > limit as usize;
    orders.truncate(limit as usize);
    Ok(Json(
        json!({"success":true,"orders":orders,"has_more":has_more,"limit":limit,"offset":offset}),
    ))
}

#[cfg(test)]
mod owner_dashboard_tests {
    use super::owner_order_states;

    #[test]
    fn processing_excludes_pending_and_terminal_states() {
        let states = owner_order_states("processing").unwrap();
        for status in [
            "confirmed",
            "in_production",
            "produced",
            "in_transit",
            "pouring",
        ] {
            assert!(states.iter().any(|state| state == status));
        }
        for status in ["pending", "completed", "delivered", "cancelled", "rejected"] {
            assert!(!states.iter().any(|state| state == status));
        }
        assert!(owner_order_states("unknown").is_err());
    }
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
    let ids = visible_plant_ids(&state, &auth_user).await?;
    let days:Vec<(chrono::NaiveDate,f64,f64,f64)>=sqlx::query_as(r#"
        SELECT day::date,
            (SELECT coalesce(sum(total_quantity_m3),0)::double precision FROM orders WHERE plant_id=ANY($1) AND delivery_date=day::date AND lower(status) NOT IN('draft','cancelled','rejected')),
            (SELECT coalesce(sum(d.delivered_quantity),0)::double precision FROM proof_of_deliveries d JOIN order_loads l ON l.id=d.load_id JOIN orders o ON o.id=l.order_id WHERE o.plant_id=ANY($1) AND d.delivered_at::date=day::date),
            (SELECT coalesce(sum(amount),0)::double precision FROM plant_payments WHERE plant_id=ANY($1) AND invoice_id IS NOT NULL AND payment_date=day::date)
        FROM generate_series(CURRENT_DATE-6,CURRENT_DATE,INTERVAL '1 day') day ORDER BY day
    "#).bind(&ids).fetch_all(&state.db).await?;
    let labels: Vec<String> = days.iter().map(|d| d.0.format("%a").to_string()).collect();
    let ordered: Vec<f64> = days.iter().map(|d| d.1).collect();
    let delivered: Vec<f64> = days.iter().map(|d| d.2).collect();
    let payments: Vec<f64> = days.iter().map(|d| d.3).collect();
    Ok(Json(
        json!({"labels":labels,"dates":days.iter().map(|d|d.0).collect::<Vec<_>>(),"ordered":ordered,"delivered":delivered,"payments":payments,"totals":{"ordered":ordered.iter().sum::<f64>(),"delivered":delivered.iter().sum::<f64>(),"payments":payments.iter().sum::<f64>()},"quantity_source":"RECORDED_POD","payment_source":"RECORDED_INVOICE_PAYMENTS"}),
    ))
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
