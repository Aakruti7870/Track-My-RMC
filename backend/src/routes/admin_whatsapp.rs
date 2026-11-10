//! Dedicated, privacy-restricted Meta WhatsApp customer inbox for Central Admin.
//! Inbound messages are stored only after the existing HMAC/WABA verification.
//! Replies are optional, manual, 24-hour-window only and never blindly retried.
use crate::{auth::control_center::WebAdmin, error::AppError, state::AppState};
use axum::{
    extract::{Path, State},
    http::HeaderMap,
    Json,
};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

// The Meta transport must never resolve a caller-controlled URL or downgrade
// to cleartext. Path segments are validated before an HTTPS-only request.
pub(crate) fn meta_graph_endpoint(
    version: &str,
    id: &str,
    endpoint: &str,
) -> Result<reqwest::Url, AppError> {
    let numeric_version = version.strip_prefix('v').and_then(|v| v.split_once('.'));
    let version_ok = numeric_version.is_some_and(|(major, minor)| {
        !major.is_empty()
            && !minor.is_empty()
            && major.bytes().all(|c| c.is_ascii_digit())
            && minor.bytes().all(|c| c.is_ascii_digit())
    });
    if !version_ok
        || !(1..=32).contains(&id.len())
        || !id.bytes().all(|c| c.is_ascii_digit())
        || !matches!(endpoint, "messages" | "message_templates")
    {
        return Err(AppError::BadRequest("Invalid Meta Graph endpoint configuration".into()));
    }
    let mut url = reqwest::Url::parse("https://graph.facebook.com/")
        .map_err(|_| AppError::InternalError("Meta Graph HTTPS endpoint unavailable".into()))?;
    {
        let mut segments = url.path_segments_mut()
            .map_err(|_| AppError::InternalError("Meta Graph path unavailable".into()))?;
        segments.push(version).push(id).push(endpoint);
    }
    Ok(url)
}

fn configured_sender(state: &AppState) -> Result<&str, AppError> {
    state
        .config
        .meta_whatsapp_phone_number_id
        .as_deref()
        .filter(|s| !s.is_empty() && s.bytes().all(|c| c.is_ascii_digit()))
        .ok_or_else(|| AppError::BadRequest("Meta sender is not configured".into()))
}

