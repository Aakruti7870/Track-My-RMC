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

pub(crate) async fn ensure_plant_staff_or_owner(
    state: &AppState,
    auth_user: &AuthUser,
    plant_id: Uuid,
) -> Result<(), AppError> {
    if auth_user.role == "owner" || auth_user.role == "plant_owner" {
        let is_owner: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM rmc_plants WHERE id = $1 AND owner_id = $2)",
        )
        .bind(plant_id)
        .bind(auth_user.user_id)
        .fetch_one(&state.db)
        .await?;
        if is_owner {
            return Ok(());
        }
    }
    let is_staff: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM plant_staff WHERE plant_id = $1 AND user_id = $2 AND is_active = TRUE)",
    )
    .bind(plant_id)
    .bind(auth_user.user_id)
    .fetch_one(&state.db)
    .await?;
    if !is_staff {
        return Err(AppError::Forbidden(
            "You are not authorized for this plant".to_string(),
        ));
    }
    Ok(())
}

#[derive(Debug, Deserialize, Serialize)]
pub struct CreateMaterialPayload {
    pub name: String,
    pub material_type: String,
    pub unit: Option<String>,
    pub current_stock: Option<f64>,
    pub minimum_stock: Option<f64>,
}

pub async fn list_materials(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(plant_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    ensure_plant_staff_or_owner(&state, &auth_user, plant_id).await?;
    super::staff_module_permissions::require(
        &state,
        &auth_user,
        plant_id,
        "material_inventory",
        super::staff_module_permissions::Action::View,
    )
    .await?;

    let rows = sqlx::query(
        "SELECT id, name, material_type, unit, current_stock, minimum_stock FROM plant_materials WHERE plant_id = $1 ORDER BY name",
    )
    .bind(plant_id)
    .fetch_all(&state.db)
    .await?;

    let materials: Vec<_> = rows
        .into_iter()
        .map(|r| {
            let id: Uuid = r.get("id");
            let name: String = r.get("name");
            let material_type: String = r.get("material_type");
            let unit: String = r.get("unit");
            let current_stock: bigdecimal::BigDecimal = r.get("current_stock");
            let minimum_stock: bigdecimal::BigDecimal = r.get("minimum_stock");
            json!({
                "id": id,
                "name": name,
                "material_type": material_type,
                "unit": unit,
                "current_stock": current_stock,
                "minimum_stock": minimum_stock
            })
        })
        .collect();

    Ok(Json(json!({ "success": true, "materials": materials })))
}

pub async fn create_material(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(plant_id): Path<Uuid>,
    Json(payload): Json<CreateMaterialPayload>,
) -> Result<impl IntoResponse, AppError> {
    check_role(
        &auth_user,
        &[
            "owner",
            "plant_owner",
            "admin",
            "store_manager",
            "supervisor",
        ],
    )?;
    ensure_plant_staff_or_owner(&state, &auth_user, plant_id).await?;
    super::staff_module_permissions::require(
        &state,
        &auth_user,
        plant_id,
        "material_inventory",
        super::staff_module_permissions::Action::Create,
    )
    .await?;

    let unit = payload.unit.unwrap_or_else(|| "kg".to_string());
    let current = payload.current_stock.unwrap_or(0.0);
    let minimum = payload.minimum_stock.unwrap_or(0.0);

    let id: Uuid = sqlx::query_scalar(
        r#"
        INSERT INTO plant_materials (plant_id, name, material_type, unit, current_stock, minimum_stock)
        VALUES ($1, $2, $3, $4, $5::numeric, $6::numeric)
        RETURNING id
        "#,
    )
    .bind(plant_id)
    .bind(&payload.name)
    .bind(&payload.material_type)
    .bind(&unit)
    .bind(current)
    .bind(minimum)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(
        json!({ "success": true, "id": id, "message": "Material created" }),
    ))
}

#[derive(Debug, Deserialize, Serialize)]
pub struct AdjustMaterialPayload {
    #[serde(alias = "delta")]
    pub quantity_change: f64,
    #[serde(alias = "note")]
    pub reason: String,
}

