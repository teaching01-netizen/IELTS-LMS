#[path = "../support/mysql.rs"]
mod mysql;

use ielts_backend_infrastructure::migrations::{default_migrations_dir, run_startup_migrations};

#[tokio::test]
async fn startup_migrations_create_student_attempt_presence_on_fresh_tidb_schema() {
    let database = mysql::TestDatabase::new(&[]).await;

    let migration_result = run_startup_migrations(database.pool(), &default_migrations_dir()).await;
    let migration_error = migration_result.as_ref().err().map(ToString::to_string);
    let presence_table_count = if migration_result.is_ok() {
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'student_attempt_presence'",
        )
        .fetch_one(database.pool())
        .await
        .expect("inspect migrated schema")
    } else {
        0
    };
    let act_migration_recorded = if migration_result.is_ok() {
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM schema_migrations WHERE filename = '0032_act_science_support.sql'",
        )
        .fetch_one(database.pool())
        .await
        .expect("inspect migration history")
    } else {
        0
    };

    database.shutdown().await;

    assert!(
        migration_result.is_ok(),
        "startup migrations failed on a fresh TiDB schema: {migration_error:?}"
    );
    assert_eq!(presence_table_count, 1);
    assert_eq!(act_migration_recorded, 1);
}
