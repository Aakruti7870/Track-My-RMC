use crate::{auth::AuthUser, error::AppError, state::AppState};
use axum::{
    extract::{Multipart, Path, State},
    http::header,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;
use uuid::Uuid;


// Uploaded filename and MIME metadata are untrusted. Use an allowlisted
// extension for the generated storage key, never unescaped user input.
const MAX_UPLOAD_NAME_BYTES: usize = 255;
const MAX_UPLOAD_PURPOSE_BYTES: usize = 32;
const MAX_UPLOAD_CONTENT_TYPE_BYTES: usize = 127;

fn checked_upload_filename(value: Option<String>) -> Result<String, AppError> {
    let name = value.unwrap_or_else(|| "file.bin".to_owned());
    if name.is_empty()
        || name.len() > MAX_UPLOAD_NAME_BYTES
        || name.chars().any(|c| c.is_control() || matches!(c, '/' | '\\'))
        || name == "." || name == ".."
    {
        return Err(AppError::BadRequest("Invalid upload filename".into()));
    }
    Ok(name)
}

fn safe_upload_extension(name: &str) -> &'static str {
    let extension = name.rsplit_once('.').map(|(_, extension)| extension).unwrap_or("");
    match extension.to_ascii_lowercase().as_str() {
        "jpg" => "jpg",
        "jpeg" => "jpeg",
        "png" => "png",
        "webp" => "webp",
        "heic" => "heic",
        "heif" => "heif",
        "gif" => "gif",
        "pdf" => "pdf",
        "txt" => "txt",
        "csv" => "csv",
        _ => "bin",
    }
}

fn checked_upload_content_type(value: &str) -> Result<(), AppError> {
    let mut parts = value.split('/');
    let major = parts.next().unwrap_or("");
    let minor = parts.next().unwrap_or("");
    if value.len() > MAX_UPLOAD_CONTENT_TYPE_BYTES
        || major.is_empty() || minor.is_empty() || parts.next().is_some()
        || !value.bytes().all(|c| c.is_ascii_alphanumeric()
            || matches!(c, b'/' | b'+' | b'-' | b'.'))
    {
        return Err(AppError::BadRequest("Invalid upload content type".into()));
    }
    Ok(())
}

// Reject forged POD MIME headers and active content posing as site photos.
// The signature check is a file-type sanity guard, not malware scanning.
fn supported_pod_image(content_type: &str, data: &[u8]) -> bool {
    match content_type.to_ascii_lowercase().as_str() {
        "image/jpeg" => data.starts_with(&[0xff, 0xd8, 0xff]),
        "image/png" => data.starts_with(b"\x89PNG\r\n\x1a\n"),
        "image/webp" => data.len() >= 12
            && data.starts_with(b"RIFF") && &data[8..12] == b"WEBP",
        "image/gif" => data.starts_with(b"GIF87a") || data.starts_with(b"GIF89a"),
        "image/heic" | "image/heif" => data.len() >= 12
            && &data[4..8] == b"ftyp"
            && matches!(&data[8..12], b"heic" | b"heix" | b"hevc" | b"hevx" | b"mif1"),
        _ => false,
    }
}

pub async fn upload_file(
    State(state): State<AppState>,
    auth_user: AuthUser,
    mut multipart: Multipart,
) -> Result<impl IntoResponse, AppError> {
    let mut file_data: Option<Vec<u8>> = None;
    let mut file_name: Option<String> = None;
    let mut content_type: String = "application/octet-stream".to_string();
    let mut purpose: String = "uploads".to_string();
    let mut load_id: Option<Uuid> = None;

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::BadRequest(e.to_string()))?
    {
        let name = field.name().unwrap_or("").to_string();
        if name == "file" {
            file_name = field.file_name().map(|s| s.to_string());
            if let Some(ct) = field.content_type() {
                content_type = ct.to_string();
            }
            file_data = Some(
                field
                    .bytes()
                    .await
                    .map_err(|e| AppError::BadRequest(e.to_string()))?
                    .to_vec(),
            );
        } else if name == "trip_id" {
            let value = field
                .text()
                .await
                .map_err(|_| AppError::BadRequest("Invalid trip ID".to_string()))?;
            load_id = Some(
                value
                    .parse()
                    .map_err(|_| AppError::BadRequest("Invalid trip ID".to_string()))?,
            );
        } else if name == "purpose" {
            if let Ok(text) = field.text().await {
                purpose = text.to_lowercase();
            }
        }
    }

    let data = file_data
        .ok_or_else(|| AppError::BadRequest("No file provided in multipart body".to_string()))?;
    let orig_name = checked_upload_filename(file_name)?;
    checked_upload_content_type(&content_type)?;

    if data.is_empty() || data.len() > 2 * 1024 * 1024 {
        return Err(AppError::BadRequest(
            "File must contain between 1 byte and 2 MiB".to_string(),
        ));
    }
    if purpose.is_empty()
        || purpose.len() > MAX_UPLOAD_PURPOSE_BYTES
        || !purpose
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return Err(AppError::BadRequest("Invalid upload purpose".to_string()));
    }
    if load_id.is_some() && purpose != "pod" {
        return Err(AppError::BadRequest(
            "Trip reference is supported only for proof-of-delivery uploads".into(),
        ));
    }
    if purpose == "pod" {
        crate::auth::middleware::check_role(&auth_user, &["driver"])?;
        let trip = load_id
            .ok_or_else(|| AppError::BadRequest("POD upload requires a trip".to_string()))?;
        let owns: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM order_loads WHERE id = $1 AND driver_id = $2
             AND status IN ('en_route', 'arrived', 'pouring'))",
        )
        .bind(trip)
        .bind(auth_user.user_id)
        .fetch_one(&state.db)
        .await?;
        if !owns || !supported_pod_image(&content_type, &data) {
            return Err(AppError::Forbidden(
                "POD image requires an active assigned trip".to_string(),
            ));
        }
    }
    let ext = safe_upload_extension(&orig_name);
    let stored_path = format!("trackmyrmc/{}/{}.{}", purpose, Uuid::new_v4().simple(), ext);

    sqlx::query(
        r#"
        INSERT INTO stored_files (uploaded_by, file_path, file_name, content_type, file_size_bytes, storage_provider, file_data, load_id)
        VALUES ($1, $2, $3, $4, $5, 'postgres', $6, $7)
        "#,
    )
    .bind(auth_user.user_id)
    .bind(&stored_path)
    .bind(&orig_name)
    .bind(&content_type)
    .bind(data.len() as i64)
    .bind(&data)
    .bind(load_id)
    .execute(&state.db)
    .await?;

    Ok(Json(json!({
        "success": true,
        "path": stored_path,
        "file_name": orig_name
    })))
}

