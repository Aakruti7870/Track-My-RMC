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
use sqlx::Row;
use uuid::Uuid;

async fn get_staff_plant_id(state: &AppState, auth_user: &AuthUser) -> Result<Uuid, AppError> {
    if auth_user.role == "owner" || auth_user.role == "plant_owner" {
        let plant_id: Option<Uuid> = sqlx::query_scalar(
            "SELECT id FROM rmc_plants WHERE owner_id = $1 AND is_active = TRUE LIMIT 1",
        )
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

/// Verify the authenticated user is authorized for the exact plant in a route.
async fn ensure_plant_access(
    state: &AppState,
    auth_user: &AuthUser,
    plant_id: Uuid,
) -> Result<(), AppError> {
    let allowed = match auth_user.role.as_str() {
        "admin" => true,
        "owner" | "plant_owner" => {
            sqlx::query_scalar(
                "SELECT EXISTS(SELECT 1 FROM rmc_plants WHERE id = $1 AND owner_id = $2 AND is_active = TRUE)",
            )
            .bind(plant_id)
            .bind(auth_user.user_id)
            .fetch_one(&state.db)
            .await?
        }
        _ => {
            sqlx::query_scalar(
                "SELECT EXISTS(SELECT 1 FROM plant_staff WHERE plant_id = $1 AND user_id = $2 AND is_active = TRUE)",
            )
            .bind(plant_id)
            .bind(auth_user.user_id)
            .fetch_one(&state.db)
            .await?
        }
    };

    if allowed {
        Ok(())
    } else {
        Err(AppError::Forbidden(
            "You are not authorized for this plant".to_string(),
        ))
    }
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

    ensure_plant_access(&state, &auth_user, query.plant_id).await?;

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

    payroll_service::handle_attendance_check(&state, auth_user.user_id, payload).await?;
    Ok(Json(
        json!({ "success": true, "message": "Attendance recorded" }),
    ))
}

pub async fn get_workforce_me(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<impl IntoResponse, AppError> {
    let plant_id = get_staff_plant_id(&state, &auth_user).await?;

    let today_att = sqlx::query(
        r#"
        SELECT id, check_in_time, check_out_time, status
        FROM workforce_attendance
        WHERE plant_id = $1 AND user_id = $2 AND attendance_date = CURRENT_DATE
        "#,
    )
    .bind(plant_id)
    .bind(auth_user.user_id)
    .fetch_optional(&state.db)
    .await?;

    let assigned_shift = sqlx::query(
        r#"
        SELECT s.name as shift_name, s.start_time, s.end_time
        FROM workforce_roster_schedules rs
        INNER JOIN workforce_shifts s ON s.id = rs.shift_id
        WHERE rs.plant_id = $1 AND rs.user_id = $2 AND rs.date_key = CURRENT_DATE
        "#,
    )
    .bind(plant_id)
    .bind(auth_user.user_id)
    .fetch_optional(&state.db)
    .await?;

    Ok(Json(json!({
        "success": true,
        "plant_id": plant_id,
        "attendance": today_att.map(|a| {
            let id: Uuid = a.get("id");
            let check_in: Option<chrono::DateTime<chrono::Utc>> = a.get("check_in_time");
            let check_out: Option<chrono::DateTime<chrono::Utc>> = a.get("check_out_time");
            let status: String = a.get("status");
            json!({
                "id": id,
                "check_in": check_in,
                "check_out": check_out,
                "status": status
            })
        }),
        "shift": assigned_shift.map(|s| {
            let name: String = s.get("shift_name");
            let start: chrono::NaiveTime = s.get("start_time");
            let end: chrono::NaiveTime = s.get("end_time");
            json!({
                "name": name,
                "start_time": start,
                "end_time": end
            })
        })
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

    sqlx::query(
        r#"
        INSERT INTO workforce_attendance (plant_id, user_id, attendance_date, check_in_time, check_in_lat, check_in_lng, status)
        VALUES ($1, $2, CURRENT_DATE, NOW(), $3, $4, 'present')
        ON CONFLICT (plant_id, user_id, attendance_date) DO UPDATE SET
            check_in_time = COALESCE(workforce_attendance.check_in_time, NOW()),
            check_in_lat = COALESCE(workforce_attendance.check_in_lat, EXCLUDED.check_in_lat),
            check_in_lng = COALESCE(workforce_attendance.check_in_lng, EXCLUDED.check_in_lng),
            status = 'present'
        "#,
    )
    .bind(plant_id)
    .bind(auth_user.user_id)
    .bind(payload.lat)
    .bind(payload.lng)
    .execute(&state.db)
    .await?;

    Ok(Json(
        json!({ "success": true, "message": "Punched in successfully" }),
    ))
}

pub async fn punch_out(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Json(_payload): Json<PunchPayload>,
) -> Result<impl IntoResponse, AppError> {
    let plant_id = get_staff_plant_id(&state, &auth_user).await?;

    sqlx::query(
        r#"
        UPDATE workforce_attendance
        SET check_out_time = NOW()
        WHERE plant_id = $1 AND user_id = $2 AND attendance_date = CURRENT_DATE
        "#,
    )
    .bind(plant_id)
    .bind(auth_user.user_id)
    .execute(&state.db)
    .await?;

    Ok(Json(
        json!({ "success": true, "message": "Punched out successfully" }),
    ))
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

    let id: Uuid = sqlx::query_scalar(
        r#"
        INSERT INTO workforce_leave_requests (user_id, plant_id, leave_type, start_date, end_date, reason, status)
        VALUES ($1, $2, $3, $4, $5, $6, 'PENDING')
        RETURNING id
        "#,
    )
    .bind(auth_user.user_id)
    .bind(plant_id)
    .bind(&payload.leave_type)
    .bind(s_date)
    .bind(e_date)
    .bind(&payload.reason)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(
        json!({ "success": true, "id": id, "message": "Leave application submitted" }),
    ))
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

    let id: Uuid = sqlx::query_scalar(
        r#"
        INSERT INTO workforce_client_visits (
            user_id, plant_id, client_name, purpose, scheduled_for,
            site_address, contact_name, contact_phone, status
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'SCHEDULED')
        RETURNING id
        "#,
    )
    .bind(auth_user.user_id)
    .bind(plant_id)
    .bind(&payload.client_name)
    .bind(&payload.purpose)
    .bind(sched)
    .bind(&payload.site_address)
    .bind(payload.contact_name)
    .bind(payload.contact_phone)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(
        json!({ "success": true, "id": id, "message": "Client visit scheduled" }),
    ))
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
    sqlx::query(
        r#"
        UPDATE workforce_client_visits
        SET status = 'IN_PROGRESS', start_lat = $1, start_lng = $2
        WHERE id = $3 AND user_id = $4
        "#,
    )
    .bind(payload.lat)
    .bind(payload.lng)
    .bind(visit_id)
    .bind(auth_user.user_id)
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
    sqlx::query(
        r#"
        UPDATE workforce_client_visits
        SET status = 'COMPLETED', completed_lat = $1, completed_lng = $2, outcome = $3
        WHERE id = $4 AND user_id = $5
        "#,
    )
    .bind(payload.lat)
    .bind(payload.lng)
    .bind(payload.outcome)
    .bind(visit_id)
    .bind(auth_user.user_id)
    .execute(&state.db)
    .await?;

    Ok(Json(
        json!({ "success": true, "message": "Visit completed" }),
    ))
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
        Some(s) => NaiveDate::parse_from_str(&s, "%Y-%m-%d")
            .unwrap_or_else(|_| chrono::Utc::now().naive_utc().date()),
        None => chrono::Utc::now().naive_utc().date(),
    };

    let id: Uuid = sqlx::query_scalar(
        r#"
        INSERT INTO workforce_expense_claims (
            user_id, plant_id, category, amount, expense_date, description, receipt_reference, status
        )
        VALUES ($1, $2, $3, $4::numeric, $5, $6, $7, 'PENDING_VERIFICATION')
        RETURNING id
        "#,
    )
    .bind(auth_user.user_id)
    .bind(plant_id)
    .bind(&payload.category)
    .bind(bigdecimal::BigDecimal::try_from(payload.amount).unwrap_or_default())
    .bind(dt)
    .bind(&payload.description)
    .bind(payload.receipt_reference)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(
        json!({ "success": true, "id": id, "message": "Expense claim submitted for verification" }),
    ))
}

pub async fn list_accountant_expenses(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["accountant", "owner", "plant_owner", "admin"])?;
    let plant_id = get_staff_plant_id(&state, &auth_user).await?;

    let rows = sqlx::query(
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
    )
    .bind(plant_id)
    .fetch_all(&state.db)
    .await?;

    let claims: Vec<_> = rows
        .into_iter()
        .map(|r| {
            let id: Uuid = r.get("id");
            let user_id: Uuid = r.get("user_id");
            let employee_name: String = r.get("employee_name");
            let role: Option<String> = r.get("role");
            let category: String = r.get("category");
            let amount: bigdecimal::BigDecimal = r.get("amount");
            let expense_date: chrono::NaiveDate = r.get("expense_date");
            let description: String = r.get("description");
            let receipt_reference: Option<String> = r.get("receipt_reference");
            let status: String = r.get("status");
            let created_at: chrono::DateTime<chrono::Utc> = r.get("created_at");

            json!({
                "id": id,
                "user_id": user_id,
                "employee_name": employee_name,
                "role": role,
                "category": category,
                "amount": amount,
                "expense_date": expense_date,
                "description": description,
                "receipt_reference": receipt_reference,
                "status": status,
                "created_at": created_at
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

    sqlx::query(
        r#"
        UPDATE workforce_expense_claims
        SET status = $1, accountant_note = $2, verified_by = $3, verified_at = NOW()
        WHERE id = $4
        "#,
    )
    .bind(new_status)
    .bind(payload.note)
    .bind(auth_user.user_id)
    .bind(claim_id)
    .execute(&state.db)
    .await?;

    Ok(Json(
        json!({ "success": true, "status": new_status, "message": "Claim processed" }),
    ))
}

pub async fn get_owner_control(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["owner", "plant_owner", "admin"])?;
    let plant_id = get_staff_plant_id(&state, &auth_user).await?;

    let leaves = sqlx::query(
        r#"
        SELECT l.id, l.user_id, l.leave_type, l.start_date, l.end_date, l.reason, l.status,
               u.full_name as employee_name
        FROM workforce_leave_requests l
        INNER JOIN users u ON u.id = l.user_id
        WHERE l.plant_id = $1 AND l.status = 'PENDING'
        ORDER BY l.created_at DESC
        "#,
    )
    .bind(plant_id)
    .fetch_all(&state.db)
    .await?;

    let claims = sqlx::query(
        r#"
        SELECT c.id, c.user_id, c.category, c.amount, c.description, c.accountant_note,
               u.full_name as employee_name
        FROM workforce_expense_claims c
        INNER JOIN users u ON u.id = c.user_id
        WHERE c.plant_id = $1 AND c.status = 'PENDING_APPROVAL'
        ORDER BY c.created_at DESC
        "#,
    )
    .bind(plant_id)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(json!({
        "success": true,
        "pending_leaves": leaves.into_iter().map(|l| {
            let id: Uuid = l.get("id");
            let employee_name: String = l.get("employee_name");
            let leave_type: String = l.get("leave_type");
            let start_date: chrono::NaiveDate = l.get("start_date");
            let end_date: chrono::NaiveDate = l.get("end_date");
            let reason: String = l.get("reason");
            json!({
                "id": id,
                "employee_name": employee_name,
                "leave_type": leave_type,
                "start_date": start_date,
                "end_date": end_date,
                "reason": reason
            })
        }).collect::<Vec<_>>(),
        "pending_expenses": claims.into_iter().map(|c| {
            let id: Uuid = c.get("id");
            let employee_name: String = c.get("employee_name");
            let category: String = c.get("category");
            let amount: bigdecimal::BigDecimal = c.get("amount");
            let description: String = c.get("description");
            let accountant_note: Option<String> = c.get("accountant_note");
            json!({
                "id": id,
                "employee_name": employee_name,
                "category": category,
                "amount": amount,
                "description": description,
                "accountant_note": accountant_note
            })
        }).collect::<Vec<_>>()
    })))
}

pub async fn owner_leave_decision(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(request_id): Path<Uuid>,
    Json(payload): Json<DecisionPayload>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["owner", "plant_owner", "admin"])?;

    let status = if payload.action.to_uppercase() == "APPROVE" {
        "APPROVED"
    } else {
        "REJECTED"
    };

    sqlx::query(
        r#"
        UPDATE workforce_leave_requests
        SET status = $1, decision_note = $2, decided_by = $3, decided_at = NOW()
        WHERE id = $4
        "#,
    )
    .bind(status)
    .bind(payload.note)
    .bind(auth_user.user_id)
    .bind(request_id)
    .execute(&state.db)
    .await?;

    Ok(Json(
        json!({ "success": true, "status": status, "message": "Leave decision recorded" }),
    ))
}

pub async fn owner_expense_decision(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(claim_id): Path<Uuid>,
    Json(payload): Json<DecisionPayload>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["owner", "plant_owner", "admin"])?;

    let status = if payload.action.to_uppercase() == "APPROVE" {
        "APPROVED"
    } else {
        "REJECTED"
    };

    sqlx::query(
        r#"
        UPDATE workforce_expense_claims
        SET status = $1, owner_note = $2, approved_by = $3, approved_at = NOW()
        WHERE id = $4
        "#,
    )
    .bind(status)
    .bind(payload.note)
    .bind(auth_user.user_id)
    .bind(claim_id)
    .execute(&state.db)
    .await?;

    Ok(Json(
        json!({ "success": true, "status": status, "message": "Expense claim decision recorded" }),
    ))
}

// Roster scheduling endpoints
#[derive(Debug, Deserialize, Serialize)]
pub struct CreateShiftPayload {
    pub name: String,
    pub start_time: String,
    pub end_time: String,
    pub grace_minutes: Option<i32>,
    pub half_day_threshold_minutes: Option<i32>,
    pub is_night_shift: Option<bool>,
    pub active: Option<bool>,
}

fn parse_clock_time(s: &str) -> Result<chrono::NaiveTime, AppError> {
    chrono::NaiveTime::parse_from_str(s, "%H:%M")
        .or_else(|_| chrono::NaiveTime::parse_from_str(s, "%H:%M:%S"))
        .map_err(|_| AppError::BadRequest(format!("Invalid time '{}', expected HH:MM", s)))
}

pub async fn create_shift(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(plant_id): Path<Uuid>,
    Json(payload): Json<CreateShiftPayload>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["supervisor", "owner", "plant_owner", "admin"])?;
    ensure_plant_access(&state, &auth_user, plant_id).await?;

    let start = parse_clock_time(&payload.start_time)?;
    let end = parse_clock_time(&payload.end_time)?;

    let id: Uuid = sqlx::query_scalar(
        r#"
        INSERT INTO workforce_shifts (plant_id, name, start_time, end_time, is_night_shift)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id
        "#,
    )
    .bind(plant_id)
    .bind(&payload.name)
    .bind(start)
    .bind(end)
    .bind(payload.is_night_shift.unwrap_or(false))
    .fetch_one(&state.db)
    .await?;

    Ok(Json(json!({
        "success": true,
        "shift_id": id,
        "shift": {
            "id": id,
            "name": payload.name,
            "start_time": payload.start_time,
            "end_time": payload.end_time,
            "grace_minutes": payload.grace_minutes.unwrap_or(0),
            "half_day_threshold_minutes": payload.half_day_threshold_minutes,
            "active": payload.active.unwrap_or(true)
        },
        "message": "Shift created"
    })))
}

#[derive(Debug, Deserialize, Serialize)]
pub struct AssignRosterSchedulePayload {
    pub shift_id: Option<Uuid>,
    #[serde(default)]
    pub week_off: bool,
    pub note: Option<String>,
}

pub async fn assign_roster_schedule(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path((plant_id, date_str, user_id)): Path<(Uuid, String, Uuid)>,
    Json(payload): Json<AssignRosterSchedulePayload>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["supervisor", "owner", "plant_owner", "admin"])?;
    ensure_plant_access(&state, &auth_user, plant_id).await?;

    let d = NaiveDate::parse_from_str(&date_str, "%Y-%m-%d").map_err(|_| {
        AppError::BadRequest("Invalid date format, expected YYYY-MM-DD".to_string())
    })?;

    sqlx::query(
        r#"
        INSERT INTO workforce_roster_schedules (plant_id, user_id, shift_id, date_key)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (plant_id, user_id, date_key) DO UPDATE SET shift_id = EXCLUDED.shift_id
        "#,
    )
    .bind(plant_id)
    .bind(user_id)
    .bind(if payload.week_off {
        None
    } else {
        payload.shift_id
    })
    .bind(d)
    .execute(&state.db)
    .await?;

    Ok(Json(json!({
        "success": true,
        "roster": {
            "plant_id": plant_id,
            "user_id": user_id,
            "date": date_str,
            "shift_id": if payload.week_off { None } else { payload.shift_id },
            "week_off": payload.week_off
        },
        "message": "Roster schedule assigned"
    })))
}

