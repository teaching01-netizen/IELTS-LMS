#[path = "../support/mysql.rs"]
mod mysql;

use std::collections::HashSet;

use axum::{
    body::{to_bytes, Body},
    http::{Request, StatusCode},
};
use chrono::{Duration, TimeZone, Utc};
use serde_json::json;
use tower::ServiceExt;
use uuid::Uuid;

use ielts_backend_api::{router::build_router, state::AppState};
use ielts_backend_application::{builder::BuilderService, scheduling::SchedulingService};
use ielts_backend_domain::{
    auth::UserRole,
    exam::{CreateExamRequest, ExamType, PublishExamRequest, SaveDraftRequest, Visibility},
    schedule::CreateScheduleRequest,
};
use ielts_backend_infrastructure::{
    actor_context::{ActorContext, ActorRole},
    config::AppConfig,
};

const SCHEDULING_MIGRATIONS: &[&str] = &[
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
    "0020_schedule_role_display_names.sql",
];

#[tokio::test]
async fn list_schedules_returns_seeded_rows() {
    let database = mysql::TestDatabase::new(SCHEDULING_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let auth = mysql::create_authenticated_user(
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

    let response = app
        .oneshot(
            auth.with_auth(Request::builder().uri("/api/v1/schedules"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let schedules = json["data"].as_array().expect("schedule list");

    assert_eq!(json["success"], true);
    assert_eq!(schedules.len(), 1);
    assert_eq!(schedules[0]["id"], schedule.id.to_string());
    assert_eq!(schedules[0]["status"], "scheduled");

    database.shutdown().await;
}

#[tokio::test]
async fn get_schedule_returns_detail_by_id() {
    let database = mysql::TestDatabase::new(SCHEDULING_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let auth = mysql::create_authenticated_user(
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

    let response = app
        .oneshot(
            auth.with_auth(Request::builder().uri(format!("/api/v1/schedules/{}", schedule.id)))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();

    assert_eq!(json["success"], true);
    assert_eq!(json["data"]["id"], schedule.id.to_string());
    assert_eq!(json["data"]["plannedDurationMinutes"], 180);
    assert_eq!(json["data"]["deliveryMode"], "proctor_start");

    database.shutdown().await;
}

#[tokio::test]
async fn get_runtime_returns_a_not_started_projection_before_commands_run() {
    let database = mysql::TestDatabase::new(SCHEDULING_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let auth = mysql::create_authenticated_user(
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

    let response = app
        .oneshot(
            auth.with_auth(
                Request::builder().uri(format!("/api/v1/schedules/{}/runtime", schedule.id)),
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
    assert_eq!(json["data"]["status"], "not_started");
    assert_eq!(json["data"]["sections"][0]["sectionKey"], "listening");
    assert_eq!(json["data"]["sections"][0]["status"], "locked");

    database.shutdown().await;
}

#[tokio::test]
async fn runtime_commands_transition_the_runtime_state_machine() {
    let database = mysql::TestDatabase::new(SCHEDULING_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();
    let auth = mysql::create_authenticated_user(
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

    let start = command_request(
        &app,
        &auth,
        schedule_id,
        json!({ "action": "start_runtime" }),
    )
    .await;
    assert_eq!(start.status(), StatusCode::OK);
    let start_json = json_body(start).await;
    assert_eq!(start_json["data"]["status"], "live");
    assert_eq!(start_json["data"]["revision"], 1);
    assert_eq!(start_json["data"]["activeSectionKey"], "listening");
    assert_eq!(start_json["data"]["sections"][0]["status"], "live");

    let pause = command_request(
        &app,
        &auth,
        schedule_id,
        json!({ "action": "pause_runtime", "reason": "manual_pause" }),
    )
    .await;
    assert_eq!(pause.status(), StatusCode::OK);
    let pause_json = json_body(pause).await;
    assert_eq!(pause_json["data"]["status"], "paused");
    assert_eq!(pause_json["data"]["sections"][0]["status"], "paused");

    let resume = command_request(
        &app,
        &auth,
        schedule_id,
        json!({ "action": "resume_runtime" }),
    )
    .await;
    assert_eq!(resume.status(), StatusCode::OK);
    let resume_json = json_body(resume).await;
    assert_eq!(resume_json["data"]["status"], "live");
    assert_eq!(resume_json["data"]["sections"][0]["status"], "live");

    let end = command_request(&app, &auth, schedule_id, json!({ "action": "end_runtime" })).await;
    assert_eq!(end.status(), StatusCode::OK);
    let end_json = json_body(end).await;
    assert_eq!(end_json["data"]["status"], "completed");
    assert_eq!(
        end_json["data"]["activeSectionKey"],
        serde_json::Value::Null
    );
    assert_eq!(end_json["data"]["sections"][0]["status"], "completed");

    database.shutdown().await;
}

#[tokio::test]
async fn get_runtime_counts_down_from_section_start_instead_of_persisted_start_duration() {
    let database = mysql::TestDatabase::new(SCHEDULING_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();
    let auth = mysql::create_authenticated_user(
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

    let start = command_request(
        &app,
        &auth,
        schedule_id,
        json!({ "action": "start_runtime" }),
    )
    .await;
    assert_eq!(start.status(), StatusCode::OK);

    sqlx::query(
        r#"
        UPDATE exam_session_runtime_sections
        SET actual_start_at = NOW() - INTERVAL 45 SECOND,
            available_at = NOW() - INTERVAL 45 SECOND
        WHERE runtime_id = (
            SELECT id FROM exam_session_runtimes WHERE schedule_id = ?
        )
          AND section_key = 'listening'
        "#,
    )
    .bind(schedule_id.to_string())
    .execute(database.pool())
    .await
    .expect("backdate active section start");

    let response = app
        .oneshot(
            auth.with_auth(
                Request::builder().uri(format!("/api/v1/schedules/{schedule_id}/runtime")),
            )
            .body(Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    let runtime = json_body(response).await;
    let remaining = runtime["data"]["currentSectionRemainingSeconds"]
        .as_i64()
        .expect("runtime remaining seconds");
    assert!(
        remaining <= 30 * 60 - 40,
        "remaining should count down from the active section start, got {remaining}"
    );
    assert!(
        remaining > 30 * 60 - 90,
        "remaining should not overcount elapsed time, got {remaining}"
    );
    let actual_start_at = sqlx::query_scalar::<_, chrono::DateTime<Utc>>(
        r#"
        SELECT actual_start_at
        FROM exam_session_runtime_sections
        WHERE runtime_id = (
            SELECT id FROM exam_session_runtimes WHERE schedule_id = ?
        )
          AND section_key = 'listening'
        "#,
    )
    .bind(schedule_id.to_string())
    .fetch_one(database.pool())
    .await
    .expect("active section start");
    let deadline = runtime["data"]["currentSectionDeadlineAt"]
        .as_str()
        .and_then(|value| value.parse::<chrono::DateTime<Utc>>().ok())
        .expect("stable section deadline");
    let expected_deadline = actual_start_at + Duration::minutes(30);
    assert!(
        (deadline - expected_deadline).num_seconds().abs() <= 1,
        "deadline should be anchored to section start, got {deadline} expected {expected_deadline}"
    );

    database.shutdown().await;
}

#[tokio::test]
async fn repeated_start_returns_conflict_without_duplicate_sections() {
    let database = mysql::TestDatabase::new(SCHEDULING_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();
    let auth = mysql::create_authenticated_user(
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

    // BEX-020: first start is live, with a current section, a deadline and
    // remaining seconds.
    let start = command_request(
        &app,
        &auth,
        schedule_id,
        json!({ "action": "start_runtime" }),
    )
    .await;
    assert_eq!(start.status(), StatusCode::OK);
    let start_json = json_body(start).await;
    assert_eq!(start_json["data"]["status"], "live");
    assert_eq!(start_json["data"]["revision"], 1);
    assert_eq!(start_json["data"]["activeSectionKey"], "listening");
    assert_eq!(start_json["data"]["sections"][0]["status"], "live");
    assert!(
        start_json["data"]["currentSectionRemainingSeconds"]
            .as_i64()
            .expect("remaining seconds")
            > 0
    );
    assert!(
        start_json["data"]["currentSectionDeadlineAt"].is_string(),
        "live runtime must expose a deadline right after start"
    );

    // BEX-020: a repeated start must be a clean 409 Conflict (duplicate-key
    // guard), never a 500, and must not create duplicate rows.
    let retry = command_request(
        &app,
        &auth,
        schedule_id,
        json!({ "action": "start_runtime" }),
    )
    .await;
    assert_eq!(retry.status(), StatusCode::CONFLICT);
    let retry_json = json_body(retry).await;
    assert_eq!(retry_json["error"]["code"], "CONFLICT");
    assert!(
        retry_json["error"]["message"]
            .as_str()
            .unwrap()
            .contains("Runtime already exists")
    );

    let runtime_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM exam_session_runtimes WHERE schedule_id = ?")
            .bind(schedule_id.to_string())
            .fetch_one(database.pool())
            .await
            .unwrap();
    assert_eq!(runtime_count, 1, "a repeated start must not insert a second runtime");

    let get_runtime = app
        .clone()
        .oneshot(
            auth.with_auth(
                Request::builder().uri(format!("/api/v1/schedules/{schedule_id}/runtime")),
            )
            .body(Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(get_runtime.status(), StatusCode::OK);
    let runtime_json = json_body(get_runtime).await;
    let sections = runtime_json["data"]["sections"].as_array().expect("sections");
    let section_rows: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM exam_session_runtime_sections WHERE runtime_id = (SELECT id FROM exam_session_runtimes WHERE schedule_id = ?)",
    )
    .bind(schedule_id.to_string())
    .fetch_one(database.pool())
    .await
    .unwrap();
    assert_eq!(
        section_rows, sections.len() as i64,
        "exactly one section row per plan entry"
    );
    let mut keys: Vec<&str> = sections
        .iter()
        .map(|section| section["sectionKey"].as_str().unwrap())
        .collect();
    keys.sort_unstable();
    let unique_keys: HashSet<&str> = keys.iter().copied().collect();
    assert_eq!(unique_keys.len(), keys.len(), "no duplicate section keys");

    database.shutdown().await;
}

#[tokio::test]
async fn pause_freezes_remaining_seconds_and_resume_accounts_for_paused_time() {
    let database = mysql::TestDatabase::new(SCHEDULING_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();
    let auth = mysql::create_authenticated_user(
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

    let start = command_request(
        &app,
        &auth,
        schedule_id,
        json!({ "action": "start_runtime" }),
    )
    .await;
    assert_eq!(start.status(), StatusCode::OK);
    let start_json = json_body(start).await;
    assert_eq!(start_json["data"]["status"], "live");
    let deadline_at_start = start_json["data"]["currentSectionDeadlineAt"]
        .as_str()
        .and_then(|value| value.parse::<chrono::DateTime<Utc>>().ok())
        .expect("live deadline at start");

    // BEX-021: pause freezes the effective deadline; while paused the deadline
    // is null by design and remaining seconds are anchored to paused_at.
    let pause = command_request(
        &app,
        &auth,
        schedule_id,
        json!({ "action": "pause_runtime" }),
    )
    .await;
    assert_eq!(pause.status(), StatusCode::OK);
    let pause_json = json_body(pause).await;
    assert_eq!(pause_json["data"]["status"], "paused");
    assert_eq!(pause_json["data"]["revision"], 2);
    assert_eq!(pause_json["data"]["sections"][0]["status"], "paused");
    assert_eq!(
        pause_json["data"]["currentSectionDeadlineAt"],
        serde_json::Value::Null,
        "no live deadline while paused"
    );
    let frozen_remaining = pause_json["data"]["currentSectionRemainingSeconds"]
        .as_i64()
        .expect("frozen remaining");
    let paused_at = pause_json["data"]["sections"][0]["pausedAt"]
        .as_str()
        .unwrap()
        .to_owned();

    // BEX-021: repeated pause is idempotent — identical projection, no revision
    // bump, no second PauseRuntime control event.
    let again = command_request(
        &app,
        &auth,
        schedule_id,
        json!({ "action": "pause_runtime", "reason": "second_pause" }),
    )
    .await;
    assert_eq!(again.status(), StatusCode::OK);
    let again_json = json_body(again).await;
    assert_eq!(again_json["data"]["status"], "paused");
    assert_eq!(again_json["data"]["revision"], 2, "no-op pause must not bump revision");
    assert_eq!(
        again_json["data"]["currentSectionRemainingSeconds"],
        serde_json::json!(frozen_remaining),
        "no-op pause must return the same frozen remaining seconds"
    );
    assert_eq!(
        again_json["data"]["sections"][0]["pausedAt"],
        serde_json::json!(paused_at),
        "no-op pause must return the same paused_at"
    );
    let pause_events: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM cohort_control_events WHERE schedule_id = ? AND action = 'pause_runtime'",
    )
    .bind(schedule_id.to_string())
    .fetch_one(database.pool())
    .await
    .unwrap();
    assert_eq!(pause_events, 1, "the no-op pause must not append a second event");

    // Simulate 5 minutes of wall-clock time while paused: remaining seconds must
    // NOT drop by 300 (they froze at the pause moment).
    sqlx::query(
        r#"
        UPDATE exam_session_runtime_sections
        SET paused_at = NOW() - INTERVAL 5 MINUTE
        WHERE runtime_id = (SELECT id FROM exam_session_runtimes WHERE schedule_id = ?)
          AND section_key = 'listening'
        "#,
    )
    .bind(schedule_id.to_string())
    .execute(database.pool())
    .await
    .expect("backdate active section pause");

    let paused_view = app
        .clone()
        .oneshot(
            auth.with_auth(
                Request::builder().uri(format!("/api/v1/schedules/{schedule_id}/runtime")),
            )
            .body(Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(paused_view.status(), StatusCode::OK);
    let paused_view_json = json_body(paused_view).await;
    assert_eq!(paused_view_json["data"]["status"], "paused");
    assert_eq!(
        paused_view_json["data"]["currentSectionDeadlineAt"],
        serde_json::Value::Null,
        "still no live deadline while paused"
    );
    let remaining_while_paused = paused_view_json["data"]["currentSectionRemainingSeconds"]
        .as_i64()
        .expect("remaining while paused");
    assert!(
        remaining_while_paused > 30 * 60 - 300,
        "paused remaining must not drop by the paused duration, got {remaining_while_paused}"
    );

    // BEX-021: resume accounts for the accumulated paused time.
    let resume = command_request(
        &app,
        &auth,
        schedule_id,
        json!({ "action": "resume_runtime" }),
    )
    .await;
    assert_eq!(resume.status(), StatusCode::OK);
    let resume_json = json_body(resume).await;
    assert_eq!(resume_json["data"]["status"], "live");
    let remaining_after_resume = resume_json["data"]["currentSectionRemainingSeconds"]
        .as_i64()
        .expect("remaining after resume");
    assert!(
        remaining_after_resume > 30 * 60 - 60,
        "resume must not forfeit the paused time, got {remaining_after_resume}"
    );
    assert!(
        (remaining_after_resume - remaining_while_paused).abs() <= 5,
        "remaining after resume should match the frozen value, got {remaining_after_resume}"
    );

    let (accumulated_seconds, total_paused_seconds): (i32, i32) = sqlx::query_as(
        r#"
        SELECT s.accumulated_paused_seconds, r.total_paused_seconds
        FROM exam_session_runtime_sections s
        JOIN exam_session_runtimes r ON r.id = s.runtime_id
        WHERE r.schedule_id = ? AND s.section_key = 'listening'
        "#,
    )
    .bind(schedule_id.to_string())
    .fetch_one(database.pool())
    .await
    .expect("paused accumulators");
    assert!(
        accumulated_seconds >= 295,
        "section must accumulate the paused time, got {accumulated_seconds}"
    );
    assert!(
        total_paused_seconds >= 295,
        "runtime must accumulate the paused time, got {total_paused_seconds}"
    );

    let deadline_after_resume = resume_json["data"]["currentSectionDeadlineAt"]
        .as_str()
        .and_then(|value| value.parse::<chrono::DateTime<Utc>>().ok())
        .expect("live deadline after resume");
    let extension_seconds = (deadline_after_resume - deadline_at_start).num_seconds();
    assert!(
        (295..=305).contains(&extension_seconds),
        "deadline should extend by the paused duration, got {extension_seconds}s"
    );
    let expected_deadline = {
        let actual_start_at = sqlx::query_scalar::<_, chrono::DateTime<Utc>>(
            r#"
            SELECT actual_start_at
            FROM exam_session_runtime_sections
            WHERE runtime_id = (SELECT id FROM exam_session_runtimes WHERE schedule_id = ?)
              AND section_key = 'listening'
            "#,
        )
        .bind(schedule_id.to_string())
        .fetch_one(database.pool())
        .await
        .expect("active section start");
        actual_start_at + Duration::minutes(30) + Duration::seconds(i64::from(accumulated_seconds))
    };
    assert!(
        (deadline_after_resume - expected_deadline).num_seconds().abs() <= 2,
        "deadline should match actual start + duration + accumulated pause"
    );

    // Pausing a completed runtime still conflicts (only repeat-pause is idempotent).
    let end = command_request(&app, &auth, schedule_id, json!({ "action": "end_runtime" })).await;
    assert_eq!(end.status(), StatusCode::OK);
    let pause_after_end = command_request(
        &app,
        &auth,
        schedule_id,
        json!({ "action": "pause_runtime" }),
    )
    .await;
    assert_eq!(pause_after_end.status(), StatusCode::CONFLICT);
    let pause_after_end_json = json_body(pause_after_end).await;
    assert_eq!(pause_after_end_json["error"]["code"], "CONFLICT");

    database.shutdown().await;
}

#[tokio::test]
async fn delete_schedule_removes_the_schedule_and_runtime() {
    let database = mysql::TestDatabase::new(SCHEDULING_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();
    let auth = mysql::create_authenticated_user(
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

    let start = command_request(
        &app,
        &auth,
        schedule_id,
        json!({ "action": "start_runtime" }),
    )
    .await;
    assert_eq!(start.status(), StatusCode::OK);

    let delete_response = app
        .clone()
        .oneshot(
            auth.with_csrf(Request::builder())
                .method("DELETE")
                .uri(format!("/api/v1/schedules/{}", schedule_id))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(delete_response.status(), StatusCode::NO_CONTENT);

    let get_schedule = app
        .clone()
        .oneshot(
            auth.with_auth(Request::builder().uri(format!("/api/v1/schedules/{}", schedule.id)))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(get_schedule.status(), StatusCode::NOT_FOUND);

    let runtime =
        sqlx::query_scalar::<_, Uuid>("SELECT id FROM exam_session_runtimes WHERE schedule_id = ?")
            .bind(schedule_id)
            .fetch_optional(database.pool())
            .await
            .expect("runtime lookup");
    assert_eq!(runtime, None);

    database.shutdown().await;
}

async fn seed_schedule(pool: &sqlx::MySqlPool) -> ielts_backend_domain::schedule::ExamSchedule {
    let actor = contract_actor();
    let builder_service = BuilderService::new(pool.clone());
    let exam = builder_service
        .create_exam(
            &actor,
            CreateExamRequest {
                slug: "cambridge-19-academic-schedule".to_owned(),
                title: "Cambridge 19 Academic Schedule".to_owned(),
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
                    "reading": {"passages": [{"id": "reading-1", "title": "Reading Passage 1", "blocks": [{"type": "TFNG", "mode": "TFNG", "questions": [{"id": "r1", "statement": "Statement 1", "correctAnswer": "T"}]}]}]},
                    "listening": {"parts": [{"id": "listening-1", "title": "Listening Part 1", "blocks": [{"type": "TFNG", "mode": "TFNG", "questions": [{"id": "q1", "statement": "Statement 1", "correctAnswer": "T"}]}]}]},
                    "writing": {"task1Prompt": "Summarise the chart.", "task2Prompt": "Discuss both views.", "tasks": [{"id": "writing-1"}]},
                    "speaking": {"part1Topics": ["topic"], "cueCard": "cue", "part3Discussion": ["discussion"]}
                }),
                config_snapshot: sample_schedule_config(),
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
                publish_notes: Some("ready for scheduling".to_owned()),
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
                cohort_name: "Bangkok Morning Cohort".to_owned(),
                proctor_display_name: exam.title.clone(),
                grading_display_name: exam.title.clone(),
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

fn sample_schedule_config() -> serde_json::Value {
    json!({
        "progression": {"allowPause": true},
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
            "writing": {
                "enabled": true,
                "label": "Writing",
                "order": 3,
                "duration": 60,
                "gapAfterMinutes": 10
            },
            "speaking": {
                "enabled": true,
                "label": "Speaking",
                "order": 4,
                "duration": 15,
                "gapAfterMinutes": 0
            }
        }
    })
}

async fn command_request(
    app: &axum::Router,
    auth: &mysql::TestAuthContext,
    schedule_id: Uuid,
    payload: serde_json::Value,
) -> axum::response::Response {
    app.clone()
        .oneshot(
            auth.with_csrf(Request::builder())
                .method("POST")
                .uri(format!("/api/v1/schedules/{schedule_id}/runtime/commands"))
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_vec(&payload).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap()
}

async fn json_body(response: axum::response::Response) -> serde_json::Value {
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    serde_json::from_slice(&body).unwrap()
}

fn contract_actor() -> ActorContext {
    ActorContext::new(Uuid::new_v4().to_string(), ActorRole::Admin)
}