pub async fn adjust_material_stock(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path((plant_id, material_id)): Path<(Uuid, Uuid)>,
    Json(payload): Json<AdjustMaterialPayload>,
) -> Result<impl IntoResponse, AppError> {
    if !payload.quantity_change.is_finite()
        || payload.quantity_change == 0.0
        || !(10..=500).contains(&payload.reason.trim().len())
    {
        return Err(AppError::BadRequest(
            "Provide a finite stock adjustment and a reason of 10 to 500 characters".into(),
        ));
    }
    if payload.quantity_change < 0.0 && !matches!(auth_user.role.as_str(), "owner" | "plant_owner")
    {
        return Err(AppError::Forbidden(
            "Plant Owner approval is required for manual stock reductions".into(),
        ));
    }
    check_role(
        &auth_user,
        &[
            "owner",
            "plant_owner",
            "admin",
            "store_manager",
            "supervisor",
        ],
    )?;
    ensure_plant_staff_or_owner(&state, &auth_user, plant_id).await?;
    super::staff_module_permissions::require(
        &state,
        &auth_user,
        plant_id,
        "material_inventory",
        super::staff_module_permissions::Action::Edit,
    )
    .await?;

    let mut tx = state.db.begin().await?;

    let changed = sqlx::query(
        r#"
        UPDATE plant_materials
        SET current_stock = current_stock + $1::numeric, updated_at = NOW()
        WHERE id = $2 AND plant_id = $3 AND current_stock + $1::numeric >= 0
        "#,
    )
    .bind(payload.quantity_change)
    .bind(material_id)
    .bind(plant_id)
    .execute(&mut *tx)
    .await?
    .rows_affected();
    if changed != 1 {
        return Err(AppError::Conflict(
            "Material is outside this plant or stock would become negative".into(),
        ));
    }

    sqlx::query(
        r#"
        INSERT INTO plant_material_adjustments (material_id, adjusted_by, quantity_change, reason)
        VALUES ($1, $2, $3::numeric, $4)
        "#,
    )
    .bind(material_id)
    .bind(auth_user.user_id)
    .bind(payload.quantity_change)
    .bind(&payload.reason)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    Ok(Json(
        json!({ "success": true, "message": "Stock adjusted successfully" }),
    ))
}

#[derive(Debug, Deserialize, Serialize)]
pub struct CreateVehiclePayload {
    pub registration_number: String,
    pub capacity_m3: Option<f64>,
    pub driver_id: Option<Uuid>,
}

pub(crate) async fn require_fleet_access(
    state: &AppState,
    user: &AuthUser,
    plant: Uuid,
    action: super::staff_module_permissions::Action,
) -> Result<(), AppError> {
    if super::plant_staff_manager::require_capability(state, user, plant, "fleet")
        .await
        .is_ok()
    {
        return Ok(());
    }
    super::staff_module_permissions::require(state, user, plant, "fleet_availability", action).await
}

pub async fn list_vehicles(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(plant_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    ensure_plant_staff_or_owner(&state, &auth_user, plant_id).await?;
    require_fleet_access(
        &state,
        &auth_user,
        plant_id,
        super::staff_module_permissions::Action::View,
    )
    .await?;

    let rows = sqlx::query(
        r#"
        SELECT m.id, m.registration_number, m.capacity_m3, m.status, m.driver_id,
               u.full_name as driver_name, u.phone as driver_phone
        FROM transit_mixers m
        LEFT JOIN users u ON u.id = m.driver_id
        WHERE m.plant_id = $1
        ORDER BY m.registration_number
        "#,
    )
    .bind(plant_id)
    .fetch_all(&state.db)
    .await?;

    let vehicles: Vec<_> = rows
        .into_iter()
        .map(|r| {
            let id: Uuid = r.get("id");
            let registration_number: String = r.get("registration_number");
            let capacity_m3: bigdecimal::BigDecimal = r.get("capacity_m3");
            let status: String = r.get("status");
            let driver_id: Option<Uuid> = r.get("driver_id");
            let driver_name: Option<String> = r.get("driver_name");
            let driver_phone: Option<String> = r.get("driver_phone");
            json!({
                "id": id,
                "registration_number": registration_number,
                "capacity_m3": capacity_m3,
                "status": status,
                "driver_id": driver_id,
                "driver_name": driver_name,
                "driver_phone": driver_phone
            })
        })
        .collect();

    Ok(Json(json!({ "success": true, "vehicles": vehicles })))
}

pub async fn create_vehicle(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(plant_id): Path<Uuid>,
    Json(payload): Json<CreateVehiclePayload>,
) -> Result<impl IntoResponse, AppError> {
    if auth_user.role == "fleet_manager" {
        super::staff_module_permissions::require(
            &state,
            &auth_user,
            plant_id,
            "fleet_availability",
            super::staff_module_permissions::Action::Create,
        )
        .await?;
    } else {
        super::plant_staff_manager::require_capability(&state, &auth_user, plant_id, "fleet")
            .await?;
    }
    let cap = payload.capacity_m3.unwrap_or(6.0);
    if !cap.is_finite()
        || !(0.5..=20.0).contains(&cap)
        || payload.registration_number.trim().is_empty()
        || payload.registration_number.len() > 30
    {
        return Err(AppError::BadRequest(
            "Enter a valid TM registration and capacity".into(),
        ));
    }
    let mut tx = state.db.begin().await?;
    if auth_user.role != "fleet_manager" {
        super::plant_staff_manager::lock_authorization(&mut tx, &auth_user, plant_id, "fleet")
            .await?;
    }
    if let Some(driver) = payload.driver_id {
        if auth_user.role == "fleet_manager" {
            super::staff_module_permissions::require(
                &state,
                &auth_user,
                plant_id,
                "driver_roster",
                super::staff_module_permissions::Action::Edit,
            )
            .await?;
        } else {
            super::plant_staff_manager::lock_authorization(
                &mut tx, &auth_user, plant_id, "drivers",
            )
            .await?;
        }
        let verified:Option<Uuid>=sqlx::query_scalar("SELECT u.id FROM users u JOIN driver_employment_profiles d ON d.driver_id=u.id WHERE u.id=$1 AND u.role='driver' AND u.is_active AND u.is_verified AND d.plant_id=$2 AND d.is_active FOR SHARE OF u,d")
            .bind(driver).bind(plant_id).fetch_optional(&mut *tx).await?;
        if verified.is_none() {
            return Err(AppError::Forbidden(
                "Driver must be verified and active in this plant".into(),
            ));
        }
    }
    let id:Uuid=sqlx::query_scalar("INSERT INTO transit_mixers(plant_id,registration_number,capacity_m3,driver_id,status) VALUES($1,$2,$3::numeric,$4,'idle') RETURNING id")
        .bind(plant_id).bind(payload.registration_number.trim()).bind(cap).bind(payload.driver_id).fetch_one(&mut *tx).await?;
    sqlx::query("INSERT INTO audit_logs(user_id,action,resource_type,resource_id,metadata) VALUES($1,'fleet.vehicle.create','transit_mixer',$2,$3)")
        .bind(auth_user.user_id).bind(id).bind(json!({"plant_id":plant_id,"driver_id":payload.driver_id,"actor_role":auth_user.role})).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(
        json!({"success":true,"id":id,"message":"Vehicle added"}),
    ))
}

