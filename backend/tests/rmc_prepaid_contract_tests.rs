use sqlx::PgPool;
use uuid::Uuid;

async fn user(db: &PgPool, role: &str) -> Uuid {
    sqlx::query_scalar(
        "INSERT INTO users(phone,hashed_password,full_name,role) VALUES($1,'unused','Pay Test',$2) RETURNING id",
    )
    .bind(Uuid::new_v4().simple().to_string()[..18].to_string())
    .bind(role)
    .fetch_one(db)
    .await
    .unwrap()
}

#[sqlx::test]
async fn seller_must_be_independently_verified_and_one_gateway_order_per_offer(db: PgPool) {
    let customer = user(&db, "customer").await;
    let owner = user(&db, "owner").await;
    let plant: Uuid = sqlx::query_scalar(
        "INSERT INTO rmc_plants(owner_id,name,code,latitude,longitude,address_line,city,state,pincode,contact_phone) \
         VALUES($1,'Pay Test','PAY',19,73,'Test','Test','Test','0','0') RETURNING id",
    )
    .bind(owner)
    .fetch_one(&db)
    .await
    .unwrap();
    let site: Uuid = sqlx::query_scalar(
        "INSERT INTO customer_sites(customer_id,name,address_line,city,state,pincode,contact_person,contact_phone) VALUES($1,'Site','Site','Test','Test','0','Payment Test','0000000000') RETURNING id",
    )
    .bind(customer)
    .fetch_one(&db)
    .await
    .unwrap();
    let order: Uuid = sqlx::query_scalar(
        "INSERT INTO orders(order_number,customer_id,plant_id,site_id,concrete_grade,total_quantity_m3,delivery_date,delivery_time_slot,total_amount,status,preferred_payment_mode) \
         VALUES($1,$2,$3,$4,'M25',6,CURRENT_DATE,'10:00',1000,'pending','FULL_ADVANCE') RETURNING id",
    )
    .bind(format!("TEST-{}",Uuid::new_v4().simple()))
    .bind(customer)
    .bind(plant)
    .bind(site)
    .fetch_one(&db)
    .await
    .unwrap();
    // A fake plant vendor cannot activate by simply supplying an identifier.
    assert!(sqlx::query(
        "INSERT INTO plant_cashfree_vendor_accounts(plant_id,cashfree_vendor_id,provider_environment,status) \
         VALUES($1,'supplier_a','sandbox','ACTIVE')",
    )
    .bind(plant)
    .execute(&db)
    .await
    .is_err());
    sqlx::query(
        "INSERT INTO plant_cashfree_vendor_accounts(plant_id,cashfree_vendor_id,provider_environment,status,verified_by,verified_at) \
         VALUES($1,'supplier_a','sandbox','ACTIVE',$2,NOW())",
    )
    .bind(plant)
    .bind(owner)
    .execute(&db)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO order_payment_offers(order_id,mode,total_amount,advance_amount,status,expires_at,created_by) \
         VALUES($1,'FULL_ADVANCE',1000,1000,'AWAITING_PAYMENT',NOW()+INTERVAL '1 day',$2)",
    )
    .bind(order)
    .bind(owner)
    .execute(&db)
    .await
    .unwrap();
    let insert = "INSERT INTO cashfree_rmc_prepaid_intents(order_id,offer_version,customer_id,plant_id,vendor_id,request_key,gateway_order_id,amount,payment_mode) \
                  VALUES($1,1,$2,$3,'supplier_a',$4,$5,1000,'FULL_ADVANCE')";
    sqlx::query(insert)
        .bind(order)
        .bind(customer)
        .bind(plant)
        .bind("stable-request-key-1")
        .bind("trmc_rmc_test_1")
        .execute(&db)
        .await
        .unwrap();
    // Concurrent app retries may not create a second gateway order for one offer.
    assert!(sqlx::query(insert)
        .bind(order)
        .bind(customer)
        .bind(plant)
        .bind("stable-request-key-2")
        .bind("trmc_rmc_test_2")
        .execute(&db)
        .await
        .is_err());
    // A database writer cannot release production without verified settlement.
    assert!(
        sqlx::query("UPDATE orders SET status='confirmed' WHERE id=$1")
            .bind(order)
            .execute(&db)
            .await
            .is_err()
    );
    let current: String = sqlx::query_scalar("SELECT payment_status FROM orders WHERE id=$1")
        .bind(order)
        .fetch_one(&db)
        .await
        .unwrap();
    assert_eq!(current, "unpaid");
}
