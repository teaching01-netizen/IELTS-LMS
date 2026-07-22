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
    CreateExamRequest, ExamEntity, ExamStatus, ExamType, PublishExamRequest, SaveDraftRequest,
    Visibility,
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
    assert_eq!(exams[0]["canEdit"], true);
    assert_eq!(exams[0]["canPublish"], true);
    assert_eq!(exams[0]["canDelete"], true);

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
    assert_eq!(json["data"]["canEdit"], true);
    assert_eq!(json["data"]["canPublish"], true);
    assert_eq!(json["data"]["canDelete"], true);

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
            auth.with_auth(Request::builder().uri(format!("/api/v1/exams/{}/versions", seeded.id)))
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
async fn patch_draft_does_not_delete_versions_referenced_by_schedules() {
    let database = mysql::TestDatabase::new(BUILDER_MIGRATIONS).await;
    let seeded = seed_exam(database.pool()).await;
    let service = BuilderService::new(database.pool().clone());
    let actor = contract_actor();

    let mut revision = seeded.revision;
    let mut saved_versions = Vec::new();

    for _ in 0..3 {
        let version = service
            .save_draft(
                &actor,
                seeded.id.clone(),
                SaveDraftRequest {
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
                },
            )
            .await
            .expect("save draft");

        saved_versions.push(version);
        revision = service
            .get_exam(&actor, seeded.id.clone())
            .await
            .expect("exam after draft save")
            .revision;
    }

    let protected_version = saved_versions
        .first()
        .expect("oldest saved draft")
        .id
        .to_string();

    sqlx::query(
        r#"
        INSERT INTO exam_schedules (
            id, exam_id, organization_id, exam_title, proctor_display_name, grading_display_name, published_version_id, cohort_name,
            institution, start_time, end_time, planned_duration_minutes, delivery_mode,
            recurrence_type, recurrence_interval, auto_start, auto_stop, status, created_by,
            created_at, updated_at, revision
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW() + INTERVAL 60 MINUTE, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), ?)
        "#,
    )
    .bind(Uuid::new_v4().to_string())
    .bind(seeded.id.to_string())
    .bind("org-1")
    .bind(&seeded.title)
    .bind(&seeded.title)
    .bind(&seeded.title)
    .bind(&protected_version)
    .bind("Batch A")
    .bind("Test Center")
    .bind(60)
    .bind("proctor_start")
    .bind("none")
    .bind(1)
    .bind(false)
    .bind(false)
    .bind("scheduled")
    .bind(actor.actor_id.clone())
    .bind(0)
    .execute(database.pool())
    .await
    .expect("insert schedule referencing draft version");

    let fourth_save = service
        .save_draft(
            &actor,
            seeded.id.clone(),
            SaveDraftRequest {
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
            },
        )
        .await;

    assert!(
        fourth_save.is_ok(),
        "saving a new draft should not fail when an older draft is referenced by a schedule"
    );

    let versions = service
        .list_versions(&actor, seeded.id.clone())
        .await
        .expect("list versions");

    assert!(versions
        .iter()
        .any(|version| version.id.to_string() == protected_version && version.is_draft));

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
async fn save_draft_round_trips_shared_sentence_answer_fields() {
    let database = mysql::TestDatabase::new(BUILDER_MIGRATIONS).await;
    let seeded = seed_exam(database.pool()).await;
    let service = BuilderService::new(database.pool().clone());

    let saved_version = service
        .save_draft(
            &contract_actor(),
            seeded.id.clone(),
            SaveDraftRequest {
                content_snapshot: json!({
                    "reading": {
                        "passages": [{
                            "id": "passage-1",
                            "title": "Passage 1",
                            "content": "Content",
                            "blocks": [{
                                "id": "sentence-block",
                                "type": "SENTENCE_COMPLETION",
                                "instruction": "Complete the sentence.",
                                "questions": [{
                                    "id": "sentence-1",
                                    "sentence": "The ____ and ____ are ready.",
                                    "answerRule": "ONE_WORD",
                                    "acceptAnyAnswerKey": true,
                                    "sharedAcceptedAnswers": ["alpha", "beta"],
                                    "blanks": [
                                        {"id": "blank-1", "correctAnswer": "alpha", "position": 0},
                                        {"id": "blank-2", "correctAnswer": "beta", "position": 1}
                                    ]
                                }]
                            }]
                        }]
                    },
                    "listening": {"parts": []},
                    "writing": {},
                    "speaking": {}
                }),
                config_snapshot: json!({
                    "general": {"title": seeded.title},
                    "sections": {
                        "reading": {
                            "enabled": true,
                            "bandScoreTable": {"39": 9.0, "38": 8.5}
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
        .expect("save shared sentence draft");

    let version = service
        .get_version(&contract_actor(), saved_version.id.clone())
        .await
        .expect("reload shared sentence draft");
    let question = &version.content_snapshot["reading"]["passages"][0]["blocks"][0]
        ["questions"][0];

    assert_eq!(question["acceptAnyAnswerKey"], true);
    assert_eq!(question["sharedAcceptedAnswers"], json!(["alpha", "beta"]));

    database.shutdown().await;
}

#[tokio::test]
async fn get_validation_reports_publish_readiness_for_single_mcq_question_list() {
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
                            "blocks": [{
                                "id": "block-1",
                                "type": "SINGLE_MCQ",
                                "instruction": "Choose the correct answer",
                                "questions": [
                                    {
                                        "id": "single-q1",
                                        "stem": "What is the first answer?",
                                        "options": [
                                            {"id": "opt-1", "text": "Option A", "isCorrect": true},
                                            {"id": "opt-2", "text": "Option B", "isCorrect": false}
                                        ]
                                    },
                                    {
                                        "id": "single-q2",
                                        "stem": "What is the second answer?",
                                        "options": [
                                            {"id": "opt-3", "text": "Option C", "isCorrect": false},
                                            {"id": "opt-4", "text": "Option D", "isCorrect": true}
                                        ]
                                    }
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
async fn publish_revalidates_the_current_draft_before_marking_it_published() {
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
                content_snapshot: json!(null),
                config_snapshot: json!(null),
                revision: seeded.revision,
            },
        )
        .await
        .expect("save invalid draft");

    let exam_after_draft = service
        .get_exam(&contract_actor(), seeded.id.clone())
        .await
        .expect("exam after invalid draft");
    let app = build_router(app_state(database.pool().clone()));

    let response = app
        .oneshot(
            auth.with_csrf(Request::builder())
                .method("POST")
                .uri(format!("/api/v1/exams/{}/publish", seeded.id))
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&PublishExamRequest {
                        publish_notes: Some("must not publish invalid latest draft".to_owned()),
                        revision: exam_after_draft.revision,
                    })
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);

    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["success"], false);
    assert_eq!(json["error"]["code"], "VALIDATION_ERROR");
    assert!(json["error"]["message"]
        .as_str()
        .expect("validation error message")
        .contains("not ready for publication"));

    let exam_after_publish_attempt = service
        .get_exam(&contract_actor(), seeded.id.clone())
        .await
        .expect("exam after rejected publish");
    assert_eq!(exam_after_publish_attempt.status, ExamStatus::Draft);
    assert!(exam_after_publish_attempt
        .current_published_version_id
        .is_none());

    database.shutdown().await;
}

#[tokio::test]
async fn get_version_projections_preserve_contracts_authorization_and_etag() {
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
    let chart_image = format!("data:image/png;base64,{}", "A".repeat(128 * 1024));
    let saved_version = service
        .save_draft(
            &contract_actor(),
            seeded.id.clone(),
            SaveDraftRequest {
                content_snapshot: json!({
                    "reading": {"passages": [{"blocks": [{
                        "id": "block-1",
                        "type": "SHORT_ANSWER",
                        "answerRule": "ONE_WORD",
                        "answerTree": [{"id": "leaf-1", "acceptedAnswers": ["alpha"]}],
                        "questions": [{
                            "id": "question-1",
                            "correctAnswer": "alpha",
                            "acceptedAnswers": ["alpha", "Alpha"]
                        }]
                    }]}]},
                    "listening": {"parts": []},
                    "writing": {
                        "task1Prompt": "Describe the chart.",
                        "task2Prompt": "Discuss the topic.",
                        "task1Chart": {
                            "id": "chart-1",
                            "title": "Duplicated chart",
                            "type": "bar",
                            "labels": ["A"],
                            "values": [1],
                            "imageSrc": chart_image
                        },
                        "tasks": [
                            {
                                "taskId": "task1",
                                "prompt": "Describe the chart.",
                                "chart": {
                                    "id": "chart-1",
                                    "title": "Duplicated chart",
                                    "type": "bar",
                                    "labels": ["A"],
                                    "values": [1],
                                    "imageSrc": chart_image
                                }
                            },
                            {"taskId": "task2", "prompt": "Discuss the topic."}
                        ]
                    },
                    "speaking": {"part1Topics": [], "cueCard": "", "part3Discussion": []}
                }),
                config_snapshot: json!({
                    "general": {"title": seeded.title},
                    "sections": {"writing": {"enabled": true}}
                }),
                revision: seeded.revision,
            },
        )
        .await
        .expect("save duplicated image draft");
    let app = build_router(app_state(database.pool().clone()));

    let unauthorized = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/api/v1/versions/{}", saved_version.id))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(unauthorized.status(), StatusCode::UNAUTHORIZED);

    let response = app
        .clone()
        .oneshot(
            auth.with_auth(
                Request::builder().uri(format!("/api/v1/versions/{}", saved_version.id)),
            )
            .body(Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let etag = response
        .headers()
        .get("etag")
        .expect("etag header")
        .to_str()
        .expect("etag string")
        .to_owned();
    assert_eq!(
        response.headers().get("cache-control").unwrap(),
        "private, max-age=0, must-revalidate"
    );

    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();

    assert_eq!(json["success"], true);
    assert_eq!(json["data"]["id"], saved_version.id);
    assert!(json["data"]["contentSnapshot"].is_object());
    assert!(json["data"]["configSnapshot"].is_object());
    assert_eq!(
        json["data"]["contentSnapshot"]["writing"]["tasks"][0]["chart"]["imageSrc"],
        chart_image
    );
    assert_eq!(
        json["data"]["contentSnapshot"]["writing"]["task1Chart"]["title"],
        "Duplicated chart"
    );
    assert!(json["data"]["contentSnapshot"]["writing"]["task1Chart"]
        .get("imageSrc")
        .is_none());

    let metadata_response = app
        .clone()
        .oneshot(
            auth.with_auth(Request::builder().uri(format!(
                "/api/v1/versions/{}?projection=metadata",
                saved_version.id
            )))
            .body(Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(metadata_response.status(), StatusCode::OK);
    let metadata_etag = metadata_response
        .headers()
        .get("etag")
        .expect("metadata etag")
        .to_str()
        .unwrap()
        .to_owned();
    let body = to_bytes(metadata_response.into_body(), usize::MAX)
        .await
        .unwrap();
    let metadata_json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(metadata_json["data"]["id"], saved_version.id);
    assert!(metadata_json["data"]["contentSizeBytes"].as_i64().unwrap() > 0);
    assert!(metadata_json["data"].get("contentSnapshot").is_none());

    let metadata_not_modified = app
        .clone()
        .oneshot(
            auth.with_auth(Request::builder().uri(format!(
                "/api/v1/versions/{}?projection=metadata",
                saved_version.id
            )))
            .header("if-none-match", metadata_etag)
            .body(Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(metadata_not_modified.status(), StatusCode::NOT_MODIFIED);

    let legacy_builder_etag = format!(
        r#""exam-version-builder:{}:{}:{}:{}""#,
        saved_version.id,
        saved_version.revision,
        saved_version.is_draft,
        saved_version.is_published
    );
    let builder_response = app
        .clone()
        .oneshot(
            auth.with_auth(Request::builder().uri(format!(
                "/api/v1/versions/{}?projection=builder",
                saved_version.id
            )))
            .header("if-none-match", legacy_builder_etag.as_str())
            .body(Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(builder_response.status(), StatusCode::OK);
    let builder_etag = builder_response
        .headers()
        .get("etag")
        .expect("builder etag")
        .to_str()
        .unwrap()
        .to_owned();
    assert_ne!(builder_etag, legacy_builder_etag);
    assert!(builder_etag.starts_with(r#""exam-version-builder-v2:"#));
    let body = to_bytes(builder_response.into_body(), usize::MAX)
        .await
        .unwrap();
    let builder_json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let projected_question =
        &builder_json["data"]["contentSnapshot"]["reading"]["passages"][0]["blocks"][0];
    assert_eq!(projected_question["answerRule"], "ONE_WORD");
    assert_eq!(
        projected_question["answerTree"][0]["acceptedAnswers"][0],
        "alpha"
    );
    assert_eq!(projected_question["questions"][0]["correctAnswer"], "alpha");
    assert_eq!(
        projected_question["questions"][0]["acceptedAnswers"][1],
        "Alpha"
    );
    assert_eq!(
        builder_json["data"]["configSnapshot"]["general"]["title"],
        seeded.title
    );

    let builder_not_modified = app
        .clone()
        .oneshot(
            auth.with_auth(Request::builder().uri(format!(
                "/api/v1/versions/{}?projection=builder",
                saved_version.id
            )))
            .header("if-none-match", builder_etag)
            .body(Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(builder_not_modified.status(), StatusCode::NOT_MODIFIED);

    let grading_response = app
        .clone()
        .oneshot(
            auth.with_auth(Request::builder().uri(format!(
                "/api/v1/versions/{}?projection=grading",
                saved_version.id
            )))
            .body(Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(grading_response.status(), StatusCode::OK);

    let invalid_projection = app
        .clone()
        .oneshot(
            auth.with_auth(Request::builder().uri(format!(
                "/api/v1/versions/{}?projection=student",
                saved_version.id
            )))
            .body(Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(invalid_projection.status(), StatusCode::BAD_REQUEST);

    let not_modified = app
        .oneshot(
            auth.with_auth(
                Request::builder().uri(format!("/api/v1/versions/{}", saved_version.id)),
            )
            .header("if-none-match", etag)
            .body(Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(not_modified.status(), StatusCode::NOT_MODIFIED);

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
        distributed_rate_limiter: None,
        live_update_bus: None,
        instance_id: "test-instance".to_owned(),
        background_runtime: None,
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
