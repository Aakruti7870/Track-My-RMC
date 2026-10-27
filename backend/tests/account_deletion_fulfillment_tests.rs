//! Google Play erasure acceptance: PostgreSQL-only synthetic identities.
//! Never points at production and never uses real user identifiers.
use sqlx::PgPool;
use trackmyrmc_backend::routes::account_deletion::fulfill_eligible_verified_request;
use uuid::Uuid;

async fn create_user(pool: &PgPool, phone: &str, role: &str) -> Uuid {
    sqlx::query_scalar(
        "INSERT INTO users(phone,hashed_password,full_name,role,is_active)
         VALUES ($1,'invalid-fixture-hash','Synthetic Account',$2,TRUE) RETURNING id",
    )
    .bind(phone)
    .bind(role)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn request_for(pool: &PgPool, user_id: Uuid) -> Uuid {
    sqlx::query_scalar(
        "INSERT INTO account_deletion_requests(user_id,identifier_hash,requested_via,status)
         VALUES($1,repeat('a',64),'public_verified','PENDING') RETURNING id",
    )
    .bind(user_id)
    .fetch_one(pool)
    .await
    .unwrap()
}

#[sqlx::test(migrations = "./migrations")]
async fn verified_eligible_customer_is_deleted_with_related_personal_data(pool: PgPool) {
    let actor = create_user(&pool, "qa-admin", "central_admin").await;
    let user = create_user(&pool, "qa-customer", "customer").await;
    sqlx::query("INSERT INTO user_profiles(user_id,kyc_status,address_line) VALUES ($1,'unverified','Synthetic Address')")
        .bind(user).execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO device_push_tokens(user_id,token,platform) VALUES ($1,'synthetic-token','android')")
        .bind(user).execute(&pool).await.unwrap();
    sqlx::query(
        "INSERT INTO notifications(user_id,title,body) VALUES ($1,'Synthetic','Private payload')",
    )
    .bind(user)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query("INSERT INTO audit_logs(user_id,action,resource_type,metadata) VALUES ($1,'test.private','account','{\"phone\":\"test-personal-identifier\"}')")
        .bind(user).execute(&pool).await.unwrap();
    let request_id = request_for(&pool, user).await;
    fulfill_eligible_verified_request(&pool, request_id, actor)
        .await
        .unwrap();

    let still_exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM users WHERE id=$1)")
        .bind(user)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(!still_exists);
    for table in ["user_profiles", "device_push_tokens", "notifications"] {
        // Only trusted, hardcoded fixture table names (no user-supplied SQL).
        let query = format!("SELECT count(*) FROM {table} WHERE user_id=$1");
        let count: i64 = sqlx::query_scalar(&query)
            .bind(user)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 0, "{table} must not retain a deleted identity");
    }
    let status: (String, Option<Uuid>, Option<String>) =
        sqlx::query_as("SELECT status,user_id,reason FROM account_deletion_requests WHERE id=$1")
            .bind(request_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(status.0, "COMPLETED");
    assert_eq!(status.1, None);
    assert_eq!(status.2, None);
    let audit: (Option<Uuid>, serde_json::Value) =
        sqlx::query_as("SELECT user_id,metadata FROM audit_logs WHERE action='test.private'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(audit.0, None);
    assert_eq!(audit.1, serde_json::json!({}));
    assert!(fulfill_eligible_verified_request(&pool, request_id, actor)
        .await
        .is_err());
}

#[sqlx::test(migrations = "./migrations")]
async fn owner_is_not_eligible_and_request_stays_pending(pool: PgPool) {
    let actor = create_user(&pool, "qa-admin-actor", "central_admin").await;
    let owner = create_user(&pool, "qa-owner", "owner").await;
    let id = request_for(&pool, owner).await;
    assert!(fulfill_eligible_verified_request(&pool, id, actor)
        .await
        .is_err());
    let status: String =
        sqlx::query_scalar("SELECT status FROM account_deletion_requests WHERE id=$1")
            .bind(id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(status, "PENDING");
}

#[sqlx::test(migrations = "./migrations")]
async fn driver_with_employment_records_is_not_silently_erased(pool: PgPool) {
    let actor = create_user(&pool, "qa-administrator-2", "central_admin").await;
    let driver = create_user(&pool, "qa-driver", "driver").await;
    let plant: Uuid = sqlx::query_scalar(
        "INSERT INTO rmc_plants(owner_id,name,code,latitude,longitude,address_line,city,state,pincode,contact_phone)
         VALUES($1,'Synthetic','QA-ERASE-PLANT',19,73,'Test','Test','Test','400000','0') RETURNING id",
    ).bind(actor).fetch_one(&pool).await.unwrap();
    sqlx::query("INSERT INTO driver_employment_profiles(plant_id,driver_id,employee_code) VALUES ($1,$2,'QA-DRIVER')")
        .bind(plant).bind(driver).execute(&pool).await.unwrap();
    let id = request_for(&pool, driver).await;
    assert!(fulfill_eligible_verified_request(&pool, id, actor)
        .await
        .is_err());
    let retained: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM users WHERE id=$1)")
        .bind(driver)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(retained);
    let status: String =
        sqlx::query_scalar("SELECT status FROM account_deletion_requests WHERE id=$1")
            .bind(id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(status, "PENDING");
}
