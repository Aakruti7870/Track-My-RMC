use crate::{
    auth::{middleware::check_role, AuthUser},
    error::AppError,
    models::{order::CreateOrderRequest, plant::CreateSiteRequest},
    repositories::plant_repo,
    services::order_service,
    state::AppState,
};
use axum::{
    extract::{Path, Query, State},
    response::IntoResponse,
    Json,
};
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::Row;
use uuid::Uuid;

pub async fn list_plants(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<impl IntoResponse, AppError> {
    let review_customer: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM play_review_fixtures WHERE user_id = $1 AND role = 'customer' AND enabled = TRUE)",
    )
    .bind(auth_user.user_id)
    .fetch_one(&state.db)
    .await?;
    let review_plant_ids: Vec<Uuid> = sqlx::query_scalar(
        "SELECT plant_id FROM play_review_fixtures WHERE role = 'customer' AND enabled = TRUE AND plant_id IS NOT NULL",
    )
    .bind(auth_user.user_id)
    .fetch_all(&state.db)
    .await?;
    let mut plants = plant_repo::list_plants(&state.db).await?;
    plants.retain(|plant| {
        let is_review_plant = review_plant_ids.contains(&plant.id);
        if review_customer {
            is_review_plant
        } else {
            !is_review_plant
        }
    });
    Ok(Json(json!({ "success": true, "plants": plants })))
}

#[derive(Debug, Deserialize)]
pub struct ComparePlantsQuery {
    pub grade: String,
    pub quantity: f64,
    pub lat: Option<f64>,
    pub lng: Option<f64>,
    #[serde(default)]
    pub pump_required: bool,
}

