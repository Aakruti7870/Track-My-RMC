use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct GpsTelemetry {
    pub id: i64,
    pub mixer_id: Uuid,
    pub driver_id: Option<Uuid>,
    pub load_id: Option<Uuid>,
    pub latitude: f64,
    pub longitude: f64,
    pub speed_kmh: bigdecimal::BigDecimal,
    pub heading: bigdecimal::BigDecimal,
    pub recorded_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct LocationUpdateRequest {
    pub mixer_id: Uuid,
    pub load_id: Option<Uuid>,
    pub latitude: f64,
    pub longitude: f64,
    pub speed: Option<f64>,
    pub heading: Option<f64>,
    pub timestamp: Option<DateTime<Utc>>,
}
