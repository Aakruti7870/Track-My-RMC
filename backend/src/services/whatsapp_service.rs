use crate::error::AppError;
use reqwest::Client;
use serde_json::json;
use tracing::{error, info};

pub struct WhatsAppService {
    client: Client,
    token: Option<String>,
    phone_number_id: Option<String>,
    api_version: String,
}

impl WhatsAppService {
    pub fn validate_config(&self) -> Result<(), AppError> {
        match (&self.token, &self.phone_number_id) {
            (Some(token), Some(phone_number_id))
                if !token.trim().is_empty() && !phone_number_id.trim().is_empty() =>
            {
                Ok(())
            }
            _ => {
                error!("Meta WhatsApp credentials are missing");
                Err(AppError::InternalError(
                    "WhatsApp OTP service is not configured".to_string(),
                ))
            }
        }
    }

    pub fn new(
        token: Option<String>,
        phone_number_id: Option<String>,
        api_version: String,
    ) -> Self {
        Self {
            client: Client::builder()
                .timeout(std::time::Duration::from_secs(15))
                .build()
                .expect("HTTP client"),
            token,
            phone_number_id,
            api_version,
        }
    }

    /// Normalizes mobile numbers to E.164 format without '+' for Meta WhatsApp API.
    pub fn normalize_phone(phone: &str) -> String {
        let clean: String = phone.chars().filter(|c| c.is_ascii_digit()).collect();
        if clean.len() == 10 {
            format!("91{}", clean)
        } else {
            clean
        }
    }

    /// Dispatches WhatsApp OTP message via Meta WhatsApp Cloud API.
    pub async fn send_otp(&self, recipient_phone: &str, otp: &str) -> Result<(), AppError> {
        let recipient = Self::normalize_phone(recipient_phone);

        if !(10..=15).contains(&recipient.len()) || !recipient.chars().all(|c| c.is_ascii_digit()) {
            return Err(AppError::InternalError(
                "Invalid WhatsApp recipient number".to_string(),
            ));
        }

        let (token, phone_number_id) = match (&self.token, &self.phone_number_id) {
            (Some(t), Some(pid)) if !t.trim().is_empty() && !pid.trim().is_empty() => (t, pid),
            _ => {
                error!("Meta WhatsApp credentials are missing");
                return Err(AppError::InternalError(
                    "WhatsApp OTP service is not configured".to_string(),
                ));
            }
        };

        let url = format!(
            "https://graph.facebook.com/{}/{}/messages",
            self.api_version, phone_number_id
        );

        // The approved template body is:
        // "OTP Code: {{1}}. This is your OTP code for {{2}}. ..."
        // {{1}} is the generated OTP; {{2}} is the login context.
        let payload = json!({
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": recipient,
            "type": "template",
            "template": {
                "name": "trackmyrmc_login_otp",
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
                            },
                            {
                                "type": "text",
                                "text": "Login"
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
                                "text": "COPY_CODE"
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
            .map_err(|_| {
                error!("Failed to connect to Meta WhatsApp Cloud API");
                AppError::InternalError(
                    "WhatsApp delivery service is temporarily unreachable".to_string(),
                )
            })?;

        if !response.status().is_success() {
            let status = response.status();
            error!(status = %status, "Meta WhatsApp Cloud API rejected message");
            return Err(AppError::InternalError(
                "Failed to send WhatsApp verification code. Please try again.".to_string(),
            ));
        }

        info!("WhatsApp OTP accepted by Meta Cloud API");
        Ok(())
    }
    /// Utility dispatch only. The Meta template must already be approved with
    /// six positional body parameters in this precise order:
    /// plant, order, grade, quantity, mixer, secure tracking URL.
    /// Never reuse the login OTP or promotional marketing template.
    pub async fn send_dispatch_template(
        &self,
        recipient: &str,
        params: &[&str; 6],
    ) -> Result<String, String> {
        let template_name = std::env::var("META_DISPATCH_TEMPLATE_NAME")
            .map_err(|_| "dispatch_template_not_configured".to_string())?;
        if template_name.is_empty()
            || template_name.len() > 120
            || !template_name
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
        {
            return Err("dispatch_template_name_invalid".into());
        }
        let (Some(token), Some(number_id)) = (&self.token, &self.phone_number_id) else {
            return Err("meta_sender_not_configured".into());
        };
        if token.trim().is_empty()
            || number_id.is_empty()
            || !number_id.bytes().all(|byte| byte.is_ascii_digit())
        {
            return Err("meta_sender_not_configured".into());
        }
        let to = Self::normalize_phone(recipient);
        if !(10..=15).contains(&to.len()) || !to.bytes().all(|byte| byte.is_ascii_digit()) {
            return Err("invalid_recipient".into());
        }
        let payload = json!({
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": to,
            "type": "template",
            "template": {
                "name": template_name,
                "language": {
                    "code": std::env::var("META_DISPATCH_TEMPLATE_LOCALE")
                        .unwrap_or_else(|_| "en_US".to_string())
                },
                "components": [{
                    "type": "body",
                    "parameters": params.iter().map(|text| json!({
                        "type": "text", "text": text
                    })).collect::<Vec<_>>()
                }]
            }
        });
        let url = format!(
            "https://graph.facebook.com/{}/{}/messages",
            self.api_version, number_id
        );
        let response = self
            .client
            .post(url)
            .bearer_auth(token)
            .json(&payload)
            .send()
            .await
            .map_err(|_| "provider_outcome_unknown".to_string())?;
        if !response.status().is_success() {
            // No customer phone, token, URL, or response body enters the logs.
            let status = response.status();
            tracing::warn!(status = %status, "Meta rejected dispatch utility template");
            return Err(format!("provider_http_{}", status.as_u16()));
        }
        let body: serde_json::Value = response
            .json()
            .await
            .map_err(|_| "provider_response_unknown".to_string())?;
        let message_id = body["messages"][0]["id"]
            .as_str()
            .filter(|id| id.starts_with("wamid.") && id.len() < 200)
            .ok_or_else(|| "provider_message_id_missing".to_string())?;
        Ok(message_id.to_string())
    }

}
