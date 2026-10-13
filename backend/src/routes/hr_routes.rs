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

pub async fn list_employees(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["owner", "plant_owner", "accountant", "supervisor", "admin"])?;
    let plant_id = get_staff_plant_id(&state, &auth_user).await?;

    let rows = sqlx::query!(
        r#"
        SELECT u.id as user_id, u.full_name, u.phone, u.email, ps.role, ps.joined_at, ps.is_active,
               sp.basic_amount, sp.allowances, sp.deductions
        FROM plant_staff ps
        INNER JOIN users u ON u.id = ps.user_id
        LEFT JOIN employee_salary_profiles sp ON sp.user_id = u.id AND sp.plant_id = $1
        WHERE ps.plant_id = $1
        ORDER BY u.full_name
        "#,
        plant_id
    )
    .fetch_all(&state.db)
    .await?;

    let employees: Vec<_> = rows
        .into_iter()
        .map(|r| {
            json!({
                "user_id": r.user_id,
                "name": r.full_name,
                "phone": r.phone,
                "email": r.email,
                "role": r.role,
                "joined_at": r.joined_at,
                "active": r.is_active,
                "salary_structure": {
                    "basic_amount": r.basic_amount.unwrap_or_default(),
                    "allowances": r.allowances.unwrap_or_default(),
                    "deductions": r.deductions.unwrap_or_default()
                }
            })
        })
        .collect();

    Ok(Json(json!({ "success": true, "plant_id": plant_id, "employees": employees })))
}

pub async fn get_employee_hr_profile(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path((plant_id, user_id)): Path<(Uuid, Uuid)>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["owner", "plant_owner", "accountant", "admin"])?;

    let emp = sqlx::query!(
        r#"
        SELECT u.id, u.full_name, u.phone, u.email, ps.role, ps.joined_at, ps.is_active,
               sp.basic_amount, sp.allowances, sp.deductions
        FROM plant_staff ps
        INNER JOIN users u ON u.id = ps.user_id
        LEFT JOIN employee_salary_profiles sp ON sp.user_id = u.id AND sp.plant_id = $1
        WHERE ps.plant_id = $1 AND ps.user_id = $2
        "#,
        plant_id,
        user_id
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Employee not found in plant".to_string()))?;

    Ok(Json(json!({
        "success": true,
        "employee": {
            "user_id": emp.id,
            "name": emp.full_name,
            "phone": emp.phone,
            "email": emp.email,
            "role": emp.role,
            "joined_at": emp.joined_at,
            "active": emp.is_active,
            "salary": {
                "basic_amount": emp.basic_amount.unwrap_or_default(),
                "allowances": emp.allowances.unwrap_or_default(),
                "deductions": emp.deductions.unwrap_or_default()
            }
        }
    })))
}

#[derive(Debug, Deserialize, Serialize)]
pub struct UpdateSalaryPayload {
    pub basic_amount: f64,
    pub allowances: Option<f64>,
    pub deductions: Option<f64>,
}

pub async fn update_employee_salary(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path((plant_id, user_id)): Path<(Uuid, Uuid)>,
    Json(payload): Json<UpdateSalaryPayload>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["owner", "plant_owner", "accountant", "admin"])?;

    let allow = payload.allowances.unwrap_or(0.0);
    let deduct = payload.deductions.unwrap_or(0.0);

    sqlx::query!(
        r#"
        INSERT INTO employee_salary_profiles (plant_id, user_id, basic_amount, allowances, deductions, updated_at)
        VALUES ($1, $2, $3::numeric, $4::numeric, $5::numeric, NOW())
        ON CONFLICT (user_id, plant_id) DO UPDATE SET
            basic_amount = EXCLUDED.basic_amount,
            allowances = EXCLUDED.allowances,
            deductions = EXCLUDED.deductions,
            updated_at = NOW()
        "#,
        plant_id,
        user_id,
        bigdecimal::BigDecimal::try_from(payload.basic_amount).unwrap_or_default(),
        bigdecimal::BigDecimal::try_from(allow).unwrap_or_default(),
        bigdecimal::BigDecimal::try_from(deduct).unwrap_or_default()
    )
    .execute(&state.db)
    .await?;

    Ok(Json(json!({ "success": true, "message": "Salary structure updated" })))
}

pub async fn get_salary_suggestion(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path((plant_id, user_id, month_str)): Path<(Uuid, Uuid, String)>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["owner", "plant_owner", "accountant", "admin"])?;

    let salary = sqlx::query!(
        "SELECT basic_amount, allowances, deductions FROM employee_salary_profiles WHERE plant_id = $1 AND user_id = $2",
        plant_id,
        user_id
    )
    .fetch_optional(&state.db)
    .await?;

    let basic: f64 = salary.as_ref().and_then(|s| s.basic_amount.to_string().parse().ok()).unwrap_or(25000.0);
    let allowances: f64 = salary.as_ref().and_then(|s| s.allowances.to_string().parse().ok()).unwrap_or(3000.0);
    let deductions: f64 = salary.as_ref().and_then(|s| s.deductions.to_string().parse().ok()).unwrap_or(1500.0);

    // Count present days in month
    let present_days: i64 = sqlx::query_scalar!(
        r#"
        SELECT COUNT(*) FROM workforce_attendance
        WHERE plant_id = $1 AND user_id = $2 AND status = 'present'
          AND TO_CHAR(attendance_date, 'YYYY-MM') = $3
        "#,
        plant_id,
        user_id,
        month_str
    )
    .fetch_one(&state.db)
    .await?
    .unwrap_or(26);

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
