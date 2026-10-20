use axum::{
    extract::{Path, State},
    response::IntoResponse,
};
use sqlx::PgPool;
use trackmyrmc_backend::{
    auth::AuthUser,
    config::AppConfig,
    error::AppError,
    routes::{hr_routes, master_data_routes, staff_collections, staff_routes},
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
    assert_eq!(data["kpis"].as_array().unwrap().len(), 4);

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
        sqlx::query("INSERT INTO plant_staff(plant_id,user_id,role,is_active) VALUES($1,$2,$3,TRUE)")
            .bind(plant)
            .bind(staff)
            .bind(role)
            .execute(&db)
            .await
            .unwrap();

        // Default role ceiling permits the primary collection.
        staff_collections::get_staff_collection(
            State(app.clone()), user(staff, role), Path(kind.to_string()),
        ).await.expect("default role collection read");

        sqlx::query(
            "INSERT INTO plant_staff_module_permissions \
             (plant_id,user_id,module_key,can_view,can_edit,can_approve,updated_by) \
             VALUES($1,$2,$3,FALSE,FALSE,FALSE,$4)"
        ).bind(plant).bind(staff).bind(permission).bind(owner)
         .execute(&db).await.unwrap();

        assert!(matches!(
            staff_collections::get_staff_collection(
                State(app.clone()), user(staff, role), Path(kind.to_string())
            ).await,
            Err(AppError::Forbidden(_))
        ), "owner revocation must immediately deny collection: {role}/{kind}");

        // A second plant/owner cannot impersonate this staff member.
        sqlx::query("UPDATE plant_staff SET is_active=FALSE WHERE plant_id=$1 AND user_id=$2")
            .bind(plant).bind(staff).execute(&db).await.unwrap();
        assert!(matches!(
            staff_collections::get_staff_collection(
                State(app.clone()), user(staff, role), Path(kind.to_string())
            ).await,
            Err(AppError::Forbidden(_))
        ));
    }

    // Existing Owner reads must remain available, independently of staff grants.
    let owner_view = staff_collections::get_staff_collection(
        State(app), user(owner, "owner"), Path("orders".to_string())
    ).await.unwrap().0;
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
    sqlx::query("INSERT INTO plant_staff(plant_id,user_id,role,is_active) VALUES($1,$2,'supervisor',TRUE)")
        .bind(plant).bind(supervisor).execute(&db).await.unwrap();
    let app = state(db.clone());
    let response = master_data_routes::get_plant_summary(
        State(app.clone()), user(supervisor, "supervisor"), Path(plant),
    ).await.unwrap().into_response();
    let body: serde_json::Value = serde_json::from_slice(
        &axum::body::to_bytes(response.into_body(), 20000).await.unwrap()
    ).unwrap();
    assert_eq!(body["reports"][0]["status"], "1 total");
    assert_eq!(body["reports"].as_array().unwrap().len(), 4);
    assert!(body.get("salary").is_none());
    assert!(matches!(
        master_data_routes::get_plant_summary(
            State(app.clone()), user(supervisor, "supervisor"), Path(other)
        ).await,
        Err(AppError::Forbidden(_))
    ));
    sqlx::query(
        "INSERT INTO plant_staff_module_permissions \
         (plant_id,user_id,module_key,can_view,can_edit,can_approve,updated_by) \
         VALUES($1,$2,'plant_reports',FALSE,FALSE,FALSE,$3)"
    ).bind(plant).bind(supervisor).bind(owner).execute(&db).await.unwrap();
    assert!(matches!(
        master_data_routes::get_plant_summary(
            State(app.clone()), user(supervisor, "supervisor"), Path(plant)
        ).await,
        Err(AppError::Forbidden(_))
    ));
    assert!(master_data_routes::get_plant_summary(
        State(app), user(owner, "owner"), Path(plant)
    ).await.is_ok());
}

#[sqlx::test]
async fn supervisors_see_roster_without_salaries_and_accountants_keep_pay_access(db: PgPool) {
    let owner = create_user(&db, "owner").await;
    let supervisor = create_user(&db, "supervisor").await;
    let accountant = create_user(&db, "accountant").await;
    let plant = create_plant(&db, owner).await;
    for (staff, role) in [(supervisor, "supervisor"), (accountant, "accountant")] {
        sqlx::query("INSERT INTO plant_staff(plant_id,user_id,role,is_active) VALUES($1,$2,$3,TRUE)")
            .bind(plant).bind(staff).bind(role).execute(&db).await.unwrap();
    }
    let app = state(db);

    let response = hr_routes::list_employees(
        State(app.clone()), user(supervisor, "supervisor"),
    ).await.unwrap().into_response();
    let body: serde_json::Value = serde_json::from_slice(
        &axum::body::to_bytes(response.into_body(), 20000).await.unwrap()
    ).unwrap();
    for staff in body["plants"][0]["employees"].as_array().unwrap() {
        assert!(staff["current_salary"].is_null());
        assert!(staff["salary_totals"].is_null());
        assert!(staff["profile"].is_object());
    }
    let response = hr_routes::get_employee_hr_profile(
        State(app.clone()), user(supervisor, "supervisor"),
        Path((plant, accountant)),
    ).await.unwrap().into_response();
    let body: serde_json::Value = serde_json::from_slice(
        &axum::body::to_bytes(response.into_body(), 10000).await.unwrap()
    ).unwrap();
    assert!(body["employee"]["salary"].is_null());
    let response = hr_routes::get_employee_hr_profile(
        State(app), user(accountant, "accountant"), Path((plant, supervisor)),
    ).await.unwrap().into_response();
    let body: serde_json::Value = serde_json::from_slice(
        &axum::body::to_bytes(response.into_body(), 10000).await.unwrap()
    ).unwrap();
    assert!(body["employee"]["salary"].is_object());
}
