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

async fn get_staff_plant_ids(
    state: &AppState,
    auth_user: &AuthUser,
) -> Result<Vec<Uuid>, AppError> {
    if auth_user.role == "owner" || auth_user.role == "plant_owner" {
        let rows =
            sqlx::query("SELECT id FROM rmc_plants WHERE owner_id = $1 AND is_active = TRUE")
                .bind(auth_user.user_id)
                .fetch_all(&state.db)
                .await?;
        let ids: Vec<Uuid> = rows.into_iter().map(|r| r.get("id")).collect();
        if !ids.is_empty() {
            return Ok(ids);
        }
    }
    let rows =
        sqlx::query("SELECT plant_id FROM plant_staff WHERE user_id = $1 AND is_active = TRUE")
            .bind(auth_user.user_id)
            .fetch_all(&state.db)
            .await?;

    let ids: Vec<Uuid> = rows.into_iter().map(|r| r.get("plant_id")).collect();
    if ids.is_empty() {
        return Err(AppError::Forbidden(
            "No active plant found for this user".to_string(),
        ));
    }
    Ok(ids)
}

pub async fn list_employees(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<impl IntoResponse, AppError> {
    check_role(
        &auth_user,
        &["owner", "plant_owner", "accountant", "supervisor", "admin"],
    )?;
    let plant_ids = get_staff_plant_ids(&state, &auth_user).await?;
    let can_edit =
        auth_user.role == "owner" || auth_user.role == "plant_owner" || auth_user.role == "admin";

    let mut plants_json = Vec::new();
    for plant_id in plant_ids {
        let rows = sqlx::query(
            r#"
            SELECT u.id as user_id, u.full_name, u.phone, u.email, ps.role,
                   hr.employee_code, hr.designation, hr.department, hr.join_date,
                   hr.employment_type, hr.weekly_off_day, hr.work_location,
                   hr.emergency_contact_name, hr.emergency_contact_phone, hr.document_references,
                   sp.effective_from, sp.pay_basis, sp.basic_amount, sp.hra_amount,
                   sp.allowances, sp.overtime_rate_per_hour, sp.fixed_deductions,
                   sp.employee_pf, sp.employee_esi, sp.professional_tax, sp.tds, sp.deductions
            FROM plant_staff ps
            INNER JOIN users u ON u.id = ps.user_id
            LEFT JOIN employee_hr_profiles hr ON hr.user_id = u.id AND hr.plant_id = $1
            LEFT JOIN employee_salary_profiles sp ON sp.user_id = u.id AND sp.plant_id = $1
            WHERE ps.plant_id = $1 AND ps.is_active = TRUE
            ORDER BY u.full_name
            "#,
        )
        .bind(plant_id)
        .fetch_all(&state.db)
        .await?;

        let mut employees = Vec::new();
        for r in rows {
            let uid: Uuid = r.get("user_id");
            let name: String = r.get("full_name");
            let phone: Option<String> = r.get("phone");
            let email: Option<String> = r.get("email");
            let role: String = r.get("role");

            let emp_code: Option<String> = r.get("employee_code");
            let designation: Option<String> = r.get("designation");
            let department: Option<String> = r.get("department");
            let join_date: Option<chrono::NaiveDate> = r.get("join_date");
            let emp_type: Option<String> = r.get("employment_type");
            let weekly_off: Option<String> = r.get("weekly_off_day");
            let work_loc: Option<String> = r.get("work_location");
            let em_name: Option<String> = r.get("emergency_contact_name");
            let em_phone: Option<String> = r.get("emergency_contact_phone");
            let doc_refs: Option<serde_json::Value> = r.get("document_references");

            let profile_obj = json!({
                "employee_code": emp_code,
                "designation": designation,
                "department": department,
                "join_date": join_date.map(|d| d.to_string()),
                "employment_type": emp_type.unwrap_or_else(|| "PERMANENT".to_string()),
                "weekly_off_day": weekly_off.unwrap_or_else(|| "SUNDAY".to_string()),
                "work_location": work_loc,
                "emergency_contact_name": em_name,
                "emergency_contact_phone": em_phone,
                "document_references": doc_refs.unwrap_or_else(|| json!([]))
            });

            let eff_from: Option<chrono::NaiveDate> = r.get("effective_from");
            let pay_basis: Option<String> = r.get("pay_basis");
            let basic: bigdecimal::BigDecimal = r
                .get::<Option<bigdecimal::BigDecimal>, _>("basic_amount")
                .unwrap_or_default();
            let hra: bigdecimal::BigDecimal = r
                .get::<Option<bigdecimal::BigDecimal>, _>("hra_amount")
                .unwrap_or_default();
            let other_allow: bigdecimal::BigDecimal = r
                .get::<Option<bigdecimal::BigDecimal>, _>("allowances")
                .unwrap_or_default();
            let ot_rate: bigdecimal::BigDecimal = r
                .get::<Option<bigdecimal::BigDecimal>, _>("overtime_rate_per_hour")
                .unwrap_or_default();
            let fix_deduct: bigdecimal::BigDecimal = r
                .get::<Option<bigdecimal::BigDecimal>, _>("fixed_deductions")
                .unwrap_or_default();
            let pf: bigdecimal::BigDecimal = r
                .get::<Option<bigdecimal::BigDecimal>, _>("employee_pf")
                .unwrap_or_default();
            let esi: bigdecimal::BigDecimal = r
                .get::<Option<bigdecimal::BigDecimal>, _>("employee_esi")
                .unwrap_or_default();
            let pt: bigdecimal::BigDecimal = r
                .get::<Option<bigdecimal::BigDecimal>, _>("professional_tax")
                .unwrap_or_default();
            let tds: bigdecimal::BigDecimal = r
                .get::<Option<bigdecimal::BigDecimal>, _>("tds")
                .unwrap_or_default();

            let total_allowances = &hra + &other_allow;
            let total_deductions = &fix_deduct + &pf + &esi + &pt + &tds;
            let gross = &basic + &total_allowances;
            let net_before_ot = &gross - &total_deductions;

            let salary_obj = json!({
                "effective_from": eff_from.map(|d| d.to_string()),
                "pay_basis": pay_basis.unwrap_or_else(|| "MONTHLY".to_string()),
                "basic_amount": basic,
                "hra_amount": hra,
                "other_allowances": other_allow,
                "overtime_rate_per_hour": ot_rate,
                "fixed_deductions": fix_deduct,
                "employee_pf": pf,
                "employee_esi": esi,
                "professional_tax": pt,
                "tds": tds
            });

            employees.push(json!({
                "user_id": uid,
                "name": name,
                "role": role,
                "email": email,
                "phone": phone,
                "profile": profile_obj,
                // Supervisors may need roster identity, not employee pay.
                "current_salary": if auth_user.role == "supervisor" { serde_json::Value::Null } else { salary_obj },
                "salary_totals": if auth_user.role == "supervisor" {
                    serde_json::Value::Null
                } else {
                    json!({
                        "allowances": total_allowances,
                        "deductions": total_deductions,
                        "gross": gross,
                        "net_before_overtime": net_before_ot
                    })
                }
            }));
        }

        plants_json.push(json!({
            "plant_id": plant_id,
            "employees": employees
        }));
    }

    Ok(Json(json!({
        "plants": plants_json,
        "can_edit": can_edit
    })))
}

#[derive(Debug, Deserialize, Serialize)]
pub struct UpdateProfilePayload {
    pub employee_code: Option<String>,
    pub designation: Option<String>,
    pub department: Option<String>,
    pub join_date: Option<String>,
    pub employment_type: Option<String>,
    pub weekly_off_day: Option<String>,
    pub work_location: Option<String>,
    pub emergency_contact_name: Option<String>,
    pub emergency_contact_phone: Option<String>,
    pub document_references: Option<Vec<String>>,
}

pub async fn update_employee_profile(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path((plant_id, user_id)): Path<(Uuid, Uuid)>,
    Json(payload): Json<UpdateProfilePayload>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["owner", "plant_owner", "admin"])?;

    ensure_employee_access(&state, &auth_user, plant_id, user_id).await?;
    let join_dt = payload
        .join_date
        .as_deref()
        .and_then(|s| chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").ok());
    let docs = payload
        .document_references
        .map(|v| json!(v))
        .unwrap_or_else(|| json!([]));

    sqlx::query(
        r#"
        INSERT INTO employee_hr_profiles (
            plant_id, user_id, employee_code, designation, department, join_date,
            employment_type, weekly_off_day, work_location, emergency_contact_name,
            emergency_contact_phone, document_references, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
        ON CONFLICT (user_id, plant_id) DO UPDATE SET
            employee_code = EXCLUDED.employee_code,
            designation = EXCLUDED.designation,
            department = EXCLUDED.department,
            join_date = EXCLUDED.join_date,
            employment_type = EXCLUDED.employment_type,
            weekly_off_day = EXCLUDED.weekly_off_day,
            work_location = EXCLUDED.work_location,
            emergency_contact_name = EXCLUDED.emergency_contact_name,
            emergency_contact_phone = EXCLUDED.emergency_contact_phone,
            document_references = EXCLUDED.document_references,
            updated_at = NOW()
        "#,
    )
    .bind(plant_id)
    .bind(user_id)
    .bind(payload.employee_code)
    .bind(payload.designation)
    .bind(payload.department)
    .bind(join_dt)
    .bind(
        payload
            .employment_type
            .unwrap_or_else(|| "PERMANENT".to_string()),
    )
    .bind(
        payload
            .weekly_off_day
            .unwrap_or_else(|| "SUNDAY".to_string()),
    )
    .bind(payload.work_location)
    .bind(payload.emergency_contact_name)
    .bind(payload.emergency_contact_phone)
    .bind(docs)
    .execute(&state.db)
    .await?;

    Ok(Json(
        json!({ "success": true, "message": "Employee profile saved" }),
    ))
}

#[derive(Debug, Deserialize, Serialize)]
pub struct UpdateSalaryPayload {
    pub effective_from: Option<String>,
    pub pay_basis: Option<String>,
    pub basic_amount: Option<f64>,
    pub hra_amount: Option<f64>,
    pub other_allowances: Option<f64>,
    pub overtime_rate_per_hour: Option<f64>,
    pub fixed_deductions: Option<f64>,
    pub employee_pf: Option<f64>,
    pub employee_esi: Option<f64>,
    pub professional_tax: Option<f64>,
    pub tds: Option<f64>,
}

pub async fn update_employee_salary(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path((plant_id, user_id)): Path<(Uuid, Uuid)>,
    Json(payload): Json<UpdateSalaryPayload>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["owner", "plant_owner", "admin"])?;

    ensure_employee_access(&state, &auth_user, plant_id, user_id).await?;
    let eff_dt = payload
        .effective_from
        .as_deref()
        .and_then(|s| chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").ok())
        .unwrap_or_else(|| chrono::Utc::now().naive_utc().date());

    let basic = payload.basic_amount.unwrap_or(0.0);
    let hra = payload.hra_amount.unwrap_or(0.0);
    let other = payload.other_allowances.unwrap_or(0.0);
    let ot = payload.overtime_rate_per_hour.unwrap_or(0.0);
    let fix = payload.fixed_deductions.unwrap_or(0.0);
    let pf = payload.employee_pf.unwrap_or(0.0);
    let esi = payload.employee_esi.unwrap_or(0.0);
    let pt = payload.professional_tax.unwrap_or(0.0);
    let tds = payload.tds.unwrap_or(0.0);

    let allow_total = hra + other;
    let deduct_total = fix + pf + esi + pt + tds;

    sqlx::query(
        r#"
        INSERT INTO employee_salary_profiles (
            plant_id, user_id, effective_from, pay_basis, basic_amount, hra_amount,
            allowances, overtime_rate_per_hour, fixed_deductions, employee_pf, employee_esi,
            professional_tax, tds, deductions, updated_at
        )
        VALUES ($1, $2, $3, $4, $5::numeric, $6::numeric, $7::numeric, $8::numeric, $9::numeric, $10::numeric, $11::numeric, $12::numeric, $13::numeric, $14::numeric, NOW())
        ON CONFLICT (user_id, plant_id) DO UPDATE SET
            effective_from = EXCLUDED.effective_from,
            pay_basis = EXCLUDED.pay_basis,
            basic_amount = EXCLUDED.basic_amount,
            hra_amount = EXCLUDED.hra_amount,
            allowances = EXCLUDED.allowances,
            overtime_rate_per_hour = EXCLUDED.overtime_rate_per_hour,
            fixed_deductions = EXCLUDED.fixed_deductions,
            employee_pf = EXCLUDED.employee_pf,
            employee_esi = EXCLUDED.employee_esi,
            professional_tax = EXCLUDED.professional_tax,
            tds = EXCLUDED.tds,
            deductions = EXCLUDED.deductions,
            updated_at = NOW()
        "#,
    )
    .bind(plant_id)
    .bind(user_id)
    .bind(eff_dt)
    .bind(payload.pay_basis.unwrap_or_else(|| "MONTHLY".to_string()))
    .bind(basic)
    .bind(hra)
    .bind(allow_total)
    .bind(ot)
    .bind(fix)
    .bind(pf)
    .bind(esi)
    .bind(pt)
    .bind(tds)
    .bind(deduct_total)
    .execute(&state.db)
    .await?;

    Ok(Json(
        json!({ "success": true, "message": "Salary structure saved" }),
    ))
}

pub async fn get_salary_suggestion(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path((plant_id, user_id, month_str)): Path<(Uuid, Uuid, String)>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["owner", "plant_owner", "accountant", "admin"])?;

    ensure_employee_access(&state, &auth_user, plant_id, user_id).await?;
    let salary = sqlx::query(
        "SELECT basic_amount, allowances, deductions FROM employee_salary_profiles WHERE plant_id = $1 AND user_id = $2",
    )
    .bind(plant_id)
    .bind(user_id)
    .fetch_optional(&state.db)
    .await?;

    let (basic, allowances, deductions): (f64, f64, f64) = match salary {
        Some(s) => {
            let b: bigdecimal::BigDecimal = s.get("basic_amount");
            let a: bigdecimal::BigDecimal = s.get("allowances");
            let d: bigdecimal::BigDecimal = s.get("deductions");
            (
                b.to_string().parse().unwrap_or(25000.0),
                a.to_string().parse().unwrap_or(3000.0),
                d.to_string().parse().unwrap_or(1500.0),
            )
        }
        None => (25000.0, 3000.0, 1500.0),
    };

    let present_days: i64 = sqlx::query_scalar(
        r#"
        SELECT COUNT(*) FROM workforce_attendance
        WHERE plant_id = $1 AND user_id = $2 AND status = 'present'
          AND TO_CHAR(attendance_date, 'YYYY-MM') = $3
        "#,
    )
    .bind(plant_id)
    .bind(user_id)
    .bind(&month_str)
    .fetch_one(&state.db)
    .await?;

    let standard_working_days = 26.0;
    let factor = (present_days as f64) / standard_working_days;
    let earned_basic = (basic * factor.min(1.0)).round();
    let net = earned_basic + allowances - deductions;

    Ok(Json(json!({
        "success": true,
        "month": month_str,
        "present_days": present_days,
        "standard_days": standard_working_days,
        "suggestion": {
            "basic_pay": earned_basic,
            "allowances": allowances,
            "deductions": deductions,
            "net_pay": net
        }
    })))
}

pub async fn get_employee_hr_profile(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path((plant_id, user_id)): Path<(Uuid, Uuid)>,
) -> Result<impl IntoResponse, AppError> {
    check_role(
        &auth_user,
        &["owner", "plant_owner", "accountant", "supervisor", "admin"],
    )?;

    ensure_employee_access(&state, &auth_user, plant_id, user_id).await?;
    let hr_row = sqlx::query(
        r#"
        SELECT u.full_name, u.email, u.phone, ps.role,
               hr.employee_code, hr.designation, hr.department, hr.join_date,
               hr.employment_type, hr.weekly_off_day, hr.work_location,
               hr.emergency_contact_name, hr.emergency_contact_phone, hr.document_references,
               sp.effective_from, sp.pay_basis, sp.basic_amount, sp.hra_amount,
               sp.allowances, sp.overtime_rate_per_hour, sp.fixed_deductions,
               sp.employee_pf, sp.employee_esi, sp.professional_tax, sp.tds, sp.deductions
        FROM plant_staff ps
        INNER JOIN users u ON u.id = ps.user_id
        LEFT JOIN employee_hr_profiles hr ON hr.user_id = u.id AND hr.plant_id = $1
        LEFT JOIN employee_salary_profiles sp ON sp.user_id = u.id AND sp.plant_id = $1
        WHERE ps.plant_id = $1 AND ps.user_id = $2
        "#,
    )
    .bind(plant_id)
    .bind(user_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Employee not found in plant".to_string()))?;

    let name: String = hr_row.get("full_name");
    let email: Option<String> = hr_row.get("email");
    let phone: Option<String> = hr_row.get("phone");
    let role: String = hr_row.get("role");

    let emp_code: Option<String> = hr_row.get("employee_code");
    let designation: Option<String> = hr_row.get("designation");
    let department: Option<String> = hr_row.get("department");
    let join_date: Option<chrono::NaiveDate> = hr_row.get("join_date");
    let emp_type: Option<String> = hr_row.get("employment_type");
    let weekly_off: Option<String> = hr_row.get("weekly_off_day");
    let work_loc: Option<String> = hr_row.get("work_location");
    let em_name: Option<String> = hr_row.get("emergency_contact_name");
    let em_phone: Option<String> = hr_row.get("emergency_contact_phone");
    let doc_refs: Option<serde_json::Value> = hr_row.get("document_references");

    let eff_from: Option<chrono::NaiveDate> = hr_row.get("effective_from");
    let pay_basis: Option<String> = hr_row.get("pay_basis");
    let basic: Option<bigdecimal::BigDecimal> = hr_row.get("basic_amount");
    let hra: Option<bigdecimal::BigDecimal> = hr_row.get("hra_amount");
    let allowances: Option<bigdecimal::BigDecimal> = hr_row.get("allowances");
    let ot: Option<bigdecimal::BigDecimal> = hr_row.get("overtime_rate_per_hour");
    let fixed_ded: Option<bigdecimal::BigDecimal> = hr_row.get("fixed_deductions");
    let pf: Option<bigdecimal::BigDecimal> = hr_row.get("employee_pf");
    let esi: Option<bigdecimal::BigDecimal> = hr_row.get("employee_esi");
    let pt: Option<bigdecimal::BigDecimal> = hr_row.get("professional_tax");
    let tds: Option<bigdecimal::BigDecimal> = hr_row.get("tds");

    Ok(Json(json!({
        "success": true,
        "employee": {
            "user_id": user_id,
            "name": name,
            "email": email,
            "phone": phone,
            "role": role,
            "profile": {
                "employee_code": emp_code,
                "designation": designation,
                "department": department,
                "join_date": join_date.map(|d| d.to_string()),
                "employment_type": emp_type,
                "weekly_off_day": weekly_off,
                "work_location": work_loc,
                "emergency_contact_name": em_name,
                "emergency_contact_phone": em_phone,
                "document_references": doc_refs
            },
            "salary": if auth_user.role == "supervisor" {
                serde_json::Value::Null
            } else { json!({
                "effective_from": eff_from.map(|d| d.to_string()),
                "pay_basis": pay_basis,
                "basic_amount": basic.map(|b| b.to_string().parse::<f64>().unwrap_or(0.0)),
                "hra_amount": hra.map(|b| b.to_string().parse::<f64>().unwrap_or(0.0)),
                "other_allowances": allowances.map(|b| b.to_string().parse::<f64>().unwrap_or(0.0)),
                "overtime_rate_per_hour": ot.map(|b| b.to_string().parse::<f64>().unwrap_or(0.0)),
                "fixed_deductions": fixed_ded.map(|b| b.to_string().parse::<f64>().unwrap_or(0.0)),
                "employee_pf": pf.map(|b| b.to_string().parse::<f64>().unwrap_or(0.0)),
                "employee_esi": esi.map(|b| b.to_string().parse::<f64>().unwrap_or(0.0)),
                "professional_tax": pt.map(|b| b.to_string().parse::<f64>().unwrap_or(0.0)),
                "tds": tds.map(|b| b.to_string().parse::<f64>().unwrap_or(0.0))
            }) }
        }
    })))
}

pub use update_employee_profile as update_hr_profile;
pub use update_employee_salary as update_salary_profile;

async fn ensure_employee_access(
    state: &AppState,
    user: &AuthUser,
    plant: Uuid,
    employee: Uuid,
) -> Result<(), AppError> {
    super::business_routes::ensure_plant_staff_or_owner(state, user, plant).await?;
    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM plant_staff WHERE plant_id=$1 AND user_id=$2)",
    )
    .bind(plant)
    .bind(employee)
    .fetch_one(&state.db)
    .await?;
    if !exists {
        return Err(AppError::NotFound(
            "Employee not found in this plant".into(),
        ));
    }
    Ok(())
}
