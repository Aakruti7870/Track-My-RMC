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
use sqlx::Row;
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

    let plant_rows=sqlx::query("SELECT p.id,p.name,p.address_line AS address,p.city,NULL::text AS taluka,p.district,p.state FROM rmc_plants p WHERE p.is_active=TRUE AND ((p.owner_id=$1 AND $2 IN ('owner','plant_owner')) OR EXISTS(SELECT 1 FROM plant_staff ps WHERE ps.plant_id=p.id AND ps.user_id=$1 AND ps.is_active=TRUE)) ORDER BY p.name").bind(auth_user.user_id).bind(&auth_user.role).fetch_all(&state.db).await?;
    let mut plants_json = Vec::new();
    for p in plant_rows {
        let pid: Uuid = p.get("id");
        let name: String = p.get("name");
        let address: Option<String> = p.get("address");
        let city: Option<String> = p.get("city");
        let taluka: Option<String> = p.get("taluka");
        let district: Option<String> = p.get("district");
        let state_val: Option<String> = p.get("state");

        // Fetch active premium plan if any
        let premium_row = sqlx::query(
            r#"
            SELECT s.status, p.plan_code, s.current_period_end
            FROM plant_plan_subscriptions s
            INNER JOIN plant_subscription_plans p ON p.id = s.plan_id
            WHERE s.plant_id = $1 AND s.status = 'ACTIVE' AND s.current_period_end > NOW()
            ORDER BY s.current_period_end DESC LIMIT 1
            "#,
        )
        .bind(pid)
        .fetch_optional(&state.db)
        .await?;

        let premium_val = premium_row.map(|r| {
            let status: String = r.get("status");
            let plan: String = r.get("plan_code");
            let ends_at: chrono::DateTime<chrono::Utc> = r.get("current_period_end");
            json!({
                "status": status,
                "plan": plan,
                "ends_at": ends_at.to_rfc3339(),
                "activation_mode": "ONLINE_PAYMENT"
            })
        });

        plants_json.push(json!({
            "id": pid,
            "name": name,
            "address": address,
            "city": city,
            "taluka": taluka,
            "district": district,
            "state": state_val,
            "premium": premium_val,
            "promotion": null
        }));
    }

    Ok(Json(json!({
        "role": auth_user.role,
        "plants": plants_json,
        "promotion_prices": {
            "7": 499,
            "15": 899,
            "30": 1499,
            "90": 3999
        },
        "premium_plans": {
            "STARTER": { "months": 1, "price": 1999 },
            "GROWTH": { "months": 1, "price": 4999 },
            "ENTERPRISE": { "months": 1, "price": 9999 }
        }
    })))
}

#[derive(Debug, Deserialize, Serialize)]
pub struct PlanQuotePayload {
    pub plant_id: Option<Uuid>,
    pub product: Option<String>,
    pub duration_days: Option<i32>,
    pub premium_plan: Option<String>,
    pub promo_code: Option<String>,
}

