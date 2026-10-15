use sqlx::PgPool;
use trackmyrmc_backend::{
    error::AppError,
    repositories::dispatch_repo,
    services::trip_lifecycle::{advance, TripAction},
};
use uuid::Uuid;

#[sqlx::test]
async fn produced_load_requires_challan_gate_pass_and_finishes_delivery(pool: PgPool) {
    use trackmyrmc_backend::services::load_lifecycle;
    let (driver, order, load, second) = fixture(&pool).await;
    let plant: Uuid = sqlx::query_scalar("SELECT plant_id FROM orders WHERE id=$1")
        .bind(order)
        .fetch_one(&pool)
        .await
        .unwrap();
    let mixer:Uuid=sqlx::query_scalar("INSERT INTO transit_mixers (plant_id,registration_number,driver_id,capacity_m3) VALUES ($1,'TEST-MIXER',$2,6) RETURNING id")
        .bind(plant).bind(driver).fetch_one(&pool).await.unwrap();
    sqlx::query("UPDATE order_loads SET status='cancelled' WHERE id=$1")
        .bind(second)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("UPDATE orders SET total_quantity_m3=6,status='confirmed' WHERE id=$1")
        .bind(order)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("UPDATE order_loads SET mixer_id=$2,status='assigned' WHERE id=$1")
        .bind(load)
        .bind(mixer)
        .execute(&pool)
        .await
        .unwrap();
    assert!(load_lifecycle::advance(&pool, load, driver, "prepare")
        .await
        .is_err());
    use axum::{
        extract::{Path, State},
        response::IntoResponse,
        Json,
    };
    use trackmyrmc_backend::routes::{loads_routes, staff_routes};
    let operator:Uuid=sqlx::query_scalar("INSERT INTO users (phone,hashed_password,full_name,role) VALUES ('test-operator','unused','Operator','operator') RETURNING id").fetch_one(&pool).await.unwrap();
    sqlx::query("INSERT INTO plant_staff (plant_id,user_id,role) VALUES ($1,$2,'operator')")
        .bind(plant)
        .bind(operator)
        .execute(&pool)
        .await
        .unwrap();
    let operator_user = trackmyrmc_backend::auth::AuthUser {
        user_id: operator,
        role: "operator".into(),
        phone: "test-operator".into(),
        email: None,
    };
    let app = state(pool.clone());
    staff_routes::start_production(State(app.clone()), operator_user.clone(), Path(order))
        .await
        .unwrap();
    assert!(staff_routes::complete_production(
        State(app.clone()),
        operator_user.clone(),
        Path(order)
    )
    .await
    .is_err());
    sqlx::query("INSERT INTO plant_mix_designs (plant_id,grade,cement_kg) SELECT plant_id,concrete_grade,300 FROM orders WHERE id=$1").bind(order).execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO plant_materials (plant_id,name,material_type,current_stock) VALUES ($1,'Cement','cement',5000)").bind(plant).execute(&pool).await.unwrap();
    staff_routes::record_batch(
        State(app.clone()),
        operator_user.clone(),
        Path(order),
        Json(
            trackmyrmc_backend::services::production_service::BatchInput::Load(
                staff_routes::RecordBatchPayload {
                    load_id: load,
                    batch_number: Some(1),
                    actual_weights: serde_json::json!({"cement":300}),
                    target_weights: None,
                },
            ),
        ),
    )
    .await
    .unwrap();
    staff_routes::complete_production(State(app.clone()), operator_user.clone(), Path(order))
        .await
        .unwrap();
    let response = loads_routes::list_order_loads(State(app), operator_user, Path(order))
        .await
        .unwrap()
        .into_response();
    let json: serde_json::Value = serde_json::from_slice(
        &axum::body::to_bytes(response.into_body(), 10000)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(json["ordered_quantity_m3"], 6.0);
    assert_eq!(json["loads"][0]["status"], "BATCHED");
    assert_eq!(
        load_lifecycle::advance(&pool, load, driver, "prepare")
            .await
            .unwrap(),
        "ready_to_dispatch"
    );
    load_lifecycle::advance(&pool, load, driver, "prepare")
        .await
        .unwrap();
    let challans: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM challans WHERE load_id=$1")
        .bind(load)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(challans, 1);
    assert!(load_lifecycle::advance(&pool, load, driver, "dispatch")
        .await
        .is_err());
    let status: String = sqlx::query_scalar("SELECT status FROM order_loads WHERE id=$1")
        .bind(load)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(status, "ready_to_dispatch");
    sqlx::query("INSERT INTO gate_passes (load_id,pass_number) VALUES ($1,'GP-TEST')")
        .bind(load)
        .execute(&pool)
        .await
        .unwrap();
    load_lifecycle::advance(&pool, load, driver, "dispatch")
        .await
        .unwrap();
    assert!(load_lifecycle::advance(&pool, load, driver, "cancel")
        .await
        .is_err());
    advance(&pool, load, driver, TripAction::Start)
        .await
        .unwrap();
    advance(&pool, load, driver, TripAction::Arrive)
        .await
        .unwrap();
    advance(&pool, load, driver, TripAction::Unload)
        .await
        .unwrap();
    dispatch_repo::record_pod(
        &pool,
        dispatch_repo::PodEvidence {
            load_id: load,
            driver_id: driver,
            receiver_name: "Receiver",
            receiver_phone: "",
            signature_url: Some("signature"),
            photo_url: Some("trackmyrmc/pod/test.jpg"),
            notes: None,
            delivered_quantity: 6.0,
        },
    )
    .await
    .unwrap();
    let status: String = sqlx::query_scalar("SELECT status FROM orders WHERE id=$1")
        .bind(order)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(status, "delivered");
    let available: String = sqlx::query_scalar("SELECT status FROM transit_mixers WHERE id=$1")
        .bind(mixer)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(available, "idle");
    let notifications:i64=sqlx::query_scalar("SELECT COUNT(*) FROM notifications WHERE reference_id=$1 AND notification_type='delivered'").bind(order.to_string()).fetch_one(&pool).await.unwrap();
    assert_eq!(notifications, 1);
}

fn state(pool: PgPool) -> trackmyrmc_backend::state::AppState {
    use trackmyrmc_backend::{config::AppConfig, state::AppState};
    AppState::new(
        pool,
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

fn driver_user(id: Uuid) -> trackmyrmc_backend::auth::AuthUser {
    trackmyrmc_backend::auth::AuthUser {
        user_id: id,
        role: "driver".into(),
        phone: "test-driver".into(),
        email: None,
    }
}

#[sqlx::test]
async fn mobile_trip_response_and_persisted_file_are_authorized(pool: PgPool) {
    use axum::{
        extract::{Path, State},
        response::IntoResponse,
    };
    use trackmyrmc_backend::routes::{driver_routes, storage_routes};
    let (driver, _, load, _) = fixture(&pool).await;
    let state = state(pool);
    let response =
        driver_routes::get_trip_details(State(state.clone()), driver_user(driver), Path(load))
            .await
            .unwrap()
            .into_response();
    assert_eq!(response.status(), axum::http::StatusCode::OK);
    let body = axum::body::to_bytes(response.into_body(), 10000)
        .await
        .unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["trip"]["status"], "DISPATCHED");
    assert_eq!(json["trip"]["quantity"], 6.0);
    assert_eq!(json["trip"]["site_name"], "Test");
    let response = storage_routes::get_file(
        State(state.clone()),
        driver_user(driver),
        Path("trackmyrmc/pod/test.jpg".into()),
    )
    .await
    .unwrap();
    let body = axum::body::to_bytes(response.into_body(), 10000)
        .await
        .unwrap();
    assert_eq!(&body[..], &[1_u8, 2, 3]);
    assert!(matches!(
        storage_routes::get_file(
            State(state),
            driver_user(Uuid::new_v4()),
            Path("trackmyrmc/pod/test.jpg".into())
        )
        .await,
        Err(AppError::NotFound(_))
    ));
}

async fn fixture(pool: &PgPool) -> (Uuid, Uuid, Uuid, Uuid) {
    let driver: Uuid = sqlx::query_scalar("INSERT INTO users (phone, hashed_password, full_name, role) VALUES ('test-driver', 'unused', 'Test', 'driver') RETURNING id")
        .fetch_one(pool).await.unwrap();
    let plant: Uuid = sqlx::query_scalar("INSERT INTO rmc_plants (owner_id, name, code, latitude, longitude, address_line, city, state, pincode, contact_phone) VALUES ($1, 'Test', 'TEST', 0, 0, 'Test', 'Test', 'Test', '0', '0') RETURNING id")
        .bind(driver).fetch_one(pool).await.unwrap();
    let site: Uuid = sqlx::query_scalar("INSERT INTO customer_sites (customer_id, name, address_line, city, state, pincode, latitude, longitude, contact_person, contact_phone) VALUES ($1, 'Test', 'Test', 'Test', 'Test', '0', 0, 0, 'Test', '0') RETURNING id")
        .bind(driver).fetch_one(pool).await.unwrap();
    let order: Uuid = sqlx::query_scalar("INSERT INTO orders (order_number, customer_id, plant_id, site_id, concrete_grade, total_quantity_m3, delivery_date, delivery_time_slot, total_amount, status) VALUES ('TEST-1', $1, $2, $3, 'M25', 12, CURRENT_DATE, 'AM', 1, 'dispatched') RETURNING id")
        .bind(driver).bind(plant).bind(site).fetch_one(pool).await.unwrap();
    let first: Uuid = sqlx::query_scalar("INSERT INTO order_loads (order_id, load_number, driver_id, quantity_m3, status) VALUES ($1, 1, $2, 6, 'dispatched') RETURNING id")
        .bind(order).bind(driver).fetch_one(pool).await.unwrap();
    let second: Uuid = sqlx::query_scalar("INSERT INTO order_loads (order_id, load_number, driver_id, quantity_m3, status) VALUES ($1, 2, $2, 6, 'arrived') RETURNING id")
        .bind(order).bind(driver).fetch_one(pool).await.unwrap();
    sqlx::query("INSERT INTO stored_files (uploaded_by, file_path, file_name, content_type, file_size_bytes, file_data, load_id) VALUES ($1, 'trackmyrmc/pod/test.jpg', 'test.jpg', 'image/jpeg', 3, $2, $3)")
        .bind(driver).bind(vec![1_u8, 2, 3]).bind(first).execute(pool).await.unwrap();
    (driver, order, first, second)
}

#[sqlx::test]
async fn transitions_are_owned_ordered_and_idempotent(pool: PgPool) {
    let (driver, _, load, _) = fixture(&pool).await;
    assert!(matches!(
        advance(&pool, load, Uuid::new_v4(), TripAction::Start).await,
        Err(AppError::NotFound(_))
    ));
    assert!(matches!(
        advance(&pool, load, driver, TripAction::Unload).await,
        Err(AppError::Conflict(_))
    ));
    advance(&pool, load, driver, TripAction::Start)
        .await
        .unwrap();
    advance(&pool, load, driver, TripAction::Start)
        .await
        .unwrap();
    advance(&pool, load, driver, TripAction::Arrive)
        .await
        .unwrap();
    let first_arrival: chrono::DateTime<chrono::Utc> =
        sqlx::query_scalar("SELECT arrived_at FROM order_loads WHERE id=$1")
            .bind(load)
            .fetch_one(&pool)
            .await
            .unwrap();
    advance(&pool, load, driver, TripAction::Arrive)
        .await
        .unwrap();
    let second_arrival: chrono::DateTime<chrono::Utc> =
        sqlx::query_scalar("SELECT arrived_at FROM order_loads WHERE id=$1")
            .bind(load)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(first_arrival, second_arrival);
    let history: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM trip_status_history WHERE load_id=$1")
            .bind(load)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(history, 2);
    assert!(advance(&pool, load, driver, TripAction::Start)
        .await
        .is_err());
}

#[sqlx::test]
async fn multi_load_pod_reconciles_parent_and_prevents_overwrite(pool: PgPool) {
    let (driver, order, first, second) = fixture(&pool).await;
    advance(&pool, first, driver, TripAction::Start)
        .await
        .unwrap();
    advance(&pool, first, driver, TripAction::Arrive)
        .await
        .unwrap();
    sqlx::query("INSERT INTO stored_files (uploaded_by, file_path, file_name, content_type, file_size_bytes, file_data, load_id) VALUES ($1, 'trackmyrmc/pod/second.jpg', 'test.jpg', 'image/jpeg', 3, $2, $3)")
        .bind(driver).bind(vec![1_u8, 2, 3]).bind(second).execute(&pool).await.unwrap();
    assert!(matches!(
        dispatch_repo::record_pod(
            &pool,
            trackmyrmc_backend::repositories::dispatch_repo::PodEvidence {
                load_id: first,
                driver_id: driver,
                receiver_name: "Receiver",
                receiver_phone: "",
                signature_url: Some("signature"),
                photo_url: Some("trackmyrmc/pod/test.jpg"),
                notes: None,
                delivered_quantity: 7.0
            }
        )
        .await,
        Err(AppError::BadRequest(_))
    ));
    assert!(matches!(
        dispatch_repo::record_pod(
            &pool,
            trackmyrmc_backend::repositories::dispatch_repo::PodEvidence {
                load_id: first,
                driver_id: driver,
                receiver_name: "Receiver",
                receiver_phone: "",
                signature_url: Some("signature"),
                photo_url: Some("trackmyrmc/pod/second.jpg"),
                notes: None,
                delivered_quantity: 6.0
            }
        )
        .await,
        Err(AppError::BadRequest(_))
    ));
    sqlx::query("UPDATE orders SET status='pending' WHERE id=$1")
        .bind(order)
        .execute(&pool)
        .await
        .unwrap();
    assert!(matches!(
        dispatch_repo::record_pod(
            &pool,
            trackmyrmc_backend::repositories::dispatch_repo::PodEvidence {
                load_id: first,
                driver_id: driver,
                receiver_name: "Receiver",
                receiver_phone: "",
                signature_url: Some("signature"),
                photo_url: Some("trackmyrmc/pod/test.jpg"),
                notes: None,
                delivered_quantity: 6.0
            }
        )
        .await,
        Err(AppError::Conflict(_))
    ));
    sqlx::query("UPDATE orders SET status='dispatched' WHERE id=$1")
        .bind(order)
        .execute(&pool)
        .await
        .unwrap();
    for load in [first, second] {
        let photo = if load == first {
            "trackmyrmc/pod/test.jpg"
        } else {
            "trackmyrmc/pod/second.jpg"
        };
        let pod = dispatch_repo::record_pod(
            &pool,
            trackmyrmc_backend::repositories::dispatch_repo::PodEvidence {
                load_id: load,
                driver_id: driver,
                receiver_name: "Receiver",
                receiver_phone: "",
                signature_url: Some("signature"),
                photo_url: Some(photo),
                notes: None,
                delivered_quantity: 6.0,
            },
        )
        .await
        .unwrap();
        let retry = dispatch_repo::record_pod(
            &pool,
            trackmyrmc_backend::repositories::dispatch_repo::PodEvidence {
                load_id: load,
                driver_id: driver,
                receiver_name: "Receiver",
                receiver_phone: "",
                signature_url: Some("signature"),
                photo_url: Some(photo),
                notes: None,
                delivered_quantity: 6.0,
            },
        )
        .await
        .unwrap();
        assert_eq!(pod.id, retry.id);
        assert_eq!(pod.delivered_at, retry.delivered_at);
        let status: String = sqlx::query_scalar("SELECT status FROM orders WHERE id=$1")
            .bind(order)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(
            status,
            if load == first {
                "dispatched"
            } else {
                "delivered"
            }
        );
    }
    assert!(matches!(
        dispatch_repo::record_pod(
            &pool,
            trackmyrmc_backend::repositories::dispatch_repo::PodEvidence {
                load_id: first,
                driver_id: driver,
                receiver_name: "Changed",
                receiver_phone: "",
                signature_url: Some("signature"),
                photo_url: Some("trackmyrmc/pod/test.jpg"),
                notes: None,
                delivered_quantity: 6.0
            }
        )
        .await,
        Err(AppError::Conflict(_))
    ));
    use axum::{
        extract::{Path, State},
        response::IntoResponse,
    };
    let response = trackmyrmc_backend::routes::driver_routes::get_trip_details(
        State(state(pool.clone())),
        driver_user(driver),
        Path(first),
    )
    .await
    .unwrap()
    .into_response();
    let body = axum::body::to_bytes(response.into_body(), 10000)
        .await
        .unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["trip"]["status"], "DELIVERED");
    assert_eq!(json["pod"]["receiver_name"], "Receiver");
    assert_eq!(json["pod"]["delivered_quantity"], 6.0);
    assert!(advance(&pool, first, driver, TripAction::Start)
        .await
        .is_err());
}

#[test]
fn mobile_pod_contract_deserializes() {
    let payload = serde_json::json!({"receiver_name":"Receiver", "delivered_quantity":6.0,
        "photo_path":"trackmyrmc/pod/test.jpg", "signature":"[]", "remarks":"Site note"});
    let request: trackmyrmc_backend::models::challan::SubmitPodRequest =
        serde_json::from_value(payload).unwrap();
    assert_eq!(
        request.photo_url.as_deref(),
        Some("trackmyrmc/pod/test.jpg")
    );
    assert_eq!(request.notes.as_deref(), Some("Site note"));
    assert_eq!(request.delivered_quantity, 6.0);
}

fn quantity_batch(
    quantity: f64,
    request: &str,
) -> trackmyrmc_backend::services::production_service::BatchInput {
    use trackmyrmc_backend::services::production_service::{BatchInput, QuantityBatch};
    BatchInput::Quantity(QuantityBatch {
        quantity,
        request_id: Some(request.into()),
        batch_reference: Some("Batch report".into()),
        remarks: None,
        consume_materials: Some(true),
    })
}
async fn production_fixture(pool: &PgPool) -> (Uuid, Uuid, Uuid) {
    let (actor, order, _, _) = fixture(pool).await;
    sqlx::query("UPDATE orders SET status='in_production',total_quantity_m3=6 WHERE id=$1")
        .bind(order)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("UPDATE order_loads SET status='planned' WHERE order_id=$1")
        .bind(order)
        .execute(pool)
        .await
        .unwrap();
    let plant: Uuid = sqlx::query_scalar("SELECT plant_id FROM orders WHERE id=$1")
        .bind(order)
        .fetch_one(pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO plant_mix_designs (plant_id,grade,cement_kg,water_litre) VALUES ($1,'M25',300,150)").bind(plant).execute(pool).await.unwrap();
    sqlx::query("INSERT INTO plant_materials (plant_id,name,material_type,unit,current_stock) VALUES ($1,'Cement','CEMENT','ton',5),($1,'Water','WATER','litre',2000)").bind(plant).execute(pool).await.unwrap();
    (actor, order, plant)
}
#[sqlx::test]
async fn production_retry_consumes_inventory_once_and_preserves_unit_conversion(pool: PgPool) {
    use trackmyrmc_backend::services::production_service::record;
    let (actor, order, plant) = production_fixture(&pool).await;
    let (first, retry) = tokio::join!(
        record(&pool, order, actor, quantity_batch(6.0, "same-request")),
        record(&pool, order, actor, quantity_batch(6.0, "same-request"))
    );
    let first = first.unwrap();
    assert_eq!(first["batch_id"], retry.unwrap()["batch_id"]);
    assert_eq!(first["produced"], 6.0);
    assert_eq!(first["material_consumption"][0]["stock_quantity"], 1.8);
    let stock:f64=sqlx::query_scalar("SELECT current_stock::DOUBLE PRECISION FROM plant_materials WHERE plant_id=$1 AND material_type='CEMENT'").bind(plant).fetch_one(&pool).await.unwrap();
    assert!((stock - 3.2).abs() < 1e-8);
    assert!(matches!(
        record(&pool, order, actor, quantity_batch(5.0, "same-request")).await,
        Err(AppError::Conflict(_))
    ));
    let counts:(i64,i64)=sqlx::query_as("SELECT (SELECT COUNT(*) FROM production_batches),(SELECT COUNT(*) FROM production_stock_movements)").fetch_one(&pool).await.unwrap();
    assert_eq!(counts, (1, 2));
}
#[sqlx::test]
async fn production_failure_rolls_back_all_stock_and_concurrent_totals_are_bounded(pool: PgPool) {
    use trackmyrmc_backend::services::production_service::record;
    let (actor, order, plant) = production_fixture(&pool).await;
    sqlx::query(
        "UPDATE plant_materials SET current_stock=0 WHERE plant_id=$1 AND material_type='WATER'",
    )
    .bind(plant)
    .execute(&pool)
    .await
    .unwrap();
    assert!(matches!(
        record(&pool, order, actor, quantity_batch(4.0, "failed-batch")).await,
        Err(AppError::Conflict(_))
    ));
    let stock:f64=sqlx::query_scalar("SELECT current_stock::DOUBLE PRECISION FROM plant_materials WHERE plant_id=$1 AND material_type='CEMENT'").bind(plant).fetch_one(&pool).await.unwrap();
    assert_eq!(stock, 5.0);
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM production_batches")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 0);
    sqlx::query(
        "UPDATE plant_materials SET current_stock=2000 WHERE plant_id=$1 AND material_type='WATER'",
    )
    .bind(plant)
    .execute(&pool)
    .await
    .unwrap();
    let (a, b) = tokio::join!(
        record(&pool, order, actor, quantity_batch(4.0, "concurrent-a")),
        record(&pool, order, actor, quantity_batch(4.0, "concurrent-b"))
    );
    assert_ne!(a.is_ok(), b.is_ok());
    let total: f64 =
        sqlx::query_scalar("SELECT SUM(quantity)::DOUBLE PRECISION FROM production_batches")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(total, 4.0);
}
#[sqlx::test]
async fn quantity_production_contract_is_scoped_and_can_allocate_delivery_after_completion(
    pool: PgPool,
) {
    use axum::{
        extract::{Path, State},
        response::IntoResponse,
        Json,
    };
    use trackmyrmc_backend::{
        auth::AuthUser,
        routes::staff_routes,
        services::{load_lifecycle, production_service::record},
    };
    let (actor, order, plant) = production_fixture(&pool).await;
    let owner = AuthUser {
        user_id: actor,
        role: "plant_owner".into(),
        phone: "test-driver".into(),
        email: None,
    };
    let mut intruder = owner.clone();
    intruder.user_id = Uuid::new_v4();
    assert!(matches!(
        staff_routes::get_production_status(State(state(pool.clone())), intruder, Path(order))
            .await,
        Err(AppError::Forbidden(_))
    ));
    assert!(staff_routes::record_batch(
        State(state(pool.clone())),
        owner.clone(),
        Path(order),
        Json(quantity_batch(6.0, "owner-quantity"))
    )
    .await
    .is_ok());
    let response =
        staff_routes::get_production_status(State(state(pool.clone())), owner.clone(), Path(order))
            .await
            .unwrap()
            .into_response();
    let data: serde_json::Value = serde_json::from_slice(
        &axum::body::to_bytes(response.into_body(), 10000)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(data["ordered_quantity"], 6.0);
    assert_eq!(data["produced_quantity"], 6.0);
    assert_eq!(data["remaining_quantity"], 0.0);
    assert_eq!(data["batches"][0]["quantity"], 6.0);
    staff_routes::complete_production(State(state(pool.clone())), owner, Path(order))
        .await
        .unwrap();
    assert!(
        record(&pool, order, actor, quantity_batch(1.0, "after-complete"))
            .await
            .is_err()
    );
    let mixer:Uuid=sqlx::query_scalar("INSERT INTO transit_mixers (plant_id,registration_number,driver_id,capacity_m3) VALUES ($1,'QTY-MIXER',$2,6) RETURNING id").bind(plant).bind(actor).fetch_one(&pool).await.unwrap();
    let loads: Vec<Uuid> =
        sqlx::query_scalar("SELECT id FROM order_loads WHERE order_id=$1 ORDER BY load_number")
            .bind(order)
            .fetch_all(&pool)
            .await
            .unwrap();
    sqlx::query("UPDATE order_loads SET mixer_id=$2,status='assigned' WHERE id=$1")
        .bind(loads[0])
        .bind(mixer)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        load_lifecycle::advance(&pool, loads[0], actor, "prepare")
            .await
            .unwrap(),
        "ready_to_dispatch"
    );
    // A second load cannot spend the same physical production pool with different resources.
    let driver2:Uuid=sqlx::query_scalar("INSERT INTO users (phone,hashed_password,full_name,role) VALUES ('quantity-driver2','unused','Other Driver','driver') RETURNING id").fetch_one(&pool).await.unwrap();
    let mixer2:Uuid=sqlx::query_scalar("INSERT INTO transit_mixers (plant_id,registration_number,driver_id,capacity_m3) VALUES ($1,'QTY-MIXER-2',$2,6) RETURNING id").bind(plant).bind(driver2).fetch_one(&pool).await.unwrap();
    sqlx::query("UPDATE order_loads SET mixer_id=$2,driver_id=$3,status='assigned' WHERE id=$1")
        .bind(loads[1])
        .bind(mixer2)
        .bind(driver2)
        .execute(&pool)
        .await
        .unwrap();
    assert!(
        matches!(load_lifecycle::advance(&pool,loads[1],actor,"prepare").await,Err(AppError::Conflict(message)) if message.contains("produced quantity"))
    );
}

fn payment_input(
    amount: f64,
    key: &str,
) -> trackmyrmc_backend::services::billing_service::PaymentInput {
    trackmyrmc_backend::services::billing_service::PaymentInput {
        amount,
        payment_method: None,
        transaction_ref: None,
        notes: None,
        request_id: Some(key.into()),
    }
}
#[sqlx::test]
async fn delivered_invoice_is_idempotent_and_partial_payments_reconcile(pool: PgPool) {
    use axum::{extract::State, response::IntoResponse};
    use trackmyrmc_backend::{auth::AuthUser, routes::owner_routes, services::billing_service};
    let (actor, order, _, _) = fixture(&pool).await;
    let app = state(pool.clone());
    let user = AuthUser {
        user_id: actor,
        role: "plant_owner".into(),
        phone: "test".into(),
        email: None,
    };
    assert!(billing_service::create_invoice(&app, &user, order)
        .await
        .is_err());
    sqlx::query("UPDATE orders SET status='delivered',total_amount=118,tax_amount=18 WHERE id=$1")
        .bind(order)
        .execute(&pool)
        .await
        .unwrap();
    let (first, retry) = tokio::join!(
        billing_service::create_invoice(&app, &user, order),
        billing_service::create_invoice(&app, &user, order)
    );
    let first = first.unwrap();
    assert_eq!(first["invoice_id"], retry.unwrap()["invoice_id"]);
    let invoice: Uuid = serde_json::from_value(first["invoice_id"].clone()).unwrap();
    let (one, two) = tokio::join!(
        billing_service::payment(&app, &user, invoice, payment_input(18.0, "same-payment")),
        billing_service::payment(&app, &user, invoice, payment_input(18.0, "same-payment"))
    );
    let one = one.unwrap();
    assert_eq!(one["payment_id"], two.unwrap()["payment_id"]);
    assert_eq!(one["status"], "PARTIALLY_PAID");
    let response = owner_routes::list_owner_invoices(State(app.clone()), user.clone())
        .await
        .unwrap()
        .into_response();
    let data: serde_json::Value = serde_json::from_slice(
        &axum::body::to_bytes(response.into_body(), 10000)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(data["summary"]["billed"], 118.0);
    assert_eq!(data["summary"]["received"], 18.0);
    assert_eq!(data["invoices"][0]["balance"], 100.0);
    assert!(
        billing_service::payment(&app, &user, invoice, payment_input(19.0, "same-payment"))
            .await
            .is_err()
    );
    assert!(
        billing_service::payment(&app, &user, invoice, payment_input(101.0, "over-payment"))
            .await
            .is_err()
    );
    assert!(
        billing_service::payment(&app, &user, invoice, payment_input(-1.0, "negative-pay"))
            .await
            .is_err()
    );
    assert!(
        billing_service::payment(&app, &user, invoice, payment_input(0.005, "fraction-pay"))
            .await
            .is_err()
    );
    let result =
        billing_service::payment(&app, &user, invoice, payment_input(100.0, "final-payment"))
            .await
            .unwrap();
    assert_eq!(result["status"], "PAID");
    let status: String = sqlx::query_scalar("SELECT payment_status FROM orders WHERE id=$1")
        .bind(order)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(status, "paid");
    let totals: (i64, f64) = sqlx::query_as(
        "SELECT COUNT(*),SUM(amount)::DOUBLE PRECISION FROM plant_payments WHERE invoice_id=$1",
    )
    .bind(invoice)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(totals, (2, 118.0));
}
#[sqlx::test]
async fn concurrent_payments_cannot_exceed_balance_and_foreign_admin_is_denied(pool: PgPool) {
    use trackmyrmc_backend::{auth::AuthUser, services::billing_service};
    let (actor, order, _, _) = fixture(&pool).await;
    let app = state(pool.clone());
    let owner = AuthUser {
        user_id: actor,
        role: "owner".into(),
        phone: "test".into(),
        email: None,
    };
    sqlx::query("UPDATE orders SET status='delivered',total_amount=100,tax_amount=0 WHERE id=$1")
        .bind(order)
        .execute(&pool)
        .await
        .unwrap();
    let invoice = billing_service::create_invoice(&app, &owner, order)
        .await
        .unwrap();
    let id: Uuid = serde_json::from_value(invoice["invoice_id"].clone()).unwrap();
    let mut foreign = owner.clone();
    foreign.role = "admin".into();
    foreign.user_id = Uuid::new_v4();
    assert!(matches!(
        billing_service::payment(&app, &foreign, id, payment_input(50.0, "foreign-pay")).await,
        Err(AppError::Forbidden(_))
    ));
    let (one, two) = tokio::join!(
        billing_service::payment(&app, &owner, id, payment_input(60.0, "concurrent-pay-a")),
        billing_service::payment(&app, &owner, id, payment_input(60.0, "concurrent-pay-b"))
    );
    assert_ne!(one.is_ok(), two.is_ok());
    let total: f64 = sqlx::query_scalar(
        "SELECT SUM(amount)::DOUBLE PRECISION FROM plant_payments WHERE invoice_id=$1",
    )
    .bind(id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(total, 60.0);
}
#[sqlx::test]
async fn legacy_order_routes_enforce_tenancy_and_lifecycle(pool: PgPool) {
    use axum::{
        extract::{Path, State},
        Json,
    };
    use trackmyrmc_backend::{
        auth::AuthUser,
        routes::{owner_routes, staff_routes},
    };
    let (actor, order, load, _) = fixture(&pool).await;
    let app = state(pool.clone());
    let owner = AuthUser {
        user_id: actor,
        role: "owner".into(),
        phone: "test".into(),
        email: None,
    };
    let mut foreign = owner.clone();
    foreign.user_id = Uuid::new_v4();
    foreign.role = "admin".into();
    assert!(matches!(
        staff_routes::get_staff_order(State(app.clone()), foreign.clone(), Path(order)).await,
        Err(AppError::Forbidden(_))
    ));
    assert!(matches!(
        owner_routes::approve_order(State(app.clone()), foreign.clone(), Path(order)).await,
        Err(AppError::Forbidden(_))
    ));
    assert!(matches!(
        owner_routes::approve_order(State(app.clone()), owner.clone(), Path(order)).await,
        Err(AppError::Conflict(_))
    ));
    assert!(matches!(
        staff_routes::assign_tm_to_order(
            State(app.clone()),
            foreign.clone(),
            Path(order),
            Json(staff_routes::AssignTmPayload {
                mixer_id: Uuid::new_v4(),
                load_id: Some(load)
            })
        )
        .await,
        Err(AppError::Forbidden(_))
    ));
    assert!(
        staff_routes::dispatch_order(State(app.clone()), owner.clone(), Path(order))
            .await
            .is_err()
    );
    assert!(matches!(
        staff_routes::approve_customer_kyc(
            State(app.clone()),
            foreign,
            axum::http::HeaderMap::new(),
            Path(Uuid::new_v4())
        )
        .await,
        Err(AppError::Forbidden(_))
    ));
    assert!(matches!(
        staff_routes::approve_customer_kyc(
            State(app.clone()),
            owner,
            axum::http::HeaderMap::new(),
            Path(Uuid::new_v4())
        )
        .await,
        Err(AppError::Forbidden(_))
    ));
    let data = trackmyrmc_backend::services::order_service::mobile_detail(
        &app,
        &trackmyrmc_backend::auth::AuthUser {
            user_id: actor,
            role: "plant_owner".into(),
            phone: "test".into(),
            email: None,
        },
        order,
    )
    .await
    .unwrap();
    assert_eq!(data["order"]["quantity"], 12.0);
    assert_eq!(data["order"]["grade"], "M25");
    assert_eq!(data["order"]["status"], "DISPATCHED");
    assert!(data["history"].is_array());
    let status: String = sqlx::query_scalar("SELECT status FROM orders WHERE id=$1")
        .bind(order)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(status, "dispatched");
}

#[sqlx::test]
async fn ordinary_admin_cannot_read_foreign_hr_master_or_payroll_records(pool: PgPool) {
    use axum::extract::{Path, Query, State};
    use trackmyrmc_backend::{
        auth::AuthUser,
        routes::{hr_routes, master_data_routes, payroll_routes, workforce_routes},
    };
    let (actor, order, _, _) = fixture(&pool).await;
    let app = state(pool.clone());
    let plant: Uuid = sqlx::query_scalar("SELECT plant_id FROM orders WHERE id=$1")
        .bind(order)
        .fetch_one(&pool)
        .await
        .unwrap();
    let user = AuthUser {
        user_id: Uuid::new_v4(),
        role: "admin".into(),
        phone: "test".into(),
        email: None,
    };
    assert!(matches!(
        master_data_routes::get_plant_profile(State(app.clone()), user.clone(), Path(plant)).await,
        Err(AppError::Forbidden(_))
    ));
    assert!(matches!(
        hr_routes::get_employee_hr_profile(State(app.clone()), user.clone(), Path((plant, actor)))
            .await,
        Err(AppError::Forbidden(_))
    ));
    assert!(matches!(
        payroll_routes::export_payroll_csv(
            State(app.clone()),
            user.clone(),
            Path((plant, "2026-10".into()))
        )
        .await,
        Err(AppError::Forbidden(_))
    ));
    assert!(matches!(
        payroll_routes::close_payroll_period(
            State(app.clone()),
            user.clone(),
            Path((plant, "2026-10".into())),
            None
        )
        .await,
        Err(AppError::Forbidden(_))
    ));
    assert!(matches!(
        workforce_routes::get_roster(
            State(app),
            user,
            Query(workforce_routes::RosterQuery {
                plant_id: plant,
                date: None
            })
        )
        .await,
        Err(AppError::Forbidden(_))
    ));
}

fn payroll_draft() -> trackmyrmc_backend::routes::workforce_reports::PayrollDraftPayload {
    trackmyrmc_backend::routes::workforce_reports::PayrollDraftPayload {
        basic_amount: 1000.0,
        allowances: Some(100.0),
        overtime_amount: Some(50.0),
        deductions: Some(25.0),
        paid_days: Some(20.0),
        notes: Some("Verified attendance".into()),
    }
}
#[sqlx::test]
async fn payroll_requires_separate_roles_and_posts_expense_once_before_immutable_close(
    pool: PgPool,
) {
    use axum::{
        extract::{Path, State},
        response::IntoResponse,
    };
    use trackmyrmc_backend::{
        auth::AuthUser,
        routes::payroll_routes,
        services::payroll_lifecycle::{self as payroll, Period},
    };
    let (owner_id, order, _, _) = fixture(&pool).await;
    let plant: Uuid = sqlx::query_scalar("SELECT plant_id FROM orders WHERE id=$1")
        .bind(order)
        .fetch_one(&pool)
        .await
        .unwrap();
    sqlx::query("UPDATE users SET role='plant_owner' WHERE id=$1")
        .bind(owner_id)
        .execute(&pool)
        .await
        .unwrap();
    let accountant:Uuid=sqlx::query_scalar("INSERT INTO users(phone,hashed_password,full_name,role) VALUES('pay-accountant','unused','Payroll Accountant','accountant') RETURNING id").fetch_one(&pool).await.unwrap();
    let employee:Uuid=sqlx::query_scalar("INSERT INTO users(phone,hashed_password,full_name,role) VALUES('pay-driver','unused','Original Employee','driver') RETURNING id").fetch_one(&pool).await.unwrap();
    sqlx::query("INSERT INTO plant_staff(plant_id,user_id,role) VALUES($1,$2,'accountant'),($1,$3,'driver')").bind(plant).bind(accountant).bind(employee).execute(&pool).await.unwrap();
    let app = state(pool.clone());
    let owner = AuthUser {
        user_id: owner_id,
        role: "plant_owner".into(),
        phone: "test".into(),
        email: None,
    };
    let accountant_user = AuthUser {
        user_id: accountant,
        role: "accountant".into(),
        phone: "pay-accountant".into(),
        email: None,
    };
    let period = || Period::parse(plant, "2026-10").unwrap();
    assert!(matches!(
        payroll::draft(&app, &owner, period(), employee, payroll_draft()).await,
        Err(AppError::Forbidden(_))
    ));
    assert!(payroll::close(&app, &owner, period(), None).await.is_err());
    for target in [accountant, employee] {
        payroll::draft(&app, &accountant_user, period(), target, payroll_draft())
            .await
            .unwrap();
        // Repeated drafts update a single record under the period lock.
        payroll::draft(&app, &accountant_user, period(), target, payroll_draft())
            .await
            .unwrap();
        assert!(payroll::pay(
            &app,
            &accountant_user,
            period(),
            target,
            "bank_transfer",
            "before-approval"
        )
        .await
        .is_err());
        assert!(matches!(
            payroll::decide(&app, &accountant_user, period(), target, "APPROVE", None).await,
            Err(AppError::Forbidden(_))
        ));
        payroll::decide(&app, &owner, period(), target, "APPROVE", None)
            .await
            .unwrap();
        let reference = format!("salary-{target}");
        let (first, retry) = tokio::join!(
            payroll::pay(
                &app,
                &accountant_user,
                period(),
                target,
                "bank_transfer",
                &reference
            ),
            payroll::pay(
                &app,
                &accountant_user,
                period(),
                target,
                "bank_transfer",
                &reference
            )
        );
        assert_eq!(first.unwrap()["payment_status"], "PAID");
        assert!(retry.is_ok());
        assert!(payroll::pay(
            &app,
            &accountant_user,
            period(),
            target,
            "bank_transfer",
            "changed-reference"
        )
        .await
        .is_err());
        assert!(
            payroll::draft(&app, &accountant_user, period(), target, payroll_draft())
                .await
                .is_err()
        );
        assert!(
            payroll::decide(&app, &owner, period(), target, "RETURN", None)
                .await
                .is_err()
        );
    }
    let expenses:(i64,f64)=sqlx::query_as("SELECT COUNT(*),SUM(amount)::DOUBLE PRECISION FROM plant_expenses WHERE payroll_record_id IS NOT NULL").fetch_one(&pool).await.unwrap();
    assert_eq!(expenses, (2, 2250.0));
    let records: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM payroll_records")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(records, 2);
    let close = payroll::close(&app, &owner, period(), None).await.unwrap();
    assert_eq!(close["closure_version"], 1);
    let totals:(i32,f64,f64)=sqlx::query_as("SELECT employee_count,total_gross::DOUBLE PRECISION,total_net::DOUBLE PRECISION FROM payroll_closures WHERE plant_id=$1").bind(plant).fetch_one(&pool).await.unwrap();
    assert_eq!(totals, (2, 2300.0, 2250.0));
    assert!(
        payroll::draft(&app, &accountant_user, period(), employee, payroll_draft())
            .await
            .is_err()
    );
    sqlx::query("UPDATE users SET full_name='Changed Employee' WHERE id=$1")
        .bind(employee)
        .execute(&pool)
        .await
        .unwrap();
    let response = payroll_routes::export_payroll_csv(
        State(app.clone()),
        owner.clone(),
        Path((plant, "2026-10".into())),
    )
    .await
    .unwrap()
    .into_response();
    let data: serde_json::Value = serde_json::from_slice(
        &axum::body::to_bytes(response.into_body(), 20000)
            .await
            .unwrap(),
    )
    .unwrap();
    let csv = data["csv"].as_str().unwrap();
    assert!(csv.contains("Original Employee"));
    assert!(!csv.contains("Changed Employee"));
    assert!(csv.contains("1125"));
    let snapshot: serde_json::Value =
        sqlx::query_scalar("SELECT snapshot FROM payroll_payslip_snapshots WHERE user_id=$1")
            .bind(employee)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(snapshot["payroll_snapshot"]["paid_days"], 20.0);
    assert_eq!(snapshot["payroll_snapshot"]["overtime_amount"], 50.0);
    let snapshots: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM payroll_payslip_snapshots")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(snapshots, 2);
    payroll::close(&app, &owner, period(), None).await.unwrap();
    let snapshots_after: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM payroll_payslip_snapshots")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(snapshots, snapshots_after);
}
