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
use sqlx::Row;
use uuid::Uuid;

async fn get_accessible_plants(
    state: &AppState,
    auth_user: &AuthUser,
) -> Result<Vec<(Uuid, String)>, AppError> {
    let rows = sqlx::query(
        r#"
        SELECT p.id, p.name
        FROM rmc_plants p
        WHERE (p.owner_id = $1 OR p.id IN (SELECT plant_id FROM plant_staff WHERE user_id = $1 AND is_active = TRUE))
          AND p.is_active = TRUE
        ORDER BY p.name
        "#,
    )
    .bind(auth_user.user_id)
    .fetch_all(&state.db)
    .await?;

    Ok(rows
        .into_iter()
        .map(|r| (r.get("id"), r.get("name")))
        .collect())
}

fn parse_year_month(month_str: &str) -> Result<(i32, i32), AppError> {
    let parts: Vec<&str> = month_str.split('-').collect();
    if parts.len() != 2 {
        return Err(AppError::BadRequest(
            "Invalid month format, expected YYYY-MM".to_string(),
        ));
    }
    let year: i32 = parts[0]
        .parse()
        .map_err(|_| AppError::BadRequest("Invalid year".to_string()))?;
    let month: i32 = parts[1]
        .parse()
        .map_err(|_| AppError::BadRequest("Invalid month".to_string()))?;
    if !(1..=12).contains(&month) || year < 2020 {
        return Err(AppError::BadRequest(
            "Month must be 01-12 and year >= 2020".to_string(),
        ));
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
    let plants = get_accessible_plants(&state, &auth_user).await?;

    let mut periods = Vec::new();
    for (plant_id, plant_name) in plants {
        let closure = sqlx::query(
            r#"
            SELECT id, total_gross, total_net, employee_count, is_closed, closed_at, override_reason
            FROM payroll_closures
            WHERE plant_id = $1 AND month = $2 AND year = $3
            "#,
        )
        .bind(plant_id)
        .bind(month)
        .bind(year)
        .fetch_optional(&state.db)
        .await?;

        let employee_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM plant_staff WHERE plant_id = $1 AND is_active = TRUE",
        )
        .bind(plant_id)
        .fetch_one(&state.db)
        .await?;

        let (is_closed, closed_at, reopen_reason, cid) = match closure {
            Some(ref c) => {
                let cl: bool = c.get("is_closed");
                let ca: Option<chrono::DateTime<chrono::Utc>> = c.get("closed_at");
                let or: Option<String> = c.get("override_reason");
                let id: Uuid = c.get("id");
                (cl, ca, or, Some(id))
            }
            None => (false, None, None, None),
        };

        let paid_count: i64 = if let Some(id) = cid {
            sqlx::query_scalar(
                "SELECT COUNT(*) FROM payroll_records WHERE closure_id = $1 AND payment_status = 'paid'",
            )
            .bind(id)
            .fetch_one(&state.db)
            .await?
        } else {
            0
        };

        let payslip_count: i64 = if let Some(id) = cid {
            sqlx::query_scalar("SELECT COUNT(*) FROM payroll_records WHERE closure_id = $1")
                .bind(id)
                .fetch_one(&state.db)
                .await?
        } else {
            0
        };

        let is_ready = employee_count > 0 && paid_count >= employee_count;

        periods.push(json!({
            "plant_id": plant_id,
            "plant_name": plant_name,
            "month": month_str,
            "status": if is_closed { "CLOSED" } else { "OPEN" },
            "version": if is_closed { 1 } else { 0 },
            "closed_at": closed_at,
            "reopen_reason": reopen_reason,
            "payslip_count": payslip_count,
            "readiness": {
                "ready": is_ready,
                "employee_count": employee_count,
                "paid_count": paid_count,
                "missing_user_ids": Vec::<String>::new(),
                "unpaid": Vec::<serde_json::Value>::new(),
                "payment_locked_user_ids": Vec::<String>::new()
            }
        }));
    }

    Ok(Json(json!({
        "success": true,
        "periods": periods
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
    payload: Option<Json<ClosePeriodPayload>>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["owner", "plant_owner", "admin"])?;
    super::business_routes::ensure_plant_staff_or_owner(&state, &auth_user, plant_id).await?;
    let (year, month) = parse_year_month(&month_str)?;
    let override_reason = payload.and_then(|p| p.0.override_reason);

    let id: Uuid = sqlx::query_scalar(
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
    )
    .bind(plant_id)
    .bind(month)
    .bind(year)
    .bind(auth_user.user_id)
    .bind(override_reason)
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
    super::business_routes::ensure_plant_staff_or_owner(&state, &auth_user, plant_id).await?;
    let (year, month) = parse_year_month(&month_str)?;

    sqlx::query(
        r#"
        UPDATE payroll_closures
        SET is_closed = FALSE, closed_at = NULL, closed_by = NULL
        WHERE plant_id = $1 AND month = $2 AND year = $3
        "#,
    )
    .bind(plant_id)
    .bind(month)
    .bind(year)
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
    super::business_routes::ensure_plant_staff_or_owner(&state, &auth_user, plant_id).await?;
    let (year, month) = parse_year_month(&month_str)?;

    let closure = sqlx::query(
        "SELECT id, is_closed FROM payroll_closures WHERE plant_id = $1 AND month = $2 AND year = $3",
    )
    .bind(plant_id)
    .bind(month)
    .bind(year)
    .fetch_optional(&state.db)
    .await?;

    let payslips = if let Some(c) = closure {
        let cid: Uuid = c.get("id");
        let is_closed: bool = c.get("is_closed");
        let records = sqlx::query(
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
        )
        .bind(cid)
        .bind(plant_id)
        .fetch_all(&state.db)
        .await?;

        records
            .into_iter()
            .enumerate()
            .map(|(idx, r)| {
                let id: Uuid = r.get("id");
                let user_id: Uuid = r.get("user_id");
                let employee_name: String = r.get("employee_name");
                let role: Option<String> = r.get("role");
                let basic_pay: bigdecimal::BigDecimal = r.get("basic_pay");
                let allowances: bigdecimal::BigDecimal = r.get("allowances");
                let deductions: bigdecimal::BigDecimal = r.get("deductions");
                let net_pay: bigdecimal::BigDecimal = r.get("net_pay");
                let _payment_status: String = r.get("payment_status");
                let transaction_ref: Option<String> = r.get("transaction_ref");

                json!({
                    "id": id,
                    "payslip_number": format!("PS-{}-{:04}", month_str.replace('-', ""), idx + 1),
                    "month": month_str,
                    "employee_code": format!("EMP-{:04}", user_id.as_fields().0 % 10000),
                    "employee_name": employee_name,
                    "role": role.unwrap_or_else(|| "staff".to_string()),
                    "closure_version": if is_closed { 1 } else { 0 },
                    "payroll_snapshot": {
                        "basic_amount": basic_pay,
                        "allowances": allowances,
                        "overtime_amount": 0,
                        "deductions": deductions,
                        "paid_days": 30,
                        "net_amount": net_pay,
                        "payment_method": "BANK_TRANSFER",
                        "payment_reference": transaction_ref,
                        "paid_on": month_str
                    }
                })
            })
            .collect::<Vec<_>>()
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
    super::business_routes::ensure_plant_staff_or_owner(&state, &auth_user, plant_id).await?;
    let (year, month) = parse_year_month(&month_str)?;

    let records = sqlx::query(
        r#"
        SELECT u.full_name, ps.role, pr.basic_pay, pr.allowances, pr.deductions, pr.net_pay, pr.payment_status
        FROM payroll_closures pc
        INNER JOIN payroll_records pr ON pr.closure_id = pc.id
        INNER JOIN users u ON u.id = pr.user_id
        LEFT JOIN plant_staff ps ON ps.user_id = pr.user_id AND ps.plant_id = $1
        WHERE pc.plant_id = $1 AND pc.month = $2 AND pc.year = $3
        ORDER BY u.full_name
        "#,
    )
    .bind(plant_id)
    .bind(month)
    .bind(year)
    .fetch_all(&state.db)
    .await?;

    let mut csv =
        String::from("Employee Name,Role,Basic Pay,Allowances,Deductions,Net Pay,Status\n");
    for r in records {
        let full_name: String = r.get("full_name");
        let role: Option<String> = r.get("role");
        let basic: bigdecimal::BigDecimal = r.get("basic_pay");
        let allowances: bigdecimal::BigDecimal = r.get("allowances");
        let deductions: bigdecimal::BigDecimal = r.get("deductions");
        let net: bigdecimal::BigDecimal = r.get("net_pay");
        let status: String = r.get("payment_status");
        csv.push_str(&format!(
            "\"{}\",\"{}\",{},{},{},{},\"{}\"\n",
            full_name,
            role.unwrap_or_default(),
            basic,
            allowances,
            deductions,
            net,
            status
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

    let record = sqlx::query(
        r#"
        SELECT pr.id, pr.basic_pay, pr.allowances, pr.deductions, pr.net_pay,
               pr.payment_status, pr.transaction_ref,
               pc.is_closed, pc.closed_at
        FROM payroll_records pr
        INNER JOIN payroll_closures pc ON pc.id = pr.closure_id
        WHERE pr.user_id = $1 AND pc.month = $2 AND pc.year = $3
        "#,
    )
    .bind(auth_user.user_id)
    .bind(month)
    .bind(year)
    .fetch_optional(&state.db)
    .await?;

    match record {
        Some(r) => {
            let id: Uuid = r.get("id");
            let basic: bigdecimal::BigDecimal = r.get("basic_pay");
            let allowances: bigdecimal::BigDecimal = r.get("allowances");
            let deductions: bigdecimal::BigDecimal = r.get("deductions");
            let net: bigdecimal::BigDecimal = r.get("net_pay");
            let status: String = r.get("payment_status");
            let tx_ref: Option<String> = r.get("transaction_ref");
            let is_closed: bool = r.get("is_closed");
            Ok(Json(json!({
                "success": true,
                "historical": true,
                "period_status": if is_closed { "CLOSED" } else { "OPEN" },
                "payslip": {
                    "id": id,
                    "basic_pay": basic,
                    "allowances": allowances,
                    "deductions": deductions,
                    "net_pay": net,
                    "payment_status": status,
                    "transaction_ref": tx_ref
                }
            })))
        }
        None => Ok(Json(json!({
            "success": true,
            "historical": false,
            "period_status": "PENDING",
            "payslip": null
        }))),
    }
}
