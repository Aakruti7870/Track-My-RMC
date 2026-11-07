//! TrackMyRMC-owned cross-domain automation.
//! Typed, fixed internal workflows: no scripts, HTTP steps, external engines
//! or business mutations. Central policy + owner opt-in control every action.
use sqlx::{PgPool, Postgres, Row, Transaction};
use uuid::Uuid;

pub const DISPATCH: &str = "DISPATCH_UNASSIGNED_LOAD";
pub const RFQ: &str = "RFQ_PENDING_PLANT";
pub const QUALITY: &str = "QUALITY_INSPECTION_FAILED";
pub const INVENTORY: &str = "INVENTORY_BELOW_MIN";
pub const WORKFORCE: &str = "WORKFORCE_LEAVE_PENDING";

/// Enumerate due records, never contact unapproved suppliers. Unique event
/// keys and the NOT EXISTS filter keep this bounded even for historical data.
pub async fn scan_due(db: &PgPool) -> Result<u64, sqlx::Error> {
    let result = sqlx::query(
        "WITH events AS (
           SELECT 'DISPATCH_UNASSIGNED_LOAD'::text AS template_key,
                  o.plant_id,l.id AS entity_id,
                  'dispatch-unassigned:'||l.id::text AS event_key
           FROM order_loads l JOIN orders o ON o.id=l.order_id
           WHERE l.status='planned' AND (l.driver_id IS NULL OR l.mixer_id IS NULL)
             AND o.status NOT IN ('cancelled','rejected','delivered','completed')
             AND l.created_at<=NOW()-INTERVAL '15 minutes'
           UNION ALL
           SELECT 'RFQ_PENDING_PLANT',q.plant_id,q.id,'rfq-pending:'||q.id::text
           FROM customer_quotation_requests q
           WHERE q.status='PENDING' AND q.created_at<=NOW()-INTERVAL '15 minutes'
             AND q.required_date>=CURRENT_DATE
             AND EXISTS(SELECT 1 FROM plant_listing_requests a
                        WHERE a.plant_id=q.plant_id AND a.status='APPROVED')
           UNION ALL
           SELECT 'QUALITY_INSPECTION_FAILED',o.plant_id,q.id,'quality-fail:'||q.id::text
           FROM cube_tests q JOIN orders o ON o.id=q.order_id
           WHERE q.record_source='ENGINEER_INSPECTION' AND q.result='FAIL'
             AND q.passed=FALSE
           UNION ALL
           SELECT 'INVENTORY_BELOW_MIN',m.plant_id,m.id,
                  'low-stock:'||m.id::text||':'||CURRENT_DATE::text
           FROM plant_materials m
           WHERE m.minimum_stock>0 AND m.current_stock<=m.minimum_stock
             AND m.updated_at<=NOW()-INTERVAL '15 minutes'
           UNION ALL
           SELECT 'WORKFORCE_LEAVE_PENDING',l.plant_id,l.id,
                  'leave-pending:'||l.id::text
           FROM workforce_leave_requests l
           JOIN plant_staff ps ON ps.plant_id=l.plant_id AND ps.user_id=l.user_id
             AND ps.is_active AND ps.removed_at IS NULL AND ps.employment_status='ACTIVE'
           JOIN users employee ON employee.id=l.user_id
             AND employee.is_active AND employee.role=ps.role
           WHERE l.status='PENDING' AND l.created_at<=NOW()-INTERVAL '15 minutes'
         )
         INSERT INTO native_automation_jobs
             (event_key,plant_id,domain_entity_id,template_key)
         SELECT e.event_key,e.plant_id,e.entity_id,e.template_key
         FROM events e
         JOIN rmc_plants p ON p.id=e.plant_id AND p.is_active
         JOIN users owner ON owner.id=p.owner_id AND owner.is_active
         JOIN native_automation_plant_rules r
           ON r.plant_id=e.plant_id AND r.template_key=e.template_key AND r.enabled
         JOIN native_automation_templates t ON t.template_key=e.template_key
           AND t.published AND NOT t.globally_paused
           AND t.action_type='CREATE_DOMAIN_REVIEW' AND t.conditions='{}'::jsonb
         WHERE NOT EXISTS(SELECT 1 FROM native_automation_jobs j
                          WHERE j.event_key=e.event_key)
           AND NOT EXISTS(SELECT 1 FROM native_automation_domain_tasks d
               WHERE d.plant_id=e.plant_id AND d.template_key=e.template_key
                 AND d.domain_entity_id=e.entity_id AND d.status IN ('OPEN','ACKNOWLEDGED'))
         ORDER BY e.template_key,e.event_key LIMIT 150
         ON CONFLICT(event_key) DO NOTHING",
    )
    .execute(db)
    .await?;
    Ok(result.rows_affected())
}

