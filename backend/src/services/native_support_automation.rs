//! Platform Customer Support SLA reminders, driven by the existing first-party
//! Rust/PostgreSQL worker. NEVER put customer tickets into plant-scoped domain
//! automation jobs: customers and platform staff are not plant tenants.
//!
//! All effects are internal web-staff notifications. No AI, WhatsApp/email
//! transmission, financial action, status mutation or automated customer reply.
//! The worker is inert unless BOTH NATIVE_AUTOMATION_WORKER_ENABLED=true and
//! NATIVE_SUPPORT_AUTOMATION_ENABLED=true are explicitly configured.
use chrono::Utc;
use sqlx::{PgPool, Postgres, Row, Transaction};
use uuid::Uuid;

const MAX_REMINDERS: i16 = 2;
const MAX_CASES_PER_TICK: usize = 10;

/// Internal first-response target only; no external service-level guarantee.
pub fn first_response_minutes(priority: &str) -> i32 {
    match priority {
        "high" => 30,
        "low" => 480,
        _ => 120,
    }
}

/// Call in the SAME transaction that creates the escalated customer support
/// ticket. A guidance-only request does not create a case or a follow-up.
pub async fn case_created(
    tx: &mut Transaction<'_, Postgres>,
    case_id: Uuid,
    priority: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO native_support_followups
         (case_id,cycle,awaiting_staff_reply,due_at,next_attempt_at,last_customer_message_at)
         VALUES($1,1,TRUE,
                NOW()+($2::integer * INTERVAL '1 minute'),
                NOW()+($2::integer * INTERVAL '1 minute'),NOW())
         ON CONFLICT(case_id) DO NOTHING",
    )
    .bind(case_id)
    .bind(first_response_minutes(priority))
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// Customers cannot defer an already-started SLA by sending repeated messages.
/// If a visible staff response already satisfied the prior cycle, the next
/// customer reply opens a fresh cycle, with a new bounded reminder budget.
pub async fn customer_replied(
    tx: &mut Transaction<'_, Postgres>,
    case_id: Uuid,
    priority: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO native_support_followups
         (case_id,cycle,awaiting_staff_reply,due_at,next_attempt_at,last_customer_message_at)
         VALUES($1,1,TRUE,
                NOW()+($2::integer * INTERVAL '1 minute'),
                NOW()+($2::integer * INTERVAL '1 minute'),NOW())
         ON CONFLICT(case_id) DO UPDATE SET
           cycle=CASE WHEN native_support_followups.awaiting_staff_reply
                      THEN native_support_followups.cycle
                      ELSE native_support_followups.cycle+1 END,
           awaiting_staff_reply=TRUE,
           due_at=CASE WHEN native_support_followups.awaiting_staff_reply
                       THEN native_support_followups.due_at ELSE EXCLUDED.due_at END,
           next_attempt_at=CASE WHEN native_support_followups.awaiting_staff_reply
                       THEN native_support_followups.next_attempt_at
                       ELSE EXCLUDED.next_attempt_at END,
           reminder_count=CASE WHEN native_support_followups.awaiting_staff_reply
                               THEN native_support_followups.reminder_count ELSE 0 END,
           last_customer_message_at=NOW(),updated_at=NOW()",
    )
    .bind(case_id)
    .bind(first_response_minutes(priority))
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// Internal notes do NOT count as customer-visible staff responses.
pub async fn staff_responded(
    tx: &mut Transaction<'_, Postgres>,
    case_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE native_support_followups
         SET awaiting_staff_reply=FALSE,due_at=NULL,next_attempt_at=NULL,
             last_staff_response_at=NOW(),
             updated_at=NOW()
         WHERE case_id=$1",
    )
    .bind(case_id)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

pub async fn case_closed(
    tx: &mut Transaction<'_, Postgres>,
    case_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE native_support_followups SET awaiting_staff_reply=FALSE,
         due_at=NULL,next_attempt_at=NULL,updated_at=NOW() WHERE case_id=$1",
    )
    .bind(case_id)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// Only a privileged, audited reopen after RESOLVED/CLOSED re-arms this cycle.
