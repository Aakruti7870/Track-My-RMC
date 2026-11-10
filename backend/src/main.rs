use axum::http::{
    header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE},
    HeaderValue, Method,
};
use config::AppConfig;
use sqlx::postgres::PgPoolOptions;
use state::AppState;
use std::net::SocketAddr;
use tokio::signal;
use tower_http::{
    cors::{Any, CorsLayer},
    trace::TraceLayer,
};
use tracing::info;
use trackmyrmc_backend::{central_admin_bootstrap, config, db, routes, state};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args().skip(1);
    if args.next().as_deref() == Some("--prepare-primary-central-admin") {
        let database = args.next().ok_or("Expected database name is required")?;
        if args.next().is_some() {
            return Err("Unexpected primary Central Admin preparation arguments".into());
        }
        let pool = PgPoolOptions::new()
            .max_connections(1)
            .connect(&std::env::var("DATABASE_URL")?)
            .await?;
        central_admin_bootstrap::prepare_primary(&pool, &database).await?;
        println!("Primary Central Admin identity is reserved or already enrolled");
        return Ok(());
    }

    dotenvy::dotenv().ok();

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,trackmyrmc_backend=debug".into()),
        )
        .json()
        .init();

    info!("Starting TrackMyRMC Rust Backend service...");

    let config = AppConfig::from_env().map_err(|e| {
        tracing::error!("Configuration error: {}", e);
        e
    })?;

    let pool = db::pool::create_pool(&config.database_url).await?;

    // The service must not start against a partially migrated schema.
    db::pool::run_migrations(&pool).await.map_err(|e| {
        tracing::error!("Database migration failed: {}", e);
        e
    })?;

    let state = AppState::new(pool, config.clone());

    // Fail-closed by default: enable only after rollout validation.
    // Row-level PostgreSQL locks allow multiple Tokio workers safely.
    if std::env::var("NATIVE_AUTOMATION_WORKER_ENABLED")
        .ok()
        .as_deref()
        == Some("true")
    {
        let support_followups_enabled = std::env::var("NATIVE_SUPPORT_AUTOMATION_ENABLED")
            .ok()
            .as_deref()
            == Some("true");
        let automation_db = state.db.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(10));
            loop {
                interval.tick().await;
                if let Err(err) =
                    trackmyrmc_backend::services::native_automation::tick(&automation_db).await
                {
                    tracing::error!(error = ?err, "Native automation tick failed");
                }
                if support_followups_enabled {
                    if let Err(err) = trackmyrmc_backend::services::native_support_automation::tick(
                        &automation_db,
                    )
                    .await
                    {
                        tracing::error!(error = ?err, "Native support follow-up tick failed");
                    }
                }
            }
        });
        info!("Native internal automation worker enabled");
    }

    // Independent, explicitly controlled transactional WhatsApp worker.
    // Turning this on never activates the existing internal automation templates.
    if std::env::var("DISPATCH_WHATSAPP_ENABLED").ok().as_deref() == Some("true") {
        let delivery_state = state.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(10));
            loop {
                interval.tick().await;
                if let Err(error) =
                    trackmyrmc_backend::services::dispatch_whatsapp::tick(&delivery_state).await
                {
                    tracing::error!(error = ?error, "Dispatch WhatsApp worker failed");
                }
            }
        });
        info!("Transactional dispatch WhatsApp worker enabled");
    }

    // Separate marketing worker: independent provider approval and customer opt-in.
    // Disabled by default; order dispatch and Utility delivery continue without it.
    if std::env::var("DISPATCH_WHATSAPP_MARKETING_ENABLED")
        .ok()
        .as_deref()
        == Some("true")
    {
        let marketing_state = state.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(10));
            loop {
                interval.tick().await;
                if let Err(error) =
                    trackmyrmc_backend::services::dispatch_marketing::tick(&marketing_state).await
                {
                    tracing::error!(error = ?error, "Dispatch marketing worker failed");
                }
            }
        });
        info!("Opt-in WhatsApp marketing worker enabled");
    }

    // Central CRM campaigns are independent of transactional dispatch marketing.
    // Without explicit release activation this worker is not even spawned.
    if std::env::var("ADMIN_MARKETING_SEND_ENABLED")
        .ok()
        .as_deref()
        == Some("true")
    {
        let admin_marketing_state = state.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(60));
            loop {
                interval.tick().await;
                if let Err(error) =
                    trackmyrmc_backend::routes::admin_campaign::tick(&admin_marketing_state).await
                {
                    tracing::error!(error = ?error, "Admin CRM marketing worker failed");
                }
            }
        });
        info!("Consent-reviewed Admin CRM marketing worker enabled");
    }

    // Separate utility alert queue for Plant Owner registration leads.
    // Opt in only after an approved Meta template and operator recipient are configured.
    if std::env::var("PLANT_OWNER_ALERT_WORKER_ENABLED")
        .ok()
        .as_deref()
        == Some("true")
    {
        let registration_state = state.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(15));
            loop {
                interval.tick().await;
                if let Err(error) =
                    trackmyrmc_backend::services::plant_owner_alert::tick(&registration_state).await
                {
                    tracing::error!(error = ?error, "Plant Owner alert worker failed");
                }
            }
        });
        info!("Plant Owner utility alert worker enabled");
    }

    // Disabled until real-device and Firebase provider acceptance.
    if std::env::var("PUSH_NOTIFICATIONS_ENABLED").ok().as_deref() == Some("true") {
        let mut worker =
            trackmyrmc_backend::services::push_delivery::PushDeliveryWorker::from_env()
                .map_err(|reason| std::io::Error::new(std::io::ErrorKind::InvalidInput, reason))?;
        let notification_db = state.db.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(10));
            loop {
                interval.tick().await;
                if let Err(error) = worker.tick(&notification_db).await {
                    tracing::error!(error = %error, "Operational push notification tick failed");
                }
            }
        });
        info!("Operational FCM notification delivery worker enabled");
    }

    let cors = if config
        .cors_allowed_origins
        .iter()
        .any(|origin| origin == "*")
    {
        CorsLayer::new()
            .allow_origin(Any)
            .allow_methods(Any)
            .allow_headers(Any)
    } else {
        let origins = config
            .cors_allowed_origins
            .iter()
            .filter_map(|origin| HeaderValue::from_str(origin).ok())
            .collect::<Vec<_>>();
        CorsLayer::new()
            .allow_origin(origins)
            .allow_methods([
                Method::GET,
                Method::POST,
                Method::PUT,
                Method::PATCH,
                Method::DELETE,
                Method::OPTIONS,
            ])
            .allow_headers([ACCEPT, AUTHORIZATION, CONTENT_TYPE])
            .allow_credentials(true)
    };

    let app = routes::build_app_router(state)
        .layer(cors)
        .layer(TraceLayer::new_for_http());

    let bind_ip = config
        .host
        .parse::<std::net::IpAddr>()
        .map_err(|_| "HOST must be a valid IP address; received an invalid value".to_string())?;
    let addr = SocketAddr::new(bind_ip, config.port);
    info!("Server listening on http://{}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    info!("TrackMyRMC backend service gracefully stopped");
    Ok(())
}

async fn shutdown_signal() {
    let ctrl_c = async {
        signal::ctrl_c()
            .await
            .expect("Failed to install Ctrl+C signal handler");
    };

    #[cfg(unix)]
    let terminate = async {
        signal::unix::signal(signal::unix::SignalKind::terminate())
            .expect("Failed to install SIGTERM signal handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {
            info!("Received Ctrl+C, initiating graceful shutdown");
        },
        _ = terminate => {
            info!("Received SIGTERM, initiating graceful shutdown");
        },
    }
}
