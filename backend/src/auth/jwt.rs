use crate::error::AppError;
use chrono::{Duration, Utc};
use jsonwebtoken::{decode, encode, Algorithm, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

const ISSUER: &str = "trackmyrmc-api";
const AUDIENCE: &str = "trackmyrmc-mobile";

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Claims {
    pub sub: Uuid,
    pub role: String,
    pub phone: String,
    pub email: Option<String>,
    pub iss: String,
    pub aud: String,
    pub exp: usize,
    pub iat: usize,
}

pub fn generate_token(
    user_id: Uuid,
    role: &str,
    phone: &str,
    email: Option<&str>,
    secret: &str,
    expiration_hours: i64,
) -> Result<String, AppError> {
    let now = Utc::now();
    let expiration = now + Duration::hours(expiration_hours.clamp(1, 24));
    let claims = Claims {
        sub: user_id,
        role: role.to_string(),
        phone: phone.to_string(),
        email: email.map(str::to_string),
        iss: ISSUER.to_string(),
        aud: AUDIENCE.to_string(),
        exp: expiration.timestamp() as usize,
        iat: now.timestamp() as usize,
    };
    let mut header = Header::new(Algorithm::HS512);
    header.typ = Some("JWT".to_string());
    encode(&header, &claims, &EncodingKey::from_secret(secret.as_bytes()))
        .map_err(|e| AppError::JwtError(e.to_string()))
}

pub fn verify_token(token: &str, secret: &str) -> Result<Claims, AppError> {
    let mut validation = Validation::new(Algorithm::HS512);
    validation.validate_exp = true;
    validation.set_issuer(&[ISSUER]);
    validation.set_audience(&[AUDIENCE]);
    validation.set_required_spec_claims(&["exp", "iat", "iss", "aud", "sub"]);

    decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &validation,
    ).map(|token_data| token_data.claims)
     .map_err(|e| AppError::JwtError(e.to_string()))
}
