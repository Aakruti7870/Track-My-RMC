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

#[derive(Debug, Deserialize, Serialize)]
pub struct PrepareOrderIntentPayload {
    pub prompt: String,
    pub customer_id: Option<Uuid>,
}

pub async fn prepare_order_intent(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Json(payload): Json<PrepareOrderIntentPayload>,
) -> Result<impl IntoResponse, AppError> {
    let prompt_lower = payload.prompt.to_lowercase();

    // Extract grade if mentioned, default to M-25
    let grade = if prompt_lower.contains("m-10") || prompt_lower.contains("m10") {
        "M-10"
    } else if prompt_lower.contains("m-15") || prompt_lower.contains("m15") {
        "M-15"
    } else if prompt_lower.contains("m-20") || prompt_lower.contains("m20") {
        "M-20"
    } else if prompt_lower.contains("m-30") || prompt_lower.contains("m30") {
        "M-30"
    } else if prompt_lower.contains("m-35") || prompt_lower.contains("m35") {
        "M-35"
    } else if prompt_lower.contains("m-40") || prompt_lower.contains("m40") {
        "M-40"
    } else {
        "M-25"
    };

    // Extract quantity if numeric token found, default to 6.0 m3
    let mut quantity = 6.0;
    for token in prompt_lower.split_whitespace() {
        if let Ok(val) = token.parse::<f64>() {
            if val > 0.0 && val <= 500.0 {
                quantity = val;
                break;
            }
        }
    }

    let default_site = sqlx::query!(
        "SELECT id, name, address_line FROM customer_sites WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 1",
        auth_user.user_id
    )
    .fetch_optional(&state.db)
    .await?;

    let default_plant = sqlx::query!(
        "SELECT id, name FROM rmc_plants WHERE is_active = TRUE ORDER BY rating DESC LIMIT 1"
    )
    .fetch_optional(&state.db)
    .await?;

    let estimated_rate = 3800.0;
    let subtotal = quantity * estimated_rate;
    let tax = subtotal * 0.18;
    let total = subtotal + tax;

    let token = format!("intent-tok-{}", Uuid::new_v4());

    Ok(Json(json!({
        "success": true,
        "token": token,
        "draft_order": {
            "grade": grade,
            "quantity_m3": quantity,
            "plant_id": default_plant.as_ref().map(|p| p.id),
            "plant_name": default_plant.as_ref().map(|p| p.name.clone()).unwrap_or_else(|| "Nearby Plant".to_string()),
            "site_id": default_site.as_ref().map(|s| s.id),
            "site_name": default_site.as_ref().map(|s| s.name.clone()).unwrap_or_else(|| "Default Site".to_string()),
            "estimated_rate_per_m3": estimated_rate,
            "estimated_total_amount": total
        }
    })))
}

#[derive(Debug, Deserialize, Serialize)]
pub struct ConfirmOrderIntentPayload {
    pub token: String,
    pub plant_id: Uuid,
    pub site_id: Uuid,
    pub concrete_grade: String,
    pub quantity_m3: f64,
    pub delivery_date: Option<String>,
}

