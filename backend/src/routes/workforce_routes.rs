use crate::{
    auth::{middleware::check_role, AuthUser},
    error::AppError,
    models::workforce::MarkAttendanceRequest,
    repositories::workforce_repo,
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
use serde_json::{json, Value};
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
        "SELECT ps.plant_id FROM plant_staff ps JOIN rmc_plants p ON p.id = ps.plant_id
         WHERE ps.user_id = $1 AND ps.role = $2 AND ps.is_active AND p.is_active
           AND ps.removed_at IS NULL AND ps.employment_status = 'ACTIVE'
         ORDER BY ps.plant_id LIMIT 1",
    )
    .bind(auth_user.user_id)
    .bind(&auth_user.role)
    .fetch_optional(&state.db)
    .await?;

    plant_id.ok_or_else(|| AppError::Forbidden("No active plant found for this user".to_string()))
}

fn roster_access_allowed(role: &str, owns_requested_plant: bool, is_active_staff: bool) -> bool {
    match role {
        "admin" => is_active_staff,
        "owner" | "plant_owner" => owns_requested_plant,
        "supervisor" | "accountant" | "store_manager" | "fleet_manager" | "dispatcher"
        | "operator" | "quality_engineer" => is_active_staff,
        _ => false,
    }
}

/// Verify the authenticated user is authorized for the exact plant in a route.
async fn ensure_plant_access(
    state: &AppState,
    auth_user: &AuthUser,
    plant_id: Uuid,
) -> Result<(), AppError> {
    let role = auth_user.role.as_str();
    let (owns_requested_plant, is_active_staff) = match role {
        "owner" | "plant_owner" => (
            sqlx::query_scalar(
                "SELECT EXISTS(SELECT 1 FROM rmc_plants WHERE id = $1 AND owner_id = $2 AND is_active = TRUE)",
            )
            .bind(plant_id)
            .bind(auth_user.user_id)
            .fetch_one(&state.db)
            .await?,
            false,
        ),
        _ => (
            false,
            sqlx::query_scalar(
                "SELECT EXISTS(SELECT 1 FROM plant_staff WHERE plant_id = $1 AND user_id = $2 AND is_active = TRUE)",
            )
            .bind(plant_id)
            .bind(auth_user.user_id)
            .fetch_one(&state.db)
            .await?,
        ),
    };

    if roster_access_allowed(role, owns_requested_plant, is_active_staff) {
        super::staff_module_permissions::require(
            state,
            auth_user,
            plant_id,
            "workforce",
            super::staff_module_permissions::Action::View,
        )
        .await
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

    let date = match query.date {
        Some(date) => date,
        None => workforce_repo::attendance_today(&state.db).await?,
    };
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
    if !matches!(payload.check_type.as_str(), "in" | "out") {
        return Err(AppError::BadRequest("Choose check-in or check-out".into()));
    }
    if payload
        .latitude
        .is_some_and(|value| !(-90.0..=90.0).contains(&value))
        || payload
            .longitude
            .is_some_and(|value| !(-180.0..=180.0).contains(&value))
    {
        return Err(AppError::BadRequest(
            "Attendance coordinates are out of range".into(),
        ));
    }

    if matches!(auth_user.role.as_str(), "owner" | "plant_owner") {
        ensure_plant_access(&state, &auth_user, payload.plant_id).await?;
    } else {
        let self_assigned: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM plant_staff ps JOIN rmc_plants p ON p.id=ps.plant_id
             WHERE ps.plant_id=$1 AND ps.user_id=$2 AND ps.role=$3 AND p.is_active
               AND ps.is_active AND ps.removed_at IS NULL AND ps.employment_status='ACTIVE')",
        )
        .bind(payload.plant_id)
        .bind(auth_user.user_id)
        .bind(&auth_user.role)
        .fetch_one(&state.db)
        .await?;
        if !self_assigned {
            return Err(AppError::Forbidden(
                "You are not assigned to this plant".into(),
            ));
        }
    }

    if let Some(target_user_id) = payload.user_id.filter(|id| *id != auth_user.user_id) {
        check_role(&auth_user, &["supervisor", "owner", "plant_owner", "admin"])?;
        super::staff_module_permissions::require(
            &state,
            &auth_user,
            payload.plant_id,
            "workforce",
            super::staff_module_permissions::Action::Edit,
        )
        .await?;
        let target_assigned: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM plant_staff ps JOIN users u ON u.id=ps.user_id
             WHERE ps.plant_id=$1 AND ps.user_id=$2 AND ps.role=u.role AND u.is_active
               AND ps.is_active AND ps.removed_at IS NULL AND ps.employment_status='ACTIVE')",
        )
        .bind(payload.plant_id)
        .bind(target_user_id)
        .fetch_one(&state.db)
        .await?;
        if !target_assigned {
            return Err(AppError::BadRequest(
                "Target user is not assigned to this plant".into(),
            ));
        }
    }

    payroll_service::handle_attendance_check(&state, auth_user.user_id, payload).await?;
    Ok(Json(
        json!({ "success": true, "message": "Attendance recorded" }),
    ))
}

