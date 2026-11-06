//! Owner access changes require a dedicated, approved Control Center session.
use crate::{auth::control_center::WebAdmin, error::AppError, state::AppState};
use axum::{
    extract::{Path, State},
    http::HeaderMap,
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OwnerStatus {
    pub active: bool,
    pub reason: String,
}
pub async fn status(
    State(state): State<AppState>,
    admin: WebAdmin,
    Path(owner): Path<Uuid>,
    headers: HeaderMap,
    Json(body): Json<OwnerStatus>,
) -> Result<Json<Value>, AppError> {
    admin.require("plant_owners.manage")?;
    super::control_center_routes::require_recent_step_up(&state, &admin, &headers).await?;
    if !(10..=500).contains(&body.reason.trim().len()) {
        return Err(AppError::BadRequest(
            "Provide a reason of 10 to 500 characters".into(),
        ));
    }
    let mut tx = state.db.begin().await?;
    let changed = sqlx::query(
        "UPDATE users SET is_active=$2 WHERE id=$1 AND role IN ('owner','plant_owner')",
    )
    .bind(owner)
    .bind(body.active)
    .execute(&mut *tx)
    .await?;
    if changed.rows_affected() != 1 {
        return Err(AppError::NotFound("Plant Owner identity not found".into()));
    }
    super::staff_lifecycle::revoke_in_tx(&mut tx, owner, admin.user_id).await?;
    let managers:Vec<Uuid>=sqlx::query_scalar("SELECT d.user_id FROM plant_staff_manager_delegations d JOIN rmc_plants p ON p.id=d.plant_id WHERE p.owner_id=$1 AND d.revoked_at IS NULL ORDER BY d.user_id")
        .bind(owner).fetch_all(&mut *tx).await?;
    for manager in managers {
        super::staff_lifecycle::revoke_in_tx(&mut tx, manager, admin.user_id).await?;
    }
    sqlx::query("UPDATE plant_staff_manager_delegations SET revoked_at=clock_timestamp(),revoked_by=$2 WHERE plant_id IN (SELECT id FROM rmc_plants WHERE owner_id=$1) AND revoked_at IS NULL")
        .bind(owner).bind(admin.user_id).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO audit_logs(user_id,action,resource_type,resource_id,metadata) VALUES($1,'plant_owner.status','user',$2,$3)")
        .bind(admin.user_id).bind(owner).bind(json!({"active":body.active,"reason":body.reason,"actor_role":admin.role})).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(json!({"success":true,"active":body.active})))
}