fn valid_phone(value: &str) -> bool {
    (8..=15).contains(&value.len())
        && !value.starts_with('0')
        && value.bytes().all(|c| c.is_ascii_digit())
}
fn valid_message_id(value: &str) -> bool {
    value.starts_with("wamid.") && value.len() <= 200
}
fn safe_text(text: &str) -> String {
    text.chars().filter(|c| *c != '\0').take(4096).collect()
}
fn provider_message_time(message: &Value) -> DateTime<Utc> {
    let seconds = message["timestamp"]
        .as_str()
        .and_then(|s| s.parse::<i64>().ok());
    seconds
        .and_then(|s| DateTime::<Utc>::from_timestamp(s, 0))
        .filter(|dt| *dt <= Utc::now() + chrono::Duration::minutes(5))
        .unwrap_or_else(|| Utc::now() - chrono::Duration::hours(25))
}
fn preview(message: &Value) -> (&str, String) {
    match message["type"].as_str().unwrap_or("") {
        "text" => (
            "text",
            safe_text(message["text"]["body"].as_str().unwrap_or("")),
        ),
        "button" => (
            "button",
            safe_text(message["button"]["text"].as_str().unwrap_or("")),
        ),
        "interactive" => (
            "interactive",
            safe_text(
                message["interactive"]["button_reply"]["title"]
                    .as_str()
                    .or_else(|| message["interactive"]["list_reply"]["title"].as_str())
                    .unwrap_or("[Interactive reply]"),
            ),
        ),
        "image" => (
            "image",
            "[Image received; media not stored in Admin inbox]".into(),
        ),
        "video" => (
            "video",
            "[Video received; media not stored in Admin inbox]".into(),
        ),
        "audio" => (
            "audio",
            "[Audio received; media not stored in Admin inbox]".into(),
        ),
        "document" => (
            "document",
            "[Document received; media not stored in Admin inbox]".into(),
        ),
        _ => ("other", "[Unsupported WhatsApp message type]".into()),
    }
}
pub async fn ingest_verified_message(
    state: &AppState,
    recipient_id: &str,
    message: &Value,
) -> Result<(), AppError> {
    if configured_sender(state)? != recipient_id {
        return Ok(());
    }
    let Some(id) = message["id"].as_str().filter(|s| valid_message_id(s)) else {
        return Ok(());
    };
    let Some(from) = message["from"].as_str().filter(|s| valid_phone(s)) else {
        return Ok(());
    };
    let (kind, body) = preview(message);
    let received_at = provider_message_time(message);
    sqlx::query(
        "INSERT INTO admin_whatsapp_messages
          (provider_message_id,sender_phone_id,customer_phone,direction,kind,body,status,received_at)
         VALUES ($1,$2,$3,'IN',$4,$5,'received',$6)
         ON CONFLICT (provider_message_id) DO NOTHING"
    ).bind(id).bind(recipient_id).bind(from).bind(kind).bind(body)
        .bind(received_at).execute(&state.db).await?;
    Ok(())
}
pub async fn mark_verified_status(
    state: &AppState,
    provider_id: &str,
    status: &str,
) -> Result<(), AppError> {
    if !valid_message_id(provider_id) || !matches!(status, "sent" | "delivered" | "read" | "failed")
    {
        return Ok(());
    }
    // Late out-of-order callbacks cannot downgrade delivered/read states.
    sqlx::query(
        "UPDATE admin_whatsapp_messages SET status=$2
         WHERE provider_message_id=$1 AND direction='OUT'
           AND (CASE status WHEN 'read' THEN 4 WHEN 'delivered' THEN 3
                WHEN 'sent' THEN 2 WHEN 'accepted' THEN 1 ELSE 0 END)
           < (CASE $2 WHEN 'read' THEN 4 WHEN 'delivered' THEN 3
                WHEN 'sent' THEN 2 WHEN 'accepted' THEN 1 ELSE 0 END)
           AND (status NOT IN ('delivered','read') OR $2 NOT IN ('failed'))",
    )
    .bind(provider_id)
    .bind(status)
    .execute(&state.db)
    .await?;
    Ok(())
}
pub async fn stats(
    State(state): State<AppState>,
    admin: WebAdmin,
) -> Result<Json<Value>, AppError> {
    admin.require("support.manage")?;
    let sender = configured_sender(&state)?;
    let counts: Value = sqlx::query_scalar(
        "SELECT jsonb_build_object(
          'conversations',COUNT(DISTINCT customer_phone),
          'unread',COUNT(*) FILTER (WHERE direction='IN' AND read_at IS NULL),
          'incoming_today',COUNT(*) FILTER (WHERE direction='IN' AND received_at>=NOW()-INTERVAL '1 day'))
         FROM admin_whatsapp_messages WHERE sender_phone_id=$1"
    ).bind(sender).fetch_one(&state.db).await?;
    Ok(Json(json!({"counts":counts,
        "replies_enabled":std::env::var("ADMIN_WHATSAPP_REPLIES_ENABLED").ok().as_deref()==Some("true")})))
}
pub async fn chats(
    State(state): State<AppState>,
    admin: WebAdmin,
) -> Result<Json<Value>, AppError> {
    admin.require("support.manage")?;
    let sender = configured_sender(&state)?;
    let threads: Vec<Value> = sqlx::query_scalar(
        "SELECT jsonb_build_object('phone',c.customer_phone,
           'latest_body',c.body,'latest_at',c.received_at,
           'latest_direction',c.direction,
           'unread',(SELECT COUNT(*) FROM admin_whatsapp_messages m
             WHERE m.sender_phone_id=c.sender_phone_id AND m.customer_phone=c.customer_phone
             AND m.direction='IN' AND m.read_at IS NULL),
           'last_inbound',(SELECT MAX(m.received_at) FROM admin_whatsapp_messages m
             WHERE m.sender_phone_id=c.sender_phone_id AND m.customer_phone=c.customer_phone AND m.direction='IN'))
         FROM (SELECT DISTINCT ON (sender_phone_id,customer_phone)
            sender_phone_id,customer_phone,body,received_at,direction,id
            FROM admin_whatsapp_messages WHERE sender_phone_id=$1
            ORDER BY sender_phone_id,customer_phone,received_at DESC,id DESC) c
         ORDER BY c.received_at DESC LIMIT 100"
    ).bind(sender).fetch_all(&state.db).await?;
    Ok(Json(json!({"threads":threads})))
}
pub async fn messages(
    State(state): State<AppState>,
    admin: WebAdmin,
    Path(phone): Path<String>,
) -> Result<Json<Value>, AppError> {
    admin.require("support.manage")?;
    if !valid_phone(&phone) {
        return Err(AppError::BadRequest("Invalid WhatsApp phone".into()));
    }
    let sender = configured_sender(&state)?;
    let items: Vec<Value> = sqlx::query_scalar(
        "SELECT jsonb_build_object('id',m.id,'direction',m.direction,
           'kind',m.kind,'body',m.body,'status',m.status,'at',m.received_at)
         FROM (SELECT * FROM admin_whatsapp_messages
           WHERE sender_phone_id=$1 AND customer_phone=$2
           ORDER BY received_at DESC,id DESC LIMIT 100) m
         ORDER BY m.received_at,m.id",
    )
    .bind(sender)
    .bind(&phone)
    .fetch_all(&state.db)
    .await?;
    let can_reply: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM admin_whatsapp_messages
          WHERE sender_phone_id=$1 AND customer_phone=$2 AND direction='IN'
            AND received_at > NOW()-INTERVAL '24 hours'
            AND received_at <= NOW()+INTERVAL '5 minutes')",
    )
    .bind(sender)
    .bind(&phone)
    .fetch_one(&state.db)
    .await?;
    Ok(Json(json!({"phone":phone,"messages":items,
       "within_customer_service_window":can_reply,
       "replies_enabled":std::env::var("ADMIN_WHATSAPP_REPLIES_ENABLED").ok().as_deref()==Some("true")})))
}
pub async fn mark_read(
    State(state): State<AppState>,
    admin: WebAdmin,
    Path(phone): Path<String>,
) -> Result<Json<Value>, AppError> {
    admin.require("support.manage")?;
    if !valid_phone(&phone) {
        return Err(AppError::BadRequest("Invalid WhatsApp phone".into()));
    }
    let sender = configured_sender(&state)?;
    sqlx::query(
        "UPDATE admin_whatsapp_messages SET read_at=NOW()
        WHERE sender_phone_id=$1 AND customer_phone=$2 AND direction='IN' AND read_at IS NULL",
    )
    .bind(sender)
    .bind(phone)
    .execute(&state.db)
    .await?;
    Ok(Json(json!({"success":true})))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Reply {
    pub message: String,
    pub request_id: Uuid,
}
pub async fn reply(
    State(state): State<AppState>,
    admin: WebAdmin,
    headers: HeaderMap,
    Path(phone): Path<String>,
    Json(body): Json<Reply>,
) -> Result<Json<Value>, AppError> {
    admin.require("support.manage")?;
    if std::env::var("ADMIN_WHATSAPP_REPLIES_ENABLED")
        .ok()
        .as_deref()
        != Some("true")
    {
        return Err(AppError::Forbidden(
            "WhatsApp replies are not activated".into(),
        ));
    }
    if !valid_phone(&phone) {
        return Err(AppError::BadRequest("Invalid WhatsApp phone".into()));
    }
    let text = body.message.trim();
    if text.is_empty() || text.chars().count() > 1000 || text.contains('\0') {
        return Err(AppError::BadRequest(
            "Reply must be 1–1000 characters".into(),
        ));
    }
    let sender = configured_sender(&state)?;
    let sender = sender.to_string();
    let token = state
        .config
        .meta_whatsapp_token
        .as_deref()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::Forbidden("Meta sender token unavailable".into()))?;
    crate::routes::control_center_routes::require_recent_step_up(&state, &admin, &headers).await?;
    // No template-free outbound after the Meta 24h customer-service window.
    let in_window: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM admin_whatsapp_messages
         WHERE sender_phone_id=$1 AND customer_phone=$2 AND direction='IN'
           AND received_at > NOW()-INTERVAL '24 hours'
           AND received_at <= NOW()+INTERVAL '5 minutes')",
    )
    .bind(&sender)
    .bind(&phone)
    .fetch_one(&state.db)
    .await?;
    if !in_window {
        return Err(AppError::Forbidden(
            "Customer service window closed: wait for another customer message".into(),
        ));
    }
    let already: Option<String> =
        sqlx::query_scalar("SELECT status FROM admin_whatsapp_messages WHERE request_id=$1")
            .bind(body.request_id)
            .fetch_optional(&state.db)
            .await?;
    if let Some(status) = already {
        return Ok(Json(json!({"status":status,"repeated_request":true})));
    }
    let allowed: bool = sqlx::query_scalar(
        "SELECT (SELECT COUNT(*) FROM admin_whatsapp_messages
          WHERE direction='OUT' AND sender_phone_id=$1 AND received_at>NOW()-INTERVAL '1 day') < 100
         AND (SELECT COUNT(*) FROM admin_whatsapp_messages
          WHERE direction='OUT' AND sender_phone_id=$1 AND customer_phone=$2
          AND received_at>NOW()-INTERVAL '1 hour') < 10",
    )
    .bind(&sender)
    .bind(&phone)
    .fetch_one(&state.db)
    .await?;
    if !allowed {
        return Err(AppError::RateLimited(
            "Manual inbox reply limit reached".into(),
        ));
    }
    let url = meta_graph_endpoint(
        &state.config.meta_graph_api_version,
        &sender,
        "messages",
    )?;
    // Reserve before I/O: unknown provider result must never be automatically sent again.
    sqlx::query(
        "INSERT INTO admin_whatsapp_messages
           (sender_phone_id,customer_phone,direction,kind,body,status,operator_id,request_id)
         VALUES($1,$2,'OUT','text',$3,'uncertain',$4,$5)
         ON CONFLICT (request_id) DO NOTHING",
    )
    .bind(&sender)
    .bind(&phone)
    .bind(text)
    .bind(admin.user_id)
    .bind(body.request_id)
    .execute(&state.db)
    .await?;
    let client = reqwest::Client::builder()
        .https_only(true)
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|_| AppError::InternalError("HTTP client unavailable".into()))?;
    let response = client
        .post(url)
        .bearer_auth(token)
        .json(&json!({
            "messaging_product":"whatsapp","recipient_type":"individual","to":phone,
            "type":"text","text":{"preview_url":false,"body":text}
        }))
        .send()
        .await;
    let (status, id) = match response {
        Ok(value) if value.status().is_success() => {
            let data: Value = value.json().await.unwrap_or(Value::Null);
            match data["messages"][0]["id"]
                .as_str()
                .filter(|s| valid_message_id(s))
            {
                Some(id) => ("accepted", Some(id.to_string())),
                None => ("uncertain", None),
            }
        }
        Ok(value) if value.status().is_client_error() => ("failed", None),
        _ => ("uncertain", None),
    };
    sqlx::query(
        "UPDATE admin_whatsapp_messages SET status=$2,provider_message_id=$3
         WHERE request_id=$1 AND status='uncertain'",
    )
    .bind(body.request_id)
    .bind(status)
    .bind(id)
    .execute(&state.db)
    .await?;
    sqlx::query(
        "INSERT INTO audit_logs(user_id,action,resource_type,resource_id,metadata)
        VALUES($1,'admin.whatsapp.reply','whatsapp_message',$2,$3)",
    )
    .bind(admin.user_id)
    .bind(body.request_id.to_string())
    .bind(json!({"status":status,"message_body_logged":false}))
    .execute(&state.db)
    .await?;
    Ok(Json(json!({"status":status,"request_id":body.request_id})))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_invalid_customer_phone() {
        assert!(valid_phone("919876543210"));
        assert!(!valid_phone("919876543210;DROP"));
        assert!(!valid_phone("00000000000"));
    }
    #[test]
    fn does_not_persist_media_or_unsupported_payloads() {
        let media_message = json!({"type":"image","image":{"id":"secret"}});
        let (kind, text) = preview(&media_message);
        assert_eq!(kind, "image");
        assert!(!text.contains("secret"));
        assert_eq!(safe_text("a\u{0}b"), "ab");
    }
    #[test]
    fn meta_graph_api_rejects_cleartext_or_untrusted_destinations() {
        let url = meta_graph_endpoint("v24.0", "1234567890", "messages")
            .expect("valid Meta messages endpoint");
        assert_eq!(url.as_str(), "https://graph.facebook.com/v24.0/1234567890/messages");
        assert_eq!(url.host_str(), Some("graph.facebook.com"));
        let templates = meta_graph_endpoint("v24.0", "1234567890", "message_templates")
            .expect("valid Meta templates endpoint");
        assert_eq!(templates.scheme(), "https");
        assert!(meta_graph_endpoint("http://evil.example", "1234567890", "messages").is_err());
        assert!(meta_graph_endpoint("v24.0", "12345/../../attacker", "messages").is_err());
        assert!(meta_graph_endpoint("v24.0", "1234567890", "redirect").is_err());
    }
    #[test]
    fn invalid_future_timestamp_never_extends_reply_window() {
        let dt = provider_message_time(&json!({"timestamp":"99999999999"}));
        assert!(dt < Utc::now() - chrono::Duration::hours(24));
    }
}
