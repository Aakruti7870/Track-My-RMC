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
    let user:uuid::Uuid=sqlx::query_scalar("INSERT INTO users(phone,hashed_password,full_name,role) VALUES('migration-support','unused','Legacy fixture','customer') RETURNING id").fetch_one(&pool).await.unwrap();
    let case:uuid::Uuid=sqlx::query_scalar("INSERT INTO support_cases(user_id,subject) VALUES($1,'Legacy support fixture') RETURNING id").bind(user).fetch_one(&pool).await.unwrap();
    sqlx::query("INSERT INTO stored_files (file_path,file_name,content_type,file_size_bytes) VALUES ('legacy-photo','legacy.jpg','image/jpeg',42)").execute(&pool).await.unwrap();
    let owner:uuid::Uuid=sqlx::query_scalar("INSERT INTO users(phone,hashed_password,full_name,role) VALUES('migration-owner','unused','Legacy owner','owner') RETURNING id").fetch_one(&pool).await.unwrap();
    let plant:uuid::Uuid=sqlx::query_scalar("INSERT INTO rmc_plants(owner_id,name,code,latitude,longitude,address_line,city,state,pincode,contact_phone) VALUES($1,'Legacy','LEGACY-QC',19,73,'Legacy','Legacy','Legacy','0','0') RETURNING id").bind(owner).fetch_one(&pool).await.unwrap();
    let site:uuid::Uuid=sqlx::query_scalar("INSERT INTO customer_sites(customer_id,name,address_line,city,state,pincode,latitude,longitude,contact_person,contact_phone) VALUES($1,'Legacy','Legacy','Legacy','Legacy','0',19,73,'Legacy fixture contact','0000000000') RETURNING id").bind(user).fetch_one(&pool).await.unwrap();
    let order:uuid::Uuid=sqlx::query_scalar("INSERT INTO orders(order_number,customer_id,plant_id,site_id,concrete_grade,total_quantity_m3,delivery_date,delivery_time_slot,total_amount) VALUES('LEGACY-QC',$1,$2,$3,'M25',6,CURRENT_DATE,'10:00',1) RETURNING id").bind(user).bind(plant).bind(site).fetch_one(&pool).await.unwrap();
    let inspection:uuid::Uuid=sqlx::query_scalar("INSERT INTO cube_tests(order_id,sample_date,test_interval_days,test_date,expected_strength_mpa,actual_strength_mpa,passed) VALUES($1,CURRENT_DATE,28,CURRENT_DATE,30,0,TRUE) RETURNING id").bind(order).fetch_one(&pool).await.unwrap();
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
    let number: String = sqlx::query_scalar("SELECT case_number FROM support_cases WHERE id=$1")
        .bind(case)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(number, format!("SUP-{}", case.simple()));
    let compatible:String=sqlx::query_scalar("INSERT INTO support_cases(user_id,subject) VALUES($1,'Old writer compatibility') RETURNING case_number").bind(user).fetch_one(&pool).await.unwrap();
    assert!(compatible.starts_with("SUP-"));
    assert_ne!(number, compatible);
    let preserved:(String,String,bigdecimal::BigDecimal,bigdecimal::BigDecimal,bool)=sqlx::query_as("SELECT result,record_source,expected_strength_mpa,actual_strength_mpa,passed FROM cube_tests WHERE id=$1").bind(inspection).fetch_one(&pool).await.unwrap();
    assert_eq!(
        preserved,
        (
            "PASS".into(),
            "LEGACY_UNVERIFIED".into(),
            30.into(),
            0.into(),
            true
        )
    );
    let versions: Vec<i64> = sqlx::query_scalar(
        "SELECT version FROM _sqlx_migrations WHERE version>18 ORDER BY version",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    let expected_versions: Vec<i64> = all.iter().filter(|migration| migration.version > 18).map(|migration| migration.version).collect();
    assert_eq!(versions, expected_versions, "Every available forward migration must apply");
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
        "google_plant_quote_interests",
        "customer_service_enquiries",
        "driver_employment_profiles",
        "driver_employment_audit",
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
