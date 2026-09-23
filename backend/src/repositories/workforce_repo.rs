use crate::{
    error::AppError,
    models::workforce::{PayrollClosure, WorkforceAttendance},
};
use chrono::{Datelike, NaiveDate, Utc};
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
    let today = Utc::now().date_naive();

    if check_type == "in" {
        sqlx::query(
            r#"
            INSERT INTO workforce_attendance (plant_id, user_id, attendance_date, check_in_time, check_in_lat, check_in_lng, status)
            VALUES ($1, $2, $3, NOW(), $4, $5, 'present')
            ON CONFLICT (plant_id, user_id, attendance_date) DO UPDATE
            SET check_in_time = NOW(), check_in_lat = EXCLUDED.check_in_lat, check_in_lng = EXCLUDED.check_in_lng
            "#,
        )
        .bind(plant_id)
        .bind(user_id)
        .bind(today)
        .bind(lat)
        .bind(lng)
        .execute(pool)
        .await?;
    } else {
        sqlx::query(
            r#"
            UPDATE workforce_attendance
            SET check_out_time = NOW()
            WHERE plant_id = $1 AND user_id = $2 AND attendance_date = $3
            "#,
        )
        .bind(plant_id)
        .bind(user_id)
        .bind(today)
        .execute(pool)
        .await?;
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
        SELECT id, plant_id, user_id, attendance_date, shift_id, check_in_time, check_out_time, status, check_in_lat, check_in_lng, created_at
        FROM workforce_attendance
        WHERE plant_id = $1 AND attendance_date = $2
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
