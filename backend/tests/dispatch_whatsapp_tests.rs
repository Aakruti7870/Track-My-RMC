//! Tests never call Meta or need provider credentials.
use sqlx::PgPool;
use trackmyrmc_backend::services::{dispatch_marketing, dispatch_whatsapp};
use uuid::Uuid;

async fn fixture(db: &PgPool) -> (Uuid, Uuid, Uuid, Uuid) {
    let owner: Uuid = sqlx::query_scalar(
        "INSERT INTO users(phone,hashed_password,full_name,role)
         VALUES($1,'unused','Test Plant Owner','owner') RETURNING id",
    )
    .bind(format!("o-{}", Uuid::new_v4().simple()))
    .fetch_one(db)
    .await
    .unwrap();
    let customer: Uuid = sqlx::query_scalar(
        "INSERT INTO users(phone,hashed_password,full_name,role)
         VALUES($1,'unused','Test Customer','customer') RETURNING id",
    )
    .bind(format!("c-{}", Uuid::new_v4().simple()))
    .fetch_one(db)
    .await
    .unwrap();
    let driver: Uuid = sqlx::query_scalar(
        "INSERT INTO users(phone,hashed_password,full_name,role)
         VALUES($1,'unused','Test Driver','driver') RETURNING id",
    )
    .bind(format!("d-{}", Uuid::new_v4().simple()))
    .fetch_one(db)
    .await
    .unwrap();
    let plant: Uuid = sqlx::query_scalar(
        "INSERT INTO rmc_plants
           (owner_id,name,code,latitude,longitude,address_line,city,state,pincode,contact_phone)
         VALUES($1,'Test RMC',$2,19,73,'Location','Panvel','Maharashtra','410206','0000000000')
         RETURNING id",
    )
    .bind(owner)
    .bind(Uuid::new_v4().simple().to_string()[..14].to_string())
    .fetch_one(db)
    .await
    .unwrap();
    let site: Uuid = sqlx::query_scalar(
        "INSERT INTO customer_sites
           (customer_id,name,address_line,city,state,pincode,latitude,longitude,contact_person,contact_phone)
         VALUES($1,'Site','Address','Panvel','Maharashtra','410206',19,73,'Buyer','9876543210')
         RETURNING id",
    )
    .bind(customer)
    .fetch_one(db)
    .await
    .unwrap();
    let order: Uuid = sqlx::query_scalar(
        "INSERT INTO orders
           (order_number,customer_id,plant_id,site_id,concrete_grade,total_quantity_m3,
            delivery_date,delivery_time_slot,total_amount,status)
         VALUES($1,$2,$3,$4,'M30',6,CURRENT_DATE,'12:00',18000,'produced')
         RETURNING id",
    )
    .bind(Uuid::new_v4().simple().to_string())
    .bind(customer)
    .bind(plant)
    .bind(site)
    .fetch_one(db)
    .await
    .unwrap();
    let mixer: Uuid = sqlx::query_scalar(
        "INSERT INTO transit_mixers (plant_id,registration_number,driver_id,capacity_m3)
         VALUES($1,$2,$3,6) RETURNING id",
    )
    .bind(plant)
    .bind(format!("MH-{}", Uuid::new_v4().simple()))
    .bind(driver)
    .fetch_one(db)
    .await
    .unwrap();
    let load: Uuid = sqlx::query_scalar(
        "INSERT INTO order_loads(order_id,load_number,mixer_id,driver_id,quantity_m3,status)
         VALUES($1,1,$2,$3,6,'ready_to_dispatch') RETURNING id",
    )
    .bind(order)
    .bind(mixer)
    .bind(driver)
    .fetch_one(db)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO challans
           (load_id,challan_number,plant_code,customer_name,site_address,
            concrete_grade,quantity_m3,mixer_number,driver_name)
         VALUES($1,$2,$3,'Customer','Site','M30',6,'MH-TEST','Driver')",
    )
    .bind(load)
    .bind(format!("CH-{}", Uuid::new_v4().simple()))
    .bind(Uuid::new_v4().simple().to_string()[..14].to_string())
    .execute(db)
    .await
    .unwrap();
    (plant, customer, order, load)
}

