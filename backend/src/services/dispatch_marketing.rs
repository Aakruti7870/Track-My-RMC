//! Optional promotional WhatsApp message, separate from dispatch utility events.
//! Marketing can never block dispatch, consume utility consent, or silently
//! bypass an absent approval. One campaign invitation per order, max one
//! per plant and phone every 30 days. Requires a separately approved template.
use crate::{error::AppError, state::AppState};
use sqlx::Row;
use uuid::Uuid;

use super::whatsapp_service::WhatsAppService;

/// Create without sending, at the same database boundary as challan creation.
pub async fn prepare_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    load_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO dispatch_whatsapp_marketing_events(order_id,plant_id,status)
         SELECT o.id,o.plant_id,'waiting_dispatch'
         FROM order_loads l JOIN orders o ON o.id=l.order_id
         JOIN challans c ON c.load_id=l.id
         WHERE l.id=$1
         ON CONFLICT(order_id) DO NOTHING",
    )
    .bind(load_id)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// Eligible only once the first actual load is dispatched, not before.
/// Transaction-level idempotency: repeated dispatch cannot send again.
pub async fn activate_on_dispatch_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    load_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO dispatch_whatsapp_marketing_events(order_id,plant_id,status)
         SELECT o.id,o.plant_id,
           CASE WHEN COALESCE(c.marketing_opted_in,FALSE)
                THEN 'pending' ELSE 'needs_consent' END
         FROM order_loads l JOIN orders o ON o.id=l.order_id
         JOIN challans ch ON ch.load_id=l.id
         LEFT JOIN dispatch_whatsapp_contacts c ON c.order_id=o.id
         WHERE l.id=$1 AND l.status='dispatched'
         ON CONFLICT(order_id) DO UPDATE SET
             status=EXCLUDED.status,updated_at=NOW()
         WHERE dispatch_whatsapp_marketing_events.status='waiting_dispatch'",
    )
    .bind(load_id)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

