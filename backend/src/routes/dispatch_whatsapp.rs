//! Explicit WhatsApp delivery consent, plant preferences and signed public trip view.
use crate::{
    auth::{middleware::check_role, AuthUser},
    error::AppError,
    services::dispatch_whatsapp,
    state::AppState,
};
use axum::{
    body::Bytes,
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    Json,
};
use hmac::{Hmac, Mac};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::Sha256;
use std::collections::HashMap;
use uuid::Uuid;

#[derive(Deserialize)]
pub struct ConsentInput {
    pub phone: String,
    pub opted_in: bool,
    pub consent_source: String,
    #[serde(default)]
    pub marketing_opted_in: bool,
}

#[derive(Deserialize)]
pub struct CustomerConsentInput {
    pub opted_in: bool,
    #[serde(default)]
    pub marketing_opted_in: bool,
}

#[derive(Deserialize)]
pub struct PlantPreferenceInput {
    pub enabled: bool,
    pub marketing_enabled: Option<bool>,
}

async fn update_contact(
    state: &AppState,
    order_id: Uuid,
    actor_id: Uuid,
    phone: &str,
    opted_in: bool,
    marketing_opted_in: bool,
    source: &str,
) -> Result<(), AppError> {
    let normalized = dispatch_whatsapp::normalize_recipient(phone)?;
    let mut tx = state.db.begin().await?;
    sqlx::query(
        "INSERT INTO dispatch_whatsapp_contacts
           (order_id,phone_e164,opted_in,marketing_opted_in,
            marketing_consent_recorded_at,consent_source,consent_actor_id)
         VALUES($1,$2,$3,$4,CASE WHEN $4 THEN NOW() ELSE NULL END,$5,$6)
         ON CONFLICT(order_id) DO UPDATE SET
           phone_e164=EXCLUDED.phone_e164,opted_in=EXCLUDED.opted_in,
           marketing_opted_in=EXCLUDED.marketing_opted_in,
           marketing_consent_recorded_at=EXCLUDED.marketing_consent_recorded_at,
           consent_source=EXCLUDED.consent_source,
           consent_actor_id=EXCLUDED.consent_actor_id,
           consent_recorded_at=NOW(),updated_at=NOW()",
    )
    .bind(order_id)
    .bind(normalized)
    .bind(opted_in)
    .bind(marketing_opted_in)
    .bind(source)
    .bind(actor_id)
    .execute(&mut *tx)
    .await?;
    // An existing load can be made eligible only inside a two-hour window.
    // Never recreate old or already provider-accepted events on preference changes.
    sqlx::query(
        "UPDATE dispatch_whatsapp_events SET
            status=CASE WHEN $2 THEN 'pending' ELSE 'needs_consent' END,
            updated_at=NOW()
         WHERE order_id=$1 AND status IN ('needs_consent','pending')",
    )
    .bind(order_id)
    .bind(opted_in)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "UPDATE dispatch_whatsapp_marketing_events SET
           status=CASE WHEN $2 THEN 'pending' ELSE 'needs_consent' END,
           updated_at=NOW()
         WHERE order_id=$1 AND status IN ('needs_consent','pending')",
    )
    .bind(order_id)
    .bind(marketing_opted_in)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}

/// Staff must record *actual* delivery WhatsApp consent, not OS notification permission.
pub async fn staff_record_contact(
    State(state): State<AppState>,
    user: AuthUser,
    Path(order_id): Path<Uuid>,
    Json(input): Json<ConsentInput>,
) -> Result<impl IntoResponse, AppError> {
    check_role(
        &user,
        &["owner", "plant_owner", "dispatcher", "supervisor", "admin"],
    )?;
    super::loads_routes::ensure_order_access(&state, &user, order_id, false).await?;
    super::staff_module_permissions::require_order(
        &state,
        &user,
        order_id,
        "dispatch_queue",
        super::staff_module_permissions::Action::Edit,
    )
    .await?;
    if !matches!(
        input.consent_source.as_str(),
        "written_order" | "customer_phone" | "in_person"
    ) {
        return Err(AppError::BadRequest(
            "A real customer consent source is required".into(),
        ));
    }
    update_contact(
        &state,
        order_id,
        user.user_id,
        &input.phone,
        input.opted_in,
        input.marketing_opted_in,
        &input.consent_source,
    )
    .await?;
    Ok(Json(json!({"success": true, "opted_in": input.opted_in,
        "marketing_opted_in": input.marketing_opted_in})))
}

