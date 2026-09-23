use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "varchar")]
pub enum UserRole {
    #[serde(rename = "customer")]
    Customer,
    #[serde(rename = "driver")]
    Driver,
    #[serde(rename = "dispatcher")]
    Dispatcher,
    #[serde(rename = "operator")]
    Operator,
    #[serde(rename = "supervisor")]
    Supervisor,
    #[serde(rename = "quality_engineer")]
    QualityEngineer,
    #[serde(rename = "store_manager")]
    StoreManager,
    #[serde(rename = "accountant")]
    Accountant,
    #[serde(rename = "fleet_manager")]
    FleetManager,
    #[serde(rename = "owner")]
    Owner,
    #[serde(rename = "admin")]
    Admin,
}

impl std::fmt::Display for UserRole {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            UserRole::Customer => write!(f, "customer"),
            UserRole::Driver => write!(f, "driver"),
            UserRole::Dispatcher => write!(f, "dispatcher"),
            UserRole::Operator => write!(f, "operator"),
            UserRole::Supervisor => write!(f, "supervisor"),
            UserRole::QualityEngineer => write!(f, "quality_engineer"),
            UserRole::StoreManager => write!(f, "store_manager"),
            UserRole::Accountant => write!(f, "accountant"),
            UserRole::FleetManager => write!(f, "fleet_manager"),
            UserRole::Owner => write!(f, "owner"),
            UserRole::Admin => write!(f, "admin"),
        }
    }
}

impl From<&str> for UserRole {
    fn from(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "driver" => UserRole::Driver,
            "dispatcher" => UserRole::Dispatcher,
            "operator" => UserRole::Operator,
            "supervisor" => UserRole::Supervisor,
            "quality_engineer" => UserRole::QualityEngineer,
            "store_manager" => UserRole::StoreManager,
            "accountant" => UserRole::Accountant,
            "fleet_manager" => UserRole::FleetManager,
            "owner" => UserRole::Owner,
            "admin" | "super_admin" => UserRole::Admin,
            _ => UserRole::Customer,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct User {
    pub id: Uuid,
    pub phone: String,
    pub email: Option<String>,
    #[serde(skip_serializing)]
    pub hashed_password: String,
    pub full_name: String,
    pub role: String,
    pub is_active: bool,
    pub is_verified: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct UserProfile {
    pub id: Uuid,
    pub user_id: Uuid,
    pub business_name: Option<String>,
    pub gst_number: Option<String>,
    pub kyc_status: String,
    pub verified_name: Option<String>,
    pub address_line: Option<String>,
    pub city: Option<String>,
    pub state: Option<String>,
    pub pincode: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct RegisterRequest {
    pub phone: String,
    pub email: Option<String>,
    pub password: String,
    pub full_name: String,
    pub role: Option<String>,
    pub business_name: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub username_or_phone: String,
    pub password: String,
}

#[derive(Debug, Serialize)]
pub struct AuthResponse {
    pub success: bool,
    pub token: String,
    pub role: String,
    pub user: UserResponse,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UserResponse {
    pub id: Uuid,
    pub phone: String,
    pub email: Option<String>,
    pub full_name: String,
    pub role: String,
    pub kyc_status: String,
    pub verified_name: Option<String>,
}
