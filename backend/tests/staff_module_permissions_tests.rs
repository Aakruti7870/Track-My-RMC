mod support;
use axum::{
    extract::{Path, Query, State},
    response::IntoResponse,
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
            totp_keyring: trackmyrmc_backend::auth::totp_storage::TotpKeyring::for_test_fixtures(),
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

#[sqlx::test]
async fn self_service_attendance_history_is_scoped_to_the_signed_in_employee(db: PgPool) {
    use trackmyrmc_backend::routes::workforce_routes::{
        get_workforce_me, punch_in, punch_out, PunchPayload, WorkforceMeQuery,
    };

    let owner = user(&db, "owner").await;
    let employee = user(&db, "dispatcher").await;
    let colleague = user(&db, "dispatcher").await;
    let assigned_plant = plant(&db, owner).await;
    sqlx::query(
        "INSERT INTO plant_staff(plant_id,user_id,role,is_active) VALUES($1,$2,'dispatcher',TRUE)",
    )
    .bind(assigned_plant)
    .bind(employee)
    .execute(&db)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO workforce_attendance(plant_id,user_id,attendance_date,check_in_time)
         VALUES($1,$2,(NOW() AT TIME ZONE 'Asia/Kolkata')::date,NOW())",
    )
    .bind(assigned_plant)
    .bind(colleague)
    .execute(&db)
    .await
    .unwrap();

    let app = state(db);
    let actor = identity(employee, "dispatcher");
    let evidence = || {
        Json(PunchPayload {
            lat: Some(19.02),
            lng: Some(73.11),
        })
    };
    punch_in(State(app.clone()), actor.clone(), evidence())
        .await
        .unwrap();
    punch_out(State(app.clone()), actor.clone(), evidence())
        .await
        .unwrap();

    let response = get_workforce_me(
        State(app),
        actor,
        Query(WorkforceMeQuery {
            include_activity: true,
        }),
    )
    .await
    .unwrap()
    .into_response();
    let body = axum::body::to_bytes(response.into_body(), 10_000)
        .await
        .unwrap();
    let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let history = body["activity"]["attendance_history"].as_array().unwrap();
    assert_eq!(history.len(), 1);
    assert_eq!(history[0]["id"], body["attendance"]["id"]);
    assert!(body["attendance"]["check_in"].is_string());
    assert!(body["attendance"]["check_out"].is_string());
}

#[sqlx::test]
async fn driver_can_record_attendance_from_employment_assignment_before_mixer_assignment(
    db: PgPool,
) {
    use trackmyrmc_backend::routes::driver_routes::{
        check_in_driver, check_out_driver, get_driver_attendance, DriverAttendanceLocation,
    };

    let owner = user(&db, "owner").await;
    let driver = user(&db, "driver").await;
    let assigned_plant = plant(&db, owner).await;
    sqlx::query("INSERT INTO driver_employment_profiles(plant_id,driver_id) VALUES($1,$2)")
        .bind(assigned_plant)
        .bind(driver)
        .execute(&db)
        .await
        .unwrap();
    let app = state(db);
    let actor = identity(driver, "driver");
    let evidence = || {
        Json(DriverAttendanceLocation {
            lat: 19.02,
            lng: 73.11,
        })
    };
    check_in_driver(State(app.clone()), actor.clone(), evidence())
        .await
        .unwrap();
    check_out_driver(State(app.clone()), actor.clone(), evidence())
        .await
        .unwrap();

    let response = get_driver_attendance(State(app), actor)
        .await
        .unwrap()
        .into_response();
    let body = axum::body::to_bytes(response.into_body(), 10_000)
        .await
        .unwrap();
    let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert!(body["check_in"].is_string());
    assert!(body["check_out"].is_string());
}

