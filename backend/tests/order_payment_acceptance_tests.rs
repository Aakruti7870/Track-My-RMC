use axum::{
    body::{to_bytes, Body},
    http::{Request, StatusCode},
    Router,
};
use serde_json::{json, Value};
use sqlx::PgPool;
use tower::ServiceExt;
use trackmyrmc_backend::{
    auth::jwt::generate_token, config::AppConfig, routes::build_app_router, state::AppState,
};
use uuid::Uuid;

fn state(db: PgPool) -> AppState {
    AppState::new(
        db,
        AppConfig {
            database_url: String::new(),
            jwt_secret: "payment-acceptance-test".repeat(6),
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
            otp_pepper: "payment-acceptance-test".repeat(6),
            otp_expiration_minutes: 5,
            otp_cooldown_seconds: 60,
            otp_max_verification_attempts: 3,
            play_signing_sha256: None,
            play_review_access_code: None,
            google_places_api_key: None,
        },
    )
}

async fn account(db: &PgPool, role: &str) -> Uuid {
    sqlx::query_scalar(
        "INSERT INTO users(phone,hashed_password,full_name,role) VALUES($1,'unused','Payment Test',$2) RETURNING id"
    ).bind(Uuid::new_v4().simple().to_string()[..18].to_string())
      .bind(role).fetch_one(db).await.unwrap()
}

async fn fixture(db: &PgPool) -> (Router, Uuid, String, String) {
    let customer = account(db, "customer").await;
    let owner = account(db, "owner").await;
    sqlx::query("INSERT INTO user_profiles(user_id,kyc_status,verified_name) VALUES($1,'verified','Payment Test')")
        .bind(customer).execute(db).await.unwrap();
    let plant: Uuid = sqlx::query_scalar(
        "INSERT INTO rmc_plants(owner_id,name,code,latitude,longitude,address_line,city,state,pincode,contact_phone) VALUES($1,'Test','PAY',19,73,'Test','Test','Test','0','0') RETURNING id"
    ).bind(owner).fetch_one(db).await.unwrap();
    sqlx::query(
        "INSERT INTO plant_listing_requests(name,address,lat,lng,status,plant_id) VALUES('Test','Test',19,73,'APPROVED',$1)"
    ).bind(plant).execute(db).await.unwrap();
    sqlx::query("INSERT INTO plant_rate_cards(plant_id,grade,rate_per_m3) VALUES($1,'M25',5000)")
        .bind(plant)
        .execute(db)
        .await
        .unwrap();
    let state = state(db.clone());
    let customer_token =
        generate_token(customer, "customer", "", None, &state.config.jwt_secret, 1).unwrap();
    let owner_token =
        generate_token(owner, "owner", "", None, &state.config.jwt_secret, 1).unwrap();
    (build_app_router(state), plant, customer_token, owner_token)
}

