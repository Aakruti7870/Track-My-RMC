use crate::{
    auth::{middleware::check_role, AuthUser},
    error::AppError,
    state::AppState,
};
use bigdecimal::BigDecimal;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::Row;
use uuid::Uuid;

#[derive(Debug, Deserialize, Serialize)]
pub struct PaymentInput {
    pub amount: f64,
    pub payment_method: Option<String>,
    pub transaction_ref: Option<String>,
    pub notes: Option<String>,
    pub request_id: Option<String>,
}

pub async fn create_invoice(
    state: &AppState,
    user: &AuthUser,
    order: Uuid,
) -> Result<Value, AppError> {
    check_role(user, &["owner", "plant_owner", "admin", "accountant"])?;
    super::super::routes::loads_routes::ensure_order_access(state, user, order, false).await?;
    let mut tx = state.db.begin().await?;
    let row=sqlx::query("SELECT plant_id,customer_id,status,total_amount,tax_amount FROM orders WHERE id=$1 FOR UPDATE").bind(order).fetch_one(&mut *tx).await?;
    let status: String = row.get("status");
    if !matches!(status.as_str(), "delivered" | "completed") {
        return Err(AppError::Conflict(
            "Invoice can be raised only after delivery".into(),
        ));
    }
    let invoices: Vec<(Uuid, String)> = sqlx::query_as(
        "SELECT id,invoice_number FROM plant_invoices WHERE order_id=$1 ORDER BY created_at",
    )
    .bind(order)
    .fetch_all(&mut *tx)
    .await?;
    if invoices.len() > 1 {
        return Err(AppError::Conflict(
            "Existing duplicate invoices require financial reconciliation".into(),
        ));
    }
    if let Some((id, number)) = invoices.first() {
        tx.commit().await?;
        return Ok(json!({"success":true,"id":id,"invoice_id":id,"invoice_number":number}));
    }
    let total: BigDecimal = row.get("total_amount");
    let tax: BigDecimal = row.get("tax_amount");
    if total <= BigDecimal::from(0) || tax < BigDecimal::from(0) || tax > total {
        return Err(AppError::Conflict(
            "Order pricing requires reconciliation before invoicing".into(),
        ));
    }
    let subtotal = &total - &tax;
    let plant: Uuid = row.get("plant_id");
    let customer: Uuid = row.get("customer_id");
    let number = format!("INV-{}", order.simple());
    let id:Uuid=sqlx::query_scalar("INSERT INTO plant_invoices (plant_id,order_id,customer_id,invoice_number,subtotal_amount,tax_amount,total_amount) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id")
  .bind(plant).bind(order).bind(customer).bind(&number).bind(subtotal).bind(tax).bind(total).fetch_one(&mut *tx).await?;
    sqlx::query("INSERT INTO audit_logs(user_id,action,resource_type,resource_id,metadata) VALUES($1,'invoice_created','invoice',$2,$3)").bind(user.user_id).bind(id.to_string()).bind(json!({"order_id":order})).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(json!({"success":true,"id":id,"invoice_id":id,"invoice_number":number}))
}

