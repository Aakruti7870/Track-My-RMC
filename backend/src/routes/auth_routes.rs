use crate::{
    auth::{
        passkey::{
            PasskeyEngine, PasskeyLoginOptionsResponse, PasskeyLoginVerifyRequest,
            PasskeyRegisterOptionsResponse, PasskeyRegisterVerifyRequest, PasskeyUserEntity,
            PubKeyCredParam, RelyingParty,
        },
        totp::setup_totp_for_user,
        AuthUser,
    },
    error::AppError,
    models::user::{LoginRequest, RegisterRequest},
    services::auth_service::{
        self, SendEmailOtpRequest, SendWhatsAppOtpRequest, VerifyEmailOtpRequest,
        VerifyStaffMfaRequest, VerifyTotpLoginRequest, VerifyWhatsAppOtpRequest,
    },
    state::AppState,
};
use axum::{extract::State, response::IntoResponse, Json};
use serde::Deserialize;
use serde_json::json;

// --- Traditional Password Auth ---

pub async fn register(
    State(state): State<AppState>,
    Json(payload): Json<RegisterRequest>,
) -> Result<impl IntoResponse, AppError> {
    let auth_res = auth_service::register(&state, payload).await?;
    Ok(Json(auth_res))
}

pub async fn login(
    State(state): State<AppState>,
    Json(payload): Json<LoginRequest>,
) -> Result<impl IntoResponse, AppError> {
    let auth_res = auth_service::login(&state, payload).await?;
    Ok(Json(auth_res))
}

pub async fn get_me(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<impl IntoResponse, AppError> {
    let (user_resp, profile) =
        auth_service::get_current_user_profile(&state, auth_user.user_id).await?;
    let plant_id:Option<uuid::Uuid>=sqlx::query_scalar("SELECT p.id FROM rmc_plants p WHERE p.owner_id=$1 OR EXISTS(SELECT 1 FROM plant_staff s WHERE s.plant_id=p.id AND s.user_id=$1 AND s.is_active) ORDER BY p.created_at,p.id LIMIT 1").bind(auth_user.user_id).fetch_optional(&state.db).await?;
    let mfa_enabled: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM user_totp_credentials WHERE user_id=$1 AND is_enabled)",
    )
    .bind(auth_user.user_id)
    .fetch_one(&state.db)
    .await?;
    let role_label = match user_resp.role.as_str() {
        "owner" | "plant_owner" => "Plant Owner".to_string(),
        other => other
            .split('_')
            .map(|s| {
                let mut c = s.chars();
                c.next()
                    .map(|first| first.to_uppercase().collect::<String>() + c.as_str())
                    .unwrap_or_default()
            })
            .collect::<Vec<_>>()
            .join(" "),
    };
    Ok(Json(json!({
        "success": true,
        "id":user_resp.id,
        "name":user_resp.full_name,
        "email":user_resp.email,
        "phone":user_resp.phone,
        "mobile":user_resp.phone,
        "role":user_resp.role,
        "role_label":role_label,
        "roles":[user_resp.role],
        "plant_id":plant_id,
        "status":"active",
        "kyc_status":if user_resp.kyc_status.eq_ignore_ascii_case("unverified") {"NOT_STARTED".to_string()} else {user_resp.kyc_status.to_uppercase()},
        "mfa_enabled":mfa_enabled,
        "mfa_configured":true,
        "passkey_enabled":false,
        "passkey_count":0,
        "user": user_resp,
        "profile": profile,
    })))
}

// --- User & Driver Authentication: Meta WhatsApp Cloud API OTP ---

pub async fn send_whatsapp_otp(
    State(state): State<AppState>,
    Json(payload): Json<SendWhatsAppOtpRequest>,
) -> Result<impl IntoResponse, AppError> {
    auth_service::send_whatsapp_otp(&state, payload).await?;
    Ok(Json(json!({
        "success": true,
        "message": "Verification code dispatched via WhatsApp"
    })))
}

pub async fn verify_whatsapp_otp(
    State(state): State<AppState>,
    Json(payload): Json<VerifyWhatsAppOtpRequest>,
) -> Result<impl IntoResponse, AppError> {
    let auth_res = auth_service::verify_whatsapp_otp(&state, payload).await?;
    Ok(Json(auth_res))
}

// --- Non-Driver Roles (Staff, Owner, Admin): Email OTP ---

pub async fn send_email_otp(
    State(state): State<AppState>,
    Json(payload): Json<SendEmailOtpRequest>,
) -> Result<impl IntoResponse, AppError> {
    auth_service::send_email_otp(&state, payload).await?;
    Ok(Json(json!({
        "success": true,
        "status": "OTP_SENT",
        "channel": "email",
        "message": "Verification code dispatched to your email address"
    })))
}

pub async fn verify_email_otp(
    State(state): State<AppState>,
    Json(payload): Json<VerifyEmailOtpRequest>,
) -> Result<impl IntoResponse, AppError> {
    let auth_res = auth_service::verify_email_otp(&state, payload).await?;
    Ok(Json(auth_res))
}

#[derive(Deserialize)]
pub struct StaffMfaEnrollmentRequest {
    pub challenge_token: String,
}
#[derive(Deserialize)]
pub struct StaffMfaEnrollmentConfirmRequest {
    pub challenge_token: String,
    pub code: String,
}
pub async fn start_staff_mfa_enrollment(
    State(state): State<AppState>,
    Json(payload): Json<StaffMfaEnrollmentRequest>,
) -> Result<impl IntoResponse, AppError> {
    Ok(Json(
        auth_service::start_staff_mfa_enrollment(&state, &payload.challenge_token).await?,
    ))
}
pub async fn confirm_staff_mfa_enrollment(
    State(state): State<AppState>,
    Json(payload): Json<StaffMfaEnrollmentConfirmRequest>,
) -> Result<impl IntoResponse, AppError> {
    Ok(Json(
        auth_service::confirm_staff_mfa_enrollment(&state, &payload.challenge_token, &payload.code)
            .await?,
    ))
}

