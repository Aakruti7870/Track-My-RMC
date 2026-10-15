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
    pub fn validate_config(&self) -> Result<(), AppError> {
        if self
            .api_key
            .as_ref()
            .is_some_and(|key| !key.trim().is_empty())
            && !self.from_address.trim().is_empty()
        {
            Ok(())
        } else {
            Err(AppError::InternalError(
                "Email OTP service is not configured".into(),
            ))
        }
    }
    pub fn new(api_key: Option<String>, from_address: String) -> Self {
        Self {
            client: Client::builder()
                .timeout(std::time::Duration::from_secs(15))
                .build()
                .expect("HTTP client"),
            api_key,
            from_address,
        }
    }

    /// Dispatches Email OTP for staff, owner, and administrative authentication
    pub async fn send_otp(
        &self,
        recipient_email: &str,
        otp: &str,
        role_display: &str,
    ) -> Result<(), AppError> {
        self.validate_config()?;
        let api_key = self
            .api_key
            .as_deref()
            .expect("validated email configuration");

        // Standard transactional email dispatch endpoint
        let payload = json!({
            "From": self.from_address,
            "To": recipient_email,
            "Subject": format!("Your TrackMyRMC {} Verification Code", role_display),
            "TextBody": format!(
                "Hello,\n\nYour TrackMyRMC verification code is: {}\n\nThis code will expire in 5 minutes. Do not share this code with anyone.\n\nTrackMyRMC Security Team",
                otp
            ),
        });

        let response = self
            .client
            .post("https://api.postmarkapp.com/email")
            .header("X-Postmark-Server-Token", api_key)
            .header("Accept", "application/json")
            .json(&payload)
            .send()
            .await
            .map_err(|_| {
                error!("Failed to connect to email provider");
                AppError::InternalError(
                    "Email delivery service is temporarily unreachable".to_string(),
                )
            })?;

        if !response.status().is_success() {
            let status = response.status();
            error!(status = %status, "Email provider rejected OTP message");
            return Err(AppError::InternalError(
                "Failed to send email verification code. Please try again.".to_string(),
            ));
        }

        let receipt: serde_json::Value = response.json().await.map_err(|_| {
            AppError::InternalError("Email provider returned an invalid delivery receipt".into())
        })?;
        if receipt["ErrorCode"].as_i64() != Some(0)
            || receipt["MessageID"]
                .as_str()
                .is_none_or(|id| id.trim().is_empty())
        {
            return Err(AppError::InternalError(
                "Email provider did not accept the verification code".into(),
            ));
        }
        info!("Email OTP accepted by provider");
        Ok(())
    }
}
