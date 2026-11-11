mod support;
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
    response::IntoResponse,
};
use sqlx::PgPool;
use trackmyrmc_backend::{
    auth::AuthUser,
    config::AppConfig,
    error::AppError,
    routes::{
        customer_services, hr_routes, master_data_routes, owner_dispatches, owner_routes,
        staff_collections, staff_routes, supervisor_incidents,
    },
    state::AppState,
};
use uuid::Uuid;

fn state(db: PgPool) -> AppState {
    AppState::new(
        db,
        AppConfig {
            database_url: String::new(),
            jwt_secret: "test-only".repeat(10),
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
            otp_pepper: "test-only".repeat(8),
            otp_expiration_minutes: 5,
            otp_cooldown_seconds: 60,
            otp_max_verification_attempts: 3,
            play_signing_sha256: None,
            play_review_access_code: None,
            google_places_api_key: None,
        },
    )
}

fn user(id: Uuid, role: &str) -> AuthUser {
    AuthUser {
        user_id: id,
        role: role.to_string(),
        phone: "".to_string(),
        email: None,
    }
}

async fn create_user(db: &PgPool, role: &str) -> Uuid {
    sqlx::query_scalar(
        "INSERT INTO users (phone, hashed_password, full_name, role) VALUES ($1, 'test', $2, $3) RETURNING id",
    ).bind(&Uuid::new_v4().simple().to_string()[..16]).bind(format!("Test {role}")).bind(role)
     .fetch_one(db).await.expect("create user")
}

async fn create_plant(db: &PgPool, owner: Uuid) -> Uuid {
    let code = Uuid::new_v4().simple().to_string();
    sqlx::query_scalar(
        "INSERT INTO rmc_plants (owner_id, name, code, latitude, longitude, address_line, city, state, pincode, contact_phone) VALUES ($1, 'Test Plant', $2, 0, 0, 'Test', 'Test', 'Test', '0', '0') RETURNING id",
    ).bind(owner).bind(code).fetch_one(db).await.expect("create plant")
}

async fn create_order(db: &PgPool, customer: Uuid, plant: Uuid) -> Uuid {
    let site: Uuid = sqlx::query_scalar(
        "INSERT INTO customer_sites (customer_id, name, address_line, city, state, pincode, latitude, longitude, contact_person, contact_phone) VALUES ($1, 'Site', 'Test', 'Test', 'Test', '0', 0, 0, 'Test', '0') RETURNING id",
    ).bind(customer).fetch_one(db).await.expect("create site");
    sqlx::query_scalar(
        "INSERT INTO orders (order_number, customer_id, plant_id, site_id, concrete_grade, total_quantity_m3, delivery_date, delivery_time_slot, total_amount, status) VALUES ($1, $2, $3, $4, 'M25', 6, CURRENT_DATE, 'AM', 100, 'confirmed') RETURNING id",
    ).bind(format!("TEST-{}", Uuid::new_v4())).bind(customer).bind(plant).bind(site)
      .fetch_one(db).await.expect("create order")
}

