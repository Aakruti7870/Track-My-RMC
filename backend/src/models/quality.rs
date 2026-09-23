use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct CubeTest {
    pub id: Uuid,
    pub order_id: Uuid,
    pub load_id: Option<Uuid>,
    pub sample_date: NaiveDate,
    pub test_interval_days: i32,
    pub test_date: NaiveDate,
    pub expected_strength_mpa: bigdecimal::BigDecimal,
    pub actual_strength_mpa: bigdecimal::BigDecimal,
    pub passed: bool,
    pub certificate_url: Option<String>,
    pub remarks: Option<String>,
    pub tested_by: Option<Uuid>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateCubeTestRequest {
    pub order_id: Uuid,
    pub load_id: Option<Uuid>,
    pub sample_date: NaiveDate,
    pub test_interval_days: i32,
    pub test_date: NaiveDate,
    pub expected_strength_mpa: f64,
    pub actual_strength_mpa: f64,
    pub remarks: Option<String>,
    pub certificate_url: Option<String>,
}
