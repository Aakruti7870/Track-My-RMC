use crate::{
    auth::{control_center::WebAdmin, totp::verify_staff_totp_login, AuthUser},
    error::AppError,
    state::AppState,
};
use axum::{
    extract::{Path, State},
    http::{header::AUTHORIZATION, HeaderMap},
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use sqlx::Row;
use uuid::Uuid;

#[derive(Debug, Deserialize)]
pub struct CollectionPage {
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

pub async fn collection(
    State(state): State<AppState>,
    admin: WebAdmin,
    axum::extract::Path(kind): axum::extract::Path<String>,
    axum::extract::Query(page): axum::extract::Query<CollectionPage>,
) -> Result<Json<serde_json::Value>, AppError> {
    let (permission,query)=match kind.as_str() {
        "users"=>("user.view","SELECT jsonb_build_object('id',id,'name',full_name,'email',email,'role',role,'active',is_active) FROM users ORDER BY id LIMIT $1 OFFSET $2"),
        "plants"=>("plant.view","SELECT jsonb_build_object('id',id,'name',name,'city',city,'owner_id',owner_id,'active',is_active) FROM rmc_plants ORDER BY id LIMIT $1 OFFSET $2"),
        "orders"=>("order.view","SELECT jsonb_build_object('id',id,'number',order_number,'plant_id',plant_id,'quantity',total_quantity_m3::DOUBLE PRECISION,'status',status) FROM orders ORDER BY id LIMIT $1 OFFSET $2"),
        "support"=>("support.view","SELECT jsonb_build_object('id',c.id,'subject',c.subject,'status',c.status,'created_at',c.created_at,'followup_due_at',f.due_at,'awaiting_staff_reply',f.awaiting_staff_reply,'reminders_sent',f.reminder_count) FROM support_cases c LEFT JOIN native_support_followups f ON f.case_id=c.id ORDER BY c.created_at DESC,c.id LIMIT $1 OFFSET $2"),
        "service_enquiries"=>("support.view","SELECT jsonb_build_object('id',id,'service_type',service_type,'contact_name',contact_name,'contact_phone',contact_phone,'location',location,'required_date',required_date,'details',details,'status',status,'created_at',created_at) FROM customer_service_enquiries ORDER BY created_at DESC LIMIT $1 OFFSET $2"),
        "rmc_rfq_leads"=>("support.view","SELECT jsonb_build_object('id',id,'customer_name',customer_name,'customer_email',customer_email,'customer_gstin',customer_gstin,'site_contact_phone',site_contact_phone,'grade',grade,'quantity_m3',quantity_m3::DOUBLE PRECISION,'site_address',site_address,'delivery_date',delivery_date,'pump_required',pump_required,'google_place_id',google_place_id,'status',status,'outreach_status',outreach_status,'outreach_notes',outreach_notes,'created_at',created_at) FROM rmc_rfq_leads ORDER BY created_at DESC LIMIT $1 OFFSET $2"),
        "kyc"=>("kyc.view","SELECT jsonb_build_object('customer_id',p.user_id,'customer',u.full_name,'verified_name',p.verified_name,'status',p.kyc_status,'evidence_verified',EXISTS(SELECT 1 FROM customer_digilocker_sessions d WHERE d.user_id=p.user_id AND d.status='PENDING' AND d.verified_at IS NOT NULL AND d.provider_environment=$3)) FROM user_profiles p JOIN users u ON u.id=p.user_id WHERE u.role='customer' AND u.is_active AND p.kyc_status='pending' ORDER BY p.updated_at LIMIT $1 OFFSET $2"),
        "audit"=>("audit.view","SELECT jsonb_build_object('id',id,'action',action,'resource_type',resource_type,'resource_id',resource_id,'created_at',created_at) FROM audit_logs ORDER BY id LIMIT $1 OFFSET $2"),
        "sessions"=>("session.view","SELECT jsonb_build_object('user_id',user_id,'created_at',created_at,'expires_at',expires_at,'revoked',revoked_at IS NOT NULL) FROM control_center_sessions ORDER BY created_at,token_hash LIMIT $1 OFFSET $2"),
        _=>return Err(AppError::NotFound("Control Center workspace not found".into())),
    };
    admin.require(permission)?;
    let limit = page.limit.unwrap_or(50).clamp(1, 100);
    let offset = page.offset.unwrap_or(0);
    if !(0..=10000).contains(&offset) {
        return Err(AppError::BadRequest("Invalid page offset".into()));
    }
    let rows: Vec<serde_json::Value> = if kind == "kyc" {
        sqlx::query_scalar(query)
            .bind(limit)
            .bind(offset)
            .bind(crate::routes::digilocker_kyc::approved_provider_environment().ok())
            .fetch_all(&state.db)
            .await?
    } else {
        sqlx::query_scalar(query)
            .bind(limit)
            .bind(offset)
            .fetch_all(&state.db)
            .await?
    };
    Ok(Json(json!({"items":rows,"limit":limit,"offset":offset})))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CentralKycDecision {
    pub reason: String,
}

/// Only a Central Admin with explicit KYC permissions and a fresh step-up may
/// decide a customer KYC case. Provider-confirmed consent is mandatory for approval.
pub async fn central_kyc_decision(
    State(state): State<AppState>,
    admin: WebAdmin,
    headers: HeaderMap,
    Path((customer_id, decision)): Path<(Uuid, String)>,
    Json(body): Json<CentralKycDecision>,
) -> Result<Json<serde_json::Value>, AppError> {
    admin.require("kyc.review")?;
    require_recent_step_up(&state, &admin, &headers).await?;
    let reason = body.reason.trim();
    if reason.len() < 10 || reason.len() > 500 {
        return Err(AppError::BadRequest(
            "A KYC decision requires a specific reason (10-500 characters)".into(),
        ));
    }
    let status = match decision.as_str() {
        "approve" => "verified",
        "reject" => "rejected",
        "reset" => "unverified",
        _ => return Err(AppError::BadRequest("Unknown KYC decision".into())),
    };
    // No enabled, approved provider -> NULL environment -> approval denied.
    // Reject/reset remain available for support remediation.
    let provider_environment = crate::routes::digilocker_kyc::approved_provider_environment().ok();
    let mut tx = state.db.begin().await?;
    let updated: Option<Uuid> = sqlx::query_scalar(
        "UPDATE user_profiles AS p SET kyc_status=$2,updated_at=NOW()
         FROM users u WHERE p.user_id=$1 AND p.user_id=u.id AND u.role='customer'
         AND u.is_active
         AND (($2='verified' AND p.kyc_status='pending' AND p.verified_name IS NOT NULL
               AND EXISTS (SELECT 1 FROM customer_digilocker_sessions d
                           WHERE d.user_id=p.user_id AND d.status='PENDING'
                           AND d.verified_at IS NOT NULL
                           AND d.provider_environment=$3))
           OR ($2='rejected' AND p.kyc_status='pending')
           OR ($2='unverified' AND p.kyc_status IN ('verified','rejected')))
         RETURNING p.user_id",
    )
    .bind(customer_id)
    .bind(status)
    .bind(provider_environment)
    .fetch_optional(&mut *tx)
    .await?;
    if updated != Some(customer_id) {
        return Err(AppError::Conflict(
            "KYC state transition denied; approved provider evidence may be missing".into(),
        ));
    }
    sqlx::query(
        "INSERT INTO audit_logs(user_id,action,resource_type,resource_id,metadata)
         VALUES($1,'control_center.kyc.review','customer',$2,$3)",
    )
    .bind(admin.user_id)
    .bind(customer_id.to_string())
    .bind(json!({"status":status,"reason":reason,
                 "provider_environment": if status == "verified" {provider_environment} else {None}}))
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(json!({"success":true,"status":status})))
}

fn session_token_hash(headers: &HeaderMap) -> Result<String, AppError> {
    let bearer = headers
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::Unauthorized("Missing bearer session".to_string()))?;
    Ok(format!("{:x}", Sha256::digest(bearer.as_bytes())))
}

pub(crate) async fn require_recent_step_up(
    state: &AppState,
    user: &AuthUser,
    headers: &HeaderMap,
) -> Result<(), AppError> {
    require_recent_step_up_using(&state.db, user, headers).await
}

pub(crate) async fn require_recent_step_up_using<
    'e,
    E: sqlx::Executor<'e, Database = sqlx::Postgres>,
>(
    executor: E,
    user: &AuthUser,
    headers: &HeaderMap,
) -> Result<(), AppError> {
    let token_hash = session_token_hash(headers)?;
    let verified: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM control_center_step_ups WHERE user_id = $1 AND token_hash = $2 AND expires_at > clock_timestamp())",
    )
    .bind(user.user_id)
    .bind(token_hash)
    .fetch_one(executor)
    .await?;
    if !verified {
        return Err(AppError::Forbidden(
            "Recent authenticator verification is required for this action".to_string(),
        ));
    }
    Ok(())
}

