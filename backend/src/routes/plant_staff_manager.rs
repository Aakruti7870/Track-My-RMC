//! An Owner may delegate day-to-day staff management to one active staff member
//! per plant. A delegation never creates a login role or bypasses job-role ceilings.
use crate::{auth::{middleware::check_role, AuthUser}, error::AppError, state::AppState};
use axum::{extract::{Path, State}, Json};
use serde_json::{json, Value};
use sqlx::Row;
use uuid::Uuid;

const STAFF_ROLES: &[&str] = &[
    "dispatcher", "operator", "supervisor", "accountant",
    "quality_engineer", "fleet_manager", "store_manager",
];

fn is_owner(user: &AuthUser) -> bool {
    matches!(user.role.as_str(), "owner" | "plant_owner")
}

pub async fn require_owner(state: &AppState, user: &AuthUser, plant: Uuid) -> Result<(), AppError> {
    check_role(user, &["owner", "plant_owner"])?;
    let owned: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM rmc_plants WHERE id=$1 AND owner_id=$2 AND is_active=TRUE)",
    ).bind(plant).bind(user.user_id).fetch_one(&state.db).await?;
    if !owned {
        return Err(AppError::Forbidden("This plant is not owned by your account".into()));
    }
    Ok(())
}

async fn authorized_manager(state: &AppState, user: &AuthUser, plant: Uuid) -> Result<bool, AppError> {
    if !STAFF_ROLES.contains(&user.role.as_str()) {
        return Ok(false);
    }
    // Both the global job role and live plant assignment must match the delegation.
    let permitted: bool = sqlx::query_scalar(
        "SELECT EXISTS(
          SELECT 1 FROM plant_staff_manager_delegations d
          JOIN plant_staff ps ON ps.plant_id=d.plant_id AND ps.user_id=d.user_id
          JOIN users u ON u.id=ps.user_id
          JOIN rmc_plants p ON p.id=ps.plant_id
          WHERE d.plant_id=$1 AND d.user_id=$2 AND d.revoked_at IS NULL
            AND ps.is_active=TRUE AND ps.removed_at IS NULL
            AND ps.role=$3 AND u.role=$3 AND u.is_active=TRUE AND p.is_active=TRUE
        )",
    ).bind(plant).bind(user.user_id).bind(&user.role)
     .fetch_one(&state.db).await?;
    Ok(permitted)
}

pub async fn require_manager_or_owner(
    state: &AppState, user: &AuthUser, plant: Uuid,
) -> Result<(), AppError> {
    if is_owner(user) {
        return require_owner(state, user, plant).await;
    }
    if authorized_manager(state, user, plant).await? {
        return Ok(());
    }
    Err(AppError::Forbidden("Plant Owner or delegated Plant Manager access required".into()))
}

pub async fn require_manage_target(
    state: &AppState, actor: &AuthUser, plant: Uuid, target: Uuid,
) -> Result<(), AppError> {
    require_manager_or_owner(state, actor, plant).await?;
    if actor.user_id == target {
        return Err(AppError::Forbidden("You cannot manage your own staff assignment".into()));
    }
    if is_owner(actor) {
        return Ok(());
    }
    // Delegates cannot remove another manager or any privileged/non-staff identity.
    let row: Option<(String, bool)> = sqlx::query_as(
        "SELECT ps.role, EXISTS(
            SELECT 1 FROM plant_staff_manager_delegations d
            WHERE d.plant_id=ps.plant_id AND d.user_id=ps.user_id AND d.revoked_at IS NULL
         ) FROM plant_staff ps
         WHERE ps.plant_id=$1 AND ps.user_id=$2 AND ps.removed_at IS NULL",
    ).bind(plant).bind(target).fetch_optional(&state.db).await?;
    match row {
        Some((role, false)) if STAFF_ROLES.contains(&role.as_str()) => Ok(()),
        _ => Err(AppError::Forbidden("Only the owner may manage another manager or a privileged identity".into())),
    }
}

