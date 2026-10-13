use crate::{
    auth::{middleware::check_role, AuthUser},
    error::AppError,
    models::workforce::MarkAttendanceRequest,
    services::payroll_service,
    state::AppState,
};
use axum::{
    extract::{Path, Query, State},
    response::IntoResponse,
    Json,
};
use chrono::NaiveDate;
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

#[derive(Deserialize)]
pub struct RosterQuery {
    pub plant_id: Uuid,
    pub date: Option<NaiveDate>,
}

pub async fn get_roster(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Query(query): Query<RosterQuery>,
) -> Result<impl IntoResponse, AppError> {
    check_role(
        &auth_user,
        &[
            "supervisor",
            "owner",
            "plant_owner",
            "admin",
            "accountant",
            "store_manager",
            "fleet_manager",
            "dispatcher",
            "operator",
            "quality_engineer",
        ],
    )?;

    if !matches!(auth_user.role.as_str(), "owner" | "plant_owner" | "admin") {
        let has_access: bool = sqlx::query_scalar(
            r#"
            SELECT EXISTS(
                SELECT 1
                FROM plant_staff
                WHERE plant_id = $1
                  AND user_id = $2
                  AND is_active = TRUE
            )
            "#,
        )
        .bind(query.plant_id)
        .bind(auth_user.user_id)
        .fetch_one(&state.db)
        .await?;

        if !has_access {
            return Err(AppError::Forbidden(
                "You are not assigned to this plant".to_string(),
            ));
        }
    }

    let date = query
        .date
        .unwrap_or_else(|| chrono::Utc::now().date_naive());
    let roster = payroll_service::fetch_daily_roster(&state, query.plant_id, date).await?;
    Ok(Json(
        json!({ "success": true, "date": date, "roster": roster }),
    ))
}

pub async fn mark_attendance(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Json(payload): Json<MarkAttendanceRequest>,
) -> Result<impl IntoResponse, AppError> {
    if !matches!(auth_user.role.as_str(), "owner" | "plant_owner" | "admin") {
        let self_assigned: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM plant_staff WHERE plant_id = $1 AND user_id = $2 AND is_active = TRUE)",
        )
        .bind(payload.plant_id)
        .bind(auth_user.user_id)
        .fetch_one(&state.db)
        .await?;
        if !self_assigned {
            return Err(AppError::Forbidden(
                "You are not assigned to this plant".to_string(),
            ));
        }
    }

    if let Some(target_user_id) = payload.user_id {
        if target_user_id != auth_user.user_id {
            check_role(&auth_user, &["supervisor", "owner", "plant_owner", "admin"])?;
            let target_assigned: bool = sqlx::query_scalar(
                "SELECT EXISTS(SELECT 1 FROM plant_staff WHERE plant_id = $1 AND user_id = $2 AND is_active = TRUE)",
            )
            .bind(payload.plant_id)
            .bind(target_user_id)
            .fetch_one(&state.db)
            .await?;
            if !target_assigned {
                return Err(AppError::BadRequest(
                    "Target user is not assigned to this plant".to_string(),
                ));
            }
        }
    }

    let record = payroll_service::record_attendance(&state, auth_user.user_id, payload).await?;
    Ok(Json(json!({ "success": true, "attendance": record })))
}

