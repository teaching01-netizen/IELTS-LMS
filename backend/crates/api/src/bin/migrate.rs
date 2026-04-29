use std::{env, path::PathBuf, time::Duration};

use ielts_backend_infrastructure::migrations::{default_migrations_dir, run_startup_migrations};
use sqlx::mysql::MySqlPoolOptions;

fn migration_database_url() -> Option<String> {
    env::var("DATABASE_MIGRATOR_URL")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            env::var("DATABASE_DIRECT_URL")
                .ok()
                .filter(|value| !value.trim().is_empty())
        })
        .or_else(|| {
            env::var("DATABASE_URL")
                .ok()
                .filter(|value| !value.trim().is_empty())
        })
}

fn migrations_dir() -> PathBuf {
    env::var("MIGRATIONS_DIR")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(default_migrations_dir)
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    ielts_backend_infrastructure::tracing::init_tracing("ielts-backend-migrate", None)?;

    let Some(database_url) = migration_database_url() else {
        tracing::warn!("No database URL configured for migrations; skipping startup migration");
        ielts_backend_infrastructure::tracing::shutdown_tracing();
        return Ok(());
    };

    let pool = MySqlPoolOptions::new()
        .max_connections(1)
        .acquire_timeout(Duration::from_secs(10))
        .connect(&database_url)
        .await?;
    let migrations_dir = migrations_dir();

    tracing::info!(path = %migrations_dir.display(), "running startup migrations");
    run_startup_migrations(&pool, &migrations_dir).await?;
    tracing::info!("startup migrations complete");
    ielts_backend_infrastructure::tracing::shutdown_tracing();

    Ok(())
}
