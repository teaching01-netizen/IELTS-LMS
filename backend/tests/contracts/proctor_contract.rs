#[path = "../support/mysql.rs"]
mod mysql;

use axum::{
    body::{to_bytes, Body},
    http::{Request, StatusCode},
};
use chrono::{Duration, TimeZone, Utc};
use futures_util::StreamExt;
use serde_json::json;
use tokio::net::TcpListener;
use tokio_tungstenite::connect_async;
use tower::ServiceExt;
use uuid::Uuid;

use ielts_backend_api::{router::build_router, state::AppState};
use ielts_backend_application::{
    builder::BuilderService, delivery::DeliveryService, scheduling::SchedulingService,
};
use ielts_backend_domain::{
    auth::UserRole,
    attempt::StudentBootstrapRequest,
    exam::{CreateExamRequest, ExamType, PublishExamRequest, SaveDraftRequest, Visibility},
    schedule::{
        CreateScheduleRequest, LiveUpdateEvent, ProctorPresenceRequest, RuntimeCommandAction,
        RuntimeCommandRequest,
    },
};

use mysql::{assign_staff_to_schedule, create_authenticated_user};
use ielts_backend_infrastructure::{
    actor_context::{ActorContext, ActorRole},
    config::AppConfig,
};

const PROCTOR_MIGRATIONS: &[&str] = &[
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
async fn list_sessions_and_detail_include_runtime_and_attempts() {
    let database = mysql::TestDatabase::new(PROCTOR_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();
    let attempt_id = bootstrap_attempt(database.pool(), schedule_id, "alice").await;
    let auth = create_authenticated_user(
        database.pool(),
        UserRole::Proctor,
        "proctor@example.com",
        "Test Proctor",
    )
    .await;
    assign_staff_to_schedule(database.pool(), schedule_id, auth.user_id, "proctor").await;
    SchedulingService::new(database.pool().clone())
        .apply_runtime_command(
            &contract_actor(),
            schedule_id,
            RuntimeCommandRequest {
                action: RuntimeCommandAction::StartRuntime,
                reason: None,
            },
        )
        .await
        .expect("start runtime");
    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));

    let list = app
        .clone()
        .oneshot(
            auth.with_auth(Request::builder().uri("/api/v1/proctor/sessions"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(list.status(), StatusCode::OK);
    let list_json = json_body(list).await;
    assert_eq!(
        list_json["data"][0]["schedule"]["id"],
        schedule.id.to_string()
    );
    assert_eq!(list_json["data"][0]["studentCount"], 1);
    assert_eq!(list_json["data"][0]["runtime"]["status"], "live");

    let detail = app
        .oneshot(
            auth.with_auth(
                Request::builder().uri(format!("/api/v1/proctor/sessions/{}", schedule_id)),
            )
            .body(Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(detail.status(), StatusCode::OK);
    let detail_json = json_body(detail).await;
    assert_eq!(
        detail_json["data"]["sessions"][0]["attemptId"],
        attempt_id.to_string()
    );
    assert_eq!(detail_json["data"]["runtime"]["status"], "live");

    database.shutdown().await;
}

#[tokio::test]
async fn presence_and_student_commands_update_session_state_and_alerts() {
    let database = mysql::TestDatabase::new(PROCTOR_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();
    let attempt_id = bootstrap_attempt(database.pool(), schedule_id, "alice").await;
    let auth = create_authenticated_user(
        database.pool(),
        UserRole::Proctor,
        "proctor@example.com",
        "Test Proctor",
    )
    .await;
    assign_staff_to_schedule(database.pool(), schedule_id, auth.user_id, "proctor").await;
    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));

    let presence = app
        .clone()
        .oneshot(
            auth.with_csrf(Request::builder())
                .method("POST")
                .uri(format!("/api/v1/proctor/sessions/{}/presence", schedule_id))
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&ProctorPresenceRequest {
                        action: ielts_backend_domain::schedule::PresenceAction::Join,
                    })
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(presence.status(), StatusCode::OK);
    let presence_json = json_body(presence).await;
    assert_eq!(presence_json["data"][0]["proctorId"], auth.user_id.to_string());

    let warn = issue_attempt_command(
        &app,
        &auth,
        schedule_id,
        attempt_id,
        "warn",
        json!({ "message": "Look at the camera" }),
    )
    .await;
    assert_eq!(warn["data"]["status"], "warned");

    let (proctor_status, proctor_note, last_warning_id, violations_snapshot): (
        String,
        Option<String>,
        Option<String>,
        serde_json::Value,
    ) = sqlx::query_as(
        "SELECT proctor_status, proctor_note, last_warning_id, violations_snapshot FROM student_attempts WHERE id = ?",
    )
    .bind(attempt_id.to_string())
    .fetch_one(database.pool())
    .await
    .unwrap();
    assert_eq!(proctor_status, "warned");
    assert_eq!(proctor_note.as_deref(), Some("Look at the camera"));
    let warning_id = last_warning_id.expect("warning id");
    let contains_warning = violations_snapshot
        .as_array()
        .map(|violations| {
            violations.iter().any(|entry| {
                entry.get("type").and_then(serde_json::Value::as_str) == Some("PROCTOR_WARNING")
                    && entry.get("id").and_then(serde_json::Value::as_str)
                        == Some(warning_id.as_str())
            })
        })
        .unwrap_or(false);
    assert!(contains_warning, "violations snapshot should contain the proctor warning");

    let violation_events: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM student_violation_events WHERE attempt_id = ? AND violation_type = 'PROCTOR_WARNING'",
    )
    .bind(attempt_id.to_string())
    .fetch_one(database.pool())
    .await
    .unwrap();
    assert_eq!(violation_events, 1);

    let audit_logs: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM session_audit_logs WHERE schedule_id = ? AND target_student_id = ? AND action_type = 'STUDENT_WARN'",
    )
    .bind(schedule_id.to_string())
    .bind(attempt_id.to_string())
    .fetch_one(database.pool())
    .await
    .unwrap();
    assert_eq!(audit_logs, 1);

    let pause = issue_attempt_command(
        &app,
        &auth,
        schedule_id,
        attempt_id,
        "pause",
        json!({ "reason": "Manual pause" }),
    )
    .await;
    assert_eq!(pause["data"]["status"], "paused");

    let resume = issue_attempt_command(
        &app,
        &auth,
        schedule_id,
        attempt_id,
        "resume",
        json!({}),
    )
    .await;
    assert_eq!(resume["data"]["status"], "idle");

    let detail = app
        .clone()
        .oneshot(
            auth.with_auth(
                Request::builder().uri(format!("/api/v1/proctor/sessions/{}", schedule_id)),
            )
            .body(Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    let detail_json = json_body(detail).await;
    let warn_alert = detail_json["data"]["alerts"]
        .as_array()
        .unwrap()
        .iter()
        .find(|alert| alert["type"] == "STUDENT_WARN")
        .expect("warn alert");
    let alert_id = warn_alert["id"].as_str().unwrap().to_owned();

    let ack = app
        .clone()
        .oneshot(
            auth.with_csrf(Request::builder())
                .method("POST")
                .uri(format!("/api/v1/proctor/alerts/{alert_id}/ack"))
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_vec(&json!({})).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(ack.status(), StatusCode::OK);
    let ack_json = json_body(ack).await;
    assert_ne!(ack_json["data"]["acknowledgedAt"], serde_json::Value::Null);

    let terminate = issue_attempt_command(
        &app,
        &auth,
        schedule_id,
        attempt_id,
        "terminate",
        json!({ "reason": "Escalated violation" }),
    )
    .await;
    assert_eq!(terminate["data"]["status"], "terminated");

    database.shutdown().await;
}

#[tokio::test]
async fn control_commands_extend_end_sections_and_complete_exam() {
    let database = mysql::TestDatabase::new(PROCTOR_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();
    let auth = create_authenticated_user(
        database.pool(),
        UserRole::Proctor,
        "proctor@example.com",
        "Test Proctor",
    )
    .await;
    assign_staff_to_schedule(database.pool(), schedule_id, auth.user_id, "proctor").await;
    SchedulingService::new(database.pool().clone())
        .apply_runtime_command(
            &contract_actor(),
            schedule_id,
            RuntimeCommandRequest {
                action: RuntimeCommandAction::StartRuntime,
                reason: None,
            },
        )
        .await
        .expect("start runtime");
    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));

    let extend = app
        .clone()
        .oneshot(
            auth.with_csrf(Request::builder())
                .method("POST")
                .uri(format!(
                    "/api/v1/proctor/sessions/{}/control/extend-section",
                    schedule_id
                ))
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({ "minutes": 5 })).unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(extend.status(), StatusCode::OK);
    let extend_json = json_body(extend).await;
    assert_eq!(extend_json["data"]["currentSectionRemainingSeconds"], 2100);

    let end_section = app
        .clone()
        .oneshot(
            auth.with_csrf(Request::builder())
                .method("POST")
                .uri(format!(
                    "/api/v1/proctor/sessions/{}/control/end-section-now",
                    schedule_id
                ))
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({ "reason": "Move on" })).unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(end_section.status(), StatusCode::OK);
    let end_section_json = json_body(end_section).await;
    assert_eq!(end_section_json["data"]["currentSectionKey"], "reading");

    let complete = app
        .oneshot(
            auth.with_csrf(Request::builder())
                .method("POST")
                .uri(format!(
                    "/api/v1/proctor/sessions/{}/control/complete-exam",
                    schedule_id
                ))
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_vec(&json!({})).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(complete.status(), StatusCode::OK);
    let complete_json = json_body(complete).await;
    assert_eq!(complete_json["data"]["status"], "completed");

    database.shutdown().await;
}

#[tokio::test]
async fn websocket_live_endpoint_rejects_unauthenticated_connections() {
    let database = mysql::TestDatabase::new(PROCTOR_MIGRATIONS).await;
    
    let state = AppState::with_pool(AppConfig::default(), database.pool().clone());
    let router_state = state.clone();
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind test listener");
    let address = listener.local_addr().expect("listener address");
    let server = tokio::spawn(async move {
        let app = build_router(router_state);
        axum::serve(listener, app)
            .await
            .expect("serve websocket test app");
    });

    // Attempt connection without authentication
    let ws_url = format!("ws://{address}/api/v1/ws/live?scheduleId=schedule-123");
    let result = connect_async(&ws_url).await;
    
    // Should fail with 401 Unauthorized
    assert!(result.is_err(), "Unauthenticated WebSocket connection should be rejected");
    let err_msg = format!("{:?}", result.unwrap_err());
    assert!(err_msg.contains("401") || err_msg.contains("UNAUTHORIZED"), 
            "Error should indicate unauthorized: {}", err_msg);

    server.abort();
    database.shutdown().await;
}

#[tokio::test]
async fn websocket_live_endpoint_accepts_authenticated_connections_with_cookie() {
    let database = mysql::TestDatabase::new(PROCTOR_MIGRATIONS).await;
    let auth = create_authenticated_user(
        database.pool(),
        UserRole::Proctor,
        "proctor@example.com",
        "Test Proctor",
    )
    .await;
    
    let state = AppState::with_pool(AppConfig::default(), database.pool().clone());
    let router_state = state.clone();
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind test listener");
    let address = listener.local_addr().expect("listener address");
    let server = tokio::spawn(async move {
        let app = build_router(router_state);
        axum::serve(listener, app)
            .await
            .expect("serve websocket test app");
    });

    // Connect with authenticated session cookie using custom request
    let ws_request = Request::builder()
        .method("GET")
        .uri(format!("ws://{address}/api/v1/ws/live?scheduleId=schedule-123"))
        .header("Host", format!("{address}"))
        .header("Cookie", format!("__Host-session={}", auth.session_token))
        .header("Connection", "Upgrade")
        .header("Upgrade", "websocket")
        .header("Sec-WebSocket-Version", "13")
        .header("Sec-WebSocket-Key", "dGhlIHNhbXBsZSBub25jZQ==")
        .body(())
        .expect("build websocket request");
    
    let (mut socket, _) = connect_async(ws_request)
        .await
        .expect("connect websocket route with auth");

    let first_message = socket
        .next()
        .await
        .expect("connected message")
        .expect("websocket frame");
    let text = first_message.into_text().expect("text frame");
    let payload: serde_json::Value = serde_json::from_str(&text).expect("parse handshake payload");
    assert_eq!(payload["type"], "connected");
    assert_eq!(payload["scheduleId"], "schedule-123");

    state.live_updates.publish(LiveUpdateEvent {
        kind: "schedule_runtime".to_owned(),
        id: "schedule-123".to_owned(),
        revision: 9,
        event: "runtime_changed".to_owned(),
    });

    let update_message = socket
        .next()
        .await
        .expect("update message")
        .expect("websocket frame");
    let update_text = update_message.into_text().expect("text frame");
    let update_payload: serde_json::Value =
        serde_json::from_str(&update_text).expect("parse update payload");
    assert_eq!(update_payload["kind"], "schedule_runtime");
    assert_eq!(update_payload["id"], "schedule-123");
    assert_eq!(update_payload["revision"], 9);
    assert_eq!(update_payload["event"], "runtime_changed");

    server.abort();
    database.shutdown().await;
}

async fn issue_attempt_command(
    app: &axum::Router,
    auth: &mysql::TestAuthContext,
    schedule_id: Uuid,
    attempt_id: Uuid,
    action: &str,
    body: serde_json::Value,
) -> serde_json::Value {
    let response = app
        .clone()
        .oneshot(
            auth.with_csrf(Request::builder())
                .method("POST")
                .uri(format!(
                    "/api/v1/proctor/sessions/{}/attempts/{}/{}",
                    schedule_id, attempt_id, action
                ))
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_vec(&body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    json_body(response).await
}

async fn bootstrap_attempt(pool: &sqlx::MySqlPool, schedule_id: Uuid, candidate_id: &str) -> Uuid {
    let context = DeliveryService::new(pool.clone())
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
    Uuid::parse_str(&attempt_id).expect("attempt id")
}

async fn seed_schedule(pool: &sqlx::MySqlPool) -> ielts_backend_domain::schedule::ExamSchedule {
    let actor = contract_actor();
    let builder_service = BuilderService::new(pool.clone());
    let exam = builder_service
        .create_exam(
            &actor,
            CreateExamRequest {
                slug: "cambridge-19-academic-proctor".to_owned(),
                title: "Cambridge 19 Academic Proctor".to_owned(),
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
                publish_notes: Some("ready for proctor contracts".to_owned()),
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
                cohort_name: "Proctor Cohort".to_owned(),
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
