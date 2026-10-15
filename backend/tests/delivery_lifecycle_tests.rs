use sqlx::PgPool;
use trackmyrmc_backend::{
    error::AppError,
    repositories::dispatch_repo,
    services::trip_lifecycle::{advance, TripAction},
};
use uuid::Uuid;

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
    sqlx::query("INSERT INTO stored_files (uploaded_by, file_path, file_name, content_type, file_size_bytes, file_data) VALUES ($1, 'trackmyrmc/pod/test.jpg', 'test.jpg', 'image/jpeg', 3, $2)")
        .bind(driver).bind(vec![1_u8, 2, 3]).execute(pool).await.unwrap();
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
    for load in [first, second] {
        let pod = dispatch_repo::record_pod(
            &pool,
            load,
            driver,
            "Receiver",
            "",
            Some("signature"),
            Some("trackmyrmc/pod/test.jpg"),
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
            Some("trackmyrmc/pod/test.jpg"),
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
