//! Payment preference and plant-approved terms for customer RMC orders.
//! No money is collected here. Online orders remain pending until an independently
//! verified provider-payment fulfillment flow is approved and integrated.
use crate::{
    auth::{middleware::check_role, AuthUser},
    error::AppError,
    state::AppState,
};
use axum::{
    extract::{Path, State},
    Json,
};
use bigdecimal::BigDecimal;
use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::Row;
use uuid::Uuid;

pub const FULL_ADVANCE: &str = "FULL_ADVANCE";
pub const PARTIAL_ADVANCE: &str = "PARTIAL_ADVANCE";
pub const ON_DELIVERY: &str = "ON_DELIVERY";
pub const APPROVED_CREDIT: &str = "APPROVED_CREDIT";

pub fn valid_mode(mode: &str) -> bool {
    matches!(
        mode,
        FULL_ADVANCE | PARTIAL_ADVANCE | ON_DELIVERY | APPROVED_CREDIT
    )
}

pub fn is_online(mode: &str) -> bool {
    matches!(mode, FULL_ADVANCE | PARTIAL_ADVANCE)
}

/// Advance is always calculated in exact INR decimal, never from user-provided total.
pub fn approved_advance(
    mode: &str,
    total: &BigDecimal,
    partial_paise: Option<i64>,
) -> Result<BigDecimal, AppError> {
    if total <= &BigDecimal::from(0) || !valid_mode(mode) {
        return Err(AppError::Conflict("Invalid commercial terms".into()));
    }
    match mode {
        FULL_ADVANCE => {
            if partial_paise.is_some() {
                return Err(AppError::BadRequest(
                    "Full payment cannot specify a separate advance".into(),
                ));
            }
            Ok(total.clone())
        }
        PARTIAL_ADVANCE => {
            let paise = partial_paise.ok_or_else(|| {
                AppError::BadRequest("Plant must explicitly approve the advance amount".into())
            })?;
            if paise <= 0 {
                return Err(AppError::BadRequest("Advance must be positive".into()));
            }
            let advance = BigDecimal::from(paise) / BigDecimal::from(100);
            if &advance >= total {
                return Err(AppError::BadRequest(
                    "Partial advance must be below the order total".into(),
                ));
            }
            Ok(advance)
        }
        ON_DELIVERY | APPROVED_CREDIT => {
            if partial_paise.is_some() {
                return Err(AppError::BadRequest(
                    "Deferred payment cannot request an advance".into(),
                ));
            }
            Ok(BigDecimal::from(0))
        }
        _ => Err(AppError::BadRequest("Unsupported payment mode".into())),
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OfferInput {
    /// Exact rupee-paise requested by the plant for PARTIAL_ADVANCE only.
    pub advance_paise: Option<i64>,
}

/// Owner confirms the submitted order amount and either accepts the preferred
/// mode or rejects the order using the existing reject endpoint.
pub async fn offer(
    State(state): State<AppState>,
    actor: AuthUser,
    Path(order_id): Path<Uuid>,
    Json(input): Json<OfferInput>,
) -> Result<Json<Value>, AppError> {
    check_role(&actor, &["owner", "plant_owner", "admin"])?;
    super::loads_routes::ensure_order_access(&state, &actor, order_id, false).await?;
    let mut tx = state.db.begin().await?;
    let order = sqlx::query(
        "SELECT status,preferred_payment_mode,total_amount FROM orders WHERE id=$1 FOR UPDATE",
    )
    .bind(order_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound("Order not found".into()))?;
    if order.get::<String, _>("status") != "pending" {
        return Err(AppError::Conflict(
            "Only pending orders can receive payment terms".into(),
        ));
    }
    let mode: String = order
        .get::<Option<String>, _>("preferred_payment_mode")
        .ok_or_else(|| {
            AppError::Conflict("Legacy orders must use the existing approval flow".into())
        })?;
    let total: BigDecimal = order.get("total_amount");
    let advance = approved_advance(&mode, &total, input.advance_paise)?;

    if let Some(old) = sqlx::query(
        "SELECT mode,advance_amount,status,expires_at,version FROM order_payment_offers WHERE order_id=$1 FOR UPDATE"
    ).bind(order_id).fetch_optional(&mut *tx).await? {
        let old_status: String = old.get("status");
        if old_status != "OFFERED" {
            return Err(AppError::Conflict("Payment terms have already been acted upon".into()));
        }
        if old.get::<String, _>("mode") == mode
            && old.get::<BigDecimal, _>("advance_amount") == advance
            && old.get::<DateTime<Utc>, _>("expires_at") > Utc::now()
        {
            tx.commit().await?;
            return Ok(Json(json!({"success":true,"status":"OFFERED","version":old.get::<i32,_>("version"),"reused":true})));
        }
    }
    let version: i32 = sqlx::query_scalar(
        "INSERT INTO order_payment_offers(order_id,mode,total_amount,advance_amount,status,expires_at,created_by) \
         VALUES($1,$2,$3,$4,'OFFERED',NOW() + INTERVAL '24 hours',$5) \
         ON CONFLICT(order_id) DO UPDATE SET mode=EXCLUDED.mode,total_amount=EXCLUDED.total_amount, \
         advance_amount=EXCLUDED.advance_amount,status='OFFERED',expires_at=EXCLUDED.expires_at, \
         created_by=EXCLUDED.created_by,updated_at=NOW(),version=order_payment_offers.version+1 \
         RETURNING version"
    ).bind(order_id).bind(&mode).bind(&total).bind(&advance)
      .bind(actor.user_id).fetch_one(&mut *tx).await?;
    sqlx::query("INSERT INTO audit_logs(user_id,action,resource_type,resource_id,metadata) VALUES($1,'order.payment_offer','order',$2,$3)")
        .bind(actor.user_id).bind(order_id.to_string())
        .bind(json!({"mode":mode,"advance_amount":advance,"total_amount":total,"version":version}))
        .execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(
        json!({"success":true,"status":"OFFERED","version":version,
        "payment_required_now":false,"message":"Plant terms sent for customer approval"}),
    ))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AcceptInput {
    pub version: i32,
}

/// Customer explicitly accepts immutable offered terms. This does NOT initiate
/// any payment or claim a gateway transaction succeeded.
pub async fn accept(
    State(state): State<AppState>,
    actor: AuthUser,
    Path(order_id): Path<Uuid>,
    Json(input): Json<AcceptInput>,
) -> Result<Json<Value>, AppError> {
    check_role(&actor, &["customer"])?;
    let mut tx = state.db.begin().await?;
    let row = sqlx::query(
        "SELECT o.customer_id,o.status AS order_status,o.total_amount,p.mode,p.advance_amount, \
                p.status AS offer_status,p.expires_at,p.version \
         FROM orders o JOIN order_payment_offers p ON p.order_id=o.id \
         WHERE o.id=$1 FOR UPDATE OF o,p",
    )
    .bind(order_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound("Payment offer not found".into()))?;
    if row.get::<Uuid, _>("customer_id") != actor.user_id {
        return Err(AppError::Forbidden(
            "Order belongs to another customer".into(),
        ));
    }
    if row.get::<i32, _>("version") != input.version {
        return Err(AppError::Conflict(
            "Payment terms changed; review the latest offer".into(),
        ));
    }
    let mode: String = row.get("mode");
    let offer_status: String = row.get("offer_status");
    let order_status: String = row.get("order_status");
    if (offer_status == "AWAITING_PAYMENT" && order_status == "pending")
        || (offer_status == "READY_FOR_PRODUCTION" && order_status == "confirmed")
    {
        tx.commit().await?;
        return Ok(Json(
            json!({"success":true,"status":offer_status,"idempotent":true}),
        ));
    }
    if row.get::<String, _>("order_status") != "pending" || offer_status != "OFFERED" {
        return Err(AppError::Conflict(
            "Order is no longer awaiting customer acceptance".into(),
        ));
    }
    if row.get::<DateTime<Utc>, _>("expires_at") <= Utc::now() {
        return Err(AppError::Conflict(
            "Offer expired; request refreshed terms from the plant".into(),
        ));
    }
    if row.get::<BigDecimal, _>("total_amount") <= 0 {
        return Err(AppError::Conflict(
            "Order amount requires reconciliation".into(),
        ));
    }
    let status = if is_online(&mode) {
        "AWAITING_PAYMENT"
    } else {
        "READY_FOR_PRODUCTION"
    };
    sqlx::query("UPDATE order_payment_offers SET status=$2,customer_accepted_at=NOW(),updated_at=NOW() WHERE order_id=$1")
        .bind(order_id).bind(status).execute(&mut *tx).await?;
    if !is_online(&mode) {
        // Explicitly authorized deferred terms; no false paid flag.
        sqlx::query("UPDATE orders SET status='confirmed',updated_at=NOW() WHERE id=$1 AND status='pending'")
            .bind(order_id).execute(&mut *tx).await?;
    }
    sqlx::query("INSERT INTO audit_logs(user_id,action,resource_type,resource_id,metadata) VALUES($1,'order.payment_terms_accepted','order',$2,$3)")
        .bind(actor.user_id).bind(order_id.to_string())
        .bind(json!({"mode":mode,"offer_version":input.version,"status":status}))
        .execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(json!({"success":true,"status":status,
        "requires_online_payment":is_online(&mode),"payment_link":null,
        "message":if is_online(&mode) {"Secure payment link will be issued after gateway integration approval"} else {"Order confirmed under approved deferred payment terms"}})))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preference_values_are_closed() {
        assert!(valid_mode(FULL_ADVANCE));
        assert!(valid_mode(PARTIAL_ADVANCE));
        assert!(valid_mode(ON_DELIVERY));
        assert!(valid_mode(APPROVED_CREDIT));
        assert!(!valid_mode("PAY_NOW"));
    }
    #[test]
    fn advance_requires_owner_defined_valid_amount() {
        let total = BigDecimal::from(1000);
        assert_eq!(approved_advance(FULL_ADVANCE, &total, None).unwrap(), total);
        assert_eq!(
            approved_advance(PARTIAL_ADVANCE, &total, Some(33333)).unwrap(),
            BigDecimal::from(33333) / BigDecimal::from(100)
        );
        for cents in [0, -1, 100000, 999999] {
            assert!(approved_advance(PARTIAL_ADVANCE, &total, Some(cents)).is_err());
        }
        assert!(approved_advance(PARTIAL_ADVANCE, &total, None).is_err());
        assert!(approved_advance(ON_DELIVERY, &total, Some(1)).is_err());
        assert_eq!(
            approved_advance(APPROVED_CREDIT, &total, None).unwrap(),
            BigDecimal::from(0)
        );
    }
}
