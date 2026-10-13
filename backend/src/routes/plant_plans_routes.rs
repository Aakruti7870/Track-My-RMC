use crate::{
    auth::{middleware::check_role, AuthUser},
    error::AppError,
    state::AppState,
};
use axum::{
    extract::{Path, Query, State},
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;

async fn get_user_plant_id(state: &AppState, auth_user: &AuthUser) -> Result<Uuid, AppError> {
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

    plant_id.ok_or_else(|| AppError::Forbidden("No active plant found for this user".to_string()))
}

pub async fn get_plan_context(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["owner", "plant_owner", "admin"])?;
    let plant_id = get_user_plant_id(&state, &auth_user).await?;

    let sub = sqlx::query!(
        r#"
        SELECT s.id, s.status, s.current_period_start, s.current_period_end,
               p.plan_code, p.name as plan_name, p.monthly_price, p.features
        FROM plant_plan_subscriptions s
        INNER JOIN plant_subscription_plans p ON p.id = s.plan_id
        WHERE s.plant_id = $1
        ORDER BY s.created_at DESC
        LIMIT 1
        "#,
        plant_id
    )
    .fetch_optional(&state.db)
    .await?;

    let available_plans = sqlx::query!(
        "SELECT id, plan_code, name, monthly_price, features FROM plant_subscription_plans WHERE is_active = TRUE ORDER BY monthly_price ASC"
    )
    .fetch_all(&state.db)
    .await?;

    Ok(Json(json!({
        "success": true,
        "plant_id": plant_id,
        "current_subscription": sub.map(|s| json!({
            "plan_code": s.plan_code,
            "plan_name": s.plan_name,
            "status": s.status,
            "current_period_start": s.current_period_start,
            "current_period_end": s.current_period_end,
            "features": s.features
        })),
        "available_plans": available_plans.into_iter().map(|p| json!({
            "id": p.id,
            "code": p.plan_code,
            "name": p.name,
            "monthly_price": p.monthly_price,
            "features": p.features
        })).collect::<Vec<_>>()
    })))
}

#[derive(Debug, Deserialize, Serialize)]
pub struct PlanQuotePayload {
    pub plan_code: String,
    pub months: Option<i32>,
    pub promo_code: Option<String>,
}

pub async fn quote_plan(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Json(payload): Json<PlanQuotePayload>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["owner", "plant_owner", "admin"])?;

    let months = payload.months.unwrap_or(1).max(1);

    let base_monthly: f64 = match payload.plan_code.to_uppercase().as_str() {
        "ENTERPRISE" => 9999.0,
        "GROWTH" => 4999.0,
        _ => 1999.0, // "STARTER"
    };

    let mut discount = 0.0;
    if let Some(code) = &payload.promo_code {
        if code.to_uppercase() == "LAUNCH50" {
            discount = 0.50;
        } else if code.to_uppercase() == "ANNUAL20" && months >= 12 {
            discount = 0.20;
        }
    }

    let subtotal = base_monthly * (months as f64);
    let discounted_subtotal = subtotal * (1.0 - discount);
    let tax = discounted_subtotal * 0.18;
    let total = discounted_subtotal + tax;

    Ok(Json(json!({
        "success": true,
        "plan_code": payload.plan_code,
        "months": months,
        "base_monthly": base_monthly,
        "subtotal": subtotal,
        "discount_percent": (discount * 100.0) as i32,
        "tax": tax,
        "total_amount": total
    })))
}

#[derive(Debug, Deserialize, Serialize)]
pub struct ValidatePromoPayload {
    pub promo_code: String,
}

pub async fn validate_promo_code(
    State(_state): State<AppState>,
    _auth_user: AuthUser,
    Json(payload): Json<ValidatePromoPayload>,
) -> Result<impl IntoResponse, AppError> {
    let code = payload.promo_code.trim().to_uppercase();
    if code == "LAUNCH50" {
        Ok(Json(json!({ "valid": true, "discount_percent": 50, "description": "Launch Offer 50% Off" })))
    } else if code == "ANNUAL20" {
        Ok(Json(json!({ "valid": true, "discount_percent": 20, "description": "Annual Subscription 20% Off" })))
    } else {
        Ok(Json(json!({ "valid": false, "message": "Invalid or expired promo code" })))
    }
}

