//! Optional, bounded in-app reminders; no WhatsApp or push delivery is initiated here.
use sqlx::{PgPool, Row};
use uuid::Uuid;

pub async fn tick(db: &PgPool, reminder_hours: i32) -> Result<usize, sqlx::Error> {
    let mut tx = db.begin().await?;
    // Lock both the request and identity row, so a concurrent conversion or
    // verification cannot race a reminder. SKIP LOCKED makes multiple workers safe.
    let rows = sqlx::query("SELECT r.id,r.customer_id FROM customer_provisional_requests r JOIN users u ON u.id=r.customer_id AND u.is_active AND u.role='customer' JOIN user_profiles p ON p.user_id=u.id WHERE r.status='PENDING_KYC' AND r.expires_at>NOW() AND r.reminded_at IS NULL AND r.created_at+make_interval(hours => $1::int)<=NOW() AND lower(p.kyc_status)<>'verified' ORDER BY r.created_at LIMIT 50 FOR UPDATE OF r,p SKIP LOCKED")
        .bind(reminder_hours.clamp(1, 720)).fetch_all(&mut *tx).await?;
    for row in &rows {
        let id: Uuid = row.get("id");
        let customer: Uuid = row.get("customer_id");
        sqlx::query("UPDATE customer_provisional_requests SET reminded_at=NOW() WHERE id=$1")
            .bind(id)
            .execute(&mut *tx)
            .await?;
        sqlx::query("INSERT INTO notifications(user_id,title,body,notification_type,reference_id) VALUES($1,'Provisional request reminder','Open My Orders to review your request and complete verification before placing an order.','provisional_reminder',$2)")
            .bind(customer).bind(id.to_string()).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(rows.len())
}
