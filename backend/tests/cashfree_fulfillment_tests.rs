//! Disposable PostgreSQL tests only; never posts money or touches Cashfree.
use bigdecimal::BigDecimal;
use sqlx::{PgPool, Row};
use trackmyrmc_backend::{
    config::AppConfig, routes::cashfree_fulfillment::fulfill_verified, state::AppState,
};
use uuid::Uuid;

const STAGING: &str = include_str!("../../ops/pending-migrations/cashfree_sandbox_intents.sql");

fn app(db: PgPool) -> AppState {
    AppState::new(
        db,
        AppConfig {
            database_url: String::new(),
            jwt_secret: "test-only".repeat(10),
            jwt_expiration_hours: 1,
            port: 8000,
            host: "127.0.0.1".into(),
            cors_allowed_origins: vec![],
            environment: "test".into(),
            meta_whatsapp_token: None,
            meta_whatsapp_phone_number_id: None,
            meta_whatsapp_waba_id: None,
            meta_graph_api_version: "v26.0".into(),
            email_api_key: None,
            email_from_address: "test@example.invalid".into(),
            otp_pepper: "test-only".repeat(8),
            otp_expiration_minutes: 5,
            otp_cooldown_seconds: 60,
            otp_max_verification_attempts: 3,
            play_signing_sha256: None,
            play_review_access_code: None,
            google_places_api_key: None,
        },
    )
}

async fn user(db: &PgPool, role: &str) -> Uuid {
    sqlx::query_scalar(
        "INSERT INTO users(phone,hashed_password,full_name,role)
         VALUES($1,'test','Cashfree Fixture',$2) RETURNING id",
    )
    .bind(&Uuid::new_v4().simple().to_string()[..16])
    .bind(role)
    .fetch_one(db)
    .await
    .unwrap()
}

async fn plant(db: &PgPool, owner: Uuid) -> Uuid {
    sqlx::query_scalar(
        "INSERT INTO rmc_plants(owner_id,name,code,latitude,longitude,address_line,city,state,pincode,contact_phone)
         VALUES($1,'Payment Plant',$2,0,0,'Test','Test','MH','0','0') RETURNING id",
    )
    .bind(owner)
    .bind(Uuid::new_v4().simple().to_string())
    .fetch_one(db)
    .await
    .unwrap()
}

async fn invoice_fixture(db: &PgPool, payable: &str, total: &str) -> (Uuid, Uuid) {
    let owner = user(db, "owner").await;
    let customer = user(db, "customer").await;
    let plant_id = plant(db, owner).await;
    let invoice: Uuid = sqlx::query_scalar(
        "INSERT INTO plant_invoices(plant_id,customer_id,invoice_number,subtotal_amount,total_amount)
         VALUES($1,$2,$3,$4,$4) RETURNING id",
    )
    .bind(plant_id)
    .bind(customer)
    .bind(format!("TEST{}", Uuid::new_v4().simple()))
    .bind(total.parse::<BigDecimal>().unwrap())
    .fetch_one(db)
    .await
    .unwrap();
    let intent: Uuid = sqlx::query_scalar(
        "INSERT INTO cashfree_sandbox_intents(requester_id,plant_id,invoice_id,kind,request_key,gateway_order_id,amount,status,verified_at)
         VALUES($1,$2,$3,'INVOICE',$4,$5,$6,'VERIFIED',NOW()) RETURNING id",
    )
    .bind(customer)
    .bind(plant_id)
    .bind(invoice)
    .bind(format!("key{}", Uuid::new_v4().simple()))
    .bind(format!("trmc_{}", Uuid::new_v4().simple()))
    .bind(payable.parse::<BigDecimal>().unwrap())
    .fetch_one(db)
    .await
    .unwrap();
    (invoice, intent)
}

