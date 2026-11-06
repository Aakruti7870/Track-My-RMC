//! Cashfree RMC prepayment: sandbox-only and fail-closed in production.
//!
//! A customer pays ONLY after plant's offered terms have been accepted. The
//! supplier's Cashfree Easy Split vendor must have been independently verified.
//! Client callbacks NEVER mark money paid: Cashfree GET order and GET payments,
//! matching amount/currency/order ID and supplier split, are authoritative.
//! Live payments, refunds, vendor onboarding, subscriptions and pricing are out
//! of scope and must never be enabled by simply supplying a production key.
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

type HmacSha256 = Hmac<Sha256>;
const GATEWAY: &str = "https://sandbox.cashfree.com/pg";
const MAX_WEBHOOK: usize = 65_536;
const API_VERSION: &str = "2025-01-01";

fn configured() -> Result<(String, String), AppError> {
    if env::var("APP_ENV")
        .unwrap_or_else(|_| "production".into())
        .eq_ignore_ascii_case("production")
    {
        return Err(AppError::Conflict(
            "RMC prepaid sandbox is unavailable in production".into(),
        ));
    }
    if env::var("RMC_PREPAID_SANDBOX_ENABLED").ok().as_deref() != Some("true")
        || env::var("RMC_PREPAID_EASY_SPLIT_REVIEWED").ok().as_deref() != Some("true")
        || env::var("CASHFREE_SANDBOX_ENABLED").ok().as_deref() != Some("true")
        || env::var("CASHFREE_MODE").ok().as_deref() != Some("sandbox")
    {
        return Err(AppError::Conflict(
            "RMC prepaid settlement safety gate is disabled".into(),
        ));
    }
    let id = env::var("CASHFREE_SANDBOX_CLIENT_ID").unwrap_or_default();
    let secret = env::var("CASHFREE_SANDBOX_CLIENT_SECRET").unwrap_or_default();
    if id.trim().is_empty() || secret.len() < 16 {
        return Err(AppError::Conflict(
            "Cashfree sandbox account unavailable".into(),
        ));
    }
    Ok((id, secret))
}

fn api_client() -> Result<Client, AppError> {
    Client::builder()
        .timeout(Duration::from_secs(12))
        .build()
        .map_err(|_| AppError::InternalError("Unable to initialize secure payment client".into()))
}

fn validate_key(s: &str) -> Result<(), AppError> {
    if !(8..=100).contains(&s.len())
        || !s
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        return Err(AppError::BadRequest(
            "Invalid checkout idempotency key".into(),
        ));
    }
    Ok(())
}

fn amount(value: &BigDecimal) -> Result<f64, AppError> {
    let n: f64 = value
        .to_string()
        .parse()
        .map_err(|_| AppError::Conflict("Invalid amount".into()))?;
    if !n.is_finite()
        || !(1.0..=10_000_000.0).contains(&n)
        || (n * 100.0 - (n * 100.0).round()).abs() > 0.00001
    {
        return Err(AppError::Conflict("Unsupported payment amount".into()));
    }
    Ok(n)
}

fn verify_signature(secret: &str, timestamp: &str, signature: &str, body: &[u8]) -> bool {
    if body.is_empty() || body.len() > MAX_WEBHOOK || timestamp.len() > 16 {
        return false;
    }
    let Ok(time) = timestamp.parse::<i64>() else {
        return false;
    };
    let seconds = if timestamp.len() == 13 {
        time / 1000
    } else {
        time
    };
    if (Utc::now().timestamp() - seconds).abs() > 300 {
        return false;
    }
    let Ok(sig) = STANDARD.decode(signature) else {
        return false;
    };
    let Ok(mut mac) = HmacSha256::new_from_slice(secret.as_bytes()) else {
        return false;
    };
    mac.update(timestamp.as_bytes());
    mac.update(body);
    mac.verify_slice(&sig).is_ok()
}