#[sqlx::test]
async fn collection_is_real_scoped_and_matches_mobile_contract(db: PgPool) {
    let owner = create_user(&db, "owner").await;
    let dispatcher = create_user(&db, "dispatcher").await;
    let outside = create_user(&db, "dispatcher").await;
    let customer = create_user(&db, "customer").await;
    let plant = create_plant(&db, owner).await;
    let _order = create_order(&db, customer, plant).await;
    sqlx::query("INSERT INTO plant_staff (plant_id,user_id,role,is_active) VALUES ($1,$2,'dispatcher',TRUE)")
        .bind(plant).bind(dispatcher).execute(&db).await.unwrap();
    support::approve_fixture_assignments(&db).await;
    let app = state(db);
    let resp = staff_collections::get_staff_collection(
        State(app.clone()),
        user(dispatcher, "dispatcher"),
        Path("dispatch".to_string()),
    )
    .await
    .unwrap()
    .0;
    assert_eq!(resp["title"], "Dispatch Queue");
    assert_eq!(resp["items"].as_array().unwrap().len(), 1);
    assert!(resp["items"][0]["primary"]
        .as_str()
        .unwrap()
        .contains("M25"));
    assert!(resp["items"][0]["nav"]
        .as_str()
        .unwrap()
        .starts_with("/dispatch-order/"));

    let home = staff_routes::get_staff_home(State(app.clone()), user(dispatcher, "dispatcher"))
        .await
        .unwrap()
        .into_response();
    let data: serde_json::Value =
        serde_json::from_slice(&axum::body::to_bytes(home.into_body(), 10000).await.unwrap())
            .unwrap();
    assert_eq!(data["role"], "dispatcher");
    assert_eq!(data["primary"]["kind"], "dispatch");
    assert_eq!(data["kpis"].as_array().unwrap().len(), 3);
    assert!(
        data["metrics"]["today_attendance"].is_null(),
        "Dispatcher has no plant-wide workforce grant"
    );

    assert!(matches!(
        staff_collections::get_staff_collection(
            State(app.clone()),
            user(outside, "dispatcher"),
            Path("orders".to_owned())
        )
        .await,
        Err(AppError::Forbidden(_))
    ));
    assert!(matches!(
        staff_collections::get_staff_collection(
            State(app.clone()),
            user(customer, "customer"),
            Path("orders".to_owned())
        )
        .await,
        Err(AppError::Forbidden(_))
    ));
    assert!(matches!(
        staff_collections::get_staff_collection(
            State(app.clone()),
            user(dispatcher, "dispatcher"),
            Path("invoices".to_owned())
        )
        .await,
        Err(AppError::Forbidden(_))
    ));
    let owner_view = staff_collections::get_staff_collection(
        State(app),
        user(owner, "owner"),
        Path("orders".to_owned()),
    )
    .await
    .unwrap()
    .0;
    assert_eq!(owner_view["items"].as_array().unwrap().len(), 1);
}

#[sqlx::test]
async fn multi_plant_owner_sees_only_owned_plants_and_orders(db: PgPool) {
    let owner = create_user(&db, "plant_owner").await;
    let unrelated_owner = create_user(&db, "owner").await;
    let customer = create_user(&db, "customer").await;
    let p1 = create_plant(&db, owner).await;
    let p2 = create_plant(&db, owner).await;
    let p3 = create_plant(&db, unrelated_owner).await;
    create_order(&db, customer, p1).await;
    create_order(&db, customer, p2).await;
    create_order(&db, customer, p3).await;

    let app = state(db);
    // Force PostgreSQL to parse and execute every registered collection query,
    // including empty invoice, ledger, inventory and incident data sets.
    for kind in [
        "orders",
        "dispatch",
        "production",
        "quality",
        "incidents",
        "fleet",
        "drivers",
        "invoices",
        "ledger",
        "inventory",
        "plants",
    ] {
        let collection = staff_collections::get_staff_collection(
            State(app.clone()),
            user(owner, "plant_owner"),
            Path(kind.to_string()),
        )
        .await
        .expect("all reference collections should execute")
        .0;
        assert!(
            collection["items"].is_array(),
            "invalid contract for {kind}"
        );
    }

    let result = staff_collections::get_staff_collection(
        State(app.clone()),
        user(owner, "plant_owner"),
        Path("orders".into()),
    )
    .await
    .unwrap()
    .0;
    assert_eq!(result["items"].as_array().unwrap().len(), 2);

    let plants = staff_collections::get_staff_collection(
        State(app),
        user(owner, "plant_owner"),
        Path("plants".into()),
    )
    .await
    .unwrap()
    .0;
    assert_eq!(plants["items"].as_array().unwrap().len(), 2);
}

