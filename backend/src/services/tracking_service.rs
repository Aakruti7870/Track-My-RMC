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