#[derive(Debug, Deserialize, Serialize)]
pub struct AiCommandPayload {
    pub prompt: String,
    pub confirmed: Option<bool>,
    pub reason: Option<String>,
}

pub async fn run_ai_command(
    State(state): State<AppState>,
    auth_user: WebAdmin,
    Json(payload): Json<AiCommandPayload>,
) -> Result<impl IntoResponse, AppError> {
    auth_user.require("ai.diagnose")?;

    let prompt_lower = payload.prompt.to_lowercase();
    let command_id = format!("cmd-{}", Uuid::new_v4().simple());

    // Check denied security patterns
    if prompt_lower.contains("secret")
        || prompt_lower.contains("drop table")
        || prompt_lower.contains("delete from users")
        || prompt_lower.contains("bypass")
    {
        return Err(AppError::Forbidden(
            "This capability is prohibited by the Control Center policy".to_string(),
        ));
    }

    let is_high_risk = prompt_lower.contains("suspend")
        || prompt_lower.contains("revoke")
        || prompt_lower.contains("deploy");
    if is_high_risk && !payload.confirmed.unwrap_or(false) {
        return Ok(Json(json!({
            "command_id": command_id,
            "intent": "privileged_action",
            "risk": "HIGH",
            "status": "confirmation_required",
            "message": "Explicit confirmation and reason are required before executing privileged action."
        })));
    }

    if is_high_risk {
        return Err(AppError::BadRequest(
            "This diagnostic endpoint cannot execute privileged commands".into(),
        ));
    }
    let connected: i32 = sqlx::query_scalar("SELECT 1").fetch_one(&state.db).await?;
    // Record only diagnostic metadata; never claim execution of an unsupported operation.

    sqlx::query(
        r#"
        INSERT INTO audit_logs (user_id, action, resource_type, resource_id, metadata)
        VALUES ($1, 'control_center.ai.command', 'ai_command', $2, $3)
        "#,
    )
    .bind(auth_user.user_id)
    .bind(&command_id)
    .bind(json!({ "prompt": payload.prompt, "status": "completed" }))
    .execute(&state.db)
    .await?;

    Ok(Json(json!({
        "command_id": command_id,
        "database_connected": connected == 1,
        "intent": "diagnostic_query",
        "risk": "LOW",
        "status": "completed",
        "message": "Database connectivity checked"
    })))
}

