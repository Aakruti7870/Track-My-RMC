use crate::{error::AppError, models::telemetry::GpsTelemetry};
use bigdecimal::BigDecimal;
use bigdecimal::FromPrimitive;
use sqlx::PgPool;
use uuid::Uuid;

pub struct TelemetryInput {
    pub mixer_id: Uuid,
    pub driver_id: Option<Uuid>,
    pub load_id: Option<Uuid>,
    pub lat: f64,
    pub lng: f64,
    pub speed: f64,
    pub heading: f64,
}

pub async fn insert_telemetry(pool: &PgPool, input: TelemetryInput) -> Result<(), AppError> {
    let TelemetryInput {
        mixer_id,
        driver_id,
        load_id,
        lat,
        lng,
        speed,
        heading,
    } = input;
    let mut tx = pool.begin().await?;

    sqlx::query(
        r#"
        INSERT INTO gps_telemetry (mixer_id, driver_id, load_id, latitude, longitude, speed_kmh, heading, recorded_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
        "#,
    )
    .bind(mixer_id)
    .bind(driver_id)
    .bind(load_id)
    .bind(lat)
    .bind(lng)
    .bind(BigDecimal::from_f64(speed).unwrap_or_default())
    .bind(BigDecimal::from_f64(heading).unwrap_or_default())
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        r#"
        UPDATE transit_mixers
        SET last_latitude = $1, last_longitude = $2, last_ping_at = NOW()
        WHERE id = $3
        "#,
    )
    .bind(lat)
    .bind(lng)
    .bind(mixer_id)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(())
}

pub async fn get_latest_position(
    pool: &PgPool,
    mixer_id: Uuid,
) -> Result<Option<GpsTelemetry>, AppError> {
    let pos = sqlx::query_as::<_, GpsTelemetry>(
        r#"
        SELECT id, mixer_id, driver_id, load_id, latitude, longitude, speed_kmh, heading, recorded_at
        FROM gps_telemetry
        WHERE mixer_id = $1
        ORDER BY recorded_at DESC
        LIMIT 1
        "#,
    )
    .bind(mixer_id)
    .fetch_optional(pool)
    .await?;

    Ok(pos)
}