// --- Challenge-bound staff MFA: second factor required before JWT issuance ---
pub async fn verify_staff_mfa(
    State(state): State<AppState>,
    Json(payload): Json<VerifyStaffMfaRequest>,
) -> Result<impl IntoResponse, AppError> {
    let auth_res = auth_service::verify_staff_mfa(&state, payload).await?;
    Ok(Json(auth_res))
}

// --- Authenticator App (RFC 6238 TOTP) ---

pub async fn setup_totp(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<impl IntoResponse, AppError> {
    let user_label = auth_user.email.clone().unwrap_or(auth_user.phone.clone());
    let (secret, qr_uri, backup_codes) =
        setup_totp_for_user(&state.db, auth_user.user_id, &user_label).await?;

    Ok(Json(json!({
        "success": true,
        "secret": secret,
        "otpauth_uri": qr_uri,
        "backup_codes": backup_codes,
        "instructions": "Scan the QR code with Google Authenticator, Microsoft Authenticator, or Authy, then verify with a 6-digit code."
    })))
}

#[derive(Deserialize)]
pub struct VerifyTotpSetupRequest {
    pub code: String,
}

pub async fn verify_totp_setup(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Json(payload): Json<VerifyTotpSetupRequest>,
) -> Result<impl IntoResponse, AppError> {
    crate::auth::totp::verify_and_enable_totp(&state.db, auth_user.user_id, &payload.code).await?;
    Ok(Json(json!({
        "success": true,
        "message": "TOTP Authenticator successfully enabled on your account."
    })))
}

pub async fn totp_login(
    State(state): State<AppState>,
    Json(payload): Json<VerifyTotpLoginRequest>,
) -> Result<impl IntoResponse, AppError> {
    let auth_res = auth_service::verify_totp_login(&state, payload).await?;
    Ok(Json(auth_res))
}

// --- FIDO2 / WebAuthn Passkeys ---

pub async fn passkey_register_options(auth_user: AuthUser) -> Result<impl IntoResponse, AppError> {
    let challenge = PasskeyEngine::generate_challenge();
    let resp = PasskeyRegisterOptionsResponse {
        challenge,
        rp: RelyingParty {
            name: "TrackMyRMC Enterprise".to_string(),
            id: "trackmyrmc.com".to_string(),
        },
        user: PasskeyUserEntity {
            id: auth_user.user_id.to_string(),
            name: auth_user.email.unwrap_or(auth_user.phone.clone()),
            display_name: auth_user.phone,
        },
        pub_key_cred_params: vec![
            PubKeyCredParam {
                cred_type: "public-key".to_string(),
                alg: -7, // ES256
            },
            PubKeyCredParam {
                cred_type: "public-key".to_string(),
                alg: -257, // RS256
            },
        ],
        timeout: 60000,
        attestation: "none".to_string(),
    };

    Ok(Json(resp))
}

pub async fn passkey_register_verify(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Json(payload): Json<PasskeyRegisterVerifyRequest>,
) -> Result<impl IntoResponse, AppError> {
    PasskeyEngine::register_credential(&state.db, auth_user.user_id, payload).await?;
    Ok(Json(json!({
        "success": true,
        "message": "Passkey successfully registered and bound to your account."
    })))
}

pub async fn passkey_login_options() -> impl IntoResponse {
    let challenge = PasskeyEngine::generate_challenge();
    Json(PasskeyLoginOptionsResponse {
        challenge,
        timeout: 60000,
        rp_id: "trackmyrmc.com".to_string(),
        user_verification: "preferred".to_string(),
    })
}

pub async fn passkey_login_verify(
    State(state): State<AppState>,
    Json(payload): Json<PasskeyLoginVerifyRequest>,
) -> Result<impl IntoResponse, AppError> {
    let auth_res = auth_service::verify_passkey_login(&state, payload).await?;
    Ok(Json(auth_res))
}

pub async fn logout(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<impl IntoResponse, AppError> {
    sqlx::query("UPDATE users SET auth_revoked_at=NOW(), updated_at=NOW() WHERE id=$1")
        .bind(auth_user.user_id)
        .execute(&state.db)
        .await?;

    Ok(Json(json!({
        "success": true,
        "message": "Session revoked"
    })))
}

#[derive(Deserialize)]
pub struct StaffAuthMethodRequest {
    pub identifier: String,
}

pub async fn staff_mfa_method(
    State(state): State<AppState>,
    Json(payload): Json<StaffAuthMethodRequest>,
) -> Result<impl IntoResponse, AppError> {
    let email = payload.identifier.trim().to_lowercase();
    let user = crate::repositories::user_repo::find_by_phone_or_email(&state.db, &email)
        .await?
        .ok_or_else(|| AppError::NotFound("Account not found".to_string()))?;

    let enabled: Option<bool> =
        sqlx::query_scalar("SELECT is_enabled FROM user_totp_credentials WHERE user_id=$1")
            .bind(user.id)
            .fetch_optional(&state.db)
            .await?;

    let has_totp = enabled == Some(true);
    Ok(Json(json!({
        "status": if has_totp { "AUTHENTICATOR_REQUIRED" } else { "EMAIL_OTP_REQUIRED" },
        "email": email,
        "method": if has_totp { "totp" } else { "email_otp" },
        "recovery_available": has_totp,
        "message": if has_totp { "Authenticator code required" } else { "Email OTP verification required" }
    })))
}