pub async fn confirm_order_intent(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Json(payload): Json<ConfirmOrderIntentPayload>,
) -> Result<impl IntoResponse, AppError> {
    let order_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM orders")
        .fetch_one(&state.db)
        .await?;
    let order_number = format!("ORD-{:06}", order_count + 1);

    let rate = 3800.0;
    let subtotal = payload.quantity_m3 * rate;
    let tax = subtotal * 0.18;
    let total = subtotal + tax;

    let dt = match payload.delivery_date {
        Some(s) => chrono::NaiveDate::parse_from_str(&s, "%Y-%m-%d").unwrap_or_else(|_| chrono::Utc::now().naive_utc().date()),
        None => chrono::Utc::now().naive_utc().date(),
    };

    let order_id = sqlx::query_scalar!(
        r#"
        INSERT INTO orders (
            order_number, customer_id, plant_id, site_id, concrete_grade,
            total_quantity_m3, delivery_date, delivery_time_slot, pump_required,
            total_amount, tax_amount, status, payment_status
        )
        VALUES (
            $1, $2, $3, $4, $5, $6::numeric, $7, 'Morning (09:00 - 13:00)', FALSE,
            $8::numeric, $9::numeric, 'pending', 'unpaid'
        )
        RETURNING id
        "#,
        order_number,
        auth_user.user_id,
        payload.plant_id,
        payload.site_id,
        payload.concrete_grade,
        bigdecimal::BigDecimal::try_from(payload.quantity_m3).unwrap_or_default(),
        dt,
        bigdecimal::BigDecimal::try_from(total).unwrap_or_default(),
        bigdecimal::BigDecimal::try_from(tax).unwrap_or_default()
    )
    .fetch_one(&state.db)
    .await?;

    // Create primary load
    sqlx::query!(
        r#"
        INSERT INTO order_loads (order_id, load_number, quantity_m3, status)
        VALUES ($1, 1, $2::numeric, 'planned')
        "#,
        order_id,
        bigdecimal::BigDecimal::try_from(payload.quantity_m3.min(6.0)).unwrap_or_default()
    )
    .execute(&state.db)
    .await?;

    Ok(Json(json!({
        "success": true,
        "order_id": order_id,
        "order_number": order_number,
        "total_amount": total,
        "message": "Order successfully created"
    })))
}

#[derive(Debug, Deserialize, Serialize)]
pub struct CreateSupportCasePayload {
    pub subject: String,
    pub order_id: Option<Uuid>,
    pub category: Option<String>,
    pub priority: Option<String>,
    pub message: String,
}

pub async fn create_support_case(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Json(payload): Json<CreateSupportCasePayload>,
) -> Result<impl IntoResponse, AppError> {
    let mut tx = state.db.begin().await?;

    let case_id = sqlx::query_scalar!(
        r#"
        INSERT INTO support_cases (user_id, order_id, subject, category, priority, status)
        VALUES ($1, $2, $3, $4, $5, 'open')
        RETURNING id
        "#,
        auth_user.user_id,
        payload.order_id,
        payload.subject,
        payload.category.unwrap_or_else(|| "general".to_string()),
        payload.priority.unwrap_or_else(|| "normal".to_string())
    )
    .fetch_one(&mut *tx)
    .await?;

    sqlx::query!(
        r#"
        INSERT INTO support_case_replies (case_id, sender_id, is_staff, message)
        VALUES ($1, $2, FALSE, $3)
        "#,
        case_id,
        auth_user.user_id,
        payload.message
    )
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    Ok(Json(json!({ "success": true, "case_id": case_id, "message": "Support case opened" })))
}

