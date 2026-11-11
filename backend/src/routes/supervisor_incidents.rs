//! Supervisors may acknowledge an active safety incident, never close it.
//! Plant Owners retain final resolution and can see the RESPONDING state.
use crate::{
    auth::{middleware::check_role, AuthUser},
    error::AppError,
    state::AppState,
};
use axum::{
    extract::{Path, State},
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AcknowledgeRequest {
    reason: String,
}

pub async fn acknowledge(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
    Json(request): Json<AcknowledgeRequest>,
) -> Result<Json<Value>, AppError> {
    check_role(&auth, &["supervisor"])?;
    let reason = request.reason.trim();
    if !(10..=500).contains(&reason.chars().count()) {
        return Err(AppError::BadRequest(
            "A response note of 10–500 characters is required".into(),
        ));
    }

    // Identify the incident's plant, not a client-supplied plant ID. A load
    // is authoritative; standalone SOS uses active, unreleased employment.
    let plants: Vec<Uuid> = sqlx::query_scalar(
        "SELECT DISTINCT plant_id FROM (
           SELECT o.plant_id FROM driver_sos_alerts a
           JOIN order_loads l ON l.id=a.load_id
           JOIN orders o ON o.id=l.order_id
           WHERE a.id=$1
           UNION ALL
           SELECT ep.plant_id FROM driver_sos_alerts a
           JOIN driver_employment_profiles ep ON ep.driver_id=a.driver_id
             AND ep.is_active=TRUE AND ep.released_at IS NULL
           WHERE a.id=$1 AND a.load_id IS NULL
           UNION ALL
           SELECT ps.plant_id FROM driver_sos_alerts a
           JOIN plant_staff ps ON ps.user_id=a.driver_id AND ps.is_active=TRUE
           WHERE a.id=$1 AND a.load_id IS NULL
         ) scoped",
    )
    .bind(id)
    .fetch_all(&state.db)
    .await?;
    if plants.len() != 1 {
        return Err(AppError::NotFound("Incident not found in one active plant".into()));
    }
    let plant = plants[0];
    super::staff_module_permissions::require(
        &state,
        &auth,
        plant,
        "incidents",
        super::staff_module_permissions::Action::Edit,
    )
    .await?;

    let mut tx = state.db.begin().await?;
    let status: Option<String> =
        sqlx::query_scalar("SELECT status FROM driver_sos_alerts WHERE id=$1 FOR UPDATE")
            .bind(id)
            .fetch_optional(&mut *tx)
            .await?;
    match status.as_deref() {
        Some("RESPONDING") => {
            tx.commit().await?;
            return Ok(Json(json!({"success":true,"status":"RESPONDING","already_acknowledged":true})));
        }
        Some("OPEN") => {}
        Some(_) => return Err(AppError::Conflict("Only open incidents can be acknowledged".into())),
        None => return Err(AppError::NotFound("Incident not found".into())),
    }

    sqlx::query("UPDATE driver_sos_alerts SET status='RESPONDING' WHERE id=$1")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        "INSERT INTO audit_logs(user_id,action,resource_type,resource_id,metadata)
         VALUES($1,'supervisor.incident.acknowledge','driver_sos_alert',$2,$3)",
    )
    .bind(auth.user_id)
    .bind(id.to_string())
    .bind(json!({"plant_id":plant,"reason":reason,"status":"RESPONDING"}))
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "INSERT INTO notifications(user_id,title,body,notification_type,reference_id)
         SELECT p.owner_id,'Incident response in progress',
           'A supervisor acknowledged a safety incident. Review and resolve it in the incident register.',
           'incident_responding',$2
         FROM rmc_plants p WHERE p.id=$1 AND p.owner_id IS NOT NULL",
    )
    .bind(plant)
    .bind(id.to_string())
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(json!({"success":true,"status":"RESPONDING"})))
}
