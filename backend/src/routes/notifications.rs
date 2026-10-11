use crate::{auth::AuthUser, error::AppError, state::AppState};
use axum::{
    extract::{Path, Query, State},
    response::IntoResponse,
    Json,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;

#[derive(Debug, Deserialize)]
pub struct NotificationFeedQuery {
    pub limit: Option<i64>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct NotificationFeedItem {
    pub id: Uuid,
    pub event: String,
    pub title: String,
    pub body: String,
    pub read: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct RegisterDeviceTokenRequest {
    pub token: String,
    pub platform: String,
    pub app_version: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UnregisterDeviceTokenRequest {
    pub token: String,
}

fn validate_token(raw: &str) -> Result<&str, AppError> {
    let token = raw.trim();
    if token.is_empty()
        || token.len() > 4096
        || token.chars().any(char::is_control)
    {
        return Err(AppError::BadRequest("Invalid device token".to_string()));
    }
    Ok(token)
}

fn validate_platform(raw: &str) -> Result<&str, AppError> {
    match raw {
        "android" | "ios" | "web" => Ok(raw),
        _ => Err(AppError::BadRequest("Unsupported device platform".to_string())),
    }
}

pub async fn list_notifications(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Query(query): Query<NotificationFeedQuery>,
) -> Result<impl IntoResponse, AppError> {
    let limit = query.limit.unwrap_or(50).clamp(1, 100);
    let unread: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND is_read = FALSE",
    )
    .bind(auth_user.user_id)
    .fetch_one(&state.db)
    .await?;

    let items = sqlx::query_as::<_, NotificationFeedItem>(
        r#"
        SELECT id, notification_type AS event, title, body, is_read AS "read", created_at
        FROM notifications
        WHERE user_id = $1
        ORDER BY created_at DESC, id DESC
        LIMIT $2
        "#,
    )
    .bind(auth_user.user_id)
    .bind(limit)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(json!({
        "success": true,
        "unread": unread.0,
        "items": items
    })))
}

pub async fn mark_all_read(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<impl IntoResponse, AppError> {
    let result = sqlx::query(
        "UPDATE notifications SET is_read = TRUE WHERE user_id = $1 AND is_read = FALSE",
    )
    .bind(auth_user.user_id)
    .execute(&state.db)
    .await?;

    Ok(Json(json!({
        "success": true,
        "updated": result.rows_affected()
    })))
}

pub async fn mark_one_read(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(notification_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    let result = sqlx::query(
        "UPDATE notifications SET is_read = TRUE WHERE id = $1 AND user_id = $2",
    )
    .bind(notification_id)
    .bind(auth_user.user_id)
    .execute(&state.db)
    .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("Notification not found".to_string()));
    }

    Ok(Json(json!({ "success": true, "read": true })))
}

pub async fn register_device_token(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Json(payload): Json<RegisterDeviceTokenRequest>,
) -> Result<impl IntoResponse, AppError> {
    let token = validate_token(&payload.token)?;
    let platform = validate_platform(&payload.platform)?;
    let app_version = payload.app_version.as_deref().map(str::trim).filter(|v| !v.is_empty());
    if app_version.is_some_and(|version| version.len() > 50) {
        return Err(AppError::BadRequest("App version must be 50 characters or fewer".to_string()));
    }

    sqlx::query(
        r#"
        INSERT INTO device_push_tokens (user_id, token, platform, app_version)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (token) DO UPDATE
        SET user_id = EXCLUDED.user_id,
            platform = EXCLUDED.platform,
            app_version = EXCLUDED.app_version,
            updated_at = NOW()
        "#,
    )
    .bind(auth_user.user_id)
    .bind(token)
    .bind(platform)
    .bind(app_version)
    .execute(&state.db)
    .await?;

    Ok(Json(json!({ "success": true, "registered": true })))
}

pub async fn unregister_device_token(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Json(payload): Json<UnregisterDeviceTokenRequest>,
) -> Result<impl IntoResponse, AppError> {
    let token = validate_token(&payload.token)?;
    let result = sqlx::query(
        "DELETE FROM device_push_tokens WHERE user_id = $1 AND token = $2",
    )
    .bind(auth_user.user_id)
    .bind(token)
    .execute(&state.db)
    .await?;

    Ok(Json(json!({
        "success": true,
        "unregistered": result.rows_affected() > 0
    })))
}

#[cfg(test)]
mod tests {
    use super::{validate_platform, validate_token};

    #[test]
    fn rejects_empty_or_control_character_tokens() {
        assert!(validate_token("  ").is_err());
        assert!(validate_token("abc\n123").is_err());
    }

    #[test]
    fn trims_and_accepts_bounded_tokens() {
        assert_eq!(validate_token("  device-token  ").unwrap(), "device-token");
        assert!(validate_token(&"x".repeat(4097)).is_err());
    }

    #[test]
    fn only_accepts_supported_platforms() {
        assert_eq!(validate_platform("android").unwrap(), "android");
        assert!(validate_platform("unknown").is_err());
    }
}