pub async fn get_workforce_me(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<impl IntoResponse, AppError> {
    let plant_id = get_staff_plant_id(&state, &auth_user).await?;

    let today_att = sqlx::query!(
        r#"
        SELECT id, check_in_time, check_out_time, status
        FROM workforce_attendance
        WHERE plant_id = $1 AND user_id = $2 AND attendance_date = CURRENT_DATE
        "#,
        plant_id,
        auth_user.user_id
    )
    .fetch_optional(&state.db)
    .await?;

    let assigned_shift = sqlx::query!(
        r#"
        SELECT s.name as shift_name, s.start_time, s.end_time
        FROM workforce_roster_schedules rs
        INNER JOIN workforce_shifts s ON s.id = rs.shift_id
        WHERE rs.plant_id = $1 AND rs.user_id = $2 AND rs.date_key = CURRENT_DATE
        "#,
        plant_id,
        auth_user.user_id
    )
    .fetch_optional(&state.db)
    .await?;

    Ok(Json(json!({
        "success": true,
        "plant_id": plant_id,
        "attendance": today_att.map(|a| json!({
            "id": a.id,
            "check_in": a.check_in_time,
            "check_out": a.check_out_time,
            "status": a.status
        })),
        "shift": assigned_shift.map(|s| json!({
            "name": s.shift_name,
            "start_time": s.start_time,
            "end_time": s.end_time
        }))
    })))
}

#[derive(Debug, Deserialize, Serialize)]
pub struct PunchPayload {
    pub lat: Option<f64>,
    pub lng: Option<f64>,
}

pub async fn punch_in(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Json(payload): Json<PunchPayload>,
) -> Result<impl IntoResponse, AppError> {
    let plant_id = get_staff_plant_id(&state, &auth_user).await?;

    sqlx::query!(
        r#"
        INSERT INTO workforce_attendance (plant_id, user_id, attendance_date, check_in_time, check_in_lat, check_in_lng, status)
        VALUES ($1, $2, CURRENT_DATE, NOW(), $3, $4, 'present')
        ON CONFLICT (plant_id, user_id, attendance_date) DO UPDATE SET
            check_in_time = COALESCE(workforce_attendance.check_in_time, NOW()),
            check_in_lat = COALESCE(workforce_attendance.check_in_lat, EXCLUDED.check_in_lat),
            check_in_lng = COALESCE(workforce_attendance.check_in_lng, EXCLUDED.check_in_lng),
            status = 'present'
        "#,
        plant_id,
        auth_user.user_id,
        payload.lat,
        payload.lng
    )
    .execute(&state.db)
    .await?;

    Ok(Json(json!({ "success": true, "message": "Punched in successfully" })))
}

pub async fn punch_out(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Json(_payload): Json<PunchPayload>,
) -> Result<impl IntoResponse, AppError> {
    let plant_id = get_staff_plant_id(&state, &auth_user).await?;

    sqlx::query!(
        r#"
        UPDATE workforce_attendance
        SET check_out_time = NOW()
        WHERE plant_id = $1 AND user_id = $2 AND attendance_date = CURRENT_DATE
        "#,
        plant_id,
        auth_user.user_id
    )
    .execute(&state.db)
    .await?;

    Ok(Json(json!({ "success": true, "message": "Punched out successfully" })))
}

#[derive(Debug, Deserialize, Serialize)]
pub struct ApplyLeavePayload {
    pub leave_type: String, // 'CASUAL', 'SICK', 'PAID', 'UNPAID', 'OTHER'
    pub start_date: String,
    pub end_date: String,
    pub reason: String,
}

pub async fn apply_leave(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Json(payload): Json<ApplyLeavePayload>,
) -> Result<impl IntoResponse, AppError> {
    let plant_id = get_staff_plant_id(&state, &auth_user).await?;

    let s_date = NaiveDate::parse_from_str(&payload.start_date, "%Y-%m-%d")
        .map_err(|_| AppError::BadRequest("Invalid start_date".to_string()))?;
    let e_date = NaiveDate::parse_from_str(&payload.end_date, "%Y-%m-%d")
        .map_err(|_| AppError::BadRequest("Invalid end_date".to_string()))?;

    let id = sqlx::query_scalar!(
        r#"
        INSERT INTO workforce_leave_requests (user_id, plant_id, leave_type, start_date, end_date, reason, status)
        VALUES ($1, $2, $3, $4, $5, $6, 'PENDING')
        RETURNING id
        "#,
        auth_user.user_id,
        plant_id,
        payload.leave_type,
        s_date,
        e_date,
        payload.reason
    )
    .fetch_one(&state.db)
    .await?;

    Ok(Json(json!({ "success": true, "id": id, "message": "Leave application submitted" })))
}

#[derive(Debug, Deserialize, Serialize)]
pub struct CreateVisitPayload {
    pub client_name: String,
    pub purpose: String,
    pub scheduled_for: Option<String>,
    pub site_address: String,
    pub contact_name: Option<String>,
    pub contact_phone: Option<String>,
}

pub async fn create_client_visit(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Json(payload): Json<CreateVisitPayload>,
) -> Result<impl IntoResponse, AppError> {
    let plant_id = get_staff_plant_id(&state, &auth_user).await?;

    let sched = chrono::Utc::now();

    let id = sqlx::query_scalar!(
        r#"
        INSERT INTO workforce_client_visits (
            user_id, plant_id, client_name, purpose, scheduled_for,
            site_address, contact_name, contact_phone, status
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'SCHEDULED')
        RETURNING id
        "#,
        auth_user.user_id,
        plant_id,
        payload.client_name,
        payload.purpose,
        sched,
        payload.site_address,
        payload.contact_name,
        payload.contact_phone
    )
    .fetch_one(&state.db)
    .await?;

    Ok(Json(json!({ "success": true, "id": id, "message": "Client visit scheduled" })))
}

#[derive(Debug, Deserialize, Serialize)]
pub struct VisitActionPayload {
    pub lat: f64,
    pub lng: f64,
    pub outcome: Option<String>,
}

pub async fn start_client_visit(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(visit_id): Path<Uuid>,
    Json(payload): Json<VisitActionPayload>,
) -> Result<impl IntoResponse, AppError> {
    sqlx::query!(
        r#"
        UPDATE workforce_client_visits
        SET status = 'IN_PROGRESS', start_lat = $1, start_lng = $2
        WHERE id = $3 AND user_id = $4
        "#,
        payload.lat,
        payload.lng,
        visit_id,
        auth_user.user_id
    )
    .execute(&state.db)
    .await?;

    Ok(Json(json!({ "success": true, "message": "Visit started" })))
}

pub async fn complete_client_visit(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(visit_id): Path<Uuid>,
    Json(payload): Json<VisitActionPayload>,
) -> Result<impl IntoResponse, AppError> {
    sqlx::query!(
        r#"
        UPDATE workforce_client_visits
        SET status = 'COMPLETED', completed_lat = $1, completed_lng = $2, outcome = $3
        WHERE id = $4 AND user_id = $5
        "#,
        payload.lat,
        payload.lng,
        payload.outcome,
        visit_id,
        auth_user.user_id
    )
    .execute(&state.db)
    .await?;

    Ok(Json(json!({ "success": true, "message": "Visit completed" })))
}

#[derive(Debug, Deserialize, Serialize)]
pub struct SubmitExpenseClaimPayload {
    pub category: String,
    pub amount: f64,
    pub expense_date: Option<String>,
    pub description: String,
    pub receipt_reference: Option<String>,
}

pub async fn submit_expense_claim(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Json(payload): Json<SubmitExpenseClaimPayload>,
) -> Result<impl IntoResponse, AppError> {
    let plant_id = get_staff_plant_id(&state, &auth_user).await?;

    let dt = match payload.expense_date {
        Some(s) => NaiveDate::parse_from_str(&s, "%Y-%m-%d").unwrap_or_else(|_| chrono::Utc::now().naive_utc().date()),
        None => chrono::Utc::now().naive_utc().date(),
    };

    let id = sqlx::query_scalar!(
        r#"
        INSERT INTO workforce_expense_claims (
            user_id, plant_id, category, amount, expense_date, description, receipt_reference, status
        )
        VALUES ($1, $2, $3, $4::numeric, $5, $6, $7, 'PENDING_VERIFICATION')
        RETURNING id
        "#,
        auth_user.user_id,
        plant_id,
        payload.category,
        bigdecimal::BigDecimal::try_from(payload.amount).unwrap_or_default(),
        dt,
        payload.description,
        payload.receipt_reference
    )
    .fetch_one(&state.db)
    .await?;

    Ok(Json(json!({ "success": true, "id": id, "message": "Expense claim submitted for verification" })))
}

pub async fn list_accountant_expenses(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["accountant", "owner", "plant_owner", "admin"])?;
    let plant_id = get_staff_plant_id(&state, &auth_user).await?;

    let rows = sqlx::query!(
        r#"
        SELECT c.id, c.user_id, c.category, c.amount, c.expense_date, c.description,
               c.receipt_reference, c.status, c.created_at,
               u.full_name as employee_name, ps.role
        FROM workforce_expense_claims c
        INNER JOIN users u ON u.id = c.user_id
        LEFT JOIN plant_staff ps ON ps.user_id = c.user_id AND ps.plant_id = $1
        WHERE c.plant_id = $1 AND c.status = 'PENDING_VERIFICATION'
        ORDER BY c.created_at DESC
        "#,
        plant_id
    )
    .fetch_all(&state.db)
    .await?;

    let claims: Vec<_> = rows
        .into_iter()
        .map(|r| {
            json!({
                "id": r.id,
                "user_id": r.user_id,
                "employee_name": r.employee_name,
                "role": r.role,
                "category": r.category,
                "amount": r.amount,
                "expense_date": r.expense_date,
                "description": r.description,
                "receipt_reference": r.receipt_reference,
                "status": r.status,
                "created_at": r.created_at
            })
        })
        .collect();

    Ok(Json(json!({ "success": true, "claims": claims })))
}

