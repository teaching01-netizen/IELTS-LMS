use sqlx::{mysql::MySqlPoolOptions, Executor};
use std::time::Duration;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let database_url = std::env::var("DATABASE_MIGRATOR_URL")
        .or_else(|_| std::env::var("DATABASE_DIRECT_URL"))
        .or_else(|_| std::env::var("DATABASE_URL"))?;

    let pool = MySqlPoolOptions::new()
        .max_connections(1)
        .acquire_timeout(Duration::from_secs(10))
        .connect(&database_url)
        .await?;

    println!("Dropping dependent tables...");
    pool.execute("SET FOREIGN_KEY_CHECKS = 0").await?;

    // Drop tables that depend on exam_entities
    pool.execute("DROP TABLE IF EXISTS exam_events").await?;
    pool.execute("DROP TABLE IF EXISTS exam_versions").await?;
    pool.execute("DROP TABLE IF EXISTS exam_memberships")
        .await?;
    pool.execute("DROP TABLE IF EXISTS exam_entities").await?;

    pool.execute("SET FOREIGN_KEY_CHECKS = 1").await?;

    println!("Removing migration record for 0003_exam_core.sql...");
    pool.execute("DELETE FROM schema_migrations WHERE filename = '0003_exam_core.sql'")
        .await?;

    println!("Cleanup complete. Please re-run: cargo run -p ielts-backend-api --bin migrate");

    Ok(())
}