async fn post(app: &Router, path: &str, payload: Value, token: &str) -> (StatusCode, Value) {
    let reply = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(path)
                .header("Authorization", format!("Bearer {token}"))
                .header("Content-Type", "application/json")
                .body(Body::from(payload.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = reply.status();
    let body = to_bytes(reply.into_body(), 100000).await.unwrap();
    (status, serde_json::from_slice(&body).unwrap_or(Value::Null))
}

async fn create(app: &Router, plant: Uuid, mode: &str, customer_token: &str) -> Uuid {
    let req = json!({
        "plant_id":plant, "site_id":null, "grade":"M25", "quantity":6,
        "delivery_date":(chrono::Utc::now().date_naive()+chrono::Duration::days(1)).to_string(),
        "delivery_time":"10:00", "site_name":"Test Site", "site_address":"Test Address",
        "contact_person":"Payment Test", "save_draft":false,
        "preferred_payment_mode":mode,
        "idempotency_key":format!("paytest-{}",Uuid::new_v4().simple())
    });
    let (status, body) = post(app, "/api/customer/orders", req, customer_token).await;
    assert_eq!(status, StatusCode::OK, "order create: {body}");
    body["id"].as_str().unwrap().parse().unwrap()
}

#[sqlx::test]
async fn plant_offer_and_customer_acceptance_release_deferred_order(db: PgPool) {
    let (app, plant, customer, owner) = fixture(&db).await;
    let id = create(&app, plant, "ON_DELIVERY", &customer).await;
    let (status, _) = post(
        &app,
        &format!("/api/owner/orders/{id}/approve"),
        json!({}),
        &owner,
    )
    .await;
    assert_eq!(
        status,
        StatusCode::CONFLICT,
        "legacy approval must not bypass accepted terms"
    );
    let (status, offer) = post(
        &app,
        &format!("/api/owner/orders/{id}/payment-offer"),
        json!({"advance_paise":null}),
        &owner,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "offer: {offer}");
    assert_eq!(offer["status"], "OFFERED");
    let current: String = sqlx::query_scalar("SELECT status FROM orders WHERE id=$1")
        .bind(id)
        .fetch_one(&db)
        .await
        .unwrap();
    assert_eq!(
        current, "pending",
        "plant approval alone cannot release production"
    );
    let (status, accepted) = post(
        &app,
        &format!("/api/customer/orders/{id}/accept-payment-terms"),
        json!({"version":offer["version"]}),
        &customer,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "accept: {accepted}");
    assert_eq!(accepted["status"], "READY_FOR_PRODUCTION");
    let result: (String, String) =
        sqlx::query_as("SELECT status,payment_status FROM orders WHERE id=$1")
            .bind(id)
            .fetch_one(&db)
            .await
            .unwrap();
    assert_eq!(result.0, "confirmed");
    assert_eq!(
        result.1, "unpaid",
        "deferred payment never falsely marks an order paid"
    );
}

#[sqlx::test]
async fn online_advance_never_releases_production_without_verified_payment(db: PgPool) {
    let (app, plant, customer, owner) = fixture(&db).await;
    let id = create(&app, plant, "FULL_ADVANCE", &customer).await;
    let (_, offer) = post(
        &app,
        &format!("/api/owner/orders/{id}/payment-offer"),
        json!({"advance_paise":null}),
        &owner,
    )
    .await;
    let (status, result) = post(
        &app,
        &format!("/api/customer/orders/{id}/accept-payment-terms"),
        json!({"version":offer["version"]}),
        &customer,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "accept: {result}");
    assert_eq!(result["status"], "AWAITING_PAYMENT");
    assert_eq!(result["payment_link"], Value::Null);
    let current: String = sqlx::query_scalar("SELECT status FROM orders WHERE id=$1")
        .bind(id)
        .fetch_one(&db)
        .await
        .unwrap();
    assert_eq!(current, "pending");
    assert!(
        sqlx::query("UPDATE orders SET status='confirmed' WHERE id=$1")
            .bind(id)
            .execute(&db)
            .await
            .is_err(),
        "database must reject premature status release"
    );
    let (status, _) = post(
        &app,
        &format!("/api/owner/orders/{id}/production/start"),
        json!({}),
        &owner,
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    let (status, _) = post(
        &app,
        &format!("/api/customer/orders/{id}/cancel"),
        json!({}),
        &customer,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let offer_status: String =
        sqlx::query_scalar("SELECT status FROM order_payment_offers WHERE order_id=$1")
            .bind(id)
            .fetch_one(&db)
            .await
            .unwrap();
    assert_eq!(offer_status, "CANCELLED");
}

#[sqlx::test]
async fn offer_cannot_be_accepted_by_other_customer(db: PgPool) {
    let (app, plant, customer, owner) = fixture(&db).await;
    let id = create(&app, plant, "APPROVED_CREDIT", &customer).await;
    let (_, offer) = post(
        &app,
        &format!("/api/owner/orders/{id}/payment-offer"),
        json!({"advance_paise":null,"balance_due_on":(chrono::Utc::now().date_naive()+chrono::Duration::days(15)).to_string()}),
        &owner,
    )
    .await;
    let outsider = account(&db, "customer").await;
    let secret = "payment-acceptance-test".repeat(6);
    let outsider_token = generate_token(outsider, "customer", "", None, &secret, 1).unwrap();
    let (status, _) = post(
        &app,
        &format!("/api/customer/orders/{id}/accept-payment-terms"),
        json!({"version":offer["version"]}),
        &outsider_token,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[sqlx::test]
async fn payment_offer_notifies_customer_once_and_acceptance_notifies_plant(db: PgPool) {
    let (app, plant, customer, owner) = fixture(&db).await;
    let id = create(&app, plant, "ON_DELIVERY", &customer).await;
    let endpoint = format!("/api/owner/orders/{id}/payment-offer");
    let (status, offer) = post(&app, &endpoint, json!({"advance_paise":null}), &owner).await;
    assert_eq!(status, StatusCode::OK, "{offer}");
    let (retry_status, retry) = post(&app, &endpoint, json!({"advance_paise":null}), &owner).await;
    assert_eq!(retry_status, StatusCode::OK, "{retry}");
    assert_eq!(retry["version"], offer["version"]);
    assert_eq!(retry["reused"], true);

    let customer_notices: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM notifications WHERE reference_id=$1 AND notification_type='order_payment_offer'"
    ).bind(id.to_string()).fetch_one(&db).await.unwrap();
    assert_eq!(
        customer_notices, 1,
        "idempotent offer retries must not spam customers"
    );

    let (status, accepted) = post(
        &app,
        &format!("/api/customer/orders/{id}/accept-payment-terms"),
        json!({"version":offer["version"]}),
        &customer,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{accepted}");
    let owner_notices: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM notifications WHERE reference_id=$1 AND notification_type='order_terms_accepted'"
    ).bind(id.to_string()).fetch_one(&db).await.unwrap();
    assert_eq!(owner_notices, 1);
}

#[sqlx::test]
async fn rejection_notifies_customer_and_cancels_unaccepted_offer(db: PgPool) {
    let (app, plant, customer, owner) = fixture(&db).await;
    let id = create(&app, plant, "FULL_ADVANCE", &customer).await;
    let (status, offer) = post(
        &app,
        &format!("/api/owner/orders/{id}/payment-offer"),
        json!({"advance_paise":null}),
        &owner,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{offer}");
    let (status, result) = post(
        &app,
        &format!("/api/owner/orders/{id}/reject"),
        json!({}),
        &owner,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{result}");
    let order_status: String = sqlx::query_scalar("SELECT status FROM orders WHERE id=$1")
        .bind(id)
        .fetch_one(&db)
        .await
        .unwrap();
    assert_eq!(order_status, "rejected");
    let offer_status: String =
        sqlx::query_scalar("SELECT status FROM order_payment_offers WHERE order_id=$1")
            .bind(id)
            .fetch_one(&db)
            .await
            .unwrap();
    assert_eq!(offer_status, "CANCELLED");
    let notice_count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM notifications WHERE reference_id=$1 AND notification_type='order_rejected'"
    ).bind(id.to_string()).fetch_one(&db).await.unwrap();
    assert_eq!(notice_count, 1);
}

#[sqlx::test]
async fn plant_cannot_reject_customer_accepted_prepaid_terms(db: PgPool) {
    let (app, plant, customer, owner) = fixture(&db).await;
    let id = create(&app, plant, "FULL_ADVANCE", &customer).await;
    let (_, offer) = post(
        &app,
        &format!("/api/owner/orders/{id}/payment-offer"),
        json!({"advance_paise":null}),
        &owner,
    )
    .await;
    let (status, accepted) = post(
        &app,
        &format!("/api/customer/orders/{id}/accept-payment-terms"),
        json!({"version":offer["version"]}),
        &customer,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{accepted}");
    let (status, _) = post(
        &app,
        &format!("/api/owner/orders/{id}/reject"),
        json!({}),
        &owner,
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    let state: (String, String) = sqlx::query_as(
        "SELECT o.status,p.status FROM orders o JOIN order_payment_offers p ON p.order_id=o.id WHERE o.id=$1"
    ).bind(id).fetch_one(&db).await.unwrap();
    assert_eq!(state.0, "pending");
    assert_eq!(state.1, "AWAITING_PAYMENT");
}

#[sqlx::test]
async fn approved_credit_requires_explicit_future_due_date(db: PgPool) {
    let (app, plant, customer, owner) = fixture(&db).await;
    let id = create(&app, plant, "APPROVED_CREDIT", &customer).await;
    let endpoint = format!("/api/owner/orders/{id}/payment-offer");
    let (missing_status, _) = post(&app, &endpoint, json!({"advance_paise":null}), &owner).await;
    assert_eq!(missing_status, StatusCode::BAD_REQUEST);

    let delivery = chrono::Utc::now().date_naive() + chrono::Duration::days(1);
    let (early_status, _) = post(
        &app,
        &endpoint,
        json!({"advance_paise":null,"balance_due_on":delivery.to_string()}),
        &owner,
    )
    .await;
    assert_eq!(early_status, StatusCode::BAD_REQUEST);

    let due = delivery + chrono::Duration::days(30);
    let (status, response) = post(
        &app,
        &endpoint,
        json!({"advance_paise":null,"balance_due_on":due.to_string()}),
        &owner,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{response}");
    let recorded: (Option<chrono::NaiveDate>, String) =
        sqlx::query_as("SELECT balance_due_on,status FROM order_payment_offers WHERE order_id=$1")
            .bind(id)
            .fetch_one(&db)
            .await
            .unwrap();
    assert_eq!(recorded.0, Some(due));
    assert_eq!(recorded.1, "OFFERED");
    let (status, accepted) = post(
        &app,
        &format!("/api/customer/orders/{id}/accept-payment-terms"),
        json!({"version":response["version"]}),
        &customer,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{accepted}");
    assert_eq!(accepted["status"], "READY_FOR_PRODUCTION");
    let payment_status: String =
        sqlx::query_scalar("SELECT payment_status FROM orders WHERE id=$1")
            .bind(id)
            .fetch_one(&db)
            .await
            .unwrap();
    assert_eq!(
        payment_status, "unpaid",
        "credit must not be recorded as paid"
    );
}

#[sqlx::test]
async fn partial_advance_balance_defaults_to_delivery_day(db: PgPool) {
    let (app, plant, customer, owner) = fixture(&db).await;
    let id = create(&app, plant, "PARTIAL_ADVANCE", &customer).await;
    let (status, offer) = post(
        &app,
        &format!("/api/owner/orders/{id}/payment-offer"),
        json!({"advance_paise":10000}),
        &owner,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{offer}");
    let (due, delivery): (Option<chrono::NaiveDate>, chrono::NaiveDate) = sqlx::query_as(
        "SELECT p.balance_due_on,o.delivery_date FROM order_payment_offers p JOIN orders o ON o.id=p.order_id WHERE o.id=$1"
    ).bind(id).fetch_one(&db).await.unwrap();
    assert_eq!(due, Some(delivery));
}

#[sqlx::test]
async fn changed_server_price_invalidates_outstanding_offer(db: PgPool) {
    let (app, plant, customer, owner) = fixture(&db).await;
    let id = create(&app, plant, "ON_DELIVERY", &customer).await;
    let (status, offer) = post(
        &app,
        &format!("/api/owner/orders/{id}/payment-offer"),
        json!({"advance_paise":null}),
        &owner,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{offer}");
    sqlx::query("UPDATE orders SET total_amount=total_amount+1 WHERE id=$1")
        .bind(id)
        .execute(&db)
        .await
        .unwrap();
    let (status, _) = post(
        &app,
        &format!("/api/customer/orders/{id}/accept-payment-terms"),
        json!({"version":offer["version"]}),
        &customer,
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    let state: String = sqlx::query_scalar("SELECT status FROM orders WHERE id=$1")
        .bind(id)
        .fetch_one(&db)
        .await
        .unwrap();
    assert_eq!(state, "pending", "stale commercial terms must not release an order");
}
