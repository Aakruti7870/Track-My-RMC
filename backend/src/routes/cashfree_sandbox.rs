//! Sandbox-only Cashfree adapter. NEVER send client-side amounts or process live transactions.
//! Intents and provider evidence stay in separate tables until business-approved fulfillment.
use crate::{
    auth::{middleware::check_role, AuthUser},
    error::AppError,
    state::AppState,
};
use axum::{
    body::Bytes,
    extract::{Path, State},
    http::HeaderMap,
    Json,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use bigdecimal::BigDecimal;
use chrono::Utc;
use hmac::{Hmac, Mac};
use reqwest::Client;
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::Row;
use std::{env, time::Duration};
use uuid::Uuid;

const SANDBOX_API: &str = "https://sandbox.cashfree.com/pg";
const MAX_WEBHOOK_BYTES: usize = 65_536;
type HmacSha256 = Hmac<Sha256>;

fn enabled() -> Result<(String, String), AppError> {
    // Never permit a live Cashfree host even when a deployment mistakenly sets production flags.
    if env::var("CASHFREE_SANDBOX_ENABLED").ok().as_deref() != Some("true")
        || env::var("CASHFREE_MODE").ok().as_deref() != Some("sandbox")
    {
        return Err(AppError::Conflict("Cashfree sandbox is disabled".into()));
    }
    let id = env::var("CASHFREE_SANDBOX_CLIENT_ID").unwrap_or_default();
    let secret = env::var("CASHFREE_SANDBOX_CLIENT_SECRET").unwrap_or_default();
    if id.trim().is_empty() || secret.len() < 16 {
        return Err(AppError::Conflict("Cashfree sandbox credentials are not configured".into()));
    }
    Ok((id, secret))
}

fn http() -> Result<Client, AppError> {
    Client::builder()
        .timeout(Duration::from_secs(12))
        .build()
        .map_err(|_| AppError::InternalError("Payment client initialization failed".into()))
}

fn ensure_key(key: &str) -> Result<(), AppError> {
    if !(8..=100).contains(&key.len())
        || !key.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        return Err(AppError::BadRequest("Invalid idempotency_key".into()));
    }
    Ok(())
}

fn verify_signature(secret: &str, timestamp: &str, signature: &str, body: &[u8]) -> bool {
    if body.is_empty() || body.len() > MAX_WEBHOOK_BYTES || timestamp.len() > 16 {
        return false;
    }
    let Ok(ts) = timestamp.parse::<i64>() else { return false };
    let seconds = if timestamp.len() == 13 { ts / 1000 } else { ts };
    if (Utc::now().timestamp() - seconds).abs() > 300 {
        return false;
    }
    let Ok(expected) = STANDARD.decode(signature) else { return false };
    let Ok(mut mac) = HmacSha256::new_from_slice(secret.as_bytes()) else {
        return false;
    };
    mac.update(timestamp.as_bytes());
    mac.update(body);
    mac.verify_slice(&expected).is_ok()
}

fn amount(value: &BigDecimal) -> Result<f64, AppError> {
    let a: f64 = value
        .to_string()
        .parse()
        .map_err(|_| AppError::Conflict("Invalid ledger amount".into()))?;
    if !a.is_finite() || a < 1.0 || a > 10_000_000.0 ||
        (a * 100.0 - (a * 100.0).round()).abs() > 0.0001
    {
        return Err(AppError::Conflict("Unsupported checkout amount".into()));
    }
    Ok(a)
}

async fn cashfree_order(
    client: &Client,
    credentials: &(String, String),
    order_id: &str,
) -> Result<Value, AppError> {
    let response = client
        .get(format!("{SANDBOX_API}/orders/{order_id}"))
        .header("x-client-id", &credentials.0)
        .header("x-client-secret", &credentials.1)
        .header("x-api-version", "2025-01-01")
        .send()
        .await
        .map_err(|_| AppError::Conflict("Cashfree sandbox order verification unavailable".into()))?;
    if !response.status().is_success() {
        return Err(AppError::Conflict("Cashfree sandbox order verification rejected".into()));
    }
    response.json().await.map_err(|_| AppError::Conflict("Invalid Cashfree order response".into()))
}

