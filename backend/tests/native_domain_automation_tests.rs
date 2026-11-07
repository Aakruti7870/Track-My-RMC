//! Real PostgreSQL integration coverage for all five native domain actions.
use sqlx::PgPool;
use trackmyrmc_backend::services::native_closed_loop::reconcile;
use trackmyrmc_backend::services::native_domain_automation::{
    scan_due, tick, DISPATCH, INVENTORY, QUALITY, RFQ, WORKFORCE,
};
use uuid::Uuid;

async fn user(db: &PgPool, role: &str) -> Uuid {
    sqlx::query_scalar(
        "INSERT INTO users(phone,hashed_password,full_name,role)
         VALUES($1,'unused','Domain automation fixture',$2) RETURNING id",
    )
    .bind(Uuid::new_v4().simple().to_string()[..18].to_string())
    .bind(role)
    .fetch_one(db)
    .await
    .unwrap()
}

async fn plant_and_order(db: &PgPool, owner: Uuid, customer: Uuid) -> (Uuid, Uuid) {
    let plant: Uuid = sqlx::query_scalar(
        "INSERT INTO rmc_plants
         (owner_id,name,code,latitude,longitude,address_line,city,state,pincode,contact_phone)
         VALUES($1,'Domain Plant',$2,19,73,'Test','Panvel','Maharashtra','410206','0000000000')
         RETURNING id",
    )
    .bind(owner)
    .bind(Uuid::new_v4().simple().to_string()[..14].to_string())
    .fetch_one(db)
    .await
    .unwrap();
    let site: Uuid=sqlx::query_scalar(
        "INSERT INTO customer_sites
         (customer_id,name,address_line,city,state,pincode,latitude,longitude,contact_person,contact_phone)
         VALUES($1,'Site','Test','Panvel','Maharashtra','410206',19,73,'Customer','0000000000')
         RETURNING id",
    )
    .bind(customer).fetch_one(db).await.unwrap();
    let order: Uuid = sqlx::query_scalar(
        "INSERT INTO orders
         (order_number,customer_id,plant_id,site_id,concrete_grade,total_quantity_m3,
          delivery_date,delivery_time_slot,total_amount,status)
         VALUES($1,$2,$3,$4,'M25',6,CURRENT_DATE,'10:00',100,'pending')
         RETURNING id",
    )
    .bind(Uuid::new_v4().simple().to_string())
    .bind(customer)
    .bind(plant)
    .bind(site)
    .fetch_one(db)
    .await
    .unwrap();
    (plant, order)
}

async fn enable(db: &PgPool, plant: Uuid, owner: Uuid, keys: &[&str]) {
    for key in keys {
        sqlx::query(
            "UPDATE native_automation_templates
             SET published=TRUE,globally_paused=FALSE WHERE template_key=$1",
        )
        .bind(key)
        .execute(db)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO native_automation_plant_rules
             (plant_id,template_key,enabled,updated_by) VALUES($1,$2,TRUE,$3)",
        )
        .bind(plant)
        .bind(key)
        .bind(owner)
        .execute(db)
        .await
        .unwrap();
    }
}

async fn dispatch_fixture(db: &PgPool, order: Uuid) -> Uuid {
    sqlx::query_scalar(
        "INSERT INTO order_loads(order_id,load_number,quantity_m3,status,created_at)
         VALUES($1,1,6,'planned',NOW()-INTERVAL '20 minutes') RETURNING id",
    )
    .bind(order)
    .fetch_one(db)
    .await
    .unwrap()
}