#[sqlx::test]
async fn owner_disabled_grants_block_staff_collections_but_not_owner(db: PgPool) {
    let owner = create_user(&db, "owner").await;
    let customer = create_user(&db, "customer").await;
    let plant = create_plant(&db, owner).await;
    create_order(&db, customer, plant).await;
    let app = state(db.clone());

    for (role, kind, permission) in [
        ("admin", "orders", "dispatch_queue"),
        ("dispatcher", "dispatch", "dispatch_queue"),
        ("operator", "production", "production_queue"),
        ("supervisor", "incidents", "incidents"),
        ("accountant", "invoices", "billing_ledger"),
        ("quality_engineer", "quality", "quality_register"),
        ("fleet_manager", "fleet", "fleet_availability"),
        ("store_manager", "inventory", "material_inventory"),
    ] {
        let staff = create_user(&db, role).await;
        sqlx::query(
            "INSERT INTO plant_staff(plant_id,user_id,role,is_active) VALUES($1,$2,$3,TRUE)",
        )
        .bind(plant)
        .bind(staff)
        .bind(role)
        .execute(&db)
        .await
        .unwrap();
        support::approve_fixture_assignments(&db).await;

        // Default role ceiling permits the primary collection.
        let _ = staff_collections::get_staff_collection(
            State(app.clone()),
            user(staff, role),
            Path(kind.to_string()),
        )
        .await
        .expect("default role collection read");

        sqlx::query(
            "INSERT INTO plant_staff_module_permissions \
             (plant_id,user_id,module_key,can_view,can_edit,can_approve,updated_by) \
             VALUES($1,$2,$3,FALSE,FALSE,FALSE,$4) ON CONFLICT(plant_id,user_id,module_key) DO UPDATE SET can_view=FALSE,can_edit=FALSE,can_create=FALSE,can_export=FALSE,can_approve=FALSE",
        )
        .bind(plant)
        .bind(staff)
        .bind(permission)
        .bind(owner)
        .execute(&db)
        .await
        .unwrap();

        assert!(
            matches!(
                staff_collections::get_staff_collection(
                    State(app.clone()),
                    user(staff, role),
                    Path(kind.to_string())
                )
                .await,
                Err(AppError::Forbidden(_))
            ),
            "owner revocation must immediately deny collection: {role}/{kind}"
        );

        // A second plant/owner cannot impersonate this staff member.
        sqlx::query("UPDATE plant_staff SET is_active=FALSE WHERE plant_id=$1 AND user_id=$2")
            .bind(plant)
            .bind(staff)
            .execute(&db)
            .await
            .unwrap();
        assert!(matches!(
            staff_collections::get_staff_collection(
                State(app.clone()),
                user(staff, role),
                Path(kind.to_string())
            )
            .await,
            Err(AppError::Forbidden(_))
        ));
    }

    // Existing Owner reads must remain available, independently of staff grants.
    let owner_view = staff_collections::get_staff_collection(
        State(app),
        user(owner, "owner"),
        Path("orders".to_string()),
    )
    .await
    .unwrap()
    .0;
    assert_eq!(owner_view["items"].as_array().unwrap().len(), 1);
}

