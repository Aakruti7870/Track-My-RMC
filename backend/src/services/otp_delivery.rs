use crate::{config::AppConfig, error::AppError};
use axum::async_trait;

use super::{email_service::EmailService, whatsapp_service::WhatsAppService};

/// Delivery dependency. Tests can inject an in-memory transport without an HTTP
/// bypass, environment flag, fixed code, or change to OTP verification.
#[async_trait]
pub trait OtpDelivery: Send + Sync {
    fn validate(&self, channel: &str) -> Result<(), AppError>;
    async fn send(
        &self,
        channel: &str,
        destination: &str,
        otp: &str,
        context: &str,
    ) -> Result<(), AppError>;
}

pub struct ProviderOtpDelivery {
    email: EmailService,
    whatsapp: WhatsAppService,
}

impl ProviderOtpDelivery {
    pub fn new(config: &AppConfig) -> Self {
        Self {
            email: EmailService::new(
                config.email_api_key.clone(),
                config.email_from_address.clone(),
            ),
            whatsapp: WhatsAppService::new(
                config.meta_whatsapp_token.clone(),
                config.meta_whatsapp_phone_number_id.clone(),
                config.meta_graph_api_version.clone(),
            ),
        }
    }
}

#[async_trait]
impl OtpDelivery for ProviderOtpDelivery {
    fn validate(&self, channel: &str) -> Result<(), AppError> {
        match channel {
            "email" => self.email.validate_config(),
            "whatsapp" => self.whatsapp.validate_config(),
            _ => Err(AppError::BadRequest("Unsupported OTP channel".into())),
        }
    }

    async fn send(
        &self,
        channel: &str,
        destination: &str,
        otp: &str,
        context: &str,
    ) -> Result<(), AppError> {
        match channel {
            "email" => self.email.send_otp(destination, otp, context).await,
            "whatsapp" => self.whatsapp.send_otp(destination, otp).await,
            _ => Err(AppError::BadRequest("Unsupported OTP channel".into())),
        }
    }
}
