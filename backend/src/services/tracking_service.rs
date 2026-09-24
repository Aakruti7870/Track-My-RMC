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
        return Err(AppError::Forbidden("Driver is not assigned to this mixer".to_string()));
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
            )
            "#,
        )
        .bind(load_id)
        .bind(driver_id)
        .bind(req.mixer_id)
        .fetch_one(&state.db)
        .await?;

        if !owns_load {
            return Err(AppError::Forbidden("Load is not assigned to this driver and mixer".to_string()));
        }
    }

    telemetry_repo::insert_telemetry(
        &state.db,
        req.mixer_id,
        Some(driver_id),
        req.load_id,
        req.latitude,
        req.longitude,
        req.speed.unwrap_or(0.0),
        req.heading.unwrap_or(0.0),
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
