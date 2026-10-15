//! Real HTTP handlers, OTP hashing/consumption, MFA and PostgreSQL persistence.
//! Delivery is injected in memory; no live provider or fixed OTP is used.
use axum::{
    async_trait,
    body::{to_bytes, Body},
    http::{Request, StatusCode},
    Router,
};
use serde_json::{json, Value};
use sqlx::PgPool;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use tower::ServiceExt;
use trackmyrmc_backend::{
    auth::{
        otp::{OtpEngine, OtpSessionInput},
        totp::TotpEngine,
    },
    config::AppConfig,
    error::AppError,
    routes::build_app_router,
    services::otp_delivery::OtpDelivery,
    state::AppState,
};
use uuid::Uuid;

#[derive(Default)]
struct MemoryDelivery {
    messages: Mutex<Vec<(String, String, String)>>,
    reject: AtomicBool,
}

impl MemoryDelivery {
    fn take_code(&self, destination: &str) -> String {
        let mut messages = self.messages.lock().unwrap();
        let index = messages
            .iter()
            .position(|(_, to, _)| to == destination)
            .unwrap();
        messages.remove(index).2
    }
}

#[async_trait]
impl OtpDelivery for MemoryDelivery {
    fn validate(&self, _: &str) -> Result<(), AppError> {
        Ok(())
    }

    async fn send(
        &self,
        channel: &str,
        destination: &str,
        otp: &str,
        _: &str,
    ) -> Result<(), AppError> {
        if self.reject.load(Ordering::SeqCst) {
            return Err(AppError::InternalError(
                "Synthetic delivery rejection".into(),
            ));
        }
        self.messages
            .lock()
            .unwrap()
            .push((channel.into(), destination.into(), otp.into()));
        Ok(())
    }
}

fn state(db: PgPool) -> AppState {
    AppState::new(
        db,
        AppConfig {
            database_url: String::new(),
            jwt_secret: "isolated-auth-test".repeat(8),
            jwt_expiration_hours: 1,
            port: 8000,
            host: "127.0.0.1".into(),
            cors_allowed_origins: vec![],
            environment: "test".into(),
            meta_whatsapp_token: None,
            meta_whatsapp_phone_number_id: None,
            meta_whatsapp_waba_id: None,
            meta_graph_api_version: "v26.0".into(),
            email_api_key: None,
            email_from_address: "test@example.invalid".into(),
            otp_pepper: "isolated-auth-test".repeat(5),
            otp_expiration_minutes: 5,
            otp_cooldown_seconds: 0,
            otp_max_verification_attempts: 3,
            play_signing_sha256: None,
            play_review_access_code: None,
            google_places_api_key: None,
        },
    )
}

