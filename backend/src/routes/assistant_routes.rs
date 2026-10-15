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
    let mut tx = state.db.begin().await?;

    let cat = payload
        .category
        .as_deref()
        .unwrap_or("GENERAL")
        .to_uppercase();
    let subj = payload
        .subject
        .unwrap_or_else(|| format!("Support request: {}", cat));

    let case_id: Uuid = sqlx::query_scalar(
        r#"
        INSERT INTO support_cases (user_id, order_id, subject, category, priority, status)
        VALUES ($1, $2, $3, $4, $5, 'open')
        RETURNING id
        "#,
    )
    .bind(auth_user.user_id)
    .bind(payload.order_id)
    .bind(&subj)
    .bind(&cat)
    .bind(payload.priority.as_deref().unwrap_or("normal"))
    .fetch_one(&mut *tx)
    .await?;

    sqlx::query(
        r#"
        INSERT INTO support_case_replies (case_id, sender_id, is_staff, message)
        VALUES ($1, $2, FALSE, $3)
        "#,
    )
    .bind(case_id)
    .bind(auth_user.user_id)
    .bind(&payload.message)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    let case_number = format!("CAS-{:04}", case_id.as_fields().0 % 10000);

    Ok(Json(json!({
        "success": true,
        "case_id": case_id,
        "case_number": case_number,
        "case_status": "open",
        "category": cat,
        "guidance": "Our support team has received your ticket and will assist you shortly.",
        "action": "view_case",
        "message": "Support case opened"
    })))
}