#[derive(Debug, Deserialize, Serialize)]
pub struct DecisionPayload {
    pub action: String, // "VERIFY", "RETURN", "APPROVE", "REJECT"
    pub note: Option<String>,
}

pub async fn accountant_expense_decision(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(claim_id): Path<Uuid>,
    Json(payload): Json<DecisionPayload>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["accountant", "owner", "plant_owner", "admin"])?;

    let new_status = if payload.action.to_uppercase() == "VERIFY" {
        "PENDING_APPROVAL"
    } else {
        "REJECTED"
    };

    sqlx::query!(
        r#"
        UPDATE workforce_expense_claims
        SET status = $1, accountant_note = $2, verified_by = $3, verified_at = NOW()
        WHERE id = $4
        "#,
        new_status,
        payload.note,
        auth_user.user_id,
        claim_id
    )
    .execute(&state.db)
    .await?;

    Ok(Json(json!({ "success": true, "status": new_status, "message": "Claim processed" })))
}

pub async fn get_owner_control(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["owner", "plant_owner", "admin"])?;
    let plant_id = get_staff_plant_id(&state, &auth_user).await?;

    let leaves = sqlx::query!(
        r#"
        SELECT l.id, l.user_id, l.leave_type, l.start_date, l.end_date, l.reason, l.status,
               u.full_name as employee_name
        FROM workforce_leave_requests l
        INNER JOIN users u ON u.id = l.user_id
        WHERE l.plant_id = $1 AND l.status = 'PENDING'
        ORDER BY l.created_at DESC
        "#,
        plant_id
    )
    .fetch_all(&state.db)
    .await?;

    let claims = sqlx::query!(
        r#"
        SELECT c.id, c.user_id, c.category, c.amount, c.description, c.accountant_note,
               u.full_name as employee_name
        FROM workforce_expense_claims c
        INNER JOIN users u ON u.id = c.user_id
        WHERE c.plant_id = $1 AND c.status = 'PENDING_APPROVAL'
        ORDER BY c.created_at DESC
        "#,
        plant_id
    )
    .fetch_all(&state.db)
    .await?;

    Ok(Json(json!({
        "success": true,
        "pending_leaves": leaves.into_iter().map(|l| json!({
            "id": l.id,
            "employee_name": l.employee_name,
            "leave_type": l.leave_type,
            "start_date": l.start_date,
            "end_date": l.end_date,
            "reason": l.reason
        })).collect::<Vec<_>>(),
        "pending_expenses": claims.into_iter().map(|c| json!({
            "id": c.id,
            "employee_name": c.employee_name,
            "category": c.category,
            "amount": c.amount,
            "description": c.description,
            "accountant_note": c.accountant_note
        })).collect::<Vec<_>>()
    })))
}

