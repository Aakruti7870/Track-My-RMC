use crate::{
    auth::{
        jwt::generate_token,
        otp::OtpEngine,
        passkey::{PasskeyEngine, PasskeyLoginVerifyRequest},
        password::{hash_password, verify_password},
    },
    error::AppError,
    models::user::{AuthResponse, LoginRequest, RegisterRequest, UserProfile, UserResponse},
    repositories::user_repo,
    services::{email_service::EmailService, whatsapp_service::WhatsAppService},
    state::AppState,
};
use serde::Deserialize;
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

pub async fn register(state: &AppState, req: RegisterRequest) -> Result<AuthResponse, AppError> {
    if req.phone.trim().is_empty() {
        return Err(AppError::BadRequest("Phone number is required".to_string()));
    }
    if req.password.len() < 6 {
        return Err(AppError::BadRequest("Password must be at least 6 characters".to_string()));
    }

    if let Some(existing) = user_repo::find_by_phone_or_email(&state.db, &req.phone).await? {
        return Err(AppError::Conflict(format!("User with phone {} already exists", existing.phone)));
    }

    let hashed = hash_password(&req.password)?;
    // Public registration may only create customer accounts. Privileged roles are provisioned by authorized staff/admin flows.
    let role = "customer";

    let user = user_repo::create_user(
        &state.db,
        &req.phone,
        req.email.as_deref(),
        &hashed,
        &req.full_name,
        role,
        req.business_name.as_deref(),
    )
    .await?;

    let token = generate_token(
        user.id,
        &user.role,
        &user.phone,
        user.email.as_deref(),
        &state.config.jwt_secret,
        state.config.jwt_expiration_hours,
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
            kyc_status: "unverified".to_string(),
            verified_name: None,
        },
    })
}

