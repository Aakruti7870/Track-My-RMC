//! Driver-facing Drop-offs; verified PODs are authoritative, vehicle log entries
//! are driver-reported observations (not invoice-grade fuel or repair approvals).
use crate::{
    auth::{middleware::check_role, AuthUser},
    error::AppError,
    state::AppState,
};
use axum::{
    extract::{Query, State},
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::Row;
use uuid::Uuid;

#[derive(Debug, Deserialize)]
pub struct PeriodQuery {
    period: Option<String>,
}

fn requested_period(period: Option<&str>) -> Result<&'static str, AppError> {
    match period.unwrap_or("daily") {
        "daily" => Ok("day"),
        "weekly" => Ok("week"),
        "monthly" => Ok("month"),
        _ => Err(AppError::BadRequest(
            "Period must be daily, weekly or monthly".into(),
        )),
    }
}

pub async fn overview(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Query(query): Query<PeriodQuery>,
) -> Result<Json<Value>, AppError> {
    check_role(&auth_user, &["driver"])?;
    let period = requested_period(query.period.as_deref())?;
    // ISO week / local calendar day / calendar month, using the plant's India timezone.
    let completed: i64 = sqlx::query_scalar(
        "SELECT COUNT(DISTINCT ol.id)::BIGINT FROM proof_of_deliveries pod
         JOIN order_loads ol ON ol.id = pod.load_id
         WHERE ol.driver_id = $1 AND pod.delivered_at >=
         (date_trunc($2, NOW() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata')",
    )
    .bind(auth_user.user_id)
    .bind(period)
    .fetch_one(&state.db)
    .await?;
    let row = sqlx::query(
        "SELECT
           SUM(diesel_litres) FILTER (WHERE entry_kind = 'diesel') AS diesel_litres,
           COUNT(*) FILTER (WHERE entry_kind = 'maintenance')::BIGINT AS maintenance_count
         FROM driver_vehicle_logs WHERE driver_id = $1 AND recorded_at >=
         (date_trunc($2, NOW() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata')",
    )
    .bind(auth_user.user_id)
    .bind(period)
    .fetch_one(&state.db)
    .await?;
    let odometer: Option<i64> = sqlx::query_scalar(
        "SELECT odometer_km FROM driver_vehicle_logs
         WHERE driver_id = $1 AND entry_kind = 'odometer' AND recorded_at >=
         (date_trunc($2, NOW() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata')
         ORDER BY recorded_at DESC, id DESC LIMIT 1",
    )
    .bind(auth_user.user_id)
    .bind(period)
    .fetch_optional(&state.db)
    .await?;
    let maintenance: Vec<Value> = sqlx::query_scalar(
        "SELECT jsonb_build_object('id', id, 'type', maintenance_type,
           'notes', notes, 'recorded_at', recorded_at, 'mixer_id', mixer_id)
         FROM driver_vehicle_logs WHERE driver_id = $1 AND entry_kind = 'maintenance'
         ORDER BY recorded_at DESC LIMIT 12",
    )
    .bind(auth_user.user_id)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(json!({
        "success": true, "period": query.period.unwrap_or("daily".into()),
        "completed_trips": completed, "diesel_litres": row.try_get::<Option<f64>, _>("diesel_litres")?,
        "odometer_km": odometer, "maintenance_count": row.try_get::<i64, _>("maintenance_count")?,
        "maintenance": maintenance,
        "source": { "completed_trips": "proof_of_deliveries", "vehicle_records": "driver_reported" }
    })))
}

#[derive(Debug, Deserialize)]
pub struct NewLog {
    kind: String,
    diesel_litres: Option<f64>,
    odometer_km: Option<i64>,
    maintenance_type: Option<String>,
    notes: Option<String>,
}

pub async fn record(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Json(input): Json<NewLog>,
) -> Result<Json<Value>, AppError> {
    check_role(&auth_user, &["driver"])?;
    let (litres, odometer, category): (Option<f64>, Option<i64>, Option<String>) =
        match input.kind.as_str() {
            "diesel"
                if input
                    .diesel_litres
                    .is_some_and(|v| v.is_finite() && v > 0.0 && v <= 1000.0)
                    && input.odometer_km.is_none()
                    && input.maintenance_type.is_none() =>
            {
                (input.diesel_litres, None, None)
            }
            "odometer"
                if input
                    .odometer_km
                    .is_some_and(|v| (0..=10_000_000).contains(&v))
                    && input.diesel_litres.is_none()
                    && input.maintenance_type.is_none() =>
            {
                (None, input.odometer_km, None)
            }
            "maintenance" if input.diesel_litres.is_none() && input.odometer_km.is_none() => {
                let allowed = [
                    "oil_change",
                    "puncture",
                    "coolant",
                    "urea",
                    "brakes",
                    "tyres",
                    "filter",
                    "service",
                    "other",
                ];
                let category = input.maintenance_type.as_deref().unwrap_or("");
                if !allowed.contains(&category) {
                    return Err(AppError::BadRequest(
                        "Choose a supported maintenance type".into(),
                    ));
                }
                (None, None, Some(category.to_string()))
            }
            _ => return Err(AppError::BadRequest("Invalid vehicle log fields".into())),
        };
    let notes = input
        .notes
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    if notes.as_ref().is_some_and(|s| s.chars().count() > 500) {
        return Err(AppError::BadRequest(
            "Notes must be at most 500 characters".into(),
        ));
    }
    // Deny ambiguous or missing current assignment rather than allowing client-
    // supplied plant/mixer IDs or leaking another plant's records.
    let mixers: Vec<(Uuid, Uuid)> = sqlx::query_as(
        "SELECT id, plant_id FROM transit_mixers WHERE driver_id = $1 ORDER BY id LIMIT 2",
    )
    .bind(auth_user.user_id)
    .fetch_all(&state.db)
    .await?;
    let (mixer_id, plant_id) = match mixers.as_slice() {
        [item] => *item,
        [] => return Err(AppError::NotFound("No assigned transit mixer".into())),
        _ => {
            return Err(AppError::Conflict(
                "Multiple assigned mixers; ask your fleet manager to resolve".into(),
            ))
        }
    };
    let id: Uuid = sqlx::query_scalar(
        "INSERT INTO driver_vehicle_logs
         (driver_id, mixer_id, plant_id, entry_kind, diesel_litres, odometer_km, maintenance_type, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id"
    ).bind(auth_user.user_id).bind(mixer_id).bind(plant_id).bind(&input.kind)
    .bind(litres).bind(odometer).bind(category).bind(notes)
    .fetch_one(&state.db).await?;
    Ok(Json(
        json!({ "success": true, "id": id, "source": "driver_reported" }),
    ))
}

#[cfg(test)]
mod tests {
    use super::requested_period;
    #[test]
    fn accepts_only_supported_calendar_periods() {
        assert!(requested_period(None).is_ok());
        for period in ["daily", "weekly", "monthly"] {
            assert!(requested_period(Some(period)).is_ok());
        }
        for period in ["", "all", "yearly", "week;drop"] {
            assert!(requested_period(Some(period)).is_err());
        }
    }
}
