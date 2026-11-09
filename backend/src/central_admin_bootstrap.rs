use sqlx::{PgConnection, PgPool, Postgres, Transaction};
use std::error::Error;
use uuid::Uuid;

pub const PRIMARY_EMAIL: &str = "support@trackmyrmc.com";
const PENDING_PASSWORD: &str = "!primary-central-admin-pending!";

pub async fn verify_target_database(
    pool: &PgPool,
    expected_database: &str,
) -> Result<String, Box<dyn Error>> {
    let database: String = sqlx::query_scalar("SELECT current_database()")
        .fetch_one(pool)
        .await?;
    if database != expected_database {
        return Err(format!(
            "Database mismatch: expected {expected_database}, connected to {database}"
        )
        .into());
    }
    let migrations_ready: bool = sqlx::query_scalar(
        "SELECT to_regclass('public.control_center_access') IS NOT NULL
           AND to_regclass('public.user_totp_credentials') IS NOT NULL",
    )
    .fetch_one(pool)
    .await?;
    if !migrations_ready {
        return Err("Required migrations have not been applied".into());
    }
    Ok(database)
}

pub async fn lock_primary(tx: &mut Transaction<'_, Postgres>) -> Result<(), sqlx::Error> {
    sqlx::query("SELECT pg_advisory_xact_lock(15720261108)")
        .execute(&mut **tx)
        .await?;
    Ok(())
}

pub async fn prepare_primary(pool: &PgPool, database: &str) -> Result<(), Box<dyn Error>> {
    verify_target_database(pool, database).await?;
    let mut tx = pool.begin().await?;
    lock_primary(&mut tx).await?;
    let existing: Vec<bool> = sqlx::query_scalar(
        "SELECT COALESCE(email=$1, FALSE) AND role='central_admin'
           FROM users WHERE role='central_admin' OR lower(btrim(email))=$1 FOR UPDATE",
    )
    .bind(PRIMARY_EMAIL)
    .fetch_all(&mut *tx)
    .await?;
    match existing.as_slice() {
        [true] => {
            tx.commit().await?;
            return Ok(());
        }
        [] => {}
        _ => return Err("Conflicting account or Central Admin identity; review required".into()),
    }

    let id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO users(id,phone,email,hashed_password,full_name,role,is_active,is_verified)
         VALUES($1,NULL,$2,$3,'TrackMyRMC Support','central_admin',FALSE,FALSE)",
    )
    .bind(id)
    .bind(PRIMARY_EMAIL)
    .bind(PENDING_PASSWORD)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "INSERT INTO audit_logs(action,resource_type,resource_id,metadata)
         VALUES('control_center.bootstrap.prepare_primary','central_admin',$1,
           jsonb_build_object('database',$2::text,'email',$3::text))",
    )
    .bind(id.to_string())
    .bind(database)
    .bind(PRIMARY_EMAIL)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}

pub async fn pending_primary_id(
    connection: &mut PgConnection,
) -> Result<Option<Uuid>, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT u.id FROM users u
         WHERE u.email=$1 AND u.role='central_admin' AND u.phone IS NULL
           AND u.is_active IS FALSE AND u.is_verified IS FALSE AND u.hashed_password=$2
           AND NOT EXISTS (SELECT 1 FROM control_center_access a WHERE a.user_id=u.id)
           AND NOT EXISTS (SELECT 1 FROM user_totp_credentials t WHERE t.user_id=u.id)
           AND NOT EXISTS (SELECT 1 FROM users other
                            WHERE other.role='central_admin' AND other.id<>u.id)
         FOR UPDATE OF u",
    )
    .bind(PRIMARY_EMAIL)
    .bind(PENDING_PASSWORD)
    .fetch_optional(connection)
    .await
}
