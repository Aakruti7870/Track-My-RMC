use crate::{
    auth::jwt::generate_token,
    error::AppError,
    models::user::{AuthResponse, User, UserResponse},
    repositories::user_repo,
    state::AppState,
};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use uuid::Uuid;

#[derive(Debug, Deserialize)]
pub struct PlayReviewLoginRequest {
    pub role: String,
    pub access_code: String,
}

fn digest(value: &str) -> String {
    hex::encode(Sha256::digest(value.as_bytes()))
}

fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    left.iter()
        .zip(right.iter())
        .fold(0_u8, |difference, (a, b)| difference | (a ^ b))
        == 0
}

fn normalized_role(role: &str) -> Result<&'static str, AppError> {
    match role {
        "customer" => Ok("customer"),
        "plant_owner" => Ok("plant_owner"),
        "driver" => Ok("driver"),
        _ => Err(AppError::BadRequest(
            "Choose an available Google Play review role".to_string(),
        )),
    }
}

/// Authenticate a dedicated, non-privileged Play review fixture. The access code
/// is supplied only through server configuration and is never returned or logged.
pub async fn login(
    state: &AppState,
    request: PlayReviewLoginRequest,
    client_identifier: &str,
) -> Result<AuthResponse, AppError> {
    let expected = state
        .config
        .play_review_access_code
        .as_deref()
        .ok_or_else(|| {
            AppError::Forbidden("Google Play reviewer access is not configured".to_string())
        })?;

    let role = normalized_role(&request.role)?;
    let client_hash = digest(client_identifier);

    sqlx::query(
        "DELETE FROM play_review_login_attempts WHERE attempted_at < NOW() - INTERVAL '24 hours'",
    )
    .execute(&state.db)
    .await?;

    let recent_failures: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM play_review_login_attempts
         WHERE client_hash = $1 AND succeeded = FALSE
           AND attempted_at > NOW() - INTERVAL '15 minutes'",
    )
    .bind(&client_hash)
    .fetch_one(&state.db)
    .await?;

    if recent_failures >= 5 {
        return Err(AppError::Forbidden(
            "Too many reviewer login attempts. Try again in 15 minutes.".to_string(),
        ));
    }

    let supplied = request.access_code.trim();
    let valid_format = supplied.len() == 6
        && supplied.bytes().all(|byte| byte.is_ascii_digit());
    let valid_code = valid_format && constant_time_eq(supplied.as_bytes(), expected.as_bytes());

    sqlx::query("INSERT INTO play_review_login_attempts (client_hash, succeeded) VALUES ($1, $2)")
        .bind(&client_hash)
        .bind(valid_code)
        .execute(&state.db)
        .await?;

    if !valid_code {
        return Err(AppError::Unauthorized(
            "Reviewer access code is invalid".to_string(),
        ));
    }

    let fixture: Option<User> = sqlx::query_as(
        "SELECT u.id, u.phone, u.email, u.hashed_password, u.full_name, u.role,
                u.is_active, u.is_verified, u.created_at, u.updated_at
         FROM play_review_fixtures f
         JOIN users u ON u.id = f.user_id
         WHERE f.role = $1 AND f.enabled = TRUE AND u.is_active = TRUE",
    )
    .bind(role)
    .fetch_optional(&state.db)
    .await?;

    let user = fixture.ok_or_else(|| {
        AppError::Forbidden("This Google Play review role is not provisioned".to_string())
    })?;

    let expected_user_role = match role {
        "customer" => "customer",
        "plant_owner" => "owner",
        "driver" => "driver",
        _ => unreachable!("normalized_role limits reviewer roles"),
    };
    if user.role != expected_user_role {
        return Err(AppError::Forbidden(
            "Reviewer fixture role configuration is invalid".to_string(),
        ));
    }

    let profile = user_repo::get_user_profile(&state.db, user.id).await?;
    let kyc_status = profile
        .as_ref()
        .map(|item| item.kyc_status.clone())
        .unwrap_or_else(|| "unverified".to_string());
    let verified_name = profile.and_then(|item| item.verified_name);
    let token = generate_token(
        user.id,
        &user.role,
        &user.phone,
        user.email.as_deref(),
        &state.config.jwt_secret,
        state.config.jwt_expiration_hours.min(2),
    )?;

    Ok(AuthResponse {
        success: true,
        token,
        role: user.role.clone(),
        user: UserResponse {
            id: user.id,
            phone: user.phone,
            email: user.email,
            full_name: user.full_name,
            role: user.role,
            kyc_status,
            verified_name,
        },
    })
}

pub async fn is_review_fixture(state: &AppState, user_id: Uuid) -> Result<bool, AppError> {
    Ok(sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM play_review_fixtures WHERE user_id = $1 AND enabled = TRUE)",
    )
    .bind(user_id)
    .fetch_one(&state.db)
    .await?)
}

#[cfg(test)]
mod tests {
    use super::{constant_time_eq, normalized_role};

    #[test]
    fn reviewer_code_comparison_requires_exact_match() {
        assert!(constant_time_eq(b"123456", b"123456"));
        assert!(!constant_time_eq(b"123456", b"123457"));
        assert!(!constant_time_eq(b"12345", b"123456"));
    }

    #[test]
    fn reviewer_roles_are_allowlisted() {
        assert_eq!(normalized_role("customer").unwrap(), "customer");
        assert_eq!(normalized_role("plant_owner").unwrap(), "plant_owner");
        assert_eq!(normalized_role("driver").unwrap(), "driver");
        assert!(normalized_role("admin").is_err());
        assert!(normalized_role("authority").is_err());
    }
}
