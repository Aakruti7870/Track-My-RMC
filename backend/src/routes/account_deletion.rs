use crate::{auth::AuthUser, error::AppError, state::AppState};
use axum::{extract::State, response::IntoResponse, Json};
use serde::Deserialize;
use serde_json::json;

#[derive(Debug, Deserialize)]
pub struct RequestDeletionPayload {
    pub confirm: String,
    pub reason: Option<String>,
}

pub async fn status(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<impl IntoResponse, AppError> {
    let request = sqlx::query_as::<_, (uuid::Uuid, String, Option<String>, chrono::DateTime<chrono::Utc>, Option<chrono::DateTime<chrono::Utc>>)>(
        "SELECT id, status, reason, created_at, completed_at
         FROM account_deletion_requests
         WHERE user_id = $1
         ORDER BY created_at DESC LIMIT 1"
    )
    .bind(auth_user.user_id)
    .fetch_optional(&state.db)
    .await?
    .map(|(id, status, reason, created_at, completed_at)| json!({
        "id": id,
        "status": status,
        "reason": reason,
        "created_at": created_at,
        "completed_at": completed_at
    }));

    Ok(Json(json!({ "request": request })))
}

pub async fn request(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Json(payload): Json<RequestDeletionPayload>,
) -> Result<impl IntoResponse, AppError> {
    if payload.confirm.trim() != "DELETE" {
        return Err(AppError::BadRequest("Type DELETE to confirm account deletion".to_string()));
    }
    if payload.reason.as_deref().is_some_and(|reason| reason.chars().count() > 1000) {
        return Err(AppError::BadRequest(
            "Deletion request reason must be 1000 characters or fewer.".to_string(),
        ));
    }

    // Do not let a plant owner orphan active plants. They must transfer or deactivate them first.
    if auth_user.role == "owner" {
        let active_plants: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM rmc_plants WHERE owner_id = $1"
        )
        .bind(auth_user.user_id)
        .fetch_one(&state.db)
        .await?;
        if active_plants > 0 {
            return Err(AppError::Conflict(
                "Transfer ownership of all your plants before requesting account deletion.".to_string()
            ));
        }
    }

    let inserted = sqlx::query_as::<_, (uuid::Uuid, String, Option<String>, chrono::DateTime<chrono::Utc>, Option<chrono::DateTime<chrono::Utc>>)>(
        "INSERT INTO account_deletion_requests (user_id, reason)
         VALUES ($1, $2)
         ON CONFLICT (user_id) WHERE status = 'PENDING' DO NOTHING
         RETURNING id, status, reason, created_at, completed_at"
    )
    .bind(auth_user.user_id)
    .bind(payload.reason.as_deref().map(str::trim).filter(|s| !s.is_empty()))
    .fetch_optional(&state.db)
    .await?;

    let request = match inserted {
        Some((id, status, reason, created_at, completed_at)) => json!({
            "id": id, "status": status, "reason": reason,
            "created_at": created_at, "completed_at": completed_at
        }),
        None => return Err(AppError::Conflict("A deletion request is already pending for this account.".to_string())),
    };

    Ok(Json(json!({
        "success": true,
        "message": "Deletion request recorded for review. Data is not deleted automatically.",
        "request": request
    })))
}

pub async fn cancel(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<impl IntoResponse, AppError> {
    let updated = sqlx::query(
        "UPDATE account_deletion_requests
         SET status = 'CANCELLED', updated_at = NOW()
         WHERE user_id = $1 AND status = 'PENDING'"
    )
    .bind(auth_user.user_id)
    .execute(&state.db)
    .await?;

    if updated.rows_affected() == 0 {
        return Err(AppError::Conflict("No pending deletion request can be cancelled.".to_string()));
    }

    Ok(Json(json!({ "success": true, "message": "Deletion request cancelled." })))
}
