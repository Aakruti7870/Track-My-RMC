use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Order {
    pub id: Uuid,
    pub order_number: String,
    pub customer_id: Uuid,
    pub plant_id: Uuid,
    pub site_id: Uuid,
    pub concrete_grade: String,
    pub total_quantity_m3: bigdecimal::BigDecimal,
    pub delivery_date: NaiveDate,
    pub delivery_time_slot: String,
    pub pump_required: bool,
    pub special_instructions: Option<String>,
    pub total_amount: bigdecimal::BigDecimal,
    pub tax_amount: bigdecimal::BigDecimal,
    pub status: String,
    pub payment_status: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct OrderLoad {
    pub id: Uuid,
    pub order_id: Uuid,
    pub load_number: i32,
    pub mixer_id: Option<Uuid>,
    pub driver_id: Option<Uuid>,
    pub quantity_m3: bigdecimal::BigDecimal,
    pub status: String,
    pub batch_started_at: Option<DateTime<Utc>>,
    pub batch_completed_at: Option<DateTime<Utc>>,
    pub dispatched_at: Option<DateTime<Utc>>,
    pub arrived_at: Option<DateTime<Utc>>,
    pub pour_started_at: Option<DateTime<Utc>>,
    pub pour_completed_at: Option<DateTime<Utc>>,
    pub returned_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateOrderRequest {
    pub plant_id: Uuid,
    pub site_id: Uuid,
    pub concrete_grade: String,
    pub quantity_m3: f64,
    pub delivery_date: NaiveDate,
    pub delivery_time_slot: String,
    pub pump_required: Option<bool>,
    pub special_instructions: Option<String>,
    pub estimated_rate_per_m3: Option<f64>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateOrderStatusRequest {
    pub status: String,
    pub reason: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct AssignLoadRequest {
    pub order_id: Uuid,
    pub load_number: i32,
    pub mixer_id: Uuid,
    pub driver_id: Uuid,
    pub quantity_m3: f64,
}
