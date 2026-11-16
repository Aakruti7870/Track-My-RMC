use crate::{
    auth::{control_center::WebAdmin, middleware::check_role, AuthUser},
    error::AppError,
    routes::rmc_rfq_leads::{validate_requirements, verify_google_place, NewRmcRfq},
    services::customer_order::canonical_grade,
    state::AppState,
};
use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::PgConnection;
use uuid::Uuid;

async fn review_plant(
    conn: &mut PgConnection,
    customer: Uuid,
    request: &NewRmcRfq,
) -> Result<Option<Uuid>, AppError> {
    let unavailable = || AppError::Conflict("Selected plant is unavailable for ordering".into());
    let blocked_google_place: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM google_plant_visibility_exclusions
         WHERE place_id=$1 AND NOT is_visible)",
    )
    .bind(request.google_place_id.as_deref())
    .fetch_one(&mut *conn)
    .await?;
    if blocked_google_place {
        return Err(unavailable());
    }
    let is_review_customer: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM play_review_fixtures
         WHERE user_id=$1 AND role='customer' AND enabled)",
    )
    .bind(customer)
    .fetch_one(&mut *conn)
    .await?;
    let plant: Option<(Uuid, bool, bool, String)> = sqlx::query_as(
        "SELECT p.id, p.is_active
            AND COALESCE(c.discovery_visible, TRUE)
            AND NOT EXISTS(SELECT 1 FROM google_plant_visibility_exclusions x
                           WHERE x.place_id=p.google_place_id AND NOT x.is_visible)
            AND $3=EXISTS(SELECT 1 FROM play_review_fixtures f
                          WHERE f.plant_id=p.id AND f.role='customer' AND f.enabled),
            EXISTS(SELECT 1 FROM plant_listing_requests r WHERE r.plant_id=p.id AND r.status='APPROVED'),
            COALESCE(c.order_intake_mode,'DIRECT')
         FROM rmc_plants p LEFT JOIN plant_admin_controls c ON c.plant_id=p.id
         WHERE p.id=$1 OR p.google_place_id=$2",
    )
    .bind(request.plant_id)
    .bind(request.google_place_id.as_deref())
    .bind(is_review_customer)
    .fetch_optional(&mut *conn)
    .await?;
    match plant {
        Some((id, true, _, mode)) if mode == "ADMIN_REVIEW" => Ok(Some(id)),
        Some((id, true, false, mode)) if mode == "DIRECT" => Ok(Some(id)),
        Some((_, true, true, mode)) if mode == "DIRECT" => Err(AppError::Conflict(
            "This plant accepts direct orders. Select its verified card from Nearby Plants.".into(),
        )),
        None if request.google_place_id.is_some() && !is_review_customer => Ok(None),
        _ => Err(unavailable()),
    }
}

async fn existing_id(
    conn: &mut PgConnection,
    customer: Uuid,
    key: Uuid,
) -> Result<Option<(Uuid, String)>, AppError> {
    Ok(sqlx::query_as(
        "SELECT id,status FROM plant_order_review_requests WHERE customer_id=$1 AND request_key=$2",
    )
    .bind(customer)
    .bind(key)
    .fetch_optional(conn)
    .await?)
}

fn receipt(id: Uuid, status: &str) -> Json<Value> {
    Json(json!({"id": id, "status": status}))
}

