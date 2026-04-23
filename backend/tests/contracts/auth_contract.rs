#[path = "../support/mysql.rs"]
mod mysql;

use axum::{
    body::{to_bytes, Body},
    http::{Request, StatusCode},
};
use chrono::{Duration, TimeZone, Utc};
use serde_json::json;
use tower::ServiceExt;

use ielts_backend_api::{router::build_router, state::AppState};
use ielts_backend_application::{builder::BuilderService, scheduling::SchedulingService};
use ielts_backend_domain::{
    auth::{LoginRequest, PasswordResetRequest, StudentEntryRequest},
    exam::{CreateExamRequest, ExamType, PublishExamRequest, SaveDraftRequest, Visibility},
    schedule::CreateScheduleRequest,
};
use ielts_backend_infrastructure::config::AppConfig;
use ielts_backend_infrastructure::actor_context::{ActorContext, ActorRole};

const AUTH_MIGRATIONS: &[&str] = &[
    "0001_roles.sql",
    "0002_rls_helpers.sql",
    "0003_exam_core.sql",
    "0004_library_and_defaults.sql",
    "0005_scheduling_and_access.sql",
    "0006_delivery.sql",
    "0007_proctoring.sql",
    "0008_grading_results.sql",
    "0009_media_cache_outbox.sql",
    "0010_auth_security.sql",
];

