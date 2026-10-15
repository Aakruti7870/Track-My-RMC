use sqlx::PgPool;
use trackmyrmc_backend::{
    error::AppError,
    repositories::dispatch_repo,
    services::trip_lifecycle::{advance, TripAction},
};
use uuid::Uuid;

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
            first,
            driver,
            "Receiver",
            "",
            Some("signature"),
            Some("trackmyrmc/pod/test.jpg"),
            None,
            7.0
        )
        .await,
        Err(AppError::BadRequest(_))
    ));
    assert!(matches!(
        dispatch_repo::record_pod(
            &pool,
            first,
            driver,
            "Receiver",
            "",
            Some("signature"),
            Some("trackmyrmc/pod/second.jpg"),
            None,
            6.0
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
            first,
            driver,
            "Receiver",
            "",
            Some("signature"),
            Some("trackmyrmc/pod/test.jpg"),
            None,
            6.0
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
            load,
            driver,
            "Receiver",
            "",
            Some("signature"),
            Some(photo),
            None,
            6.0,
        )
        .await
        .unwrap();
        let retry = dispatch_repo::record_pod(
            &pool,
            load,
            driver,
            "Receiver",
            "",
            Some("signature"),
            Some(photo),
            None,
            6.0,
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
            first,
            driver,
            "Changed",
            "",
            Some("signature"),
            Some("trackmyrmc/pod/test.jpg"),
            None,
            6.0
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
