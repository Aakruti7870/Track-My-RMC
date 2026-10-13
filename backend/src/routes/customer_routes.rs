use crate::{
    auth::{middleware::check_role, AuthUser},
    error::AppError,
    models::{order::CreateOrderRequest, plant::CreateSiteRequest},
    repositories::{order_repo, plant_repo},
    services::order_service,
    state::AppState,
};
use axum::{
    extract::{Path, State},
    response::IntoResponse,
    Json,
};
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use serde_json::json;
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
    let orders = order_repo::list_customer_orders(&state.db, auth_user.user_id).await?;
    Ok(Json(json!({ "success": true, "orders": orders })))
}

pub async fn get_order_details(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["customer", "owner", "admin"])?;
    let customer_id: Option<Uuid> =
        sqlx::query_scalar("SELECT customer_id FROM orders WHERE id = $1")
            .bind(id)
            .fetch_optional(&state.db)
            .await?;
    if customer_id.is_none() {
        return Err(AppError::NotFound("Order not found".to_string()));
    }
    if auth_user.role == "customer" && customer_id != Some(auth_user.user_id) {
        return Err(AppError::Forbidden(
            "You are not authorized to view this order".to_string(),
        ));
    }
    let (order, loads) = order_service::get_order_with_loads(&state, id).await?;
    Ok(Json(json!({
        "success": true,
        "order": order,
        "loads": loads,
    })))
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

    let profile = sqlx::query!(
        "SELECT kyc_status FROM user_profiles WHERE user_id = $1",
        auth_user.user_id
    )
    .fetch_optional(&state.db)
    .await?;

    Ok(Json(json!({
        "success": true,
        "metrics": {
            "active_orders": active_orders,
            "completed_orders": completed_orders,
            "total_spent": total_spent,
            "kyc_status": profile.map(|p| p.kyc_status).unwrap_or_else(|| "unverified".to_string())
        }
    })))
}

