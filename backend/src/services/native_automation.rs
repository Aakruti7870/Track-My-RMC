//! Native, opt-in automation for internal RMC notifications.
//! Runs entirely in Rust/PostgreSQL. No arbitrary HTTP nodes, SQL, scripts,
//! third-party workflow runner, or permission-elevating business mutations.
//! A transactional event insert plus row-locked delivery prevents lost/duplicate
//! notifications even after process restarts or concurrent worker ticks.
use sqlx::{PgPool, Postgres, Row, Transaction};
use uuid::Uuid;

pub const ACCEPTED: &str = "ORDER_ACCEPTED_NOTICE";
pub const REJECTED: &str = "ORDER_REJECTED_NOTICE";

fn template_for_status(status: &str) -> Option<&'static str> {
    match status {
        "confirmed" => Some(ACCEPTED),
        "rejected" => Some(REJECTED),
        _ => None,
    }
}

/// Must be called inside the *same transaction* as the order state transition.
/// This does not change an order, and duplicate source events are harmless.
pub async fn enqueue_order_decision(
    tx: &mut Transaction<'_, Postgres>,
    order_id: Uuid,
    status: &str,
) -> Result<(), sqlx::Error> {
    let Some(template_key) = template_for_status(status) else {
        return Ok(());
    };
    sqlx::query(
        "INSERT INTO native_automation_jobs(event_key,plant_id,order_id,template_key)
         SELECT $1,o.plant_id,o.id,$2 FROM orders o WHERE o.id=$3
         ON CONFLICT (event_key) DO NOTHING",
    )
    .bind(format!("order-decision:{order_id}:{status}"))
    .bind(template_key)
    .bind(order_id)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn record_outcome(
    tx: &mut Transaction<'_, Postgres>,
    job_id: Uuid,
    attempts: i32,
    outcome: &str,
    detail: Option<&str>,
    notification_id: Option<Uuid>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE native_automation_jobs SET status=$2,attempts=$3,last_error=$4,
            notification_id=$5,updated_at=NOW() WHERE id=$1",
    )
    .bind(job_id)
    .bind(outcome)
    .bind(attempts)
    .bind(detail)
    .bind(notification_id)
    .execute(&mut **tx)
    .await?;
    sqlx::query(
        "INSERT INTO native_automation_attempts(job_id,attempt,outcome,detail)
         VALUES($1,$2,$3,$4)",
    )
    .bind(job_id)
    .bind(attempts)
    .bind(outcome)
    .bind(detail)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// Process at most 25 due jobs. FOR UPDATE SKIP LOCKED provides process-safe
/// claiming without Redis, separate AWS resources, or an HTTP worker token.
/// Internal notification insertion and job completion commit atomically.
pub async fn tick(db: &PgPool) -> Result<usize, sqlx::Error> {
    let mut completed = 0usize;
    for _ in 0..25 {
        let mut tx = db.begin().await?;
        let Some(row) = sqlx::query(
            "SELECT id,plant_id,order_id,template_key,attempts,max_attempts
             FROM native_automation_jobs
             WHERE status IN ('PENDING','RETRY') AND available_at <= NOW()
             ORDER BY available_at,id LIMIT 1 FOR UPDATE SKIP LOCKED",
        )
        .fetch_optional(&mut *tx)
        .await? else {
            tx.commit().await?;
            break;
        };

        let id: Uuid = row.get("id");
        let plant: Uuid = row.get("plant_id");
        let order: Uuid = row.get("order_id");
        let template: String = row.get("template_key");
        let attempts: i32 = row.get::<i32, _>("attempts") + 1;
        let max_attempts: i32 = row.get("max_attempts");

        // Both levels must be enabled. Missing plant settings default to deny.
        let allowed: bool = sqlx::query_scalar(
            "SELECT EXISTS(
              SELECT 1 FROM native_automation_templates t
              JOIN native_automation_plant_rules r ON r.template_key=t.template_key
              JOIN rmc_plants p ON p.id=r.plant_id
              WHERE t.template_key=$1 AND r.plant_id=$2 AND r.enabled
                AND t.published AND NOT t.globally_paused AND p.is_active
            )",
        )
        .bind(&template)
        .bind(plant)
        .fetch_one(&mut *tx)
        .await?;

        if !allowed {
            record_outcome(&mut tx, id, attempts, "SKIPPED", Some("rule_disabled"), None).await?;
            tx.commit().await?;
            continue;
        }

        // Only configured, built-in action kinds can execute.
        let action: Option<String> = sqlx::query_scalar(
            "SELECT action_type FROM native_automation_templates
             WHERE template_key=$1 AND published AND NOT globally_paused",
        )
        .bind(&template)
        .fetch_optional(&mut *tx)
        .await?;
        if action.as_deref() != Some("IN_APP_NOTIFICATION") {
            record_outcome(&mut tx, id, attempts, "SKIPPED", Some("action_not_allowed"), None)
                .await?;
            tx.commit().await?;
            continue;
        }

        // PostgreSQL SAVEPOINT permits controlled retry after a database
        // statement error, while keeping the claimed job row locked.
        sqlx::query("SAVEPOINT native_delivery").execute(&mut *tx).await?;
        let result = deliver_internal_notification(&mut tx, plant, order, &template).await;
        match result {
            Ok(Some(notification_id)) => {
                record_outcome(
                    &mut tx, id, attempts, "COMPLETED", None, Some(notification_id),
                ).await?;
                completed += 1;
            }
            Ok(None) => {
                record_outcome(
                    &mut tx, id, attempts, "SKIPPED", Some("recipient_unavailable"), None,
                ).await?;
            }
            Err(err) => {
                sqlx::query("ROLLBACK TO SAVEPOINT native_delivery").execute(&mut *tx).await?;
                let is_final = attempts >= max_attempts;
                let next_status = if is_final { "DEAD_LETTER" } else { "RETRY" };
                let safe_error = err.to_string().chars().take(500).collect::<String>();
                record_outcome(&mut tx, id, attempts, next_status, Some(&safe_error), None).await?;
                if !is_final {
                    // Bounded exponential backoff: 30 seconds to one hour.
                    let exponent = (attempts - 1).clamp(0, 7) as u32;
                    let delay = (30_i64 * 2_i64.pow(exponent)).min(3600);
                    sqlx::query(
                        "UPDATE native_automation_jobs
                         SET available_at=NOW()+($2 * INTERVAL '1 second') WHERE id=$1",
                    )
                    .bind(id)
                    .bind(delay)
                    .execute(&mut *tx)
                    .await?;
                }
            }
        }
        tx.commit().await?;
    }

    sqlx::query(
        "INSERT INTO native_automation_worker_heartbeat
         (worker_name,last_seen_at,last_success_at,last_error)
         VALUES('native-internal-worker',NOW(),NOW(),NULL)
         ON CONFLICT (worker_name) DO UPDATE SET
         last_seen_at=NOW(),last_success_at=NOW(),last_error=NULL",
    )
    .execute(db)
    .await?;
    Ok(completed)
}

