use crate::error::AppError;
use reqwest::Client;
use serde_json::json;
use tracing::{error, info};

const RESEND_EMAIL_URL: &str = "https://api.resend.com/emails";

pub struct EmailService {
    client: Client,
    api_key: Option<String>,
    from_address: String,
}

impl EmailService {
    pub fn validate_config(&self) -> Result<(), AppError> {
        if self
            .api_key
            .as_deref()
            .is_some_and(|key| key.starts_with("re_") && key.len() > 3 && key.trim() == key)
            && !self.from_address.trim().is_empty()
        {
            Ok(())
        } else {
            Err(AppError::InternalError(
                "Resend email OTP service is not configured".into(),
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

    /// Send staff/owner/Central Admin OTP without changing challenge, expiry,
    /// consumption or MFA rules. Only the mail transport is Resend-specific.
    pub async fn send_otp(
        &self,
        recipient_email: &str,
        otp: &str,
        role_display: &str,
    ) -> Result<(), AppError> {
        self.send_otp_to(RESEND_EMAIL_URL, recipient_email, otp, role_display)
            .await
    }

    // Local-only endpoint injection keeps provider contract tests isolated.
    // Production always calls RESEND_EMAIL_URL.
    async fn send_otp_to(
        &self,
        endpoint: &str,
        recipient_email: &str,
        otp: &str,
        role_display: &str,
    ) -> Result<(), AppError> {
        self.validate_config()?;
        let api_key = self
            .api_key
            .as_deref()
            .expect("validated Resend configuration");

        let payload = json!({
            "from": self.from_address,
            "to": [recipient_email],
            "subject": format!("Your TrackMyRMC {} Verification Code", role_display),
            "text": format!(
                "Hello,\n\nYour TrackMyRMC verification code is: {}\n\nThis code will expire in 5 minutes. Do not share this code with anyone.\n\nTrackMyRMC Security Team",
                otp
            ),
        });

        let response = self
            .client
            .post(endpoint)
            .bearer_auth(api_key)
            .header("Accept", "application/json")
            .json(&payload)
            .send()
            .await
            .map_err(|_| {
                error!("Failed to connect to Resend email API");
                AppError::InternalError(
                    "Email delivery service is temporarily unreachable".to_string(),
                )
            })?;

        if !response.status().is_success() {
            let status = response.status();
            // Provider bodies can contain addresses and validation details; do
            // not log them, the API key, the recipient or the generated OTP.
            error!(status = %status, "Resend rejected OTP message");
            return Err(AppError::InternalError(
                "Failed to send email verification code. Please try again.".to_string(),
            ));
        }

        let receipt: serde_json::Value = response.json().await.map_err(|_| {
            AppError::InternalError("Email provider returned an invalid delivery receipt".into())
        })?;
        if receipt["id"]
            .as_str()
            .is_none_or(|id| id.trim().is_empty())
        {
            return Err(AppError::InternalError(
                "Email provider did not accept the verification code".into(),
            ));
        }

        info!("Resend accepted OTP email for delivery");
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        http::{header, HeaderMap, StatusCode},
        routing::post,
        Json, Router,
    };
    use std::sync::{Arc, Mutex};

    type Captured = Arc<Mutex<Vec<(HeaderMap, serde_json::Value)>>>;

    async fn stub_resend(
        status: StatusCode,
        response_body: &'static str,
    ) -> (String, Captured, tokio::task::JoinHandle<()>) {
        let received: Captured = Arc::new(Mutex::new(Vec::new()));
        let captured = received.clone();
        let app = Router::new().route(
            "/emails",
            post(move |headers: HeaderMap, Json(payload): Json<serde_json::Value>| {
                let captured = captured.clone();
                async move {
                    captured.lock().unwrap().push((headers, payload));
                    (
                        status,
                        [(header::CONTENT_TYPE, "application/json")],
                        response_body,
                    )
                }
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .unwrap();
        let endpoint = format!("http://{}/emails", listener.local_addr().unwrap());
        let task = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        (endpoint, received, task)
    }

    #[tokio::test]
    async fn resend_uses_bearer_and_lowercase_fields_and_accepts_id() {
        let (endpoint, captured, task) =
            stub_resend(StatusCode::OK, r#"{"id":"test-email-id"}"#).await;
        let service = EmailService::new(
            Some("re_synthetic_test_only".into()),
            "noreply@trackmyrmc.com".into(),
        );
        let result = service
            .send_otp_to(
                &endpoint,
                "recipient@example.invalid",
                "123456",
                "Central Admin Portal",
            )
            .await;
        task.abort();
        assert!(result.is_ok(), "valid Resend receipt must be accepted");
        let calls = captured.lock().unwrap();
        assert_eq!(calls.len(), 1);
        let (headers, body) = &calls[0];
        assert_eq!(
            headers[header::AUTHORIZATION].to_str().unwrap(),
            "Bearer re_synthetic_test_only"
        );
        assert!(headers.get("X-Postmark-Server-Token").is_none());
        assert_eq!(body["from"], "noreply@trackmyrmc.com");
        assert_eq!(body["to"], json!(["recipient@example.invalid"]));
        assert_eq!(
            body["subject"],
            "Your TrackMyRMC Central Admin Portal Verification Code"
        );
        assert!(body["text"].as_str().unwrap().contains("123456"));
        assert!(body.get("From").is_none());
        assert!(body.get("TextBody").is_none());
    }

    #[tokio::test]
    async fn resend_rejected_request_fails_closed_without_disclosing_details() {
        let (endpoint, received, task) = stub_resend(
            StatusCode::UNAUTHORIZED,
            r#"{"message":"synthetic provider secret","name":"invalid_api_key"}"#,
        )
        .await;
        let service = EmailService::new(
            Some("re_synthetic_test_only".into()),
            "noreply@trackmyrmc.com".into(),
        );
        let error = service
            .send_otp_to(&endpoint, "recipient@example.invalid", "123456", "Staff")
            .await
            .err()
            .expect("provider rejection must fail");
        task.abort();
        assert_eq!(received.lock().unwrap().len(), 1);
        let message = format!("{error:?}");
        assert!(!message.contains("synthetic provider secret"));
        assert!(!message.contains("re_synthetic_test_only"));
        assert!(!message.contains("123456"));
    }

    #[tokio::test]
    async fn resend_requires_valid_nonempty_id_even_on_success_status() {
        for body in [r#"{}"#, r#"{"id":""}"#, r#"{"id":null}"#, "not-json"] {
            let (endpoint, _, task) = stub_resend(StatusCode::OK, body).await;
            let service = EmailService::new(
                Some("re_synthetic_test_only".into()),
                "noreply@trackmyrmc.com".into(),
            );
            assert!(
                service
                    .send_otp_to(&endpoint, "recipient@example.invalid", "123456", "Staff")
                    .await
                    .is_err(),
                "an invalid Resend receipt must not confirm OTP dispatch"
            );
            task.abort();
        }
    }

    #[tokio::test]
    async fn wrong_provider_key_fails_before_network_request() {
        let (endpoint, captured, task) =
            stub_resend(StatusCode::OK, r#"{"id":"should-not-be-sent"}"#).await;
        let service = EmailService::new(
            Some("postmark-example-credential".into()),
            "noreply@trackmyrmc.com".into(),
        );
        assert!(
            service
                .send_otp_to(&endpoint, "recipient@example.invalid", "123456", "Staff")
                .await
                .is_err()
        );
        assert_eq!(captured.lock().unwrap().len(), 0);
        task.abort();
    }
}