/// Registered customers may grant/revoke WhatsApp consent without staff involvement.
pub async fn customer_consent(
    State(state): State<AppState>,
    user: AuthUser,
    Path(order_id): Path<Uuid>,
    Json(input): Json<CustomerConsentInput>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&user, &["customer"])?;
    let phone: String = sqlx::query_scalar(
        "SELECT u.phone FROM orders o JOIN users u ON u.id=o.customer_id
         WHERE o.id=$1 AND o.customer_id=$2",
    )
    .bind(order_id)
    .bind(user.user_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Customer order not found".into()))?;
    update_contact(
        &state,
        order_id,
        user.user_id,
        &phone,
        input.opted_in,
        input.marketing_opted_in,
        "customer_app",
    )
    .await?;
    Ok(Json(json!({"success": true, "opted_in": input.opted_in})))
}

pub async fn get_customer_consent(
    State(state): State<AppState>,
    user: AuthUser,
    Path(order_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&user, &["customer"])?;
    let consent: Option<(bool, bool)> = sqlx::query_as(
        "SELECT COALESCE(c.opted_in,FALSE),COALESCE(c.marketing_opted_in,FALSE)
         FROM orders o LEFT JOIN dispatch_whatsapp_contacts c ON c.order_id=o.id
         WHERE o.id=$1 AND o.customer_id=$2",
    )
    .bind(order_id)
    .bind(user.user_id)
    .fetch_optional(&state.db)
    .await?;
    let (opted_in, marketing_opted_in) =
        consent.ok_or_else(|| AppError::NotFound("Order not found".into()))?;
    Ok(Json(
        json!({"opted_in": opted_in, "marketing_opted_in": marketing_opted_in}),
    ))
}

pub async fn get_owner_preference(
    State(state): State<AppState>,
    user: AuthUser,
    Path(plant_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&user, &["owner", "plant_owner"])?;
    ensure_owner(&state, user.user_id, plant_id).await?;
    let enabled: bool = sqlx::query_scalar(
        "SELECT COALESCE((SELECT enabled FROM dispatch_whatsapp_plant_settings
         WHERE plant_id=$1),FALSE)",
    )
    .bind(plant_id)
    .fetch_one(&state.db)
    .await?;
    let marketing_enabled: bool = sqlx::query_scalar(
        "SELECT COALESCE((SELECT marketing_enabled
         FROM dispatch_whatsapp_plant_settings WHERE plant_id=$1),FALSE)",
    )
    .bind(plant_id)
    .fetch_one(&state.db)
    .await?;
    let marketing_summary: Value = sqlx::query_scalar(
        "SELECT jsonb_build_object(
          'pending',COUNT(*) FILTER(WHERE status='pending'),
          'needs_consent',COUNT(*) FILTER(WHERE status='needs_consent'),
          'accepted',COUNT(*) FILTER(WHERE status='accepted'),
          'delivered',COUNT(*) FILTER(WHERE status IN ('delivered','read')),
          'needs_review',COUNT(*) FILTER(WHERE status IN ('failed','uncertain')),
          'skipped',COUNT(*) FILTER(WHERE status='skipped'))
         FROM dispatch_whatsapp_marketing_events WHERE plant_id=$1",
    )
    .bind(plant_id)
    .fetch_one(&state.db)
    .await?;
    let summary: Value = sqlx::query_scalar(
        "SELECT jsonb_build_object(
          'pending', COUNT(*) FILTER(WHERE status='pending'),
          'needs_consent',COUNT(*) FILTER(WHERE status='needs_consent'),
          'accepted',COUNT(*) FILTER(WHERE status='accepted'),
          'delivered',COUNT(*) FILTER(WHERE status IN ('delivered','read')),
          'needs_review',COUNT(*) FILTER(WHERE status IN ('failed','uncertain')))
         FROM dispatch_whatsapp_events WHERE plant_id=$1",
    )
    .bind(plant_id)
    .fetch_one(&state.db)
    .await?;
    Ok(Json(json!({
        "enabled": enabled,
        "marketing_enabled": marketing_enabled,
        "marketing_worker_enabled": std::env::var("DISPATCH_WHATSAPP_MARKETING_ENABLED")
            .ok().as_deref() == Some("true"),
        "marketing_template_configured": std::env::var("META_MARKETING_TEMPLATE_NAME")
            .ok().is_some_and(|v| !v.trim().is_empty()),
        "marketing_summary": marketing_summary,
        "worker_enabled": std::env::var("DISPATCH_WHATSAPP_ENABLED")
            .ok().as_deref() == Some("true"),
        "template_configured": std::env::var("META_DISPATCH_TEMPLATE_NAME")
            .ok().is_some_and(|v| !v.trim().is_empty()),
        "summary": summary
    })))
}

