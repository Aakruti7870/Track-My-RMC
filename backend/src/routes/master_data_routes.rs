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

async fn ensure_plant_staff_or_owner(
    state: &AppState,
    user: &AuthUser,
    plant: Uuid,
) -> Result<(), AppError> {
    super::business_routes::ensure_plant_staff_or_owner(state, user, plant).await
}

#[derive(Debug, Deserialize, Serialize)]
pub struct PlantProfilePayload {
    pub legal_name: String,
    pub trade_name: Option<String>,
    pub gstin: Option<String>,
    pub pan: Option<String>,
    pub billing_address: String,
    pub state: Option<String>,
    pub state_code: Option<String>,
    pub contact_phone: Option<String>,
    pub contact_email: Option<String>,
    pub bank_name: Option<String>,
    pub bank_account_masked: Option<String>,
    pub ifsc: Option<String>,
    pub invoice_prefix: Option<String>,
    pub challan_prefix: Option<String>,
    pub quotation_prefix: Option<String>,
    pub terms_and_conditions: Option<String>,
}

pub async fn get_plant_profile(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(plant_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    ensure_plant_staff_or_owner(&state, &auth_user, plant_id).await?;

    let row = sqlx::query(
        r#"
        SELECT legal_name, trade_name, gstin, pan, billing_address, state, state_code,
               contact_phone, contact_email, bank_name, bank_account_masked, ifsc,
               invoice_prefix, challan_prefix, quotation_prefix, terms_and_conditions
        FROM plant_profiles WHERE plant_id = $1
        "#,
    )
    .bind(plant_id)
    .fetch_optional(&state.db)
    .await?;

    match row {
        Some(p) => {
            let legal_name: String = p.get("legal_name");
            let trade_name: Option<String> = p.get("trade_name");
            let gstin: Option<String> = p.get("gstin");
            let pan: Option<String> = p.get("pan");
            let billing_address: String = p.get("billing_address");
            let state_val: Option<String> = p.get("state");
            let state_code: Option<String> = p.get("state_code");
            let contact_phone: Option<String> = p.get("contact_phone");
            let contact_email: Option<String> = p.get("contact_email");
            let bank_name: Option<String> = p.get("bank_name");
            let bank_account_masked: Option<String> = p.get("bank_account_masked");
            let ifsc: Option<String> = p.get("ifsc");
            let invoice_prefix: Option<String> = p.get("invoice_prefix");
            let challan_prefix: Option<String> = p.get("challan_prefix");
            let quotation_prefix: Option<String> = p.get("quotation_prefix");
            let terms_and_conditions: Option<String> = p.get("terms_and_conditions");

            Ok(Json(json!({
                "success": true,
                "profile": {
                    "legal_name": legal_name,
                    "trade_name": trade_name,
                    "gstin": gstin,
                    "pan": pan,
                    "billing_address": billing_address,
                    "state": state_val,
                    "state_code": state_code,
                    "contact_phone": contact_phone,
                    "contact_email": contact_email,
                    "bank_name": bank_name,
                    "bank_account_masked": bank_account_masked,
                    "ifsc": ifsc,
                    "invoice_prefix": invoice_prefix,
                    "challan_prefix": challan_prefix,
                    "quotation_prefix": quotation_prefix,
                    "terms_and_conditions": terms_and_conditions
                }
            })))
        }
        None => {
            let plant = sqlx::query(
                "SELECT name, address_line, contact_phone, contact_email FROM rmc_plants WHERE id = $1",
            )
            .bind(plant_id)
            .fetch_optional(&state.db)
            .await?;

            if let Some(pl) = plant {
                let name: String = pl.get("name");
                let address_line: Option<String> = pl.get("address_line");
                let contact_phone: Option<String> = pl.get("contact_phone");
                let contact_email: Option<String> = pl.get("contact_email");

                Ok(Json(json!({
                    "success": true,
                    "profile": {
                        "legal_name": name,
                        "trade_name": name,
                        "billing_address": address_line.unwrap_or_default(),
                        "contact_phone": contact_phone,
                        "contact_email": contact_email,
                        "invoice_prefix": "INV",
                        "challan_prefix": "CH",
                        "quotation_prefix": "QT"
                    }
                })))
            } else {
                Err(AppError::NotFound("Plant not found".to_string()))
            }
        }
    }
}

pub async fn update_plant_profile(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(plant_id): Path<Uuid>,
    Json(payload): Json<PlantProfilePayload>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["owner", "plant_owner", "admin", "accountant"])?;
    ensure_plant_staff_or_owner(&state, &auth_user, plant_id).await?;

    let inv_pfx = payload.invoice_prefix.as_deref().unwrap_or("INV");
    let ch_pfx = payload.challan_prefix.as_deref().unwrap_or("CH");
    let qt_pfx = payload.quotation_prefix.as_deref().unwrap_or("QT");

    sqlx::query(
        r#"
        INSERT INTO plant_profiles (
            plant_id, legal_name, trade_name, gstin, pan, billing_address, state,
            state_code, contact_phone, contact_email, bank_name, bank_account_masked,
            ifsc, invoice_prefix, challan_prefix, quotation_prefix, terms_and_conditions,
            updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, NOW())
        ON CONFLICT (plant_id) DO UPDATE SET
            legal_name = EXCLUDED.legal_name,
            trade_name = EXCLUDED.trade_name,
            gstin = EXCLUDED.gstin,
            pan = EXCLUDED.pan,
            billing_address = EXCLUDED.billing_address,
            state = EXCLUDED.state,
            state_code = EXCLUDED.state_code,
            contact_phone = EXCLUDED.contact_phone,
            contact_email = EXCLUDED.contact_email,
            bank_name = EXCLUDED.bank_name,
            bank_account_masked = EXCLUDED.bank_account_masked,
            ifsc = EXCLUDED.ifsc,
            invoice_prefix = EXCLUDED.invoice_prefix,
            challan_prefix = EXCLUDED.challan_prefix,
            quotation_prefix = EXCLUDED.quotation_prefix,
            terms_and_conditions = EXCLUDED.terms_and_conditions,
            updated_at = NOW()
        "#,
    )
    .bind(plant_id)
    .bind(&payload.legal_name)
    .bind(&payload.trade_name)
    .bind(&payload.gstin)
    .bind(&payload.pan)
    .bind(&payload.billing_address)
    .bind(&payload.state)
    .bind(&payload.state_code)
    .bind(&payload.contact_phone)
    .bind(&payload.contact_email)
    .bind(&payload.bank_name)
    .bind(&payload.bank_account_masked)
    .bind(&payload.ifsc)
    .bind(inv_pfx)
    .bind(ch_pfx)
    .bind(qt_pfx)
    .bind(&payload.terms_and_conditions)
    .execute(&state.db)
    .await?;

    Ok(Json(
        json!({ "success": true, "message": "Profile updated successfully" }),
    ))
}

