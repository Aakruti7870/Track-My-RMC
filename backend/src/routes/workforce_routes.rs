use crate::{
    auth::{middleware::check_role, AuthUser},
    error::AppError,
    models::workforce::MarkAttendanceRequest,
    services::payroll_service,
    state::AppState,
};
use axum::{
    extract::{Query, State},
    response::IntoResponse,
    Json,
};
use chrono::NaiveDate;
use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

#[derive(Deserialize)]
pub struct RosterQuery {
    pub plant_id: Uuid,
    pub date: Option<NaiveDate>,
}

pub async fn get_roster(
    State(state): State<AppState>,
    _auth_user: AuthUser,
    Query(query): Query<RosterQuery>,
) -> Result<impl IntoResponse, AppError> {
    let date = query.date.unwrap_or_else(|| chrono::Utc::now().date_naive());
    let roster = payroll_service::fetch_daily_roster(&state, query.plant_id, date).await?;
    Ok(Json(json!({ "success": true, "date": date, "roster": roster })))
}

pub async fn mark_attendance(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Json(payload): Json<MarkAttendanceRequest>,
) -> Result<impl IntoResponse, AppError> {
    payroll_service::handle_attendance_check(&state, auth_user.user_id, payload).await?;
    Ok(Json(json!({ "success": true, "message": "Attendance recorded successfully" })))
}
