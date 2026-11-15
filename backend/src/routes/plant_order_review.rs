use crate::{
    auth::{middleware::check_role, AuthUser},
    error::AppError,
    routes::rmc_rfq_leads::{validate_requirements, verify_google_place, NewRmcRfq},
    services::customer_order::canonical_grade,
    state::AppState,
};
use axum::{extract::State, Json};
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
) -> Result<Option<Uuid>, AppError> {
    Ok(sqlx::query_scalar(
        "SELECT id FROM plant_order_review_requests WHERE customer_id=$1 AND request_key=$2",
    )
    .bind(customer)
    .bind(key)
    .fetch_optional(conn)
    .await?)
}

fn receipt(id: Uuid) -> Json<Value> {
    Json(json!({"id": id, "status": "PENDING_ADMIN_REVIEW"}))
}

pub async fn create(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(request): Json<NewRmcRfq>,
) -> Result<Json<Value>, AppError> {
    check_role(&auth, &["customer"])?;
    let mut conn = state.db.acquire().await?;
    if let Some(id) = existing_id(&mut conn, auth.user_id, request.request_key).await? {
        return Ok(receipt(id));
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
    if let Some(id) = existing_id(&mut tx, auth.user_id, request.request_key).await? {
        return Ok(receipt(id));
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
    Ok(receipt(id))
}

pub async fn list_customer(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<Value>, AppError> {
    check_role(&auth, &["customer"])?;
    let requests: Vec<Value> = sqlx::query_scalar(
        "SELECT jsonb_build_object('id',r.id,'plant_name',p.name,'grade',r.grade,
          'quantity_m3',r.quantity_m3::double precision,'delivery_date',r.delivery_date,
          'site_address',r.site_address)
         FROM plant_order_review_requests r LEFT JOIN rmc_plants p ON p.id=r.plant_id
         WHERE r.customer_id=$1 ORDER BY r.created_at DESC,r.id DESC LIMIT 100",
    )
    .bind(auth.user_id)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(json!({"requests":requests})))
}