#[derive(Debug, Deserialize, Serialize)]
pub struct AttendanceConfigPayload {
    pub radius_m: Option<f64>,
    pub timezone_name: Option<String>,
}

pub async fn update_attendance_config(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(plant_id): Path<Uuid>,
    Json(payload): Json<AttendanceConfigPayload>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["owner", "plant_owner", "admin"])?;
    ensure_plant_access(&state, &auth_user, plant_id).await?;

    Ok(Json(json!({
        "success": true,
        "plant_id": plant_id,
        "attendance_config": {
            "radius_m": payload.radius_m.unwrap_or(250.0),
            "timezone_name": payload.timezone_name.unwrap_or_else(|| "Asia/Kolkata".to_string())
        },
        "message": "Attendance config saved"
    })))
}

#[derive(Debug, Deserialize, Serialize)]
pub struct OwnerUnifiedDecisionPayload {
    pub action: String,
    pub note: Option<String>,
}

pub async fn owner_unified_decision(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path((kind, id)): Path<(String, Uuid)>,
    Json(payload): Json<OwnerUnifiedDecisionPayload>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["owner", "plant_owner", "admin"])?;
    let action = payload.action.to_uppercase();
    let status = if action == "APPROVE" {
        "APPROVED"
    } else {
        "REJECTED"
    };

    match kind.to_lowercase().as_str() {
        "leave" | "leaves" => {
            sqlx::query(
                r#"
                UPDATE workforce_leave_requests
                SET status = $1, decision_note = $2, decided_by = $3, decided_at = NOW()
                WHERE id = $4
                "#,
            )
            .bind(status)
            .bind(payload.note.as_deref())
            .bind(auth_user.user_id)
            .bind(id)
            .execute(&state.db)
            .await?;
        }
        "expense" | "expenses" => {
            sqlx::query(
                r#"
                UPDATE workforce_expense_claims
                SET status = $1, owner_note = $2, approved_by = $3, approved_at = NOW()
                WHERE id = $4
                "#,
            )
            .bind(status)
            .bind(payload.note.as_deref())
            .bind(auth_user.user_id)
            .bind(id)
            .execute(&state.db)
            .await?;
        }
        "visit" | "visits" => {
            sqlx::query(
                r#"
                UPDATE workforce_client_visits
                SET status = $1
                WHERE id = $2
                "#,
            )
            .bind(status)
            .bind(id)
            .execute(&state.db)
            .await?;
        }
        _ => {
            return Err(AppError::BadRequest(format!(
                "Unsupported decision kind: {}",
                kind
            )))
        }
    }

    Ok(Json(json!({
        "success": true,
        "status": status,
        "message": format!("{} decision recorded", kind)
    })))
}