pub async fn get_file(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(path): Path<String>,
) -> Result<Response, AppError> {
    use sqlx::Row;
    let file_row = sqlx::query(
        "SELECT file_name, content_type, file_data FROM stored_files f WHERE file_path = $1
             AND (uploaded_by = $2 OR EXISTS(
                 SELECT 1 FROM proof_of_deliveries pod
                 JOIN order_loads l ON l.id = pod.load_id
                 JOIN orders o ON o.id = l.order_id
                 JOIN rmc_plants p ON p.id = o.plant_id
                 WHERE pod.photo_url = f.file_path
                 AND (o.customer_id = $2 OR p.owner_id = $2 OR EXISTS(
                     SELECT 1 FROM plant_staff ps WHERE ps.plant_id = o.plant_id
                     AND ps.user_id = $2 AND ps.is_active = TRUE))
             ))",
    )
    .bind(&path)
    .bind(auth_user.user_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("File not found".to_string()))?;

    let file_name: String = file_row.get("file_name");
    let content_type: String = file_row.get("content_type");

    let bytes: Vec<u8> = file_row
        .get::<Option<Vec<u8>>, _>("file_data")
        .ok_or_else(|| AppError::NotFound("Historical file content is unavailable".to_string()))?;

    let response = Response::builder()
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CACHE_CONTROL, "private, max-age=300")
        .header("X-Content-Type-Options", "nosniff")
        .header(
            header::CONTENT_DISPOSITION,
            format!(
                "attachment; filename=\"{}\"",
                file_name.replace(['\r', '\n', '"', '\\'], "_")
            ),
        )
        .body(axum::body::Body::from(bytes))
        .map_err(|_| AppError::InternalError("Failed to construct file response".to_string()))?;

    Ok(response)
}


#[cfg(test)]
mod tests {
    use super::{checked_upload_content_type, checked_upload_filename, safe_upload_extension, supported_pod_image};

    #[test]
    fn upload_key_extension_is_bounded_to_known_types() {
        assert_eq!(safe_upload_extension("site.JPG"), "jpg");
        assert_eq!(safe_upload_extension("proof.JpEg"), "jpeg");
        assert_eq!(safe_upload_extension("file.name.png"), "png");
        assert_eq!(safe_upload_extension("upload"), "bin");
        assert_eq!(safe_upload_extension("evil.php"), "bin");
        assert_eq!(safe_upload_extension("a.jpg/../../escape"), "bin");
    }

    #[test]
    fn unsafe_and_unbounded_original_names_are_rejected() {
        for filename in ["../proof.jpg", "dir/proof.jpg", r"dir\proof.jpg", "\r\ninjection.jpg", ".",
                         "..", "", "photo\u{0000}.png"] {
            assert!(checked_upload_filename(Some(filename.into())).is_err(), "{filename:?}");
        }
        assert!(checked_upload_filename(Some("x".repeat(256))).is_err());
        assert_eq!(checked_upload_filename(None).unwrap(), "file.bin");
        assert_eq!(checked_upload_filename(Some("site photo.jpg".into())).unwrap(), "site photo.jpg");
    }

    #[test]
    fn mime_metadata_is_safe_to_use_as_an_http_header() {
        for valid in ["image/jpeg", "image/png", "image/webp", "application/pdf",
                      "application/octet-stream"] {
            assert!(checked_upload_content_type(valid).is_ok(), "{valid}");
        }
        for invalid in ["", "image/", "/jpeg", "text/html; charset=utf-8", "image/jpeg\r\nX: bad",
                        "image/jpeg/other"] {
            assert!(checked_upload_content_type(invalid).is_err(), "{invalid:?}");
        }
        assert!(checked_upload_content_type(&"a".repeat(128)).is_err());
    }

    #[test]
    fn pod_accepts_images_with_matching_file_signatures() {
        assert!(supported_pod_image("image/jpeg", &[0xff, 0xd8, 0xff, 0x00]));
        assert!(supported_pod_image("image/png", b"\x89PNG\r\n\x1a\nrest"));
        assert!(supported_pod_image("image/webp", b"RIFF1234WEBP"));
        assert!(supported_pod_image("image/gif", b"GIF89a"));
        assert!(supported_pod_image("image/heic", b"\x00\x00\x00\x18ftypheic"));
        assert!(!supported_pod_image("image/jpeg", b"<script>alert(1)</script>"));
        assert!(!supported_pod_image("image/svg+xml", b"<svg/>"));
        assert!(!supported_pod_image("image/png", &[0xff, 0xd8, 0xff, 0x00]));
    }
}
