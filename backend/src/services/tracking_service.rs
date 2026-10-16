use crate::{
    error::AppError,
    models::telemetry::{GpsTelemetry, LocationUpdateRequest},
    repositories::telemetry_repo,
    state::AppState,
};
use uuid::Uuid;

pub async fn record_driver_location(
    state: &AppState,
    driver_id: Uuid,
    req: LocationUpdateRequest,
) -> Result<(), AppError> {
    if req
        .timestamp
        .is_some_and(|at| at > chrono::Utc::now() + chrono::Duration::seconds(30))
    {
        return Err(AppError::BadRequest(
            "Location timestamp is in the future".into(),
        ));
    }
    // Unscoped mixer telemetry cannot safely be shared with a customer trip.
    if req.load_id.is_none() {
        return Err(AppError::BadRequest(
            "An active assigned load is required for delivery tracking".into(),
        ));
    }
    if !req.latitude.is_finite() || !(-90.0..=90.0).contains(&req.latitude) {
        return Err(AppError::BadRequest("Invalid latitude".to_string()));
    }
    if !req.longitude.is_finite() || !(-180.0..=180.0).contains(&req.longitude) {
        return Err(AppError::BadRequest("Invalid longitude".to_string()));
    }
    if let Some(speed) = req.speed {
        if !speed.is_finite() || speed < 0.0 {
            return Err(AppError::BadRequest("Invalid speed".to_string()));
        }
    }
    if let Some(heading) = req.heading {
        if !heading.is_finite() || !(0.0..360.0).contains(&heading) {
            return Err(AppError::BadRequest("Invalid heading".to_string()));
        }
    }

    let owns_mixer: bool = sqlx::query_scalar(
        r#"
        SELECT EXISTS(
            SELECT 1
            FROM transit_mixers
            WHERE id = $1
              AND driver_id = $2
        )
        "#,
    )
    .bind(req.mixer_id)
    .bind(driver_id)
    .fetch_one(&state.db)
    .await?;

    if !owns_mixer {
        return Err(AppError::Forbidden(
            "Driver is not assigned to this mixer".to_string(),
        ));
    }

    if let Some(load_id) = req.load_id {
        let owns_load: bool = sqlx::query_scalar(
            r#"
            SELECT EXISTS(
                SELECT 1
                FROM order_loads
                WHERE id = $1
                  AND driver_id = $2
                  AND mixer_id = $3
                  AND status IN ('en_route', 'arrived', 'pouring')
            )
            "#,
        )
        .bind(load_id)
        .bind(driver_id)
        .bind(req.mixer_id)
        .fetch_one(&state.db)
        .await?;

        if !owns_load {
            return Err(AppError::Forbidden(
                "Load is not assigned to this driver and mixer".to_string(),
            ));
        }
    }

    telemetry_repo::insert_telemetry(
        &state.db,
        crate::repositories::telemetry_repo::TelemetryInput {
            recorded_at: req.timestamp.unwrap_or_else(chrono::Utc::now),
            mixer_id: req.mixer_id,
            driver_id: Some(driver_id),
            load_id: req.load_id,
            lat: req.latitude,
            lng: req.longitude,
            speed: req.speed.unwrap_or(0.0),
            heading: req.heading.unwrap_or(0.0),
        },
    )
    .await?;

    Ok(())
}

pub async fn get_live_mixer_location(
    state: &AppState,
    mixer_id: Uuid,
) -> Result<Option<GpsTelemetry>, AppError> {
    telemetry_repo::get_latest_position(&state.db, mixer_id).await
}
