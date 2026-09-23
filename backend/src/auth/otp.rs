use crate::error::AppError;
use chrono::{DateTime, Duration, Utc};
use rand::{distributions::Alphanumeric, Rng};
use sha2::{Digest, Sha256};
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

#[derive(Debug, FromRow)]
pub struct OtpVerificationRecord {
    pub id: Uuid,
    pub destination: String,
    pub channel: String,
    pub purpose: String,
    pub hashed_otp: String,
    pub salt: String,
    pub attempts: i32,
    pub max_attempts: i32,
    pub is_verified: bool,
    pub expires_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
}

pub struct OtpEngine;

impl OtpEngine {
    /// Generates a cryptographically secure 6-digit numeric OTP and a random salt
    pub fn generate_secure_otp() -> (String, String, String) {
        let mut rng = rand::thread_rng();
        let otp: u32 = rng.gen_range(100000..=999999);
        let otp_str = format!("{:06}", otp);

        let salt: String = rng
            .sample_iter(&Alphanumeric)
            .take(32)
            .map(char::from)
            .collect();

        let hashed_otp = Self::hash_otp(&otp_str, &salt);
        (otp_str, salt, hashed_otp)
    }

    /// Computes SHA-256 hash of the OTP combined with its salt
    pub fn hash_otp(otp: &str, salt: &str) -> String {
        let mut hasher = Sha256::new();
        hasher.update(salt.as_bytes());
        hasher.update(otp.trim().as_bytes());
        format!("{:x}", hasher.finalize())
    }

    /// Checks rate limits for a given destination (phone or email)
    pub async fn check_rate_limit(
        pool: &PgPool,
        destination: &str,
        cooldown_seconds: i64,
    ) -> Result<(), AppError> {
        let cooldown_threshold = Utc::now() - Duration::seconds(cooldown_seconds);

        let recent_request: Option<(DateTime<Utc>,)> = sqlx::query_as(
            r#"
            SELECT created_at FROM otp_verifications
            WHERE destination = $1 AND created_at > $2
            ORDER BY created_at DESC
            LIMIT 1
            "#,
        )
        .bind(destination)
        .bind(cooldown_threshold)
        .fetch_optional(pool)
        .await?;

        if let Some((created_at,)) = recent_request {
            let elapsed = (Utc::now() - created_at).num_seconds();
            let remaining = cooldown_seconds.saturating_sub(elapsed);
            return Err(AppError::BadRequest(format!(
                "Please wait {} seconds before requesting a new verification code.",
                remaining
            )));
        }

        // Check hourly ceiling (max 5 requests per hour)
        let hour_threshold = Utc::now() - Duration::hours(1);
        let count: (i64,) = sqlx::query_as(
            r#"
            SELECT COUNT(*) FROM otp_verifications
            WHERE destination = $1 AND created_at > $2
            "#,
        )
        .bind(destination)
        .bind(hour_threshold)
        .fetch_one(pool)
        .await?;

        if count.0 >= 5 {
            return Err(AppError::Forbidden(
                "Too many OTP requests. Please try again after an hour.".to_string(),
            ));
        }

        Ok(())
    }

    /// Creates and stores a new OTP session in PostgreSQL (storing only hash and salt)
    pub async fn create_session(
        pool: &PgPool,
        destination: &str,
        channel: &str,
        purpose: &str,
        salt: &str,
        hashed_otp: &str,
        expiration_minutes: i64,
        max_attempts: i32,
    ) -> Result<Uuid, AppError> {
        let expires_at = Utc::now() + Duration::minutes(expiration_minutes);

        // Invalidate any existing active OTPs for the same destination and purpose
        sqlx::query(
            r#"
            UPDATE otp_verifications
            SET is_verified = TRUE
            WHERE destination = $1 AND purpose = $2 AND is_verified = FALSE
            "#,
        )
        .bind(destination)
        .bind(purpose)
        .execute(pool)
        .await?;

        let rec: (Uuid,) = sqlx::query_as(
            r#"
            INSERT INTO otp_verifications (
                destination, channel, purpose, hashed_otp, salt,
                attempts, max_attempts, is_verified, expires_at
            )
            VALUES ($1, $2, $3, $4, $5, 0, $6, FALSE, $7)
            RETURNING id
            "#,
        )
        .bind(destination)
        .bind(channel)
        .bind(purpose)
        .bind(hashed_otp)
        .bind(salt)
        .bind(max_attempts)
        .bind(expires_at)
        .fetch_one(pool)
        .await?;

        Ok(rec.0)
    }

    /// Validates an OTP against stored hash, enforcing expiration and max attempts
    pub async fn verify_otp(
        pool: &PgPool,
        destination: &str,
        channel: &str,
        purpose: &str,
        submitted_otp: &str,
    ) -> Result<(), AppError> {
        let mut tx = pool.begin().await?;

        let record = sqlx::query_as::<_, OtpVerificationRecord>(
            r#"
            SELECT id, destination, channel, purpose, hashed_otp, salt,
                   attempts, max_attempts, is_verified, expires_at, created_at
            FROM otp_verifications
            WHERE destination = $1 AND channel = $2 AND purpose = $3
                  AND is_verified = FALSE AND expires_at > NOW()
            ORDER BY created_at DESC
            LIMIT 1
            FOR UPDATE
            "#,
        )
        .bind(destination)
        .bind(channel)
        .bind(purpose)
        .fetch_optional(&mut *tx)
        .await?;

        let record = match record {
            Some(r) => r,
            None => {
                return Err(AppError::Unauthorized(
                    "Invalid or expired verification code".to_string(),
                ));
            }
        };

        if record.attempts >= record.max_attempts {
            // Lock and invalidate record
            sqlx::query("UPDATE otp_verifications SET is_verified = TRUE WHERE id = $1")
                .bind(record.id)
                .execute(&mut *tx)
                .await?;
            tx.commit().await?;

            return Err(AppError::Unauthorized(
                "Maximum verification attempts exceeded. Please request a new code.".to_string(),
            ));
        }

        let computed_hash = Self::hash_otp(submitted_otp, &record.salt);

        if computed_hash != record.hashed_otp {
            // Increment failed attempts
            sqlx::query("UPDATE otp_verifications SET attempts = attempts + 1 WHERE id = $1")
                .bind(record.id)
                .execute(&mut *tx)
                .await?;
            tx.commit().await?;

            return Err(AppError::Unauthorized(
                "Invalid or expired verification code".to_string(),
            ));
        }

        // Success: immediately invalidate session to prevent replay
        sqlx::query("UPDATE otp_verifications SET is_verified = TRUE WHERE id = $1")
            .bind(record.id)
            .execute(&mut *tx)
            .await?;

        tx.commit().await?;
        Ok(())
    }
}
