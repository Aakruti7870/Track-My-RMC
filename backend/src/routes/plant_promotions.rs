//! Enquiry-based plant promotions, Super Admin custom-radius activation,
//! and deterministic 2-minute cyclic top-listing rotation.

use crate::{
    auth::{control_center::WebAdmin, middleware::AuthUser},
    error::AppError,
    state::AppState,
};
use axum::{
    extract::{Path, Query, State},
    Json,
};
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::Row;
use uuid::Uuid;

pub const DEFAULT_PROMOTION_RADIUS_KM: i32 = 30;
pub const MIN_PROMOTION_RADIUS_KM: i32 = 1;
pub const MAX_PROMOTION_RADIUS_KM: i32 = 250;
pub const PROMOTION_ROTATION_WINDOW_SECS: i64 = 120;
pub const MIN_AUDIT_REASON_LEN: usize = 10;

#[derive(Debug, Clone, Deserialize)]
pub struct SubmitPromotionEnquiryRequest {
    pub plant_id: Uuid,
    pub requested_radius_km: Option<i32>,
    pub preferred_duration_days: Option<i32>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ActivatePromotionRequest {
    pub plant_id: Uuid,
    pub enquiry_id: Option<Uuid>,
    pub radius_km: Option<i32>,
    pub duration_days: Option<i32>,
    pub audit_reason: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UpdatePromotionRadiusRequest {
    pub radius_km: i32,
    pub audit_reason: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SetPromotionStatusRequest {
    pub status: String,
    pub audit_reason: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CustomerPromotedQuery {
    pub lat: f64,
    pub lng: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct PromotionRotationMeta {
    pub window_seconds: i64,
    pub current_bucket: i64,
    pub seconds_until_next_shift: i64,
}

pub fn validate_radius_km(radius_km: i32) -> Result<i32, AppError> {
    if !(MIN_PROMOTION_RADIUS_KM..=MAX_PROMOTION_RADIUS_KM).contains(&radius_km) {
        let msg = "Promotion visibility radius must be between 1 and 250 km";
        return Err(AppError::Conflict(msg.into()));
    }
    Ok(radius_km)
}

pub fn validate_duration_days(duration_days: i32) -> Result<i32, AppError> {
    if !(1..=365).contains(&duration_days) {
        let msg = "Promotion duration must be between 1 and 365 days";
        return Err(AppError::Conflict(msg.into()));
    }
    Ok(duration_days)
}

pub fn validate_audit_reason(reason: &str) -> Result<String, AppError> {
    let trimmed = reason.trim();
    if trimmed.chars().count() < MIN_AUDIT_REASON_LEN {
        let msg = "Super Admin audit reason must be at least 10 characters";
        return Err(AppError::Conflict(msg.into()));
    }
    Ok(trimmed.to_string())
}

/// Deterministic 2-minute cyclic right-rotation for active promoted plants.
///
/// Input `items` must be stably ordered by `(activated_at ASC, plant_id ASC)`.
/// Every 120 seconds, the last item moves to index 0:
/// - bucket 0: `[1, 2, 3, 4, 5]`
/// - bucket 1: `[5, 1, 2, 3, 4]`
/// - bucket 2: `[4, 5, 1, 2, 3]`
/// - bucket 3: `[3, 4, 5, 1, 2]`
pub fn apply_two_minute_promotion_rotation<T>(items: &mut [T], now_unix_secs: i64) {
    if items.len() <= 1 {
        return;
    }
    let window = now_unix_secs.div_euclid(PROMOTION_ROTATION_WINDOW_SECS);
    let bucket = usize::try_from(window).unwrap_or(0);
    let shift = bucket % items.len();
    items.rotate_right(shift);
}

pub fn rotation_metadata(now_unix_secs: i64) -> PromotionRotationMeta {
    let bucket = now_unix_secs.div_euclid(PROMOTION_ROTATION_WINDOW_SECS);
    let elapsed = now_unix_secs.rem_euclid(PROMOTION_ROTATION_WINDOW_SECS);
    PromotionRotationMeta {
        window_seconds: PROMOTION_ROTATION_WINDOW_SECS,
        current_bucket: bucket,
        seconds_until_next_shift: PROMOTION_ROTATION_WINDOW_SECS - elapsed,
    }
}

/// Customer-facing promoted plants within each plant's Super Admin custom radius,
/// automatically rotated every 2 minutes when >1 promoted plant qualifies.
pub async fn customer_promoted_plants(
    State(state): State<AppState>,
    _auth_user: AuthUser,
    Query(query): Query<CustomerPromotedQuery>,
) -> Result<Json<Value>, AppError> {
    let valid_lat = query.lat.is_finite() && (-90.0..=90.0).contains(&query.lat);
    let valid_lng = query.lng.is_finite() && (-180.0..=180.0).contains(&query.lng);
    if !valid_lat || !valid_lng {
        return Err(AppError::Conflict("Invalid latitude or longitude".into()));
    }

    let rows = sqlx::query(
        "SELECT
            p.id AS plant_id,
            p.name AS plant_name,
            p.city,
            p.pincode,
            p.latitude,
            p.longitude,
            pr.radius_km,
            pr.activated_at,
            6371.0 * 2.0 * asin(sqrt(least(1.0, greatest(0.0,
                power(sin(radians(p.latitude - $1) / 2.0), 2)
                + cos(radians($1)) * cos(radians(p.latitude))
                  * power(sin(radians(p.longitude - $2) / 2.0), 2)
            )))) AS distance_km
         FROM plant_promotions pr
         JOIN rmc_plants p ON p.id = pr.plant_id
         LEFT JOIN plant_admin_controls c ON c.plant_id = p.id
         WHERE pr.status = 'ACTIVE'
           AND (pr.ends_at IS NULL OR pr.ends_at > NOW())
           AND p.is_active = TRUE
           AND COALESCE(c.discovery_visible, TRUE) = TRUE
           AND p.latitude IS NOT NULL
           AND p.longitude IS NOT NULL
         ORDER BY pr.activated_at ASC, pr.plant_id ASC",
    )
    .bind(query.lat)
    .bind(query.lng)
    .fetch_all(&state.db)
    .await?;

    let mut promoted: Vec<Value> = rows
        .into_iter()
        .filter_map(|row| {
            let radius_km: i32 = row.get("radius_km");
            let distance_km: f64 = row.get("distance_km");
            if distance_km <= f64::from(radius_km) {
                Some(json!({
                    "plant_id": row.get::<Uuid, _>("plant_id"),
                    "plant_name": row.get::<String, _>("plant_name"),
                    "city": row.get::<Option<String>, _>("city"),
                    "pincode": row.get::<Option<String>, _>("pincode"),
                    "latitude": row.get::<f64, _>("latitude"),
                    "longitude": row.get::<f64, _>("longitude"),
                    "promotion_radius_km": radius_km,
                    "distance_km": (distance_km * 100.0).round() / 100.0,
                    "is_promoted": true,
                }))
            } else {
                None
            }
        })
        .collect();

    let now_secs = Utc::now().timestamp();
    apply_two_minute_promotion_rotation(&mut promoted, now_secs);

    Ok(Json(json!({
        "rotation": rotation_metadata(now_secs),
        "plants": promoted,
    })))
}

pub async fn owner_overview(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<Json<Value>, AppError> {
    let rows = sqlx::query(
        "SELECT
            p.id AS plant_id,
            p.name AS plant_name,
            p.city,
            pr.status AS promotion_status,
            pr.radius_km,
            pr.ends_at,
            eq.status AS latest_enquiry_status,
            eq.created_at AS latest_enquiry_created_at
         FROM rmc_plants p
         LEFT JOIN plant_promotions pr ON pr.plant_id = p.id
         LEFT JOIN LATERAL (
             SELECT status, created_at
             FROM plant_promotion_enquiries
             WHERE plant_id = p.id
             ORDER BY created_at DESC
             LIMIT 1
         ) eq ON TRUE
         WHERE p.owner_id = $1
         ORDER BY p.name ASC",
    )
    .bind(auth_user.user_id)
    .fetch_all(&state.db)
    .await?;

    let plants: Vec<Value> = rows
        .into_iter()
        .map(|row| {
            let created_at = row.get::<Option<DateTime<Utc>>, _>("latest_enquiry_created_at");
            json!({
                "plant_id": row.get::<Uuid, _>("plant_id"),
                "plant_name": row.get::<String, _>("plant_name"),
                "city": row.get::<Option<String>, _>("city"),
                "promotion_status": row.get::<Option<String>, _>("promotion_status"),
                "radius_km": row.get::<Option<i32>, _>("radius_km"),
                "ends_at": row.get::<Option<DateTime<Utc>>, _>("ends_at"),
                "latest_enquiry_status": row.get::<Option<String>, _>("latest_enquiry_status"),
                "latest_enquiry_created_at": created_at,
            })
        })
        .collect();

    Ok(Json(json!({
        "default_radius_km": DEFAULT_PROMOTION_RADIUS_KM,
        "rotation_interval_seconds": PROMOTION_ROTATION_WINDOW_SECS,
        "plants": plants,
    })))
}

pub async fn submit_enquiry(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Json(payload): Json<SubmitPromotionEnquiryRequest>,
) -> Result<Json<Value>, AppError> {
    let raw_radius = payload.requested_radius_km.unwrap_or(DEFAULT_PROMOTION_RADIUS_KM);
    let requested_radius_km = validate_radius_km(raw_radius)?;
    let raw_days = payload.preferred_duration_days.unwrap_or(30);
    let preferred_duration_days = validate_duration_days(raw_days)?;
    let notes = payload
        .notes
        .map(|n| n.trim().chars().take(500).collect::<String>())
        .filter(|n| !n.is_empty());

    let mut tx = state.db.begin().await?;

    let plant_sql = "SELECT id, name FROM rmc_plants WHERE id = $1 AND owner_id = $2";
    let plant_row = sqlx::query(plant_sql)
        .bind(payload.plant_id)
        .bind(auth_user.user_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| {
            let msg = "You can only submit promotion enquiries for your own plant";
            AppError::Forbidden(msg.into())
        })?;

    let plant_name: String = plant_row.get("name");

    let enquiry_id: Uuid = sqlx::query_scalar(
        "INSERT INTO plant_promotion_enquiries
            (plant_id, owner_user_id, requested_radius_km, preferred_duration_days, notes)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id",
    )
    .bind(payload.plant_id)
    .bind(auth_user.user_id)
    .bind(requested_radius_km)
    .bind(preferred_duration_days)
    .bind(&notes)
    .fetch_one(&mut *tx)
    .await?;

    let owner_body = format!(
        "Your top-listing promotion enquiry for {plant_name} \
         ({requested_radius_km} km radius, {preferred_duration_days} days) \
         was received. TrackMyRMC Super Admin will review and activate it."
    );
    sqlx::query(
        "INSERT INTO notifications (user_id, title, body, notification_type, reference_id)
         VALUES ($1, 'Promotion enquiry submitted', $2, 'plant_promotion_enquiry', $3)",
    )
    .bind(auth_user.user_id)
    .bind(&owner_body)
    .bind(enquiry_id.to_string())
    .execute(&mut *tx)
    .await?;

    let admin_body = format!(
        "Plant Owner requested top-listing promotion for {plant_name} \
         ({requested_radius_km} km radius, {preferred_duration_days} days). \
         Review in Super Admin Promotions."
    );
    sqlx::query(
        "INSERT INTO notifications (user_id, title, body, notification_type, reference_id)
         SELECT id, 'New Plant Promotion Enquiry', $1, 'plant_promotion_enquiry', $2
         FROM users
         WHERE role = 'central_admin' AND is_active = TRUE",
    )
    .bind(&admin_body)
    .bind(enquiry_id.to_string())
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    Ok(Json(json!({
        "enquiry_id": enquiry_id,
        "plant_id": payload.plant_id,
        "plant_name": plant_name,
        "requested_radius_km": requested_radius_km,
        "preferred_duration_days": preferred_duration_days,
        "status": "PENDING",
    })))
}

pub async fn admin_list(
    State(state): State<AppState>,
    admin: WebAdmin,
) -> Result<Json<Value>, AppError> {
    admin.require("plant.view")?;

    let enquiry_rows = sqlx::query(
        "SELECT
            e.id,
            e.plant_id,
            p.name AS plant_name,
            u.email AS owner_email,
            p.city,
            p.pincode,
            e.requested_radius_km,
            e.preferred_duration_days,
            e.notes,
            e.status,
            e.created_at
         FROM plant_promotion_enquiries e
         JOIN rmc_plants p ON p.id = e.plant_id
         LEFT JOIN users u ON u.id = e.owner_user_id
         ORDER BY e.created_at DESC
         LIMIT 200",
    )
    .fetch_all(&state.db)
    .await?;

    let enquiries: Vec<Value> = enquiry_rows
        .into_iter()
        .map(|row| {
            json!({
                "id": row.get::<Uuid, _>("id"),
                "plant_id": row.get::<Uuid, _>("plant_id"),
                "plant_name": row.get::<String, _>("plant_name"),
                "owner_email": row.get::<Option<String>, _>("owner_email"),
                "city": row.get::<Option<String>, _>("city"),
                "pincode": row.get::<Option<String>, _>("pincode"),
                "requested_radius_km": row.get::<i32, _>("requested_radius_km"),
                "preferred_duration_days": row.get::<i32, _>("preferred_duration_days"),
                "notes": row.get::<Option<String>, _>("notes"),
                "status": row.get::<String, _>("status"),
                "created_at": row.get::<DateTime<Utc>, _>("created_at"),
            })
        })
        .collect();

    let promo_rows = sqlx::query(
        "SELECT
            pr.id,
            pr.plant_id,
            p.name AS plant_name,
            p.city,
            p.pincode,
            pr.radius_km,
            pr.status,
            pr.starts_at,
            pr.ends_at,
            pr.activated_at,
            pr.audit_reason
         FROM plant_promotions pr
         JOIN rmc_plants p ON p.id = pr.plant_id
         ORDER BY pr.activated_at ASC, pr.plant_id ASC",
    )
    .fetch_all(&state.db)
    .await?;

    let promotions: Vec<Value> = promo_rows
        .into_iter()
        .map(|row| {
            json!({
                "id": row.get::<Uuid, _>("id"),
                "plant_id": row.get::<Uuid, _>("plant_id"),
                "plant_name": row.get::<String, _>("plant_name"),
                "city": row.get::<Option<String>, _>("city"),
                "pincode": row.get::<Option<String>, _>("pincode"),
                "radius_km": row.get::<i32, _>("radius_km"),
                "status": row.get::<String, _>("status"),
                "starts_at": row.get::<DateTime<Utc>, _>("starts_at"),
                "ends_at": row.get::<Option<DateTime<Utc>>, _>("ends_at"),
                "activated_at": row.get::<DateTime<Utc>, _>("activated_at"),
                "audit_reason": row.get::<String, _>("audit_reason"),
            })
        })
        .collect();

    Ok(Json(json!({
        "rotation": rotation_metadata(Utc::now().timestamp()),
        "enquiries": enquiries,
        "promotions": promotions,
    })))
}

pub async fn admin_activate(
    State(state): State<AppState>,
    admin: WebAdmin,
    Json(payload): Json<ActivatePromotionRequest>,
) -> Result<Json<Value>, AppError> {
    admin.require("plant_owners.manage")?;

    let raw_radius = payload.radius_km.unwrap_or(DEFAULT_PROMOTION_RADIUS_KM);
    let radius_km = validate_radius_km(raw_radius)?;
    let raw_days = payload.duration_days.unwrap_or(30);
    let duration_days = validate_duration_days(raw_days)?;
    let audit_reason = validate_audit_reason(&payload.audit_reason)?;

    let now = Utc::now();
    let ends_at = now + Duration::days(i64::from(duration_days));

    let mut tx = state.db.begin().await?;

    let plant_row = sqlx::query("SELECT id, name, owner_id FROM rmc_plants WHERE id = $1")
        .bind(payload.plant_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| AppError::NotFound("Plant not found".into()))?;

    let plant_name: String = plant_row.get("name");
    let owner_id: Option<Uuid> = plant_row.get("owner_id");

    let promo_id: Uuid = sqlx::query_scalar(
        "INSERT INTO plant_promotions
            (plant_id, enquiry_id, radius_km, status, starts_at, ends_at,
             activated_at, activated_by, updated_by, audit_reason)
         VALUES ($1, $2, $3, 'ACTIVE', $4, $5, $4, $6, $6, $7)
         ON CONFLICT (plant_id) DO UPDATE SET
            enquiry_id = COALESCE(EXCLUDED.enquiry_id, plant_promotions.enquiry_id),
            radius_km = EXCLUDED.radius_km,
            status = 'ACTIVE',
            starts_at = EXCLUDED.starts_at,
            ends_at = EXCLUDED.ends_at,
            activated_at = EXCLUDED.activated_at,
            updated_by = EXCLUDED.updated_by,
            audit_reason = EXCLUDED.audit_reason,
            updated_at = NOW()
         RETURNING id",
    )
    .bind(payload.plant_id)
    .bind(payload.enquiry_id)
    .bind(radius_km)
    .bind(now)
    .bind(ends_at)
    .bind(admin.user.user_id)
    .bind(&audit_reason)
    .fetch_one(&mut *tx)
    .await?;

    if let Some(enquiry_id) = payload.enquiry_id {
        sqlx::query(
            "UPDATE plant_promotion_enquiries
             SET status = 'ACTIVATED', reviewed_by = $2, review_note = $3, updated_at = NOW()
             WHERE id = $1",
        )
        .bind(enquiry_id)
        .bind(admin.user.user_id)
        .bind(&audit_reason)
        .execute(&mut *tx)
        .await?;
    }

    sqlx::query(
        "INSERT INTO audit_logs (user_id, action, resource_type, resource_id, metadata)
         VALUES ($1, 'plant_promotion.activate', 'rmc_plant', $2, $3)",
    )
    .bind(admin.user.user_id)
    .bind(payload.plant_id.to_string())
    .bind(json!({
        "promotion_id": promo_id,
        "radius_km": radius_km,
        "duration_days": duration_days,
        "audit_reason": audit_reason,
    }))
    .execute(&mut *tx)
    .await?;

    if let Some(owner_uid) = owner_id {
        let end_date = ends_at.format("%Y-%m-%d");
        let body = format!(
            "Top-listing promotion is now ACTIVE for {plant_name} \
             within a {radius_km} km radius until {end_date}."
        );
        sqlx::query(
            "INSERT INTO notifications (user_id, title, body, notification_type, reference_id)
             VALUES ($1, 'Plant promotion activated', $2, 'plant_promotion_active', $3)",
        )
        .bind(owner_uid)
        .bind(&body)
        .bind(promo_id.to_string())
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;

    Ok(Json(json!({
        "promotion_id": promo_id,
        "plant_id": payload.plant_id,
        "radius_km": radius_km,
        "status": "ACTIVE",
        "ends_at": ends_at,
    })))
}

pub async fn admin_update_radius(
    State(state): State<AppState>,
    admin: WebAdmin,
    Path(plant_id): Path<Uuid>,
    Json(payload): Json<UpdatePromotionRadiusRequest>,
) -> Result<Json<Value>, AppError> {
    admin.require("plant_owners.manage")?;

    let radius_km = validate_radius_km(payload.radius_km)?;
    let audit_reason = validate_audit_reason(&payload.audit_reason)?;

    let mut tx = state.db.begin().await?;

    let updated = sqlx::query(
        "UPDATE plant_promotions
         SET radius_km = $2, updated_by = $3, audit_reason = $4, updated_at = NOW()
         WHERE plant_id = $1
         RETURNING id",
    )
    .bind(plant_id)
    .bind(radius_km)
    .bind(admin.user.user_id)
    .bind(&audit_reason)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound("Active promotion not found for this plant".into()))?;

    let promo_id: Uuid = updated.get("id");

    sqlx::query(
        "INSERT INTO audit_logs (user_id, action, resource_type, resource_id, metadata)
         VALUES ($1, 'plant_promotion.update_radius', 'rmc_plant', $2, $3)",
    )
    .bind(admin.user.user_id)
    .bind(plant_id.to_string())
    .bind(json!({
        "promotion_id": promo_id,
        "radius_km": radius_km,
        "audit_reason": audit_reason,
    }))
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    Ok(Json(json!({
        "promotion_id": promo_id,
        "plant_id": plant_id,
        "radius_km": radius_km,
    })))
}

pub async fn admin_set_status(
    State(state): State<AppState>,
    admin: WebAdmin,
    Path(plant_id): Path<Uuid>,
    Json(payload): Json<SetPromotionStatusRequest>,
) -> Result<Json<Value>, AppError> {
    admin.require("plant_owners.manage")?;

    let status = payload.status.trim().to_uppercase();
    if !matches!(status.as_str(), "ACTIVE" | "PAUSED" | "REVOKED") {
        let msg = "Status must be ACTIVE, PAUSED, or REVOKED";
        return Err(AppError::Conflict(msg.into()));
    }
    let audit_reason = validate_audit_reason(&payload.audit_reason)?;

    let mut tx = state.db.begin().await?;

    let updated = sqlx::query(
        "UPDATE plant_promotions
         SET status = $2, updated_by = $3, audit_reason = $4, updated_at = NOW()
         WHERE plant_id = $1
         RETURNING id",
    )
    .bind(plant_id)
    .bind(&status)
    .bind(admin.user.user_id)
    .bind(&audit_reason)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound("Promotion not found for this plant".into()))?;

    let promo_id: Uuid = updated.get("id");

    sqlx::query(
        "INSERT INTO audit_logs (user_id, action, resource_type, resource_id, metadata)
         VALUES ($1, 'plant_promotion.set_status', 'rmc_plant', $2, $3)",
    )
    .bind(admin.user.user_id)
    .bind(plant_id.to_string())
    .bind(json!({
        "promotion_id": promo_id,
        "status": status,
        "audit_reason": audit_reason,
    }))
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    Ok(Json(json!({
        "promotion_id": promo_id,
        "plant_id": plant_id,
        "status": status,
    })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cyclic_two_minute_rotation_matches_expected_sequence() {
        let base = vec![1, 2, 3, 4, 5];

        let mut b0 = base.clone();
        apply_two_minute_promotion_rotation(&mut b0, 0);
        assert_eq!(b0, vec![1, 2, 3, 4, 5]);

        let mut b1 = base.clone();
        apply_two_minute_promotion_rotation(&mut b1, 120);
        assert_eq!(b1, vec![5, 1, 2, 3, 4]);

        let mut b2 = base.clone();
        apply_two_minute_promotion_rotation(&mut b2, 240);
        assert_eq!(b2, vec![4, 5, 1, 2, 3]);

        let mut b3 = base.clone();
        apply_two_minute_promotion_rotation(&mut b3, 360);
        assert_eq!(b3, vec![3, 4, 5, 1, 2]);

        let mut b4 = base.clone();
        apply_two_minute_promotion_rotation(&mut b4, 480);
        assert_eq!(b4, vec![2, 3, 4, 5, 1]);

        let mut b5 = base.clone();
        apply_two_minute_promotion_rotation(&mut b5, 600);
        assert_eq!(b5, vec![1, 2, 3, 4, 5]);
    }

    #[test]
    fn rotation_handles_empty_and_single_plant() {
        let mut empty: Vec<i32> = vec![];
        apply_two_minute_promotion_rotation(&mut empty, 360);
        assert!(empty.is_empty());

        let mut single = vec![42];
        apply_two_minute_promotion_rotation(&mut single, 360);
        assert_eq!(single, vec![42]);
    }

    #[test]
    fn radius_and_audit_validation() {
        assert_eq!(validate_radius_km(30).unwrap(), 30);
        assert!(validate_radius_km(0).is_err());
        assert!(validate_radius_km(251).is_err());
        assert!(validate_audit_reason("short").is_err());
        assert!(validate_audit_reason("Approved 30 km top listing").is_ok());
    }
}
