//! Atomic, idempotent financial posting for provider-verified SANDBOX receipts.
//! This module never calls Cashfree and cannot be invoked from an unauthenticated
//! request. The caller must independently verify provider order/amount/currency.
//! Only enabled from the sandbox adapter, which hard-rejects APP_ENV=production.
use crate::{error::AppError, state::AppState};
use bigdecimal::BigDecimal;
use serde_json::{json, Value};
use sqlx::Row;
use uuid::Uuid;

pub async fn fulfill_verified(state: &AppState, intent_id: Uuid) -> Result<Value, AppError> {
    let mut tx = state.db.begin().await?;
    let row = sqlx::query(
        "SELECT requester_id,plant_id,invoice_id,kind,sku,duration_days,gateway_order_id,amount,status,fulfilled_at
         FROM cashfree_sandbox_intents WHERE id=$1 FOR UPDATE",
    )
    .bind(intent_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound("Payment intent not found".into()))?;
    let status: String = row.get("status");
    if status != "VERIFIED" {
        return Err(AppError::Conflict("Payment was not provider-verified".into()));
    }
    if row.get::<Option<chrono::DateTime<chrono::Utc>>, _>("fulfilled_at").is_some() {
        return Ok(json!({"status":"VERIFIED","fulfilled":true,"idempotent":true}));
    }
    let requester: Uuid = row.get("requester_id");
    let plant: Uuid = row.get("plant_id");
    let gateway: String = row.get("gateway_order_id");
    let expected: BigDecimal = row.get("amount");
    let kind: String = row.get("kind");
    if kind == "INVOICE" {
        let invoice: Uuid = row.get::<Option<Uuid>, _>("invoice_id")
            .ok_or_else(|| AppError::Conflict("Missing invoice target".into()))?;
        // Shared lock order with manual ledger posting: order, invoice, payments.
        let invoice_target = sqlx::query(
            "SELECT order_id FROM plant_invoices WHERE id=$1 AND plant_id=$2 AND customer_id=$3",
        )
        .bind(invoice)
        .bind(plant)
        .bind(requester)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| AppError::Conflict("Invoice or payer mismatch".into()))?;
        let order: Option<Uuid> = invoice_target.get("order_id");
        if let Some(id) = order {
            sqlx::query("SELECT id FROM orders WHERE id=$1 FOR UPDATE")
                .bind(id)
                .fetch_one(&mut *tx)
                .await?;
        }
        let invoice_row = sqlx::query(
            "SELECT total_amount,status FROM plant_invoices WHERE id=$1 AND plant_id=$2 AND customer_id=$3 FOR UPDATE",
        )
        .bind(invoice)
        .bind(plant)
        .bind(requester)
        .fetch_one(&mut *tx)
        .await?;
        let invoice_status: String = invoice_row.get("status");
        if invoice_status == "CANCELLED" {
            return Err(AppError::Conflict("Invoice cancelled; payment requires manual review".into()));
        }
        let total: BigDecimal = invoice_row.get("total_amount");
        let paid: BigDecimal = sqlx::query_scalar(
            "SELECT COALESCE(SUM(amount),0) FROM plant_payments WHERE invoice_id=$1",
        )
        .bind(invoice)
        .fetch_one(&mut *tx)
        .await?;
        let next = &paid + &expected;
        if next > total || expected <= BigDecimal::from(0) {
            // Provider confirms a receipt but a concurrent manual payment consumed
            // the balance. Never over-credit; preserve VERIFIED unfulfilled for review.
            return Err(AppError::Conflict("Verified receipt exceeds invoice outstanding balance; review required".into()));
        }
        let request_id = format!("cashfree_sandbox_{}", intent_id.simple());
        let payment_id: Uuid = sqlx::query_scalar(
            "INSERT INTO plant_payments(invoice_id,order_id,plant_id,amount,payment_method,transaction_ref,notes,request_id)
             VALUES($1,$2,$3,$4,'cashfree',$5,'SANDBOX receipt; not real funds',$6) RETURNING id",
        )
        .bind(invoice)
        .bind(order)
        .bind(plant)
        .bind(&expected)
        .bind(&gateway)
        .bind(&request_id)
        .fetch_one(&mut *tx)
        .await?;
        let new_status = if next == total { "PAID" } else { "PARTIALLY_PAID" };
        sqlx::query("UPDATE plant_invoices SET status=$2 WHERE id=$1")
            .bind(invoice)
            .bind(new_status)
            .execute(&mut *tx)
            .await?;
        if let Some(order_id) = order {
            let order_status = if next == total { "paid" } else { "partially_paid" };
            sqlx::query("UPDATE orders SET payment_status=$2,updated_at=NOW() WHERE id=$1")
                .bind(order_id)
                .bind(order_status)
                .execute(&mut *tx)
                .await?;
        }
        sqlx::query(
            "INSERT INTO audit_logs(user_id,action,resource_type,resource_id,metadata)
             VALUES($1,'cashfree.sandbox.invoice.fulfilled','invoice',$2,$3)",
        )
        .bind(requester)
        .bind(invoice.to_string())
        .bind(json!({"intent_id":intent_id,"payment_id":payment_id,"gateway_order_id":gateway,"sandbox":true}))
        .execute(&mut *tx)
        .await?;
    } else if kind == "PLAN" {
        // Serializes overlapping plan purchases for the same physical plant.
        sqlx::query("SELECT id FROM rmc_plants WHERE id=$1 AND owner_id=$2 AND is_active=TRUE FOR UPDATE")
            .bind(plant)
            .bind(requester)
            .fetch_one(&mut *tx)
            .await?;
        let sku: String = row.get::<Option<String>, _>("sku")
            .ok_or_else(|| AppError::Conflict("Missing approved plan SKU".into()))?;
        let duration: i32 = row.get::<Option<i32>, _>("duration_days")
            .ok_or_else(|| AppError::Conflict("Missing approved duration".into()))?;
        let approved: Option<(BigDecimal, i32)> = sqlx::query_as(
            "SELECT price_inr,duration_days FROM cashfree_approved_plan_prices WHERE sku=$1 AND is_active=TRUE",
        )
        .bind(&sku)
        .fetch_optional(&mut *tx)
        .await?;
        if approved.as_ref() != Some(&(expected.clone(), duration)) || duration <= 0 {
            return Err(AppError::Conflict("Approved price or duration changed; review required".into()));
        }
        let plan_id: Uuid = sqlx::query_scalar(
            "SELECT id FROM plant_subscription_plans WHERE plan_code=$1 AND is_active=TRUE",
        )
        .bind(&sku)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| AppError::Conflict("Approved plan does not map to a subscription".into()))?;
        sqlx::query(
            "INSERT INTO plant_plan_payments(plant_id,order_number,amount,gateway_order_id,payment_status,paid_at)
             VALUES($1,$2,$3,$2,'PAID',NOW())",
        )
        .bind(plant)
        .bind(&gateway)
        .bind(&expected)
        .execute(&mut *tx)
        .await?;
        let end: chrono::DateTime<chrono::Utc> = sqlx::query_scalar(
            "SELECT GREATEST(NOW(),COALESCE(MAX(current_period_end),NOW())) + ($2 * INTERVAL '1 day')
             FROM plant_plan_subscriptions WHERE plant_id=$1 AND plan_id=$3 AND status='ACTIVE'",
        )
        .bind(plant)
        .bind(duration)
        .bind(plan_id)
        .fetch_one(&mut *tx)
        .await?;
        sqlx::query(
            "INSERT INTO plant_plan_subscriptions(plant_id,plan_id,status,current_period_start,current_period_end)
             VALUES($1,$2,'ACTIVE',NOW(),$3)",
        )
        .bind(plant)
        .bind(plan_id)
        .bind(end)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "INSERT INTO audit_logs(user_id,action,resource_type,resource_id,metadata)
             VALUES($1,'cashfree.sandbox.plan.fulfilled','plant',$2,$3)",
        )
        .bind(requester)
        .bind(plant.to_string())
        .bind(json!({"intent_id":intent_id,"sku":sku,"duration_days":duration,"gateway_order_id":gateway,"sandbox":true}))
        .execute(&mut *tx)
        .await?;
    } else {
        return Err(AppError::Conflict("Unsupported payment kind".into()));
    }
    sqlx::query(
        "UPDATE cashfree_sandbox_intents SET fulfilled_at=NOW(),updated_at=NOW() WHERE id=$1 AND fulfilled_at IS NULL",
    )
    .bind(intent_id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(json!({"status":"VERIFIED","fulfilled":true,"idempotent":false,"sandbox":true}))
}
