use std::{
    borrow::Cow,
    fs,
    path::{Path, PathBuf},
};

use sqlx::{Executor, MySqlConnection, MySqlPool};

const ROLE_MIGRATION: &str = "0001_roles.sql";
const STARTUP_MIGRATIONS_LOCK_NAME: &str = "ielts_backend_startup_migrations_lock";
const STARTUP_MIGRATIONS_LOCK_TIMEOUT_SECS: i32 = 300;

pub async fn run_startup_migrations(
    pool: &MySqlPool,
    migrations_dir: &Path,
) -> Result<(), sqlx::Error> {
    let mut conn = pool.acquire().await?;
    acquire_startup_migration_lock(conn.as_mut()).await?;
    let run_result = run_startup_migrations_on_connection(conn.as_mut(), migrations_dir).await;
    let release_result = release_startup_migration_lock(conn.as_mut()).await;

    match (run_result, release_result) {
        (Err(run_err), _) => Err(run_err),
        (Ok(()), Ok(())) => Ok(()),
        (Ok(()), Err(release_err)) => Err(release_err),
    }
}

async fn run_startup_migrations_on_connection(
    conn: &mut MySqlConnection,
    migrations_dir: &Path,
) -> Result<(), sqlx::Error> {
    let migrations = load_migrations(migrations_dir).map_err(sqlx::Error::Io)?;

    ensure_schema_migrations_table(conn).await?;
    maybe_backfill_schema_migrations(conn, &migrations).await?;

    // Note: Role management removed - MySQL uses standard user management
    // The 0001_roles.sql migration is now a no-op comment file
    if !is_migration_applied(conn, ROLE_MIGRATION).await? {
        record_migration(conn, ROLE_MIGRATION).await?;
    }

    for migration in migrations {
        if migration.filename == ROLE_MIGRATION
            || is_migration_applied(conn, &migration.filename).await?
        {
            continue;
        }

        let sql = sanitize_migration_sql(&migration.sql);
        execute_migration_statements(conn, sql.as_ref()).await?;
        record_migration(conn, &migration.filename).await?;
    }

    Ok(())
}

async fn execute_migration_statements(
    conn: &mut MySqlConnection,
    sql: &str,
) -> Result<(), sqlx::Error> {
    for statement in split_sql_statements(sql) {
        let trimmed = statement.trim();
        if trimmed.is_empty() {
            continue;
        }

        conn.execute(trimmed).await?;
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

async fn ensure_schema_migrations_table(conn: &mut MySqlConnection) -> Result<(), sqlx::Error> {
    conn.execute(
        "create table if not exists schema_migrations (filename varchar(255) primary key, applied_at timestamp not null default current_timestamp)",
    )
    .await?;
    Ok(())
}

async fn maybe_backfill_schema_migrations(
    conn: &mut MySqlConnection,
    migrations: &[MigrationFile],
) -> Result<(), sqlx::Error> {
    let recorded_count: i64 = sqlx::query_scalar("select count(*) from schema_migrations")
        .fetch_one(&mut *conn)
        .await?;
    let existing_tables: i64 = sqlx::query_scalar(
        "select count(*) from information_schema.tables where table_schema = DATABASE() and table_name <> 'schema_migrations'",
    )
    .fetch_one(&mut *conn)
    .await?;

    if recorded_count != 0 || existing_tables == 0 {
        return Ok(());
    }

    // Drop all existing tables if schema exists without migration history
    // Disable foreign key checks to allow dropping tables with dependencies
    conn.execute("SET FOREIGN_KEY_CHECKS = 0").await?;

    let tables: Vec<String> = sqlx::query_scalar(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name <> 'schema_migrations'"
    )
    .fetch_all(&mut *conn)
    .await?;

    for table in &tables {
        let drop_sql = format!("DROP TABLE IF EXISTS `{}`", table);
        conn.execute(drop_sql.as_str()).await?;
    }

    // Re-enable foreign key checks
    conn.execute("SET FOREIGN_KEY_CHECKS = 1").await?;

    // Return early since we dropped all tables and will run fresh migrations
    Ok(())
}

// Note: ensure_roles_if_possible removed - MySQL uses standard user management
// Note: roles_exist removed - MySQL uses standard user management

async fn is_migration_applied(conn: &mut MySqlConnection, filename: &str) -> Result<bool, sqlx::Error> {
    let value: Option<i32> =
        sqlx::query_scalar("select 1 from schema_migrations where filename = ?")
            .bind(filename)
            .fetch_optional(&mut *conn)
            .await?;
    Ok(value.is_some())
}

async fn record_migration(conn: &mut MySqlConnection, filename: &str) -> Result<(), sqlx::Error> {
    sqlx::query("insert ignore into schema_migrations (filename) values (?)")
        .bind(filename)
        .execute(&mut *conn)
        .await?;
    Ok(())
}

async fn acquire_startup_migration_lock(conn: &mut MySqlConnection) -> Result<(), sqlx::Error> {
    let lock_state: Option<i8> = sqlx::query_scalar("SELECT GET_LOCK(?, ?)")
        .bind(STARTUP_MIGRATIONS_LOCK_NAME)
        .bind(STARTUP_MIGRATIONS_LOCK_TIMEOUT_SECS)
        .fetch_one(&mut *conn)
        .await?;

    match lock_state {
        Some(1) => Ok(()),
        Some(0) => Err(sqlx::Error::Protocol(
            "Timed out waiting for startup migration advisory lock.".to_owned(),
        )),
        _ => Err(sqlx::Error::Protocol(
            "Failed to acquire startup migration advisory lock.".to_owned(),
        )),
    }
}

async fn release_startup_migration_lock(conn: &mut MySqlConnection) -> Result<(), sqlx::Error> {
    let lock_state: Option<i8> = sqlx::query_scalar("SELECT RELEASE_LOCK(?)")
        .bind(STARTUP_MIGRATIONS_LOCK_NAME)
        .fetch_one(&mut *conn)
        .await?;

    match lock_state {
        Some(1) | Some(0) | None => Ok(()),
        _ => Err(sqlx::Error::Protocol(
            "Failed to release startup migration advisory lock.".to_owned(),
        )),
    }
}

fn sanitize_migration_sql<'a>(sql: &'a str) -> Cow<'a, str> {
    // Note: GRANT statements already removed from migration files
    // No longer need to filter them out
    Cow::Borrowed(sql)
}

