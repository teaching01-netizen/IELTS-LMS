use std::{
    env, fs,
    path::{Path, PathBuf},
};

use chrono::{Duration, Utc};
use ielts_backend_domain::auth::{UserRole, UserState};
use ielts_backend_infrastructure::auth::{hash_password, random_token, sha256_hex};
use sqlx::{
    mysql::{MySqlConnectOptions, MySqlPoolOptions},
    Executor, MySqlPool,
};
use uuid::Uuid;

pub struct TestDatabase {
    db_name: String,
    pool: MySqlPool,
    drop_on_shutdown: bool,
}

impl TestDatabase {
    pub async fn new(migrations: &[&str]) -> Self {
        let (db_name, pool, drop_on_shutdown) =
            if let Ok(database_url) = env::var("TEST_DATABASE_URL") {
                eprintln!("TEST_DATABASE_URL found (redacted)");

                let base_db =
                    database_name_from_url(&database_url).unwrap_or_else(|| "test".to_owned());
                let db_name = format!("{base_db}_codex_test_{}", Uuid::new_v4().simple());
                let server_url = server_url_from_database_url(&database_url);

                let admin_pool = MySqlPoolOptions::new()
                    .max_connections(1)
                    .connect(&server_url)
                    .await
                    .expect("connect to TiDB/MySQL server");

                let created = sqlx::query(&format!("CREATE DATABASE {}", db_name))
                    .execute(&admin_pool)
                    .await
                    .is_ok();

                let effective_db = if created { db_name.clone() } else { base_db };
                let effective_url = if created {
                    format!("{}/{}", server_url, effective_db)
                } else {
                    database_url.clone()
                };

                drop(admin_pool);
                let pool = MySqlPoolOptions::new()
                    .max_connections(1)
                    .connect(&effective_url)
                    .await
                    .expect("connect to test database");

                eprintln!("Connected to database: {}", effective_db);
                (effective_db, pool, created)
            } else {
                eprintln!("TEST_DATABASE_URL not found, using local MySQL");
                // Local testing - create a new database
                let db_name = format!(
                    "codex_test_{}",
                    Uuid::new_v4().hyphenated().to_string().replace("-", "_")
                );
                let admin_options = connect_options("root", "ielts");
                let admin_pool = MySqlPoolOptions::new()
                    .max_connections(1)
                    .connect_with(admin_options)
                    .await
                    .expect("connect to local MySQL/TiDB");

                admin_pool
                    .execute(format!("CREATE DATABASE {}", db_name).as_str())
                    .await
                    .expect("create test database");

                let database_options = connect_options("root", &db_name);
                let pool = MySqlPoolOptions::new()
                    .max_connections(1)
                    .connect_with(database_options)
                    .await
                    .expect("connect to test database");

                (db_name, pool, true)
            };

        for migration in migrations {
            let sql = fs::read_to_string(migration_path(migration)).expect("read migration");
            // When using an existing remote database (no permission to create a new one),
            // avoid re-applying migrations if tables already exist.
            if env::var("TEST_DATABASE_URL").is_ok() && !drop_on_shutdown {
                let table_exists: bool = sqlx::query_scalar::<_, bool>(
                    "SELECT COUNT(*) > 0 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'exam_entities'",
                )
                .fetch_one(&pool)
                .await
                .unwrap_or(false);
                if table_exists {
                    continue;
                }
            }
            pool.execute(sql.as_str()).await.expect("apply migration");
        }

        Self {
            db_name,
            pool,
            drop_on_shutdown,
        }
    }

    pub fn pool(&self) -> &MySqlPool {
        &self.pool
    }

    #[allow(dead_code)]
    pub fn database_url(&self) -> String {
        format!("mysql://root:root@127.0.0.1:4000/{}", self.db_name)
    }

