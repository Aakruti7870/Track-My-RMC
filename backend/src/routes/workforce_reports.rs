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

use super::staff_module_permissions::{self, Action};

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
    let modules =
        staff_module_permissions::viewable_modules(&state, &auth_user, query.plant_id).await?;
    if !modules.contains("workforce") {
        return Err(AppError::Forbidden(
            "Workforce view permission required".into(),
        ));
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

    let payroll = if modules.contains("payroll") {
        sqlx::query(
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
        .await?
    } else {
        None
    };

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

#[derive(Default, Deserialize)]
pub struct MonthlyReportFilters {
    pub plant_id: Option<Uuid>,
    #[serde(default)]
    pub payroll_only: bool,
}

const MONTHLY_EMPLOYEE_EVIDENCE: &str = r#"
    WITH attendance AS (
        SELECT user_id,
            COUNT(*) FILTER (WHERE status = 'present') AS days,
            COUNT(*) FILTER (WHERE check_out_time >= check_in_time) AS completed,
            COUNT(*) FILTER (WHERE check_in_time IS NOT NULL AND check_out_time IS NULL) AS open_shifts,
            COALESCE(SUM(EXTRACT(EPOCH FROM check_out_time - check_in_time))
                FILTER (WHERE check_out_time >= check_in_time), 0)::DOUBLE PRECISION / 3600 AS hours
        FROM workforce_attendance
        WHERE plant_id = $1 AND attendance_date >= $2::date AND attendance_date < $3::date
        GROUP BY user_id
    ), leave_dates AS (
        SELECT DISTINCT l.user_id, l.leave_type, day::date AS day
        FROM workforce_leave_requests l
        CROSS JOIN LATERAL generate_series(
            GREATEST(l.start_date, $2::date)::timestamp,
            LEAST(l.end_date, $3::date - 1)::timestamp,
            INTERVAL '1 day'
        ) AS dates(day)
        WHERE l.plant_id = $1 AND l.status = 'APPROVED'
          AND l.end_date >= $2 AND l.start_date < $3
    ), leave_totals AS (
        SELECT user_id, COUNT(DISTINCT day) AS days FROM leave_dates GROUP BY user_id
    ), leave_types AS (
        SELECT user_id, jsonb_object_agg(leave_type, days) AS counts
        FROM (SELECT user_id, leave_type, COUNT(*) AS days FROM leave_dates GROUP BY user_id, leave_type) types
        GROUP BY user_id
    ), visits AS (
        SELECT user_id, COUNT(*) AS completed FROM workforce_client_visits
        WHERE plant_id = $1 AND status = 'COMPLETED'
          AND scheduled_for >= ($2::date::timestamp AT TIME ZONE 'Asia/Kolkata')
          AND scheduled_for < ($3::date::timestamp AT TIME ZONE 'Asia/Kolkata')
        GROUP BY user_id
    ), expenses AS (
        SELECT user_id, SUM(amount)::DOUBLE PRECISION AS total FROM workforce_expense_claims
        WHERE plant_id = $1 AND status = 'APPROVED' AND expense_date >= $2 AND expense_date < $3
        GROUP BY user_id
    )
    SELECT u.id, u.full_name, ps.role,
        COALESCE(a.days, 0) AS attendance_days, COALESCE(a.completed, 0) AS completed_shifts,
        COALESCE(a.open_shifts, 0) AS open_shifts, COALESCE(a.hours, 0) AS attendance_hours,
        COALESCE(l.days, 0) AS approved_leave_days, COALESCE(t.counts, '{}'::jsonb) AS leave_days_by_type,
        COALESCE(v.completed, 0) AS completed_client_visits, COALESCE(e.total, 0) AS approved_expenses
    FROM plant_staff ps
    JOIN users u ON u.id = ps.user_id AND u.is_active
    LEFT JOIN attendance a ON a.user_id = u.id
    LEFT JOIN leave_totals l ON l.user_id = u.id
    LEFT JOIN leave_types t ON t.user_id = u.id
    LEFT JOIN visits v ON v.user_id = u.id
    LEFT JOIN expenses e ON e.user_id = u.id
    WHERE ps.plant_id = $1 AND ps.is_active AND ps.removed_at IS NULL
      AND ps.employment_status = 'ACTIVE'
    ORDER BY u.full_name, u.id
"#;

/// Month-specific workforce evidence and payroll records, scoped to the caller's plant grants.
pub async fn monthly_workforce_report(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(month_str): Path<String>,
    Query(filters): Query<MonthlyReportFilters>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["owner", "plant_owner", "admin", "accountant"])?;

    let month_start = NaiveDate::parse_from_str(&format!("{month_str}-01"), "%Y-%m-%d")
        .map_err(|_| AppError::BadRequest("month must use YYYY-MM format".into()))?;
    if month_start.format("%Y-%m").to_string() != month_str {
        return Err(AppError::BadRequest("month must use YYYY-MM format".into()));
    }
    let next_month = month_start
        .checked_add_months(chrono::Months::new(1))
        .ok_or_else(|| AppError::BadRequest("invalid month".into()))?;

    let plants: Vec<(Uuid, String)> = sqlx::query_as(
        r#"
        SELECT p.id, p.name FROM rmc_plants p
        WHERE p.is_active AND ($3::uuid IS NULL OR p.id = $3)
          AND CASE WHEN $2 IN ('owner', 'plant_owner') THEN p.owner_id = $1
              ELSE EXISTS (
                SELECT 1 FROM plant_staff ps
                WHERE ps.plant_id = p.id AND ps.user_id = $1 AND ps.role = $2
                  AND ps.is_active AND ps.removed_at IS NULL AND ps.employment_status = 'ACTIVE'
              )
          END
        ORDER BY p.name, p.id
        "#,
    )
    .bind(auth_user.user_id)
    .bind(&auth_user.role)
    .bind(filters.plant_id)
    .fetch_all(&state.db)
    .await?;

    let mut reports = Vec::new();
    for (plant_id, plant_name) in plants {
        let modules =
            staff_module_permissions::viewable_modules(&state, &auth_user, plant_id).await?;
        let payroll_visible = modules.contains("payroll");
        if (filters.payroll_only && !payroll_visible)
            || (!filters.payroll_only && !modules.contains("workforce"))
        {
            continue;
        }
        let payroll_editable = if auth_user.role == "accountant" && payroll_visible {
            match staff_module_permissions::require(
                &state,
                &auth_user,
                plant_id,
                "payroll",
                Action::Edit,
            )
            .await
            {
                Ok(()) => true,
                Err(AppError::Forbidden(_)) => false,
                Err(error) => return Err(error),
            }
        } else {
            false
        };
        let staff_rows = sqlx::query(MONTHLY_EMPLOYEE_EVIDENCE)
            .bind(plant_id)
            .bind(month_start)
            .bind(next_month)
            .fetch_all(&state.db)
            .await?;

        let mut payroll_by_employee = std::collections::HashMap::new();
        let mut total_payroll = 0.0;
        let mut status_counts = std::collections::HashMap::new();
        if payroll_visible {
            let payroll_rows = sqlx::query(
                r#"
                SELECT r.id, r.user_id, r.basic_pay::DOUBLE PRECISION AS basic,
                    r.allowances::DOUBLE PRECISION AS allowances, r.overtime_amount::DOUBLE PRECISION AS overtime,
                    r.deductions::DOUBLE PRECISION AS deductions, r.net_pay::DOUBLE PRECISION AS net,
                    r.paid_days::DOUBLE PRECISION AS paid_days, r.payment_status, r.transaction_ref, r.notes
                FROM payroll_records r
                JOIN payroll_closures c ON c.id = r.closure_id
                WHERE c.plant_id = $1 AND c.year = $2 AND c.month = $3
                "#,
            )
            .bind(plant_id)
            .bind(month_start.year())
            .bind(month_start.month() as i32)
            .fetch_all(&state.db)
            .await?;
            for row in payroll_rows {
                let status = row.get::<String, _>("payment_status").to_uppercase();
                let net: f64 = row.get("net");
                total_payroll += net;
                *status_counts.entry(status.clone()).or_insert(0) += 1;
                let previous = payroll_by_employee.insert(
                    row.get::<Uuid, _>("user_id"),
                    json!({
                        "id": row.get::<Uuid, _>("id"),
                        "status": status,
                        "basic_amount": row.get::<f64, _>("basic"),
                        "allowances": row.get::<f64, _>("allowances"),
                        "overtime_amount": row.get::<Option<f64>, _>("overtime"),
                        "deductions": row.get::<f64, _>("deductions"),
                        "paid_days": row.get::<Option<f64>, _>("paid_days"),
                        "net_amount": net,
                        "payment_reference": row.get::<Option<String>, _>("transaction_ref"),
                        "notes": row.get::<Option<String>, _>("notes"),
                    }),
                );
                if previous.is_some() {
                    return Err(AppError::Conflict(
                        "Historical duplicate payroll records require reconciliation".into(),
                    ));
                }
            }
        }

        let sum_counts = |column| {
            staff_rows
                .iter()
                .map(|row| row.get::<i64, _>(column))
                .sum::<i64>()
        };
        let approved_expenses = staff_rows
            .iter()
            .map(|row| row.get::<f64, _>("approved_expenses"))
            .sum::<f64>();
        let employees: Vec<_> = staff_rows
            .iter()
            .map(|row| {
                let id: Uuid = row.get("id");
                json!({
                    "user_id": id,
                    "user_name": row.get::<String, _>("full_name"),
                    "role": row.get::<String, _>("role"),
                    "attendance_days": row.get::<i64, _>("attendance_days"),
                    "completed_shifts": row.get::<i64, _>("completed_shifts"),
                    "open_shifts": row.get::<i64, _>("open_shifts"),
                    "attendance_hours": row.get::<f64, _>("attendance_hours"),
                    "approved_leave_days": row.get::<i64, _>("approved_leave_days"),
                    "leave_days_by_type": row.get::<serde_json::Value, _>("leave_days_by_type"),
                    "completed_client_visits": row.get::<i64, _>("completed_client_visits"),
                    "approved_expenses": row.get::<f64, _>("approved_expenses"),
                    "payroll": payroll_by_employee.get(&id),
                })
            })
            .collect();
        reports.push(json!({
            "plant_id": plant_id,
            "plant_name": plant_name,
            "month": month_str,
            "calendar_days": (next_month - month_start).num_days(),
            "employee_count": employees.len(),
            "present_records": sum_counts("attendance_days"),
            "completed_shift_records": sum_counts("completed_shifts"),
            "open_shift_records": sum_counts("open_shifts"),
            "approved_leave_days": sum_counts("approved_leave_days"),
            "completed_client_visits": sum_counts("completed_client_visits"),
            "approved_expenses": approved_expenses,
            "payroll_visible": payroll_visible,
            "payroll_editable": payroll_editable,
            "payroll_total": payroll_visible.then_some(total_payroll),
            "payroll_status_counts": status_counts,
            "employees": employees,
            "payroll_note": "Attendance is evidence. Salary requires approved payroll."
        }));
    }

    Ok(Json(json!({ "month": month_str, "reports": reports })))
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
    let period = crate::services::payroll_lifecycle::Period::parse(plant_id, &month_str)?;
    Ok(Json(
        crate::services::payroll_lifecycle::draft(&state, &auth_user, period, user_id, payload)
            .await?,
    ))
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
    let period = crate::services::payroll_lifecycle::Period::parse(plant_id, &month_str)?;
    Ok(Json(
        crate::services::payroll_lifecycle::decide(
            &state,
            &auth_user,
            period,
            user_id,
            &payload.action,
            payload.note,
        )
        .await?,
    ))
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
    let period = crate::services::payroll_lifecycle::Period::parse(plant_id, &month_str)?;
    Ok(Json(
        crate::services::payroll_lifecycle::pay(
            &state,
            &auth_user,
            period,
            user_id,
            &payload.payment_method,
            &payload.payment_reference,
        )
        .await?,
    ))
}
