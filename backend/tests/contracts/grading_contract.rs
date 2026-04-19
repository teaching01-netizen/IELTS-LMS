#[path = "../support/mysql.rs"]
mod mysql;

use axum::{
    body::{to_bytes, Body},
    http::{Request, StatusCode},
};
use chrono::{Duration, TimeZone, Utc};
use serde_json::json;
use tower::ServiceExt;
use uuid::Uuid;

use ielts_backend_api::{router::build_router, state::AppState};
use ielts_backend_application::{
    builder::BuilderService, delivery::DeliveryService, scheduling::SchedulingService,
};
use ielts_backend_domain::{
    auth::UserRole,
    attempt::{StudentBootstrapRequest, StudentSubmitRequest},
    exam::{CreateExamRequest, ExamType, PublishExamRequest, SaveDraftRequest, Visibility},
    grading::StartReviewRequest,
    schedule::CreateScheduleRequest,
};
use ielts_backend_infrastructure::{
    actor_context::{ActorContext, ActorRole},
    config::AppConfig,
};

use mysql::{assign_staff_to_schedule, create_authenticated_user};

const GRADING_MIGRATIONS: &[&str] = &[
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
async fn grading_review_and_result_release_flow_round_trips() {
    let database = mysql::TestDatabase::new(GRADING_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();
    let attempt_id = bootstrap_and_submit(database.pool(), schedule_id, "alice").await;
    let auth = create_authenticated_user(
        database.pool(),
        UserRole::Grader,
        "grader@example.com",
        "Test Grader",
    )
    .await;
    assign_staff_to_schedule(database.pool(), schedule_id, auth.user_id, "grader").await;
    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));

    let sessions = app
        .clone()
        .oneshot(
            auth.with_auth(Request::builder().uri("/api/v1/grading/sessions"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(sessions.status(), StatusCode::OK);
    let sessions_json = json_body(sessions).await;
    assert_eq!(
        sessions_json["data"][0]["scheduleId"],
        schedule.id.to_string()
    );
    assert_eq!(sessions_json["data"][0]["submittedCount"], 1);

    let session_detail = app
        .clone()
        .oneshot(
            auth.with_auth(
                Request::builder().uri(format!("/api/v1/grading/sessions/{}", schedule.id)),
            )
            .body(Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(session_detail.status(), StatusCode::OK);
    let session_detail_json = json_body(session_detail).await;
    let submission_id = Uuid::parse_str(
        session_detail_json["data"]["submissions"][0]["id"]
            .as_str()
            .unwrap(),
    )
    .unwrap();

    let start_review = app
        .clone()
        .oneshot(
            auth.with_csrf(Request::builder())
                .method("POST")
                .uri(format!(
                    "/api/v1/grading/submissions/{}/start-review",
                    submission_id
                ))
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&StartReviewRequest {})
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(start_review.status(), StatusCode::OK);
    let start_review_json = json_body(start_review).await;
    assert_eq!(start_review_json["data"]["teacherId"], auth.user_id.to_string());

    let save_draft = app
        .clone()
        .oneshot(
            auth.with_csrf(Request::builder())
                .method("PUT")
                .uri(format!(
                    "/api/v1/grading/submissions/{}/review-draft",
                    submission_id
                ))
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "teacherId": auth.user_id.to_string(),
                        "sectionDrafts": {
                            "listening": {"overallBand": 7.0},
                            "reading": {"overallBand": 6.5},
                            "writing": {
                                "task1": {"overallBand": 6.0},
                                "task2": {"overallBand": 6.5}
                            },
                            "speaking": {"overallBand": 7.0}
                        },
                        "annotations": [],
                        "drawings": [],
                        "teacherSummary": {
                            "strengths": ["Fluent reading comprehension"],
                            "improvementPriorities": ["More task response detail"],
                            "recommendedPractice": ["Timed writing drills"]
                        },
                        "checklist": {"rubricAligned": true},
                        "hasUnsavedChanges": false,
                        "revision": 0
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(save_draft.status(), StatusCode::OK);
    let save_draft_json = json_body(save_draft).await;
    assert_eq!(save_draft_json["data"]["revision"], 1);

    for route in [
        "mark-grading-complete",
        "mark-ready-to-release",
        "reopen-review",
    ] {
        let response = app
            .clone()
            .oneshot(
                auth.with_csrf(Request::builder())
                    .method("POST")
                    .uri(format!(
                        "/api/v1/grading/submissions/{}/{}",
                        submission_id, route
                    ))
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_vec(&json!({})).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }

    let ready = app
        .clone()
        .oneshot(
            auth.with_csrf(Request::builder())
                .method("POST")
                .uri(format!(
                    "/api/v1/grading/submissions/{}/mark-ready-to-release",
                    submission_id
                ))
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_vec(&json!({})).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(ready.status(), StatusCode::OK);

    let scheduled_release_at = Utc.with_ymd_and_hms(2026, 1, 2, 9, 0, 0).single().unwrap();
    let scheduled = app
        .clone()
        .oneshot(
            auth.with_csrf(Request::builder())
                .method("POST")
                .uri(format!(
                    "/api/v1/grading/submissions/{}/schedule-release",
                    submission_id
                ))
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "teacherName": "Taylor Grader",
                        "releaseAt": scheduled_release_at,
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(scheduled.status(), StatusCode::OK);
    let scheduled_json = json_body(scheduled).await;
    assert_eq!(scheduled_json["data"]["releaseStatus"], "ready_to_release");

    let scheduled_results = app
        .clone()
        .oneshot(
            auth.with_auth(Request::builder().uri("/api/v1/results"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(scheduled_results.status(), StatusCode::OK);
    let scheduled_results_json = json_body(scheduled_results).await;
    assert_eq!(
        scheduled_results_json["data"][0]["releaseStatus"],
        "ready_to_release"
    );
    assert_eq!(
        chrono::DateTime::parse_from_rfc3339(
            scheduled_results_json["data"][0]["scheduledReleaseDate"]
                .as_str()
                .unwrap(),
        )
        .unwrap()
        .with_timezone(&Utc),
        scheduled_release_at
    );

    let pre_release_analytics = app
        .clone()
        .oneshot(
            auth.with_auth(Request::builder().uri("/api/v1/results/analytics"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(pre_release_analytics.status(), StatusCode::OK);
    let pre_release_analytics_json = json_body(pre_release_analytics).await;
    assert_eq!(pre_release_analytics_json["data"]["totalResults"], 1);
    assert_eq!(pre_release_analytics_json["data"]["readyToRelease"], 1);
    assert_eq!(pre_release_analytics_json["data"]["releasedResults"], 0);

    let release = app
        .clone()
        .oneshot(
            auth.with_csrf(Request::builder())
                .method("POST")
                .uri(format!(
                    "/api/v1/grading/submissions/{}/release-now",
                    submission_id
                ))
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_vec(&json!({})).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(release.status(), StatusCode::OK);
    let release_json = json_body(release).await;
    assert_eq!(release_json["data"]["releaseStatus"], "released");
    let result_id = release_json["data"]["id"].as_str().unwrap().to_owned();

    let result_detail = app
        .clone()
        .oneshot(
            auth.with_auth(
                Request::builder().uri(format!("/api/v1/results/{}", result_id)),
            )
            .body(Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(result_detail.status(), StatusCode::OK);
    let result_detail_json = json_body(result_detail).await;
    assert_eq!(
        result_detail_json["data"]["submissionId"],
        submission_id.to_string()
    );

    let analytics = app
        .clone()
        .oneshot(
            auth.with_auth(Request::builder().uri("/api/v1/results/analytics"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(analytics.status(), StatusCode::OK);
    let analytics_json = json_body(analytics).await;
    assert_eq!(analytics_json["data"]["totalResults"], 1);
    assert_eq!(analytics_json["data"]["releasedResults"], 1);

    let events = app
        .clone()
        .oneshot(
            auth.with_auth(
                Request::builder().uri(format!("/api/v1/results/{}/events", result_id)),
            )
            .body(Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(events.status(), StatusCode::OK);
    let events_json = json_body(events).await;
    assert_eq!(events_json["data"][0]["action"], "released");

    let export = app
        .oneshot(
            auth.with_csrf(Request::builder())
                .method("POST")
                .uri("/api/v1/results/export")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(export.status(), StatusCode::OK);
    let export_json = json_body(export).await;
    assert_eq!(export_json["data"]["count"], 1);
    assert_eq!(
        attempt_id.to_string(),
        session_detail_json["data"]["submissions"][0]["attemptId"]
    );

    database.shutdown().await;
}

#[tokio::test]
async fn media_upload_intent_and_completion_round_trip() {
    let database = mysql::TestDatabase::new(GRADING_MIGRATIONS).await;
    let auth = create_authenticated_user(
        database.pool(),
        UserRole::Grader,
        "grader@example.com",
        "Test Grader",
    )
    .await;
    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));

    let create = app
        .clone()
        .oneshot(
            auth.with_csrf(Request::builder())
                .method("POST")
                .uri("/api/v1/media/uploads")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "ownerKind": "submission",
                        "ownerId": "sub-123",
                        "contentType": "audio/webm",
                        "fileName": "speaking.webm"
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(create.status(), StatusCode::OK);
    let create_json = json_body(create).await;
    let asset_id = create_json["data"]["asset"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    assert_eq!(create_json["data"]["asset"]["uploadStatus"], "pending");

    let complete = app
        .clone()
        .oneshot(
            auth.with_csrf(Request::builder())
                .method("POST")
                .uri(format!("/api/v1/media/uploads/{asset_id}/complete"))
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "sizeBytes": 4096,
                        "checksumSha256": "abc123"
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(complete.status(), StatusCode::OK);
    let complete_json = json_body(complete).await;
    assert_eq!(complete_json["data"]["uploadStatus"], "finalized");
    assert_ne!(
        complete_json["data"]["downloadUrl"],
        serde_json::Value::Null
    );

    let get = app
        .oneshot(
            auth.with_auth(Request::builder().uri(format!("/api/v1/media/{asset_id}")))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(get.status(), StatusCode::OK);
    let get_json = json_body(get).await;
    assert_eq!(get_json["data"]["id"], asset_id);

    database.shutdown().await;
}

async fn bootstrap_and_submit(pool: &sqlx::MySqlPool, schedule_id: Uuid, candidate_id: &str) -> Uuid {
    let service = DeliveryService::new(pool.clone());
    let context = service
        .bootstrap(
            schedule_id,
            StudentBootstrapRequest {
                student_key: student_key(schedule_id, candidate_id),
                candidate_id: candidate_id.to_owned(),
                candidate_name: format!("Candidate {candidate_id}"),
                candidate_email: format!("{candidate_id}@example.com"),
                email: Some(format!("{candidate_id}@example.com")),
                wcode: Some("W123456".to_owned()),
                client_session_id: Uuid::new_v4().to_string(),
            },
        )
        .await
        .expect("bootstrap attempt");
    let attempt_id = context.attempt.expect("attempt").id;
    service
        .submit_attempt(
            schedule_id,
            StudentSubmitRequest {
                attempt_id: attempt_id.clone(),
                student_key: student_key(schedule_id, candidate_id),
            },
            None,
        )
        .await
        .expect("submit attempt");

    Uuid::parse_str(&attempt_id).expect("attempt id")
}

async fn seed_schedule(pool: &sqlx::MySqlPool) -> ielts_backend_domain::schedule::ExamSchedule {
    let actor = contract_actor();
    let builder_service = BuilderService::new(pool.clone());
    let exam = builder_service
        .create_exam(
            &actor,
            CreateExamRequest {
                slug: "cambridge-19-academic-grading".to_owned(),
                title: "Cambridge 19 Academic Grading".to_owned(),
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
                    "reading": {"passages": [{"id": "reading-1"}]},
                    "listening": {"parts": [{"id": "listening-1"}]},
                    "writing": {"tasks": [{"id": "task1"}, {"id": "task2"}]},
                    "speaking": {"part1Topics": ["topic"], "cueCard": "cue", "part3Discussion": ["discussion"]}
                }),
                config_snapshot: sample_delivery_config(),
                revision: exam.revision,
            },
        )
        .await
        .expect("save draft");

    let exam_after_draft = builder_service
        .get_exam(&actor, exam_id.clone())
        .await
        .expect("exam after draft");

    let published_version = builder_service
        .publish_exam(
            &actor,
            exam_id.clone(),
            PublishExamRequest {
                publish_notes: Some("ready for grading contracts".to_owned()),
                revision: exam_after_draft.revision,
            },
        )
        .await
        .expect("publish exam");

    SchedulingService::new(pool.clone())
        .create_schedule(
            &actor,
            CreateScheduleRequest {
                exam_id,
                published_version_id: published_version.id,
                cohort_name: "Grading Cohort".to_owned(),
                institution: Some("IELTS Centre".to_owned()),
                start_time: Utc.with_ymd_and_hms(2026, 1, 10, 9, 0, 0).unwrap(),
                end_time: Utc.with_ymd_and_hms(2026, 1, 10, 9, 0, 0).unwrap()
                    + Duration::minutes(180),
                auto_start: false,
                auto_stop: false,
            },
        )
        .await
        .expect("create schedule")
}

fn sample_delivery_config() -> serde_json::Value {
    json!({
        "sections": {
            "listening": {"enabled": true, "label": "Listening", "order": 1, "duration": 30, "gapAfterMinutes": 5},
            "reading": {"enabled": true, "label": "Reading", "order": 2, "duration": 60, "gapAfterMinutes": 0},
            "writing": {"enabled": true, "label": "Writing", "order": 3, "duration": 60, "gapAfterMinutes": 10},
            "speaking": {"enabled": true, "label": "Speaking", "order": 4, "duration": 15, "gapAfterMinutes": 0}
        }
    })
}

async fn json_body(response: axum::response::Response) -> serde_json::Value {
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    serde_json::from_slice(&body).unwrap()
}

fn student_key(schedule_id: Uuid, candidate_id: &str) -> String {
    format!("student-{schedule_id}-{candidate_id}")
}

fn contract_actor() -> ActorContext {
    ActorContext::new(Uuid::new_v4().to_string(), ActorRole::Admin)
}
