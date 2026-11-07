//! Native, opt-in automation for internal RMC notifications.
//! Runs entirely in Rust/PostgreSQL. No arbitrary HTTP nodes, SQL, scripts,
//! third-party workflow runner, or permission-elevating business mutations.
//! A transactional event insert plus row-locked delivery prevents lost/duplicate
//! notifications even after process restarts or concurrent worker ticks.
use sqlx::{PgPool, Postgres, Row, Transaction};
use uuid::Uuid;

pub const ACCEPTED: &str = "ORDER_ACCEPTED_NOTICE";
pub const REJECTED: &str = "ORDER_REJECTED_NOTICE";
pub const SUBMITTED_TASK: &str = "ORDER_SUBMITTED_TASK";
pub const PENDING_REMINDER: &str = "ORDER_PENDING_REMINDER";

enum Effect {
    Notification(Uuid),
    Task,
}

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

/// Create an owner review task in the same transaction as order placement.
/// This does not authorize, accept or otherwise mutate the order.
pub async fn enqueue_order_submitted(
    tx: &mut Transaction<'_, Postgres>,
    order_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO native_automation_jobs(event_key,plant_id,order_id,template_key)
         SELECT $1,o.plant_id,o.id,$2 FROM orders o
         WHERE o.id=$3 AND o.status='pending'
         ON CONFLICT (event_key) DO NOTHING",
    )
    .bind(format!("order-submitted:{order_id}"))
    .bind(SUBMITTED_TASK)
    .bind(order_id)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// Periodic, bounded, idempotent due-order scan. Plant owners opt in and select
