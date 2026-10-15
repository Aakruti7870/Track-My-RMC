//! Disposable CI harness, never the production entry point. It runs the real
//! router with an injected delivery transport and the explicitly approved
//! synthetic identities. OTPs go only to a protected loopback memory sink.
use axum::async_trait;
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    io::Read,
    sync::Arc,
};
use tower_http::cors::{Any, CorsLayer};
use trackmyrmc_backend::{
    config::AppConfig,
    error::AppError,
    routes::build_app_router,
    services::{customer_order, otp_delivery::OtpDelivery},
    state::AppState,
};
use uuid::Uuid;

#[derive(Deserialize)]
struct FixtureInput {
    capture_token: String,
    totp_secrets: HashMap<String, String>,
}

struct LoopbackDelivery {
    token: String,
    approved: HashSet<String>,
}

#[async_trait]
impl OtpDelivery for LoopbackDelivery {
    fn validate(&self, channel: &str) -> Result<(), AppError> {
        if matches!(channel, "email" | "whatsapp") {
            Ok(())
        } else {
            Err(AppError::BadRequest("Unsupported fixture channel".into()))
        }
    }
    async fn send(
        &self,
        channel: &str,
        destination: &str,
        otp: &str,
        _context: &str,
    ) -> Result<(), AppError> {
        self.validate(channel)?;
        if !self.approved.contains(destination) {
            return Err(AppError::Forbidden(
                "Unapproved synthetic fixture destination".into(),
            ));
        }
        let result = reqwest::Client::new()
            .post("http://127.0.0.1:8302/capture")
            .bearer_auth(&self.token)
            .json(&json!({"destination":destination,"otp":otp}))
            .send()
            .await
            .map_err(|_| AppError::InternalError("Fixture memory sink unavailable".into()))?;
        if !result.status().is_success() {
            return Err(AppError::InternalError(
                "Fixture memory sink rejected delivery".into(),
            ));
        }
        Ok(())
    }
}

#[tokio::main]
async fn main() {
    if let Err(error) = run().await {
        let database = error.downcast_ref::<sqlx::Error>().or_else(|| {
            error.downcast_ref::<AppError>().and_then(|app| match app {
                AppError::DatabaseError(database) => Some(database),
                _ => None,
            })
        });
        let code = database
            .and_then(sqlx::Error::as_database_error)
            .and_then(|db| db.code());
        eprintln!(
            "CI-FIXTURE: failed sqlstate={}",
            code.as_deref().unwrap_or("unavailable")
        );
        std::process::exit(1);
    }
}