#[sqlx::test]
async fn scoped_reports_show_real_counts_and_respect_owner_revocation(db: PgPool) {
    let owner = create_user(&db, "owner").await;
    let other_owner = create_user(&db, "owner").await;
    let supervisor = create_user(&db, "supervisor").await;
    let customer = create_user(&db, "customer").await;
    let plant = create_plant(&db, owner).await;
    let other = create_plant(&db, other_owner).await;
    create_order(&db, customer, plant).await;
    sqlx::query(
        "INSERT INTO plant_staff(plant_id,user_id,role,is_active) VALUES($1,$2,'supervisor',TRUE)",
    )
    .bind(plant)
    .bind(supervisor)
    .execute(&db)
    .await
    .unwrap();
    support::approve_fixture_assignments(&db).await;
    let app = state(db.clone());
    let response = master_data_routes::get_plant_summary(
        State(app.clone()),
        user(supervisor, "supervisor"),
        Path(plant),
    )
    .await
    .unwrap()
    .into_response();
    let body: serde_json::Value = serde_json::from_slice(
        &axum::body::to_bytes(response.into_body(), 20000)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(body["reports"][0]["status"], "1 total");
    assert_eq!(body["reports"].as_array().unwrap().len(), 4);
    assert!(body.get("salary").is_none());
    assert!(matches!(
        master_data_routes::get_plant_summary(
            State(app.clone()),
            user(supervisor, "supervisor"),
            Path(other)
        )
        .await,
        Err(AppError::Forbidden(_))
    ));
    sqlx::query(
        "INSERT INTO plant_staff_module_permissions \
         (plant_id,user_id,module_key,can_view,can_edit,can_approve,updated_by) \
         VALUES($1,$2,'plant_reports',FALSE,FALSE,FALSE,$3) ON CONFLICT(plant_id,user_id,module_key) DO UPDATE SET can_view=FALSE,can_edit=FALSE,can_create=FALSE,can_export=FALSE,can_approve=FALSE",
    )
    .bind(plant)
    .bind(supervisor)
    .bind(owner)
    .execute(&db)
    .await
    .unwrap();
    assert!(matches!(
        master_data_routes::get_plant_summary(
            State(app.clone()),
            user(supervisor, "supervisor"),
            Path(plant)
        )
        .await,
        Err(AppError::Forbidden(_))
    ));
    assert!(
        master_data_routes::get_plant_summary(State(app), user(owner, "owner"), Path(plant))
            .await
            .is_ok()
    );
}

#[sqlx::test]
async fn supervisors_see_roster_without_salaries_and_accountants_keep_pay_access(db: PgPool) {
    let owner = create_user(&db, "owner").await;
    let supervisor = create_user(&db, "supervisor").await;
    let accountant = create_user(&db, "accountant").await;
    let plant = create_plant(&db, owner).await;
    for (staff, role) in [(supervisor, "supervisor"), (accountant, "accountant")] {
        sqlx::query(
            "INSERT INTO plant_staff(plant_id,user_id,role,is_active) VALUES($1,$2,$3,TRUE)",
        )
        .bind(plant)
        .bind(staff)
        .bind(role)
        .execute(&db)
        .await
        .unwrap();
        support::approve_fixture_assignments(&db).await;
    }
    let app = state(db);

    let response = hr_routes::list_employees(State(app.clone()), user(supervisor, "supervisor"))
        .await
        .unwrap()
        .into_response();
    let body: serde_json::Value = serde_json::from_slice(
        &axum::body::to_bytes(response.into_body(), 20000)
            .await
            .unwrap(),
    )
    .unwrap();
    for staff in body["plants"][0]["employees"].as_array().unwrap() {
        assert!(staff["current_salary"].is_null());
        assert!(staff["salary_totals"].is_null());
        assert!(staff["profile"].is_object());
    }
    let response = hr_routes::get_employee_hr_profile(
        State(app.clone()),
        user(supervisor, "supervisor"),
        Path((plant, accountant)),
    )
    .await
    .unwrap()
    .into_response();
    let body: serde_json::Value = serde_json::from_slice(
        &axum::body::to_bytes(response.into_body(), 10000)
            .await
            .unwrap(),
    )
    .unwrap();
    assert!(body["employee"]["salary"].is_null());
    let response = hr_routes::get_employee_hr_profile(
        State(app),
        user(accountant, "accountant"),
        Path((plant, supervisor)),
    )
    .await
    .unwrap()
    .into_response();
    let body: serde_json::Value = serde_json::from_slice(
        &axum::body::to_bytes(response.into_body(), 10000)
            .await
            .unwrap(),
    )
    .unwrap();
    assert!(body["employee"]["salary"].is_object());
}

#[sqlx::test]
async fn owner_dispatch_register_matches_kpi_and_ignores_unrelated_plants(db: PgPool) {
    let owner = create_user(&db, "owner").await;
    let other_owner = create_user(&db, "owner").await;
    let customer = create_user(&db, "customer").await;
    let plant = create_plant(&db, owner).await;
    let outside = create_plant(&db, other_owner).await;
    let current = create_order(&db, customer, plant).await;
    let old = create_order(&db, customer, plant).await;
    let unrelated = create_order(&db, customer, outside).await;
    for (order, status, days_ago) in [
        (current, "dispatched", 0),
        (current, "delivered", 0),
        (old, "dispatched", 1),
        (unrelated, "dispatched", 0),
    ] {
        let load_number: i32 = sqlx::query_scalar(
            "SELECT COALESCE(MAX(load_number),0)+1 FROM order_loads WHERE order_id=$1",
        )
        .bind(order)
        .fetch_one(&db)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO order_loads(order_id,load_number,quantity_m3,status,dispatched_at)
             VALUES($1,$2,3,$3,NOW()-($4 * INTERVAL '1 day'))",
        )
        .bind(order)
        .bind(load_number)
        .bind(status)
        .bind(days_ago)
        .execute(&db)
        .await
        .unwrap();
    }
    let app = state(db);
    let dashboard = owner_routes::get_owner_home(State(app.clone()), user(owner, "owner"))
        .await
        .unwrap()
        .into_response();
    let bytes = axum::body::to_bytes(dashboard.into_body(), 50_000)
        .await
        .unwrap();
    let data: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    let page = owner_dispatches::today(
        State(app),
        user(owner, "owner"),
        Query(owner_dispatches::DispatchPage::default()),
    )
    .await
    .unwrap()
    .0;
    assert_eq!(data["cards"]["dispatched_loads"], 2);
    assert_eq!(page["total"], data["cards"]["dispatched_loads"]);
    assert_eq!(page["loads"].as_array().unwrap().len(), 2);
    assert!(page["loads"].as_array().unwrap().iter().any(|load| load["status"] == "DELIVERED"));
    assert!(page["loads"].as_array().unwrap().iter().all(|load| {
        load["plant_name"] == "Test Plant" && load["order_id"] == current.to_string()
    }));
}