pub async fn get_capabilities(
    State(_state): State<AppState>,
    auth_user: WebAdmin,
) -> Result<impl IntoResponse, AppError> {
    Ok(Json(json!({
        "permissions": auth_user.permissions,
        "session_security": {"auth_surface":"control_center_web", "control_center_mfa":true}
    })))
}

pub async fn get_reviewer_access(
    State(state): State<AppState>,
    auth_user: WebAdmin,
) -> Result<impl IntoResponse, AppError> {
    auth_user.require("reviewer_access.manage")?;

    let enabled: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM play_review_fixtures WHERE enabled = TRUE)",
    )
    .fetch_one(&state.db)
    .await?;

    Ok(Json(json!({
        "enabled": enabled,
        "environment": state.config.environment,
        "mode": if enabled { "active" } else { "disabled" }
    })))
}

#[derive(Debug, Deserialize, Serialize)]
pub struct ReviewerAccessPayload {
    pub enabled: bool,
    pub reason: String,
}

pub async fn set_reviewer_access(
    State(state): State<AppState>,
    auth_user: WebAdmin,
    headers: HeaderMap,
    Json(payload): Json<ReviewerAccessPayload>,
) -> Result<impl IntoResponse, AppError> {
    auth_user.require("reviewer_access.manage")?;
    require_recent_step_up(&state, &auth_user, &headers).await?;
    if payload.reason.trim().len() < 10 {
        return Err(AppError::BadRequest(
            "A reason of at least 10 characters is required".to_string(),
        ));
    }

    let mut tx = state.db.begin().await?;
    sqlx::query("UPDATE play_review_fixtures SET enabled = $1")
        .bind(payload.enabled)
        .execute(&mut *tx)
        .await?;
    if !payload.enabled {
        // Revocation must invalidate access JTIs and any rotating refresh
        // credentials in the same transaction as the fixture disable.
        sqlx::query(
            "UPDATE users SET active_session_jti=NULL,
             auth_revoked_at=clock_timestamp(),updated_at=NOW()
             WHERE id IN (SELECT user_id FROM play_review_fixtures)",
        )
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "DELETE FROM account_refresh_tokens
             WHERE user_id IN (SELECT user_id FROM play_review_fixtures)",
        )
        .execute(&mut *tx)
        .await?;
    }

    sqlx::query(
        r#"
        INSERT INTO audit_logs (user_id, action, resource_type, metadata)
        VALUES ($1, 'control_center.reviewer_access', 'reviewer_fixtures', $2)
        "#,
    )
    .bind(auth_user.user_id)
    .bind(json!({ "enabled": payload.enabled, "reason": payload.reason }))
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    Ok(Json(json!({
        "success": true,
        "enabled": payload.enabled,
        "message": format!("Reviewer access set to {}", payload.enabled)
    })))
}

