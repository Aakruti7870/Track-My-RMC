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
            SELECT id, total_gross, total_net, employee_count, is_closed, closed_at, reopen_reason, reopened_at, closure_version
            FROM payroll_closures
            WHERE plant_id = $1 AND month = $2 AND year = $3
            "#,
        )
        .bind(plant_id)
        .bind(month)
        .bind(year)
        .fetch_optional(&state.db)
        .await?;

        let (is_closed, closed_at, reopen_reason, cid) = match closure {
            Some(ref c) => {
                let cl: bool = c.get("is_closed");
                let ca: Option<chrono::DateTime<chrono::Utc>> = c.get("closed_at");
                let or: Option<String> = c.get("reopen_reason");
                let id: Uuid = c.get("id");
                (cl, ca, or, Some(id))
            }
            None => (false, None, None, None),
        };

        let payslip_count: i64 = if let Some(id) = cid {
            sqlx::query_scalar("SELECT COUNT(*) FROM payroll_payslip_snapshots s JOIN payroll_closures c ON c.id=s.closure_id WHERE s.closure_id=$1 AND s.closure_version=c.closure_version")
                .bind(id)
                .fetch_one(&state.db)
                .await?
        } else {
            0
        };

        let readiness:serde_json::Value=sqlx::query_scalar("SELECT jsonb_build_object('employee_count',COUNT(*),'paid_count',COUNT(*) FILTER(WHERE r.status='paid' AND r.records=1),'ready',COUNT(*)>0 AND COUNT(*) FILTER(WHERE r.status='paid' AND r.records=1)=COUNT(*),'missing_user_ids',COALESCE(jsonb_agg(ps.user_id) FILTER(WHERE r.records=0),'[]'::jsonb),'unpaid',COALESCE(jsonb_agg(jsonb_build_object('user_id',ps.user_id,'status',COALESCE(r.status,'MISSING'))) FILTER(WHERE r.status IS DISTINCT FROM 'paid' OR r.records<>1),'[]'::jsonb),'payment_locked_user_ids','[]'::jsonb) FROM plant_staff ps LEFT JOIN LATERAL(SELECT COUNT(*) records,MIN(payment_status) status FROM payroll_records WHERE user_id=ps.user_id AND closure_id=$2) r ON TRUE WHERE ps.plant_id=$1 AND ps.is_active=TRUE").bind(plant_id).bind(cid).fetch_one(&state.db).await?;
        periods.push(json!({
            "plant_id": plant_id,
            "plant_name": plant_name,
            "month": month_str,
            "status": if is_closed { "CLOSED" } else if closure.as_ref().is_some_and(|c|c.get::<Option<chrono::DateTime<chrono::Utc>>,_>("reopened_at").is_some()) {"REOPENED"} else { "OPEN" },
            "version": closure.as_ref().map(|c|c.get::<i32,_>("closure_version")).unwrap_or(0),
            "reopened_at":closure.as_ref().and_then(|c|c.get::<Option<chrono::DateTime<chrono::Utc>>,_>("reopened_at")),
            "closed_at": closed_at,
            "reopen_reason": reopen_reason,
            "payslip_count": payslip_count,
            "readiness": readiness
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
    let period = crate::services::payroll_lifecycle::Period::parse(plant_id, &month_str)?;
    Ok(Json(
        crate::services::payroll_lifecycle::close(
            &state,
            &auth_user,
            period,
            payload.and_then(|p| p.0.override_reason),
        )
        .await?,
    ))
}

#[derive(Deserialize)]
pub struct ReopenPeriodPayload {
    pub reason: String,
}

pub async fn reopen_payroll_period(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path((plant_id, month)): Path<(Uuid, String)>,
    Json(payload): Json<ReopenPeriodPayload>,
) -> Result<impl IntoResponse, AppError> {
    let period = crate::services::payroll_lifecycle::Period::parse(plant_id, &month)?;
    Ok(Json(
        crate::services::payroll_lifecycle::reopen(&state, &auth_user, period, payload.reason)
            .await?,
    ))
}

pub async fn list_period_payslips(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path((plant_id, month_str)): Path<(Uuid, String)>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["accountant", "owner", "plant_owner", "admin"])?;
    super::business_routes::ensure_plant_staff_or_owner(&state, &auth_user, plant_id).await?;
    let (year, month) = parse_year_month(&month_str)?;

    let payslips:Vec<serde_json::Value>=sqlx::query_scalar("SELECT s.snapshot FROM payroll_payslip_snapshots s JOIN payroll_closures c ON c.id=s.closure_id WHERE c.plant_id=$1 AND c.year=$2 AND c.month=$3 AND s.closure_version=c.closure_version ORDER BY s.user_id").bind(plant_id).bind(year).bind(month).fetch_all(&state.db).await?;
    Ok(Json(json!({"success":true,"payslips":payslips})))
}

pub async fn export_payroll_csv(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path((plant_id, month_str)): Path<(Uuid, String)>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["accountant", "owner", "plant_owner", "admin"])?;
    super::business_routes::ensure_plant_staff_or_owner(&state, &auth_user, plant_id).await?;
    let (year, month) = parse_year_month(&month_str)?;

    let rows:Vec<serde_json::Value>=sqlx::query_scalar("SELECT s.snapshot FROM payroll_payslip_snapshots s JOIN payroll_closures c ON c.id=s.closure_id WHERE c.plant_id=$1 AND c.year=$2 AND c.month=$3 AND s.closure_version=c.closure_version ORDER BY s.user_id").bind(plant_id).bind(year).bind(month).fetch_all(&state.db).await?;
    let mut csv=String::from("Payslip,Employee Name,Role,Basic Pay,Allowances,Overtime,Deductions,Paid Days,Net Pay,Payment Reference,Closure Version\n");
    for row in rows {
        let pay = &row["payroll_snapshot"];
        let fields = [
            &row["payslip_number"],
            &row["employee_name"],
            &row["role"],
            &pay["basic_amount"],
            &pay["allowances"],
            &pay["overtime_amount"],
            &pay["deductions"],
            &pay["paid_days"],
            &pay["net_amount"],
            &pay["payment_reference"],
            &row["closure_version"],
        ];
        let cells: Vec<String> = fields
            .iter()
            .map(|v| {
                let mut text = if v.is_null() {
                    String::new()
                } else {
                    v.as_str()
                        .map(String::from)
                        .unwrap_or_else(|| v.to_string())
                };
                if text.starts_with(['=', '+', '-', '@', '\t', '\r']) {
                    text.insert(0, '\'');
                }
                format!("\"{}\"", text.replace('\"', "\"\""))
            })
            .collect();
        csv.push_str(&cells.join(","));
        csv.push('\n');
    }
    Ok(Json(
        json!({"success":true,"filename":format!("payroll_{plant_id}_{month_str}.csv"),"csv":csv}),
    ))
}

pub async fn get_my_payslip(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(month_str): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    let (year, month) = parse_year_month(&month_str)?;

    let snapshot:Option<serde_json::Value>=sqlx::query_scalar("SELECT s.snapshot FROM payroll_payslip_snapshots s JOIN payroll_closures c ON c.id=s.closure_id WHERE s.user_id=$1 AND c.year=$2 AND c.month=$3 ORDER BY s.created_at DESC,s.closure_version DESC LIMIT 1").bind(auth_user.user_id).bind(year).bind(month).fetch_optional(&state.db).await?;
    Ok(Json(
        json!({"success":true,"historical":true,"payslip":snapshot}),
    ))
}
