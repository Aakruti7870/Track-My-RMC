use crate::{
    error::AppError,
    services::play_review::{self, PlayReviewLoginRequest},
    state::AppState,
};
use axum::{extract::State, http::HeaderMap, response::IntoResponse, Json};

fn client_identifier(headers: &HeaderMap) -> String {
    // Cloudflare supplies CF-Connecting-IP at the public edge. Prefer it to
    // caller-controlled forwarding headers; use a stable fallback if absent.
    headers
        .get("cf-connecting-ip")
        .and_then(|value| value.to_str().ok())
        .or_else(|| {
            headers
                .get("x-real-ip")
                .and_then(|value| value.to_str().ok())
        })
        .map(str::trim)
        .filter(|value| !value.is_empty() && value.len() <= 64)
        .unwrap_or("unknown-client")
        .to_string()
}

pub async fn login(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<PlayReviewLoginRequest>,
) -> Result<impl IntoResponse, AppError> {
    let auth = play_review::login(&state, payload, &client_identifier(&headers)).await?;
    Ok(Json(auth))
}
