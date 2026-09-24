use crate::error::AppError;
use reqwest::Client;
use serde_json::json;
use tracing::{error, info};

pub struct WhatsAppService {
    client: Client,
    token: Option<String>,
    phone_number_id: Option<String>,
}

impl WhatsAppService {
    pub fn new(token: Option<String>, phone_number_id: Option<String>) -> Self {
        Self {
            client: Client::new(),
            token,
            phone_number_id,
        }
    }

    /// Normalizes mobile numbers to E.164 format without '+' for Meta WhatsApp API.
    pub fn normalize_phone(phone: &str) -> String {
        let clean: String = phone.chars().filter(|c| c.is_ascii_digit()).collect();
        if clean.len() == 10 {
            format!("91{}", clean) // Default to India country code 91
        } else {
            clean
        }
    }

    /// Dispatches WhatsApp OTP message via Meta WhatsApp Cloud API
    pub async fn send_otp(&self, recipient_phone: &str, otp: &str) -> Result<(), AppError> {
        let recipient = Self::normalize_phone(recipient_phone);

        let (token, phone_number_id) = match (&self.token, &self.phone_number_id) {
            (Some(t), Some(pid)) if !t.is_empty() && !pid.is_empty() => (t, pid),
            _ => {
                info!(
                    recipient = %recipient,
                    "Meta WhatsApp credentials not configured. Mocking OTP dispatch in non-production mode"
                );
                return Ok(());
            }
        };

        let url = format!(
            "https://graph.facebook.com/v20.0/{}/messages",
            phone_number_id
        );

        // Approved Meta authentication template: login_code.
        // The template shown in WhatsApp Manager uses the OTP body variable
        // and the Copy code authentication button.
        let payload = json!({
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": recipient,
            "type": "template",
            "template": {
                "name": "login_code",
                "language": {
                    "code": "en_US"
                },
                "components": [
                    {
                        "type": "body",
                        "parameters": [
                            {
                                "type": "text",
                                "text": otp
                            }
                        ]
                    },
                    {
                        "type": "button",
                        "sub_type": "url",
                        "index": "0",
                        "parameters": [
                            {
                                "type": "text",
                                "text": otp
                            }
                        ]
                    }
                ]
            }
        });

        let response = self
            .client
            .post(&url)
            .bearer_auth(token)
            .json(&payload)
            .send()
            .await
            .map_err(|e| {
                error!(error = ?e, "Failed to connect to Meta WhatsApp Cloud API");
                AppError::InternalError("WhatsApp delivery service is temporarily unreachable".to_string())
            })?;

        if !response.status().is_success() {
            let status = response.status();
            let err_body = response.text().await.unwrap_or_default();
            error!(status = %status, response = %err_body, "Meta WhatsApp Cloud API rejected message");
            return Err(AppError::InternalError(
                "Failed to send WhatsApp verification code. Please try again.".to_string(),
            ));
        }

        info!(recipient = %recipient, "WhatsApp OTP successfully dispatched via Meta Cloud API");
        Ok(())
    }
}
