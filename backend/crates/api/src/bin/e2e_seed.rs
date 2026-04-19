use std::{
    env,
    fs,
    path::{Path, PathBuf},
};

use chrono::{Duration, Utc};
use ielts_backend_application::{
    builder::BuilderService,
    scheduling::SchedulingService,
};
use ielts_backend_domain::{
    auth::{UserRole, UserState},
    exam::{CreateExamRequest, ExamType, PublishExamRequest, SaveDraftRequest, Visibility},
    schedule::{CreateScheduleRequest, RuntimeCommandAction, RuntimeCommandRequest},
};
use ielts_backend_infrastructure::{
    actor_context::{ActorContext, ActorRole},
    auth::{hash_password, random_token, session_expiry, sha256_hex},
    config::AppConfig,
};
use serde::Serialize;
use serde_json::{json, Value};
use sqlx::{mysql::MySqlPoolOptions, MySqlPool};
use uuid::Uuid;

const BUILDER_EMAIL: &str = "e2e.builder@example.com";
const BUILDER_NAME: &str = "E2E Builder";
const STUDENT_EMAIL: &str = "e2e.student@example.com";
const STUDENT_NAME: &str = "Alice Candidate";
const STUDENT_CANDIDATE_ID: &str = "alice";
const UNREGISTERED_STUDENT_EMAIL: &str = "e2e.unregistered.student@example.com";
const UNREGISTERED_STUDENT_NAME: &str = "Bob Candidate";
const UNREGISTERED_STUDENT_CANDIDATE_ID: &str = "bob";
const ADMIN_OPERATOR_EMAIL: &str = "e2e.admin.operator@example.com";
const ADMIN_OPERATOR_NAME: &str = "E2E Admin Operator";
const ADMIN_EMAIL: &str = "e2e.admin@example.com";
const ADMIN_NAME: &str = "E2E Admin";
const ADMIN_ACTIVATION_PASSWORD: &str = "Password123!";
const ADMIN_PASSWORD_RESET_PASSWORD: &str = "Password456!";
const BUILDER_EXAM_SLUG: &str = "e2e-builder-backend-draft";
const STUDENT_EXAM_SLUG: &str = "e2e-student-backend-live";
const STUDENT_EXPECTED_ANSWER: &str = "seeded answer";
const STUDENT_QUESTION_ID: &str = "reading-q1";
const DEFAULT_FRONTEND_ORIGIN: &str = "http://localhost:3000";

