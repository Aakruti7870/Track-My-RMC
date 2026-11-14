//! Nonbinding requests are isolated from operational orders and never reserve capacity.
use crate::{
    auth::{middleware::check_role, AuthUser},
    error::AppError,
    state::AppState,
};
use axum::{
    extract::{Path, State},
    Json,
};
use chrono::{NaiveDate, Utc};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::Row;
use uuid::Uuid;

fn request_ttl_hours() -> i64 {
    std::env::var("TRACKMYRMC_PROVISIONAL_TTL_HOURS")
        .ok()
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(168)
        .clamp(24, 720)
}

pub async fn submit(
    State(state): State<AppState>,
    user: AuthUser,
    Path(draft_id): Path<Uuid>,
) -> Result<Json<Value>, AppError> {
    check_role(&user, &["customer"])?;
    let mut tx = state.db.begin().await?;
    let snapshot: Value = sqlx::query_scalar("SELECT d.form FROM customer_order_drafts d JOIN users u ON u.id=d.customer_id AND u.is_active AND u.role='customer' WHERE d.id=$1 AND d.customer_id=$2 FOR UPDATE OF d")
        .bind(draft_id).bind(user.user_id).fetch_optional(&mut *tx).await?
        .ok_or_else(|| AppError::NotFound("Draft not found".into()))?;
    let form: super::customer_order_drafts::DraftForm = serde_json::from_value(snapshot.clone())
        .map_err(|_| AppError::Conflict("Draft needs to be edited before requesting".into()))?;
    let plant_id = form
        .plant_id
        .as_deref()
        .and_then(|s| Uuid::parse_str(s).ok())
        .ok_or_else(|| AppError::BadRequest("Select a plant".into()))?;
    let grade =
        crate::services::customer_order::canonical_grade(form.grade.as_deref().unwrap_or(""));
    if ![
        "M10", "M15", "M20", "M25", "M30", "M35", "M40", "M45", "M50", "M55", "M60",
    ]
    .contains(&grade.strip_suffix("PILE").unwrap_or(&grade))
    {
        return Err(AppError::BadRequest(
            "Select a supported concrete grade".into(),
        ));
    }
    let qty: f64 = form
        .quantity
        .parse()
        .map_err(|_| AppError::BadRequest("Enter a valid quantity".into()))?;
    if !qty.is_finite()
        || qty <= 0.0
        || qty > 10000.0
        || (qty * 100.0 - (qty * 100.0).round()).abs() > 0.00001
    {
        return Err(AppError::BadRequest(
            "Quantity must be positive and have at most two decimals".into(),
        ));
    }
    let date = NaiveDate::parse_from_str(&form.date, "%Y-%m-%d")
        .map_err(|_| AppError::BadRequest("Enter a valid delivery date".into()))?;
    if date < Utc::now().date_naive()
        || form.time.as_deref().is_none_or(|s| s.trim().is_empty())
        || form.site_name.trim().is_empty()
        || form.address.trim().is_empty()
        || form.contact.trim().is_empty()
        || form.mobile.trim().is_empty()
    {
        return Err(AppError::BadRequest(
            "Delivery date, time, site, address and site contact are required".into(),
        ));
    }
    if let Some(site) = form.site_id.as_deref() {
        let site =
            Uuid::parse_str(site).map_err(|_| AppError::BadRequest("Invalid site".into()))?;
        let owned: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM customer_sites WHERE id=$1 AND customer_id=$2)",
        )
        .bind(site)
        .bind(user.user_id)
        .fetch_one(&mut *tx)
        .await?;
        if !owned {
            return Err(AppError::Forbidden(
                "Site does not belong to this customer".into(),
            ));
        }
    }
    let plant = sqlx::query("SELECT p.owner_id FROM rmc_plants p WHERE p.id=$1 AND p.is_active AND EXISTS(SELECT 1 FROM plant_listing_requests r WHERE r.plant_id=p.id AND r.status='APPROVED') AND NOT EXISTS(SELECT 1 FROM plant_admin_controls c WHERE c.plant_id=p.id AND (NOT c.discovery_visible OR c.order_intake_mode NOT IN ('DIRECT','RFQ_ONLY'))) AND NOT EXISTS(SELECT 1 FROM google_plant_visibility_exclusions x WHERE x.place_id=p.google_place_id AND NOT x.is_visible) FOR SHARE")
        .bind(plant_id).fetch_optional(&mut *tx).await?
        .ok_or_else(|| AppError::Conflict("This plant is not accepting provisional requests".into()))?;
    if let Some(row) = sqlx::query("SELECT id,snapshot,status,expires_at>NOW() AS current FROM customer_provisional_requests WHERE customer_id=$1 AND draft_id=$2")
        .bind(user.user_id).bind(draft_id).fetch_optional(&mut *tx).await? {
        if row.get::<Value,_>("snapshot") != snapshot || row.get::<String,_>("status") != "PENDING_KYC" || !row.get::<bool,_>("current") {
            return Err(AppError::Conflict("This request was already sent or expired. Save a new draft for a new request.".into()));
        }
        let id: Uuid = row.get("id");
        tx.commit().await?;
        return Ok(Json(json!({"id":id,"status":"PENDING_KYC"})));
    }
    let id: Uuid = sqlx::query_scalar("INSERT INTO customer_provisional_requests(customer_id,draft_id,plant_id,snapshot,expires_at) VALUES($1,$2,$3,$4,NOW()+make_interval(hours => $5::int)) RETURNING id")
        .bind(user.user_id).bind(draft_id).bind(plant_id).bind(snapshot).bind(request_ttl_hours() as i32).fetch_one(&mut *tx).await?;
    sqlx::query("INSERT INTO notifications(user_id,title,body,notification_type,reference_id) VALUES($1,'Provisional request sent','Your request is nonbinding. Complete verification and review the details before placing an order.','provisional_request',$2),($3,'New provisional request','A customer sent a nonbinding request for your plant.','provisional_request',$2)")
        .bind(user.user_id).bind(id.to_string()).bind(plant.get::<Uuid,_>("owner_id")).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO audit_logs(user_id,action,resource_type,resource_id,metadata) VALUES($1,'provisional_request.submit','provisional_request',$2,$3)")
        .bind(user.user_id).bind(id.to_string()).bind(json!({"plant_id":plant_id})).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(json!({"id":id,"status":"PENDING_KYC"})))
}

