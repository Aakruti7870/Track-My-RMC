use super::control_center;
use crate::{error::AppError, routes::account_deletion, services::auth_service, state::AppState};
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

pub struct OtpSessionInput<'a> {
    pub destination: &'a str,
    pub channel: &'a str,
    pub purpose: &'a str,
    pub salt: &'a str,
    pub hashed_otp: &'a str,
    pub expiration_minutes: i64,
    pub max_attempts: i32,
}

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

    /// Reserve the real pending OTP under the same lock as the cooldown check.
    /// Provider delivery runs after commit, so it never holds the database lock.
    pub(crate) async fn deliver(
        state: &AppState,
        destination: &str,
        channel: &str,
        purpose: &str,
        portal: &str,
    ) -> Result<(), AppError> {
        let (session_id, code) =
            Self::reserve_delivery(state, destination, channel, purpose).await?;
        if let Err(error) = Self::send_pending(
            state,
            session_id,
            destination,
            channel,
            purpose,
            portal,
            &code,
        )
        .await
        {
            let _ = Self::discard_pending_session(&state.db, session_id).await;
            return Err(error);
        }
        Ok(())
    }

    /// Every public request reserves an unusable pending code and leaves identity
    /// lookup and provider I/O to a bounded background task.
    pub(crate) async fn deliver_public(
        state: &AppState,
        destination: String,
        channel: &'static str,
        purpose: String,
        portal: &'static str,
    ) -> Result<(), AppError> {
        let slot = state
            .public_otp_delivery_slots
            .clone()
            .try_acquire_owned()
            .map_err(|_| {
                tracing::warn!(auth_event = "queue_full", "Public OTP queue full");
                AppError::RateLimited(
                    "Verification delivery is busy. Please try again shortly.".into(),
                )
            })?;
        let (session_id, code) =
            Self::reserve_delivery(state, &destination, channel, &purpose).await?;
        let state = state.clone();
        tokio::spawn(async move {
            let _slot = slot;
            let delivery = async {
                let eligible = match purpose.as_str() {
                    control_center::ADMIN_OTP_PURPOSE => {
                        control_center::otp_delivery_eligible(&state, &destination).await?
                    }
                    account_deletion::DELETION_OTP_PURPOSE => {
                        account_deletion::eligible_public_account(&state, &destination, channel)
                            .await?
                            .is_some()
                    }
                    _ => auth_service::public_otp_eligible(&state, &destination, channel).await?,
                };
                if !eligible {
                    return Ok(false);
                }
                Self::send_pending(
                    &state,
                    session_id,
                    &destination,
                    channel,
                    &purpose,
                    portal,
                    &code,
                )
                .await?;
                Ok::<_, AppError>(true)
            };
            let result = tokio::time::timeout(std::time::Duration::from_secs(20), delivery).await;
            if !matches!(result, Ok(Ok(true))) {
                if !matches!(result, Ok(Ok(false))) {
                    tracing::warn!(channel, "Public OTP delivery did not complete");
                }
                // Preserve the cooldown and the last successfully delivered code.
                if sqlx::query("UPDATE otp_verifications SET is_pending=FALSE,is_verified=TRUE WHERE id=$1 AND is_pending")
                    .bind(session_id)
                    .execute(&state.db)
                    .await
                    .is_err()
                {
                    tracing::warn!(channel, "Could not close a pending public OTP record");
                }
            }
        });
        Ok(())
    }

    async fn reserve_delivery(
        state: &AppState,
        destination: &str,
        channel: &str,
        purpose: &str,
    ) -> Result<(Uuid, String), AppError> {
        state.otp_delivery.validate(channel)?;
        let (code, salt, hashed_otp) = Self::generate_secure_otp(&state.config.otp_pepper);
        let mut tx = state.db.begin().await?;
        sqlx::query("SELECT pg_advisory_xact_lock(92741,hashtext($1))")
            .bind(destination)
            .execute(&mut *tx)
            .await?;
        Self::check_rate_limit(&mut tx, destination, state.config.otp_cooldown_seconds).await?;
        let session_id = Self::create_pending_session(
            &mut *tx,
            OtpSessionInput {
                destination,
                channel,
                purpose,
                salt: &salt,
                hashed_otp: &hashed_otp,
                expiration_minutes: state.config.otp_expiration_minutes,
                max_attempts: state.config.otp_max_verification_attempts,
            },
        )
        .await?;
        tx.commit().await?;
        Ok((session_id, code))
    }

    async fn send_pending(
        state: &AppState,
        session_id: Uuid,
        destination: &str,
        channel: &str,
        purpose: &str,
        portal: &str,
        code: &str,
    ) -> Result<(), AppError> {
        let mut tx = state.db.begin().await?;
        let budget: Option<(i32, i32)> = sqlx::query_as(
            "UPDATE otp_delivery_budget SET utc_day=(now() AT TIME ZONE 'UTC')::date,
                used=CASE WHEN utc_day=(now() AT TIME ZONE 'UTC')::date THEN used+1 ELSE 1 END
             WHERE singleton AND daily_limit>0 AND
                (utc_day<>(now() AT TIME ZONE 'UTC')::date OR used<daily_limit)
             RETURNING used,daily_limit",
        )
        .fetch_optional(&mut *tx)
        .await?;
        let Some((used, limit)) = budget else {
            tracing::warn!(
                auth_event = "budget_exhausted",
                "OTP attempt budget exhausted"
            );
            return Err(AppError::RateLimited(
                "Verification delivery is temporarily unavailable.".into(),
            ));
        };
        let slot: Option<i16> = sqlx::query_scalar(
            "UPDATE otp_delivery_slots SET reservation=$1, expires_at=clock_timestamp()+interval '30 seconds'
             WHERE slot=(SELECT slot FROM otp_delivery_slots
                WHERE reservation IS NULL OR expires_at<=clock_timestamp()
                ORDER BY slot LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING slot",
        )
        .bind(session_id)
        .fetch_optional(&mut *tx)
        .await?;
        let Some(slot) = slot else {
            tracing::warn!(auth_event = "queue_full", "OTP delivery capacity reached");
            return Err(AppError::RateLimited(
                "Verification delivery is busy.".into(),
            ));
        };
        tx.commit().await?;
        tracing::info!(
            auth_event = "provider_attempt",
            channel,
            "OTP provider attempt reserved"
        );
        if used == limit - limit / 5 {
            tracing::warn!(
                auth_event = "budget_warning",
                "OTP daily budget reached 80 percent"
            );
        }
        let delivery = tokio::time::timeout(
            std::time::Duration::from_secs(15),
            state.otp_delivery.send(channel, destination, code, portal),
        )
        .await;
        // Cancellation or process exit leaves a short lease. An old worker can never free a new lease.
        sqlx::query("UPDATE otp_delivery_slots SET reservation=NULL,expires_at=NULL WHERE slot=$1 AND reservation=$2")
            .bind(slot).bind(session_id).execute(&state.db).await?;
        delivery
            .map_err(|_| AppError::InternalError("Verification provider timed out".into()))??;
        Self::activate_pending_session(&state.db, session_id, destination, channel, purpose).await
    }

    async fn check_rate_limit(
        connection: &mut sqlx::PgConnection,
        destination: &str,
        cooldown_seconds: i64,
    ) -> Result<(), AppError> {
        let cooldown_threshold = Utc::now() - Duration::seconds(cooldown_seconds);
        let recent_request: Option<(DateTime<Utc>,)> = sqlx::query_as(
            "SELECT created_at FROM otp_verifications WHERE destination=$1 AND created_at>$2 ORDER BY created_at DESC LIMIT 1"
        ).bind(destination).bind(cooldown_threshold).fetch_optional(&mut *connection).await?;

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
        .fetch_one(connection)
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
        input: OtpSessionInput<'_>,
    ) -> Result<Uuid, AppError> {
        let OtpSessionInput {
            destination,
            channel,
            purpose,
            salt,
            hashed_otp,
            expiration_minutes,
            max_attempts,
        } = input;
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

    pub async fn create_pending_session<'e>(
        executor: impl sqlx::PgExecutor<'e>,
        input: OtpSessionInput<'_>,
    ) -> Result<Uuid, AppError> {
        let OtpSessionInput {
            destination,
            channel,
            purpose,
            salt,
            hashed_otp,
            expiration_minutes,
            max_attempts,
        } = input;
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
        .fetch_one(executor)
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