// Require a provider response with a cashfree vendor split for the full
// supplier amount. The platform takes no commission in this phase.
fn check_order_identity(
    data: &Value,
    gateway_id: &str,
    payable: f64,
    vendor: &str,
) -> Result<(), AppError> {
    if data["order_id"].as_str() != Some(gateway_id)
        || data["order_currency"].as_str() != Some("INR")
        || data["order_amount"]
            .as_f64()
            .is_none_or(|x| (x - payable).abs() > 0.001)
    {
        return Err(AppError::Conflict(
            "Gateway order identity or amount mismatch".into(),
        ));
    }
    let splits = data["order_splits"]
        .as_array()
        .ok_or_else(|| AppError::Conflict("Supplier split evidence missing".into()))?;
    if splits.len() != 1
        || splits[0]["vendor_id"].as_str() != Some(vendor)
        || splits[0]["amount"]
            .as_f64()
            .is_none_or(|x| (x - payable).abs() > 0.001)
    {
        return Err(AppError::Conflict(
            "Verified vendor split is absent or mismatched".into(),
        ));
    }
    Ok(())
}

async fn fetch_cashfree(
    client: &Client,
    keys: &(String, String),
    gateway_id: &str,
    suffix: &str,
) -> Result<Value, AppError> {
    let response = client
        .get(format!("{GATEWAY}/orders/{gateway_id}{suffix}"))
        .header("x-client-id", &keys.0)
        .header("x-client-secret", &keys.1)
        .header("x-api-version", API_VERSION)
        .send()
        .await
        .map_err(|_| AppError::Conflict("Provider payment verification unavailable".into()))?;
    if !response.status().is_success() {
        return Err(AppError::Conflict(
            "Provider payment verification rejected".into(),
        ));
    }
    response
        .json::<Value>()
        .await
        .map_err(|_| AppError::Conflict("Invalid provider payment response".into()))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CheckoutRequest {
    pub idempotency_key: String,
    pub offer_version: i32,
}

/// Generates a sandbox checkout only after plant approval and customer assent.
pub async fn checkout(
    State(state): State<AppState>,
    user: AuthUser,
    Path(order_id): Path<Uuid>,
    Json(input): Json<CheckoutRequest>,
) -> Result<Json<Value>, AppError> {
    check_role(&user, &["customer"])?;
    let keys = configured()?;
    validate_key(&input.idempotency_key)?;
    let mut tx = state.db.begin().await?;
    // An order row lock serializes concurrent checkouts and changes to the
    // accepted commercial offer. Do not trust any client-provided amount.
    let row=sqlx::query(
        "SELECT o.customer_id,o.plant_id,o.status AS order_status,o.total_amount, \
            p.version,p.mode,p.total_amount AS offer_total_amount,p.advance_amount,p.status AS offer_status,p.expires_at, \
            v.cashfree_vendor_id \
         FROM orders o JOIN order_payment_offers p ON p.order_id=o.id \
         JOIN plant_cashfree_vendor_accounts v ON v.plant_id=o.plant_id \
         WHERE o.id=$1 AND v.status='ACTIVE' AND v.provider_environment='sandbox' \
         FOR UPDATE OF o,p"
    ).bind(order_id).fetch_optional(&mut *tx).await?
      .ok_or_else(||AppError::Conflict("Verified plant settlement setup is required".into()))?;
    if row.get::<Uuid, _>("customer_id") != user.user_id {
        return Err(AppError::Forbidden(
            "Order belongs to a different customer".into(),
        ));
    }
    let mode: String = row.get("mode");
    let total: BigDecimal = row.get("total_amount");
    let payable: BigDecimal = row.get("advance_amount");
    let offer_total: BigDecimal = row.get("offer_total_amount");
    let vendor: String = row.get("cashfree_vendor_id");
    if row.get::<i32, _>("version") != input.offer_version
        || row.get::<String, _>("order_status") != "pending"
        || row.get::<String, _>("offer_status") != "AWAITING_PAYMENT"
        || row.get::<chrono::DateTime<Utc>, _>("expires_at") <= Utc::now()
        || !super::order_payment::is_online(&mode)
        || (mode == super::order_payment::FULL_ADVANCE && payable != total)
        || offer_total != total
        || payable <= 0
        || payable > total
    {
        return Err(AppError::Conflict(
            "Accepted online payment terms are missing or expired".into(),
        ));
    }
    let payment_amount = amount(&payable)?;
    // Provider-side expiry must not exceed the terms approved by the customer.
    // Cashfree rejects checkout when the remaining validity is too short.
    let provider_expiry: chrono::DateTime<Utc> = row.get("expires_at");
    if let Some(old)=sqlx::query(
        "SELECT id,request_key,customer_id FROM cashfree_rmc_prepaid_intents WHERE order_id=$1 AND offer_version=$2"
    ).bind(order_id).bind(input.offer_version).fetch_optional(&mut *tx).await? {
        if old.get::<Uuid,_>("customer_id")!=user.user_id {
            return Err(AppError::Forbidden("Payment intent belongs to another customer".into()));
        }
        // Same order/version always resumes its existing gateway identity.
        // This also works after app restart when the local retry key was lost.
    } else {
        let id=Uuid::new_v4();
        let gateway=format!("trmc_rmc_{}",id.simple());
        sqlx::query(
            "INSERT INTO cashfree_rmc_prepaid_intents(id,order_id,offer_version,customer_id,plant_id,vendor_id,request_key,gateway_order_id,amount,payment_mode) \
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)"
        ).bind(id).bind(order_id).bind(input.offer_version).bind(user.user_id)
          .bind(row.get::<Uuid,_>("plant_id")).bind(&vendor).bind(&input.idempotency_key)
          .bind(&gateway).bind(&payable).bind(&mode).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    // Stable gateway identity survives retries after a provider timeout.
    let mut tx = state.db.begin().await?;
    let intent = sqlx::query(
        "SELECT id,gateway_order_id,payment_session_id,status,amount,vendor_id,offer_version \
         FROM cashfree_rmc_prepaid_intents WHERE order_id=$1 FOR UPDATE",
    )
    .bind(order_id)
    .fetch_one(&mut *tx)
    .await?;
    if intent.get::<String, _>("status") != "PENDING"
        || intent.get::<i32, _>("offer_version") != input.offer_version
        || intent.get::<BigDecimal, _>("amount") != payable
        || intent.get::<String, _>("vendor_id") != vendor
    {
        return Err(AppError::Conflict("Checkout is no longer valid".into()));
    }
    let gateway: String = intent.get("gateway_order_id");
    let vendor_active:bool=sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM plant_cashfree_vendor_accounts WHERE plant_id=$1 AND cashfree_vendor_id=$2 AND status='ACTIVE' AND provider_environment='sandbox')"
    ).bind(row.get::<Uuid,_>("plant_id")).bind(&vendor).fetch_one(&mut *tx).await?;
    if !vendor_active {
        return Err(AppError::Conflict(
            "Supplier settlement configuration changed before checkout".into(),
        ));
    }
    let offer_now = sqlx::query(
        "SELECT o.status AS order_status,p.status AS offer_status,p.version,p.expires_at \
         FROM orders o JOIN order_payment_offers p ON p.order_id=o.id \
         WHERE o.id=$1 FOR UPDATE OF o,p",
    )
    .bind(order_id)
    .fetch_one(&mut *tx)
    .await?;
    if offer_now.get::<String, _>("order_status") != "pending"
        || offer_now.get::<String, _>("offer_status") != "AWAITING_PAYMENT"
        || offer_now.get::<i32, _>("version") != input.offer_version
        || offer_now.get::<chrono::DateTime<Utc>, _>("expires_at") <= Utc::now()
    {
        return Err(AppError::Conflict(
            "Order approval expired or was cancelled before checkout".into(),
        ));
    }
    if let Some(session) = intent.get::<Option<String>, _>("payment_session_id") {
        tx.commit().await?;
        return Ok(Json(
            json!({"status":"PAYMENT_PENDING","payment_session_id":session,"gateway_order_id":gateway,"cashfree_environment":"sandbox","amount":payment_amount}),
        ));
    }
    let response=api_client()?.post(format!("{GATEWAY}/orders"))
        .header("x-client-id",&keys.0).header("x-client-secret",&keys.1)
        .header("x-api-version",API_VERSION)
        .header("x-idempotency-key",intent.get::<Uuid,_>("id").to_string())
        .json(&json!({
            "order_id":gateway,"order_amount":payment_amount,"order_currency":"INR",
            "order_expiry_time":provider_expiry.to_rfc3339(),
            "order_splits":[{"vendor_id":vendor,"amount":payment_amount}],
            "customer_details":{"customer_id":user.user_id.to_string(),"customer_phone":user.phone},
            "order_meta":{"notify_url":"https://trackmyrmc.com/api/payments/cashfree/rmc-prepaid/webhook"}
        }))
        .send().await.map_err(|_|AppError::Conflict("Cashfree sandbox unavailable; retry the same checkout".into()))?;
    if !response.status().is_success() {
        return Err(AppError::Conflict(
            "Provider rejected checkout or vendor split; no payment should be made".into(),
        ));
    }
    let created: Value = response
        .json()
        .await
        .map_err(|_| AppError::Conflict("Invalid Cashfree checkout response".into()))?;
    check_order_identity(&created, &gateway, payment_amount, &vendor)?;
    let session = created["payment_session_id"]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::Conflict("Gateway checkout session missing".into()))?;
    sqlx::query("UPDATE cashfree_rmc_prepaid_intents SET payment_session_id=$2,updated_at=NOW() WHERE id=$1")
        .bind(intent.get::<Uuid,_>("id")).bind(session).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(
        json!({"status":"PAYMENT_PENDING","payment_session_id":session,"gateway_order_id":gateway,"cashfree_environment":"sandbox","amount":payment_amount}),
    ))
}