pub async fn case_reopened(
    tx: &mut Transaction<'_, Postgres>,
    case_id: Uuid,
    priority: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO native_support_followups
         (case_id,cycle,awaiting_staff_reply,due_at,next_attempt_at)
         VALUES($1,1,TRUE,
                NOW()+($2::integer * INTERVAL '1 minute'),
                NOW()+($2::integer * INTERVAL '1 minute'))
         ON CONFLICT(case_id) DO UPDATE SET
           cycle=native_support_followups.cycle+1,
           awaiting_staff_reply=TRUE,due_at=EXCLUDED.due_at,
           next_attempt_at=EXCLUDED.next_attempt_at,
           reminder_count=0,updated_at=NOW()",
    )
    .bind(case_id)
    .bind(first_response_minutes(priority))
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// Due support tickets stay inside the PLATFORM trust boundary; only approved,
/// currently active web privileged users with BOTH support.view and
/// support.reply are eligible. Source case first, then follow-up row: this
/// lock order matches reply/status handlers and prevents deadlocks.
/// All notification/evidence writes commit atomically under the case lock.
pub async fn tick(db: &PgPool) -> Result<usize, sqlx::Error> {
    let mut reminded = 0usize;
    for _ in 0..MAX_CASES_PER_TICK {
        let mut tx = db.begin().await?;
        let case_id: Option<Uuid> = sqlx::query_scalar(
            "SELECT c.id FROM support_cases c
             JOIN native_support_followups f ON f.case_id=c.id
             WHERE upper(c.status) IN ('OPEN','IN_PROGRESS')
               AND f.awaiting_staff_reply AND f.reminder_count<2
               AND f.due_at IS NOT NULL AND f.due_at<=NOW()
               AND f.next_attempt_at IS NOT NULL AND f.next_attempt_at<=NOW()
             ORDER BY f.next_attempt_at,c.id LIMIT 1 FOR UPDATE OF c SKIP LOCKED",
        )
        .fetch_optional(&mut *tx)
        .await?;
        let Some(case_id) = case_id else {
            tx.commit().await?;
            break;
        };

        // A customer/staff action may have committed just before we acquired
        // the case lock. Re-read the fresh follow-up state under its own lock.
        let row = sqlx::query(
            "SELECT cycle,awaiting_staff_reply,due_at,next_attempt_at,reminder_count
             FROM native_support_followups WHERE case_id=$1 FOR UPDATE",
        )
        .bind(case_id)
        .fetch_one(&mut *tx)
        .await?;
        let cycle: i64 = row.get("cycle");
        let pending: bool = row.get("awaiting_staff_reply");
        let due: Option<chrono::DateTime<Utc>> = row.get("due_at");
        let next_attempt: Option<chrono::DateTime<Utc>> = row.get("next_attempt_at");
        let reminders: i16 = row.get("reminder_count");
        if !pending
            || reminders >= MAX_REMINDERS
            || due.is_none_or(|at| at > Utc::now())
            || next_attempt.is_none_or(|at| at > Utc::now())
        {
            tx.commit().await?;
            continue;
        }

        // Hold staff identity/approval SHARE locks until notification commits.
        // Owners, customers, unapproved Authority, and view-only personnel
        // cannot receive platform-private follow-up alerts.
        let recipients: Vec<Uuid> = sqlx::query_scalar(
            "SELECT u.id FROM users u
             JOIN control_center_access a ON a.user_id=u.id
             WHERE u.is_active AND u.role IN ('central_admin','authority')
               AND a.approved
               AND 'support.view'=ANY(a.permissions)
               AND 'support.reply'=ANY(a.permissions)
             ORDER BY u.id LIMIT 20 FOR SHARE OF u,a",
        )
        .fetch_all(&mut *tx)
        .await?;

        if recipients.is_empty() {
            // There is no verified operator to act on this case. Do not
            // fabricate a delivered reminder or consume the bounded budget.
            sqlx::query(
                "UPDATE native_support_followups
                 SET next_attempt_at=NOW()+INTERVAL '15 minutes',updated_at=NOW()
                 WHERE case_id=$1",
            )
            .bind(case_id)
            .execute(&mut *tx)
            .await?;
            tx.commit().await?;
            continue;
        }

        let next_reminder = reminders + 1;
        sqlx::query(
            "INSERT INTO notifications
             (user_id,title,body,notification_type,reference_id)
             SELECT recipients.staff_id,'Customer support follow-up due',
               'A customer support case needs a staff reply. Review it in the secure web dashboard.',
               'support_followup',$2
             FROM unnest($1::uuid[]) AS recipients(staff_id)",
        )
        .bind(&recipients)
        .bind(case_id.to_string())
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "INSERT INTO native_support_followup_events
             (case_id,cycle,reminder_number,recipient_count) VALUES($1,$2,$3,$4)",
        )
        .bind(case_id)
        .bind(cycle)
        .bind(next_reminder)
        .bind(recipients.len() as i32)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "UPDATE native_support_followups SET reminder_count=$2,
             next_attempt_at=CASE WHEN $2 < 2 THEN NOW()+INTERVAL '60 minutes'
                                  ELSE NULL END,
             last_reminder_at=NOW(),updated_at=NOW()
             WHERE case_id=$1 AND cycle=$3",
        )
        .bind(case_id)
        .bind(next_reminder)
        .bind(cycle)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "INSERT INTO audit_logs(action,resource_type,resource_id,metadata)
             VALUES('support.automation.reminder','support_case',$1,
                    jsonb_build_object('cycle',$2::bigint,
                                       'reminder_number',$3::smallint,
                                       'recipient_count',$4::integer))",
        )
        .bind(case_id.to_string())
        .bind(cycle)
        .bind(next_reminder)
        .bind(recipients.len() as i32)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        reminded += 1;
    }
    Ok(reminded)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn priority_targets_are_internal_and_bounded() {
        assert_eq!(first_response_minutes("high"), 30);
        assert_eq!(first_response_minutes("normal"), 120);
        assert_eq!(first_response_minutes("low"), 480);
    }

    #[sqlx::test]
    async fn due_ticket_notifies_only_approved_web_support_staff_once(db: PgPool) {
        let customer: Uuid = sqlx::query_scalar(
            "INSERT INTO users(phone,hashed_password,full_name,role)
             VALUES($1,'unused','Support customer','customer') RETURNING id",
        )
        .bind(format!("s{}", &Uuid::new_v4().simple().to_string()[..12]))
        .fetch_one(&db)
        .await
        .unwrap();
        let privileged: Uuid = sqlx::query_scalar(
            "INSERT INTO users(phone,hashed_password,full_name,role)
             VALUES($1,'unused','Support operator','central_admin') RETURNING id",
        )
        .bind(format!("p{}", &Uuid::new_v4().simple().to_string()[..12]))
        .fetch_one(&db)
        .await
        .unwrap();
        let unapproved: Uuid = sqlx::query_scalar(
            "INSERT INTO users(phone,hashed_password,full_name,role)
             VALUES($1,'unused','Unapproved operator','authority') RETURNING id",
        )
        .bind(format!("u{}", &Uuid::new_v4().simple().to_string()[..12]))
        .fetch_one(&db)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO control_center_access(user_id,approved,permissions)
             VALUES ($1,TRUE,ARRAY['support.view','support.reply']),
                    ($2,FALSE,ARRAY['support.view','support.reply'])",
        )
        .bind(privileged)
        .bind(unapproved)
        .execute(&db)
        .await
        .unwrap();
        let case_id: Uuid = sqlx::query_scalar(
            "INSERT INTO support_cases(user_id,subject,category,priority,status)
             VALUES($1,'Ticket with sensitive details','GENERAL','high','OPEN')
             RETURNING id",
        )
        .bind(customer)
        .fetch_one(&db)
        .await
        .unwrap();

        let mut tx = db.begin().await.unwrap();
        case_created(&mut tx, case_id, "high").await.unwrap();
        tx.commit().await.unwrap();
        sqlx::query(
            "UPDATE native_support_followups
             SET due_at=NOW()-INTERVAL '1 minute',
                 next_attempt_at=NOW()-INTERVAL '1 minute'
             WHERE case_id=$1",
        )
        .bind(case_id)
        .execute(&db)
        .await
        .unwrap();

        // No approved staff means NO delivered event, but overdue must
        // remain overdue. Only a separate retry timer may advance.
        sqlx::query("UPDATE control_center_access SET approved=FALSE WHERE user_id=$1")
            .bind(privileged)
            .execute(&db)
            .await
            .unwrap();
        assert_eq!(tick(&db).await.unwrap(), 0);
        let no_operator: (bool, bool, i16) = sqlx::query_as(
            "SELECT due_at<NOW(),next_attempt_at>NOW(),reminder_count
             FROM native_support_followups WHERE case_id=$1",
        )
        .bind(case_id)
        .fetch_one(&db)
        .await
        .unwrap();
        assert_eq!(no_operator, (true, true, 0));
        sqlx::query("UPDATE control_center_access SET approved=TRUE WHERE user_id=$1")
            .bind(privileged)
            .execute(&db)
            .await
            .unwrap();
        sqlx::query(
            "UPDATE native_support_followups
             SET next_attempt_at=NOW()-INTERVAL '1 minute' WHERE case_id=$1",
        )
        .bind(case_id)
        .execute(&db)
        .await
        .unwrap();

        let (first, second) = tokio::join!(tick(&db), tick(&db));
        assert_eq!(first.unwrap() + second.unwrap(), 1);
        let notifications: Vec<(Uuid, String)> = sqlx::query_as(
            "SELECT user_id,body FROM notifications WHERE notification_type='support_followup'",
        )
        .fetch_all(&db)
        .await
        .unwrap();
        assert_eq!(notifications.len(), 1);
        assert_eq!(notifications[0].0, privileged);
        assert!(!notifications[0].1.contains("sensitive"));
        assert_eq!(tick(&db).await.unwrap(), 0);

        sqlx::query(
            "UPDATE native_support_followups
             SET due_at=NOW()-INTERVAL '1 minute',
                 next_attempt_at=NOW()-INTERVAL '1 minute'
             WHERE case_id=$1",
        )
        .bind(case_id)
        .execute(&db)
        .await
        .unwrap();
        assert_eq!(tick(&db).await.unwrap(), 1);
        assert_eq!(tick(&db).await.unwrap(), 0);
        let summary: (i16, Option<chrono::DateTime<Utc>>, Option<chrono::DateTime<Utc>>) =
            sqlx::query_as(
                "SELECT reminder_count,due_at,next_attempt_at FROM native_support_followups WHERE case_id=$1",
            )
        .bind(case_id)
        .fetch_one(&db)
        .await
        .unwrap();
        assert_eq!(summary.0, 2);
        assert!(
            summary.1.is_some(),
            "the missed response deadline is retained"
        );
        assert!(summary.2.is_none(), "the two-reminder budget is exhausted");
        let events: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM native_support_followup_events WHERE case_id=$1",
        )
        .bind(case_id)
        .fetch_one(&db)
        .await
        .unwrap();
        assert_eq!(events, 2);
    }

    #[sqlx::test]
    async fn reply_reopens_after_staff_response_but_not_after_customer_spam(db: PgPool) {
        let customer: Uuid = sqlx::query_scalar(
            "INSERT INTO users(phone,hashed_password,full_name,role)
             VALUES($1,'unused','Customer','customer') RETURNING id",
        )
        .bind(format!("z{}", &Uuid::new_v4().simple().to_string()[..12]))
        .fetch_one(&db)
        .await
        .unwrap();
        let case_id: Uuid = sqlx::query_scalar(
            "INSERT INTO support_cases(user_id,subject,category,priority,status)
             VALUES($1,'Test','GENERAL','normal','OPEN') RETURNING id",
        )
        .bind(customer)
        .fetch_one(&db)
        .await
        .unwrap();
        let mut tx = db.begin().await.unwrap();
        case_created(&mut tx, case_id, "normal").await.unwrap();
        tx.commit().await.unwrap();

        let mut tx = db.begin().await.unwrap();
        customer_replied(&mut tx, case_id, "normal").await.unwrap();
        tx.commit().await.unwrap();
        let cycle: i64 =
            sqlx::query_scalar("SELECT cycle FROM native_support_followups WHERE case_id=$1")
                .bind(case_id)
                .fetch_one(&db)
                .await
                .unwrap();
        assert_eq!(cycle, 1);

        let mut tx = db.begin().await.unwrap();
        staff_responded(&mut tx, case_id).await.unwrap();
        customer_replied(&mut tx, case_id, "normal").await.unwrap();
        tx.commit().await.unwrap();
        let status: (i64, bool) = sqlx::query_as(
            "SELECT cycle,awaiting_staff_reply FROM native_support_followups WHERE case_id=$1",
        )
        .bind(case_id)
        .fetch_one(&db)
        .await
        .unwrap();
        assert_eq!(status, (2, true));

        let mut tx = db.begin().await.unwrap();
        case_closed(&mut tx, case_id).await.unwrap();
        tx.commit().await.unwrap();
        let mut tx = db.begin().await.unwrap();
        case_reopened(&mut tx, case_id, "normal").await.unwrap();
        tx.commit().await.unwrap();
        let status: (i64, bool) = sqlx::query_as(
            "SELECT cycle,awaiting_staff_reply FROM native_support_followups WHERE case_id=$1",
        )
        .bind(case_id)
        .fetch_one(&db)
        .await
        .unwrap();
        assert_eq!(status, (3, true));
    }
}
