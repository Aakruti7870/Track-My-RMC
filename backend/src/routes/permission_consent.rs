use crate::{auth::AuthUser, error::AppError, state::AppState};
use axum::{extract::State, Json};
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Deserialize)]
pub struct Consent {
    version: i32,
    location_choice: String,
    notification_choice: String,
}

pub async fn get(State(state): State<AppState>, user: AuthUser) -> Result<Json<Value>, AppError> {
    let consent: Option<Value> = sqlx::query_scalar(
        "SELECT to_jsonb(c)-'user_id' FROM user_permission_consent c WHERE user_id=$1",
    )
    .bind(user.user_id)
    .fetch_optional(&state.db)
    .await?;
    Ok(Json(json!({"consent":consent})))
}

pub async fn save(
    State(state): State<AppState>,
    user: AuthUser,
    Json(input): Json<Consent>,
) -> Result<Json<Value>, AppError> {
    let valid = |s: &str| {
        matches!(
            s,
            "granted" | "denied" | "manual" | "unavailable" | "undetermined"
        )
    };
    if input.version != 1 || !valid(&input.location_choice) || !valid(&input.notification_choice) {
        return Err(AppError::BadRequest("Invalid consent decision".into()));
    }
    sqlx::query("INSERT INTO user_permission_consent(user_id,version,location_choice,notification_choice) VALUES($1,$2,$3,$4) ON CONFLICT(user_id) DO UPDATE SET version=EXCLUDED.version,location_choice=EXCLUDED.location_choice,notification_choice=EXCLUDED.notification_choice,updated_at=NOW()")
        .bind(user.user_id).bind(input.version).bind(input.location_choice).bind(input.notification_choice).execute(&state.db).await?;
    Ok(Json(json!({"success":true})))
}