fn presentation(kind: &str) -> Option<(&'static str, &'static str, &'static str)> {
    match kind {
        DISPATCH => Some((
            "Dispatch assignment needed",
            "A planned load still requires a mixer or driver assignment.",
            "dispatch_review",
        )),
        RFQ => Some((
            "Quotation response pending",
            "An approved-plant quotation request is awaiting your review.",
            "rfq_review",
        )),
        QUALITY => Some((
            "Engineer inspection failed",
            "A Quality Engineer recorded a failed inspection. Review the evidence.",
            "quality_review",
        )),
        INVENTORY => Some((
            "Low material stock",
            "Material is at or below the reorder level. Review stock manually.",
            "inventory_review",
        )),
        WORKFORCE => Some((
            "Leave request pending",
            "An active employee leave request needs an authorized decision.",
            "workforce_review",
        )),
        _ => None,
    }
}

/// Check the current tenant-scoped business record under share locks. Tasks
/// cannot be generated against stale, completed or cross-plant records.
async fn source_is_actionable(
    tx: &mut Transaction<'_, Postgres>,
    kind: &str,
    plant: Uuid,
    entity: Uuid,
) -> Result<bool, sqlx::Error> {
    let query = match kind {
        DISPATCH => {
            "SELECT l.id FROM order_loads l JOIN orders o ON o.id=l.order_id
                     WHERE l.id=$1 AND o.plant_id=$2 AND l.status='planned'
                       AND (l.driver_id IS NULL OR l.mixer_id IS NULL)
                       AND o.status NOT IN ('cancelled','rejected','delivered','completed')
                     FOR SHARE OF l,o"
        }
        RFQ => {
            "SELECT q.id FROM customer_quotation_requests q
                WHERE q.id=$1 AND q.plant_id=$2 AND q.status='PENDING'
                  AND q.required_date>=CURRENT_DATE
                  AND EXISTS(SELECT 1 FROM plant_listing_requests a
                             WHERE a.plant_id=q.plant_id AND a.status='APPROVED')
                FOR SHARE OF q"
        }
        QUALITY => {
            "SELECT q.id FROM cube_tests q JOIN orders o ON o.id=q.order_id
                    WHERE q.id=$1 AND o.plant_id=$2 AND q.result='FAIL'
                      AND q.passed=FALSE AND q.record_source='ENGINEER_INSPECTION'
                    FOR SHARE OF q,o"
        }
        INVENTORY => {
            "SELECT m.id FROM plant_materials m
                      WHERE m.id=$1 AND m.plant_id=$2 AND m.minimum_stock>0
                        AND m.current_stock<=m.minimum_stock
                      FOR SHARE OF m"
        }
        WORKFORCE => {
            "SELECT l.id FROM workforce_leave_requests l
                      JOIN plant_staff s ON s.plant_id=l.plant_id AND s.user_id=l.user_id
                        AND s.is_active AND s.removed_at IS NULL AND s.employment_status='ACTIVE'
                      JOIN users u ON u.id=l.user_id AND u.is_active AND u.role=s.role
                      WHERE l.id=$1 AND l.plant_id=$2 AND l.status='PENDING'
                      FOR SHARE OF l,s,u"
        }
        _ => return Ok(false),
    };
    let found: Option<Uuid> = sqlx::query_scalar(query)
        .bind(entity)
        .bind(plant)
        .fetch_optional(&mut **tx)
        .await?;
    Ok(found.is_some())
}

async fn record(
    tx: &mut Transaction<'_, Postgres>,
    id: Uuid,
    attempt: i32,
    status: &str,
    detail: Option<&str>,
    notification: Option<Uuid>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE native_automation_jobs
         SET status=$2,attempts=$3,last_error=$4,notification_id=$5,updated_at=NOW()
         WHERE id=$1",
    )
    .bind(id)
    .bind(status)
    .bind(attempt)
    .bind(detail)
    .bind(notification)
    .execute(&mut **tx)
    .await?;
    sqlx::query(
        "INSERT INTO native_automation_attempts(job_id,attempt,outcome,detail)
         VALUES($1,$2,$3,$4)",
    )
    .bind(id)
    .bind(attempt)
    .bind(status)
    .bind(detail)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// Process max 25 domain jobs. PostgreSQL row locks and transactional task
