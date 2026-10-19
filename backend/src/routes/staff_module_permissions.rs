//! Plant-scoped Dispatcher module delegation. Navigation is not authorization.
use crate::{auth::AuthUser, error::AppError, state::AppState};
use axum::{
    extract::{Path, State},
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{PgPool, Row};
use uuid::Uuid;

pub const KEYS: [&str; 6] = [
    "dispatch_queue",
    "fleet_availability",
    "challan_gate_pass",
    "material_inventory",
    "billing_ledger",
    "payroll",
];
const LABELS: [&str; 6] = [
    "Dispatch Queue",
    "Fleet Availability",
    "Challan & Gate Pass",
    "Material Inventory",
    "Billing & Ledger",
    "Payroll",
];

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Grant {
    pub view: bool,
    pub edit: bool,
    pub approve: bool,
}
impl Grant {
    const fn new(view: bool, edit: bool, approve: bool) -> Self {
        Self {
            view,
            edit,
            approve,
        }
    }
    fn valid(self) -> bool {
        (!self.edit || self.view) && (!self.approve || self.view)
    }
    fn within(self, ceiling: Self) -> bool {
        self.valid()
            && (!self.view || ceiling.view)
            && (!self.edit || ceiling.edit)
            && (!self.approve || ceiling.approve)
    }
    fn intersect(self, ceiling: Self) -> Self {
        Self::new(
            self.view && ceiling.view,
            self.view && self.edit && ceiling.edit,
            self.view && self.approve && ceiling.approve,
        )
    }
}
#[derive(Clone, Copy)]
pub enum Action {
    View,
    Edit,
    Approve,
}
impl Grant {
    fn permits(self, action: Action) -> bool {
        match action {
            Action::View => self.view,
            Action::Edit => self.edit,
            Action::Approve => self.approve,
        }
    }
}
pub fn dispatcher_ceiling(key: &str) -> Option<Grant> {
    match key {
        "dispatch_queue" | "fleet_availability" | "challan_gate_pass" => {
            Some(Grant::new(true, true, false))
        }
        "material_inventory" => Some(Grant::new(true, false, false)),
        "billing_ledger" | "payroll" => Some(Grant::new(false, false, false)),
        _ => None,
    }
}
#[derive(Serialize)]
pub struct ModuleGrant {
    key: &'static str,
    label: &'static str,
    #[serde(flatten)]
    effective: Grant,
    ceiling: Grant,
    overridden: bool,
}
#[derive(Deserialize)]
pub struct GrantEdit {
    pub key: String,
    pub view: bool,
    pub edit: bool,
    pub approve: bool,
}
#[derive(Deserialize)]
pub struct ReplaceGrants {
    pub permissions: Vec<GrantEdit>,
}

async fn owned_plant(state: &AppState, owner: &AuthUser, plant_id: Uuid) -> Result<(), AppError> {
    if !matches!(owner.role.as_str(), "owner" | "plant_owner") {
        return Err(AppError::Forbidden(
            "Only the Plant Owner can manage staff access".into(),
        ));
    }
    let ok: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM rmc_plants WHERE id=$1 AND owner_id=$2 AND is_active=TRUE)",
    )
    .bind(plant_id)
    .bind(owner.user_id)
    .fetch_one(&state.db)
    .await?;
    if !ok {
        return Err(AppError::Forbidden(
            "Not the owner of this active plant".into(),
        ));
    }
    Ok(())
}
async fn dispatcher_assigned(db: &PgPool, plant: Uuid, user: Uuid) -> Result<(), AppError> {
    let ok: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM plant_staff ps JOIN users u ON u.id=ps.user_id \
        WHERE ps.plant_id=$1 AND ps.user_id=$2 AND ps.is_active=TRUE \
        AND u.is_active=TRUE AND ps.role='dispatcher' AND u.role='dispatcher')",
    )
    .bind(plant)
    .bind(user)
    .fetch_one(db)
    .await?;
    if !ok {
        return Err(AppError::Forbidden(
            "Active Dispatcher assignment required".into(),
        ));
    }
    Ok(())
}
async fn resolved(db: &PgPool, plant: Uuid, user: Uuid) -> Result<Vec<ModuleGrant>, AppError> {
    dispatcher_assigned(db, plant, user).await?;
    let rows = sqlx::query(
        "SELECT module_key,can_view,can_edit,can_approve FROM plant_staff_module_permissions \
         WHERE plant_id=$1 AND user_id=$2",
    )
    .bind(plant)
    .bind(user)
    .fetch_all(db)
    .await?;
    let mut result = Vec::with_capacity(KEYS.len());
    for (i, key) in KEYS.iter().enumerate() {
        let ceiling = dispatcher_ceiling(key).expect("registered key");
        let override_row = rows
            .iter()
            .find(|r| r.get::<String, _>("module_key") == *key);
        let override_grant = override_row
            .map(|r| Grant::new(r.get("can_view"), r.get("can_edit"), r.get("can_approve")));
        result.push(ModuleGrant {
            key,
            label: LABELS[i],
            effective: override_grant.unwrap_or(ceiling).intersect(ceiling),
            ceiling,
            overridden: override_row.is_some(),
        });
    }
    Ok(result)
}

