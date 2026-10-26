//! Secure, plant-scoped challan design; no changes to historical dispatch records.
use crate::{auth::AuthUser, error::AppError, state::AppState};
use axum::{extract::{Path, State}, Json};
use base64::Engine;
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::{PgPool, Row};
use uuid::Uuid;

pub const PLAY_STORE_URL: &str =
    "https://play.google.com/store/apps/details?id=com.trackmyrmc.concreteking";

#[derive(Deserialize)]
pub struct DesignInput {
    pub expected_version: i32,
    pub title: String,
    pub accent_color: String,
    #[serde(default)]
    pub header_note: String,
    pub footer_note: String,
    pub logo_data_uri: Option<String>,
    pub show_po: bool,
    pub show_slump: bool,
    pub show_batch: bool,
}

fn valid_color(s: &str) -> bool {
    s.len() == 7 && s.starts_with('#') && s[1..].bytes().all(|c| c.is_ascii_hexdigit())
}
fn valid_logo(s: &str) -> bool {
    if s.len() > 100_000 { return false; }
    let variants = [
        ("data:image/png;base64,", "png"),
        ("data:image/jpeg;base64,", "jpeg"),
        ("data:image/webp;base64,", "webp"),
    ];
    let Some((prefix, kind)) = variants.iter().find(|(prefix,_)| s.starts_with(prefix)) else {
        return false;
    };
    let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(&s[prefix.len()..]) else {
        return false;
    };
    if bytes.is_empty() || bytes.len() > 72_000 { return false; }
    match *kind {
        "png" => bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
        "jpeg" => bytes.starts_with(&[0xFF,0xD8,0xFF]),
        "webp" => bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP",
        _ => false,
    }
}
fn validate(d: &DesignInput) -> Result<(), AppError> {
    if d.expected_version < 0 || d.title.trim().is_empty() || d.title.len() > 100
        || d.header_note.len() > 140 || d.footer_note.len() > 200
        || !valid_color(&d.accent_color)
        || d.title.chars().any(char::is_control)
        || d.header_note.chars().any(char::is_control)
        || d.footer_note.chars().any(char::is_control)
        || d.logo_data_uri.as_deref().is_some_and(|s| !valid_logo(s))
    {
        return Err(AppError::BadRequest("Invalid challan design fields or logo (PNG/JPEG/WebP, max 72 KB)".into()));
    }
    Ok(())
}

fn may_design_role(role: &str) -> bool {
    matches!(role, "owner" | "plant_owner" | "admin")
}
async fn require_manage(db: &PgPool, user: &AuthUser, plant_id: Uuid) -> Result<(), AppError> {
    if !may_design_role(&user.role) {
        return Err(AppError::Forbidden("Only a plant owner or assigned plant manager can design challans".into()));
    }
    let permitted: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM rmc_plants p
           WHERE p.id=$1 AND p.is_active=TRUE AND
           (p.owner_id=$2 OR ($3='admin' AND EXISTS(
                SELECT 1 FROM plant_staff ps WHERE ps.plant_id=p.id
                AND ps.user_id=$2 AND ps.is_active=TRUE))))"
    ).bind(plant_id).bind(user.user_id).bind(&user.role)
    .fetch_one(db).await?;
    if !permitted {
        return Err(AppError::Forbidden("This plant is not assigned to your account".into()));
    }
    Ok(())
}

async fn resolve_design(db: &PgPool, plant_id: Uuid) -> Result<Value, AppError> {
    let record = sqlx::query(
        "SELECT title, accent_color, header_note, footer_note, logo_data_uri,
                show_po, show_slump, show_batch, version
         FROM plant_challan_templates WHERE plant_id=$1"
    ).bind(plant_id).fetch_optional(db).await?;
    Ok(if let Some(r) = record {
        json!({
            "is_custom":true, "version":r.get::<i32,_>("version"),
            "title":r.get::<String,_>("title"),
            "accent_color":r.get::<String,_>("accent_color"),
            "header_note":r.get::<String,_>("header_note"),
            "footer_note":r.get::<String,_>("footer_note"),
            "logo_data_uri":r.get::<Option<String>,_>("logo_data_uri"),
            "show_po":r.get::<bool,_>("show_po"),
            "show_slump":r.get::<bool,_>("show_slump"),
            "show_batch":r.get::<bool,_>("show_batch")
        })
    } else {
        json!({
            "is_custom":false, "version":0,
            "title":"DELIVERY CHALLAN", "accent_color":"#17313A",
            "header_note":"", "footer_note":"Acknowledgement subject to on-site verification.",
            "logo_data_uri":null, "show_po":true,"show_slump":true,"show_batch":true
        })
    })
}

