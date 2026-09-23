use crate::error::AppError;
use hmac::{Hmac, Mac};
use rand::{distributions::Alphanumeric, Rng};
use sha1::Sha1;
use sqlx::{FromRow, PgPool};
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

type HmacSha1 = Hmac<Sha1>;

const BASE32_ALPHABET: &[u8; 32] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

#[derive(Debug, FromRow)]
pub struct UserTotpRecord {
    pub id: Uuid,
    pub user_id: Uuid,
    pub secret_key: String,
    pub is_enabled: bool,
    pub backup_codes: Vec<String>,
}

pub struct TotpEngine;

impl TotpEngine {
    /// Generates a standard 20-byte random secret encoded as Base32
    pub fn generate_secret() -> String {
        let mut rng = rand::thread_rng();
        let bytes: Vec<u8> = (0..20).map(|_| rng.gen()).collect();
        Self::base32_encode(&bytes)
    }

    /// Generates standard otpauth URI for QR code generators
    pub fn get_otpauth_uri(secret: &str, user_label: &str) -> String {
        format!(
            "otpauth://totp/TrackMyRMC:{}?secret={}&issuer=TrackMyRMC&algorithm=SHA1&digits=6&period=30",
            user_label, secret
        )
    }

    /// Generates 8 secure alphanumeric backup recovery codes
    pub fn generate_backup_codes() -> Vec<String> {
        let mut rng = rand::thread_rng();
        (0..8)
            .map(|_| {
                let part1: String = (0..4).map(|_| rng.sample(Alphanumeric) as char).collect();
                let part2: String = (0..4).map(|_| rng.sample(Alphanumeric) as char).collect();
                format!("{}-{}", part1.to_uppercase(), part2.to_uppercase())
            })
            .collect()
    }

    /// Computes the 6-digit TOTP code for a given timestamp and secret
    pub fn compute_code(secret: &str, time_secs: u64) -> Result<String, AppError> {
        let key_bytes = Self::base32_decode(secret)
            .ok_or_else(|| AppError::InternalError("Invalid Base32 secret key".to_string()))?;

        let time_step = time_secs / 30;
        let counter_bytes = time_step.to_be_bytes();

        let mut mac = HmacSha1::new_from_slice(&key_bytes)
            .map_err(|e| AppError::InternalError(format!("HMAC initialization failed: {}", e)))?;
        mac.update(&counter_bytes);
        let result = mac.finalize().into_bytes();

        let offset = (result[result.len() - 1] & 0x0f) as usize;
        let binary = (((result[offset] & 0x7f) as u32) << 24)
            | (((result[offset + 1] & 0xff) as u32) << 16)
            | (((result[offset + 2] & 0xff) as u32) << 8)
            | ((result[offset + 3] & 0xff) as u32);

        let code = binary % 1_000_000;
        Ok(format!("{:06}", code))
    }

    /// Validates a submitted code with time skew window (-1, 0, +1 intervals)
    pub fn verify_code(secret: &str, submitted_code: &str) -> Result<bool, AppError> {
        let current_time = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();

        let submitted = submitted_code.trim();

        // Check window: current, previous (T-30), and next (T+30)
        for offset in [-30i64, 0, 30] {
            let eval_time = ((current_time as i64) + offset).max(0) as u64;
            if let Ok(code) = Self::compute_code(secret, eval_time) {
                if code == submitted {
                    return Ok(true);
                }
            }
        }

        Ok(false)
    }

    /// Simple Base32 encoder
    fn base32_encode(data: &[u8]) -> String {
        let mut result = String::new();
        let mut buffer = 0u64;
        let mut bits_left = 0;

        for &byte in data {
            buffer = (buffer << 8) | (byte as u64);
            bits_left += 8;
            while bits_left >= 5 {
                let index = ((buffer >> (bits_left - 5)) & 0x1F) as usize;
                result.push(BASE32_ALPHABET[index] as char);
                bits_left -= 5;
            }
        }

        if bits_left > 0 {
            let index = ((buffer << (5 - bits_left)) & 0x1F) as usize;
            result.push(BASE32_ALPHABET[index] as char);
        }

        result
    }

    /// Simple Base32 decoder
    fn base32_decode(encoded: &str) -> Option<Vec<u8>> {
        let clean = encoded.replace([' ', '-'], "").to_uppercase();
        let mut buffer = 0u64;
        let mut bits_left = 0;
        let mut output = Vec::new();

        for c in clean.chars() {
            let val = match c {
                'A'..='Z' => (c as u8 - b'A') as u64,
                '2'..='7' => (c as u8 - b'2' + 26) as u64,
                _ => return None,
            };
            buffer = (buffer << 5) | val;
            bits_left += 5;
            if bits_left >= 8 {
                output.push(((buffer >> (bits_left - 8)) & 0xFF) as u8);
                bits_left -= 8;
            }
        }

        Some(output)
    }
}

pub async fn setup_totp_for_user(
    pool: &PgPool,
    user_id: Uuid,
    user_email: &str,
) -> Result<(String, String, Vec<String>), AppError> {
    let secret = TotpEngine::generate_secret();
    let qr_uri = TotpEngine::get_otpauth_uri(&secret, user_email);
    let backup_codes = TotpEngine::generate_backup_codes();

    sqlx::query(
        r#"
        INSERT INTO user_totp_credentials (user_id, secret_key, is_enabled, backup_codes, updated_at)
        VALUES ($1, $2, FALSE, $3, NOW())
        ON CONFLICT (user_id) DO UPDATE
        SET secret_key = EXCLUDED.secret_key,
            is_enabled = FALSE,
            backup_codes = EXCLUDED.backup_codes,
            updated_at = NOW()
        "#,
    )
    .bind(user_id)
    .bind(&secret)
    .bind(&backup_codes)
    .execute(pool)
    .await?;

    Ok((secret, qr_uri, backup_codes))
}

pub async fn verify_and_enable_totp(
    pool: &PgPool,
    user_id: Uuid,
    submitted_code: &str,
) -> Result<(), AppError> {
    let rec = sqlx::query_as::<_, UserTotpRecord>(
        r#"
        SELECT id, user_id, secret_key, is_enabled, backup_codes
        FROM user_totp_credentials
        WHERE user_id = $1
        "#,
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("TOTP setup not initialized".to_string()))?;

    let is_valid = TotpEngine::verify_code(&rec.secret_key, submitted_code)?;
    if !is_valid {
        return Err(AppError::Unauthorized(
            "Invalid authenticator code. Check your device time sync.".to_string(),
        ));
    }

    sqlx::query("UPDATE user_totp_credentials SET is_enabled = TRUE, updated_at = NOW() WHERE user_id = $1")
        .bind(user_id)
        .execute(pool)
        .await?;

    Ok(())
}
