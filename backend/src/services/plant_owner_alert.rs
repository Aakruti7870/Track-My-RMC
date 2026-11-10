//! Durable Meta utility alerts for new Plant Owner registration leads.
//! Meta's accepted response is not a handset delivery confirmation.
//! Ambiguous sends stop for operator review rather than duplicating messages.
use crate::{error::AppError, services::whatsapp_service::WhatsAppService, state::AppState};
use sqlx::Row;
use uuid::Uuid;

pub async fn tick(state: &AppState) -> Result<usize, AppError> {
    let recipient = std::env::var("PLANT_OWNER_ALERT_TO").ok();
    let template = std::env::var("PLANT_OWNER_ALERT_TEMPLATE_NAME").ok();
    let configured = recipient.as_deref().is_some_and(|number| {
        let digits = WhatsAppService::normalize_phone(number);
        digits.len() == 12
            && digits.starts_with("91")
            && digits.bytes().all(|digit| digit.is_ascii_digit())
    }) && template.as_deref().is_some_and(|name| {
        !name.is_empty()
            && name.len() <= 120
            && name
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
    }) && state
        .config
        .meta_whatsapp_token
        .as_deref()
        .is_some_and(|s| !s.is_empty())
        && state
            .config
            .meta_whatsapp_phone_number_id
            .as_deref()
            .is_some_and(|s| !s.is_empty());

    // Do not mark queued messages failed just because the template or sender
    // has not yet been configured/approved in production.
    if !configured {
        return Ok(0);
    }

    sqlx::query(
        "UPDATE plant_owner_registration_requests
         SET alert_status='UNCERTAIN',alert_error='provider_outcome_unknown',
             updated_at=NOW()
         WHERE alert_status='SENDING'
           AND alert_attempted_at < NOW() - INTERVAL '5 minutes'",
    )
    .execute(&state.db)
    .await?;

    let mut tx = state.db.begin().await?;
    let rows = sqlx::query(
        "UPDATE plant_owner_registration_requests r
         SET alert_status='SENDING',alert_attempts=alert_attempts+1,
             alert_attempted_at=NOW(),updated_at=NOW()
         WHERE r.id IN (
            SELECT id FROM plant_owner_registration_requests
            WHERE alert_status='PENDING'
            ORDER BY created_at,id LIMIT 3 FOR UPDATE SKIP LOCKED
         )
         RETURNING r.id,r.request_number,r.owner_name,r.business_name",
    )
    .fetch_all(&mut *tx)
    .await?;
    tx.commit().await?;

    let service = WhatsAppService::new(
        state.config.meta_whatsapp_token.clone(),
        state.config.meta_whatsapp_phone_number_id.clone(),
        state.config.meta_graph_api_version.clone(),
    );
    let recipient = recipient.expect("configuration checked");
    for row in &rows {
        let id: Uuid = row.get("id");
        let number: String = row.get("request_number");
        let owner: String = row.get("owner_name");
        let business: String = row.get("business_name");

        match service
            .send_owner_registration_template(
                &recipient,
                &[number.as_str(), owner.as_str(), business.as_str()],
            )
            .await
        {
            Ok(provider_id) => {
                sqlx::query(
                    "UPDATE plant_owner_registration_requests
                     SET alert_status='ACCEPTED',alert_provider_id=$2,
                         alert_accepted_at=NOW(),alert_error=NULL,updated_at=NOW()
                     WHERE id=$1 AND alert_status='SENDING'",
                )
                .bind(id)
                .bind(provider_id)
                .execute(&state.db)
                .await?;
            }
            Err(error_code) => {
                sqlx::query(
                    "UPDATE plant_owner_registration_requests
                     SET alert_status='UNCERTAIN',alert_error=$2,updated_at=NOW()
                     WHERE id=$1 AND alert_status='SENDING'",
                )
                .bind(id)
                .bind(&error_code)
                .execute(&state.db)
                .await?;
                sqlx::query(
                    "INSERT INTO notifications(user_id,title,body,notification_type,reference_id)
                     SELECT id,'Plant Owner WhatsApp alert requires review',
                            $1,'plant_owner_registration',$2
                     FROM users u WHERE role='central_admin' AND is_active
                       AND NOT EXISTS(
                         SELECT 1 FROM notifications n
                         WHERE n.user_id=u.id AND n.reference_id=$2
                           AND n.title='Plant Owner WhatsApp alert requires review'
                       )",
                )
                .bind(format!("Registration {number} was saved but Meta delivery could not be confirmed. Review the alert queue."))
                .bind(id.to_string())
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
    if provider_id.len() > 200
        || !provider_id.starts_with("wamid.")
        || !matches!(provider_status, "sent" | "delivered" | "read" | "failed")
    {
        return Ok(());
    }
    let status = provider_status.to_ascii_uppercase();
    sqlx::query(
        "UPDATE plant_owner_registration_requests
         SET alert_status=$2, updated_at=NOW(),
             alert_error=CASE WHEN $2='FAILED' THEN 'provider_reported_failed'
                              ELSE NULL END
         WHERE alert_provider_id=$1
           AND (($2='SENT' AND alert_status='ACCEPTED')
             OR ($2='DELIVERED' AND alert_status IN ('ACCEPTED','SENT'))
             OR ($2='READ' AND alert_status IN ('ACCEPTED','SENT','DELIVERED'))
             OR ($2='FAILED' AND alert_status IN ('ACCEPTED','SENT')))",
    )
    .bind(provider_id)
    .bind(status)
    .execute(&state.db)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn reminder_template_is_separate_from_otp_and_dispatch() {
        let source = include_str!("plant_owner_alert.rs");
        assert!(source.contains("PLANT_OWNER_ALERT_TEMPLATE_NAME"));
        assert!(source.contains("send_owner_registration_template"));
    }
}