/// + notification insertion provide exactly-once internal effects per event.
pub async fn tick(db: &PgPool) -> Result<usize, sqlx::Error> {
    scan_due(db).await?;
    let mut processed = 0;
    for _ in 0..25 {
        let mut tx = db.begin().await?;
        let maybe = sqlx::query(
            "SELECT id,plant_id,domain_entity_id,template_key,attempts,max_attempts
             FROM native_automation_jobs
             WHERE domain_entity_id IS NOT NULL
               AND status IN ('PENDING','RETRY') AND available_at<=NOW()
             ORDER BY available_at,id LIMIT 1 FOR UPDATE SKIP LOCKED",
        )
        .fetch_optional(&mut *tx)
        .await?;
        let Some(row) = maybe else {
            tx.commit().await?;
            break;
        };
        let id: Uuid = row.get("id");
        let plant: Uuid = row.get("plant_id");
        let entity: Uuid = row.get("domain_entity_id");
        let kind: String = row.get("template_key");
        let attempts: i32 = row.get::<i32, _>("attempts") + 1;
        let max_attempts: i32 = row.get("max_attempts");

        // Lock current global policy, plant preference, plant and active
        // owner until task + notification commit; revoke/disable fails closed.
        let owner: Option<Uuid> = sqlx::query_scalar(
            "SELECT p.owner_id FROM native_automation_templates t
             JOIN native_automation_plant_rules r ON r.template_key=t.template_key
             JOIN rmc_plants p ON p.id=r.plant_id
             JOIN users u ON u.id=p.owner_id AND u.is_active
             WHERE t.template_key=$1 AND r.plant_id=$2 AND r.enabled
               AND t.published AND NOT t.globally_paused AND p.is_active
               AND t.action_type='CREATE_DOMAIN_REVIEW'
               AND t.conditions='{}'::jsonb
             FOR SHARE OF t,r,p,u",
        )
        .bind(&kind)
        .bind(plant)
        .fetch_optional(&mut *tx)
        .await?;
        let Some(owner) = owner else {
            record(
                &mut tx,
                id,
                attempts,
                "SKIPPED",
                Some("policy_disabled"),
                None,
            )
            .await?;
            tx.commit().await?;
            continue;
        };
        let Some((title, body, notification_kind)) = presentation(&kind) else {
            record(
                &mut tx,
                id,
                attempts,
                "SKIPPED",
                Some("unknown_domain"),
                None,
            )
            .await?;
            tx.commit().await?;
            continue;
        };
        if !source_is_actionable(&mut tx, &kind, plant, entity).await? {
            record(
                &mut tx,
                id,
                attempts,
                "SKIPPED",
                Some("source_not_actionable"),
                None,
            )
            .await?;
            tx.commit().await?;
            continue;
        }
        sqlx::query("SAVEPOINT native_domain_delivery")
            .execute(&mut *tx)
            .await?;
        let delivered = async {
            sqlx::query(
                "INSERT INTO native_automation_domain_tasks
                 (source_job_id,plant_id,domain_entity_id,template_key,assigned_to,next_escalation_at)
                 SELECT $1,$2,$3,$4,$5,NOW()+(r.sla_minutes*INTERVAL '1 minute')
                 FROM native_automation_plant_rules r
                 WHERE r.plant_id=$2 AND r.template_key=$4 AND r.enabled
                 ON CONFLICT(source_job_id) DO NOTHING",
            )
            .bind(id)
            .bind(plant)
            .bind(entity)
            .bind(&kind)
            .bind(owner)
            .execute(&mut *tx)
            .await?;
            let notification: Uuid = sqlx::query_scalar(
                "INSERT INTO notifications
                 (user_id,title,body,notification_type,reference_id)
                 VALUES($1,$2,$3,$4,$5) RETURNING id",
            )
            .bind(owner)
            .bind(title)
            .bind(body)
            .bind(notification_kind)
            .bind(entity.to_string())
            .fetch_one(&mut *tx)
            .await?;
            Ok::<Uuid, sqlx::Error>(notification)
        }
        .await;
        match delivered {
            Ok(notification) => {
                record(&mut tx, id, attempts, "COMPLETED", None, Some(notification)).await?;
                processed += 1;
            }
            Err(err) => {
                sqlx::query("ROLLBACK TO SAVEPOINT native_domain_delivery")
                    .execute(&mut *tx)
                    .await?;
                let final_attempt = attempts >= max_attempts;
                let status = if final_attempt {
                    "DEAD_LETTER"
                } else {
                    "RETRY"
                };
                let safe_error = err
                    .as_database_error()
                    .and_then(|e| e.code())
                    .map_or_else(|| "delivery_error".to_string(), |s| s.to_string());
                record(&mut tx, id, attempts, status, Some(&safe_error), None).await?;
                if !final_attempt {
                    let seconds = (30_i64 * 2_i64.pow((attempts - 1).clamp(0, 7) as u32)).min(3600);
                    sqlx::query(
                        "UPDATE native_automation_jobs
                         SET available_at=NOW()+($2*INTERVAL '1 second') WHERE id=$1",
                    )
                    .bind(id)
                    .bind(seconds)
                    .execute(&mut *tx)
                    .await?;
                }
            }
        }
        tx.commit().await?;
    }
    let transitions = super::native_closed_loop::reconcile(db).await?;
    Ok(processed + transitions)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_five_native_domain_actions_are_allowed() {
        for name in [DISPATCH, RFQ, QUALITY, INVENTORY, WORKFORCE] {
            assert!(presentation(name).is_some());
        }
        assert!(presentation("HTTP_REQUEST").is_none());
    }
}
