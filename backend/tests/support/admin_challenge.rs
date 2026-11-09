use sha2::{Digest, Sha256};
use sqlx::PgPool;
use uuid::Uuid;

/// Seed a synthetic post-email challenge for existing authorization regressions.
/// OTP issuance and consumption are exercised separately through the real API.
pub async fn admin_challenge(db: &PgPool, email: &str) -> String {
    let token = Uuid::new_v4().simple().to_string();
    sqlx::query(
        "INSERT INTO staff_mfa_challenges(user_id,token_hash,purpose,expires_at)
         SELECT id,$2,'admin_login',NOW()+INTERVAL '5 minutes' FROM users WHERE email=$1",
    )
    .bind(email)
    .bind(hex::encode(Sha256::digest(token.as_bytes())))
    .execute(db)
    .await
    .unwrap();
    token
}
