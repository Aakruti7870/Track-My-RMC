use crate::config::AppConfig;
use crate::services::otp_delivery::{OtpDelivery, ProviderOtpDelivery};
use sqlx::PgPool;
use std::sync::Arc;

#[derive(Clone)]
pub struct AppState {
    pub db: PgPool,
    pub config: Arc<AppConfig>,
    pub otp_delivery: Arc<dyn OtpDelivery>,
}

impl AppState {
    pub fn new(db: PgPool, config: AppConfig) -> Self {
        let otp_delivery = Arc::new(ProviderOtpDelivery::new(&config));
        Self {
            db,
            config: Arc::new(config),
            otp_delivery,
        }
    }
}