async fn ensure_owner(state: &AppState, owner_id: Uuid, plant_id: Uuid) -> Result<(), AppError> {
    let active: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM rmc_plants
         WHERE id=$1 AND owner_id=$2 AND is_active=TRUE)",
    )
    .bind(plant_id)
    .bind(owner_id)
    .fetch_one(&state.db)
    .await?;
    if !active {
        return Err(AppError::Forbidden(
            "Active plant ownership required".into(),
        ));
    }
    Ok(())
}

pub async fn set_owner_preference(
    State(state): State<AppState>,
    user: AuthUser,
    Path(plant_id): Path<Uuid>,
    Json(input): Json<PlantPreferenceInput>,
) -> Result<impl IntoResponse, AppError> {
    check_role(&user, &["owner", "plant_owner"])?;
    ensure_owner(&state, user.user_id, plant_id).await?;
    sqlx::query(
        "INSERT INTO dispatch_whatsapp_plant_settings
             (plant_id,enabled,marketing_enabled,updated_by)
         VALUES($1,$2,COALESCE($3,FALSE),$4)
         ON CONFLICT(plant_id) DO UPDATE SET
         enabled=EXCLUDED.enabled,
         marketing_enabled=COALESCE($3,dispatch_whatsapp_plant_settings.marketing_enabled),
         updated_by=EXCLUDED.updated_by,updated_at=NOW()",
    )
    .bind(plant_id)
    .bind(input.enabled)
    .bind(input.marketing_enabled)
    .bind(user.user_id)
    .execute(&state.db)
    .await?;
    Ok(Json(json!({"success": true, "enabled": input.enabled,
        "marketing_enabled": input.marketing_enabled})))
}

async fn authorize_load_share(
    state: &AppState,
    user: &AuthUser,
    load_id: Uuid,
) -> Result<Uuid, AppError> {
    let row: (Uuid, Option<Uuid>) =
        sqlx::query_as("SELECT order_id,driver_id FROM order_loads WHERE id=$1")
            .bind(load_id)
            .fetch_optional(&state.db)
            .await?
            .ok_or_else(|| AppError::NotFound("Load not found".into()))?;
    if user.role == "driver" && row.1 == Some(user.user_id) {
        return Ok(row.0);
    }
    check_role(
        user,
        &[
            "owner",
            "plant_owner",
            "dispatcher",
            "supervisor",
            "fleet_manager",
            "admin",
        ],
    )?;
    super::loads_routes::ensure_order_access(state, user, row.0, false).await?;
    super::staff_module_permissions::require_order(
        state,
        user,
        row.0,
        "dispatch_queue",
        super::staff_module_permissions::Action::View,
    )
    .await?;
    Ok(row.0)
}

