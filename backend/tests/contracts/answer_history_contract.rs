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
use ielts_backend_domain::actor_context::{ActorContext, ActorRole};
use ielts_backend_domain::{
    attempt::{StudentBootstrapRequest, StudentSubmitRequest},
    auth::UserRole,
    exam::{CreateExamRequest, ExamType, PublishExamRequest, SaveDraftRequest, Visibility},
    schedule::CreateScheduleRequest,
};
use ielts_backend_infrastructure::config::AppConfig;

use mysql::{assign_staff_to_schedule, create_authenticated_user};

const ANSWER_HISTORY_MIGRATIONS: &[&str] = &[
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
async fn admin_can_fetch_answer_history_overview_and_detail() {
    let database = mysql::TestDatabase::new(ANSWER_HISTORY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();

    let attempt_id = bootstrap_and_submit(
        database.pool(),
        schedule_id,
        "alice",
        json!({ "q1": "alpha" }),
        json!({ "task1": "seed" }),
    )
    .await;
    let submission_id = submission_id_for_attempt(database.pool(), attempt_id).await;

    insert_mutation(
        database.pool(),
        schedule_id,
        attempt_id,
        "SetScalar",
        1,
        json!({ "questionId": "q1", "value": "policy", "baseRevision": 0, "module": "objective" }),
        Utc.with_ymd_and_hms(2026, 1, 10, 9, 10, 0).unwrap(),
    )
    .await;
    insert_mutation(
        database.pool(),
        schedule_id,
        attempt_id,
        "SetScalar",
        2,
        json!({ "questionId": "q1", "value": "politic", "baseRevision": 1, "module": "reading" }),
        Utc.with_ymd_and_hms(2026, 1, 10, 9, 12, 0).unwrap(),
    )
    .await;
    insert_mutation(
        database.pool(),
        schedule_id,
        attempt_id,
        "writing_answer",
        3,
        json!({ "taskId": "task1", "value": "first essay paragraph", "baseRevision": 2, "module": "writing" }),
        Utc.with_ymd_and_hms(2026, 1, 10, 9, 15, 0).unwrap(),
    )
    .await;
    insert_mutation(
        database.pool(),
        schedule_id,
        attempt_id,
        "SetScalar",
        4,
        json!({ "questionId": "legacy-q", "value": "legacy", "baseRevision": 3, "module": "objective" }),
        Utc.with_ymd_and_hms(2026, 1, 10, 9, 18, 0).unwrap(),
    )
    .await;

    let auth = create_authenticated_user(
        database.pool(),
        UserRole::Admin,
        "admin@example.com",
        "Admin",
    )
    .await;
    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));

    let overview = app
        .clone()
        .oneshot(
            auth.with_auth(Request::builder().uri(format!(
                "/api/v1/answer-history/submissions/{}/overview",
                submission_id
            )))
            .body(Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(overview.status(), StatusCode::OK);
    let overview_json = json_body(overview).await;
    assert_eq!(
        overview_json["data"]["submissionId"],
        submission_id.to_string()
    );
    let summaries = overview_json["data"]["questionSummaries"]
        .as_array()
        .expect("question summaries");
    let summary_targets = summaries
        .iter()
        .map(|item| item["targetId"].as_str().unwrap_or_default())
        .collect::<Vec<_>>();
    assert_eq!(summary_targets, vec!["q1", "q2", "task1", "legacy-q"]);
    assert_eq!(summaries[0]["label"], "Question 1");
    assert_eq!(summaries[0]["module"], "reading");
    assert_eq!(summaries[1]["label"], "Question 2");
    assert_eq!(summaries[2]["label"], "Task 1");
    assert_eq!(summaries[3]["label"], "Question 3 (Unmapped)");
    assert_eq!(summaries[3]["module"], "objective");

    assert!(overview_json["data"]["questionSummaries"]
        .as_array()
        .map(|items| {
            items
                .iter()
                .any(|item| item["targetId"] == "task1" && item["targetType"] == "writing")
        })
        .unwrap_or(false));
    assert!(overview_json["data"]["questionSummaries"]
        .as_array()
        .map(|items| {
            items.iter().any(|item| {
                item["targetId"] == "q2"
                    && item["targetType"] == "objective"
                    && item["revisionCount"] == 0
                    && item["answered"] == false
            })
        })
        .unwrap_or(false));
    assert!(
        overview_json["data"]["totalRevisions"]
            .as_i64()
            .unwrap_or(0)
            >= 3
    );

    let detail = app
        .clone()
        .oneshot(
            auth.with_auth(Request::builder().uri(format!(
                "/api/v1/answer-history/submissions/{}/targets/q1?targetType=objective",
                submission_id
            )))
            .body(Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(detail.status(), StatusCode::OK);
    let detail_json = json_body(detail).await;
    assert_eq!(detail_json["data"]["targetId"], "q1");
    assert_eq!(detail_json["data"]["targetType"], "objective");

    let export = app
        .clone()
        .oneshot(
            auth.with_auth(
                Request::builder().uri(format!(
                    "/api/v1/answer-history/submissions/{}/export?targetType=objective&targetId=q1&format=csv",
                    submission_id
                )),
            )
            .body(Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(export.status(), StatusCode::OK);
    let export_json = json_body(export).await;
    let content = export_json["data"]["content"].as_str().unwrap_or("");
    assert!(content.contains("checkpointIndex"));

    database.shutdown().await;
}

#[tokio::test]
async fn overview_and_detail_read_nested_mutation_payload_shapes() {
    let database = mysql::TestDatabase::new(ANSWER_HISTORY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();

    let attempt_id = bootstrap_and_submit(
        database.pool(),
        schedule_id,
        "nested-payload",
        json!({ "q1": "final" }),
        json!({}),
    )
    .await;
    let submission_id = submission_id_for_attempt(database.pool(), attempt_id).await;

    insert_mutation(
        database.pool(),
        schedule_id,
        attempt_id,
        "SetScalar",
        1,
        json!({
            "command": {
                "question_id": "q1",
                "value": "draft-1"
            },
            "module": "reading"
        }),
        Utc.with_ymd_and_hms(2026, 1, 10, 9, 20, 0).unwrap(),
    )
    .await;
    insert_mutation(
        database.pool(),
        schedule_id,
        attempt_id,
        "position",
        2,
        json!({
            "command": {
                "current_question_id": "q1",
                "current_module": "reading"
            }
        }),
        Utc.with_ymd_and_hms(2026, 1, 10, 9, 20, 2).unwrap(),
    )
    .await;

    let auth = create_authenticated_user(
        database.pool(),
        UserRole::Admin,
        "admin-nested@example.com",
        "Admin Nested",
    )
    .await;
    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));

    let overview = app
        .clone()
        .oneshot(
            auth.with_auth(Request::builder().uri(format!(
                "/api/v1/answer-history/submissions/{}/overview",
                submission_id
            )))
            .body(Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(overview.status(), StatusCode::OK);
    let overview_json = json_body(overview).await;
    assert!(overview_json["data"]["questionSummaries"]
        .as_array()
        .map(|items| {
            items.iter().any(|item| {
                item["targetId"] == "q1"
                    && item["targetType"] == "objective"
                    && item["revisionCount"] == 2
                    && item["finalValue"] == "draft-1"
            })
        })
        .unwrap_or(false));

    let detail = app
        .oneshot(
            auth.with_auth(Request::builder().uri(format!(
                "/api/v1/answer-history/submissions/{}/targets/q1?targetType=objective",
                submission_id
            )))
            .body(Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(detail.status(), StatusCode::OK);
    let detail_json = json_body(detail).await;
    assert_eq!(detail_json["data"]["targetId"], "q1");
    assert_eq!(
        detail_json["data"]["checkpoints"][0]["stateSnapshot"],
        "draft-1"
    );
    assert_eq!(
        detail_json["data"]["checkpoints"][1]["stateSnapshot"],
        "draft-1"
    );

    database.shutdown().await;
}

#[tokio::test]
async fn overview_includes_catalog_targets_without_mutations_and_detail_uses_submitted_snapshot() {
    let database = mysql::TestDatabase::new(ANSWER_HISTORY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();

    let attempt_id = bootstrap_and_submit(
        database.pool(),
        schedule_id,
        "catalog-only",
        json!({ "q1": "submitted-only" }),
        json!({ "task1": "essay only" }),
    )
    .await;
    let submission_id = submission_id_for_attempt(database.pool(), attempt_id).await;

    let auth = create_authenticated_user(
        database.pool(),
        UserRole::Admin,
        "admin-catalog@example.com",
        "Admin Catalog",
    )
    .await;
    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));

    let overview = app
        .clone()
        .oneshot(
            auth.with_auth(Request::builder().uri(format!(
                "/api/v1/answer-history/submissions/{}/overview",
                submission_id
            )))
            .body(Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(overview.status(), StatusCode::OK);
    let overview_json = json_body(overview).await;
    assert_eq!(overview_json["data"]["totalRevisions"], 0);
    assert_eq!(overview_json["data"]["totalTargetsEdited"], 0);
    assert!(overview_json["data"]["questionSummaries"]
        .as_array()
        .map(|items| {
            items.iter().any(|item| {
                item["targetId"] == "q1"
                    && item["targetType"] == "objective"
                    && item["revisionCount"] == 0
                    && item["answered"] == true
                    && item["finalValue"] == "submitted-only"
            }) && items.iter().any(|item| {
                item["targetId"] == "q2"
                    && item["targetType"] == "objective"
                    && item["revisionCount"] == 0
                    && item["answered"] == false
                    && item["finalValue"].is_null()
            }) && items.iter().any(|item| {
                item["targetId"] == "task1"
                    && item["targetType"] == "writing"
                    && item["revisionCount"] == 0
                    && item["answered"] == true
                    && item["finalValue"] == "essay only"
            })
        })
        .unwrap_or(false));

    let detail_answered = app
        .clone()
        .oneshot(
            auth.with_auth(Request::builder().uri(format!(
                "/api/v1/answer-history/submissions/{}/targets/q1?targetType=objective",
                submission_id
            )))
            .body(Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(detail_answered.status(), StatusCode::OK);
    let detail_answered_json = json_body(detail_answered).await;
    assert_eq!(detail_answered_json["data"]["finalState"], "submitted-only");
    assert_eq!(detail_answered_json["data"]["checkpoints"], json!([]));
    assert_eq!(detail_answered_json["data"]["technicalLogs"], json!([]));

    let detail_unanswered = app
        .clone()
        .oneshot(
            auth.with_auth(Request::builder().uri(format!(
                "/api/v1/answer-history/submissions/{}/targets/q2?targetType=objective",
                submission_id
            )))
            .body(Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(detail_unanswered.status(), StatusCode::OK);
    let detail_unanswered_json = json_body(detail_unanswered).await;
    assert!(detail_unanswered_json["data"]["finalState"].is_null());
    assert_eq!(detail_unanswered_json["data"]["checkpoints"], json!([]));
    assert_eq!(detail_unanswered_json["data"]["technicalLogs"], json!([]));

    database.shutdown().await;
}

#[tokio::test]
async fn unassigned_grader_cannot_read_answer_history() {
    let database = mysql::TestDatabase::new(ANSWER_HISTORY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();
    let attempt_id = bootstrap_and_submit(
        database.pool(),
        schedule_id,
        "bob",
        json!({ "q2": "x" }),
        json!({ "task1": "x" }),
    )
    .await;
    let submission_id = submission_id_for_attempt(database.pool(), attempt_id).await;

    let auth = create_authenticated_user(
        database.pool(),
        UserRole::Grader,
        "grader@example.com",
        "Grader",
    )
    .await;

    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));

    let response = app
        .oneshot(
            auth.with_auth(Request::builder().uri(format!(
                "/api/v1/answer-history/submissions/{}/overview",
                submission_id
            )))
            .body(Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);

    database.shutdown().await;
}

#[tokio::test]
async fn assigned_proctor_can_read_attempt_overview() {
    let database = mysql::TestDatabase::new(ANSWER_HISTORY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();
    let attempt_id = bootstrap_and_submit(
        database.pool(),
        schedule_id,
        "charlie",
        json!({ "q3": "x" }),
        json!({ "task1": "x" }),
    )
    .await;

    let auth = create_authenticated_user(
        database.pool(),
        UserRole::Proctor,
        "proctor@example.com",
        "Proctor",
    )
    .await;
    assign_staff_to_schedule(database.pool(), schedule_id, auth.user_id, "proctor").await;

    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));

    let response = app
        .oneshot(
            auth.with_auth(Request::builder().uri(format!(
                "/api/v1/answer-history/attempts/{}/overview",
                attempt_id
            )))
            .body(Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    database.shutdown().await;
}

#[tokio::test]
async fn assigned_proctor_can_read_in_progress_attempt_overview_without_submission() {
    let database = mysql::TestDatabase::new(ANSWER_HISTORY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();
    let attempt_id = bootstrap_attempt_only(database.pool(), schedule_id, "charlie-live").await;

    insert_mutation(
        database.pool(),
        schedule_id,
        attempt_id,
        "SetScalar",
        1,
        json!({ "questionId": "q1", "value": "live-answer", "module": "reading" }),
        Utc.with_ymd_and_hms(2026, 1, 10, 9, 10, 0).unwrap(),
    )
    .await;

    let auth = create_authenticated_user(
        database.pool(),
        UserRole::Proctor,
        "proctor-live@example.com",
        "Proctor Live",
    )
    .await;
    assign_staff_to_schedule(database.pool(), schedule_id, auth.user_id, "proctor").await;

    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));

    let response = app
        .oneshot(
            auth.with_auth(Request::builder().uri(format!(
                "/api/v1/answer-history/attempts/{}/overview",
                attempt_id
            )))
            .body(Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    let overview = json_body(response).await;
    assert_eq!(overview["data"]["attemptId"], attempt_id.to_string());
    assert!(overview["data"]["submissionId"].is_null());

    database.shutdown().await;
}

#[tokio::test]
async fn assigned_proctor_can_read_in_progress_attempt_target_detail_without_submission() {
    let database = mysql::TestDatabase::new(ANSWER_HISTORY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();
    let attempt_id =
        bootstrap_attempt_only(database.pool(), schedule_id, "charlie-live-detail").await;

    insert_mutation(
        database.pool(),
        schedule_id,
        attempt_id,
        "SetScalar",
        1,
        json!({ "questionId": "q1", "value": "first", "module": "reading" }),
        Utc.with_ymd_and_hms(2026, 1, 10, 9, 10, 0).unwrap(),
    )
    .await;
    insert_mutation(
        database.pool(),
        schedule_id,
        attempt_id,
        "SetScalar",
        2,
        json!({ "questionId": "q1", "value": "second", "module": "reading" }),
        Utc.with_ymd_and_hms(2026, 1, 10, 9, 12, 0).unwrap(),
    )
    .await;

    let auth = create_authenticated_user(
        database.pool(),
        UserRole::Proctor,
        "proctor-live-detail@example.com",
        "Proctor Live Detail",
    )
    .await;
    assign_staff_to_schedule(database.pool(), schedule_id, auth.user_id, "proctor").await;

    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));

    let response = app
        .oneshot(
            auth.with_auth(Request::builder().uri(format!(
                "/api/v1/answer-history/attempts/{}/targets/q1?targetType=objective",
                attempt_id
            )))
            .body(Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    let detail = json_body(response).await;
    assert_eq!(detail["data"]["attemptId"], attempt_id.to_string());
    assert!(detail["data"]["submissionId"].is_null());
    assert_eq!(
        detail["data"]["checkpoints"]
            .as_array()
            .map(|items| items.len()),
        Some(2)
    );

    database.shutdown().await;
}

#[tokio::test]
async fn assigned_grader_can_read_submission_overview() {
    let database = mysql::TestDatabase::new(ANSWER_HISTORY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();
    let attempt_id = bootstrap_and_submit(
        database.pool(),
        schedule_id,
        "grader-ok",
        json!({ "q1": "x" }),
        json!({ "task1": "x" }),
    )
    .await;
    let submission_id = submission_id_for_attempt(database.pool(), attempt_id).await;

    let auth = create_authenticated_user(
        database.pool(),
        UserRole::Grader,
        "grader-ok@example.com",
        "Grader Ok",
    )
    .await;
    assign_staff_to_schedule(database.pool(), schedule_id, auth.user_id, "grader").await;

    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));

    let response = app
        .oneshot(
            auth.with_auth(Request::builder().uri(format!(
                "/api/v1/answer-history/submissions/{}/overview",
                submission_id
            )))
            .body(Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    database.shutdown().await;
}

#[tokio::test]
async fn unassigned_proctor_cannot_read_attempt_overview() {
    let database = mysql::TestDatabase::new(ANSWER_HISTORY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();
    let attempt_id = bootstrap_and_submit(
        database.pool(),
        schedule_id,
        "proctor-no",
        json!({ "q1": "x" }),
        json!({ "task1": "x" }),
    )
    .await;

    let auth = create_authenticated_user(
        database.pool(),
        UserRole::Proctor,
        "proctor-no@example.com",
        "Proctor No",
    )
    .await;

    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));

    let response = app
        .oneshot(
            auth.with_auth(Request::builder().uri(format!(
                "/api/v1/answer-history/attempts/{}/overview",
                attempt_id
            )))
            .body(Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);

    database.shutdown().await;
}

#[tokio::test]
async fn detail_checkpoints_are_ordered_deterministically() {
    let database = mysql::TestDatabase::new(ANSWER_HISTORY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();
    let attempt_id = bootstrap_and_submit(
        database.pool(),
        schedule_id,
        "ordered",
        json!({ "q1": "" }),
        json!({ "task1": "" }),
    )
    .await;
    let submission_id = submission_id_for_attempt(database.pool(), attempt_id).await;

    let at = Utc.with_ymd_and_hms(2026, 1, 10, 9, 20, 0).unwrap();
    insert_mutation(
        database.pool(),
        schedule_id,
        attempt_id,
        "SetScalar",
        2,
        json!({ "questionId": "q1", "value": "second", "module": "reading" }),
        at,
    )
    .await;
    insert_mutation(
        database.pool(),
        schedule_id,
        attempt_id,
        "SetScalar",
        1,
        json!({ "questionId": "q1", "value": "first", "module": "reading" }),
        at,
    )
    .await;
    insert_mutation(
        database.pool(),
        schedule_id,
        attempt_id,
        "SetScalar",
        3,
        json!({ "questionId": "q1", "value": "third", "module": "reading" }),
        at,
    )
    .await;

    let auth = create_authenticated_user(
        database.pool(),
        UserRole::Admin,
        "admin-ordered@example.com",
        "Admin Ordered",
    )
    .await;
    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));

    let detail = app
        .oneshot(
            auth.with_auth(Request::builder().uri(format!(
                "/api/v1/answer-history/submissions/{}/targets/q1?targetType=objective",
                submission_id
            )))
            .body(Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(detail.status(), StatusCode::OK);
    let detail_json = json_body(detail).await;
    let seqs = detail_json["data"]["checkpoints"]
        .as_array()
        .unwrap()
        .iter()
        .map(|item| item["mutationSeq"].as_i64().unwrap())
        .collect::<Vec<_>>();
    assert_eq!(seqs, vec![1, 2, 3]);

    database.shutdown().await;
}

#[tokio::test]
async fn export_json_contains_detail_shape() {
    let database = mysql::TestDatabase::new(ANSWER_HISTORY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();
    let attempt_id = bootstrap_and_submit(
        database.pool(),
        schedule_id,
        "export-json",
        json!({ "q1": "seed" }),
        json!({ "task1": "seed" }),
    )
    .await;
    let submission_id = submission_id_for_attempt(database.pool(), attempt_id).await;

    insert_mutation(
        database.pool(),
        schedule_id,
        attempt_id,
        "SetScalar",
        1,
        json!({ "questionId": "q1", "value": "policy", "module": "reading" }),
        Utc.with_ymd_and_hms(2026, 1, 10, 9, 40, 0).unwrap(),
    )
    .await;

    let auth = create_authenticated_user(
        database.pool(),
        UserRole::Admin,
        "admin-export@example.com",
        "Admin Export",
    )
    .await;
    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));

    let export = app
        .oneshot(
            auth.with_auth(
                Request::builder().uri(format!(
                    "/api/v1/answer-history/submissions/{}/export?targetType=objective&targetId=q1&format=json",
                    submission_id
                )),
            )
            .body(Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(export.status(), StatusCode::OK);
    let export_json = json_body(export).await;
    let content = export_json["data"]["content"].as_str().unwrap_or("");
    let parsed: serde_json::Value = serde_json::from_str(content).unwrap();
    assert_eq!(parsed["targetId"], "q1");
    assert!(parsed["checkpoints"].is_array());
    assert!(parsed["technicalLogs"].is_array());

    database.shutdown().await;
}

async fn insert_mutation(
    pool: &sqlx::MySqlPool,
    schedule_id: Uuid,
    attempt_id: Uuid,
    mutation_type: &str,
    seq: i64,
    payload: serde_json::Value,
    at: chrono::DateTime<Utc>,
) {
    sqlx::query(
        r#"
        INSERT INTO student_attempt_mutations (
            id,
            attempt_id,
            schedule_id,
            client_session_id,
            mutation_type,
            client_mutation_id,
            mutation_seq,
            payload,
            client_timestamp,
            server_received_at,
            applied_revision,
            applied_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        "#,
    )
    .bind(Uuid::new_v4().to_string())
    .bind(attempt_id.to_string())
    .bind(schedule_id.to_string())
    .bind(Uuid::new_v4().to_string())
    .bind(mutation_type)
    .bind(format!("mutation-{seq}"))
    .bind(seq)
    .bind(payload)
    .bind(at)
    .bind(at)
    .bind(Some(seq as i32))
    .bind(Some(at))
    .execute(pool)
    .await
    .unwrap();
}

async fn submission_id_for_attempt(pool: &sqlx::MySqlPool, attempt_id: Uuid) -> Uuid {
    let id: String = sqlx::query_scalar("SELECT id FROM student_submissions WHERE attempt_id = ?")
        .bind(attempt_id.to_string())
        .fetch_one(pool)
        .await
        .unwrap();
    Uuid::parse_str(&id).unwrap()
}

async fn bootstrap_attempt_only(
    pool: &sqlx::MySqlPool,
    schedule_id: Uuid,
    candidate_id: &str,
) -> Uuid {
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
    Uuid::parse_str(&attempt_id).unwrap()
}

async fn bootstrap_and_submit(
    pool: &sqlx::MySqlPool,
    schedule_id: Uuid,
    candidate_id: &str,
    answers: serde_json::Value,
    writing_answers: serde_json::Value,
) -> Uuid {
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
                answers: Some(answers),
                writing_answers: Some(writing_answers),
                flags: Some(json!({})),
                last_seen_revision: Some(0),
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

    Uuid::parse_str(&attempt_id).unwrap()
}

async fn seed_schedule(pool: &sqlx::MySqlPool) -> ielts_backend_domain::schedule::ExamSchedule {
    let actor = contract_actor();
    let builder = BuilderService::new(pool.clone());
    let exam = builder
        .create_exam(
            &actor,
            CreateExamRequest {
                slug: "answer-history-contract".to_owned(),
                title: "Answer History Contract".to_owned(),
                exam_type: ExamType::Academic.as_str().to_owned(),
                visibility: Visibility::Organization.as_str().to_owned(),
                organization_id: Some("org-1".to_owned()),
            },
        )
        .await
        .unwrap();

    builder
        .save_draft(
            &actor,
            exam.id.clone(),
            SaveDraftRequest {
                content_snapshot: json!({
                    "reading": {"questions": [{"id": "q1"}, {"id": "q2"}]},
                    "writing": {"tasks": [{"id": "task1"}]}
                }),
                config_snapshot: sample_delivery_config(),
                revision: exam.revision,
            },
        )
        .await
        .unwrap();

    let refreshed = builder.get_exam(&actor, exam.id.clone()).await.unwrap();
    let version = builder
        .publish_exam(
            &actor,
            exam.id.clone(),
            PublishExamRequest {
                publish_notes: Some("ready".to_owned()),
                revision: refreshed.revision,
            },
        )
        .await
        .unwrap();

    SchedulingService::new(pool.clone())
        .create_schedule(
            &actor,
            CreateScheduleRequest {
                exam_id: exam.id,
                published_version_id: version.id,
                cohort_name: "AH Cohort".to_owned(),
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
        .unwrap()
}

fn sample_delivery_config() -> serde_json::Value {
    json!({
        "sections": {
            "listening": {"enabled": true, "label": "Listening", "order": 1, "duration": 30, "gapAfterMinutes": 5},
            "reading": {"enabled": true, "label": "Reading", "order": 2, "duration": 60, "gapAfterMinutes": 0},
            "writing": {"enabled": true, "label": "Writing", "order": 3, "duration": 60, "gapAfterMinutes": 10}
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