pub async fn tick(state: &AppState) -> Result<usize, AppError> {
    // Keep pending marketing visible when Meta approval/configuration is absent.
    if std::env::var("META_MARKETING_TEMPLATE_NAME")
        .ok()
        .filter(|value| !value.is_empty())
        .is_none()
        || state
            .config
            .meta_whatsapp_token
            .as_deref()
            .unwrap_or("")
            .is_empty()
        || state
            .config
            .meta_whatsapp_phone_number_id
            .as_deref()
            .unwrap_or("")
            .is_empty()
    {
        return Ok(0);
    }
    // A later order cannot qualify for a second introductory promotion.
    // Explicitly settle its queue record instead of leaving it stuck as pending
    // indefinitely (and inflating the Plant Owner's Pending counter).
    sqlx::query(
        "UPDATE dispatch_whatsapp_marketing_events m
         SET status='skipped',last_error='first_touch_already_reserved',
             updated_at=NOW()
         FROM dispatch_whatsapp_contacts c
         WHERE c.order_id=m.order_id AND m.status='pending'
           AND EXISTS(SELECT 1 FROM dispatch_whatsapp_marketing_first_touch ft
                      WHERE ft.phone_e164=c.phone_e164)",
    )
    .execute(&state.db)
    .await?;
    // Reconcile an opt-out written from the CRM or a customer app while a
    // dispatch was being prepared. A STOP never cancels Utility delivery.
    sqlx::query(
        "UPDATE dispatch_whatsapp_marketing_events m
         SET status='cancelled',last_error='recipient_opted_out',
             updated_at=NOW()
         FROM dispatch_whatsapp_contacts c
         WHERE c.order_id=m.order_id
           AND m.status IN ('waiting_dispatch','needs_consent','pending')
           AND EXISTS(SELECT 1 FROM whatsapp_marketing_opt_outs o
                      WHERE o.phone_e164=c.phone_e164)",
    )
    .execute(&state.db)
    .await?;
    // A lost Meta response may still have delivered the message. Never blind-retry.
    sqlx::query(
        "UPDATE dispatch_whatsapp_marketing_events
         SET status='uncertain',last_error='provider_outcome_unknown',updated_at=NOW()
         WHERE status='sending' AND attempted_at < NOW()-INTERVAL '5 minutes'",
    )
    .execute(&state.db)
    .await?;

    let mut tx = state.db.begin().await?;
    // Only promote after Meta accepts at least one actual order dispatch Utility
    // message; promotion cannot supplant delivery status. Preserve a pending
    // record whenever Utility or marketing approval has not yet succeeded.
    let rows = sqlx::query(
        "UPDATE dispatch_whatsapp_marketing_events m
         SET status='sending',attempts=attempts+1,attempted_at=NOW(),updated_at=NOW()
         WHERE m.order_id IN (
             SELECT q.order_id FROM dispatch_whatsapp_marketing_events q
             JOIN dispatch_whatsapp_plant_settings prefs ON prefs.plant_id=q.plant_id
             JOIN dispatch_whatsapp_contacts c ON c.order_id=q.order_id
             JOIN order_loads l ON l.order_id=q.order_id
             JOIN dispatch_whatsapp_events utility ON utility.load_id=l.id
             WHERE q.status='pending'
               AND prefs.enabled AND prefs.marketing_enabled
               AND c.opted_in AND c.marketing_opted_in
               AND c.marketing_consent_recorded_at IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM whatsapp_marketing_opt_outs o
                               WHERE o.phone_e164=c.phone_e164)
               AND NOT EXISTS (SELECT 1 FROM dispatch_whatsapp_marketing_first_touch ft
                               WHERE ft.phone_e164=c.phone_e164)
               AND utility.status IN ('accepted','sent','delivered','read')
               AND utility.accepted_at < NOW()-INTERVAL '2 minutes'
               AND l.dispatched_at > NOW()-INTERVAL '2 hours'
               AND l.status IN ('dispatched','en_route','arrived','pouring')
             ORDER BY q.created_at,q.order_id LIMIT 2
             FOR UPDATE OF q SKIP LOCKED
         )
         RETURNING m.order_id,m.plant_id",
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
        let order_id: Uuid = row.get("order_id");
        let plant_id: Uuid = row.get("plant_id");

        let phone: Option<String> = sqlx::query_scalar(
            "SELECT c.phone_e164 FROM dispatch_whatsapp_contacts c
             JOIN dispatch_whatsapp_plant_settings p
               ON p.plant_id=$2
             WHERE c.order_id=$1 AND c.opted_in AND c.marketing_opted_in
               AND c.marketing_consent_recorded_at IS NOT NULL
               AND p.enabled AND p.marketing_enabled
               AND NOT EXISTS (SELECT 1 FROM whatsapp_marketing_opt_outs o
                               WHERE o.phone_e164=c.phone_e164)
               AND NOT EXISTS (SELECT 1 FROM dispatch_whatsapp_marketing_first_touch ft
                               WHERE ft.phone_e164=c.phone_e164)
               AND EXISTS(
                   SELECT 1 FROM order_loads l WHERE l.order_id=$1
                     AND l.dispatched_at > NOW()-INTERVAL '2 hours'
                     AND l.status IN ('dispatched','en_route','arrived','pouring')
               )",
        )
        .bind(order_id)
        .bind(plant_id)
        .fetch_optional(&state.db)
        .await?;

        let Some(phone) = phone else {
            sqlx::query(
                "UPDATE dispatch_whatsapp_marketing_events
                 SET status='cancelled',
                     last_error='marketing_consent_or_dispatch_no_longer_eligible',
                     updated_at=NOW()
                 WHERE order_id=$1 AND status='sending'",
            )
            .bind(order_id)
            .execute(&state.db)
            .await?;
            continue;
        };

        // A 30-day cooldown is claimed atomically in PostgreSQL; this also
        // protects against two independent worker processes racing each other.
        let slot: Option<(Uuid,)> = sqlx::query_as(
            "INSERT INTO dispatch_whatsapp_marketing_cooldowns
              (plant_id,phone_e164,reserved_at) VALUES($1,$2,NOW())
             ON CONFLICT(plant_id,phone_e164)
             DO UPDATE SET reserved_at=NOW()
             WHERE dispatch_whatsapp_marketing_cooldowns.reserved_at
                   < NOW()-INTERVAL '30 days'
             RETURNING plant_id",
        )
        .bind(plant_id)
        .bind(&phone)
        .fetch_optional(&state.db)
        .await?;
        if slot.is_none() {
            sqlx::query(
                "UPDATE dispatch_whatsapp_marketing_events
                 SET status='skipped',last_error='marketing_cooldown',
                 updated_at=NOW() WHERE order_id=$1 AND status='sending'",
            )
            .bind(order_id)
            .execute(&state.db)
            .await?;
            continue;
        }

        // Global first-touch reservation is unique across every plant using
        // the same TrackMyRMC sender. It is never retried blindly, even after
        // an uncertain provider response. This is NOT an opt-in grant.
        let first_touch: Option<(String,)> = sqlx::query_as(
            "INSERT INTO dispatch_whatsapp_marketing_first_touch
             (phone_e164,order_id,plant_id) VALUES($1,$2,$3)
             ON CONFLICT(phone_e164) DO NOTHING RETURNING phone_e164",
        )
        .bind(&phone)
        .bind(order_id)
        .bind(plant_id)
        .fetch_optional(&state.db)
        .await?;
        if first_touch.is_none() {
            sqlx::query(
                "UPDATE dispatch_whatsapp_marketing_events
                 SET status='skipped',last_error='first_touch_already_reserved',
                     updated_at=NOW()
                 WHERE order_id=$1 AND status='sending'",
            )
            .bind(order_id)
            .execute(&state.db)
            .await?;
            continue;
        }
        // STOP or a permissions change can occur while claiming the queue.
        // Recheck both consents and suppression immediately before provider IO.
        let permitted: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM dispatch_whatsapp_contacts c
                 JOIN dispatch_whatsapp_plant_settings p ON p.plant_id=$2
                 WHERE c.order_id=$1 AND c.phone_e164=$3
                   AND c.opted_in AND c.marketing_opted_in
                   AND c.marketing_consent_recorded_at IS NOT NULL
                   AND p.enabled AND p.marketing_enabled
                   AND NOT EXISTS(SELECT 1 FROM whatsapp_marketing_opt_outs o
                                  WHERE o.phone_e164=c.phone_e164))",
        )
        .bind(order_id)
        .bind(plant_id)
        .bind(&phone)
        .fetch_one(&state.db)
        .await?;
        if !permitted {
            sqlx::query(
                "UPDATE dispatch_whatsapp_marketing_events
                 SET status='cancelled',last_error='marketing_consent_revoked',
                     updated_at=NOW()
                 WHERE order_id=$1 AND status='sending'",
            )
            .bind(order_id)
            .execute(&state.db)
            .await?;
            continue;
        }

        match service.send_app_promotion_template(&phone).await {
            Ok(message_id) => {
                sqlx::query(
                    "UPDATE dispatch_whatsapp_marketing_events
                     SET status='accepted',provider_message_id=$2,
                         accepted_at=NOW(),last_error=NULL,updated_at=NOW()
                     WHERE order_id=$1 AND status='sending'",
                )
                .bind(order_id)
                .bind(message_id)
                .execute(&state.db)
                .await?;
            }
            Err(reason) => {
                sqlx::query(
                    "UPDATE dispatch_whatsapp_marketing_events
                     SET status='uncertain',last_error=$2,updated_at=NOW()
                     WHERE order_id=$1 AND status='sending'",
                )
                .bind(order_id)
                .bind(reason)
                .execute(&state.db)
                .await?;
                super::dispatch_whatsapp::alert_owner_review(state, plant_id, order_id, true)
                    .await?;
            }
        }
    }
    Ok(rows.len())
}