#[derive(Debug, Deserialize, Serialize)]
pub struct RateCardPayload {
    pub grade: String,
    pub rate_per_m3: f64,
    pub gst_rate: Option<f64>,
    pub transport_rate_per_km: Option<f64>,
    pub pumping_rate_per_m3: Option<f64>,
    pub active: Option<bool>,
}

pub async fn list_rate_cards(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(plant_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    ensure_plant_staff_or_owner(&state, &auth_user, plant_id).await?;

    let rows = sqlx::query(
        r#"
        SELECT id, grade, rate_per_m3, gst_rate, transport_rate_per_km, pumping_rate_per_m3, active
        FROM plant_rate_cards WHERE plant_id = $1 ORDER BY grade
        "#,
    )
    .bind(plant_id)
    .fetch_all(&state.db)
    .await?;

    let rate_cards: Vec<_> = rows
        .into_iter()
        .map(|r| {
            let id: Uuid = r.get("id");
            let grade: String = r.get("grade");
            let rate_per_m3: bigdecimal::BigDecimal = r.get("rate_per_m3");
            let gst_rate: bigdecimal::BigDecimal = r.get("gst_rate");
            let transport_rate_per_km: bigdecimal::BigDecimal = r.get("transport_rate_per_km");
            let pumping_rate_per_m3: bigdecimal::BigDecimal = r.get("pumping_rate_per_m3");
            let active: bool = r.get("active");

            json!({
                "id": id,
                "grade": grade,
                "rate_per_m3": rate_per_m3,
                "gst_rate": gst_rate,
                "transport_rate_per_km": transport_rate_per_km,
                "pumping_rate_per_m3": pumping_rate_per_m3,
                "active": active
            })
        })
        .collect();

    Ok(Json(json!({ "success": true, "rate_cards": rate_cards })))
}

pub async fn create_rate_card(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(plant_id): Path<Uuid>,
    Json(payload): Json<RateCardPayload>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["owner", "plant_owner", "admin", "accountant"])?;
    ensure_plant_staff_or_owner(&state, &auth_user, plant_id).await?;

    let gst_rate = payload.gst_rate.unwrap_or(18.0);
    let transport = payload.transport_rate_per_km.unwrap_or(0.0);
    let pumping = payload.pumping_rate_per_m3.unwrap_or(0.0);
    let active = payload.active.unwrap_or(true);

    let id: Uuid = sqlx::query_scalar(
        r#"
        INSERT INTO plant_rate_cards (
            plant_id, grade, rate_per_m3, gst_rate, transport_rate_per_km, pumping_rate_per_m3, active
        )
        VALUES ($1, $2, $3::numeric, $4::numeric, $5::numeric, $6::numeric, $7)
        RETURNING id
        "#,
    )
    .bind(plant_id)
    .bind(&payload.grade)
    .bind(payload.rate_per_m3)
    .bind(gst_rate)
    .bind(transport)
    .bind(pumping)
    .bind(active)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(
        json!({ "success": true, "id": id, "message": "Rate card created" }),
    ))
}

