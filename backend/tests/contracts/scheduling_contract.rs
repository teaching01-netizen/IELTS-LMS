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
    attempt::StudentPrecheckRequest,
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

#[tokio::test]
async fn proctor_end_section_now_completes_active_section_and_exposes_the_next() {
    let database = mysql::TestDatabase::new(SCHEDULING_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();
    let admin = mysql::create_authenticated_user(
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

    let start = command_request(&app, &admin, schedule_id, json!({ "action": "start_runtime" })).await;
    assert_eq!(start.status(), StatusCode::OK);
    let start_json = json_body(start).await;
    assert_eq!(start_json["data"]["activeSectionKey"], "listening");
    assert_eq!(start_json["data"]["sections"][0]["status"], "live");

    // BEX-022: the proctor advance endpoint completes the active section and
    // exposes the next Locked section, one step in plan order.
    let advance = proctor_end_section_now(
        &app,
        &admin,
        schedule_id,
        json!({
            "expectedActiveSectionKey": "listening",
            "reason": "proctor moved the cohort to reading"
        }),
    )
    .await;
    assert_eq!(advance.status(), StatusCode::OK);
    let runtime = json_body(advance).await;
    let data = &runtime["data"];
    assert_eq!(data["status"], "live");
    assert_eq!(data["activeSectionKey"], "reading");
    assert_eq!(data["currentSectionKey"], "reading");
    assert_eq!(data["revision"], 2, "an advance must bump the runtime revision");
    let remaining = data["currentSectionRemainingSeconds"]
        .as_i64()
        .expect("remaining seconds");
    assert!(
        (3540..=3600).contains(&remaining),
        "reading starts with its planned 60 minutes, got {remaining}"
    );
    let persisted_remaining: i32 = sqlx::query_scalar(
        "SELECT current_section_remaining_seconds FROM exam_session_runtimes WHERE schedule_id = ?",
    )
    .bind(schedule_id.to_string())
    .fetch_one(database.pool())
    .await
    .expect("persisted remaining seconds");
    assert_eq!(persisted_remaining, 60 * 60);
    let sections = data["sections"].as_array().expect("sections");
    assert_eq!(sections[0]["sectionKey"], "listening");
    assert_eq!(sections[0]["status"], "completed");
    assert!(
        sections[0]["actualEndAt"].is_string(),
        "completed section must carry an actual end time"
    );
    assert_eq!(sections[0]["completionReason"], "proctor_end");
    assert_eq!(sections[1]["sectionKey"], "reading");
    assert_eq!(sections[1]["status"], "live");
    assert!(
        sections[1]["availableAt"].is_string(),
        "newly exposed section must be available"
    );
    assert!(
        sections[1]["actualStartAt"].is_string(),
        "newly exposed section must record its actual start"
    );

    // Append-only trail: exactly one control event and SECTION_END + SECTION_START
    // audits, all attributed to the admin actor.
    let (event_actor, event_section): (String, Option<String>) = sqlx::query_as(
        "SELECT actor_id, section_key FROM cohort_control_events WHERE schedule_id = ? AND action = 'end_section_now'",
    )
    .bind(schedule_id.to_string())
    .fetch_one(database.pool())
    .await
    .expect("end_section_now control event");
    assert_eq!(event_actor, admin.user_id.to_string());
    assert_eq!(event_section.as_deref(), Some("listening"));

    let mut audit_actions: Vec<String> = sqlx::query_scalar(
        "SELECT action_type FROM session_audit_logs WHERE schedule_id = ?",
    )
    .bind(schedule_id.to_string())
    .fetch_all(database.pool())
    .await
    .expect("audit trail");
    audit_actions.sort_unstable();
    assert_eq!(audit_actions, vec!["SECTION_END", "SECTION_START"]);

    let ended_at: Option<chrono::DateTime<Utc>> = sqlx::query_scalar(
        "SELECT actual_end_at FROM exam_session_runtime_sections WHERE runtime_id = (SELECT id FROM exam_session_runtimes WHERE schedule_id = ?) AND section_key = 'listening'",
    )
    .bind(schedule_id.to_string())
    .fetch_one(database.pool())
    .await
    .expect("listening actual end");
    assert!(ended_at.is_some(), "listening must persist an actual end time");

    database.shutdown().await;
}

#[tokio::test]
async fn proctor_end_section_now_steps_sections_in_plan_order_without_skipping() {
    let database = mysql::TestDatabase::new(SCHEDULING_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();
    let admin = mysql::create_authenticated_user(
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

    let start = command_request(&app, &admin, schedule_id, json!({ "action": "start_runtime" })).await;
    assert_eq!(start.status(), StatusCode::OK);

    // First advance: listening -> reading.
    let first = proctor_end_section_now(&app, &admin, schedule_id, json!({ "reason": "step 1" })).await;
    assert_eq!(first.status(), StatusCode::OK);
    assert_eq!(json_body(first).await["data"]["activeSectionKey"], "reading");

    // BEX-022: a stale expected_active_section_key on the second advance must
    // conflict instead of silently advancing from a stale client view.
    let stale = proctor_end_section_now(
        &app,
        &admin,
        schedule_id,
        json!({ "expectedActiveSectionKey": "listening", "reason": "stale" }),
    )
    .await;
    assert_eq!(stale.status(), StatusCode::CONFLICT);
    let stale_json = json_body(stale).await;
    assert_eq!(stale_json["error"]["code"], "CONFLICT");
    assert!(
        stale_json["error"]["message"]
            .as_str()
            .unwrap()
            .contains("Runtime advanced; refresh before retrying."),
        "stale advance error: {stale_json}"
    );

    // Second advance: reading -> writing (must NOT skip to speaking).
    let second = proctor_end_section_now(&app, &admin, schedule_id, json!({ "reason": "step 2" })).await;
    assert_eq!(second.status(), StatusCode::OK);
    let second_json = json_body(second).await;
    assert_eq!(second_json["data"]["activeSectionKey"], "writing");
    assert_eq!(
        second_json["data"]["sections"][1]["status"], "completed",
        "reading must be completed by the second advance"
    );
    assert_eq!(
        second_json["data"]["sections"][2]["status"], "live",
        "writing is the next exposed section, not speaking"
    );
    assert_eq!(second_json["data"]["sections"][3]["status"], "locked");

    // Third advance: writing -> speaking.
    let third = proctor_end_section_now(&app, &admin, schedule_id, json!({ "reason": "step 3" })).await;
    assert_eq!(third.status(), StatusCode::OK);
    let third_json = json_body(third).await;
    assert_eq!(third_json["data"]["activeSectionKey"], "speaking");
    assert_eq!(third_json["data"]["revision"], 4);

    let advance_events: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM cohort_control_events WHERE schedule_id = ? AND action = 'end_section_now'",
    )
    .bind(schedule_id.to_string())
    .fetch_one(database.pool())
    .await
    .unwrap();
    assert_eq!(advance_events, 3, "exactly one control event per advance");

    database.shutdown().await;
}

#[tokio::test]
async fn proctor_end_section_now_on_last_section_auto_submits_pending_attempts() {
    let database = mysql::TestDatabase::new(SCHEDULING_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();
    let admin = mysql::create_authenticated_user(
        database.pool(),
        UserRole::Admin,
        "admin@example.com",
        "Admin",
    )
    .await;
    let student_auth = mysql::create_authenticated_user(
        database.pool(),
        UserRole::Student,
        "alice@example.com",
        "Alice Candidate",
    )
    .await;
    let student_key = mysql::create_student_registration(
        database.pool(),
        schedule_id,
        student_auth.user_id,
        "alice",
        "Alice Candidate",
        "alice@example.com",
    )
    .await;
    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));
    // A real precheck creates the pending student attempt row.
    precheck_attempt(&app, &student_auth, schedule_id, &student_key).await;

    let start = command_request(&app, &admin, schedule_id, json!({ "action": "start_runtime" })).await;
    assert_eq!(start.status(), StatusCode::OK);

    // BEX-023: the final advance structurally completes the runtime and
    // auto-submits every pending attempt in the same transaction.
    for (step, section) in ["listening", "reading", "writing", "speaking"].iter().enumerate() {
        let advance = proctor_end_section_now(
            &app,
            &admin,
            schedule_id,
            json!({ "expectedActiveSectionKey": section, "reason": format!("final step {step}") }),
        )
        .await;
        assert_eq!(advance.status(), StatusCode::OK, "advance out of {section}");
    }

    let runtime = admin_runtime_projection(&app, &admin, schedule_id).await;
    let data = &runtime["data"];
    assert_eq!(data["status"], "completed");
    assert!(data["actualEndAt"].is_string(), "completed runtime needs an end time");
    assert_eq!(data["activeSectionKey"], serde_json::Value::Null);
    assert_eq!(data["currentSectionKey"], serde_json::Value::Null);
    assert_eq!(data["currentSectionRemainingSeconds"], 0);
    assert_eq!(data["waitingForNextSection"], false);
    for section in data["sections"].as_array().expect("sections") {
        assert_eq!(section["status"], "completed", "all sections must be completed");
    }

    let (runtime_status, actual_end_at, active_key, current_key, remaining, waiting): (
        String,
        Option<chrono::DateTime<Utc>>,
        Option<String>,
        Option<String>,
        i32,
        bool,
    ) = sqlx::query_as(
        "SELECT status, actual_end_at, active_section_key, current_section_key, current_section_remaining_seconds, waiting_for_next_section FROM exam_session_runtimes WHERE schedule_id = ?",
    )
    .bind(schedule_id.to_string())
    .fetch_one(database.pool())
    .await
    .expect("runtime row");
    assert_eq!(runtime_status, "completed");
    assert!(actual_end_at.is_some(), "runtime must persist an actual end time");
    assert_eq!(active_key, None);
    assert_eq!(current_key, None);
    assert_eq!(remaining, 0);
    assert!(!waiting);

    let schedule_status: String =
        sqlx::query_scalar("SELECT status FROM exam_schedules WHERE id = ?")
            .bind(schedule_id.to_string())
            .fetch_one(database.pool())
            .await
            .expect("schedule row");
    assert_eq!(schedule_status, "completed");

    // The pending attempt is auto-finalized with the proctor_end completion reason.
    let (submitted_at, phase): (Option<chrono::DateTime<Utc>>, String) = sqlx::query_as(
        "SELECT submitted_at, phase FROM student_attempts WHERE schedule_id = ? AND student_key = ?",
    )
    .bind(schedule_id.to_string())
    .bind(&student_key)
    .fetch_one(database.pool())
    .await
    .expect("student attempt");
    assert!(submitted_at.is_some(), "pending attempt must be auto-submitted");
    assert_eq!(phase, "post-exam");
    let final_submission: serde_json::Value = sqlx::query_scalar(
        "SELECT final_submission FROM student_attempts WHERE schedule_id = ? AND student_key = ?",
    )
    .bind(schedule_id.to_string())
    .bind(&student_key)
    .fetch_one(database.pool())
    .await
    .expect("final submission payload");
    assert_eq!(final_submission["autoSubmission"], true);
    assert_eq!(final_submission["completionReason"], "proctor_end");

    // Append-only trail: one control event per advance, SECTION_END per section,
    // SECTION_START per reopened section and a final SESSION_END (all written by
    // the proctor advance path; the precheck audits are student-attributed).
    let advance_events: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM cohort_control_events WHERE schedule_id = ? AND action = 'end_section_now'",
    )
    .bind(schedule_id.to_string())
    .fetch_one(database.pool())
    .await
    .unwrap();
    assert_eq!(advance_events, 4);
    let mut audit_actions: Vec<String> = sqlx::query_scalar(
        "SELECT action_type FROM session_audit_logs WHERE schedule_id = ? AND action_type IN ('SECTION_END', 'SECTION_START', 'SESSION_END')",
    )
    .bind(schedule_id.to_string())
    .fetch_all(database.pool())
    .await
    .expect("audit trail");
    audit_actions.sort_unstable();
    assert_eq!(
        audit_actions,
        vec![
            "SECTION_END".to_owned(),
            "SECTION_END".to_owned(),
            "SECTION_END".to_owned(),
            "SECTION_END".to_owned(),
            "SECTION_START".to_owned(),
            "SECTION_START".to_owned(),
            "SECTION_START".to_owned(),
            "SESSION_END".to_owned()
        ]
    );
    let proctor_audit_actor: String = sqlx::query_scalar(
        "SELECT actor FROM session_audit_logs WHERE schedule_id = ? AND action_type = 'SECTION_END' LIMIT 1",
    )
    .bind(schedule_id.to_string())
    .fetch_one(database.pool())
    .await
    .expect("SECTION_END actor");
    assert_eq!(proctor_audit_actor, admin.user_id.to_string());

    database.shutdown().await;
}

#[tokio::test]
async fn transient_completed_runtime_does_not_finalize_pending_attempts() {
    let database = mysql::TestDatabase::new(SCHEDULING_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();
    let admin = mysql::create_authenticated_user(
        database.pool(),
        UserRole::Admin,
        "admin@example.com",
        "Admin",
    )
    .await;
    let student_auth = mysql::create_authenticated_user(
        database.pool(),
        UserRole::Student,
        "alice@example.com",
        "Alice Candidate",
    )
    .await;
    let student_key = mysql::create_student_registration(
        database.pool(),
        schedule_id,
        student_auth.user_id,
        "alice",
        "Alice Candidate",
        "alice@example.com",
    )
    .await;
    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));
    precheck_attempt(&app, &student_auth, schedule_id, &student_key).await;

    let start = command_request(&app, &admin, schedule_id, json!({ "action": "start_runtime" })).await;
    assert_eq!(start.status(), StatusCode::OK);

    // Craft a transient `completed` runtime that violates the completion
    // contract: the first section is still `live` and never ended.
    sqlx::query(
        r#"
        UPDATE exam_session_runtimes
        SET
            status = 'completed',
            actual_end_at = NOW(),
            active_section_key = NULL,
            current_section_key = NULL,
            current_section_remaining_seconds = 0,
            waiting_for_next_section = false,
            updated_at = NOW()
        WHERE schedule_id = ?
        "#,
    )
    .bind(schedule_id.to_string())
    .execute(database.pool())
    .await
    .expect("craft transient completed runtime");

    let listening_status: String = sqlx::query_scalar(
        "SELECT status FROM exam_session_runtime_sections WHERE runtime_id = (SELECT id FROM exam_session_runtimes WHERE schedule_id = ?) AND section_key = 'listening'",
    )
    .bind(schedule_id.to_string())
    .fetch_one(database.pool())
    .await
    .expect("listening section row");
    assert_eq!(listening_status, "live", "premise: section data is incomplete");

    // BEX-023: the transient `completed` status alone must not finalize the
    // pending attempt.
    let (submitted_at, phase): (Option<chrono::DateTime<Utc>>, String) = sqlx::query_as(
        "SELECT submitted_at, phase FROM student_attempts WHERE schedule_id = ? AND student_key = ?",
    )
    .bind(schedule_id.to_string())
    .bind(&student_key)
    .fetch_one(database.pool())
    .await
    .expect("student attempt");
    assert!(submitted_at.is_none(), "transient completed must not seal the attempt");
    assert_eq!(phase, "lobby", "attempt phase must stay untouched");

    let outbox_rows: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM outbox_events WHERE aggregate_id = ?",
    )
    .bind(schedule_id.to_string())
    .fetch_one(database.pool())
    .await
    .expect("outbox count");
    assert_eq!(outbox_rows, 0, "no completion outbox event for the crafted state");

    // A proctor complete-exam on the already-completed runtime early-returns
    // the current projection and must not finalize anything either.
    let complete = app
        .clone()
        .oneshot(
            admin.with_csrf(Request::builder())
                .method("POST")
                .uri(format!(
                    "/api/v1/proctor/sessions/{schedule_id}/control/complete-exam"
                ))
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({ "reason": "complete after transient state" }))
                        .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(complete.status(), StatusCode::OK);
    assert_eq!(json_body(complete).await["data"]["status"], "completed");

    let (submitted_at, phase): (Option<chrono::DateTime<Utc>>, String) = sqlx::query_as(
        "SELECT submitted_at, phase FROM student_attempts WHERE schedule_id = ? AND student_key = ?",
    )
    .bind(schedule_id.to_string())
    .bind(&student_key)
    .fetch_one(database.pool())
    .await
    .expect("student attempt");
    assert!(
        submitted_at.is_none(),
        "early-return complete-exam must not finalize the attempt"
    );
    assert_eq!(phase, "lobby");

    let outbox_rows: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM outbox_events WHERE aggregate_id = ?",
    )
    .bind(schedule_id.to_string())
    .fetch_one(database.pool())
    .await
    .expect("outbox count");
    assert_eq!(outbox_rows, 0, "early return must not write a completion outbox event");

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