pub async fn compare_plants(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Query(query): Query<ComparePlantsQuery>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["customer", "admin", "owner", "plant_owner"])?;

    if query.quantity <= 0.0 {
        return Err(AppError::BadRequest(
            "Quantity must be greater than zero".to_string(),
        ));
    }

    let rows = sqlx::query(
        r#"
        SELECT 
            p.id as plant_id,
            p.name as plant_name,
            p.city,
            p.state as district,
            p.latitude,
            p.longitude,
            rc.grade,
            CAST(rc.rate_per_m3 AS DOUBLE PRECISION) as rate_per_m3,
            CAST(rc.gst_rate AS DOUBLE PRECISION) as gst_rate,
            CAST(rc.transport_rate_per_km AS DOUBLE PRECISION) as transport_rate_per_km,
            CAST(rc.pumping_rate_per_m3 AS DOUBLE PRECISION) as pumping_rate_per_m3
        FROM plant_rate_cards rc
        JOIN rmc_plants p ON p.id = rc.plant_id
        WHERE rc.active = TRUE
          AND p.is_active = TRUE
          AND LOWER(rc.grade) = LOWER($1)
        "#,
    )
    .bind(&query.grade)
    .fetch_all(&state.db)
    .await?;

    let mut estimates = Vec::new();

    for row in rows {
        let plant_id: Uuid = row.get("plant_id");
        let plant_name: String = row.get("plant_name");
        let city: Option<String> = row.get("city");
        let district: Option<String> = row.get("district");
        let plat: f64 = row.get("latitude");
        let plng: f64 = row.get("longitude");
        let grade: String = row.get("grade");
        let rate_per_m3: f64 = row.get("rate_per_m3");
        let gst_rate: f64 = row.get("gst_rate");
        let transport_rate_per_km: f64 = row.get("transport_rate_per_km");
        let pumping_rate_per_m3: f64 = row.get("pumping_rate_per_m3");

        let distance_km = match (query.lat, query.lng) {
            (Some(ulat), Some(ulng)) => Some(crate::utils::geo::haversine_distance_km(
                ulat, ulng, plat, plng,
            )),
            _ => None,
        };

        let base_amount = (rate_per_m3 * query.quantity * 100.0).round() / 100.0;
        let transport_amount =
            distance_km.map(|d| ((transport_rate_per_km * d) * 100.0).round() / 100.0);
        let pumping_amount = if query.pump_required {
            Some(((pumping_rate_per_m3 * query.quantity) * 100.0).round() / 100.0)
        } else {
            None
        };

        let subtotal =
            base_amount + transport_amount.unwrap_or(0.0) + pumping_amount.unwrap_or(0.0);
        let gst_amount = ((subtotal * gst_rate / 100.0) * 100.0).round() / 100.0;
        let estimated_total = ((subtotal + gst_amount) * 100.0).round() / 100.0;
        let service_area_km = 50.0;
        let within_service_area = distance_km.map(|d| d <= service_area_km);

        estimates.push(json!({
            "plant_id": plant_id.to_string(),
            "plant_name": plant_name,
            "city": city,
            "district": district,
            "verified": true,
            "grade": grade,
            "rate_per_m3": rate_per_m3,
            "gst_rate": gst_rate,
            "distance_km": distance_km.map(|d| (d * 100.0).round() / 100.0),
            "service_area_km": service_area_km,
            "within_service_area": within_service_area,
            "base_amount": base_amount,
            "transport_amount": transport_amount,
            "pumping_amount": pumping_amount,
            "gst_amount": gst_amount,
            "estimated_total": estimated_total,
            "transport_included": transport_amount.is_some()
        }));
    }

    estimates.sort_by(|a, b| {
        let total_a = a["estimated_total"].as_f64().unwrap_or(f64::MAX);
        let total_b = b["estimated_total"].as_f64().unwrap_or(f64::MAX);
        total_a
            .partial_cmp(&total_b)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let count = estimates.len();
    Ok(Json(json!({
        "estimates": estimates,
        "count": count,
        "disclaimer": "Estimate only. Final price, delivery eligibility and tax invoice require plant confirmation."
    })))
}

pub async fn get_grades() -> impl IntoResponse {
    Json(json!({
        "success": true,
        "grades": ["M-10", "M-15", "M-20", "M-25", "M-30", "M-35", "M-40", "M-45"]
    }))
}

pub async fn list_sites(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<impl IntoResponse, AppError> {
    let sites = plant_repo::list_customer_sites(&state.db, auth_user.user_id).await?;
    Ok(Json(json!({ "success": true, "sites": sites })))
}

pub async fn create_site(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Json(req): Json<CreateSiteRequest>,
) -> Result<impl IntoResponse, AppError> {
    let site = sqlx::query_as::<_, crate::models::plant::CustomerSite>(
        r#"
        INSERT INTO customer_sites (customer_id, name, address_line, city, state, pincode, latitude, longitude, contact_person, contact_phone)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING id, customer_id, name, address_line, city, state, pincode, latitude, longitude, contact_person, contact_phone, created_at
        "#,
    )
    .bind(auth_user.user_id)
    .bind(&req.name)
    .bind(&req.address_line)
    .bind(&req.city)
    .bind(&req.state)
    .bind(&req.pincode)
    .bind(req.latitude)
    .bind(req.longitude)
    .bind(&req.contact_person)
    .bind(&req.contact_phone)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(json!({ "success": true, "site": site })))
}

pub async fn place_order(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Json(req): Json<CreateOrderRequest>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["customer", "owner", "admin"])?;
    let order = order_service::place_order(&state, auth_user.user_id, req).await?;
    Ok(Json(json!({
        "success": true,
        "order_id": order.id,
        "order_number": order.order_number,
        "order": order,
    })))
}

