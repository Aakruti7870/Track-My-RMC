use axum::{
    body::{to_bytes, Body},
    http::{Request, StatusCode},
    Router,
};
use bigdecimal::BigDecimal;
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
            jwt_secret: "isolated-orders".repeat(8),
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
            otp_pepper: "isolated-orders".repeat(5),
            otp_expiration_minutes: 5,
            otp_cooldown_seconds: 60,
            otp_max_verification_attempts: 3,
            play_signing_sha256: None,
            play_review_access_code: None,
            google_places_api_key: None,
        },
    )
}

async fn identity(db: &PgPool, role: &str) -> Uuid {
    sqlx::query_scalar("INSERT INTO users(phone,hashed_password,full_name,role) VALUES($1,'unused','Customer',$2) RETURNING id")
        .bind(Uuid::new_v4().simple().to_string()[..18].to_string()).bind(role).fetch_one(db).await.unwrap()
}

async fn fixture(db: &PgPool) -> (AppState, Router, Uuid, Uuid, String) {
    let customer = identity(db, "customer").await;
    let owner = identity(db, "owner").await;
    sqlx::query("INSERT INTO user_profiles(user_id,kyc_status,verified_name) VALUES($1,'verified','Customer')").bind(customer).execute(db).await.unwrap();
    let plant:Uuid=sqlx::query_scalar("INSERT INTO rmc_plants(owner_id,name,code,latitude,longitude,address_line,city,state,pincode,contact_phone) VALUES($1,'Test','TEST',19,73,'Test','Test','Test','0','0') RETURNING id").bind(owner).fetch_one(db).await.unwrap();
    sqlx::query("INSERT INTO plant_listing_requests(name,address,lat,lng,status,plant_id) VALUES('Test','Test',19,73,'APPROVED',$1)").bind(plant).execute(db).await.unwrap();
    sqlx::query("INSERT INTO plant_rate_cards(plant_id,grade,rate_per_m3) VALUES($1,'M25',5000)")
        .bind(plant)
        .execute(db)
        .await
        .unwrap();
    let state = state(db.clone());
    let token =
        generate_token(customer, "customer", "", None, &state.config.jwt_secret, 1).unwrap();
    let app = build_app_router(state.clone());
    (state, app, customer, plant, token)
}

fn order(plant: Uuid, key: &str) -> Value {
    json!({"plant_id":plant,"site_id":null,"grade":"M25","quantity":6,"delivery_date":(chrono::Utc::now().date_naive()+chrono::Duration::days(1)).to_string(),"delivery_time":"10:00","site_name":"Site","site_address":"Manual address","lat":null,"lng":null,"contact_person":"Customer","contact_mobile":null,"notes":null,"quotation_id":null,"save_draft":false,"idempotency_key":key,"estimated_rate_per_m3":1})
}

