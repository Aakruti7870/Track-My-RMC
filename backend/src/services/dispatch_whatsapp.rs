//! Opt-in transactional dispatch notifications, not the OTP or marketing channel.
//! One durable outbox row per load; Meta acceptance is not delivery confirmation.
//! Uncertain sends are never automatically retried (avoids duplicate delivery).
use crate::{error::AppError, state::AppState};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use hmac::{Hmac, Mac};
use sha2::Sha256;
use sqlx::Row;
use uuid::Uuid;

use super::whatsapp_service::WhatsAppService;

type HmacSha256 = Hmac<Sha256>;

fn trip_mac(load_id: Uuid, secret: &str) -> HmacSha256 {
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).expect("HMAC accepts key");
    mac.update(b"trackmyrmc:trip-share:v1:");
    mac.update(load_id.as_bytes());
    mac
}

pub fn tracking_url(load_id: Uuid, secret: &str) -> String {
    let signature = URL_SAFE_NO_PAD.encode(trip_mac(load_id, secret).finalize().into_bytes());
    format!("https://trackmyrmc.com/share/trip/{load_id}/{signature}")
}

pub fn verify_tracking_signature(load_id: Uuid, signature: &str, secret: &str) -> bool {
    let Ok(bytes) = URL_SAFE_NO_PAD.decode(signature) else {
        return false;
    };
    trip_mac(load_id, secret).verify_slice(&bytes).is_ok()
}

pub fn normalize_recipient(raw: &str) -> Result<String, AppError> {
    let trimmed = raw.trim();
    if trimmed.contains(|c: char| !(c.is_ascii_digit() || c == '+' || c == ' ' || c == '-')) {
        return Err(AppError::BadRequest("Invalid WhatsApp phone format".into()));
    }
    let digits: String = trimmed.chars().filter(|c| c.is_ascii_digit()).collect();
    let normalized = if digits.len() == 10 {
        format!("91{digits}")
    } else {
        digits
    };
    if !(10..=15).contains(&normalized.len()) || normalized.starts_with('0') {
        return Err(AppError::BadRequest("WhatsApp phone needs a country code".into()));
    }
    Ok(format!("+{normalized}"))
}

/// Called inside the same PostgreSQL transaction as dispatch, *never* on prepare.
/// Retries and duplicate dispatch calls cannot create a second message event.
pub async fn enqueue_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    load_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO dispatch_whatsapp_events(load_id,order_id,plant_id,status)
         SELECT l.id,o.id,o.plant_id,
           CASE WHEN c.opted_in THEN 'pending' ELSE 'needs_consent' END
         FROM order_loads l JOIN orders o ON o.id=l.order_id
         LEFT JOIN dispatch_whatsapp_contacts c ON c.order_id=o.id
         WHERE l.id=$1
         ON CONFLICT(load_id) DO NOTHING",
    )
    .bind(load_id)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// Owned by Rust/Tokio; no external workflow runner and no extra automation grants.
