use crate::{
    auth::{middleware::check_role, AuthUser},
    error::AppError,
    state::AppState,
};
use axum::{
    extract::{Query, State},
    response::IntoResponse,
    Json,
};
use chrono::{Datelike, NaiveDate};
use serde::Deserialize;
use serde_json::json;
use sqlx::Row;
use uuid::Uuid;

#[derive(Debug, Deserialize)]
pub struct MonthlyReportQuery {
    pub plant_id: Uuid,
    /// Calendar month in YYYY-MM format.
    pub month: String,
}

/// Read-only monthly attendance and payroll summary. Payroll amounts are read
/// only from persisted closure records; this endpoint never calculates salary.
pub async fn monthly_summary(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Query(query): Query<MonthlyReportQuery>,
) -> Result<impl IntoResponse, AppError> {
    check_role(
        &auth_user,
        &["owner", "admin", "accountant", "supervisor"],
    )?;

    let month_start = NaiveDate::parse_from_str(
        &format!("{}-01", query.month),
        "%Y-%m-%d",
    )
    .map_err(|_| AppError::BadRequest("month must use YYYY-MM format".to_string()))?;
    if month_start.format("%Y-%m").to_string() != query.month {
        return Err(AppError::BadRequest(
            "month must use YYYY-MM format".to_string(),
        ));
    }
    let (year, month) = (month_start.year(), month_start.month() as i32);
    let next_month = if month == 12 {
        NaiveDate::from_ymd_opt(year + 1, 1, 1)
    } else {
        NaiveDate::from_ymd_opt(year, month as u32 + 1, 1)
    }
    .ok_or_else(|| AppError::BadRequest("invalid month".to_string()))?;

    // Owners/admins can view plants they own (admins are platform-level).
    // All other roles must have an active assignment to this plant.
    if auth_user.role != "owner" && auth_user.role != "admin" {
        let assigned: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM plant_staff WHERE plant_id=$1 AND user_id=$2 AND is_active=TRUE)",
        )
        .bind(query.plant_id)
        .bind(auth_user.user_id)
        .fetch_one(&state.db)
        .await?;
        if !assigned {
            return Err(AppError::Forbidden(
                "You are not assigned to this plant".to_string(),
            ));
        }
    } else if auth_user.role == "owner" {
        let owns_plant: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM rmc_plants WHERE id=$1 AND owner_id=$2)",
        )
        .bind(query.plant_id)
        .bind(auth_user.user_id)
        .fetch_one(&state.db)
        .await?;
        if !owns_plant {
            return Err(AppError::Forbidden(
                "This plant is not owned by your account".to_string(),
            ));
        }
    }

    let attendance = sqlx::query(
        r#"
        SELECT
            COUNT(*)::BIGINT AS recorded_days,
            COUNT(*) FILTER (WHERE status = 'present')::BIGINT AS present_days,
            COUNT(*) FILTER (WHERE status = 'absent')::BIGINT AS absent_days,
            COUNT(*) FILTER (WHERE check_in_time IS NOT NULL AND check_out_time IS NULL)::BIGINT AS open_shifts,
            COUNT(*) FILTER (WHERE check_in_time IS NOT NULL AND check_out_time IS NOT NULL)::BIGINT AS completed_shifts
        FROM workforce_attendance
        WHERE plant_id = $1 AND attendance_date >= $2 AND attendance_date < $3
        "#,
    )
    .bind(query.plant_id)
    .bind(month_start)
    .bind(next_month)
    .fetch_one(&state.db)
    .await?;

    let payroll = sqlx::query(
        r#"
        SELECT id, total_gross, total_net, employee_count, is_closed, closed_at
        FROM payroll_closures
        WHERE plant_id = $1 AND month = $2 AND year = $3
        "#,
    )
    .bind(query.plant_id)
    .bind(month)
    .bind(year)
    .fetch_optional(&state.db)
    .await?;

    let attendance_json = json!({
        "recorded_days": attendance.get::<i64, _>("recorded_days"),
        "present_days": attendance.get::<i64, _>("present_days"),
        "absent_days": attendance.get::<i64, _>("absent_days"),
        "open_shifts": attendance.get::<i64, _>("open_shifts"),
        "completed_shifts": attendance.get::<i64, _>("completed_shifts"),
    });

    let payroll_json = payroll.map(|row| json!({
        "closure_id": row.get::<Uuid, _>("id"),
        "total_gross": row.get::<bigdecimal::BigDecimal, _>("total_gross").to_string(),
        "total_net": row.get::<bigdecimal::BigDecimal, _>("total_net").to_string(),
        "employee_count": row.get::<i32, _>("employee_count"),
        "is_closed": row.get::<bool, _>("is_closed"),
        "closed_at": row.get::<Option<chrono::DateTime<chrono::Utc>>, _>("closed_at"),
    }));

    Ok(Json(json!({
        "success": true,
        "plant_id": query.plant_id,
        "month": query.month,
        "attendance": attendance_json,
        "payroll": payroll_json,
        "note": "Read-only summary. Salary is not inferred from attendance."
    })))
}
