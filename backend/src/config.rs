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

    // Meta WhatsApp Cloud API credentials (server-side only)
    pub meta_whatsapp_token: Option<String>,
    pub meta_whatsapp_phone_number_id: Option<String>,
    pub meta_whatsapp_waba_id: Option<String>,

    // Email provider credentials (server-side only)
    pub email_api_key: Option<String>,
    pub email_from_address: String,

    // OTP Security Controls
    pub otp_expiration_minutes: i64,
    pub otp_cooldown_seconds: i64,
    pub otp_max_verification_attempts: i32,
}

impl AppConfig {
    pub fn from_env() -> Result<Self, String> {
        let database_url = env::var("DATABASE_URL")
            .map_err(|_| "DATABASE_URL environment variable is required".to_string())?;

        let jwt_secret = env::var("JWT_SECRET")
            .unwrap_or_else(|_| "trackmyrmc_production_jwt_secret_super_secure_key".to_string());

        let jwt_expiration_hours = env::var("JWT_EXPIRATION_HOURS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(72);

        let port = env::var("PORT")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(8000);

        let host = env::var("HOST").unwrap_or_else(|_| "0.0.0.0".to_string());

        let cors_allowed_origins = env::var("CORS_ORIGIN")
            .unwrap_or_else(|_| "*".to_string())
            .split(',')
            .map(|s| s.trim().to_string())
            .collect();

        let environment = env::var("APP_ENV").unwrap_or_else(|_| "production".to_string());

        let meta_whatsapp_token = env::var("META_WHATSAPP_TOKEN").ok();
        let meta_whatsapp_phone_number_id = env::var("META_PHONE_NUMBER_ID").ok();
        let meta_whatsapp_waba_id = env::var("META_WABA_ID").ok();

        let email_api_key = env::var("EMAIL_API_KEY").ok();
        let email_from_address = env::var("EMAIL_FROM_ADDRESS")
            .unwrap_or_else(|_| "noreply@trackmyrmc.com".to_string());

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
            email_api_key,
            email_from_address,
            otp_expiration_minutes,
            otp_cooldown_seconds,
            otp_max_verification_attempts,
        })
    }
}
