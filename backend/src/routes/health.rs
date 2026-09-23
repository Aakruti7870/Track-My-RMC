use crate::{error::AppError, state::AppState};
use axum::{extract::State, response::IntoResponse, Json};
use chrono::Utc;
use serde::Serialize;

#[derive(Serialize)]
pub struct HealthResponse {
    pub status: &'static str,
    pub database: &'static str,
    pub timestamp: String,
    pub environment: String,
}

pub async fn health_check(State(state): State<AppState>) -> Result<impl IntoResponse, AppError> {
    // Verify DB connectivity
    sqlx::query("SELECT 1")
        .execute(&state.db)
        .await
        .map_err(AppError::DatabaseError)?;

    Ok(Json(HealthResponse {
        status: "ok",
        database: "connected",
        timestamp: Utc::now().to_rfc3339(),
        environment: state.config.environment.clone(),
    }))
}
