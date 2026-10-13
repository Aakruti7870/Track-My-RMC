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
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;

async fn ensure_plant_staff_or_owner(
    state: &AppState,
    auth_user: &AuthUser,
    plant_id: Uuid,
) -> Result<(), AppError> {
    if auth_user.role == "admin" {
        return Ok(());
    }
    if auth_user.role == "owner" || auth_user.role == "plant_owner" {
        let is_owner: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM rmc_plants WHERE id = $1 AND owner_id = $2)",
        )
        .bind(plant_id)
        .bind(auth_user.user_id)
        .fetch_one(&state.db)
        .await?;
        if is_owner {
            return Ok(());
        }
    }
    let is_staff: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM plant_staff WHERE plant_id = $1 AND user_id = $2 AND is_active = TRUE)",
    )
    .bind(plant_id)
    .bind(auth_user.user_id)
    .fetch_one(&state.db)
    .await?;
    if !is_staff {
        return Err(AppError::Forbidden(
            "You are not authorized for this plant".to_string(),
        ));
    }
    Ok(())
}

#[derive(Debug, Deserialize, Serialize)]
pub struct CreateQuotationPayload {
    pub customer_id: Option<Uuid>,
    pub request_id: Option<Uuid>,
    pub customer_name: String,
    pub customer_mobile: Option<String>,
    pub site_name: String,
    pub site_address: String,
    pub grade: String,
    pub quantity_m3: f64,
    pub rate_per_m3: f64,
    pub gst_rate: Option<f64>,
    pub transport_amount: Option<f64>,
    pub pumping_amount: Option<f64>,
    pub valid_until: String,
    pub notes: Option<String>,
}

pub async fn list_plant_quotations(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(plant_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    ensure_plant_staff_or_owner(&state, &auth_user, plant_id).await?;

    let rows = sqlx::query!(
        r#"
        SELECT id, quotation_number, customer_name, customer_mobile, site_name, site_address,
               grade, quantity_m3, rate_per_m3, gst_rate, transport_amount, pumping_amount,
               total_amount, valid_until, status, notes, created_at
        FROM plant_quotations WHERE plant_id = $1 ORDER BY created_at DESC
        "#,
        plant_id
    )
    .fetch_all(&state.db)
    .await?;

    let quotations: Vec<_> = rows
        .into_iter()
        .map(|r| {
            json!({
                "id": r.id,
                "quotation_number": r.quotation_number,
                "customer_name": r.customer_name,
                "customer_mobile": r.customer_mobile,
                "site_name": r.site_name,
                "site_address": r.site_address,
                "grade": r.grade,
                "quantity_m3": r.quantity_m3,
                "rate_per_m3": r.rate_per_m3,
                "gst_rate": r.gst_rate,
                "transport_amount": r.transport_amount,
                "pumping_amount": r.pumping_amount,
                "total_amount": r.total_amount,
                "valid_until": r.valid_until,
                "status": r.status,
                "notes": r.notes,
                "created_at": r.created_at
            })
        })
        .collect();

    Ok(Json(json!({ "success": true, "quotations": quotations })))
}

pub async fn create_plant_quotation(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(plant_id): Path<Uuid>,
    Json(payload): Json<CreateQuotationPayload>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["owner", "plant_owner", "admin", "accountant"])?;
    ensure_plant_staff_or_owner(&state, &auth_user, plant_id).await?;

    let valid_date = NaiveDate::parse_from_str(&payload.valid_until, "%Y-%m-%d")
        .map_err(|_| AppError::BadRequest("Invalid valid_until date, format must be YYYY-MM-DD".to_string()))?;

    let gst_rate = payload.gst_rate.unwrap_or(18.0);
    let transport = payload.transport_amount.unwrap_or(0.0);
    let pumping = payload.pumping_amount.unwrap_or(0.0);
    let subtotal = payload.quantity_m3 * payload.rate_per_m3 + transport + pumping;
    let total = subtotal * (1.0 + (gst_rate / 100.0));

    let quotation_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM plant_quotations WHERE plant_id = $1")
        .bind(plant_id)
        .fetch_one(&state.db)
        .await?;

    let quotation_number = format!("QT-{:04}", quotation_count + 1);

    let id = sqlx::query_scalar!(
        r#"
        INSERT INTO plant_quotations (
            plant_id, quotation_number, request_id, customer_id, customer_name, customer_mobile,
            site_name, site_address, grade, quantity_m3, rate_per_m3, gst_rate,
            transport_amount, pumping_amount, total_amount, valid_until, status, notes
        )
        VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::numeric, $11::numeric, $12::numeric,
            $13::numeric, $14::numeric, $15::numeric, $16, 'SENT', $17
        )
        RETURNING id
        "#,
        plant_id,
        quotation_number,
        payload.request_id,
        payload.customer_id,
        payload.customer_name,
        payload.customer_mobile,
        payload.site_name,
        payload.site_address,
        payload.grade,
        bigdecimal::BigDecimal::try_from(payload.quantity_m3).unwrap_or_default(),
        bigdecimal::BigDecimal::try_from(payload.rate_per_m3).unwrap_or_default(),
        bigdecimal::BigDecimal::try_from(gst_rate).unwrap_or_default(),
        bigdecimal::BigDecimal::try_from(transport).unwrap_or_default(),
        bigdecimal::BigDecimal::try_from(pumping).unwrap_or_default(),
        bigdecimal::BigDecimal::try_from(total).unwrap_or_default(),
        valid_date,
        payload.notes
    )
    .fetch_one(&state.db)
    .await?;

    // If linked to an RFQ request, update RFQ status to QUOTED
    if let Some(req_id) = payload.request_id {
        let _ = sqlx::query!("UPDATE customer_quotation_requests SET status = 'QUOTED', updated_at = NOW() WHERE id = $1", req_id)
            .execute(&state.db)
            .await;
    }

    Ok(Json(json!({
        "success": true,
        "id": id,
        "quotation_number": quotation_number,
        "total_amount": total
    })))
}