pub async fn cancel_order(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(order_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    let order = sqlx::query!(
        "SELECT customer_id, status FROM orders WHERE id = $1",
        order_id
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Order not found".to_string()))?;

    if order.customer_id != auth_user.user_id && auth_user.role != "admin" {
        return Err(AppError::Forbidden("Unauthorized".to_string()));
    }

    if !matches!(order.status.to_lowercase().as_str(), "pending" | "confirmed") {
        return Err(AppError::BadRequest("Cannot cancel order once production or dispatch has begun".to_string()));
    }

    sqlx::query!("UPDATE orders SET status = 'cancelled', updated_at = NOW() WHERE id = $1", order_id)
        .execute(&state.db)
        .await?;

    sqlx::query!("UPDATE order_loads SET status = 'cancelled' WHERE order_id = $1", order_id)
        .execute(&state.db)
        .await?;

    Ok(Json(json!({ "success": true, "message": "Order cancelled successfully" })))
}

pub async fn get_order_tracking(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(order_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    let order = sqlx::query!(
        "SELECT customer_id, plant_id, site_id, status FROM orders WHERE id = $1",
        order_id
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Order not found".to_string()))?;

    if order.customer_id != auth_user.user_id && auth_user.role != "admin" {
        return Err(AppError::Forbidden("Unauthorized".to_string()));
    }

    let active_loads = sqlx::query!(
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
        order_id
    )
    .fetch_all(&state.db)
    .await?;

    let tracking: Vec<_> = active_loads.into_iter().map(|l| json!({
        "load_id": l.load_id,
        "load_number": l.load_number,
        "status": l.status,
        "mixer_number": l.registration_number,
        "driver_name": l.driver_name,
        "driver_phone": l.driver_phone,
        "latitude": l.last_latitude,
        "longitude": l.last_longitude,
        "last_ping_at": l.last_ping_at
    })).collect();

    Ok(Json(json!({ "success": true, "order_status": order.status, "loads": tracking })))
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

    let challan = sqlx::query!(
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
        order_id
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Challan not yet generated for this order".to_string()))?;

    Ok(Json(json!({
        "success": true,
        "challan": {
            "id": challan.id,
            "challan_number": challan.challan_number,
            "plant_code": challan.plant_code,
            "customer_name": challan.customer_name,
            "site_address": challan.site_address,
            "grade": challan.concrete_grade,
            "quantity_m3": challan.quantity_m3,
            "slump_mm": challan.slump_mm,
            "batch_time": challan.batch_time,
            "mixer_number": challan.mixer_number,
            "driver_name": challan.driver_name,
            "signature": challan.digital_signature,
            "status": challan.status
        }
    })))
}

// RFQs, Pour Plans, Receiving Records
#[derive(Debug, Deserialize, Serialize)]
pub struct CustomerRfqPayload {
    pub plant_id: Uuid,
    pub site_id: Option<Uuid>,
    pub grade: String,
    pub quantity_m3: f64,
    pub required_date: String,
    pub notes: Option<String>,
}

pub async fn create_quotation_request(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Json(payload): Json<CustomerRfqPayload>,
) -> Result<impl IntoResponse, AppError> {
    let req_date = NaiveDate::parse_from_str(&payload.required_date, "%Y-%m-%d")
        .map_err(|_| AppError::BadRequest("Invalid required_date, expected YYYY-MM-DD".to_string()))?;

    let id = sqlx::query_scalar!(
        r#"
        INSERT INTO customer_quotation_requests (
            customer_id, plant_id, site_id, grade, quantity_m3, required_date, notes, status
        )
        VALUES ($1, $2, $3, $4, $5::numeric, $6, $7, 'PENDING')
        RETURNING id
        "#,
        auth_user.user_id,
        payload.plant_id,
        payload.site_id,
        payload.grade,
        bigdecimal::BigDecimal::try_from(payload.quantity_m3).unwrap_or_default(),
        req_date,
        payload.notes
    )
    .fetch_one(&state.db)
    .await?;

    Ok(Json(json!({ "success": true, "id": id, "message": "Quotation request submitted" })))
}

pub async fn list_customer_rfqs(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<impl IntoResponse, AppError> {
    let rows = sqlx::query!(
        r#"
        SELECT r.id, r.plant_id, r.grade, r.quantity_m3, r.required_date, r.status, r.notes, r.created_at,
               p.name as plant_name, p.contact_phone as plant_phone
        FROM customer_quotation_requests r
        INNER JOIN rmc_plants p ON p.id = r.plant_id
        WHERE r.customer_id = $1
        ORDER BY r.created_at DESC
        "#,
        auth_user.user_id
    )
    .fetch_all(&state.db)
    .await?;

    let rfqs: Vec<_> = rows.into_iter().map(|r| json!({
        "id": r.id,
        "plant_id": r.plant_id,
        "plant_name": r.plant_name,
        "plant_phone": r.plant_phone,
        "grade": r.grade,
        "quantity_m3": r.quantity_m3,
        "required_date": r.required_date,
        "status": r.status,
        "notes": r.notes,
        "created_at": r.created_at
    })).collect();

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

    let id = sqlx::query_scalar!(
        r#"
        INSERT INTO customer_pour_plans (
            customer_id, site_id, grade, total_quantity_m3, mixer_capacity_m3,
            pour_date, start_time, unload_minutes, discharge_mode, notes
        )
        VALUES ($1, $2, $3, $4::numeric, $5::numeric, $6, $7, $8, $9, $10)
        RETURNING id
        "#,
        auth_user.user_id,
        payload.site_id,
        payload.grade,
        bigdecimal::BigDecimal::try_from(payload.total_quantity_m3).unwrap_or_default(),
        bigdecimal::BigDecimal::try_from(cap).unwrap_or_default(),
        p_date,
        payload.start_time,
        unload,
        mode,
        payload.notes
    )
    .fetch_one(&state.db)
    .await?;

    Ok(Json(json!({ "success": true, "id": id, "message": "Pour plan created" })))
}

pub async fn list_pour_plans(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<impl IntoResponse, AppError> {
    let rows = sqlx::query!(
        r#"
        SELECT p.id, p.site_id, p.grade, p.total_quantity_m3, p.mixer_capacity_m3,
               p.pour_date, p.start_time, p.unload_minutes, p.discharge_mode, p.notes, p.created_at,
               s.name as site_name, s.address_line as site_address
        FROM customer_pour_plans p
        INNER JOIN customer_sites s ON s.id = p.site_id
        WHERE p.customer_id = $1
        ORDER BY p.pour_date DESC
        "#,
        auth_user.user_id
    )
    .fetch_all(&state.db)
    .await?;

    let plans: Vec<_> = rows.into_iter().map(|r| json!({
        "id": r.id,
        "site_id": r.site_id,
        "site_name": r.site_name,
        "site_address": r.site_address,
        "grade": r.grade,
        "total_quantity_m3": r.total_quantity_m3,
        "mixer_capacity_m3": r.mixer_capacity_m3,
        "pour_date": r.pour_date,
        "start_time": r.start_time,
        "unload_minutes": r.unload_minutes,
        "discharge_mode": r.discharge_mode,
        "notes": r.notes
    })).collect();

    Ok(Json(json!({ "success": true, "pour_plans": plans })))
}

pub async fn delete_pour_plan(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(plan_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    let res = sqlx::query!(
        "DELETE FROM customer_pour_plans WHERE id = $1 AND customer_id = $2",
        plan_id,
        auth_user.user_id
    )
    .execute(&state.db)
    .await?;

    if res.rows_affected() == 0 {
        return Err(AppError::NotFound("Plan not found".to_string()));
    }

    Ok(Json(json!({ "success": true, "message": "Pour plan deleted" })))
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
    let id = sqlx::query_scalar!(
        r#"
        INSERT INTO customer_receiving_records (
            customer_id, site_id, order_id, grade, received_quantity_m3,
            challan_number, tm_number, observed_slump_mm, notes
        )
        VALUES ($1, $2, $3, $4, $5::numeric, $6, $7, $8::numeric, $9)
        RETURNING id
        "#,
        auth_user.user_id,
        payload.site_id,
        payload.order_id,
        payload.grade,
        bigdecimal::BigDecimal::try_from(payload.received_quantity_m3).unwrap_or_default(),
        payload.challan_number,
        payload.tm_number,
        payload.observed_slump_mm.and_then(|v| bigdecimal::BigDecimal::try_from(v).ok()),
        payload.notes
    )
    .fetch_one(&state.db)
    .await?;

    Ok(Json(json!({ "success": true, "id": id, "message": "Receiving record logged" })))
}

pub async fn list_receiving_records(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<impl IntoResponse, AppError> {
    let rows = sqlx::query!(
        r#"
        SELECT r.id, r.site_id, r.order_id, r.grade, r.received_quantity_m3,
               r.challan_number, r.tm_number, r.observed_slump_mm, r.notes, r.created_at,
               s.name as site_name
        FROM customer_receiving_records r
        INNER JOIN customer_sites s ON s.id = r.site_id
        WHERE r.customer_id = $1
        ORDER BY r.created_at DESC
        "#,
        auth_user.user_id
    )
    .fetch_all(&state.db)
    .await?;

    let records: Vec<_> = rows.into_iter().map(|r| json!({
        "id": r.id,
        "site_id": r.site_id,
        "site_name": r.site_name,
        "order_id": r.order_id,
        "grade": r.grade,
        "received_quantity_m3": r.received_quantity_m3,
        "challan_number": r.challan_number,
        "tm_number": r.tm_number,
        "observed_slump_mm": r.observed_slump_mm,
        "notes": r.notes,
        "created_at": r.created_at
    })).collect();

    Ok(Json(json!({ "success": true, "records": records })))
}

#[derive(Debug, Deserialize, Serialize)]
pub struct CubeResultPayload {
    pub sample_id: String,
    pub age_days: i32, // 7 or 28
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
    let rec_cust: Uuid = sqlx::query_scalar("SELECT customer_id FROM customer_receiving_records WHERE id = $1")
        .bind(record_id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("Receiving record not found".to_string()))?;

    if rec_cust != auth_user.user_id && auth_user.role != "admin" {
        return Err(AppError::Forbidden("Unauthorized".to_string()));
    }

    let t_date = NaiveDate::parse_from_str(&payload.tested_on, "%Y-%m-%d")
        .map_err(|_| AppError::BadRequest("Invalid tested_on date".to_string()))?;

    let id = sqlx::query_scalar!(
        r#"
        INSERT INTO cube_test_results (
            record_id, sample_id, age_days, tested_on, result_mpa, lab_name, report_reference
        )
        VALUES ($1, $2, $3, $4, $5::numeric, $6, $7)
        RETURNING id
        "#,
        record_id,
        payload.sample_id,
        payload.age_days,
        t_date,
        bigdecimal::BigDecimal::try_from(payload.result_mpa).unwrap_or_default(),
        payload.lab_name,
        payload.report_reference
    )
    .fetch_one(&state.db)
    .await?;

    Ok(Json(json!({ "success": true, "id": id, "message": "Cube test result recorded" })))
}

pub async fn delete_receiving_record(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(record_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    let res = sqlx::query!(
        "DELETE FROM customer_receiving_records WHERE id = $1 AND customer_id = $2",
        record_id,
        auth_user.user_id
    )
    .execute(&state.db)
    .await?;

    if res.rows_affected() == 0 {
        return Err(AppError::NotFound("Record not found".to_string()));
    }

    Ok(Json(json!({ "success": true, "message": "Record deleted" })))
}

pub async fn get_customer_kyc(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<impl IntoResponse, AppError> {
    let profile = sqlx::query!(
        "SELECT kyc_status, verified_name, gst_number FROM user_profiles WHERE user_id = $1",
        auth_user.user_id
    )
    .fetch_optional(&state.db)
    .await?;

    Ok(Json(json!({
        "success": true,
        "kyc_status": profile.as_ref().map(|p| p.kyc_status.clone()).unwrap_or_else(|| "unverified".to_string()),
        "verified_name": profile.as_ref().and_then(|p| p.verified_name.clone()),
        "gst_number": profile.as_ref().and_then(|p| p.gst_number.clone())
    })))
}

pub async fn start_customer_kyc(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<impl IntoResponse, AppError> {
    // Generate sandbox KYC redirect trampoline URL
    let callback_url = "https://trackmyrmc.com/kyc/return";

    sqlx::query!(
        "UPDATE user_profiles SET kyc_status = 'pending', updated_at = NOW() WHERE user_id = $1",
        auth_user.user_id
    )
    .execute(&state.db)
    .await?;

    Ok(Json(json!({
        "success": true,
        "status": "pending",
        "authorization_url": callback_url
    })))
}
