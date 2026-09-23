use crate::{
    error::AppError,
    models::workforce::{MarkAttendanceRequest, PayrollClosure, WorkforceAttendance},
    repositories::workforce_repo,
    state::AppState,
};
use chrono::NaiveDate;
use uuid::Uuid;

pub async fn handle_attendance_check(
    state: &AppState,
    user_id: Uuid,
    req: MarkAttendanceRequest,
) -> Result<(), AppError> {
    let target_user = req.user_id.unwrap_or(user_id);
    workforce_repo::record_attendance(
        &state.db,
        req.plant_id,
        target_user,
        &req.check_type,
        req.latitude,
        req.longitude,
    )
    .await?;

    Ok(())
}

pub async fn fetch_daily_roster(
    state: &AppState,
    plant_id: Uuid,
    date: NaiveDate,
) -> Result<Vec<WorkforceAttendance>, AppError> {
    workforce_repo::get_daily_roster(&state.db, plant_id, date).await
}