#[derive(Deserialize)]
pub struct WorkforceMeQuery {
    #[serde(default)]
    pub include_activity: bool,
}

pub async fn get_workforce_me(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Query(query): Query<WorkforceMeQuery>,
) -> Result<impl IntoResponse, AppError> {
    let plant_id = get_staff_plant_id(&state, &auth_user).await?;

    let today_att = sqlx::query(
        r#"
        SELECT id, check_in_time, check_out_time, status
        FROM workforce_attendance
        WHERE plant_id=$1 AND user_id=$2 AND (
            attendance_date=(NOW() AT TIME ZONE 'Asia/Kolkata')::date
            OR (attendance_date=(NOW() AT TIME ZONE 'Asia/Kolkata')::date-1
                AND check_in_time BETWEEN NOW()-INTERVAL '24 hours' AND NOW()
                AND check_out_time IS NULL)
        )
        ORDER BY (check_in_time IS NOT NULL AND check_out_time IS NULL) DESC,attendance_date DESC
        LIMIT 1
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
        WHERE rs.plant_id = $1 AND rs.user_id = $2 AND rs.date_key = (NOW() AT TIME ZONE 'Asia/Kolkata')::date
        "#,
    )
    .bind(plant_id)
    .bind(auth_user.user_id)
    .fetch_optional(&state.db)
    .await?;

    let mut response = json!({
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
    });

    if query.include_activity {
        let activity: Value = sqlx::query_scalar(
            r#"
            SELECT jsonb_build_object(
                'attendance_history', ARRAY(
                    SELECT jsonb_build_object('id', id, 'date', attendance_date,
                        'check_in', check_in_time, 'check_out', check_out_time)
                    FROM workforce_attendance WHERE plant_id=$1 AND user_id=$2
                    ORDER BY attendance_date DESC, id LIMIT 7
                ),
                'leave_requests', ARRAY(
                    SELECT jsonb_build_object('id', id, 'leave_type', leave_type, 'start_date', start_date,
                        'end_date', end_date, 'reason', reason, 'status', status)
                    FROM workforce_leave_requests WHERE plant_id=$1 AND user_id=$2
                    ORDER BY created_at DESC, id LIMIT 5
                ),
                'client_visits', ARRAY(
                    SELECT jsonb_build_object('id', id, 'client_name', client_name, 'purpose', purpose,
                        'scheduled_for', scheduled_for, 'site_address', site_address, 'status', status)
                    FROM workforce_client_visits WHERE plant_id=$1 AND user_id=$2
                    ORDER BY scheduled_for DESC, id LIMIT 6
                ),
                'expense_claims', ARRAY(
                    SELECT jsonb_build_object('id', id, 'category', category, 'amount', amount::DOUBLE PRECISION,
                        'expense_date', expense_date, 'description', description,
                        'receipt_reference', receipt_reference, 'status', status)
                    FROM workforce_expense_claims WHERE plant_id=$1 AND user_id=$2
                    ORDER BY created_at DESC, id LIMIT 6
                )
            )
            "#,
        )
        .bind(plant_id)
        .bind(auth_user.user_id)
        .fetch_one(&state.db)
        .await?;
        response["activity"] = activity;
    }

    Ok(Json(response))
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

    workforce_repo::record_attendance(
        &state.db,
        plant_id,
        auth_user.user_id,
        "in",
        payload.lat,
        payload.lng,
    )
    .await?;

    Ok(Json(
        json!({ "success": true, "message": "Punched in successfully" }),
    ))
}

