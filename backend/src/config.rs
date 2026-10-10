use std::env;

#[derive(Clone, Debug)]
pub struct AppConfig {
    pub database_url: String,
    pub jwt_secret: String,
    pub jwt_expiration_hours: i64,
    pub port: u16,
    pub host: String,
    pub cors_allowed_origins: Vec<String>,
    pub environment: String,

    pub meta_whatsapp_token: Option<String>,
    pub meta_whatsapp_phone_number_id: Option<String>,
    pub meta_whatsapp_waba_id: Option<String>,
    pub meta_graph_api_version: String,

    pub email_api_key: Option<String>,
    pub email_from_address: String,

    pub otp_pepper: String,
    pub otp_expiration_minutes: i64,
    pub otp_cooldown_seconds: i64,
    pub otp_max_verification_attempts: i32,
}

impl AppConfig {
    pub fn from_env() -> Result<Self, String> {
        let database_url = env::var("DATABASE_URL")
            .map_err(|_| "DATABASE_URL environment variable is required".to_string())?;
        let environment = env::var("APP_ENV").unwrap_or_else(|_| "production".to_string());

        let jwt_secret = match env::var("JWT_SECRET") {
            Ok(secret) if secret.as_bytes().len() >= 64 => secret,
            Ok(_) if environment != "production" => {
                "trackmyrmc_local_development_secret_change_me_please_64_chars_minimum_xxxxxxxxx"
                    .to_string()
            }
            Ok(_) => return Err("JWT_SECRET must be at least 64 bytes in production".to_string()),
            Err(_) if environment != "production" => {
                "trackmyrmc_local_development_secret_change_me_please_64_chars_minimum_xxxxxxxxx"
                    .to_string()
            }
            Err(_) => {
                return Err("JWT_SECRET environment variable is required in production".to_string())
            }
        };

        let otp_pepper = match env::var("OTP_PEPPER") {
            Ok(value) if value.as_bytes().len() >= 32 => value,
            Ok(_) if environment != "production" => {
                "trackmyrmc_local_otp_pepper_change_me_32_chars_xxxxxxxxx".to_string()
            }
            Ok(_) => return Err("OTP_PEPPER must be at least 32 bytes in production".to_string()),
            Err(_) if environment != "production" => {
                "trackmyrmc_local_otp_pepper_change_me_32_chars_xxxxxxxxx".to_string()
            }
            Err(_) => {
                return Err("OTP_PEPPER environment variable is required in production".to_string())
            }
        };

        let jwt_expiration_hours = env::var("JWT_EXPIRATION_HOURS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(24);
        let port = env::var("PORT")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(8000);
        let host = env::var("HOST").unwrap_or_else(|_| "0.0.0.0".to_string());

        let cors_allowed_origins = env::var("CORS_ORIGIN")
            .unwrap_or_else(|_| "https://trackmyrmc.com".to_string())
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();

        let meta_whatsapp_token = env::var("META_WHATSAPP_TOKEN").ok();
        let meta_whatsapp_phone_number_id = env::var("META_PHONE_NUMBER_ID").ok();
        let meta_whatsapp_waba_id = env::var("META_WABA_ID").ok();
        let meta_graph_api_version =
            env::var("META_GRAPH_API_VERSION").unwrap_or_else(|_| "v26.0".to_string());
        let version = meta_graph_api_version.strip_prefix('v').unwrap_or("");
        let version_parts: Vec<&str> = version.split('.').collect();
        if version_parts.len() != 2
            || version_parts.iter().any(|part| {
                part.is_empty() || !part.chars().all(|character| character.is_ascii_digit())
            })
        {
            return Err("META_GRAPH_API_VERSION must use the vNN.N format".to_string());
        }

        let email_api_key = env::var("EMAIL_API_KEY").ok();
        let email_from_address =
            env::var("EMAIL_FROM_ADDRESS").unwrap_or_else(|_| "noreply@trackmyrmc.com".to_string());

        let otp_expiration_minutes = env::var("OTP_EXPIRATION_MINUTES")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(5);
        let otp_cooldown_seconds = env::var("OTP_COOLDOWN_SECONDS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(60);
        let otp_max_verification_attempts = env::var("OTP_MAX_ATTEMPTS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(3);

        if !(1..=15).contains(&otp_expiration_minutes) {
            return Err("OTP_EXPIRATION_MINUTES must be between 1 and 15".to_string());
        }
        if otp_cooldown_seconds < 30 {
            return Err("OTP_COOLDOWN_SECONDS must be at least 30".to_string());
        }
        if !(3..=10).contains(&otp_max_verification_attempts) {
            return Err("OTP_MAX_ATTEMPTS must be between 3 and 10".to_string());
        }

        Ok(Self {
            database_url,
            jwt_secret,
            jwt_expiration_hours,
            port,
            host,
            cors_allowed_origins,
            environment,
            meta_whatsapp_token,
            meta_whatsapp_phone_number_id,
            meta_whatsapp_waba_id,
            meta_graph_api_version,
            email_api_key,
            email_from_address,
            otp_pepper,
            otp_expiration_minutes,
            otp_cooldown_seconds,
            otp_max_verification_attempts,
        })
    }
}