async fn reconcile(
    state: &AppState,
    intent_id: Uuid,
    keys: &(String, String),
) -> Result<Value, AppError> {
    let initial = sqlx::query(
        "SELECT gateway_order_id,amount,vendor_id FROM cashfree_rmc_prepaid_intents WHERE id=$1",
    )
    .bind(intent_id)
    .fetch_one(&state.db)
    .await?;
    let gateway: String = initial.get("gateway_order_id");
    let vendor: String = initial.get("vendor_id");
    let amt: BigDecimal = initial.get("amount");
    let payable = amount(&amt)?;
    let http = api_client()?;
    let provider = fetch_cashfree(&http, keys, &gateway, "").await?;
    check_order_identity(&provider, &gateway, payable, &vendor)?;
    let paid = provider["order_status"].as_str() == Some("PAID");
    let provider_payment = if paid {
        let payments = fetch_cashfree(&http, keys, &gateway, "/payments").await?;
        payments
            .as_array()
            .and_then(|items| {
                items.iter().find(|p| {
                    p["payment_status"].as_str() == Some("SUCCESS")
                        && p["payment_amount"]
                            .as_f64()
                            .is_some_and(|a| (a - payable).abs() < 0.001)
                        && p["payment_currency"].as_str().is_none_or(|s| s == "INR")
                })
            })
            .and_then(|p| p["cf_payment_id"].as_i64().map(|id| id.to_string()))
            .ok_or_else(|| {
                AppError::Conflict(
                    "Cashfree PAID status lacks a matching successful payment".into(),
                )
            })?
    } else {
        String::new()
    };
    let mut tx = state.db.begin().await?;
    let row=sqlx::query(
        "SELECT i.order_id,i.plant_id,i.offer_version,i.payment_mode,i.status,i.amount,i.vendor_id, \
                o.status AS order_status,o.total_amount, \
                p.version AS current_offer_version,p.status AS offer_status,p.expires_at \
         FROM cashfree_rmc_prepaid_intents i JOIN orders o ON o.id=i.order_id \
         JOIN order_payment_offers p ON p.order_id=i.order_id \
         WHERE i.id=$1 FOR UPDATE OF i,o,p"
    ).bind(intent_id).fetch_one(&mut *tx).await?;
    let status: String = row.get("status");
    if status == "VERIFIED" {
        tx.commit().await?;
        return Ok(json!({"status":"VERIFIED","order_id":row.get::<Uuid,_>("order_id")}));
    }
    if !paid {
        tx.commit().await?;
        return Ok(json!({"status":"PAYMENT_PENDING"}));
    }
    let order_id: Uuid = row.get("order_id");
    let vendor_active:bool=sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM plant_cashfree_vendor_accounts WHERE plant_id=$1 AND cashfree_vendor_id=$2 AND status='ACTIVE' AND provider_environment='sandbox')"
    ).bind(row.get::<Uuid,_>("plant_id")).bind(&vendor).fetch_one(&mut *tx).await?;
    let eligible = status == "PENDING"
        && vendor_active
        && row.get::<String, _>("order_status") == "pending"
        && row.get::<String, _>("offer_status") == "AWAITING_PAYMENT"
        && row.get::<i32, _>("offer_version") == row.get::<i32, _>("current_offer_version")
        && row.get::<chrono::DateTime<Utc>, _>("expires_at") > Utc::now()
        && row.get::<BigDecimal, _>("amount") == amt
        && row.get::<String, _>("vendor_id") == vendor;
    if !eligible {
        sqlx::query("UPDATE cashfree_rmc_prepaid_intents SET status='HOLD_REFUND_REVIEW',provider_payment_id=$2,provider_verified_at=NOW(),updated_at=NOW() WHERE id=$1")
            .bind(intent_id).bind(&provider_payment).execute(&mut *tx).await?;
        sqlx::query("INSERT INTO audit_logs(action,resource_type,resource_id,metadata) VALUES('order.prepaid_late_success','order',$1,$2)")
            .bind(order_id.to_string()).bind(json!({"gateway_order_id":gateway,"manual_refund_review":true})).execute(&mut *tx).await?;
        tx.commit().await?;
        return Ok(
            json!({"status":"HOLD_REFUND_REVIEW","message":"Payment requires refund/reconciliation review; production remains blocked"}),
        );
    }
    let mode: String = row.get("payment_mode");
    sqlx::query("UPDATE cashfree_rmc_prepaid_intents SET status='VERIFIED',provider_payment_id=$2,provider_verified_at=NOW(),updated_at=NOW() WHERE id=$1")
        .bind(intent_id).bind(&provider_payment).execute(&mut *tx).await?;
    sqlx::query("UPDATE order_payment_offers SET status='READY_FOR_PRODUCTION',updated_at=NOW() WHERE order_id=$1 AND status='AWAITING_PAYMENT'")
        .bind(order_id).execute(&mut *tx).await?;
    sqlx::query("UPDATE orders SET status='confirmed',payment_status=$2,updated_at=NOW() WHERE id=$1 AND status='pending'")
        .bind(order_id).bind(if mode==super::order_payment::FULL_ADVANCE {"paid"} else {"partial"}).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO audit_logs(action,resource_type,resource_id,metadata) VALUES('order.prepaid_provider_verified','order',$1,$2)")
        .bind(order_id.to_string()).bind(json!({"gateway_order_id":gateway,"amount":amt,"provider_payment_id":provider_payment,"mode":mode,"vendor_id":vendor})).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(json!({"status":"VERIFIED","order_id":order_id,"payment_mode":mode}))
}

