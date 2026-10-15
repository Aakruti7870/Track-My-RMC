use axum::{
    body::{to_bytes, Body},
    http::{Request, StatusCode},
    routing::{get, post},
    Router,
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use tower::ServiceExt;
use trackmyrmc_backend::{
    auth::{control_center, jwt::generate_token, totp::TotpEngine},
    config::AppConfig,
    routes::control_center_routes as cc,
    state::AppState,
};
use uuid::Uuid;

fn state(db: PgPool) -> AppState {
    AppState::new(
        db,
        AppConfig {
            database_url: String::new(),
            jwt_secret: "isolated-test".repeat(8),
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
            otp_pepper: "isolated-test".repeat(5),
            otp_expiration_minutes: 5,
            otp_cooldown_seconds: 60,
            otp_max_verification_attempts: 3,
            play_signing_sha256: None,
            play_review_access_code: None,
            google_places_api_key: None,
        },
    )
}

fn app(state: AppState) -> Router {
    Router::new()
        .route("/login", post(control_center::login))
        .route("/me", get(control_center::me))
        .route("/logout", post(control_center::logout))
        .route("/capabilities", get(cc::get_capabilities))
        .route("/collections/:kind", get(cc::collection))
        .route(
            "/legacy-overview",
            get(trackmyrmc_backend::routes::admin_routes::portal_overview),
        )
        .route("/reviewer", post(cc::set_reviewer_access))
        .route("/step-up", post(cc::admin_step_up))
        .route("/logout-all", post(cc::admin_logout_all))
        .with_state(state)
}

#[sqlx::test]
async fn support_staff_requires_recorded_web_mfa_grants_and_fresh_status_step_up(db: PgPool) {
    let state = state(db.clone());
    let router = trackmyrmc_backend::routes::build_app_router(state.clone());
    let customer:Uuid=sqlx::query_scalar("INSERT INTO users(phone,hashed_password,full_name,role) VALUES('support-ci-customer','unused','Synthetic support customer','customer') RETURNING id").fetch_one(&db).await.unwrap();
    let customer_token =
        generate_token(customer, "customer", "", None, &state.config.jwt_secret, 1).unwrap();
    let (status,case)=request(&router,"/api/assistant/support",Some(&customer_token),Some(json!({"category":"GENERAL","message":"The application needs attention","escalate":true}))).await;
    assert_eq!(status, StatusCode::OK);
    let case_id = case["case_id"].as_str().unwrap();
    let staff_path = format!("/api/assistant/support/staff/cases/{case_id}");
    let (admin, email, secret) = identity(&db, "central_admin", true, vec!["support.view"]).await;
    let code = TotpEngine::compute_code(&secret, chrono::Utc::now().timestamp() as u64).unwrap();
    let (status, login) = request(
        &router,
        "/api/admin/auth/login",
        None,
        Some(json!({"identifier":email,"code":code})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let token = login["token"].as_str().unwrap();
    assert_eq!(
        request(
            &router,
            "/api/assistant/support/staff/cases",
            Some(token),
            None
        )
        .await
        .0,
        StatusCode::OK
    );
    let reply = json!({"message":"Internal triage requires follow-up","internal":true});
    assert_eq!(
        request(
            &router,
            &format!("{staff_path}/replies"),
            Some(token),
            Some(reply.clone())
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    let close = json!({"status":"CLOSED"});
    assert_eq!(
        request(
            &router,
            &format!("{staff_path}/status"),
            Some(token),
            Some(close.clone())
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    sqlx::query("UPDATE control_center_access SET permissions=ARRAY['support.view','support.reply','support.manage'] WHERE user_id=$1").bind(admin).execute(&db).await.unwrap();
    assert_eq!(
        request(
            &router,
            &format!("{staff_path}/replies"),
            Some(token),
            Some(reply)
        )
        .await
        .0,
        StatusCode::OK
    );
    let (_, staff) = request(&router, &staff_path, Some(token), None).await;
    assert_eq!(staff["case"]["messages"].as_array().unwrap().len(), 2);
    let (_, public) = request(
        &router,
        &format!("/api/assistant/support/cases/{case_id}"),
        Some(&customer_token),
        None,
    )
    .await;
    assert_eq!(public["case"]["messages"].as_array().unwrap().len(), 1);
    assert_eq!(
        public["case"]["latest_note"],
        "The application needs attention"
    );
    assert_eq!(
        request(
            &router,
            &format!("{staff_path}/status"),
            Some(token),
            Some(close.clone())
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        request(
            &router,
            "/api/admin/auth/step-up",
            Some(token),
            Some(json!({"code":code}))
        )
        .await
        .0,
        StatusCode::OK
    );
    let path = format!("{staff_path}/status");
    let (a, b) = tokio::join!(
        request(&router, &path, Some(token), Some(close.clone())),
        request(&router, &path, Some(token), Some(close))
    );
    assert_eq!(a.0, StatusCode::OK);
    assert_eq!(b.0, StatusCode::OK);
    assert_eq!(
        request(
            &router,
            &format!("/api/assistant/support/cases/{case_id}/replies"),
            Some(&customer_token),
            Some(json!({"message":"Closed reply"}))
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM audit_logs WHERE resource_id=$1 AND action='support.case.status'"
        )
        .bind(case_id)
        .fetch_one(&db)
        .await
        .unwrap(),
        1
    );
    sqlx::query(
        "UPDATE control_center_step_ups SET expires_at=NOW()-INTERVAL '1 second' WHERE user_id=$1",
    )
    .bind(admin)
    .execute(&db)
    .await
    .unwrap();
    assert_eq!(
        request(&router, &path, Some(token), Some(json!({"status":"OPEN"})))
            .await
            .0,
        StatusCode::FORBIDDEN
    );
}

async fn request(
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

async fn identity(
    db: &PgPool,
    role: &str,
    approved: bool,
    permissions: Vec<&str>,
) -> (Uuid, String, String) {
    let email = format!("{}@example.invalid", Uuid::new_v4());
    let id: Uuid = sqlx::query_scalar("INSERT INTO users (phone,email,hashed_password,full_name,role) VALUES ($1,$2,'unused','Test',$3) RETURNING id")
        .bind(Uuid::new_v4().simple().to_string()[..18].to_string()).bind(&email).bind(role).fetch_one(db).await.unwrap();
    let secret = TotpEngine::generate_secret();
    sqlx::query(
        "INSERT INTO user_totp_credentials (user_id,secret_key,is_enabled) VALUES ($1,$2,TRUE)",
    )
    .bind(id)
    .bind(&secret)
    .execute(db)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO control_center_access (user_id,approved,permissions) VALUES ($1,$2,$3)",
    )
    .bind(id)
    .bind(approved)
    .bind(permissions)
    .execute(db)
    .await
    .unwrap();
    (id, email, secret)
}

#[sqlx::test]
async fn central_admin_requires_approval_web_provenance_and_explicit_permission(db: PgPool) {
    let state = state(db.clone());
    let router = app(state.clone());
    for role in ["admin", "authority", "customer", "owner"] {
        let (id, email, secret) = identity(&db, role, true, vec!["system.view"]).await;
        let code =
            TotpEngine::compute_code(&secret, chrono::Utc::now().timestamp() as u64).unwrap();
        assert_eq!(
            request(
                &router,
                "/login",
                None,
                Some(json!({"identifier":email,"code":code}))
            )
            .await
            .0,
            StatusCode::UNAUTHORIZED
        );
        let token =
            generate_token(id, role, "", Some(&email), &state.config.jwt_secret, 1).unwrap();
        assert_eq!(
            request(&router, "/capabilities", Some(&token), None)
                .await
                .0,
            StatusCode::FORBIDDEN
        );
    }
    let (id, email, secret) = identity(&db, "central_admin", false, vec![]).await;
    let code = TotpEngine::compute_code(&secret, chrono::Utc::now().timestamp() as u64).unwrap();
    assert_eq!(
        request(
            &router,
            "/login",
            None,
            Some(json!({"identifier":email,"code":code}))
        )
        .await
        .0,
        StatusCode::UNAUTHORIZED
    );
    sqlx::query("UPDATE control_center_access SET approved=TRUE WHERE user_id=$1")
        .bind(id)
        .execute(&db)
        .await
        .unwrap();
    let ordinary = generate_token(
        id,
        "central_admin",
        "",
        Some(&email),
        &state.config.jwt_secret,
        1,
    )
    .unwrap();
    assert_eq!(
        request(&router, "/me", Some(&ordinary), None).await.0,
        StatusCode::FORBIDDEN
    );
    let (status, login) = request(
        &router,
        "/login",
        None,
        Some(json!({"identifier":email,"code":code})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let token = login["token"].as_str().unwrap();
    assert_eq!(
        request(&router, "/capabilities", Some(token), None).await.1["permissions"],
        json!([])
    );
    assert_eq!(
        request(
            &router,
            "/reviewer",
            Some(token),
            Some(json!({"enabled":false,"reason":"test permission denial"}))
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    sqlx::query(
        "UPDATE control_center_sessions SET expires_at=NOW()-INTERVAL '1 second' WHERE user_id=$1",
    )
    .bind(id)
    .execute(&db)
    .await
    .unwrap();
    assert_eq!(
        request(&router, "/me", Some(token), None).await.0,
        StatusCode::FORBIDDEN
    );
}

#[sqlx::test]
async fn step_up_is_session_bound_expiring_and_logout_revokes_sessions(db: PgPool) {
    let state = state(db.clone());
    let router = app(state.clone());
    let (id, email, secret) =
        identity(&db, "central_admin", true, vec!["reviewer_access.manage"]).await;
    let code = TotpEngine::compute_code(&secret, chrono::Utc::now().timestamp() as u64).unwrap();
    let (_, login) = request(
        &router,
        "/login",
        None,
        Some(json!({"identifier":email,"code":code})),
    )
    .await;
    let token = login["token"].as_str().unwrap();
    let payload = json!({"enabled":false,"reason":"isolated test reviewer switch"});
    assert_eq!(
        request(&router, "/reviewer", Some(token), Some(payload.clone()))
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        request(&router, "/step-up", Some(token), Some(json!({"code":code})))
            .await
            .0,
        StatusCode::OK
    );
    let second = generate_token(
        id,
        "central_admin",
        "",
        Some(&email),
        &state.config.jwt_secret,
        1,
    )
    .unwrap();
    assert_ne!(token, second);
    let hash = format!("{:x}", Sha256::digest(second.as_bytes()));
    sqlx::query("INSERT INTO control_center_sessions (token_hash,user_id,expires_at) VALUES ($1,$2,NOW()+INTERVAL '1 hour')").bind(hash).bind(id).execute(&db).await.unwrap();
    assert_eq!(
        request(&router, "/reviewer", Some(&second), Some(payload.clone()))
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        request(&router, "/reviewer", Some(token), Some(payload.clone()))
            .await
            .0,
        StatusCode::OK
    );
    sqlx::query(
        "UPDATE control_center_step_ups SET expires_at=NOW()-INTERVAL '1 second' WHERE user_id=$1",
    )
    .bind(id)
    .execute(&db)
    .await
    .unwrap();
    assert_eq!(
        request(&router, "/reviewer", Some(token), Some(payload))
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    request(&router, "/step-up", Some(token), Some(json!({"code":code}))).await;
    assert_eq!(
        request(&router, "/logout-all", Some(token), Some(json!({})))
            .await
            .0,
        StatusCode::OK
    );
    assert_eq!(
        request(&router, "/me", Some(token), None).await.0,
        StatusCode::UNAUTHORIZED
    );
    let count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM control_center_step_ups WHERE user_id=$1")
            .bind(id)
            .fetch_one(&db)
            .await
            .unwrap();
    assert_eq!(count, 0);
}

#[sqlx::test]
async fn stale_role_claims_are_rejected_and_otp_replay_does_not_mint_session(db: PgPool) {
    let state = state(db.clone());
    let router = app(state.clone());
    let (id, email, secret) = identity(&db, "central_admin", true, vec![]).await;
    let code = TotpEngine::compute_code(&secret, chrono::Utc::now().timestamp() as u64).unwrap();
    let (_, login) = request(
        &router,
        "/login",
        None,
        Some(json!({"identifier":email,"code":code})),
    )
    .await;
    let token = login["token"].as_str().unwrap();
    assert_eq!(
        request(
            &router,
            "/login",
            None,
            Some(json!({"identifier":email,"code":code}))
        )
        .await
        .0,
        StatusCode::UNAUTHORIZED
    );
    sqlx::query("UPDATE users SET role='admin' WHERE id=$1")
        .bind(id)
        .execute(&db)
        .await
        .unwrap();
    assert_eq!(
        request(&router, "/me", Some(token), None).await.0,
        StatusCode::UNAUTHORIZED
    );
}

#[sqlx::test]
async fn read_workspaces_execute_and_enforce_individual_permissions(db: PgPool) {
    let state = state(db.clone());
    let router = app(state);
    let (_, email, secret) = identity(
        &db,
        "central_admin",
        true,
        vec![
            "user.view",
            "plant.view",
            "order.view",
            "support.view",
            "audit.view",
            "session.view",
        ],
    )
    .await;
    let code = TotpEngine::compute_code(&secret, chrono::Utc::now().timestamp() as u64).unwrap();
    let (status, result) = request(
        &router,
        "/login",
        None,
        Some(json!({"identifier":email,"code":code})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let token = result["token"].as_str().unwrap();
    for kind in ["users", "plants", "orders", "support", "audit", "sessions"] {
        let (status, data) = request(
            &router,
            &format!("/collections/{kind}?limit=1"),
            Some(token),
            None,
        )
        .await;
        assert_eq!(
            status,
            StatusCode::OK,
            "{kind} must execute against PostgreSQL"
        );
        assert!(data["items"].is_array());
        assert!(data["items"].as_array().unwrap().len() <= 1);
    }
    assert_eq!(
        request(&router, "/legacy-overview", Some(token), None)
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    sqlx::query("UPDATE control_center_access SET permissions='{}' WHERE user_id=(SELECT id FROM users WHERE email=$1)").bind(email).execute(&db).await.unwrap();
    assert_eq!(
        request(&router, "/collections/users", Some(token), None)
            .await
            .0,
        StatusCode::FORBIDDEN
    );
}

#[sqlx::test]
async fn central_logout_revokes_only_the_current_web_session(db: PgPool) {
    let state = state(db.clone());
    let router = app(state.clone());
    let (id, email, secret) = identity(&db, "central_admin", true, vec![]).await;
    let code = TotpEngine::compute_code(&secret, chrono::Utc::now().timestamp() as u64).unwrap();
    let (_, result) = request(
        &router,
        "/login",
        None,
        Some(json!({"identifier":email,"code":code})),
    )
    .await;
    let first = result["token"].as_str().unwrap();
    let second = generate_token(
        id,
        "central_admin",
        "",
        Some(&email),
        &state.config.jwt_secret,
        1,
    )
    .unwrap();
    sqlx::query("INSERT INTO control_center_sessions (user_id,token_hash,expires_at) VALUES ($1,$2,NOW()+INTERVAL '1 hour')")
        .bind(id).bind(format!("{:x}",Sha256::digest(second.as_bytes()))).execute(&db).await.unwrap();
    assert_eq!(
        request(&router, "/logout", Some(first), Some(json!({})))
            .await
            .0,
        StatusCode::OK
    );
    assert_eq!(
        request(&router, "/me", Some(first), None).await.0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        request(&router, "/me", Some(&second), None).await.0,
        StatusCode::OK
    );
}
