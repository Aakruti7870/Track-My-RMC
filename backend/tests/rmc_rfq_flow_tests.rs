use axum::{body::{to_bytes, Body}, http::{Request, StatusCode}, Router};
use serde_json::{json, Value};
use sqlx::PgPool;
use tower::ServiceExt;
use trackmyrmc_backend::{
    auth::jwt::generate_token, config::AppConfig, routes::build_app_router, state::AppState,
};
use uuid::Uuid;

fn app(db: PgPool) -> (AppState, Router) {
    let state = AppState::new(db, AppConfig {
        database_url: String::new(),
        jwt_secret: "isolated-smart-rfq".repeat(8), jwt_expiration_hours: 1,
        port: 8000, host: "127.0.0.1".into(), cors_allowed_origins: vec![],
        environment: "test".into(),
        meta_whatsapp_token: None, meta_whatsapp_phone_number_id: None,
        meta_whatsapp_waba_id: None, meta_graph_api_version: "v26.0".into(),
        email_api_key: None, email_from_address: "test@example.invalid".into(),
        otp_pepper: "isolated-smart-rfq".repeat(5),
        otp_expiration_minutes: 5, otp_cooldown_seconds: 60,
        otp_max_verification_attempts: 3, play_signing_sha256: None,
        play_review_access_code: None, google_places_api_key: None,
    });
    let router = build_app_router(state.clone());
    (state, router)
}

async fn identity(db: &PgPool, role: &str) -> Uuid {
    sqlx::query_scalar(
        "INSERT INTO users(phone,hashed_password,full_name,role)
         VALUES($1,'test-only','Example Person',$2) RETURNING id"
    ).bind(Uuid::new_v4().simple().to_string()[..18].to_string())
    .bind(role).fetch_one(db).await.unwrap()
}
async fn plant(db: &PgPool, owner: Uuid) -> Uuid {
    let id: Uuid = sqlx::query_scalar(
        "INSERT INTO rmc_plants(owner_id,name,code,latitude,longitude,address_line,city,state,pincode,contact_phone,google_place_id)
         VALUES($1,'Test RMC','TEST',19,73,'Example location','Panvel','MH','410206','0','ChIJ_test_rmc')
         RETURNING id"
    ).bind(owner).fetch_one(db).await.unwrap();
    sqlx::query(
        "INSERT INTO plant_listing_requests(name,address,lat,lng,status,plant_id)
         VALUES('Test RMC','Example location',19,73,'APPROVED',$1)"
    ).bind(id).execute(db).await.unwrap();
    id
}
fn token(state: &AppState, user: Uuid, role: &str) -> String {
    generate_token(user,role,"",None,&state.config.jwt_secret,1).unwrap()
}
async fn call(app: &Router, path: &str, method: &str, body: Option<Value>, token: &str) -> (StatusCode, Value) {
    let response = app.clone().oneshot(
        Request::builder().uri(path).method(method)
        .header("Authorization", format!("Bearer {token}"))
        .header("Content-Type","application/json")
        .body(Body::from(body.map(|b| b.to_string()).unwrap_or_default()))
        .unwrap()
    ).await.unwrap();
    let status = response.status();
    let content = to_bytes(response.into_body(),100_000).await.unwrap();
    (status,serde_json::from_slice(&content).unwrap_or(Value::Null))
}
fn request_body(plant_id: Uuid, request_key: Uuid) -> Value {
    json!({
        "request_key":request_key,"plant_id":plant_id,"customer_name":"Example Customer",
        "customer_email":"customer@example.com","customer_gstin":null,
        "grade":"M25","quantity_m3":6.5,"site_address":"Sector 18, Panvel, Maharashtra",
        "site_lat":null,"site_lng":null,
        "delivery_date":(chrono::Utc::now().date_naive()+chrono::Duration::days(1)).to_string(),
        "pump_required":true,"site_contact_phone":"9876543210","share_with_supplier":true
    })
}

#[sqlx::test]
async fn approved_lead_reuses_existing_quoting_and_notifies_owner_customer(db: PgPool) {
    let customer = identity(&db,"customer").await;
    let owner = identity(&db,"owner").await;
    let plant_id = plant(&db,owner).await;
    let (state,router) = app(db.clone());
    let ctoken = token(&state,customer,"customer");
    let owner_token = token(&state,owner,"owner");
    let payload = request_body(plant_id,Uuid::new_v4());

    let (status,created) = call(&router,"/api/customer/rmc-rfq-leads","POST",Some(payload.clone()),&ctoken).await;
    assert_eq!(status,StatusCode::OK,"{created}");
    assert_eq!(created["status"],"REQUESTED");
    assert!(created["canonical_request_id"].is_string());
    let (again_status,again) = call(&router,"/api/customer/rmc-rfq-leads","POST",Some(payload),&ctoken).await;
    assert_eq!(again_status,StatusCode::OK,"{again}");
    assert_eq!(again["id"],created["id"]);
    assert_eq!(again["idempotent_replay"],true);

    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM customer_quotation_requests WHERE customer_id=$1")
        .bind(customer).fetch_one(&db).await.unwrap();
    assert_eq!(count,1);
    let owner_notice: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM notifications WHERE user_id=$1 AND notification_type='rmc_rfq'"
    ).bind(owner).fetch_one(&db).await.unwrap();
    assert_eq!(owner_notice,1);
    let (status,queue) = call(&router,&format!("/api/ops/plants/{plant_id}/quotation-requests"),"GET",None,&owner_token).await;
    assert_eq!(status,StatusCode::OK,"{queue}");
    assert_eq!(queue["requests"][0]["site_contact_phone"],"9876543210");
    assert_eq!(queue["requests"][0]["customer_email"],"customer@example.com");

    let id = created["canonical_request_id"].as_str().unwrap();
    let (status,quoted) = call(&router,&format!("/api/ops/plants/{plant_id}/quotation-requests/{id}/respond"),
        "POST",Some(json!({"action":"SEND","rate_per_m3":4500.0,"gst_rate":18.0})),&owner_token).await;
    assert_eq!(status,StatusCode::OK,"{quoted}");
    assert_eq!(quoted["status"],"QUOTED");
    let customer_notice: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM notifications WHERE user_id=$1 AND notification_type='rmc_quotation_response'"
    ).bind(customer).fetch_one(&db).await.unwrap();
    assert_eq!(customer_notice,1);
}

