use crate::error::AppError;
use reqwest::Client;
use serde_json::json;
use tracing::{error, info};

pub struct EmailService {
    client: Client,
    api_key: Option<String>,
    from_address: String,
}

impl EmailService {
    pub fn new(api_key: Option<String>, from_address: String) -> Self {
        Self {
            client: Client::new(),
            api_key,
            from_address,
        }
    }

    /// Dispatches Email OTP for staff, owner, and administrative authentication
    pub async fn send_otp(&self, recipient_email: &str, otp: &str, role_display: &str) -> Result<(), AppError> {
        let api_key = match &self.api_key {
            Some(key) if !key.is_empty() => key,
            _ => {
                info!(
                    recipient = %recipient_email,
                    role = %role_display,
                    "Email API key not configured. Mocking Email OTP dispatch in development mode"
                );
                return Ok(());
            }
        };

        // Standard transactional email dispatch endpoint
        let payload = json!({
            "from": self.from_address,
            "to": recipient_email,
            "subject": format!("Your TrackMyRMC {} Verification Code", role_display),
            "text": format!(
                "Hello,\n\nYour TrackMyRMC verification code is: {}\n\nThis code will expire in 5 minutes. Do not share this code with anyone.\n\nTrackMyRMC Security Team",
                otp
            ),
        });

        let response = self
            .client
            .post("https://api.postmarkapp.com/email")
            .header("X-Postmark-Server-Token", api_key)
            .json(&payload)
            .send()
            .await
            .map_err(|e| {
                error!(error = ?e, "Failed to connect to email provider");
                AppError::InternalError("Email delivery service is temporarily unreachable".to_string())
            })?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            error!(status = %status, response = %body, "Email provider rejected OTP message");
            return Err(AppError::InternalError(
                "Failed to send email verification code. Please try again.".to_string(),
            ));
        }

        info!(recipient = %recipient_email, "Email OTP successfully dispatched");
        Ok(())
    }
}