#[derive(Debug, Deserialize, Serialize)]
pub struct MixDesignPayload {
    pub grade: String,
    pub version: Option<i32>,
    pub cement_kg: Option<f64>,
    pub fly_ash_kg: Option<f64>,
    pub c_sand_kg: Option<f64>,
    pub sand_kg: Option<f64>,
    pub aggregate_10mm_kg: Option<f64>,
    pub aggregate_20mm_kg: Option<f64>,
    pub admixture_kg: Option<f64>,
    pub water_litre: Option<f64>,
    pub target_slump_mm: Option<i32>,
    pub notes: Option<String>,
    pub active: Option<bool>,
}

pub async fn list_mix_designs(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(plant_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    ensure_plant_staff_or_owner(&state, &auth_user, plant_id).await?;
    super::staff_module_permissions::require(
        &state,
        &auth_user,
        plant_id,
        "mix_designs",
        super::staff_module_permissions::Action::View,
    )
    .await?;

    let rows = sqlx::query(
        r#"
        SELECT id, grade, version, cement_kg, fly_ash_kg, c_sand_kg, sand_kg,
               aggregate_10mm_kg, aggregate_20mm_kg, admixture_kg, water_litre,
               target_slump_mm, notes, active
        FROM plant_mix_designs WHERE plant_id = $1 ORDER BY grade, version DESC
        "#,
    )
    .bind(plant_id)
    .fetch_all(&state.db)
    .await?;

    let mix_designs: Vec<_> = rows
        .into_iter()
        .map(|r| {
            let id: Uuid = r.get("id");
            let grade: String = r.get("grade");
            let version: i32 = r.get("version");
            let cement_kg: Option<bigdecimal::BigDecimal> = r.get("cement_kg");
            let fly_ash_kg: Option<bigdecimal::BigDecimal> = r.get("fly_ash_kg");
            let c_sand_kg: Option<bigdecimal::BigDecimal> = r.get("c_sand_kg");
            let sand_kg: Option<bigdecimal::BigDecimal> = r.get("sand_kg");
            let aggregate_10mm_kg: Option<bigdecimal::BigDecimal> = r.get("aggregate_10mm_kg");
            let aggregate_20mm_kg: Option<bigdecimal::BigDecimal> = r.get("aggregate_20mm_kg");
            let admixture_kg: Option<bigdecimal::BigDecimal> = r.get("admixture_kg");
            let water_litre: Option<bigdecimal::BigDecimal> = r.get("water_litre");
            let target_slump_mm: Option<i32> = r.get("target_slump_mm");
            let notes: Option<String> = r.get("notes");
            let active: bool = r.get("active");

            json!({
                "id": id,
                "grade": grade,
                "version": version,
                "cement_kg": cement_kg,
                "fly_ash_kg": fly_ash_kg,
                "c_sand_kg": c_sand_kg,
                "sand_kg": sand_kg,
                "aggregate_10mm_kg": aggregate_10mm_kg,
                "aggregate_20mm_kg": aggregate_20mm_kg,
                "admixture_kg": admixture_kg,
                "water_litre": water_litre,
                "target_slump_mm": target_slump_mm,
                "notes": notes,
                "active": active
            })
        })
        .collect();

    Ok(Json(json!({ "success": true, "mix_designs": mix_designs })))
}

pub async fn create_mix_design(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(plant_id): Path<Uuid>,
    Json(payload): Json<MixDesignPayload>,
) -> Result<impl IntoResponse, AppError> {
    check_role(
        &auth_user,
        &[
            "owner",
            "plant_owner",
            "admin",
            "quality_engineer",
            "operator",
        ],
    )?;
    ensure_plant_staff_or_owner(&state, &auth_user, plant_id).await?;
    super::staff_module_permissions::require(
        &state,
        &auth_user,
        plant_id,
        "mix_designs",
        super::staff_module_permissions::Action::Edit,
    )
    .await?;

    let id: Uuid = sqlx::query_scalar(
        r#"
        INSERT INTO plant_mix_designs (
            plant_id, grade, version, cement_kg, fly_ash_kg, c_sand_kg, sand_kg,
            aggregate_10mm_kg, aggregate_20mm_kg, admixture_kg, water_litre,
            target_slump_mm, notes, active
        )
        VALUES (
            $1, $2, $3, $4::numeric, $5::numeric, $6::numeric, $7::numeric,
            $8::numeric, $9::numeric, $10::numeric, $11::numeric, $12, $13, $14
        )
        RETURNING id
        "#,
    )
    .bind(plant_id)
    .bind(&payload.grade)
    .bind(payload.version.unwrap_or(1))
    .bind(payload.cement_kg.unwrap_or(0.0))
    .bind(payload.fly_ash_kg.unwrap_or(0.0))
    .bind(payload.c_sand_kg.unwrap_or(0.0))
    .bind(payload.sand_kg.unwrap_or(0.0))
    .bind(payload.aggregate_10mm_kg.unwrap_or(0.0))
    .bind(payload.aggregate_20mm_kg.unwrap_or(0.0))
    .bind(payload.admixture_kg.unwrap_or(0.0))
    .bind(payload.water_litre.unwrap_or(0.0))
    .bind(payload.target_slump_mm.unwrap_or(120))
    .bind(&payload.notes)
    .bind(payload.active.unwrap_or(true))
    .fetch_one(&state.db)
    .await?;

    Ok(Json(
        json!({ "success": true, "id": id, "message": "Mix design created" }),
    ))
}

pub async fn get_plant_resources(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(plant_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    ensure_plant_staff_or_owner(&state, &auth_user, plant_id).await?;

    // This shared supporting endpoint is loaded by many pages. Keep its shape
    // but do not leak fleet or raw stock data when the Owner has revoked
    // that specific module's read permission for a plant staff member.
    let fleet_visible = super::staff_module_permissions::require(
        &state,
        &auth_user,
        plant_id,
        "fleet_availability",
        super::staff_module_permissions::Action::View,
    )
    .await
    .is_ok();
    let stock_visible = super::staff_module_permissions::require(
        &state,
        &auth_user,
        plant_id,
        "material_inventory",
        super::staff_module_permissions::Action::View,
    )
    .await
    .is_ok();

    let mixers = sqlx::query(
        "SELECT id, registration_number, capacity_m3, status FROM transit_mixers WHERE plant_id = $1 ORDER BY registration_number",
    )
    .bind(plant_id)
    .fetch_all(&state.db)
    .await?;
    let mixers = if fleet_visible { mixers } else { Vec::new() };

    let materials = sqlx::query(
        "SELECT id, name, material_type, unit, current_stock, minimum_stock FROM plant_materials WHERE plant_id = $1 ORDER BY name",
    )
    .bind(plant_id)
    .fetch_all(&state.db)
    .await?;
    let materials = if stock_visible { materials } else { Vec::new() };

    let staff_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM plant_staff WHERE plant_id = $1 AND is_active = TRUE",
    )
    .bind(plant_id)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(json!({
        "success": true,
        "resources": {
            "transit_mixers": mixers.into_iter().map(|m| {
                let mid: Uuid = m.get("id");
                let reg: String = m.get("registration_number");
                let cap: bigdecimal::BigDecimal = m.get("capacity_m3");
                let st: String = m.get("status");
                json!({
                    "id": mid,
                    "registration_number": reg,
                    "capacity_m3": cap,
                    "status": st
                })
            }).collect::<Vec<_>>(),
            "materials": materials.into_iter().map(|m| {
                let mid: Uuid = m.get("id");
                let name: String = m.get("name");
                let mtype: String = m.get("material_type");
                let unit: String = m.get("unit");
                let cur: bigdecimal::BigDecimal = m.get("current_stock");
                let min: bigdecimal::BigDecimal = m.get("minimum_stock");
                json!({
                    "id": mid,
                    "name": name,
                    "type": mtype,
                    "unit": unit,
                    "current_stock": cur,
                    "minimum_stock": min
                })
            }).collect::<Vec<_>>(),
            "active_staff_count": staff_count
        }
    })))
}