pub async fn create(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(request): Json<NewRmcRfq>,
) -> Result<Json<Value>, AppError> {
    check_role(&auth, &["customer"])?;
    let mut conn = state.db.acquire().await?;
    if let Some((id, status)) = existing_id(&mut conn, auth.user_id, request.request_key).await? {
        return Ok(receipt(id, &status));
    }
    validate_requirements(&request)?;
    let initial_plant_id = review_plant(&mut conn, auth.user_id, &request).await?;
    drop(conn);
    if let (None, Some(place_id)) = (initial_plant_id, request.google_place_id.as_deref()) {
        verify_google_place(&state, place_id).await?;
    }

    let mut tx = state.db.begin().await?;
    // Serialize submissions per customer so retries and the intake limit stay consistent.
    sqlx::query("SELECT id FROM users WHERE id=$1 FOR NO KEY UPDATE")
        .bind(auth.user_id)
        .fetch_one(&mut *tx)
        .await?;
    if let Some((id, status)) = existing_id(&mut tx, auth.user_id, request.request_key).await? {
        return Ok(receipt(id, &status));
    }
    let recent: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM plant_order_review_requests
         WHERE customer_id=$1 AND created_at>NOW()-INTERVAL '1 hour'",
    )
    .bind(auth.user_id)
    .fetch_one(&mut *tx)
    .await?;
    if recent >= 10 {
        return Err(AppError::RateLimited(
            "Order request limit reached. Please try later".into(),
        ));
    }
    let plant_id = review_plant(&mut tx, auth.user_id, &request).await?;
    if initial_plant_id.is_some() && plant_id.is_none() {
        return Err(AppError::Conflict(
            "Selected plant changed. Please resubmit your request.".into(),
        ));
    }
    let id: Uuid = sqlx::query_scalar(
        "INSERT INTO plant_order_review_requests
         (customer_id,request_key,plant_id,google_place_id,customer_name,customer_email,customer_gstin,
          grade,quantity_m3,site_address,site_lat,site_lng,delivery_date,pump_required,site_contact_phone)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id",
    )
    .bind(auth.user_id)
    .bind(request.request_key)
    .bind(plant_id)
    .bind(request.google_place_id.as_deref())
    .bind(request.customer_name.trim())
    .bind(request.customer_email.as_deref())
    .bind(request.customer_gstin.as_deref())
    .bind(canonical_grade(&request.grade))
    .bind(request.quantity_m3)
    .bind(request.site_address.trim())
    .bind(request.site_lat)
    .bind(request.site_lng)
    .bind(request.delivery_date)
    .bind(request.pump_required)
    .bind(request.site_contact_phone.trim())
    .fetch_one(&mut *tx)
    .await?;
    sqlx::query(
        "INSERT INTO notifications(user_id,title,body,notification_type,reference_id)
         SELECT u.id,'New plant order request','A customer order request is awaiting your review.',
                'plant_order_review',$1
         FROM users u JOIN control_center_access c ON c.user_id=u.id
         WHERE u.role='central_admin' AND u.is_active AND c.approved
           AND 'order.view'=ANY(c.permissions)",
    )
    .bind(id.to_string())
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(receipt(id, "PENDING_ADMIN_REVIEW"))
}

#[derive(Deserialize)]
pub struct ReviewFilter {
    id: Option<Uuid>,
}

pub async fn list_customer(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(filter): Query<ReviewFilter>,
) -> Result<Json<Value>, AppError> {
    check_role(&auth, &["customer"])?;
    let requests: Vec<Value> = sqlx::query_scalar(
        "SELECT jsonb_build_object('id',r.id,'plant_name',p.name,'grade',r.grade,
          'quantity_m3',r.quantity_m3::double precision,'delivery_date',r.delivery_date,
          'site_address',r.site_address,'status',r.status,'decision_note',r.decision_note,
          'pump_required',r.pump_required,'delivery_lat',r.site_lat,'delivery_lng',r.site_lng,
          'quotation_requested', EXISTS(SELECT 1 FROM rmc_rfq_leads q WHERE q.customer_id=r.customer_id AND q.request_key=r.id AND q.canonical_request_id IS NOT NULL),
          'quotation_plant_id', CASE WHEN r.status='READY_FOR_QUOTATION' AND p.is_active
            AND EXISTS(SELECT 1 FROM plant_listing_requests l WHERE l.plant_id=p.id AND l.status='APPROVED')
            AND NOT EXISTS(SELECT 1 FROM plant_admin_controls c WHERE c.plant_id=p.id AND (NOT c.discovery_visible OR c.order_intake_mode='DISABLED'))
            AND NOT EXISTS(SELECT 1 FROM google_plant_visibility_exclusions x WHERE x.place_id IN (p.google_place_id, r.google_place_id) AND NOT x.is_visible)
            THEN p.id ELSE NULL END)
         FROM plant_order_review_requests r LEFT JOIN rmc_plants p ON p.id=r.plant_id
         WHERE r.customer_id=$1 AND ($2::uuid IS NULL OR r.id=$2) ORDER BY r.created_at DESC,r.id DESC LIMIT 100",
    )
    .bind(auth.user_id)
    .bind(filter.id)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(json!({"requests":requests})))
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReviewOutcome {
    AwaitPlant,
    ApproveQuotation,
    Decline,
}

