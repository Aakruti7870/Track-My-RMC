use crate::{
    auth::{middleware::check_role, AuthUser},
    error::AppError,
    state::AppState,
};
use chrono::{Datelike, NaiveDate};
use serde_json::{json, Value};
use sqlx::{Postgres, Row, Transaction};
use uuid::Uuid;

pub struct Period {
    pub plant: Uuid,
    pub year: i32,
    pub month: i32,
}
impl Period {
    pub fn parse(plant: Uuid, value: &str) -> Result<Self, AppError> {
        let date = NaiveDate::parse_from_str(&format!("{value}-01"), "%Y-%m-%d")
            .map_err(|_| AppError::BadRequest("Month must use YYYY-MM".into()))?;
        if date.format("%Y-%m").to_string() != value || date.year() < 2020 || date.year() > 9999 {
            return Err(AppError::BadRequest("Invalid payroll month".into()));
        }
        Ok(Self {
            plant,
            year: date.year(),
            month: date.month() as i32,
        })
    }
}
async fn lock(tx: &mut Transaction<'_, Postgres>, p: &Period) -> Result<(Uuid, bool), AppError> {
    sqlx::query("INSERT INTO payroll_closures(plant_id,year,month) VALUES($1,$2,$3) ON CONFLICT(plant_id,month,year) DO NOTHING").bind(p.plant).bind(p.year).bind(p.month).execute(&mut **tx).await?;
    Ok(sqlx::query_as("SELECT id,is_closed FROM payroll_closures WHERE plant_id=$1 AND year=$2 AND month=$3 FOR UPDATE").bind(p.plant).bind(p.year).bind(p.month).fetch_one(&mut **tx).await?)
}
async fn employee(state: &AppState, user: &AuthUser, p: &Period, id: Uuid) -> Result<(), AppError> {
    crate::routes::business_routes::ensure_plant_staff_or_owner(state, user, p.plant).await?;
    let active:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM plant_staff WHERE plant_id=$1 AND user_id=$2 AND is_active=TRUE)").bind(p.plant).bind(id).fetch_one(&state.db).await?;
    if !active {
        return Err(AppError::NotFound(
            "Active employee not found in this plant".into(),
        ));
    }
    Ok(())
}
async fn record_row(
    tx: &mut Transaction<'_, Postgres>,
    closure: Uuid,
    user: Uuid,
) -> Result<Option<sqlx::postgres::PgRow>, AppError> {
    let mut rows =
        sqlx::query("SELECT * FROM payroll_records WHERE closure_id=$1 AND user_id=$2 FOR UPDATE")
            .bind(closure)
            .bind(user)
            .fetch_all(&mut **tx)
            .await?;
    if rows.len() > 1 {
        return Err(AppError::Conflict(
            "Historical duplicate payroll records require reconciliation".into(),
        ));
    }
    Ok(rows.pop())
}
async fn audit(
    tx: &mut Transaction<'_, Postgres>,
    actor: Uuid,
    id: Uuid,
    action: &str,
    metadata: Value,
) -> Result<(), AppError> {
    sqlx::query("INSERT INTO audit_logs(user_id,action,resource_type,resource_id,metadata) VALUES($1,$2,'payroll',$3,$4)").bind(actor).bind(action).bind(id.to_string()).bind(metadata).execute(&mut **tx).await?;
    Ok(())
}