pub async fn punch_out(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Json(payload): Json<PunchPayload>,
) -> Result<impl IntoResponse, AppError> {
    let plant_id = get_staff_plant_id(&state, &auth_user).await?;

    workforce_repo::record_attendance(
        &state.db,
        plant_id,
        auth_user.user_id,
        "out",
        payload.lat,
        payload.lng,
    )
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

    let sched = match payload.scheduled_for.as_deref() {
        Some(value) => chrono::DateTime::parse_from_rfc3339(value)
            .map_err(|_| {
                AppError::BadRequest(
                    "Visit time must include a valid date, time, and timezone".into(),
                )
            })?
            .with_timezone(&chrono::Utc),
        None => chrono::Utc::now(),
    };

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
    transition_client_visit(&state, &auth_user, visit_id, payload, false).await
}

pub async fn complete_client_visit(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(visit_id): Path<Uuid>,
    Json(payload): Json<VisitActionPayload>,
) -> Result<impl IntoResponse, AppError> {
    transition_client_visit(&state, &auth_user, visit_id, payload, true).await
}

async fn transition_client_visit(
    state: &AppState,
    user: &AuthUser,
    visit_id: Uuid,
    payload: VisitActionPayload,
    complete: bool,
) -> Result<Json<Value>, AppError> {
    if !(-90.0..=90.0).contains(&payload.lat) || !(-180.0..=180.0).contains(&payload.lng) {
        return Err(AppError::BadRequest(
            "Visit coordinates are out of range".into(),
        ));
    }
    let (expected, target, message) = if complete {
        ("IN_PROGRESS", "COMPLETED", "Visit completed")
    } else {
        ("APPROVED", "IN_PROGRESS", "Visit started")
    };
    let mut tx = state.db.begin().await?;
    let current: String = sqlx::query_scalar(
        r#"
        SELECT v.status FROM workforce_client_visits v
        JOIN rmc_plants p ON p.id = v.plant_id AND p.is_active
        WHERE v.id = $1 AND v.user_id = $2
          AND CASE WHEN $3 IN ('owner', 'plant_owner') THEN p.owner_id = $2
              ELSE EXISTS (
                SELECT 1 FROM plant_staff ps
                WHERE ps.plant_id = p.id AND ps.user_id = $2 AND ps.role = $3
                  AND ps.is_active AND ps.removed_at IS NULL AND ps.employment_status = 'ACTIVE'
              )
          END
        FOR UPDATE OF v
        "#,
    )
    .bind(visit_id)
    .bind(user.user_id)
    .bind(&user.role)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound("Client visit not found".into()))?;

    if current != target {
        if current != expected {
            return Err(AppError::Conflict(format!(
                "Client visit must be {expected}"
            )));
        }
        if complete {
            sqlx::query(
                "UPDATE workforce_client_visits
                 SET status = $2, completed_lat = $3, completed_lng = $4, outcome = $5 WHERE id = $1",
            )
            .bind(visit_id)
            .bind(target)
            .bind(payload.lat)
            .bind(payload.lng)
            .bind(payload.outcome)
            .execute(&mut *tx)
            .await?;
        } else {
            sqlx::query(
                "UPDATE workforce_client_visits
                 SET status = $2, start_lat = $3, start_lng = $4 WHERE id = $1",
            )
            .bind(visit_id)
            .bind(target)
            .bind(payload.lat)
            .bind(payload.lng)
            .execute(&mut *tx)
            .await?;
        }
    }
    tx.commit().await?;
    Ok(Json(json!({ "success": true, "message": message })))
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
    // The Owner is the recipient for every linked employee at EACH plant they
    // own, not merely the first plant. Delegated admins remain plant-scoped.
    let plant_ids: Vec<Uuid> = if matches!(auth_user.role.as_str(), "owner" | "plant_owner") {
        sqlx::query_scalar(
            "SELECT id FROM rmc_plants WHERE owner_id=$1 AND is_active=TRUE ORDER BY id",
        )
        .bind(auth_user.user_id)
        .fetch_all(&state.db)
        .await?
    } else {
        sqlx::query_scalar(
            "SELECT DISTINCT plant_id FROM plant_staff WHERE user_id=$1 AND is_active=TRUE ORDER BY plant_id",
        )
        .bind(auth_user.user_id)
        .fetch_all(&state.db)
        .await?
    };

    // Drivers and staff write to the SAME workforce_attendance table.
    // Return real check-in/out timestamps, including the owning plant's name;
    // login and permission acceptance alone never mark attendance.
    let attendance: Vec<Value> = sqlx::query_scalar(
        r#"SELECT jsonb_build_object(
            'id',a.id,'plant_id',a.plant_id,'plant_name',p.name,
            'date',a.attendance_date,'user_name',u.full_name,
            'role',COALESCE(
                (SELECT ps.role FROM plant_staff ps
                 WHERE ps.user_id=a.user_id AND ps.plant_id=a.plant_id
                 ORDER BY ps.is_active DESC LIMIT 1),u.role),
            'check_in',a.check_in_time,'check_out',a.check_out_time
          )
          FROM workforce_attendance a
          JOIN users u ON u.id=a.user_id
          JOIN rmc_plants p ON p.id=a.plant_id
          WHERE a.plant_id=ANY($1) AND a.attendance_date=(NOW() AT TIME ZONE 'Asia/Kolkata')::date
          ORDER BY a.check_in_time DESC NULLS LAST,a.id
          LIMIT 500"#,
    )
    .bind(&plant_ids)
    .fetch_all(&state.db)
    .await?;

    let leave_requests: Vec<Value> = sqlx::query_scalar(
        r#"SELECT jsonb_build_object(
            'id',l.id,'plant_id',l.plant_id,'user_name',u.full_name,
            'leave_type',l.leave_type,'start_date',l.start_date,
            'end_date',l.end_date,'reason',l.reason,'status',l.status
          )
          FROM workforce_leave_requests l JOIN users u ON u.id=l.user_id
          WHERE l.plant_id=ANY($1) AND l.status='PENDING'
          ORDER BY l.created_at DESC LIMIT 200"#,
    )
    .bind(&plant_ids)
    .fetch_all(&state.db)
    .await?;

    let client_visits: Vec<Value> = sqlx::query_scalar(
        r#"SELECT jsonb_build_object(
            'id',v.id,'plant_id',v.plant_id,'user_name',u.full_name,
            'client_name',v.client_name,'purpose',v.purpose,
            'scheduled_for',v.scheduled_for,'site_address',v.site_address,
            'status',v.status
          )
          FROM workforce_client_visits v JOIN users u ON u.id=v.user_id
          WHERE v.plant_id=ANY($1) AND v.status IN ('SCHEDULED','IN_PROGRESS')
          ORDER BY v.scheduled_for DESC LIMIT 200"#,
    )
    .bind(&plant_ids)
    .fetch_all(&state.db)
    .await?;

    let expense_claims: Vec<Value> = sqlx::query_scalar(
        r#"SELECT jsonb_build_object(
            'id',c.id,'plant_id',c.plant_id,'user_name',u.full_name,
            'category',c.category,'amount',c.amount::DOUBLE PRECISION,
            'expense_date',c.expense_date,'description',c.description,
            'receipt_reference',c.receipt_reference,'status',c.status
          )
          FROM workforce_expense_claims c JOIN users u ON u.id=c.user_id
          WHERE c.plant_id=ANY($1) AND c.status='PENDING_APPROVAL'
          ORDER BY c.created_at DESC LIMIT 200"#,
    )
    .bind(&plant_ids)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(json!({
        "success": true,
        "mode": "owner_control",
        "plant_ids": plant_ids,
        "attendance": attendance,
        "leave_requests": leave_requests,
        "client_visits": client_visits,
        "expense_claims": expense_claims
    })))
}