#[sqlx::test]
async fn five_domains_are_scoped_opt_in_and_exactly_once(db: PgPool) {
    let owner = user(&db, "owner").await;
    let customer = user(&db, "customer").await;
    let engineer = user(&db, "quality_engineer").await;
    let employee = user(&db, "dispatcher").await;
    let (plant, order) = plant_and_order(&db, owner, customer).await;
    let load = dispatch_fixture(&db, order).await;

    sqlx::query(
        "INSERT INTO plant_listing_requests(name,address,lat,lng,status,plant_id)
         VALUES('Domain Plant','Test',19,73,'APPROVED',$1)",
    )
    .bind(plant)
    .execute(&db)
    .await
    .unwrap();
    let rfq: Uuid = sqlx::query_scalar(
        "INSERT INTO customer_quotation_requests
         (customer_id,plant_id,grade,quantity_m3,required_date,status,created_at)
         VALUES($1,$2,'M25',6,CURRENT_DATE+1,'PENDING',NOW()-INTERVAL '20 minutes')
         RETURNING id",
    )
    .bind(customer)
    .bind(plant)
    .fetch_one(&db)
    .await
    .unwrap();
    let inspection: Uuid = sqlx::query_scalar(
        "INSERT INTO cube_tests
         (order_id,sample_date,test_date,result,passed,record_source,tested_by)
         VALUES($1,CURRENT_DATE,CURRENT_DATE,'FAIL',FALSE,'ENGINEER_INSPECTION',$2)
         RETURNING id",
    )
    .bind(order)
    .bind(engineer)
    .fetch_one(&db)
    .await
    .unwrap();
    let material: Uuid = sqlx::query_scalar(
        "INSERT INTO plant_materials
         (plant_id,name,material_type,current_stock,minimum_stock,updated_at)
         VALUES($1,'Cement','cement',10,100,NOW()-INTERVAL '20 minutes')
         RETURNING id",
    )
    .bind(plant)
    .fetch_one(&db)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO plant_staff(plant_id,user_id,role)
                 VALUES($1,$2,'dispatcher')",
    )
    .bind(plant)
    .bind(employee)
    .execute(&db)
    .await
    .unwrap();
    let leave: Uuid = sqlx::query_scalar(
        "INSERT INTO workforce_leave_requests
         (user_id,plant_id,leave_type,start_date,end_date,reason,status,created_at)
         VALUES($1,$2,'CASUAL',CURRENT_DATE,CURRENT_DATE+1,'Personal leave','PENDING',
                NOW()-INTERVAL '20 minutes') RETURNING id",
    )
    .bind(employee)
    .bind(plant)
    .fetch_one(&db)
    .await
    .unwrap();

    assert_eq!(scan_due(&db).await.unwrap(), 0);
    enable(
        &db,
        plant,
        owner,
        &[DISPATCH, RFQ, QUALITY, INVENTORY, WORKFORCE],
    )
    .await;
    assert_eq!(scan_due(&db).await.unwrap(), 5);
    assert_eq!(scan_due(&db).await.unwrap(), 0);

    let (a, b) = tokio::join!(tick(&db), tick(&db));
    assert_eq!(a.unwrap() + b.unwrap(), 5);
    assert_eq!(tick(&db).await.unwrap(), 0);
    let notifications: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM notifications WHERE user_id=$1")
            .bind(owner)
            .fetch_one(&db)
            .await
            .unwrap();
    assert_eq!(notifications, 5);
    let tasks: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM native_automation_domain_tasks
         WHERE plant_id=$1 AND assigned_to=$2 AND status='OPEN'",
    )
    .bind(plant)
    .bind(owner)
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(tasks, 5);
    let completed: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM native_automation_jobs
         WHERE plant_id=$1 AND domain_entity_id IS NOT NULL AND status='COMPLETED'",
    )
    .bind(plant)
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(completed, 5);

    // Operational records are untouched; automation has no approval authority.
    let load_status: String = sqlx::query_scalar("SELECT status FROM order_loads WHERE id=$1")
        .bind(load)
        .fetch_one(&db)
        .await
        .unwrap();
    let rfq_status: String =
        sqlx::query_scalar("SELECT status FROM customer_quotation_requests WHERE id=$1")
            .bind(rfq)
            .fetch_one(&db)
            .await
            .unwrap();
    let leave_status: String =
        sqlx::query_scalar("SELECT status FROM workforce_leave_requests WHERE id=$1")
            .bind(leave)
            .fetch_one(&db)
            .await
            .unwrap();
    let stock: i64 =
        sqlx::query_scalar("SELECT current_stock::bigint FROM plant_materials WHERE id=$1")
            .bind(material)
            .fetch_one(&db)
            .await
            .unwrap();
    let failed: String = sqlx::query_scalar("SELECT result FROM cube_tests WHERE id=$1")
        .bind(inspection)
        .fetch_one(&db)
        .await
        .unwrap();
    assert_eq!(
        (
            load_status.as_str(),
            rfq_status.as_str(),
            leave_status.as_str(),
            stock,
            failed.as_str()
        ),
        ("planned", "PENDING", "PENDING", 10, "FAIL")
    );
}

