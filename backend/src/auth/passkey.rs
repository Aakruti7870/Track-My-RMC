use crate::error::AppError;
use chrono::{DateTime, Utc};
use rand::{distributions::Alphanumeric, Rng};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

#[derive(Debug, FromRow)]
pub struct UserPasskeyRecord {
    pub id: Uuid,
    pub user_id: Uuid,
    pub credential_id: String,
    pub public_key: String,
    pub counter: i64,
    pub device_name: Option<String>,
    pub created_at: DateTime<Utc>,
    pub last_used_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PasskeyRegisterOptionsResponse {
    pub challenge: String,
    pub rp: RelyingParty,
    pub user: PasskeyUserEntity,
    pub pub_key_cred_params: Vec<PubKeyCredParam>,
    pub timeout: u64,
    pub attestation: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RelyingParty {
    pub name: String,
    pub id: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PasskeyUserEntity {
    pub id: String,
    pub name: String,
    pub display_name: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PubKeyCredParam {
    #[serde(rename = "type")]
    pub cred_type: String,
    pub alg: i32, // -7 for ES256, -257 for RS256
}

#[derive(Debug, Deserialize)]
pub struct PasskeyRegisterVerifyRequest {
    pub credential_id: String,
    pub public_key: String,
    pub device_name: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PasskeyLoginOptionsResponse {
    pub challenge: String,
    pub timeout: u64,
    pub rp_id: String,
    pub user_verification: String,
}

#[derive(Debug, Deserialize)]
pub struct PasskeyLoginVerifyRequest {
    pub credential_id: String,
    pub client_data_json: String,
    pub authenticator_data: String,
    pub signature: String,
}

pub struct PasskeyEngine;

impl PasskeyEngine {
    /// Generates a cryptographic challenge string
    pub fn generate_challenge() -> String {
        let mut rng = rand::thread_rng();
        rng.sample_iter(&Alphanumeric).take(48).map(char::from).collect()
    }

    /// Stores a new WebAuthn passkey credential for a user
    pub async fn register_credential(
        pool: &PgPool,
        user_id: Uuid,
        req: PasskeyRegisterVerifyRequest,
    ) -> Result<Uuid, AppError> {
        let rec: (Uuid,) = sqlx::query_as(
            r#"
            INSERT INTO user_passkeys (user_id, credential_id, public_key, device_name)
            VALUES ($1, $2, $3, $4)
            RETURNING id
            "#,
        )
        .bind(user_id)
        .bind(&req.credential_id)
        .bind(&req.public_key)
        .bind(req.device_name)
        .fetch_one(pool)
        .await?;

        Ok(rec.0)
    }

    /// Finds a passkey credential by credential ID
    pub async fn find_credential(
        pool: &PgPool,
        credential_id: &str,
    ) -> Result<Option<UserPasskeyRecord>, AppError> {
        let cred = sqlx::query_as::<_, UserPasskeyRecord>(
            r#"
            SELECT id, user_id, credential_id, public_key, counter, device_name, created_at, last_used_at
            FROM user_passkeys
            WHERE credential_id = $1
            "#,
        )
        .bind(credential_id)
        .fetch_optional(pool)
        .await?;

        Ok(cred)
    }

    /// Updates counter and last_used_at timestamp on successful authentication
    pub async fn update_usage(pool: &PgPool, credential_id: &str) -> Result<(), AppError> {
        sqlx::query(
            r#"
            UPDATE user_passkeys
            SET counter = counter + 1, last_used_at = NOW()
            WHERE credential_id = $1
            "#,
        )
        .bind(credential_id)
        .execute(pool)
        .await?;

        Ok(())
    }
}
