#[path = "../support/mysql.rs"]
mod mysql;

use axum::{
    body::{to_bytes, Body},
    http::{Request, StatusCode},
};
use serde_json::json;
use tower::ServiceExt;
use uuid::Uuid;

use ielts_backend_api::{live_updates::LiveUpdateHub, router::build_router, state::AppState};
use ielts_backend_application::builder::BuilderService;
use ielts_backend_domain::auth::UserRole;
use ielts_backend_domain::exam::{
    CreateExamRequest, ExamEntity, ExamType, SaveDraftRequest, Visibility,
};
use ielts_backend_infrastructure::{
    actor_context::{ActorContext, ActorRole},
    config::AppConfig,
    pool::DatabasePool,
    rate_limit::{RateLimitConfig, RateLimiter},
    telemetry::Telemetry,
};

const BUILDER_MIGRATIONS: &[&str] = &[
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
async fn healthz_uses_the_standard_success_envelope() {
    let app = build_router(AppState::new(AppConfig::default()));

    let response = app
        .oneshot(
            Request::builder()
                .uri("/healthz")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let request_id = response
        .headers()
        .get("x-request-id")
        .expect("request id header")
        .to_str()
        .unwrap()
        .to_owned();

    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();

    assert_eq!(json["success"], true);
    assert_eq!(json["data"]["status"], "ok");
    assert_eq!(json["metadata"]["requestId"], request_id);

    let timestamp = json["metadata"]["timestamp"]
        .as_str()
        .expect("timestamp string");
    chrono::DateTime::parse_from_rfc3339(timestamp).expect("RFC3339 timestamp");
}

#[tokio::test]
async fn readyz_preserves_an_incoming_request_id() {
    let app = build_router(AppState::new(AppConfig::default()));

    let response = app
        .oneshot(
            Request::builder()
                .uri("/readyz")
                .header("x-request-id", "req_contract_test")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response.headers().get("x-request-id").unwrap(),
        "req_contract_test"
    );

    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();

    assert_eq!(json["success"], true);
    assert_eq!(json["data"]["status"], "ready");
    assert_eq!(json["metadata"]["requestId"], "req_contract_test");
}

#[tokio::test]
async fn list_exams_returns_seeded_exam_entities() {
    let database = mysql::TestDatabase::new(BUILDER_MIGRATIONS).await;
    let seeded = seed_exam(database.pool()).await;
    let auth = mysql::create_authenticated_user(
        database.pool(),
        UserRole::Builder,
        "builder@example.com",
        "Builder",
    )
    .await;
    let app = build_router(app_state(database.pool().clone()));

    let response = app
        .oneshot(
            auth.with_auth(Request::builder().uri("/api/v1/exams"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let exams = json["data"].as_array().expect("exam list array");

    assert_eq!(json["success"], true);
    assert_eq!(exams.len(), 1);
    assert_eq!(exams[0]["id"], seeded.id.to_string());
    assert_eq!(exams[0]["slug"], seeded.slug);

    database.shutdown().await;
}

#[tokio::test]
async fn get_exam_returns_exam_detail_by_id() {
    let database = mysql::TestDatabase::new(BUILDER_MIGRATIONS).await;
    let seeded = seed_exam(database.pool()).await;
    let auth = mysql::create_authenticated_user(
        database.pool(),
        UserRole::Builder,
        "builder@example.com",
        "Builder",
    )
    .await;
    let app = build_router(app_state(database.pool().clone()));

    let response = app
        .oneshot(
            auth.with_auth(Request::builder().uri(format!("/api/v1/exams/{}", seeded.id)))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();

    assert_eq!(json["success"], true);
    assert_eq!(json["data"]["id"], seeded.id.to_string());
    assert_eq!(json["data"]["slug"], seeded.slug);
    assert_eq!(json["data"]["status"], "draft");

    database.shutdown().await;
}

#[tokio::test]
async fn patch_draft_creates_a_new_version_and_advances_the_exam_pointer() {
    let database = mysql::TestDatabase::new(BUILDER_MIGRATIONS).await;
    let seeded = seed_exam(database.pool()).await;
    let auth = mysql::create_authenticated_user(
        database.pool(),
        UserRole::Builder,
        "builder@example.com",
        "Builder",
    )
    .await;
    let app = build_router(app_state(database.pool().clone()));

    let response = app
        .oneshot(
            auth.with_csrf(Request::builder())
                .method("PATCH")
                .uri(format!("/api/v1/exams/{}/draft", seeded.id))
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&SaveDraftRequest {
                        content_snapshot: json!({
                            "listening": {"parts": []},
                            "reading": {"passages": []},
                            "writing": {"tasks": []},
                            "speaking": {"part1Topics": [], "cueCard": "", "part3Discussion": []}
                        }),
                        config_snapshot: json!({
                            "general": {"title": seeded.title},
                            "sections": {}
                        }),
                        revision: seeded.revision,
                    })
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let version_id = json["data"]["id"].as_str().expect("version id");

    assert_eq!(json["success"], true);
    assert_eq!(json["data"]["examId"], seeded.id.to_string());
    assert_eq!(json["data"]["versionNumber"], 1);
    assert_eq!(json["data"]["isDraft"], true);

    let exam_after = BuilderService::new(database.pool().clone())
        .get_exam(&contract_actor(), seeded.id.clone())
        .await
        .expect("exam after draft save");

    assert_eq!(
        exam_after.current_draft_version_id,
        Some(version_id.to_owned())
    );
    assert_eq!(exam_after.revision, seeded.revision + 1);

    database.shutdown().await;
}

#[tokio::test]
async fn patch_draft_prunes_old_draft_versions_to_three() {
    let database = mysql::TestDatabase::new(BUILDER_MIGRATIONS).await;
    let seeded = seed_exam(database.pool()).await;
    let auth = mysql::create_authenticated_user(
        database.pool(),
        UserRole::Builder,
        "builder@example.com",
        "Builder",
    )
    .await;
    let app = build_router(app_state(database.pool().clone()));
    let service = BuilderService::new(database.pool().clone());

    let mut revision = seeded.revision;

    for _ in 0..5 {
        let response = app
            .clone()
            .oneshot(
                auth.with_csrf(Request::builder())
                    .method("PATCH")
                    .uri(format!("/api/v1/exams/{}/draft", seeded.id))
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::to_vec(&SaveDraftRequest {
                            content_snapshot: json!({
                                "listening": {"parts": []},
                                "reading": {"passages": []},
                                "writing": {"tasks": []},
                                "speaking": {"part1Topics": [], "cueCard": "", "part3Discussion": []}
                            }),
                            config_snapshot: json!({
                                "general": {"title": seeded.title},
                                "sections": {}
                            }),
                            revision,
                        })
                        .unwrap(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);

        let exam_after = service
            .get_exam(&contract_actor(), seeded.id.clone())
            .await
            .expect("exam after draft save");
        revision = exam_after.revision;
    }

    let response = app
        .clone()
        .oneshot(
            auth.with_auth(
                Request::builder()
                    .uri(format!("/api/v1/exams/{}/versions", seeded.id)),
            )
            .body(Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let versions = json["data"].as_array().expect("versions array");

    assert_eq!(json["success"], true);
    assert_eq!(versions.len(), 3);

    let mut version_numbers: Vec<i64> = versions
        .iter()
        .map(|version| version["versionNumber"].as_i64().expect("version number"))
        .collect();
    version_numbers.sort_unstable();
    assert_eq!(version_numbers, vec![3, 4, 5]);

    for version in versions {
        assert_eq!(version["isDraft"], true);
    }

    let response = app
        .oneshot(
            auth.with_auth(Request::builder().uri(format!("/api/v1/exams/{}/events", seeded.id)))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let events = json["data"].as_array().expect("events array");

    assert_eq!(json["success"], true);

    let draft_saved_count = events
        .iter()
        .filter(|event| event["action"].as_str() == Some("draft_saved"))
        .count();
    assert_eq!(draft_saved_count, 3);

    database.shutdown().await;
}

#[tokio::test]
async fn get_validation_reports_publish_readiness_for_the_current_draft() {
    let database = mysql::TestDatabase::new(BUILDER_MIGRATIONS).await;
    let seeded = seed_exam(database.pool()).await;
    let auth = mysql::create_authenticated_user(
        database.pool(),
        UserRole::Builder,
        "builder@example.com",
        "Builder",
    )
    .await;
    let service = BuilderService::new(database.pool().clone());
    let saved_version = service
        .save_draft(
            &contract_actor(),
            seeded.id.clone(),
            SaveDraftRequest {
                content_snapshot: json!({
                    "listening": {"parts": []},
                    "reading": {
                        "passages": [{
                            "id": "passage-1",
                            "title": "Passage 1",
                            "questionBlocks": [{
                                "id": "block-1",
                                "type": "SINGLE_MCQ",
                                "instruction": "Choose the correct answer",
                                "stem": "What is the answer?",
                                "options": [
                                    {"id": "opt-1", "text": "Option A", "isCorrect": true},
                                    {"id": "opt-2", "text": "Option B", "isCorrect": false}
                                ]
                            }]
                        }]
                    },
                    "writing": {},
                    "speaking": {}
                }),
                config_snapshot: json!({
                    "general": {"title": seeded.title},
                    "sections": {
                        "reading": {
                            "enabled": true,
                            "bandScoreTable": {"39": 9.0, "38": 8.5, "37": 8.0, "36": 7.5}
                        },
                        "listening": {"enabled": false},
                        "writing": {"enabled": false},
                        "speaking": {"enabled": false}
                    }
                }),
                revision: seeded.revision,
            },
        )
        .await
        .expect("seed draft");
    let app = build_router(app_state(database.pool().clone()));

    let response = app
        .oneshot(
            auth.with_auth(
                Request::builder().uri(format!("/api/v1/exams/{}/validation", seeded.id)),
            )
            .body(Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();

    assert_eq!(json["success"], true);
    assert_eq!(json["data"]["examId"], seeded.id.to_string());
    assert_eq!(json["data"]["draftVersionId"], saved_version.id.to_string());
    assert_eq!(json["data"]["canPublish"], true);
    assert_eq!(json["data"]["errors"], json!([]));

    database.shutdown().await;
}

#[tokio::test]
async fn get_events_returns_exam_history_for_the_exam() {
    let database = mysql::TestDatabase::new(BUILDER_MIGRATIONS).await;
    let seeded = seed_exam(database.pool()).await;
    let auth = mysql::create_authenticated_user(
        database.pool(),
        UserRole::Builder,
        "builder@example.com",
        "Builder",
    )
    .await;
    let service = BuilderService::new(database.pool().clone());

    service
        .save_draft(
            &contract_actor(),
            seeded.id.clone(),
            SaveDraftRequest {
                content_snapshot: json!({
                    "reading": {"passages": [{"id": "reading-1"}]},
                    "listening": {"parts": [{"id": "listening-1"}]},
                    "writing": {"tasks": [{"id": "writing-1"}]},
                    "speaking": {"part1Topics": ["topic"], "cueCard": "cue", "part3Discussion": ["discussion"]}
                }),
                config_snapshot: json!({
                    "general": {"title": seeded.title},
                    "sections": {"reading": {"enabled": true}}
                }),
                revision: seeded.revision,
            },
        )
        .await
        .expect("save draft");

    let app = build_router(app_state(database.pool().clone()));
    let response = app
        .oneshot(
            auth.with_auth(Request::builder().uri(format!("/api/v1/exams/{}/events", seeded.id)))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let events = json["data"].as_array().expect("events array");

    assert_eq!(json["success"], true);
    assert_eq!(events.len(), 2);
    assert_eq!(events[0]["action"], "draft_saved");
    assert_eq!(events[1]["action"], "created");

    database.shutdown().await;
}

fn app_state(pool: sqlx::MySqlPool) -> AppState {
    let config = AppConfig::default();

    AppState {
        live_mode_enabled: config.live_mode_enabled,
        config,
        pool: DatabasePool::new(pool),
        live_updates: LiveUpdateHub::new(),
        telemetry: Telemetry::new(),
        rate_limiter: RateLimiter::new(RateLimitConfig::new(1000, 60)),
    }
}

fn contract_actor() -> ActorContext {
    ActorContext::new(Uuid::new_v4().to_string(), ActorRole::Admin)
}

async fn seed_exam(pool: &sqlx::MySqlPool) -> ExamEntity {
    BuilderService::new(pool.clone())
        .create_exam(
            &contract_actor(),
            CreateExamRequest {
                slug: "cambridge-19-academic".to_owned(),
                title: "Cambridge 19 Academic".to_owned(),
                exam_type: ExamType::Academic.as_str().to_owned(),
                visibility: Visibility::Organization.as_str().to_owned(),
                organization_id: Some("org-1".to_owned()),
            },
        )
        .await
        .expect("seed exam")
}
