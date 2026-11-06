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

#[sqlx::test]
async fn signed_in_deletion_requires_fresh_purpose_and_account_bound_otp(db: PgPool) {
    let mut state = state(db.clone());
    let delivery = Arc::new(MemoryDelivery::default());
    state.otp_delivery = delivery.clone();
    let phone = "12025550171";
    let other_phone = "12025550172";
    let user_id = identity(&db, "customer", None, Some(phone)).await;
    identity(&db, "customer", None, Some(other_phone)).await;
    let token = trackmyrmc_backend::auth::jwt::generate_token(
        user_id,
        "customer",
        phone,
        None,
        &state.config.jwt_secret,
        1,
    )
    .unwrap();
    let app = build_app_router(state);
    let path = "/api/account-deletion/request";

    // A bearer session and typed confirmation alone cannot submit a request.
    assert!(!call(
        &app,
        path,
        Some(json!({"confirm":"DELETE","code":"123456"})),
        Some(&token)
    )
    .await
    .0
    .is_success());

    // Even an otherwise valid login OTP cannot authorize account deletion.
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
    let login_code = delivery.take_code(phone);
    assert!(!call(
        &app,
        path,
        Some(json!({"confirm":"DELETE","code":login_code})),
        Some(&token)
    )
    .await
    .0
    .is_success());

    // A different customer's deletion code is also insufficient.
    assert_eq!(
        call(
            &app,
            "/api/account-deletion/otp/send",
            Some(json!({"identifier":other_phone})),
            None
        )
        .await
        .0,
        StatusCode::OK
    );
    let other_code = delivery.take_code(other_phone);
    assert!(!call(
        &app,
        path,
        Some(json!({"confirm":"DELETE","code":other_code})),
        Some(&token)
    )
    .await
    .0
    .is_success());
    let count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM account_deletion_requests WHERE user_id=$1")
            .bind(user_id)
            .fetch_one(&db)
            .await
            .unwrap();
    assert_eq!(count, 0);

    assert_eq!(
        call(
            &app,
            "/api/account-deletion/otp/send",
            Some(json!({"identifier":phone})),
            None
        )
        .await
        .0,
        StatusCode::OK
    );
    let code = delivery.take_code(phone);
    let payload = json!({"confirm":"DELETE","code":code});
    assert_eq!(
        call(&app, path, Some(payload.clone()), Some(&token))
            .await
            .0,
        StatusCode::OK
    );
    assert!(!call(&app, path, Some(payload), Some(&token))
        .await
        .0
        .is_success());
    let status = call(&app, "/api/account-deletion/status", None, Some(&token)).await;
    assert_eq!(status.1["request"]["status"], "PENDING");
    // Submission records a cancellable request; it does not delete the account.
    assert_eq!(
        call(&app, "/api/me", None, Some(&token)).await.0,
        StatusCode::OK
    );
}

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
    sqlx::query_scalar("INSERT INTO users (phone,email,hashed_password,full_name,role,work_email_verified_at) VALUES ($1,$2,'unused','Synthetic Test',$3,CASE WHEN $2 IS NOT NULL THEN NOW() END) RETURNING id")
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
    // Synthetic staff must be provisioned to an approved plant before login.
    // This verifies the production authorization rule rather than bypassing it.
    let plant_owner = identity(&db, "owner", None, None).await;
    let plant: Uuid = sqlx::query_scalar(
        "INSERT INTO rmc_plants (owner_id,name,code,latitude,longitude,
          address_line,city,state,pincode,contact_phone)
         VALUES ($1,'Auth CI Plant',$2,0,0,'CI Address','CI','MH','410206','000')
         RETURNING id",
    )
    .bind(plant_owner)
    .bind(Uuid::new_v4().simple().to_string())
    .fetch_one(&db)
    .await
    .unwrap();
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
        let staff_id = identity(&db, role, Some(email), None).await;
        if role != "plant_owner" && role != "owner" {
            sqlx::query(
                "INSERT INTO plant_staff (plant_id,user_id,role,is_active)
                 VALUES ($1,$2,$3,TRUE)",
            )
            .bind(plant)
            .bind(staff_id)
            .bind(role)
            .execute(&db)
            .await
            .unwrap();
        }
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
        let (status, me) = call(&app, "/api/me", None, Some(token)).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(me["role"].as_str(), Some(role));
        assert_eq!(me["name"], "Synthetic Test");
        assert_eq!(me["id"], auth["user"]["id"]);
        assert_eq!(me["mfa_enabled"], true);
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
        let replay = email_challenge(&app, &delivery, email).await;
        assert_eq!(
            call(
                &app,
                "/api/auth/staff/mfa/verify-totp",
                Some(json!({"challenge_token":replay["challenge_token"],"code":code})),
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
        let (status, recovered) = call(
            &app,
            "/api/auth/staff/mfa/verify-recovery",
            Some(json!({"challenge_token":challenge["challenge_token"],"code":recovery})),
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            call(&app, "/api/me", None, recovered["token"].as_str())
                .await
                .0,
            StatusCode::OK
        );
        assert_eq!(
            call(&app, "/api/me", None, Some(token)).await.0,
            StatusCode::UNAUTHORIZED
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

#[sqlx::test]
async fn legacy_password_registration_and_unbound_totp_cannot_issue_sessions(db: PgPool) {
    let state = state(db.clone());
    let id = identity(&db, "customer", None, Some("12025550101")).await;
    let secret = TotpEngine::generate_secret();
    sqlx::query(
        "INSERT INTO user_totp_credentials(user_id,secret_key,is_enabled) VALUES($1,$2,TRUE)",
    )
    .bind(id)
    .bind(&secret)
    .execute(&db)
    .await
    .unwrap();
    let app = build_app_router(state);
    assert_eq!(call(&app,"/api/auth/register",Some(json!({"phone":"12025550102","password":"unused-synthetic-value","full_name":"Synthetic Test","role":"admin"})),None).await.0,StatusCode::FORBIDDEN);
    assert_eq!(
        call(
            &app,
            "/api/auth/login",
            Some(json!({"username_or_phone":"12025550101","password":"unused-synthetic-value"})),
            None
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    let code = TotpEngine::compute_code(&secret, chrono::Utc::now().timestamp() as u64).unwrap();
    assert_eq!(
        call(
            &app,
            "/api/auth/totp/login",
            Some(json!({"username_or_phone":"12025550101","totp_code":code})),
            None
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert!(!sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM users WHERE phone='12025550102')"
    )
    .fetch_one(&db)
    .await
    .unwrap());
}

// Google Play Owner fixtures must never be redirected into ordinary staff
// Authenticator enrollment. The fixture's reviewer code is checked separately,
// and live Plant Staff accounts must still report mandatory MFA setup.
#[sqlx::test]
async fn play_review_owner_session_skips_staff_enrollment_without_weakening_staff_mfa(db: PgPool) {
    let mut isolated = state(db.clone());
    let mut config = (*isolated.config).clone();
    config.play_review_access_code = Some("654321".to_string());
    isolated.config = Arc::new(config);
    let reviewer = build_app_router(isolated.clone());

    let (login_status, login) = call(
        &reviewer,
        "/api/auth/play-review",
        Some(json!({"role":"plant_owner","access_code":"654321"})),
        None,
    )
    .await;
    assert_eq!(
        login_status,
        StatusCode::OK,
        "Play review fixture login must succeed: {login}"
    );
    let reviewer_token = login["token"].as_str().expect("review JWT");
    let (me_status, review_me) = call(&reviewer, "/api/me", None, Some(reviewer_token)).await;
    assert_eq!(me_status, StatusCode::OK);
    assert_eq!(review_me["role"], "owner");
    assert_eq!(review_me["mfa_enabled"], false);
    assert_eq!(review_me["mfa_configured"], false);
    assert!(!review_me["plant_id"].is_null());

    // A review session token is NOT an MFA enrollment challenge. The backend
    // stays fail-closed even though its /me response no longer triggers the UI.
    let (challenge_status, _) = call(
        &reviewer,
        "/api/auth/staff/mfa/enroll/start",
        Some(json!({"challenge_token":reviewer_token})),
        None,
    )
    .await;
    assert_eq!(challenge_status, StatusCode::UNAUTHORIZED);

    let staff_email = "normal-plant-staff@example.invalid";
    let staff_user = identity(&db, "owner", Some(staff_email), None).await;
    let staff_token = trackmyrmc_backend::auth::jwt::generate_token(
        staff_user,
        "owner",
        "12025550149",
        Some(staff_email),
        &isolated.config.jwt_secret,
        1,
    )
    .unwrap();
    let (normal_status, normal_me) = call(&reviewer, "/api/me", None, Some(&staff_token)).await;
    assert_eq!(normal_status, StatusCode::OK);
    assert_eq!(normal_me["mfa_enabled"], false);
    assert_eq!(normal_me["mfa_configured"], true);
}

#[sqlx::test]
async fn rotating_refresh_rejects_replay_replacement_and_revocation(db: PgPool) {
    use trackmyrmc_backend::auth::{account_sessions, jwt::verify_token, refresh};
    let state = state(db.clone());
    let user = identity(&db, "customer", None, None).await;
    let phone: String = sqlx::query_scalar("SELECT phone FROM users WHERE id=$1")
        .bind(user)
        .fetch_one(&db)
        .await
        .unwrap();

    let initial = refresh::issue_after_auth(&state, user, "customer", &phone, None, 1)
        .await
        .unwrap();
    let app = build_app_router(state.clone());
    assert_eq!(
        call(&app, "/api/me", None, Some(&initial.token)).await.0,
        StatusCode::OK
    );
    let (status, renewed) = call(
        &app,
        "/api/auth/refresh",
        Some(json!({"refresh_token":initial.refresh_token})),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let renewed_access = renewed["access_token"].as_str().unwrap();
    let renewed_refresh = renewed["refresh_token"].as_str().unwrap();
    assert_ne!(renewed_refresh, initial.refresh_token);
    assert_eq!(
        call(&app, "/api/me", None, Some(&initial.token)).await.0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        call(&app, "/api/me", None, Some(renewed_access)).await.0,
        StatusCode::OK
    );

    // Replaying the consumed credential must not yield another access JWT.
    assert_eq!(
        call(
            &app,
            "/api/auth/refresh",
            Some(json!({"refresh_token":initial.refresh_token})),
            None
        )
        .await
        .0,
        StatusCode::UNAUTHORIZED
    );

    // A new fully verified login replaces both the earlier JWT and refresh token.
    let second = refresh::issue_after_auth(&state, user, "customer", &phone, None, 1)
        .await
        .unwrap();
    assert_eq!(
        call(
            &app,
            "/api/auth/refresh",
            Some(json!({"refresh_token":renewed_refresh})),
            None
        )
        .await
        .0,
        StatusCode::UNAUTHORIZED
    );
    let jti = verify_token(&second.token, &state.config.jwt_secret)
        .unwrap()
        .jti
        .unwrap();
    account_sessions::revoke_current(&state, user, jti)
        .await
        .unwrap();
    assert_eq!(
        call(
            &app,
            "/api/auth/refresh",
            Some(json!({"refresh_token":second.refresh_token})),
            None
        )
        .await
        .0,
        StatusCode::UNAUTHORIZED
    );
}

#[sqlx::test]
async fn rotating_refresh_rejects_suspended_identity(db: PgPool) {
    use trackmyrmc_backend::auth::refresh;
    let state = state(db.clone());
    let user = identity(&db, "customer", None, None).await;
    let phone: String = sqlx::query_scalar("SELECT phone FROM users WHERE id=$1")
        .bind(user)
        .fetch_one(&db)
        .await
        .unwrap();
    let session = refresh::issue_after_auth(&state, user, "customer", &phone, None, 1)
        .await
        .unwrap();
    sqlx::query("UPDATE users SET is_active=FALSE WHERE id=$1")
        .bind(user)
        .execute(&db)
        .await
        .unwrap();
    assert!(refresh::rotate(&state, &session.refresh_token)
        .await
        .is_err());
}

#[sqlx::test]
async fn registered_email_invitation_claim_lifecycle_and_rehire_are_atomic(db: PgPool) {
    use trackmyrmc_backend::auth::{jwt::generate_token, refresh};
    let mut state = state(db.clone());
    let delivery = Arc::new(MemoryDelivery::default());
    state.otp_delivery = delivery.clone();
    let owner = identity(&db, "owner", Some("invite-owner@example.invalid"), None).await;
    let plant:Uuid=sqlx::query_scalar("INSERT INTO rmc_plants(owner_id,name,code,latitude,longitude,address_line,city,state,pincode,contact_phone) VALUES($1,'Invitation CI',$2,0,0,'CI','CI','CI','0','0') RETURNING id")
        .bind(owner).bind(Uuid::new_v4().simple().to_string()).fetch_one(&db).await.unwrap();
    let owner_session = refresh::issue_after_auth(
        &state,
        owner,
        "owner",
        "",
        Some("invite-owner@example.invalid"),
        1,
    )
    .await
    .unwrap();
    let app = build_app_router(state.clone());
    let invite = format!("/api/business/plants/{plant}/staff/invitations");
    let body = json!({"email":"new-dispatcher@example.invalid","full_name":"Synthetic Dispatcher","role":"dispatcher","reason":"Owner approved synthetic recruitment"});
    let (status, invitation) = call(
        &app,
        &invite,
        Some(body.clone()),
        Some(&owner_session.token),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let employee = Uuid::parse_str(invitation["staff_user_id"].as_str().unwrap()).unwrap();
    assert_eq!(invitation["status"], "PENDING");
    assert_eq!(call(&app,&invite,Some(json!({"email":"new-dispatcher@example.invalid","full_name":"Same identity","role":"operator","reason":"Conflicting identity role must be denied"})),Some(&owner_session.token)).await.0,StatusCode::CONFLICT);
    assert_eq!(call(&app,&invite,Some(json!({"email":"replacement@example.invalid","full_name":"Replacement","role":"dispatcher","reason":"Conflicting pending role invitation"})),Some(&owner_session.token)).await.0,StatusCode::CONFLICT);
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM users WHERE email='replacement@example.invalid'"
        )
        .fetch_one(&db)
        .await
        .unwrap(),
        0,
        "failed slot acquisition must roll back identity creation"
    );
    let forged_legacy = generate_token(
        employee,
        "dispatcher",
        "",
        Some("new-dispatcher@example.invalid"),
        &state.config.jwt_secret,
        1,
    )
    .unwrap();
    assert_eq!(
        call(&app, "/api/me", None, Some(&forged_legacy)).await.0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        call(
            &app,
            "/api/auth/otp/email/send",
            Some(json!({"email":"unregistered@example.invalid"})),
            None
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    let challenge = email_challenge(&app, &delivery, "new-dispatcher@example.invalid").await;
    assert_eq!(
        sqlx::query_scalar::<_, String>(
            "SELECT employment_status FROM plant_staff WHERE user_id=$1"
        )
        .bind(employee)
        .fetch_one(&db)
        .await
        .unwrap(),
        "PENDING"
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
    let (status, login) = call(
        &app,
        "/api/auth/staff/mfa/verify-totp",
        Some(json!({"challenge_token":enabled["challenge_token"],"code":code})),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let access = login["token"].as_str().unwrap();
    let credential = login["refresh_token"].as_str().unwrap();
    let (home_status, home) = call(&app, "/api/staff/home", None, Some(access)).await;
    assert_eq!(home_status, StatusCode::OK);
    assert!(
        home["kpis"].as_array().unwrap().is_empty(),
        "Home cannot leak metrics when no modules are granted"
    );
    assert_eq!(
        call(&app, "/api/me", None, Some(access)).await.0,
        StatusCode::OK
    );
    let (_, modules) = call(&app, "/api/staff/module-permissions", None, Some(access)).await;
    assert!(
        modules["permissions"]
            .as_array()
            .unwrap()
            .iter()
            .all(|g| g["view"] == false && g["edit"] == false),
        "missing grants must default to deny"
    );
    let lifecycle = format!("/api/business/plants/{plant}/staff/{employee}/lifecycle");
    let owner_token = Some(owner_session.token.as_str());
    let first_assignment: Uuid =
        sqlx::query_scalar("SELECT assignment_id FROM plant_staff WHERE user_id=$1")
            .bind(employee)
            .fetch_one(&db)
            .await
            .unwrap();
    assert_eq!(
        call(
            &app,
            &lifecycle,
            Some(json!({"action":"suspend","reason":"Suspending synthetic test employee"})),
            owner_token
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        call(&app, "/api/me", None, Some(access)).await.0,
        StatusCode::UNAUTHORIZED
    );
    assert!(refresh::rotate(&state, credential).await.is_err());
    assert_eq!(
        call(
            &app,
            "/api/auth/otp/email/send",
            Some(json!({"email":"new-dispatcher@example.invalid"})),
            None
        )
        .await
        .0,
        StatusCode::FORBIDDEN,
        "Suspension must block further staff authentication"
    );
    assert_eq!(
        call(&app, &invite, Some(body.clone()), owner_token).await.0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        call(
            &app,
            &lifecycle,
            Some(json!({"action":"reactivate","reason":"Authorized synthetic reactivation"})),
            owner_token
        )
        .await
        .0,
        StatusCode::OK
    );
    assert!(
        refresh::rotate(&state, credential).await.is_err(),
        "reactivation cannot restore credentials"
    );
    assert_eq!(
        call(
            &app,
            &lifecycle,
            Some(json!({"action":"terminate","reason":"Terminating synthetic employment"})),
            owner_token
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        call(
            &app,
            "/api/auth/otp/email/send",
            Some(json!({"email":"new-dispatcher@example.invalid"})),
            None
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    let (status, rehire) = call(&app, &invite, Some(body), owner_token).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(rehire["staff_user_id"], employee.to_string());
    let second_assignment: Uuid =
        sqlx::query_scalar("SELECT assignment_id FROM plant_staff WHERE user_id=$1")
            .bind(employee)
            .fetch_one(&db)
            .await
            .unwrap();
    assert_ne!(first_assignment, second_assignment);
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM plant_staff_module_permissions WHERE user_id=$1"
        )
        .bind(employee)
        .fetch_one(&db)
        .await
        .unwrap(),
        0
    );
    let (_, history) = call(
        &app,
        &format!("/api/business/plants/{plant}/staff/history"),
        None,
        owner_token,
    )
    .await;
    assert_eq!(history["slots"].as_array().unwrap().len(), 7);
    assert!(history["events"]
        .as_array()
        .unwrap()
        .iter()
        .any(|e| e["new_status"] == "TERMINATED"
            && e["assignment_id"] == first_assignment.to_string()));
    assert!(history["events"]
        .as_array()
        .unwrap()
        .iter()
        .all(|e| e["reason"].as_str().unwrap().len() >= 10));
    assert!(
        sqlx::query("DELETE FROM plant_staff_lifecycle_audit WHERE staff_user_id=$1")
            .bind(employee)
            .execute(&db)
            .await
            .is_err(),
        "Lifecycle audit must be append-only"
    );
}

#[sqlx::test]
async fn concurrent_invitations_reserve_one_slot_and_different_plants_are_independent(db: PgPool) {
    use trackmyrmc_backend::auth::refresh;
    let state = state(db.clone());
    let owner = identity(&db, "owner", Some("race-owner@example.invalid"), None).await;
    let session = refresh::issue_after_auth(&state, owner, "owner", "", None, 1)
        .await
        .unwrap();
    let app = build_app_router(state);
    for _ in 0..2 {
        let plant:Uuid=sqlx::query_scalar("INSERT INTO rmc_plants(owner_id,name,code,latitude,longitude,address_line,city,state,pincode,contact_phone) VALUES($1,'Race CI',$2,0,0,'CI','CI','CI','0','0') RETURNING id")
            .bind(owner).bind(Uuid::new_v4().simple().to_string()).fetch_one(&db).await.unwrap();
        let path = format!("/api/business/plants/{plant}/staff/invitations");
        let a = json!({"email":format!("{}@example.invalid",Uuid::new_v4()),"full_name":"Racer A","role":"dispatcher","reason":"Concurrent synthetic role acquisition"});
        let b = json!({"email":format!("{}@example.invalid",Uuid::new_v4()),"full_name":"Racer B","role":"dispatcher","reason":"Concurrent synthetic role acquisition"});
        let (a, b) = tokio::join!(
            call(&app, &path, Some(a), Some(&session.token)),
            call(&app, &path, Some(b), Some(&session.token))
        );
        assert!([a.0, b.0].contains(&StatusCode::OK));
        assert!([a.0, b.0].contains(&StatusCode::CONFLICT));
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM plant_staff WHERE plant_id=$1 AND removed_at IS NULL"
            )
            .bind(plant)
            .fetch_one(&db)
            .await
            .unwrap(),
            1
        );
    }
}

async fn put_json(app: &Router, path: &str, body: Value, token: &str) -> (StatusCode, Value) {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri(path)
                .header("Authorization", format!("Bearer {token}"))
                .header("Content-Type", "application/json")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 100000).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap())
}

#[sqlx::test]
async fn fleet_driver_creation_and_edit_are_independent_owner_grants(db: PgPool) {
    use trackmyrmc_backend::auth::refresh;
    let state = state(db.clone());
    let owner = identity(&db, "owner", None, None).await;
    let fleet = identity(
        &db,
        "fleet_manager",
        Some("fleet-create@example.invalid"),
        None,
    )
    .await;
    let plant:Uuid=sqlx::query_scalar("INSERT INTO rmc_plants(owner_id,name,code,latitude,longitude,address_line,city,state,pincode,contact_phone) VALUES($1,'Fleet grants CI',$2,0,0,'CI','CI','CI','0','0') RETURNING id")
        .bind(owner).bind(Uuid::new_v4().simple().to_string()).fetch_one(&db).await.unwrap();
    sqlx::query("INSERT INTO plant_staff(plant_id,user_id,role) VALUES($1,$2,'fleet_manager')")
        .bind(plant)
        .bind(fleet)
        .execute(&db)
        .await
        .unwrap();
    let login = refresh::issue_after_auth(&state, fleet, "fleet_manager", "", None, 1)
        .await
        .unwrap();
    let token = Some(login.token.as_str());
    let app = build_app_router(state);
    let path = format!("/api/business/plants/{plant}/drivers/invitations");
    let body = json!({"name":"Pending CI Driver","phone":"+12025550997","reason":"Explicit fleet onboarding delegation"});
    assert_eq!(
        call(&app, &path, Some(body.clone()), token).await.0,
        StatusCode::FORBIDDEN
    );
    sqlx::query("INSERT INTO plant_staff_module_permissions(plant_id,user_id,module_key,can_view,can_edit,can_create,updated_by) VALUES($1,$2,'driver_roster',TRUE,TRUE,FALSE,$3)").bind(plant).bind(fleet).bind(owner).execute(&db).await.unwrap();
    assert_eq!(
        call(&app, &path, Some(body.clone()), token).await.0,
        StatusCode::FORBIDDEN,
        "Edit cannot substitute for the separate Create grant"
    );
    sqlx::query("UPDATE plant_staff_module_permissions SET can_create=TRUE,can_edit=FALSE WHERE plant_id=$1 AND user_id=$2 AND module_key='driver_roster'").bind(plant).bind(fleet).execute(&db).await.unwrap();
    let (status, invitation) = call(&app, &path, Some(body), token).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        call(
            &app,
            &format!(
                "/api/business/plants/{plant}/drivers/{}/status",
                invitation["driver_id"].as_str().unwrap()
            ),
            Some(json!({"active":false,"reason":"Create-only delegate cannot edit access"})),
            token
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
}

#[sqlx::test]
async fn manager_limits_fleet_driver_verification_and_inventory_approval_fail_closed(db: PgPool) {
    use trackmyrmc_backend::auth::refresh;
    let mut state = state(db.clone());
    let delivery = Arc::new(MemoryDelivery::default());
    state.otp_delivery = delivery.clone();
    let owner = identity(&db, "owner", Some("caps-owner@example.invalid"), None).await;
    let manager = identity(
        &db,
        "supervisor",
        Some("caps-manager@example.invalid"),
        None,
    )
    .await;
    let employee = identity(&db, "operator", Some("caps-operator@example.invalid"), None).await;
    let store = identity(
        &db,
        "store_manager",
        Some("caps-store@example.invalid"),
        None,
    )
    .await;
    let mut plants = Vec::new();
    for _ in 0..2 {
        plants.push(sqlx::query_scalar::<_,Uuid>("INSERT INTO rmc_plants(owner_id,name,code,latitude,longitude,address_line,city,state,pincode,contact_phone) VALUES($1,'Delegation CI',$2,0,0,'CI','CI','CI','0','0') RETURNING id")
            .bind(owner).bind(Uuid::new_v4().simple().to_string()).fetch_one(&db).await.unwrap());
    }
    let plant = plants[0];
    for (id, role) in [
        (manager, "supervisor"),
        (employee, "operator"),
        (store, "store_manager"),
    ] {
        sqlx::query("INSERT INTO plant_staff(plant_id,user_id,role) VALUES($1,$2,$3)")
            .bind(plant)
            .bind(id)
            .bind(role)
            .execute(&db)
            .await
            .unwrap();
    }
    let owner_login = refresh::issue_after_auth(&state, owner, "owner", "", None, 1)
        .await
        .unwrap();
    let manager_login = refresh::issue_after_auth(&state, manager, "supervisor", "", None, 1)
        .await
        .unwrap();
    let store_login = refresh::issue_after_auth(&state, store, "store_manager", "", None, 1)
        .await
        .unwrap();
    let app = build_app_router(state.clone());
    let ot = Some(owner_login.token.as_str());
    let mt = Some(manager_login.token.as_str());
    let grant = format!("/api/business/plants/{plant}/staff/{manager}/manager/grant");
    let mut policy = json!({"can_manage_staff":true,"can_manage_permissions":true,"can_manage_fleet":false,"can_manage_drivers":false,
        "permission_limits":{"production_queue":{"view":true,"create":false,"edit":false,"approve":false,"export":false}}});
    let invite = json!({"email":"manager-invite@example.invalid","full_name":"Invited accountant","role":"accountant","reason":"Owner delegated limited staff recruitment"});
    let invite_path = format!("/api/business/plants/{plant}/staff/invitations");
    assert_eq!(
        call(&app, &invite_path, Some(invite.clone()), mt).await.0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        call(&app, &grant, Some(policy.clone()), ot).await.0,
        StatusCode::OK
    );
    assert_eq!(
        call(&app, &invite_path, Some(invite), mt).await.0,
        StatusCode::OK
    );
    assert_eq!(call(&app,&format!("/api/business/plants/{}/staff/invitations",plants[1]),Some(json!({"email":"cross-plant@example.invalid","full_name":"Denied","role":"dispatcher","reason":"Cross-plant assignment must be rejected"})),mt).await.0,StatusCode::FORBIDDEN);
    let permission_path = format!("/api/owner/plants/{plant}/staff/{employee}/module-permissions");
    let (status, permissions) = call(&app, &permission_path, None, ot).await;
    assert_eq!(status, StatusCode::OK);
    let mut edits:Vec<Value>=permissions["permissions"].as_array().unwrap().iter().map(|g|json!({"key":g["key"],"view":g["key"]=="production_queue","create":false,"edit":false,"approve":false,"export":false})).collect();
    assert_eq!(
        put_json(
            &app,
            &permission_path,
            json!({"permissions":edits}),
            &manager_login.token
        )
        .await
        .0,
        StatusCode::OK
    );
    edits
        .iter_mut()
        .find(|g| g["key"] == "production_queue")
        .unwrap()["edit"] = json!(true);
    assert_eq!(
        put_json(
            &app,
            &permission_path,
            json!({"permissions":edits}),
            &manager_login.token
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        put_json(
            &app,
            &format!("/api/owner/plants/{plant}/staff/{manager}/module-permissions"),
            json!({"permissions":[]}),
            &manager_login.token
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    let vehicles = format!("/api/business/plants/{plant}/vehicles");
    assert_eq!(
        call(
            &app,
            &vehicles,
            Some(json!({"registration_number":"CI-MANAGER-1","capacity_m3":6})),
            mt
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    let driver_invite = format!("/api/business/plants/{plant}/drivers/invitations");
    let driver_body = json!({"name":"Verified CI Driver","phone":"+12025550999","reason":"Delegated fleet driver recruitment"});
    assert_eq!(
        call(&app, &driver_invite, Some(driver_body.clone()), mt)
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    policy["can_manage_fleet"] = json!(true);
    assert_eq!(
        call(&app, &grant, Some(policy.clone()), ot).await.0,
        StatusCode::OK
    );
    assert_eq!(
        call(
            &app,
            &vehicles,
            Some(json!({"registration_number":"CI-MANAGER-1","capacity_m3":6})),
            mt
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        call(&app, &driver_invite, Some(driver_body.clone()), mt)
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    policy["can_manage_drivers"] = json!(true);
    assert_eq!(call(&app, &grant, Some(policy), ot).await.0, StatusCode::OK);
    let (status, driver) = call(&app, &driver_invite, Some(driver_body), mt).await;
    assert_eq!(status, StatusCode::OK);
    let driver_id = driver["driver_id"].as_str().unwrap();
    let tm = json!({"registration_number":"CI-MANAGER-2","capacity_m3":6,"driver_id":driver_id});
    assert_eq!(
        call(&app, &vehicles, Some(tm.clone()), mt).await.0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        call(
            &app,
            "/api/auth/otp/whatsapp/send",
            Some(json!({"phone":"+12025550999","purpose":"driver_login"})),
            None
        )
        .await
        .0,
        StatusCode::OK
    );
    let code = delivery.take_code("12025550999");
    let (status, driver_login) = call(
        &app,
        "/api/auth/otp/whatsapp/verify",
        Some(json!({"phone":"+12025550999","otp":code,"purpose":"driver_login"})),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(call(&app, &vehicles, Some(tm), mt).await.0, StatusCode::OK);
    assert_eq!(
        call(
            &app,
            &format!("/api/business/plants/{}/vehicles", plants[1]),
            Some(json!({"registration_number":"CI-CROSS-TM","driver_id":driver_id})),
            ot
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        call(
            &app,
            &format!("/api/business/plants/{plant}/drivers/{driver_id}/status"),
            Some(json!({"active":false,"reason":"Suspend compromised synthetic driver"})),
            mt
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        call(&app, "/api/me", None, driver_login["token"].as_str())
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );
    assert!(
        refresh::rotate(&state, driver_login["refresh_token"].as_str().unwrap())
            .await
            .is_err()
    );
    sqlx::query("INSERT INTO plant_staff_module_permissions(plant_id,user_id,module_key,can_view,can_edit,can_create,updated_by) VALUES($1,$2,'material_inventory',TRUE,TRUE,TRUE,$3)").bind(plant).bind(store).bind(owner).execute(&db).await.unwrap();
    let material:Uuid=sqlx::query_scalar("INSERT INTO plant_materials(plant_id,name,material_type,unit,current_stock) VALUES($1,'CI Cement','cement','kg',100) RETURNING id").bind(plant).fetch_one(&db).await.unwrap();
    let adjust = format!("/api/business/plants/{plant}/materials/{material}/adjust");
    assert_eq!(
        call(
            &app,
            &adjust,
            Some(json!({"quantity_change":-5,"reason":"Unapproved negative stock write-off"})),
            Some(&store_login.token)
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        sqlx::query_scalar::<_, f64>(
            "SELECT current_stock::float8 FROM plant_materials WHERE id=$1"
        )
        .bind(material)
        .fetch_one(&db)
        .await
        .unwrap(),
        100.0
    );
    assert_eq!(
        call(
            &app,
            &adjust,
            Some(json!({"quantity_change":-5,"reason":"Owner-approved synthetic reconciliation"})),
            ot
        )
        .await
        .0,
        StatusCode::OK
    );
}

#[sqlx::test]
async fn incomplete_staff_login_preserves_session_until_final_mfa(db: PgPool) {
    use trackmyrmc_backend::auth::refresh;
    let mut state = state(db.clone());
    let delivery = Arc::new(MemoryDelivery::default());
    state.otp_delivery = delivery.clone();
    let email = "session-timing@example.invalid";
    let user = identity(&db, "owner", Some(email), None).await;
    let phone: String = sqlx::query_scalar("SELECT phone FROM users WHERE id=$1")
        .bind(user)
        .fetch_one(&db)
        .await
        .unwrap();
    let first = refresh::issue_after_auth(&state, user, "owner", &phone, Some(email), 1)
        .await
        .unwrap();
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
        StatusCode::OK
    );
    assert_eq!(
        call(&app, "/api/me", None, Some(&first.token)).await.0,
        StatusCode::OK
    );
    let otp = delivery.take_code(email);
    let (status, challenge) = call(
        &app,
        "/api/auth/otp/email/verify",
        Some(json!({"email":email,"otp":otp})),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(challenge.get("token").is_none());
    assert_eq!(
        call(&app, "/api/me", None, Some(&first.token)).await.0,
        StatusCode::OK
    );
    assert!(!call(
        &app,
        "/api/auth/staff/mfa/verify-totp",
        Some(json!({"challenge_token":challenge["challenge_token"],"code":"invalid"})),
        None,
    )
    .await
    .0
    .is_success());
    assert_eq!(
        call(&app, "/api/me", None, Some(&first.token)).await.0,
        StatusCode::OK
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
    assert_eq!(
        call(&app, "/api/me", None, Some(&first.token)).await.0,
        StatusCode::OK
    );
    let (status, second) = call(
        &app,
        "/api/auth/staff/mfa/verify-totp",
        Some(json!({"challenge_token":enabled["challenge_token"],"code":code})),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let second_token = second["token"].as_str().unwrap();
    let (status, replaced) = call(&app, "/api/me", None, Some(&first.token)).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(replaced["error_code"], "SESSION_REPLACED");
    assert_eq!(
        call(
            &app,
            "/api/auth/logout",
            Some(json!({})),
            Some(&first.token)
        )
        .await
        .0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        call(&app, "/api/me", None, Some(second_token)).await.0,
        StatusCode::OK
    );
    assert_eq!(
        call(
            &app,
            "/api/auth/refresh",
            Some(json!({"refresh_token":first.refresh_token})),
            None,
        )
        .await
        .0,
        StatusCode::UNAUTHORIZED
    );
}

#[sqlx::test]
async fn refresh_cannot_silently_renew_mobile_admin_or_unassigned_staff(db: PgPool) {
    use trackmyrmc_backend::auth::refresh;
    let state = state(db.clone());
    let admin = identity(&db, "admin", Some("mobile-admin@example.invalid"), None).await;
    let session = refresh::issue_after_auth(&state, admin, "admin", "", None, 1)
        .await
        .unwrap();
    assert!(refresh::rotate(&state, &session.refresh_token)
        .await
        .is_err());
    for role in ["central_admin", "authority"] {
        assert!(refresh::issue_after_auth(&state, admin, role, "", None, 1)
            .await
            .is_err());
    }

    let owner = identity(&db, "owner", None, None).await;
    let staff = identity(
        &db,
        "supervisor",
        Some("refresh-staff@example.invalid"),
        None,
    )
    .await;
    let plant: Uuid = sqlx::query_scalar(
        "INSERT INTO rmc_plants(owner_id,name,code,latitude,longitude,address_line,
         city,state,pincode,contact_phone)
         VALUES($1,'Refresh CI',$2,0,0,'CI','CI','MH','0','0') RETURNING id",
    )
    .bind(owner)
    .bind(Uuid::new_v4().simple().to_string())
    .fetch_one(&db)
    .await
    .unwrap();
    sqlx::query("INSERT INTO plant_staff(plant_id,user_id,role) VALUES($1,$2,'supervisor')")
        .bind(plant)
        .bind(staff)
        .execute(&db)
        .await
        .unwrap();
    let session = refresh::issue_after_auth(&state, staff, "supervisor", "", None, 1)
        .await
        .unwrap();
    sqlx::query("UPDATE plant_staff SET is_active=FALSE WHERE user_id=$1")
        .bind(staff)
        .execute(&db)
        .await
        .unwrap();
    assert!(refresh::rotate(&state, &session.refresh_token)
        .await
        .is_err());
}

#[sqlx::test]
async fn staff_role_changes_are_soft_audited_and_reserve_suspended_slots(db: PgPool) {
    use trackmyrmc_backend::auth::refresh;
    let state = state(db.clone());
    let owner = identity(&db, "owner", None, None).await;
    let first = identity(&db, "supervisor", Some("slot-first@example.invalid"), None).await;
    let second = identity(&db, "supervisor", Some("slot-second@example.invalid"), None).await;
    let plant: Uuid = sqlx::query_scalar(
        "INSERT INTO rmc_plants(owner_id,name,code,latitude,longitude,address_line,
         city,state,pincode,contact_phone)
         VALUES($1,'Staff Audit CI',$2,0,0,'CI','CI','MH','0','0') RETURNING id",
    )
    .bind(owner)
    .bind(Uuid::new_v4().simple().to_string())
    .fetch_one(&db)
    .await
    .unwrap();
    let owner_session = refresh::issue_after_auth(&state, owner, "owner", "", None, 1)
        .await
        .unwrap();
    let app = build_app_router(state.clone());
    let staff_path = format!("/api/master/plants/{plant}/staff");
    let first_path = format!("{staff_path}/{first}");
    let first_payload = json!({"user_id":first,"role":"supervisor"});
    let second_payload = json!({"user_id":second,"role":"supervisor"});
    let token = Some(owner_session.token.as_str());
    assert_eq!(
        call(&app, &staff_path, Some(first_payload.clone()), token)
            .await
            .0,
        StatusCode::OK
    );
    let staff_session = refresh::issue_after_auth(&state, first, "supervisor", "", None, 1)
        .await
        .unwrap();
    assert_eq!(
        call(
            &app,
            &format!("{first_path}/suspend"),
            Some(json!({})),
            token
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        call(&app, &staff_path, Some(second_payload.clone()), token)
            .await
            .0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        call(&app, "/api/me", None, Some(&staff_session.token))
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );
    assert!(refresh::rotate(&state, &staff_session.refresh_token)
        .await
        .is_err());
    assert_eq!(
        call(
            &app,
            &format!("{first_path}/activate"),
            Some(json!({})),
            token
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        call(&app, "/api/me", None, Some(&staff_session.token))
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        call(
            &app,
            &format!("{first_path}/remove"),
            Some(json!({})),
            token
        )
        .await
        .0,
        StatusCode::OK
    );
    let retained: (bool, bool, Option<Uuid>) = sqlx::query_as(
        "SELECT is_active,removed_at IS NOT NULL,removed_by
         FROM plant_staff WHERE plant_id=$1 AND user_id=$2",
    )
    .bind(plant)
    .bind(first)
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(retained, (false, true, Some(owner)));
    let actions: Vec<String> = sqlx::query_scalar(
        "SELECT action FROM plant_staff_role_slot_audit
         WHERE plant_id=$1 AND staff_user_id=$2 AND actor_user_id=$3 ORDER BY id",
    )
    .bind(plant)
    .bind(first)
    .bind(owner)
    .fetch_all(&db)
    .await
    .unwrap();
    assert_eq!(actions, ["ASSIGNED", "SUSPENDED", "REACTIVATED", "REMOVED"]);
    assert_eq!(
        call(&app, &staff_path, Some(second_payload), token).await.0,
        StatusCode::OK
    );
    assert_eq!(
        call(&app, &staff_path, Some(first_payload), token).await.0,
        StatusCode::CONFLICT
    );
}

#[sqlx::test]
async fn plant_manager_delegation_is_owner_scoped_revocable_and_cannot_escalate(db: PgPool) {
    use trackmyrmc_backend::auth::refresh;
    let state = state(db.clone());
    let owner = identity(&db, "owner", Some("mgr-owner@example.invalid"), None).await;
    let foreign_owner = identity(&db, "owner", Some("mgr-foreign@example.invalid"), None).await;
    let manager = identity(
        &db,
        "supervisor",
        Some("mgr-supervisor@example.invalid"),
        None,
    )
    .await;
    let employee = identity(
        &db,
        "dispatcher",
        Some("mgr-dispatcher@example.invalid"),
        None,
    )
    .await;
    let replacement_manager =
        identity(&db, "operator", Some("mgr-operator@example.invalid"), None).await;
    let plant: Uuid = sqlx::query_scalar(
        "INSERT INTO rmc_plants(owner_id,name,code,latitude,longitude,address_line,
         city,state,pincode,contact_phone) VALUES($1,'Delegation CI',$2,0,0,'CI','CI','MH','0','0')
         RETURNING id",
    )
    .bind(owner)
    .bind(Uuid::new_v4().simple().to_string())
    .fetch_one(&db)
    .await
    .unwrap();
    for (user, role) in [
        (manager, "supervisor"),
        (employee, "dispatcher"),
        (replacement_manager, "operator"),
    ] {
        sqlx::query("INSERT INTO plant_staff(plant_id,user_id,role) VALUES($1,$2,$3)")
            .bind(plant)
            .bind(user)
            .bind(role)
            .execute(&db)
            .await
            .unwrap();
    }
    let owner_login = refresh::issue_after_auth(
        &state,
        owner,
        "owner",
        "",
        Some("mgr-owner@example.invalid"),
        1,
    )
    .await
    .unwrap();
    let foreign_login = refresh::issue_after_auth(
        &state,
        foreign_owner,
        "owner",
        "",
        Some("mgr-foreign@example.invalid"),
        1,
    )
    .await
    .unwrap();
    let manager_login = refresh::issue_after_auth(
        &state,
        manager,
        "supervisor",
        "",
        Some("mgr-supervisor@example.invalid"),
        1,
    )
    .await
    .unwrap();
    let app = build_app_router(state.clone());
    let grant = format!("/api/business/plants/{plant}/staff/{manager}/manager/grant");
    let revoke = format!("/api/business/plants/{plant}/staff/{manager}/manager/revoke");
    let owner_token = Some(owner_login.token.as_str());
    let manager_token = Some(manager_login.token.as_str());
    assert_eq!(
        call(&app, &grant, Some(json!({})), Some(&foreign_login.token))
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        call(&app, &grant, Some(json!({})), manager_token).await.0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        call(&app, &grant, Some(json!({})), owner_token).await.0,
        StatusCode::OK
    );
    let (status, access) = call(&app, "/api/staff/manager-access", None, manager_token).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(access["enabled"], true);
    assert_eq!(
        call(
            &app,
            &format!("/api/business/plants/{plant}/staff/{replacement_manager}/manager/grant"),
            Some(json!({})),
            owner_token
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        call(
            &app,
            &format!("/api/business/plants/{plant}/people/{manager}/remove"),
            Some(json!({})),
            manager_token
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        call(
            &app,
            &format!("/api/business/plants/{plant}/people/{employee}/suspend"),
            Some(json!({})),
            manager_token
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        call(
            &app,
            &format!("/api/business/plants/{plant}/people/{employee}/activate"),
            Some(json!({})),
            manager_token
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        call(&app, &revoke, Some(json!({})), manager_token).await.0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        call(&app, &revoke, Some(json!({})), owner_token).await.0,
        StatusCode::OK
    );
    assert_eq!(
        call(&app, "/api/staff/manager-access", None, manager_token)
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        call(
            &app,
            &format!("/api/business/plants/{plant}/people/{employee}/remove"),
            Some(json!({})),
            manager_token
        )
        .await
        .0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        call(&app, &grant, Some(json!({})), owner_token).await.0,
        StatusCode::OK
    );
    assert_eq!(
        call(
            &app,
            &format!("/api/business/plants/{plant}/people/{manager}/suspend"),
            Some(json!({})),
            owner_token
        )
        .await
        .0,
        StatusCode::OK
    );
    let active_delegations: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM plant_staff_manager_delegations
         WHERE plant_id=$1 AND revoked_at IS NULL",
    )
    .bind(plant)
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(active_delegations, 0);
    assert_eq!(
        call(
            &app,
            &format!("/api/business/plants/{plant}/people/{manager}/activate"),
            Some(json!({})),
            owner_token
        )
        .await
        .0,
        StatusCode::OK
    );
    let new_login = refresh::issue_after_auth(
        &state,
        manager,
        "supervisor",
        "",
        Some("mgr-supervisor@example.invalid"),
        1,
    )
    .await
    .unwrap();
    assert_eq!(
        call(
            &app,
            "/api/staff/manager-access",
            None,
            Some(&new_login.token)
        )
        .await
        .1["enabled"],
        false
    );
}

#[sqlx::test]
async fn driver_employment_reserves_pending_and_suspended_until_explicit_release(db: PgPool) {
    use trackmyrmc_backend::auth::refresh;
    let mut state = state(db.clone());
    let delivery = Arc::new(MemoryDelivery::default());
    state.otp_delivery = delivery.clone();
    let mut owners = Vec::new();
    let mut plants = Vec::new();
    let mut tokens = Vec::new();
    for _ in 0..2 {
        let owner = identity(&db, "owner", None, None).await;
        let plant:Uuid=sqlx::query_scalar("INSERT INTO rmc_plants(owner_id,name,code,latitude,longitude,address_line,city,state,pincode,contact_phone) VALUES($1,'Driver scope CI',$2,0,0,'CI','CI','CI','0','0') RETURNING id").bind(owner).bind(Uuid::new_v4().simple().to_string()).fetch_one(&db).await.unwrap();
        tokens.push(
            refresh::issue_after_auth(&state, owner, "owner", "", None, 1)
                .await
                .unwrap()
                .token,
        );
        owners.push(owner);
        plants.push(plant);
    }
    let app = build_app_router(state.clone());
    let invitation = json!({"name":"Transfer CI Driver","phone":"+12025550996","reason":"Owner approved Driver onboarding"});
    let paths: Vec<_> = plants
        .iter()
        .map(|p| format!("/api/business/plants/{p}/drivers/invitations"))
        .collect();
    let (status, invited) = call(&app, &paths[0], Some(invitation.clone()), Some(&tokens[0])).await;
    assert_eq!(status, StatusCode::OK);
    let driver: Uuid = invited["driver_id"].as_str().unwrap().parse().unwrap();
    assert_eq!(
        call(&app, &paths[1], Some(invitation.clone()), Some(&tokens[1]))
            .await
            .0,
        StatusCode::CONFLICT,
        "Pending employment must reserve the Driver"
    );
    assert!(
        refresh::issue_after_auth(&state, driver, "driver", "12025550996", None, 1)
            .await
            .is_err(),
        "Pending invitation cannot issue a session before OTP claim"
    );
    assert_eq!(
        call(
            &app,
            "/api/auth/otp/whatsapp/send",
            Some(json!({"phone":"+12025550996","purpose":"driver_login"})),
            None
        )
        .await
        .0,
        StatusCode::OK
    );
    let code = delivery.take_code("12025550996");
    let (status, login) = call(
        &app,
        "/api/auth/otp/whatsapp/verify",
        Some(json!({"phone":"+12025550996","otp":code,"purpose":"driver_login"})),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let access = format!("/api/business/plants/{}/drivers/{driver}/status", plants[0]);
    assert_eq!(
        call(
            &app,
            &access,
            Some(json!({"active":false,"reason":"Suspend current Driver assignment"})),
            Some(&tokens[0])
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        call(&app, &paths[1], Some(invitation.clone()), Some(&tokens[1]))
            .await
            .0,
        StatusCode::CONFLICT,
        "Suspension must not release employment"
    );
    assert_eq!(
        call(&app, "/api/me", None, login["token"].as_str()).await.0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        call(
            &app,
            &access,
            Some(json!({"active":true,"reason":"Owner reactivated verified Driver"})),
            Some(&tokens[0])
        )
        .await
        .0,
        StatusCode::OK
    );
    let mixer:Uuid=sqlx::query_scalar("INSERT INTO transit_mixers(plant_id,registration_number,capacity_m3,driver_id) VALUES($1,'TRANSFER-CI',6,$2) RETURNING id").bind(plants[0]).bind(driver).fetch_one(&db).await.unwrap();
    assert_eq!(call(&app,&access,Some(json!({"active":false,"terminate":true,"reason":"Employment ended with approved release"})),Some(&tokens[0])).await.0,StatusCode::OK);
    assert!(sqlx::query_scalar::<_, Option<Uuid>>(
        "SELECT driver_id FROM transit_mixers WHERE id=$1"
    )
    .bind(mixer)
    .fetch_one(&db)
    .await
    .unwrap()
    .is_none());
    assert_eq!(
        call(&app, &paths[1], Some(invitation), Some(&tokens[1]))
            .await
            .0,
        StatusCode::OK
    );
    for active in [false, true] {
        assert_eq!(
            call(
                &app,
                &access,
                Some(json!({"active":active,"reason":"Old employer cannot change new assignment"})),
                Some(&tokens[0])
            )
            .await
            .0,
            StatusCode::FORBIDDEN
        );
    }
    let profile = json!({"phone":"+12025550996","employee_id":"REASSIGN","company_joining_date":"2025-01-01","total_driving_experience_months":24});
    // Even a previously verified identity must reverify after a new invitation.
    assert!(!put_json(
        &app,
        &format!("/api/business/plants/{}/drivers", plants[1]),
        profile.clone(),
        &tokens[1]
    )
    .await
    .0
    .is_success());
    sqlx::query("UPDATE users SET is_verified=TRUE WHERE id=$1")
        .bind(driver)
        .execute(&db)
        .await
        .unwrap();
    sqlx::query("UPDATE driver_employment_profiles SET employment_status='ACTIVE',is_active=TRUE WHERE driver_id=$1 AND released_at IS NULL").bind(driver).execute(&db).await.unwrap();
    assert_eq!(
        put_json(
            &app,
            &format!("/api/business/plants/{}/drivers", plants[1]),
            profile.clone(),
            &tokens[1]
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        put_json(
            &app,
            &format!("/api/business/plants/{}/drivers", plants[0]),
            profile,
            &tokens[0]
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM driver_employment_profiles WHERE driver_id=$1"
        )
        .bind(driver)
        .fetch_one(&db)
        .await
        .unwrap(),
        2,
        "Historical employment is retained"
    );
    assert_eq!(sqlx::query_scalar::<_,i64>("SELECT count(*) FROM audit_logs WHERE resource_id=$1::text AND action='driver.access.terminate'").bind(driver).fetch_one(&db).await.unwrap(),1);
}

#[sqlx::test]
async fn revoked_manager_cannot_commit_driver_profile_after_waiting_for_identity_lock(db: PgPool) {
    use trackmyrmc_backend::auth::refresh;
    let state = state(db.clone());
    let owner = identity(&db, "owner", None, None).await;
    let manager = identity(
        &db,
        "supervisor",
        Some("driver-manager@example.invalid"),
        None,
    )
    .await;
    let driver = identity(&db, "driver", None, Some("12025550995")).await;
    sqlx::query("UPDATE users SET is_verified=TRUE WHERE id=$1")
        .bind(driver)
        .execute(&db)
        .await
        .unwrap();
    let plant:Uuid=sqlx::query_scalar("INSERT INTO rmc_plants(owner_id,name,code,latitude,longitude,address_line,city,state,pincode,contact_phone) VALUES($1,'Manager race CI',$2,0,0,'CI','CI','CI','0','0') RETURNING id").bind(owner).bind(Uuid::new_v4().simple().to_string()).fetch_one(&db).await.unwrap();
    sqlx::query("INSERT INTO plant_staff(plant_id,user_id,role) VALUES($1,$2,'supervisor')")
        .bind(plant)
        .bind(manager)
        .execute(&db)
        .await
        .unwrap();
    sqlx::query("INSERT INTO driver_employment_profiles(plant_id,driver_id,employee_code) VALUES($1,$2,'ORIGINAL')").bind(plant).bind(driver).execute(&db).await.unwrap();
    let owner_login = refresh::issue_after_auth(&state, owner, "owner", "", None, 1)
        .await
        .unwrap();
    let manager_login = refresh::issue_after_auth(&state, manager, "supervisor", "", None, 1)
        .await
        .unwrap();
    let app = build_app_router(state);
    assert_eq!(call(&app,&format!("/api/business/plants/{plant}/staff/{manager}/manager/grant"),Some(json!({"can_manage_drivers":true,"can_manage_staff":false,"can_manage_permissions":false,"can_manage_fleet":false,"permission_limits":{}})),Some(&owner_login.token)).await.0,StatusCode::OK);
    let mut blocker = db.begin().await.unwrap();
    sqlx::query("SELECT id FROM users WHERE id=$1 FOR UPDATE")
        .bind(driver)
        .execute(&mut *blocker)
        .await
        .unwrap();
    let task_app = app.clone();
    let task_token = manager_login.token.clone();
    let edit = tokio::spawn(async move {
        put_json(&task_app,&format!("/api/business/plants/{plant}/drivers"),json!({"phone":"12025550995","employee_id":"UNAUTHORIZED","company_joining_date":"2025-01-01","total_driving_experience_months":24}),&task_token).await
    });
    tokio::time::timeout(std::time::Duration::from_secs(10),async {
        loop {
            let waiting:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT id FROM users WHERE regexp_replace%')").fetch_one(&db).await.unwrap();
            if waiting {break;}tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
    }).await.expect("Manager edit must reach the blocked Driver identity lock");
    assert_eq!(
        call(
            &app,
            &format!("/api/business/plants/{plant}/staff/{manager}/manager/revoke"),
            Some(json!({"reason":"Owner revoked Driver management delegation"})),
            Some(&owner_login.token)
        )
        .await
        .0,
        StatusCode::OK
    );
    blocker.commit().await.unwrap();
    assert_eq!(edit.await.unwrap().0, StatusCode::FORBIDDEN);
    assert_eq!(sqlx::query_scalar::<_,String>("SELECT employee_code FROM driver_employment_profiles WHERE plant_id=$1 AND driver_id=$2").bind(plant).bind(driver).fetch_one(&db).await.unwrap(),"ORIGINAL");
}


#[sqlx::test]
async fn owner_disablement_prevents_queued_manager_appointment(db: PgPool) {
    use trackmyrmc_backend::auth::refresh;
    let state = state(db.clone());
    let owner = identity(&db, "owner", Some("disabled-owner@example.invalid"), None).await;
    let manager = identity(
        &db,
        "supervisor",
        Some("disabled-owner-manager@example.invalid"),
        None,
    )
    .await;
    let plant: Uuid = sqlx::query_scalar(
        "INSERT INTO rmc_plants(owner_id,name,code,latitude,longitude,address_line,city,state,pincode,contact_phone)
         VALUES($1,'Disabled Owner CI',$2,0,0,'CI','CI','MH','0','0') RETURNING id",
    )
    .bind(owner)
    .bind(Uuid::new_v4().simple().to_string())
    .fetch_one(&db)
    .await
    .unwrap();
    sqlx::query("INSERT INTO plant_staff(plant_id,user_id,role) VALUES($1,$2,'supervisor')")
        .bind(plant)
        .bind(manager)
        .execute(&db)
        .await
        .unwrap();
    let login = refresh::issue_after_auth(
        &state,
        owner,
        "owner",
        "",
        Some("disabled-owner@example.invalid"),
        1,
    )
    .await
    .unwrap();
    let app = build_app_router(state);
    // Simulate the Owner row lock held by Control Center's status transaction.
    // The HTTP request must finish authentication and wait on this lock before
    // the disable commits; otherwise the test would only exercise login denial.
    let mut disabling = db.begin().await.unwrap();
    sqlx::query("SELECT id FROM users WHERE id=$1 FOR UPDATE")
        .bind(owner)
        .execute(&mut *disabling)
        .await
        .unwrap();
    let request_app = app.clone();
    let token = login.token.clone();
    let request = tokio::spawn(async move {
        call(
            &request_app,
            &format!("/api/business/plants/{plant}/staff/{manager}/manager/grant"),
            Some(json!({})),
            Some(&token),
        )
        .await
    });
    tokio::time::timeout(std::time::Duration::from_secs(10), async {
        loop {
            let waiting: bool = sqlx::query_scalar(
                "SELECT EXISTS(SELECT 1 FROM pg_stat_activity
                 WHERE datname=current_database() AND wait_event_type='Lock'
                   AND query LIKE 'SELECT id FROM users WHERE id=$1 AND role IN%')",
            )
            .fetch_one(&db)
            .await
            .unwrap();
            if waiting {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("Manager appointment must reach the blocked live Owner lock");
    sqlx::query("UPDATE users SET is_active=FALSE WHERE id=$1")
        .bind(owner)
        .execute(&mut *disabling)
        .await
        .unwrap();
    disabling.commit().await.unwrap();
    assert_eq!(request.await.unwrap().0, StatusCode::FORBIDDEN);
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM plant_staff_manager_delegations
         WHERE plant_id=$1 AND revoked_at IS NULL",
    )
    .bind(plant)
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(count, 0, "Disabled Owner cannot create a live Manager");
}

#[sqlx::test]
async fn financial_creation_requires_create_even_when_edit_is_granted(db: PgPool) {
    use trackmyrmc_backend::{
        auth::{refresh, AuthUser},
        routes::staff_module_permissions::{self, Action},
    };
    let state = state(db.clone());
    let owner = identity(&db, "owner", None, None).await;
    let plant: Uuid = sqlx::query_scalar(
        "INSERT INTO rmc_plants(owner_id,name,code,latitude,longitude,address_line,city,state,pincode,contact_phone)
         VALUES($1,'Financial grants CI',$2,0,0,'CI','CI','MH','0','0') RETURNING id",
    )
    .bind(owner)
    .bind(Uuid::new_v4().simple().to_string())
    .fetch_one(&db)
    .await
    .unwrap();
    let accountant = identity(&db, "accountant", Some("create-expense@example.invalid"), None).await;
    let fleet = identity(&db, "fleet_manager", Some("create-diesel@example.invalid"), None).await;
    let store = identity(&db, "store_manager", Some("create-purchase@example.invalid"), None).await;
    let app = build_app_router(state.clone());
    for (user, role, module, endpoint, payload, table) in [
        (
            accountant,
            "accountant",
            "expenses",
            "expenses",
            json!({"category":"CI expense","amount":10.0}),
            "plant_expenses",
        ),
        (
            fleet,
            "fleet_manager",
            "diesel_ledger",
            "diesel",
            json!({"transaction_type":"IN","litres":10.0}),
            "diesel_transactions",
        ),
        (
            store,
            "store_manager",
            "purchases",
            "purchases",
            json!({"supplier_id":Uuid::new_v4(),"receipt_number":"CI-001","lines":[],"total_amount":10.0}),
            "purchase_receipts",
        ),
    ] {
        sqlx::query("INSERT INTO plant_staff(plant_id,user_id,role) VALUES($1,$2,$3)")
            .bind(plant)
            .bind(user)
            .bind(role)
            .execute(&db)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO plant_staff_module_permissions
             (plant_id,user_id,module_key,can_view,can_edit,can_create,updated_by)
             VALUES($1,$2,$3,TRUE,TRUE,FALSE,$4)",
        )
        .bind(plant)
        .bind(user)
        .bind(module)
        .bind(owner)
        .execute(&db)
        .await
        .unwrap();
        let actor = AuthUser {
            user_id: user,
            role: role.to_string(),
            phone: String::new(),
            email: None,
        };
        assert!(
            staff_module_permissions::require(&state, &actor, plant, module, Action::Edit)
                .await
                .is_ok(),
            "{role} must genuinely have Edit on {module} to test Create isolation"
        );
        assert!(
            staff_module_permissions::require(&state, &actor, plant, module, Action::Create)
                .await
                .is_err()
        );
        let login = refresh::issue_after_auth(&state, user, role, "", None, 1)
            .await
            .unwrap();
        let (status, _) = call(
            &app,
            &format!("/api/ops/plants/{plant}/{endpoint}"),
            Some(payload),
            Some(&login.token),
        )
        .await;
        assert_eq!(
            status,
            StatusCode::FORBIDDEN,
            "{endpoint} must not allow Edit as a substitute for Create"
        );
        // Only fixed table names from this synthetic fixture are interpolated.
        let count_query = format!("SELECT COUNT(*) FROM {table} WHERE plant_id=$1");
        let count: i64 = sqlx::query_scalar(&count_query)
            .bind(plant)
            .fetch_one(&db)
            .await
            .unwrap();
        assert_eq!(count, 0, "{endpoint} must not insert a record");
    }
}