pub async fn list_plant_quotation_requests(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(plant_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    ensure_plant_staff_or_owner(&state, &auth_user, plant_id).await?;

    let rows = sqlx::query!(
        r#"
        SELECT r.id, r.customer_id, r.grade, r.quantity_m3, r.required_date, r.status, r.notes, r.created_at,
               u.full_name as customer_name, u.phone as customer_phone,
               s.name as site_name, s.address_line as site_address
        FROM customer_quotation_requests r
        INNER JOIN users u ON u.id = r.customer_id
        LEFT JOIN customer_sites s ON s.id = r.site_id
        WHERE r.plant_id = $1
        ORDER BY r.created_at DESC
        "#,
        plant_id
    )
    .fetch_all(&state.db)
    .await?;

    let requests: Vec<_> = rows
        .into_iter()
        .map(|r| {
            json!({
                "id": r.id,
                "customer_id": r.customer_id,
                "customer_name": r.customer_name,
                "customer_phone": r.customer_phone,
                "site_name": r.site_name,
                "site_address": r.site_address,
                "grade": r.grade,
                "quantity_m3": r.quantity_m3,
                "required_date": r.required_date,
                "status": r.status,
                "notes": r.notes,
                "created_at": r.created_at
            })
        })
        .collect();

    Ok(Json(json!({ "success": true, "requests": requests })))
}

#[derive(Debug, Deserialize, Serialize)]
pub struct RespondRfqPayload {
    pub action: String, // "SEND" | "DECLINE"
    pub rate_per_m3: Option<f64>,
    pub gst_rate: Option<f64>,
    pub transport_amount: Option<f64>,
    pub pumping_amount: Option<f64>,
    pub valid_until: Option<String>,
    pub decline_reason: Option<String>,
    pub notes: Option<String>,
}

pub async fn respond_quotation_request(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path((plant_id, request_id)): Path<(Uuid, Uuid)>,
    Json(payload): Json<RespondRfqPayload>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["owner", "plant_owner", "admin", "accountant"])?;
    ensure_plant_staff_or_owner(&state, &auth_user, plant_id).await?;

    let rfq = sqlx::query!(
        r#"
        SELECT r.id, r.customer_id, r.grade, r.quantity_m3,
               u.full_name as customer_name, u.phone as customer_phone,
               s.name as site_name, s.address_line as site_address
        FROM customer_quotation_requests r
        INNER JOIN users u ON u.id = r.customer_id
        LEFT JOIN customer_sites s ON s.id = r.site_id
        WHERE r.id = $1 AND r.plant_id = $2
        "#,
        request_id,
        plant_id
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("RFQ not found".to_string()))?;

    if payload.action.to_uppercase() == "DECLINE" {
        sqlx::query!(
            "UPDATE customer_quotation_requests SET status = 'DECLINED', updated_at = NOW() WHERE id = $1",
            request_id
        )
        .execute(&state.db)
        .await?;

        return Ok(Json(json!({ "success": true, "message": "RFQ declined" })));
    }

    let rate = payload.rate_per_m3.ok_or_else(|| AppError::BadRequest("rate_per_m3 required when sending quote".to_string()))?;
    let valid_str = payload.valid_until.unwrap_or_else(|| chrono::Utc::now().naive_utc().date().succ_opt().unwrap().to_string());
    let valid_date = NaiveDate::parse_from_str(&valid_str, "%Y-%m-%d")
        .map_err(|_| AppError::BadRequest("Invalid valid_until date, format must be YYYY-MM-DD".to_string()))?;

    let q_m3: f64 = rfq.quantity_m3.to_string().parse().unwrap_or(0.0);
    let gst = payload.gst_rate.unwrap_or(18.0);
    let transport = payload.transport_amount.unwrap_or(0.0);
    let pumping = payload.pumping_amount.unwrap_or(0.0);
    let subtotal = q_m3 * rate + transport + pumping;
    let total = subtotal * (1.0 + (gst / 100.0));

    let quotation_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM plant_quotations WHERE plant_id = $1")
        .bind(plant_id)
        .fetch_one(&state.db)
        .await?;
    let quotation_number = format!("QT-{:04}", quotation_count + 1);

    sqlx::query!(
        r#"
        INSERT INTO plant_quotations (
            plant_id, quotation_number, request_id, customer_id, customer_name, customer_mobile,
            site_name, site_address, grade, quantity_m3, rate_per_m3, gst_rate,
            transport_amount, pumping_amount, total_amount, valid_until, status, notes
        )
        VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::numeric, $11::numeric, $12::numeric,
            $13::numeric, $14::numeric, $15::numeric, $16, 'SENT', $17
        )
        "#,
        plant_id,
        quotation_number,
        request_id,
        rfq.customer_id,
        rfq.customer_name,
        rfq.customer_phone,
        rfq.site_name.unwrap_or_else(|| "Site".to_string()),
        rfq.site_address.unwrap_or_else(|| "Site Address".to_string()),
        rfq.grade,
        bigdecimal::BigDecimal::try_from(q_m3).unwrap_or_default(),
        bigdecimal::BigDecimal::try_from(rate).unwrap_or_default(),
        bigdecimal::BigDecimal::try_from(gst).unwrap_or_default(),
        bigdecimal::BigDecimal::try_from(transport).unwrap_or_default(),
        bigdecimal::BigDecimal::try_from(pumping).unwrap_or_default(),
        bigdecimal::BigDecimal::try_from(total).unwrap_or_default(),
        valid_date,
        payload.notes
    )
    .execute(&state.db)
    .await?;

    sqlx::query!(
        "UPDATE customer_quotation_requests SET status = 'QUOTED', updated_at = NOW() WHERE id = $1",
        request_id
    )
    .execute(&state.db)
    .await?;

    Ok(Json(json!({
        "success": true,
        "quotation_number": quotation_number,
        "total_amount": total,
        "message": "Quotation sent to customer"
    })))
}

