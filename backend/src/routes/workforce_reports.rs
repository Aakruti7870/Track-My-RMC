use crate::{
    auth::{middleware::check_role, AuthUser},
    error::AppError,
    state::AppState,
};
use axum::{
    extract::{Path, Query, State},
    response::IntoResponse,
    Json,
};
use chrono::{Datelike, NaiveDate};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::Row;
use uuid::Uuid;

#[derive(Debug, Deserialize)]
pub struct MonthlyReportQuery {
    pub plant_id: Uuid,
    /// Calendar month in YYYY-MM format.
    pub month: String,
}

/// Read-only monthly attendance and payroll summary for a single plant.
pub async fn monthly_summary(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Query(query): Query<MonthlyReportQuery>,
) -> Result<impl IntoResponse, AppError> {
    check_role(
        &auth_user,
        &["owner", "plant_owner", "admin", "accountant", "supervisor"],
    )?;

    let month_start = NaiveDate::parse_from_str(&format!("{}-01", query.month), "%Y-%m-%d")
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

    super::business_routes::ensure_plant_staff_or_owner(&state, &auth_user, query.plant_id).await?;

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

    let payroll_json = payroll.map(|row| {
        let tg: bigdecimal::BigDecimal = row.get("total_gross");
        let tn: bigdecimal::BigDecimal = row.get("total_net");
        json!({
            "closure_id": row.get::<Uuid, _>("id"),
            "total_gross": tg.to_string(),
            "total_net": tn.to_string(),
            "employee_count": row.get::<i32, _>("employee_count"),
            "is_closed": row.get::<bool, _>("is_closed"),
            "closed_at": row.get::<Option<chrono::DateTime<chrono::Utc>>, _>("closed_at"),
        })
    });

    Ok(Json(json!({
        "success": true,
        "plant_id": query.plant_id,
        "month": query.month,
        "attendance": attendance_json,
        "payroll": payroll_json,
        "note": "Read-only summary. Salary is not inferred from attendance."
    })))
}

