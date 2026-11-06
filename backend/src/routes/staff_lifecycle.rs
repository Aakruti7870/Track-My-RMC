//! Work-email registration and auditable, non-destructive plant assignment lifecycle.
use crate::{auth::AuthUser, error::AppError, state::AppState};
use axum::{
    extract::{Path, State},
    Json,
};
use chrono::{Duration, Utc};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::{Postgres, Transaction};
use uuid::Uuid;

pub const ROLES: &[&str] = &[
    "dispatcher",
    "operator",
    "supervisor",
    "accountant",
    "quality_engineer",
    "fleet_manager",
    "store_manager",
];

pub async fn require_login_eligible(
    state: &AppState,
    user: Uuid,
    role: &str,
) -> Result<(), AppError> {
    if !ROLES.contains(&role) {
        return Ok(());
    }
    let eligible:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM plant_staff ps JOIN rmc_plants p ON p.id=ps.plant_id
        WHERE ps.user_id=$1 AND ps.role=$2 AND ps.removed_at IS NULL AND p.is_active
        AND ((ps.is_active AND ps.employment_status='ACTIVE') OR (ps.employment_status='PENDING' AND ps.invitation_expires_at>clock_timestamp())))")
        .bind(user).bind(role).fetch_one(&state.db).await?;
    if eligible {
        Ok(())
    } else {
        Err(AppError::Forbidden(
            "An active assignment or valid work-email invitation is required".into(),
        ))
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Invitation {
    pub email: String,
    pub full_name: String,
    pub role: String,
    pub reason: String,
}

fn reason(value: &str) -> Result<&str, AppError> {
    let value = value.trim();
    if !(10..=500).contains(&value.chars().count()) {
        return Err(AppError::BadRequest(
            "Provide a reason of 10 to 500 characters".into(),
        ));
    }
    Ok(value)
}

pub async fn audit(
    tx: &mut Transaction<'_, Postgres>,
    actor: &AuthUser,
    plant: Uuid,
    staff: Uuid,
    action: &str,
    previous: Option<&str>,
    why: &str,
) -> Result<(), AppError> {
    sqlx::query("INSERT INTO plant_staff_lifecycle_audit(assignment_id,plant_id,staff_user_id,actor_user_id,actor_role,role,action,old_status,new_status,reason)
        SELECT assignment_id,plant_id,user_id,$3,$4,role,$5,$6,employment_status,$7 FROM plant_staff WHERE plant_id=$1 AND user_id=$2")
        .bind(plant).bind(staff).bind(actor.user_id).bind(&actor.role).bind(action).bind(previous).bind(why)
        .execute(&mut **tx).await?;
    Ok(())
}

pub async fn revoke_in_tx(
    tx: &mut Transaction<'_, Postgres>,
    user: Uuid,
    actor: Uuid,
) -> Result<(), AppError> {
    sqlx::query("UPDATE users SET active_session_jti=NULL,auth_revoked_at=clock_timestamp(),updated_at=NOW() WHERE id=$1")
        .bind(user).execute(&mut **tx).await?;
    sqlx::query("DELETE FROM account_refresh_tokens WHERE user_id=$1")
        .bind(user)
        .execute(&mut **tx)
        .await?;
    sqlx::query("UPDATE staff_mfa_challenges SET consumed_at=clock_timestamp() WHERE user_id=$1 AND consumed_at IS NULL")
        .bind(user).execute(&mut **tx).await?;
    sqlx::query("UPDATE plant_staff_manager_delegations SET revoked_at=clock_timestamp(),revoked_by=$2 WHERE user_id=$1 AND revoked_at IS NULL")
        .bind(user).bind(actor).execute(&mut **tx).await?;
    Ok(())
}

pub async fn invite(
    State(state): State<AppState>,
    actor: AuthUser,
    Path(plant): Path<Uuid>,
    Json(body): Json<Invitation>,
) -> Result<Json<Value>, AppError> {
    super::plant_staff_manager::require_manager_or_owner(&state, &actor, plant).await?;
    let why = reason(&body.reason)?;
    let email = body.email.trim().to_ascii_lowercase();
    if email.len() > 254
        || !email.contains('@')
        || email.split('@').count() != 2
        || email.contains(char::is_whitespace)
        || body.full_name.trim().is_empty()
        || body.full_name.len() > 120
        || !ROLES.contains(&body.role.as_str())
    {
        return Err(AppError::BadRequest(
            "Enter a valid work email, name and existing staff role".into(),
        ));
    }
    let mut tx = state.db.begin().await?;
    // Serialize same-email registration, including case variants. The unique
    // registered-email index also protects independent registration paths.
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(&email)
        .execute(&mut *tx)
        .await?;
    let found: Option<(Uuid, String, bool)> = sqlx::query_as(
        "SELECT id,role,is_active FROM users WHERE lower(btrim(email))=$1 FOR UPDATE",
    )
    .bind(&email)
    .fetch_optional(&mut *tx)
    .await?;
    let staff=match found {
        Some((id,role,true)) if role==body.role && id!=actor.user_id => id,
        Some(_) => return Err(AppError::Conflict("Email belongs to an incompatible or inactive identity".into())),
        None => sqlx::query_scalar("INSERT INTO users(phone,email,hashed_password,full_name,role) VALUES($1,$2,'!email-otp-mfa-only',$3,$4) RETURNING id")
            .bind(format!("s-{}",&Uuid::new_v4().simple().to_string()[..18])).bind(&email).bind(body.full_name.trim()).bind(&body.role).fetch_one(&mut *tx).await?,
    };
    let occupied: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM plant_staff WHERE user_id=$1 AND removed_at IS NULL)",
    )
    .bind(staff)
    .fetch_one(&mut *tx)
    .await?;
    if occupied {
        return Err(AppError::Conflict(
            "Employee already has a reserved assignment".into(),
        ));
    }
    super::plant_staff_manager::lock_authorization(&mut tx, &actor, plant, "staff").await?;
    let expires = Utc::now() + Duration::days(7);
    sqlx::query("INSERT INTO plant_staff(plant_id,user_id,role,is_active,employment_status,invitation_expires_at,status_reason)
        VALUES($1,$2,$3,FALSE,'PENDING',$4,$5) ON CONFLICT(plant_id,user_id) DO UPDATE SET
        assignment_id=uuid_generate_v4(),role=EXCLUDED.role,is_active=FALSE,removed_at=NULL,removed_by=NULL,
        employment_status='PENDING',invitation_expires_at=$4,status_reason=$5")
        .bind(plant).bind(staff).bind(&body.role).bind(expires).bind(why).execute(&mut *tx).await.map_err(slot_error)?;
    // Rehire never restores old permissions, delegations or credentials.
    revoke_in_tx(&mut tx, staff, actor.user_id).await?;
    sqlx::query("DELETE FROM plant_staff_module_permissions WHERE plant_id=$1 AND user_id=$2")
        .bind(plant)
        .bind(staff)
        .execute(&mut *tx)
        .await?;
    audit(&mut tx, &actor, plant, staff, "INVITED", None, why).await?;
    tx.commit().await?;
    Ok(Json(
        json!({"success":true,"staff_user_id":staff,"status":"PENDING","expires_at":expires,
        "message":"Work email registered. Employee must verify email and complete authenticator MFA before activation."}),
    ))
}

pub fn slot_error(err: sqlx::Error) -> AppError {
    if err.as_database_error().and_then(|e| e.constraint()) == Some("ux_plant_staff_reserved_role")
    {
        AppError::Conflict(
            "Job role occupied. Explicitly release the existing assignment first.".into(),
        )
    } else {
        AppError::DatabaseError(err)
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Transition {
    pub action: String,
    pub reason: String,
}

pub async fn transition(
    State(state): State<AppState>,
    actor: AuthUser,
    Path((plant, staff)): Path<(Uuid, Uuid)>,
    Json(body): Json<Transition>,
) -> Result<Json<Value>, AppError> {
    apply(
        &state,
        &actor,
        plant,
        staff,
        &body.action,
        reason(&body.reason)?,
    )
    .await?;
    Ok(Json(json!({"success":true})))
}

pub async fn apply(
    state: &AppState,
    actor: &AuthUser,
    plant: Uuid,
    staff: Uuid,
    action: &str,
    why: &str,
) -> Result<(), AppError> {
    super::plant_staff_manager::require_manage_target(state, actor, plant, staff).await?;
    let mut tx = state.db.begin().await?;
    // Identity first, matching session issuance/rotation lock order.
    sqlx::query("SELECT id FROM users WHERE id=$1 FOR UPDATE")
        .bind(staff)
        .execute(&mut *tx)
        .await?;
    super::plant_staff_manager::lock_authorization(&mut tx, actor, plant, "staff").await?;
    let old: Option<(String,bool)>=sqlx::query_as("SELECT employment_status,removed_at IS NULL FROM plant_staff WHERE plant_id=$1 AND user_id=$2 FOR UPDATE")
        .bind(plant).bind(staff).fetch_optional(&mut *tx).await?;
    let (old, reserved) =
        old.ok_or_else(|| AppError::NotFound("Staff assignment not found".into()))?;
    let next = match (action, old.as_str(), reserved) {
        ("suspend", "ACTIVE", true) => "SUSPENDED",
        ("reactivate", "SUSPENDED", true) => "ACTIVE",
        ("terminate", "ACTIVE" | "SUSPENDED", true) => "TERMINATED",
        ("remove", _, true) => "REMOVED",
        ("cancel", "PENDING", true) => "CANCELLED",
        ("expire", "PENDING", true) => {
            let expired:bool=sqlx::query_scalar("SELECT invitation_expires_at<=clock_timestamp() FROM plant_staff WHERE plant_id=$1 AND user_id=$2")
                .bind(plant).bind(staff).fetch_one(&mut *tx).await?;
            if !expired {
                return Err(AppError::Conflict("Invitation has not expired".into()));
            }
            "EXPIRED"
        }
        _ => {
            return Err(AppError::Conflict(
                "Invalid employee lifecycle transition".into(),
            ))
        }
    };
    let released = matches!(next, "TERMINATED" | "REMOVED" | "CANCELLED" | "EXPIRED");
    sqlx::query("UPDATE plant_staff SET employment_status=$3,is_active=($3='ACTIVE'),status_reason=$4,
        removed_at=CASE WHEN $5 THEN clock_timestamp() ELSE NULL END,removed_by=CASE WHEN $5 THEN $6 ELSE NULL END
        WHERE plant_id=$1 AND user_id=$2")
        .bind(plant).bind(staff).bind(next).bind(why).bind(released).bind(actor.user_id).execute(&mut *tx).await?;
    if next != "ACTIVE" {
        revoke_in_tx(&mut tx, staff, actor.user_id).await?;
    }
    if released {
        sqlx::query("DELETE FROM plant_staff_module_permissions WHERE plant_id=$1 AND user_id=$2")
            .bind(plant)
            .bind(staff)
            .execute(&mut *tx)
            .await?;
    }
    audit(&mut tx, actor, plant, staff, action, Some(&old), why).await?;
    let legacy_action = match action {
        "suspend" => "SUSPENDED",
        "reactivate" => "REACTIVATED",
        _ => "REMOVED",
    };
    sqlx::query(
        "INSERT INTO plant_staff_role_slot_audit(plant_id,staff_user_id,actor_user_id,role,action)
        SELECT plant_id,user_id,$3,role,$4 FROM plant_staff WHERE plant_id=$1 AND user_id=$2",
    )
    .bind(plant)
    .bind(staff)
    .bind(actor.user_id)
    .bind(legacy_action)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}

pub async fn history(
    State(state): State<AppState>,
    actor: AuthUser,
    Path(plant): Path<Uuid>,
) -> Result<Json<Value>, AppError> {
    super::plant_staff_manager::require_manager_or_owner(&state, &actor, plant).await?;
    let events:Vec<Value>=sqlx::query_scalar("SELECT to_jsonb(a) FROM plant_staff_lifecycle_audit a WHERE plant_id=$1 ORDER BY id DESC LIMIT 500")
        .bind(plant).fetch_all(&state.db).await?;
    let slots:Vec<Value>=sqlx::query_scalar("SELECT jsonb_build_object('role',r.role,'user_id',ps.user_id,'status',COALESCE(ps.employment_status,'VACANT'),'email',u.email,'name',u.full_name,'assignment_id',ps.assignment_id,'invitation_expires_at',ps.invitation_expires_at)
        FROM unnest($2::text[]) AS r(role) LEFT JOIN plant_staff ps ON ps.plant_id=$1 AND ps.role=r.role AND ps.removed_at IS NULL
        LEFT JOIN users u ON u.id=ps.user_id ORDER BY r.role")
        .bind(plant).bind(ROLES).fetch_all(&state.db).await?;
    let legacy_events:Vec<Value>=sqlx::query_scalar("SELECT to_jsonb(a) FROM plant_staff_role_slot_audit a WHERE plant_id=$1 ORDER BY id DESC LIMIT 500")
        .bind(plant).fetch_all(&state.db).await?;
    Ok(Json(
        json!({"events":events,"slots":slots,"legacy_events":legacy_events}),
    ))
}