pub async fn list_admin_access(
    State(state): State<AppState>,
    auth_user: WebAdmin,
) -> Result<impl IntoResponse, AppError> {
    auth_user.require("admin_access.manage")?;

    let admins = sqlx::query(
        r#"
        SELECT id, full_name, email, is_active, created_at
        FROM users WHERE role = 'central_admin'
        ORDER BY created_at ASC
        "#,
    )
    .fetch_all(&state.db)
    .await?;

    let result: Vec<_> = admins
        .into_iter()
        .map(|a| {
            let id: Uuid = a.get("id");
            let name: String = a.get("full_name");
            let email: Option<String> = a.get("email");
            let enabled: bool = a.get("is_active");
            let created_at: chrono::DateTime<chrono::Utc> = a.get("created_at");
            json!({
                "id": id,
                "name": name,
                "email": email,
                "enabled": enabled,
                "created_at": created_at
            })
        })
        .collect();

    Ok(Json(json!({ "success": true, "admins": result })))
}

#[derive(Debug, Deserialize, Serialize)]
pub struct AdminAccessUpdatePayload {
    pub email: String,
    pub enabled: bool,
    pub reason: String,
}

pub async fn update_admin_access(
    State(state): State<AppState>,
    auth_user: WebAdmin,
    headers: HeaderMap,
    Json(payload): Json<AdminAccessUpdatePayload>,
) -> Result<impl IntoResponse, AppError> {
    auth_user.require("admin_access.manage")?;
    require_recent_step_up(&state, &auth_user, &headers).await?;
    if payload.reason.trim().len() < 10 {
        return Err(AppError::BadRequest(
            "A reason of at least 10 characters is required".to_string(),
        ));
    }
    let email_lower = payload.email.trim().to_lowercase();
    if !payload.enabled
        && auth_user
            .email
            .as_deref()
            .is_some_and(|email| email.eq_ignore_ascii_case(&email_lower))
    {
        return Err(AppError::Forbidden(
            "An administrator cannot disable their own account".to_string(),
        ));
    }
    let mut tx = state.db.begin().await?;
    let target: Option<Uuid> = sqlx::query_scalar(
        "SELECT id FROM users WHERE LOWER(email)=$1 AND role='central_admin' FOR UPDATE",
    )
    .bind(&email_lower)
    .fetch_optional(&mut *tx)
    .await?;
    let target =
        target.ok_or_else(|| AppError::NotFound("Central Admin account not found".into()))?;
    if target == auth_user.user_id && !payload.enabled {
        return Err(AppError::Forbidden(
            "Cannot disable your own account".into(),
        ));
    }
    sqlx::query("UPDATE users SET is_active=$1,updated_at=NOW(),auth_revoked_at=CASE WHEN $1=FALSE THEN NOW() ELSE auth_revoked_at END WHERE id=$2")
        .bind(payload.enabled).bind(target).execute(&mut *tx).await?;
    if !payload.enabled {
        sqlx::query("UPDATE control_center_sessions SET revoked_at=NOW() WHERE user_id=$1 AND revoked_at IS NULL").bind(target).execute(&mut *tx).await?;
        sqlx::query("DELETE FROM control_center_step_ups WHERE user_id=$1")
            .bind(target)
            .execute(&mut *tx)
            .await?;
    }
    sqlx::query("INSERT INTO audit_logs (user_id,action,resource_type,resource_id,metadata) VALUES ($1,'control_center.admin_access','user',$2,$3)")
        .bind(auth_user.user_id).bind(target.to_string()).bind(json!({"enabled":payload.enabled,"reason":payload.reason})).execute(&mut *tx).await?;
    tx.commit().await?;

    Ok(Json(
        json!({ "success": true, "message": "Admin access updated" }),
    ))
}