async fn call(
    app: &Router,
    path: &str,
    body: Option<Value>,
    token: Option<&str>,
) -> (StatusCode, Value) {
    let mut request =
        Request::builder()
            .uri(path)
            .method(if body.is_some() { "POST" } else { "GET" });
    if let Some(token) = token {
        request = request.header("Authorization", format!("Bearer {token}"));
    }
    let response = app
        .clone()
        .oneshot(
            request
                .header("Content-Type", "application/json")
                .body(Body::from(body.map(|b| b.to_string()).unwrap_or_default()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 100000).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap())
}

async fn identity(db: &PgPool, role: &str, email: Option<&str>, phone: Option<&str>) -> Uuid {
    let generated_phone = Uuid::new_v4().simple().to_string()[..18].to_string();
    sqlx::query_scalar("INSERT INTO users (phone,email,hashed_password,full_name,role) VALUES ($1,$2,'unused','Synthetic Test',$3) RETURNING id")
        .bind(phone.unwrap_or(&generated_phone)).bind(email).bind(role).fetch_one(db).await.unwrap()
}

async fn email_challenge(app: &Router, delivery: &MemoryDelivery, email: &str) -> Value {
    assert_eq!(
        call(
            app,
            "/api/auth/otp/email/send",
            Some(json!({"email":email})),
            None
        )
        .await
        .0,
        StatusCode::OK
    );
    let otp = delivery.take_code(email);
    let (status, challenge) = call(
        app,
        "/api/auth/otp/email/verify",
        Some(json!({"email":email,"otp":otp})),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(challenge.get("token").is_none());
    challenge
}

#[sqlx::test]
async fn approved_staff_fixtures_complete_email_enrollment_mfa_recovery_and_logout(db: PgPool) {
    let mut state = state(db.clone());
    let delivery = Arc::new(MemoryDelivery::default());
    state.otp_delivery = delivery.clone();
    let app = build_app_router(state);
    let fixtures: Value =
        serde_json::from_str(include_str!("fixtures/staging_identities.json")).unwrap();
    for fixture in fixtures["users"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|f| f["email"].is_string())
    {
        let role = fixture["role"].as_str().unwrap();
        let email = fixture["email"].as_str().unwrap();
        identity(&db, role, Some(email), None).await;
        let challenge = email_challenge(&app, &delivery, email).await;
        assert_eq!(challenge["status"], "MFA_ENROLLMENT_REQUIRED");
        assert_eq!(
            call(
                &app,
                "/api/auth/staff/mfa/verify-totp",
                Some(json!({"challenge_token":challenge["challenge_token"],"code":"invalid"})),
                None
            )
            .await
            .0,
            StatusCode::FORBIDDEN
        );
        let (status, enrollment) = call(
            &app,
            "/api/auth/staff/mfa/enroll/start",
            Some(json!({"challenge_token":challenge["challenge_token"]})),
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        let code = TotpEngine::compute_code(
            enrollment["manual_key"].as_str().unwrap(),
            chrono::Utc::now().timestamp() as u64,
        )
        .unwrap();
        let (status, enabled) = call(
            &app,
            "/api/auth/staff/mfa/enroll/confirm",
            Some(json!({"challenge_token":challenge["challenge_token"],"code":code})),
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        let (status, auth) = call(
            &app,
            "/api/auth/staff/mfa/verify-totp",
            Some(json!({"challenge_token":enabled["challenge_token"],"code":code})),
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(auth["role"].as_str(), Some(role));
        let token = auth["token"].as_str().unwrap();
        assert_eq!(
            call(&app, "/api/me", None, Some(token)).await.0,
            StatusCode::OK
        );
        assert_eq!(
            call(
                &app,
                "/api/auth/staff/mfa/verify-totp",
                Some(json!({"challenge_token":enabled["challenge_token"],"code":code})),
                None
            )
            .await
            .0,
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(
            call(&app, "/api/auth/logout", Some(json!({})), Some(token))
                .await
                .0,
            StatusCode::OK
        );
        assert_eq!(
            call(&app, "/api/me", None, Some(token)).await.0,
            StatusCode::UNAUTHORIZED
        );

        let challenge = email_challenge(&app, &delivery, email).await;
        assert_eq!(challenge["status"], "MFA_REQUIRED");
        let recovery = &enrollment["recovery_codes"][0];
        assert_eq!(
            call(
                &app,
                "/api/auth/staff/mfa/verify-recovery",
                Some(json!({"challenge_token":challenge["challenge_token"],"code":recovery})),
                None
            )
            .await
            .0,
            StatusCode::OK
        );
        let challenge = email_challenge(&app, &delivery, email).await;
        assert_eq!(
            call(
                &app,
                "/api/auth/staff/mfa/verify-recovery",
                Some(json!({"challenge_token":challenge["challenge_token"],"code":recovery})),
                None
            )
            .await
            .0,
            StatusCode::UNAUTHORIZED
        );
    }
    assert!(delivery.messages.lock().unwrap().is_empty());
}

#[sqlx::test]
async fn approved_customer_driver_fixtures_complete_generated_whatsapp_otp_once(db: PgPool) {
    let mut state = state(db.clone());
    let delivery = Arc::new(MemoryDelivery::default());
    state.otp_delivery = delivery.clone();
    let app = build_app_router(state);
    for (role, phone) in [("customer", "12025550101"), ("driver", "12025550102")] {
        identity(&db, role, None, Some(phone)).await;
        assert_eq!(
            call(
                &app,
                "/api/auth/otp/whatsapp/send",
                Some(json!({"phone":format!("+{phone}")})),
                None
            )
            .await
            .0,
            StatusCode::OK
        );
        let code = delivery.take_code(phone);
        let payload = json!({"phone":format!("+{phone}"),"otp":code});
        let (status, auth) = call(
            &app,
            "/api/auth/otp/whatsapp/verify",
            Some(payload.clone()),
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(auth["role"].as_str(), Some(role));
        assert_eq!(
            call(&app, "/api/me", None, auth["token"].as_str()).await.0,
            StatusCode::OK
        );
        assert_eq!(
            call(&app, "/api/auth/otp/whatsapp/verify", Some(payload), None)
                .await
                .0,
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(
            call(
                &app,
                "/api/auth/otp/email/send",
                Some(json!({"email":phone})),
                None
            )
            .await
            .0,
            StatusCode::FORBIDDEN
        );
    }
}

#[sqlx::test]
async fn missing_or_rejected_delivery_never_activates_email_and_preserves_previous_otp(db: PgPool) {
    let mut state = state(db.clone());
    let email = "staging-owner@example.invalid";
    identity(&db, "owner", Some(email), None).await;
    let app = build_app_router(state.clone());
    assert_eq!(
        call(
            &app,
            "/api/auth/otp/email/send",
            Some(json!({"email":email})),
            None
        )
        .await
        .0,
        StatusCode::INTERNAL_SERVER_ERROR
    );
    let (otp, salt, hashed) = OtpEngine::generate_secure_otp(&state.config.otp_pepper);
    OtpEngine::create_session(
        &db,
        OtpSessionInput {
            destination: email,
            channel: "email",
            purpose: "staff_login",
            salt: &salt,
            hashed_otp: &hashed,
            expiration_minutes: 5,
            max_attempts: 3,
        },
    )
    .await
    .unwrap();
    let delivery = Arc::new(MemoryDelivery::default());
    delivery.reject.store(true, Ordering::SeqCst);
    state.otp_delivery = delivery;
    let app = build_app_router(state);
    assert_eq!(
        call(
            &app,
            "/api/auth/otp/email/send",
            Some(json!({"email":email})),
            None
        )
        .await
        .0,
        StatusCode::INTERNAL_SERVER_ERROR
    );
    let counts: (i64, i64) = sqlx::query_as("SELECT COUNT(*),COUNT(*) FILTER (WHERE is_pending) FROM otp_verifications WHERE destination=$1").bind(email).fetch_one(&db).await.unwrap();
    assert_eq!(counts, (1, 0));
    assert_eq!(
        call(
            &app,
            "/api/auth/otp/email/verify",
            Some(json!({"email":email,"otp":otp})),
            None
        )
        .await
        .0,
        StatusCode::OK
    );
}

#[sqlx::test]
async fn staff_challenges_cannot_be_reused_after_role_becomes_privileged(db: PgPool) {
    let mut state = state(db.clone());
    let delivery = Arc::new(MemoryDelivery::default());
    state.otp_delivery = delivery.clone();
    let app = build_app_router(state);
    let email = "staging-owner@example.invalid";
    let id = identity(&db, "owner", Some(email), None).await;
    let challenge = email_challenge(&app, &delivery, email).await;
    // A database role change is a negative test, never a persistent account enrollment.
    sqlx::query("UPDATE users SET role='central_admin' WHERE id=$1")
        .bind(id)
        .execute(&db)
        .await
        .unwrap();
    assert_eq!(
        call(
            &app,
            "/api/auth/staff/mfa/enroll/start",
            Some(json!({"challenge_token":challenge["challenge_token"]})),
            None
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        call(
            &app,
            "/api/auth/otp/email/send",
            Some(json!({"email":email})),
            None
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
}
