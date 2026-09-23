use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Challan {
    pub id: Uuid,
    pub load_id: Uuid,
    pub challan_number: String,
    pub plant_code: String,
    pub customer_name: String,
    pub site_address: String,
    pub concrete_grade: String,
    pub quantity_m3: bigdecimal::BigDecimal,
    pub slump_mm: i32,
    pub water_cement_ratio: bigdecimal::BigDecimal,
    pub batch_time: DateTime<Utc>,
    pub mixer_number: String,
    pub driver_name: String,
    pub digital_signature: Option<String>,
    pub receiver_name: Option<String>,
    pub receiver_phone: Option<String>,
    pub status: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct ProofOfDelivery {
    pub id: Uuid,
    pub load_id: Uuid,
    pub receiver_name: String,
    pub receiver_phone: String,
    pub signature_url: Option<String>,
    pub photo_url: Option<String>,
    pub notes: Option<String>,
    pub delivered_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct SignChallanRequest {
    pub receiver_name: String,
    pub receiver_phone: String,
    pub digital_signature: String,
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SubmitPodRequest {
    pub receiver_name: String,
    pub receiver_phone: String,
    pub signature_url: Option<String>,
    pub photo_url: Option<String>,
    pub notes: Option<String>,
}