async fn proctor_end_section_now(
    app: &axum::Router,
    auth: &mysql::TestAuthContext,
    schedule_id: Uuid,
    payload: serde_json::Value,
) -> axum::response::Response {
    app.clone()
        .oneshot(
            auth.with_csrf(Request::builder())
                .method("POST")
                .uri(format!(
                    "/api/v1/proctor/sessions/{schedule_id}/control/end-section-now"
                ))
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_vec(&payload).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap()
}

async fn admin_runtime_projection(
    app: &axum::Router,
    auth: &mysql::TestAuthContext,
    schedule_id: Uuid,
) -> serde_json::Value {
    let response = app
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
    assert_eq!(response.status(), StatusCode::OK);
    json_body(response).await
}

async fn precheck_attempt(
    app: &axum::Router,
    auth: &mysql::TestAuthContext,
    schedule_id: Uuid,
    student_key: &str,
) {
    let response = app
        .clone()
        .oneshot(
            auth.with_csrf(Request::builder())
                .method("POST")
                .uri(format!("/api/v1/student/sessions/{schedule_id}/precheck"))
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&StudentPrecheckRequest {
                        student_key: student_key.to_owned(),
                        candidate_id: "alice".to_owned(),
                        candidate_name: "Alice Candidate".to_owned(),
                        candidate_email: "alice@example.com".to_owned(),
                        email: Some("alice@example.com".to_owned()),
                        wcode: Some("W123456".to_owned()),
                        client_session_id: Uuid::new_v4().to_string(),
                        pre_check: json!({
                            "completedAt": "2026-01-10T08:50:00Z",
                            "browserFamily": "chrome",
                            "checks": [{"id": "browser", "status": "pass"}]
                        }),
                        device_fingerprint_hash: Some("fp-alice".to_owned()),
                    })
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK, "precheck must succeed");
}

async fn json_body(response: axum::response::Response) -> serde_json::Value {
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    serde_json::from_slice(&body).unwrap()
}

fn contract_actor() -> ActorContext {
    ActorContext::new(Uuid::new_v4().to_string(), ActorRole::Admin)
}
