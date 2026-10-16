use crate::{error::AppError, models::telemetry::GpsTelemetry};
use bigdecimal::BigDecimal;
use bigdecimal::FromPrimitive;
use sqlx::PgPool;
use uuid::Uuid;

pub struct TelemetryInput {
    pub recorded_at: chrono::DateTime<chrono::Utc>,
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
        recorded_at,
        mixer_id,
        driver_id,
        load_id,
        lat,
        lng,
        speed,
        heading,
    } = input;
    let mut tx = pool.begin().await?;

    let inserted = sqlx::query(
        r#"
        INSERT INTO gps_telemetry (mixer_id, driver_id, load_id, latitude, longitude, speed_kmh, heading, recorded_at)
        SELECT $1, $2, $3, $4, $5, $6, $7, $8
        WHERE EXISTS (SELECT 1 FROM order_loads l JOIN transit_mixers m ON m.id=l.mixer_id
            WHERE l.id=$3 AND l.mixer_id=$1 AND l.driver_id=$2 AND m.driver_id=$2
              AND l.status IN ('en_route','arrived','pouring'))
        "#,
    )
    .bind(mixer_id)
    .bind(driver_id)
    .bind(load_id)
    .bind(lat)
    .bind(lng)
    .bind(BigDecimal::from_f64(speed).unwrap_or_default())
    .bind(BigDecimal::from_f64(heading).unwrap_or_default())
    .bind(recorded_at)
    .execute(&mut *tx)
    .await?;
    if inserted.rows_affected() == 0 {
        return Err(AppError::Forbidden(
            "The assigned trip is no longer active".into(),
        ));
    }

    sqlx::query(
        r#"
        UPDATE transit_mixers
        SET last_latitude = $1, last_longitude = $2, last_ping_at = $4
        WHERE id = $3 AND (last_ping_at IS NULL OR last_ping_at <= $4)
        "#,
    )
    .bind(lat)
    .bind(lng)
    .bind(mixer_id)
    .bind(recorded_at)
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