#[sqlx::test]
async fn supervisor_can_acknowledge_only_assigned_incidents_and_owner_resolves(db: PgPool) {
    let owner = create_user(&db, "owner").await;
    let supervisor = create_user(&db, "supervisor").await;
    let outsider = create_user(&db, "supervisor").await;
    let driver = create_user(&db, "driver").await;
    let customer = create_user(&db, "customer").await;
    let plant = create_plant(&db, owner).await;
    let order = create_order(&db, customer, plant).await;
    sqlx::query(
        "INSERT INTO plant_staff(plant_id,user_id,role,is_active)
         VALUES($1,$2,'supervisor',TRUE)",
    )
    .bind(plant)
    .bind(supervisor)
    .execute(&db)
    .await
    .unwrap();
    support::approve_fixture_assignments(&db).await;
    let load: Uuid = sqlx::query_scalar(
        "INSERT INTO order_loads(order_id,load_number,driver_id,quantity_m3)
         VALUES($1,1,$2,3) RETURNING id",
    )
    .bind(order)
    .bind(driver)
    .fetch_one(&db)
    .await
    .unwrap();
    let alert: Uuid = sqlx::query_scalar(
        "INSERT INTO driver_sos_alerts(driver_id,load_id,latitude,longitude,alert_type,status)
         VALUES($1,$2,19,73,'BREAKDOWN','OPEN') RETURNING id",
    )
    .bind(driver)
    .bind(load)
    .fetch_one(&db)
    .await
    .unwrap();
    let app = state(db.clone());
    let collection = staff_collections::get_staff_collection(
        State(app.clone()),
        user(supervisor, "supervisor"),
        Path("incidents".into()),
    )
    .await
    .unwrap()
    .0;
    assert_eq!(
        collection["items"][0]["actions"][0]["key"],
        "acknowledge-incident",
    );
    let request = || {
        Json(serde_json::from_value(serde_json::json!({
            "reason": "Supervisor is assisting the stopped mixer."
        }))
        .unwrap())
    };
    assert!(matches!(
        supervisor_incidents::acknowledge(
            State(app.clone()),
            user(outsider, "supervisor"),
            Path(alert),
            request(),
        )
        .await,
        Err(AppError::Forbidden(_))
    ));
    let acknowledged = supervisor_incidents::acknowledge(
        State(app.clone()),
        user(supervisor, "supervisor"),
        Path(alert),
        request(),
    )
    .await
    .unwrap()
    .0;
    assert_eq!(acknowledged["status"], "RESPONDING");
    let idempotent = supervisor_incidents::acknowledge(
        State(app.clone()),
        user(supervisor, "supervisor"),
        Path(alert),
        request(),
    )
    .await
    .unwrap()
    .0;
    assert_eq!(idempotent["already_acknowledged"], true);
    let (status, owner_alerts): (String, i64) = sqlx::query_as(
        "SELECT a.status,(SELECT count(*) FROM notifications n
          WHERE n.user_id=$2 AND n.notification_type='incident_responding')
         FROM driver_sos_alerts a WHERE a.id=$1",
    )
    .bind(alert)
    .bind(owner)
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(status, "RESPONDING");
    assert_eq!(owner_alerts, 1);
    owner_routes::resolve_incident(State(app), user(owner, "owner"), Path(alert))
        .await
        .unwrap();
    let status: String = sqlx::query_scalar("SELECT status FROM driver_sos_alerts WHERE id=$1")
        .bind(alert)
        .fetch_one(&db)
        .await
        .unwrap();
    assert_eq!(status, "RESOLVED");
}

