//! On-demand, Central-Admin-only WhatsApp attachment access.
//! Never expose a Meta media URL or bearer token to the browser. Media bytes are
//! not saved in the database, logs, or a public object store. Meta may expire
//! historical media; operators should ask the sender to resend unavailable files.
use crate::{auth::control_center::WebAdmin, error::AppError, state::AppState};
use axum::{
    body::Body,
    extract::{Path, State},
    http::{header, Response},
};
use reqwest::{Client, Url};
use serde_json::Value;
use std::sync::OnceLock;
use tokio::sync::Semaphore;
use uuid::Uuid;

const MAX_META_METADATA: usize = 16 * 1024;
const MAX_MEDIA: usize = 32 * 1024 * 1024;
static DOWNLOAD_SLOTS: OnceLock<Semaphore> = OnceLock::new();

fn valid_media_id(id: &str) -> bool {
    (6..=128).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_digit())
}

pub(crate) fn webhook_media_id(message: &Value) -> Option<&str> {
    let kind = message["type"].as_str()?;
    if !matches!(kind, "image" | "video" | "audio" | "document" | "sticker") {
        return None;
    }
    message[kind]["id"].as_str().filter(|id| valid_media_id(id))
}

fn graph_media_url(version: &str, id: &str) -> Result<Url, AppError> {
    let numbers = version
        .strip_prefix('v')
        .and_then(|x| x.split_once('.'))
        .is_some_and(|(major, minor)| {
            !major.is_empty()
                && !minor.is_empty()
                && major.bytes().all(|b| b.is_ascii_digit())
                && minor.bytes().all(|b| b.is_ascii_digit())
        });
    if !numbers || !valid_media_id(id) {
        return Err(AppError::BadRequest("Invalid Meta media configuration".into()));
    }
    let mut url = Url::parse("https://graph.facebook.com/")
        .map_err(|_| AppError::InternalError("Meta media endpoint unavailable".into()))?;
    url.path_segments_mut()
        .map_err(|_| AppError::InternalError("Meta media endpoint unavailable".into()))?
        .push(version)
        .push(id);
    Ok(url)
}

// Meta provides an ephemeral, signed lookaside URL. Refuse redirects, URLs
// containing userinfo, arbitrary hosts, non-HTTPS schemes, and unrelated paths.
fn allowed_download_url(raw: &str) -> Option<Url> {
    let url = Url::parse(raw).ok()?;
    let host = url.host_str()?;
    (url.scheme() == "https"
        && matches!(host, "lookaside.fbsbx.com" | "lookaside.facebook.com")
        && url.port_or_known_default() == Some(443)
        && url.username().is_empty()
        && url.password().is_none()
        && url.path().starts_with("/whatsapp_business/attachments"))
    .then_some(url)
}

// Only safe-to-render media are displayed inline. Every document, including
// active HTML/SVG content, downloads as application/octet-stream.
fn media_content(kind: &str, raw: &str) -> Option<(&'static str, &'static str, bool)> {
    let mime = raw.split(';').next()?.trim().to_ascii_lowercase();
    match (kind, mime.as_str()) {
        ("image", "image/jpeg") => Some(("image/jpeg", "jpg", true)),
        ("image", "image/png") => Some(("image/png", "png", true)),
        ("image", "image/webp") | ("sticker", "image/webp") => {
            Some(("image/webp", "webp", true))
        }
        ("image", "image/gif") => Some(("image/gif", "gif", true)),
        ("video", "video/mp4") => Some(("video/mp4", "mp4", true)),
        ("video", "video/3gpp") => Some(("video/3gpp", "3gp", true)),
        ("audio", "audio/ogg") => Some(("audio/ogg", "ogg", true)),
        ("audio", "audio/mpeg") => Some(("audio/mpeg", "mp3", true)),
        ("audio", "audio/mp4") => Some(("audio/mp4", "m4a", true)),
        ("audio", "audio/aac") => Some(("audio/aac", "aac", true)),
        ("audio", "audio/amr") => Some(("audio/amr", "amr", true)),
        ("document", _) => Some(("application/octet-stream", "bin", false)),
        _ => None,
    }
}