pub async fn list_customer_quotations(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<impl IntoResponse, AppError> {
    let rows = sqlx::query!(
        r#"
        SELECT q.id, q.quotation_number, q.plant_id, q.grade, q.quantity_m3, q.rate_per_m3,
               q.gst_rate, q.transport_amount, q.pumping_amount, q.total_amount,
               q.valid_until, q.status, q.notes, q.created_at,
               p.name as plant_name, p.contact_phone as plant_phone
        FROM plant_quotations q
        INNER JOIN rmc_plants p ON p.id = q.plant_id
        WHERE q.customer_id = $1
        ORDER BY q.created_at DESC
        "#,
        auth_user.user_id
    )
    .fetch_all(&state.db)
    .await?;

    let quotations: Vec<_> = rows
        .into_iter()
        .map(|r| {
            json!({
                "id": r.id,
                "quotation_number": r.quotation_number,
                "plant_id": r.plant_id,
                "plant_name": r.plant_name,
                "plant_phone": r.plant_phone,
                "grade": r.grade,
                "quantity_m3": r.quantity_m3,
                "rate_per_m3": r.rate_per_m3,
                "total_amount": r.total_amount,
                "valid_until": r.valid_until,
                "status": r.status,
                "created_at": r.created_at
            })
        })
        .collect();

    Ok(Json(json!({ "success": true, "quotations": quotations })))
}

#[derive(Debug, Deserialize, Serialize)]
pub struct CustomerQuotationDecisionPayload {
    pub action: String, // "ACCEPT" | "DECLINE"
    pub reason: Option<String>,
}

pub async fn decide_customer_quotation(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(quotation_id): Path<Uuid>,
    Json(payload): Json<CustomerQuotationDecisionPayload>,
) -> Result<impl IntoResponse, AppError> {
    let new_status = if payload.action.to_uppercase() == "ACCEPT" {
        "ACCEPTED"
    } else {
        "DECLINED"
    };

    let result = sqlx::query!(
        r#"
        UPDATE plant_quotations
        SET status = $1, decline_reason = $2, updated_at = NOW()
        WHERE id = $3 AND customer_id = $4
        "#,
        new_status,
        payload.reason,
        quotation_id,
        auth_user.user_id
    )
    .execute(&state.db)
    .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("Quotation not found or unauthorized".to_string()));
    }

    Ok(Json(json!({
        "success": true,
        "status": new_status,
        "message": format!("Quotation {}", new_status.to_lowercase())
    })))
}

