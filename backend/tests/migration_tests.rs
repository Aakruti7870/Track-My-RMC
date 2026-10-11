//! Exercises the complete embedded SQLx migration chain against the CI PostgreSQL service.
//! The test skips only when DATABASE_URL is absent (for lightweight local unit-test runs).
#[tokio::test]
async fn migrations_apply_from_an_empty_database() {
    let Ok(database_url) = std::env::var("DATABASE_URL") else {
        eprintln!("DATABASE_URL not set; skipping PostgreSQL migration integration test");
        return;
    };

    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(2)
        .connect(&database_url)
        .await
        .expect("connect to migration test database");

    sqlx::migrate!("./migrations")
        .run(&pool)
        .await
        .expect("all migrations must apply in order");

    for table in [
        "account_deletion_requests",
        "device_push_tokens",
        "plant_listing_requests",
    ] {
        let exists: bool = sqlx::query_scalar(
            "SELECT to_regclass(format('public.%s', $1)) IS NOT NULL",
        )
        .bind(table)
        .fetch_one(&pool)
        .await
        .expect("verify expected migration table");
        assert!(exists, "migration should create {table}");
    }

    pool.close().await;
}
