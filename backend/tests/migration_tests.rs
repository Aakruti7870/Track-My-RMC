//! Exercises the complete embedded SQLx migration chain against the CI PostgreSQL service.
//! The test skips only when DATABASE_URL is absent (for lightweight local unit-test runs).
#[sqlx::test(migrations = false)]
async fn existing_installation_upgrades_without_changing_checksums_or_records(pool: sqlx::PgPool) {
    use std::borrow::Cow;
    let all = sqlx::migrate!("./migrations");
    let baseline = sqlx::migrate::Migrator {
        migrations: Cow::Owned(all.iter().filter(|m| m.version <= 18).cloned().collect()),
        ..sqlx::migrate!("./migrations")
    };
    baseline.run(&pool).await.unwrap();
    sqlx::query("INSERT INTO stored_files (file_path,file_name,content_type,file_size_bytes) VALUES ('legacy-photo','legacy.jpg','image/jpeg',42)").execute(&pool).await.unwrap();
    let before: Vec<(i64, Vec<u8>)> =
        sqlx::query_as("SELECT version,checksum FROM _sqlx_migrations ORDER BY version")
            .fetch_all(&pool)
            .await
            .unwrap();
    all.run(&pool).await.unwrap();
    all.run(&pool).await.unwrap();
    let after: Vec<(i64, Vec<u8>)> = sqlx::query_as(
        "SELECT version,checksum FROM _sqlx_migrations WHERE version <= 18 ORDER BY version",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(before, after);
    let legacy: (i64, Option<Vec<u8>>) = sqlx::query_as(
        "SELECT file_size_bytes,file_data FROM stored_files WHERE file_path='legacy-photo'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(legacy, (42, None));
    let versions: Vec<i64> = sqlx::query_scalar(
        "SELECT version FROM _sqlx_migrations WHERE version>18 ORDER BY version",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(
        versions,
        vec![19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32]
    );
}

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
        "play_review_fixtures",
        "play_review_login_attempts",
    ] {
        let exists: bool =
            sqlx::query_scalar("SELECT to_regclass(format('public.%s', $1)) IS NOT NULL")
                .bind(table)
                .fetch_one(&pool)
                .await
                .expect("verify expected migration table");
        assert!(exists, "migration should create {table}");
    }

    pool.close().await;
}
