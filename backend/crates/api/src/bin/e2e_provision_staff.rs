use std::{
    env,
    fs,
    path::{Path, PathBuf},
};

use chrono::Utc;
use ielts_backend_domain::auth::UserRole;
use ielts_backend_infrastructure::auth::hash_password;
use serde::Deserialize;
use serde::Serialize;
use sqlx::{mysql::MySqlPoolOptions, MySqlPool};
use uuid::Uuid;

#[derive(Debug)]
struct Args {
    schedule_id: Option<String>,
    target_path: PathBuf,
    output_creds_path: PathBuf,
    granted_by: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProdTarget {
    editor: StaffTarget,
    proctors: Vec<StaffTarget>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StaffTarget {
    email: String,
    display_name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OutputCreds {
    editor: OutputCredEntry,
    proctors: Vec<OutputCredEntry>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct OutputCredEntry {
    email: String,
    password: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExistingCreds {
    editor: OutputCredEntry,
    proctors: Vec<OutputCredEntry>,
}

fn usage() -> &'static str {
    r#"Usage:
  DATABASE_URL='mysql://...' cargo run -p ielts-backend-api --bin e2e_provision_staff -- \
    [--schedule-id <uuid>] \
    [--target e2e/prod-data/prod-target.json] \
    [--output-creds e2e/prod-data/prod-creds.json] \
    [--granted-by e2e-admin]

Notes:
  - This tool writes plaintext passwords to the output creds file. Keep it untracked/secret.
  - It creates/updates 1 editor (admin) + 10 proctors (proctor).
  - If --schedule-id is provided, it assigns all proctors to that schedule.
"#
}

fn parse_args() -> Args {
    let mut schedule_id: Option<String> = None;
    let mut target_path: PathBuf =
        PathBuf::from("e2e/prod-data/prod-target.json");
    let mut output_creds_path: PathBuf =
        PathBuf::from("e2e/prod-data/prod-creds.json");
    let mut granted_by: String = "e2e_provision_staff".to_owned();

    let mut iter = env::args().skip(1);
    while let Some(arg) = iter.next() {
        match arg.as_str() {
            "--schedule-id" => {
                schedule_id = iter.next();
            }
            "--target" => {
                let Some(value) = iter.next() else {
                    eprintln!("Missing value for --target");
                    eprintln!("{usage}", usage = usage());
                    std::process::exit(2);
                };
                target_path = PathBuf::from(value);
            }
            "--output-creds" => {
                let Some(value) = iter.next() else {
                    eprintln!("Missing value for --output-creds");
                    eprintln!("{usage}", usage = usage());
                    std::process::exit(2);
                };
                output_creds_path = PathBuf::from(value);
            }
            "--granted-by" => {
                let Some(value) = iter.next() else {
                    eprintln!("Missing value for --granted-by");
                    eprintln!("{usage}", usage = usage());
                    std::process::exit(2);
                };
                granted_by = value;
            }
            "--help" | "-h" => {
                println!("{usage}", usage = usage());
                std::process::exit(0);
            }
            other => {
                eprintln!("Unknown argument: {other}");
                eprintln!("{usage}", usage = usage());
                std::process::exit(2);
            }
        }
    }

    Args {
        schedule_id,
        target_path,
        output_creds_path,
        granted_by,
    }
}

fn read_target(path: &Path) -> ProdTarget {
    let raw = fs::read_to_string(path).unwrap_or_else(|err| {
        eprintln!("Failed to read target file {}: {err}", path.display());
        std::process::exit(1);
    });
    serde_json::from_str::<ProdTarget>(&raw).unwrap_or_else(|err| {
        eprintln!("Invalid target JSON {}: {err}", path.display());
        std::process::exit(1);
    })
}

fn generate_password(label: &str) -> String {
    // Avoid adding extra RNG deps; UUIDv4 is sufficiently unpredictable for ephemeral E2E creds.
    format!("E2E-{label}-{}-{}", Uuid::new_v4(), Uuid::new_v4())
}

fn normalize_database_url(url: &str) -> String {
    // Common operator typo: `.../db&ssl-mode=REQUIRED` (missing `?` before query string).
    // sqlx will treat `db&ssl-mode=REQUIRED` as the database name, causing "Unknown database".
    let mut url = url.to_owned();
    if !url.contains('?') {
        let ssl_param_pos = url
            .find("&ssl-mode=")
            .or_else(|| url.find("&sslmode="));
        if let Some(pos) = ssl_param_pos {
            let last_slash = url.rfind('/').unwrap_or(0);
            if pos > last_slash {
                url.replace_range(pos..pos + 1, "?");
            }
        }
    }

    // TiDB Cloud commonly requires TLS; sqlx uses the `ssl-mode` query param for MySQL.
    let lower = url.to_ascii_lowercase();
    if !lower.contains("tidbcloud.com") {
        return url;
    }
    if lower.contains("ssl-mode=") || lower.contains("sslmode=") {
        return url;
    }
    if url.contains('?') {
        format!("{url}&ssl-mode=REQUIRED")
    } else {
        format!("{url}?ssl-mode=REQUIRED")
    }
}

fn read_existing_creds(path: &Path) -> Option<ExistingCreds> {
    let raw = fs::read_to_string(path).ok()?;
    serde_json::from_str::<ExistingCreds>(&raw).ok()
}

fn pick_existing_password(existing: &Option<ExistingCreds>, email: &str) -> Option<String> {
    let existing = existing.as_ref()?;
    let email_norm = email.trim().to_ascii_lowercase();
    if existing.editor.email.trim().to_ascii_lowercase() == email_norm {
        return Some(existing.editor.password.clone());
    }
    existing
        .proctors
        .iter()
        .find(|entry| entry.email.trim().to_ascii_lowercase() == email_norm)
        .map(|entry| entry.password.clone())
}

async fn ensure_user(
    pool: &MySqlPool,
    email: &str,
    display_name: &str,
    role: UserRole,
    password: &str,
) -> Result<String, sqlx::Error> {
    let email_norm = email.trim().to_ascii_lowercase();

    let existing_id: Option<String> = sqlx::query_scalar("SELECT id FROM users WHERE email = ? LIMIT 1")
        .bind(&email_norm)
        .fetch_optional(pool)
        .await?;

    let user_id = existing_id.unwrap_or_else(|| Uuid::new_v4().to_string());

    let role_value = match role {
        UserRole::Admin => "admin",
        UserRole::Builder => "builder",
        UserRole::Proctor => "proctor",
        UserRole::Grader => "grader",
        UserRole::Student => "student",
    };

    sqlx::query(
        r#"
        INSERT INTO users (
            id, email, display_name, role, state, failed_login_count, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, 0, NOW(), NOW())
        ON DUPLICATE KEY UPDATE
            display_name = VALUES(display_name),
            role = VALUES(role),
            state = VALUES(state),
            updated_at = NOW()
        "#,
    )
    .bind(&user_id)
    .bind(&email_norm)
    .bind(display_name)
    .bind(role_value)
    .bind("active")
    .execute(pool)
    .await?;

    let password_hash = hash_password(password).expect("hash password");
    sqlx::query(
        r#"
        INSERT INTO user_password_credentials (user_id, password_hash, updated_at)
        VALUES (?, ?, NOW())
        ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), updated_at = VALUES(updated_at)
        "#,
    )
    .bind(&user_id)
    .bind(password_hash)
    .execute(pool)
    .await?;

    // Staff profiles are optional for auth, but improve UI display consistency.
    sqlx::query(
        r#"
        INSERT INTO staff_profiles (user_id, staff_code, full_name, email, created_at, updated_at)
        VALUES (?, NULL, ?, ?, NOW(), NOW())
        ON DUPLICATE KEY UPDATE full_name = VALUES(full_name), email = VALUES(email), updated_at = NOW()
        "#,
    )
    .bind(&user_id)
    .bind(display_name)
    .bind(&email_norm)
    .execute(pool)
    .await?;

    Ok(user_id)
}

async fn ensure_proctor_assignment(
    pool: &MySqlPool,
    schedule_id: &str,
    proctor_user_id: &str,
    actor_id: &str,
    granted_by: &str,
) -> Result<(), sqlx::Error> {
    let existing: Option<String> = sqlx::query_scalar(
        r#"
        SELECT id
        FROM schedule_staff_assignments
        WHERE schedule_id = ?
          AND user_id = ?
          AND role = 'proctor'
          AND revoked_at IS NULL
        LIMIT 1
        "#,
    )
    .bind(schedule_id)
    .bind(proctor_user_id)
    .fetch_optional(pool)
    .await?;

    if existing.is_some() {
        return Ok(());
    }

    sqlx::query(
        r#"
        INSERT INTO schedule_staff_assignments (
            id, schedule_id, actor_id, role, granted_by, created_at, revoked_at, user_id
        )
        VALUES (?, ?, ?, 'proctor', ?, NOW(), NULL, ?)
        "#,
    )
    .bind(Uuid::new_v4().to_string())
    .bind(schedule_id)
    .bind(actor_id)
    .bind(granted_by)
    .bind(proctor_user_id)
    .execute(pool)
    .await?;

    Ok(())
}

#[tokio::main]
async fn main() {
    let args = parse_args();

    if env::var("E2E_ALLOW_PROD_DB_MUTATIONS").ok().as_deref() != Some("true") {
        eprintln!(
            "Refusing to mutate DATABASE_URL without explicit consent.\n\
Set E2E_ALLOW_PROD_DB_MUTATIONS=true if and only if this is a dedicated E2E database."
        );
        std::process::exit(2);
    }

    let database_url = env::var("DATABASE_URL").unwrap_or_else(|_| {
        eprintln!("DATABASE_URL is required.");
        std::process::exit(2);
    });
    let database_url = normalize_database_url(&database_url);

    let pool = MySqlPoolOptions::new()
        .max_connections(5)
        .acquire_timeout(std::time::Duration::from_secs(30))
        .idle_timeout(std::time::Duration::from_secs(600))
        .max_lifetime(std::time::Duration::from_secs(1800))
        .test_before_acquire(true)
        .connect(&database_url)
        .await
        .unwrap_or_else(|err| {
            eprintln!("Failed to connect to DATABASE_URL: {err}");
            std::process::exit(1);
        });

    let target = read_target(&args.target_path);
    if target.proctors.len() != 10 {
        eprintln!("Target file must contain exactly 10 proctors.");
        std::process::exit(2);
    }

    let existing = read_existing_creds(&args.output_creds_path);
    let editor_password = pick_existing_password(&existing, &target.editor.email)
        .unwrap_or_else(|| generate_password("editor"));
    let editor_id = ensure_user(
        &pool,
        &target.editor.email,
        &target.editor.display_name,
        UserRole::Admin,
        &editor_password,
    )
    .await
    .unwrap_or_else(|err| {
        eprintln!("Failed to ensure editor user: {err}");
        std::process::exit(1);
    });

    let mut proctor_creds: Vec<OutputCredEntry> = Vec::with_capacity(10);

    for (index, proctor) in target.proctors.iter().enumerate() {
        let password = pick_existing_password(&existing, &proctor.email)
            .unwrap_or_else(|| generate_password(&format!("proctor{:02}", index + 1)));
        let user_id = ensure_user(
            &pool,
            &proctor.email,
            &proctor.display_name,
            UserRole::Proctor,
            &password,
        )
        .await
        .unwrap_or_else(|err| {
            eprintln!("Failed to ensure proctor {}: {err}", proctor.email);
            std::process::exit(1);
        });

        if let Some(schedule_id) = &args.schedule_id {
            ensure_proctor_assignment(
                &pool,
                schedule_id,
                &user_id,
                &proctor.email,
                &args.granted_by,
            )
            .await
            .unwrap_or_else(|err| {
                eprintln!("Failed to assign proctor {} to schedule: {err}", proctor.email);
                std::process::exit(1);
            });
        }

        proctor_creds.push(OutputCredEntry {
            email: proctor.email.clone(),
            password,
        });
    }

    let output = OutputCreds {
        editor: OutputCredEntry {
            email: target.editor.email.clone(),
            password: editor_password,
        },
        proctors: proctor_creds,
    };

    if let Some(parent) = args.output_creds_path.parent() {
        std::fs::create_dir_all(parent).ok();
    }

    fs::write(
        &args.output_creds_path,
        serde_json::to_string_pretty(&output).expect("serialize creds"),
    )
    .unwrap_or_else(|err| {
        eprintln!(
            "Failed to write creds file {}: {err}",
            args.output_creds_path.display()
        );
        std::process::exit(1);
    });

    // Do not print passwords to stdout.
    println!(
        "Provisioned staff at {}. Wrote creds to {}. Editor user id={}.",
        Utc::now().to_rfc3339(),
        args.output_creds_path.display(),
        editor_id
    );
}