pub async fn list_unowned_plants(
    State(state): State<AppState>,
    auth_user: WebAdmin,
) -> Result<impl IntoResponse, AppError> {
    auth_user.require("plant.view")?;

    let rows = sqlx::query(
        r#"
        SELECT p.id, p.name, p.code, p.city, p.state, p.address_line, p.contact_phone
        FROM rmc_plants p
        WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = p.owner_id AND u.role IN ('owner', 'plant_owner'))
        ORDER BY p.name
        "#,
    )
    .fetch_all(&state.db)
    .await?;

    let plants: Vec<_> = rows
        .into_iter()
        .map(|p| {
            let id: Uuid = p.get("id");
            let name: String = p.get("name");
            let code: String = p.get("code");
            let city: Option<String> = p.get("city");
            let state_val: Option<String> = p.get("state");
            let address: Option<String> = p.get("address_line");
            let phone: Option<String> = p.get("contact_phone");
            json!({
                "id": id,
                "name": name,
                "code": code,
                "city": city,
                "state": state_val,
                "address": address,
                "phone": phone
            })
        })
        .collect();

    Ok(Json(json!({ "success": true, "plants": plants })))
}

#[derive(Debug, Deserialize, Serialize)]
pub struct AssignOwnerPayload {
    pub plant_id: Uuid,
    pub owner_user_id: Uuid,
    pub reason: String,
}

pub async fn assign_plant_owner(
    State(state): State<AppState>,
    auth_user: WebAdmin,
    headers: HeaderMap,
    Json(payload): Json<AssignOwnerPayload>,
) -> Result<impl IntoResponse, AppError> {
    auth_user.require("owner.assign")?;
    require_recent_step_up(&state, &auth_user, &headers).await?;
    if payload.reason.trim().len() < 10 {
        return Err(AppError::BadRequest(
            "A reason of at least 10 characters is required".to_string(),
        ));
    }

    // Assignment must not silently promote staff, customers or administrators.
    let eligible: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM users WHERE id = $1 AND role IN ('owner', 'plant_owner') AND is_active = TRUE)",
    )
    .bind(payload.owner_user_id)
    .fetch_one(&state.db)
    .await?;
    if !eligible {
        return Err(AppError::Forbidden(
            "The nominated user must already be an active plant owner".to_string(),
        ));
    }

    let mut tx = state.db.begin().await?;
    let updated =
        sqlx::query("UPDATE rmc_plants SET owner_id = $1, updated_at = NOW() WHERE id = $2")
            .bind(payload.owner_user_id)
            .bind(payload.plant_id)
            .execute(&mut *tx)
            .await?;
    if updated.rows_affected() != 1 {
        return Err(AppError::NotFound("Plant not found".to_string()));
    }
    sqlx::query(
        "INSERT INTO audit_logs (user_id, action, resource_type, resource_id, metadata) VALUES ($1, 'control_center.assign_plant_owner', 'rmc_plant', $2, $3)",
    )
    .bind(auth_user.user_id)
    .bind(payload.plant_id.to_string())
    .bind(json!({"owner_user_id": payload.owner_user_id, "reason": payload.reason}))
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    Ok(Json(
        json!({ "success": true, "message": "Owner assigned to plant" }),
    ))
}

#[derive(Debug, Deserialize, Serialize)]
pub struct StepUpPayload {
    pub code: String,
}