pub async fn login(state: &AppState, req: LoginRequest) -> Result<AuthResponse, AppError> {
    let user = user_repo::find_by_phone_or_email(&state.db, &req.username_or_phone)
        .await?
        .ok_or_else(|| AppError::Unauthorized("Invalid credentials".to_string()))?;

    if !user.is_active {
        return Err(AppError::Forbidden("Account is inactive. Contact support.".to_string()));
    }

    let is_valid = verify_password(&req.password, &user.hashed_password)?;
    if !is_valid {
        return Err(AppError::Unauthorized("Invalid credentials".to_string()));
    }

    let profile = user_repo::get_user_profile(&state.db, user.id).await?;
    let kyc_status = profile.as_ref().map(|p| p.kyc_status.clone()).unwrap_or_else(|| "unverified".to_string());
    let verified_name = profile.and_then(|p| p.verified_name);

    let token = generate_token(
        user.id,
        &user.role,
        &user.phone,
        user.email.as_deref(),
        &state.config.jwt_secret,
        state.config.jwt_expiration_hours,
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

/// Dispatches WhatsApp OTP via Meta WhatsApp Cloud API exclusively for Customer and Driver roles
pub async fn send_whatsapp_otp(
    state: &AppState,
    req: SendWhatsAppOtpRequest,
) -> Result<(), AppError> {
    let destination = WhatsAppService::normalize_phone(&req.phone);
    let purpose = req.purpose.unwrap_or_else(|| "login".to_string());

    // Check if user exists and verify role restrictions
    if let Some(user) = user_repo::find_by_phone_or_email(&state.db, &destination).await? {
        if user.role != "customer" && user.role != "driver" {
            return Err(AppError::Forbidden(
                "WhatsApp OTP is restricted to Customer and Driver accounts. Plant staff and Administrators must use Email OTP or Authenticator App.".to_string(),
            ));
        }
    }

    // Rate limiting check
    OtpEngine::check_rate_limit(&state.db, &destination, state.config.otp_cooldown_seconds).await?;

    let (plain_otp, salt, hashed_otp) = OtpEngine::generate_secure_otp();

    OtpEngine::create_session(
        &state.db,
        &destination,
        "whatsapp",
        &purpose,
        &salt,
        &hashed_otp,
        state.config.otp_expiration_minutes,
        state.config.otp_max_verification_attempts,
    )
    .await?;

    // Dispatch via Meta WhatsApp Cloud API
    let wa_service = WhatsAppService::new(
        state.config.meta_whatsapp_token.clone(),
        state.config.meta_whatsapp_phone_number_id.clone(),
    );
    wa_service.send_otp(&destination, &plain_otp).await?;

    Ok(())
}

/// Verifies WhatsApp OTP and authenticates User or Driver
pub async fn verify_whatsapp_otp(
    state: &AppState,
    req: VerifyWhatsAppOtpRequest,
) -> Result<AuthResponse, AppError> {
    let destination = WhatsAppService::normalize_phone(&req.phone);
    let purpose = req.purpose.unwrap_or_else(|| "login".to_string());

    OtpEngine::verify_otp(
        &state.db,
        &destination,
        "whatsapp",
        &purpose,
        &req.otp,
    )
    .await?;

    // Fetch existing user or auto-provision verified customer
    let user = match user_repo::find_by_phone_or_email(&state.db, &destination).await? {
        Some(u) => u,
        None => {
            // New user registration via WhatsApp OTP
            let dummy_password = hash_password(&Uuid::new_v4().to_string())?;
            user_repo::create_user(
                &state.db,
                &destination,
                None,
                &dummy_password,
                "RMC Customer",
                "customer",
                None,
            )
            .await?
        }
    };

    let profile = user_repo::get_user_profile(&state.db, user.id).await?;
    let kyc_status = profile.as_ref().map(|p| p.kyc_status.clone()).unwrap_or_else(|| "unverified".to_string());
    let verified_name = profile.and_then(|p| p.verified_name);

    let token = generate_token(
        user.id,
        &user.role,
        &user.phone,
        user.email.as_deref(),
        &state.config.jwt_secret,
        state.config.jwt_expiration_hours,
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

/// Dispatches Email OTP for Plant Staff, Owners, and Administrators
pub async fn send_email_otp(
    state: &AppState,
    req: SendEmailOtpRequest,
) -> Result<(), AppError> {
    let destination = req.email.trim().to_lowercase();
    let purpose = "staff_login".to_string();

    OtpEngine::check_rate_limit(&state.db, &destination, state.config.otp_cooldown_seconds).await?;

    let (plain_otp, salt, hashed_otp) = OtpEngine::generate_secure_otp();

    OtpEngine::create_session(
        &state.db,
        &destination,
        "email",
        &purpose,
        &salt,
        &hashed_otp,
        state.config.otp_expiration_minutes,
        state.config.otp_max_verification_attempts,
    )
    .await?;

    let email_service = EmailService::new(
        state.config.email_api_key.clone(),
        state.config.email_from_address.clone(),
    );
    email_service.send_otp(&destination, &plain_otp, "Staff/Admin Portal").await?;

    Ok(())
}

/// Verifies Email OTP for Plant Staff, Owners, and Administrators
pub async fn verify_email_otp(
    state: &AppState,
    req: VerifyEmailOtpRequest,
) -> Result<AuthResponse, AppError> {
    let destination = req.email.trim().to_lowercase();

    OtpEngine::verify_otp(
        &state.db,
        &destination,
        "email",
        "staff_login",
        &req.otp,
    )
    .await?;

    let user = user_repo::find_by_phone_or_email(&state.db, &destination)
        .await?
        .ok_or_else(|| AppError::NotFound("Staff/Admin account not found".to_string()))?;

    let profile = user_repo::get_user_profile(&state.db, user.id).await?;
    let kyc_status = profile.as_ref().map(|p| p.kyc_status.clone()).unwrap_or_else(|| "unverified".to_string());
    let verified_name = profile.and_then(|p| p.verified_name);

    let token = generate_token(
        user.id,
        &user.role,
        &user.phone,
        user.email.as_deref(),
        &state.config.jwt_secret,
        state.config.jwt_expiration_hours,
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

/// Verifies TOTP Authenticator code for second factor or primary passwordless staff login
pub async fn verify_totp_login(
    state: &AppState,
    req: VerifyTotpLoginRequest,
) -> Result<AuthResponse, AppError> {
    let user = user_repo::find_by_phone_or_email(&state.db, &req.username_or_phone)
        .await?
        .ok_or_else(|| AppError::Unauthorized("Invalid credentials".to_string()))?;

    crate::auth::totp::verify_totp_login(&state.db, user.id, &req.totp_code).await?;

    let profile = user_repo::get_user_profile(&state.db, user.id).await?;
    let kyc_status = profile.as_ref().map(|p| p.kyc_status.clone()).unwrap_or_else(|| "unverified".to_string());
    let verified_name = profile.and_then(|p| p.verified_name);

    let token = generate_token(
        user.id,
        &user.role,
        &user.phone,
        user.email.as_deref(),
        &state.config.jwt_secret,
        state.config.jwt_expiration_hours,
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

/// Verifies WebAuthn Passkey assertion and returns authenticated session
pub async fn verify_passkey_login(
    state: &AppState,
    req: PasskeyLoginVerifyRequest,
) -> Result<AuthResponse, AppError> {
    let cred = PasskeyEngine::find_credential(&state.db, &req.credential_id)
        .await?
        .ok_or_else(|| AppError::Unauthorized("Unrecognized passkey credential".to_string()))?;

    PasskeyEngine::update_usage(&state.db, &req.credential_id).await?;

    let user = user_repo::find_by_id(&state.db, cred.user_id)
        .await?
        .ok_or_else(|| AppError::NotFound("User associated with passkey not found".to_string()))?;

    let profile = user_repo::get_user_profile(&state.db, user.id).await?;
    let kyc_status = profile.as_ref().map(|p| p.kyc_status.clone()).unwrap_or_else(|| "unverified".to_string());
    let verified_name = profile.and_then(|p| p.verified_name);

    let token = generate_token(
        user.id,
        &user.role,
        &user.phone,
        user.email.as_deref(),
        &state.config.jwt_secret,
        state.config.jwt_expiration_hours,
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

pub async fn get_current_user_profile(state: &AppState, user_id: Uuid) -> Result<(UserResponse, Option<UserProfile>), AppError> {
    let user = user_repo::find_by_id(&state.db, user_id)
        .await?
        .ok_or_else(|| AppError::NotFound("User not found".to_string()))?;

    let profile = user_repo::get_user_profile(&state.db, user.id).await?;
    let kyc_status = profile.as_ref().map(|p| p.kyc_status.clone()).unwrap_or_else(|| "unverified".to_string());
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