#[sqlx::test]
async fn disabled_or_stale_domain_records_do_not_notify(db: PgPool) {
    let owner = user(&db, "owner").await;
    let customer = user(&db, "customer").await;
    let (plant, order) = plant_and_order(&db, owner, customer).await;
    let load = dispatch_fixture(&db, order).await;
    // Central publication alone does not grant plant opt-in.
    sqlx::query(
        "UPDATE native_automation_templates SET published=TRUE,globally_paused=FALSE
         WHERE template_key=$1",
    )
    .bind(DISPATCH)
    .execute(&db)
    .await
    .unwrap();
    assert_eq!(scan_due(&db).await.unwrap(), 0);
    sqlx::query(
        "INSERT INTO native_automation_plant_rules
         (plant_id,template_key,enabled,updated_by) VALUES($1,$2,TRUE,$3)",
    )
    .bind(plant)
    .bind(DISPATCH)
    .bind(owner)
    .execute(&db)
    .await
    .unwrap();
    assert_eq!(scan_due(&db).await.unwrap(), 1);

    // The load has moved out of unassigned state before delivery.
    sqlx::query("UPDATE order_loads SET status='assigned' WHERE id=$1")
        .bind(load)
        .execute(&db)
        .await
        .unwrap();
    assert_eq!(tick(&db).await.unwrap(), 0);
    let status: String =
        sqlx::query_scalar("SELECT status FROM native_automation_jobs WHERE domain_entity_id=$1")
            .bind(load)
            .fetch_one(&db)
            .await
            .unwrap();
    assert_eq!(status, "SKIPPED");
    let sent: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM notifications WHERE user_id=$1")
        .bind(owner)
        .fetch_one(&db)
        .await
        .unwrap();
    assert_eq!(sent, 0);
}

#[sqlx::test]
async fn other_plant_cannot_inherit_domain_permissions(db: PgPool) {
    let a = user(&db, "owner").await;
    let b = user(&db, "owner").await;
    let customer = user(&db, "customer").await;
    let (pa, _) = plant_and_order(&db, a, customer).await;
    let (pb, order_b) = plant_and_order(&db, b, customer).await;
    dispatch_fixture(&db, order_b).await;
    enable(&db, pa, a, &[DISPATCH]).await;
    assert_eq!(scan_due(&db).await.unwrap(), 0);
    let leaked: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM native_automation_jobs WHERE plant_id=$1")
            .bind(pb)
            .fetch_one(&db)
            .await
            .unwrap();
    assert_eq!(leaked, 0);
}

