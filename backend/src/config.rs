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

    /// Google Play App Signing SHA-256 certificate fingerprint. Optional until
    /// the production Play App Signing certificate is confirmed.
    pub play_signing_sha256: Option<String>,
    /// Fixed six-digit Google Play reviewer code. Absent means reviewer access is disabled.
    pub play_review_access_code: Option<String>,
    /// Optional Google Places API key for public plant onboarding search.
    pub google_places_api_key: Option<String>,
}

impl AppConfig {
    pub fn from_env() -> Result<Self, String> {
        let database_url = env::var("DATABASE_URL")
            .map_err(|_| "DATABASE_URL environment variable is required".to_string())?;
        let environment = env::var("APP_ENV").unwrap_or_else(|_| "production".to_string());
        // The independent recovery authority and KMS verifier are not yet
        // provisioned. A stray feature flag must never activate a bypass.
        validate_privileged_recovery_disabled(env::var("PRIVILEGED_RECOVERY_ENABLED").ok())?;
        validate_production_database_tls(&environment, &database_url)?;

        let jwt_secret = match env::var("JWT_SECRET") {
            Ok(secret) if secret.len() >= 64 => secret,
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
            Ok(value) if value.len() >= 32 => value,
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

        let cors_allowed_origins: Vec<String> = env::var("CORS_ORIGIN")
            .unwrap_or_else(|_| "https://trackmyrmc.com".to_string())
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        validate_production_cors(&environment, &cors_allowed_origins)?;

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

        let play_review_access_code = match env::var("PLAY_REVIEW_ACCESS_CODE") {
            Ok(value) if value.trim().is_empty() => None,
            Ok(value) if value.len() == 6 && value.bytes().all(|byte| byte.is_ascii_digit()) => {
                Some(value)
            }
            Ok(_) => return Err("PLAY_REVIEW_ACCESS_CODE must be exactly six digits".to_string()),
            Err(_) => None,
        };

        let google_places_api_key = env::var("GOOGLE_PLACES_API_KEY")
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());

        let play_signing_sha256 = match env::var("PLAY_SIGNING_SHA256") {
            Ok(value) if value.trim().is_empty() => None,
            Ok(value) => Some(
                normalize_sha256_fingerprint(&value).ok_or_else(|| {
                    "PLAY_SIGNING_SHA256 must be a 32-byte SHA-256 fingerprint (64 hex characters, optionally colon-separated)"
                        .to_string()
                })?,
            ),
            Err(_) => None,
        };

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
            play_signing_sha256,
            play_review_access_code,
            google_places_api_key,
        })
    }
}

/// Validate and normalize a SHA-256 certificate fingerprint to Android's
/// conventional uppercase colon-separated format.
pub fn normalize_sha256_fingerprint(value: &str) -> Option<String> {
    let compact: String = value
        .chars()
        .filter(|character| *character != ':')
        .collect();
    if compact.len() != 64
        || !compact
            .chars()
            .all(|character| character.is_ascii_hexdigit())
    {
        return None;
    }
    Some(
        compact
            .to_ascii_uppercase()
            .as_bytes()
            .chunks(2)
            .map(|pair| std::str::from_utf8(pair).expect("hex input is valid UTF-8"))
            .collect::<Vec<_>>()
            .join(":"),
    )
}

#[cfg(test)]
mod fingerprint_tests {
    use super::normalize_sha256_fingerprint;

    #[test]
    fn normalizes_valid_fingerprint() {
        let raw = "0123456789abcdef".repeat(4);
        assert_eq!(
            normalize_sha256_fingerprint(&raw).as_deref(),
            Some(
                "01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF"
            )
        );
    }

    #[test]
    fn rejects_invalid_fingerprint() {
        assert!(normalize_sha256_fingerprint("not-a-fingerprint").is_none());
        assert!(normalize_sha256_fingerprint(&"z".repeat(64)).is_none());
    }
}

// Production database identity and peer authentication are policy, not
// optional client hints. This is enforced again on every Rust service start,
// independent of whether deploy scripts or credential-rotation tools ran.
fn approved_production_database_ca(url: &str) -> Result<&'static str, String> {
    const HOST: &str = "trackmyrmc-postgres.cf8mmcwuuinx.ap-south-1.rds.amazonaws.com";
    const CERT: &str = "/etc/trackmyrmc/rds-ca-bundle.pem";
    let uri = reqwest::Url::parse(url)
        .map_err(|_| "Invalid production PostgreSQL connection identity".to_string())?;
    if !matches!(uri.scheme(), "postgres" | "postgresql")
        || uri.host_str() != Some(HOST)
        || uri.port_or_known_default() != Some(5432)
        || uri.username().is_empty()
        || uri.password().is_none()
        || uri.fragment().is_some()
    {
        return Err(
            "Production PostgreSQL identity does not match the approved RDS instance".into(),
        );
    }
    let mut mode = None;
    let mut roots = None;
    let mut count = 0;
    for (key, value) in uri.query_pairs() {
        count += 1;
        match key.as_ref() {
            "sslmode" if mode.is_none() => mode = Some(value.into_owned()),
            "sslrootcert" if roots.is_none() => roots = Some(value.into_owned()),
            _ => return Err("Production PostgreSQL TLS options are not approved".into()),
        }
    }
    if count != 2 || mode.as_deref() != Some("verify-full") || roots.as_deref() != Some(CERT) {
        return Err(
            "Production PostgreSQL requires pinned hostname and certificate verification".into(),
        );
    }
    Ok(CERT)
}