pub async fn owner_leave_decision(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(request_id): Path<Uuid>,
    Json(payload): Json<DecisionPayload>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["owner", "plant_owner", "admin"])?;

    let status = if payload.action.to_uppercase() == "APPROVE" { "APPROVED" } else { "REJECTED" };

    sqlx::query!(
        r#"
        UPDATE workforce_leave_requests
        SET status = $1, decision_note = $2, decided_by = $3, decided_at = NOW()
        WHERE id = $4
        "#,
        status,
        payload.note,
        auth_user.user_id,
        request_id
    )
    .execute(&state.db)
    .await?;

    Ok(Json(json!({ "success": true, "status": status, "message": "Leave decision recorded" })))
}

pub async fn owner_expense_decision(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(claim_id): Path<Uuid>,
    Json(payload): Json<DecisionPayload>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["owner", "plant_owner", "admin"])?;

    let status = if payload.action.to_uppercase() == "APPROVE" { "APPROVED" } else { "REJECTED" };

    sqlx::query!(
        r#"
        UPDATE workforce_expense_claims
        SET status = $1, owner_note = $2, approved_by = $3, approved_at = NOW()
        WHERE id = $4
        "#,
        status,
        payload.note,
        auth_user.user_id,
        claim_id
    )
    .execute(&state.db)
    .await?;

    Ok(Json(json!({ "success": true, "status": status, "message": "Expense claim decision recorded" })))
}