#[derive(Debug, Deserialize, Serialize)]
pub struct ExpensePayload {
    pub category: String,
    pub amount: f64,
    pub expense_date: Option<String>,
    pub vendor: Option<String>,
    pub reference: Option<String>,
    pub payment_method: Option<String>,
    pub notes: Option<String>,
}

pub async fn list_plant_expenses(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(plant_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    ensure_plant_staff_or_owner(&state, &auth_user, plant_id).await?;

    let rows = sqlx::query!(
        r#"
        SELECT id, category, amount, expense_date, vendor, reference, payment_method, notes, created_at
        FROM plant_expenses WHERE plant_id = $1 ORDER BY expense_date DESC, created_at DESC
        "#,
        plant_id
    )
    .fetch_all(&state.db)
    .await?;

    let expenses: Vec<_> = rows
        .into_iter()
        .map(|r| {
            json!({
                "id": r.id,
                "category": r.category,
                "amount": r.amount,
                "expense_date": r.expense_date,
                "vendor": r.vendor,
                "reference": r.reference,
                "payment_method": r.payment_method,
                "notes": r.notes,
                "created_at": r.created_at
            })
        })
        .collect();

    Ok(Json(json!({ "success": true, "expenses": expenses })))
}

pub async fn record_plant_expense(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(plant_id): Path<Uuid>,
    Json(payload): Json<ExpensePayload>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["owner", "plant_owner", "admin", "accountant"])?;
    ensure_plant_staff_or_owner(&state, &auth_user, plant_id).await?;

    let dt = match payload.expense_date {
        Some(s) => NaiveDate::parse_from_str(&s, "%Y-%m-%d").unwrap_or_else(|_| chrono::Utc::now().naive_utc().date()),
        None => chrono::Utc::now().naive_utc().date(),
    };

    let id = sqlx::query_scalar!(
        r#"
        INSERT INTO plant_expenses (
            plant_id, recorded_by, category, amount, expense_date, vendor, reference, payment_method, notes
        )
        VALUES ($1, $2, $3, $4::numeric, $5, $6, $7, $8, $9)
        RETURNING id
        "#,
        plant_id,
        auth_user.user_id,
        payload.category,
        bigdecimal::BigDecimal::try_from(payload.amount).unwrap_or_default(),
        dt,
        payload.vendor,
        payload.reference,
        payload.payment_method.unwrap_or_else(|| "cash".to_string()),
        payload.notes
    )
    .fetch_one(&state.db)
    .await?;

    Ok(Json(json!({ "success": true, "id": id, "message": "Expense recorded" })))
}

