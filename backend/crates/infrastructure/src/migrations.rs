use std::{
    borrow::Cow,
    fs,
    path::{Path, PathBuf},
};

use sqlx::{Executor, PgPool};

const ROLE_MIGRATION: &str = "0001_roles.sql";
const MANAGED_POSTGRES_ROLES: &[&str] = &["app_migrator", "app_runtime", "app_worker", "app_readonly"];

pub async fn run_startup_migrations(pool: &PgPool, migrations_dir: &Path) -> Result<(), sqlx::Error> {
    let migrations = load_migrations(migrations_dir).map_err(sqlx::Error::Io)?;

    ensure_schema_migrations_table(pool).await?;
    maybe_backfill_schema_migrations(pool, &migrations).await?;

    let mut roles_supported = roles_exist(pool).await?;
    if !is_migration_applied(pool, ROLE_MIGRATION).await? {
        ensure_roles_if_possible(pool).await?;
        roles_supported = roles_exist(pool).await?;
        record_migration(pool, ROLE_MIGRATION).await?;
    }

    for migration in migrations {
        if migration.filename == ROLE_MIGRATION || is_migration_applied(pool, &migration.filename).await? {
            continue;
        }

        let sql = sanitize_migration_sql(&migration.sql, roles_supported);
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

async fn ensure_schema_migrations_table(pool: &PgPool) -> Result<(), sqlx::Error> {
    pool.execute(
        "create table if not exists schema_migrations (filename text primary key, applied_at timestamptz not null default now())",
    )
    .await?;
    Ok(())
}

async fn maybe_backfill_schema_migrations(
    pool: &PgPool,
    migrations: &[MigrationFile],
) -> Result<(), sqlx::Error> {
    let recorded_count: i64 = sqlx::query_scalar("select count(*) from schema_migrations")
        .fetch_one(pool)
        .await?;
    let existing_tables: i64 = sqlx::query_scalar(
        "select count(*) from information_schema.tables where table_schema = 'public' and table_name <> 'schema_migrations'",
    )
    .fetch_one(pool)
    .await?;

    if recorded_count != 0 || existing_tables == 0 {
        return Ok(());
    }

    let has_exam_entities: bool =
        sqlx::query_scalar("select to_regclass('public.exam_entities') is not null")
            .fetch_one(pool)
            .await?;
    let has_shared_cache_entries: bool =
        sqlx::query_scalar("select to_regclass('public.shared_cache_entries') is not null")
            .fetch_one(pool)
            .await?;

    if !has_exam_entities || !has_shared_cache_entries {
        return Err(sqlx::Error::Protocol(
            "existing schema detected without migration history".into(),
        ));
    }

    for migration in migrations {
        record_migration(pool, &migration.filename).await?;
    }

    Ok(())
}

async fn ensure_roles_if_possible(pool: &PgPool) -> Result<(), sqlx::Error> {
    pool.execute(
        r#"
        DO $$
        BEGIN
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_migrator') THEN
                    CREATE ROLE app_migrator NOINHERIT LOGIN;
                END IF;
            EXCEPTION WHEN insufficient_privilege THEN
                RAISE NOTICE 'Skipping role creation for app_migrator due to insufficient privileges';
            END;

            BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
                    CREATE ROLE app_runtime NOINHERIT LOGIN;
                END IF;
            EXCEPTION WHEN insufficient_privilege THEN
                RAISE NOTICE 'Skipping role creation for app_runtime due to insufficient privileges';
            END;

            BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_worker') THEN
                    CREATE ROLE app_worker NOINHERIT LOGIN;
                END IF;
            EXCEPTION WHEN insufficient_privilege THEN
                RAISE NOTICE 'Skipping role creation for app_worker due to insufficient privileges';
            END;

            BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
                    CREATE ROLE app_readonly NOINHERIT LOGIN;
                END IF;
            EXCEPTION WHEN insufficient_privilege THEN
                RAISE NOTICE 'Skipping role creation for app_readonly due to insufficient privileges';
            END;
        END
        $$;
        "#,
    )
    .await?;
    Ok(())
}

async fn roles_exist(pool: &PgPool) -> Result<bool, sqlx::Error> {
    let count: i64 = sqlx::query_scalar(
        "select count(*) from pg_roles where rolname = any($1)",
    )
    .bind(MANAGED_POSTGRES_ROLES)
    .fetch_one(pool)
    .await?;
    Ok(count == MANAGED_POSTGRES_ROLES.len() as i64)
}

async fn is_migration_applied(pool: &PgPool, filename: &str) -> Result<bool, sqlx::Error> {
    let value: Option<i32> = sqlx::query_scalar("select 1 from schema_migrations where filename = $1")
        .bind(filename)
        .fetch_optional(pool)
        .await?;
    Ok(value.is_some())
}

async fn record_migration(pool: &PgPool, filename: &str) -> Result<(), sqlx::Error> {
    sqlx::query(
        "insert into schema_migrations (filename) values ($1) on conflict (filename) do nothing",
    )
    .bind(filename)
    .execute(pool)
    .await?;
    Ok(())
}

fn sanitize_migration_sql<'a>(sql: &'a str, roles_supported: bool) -> Cow<'a, str> {
    if roles_supported {
        return Cow::Borrowed(sql);
    }

    let filtered = sql
        .lines()
        .filter(|line| {
            let trimmed = line.trim_start();
            !(trimmed.starts_with("GRANT ")
                && (trimmed.contains(" TO app_") || trimmed.contains(" TO app_migrator")))
        })
        .collect::<Vec<_>>()
        .join("\n");

    Cow::Owned(filtered)
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
    fn strips_app_role_grants_when_roles_are_unavailable() {
        let sql = "\
CREATE TABLE foo (id int);\n\
GRANT SELECT ON foo TO app_runtime;\n\
GRANT EXECUTE ON FUNCTION bar() TO app_migrator, app_runtime, app_worker, app_readonly;\n\
CREATE INDEX idx_foo_id ON foo(id);\n";

        let filtered = sanitize_migration_sql(sql, false);

        assert!(!filtered.contains("GRANT SELECT ON foo TO app_runtime;"));
        assert!(!filtered.contains("GRANT EXECUTE ON FUNCTION bar() TO app_migrator"));
        assert!(filtered.contains("CREATE TABLE foo (id int);"));
        assert!(filtered.contains("CREATE INDEX idx_foo_id ON foo(id);"));
    }

    #[test]
    fn leaves_sql_unchanged_when_roles_are_available() {
        let sql = "GRANT SELECT ON foo TO app_runtime;\n";

        let filtered = sanitize_migration_sql(sql, true);

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
}