// Roster scheduling endpoints
#[derive(Debug, Deserialize, Serialize)]
pub struct CreateShiftPayload {
    pub name: String,
    pub start_time: String,
    pub end_time: String,
    pub is_night_shift: Option<bool>,
}

pub async fn create_shift(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(plant_id): Path<Uuid>,
    Json(payload): Json<CreateShiftPayload>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["supervisor", "owner", "plant_owner", "admin"])?;

    let start: chrono::NaiveTime = payload.start_time.parse()
        .map_err(|_| AppError::BadRequest("Invalid start_time, expected HH:MM:SS".to_string()))?;
    let end: chrono::NaiveTime = payload.end_time.parse()
        .map_err(|_| AppError::BadRequest("Invalid end_time, expected HH:MM:SS".to_string()))?;

    let id = sqlx::query_scalar!(
        r#"
        INSERT INTO workforce_shifts (plant_id, name, start_time, end_time, is_night_shift)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id
        "#,
        plant_id,
        payload.name,
        start,
        end,
        payload.is_night_shift.unwrap_or(false)
    )
    .fetch_one(&state.db)
    .await?;

    Ok(Json(json!({ "success": true, "shift_id": id, "message": "Shift created" })))
}

#[derive(Debug, Deserialize, Serialize)]
pub struct AssignRosterSchedulePayload {
    pub shift_id: Uuid,
}

pub async fn assign_roster_schedule(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path((plant_id, date_str, user_id)): Path<(Uuid, String, Uuid)>,
    Json(payload): Json<AssignRosterSchedulePayload>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["supervisor", "owner", "plant_owner", "admin"])?;

    let d = NaiveDate::parse_from_str(&date_str, "%Y-%m-%d")
        .map_err(|_| AppError::BadRequest("Invalid date format".to_string()))?;

    sqlx::query!(
        r#"
        INSERT INTO workforce_roster_schedules (plant_id, user_id, shift_id, date_key)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (plant_id, user_id, date_key) DO UPDATE SET shift_id = EXCLUDED.shift_id
        "#,
        plant_id,
        user_id,
        payload.shift_id,
        d
    )
    .execute(&state.db)
    .await?;

    Ok(Json(json!({ "success": true, "message": "Roster schedule assigned" })))
}