async fn call(app: &Router, path: &str, body: Option<Value>, token: &str) -> (StatusCode, Value) {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(path)
                .method(if body.is_some() { "POST" } else { "GET" })
                .header("Authorization", format!("Bearer {token}"))
                .header("Content-Type", "application/json")
                .body(Body::from(body.map(|b| b.to_string()).unwrap_or_default()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 100000).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

#[sqlx::test]
async fn mobile_order_contract_uses_server_prices_and_concurrent_retries_create_one_site(
    db: PgPool,
) {
    let (_, app, customer, plant, token) = fixture(&db).await;
    let payload = order(plant, "mobile-order-request-1");
    let (a, b) = tokio::join!(
        call(&app, "/api/customer/orders", Some(payload.clone()), &token),
        call(&app, "/api/customer/orders", Some(payload.clone()), &token)
    );
    assert_eq!(a.0, StatusCode::OK);
    assert_eq!(b.0, StatusCode::OK);
    assert_eq!(a.1["id"], b.1["id"]);
    let money: (BigDecimal, BigDecimal) =
        sqlx::query_as("SELECT total_amount,tax_amount FROM orders WHERE customer_id=$1")
            .bind(customer)
            .fetch_one(&db)
            .await
            .unwrap();
    assert_eq!(money, (BigDecimal::from(35400), BigDecimal::from(5400)));
    let counts:(i64,i64)=sqlx::query_as("SELECT (SELECT COUNT(*) FROM orders WHERE customer_id=$1),(SELECT COUNT(*) FROM customer_sites WHERE customer_id=$1)").bind(customer).fetch_one(&db).await.unwrap();
    assert_eq!(counts, (1, 1));
    let coords: (Option<f64>, Option<f64>) =
        sqlx::query_as("SELECT latitude,longitude FROM customer_sites WHERE customer_id=$1")
            .bind(customer)
            .fetch_one(&db)
            .await
            .unwrap();
    assert_eq!(coords, (None, None));
    sqlx::query("UPDATE plant_rate_cards SET rate_per_m3=6000 WHERE plant_id=$1")
        .bind(plant)
        .execute(&db)
        .await
        .unwrap();
    assert_eq!(
        call(&app, "/api/customer/orders", Some(payload.clone()), &token)
            .await
            .1["id"],
        a.1["id"]
    );
    let mut changed = payload;
    changed["quantity"] = json!(7);
    assert_eq!(
        call(&app, "/api/customer/orders", Some(changed), &token)
            .await
            .0,
        StatusCode::CONFLICT
    );
    let (status, detail) = call(
        &app,
        &format!("/api/customer/orders/{}", a.1["id"].as_str().unwrap()),
        None,
        &token,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(detail["order"]["quantity"], 6.0);
    assert_eq!(detail["order"]["site_address"], "Manual address");
}

#[sqlx::test]
async fn orders_enforce_kyc_site_ownership_rate_validity_and_draft_boundary(db: PgPool) {
    let (state, app, customer, plant, token) = fixture(&db).await;
    let mut payload = order(plant, "mobile-order-boundaries");
    sqlx::query("UPDATE user_profiles SET kyc_status='unverified' WHERE user_id=$1")
        .bind(customer)
        .execute(&db)
        .await
        .unwrap();
    assert_eq!(
        call(&app, "/api/customer/orders", Some(payload.clone()), &token)
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    payload["save_draft"] = json!(true);
    let (status, draft) = call(&app, "/api/customer/orders", Some(payload.clone()), &token).await;
    assert_eq!(status, StatusCode::OK);
    let owner: Uuid = sqlx::query_scalar("SELECT owner_id FROM rmc_plants WHERE id=$1")
        .bind(plant)
        .fetch_one(&db)
        .await
        .unwrap();
    let owner_token =
        generate_token(owner, "owner", "", None, &state.config.jwt_secret, 1).unwrap();
    assert_eq!(
        call(
            &app,
            &format!(
                "/api/owner/orders/{}/approve",
                draft["id"].as_str().unwrap()
            ),
            Some(json!({})),
            &owner_token
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    sqlx::query("UPDATE user_profiles SET kyc_status='verified' WHERE user_id=$1")
        .bind(customer)
        .execute(&db)
        .await
        .unwrap();
    let foreign = identity(&db, "customer").await;
    let site:Uuid=sqlx::query_scalar("INSERT INTO customer_sites(customer_id,name,address_line,city,state,pincode,contact_person,contact_phone) VALUES($1,'Foreign','Private','','','','','') RETURNING id").bind(foreign).fetch_one(&db).await.unwrap();
    payload["idempotency_key"] = json!("mobile-new-order-boundaries");
    payload["save_draft"] = json!(false);
    payload["site_id"] = json!(site);
    assert_eq!(
        call(
            &app,
            "/api/customer/quotation-requests",
            Some(json!({"plant_id":plant,"site_id":site,"grade":"M25","quantity":6})),
            &token
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        call(&app, "/api/customer/orders", Some(payload.clone()), &token)
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    payload["site_id"] = Value::Null;
    sqlx::query("UPDATE plant_rate_cards SET effective_from=CURRENT_DATE+1 WHERE plant_id=$1")
        .bind(plant)
        .execute(&db)
        .await
        .unwrap();
    assert_eq!(
        call(&app, "/api/customer/orders", Some(payload.clone()), &token)
            .await
            .0,
        StatusCode::CONFLICT
    );
    payload["quantity"] = json!(-1);
    assert_eq!(
        call(&app, "/api/customer/orders", Some(payload), &token)
            .await
            .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM orders WHERE plant_id=$1")
            .bind(plant)
            .fetch_one(&db)
            .await
            .unwrap(),
        1
    );
}

#[sqlx::test]
async fn accepted_quotation_is_consumed_once_with_immutable_financial_totals(db: PgPool) {
    let (_, app, customer, plant, token) = fixture(&db).await;
    let quote:Uuid=sqlx::query_scalar("INSERT INTO plant_quotations(plant_id,quotation_number,customer_id,customer_name,site_name,site_address,grade,quantity_m3,rate_per_m3,transport_amount,total_amount,valid_until,status) VALUES($1,'QT-TEST',$2,'Customer','Site','Address','M25',6,4500,100,31978,CURRENT_DATE+7,'SENT') RETURNING id").bind(plant).bind(customer).fetch_one(&db).await.unwrap();
    let (status, list) = call(&app, "/api/ops/customer/quotations", None, &token).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(list["quotations"][0]["total"], 31978.0);
    assert_eq!(list["quotations"][0]["quantity_m3"], 6.0);
    let decision = format!("/api/ops/customer/quotations/{quote}/decision");
    assert_eq!(
        call(&app, &decision, Some(json!({"action":"UNKNOWN"})), &token)
            .await
            .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        call(&app, &decision, Some(json!({"action":"ACCEPT"})), &token)
            .await
            .0,
        StatusCode::OK
    );
    assert_eq!(
        call(&app, &decision, Some(json!({"action":"ACCEPT"})), &token)
            .await
            .0,
        StatusCode::OK
    );
    let mut a = order(plant, "quotation-order-a");
    a["quotation_id"] = json!(quote);
    let mut b = a.clone();
    b["idempotency_key"] = json!("quotation-order-b");
    let (a, b) = tokio::join!(
        call(&app, "/api/customer/orders", Some(a), &token),
        call(&app, "/api/customer/orders", Some(b), &token)
    );
    assert!(
        (a.0 == StatusCode::OK && b.0 == StatusCode::CONFLICT)
            || (b.0 == StatusCode::OK && a.0 == StatusCode::CONFLICT)
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM orders WHERE quotation_id=$1")
            .bind(quote)
            .fetch_one(&db)
            .await
            .unwrap(),
        1
    );
    assert_eq!(
        sqlx::query_scalar::<_, String>("SELECT status FROM plant_quotations WHERE id=$1")
            .bind(quote)
            .fetch_one(&db)
            .await
            .unwrap(),
        "ORDER_CREATED"
    );
    let amounts: (BigDecimal, BigDecimal) =
        sqlx::query_as("SELECT total_amount,tax_amount FROM orders WHERE quotation_id=$1")
            .bind(quote)
            .fetch_one(&db)
            .await
            .unwrap();
    assert_eq!(amounts, (BigDecimal::from(31978), BigDecimal::from(4878)));
    assert_eq!(
        call(&app, &decision, Some(json!({"action":"DECLINE"})), &token)
            .await
            .0,
        StatusCode::CONFLICT
    );
}

#[sqlx::test]
async fn assistant_confirmation_requires_stored_customer_intent_and_reviewed_price(db: PgPool) {
    let (state, app, _, plant, token) = fixture(&db).await;
    let payload = order(plant, "assistant-request-test");
    assert_eq!(
        call(
            &app,
            "/api/assistant/orders/confirm",
            Some(json!({"intent_token":"forged","confirmed":true})),
            &token
        )
        .await
        .0,
        StatusCode::UNAUTHORIZED
    );
    let (status, intent) = call(
        &app,
        "/api/assistant/orders/prepare",
        Some(json!({"order":payload})),
        &token,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM orders WHERE plant_id=$1")
            .bind(plant)
            .fetch_one(&db)
            .await
            .unwrap(),
        0
    );
    let foreign = identity(&db, "customer").await;
    let foreign_token =
        generate_token(foreign, "customer", "", None, &state.config.jwt_secret, 1).unwrap();
    let confirm = json!({"intent_token":intent["intent_token"],"confirmed":true});
    assert_eq!(
        call(
            &app,
            "/api/assistant/orders/confirm",
            Some(confirm.clone()),
            &foreign_token
        )
        .await
        .0,
        StatusCode::UNAUTHORIZED
    );
    sqlx::query("UPDATE plant_rate_cards SET rate_per_m3=5500 WHERE plant_id=$1")
        .bind(plant)
        .execute(&db)
        .await
        .unwrap();
    assert_eq!(
        call(
            &app,
            "/api/assistant/orders/confirm",
            Some(confirm.clone()),
            &token
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    sqlx::query("UPDATE plant_rate_cards SET rate_per_m3=5000 WHERE plant_id=$1")
        .bind(plant)
        .execute(&db)
        .await
        .unwrap();
    let (a, b) = tokio::join!(
        call(
            &app,
            "/api/assistant/orders/confirm",
            Some(confirm.clone()),
            &token
        ),
        call(&app, "/api/assistant/orders/confirm", Some(confirm), &token)
    );
    assert_eq!(a.0, StatusCode::OK);
    assert_eq!(b.0, StatusCode::OK);
    assert_eq!(a.1["id"], b.1["id"]);
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM orders WHERE plant_id=$1")
            .bind(plant)
            .fetch_one(&db)
            .await
            .unwrap(),
        1
    );
}

#[sqlx::test]
async fn automation_missing_credentials_expired_leases_and_unconfigured_delivery_fail_closed(
    db: PgPool,
) {
    let (mut state, app, _, plant, token) = fixture(&db).await;
    let (_, created) = call(
        &app,
        "/api/customer/orders",
        Some(order(plant, "automation-order-test")),
        &token,
    )
    .await;
    let order: Uuid = created["id"].as_str().unwrap().parse().unwrap();
    let lease = Uuid::new_v4().to_string();
    let event:Uuid=sqlx::query_scalar("INSERT INTO order_automation_events(order_id,status,routing_key,worker_id,lease_token,lease_expires_at) VALUES($1,'PROCESSING','order.test','worker',$2,NOW()-INTERVAL '1 minute') RETURNING id").bind(order).bind(&lease).fetch_one(&db).await.unwrap();
    state.automation_worker_token = None;
    state.automation_callback_token = None;
    let app = build_app_router(state.clone());
    assert_eq!(
        call(
            &app,
            "/api/automation/worker-health",
            None,
            "test_automation_worker_secret_token_min_32_chars"
        )
        .await
        .0,
        StatusCode::INTERNAL_SERVER_ERROR
    );
    let worker = Uuid::new_v4().to_string();
    state.automation_worker_token = Some(worker.clone());
    let app = build_app_router(state);
    let payload = json!({"worker_id":"worker","lease_token":lease});
    assert_eq!(
        call(
            &app,
            &format!("/api/automation/events/{event}/ack"),
            Some(payload.clone()),
            &worker
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    sqlx::query("UPDATE order_automation_events SET lease_expires_at=NOW()+INTERVAL '5 minutes' WHERE id=$1").bind(event).execute(&db).await.unwrap();
    assert_eq!(
        call(
            &app,
            &format!("/api/automation/events/{event}/deliver"),
            Some(payload.clone()),
            &worker
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        sqlx::query_scalar::<_, String>("SELECT status FROM order_automation_events WHERE id=$1")
            .bind(event)
            .fetch_one(&db)
            .await
            .unwrap(),
        "PROCESSING"
    );
    assert_eq!(
        call(
            &app,
            &format!("/api/automation/events/{event}/ack"),
            Some(payload.clone()),
            &worker
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        call(
            &app,
            &format!("/api/automation/events/{event}/ack"),
            Some(payload),
            &worker
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
}

#[sqlx::test]
async fn generic_dispatcher_status_cannot_skip_production_and_pod(db: PgPool) {
    let (state, app, _, plant, token) = fixture(&db).await;
    let (_, created) = call(
        &app,
        "/api/customer/orders",
        Some(order(plant, "dispatcher-status-test")),
        &token,
    )
    .await;
    let id: Uuid = created["id"].as_str().unwrap().parse().unwrap();
    let dispatcher = identity(&db, "dispatcher").await;
    sqlx::query("INSERT INTO plant_staff(plant_id,user_id,role) VALUES($1,$2,'dispatcher')")
        .bind(plant)
        .bind(dispatcher)
        .execute(&db)
        .await
        .unwrap();
    sqlx::query("UPDATE orders SET status='scheduled' WHERE id=$1")
        .bind(id)
        .execute(&db)
        .await
        .unwrap();
    let token = generate_token(
        dispatcher,
        "dispatcher",
        "",
        None,
        &state.config.jwt_secret,
        1,
    )
    .unwrap();
    let response = app
        .oneshot(
            Request::builder()
                .uri(format!("/api/dispatcher/orders/{id}/status"))
                .method("PATCH")
                .header("Authorization", format!("Bearer {token}"))
                .header("Content-Type", "application/json")
                .body(Body::from(json!({"status":"dispatched"}).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CONFLICT);
    assert_eq!(
        sqlx::query_scalar::<_, String>("SELECT status FROM orders WHERE id=$1")
            .bind(id)
            .fetch_one(&db)
            .await
            .unwrap(),
        "scheduled"
    );
}

#[sqlx::test]
async fn cancellation_is_customer_scoped_atomic_and_idempotent(db: PgPool) {
    let (state, app, _, plant, token) = fixture(&db).await;
    let (_, created) = call(
        &app,
        "/api/customer/orders",
        Some(order(plant, "cancel-order-test")),
        &token,
    )
    .await;
    let id: Uuid = created["id"].as_str().unwrap().parse().unwrap();
    let path = format!("/api/customer/orders/{id}/cancel");
    let admin = identity(&db, "admin").await;
    let admin_token =
        generate_token(admin, "admin", "", None, &state.config.jwt_secret, 1).unwrap();
    assert_eq!(
        call(&app, &path, Some(json!({})), &admin_token).await.0,
        StatusCode::FORBIDDEN
    );
    let (a, b) = tokio::join!(
        call(&app, &path, Some(json!({})), &token),
        call(&app, &path, Some(json!({})), &token)
    );
    assert_eq!(a.0, StatusCode::OK);
    assert_eq!(b.0, StatusCode::OK);
    let changes: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM audit_logs WHERE resource_id=$1 AND action='order.cancel'",
    )
    .bind(id.to_string())
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(changes, 1);
    sqlx::query("UPDATE orders SET status='in_production' WHERE id=$1")
        .bind(id)
        .execute(&db)
        .await
        .unwrap();
    assert_eq!(
        call(&app, &path, Some(json!({})), &token).await.0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        sqlx::query_scalar::<_, String>("SELECT status FROM orders WHERE id=$1")
            .bind(id)
            .fetch_one(&db)
            .await
            .unwrap(),
        "in_production"
    );
}

#[sqlx::test]
async fn customer_rfq_owner_response_acceptance_and_order_use_exact_shared_contracts(db: PgPool) {
    let (state, app, _, plant, token) = fixture(&db).await;
    let payload = json!({"plant_id":plant,"grade":"M25","quantity":6,"site_name":"Customer site","site_address":"Address supplied by customer","pump_required":true});
    let (status, request) = call(
        &app,
        "/api/customer/quotation-requests",
        Some(payload),
        &token,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let id = request["id"].as_str().unwrap();
    let (status, requests) = call(&app, "/api/customer/quotation-requests", None, &token).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(requests["requests"][0]["site_name"], "Customer site");
    assert_eq!(requests["requests"][0]["status"], "REQUESTED");
    assert_eq!(requests["requests"][0]["quantity"], 6.0);
    let owner: Uuid = sqlx::query_scalar("SELECT owner_id FROM rmc_plants WHERE id=$1")
        .bind(plant)
        .fetch_one(&db)
        .await
        .unwrap();
    let owner_token =
        generate_token(owner, "owner", "", None, &state.config.jwt_secret, 1).unwrap();
    let (_, me) = call(&app, "/api/me", None, &owner_token).await;
    assert_eq!(me["plant_id"], json!(plant));
    let (_, queue) = call(
        &app,
        &format!("/api/ops/plants/{plant}/quotation-requests"),
        None,
        &owner_token,
    )
    .await;
    assert_eq!(queue["requests"][0]["pump_required"], true);
    assert_eq!(queue["requests"][0]["status"], "REQUESTED");
    let path = format!("/api/ops/plants/{plant}/quotation-requests/{id}/respond");
    let response = json!({"action":"SEND","rate_per_m3":4500.01,"transport_amount":100.01,"pumping_amount":0.02,"gst_rate":18});
    let foreign = identity(&db, "admin").await;
    let foreign_token =
        generate_token(foreign, "admin", "", None, &state.config.jwt_secret, 1).unwrap();
    assert_eq!(
        call(&app, &path, Some(response.clone()), &foreign_token)
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    let (a, b) = tokio::join!(
        call(&app, &path, Some(response.clone()), &owner_token),
        call(&app, &path, Some(response.clone()), &owner_token)
    );
    assert_eq!(a.0, StatusCode::OK);
    assert_eq!(b.0, StatusCode::OK);
    assert_eq!(a.1["quotation"]["id"], b.1["quotation"]["id"]);
    let mut changed = response;
    changed["rate_per_m3"] = json!(4000);
    assert_eq!(
        call(&app, &path, Some(changed), &owner_token).await.0,
        StatusCode::CONFLICT
    );
    let (_, quotes) = call(&app, "/api/ops/customer/quotations", None, &token).await;
    assert_eq!(quotes["quotations"][0]["total"], 31978.11);
    let quote = quotes["quotations"][0]["id"].as_str().unwrap();
    assert_eq!(
        call(
            &app,
            &format!("/api/ops/customer/quotations/{quote}/decision"),
            Some(json!({"action":"ACCEPT"})),
            &token
        )
        .await
        .0,
        StatusCode::OK
    );
    let mut payload = order(plant, "rfq-linked-order-request");
    payload["quotation_id"] = json!(quote);
    payload["site_id"] = requests["requests"][0]["site_id"].clone();
    let (status, order) = call(&app, "/api/customer/orders", Some(payload), &token).await;
    assert_eq!(status, StatusCode::OK);
    let total: BigDecimal = sqlx::query_scalar("SELECT total_amount FROM orders WHERE id=$1")
        .bind(order["id"].as_str().unwrap().parse::<Uuid>().unwrap())
        .fetch_one(&db)
        .await
        .unwrap();
    assert_eq!(total, "31978.11".parse::<BigDecimal>().unwrap());
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM plant_quotations WHERE request_id=$1")
            .bind(id.parse::<Uuid>().unwrap())
            .fetch_one(&db)
            .await
            .unwrap(),
        1
    );
    let direct_path = format!("/api/ops/plants/{plant}/quotations");
    let direct = json!({"customer_name":"Customer","site_name":"Site","site_address":"Address","grade":"M25","quantity_m3":2,"rate_per_m3":987.65,"valid_until":(chrono::Utc::now().date_naive()+chrono::Duration::days(7)).to_string()});
    let mut invalid = direct.clone();
    invalid["rate_per_m3"] = json!(-1);
    assert_eq!(
        call(&app, &direct_path, Some(invalid), &owner_token)
            .await
            .0,
        StatusCode::BAD_REQUEST
    );
    let (a, b) = tokio::join!(
        call(&app, &direct_path, Some(direct.clone()), &owner_token),
        call(&app, &direct_path, Some(direct), &owner_token)
    );
    assert_eq!(a.0, StatusCode::OK);
    assert_eq!(b.0, StatusCode::OK);
    assert_ne!(a.1["quotation_number"], b.1["quotation_number"]);
    assert_eq!(a.1["total_amount"], 2330.85);
}

#[sqlx::test]
async fn saved_site_mobile_contract_serializes_default_and_preserves_linked_records(db: PgPool) {
    let (state, app, customer, plant, token) = fixture(&db).await;
    let body = json!({"name":"Site","address":"Customer supplied address","contact_person":null,"contact_mobile":null,"notes":"Gate 2","is_default":true});
    let (a, b) = tokio::join!(
        call(
            &app,
            "/api/master/customer/sites",
            Some(body.clone()),
            &token
        ),
        call(&app, "/api/master/customer/sites", Some(body), &token)
    );
    assert_eq!(a.0, StatusCode::OK);
    assert_eq!(b.0, StatusCode::OK);
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM customer_sites WHERE customer_id=$1 AND is_default"
        )
        .bind(customer)
        .fetch_one(&db)
        .await
        .unwrap(),
        1
    );
    let (status, sites) = call(&app, "/api/master/customer/sites", None, &token).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(sites["sites"][0]["address"], "Customer supplied address");
    assert_eq!(sites["sites"][0]["notes"], "Gate 2");
    assert!(sites["sites"][0]["lat"].is_null());
    let id = a.1["id"].as_str().unwrap();
    let foreign = identity(&db, "customer").await;
    let foreign_token =
        generate_token(foreign, "customer", "", None, &state.config.jwt_secret, 1).unwrap();
    async fn remove(app: &Router, id: &str, token: &str) -> StatusCode {
        app.clone()
            .oneshot(
                Request::builder()
                    .uri(format!("/api/master/customer/sites/{id}"))
                    .method("DELETE")
                    .header("Authorization", format!("Bearer {token}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap()
            .status()
    }
    assert_eq!(
        remove(&app, id, &foreign_token).await,
        StatusCode::NOT_FOUND
    );
    let mut payload = order(plant, "saved-site-order-request");
    payload["site_id"] = json!(id);
    assert_eq!(
        call(&app, "/api/customer/orders", Some(payload), &token)
            .await
            .0,
        StatusCode::OK
    );
    assert_eq!(remove(&app, id, &token).await, StatusCode::CONFLICT);
    assert_eq!(
        remove(&app, b.1["id"].as_str().unwrap(), &token).await,
        StatusCode::OK
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM customer_sites WHERE customer_id=$1")
            .bind(customer)
            .fetch_one(&db)
            .await
            .unwrap(),
        1
    );
}

#[sqlx::test]
async fn customer_receiving_and_cube_follow_up_persist_observations_with_tenant_isolation(
    db: PgPool,
) {
    let (state, app, _, plant, token) = fixture(&db).await;
    let (_, order) = call(
        &app,
        "/api/customer/orders",
        Some(order(plant, "receiving-order-test")),
        &token,
    )
    .await;
    let cast = chrono::Utc::now().date_naive() - chrono::Duration::days(29);
    let payload = json!({"site_id":order["order"]["site_id"],"order_id":order["id"],"grade":"M25","received_quantity_m3":6,"arrival_time":"10:00","unloading_start_time":"10:10","unloading_end_time":"10:40","observed_slump_mm":120,"cube_sample_ids":["S-1"],"sample_cast_date":cast,"checklist":{"challan":true,"unknown":true},"notes":"Customer observation"});
    let foreign = identity(&db, "customer").await;
    let foreign_token =
        generate_token(foreign, "customer", "", None, &state.config.jwt_secret, 1).unwrap();
    assert_eq!(
        call(
            &app,
            "/api/customer/receiving-records",
            Some(payload.clone()),
            &foreign_token
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    let mut invalid = payload.clone();
    invalid["grade"] = json!("M30");
    assert_eq!(
        call(
            &app,
            "/api/customer/receiving-records",
            Some(invalid),
            &token
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    let mut invalid = payload.clone();
    invalid["unloading_start_time"] = json!("09:50");
    assert_eq!(
        call(
            &app,
            "/api/customer/receiving-records",
            Some(invalid),
            &token
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    let mut invalid = payload.clone();
    invalid["cube_sample_ids"] = json!(["S-1", "s-1"]);
    assert_eq!(
        call(
            &app,
            "/api/customer/receiving-records",
            Some(invalid),
            &token
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    let (status, record) = call(
        &app,
        "/api/customer/receiving-records",
        Some(payload),
        &token,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(record["record"]["received_quantity_m3"], 6.0);
    assert_eq!(record["record"]["record_type"], "CUSTOMER_OBSERVATION");
    assert_eq!(record["record"]["pending_cube_tests"], 2);
    assert_eq!(record["record"]["overdue_cube_tests"], 2);
    assert_eq!(record["record"]["unloading_end_time"], "10:40");
    assert!(record["record"]["checklist"].get("unknown").is_none());
    let id = record["id"].as_str().unwrap();
    async fn patch(app: &Router, path: &str, payload: Value, token: &str) -> (StatusCode, Value) {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri(path)
                    .method("PATCH")
                    .header("Content-Type", "application/json")
                    .header("Authorization", format!("Bearer {token}"))
                    .body(Body::from(payload.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        let status = response.status();
        let body = to_bytes(response.into_body(), 100000).await.unwrap();
        (status, serde_json::from_slice(&body).unwrap())
    }
    let path = format!("/api/customer/receiving-records/{id}/cube-results");
    let result = json!({"sample_id":"s-1","age_days":7,"tested_on":(cast+chrono::Duration::days(7)).to_string(),"result_mpa":31.5,"notes":"As reported by customer"});
    let admin = identity(&db, "admin").await;
    let admin_token =
        generate_token(admin, "admin", "", None, &state.config.jwt_secret, 1).unwrap();
    assert_eq!(
        patch(&app, &path, result.clone(), &admin_token).await.0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        patch(&app, &path, result.clone(), &foreign_token).await.0,
        StatusCode::NOT_FOUND
    );
    let mut invalid = result.clone();
    invalid["sample_id"] = json!("unknown");
    assert_eq!(
        patch(&app, &path, invalid, &token).await.0,
        StatusCode::BAD_REQUEST
    );
    let (a, b) = tokio::join!(
        patch(&app, &path, result.clone(), &token),
        patch(&app, &path, result, &token)
    );
    assert_eq!(a.0, StatusCode::OK);
    assert_eq!(b.0, StatusCode::OK);
    assert_eq!(a.1["id"], b.1["id"]);
    assert_eq!(a.1["record"]["pending_cube_tests"], 1);
    assert_eq!(a.1["record"]["cube_test_results"][0]["result_mpa"], 31.5);
    assert!(a.1["record"]["cube_test_results"][0]["acceptance_status"].is_null());
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM cube_test_results WHERE record_id=$1")
            .bind(id.parse::<Uuid>().unwrap())
            .fetch_one(&db)
            .await
            .unwrap(),
        1
    );
    let second = json!({"sample_id":"S-1","age_days":28,"tested_on":chrono::Utc::now().date_naive().to_string(),"result_mpa":42});
    assert_eq!(
        patch(&app, &path, second, &token).await.1["record"]["pending_cube_tests"],
        0
    );
    let (_, rows) = call(
        &app,
        "/api/customer/receiving-records",
        None,
        &foreign_token,
    )
    .await;
    assert_eq!(rows["records"].as_array().unwrap().len(), 0);
    let (_, rows) = call(&app, "/api/customer/receiving-records", None, &token).await;
    assert_eq!(
        rows["records"][0]["cube_test_results"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
}

#[sqlx::test]
async fn pour_plan_returns_saved_load_schedule_without_allocating_real_trips(db: PgPool) {
    let (state, app, customer, _, token) = fixture(&db).await;
    let (_, site) = call(
        &app,
        "/api/master/customer/sites",
        Some(json!({"name":"Pour site","address":"Customer address"})),
        &token,
    )
    .await;
    let tomorrow = chrono::Utc::now().date_naive() + chrono::Duration::days(1);
    let payload = json!({"site_id":site["id"],"grade":"M25","total_quantity_m3":13,"mixer_capacity_m3":6,"pour_date":tomorrow,"start_time":"23:30","unload_minutes":30,"discharge_mode":"PUMP"});
    let foreign = identity(&db, "customer").await;
    let foreign_token =
        generate_token(foreign, "customer", "", None, &state.config.jwt_secret, 1).unwrap();
    assert_eq!(
        call(
            &app,
            "/api/customer/pour-plans",
            Some(payload.clone()),
            &foreign_token
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    let mut invalid = payload.clone();
    invalid["mixer_capacity_m3"] = json!(0.01);
    invalid["total_quantity_m3"] = json!(10000);
    assert_eq!(
        call(&app, "/api/customer/pour-plans", Some(invalid), &token)
            .await
            .0,
        StatusCode::BAD_REQUEST
    );
    let (status, created) = call(&app, "/api/customer/pour-plans", Some(payload), &token).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(created["plan"]["loads_count"], 3);
    assert_eq!(created["plan"]["loads"][2]["quantity_m3"], 1.0);
    assert_eq!(created["plan"]["loads"][1]["suggested_arrival"], "00:00");
    assert_eq!(created["plan"]["estimated_end_time"], "01:00");
    assert_eq!(
        created["plan"]["estimated_end_date"],
        json!(tomorrow + chrono::Duration::days(1))
    );
    let (_, plans) = call(&app, "/api/customer/pour-plans", None, &token).await;
    assert_eq!(plans["plans"][0]["loads"], created["plan"]["loads"]);
    assert_eq!(plans["plans"][0]["site_address"], "Customer address");
    let (_, plans) = call(&app, "/api/customer/pour-plans", None, &foreign_token).await;
    assert!(plans["plans"].as_array().unwrap().is_empty());
    assert_eq!(sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM order_loads WHERE order_id IN(SELECT id FROM orders WHERE customer_id=$1)").bind(customer).fetch_one(&db).await.unwrap(),0);
}