fn split_sql_statements(sql: &str) -> Vec<String> {
    let mut statements = Vec::new();
    let mut current = String::new();

    let mut chars = sql.chars().peekable();
    let mut in_single_quote = false;
    let mut in_double_quote = false;
    let mut in_backtick = false;
    let mut in_line_comment = false;
    let mut in_block_comment = false;

    while let Some(ch) = chars.next() {
        if in_line_comment {
            current.push(ch);
            if ch == '\n' {
                in_line_comment = false;
            }
            continue;
        }

        if in_block_comment {
            current.push(ch);
            if ch == '*' && matches!(chars.peek(), Some('/')) {
                current.push(chars.next().unwrap_or('/'));
                in_block_comment = false;
            }
            continue;
        }

        if in_single_quote {
            current.push(ch);
            if ch == '\\' {
                if let Some(next) = chars.next() {
                    current.push(next);
                }
                continue;
            }
            if ch == '\'' {
                if matches!(chars.peek(), Some('\'')) {
                    current.push(chars.next().unwrap_or('\''));
                    continue;
                }
                in_single_quote = false;
            }
            continue;
        }

        if in_double_quote {
            current.push(ch);
            if ch == '\\' {
                if let Some(next) = chars.next() {
                    current.push(next);
                }
                continue;
            }
            if ch == '"' {
                if matches!(chars.peek(), Some('"')) {
                    current.push(chars.next().unwrap_or('"'));
                    continue;
                }
                in_double_quote = false;
            }
            continue;
        }

        if in_backtick {
            current.push(ch);
            if ch == '`' {
                in_backtick = false;
            }
            continue;
        }

        if ch == '-' && matches!(chars.peek(), Some('-')) {
            let mut lookahead = chars.clone();
            lookahead.next();
            if matches!(
                lookahead.peek(),
                Some(' ' | '\t' | '\n' | '\r' | '\u{000C}' | '\u{000B}')
            ) {
                current.push(ch);
                current.push(chars.next().unwrap_or('-'));
                in_line_comment = true;
                continue;
            }
        }

        if ch == '#' {
            current.push(ch);
            in_line_comment = true;
            continue;
        }

        if ch == '/' && matches!(chars.peek(), Some('*')) {
            current.push(ch);
            current.push(chars.next().unwrap_or('*'));
            in_block_comment = true;
            continue;
        }

        if ch == '\'' {
            in_single_quote = true;
            current.push(ch);
            continue;
        }

        if ch == '"' {
            in_double_quote = true;
            current.push(ch);
            continue;
        }

        if ch == '`' {
            in_backtick = true;
            current.push(ch);
            continue;
        }

        if ch == ';' {
            let stmt = current.trim();
            if !stmt.is_empty() {
                statements.push(stmt.to_owned());
            }
            current.clear();
            continue;
        }

        current.push(ch);
    }

    let trailing = current.trim();
    if !trailing.is_empty() {
        statements.push(trailing.to_owned());
    }

    statements
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

    use super::{resolve_default_migrations_dir, sanitize_migration_sql, split_sql_statements};

    #[test]
    fn leaves_sql_unchanged() {
        let sql = "\
CREATE TABLE foo (id int);\n\
CREATE INDEX idx_foo_id ON foo(id);\n";

        let filtered = sanitize_migration_sql(sql);

        assert_eq!(filtered.as_ref(), sql);
    }

    #[test]
    fn splits_multiple_statements_and_trims_empty_entries() {
        let sql = "SET @a = 1;;\nSELECT @a;\n";
        let statements = split_sql_statements(sql);
        assert_eq!(statements, vec!["SET @a = 1", "SELECT @a"]);
    }

    #[test]
    fn does_not_split_semicolons_inside_strings_or_comments() {
        let sql = "\
SET @q := 'CREATE INDEX idx ON t(c);';\n\
-- comment with ; inside\n\
SET @x := \"a;b\";\n\
/* block ; comment */\n\
SELECT @q, @x;\n";

        let statements = split_sql_statements(sql);
        assert_eq!(
            statements,
            vec![
                "SET @q := 'CREATE INDEX idx ON t(c);'",
                "-- comment with ; inside\nSET @x := \"a;b\"",
                "/* block ; comment */\nSELECT @q, @x",
            ]
        );
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