#[sqlx::test]
async fn admin_outreach_requires_admin_and_never_exposes_internal_notes(db: PgPool) {
    let customer=identity(&db,"customer").await;
    let admin=identity(&db,"admin").await;
    let (state,router)=app(db.clone());
    let ctoken=token(&state,customer,"customer");
    let atoken=token(&state,admin,"admin");
    let lead_id: Uuid = sqlx::query_scalar(
        "INSERT INTO rmc_rfq_leads(customer_id,request_key,google_place_id,customer_name,grade,quantity_m3,
            site_address,delivery_date,site_contact_phone,sharing_consent_at,status)
         VALUES($1,$2,'ChIJ_unregistered','Example Customer','M25',6.5,
            'Panvel, Maharashtra',CURRENT_DATE+1,'9876543210',NOW(),'PENDING_SUPPLIER') RETURNING id"
    ).bind(customer).bind(Uuid::new_v4()).fetch_one(&db).await.unwrap();
    let path = format!("/api/admin/rmc-rfq-leads/{lead_id}/outreach");
    let payload=json!({"outreach_status":"CONTACTED","notes":"Internal admin conversation note"});
    assert_eq!(call(&router,&path,"PATCH",Some(payload.clone()),&ctoken).await.0,StatusCode::FORBIDDEN);
    let (status,updated)=call(&router,&path,"PATCH",Some(payload),&atoken).await;
    assert_eq!(status,StatusCode::OK,"{updated}");
    assert_eq!(updated["outreach_status"],"CONTACTED");
    let (status,history)=call(&router,"/api/customer/rmc-rfq-leads","GET",None,&ctoken).await;
    assert_eq!(status,StatusCode::OK,"{history}");
    assert_eq!(history["leads"][0]["id"],lead_id.to_string());
    assert!(history.to_string().find("Internal admin conversation note").is_none());
    assert!(history.to_string().find("sharing_consent_at").is_none());
    assert_eq!(call(&router,"/api/admin/rmc-rfq-leads","GET",None,&ctoken).await.0,StatusCode::FORBIDDEN);
    assert_eq!(call(&router,"/api/admin/rmc-rfq-leads","GET",None,&atoken).await.0,StatusCode::OK);
}

#[sqlx::test]
async fn matched_lead_requires_customer_reconfirmation(db: PgPool) {
    let customer=identity(&db,"customer").await;
    let other=identity(&db,"customer").await;
    let owner=identity(&db,"owner").await;
    let plant_id=plant(&db,owner).await;
    let (state,router)=app(db.clone());
    let ctoken=token(&state,customer,"customer");
    let otoken=token(&state,other,"customer");
    let lead_id: Uuid = sqlx::query_scalar(
        "INSERT INTO rmc_rfq_leads(customer_id,request_key,google_place_id,plant_id,customer_name,grade,quantity_m3,
            site_address,delivery_date,pump_required,site_contact_phone,sharing_consent_at,status)
         VALUES($1,$2,'ChIJ_test_rmc',$3,'Example Customer','M25',6.5,
            'Panvel, Maharashtra',CURRENT_DATE+1,TRUE,'9876543210',NOW(),'MATCHED_RECONFIRMATION_REQUIRED')
         RETURNING id"
    ).bind(customer).bind(Uuid::new_v4()).bind(plant_id).fetch_one(&db).await.unwrap();
    let route=format!("/api/customer/rmc-rfq-leads/{lead_id}/confirm");
    assert_eq!(call(&router,&route,"POST",Some(json!({})),&otoken).await.0,StatusCode::NOT_FOUND);
    let (status,result)=call(&router,&route,"POST",Some(json!({})),&ctoken).await;
    assert_eq!(status,StatusCode::OK,"{result}");
    assert_eq!(result["status"],"REQUESTED");
    let (again,body)=call(&router,&route,"POST",Some(json!({})),&ctoken).await;
    assert_eq!(again,StatusCode::OK,"{body}");
    assert_eq!(body["id"],lead_id.to_string());
    assert_eq!(body["idempotent_replay"],true);
    let matched: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM customer_quotation_requests WHERE customer_id=$1 AND plant_id=$2"
    ).bind(customer).bind(plant_id).fetch_one(&db).await.unwrap();
    assert_eq!(matched,1);
}