pub async fn admin_step_up(
    State(state): State<AppState>,
    auth_user: WebAdmin,
    headers: HeaderMap,
    Json(payload): Json<StepUpPayload>,
) -> Result<impl IntoResponse, AppError> {
    let code = payload.code.trim();
    if code.len() != 6 || !code.bytes().all(|c| c.is_ascii_digit()) {
        return Err(AppError::Unauthorized(
            "A six-digit authenticator code is required".to_string(),
        ));
    }
    let hash = session_token_hash(&headers)?;
    let attempts: i32 = sqlx::query_scalar(
        "UPDATE control_center_sessions SET step_up_attempts = CASE WHEN step_up_window_started_at < NOW()-INTERVAL '5 minutes' THEN 1 ELSE step_up_attempts+1 END,
         step_up_window_started_at = CASE WHEN step_up_window_started_at < NOW()-INTERVAL '5 minutes' THEN NOW() ELSE step_up_window_started_at END
         WHERE token_hash=$1 AND user_id=$2 AND revoked_at IS NULL AND expires_at>NOW()
         RETURNING step_up_attempts",
    ).bind(&hash).bind(auth_user.user_id).fetch_one(&state.db).await?;
    if attempts > 5 {
        return Err(AppError::Forbidden(
            "Authenticator verification temporarily locked".into(),
        ));
    }
    // Verify the actual enrolled credential; never treat a supplied code as proof by itself.
    verify_staff_totp_login(&state.db, auth_user.user_id, code).await?;
    let token_hash = session_token_hash(&headers)?;
    sqlx::query(
        "INSERT INTO control_center_step_ups (user_id, token_hash, expires_at) VALUES ($1, $2, NOW() + INTERVAL '5 minutes') ON CONFLICT (user_id, token_hash) DO UPDATE SET expires_at = EXCLUDED.expires_at",
    )
    .bind(auth_user.user_id)
    .bind(token_hash)
    .execute(&state.db)
    .await?;
    Ok(Json(
        json!({ "success": true, "verified": true, "step_up_fresh": true, "expires_in_seconds": 300 }),
    ))
}

pub async fn admin_logout_all(
    State(state): State<AppState>,
    auth_user: WebAdmin,
    headers: HeaderMap,
) -> Result<impl IntoResponse, AppError> {
    require_recent_step_up(&state, &auth_user, &headers).await?;

    let mut tx = state.db.begin().await?;
    sqlx::query("UPDATE users SET auth_revoked_at = NOW(), updated_at = NOW() WHERE id = $1")
        .bind(auth_user.user_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("UPDATE control_center_sessions SET revoked_at=NOW() WHERE user_id=$1 AND revoked_at IS NULL")
        .bind(auth_user.user_id).execute(&mut *tx).await?;
    sqlx::query("DELETE FROM control_center_step_ups WHERE user_id = $1")
        .bind(auth_user.user_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        "INSERT INTO audit_logs (user_id, action, resource_type, metadata) VALUES ($1, 'control_center.session.logout_all', 'session', '{}')",
    )
    .bind(auth_user.user_id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(
        json!({ "success": true, "message": "All account sessions revoked" }),
    ))
}

pub async fn get_portal_summary(
    State(state): State<AppState>,
    auth_user: WebAdmin,
) -> Result<impl IntoResponse, AppError> {
    auth_user.require("system.view")?;

    let total_plants: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM rmc_plants WHERE is_active = TRUE")
            .fetch_one(&state.db)
            .await?;

    let total_users: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users WHERE is_active = TRUE")
        .fetch_one(&state.db)
        .await?;

    let total_orders: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM orders")
        .fetch_one(&state.db)
        .await?;

    let total_revenue: bigdecimal::BigDecimal = sqlx::query_scalar(
        "SELECT COALESCE(SUM(total_amount), 0) FROM orders WHERE payment_status = 'paid'",
    )
    .fetch_one(&state.db)
    .await?;

    let pending_kyc: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM user_profiles WHERE kyc_status = 'pending'")
            .fetch_one(&state.db)
            .await?;
    let onboarding_requests: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM plant_listing_requests WHERE status = 'PENDING'")
            .fetch_one(&state.db)
            .await?;
    let onboarding_approved: i64 = sqlx::query_scalar(
        "SELECT COUNT(DISTINCT plant_id) FROM plant_listing_requests WHERE status = 'APPROVED' AND plant_id IS NOT NULL",
    ).fetch_one(&state.db).await?;
    let pending_supplier_rfqs: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM rmc_rfq_leads WHERE status = 'PENDING_SUPPLIER' AND expires_at > NOW()",
    ).fetch_one(&state.db).await?;

    Ok(Json(json!({
        "success": true,
        "kpis": [
            { "label": "Active Plants", "value": if auth_user.permissions.iter().any(|p| p == "plant.view") { Some(total_plants) } else { None } },
            { "label": "Registered Users", "value": if auth_user.permissions.iter().any(|p| p == "user.view") { Some(total_users) } else { None } },
            { "label": "Total Orders", "value": if auth_user.permissions.iter().any(|p| p == "order.view") { Some(total_orders) } else { None } },
            { "label": "Paid Revenue", "value": if auth_user.permissions.iter().any(|p| p == "payment.view") { Some(total_revenue) } else { None } },
            { "label": "Pending KYC Verifications", "value": if auth_user.permissions.iter().any(|p| p == "kyc.view") { Some(pending_kyc) } else { None } },
            { "label": "Onboarding Requests", "value": if auth_user.permissions.iter().any(|p| p == "plant_owners.manage") { Some(onboarding_requests) } else { None } },
            { "label": "Approved Plant Listings", "value": if auth_user.permissions.iter().any(|p| p == "plant.view") { Some(onboarding_approved) } else { None } },
            { "label": "Unmatched Supplier RFQs", "value": if auth_user.permissions.iter().any(|p| p == "support.view") { Some(pending_supplier_rfqs) } else { None } }
        ]
    })))
}