#[derive(Debug)]
struct SeedArgs {
    manifest_path: PathBuf,
    builder_storage_path: PathBuf,
    student_storage_path: PathBuf,
    unregistered_student_storage_path: PathBuf,
    admin_storage_path: PathBuf,
    frontend_origin: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    frontend_origin: String,
    generated_at: String,
    builder: BuilderFixtureManifest,
    student: StudentFixtureManifest,
    unregistered_student: UnregisteredStudentFixtureManifest,
    auth: AuthFixtureManifest,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AuthFixtureManifest {
    admin_lifecycle: AdminLifecycleFixtureManifest,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AdminLifecycleFixtureManifest {
    email: String,
    activation_token: String,
    activation_password: String,
    password_reset_token: String,
    password_reset_password: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BuilderFixtureManifest {
    exam_id: String,
    exam_slug: String,
    draft_version_id: String,
    initial_revision: i32,
    initial_version_count: usize,
    storage_state_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StudentFixtureManifest {
    exam_id: String,
    exam_slug: String,
    published_version_id: String,
    schedule_id: String,
    candidate_id: String,
    question_id: String,
    expected_answer: String,
    storage_state_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct UnregisteredStudentFixtureManifest {
    email: String,
    password: String,
    candidate_id: String,
    storage_state_path: String,
}

#[derive(Debug, Serialize)]
struct StorageState {
    cookies: Vec<StorageCookie>,
    origins: Vec<StorageOrigin>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StorageCookie {
    name: String,
    value: String,
    domain: String,
    path: String,
    expires: f64,
    http_only: bool,
    secure: bool,
    same_site: String,
}

#[derive(Debug, Serialize)]
struct StorageOrigin {
    origin: String,
    #[serde(rename = "localStorage")]
    local_storage: Vec<StorageLocalValue>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StorageLocalValue {
    name: String,
    value: String,
}

#[derive(Debug)]
struct AuthFixture {
    user_id: Uuid,
    session_token: String,
    csrf_token: String,
}

#[derive(Debug)]
struct BuilderFixture {
    exam_id: String,
    draft_version_id: String,
    initial_revision: i32,
    initial_version_count: usize,
}

#[derive(Debug)]
struct StudentFixture {
    exam_id: String,
    published_version_id: String,
    schedule_id: String,
}

#[derive(Debug)]
struct AdminLifecycleFixture {
    email: String,
    activation_token: String,
    password_reset_token: String,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args = parse_args(env::args().skip(1).collect())?;
    ensure_parent_directory(&args.manifest_path)?;
    ensure_parent_directory(&args.builder_storage_path)?;
    ensure_parent_directory(&args.student_storage_path)?;
    ensure_parent_directory(&args.unregistered_student_storage_path)?;
    ensure_parent_directory(&args.admin_storage_path)?;

    let config = AppConfig::from_env();
    let database_url = config
        .database_url
        .clone()
        .ok_or("DATABASE_URL must be set to seed backend E2E fixtures.")?;
    let pool = MySqlPoolOptions::new()
        .max_connections(5)
        .acquire_timeout(std::time::Duration::from_secs(30))
        .idle_timeout(std::time::Duration::from_secs(600))
        .max_lifetime(std::time::Duration::from_secs(1800))
        .test_before_acquire(true)
        .connect(&database_url)
        .await?;

    cleanup_existing_fixtures(&pool).await?;

    let builder_auth = create_authenticated_user(
        &pool,
        &config,
        UserRole::Builder,
        BUILDER_EMAIL,
        BUILDER_NAME,
        None,
    )
    .await?;
    let student_auth = create_authenticated_user(
        &pool,
        &config,
        UserRole::Student,
        STUDENT_EMAIL,
        STUDENT_NAME,
        Some(STUDENT_CANDIDATE_ID),
    )
    .await?;
    let unregistered_student_auth = create_authenticated_user(
        &pool,
        &config,
        UserRole::Student,
        UNREGISTERED_STUDENT_EMAIL,
        UNREGISTERED_STUDENT_NAME,
        Some(UNREGISTERED_STUDENT_CANDIDATE_ID),
    )
    .await?;
    let admin_operator_auth = create_authenticated_user(
        &pool,
        &config,
        UserRole::Admin,
        ADMIN_OPERATOR_EMAIL,
        ADMIN_OPERATOR_NAME,
        None,
    )
    .await?;
    let admin_lifecycle = create_admin_lifecycle_user(&pool).await?;

    let builder_fixture = seed_builder_fixture(&pool, builder_auth.user_id).await?;
    let student_fixture = seed_student_fixture(&pool, builder_auth.user_id, student_auth.user_id)
        .await?;

    write_storage_state(
        &args.builder_storage_path,
        &args.frontend_origin,
        &config,
        &builder_auth,
    )?;
    write_storage_state(
        &args.student_storage_path,
        &args.frontend_origin,
        &config,
        &student_auth,
    )?;
    write_storage_state(
        &args.unregistered_student_storage_path,
        &args.frontend_origin,
        &config,
        &unregistered_student_auth,
    )?;
    write_storage_state(
        &args.admin_storage_path,
        &args.frontend_origin,
        &config,
        &admin_operator_auth,
    )?;

    let manifest = Manifest {
        frontend_origin: args.frontend_origin,
        generated_at: Utc::now().to_rfc3339(),
        builder: BuilderFixtureManifest {
            exam_id: builder_fixture.exam_id,
            exam_slug: BUILDER_EXAM_SLUG.to_owned(),
            draft_version_id: builder_fixture.draft_version_id,
            initial_revision: builder_fixture.initial_revision,
            initial_version_count: builder_fixture.initial_version_count,
            storage_state_path: args.builder_storage_path.display().to_string(),
        },
        student: StudentFixtureManifest {
            exam_id: student_fixture.exam_id,
            exam_slug: STUDENT_EXAM_SLUG.to_owned(),
            published_version_id: student_fixture.published_version_id,
            schedule_id: student_fixture.schedule_id,
            candidate_id: STUDENT_CANDIDATE_ID.to_owned(),
            question_id: STUDENT_QUESTION_ID.to_owned(),
            expected_answer: STUDENT_EXPECTED_ANSWER.to_owned(),
            storage_state_path: args.student_storage_path.display().to_string(),
        },
        unregistered_student: UnregisteredStudentFixtureManifest {
            email: UNREGISTERED_STUDENT_EMAIL.to_owned(),
            password: "Password123!".to_owned(),
            candidate_id: UNREGISTERED_STUDENT_CANDIDATE_ID.to_owned(),
            storage_state_path: args.unregistered_student_storage_path.display().to_string(),
        },
        auth: AuthFixtureManifest {
            admin_lifecycle: AdminLifecycleFixtureManifest {
                email: admin_lifecycle.email,
                activation_token: admin_lifecycle.activation_token,
                activation_password: ADMIN_ACTIVATION_PASSWORD.to_owned(),
                password_reset_token: admin_lifecycle.password_reset_token,
                password_reset_password: ADMIN_PASSWORD_RESET_PASSWORD.to_owned(),
            },
        },
    };

    fs::write(
        &args.manifest_path,
        serde_json::to_vec_pretty(&manifest)?,
    )?;

    println!(
        "Seeded backend E2E fixtures: builder exam {}, student schedule {}",
        manifest.builder.exam_id, manifest.student.schedule_id
    );

    Ok(())
}

fn parse_args(args: Vec<String>) -> Result<SeedArgs, Box<dyn std::error::Error>> {
    let mut manifest_path: Option<PathBuf> = None;
    let mut builder_storage_path: Option<PathBuf> = None;
    let mut student_storage_path: Option<PathBuf> = None;
    let mut unregistered_student_storage_path: Option<PathBuf> = None;
    let mut admin_storage_path: Option<PathBuf> = None;
    let mut frontend_origin = DEFAULT_FRONTEND_ORIGIN.to_owned();

    let mut index = 0;
    while index < args.len() {
        let flag = &args[index];
        let value = args
            .get(index + 1)
            .ok_or_else(|| format!("Missing value for argument {flag}"))?;

        match flag.as_str() {
            "--manifest" => manifest_path = Some(PathBuf::from(value)),
            "--builder-storage" => builder_storage_path = Some(PathBuf::from(value)),
            "--student-storage" => student_storage_path = Some(PathBuf::from(value)),
            "--unregistered-student-storage" => unregistered_student_storage_path = Some(PathBuf::from(value)),
            "--admin-storage" => admin_storage_path = Some(PathBuf::from(value)),
            "--frontend-origin" => frontend_origin = value.clone(),
            _ => return Err(format!("Unsupported argument: {flag}").into()),
        }

        index += 2;
    }

    Ok(SeedArgs {
        manifest_path: manifest_path.ok_or("--manifest is required")?,
        builder_storage_path: builder_storage_path.ok_or("--builder-storage is required")?,
        student_storage_path: student_storage_path.ok_or("--student-storage is required")?,
        unregistered_student_storage_path: unregistered_student_storage_path.ok_or("--unregistered-student-storage is required")?,
        admin_storage_path: admin_storage_path.ok_or("--admin-storage is required")?,
        frontend_origin,
    })
}

async fn cleanup_existing_fixtures(pool: &MySqlPool) -> Result<(), sqlx::Error> {
    eprintln!("Starting cleanup of existing fixtures...");
    
    eprintln!("Deleting exam_entities...");
    let result = sqlx::query(
        r#"
        DELETE FROM exam_entities
        WHERE slug IN (?, ?)
        "#,
    )
    .bind(BUILDER_EXAM_SLUG.to_owned())
    .bind(STUDENT_EXAM_SLUG.to_owned())
    .execute(pool)
    .await;
    
    match result {
        Ok(_) => eprintln!("✓ Deleted exam_entities"),
        Err(e) => {
            eprintln!("✗ Failed to delete exam_entities: {}", e);
            return Err(e);
        }
    }

    eprintln!("Deleting users...");
    let result = sqlx::query(
        r#"
        DELETE FROM users
        WHERE email IN (?, ?, ?, ?, ?)
        "#,
    )
    .bind(BUILDER_EMAIL.to_owned())
    .bind(STUDENT_EMAIL.to_owned())
    .bind(UNREGISTERED_STUDENT_EMAIL.to_owned())
    .bind(ADMIN_OPERATOR_EMAIL.to_owned())
    .bind(ADMIN_EMAIL.to_owned())
    .execute(pool)
    .await;
    
    match result {
        Ok(_) => eprintln!("✓ Deleted users"),
        Err(e) => {
            eprintln!("✗ Failed to delete users: {}", e);
            return Err(e);
        }
    }

    eprintln!("✓ Cleanup completed successfully");
    Ok(())
}

async fn seed_builder_fixture(
    pool: &MySqlPool,
    builder_user_id: Uuid,
) -> Result<BuilderFixture, Box<dyn std::error::Error>> {
    eprintln!("Seeding builder fixture...");
    let actor = ActorContext::new(builder_user_id.to_string(), ActorRole::Builder);
    let service = BuilderService::new(pool.clone());
    
    eprintln!("Creating exam via BuilderService...");
    let exam = service
        .create_exam(
            &actor,
            CreateExamRequest {
                slug: BUILDER_EXAM_SLUG.to_owned(),
                title: "Builder Backend E2E Draft".to_owned(),
                exam_type: "Academic".to_string(),
                visibility: "organization".to_string(),
                organization_id: Some("e2e-org".to_owned()),
            },
        )
        .await?;

    eprintln!("Saving draft via BuilderService...");
    let exam_id = exam.id.clone();
    let draft_version = service
        .save_draft(
            &actor,
            exam_id.clone(),
            SaveDraftRequest {
                content_snapshot: minimal_exam_state(
                    "Builder Backend E2E Draft",
                    "builder-passage-1",
                    "builder-q1",
                    "Builder prompt",
                    "builder-correct",
                ),
                config_snapshot: minimal_reading_config("Builder Backend E2E Draft"),
                revision: exam.revision,
            },
        )
        .await?;

    let exam_after_draft = service.get_exam(&actor, exam_id.clone()).await?;
    let versions = service.list_versions(&actor, exam_id.clone()).await?;

    eprintln!("✓ Builder fixture seeded successfully");
    Ok(BuilderFixture {
        exam_id,
        draft_version_id: draft_version.id,
        initial_revision: exam_after_draft.revision,
        initial_version_count: versions.len(),
    })
}

async fn seed_student_fixture(
    pool: &MySqlPool,
    builder_user_id: Uuid,
    student_user_id: Uuid,
) -> Result<StudentFixture, Box<dyn std::error::Error>> {
    let builder_actor = ActorContext::new(builder_user_id.to_string(), ActorRole::Builder);
    let builder_service = BuilderService::new(pool.clone());
    let exam = builder_service
        .create_exam(
            &builder_actor,
            CreateExamRequest {
                slug: STUDENT_EXAM_SLUG.to_owned(),
                title: "Student Backend E2E Delivery".to_owned(),
                exam_type: "Academic".to_string(),
                visibility: "organization".to_string(),
                organization_id: Some("e2e-org".to_owned()),
            },
        )
        .await?;

    let exam_id = exam.id.clone();
    builder_service
        .save_draft(
            &builder_actor,
            exam_id.clone(),
            SaveDraftRequest {
                content_snapshot: minimal_exam_state(
                    "Student Backend E2E Delivery",
                    "student-passage-1",
                    STUDENT_QUESTION_ID,
                    "Write the missing word from the passage.",
                    STUDENT_EXPECTED_ANSWER,
                ),
                config_snapshot: minimal_reading_config("Student Backend E2E Delivery"),
                revision: exam.revision,
            },
        )
        .await?;

    let exam_after_draft = builder_service.get_exam(&builder_actor, exam_id.clone()).await?;
    let published_version = builder_service
        .publish_exam(
            &builder_actor,
            exam_id.clone(),
            PublishExamRequest {
                publish_notes: Some("published for backend-backed student E2E".to_owned()),
                revision: exam_after_draft.revision,
            },
        )
        .await?;

    let scheduling_service = SchedulingService::new(pool.clone());
    let start_time = Utc::now() - Duration::minutes(5);
    let end_time = start_time + Duration::minutes(90);
    let published_version_id = published_version.id.clone();
    let schedule = scheduling_service
        .create_schedule(
            &builder_actor,
            CreateScheduleRequest {
                exam_id: exam_id.clone(),
                published_version_id,
                cohort_name: "Backend E2E Cohort".to_owned(),
                institution: Some("Codex IELTS Lab".to_owned()),
                start_time,
                end_time,
                auto_start: false,
                auto_stop: false,
            },
        )
        .await?;

    let schedule_id = Uuid::parse_str(&schedule.id)?;
    let schedule_id_str = schedule.id.clone();
    create_student_registration(
        pool,
        schedule_id,
        student_user_id,
        STUDENT_CANDIDATE_ID,
        STUDENT_NAME,
        STUDENT_EMAIL,
    )
    .await?;

    scheduling_service
        .apply_runtime_command(
            &builder_actor,
            schedule_id,
            RuntimeCommandRequest {
                action: RuntimeCommandAction::StartRuntime,
                reason: Some("seed backend-backed student workflow".to_owned()),
            },
        )
        .await?;

    Ok(StudentFixture {
        exam_id: exam.id,
        published_version_id: published_version.id,
        schedule_id: schedule_id_str,
    })
}

async fn create_authenticated_user(
    pool: &MySqlPool,
    config: &AppConfig,
    role: UserRole,
    email: &str,
    display_name: &str,
    student_id: Option<&str>,
) -> Result<AuthFixture, Box<dyn std::error::Error>> {
    eprintln!("Creating authenticated user: {} ({})", email, role_sql(&role));
    
    let user_id = Uuid::new_v4();
    let session_token = random_token(32);
    let csrf_token = random_token(24);
    let password_hash = hash_password("Password123!")
        .map_err(|error| format!("failed to hash seeded password: {error}"))?;
    let now = Utc::now();
    let (expires_at, idle_timeout_at) = session_expiry(&role, config);

    eprintln!("Inserting user record...");
    let result = sqlx::query(
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
    .await;
    
    match result {
        Ok(_) => eprintln!("✓ Inserted user record"),
        Err(e) => {
            eprintln!("✗ Failed to insert user record: {}", e);
            return Err(e.into());
        }
    }

    eprintln!("Inserting password credentials...");
    let result = sqlx::query(
        r#"
        INSERT INTO user_password_credentials (user_id, password_hash, updated_at)
        VALUES (?, ?, ?)
        "#,
    )
    .bind(user_id.to_string())
    .bind(password_hash)
    .bind(now)
    .execute(pool)
    .await;
    
    match result {
        Ok(_) => eprintln!("✓ Inserted password credentials"),
        Err(e) => {
            eprintln!("✗ Failed to insert password credentials: {}", e);
            return Err(e.into());
        }
    }

    match role {
        UserRole::Student => {
            eprintln!("Inserting student profile...");
            let result = sqlx::query(
                r#"
                INSERT INTO student_profiles (
                    user_id, student_id, full_name, email, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?)
                "#,
            )
            .bind(user_id.to_string())
            .bind(student_id.unwrap_or(STUDENT_CANDIDATE_ID))
            .bind(display_name)
            .bind(email)
            .bind(now)
            .bind(now)
            .execute(pool)
            .await;
            
            match result {
                Ok(_) => eprintln!("✓ Inserted student profile"),
                Err(e) => {
                    eprintln!("✗ Failed to insert student profile: {}", e);
                    return Err(e.into());
                }
            }
        }
        _ => {
            eprintln!("Inserting staff profile...");
            let result = sqlx::query(
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
            .await;
            
            match result {
                Ok(_) => eprintln!("✓ Inserted staff profile"),
                Err(e) => {
                    eprintln!("✗ Failed to insert staff profile: {}", e);
                    return Err(e.into());
                }
            }
        }
    }

    eprintln!("Inserting user session...");
    let result = sqlx::query(
        r#"
        INSERT INTO user_sessions (
            id, user_id, session_token_hash, csrf_token, role_snapshot,
            issued_at, last_seen_at, expires_at, idle_timeout_at
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
    .bind(expires_at)
    .bind(idle_timeout_at)
    .execute(pool)
    .await;
    
    match result {
        Ok(_) => eprintln!("✓ Inserted user session"),
        Err(e) => {
            eprintln!("✗ Failed to insert user session: {}", e);
            return Err(e.into());
        }
    }

    eprintln!("✓ User creation completed successfully");
    Ok(AuthFixture {
        user_id,
        session_token,
        csrf_token,
    })
}

async fn create_admin_lifecycle_user(
    pool: &MySqlPool,
) -> Result<AdminLifecycleFixture, Box<dyn std::error::Error>> {
    eprintln!("Creating admin lifecycle user...");
    
    let user_id = Uuid::new_v4();
    let now = Utc::now();
    let password_hash = hash_password(ADMIN_ACTIVATION_PASSWORD)
        .map_err(|error| format!("failed to hash admin lifecycle password: {error}"))?;

    eprintln!("Inserting admin user...");
    let result = sqlx::query(
        r#"
        INSERT INTO users (
            id, email, display_name, role, state, failed_login_count, created_at, updated_at
        )
        VALUES (?, ?, ?, 'admin', 'pending_activation', 0, ?, ?)
        "#,
    )
    .bind(user_id.to_string())
    .bind(ADMIN_EMAIL)
    .bind(ADMIN_NAME)
    .bind(now)
    .bind(now)
    .execute(pool)
    .await;
    
    match result {
        Ok(_) => eprintln!("✓ Inserted admin user"),
        Err(e) => {
            eprintln!("✗ Failed to insert admin user: {}", e);
            return Err(e.into());
        }
    }

    eprintln!("Inserting admin password credentials...");
    let result = sqlx::query(
        r#"
        INSERT INTO user_password_credentials (user_id, password_hash, updated_at)
        VALUES (?, ?, ?)
        "#,
    )
    .bind(user_id.to_string())
    .bind(password_hash)
    .bind(now)
    .execute(pool)
    .await;
    
    match result {
        Ok(_) => eprintln!("✓ Inserted admin password credentials"),
        Err(e) => {
            eprintln!("✗ Failed to insert admin password credentials: {}", e);
            return Err(e.into());
        }
    }

    eprintln!("Inserting admin staff profile...");
    let result = sqlx::query(
        r#"
        INSERT INTO staff_profiles (user_id, full_name, email, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        "#,
    )
    .bind(user_id.to_string())
    .bind(ADMIN_NAME)
    .bind(ADMIN_EMAIL)
    .bind(now)
    .bind(now)
    .execute(pool)
    .await;
    
    match result {
        Ok(_) => eprintln!("✓ Inserted admin staff profile"),
        Err(e) => {
            eprintln!("✗ Failed to insert admin staff profile: {}", e);
            return Err(e.into());
        }
    }

    let activation_token = insert_token(
        pool,
        "account_activation_tokens",
        user_id,
        Duration::minutes(30),
    )
    .await?;
    let password_reset_token = insert_token(
        pool,
        "password_reset_tokens",
        user_id,
        Duration::minutes(30),
    )
    .await?;

    eprintln!("✓ Admin lifecycle user created successfully");
    Ok(AdminLifecycleFixture {
        email: ADMIN_EMAIL.to_owned(),
        activation_token,
        password_reset_token,
    })
}

async fn insert_token(
    pool: &MySqlPool,
    table: &str,
    user_id: Uuid,
    lifetime: Duration,
) -> Result<String, Box<dyn std::error::Error>> {
    eprintln!("Inserting token into table: {}", table);
    
    let token = random_token(32);
    let expires_at = Utc::now() + lifetime;
    let id = Uuid::new_v4();
    let query = format!(
        r#"
        INSERT INTO {table} (id, user_id, token_hash, expires_at, created_at)
        VALUES (?, ?, ?, ?, NOW())
        "#
    );

    let result = sqlx::query(&query)
        .bind(id.to_string())
        .bind(user_id.to_string())
        .bind(sha256_hex(&token))
        .bind(expires_at)
        .execute(pool)
        .await;
    
    match result {
        Ok(_) => eprintln!("✓ Inserted token into {}", table),
        Err(e) => {
            eprintln!("✗ Failed to insert token into {}: {}", table, e);
            return Err(e.into());
        }
    }

    Ok(token)
}

async fn create_student_registration(
    pool: &MySqlPool,
    schedule_id: Uuid,
    user_id: Uuid,
    student_id: &str,
    student_name: &str,
    student_email: &str,
) -> Result<(), sqlx::Error> {
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
    .bind(student_key)
    .bind(student_id)
    .bind(student_name)
    .bind(student_email)
    .execute(pool)
    .await?;
    Ok(())
}

fn minimal_exam_state(
    title: &str,
    passage_id: &str,
    question_id: &str,
    prompt: &str,
    correct_answer: &str,
) -> Value {
    let config = minimal_reading_config(title);
    json!({
        "title": title,
        "type": "Academic",
        "activeModule": "reading",
        "activePassageId": passage_id,
        "activeListeningPartId": "",
        "config": config,
        "reading": {
            "passages": [
                {
                    "id": passage_id,
                    "title": "Backend E2E Passage",
                    "content": "This seeded passage exists so the browser flow can validate, persist, and submit a real backend-backed answer.",
                    "blocks": [
                        {
                            "id": "reading-block-1",
                            "type": "SHORT_ANSWER",
                            "instruction": "Answer the question using one word from the passage.",
                            "questions": [
                                {
                                    "id": question_id,
                                    "prompt": prompt,
                                    "correctAnswer": correct_answer,
                                    "answerRule": "ONE_WORD"
                                }
                            ]
                        }
                    ]
                }
            ]
        },
        "listening": { "parts": [] },
        "writing": {
            "task1Prompt": "",
            "task2Prompt": "",
            "tasks": []
        },
        "speaking": {
            "part1Topics": [],
            "cueCard": "",
            "part3Discussion": []
        }
    })
}

fn minimal_reading_config(title: &str) -> Value {
    json!({
        "general": {
            "preset": "Academic",
            "type": "Academic",
            "title": title,
            "summary": "Seeded backend-backed E2E exam",
            "instructions": "Answer the single seeded reading item."
        },
        "sections": {
            "listening": {
                "enabled": false,
                "label": "Listening",
                "duration": 30,
                "order": 0,
                "gapAfterMinutes": 0,
                "partCount": 4,
                "bandScoreTable": {
                    "2": 2.5,
                    "4": 3.0,
                    "6": 3.5,
                    "10": 4.0,
                    "13": 4.5,
                    "16": 5.0,
                    "18": 5.5,
                    "23": 6.0,
                    "26": 6.5,
                    "30": 7.0,
                    "32": 7.5,
                    "35": 8.0,
                    "37": 8.5,
                    "39": 9.0
                },
                "allowedQuestionTypes": ["TFNG", "CLOZE", "MATCHING", "MAP", "MULTI_MCQ"]
            },
            "reading": {
                "enabled": true,
                "label": "Reading",
                "duration": 60,
                "order": 1,
                "gapAfterMinutes": 0,
                "passageCount": 1,
                "bandScoreTable": {
                    "4": 2.5,
                    "6": 3.0,
                    "8": 3.5,
                    "10": 4.0,
                    "13": 4.5,
                    "15": 5.0,
                    "19": 5.5,
                    "23": 6.0,
                    "27": 6.5,
                    "30": 7.0,
                    "33": 7.5,
                    "35": 8.0,
                    "37": 8.5,
                    "39": 9.0
                },
                "allowedQuestionTypes": [
                    "TFNG",
                    "CLOZE",
                    "MATCHING",
                    "MAP",
                    "MULTI_MCQ",
                    "SHORT_ANSWER"
                ]
            },
            "writing": {
                "enabled": false,
                "label": "Writing",
                "duration": 60,
                "order": 2,
                "gapAfterMinutes": 0,
                "tasks": [
                    {
                        "id": "task1",
                        "label": "Task 1",
                        "taskType": "task1-academic",
                        "minWords": 150,
                        "recommendedTime": 20
                    },
                    {
                        "id": "task2",
                        "label": "Task 2",
                        "taskType": "task2-essay",
                        "minWords": 250,
                        "recommendedTime": 40
                    }
                ],
                "rubricWeights": {
                    "taskResponse": 25,
                    "coherence": 25,
                    "lexical": 25,
                    "grammar": 25
                },
                "allowedQuestionTypes": []
            },
            "speaking": {
                "enabled": false,
                "label": "Speaking",
                "duration": 15,
                "order": 3,
                "gapAfterMinutes": 0,
                "parts": [
                    {
                        "id": "part1",
                        "label": "Part 1: Introduction & Interview",
                        "prepTime": 0,
                        "speakingTime": 300
                    },
                    {
                        "id": "part2",
                        "label": "Part 2: Individual Long Turn",
                        "prepTime": 60,
                        "speakingTime": 120
                    },
                    {
                        "id": "part3",
                        "label": "Part 3: Two-way Discussion",
                        "prepTime": 0,
                        "speakingTime": 300
                    }
                ],
                "rubricWeights": {
                    "fluency": 25,
                    "lexical": 25,
                    "grammar": 25,
                    "pronunciation": 25
                },
                "allowedQuestionTypes": []
            }
        },
        "standards": {
            "passageWordCount": {
                "optimalMin": 700,
                "optimalMax": 1000,
                "warningMin": 500,
                "warningMax": 1200
            },
            "writingTasks": {
                "task1": {
                    "minWords": 150,
                    "recommendedTime": 20
                },
                "task2": {
                    "minWords": 250,
                    "recommendedTime": 40
                }
            },
            "rubricDeviationThreshold": 10,
            "rubricWeights": {
                "writing": {
                    "taskResponse": 25,
                    "coherence": 25,
                    "lexical": 25,
                    "grammar": 25
                },
                "speaking": {
                    "fluency": 25,
                    "lexical": 25,
                    "grammar": 25,
                    "pronunciation": 25
                }
            },
            "bandScoreTables": {
                "listening": {
                    "2": 2.5,
                    "4": 3.0,
                    "6": 3.5,
                    "10": 4.0,
                    "13": 4.5,
                    "16": 5.0,
                    "18": 5.5,
                    "23": 6.0,
                    "26": 6.5,
                    "30": 7.0,
                    "32": 7.5,
                    "35": 8.0,
                    "37": 8.5,
                    "39": 9.0
                },
                "readingAcademic": {
                    "4": 2.5,
                    "6": 3.0,
                    "8": 3.5,
                    "10": 4.0,
                    "13": 4.5,
                    "15": 5.0,
                    "19": 5.5,
                    "23": 6.0,
                    "27": 6.5,
                    "30": 7.0,
                    "33": 7.5,
                    "35": 8.0,
                    "37": 8.5,
                    "39": 9.0
                },
                "readingGeneralTraining": {
                    "6": 2.5,
                    "9": 3.0,
                    "12": 3.5,
                    "15": 4.0,
                    "19": 4.5,
                    "23": 5.0,
                    "27": 5.5,
                    "30": 6.0,
                    "32": 6.5,
                    "34": 7.0,
                    "36": 7.5,
                    "37": 8.0,
                    "39": 8.5,
                    "40": 9.0
                }
            }
        },
        "progression": {
            "autoSubmit": true,
            "lockAfterSubmit": true,
            "allowPause": false,
            "showWarnings": true,
            "warningThreshold": 3
        },
        "delivery": {
            "launchMode": "proctor_start",
            "transitionMode": "auto_with_proctor_override",
            "allowedExtensionMinutes": [5, 10]
        },
        "scoring": {
            "overallRounding": "nearest-0.5"
        },
        "security": {
            "requireFullscreen": true,
            "tabSwitchRule": "warn",
            "detectSecondaryScreen": true,
            "preventAutofill": true,
            "preventAutocorrect": true,
            "fullscreenAutoReentry": true,
            "fullscreenMaxViolations": 3,
            "heartbeatIntervalSeconds": 15,
            "heartbeatMissThreshold": 3,
            "pauseOnOffline": true,
            "bufferAnswersOffline": true,
            "requireDeviceContinuityOnReconnect": true,
            "allowSafariWithAcknowledgement": true,
            "proctoringFlags": {
                "webcam": true,
                "audio": true,
                "screen": true
            }
        }
    })
}

fn write_storage_state(
    output_path: &Path,
    frontend_origin: &str,
    config: &AppConfig,
    auth: &AuthFixture,
) -> Result<(), Box<dyn std::error::Error>> {
    let domain = parse_frontend_origin(frontend_origin)?;
    let secure = config.auth_cookie_secure;
    let expires = (Utc::now() + Duration::hours(config.session_absolute_lifetime_hours)).timestamp()
        as f64;

    let state = StorageState {
        cookies: vec![
            StorageCookie {
                name: config.auth_session_cookie_name.clone(),
                value: auth.session_token.clone(),
                domain: domain.clone(),
                path: "/".to_owned(),
                expires,
                http_only: true,
                secure,
                same_site: "Lax".to_owned(),
            },
            StorageCookie {
                name: config.auth_csrf_cookie_name.clone(),
                value: auth.csrf_token.clone(),
                domain,
                path: "/".to_owned(),
                expires,
                http_only: false,
                secure,
                same_site: "Lax".to_owned(),
            },
        ],
        origins: vec![],
    };

    fs::write(output_path, serde_json::to_vec_pretty(&state)?)?;
    Ok(())
}

fn ensure_parent_directory(path: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("Path {} does not have a parent directory", path.display()))?;
    fs::create_dir_all(parent)?;
    Ok(())
}

fn parse_frontend_origin(origin: &str) -> Result<String, Box<dyn std::error::Error>> {
    let without_scheme = origin
        .split("://")
        .nth(1)
        .ok_or("frontend origin must include a scheme")?;
    let host = without_scheme
        .split('/')
        .next()
        .ok_or("frontend origin must include a host")?;
    let domain = host
        .split(':')
        .next()
        .ok_or("frontend origin must include a host")?;

    if domain.is_empty() {
        return Err("frontend origin host cannot be empty".into());
    }

    Ok(domain.to_owned())
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
