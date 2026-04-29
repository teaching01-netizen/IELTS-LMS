use std::{
    borrow::Cow,
    fs,
    path::{Path, PathBuf},
};

use sqlx::{Executor, MySqlPool};

const ROLE_MIGRATION: &str = "0001_roles.sql";

pub async fn run_startup_migrations(
    pool: &MySqlPool,
    migrations_dir: &Path,
) -> Result<(), sqlx::Error> {
    let migrations = load_migrations(migrations_dir).map_err(sqlx::Error::Io)?;

    ensure_schema_migrations_table(pool).await?;
    maybe_backfill_schema_migrations(pool, &migrations).await?;

    // Note: Role management removed - MySQL uses standard user management
    // The 0001_roles.sql migration is now a no-op comment file
    if !is_migration_applied(pool, ROLE_MIGRATION).await? {
        record_migration(pool, ROLE_MIGRATION).await?;
    }

    for migration in migrations {
        if migration.filename == ROLE_MIGRATION
            || is_migration_applied(pool, &migration.filename).await?
        {
            continue;
        }

        let sql = sanitize_migration_sql(&migration.sql);
        pool.execute(sql.as_ref()).await?;
        record_migration(pool, &migration.filename).await?;
    }

    Ok(())
}

pub fn default_migrations_dir() -> PathBuf {
    resolve_default_migrations_dir(
        std::env::current_exe().ok().as_deref(),
        Path::new(env!("CARGO_MANIFEST_DIR")),
    )
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct MigrationFile {
    filename: String,
    sql: String,
}

fn load_migrations(migrations_dir: &Path) -> std::io::Result<Vec<MigrationFile>> {
    let mut entries = Vec::new();
    for entry in fs::read_dir(migrations_dir)? {
        let entry = entry?;
        let path = entry.path();
        if !matches!(path.extension().and_then(|ext| ext.to_str()), Some("sql")) {
            continue;
        }

        let filename = path
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| std::io::Error::other("invalid migration filename"))?
            .to_owned();
        let sql = fs::read_to_string(&path)?;
        entries.push(MigrationFile { filename, sql });
    }

    entries.sort_by(|left, right| left.filename.cmp(&right.filename));
    Ok(entries)
}

async fn ensure_schema_migrations_table(pool: &MySqlPool) -> Result<(), sqlx::Error> {
    pool.execute(
        "create table if not exists schema_migrations (filename varchar(255) primary key, applied_at timestamp not null default current_timestamp)",
    )
    .await?;
    Ok(())
}

async fn maybe_backfill_schema_migrations(
    pool: &MySqlPool,
    migrations: &[MigrationFile],
) -> Result<(), sqlx::Error> {
    let recorded_count: i64 = sqlx::query_scalar("select count(*) from schema_migrations")
        .fetch_one(pool)
        .await?;
    let existing_tables: i64 = sqlx::query_scalar(
        "select count(*) from information_schema.tables where table_schema = DATABASE() and table_name <> 'schema_migrations'",
    )
    .fetch_one(pool)
    .await?;

    if recorded_count != 0 || existing_tables == 0 {
        return Ok(());
    }

    // Drop all existing tables if schema exists without migration history
    // Disable foreign key checks to allow dropping tables with dependencies
    pool.execute("SET FOREIGN_KEY_CHECKS = 0").await?;

    let tables: Vec<String> = sqlx::query_scalar(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name <> 'schema_migrations'"
    )
    .fetch_all(pool)
    .await?;

    for table in &tables {
        let drop_sql = format!("DROP TABLE IF EXISTS `{}`", table);
        pool.execute(drop_sql.as_str()).await?;
    }

    // Re-enable foreign key checks
    pool.execute("SET FOREIGN_KEY_CHECKS = 1").await?;

    // Return early since we dropped all tables and will run fresh migrations
    Ok(())
}

// Note: ensure_roles_if_possible removed - MySQL uses standard user management
// Note: roles_exist removed - MySQL uses standard user management

async fn is_migration_applied(pool: &MySqlPool, filename: &str) -> Result<bool, sqlx::Error> {
    let value: Option<i32> =
        sqlx::query_scalar("select 1 from schema_migrations where filename = ?")
            .bind(filename)
            .fetch_optional(pool)
            .await?;
    Ok(value.is_some())
}

async fn record_migration(pool: &MySqlPool, filename: &str) -> Result<(), sqlx::Error> {
    sqlx::query("insert ignore into schema_migrations (filename) values (?)")
        .bind(filename)
        .execute(pool)
        .await?;
    Ok(())
}

fn sanitize_migration_sql<'a>(sql: &'a str) -> Cow<'a, str> {
    // Note: GRANT statements already removed from migration files
    // No longer need to filter them out
    Cow::Borrowed(sql)
}