pub async fn list_orders(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<impl IntoResponse, AppError> {
    let query = format!(
        "{} WHERE o.customer_id=$1 ORDER BY o.created_at DESC LIMIT 500",
        order_service::MOBILE_ORDER_SELECT
    );
    let orders: Vec<serde_json::Value> = sqlx::query_scalar(&query)
        .bind(auth_user.user_id)
        .fetch_all(&state.db)
        .await?;
    Ok(Json(json!({"success":true,"orders":orders})))
}

pub async fn get_order_details(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    Ok(Json(
        order_service::mobile_detail(&state, &auth_user, id).await?,
    ))
}

pub async fn get_customer_home(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<impl IntoResponse, AppError> {
    let active_orders: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM orders WHERE customer_id = $1 AND status NOT IN ('delivered', 'cancelled')",
    )
    .bind(auth_user.user_id)
    .fetch_one(&state.db)
    .await?;

    let completed_orders: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM orders WHERE customer_id = $1 AND status = 'delivered'",
    )
    .bind(auth_user.user_id)
    .fetch_one(&state.db)
    .await?;

    let total_spent: bigdecimal::BigDecimal = sqlx::query_scalar(
        "SELECT COALESCE(SUM(total_amount), 0) FROM orders WHERE customer_id = $1 AND payment_status = 'paid'",
    )
    .bind(auth_user.user_id)
    .fetch_one(&state.db)
    .await?;

    let profile = sqlx::query("SELECT kyc_status FROM user_profiles WHERE user_id = $1")
        .bind(auth_user.user_id)
        .fetch_optional(&state.db)
        .await?;

    let kyc_status: String = profile
        .as_ref()
        .and_then(|p| p.get("kyc_status"))
        .unwrap_or_else(|| "unverified".to_string());

    Ok(Json(json!({
        "success": true,
        "metrics": {
            "active_orders": active_orders,
            "completed_orders": completed_orders,
            "total_spent": total_spent,
            "kyc_status": kyc_status
        }
    })))
}