#[sqlx::test]
async fn closed_loop_inventory_escalation_is_idempotent_and_source_verified(db: PgPool) {
    let owner = user(&db, "owner").await;
    let customer = user(&db, "customer").await;
    let (plant, _) = plant_and_order(&db, owner, customer).await;
    let material: Uuid = sqlx::query_scalar(
        "INSERT INTO plant_materials
         (plant_id,name,material_type,current_stock,minimum_stock,updated_at)
         VALUES($1,'Cement','cement',10,100,NOW()-INTERVAL '20 minutes')
         RETURNING id",
    )
    .bind(plant)
    .fetch_one(&db)
    .await
    .unwrap();
    enable(&db, plant, owner, &[INVENTORY]).await;
    assert_eq!(scan_due(&db).await.unwrap(), 1);
    assert_eq!(tick(&db).await.unwrap(), 1);
    let task: Uuid = sqlx::query_scalar(
        "SELECT id FROM native_automation_domain_tasks WHERE domain_entity_id=$1",
    )
    .bind(material)
    .fetch_one(&db)
    .await
    .unwrap();
    sqlx::query(
        "UPDATE native_automation_domain_tasks SET
         next_check_at=NOW()-INTERVAL '1 minute',
         next_escalation_at=NOW()-INTERVAL '1 minute'
         WHERE id=$1",
    )
    .bind(task)
    .execute(&db)
    .await
    .unwrap();
    let (a, b) = tokio::join!(reconcile(&db), reconcile(&db));
    assert_eq!(a.unwrap() + b.unwrap(), 1);
    assert_eq!(reconcile(&db).await.unwrap(), 0);
    let escalations: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM native_automation_domain_task_events
         WHERE task_id=$1 AND event_type='SLA_ESCALATED'",
    )
    .bind(task)
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(escalations, 1);
    let owner_notifications: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM notifications WHERE user_id=$1")
            .bind(owner)
            .fetch_one(&db)
            .await
            .unwrap();
    assert_eq!(owner_notifications, 2);

    // Only the underlying, authorized inventory operation changes stock.
    sqlx::query("UPDATE plant_materials SET current_stock=200 WHERE id=$1")
        .bind(material)
        .execute(&db)
        .await
        .unwrap();
    sqlx::query(
        "UPDATE native_automation_domain_tasks
         SET next_check_at=NOW()-INTERVAL '1 minute' WHERE id=$1",
    )
    .bind(task)
    .execute(&db)
    .await
    .unwrap();
    assert_eq!(reconcile(&db).await.unwrap(), 1);
    let (status, reason, count): (String, Option<String>, i32) = sqlx::query_as(
        "SELECT status,resolution_reason,escalation_count
         FROM native_automation_domain_tasks WHERE id=$1",
    )
    .bind(task)
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(status, "RESOLVED");
    assert_eq!(reason.as_deref(), Some("STOCK_ABOVE_MIN"));
    assert_eq!(count, 1);
    assert_eq!(reconcile(&db).await.unwrap(), 0);
}

#[sqlx::test]
async fn closed_loop_cancels_abandoned_load_without_approval(db: PgPool) {
    let owner = user(&db, "owner").await;
    let customer = user(&db, "customer").await;
    let (plant, order) = plant_and_order(&db, owner, customer).await;
    let load = dispatch_fixture(&db, order).await;
    enable(&db, plant, owner, &[DISPATCH]).await;
    assert_eq!(tick(&db).await.unwrap(), 1);
    let task: Uuid = sqlx::query_scalar(
        "SELECT id FROM native_automation_domain_tasks WHERE domain_entity_id=$1",
    )
    .bind(load)
    .fetch_one(&db)
    .await
    .unwrap();
    sqlx::query("UPDATE order_loads SET status='cancelled' WHERE id=$1")
        .bind(load)
        .execute(&db)
        .await
        .unwrap();
    sqlx::query(
        "UPDATE native_automation_domain_tasks
         SET next_check_at=NOW()-INTERVAL '1 minute' WHERE id=$1",
    )
    .bind(task)
    .execute(&db)
    .await
    .unwrap();
    assert_eq!(reconcile(&db).await.unwrap(), 1);
    let (status, reason): (String, Option<String>) = sqlx::query_as(
        "SELECT status,resolution_reason FROM native_automation_domain_tasks WHERE id=$1",
    )
    .bind(task)
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(status, "CANCELLED");
    assert_eq!(reason.as_deref(), Some("LOAD_CANCELLED"));
}

