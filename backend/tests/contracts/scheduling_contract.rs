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

    let start = command_request(&app, &auth, schedule_id, json!({ "action": "start_runtime" })).await;
    assert_eq!(start.status(), StatusCode::OK);
    let start_json = json_body(start).await;
    assert_eq!(start_json["data"]["status"], "live");
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

    let resume = command_request(&app, &auth, schedule_id, json!({ "action": "resume_runtime" })).await;
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

    let start = command_request(&app, &auth, schedule_id, json!({ "action": "start_runtime" })).await;
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

    let runtime = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM exam_session_runtimes WHERE schedule_id = ?",
    )
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
                    "reading": {"passages": [{"id": "reading-1"}]},
                    "listening": {"parts": [{"id": "listening-1"}]},
                    "writing": {"tasks": [{"id": "writing-1"}]},
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
        "sections": {
            "listening": {
                "enabled": true,
                "label": "Listening",
                "order": 1,
                "duration": 30,
                "gapAfterMinutes": 5
            },
            "reading": {
                "enabled": true,
                "label": "Reading",
                "order": 2,
                "duration": 60,
                "gapAfterMinutes": 0
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
