//! Durable, tenant-scoped lifecycle reconciliation for internal automation tasks.
//! Acknowledgement is never a business decision. Only verified source state
//! can close an incident; a failed engineer inspection requires a separate
//! formally authorized corrective-action workflow and is never auto-closed.
use serde_json::json;
use sqlx::{PgPool, Postgres, Row, Transaction};
use uuid::Uuid;

use super::native_domain_automation::{DISPATCH, INVENTORY, QUALITY, RFQ, WORKFORCE};

type Outcome = (&'static str, &'static str);

/// Returns a terminal lifecycle state only after checking the actual
/// operational record and its plant boundary under a share lock.
/// Missing/unowned data never counts as a successful resolution.
async fn verified_outcome(
    tx: &mut Transaction<'_, Postgres>,
    kind: &str,
    plant: Uuid,
    entity: Uuid,
) -> Result<Option<Outcome>, sqlx::Error> {
    match kind {
        DISPATCH => {
            let row: Option<(String, String, bool, bool)> = sqlx::query_as(
                "SELECT l.status,o.status,l.driver_id IS NOT NULL,l.mixer_id IS NOT NULL
                 FROM order_loads l JOIN orders o ON o.id=l.order_id
                 WHERE l.id=$1 AND o.plant_id=$2 FOR SHARE OF l,o",
            )
            .bind(entity)
            .bind(plant)
            .fetch_optional(&mut **tx)
            .await?;
            Ok(match row {
                Some((load, order, _, _))
                    if load == "cancelled" || order == "cancelled" || order == "rejected" =>
                {
                    Some(("CANCELLED", "LOAD_CANCELLED"))
                }
                Some((_, _, true, true)) => Some(("RESOLVED", "LOAD_ASSIGNED")),
                _ => None,
            })
        }
        RFQ => {
            let status: Option<String> = sqlx::query_scalar(
                "SELECT status FROM customer_quotation_requests
                 WHERE id=$1 AND plant_id=$2 FOR SHARE",
            )
            .bind(entity)
            .bind(plant)
            .fetch_optional(&mut **tx)
            .await?;
            Ok(match status.as_deref() {
                Some("QUOTED" | "DECLINED") => Some(("RESOLVED", "RFQ_RESPONDED")),
                Some("CANCELLED") => Some(("CANCELLED", "RFQ_CANCELLED")),
                _ => None,
            })
        }
        INVENTORY => {
            let replenished: Option<bool> = sqlx::query_scalar(
                "SELECT minimum_stock>0 AND current_stock>minimum_stock
                 FROM plant_materials WHERE id=$1 AND plant_id=$2 FOR SHARE",
            )
            .bind(entity)
            .bind(plant)
            .fetch_optional(&mut **tx)
            .await?;
            Ok(replenished
                .filter(|value| *value)
                .map(|_| ("RESOLVED", "STOCK_REPLENISHED")))
        }
        WORKFORCE => {
            let status: Option<String> = sqlx::query_scalar(
                "SELECT status FROM workforce_leave_requests
                 WHERE id=$1 AND plant_id=$2 FOR SHARE",
            )
            .bind(entity)
            .bind(plant)
            .fetch_optional(&mut **tx)
            .await?;
            Ok(match status.as_deref() {
                Some("APPROVED" | "REJECTED") => Some(("RESOLVED", "LEAVE_DECIDED")),
                Some("CANCELLED") => Some(("CANCELLED", "LEAVE_CANCELLED")),
                _ => None,
            })
        }
        QUALITY => {
            // A FAIL assessment is immutable evidence. A subsequent PASS,
            // edited test, or missing record is not a verified CAPA closure.
            Ok(None)
        }
        _ => Ok(None),
    }
}

