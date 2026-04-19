#![forbid(unsafe_code)]

pub mod http {
    pub mod auth;
    pub mod error;
    pub mod pagination;
    pub mod rate_limit;
    pub mod request_id;
    pub mod response;
}

pub mod frontend;
pub mod live_updates;
pub mod router;
pub mod routes;
pub mod state;

use ielts_backend_infrastructure::config::AppConfig;
use tokio::net::TcpListener;

use crate::{live_updates::spawn_postgres_listener, router::build_router, state::AppState};

pub async fn run() -> std::io::Result<()> {
    let config = AppConfig::from_env();
    ielts_backend_infrastructure::tracing::init_tracing(
        "ielts-backend-api",
        config.otel_exporter_otlp_endpoint.as_deref(),
    )
    .map_err(std::io::Error::other)?;
    let bind_address = config.bind_address();
    let state = AppState::from_config(config)
        .await
        .map_err(std::io::Error::other)?;
    let _live_updates = spawn_postgres_listener(state.config.clone(), state.live_updates.clone());
    let app = build_router(state);
    let listener = TcpListener::bind(&bind_address).await?;

    tracing::info!(bind_address = %bind_address, "api listening");

    let result = axum::serve(listener, app).await;
    ielts_backend_infrastructure::tracing::shutdown_tracing();
    result
}
