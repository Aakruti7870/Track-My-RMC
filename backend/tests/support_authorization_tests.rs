#[path = "support/admin_challenge.rs"]
mod admin_challenge;
use admin_challenge::admin_challenge;

use axum::{
    body::{to_bytes, Body},
    http::{Request, StatusCode},
    Router,
};
use serde_json::{json, Value};
use sqlx::PgPool;
use tower::ServiceExt;
use trackmyrmc_backend::{
    auth::{jwt::generate_token, totp::TotpEngine},
    config::AppConfig,
    routes::build_app_router,
    services::native_support_automation,
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

async fn web_operator(
    db: &PgPool,
    router: &Router,
    role: &str,
    permissions: Vec<&str>,
) -> (Uuid, String, String, String) {
    let (id, email, secret) = identity(db, role, true, permissions).await;
    let prefix = if role == "authority" {
        "authority"
    } else {
        "admin"
    };
    let code = TotpEngine::compute_code(&secret, chrono::Utc::now().timestamp() as u64).unwrap();
    let (status, body) = request(
        router,
        &format!("/api/{prefix}/auth/verify-totp"),
        None,
        Some(if role == "authority" {
            json!({"identifier":email,"password":SYNTHETIC_PASSWORD,"code":code})
        } else {
            json!({"challenge_token":admin_challenge(db, &email).await,"code":code})
        }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    (
        id,
        email,
        secret,
        body["token"].as_str().unwrap().to_string(),
    )
}
async fn customer_case(db: &PgPool, router: &Router, state: &AppState) -> (Uuid, String, Uuid) {
    let (id, _, _) = identity(db, "customer", false, vec![]).await;
    let token = generate_token(id, "customer", "", None, &state.config.jwt_secret, 1).unwrap();
    let (status,body)=request(router,"/api/assistant/support",Some(&token),Some(json!({"category":"GENERAL","message":"A synthetic application issue needs review","escalate":true,"request_id":format!("case-{}",Uuid::new_v4())}))).await;
    assert_eq!(status, StatusCode::OK);
    (
        id,
        token,
        body["case_id"].as_str().unwrap().parse().unwrap(),
    )
}
async fn make_due(db: &PgPool, case: Uuid) {
    sqlx::query("UPDATE native_support_followups SET due_at=NOW()-INTERVAL '1 hour',next_attempt_at=NOW()-INTERVAL '1 minute' WHERE case_id=$1")
        .bind(case).execute(db).await.unwrap();
}

#[sqlx::test]
async fn delegated_authority_consumes_worker_alerts_and_replies_without_management_power(
    db: PgPool,
) {
    let state = state(db.clone());
    let router = build_app_router(state.clone());
    let (admin, _, admin_secret, admin_token) = web_operator(
        &db,
        &router,
        "central_admin",
        vec![
            "support.view",
            "support.reply",
            "support.manage",
            "admin_access.manage",
        ],
    )
    .await;
    let (authority, email, _, token) = web_operator(
        &db,
        &router,
        "authority",
        vec!["support.view", "support.reply"],
    )
    .await;
    let (_, customer_token, case) = customer_case(&db, &router, &state).await;
    make_due(&db, case).await;
    let (a, b, c) = tokio::join!(
        native_support_automation::tick(&db),
        native_support_automation::tick(&db),
        native_support_automation::tick(&db)
    );
    assert_eq!(a.unwrap() + b.unwrap() + c.unwrap(), 1);
    let path = format!("/api/assistant/support/staff/cases/{case}");
    let (status, feed) = request(
        &router,
        "/api/assistant/support/staff/alerts",
        Some(&token),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(feed["alerts"].as_array().unwrap().len(), 1);
    assert_eq!(feed["alerts"][0]["case_id"], case.to_string());
    assert!(!feed.to_string().contains("synthetic application issue"));
    let (_, admin_feed) = request(
        &router,
        "/api/assistant/support/staff/alerts",
        Some(&admin_token),
        None,
    )
    .await;
    let other = admin_feed["alerts"][0]["id"].as_str().unwrap();
    assert_eq!(
        request(
            &router,
            &format!("/api/assistant/support/staff/alerts/{other}/read"),
            Some(&token),
            Some(json!({}))
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    let own = feed["alerts"][0]["id"].as_str().unwrap();
    for _ in 0..2 {
        assert_eq!(
            request(
                &router,
                &format!("/api/assistant/support/staff/alerts/{own}/read"),
                Some(&token),
                Some(json!({}))
            )
            .await
            .0,
            StatusCode::OK
        );
    }
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM audit_logs WHERE user_id=$1 AND action='support.alert.read'"
        )
        .bind(authority)
        .fetch_one(&db)
        .await
        .unwrap(),
        1
    );
    assert_eq!(
        request(&router, &path, Some(&token), None).await.0,
        StatusCode::OK
    );
    assert_eq!(
        request(
            &router,
            &format!("{path}/replies"),
            Some(&token),
            Some(json!({"message":"Private triage note","internal":true}))
        )
        .await
        .0,
        StatusCode::OK
    );
    let pending: bool = sqlx::query_scalar(
        "SELECT awaiting_staff_reply FROM native_support_followups WHERE case_id=$1",
    )
    .bind(case)
    .fetch_one(&db)
    .await
    .unwrap();
    assert!(pending);
    let public_path = format!("/api/assistant/support/cases/{case}");
    let (_, public) = request(&router, &public_path, Some(&customer_token), None).await;
    assert_eq!(public["case"]["messages"].as_array().unwrap().len(), 1);
    assert_eq!(
        request(
            &router,
            &format!("{path}/replies"),
            Some(&token),
            Some(json!({"message":"Your application issue is being reviewed","internal":false}))
        )
        .await
        .0,
        StatusCode::OK
    );
    let stopped:(bool,bool)=sqlx::query_as("SELECT awaiting_staff_reply,next_attempt_at IS NULL FROM native_support_followups WHERE case_id=$1").bind(case).fetch_one(&db).await.unwrap();
    assert_eq!(stopped, (false, true));
    let (_, public) = request(&router, &public_path, Some(&customer_token), None).await;
    assert_eq!(public["case"]["messages"].as_array().unwrap().len(), 2);
    assert!(!public.to_string().contains("Private triage"));
    assert_eq!(
        request(
            &router,
            &format!("{path}/status"),
            Some(&token),
            Some(json!({"status":"CLOSED"}))
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    // Even corrupted/nondelegable raw grants never turn Authority into WebAdmin.
    sqlx::query("UPDATE control_center_access SET permissions=permissions||ARRAY['support.manage','admin_access.manage','automation.manage'] WHERE user_id=$1").bind(authority).execute(&db).await.unwrap();
    assert_eq!(
        request(
            &router,
            "/api/control-center/authority-access",
            Some(&token),
            None
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        request(
            &router,
            &format!("{path}/status"),
            Some(&token),
            Some(json!({"status":"CLOSED"}))
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    let code =
        TotpEngine::compute_code(&admin_secret, (chrono::Utc::now().timestamp() + 30) as u64)
            .unwrap();
    assert_eq!(
        request(
            &router,
            "/api/control-center/step-up",
            Some(&admin_token),
            Some(json!({"code":code}))
        )
        .await
        .0,
        StatusCode::OK
    );
    for status in ["CLOSED", "OPEN"] {
        assert_eq!(
            request(
                &router,
                &format!("{path}/status"),
                Some(&admin_token),
                Some(json!({"status":status}))
            )
            .await
            .0,
            StatusCode::OK
        );
    }
    let reopened: (i64, bool) = sqlx::query_as(
        "SELECT cycle,awaiting_staff_reply FROM native_support_followups WHERE case_id=$1",
    )
    .bind(case)
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(reopened, (2, true));
    assert_eq!(native_support_automation::tick(&db).await.unwrap(), 0);
    assert_eq!(request(&router,"/api/control-center/authority-access",Some(&admin_token),Some(json!({"email":email,"full_name":"Authority Operator","enabled":true,"permissions":["support.reply"],"reason":"Reject unsupported write-only support grant"}))).await.0,StatusCode::BAD_REQUEST);
    assert_eq!(request(&router,"/api/control-center/authority-access",Some(&admin_token),Some(json!({"email":email,"full_name":"Authority Operator","enabled":true,"permissions":["support.view"],"reason":"Revoke reply access after operator review"}))).await.0,StatusCode::OK);
    assert_eq!(
        request(&router, &path, Some(&token), None).await.0,
        StatusCode::UNAUTHORIZED
    );
    assert!(sqlx::query_scalar::<_,bool>("SELECT EXISTS(SELECT 1 FROM control_center_sessions WHERE user_id=$1 AND revoked_at IS NOT NULL)").bind(authority).fetch_one(&db).await.unwrap());
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM audit_logs WHERE user_id=$1 AND action='support.case.reply'"
        )
        .bind(authority)
        .fetch_one(&db)
        .await
        .unwrap(),
        2
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM native_automation_jobs")
            .fetch_one(&db)
            .await
            .unwrap(),
        0
    );
    assert!(sqlx::query_scalar::<_,i64>("SELECT count(*) FROM audit_logs WHERE user_id=$1 AND action='authority.access.updated'").bind(admin).fetch_one(&db).await.unwrap()>0);
}

#[sqlx::test]
async fn support_permissions_roles_approval_credentials_and_sessions_fail_closed(db: PgPool) {
    let state = state(db.clone());
    let router = build_app_router(state.clone());
    let (_, _, case) = customer_case(&db, &router, &state).await;
    let path = format!("/api/assistant/support/staff/cases/{case}");
    for role in [
        "customer",
        "driver",
        "owner",
        "admin",
        "dispatcher",
        "operator",
        "supervisor",
        "accountant",
        "quality_engineer",
        "fleet_manager",
        "store_manager",
    ] {
        let (id, _, _) = identity(
            &db,
            role,
            true,
            vec!["support.view", "support.reply", "support.manage"],
        )
        .await;
        let token = generate_token(id, role, "", None, &state.config.jwt_secret, 1).unwrap();
        for route in [&path, "/api/assistant/support/staff/alerts"] {
            assert!(matches!(
                request(&router, route, Some(&token), None).await.0,
                StatusCode::FORBIDDEN | StatusCode::UNAUTHORIZED
            ));
        }
        assert!(request(
            &router,
            &format!("{path}/replies"),
            Some(&token),
            Some(json!({"message":"Disallowed reply"}))
        )
        .await
        .0
        .is_client_error());
    }
    for role in ["authority", "central_admin"] {
        for grants in [vec![], vec!["support.reply"], vec!["support.view"]] {
            let (_, _, _, token) = web_operator(&db, &router, role, grants.clone()).await;
            assert_eq!(
                request(&router, &path, Some(&token), None).await.0,
                if grants.contains(&"support.view") {
                    StatusCode::OK
                } else {
                    StatusCode::FORBIDDEN
                }
            );
            assert_eq!(
                request(
                    &router,
                    &format!("{path}/replies"),
                    Some(&token),
                    Some(json!({"message":"Missing permission reply"}))
                )
                .await
                .0,
                StatusCode::FORBIDDEN
            );
            assert_eq!(
                request(
                    &router,
                    "/api/assistant/support/staff/alerts",
                    Some(&token),
                    None
                )
                .await
                .0,
                StatusCode::FORBIDDEN
            );
        }
        for failure in [
            "unbound",
            "unapproved",
            "inactive",
            "revoked",
            "expired",
            "mfa-disabled",
        ] {
            let (id, _, _, token) =
                web_operator(&db, &router, role, vec!["support.view", "support.reply"]).await;
            match failure {
                "unbound" => {
                    sqlx::query("DELETE FROM control_center_sessions WHERE user_id=$1")
                        .bind(id)
                        .execute(&db)
                        .await
                        .unwrap();
                }
                "unapproved" => {
                    sqlx::query("UPDATE control_center_access SET approved=FALSE WHERE user_id=$1")
                        .bind(id)
                        .execute(&db)
                        .await
                        .unwrap();
                }
                "inactive" => {
                    sqlx::query("UPDATE users SET is_active=FALSE WHERE id=$1")
                        .bind(id)
                        .execute(&db)
                        .await
                        .unwrap();
                }
                "revoked" => {
                    sqlx::query(
                        "UPDATE control_center_sessions SET revoked_at=NOW() WHERE user_id=$1",
                    )
                    .bind(id)
                    .execute(&db)
                    .await
                    .unwrap();
                }
                "expired" => {
                    sqlx::query("UPDATE control_center_sessions SET expires_at=NOW()-INTERVAL '1 second' WHERE user_id=$1").bind(id).execute(&db).await.unwrap();
                }
                "mfa-disabled" => {
                    sqlx::query(
                        "UPDATE user_totp_credentials SET is_enabled=FALSE WHERE user_id=$1",
                    )
                    .bind(id)
                    .execute(&db)
                    .await
                    .unwrap();
                }
                _ => unreachable!(),
            }
            {
                assert!(request(&router, &path, Some(&token), None)
                    .await
                    .0
                    .is_client_error());
                assert!(request(
                    &router,
                    &format!("{path}/replies"),
                    Some(&token),
                    Some(json!({"message":"Revoked operator reply"}))
                )
                .await
                .0
                .is_client_error());
            }
            // Recipients are identities, not online sessions. Unapproved,
            // inactive or MFA-disabled identities cannot consume the budget.
            sqlx::query("UPDATE control_center_access SET approved=FALSE WHERE user_id<>$1")
                .bind(id)
                .execute(&db)
                .await
                .unwrap();
            if matches!(failure, "unapproved" | "inactive" | "mfa-disabled") {
                make_due(&db, case).await;
                assert_eq!(native_support_automation::tick(&db).await.unwrap(), 0);
                let overdue:(bool,i16)=sqlx::query_as("SELECT due_at<NOW(),reminder_count FROM native_support_followups WHERE case_id=$1").bind(case).fetch_one(&db).await.unwrap();
                assert_eq!(overdue, (true, 0));
            }
        }
    }
}

#[sqlx::test]
async fn unread_support_cursor_ownership_and_generic_feed_isolation(db: PgPool) {
    let state = state(db.clone());
    let router = build_app_router(state.clone());
    let (_, _, case) = customer_case(&db, &router, &state).await;
    let (id, _, _, token) = web_operator(
        &db,
        &router,
        "authority",
        vec!["support.view", "support.reply"],
    )
    .await;
    let (other, _, _, other_token) = web_operator(
        &db,
        &router,
        "authority",
        vec!["support.view", "support.reply"],
    )
    .await;
    sqlx::query("INSERT INTO notifications(user_id,title,body,notification_type,reference_id,created_at,is_read) SELECT $1,'Generic follow-up','Internal web alert','support_followup',$2::uuid::text,NOW()-(g*INTERVAL '1 second'),FALSE FROM generate_series(1,55) g")
        .bind(id).bind(case).execute(&db).await.unwrap();
    sqlx::query("INSERT INTO notifications(user_id,title,body,notification_type,reference_id,is_read) SELECT $1,'Read reminder','Read','support_followup',$2::uuid::text,TRUE FROM generate_series(1,55)")
        .bind(id).bind(case).execute(&db).await.unwrap();
    let foreign:Uuid=sqlx::query_scalar("INSERT INTO notifications(user_id,title,body,notification_type,reference_id) VALUES($1,'Other operator','Private','support_followup',$2) RETURNING id")
        .bind(other).bind(case.to_string()).fetch_one(&db).await.unwrap();
    assert_eq!(
        request(
            &router,
            &format!("/api/assistant/support/staff/alerts?before={foreign}"),
            Some(&token),
            None
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    let (status, mut page) = request(
        &router,
        "/api/assistant/support/staff/alerts?limit=20",
        Some(&token),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let mut seen = std::collections::HashSet::new();
    loop {
        for alert in page["alerts"].as_array().unwrap() {
            let id = alert["id"].as_str().unwrap();
            assert!(seen.insert(id.to_string()));
            assert_eq!(alert["is_read"], false);
            assert_eq!(
                request(
                    &router,
                    &format!("/api/assistant/support/staff/alerts/{id}/read"),
                    Some(&other_token),
                    Some(json!({}))
                )
                .await
                .0,
                StatusCode::NOT_FOUND
            );
            assert_eq!(
                request(
                    &router,
                    &format!("/api/assistant/support/staff/alerts/{id}/read"),
                    Some(&token),
                    Some(json!({}))
                )
                .await
                .0,
                StatusCode::OK
            );
        }
        let Some(cursor) = page["next_cursor"].as_str() else {
            break;
        };
        let (status, next) = request(
            &router,
            &format!("/api/assistant/support/staff/alerts?limit=20&before={cursor}"),
            Some(&token),
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        page = next;
    }
    assert_eq!(seen.len(), 55);
    let (_, empty) = request(
        &router,
        "/api/assistant/support/staff/alerts",
        Some(&token),
        None,
    )
    .await;
    assert!(empty["alerts"].as_array().unwrap().is_empty());
    sqlx::query("UPDATE notifications SET is_read=FALSE WHERE user_id=$1")
        .bind(id)
        .execute(&db)
        .await
        .unwrap();
    let (_, generic) = request(&router, "/api/notifications", Some(&token), None).await;
    assert_eq!(generic["unread"], 0);
    assert!(generic["items"].as_array().unwrap().is_empty());
    let one = seen.iter().next().unwrap();
    assert_eq!(
        request(
            &router,
            &format!("/api/notifications/{one}/read"),
            Some(&token),
            Some(json!({}))
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        request(
            &router,
            "/api/notifications/read-all",
            Some(&token),
            Some(json!({}))
        )
        .await
        .1["updated"],
        0
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM notifications WHERE user_id=$1 AND NOT is_read"
        )
        .bind(id)
        .fetch_one(&db)
        .await
        .unwrap(),
        110
    );
    sqlx::query(
        "UPDATE control_center_access SET permissions=ARRAY['support.view'] WHERE user_id=$1",
    )
    .bind(id)
    .execute(&db)
    .await
    .unwrap();
    assert_eq!(
        request(
            &router,
            "/api/assistant/support/staff/alerts",
            Some(&token),
            None
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
}

#[sqlx::test]
async fn in_flight_reply_rechecks_revocation_after_case_lock_wait(db: PgPool) {
    let state = state(db.clone());
    let router = build_app_router(state.clone());
    let (_, _, case) = customer_case(&db, &router, &state).await;
    let (id, _, _, token) = web_operator(
        &db,
        &router,
        "authority",
        vec!["support.view", "support.reply"],
    )
    .await;
    let mut lock = db.begin().await.unwrap();
    sqlx::query("SELECT id FROM support_cases WHERE id=$1 FOR UPDATE")
        .bind(case)
        .execute(&mut *lock)
        .await
        .unwrap();
    let app = router.clone();
    let path = format!("/api/assistant/support/staff/cases/{case}/replies");
    let reply = tokio::spawn(async move {
        request(
            &app,
            &path,
            Some(&token),
            Some(json!({"message":"Stale permission must not write"})),
        )
        .await
    });
    tokio::time::timeout(std::time::Duration::from_secs(10),async {
        loop {
            let waiting:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT user_id,status,priority FROM support_cases%')").fetch_one(&db).await.unwrap();
            if waiting {break}
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
    }).await.expect("reply must reach the locked case after passing extraction");
    // The same user -> access -> session order used by real governance.
    let mut revoke = db.begin().await.unwrap();
    sqlx::query("UPDATE users SET auth_revoked_at=clock_timestamp() WHERE id=$1")
        .bind(id)
        .execute(&mut *revoke)
        .await
        .unwrap();
    sqlx::query(
        "UPDATE control_center_access SET permissions=ARRAY['support.view'] WHERE user_id=$1",
    )
    .bind(id)
    .execute(&mut *revoke)
    .await
    .unwrap();
    sqlx::query("UPDATE control_center_sessions SET revoked_at=NOW() WHERE user_id=$1")
        .bind(id)
        .execute(&mut *revoke)
        .await
        .unwrap();
    revoke.commit().await.unwrap();
    lock.commit().await.unwrap();
    // The account-level revocation takes precedence over the policy denial.
    assert_eq!(reply.await.unwrap().0, StatusCode::UNAUTHORIZED);
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM support_case_replies WHERE case_id=$1 AND is_staff"
        )
        .bind(case)
        .fetch_one(&db)
        .await
        .unwrap(),
        0
    );
}

async fn wait_on_case(db: &PgPool, pattern: &str) {
    tokio::time::timeout(std::time::Duration::from_secs(10),async {
        loop {
            let waiting:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE $1)")
                .bind(pattern).fetch_one(db).await.unwrap();
            if waiting {break}
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
    }).await.expect("request must acquire a transaction and wait on the actual case lock");
}

#[sqlx::test]
async fn in_flight_support_revalidates_generic_logout_and_account_jti_replacement(db: PgPool) {
    let state = state(db.clone());
    let router = build_app_router(state.clone());
    for role in ["authority", "central_admin"] {
        for generic_logout in [true, false] {
            let (_, _, case) = customer_case(&db, &router, &state).await;
            let (id, _, _, token) =
                web_operator(&db, &router, role, vec!["support.view", "support.reply"]).await;
            let mut lock = db.begin().await.unwrap();
            sqlx::query("SELECT id FROM support_cases WHERE id=$1 FOR UPDATE")
                .bind(case)
                .execute(&mut *lock)
                .await
                .unwrap();
            let app = router.clone();
            let old_token = token.clone();
            let pending = tokio::spawn(async move {
                request(
                    &app,
                    &format!("/api/assistant/support/staff/cases/{case}/replies"),
                    Some(&old_token),
                    Some(json!({"message":"Revoked account must not respond"})),
                )
                .await
            });
            wait_on_case(&db, "SELECT user_id,status,priority FROM support_cases%").await;
            if generic_logout {
                assert_eq!(
                    request(&router, "/api/auth/logout", Some(&token), Some(json!({})))
                        .await
                        .0,
                    StatusCode::OK
                );
            } else {
                trackmyrmc_backend::auth::account_sessions::issue(&state, id, role, "", None, 1)
                    .await
                    .unwrap();
            }
            // Neither generic operation revokes the dedicated web-table row.
            // This isolates the account revocation/JTI predicates being tested.
            assert_eq!(sqlx::query_scalar::<_,i64>("SELECT count(*) FROM control_center_sessions WHERE user_id=$1 AND revoked_at IS NULL AND expires_at>NOW()")
                .bind(id).fetch_one(&db).await.unwrap(),1);
            lock.commit().await.unwrap();
            assert_eq!(pending.await.unwrap().0, StatusCode::UNAUTHORIZED);
            assert_eq!(
                sqlx::query_scalar::<_, i64>(
                    "SELECT count(*) FROM support_case_replies WHERE case_id=$1 AND is_staff"
                )
                .bind(case)
                .fetch_one(&db)
                .await
                .unwrap(),
                0
            );
        }
    }
}

#[sqlx::test]
async fn support_status_uses_one_connection_and_expires_step_up_after_lock_wait(db: PgPool) {
    let limited = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .acquire_timeout(std::time::Duration::from_secs(3))
        .connect_with((*db.connect_options()).clone())
        .await
        .unwrap();
    let state = state(limited.clone());
    let router = build_app_router(state.clone());
    let (_, _, case) = customer_case(&db, &router, &state).await;
    let (id, _, secret, token) = web_operator(
        &db,
        &router,
        "central_admin",
        vec!["support.view", "support.reply", "support.manage"],
    )
    .await;
    let code =
        TotpEngine::compute_code(&secret, (chrono::Utc::now().timestamp() + 30) as u64).unwrap();
    assert_eq!(
        request(
            &router,
            "/api/control-center/step-up",
            Some(&token),
            Some(json!({"code":code}))
        )
        .await
        .0,
        StatusCode::OK
    );
    let path = format!("/api/assistant/support/staff/cases/{case}/status");
    let (a,b)=tokio::time::timeout(std::time::Duration::from_secs(10),async {
        tokio::join!(request(&router,&path,Some(&token),Some(json!({"status":"CLOSED"}))),request(&router,&path,Some(&token),Some(json!({"status":"CLOSED"}))))
    }).await.expect("status handlers must never request another connection while holding the sole transaction connection");
    assert_eq!(a.0, StatusCode::OK);
    assert_eq!(b.0, StatusCode::OK);
    assert_eq!(
        request(&router, &path, Some(&token), Some(json!({"status":"OPEN"})))
            .await
            .0,
        StatusCode::OK
    );
    let mut lock = db.begin().await.unwrap();
    sqlx::query("SELECT id FROM support_cases WHERE id=$1 FOR UPDATE")
        .bind(case)
        .execute(&mut *lock)
        .await
        .unwrap();
    let app = router.clone();
    let jwt = token.clone();
    let status_path = path.clone();
    let pending = tokio::spawn(async move {
        request(
            &app,
            &status_path,
            Some(&jwt),
            Some(json!({"status":"CLOSED"})),
        )
        .await
    });
    wait_on_case(&db, "SELECT status,priority FROM support_cases%").await;
    // Set expiry between the transaction's start and its post-lock check.
    // NOW() would still treat this grant as fresh; clock_timestamp() must deny it.
    sqlx::query("UPDATE control_center_step_ups SET expires_at=clock_timestamp() WHERE user_id=$1")
        .bind(id)
        .execute(&db)
        .await
        .unwrap();
    lock.commit().await.unwrap();
    assert_eq!(pending.await.unwrap().0, StatusCode::FORBIDDEN);
    assert_eq!(
        sqlx::query_scalar::<_, String>("SELECT status FROM support_cases WHERE id=$1")
            .bind(case)
            .fetch_one(&db)
            .await
            .unwrap(),
        "OPEN"
    );
    limited.close().await;
}