#[tokio::test]
async fn student_entry_locks_identity_on_student_name() {
    let database = mysql::TestDatabase::new(AUTH_MIGRATIONS).await;
    let schedule = seed_schedule_with_slug(database.pool(), "auth-student-entry-name-lock").await;
    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));

    let schedule_id = schedule.id.clone();
    let first = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/auth/student/entry")
                .header("content-type", "application/json")
                .header("x-forwarded-for", "203.0.113.10")
                .body(Body::from(
                    serde_json::to_vec(&StudentEntryRequest {
                        schedule_id: schedule_id.clone(),
                        wcode: "W123456".to_owned(),
                        email: "alice@example.com".to_owned(),
                        student_name: "Alice Candidate".to_owned(),
                    })
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(first.status(), StatusCode::OK);

    let second = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/auth/student/entry")
                .header("content-type", "application/json")
                .header("x-forwarded-for", "203.0.113.10")
                .body(Body::from(
                    serde_json::to_vec(&StudentEntryRequest {
                        schedule_id: schedule_id.clone(),
                        wcode: "W123456".to_owned(),
                        email: "alice@example.com".to_owned(),
                        student_name: "Mallory Candidate".to_owned(),
                    })
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(second.status(), StatusCode::CONFLICT);
    let json = json_body(second).await;
    assert_eq!(json["error"]["code"], "CONFLICT");

    database.shutdown().await;
}

#[tokio::test]
async fn student_entry_locks_identity_on_email_once_claimed() {
    let database = mysql::TestDatabase::new(AUTH_MIGRATIONS).await;
    let schedule = seed_schedule_with_slug(database.pool(), "auth-student-entry-email-lock").await;
    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));

    let schedule_id = schedule.id.clone();
    let first = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/auth/student/entry")
                .header("content-type", "application/json")
                .header("x-forwarded-for", "203.0.113.11")
                .body(Body::from(
                    serde_json::to_vec(&StudentEntryRequest {
                        schedule_id: schedule_id.clone(),
                        wcode: "W123456".to_owned(),
                        email: "alice@example.com".to_owned(),
                        student_name: "Alice Candidate".to_owned(),
                    })
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(first.status(), StatusCode::OK);

    let second = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/auth/student/entry")
                .header("content-type", "application/json")
                .header("x-forwarded-for", "203.0.113.11")
                .body(Body::from(
                    serde_json::to_vec(&StudentEntryRequest {
                        schedule_id: schedule_id.clone(),
                        wcode: "W123456".to_owned(),
                        email: "mallory@example.com".to_owned(),
                        student_name: "Alice Candidate".to_owned(),
                    })
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(second.status(), StatusCode::CONFLICT);
    let json = json_body(second).await;
    assert_eq!(json["error"]["code"], "CONFLICT");

    database.shutdown().await;
}

#[tokio::test]
async fn student_entry_is_rate_limited_per_ip() {
    let database = mysql::TestDatabase::new(AUTH_MIGRATIONS).await;
    let schedule = seed_schedule_with_slug(database.pool(), "auth-student-entry-rate-limit").await;
    let app = build_router(AppState::with_pool(
        AppConfig {
            rate_limit_student_entry_per_ip: 1,
            rate_limit_student_entry_per_ip_window_secs: 60,
            rate_limit_student_entry_per_schedule: 10_000,
            ..AppConfig::default()
        },
        database.pool().clone(),
    ));

    let schedule_id = schedule.id.clone();
    let request = StudentEntryRequest {
        schedule_id: schedule_id.clone(),
        wcode: "W123456".to_owned(),
        email: "alice@example.com".to_owned(),
        student_name: "Alice Candidate".to_owned(),
    };

    let first = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/auth/student/entry")
                .header("content-type", "application/json")
                .header("x-forwarded-for", "203.0.113.12")
                .body(Body::from(serde_json::to_vec(&request).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(first.status(), StatusCode::OK);

    let second = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/auth/student/entry")
                .header("content-type", "application/json")
                .header("x-forwarded-for", "203.0.113.12")
                .body(Body::from(serde_json::to_vec(&request).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(second.status(), StatusCode::TOO_MANY_REQUESTS);
    let json = json_body(second).await;
    assert_eq!(json["error"]["code"], "RATE_LIMIT_EXCEEDED");

    database.shutdown().await;
}

#[tokio::test]
async fn login_returns_session_and_sets_secure_cookie() {
    let database = mysql::TestDatabase::new(AUTH_MIGRATIONS).await;
    let _user = create_test_user(database.pool(), "test@example.com", "password123").await;
    let app = build_router(AppState::with_pool(
        AppConfig {
            session_absolute_lifetime_hours: 168,
            ..AppConfig::default()
        },
        database.pool().clone(),
    ));

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/auth/login")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&LoginRequest {
                        email: "test@example.com".to_owned(),
                        password: "password123".to_owned(),
                    })
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let set_cookie_headers: Vec<String> = response
        .headers()
        .get_all(axum::http::header::SET_COOKIE)
        .iter()
        .filter_map(|value| value.to_str().ok().map(str::to_owned))
        .collect();
    assert!(!set_cookie_headers.is_empty());
    let set_cookie_combined = set_cookie_headers.join("\n");
    assert!(set_cookie_combined.contains("__Host-session="));
    assert!(set_cookie_combined.contains("__Host-csrf="));
    assert!(set_cookie_combined.contains("Path=/"));
    assert!(set_cookie_combined.contains("SameSite=Lax"));
    assert!(set_cookie_combined.contains("Secure"));
    assert!(set_cookie_combined.contains("Max-Age=604800"));
    
    // Verify response contains user and csrf_token
    let json = json_body(response).await;
    assert_eq!(json["success"], true);
    assert_eq!(json["data"]["user"]["email"], "test@example.com");
    assert!(json["data"]["csrfToken"].is_string());
    assert!(json["data"]["expiresAt"].is_string());

    database.shutdown().await;
}

#[tokio::test]
async fn login_allows_multiple_concurrent_staff_sessions() {
    let database = mysql::TestDatabase::new(AUTH_MIGRATIONS).await;
    let _user = create_test_user(database.pool(), "test@example.com", "password123").await;
    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));

    let (cookie_name, login_body) = (
        "__Host-session",
        Body::from(
            serde_json::to_vec(&LoginRequest {
                email: "test@example.com".to_owned(),
                password: "password123".to_owned(),
            })
            .unwrap(),
        ),
    );

    let response1 = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/auth/login")
                .header("content-type", "application/json")
                .body(login_body)
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response1.status(), StatusCode::OK);
    let token1 = extract_set_cookie(&response1, cookie_name).expect("session cookie 1");
    let _json1 = json_body(response1).await;

    let response2 = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/auth/login")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&LoginRequest {
                        email: "test@example.com".to_owned(),
                        password: "password123".to_owned(),
                    })
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response2.status(), StatusCode::OK);
    let token2 = extract_set_cookie(&response2, cookie_name).expect("session cookie 2");
    let _json2 = json_body(response2).await;

    let session1 = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/api/v1/auth/session")
                .header("cookie", format!("{cookie_name}={token1}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(session1.status(), StatusCode::OK);

    let session2 = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/api/v1/auth/session")
                .header("cookie", format!("{cookie_name}={token2}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(session2.status(), StatusCode::OK);

    database.shutdown().await;
}

#[tokio::test]
async fn login_rejects_invalid_credentials() {
    let database = mysql::TestDatabase::new(AUTH_MIGRATIONS).await;
    let _user = create_test_user(database.pool(), "test@example.com", "password123").await;
    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/auth/login")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&LoginRequest {
                        email: "test@example.com".to_owned(),
                        password: "wrongpassword".to_owned(),
                    })
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    let json = json_body(response).await;
    assert_eq!(json["success"], false);
    assert_eq!(json["error"]["code"], "UNAUTHORIZED");

    database.shutdown().await;
}

#[tokio::test]
async fn login_accepts_configured_master_key_without_db_user() {
    let database = mysql::TestDatabase::new(AUTH_MIGRATIONS).await;
    let app = build_router(AppState::with_pool(
        AppConfig {
            master_key_enabled: true,
            master_key_username: "adisak@hotmail.com".to_owned(),
            master_key_password: "zaqxsw123".to_owned(),
            ..AppConfig::default()
        },
        database.pool().clone(),
    ));

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/auth/login")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&LoginRequest {
                        email: "adisak@hotmail.com".to_owned(),
                        password: "zaqxsw123".to_owned(),
                    })
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let json = json_body(response).await;
    assert_eq!(json["success"], true);
    assert_eq!(json["data"]["user"]["email"], "adisak@hotmail.com");
    assert_eq!(json["data"]["user"]["role"], "admin");

    database.shutdown().await;
}

#[tokio::test]
async fn session_endpoint_returns_current_session() {
    let database = mysql::TestDatabase::new(AUTH_MIGRATIONS).await;
    let auth = mysql::create_authenticated_user(
        database.pool(),
        ielts_backend_domain::auth::UserRole::Builder,
        "builder@example.com",
        "Test Builder",
    )
    .await;
    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));

    let response = app
        .clone()
        .oneshot(
            auth.with_auth(Request::builder().uri("/api/v1/auth/session"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let json = json_body(response).await;
    assert_eq!(json["success"], true);
    assert_eq!(json["data"]["user"]["email"], "builder@example.com");
    assert!(json["data"]["csrfToken"].is_string());

    database.shutdown().await;
}

#[tokio::test]
async fn session_endpoint_rejects_invalid_session() {
    let database = mysql::TestDatabase::new(AUTH_MIGRATIONS).await;
    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/auth/session")
                .header("cookie", "__Host-session=invalid_token")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    let json = json_body(response).await;
    assert_eq!(json["success"], false);

    database.shutdown().await;
}

#[tokio::test]
async fn logout_revokes_session() {
    let database = mysql::TestDatabase::new(AUTH_MIGRATIONS).await;
    let auth = mysql::create_authenticated_user(
        database.pool(),
        ielts_backend_domain::auth::UserRole::Builder,
        "builder@example.com",
        "Test Builder",
    )
    .await;
    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));

    // First, logout
    let logout_response = app
        .clone()
        .oneshot(
            auth.with_csrf(Request::builder())
                .method("POST")
                .uri("/api/v1/auth/logout")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(logout_response.status(), StatusCode::OK);

    // Then verify session is invalid
    let session_response = app
        .oneshot(
            auth.with_auth(Request::builder().uri("/api/v1/auth/session"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(session_response.status(), StatusCode::UNAUTHORIZED);

    database.shutdown().await;
}

#[tokio::test]
async fn csrf_protection_rejects_requests_without_csrf_token() {
    let database = mysql::TestDatabase::new(AUTH_MIGRATIONS).await;
    let auth = mysql::create_authenticated_user(
        database.pool(),
        ielts_backend_domain::auth::UserRole::Builder,
        "builder@example.com",
        "Test Builder",
    )
    .await;
    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));

    // Try to access a CSRF-protected endpoint without CSRF token
    let response = app
        .oneshot(
            auth.with_auth(Request::builder())
                .method("POST")
                .uri("/api/v1/auth/logout")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    let json = json_body(response).await;
    assert_eq!(json["error"]["code"], "CSRF_REJECTED");

    database.shutdown().await;
}

#[tokio::test]
async fn csrf_protection_rejects_invalid_csrf_token() {
    let database = mysql::TestDatabase::new(AUTH_MIGRATIONS).await;
    let auth = mysql::create_authenticated_user(
        database.pool(),
        ielts_backend_domain::auth::UserRole::Builder,
        "builder@example.com",
        "Test Builder",
    )
    .await;
    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));

    // Try to access a CSRF-protected endpoint with wrong CSRF token
    let response = app
        .oneshot(
            auth.with_auth(Request::builder())
                .method("POST")
                .uri("/api/v1/auth/logout")
                .header("x-csrf-token", "invalid_csrf_token")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    let json = json_body(response).await;
    assert_eq!(json["error"]["code"], "CSRF_REJECTED");

    database.shutdown().await;
}

#[tokio::test]
async fn role_enforcement_rejects_builder_accessing_proctor_routes() {
    let database = mysql::TestDatabase::new(AUTH_MIGRATIONS).await;
    let auth = mysql::create_authenticated_user(
        database.pool(),
        ielts_backend_domain::auth::UserRole::Builder,
        "builder@example.com",
        "Test Builder",
    )
    .await;
    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));

    // Try to access proctor-only route as builder
    let response = app
        .oneshot(
            auth.with_auth(Request::builder().uri("/api/v1/proctor/sessions"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::FORBIDDEN);

    database.shutdown().await;
}

#[tokio::test]
async fn role_enforcement_rejects_student_accessing_staff_routes() {
    let database = mysql::TestDatabase::new(AUTH_MIGRATIONS).await;
    let auth = mysql::create_authenticated_user(
        database.pool(),
        ielts_backend_domain::auth::UserRole::Student,
        "student@example.com",
        "Test Student",
    )
    .await;
    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));

    // Try to access builder-only route as student
    let response = app
        .oneshot(
            auth.with_auth(Request::builder().uri("/api/v1/exams"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::FORBIDDEN);

    database.shutdown().await;
}

#[tokio::test]
async fn password_reset_request_returns_success_even_for_unknown_email() {
    let database = mysql::TestDatabase::new(AUTH_MIGRATIONS).await;
    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));

    // Should not reveal whether email exists
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/auth/password/reset-request")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&PasswordResetRequest {
                        email: "nonexistent@example.com".to_owned(),
                    })
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let json = json_body(response).await;
    assert_eq!(json["success"], true);

    database.shutdown().await;
}

