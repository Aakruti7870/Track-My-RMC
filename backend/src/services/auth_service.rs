use crate::{
    auth::{
        otp::OtpEngine,
        passkey::PasskeyLoginVerifyRequest,
        password::hash_password,
        totp::{hash_backup_code, TotpEngine},
    },
    error::AppError,
    models::user::{AuthResponse, LoginRequest, RegisterRequest, User, UserProfile, UserResponse},
    repositories::user_repo,
    state::AppState,
};
use chrono::{Duration, Utc};
use rand::{distributions::Alphanumeric, Rng};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

#[derive(Debug, Deserialize)]
pub struct SendWhatsAppOtpRequest {
    pub phone: String,
    pub purpose: Option<String>, // "login" | "driver_login"
}

#[derive(Debug, Deserialize)]
pub struct VerifyWhatsAppOtpRequest {
    pub phone: String,
    pub otp: String,
    pub purpose: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SendEmailOtpRequest {
    pub email: String,
    pub plant_code: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct VerifyEmailOtpRequest {
    pub email: String,
    pub otp: String,
}

#[derive(Debug, Deserialize)]
pub struct VerifyTotpLoginRequest {
    pub username_or_phone: String,
    pub totp_code: String,
}

pub async fn register(_state: &AppState, _req: RegisterRequest) -> Result<AuthResponse, AppError> {
    Err(AppError::Forbidden(
        "Use verified WhatsApp OTP registration for customer accounts".into(),
    ))
}

fn is_staff_role(role: &str) -> bool {
    matches!(
        role.to_ascii_lowercase().as_str(),
        "dispatcher"
            | "operator"
            | "supervisor"
            | "quality_engineer"
            | "store_manager"
            | "accountant"
            | "fleet_manager"
            | "owner"
            | "plant_owner"
            | "admin"
            | "central_admin"
            | "authority"
    )
}

fn is_email_login_role(role: &str) -> bool {
    is_staff_role(role) && role != "central_admin"
}

async fn approved_authority(state: &AppState, user_id: Uuid) -> Result<bool, AppError> {
    let approved: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM users u JOIN control_center_access a ON a.user_id=u.id
         WHERE u.id=$1 AND u.role='authority' AND u.is_active AND a.approved)",
    )
    .bind(user_id)
    .fetch_one(&state.db)
    .await?;
    Ok(approved)
}

pub async fn login(_state: &AppState, _req: LoginRequest) -> Result<AuthResponse, AppError> {
    Err(AppError::Forbidden(
        "Password login is disabled; use role-specific OTP and required MFA".into(),
    ))
}

/// Dispatches WhatsApp OTP via Meta WhatsApp Cloud API exclusively for Customer and Driver roles
pub async fn send_whatsapp_otp(
    state: &AppState,
    req: SendWhatsAppOtpRequest,
) -> Result<(), AppError> {
    let destination = crate::security::phone::canonical_login_phone(&req.phone)
        .ok_or_else(|| AppError::BadRequest("Enter a valid mobile number".into()))?;
    let purpose = req.purpose.unwrap_or_else(|| "login".to_string());

    if !matches!(purpose.as_str(), "login" | "driver_login") {
        return Err(AppError::BadRequest(
            "Unsupported WhatsApp OTP purpose".to_string(),
        ));
    }

    OtpEngine::deliver_login(state, destination, "whatsapp", purpose, "Login").await
}

