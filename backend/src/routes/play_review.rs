use crate::{
    error::AppError,
    services::play_review::{self, PlayReviewLoginRequest},
    state::AppState,
};
use axum::{extract::State, http::HeaderMap, response::IntoResponse, Json};

pub(crate) async fn login(
    State(state): State<AppState>,
    axum::Extension(source): axum::Extension<crate::auth::limits::AuthSource>,
    headers: HeaderMap,
    Json(payload): Json<PlayReviewLoginRequest>,
) -> Result<impl IntoResponse, AppError> {
    let auth = play_review::login(&state, payload, &source.0).await?;
    Ok(crate::auth::refresh::login_response(auth, &headers))
}