pub async fn download(
    State(state): State<AppState>,
    admin: WebAdmin,
    Path(message_id): Path<Uuid>,
) -> Result<Response<Body>, AppError> {
    admin.require("support.manage")?;
    let sender = state
        .config
        .meta_whatsapp_phone_number_id
        .as_deref()
        .filter(|s| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit()))
        .ok_or_else(|| AppError::Forbidden("Meta sender not configured".into()))?;
    // The message UUID is NOT a Meta media ID. First enforce the user's
    // authorized inbox scope against PostgreSQL.
    let row: Option<(String, String)> = sqlx::query_as(
        "SELECT kind,media_id FROM admin_whatsapp_messages
         WHERE id=$1 AND sender_phone_id=$2 AND direction='IN'
           AND media_id IS NOT NULL",
    )
    .bind(message_id)
    .bind(sender)
    .fetch_optional(&state.db)
    .await?;
    let (kind, id) = row.ok_or_else(|| AppError::NotFound("Media unavailable".into()))?;
    if !valid_media_id(&id) {
        return Err(AppError::NotFound("Media unavailable".into()));
    }
    let token = state
        .config
        .meta_whatsapp_token
        .as_deref()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::Forbidden("Meta media access not configured".into()))?;

    // Bound simultaneous downloads and avoid buffering arbitrary public URLs.
    let _permit = DOWNLOAD_SLOTS
        .get_or_init(|| Semaphore::new(2))
        .acquire()
        .await
        .map_err(|_| AppError::InternalError("Media service unavailable".into()))?;
    let client = Client::builder()
        .https_only(true)
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(25))
        .build()
        .map_err(|_| AppError::InternalError("Media HTTP service unavailable".into()))?;

    let meta = client
        .get(graph_media_url(&state.config.meta_graph_api_version, &id)?)
        .query(&[("phone_number_id", sender)])
        .bearer_auth(token)
        .send()
        .await
        .map_err(|_| AppError::Conflict("Meta media temporarily unavailable".into()))?;
    if !meta.status().is_success()
        || meta.content_length().is_some_and(|n| n > MAX_META_METADATA as u64)
    {
        return Err(AppError::Conflict("Meta media unavailable; request a resend".into()));
    }
    let metadata = meta
        .bytes()
        .await
        .map_err(|_| AppError::Conflict("Meta media unavailable".into()))?;
    if metadata.len() > MAX_META_METADATA {
        return Err(AppError::Conflict("Invalid Meta media response".into()));
    }
    let info: Value = serde_json::from_slice(&metadata)
        .map_err(|_| AppError::Conflict("Invalid Meta media response".into()))?;
    if info["id"].as_str() != Some(id.as_str()) {
        return Err(AppError::Conflict("Meta media identity mismatch".into()));
    }
    let url = info["url"]
        .as_str()
        .and_then(allowed_download_url)
        .ok_or_else(|| AppError::Conflict("Unsafe Meta media download URL".into()))?;
    let (mime, ext, inline) = info["mime_type"]
        .as_str()
        .and_then(|m| media_content(&kind, m))
        .ok_or_else(|| AppError::Conflict("Media format cannot be safely displayed".into()))?;
    let size = info["file_size"]
        .as_u64()
        .or_else(|| info["file_size"].as_str().and_then(|s| s.parse::<u64>().ok()));
    if size.is_some_and(|n| n > MAX_MEDIA as u64) {
        return Err(AppError::Conflict("Attachment exceeds 32 MB secure preview limit".into()));
    }

    let mut response = client
        .get(url)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|_| AppError::Conflict("Meta attachment expired; request a resend".into()))?;
    if !response.status().is_success()
        || response.content_length().is_some_and(|n| n > MAX_MEDIA as u64)
    {
        return Err(AppError::Conflict("Attachment unavailable or too large".into()));
    }
    // Guard the actual bytes as well; an upstream may omit Content-Length.
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| AppError::Conflict("Incomplete Meta attachment".into()))?
    {
        if bytes.len().saturating_add(chunk.len()) > MAX_MEDIA {
            return Err(AppError::Conflict("Attachment exceeds 32 MB limit".into()));
        }
        bytes.extend_from_slice(&chunk);
    }

    let disposition = if inline { "inline" } else { "attachment" };
    let filename = format!("trackmyrmc-{}.{}", message_id, ext);
    Response::builder()
        .header(header::CONTENT_TYPE, mime)
        .header(header::CACHE_CONTROL, "private, no-store, max-age=0")
        .header(header::CONTENT_DISPOSITION, format!("{disposition}; filename=\"{filename}\""))
        .header("X-Content-Type-Options", "nosniff")
        .header(header::X_FRAME_OPTIONS, "DENY")
        .body(Body::from(bytes))
        .map_err(|_| AppError::InternalError("Media response unavailable".into()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn only_valid_media_ids_can_be_retrieved() {
        assert_eq!(
            webhook_media_id(&json!({"type":"image","image":{"id":"1234567890"}})),
            Some("1234567890")
        );
        for id in ["https://evil.test", "a1b2c3", "123/456", "123"] {
            assert!(webhook_media_id(&json!({"type":"image","image":{"id":id}})).is_none());
        }
        assert!(webhook_media_id(&json!({"type":"text","text":{"id":"1234567890"}})).is_none());
    }
    #[test]
    fn media_url_restricts_ssrf_and_redirect_targets() {
        assert!(allowed_download_url(
            "https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=123"
        ).is_some());
        for bad in [
            "http://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=123",
            "https://evil.com/whatsapp_business/attachments/?mid=123",
            "https://lookaside.fbsbx.com.evil.com/whatsapp_business/attachments/?mid=123",
            "https://user@lookaside.fbsbx.com/whatsapp_business/attachments/?mid=123",
            "https://lookaside.fbsbx.com:8443/whatsapp_business/attachments/?mid=123",
            "https://lookaside.fbsbx.com/admin",
        ] {
            assert!(allowed_download_url(bad).is_none(), "{bad}");
        }
        assert!(graph_media_url("v26.0", "1234567890").is_ok());
        assert!(graph_media_url("v26.0/..", "1234567890").is_err());
    }
    #[test]
    fn documents_are_never_rendered_as_active_content() {
        assert_eq!(
            media_content("document", "text/html"),
            Some(("application/octet-stream", "bin", false))
        );
        assert!(media_content("image", "image/svg+xml").is_none());
        assert!(media_content("video", "text/html").is_none());
        assert_eq!(
            media_content("sticker", "image/webp"),
            Some(("image/webp", "webp", true))
        );
    }
}