pub async fn owner_leave_decision(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(request_id): Path<Uuid>,
    Json(payload): Json<DecisionPayload>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["owner", "plant_owner", "admin"])?;

    let plant: Uuid =
        sqlx::query_scalar("SELECT plant_id FROM workforce_leave_requests WHERE id=$1")
            .bind(request_id)
            .fetch_optional(&state.db)
            .await?
            .ok_or_else(|| AppError::NotFound("Request not found".into()))?;
    ensure_plant_access(&state, &auth_user, plant).await?;
    if !["APPROVE", "REJECT"].contains(&payload.action.to_uppercase().as_str()) {
        return Err(AppError::BadRequest(
            "Decision must be APPROVE or REJECT".into(),
        ));
    }
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
          AND ($5 = 'admin' OR EXISTS (
              SELECT 1 FROM rmc_plants p
              WHERE p.id = workforce_leave_requests.plant_id AND p.owner_id = $3
          ))
        "#,
    )
    .bind(status)
    .bind(payload.note)
    .bind(auth_user.user_id)
    .bind(request_id)
    .bind(&auth_user.role)
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

    let plant: Uuid =
        sqlx::query_scalar("SELECT plant_id FROM workforce_expense_claims WHERE id=$1")
            .bind(claim_id)
            .fetch_optional(&state.db)
            .await?
            .ok_or_else(|| AppError::NotFound("Request not found".into()))?;
    ensure_plant_access(&state, &auth_user, plant).await?;
    if !["APPROVE", "REJECT"].contains(&payload.action.to_uppercase().as_str()) {
        return Err(AppError::BadRequest(
            "Decision must be APPROVE or REJECT".into(),
        ));
    }
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
          AND ($5 = 'admin' OR EXISTS (
              SELECT 1 FROM rmc_plants p
              WHERE p.id = workforce_expense_claims.plant_id AND p.owner_id = $3
          ))
        "#,
    )
    .bind(status)
    .bind(payload.note)
    .bind(auth_user.user_id)
    .bind(claim_id)
    .bind(&auth_user.role)
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
    super::staff_module_permissions::require(
        &state,
        &auth_user,
        plant_id,
        "workforce",
        super::staff_module_permissions::Action::Edit,
    )
    .await?;

    let start = parse_clock_time(&payload.start_time)?;
    let end = parse_clock_time(&payload.end_time)?;
    let grace = payload.grace_minutes.unwrap_or(10);
    if !(0..=1440).contains(&grace)
        || payload
            .half_day_threshold_minutes
            .is_some_and(|minutes| !(1..=1440).contains(&minutes))
    {
        return Err(AppError::BadRequest(
            "Invalid shift grace or half-day threshold".into(),
        ));
    }
    let active = payload.active.unwrap_or(true);

    let id: Uuid = sqlx::query_scalar(
        r#"
        INSERT INTO workforce_shifts (plant_id, name, start_time, end_time, is_night_shift, grace_minutes, half_day_threshold_minutes, is_active)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id
        "#,
    )
    .bind(plant_id)
    .bind(&payload.name)
    .bind(start)
    .bind(end)
    .bind(payload.is_night_shift.unwrap_or(end < start))
    .bind(grace)
    .bind(payload.half_day_threshold_minutes)
    .bind(active)
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
            "grace_minutes": grace,
            "half_day_threshold_minutes": payload.half_day_threshold_minutes,
            "active": active
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
    super::staff_module_permissions::require(
        &state,
        &auth_user,
        plant_id,
        "workforce",
        super::staff_module_permissions::Action::Edit,
    )
    .await?;

    let d = NaiveDate::parse_from_str(&date_str, "%Y-%m-%d").map_err(|_| {
        AppError::BadRequest("Invalid date format, expected YYYY-MM-DD".to_string())
    })?;

    let shift = if payload.week_off {
        None
    } else {
        Some(payload.shift_id.ok_or_else(|| {
            AppError::BadRequest("Select a shift or mark the employee off".into())
        })?)
    };
    let updated = sqlx::query(
        r#"
        INSERT INTO workforce_roster_schedules (plant_id, user_id, shift_id, date_key)
        SELECT $1, $2, $3, $4
        WHERE EXISTS (
            SELECT 1 FROM plant_staff ps JOIN users u ON u.id = ps.user_id AND u.is_active
            WHERE ps.plant_id = $1 AND ps.user_id = $2 AND ps.role = u.role AND ps.is_active
              AND ps.removed_at IS NULL AND ps.employment_status = 'ACTIVE'
        ) AND ($3::uuid IS NULL OR EXISTS (
            SELECT 1 FROM workforce_shifts WHERE id = $3 AND plant_id = $1 AND COALESCE(is_active, TRUE)
        ))
        ON CONFLICT (plant_id, user_id, date_key) DO UPDATE SET shift_id = EXCLUDED.shift_id
        "#,
    )
    .bind(plant_id)
    .bind(user_id)
    .bind(shift)
    .bind(d)
    .execute(&state.db)
    .await?;
    if updated.rows_affected() == 0 {
        return Err(AppError::BadRequest(
            "Select an active employee and shift from this plant".into(),
        ));
    }

    Ok(Json(json!({
        "success": true,
        "roster": {
            "plant_id": plant_id,
            "user_id": user_id,
            "date": date_str,
            "shift_id": shift,
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

    super::staff_module_permissions::require(
        &state,
        &auth_user,
        plant_id,
        "workforce",
        super::staff_module_permissions::Action::Edit,
    )
    .await?;
    if payload
        .radius_m
        .is_some_and(|radius| !radius.is_finite() || radius <= 0.0)
    {
        return Err(AppError::BadRequest(
            "Radius must be a positive number of metres".into(),
        ));
    }
    if payload
        .timezone_name
        .as_deref()
        .is_some_and(|timezone| timezone != "Asia/Kolkata")
    {
        return Err(AppError::BadRequest(
            "Attendance dates use Asia/Kolkata".into(),
        ));
    }
    let radius: f64 = sqlx::query_scalar(
        "UPDATE rmc_plants SET attendance_radius_m = COALESCE($2, attendance_radius_m)
         WHERE id = $1 AND is_active RETURNING attendance_radius_m",
    )
    .bind(plant_id)
    .bind(payload.radius_m)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Active plant not found".into()))?;

    Ok(Json(json!({
        "success": true,
        "plant_id": plant_id,
        "attendance_config": { "radius_m": radius, "timezone_name": "Asia/Kolkata" },
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
    let query = match kind.to_lowercase().as_str() {
        "leave" | "leaves" => "SELECT plant_id FROM workforce_leave_requests WHERE id=$1",
        "expense" | "expenses" => "SELECT plant_id FROM workforce_expense_claims WHERE id=$1",
        "visit" | "visits" => "SELECT plant_id FROM workforce_client_visits WHERE id=$1",
        _ => return Err(AppError::BadRequest("Unsupported decision kind".into())),
    };
    let plant: Uuid = sqlx::query_scalar(query)
        .bind(id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("Request not found".into()))?;
    ensure_plant_access(&state, &auth_user, plant).await?;
    if !["APPROVE", "REJECT"].contains(&payload.action.to_uppercase().as_str()) {
        return Err(AppError::BadRequest(
            "Decision must be APPROVE or REJECT".into(),
        ));
    }
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
                  AND ($5 = 'admin' OR EXISTS (
                      SELECT 1 FROM rmc_plants p
                      WHERE p.id = workforce_leave_requests.plant_id AND p.owner_id = $3
                  ))
                "#,
            )
            .bind(status)
            .bind(payload.note.as_deref())
            .bind(auth_user.user_id)
            .bind(id)
            .bind(&auth_user.role)
            .execute(&state.db)
            .await?;
        }
        "expense" | "expenses" => {
            sqlx::query(
                r#"
                UPDATE workforce_expense_claims
                SET status = $1, owner_note = $2, approved_by = $3, approved_at = NOW()
                WHERE id = $4
                  AND ($5 = 'admin' OR EXISTS (
                      SELECT 1 FROM rmc_plants p
                      WHERE p.id = workforce_expense_claims.plant_id AND p.owner_id = $3
                  ))
                "#,
            )
            .bind(status)
            .bind(payload.note.as_deref())
            .bind(auth_user.user_id)
            .bind(id)
            .bind(&auth_user.role)
            .execute(&state.db)
            .await?;
        }
        "visit" | "visits" => {
            let updated = sqlx::query(
                r#"
                UPDATE workforce_client_visits
                SET status = $1
                WHERE id = $2 AND status IN ('SCHEDULED', $1)
                  AND ($4 = 'admin' OR EXISTS (
                      SELECT 1 FROM rmc_plants p
                      WHERE p.id = workforce_client_visits.plant_id AND p.owner_id = $3
                  ))
                "#,
            )
            .bind(status)
            .bind(id)
            .bind(auth_user.user_id)
            .bind(&auth_user.role)
            .execute(&state.db)
            .await?;
            if updated.rows_affected() == 0 {
                return Err(AppError::Conflict(
                    "Only scheduled visits can receive an owner decision".into(),
                ));
            }
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

    for (plant_id, plant_name) in plants {
        super::staff_module_permissions::require(
            &state,
            &auth_user,
            plant_id,
            "workforce",
            super::staff_module_permissions::Action::View,
        )
        .await?;
        let shift_rows = sqlx::query(
            "SELECT id, name, start_time::text AS st, end_time::text AS et, COALESCE(grace_minutes,10) AS grace_minutes, half_day_threshold_minutes, COALESCE(is_active,true) AS is_active FROM workforce_shifts WHERE plant_id = $1 ORDER BY name",
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
                    "grace_minutes": r.get::<i32, _>("grace_minutes"),
                    "half_day_threshold_minutes": r.get::<Option<i32>, _>("half_day_threshold_minutes"),
                    "active": r.get::<bool, _>("is_active")
                })
            })
            .collect();

        let staff_rows = sqlx::query(
            r#"
            SELECT u.id, u.full_name, u.role, a.check_in_time, a.check_out_time,
                a.check_in_geofence, a.check_out_geofence
            FROM plant_staff ps
            JOIN users u ON u.id = ps.user_id
            LEFT JOIN workforce_attendance a ON a.plant_id = ps.plant_id
              AND a.user_id = ps.user_id AND a.attendance_date = $2
            WHERE ps.plant_id = $1 AND ps.is_active = TRUE
            ORDER BY u.full_name
            "#,
        )
        .bind(plant_id)
        .bind(target_date)
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

            let check_in: Option<chrono::DateTime<chrono::Utc>> = staff.get("check_in_time");
            let check_out: Option<chrono::DateTime<chrono::Utc>> = staff.get("check_out_time");
            let attendance = (check_in.is_some() || check_out.is_some()).then(|| {
                json!({
                    "check_in": check_in,
                    "check_out": check_out,
                    "check_in_geofence": staff.get::<Option<Value>, _>("check_in_geofence"),
                    "check_out_geofence": staff.get::<Option<Value>, _>("check_out_geofence"),
                })
            });
            employees.push(json!({
                "user_id": uid,
                "name": name,
                "role": role,
                "classification": classification,
                "roster": roster_json,
                "shift": shift_json,
                "attendance": attendance
            }));
        }

        let radius = workforce_repo::attendance_radius(&state.db, plant_id).await?;
        plant_overviews.push(json!({
            "plant_id": plant_id,
            "plant_name": plant_name,
            "date": date_key,
            "shifts": shifts,
            "employees": employees,
            "attendance_config": {
                "radius_m": radius,
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
    let today = workforce_repo::attendance_today(&state.db).await?;
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

    let radius = if pid.is_nil() {
        None
    } else {
        Some(workforce_repo::attendance_radius(&state.db, pid).await?)
    };
    Ok(Json(json!({
        "plant_id": pid,
        "today": today.to_string(),
        "attendance_config": {
            "radius_m": radius,
            "timezone_name": "Asia/Kolkata"
        },
        "roster": roster
    })))
}

#[cfg(test)]
mod roster_access_tests {
    use super::roster_access_allowed;

    #[test]
    fn roster_access_requires_exact_ownership_or_active_membership() {
        assert!(!roster_access_allowed("admin", false, false));
        assert!(roster_access_allowed("admin", false, true));
        assert!(roster_access_allowed("owner", true, false));
        assert!(roster_access_allowed("plant_owner", true, false));
        assert!(!roster_access_allowed("owner", false, true));
        assert!(!roster_access_allowed("plant_owner", false, true));
        assert!(roster_access_allowed("dispatcher", false, true));
        assert!(!roster_access_allowed("dispatcher", false, false));
        assert!(!roster_access_allowed("customer", true, true));
    }
}
