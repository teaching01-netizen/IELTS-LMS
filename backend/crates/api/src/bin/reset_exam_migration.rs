use sqlx::MySqlPool;
use std::env;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let database_url = env::var("DATABASE_URL").expect("DATABASE_URL must be set");
    let pool = MySqlPool::connect(&database_url).await?;

    // Remove the migration record for 0003_exam_core
    sqlx::query("DELETE FROM schema_migrations WHERE version = '0003_exam_core'")
        .execute(&pool)
        .await?;

    println!("✓ Removed migration record for 0003_exam_core");
    Ok(())
}