pub async fn payment(
    state: &AppState,
    user: &AuthUser,
    invoice: Uuid,
    input: PaymentInput,
) -> Result<Value, AppError> {
    check_role(user, &["owner", "plant_owner", "admin", "accountant"])?;
    if !input.amount.is_finite()
        || input.amount <= 0.0
        || input.amount > 9_999_999_999.99
        || (input.amount * 100.0 - (input.amount * 100.0).round()).abs() > 0.00001
    {
        return Err(AppError::BadRequest(
            "Payment must be a positive amount with at most two decimal places".into(),
        ));
    }
    if input
        .request_id
        .as_ref()
        .is_some_and(|s| s.len() < 8 || s.len() > 128)
        || input
            .transaction_ref
            .as_ref()
            .is_some_and(|s| s.len() > 160)
        || input.notes.as_ref().is_some_and(|s| s.len() > 4000)
    {
        return Err(AppError::BadRequest("Invalid payment reference".into()));
    }
    let method = input
        .payment_method
        .unwrap_or_else(|| "bank_transfer".into());
    if !["bank_transfer", "cash", "upi", "cheque", "card"].contains(&method.as_str()) {
        return Err(AppError::BadRequest("Unsupported payment method".into()));
    }
    let plant: Uuid = sqlx::query_scalar("SELECT plant_id FROM plant_invoices WHERE id=$1")
        .bind(invoice)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("Invoice not found".into()))?;
    crate::routes::business_routes::ensure_plant_staff_or_owner(state, user, plant).await?;
    let amount: BigDecimal = format!("{:.2}", input.amount)
        .parse()
        .map_err(|_| AppError::BadRequest("Invalid payment amount".into()))?;
    let mut tx = state.db.begin().await?;
    // Same lock order as invoice creation: order, then invoice. Serializes balance updates.
    let order: Option<Uuid> = sqlx::query_scalar("SELECT order_id FROM plant_invoices WHERE id=$1")
        .bind(invoice)
        .fetch_one(&mut *tx)
        .await?;
    if let Some(order) = order {
        sqlx::query("SELECT id FROM orders WHERE id=$1 FOR UPDATE")
            .bind(order)
            .fetch_one(&mut *tx)
            .await?;
    }
    let row = sqlx::query("SELECT total_amount,status FROM plant_invoices WHERE id=$1 FOR UPDATE")
        .bind(invoice)
        .fetch_one(&mut *tx)
        .await?;
    let total: BigDecimal = row.get("total_amount");
    let status: String = row.get("status");
    let previous=sqlx::query("SELECT id,amount,payment_method,transaction_ref,notes FROM plant_payments WHERE invoice_id=$1 AND request_id=$2").bind(invoice).bind(&input.request_id).fetch_optional(&mut *tx).await?;
    if let Some(p) = previous {
        if p.get::<BigDecimal, _>("amount") != amount
            || p.get::<String, _>("payment_method") != method
            || p.get::<Option<String>, _>("transaction_ref") != input.transaction_ref
            || p.get::<Option<String>, _>("notes") != input.notes
        {
            return Err(AppError::Conflict(
                "Payment retry changed its original payload".into(),
            ));
        }
        let id: Uuid = p.get("id");
        tx.commit().await?;
        return Ok(json!({"success":true,"payment_id":id,"status":status}));
    }
    if status == "CANCELLED" {
        return Err(AppError::Conflict(
            "Cancelled invoices cannot receive payment".into(),
        ));
    }
    let paid: BigDecimal = sqlx::query_scalar(
        "SELECT COALESCE(SUM(amount),0) FROM plant_payments WHERE invoice_id=$1",
    )
    .bind(invoice)
    .fetch_one(&mut *tx)
    .await?;
    let next = &paid + &amount;
    if next > total {
        return Err(AppError::Conflict(
            "Payment exceeds the outstanding balance".into(),
        ));
    }
    let id:Uuid=sqlx::query_scalar("INSERT INTO plant_payments(invoice_id,order_id,plant_id,amount,payment_method,transaction_ref,notes,request_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id")
  .bind(invoice).bind(order).bind(plant).bind(amount).bind(method).bind(input.transaction_ref).bind(input.notes).bind(input.request_id).fetch_one(&mut *tx).await?;
    let status = if next == total {
        "PAID"
    } else {
        "PARTIALLY_PAID"
    };
    sqlx::query("UPDATE plant_invoices SET status=$2 WHERE id=$1")
        .bind(invoice)
        .bind(status)
        .execute(&mut *tx)
        .await?;
    if let Some(order) = order {
        sqlx::query("UPDATE orders SET payment_status=$2,updated_at=NOW() WHERE id=$1")
            .bind(order)
            .bind(if status == "PAID" {
                "paid"
            } else {
                "partially_paid"
            })
            .execute(&mut *tx)
            .await?;
    }
    sqlx::query("INSERT INTO audit_logs(user_id,action,resource_type,resource_id,metadata) VALUES($1,'invoice_payment','invoice',$2,$3)").bind(user.user_id).bind(invoice.to_string()).bind(json!({"payment_id":id,"status":status})).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(json!({"success":true,"payment_id":id,"status":status}))
}
