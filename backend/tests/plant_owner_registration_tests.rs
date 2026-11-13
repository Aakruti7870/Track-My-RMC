//! Database-backed registration intake contract; no live Meta messages.
use axum::{
    body::{to_bytes, Body},
    http::{Request, StatusCode},
    Router,
};
use serde_json::{json, Value};
use sqlx::PgPool;
use tower::ServiceExt;
use trackmyrmc_backend::{config::AppConfig, routes::build_app_router, state::AppState};
use uuid::Uuid;

fn app(db: PgPool) -> Router {
    build_app_router(AppState::new(
        db,
        AppConfig {
            database_url: String::new(),
            jwt_secret: "owner-registration-test-secret".repeat(4),
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
            otp_pepper: "owner-registration-test-pepper".repeat(5),
            totp_keyring: trackmyrmc_backend::auth::totp_storage::TotpKeyring::for_test_fixtures(),
            otp_expiration_minutes: 5,
            otp_cooldown_seconds: 60,
            otp_max_verification_attempts: 3,
            play_signing_sha256: None,
            play_review_access_code: None,
            google_places_api_key: None,
        },
    ))
}

async fn post(app: &Router, payload: Value) -> (StatusCode, Value) {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/plant-owner-registration/requests")
                .header("Content-Type", "application/json")
                .body(Body::from(payload.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 100_000).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap())
}

#[sqlx::test]
async fn registering_creates_one_pending_lead_and_admin_notice(db: PgPool) {
    let admin: Uuid = sqlx::query_scalar(
        "INSERT INTO users(phone,full_name,role,hashed_password,is_active)
         VALUES($1,'Central Admin Test','central_admin','test-only',TRUE)
         RETURNING id",
    )
    .bind(format!("91{}", &Uuid::new_v4().simple().to_string()[..10]))
    .fetch_one(&db)
    .await
    .unwrap();
    let app = app(db.clone());
    let payload = json!({
        "owner_name": "Plant Applicant",
        "business_name": "Applicant RMC Private Limited",
        "business_address": "Sample test road, Panvel, Maharashtra",
        "email": "Owner@Example.COM",
        "whatsapp_number": "+91 98765 43210"
    });

    let (status, result) = post(&app, payload.clone()).await;
    assert_eq!(status, StatusCode::OK, "{result}");
    assert_eq!(result["status"], "PENDING");
    assert_eq!(result["whatsapp_alert"], "QUEUED");
    assert!(result["request_id"]
        .as_str()
        .unwrap()
        .starts_with("TMRMC-REG-"));

    let saved: (String, String, String) = sqlx::query_as(
        "SELECT status,email,alert_status FROM plant_owner_registration_requests
         WHERE request_number=$1",
    )
    .bind(result["request_id"].as_str().unwrap())
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(saved.0, "PENDING");
    assert_eq!(saved.1, "owner@example.com");
    assert_eq!(saved.2, "PENDING");

    let notices: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM notifications
         WHERE user_id=$1 AND notification_type='plant_owner_registration'",
    )
    .bind(admin)
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(notices, 1);

    let (second_status, _) = post(&app, payload).await;
    assert_eq!(second_status, StatusCode::CONFLICT);
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM plant_owner_registration_requests")
        .fetch_one(&db)
        .await
        .unwrap();
    assert_eq!(count, 1);

    let active_owners: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM users WHERE role IN ('owner','plant_owner')
         AND LOWER(email)='owner@example.com'",
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(active_owners, 0);
}

#[sqlx::test]
async fn invalid_registration_never_persists(db: PgPool) {
    let app = app(db.clone());
    let (status, _) = post(
        &app,
        json!({
            "owner_name": "X", "business_name": "Business",
            "business_address": "Some road", "email": "not-email",
            "whatsapp_number": "123"
        }),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM plant_owner_registration_requests")
        .fetch_one(&db)
        .await
        .unwrap();
    assert_eq!(count, 0);
}