/// Verifies WhatsApp OTP and authenticates User or Driver
pub async fn verify_whatsapp_otp(
    state: &AppState,
    req: VerifyWhatsAppOtpRequest,
) -> Result<AuthResponse, AppError> {
    let destination = crate::security::phone::canonical_login_phone(&req.phone)
        .ok_or_else(|| AppError::Unauthorized("Invalid verification identity".into()))?;
    let purpose = req.purpose.unwrap_or_else(|| "login".to_string());

    if !matches!(purpose.as_str(), "login" | "driver_login") {
        return Err(AppError::BadRequest(
            "Unsupported WhatsApp OTP purpose".to_string(),
        ));
    }

    OtpEngine::verify_otp(state, &destination, "whatsapp", &purpose, &req.otp).await?;

    // Fetch existing user or auto-provision verified customer
    let user = match user_repo::find_by_phone_or_email(&state.db, &destination).await? {
        Some(u) => u,
        None => {
            // New user registration via WhatsApp OTP
            let dummy_password = hash_password(&Uuid::new_v4().to_string())?;
            user_repo::create_whatsapp_customer(&state.db, &destination, &dummy_password).await?
        }
    };

    if !user.is_active {
        return Err(AppError::Forbidden(
            "Account is inactive. Contact support.".to_string(),
        ));
    }
    let is_review_fixture: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM play_review_fixtures WHERE user_id = $1 AND enabled = TRUE)",
    )
    .bind(user.id)
    .fetch_one(&state.db)
    .await?;
    if is_review_fixture {
        return Err(AppError::Forbidden(
            "Play review accounts must use the dedicated reviewer access flow.".to_string(),
        ));
    }
    if user.role != "customer" && user.role != "driver" {
        return Err(AppError::Forbidden(
            "WhatsApp OTP is restricted to Customer and Driver accounts.".to_string(),
        ));
    }

    if user.role == "driver" {
        // Serialize the verified claim with invitations and employment changes.
        // An OTP that raced a suspension must not reactivate the account.
        let mut tx = state.db.begin().await?;
        let active: bool = sqlx::query_scalar(
            "SELECT is_active FROM users WHERE id=$1 AND role='driver' FOR UPDATE",
        )
        .bind(user.id)
        .fetch_one(&mut *tx)
        .await?;
        if !active {
            return Err(AppError::Forbidden("Driver access is inactive".into()));
        }
        sqlx::query("UPDATE users SET is_verified=TRUE WHERE id=$1")
            .bind(user.id)
            .execute(&mut *tx)
            .await?;
        sqlx::query("UPDATE driver_employment_profiles SET is_active=TRUE,employment_status='ACTIVE',updated_at=NOW() WHERE driver_id=$1 AND employment_status='PENDING' AND released_at IS NULL")
            .bind(user.id).execute(&mut *tx).await?;
        tx.commit().await?;
    }

    let profile = user_repo::get_user_profile(&state.db, user.id).await?;
    let stored_kyc_status = profile
        .as_ref()
        .map(|p| p.kyc_status.clone())
        .unwrap_or_else(|| "unverified".to_string());
    let kyc_status = if user.role == "customer" {
        crate::routes::digilocker_kyc::effective_customer_kyc_status(
            &state.db,
            user.id,
            &stored_kyc_status,
        )
        .await?
    } else {
        stored_kyc_status
    };
    let verified_name = profile.and_then(|p| p.verified_name);

    let session = crate::auth::refresh::issue_after_auth(
        state,
        user.id,
        &user.role,
        &user.phone,
        user.email.as_deref(),
        state.config.jwt_expiration_hours,
    )
    .await?;

    Ok(AuthResponse {
        success: true,
        token: session.token,
        refresh_token: Some(session.refresh_token),
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

/// Dispatches Email OTP for Plant Staff, Owners, and Administrators
pub async fn send_email_otp(state: &AppState, req: SendEmailOtpRequest) -> Result<(), AppError> {
    let destination = req.email.trim().to_lowercase();

    if destination.len() > 254 || !destination.contains('@') {
        return Err(AppError::BadRequest(
            "Enter a valid work email address".into(),
        ));
    }
    OtpEngine::deliver_login(
        state,
        destination,
        "email",
        "staff_login".to_string(),
        "Staff/Admin Portal",
    )
    .await
}

pub(crate) async fn public_otp_eligible(
    state: &AppState,
    destination: &str,
    channel: &str,
) -> Result<bool, AppError> {
    let Some(user) = user_repo::find_by_phone_or_email(&state.db, destination).await? else {
        return Ok(channel == "whatsapp");
    };
    if !user.is_active || crate::services::play_review::is_review_fixture(state, user.id).await? {
        return Ok(false);
    }
    if channel == "whatsapp" {
        return Ok(matches!(user.role.as_str(), "customer" | "driver"));
    }
    if !is_email_login_role(&user.role)
        || user.email.as_deref() != Some(destination)
        || (user.role == "authority" && !approved_authority(state, user.id).await?)
    {
        return Ok(false);
    }
    match crate::routes::staff_lifecycle::require_login_eligible(state, user.id, &user.role).await {
        Ok(()) => Ok(true),
        Err(AppError::Forbidden(_)) => Ok(false),
        Err(error) => Err(error),
    }
}

#[derive(Debug, Serialize)]
pub struct StaffMfaChallengeResponse {
    pub status: &'static str,
    pub challenge_token: String,
    pub expires_in: i64,
    pub email: String,
    pub mfa_setup_required: bool,
    pub message: &'static str,
}

#[derive(Debug, Deserialize)]
pub struct VerifyStaffMfaRequest {
    pub challenge_token: String,
    pub code: String,
}

pub(crate) fn challenge_digest(token: &str) -> String {
    hex::encode(Sha256::digest(token.as_bytes()))
}

pub(crate) async fn create_staff_challenge<'e>(
    executor: impl sqlx::PgExecutor<'e>,
    user_id: Uuid,
    purpose: &str,
) -> Result<(String, i64), AppError> {
    let token: String = rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(48)
        .map(char::from)
        .collect();
    let expires_in = 300_i64;
    sqlx::query(
        "INSERT INTO staff_mfa_challenges (user_id, token_hash, purpose, expires_at) VALUES ($1,$2,$3,$4)"
    )
    .bind(user_id)
    .bind(challenge_digest(&token))
    .bind(purpose)
    .bind(Utc::now() + Duration::seconds(expires_in))
    .execute(executor)
    .await?;
    Ok((token, expires_in))
}

/// Verifies the first factor and returns a short-lived challenge, never a privileged JWT.
pub async fn verify_email_otp(
    state: &AppState,
    req: VerifyEmailOtpRequest,
) -> Result<StaffMfaChallengeResponse, AppError> {
    let destination = req.email.trim().to_lowercase();
    let invalid = || AppError::Unauthorized("Invalid email or verification code".into());
    OtpEngine::verify_otp(state, &destination, "email", "staff_login", &req.otp).await?;
    let user = user_repo::find_by_phone_or_email(&state.db, &destination)
        .await?
        .ok_or_else(invalid)?;
    if !user.is_active
        || !is_email_login_role(&user.role)
        || user.email.as_deref() != Some(destination.as_str())
        || crate::services::play_review::is_review_fixture(state, user.id).await?
    {
        return Err(invalid());
    }
    if user.role == "authority" && !approved_authority(state, user.id).await? {
        return Err(AppError::Forbidden(
            "Authority requires Central Admin approval".into(),
        ));
    }
    crate::routes::staff_lifecycle::require_login_eligible(state, user.id, &user.role).await?;
    let mut tx = state.db.begin().await?;
    let verified = sqlx::query(
        "UPDATE users SET work_email_verified_at=clock_timestamp()
         WHERE id=$1 AND role=$2 AND email=$3 AND is_active",
    )
    .bind(user.id)
    .bind(&user.role)
    .bind(&destination)
    .execute(&mut *tx)
    .await?;
    if verified.rows_affected() != 1 {
        return Err(invalid());
    }

    let enabled: Option<bool> =
        sqlx::query_scalar("SELECT is_enabled FROM user_totp_credentials WHERE user_id=$1")
            .bind(user.id)
            .fetch_optional(&mut *tx)
            .await?;
    let mfa_setup_required = enabled != Some(true);
    let purpose = if mfa_setup_required {
        sqlx::query(
            "UPDATE staff_mfa_challenges SET consumed_at=clock_timestamp()
             WHERE user_id=$1 AND purpose='enrollment' AND consumed_at IS NULL
               AND expires_at>clock_timestamp()",
        )
        .bind(user.id)
        .execute(&mut *tx)
        .await?;
        "enrollment"
    } else {
        "login"
    };
    let (challenge_token, expires_in) = create_staff_challenge(&mut *tx, user.id, purpose).await?;
    tx.commit().await?;
    Ok(StaffMfaChallengeResponse {
        status: if mfa_setup_required {
            "MFA_ENROLLMENT_REQUIRED"
        } else {
            "MFA_REQUIRED"
        },
        challenge_token,
        expires_in,
        email: destination,
        mfa_setup_required,
        message: if mfa_setup_required {
            "Email verified. Complete authenticator setup to continue."
        } else {
            "Email verified. Enter your authenticator or one-time recovery code."
        },
    })
}

#[derive(Debug, Serialize)]
pub struct StaffMfaEnrollmentStartResponse {
    pub status: &'static str,
    pub issuer: &'static str,
    pub account: String,
    pub manual_key: String,
    pub otpauth_uri: String,
    pub recovery_codes: Vec<String>,
    pub expires_in: i64,
}
#[derive(Debug, Serialize)]
pub struct StaffMfaEnrollmentConfirmResponse {
    pub status: &'static str,
    pub recovery_codes: Vec<String>,
    pub challenge_token: String,
    pub message: &'static str,
}
async fn staff_enrollment_user(state: &AppState, digest: &str) -> Result<(User, i64), AppError> {
    let row: Option<(Uuid, String, i64)> = sqlx::query_as(
        "SELECT user_id,purpose,ceil(extract(epoch FROM expires_at-clock_timestamp()))::bigint
         FROM staff_mfa_challenges
         WHERE token_hash=$1 AND consumed_at IS NULL AND expires_at>clock_timestamp()
           AND attempts<max_attempts",
    )
    .bind(digest)
    .fetch_optional(&state.db)
    .await?;
    let (user_id, purpose, expires_in) = row.ok_or_else(|| {
        AppError::Unauthorized("MFA enrollment challenge is invalid or expired".into())
    })?;
    if purpose != "enrollment" {
        return Err(AppError::Forbidden(
            "This challenge is not valid for enrollment.".into(),
        ));
    }
    let user = user_repo::find_by_id(&state.db, user_id)
        .await?
        .ok_or_else(|| AppError::Unauthorized("Account not found".into()))?;
    if !user.is_active
        || !is_email_login_role(&user.role)
        || crate::services::play_review::is_review_fixture(state, user_id).await?
        || (user.role == "authority" && !approved_authority(state, user_id).await?)
    {
        return Err(AppError::Forbidden(
            "Account is not authorized for staff enrollment.".into(),
        ));
    }
    crate::routes::staff_lifecycle::require_login_eligible(state, user_id, &user.role).await?;
    Ok((user, expires_in))
}

pub async fn start_staff_mfa_enrollment(
    state: &AppState,
    challenge_token: &str,
) -> Result<StaffMfaEnrollmentStartResponse, AppError> {
    let (user, expires_in) =
        staff_enrollment_user(state, &challenge_digest(challenge_token)).await?;
    let account = user.email.unwrap_or(user.phone);
    let secret = TotpEngine::staff_enrollment_secret(&state.config.otp_pepper, challenge_token);
    Ok(StaffMfaEnrollmentStartResponse {
        status: "MFA_ENROLLMENT_STARTED",
        issuer: "TrackMyRMC",
        otpauth_uri: TotpEngine::get_otpauth_uri(&secret, &account),
        account,
        manual_key: secret,
        recovery_codes: TotpEngine::staff_enrollment_recovery(
            &state.config.otp_pepper,
            challenge_token,
        ),
        expires_in,
    })
}

pub async fn confirm_staff_mfa_enrollment(
    state: &AppState,
    challenge_token: &str,
    code: &str,
) -> Result<StaffMfaEnrollmentConfirmResponse, AppError> {
    let digest = challenge_digest(challenge_token);
    let (user, _) = staff_enrollment_user(state, &digest).await?;
    let user_id = user.id;
    let mut tx = state.db.begin().await?;
    // Serialize with a fresh email proof before locking the enrollment challenge.
    let active_user: Option<Uuid> = sqlx::query_scalar(
        "SELECT id FROM users WHERE id=$1 AND role=$2 AND email=$3 AND is_active FOR NO KEY UPDATE",
    )
    .bind(user_id)
    .bind(&user.role)
    .bind(user.email.as_deref())
    .fetch_optional(&mut *tx)
    .await?;
    if active_user.is_none() {
        return Err(AppError::Forbidden(
            "Account is no longer eligible for enrollment".into(),
        ));
    }
    let usable: Option<Uuid> = sqlx::query_scalar(
        "SELECT id FROM staff_mfa_challenges
         WHERE token_hash=$1 AND consumed_at IS NULL AND expires_at>clock_timestamp()
           AND attempts<max_attempts FOR UPDATE",
    )
    .bind(&digest)
    .fetch_optional(&mut *tx)
    .await?;
    let id = usable.ok_or_else(|| {
        AppError::Unauthorized("MFA enrollment challenge was already used or expired".into())
    })?;
    let secret = TotpEngine::staff_enrollment_secret(&state.config.otp_pepper, challenge_token);
    let Some(step) = TotpEngine::verified_step(&secret, code)? else {
        sqlx::query("UPDATE staff_mfa_challenges SET attempts=attempts+1 WHERE id=$1")
            .bind(id)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        return Err(AppError::Unauthorized(
            "Invalid authenticator code. Check your device time sync.".into(),
        ));
    };
    let hashes: Vec<_> =
        TotpEngine::staff_enrollment_recovery(&state.config.otp_pepper, challenge_token)
            .iter()
            .map(|code| hash_backup_code(code, &secret))
            .collect();
    let encrypted = state.config.totp_keyring.seal(user_id, &secret)?;
    let enabled = sqlx::query(
        "INSERT INTO user_totp_credentials (user_id,secret_key,is_enabled,backup_codes,last_login_totp_step)
         VALUES ($1,$2,TRUE,$3,$4)
         ON CONFLICT (user_id) DO UPDATE SET secret_key=EXCLUDED.secret_key,is_enabled=TRUE,
           backup_codes=EXCLUDED.backup_codes,last_login_totp_step=EXCLUDED.last_login_totp_step,
           updated_at=NOW()
         WHERE NOT user_totp_credentials.is_enabled",
    )
    .bind(user_id)
    .bind(encrypted)
    .bind(hashes)
    .bind(step)
    .execute(&mut *tx)
    .await?;
    if enabled.rows_affected() != 1 {
        return Err(AppError::Conflict(
            "Authenticator is already enabled".into(),
        ));
    }
    let consumed = sqlx::query(
        "UPDATE staff_mfa_challenges SET consumed_at=clock_timestamp()
         WHERE id=$1 AND expires_at>clock_timestamp()",
    )
    .bind(id)
    .execute(&mut *tx)
    .await?;
    if consumed.rows_affected() != 1 {
        return Err(AppError::Unauthorized(
            "MFA enrollment challenge expired".into(),
        ));
    }
    let (challenge_token, _) = create_staff_challenge(&mut *tx, user_id, "login").await?;
    tx.commit().await?;
    Ok(StaffMfaEnrollmentConfirmResponse {
        status: "MFA_ENABLED",
        recovery_codes: Vec::new(),
        challenge_token,
        message: "Authenticator enabled. Save the recovery codes shown during setup.",
    })
}

/// Verifies a challenge-bound TOTP or recovery code and consumes the challenge before issuing a session.
pub async fn verify_staff_mfa(
    state: &AppState,
    req: VerifyStaffMfaRequest,
) -> Result<AuthResponse, AppError> {
    let digest = challenge_digest(&req.challenge_token);
    let row: Option<(Uuid, String)> = sqlx::query_as(
        "SELECT user_id, purpose FROM staff_mfa_challenges WHERE token_hash=$1 AND consumed_at IS NULL AND expires_at>NOW() AND attempts<max_attempts"
    ).bind(&digest).fetch_optional(&state.db).await?;
    let (user_id, purpose) = row
        .ok_or_else(|| AppError::Unauthorized("MFA challenge is invalid or expired".to_string()))?;
    if purpose != "login" {
        return Err(AppError::Forbidden(
            "Authenticator enrollment is required before login.".to_string(),
        ));
    }
    if let Err(err) = crate::auth::totp::verify_staff_totp_login(state, user_id, &req.code).await {
        let _ = sqlx::query("UPDATE staff_mfa_challenges SET attempts=attempts+1 WHERE token_hash=$1 AND consumed_at IS NULL AND expires_at>NOW()")
            .bind(&digest).execute(&state.db).await;
        return Err(err);
    }
    let consumed = sqlx::query("UPDATE staff_mfa_challenges SET consumed_at=NOW() WHERE token_hash=$1 AND consumed_at IS NULL AND expires_at>NOW() AND attempts<max_attempts")
        .bind(&digest).execute(&state.db).await?;
    if consumed.rows_affected() != 1 {
        return Err(AppError::Unauthorized(
            "MFA challenge was already used or expired".to_string(),
        ));
    }
    let user = user_repo::find_by_id(&state.db, user_id)
        .await?
        .ok_or_else(|| AppError::Unauthorized("Account not found".to_string()))?;
    if user.role == "authority" {
        return Err(AppError::Forbidden(
            "Authority must sign in using the dedicated web-only Authority portal".into(),
        ));
    }
    if !user.is_active || !is_email_login_role(&user.role) {
        return Err(AppError::Forbidden(
            "Account is not authorized for staff login.".to_string(),
        ));
    }
    let profile = user_repo::get_user_profile(&state.db, user.id).await?;
    let stored_kyc_status = profile
        .as_ref()
        .map(|p| p.kyc_status.clone())
        .unwrap_or_else(|| "unverified".to_string());
    let kyc_status = if user.role == "customer" {
        crate::routes::digilocker_kyc::effective_customer_kyc_status(
            &state.db,
            user.id,
            &stored_kyc_status,
        )
        .await?
    } else {
        stored_kyc_status
    };
    let verified_name = profile.and_then(|p| p.verified_name);
    let session = crate::auth::refresh::issue_after_auth(
        state,
        user.id,
        &user.role,
        &user.phone,
        user.email.as_deref(),
        state.config.jwt_expiration_hours,
    )
    .await?;
    Ok(AuthResponse {
        success: true,
        token: session.token,
        refresh_token: Some(session.refresh_token),
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

/// Verifies TOTP Authenticator code for second factor or primary passwordless staff login
pub async fn verify_totp_login(
    _state: &AppState,
    _req: VerifyTotpLoginRequest,
) -> Result<AuthResponse, AppError> {
    Err(AppError::Forbidden("Use WhatsApp OTP for customers/drivers or a server-bound email OTP challenge followed by staff MFA".into()))
}

/// WebAuthn remains closed until complete server-side assertion verification.
pub async fn verify_passkey_login(
    _state: &AppState,
    _req: PasskeyLoginVerifyRequest,
) -> Result<AuthResponse, AppError> {
    Err(AppError::Forbidden("Passkey login is not enabled".into()))
}

pub async fn get_current_user_profile(
    state: &AppState,
    user_id: Uuid,
) -> Result<(UserResponse, Option<UserProfile>), AppError> {
    let user = user_repo::find_by_id(&state.db, user_id)
        .await?
        .ok_or_else(|| AppError::NotFound("User not found".to_string()))?;

    let mut profile = user_repo::get_user_profile(&state.db, user.id).await?;
    let stored_kyc_status = profile
        .as_ref()
        .map(|p| p.kyc_status.clone())
        .unwrap_or_else(|| "unverified".to_string());
    let kyc_status = if user.role == "customer" {
        crate::routes::digilocker_kyc::effective_customer_kyc_status(
            &state.db,
            user.id,
            &stored_kyc_status,
        )
        .await?
    } else {
        stored_kyc_status
    };
    // The /api/me response contains both "user" and "profile" surfaces.
    // Keep them consistent; never leak old sandbox status as live VERIFIED.
    if let Some(profile) = profile.as_mut() {
        if user.role == "customer" {
            profile.kyc_status = kyc_status.clone();
        }
    }
    let verified_name = profile.as_ref().and_then(|p| p.verified_name.clone());

    Ok((
        UserResponse {
            id: user.id,
            phone: user.phone,
            email: user.email,
            full_name: user.full_name,
            role: user.role,
            kyc_status,
            verified_name,
        },
        profile,
    ))
}