/// Customer may recheck after SDK success/cancel; this never trusts an SDK callback.
pub async fn status(
    State(state): State<AppState>,
    user: AuthUser,
    Path(order_id): Path<Uuid>,
) -> Result<Json<Value>, AppError> {
    check_role(&user, &["customer"])?;
    let keys = configured()?;
    let row = sqlx::query(
        "SELECT i.id,i.status FROM cashfree_rmc_prepaid_intents i \
         JOIN orders o ON o.id=i.order_id WHERE i.order_id=$1 AND o.customer_id=$2",
    )
    .bind(order_id)
    .bind(user.user_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Customer prepaid checkout not found".into()))?;
    let result = if row.get::<String, _>("status") == "PENDING" {
        reconcile(&state, row.get("id"), &keys).await?
    } else {
        json!({"status":row.get::<String,_>("status")})
    };
    Ok(Json(result))
}

pub async fn webhook(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, AppError> {
    let keys = configured()?;
    let timestamp = headers
        .get("x-webhook-timestamp")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let sig = headers
        .get("x-webhook-signature")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if !verify_signature(&keys.1, timestamp, sig, &body) {
        return Err(AppError::Unauthorized(
            "Invalid Cashfree webhook signature".into(),
        ));
    }
    let event: Value = serde_json::from_slice(&body)
        .map_err(|_| AppError::BadRequest("Invalid webhook JSON".into()))?;
    let gateway = event
        .pointer("/data/order/order_id")
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::BadRequest("Webhook order ID missing".into()))?;
    if !gateway.starts_with("trmc_rmc_") || gateway.len() > 100 {
        return Err(AppError::BadRequest("Invalid gateway order ID".into()));
    }
    let id: Uuid =
        sqlx::query_scalar("SELECT id FROM cashfree_rmc_prepaid_intents WHERE gateway_order_id=$1")
            .bind(gateway)
            .fetch_optional(&state.db)
            .await?
            .ok_or_else(|| AppError::NotFound("Unknown RMC checkout".into()))?;
    let result = reconcile(&state, id, &keys).await?;
    let digest = hex::encode(Sha256::digest(&body));
    let kind = event["type"].as_str().unwrap_or("UNKNOWN");
    let kind = if kind.len() > 60 { "UNKNOWN" } else { kind };
    sqlx::query(
        "INSERT INTO cashfree_rmc_prepaid_webhook_events(intent_id,event_digest,event_kind,provider_status) VALUES($1,$2,$3,$4) ON CONFLICT(event_digest) DO NOTHING"
    ).bind(id).bind(digest).bind(kind).bind(result["status"].as_str().unwrap_or("PAYMENT_PENDING"))
        .execute(&state.db).await?;
    Ok(Json(
        json!({"accepted":true,"provider_status":result["status"]}),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn never_trust_incomplete_or_wrong_vendor_split() {
        let good = json!({"order_id":"trmc_rmc_good","order_currency":"INR","order_amount":100.0,"order_splits":[{"vendor_id":"plant_1","amount":100.0}]});
        assert!(check_order_identity(&good, "trmc_rmc_good", 100.0, "plant_1").is_ok());
        let mut corrupt = good.clone();
        corrupt["order_splits"] = json!([]);
        assert!(check_order_identity(&corrupt, "trmc_rmc_good", 100.0, "plant_1").is_err());
        corrupt = good.clone();
        corrupt["order_splits"][0]["vendor_id"] = json!("other_plant");
        assert!(check_order_identity(&corrupt, "trmc_rmc_good", 100.0, "plant_1").is_err());
        corrupt = good.clone();
        corrupt["order_amount"] = json!(101.0);
        assert!(check_order_identity(&corrupt, "trmc_rmc_good", 100.0, "plant_1").is_err());
    }
    #[test]
    fn signed_raw_webhook_rejects_tampering_and_expired_timestamp() {
        let key = "sandbox-signature-only";
        let timestamp = Utc::now().timestamp().to_string();
        let body = br#"{"data":{"order":{"order_id":"trmc_rmc_test"}}}"#;
        let mut mac = HmacSha256::new_from_slice(key.as_bytes()).unwrap();
        mac.update(timestamp.as_bytes());
        mac.update(body);
        let signature = STANDARD.encode(mac.finalize().into_bytes());
        assert!(verify_signature(key, &timestamp, &signature, body));
        assert!(!verify_signature(key, &timestamp, &signature, b"changed"));
        assert!(!verify_signature(
            "wrong-secret",
            &timestamp,
            &signature,
            body
        ));
        let old = (Utc::now().timestamp() - 1000).to_string();
        assert!(!verify_signature(key, &old, &signature, body));
    }
    #[test]
    fn only_bounded_ascii_retry_keys() {
        assert!(validate_key("RMC-order_123456").is_ok());
        assert!(validate_key("short").is_err());
        assert!(validate_key("insecure:key").is_err());
        assert!(validate_key(" 12345678 ").is_err());
    }
}