#[sqlx::test]
async fn monthly_reports_use_scoped_evidence_and_delegated_payroll_grants(db: PgPool) {
    use trackmyrmc_backend::routes::{payroll_routes, workforce_reports};
    let owner = user(&db, "owner").await;
    let employee = user(&db, "operator").await;
    let accountant = user(&db, "accountant").await;
    let mine = plant(&db, owner).await;
    let other = plant(&db, owner).await;
    for (plant, staff, role) in [
        (mine, employee, "operator"),
        (other, employee, "operator"),
        (mine, accountant, "accountant"),
    ] {
        sqlx::query("INSERT INTO plant_staff(plant_id,user_id,role) VALUES($1,$2,$3)")
            .bind(plant)
            .bind(staff)
            .bind(role)
            .execute(&db)
            .await
            .unwrap();
    }
    support::approve_fixture_assignments(&db).await;
    sqlx::query(
        "INSERT INTO workforce_attendance(plant_id,user_id,attendance_date,check_in_time,check_out_time)
         VALUES ($1,$2,'2028-02-01','2028-02-01 09:00+05:30','2028-02-01 15:30+05:30'),
                ($1,$2,'2028-02-02','2028-02-02 09:00+05:30',NULL),
                ($3,$2,'2028-02-01','2028-02-01 08:00+05:30','2028-02-01 09:00+05:30')",
    ).bind(mine).bind(employee).bind(other).execute(&db).await.unwrap();
    sqlx::query(
        "INSERT INTO workforce_leave_requests(plant_id,user_id,leave_type,start_date,end_date,reason,status)
         VALUES ($1,$2,'SICK','2028-01-31','2028-02-02','Fixture','APPROVED'),
                ($1,$2,'PAID','2028-02-02','2028-02-02','Fixture','APPROVED'),
                ($1,$2,'SICK','2028-02-04','2028-02-05','Fixture','REJECTED')",
    ).bind(mine).bind(employee).execute(&db).await.unwrap();
    sqlx::query(
        "INSERT INTO workforce_client_visits(plant_id,user_id,client_name,purpose,scheduled_for,site_address,status)
         VALUES ($1,$2,'Client','Fixture','2028-01-31 19:00+00','Site','COMPLETED'),
                ($1,$2,'Client','Fixture','2028-02-01 12:00+00','Site','APPROVED')",
    ).bind(mine).bind(employee).execute(&db).await.unwrap();
    sqlx::query(
        "INSERT INTO workforce_expense_claims(plant_id,user_id,category,amount,expense_date,description,status)
         VALUES ($1,$2,'Travel',52.50,'2028-02-02','Fixture','APPROVED'),
                ($1,$2,'Travel',90,'2028-02-03','Fixture','REJECTED')",
    ).bind(mine).bind(employee).execute(&db).await.unwrap();
    let closure: Uuid = sqlx::query_scalar(
        "INSERT INTO payroll_closures(plant_id,year,month) VALUES($1,2028,2) RETURNING id",
    )
    .bind(mine)
    .fetch_one(&db)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO payroll_records(closure_id,user_id,basic_pay,overtime_amount,paid_days,net_pay,notes,payment_status)
         VALUES($1,$2,1000,125.5,1.5,1125.5,'Saved note','draft')",
    ).bind(closure).bind(employee).execute(&db).await.unwrap();
    let app = state(db.clone());
    let report = |actor, payroll_only| {
        workforce_reports::monthly_workforce_report(
            State(app.clone()),
            actor,
            Path("2028-02".into()),
            Query(workforce_reports::MonthlyReportFilters {
                plant_id: Some(mine),
                payroll_only,
            }),
        )
    };
    let owner_body = report(identity(owner, "owner"), true)
        .await
        .unwrap()
        .into_response();
    let owner_data: serde_json::Value = serde_json::from_slice(
        &axum::body::to_bytes(owner_body.into_body(), 100_000)
            .await
            .unwrap(),
    )
    .unwrap();
    let row = &owner_data["reports"][0];
    assert_eq!(owner_data["reports"].as_array().unwrap().len(), 1);
    assert_eq!(row["calendar_days"], 29);
    assert_eq!(row["present_records"], 2);
    assert_eq!(row["completed_shift_records"], 1);
    assert_eq!(row["open_shift_records"], 1);
    assert_eq!(row["approved_leave_days"], 2);
    assert_eq!(row["completed_client_visits"], 1);
    assert_eq!(row["approved_expenses"], 52.5);
    let entry = row["employees"]
        .as_array()
        .unwrap()
        .iter()
        .find(|entry| entry["user_id"] == employee.to_string())
        .unwrap();
    assert_eq!(entry["attendance_hours"], 6.5);
    assert_eq!(
        entry["leave_days_by_type"],
        serde_json::json!({"SICK": 2, "PAID": 1})
    );
    assert_eq!(entry["payroll"]["overtime_amount"], 125.5);
    assert_eq!(entry["payroll"]["paid_days"], 1.5);
    assert_eq!(entry["payroll"]["notes"], "Saved note");

    sqlx::query(
        "UPDATE plant_staff_module_permissions SET can_view = FALSE, can_edit = FALSE, can_create = FALSE, can_export = FALSE
         WHERE plant_id = $1 AND user_id = $2 AND module_key = 'payroll'",
    )
    .bind(mine)
    .bind(accountant)
    .execute(&db)
    .await
    .unwrap();
    let actor = identity(accountant, "accountant");
    for payroll_only in [true, false] {
        let body = report(actor.clone(), payroll_only)
            .await
            .unwrap()
            .into_response();
        let data: serde_json::Value = serde_json::from_slice(
            &axum::body::to_bytes(body.into_body(), 100_000)
                .await
                .unwrap(),
        )
        .unwrap();
        if payroll_only {
            assert!(data["reports"].as_array().unwrap().is_empty());
        } else {
            let report = &data["reports"][0];
            assert_eq!(report["payroll_visible"], false);
            assert!(report["payroll_total"].is_null());
            assert!(report["employees"]
                .as_array()
                .unwrap()
                .iter()
                .all(|row| row["payroll"].is_null()));
        }
    }
    assert!(matches!(
        payroll_routes::list_period_payslips(
            State(app.clone()),
            actor.clone(),
            Path((mine, "2028-02".into())),
        )
        .await,
        Err(AppError::Forbidden(_))
    ));
    assert!(matches!(
        workforce_reports::save_payroll_draft(
            State(app),
            actor,
            Path((mine, "2028-02".into(), employee)),
            Json(workforce_reports::PayrollDraftPayload {
                basic_amount: 2000.0,
                allowances: None,
                overtime_amount: None,
                deductions: None,
                paid_days: Some(2.0),
                notes: None,
            }),
        )
        .await,
        Err(AppError::Forbidden(_))
    ));
}

