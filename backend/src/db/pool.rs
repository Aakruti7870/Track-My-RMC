use crate::error::AppError;
use sqlx::postgres::{PgPool, PgPoolOptions};
use std::time::Duration;
use tracing::info;

pub async fn create_pool(database_url: &str) -> Result<PgPool, AppError> {
    info!("Initializing PostgreSQL connection pool...");
    let pool = PgPoolOptions::new()
        .max_connections(20)
        .min_connections(5)
        .acquire_timeout(Duration::from_secs(10))
        .idle_timeout(Duration::from_secs(600))
        .connect(database_url)
        .await
        .map_err(|e| AppError::InternalError(format!("Database migration failed: {e}")))?;

    info!("PostgreSQL connection pool established successfully");
    Ok(pool)
}

pub async fn run_migrations(pool: &PgPool) -> Result<(), AppError> {
    info!("Applying PostgreSQL migrations...");
    sqlx::migrate!("./migrations")
        .run(pool)
        .await
        .map_err(|e| AppError::InternalError(format!("Database migration failed: {e}")))?;
    info!("All database migrations applied successfully");
    Ok(())
}
