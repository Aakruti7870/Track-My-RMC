use axum::{
    body::{to_bytes, Body},
    http::{Request, StatusCode},
    Router,
};
use serde_json::{json, Value};
use sqlx::PgPool;
use tower::ServiceExt;
use trackmyrmc_backend::{
    auth::totp::TotpEngine, config::AppConfig, routes::build_app_router, state::AppState,
};
use uuid::Uuid;

fn state(db: PgPool) -> AppState {
    AppState::new(
        db,
        AppConfig {
            database_url: String::new(),
            jwt_secret: "authority-web-test-secret".repeat(4),
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
            otp_pepper: "test-pepper".repeat(6),
            otp_expiration_minutes: 5,
            otp_cooldown_seconds: 60,
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
    token: Option<&str>,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let mut req = Request::builder()
        .uri(path)
        .method(if body.is_some() { "POST" } else { "GET" });
    if let Some(token) = token {
        req = req.header("Authorization", format!("Bearer {token}"));
    }
    let response = app
        .clone()
        .oneshot(
            req.header("Content-Type", "application/json")
                .body(Body::from(body.map(|b| b.to_string()).unwrap_or_default()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 100000).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap())
}

async fn identity(db: &PgPool, role: &str, permissions: &[&str]) -> (Uuid, String, String) {
    let id = Uuid::new_v4();
    let email = format!("{}@example.invalid", id.simple());
    let secret = TotpEngine::generate_secret();
    sqlx::query(
        "INSERT INTO users(id,phone,email,hashed_password,full_name,role,is_active)
         VALUES($1,NULL,$2,'!web-only!','Web Security Test',$3,TRUE)",
    )
    .bind(id)
    .bind(&email)
    .bind(role)
    .execute(db)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO user_totp_credentials(user_id,secret_key,is_enabled)
         VALUES($1,$2,TRUE)",
    )
    .bind(id)
    .bind(&secret)
    .execute(db)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO control_center_access(user_id,approved,permissions)
         VALUES($1,TRUE,$2)",
    )
    .bind(id)
    .bind(permissions)
    .execute(db)
    .await
    .unwrap();
    (id, email, secret)
}

#[sqlx::test]
async fn authority_web_login_cannot_cross_into_super_admin_or_mobile(db: PgPool) {
    let app = build_app_router(state(db.clone()));
    let (id, email, secret) = identity(&db, "authority", &["kyc.view", "support.view"]).await;
    let code = TotpEngine::compute_code(&secret, chrono::Utc::now().timestamp() as u64).unwrap();
    assert_eq!(
        call(
            &app,
            "/api/admin/auth/verify-totp",
            None,
            Some(json!({"identifier":email,"code":code})),
        )
        .await
        .0,
        StatusCode::UNAUTHORIZED
    );
    let (status, authenticated) = call(
        &app,
        "/api/authority/auth/verify-totp",
        None,
        Some(json!({"identifier":email,"code":code})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(authenticated["role"], "authority");
    let token = authenticated["token"].as_str().unwrap();
    assert_eq!(
        call(&app, "/api/authority/auth/me", Some(token), None)
            .await
            .1["user"]["id"],
        id.to_string()
    );
    assert_eq!(
        call(&app, "/api/admin/auth/me", Some(token), None).await.0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        call(
            &app,
            "/api/authority/collections/sessions",
            Some(token),
            None
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        call(
            &app,
            "/api/authority/collections/support",
            Some(token),
            None
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        call(&app, "/api/authority/collections/plants", Some(token), None)
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        call(&app, "/api/auth/refresh", Some(token), Some(json!({})))
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );
}

#[sqlx::test]
async fn super_admin_revocation_invalidates_authority_web_session(db: PgPool) {
    let app = build_app_router(state(db.clone()));
    let (_, email, secret) = identity(&db, "authority", &["support.view"]).await;
    let code = TotpEngine::compute_code(&secret, chrono::Utc::now().timestamp() as u64).unwrap();
    let (_, authenticated) = call(
        &app,
        "/api/authority/auth/verify-totp",
        None,
        Some(json!({"identifier":email,"code":code})),
    )
    .await;
    let token = authenticated["token"].as_str().unwrap();
    assert_eq!(
        call(&app, "/api/authority/auth/me", Some(token), None)
            .await
            .0,
        StatusCode::OK
    );
    let (admin_id, admin_email, admin_secret) =
        identity(&db, "central_admin", &["admin_access.manage"]).await;
    let admin_code =
        TotpEngine::compute_code(&admin_secret, chrono::Utc::now().timestamp() as u64).unwrap();
    let (login_status, admin_login) = call(
        &app,
        "/api/admin/auth/verify-totp",
        None,
        Some(json!({"identifier":admin_email,"code":admin_code})),
    )
    .await;
    assert_eq!(login_status, StatusCode::OK);
    let admin_token = admin_login["token"].as_str().unwrap();
    assert_eq!(
        call(
            &app,
            "/api/control-center/step-up",
            Some(admin_token),
            Some(json!({"code":admin_code})),
        )
        .await
        .0,
        StatusCode::OK
    );
    let (status, _) = call(
        &app,
        "/api/control-center/authority-access",
        Some(admin_token),
        Some(json!({
            "email":email,
            "full_name":"Web Security Test",
            "enabled":false,
            "permissions":[],
            "reason":"Approved Central Admin revocation during isolated test",
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        call(&app, "/api/authority/auth/me", Some(token), None)
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );
    assert_ne!(admin_id, Uuid::nil());
}
