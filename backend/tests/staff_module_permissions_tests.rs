mod support;
use axum::{
    extract::{Path, State},
    Json,
};
use sqlx::PgPool;
use trackmyrmc_backend::{
    auth::AuthUser,
    config::AppConfig,
    error::AppError,
    routes::staff_module_permissions::{self as permissions, Action, GrantEdit, ReplaceGrants},
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
fn identity(id: Uuid, role: &str) -> AuthUser {
    AuthUser {
        user_id: id,
        role: role.into(),
        phone: String::new(),
        email: None,
    }
}
async fn user(db: &PgPool, role: &str) -> Uuid {
    sqlx::query_scalar(
        "INSERT INTO users(phone,hashed_password,full_name,role) VALUES($1,'test','Module Test',$2) RETURNING id"
    ).bind(&Uuid::new_v4().simple().to_string()[..16]).bind(role)
    .fetch_one(db).await.unwrap()
}
async fn plant(db: &PgPool, owner: Uuid) -> Uuid {
    sqlx::query_scalar(
        "INSERT INTO rmc_plants(owner_id,name,code,latitude,longitude,address_line,city,state,pincode,contact_phone) \
         VALUES($1,'Module Plant',$2,0,0,'Test','Test','Test','0','0') RETURNING id"
    ).bind(owner).bind(Uuid::new_v4().simple().to_string()).fetch_one(db).await.unwrap()
}
fn settings(queue_view: bool, fleet_edit: bool) -> ReplaceGrants {
    ReplaceGrants {
        permissions: vec![
            GrantEdit {
                create: None,
                export: None,
                key: "dispatch_queue".into(),
                view: queue_view,
                edit: queue_view,
                approve: false,
            },
            GrantEdit {
                create: None,
                export: None,
                key: "fleet_availability".into(),
                view: true,
                edit: fleet_edit,
                approve: false,
            },
            GrantEdit {
                create: None,
                export: None,
                key: "challan_gate_pass".into(),
                view: true,
                edit: true,
                approve: false,
            },
            GrantEdit {
                create: None,
                export: None,
                key: "material_inventory".into(),
                view: true,
                edit: false,
                approve: false,
            },
            GrantEdit {
                create: None,
                export: None,
                key: "billing_ledger".into(),
                view: false,
                edit: false,
                approve: false,
            },
            GrantEdit {
                create: None,
                export: None,
                key: "payroll".into(),
                view: false,
                edit: false,
                approve: false,
            },
        ],
    }
}
#[sqlx::test]
async fn owner_controls_dispatcher_only_with_tenant_isolation_and_live_revocation(db: PgPool) {
    let owner = user(&db, "owner").await;
    let outsider = user(&db, "owner").await;
    let dispatcher = user(&db, "dispatcher").await;
    let supervisor = user(&db, "supervisor").await;
    let mine = plant(&db, owner).await;
    let other = plant(&db, outsider).await;
    sqlx::query(
        "INSERT INTO plant_staff(plant_id,user_id,role,is_active) VALUES($1,$2,'dispatcher',TRUE)",
    )
    .bind(mine)
    .bind(dispatcher)
    .execute(&db)
    .await
    .unwrap();
    support::approve_fixture_assignments(&db).await;
    sqlx::query(
        "INSERT INTO plant_staff(plant_id,user_id,role,is_active) VALUES($1,$2,'supervisor',TRUE)",
    )
    .bind(mine)
    .bind(supervisor)
    .execute(&db)
    .await
    .unwrap();
    support::approve_fixture_assignments(&db).await;
    let app = state(db.clone());
    let dispatch = identity(dispatcher, "dispatcher");
    assert!(
        permissions::require(&app, &dispatch, mine, "dispatch_queue", Action::Edit)
            .await
            .is_ok()
    );
    assert!(
        permissions::require(&app, &dispatch, mine, "material_inventory", Action::View)
            .await
            .is_ok()
    );
    assert!(matches!(
        permissions::require(&app, &dispatch, mine, "material_inventory", Action::Edit).await,
        Err(AppError::Forbidden(_))
    ));
    assert!(matches!(
        permissions::require(&app, &dispatch, mine, "billing_ledger", Action::View).await,
        Err(AppError::Forbidden(_))
    ));
    assert!(matches!(
        permissions::require(&app, &dispatch, other, "dispatch_queue", Action::View).await,
        Err(AppError::Forbidden(_))
    ));
    assert!(matches!(
        permissions::get_staff(
            State(app.clone()),
            identity(outsider, "owner"),
            Path((mine, dispatcher))
        )
        .await,
        Err(AppError::Forbidden(_))
    ));
    assert!(permissions::get_staff(
        State(app.clone()),
        identity(owner, "owner"),
        Path((mine, supervisor))
    )
    .await
    .is_ok());
    let invalid = ReplaceGrants {
        permissions: settings(true, true)
            .permissions
            .into_iter()
            .map(|mut g| {
                if g.key == "payroll" {
                    g.view = true;
                }
                g
            })
            .collect(),
    };
    assert!(matches!(
        permissions::replace_staff(
            State(app.clone()),
            identity(owner, "owner"),
            Path((mine, dispatcher)),
            Json(invalid)
        )
        .await,
        Err(AppError::BadRequest(_))
    ));
    let request = settings(false, false);
    let Json(saved) = permissions::replace_staff(
        State(app.clone()),
        identity(owner, "owner"),
        Path((mine, dispatcher)),
        Json(request),
    )
    .await
    .unwrap();
    assert_eq!(saved["permissions"].as_array().unwrap().len(), 6);
    assert!(matches!(
        permissions::require(&app, &dispatch, mine, "dispatch_queue", Action::View).await,
        Err(AppError::Forbidden(_))
    ));
    assert!(matches!(
        permissions::require(&app, &dispatch, mine, "fleet_availability", Action::Edit).await,
        Err(AppError::Forbidden(_))
    ));
    assert!(
        permissions::require(&app, &dispatch, mine, "fleet_availability", Action::View)
            .await
            .is_ok()
    );
    let audit_count:i64=sqlx::query_scalar(
        "SELECT COUNT(*) FROM plant_staff_module_permission_audit WHERE plant_id=$1 AND staff_user_id=$2"
    ).bind(mine).bind(dispatcher).fetch_one(&db).await.unwrap();
    assert_eq!(
        audit_count, 2,
        "Only the two changed grants require new audit rows"
    );
    assert!(
        sqlx::query("DELETE FROM plant_staff_module_permission_audit WHERE plant_id=$1")
            .bind(mine)
            .execute(&db)
            .await
            .is_err()
    );
    sqlx::query("UPDATE plant_staff SET is_active=FALSE WHERE plant_id=$1 AND user_id=$2")
        .bind(mine)
        .bind(dispatcher)
        .execute(&db)
        .await
        .unwrap();
    assert!(matches!(
        permissions::require(&app, &dispatch, mine, "fleet_availability", Action::View).await,
        Err(AppError::Forbidden(_))
    ));
    assert!(matches!(
        permissions::replace_staff(
            State(app.clone()),
            identity(owner, "owner"),
            Path((mine, dispatcher)),
            Json(settings(true, true))
        )
        .await,
        Err(AppError::Forbidden(_))
    ));
}

#[sqlx::test]
async fn report_export_requires_its_own_explicit_grant_and_plant_scope(db: PgPool) {
    use trackmyrmc_backend::routes::master_data_routes;
    let owner = user(&db, "owner").await;
    let staff = user(&db, "store_manager").await;
    let plant_id = plant(&db, owner).await;
    let other = plant(&db, owner).await;
    sqlx::query("INSERT INTO plant_staff(plant_id,user_id,role) VALUES($1,$2,'store_manager')")
        .bind(plant_id)
        .bind(staff)
        .execute(&db)
        .await
        .unwrap();
    let app = state(db.clone());
    let actor = identity(staff, "store_manager");
    assert!(matches!(
        master_data_routes::export_plant_summary(State(app.clone()), actor.clone(), Path(plant_id))
            .await,
        Err(AppError::Forbidden(_))
    ));
    sqlx::query("INSERT INTO plant_staff_module_permissions(plant_id,user_id,module_key,can_view,can_edit,can_export,updated_by) VALUES($1,$2,'plant_reports',TRUE,FALSE,FALSE,$3)").bind(plant_id).bind(staff).bind(owner).execute(&db).await.unwrap();
    assert!(
        permissions::require(&app, &actor, plant_id, "plant_reports", Action::View)
            .await
            .is_ok()
    );
    assert!(matches!(
        master_data_routes::export_plant_summary(State(app.clone()), actor.clone(), Path(plant_id))
            .await,
        Err(AppError::Forbidden(_))
    ));
    sqlx::query("UPDATE plant_staff_module_permissions SET can_export=TRUE WHERE plant_id=$1 AND user_id=$2 AND module_key='plant_reports'").bind(plant_id).bind(staff).execute(&db).await.unwrap();
    let response =
        master_data_routes::export_plant_summary(State(app.clone()), actor.clone(), Path(plant_id))
            .await
            .unwrap();
    assert_eq!(
        response.headers()[axum::http::header::CONTENT_TYPE],
        "text/csv; charset=utf-8"
    );
    let body = axum::body::to_bytes(response.into_body(), 10000)
        .await
        .unwrap();
    let csv = std::str::from_utf8(&body).unwrap();
    assert!(csv.starts_with("metric,value\r\n"));
    assert!(!csv.contains("salary"));
    assert!(matches!(
        master_data_routes::export_plant_summary(State(app), actor, Path(other)).await,
        Err(AppError::Forbidden(_))
    ));
}

#[sqlx::test]
async fn all_thirteen_roles_fail_closed_without_plant_scope(db: PgPool) {
    let owner = user(&db, "owner").await;
    let other_owner = user(&db, "plant_owner").await;
    let my_plant = plant(&db, owner).await;
    let other_plant = plant(&db, other_owner).await;
    let app = state(db.clone());

    // The owning account alone receives owner-level delegated access.
    assert!(permissions::require(
        &app,
        &identity(owner, "owner"),
        my_plant,
        "billing_ledger",
        Action::Approve
    )
    .await
    .is_ok());
    assert!(matches!(
        permissions::require(
            &app,
            &identity(owner, "owner"),
            other_plant,
            "billing_ledger",
            Action::View
        )
        .await,
        Err(AppError::Forbidden(_))
    ));

    // Every other app role either requires an active plant_staff assignment
    // with a bounded grant, or is categorically forbidden.
    for role in [
        "customer",
        "driver",
        "admin",
        "dispatcher",
        "operator",
        "supervisor",
        "accountant",
        "quality_engineer",
        "fleet_manager",
        "store_manager",
        "authority",
        "central_admin",
    ] {
        let subject = identity(user(&db, role).await, role);
        let decision =
            permissions::require(&app, &subject, my_plant, "fleet_availability", Action::View)
                .await;
        assert!(
            matches!(decision, Err(AppError::Forbidden(_))),
            "role {role} must not inherit a plant grant without ownership or assignment"
        );
    }
}