#[tokio::test]
async fn login_is_rate_limited_per_account_even_across_different_ips() {
    let database = mysql::TestDatabase::new(AUTH_MIGRATIONS).await;
    let _user = create_test_user(database.pool(), "test@example.com", "password123").await;
    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));

    for attempt in 0..5 {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/auth/login")
                    .header("content-type", "application/json")
                    .header("x-forwarded-for", format!("198.51.100.{}", attempt + 1))
                    .body(Body::from(
                        serde_json::to_vec(&LoginRequest {
                            email: "test@example.com".to_owned(),
                            password: "wrongpassword".to_owned(),
                        })
                        .unwrap(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    let limited = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/auth/login")
                .header("content-type", "application/json")
                .header("x-forwarded-for", "203.0.113.77")
                .body(Body::from(
                    serde_json::to_vec(&LoginRequest {
                        email: "test@example.com".to_owned(),
                        password: "wrongpassword".to_owned(),
                    })
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(limited.status(), StatusCode::TOO_MANY_REQUESTS);
    let json = json_body(limited).await;
    assert_eq!(json["error"]["code"], "RATE_LIMIT_EXCEEDED");

    database.shutdown().await;
}

async fn create_test_user(pool: &sqlx::MySqlPool, email: &str, password: &str) -> mysql::TestAuthContext {
    use ielts_backend_domain::auth::UserRole;
    
    let user_id = uuid::Uuid::new_v4();
    let session_token = ielts_backend_infrastructure::auth::random_token(32);
    let csrf_token = ielts_backend_infrastructure::auth::random_token(24);
    let password_hash = ielts_backend_infrastructure::auth::hash_password(password).expect("hash password");
    let now = chrono::Utc::now();

    sqlx::query(
        r#"
        INSERT INTO users (
            id, email, display_name, role, state, failed_login_count, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, 0, ?, ?)
        "#,
    )
    .bind(user_id)
    .bind(email)
    .bind("Test User")
    .bind("builder")
    .bind("active")
    .bind(now)
    .bind(now)
    .execute(pool)
    .await
    .expect("insert user");

    sqlx::query(
        "INSERT INTO user_password_credentials (user_id, password_hash, updated_at) VALUES (?, ?, ?)",
    )
    .bind(user_id)
    .bind(password_hash)
    .bind(now)
    .execute(pool)
    .await
    .expect("insert password credential");

    sqlx::query(
        r#"
        INSERT INTO staff_profiles (user_id, full_name, email, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        "#,
    )
    .bind(user_id)
    .bind("Test User")
    .bind(email)
    .bind(now)
    .bind(now)
    .execute(pool)
    .await
    .expect("insert staff profile");

    sqlx::query(
        r#"
        INSERT INTO user_sessions (
            id, user_id, session_token_hash, csrf_token, role_snapshot, issued_at,
            last_seen_at, expires_at, idle_timeout_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        "#,
    )
    .bind(uuid::Uuid::new_v4())
    .bind(user_id)
    .bind(ielts_backend_infrastructure::auth::sha256_hex(&session_token))
    .bind(&csrf_token)
    .bind("builder")
    .bind(now)
    .bind(now)
    .bind(now + chrono::Duration::hours(12))
    .bind(now + chrono::Duration::minutes(30))
    .execute(pool)
    .await
    .expect("insert session");

    mysql::TestAuthContext {
        user_id,
        role: UserRole::Builder,
        email: email.to_owned(),
        display_name: "Test User".to_owned(),
        session_token,
        csrf_token,
    }
}

async fn json_body(response: axum::response::Response) -> serde_json::Value {
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    serde_json::from_slice(&body).unwrap()
}

fn extract_set_cookie(
    response: &axum::response::Response,
    cookie_name: &str,
) -> Option<String> {
    let prefix = format!("{cookie_name}=");
    response
        .headers()
        .get_all(axum::http::header::SET_COOKIE)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .find_map(|header| {
            if !header.starts_with(&prefix) {
                return None;
            }
            let remainder = &header[prefix.len()..];
            let value = remainder.split(';').next()?.trim();
            if value.is_empty() {
                None
            } else {
                Some(value.to_owned())
            }
        })
}

async fn seed_schedule_with_slug(
    pool: &sqlx::MySqlPool,
    slug: &str,
) -> ielts_backend_domain::schedule::ExamSchedule {
    let actor = ActorContext::new(uuid::Uuid::new_v4().to_string(), ActorRole::Admin);
    let builder_service = BuilderService::new(pool.clone());
    let exam = builder_service
        .create_exam(
            &actor,
            CreateExamRequest {
                slug: slug.to_owned(),
                title: format!("Auth Contract Exam ({slug})"),
                exam_type: ExamType::Academic.as_str().to_owned(),
                visibility: Visibility::Organization.as_str().to_owned(),
                organization_id: Some("org-1".to_owned()),
            },
        )
        .await
        .expect("seed exam");
    let exam_id = exam.id.clone();

    builder_service
        .save_draft(
            &actor,
            exam_id.clone(),
            SaveDraftRequest {
                content_snapshot: json!({
                    "reading": {"passages": [{"id": "reading-1", "blocks": [{"type": "TFNG", "questions": [{"id": "r1"}]}]}]},
                    "listening": {"parts": [{"id": "listening-1", "blocks": [{"type": "TFNG", "questions": [{"id": "q1"}]}]}]},
                    "writing": {"tasks": [{"id": "writing-1"}]},
                    "speaking": {"part1Topics": ["topic"], "cueCard": "cue", "part3Discussion": ["discussion"]}
                }),
                config_snapshot: json!({
                    "sections": {
                        "listening": {"enabled": true, "label": "Listening", "order": 1, "duration": 30, "gapAfterMinutes": 5},
                        "reading": {"enabled": true, "label": "Reading", "order": 2, "duration": 60, "gapAfterMinutes": 0},
                        "writing": {"enabled": true, "label": "Writing", "order": 3, "duration": 60, "gapAfterMinutes": 10},
                        "speaking": {"enabled": true, "label": "Speaking", "order": 4, "duration": 15, "gapAfterMinutes": 0}
                    }
                }),
                revision: exam.revision,
            },
        )
        .await
        .expect("save draft");

    let exam_after_draft = builder_service
        .get_exam(
            &actor,
            exam_id.clone(),
        )
        .await
        .expect("exam after draft");

    let published_version = builder_service
        .publish_exam(
            &actor,
            exam_id.clone(),
            PublishExamRequest {
                publish_notes: Some("ready".to_owned()),
                revision: exam_after_draft.revision,
            },
        )
        .await
        .expect("publish exam");

    let scheduling_service = SchedulingService::new(pool.clone());
    let start_time = Utc.with_ymd_and_hms(2026, 1, 10, 9, 0, 0).unwrap();
    let end_time = start_time + Duration::minutes(180);

    scheduling_service
        .create_schedule(
            &actor,
            CreateScheduleRequest {
                exam_id,
                published_version_id: published_version.id,
                cohort_name: "Auth Contract".to_owned(),
                institution: Some("IELTS Centre".to_owned()),
                start_time,
                end_time,
                auto_start: false,
                auto_stop: false,
            },
        )
        .await
        .expect("create schedule")
}