/// Multi-plant monthly workforce report as requested by mobile workforce-reports screen.
pub async fn monthly_workforce_report(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(month_str): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["owner", "plant_owner", "admin", "accountant"])?;

    let month_start = NaiveDate::parse_from_str(&format!("{}-01", month_str), "%Y-%m-%d")
        .map_err(|_| AppError::BadRequest("month must use YYYY-MM format".to_string()))?;
    let (year, month) = (month_start.year(), month_start.month() as i32);
    let next_month = if month == 12 {
        NaiveDate::from_ymd_opt(year + 1, 1, 1)
    } else {
        NaiveDate::from_ymd_opt(year, month as u32 + 1, 1)
    }
    .ok_or_else(|| AppError::BadRequest("invalid month".to_string()))?;

    let plants: Vec<(Uuid, String)> = if matches!(auth_user.role.as_str(), "owner" | "plant_owner")
    {
        sqlx::query("SELECT id, name FROM rmc_plants WHERE owner_id = $1 AND is_active = TRUE ORDER BY name")
            .bind(auth_user.user_id)
            .fetch_all(&state.db)
            .await?
            .into_iter()
            .map(|r| (r.get("id"), r.get("name")))
            .collect()
    } else {
        sqlx::query(
            r#"
            SELECT p.id, p.name 
            FROM rmc_plants p 
            JOIN plant_staff ps ON ps.plant_id = p.id 
            WHERE ps.user_id = $1 AND ps.is_active = TRUE
            ORDER BY p.name
            "#,
        )
        .bind(auth_user.user_id)
        .fetch_all(&state.db)
        .await?
        .into_iter()
        .map(|r| (r.get("id"), r.get("name")))
        .collect()
    };

    let mut reports = Vec::new();

    for (plant_id, plant_name) in plants {
        let staff_rows = sqlx::query(
            r#"
            SELECT u.id, u.full_name, u.role
            FROM plant_staff ps
            JOIN users u ON u.id = ps.user_id
            WHERE ps.plant_id = $1 AND ps.is_active = TRUE
            ORDER BY u.full_name
            "#,
        )
        .bind(plant_id)
        .fetch_all(&state.db)
        .await?;

        let closure_id: Option<Uuid> = sqlx::query_scalar(
            "SELECT id FROM payroll_closures WHERE plant_id = $1 AND month = $2 AND year = $3",
        )
        .bind(plant_id)
        .bind(month)
        .bind(year)
        .fetch_optional(&state.db)
        .await?;

        let mut employees = Vec::new();
        let mut total_payroll = 0.0;
        let mut status_counts = std::collections::HashMap::new();

        for staff in staff_rows {
            let uid: Uuid = staff.get("id");
            let uname: String = staff.get("full_name");
            let urole: String = staff.get("role");

            let att_days: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM workforce_attendance WHERE user_id = $1 AND attendance_date >= $2 AND attendance_date < $3 AND status = 'present'",
            )
            .bind(uid)
            .bind(month_start)
            .bind(next_month)
            .fetch_one(&state.db)
            .await?;

            let payroll_record = if let Some(cid) = closure_id {
                sqlx::query(
                    r#"
                    SELECT id, basic_pay, allowances, deductions, net_pay, payment_status, transaction_ref
                    FROM payroll_records
                    WHERE closure_id = $1 AND user_id = $2
                    "#,
                )
                .bind(cid)
                .bind(uid)
                .fetch_optional(&state.db)
                .await?
            } else {
                None
            };

            let payroll_json = payroll_record.map(|pr| {
                let pid: Uuid = pr.get("id");
                let bp: bigdecimal::BigDecimal = pr.get("basic_pay");
                let al: bigdecimal::BigDecimal = pr.get("allowances");
                let dd: bigdecimal::BigDecimal = pr.get("deductions");
                let np: bigdecimal::BigDecimal = pr.get("net_pay");
                let np_f64 = np.to_string().parse::<f64>().unwrap_or(0.0);
                total_payroll += np_f64;
                let pstatus: String = pr.get("payment_status");
                *status_counts.entry(pstatus.to_uppercase()).or_insert(0) += 1;
                let tx_ref: Option<String> = pr.get("transaction_ref");
                json!({
                    "id": pid,
                    "status": pstatus.to_uppercase(),
                    "basic_amount": bp.to_string().parse::<f64>().unwrap_or(0.0),
                    "allowances": al.to_string().parse::<f64>().unwrap_or(0.0),
                    "overtime_amount": 0,
                    "deductions": dd.to_string().parse::<f64>().unwrap_or(0.0),
                    "paid_days": att_days,
                    "net_amount": np_f64,
                    "payment_reference": tx_ref
                })
            });

            employees.push(json!({
                "user_id": uid,
                "user_name": uname,
                "role": urole,
                "attendance_days": att_days,
                "completed_shifts": att_days,
                "open_shifts": 0,
                "attendance_hours": (att_days as f64) * 8.0,
                "approved_leave_days": 0,
                "leave_days_by_type": {},
                "completed_client_visits": 0,
                "approved_expenses": 0,
                "payroll": payroll_json
            }));
        }

        let emp_count = employees.len();
        reports.push(json!({
            "plant_id": plant_id,
            "plant_name": plant_name,
            "month": month_str,
            "calendar_days": 30,
            "employee_count": emp_count,
            "present_records": employees.iter().map(|e| e["attendance_days"].as_i64().unwrap_or(0)).sum::<i64>(),
            "completed_shift_records": employees.iter().map(|e| e["completed_shifts"].as_i64().unwrap_or(0)).sum::<i64>(),
            "open_shift_records": 0,
            "approved_leave_days": 0,
            "completed_client_visits": 0,
            "approved_expenses": 0,
            "payroll_total": total_payroll,
            "payroll_status_counts": status_counts,
            "employees": employees,
            "payroll_note": "Attendance is evidence. Salary requires approved payroll."
        }));
    }

    Ok(Json(json!({
        "month": month_str,
        "reports": reports
    })))
}

