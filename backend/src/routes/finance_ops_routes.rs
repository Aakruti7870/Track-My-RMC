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
use sqlx::Row;
use uuid::Uuid;

async fn ensure_plant_staff_or_owner(
    state: &AppState,
    auth_user: &AuthUser,
    plant_id: Uuid,
) -> Result<(), AppError> {
    super::business_routes::ensure_plant_staff_or_owner(state, auth_user, plant_id).await
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

    let rows = sqlx::query(
        r#"
        SELECT id, quotation_number, customer_name, customer_mobile, site_name, site_address,
               grade, quantity_m3, rate_per_m3, gst_rate, transport_amount, pumping_amount,
               total_amount, valid_until, status, notes, created_at
        FROM plant_quotations WHERE plant_id = $1 ORDER BY created_at DESC
        "#,
    )
    .bind(plant_id)
    .fetch_all(&state.db)
    .await?;

    let quotations: Vec<_> = rows
        .into_iter()
        .map(|r| {
            let id: Uuid = r.get("id");
            let quotation_number: String = r.get("quotation_number");
            let customer_name: String = r.get("customer_name");
            let customer_mobile: Option<String> = r.get("customer_mobile");
            let site_name: String = r.get("site_name");
            let site_address: String = r.get("site_address");
            let grade: String = r.get("grade");
            let quantity_m3: bigdecimal::BigDecimal = r.get("quantity_m3");
            let rate_per_m3: bigdecimal::BigDecimal = r.get("rate_per_m3");
            let gst_rate: bigdecimal::BigDecimal = r.get("gst_rate");
            let transport_amount: bigdecimal::BigDecimal = r.get("transport_amount");
            let pumping_amount: bigdecimal::BigDecimal = r.get("pumping_amount");
            let total_amount: bigdecimal::BigDecimal = r.get("total_amount");
            let valid_until: chrono::NaiveDate = r.get("valid_until");
            let status: String = r.get("status");
            let notes: Option<String> = r.get("notes");
            let created_at: chrono::DateTime<chrono::Utc> = r.get("created_at");

            json!({
                "id": id,
                "quotation_number": quotation_number,
                "customer_name": customer_name,
                "customer_mobile": customer_mobile,
                "site_name": site_name,
                "site_address": site_address,
                "grade": grade,
                "quantity_m3": quantity_m3,
                "rate_per_m3": rate_per_m3,
                "gst_rate": gst_rate,
                "transport_amount": transport_amount,
                "pumping_amount": pumping_amount,
                "total_amount": total_amount,
                "valid_until": valid_until,
                "status": status,
                "notes": notes,
                "created_at": created_at
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

    let valid_date = NaiveDate::parse_from_str(&payload.valid_until, "%Y-%m-%d").map_err(|_| {
        AppError::BadRequest("Invalid valid_until date, format must be YYYY-MM-DD".to_string())
    })?;

    let gst_rate = payload.gst_rate.unwrap_or(18.0);
    let transport = payload.transport_amount.unwrap_or(0.0);
    let pumping = payload.pumping_amount.unwrap_or(0.0);
    let subtotal = payload.quantity_m3 * payload.rate_per_m3 + transport + pumping;
    let total = subtotal * (1.0 + (gst_rate / 100.0));

    let quotation_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM plant_quotations WHERE plant_id = $1")
            .bind(plant_id)
            .fetch_one(&state.db)
            .await?;

    let quotation_number = format!("QT-{:04}", quotation_count + 1);

    let id: Uuid = sqlx::query_scalar(
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
    )
    .bind(plant_id)
    .bind(&quotation_number)
    .bind(payload.request_id)
    .bind(payload.customer_id)
    .bind(&payload.customer_name)
    .bind(&payload.customer_mobile)
    .bind(&payload.site_name)
    .bind(&payload.site_address)
    .bind(&payload.grade)
    .bind(payload.quantity_m3)
    .bind(payload.rate_per_m3)
    .bind(gst_rate)
    .bind(transport)
    .bind(pumping)
    .bind(total)
    .bind(valid_date)
    .bind(&payload.notes)
    .fetch_one(&state.db)
    .await?;

    if let Some(req_id) = payload.request_id {
        let _ = sqlx::query("UPDATE customer_quotation_requests SET status = 'QUOTED', updated_at = NOW() WHERE id = $1")
            .bind(req_id)
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

    let rows = sqlx::query(
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
    )
    .bind(plant_id)
    .fetch_all(&state.db)
    .await?;

    let requests: Vec<_> = rows
        .into_iter()
        .map(|r| {
            let id: Uuid = r.get("id");
            let customer_id: Uuid = r.get("customer_id");
            let customer_name: String = r.get("customer_name");
            let customer_phone: Option<String> = r.get("customer_phone");
            let site_name: Option<String> = r.get("site_name");
            let site_address: Option<String> = r.get("site_address");
            let grade: String = r.get("grade");
            let quantity_m3: bigdecimal::BigDecimal = r.get("quantity_m3");
            let required_date: chrono::NaiveDate = r.get("required_date");
            let status: String = r.get("status");
            let notes: Option<String> = r.get("notes");
            let created_at: chrono::DateTime<chrono::Utc> = r.get("created_at");

            json!({
                "id": id,
                "customer_id": customer_id,
                "customer_name": customer_name,
                "customer_phone": customer_phone,
                "site_name": site_name,
                "site_address": site_address,
                "grade": grade,
                "quantity_m3": quantity_m3,
                "required_date": required_date,
                "status": status,
                "notes": notes,
                "created_at": created_at
            })
        })
        .collect();

    Ok(Json(json!({ "success": true, "requests": requests })))
}

#[derive(Debug, Deserialize, Serialize)]
pub struct RespondRfqPayload {
    pub action: String,
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

    let rfq = sqlx::query(
        r#"
        SELECT r.id, r.customer_id, r.grade, r.quantity_m3,
               u.full_name as customer_name, u.phone as customer_phone,
               s.name as site_name, s.address_line as site_address
        FROM customer_quotation_requests r
        INNER JOIN users u ON u.id = r.customer_id
        LEFT JOIN customer_sites s ON s.id = r.site_id
        WHERE r.id = $1 AND r.plant_id = $2
        "#,
    )
    .bind(request_id)
    .bind(plant_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("RFQ not found".to_string()))?;

    if payload.action.to_uppercase() == "DECLINE" {
        sqlx::query("UPDATE customer_quotation_requests SET status = 'DECLINED', updated_at = NOW() WHERE id = $1")
            .bind(request_id)
            .execute(&state.db)
            .await?;

        return Ok(Json(json!({ "success": true, "message": "RFQ declined" })));
    }

    let rate = payload.rate_per_m3.ok_or_else(|| {
        AppError::BadRequest("rate_per_m3 required when sending quote".to_string())
    })?;
    let valid_str = payload.valid_until.unwrap_or_else(|| {
        chrono::Utc::now()
            .naive_utc()
            .date()
            .succ_opt()
            .unwrap()
            .to_string()
    });
    let valid_date = NaiveDate::parse_from_str(&valid_str, "%Y-%m-%d").map_err(|_| {
        AppError::BadRequest("Invalid valid_until date, format must be YYYY-MM-DD".to_string())
    })?;

    let q_m3_dec: bigdecimal::BigDecimal = rfq.get("quantity_m3");
    let q_m3: f64 = q_m3_dec.to_string().parse().unwrap_or(0.0);
    let gst = payload.gst_rate.unwrap_or(18.0);
    let transport = payload.transport_amount.unwrap_or(0.0);
    let pumping = payload.pumping_amount.unwrap_or(0.0);
    let subtotal = q_m3 * rate + transport + pumping;
    let total = subtotal * (1.0 + (gst / 100.0));

    let quotation_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM plant_quotations WHERE plant_id = $1")
            .bind(plant_id)
            .fetch_one(&state.db)
            .await?;
    let quotation_number = format!("QT-{:04}", quotation_count + 1);

    let customer_id: Uuid = rfq.get("customer_id");
    let customer_name: String = rfq.get("customer_name");
    let customer_phone: Option<String> = rfq.get("customer_phone");
    let site_name: Option<String> = rfq.get("site_name");
    let site_address: Option<String> = rfq.get("site_address");
    let grade: String = rfq.get("grade");

    sqlx::query(
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
    )
    .bind(plant_id)
    .bind(&quotation_number)
    .bind(request_id)
    .bind(customer_id)
    .bind(&customer_name)
    .bind(customer_phone)
    .bind(site_name.unwrap_or_else(|| "Site".to_string()))
    .bind(site_address.unwrap_or_else(|| "Site Address".to_string()))
    .bind(&grade)
    .bind(q_m3)
    .bind(rate)
    .bind(gst)
    .bind(transport)
    .bind(pumping)
    .bind(total)
    .bind(valid_date)
    .bind(&payload.notes)
    .execute(&state.db)
    .await?;

    sqlx::query("UPDATE customer_quotation_requests SET status = 'QUOTED', updated_at = NOW() WHERE id = $1")
        .bind(request_id)
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
    check_role(&auth_user, &["customer"])?;
    let quotes:Vec<serde_json::Value>=sqlx::query_scalar("SELECT to_jsonb(q)||jsonb_build_object('plant_name',p.name,'plant_phone',p.contact_phone,'site_id',r.site_id,'quantity_m3',q.quantity_m3::DOUBLE PRECISION,'rate_per_m3',q.rate_per_m3::DOUBLE PRECISION,'gst_rate',q.gst_rate::DOUBLE PRECISION,'transport_amount',q.transport_amount::DOUBLE PRECISION,'pumping_amount',q.pumping_amount::DOUBLE PRECISION,'total',q.total_amount::DOUBLE PRECISION,'total_amount',q.total_amount::DOUBLE PRECISION,'gst_amount',ROUND((q.quantity_m3*q.rate_per_m3+q.transport_amount+q.pumping_amount)*q.gst_rate/100,2)::DOUBLE PRECISION,'order_id',o.id,'order_number',o.order_number) FROM plant_quotations q JOIN rmc_plants p ON p.id=q.plant_id LEFT JOIN customer_quotation_requests r ON r.id=q.request_id AND r.customer_id=q.customer_id LEFT JOIN orders o ON o.quotation_id=q.id WHERE q.customer_id=$1 ORDER BY q.created_at DESC LIMIT 500")
        .bind(auth_user.user_id).fetch_all(&state.db).await?;
    Ok(Json(json!({"success":true,"quotations":quotes})))
}

#[derive(Debug, Deserialize, Serialize)]
pub struct CustomerQuotationDecisionPayload {
    pub action: String,
    pub reason: Option<String>,
}

pub async fn decide_customer_quotation(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(quotation_id): Path<Uuid>,
    Json(payload): Json<CustomerQuotationDecisionPayload>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["customer"])?;
    let new_status = match payload.action.as_str() {
        "ACCEPT" => "ACCEPTED",
        "DECLINE" => "DECLINED",
        _ => {
            return Err(AppError::BadRequest(
                "Action must be ACCEPT or DECLINE".into(),
            ))
        }
    };
    if payload.reason.as_ref().is_some_and(|s| s.len() > 2000) {
        return Err(AppError::BadRequest("Reason is too long".into()));
    }
    let mut tx = state.db.begin().await?;
    let row = sqlx::query(
        "SELECT status,valid_until FROM plant_quotations WHERE id=$1 AND customer_id=$2 FOR UPDATE",
    )
    .bind(quotation_id)
    .bind(auth_user.user_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound("Quotation not found".into()))?;
    let status: String = row.get("status");
    if status != new_status {
        if status != "SENT"
            || row.get::<chrono::NaiveDate, _>("valid_until") < chrono::Utc::now().date_naive()
        {
            return Err(AppError::Conflict(
                "Only an unexpired sent quotation can be decided".into(),
            ));
        }
        sqlx::query(
            "UPDATE plant_quotations SET status=$1,decline_reason=$2,updated_at=NOW() WHERE id=$3",
        )
        .bind(new_status)
        .bind(payload.reason)
        .bind(quotation_id)
        .execute(&mut *tx)
        .await?;
        sqlx::query("INSERT INTO audit_logs(user_id,action,resource_type,resource_id,metadata) VALUES($1,'quotation.decision','quotation',$2,$3)").bind(auth_user.user_id).bind(quotation_id.to_string()).bind(json!({"from":status,"to":new_status})).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(Json(json!({"success":true,"status":new_status})))
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

    let rows = sqlx::query(
        r#"
        SELECT id, category, amount, expense_date, vendor, reference, payment_method, notes, created_at
        FROM plant_expenses WHERE plant_id = $1 ORDER BY expense_date DESC, created_at DESC
        "#,
    )
    .bind(plant_id)
    .fetch_all(&state.db)
    .await?;

    let expenses: Vec<_> = rows
        .into_iter()
        .map(|r| {
            let id: Uuid = r.get("id");
            let category: String = r.get("category");
            let amount: bigdecimal::BigDecimal = r.get("amount");
            let expense_date: chrono::NaiveDate = r.get("expense_date");
            let vendor: Option<String> = r.get("vendor");
            let reference: Option<String> = r.get("reference");
            let payment_method: String = r.get("payment_method");
            let notes: Option<String> = r.get("notes");
            let created_at: chrono::DateTime<chrono::Utc> = r.get("created_at");

            json!({
                "id": id,
                "category": category,
                "amount": amount,
                "expense_date": expense_date,
                "vendor": vendor,
                "reference": reference,
                "payment_method": payment_method,
                "notes": notes,
                "created_at": created_at
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
        Some(s) => NaiveDate::parse_from_str(&s, "%Y-%m-%d")
            .unwrap_or_else(|_| chrono::Utc::now().naive_utc().date()),
        None => chrono::Utc::now().naive_utc().date(),
    };

    let id: Uuid = sqlx::query_scalar(
        r#"
        INSERT INTO plant_expenses (
            plant_id, recorded_by, category, amount, expense_date, vendor, reference, payment_method, notes
        )
        VALUES ($1, $2, $3, $4::numeric, $5, $6, $7, $8, $9)
        RETURNING id
        "#,
    )
    .bind(plant_id)
    .bind(auth_user.user_id)
    .bind(&payload.category)
    .bind(payload.amount)
    .bind(dt)
    .bind(&payload.vendor)
    .bind(&payload.reference)
    .bind(payload.payment_method.unwrap_or_else(|| "cash".to_string()))
    .bind(&payload.notes)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(
        json!({ "success": true, "id": id, "message": "Expense recorded" }),
    ))
}

#[derive(Debug, Deserialize, Serialize)]
pub struct DieselPayload {
    pub transaction_type: String,
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

    let rows = sqlx::query(
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
    )
    .bind(plant_id)
    .fetch_all(&state.db)
    .await?;

    let transactions: Vec<_> = rows
        .into_iter()
        .map(|r| {
            let id: Uuid = r.get("id");
            let transaction_type: String = r.get("transaction_type");
            let litres: bigdecimal::BigDecimal = r.get("litres");
            let rate_per_litre: Option<bigdecimal::BigDecimal> = r.get("rate_per_litre");
            let odometer_km: Option<bigdecimal::BigDecimal> = r.get("odometer_km");
            let vehicle_number: Option<String> = r.get("vehicle_number");
            let supplier_name: Option<String> = r.get("supplier_name");
            let reference: Option<String> = r.get("reference");
            let notes: Option<String> = r.get("notes");
            let transaction_date: chrono::NaiveDate = r.get("transaction_date");
            let created_at: chrono::DateTime<chrono::Utc> = r.get("created_at");

            json!({
                "id": id,
                "transaction_type": transaction_type,
                "litres": litres,
                "rate_per_litre": rate_per_litre,
                "odometer_km": odometer_km,
                "vehicle_number": vehicle_number,
                "supplier_name": supplier_name,
                "reference": reference,
                "notes": notes,
                "transaction_date": transaction_date,
                "created_at": created_at
            })
        })
        .collect();

    Ok(Json(
        json!({ "success": true, "transactions": transactions }),
    ))
}

pub async fn record_diesel_transaction(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(plant_id): Path<Uuid>,
    Json(payload): Json<DieselPayload>,
) -> Result<impl IntoResponse, AppError> {
    check_role(
        &auth_user,
        &[
            "owner",
            "plant_owner",
            "admin",
            "accountant",
            "fleet_manager",
        ],
    )?;
    ensure_plant_staff_or_owner(&state, &auth_user, plant_id).await?;

    let id: Uuid = sqlx::query_scalar(
        r#"
        INSERT INTO diesel_transactions (
            plant_id, recorded_by, transaction_type, litres, rate_per_litre,
            vehicle_id, supplier_id, odometer_km, reference, notes
        )
        VALUES ($1, $2, $3, $4::numeric, $5::numeric, $6, $7, $8::numeric, $9, $10)
        RETURNING id
        "#,
    )
    .bind(plant_id)
    .bind(auth_user.user_id)
    .bind(&payload.transaction_type)
    .bind(payload.litres)
    .bind(payload.rate_per_litre.unwrap_or(0.0))
    .bind(payload.vehicle_id)
    .bind(payload.supplier_id)
    .bind(payload.odometer_km.unwrap_or(0.0))
    .bind(&payload.reference)
    .bind(&payload.notes)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(
        json!({ "success": true, "id": id, "message": "Diesel transaction recorded" }),
    ))
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

    let rows = sqlx::query(
        r#"
        SELECT p.id, p.receipt_number, p.receipt_date, p.lines, p.gst_amount,
               p.freight_amount, p.total_amount, p.notes, p.created_at,
               s.name as supplier_name
        FROM purchase_receipts p
        INNER JOIN plant_suppliers s ON s.id = p.supplier_id
        WHERE p.plant_id = $1
        ORDER BY p.receipt_date DESC, p.created_at DESC
        "#,
    )
    .bind(plant_id)
    .fetch_all(&state.db)
    .await?;

    let purchases: Vec<_> = rows
        .into_iter()
        .map(|r| {
            let id: Uuid = r.get("id");
            let receipt_number: String = r.get("receipt_number");
            let supplier_name: String = r.get("supplier_name");
            let receipt_date: chrono::NaiveDate = r.get("receipt_date");
            let lines: serde_json::Value = r.get("lines");
            let gst_amount: bigdecimal::BigDecimal = r.get("gst_amount");
            let freight_amount: bigdecimal::BigDecimal = r.get("freight_amount");
            let total_amount: bigdecimal::BigDecimal = r.get("total_amount");
            let notes: Option<String> = r.get("notes");
            let created_at: chrono::DateTime<chrono::Utc> = r.get("created_at");

            json!({
                "id": id,
                "receipt_number": receipt_number,
                "supplier_name": supplier_name,
                "receipt_date": receipt_date,
                "lines": lines,
                "gst_amount": gst_amount,
                "freight_amount": freight_amount,
                "total_amount": total_amount,
                "notes": notes,
                "created_at": created_at
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
        &[
            "owner",
            "plant_owner",
            "admin",
            "accountant",
            "store_manager",
        ],
    )?;
    ensure_plant_staff_or_owner(&state, &auth_user, plant_id).await?;

    let dt = match payload.receipt_date {
        Some(s) => NaiveDate::parse_from_str(&s, "%Y-%m-%d")
            .unwrap_or_else(|_| chrono::Utc::now().naive_utc().date()),
        None => chrono::Utc::now().naive_utc().date(),
    };

    let id: Uuid = sqlx::query_scalar(
        r#"
        INSERT INTO purchase_receipts (
            plant_id, supplier_id, receipt_number, receipt_date, lines,
            gst_amount, freight_amount, total_amount, notes
        )
        VALUES ($1, $2, $3, $4, $5, $6::numeric, $7::numeric, $8::numeric, $9)
        RETURNING id
        "#,
    )
    .bind(plant_id)
    .bind(payload.supplier_id)
    .bind(&payload.receipt_number)
    .bind(dt)
    .bind(&payload.lines)
    .bind(payload.gst_amount.unwrap_or(0.0))
    .bind(payload.freight_amount.unwrap_or(0.0))
    .bind(payload.total_amount)
    .bind(&payload.notes)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(
        json!({ "success": true, "id": id, "message": "Purchase receipt recorded" }),
    ))
}
