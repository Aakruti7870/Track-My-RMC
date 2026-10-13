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
use uuid::Uuid;

async fn ensure_plant_staff_or_owner(
    state: &AppState,
    auth_user: &AuthUser,
    plant_id: Uuid,
) -> Result<(), AppError> {
    if auth_user.role == "admin" {
        return Ok(());
    }
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

    let row = sqlx::query!(
        r#"
        SELECT legal_name, trade_name, gstin, pan, billing_address, state, state_code,
               contact_phone, contact_email, bank_name, bank_account_masked, ifsc,
               invoice_prefix, challan_prefix, quotation_prefix, terms_and_conditions
        FROM plant_profiles WHERE plant_id = $1
        "#,
        plant_id
    )
    .fetch_optional(&state.db)
    .await?;

    match row {
        Some(p) => Ok(Json(json!({
            "success": true,
            "profile": {
                "legal_name": p.legal_name,
                "trade_name": p.trade_name,
                "gstin": p.gstin,
                "pan": p.pan,
                "billing_address": p.billing_address,
                "state": p.state,
                "state_code": p.state_code,
                "contact_phone": p.contact_phone,
                "contact_email": p.contact_email,
                "bank_name": p.bank_name,
                "bank_account_masked": p.bank_account_masked,
                "ifsc": p.ifsc,
                "invoice_prefix": p.invoice_prefix,
                "challan_prefix": p.challan_prefix,
                "quotation_prefix": p.quotation_prefix,
                "terms_and_conditions": p.terms_and_conditions
            }
        }))),
        None => {
            // Return fallback default profile from rmc_plants table if not yet customized
            let plant = sqlx::query!(
                "SELECT name, address_line, contact_phone, contact_email FROM rmc_plants WHERE id = $1",
                plant_id
            )
            .fetch_optional(&state.db)
            .await?;

            if let Some(pl) = plant {
                Ok(Json(json!({
                    "success": true,
                    "profile": {
                        "legal_name": pl.name,
                        "trade_name": pl.name,
                        "billing_address": pl.address_line,
                        "contact_phone": pl.contact_phone,
                        "contact_email": pl.contact_email,
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
    check_role(
        &auth_user,
        &["owner", "plant_owner", "admin", "accountant"],
    )?;
    ensure_plant_staff_or_owner(&state, &auth_user, plant_id).await?;

    let inv_pfx = payload.invoice_prefix.as_deref().unwrap_or("INV");
    let ch_pfx = payload.challan_prefix.as_deref().unwrap_or("CH");
    let qt_pfx = payload.quotation_prefix.as_deref().unwrap_or("QT");

    sqlx::query!(
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
        plant_id,
        payload.legal_name,
        payload.trade_name,
        payload.gstin,
        payload.pan,
        payload.billing_address,
        payload.state,
        payload.state_code,
        payload.contact_phone,
        payload.contact_email,
        payload.bank_name,
        payload.bank_account_masked,
        payload.ifsc,
        inv_pfx,
        ch_pfx,
        qt_pfx,
        payload.terms_and_conditions
    )
    .execute(&state.db)
    .await?;

    Ok(Json(json!({ "success": true, "message": "Profile updated successfully" })))
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

    let rows = sqlx::query!(
        r#"
        SELECT id, grade, rate_per_m3, gst_rate, transport_rate_per_km, pumping_rate_per_m3, active
        FROM plant_rate_cards WHERE plant_id = $1 ORDER BY grade
        "#,
        plant_id
    )
    .fetch_all(&state.db)
    .await?;

    let rate_cards: Vec<_> = rows
        .into_iter()
        .map(|r| {
            json!({
                "id": r.id,
                "grade": r.grade,
                "rate_per_m3": r.rate_per_m3,
                "gst_rate": r.gst_rate,
                "transport_rate_per_km": r.transport_rate_per_km,
                "pumping_rate_per_m3": r.pumping_rate_per_m3,
                "active": r.active
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

    let id = sqlx::query_scalar!(
        r#"
        INSERT INTO plant_rate_cards (
            plant_id, grade, rate_per_m3, gst_rate, transport_rate_per_km, pumping_rate_per_m3, active
        )
        VALUES ($1, $2, $3::numeric, $4::numeric, $5::numeric, $6::numeric, $7)
        RETURNING id
        "#,
        plant_id,
        payload.grade,
        bigdecimal::BigDecimal::try_from(payload.rate_per_m3).unwrap_or_default(),
        bigdecimal::BigDecimal::try_from(gst_rate).unwrap_or_default(),
        bigdecimal::BigDecimal::try_from(transport).unwrap_or_default(),
        bigdecimal::BigDecimal::try_from(pumping).unwrap_or_default(),
        active
    )
    .fetch_one(&state.db)
    .await?;

    Ok(Json(json!({ "success": true, "id": id, "message": "Rate card created" })))
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

    let rows = sqlx::query!(
        r#"
        SELECT id, grade, version, cement_kg, fly_ash_kg, c_sand_kg, sand_kg,
               aggregate_10mm_kg, aggregate_20mm_kg, admixture_kg, water_litre,
               target_slump_mm, notes, active
        FROM plant_mix_designs WHERE plant_id = $1 ORDER BY grade, version DESC
        "#,
        plant_id
    )
    .fetch_all(&state.db)
    .await?;

    let mix_designs: Vec<_> = rows
        .into_iter()
        .map(|r| {
            json!({
                "id": r.id,
                "grade": r.grade,
                "version": r.version,
                "cement_kg": r.cement_kg,
                "fly_ash_kg": r.fly_ash_kg,
                "c_sand_kg": r.c_sand_kg,
                "sand_kg": r.sand_kg,
                "aggregate_10mm_kg": r.aggregate_10mm_kg,
                "aggregate_20mm_kg": r.aggregate_20mm_kg,
                "admixture_kg": r.admixture_kg,
                "water_litre": r.water_litre,
                "target_slump_mm": r.target_slump_mm,
                "notes": r.notes,
                "active": r.active
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
        &["owner", "plant_owner", "admin", "quality_engineer", "operator"],
    )?;
    ensure_plant_staff_or_owner(&state, &auth_user, plant_id).await?;

    let id = sqlx::query_scalar!(
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
        plant_id,
        payload.grade,
        payload.version.unwrap_or(1),
        bigdecimal::BigDecimal::try_from(payload.cement_kg.unwrap_or(0.0)).unwrap_or_default(),
        bigdecimal::BigDecimal::try_from(payload.fly_ash_kg.unwrap_or(0.0)).unwrap_or_default(),
        bigdecimal::BigDecimal::try_from(payload.c_sand_kg.unwrap_or(0.0)).unwrap_or_default(),
        bigdecimal::BigDecimal::try_from(payload.sand_kg.unwrap_or(0.0)).unwrap_or_default(),
        bigdecimal::BigDecimal::try_from(payload.aggregate_10mm_kg.unwrap_or(0.0)).unwrap_or_default(),
        bigdecimal::BigDecimal::try_from(payload.aggregate_20mm_kg.unwrap_or(0.0)).unwrap_or_default(),
        bigdecimal::BigDecimal::try_from(payload.admixture_kg.unwrap_or(0.0)).unwrap_or_default(),
        bigdecimal::BigDecimal::try_from(payload.water_litre.unwrap_or(0.0)).unwrap_or_default(),
        payload.target_slump_mm.unwrap_or(120),
        payload.notes,
        payload.active.unwrap_or(true)
    )
    .fetch_one(&state.db)
    .await?;

    Ok(Json(json!({ "success": true, "id": id, "message": "Mix design created" })))
}

pub async fn get_plant_resources(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(plant_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    ensure_plant_staff_or_owner(&state, &auth_user, plant_id).await?;

    let mixers = sqlx::query!(
        "SELECT id, registration_number, capacity_m3, status FROM transit_mixers WHERE plant_id = $1 ORDER BY registration_number",
        plant_id
    )
    .fetch_all(&state.db)
    .await?;

    let materials = sqlx::query!(
        "SELECT id, name, material_type, unit, current_stock, minimum_stock FROM plant_materials WHERE plant_id = $1 ORDER BY name",
        plant_id
    )
    .fetch_all(&state.db)
    .await?;

    let staff_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM plant_staff WHERE plant_id = $1 AND is_active = TRUE",
    )
    .bind(plant_id)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(json!({
        "success": true,
        "resources": {
            "transit_mixers": mixers.into_iter().map(|m| json!({
                "id": m.id,
                "registration_number": m.registration_number,
                "capacity_m3": m.capacity_m3,
                "status": m.status
            })).collect::<Vec<_>>(),
            "materials": materials.into_iter().map(|m| json!({
                "id": m.id,
                "name": m.name,
                "type": m.material_type,
                "unit": m.unit,
                "current_stock": m.current_stock,
                "minimum_stock": m.minimum_stock
            })).collect::<Vec<_>>(),
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

    let rows = sqlx::query!(
        r#"
        SELECT ps.id as staff_id, ps.user_id, ps.role, ps.is_active, ps.joined_at,
               u.full_name, u.phone, u.email
        FROM plant_staff ps
        INNER JOIN users u ON u.id = ps.user_id
        WHERE ps.plant_id = $1
        ORDER BY ps.role, u.full_name
        "#,
        plant_id
    )
    .fetch_all(&state.db)
    .await?;

    let people: Vec<_> = rows
        .into_iter()
        .map(|r| {
            json!({
                "id": r.user_id,
                "staff_id": r.staff_id,
                "name": r.full_name,
                "role": r.role,
                "phone": r.phone,
                "email": r.email,
                "active": r.is_active,
                "joined_at": r.joined_at
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

    let rows = sqlx::query!(
        "SELECT id, name, gstin, phone, email, address, active FROM plant_suppliers WHERE plant_id = $1 ORDER BY name",
        plant_id
    )
    .fetch_all(&state.db)
    .await?;

    let suppliers: Vec<_> = rows
        .into_iter()
        .map(|r| {
            json!({
                "id": r.id,
                "name": r.name,
                "gstin": r.gstin,
                "phone": r.phone,
                "email": r.email,
                "address": r.address,
                "active": r.active
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
    check_role(&auth_user, &["owner", "plant_owner", "admin", "store_manager", "accountant"])?;
    ensure_plant_staff_or_owner(&state, &auth_user, plant_id).await?;

    let id = sqlx::query_scalar!(
        "INSERT INTO plant_suppliers (plant_id, name, gstin, phone, email, address) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id",
        plant_id,
        payload.name,
        payload.gstin,
        payload.phone,
        payload.email,
        payload.address
    )
    .fetch_one(&state.db)
    .await?;

    Ok(Json(json!({ "success": true, "id": id, "message": "Supplier created" })))
}

pub async fn delete_customer_site(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(site_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    let result = sqlx::query!(
        "DELETE FROM customer_sites WHERE id = $1 AND customer_id = $2",
        site_id,
        auth_user.user_id
    )
    .execute(&state.db)
    .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("Site not found or unauthorized".to_string()));
    }

    Ok(Json(json!({ "success": true, "message": "Site deleted" })))
}