/// Public mobile-web view requires an unforgeable signed, short-lived link.
pub async fn public_trip(
    State(state): State<AppState>,
    Path((load_id, signature)): Path<(Uuid, String)>,
) -> Result<impl IntoResponse, AppError> {
    if !dispatch_whatsapp::verify_tracking_signature(load_id, &signature, &state.config.jwt_secret)
    {
        return Err(AppError::NotFound("Trip link invalid or expired".into()));
    }
    let data: Option<Value> = sqlx::query_scalar(
        "SELECT jsonb_build_object(
          'plant_name',p.name,'order_number',o.order_number,
          'grade',o.concrete_grade,'quantity_m3',l.quantity_m3::DOUBLE PRECISION,
          'status',UPPER(l.status),'tm_number',m.registration_number,
          'driver_name',d.full_name,'site_name',s.name,
          'challan_number',c.challan_number,'batch_time',c.batch_time,
          'location',CASE WHEN t.recorded_at > NOW()-INTERVAL '90 seconds'
            AND l.status IN ('dispatched','en_route','arrived','pouring')
            THEN jsonb_build_object('lat',t.latitude,'lng',t.longitude,'at',t.recorded_at)
            ELSE NULL END
        )
         FROM order_loads l JOIN orders o ON o.id=l.order_id
         JOIN rmc_plants p ON p.id=o.plant_id
         JOIN customer_sites s ON s.id=o.site_id
         JOIN transit_mixers m ON m.id=l.mixer_id
         JOIN users d ON d.id=l.driver_id
         JOIN challans c ON c.load_id=l.id
         LEFT JOIN LATERAL (
             SELECT latitude,longitude,recorded_at FROM gps_telemetry
             WHERE load_id=l.id AND mixer_id=l.mixer_id AND driver_id=l.driver_id
             ORDER BY recorded_at DESC LIMIT 1
         ) t ON TRUE
         WHERE l.id=$1 AND l.dispatched_at > NOW()-INTERVAL '72 hours'
           AND l.status NOT IN ('cancelled')
           AND (l.status NOT IN ('completed','delivered')
                OR COALESCE(l.pour_completed_at,l.arrived_at,l.dispatched_at)
                   > NOW()-INTERVAL '24 hours')",
    )
    .bind(load_id)
    .fetch_optional(&state.db)
    .await?;
    let trip = data.ok_or_else(|| AppError::NotFound("Trip link invalid or expired".into()))?;
    Ok(Json(json!({"success": true, "trip": trip})))
}

pub async fn load_status(
    State(state): State<AppState>,
    user: AuthUser,
    Path(load_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    authorize_load_share(&state, &user, load_id).await?;
    let status: Option<Value> = sqlx::query_scalar(
        "SELECT jsonb_build_object('status',e.status,'attempts',e.attempts,
             'last_error',e.last_error,'updated_at',e.updated_at,
             'consent_recorded',COALESCE(c.opted_in,FALSE))
         FROM dispatch_whatsapp_events e
         LEFT JOIN dispatch_whatsapp_contacts c ON c.order_id=e.order_id
         WHERE e.load_id=$1",
    )
    .bind(load_id)
    .fetch_optional(&state.db)
    .await?;
    Ok(Json(json!({"notification": status})))
}

/// Meta GET challenge for WABA webhook verification.
pub async fn verify_meta_webhook(
    Query(query): Query<HashMap<String, String>>,
) -> Result<impl IntoResponse, AppError> {
    let expected = std::env::var("META_WEBHOOK_VERIFY_TOKEN")
        .map_err(|_| AppError::Unauthorized("Webhook verification unavailable".into()))?;
    if expected.len() < 32
        || query.get("hub.mode").map(String::as_str) != Some("subscribe")
        || query.get("hub.verify_token") != Some(&expected)
    {
        return Err(AppError::Unauthorized(
            "Invalid Meta webhook challenge".into(),
        ));
    }
    let challenge = query
        .get("hub.challenge")
        .filter(|s| s.len() <= 256)
        .cloned()
        .unwrap_or_default();
    Ok((StatusCode::OK, challenge))
}