pub async fn quote_plan(
    State(_state): State<AppState>,
    auth_user: AuthUser,
    Json(payload): Json<PlanQuotePayload>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["owner", "plant_owner", "admin"])?;

    let product = payload
        .product
        .unwrap_or_else(|| "PREMIUM".to_string())
        .to_uppercase();
    let (base_price, plan_name) = if product == "PROMOTION" {
        let days = payload.duration_days.unwrap_or(30);
        let p = match days {
            7 => 499.0,
            15 => 899.0,
            90 => 3999.0,
            _ => 1499.0,
        };
        (p, format!("PROMOTION_{}D", days))
    } else {
        let plan = payload
            .premium_plan
            .unwrap_or_else(|| "GROWTH".to_string())
            .to_uppercase();
        let p = match plan.as_str() {
            "ENTERPRISE" => 9999.0,
            "STARTER" => 1999.0,
            _ => 4999.0,
        };
        (p, plan)
    };

    let mut discount: f64 = 0.0_f64;
    if let Some(code) = &payload.promo_code {
        let c = code.trim().to_uppercase();
        if c == "LAUNCH50" {
            discount = base_price * 0.50_f64;
        } else if c == "ANNUAL20" {
            discount = base_price * 0.20_f64;
        }
    }

    let payable = (base_price - discount).max(0.0_f64);

    Ok(Json(json!({
        "product": product,
        "plan": plan_name,
        "price": base_price,
        "discount": discount,
        "payable": payable,
        "promo_code": payload.promo_code
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
        Ok(Json(
            json!({ "valid": true, "discount_percent": 50, "description": "Launch Offer 50% Off" }),
        ))
    } else if code == "ANNUAL20" {
        Ok(Json(
            json!({ "valid": true, "discount_percent": 20, "description": "Annual Subscription 20% Off" }),
        ))
    } else {
        Ok(Json(
            json!({ "valid": false, "message": "Invalid or expired promo code" }),
        ))
    }
}

#[derive(Debug, Deserialize, Serialize)]
pub struct ActivatePlanPayload {
    pub plant_id: Option<Uuid>,
    pub product: Option<String>,
    pub duration_days: Option<i32>,
    pub premium_plan: Option<String>,
    pub promo_code: Option<String>,
    pub activation_mode: Option<String>,
}

pub async fn activate_plan(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Json(payload): Json<ActivatePlanPayload>,
) -> Result<Json<serde_json::Value>, AppError> {
    check_role(&auth_user, &["owner", "plant_owner", "admin"])?;
    let plant = match payload.plant_id {
        Some(id) => id,
        None => get_user_plant_id(&state, &auth_user).await?,
    };
    super::business_routes::ensure_plant_staff_or_owner(&state, &auth_user, plant).await?;
    Err(AppError::Conflict("Verified payment-provider checkout is not configured; no payment or subscription was activated".into()))
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

    super::business_routes::ensure_plant_staff_or_owner(&state, &auth_user, target_plant).await?;
    let rows = sqlx::query(
        r#"
        SELECT id, order_number, amount, gateway_order_id, payment_status, paid_at, created_at
        FROM plant_plan_payments
        WHERE plant_id = $1
        ORDER BY created_at DESC
        "#,
    )
    .bind(target_plant)
    .fetch_all(&state.db)
    .await?;

    let payments: Vec<_> = rows
        .into_iter()
        .map(|r| {
            let id: Uuid = r.get("id");
            let order_number: String = r.get("order_number");
            let amount: bigdecimal::BigDecimal = r.get("amount");
            let gateway_order_id: Option<String> = r.get("gateway_order_id");
            let payment_status: String = r.get("payment_status");
            let paid_at: Option<chrono::DateTime<chrono::Utc>> = r.get("paid_at");
            let created_at: chrono::DateTime<chrono::Utc> = r.get("created_at");
            json!({
                "id": id,
                "order_number": order_number,
                "amount": amount,
                "gateway_order_id": gateway_order_id,
                "payment_status": payment_status,
                "paid_at": paid_at,
                "created_at": created_at
            })
        })
        .collect();

    Ok(Json(json!({ "success": true, "payments": payments })))
}

pub async fn get_payment_order_status(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(order_number): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    let pay = sqlx::query(
        "SELECT id, plant_id, order_number, amount, payment_status, paid_at FROM plant_plan_payments WHERE order_number = $1",
    )
    .bind(&order_number)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Payment order not found".to_string()))?;

    super::business_routes::ensure_plant_staff_or_owner(&state, &auth_user, pay.get("plant_id"))
        .await?;
    let id: Uuid = pay.get("id");
    let ord_num: String = pay.get("order_number");
    let amount: bigdecimal::BigDecimal = pay.get("amount");
    let payment_status: String = pay.get("payment_status");

    Ok(Json(json!({
        "order_number": ord_num,
        "status": payment_status,
        "product": null,
        "plan": null,
        "payable": amount,
        "activation_id": id
    })))
}