pub async fn list_plant_people(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(plant_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    ensure_plant_staff_or_owner(&state, &auth_user, plant_id).await?;

    let rows = sqlx::query(
        r#"
        SELECT ps.id as staff_id, ps.user_id, ps.role, ps.is_active, ps.joined_at,
               u.full_name, u.phone, u.email
        FROM plant_staff ps
        INNER JOIN users u ON u.id = ps.user_id
        WHERE ps.plant_id = $1
        ORDER BY ps.role, u.full_name
        "#,
    )
    .bind(plant_id)
    .fetch_all(&state.db)
    .await?;

    let people: Vec<_> = rows
        .into_iter()
        .map(|r| {
            let user_id: Uuid = r.get("user_id");
            let staff_id: Uuid = r.get("staff_id");
            let full_name: String = r.get("full_name");
            let role: String = r.get("role");
            let phone: Option<String> = r.get("phone");
            let email: Option<String> = r.get("email");
            let is_active: bool = r.get("is_active");
            let joined_at: chrono::DateTime<chrono::Utc> = r.get("joined_at");

            json!({
                "id": user_id,
                "staff_id": staff_id,
                "name": full_name,
                "role": role,
                "phone": phone,
                "email": email,
                "active": is_active,
                "joined_at": joined_at
            })
        })
        .collect();

    Ok(Json(json!({ "success": true, "people": people })))
}

#[derive(Debug, Deserialize, Serialize)]
pub struct SupplierPayload {
    pub name: String,
    pub gstin: Option<String>,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub address: Option<String>,
}

pub async fn list_plant_suppliers(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(plant_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    ensure_plant_staff_or_owner(&state, &auth_user, plant_id).await?;
    super::staff_module_permissions::require(
        &state,
        &auth_user,
        plant_id,
        "suppliers",
        super::staff_module_permissions::Action::View,
    )
    .await?;

    let rows = sqlx::query(
        "SELECT id, name, gstin, phone, email, address, active FROM plant_suppliers WHERE plant_id = $1 ORDER BY name",
    )
    .bind(plant_id)
    .fetch_all(&state.db)
    .await?;

    let suppliers: Vec<_> = rows
        .into_iter()
        .map(|r| {
            let id: Uuid = r.get("id");
            let name: String = r.get("name");
            let gstin: Option<String> = r.get("gstin");
            let phone: Option<String> = r.get("phone");
            let email: Option<String> = r.get("email");
            let address: Option<String> = r.get("address");
            let active: bool = r.get("active");

            json!({
                "id": id,
                "name": name,
                "gstin": gstin,
                "phone": phone,
                "email": email,
                "address": address,
                "active": active
            })
        })
        .collect();

    Ok(Json(json!({ "success": true, "suppliers": suppliers })))
}

pub async fn create_plant_supplier(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(plant_id): Path<Uuid>,
    Json(payload): Json<SupplierPayload>,
) -> Result<impl IntoResponse, AppError> {
    check_role(
        &auth_user,
        &[
            "owner",
            "plant_owner",
            "admin",
            "store_manager",
            "accountant",
        ],
    )?;
    ensure_plant_staff_or_owner(&state, &auth_user, plant_id).await?;
    super::staff_module_permissions::require(
        &state,
        &auth_user,
        plant_id,
        "suppliers",
        super::staff_module_permissions::Action::Edit,
    )
    .await?;

    let id: Uuid = sqlx::query_scalar(
        "INSERT INTO plant_suppliers (plant_id, name, gstin, phone, email, address) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id",
    )
    .bind(plant_id)
    .bind(&payload.name)
    .bind(&payload.gstin)
    .bind(&payload.phone)
    .bind(&payload.email)
    .bind(&payload.address)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(
        json!({ "success": true, "id": id, "message": "Supplier created" }),
    ))
}

pub async fn delete_customer_site(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(site_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&auth_user, &["customer"])?;
    let mut tx = state.db.begin().await?;
    let owned: Option<Uuid> = sqlx::query_scalar(
        "SELECT id FROM customer_sites WHERE id=$1 AND customer_id=$2 FOR UPDATE",
    )
    .bind(site_id)
    .bind(auth_user.user_id)
    .fetch_optional(&mut *tx)
    .await?;
    if owned.is_none() {
        return Err(AppError::NotFound("Site not found".into()));
    }
    let linked:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM orders WHERE site_id=$1 UNION ALL SELECT 1 FROM customer_quotation_requests WHERE site_id=$1 UNION ALL SELECT 1 FROM customer_pour_plans WHERE site_id=$1 UNION ALL SELECT 1 FROM customer_receiving_records WHERE site_id=$1)").bind(site_id).fetch_one(&mut *tx).await?;
    if linked {
        return Err(AppError::Conflict(
            "Site has linked operational records and cannot be removed".into(),
        ));
    }
    sqlx::query("DELETE FROM customer_sites WHERE id=$1")
        .bind(site_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("INSERT INTO audit_logs(user_id,action,resource_type,resource_id) VALUES($1,'site.delete','site',$2)").bind(auth_user.user_id).bind(site_id.to_string()).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(json!({"success":true,"status":"deleted"})))
}

