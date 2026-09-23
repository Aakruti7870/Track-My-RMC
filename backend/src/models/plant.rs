use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct RmcPlant {
    pub id: Uuid,
    pub owner_id: Uuid,
    pub name: String,
    pub code: String,
    pub latitude: f64,
    pub longitude: f64,
    pub address_line: String,
    pub city: String,
    pub state: String,
    pub pincode: String,
    pub contact_phone: String,
    pub contact_email: Option<String>,
    pub capacity_m3_per_hr: bigdecimal::BigDecimal,
    pub rating: bigdecimal::BigDecimal,
    pub is_active: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreatePlantRequest {
    pub name: String,
    pub code: String,
    pub latitude: f64,
    pub longitude: f64,
    pub address_line: String,
    pub city: String,
    pub state: String,
    pub pincode: String,
    pub contact_phone: String,
    pub contact_email: Option<String>,
    pub capacity_m3_per_hr: Option<f64>,
}

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct CustomerSite {
    pub id: Uuid,
    pub customer_id: Uuid,
    pub name: String,
    pub address_line: String,
    pub city: String,
    pub state: String,
    pub pincode: String,
    pub latitude: f64,
    pub longitude: f64,
    pub contact_person: String,
    pub contact_phone: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateSiteRequest {
    pub name: String,
    pub address_line: String,
    pub city: String,
    pub state: String,
    pub pincode: String,
    pub latitude: f64,
    pub longitude: f64,
    pub contact_person: String,
    pub contact_phone: String,
}