fn provider_status(provider: &Value, expected_id: &str, expected_amount: f64) -> Result<&'static str, AppError> {
    if provider["order_id"].as_str() != Some(expected_id)
        || provider["order_currency"].as_str() != Some("INR")
        || provider["order_amount"].as_f64()
            .is_none_or(|n| (n - expected_amount).abs() > 0.0001)
    {
        return Err(AppError::Conflict("Cashfree order identity, amount or currency mismatch".into()));
    }
    Ok(match provider["order_status"].as_str() {
        Some("PAID") => "VERIFIED",
        Some("EXPIRED") => "EXPIRED",
        _ => "PENDING",
    })
}

#[derive(Deserialize)]
pub struct CheckoutInput {
    pub kind: String,
    pub plant_id: Option<Uuid>,
    pub invoice_id: Option<Uuid>,
    pub sku: Option<String>,
    pub idempotency_key: String,
}

pub async fn checkout(
    State(state): State<AppState>,
    user: AuthUser,
    Json(input): Json<CheckoutInput>,
) -> Result<Json<Value>, AppError> {
    let credentials = enabled()?;
    ensure_key(&input.idempotency_key)?;
    let kind = input.kind.to_uppercase();
    if !["PLAN", "INVOICE"].contains(&kind.as_str()) {
        return Err(AppError::BadRequest("Unsupported payment kind".into()));
    }
    let (plant, invoice, sku, duration, payable) = if kind == "PLAN" {
        check_role(&user, &["owner", "plant_owner"])?;
        // Hard gate: catalog is empty until reviewed and approved; no hard-coded UI quote can charge.
        if env::var("CASHFREE_PLAN_PRICES_APPROVED").ok().as_deref() != Some("true") {
            return Err(AppError::Conflict("Plan pricing awaits business approval".into()));
        }
        let plant = input.plant_id.ok_or_else(|| AppError::BadRequest("plant_id is required".into()))?;
        let owner: Option<Uuid> = sqlx::query_scalar(
            "SELECT owner_id FROM rmc_plants WHERE id=$1 AND is_active=TRUE",
        )
        .bind(plant).fetch_optional(&state.db).await?;
        if owner != Some(user.user_id) {
            return Err(AppError::Forbidden("Plant owner authorization required".into()));
        }
        let sku = input.sku.ok_or_else(|| AppError::BadRequest("sku is required".into()))?;
        if sku.len() > 50 || !sku.bytes().all(|b| b.is_ascii_uppercase() || b.is_ascii_digit() || b == b'_') {
            return Err(AppError::BadRequest("Invalid catalog SKU".into()));
        }
        let price = sqlx::query(
            "SELECT price_inr,duration_days FROM cashfree_approved_plan_prices WHERE sku=$1 AND is_active=TRUE",
        ).bind(&sku).fetch_optional(&state.db).await?
            .ok_or_else(|| AppError::Conflict("This plan has no approved price".into()))?;
        (plant, None, Some(sku), Some(price.get::<i32, _>("duration_days")),
            price.get::<BigDecimal, _>("price_inr"))
    } else {
        check_role(&user, &["customer"])?;
        let invoice = input.invoice_id.ok_or_else(|| AppError::BadRequest("invoice_id is required".into()))?;
        let row = sqlx::query(
            "SELECT i.plant_id,i.customer_id,i.total_amount,COALESCE((SELECT SUM(p.amount) FROM plant_payments p WHERE p.invoice_id=i.id),0) AS already_paid FROM plant_invoices i WHERE i.id=$1",
        ).bind(invoice).fetch_optional(&state.db).await?
            .ok_or_else(|| AppError::NotFound("Invoice not found".into()))?;
        if row.get::<Uuid, _>("customer_id") != user.user_id {
            return Err(AppError::Forbidden("Invoice belongs to another customer".into()));
        }
        let remaining: BigDecimal = row.get::<BigDecimal, _>("total_amount") - row.get::<BigDecimal, _>("already_paid");
        (row.get::<Uuid, _>("plant_id"), Some(invoice), None, None, remaining)
    };
    let a = amount(&payable)?;
    let mut tx = state.db.begin().await?;
    // One stable provider order ID and idempotency key per authenticated payer.
    let new_id = Uuid::new_v4();
    let order_id = format!("trmc_{}", new_id.simple());
    sqlx::query(
        "INSERT INTO cashfree_sandbox_intents(id,requester_id,plant_id,invoice_id,kind,sku,duration_days,request_key,gateway_order_id,amount) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(requester_id,request_key) DO NOTHING",
    )
    .bind(new_id).bind(user.user_id).bind(plant).bind(invoice).bind(&kind).bind(&sku)
    .bind(duration).bind(&input.idempotency_key).bind(&order_id).bind(&payable)
    .execute(&mut *tx).await?;
    let row = sqlx::query(
        "SELECT id,plant_id,invoice_id,kind,sku,amount,gateway_order_id,session_id,status FROM cashfree_sandbox_intents WHERE requester_id=$1 AND request_key=$2 FOR UPDATE",
    ).bind(user.user_id).bind(&input.idempotency_key).fetch_one(&mut *tx).await?;
    if row.get::<Uuid, _>("plant_id") != plant
        || row.get::<Option<Uuid>, _>("invoice_id") != invoice
        || row.get::<String, _>("kind") != kind
        || row.get::<Option<String>, _>("sku") != sku
        || row.get::<BigDecimal, _>("amount") != payable
    {
        return Err(AppError::Conflict("Idempotency key reused for different payment".into()));
    }
    let intent: Uuid = row.get("id");
    let gateway: String = row.get("gateway_order_id");
    let existing_session: Option<String> = row.get("session_id");
    let status: String = row.get("status");
    if status != "PENDING" {
        return Err(AppError::Conflict("Payment intent is no longer pending".into()));
    }
    if let Some(session) = existing_session {
        tx.commit().await?;
        return Ok(Json(json!({"status":"PAYMENT_PENDING","order_number":gateway,
            "payment_session_id":session,"cashfree_environment":"sandbox","payable":a})));
    }

    // Cashfree's idempotency key guarantees retrying this API request won't create a second charge.
    // Hold the row lock across this bounded request so parallel app taps cannot create distinct sessions.
    let response = http()?
        .post(format!("{SANDBOX_API}/orders"))
        .header("x-client-id", &credentials.0)
        .header("x-client-secret", &credentials.1)
        .header("x-api-version", "2025-01-01")
        .header("x-idempotency-key", intent.to_string())
        .json(&json!({
            "order_id": gateway,
            "order_amount": a,
            "order_currency": "INR",
            "customer_details": {
                "customer_id": user.user_id.to_string(),
                "customer_phone": user.phone
            },
            "order_meta": {
                "notify_url": "https://trackmyrmc.com/api/payments/cashfree/sandbox/webhook"
            }
        }))
        .send().await
        .map_err(|_| AppError::Conflict("Cashfree sandbox unavailable; retry with the same key".into()))?;
    if !response.status().is_success() {
        return Err(AppError::Conflict("Cashfree sandbox rejected checkout".into()));
    }
    let data: Value = response.json().await
        .map_err(|_| AppError::Conflict("Cashfree checkout response invalid".into()))?;
    if data["order_id"].as_str() != Some(gateway.as_str())
        || data["order_amount"].as_f64().is_none_or(|n| (n-a).abs()>0.0001)
        || data["order_currency"].as_str() != Some("INR")
    {
        return Err(AppError::Conflict("Gateway checkout metadata mismatch".into()));
    }
    let session = data["payment_session_id"].as_str()
        .filter(|s| !s.is_empty() && s.len() < 2048)
        .ok_or_else(|| AppError::Conflict("Cashfree did not return a payment session".into()))?;
    sqlx::query("UPDATE cashfree_sandbox_intents SET session_id=$2,updated_at=NOW() WHERE id=$1")
        .bind(intent).bind(session).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(json!({"status":"PAYMENT_PENDING","order_number":gateway,
        "payment_session_id":session,"cashfree_environment":"sandbox","payable":a})))
}

