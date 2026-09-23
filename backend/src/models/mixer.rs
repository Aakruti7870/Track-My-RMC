use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct TransitMixer {
    pub id: Uuid,
    pub plant_id: Uuid,
    pub registration_number: String,
    pub capacity_m3: bigdecimal::BigDecimal,
    pub driver_id: Option<Uuid>,
    pub status: String,
    pub last_latitude: Option<f64>,
    pub last_longitude: Option<f64>,
    pub last_ping_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateMixerRequest {
    pub plant_id: Uuid,
    pub registration_number: String,
    pub capacity_m3: f64,
    pub driver_id: Option<Uuid>,
}
