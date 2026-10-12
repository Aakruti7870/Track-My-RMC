use crate::{
    auth::{middleware::check_role, AuthUser},
    error::AppError,
    models::{
        challan::{SignChallanRequest, SubmitPodRequest},
        telemetry::LocationUpdateRequest,
    },
    repositories::dispatch_repo,
    services::{dispatch_service, tracking_service},
    state::AppState,
};
use axum::{
    extract::{Path, State},
    response::IntoResponse,
    Json,
};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

pub async fn get_driver_trips(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["driver"])?;
    let trips = dispatch_repo::find_driver_active_trips(&state.db, auth_user.user_id).await?;
    Ok(Json(json!({ "success": true, "trips": trips })))
}

#[derive(Debug, Deserialize)]
pub struct DriverAttendanceLocation {
    pub lat: f64,
    pub lng: f64,
}

fn validate_attendance_location(payload: &DriverAttendanceLocation) -> Result<(), AppError> {
    if !payload.lat.is_finite()
        || !payload.lng.is_finite()
        || !(-90.0..=90.0).contains(&payload.lat)
        || !(-180.0..=180.0).contains(&payload.lng)
    {
        return Err(AppError::BadRequest(
            "A valid latitude and longitude are required".to_string(),
        ));
    }
    Ok(())
}

async fn resolve_driver_plant(state: &AppState, driver_id: Uuid) -> Result<Uuid, AppError> {
    let plant_ids: Vec<Uuid> = sqlx::query_scalar(
        r#"
        SELECT plant_id
        FROM (
            SELECT o.plant_id
            FROM order_loads ol
            JOIN orders o ON o.id = ol.order_id
            WHERE ol.driver_id = $1
              AND ol.status IN ('dispatched', 'arrived', 'pouring')
            UNION
            SELECT plant_id
            FROM transit_mixers
            WHERE driver_id = $1
        ) AS assigned_plants
        ORDER BY plant_id
        "#,
    )
    .bind(driver_id)
    .fetch_all(&state.db)
    .await?;

    match plant_ids.as_slice() {
        [plant_id] => Ok(*plant_id),
        [] => Err(AppError::NotFound(
            "No plant or transit mixer is assigned to this driver".to_string(),
        )),
        _ => Err(AppError::Conflict(
            "This driver is assigned to multiple plants; ask an administrator to correct the assignment"
                .to_string(),
        )),
    }
}

pub async fn get_driver_home(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["driver"])?;

    let row = sqlx::query_as::<_, (String, Option<String>, Option<String>, i64, bool)>(
        r#"
        SELECT
            u.full_name,
            (
                SELECT tm.registration_number
                FROM transit_mixers tm
                WHERE tm.driver_id = u.id
                ORDER BY tm.created_at DESC
                LIMIT 1
            ) AS vehicle,
            (
                SELECT jsonb_build_object(
                    'id', ol.id,
                    'order_number', o.order_number,
                    'status', ol.status,
                    'grade', o.concrete_grade,
                    'quantity', ol.quantity_m3::DOUBLE PRECISION,
                    'tm_number', COALESCE(tm.registration_number, ''),
                    'site_name', COALESCE(cs.name, '')
                )::text
                FROM order_loads ol
                JOIN orders o ON o.id = ol.order_id
                LEFT JOIN customer_sites cs ON cs.id = o.site_id
                LEFT JOIN transit_mixers tm ON tm.id = ol.mixer_id
                WHERE ol.driver_id = u.id
                  AND ol.status IN ('dispatched', 'arrived', 'pouring')
                ORDER BY ol.dispatched_at DESC NULLS LAST, ol.created_at DESC
                LIMIT 1
            ) AS active_trip,
            (
                SELECT COUNT(*)::BIGINT
                FROM proof_of_deliveries pod
                JOIN order_loads ol ON ol.id = pod.load_id
                WHERE ol.driver_id = u.id
                  AND pod.delivered_at >= date_trunc('day', NOW())
                  AND pod.delivered_at < date_trunc('day', NOW()) + INTERVAL '1 day'
            ) AS completed_today,
            EXISTS (
                SELECT 1
                FROM workforce_attendance wa
                WHERE wa.user_id = u.id
                  AND wa.attendance_date = CURRENT_DATE
                  AND wa.check_in_time IS NOT NULL
                  AND wa.check_out_time IS NULL
            ) AS checked_in
        FROM users u
        WHERE u.id = $1
          AND u.role = 'driver'
          AND u.is_active = TRUE
        "#,
    )
    .bind(auth_user.user_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Active driver account not found".to_string()))?;

    let active_trip = row.2.map(|trip| {
        serde_json::from_str::<Value>(&trip).map_err(|_| {
            AppError::InternalError("Failed to decode active driver trip".to_string())
        })
    }).transpose()?;

    Ok(Json(json!({
        "success": true,
        "name": row.0,
        "vehicle": row.1,
        "active_trip": active_trip,
        "completed_today": row.3,
        "checked_in": row.4
    })))
}

