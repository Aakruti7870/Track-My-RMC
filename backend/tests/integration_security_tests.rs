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

const SYNTHETIC_PASSWORD: &str = "Synthetic-CI-Only-Password-2026!";
const SYNTHETIC_PASSWORD_HASH: &str = "$argon2id$v=19$m=19456,t=2,p=1$SvWTeNFS61/Ui+SOXVyNJw$JGIBa6UrWI3fvkiDP+jDI+a6plEeoYVpTM72VyGddR8";

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
async fn only_step_up_control_center_can_issue_and_revoke_plant_owner_access(db: PgPool) {
    use trackmyrmc_backend::{auth::refresh, routes::build_app_router};
    let state = state(db.clone());
    let router = build_app_router(state.clone());
    let (admin, email, secret) =
        identity(&db, "central_admin", true, vec!["plant_owners.manage"]).await;
    let (mobile, _, _) = identity(&db, "admin", true, vec!["plant_owners.manage"]).await;
    let mobile_token =
        generate_token(mobile, "admin", "", None, &state.config.jwt_secret, 1).unwrap();
    assert_eq!(
        request(
            &router,
            "/api/plant-discovery/requests",
            Some(&mobile_token),
            None
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    let pending:Uuid=sqlx::query_scalar("INSERT INTO plant_listing_requests(name,address,lat,lng,applicant_owner_name,applicant_email,applicant_mobile) VALUES('Owner approval CI','Synthetic test address',0,0,'New Owner','authority-owner@example.invalid','12025550888') RETURNING id")
        .fetch_one(&db).await.unwrap();
    let path = format!("/api/plant-discovery/requests/{pending}/approve");
    let body = json!({"city":"Test City","state":"Test Region","pincode":"400001"});
    let code = TotpEngine::compute_code(&secret, chrono::Utc::now().timestamp() as u64).unwrap();
    let (status, login) = request(
        &router,
        "/api/admin/auth/verify-totp",
        None,
        Some(json!({"identifier":email,"password":SYNTHETIC_PASSWORD,"code":TotpEngine::compute_code(&secret, (chrono::Utc::now().timestamp()-30) as u64).unwrap()})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let token = login["token"].as_str().unwrap();
    assert_eq!(
        request(&router, &path, Some(token), Some(body.clone()))
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
    let (status, approved) = request(&router, &path, Some(token), Some(body)).await;
    assert_eq!(status, StatusCode::OK);
    let owner = Uuid::parse_str(approved["owner_id"].as_str().unwrap()).unwrap();
    let plant = Uuid::parse_str(approved["plant_id"].as_str().unwrap()).unwrap();
    assert_eq!(
        sqlx::query_scalar::<_, Uuid>("SELECT owner_id FROM rmc_plants WHERE id=$1")
            .bind(plant)
            .fetch_one(&db)
            .await
            .unwrap(),
        owner
    );
    let owner_session = refresh::issue_after_auth(
        &state,
        owner,
        "owner",
        "12025550888",
        Some("authority-owner@example.invalid"),
        1,
    )
    .await
    .unwrap();
    assert_eq!(
        request(
            &router,
            "/api/plant-discovery/requests",
            Some(&owner_session.token),
            None
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    let status_path = format!("/api/control-center/owners/{owner}/status");
    assert_eq!(
        request(
            &router,
            &status_path,
            Some(&mobile_token),
            Some(json!({"active":false,"reason":"Unprivileged mobile role must be denied"}))
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        request(
            &router,
            &status_path,
            Some(token),
            Some(json!({"active":false,"reason":"Compromised synthetic Owner session"}))
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        request(&router, "/api/me", Some(&owner_session.token), None)
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );
    assert!(refresh::rotate(&state, &owner_session.refresh_token)
        .await
        .is_err());
    assert_eq!(
        request(
            &router,
            &status_path,
            Some(token),
            Some(json!({"active":true,"reason":"Authorized synthetic Owner reactivation"}))
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        request(&router, "/api/me", Some(&owner_session.token), None)
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM audit_logs WHERE user_id=$1 AND action IN ('plant_listing.approve','plant_owner.status')").bind(admin).fetch_one(&db).await.unwrap(),3);
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
    // Creation and the first customer reply must commit alongside the
    // platform follow-up timer; no plant-scoped automation job is invented.
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM native_support_followups
             WHERE case_id=$1::uuid AND awaiting_staff_reply AND reminder_count=0"
        )
        .bind(case_id)
        .fetch_one(&db)
        .await
        .unwrap(),
        1
    );
    let staff_path = format!("/api/assistant/support/staff/cases/{case_id}");
    let (admin, email, secret) = identity(&db, "central_admin", true, vec!["support.view"]).await;
    let code = TotpEngine::compute_code(&secret, chrono::Utc::now().timestamp() as u64).unwrap();
    let (status, login) = request(
        &router,
        "/api/admin/auth/verify-totp",
        None,
        Some(json!({"identifier":email,"password":SYNTHETIC_PASSWORD,"code":TotpEngine::compute_code(&secret, (chrono::Utc::now().timestamp()-30) as u64).unwrap()})),
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
    let (alerts_status, alerts_body) = request(
        &router,
        "/api/assistant/support/staff/alerts",
        Some(token),
        None,
    )
    .await;
    assert_eq!(alerts_status, StatusCode::OK);
    assert!(alerts_body["alerts"].as_array().unwrap().is_empty());
    // A staff alert is visible only in its owner web session; marking it
    // read never changes the support case or its independent SLA timer.
    let alert_id: Uuid = sqlx::query_scalar(
        "INSERT INTO notifications
         (user_id,title,body,notification_type,reference_id)
         VALUES($1,'Support review due','Internal reminder','support_followup',$2)
         RETURNING id",
    )
    .bind(admin)
    .bind(case_id)
    .fetch_one(&db)
    .await
    .unwrap();
    let (feed_status, feed) = request(
        &router,
        "/api/assistant/support/staff/alerts",
        Some(token),
        None,
    )
    .await;
    assert_eq!(feed_status, StatusCode::OK);
    assert_eq!(feed["alerts"].as_array().unwrap().len(), 1);
    assert_eq!(feed["alerts"][0]["case_id"], case_id);
    assert_eq!(
        request(
            &router,
            "/api/assistant/support/staff/alerts",
            Some(&customer_token),
            None
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    let alert_read_path = format!("/api/assistant/support/staff/alerts/{alert_id}/read");
    assert_eq!(
        request(&router, &alert_read_path, Some(token), Some(json!({})))
            .await
            .0,
        StatusCode::OK
    );
    assert!(
        sqlx::query_scalar::<_, bool>("SELECT is_read FROM notifications WHERE id=$1")
            .bind(alert_id)
            .fetch_one(&db)
            .await
            .unwrap()
    );
    let (_, staff) = request(&router, &staff_path, Some(token), None).await;
    assert_eq!(staff["case"]["messages"].as_array().unwrap().len(), 2);
    // Internal staff notes never consume a visible-response SLA.
    assert_eq!(
        staff["case"]["staff_followup"]["awaiting_staff_reply"],
        true
    );
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
    let waiting: (bool, Option<chrono::DateTime<chrono::Utc>>) = sqlx::query_as(
        "SELECT awaiting_staff_reply,due_at FROM native_support_followups WHERE case_id=$1::uuid",
    )
    .bind(case_id)
    .fetch_one(&db)
    .await
    .unwrap();
    assert!(!waiting.0);
    assert!(waiting.1.is_none());
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
    let id: Uuid = sqlx::query_scalar("INSERT INTO users (phone,email,hashed_password,full_name,role) VALUES ($1,$2,$3,'Test',$4) RETURNING id")
        .bind(Uuid::new_v4().simple().to_string()[..18].to_string()).bind(&email).bind(SYNTHETIC_PASSWORD_HASH).bind(role).fetch_one(db).await.unwrap();
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
        assert_eq!(
            request(
                &router,
                "/login",
                None,
                Some(json!({"identifier":email,"password":SYNTHETIC_PASSWORD,"code":TotpEngine::compute_code(&secret, (chrono::Utc::now().timestamp()-30) as u64).unwrap()}))
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
    assert_eq!(
        request(
            &router,
            "/login",
            None,
            Some(json!({"identifier":email,"password":SYNTHETIC_PASSWORD,"code":TotpEngine::compute_code(&secret, (chrono::Utc::now().timestamp()-30) as u64).unwrap()}))
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
        Some(json!({"identifier":email,"password":SYNTHETIC_PASSWORD,"code":TotpEngine::compute_code(&secret, (chrono::Utc::now().timestamp()-30) as u64).unwrap()})),
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
        Some(json!({"identifier":email,"password":SYNTHETIC_PASSWORD,"code":TotpEngine::compute_code(&secret, (chrono::Utc::now().timestamp()-30) as u64).unwrap()})),
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
        StatusCode::UNAUTHORIZED
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
    let code =
        TotpEngine::compute_code(&secret, (chrono::Utc::now().timestamp() + 30) as u64).unwrap();
    assert_eq!(
        request(&router, "/step-up", Some(token), Some(json!({"code":code})))
            .await
            .0,
        StatusCode::OK
    );
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
    let (_, login) = request(
        &router,
        "/login",
        None,
        Some(json!({"identifier":email,"password":SYNTHETIC_PASSWORD,"code":TotpEngine::compute_code(&secret, (chrono::Utc::now().timestamp()-30) as u64).unwrap()})),
    )
    .await;
    let token = login["token"].as_str().unwrap();
    assert_eq!(
        request(
            &router,
            "/login",
            None,
            Some(json!({"identifier":email,"password":SYNTHETIC_PASSWORD,"code":TotpEngine::compute_code(&secret, (chrono::Utc::now().timestamp()-30) as u64).unwrap()}))
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
    let (status, result) = request(
        &router,
        "/login",
        None,
        Some(json!({"identifier":email,"password":SYNTHETIC_PASSWORD,"code":TotpEngine::compute_code(&secret, (chrono::Utc::now().timestamp()-30) as u64).unwrap()})),
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
async fn central_admin_rejects_unbound_jwt_and_logout_revokes_active_session(db: PgPool) {
    let state = state(db.clone());
    let router = app(state.clone());
    let (id, email, secret) = identity(&db, "central_admin", true, vec![]).await;
    let (_, result) = request(
        &router,
        "/login",
        None,
        Some(json!({"identifier":email,"password":SYNTHETIC_PASSWORD,"code":TotpEngine::compute_code(&secret, (chrono::Utc::now().timestamp()-30) as u64).unwrap()})),
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
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        request(&router, "/me", Some(&second), None).await.0,
        StatusCode::UNAUTHORIZED
    );
}

#[sqlx::test]
async fn reviewer_disable_revokes_current_replaced_and_legacy_access(db: PgPool) {
    use trackmyrmc_backend::auth::jwt::verify_token;
    let mut state = state(db.clone());
    let mut config = (*state.config).clone();
    config.play_review_access_code = Some("654321".into());
    config.jwt_expiration_hours = 24;
    state.config = std::sync::Arc::new(config);
    let public = trackmyrmc_backend::routes::build_app_router(state.clone());
    let console = app(state.clone());
    let payload = json!({"role":"customer","access_code":"654321"});
    let (status, first) = request(
        &public,
        "/api/auth/play-review",
        None,
        Some(payload.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let first_token = first["token"].as_str().unwrap();
    let claims = verify_token(first_token, &state.config.jwt_secret).unwrap();
    let legacy = generate_token(
        claims.sub,
        "customer",
        &claims.phone,
        None,
        &state.config.jwt_secret,
        1,
    )
    .unwrap();
    let (status, second) = request(&public, "/api/auth/play-review", None, Some(payload)).await;
    assert_eq!(status, StatusCode::OK);
    let current = second["token"].as_str().unwrap();
    let (status, rotated) = request(
        &public,
        "/api/auth/refresh",
        None,
        Some(json!({"refresh_token":second["refresh_token"]})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let renewed = rotated["access_token"].as_str().unwrap();
    let renewed_claims = verify_token(renewed, &state.config.jwt_secret).unwrap();
    assert!(renewed_claims.exp - renewed_claims.iat <= 2 * 3600);
    assert_eq!(
        request(&public, "/api/me", Some(renewed), None).await.0,
        StatusCode::OK
    );

    let (_, email, secret) =
        identity(&db, "central_admin", true, vec!["reviewer_access.manage"]).await;
    let code = TotpEngine::compute_code(&secret, chrono::Utc::now().timestamp() as u64).unwrap();
    let (status, login) = request(
        &console,
        "/login",
        None,
        Some(json!({"identifier":email,"password":SYNTHETIC_PASSWORD,"code":TotpEngine::compute_code(&secret, (chrono::Utc::now().timestamp()-30) as u64).unwrap()})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let admin = login["token"].as_str().unwrap();
    assert_eq!(
        request(
            &console,
            "/step-up",
            Some(admin),
            Some(json!({"code":code}))
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        request(
            &console,
            "/reviewer",
            Some(admin),
            Some(json!({"enabled":false,"reason":"Synthetic reviewer revocation regression"})),
        )
        .await
        .0,
        StatusCode::OK
    );
    for token in [first_token, current, renewed, &legacy] {
        assert_eq!(
            request(&public, "/api/me", Some(token), None).await.0,
            StatusCode::UNAUTHORIZED
        );
    }
    assert!(
        trackmyrmc_backend::auth::refresh::issue_after_auth(
            &state,
            claims.sub,
            "customer",
            &claims.phone,
            None,
            2
        )
        .await
        .is_err(),
        "A login holding stale fixture data must not mint after reviewer disable"
    );
    assert!(
        sqlx::query_scalar::<_, Option<Uuid>>("SELECT active_session_jti FROM users WHERE id=$1")
            .bind(claims.sub)
            .fetch_one(&db)
            .await
            .unwrap()
            .is_none(),
        "Rejected issuance must roll back its JTI update"
    );
    assert_eq!(
        request(
            &public,
            "/api/auth/refresh",
            None,
            Some(json!({"refresh_token":rotated["refresh_token"]})),
        )
        .await
        .0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM account_refresh_tokens WHERE user_id=$1"
        )
        .bind(claims.sub)
        .fetch_one(&db)
        .await
        .unwrap(),
        0
    );
    assert_eq!(
        request(
            &console,
            "/reviewer",
            Some(admin),
            Some(json!({"enabled":true,"reason":"Synthetic reviewer reactivation regression"})),
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        request(&public, "/api/me", Some(renewed), None).await.0,
        StatusCode::UNAUTHORIZED
    );
}

#[sqlx::test]
async fn native_automation_global_policy_requires_explicit_grant_and_recent_mfa(db: PgPool) {
    let state = state(db.clone());
    let router = trackmyrmc_backend::routes::build_app_router(state.clone());
    let (admin, email, secret) = identity(
        &db,
        "central_admin",
        true,
        vec!["system.view", "audit.view"],
    )
    .await;
    let code = TotpEngine::compute_code(&secret, chrono::Utc::now().timestamp() as u64).unwrap();
    let (status, logged_in) = request(
        &router,
        "/api/admin/auth/verify-totp",
        None,
        Some(json!({"identifier":email,"password":SYNTHETIC_PASSWORD,"code":TotpEngine::compute_code(&secret, (chrono::Utc::now().timestamp()-30) as u64).unwrap()})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let token = logged_in["token"].as_str().unwrap();
    assert_eq!(
        request(
            &router,
            "/api/control-center/automation/templates",
            Some(token),
            None,
        )
        .await
        .0,
        StatusCode::OK,
    );
    let policy_path = "/api/control-center/automation/templates/ORDER_ACCEPTED_NOTICE/policy";
    let activate = json!({"published":true,"globally_paused":false});

    // Read-only Central Admin cannot publish or activate a rule.
    assert_eq!(
        request(&router, policy_path, Some(token), Some(activate.clone()))
            .await
            .0,
        StatusCode::FORBIDDEN,
    );
    sqlx::query(
        "UPDATE control_center_access
         SET permissions=ARRAY['system.view','audit.view','automation.manage']
         WHERE user_id=$1",
    )
    .bind(admin)
    .execute(&db)
    .await
    .unwrap();

    // A live Admin session without a fresh MFA step-up is still denied.
    assert_eq!(
        request(&router, policy_path, Some(token), Some(activate.clone()))
            .await
            .0,
        StatusCode::FORBIDDEN,
    );
    assert_eq!(
        request(
            &router,
            "/api/admin/auth/step-up",
            Some(token),
            Some(json!({"code":code})),
        )
        .await
        .0,
        StatusCode::OK,
    );

    assert_eq!(
        request(&router, policy_path, Some(token), Some(activate))
            .await
            .0,
        StatusCode::OK,
    );
    let rule: (bool, bool, i32) = sqlx::query_as(
        "SELECT published,globally_paused,version
         FROM native_automation_templates
         WHERE template_key='ORDER_ACCEPTED_NOTICE'",
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert!(rule.0);
    assert!(!rule.1);
    assert_eq!(rule.2, 2);
    let revisions: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM native_automation_template_revisions
         WHERE template_key='ORDER_ACCEPTED_NOTICE'",
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(revisions, 2);

    // An ordinary plant-level Admin cannot turn the global worker on,
    // even with a forged list of claimed permissions in the request body.
    let mobile_id: Uuid = sqlx::query_scalar(
        "INSERT INTO users(phone,hashed_password,full_name,role)
         VALUES($1,'unused','Plant Admin','admin') RETURNING id",
    )
    .bind(Uuid::new_v4().simple().to_string()[..18].to_string())
    .fetch_one(&db)
    .await
    .unwrap();
    let mobile = generate_token(mobile_id, "admin", "", None, &state.config.jwt_secret, 1).unwrap();
    assert_eq!(
        request(
            &router,
            policy_path,
            Some(&mobile),
            Some(json!({"published":false,"globally_paused":true})),
        )
        .await
        .0,
        StatusCode::FORBIDDEN,
    );
}

#[sqlx::test]
async fn native_automation_plant_settings_reject_cross_tenant_and_staff_writes(db: PgPool) {
    let state = state(db.clone());
    let router = trackmyrmc_backend::routes::build_app_router(state.clone());
    let (owner_a, _, _) = identity(&db, "owner", false, vec![]).await;
    let (owner_b, _, _) = identity(&db, "owner", false, vec![]).await;
    let (staff, _, _) = identity(&db, "dispatcher", false, vec![]).await;
    let plant_a: Uuid = sqlx::query_scalar(
        "INSERT INTO rmc_plants(owner_id,name,code,latitude,longitude,
            address_line,city,state,pincode,contact_phone)
         VALUES($1,'Automation A',$2,19,73,'A','Panvel','Maharashtra','410206','0000000000')
         RETURNING id",
    )
    .bind(owner_a)
    .bind(Uuid::new_v4().simple().to_string()[..14].to_string())
    .fetch_one(&db)
    .await
    .unwrap();
    let plant_b: Uuid = sqlx::query_scalar(
        "INSERT INTO rmc_plants(owner_id,name,code,latitude,longitude,
            address_line,city,state,pincode,contact_phone)
         VALUES($1,'Automation B',$2,19,73,'B','Panvel','Maharashtra','410206','0000000000')
         RETURNING id",
    )
    .bind(owner_b)
    .bind(Uuid::new_v4().simple().to_string()[..14].to_string())
    .fetch_one(&db)
    .await
    .unwrap();
    let owner_token =
        generate_token(owner_a, "owner", "", None, &state.config.jwt_secret, 1).unwrap();
    // Activate the operational assignment so the access check reaches
    // the automation endpoint rather than failing at session validation.
    sqlx::query(
        "INSERT INTO plant_staff(plant_id,user_id,role)
         VALUES($1,$2,'dispatcher')",
    )
    .bind(plant_a)
    .bind(staff)
    .execute(&db)
    .await
    .unwrap();
    let staff_token =
        generate_token(staff, "dispatcher", "", None, &state.config.jwt_secret, 1).unwrap();
    let path_a = format!("/api/owner/plants/{plant_a}/automation/rules/ORDER_PENDING_REMINDER");
    let path_b = format!("/api/owner/plants/{plant_b}/automation/rules/ORDER_PENDING_REMINDER");

    async fn update(app: &Router, path: &str, token: &str, enabled: bool) -> StatusCode {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri(path)
                    .method("PUT")
                    .header("Authorization", format!("Bearer {token}"))
                    .header("Content-Type", "application/json")
                    .body(Body::from(
                        json!({"enabled":enabled,"reminder_after_minutes":60}).to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        response.status()
    }

    // No published template is available to activate by default.
    assert_eq!(
        update(&router, &path_a, &owner_token, true).await,
        StatusCode::CONFLICT,
    );
    sqlx::query(
        "UPDATE native_automation_templates SET published=TRUE
         WHERE template_key='ORDER_PENDING_REMINDER'",
    )
    .execute(&db)
    .await
    .unwrap();
    // A centrally paused template must not be enabled by a direct API call.
    assert_eq!(
        update(&router, &path_a, &owner_token, true).await,
        StatusCode::CONFLICT,
    );
    sqlx::query(
        "UPDATE native_automation_templates SET globally_paused=FALSE
         WHERE template_key='ORDER_PENDING_REMINDER'",
    )
    .execute(&db)
    .await
    .unwrap();
    assert_eq!(
        update(&router, &path_a, &owner_token, true).await,
        StatusCode::OK,
    );
    assert_eq!(
        update(&router, &path_b, &owner_token, true).await,
        StatusCode::FORBIDDEN,
    );
    assert_eq!(
        update(&router, &path_a, &staff_token, true).await,
        StatusCode::FORBIDDEN,
    );

    // Owners must remain free to opt out even if Central Admin pauses.
    sqlx::query(
        "UPDATE native_automation_templates SET globally_paused=TRUE
         WHERE template_key='ORDER_PENDING_REMINDER'",
    )
    .execute(&db)
    .await
    .unwrap();
    assert_eq!(
        update(&router, &path_a, &owner_token, false).await,
        StatusCode::OK,
    );
    let enabled: bool = sqlx::query_scalar(
        "SELECT enabled FROM native_automation_plant_rules
         WHERE plant_id=$1 AND template_key='ORDER_PENDING_REMINDER'",
    )
    .bind(plant_a)
    .fetch_one(&db)
    .await
    .unwrap();
    assert!(!enabled);
}

#[sqlx::test]
async fn native_domain_alert_acknowledgement_is_scoped_and_not_an_approval(db: PgPool) {
    let state = state(db.clone());
    let router = trackmyrmc_backend::routes::build_app_router(state.clone());
    let (owner_a, _, _) = identity(&db, "owner", false, vec![]).await;
    let (owner_b, _, _) = identity(&db, "owner", false, vec![]).await;
    let plant: Uuid = sqlx::query_scalar(
        "INSERT INTO rmc_plants
         (owner_id,name,code,latitude,longitude,address_line,city,state,pincode,contact_phone)
         VALUES($1,'Review Plant',$2,19,73,'Test','Panvel','Maharashtra','410206','0000000000')
         RETURNING id",
    )
    .bind(owner_a)
    .bind(Uuid::new_v4().simple().to_string()[..14].to_string())
    .fetch_one(&db)
    .await
    .unwrap();
    let material: Uuid = sqlx::query_scalar(
        "INSERT INTO plant_materials(plant_id,name,material_type,current_stock,minimum_stock)
         VALUES($1,'Cement','cement',10,100) RETURNING id",
    )
    .bind(plant)
    .fetch_one(&db)
    .await
    .unwrap();
    let job: Uuid = sqlx::query_scalar(
        "INSERT INTO native_automation_jobs
         (event_key,plant_id,domain_entity_id,template_key,status)
         VALUES($1,$2,$3,'INVENTORY_BELOW_MIN','COMPLETED') RETURNING id",
    )
    .bind(format!("test-stock:{}", Uuid::new_v4()))
    .bind(plant)
    .bind(material)
    .fetch_one(&db)
    .await
    .unwrap();
    let task: Uuid = sqlx::query_scalar(
        "INSERT INTO native_automation_domain_tasks
         (source_job_id,plant_id,domain_entity_id,template_key,assigned_to)
         VALUES($1,$2,$3,'INVENTORY_BELOW_MIN',$4) RETURNING id",
    )
    .bind(job)
    .bind(plant)
    .bind(material)
    .bind(owner_a)
    .fetch_one(&db)
    .await
    .unwrap();
    let owner_a_token =
        generate_token(owner_a, "owner", "", None, &state.config.jwt_secret, 1).unwrap();
    let owner_b_token =
        generate_token(owner_b, "owner", "", None, &state.config.jwt_secret, 1).unwrap();
    let inbox_path = format!("/api/owner/plants/{plant}/automation/tasks");
    let (inbox_status, inbox) = request(&router, &inbox_path, Some(&owner_a_token), None).await;
    assert_eq!(inbox_status, StatusCode::OK);
    assert_eq!(inbox["tasks"][0]["source_label"], "Material: Cement");
    assert_eq!(
        request(&router, &inbox_path, Some(&owner_b_token), None)
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    let path = format!("/api/owner/plants/{plant}/automation/domain-tasks/{task}/acknowledge");
    assert_eq!(
        request(&router, &path, Some(&owner_b_token), Some(json!({})))
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        request(&router, &path, Some(&owner_a_token), Some(json!({})))
            .await
            .0,
        StatusCode::OK
    );
    let (status, replay) = request(&router, &path, Some(&owner_a_token), Some(json!({}))).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(replay["idempotent_replay"], true);
    let task_status: String =
        sqlx::query_scalar("SELECT status FROM native_automation_domain_tasks WHERE id=$1")
            .bind(task)
            .fetch_one(&db)
            .await
            .unwrap();
    assert_eq!(task_status, "ACKNOWLEDGED");
    let (seen, still_unresolved): (bool, bool) = sqlx::query_as(
        "SELECT acknowledged_at IS NOT NULL,resolved_at IS NULL
         FROM native_automation_domain_tasks WHERE id=$1",
    )
    .bind(task)
    .fetch_one(&db)
    .await
    .unwrap();
    assert!(seen && still_unresolved);
    let lifecycle_events: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM native_automation_domain_task_events
         WHERE task_id=$1 AND event_type='ACKNOWLEDGED' AND actor_id=$2",
    )
    .bind(task)
    .bind(owner_a)
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(lifecycle_events, 1);
    let events_path = format!("/api/owner/plants/{plant}/automation/domain-tasks/{task}/events");
    let (history_status, history) =
        request(&router, &events_path, Some(&owner_a_token), None).await;
    assert_eq!(history_status, StatusCode::OK);
    assert_eq!(history["events"][0]["event_type"], "ACKNOWLEDGED");
    // Application DB users cannot rewrite or directly anonymize audit events.
    assert!(sqlx::query(
        "UPDATE native_automation_domain_task_events
         SET details='{\"forged\":true}'::jsonb WHERE task_id=$1",
    )
    .bind(task)
    .execute(&db)
    .await
    .is_err());
    assert!(sqlx::query(
        "UPDATE native_automation_domain_task_events
         SET actor_id=NULL WHERE task_id=$1",
    )
    .bind(task)
    .execute(&db)
    .await
    .is_err());
    // A nested users FK ON DELETE SET NULL must remain functional, unlike
    // direct mutation. The event survives with its actor reference scrubbed.
    let temp_actor: Uuid = sqlx::query_scalar(
        "INSERT INTO users(phone,hashed_password,full_name,role)
         VALUES($1,'unused','Transient audit actor','dispatcher') RETURNING id",
    )
    .bind(Uuid::new_v4().simple().to_string()[..18].to_string())
    .fetch_one(&db)
    .await
    .unwrap();
    let scrub_event: i64 = sqlx::query_scalar(
        "INSERT INTO native_automation_domain_task_events
         (task_id,plant_id,event_type,actor_id)
         VALUES($1,$2,'ACKNOWLEDGED',$3) RETURNING id",
    )
    .bind(task)
    .bind(plant)
    .bind(temp_actor)
    .fetch_one(&db)
    .await
    .unwrap();
    sqlx::query("DELETE FROM users WHERE id=$1")
        .bind(temp_actor)
        .execute(&db)
        .await
        .unwrap();
    let actor_scrubbed: bool = sqlx::query_scalar(
        "SELECT actor_id IS NULL FROM native_automation_domain_task_events WHERE id=$1",
    )
    .bind(scrub_event)
    .fetch_one(&db)
    .await
    .unwrap();
    assert!(actor_scrubbed);
    assert_eq!(
        request(&router, &events_path, Some(&owner_b_token), None)
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    let stock: i64 =
        sqlx::query_scalar("SELECT current_stock::bigint FROM plant_materials WHERE id=$1")
            .bind(material)
            .fetch_one(&db)
            .await
            .unwrap();
    assert_eq!(stock, 10);
    let audit_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM audit_logs
         WHERE user_id=$1 AND action='automation.domain_task.acknowledged'",
    )
    .bind(owner_a)
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(audit_count, 1);
}