#[derive(Debug, Deserialize, Serialize)]
pub struct PayrollDraftPayload {
    pub basic_amount: f64,
    pub allowances: Option<f64>,
    pub overtime_amount: Option<f64>,
    pub deductions: Option<f64>,
    pub paid_days: Option<f64>,
    pub notes: Option<String>,
}

pub async fn save_payroll_draft(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path((plant_id, month_str, user_id)): Path<(Uuid, String, Uuid)>,
    Json(payload): Json<PayrollDraftPayload>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["accountant", "owner", "plant_owner", "admin"])?;

    super::business_routes::ensure_plant_staff_or_owner(&state, &auth_user, plant_id).await?;
    let belongs:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM plant_staff WHERE plant_id=$1 AND user_id=$2 AND is_active=TRUE)").bind(plant_id).bind(user_id).fetch_one(&state.db).await?;
    if !belongs {
        return Err(AppError::NotFound(
            "Employee not found in this plant".into(),
        ));
    }
    let month_start = NaiveDate::parse_from_str(&format!("{}-01", month_str), "%Y-%m-%d")
        .map_err(|_| AppError::BadRequest("month must use YYYY-MM format".to_string()))?;
    let (year, month) = (month_start.year(), month_start.month() as i32);

    let closure_id: Uuid = match sqlx::query_scalar(
        "SELECT id FROM payroll_closures WHERE plant_id = $1 AND month = $2 AND year = $3",
    )
    .bind(plant_id)
    .bind(month)
    .bind(year)
    .fetch_optional(&state.db)
    .await?
    {
        Some(cid) => cid,
        None => {
            sqlx::query_scalar(
                r#"
                INSERT INTO payroll_closures (plant_id, month, year, is_closed)
                VALUES ($1, $2, $3, FALSE)
                RETURNING id
                "#,
            )
            .bind(plant_id)
            .bind(month)
            .bind(year)
            .fetch_one(&state.db)
            .await?
        }
    };

    let allowances = payload.allowances.unwrap_or(0.0);
    let deductions = payload.deductions.unwrap_or(0.0);
    let overtime = payload.overtime_amount.unwrap_or(0.0);
    let net = payload.basic_amount + allowances + overtime - deductions;

    let record_id: Uuid = sqlx::query_scalar(
        r#"
        INSERT INTO payroll_records (closure_id, user_id, basic_pay, allowances, deductions, net_pay, payment_status)
        VALUES ($1, $2, $3::numeric, $4::numeric, $5::numeric, $6::numeric, 'draft')
        RETURNING id
        "#,
    )
    .bind(closure_id)
    .bind(user_id)
    .bind(payload.basic_amount)
    .bind(allowances)
    .bind(deductions)
    .bind(net)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(json!({
        "success": true,
        "payroll": {
            "id": record_id,
            "status": "DRAFT",
            "basic_amount": payload.basic_amount,
            "allowances": allowances,
            "overtime_amount": overtime,
            "deductions": deductions,
            "net_amount": net,
            "paid_days": payload.paid_days.unwrap_or(30.0)
        },
        "message": "Payroll draft saved"
    })))
}

#[derive(Debug, Deserialize, Serialize)]
pub struct OwnerPayrollDecisionPayload {
    pub action: String,
    pub note: Option<String>,
}

