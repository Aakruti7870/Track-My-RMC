//! Exercises the complete embedded SQLx migration chain against the CI PostgreSQL service.
//! The test skips only when DATABASE_URL is absent (for lightweight local unit-test runs).
#[sqlx::test(migrations = false)]
async fn sqlx_07_history_and_application_rows_survive_driver_upgrade(pool: sqlx::PgPool) {
    // Metadata DDL from sqlx-postgres 0.7.4. Populate a previous installation
    // independently of the new migrator, then prove startup is a no-op.
    sqlx::raw_sql(
        "CREATE TABLE _sqlx_migrations (version BIGINT PRIMARY KEY, description TEXT NOT NULL, \
         installed_on TIMESTAMPTZ NOT NULL DEFAULT now(), success BOOLEAN NOT NULL, \
         checksum BYTEA NOT NULL, execution_time BIGINT NOT NULL)",
    )
    .execute(&pool)
    .await
    .unwrap();
    let all = sqlx::migrate!("./migrations");
    for migration in all.iter() {
        sqlx::raw_sql(&migration.sql).execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO _sqlx_migrations(version,description,success,checksum,execution_time) VALUES($1,$2,TRUE,$3,0)")
            .bind(migration.version).bind(migration.description.as_ref()).bind(migration.checksum.as_ref())
            .execute(&pool).await.unwrap();
    }
    let user: uuid::Uuid = sqlx::query_scalar("INSERT INTO users(phone,hashed_password,full_name,role) VALUES('sqlx07-preserved','unused','Preserved Customer','customer') RETURNING id")
        .fetch_one(&pool).await.unwrap();
    let before: Vec<(i64, Vec<u8>, chrono::DateTime<chrono::Utc>, i64)> = sqlx::query_as(
        "SELECT version,checksum,installed_on,execution_time FROM _sqlx_migrations ORDER BY version",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    all.run(&pool).await.unwrap();
    all.run(&pool).await.unwrap();
    let after: Vec<(i64, Vec<u8>, chrono::DateTime<chrono::Utc>, i64)> = sqlx::query_as(
        "SELECT version,checksum,installed_on,execution_time FROM _sqlx_migrations ORDER BY version",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(before, after);
    let name: String = sqlx::query_scalar("SELECT full_name FROM users WHERE id=$1")
        .bind(user)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(name, "Preserved Customer");
    let amount: bigdecimal::BigDecimal = sqlx::query_scalar("SELECT 1234567890.12::NUMERIC")
        .fetch_one(&pool)
        .await
        .unwrap();
    // PostgreSQL numeric wire groups can preserve extra trailing zeroes.
    // Compare the exact decimal value, not an incidental display scale.
    assert_eq!(
        amount,
        "1234567890.12".parse::<bigdecimal::BigDecimal>().unwrap()
    );
}

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
    let expected_versions: Vec<i64> = all
        .iter()
        .filter(|migration| migration.version > 18)
        .map(|migration| migration.version)
        .collect();
    assert_eq!(
        versions, expected_versions,
        "Every available forward migration must apply"
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

/// A previous production deployment may have already applied migration 44
/// before the security PR that introduces 42/43 is merged. Prove SQLx can
/// backfill those pending versions without replaying or altering 44.
#[sqlx::test(migrations = false)]
async fn late_session_migrations_apply_after_existing_rfq_version_44(pool: sqlx::PgPool) {
    use std::borrow::Cow;
    let all = sqlx::migrate!("./migrations");
    assert!(all.iter().any(|migration| migration.version == 44));
    let deployed = sqlx::migrate::Migrator {
        migrations: Cow::Owned(
            all.iter()
                .filter(|migration| !matches!(migration.version, 42 | 43))
                .cloned()
                .collect(),
        ),
        ..sqlx::migrate!("./migrations")
    };
    deployed
        .run(&pool)
        .await
        .expect("simulate production through migration 44");
    let version_44_before: Vec<u8> = sqlx::query_scalar(
        "SELECT checksum FROM _sqlx_migrations WHERE version=44 AND success=TRUE",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(sqlx::query_scalar::<_, Option<i64>>(
        "SELECT version FROM _sqlx_migrations WHERE version=42",
    )
    .fetch_optional(&pool)
    .await
    .unwrap()
    .is_none());

    let customer: uuid::Uuid = sqlx::query_scalar(
        "INSERT INTO users(phone,hashed_password,full_name,role)
         VALUES('late-customer','unused','Preserved late customer','customer') RETURNING id",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let customer_before: (String, String) =
        sqlx::query_as("SELECT full_name,role FROM users WHERE id=$1")
            .bind(customer)
            .fetch_one(&pool)
            .await
            .unwrap();
    let history_before: Vec<(i64, Vec<u8>)> =
        sqlx::query_as("SELECT version,checksum FROM _sqlx_migrations ORDER BY version")
            .fetch_all(&pool)
            .await
            .unwrap();
    all.run(&pool)
        .await
        .expect("pending session and refresh migrations must apply after version 44");
    for version in [42_i64, 43] {
        let applied: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM _sqlx_migrations WHERE version=$1 AND success=TRUE)",
        )
        .bind(version)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert!(applied, "missing backfilled migration {version}");
    }
    let version_44_after: Vec<u8> = sqlx::query_scalar(
        "SELECT checksum FROM _sqlx_migrations WHERE version=44 AND success=TRUE",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(version_44_before, version_44_after);
    let customer_after: (String, String) =
        sqlx::query_as("SELECT full_name,role FROM users WHERE id=$1")
            .bind(customer)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(customer_before, customer_after);
    let history_after: Vec<(i64, Vec<u8>)> = sqlx::query_as(
        "SELECT version,checksum FROM _sqlx_migrations WHERE version NOT IN (42,43) ORDER BY version",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(history_before, history_after);
    let refresh_table_exists: bool =
        sqlx::query_scalar("SELECT to_regclass('public.account_refresh_tokens') IS NOT NULL")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(refresh_table_exists);
    all.run(&pool)
        .await
        .expect("re-running migrations must be idempotent");
}

#[sqlx::test(migrations = false)]
async fn duplicate_slots_abort_upgrade_without_record_loss(pool: sqlx::PgPool) {
    use std::borrow::Cow;
    let all = sqlx::migrate!("./migrations");
    let baseline = sqlx::migrate::Migrator {
        migrations: Cow::Owned(
            all.iter()
                .filter(|migration| !matches!(migration.version, 42 | 43))
                .cloned()
                .collect(),
        ),
        ..sqlx::migrate!("./migrations")
    };
    baseline.run(&pool).await.unwrap();
    let owner: uuid::Uuid = sqlx::query_scalar(
        "INSERT INTO users(phone,hashed_password,full_name,role)
         VALUES('collision-owner','unused','Collision owner','owner') RETURNING id",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let plant: uuid::Uuid = sqlx::query_scalar(
        "INSERT INTO rmc_plants(owner_id,name,code,latitude,longitude,address_line,
         city,state,pincode,contact_phone)
         VALUES($1,'Collision CI','COLLISION-CI',0,0,'CI','CI','MH','0','0') RETURNING id",
    )
    .bind(owner)
    .fetch_one(&pool)
    .await
    .unwrap();
    for phone in ["collision-first", "collision-second"] {
        let staff: uuid::Uuid = sqlx::query_scalar(
            "INSERT INTO users(phone,hashed_password,full_name,role)
             VALUES($1,'unused','Preserved staff','supervisor') RETURNING id",
        )
        .bind(phone)
        .fetch_one(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO plant_staff(plant_id,user_id,role,is_active)
             VALUES($1,$2,'supervisor',FALSE)",
        )
        .bind(plant)
        .bind(staff)
        .execute(&pool)
        .await
        .unwrap();
    }
    assert!(all.run(&pool).await.is_err());
    let retained: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM plant_staff WHERE plant_id=$1 AND role='supervisor'",
    )
    .bind(plant)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(retained, 2);
    let applied: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM _sqlx_migrations WHERE version IN (42,43))",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(!applied);
    let partial_schema: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM information_schema.columns
         WHERE table_schema='public' AND table_name='plant_staff' AND column_name='removed_at')",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(!partial_schema);
}
