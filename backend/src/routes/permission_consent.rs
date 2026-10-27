use crate::{auth::AuthUser, error::AppError, state::AppState};
use axum::{extract::State, Json};
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Deserialize)]
pub struct Consent {
    version: i32,
    location_choice: String,
    notification_choice: String,
    #[serde(default = "manual_camera_choice")]
    camera_choice: String,
}

fn manual_camera_choice() -> String {
    "manual".to_owned()
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
    if ![1, 2].contains(&input.version)
        || !valid(&input.location_choice)
        || !valid(&input.notification_choice)
        || !valid(&input.camera_choice)
    {
        return Err(AppError::BadRequest("Invalid consent decision".into()));
    }
    sqlx::query("INSERT INTO user_permission_consent(user_id,version,location_choice,notification_choice,camera_choice) VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id) DO UPDATE SET version=EXCLUDED.version,location_choice=EXCLUDED.location_choice,notification_choice=EXCLUDED.notification_choice,camera_choice=EXCLUDED.camera_choice,updated_at=NOW()")
        .bind(user.user_id).bind(input.version).bind(input.location_choice).bind(input.notification_choice).bind(input.camera_choice).execute(&state.db).await?;
    Ok(Json(json!({"success":true})))
}