#[derive(Debug, Deserialize, Serialize)]
pub struct ActivatePlanPayload {
    pub plan_code: String,
    pub months: Option<i32>,
    pub payment_reference: Option<String>,
}

pub async fn activate_plan(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Json(payload): Json<ActivatePlanPayload>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["owner", "plant_owner", "admin"])?;
    let plant_id = get_user_plant_id(&state, &auth_user).await?;

    let months = payload.months.unwrap_or(1).max(1);

    // Get or create plan
    let plan = sqlx::query!(
        "SELECT id FROM plant_subscription_plans WHERE plan_code = $1",
        payload.plan_code
    )
    .fetch_optional(&state.db)
    .await?;

    let plan_id = match plan {
        Some(p) => p.id,
        None => {
            sqlx::query_scalar!(
                r#"
                INSERT INTO plant_subscription_plans (plan_code, name, monthly_price)
                VALUES ($1, $2, 4999.00)
                RETURNING id
                "#,
                payload.plan_code,
                format!("Plan {}", payload.plan_code)
            )
            .fetch_one(&state.db)
            .await?
        }
    };

    let end_time = chrono::Utc::now() + chrono::Duration::days((months as i64) * 30);

    let mut tx = state.db.begin().await?;

    let sub_id = sqlx::query_scalar!(
        r#"
        INSERT INTO plant_plan_subscriptions (plant_id, plan_id, status, current_period_start, current_period_end)
        VALUES ($1, $2, 'ACTIVE', NOW(), $3)
        RETURNING id
        "#,
        plant_id,
        plan_id,
        end_time
    )
    .fetch_one(&mut *tx)
    .await?;

    let order_number = format!("SUB-ORD-{:05}", rand::random::<u16>());
    sqlx::query!(
        r#"
        INSERT INTO plant_plan_payments (plant_id, order_number, amount, payment_status, paid_at)
        VALUES ($1, $2, 4999.00, 'PAID', NOW())
        "#,
        plant_id,
        order_number
    )
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    Ok(Json(json!({
        "success": true,
        "subscription_id": sub_id,
        "plan_code": payload.plan_code,
        "status": "ACTIVE",
        "current_period_end": end_time,
        "message": "Plan activated successfully"
    })))
}

#[derive(Debug, Deserialize)]
pub struct PaymentHistoryQuery {
    pub plant_id: Option<Uuid>,
}

pub async fn list_payment_history(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Query(q): Query<PaymentHistoryQuery>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["owner", "plant_owner", "admin"])?;

    let target_plant = match q.plant_id {
        Some(id) => id,
        None => get_user_plant_id(&state, &auth_user).await?,
    };

    let rows = sqlx::query!(
        r#"
        SELECT id, order_number, amount, gateway_order_id, payment_status, paid_at, created_at
        FROM plant_plan_payments
        WHERE plant_id = $1
        ORDER BY created_at DESC
        "#,
        target_plant
    )
    .fetch_all(&state.db)
    .await?;

    let payments: Vec<_> = rows
        .into_iter()
        .map(|r| {
            json!({
                "id": r.id,
                "order_number": r.order_number,
                "amount": r.amount,
                "gateway_order_id": r.gateway_order_id,
                "payment_status": r.payment_status,
                "paid_at": r.paid_at,
                "created_at": r.created_at
            })
        })
        .collect();

    Ok(Json(json!({ "success": true, "payments": payments })))
}

pub async fn get_payment_order_status(
    State(state): State<AppState>,
    _auth_user: AuthUser,
    Path(order_number): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    let pay = sqlx::query!(
        "SELECT id, order_number, amount, payment_status, paid_at FROM plant_plan_payments WHERE order_number = $1",
        order_number
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Payment order not found".to_string()))?;

    Ok(Json(json!({
        "success": true,
        "order": {
            "id": pay.id,
            "order_number": pay.order_number,
            "amount": pay.amount,
            "status": pay.payment_status,
            "paid_at": pay.paid_at
        }
    })))
}
