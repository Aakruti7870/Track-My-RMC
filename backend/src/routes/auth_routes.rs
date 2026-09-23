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
        VerifyTotpLoginRequest, VerifyWhatsAppOtpRequest,
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
    let (user_resp, profile) = auth_service::get_current_user_profile(&state, auth_user.user_id).await?;
    Ok(Json(json!({
        "success": true,
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

// --- Authenticator App (RFC 6238 TOTP) ---

pub async fn setup_totp(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<impl IntoResponse, AppError> {
    let user_label = auth_user.email.clone().unwrap_or(auth_user.phone.clone());
    let (secret, qr_uri, backup_codes) = setup_totp_for_user(&state.db, auth_user.user_id, &user_label).await?;

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

pub async fn passkey_register_options(
    auth_user: AuthUser,
) -> Result<impl IntoResponse, AppError> {
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