/// To retain existing role gates, call *after* check_role and plant/order scope checks.
/// For other roles this helper never adds authority; it only restricts Dispatchers.
pub async fn require(
    state: &AppState,
    user: &AuthUser,
    plant: Uuid,
    module: &str,
    action: Action,
) -> Result<(), AppError> {
    if user.role != "dispatcher" {
        return Ok(());
    }
    let ceiling = dispatcher_ceiling(module)
        .ok_or_else(|| AppError::Forbidden("Unknown module permission".into()))?;
    dispatcher_assigned(&state.db, plant, user.user_id).await?;
    let row: Option<(bool, bool, bool)> = sqlx::query_as(
        "SELECT can_view,can_edit,can_approve FROM plant_staff_module_permissions \
         WHERE plant_id=$1 AND user_id=$2 AND module_key=$3",
    )
    .bind(plant)
    .bind(user.user_id)
    .bind(module)
    .fetch_optional(&state.db)
    .await?;
    let grant = row
        .map(|(v, e, a)| Grant::new(v, e, a))
        .unwrap_or(ceiling)
        .intersect(ceiling);
    if !grant.permits(action) {
        return Err(AppError::Forbidden(
            "This staff module permission is disabled".into(),
        ));
    }
    Ok(())
}
pub async fn require_order(
    state: &AppState,
    user: &AuthUser,
    order_id: Uuid,
    module: &str,
    action: Action,
) -> Result<(), AppError> {
    if user.role != "dispatcher" {
        return Ok(());
    }
    let plant: Uuid = sqlx::query_scalar("SELECT plant_id FROM orders WHERE id=$1")
        .bind(order_id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("Order not found".into()))?;
    require(state, user, plant, module, action).await
}
pub async fn require_load(
    state: &AppState,
    user: &AuthUser,
    load_id: Uuid,
    module: &str,
    action: Action,
) -> Result<(), AppError> {
    if user.role != "dispatcher" {
        return Ok(());
    }
    let plant: Uuid = sqlx::query_scalar(
        "SELECT o.plant_id FROM order_loads l JOIN orders o ON o.id=l.order_id WHERE l.id=$1",
    )
    .bind(load_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Load not found".into()))?;
    require(state, user, plant, module, action).await
}
pub async fn get_mine(
    State(state): State<AppState>,
    user: AuthUser,
) -> Result<Json<Value>, AppError> {
    if user.role != "dispatcher" {
        return Err(AppError::Forbidden(
            "Dispatcher-only permission endpoint".into(),
        ));
    }
    let plants: Vec<Uuid> = sqlx::query_scalar(
        "SELECT ps.plant_id FROM plant_staff ps JOIN rmc_plants p ON p.id=ps.plant_id \
        WHERE ps.user_id=$1 AND ps.is_active=TRUE AND ps.role='dispatcher' AND p.is_active=TRUE ORDER BY ps.plant_id LIMIT 2"
    ).bind(user.user_id).fetch_all(&state.db).await?;
    if plants.len() != 1 {
        return Err(AppError::Forbidden(
            "Exactly one active Dispatcher plant assignment is required".into(),
        ));
    }
    Ok(Json(
        json!({"plant_id":plants[0],"permissions":resolved(&state.db,plants[0],user.user_id).await?}),
    ))
}
pub async fn get_staff(
    State(state): State<AppState>,
    owner: AuthUser,
    Path((plant, staff)): Path<(Uuid, Uuid)>,
) -> Result<Json<Value>, AppError> {
    owned_plant(&state, &owner, plant).await?;
    let permissions = resolved(&state.db, plant, staff).await?;
    Ok(Json(
        json!({"plant_id":plant,"staff_user_id":staff,"permissions":permissions}),
    ))
}
pub async fn replace_staff(
    State(state): State<AppState>,
    owner: AuthUser,
    Path((plant, staff)): Path<(Uuid, Uuid)>,
    Json(request): Json<ReplaceGrants>,
) -> Result<Json<Value>, AppError> {
    owned_plant(&state, &owner, plant).await?;
    if request.permissions.len() != KEYS.len() {
        return Err(AppError::BadRequest(
            "Submit each of the six permissions exactly once".into(),
        ));
    }
    let mut seen = std::collections::HashSet::new();
    for edit in &request.permissions {
        let ceiling = dispatcher_ceiling(&edit.key)
            .ok_or_else(|| AppError::BadRequest("Unknown module key".into()))?;
        let grant = Grant::new(edit.view, edit.edit, edit.approve);
        if !seen.insert(edit.key.as_str()) || !grant.within(ceiling) {
            return Err(AppError::BadRequest(
                "Duplicate or excessive module grant".into(),
            ));
        }
    }
    let mut tx = state.db.begin().await?;
    // Lock assignment so suspension cannot race with privilege writes.
    let active: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM plant_staff ps JOIN users u ON u.id=ps.user_id \
         WHERE ps.plant_id=$1 AND ps.user_id=$2 AND ps.role='dispatcher' \
         AND u.role='dispatcher' AND ps.is_active=TRUE AND u.is_active=TRUE)",
    )
    .bind(plant)
    .bind(staff)
    .fetch_one(&mut *tx)
    .await?;
    if !active {
        return Err(AppError::Forbidden(
            "Inactive or non-Dispatcher assignment".into(),
        ));
    }
    // The previous existence query does not lock; lock the precise row for this transaction.
    sqlx::query("SELECT id FROM plant_staff WHERE plant_id=$1 AND user_id=$2 FOR UPDATE")
        .bind(plant)
        .bind(staff)
        .fetch_one(&mut *tx)
        .await?;
    for edit in &request.permissions {
        let old: Option<(bool, bool, bool)> = sqlx::query_as(
            "SELECT can_view,can_edit,can_approve FROM plant_staff_module_permissions \
             WHERE plant_id=$1 AND user_id=$2 AND module_key=$3 FOR UPDATE",
        )
        .bind(plant)
        .bind(staff)
        .bind(&edit.key)
        .fetch_optional(&mut *tx)
        .await?;
        let next = Grant::new(edit.view, edit.edit, edit.approve);
        if old.map(|(v, e, a)| Grant::new(v, e, a)) == Some(next) {
            continue;
        }
        sqlx::query(
            "INSERT INTO plant_staff_module_permissions \
             (plant_id,user_id,module_key,can_view,can_edit,can_approve,updated_by) \
             VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (plant_id,user_id,module_key) \
             DO UPDATE SET can_view=EXCLUDED.can_view,can_edit=EXCLUDED.can_edit, \
             can_approve=EXCLUDED.can_approve,updated_by=EXCLUDED.updated_by,updated_at=NOW()",
        )
        .bind(plant)
        .bind(staff)
        .bind(&edit.key)
        .bind(edit.view)
        .bind(edit.edit)
        .bind(edit.approve)
        .bind(owner.user_id)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "INSERT INTO plant_staff_module_permission_audit \
             (plant_id,staff_user_id,actor_user_id,module_key,old_grant,new_grant) \
             VALUES ($1,$2,$3,$4,$5,$6)",
        )
        .bind(plant)
        .bind(staff)
        .bind(owner.user_id)
        .bind(&edit.key)
        .bind(old.map(|(v, e, a)| sqlx::types::Json(json!({"view":v,"edit":e,"approve":a}))))
        .bind(sqlx::types::Json(json!(next)))
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(Json(
        json!({"plant_id":plant,"staff_user_id":staff,"permissions":resolved(&state.db,plant,staff).await?}),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn dispatcher_configuration_has_no_finance_or_approval_grants() {
        assert_eq!(KEYS.len(), 6);
        assert_eq!(
            dispatcher_ceiling("dispatch_queue"),
            Some(Grant::new(true, true, false))
        );
        assert_eq!(
            dispatcher_ceiling("fleet_availability"),
            Some(Grant::new(true, true, false))
        );
        assert_eq!(
            dispatcher_ceiling("challan_gate_pass"),
            Some(Grant::new(true, true, false))
        );
        assert_eq!(
            dispatcher_ceiling("material_inventory"),
            Some(Grant::new(true, false, false))
        );
        for key in ["billing_ledger", "payroll"] {
            assert_eq!(
                dispatcher_ceiling(key),
                Some(Grant::new(false, false, false))
            );
        }
    }
    #[test]
    fn escalation_and_inconsistent_grants_fail_closed() {
        let ceiling = dispatcher_ceiling("material_inventory").unwrap();
        assert!(!Grant::new(true, true, false).within(ceiling));
        assert!(!Grant::new(false, true, false).valid());
        assert!(!Grant::new(true, false, true).within(ceiling));
        assert!(!Grant::new(true, false, false).within(dispatcher_ceiling("payroll").unwrap()));
        assert_eq!(
            Grant::new(true, true, true).intersect(ceiling),
            Grant::new(true, false, false)
        );
        assert!(dispatcher_ceiling("unknown").is_none());
    }
}