pub async fn cancel_order(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(order_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    let order = sqlx::query("SELECT customer_id, status FROM orders WHERE id = $1")
        .bind(order_id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("Order not found".to_string()))?;

    let cid: Uuid = order.get("customer_id");
    let status: String = order.get("status");

    if cid != auth_user.user_id && auth_user.role != "admin" {
        return Err(AppError::Forbidden("Unauthorized".to_string()));
    }

    if !matches!(status.to_lowercase().as_str(), "pending" | "confirmed") {
        return Err(AppError::BadRequest(
            "Cannot cancel order once production or dispatch has begun".to_string(),
        ));
    }

    sqlx::query("UPDATE orders SET status = 'cancelled', updated_at = NOW() WHERE id = $1")
        .bind(order_id)
        .execute(&state.db)
        .await?;

    sqlx::query("UPDATE order_loads SET status = 'cancelled' WHERE order_id = $1")
        .bind(order_id)
        .execute(&state.db)
        .await?;

    Ok(Json(
        json!({ "success": true, "message": "Order cancelled successfully" }),
    ))
}

pub async fn get_order_tracking(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(order_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    let order =
        sqlx::query("SELECT customer_id, plant_id, site_id, status FROM orders WHERE id = $1")
            .bind(order_id)
            .fetch_optional(&state.db)
            .await?
            .ok_or_else(|| AppError::NotFound("Order not found".to_string()))?;

    let cid: Uuid = order.get("customer_id");
    let status: String = order.get("status");

    if cid != auth_user.user_id && auth_user.role != "admin" {
        return Err(AppError::Forbidden("Unauthorized".to_string()));
    }

    let active_loads = sqlx::query(
        r#"
        SELECT l.id as load_id, l.load_number, l.status,
               m.registration_number, m.last_latitude, m.last_longitude, m.last_ping_at,
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

    let tracking: Vec<_> = active_loads
        .into_iter()
        .map(|l| {
            let load_id: Uuid = l.get("load_id");
            let load_number: i32 = l.get("load_number");
            let load_status: String = l.get("status");
            let mixer_number: Option<String> = l.get("registration_number");
            let driver_name: Option<String> = l.get("driver_name");
            let driver_phone: Option<String> = l.get("driver_phone");
            let latitude: Option<f64> = l.get("last_latitude");
            let longitude: Option<f64> = l.get("last_longitude");
            let last_ping: Option<chrono::DateTime<chrono::Utc>> = l.get("last_ping_at");

            json!({
                "load_id": load_id,
                "load_number": load_number,
                "status": load_status,
                "mixer_number": mixer_number,
                "driver_name": driver_name,
                "driver_phone": driver_phone,
                "latitude": latitude,
                "longitude": longitude,
                "last_ping_at": last_ping
            })
        })
        .collect();

    Ok(Json(
        json!({ "success": true, "order_status": status, "loads": tracking }),
    ))
}

pub async fn get_order_challan(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(order_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    let order_customer: Uuid = sqlx::query_scalar("SELECT customer_id FROM orders WHERE id = $1")
        .bind(order_id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("Order not found".to_string()))?;

    if order_customer != auth_user.user_id && auth_user.role != "admin" {
        return Err(AppError::Forbidden("Unauthorized".to_string()));
    }

    let challan = sqlx::query(
        r#"
        SELECT c.id, c.challan_number, c.plant_code, c.customer_name, c.site_address,
               c.concrete_grade, c.quantity_m3, c.slump_mm, c.water_cement_ratio,
               c.batch_time, c.mixer_number, c.driver_name, c.digital_signature,
               c.status, c.created_at
        FROM challans c
        INNER JOIN order_loads l ON l.id = c.load_id
        WHERE l.order_id = $1
        ORDER BY c.created_at DESC
        LIMIT 1
        "#,
    )
    .bind(order_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Challan not yet generated for this order".to_string()))?;

    let cid: Uuid = challan.get("id");
    let cnum: String = challan.get("challan_number");
    let pcode: String = challan.get("plant_code");
    let cname: String = challan.get("customer_name");
    let saddr: String = challan.get("site_address");
    let grade: String = challan.get("concrete_grade");
    let qty: bigdecimal::BigDecimal = challan.get("quantity_m3");
    let slump: Option<i32> = challan.get("slump_mm");
    let btime: Option<chrono::DateTime<chrono::Utc>> = challan.get("batch_time");
    let mnum: Option<String> = challan.get("mixer_number");
    let dname: Option<String> = challan.get("driver_name");
    let sig: Option<String> = challan.get("digital_signature");
    let cstatus: String = challan.get("status");

    Ok(Json(json!({
        "success": true,
        "challan": {
            "id": cid,
            "challan_number": cnum,
            "plant_code": pcode,
            "customer_name": cname,
            "site_address": saddr,
            "grade": grade,
            "quantity_m3": qty,
            "slump_mm": slump,
            "batch_time": btime,
            "mixer_number": mnum,
            "driver_name": dname,
            "signature": sig,
            "status": cstatus
        }
    })))
}

#[derive(Debug, Deserialize, Serialize)]
pub struct CustomerRfqPayload {
    pub plant_id: Uuid,
    pub site_id: Option<Uuid>,
    pub site_name: Option<String>,
    pub site_address: Option<String>,
    pub grade: String,
    pub quantity_m3: Option<f64>,
    pub quantity: Option<f64>,
    pub required_date: Option<String>,
    pub pump_required: Option<bool>,
    pub notes: Option<String>,
}

pub async fn create_quotation_request(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Json(payload): Json<CustomerRfqPayload>,
) -> Result<impl IntoResponse, AppError> {
    let req_date = match &payload.required_date {
        Some(d) => NaiveDate::parse_from_str(d, "%Y-%m-%d").map_err(|_| {
            AppError::BadRequest("Invalid required_date, expected YYYY-MM-DD".to_string())
        })?,
        None => chrono::Utc::now().date_naive() + chrono::Duration::days(1),
    };

    let quantity = payload.quantity_m3.or(payload.quantity).unwrap_or(6.0);
    if quantity <= 0.0 {
        return Err(AppError::BadRequest(
            "Quantity must be greater than zero".to_string(),
        ));
    }

    let id: Uuid = sqlx::query_scalar(
        r#"
        INSERT INTO customer_quotation_requests (
            customer_id, plant_id, site_id, grade, quantity_m3, required_date, notes, status
        )
        VALUES ($1, $2, $3, $4, $5::numeric, $6, $7, 'PENDING')
        RETURNING id
        "#,
    )
    .bind(auth_user.user_id)
    .bind(payload.plant_id)
    .bind(payload.site_id)
    .bind(&payload.grade)
    .bind(quantity)
    .bind(req_date)
    .bind(&payload.notes)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(
        json!({ "success": true, "id": id, "message": "Quotation request submitted" }),
    ))
}

pub async fn list_customer_rfqs(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<impl IntoResponse, AppError> {
    let rows = sqlx::query(
        r#"
        SELECT r.id, r.plant_id, r.grade, r.quantity_m3, r.required_date, r.status, r.notes, r.created_at,
               p.name as plant_name, p.contact_phone as plant_phone
        FROM customer_quotation_requests r
        INNER JOIN rmc_plants p ON p.id = r.plant_id
        WHERE r.customer_id = $1
        ORDER BY r.created_at DESC
        "#,
    )
    .bind(auth_user.user_id)
    .fetch_all(&state.db)
    .await?;

    let rfqs: Vec<_> = rows
        .into_iter()
        .map(|r| {
            let id: Uuid = r.get("id");
            let plant_id: Uuid = r.get("plant_id");
            let grade: String = r.get("grade");
            let quantity_m3: bigdecimal::BigDecimal = r.get("quantity_m3");
            let required_date: chrono::NaiveDate = r.get("required_date");
            let status: String = r.get("status");
            let notes: Option<String> = r.get("notes");
            let created_at: chrono::DateTime<chrono::Utc> = r.get("created_at");
            let plant_name: String = r.get("plant_name");
            let plant_phone: Option<String> = r.get("plant_phone");

            json!({
                "id": id,
                "plant_id": plant_id,
                "plant_name": plant_name,
                "plant_phone": plant_phone,
                "grade": grade,
                "quantity_m3": quantity_m3,
                "required_date": required_date,
                "status": status,
                "notes": notes,
                "created_at": created_at
            })
        })
        .collect();

    Ok(Json(json!({ "success": true, "requests": rfqs })))
}

#[derive(Debug, Deserialize, Serialize)]
pub struct CreatePourPlanPayload {
    pub site_id: Uuid,
    pub grade: String,
    pub total_quantity_m3: f64,
    pub mixer_capacity_m3: Option<f64>,
    pub pour_date: String,
    pub start_time: String,
    pub unload_minutes: Option<i32>,
    pub discharge_mode: Option<String>,
    pub notes: Option<String>,
}

pub async fn create_pour_plan(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Json(payload): Json<CreatePourPlanPayload>,
) -> Result<impl IntoResponse, AppError> {
    let p_date = NaiveDate::parse_from_str(&payload.pour_date, "%Y-%m-%d")
        .map_err(|_| AppError::BadRequest("Invalid pour_date format".to_string()))?;

    let cap = payload.mixer_capacity_m3.unwrap_or(6.0);
    let unload = payload.unload_minutes.unwrap_or(30);
    let mode = payload.discharge_mode.unwrap_or_else(|| "PUMP".to_string());

    let id: Uuid = sqlx::query_scalar(
        r#"
        INSERT INTO customer_pour_plans (
            customer_id, site_id, grade, total_quantity_m3, mixer_capacity_m3,
            pour_date, start_time, unload_minutes, discharge_mode, notes
        )
        VALUES ($1, $2, $3, $4::numeric, $5::numeric, $6, $7, $8, $9, $10)
        RETURNING id
        "#,
    )
    .bind(auth_user.user_id)
    .bind(payload.site_id)
    .bind(&payload.grade)
    .bind(payload.total_quantity_m3)
    .bind(cap)
    .bind(p_date)
    .bind(&payload.start_time)
    .bind(unload)
    .bind(&mode)
    .bind(&payload.notes)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(
        json!({ "success": true, "id": id, "message": "Pour plan created" }),
    ))
}

pub async fn list_pour_plans(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<impl IntoResponse, AppError> {
    let rows = sqlx::query(
        r#"
        SELECT p.id, p.site_id, p.grade, p.total_quantity_m3, p.mixer_capacity_m3,
               p.pour_date, p.start_time, p.unload_minutes, p.discharge_mode, p.notes, p.created_at,
               s.name as site_name, s.address_line as site_address
        FROM customer_pour_plans p
        INNER JOIN customer_sites s ON s.id = p.site_id
        WHERE p.customer_id = $1
        ORDER BY p.pour_date DESC
        "#,
    )
    .bind(auth_user.user_id)
    .fetch_all(&state.db)
    .await?;

    let plans: Vec<_> = rows
        .into_iter()
        .map(|r| {
            let id: Uuid = r.get("id");
            let site_id: Uuid = r.get("site_id");
            let site_name: String = r.get("site_name");
            let site_address: String = r.get("site_address");
            let grade: String = r.get("grade");
            let total_quantity_m3: bigdecimal::BigDecimal = r.get("total_quantity_m3");
            let mixer_capacity_m3: bigdecimal::BigDecimal = r.get("mixer_capacity_m3");
            let pour_date: chrono::NaiveDate = r.get("pour_date");
            let start_time: String = r.get("start_time");
            let unload_minutes: i32 = r.get("unload_minutes");
            let discharge_mode: String = r.get("discharge_mode");
            let notes: Option<String> = r.get("notes");

            json!({
                "id": id,
                "site_id": site_id,
                "site_name": site_name,
                "site_address": site_address,
                "grade": grade,
                "total_quantity_m3": total_quantity_m3,
                "mixer_capacity_m3": mixer_capacity_m3,
                "pour_date": pour_date,
                "start_time": start_time,
                "unload_minutes": unload_minutes,
                "discharge_mode": discharge_mode,
                "notes": notes
            })
        })
        .collect();

    Ok(Json(json!({ "success": true, "pour_plans": plans })))
}

pub async fn delete_pour_plan(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(plan_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    let res = sqlx::query("DELETE FROM customer_pour_plans WHERE id = $1 AND customer_id = $2")
        .bind(plan_id)
        .bind(auth_user.user_id)
        .execute(&state.db)
        .await?;

    if res.rows_affected() == 0 {
        return Err(AppError::NotFound("Plan not found".to_string()));
    }

    Ok(Json(
        json!({ "success": true, "message": "Pour plan deleted" }),
    ))
}

#[derive(Debug, Deserialize, Serialize)]
pub struct CreateReceivingRecordPayload {
    pub site_id: Uuid,
    pub order_id: Option<Uuid>,
    pub grade: String,
    pub received_quantity_m3: f64,
    pub challan_number: Option<String>,
    pub tm_number: Option<String>,
    pub observed_slump_mm: Option<f64>,
    pub notes: Option<String>,
}

pub async fn create_receiving_record(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Json(payload): Json<CreateReceivingRecordPayload>,
) -> Result<impl IntoResponse, AppError> {
    let id: Uuid = sqlx::query_scalar(
        r#"
        INSERT INTO customer_receiving_records (
            customer_id, site_id, order_id, grade, received_quantity_m3,
            challan_number, tm_number, observed_slump_mm, notes
        )
        VALUES ($1, $2, $3, $4, $5::numeric, $6, $7, $8::numeric, $9)
        RETURNING id
        "#,
    )
    .bind(auth_user.user_id)
    .bind(payload.site_id)
    .bind(payload.order_id)
    .bind(&payload.grade)
    .bind(payload.received_quantity_m3)
    .bind(&payload.challan_number)
    .bind(&payload.tm_number)
    .bind(payload.observed_slump_mm)
    .bind(&payload.notes)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(
        json!({ "success": true, "id": id, "message": "Receiving record logged" }),
    ))
}

pub async fn list_receiving_records(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<impl IntoResponse, AppError> {
    let rows = sqlx::query(
        r#"
        SELECT r.id, r.site_id, r.order_id, r.grade, r.received_quantity_m3,
               r.challan_number, r.tm_number, r.observed_slump_mm, r.notes, r.created_at,
               s.name as site_name
        FROM customer_receiving_records r
        INNER JOIN customer_sites s ON s.id = r.site_id
        WHERE r.customer_id = $1
        ORDER BY r.created_at DESC
        "#,
    )
    .bind(auth_user.user_id)
    .fetch_all(&state.db)
    .await?;

    let records: Vec<_> = rows
        .into_iter()
        .map(|r| {
            let id: Uuid = r.get("id");
            let site_id: Uuid = r.get("site_id");
            let site_name: String = r.get("site_name");
            let order_id: Option<Uuid> = r.get("order_id");
            let grade: String = r.get("grade");
            let received_quantity_m3: bigdecimal::BigDecimal = r.get("received_quantity_m3");
            let challan_number: Option<String> = r.get("challan_number");
            let tm_number: Option<String> = r.get("tm_number");
            let observed_slump_mm: Option<bigdecimal::BigDecimal> = r.get("observed_slump_mm");
            let notes: Option<String> = r.get("notes");
            let created_at: chrono::DateTime<chrono::Utc> = r.get("created_at");

            json!({
                "id": id,
                "site_id": site_id,
                "site_name": site_name,
                "order_id": order_id,
                "grade": grade,
                "received_quantity_m3": received_quantity_m3,
                "challan_number": challan_number,
                "tm_number": tm_number,
                "observed_slump_mm": observed_slump_mm,
                "notes": notes,
                "created_at": created_at
            })
        })
        .collect();

    Ok(Json(json!({ "success": true, "records": records })))
}

#[derive(Debug, Deserialize, Serialize)]
pub struct CubeResultPayload {
    pub sample_id: String,
    pub age_days: i32,
    pub tested_on: String,
    pub result_mpa: f64,
    pub lab_name: Option<String>,
    pub report_reference: Option<String>,
}

pub async fn add_cube_test_result(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(record_id): Path<Uuid>,
    Json(payload): Json<CubeResultPayload>,
) -> Result<impl IntoResponse, AppError> {
    let rec_cust: Uuid =
        sqlx::query_scalar("SELECT customer_id FROM customer_receiving_records WHERE id = $1")
            .bind(record_id)
            .fetch_optional(&state.db)
            .await?
            .ok_or_else(|| AppError::NotFound("Receiving record not found".to_string()))?;

    if rec_cust != auth_user.user_id && auth_user.role != "admin" {
        return Err(AppError::Forbidden("Unauthorized".to_string()));
    }

    let t_date = NaiveDate::parse_from_str(&payload.tested_on, "%Y-%m-%d")
        .map_err(|_| AppError::BadRequest("Invalid tested_on date".to_string()))?;

    let id: Uuid = sqlx::query_scalar(
        r#"
        INSERT INTO cube_test_results (
            record_id, sample_id, age_days, tested_on, result_mpa, lab_name, report_reference
        )
        VALUES ($1, $2, $3, $4, $5::numeric, $6, $7)
        RETURNING id
        "#,
    )
    .bind(record_id)
    .bind(&payload.sample_id)
    .bind(payload.age_days)
    .bind(t_date)
    .bind(payload.result_mpa)
    .bind(&payload.lab_name)
    .bind(&payload.report_reference)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(
        json!({ "success": true, "id": id, "message": "Cube test result recorded" }),
    ))
}

pub async fn delete_receiving_record(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(record_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    let res =
        sqlx::query("DELETE FROM customer_receiving_records WHERE id = $1 AND customer_id = $2")
            .bind(record_id)
            .bind(auth_user.user_id)
            .execute(&state.db)
            .await?;

    if res.rows_affected() == 0 {
        return Err(AppError::NotFound("Record not found".to_string()));
    }

    Ok(Json(
        json!({ "success": true, "message": "Record deleted" }),
    ))
}

pub async fn get_customer_kyc(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<impl IntoResponse, AppError> {
    let profile = sqlx::query(
        "SELECT kyc_status, verified_name, gst_number FROM user_profiles WHERE user_id = $1",
    )
    .bind(auth_user.user_id)
    .fetch_optional(&state.db)
    .await?;

    let kyc_status: String = profile
        .as_ref()
        .and_then(|p| p.get("kyc_status"))
        .unwrap_or_else(|| "unverified".to_string());
    let verified_name: Option<String> = profile.as_ref().and_then(|p| p.get("verified_name"));
    let gst_number: Option<String> = profile.as_ref().and_then(|p| p.get("gst_number"));

    Ok(Json(json!({
        "success": true,
        "kyc_status": kyc_status,
        "verified_name": verified_name,
        "gst_number": gst_number
    })))
}

pub async fn start_customer_kyc(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<impl IntoResponse, AppError> {
    let callback_url = "https://trackmyrmc.com/kyc/return";

    sqlx::query(
        "UPDATE user_profiles SET kyc_status = 'pending', updated_at = NOW() WHERE user_id = $1",
    )
    .bind(auth_user.user_id)
    .execute(&state.db)
    .await?;

    Ok(Json(json!({
        "success": true,
        "status": "pending",
        "authorization_url": callback_url
    })))
}
