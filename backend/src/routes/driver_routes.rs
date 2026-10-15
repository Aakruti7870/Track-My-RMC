use crate::{
    auth::{middleware::check_role, AuthUser},
    error::AppError,
    models::{
        challan::{SignChallanRequest, SubmitPodRequest},
        telemetry::LocationUpdateRequest,
    },
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
use sqlx::Row;
use uuid::Uuid;

type AttendanceTimes = (Option<DateTime<Utc>>, Option<DateTime<Utc>>);

pub async fn get_driver_trips(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["driver"])?;
    let trips: Vec<Value> = sqlx::query_scalar(
        "SELECT jsonb_build_object(
            'id', l.id, 'order_number', o.order_number,
            'status', CASE l.status WHEN 'completed' THEN 'DELIVERED' WHEN 'pouring' THEN 'UNLOADING' ELSE UPPER(l.status) END,
            'grade', o.concrete_grade, 'quantity', l.quantity_m3::DOUBLE PRECISION,
            'tm_number', COALESCE(m.registration_number, ''), 'site_name', s.name)
         FROM order_loads l JOIN orders o ON o.id = l.order_id
         JOIN customer_sites s ON s.id = o.site_id
         LEFT JOIN transit_mixers m ON m.id = l.mixer_id
         WHERE l.driver_id = $1 ORDER BY l.created_at DESC LIMIT 500",
    ).bind(auth_user.user_id).fetch_all(&state.db).await?;
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
              AND ol.status IN ('dispatched', 'en_route', 'arrived', 'pouring')
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
                    'status', CASE ol.status WHEN 'pouring' THEN 'UNLOADING' ELSE UPPER(ol.status) END,
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
                  AND ol.status IN ('dispatched', 'en_route', 'arrived', 'pouring')
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

    let active_trip = row
        .2
        .map(|trip| {
            serde_json::from_str::<Value>(&trip).map_err(|_| {
                AppError::InternalError("Failed to decode active driver trip".to_string())
            })
        })
        .transpose()?;

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

    Ok(Json(
        json!({ "success": true, "message": "Checked in successfully" }),
    ))
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
        let existing: Option<AttendanceTimes> = sqlx::query_as(
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

    Ok(Json(
        json!({ "success": true, "message": "Checked out successfully" }),
    ))
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

pub async fn get_trip_details(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(trip_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["driver"])?;

    let row = sqlx::query(
        r#"
        SELECT l.id, l.load_number, l.quantity_m3, l.status,
               o.order_number, o.concrete_grade,
               COALESCE(tm.registration_number, '') AS tm_number,
               p.name as plant_name, p.address_line as plant_address,
               s.name as site_name, s.address_line as site_address,
               s.latitude as site_lat, s.longitude as site_lng,
               s.contact_person, s.contact_phone,
               (SELECT jsonb_build_object('receiver_name', pod.receiver_name,
                    'delivered_quantity', COALESCE(pod.delivered_quantity, l.quantity_m3)::DOUBLE PRECISION)
                FROM proof_of_deliveries pod WHERE pod.load_id = l.id) AS pod
        FROM order_loads l
        INNER JOIN orders o ON o.id = l.order_id
        LEFT JOIN transit_mixers tm ON tm.id = l.mixer_id
        INNER JOIN rmc_plants p ON p.id = o.plant_id
        INNER JOIN customer_sites s ON s.id = o.site_id
        WHERE l.id = $1 AND l.driver_id = $2
        "#,
    )
    .bind(trip_id)
    .bind(auth_user.user_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Trip not found".to_string()))?;

    let lid: Uuid = row.get("id");
    let lnum: i32 = row.get("load_number");
    let lqty: bigdecimal::BigDecimal = row.get("quantity_m3");
    let lstatus: String = row.get("status");
    let onum: String = row.get("order_number");
    let grade: String = row.get("concrete_grade");
    let pname: String = row.get("plant_name");
    let paddr: Option<String> = row.get("plant_address");
    let sname: String = row.get("site_name");
    let saddr: String = row.get("site_address");
    let slat: Option<f64> = row.get("site_lat");
    let slng: Option<f64> = row.get("site_lng");
    let cperson: Option<String> = row.get("contact_person");
    let cphone: Option<String> = row.get("contact_phone");

    Ok(Json(json!({
        "success": true,
        "pod": row.get::<Option<Value>, _>("pod"),
        "site_address": saddr,
        "trip": {
            "id": lid,
            "load_number": lnum,
            "order_number": onum,
            "grade": grade,
            "quantity_m3": lqty,
            "quantity": lqty.to_string().parse::<f64>().unwrap_or_default(),
            "tm_number": row.get::<String, _>("tm_number"),
            "site_name": sname,
            "site_address": saddr,
            "status": match lstatus.as_str() {
                "completed" => "DELIVERED".to_string(),
                "pouring" => "UNLOADING".to_string(),
                other => other.to_uppercase(),
            },
            "plant": {
                "name": pname,
                "address": paddr
            },
            "site": {
                "name": sname,
                "address": saddr,
                "lat": slat,
                "lng": slng,
                "contact_person": cperson,
                "contact_phone": cphone
            }
        }
    })))
}

pub async fn start_trip(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(trip_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["driver"])?;

    crate::services::trip_lifecycle::advance(
        &state.db,
        trip_id,
        auth_user.user_id,
        crate::services::trip_lifecycle::TripAction::Start,
    )
    .await?;

    Ok(Json(
        json!({ "success": true, "status": "EN_ROUTE", "message": "Trip started" }),
    ))
}

pub async fn arrive_trip(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(trip_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["driver"])?;

    crate::services::trip_lifecycle::advance(
        &state.db,
        trip_id,
        auth_user.user_id,
        crate::services::trip_lifecycle::TripAction::Arrive,
    )
    .await?;

    Ok(Json(
        json!({ "success": true, "status": "ARRIVED", "message": "Arrived at delivery site" }),
    ))
}

pub async fn unload_trip(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(trip_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["driver"])?;

    crate::services::trip_lifecycle::advance(
        &state.db,
        trip_id,
        auth_user.user_id,
        crate::services::trip_lifecycle::TripAction::Unload,
    )
    .await?;

    Ok(Json(
        json!({ "success": true, "status": "UNLOADING", "message": "Pouring commenced" }),
    ))
}

#[derive(Debug, Deserialize)]
pub struct DriverSosPayload {
    pub lat: f64,
    pub lng: f64,
    pub alert_type: Option<String>,
    pub message: Option<String>,
    pub trip_id: Option<Uuid>,
}

pub async fn trigger_driver_sos(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Json(payload): Json<DriverSosPayload>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["driver"])?;

    let alert_type = payload
        .alert_type
        .unwrap_or_else(|| "EMERGENCY".to_string());

    let id: Uuid = sqlx::query_scalar(
        r#"
        INSERT INTO driver_sos_alerts (driver_id, load_id, latitude, longitude, alert_type, message, status)
        VALUES ($1, $2, $3, $4, $5, $6, 'OPEN')
        RETURNING id
        "#,
    )
    .bind(auth_user.user_id)
    .bind(payload.trip_id)
    .bind(payload.lat)
    .bind(payload.lng)
    .bind(&alert_type)
    .bind(&payload.message)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(json!({
        "success": true,
        "sos_id": id,
        "status": "OPEN",
        "message": "Emergency SOS broadcasted to plant operations"
    })))
}