#[sqlx::test]
async fn provider_verified_invoice_receipt_posts_once(db: PgPool) {
    sqlx::raw_sql(STAGING).execute(&db).await.unwrap();
    let (invoice, intent) = invoice_fixture(&db, "200.00", "200.00").await;
    let state = app(db.clone());
    let a = fulfill_verified(&state, intent).await.unwrap();
    assert_eq!(a["fulfilled"], true);
    let b = fulfill_verified(&state, intent).await.unwrap();
    assert_eq!(b["idempotent"], true);
    let row = sqlx::query(
        "SELECT i.status, (SELECT COUNT(*) FROM plant_payments WHERE invoice_id=$1) AS posted
         FROM plant_invoices i WHERE i.id=$1",
    )
    .bind(invoice)
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(row.get::<String, _>("status"), "PAID");
    assert_eq!(row.get::<i64, _>("posted"), 1);
}

#[sqlx::test]
async fn externally_paid_invoice_requires_review_not_double_credit(db: PgPool) {
    sqlx::raw_sql(STAGING).execute(&db).await.unwrap();
    let (invoice, intent) = invoice_fixture(&db, "70.00", "100.00").await;
    let plant_id: Uuid = sqlx::query_scalar("SELECT plant_id FROM plant_invoices WHERE id=$1")
        .bind(invoice)
        .fetch_one(&db)
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO plant_payments(invoice_id,plant_id,amount,payment_method,request_id)
         VALUES($1,$2,60.00,'bank_transfer','prior-manual-123')",
    )
    .bind(invoice)
    .bind(plant_id)
    .execute(&db)
    .await
    .unwrap();
    assert!(fulfill_verified(&app(db.clone()), intent).await.is_err());
    let paid: BigDecimal = sqlx::query_scalar(
        "SELECT COALESCE(SUM(amount),0) FROM plant_payments WHERE invoice_id=$1",
    )
    .bind(invoice)
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(paid, "60.00".parse::<BigDecimal>().unwrap());
    let fulfilled: Option<chrono::DateTime<chrono::Utc>> =
        sqlx::query_scalar("SELECT fulfilled_at FROM cashfree_sandbox_intents WHERE id=$1")
            .bind(intent)
            .fetch_one(&db)
            .await
            .unwrap();
    assert!(fulfilled.is_none());
}

#[sqlx::test]
async fn approved_sandbox_subscription_extends_once(db: PgPool) {
    sqlx::raw_sql(STAGING).execute(&db).await.unwrap();
    let owner = user(&db, "owner").await;
    let plant_id = plant(&db, owner).await;
    let plan: Uuid = sqlx::query_scalar(
        "INSERT INTO plant_subscription_plans(plan_code,name,monthly_price)
         VALUES('STARTER','Starter',125.00) RETURNING id",
    )
    .fetch_one(&db)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO cashfree_approved_plan_prices(sku,duration_days,price_inr,approved_by,approved_at,is_active)
         VALUES('STARTER',30,125.00,$1,NOW(),TRUE)",
    )
    .bind(owner)
    .execute(&db)
    .await
    .unwrap();
    let intent: Uuid = sqlx::query_scalar(
        "INSERT INTO cashfree_sandbox_intents(requester_id,plant_id,kind,sku,duration_days,request_key,gateway_order_id,amount,status,verified_at)
         VALUES($1,$2,'PLAN','STARTER',30,'approved-test-123',$3,125.00,'VERIFIED',NOW()) RETURNING id",
    )
    .bind(owner)
    .bind(plant_id)
    .bind(format!("trmc_{}", Uuid::new_v4().simple()))
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(fulfill_verified(&app(db.clone()), intent).await.unwrap()["fulfilled"], true);
    assert_eq!(fulfill_verified(&app(db.clone()), intent).await.unwrap()["idempotent"], true);
    let subscription_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM plant_plan_subscriptions WHERE plant_id=$1 AND plan_id=$2",
    )
    .bind(plant_id)
    .bind(plan)
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(subscription_count, 1);
    let payment_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM plant_plan_payments WHERE plant_id=$1")
            .bind(plant_id)
            .fetch_one(&db)
            .await
            .unwrap();
    assert_eq!(payment_count, 1);
}