#[sqlx::test]
async fn client_visit_keeps_schedule_and_follows_owner_approval(db: PgPool) {
    use trackmyrmc_backend::routes::workforce_routes as workforce;
    let owner = user(&db, "owner").await;
    let employee = user(&db, "dispatcher").await;
    let mine = plant(&db, owner).await;
    sqlx::query("INSERT INTO plant_staff(plant_id,user_id,role) VALUES($1,$2,'dispatcher')")
        .bind(mine)
        .bind(employee)
        .execute(&db)
        .await
        .unwrap();
    let app = state(db.clone());
    let employee_actor = identity(employee, "dispatcher");
    let planned = "2028-02-28T12:45:00+05:30";
    workforce::create_client_visit(
        State(app.clone()),
        employee_actor.clone(),
        Json(workforce::CreateVisitPayload {
            client_name: "Fixture Customer".into(),
            purpose: "Scheduled site visit".into(),
            scheduled_for: Some(planned.into()),
            site_address: "Fixture site".into(),
            contact_name: None,
            contact_phone: None,
        }),
    )
    .await
    .unwrap();
    let (visit, saved): (Uuid, chrono::DateTime<chrono::Utc>) =
        sqlx::query_as("SELECT id, scheduled_for FROM workforce_client_visits WHERE user_id=$1")
            .bind(employee)
            .fetch_one(&db)
            .await
            .unwrap();
    assert_eq!(
        saved,
        chrono::DateTime::parse_from_rfc3339(planned).unwrap()
    );
    let evidence = |outcome: Option<&str>| {
        Json(workforce::VisitActionPayload {
            lat: 19.0,
            lng: 73.0,
            outcome: outcome.map(str::to_owned),
        })
    };
    assert!(matches!(
        workforce::start_client_visit(
            State(app.clone()),
            employee_actor.clone(),
            Path(visit),
            evidence(None)
        )
        .await,
        Err(AppError::Conflict(_))
    ));
    let decide = || {
        workforce::owner_unified_decision(
            State(app.clone()),
            identity(owner, "owner"),
            Path(("visits".into(), visit)),
            Json(workforce::OwnerUnifiedDecisionPayload {
                action: "APPROVE".into(),
                note: None,
            }),
        )
    };
    decide().await.unwrap();
    workforce::start_client_visit(
        State(app.clone()),
        employee_actor.clone(),
        Path(visit),
        evidence(None),
    )
    .await
    .unwrap();
    for outcome in ["Recorded on site", "Retry must preserve the first outcome"] {
        workforce::complete_client_visit(
            State(app.clone()),
            employee_actor.clone(),
            Path(visit),
            evidence(Some(outcome)),
        )
        .await
        .unwrap();
    }
    assert!(matches!(decide().await, Err(AppError::Conflict(_))));
    let (status, outcome): (String, String) =
        sqlx::query_as("SELECT status,outcome FROM workforce_client_visits WHERE id=$1")
            .bind(visit)
            .fetch_one(&db)
            .await
            .unwrap();
    assert_eq!(status, "COMPLETED");
    assert_eq!(outcome, "Recorded on site");
}