#[derive(Debug, Deserialize)]
pub struct PlantMasterFilter {
    q: Option<String>,
    city: Option<String>,
    state: Option<String>,
    status: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
}

fn bounded_plant_filter(value: Option<String>, name: &str) -> Result<String, AppError> {
    let value = value.unwrap_or_default().trim().to_string();
    if value.chars().count() > 100 || value.chars().any(char::is_control) {
        return Err(AppError::BadRequest(format!("Invalid {name} filter")));
    }
    Ok(value)
}

/// Read-only, server-filtered platform directory. Google Places results are never
/// silently imported into this table; only first-party registered plant rows appear.
pub async fn list_plant_master(
    State(state): State<AppState>,
    admin: WebAdmin,
    axum::extract::Query(filters): axum::extract::Query<PlantMasterFilter>,
) -> Result<Json<serde_json::Value>, AppError> {
    admin.require("plant.view")?;
    admin.require("user.view")?; // Owner email and employee identities are personal data.
    let q = bounded_plant_filter(filters.q, "search")?;
    let city = bounded_plant_filter(filters.city, "city")?;
    let state_filter = bounded_plant_filter(filters.state, "state")?;
    let status = filters.status.as_deref().unwrap_or("all");
    if !matches!(status, "all" | "approved" | "unverified" | "inactive") {
        return Err(AppError::BadRequest("Invalid plant status filter".into()));
    }
    let limit = filters.limit.unwrap_or(20).clamp(1, 50);
    let offset = filters.offset.unwrap_or(0);
    if !(0..=10000).contains(&offset) {
        return Err(AppError::BadRequest("Invalid plant page offset".into()));
    }

    // Parameterized queries intentionally share their predicate for an accurate
    // total, independent of the current page. Never interpolate client input.
    let predicate = r#"
        FROM rmc_plants p
        JOIN users u ON u.id = p.owner_id
        WHERE ($1 = '' OR p.name ILIKE '%' || $1 || '%'
               OR p.code ILIKE '%' || $1 || '%'
               OR COALESCE(p.google_place_id, '') ILIKE '%' || $1 || '%')
          AND ($2 = '' OR p.city ILIKE '%' || $2 || '%')
          AND ($3 = '' OR p.state ILIKE '%' || $3 || '%')
          AND ($4 = 'all'
               OR ($4 = 'inactive' AND NOT p.is_active)
               OR ($4 = 'approved' AND p.is_active AND EXISTS(
                   SELECT 1 FROM plant_listing_requests lr
                   WHERE lr.plant_id = p.id AND lr.status = 'APPROVED'))
               OR ($4 = 'unverified' AND p.is_active AND NOT EXISTS(
                   SELECT 1 FROM plant_listing_requests lr
                   WHERE lr.plant_id = p.id AND lr.status = 'APPROVED')))
    "#;
    let total: i64 = sqlx::query_scalar(&format!("SELECT COUNT(*) {predicate}"))
        .bind(&q)
        .bind(&city)
        .bind(&state_filter)
        .bind(status)
        .fetch_one(&state.db)
        .await?;
    let rows: Vec<serde_json::Value> = sqlx::query_scalar(&format!(
        r#"
        SELECT jsonb_build_object(
            'id',p.id,'name',p.name,'code',p.code,
            'address',p.address_line,'city',p.city,'state',p.state,
            'active',p.is_active,'google_place_id',p.google_place_id,
            'owner_id',u.id,'owner_name',u.full_name,'owner_email',u.email,
            'owner_active',u.is_active,
            'onboarding_approved',EXISTS(
                SELECT 1 FROM plant_listing_requests lr
                WHERE lr.plant_id=p.id AND lr.status='APPROVED'),
            'intake_mode',COALESCE((SELECT order_intake_mode FROM plant_admin_controls WHERE plant_id=p.id),'DIRECT'),
            'staff_count',(SELECT COUNT(*) FROM plant_staff ps
                WHERE ps.plant_id=p.id AND ps.is_active AND ps.removed_at IS NULL))
        {predicate} ORDER BY p.updated_at DESC,p.id LIMIT $5 OFFSET $6
    "#
    ))
    .bind(&q)
    .bind(&city)
    .bind(&state_filter)
    .bind(status)
    .bind(limit)
    .bind(offset)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(
        json!({"items":rows,"total":total,"limit":limit,"offset":offset}),
    ))
}