async fn reconcile_intent(state: &AppState, intent: Uuid, credentials: &(String,String)) -> Result<Value, AppError> {
    let row = sqlx::query(
        "SELECT gateway_order_id,amount,status FROM cashfree_sandbox_intents WHERE id=$1",
    ).bind(intent).fetch_optional(&state.db).await?
        .ok_or_else(|| AppError::NotFound("Payment intent not found".into()))?;
    let gateway: String = row.get("gateway_order_id");
    let a = amount(&row.get::<BigDecimal, _>("amount"))?;
    let provider = cashfree_order(&http()?, credentials, &gateway).await?;
    let state_value = provider_status(&provider, &gateway, a)?;
    let mut tx = state.db.begin().await?;
    let locked = sqlx::query("SELECT status FROM cashfree_sandbox_intents WHERE id=$1 FOR UPDATE")
        .bind(intent).fetch_one(&mut *tx).await?;
    let previous: String = locked.get("status");
    // Never reverse a verified payment because of a stale/duplicate out-of-order webhook.
    if previous == "PENDING" && state_value != "PENDING" {
        sqlx::query("UPDATE cashfree_sandbox_intents SET status=$2,verified_at=CASE WHEN $2='VERIFIED' THEN NOW() ELSE NULL END,updated_at=NOW() WHERE id=$1")
            .bind(intent).bind(state_value).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    // A verified sandbox receipt is deliberately NOT a live payment or an entitlement.
    // Pending fulfillment requires reviewed invoice-ledger / subscription policy and separate approval.
    Ok(json!({"order_number":gateway,"status":if previous=="PENDING" {state_value} else {previous.as_str()},
        "entitlement_activated":false,"ledger_posted":false}))
}

pub async fn order_status(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, AppError> {
    let credentials = enabled()?;
    let owner: Option<Uuid> = sqlx::query_scalar(
        "SELECT requester_id FROM cashfree_sandbox_intents WHERE id=$1",
    ).bind(id).fetch_optional(&state.db).await?;
    if owner != Some(user.user_id) {
        return Err(AppError::NotFound("Payment intent not found".into()));
    }
    Ok(Json(reconcile_intent(&state,id,&credentials).await?))
}

pub async fn webhook(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, AppError> {
    let (_, secret) = enabled()?;
    let timestamp = headers.get("x-webhook-timestamp").and_then(|v| v.to_str().ok()).unwrap_or("");
    let signature = headers.get("x-webhook-signature").and_then(|v| v.to_str().ok()).unwrap_or("");
    if !verify_signature(&secret,timestamp,signature,&body) {
        return Err(AppError::Unauthorized("Invalid Cashfree webhook signature".into()));
    }
    let event: Value = serde_json::from_slice(&body)
        .map_err(|_| AppError::BadRequest("Invalid webhook JSON".into()))?;
    let order_id = event.pointer("/data/order/order_id")
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::BadRequest("Missing webhook order id".into()))?;
    if !order_id.starts_with("trmc_") || order_id.len() > 100 {
        return Err(AppError::BadRequest("Invalid payment order id".into()));
    }
    let intent: Option<Uuid> = sqlx::query_scalar(
        "SELECT id FROM cashfree_sandbox_intents WHERE gateway_order_id=$1",
    ).bind(order_id).fetch_optional(&state.db).await?;
    let intent = intent.ok_or_else(|| AppError::NotFound("Unknown payment intent".into()))?;
    let credentials = enabled()?;
    let verified = reconcile_intent(&state,intent,&credentials).await?;
    let digest = hex::encode(Sha256::digest(&body));
    let event_kind = event["type"].as_str().unwrap_or("UNKNOWN");
    let kind = if event_kind.len() <= 60 { event_kind } else { "UNKNOWN" };
    sqlx::query(
        "INSERT INTO cashfree_sandbox_events(intent_id,event_digest,event_kind,provider_status) VALUES($1,$2,$3,$4) ON CONFLICT(event_digest) DO NOTHING",
    )
    .bind(intent).bind(digest).bind(kind)
    .bind(verified["status"].as_str().unwrap_or("PENDING"))
    .execute(&state.db).await?;
    Ok(Json(json!({"accepted":true,"fulfillment":"pending_business_approval"})))
}

#[derive(Deserialize)]
pub struct RefundProposal {
    pub refund_key: String,
}

pub async fn propose_refund(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Json(input): Json<RefundProposal>,
) -> Result<Json<Value>, AppError> {
    enabled()?;
    ensure_key(&input.refund_key)?;
    let row = sqlx::query(
        "SELECT requester_id,amount,status FROM cashfree_sandbox_intents WHERE id=$1",
    ).bind(id).fetch_optional(&state.db).await?
        .ok_or_else(|| AppError::NotFound("Payment not found".into()))?;
    if row.get::<Uuid, _>("requester_id") != user.user_id {
        return Err(AppError::NotFound("Payment not found".into()));
    }
    if row.get::<String, _>("status") != "VERIFIED" {
        return Err(AppError::Conflict("Refund requires a verified payment".into()));
    }
    sqlx::query(
        "INSERT INTO cashfree_sandbox_refunds(intent_id,refund_key,amount) VALUES($1,$2,$3) ON CONFLICT(refund_key) DO NOTHING",
    ).bind(id).bind(&input.refund_key).bind(row.get::<BigDecimal, _>("amount"))
      .execute(&state.db).await?;
    let persisted = sqlx::query(
        "SELECT intent_id,status FROM cashfree_sandbox_refunds WHERE refund_key=$1",
    ).bind(&input.refund_key).fetch_one(&state.db).await?;
    if persisted.get::<Uuid, _>("intent_id") != id {
        return Err(AppError::Conflict("Refund key reused for a different payment".into()));
    }
    // Refund proposals NEVER initiate actual Cashfree or bank transfers.
    Ok(Json(json!({"status":persisted.get::<String, _>("status"),
        "refund_executed":false,"approval_required":true})))
}

#[cfg(test)]
mod tests {
    use super::{ensure_key, provider_status, verify_signature, HmacSha256};
    use base64::{engine::general_purpose::STANDARD, Engine};
    use chrono::Utc;
    use hmac::Mac;
    use serde_json::json;

    #[test]
    fn webhook_signature_accepts_raw_body_only() {
        let time = Utc::now().timestamp().to_string();
        let body = br#"{"type":"PAYMENT_SUCCESS_WEBHOOK"}"#;
        let mut mac = HmacSha256::new_from_slice(b"sandbox_test_secret_123456").unwrap();
        mac.update(time.as_bytes());
        mac.update(body);
        let signature = STANDARD.encode(mac.finalize().into_bytes());
        assert!(verify_signature("sandbox_test_secret_123456",&time,&signature,body));
        assert!(!verify_signature("sandbox_test_secret_123456",&time,&signature,
            br#"{ "type": "PAYMENT_SUCCESS_WEBHOOK" }"#));
        assert!(!verify_signature("different_secret_123456789",&time,&signature,body));
        assert!(!verify_signature("sandbox_test_secret_123456", "1",&signature,body));
    }

    #[test]
    fn sandbox_order_identity_and_currency_enforced() {
        let valid = json!({"order_id":"trmc_123","order_amount":500.0,
            "order_currency":"INR","order_status":"PAID"});
        assert_eq!(provider_status(&valid,"trmc_123",500.0).unwrap(),"VERIFIED");
        assert!(provider_status(&valid,"trmc_fake",500.0).is_err());
        assert!(provider_status(&valid,"trmc_123",501.0).is_err());
        let mut wrong = valid.clone();
        wrong["order_currency"] = json!("USD");
        assert!(provider_status(&wrong,"trmc_123",500.0).is_err());
    }

    #[test]
    fn retry_key_checks() {
        assert!(ensure_key("random-key-123").is_ok());
        for key in ["bad", "bad:injection", "bad key", "bad\\nkey"] {
            assert!(ensure_key(key).is_err());
        }
    }
}