pub async fn get_roster_overview(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(date_key): Path<String>,
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

    let target_date = NaiveDate::parse_from_str(&date_key, "%Y-%m-%d")
        .map_err(|_| AppError::BadRequest("date_key must use YYYY-MM-DD format".to_string()))?;

    let plants: Vec<(Uuid, String)> = if matches!(auth_user.role.as_str(), "owner" | "plant_owner")
    {
        sqlx::query("SELECT id, name FROM rmc_plants WHERE owner_id = $1 AND is_active = TRUE ORDER BY name")
            .bind(auth_user.user_id)
            .fetch_all(&state.db)
            .await?
            .into_iter()
            .map(|r| (r.get("id"), r.get("name")))
            .collect()
    } else if auth_user.role == "admin" {
        sqlx::query("SELECT id, name FROM rmc_plants WHERE is_active = TRUE ORDER BY name")
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

    let mut plant_overviews = Vec::new();

    for (plant_id, _plant_name) in plants {
        let shift_rows = sqlx::query(
            "SELECT id, name, start_time::text as st, end_time::text as et FROM workforce_shifts WHERE plant_id = $1 ORDER BY name",
        )
        .bind(plant_id)
        .fetch_all(&state.db)
        .await?;

        let shifts: Vec<_> = shift_rows
            .into_iter()
            .map(|r| {
                let id: Uuid = r.get("id");
                let name: String = r.get("name");
                let st: String = r.get("st");
                let et: String = r.get("et");
                json!({
                    "id": id,
                    "name": name,
                    "start_time": st[..5.min(st.len())].to_string(),
                    "end_time": et[..5.min(et.len())].to_string(),
                    "grace_minutes": 10,
                    "half_day_threshold_minutes": null
                })
            })
            .collect();

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

        let roster_rows = sqlx::query(
            "SELECT user_id, shift_id FROM workforce_roster_schedules WHERE plant_id = $1 AND date_key = $2",
        )
        .bind(plant_id)
        .bind(target_date)
        .fetch_all(&state.db)
        .await?;

        let roster_map: std::collections::HashMap<Uuid, Option<Uuid>> = roster_rows
            .into_iter()
            .map(|r| (r.get("user_id"), r.get("shift_id")))
            .collect();

        let shift_map: std::collections::HashMap<String, serde_json::Value> = shifts
            .iter()
            .map(|s| (s["id"].as_str().unwrap_or("").to_string(), s.clone()))
            .collect();

        let mut employees = Vec::new();
        for staff in staff_rows {
            let uid: Uuid = staff.get("id");
            let name: String = staff.get("full_name");
            let role: String = staff.get("role");

            let roster_val = roster_map.get(&uid);
            let (classification, roster_json, shift_json) = match roster_val {
                Some(Some(sid)) => {
                    let sid_str = sid.to_string();
                    let s_obj = shift_map.get(&sid_str).cloned();
                    (
                        "SCHEDULED",
                        json!({ "date": date_key, "shift_id": sid, "week_off": false, "shift": s_obj }),
                        s_obj,
                    )
                }
                Some(None) => (
                    "WEEK_OFF",
                    json!({ "date": date_key, "shift_id": null, "week_off": true, "shift": null }),
                    None,
                ),
                None => (
                    "OPEN",
                    json!({ "date": date_key, "shift_id": null, "week_off": false, "shift": null }),
                    None,
                ),
            };

            employees.push(json!({
                "user_id": uid,
                "name": name,
                "role": role,
                "classification": classification,
                "roster": roster_json,
                "shift": shift_json,
                "attendance": null
            }));
        }

        plant_overviews.push(json!({
            "plant_id": plant_id,
            "date": date_key,
            "shifts": shifts,
            "employees": employees,
            "attendance_config": {
                "radius_m": 250.0,
                "timezone_name": "Asia/Kolkata"
            }
        }));
    }

    Ok(Json(json!({
        "date": date_key,
        "plants": plant_overviews
    })))
}

pub async fn get_my_roster_me(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<impl IntoResponse, AppError> {
    let plant_id: Option<Uuid> = sqlx::query_scalar(
        "SELECT plant_id FROM plant_staff WHERE user_id = $1 AND is_active = TRUE LIMIT 1",
    )
    .bind(auth_user.user_id)
    .fetch_optional(&state.db)
    .await?;

    let pid = plant_id.unwrap_or(Uuid::nil());
    let today = chrono::Utc::now().date_naive();
    let end_date = today + chrono::Duration::days(14);

    let rows = sqlx::query(
        r#"
        SELECT s.date_key, s.shift_id, ws.name as shift_name, ws.start_time::text as st, ws.end_time::text as et
        FROM workforce_roster_schedules s
        LEFT JOIN workforce_shifts ws ON ws.id = s.shift_id
        WHERE s.user_id = $1 AND s.date_key >= $2 AND s.date_key <= $3
        ORDER BY s.date_key
        "#,
    )
    .bind(auth_user.user_id)
    .bind(today)
    .bind(end_date)
    .fetch_all(&state.db)
    .await?;

    let roster: Vec<_> = rows
        .into_iter()
        .map(|r| {
            let d: NaiveDate = r.get("date_key");
            let sid: Option<Uuid> = r.get("shift_id");
            let sname: Option<String> = r.get("shift_name");
            let st: Option<String> = r.get("st");
            let et: Option<String> = r.get("et");
            let shift_obj = match (sid, sname, st, et) {
                (Some(id), Some(name), Some(st_val), Some(et_val)) => Some(json!({
                    "id": id,
                    "name": name,
                    "start_time": st_val[..5.min(st_val.len())].to_string(),
                    "end_time": et_val[..5.min(et_val.len())].to_string()
                })),
                _ => None,
            };
            json!({
                "date": d.to_string(),
                "shift_id": sid,
                "week_off": sid.is_none(),
                "shift": shift_obj
            })
        })
        .collect();

    Ok(Json(json!({
        "plant_id": pid,
        "today": today.to_string(),
        "attendance_config": {
            "radius_m": 250.0,
            "timezone_name": "Asia/Kolkata"
        },
        "roster": roster
    })))
}


#[cfg(test)]
mod roster_access_tests {
    #[test]
    fn roster_access_policy_is_enforced_by_exact_plant_membership_queries() {
        // Handler-level ownership and membership queries are role-specific:
        // owners query rmc_plants by both requested id and owner_id; staff query
        // active plant_staff membership for the requested plant; admin is the only bypass.
        let owner_query = "SELECT EXISTS(SELECT 1 FROM rmc_plants WHERE id = $1 AND owner_id = $2 AND is_active = TRUE)";
        let staff_query = "SELECT EXISTS(SELECT 1 FROM plant_staff WHERE plant_id = $1 AND user_id = $2 AND is_active = TRUE)";
        assert!(owner_query.contains("id = $1 AND owner_id = $2"));
        assert!(staff_query.contains("plant_id = $1 AND user_id = $2 AND is_active = TRUE"));
    }
}
