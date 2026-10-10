use crate::{error::AppError, state::AppState};
use chrono::{DateTime, Duration, Utc};
use hmac::{Hmac, Mac};
use rand::{distributions::Alphanumeric, Rng};
use sha2::Sha256;
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

type HmacSha256 = Hmac<Sha256>;

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
    pub fn generate_secure_otp(pepper: &str) -> (String, String, String) {
        let mut rng = rand::thread_rng();
        let otp: u32 = rng.gen_range(100000..=999999);
        let otp_str = format!("{:06}", otp);
        let salt: String = rng
            .sample_iter(&Alphanumeric)
            .take(32)
            .map(char::from)
            .collect();
        let hashed_otp = Self::hash_otp(&otp_str, &salt, pepper);
        (otp_str, salt, hashed_otp)
    }

    pub fn hash_otp(otp: &str, salt: &str, pepper: &str) -> String {
        let mut mac = HmacSha256::new_from_slice(pepper.as_bytes()).expect("valid HMAC key");
        mac.update(salt.as_bytes());
        mac.update(b":");
        mac.update(otp.trim().as_bytes());
        hex::encode(mac.finalize().into_bytes())
    }

    pub async fn check_rate_limit(
        pool: &PgPool,
        destination: &str,
        cooldown_seconds: i64,
    ) -> Result<(), AppError> {
        let cooldown_threshold = Utc::now() - Duration::seconds(cooldown_seconds);
        let recent_request: Option<(DateTime<Utc>,)> = sqlx::query_as(
            "SELECT created_at FROM otp_verifications WHERE destination=$1 AND created_at>$2 ORDER BY created_at DESC LIMIT 1"
        ).bind(destination).bind(cooldown_threshold).fetch_optional(pool).await?;

        if let Some((created_at,)) = recent_request {
            let elapsed = (Utc::now() - created_at).num_seconds();
            return Err(AppError::BadRequest(format!(
                "Please wait {} seconds before requesting a new verification code.",
                cooldown_seconds.saturating_sub(elapsed)
            )));
        }

        let hour_threshold = Utc::now() - Duration::hours(1);
        let count: (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM otp_verifications WHERE destination=$1 AND created_at>$2",
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

        sqlx::query(
            "UPDATE otp_verifications SET is_verified=TRUE WHERE destination=$1 AND purpose=$2 AND is_verified=FALSE"
        ).bind(destination).bind(purpose).execute(pool).await?;

        let rec: (Uuid,) = sqlx::query_as(
            "INSERT INTO otp_verifications (destination,channel,purpose,hashed_otp,salt,attempts,max_attempts,is_verified,expires_at)
             VALUES ($1,$2,$3,$4,$5,0,$6,FALSE,$7) RETURNING id"
        ).bind(destination).bind(channel).bind(purpose).bind(hashed_otp).bind(salt)
        .bind(max_attempts).bind(expires_at).fetch_one(pool).await?;

        Ok(rec.0)
    }

    pub async fn create_pending_session(
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
        let rec: (Uuid,) = sqlx::query_as(
            "INSERT INTO otp_verifications
             (destination, channel, purpose, hashed_otp, salt, attempts,
              max_attempts, is_verified, is_pending, expires_at)
             VALUES ($1,$2,$3,$4,$5,0,$6,FALSE,TRUE,$7) RETURNING id",
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

    pub async fn activate_pending_session(
        pool: &PgPool,
        session_id: Uuid,
        destination: &str,
        channel: &str,
        purpose: &str,
    ) -> Result<(), AppError> {
        let mut tx = pool.begin().await?;

        let pending: Option<(Uuid,)> = sqlx::query_as(
            "SELECT id FROM otp_verifications
             WHERE id=$1 AND destination=$2 AND channel=$3 AND purpose=$4
               AND is_pending=TRUE AND is_verified=FALSE AND expires_at>NOW()
             FOR UPDATE",
        )
        .bind(session_id)
        .bind(destination)
        .bind(channel)
        .bind(purpose)
        .fetch_optional(&mut *tx)
        .await?;

        if pending.is_none() {
            return Err(AppError::InternalError(
                "Pending OTP session could not be activated".to_string(),
            ));
        }

        sqlx::query(
            "UPDATE otp_verifications
             SET is_verified=TRUE
             WHERE destination=$1 AND channel=$2 AND purpose=$3
               AND id<>$4 AND is_verified=FALSE AND is_pending=FALSE",
        )
        .bind(destination)
        .bind(channel)
        .bind(purpose)
        .bind(session_id)
        .execute(&mut *tx)
        .await?;

        sqlx::query("UPDATE otp_verifications SET is_pending=FALSE WHERE id=$1")
            .bind(session_id)
            .execute(&mut *tx)
            .await?;

        tx.commit().await?;
        Ok(())
    }

    pub async fn discard_pending_session(pool: &PgPool, session_id: Uuid) -> Result<(), AppError> {
        sqlx::query("DELETE FROM otp_verifications WHERE id=$1 AND is_pending=TRUE")
            .bind(session_id)
            .execute(pool)
            .await?;

        Ok(())
    }

    pub async fn verify_otp(
        state: &AppState,
        destination: &str,
        channel: &str,
        purpose: &str,
        submitted_otp: &str,
    ) -> Result<(), AppError> {
        if submitted_otp.len() != 6 || !submitted_otp.bytes().all(|b| b.is_ascii_digit()) {
            return Err(AppError::Unauthorized(
                "Invalid or expired verification code".to_string(),
            ));
        }

        let mut tx = state.db.begin().await?;
        let record = sqlx::query_as::<_, OtpVerificationRecord>(
            "SELECT id,destination,channel,purpose,hashed_otp,salt,attempts,max_attempts,is_verified,expires_at,created_at
             FROM otp_verifications
             WHERE destination=$1 AND channel=$2 AND purpose=$3
               AND is_verified=FALSE AND is_pending=FALSE AND expires_at>NOW()
             ORDER BY created_at DESC LIMIT 1 FOR UPDATE"
        ).bind(destination).bind(channel).bind(purpose).fetch_optional(&mut *tx).await?
        .ok_or_else(|| AppError::Unauthorized("Invalid or expired verification code".to_string()))?;

        if record.attempts >= record.max_attempts {
            sqlx::query("UPDATE otp_verifications SET is_verified=TRUE WHERE id=$1")
                .bind(record.id)
                .execute(&mut *tx)
                .await?;
            tx.commit().await?;
            return Err(AppError::Unauthorized(
                "Maximum verification attempts exceeded. Please request a new code.".to_string(),
            ));
        }

        let computed = Self::hash_otp(submitted_otp, &record.salt, &state.config.otp_pepper);
        if !constant_time_equal(&computed, &record.hashed_otp) {
            sqlx::query("UPDATE otp_verifications SET attempts=attempts+1 WHERE id=$1")
                .bind(record.id)
                .execute(&mut *tx)
                .await?;
            tx.commit().await?;
            return Err(AppError::Unauthorized(
                "Invalid or expired verification code".to_string(),
            ));
        }

        sqlx::query("UPDATE otp_verifications SET is_verified=TRUE WHERE id=$1")
            .bind(record.id)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        Ok(())
    }
}

fn constant_time_equal(a: &str, b: &str) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.bytes().zip(b.bytes()) {
        diff |= x ^ y;
    }
    diff == 0
}
