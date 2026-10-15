use crate::{
    auth::{middleware::check_role, AuthUser},
    error::AppError,
    state::AppState,
};
use axum::{
    extract::{Path, State},
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::Row;
use uuid::Uuid;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PrepareOrderIntentPayload {
    pub order: crate::models::order::CreateOrderRequest,
}

pub async fn prepare_order_intent(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Json(mut payload): Json<PrepareOrderIntentPayload>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["customer"])?;
    if payload.order.save_draft {
        return Err(AppError::BadRequest(
            "Assistant confirmation is for orders, not drafts".into(),
        ));
    }
    let summary =
        crate::services::customer_order::preview(&state, auth_user.user_id, &payload.order).await?;
    let token = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
    let hash = intent_hash(&token);
    // The stored request, not confirmation input, is the authoritative payload.
    if payload.order.idempotency_key.is_none() {
        payload.order.idempotency_key = Some(format!("assistant-{hash}"));
    }
    sqlx::query("INSERT INTO customer_order_intents(token_hash,customer_id,request_payload,preview,expires_at) VALUES($1,$2,$3,$4,NOW()+INTERVAL '5 minutes')")
        .bind(hash).bind(auth_user.user_id).bind(serde_json::to_value(payload.order).map_err(|_|AppError::BadRequest("Invalid order".into()))?).bind(&summary).execute(&state.db).await?;
    Ok(Json(
        json!({"intent_token":token,"summary":summary,"expires_in":300}),
    ))
}

fn intent_hash(token: &str) -> String {
    use sha2::{Digest, Sha256};
    hex::encode(Sha256::digest(token.as_bytes()))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ConfirmOrderIntentPayload {
    pub intent_token: String,
    pub confirmed: bool,
}

pub async fn confirm_order_intent(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Json(payload): Json<ConfirmOrderIntentPayload>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["customer"])?;
    if !payload.confirmed {
        return Err(AppError::BadRequest(
            "Explicit order confirmation is required".into(),
        ));
    }
    let hash = intent_hash(&payload.intent_token);
    let row=sqlx::query("SELECT request_payload,preview,expires_at,confirmed_order_id FROM customer_order_intents WHERE token_hash=$1 AND customer_id=$2")
        .bind(&hash).bind(auth_user.user_id).fetch_optional(&state.db).await?
        .ok_or_else(||AppError::Unauthorized("Order intent is invalid or expired".into()))?;
    let existing: Option<Uuid> = row.get("confirmed_order_id");
    let order = if let Some(id) = existing {
        crate::repositories::order_repo::find_order_by_id(&state.db, id)
            .await?
            .ok_or_else(|| AppError::NotFound("Order not found".into()))?
    } else {
        let expiry: chrono::DateTime<chrono::Utc> = row.get("expires_at");
        if expiry <= chrono::Utc::now() {
            return Err(AppError::Unauthorized(
                "Order intent is invalid or expired".into(),
            ));
        }
        let req = serde_json::from_value(row.get("request_payload")).map_err(|_| {
            AppError::Conflict("Stored order intent requires reconciliation".into())
        })?;
        let order = crate::services::customer_order::place_with_preview(
            &state,
            auth_user.user_id,
            req,
            Some(row.get("preview")),
        )
        .await?;
        sqlx::query("UPDATE customer_order_intents SET confirmed_order_id=$2 WHERE token_hash=$1 AND confirmed_order_id IS NULL")
            .bind(hash).bind(order.id).execute(&state.db).await?;
        order
    };
    Ok(Json(
        json!({"success":true,"id":order.id,"order_id":order.id,"order_number":order.order_number,"order":order}),
    ))
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct CreateSupportCasePayload {
    pub subject: Option<String>,
    pub order_id: Option<Uuid>,
    pub category: Option<String>,
    pub priority: Option<String>,
    pub message: String,
    pub escalate: Option<bool>,
    pub request_id: Option<String>,
}

pub async fn create_support_case(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Json(payload): Json<CreateSupportCasePayload>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["customer"])?;
    let category = payload
        .category
        .as_deref()
        .unwrap_or("GENERAL")
        .to_uppercase();
    let (action, guidance) = crate::services::support_cases::guidance(&category)?;
    let message = crate::services::support_cases::message(&payload.message)?;
    let subject = payload
        .subject
        .as_deref()
        .unwrap_or("Customer support")
        .trim();
    crate::services::support_cases::message(subject)?;
    let priority = payload
        .priority
        .as_deref()
        .unwrap_or("normal")
        .to_lowercase();
    if subject.is_empty()
        || subject.chars().count() > 255
        || !["low", "normal", "high"].contains(&priority.as_str())
        || payload
            .request_id
            .as_ref()
            .is_some_and(|s| !(12..=128).contains(&s.len()))
    {
        return Err(AppError::BadRequest(
            "Invalid support subject, priority or retry identifier".into(),
        ));
    }
    let provenance = json!({"category":category,"subject":subject,"priority":priority,"message":message,"order_id":payload.order_id});
    let mut response = json!({"category":category,"action":action,"guidance":guidance});
    let mut tx = state.db.begin().await?;
    sqlx::query("SELECT id FROM users WHERE id=$1 FOR UPDATE")
        .bind(auth_user.user_id)
        .fetch_one(&mut *tx)
        .await?;
    if let Some(order) = payload.order_id {
        let owned: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM orders WHERE id=$1 AND customer_id=$2)",
        )
        .bind(order)
        .bind(auth_user.user_id)
        .fetch_one(&mut *tx)
        .await?;
        if !owned {
            return Err(AppError::NotFound("Customer order not found".into()));
        }
    }
    if !payload.escalate.unwrap_or(false) {
        return Ok(Json(response));
    }
    if let Some(key) = &payload.request_id {
        let previous=sqlx::query("SELECT id,case_number,status,request_payload FROM support_cases WHERE user_id=$1 AND request_id=$2").bind(auth_user.user_id).bind(key).fetch_optional(&mut *tx).await?;
        if let Some(previous) = previous {
            if previous.get::<Option<serde_json::Value>, _>("request_payload") != Some(provenance) {
                return Err(AppError::Conflict(
                    "Support retry identifier was used for different content".into(),
                ));
            }
            response["case_id"] = json!(previous.get::<Uuid, _>("id"));
            response["case_number"] = json!(previous.get::<String, _>("case_number"));
            response["case_status"] = json!(previous.get::<String, _>("status").to_uppercase());
            return Ok(Json(response));
        }
    }
    let id = Uuid::new_v4();
    let number = format!("SUP-{}", id.simple());
    sqlx::query("INSERT INTO support_cases(id,user_id,order_id,subject,category,priority,status,case_number,request_id,request_payload) VALUES($1,$2,$3,$4,$5,$6,'OPEN',$7,$8,$9)").bind(id).bind(auth_user.user_id).bind(payload.order_id).bind(subject).bind(&category).bind(priority).bind(&number).bind(payload.request_id).bind(provenance).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO support_case_replies(case_id,sender_id,is_staff,message) VALUES($1,$2,FALSE,$3)").bind(id).bind(auth_user.user_id).bind(message).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO audit_logs(user_id,action,resource_type,resource_id,metadata) VALUES($1,'support.case.create','support_case',$2,$3)").bind(auth_user.user_id).bind(id.to_string()).bind(json!({"category":category})).execute(&mut *tx).await?;
    tx.commit().await?;
    response["case_id"] = json!(id);
    response["case_number"] = json!(number);
    response["case_status"] = json!("OPEN");
    Ok(Json(response))
}