    pub async fn shutdown(self) {
        if !self.drop_on_shutdown {
            return;
        }

        if let Ok(database_url) = env::var("TEST_DATABASE_URL") {
            let server_url = server_url_from_database_url(&database_url);
            let admin_pool = MySqlPoolOptions::new()
                .max_connections(1)
                .connect(&server_url)
                .await
                .expect("reconnect to TiDB/MySQL server");
            admin_pool
                .execute(format!("DROP DATABASE IF EXISTS {}", self.db_name).as_str())
                .await
                .expect("drop test database");
            return;
        }

        let admin_options = connect_options("root", "ielts");
        let admin_pool = MySqlPoolOptions::new()
            .max_connections(1)
            .connect_with(admin_options)
            .await
            .expect("reconnect to local MySQL/TiDB");

        admin_pool
            .execute(format!("DROP DATABASE IF EXISTS {}", self.db_name).as_str())
            .await
            .expect("drop test database");
    }
}

#[derive(Clone, Debug)]
pub struct TestAuthContext {
    pub user_id: Uuid,
    pub role: UserRole,
    pub email: String,
    pub display_name: String,
    pub session_token: String,
    pub csrf_token: String,
}

impl TestAuthContext {
    pub fn with_auth(&self, builder: axum::http::request::Builder) -> axum::http::request::Builder {
        builder.header("cookie", format!("__Host-session={}", self.session_token))
    }

    pub fn with_csrf(&self, builder: axum::http::request::Builder) -> axum::http::request::Builder {
        self.with_auth(builder)
            .header("x-csrf-token", self.csrf_token.clone())
    }
}

pub async fn create_authenticated_user(
    pool: &MySqlPool,
    role: UserRole,
    email: &str,
    display_name: &str,
) -> TestAuthContext {
    let user_id = Uuid::new_v4();
    let session_token = random_token(32);
    let csrf_token = random_token(24);
    let password_hash = hash_password("Password123!").expect("hash password");
    let now = Utc::now();

    sqlx::query(
        r#"
        INSERT INTO users (
            id, email, display_name, role, state, failed_login_count, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, 0, ?, ?)
        "#,
    )
    .bind(user_id.to_string())
    .bind(email)
    .bind(display_name)
    .bind(role_sql(&role))
    .bind(state_sql(&UserState::Active))
    .bind(now)
    .bind(now)
    .execute(pool)
    .await
    .expect("insert user");

    sqlx::query(
        "INSERT INTO user_password_credentials (user_id, password_hash, updated_at) VALUES (?, ?, ?)",
    )
    .bind(user_id.to_string())
    .bind(password_hash)
    .bind(now)
    .execute(pool)
    .await
    .expect("insert password credential");

    match role {
        UserRole::Student => {
            sqlx::query(
                r#"
                INSERT INTO student_profiles (user_id, student_id, full_name, email, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                "#,
            )
            .bind(user_id.to_string())
            .bind(email.split('@').next().unwrap_or("student"))
            .bind(display_name)
            .bind(email)
            .bind(now)
            .bind(now)
            .execute(pool)
            .await
            .expect("insert student profile");
        }
        _ => {
            sqlx::query(
                r#"
                INSERT INTO staff_profiles (user_id, full_name, email, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?)
                "#,
            )
            .bind(user_id.to_string())
            .bind(display_name)
            .bind(email)
            .bind(now)
            .bind(now)
            .execute(pool)
            .await
            .expect("insert staff profile");
        }
    }

    sqlx::query(
        r#"
        INSERT INTO user_sessions (
            id, user_id, session_token_hash, csrf_token, role_snapshot, issued_at,
            last_seen_at, expires_at, idle_timeout_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        "#,
    )
    .bind(Uuid::new_v4().to_string())
    .bind(user_id.to_string())
    .bind(sha256_hex(&session_token))
    .bind(&csrf_token)
    .bind(role_sql(&role))
    .bind(now)
    .bind(now)
    .bind(now + Duration::hours(12))
    .bind(match role {
        UserRole::Student => now + Duration::minutes(60),
        _ => now + Duration::minutes(30),
    })
    .execute(pool)
    .await
    .expect("insert session");

    TestAuthContext {
        user_id,
        role,
        email: email.to_owned(),
        display_name: display_name.to_owned(),
        session_token,
        csrf_token,
    }
}

pub async fn assign_staff_to_schedule(
    pool: &MySqlPool,
    schedule_id: Uuid,
    user_id: Uuid,
    role: &str,
) {
    sqlx::query(
        r#"
        INSERT INTO schedule_staff_assignments (
            id, schedule_id, user_id, actor_id, role, granted_by, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, NOW())
        "#,
    )
    .bind(Uuid::new_v4().to_string())
    .bind(schedule_id.to_string())
    .bind(user_id.to_string())
    .bind(user_id.to_string())
    .bind(role)
    .bind(user_id.to_string())
    .execute(pool)
    .await
    .expect("assign staff");
}

pub async fn bind_student_registration(
    pool: &MySqlPool,
    schedule_id: Uuid,
    student_key: &str,
    user_id: Uuid,
) {
    sqlx::query(
        r#"
        UPDATE schedule_registrations
        SET user_id = ?, actor_id = ?, updated_at = NOW()
        WHERE schedule_id = ? AND student_key = ?
        "#,
    )
    .bind(user_id.to_string())
    .bind(user_id.to_string())
    .bind(schedule_id.to_string())
    .bind(student_key)
    .execute(pool)
    .await
    .expect("bind student registration");
}

pub async fn create_student_registration(
    pool: &MySqlPool,
    schedule_id: Uuid,
    user_id: Uuid,
    student_id: &str,
    student_name: &str,
    student_email: &str,
) -> String {
    let student_key = format!("student-{schedule_id}-{student_id}");
    sqlx::query(
        r#"
        INSERT INTO schedule_registrations (
            id, schedule_id, user_id, actor_id, student_key, student_id, student_name, student_email,
            access_state, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'checked_in', NOW(), NOW())
        "#,
    )
    .bind(Uuid::new_v4().to_string())
    .bind(schedule_id.to_string())
    .bind(user_id.to_string())
    .bind(user_id.to_string())
    .bind(&student_key)
    .bind(student_id)
    .bind(student_name)
    .bind(student_email)
    .execute(pool)
    .await
    .expect("create student registration");
    student_key
}

fn role_sql(role: &UserRole) -> &'static str {
    match role {
        UserRole::Admin => "admin",
        UserRole::Builder => "builder",
        UserRole::Proctor => "proctor",
        UserRole::Grader => "grader",
        UserRole::Student => "student",
    }
}

fn state_sql(state: &UserState) -> &'static str {
    match state {
        UserState::Active => "active",
        UserState::Disabled => "disabled",
        UserState::Locked => "locked",
        UserState::PendingActivation => "pending_activation",
    }
}