pub async fn get_driver_attendance(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["driver"])?;
    let today = Utc::now().date_naive();

    let attendance = sqlx::query_as::<_, (Option<DateTime<Utc>>, Option<DateTime<Utc>>)>(
        r#"
        SELECT check_in_time, check_out_time
        FROM workforce_attendance
        WHERE user_id = $1 AND attendance_date = $2
        ORDER BY created_at DESC
        LIMIT 1
        "#,
    )
    .bind(auth_user.user_id)
    .bind(today)
    .fetch_optional(&state.db)
    .await?
    .unwrap_or((None, None));

    Ok(Json(json!({
        "success": true,
        "date": today,
        "check_in": attendance.0,
        "check_out": attendance.1
    })))
}

pub async fn check_in_driver(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Json(payload): Json<DriverAttendanceLocation>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["driver"])?;
    validate_attendance_location(&payload)?;
    let plant_id = resolve_driver_plant(&state, auth_user.user_id).await?;
    let today = Utc::now().date_naive();

    let inserted = sqlx::query(
        r#"
        INSERT INTO workforce_attendance
            (plant_id, user_id, attendance_date, check_in_time, check_in_lat, check_in_lng, status)
        VALUES ($1, $2, $3, NOW(), $4, $5, 'present')
        ON CONFLICT (plant_id, user_id, attendance_date) DO NOTHING
        "#,
    )
    .bind(plant_id)
    .bind(auth_user.user_id)
    .bind(today)
    .bind(payload.lat)
    .bind(payload.lng)
    .execute(&state.db)
    .await?;

    if inserted.rows_affected() == 0 {
        return Err(AppError::Conflict(
            "Attendance already exists for today; contact the plant supervisor if it needs correction"
                .to_string(),
        ));
    }

    Ok(Json(json!({ "success": true, "message": "Checked in successfully" })))
}

pub async fn check_out_driver(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Json(payload): Json<DriverAttendanceLocation>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["driver"])?;
    validate_attendance_location(&payload)?;
    let plant_id = resolve_driver_plant(&state, auth_user.user_id).await?;
    let today = Utc::now().date_naive();

    let updated = sqlx::query(
        r#"
        UPDATE workforce_attendance
        SET check_out_time = NOW()
        WHERE plant_id = $1
          AND user_id = $2
          AND attendance_date = $3
          AND check_in_time IS NOT NULL
          AND check_out_time IS NULL
        "#,
    )
    .bind(plant_id)
    .bind(auth_user.user_id)
    .bind(today)
    .execute(&state.db)
    .await?;

    if updated.rows_affected() == 0 {
        let existing: Option<(Option<DateTime<Utc>>, Option<DateTime<Utc>>)> =
            sqlx::query_as(
                r#"
                SELECT check_in_time, check_out_time
                FROM workforce_attendance
                WHERE plant_id = $1 AND user_id = $2 AND attendance_date = $3
                LIMIT 1
                "#,
            )
            .bind(plant_id)
            .bind(auth_user.user_id)
            .bind(today)
            .fetch_optional(&state.db)
            .await?;

        return match existing {
            Some((Some(_), Some(_))) => Err(AppError::Conflict(
                "You have already checked out for today".to_string(),
            )),
            _ => Err(AppError::BadRequest(
                "Check in before checking out".to_string(),
            )),
        };
    }

    Ok(Json(json!({ "success": true, "message": "Checked out successfully" })))
}

pub async fn update_location(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Json(payload): Json<LocationUpdateRequest>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["driver"])?;
    tracking_service::record_driver_location(&state, auth_user.user_id, payload).await?;
    Ok(Json(
        json!({ "success": true, "message": "Location updated" }),
    ))
}

pub async fn sign_challan(
    State(state): State<AppState>,
    Path(load_id): Path<Uuid>,
    auth_user: AuthUser,
    Json(payload): Json<SignChallanRequest>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["driver"])?;
    dispatch_service::sign_digital_challan(&state, load_id, auth_user.user_id, payload).await?;
    Ok(Json(
        json!({ "success": true, "message": "Challan signed" }),
    ))
}

pub async fn submit_pod(
    State(state): State<AppState>,
    Path(load_id): Path<Uuid>,
    auth_user: AuthUser,
    Json(payload): Json<SubmitPodRequest>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["driver"])?;
    let pod = dispatch_service::complete_delivery_pod(&state, load_id, auth_user.user_id, payload)
        .await?;
    Ok(Json(json!({ "success": true, "pod": pod })))
}