pub async fn owner_list(
    State(state): State<AppState>,
    user: AuthUser,
) -> Result<Json<Value>, AppError> {
    check_role(&user, &["owner", "plant_owner"])?;
    let requests: Vec<Value> = sqlx::query_scalar("SELECT jsonb_build_object('id',r.id,'plant_name',p.name,'site_name',r.snapshot->>'site_name','address',r.snapshot->>'address','contact',r.snapshot->>'contact','mobile',r.snapshot->>'mobile','grade',r.snapshot->>'grade','quantity',r.snapshot->>'quantity','date',r.snapshot->>'date','time',r.snapshot->>'time','pump_required',r.snapshot->'pump_required','notes',r.snapshot->>'notes','plant_response',r.plant_response,'expires_at',r.expires_at) FROM customer_provisional_requests r JOIN rmc_plants p ON p.id=r.plant_id WHERE p.owner_id=$1 AND p.is_active AND r.status='PENDING_KYC' AND r.expires_at>NOW() AND NOT EXISTS(SELECT 1 FROM plant_admin_controls c WHERE c.plant_id=p.id AND c.order_intake_mode NOT IN ('DIRECT','RFQ_ONLY')) ORDER BY r.created_at DESC LIMIT 100")
        .bind(user.user_id).fetch_all(&state.db).await?;
    Ok(Json(json!({"requests":requests})))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Response {
    message: String,
}

pub async fn respond(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Json(input): Json<Response>,
) -> Result<Json<Value>, AppError> {
    check_role(&user, &["owner", "plant_owner"])?;
    let message = input.message.trim();
    if message.is_empty() || message.len() > 1000 {
        return Err(AppError::BadRequest(
            "Enter a response of at most 1000 characters".into(),
        ));
    }
    let mut tx = state.db.begin().await?;
    let row = sqlx::query("SELECT r.customer_id,r.plant_response FROM customer_provisional_requests r JOIN rmc_plants p ON p.id=r.plant_id WHERE r.id=$1 AND p.owner_id=$2 AND p.is_active AND r.status='PENDING_KYC' AND r.expires_at>NOW() AND NOT EXISTS(SELECT 1 FROM plant_admin_controls c WHERE c.plant_id=p.id AND c.order_intake_mode NOT IN ('DIRECT','RFQ_ONLY')) FOR UPDATE OF r")
        .bind(id).bind(user.user_id).fetch_optional(&mut *tx).await?
        .ok_or_else(|| AppError::NotFound("Provisional request not available".into()))?;
    if row.get::<Option<String>, _>("plant_response").as_deref() != Some(message) {
        sqlx::query("UPDATE customer_provisional_requests SET plant_response=$2,updated_at=NOW() WHERE id=$1").bind(id).bind(message).execute(&mut *tx).await?;
        sqlx::query("INSERT INTO notifications(user_id,title,body,notification_type,reference_id) VALUES($1,'Plant response received','The plant responded to your nonbinding request. Open My Orders to review it.','provisional_response',$2)")
            .bind(row.get::<Uuid,_>("customer_id")).bind(id.to_string()).execute(&mut *tx).await?;
        sqlx::query("INSERT INTO audit_logs(user_id,action,resource_type,resource_id) VALUES($1,'provisional_request.respond','provisional_request',$2)")
            .bind(user.user_id).bind(id.to_string()).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(Json(json!({"success":true})))
}