pub async fn mark_provider_status(
    state: &AppState,
    provider_id: &str,
    status: &str,
) -> Result<(), AppError> {
    if !matches!(status, "sent" | "delivered" | "read" | "failed") || provider_id.len() > 200 {
        return Ok(());
    }
    // "failed" never overwrites delivery; out-of-order updates cannot downgrade.
    let changed: Option<(Uuid, Uuid)> = sqlx::query_as(
        "UPDATE dispatch_whatsapp_marketing_events
         SET status=$2,updated_at=NOW(),
             delivered_at=CASE WHEN $2 IN ('delivered','read')
                THEN COALESCE(delivered_at,NOW()) ELSE delivered_at END
         WHERE provider_message_id=$1
           AND status IN ('accepted','sent','delivered','read','failed')
           AND (
               ($2='sent' AND status='accepted')
            OR ($2='delivered' AND status IN ('accepted','sent'))
            OR ($2='read' AND status IN ('accepted','sent','delivered'))
            OR ($2='failed' AND status IN ('accepted','sent'))
           )
         RETURNING plant_id,order_id",
    )
    .bind(provider_id)
    .bind(status)
    .fetch_optional(&state.db)
    .await?;
    if let Some((plant_id, order_id)) = changed {
        if status == "failed" {
            super::dispatch_whatsapp::alert_owner_review(state, plant_id, order_id, true).await?;
        }
    }
    Ok(())
}