/// One plant, one source of truth: owner and existing staff slot assignments.
/// Mutations remain with current owner and delegated manager APIs.
pub async fn get_plant_master(
    State(state): State<AppState>,
    admin: WebAdmin,
    Path(plant_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    admin.require("plant.view")?;
    admin.require("user.view")?;
    let plant: Option<serde_json::Value> = sqlx::query_scalar(
        r#"
        SELECT jsonb_build_object(
            'id',p.id,'name',p.name,'code',p.code,'address',p.address_line,
            'city',p.city,'state',p.state,'pincode',p.pincode,
            'contact_email',p.contact_email,'contact_phone',p.contact_phone,
            'google_place_id',p.google_place_id,'active',p.is_active,
            'capacity_m3_per_hr',p.capacity_m3_per_hr,
            'owner_id',u.id,'owner_name',u.full_name,'owner_email',u.email,
            'owner_active',u.is_active,'owner_verified',u.is_verified,
            'onboarding_approved',EXISTS(
                SELECT 1 FROM plant_listing_requests lr
                WHERE lr.plant_id=p.id AND lr.status='APPROVED'),
            'intake_mode',COALESCE((SELECT order_intake_mode FROM plant_admin_controls WHERE plant_id=p.id),'DIRECT'))
        FROM rmc_plants p JOIN users u ON u.id=p.owner_id WHERE p.id=$1
    "#,
    )
    .bind(plant_id)
    .fetch_optional(&state.db)
    .await?;
    let plant = plant.ok_or_else(|| AppError::NotFound("Plant not found".into()))?;
    let staff: Vec<serde_json::Value> = sqlx::query_scalar(
        r#"
        SELECT jsonb_build_object(
            'user_id',u.id,'name',u.full_name,'email',u.email,'role',ps.role,
            'active',ps.is_active,'employment_status',ps.employment_status,
            'invitation_expires_at',ps.invitation_expires_at)
        FROM plant_staff ps JOIN users u ON u.id=ps.user_id
        WHERE ps.plant_id=$1 AND ps.removed_at IS NULL
        ORDER BY ps.role,u.full_name
    "#,
    )
    .bind(plant_id)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(json!({"plant":plant,"staff":staff})))
}

#[cfg(test)]
mod security_tests {
    use super::*;
    use axum::http::HeaderValue;

    #[test]
    fn plant_master_filters_are_bounded_and_reject_controls() {
        assert_eq!(
            bounded_plant_filter(Some("  Panvel  ".into()), "city").unwrap(),
            "Panvel"
        );
        assert!(bounded_plant_filter(Some("x".repeat(101)), "search").is_err());
        assert!(bounded_plant_filter(Some("bad\nregion".into()), "state").is_err());
    }

    #[test]
    fn step_up_requires_bearer_session() {
        let headers = HeaderMap::new();
        assert!(session_token_hash(&headers).is_err());
    }

    #[test]
    fn step_up_hash_is_session_specific_and_does_not_store_bearer() {
        let mut first = HeaderMap::new();
        first.insert(
            AUTHORIZATION,
            HeaderValue::from_static("Bearer session-one"),
        );
        let mut second = HeaderMap::new();
        second.insert(
            AUTHORIZATION,
            HeaderValue::from_static("Bearer session-two"),
        );
        let first_hash = session_token_hash(&first).expect("valid bearer");
        let second_hash = session_token_hash(&second).expect("valid bearer");
        assert_eq!(first_hash.len(), 64);
        assert_ne!(first_hash, second_hash);
        assert!(!first_hash.contains("session-one"));
    }
}