async fn get_plant(db: &PgPool, plant_id: Uuid) -> Result<Value, AppError> {
    let plant: Option<Value> = sqlx::query_scalar(
        "SELECT jsonb_build_object('id', id, 'name', name,
             'address', address_line, 'city', city, 'state', state,
             'phone', contact_phone) FROM rmc_plants WHERE id=$1 AND is_active=TRUE"
    ).bind(plant_id).fetch_optional(db).await?;
    plant.ok_or_else(|| AppError::NotFound("Plant not found".into()))
}

pub async fn get(
    State(state): State<AppState>, auth: AuthUser, Path(plant_id): Path<Uuid>,
) -> Result<Json<Value>, AppError> {
    require_manage(&state.db, &auth, plant_id).await?;
    Ok(Json(json!({
        "plant":get_plant(&state.db,plant_id).await?,
        "design":resolve_design(&state.db,plant_id).await?,
        "play_store_url":PLAY_STORE_URL,
        "paper":"A4", "copies":2
    })))
}
pub async fn save(
    State(state): State<AppState>, auth: AuthUser,
    Path(plant_id): Path<Uuid>, Json(input): Json<DesignInput>,
) -> Result<Json<Value>, AppError> {
    require_manage(&state.db, &auth, plant_id).await?;
    validate(&input)?;
    // Optimistic version check prevents a stale manager tab overwriting an owner update.
    let mut tx = state.db.begin().await?;
    let updated: Option<i32> = sqlx::query_scalar(
        "INSERT INTO plant_challan_templates
          (plant_id,title,accent_color,header_note,footer_note,logo_data_uri,
           show_po,show_slump,show_batch,version,updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,1,$10)
         ON CONFLICT(plant_id) DO UPDATE SET
           title=EXCLUDED.title,accent_color=EXCLUDED.accent_color,
           header_note=EXCLUDED.header_note,footer_note=EXCLUDED.footer_note,
           logo_data_uri=EXCLUDED.logo_data_uri,show_po=EXCLUDED.show_po,
           show_slump=EXCLUDED.show_slump,show_batch=EXCLUDED.show_batch,
           version=plant_challan_templates.version+1,
           updated_by=EXCLUDED.updated_by,updated_at=NOW()
         WHERE plant_challan_templates.version=$11
         RETURNING version"
    ).bind(plant_id).bind(input.title.trim()).bind(&input.accent_color)
    .bind(input.header_note.trim()).bind(input.footer_note.trim())
    .bind(&input.logo_data_uri).bind(input.show_po).bind(input.show_slump)
    .bind(input.show_batch).bind(auth.user_id).bind(input.expected_version)
    .fetch_optional(&mut *tx).await?;
    let version = updated.ok_or_else(|| AppError::Conflict("Challan design changed. Reload before saving.".into()))?;
    // Initial insert must require expected_version=0 too.
    if version == 1 && input.expected_version != 0 {
        return Err(AppError::Conflict("Challan design changed. Reload before saving.".into()));
    }
    sqlx::query(
        "INSERT INTO plant_challan_template_audit
         (plant_id,actor_id,action,previous_version,new_version)
         VALUES ($1,$2,'save',$3,$4)"
    ).bind(plant_id).bind(auth.user_id)
    .bind(if input.expected_version == 0 {None} else {Some(input.expected_version)})
    .bind(version).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(json!({"success":true,"version":version})))
}
pub async fn reset(
    State(state): State<AppState>, auth: AuthUser, Path(plant_id): Path<Uuid>,
) -> Result<Json<Value>, AppError> {
    require_manage(&state.db, &auth, plant_id).await?;
    let mut tx=state.db.begin().await?;
    let old:Option<i32>=sqlx::query_scalar(
        "DELETE FROM plant_challan_templates WHERE plant_id=$1 RETURNING version"
    ).bind(plant_id).fetch_optional(&mut *tx).await?;
    if let Some(version)=old {
        sqlx::query(
            "INSERT INTO plant_challan_template_audit
             (plant_id,actor_id,action,previous_version,new_version)
             VALUES($1,$2,'reset',$3,NULL)"
        ).bind(plant_id).bind(auth.user_id).bind(version)
        .execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(Json(json!({"success":true,"design":"default"})))
}

/// A real delivery-print payload. Never accept manually supplied customer, quantity,
/// grade, load, or vehicle data from a template designer.
pub async fn order_print(
    State(state): State<AppState>, auth: AuthUser, Path(order_id): Path<Uuid>,
) -> Result<Json<Value>, AppError> {
    let r=sqlx::query(
        "SELECT o.customer_id, o.plant_id, p.owner_id
         FROM orders o JOIN rmc_plants p ON p.id=o.plant_id
         WHERE o.id=$1"
    ).bind(order_id).fetch_optional(&state.db).await?
    .ok_or_else(|| AppError::NotFound("Order not found".into()))?;
    let customer_id:Uuid=r.get("customer_id");
    let plant_id:Uuid=r.get("plant_id");
    let owner_id:Uuid=r.get("owner_id");
    if customer_id != auth.user_id && owner_id != auth.user_id {
        let assigned:bool=sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM plant_staff WHERE plant_id=$1 AND user_id=$2 AND is_active=TRUE)"
        ).bind(plant_id).bind(auth.user_id).fetch_one(&state.db).await?;
        if !assigned {
            return Err(AppError::Forbidden("Not authorized for this order".into()));
        }
    }
    let challans:Vec<Value>=sqlx::query_scalar(
        "SELECT jsonb_build_object(
          'id',c.id,'challan_number',c.challan_number,'order_number',o.order_number,
          'load_number',l.load_number,'customer_name',c.customer_name,
          'site_address',c.site_address,'site_name',s.name,
          'grade',c.concrete_grade,'quantity_m3',c.quantity_m3,
          'slump_mm',c.slump_mm,'batch_time',c.batch_time,'created_at',c.created_at,
          'mixer_number',c.mixer_number,'driver_name',c.driver_name,
          'status',c.status,'receiver_name',c.receiver_name)
         FROM challans c JOIN order_loads l ON l.id=c.load_id
         JOIN orders o ON o.id=l.order_id
         LEFT JOIN customer_sites s ON s.id=o.site_id
         WHERE l.order_id=$1 ORDER BY l.load_number ASC"
    ).bind(order_id).fetch_all(&state.db).await?;
    if challans.is_empty() {
        return Err(AppError::NotFound("No issued delivery challans for this order".into()));
    }
    Ok(Json(json!({
        "plant":get_plant(&state.db,plant_id).await?,
        "design":resolve_design(&state.db,plant_id).await?,
        "challans":challans, "play_store_url":PLAY_STORE_URL,
        "paper":"A4", "copies":2
    })))
}

#[cfg(test)]
mod tests {
    use super::{may_design_role, valid_color, valid_logo};
    #[test]
    fn exact_roles_only() {
        assert!(may_design_role("owner"));
        assert!(may_design_role("plant_owner"));
        assert!(may_design_role("admin"));
        assert!(!may_design_role("dispatcher"));
        assert!(!may_design_role("customer"));
    }
    #[test]
    fn strict_css_colors() {
        assert!(valid_color("#17313A"));
        assert!(!valid_color("#12345"));
        assert!(!valid_color("#fff;background:red"));
    }
    #[test]
    fn logo_must_be_supported_binary_image() {
        assert!(!valid_logo("data:image/svg+xml;base64,PHN2Zz4="));
        assert!(!valid_logo("data:image/png;base64,PHNjcmlwdD4="));
        assert!(!valid_logo("data:image/jpeg;base64,not_base64"));
    }
}