#[sqlx::test]
async fn paused_quality_template_never_escalates_or_auto_closes_failure(db: PgPool) {
    let owner = user(&db, "owner").await;
    let customer = user(&db, "customer").await;
    let engineer = user(&db, "quality_engineer").await;
    let (plant, order) = plant_and_order(&db, owner, customer).await;
    let inspection: Uuid = sqlx::query_scalar(
        "INSERT INTO cube_tests
         (order_id,sample_date,test_date,result,passed,record_source,tested_by)
         VALUES($1,CURRENT_DATE,CURRENT_DATE,'FAIL',FALSE,'ENGINEER_INSPECTION',$2)
         RETURNING id",
    )
    .bind(order)
    .bind(engineer)
    .fetch_one(&db)
    .await
    .unwrap();
    enable(&db, plant, owner, &[QUALITY]).await;
    assert_eq!(tick(&db).await.unwrap(), 1);
    sqlx::query(
        "UPDATE native_automation_templates SET globally_paused=TRUE
         WHERE template_key=$1",
    )
    .bind(QUALITY)
    .execute(&db)
    .await
    .unwrap();
    let task: Uuid = sqlx::query_scalar(
        "SELECT id FROM native_automation_domain_tasks WHERE domain_entity_id=$1",
    )
    .bind(inspection)
    .fetch_one(&db)
    .await
    .unwrap();
    sqlx::query(
        "UPDATE native_automation_domain_tasks
         SET next_check_at=NOW()-INTERVAL '1 minute',
             next_escalation_at=NOW()-INTERVAL '1 minute' WHERE id=$1",
    )
    .bind(task)
    .execute(&db)
    .await
    .unwrap();
    assert_eq!(reconcile(&db).await.unwrap(), 0);
    let (status, escalations): (String, i32) = sqlx::query_as(
        "SELECT status,escalation_count
         FROM native_automation_domain_tasks WHERE id=$1",
    )
    .bind(task)
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(status, "OPEN");
    assert_eq!(escalations, 0);
}

#[sqlx::test]
async fn revoked_owner_role_cannot_receive_new_escalation(db: PgPool) {
    let owner = user(&db, "owner").await;
    let customer = user(&db, "customer").await;
    let (plant, _) = plant_and_order(&db, owner, customer).await;
    let material: Uuid = sqlx::query_scalar(
        "INSERT INTO plant_materials
         (plant_id,name,material_type,current_stock,minimum_stock,updated_at)
         VALUES($1,'Sand','sand',5,20,NOW()-INTERVAL '20 minutes')
         RETURNING id",
    )
    .bind(plant)
    .fetch_one(&db)
    .await
    .unwrap();
    enable(&db, plant, owner, &[INVENTORY]).await;
    assert_eq!(tick(&db).await.unwrap(), 1);
    let task: Uuid = sqlx::query_scalar(
        "SELECT id FROM native_automation_domain_tasks WHERE domain_entity_id=$1",
    )
    .bind(material)
    .fetch_one(&db)
    .await
    .unwrap();
    // Current plant ownership identifier is not sufficient: live role must
    // still authorize the account to receive a plant-owner escalation.
    sqlx::query("UPDATE users SET role='customer' WHERE id=$1")
        .bind(owner)
        .execute(&db)
        .await
        .unwrap();
    sqlx::query(
        "UPDATE native_automation_domain_tasks
         SET next_check_at=NOW()-INTERVAL '1 minute',
             next_escalation_at=NOW()-INTERVAL '1 minute' WHERE id=$1",
    )
    .bind(task)
    .execute(&db)
    .await
    .unwrap();
    assert_eq!(reconcile(&db).await.unwrap(), 0);
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM notifications
         WHERE user_id=$1 AND notification_type='automation_escalation'",
    )
    .bind(owner)
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(count, 0);
}

#[sqlx::test]
async fn revoked_owner_role_cannot_receive_initial_domain_alert(db: PgPool) {
    let owner = user(&db, "owner").await;
    let customer = user(&db, "customer").await;
    let (plant, _) = plant_and_order(&db, owner, customer).await;
    let _material: Uuid = sqlx::query_scalar(
        "INSERT INTO plant_materials
         (plant_id,name,material_type,current_stock,minimum_stock,updated_at)
         VALUES($1,'Sand','sand',5,20,NOW()-INTERVAL '20 minutes')
         RETURNING id",
    )
    .bind(plant)
    .fetch_one(&db)
    .await
    .unwrap();
    enable(&db, plant, owner, &[INVENTORY]).await;
    // A role revocation can happen before the worker sees the due event.
    sqlx::query("UPDATE users SET role='customer' WHERE id=$1")
        .bind(owner)
        .execute(&db)
        .await
        .unwrap();
    assert_eq!(scan_due(&db).await.unwrap(), 0);
    assert_eq!(tick(&db).await.unwrap(), 0);
    let tasks: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM native_automation_domain_tasks WHERE plant_id=$1",
    )
    .bind(plant)
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(tasks, 0);
    let notifications: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM notifications WHERE user_id=$1",
    )
    .bind(owner)
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(notifications, 0);
}
