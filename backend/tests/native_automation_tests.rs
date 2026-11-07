//! PostgreSQL integration tests for the first native automation slice.
use sqlx::{PgPool, Row};
use trackmyrmc_backend::services::native_automation::{enqueue_order_decision, tick};
use uuid::Uuid;

async fn user(db: &PgPool, role: &str) -> Uuid {
    sqlx::query_scalar(
        "INSERT INTO users(phone,hashed_password,full_name,role)
         VALUES($1,'unused','Native automation fixture',$2) RETURNING id",
    )
    .bind(Uuid::new_v4().simple().to_string()[..18].to_string())
    .bind(role)
    .fetch_one(db)
    .await
    .unwrap()
}

async fn order(db: &PgPool, owner: Uuid, customer: Uuid) -> (Uuid, Uuid) {
    let plant: Uuid = sqlx::query_scalar(
        "INSERT INTO rmc_plants(owner_id,name,code,latitude,longitude,address_line,city,state,pincode,contact_phone)
         VALUES($1,'Automation Test Plant',$2,19,73,'Test','Panvel','Maharashtra','410206','0000000000') RETURNING id",
    )
    .bind(owner)
    .bind(Uuid::new_v4().simple().to_string()[..14].to_string())
    .fetch_one(db)
    .await
    .unwrap();
    let site: Uuid = sqlx::query_scalar(
        "INSERT INTO customer_sites(customer_id,name,address_line,city,state,pincode,latitude,longitude,contact_person,contact_phone)
         VALUES($1,'Site','Address','Panvel','Maharashtra','410206',19,73,'Customer','0000000000') RETURNING id",
    )
    .bind(customer)
    .fetch_one(db)
    .await
    .unwrap();
    let id: Uuid = sqlx::query_scalar(
        "INSERT INTO orders(order_number,customer_id,plant_id,site_id,
           concrete_grade,total_quantity_m3,delivery_date,delivery_time_slot,total_amount,status)
         VALUES($1,$2,$3,$4,'M25',6,CURRENT_DATE,'10:00',100,'pending') RETURNING id",
    )
    .bind(Uuid::new_v4().simple().to_string())
    .bind(customer)
    .bind(plant)
    .bind(site)
    .fetch_one(db)
    .await
    .unwrap();
    (plant, id)
}

#[sqlx::test]
async fn disabled_by_default_and_unique_order_events(db: PgPool) {
    let owner = user(&db, "owner").await;
    let customer = user(&db, "customer").await;
    let (_, order_id) = order(&db, owner, customer).await;
    let mut tx = db.begin().await.unwrap();
    enqueue_order_decision(&mut tx, order_id, "confirmed").await.unwrap();
    enqueue_order_decision(&mut tx, order_id, "confirmed").await.unwrap();
    enqueue_order_decision(&mut tx, order_id, "paid").await.unwrap();
    tx.commit().await.unwrap();

    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM native_automation_jobs")
        .fetch_one(&db).await.unwrap();
    assert_eq!(count, 1);
    assert_eq!(tick(&db).await.unwrap(), 0);
    let row = sqlx::query(
        "SELECT status,attempts FROM native_automation_jobs WHERE order_id=$1",
    )
    .bind(order_id)
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(row.get::<String, _>("status"), "SKIPPED");
    assert_eq!(row.get::<i32, _>("attempts"), 1);
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM notifications")
            .fetch_one(&db).await.unwrap(),
        0
    );
}

#[sqlx::test]
async fn enabled_rules_deliver_once_under_concurrent_workers(db: PgPool) {
    let owner = user(&db, "owner").await;
    let customer = user(&db, "customer").await;
    let (plant, order_id) = order(&db, owner, customer).await;

    sqlx::query(
        "UPDATE native_automation_templates
         SET published=TRUE,globally_paused=FALSE
         WHERE template_key='ORDER_ACCEPTED_NOTICE'",
    )
    .execute(&db)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO native_automation_plant_rules(plant_id,template_key,enabled,updated_by)
         VALUES($1,'ORDER_ACCEPTED_NOTICE',TRUE,$2)",
    )
    .bind(plant)
    .bind(owner)
    .execute(&db)
    .await
    .unwrap();

    let mut tx = db.begin().await.unwrap();
    sqlx::query("UPDATE orders SET status='confirmed' WHERE id=$1")
        .bind(order_id).execute(&mut *tx).await.unwrap();
    enqueue_order_decision(&mut tx, order_id, "confirmed").await.unwrap();
    tx.commit().await.unwrap();

    let (a, b) = tokio::join!(tick(&db), tick(&db));
    assert_eq!(a.unwrap() + b.unwrap(), 1);
    assert_eq!(tick(&db).await.unwrap(), 0);

    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM notifications WHERE user_id=$1
         AND notification_type='order_status' AND reference_id=$2",
    )
    .bind(customer)
    .bind(order_id.to_string())
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(count, 1);
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM native_automation_attempts
         WHERE outcome='COMPLETED'",
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(count, 1);
}

#[sqlx::test]
async fn another_plants_opt_in_cannot_enable_my_plant(db: PgPool) {
    let first_owner = user(&db, "owner").await;
    let second_owner = user(&db, "owner").await;
    let customer = user(&db, "customer").await;
    let (my_plant, my_order) = order(&db, first_owner, customer).await;
    let (other_plant, _) = order(&db, second_owner, customer).await;

    sqlx::query(
        "UPDATE native_automation_templates
         SET published=TRUE,globally_paused=FALSE
         WHERE template_key='ORDER_ACCEPTED_NOTICE'",
    )
    .execute(&db)
    .await.unwrap();
    sqlx::query(
        "INSERT INTO native_automation_plant_rules(plant_id,template_key,enabled,updated_by)
         VALUES($1,'ORDER_ACCEPTED_NOTICE',TRUE,$2)",
    )
    .bind(other_plant)
    .bind(second_owner)
    .execute(&db)
    .await.unwrap();

    let mut tx = db.begin().await.unwrap();
    enqueue_order_decision(&mut tx, my_order, "confirmed").await.unwrap();
    tx.commit().await.unwrap();
    assert_eq!(tick(&db).await.unwrap(), 0);
    let notified: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM native_automation_jobs
         WHERE plant_id=$1 AND status='SKIPPED'",
    )
    .bind(my_plant)
    .fetch_one(&db).await.unwrap();
    assert_eq!(notified, 1);
}
