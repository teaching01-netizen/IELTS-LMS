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
    attempt::{StudentBootstrapRequest, StudentSubmitRequest},
    auth::UserRole,
    exam::{CreateExamRequest, ExamType, PublishExamRequest, SaveDraftRequest, Visibility},
    grading::StartReviewRequest,
    schedule::{CreateScheduleRequest, RuntimeCommandAction, RuntimeCommandRequest},
};
use ielts_backend_infrastructure::{
    actor_context::{ActorContext, ActorRole},
    config::AppConfig,
};

use mysql::create_authenticated_user;

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
    "0011_outbox_notify_trigger.sql",
    "0012_registration_fields.sql",
    "0013_proctor_presence_unique.sql",
    "0014_student_attempt_presence.sql",
    "0015_operation_write_hardening.sql",
    "0016_attempt_mutation_id_uniqueness.sql",
    "0017_production_hardening.sql",
    "0018_exam_day_concurrency_hardening.sql",
    "0019_violation_id_idempotency.sql",
    "0020_schedule_role_display_names.sql",
    "0021_attempt_finalization_consistency.sql",
    "0022_attempt_submission_ledger.sql",
    "0023_sort_memory_hotpath_indexes.sql",
    "0024_projection_sort_hardening.sql",
    "0027_grading_objective_overrides.sql",
    "0028_grading_objective_grading_source.sql",
    "0029_release_events_timestamp_precision.sql",
];

