use crate::{
    auth::{middleware::check_role, AuthUser},
    error::AppError,
    state::AppState,
};
use axum::{
    extract::{Path, State},
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;

async fn get_staff_plant_id(state: &AppState, auth_user: &AuthUser) -> Result<Uuid, AppError> {
    if auth_user.role == "owner" || auth_user.role == "plant_owner" {
        let plant_id: Option<Uuid> =
            sqlx::query_scalar("SELECT id FROM rmc_plants WHERE owner_id = $1 AND is_active = TRUE LIMIT 1")
                .bind(auth_user.user_id)
                .fetch_optional(&state.db)
                .await?;
        if let Some(id) = plant_id {
            return Ok(id);
        }
    }
    let plant_id: Option<Uuid> = sqlx::query_scalar(
        "SELECT plant_id FROM plant_staff WHERE user_id = $1 AND is_active = TRUE LIMIT 1",
    )
    .bind(auth_user.user_id)
    .fetch_optional(&state.db)
    .await?;

    plant_id.ok_or_else(|| AppError::Forbidden("No active plant found for this user".to_string()))
}

fn parse_year_month(month_str: &str) -> Result<(i32, i32), AppError> {
    let parts: Vec<&str> = month_str.split('-').collect();
    if parts.len() != 2 {
        return Err(AppError::BadRequest("Invalid month format, expected YYYY-MM".to_string()));
    }
    let year: i32 = parts[0].parse().map_err(|_| AppError::BadRequest("Invalid year".to_string()))?;
    let month: i32 = parts[1].parse().map_err(|_| AppError::BadRequest("Invalid month".to_string()))?;
    if !(1..=12).contains(&month) || year < 2020 {
        return Err(AppError::BadRequest("Month must be 01-12 and year >= 2020".to_string()));
    }
    Ok((year, month))
}

pub async fn get_payroll_period_summary(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(month_str): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["accountant", "owner", "plant_owner", "admin"])?;
    let (year, month) = parse_year_month(&month_str)?;
    let plant_id = get_staff_plant_id(&state, &auth_user).await?;

    let closure = sqlx::query!(
        r#"
        SELECT id, total_gross, total_net, employee_count, is_closed, closed_at
        FROM payroll_closures
        WHERE plant_id = $1 AND month = $2 AND year = $3
        "#,
        plant_id,
        month,
        year
    )
    .fetch_optional(&state.db)
    .await?;

    let total_employees: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM plant_staff WHERE plant_id = $1 AND is_active = TRUE",
    )
    .bind(plant_id)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(json!({
        "success": true,
        "plant_id": plant_id,
        "month": month_str,
        "closure": closure.map(|c| json!({
            "id": c.id,
            "is_closed": c.is_closed,
            "total_gross": c.total_gross,
            "total_net": c.total_net,
            "employee_count": c.employee_count,
            "closed_at": c.closed_at
        })),
        "total_active_staff": total_employees
    })))
}

#[derive(Debug, Deserialize, Serialize)]
pub struct ClosePeriodPayload {
    pub override_reason: Option<String>,
}

pub async fn close_payroll_period(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path((plant_id, month_str)): Path<(Uuid, String)>,
    Json(payload): Json<ClosePeriodPayload>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["owner", "plant_owner", "admin"])?;
    let (year, month) = parse_year_month(&month_str)?;

    let id = sqlx::query_scalar!(
        r#"
        INSERT INTO payroll_closures (
            plant_id, month, year, is_closed, closed_at, closed_by, override_reason
        )
        VALUES ($1, $2, $3, TRUE, NOW(), $4, $5)
        ON CONFLICT (plant_id, month, year) DO UPDATE SET
            is_closed = TRUE,
            closed_at = NOW(),
            closed_by = EXCLUDED.closed_by,
            override_reason = EXCLUDED.override_reason
        RETURNING id
        "#,
        plant_id,
        month,
        year,
        auth_user.user_id,
        payload.override_reason
    )
    .fetch_one(&state.db)
    .await?;

    Ok(Json(json!({
        "success": true,
        "closure_id": id,
        "message": format!("Payroll period {} locked and closed", month_str)
    })))
}

pub async fn reopen_payroll_period(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path((plant_id, month_str)): Path<(Uuid, String)>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["owner", "plant_owner", "admin"])?;
    let (year, month) = parse_year_month(&month_str)?;

    sqlx::query!(
        r#"
        UPDATE payroll_closures
        SET is_closed = FALSE, closed_at = NULL, closed_by = NULL
        WHERE plant_id = $1 AND month = $2 AND year = $3
        "#,
        plant_id,
        month,
        year
    )
    .execute(&state.db)
    .await?;

    Ok(Json(json!({
        "success": true,
        "message": format!("Payroll period {} reopened for mutations", month_str)
    })))
}