fn validate_production_database_tls(environment: &str, url: &str) -> Result<(), String> {
    if environment != "production" {
        return Ok(());
    }
    let roots = approved_production_database_ca(url)?;
    let path = std::path::Path::new(roots);
    if !path.is_file() || path.is_symlink() {
        return Err("Approved RDS trust bundle is missing or is a symlink".into());
    }
    Ok(())
}

#[cfg(test)]
mod production_database_tls_tests {
    use super::{approved_production_database_ca, validate_production_database_tls};

    #[test]
    fn rejects_downgrades_wrong_host_and_ambiguous_roots() {
        let url = "postgres://synthetic:test@trackmyrmc-postgres.cf8mmcwuuinx.ap-south-1.rds.amazonaws.com:5432/trackmyrmc?sslmode=verify-full&sslrootcert=%2Fetc%2Ftrackmyrmc%2Frds-ca-bundle.pem";
        assert_eq!(
            approved_production_database_ca(url).unwrap(),
            "/etc/trackmyrmc/rds-ca-bundle.pem"
        );
        assert!(validate_production_database_tls("test", "postgres://localhost/test").is_ok());
        for bad in [
            url.replace("verify-full", "require"),
            url.replace("verify-full", "verify-ca"),
            url.replace("trackmyrmc-postgres.", "forged."),
            url.replace("sslrootcert=%2Fetc%2Ftrackmyrmc%2Frds-ca-bundle.pem", ""),
            url.replace(
                "sslrootcert=%2Fetc%2Ftrackmyrmc%2Frds-ca-bundle.pem",
                "sslrootcert=%2Ftmp%2Fother.pem",
            ),
            format!("{url}&sslmode=require"),
            format!("{url}&sslrootcert=%2Ftmp%2Fforged.pem"),
            format!("{url}#fragment"),
        ] {
            assert!(approved_production_database_ca(&bad).is_err());
        }
    }
}

fn validate_privileged_recovery_disabled(raw: Option<String>) -> Result<(), String> {
    if raw.as_deref().is_none_or(|value| value == "false") {
        Ok(())
    } else {
        Err("Privileged recovery requires a separately verified approval service; feature is disabled".into())
    }
}

#[cfg(test)]
mod privileged_recovery_feature_gate_tests {
    use super::validate_privileged_recovery_disabled;

    #[test]
    fn unprovisioned_external_recovery_must_fail_closed() {
        assert!(validate_privileged_recovery_disabled(None).is_ok());
        assert!(validate_privileged_recovery_disabled(Some("false".into())).is_ok());
        for flag in ["true", "TRUE", "1", "yes", "", "on", "False"] {
            assert!(validate_privileged_recovery_disabled(Some(flag.into())).is_err());
        }
    }
}

fn validate_production_cors(environment: &str, origins: &[String]) -> Result<(), String> {
    if environment != "production" {
        return Ok(());
    }
    if origins.is_empty()
        || origins.iter().any(|origin| {
            reqwest::Url::parse(origin).map_or(true, |url| {
                url.scheme() != "https"
                    || url.host_str().is_none()
                    || !url.username().is_empty()
                    || url.password().is_some()
                    || url.path() != "/"
                    || url.query().is_some()
                    || url.fragment().is_some()
                    || origin.ends_with('/')
            })
        })
    {
        return Err("Production CORS_ORIGIN requires explicit HTTPS origins without paths, credentials or wildcards".into());
    }
    Ok(())
}

#[cfg(test)]
mod production_cors_tests {
    use super::validate_production_cors;
    #[test]
    fn privileged_web_origin_policy_fails_closed_in_production() {
        for origin in [
            "*",
            "null",
            "http://trackmyrmc.com",
            "https://user:pass@example.com",
            "https://example.com/path",
            "https://example.com?query=1",
            "https://example.com#fragment",
            "https://example.com/",
        ] {
            assert!(
                validate_production_cors("production", &[origin.into()]).is_err(),
                "{origin}"
            );
        }
        assert!(validate_production_cors("production", &[]).is_err());
        assert!(validate_production_cors("production", &["https://trackmyrmc.com".into()]).is_ok());
        assert!(validate_production_cors("test", &["http://127.0.0.1:4173".into()]).is_ok());
    }
}