/// This must only be called when DISPATCH_WHATSAPP_ENABLED=true.
pub async fn tick(state: &AppState) -> Result<usize, AppError> {
    // A crashed or timed-out request may have been accepted at Meta.
    // Surface uncertain attempts to operators instead of resending blindly.
    sqlx::query(
        "UPDATE dispatch_whatsapp_events
         SET status='uncertain',last_error='provider_outcome_unknown',updated_at=NOW()
         WHERE status='sending' AND attempted_at < NOW() - INTERVAL '5 minutes'",
    )
    .execute(&state.db)
    .await?;

    let mut tx = state.db.begin().await?;
    let rows = sqlx::query(
        "UPDATE dispatch_whatsapp_events e SET status='sending',
            attempts=attempts+1,attempted_at=NOW(),updated_at=NOW()
         WHERE e.load_id IN (
           SELECT q.load_id FROM dispatch_whatsapp_events q
           JOIN dispatch_whatsapp_plant_settings settings ON settings.plant_id=q.plant_id
           JOIN dispatch_whatsapp_contacts contact ON contact.order_id=q.order_id
           JOIN order_loads l ON l.id=q.load_id
           JOIN challans c ON c.load_id=l.id
           WHERE q.status='pending' AND settings.enabled AND contact.opted_in
             AND l.dispatched_at > NOW() - INTERVAL '2 hours'
             AND l.status IN ('dispatched','en_route','arrived','pouring')
           ORDER BY q.created_at,q.load_id LIMIT 3 FOR UPDATE OF q SKIP LOCKED
         ) RETURNING e.load_id,e.order_id,e.plant_id",
    )
    .fetch_all(&mut *tx)
    .await?;
    tx.commit().await?;

    let service = WhatsAppService::new(
        state.config.meta_whatsapp_token.clone(),
        state.config.meta_whatsapp_phone_number_id.clone(),
        state.config.meta_graph_api_version.clone(),
    );
    for row in &rows {
        let load_id: Uuid = row.get("load_id");
        let order_id: Uuid = row.get("order_id");
        let plant_id: Uuid = row.get("plant_id");

        // Recheck live consent/settings before the request (operator can revoke).
        let details: Option<(String, String, String, String, f64, String)> =
            sqlx::query_as(
                "SELECT contact.phone_e164,p.name,o.order_number,o.concrete_grade,
                        l.quantity_m3::DOUBLE PRECISION,m.registration_number
                 FROM order_loads l JOIN orders o ON o.id=l.order_id
                 JOIN rmc_plants p ON p.id=o.plant_id
                 JOIN transit_mixers m ON m.id=l.mixer_id
                 JOIN dispatch_whatsapp_contacts contact ON contact.order_id=o.id
                 JOIN dispatch_whatsapp_plant_settings settings ON settings.plant_id=p.id
                 WHERE l.id=$1 AND o.id=$2 AND p.id=$3
                   AND contact.opted_in AND settings.enabled
                   AND l.status IN ('dispatched','en_route','arrived','pouring')
                   AND l.dispatched_at > NOW() - INTERVAL '2 hours'",
            )
            .bind(load_id)
            .bind(order_id)
            .bind(plant_id)
            .fetch_optional(&state.db)
            .await?;

        let Some((phone, plant, order, grade, quantity, mixer)) = details else {
            sqlx::query(
                "UPDATE dispatch_whatsapp_events SET status='cancelled',
                 last_error='consent_or_dispatch_no_longer_eligible',updated_at=NOW()
                 WHERE load_id=$1 AND status='sending'",
            )
            .bind(load_id)
            .execute(&state.db)
            .await?;
            continue;
        };

        let url = tracking_url(load_id, &state.config.jwt_secret);
        let quantity_text = format!("{quantity:.2}");
        let params = [
            plant.as_str(),
            order.as_str(),
            grade.as_str(),
            quantity_text.as_str(),
            mixer.as_str(),
            url.as_str(),
        ];
        match service.send_dispatch_template(&phone, &params).await {
            Ok(provider_id) => {
                sqlx::query(
                    "UPDATE dispatch_whatsapp_events SET status='accepted',
                     provider_message_id=$2,accepted_at=NOW(),last_error=NULL,
                     updated_at=NOW() WHERE load_id=$1 AND status='sending'",
                )
                .bind(load_id)
                .bind(provider_id)
                .execute(&state.db)
                .await?;
            }
            Err(reason) => {
                // Requests that fail may have reached Meta. Do not retry blindly.
                sqlx::query(
                    "UPDATE dispatch_whatsapp_events SET status='uncertain',
                     last_error=$2,updated_at=NOW()
                     WHERE load_id=$1 AND status='sending'",
                )
                .bind(load_id)
                .bind(reason)
                .execute(&state.db)
                .await?;
            }
        }
    }
    Ok(rows.len())
}

pub async fn mark_provider_status(
    state: &AppState,
    provider_id: &str,
    provider_status: &str,
) -> Result<(), AppError> {
    let rank = |s: &str| match s {
        "sent" => 1,
        "delivered" => 2,
        "read" => 3,
        "failed" => 4,
        _ => 0,
    };
    if rank(provider_status) == 0 || provider_id.len() > 200 {
        return Ok(());
    }
    // Do not downgrade read to delivered or sent, or delivered to sent.
    // Failed provider status remains visible to the human operator.
    let event: Option<(String,)> = sqlx::query_as(
        "SELECT status FROM dispatch_whatsapp_events WHERE provider_message_id=$1",
    )
    .bind(provider_id)
    .fetch_optional(&state.db)
    .await?;
    if let Some((previous,)) = event {
        if rank(provider_status) >= rank(&previous) {
            sqlx::query(
                "UPDATE dispatch_whatsapp_events SET status=$2,
                 delivered_at=CASE WHEN $2 IN ('delivered','read')
                                  THEN COALESCE(delivered_at,NOW()) ELSE delivered_at END,
                 updated_at=NOW() WHERE provider_message_id=$1
                 AND status IN ('accepted','sent','delivered','read','failed')",
            )
            .bind(provider_id)
            .bind(provider_status)
            .execute(&state.db)
            .await?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn links_are_tamper_evident_and_load_bound() {
        let id = Uuid::new_v4();
        let link = tracking_url(id, "a-test-only-sufficiently-long-secret");
        let sig = link.rsplit('/').next().unwrap();
        assert!(verify_tracking_signature(
            id,
            sig,
            "a-test-only-sufficiently-long-secret"
        ));
        assert!(!verify_tracking_signature(
            Uuid::new_v4(),
            sig,
            "a-test-only-sufficiently-long-secret"
        ));
        assert!(!verify_tracking_signature(id, sig, "other-secret"));
    }
    #[test]
    fn recipient_validation_handles_indian_and_international_numbers() {
        assert_eq!(normalize_recipient("9876543210").unwrap(), "+919876543210");
        assert_eq!(normalize_recipient("+919876543210").unwrap(), "+919876543210");
        assert!(normalize_recipient("not a number").is_err());
    }
}