#[sqlx::test]
async fn roster_keeps_the_measured_geofence_for_each_punch(db: PgPool) {
    use trackmyrmc_backend::routes::workforce_routes as workforce;
    let owner = user(&db, "owner").await;
    let employee = user(&db, "operator").await;
    let mine = plant(&db, owner).await;
    sqlx::query("UPDATE rmc_plants SET latitude=19,longitude=73 WHERE id=$1")
        .bind(mine)
        .execute(&db)
        .await
        .unwrap();
    sqlx::query("INSERT INTO plant_staff(plant_id,user_id,role) VALUES($1,$2,'operator')")
        .bind(mine)
        .bind(employee)
        .execute(&db)
        .await
        .unwrap();
    let app = state(db.clone());
    let configure = |radius| {
        workforce::update_attendance_config(
            State(app.clone()),
            identity(owner, "owner"),
            Path(mine),
            Json(workforce::AttendanceConfigPayload {
                radius_m: Some(radius),
                timezone_name: None,
            }),
        )
    };
    configure(100.0).await.unwrap();
    workforce::punch_in(
        State(app.clone()),
        identity(employee, "operator"),
        Json(workforce::PunchPayload {
            lat: Some(19.005),
            lng: Some(73.0),
        }),
    )
    .await
    .unwrap();
    configure(200.0).await.unwrap();
    workforce::punch_out(
        State(app.clone()),
        identity(employee, "operator"),
        Json(workforce::PunchPayload {
            lat: Some(19.0),
            lng: Some(73.0),
        }),
    )
    .await
    .unwrap();
    let date: String = sqlx::query_scalar(
        "SELECT attendance_date::text FROM workforce_attendance WHERE plant_id=$1",
    )
    .bind(mine)
    .fetch_one(&db)
    .await
    .unwrap();
    let shift_response = workforce::create_shift(
        State(app.clone()),
        identity(owner, "owner"),
        Path(mine),
        Json(workforce::CreateShiftPayload {
            name: "Fixture shift".into(),
            start_time: "09:00".into(),
            end_time: "17:00".into(),
            grace_minutes: Some(15),
            half_day_threshold_minutes: Some(220),
            is_night_shift: None,
            active: Some(true),
        }),
    )
    .await
    .unwrap()
    .into_response();
    let shift_data: serde_json::Value = serde_json::from_slice(
        &axum::body::to_bytes(shift_response.into_body(), 20_000)
            .await
            .unwrap(),
    )
    .unwrap();
    let shift_id = Uuid::parse_str(shift_data["shift_id"].as_str().unwrap()).unwrap();
    workforce::assign_roster_schedule(
        State(app.clone()),
        identity(owner, "owner"),
        Path((mine, date.clone(), employee)),
        Json(workforce::AssignRosterSchedulePayload {
            shift_id: Some(shift_id),
            week_off: false,
            note: None,
        }),
    )
    .await
    .unwrap();
    let result = workforce::get_roster_overview(State(app), identity(owner, "owner"), Path(date))
        .await
        .unwrap()
        .into_response();
    let body: serde_json::Value = serde_json::from_slice(
        &axum::body::to_bytes(result.into_body(), 100_000)
            .await
            .unwrap(),
    )
    .unwrap();
    let plant = &body["plants"][0];
    assert_eq!(plant["attendance_config"]["radius_m"], 200.0);
    assert_eq!(plant["shifts"][0]["grace_minutes"], 15);
    assert_eq!(plant["shifts"][0]["half_day_threshold_minutes"], 220);
    assert_eq!(
        plant["employees"][0]["roster"]["shift_id"],
        shift_id.to_string()
    );
    let attendance = &plant["employees"][0]["attendance"];
    assert!(attendance["check_in"].is_string() && attendance["check_out"].is_string());
    assert_eq!(attendance["check_in_geofence"]["radius_m"], 100.0);
    assert_eq!(attendance["check_in_geofence"]["within_geofence"], false);
    assert_eq!(attendance["check_out_geofence"]["radius_m"], 200.0);
    assert_eq!(attendance["check_out_geofence"]["within_geofence"], true);
}
