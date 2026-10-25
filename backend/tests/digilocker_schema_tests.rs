//! Exercise staged DigiLocker schema against SQLx's disposable PostgreSQL test database.
//! Never run against the production database or copy real identity documents.
use sqlx::{PgPool, Row};
use uuid::Uuid;

const STAGED_SCHEMA: &str =
    include_str!("../../ops/pending-migrations/customer_digilocker_sessions.sql");

async fn customer(db: &PgPool) -> Uuid {
    let phone = format!("kyc{}", &Uuid::new_v4().simple().to_string()[..14]);
    sqlx::query_scalar(
        "INSERT INTO users(phone, hashed_password, full_name, role)
         VALUES($1,'unused','Sandbox QA Customer','customer') RETURNING id",
    )
    .bind(phone)
    .fetch_one(db)
    .await
    .unwrap()
}

#[sqlx::test]
async fn staged_kyc_schema_enforces_single_active_session_per_customer(db: PgPool) {
    sqlx::raw_sql(STAGED_SCHEMA).execute(&db).await.unwrap();
    let first_customer = customer(&db).await;
    let other_customer = customer(&db).await;

    let first_session: Uuid = sqlx::query_scalar(
        "INSERT INTO customer_digilocker_sessions(user_id)
         VALUES($1) RETURNING id",
    )
    .bind(first_customer)
    .fetch_one(&db)
    .await
    .unwrap();

    let duplicate = sqlx::query("INSERT INTO customer_digilocker_sessions(user_id) VALUES($1)")
        .bind(first_customer)
        .execute(&db)
        .await;
    assert!(duplicate.is_err(), "second active session must be denied");

    sqlx::query("UPDATE customer_digilocker_sessions SET status='PENDING' WHERE id=$1")
        .bind(first_session)
        .execute(&db)
        .await
        .unwrap();

    sqlx::query("INSERT INTO customer_digilocker_sessions(user_id) VALUES($1)")
        .bind(first_customer)
        .execute(&db)
        .await
        .unwrap();
    sqlx::query("INSERT INTO customer_digilocker_sessions(user_id) VALUES($1)")
        .bind(other_customer)
        .execute(&db)
        .await
        .unwrap();

    let count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM customer_digilocker_sessions WHERE user_id=$1")
            .bind(first_customer)
            .fetch_one(&db)
            .await
            .unwrap();
    assert_eq!(count, 2);
}

#[sqlx::test]
async fn staged_kyc_schema_rejects_unexpected_states_and_duplicate_provider_ids(db: PgPool) {
    sqlx::raw_sql(STAGED_SCHEMA).execute(&db).await.unwrap();
    let first_customer = customer(&db).await;
    let second_customer = customer(&db).await;

    let id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO customer_digilocker_sessions(user_id,provider_session_id)
         VALUES($1,$2)",
    )
    .bind(first_customer)
    .bind(id)
    .execute(&db)
    .await
    .unwrap();

    assert!(
        sqlx::query(
            "INSERT INTO customer_digilocker_sessions(user_id,provider_session_id)
             VALUES($1,$2)",
        )
        .bind(second_customer)
        .bind(id)
        .execute(&db)
        .await
        .is_err(),
        "same provider session may not belong to two users"
    );

    assert!(
        sqlx::query(
            "INSERT INTO customer_digilocker_sessions(user_id,status)
             VALUES($1,'VERIFIED')",
        )
        .bind(second_customer)
        .execute(&db)
        .await
        .is_err(),
        "provider session must never imply an approved KYC status"
    );
    let rows = sqlx::query("SELECT status FROM customer_digilocker_sessions WHERE user_id=$1")
        .bind(first_customer)
        .fetch_all(&db)
        .await
        .unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].get::<String, _>("status"), "STARTING");
}