pub async fn list_period_payslips(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path((plant_id, month_str)): Path<(Uuid, String)>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["accountant", "owner", "plant_owner", "admin"])?;
    let (year, month) = parse_year_month(&month_str)?;

    let closure = sqlx::query!(
        "SELECT id, is_closed FROM payroll_closures WHERE plant_id = $1 AND month = $2 AND year = $3",
        plant_id,
        month,
        year
    )
    .fetch_optional(&state.db)
    .await?;

    let payslips = if let Some(c) = closure {
        let records = sqlx::query!(
            r#"
            SELECT pr.id, pr.user_id, pr.basic_pay, pr.allowances, pr.deductions, pr.net_pay,
                   pr.payment_status, pr.transaction_ref,
                   u.full_name as employee_name, ps.role
            FROM payroll_records pr
            INNER JOIN users u ON u.id = pr.user_id
            LEFT JOIN plant_staff ps ON ps.user_id = pr.user_id AND ps.plant_id = $2
            WHERE pr.closure_id = $1
            ORDER BY u.full_name
            "#,
            c.id,
            plant_id
        )
        .fetch_all(&state.db)
        .await?;

        records.into_iter().map(|r| json!({
            "id": r.id,
            "user_id": r.user_id,
            "employee_name": r.employee_name,
            "role": r.role,
            "basic_pay": r.basic_pay,
            "allowances": r.allowances,
            "deductions": r.deductions,
            "net_pay": r.net_pay,
            "payment_status": r.payment_status,
            "transaction_ref": r.transaction_ref
        })).collect::<Vec<_>>()
    } else {
        Vec::new()
    };

    Ok(Json(json!({ "success": true, "payslips": payslips })))
}

pub async fn export_payroll_csv(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path((plant_id, month_str)): Path<(Uuid, String)>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["accountant", "owner", "plant_owner", "admin"])?;
    let (year, month) = parse_year_month(&month_str)?;

    let records = sqlx::query!(
        r#"
        SELECT u.full_name, ps.role, pr.basic_pay, pr.allowances, pr.deductions, pr.net_pay, pr.payment_status
        FROM payroll_closures pc
        INNER JOIN payroll_records pr ON pr.closure_id = pc.id
        INNER JOIN users u ON u.id = pr.user_id
        LEFT JOIN plant_staff ps ON ps.user_id = pr.user_id AND ps.plant_id = $1
        WHERE pc.plant_id = $1 AND pc.month = $2 AND pc.year = $3
        ORDER BY u.full_name
        "#,
        plant_id,
        month,
        year
    )
    .fetch_all(&state.db)
    .await?;

    let mut csv = String::from("Employee Name,Role,Basic Pay,Allowances,Deductions,Net Pay,Status\n");
    for r in records {
        csv.push_str(&format!(
            "\"{}\",\"{}\",{},{},{},{},\"{}\"\n",
            r.full_name,
            r.role.unwrap_or_default(),
            r.basic_pay,
            r.allowances,
            r.deductions,
            r.net_pay,
            r.payment_status
        ));
    }

    Ok(Json(json!({
        "success": true,
        "filename": format!("payroll_{}_{}.csv", plant_id, month_str),
        "csv": csv
    })))
}

pub async fn get_my_payslip(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(month_str): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    let (year, month) = parse_year_month(&month_str)?;

    let record = sqlx::query!(
        r#"
        SELECT pr.id, pr.basic_pay, pr.allowances, pr.deductions, pr.net_pay,
               pr.payment_status, pr.transaction_ref,
               pc.is_closed, pc.closed_at
        FROM payroll_records pr
        INNER JOIN payroll_closures pc ON pc.id = pr.closure_id
        WHERE pr.user_id = $1 AND pc.month = $2 AND pc.year = $3
        "#,
        auth_user.user_id,
        month,
        year
    )
    .fetch_optional(&state.db)
    .await?;

    match record {
        Some(r) => Ok(Json(json!({
            "success": true,
            "historical": true,
            "period_status": if r.is_closed { "CLOSED" } else { "OPEN" },
            "payslip": {
                "id": r.id,
                "basic_pay": r.basic_pay,
                "allowances": r.allowances,
                "deductions": r.deductions,
                "net_pay": r.net_pay,
                "payment_status": r.payment_status,
                "transaction_ref": r.transaction_ref
            }
        }))),
        None => Ok(Json(json!({
            "success": true,
            "historical": false,
            "period_status": "PENDING",
            "payslip": null
        }))),
    }
}