/// Recheck at most 25 due review tasks. Row locks make concurrent workers
/// idempotent. Escalations, task state, and event ledger commit atomically.
/// No order/stock/inspection/leave record is changed by this worker.
pub async fn reconcile(db: &PgPool) -> Result<usize, sqlx::Error> {
    let mut transitions = 0usize;
    for _ in 0..25 {
        let mut tx = db.begin().await?;
        let row = sqlx::query(
            "SELECT id,plant_id,domain_entity_id,template_key,escalation_count,
                    (next_escalation_at<=NOW()) AS escalation_due
             FROM native_automation_domain_tasks
             WHERE status IN ('OPEN','ACKNOWLEDGED') AND next_check_at<=NOW()
             ORDER BY next_check_at,id LIMIT 1 FOR UPDATE SKIP LOCKED",
        )
        .fetch_optional(&mut *tx)
        .await?;
        let Some(row) = row else {
            tx.commit().await?;
            break;
        };
        let id: Uuid = row.get("id");
        let plant: Uuid = row.get("plant_id");
        let entity: Uuid = row.get("domain_entity_id");
        let kind: String = row.get("template_key");
        let count: i32 = row.get("escalation_count");
        let due: bool = row.get("escalation_due");

        if let Some((state, reason)) = verified_outcome(&mut tx, &kind, plant, entity).await? {
            sqlx::query(
                "UPDATE native_automation_domain_tasks SET
                 status=$2,resolution_reason=$3,resolved_at=NOW(),updated_at=NOW()
                 WHERE id=$1",
            )
            .bind(id)
            .bind(state)
            .bind(reason)
            .execute(&mut *tx)
            .await?;
            sqlx::query(
                "INSERT INTO native_automation_domain_task_events
                 (task_id,plant_id,event_type,details)
                 VALUES($1,$2,$3,$4)",
            )
            .bind(id)
            .bind(plant)
            .bind(if state == "RESOLVED" {
                "SOURCE_RESOLVED"
            } else {
                "SOURCE_CANCELLED"
            })
            .bind(json!({"verified_reason":reason}))
            .execute(&mut *tx)
            .await?;
            transitions += 1;
        } else if due && count < 2 {
            // Re-validate current owner, global publication, and plant opt-in.
            // A paused or inactive plant receives no new escalation.
            let recipient: Option<(Uuid, i32)> = sqlx::query_as(
                "SELECT p.owner_id,r.sla_minutes FROM rmc_plants p
                 JOIN users u ON u.id=p.owner_id AND u.is_active
                 JOIN native_automation_plant_rules r ON r.plant_id=p.id
                 JOIN native_automation_templates t ON t.template_key=r.template_key
                 WHERE p.id=$1 AND r.template_key=$2 AND p.is_active AND r.enabled
                   AND t.published AND NOT t.globally_paused
                   AND t.action_type='CREATE_DOMAIN_REVIEW'
                 FOR SHARE OF p,u,r,t",
            )
            .bind(plant)
            .bind(&kind)
            .fetch_optional(&mut *tx)
            .await?;
            if let Some((owner, sla_minutes)) = recipient {
                sqlx::query(
                    "INSERT INTO notifications
                     (user_id,title,body,notification_type,reference_id)
                     VALUES($1,'Unresolved plant review',
                            'A previously reported operational issue remains unresolved. Review the original task.',
                            'automation_escalation',$2)",
                )
                .bind(owner)
                .bind(id.to_string())
                .execute(&mut *tx)
                .await?;
                sqlx::query(
                    "UPDATE native_automation_domain_tasks
                     SET assigned_to=$2,escalation_count=escalation_count+1,
                         next_escalation_at=NOW()+($3*INTERVAL '1 minute'),
                         updated_at=NOW() WHERE id=$1",
                )
                .bind(id)
                .bind(owner)
                .bind(sla_minutes)
                .execute(&mut *tx)
                .await?;
                sqlx::query(
                    "INSERT INTO native_automation_domain_task_events
                     (task_id,plant_id,event_type,details)
                     VALUES($1,$2,'SLA_ESCALATED',$3)",
                )
                .bind(id)
                .bind(plant)
                .bind(json!({"level":count+1,"sla_minutes":sla_minutes}))
                .execute(&mut *tx)
                .await?;
                transitions += 1;
            }
        }
        sqlx::query(
            "UPDATE native_automation_domain_tasks
             SET next_check_at=NOW()+INTERVAL '1 minute' WHERE id=$1",
        )
        .bind(id)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
    }
    Ok(transitions)
}