/// Verify Meta's signed payload; never trust a provider status from an open endpoint.
pub async fn receive_meta_webhook(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<impl IntoResponse, AppError> {
    let secret = std::env::var("META_APP_SECRET")
        .map_err(|_| AppError::Unauthorized("Provider signature unavailable".into()))?;
    let supplied = headers
        .get("x-hub-signature-256")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("sha256="))
        .ok_or_else(|| AppError::Unauthorized("Missing Meta signature".into()))?;
    let signature = hex::decode(supplied)
        .map_err(|_| AppError::Unauthorized("Invalid Meta signature".into()))?;
    let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes())
        .map_err(|_| AppError::Unauthorized("Invalid webhook configuration".into()))?;
    mac.update(&body);
    mac.verify_slice(&signature)
        .map_err(|_| AppError::Unauthorized("Invalid Meta signature".into()))?;
    if body.len() > 64 * 1024 {
        return Err(AppError::BadRequest("Webhook payload is too large".into()));
    }
    let data: Value = serde_json::from_slice(&body)
        .map_err(|_| AppError::BadRequest("Invalid webhook body".into()))?;
    if data["object"] != "whatsapp_business_account" {
        return Ok(StatusCode::OK);
    }
    for entry in data["entry"].as_array().into_iter().flatten() {
        if state.config.meta_whatsapp_waba_id.as_deref() != entry["id"].as_str() {
            continue;
        }
        for change in entry["changes"].as_array().into_iter().flatten() {
            if change["field"] != "messages" {
                continue;
            }
            // Explicit recipient STOP on the verified sender cancels all pending
            // marketing for that number across all tenant plants.
            for inbound in change["value"]["messages"].as_array().into_iter().flatten() {
                let text = inbound["text"]["body"]
                    .as_str()
                    .unwrap_or("")
                    .trim()
                    .to_ascii_uppercase();
                if matches!(text.as_str(), "STOP" | "UNSUBSCRIBE" | "OPT OUT") {
                    if let Some(from) = inbound["from"].as_str() {
                        if let Ok(phone) = dispatch_whatsapp::normalize_recipient(from) {
                            let mut tx = state.db.begin().await?;
                            sqlx::query(
                                "UPDATE dispatch_whatsapp_marketing_events SET
                                    status='cancelled',last_error='recipient_opted_out',
                                    updated_at=NOW()
                                 WHERE order_id IN (
                                     SELECT order_id FROM dispatch_whatsapp_contacts
                                     WHERE phone_e164=$1
                                 ) AND status IN (
                                     'waiting_dispatch','needs_consent','pending'
                                 )",
                            )
                            .bind(&phone)
                            .execute(&mut *tx)
                            .await?;
                            sqlx::query(
                                "UPDATE dispatch_whatsapp_contacts
                                 SET marketing_opted_in=FALSE,
                                     marketing_consent_recorded_at=NULL,updated_at=NOW()
                                 WHERE phone_e164=$1",
                            )
                            .bind(&phone)
                            .execute(&mut *tx)
                            .await?;
                            tx.commit().await?;
                        }
                    }
                }
            }
            for notification in change["value"]["statuses"].as_array().into_iter().flatten() {
                if let (Some(id), Some(status)) =
                    (notification["id"].as_str(), notification["status"].as_str())
                {
                    dispatch_whatsapp::mark_provider_status(&state, id, status).await?;
                    crate::services::dispatch_marketing::mark_provider_status(&state, id, status)
                        .await?;
                }
            }
        }
    }
    Ok(StatusCode::OK)
}
