use crate::{auth::AuthUser, error::AppError, state::AppState};
use axum::{
    extract::{Multipart, Path, State},
    http::header,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;
use uuid::Uuid;

pub async fn upload_file(
    State(state): State<AppState>,
    auth_user: AuthUser,
    mut multipart: Multipart,
) -> Result<impl IntoResponse, AppError> {
    let mut file_data: Option<Vec<u8>> = None;
    let mut file_name: Option<String> = None;
    let mut content_type: String = "application/octet-stream".to_string();
    let mut purpose: String = "uploads".to_string();

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
        } else if name == "purpose" {
            if let Ok(text) = field.text().await {
                purpose = text.to_lowercase();
            }
        }
    }

    let data = file_data
        .ok_or_else(|| AppError::BadRequest("No file provided in multipart body".to_string()))?;
    let orig_name = file_name.unwrap_or_else(|| "file.bin".to_string());

    if data.is_empty() || data.len() > 2 * 1024 * 1024 {
        return Err(AppError::BadRequest(
            "File must contain between 1 byte and 2 MiB".to_string(),
        ));
    }
    if purpose.is_empty()
        || !purpose
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return Err(AppError::BadRequest("Invalid upload purpose".to_string()));
    }
    let ext = orig_name.split('.').last().unwrap_or("bin");
    let stored_path = format!("trackmyrmc/{}/{}.{}", purpose, Uuid::new_v4().simple(), ext);

    sqlx::query(
        r#"
        INSERT INTO stored_files (uploaded_by, file_path, file_name, content_type, file_size_bytes, storage_provider, file_data)
        VALUES ($1, $2, $3, $4, $5, 'postgres', $6)
        "#,
    )
    .bind(auth_user.user_id)
    .bind(&stored_path)
    .bind(&orig_name)
    .bind(&content_type)
    .bind(data.len() as i64)
    .bind(&data)
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