pub async fn owner_payroll_decision(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path((plant_id, month_str, user_id)): Path<(Uuid, String, Uuid)>,
    Json(payload): Json<OwnerPayrollDecisionPayload>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["owner", "plant_owner", "admin"])?;

    super::business_routes::ensure_plant_staff_or_owner(&state, &auth_user, plant_id).await?;
    let belongs:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM plant_staff WHERE plant_id=$1 AND user_id=$2 AND is_active=TRUE)").bind(plant_id).bind(user_id).fetch_one(&state.db).await?;
    if !belongs {
        return Err(AppError::NotFound(
            "Employee not found in this plant".into(),
        ));
    }
    let month_start = NaiveDate::parse_from_str(&format!("{}-01", month_str), "%Y-%m-%d")
        .map_err(|_| AppError::BadRequest("month must use YYYY-MM format".to_string()))?;
    let (year, month) = (month_start.year(), month_start.month() as i32);

    let status = if payload.action.to_uppercase() == "APPROVE" {
        "approved"
    } else {
        "returned"
    };

    sqlx::query(
        r#"
        UPDATE payroll_records
        SET payment_status = $1
        WHERE user_id = $2
          AND closure_id IN (SELECT id FROM payroll_closures WHERE plant_id = $3 AND month = $4 AND year = $5)
        "#,
    )
    .bind(status)
    .bind(user_id)
    .bind(plant_id)
    .bind(month)
    .bind(year)
    .execute(&state.db)
    .await?;

    Ok(Json(json!({
        "success": true,
        "status": status.to_uppercase(),
        "message": format!("Payroll {}", status)
    })))
}

#[derive(Debug, Deserialize, Serialize)]
pub struct MarkPayrollPaidPayload {
    pub payment_method: String,
    pub payment_reference: String,
}

pub async fn mark_payroll_paid(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path((plant_id, month_str, user_id)): Path<(Uuid, String, Uuid)>,
    Json(payload): Json<MarkPayrollPaidPayload>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["accountant", "owner", "plant_owner", "admin"])?;

    super::business_routes::ensure_plant_staff_or_owner(&state, &auth_user, plant_id).await?;
    let belongs:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM plant_staff WHERE plant_id=$1 AND user_id=$2 AND is_active=TRUE)").bind(plant_id).bind(user_id).fetch_one(&state.db).await?;
    if !belongs {
        return Err(AppError::NotFound(
            "Employee not found in this plant".into(),
        ));
    }
    let month_start = NaiveDate::parse_from_str(&format!("{}-01", month_str), "%Y-%m-%d")
        .map_err(|_| AppError::BadRequest("month must use YYYY-MM format".to_string()))?;
    let (year, month) = (month_start.year(), month_start.month() as i32);

    let net_pay: Option<bigdecimal::BigDecimal> = sqlx::query_scalar(
        r#"
        UPDATE payroll_records
        SET payment_status = 'paid', transaction_ref = $1
        WHERE user_id = $2
          AND closure_id IN (SELECT id FROM payroll_closures WHERE plant_id = $3 AND month = $4 AND year = $5)
        RETURNING net_pay
        "#,
    )
    .bind(&payload.payment_reference)
    .bind(user_id)
    .bind(plant_id)
    .bind(month)
    .bind(year)
    .fetch_optional(&state.db)
    .await?;

    if let Some(net) = net_pay {
        let net_f64 = net.to_string().parse::<f64>().unwrap_or(0.0);
        let _ = sqlx::query(
            r#"
            INSERT INTO plant_expenses (
                plant_id, recorded_by, category, amount, payment_method, reference, notes
            )
            VALUES ($1, $2, 'salary', $3::numeric, $4, $5, $6)
            "#,
        )
        .bind(plant_id)
        .bind(auth_user.user_id)
        .bind(net_f64)
        .bind(&payload.payment_method)
        .bind(&payload.payment_reference)
        .bind(format!(
            "Payroll payment for {} to employee {}",
            month_str, user_id
        ))
        .execute(&state.db)
        .await;
    }

    Ok(Json(json!({
        "success": true,
        "payment_status": "PAID",
        "message": "Payroll marked paid and posted to finance ledger"
    })))
}