pub async fn list_support_cases(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<impl IntoResponse, AppError> {
    let rows = sqlx::query!(
        r#"
        SELECT c.id, c.subject, c.category, c.priority, c.status, c.created_at, c.updated_at,
               o.order_number
        FROM support_cases c
        LEFT JOIN orders o ON o.id = c.order_id
        WHERE c.user_id = $1
        ORDER BY c.updated_at DESC
        "#,
        auth_user.user_id
    )
    .fetch_all(&state.db)
    .await?;

    let cases: Vec<_> = rows
        .into_iter()
        .map(|r| {
            json!({
                "id": r.id,
                "subject": r.subject,
                "category": r.category,
                "priority": r.priority,
                "status": r.status,
                "order_number": r.order_number,
                "created_at": r.created_at,
                "updated_at": r.updated_at
            })
        })
        .collect();

    Ok(Json(json!({ "success": true, "cases": cases })))
}

pub async fn get_support_case_details(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(case_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    let case = sqlx::query!(
        r#"
        SELECT c.id, c.user_id, c.subject, c.category, c.priority, c.status, c.created_at, c.updated_at,
               u.full_name as user_name
        FROM support_cases c
        INNER JOIN users u ON u.id = c.user_id
        WHERE c.id = $1
        "#,
        case_id
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Case not found".to_string()))?;

    if auth_user.role != "admin" && case.user_id != auth_user.user_id {
        return Err(AppError::Forbidden("Unauthorized to view this case".to_string()));
    }

    let replies = sqlx::query!(
        r#"
        SELECT r.id, r.sender_id, r.is_staff, r.message, r.created_at,
               u.full_name as sender_name
        FROM support_case_replies r
        INNER JOIN users u ON u.id = r.sender_id
        WHERE r.case_id = $1
        ORDER BY r.created_at ASC
        "#,
        case_id
    )
    .fetch_all(&state.db)
    .await?;

    Ok(Json(json!({
        "success": true,
        "case": {
            "id": case.id,
            "subject": case.subject,
            "category": case.category,
            "priority": case.priority,
            "status": case.status,
            "user_name": case.user_name,
            "created_at": case.created_at,
            "updated_at": case.updated_at
        },
        "replies": replies.into_iter().map(|r| json!({
            "id": r.id,
            "sender_id": r.sender_id,
            "sender_name": r.sender_name,
            "is_staff": r.is_staff,
            "message": r.message,
            "created_at": r.created_at
        })).collect::<Vec<_>>()
    })))
}

#[derive(Debug, Deserialize, Serialize)]
pub struct AddReplyPayload {
    pub message: String,
}

pub async fn add_case_reply(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(case_id): Path<Uuid>,
    Json(payload): Json<AddReplyPayload>,
) -> Result<impl IntoResponse, AppError> {
    let case_user: Uuid = sqlx::query_scalar("SELECT user_id FROM support_cases WHERE id = $1")
        .bind(case_id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("Case not found".to_string()))?;

    let is_staff = auth_user.role == "admin" || (auth_user.user_id != case_user);

    let mut tx = state.db.begin().await?;

    sqlx::query!(
        r#"
        INSERT INTO support_case_replies (case_id, sender_id, is_staff, message)
        VALUES ($1, $2, $3, $4)
        "#,
        case_id,
        auth_user.user_id,
        is_staff,
        payload.message
    )
    .execute(&mut *tx)
    .await?;

    sqlx::query!("UPDATE support_cases SET updated_at = NOW() WHERE id = $1", case_id)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;

    Ok(Json(json!({ "success": true, "message": "Reply added" })))
}

pub async fn list_staff_support_cases(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["admin", "owner", "plant_owner", "dispatcher"])?;

    let rows = sqlx::query!(
        r#"
        SELECT c.id, c.subject, c.category, c.priority, c.status, c.created_at, c.updated_at,
               u.full_name as customer_name, u.phone as customer_phone
        FROM support_cases c
        INNER JOIN users u ON u.id = c.user_id
        ORDER BY c.updated_at DESC
        "#
    )
    .fetch_all(&state.db)
    .await?;

    let cases: Vec<_> = rows
        .into_iter()
        .map(|r| {
            json!({
                "id": r.id,
                "subject": r.subject,
                "category": r.category,
                "priority": r.priority,
                "status": r.status,
                "customer_name": r.customer_name,
                "customer_phone": r.customer_phone,
                "created_at": r.created_at,
                "updated_at": r.updated_at
            })
        })
        .collect();

    Ok(Json(json!({ "success": true, "cases": cases })))
}

#[derive(Debug, Deserialize, Serialize)]
pub struct UpdateCaseStatusPayload {
    pub status: String, // "open", "in_progress", "resolved", "closed"
}

pub async fn update_case_status(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(case_id): Path<Uuid>,
    Json(payload): Json<UpdateCaseStatusPayload>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["admin", "owner", "plant_owner"])?;

    sqlx::query!(
        "UPDATE support_cases SET status = $1, updated_at = NOW() WHERE id = $2",
        payload.status,
        case_id
    )
    .execute(&state.db)
    .await?;

    Ok(Json(json!({ "success": true, "status": payload.status, "message": "Case status updated" })))
}