#[tokio::test]
async fn grading_review_and_result_release_flow_round_trips() {
    let database = mysql::TestDatabase::new(GRADING_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();
    let submitted_answers = json!({
        "q-reading-1": "Alpha answer",
        "q-listening-1": "Listening response",
        "q-slot": ["cat", ""]
    });
    let submitted_writing_answers = json!({
        "task1": "<div>Task&nbsp;response</div><div>Second line &amp; detail</div>",
        "task2": {
            "label": "Task 2",
            "prompt": "Discuss both views.",
            "text": "<p>Argument line 1</p><p>Argument line 2</p>"
        }
    });
    let submitted_flags = json!({
        "q-reading-1": true
    });
    let attempt_id = bootstrap_and_submit(
        database.pool(),
        schedule_id,
        "alice",
        submitted_answers.clone(),
        submitted_writing_answers.clone(),
        submitted_flags.clone(),
    )
    .await;
    let auth = create_authenticated_user(
        database.pool(),
        UserRole::Admin,
        "admin@example.com",
        "Test Admin",
    )
    .await;
    let mut config = AppConfig::default();
    config.grading_sync_on_read_fallback = true;
    let app = build_router(AppState::with_pool(config, database.pool().clone()));

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
    assert_eq!(
        session_detail_json["data"]["submissions"][0]["attemptId"],
        attempt_id.to_string()
    );

    let submission_detail = app
        .clone()
        .oneshot(
            auth.with_auth(
                Request::builder().uri(format!("/api/v1/grading/submissions/{}", submission_id)),
            )
            .body(Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(submission_detail.status(), StatusCode::OK);
    let submission_detail_json = json_body(submission_detail).await;
    let returned_submission_id = submission_detail_json["data"]["submissionId"]
        .as_str()
        .or_else(|| submission_detail_json["data"]["id"].as_str())
        .or_else(|| submission_detail_json["data"]["submission"]["submissionId"].as_str())
        .or_else(|| submission_detail_json["data"]["submission"]["id"].as_str())
        .expect("submission id");
    assert_eq!(returned_submission_id, submission_id.to_string());
    let returned_student_name = submission_detail_json["data"]["studentName"]
        .as_str()
        .or_else(|| submission_detail_json["data"]["submission"]["studentName"].as_str())
        .expect("student name");
    assert_eq!(returned_student_name, "Candidate alice");

    let section_detail = app
        .clone()
        .oneshot(
            auth.with_auth(Request::builder().uri(format!(
                "/api/v1/grading/submissions/{}/sections",
                submission_id
            )))
            .body(Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(section_detail.status(), StatusCode::OK);
    let section_detail_json = json_body(section_detail).await;
    let section_items = section_detail_json["data"]
        .as_array()
        .expect("section submissions array");
    let reading_section = section_items
        .iter()
        .find(|entry| entry["section"] == "reading")
        .expect("reading section");
    assert_eq!(
        reading_section["answers"]["answers"]["q-reading-1"],
        submitted_answers["q-reading-1"]
    );
    assert_eq!(
        reading_section["answers"]["answers"]["q-slot"],
        submitted_answers["q-slot"]
    );
    let listening_section = section_items
        .iter()
        .find(|entry| entry["section"] == "listening")
        .expect("listening section");
    assert_eq!(
        listening_section["answers"]["answers"]["q-listening-1"],
        submitted_answers["q-listening-1"]
    );
    let writing_section = section_items
        .iter()
        .find(|entry| entry["section"] == "writing")
        .expect("writing section");
    let writing_tasks = writing_section["answers"]["tasks"]
        .as_array()
        .expect("writing tasks array");
    let task1 = writing_tasks
        .iter()
        .find(|entry| entry["taskId"] == "task1")
        .expect("task1 writing payload");
    assert_eq!(task1["text"], submitted_writing_answers["task1"]);
    let task2 = writing_tasks
        .iter()
        .find(|entry| entry["taskId"] == "task2")
        .expect("task2 writing payload");
    assert_eq!(task2["text"], submitted_writing_answers["task2"]["text"]);

    let writing_task_detail = app
        .clone()
        .oneshot(
            auth.with_auth(Request::builder().uri(format!(
                "/api/v1/grading/submissions/{}/writing-tasks",
                submission_id
            )))
            .body(Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(writing_task_detail.status(), StatusCode::OK);
    let writing_task_detail_json = json_body(writing_task_detail).await;
    let writing_task_items = writing_task_detail_json["data"]
        .as_array()
        .expect("writing task submissions array");
    let stored_task1 = writing_task_items
        .iter()
        .find(|entry| entry["taskId"] == "task1")
        .expect("stored task1");
    assert_eq!(
        stored_task1["studentText"],
        submitted_writing_answers["task1"]
    );
    let stored_task2 = writing_task_items
        .iter()
        .find(|entry| entry["taskId"] == "task2")
        .expect("stored task2");
    assert_eq!(
        stored_task2["studentText"],
        submitted_writing_answers["task2"]["text"]
    );

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
                    serde_json::to_vec(&StartReviewRequest {}).unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(start_review.status(), StatusCode::OK);
    let start_review_json = json_body(start_review).await;
    assert_eq!(
        start_review_json["data"]["teacherId"],
        auth.user_id.to_string()
    );

    let save_draft_missing_revision = app
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
                        "hasUnsavedChanges": false
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(
        save_draft_missing_revision.status(),
        StatusCode::UNPROCESSABLE_ENTITY
    );

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

    let grading_complete = app
        .clone()
        .oneshot(
            auth.with_csrf(Request::builder())
                .method("POST")
                .uri(format!(
                    "/api/v1/grading/submissions/{}/mark-grading-complete",
                    submission_id
                ))
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_vec(&json!({})).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(grading_complete.status(), StatusCode::OK);

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
    let released_results = app
        .clone()
        .oneshot(
            auth.with_auth(Request::builder().uri("/api/v1/results"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(released_results.status(), StatusCode::OK);
    let released_results_json = json_body(released_results).await;
    let released_result = released_results_json["data"]
        .as_array()
        .expect("results array")
        .iter()
        .find(|row| row["submissionId"] == submission_id.to_string())
        .expect("released result row");
    let result_id = released_result["id"]
        .as_str()
        .expect("released result id")
        .to_owned();

    let result_detail = app
        .clone()
        .oneshot(
            auth.with_auth(Request::builder().uri(format!("/api/v1/results/{}", result_id)))
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
    assert_eq!(
        result_detail_json["data"]["writingResults"]["task1"]["prompt"],
        "Summarise the chart."
    );
    assert_eq!(
        result_detail_json["data"]["writingResults"]["task1"]["studentText"],
        submitted_writing_answers["task1"]
    );
    assert_eq!(
        result_detail_json["data"]["writingResults"]["task2"]["studentText"],
        submitted_writing_answers["task2"]["text"]
    );

    let unauthorized_grader = create_authenticated_user(
        database.pool(),
        UserRole::Grader,
        "other-grader@example.com",
        "Other Grader",
    )
    .await;

    let forbidden_result_detail = app
        .clone()
        .oneshot(
            unauthorized_grader
                .with_auth(Request::builder().uri(format!("/api/v1/results/{}", result_id)))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(forbidden_result_detail.status(), StatusCode::FORBIDDEN);

    let forbidden_result_events = app
        .clone()
        .oneshot(
            unauthorized_grader
                .with_auth(Request::builder().uri(format!("/api/v1/results/{}/events", result_id)))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(forbidden_result_events.status(), StatusCode::FORBIDDEN);

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
            auth.with_auth(Request::builder().uri(format!("/api/v1/results/{}/events", result_id)))
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
async fn objective_block_matrix_answers_are_received_and_sectioned() {
    let database = mysql::TestDatabase::new(GRADING_MIGRATIONS).await;
    let schedule = seed_schedule_with_content(
        database.pool(),
        "cambridge-19-academic-block-matrix",
        "Cambridge 19 Academic Block Matrix",
        matrix_content_snapshot(),
    )
    .await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();

    let submitted_answers = matrix_submitted_answers();
    let expected_reading_answers = json!({
        "r-tfng-q1": "T",
        "r-cloze-q1": "alpha",
        "r-matching-q1": "i",
        "r-map-q1": "A",
        "r-short-q1": "fox",
        "r-sentence-q1": ["first", "second"],
        "r-sentence-q1:b1": "first",
        "r-sentence-q1:b2": "second",
        "r-note-q1": ["note answer"],
        "r-note-q1:n1": "note answer"
    });
    let expected_listening_answers = json!({
        "l-multi": ["A", "C"],
        "l-single-q1": "B",
        "l-single-legacy": "Y",
        "l-diagram": ["nose", "ear"],
        "l-diagram:l1": "nose",
        "l-diagram:l2": "ear",
        "l-flow": ["step-1", "step-2"],
        "l-flow:s1": "step-1",
        "l-flow:s2": "step-2",
        "l-table": ["r1c1", "r1c2"],
        "l-table:c1": "r1c1",
        "l-table:c2": "r1c2",
        "l-classify": ["Alpha", "Beta"],
        "l-classify:i1": "Alpha",
        "l-classify:i2": "Beta",
        "l-match-features": ["X", "Y"],
        "l-match-features:f1": "X",
        "l-match-features:f2": "Y"
    });
    let submitted_writing_answers = json!({
        "task1": "<div>Matrix Task 1 response</div>",
        "task2": {
            "label": "Task 2",
            "prompt": "Discuss both views.",
            "text": "<p>Matrix Task 2 response</p>"
        }
    });

    let attempt_id = bootstrap_and_submit(
        database.pool(),
        schedule_id,
        "matrix-candidate",
        submitted_answers.clone(),
        submitted_writing_answers.clone(),
        json!({"r-tfng-q1": true}),
    )
    .await;

    let auth = create_authenticated_user(
        database.pool(),
        UserRole::Admin,
        "admin-matrix@example.com",
        "Matrix Admin",
    )
    .await;
    let mut config = AppConfig::default();
    config.grading_sync_on_read_fallback = true;
    let app = build_router(AppState::with_pool(config, database.pool().clone()));

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
    assert_eq!(
        session_detail_json["data"]["submissions"][0]["attemptId"],
        attempt_id.to_string()
    );

    let section_detail = app
        .clone()
        .oneshot(
            auth.with_auth(Request::builder().uri(format!(
                "/api/v1/grading/submissions/{}/sections",
                submission_id
            )))
            .body(Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(section_detail.status(), StatusCode::OK);
    let section_detail_json = json_body(section_detail).await;
    let section_items = section_detail_json["data"]
        .as_array()
        .expect("section submissions array");
    let reading_section = section_items
        .iter()
        .find(|entry| entry["section"] == "reading")
        .expect("reading section");
    assert_eq!(
        reading_section["answers"]["answers"],
        expected_reading_answers
    );

    let listening_section = section_items
        .iter()
        .find(|entry| entry["section"] == "listening")
        .expect("listening section");
    assert_eq!(
        listening_section["answers"]["answers"],
        expected_listening_answers
    );

    let writing_section = section_items
        .iter()
        .find(|entry| entry["section"] == "writing")
        .expect("writing section");
    let writing_tasks = writing_section["answers"]["tasks"]
        .as_array()
        .expect("writing tasks array");
    let task1 = writing_tasks
        .iter()
        .find(|entry| entry["taskId"] == "task1")
        .expect("task1 writing payload");
    assert_eq!(task1["text"], submitted_writing_answers["task1"]);
    let task2 = writing_tasks
        .iter()
        .find(|entry| entry["taskId"] == "task2")
        .expect("task2 writing payload");
    assert_eq!(task2["text"], submitted_writing_answers["task2"]["text"]);

    database.shutdown().await;
}

#[tokio::test]
async fn objective_block_matrix_auto_scoring_is_correct_per_block() {
    let database = mysql::TestDatabase::new(GRADING_MIGRATIONS).await;
    let schedule = seed_schedule_with_content(
        database.pool(),
        "cambridge-19-academic-block-matrix-scoring",
        "Cambridge 19 Academic Block Matrix Scoring",
        matrix_content_snapshot(),
    )
    .await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();
    let submitted_writing_answers = json!({
        "task1": "<div>Matrix Task 1 response</div>",
        "task2": {
            "label": "Task 2",
            "prompt": "Discuss both views.",
            "text": "<p>Matrix Task 2 response</p>"
        }
    });

    bootstrap_and_submit(
        database.pool(),
        schedule_id,
        "matrix-scorer",
        matrix_submitted_answers(),
        submitted_writing_answers,
        json!({}),
    )
    .await;

    let auth = create_authenticated_user(
        database.pool(),
        UserRole::Admin,
        "admin-scoring@example.com",
        "Scoring Admin",
    )
    .await;
    let mut config = AppConfig::default();
    config.grading_sync_on_read_fallback = true;
    let app = build_router(AppState::with_pool(config, database.pool().clone()));

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

    let section_detail = app
        .oneshot(
            auth.with_auth(Request::builder().uri(format!(
                "/api/v1/grading/submissions/{}/sections",
                submission_id
            )))
            .body(Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(section_detail.status(), StatusCode::OK);
    let section_detail_json = json_body(section_detail).await;
    let section_items = section_detail_json["data"]
        .as_array()
        .expect("section submissions array");
    for section in ["reading", "listening"] {
        let entry = section_items
            .iter()
            .find(|item| item["section"] == section)
            .expect("objective section");
        let auto = &entry["autoGradingResults"];
        let total = auto["totalScore"]
            .as_i64()
            .or_else(|| auto["totalScore"].as_f64().map(|v| v as i64))
            .unwrap_or(0);
        assert!(
            total > 0,
            "expected non-zero auto score for section={section}, got: {auto}"
        );
        let question_results = auto["questionResults"]
            .as_array()
            .expect("question results array");
        assert!(
            !question_results.is_empty(),
            "expected question-level scoring results for section={section}"
        );
    }

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
    let mut config = AppConfig::default();
    config.grading_sync_on_read_fallback = true;
    let app = build_router(AppState::with_pool(config, database.pool().clone()));

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

async fn bootstrap_and_submit(
    pool: &sqlx::MySqlPool,
    schedule_id: Uuid,
    candidate_id: &str,
    answers: serde_json::Value,
    writing_answers: serde_json::Value,
    flags: serde_json::Value,
) -> Uuid {
    let service = DeliveryService::new(pool.clone());
    start_runtime(pool, schedule_id, "listening").await;
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
    let attempt = context.attempt.expect("attempt");
    let attempt_id = attempt.id.clone();
    let attempt_revision = attempt.revision;
    service
        .submit_attempt(
            schedule_id,
            StudentSubmitRequest {
                attempt_id: attempt_id.clone(),
                student_key: student_key(schedule_id, candidate_id),
                answers: Some(answers),
                writing_answers: Some(writing_answers),
                flags: Some(flags),
                last_seen_revision: Some(attempt_revision),
                submission_id: Some(format!("submission-{candidate_id}")),
                client_session_id: None,
                client_final_seq: Some(0),
                server_accepted_through_seq: Some(0),
                final_answer_patch: None,
                final_client_snapshot_hash: None,
            },
            None,
        )
        .await
        .expect("submit attempt");

    Uuid::parse_str(&attempt_id).expect("attempt id")
}

async fn seed_schedule(pool: &sqlx::MySqlPool) -> ielts_backend_domain::schedule::ExamSchedule {
    seed_schedule_with_content(
        pool,
        "cambridge-19-academic-grading",
        "Cambridge 19 Academic Grading",
        default_content_snapshot(),
    )
    .await
}

async fn seed_schedule_with_content(
    pool: &sqlx::MySqlPool,
    slug: &str,
    title: &str,
    content_snapshot: serde_json::Value,
) -> ielts_backend_domain::schedule::ExamSchedule {
    let actor = contract_actor();
    let builder_service = BuilderService::new(pool.clone());
    let exam = builder_service
        .create_exam(
            &actor,
            CreateExamRequest {
                slug: slug.to_owned(),
                title: title.to_owned(),
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
                content_snapshot,
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
                proctor_display_name: exam.title.clone(),
                grading_display_name: exam.title.clone(),
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

fn default_content_snapshot() -> serde_json::Value {
    json!({
        "reading": {
            "passages": [{
                "id": "reading-1",
                "title": "Reading Passage 1",
                "blocks": [{
                    "id": "reading-short-1",
                    "type": "SHORT_ANSWER",
                    "instruction": "Answer the question.",
                    "questions": [{
                        "id": "q-reading-1",
                        "prompt": "What is the keyword?",
                        "correctAnswer": "Alpha answer",
                        "answerRule": "TWO_WORDS"
                    }]
                }, {
                    "id": "reading-sentence-1",
                    "type": "SENTENCE_COMPLETION",
                    "instruction": "Complete the sentence.",
                    "questions": [{
                        "id": "q-slot",
                        "sentence": "The two words are __ and __.",
                        "blanks": [
                            { "id": "b1", "position": 0, "correctAnswer": "cat" },
                            { "id": "b2", "position": 1, "correctAnswer": "dog" }
                        ]
                    }]
                }]
            }]
        },
        "listening": {
            "parts": [{
                "id": "listening-1",
                "title": "Listening Part 1",
                "blocks": [{
                    "id": "listening-short-1",
                    "type": "SHORT_ANSWER",
                    "instruction": "Listen and answer.",
                    "questions": [{
                        "id": "q-listening-1",
                        "prompt": "What did you hear?",
                        "correctAnswer": "Listening response",
                        "answerRule": "TWO_WORDS"
                    }]
                }]
            }]
        },
        "writing": {
            "task1Prompt": "Summarise the chart.",
            "task2Prompt": "Discuss both views.",
            "tasks": [{"id": "task1"}, {"id": "task2"}]
        },
        "speaking": {"part1Topics": ["topic"], "cueCard": "cue", "part3Discussion": ["discussion"]}
    })
}

#[tokio::test]
async fn grading_objective_overrides_apply_strict_matching_and_regrade_immediately() {
    let database = mysql::TestDatabase::new(GRADING_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();
    let submitted_answers = json!({
        "q-reading-1": "alpha answer",
        "q-listening-1": "Listening response",
    });
    let attempt_id = bootstrap_and_submit(
        database.pool(),
        schedule_id,
        "bob",
        submitted_answers.clone(),
        json!({}),
        json!({}),
    )
    .await;
    let auth = create_authenticated_user(
        database.pool(),
        UserRole::Admin,
        "admin@example.com",
        "Test Admin",
    )
    .await;
    let mut config = AppConfig::default();
    config.grading_sync_on_read_fallback = true;
    let app = build_router(AppState::with_pool(config, database.pool().clone()));

    // Ensure grading projection runs.
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

    // Locate the submission id for the attempt.
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
    assert_eq!(
        session_detail_json["data"]["submissions"][0]["attemptId"],
        attempt_id.to_string()
    );

    // Strict matching: "Alpha answer" != "alpha answer" before override.
    let section_detail = app
        .clone()
        .oneshot(
            auth.with_auth(Request::builder().uri(format!(
                "/api/v1/grading/submissions/{}/sections",
                submission_id
            )))
            .body(Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(section_detail.status(), StatusCode::OK);
    let section_detail_json = json_body(section_detail).await;
    let section_items = section_detail_json["data"]
        .as_array()
        .expect("section submissions array");
    let reading_section = section_items
        .iter()
        .find(|entry| entry["section"] == "reading")
        .expect("reading section");
    let q_result = reading_section["autoGradingResults"]["questionResults"]
        .as_array()
        .expect("questionResults")
        .iter()
        .find(|entry| entry["questionId"] == "q-reading-1")
        .expect("q-reading-1 result");
    assert_eq!(q_result["isCorrect"], false);

    // Upsert an override to accept the student's lower-case response and award 2 points.
    let override_response = app
	        .clone()
	        .oneshot(
	            auth.with_csrf(
	                Request::builder()
	                    .method("PUT")
	                    .uri(format!(
	                        "/api/v1/grading/schedules/{}/objective-overrides/{}",
	                        schedule.id, "q-reading-1"
	                    )),
	            )
	            .header("content-type", "application/json")
	            .body(Body::from(
	                json!({
	                    "correctAnswer": "alpha answer",
	                    "acceptedAnswers": [],
	                    "scoringRule": "TWO_WORDS",
                    "maxScore": 2,
                    "reason": "Answer key correction for schedule"
                })
                .to_string(),
            ))
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(override_response.status(), StatusCode::OK);

    // Stored results should reflect override and regrade immediately.
    let section_detail = app
        .clone()
        .oneshot(
            auth.with_auth(Request::builder().uri(format!(
                "/api/v1/grading/submissions/{}/sections",
                submission_id
            )))
            .body(Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(section_detail.status(), StatusCode::OK);
    let section_detail_json = json_body(section_detail).await;
    let section_items = section_detail_json["data"]
        .as_array()
        .expect("section submissions array");
    let reading_section = section_items
        .iter()
        .find(|entry| entry["section"] == "reading")
        .expect("reading section");
    let q_result = reading_section["autoGradingResults"]["questionResults"]
        .as_array()
        .expect("questionResults")
        .iter()
        .find(|entry| entry["questionId"] == "q-reading-1")
        .expect("q-reading-1 result");
    assert_eq!(q_result["isCorrect"], true);
    assert_eq!(q_result["hasOverride"], true);
    assert_eq!(q_result["maxScore"], 2);
    assert_eq!(q_result["awardedScore"], 2);
}

#[tokio::test]
async fn grading_objective_regrade_latest_draft_updates_objective_scores_for_schedule() {
    let database = mysql::TestDatabase::new(GRADING_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();

    let submitted_answers = json!({
        "q-reading-1": "Alpha answer",
        "q-listening-1": "Listening response",
    });
    let attempt_id = bootstrap_and_submit(
        database.pool(),
        schedule_id,
        "draft-regrade",
        submitted_answers.clone(),
        json!({}),
        json!({}),
    )
    .await;

    let auth = create_authenticated_user(
        database.pool(),
        UserRole::Admin,
        "admin@example.com",
        "Test Admin",
    )
    .await;
    let mut config = AppConfig::default();
    config.grading_sync_on_read_fallback = true;
    let app = build_router(AppState::with_pool(config, database.pool().clone()));

    // Ensure grading projection runs.
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

    // Locate submission id for the attempt.
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
    assert_eq!(
        session_detail_json["data"]["submissions"][0]["attemptId"],
        attempt_id.to_string()
    );

    // Baseline: published version snapshot should mark both objective answers correct.
    let section_detail = app
        .clone()
        .oneshot(
            auth.with_auth(Request::builder().uri(format!(
                "/api/v1/grading/submissions/{}/sections",
                submission_id
            )))
            .body(Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(section_detail.status(), StatusCode::OK);
    let section_detail_json = json_body(section_detail).await;
    let section_items = section_detail_json["data"]
        .as_array()
        .expect("section submissions array");
    let reading_section = section_items
        .iter()
        .find(|entry| entry["section"] == "reading")
        .expect("reading section");
    assert_eq!(
        reading_section["autoGradingResults"]["totalScore"],
        json!(1)
    );
    let listening_section = section_items
        .iter()
        .find(|entry| entry["section"] == "listening")
        .expect("listening section");
    assert_eq!(
        listening_section["autoGradingResults"]["totalScore"],
        json!(1)
    );

    // Create a new draft that changes the objective answer key.
    let actor = contract_actor();
    let builder_service = BuilderService::new(database.pool().clone());
    let exam = builder_service
        .get_exam(&actor, schedule.exam_id.clone())
        .await
        .expect("load exam");
    let mut draft_snapshot = default_content_snapshot();
    draft_snapshot["reading"]["passages"][0]["blocks"][0]["questions"][0]["correctAnswer"] =
        json!("Beta answer");
    draft_snapshot["listening"]["parts"][0]["blocks"][0]["questions"][0]["correctAnswer"] =
        json!("Different response");

    builder_service
        .save_draft(
            &actor,
            schedule.exam_id.clone(),
            SaveDraftRequest {
                content_snapshot: draft_snapshot,
                config_snapshot: sample_delivery_config(),
                revision: exam.revision,
            },
        )
        .await
        .expect("save new draft");

    let exam_after_draft = builder_service
        .get_exam(&actor, schedule.exam_id.clone())
        .await
        .expect("load exam after draft");
    let draft_version_id = exam_after_draft
        .current_draft_version_id
        .clone()
        .expect("draft version id");
    let draft_version = builder_service
        .get_version(&actor, draft_version_id.clone())
        .await
        .expect("load draft version");
    assert_eq!(
        draft_version.content_snapshot["reading"]["passages"][0]["blocks"][0]["questions"][0]
            ["correctAnswer"],
        json!("Beta answer")
    );

    // Regrade using latest draft snapshot (not the published version).
    let regrade = app
        .clone()
        .oneshot(
            auth.with_csrf(
                Request::builder()
                    .method("POST")
                    .uri(format!(
                        "/api/v1/grading/schedules/{}/objective-regrade-latest-draft",
                        schedule.id
                    )),
            )
            .header("content-type", "application/json")
            .body(Body::from(json!({ "reason": "Use latest draft" }).to_string()))
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(regrade.status(), StatusCode::OK);
    let regrade_json = json_body(regrade).await;
    assert_eq!(regrade_json["data"]["draftVersionId"], json!(draft_version_id));
    assert_eq!(regrade_json["data"]["regradeReport"]["attemptsScanned"], json!(1));
    assert_eq!(regrade_json["data"]["regradeReport"]["sectionsUpdated"], json!(2));

    // After regrade, the stored objective totals should reflect the latest draft answer key (both incorrect).
    let section_detail = app
        .clone()
        .oneshot(
            auth.with_auth(Request::builder().uri(format!(
                "/api/v1/grading/submissions/{}/sections",
                submission_id
            )))
            .body(Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(section_detail.status(), StatusCode::OK);
    let section_detail_json = json_body(section_detail).await;
    let section_items = section_detail_json["data"]
        .as_array()
        .expect("section submissions array");
    let reading_section = section_items
        .iter()
        .find(|entry| entry["section"] == "reading")
        .expect("reading section");
    assert_eq!(
        reading_section["autoGradingResults"]["totalScore"],
        json!(0)
    );
    let listening_section = section_items
        .iter()
        .find(|entry| entry["section"] == "listening")
        .expect("listening section");
    assert_eq!(
        listening_section["autoGradingResults"]["totalScore"],
        json!(0)
    );
}

fn matrix_submitted_answers() -> serde_json::Value {
    json!({
        "r-tfng-q1": "T",
        "r-cloze-q1": "alpha",
        "r-matching-q1": "i",
        "r-map-q1": "A",
        "r-short-q1": "fox",
        "r-sentence-q1": ["first", "second"],
        "r-sentence-q1:b1": "first",
        "r-sentence-q1:b2": "second",
        "r-note-q1": ["note answer"],
        "r-note-q1:n1": "note answer",
        "l-multi": ["A", "C"],
        "l-single-q1": "B",
        "l-single-legacy": "Y",
        "l-diagram": ["nose", "ear"],
        "l-diagram:l1": "nose",
        "l-diagram:l2": "ear",
        "l-flow": ["step-1", "step-2"],
        "l-flow:s1": "step-1",
        "l-flow:s2": "step-2",
        "l-table": ["r1c1", "r1c2"],
        "l-table:c1": "r1c1",
        "l-table:c2": "r1c2",
        "l-classify": ["Alpha", "Beta"],
        "l-classify:i1": "Alpha",
        "l-classify:i2": "Beta",
        "l-match-features": ["X", "Y"],
        "l-match-features:f1": "X",
        "l-match-features:f2": "Y"
    })
}

fn matrix_content_snapshot() -> serde_json::Value {
    json!({
        "reading": {
            "passages": [{
                "id": "reading-matrix-p1",
                "title": "Reading Passage Matrix",
                "blocks": [
                    {
                        "id": "r-tfng",
                        "type": "TFNG",
                        "mode": "TFNG",
                        "questions": [{ "id": "r-tfng-q1", "statement": "Statement 1" }]
                    },
                    {
                        "id": "r-cloze",
                        "type": "CLOZE",
                        "questions": [{ "id": "r-cloze-q1", "prompt": "Fill blank" }]
                    },
                    {
                        "id": "r-matching",
                        "type": "MATCHING",
                        "headings": [{ "id": "i", "text": "Heading I" }, { "id": "ii", "text": "Heading II" }],
                        "questions": [{ "id": "r-matching-q1", "statement": "Match this" }]
                    },
                    {
                        "id": "r-map",
                        "type": "MAP",
                        "questions": [{ "id": "r-map-q1", "label": "Spot A" }]
                    },
                    {
                        "id": "r-short",
                        "type": "SHORT_ANSWER",
                        "questions": [{ "id": "r-short-q1", "prompt": "Name the animal", "correctAnswer": "fox" }]
                    },
                    {
                        "id": "r-sentence",
                        "type": "SENTENCE_COMPLETION",
                        "questions": [{
                            "id": "r-sentence-q1",
                            "sentence": "Fill __ then __.",
                            "blanks": [
                                { "id": "b1", "correctAnswer": "first" },
                                { "id": "b2", "correctAnswer": "second" }
                            ]
                        }]
                    },
                    {
                        "id": "r-note",
                        "type": "NOTE_COMPLETION",
                        "questions": [{
                            "id": "r-note-q1",
                            "noteText": "Write a note __.",
                            "blanks": [{ "id": "n1", "correctAnswer": "note answer" }]
                        }]
                    }
                ]
            }]
        },
        "listening": {
            "parts": [{
                "id": "listening-matrix-p1",
                "title": "Listening Part Matrix",
                "blocks": [
                    {
                        "id": "l-multi",
                        "type": "MULTI_MCQ",
                        "requiredSelections": 2,
                        "options": [
                            { "id": "A", "text": "Option A", "isCorrect": true },
                            { "id": "B", "text": "Option B", "isCorrect": false },
                            { "id": "C", "text": "Option C", "isCorrect": true }
                        ]
                    },
                    {
                        "id": "l-single-question-set",
                        "type": "SINGLE_MCQ",
                        "questions": [{
                            "id": "l-single-q1",
                            "stem": "Pick one",
                            "options": [
                                { "id": "A", "text": "Option A", "isCorrect": false },
                                { "id": "B", "text": "Option B", "isCorrect": true }
                            ]
                        }]
                    },
                    {
                        "id": "l-single-legacy",
                        "type": "SINGLE_MCQ",
                        "stem": "Pick one (legacy)",
                        "options": [
                            { "id": "X", "text": "Option X", "isCorrect": false },
                            { "id": "Y", "text": "Option Y", "isCorrect": true }
                        ]
                    },
                    {
                        "id": "l-diagram",
                        "type": "DIAGRAM_LABELING",
                        "imageUrl": "https://example.com/diagram.png",
                        "labels": [
                            { "id": "l1", "correctAnswer": "nose" },
                            { "id": "l2", "correctAnswer": "ear" }
                        ]
                    },
                    {
                        "id": "l-flow",
                        "type": "FLOW_CHART",
                        "steps": [
                            { "id": "s1", "label": "Step 1", "correctAnswer": "step-1" },
                            { "id": "s2", "label": "Step 2", "correctAnswer": "step-2" }
                        ]
                    },
                    {
                        "id": "l-table",
                        "type": "TABLE_COMPLETION",
                        "headers": ["Col 1", "Col 2"],
                        "rows": [["", ""]],
                        "cells": [
                            { "id": "c1", "correctAnswer": "r1c1" },
                            { "id": "c2", "correctAnswer": "r1c2" }
                        ]
                    },
                    {
                        "id": "l-classify",
                        "type": "CLASSIFICATION",
                        "categories": ["Alpha", "Beta"],
                        "items": [
                            { "id": "i1", "text": "Item 1", "correctCategory": "Alpha" },
                            { "id": "i2", "text": "Item 2", "correctCategory": "Beta" }
                        ]
                    },
                    {
                        "id": "l-match-features",
                        "type": "MATCHING_FEATURES",
                        "options": ["X", "Y"],
                        "features": [
                            { "id": "f1", "text": "Feature 1", "correctMatch": "X" },
                            { "id": "f2", "text": "Feature 2", "correctMatch": "Y" }
                        ]
                    }
                ]
            }]
        },
        "writing": {
            "task1Prompt": "Summarise the chart.",
            "task2Prompt": "Discuss both views.",
            "tasks": [{"id": "task1"}, {"id": "task2"}]
        },
        "speaking": {"part1Topics": ["topic"], "cueCard": "cue", "part3Discussion": ["discussion"]}
    })
}

fn sample_delivery_config() -> serde_json::Value {
    json!({
        "sections": {
            "listening": {
                "enabled": true,
                "label": "Listening",
                "order": 1,
                "duration": 30,
                "gapAfterMinutes": 5,
                "bandScoreTable": { "39": 9.0, "37": 8.5, "35": 8.0, "32": 7.5, "30": 7.0, "26": 6.5, "23": 6.0, "18": 5.5, "16": 5.0, "13": 4.5, "10": 4.0, "6": 3.5, "4": 3.0, "2": 2.5 }
            },
            "reading": {
                "enabled": true,
                "label": "Reading",
                "order": 2,
                "duration": 60,
                "gapAfterMinutes": 0,
                "bandScoreTable": { "39": 9.0, "37": 8.5, "35": 8.0, "33": 7.5, "30": 7.0, "27": 6.5, "23": 6.0, "19": 5.5, "15": 5.0, "13": 4.5, "10": 4.0, "8": 3.5, "6": 3.0, "4": 2.5 }
            },
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

async fn start_runtime(pool: &sqlx::MySqlPool, schedule_id: Uuid, section_key: &str) {
    let actor = contract_actor();
    SchedulingService::new(pool.clone())
        .apply_runtime_command(
            &actor,
            schedule_id,
            RuntimeCommandRequest {
                action: RuntimeCommandAction::StartRuntime,
                reason: Some(format!("grading contract bootstrap: {section_key}")),
            },
        )
        .await
        .unwrap();
}