#[sqlx::test]
async fn service_enquiry_alerts_are_role_scoped_and_transactional(db: PgPool) {
    let customer = create_user(&db, "customer").await;
    let central_admin = create_user(&db, "central_admin").await;
    let authority = create_user(&db, "authority").await;
    let outsider = create_user(&db, "owner").await;
    let app = state(db.clone());
    let date = (chrono::Utc::now().date_naive() + chrono::Duration::days(2)).to_string();
    let payload = serde_json::json!({
        "service_type": "PUMP_RENTAL",
        "customer_name": "Test Customer",
        "contact_number": "9876543210",
        "location": "Synthetic test site",
        "required_date": date,
        "pump_type": "Line pump",
        "estimated_hours": 6,
    });
    let make_request = || {
        Json(serde_json::from_value(payload.clone()).expect("valid pump enquiry"))
    };
    assert!(matches!(
        customer_services::create(State(app.clone()), user(outsider, "owner"), make_request()).await,
        Err(AppError::Forbidden(_))
    ));
    let (code, created) =
        customer_services::create(State(app), user(customer, "customer"), make_request())
            .await
            .unwrap();
    assert_eq!(code, StatusCode::CREATED);
    assert_eq!(created["status"], "NEW");
    let enquiry_id: Uuid = serde_json::from_value(created["id"].clone()).unwrap();
    let notifications: Vec<Uuid> = sqlx::query_scalar(
        "SELECT user_id FROM notifications
         WHERE notification_type='service_enquiry' AND reference_id=$1",
    )
    .bind(enquiry_id.to_string())
    .fetch_all(&db)
    .await
    .unwrap();
    assert_eq!(notifications.len(), 2);
    assert!(notifications.contains(&central_admin));
    assert!(notifications.contains(&authority));
    assert!(!notifications.contains(&customer));
    assert!(!notifications.contains(&outsider));
}
