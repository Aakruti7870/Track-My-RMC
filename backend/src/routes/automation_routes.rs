use axum::{
    extract::{Path, State},
    http::HeaderMap,
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::Row;
use uuid::Uuid;

use crate::{error::AppError, state::AppState};

fn configured_secret(value: Option<&str>) -> Result<&str, AppError> {
    value
        .filter(|value| value.trim().len() >= 32 && !value.starts_with("test_automation_"))
        .ok_or_else(|| {
            AppError::InternalError("Automation authentication is not configured".into())
        })
}

fn authorize_worker(headers: &HeaderMap, state: &AppState) -> Result<(), AppError> {
    let secret = configured_secret(state.automation_worker_token.as_deref())?;
    let auth_header = headers
        .get("authorization")
        .and_then(|h| h.to_str().ok())
        .unwrap_or("");
    let token = auth_header
        .strip_prefix("Bearer ")
        .unwrap_or(auth_header)
        .trim();

    if token.is_empty() || token != secret {
        return Err(AppError::Unauthorized(
            "Invalid automation worker credentials".to_string(),
        ));
    }
    Ok(())
}

fn authorize_callback(headers: &HeaderMap, state: &AppState) -> Result<(), AppError> {
    let secret = configured_secret(state.automation_callback_token.as_deref())?;
    let token = headers
        .get("x-automation-callback-token")
        .and_then(|h| h.to_str().ok())
        .unwrap_or("");

    if token.is_empty() || token != secret {
        return Err(AppError::Unauthorized(
            "Invalid provider callback credentials".to_string(),
        ));
    }
    Ok(())
}

#[derive(Debug, Deserialize, Serialize)]
pub struct ClaimBody {
    pub worker_id: String,
    pub limit: Option<i64>,
    pub lease_seconds: Option<i64>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct AckBody {
    pub worker_id: String,
    pub lease_token: String,
    pub result: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct FailBody {
    pub worker_id: String,
    pub lease_token: String,
    pub error: String,
    pub retry_after_seconds: Option<i64>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct DeliverBody {
    pub worker_id: String,
    pub lease_token: String,
    pub channels: Option<Vec<String>>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct ProviderCallbackBody {
    pub provider: String,
    pub provider_id: String,
    pub status: String,
    pub failure_reason: Option<String>,
}

pub async fn claim_events(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<ClaimBody>,
) -> Result<impl IntoResponse, AppError> {
    authorize_worker(&headers, &state)?;

    let limit = body.limit.unwrap_or(25).clamp(1, 100);
    let lease_seconds = body.lease_seconds.unwrap_or(120).clamp(30, 900);
    let lease_token = Uuid::new_v4().to_string();

    let rows = sqlx::query(
        r#"
        UPDATE order_automation_events
        SET status = 'PROCESSING',
            worker_id = $1,
            lease_token = $2,
            lease_expires_at = NOW() + ($3 * INTERVAL '1 second'),
            updated_at = NOW()
        WHERE id IN (
            SELECT id FROM order_automation_events
            WHERE status = 'PENDING'
               OR (status = 'PROCESSING' AND lease_expires_at < NOW())
               OR (status = 'RETRY' AND lease_expires_at <= NOW())
            ORDER BY created_at ASC
            LIMIT $4
            FOR UPDATE SKIP LOCKED
        )
        RETURNING id, order_id, event_type, status, routing_key, payload, worker_id, lease_token, attempts, max_attempts
        "#,
    )
    .bind(&body.worker_id)
    .bind(&lease_token)
    .bind(lease_seconds)
    .bind(limit)
    .fetch_all(&state.db)
    .await?;

    let events: Vec<_> = rows
        .into_iter()
        .map(|r| {
            let id: Uuid = r.get("id");
            let order_id: Uuid = r.get("order_id");
            let event_type: String = r.get("event_type");
            let status: String = r.get("status");
            let routing_key: String = r.get("routing_key");
            let payload: serde_json::Value = r.get("payload");
            let w_id: Option<String> = r.get("worker_id");
            let l_tok: Option<String> = r.get("lease_token");
            let attempts: i32 = r.get("attempts");
            let max_attempts: i32 = r.get("max_attempts");

            json!({
                "id": id,
                "order_id": order_id,
                "event_type": event_type,
                "status": status,
                "routing_key": routing_key,
                "payload": payload,
                "worker_id": w_id,
                "lease_token": l_tok,
                "attempts": attempts,
                "max_attempts": max_attempts,
            })
        })
        .collect();

    Ok(Json(json!({ "events": events })))
}

pub async fn get_worker_health(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, AppError> {
    authorize_worker(&headers, &state)?;

    let pending_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM order_automation_events WHERE status = 'PENDING' OR status = 'RETRY'",
    )
    .fetch_one(&state.db)
    .await?;

    let processing_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM order_automation_events WHERE status = 'PROCESSING'",
    )
    .fetch_one(&state.db)
    .await?;

    Ok(Json(json!({
        "worker_name": "order-automation-worker",
        "status": "queue_available",
        "queue_pending": pending_count,
        "queue_processing": processing_count,
        "timestamp": chrono::Utc::now().to_rfc3339()
    })))
}

pub async fn ack_event(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(event_id): Path<Uuid>,
    Json(body): Json<AckBody>,
) -> Result<impl IntoResponse, AppError> {
    authorize_worker(&headers, &state)?;

    let res = sqlx::query(
        r#"
        UPDATE order_automation_events
        SET status = 'COMPLETED',
            updated_at = NOW()
        WHERE id = $1 AND worker_id = $2 AND lease_token = $3 AND status='PROCESSING' AND lease_expires_at>NOW()
        "#,
    )
    .bind(event_id)
    .bind(&body.worker_id)
    .bind(&body.lease_token)
    .execute(&state.db)
    .await?;

    if res.rows_affected() == 0 {
        return Err(AppError::Conflict(
            "Event lease is stale or not owned by this worker".to_string(),
        ));
    }

    Ok(Json(json!({ "status": "completed" })))
}

pub async fn fail_event(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(event_id): Path<Uuid>,
    Json(body): Json<FailBody>,
) -> Result<impl IntoResponse, AppError> {
    authorize_worker(&headers, &state)?;

    let retry_seconds = body.retry_after_seconds.unwrap_or(60).clamp(15, 3600);

    let res = sqlx::query(
        r#"
        UPDATE order_automation_events
        SET attempts = attempts + 1,
            last_error = $1,
            status = CASE WHEN attempts + 1 >= max_attempts THEN 'DEAD_LETTER' ELSE 'RETRY' END,
            lease_expires_at = NOW() + ($2 * INTERVAL '1 second'),
            updated_at = NOW()
        WHERE id = $3 AND worker_id = $4 AND lease_token = $5 AND status='PROCESSING' AND lease_expires_at>NOW()
        "#,
    )
    .bind(&body.error)
    .bind(retry_seconds)
    .bind(event_id)
    .bind(&body.worker_id)
    .bind(&body.lease_token)
    .execute(&state.db)
    .await?;

    if res.rows_affected() == 0 {
        return Err(AppError::Conflict(
            "Event lease is stale or not owned by this worker".to_string(),
        ));
    }

    Ok(Json(json!({ "status": "recorded" })))
}

pub async fn deliver_event(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(event_id): Path<Uuid>,
    Json(body): Json<DeliverBody>,
) -> Result<impl IntoResponse, AppError> {
    authorize_worker(&headers, &state)?;
    let owned:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM order_automation_events WHERE id=$1 AND worker_id=$2 AND lease_token=$3 AND status='PROCESSING' AND lease_expires_at>NOW())")
        .bind(event_id).bind(body.worker_id).bind(body.lease_token).fetch_one(&state.db).await?;
    if !owned {
        return Err(AppError::Conflict(
            "Event lease is stale or not owned by this worker".into(),
        ));
    }
    // No provider adapter is wired here; never turn a lease into fabricated delivery.
    Err::<Json<serde_json::Value>, _>(AppError::Conflict(
        "Automation provider delivery is not configured".into(),
    ))
}

pub async fn provider_callback(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<ProviderCallbackBody>,
) -> Result<impl IntoResponse, AppError> {
    authorize_callback(&headers, &state)?;

    sqlx::query(
        r#"
        INSERT INTO order_automation_attempts (action, provider, provider_id, status, failure_reason)
        VALUES ('PROVIDER_CALLBACK', $1, $2, $3, $4)
        "#,
    )
    .bind(&body.provider)
    .bind(&body.provider_id)
    .bind(&body.status)
    .bind(&body.failure_reason)
    .execute(&state.db)
    .await?;

    Ok(Json(json!({ "status": "recorded" })))
}