pub async fn list_support_cases(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<impl IntoResponse, AppError> {
    let rows = sqlx::query(
        r#"
        SELECT c.id, c.subject, c.category, c.priority, c.status, c.created_at, c.updated_at,
               o.order_number
        FROM support_cases c
        LEFT JOIN orders o ON o.id = c.order_id
        WHERE c.user_id = $1
        ORDER BY c.updated_at DESC
        "#,
    )
    .bind(auth_user.user_id)
    .fetch_all(&state.db)
    .await?;

    let cases: Vec<_> = rows
        .into_iter()
        .map(|r| {
            let id: Uuid = r.get("id");
            let subject: String = r.get("subject");
            let category: String = r.get("category");
            let priority: String = r.get("priority");
            let status: String = r.get("status");
            let order_number: Option<String> = r.get("order_number");
            let created_at: chrono::DateTime<chrono::Utc> = r.get("created_at");
            let updated_at: chrono::DateTime<chrono::Utc> = r.get("updated_at");
            json!({
                "id": id,
                "subject": subject,
                "category": category,
                "priority": priority,
                "status": status,
                "order_number": order_number,
                "created_at": created_at,
                "updated_at": updated_at
            })
        })
        .collect();

    Ok(Json(json!({ "success": true, "cases": cases })))
}

pub async fn get_support_case_details(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(case_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    let case = sqlx::query(
        r#"
        SELECT c.id, c.user_id, c.subject, c.category, c.priority, c.status, c.created_at, c.updated_at,
               u.full_name as user_name
        FROM support_cases c
        INNER JOIN users u ON u.id = c.user_id
        WHERE c.id = $1
        "#,
    )
    .bind(case_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Case not found".to_string()))?;

    let owner_id: Uuid = case.get("user_id");
    if auth_user.role != "admin" && owner_id != auth_user.user_id {
        return Err(AppError::Forbidden(
            "Unauthorized to view this case".to_string(),
        ));
    }

    let replies = sqlx::query(
        r#"
        SELECT r.id, r.sender_id, r.is_staff, r.message, r.created_at,
               u.full_name as sender_name
        FROM support_case_replies r
        INNER JOIN users u ON u.id = r.sender_id
        WHERE r.case_id = $1
        ORDER BY r.created_at ASC
        "#,
    )
    .bind(case_id)
    .fetch_all(&state.db)
    .await?;

    let cid: Uuid = case.get("id");
    let subject: String = case.get("subject");
    let category: String = case.get("category");
    let priority: String = case.get("priority");
    let status: String = case.get("status");
    let user_name: String = case.get("user_name");
    let created_at: chrono::DateTime<chrono::Utc> = case.get("created_at");
    let updated_at: chrono::DateTime<chrono::Utc> = case.get("updated_at");

    Ok(Json(json!({
        "success": true,
        "case": {
            "id": cid,
            "subject": subject,
            "category": category,
            "priority": priority,
            "status": status,
            "user_name": user_name,
            "created_at": created_at,
            "updated_at": updated_at
        },
        "replies": replies.into_iter().map(|r| {
            let rid: Uuid = r.get("id");
            let sender_id: Uuid = r.get("sender_id");
            let sender_name: String = r.get("sender_name");
            let is_staff: bool = r.get("is_staff");
            let message: String = r.get("message");
            let reply_created_at: chrono::DateTime<chrono::Utc> = r.get("created_at");
            json!({
                "id": rid,
                "sender_id": sender_id,
                "sender_name": sender_name,
                "is_staff": is_staff,
                "message": message,
                "created_at": reply_created_at
            })
        }).collect::<Vec<_>>()
    })))
}

#[derive(Debug, Deserialize, Serialize)]
pub struct AddReplyPayload {
    pub message: String,
}

pub async fn add_case_reply(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(case_id): Path<Uuid>,
    Json(payload): Json<AddReplyPayload>,
) -> Result<impl IntoResponse, AppError> {
    let case_user: Uuid = sqlx::query_scalar("SELECT user_id FROM support_cases WHERE id = $1")
        .bind(case_id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("Case not found".to_string()))?;

    let is_staff = auth_user.role == "admin" || (auth_user.user_id != case_user);

    let mut tx = state.db.begin().await?;

    sqlx::query(
        r#"
        INSERT INTO support_case_replies (case_id, sender_id, is_staff, message)
        VALUES ($1, $2, $3, $4)
        "#,
    )
    .bind(case_id)
    .bind(auth_user.user_id)
    .bind(is_staff)
    .bind(&payload.message)
    .execute(&mut *tx)
    .await?;

    sqlx::query("UPDATE support_cases SET updated_at = NOW() WHERE id = $1")
        .bind(case_id)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;

    Ok(Json(json!({ "success": true, "message": "Reply added" })))
}

pub async fn list_staff_support_cases(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["admin", "owner", "plant_owner", "dispatcher"])?;

    let rows = sqlx::query(
        r#"
        SELECT c.id, c.subject, c.category, c.priority, c.status, c.created_at, c.updated_at,
               u.full_name as customer_name, u.phone as customer_phone
        FROM support_cases c
        INNER JOIN users u ON u.id = c.user_id
        ORDER BY c.updated_at DESC
        "#,
    )
    .fetch_all(&state.db)
    .await?;

    let cases: Vec<_> = rows
        .into_iter()
        .map(|r| {
            let id: Uuid = r.get("id");
            let subject: String = r.get("subject");
            let category: String = r.get("category");
            let priority: String = r.get("priority");
            let status: String = r.get("status");
            let customer_name: String = r.get("customer_name");
            let customer_phone: Option<String> = r.get("customer_phone");
            let created_at: chrono::DateTime<chrono::Utc> = r.get("created_at");
            let updated_at: chrono::DateTime<chrono::Utc> = r.get("updated_at");
            json!({
                "id": id,
                "subject": subject,
                "category": category,
                "priority": priority,
                "status": status,
                "customer_name": customer_name,
                "customer_phone": customer_phone,
                "created_at": created_at,
                "updated_at": updated_at
            })
        })
        .collect();

    Ok(Json(json!({ "success": true, "cases": cases })))
}

#[derive(Debug, Deserialize, Serialize)]
pub struct UpdateCaseStatusPayload {
    pub status: String,
}

pub async fn update_case_status(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(case_id): Path<Uuid>,
    Json(payload): Json<UpdateCaseStatusPayload>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["admin", "owner", "plant_owner"])?;

    sqlx::query("UPDATE support_cases SET status = $1, updated_at = NOW() WHERE id = $2")
        .bind(&payload.status)
        .bind(case_id)
        .execute(&state.db)
        .await?;

    Ok(Json(
        json!({ "success": true, "status": payload.status, "message": "Case status updated" }),
    ))
}
