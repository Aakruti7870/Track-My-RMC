use crate::{
    error::AppError,
    models::workforce::{PayrollClosure, WorkforceAttendance},
};
use chrono::NaiveDate;
use sqlx::PgPool;
use uuid::Uuid;

pub async fn record_attendance(
    pool: &PgPool,
    plant_id: Uuid,
    user_id: Uuid,
    check_type: &str,
    lat: Option<f64>,
    lng: Option<f64>,
) -> Result<(), AppError> {
    let updated = if check_type == "in" {
        sqlx::query(
            "INSERT INTO workforce_attendance
             (plant_id,user_id,attendance_date,check_in_time,check_in_lat,check_in_lng,status)
             VALUES ($1,$2,(NOW() AT TIME ZONE 'Asia/Kolkata')::date,NOW(),$3,$4,'present')
             ON CONFLICT (plant_id,user_id,attendance_date) DO UPDATE SET
               check_in_time=EXCLUDED.check_in_time,check_in_lat=EXCLUDED.check_in_lat,
               check_in_lng=EXCLUDED.check_in_lng,status='present'
             WHERE workforce_attendance.check_in_time IS NULL
               AND workforce_attendance.check_out_time IS NULL",
        )
        .bind(plant_id)
        .bind(user_id)
        .bind(lat)
        .bind(lng)
        .execute(pool)
        .await?
    } else {
        sqlx::query(
            "UPDATE workforce_attendance SET check_out_time=NOW()
             WHERE plant_id=$1 AND user_id=$2
               AND attendance_date=(NOW() AT TIME ZONE 'Asia/Kolkata')::date
               AND check_in_time IS NOT NULL AND check_out_time IS NULL",
        )
        .bind(plant_id)
        .bind(user_id)
        .execute(pool)
        .await?
    };
    if updated.rows_affected() != 1 {
        return Err(AppError::Conflict(
            "Attendance is already recorded or the workday is not open".into(),
        ));
    }
    Ok(())
}

pub async fn get_daily_roster(
    pool: &PgPool,
    plant_id: Uuid,
    date: NaiveDate,
) -> Result<Vec<WorkforceAttendance>, AppError> {
    let roster = sqlx::query_as::<_, WorkforceAttendance>(
        r#"
        SELECT a.id,a.plant_id,a.user_id,u.full_name AS user_name,a.attendance_date,a.shift_id,
               a.check_in_time,a.check_out_time,a.status,a.check_in_lat,a.check_in_lng,a.created_at
        FROM workforce_attendance a JOIN users u ON u.id=a.user_id
        WHERE a.plant_id=$1 AND a.attendance_date=$2
        ORDER BY u.full_name,a.id
        "#,
    )
    .bind(plant_id)
    .bind(date)
    .fetch_all(pool)
    .await?;

    Ok(roster)
}

pub async fn get_payroll_closure(
    pool: &PgPool,
    plant_id: Uuid,
    month: i32,
    year: i32,
) -> Result<Option<PayrollClosure>, AppError> {
    let closure = sqlx::query_as::<_, PayrollClosure>(
        r#"
        SELECT id, plant_id, month, year, total_gross, total_net, employee_count, is_closed, closed_at, closed_by, override_reason, created_at
        FROM payroll_closures
        WHERE plant_id = $1 AND month = $2 AND year = $3
        "#,
    )
    .bind(plant_id)
    .bind(month)
    .bind(year)
    .fetch_optional(pool)
    .await?;

    Ok(closure)
}