/// a reminder window from 15 minutes to 24 hours. Only pending orders qualify.
pub async fn schedule_due_reminders(db: &PgPool) -> Result<u64, sqlx::Error> {
    let result = sqlx::query(
        "INSERT INTO native_automation_jobs(event_key,plant_id,order_id,template_key)
         SELECT 'order-pending-reminder:' || o.id::text,o.plant_id,o.id,$1
         FROM orders o
         JOIN rmc_plants p ON p.id=o.plant_id AND p.is_active
         JOIN users u ON u.id=p.owner_id AND u.is_active
         JOIN native_automation_plant_rules r
           ON r.plant_id=o.plant_id AND r.template_key=$1 AND r.enabled
         JOIN native_automation_templates t
           ON t.template_key=r.template_key AND t.published AND NOT t.globally_paused
         WHERE o.status='pending'
           AND o.created_at + (r.reminder_after_minutes * INTERVAL '1 minute') <= NOW()
           AND NOT EXISTS (
             SELECT 1 FROM native_automation_jobs j
             WHERE j.event_key='order-pending-reminder:' || o.id::text
           )
         ORDER BY o.created_at,o.id LIMIT 50
         ON CONFLICT (event_key) DO NOTHING",
    )
    .bind(PENDING_REMINDER)
    .execute(db)
    .await?;
    Ok(result.rows_affected())
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
    schedule_due_reminders(db).await?;
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
        .await?
        else {
            tx.commit().await?;
            break;
        };

        let id: Uuid = row.get("id");
        let plant: Uuid = row.get("plant_id");
        let order: Uuid = row.get("order_id");
        let template: String = row.get("template_key");
        let attempts: i32 = row.get::<i32, _>("attempts") + 1;
        let max_attempts: i32 = row.get("max_attempts");

        // Hold row-share locks for both policy levels until delivery commits.
        // Global pause and plant opt-out cannot overtake an in-flight action.
        let action: Option<String> = sqlx::query_scalar(
            "SELECT t.action_type
             FROM native_automation_templates t
             JOIN native_automation_plant_rules r ON r.template_key=t.template_key
             JOIN rmc_plants p ON p.id=r.plant_id
             WHERE t.template_key=$1 AND r.plant_id=$2 AND r.enabled
               AND t.published AND NOT t.globally_paused AND p.is_active
             FOR SHARE OF t,r,p",
        )
        .bind(&template)
        .bind(plant)
        .fetch_optional(&mut *tx)
        .await?;
        let Some(action) = action else {
            record_outcome(&mut tx, id, attempts, "SKIPPED", Some("rule_disabled"), None)
                .await?;
            tx.commit().await?;
            continue;
        };
        if !matches!(action.as_str(), "IN_APP_NOTIFICATION" | "CREATE_APPROVAL_TASK") {
            record_outcome(&mut tx, id, attempts, "SKIPPED", Some("action_not_allowed"), None)
                .await?;
            tx.commit().await?;
            continue;
        }

        // PostgreSQL SAVEPOINT permits controlled retry after a database
        // statement error, while keeping the claimed job row locked.
        sqlx::query("SAVEPOINT native_delivery")
            .execute(&mut *tx)
            .await?;
        let result = match (action.as_str(), template.as_str()) {
            ("IN_APP_NOTIFICATION", ACCEPTED | REJECTED | PENDING_REMINDER) => {
                deliver_internal_notification(&mut tx, plant, order, &template)
                    .await
                    .map(|id| id.map(Effect::Notification))
            }
            ("CREATE_APPROVAL_TASK", SUBMITTED_TASK) => {
                create_review_task(&mut tx, id, plant, order)
                    .await
                    .map(|task| task.map(|_| Effect::Task))
            }
            _ => Ok(None),
        };
        match result {
            Ok(Some(effect)) => {
                let notification = match effect {
                    Effect::Notification(notification_id) => Some(notification_id),
                    Effect::Task => None,
                };
                record_outcome(&mut tx, id, attempts, "COMPLETED", None, notification)
                    .await?;
                completed += 1;
            }
            Ok(None) => {
                record_outcome(
                    &mut tx,
                    id,
                    attempts,
                    "SKIPPED",
                    Some("recipient_unavailable"),
                    None,
                )
                .await?;
            }
            Err(err) => {
                sqlx::query("ROLLBACK TO SAVEPOINT native_delivery")
                    .execute(&mut *tx)
                    .await?;
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

/// Only the order's active owning plant may receive a human review task.
/// The task is informational: the owner must approve/reject through the
/// existing protected order endpoints, never by this worker.
async fn create_review_task(
    tx: &mut Transaction<'_, Postgres>,
    job: Uuid,
    plant: Uuid,
    order: Uuid,
) -> Result<Option<Uuid>, sqlx::Error> {
    let owner: Option<Uuid> = sqlx::query_scalar(
        "SELECT p.owner_id FROM orders o
         JOIN rmc_plants p ON p.id=o.plant_id AND p.is_active
         JOIN users u ON u.id=p.owner_id AND u.is_active
         WHERE o.id=$1 AND o.plant_id=$2 AND o.status='pending'
         FOR SHARE OF o,p,u",
    )
    .bind(order)
    .bind(plant)
    .fetch_optional(&mut **tx)
    .await?;
    let Some(owner) = owner else {
        return Ok(None);
    };
    let task: Uuid = sqlx::query_scalar(
        "INSERT INTO native_automation_tasks
         (source_job_id,plant_id,order_id,assigned_to,task_kind)
         VALUES($1,$2,$3,$4,'REVIEW_ORDER')
         ON CONFLICT (source_job_id) DO UPDATE SET updated_at=NOW()
         RETURNING id",
    )
    .bind(job)
    .bind(plant)
    .bind(order)
    .bind(owner)
    .fetch_one(&mut **tx)
    .await?;
    Ok(Some(task))
}

async fn deliver_internal_notification(
    tx: &mut Transaction<'_, Postgres>,
    plant: Uuid,
    order: Uuid,
    template: &str,
) -> Result<Option<Uuid>, sqlx::Error> {
    let (recipient, title, message): (Option<Uuid>, &str, &str) = match template {
        ACCEPTED | REJECTED => {
            let customer: Option<Uuid> = sqlx::query_scalar(
                "SELECT o.customer_id FROM orders o
                 JOIN users u ON u.id=o.customer_id AND u.is_active
                 WHERE o.id=$1 AND o.plant_id=$2",
            )
            .bind(order)
            .bind(plant)
            .fetch_optional(&mut **tx)
            .await?;
            if template == ACCEPTED {
                (customer, "Order accepted", "Your RMC plant has accepted your order.")
            } else {
                (customer, "Order rejected", "The RMC plant did not accept your order. Please review the order details.")
            }
        }
        PENDING_REMINDER => {
            // Recheck pending state while holding the order share lock.
            // If approval occurred while queued, no stale reminder is sent.
            let owner: Option<Uuid> = sqlx::query_scalar(
                "SELECT p.owner_id FROM orders o
                 JOIN rmc_plants p ON p.id=o.plant_id AND p.is_active
                 JOIN users u ON u.id=p.owner_id AND u.is_active
                 WHERE o.id=$1 AND o.plant_id=$2 AND o.status='pending'
                 FOR SHARE OF o,p,u",
            )
            .bind(order)
            .bind(plant)
            .fetch_optional(&mut **tx)
            .await?;
            (owner, "Order awaiting review", "An RMC order is still waiting for your approval or rejection.")
        }
        _ => return Ok(None),
    };
    let Some(recipient) = recipient else {
        return Ok(None);
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