pub async fn get_my_access(
    State(state): State<AppState>, user: AuthUser,
) -> Result<Json<Value>, AppError> {
    if !STAFF_ROLES.contains(&user.role.as_str()) {
        return Ok(Json(json!({"enabled":false})));
    }
    let plants: Vec<Uuid> = sqlx::query_scalar(
        "SELECT ps.plant_id FROM plant_staff ps
         JOIN rmc_plants p ON p.id=ps.plant_id
         WHERE ps.user_id=$1 AND ps.role=$2 AND ps.is_active=TRUE
           AND ps.removed_at IS NULL AND p.is_active=TRUE LIMIT 2",
    ).bind(user.user_id).bind(&user.role).fetch_all(&state.db).await?;
    if plants.len()!=1 {
        return Ok(Json(json!({"enabled":false})));
    }
    let enabled=authorized_manager(&state,&user,plants[0]).await?;
    Ok(Json(json!({"enabled":enabled,"plant_id":if enabled {Some(plants[0])} else {None}})))
}

pub async fn grant(
    State(state): State<AppState>, owner: AuthUser, Path((plant, staff)): Path<(Uuid, Uuid)>,
) -> Result<Json<Value>, AppError> {
    require_owner(&state,&owner,plant).await?;
    let mut tx=state.db.begin().await?;
    let role: Option<String> = sqlx::query_scalar(
        "SELECT ps.role FROM plant_staff ps JOIN users u ON u.id=ps.user_id
         WHERE ps.plant_id=$1 AND ps.user_id=$2 AND ps.is_active=TRUE
           AND ps.removed_at IS NULL AND u.is_active=TRUE AND u.role=ps.role
           AND u.email IS NOT NULL FOR UPDATE OF ps",
    ).bind(plant).bind(staff).fetch_optional(&mut *tx).await?;
    if !role.as_deref().is_some_and(|r| STAFF_ROLES.contains(&r)) {
        return Err(AppError::Forbidden("Delegate must have an active approved staff assignment".into()));
    }
    let already_active: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM plant_staff_manager_delegations
         WHERE plant_id=$1 AND revoked_at IS NULL)",
    ).bind(plant).fetch_one(&mut *tx).await?;
    if already_active {
        return Err(AppError::Conflict("This plant already has an active delegated manager".into()));
    }
    sqlx::query(
        "INSERT INTO plant_staff_manager_delegations(plant_id,user_id,granted_by)
         VALUES($1,$2,$3)
         ON CONFLICT(plant_id,user_id) DO UPDATE SET granted_by=EXCLUDED.granted_by,
           granted_at=clock_timestamp(),revoked_at=NULL,revoked_by=NULL",
    ).bind(plant).bind(staff).bind(owner.user_id).execute(&mut *tx)
     .await.map_err(|err| {
        if err.as_database_error().and_then(|e|e.constraint())==Some("ux_plant_one_active_manager") {
            AppError::Conflict("This plant already has an active delegated manager".into())
        } else { AppError::DatabaseError(err) }
     })?;
    sqlx::query(
        "INSERT INTO audit_logs(user_id,action,resource_type,resource_id,metadata)
         VALUES($1,'plant_manager.grant','plant_staff',$2,$3)",
    ).bind(owner.user_id).bind(staff).bind(json!({"plant_id":plant,"role":role}))
     .execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(json!({"success":true,"message":"Plant Manager delegation granted"})))
}

pub async fn revoke(
    State(state): State<AppState>, owner: AuthUser, Path((plant, staff)): Path<(Uuid, Uuid)>,
) -> Result<Json<Value>, AppError> {
    require_owner(&state,&owner,plant).await?;
    let mut tx=state.db.begin().await?;
    let n=sqlx::query(
        "UPDATE plant_staff_manager_delegations SET revoked_at=clock_timestamp(),revoked_by=$3
         WHERE plant_id=$1 AND user_id=$2 AND revoked_at IS NULL",
    ).bind(plant).bind(staff).bind(owner.user_id).execute(&mut *tx).await?;
    if n.rows_affected()!=1 {
        return Err(AppError::Conflict("Active manager delegation not found".into()));
    }
    sqlx::query(
        "INSERT INTO audit_logs(user_id,action,resource_type,resource_id,metadata)
         VALUES($1,'plant_manager.revoke','plant_staff',$2,$3)",
    ).bind(owner.user_id).bind(staff).bind(json!({"plant_id":plant}))
     .execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(json!({"success":true,"message":"Plant Manager delegation revoked"})))
}