pub async fn list_support_cases(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["customer"])?;
    Ok(Json(
        json!({"cases":crate::services::support_cases::list(&state,Some(auth_user.user_id),None).await?}),
    ))
}

pub async fn get_support_case_details(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(case): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["customer"])?;
    let case = crate::services::support_cases::list(&state, Some(auth_user.user_id), Some(case))
        .await?
        .pop()
        .ok_or_else(|| AppError::NotFound("Support case not found".into()))?;
    Ok(Json(json!({"replies":case["messages"],"case":case})))
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct AddReplyPayload {
    pub message: String,
    #[serde(default)]
    pub internal: bool,
}

pub async fn add_case_reply(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(case): Path<Uuid>,
    Json(payload): Json<AddReplyPayload>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["customer"])?;
    crate::services::support_cases::reply(
        &state,
        auth_user.user_id,
        Some(auth_user.user_id),
        case,
        &payload.message,
        payload.internal,
    )
    .await?;
    Ok(Json(json!({"status":"RECEIVED"})))
}

pub async fn list_staff_support_cases(
    State(state): State<AppState>,
    admin: crate::auth::control_center::WebAdmin,
) -> Result<impl IntoResponse, AppError> {
    admin.require("support.view")?;
    Ok(Json(
        json!({"cases":crate::services::support_cases::list(&state,None,None).await?}),
    ))
}

pub async fn get_staff_support_case(
    State(state): State<AppState>,
    admin: crate::auth::control_center::WebAdmin,
    Path(case): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    admin.require("support.view")?;
    let case = crate::services::support_cases::list(&state, None, Some(case))
        .await?
        .pop()
        .ok_or_else(|| AppError::NotFound("Support case not found".into()))?;
    Ok(Json(json!({"case":case})))
}

pub async fn add_staff_case_reply(
    State(state): State<AppState>,
    admin: crate::auth::control_center::WebAdmin,
    Path(case): Path<Uuid>,
    Json(payload): Json<AddReplyPayload>,
) -> Result<impl IntoResponse, AppError> {
    admin.require("support.reply")?;
    crate::services::support_cases::reply(
        &state,
        admin.user_id,
        None,
        case,
        &payload.message,
        payload.internal,
    )
    .await?;
    Ok(Json(json!({"status":"RECEIVED"})))
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct UpdateCaseStatusPayload {
    pub status: String,
}

pub async fn update_case_status(
    State(state): State<AppState>,
    admin: crate::auth::control_center::WebAdmin,
    headers: axum::http::HeaderMap,
    Path(case): Path<Uuid>,
    Json(payload): Json<UpdateCaseStatusPayload>,
) -> Result<impl IntoResponse, AppError> {
    admin.require("support.manage")?;
    super::control_center_routes::require_recent_step_up(&state, &admin, &headers).await?;
    let status = payload.status.to_uppercase();
    if !["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"].contains(&status.as_str()) {
        return Err(AppError::BadRequest("Unsupported support status".into()));
    }
    let mut tx = state.db.begin().await?;
    let previous: String =
        sqlx::query_scalar("SELECT status FROM support_cases WHERE id=$1 FOR UPDATE")
            .bind(case)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or_else(|| AppError::NotFound("Support case not found".into()))?;
    if previous.to_uppercase() != status {
        sqlx::query("UPDATE support_cases SET status=$1,updated_at=NOW() WHERE id=$2")
            .bind(&status)
            .bind(case)
            .execute(&mut *tx)
            .await?;
        sqlx::query("INSERT INTO audit_logs(user_id,action,resource_type,resource_id,metadata) VALUES($1,'support.case.status','support_case',$2,$3)").bind(admin.user_id).bind(case.to_string()).bind(json!({"previous":previous,"status":status})).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(Json(json!({"status":status})))
}