pub async fn draft(
    state: &AppState,
    user: &AuthUser,
    p: Period,
    employee_id: Uuid,
    input: crate::routes::workforce_reports::PayrollDraftPayload,
) -> Result<Value, AppError> {
    check_role(user, &["accountant"])?;
    employee(state, user, &p, employee_id).await?;
    let allowances = input.allowances.unwrap_or(0.0);
    let overtime = input.overtime_amount.unwrap_or(0.0);
    let deductions = input.deductions.unwrap_or(0.0);
    if [input.basic_amount, allowances, overtime, deductions]
        .iter()
        .any(|v| {
            !v.is_finite()
                || *v < 0.0
                || *v > 99_999_999.99
                || (*v * 100.0 - (*v * 100.0).round()).abs() > 0.00001
        })
        || input
            .paid_days
            .is_some_and(|d| !d.is_finite() || !(0.0..=31.0).contains(&d))
    {
        return Err(AppError::BadRequest(
            "Invalid payroll amounts or paid days".into(),
        ));
    }
    let net = input.basic_amount + allowances + overtime - deductions;
    if !(0.0..=99_999_999.99).contains(&net) {
        return Err(AppError::BadRequest("Invalid net payroll amount".into()));
    }
    let mut tx = state.db.begin().await?;
    let (closure, closed) = lock(&mut tx, &p).await?;
    if closed {
        return Err(AppError::Conflict("Payroll period is closed".into()));
    }
    let row = record_row(&mut tx, closure, employee_id).await?;
    let id = if let Some(row) = row {
        let status: String = row.get("payment_status");
        if status == "paid" {
            return Err(AppError::Conflict("Paid payroll is immutable".into()));
        }
        row.get("id")
    } else {
        Uuid::new_v4()
    };
    sqlx::query("INSERT INTO payroll_records(id,closure_id,user_id,basic_pay,allowances,overtime_amount,deductions,net_pay,paid_days,notes,payment_status) VALUES($1,$2,$3,$4::numeric,$5::numeric,$6::numeric,$7::numeric,$8::numeric,$9::numeric,$10,'draft') ON CONFLICT(id) DO UPDATE SET basic_pay=EXCLUDED.basic_pay,allowances=EXCLUDED.allowances,overtime_amount=EXCLUDED.overtime_amount,deductions=EXCLUDED.deductions,net_pay=EXCLUDED.net_pay,paid_days=EXCLUDED.paid_days,notes=EXCLUDED.notes,payment_status='draft'")
 .bind(id).bind(closure).bind(employee_id).bind(input.basic_amount).bind(allowances).bind(overtime).bind(deductions).bind(net).bind(input.paid_days).bind(input.notes).execute(&mut *tx).await?;
    audit(
        &mut tx,
        user.user_id,
        id,
        "payroll_draft",
        json!({"employee_id":employee_id}),
    )
    .await?;
    tx.commit().await?;
    Ok(
        json!({"success":true,"payroll":{"id":id,"status":"DRAFT","basic_amount":input.basic_amount,"allowances":allowances,"overtime_amount":overtime,"deductions":deductions,"net_amount":net,"paid_days":input.paid_days}}),
    )
}
pub async fn decide(
    state: &AppState,
    user: &AuthUser,
    p: Period,
    employee_id: Uuid,
    action: &str,
    note: Option<String>,
) -> Result<Value, AppError> {
    check_role(user, &["owner", "plant_owner"])?;
    employee(state, user, &p, employee_id).await?;
    let status = match action.to_uppercase().as_str() {
        "APPROVE" => "approved",
        "RETURN" | "REJECT" => "returned",
        _ => {
            return Err(AppError::BadRequest(
                "Decision must be APPROVE or RETURN".into(),
            ))
        }
    };
    let mut tx = state.db.begin().await?;
    let (closure, closed) = lock(&mut tx, &p).await?;
    if closed {
        return Err(AppError::Conflict("Payroll period is closed".into()));
    }
    let row = record_row(&mut tx, closure, employee_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Payroll draft not found".into()))?;
    let id: Uuid = row.get("id");
    let current: String = row.get("payment_status");
    if !["draft", "returned", "approved"].contains(&current.as_str()) {
        return Err(AppError::Conflict(
            "Payroll cannot be reviewed in this state".into(),
        ));
    }
    sqlx::query("UPDATE payroll_records SET payment_status=$2 WHERE id=$1")
        .bind(id)
        .bind(status)
        .execute(&mut *tx)
        .await?;
    audit(
        &mut tx,
        user.user_id,
        id,
        "payroll_decision",
        json!({"from":current,"to":status,"note":note}),
    )
    .await?;
    tx.commit().await?;
    Ok(json!({"success":true,"status":status.to_uppercase()}))
}
pub async fn pay(
    state: &AppState,
    user: &AuthUser,
    p: Period,
    employee_id: Uuid,
    method: &str,
    reference: &str,
) -> Result<Value, AppError> {
    check_role(user, &["accountant"])?;
    employee(state, user, &p, employee_id).await?;
    let method = method.trim().to_ascii_lowercase();
    let reference = reference.trim();
    if !["bank_transfer", "cash", "upi", "cheque"].contains(&method.as_str())
        || reference.is_empty()
        || reference.len() > 100
    {
        return Err(AppError::BadRequest(
            "Valid payment method and reference are required".into(),
        ));
    }
    let mut tx = state.db.begin().await?;
    let (closure, closed) = lock(&mut tx, &p).await?;
    let row = record_row(&mut tx, closure, employee_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Payroll not found".into()))?;
    let id: Uuid = row.get("id");
    let current: String = row.get("payment_status");
    if current == "paid" {
        if row.get::<Option<String>, _>("transaction_ref").as_deref() != Some(reference)
            || row.get::<Option<String>, _>("payment_method").as_deref() != Some(method.as_str())
        {
            return Err(AppError::Conflict(
                "Paid payroll retry does not match original payment".into(),
            ));
        }
        tx.commit().await?;
        return Ok(json!({"success":true,"payment_status":"PAID"}));
    }
    if closed || current != "approved" {
        return Err(AppError::Conflict(
            "Payroll must be approved in an open period".into(),
        ));
    }
    let net: bigdecimal::BigDecimal = row.get("net_pay");
    sqlx::query("INSERT INTO plant_expenses(plant_id,recorded_by,category,amount,payment_method,reference,notes,payroll_record_id) VALUES($1,$2,'salary',$3,$4,$5,$6,$7)")
  .bind(p.plant).bind(user.user_id).bind(net).bind(&method).bind(reference).bind(format!("Payroll {}/{:02} for {employee_id}",p.year,p.month)).bind(id).execute(&mut *tx).await?;
    sqlx::query("UPDATE payroll_records SET payment_status='paid',transaction_ref=$2,payment_method=$3,paid_on=CURRENT_DATE WHERE id=$1").bind(id).bind(reference).bind(method).execute(&mut *tx).await?;
    audit(
        &mut tx,
        user.user_id,
        id,
        "payroll_paid",
        json!({"employee_id":employee_id}),
    )
    .await?;
    tx.commit().await?;
    Ok(json!({"success":true,"payment_status":"PAID"}))
}
pub async fn close(
    state: &AppState,
    user: &AuthUser,
    p: Period,
    note: Option<String>,
) -> Result<Value, AppError> {
    check_role(user, &["owner", "plant_owner"])?;
    crate::routes::business_routes::ensure_plant_staff_or_owner(state, user, p.plant).await?;
    let mut tx = state.db.begin().await?;
    let (closure, closed) = lock(&mut tx, &p).await?;
    if closed {
        tx.commit().await?;
        return Ok(json!({"success":true,"closure_id":closure}));
    }
    let ready:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM plant_staff WHERE plant_id=$1 AND is_active=TRUE) AND NOT EXISTS(SELECT 1 FROM plant_staff ps WHERE ps.plant_id=$1 AND ps.is_active=TRUE AND (SELECT COUNT(*) FROM payroll_records r WHERE r.closure_id=$2 AND r.user_id=ps.user_id AND r.payment_status='paid')<>1) AND NOT EXISTS(SELECT 1 FROM payroll_records WHERE closure_id=$2 AND payment_status<>'paid')").bind(p.plant).bind(closure).fetch_one(&mut *tx).await?;
    if !ready {
        return Err(AppError::Conflict(
            "Every active employee requires one paid payroll record before closure".into(),
        ));
    }
    let duplicate:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM payroll_records WHERE closure_id=$1 GROUP BY user_id HAVING COUNT(*)>1)").bind(closure).fetch_one(&mut *tx).await?;
    if duplicate {
        return Err(AppError::Conflict(
            "Duplicate payroll records require reconciliation".into(),
        ));
    }
    let version:i32=sqlx::query_scalar("UPDATE payroll_closures c SET is_closed=TRUE,closed_at=NOW(),closed_by=$2,override_reason=$3,closure_version=closure_version+1,total_gross=(SELECT COALESCE(SUM(basic_pay+allowances+COALESCE(overtime_amount,0)),0) FROM payroll_records WHERE closure_id=c.id),total_net=(SELECT COALESCE(SUM(net_pay),0) FROM payroll_records WHERE closure_id=c.id),employee_count=(SELECT COUNT(*)::INT FROM payroll_records WHERE closure_id=c.id) WHERE id=$1 RETURNING closure_version").bind(closure).bind(user.user_id).bind(note).fetch_one(&mut *tx).await?;
    sqlx::query("INSERT INTO payroll_payslip_snapshots(closure_id,closure_version,user_id,snapshot) SELECT $1,$2,r.user_id,jsonb_build_object('id',r.id,'payslip_number','PS-'||$3::text||'-'||r.id::text,'month',$3,'employee_name',u.full_name,'employee_code',h.employee_code,'role',ps.role,'closure_version',$2,'payroll_snapshot',jsonb_build_object('basic_amount',r.basic_pay::DOUBLE PRECISION,'allowances',r.allowances::DOUBLE PRECISION,'overtime_amount',r.overtime_amount::DOUBLE PRECISION,'deductions',r.deductions::DOUBLE PRECISION,'paid_days',r.paid_days::DOUBLE PRECISION,'net_amount',r.net_pay::DOUBLE PRECISION,'payment_method',r.payment_method,'payment_reference',r.transaction_ref,'paid_on',r.paid_on)) FROM payroll_records r JOIN users u ON u.id=r.user_id LEFT JOIN plant_staff ps ON ps.user_id=r.user_id AND ps.plant_id=$4 LEFT JOIN employee_hr_profiles h ON h.user_id=r.user_id AND h.plant_id=$4 WHERE r.closure_id=$1")
  .bind(closure).bind(version).bind(format!("{}-{:02}",p.year,p.month)).bind(p.plant).execute(&mut *tx).await?;
    audit(
        &mut tx,
        user.user_id,
        closure,
        "payroll_closed",
        json!({"version":version}),
    )
    .await?;
    tx.commit().await?;
    Ok(json!({"success":true,"closure_id":closure,"closure_version":version}))
}