#[derive(Debug, Deserialize, Serialize)]
pub struct DieselPayload {
    pub transaction_type: String, // "IN" | "OUT" | "ADJUSTMENT"
    pub litres: f64,
    pub rate_per_litre: Option<f64>,
    pub vehicle_id: Option<Uuid>,
    pub supplier_id: Option<Uuid>,
    pub odometer_km: Option<f64>,
    pub reference: Option<String>,
    pub notes: Option<String>,
}

pub async fn list_diesel_transactions(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(plant_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    ensure_plant_staff_or_owner(&state, &auth_user, plant_id).await?;

    let rows = sqlx::query!(
        r#"
        SELECT d.id, d.transaction_type, d.litres, d.rate_per_litre, d.odometer_km,
               d.reference, d.notes, d.transaction_date, d.created_at,
               m.registration_number as vehicle_number, s.name as supplier_name
        FROM diesel_transactions d
        LEFT JOIN transit_mixers m ON m.id = d.vehicle_id
        LEFT JOIN plant_suppliers s ON s.id = d.supplier_id
        WHERE d.plant_id = $1
        ORDER BY d.transaction_date DESC, d.created_at DESC
        "#,
        plant_id
    )
    .fetch_all(&state.db)
    .await?;

    let transactions: Vec<_> = rows
        .into_iter()
        .map(|r| {
            json!({
                "id": r.id,
                "transaction_type": r.transaction_type,
                "litres": r.litres,
                "rate_per_litre": r.rate_per_litre,
                "odometer_km": r.odometer_km,
                "vehicle_number": r.vehicle_number,
                "supplier_name": r.supplier_name,
                "reference": r.reference,
                "notes": r.notes,
                "transaction_date": r.transaction_date,
                "created_at": r.created_at
            })
        })
        .collect();

    Ok(Json(json!({ "success": true, "transactions": transactions })))
}

pub async fn record_diesel_transaction(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(plant_id): Path<Uuid>,
    Json(payload): Json<DieselPayload>,
) -> Result<impl IntoResponse, AppError> {
    check_role(
        &auth_user,
        &["owner", "plant_owner", "admin", "accountant", "fleet_manager"],
    )?;
    ensure_plant_staff_or_owner(&state, &auth_user, plant_id).await?;

    let id = sqlx::query_scalar!(
        r#"
        INSERT INTO diesel_transactions (
            plant_id, recorded_by, transaction_type, litres, rate_per_litre,
            vehicle_id, supplier_id, odometer_km, reference, notes
        )
        VALUES ($1, $2, $3, $4::numeric, $5::numeric, $6, $7, $8::numeric, $9, $10)
        RETURNING id
        "#,
        plant_id,
        auth_user.user_id,
        payload.transaction_type,
        bigdecimal::BigDecimal::try_from(payload.litres).unwrap_or_default(),
        bigdecimal::BigDecimal::try_from(payload.rate_per_litre.unwrap_or(0.0)).unwrap_or_default(),
        payload.vehicle_id,
        payload.supplier_id,
        bigdecimal::BigDecimal::try_from(payload.odometer_km.unwrap_or(0.0)).unwrap_or_default(),
        payload.reference,
        payload.notes
    )
    .fetch_one(&state.db)
    .await?;

    Ok(Json(json!({ "success": true, "id": id, "message": "Diesel transaction recorded" })))
}

#[derive(Debug, Deserialize, Serialize)]
pub struct PurchaseReceiptPayload {
    pub supplier_id: Uuid,
    pub receipt_number: String,
    pub receipt_date: Option<String>,
    pub lines: serde_json::Value,
    pub gst_amount: Option<f64>,
    pub freight_amount: Option<f64>,
    pub total_amount: f64,
    pub notes: Option<String>,
}

pub async fn list_purchase_receipts(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(plant_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    ensure_plant_staff_or_owner(&state, &auth_user, plant_id).await?;

    let rows = sqlx::query!(
        r#"
        SELECT p.id, p.receipt_number, p.receipt_date, p.lines, p.gst_amount,
               p.freight_amount, p.total_amount, p.notes, p.created_at,
               s.name as supplier_name
        FROM purchase_receipts p
        INNER JOIN plant_suppliers s ON s.id = p.supplier_id
        WHERE p.plant_id = $1
        ORDER BY p.receipt_date DESC, p.created_at DESC
        "#,
        plant_id
    )
    .fetch_all(&state.db)
    .await?;

    let purchases: Vec<_> = rows
        .into_iter()
        .map(|r| {
            json!({
                "id": r.id,
                "receipt_number": r.receipt_number,
                "supplier_name": r.supplier_name,
                "receipt_date": r.receipt_date,
                "lines": r.lines,
                "gst_amount": r.gst_amount,
                "freight_amount": r.freight_amount,
                "total_amount": r.total_amount,
                "notes": r.notes,
                "created_at": r.created_at
            })
        })
        .collect();

    Ok(Json(json!({ "success": true, "purchases": purchases })))
}

pub async fn record_purchase_receipt(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(plant_id): Path<Uuid>,
    Json(payload): Json<PurchaseReceiptPayload>,
) -> Result<impl IntoResponse, AppError> {
    check_role(
        &auth_user,
        &["owner", "plant_owner", "admin", "accountant", "store_manager"],
    )?;
    ensure_plant_staff_or_owner(&state, &auth_user, plant_id).await?;

    let dt = match payload.receipt_date {
        Some(s) => NaiveDate::parse_from_str(&s, "%Y-%m-%d").unwrap_or_else(|_| chrono::Utc::now().naive_utc().date()),
        None => chrono::Utc::now().naive_utc().date(),
    };

    let id = sqlx::query_scalar!(
        r#"
        INSERT INTO purchase_receipts (
            plant_id, supplier_id, receipt_number, receipt_date, lines,
            gst_amount, freight_amount, total_amount, notes
        )
        VALUES ($1, $2, $3, $4, $5, $6::numeric, $7::numeric, $8::numeric, $9)
        RETURNING id
        "#,
        plant_id,
        payload.supplier_id,
        payload.receipt_number,
        dt,
        payload.lines,
        bigdecimal::BigDecimal::try_from(payload.gst_amount.unwrap_or(0.0)).unwrap_or_default(),
        bigdecimal::BigDecimal::try_from(payload.freight_amount.unwrap_or(0.0)).unwrap_or_default(),
        bigdecimal::BigDecimal::try_from(payload.total_amount).unwrap_or_default(),
        payload.notes
    )
    .fetch_one(&state.db)
    .await?;

    Ok(Json(json!({ "success": true, "id": id, "message": "Purchase receipt recorded" })))
}