async fn run() -> Result<(), Box<dyn std::error::Error>> {
    eprintln!("CI-FIXTURE: configuration");
    if std::env::var("GITHUB_ACTIONS").as_deref() != Ok("true")
        || std::env::var("APP_ENV").as_deref() != Ok("test")
    {
        return Err("Mobile browser fixture is restricted to disposable GitHub CI".into());
    }
    let mut config = AppConfig::from_env().map_err(|_| "Invalid isolated fixture configuration")?;
    let database =
        reqwest::Url::parse(&config.database_url).map_err(|_| "Invalid isolated database URL")?;
    if !matches!(database.host_str(), Some("localhost" | "127.0.0.1"))
        || database.path() != "/trackmyrmc_test"
        || database.username() != "trackmyrmc_user"
    {
        return Err("Fixture must use the isolated loopback CI database".into());
    }
    let mut input = String::new();
    std::io::stdin().read_to_string(&mut input)?;
    let fixture: FixtureInput =
        serde_json::from_str(&input).map_err(|_| "Invalid fixture input")?;
    if fixture.capture_token.len() != 64 {
        return Err("Invalid fixture memory-sink authentication".into());
    }
    let manifest: Value =
        serde_json::from_str(include_str!("../tests/fixtures/staging_identities.json"))?;
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(10)
        .connect(&config.database_url)
        .await?;
    eprintln!("CI-FIXTURE: migrations");
    sqlx::migrate!("./migrations").run(&pool).await?;
    let mut identities = HashMap::new();
    let mut approved = HashSet::new();
    let mut tx = pool.begin().await?;
    eprintln!("CI-FIXTURE: synthetic identities");
    for (index, entry) in manifest["users"]
        .as_array()
        .ok_or("Missing synthetic manifest")?
        .iter()
        .enumerate()
    {
        let role = entry["role"].as_str().ok_or("Missing fixture role")?;
        if matches!(role, "admin" | "authority" | "central_admin") {
            return Err("Privileged fixture enrollment is not permitted".into());
        }
        let email = entry["email"].as_str();
        let phone = entry["phone"]
            .as_str()
            .map(|s| s.trim_start_matches('+').to_string())
            .unwrap_or_else(|| format!("ci-mobile-{index}"));
        let name = format!("Staging {}", role.replace('_', " "));
        let id:Uuid=sqlx::query_scalar("INSERT INTO users(phone,email,hashed_password,full_name,role,is_verified) VALUES($1,$2,'!isolated-otp-fixture!',$3,$4,TRUE) RETURNING id")
            .bind(&phone).bind(email).bind(&name).bind(role).fetch_one(&mut *tx).await?;
        sqlx::query("INSERT INTO user_profiles(user_id,kyc_status,verified_name) VALUES($1,$2,$3)")
            .bind(id)
            .bind(if role == "customer" {
                "verified"
            } else {
                "unverified"
            })
            .bind(if role == "customer" { Some(name) } else { None })
            .execute(&mut *tx)
            .await?;
        identities.insert(role.to_string(), id);
        if let Some(email) = email {
            approved.insert(email.to_string());
            let secret = fixture
                .totp_secrets
                .get(role)
                .ok_or("Missing synthetic authenticator")?;
            if secret.len() != 32
                || !secret
                    .bytes()
                    .all(|b| b.is_ascii_uppercase() || (b'2'..=b'7').contains(&b))
            {
                return Err("Invalid synthetic authenticator format".into());
            }
            sqlx::query("INSERT INTO user_totp_credentials(user_id,secret_key,is_enabled) VALUES($1,$2,TRUE)").bind(id).bind(secret).execute(&mut *tx).await?;
        } else {
            approved.insert(phone);
        }
    }
    let owner = *identities
        .get("plant_owner")
        .ok_or("Missing owner fixture")?;
    let customer = *identities
        .get("customer")
        .ok_or("Missing customer fixture")?;
    let driver = *identities.get("driver").ok_or("Missing driver fixture")?;
    eprintln!("CI-FIXTURE: plant and assignments");
    let plant:Uuid=sqlx::query_scalar("INSERT INTO rmc_plants(owner_id,name,code,latitude,longitude,address_line,city,state,pincode,contact_phone) VALUES($1,'Browser staging plant','CI-MOBILE',19.076,72.877,'Synthetic staging address','Mumbai','Maharashtra','400001','0') RETURNING id").bind(owner).fetch_one(&mut *tx).await?;
    sqlx::query("INSERT INTO plant_listing_requests(name,address,lat,lng,status,plant_id) VALUES('Browser staging plant','Synthetic staging address',19.076,72.877,'APPROVED',$1)").bind(plant).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO plant_rate_cards(plant_id,grade,rate_per_m3) VALUES($1,'M25',4500)")
        .bind(plant)
        .execute(&mut *tx)
        .await?;
    for (role, id) in &identities {
        if !matches!(role.as_str(), "plant_owner" | "customer") {
            sqlx::query("INSERT INTO plant_staff(plant_id,user_id,role) VALUES($1,$2,$3)")
                .bind(plant)
                .bind(id)
                .bind(role)
                .execute(&mut *tx)
                .await?;
        }
    }
    sqlx::query("INSERT INTO transit_mixers(plant_id,registration_number,driver_id) VALUES($1,'CI-MOBILE-TM',$2)").bind(plant).bind(driver).execute(&mut *tx).await?;
    let site:Uuid=sqlx::query_scalar("INSERT INTO customer_sites(customer_id,name,address_line,city,state,pincode,latitude,longitude,contact_person,contact_phone,is_default) VALUES($1,'Browser site','Synthetic staging delivery address','Mumbai','Maharashtra','400001',19.1,72.9,'Staging customer','12025550101',TRUE) RETURNING id").bind(customer).fetch_one(&mut *tx).await?;
    tx.commit().await?;
    eprintln!("CI-FIXTURE: customer order");
    config.meta_whatsapp_token = None;
    config.email_api_key = None;
    let mut state = AppState::new(pool, config);
    state.otp_delivery = Arc::new(LoopbackDelivery {
        token: fixture.capture_token,
        approved,
    });
    let order = serde_json::from_value(
        json!({"plant_id":plant,"site_id":site,"grade":"M25","quantity":6,"delivery_date":chrono::Utc::now().date_naive()+chrono::Duration::days(1),"delivery_time":"10:00","idempotency_key":"ci-mobile-seed-order"}),
    )?;
    customer_order::place(&state, customer, order).await?;
    // A second isolated fixture order represents an existing produced batch for the quality UI.
    // Production state transitions have separate real PostgreSQL lifecycle tests.
    let inspection_order = serde_json::from_value(
        json!({"plant_id":plant,"site_id":site,"grade":"M25","quantity":3,"delivery_date":chrono::Utc::now().date_naive()+chrono::Duration::days(1),"delivery_time":"11:00","idempotency_key":"ci-mobile-quality-order"}),
    )?;
    let inspection = customer_order::place(&state, customer, inspection_order).await?;
    let inspection_id = inspection.id;
    sqlx::query("UPDATE orders SET status='produced' WHERE id=$1")
        .bind(inspection_id)
        .execute(&state.db)
        .await?;
    eprintln!("CI-FIXTURE: router");
    let cors = CorsLayer::new()
        .allow_origin("http://127.0.0.1:8081".parse::<axum::http::HeaderValue>()?)
        .allow_methods(Any)
        .allow_headers(Any);
    let app = build_app_router(state).layer(cors);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:8301").await?;
    eprintln!("Isolated synthetic mobile browser fixture ready");
    axum::serve(listener, app).await?;
    Ok(())
}