#[derive(Debug, Deserialize, Serialize)]
pub struct UpdateVehicleStatusPayload {
    pub status: String,
}

pub async fn update_vehicle_status(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path((plant_id, vehicle_id)): Path<(Uuid, Uuid)>,
    Json(payload): Json<UpdateVehicleStatusPayload>,
) -> Result<impl IntoResponse, AppError> {
    if !["idle", "available", "maintenance", "inactive"].contains(&payload.status.as_str()) {
        return Err(AppError::BadRequest(
            "Unsupported mixer availability status".into(),
        ));
    }
    ensure_plant_staff_or_owner(&state, &auth_user, plant_id).await?;
    require_fleet_access(
        &state,
        &auth_user,
        plant_id,
        super::staff_module_permissions::Action::Edit,
    )
    .await?;

    sqlx::query("UPDATE transit_mixers SET status = $1 WHERE id = $2 AND plant_id = $3")
        .bind(&payload.status)
        .bind(vehicle_id)
        .bind(plant_id)
        .execute(&state.db)
        .await?;

    Ok(Json(
        json!({ "success": true, "message": "Vehicle status updated" }),
    ))
}

#[derive(Debug, Deserialize, Serialize)]
pub struct AddStaffPayload {
    pub user_id: Uuid,
    pub role: String,
}

