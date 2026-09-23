use chrono::{DateTime, NaiveDate, NaiveTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct WorkforceShift {
    pub id: Uuid,
    pub plant_id: Uuid,
    pub name: String,
    pub start_time: NaiveTime,
    pub end_time: NaiveTime,
    pub is_night_shift: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct WorkforceAttendance {
    pub id: Uuid,
    pub plant_id: Uuid,
    pub user_id: Uuid,
    pub attendance_date: NaiveDate,
    pub shift_id: Option<Uuid>,
    pub check_in_time: Option<DateTime<Utc>>,
    pub check_out_time: Option<DateTime<Utc>>,
    pub status: String,
    pub check_in_lat: Option<f64>,
    pub check_in_lng: Option<f64>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct MarkAttendanceRequest {
    pub user_id: Option<Uuid>,
    pub plant_id: Uuid,
    pub check_type: String, // "in" | "out"
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct PayrollClosure {
    pub id: Uuid,
    pub plant_id: Uuid,
    pub month: i32,
    pub year: i32,
    pub total_gross: bigdecimal::BigDecimal,
    pub total_net: bigdecimal::BigDecimal,
    pub employee_count: i32,
    pub is_closed: bool,
    pub closed_at: Option<DateTime<Utc>>,
    pub closed_by: Option<Uuid>,
    pub override_reason: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct PayrollRecord {
    pub id: Uuid,
    pub closure_id: Uuid,
    pub user_id: Uuid,
    pub basic_pay: bigdecimal::BigDecimal,
    pub allowances: bigdecimal::BigDecimal,
    pub deductions: bigdecimal::BigDecimal,
    pub net_pay: bigdecimal::BigDecimal,
    pub payment_status: String,
    pub transaction_ref: Option<String>,
    pub created_at: DateTime<Utc>,
}