#[derive(Deserialize)]
pub struct ReviewDecision {
    outcome: ReviewOutcome,
    note: String,
}

pub async fn decide(
    State(state): State<AppState>,
    admin: WebAdmin,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(decision): Json<ReviewDecision>,
) -> Result<Json<Value>, AppError> {
    admin.require("order.view")?;
    admin.require("plant_owners.manage")?;
    let note = decision.note.trim();
    if !(10..=500).contains(&note.chars().count()) {
        return Err(AppError::BadRequest(
            "Enter a customer-visible note (10–500 characters)".into(),
        ));
    }
    let status = match decision.outcome {
        ReviewOutcome::AwaitPlant => "AWAITING_PLANT",
        ReviewOutcome::ApproveQuotation => "READY_FOR_QUOTATION",
        ReviewOutcome::Decline => "DECLINED",
    };

    let mut tx = state.db.begin().await?;
    let (customer, existing, previous_note, original_plant, google_place): (Uuid, String, Option<String>, Option<Uuid>, Option<String>) =
        sqlx::query_as("SELECT customer_id,status,decision_note,plant_id,google_place_id FROM plant_order_review_requests WHERE id=$1 FOR UPDATE")
            .bind(id).fetch_optional(&mut *tx).await?
            .ok_or_else(|| AppError::NotFound("Order request not found".into()))?;
    super::control_center_routes::require_recent_step_up_using(&mut *tx, &admin, &headers).await?;
    if existing == status && previous_note.as_deref() == Some(note) {
        return Ok(receipt(id, status));
    }
    if !matches!(existing.as_str(), "PENDING_ADMIN_REVIEW" | "AWAITING_PLANT") {
        return Err(AppError::Conflict(
            "This order request already has a final decision".into(),
        ));
    }

    let plant_id = if matches!(decision.outcome, ReviewOutcome::ApproveQuotation) {
        let ready: Option<Uuid> = sqlx::query_scalar(
            "SELECT p.id FROM rmc_plants p
             WHERE (p.id=$1 OR ($1 IS NULL AND p.google_place_id=$2)) AND p.is_active
             AND EXISTS(SELECT 1 FROM plant_listing_requests l WHERE l.plant_id=p.id AND l.status='APPROVED')
             AND NOT EXISTS(SELECT 1 FROM plant_admin_controls c WHERE c.plant_id=p.id AND (NOT c.discovery_visible OR c.order_intake_mode='DISABLED'))
             AND NOT EXISTS(SELECT 1 FROM google_plant_visibility_exclusions x WHERE x.place_id IN (p.google_place_id,$2) AND NOT x.is_visible)
             AND EXISTS(SELECT 1 FROM play_review_fixtures f WHERE f.plant_id=p.id AND f.role='customer' AND f.enabled)
                 = EXISTS(SELECT 1 FROM play_review_fixtures f WHERE f.user_id=$3 AND f.role='customer' AND f.enabled)",
        ).bind(original_plant).bind(google_place).bind(customer).fetch_optional(&mut *tx).await?;
        Some(ready.ok_or_else(|| AppError::Conflict("An active, verified plant accepting requests is required. Mark the request awaiting plant first.".into()))?)
    } else {
        original_plant
    };
    sqlx::query("UPDATE plant_order_review_requests SET status=$2,decision_note=$3,reviewed_by=$4,reviewed_at=NOW(),plant_id=$5 WHERE id=$1")
        .bind(id).bind(status).bind(note).bind(admin.user_id).bind(plant_id).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO audit_logs(user_id,action,resource_type,resource_id,metadata) VALUES($1,'control_center.plant_order_request.decide','plant_order_request',$2,$3)")
        .bind(admin.user_id).bind(id.to_string()).bind(json!({"previous_status":existing,"status":status,"plant_id":plant_id}))
        .execute(&mut *tx).await?;
    let message = match status {
        "READY_FOR_QUOTATION" => "You can now confirm a quotation request in My Orders.",
        "AWAITING_PLANT" => "Your order request is awaiting plant onboarding.",
        _ => "Your order request was declined. Open My Orders for details.",
    };
    sqlx::query("INSERT INTO notifications(user_id,title,body,notification_type,reference_id) VALUES($1,'Plant order request updated',$2,'plant_order_review_update',$3)")
        .bind(customer).bind(message).bind(id.to_string()).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(receipt(id, status))
}