pub async fn add_plant_staff(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(plant_id): Path<Uuid>,
    Json(payload): Json<AddStaffPayload>,
) -> Result<impl IntoResponse, AppError> {
    super::plant_staff_manager::require_manager_or_owner(&state, &auth_user, plant_id).await?;

    if auth_user.user_id == payload.user_id {
        return Err(AppError::Forbidden(
            "Self-assignment is not permitted".into(),
        ));
    }
    // Staff linking only: never create users, grant a different global role, or
    // enrol drivers in the email-OTP plant_staff system.
    let allowed = [
        "dispatcher",
        "operator",
        "supervisor",
        "accountant",
        "quality_engineer",
        "fleet_manager",
        "store_manager",
    ];
    if !allowed.contains(&payload.role.as_str()) {
        return Err(AppError::BadRequest(
            "Select an existing non-privileged plant staff role".into(),
        ));
    }
    let mut tx = state.db.begin().await?;
    let stored_role: Option<String> =
        sqlx::query_scalar("SELECT role FROM users WHERE id=$1 AND is_active=TRUE AND email IS NOT NULL AND btrim(email)<>'' AND work_email_verified_at IS NOT NULL FOR UPDATE")
            .bind(payload.user_id)
            .fetch_optional(&mut *tx)
            .await?;
    if stored_role.as_deref() != Some(payload.role.as_str()) {
        return Err(AppError::Conflict(
            "The selected existing user must already have the chosen staff role".into(),
        ));
    }

    // Do not bind an already assigned employee to a second plant.
    let other_plant: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM plant_staff
         WHERE user_id=$1 AND removed_at IS NULL)",
    )
    .bind(payload.user_id)
    .fetch_one(&mut *tx)
    .await?;
    if other_plant {
        return Err(AppError::Conflict(
            "Employee already belongs to another active plant".into(),
        ));
    }
    super::plant_staff_manager::lock_authorization(&mut tx, &auth_user, plant_id, "staff").await?;
    sqlx::query(
        "INSERT INTO plant_staff(plant_id,user_id,role,is_active,removed_at,removed_by)
         VALUES ($1,$2,$3,TRUE,NULL,NULL)
         ON CONFLICT(plant_id,user_id) DO UPDATE SET role=EXCLUDED.role,
             is_active=TRUE,removed_at=NULL,removed_by=NULL,employment_status='ACTIVE',assignment_id=uuid_generate_v4()",
    )
    .bind(plant_id)
    .bind(payload.user_id)
    .bind(&payload.role)
    .execute(&mut *tx)
    .await
    .map_err(|err| {
        if err.as_database_error().and_then(|db| db.constraint())
            == Some("ux_plant_staff_reserved_role")
        {
            AppError::Conflict("Job role occupied. Remove the previous assignment first.".into())
        } else {
            AppError::DatabaseError(err)
        }
    })?;
    super::staff_lifecycle::revoke_in_tx(&mut tx, payload.user_id, auth_user.user_id).await?;
    sqlx::query("DELETE FROM plant_staff_module_permissions WHERE plant_id=$1 AND user_id=$2")
        .bind(plant_id)
        .bind(payload.user_id)
        .execute(&mut *tx)
        .await?;
    super::staff_lifecycle::audit(
        &mut tx,
        &auth_user,
        plant_id,
        payload.user_id,
        "ASSIGNED",
        None,
        "Verified work-email identity linked by legacy staff client",
    )
    .await?;
    sqlx::query(
        "INSERT INTO plant_staff_role_slot_audit(plant_id,staff_user_id,actor_user_id,role,action)
         VALUES($1,$2,$3,$4,'ASSIGNED')",
    )
    .bind(plant_id)
    .bind(payload.user_id)
    .bind(auth_user.user_id)
    .bind(&payload.role)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    Ok(Json(
        json!({ "success": true, "message": "Staff member assigned" }),
    ))
}

pub async fn suspend_plant_staff(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path((plant_id, user_id)): Path<(Uuid, Uuid)>,
) -> Result<impl IntoResponse, AppError> {
    super::staff_lifecycle::apply(
        &state,
        &auth_user,
        plant_id,
        user_id,
        "suspend",
        "Legacy staff-management client request",
    )
    .await?;
    Ok(Json(json!({"success":true})))
}

pub async fn activate_plant_staff(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path((plant_id, user_id)): Path<(Uuid, Uuid)>,
) -> Result<impl IntoResponse, AppError> {
    super::staff_lifecycle::apply(
        &state,
        &auth_user,
        plant_id,
        user_id,
        "reactivate",
        "Legacy staff-management client request",
    )
    .await?;
    Ok(Json(json!({"success":true})))
}

pub async fn remove_plant_staff(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path((plant_id, user_id)): Path<(Uuid, Uuid)>,
) -> Result<impl IntoResponse, AppError> {
    super::staff_lifecycle::apply(
        &state,
        &auth_user,
        plant_id,
        user_id,
        "remove",
        "Legacy staff-management client request",
    )
    .await?;
    Ok(Json(json!({"success":true})))
}

pub async fn list_plant_customers(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(plant_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    ensure_plant_staff_or_owner(&state, &auth_user, plant_id).await?;
    super::staff_module_permissions::require(
        &state,
        &auth_user,
        plant_id,
        "quotations",
        super::staff_module_permissions::Action::View,
    )
    .await?;

    let rows = sqlx::query(
        r#"
        SELECT DISTINCT u.id, u.full_name, u.phone, u.email,
               COUNT(o.id) as total_orders
        FROM orders o
        INNER JOIN users u ON u.id = o.customer_id
        WHERE o.plant_id = $1
        GROUP BY u.id, u.full_name, u.phone, u.email
        ORDER BY u.full_name
        "#,
    )
    .bind(plant_id)
    .fetch_all(&state.db)
    .await?;

    let customers: Vec<_> = rows
        .into_iter()
        .map(|r| {
            let id: Uuid = r.get("id");
            let full_name: String = r.get("full_name");
            let phone: Option<String> = r.get("phone");
            let email: Option<String> = r.get("email");
            let total_orders: i64 = r.get("total_orders");
            json!({
                "id": id,
                "name": full_name,
                "phone": phone,
                "email": email,
                "total_orders": total_orders
            })
        })
        .collect();

    Ok(Json(json!({ "success": true, "customers": customers })))
}
