use axum::{
    body::{to_bytes, Body},
    http::{Request, StatusCode},
    Router,
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use tower::ServiceExt;
use trackmyrmc_backend::{
    auth::{jwt::generate_token, totp::TotpEngine},
    config::AppConfig,
    routes::build_app_router,
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
    let method = if body.is_some() { "POST" } else { "GET" };
    call_method(app, path, token, body, method).await
}

async fn call_method(
    app: &Router,
    path: &str,
    token: Option<&str>,
    body: Option<Value>,
    method: &str,
) -> (StatusCode, Value) {
    let mut req = Request::builder().uri(path).method(method);
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
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

async fn identity(db: &PgPool, role: &str, permissions: &[&str]) -> (Uuid, String, String) {
    let id = Uuid::new_v4();
    let email = format!("{}@example.invalid", id.simple());
    let secret = TotpEngine::generate_secret();
    sqlx::query(
        "INSERT INTO users(id,phone,email,hashed_password,full_name,role,is_active)
         VALUES($1,NULL,$2,$4,'Web Security Test',$3,TRUE)",
    )
    .bind(id)
    .bind(&email)
    .bind(role)
    .bind(SYNTHETIC_PASSWORD_HASH)
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
async fn pending_login_cannot_outlive_credential_or_approval_revocation(db: PgPool) {
    let app = build_app_router(state(db.clone()));
    for role in ["central_admin", "authority"] {
        for revoke_password in [true, false] {
            let (id, email, secret) = identity(&db, role, &["support.view"]).await;
            let mut revocation = db.begin().await.unwrap();
            sqlx::query("SELECT id FROM users WHERE id=$1 FOR UPDATE")
                .bind(id)
                .execute(&mut *revocation)
                .await
                .unwrap();
            if revoke_password {
                sqlx::query("UPDATE users SET hashed_password='!revoked!' WHERE id=$1")
                    .bind(id)
                    .execute(&mut *revocation)
                    .await
                    .unwrap();
            } else {
                sqlx::query("UPDATE control_center_access SET approved=FALSE WHERE user_id=$1")
                    .bind(id)
                    .execute(&mut *revocation)
                    .await
                    .unwrap();
            }
            let code =
                TotpEngine::compute_code(&secret, chrono::Utc::now().timestamp() as u64).unwrap();
            let path = if role == "central_admin" {
                "/api/admin/auth/verify-totp"
            } else {
                "/api/authority/auth/verify-totp"
            };
            let router = app.clone();
            let login = tokio::spawn(async move {
                call(
                    &router,
                    path,
                    None,
                    Some(json!({
                        "identifier":email,"password":SYNTHETIC_PASSWORD,"code":code
                    })),
                )
                .await
            });
            // Observe the actual database lock wait, rather than relying on a
            // sleep to assume that the request reached its critical section.
            tokio::time::timeout(std::time::Duration::from_secs(10), async {
                loop {
                    let waiting: bool = sqlx::query_scalar(
                        "SELECT EXISTS(SELECT 1 FROM pg_stat_activity
                         WHERE datname=current_database() AND wait_event_type='Lock'
                         AND query LIKE '%FROM users%FOR UPDATE%')",
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
            .expect("login must wait for the identity mutation");
            revocation.commit().await.unwrap();
            assert_eq!(login.await.unwrap().0, StatusCode::UNAUTHORIZED);
            let sessions: i64 =
                sqlx::query_scalar("SELECT count(*) FROM control_center_sessions WHERE user_id=$1")
                    .bind(id)
                    .fetch_one(&db)
                    .await
                    .unwrap();
            assert_eq!(sessions, 0, "revoked proof must never issue a new session");
        }
    }
}

#[sqlx::test]
async fn authority_web_login_cannot_cross_into_super_admin_or_mobile(db: PgPool) {
    let app = build_app_router(state(db.clone()));
    let (id, email, secret) = identity(&db, "authority", &["kyc.view", "support.view"]).await;
    let code = TotpEngine::compute_code(&secret, chrono::Utc::now().timestamp() as u64).unwrap();
    assert_eq!(
        call(
            &app,
            "/api/authority/auth/verify-totp",
            None,
            Some(json!({"identifier":email,"code":code})),
        )
        .await
        .0,
        StatusCode::UNPROCESSABLE_ENTITY,
    );
    assert_eq!(
        call(
            &app,
            "/api/authority/auth/verify-totp",
            None,
            Some(json!({"identifier":email,"password":"Invalid synthetic password","code":code})),
        )
        .await
        .0,
        StatusCode::UNAUTHORIZED,
    );
    assert_eq!(
        call(
            &app,
            "/api/admin/auth/verify-totp",
            None,
            Some(json!({"identifier":email,"password":SYNTHETIC_PASSWORD,"code":code})),
        )
        .await
        .0,
        StatusCode::UNAUTHORIZED
    );
    let (status, authenticated) = call(
        &app,
        "/api/authority/auth/verify-totp",
        None,
        Some(json!({"identifier":email,"password":SYNTHETIC_PASSWORD,"code":code})),
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
async fn authority_password_bootstrap_requires_email_challenge_and_totp(db: PgPool) {
    let app = build_app_router(state(db.clone()));
    let (user_id, email, secret) = identity(&db, "authority", &["support.view"]).await;
    sqlx::query(
        "UPDATE users SET hashed_password='!web-only-no-password!',
         work_email_verified_at=NOW() WHERE id=$1",
    )
    .bind(user_id)
    .execute(&db)
    .await
    .unwrap();
    let token = "0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF";
    assert_eq!(token.len(), 48);
    let challenge_hash = hex::encode(Sha256::digest(token.as_bytes()));
    sqlx::query(
        "INSERT INTO staff_mfa_challenges(user_id,token_hash,purpose,expires_at)
         VALUES($1,$2,'login',NOW()+INTERVAL '5 minutes')",
    )
    .bind(user_id)
    .bind(challenge_hash)
    .execute(&db)
    .await
    .unwrap();
    let code = TotpEngine::compute_code(&secret, chrono::Utc::now().timestamp() as u64).unwrap();
    let (before, _) = call(
        &app,
        "/api/authority/auth/verify-totp",
        None,
        Some(json!({"identifier":email,"password":SYNTHETIC_PASSWORD,"code":code})),
    )
    .await;
    assert_eq!(before, StatusCode::UNAUTHORIZED);

    let (wrong, _) = call(
        &app,
        "/api/authority/auth/set-initial-password",
        None,
        Some(json!({"challenge_token":token,"password":SYNTHETIC_PASSWORD,"code":"wrong"})),
    )
    .await;
    assert_eq!(wrong, StatusCode::BAD_REQUEST);
    sqlx::query("UPDATE staff_mfa_challenges SET attempts=max_attempts-1 WHERE user_id=$1")
        .bind(user_id)
        .execute(&db)
        .await
        .unwrap();
    let (enrolled, _) = call(
        &app,
        "/api/authority/auth/set-initial-password",
        None,
        Some(json!({"challenge_token":token,"password":SYNTHETIC_PASSWORD,"code":code})),
    )
    .await;
    assert_eq!(enrolled, StatusCode::OK);
    let (reused, _) = call(
        &app,
        "/api/authority/auth/set-initial-password",
        None,
        Some(json!({"challenge_token":token,"password":SYNTHETIC_PASSWORD,"code":code})),
    )
    .await;
    assert_eq!(reused, StatusCode::UNAUTHORIZED);

    let code =
        TotpEngine::compute_code(&secret, (chrono::Utc::now().timestamp() + 30) as u64).unwrap();
    let (logged_in, session) = call(
        &app,
        "/api/authority/auth/verify-totp",
        None,
        Some(json!({"identifier":email,"password":SYNTHETIC_PASSWORD,"code":code})),
    )
    .await;
    assert_eq!(logged_in, StatusCode::OK);
    assert!(session["token"].is_string());
    assert_eq!(
        call(&app, "/api/admin/auth/me", session["token"].as_str(), None)
            .await
            .0,
        StatusCode::FORBIDDEN,
    );
}

#[sqlx::test]
async fn parallel_authority_enrollment_guesses_have_a_fixed_attempt_budget(db: PgPool) {
    let app = build_app_router(state(db.clone()));
    let (id, _, _) = identity(&db, "authority", &["support.view"]).await;
    sqlx::query("UPDATE users SET hashed_password='!web-only-no-password!',work_email_verified_at=NOW() WHERE id=$1")
        .bind(id).execute(&db).await.unwrap();
    // An invalid stored Base32 key guarantees no six-digit guess can verify;
    // this test exercises admission to proof verification, not clock timing.
    sqlx::query("UPDATE user_totp_credentials SET secret_key='!' WHERE user_id=$1")
        .bind(id)
        .execute(&db)
        .await
        .unwrap();
    let challenge = "ab".repeat(24);
    sqlx::query("INSERT INTO staff_mfa_challenges(user_id,token_hash,purpose,expires_at) VALUES($1,$2,'login',NOW()+INTERVAL '5 minutes')")
        .bind(id).bind(hex::encode(Sha256::digest(challenge.as_bytes())))
        .execute(&db).await.unwrap();
    let mut requests = Vec::new();
    for _ in 0..12 {
        let router = app.clone();
        let challenge = challenge.clone();
        requests.push(tokio::spawn(async move {
            call(&router, "/api/authority/auth/set-initial-password", None,
                 Some(json!({"challenge_token":challenge,"password":SYNTHETIC_PASSWORD,"code":"000000"}))).await.0
        }));
    }
    for request in requests {
        assert_ne!(request.await.unwrap(), StatusCode::OK);
    }
    let attempts: i32 =
        sqlx::query_scalar("SELECT attempts FROM staff_mfa_challenges WHERE user_id=$1")
            .bind(id)
            .fetch_one(&db)
            .await
            .unwrap();
    assert_eq!(
        attempts, 5,
        "parallel guesses cannot overrun the admission budget"
    );
    let password: String = sqlx::query_scalar("SELECT hashed_password FROM users WHERE id=$1")
        .bind(id)
        .fetch_one(&db)
        .await
        .unwrap();
    assert_eq!(password, "!web-only-no-password!");
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
        Some(json!({"identifier":email,"password":SYNTHETIC_PASSWORD,"code":code})),
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
        Some(json!({"identifier":admin_email,"password":SYNTHETIC_PASSWORD,"code":admin_code})),
    )
    .await;
    assert_eq!(login_status, StatusCode::OK);
    let admin_token = admin_login["token"].as_str().unwrap();
    let admin_code =
        TotpEngine::compute_code(&admin_secret, (chrono::Utc::now().timestamp() + 30) as u64)
            .unwrap();
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

#[sqlx::test]
async fn privileged_password_rotation_revokes_session_and_cannot_cross_roles(db: PgPool) {
    let app = build_app_router(state(db.clone()));
    let (id, email, secret) = identity(&db, "authority", &["support.view"]).await;
    let code = TotpEngine::compute_code(&secret, chrono::Utc::now().timestamp() as u64).unwrap();
    let (_, logged_in) = call(
        &app,
        "/api/authority/auth/verify-totp",
        None,
        Some(json!({"identifier":email,"password":SYNTHETIC_PASSWORD,"code":code})),
    )
    .await;
    let session = logged_in["token"].as_str().unwrap();
    assert_eq!(
        call(
            &app,
            "/api/admin/auth/change-password",
            Some(session),
            Some(json!({
                "current_password":SYNTHETIC_PASSWORD,
                "new_password":"Second-Synthetic-Password-For-Isolated-Testing-2026",
                "code":code,
                "reason":"Authorized password-rotation regression fixture"
            })),
        )
        .await
        .0,
        StatusCode::FORBIDDEN,
    );
    assert_eq!(
        call(
            &app,
            "/api/authority/auth/change-password",
            Some(session),
            Some(json!({
                "current_password":"Incorrect account password",
                "new_password":"Second-Synthetic-Password-For-Isolated-Testing-2026",
                "code":code,
                "reason":"Reject incorrect existing password proof"
            })),
        )
        .await
        .0,
        StatusCode::UNAUTHORIZED,
    );
    let code =
        TotpEngine::compute_code(&secret, (chrono::Utc::now().timestamp() + 30) as u64).unwrap();
    let (status, response) = call(
        &app,
        "/api/authority/auth/change-password",
        Some(session),
        Some(json!({
            "current_password":SYNTHETIC_PASSWORD,
            "new_password":"Second-Synthetic-Password-For-Isolated-Testing-2026",
            "code":code,
            "reason":"Authorized credential rotation with a fresh authenticator"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(response["session_revoked"], true);
    assert_eq!(
        call(&app, "/api/authority/auth/me", Some(session), None)
            .await
            .0,
        StatusCode::UNAUTHORIZED,
    );
    let password_hash: String = sqlx::query_scalar("SELECT hashed_password FROM users WHERE id=$1")
        .bind(id)
        .fetch_one(&db)
        .await
        .unwrap();
    assert!(password_hash.starts_with("$argon2id$"));
    assert!(trackmyrmc_backend::auth::password::verify_password(
        "Second-Synthetic-Password-For-Isolated-Testing-2026",
        &password_hash
    )
    .unwrap());
}

#[sqlx::test]
async fn plant_admin_cannot_access_global_service_enquiry_control(db: PgPool) {
    let config = state(db.clone());
    let app = build_app_router(config.clone());
    let (id, email, _) = identity(&db, "admin", &["support.view", "support.manage"]).await;
    let token =
        generate_token(id, "admin", "", Some(&email), &config.config.jwt_secret, 1).unwrap();
    assert_eq!(
        call(&app, "/api/admin/service-enquiries", Some(&token), None)
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        call_method(
            &app,
            &format!("/api/admin/service-enquiries/{}/status", Uuid::new_v4()),
            Some(&token),
            Some(json!({"status":"CONTACTED","reason":"Should be denied"})),
            "PATCH",
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );

    let (_, email, secret) = identity(&db, "central_admin", &["support.view"]).await;
    let code = TotpEngine::compute_code(&secret, chrono::Utc::now().timestamp() as u64).unwrap();
    let (status, login) = call(
        &app,
        "/api/admin/auth/verify-totp",
        None,
        Some(json!({"identifier":email,"password":SYNTHETIC_PASSWORD,"code":code})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let web_token = login["token"].as_str().unwrap();
    assert_eq!(
        call(&app, "/api/admin/service-enquiries", Some(web_token), None)
            .await
            .0,
        StatusCode::OK,
    );
    assert_eq!(
        call_method(
            &app,
            &format!("/api/admin/service-enquiries/{}/status", Uuid::new_v4()),
            Some(web_token),
            Some(json!({"status":"CONTACTED","reason":"Insufficient capabilities"})),
            "PATCH",
        )
        .await
        .0,
        StatusCode::FORBIDDEN,
    );
}

#[sqlx::test]
async fn privileged_proofs_share_replay_counter_across_login_and_step_up(db: PgPool) {
    for role in ["central_admin", "authority"] {
        let app = build_app_router(state(db.clone()));
        let (_, email, secret) = identity(&db, role, &["kyc.review"]).await;
        let prefix = if role == "authority" {
            "/api/authority/auth"
        } else {
            "/api/admin/auth"
        };
        let now = chrono::Utc::now().timestamp() as u64;
        let code = TotpEngine::compute_code(&secret, now).unwrap();
        let login = json!({"identifier":email,"password":SYNTHETIC_PASSWORD,"code":code});
        let (status, session) = call(
            &app,
            &format!("{prefix}/verify-totp"),
            None,
            Some(login.clone()),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        let token = session["token"].as_str().unwrap();
        assert_eq!(
            call(
                &app,
                &format!("{prefix}/step-up"),
                Some(token),
                Some(json!({"code":code}))
            )
            .await
            .0,
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(
            call(&app, &format!("{prefix}/verify-totp"), None, Some(login))
                .await
                .0,
            StatusCode::UNAUTHORIZED
        );
        let fresh = TotpEngine::compute_code(&secret, now + 30).unwrap();
        assert_eq!(
            call(
                &app,
                &format!("{prefix}/step-up"),
                Some(token),
                Some(json!({"code":fresh}))
            )
            .await
            .0,
            StatusCode::OK
        );
        assert_eq!(
            call(
                &app,
                &format!("{prefix}/step-up"),
                Some(token),
                Some(json!({"code":fresh}))
            )
            .await
            .0,
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(
            call(
                &app,
                &format!("{prefix}/verify-totp"),
                None,
                Some(json!({"identifier":email,"password":SYNTHETIC_PASSWORD,"code":fresh}))
            )
            .await
            .0,
            StatusCode::UNAUTHORIZED
        );
    }
}

#[sqlx::test]
async fn privileged_login_throttle_replacement_and_database_expiry(db: PgPool) {
    let app = build_app_router(state(db.clone()));
    let (id, email, secret) = identity(&db, "authority", &["support.view"]).await;
    let now = chrono::Utc::now().timestamp() as u64;
    let old = TotpEngine::compute_code(&secret, now - 30).unwrap();
    let current = TotpEngine::compute_code(&secret, now).unwrap();
    let (_, first) = call(
        &app,
        "/api/authority/auth/verify-totp",
        None,
        Some(json!({"identifier":email,"password":SYNTHETIC_PASSWORD,"code":old})),
    )
    .await;
    let (status, second) = call(
        &app,
        "/api/authority/auth/verify-totp",
        None,
        Some(json!({"identifier":email,"password":SYNTHETIC_PASSWORD,"code":current})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        call(
            &app,
            "/api/authority/auth/me",
            first["token"].as_str(),
            None
        )
        .await
        .0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        call(
            &app,
            "/api/authority/auth/me",
            second["token"].as_str(),
            None
        )
        .await
        .0,
        StatusCode::OK
    );
    sqlx::query(
        "UPDATE control_center_sessions SET expires_at=NOW()-INTERVAL '1 second' WHERE user_id=$1",
    )
    .bind(id)
    .execute(&db)
    .await
    .unwrap();
    assert_eq!(
        call(
            &app,
            "/api/authority/auth/me",
            second["token"].as_str(),
            None
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    for _ in 0..5 {
        assert_eq!(call(&app, "/api/authority/auth/verify-totp", None, Some(json!({"identifier":email,"password":"Incorrect isolated test password","code":current}))).await.0, StatusCode::UNAUTHORIZED);
    }
    let fresh = TotpEngine::compute_code(&secret, now + 30).unwrap();
    assert_eq!(
        call(
            &app,
            "/api/authority/auth/verify-totp",
            None,
            Some(json!({"identifier":email,"password":SYNTHETIC_PASSWORD,"code":fresh}))
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
}

#[sqlx::test]
async fn authority_initial_password_rejects_expired_exhausted_and_revoked_challenges(db: PgPool) {
    let app = build_app_router(state(db.clone()));
    for scenario in [
        "expired",
        "exhausted",
        "consumed",
        "revoked",
        "wrong-purpose",
    ] {
        let (id, _, secret) = identity(&db, "authority", &["support.view"]).await;
        sqlx::query("UPDATE users SET hashed_password='!web-only-no-password!',work_email_verified_at=NOW() WHERE id=$1").bind(id).execute(&db).await.unwrap();
        let token = format!("{}{}", Uuid::new_v4().simple(), "0123456789abcdef");
        let hash = hex::encode(Sha256::digest(token.as_bytes()));
        sqlx::query("INSERT INTO staff_mfa_challenges(user_id,token_hash,purpose,expires_at,attempts,consumed_at) VALUES($1,$2,$3,CASE WHEN $4 THEN NOW()-INTERVAL '1 second' ELSE NOW()+INTERVAL '5 minutes' END,$5,CASE WHEN $6 THEN NOW() ELSE NULL END)")
            .bind(id).bind(&hash).bind(if scenario=="wrong-purpose" {"enrollment"} else {"login"}).bind(scenario=="expired").bind(if scenario=="exhausted" {5_i32} else {0}).bind(scenario=="consumed").execute(&db).await.unwrap();
        if scenario == "revoked" {
            sqlx::query("UPDATE control_center_access SET approved=FALSE WHERE user_id=$1")
                .bind(id)
                .execute(&db)
                .await
                .unwrap();
        }
        let code =
            TotpEngine::compute_code(&secret, chrono::Utc::now().timestamp() as u64).unwrap();
        assert_eq!(
            call(
                &app,
                "/api/authority/auth/set-initial-password",
                None,
                Some(json!({"challenge_token":token,"password":SYNTHETIC_PASSWORD,"code":code}))
            )
            .await
            .0,
            StatusCode::UNAUTHORIZED,
            "{scenario}"
        );
        let hash: String = sqlx::query_scalar("SELECT hashed_password FROM users WHERE id=$1")
            .bind(id)
            .fetch_one(&db)
            .await
            .unwrap();
        assert_eq!(hash, "!web-only-no-password!", "{scenario}");
    }
}

#[sqlx::test]
async fn concurrent_privileged_login_accepts_only_one_possession_proof(db: PgPool) {
    let app = build_app_router(state(db.clone()));
    let (id, email, secret) = identity(&db, "central_admin", &["system.view"]).await;
    let code = TotpEngine::compute_code(&secret, chrono::Utc::now().timestamp() as u64).unwrap();
    let payload = json!({"identifier":email,"password":SYNTHETIC_PASSWORD,"code":code});
    let (first, second) = tokio::join!(
        call(
            &app,
            "/api/admin/auth/verify-totp",
            None,
            Some(payload.clone())
        ),
        call(&app, "/api/admin/auth/verify-totp", None, Some(payload)),
    );
    assert!(
        (first.0 == StatusCode::OK && second.0 == StatusCode::UNAUTHORIZED)
            || (second.0 == StatusCode::OK && first.0 == StatusCode::UNAUTHORIZED)
    );
    let sessions: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM control_center_sessions WHERE user_id=$1 AND revoked_at IS NULL",
    )
    .bind(id)
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(sessions, 1);
}