fn connect_options(user: &str, database: &str) -> MySqlConnectOptions {
    // Read from environment variable if set (for TiDB Cloud testing)
    if let Ok(database_url) = env::var("TEST_DATABASE_URL") {
        // Parse the database URL: mysql://user:pass@host:port/database
        let url = database_url
            .strip_prefix("mysql://")
            .expect("invalid database URL");

        let parts: Vec<&str> = url.split('@').collect();
        let auth_parts: Vec<&str> = parts[0].split(':').collect();
        let host_parts: Vec<&str> = parts[1].split('/').collect();
        let host_port: Vec<&str> = host_parts[0].split(':').collect();

        let username = auth_parts[0];
        let password = auth_parts[1];
        let host = host_port[0];
        let port = host_port[1].parse::<u16>().unwrap_or(4000);
        let db = if host_parts.len() > 1 {
            host_parts[1]
        } else {
            database
        };

        return MySqlConnectOptions::new()
            .host(host)
            .port(port)
            .username(username)
            .password(password)
            .database(db);
    }

    // Default local connection
    MySqlConnectOptions::new()
        .host("127.0.0.1")
        .port(4000)
        .username(user)
        .password("root")
        .database(database)
}

fn server_url_from_database_url(database_url: &str) -> String {
    database_url
        .rsplit_once('/')
        .map(|(server, _)| server.to_owned())
        .unwrap_or_else(|| database_url.to_owned())
}

fn database_name_from_url(database_url: &str) -> Option<String> {
    database_url
        .rsplit_once('/')
        .map(|(_, db)| db.split('?').next().unwrap_or(db).to_owned())
        .filter(|db| !db.is_empty())
}

fn migration_path(name: &str) -> PathBuf {
    backend_root().join("migrations").join(name)
}

fn backend_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("crate dir parent")
        .parent()
        .expect("backend root")
        .to_path_buf()
}