#[sqlx::test]
async fn challan_prepares_both_outboxes_without_sending(db: PgPool) {
    let (_, _, order, load) = fixture(&db).await;
    let mut tx = db.begin().await.unwrap();
    dispatch_whatsapp::prepare_in_tx(&mut tx, load).await.unwrap();
    dispatch_whatsapp::prepare_in_tx(&mut tx, load).await.unwrap();
    dispatch_marketing::prepare_in_tx(&mut tx, load).await.unwrap();
    dispatch_marketing::prepare_in_tx(&mut tx, load).await.unwrap();
    tx.commit().await.unwrap();

    let utility_status: String = sqlx::query_scalar(
        "SELECT status FROM dispatch_whatsapp_events WHERE load_id=$1",
    )
    .bind(load)
    .fetch_one(&db)
    .await
    .unwrap();
    let promo_status: String = sqlx::query_scalar(
        "SELECT status FROM dispatch_whatsapp_marketing_events WHERE order_id=$1",
    )
    .bind(order)
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(utility_status, "waiting_dispatch");
    assert_eq!(promo_status, "waiting_dispatch");
}

#[sqlx::test]
async fn dispatch_activates_both_events_once_with_separate_consent(db: PgPool) {
    let (plant, customer, order, load) = fixture(&db).await;
    sqlx::query(
        "INSERT INTO dispatch_whatsapp_contacts
           (order_id,phone_e164,opted_in,marketing_opted_in,consent_source,consent_actor_id)
         VALUES($1,'+919876543210',TRUE,FALSE,'customer_app',$2)",
    )
    .bind(order)
    .bind(customer)
    .execute(&db)
    .await
    .unwrap();

    let mut tx = db.begin().await.unwrap();
    dispatch_whatsapp::prepare_in_tx(&mut tx, load).await.unwrap();
    dispatch_marketing::prepare_in_tx(&mut tx, load).await.unwrap();
    // A premature dispatch activation cannot send anything.
    dispatch_whatsapp::activate_on_dispatch_in_tx(&mut tx, load)
        .await.unwrap();
    dispatch_marketing::activate_on_dispatch_in_tx(&mut tx, load)
        .await.unwrap();
    tx.commit().await.unwrap();

    let before: String = sqlx::query_scalar(
        "SELECT status FROM dispatch_whatsapp_events WHERE load_id=$1",
    )
    .bind(load)
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(before, "waiting_dispatch");

    sqlx::query(
        "UPDATE order_loads SET status='dispatched',dispatched_at=NOW() WHERE id=$1",
    )
    .bind(load)
    .execute(&db)
    .await
    .unwrap();
    let mut tx = db.begin().await.unwrap();
    dispatch_whatsapp::activate_on_dispatch_in_tx(&mut tx, load)
        .await.unwrap();
    dispatch_marketing::activate_on_dispatch_in_tx(&mut tx, load)
        .await.unwrap();
    dispatch_whatsapp::activate_on_dispatch_in_tx(&mut tx, load)
        .await.unwrap();
    dispatch_marketing::activate_on_dispatch_in_tx(&mut tx, load)
        .await.unwrap();
    tx.commit().await.unwrap();

    let utility: String = sqlx::query_scalar(
        "SELECT status FROM dispatch_whatsapp_events WHERE load_id=$1",
    )
    .bind(load)
    .fetch_one(&db)
    .await
    .unwrap();
    let marketing: String = sqlx::query_scalar(
        "SELECT status FROM dispatch_whatsapp_marketing_events WHERE order_id=$1",
    )
    .bind(order)
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(utility, "pending");
    assert_eq!(marketing, "needs_consent");

    let event_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM dispatch_whatsapp_events WHERE plant_id=$1",
    )
    .bind(plant)
    .fetch_one(&db)
    .await
    .unwrap();
    let promo_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM dispatch_whatsapp_marketing_events WHERE plant_id=$1",
    )
    .bind(plant)
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!((event_count, promo_count), (1, 1));
}
