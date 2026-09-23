mod auth;
mod config;
mod db;
mod error;
mod middleware;
mod models;
mod repositories;
mod routes;
mod schemas;
mod services;
mod state;
mod utils;

use config::AppConfig;
use state::AppState;
use std::{net::SocketAddr, str::FromStr};
use tokio::signal;
use tower_http::{
    cors::{Any, CorsLayer},
    trace::TraceLayer,
};
use tracing::info;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
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

    let cors = if config.cors_allowed_origins.iter().any(|origin| origin == "*") {
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
            .allow_methods(Any)
            .allow_headers(Any)
    };

    let app = routes::build_app_router(state)
        .layer(cors)
        .layer(TraceLayer::new_for_http());

    let addr = SocketAddr::from(([0, 0, 0, 0], config.port));
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