/// Real, plant-scoped operational figures for the existing Plant Reports card.
/// Does not expose invoice, payroll, salary, supplier bank or platform-wide data.
pub async fn get_plant_summary(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(plant_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    check_role(
        &auth_user,
        &[
            "owner",
            "plant_owner",
            "admin",
            "operator",
            "supervisor",
            "accountant",
            "quality_engineer",
            "fleet_manager",
            "store_manager",
        ],
    )?;
    ensure_plant_staff_or_owner(&state, &auth_user, plant_id).await?;
    super::staff_module_permissions::require(
        &state,
        &auth_user,
        plant_id,
        "plant_reports",
        super::staff_module_permissions::Action::View,
    )
    .await?;

    let orders: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM orders WHERE plant_id=$1")
        .bind(plant_id)
        .fetch_one(&state.db)
        .await?;
    let pending: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM orders WHERE plant_id=$1 AND status IN ('pending','confirmed')",
    )
    .bind(plant_id)
    .fetch_one(&state.db)
    .await?;
    let available_mixers: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM transit_mixers WHERE plant_id=$1 AND status IN ('idle','available')",
    )
    .bind(plant_id)
    .fetch_one(&state.db)
    .await?;
    let low_stock: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM plant_materials WHERE plant_id=$1 AND current_stock <= minimum_stock",
    )
    .bind(plant_id)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(json!({
        "success": true,
        "plant_id": plant_id,
        "reports": [
            { "id": "order_total", "name": "Plant orders", "status": format!("{orders} total") },
            { "id": "orders_pending", "name": "Pending / confirmed", "status": format!("{pending} orders") },
            { "id": "fleet_available", "name": "Available transit mixers", "status": format!("{available_mixers} ready") },
            { "id": "stock_low", "name": "Materials at reorder level", "status": format!("{low_stock} items") }
        ]
    })))
}