fn resolve_default_migrations_dir(current_exe: Option<&Path>, manifest_dir: &Path) -> PathBuf {
    if let Some(executable) = current_exe {
        if let Some(parent) = executable.parent() {
            let adjacent = parent.join("migrations");
            if adjacent.exists() {
                return adjacent;
            }
        }
    }

    manifest_dir
        .parent()
        .and_then(Path::parent)
        .unwrap_or(manifest_dir)
        .join("migrations")
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::{resolve_default_migrations_dir, sanitize_migration_sql};

    #[test]
    fn leaves_sql_unchanged() {
        let sql = "\
CREATE TABLE foo (id int);\n\
CREATE INDEX idx_foo_id ON foo(id);\n";

        let filtered = sanitize_migration_sql(sql);

        assert_eq!(filtered.as_ref(), sql);
    }

    #[test]
    fn prefers_executable_adjacent_migrations_dir_when_present() {
        let unique = format!(
            "ielts-migrations-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system time")
                .as_nanos()
        );
        let bin_dir = std::env::temp_dir().join(unique).join("app");
        let migrations_dir = bin_dir.join("migrations");
        std::fs::create_dir_all(&migrations_dir).expect("create migrations dir");
        let exe_path = bin_dir.join("migrate");

        let resolved = resolve_default_migrations_dir(Some(&exe_path), Path::new("/manifest/dir"));

        assert_eq!(resolved, migrations_dir);
        let _ = std::fs::remove_dir_all(bin_dir.parent().expect("temp test root"));
    }

    #[test]
    fn falls_back_to_manifest_relative_migrations_dir_when_adjacent_dir_is_missing() {
        let resolved = resolve_default_migrations_dir(
            Some(Path::new("/tmp/runtime/migrate")),
            Path::new("/workspace/backend/crates/infrastructure"),
        );

        assert_eq!(resolved, Path::new("/workspace/backend/migrations"));
    }

    #[test]
    fn student_attempt_presence_uses_fresh_schema_uuid_type_fallbacks() {
        let delivery_sql = std::fs::read_to_string("../../migrations/0006_delivery.sql")
            .expect("read delivery migration");
        let presence_sql =
            std::fs::read_to_string("../../migrations/0014_student_attempt_presence.sql")
                .expect("read student attempt presence migration");

        let parent_type =
            column_type(&delivery_sql, "student_attempts", "id").expect("student_attempts.id type");

        assert_eq!(parent_type, "VARCHAR(36)");
        assert!(presence_sql
            .contains("COALESCE(@student_attempt_presence_attempt_id_type, 'VARCHAR(36)')"));
        assert!(presence_sql
            .contains("COALESCE(@student_attempt_presence_schedule_id_type, 'VARCHAR(36)')"));
    }

    #[test]
    fn student_attempt_presence_attempt_id_is_derived_from_existing_parent_column() {
        let presence_sql =
            std::fs::read_to_string("../../migrations/0014_student_attempt_presence.sql")
                .expect("read student attempt presence migration");

        assert!(
            presence_sql.contains("information_schema.columns"),
            "presence migration must inspect the existing student_attempts.id definition"
        );
        assert!(presence_sql.contains("COLUMN_TYPE"));
        assert!(presence_sql.contains("CHARACTER_SET_NAME"));
        assert!(presence_sql.contains("COLLATION_NAME"));
        assert!(presence_sql.contains("TABLE_NAME = 'student_attempts'"));
        assert!(presence_sql.contains("COLUMN_NAME = 'id'"));
        assert!(presence_sql.contains("CONSTRAINT student_attempt_presence_attempt_fk"));
        assert!(
            !presence_sql.contains("attempt_id VARCHAR(36) PRIMARY KEY"),
            "hard-coding VARCHAR(36) is incompatible with legacy CHAR(36) parent columns"
        );
    }

    #[test]
    fn student_attempt_presence_avoids_select_into_user_variables() {
        let presence_sql =
            std::fs::read_to_string("../../migrations/0014_student_attempt_presence.sql")
                .expect("read student attempt presence migration");

        assert!(
            !presence_sql.contains("INTO @"),
            "TiDB rejects SELECT ... INTO @user_variable in startup migrations"
        );
        assert!(presence_sql.contains("SET @student_attempt_presence_attempt_id_type = ("));
        assert!(presence_sql.contains("SET @student_attempt_presence_schedule_id_type = ("));
    }

    fn column_type(sql: &str, table: &str, column: &str) -> Option<String> {
        let create_marker = format!("CREATE TABLE IF NOT EXISTS {table}");
        let table_sql = sql.split(&create_marker).nth(1)?;
        let column_marker = format!("{column} ");
        let column_line = table_sql
            .lines()
            .map(str::trim)
            .find(|line| line.starts_with(&column_marker))?;
        column_line
            .trim_start_matches(&column_marker)
            .split_whitespace()
            .next()
            .map(|value| value.trim_end_matches(',').to_owned())
    }
}