pub async fn get_driver_sos_status(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["driver"])?;

    let alert = sqlx::query(
        r#"
        SELECT id, alert_type, status, created_at, resolved_at
        FROM driver_sos_alerts
        WHERE driver_id = $1 AND status != 'RESOLVED'
        ORDER BY created_at DESC
        LIMIT 1
        "#,
    )
    .bind(auth_user.user_id)
    .fetch_optional(&state.db)
    .await?;

    let active_sos = alert.map(|a| {
        let aid: Uuid = a.get("id");
        let atype: String = a.get("alert_type");
        let astatus: String = a.get("status");
        let acrt: chrono::DateTime<chrono::Utc> = a.get("created_at");
        json!({
            "id": aid,
            "alert_type": atype,
            "status": astatus,
            "created_at": acrt
        })
    });

    Ok(Json(json!({
        "success": true,
        "active_sos": active_sos
    })))
}

#[derive(Debug, Deserialize)]
pub struct TripLocationPayload {
    pub lat: f64,
    pub lng: f64,
}

pub async fn update_trip_location(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(trip_id): Path<Uuid>,
    Json(payload): Json<TripLocationPayload>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["driver"])?;
    let mixer_id: Option<Uuid> = sqlx::query_scalar(
        "SELECT mixer_id FROM order_loads WHERE id = $1 AND driver_id = $2
         AND status IN ('en_route', 'arrived', 'pouring')",
    )
    .bind(trip_id)
    .bind(auth_user.user_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Active assigned trip not found".to_string()))?;
    let mixer_id = mixer_id.ok_or_else(|| AppError::Conflict("Trip has no mixer".to_string()))?;
    tracking_service::record_driver_location(
        &state,
        auth_user.user_id,
        LocationUpdateRequest {
            mixer_id,
            load_id: Some(trip_id),
            latitude: payload.lat,
            longitude: payload.lng,
            speed: None,
            heading: None,
            timestamp: None,
        },
    )
    .await?;
    Ok(Json(json!({"success": true})))
}
