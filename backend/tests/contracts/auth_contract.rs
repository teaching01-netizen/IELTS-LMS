#[path = "../support/postgres.rs"]
mod postgres;

use axum::{
    body::{to_bytes, Body},
    http::{Request, StatusCode},
};
use tower::ServiceExt;

use ielts_backend_api::{router::build_router, state::AppState};
use ielts_backend_domain::auth::{LoginRequest, PasswordResetRequest};
use ielts_backend_infrastructure::config::AppConfig;

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
async fn login_returns_session_and_sets_secure_cookie() {
    let database = postgres::TestDatabase::new(AUTH_MIGRATIONS).await;
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
                        password: "password123".to_owned(),
                    })
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    
    // Verify response contains user and csrf_token
    let json = json_body(response).await;
    assert_eq!(json["success"], true);
    assert_eq!(json["data"]["user"]["email"], "test@example.com");
    assert!(json["data"]["csrfToken"].is_string());
    assert!(json["data"]["expiresAt"].is_string());

    database.shutdown().await;
}

#[tokio::test]
async fn login_rejects_invalid_credentials() {
    let database = postgres::TestDatabase::new(AUTH_MIGRATIONS).await;
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
    let database = postgres::TestDatabase::new(AUTH_MIGRATIONS).await;
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
    let database = postgres::TestDatabase::new(AUTH_MIGRATIONS).await;
    let auth = postgres::create_authenticated_user(
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
    let database = postgres::TestDatabase::new(AUTH_MIGRATIONS).await;
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
    let database = postgres::TestDatabase::new(AUTH_MIGRATIONS).await;
    let auth = postgres::create_authenticated_user(
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
    let database = postgres::TestDatabase::new(AUTH_MIGRATIONS).await;
    let auth = postgres::create_authenticated_user(
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
    let database = postgres::TestDatabase::new(AUTH_MIGRATIONS).await;
    let auth = postgres::create_authenticated_user(
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
    let database = postgres::TestDatabase::new(AUTH_MIGRATIONS).await;
    let auth = postgres::create_authenticated_user(
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
    let database = postgres::TestDatabase::new(AUTH_MIGRATIONS).await;
    let auth = postgres::create_authenticated_user(
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
    let database = postgres::TestDatabase::new(AUTH_MIGRATIONS).await;
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
    let database = postgres::TestDatabase::new(AUTH_MIGRATIONS).await;
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

async fn create_test_user(pool: &sqlx::PgPool, email: &str, password: &str) -> postgres::TestAuthContext {
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
        VALUES ($1, $2, $3, $4, $5, 0, $6, $6)
        "#,
    )
    .bind(user_id)
    .bind(email)
    .bind("Test User")
    .bind("builder")
    .bind("active")
    .bind(now)
    .execute(pool)
    .await
    .expect("insert user");

    sqlx::query(
        "INSERT INTO user_password_credentials (user_id, password_hash, updated_at) VALUES ($1, $2, $3)",
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
        VALUES ($1, $2, $3, $4, $4)
        "#,
    )
    .bind(user_id)
    .bind("Test User")
    .bind(email)
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
        VALUES ($1, $2, $3, $4, $5, $6, $6, $7, $8)
        "#,
    )
    .bind(uuid::Uuid::new_v4())
    .bind(user_id)
    .bind(ielts_backend_infrastructure::auth::sha256_hex(&session_token))
    .bind(&csrf_token)
    .bind("builder")
    .bind(now)
    .bind(now + chrono::Duration::hours(12))
    .bind(now + chrono::Duration::minutes(30))
    .execute(pool)
    .await
    .expect("insert session");

    postgres::TestAuthContext {
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
