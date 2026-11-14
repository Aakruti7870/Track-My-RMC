use crate::{
    auth::{middleware::check_role, AuthUser},
    error::AppError,
    routes::staff_module_permissions::{self, Action},
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

fn validated_payment_request_id(value: Option<&str>) -> Result<&str, AppError> {
    let Some(key) = value else {
        return Err(AppError::BadRequest(
            "Payment request_id is required to prevent duplicate charges".into(),
        ));
    };
    // The client reuses this opaque key on retries. An empty/invalid key must
    // never reach the nullable request_id column or its partial unique index.
    if !(8..=128).contains(&key.len())
        || !key
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-' | b'.' | b':'))
    {
        return Err(AppError::BadRequest("Invalid payment request_id".into()));
    }
    Ok(key)
}

/// Apply independently verified Cashfree order advances to the supplier's
/// final tax invoice, exactly once. This shares the parent order lock used
/// by manual invoice payments and must run in the invoice creation transaction.
pub(crate) async fn apply_verified_rmc_prepayments(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    order_id: Uuid,
    invoice_id: Uuid,
    invoice_total: &BigDecimal,
) -> Result<(), AppError> {
    let invoice_status: String =
        sqlx::query_scalar("SELECT status FROM plant_invoices WHERE id=$1 FOR UPDATE")
            .bind(invoice_id)
            .fetch_one(&mut **tx)
            .await?;
    let proofs = sqlx::query(
        "SELECT id,amount,plant_id,provider_payment_id,provider_verified_at \
         FROM cashfree_rmc_prepaid_intents WHERE order_id=$1 AND status='VERIFIED' \
         ORDER BY created_at,id FOR UPDATE",
    )
    .bind(order_id)
    .fetch_all(&mut **tx)
    .await?;
    if proofs.is_empty() {
        return Ok(());
    }
    if invoice_status == "CANCELLED" {
        return Err(AppError::Conflict(
            "Cancelled invoice cannot accept prepaid reconciliation".into(),
        ));
    }
    let invoice_plant: Uuid = sqlx::query_scalar("SELECT plant_id FROM plant_invoices WHERE id=$1")
        .bind(invoice_id)
        .fetch_one(&mut **tx)
        .await?;
    for proof in proofs {
        let proof_id: Uuid = proof.get("id");
        let value: BigDecimal = proof.get("amount");
        let provider: Option<String> = proof.get("provider_payment_id");
        let verified_at: Option<chrono::DateTime<chrono::Utc>> = proof.get("provider_verified_at");
        if value <= 0
            || proof.get::<Uuid, _>("plant_id") != invoice_plant
            || provider.as_deref().is_none_or(|s| s.is_empty())
            || verified_at.is_none()
        {
            return Err(AppError::Conflict(
                "Unverified provider evidence cannot be posted to the customer invoice".into(),
            ));
        }
        let key = format!("cashfree-rmc-prepaid-{}", proof_id.simple());
        let previous: Option<(BigDecimal, Option<String>)> = sqlx::query_as(
            "SELECT amount,transaction_ref FROM plant_payments WHERE invoice_id=$1 AND request_id=$2"
        ).bind(invoice_id).bind(&key).fetch_optional(&mut **tx).await?;
        if let Some((old_amount, old_ref)) = previous {
            if old_amount != value || old_ref != provider {
                return Err(AppError::Conflict(
                    "Provider prepayment posting conflicts with an existing ledger entry".into(),
                ));
            }
            continue;
        }
        let paid: BigDecimal = sqlx::query_scalar(
            "SELECT COALESCE(SUM(amount),0) FROM plant_payments WHERE invoice_id=$1",
        )
        .bind(invoice_id)
        .fetch_one(&mut **tx)
        .await?;
        let projected = &paid + &value;
        if &projected > invoice_total {
            return Err(AppError::Conflict(
                "Verified advance would exceed the invoice balance; reconcile manually".into(),
            ));
        }
        sqlx::query(
            "INSERT INTO plant_payments(invoice_id,order_id,plant_id,amount,payment_method,transaction_ref,request_id,notes,payment_date) \
             VALUES($1,$2,$3,$4,'cashfree',$5,$6,'Cashfree verified RMC customer advance',$7::date)"
        ).bind(invoice_id).bind(order_id).bind(invoice_plant).bind(&value)
          .bind(&provider).bind(&key).bind(verified_at).execute(&mut **tx).await?;
        sqlx::query(
            "INSERT INTO audit_logs(action,resource_type,resource_id,metadata) VALUES('invoice_prepaid_reconciled','invoice',$1,$2)"
        ).bind(invoice_id.to_string())
          .bind(json!({"order_id":order_id,"prepaid_intent_id":proof_id,"amount":value}))
          .execute(&mut **tx).await?;
    }
    let paid: BigDecimal = sqlx::query_scalar(
        "SELECT COALESCE(SUM(amount),0) FROM plant_payments WHERE invoice_id=$1",
    )
    .bind(invoice_id)
    .fetch_one(&mut **tx)
    .await?;
    let (invoice_state, order_payment_state) = if &paid == invoice_total {
        ("PAID", "paid")
    } else {
        ("PARTIALLY_PAID", "partially_paid")
    };
    sqlx::query("UPDATE plant_invoices SET status=$2 WHERE id=$1")
        .bind(invoice_id)
        .bind(invoice_state)
        .execute(&mut **tx)
        .await?;
    sqlx::query("UPDATE orders SET payment_status=$2,updated_at=NOW() WHERE id=$1")
        .bind(order_id)
        .bind(order_payment_state)
        .execute(&mut **tx)
        .await?;
    Ok(())
}

pub async fn create_invoice(
    state: &AppState,
    user: &AuthUser,
    order: Uuid,
) -> Result<Value, AppError> {
    check_role(user, &["owner", "plant_owner", "admin", "accountant"])?;
    super::super::routes::loads_routes::ensure_order_access(state, user, order, false).await?;
    staff_module_permissions::require_order(state, user, order, "billing_ledger", Action::Edit)
        .await?;
    let mut tx = state.db.begin().await?;
    crate::services::customer_order::require_order_kyc_for_invoice(&mut tx, order).await?;
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
    let total: BigDecimal = row.get("total_amount");
    if let Some((id, number)) = invoices.first() {
        apply_verified_rmc_prepayments(&mut tx, order, *id, &total).await?;
        tx.commit().await?;
        return Ok(json!({"success":true,"id":id,"invoice_id":id,"invoice_number":number}));
    }

    // An existing draft must not be bypassed by an older installed app client.
    let reviewed_draft: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM invoice_drafts WHERE order_id=$1)")
            .bind(order)
            .fetch_one(&mut *tx)
            .await?;
    if reviewed_draft {
        return Err(AppError::Conflict(
            "Open the standard invoice editor and review the draft before issuing".into(),
        ));
    }
    let tax: BigDecimal = row.get("tax_amount");
    if total <= 0 || tax < 0 || tax > total {
        return Err(AppError::Conflict(
            "Order pricing requires reconciliation before invoicing".into(),
        ));
    }
    let subtotal = &total - &tax;
    let plant: Uuid = row.get("plant_id");
    let customer: Uuid = row.get("customer_id");
    let number = format!("INV-{}", order.simple());
    let id:Uuid=sqlx::query_scalar("INSERT INTO plant_invoices (plant_id,order_id,customer_id,invoice_number,subtotal_amount,tax_amount,total_amount) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id")
  .bind(plant).bind(order).bind(customer).bind(&number).bind(subtotal).bind(tax).bind(&total).fetch_one(&mut *tx).await?;
    apply_verified_rmc_prepayments(&mut tx, order, id, &total).await?;
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
    let request_id = validated_payment_request_id(input.request_id.as_deref())?;
    if input
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
    staff_module_permissions::require(state, user, plant, "billing_ledger", Action::Edit).await?;
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
    let previous=sqlx::query("SELECT id,amount,payment_method,transaction_ref,notes FROM plant_payments WHERE invoice_id=$1 AND request_id=$2").bind(invoice).bind(request_id).fetch_optional(&mut *tx).await?;
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
  .bind(invoice).bind(order).bind(plant).bind(amount).bind(method).bind(input.transaction_ref).bind(input.notes).bind(request_id).fetch_one(&mut *tx).await?;
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

#[cfg(test)]
mod payment_request_id_tests {
    use super::validated_payment_request_id;

    #[test]
    fn mandatory_retry_key_rejects_null_empty_short_or_unsafe_values() {
        for key in [
            None,
            Some(""),
            Some(" "),
            Some("short"),
            Some("abcdefgh\nX"),
            Some("abcdefgh;DROP"),
            Some(" payment-request-1 "),
        ] {
            assert!(validated_payment_request_id(key).is_err(), "{key:?}");
        }
        assert!(validated_payment_request_id(Some(&"a".repeat(129))).is_err());
    }

    #[test]
    fn retry_key_accepts_existing_owner_ui_and_external_uuid_formats() {
        for key in [
            "1729548845123-abc123",
            "550e8400-e29b-41d4-a716-446655440000",
            "cashfree:order_001.payment-2026",
            "payment_retry_2026",
        ] {
            assert_eq!(validated_payment_request_id(Some(key)).unwrap(), key);
        }
        assert_eq!(
            validated_payment_request_id(Some(&"x".repeat(128)))
                .unwrap()
                .len(),
            128
        );
    }
}

#[cfg(test)]
mod rmc_prepaid_invoice_tests {
    use super::*;
    use sqlx::PgPool;

    #[sqlx::test]
    async fn verified_advance_posts_to_final_invoice_once(db: PgPool) {
        let owner: Uuid = sqlx::query_scalar(
            "INSERT INTO users(phone,hashed_password,full_name,role) VALUES($1,'unused','Supplier','owner') RETURNING id"
        ).bind(Uuid::new_v4().simple().to_string()[..18].to_string()).fetch_one(&db).await.unwrap();
        let customer: Uuid = sqlx::query_scalar(
            "INSERT INTO users(phone,hashed_password,full_name,role) VALUES($1,'unused','Customer','customer') RETURNING id"
        ).bind(Uuid::new_v4().simple().to_string()[..18].to_string()).fetch_one(&db).await.unwrap();
        let plant: Uuid = sqlx::query_scalar(
            "INSERT INTO rmc_plants(owner_id,name,code,latitude,longitude,address_line,city,state,pincode,contact_phone) \
             VALUES($1,'Pay Test','PAY',19,73,'Test','Test','Test','0','0') RETURNING id"
        ).bind(owner).fetch_one(&db).await.unwrap();
        let site: Uuid = sqlx::query_scalar(
            "INSERT INTO customer_sites(customer_id,name,address_line,city,state,pincode,contact_person,contact_phone) \
             VALUES($1,'Site','Address','Test','Test','0','Customer','0000000000') RETURNING id"
        ).bind(customer).fetch_one(&db).await.unwrap();
        let order: Uuid = sqlx::query_scalar(
            "INSERT INTO orders(order_number,customer_id,plant_id,site_id,concrete_grade,total_quantity_m3,delivery_date,delivery_time_slot,total_amount,status,preferred_payment_mode) \
             VALUES($1,$2,$3,$4,'M25',6,CURRENT_DATE,'10:00',1000,'delivered','PARTIAL_ADVANCE') RETURNING id"
        ).bind(format!("TEST-{}",Uuid::new_v4().simple())).bind(customer).bind(plant).bind(site)
         .fetch_one(&db).await.unwrap();
        let invoice: Uuid = sqlx::query_scalar(
            "INSERT INTO plant_invoices(plant_id,order_id,customer_id,invoice_number,subtotal_amount,tax_amount,total_amount) \
             VALUES($1,$2,$3,$4,900,100,1000) RETURNING id"
        ).bind(plant).bind(order).bind(customer)
         .bind(format!("INV-{}",order.simple())).fetch_one(&db).await.unwrap();
        sqlx::query(
            "INSERT INTO cashfree_rmc_prepaid_intents(order_id,offer_version,customer_id,plant_id,vendor_id,request_key,gateway_order_id,amount,payment_mode,status,provider_payment_id,provider_verified_at) \
             VALUES($1,1,$2,$3,'supplier_test','invoice-credit-1',$4,300,'PARTIAL_ADVANCE','VERIFIED','123456789',NOW())"
        ).bind(order).bind(customer).bind(plant)
         .bind(format!("trmc_rmc_{}",Uuid::new_v4().simple())).execute(&db).await.unwrap();

        for _ in 0..2 {
            let mut tx = db.begin().await.unwrap();
            sqlx::query("SELECT id FROM orders WHERE id=$1 FOR UPDATE")
                .bind(order)
                .fetch_one(&mut *tx)
                .await
                .unwrap();
            apply_verified_rmc_prepayments(&mut tx, order, invoice, &BigDecimal::from(1000))
                .await
                .unwrap();
            tx.commit().await.unwrap();
        }
        let ledger: (i64, BigDecimal) = sqlx::query_as(
            "SELECT COUNT(*),COALESCE(SUM(amount),0) FROM plant_payments WHERE invoice_id=$1",
        )
        .bind(invoice)
        .fetch_one(&db)
        .await
        .unwrap();
        assert_eq!(ledger.0, 1);
        assert_eq!(ledger.1, BigDecimal::from(300));
        let invoice_status: String =
            sqlx::query_scalar("SELECT status FROM plant_invoices WHERE id=$1")
                .bind(invoice)
                .fetch_one(&db)
                .await
                .unwrap();
        assert_eq!(invoice_status, "PARTIALLY_PAID");
        let order_status: String =
            sqlx::query_scalar("SELECT payment_status FROM orders WHERE id=$1")
                .bind(order)
                .fetch_one(&db)
                .await
                .unwrap();
        assert_eq!(order_status, "partially_paid");
    }
}