async fn deliver_internal_notification(
    tx: &mut Transaction<'_, Postgres>,
    plant: Uuid,
    order: Uuid,
    template: &str,
) -> Result<Option<Uuid>, sqlx::Error> {
    let recipient: Option<Uuid> = sqlx::query_scalar(
        "SELECT o.customer_id FROM orders o
         JOIN users u ON u.id=o.customer_id AND u.is_active
         WHERE o.id=$1 AND o.plant_id=$2",
    )
    .bind(order)
    .bind(plant)
    .fetch_optional(&mut **tx)
    .await?;
    let Some(recipient) = recipient else {
        return Ok(None);
    };
    let (title, message) = match template {
        ACCEPTED => ("Order accepted", "Your RMC plant has accepted your order."),
        REJECTED => ("Order rejected", "The RMC plant did not accept your order. Please review the order details."),
        _ => return Ok(None),
    };
    let notification: Uuid = sqlx::query_scalar(
        "INSERT INTO notifications(user_id,title,body,notification_type,reference_id)
         VALUES($1,$2,$3,'order_status',$4) RETURNING id",
    )
    .bind(recipient)
    .bind(title)
    .bind(message)
    .bind(order.to_string())
    .fetch_one(&mut **tx)
    .await?;
    Ok(Some(notification))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_approved_order_transitions_generate_jobs() {
        assert_eq!(template_for_status("confirmed"), Some(ACCEPTED));
        assert_eq!(template_for_status("rejected"), Some(REJECTED));
        for status in ["pending", "draft", "delivered", "paid", "cancelled", ""] {
            assert_eq!(template_for_status(status), None);
        }
    }
}
