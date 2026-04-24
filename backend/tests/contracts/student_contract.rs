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
    attempt::{
        StudentAuditLogRequest, StudentBootstrapRequest, StudentHeartbeatRequest,
        StudentMutationBatchRequest,
        StudentPrecheckRequest, StudentSubmitRequest,
    },
    exam::{CreateExamRequest, ExamType, PublishExamRequest, SaveDraftRequest, Visibility},
    schedule::CreateScheduleRequest,
};
use ielts_backend_infrastructure::{
    actor_context::{ActorContext, ActorRole},
    config::AppConfig,
};

const DELIVERY_MIGRATIONS: &[&str] = &[
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
async fn get_student_session_returns_schedule_and_version_before_bootstrap() {
    let database = mysql::TestDatabase::new(DELIVERY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();
    let (auth, _student_key) = create_student_auth(database.pool(), schedule_id, "alice").await;
    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));

    let response = app
        .oneshot(
            auth.with_auth(Request::builder().uri(format!(
                "/api/v1/student/sessions/{}?candidateId=alice",
                schedule_id
            )))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let json = json_body(response).await;

    assert_eq!(json["success"], true);
    assert_eq!(json["data"]["schedule"]["id"], schedule.id.to_string());
    assert_eq!(
        json["data"]["version"]["id"],
        schedule.published_version_id.to_string()
    );
    assert_eq!(json["data"]["runtime"]["status"], "not_started");
    assert_eq!(json["data"]["attempt"], serde_json::Value::Null);

    database.shutdown().await;
}

#[tokio::test]
async fn precheck_persists_integrity_on_the_attempt() {
    let database = mysql::TestDatabase::new(DELIVERY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();
    let (auth, student_key) = create_student_auth(database.pool(), schedule_id, "alice").await;
    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));

    let response = app
        .oneshot(
            auth.with_csrf(Request::builder())
                .method("POST")
                .uri(format!("/api/v1/student/sessions/{}/precheck", schedule_id))
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&StudentPrecheckRequest {
                        student_key: student_key.clone(),
                        candidate_id: "alice".to_owned(),
                        candidate_name: "Alice Roe".to_owned(),
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

    assert_eq!(response.status(), StatusCode::OK);
    let json = json_body(response).await;

    assert_eq!(
        json["data"]["studentKey"],
        student_key
    );
    assert_eq!(json["data"]["phase"], "lobby");
    assert_eq!(
        json["data"]["integrity"]["preCheck"]["completedAt"],
        "2026-01-10T08:50:00Z"
    );
    assert_eq!(
        json["data"]["integrity"]["deviceFingerprintHash"],
        "fp-alice"
    );

    database.shutdown().await;
}

#[tokio::test]
async fn bootstrap_creates_or_hydrates_the_attempt_context() {
    let database = mysql::TestDatabase::new(DELIVERY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();
    let (auth, student_key) = create_student_auth(database.pool(), schedule_id, "alice").await;
    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));

    let response = app
        .oneshot(
            auth.with_csrf(Request::builder())
                .method("POST")
                .uri(format!(
                    "/api/v1/student/sessions/{}/bootstrap",
                    schedule_id
                ))
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&StudentBootstrapRequest {
                        student_key: student_key.clone(),
                        candidate_id: "alice".to_owned(),
                        candidate_name: "Alice Roe".to_owned(),
                        candidate_email: "alice@example.com".to_owned(),
                        email: Some("alice@example.com".to_owned()),
                        wcode: Some("W123456".to_owned()),
                        client_session_id: Uuid::new_v4().to_string(),
                    })
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let json = json_body(response).await;

    assert_eq!(
        json["data"]["attempt"]["studentKey"],
        student_key
    );
    assert_eq!(json["data"]["attempt"]["phase"], "pre-check");
    assert_eq!(json["data"]["runtime"]["status"], "not_started");
    assert!(json["data"]["attemptCredential"]["attemptToken"].is_string());

    database.shutdown().await;
}

#[tokio::test]
async fn mutation_batch_persists_answers_and_returns_the_server_watermark() {
    let database = mysql::TestDatabase::new(DELIVERY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();
    let (auth, student_key) = create_student_auth(database.pool(), schedule_id, "alice").await;
    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));
    let (bootstrap, client_session_id) =
        bootstrap_attempt(&app, &auth, schedule_id, "alice", &student_key).await;
    start_runtime(database.pool(), schedule_id, "listening").await;
    let attempt_id = bootstrap["data"]["attempt"]["id"].as_str().unwrap().to_owned();
    let attempt_token = bootstrap["data"]["attemptCredential"]["attemptToken"]
        .as_str()
        .unwrap()
        .to_owned();

    let response = app
        .oneshot(
            with_attempt_token(Request::builder(), &attempt_token)
                .method("POST")
                .uri(format!(
                    "/api/v1/student/sessions/{}/mutations:batch",
                    schedule_id
                ))
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&StudentMutationBatchRequest {
                        attempt_id,
                        student_key: student_key.clone(),
                        client_session_id,
                        mutations: vec![
                            ielts_backend_domain::attempt::MutationEnvelope {
                                id: "mutation-1".to_owned(),
                                seq: 1,
                                timestamp: Utc.with_ymd_and_hms(2026, 1, 10, 9, 5, 0).unwrap(),
                                mutation_type: "answer".to_owned(),
                                payload: json!({"questionId": "q1", "value": "A"}),
                            },
                            ielts_backend_domain::attempt::MutationEnvelope {
                                id: "mutation-2".to_owned(),
                                seq: 2,
                                timestamp: Utc.with_ymd_and_hms(2026, 1, 10, 9, 5, 5).unwrap(),
                                mutation_type: "flag".to_owned(),
                                payload: json!({"questionId": "q1", "value": true}),
                            },
                        ],
                    })
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let json = json_body(response).await;

    assert_eq!(json["data"]["appliedMutationCount"], 2);
    assert_eq!(json["data"]["serverAcceptedThroughSeq"], 2);
    assert_eq!(json["data"]["attempt"]["answers"]["q1"], "A");
    assert_eq!(json["data"]["attempt"]["flags"]["q1"], true);
    assert_eq!(json["data"]["attempt"]["recovery"]["syncState"], "saved");

    database.shutdown().await;
}

#[tokio::test]
async fn mutation_batch_allows_independent_client_sessions_to_persist_reading_answers() {
    let database = mysql::TestDatabase::new(DELIVERY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();
    let (auth, student_key) = create_student_auth(database.pool(), schedule_id, "alice").await;
    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));
    let (bootstrap_phone, client_session_id_phone) = bootstrap_attempt_with_client_session_id(
        &app,
        &auth,
        schedule_id,
        "alice",
        &student_key,
        "phone-client-1",
    )
    .await;
    let (bootstrap_computer, client_session_id_computer) =
        bootstrap_attempt_with_client_session_id(
            &app,
            &auth,
            schedule_id,
            "alice",
            &student_key,
            "computer-client-1",
        )
        .await;
    start_runtime(database.pool(), schedule_id, "reading").await;

    let attempt_id = bootstrap_phone["data"]["attempt"]["id"].as_str().unwrap().to_owned();
    assert_eq!(
        bootstrap_computer["data"]["attempt"]["id"],
        attempt_id
    );
    let attempt_token_phone = bootstrap_phone["data"]["attemptCredential"]["attemptToken"]
        .as_str()
        .unwrap()
        .to_owned();
    let attempt_token_computer = bootstrap_computer["data"]["attemptCredential"]["attemptToken"]
        .as_str()
        .unwrap()
        .to_owned();

    let first = app
        .clone()
        .oneshot(
            with_attempt_token(Request::builder(), &attempt_token_phone)
                .method("POST")
                .uri(format!(
                    "/api/v1/student/sessions/{}/mutations:batch",
                    schedule_id
                ))
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&StudentMutationBatchRequest {
                        attempt_id: attempt_id.clone(),
                        student_key: student_key.clone(),
                        client_session_id: client_session_id_phone,
                        mutations: vec![ielts_backend_domain::attempt::MutationEnvelope {
                            id: "mutation-1".to_owned(),
                            seq: 1,
                            timestamp: Utc.with_ymd_and_hms(2026, 1, 10, 9, 5, 0).unwrap(),
                            mutation_type: "answer".to_owned(),
                            payload: json!({"questionId": "q1", "value": "A"}),
                        }],
                    })
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(first.status(), StatusCode::OK);

    let second = app
        .oneshot(
            with_attempt_token(Request::builder(), &attempt_token_computer)
                .method("POST")
                .uri(format!(
                    "/api/v1/student/sessions/{}/mutations:batch",
                    schedule_id
                ))
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&StudentMutationBatchRequest {
                        attempt_id: attempt_id.clone(),
                        student_key: student_key.clone(),
                        client_session_id: client_session_id_computer,
                        mutations: vec![ielts_backend_domain::attempt::MutationEnvelope {
                            id: "mutation-2".to_owned(),
                            seq: 1,
                            timestamp: Utc.with_ymd_and_hms(2026, 1, 10, 9, 5, 5).unwrap(),
                            mutation_type: "answer".to_owned(),
                            payload: json!({"questionId": "q2", "value": "B"}),
                        }],
                    })
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(second.status(), StatusCode::OK);

    let answers: serde_json::Value = sqlx::query_scalar(
        "SELECT answers FROM student_attempts WHERE id = ?",
    )
    .bind(&attempt_id)
    .fetch_one(database.pool())
    .await
    .unwrap();

    assert_eq!(answers["q1"], "A");
    assert_eq!(answers["q2"], "B");

    database.shutdown().await;
}

#[tokio::test]
async fn mutation_batch_replays_same_idempotency_key_and_rejects_hash_mismatch() {
    let database = mysql::TestDatabase::new(DELIVERY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();
    let (auth, student_key) = create_student_auth(database.pool(), schedule_id, "alice").await;
    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));
    let (bootstrap, client_session_id) =
        bootstrap_attempt(&app, &auth, schedule_id, "alice", &student_key).await;
    start_runtime(database.pool(), schedule_id, "listening").await;
    let attempt_id = bootstrap["data"]["attempt"]["id"].as_str().unwrap().to_owned();
    let attempt_token = bootstrap["data"]["attemptCredential"]["attemptToken"]
        .as_str()
        .unwrap()
        .to_owned();
    let request = StudentMutationBatchRequest {
        attempt_id: attempt_id.clone(),
        student_key: student_key.clone(),
        client_session_id: client_session_id.clone(),
        mutations: vec![
            ielts_backend_domain::attempt::MutationEnvelope {
                id: "mutation-1".to_owned(),
                seq: 1,
                timestamp: Utc.with_ymd_and_hms(2026, 1, 10, 9, 5, 0).unwrap(),
                mutation_type: "answer".to_owned(),
                payload: json!({"questionId": "q1", "value": "A"}),
            },
            ielts_backend_domain::attempt::MutationEnvelope {
                id: "mutation-2".to_owned(),
                seq: 2,
                timestamp: Utc.with_ymd_and_hms(2026, 1, 10, 9, 5, 5).unwrap(),
                mutation_type: "flag".to_owned(),
                payload: json!({"questionId": "q1", "value": true}),
            },
        ],
    };

    let first = app
        .clone()
        .oneshot(
            with_attempt_token(Request::builder(), &attempt_token)
                .method("POST")
                .uri(format!(
                    "/api/v1/student/sessions/{}/mutations:batch",
                    schedule_id
                ))
                .header("content-type", "application/json")
                .header("idempotency-key", "mutation-replay-1")
                .body(Body::from(serde_json::to_vec(&request).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(first.status(), StatusCode::OK);
    let first_json = json_body(first).await;

    let replay = app
        .clone()
        .oneshot(
            with_attempt_token(Request::builder(), &attempt_token)
                .method("POST")
                .uri(format!(
                    "/api/v1/student/sessions/{}/mutations:batch",
                    schedule_id
                ))
                .header("content-type", "application/json")
                .header("idempotency-key", "mutation-replay-1")
                .body(Body::from(serde_json::to_vec(&request).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(replay.status(), StatusCode::OK);
    let replay_json = json_body(replay).await;
    assert_eq!(replay_json["data"], first_json["data"]);

    let conflict = app
        .oneshot(
            with_attempt_token(Request::builder(), &attempt_token)
                .method("POST")
                .uri(format!(
                    "/api/v1/student/sessions/{}/mutations:batch",
                    schedule_id
                ))
                .header("content-type", "application/json")
                .header("idempotency-key", "mutation-replay-1")
                .body(Body::from(
                    serde_json::to_vec(&StudentMutationBatchRequest {
                        attempt_id: attempt_id.clone(),
                        student_key: student_key.clone(),
                        client_session_id: client_session_id.clone(),
                        mutations: vec![ielts_backend_domain::attempt::MutationEnvelope {
                            id: "mutation-3".to_owned(),
                            seq: 3,
                            timestamp: Utc.with_ymd_and_hms(2026, 1, 10, 9, 5, 10).unwrap(),
                            mutation_type: "answer".to_owned(),
                            payload: json!({"questionId": "q2", "value": "B"}),
                        }],
                    })
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(conflict.status(), StatusCode::CONFLICT);
    let conflict_json = json_body(conflict).await;
    assert_eq!(conflict_json["error"]["code"], "CONFLICT");

    database.shutdown().await;
}

#[tokio::test]
async fn heartbeat_records_disconnect_transitions() {
    let database = mysql::TestDatabase::new(DELIVERY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();
    let (auth, student_key) = create_student_auth(database.pool(), schedule_id, "alice").await;
    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));
    let (bootstrap, client_session_id) =
        bootstrap_attempt(&app, &auth, schedule_id, "alice", &student_key).await;
    let attempt_id = bootstrap["data"]["attempt"]["id"].as_str().unwrap().to_owned();
    let attempt_token = bootstrap["data"]["attemptCredential"]["attemptToken"]
        .as_str()
        .unwrap()
        .to_owned();

    let response = app
        .oneshot(
            with_attempt_token(Request::builder(), &attempt_token)
                .method("POST")
                .uri(format!(
                    "/api/v1/student/sessions/{}/heartbeat",
                    schedule_id
                ))
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&StudentHeartbeatRequest {
                        attempt_id: Some(attempt_id.clone()),
                        student_key: student_key.clone(),
                        client_session_id,
                        event_type: "disconnect".to_owned(),
                        payload: Some(json!({"source": "browser"})),
                        client_timestamp: Utc.with_ymd_and_hms(2026, 1, 10, 9, 6, 0).unwrap(),
                    })
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let json = json_body(response).await;

    assert_eq!(json["data"]["attempt"]["integrity"]["lastHeartbeatStatus"], "lost");
    assert_ne!(
        json["data"]["attempt"]["integrity"]["lastDisconnectAt"],
        serde_json::Value::Null
    );

    let event_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM student_heartbeat_events WHERE attempt_id = ?")
            .bind(&attempt_id)
            .fetch_one(database.pool())
            .await
            .unwrap();
    assert_eq!(event_count, 1);

    let audit_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM session_audit_logs WHERE schedule_id = ? AND target_student_id = ? AND action_type = 'NETWORK_DISCONNECTED'",
    )
    .bind(schedule_id.to_string())
    .bind(&attempt_id)
    .fetch_one(database.pool())
    .await
    .unwrap();
    assert_eq!(audit_count, 1);

    database.shutdown().await;
}

#[tokio::test]
async fn heartbeat_records_lost_transitions() {
    let database = mysql::TestDatabase::new(DELIVERY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();
    let (auth, student_key) = create_student_auth(database.pool(), schedule_id, "alice").await;
    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));
    let (bootstrap, client_session_id) =
        bootstrap_attempt(&app, &auth, schedule_id, "alice", &student_key).await;
    let attempt_id = bootstrap["data"]["attempt"]["id"].as_str().unwrap().to_owned();
    let attempt_token = bootstrap["data"]["attemptCredential"]["attemptToken"]
        .as_str()
        .unwrap()
        .to_owned();

    let response = app
        .oneshot(
            with_attempt_token(Request::builder(), &attempt_token)
                .method("POST")
                .uri(format!("/api/v1/student/sessions/{}/heartbeat", schedule_id))
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&StudentHeartbeatRequest {
                        attempt_id: Some(attempt_id.clone()),
                        student_key: student_key.clone(),
                        client_session_id,
                        event_type: "lost".to_owned(),
                        payload: Some(json!({"source": "browser"})),
                        client_timestamp: Utc.with_ymd_and_hms(2026, 1, 10, 9, 6, 10).unwrap(),
                    })
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let audit_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM session_audit_logs WHERE schedule_id = ? AND target_student_id = ? AND action_type = 'HEARTBEAT_LOST'",
    )
    .bind(schedule_id.to_string())
    .bind(&attempt_id)
    .fetch_one(database.pool())
    .await
    .unwrap();
    assert_eq!(audit_count, 1);

    database.shutdown().await;
}

#[tokio::test]
async fn student_audit_inserts_session_log_and_violation_event() {
    let database = mysql::TestDatabase::new(DELIVERY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();
    let (auth, student_key) = create_student_auth(database.pool(), schedule_id, "alice").await;
    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));
    let (bootstrap, _client_session_id) =
        bootstrap_attempt(&app, &auth, schedule_id, "alice", &student_key).await;
    let attempt_id = bootstrap["data"]["attempt"]["id"].as_str().unwrap().to_owned();
    let attempt_token = bootstrap["data"]["attemptCredential"]["attemptToken"]
        .as_str()
        .unwrap()
        .to_owned();

    let response = app
        .oneshot(
            with_attempt_token(Request::builder(), &attempt_token)
                .method("POST")
                .uri(format!("/api/v1/student/sessions/{}/audit", schedule_id))
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&StudentAuditLogRequest {
                        action_type: "VIOLATION_DETECTED".to_owned(),
                        payload: Some(json!({
                            "event": "VIOLATION_DETECTED",
                            "violationType": "TAB_SWITCH",
                            "severity": "critical",
                            "message": "Tab switching detected."
                        })),
                        client_timestamp: Some(Utc.with_ymd_and_hms(2026, 1, 10, 9, 7, 0).unwrap()),
                    })
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let audit_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM session_audit_logs WHERE schedule_id = ? AND target_student_id = ? AND action_type = 'VIOLATION_DETECTED'",
    )
    .bind(schedule_id.to_string())
    .bind(&attempt_id)
    .fetch_one(database.pool())
    .await
    .unwrap();
    assert_eq!(audit_count, 1);

    let violation_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM student_violation_events WHERE schedule_id = ? AND attempt_id = ? AND violation_type = 'TAB_SWITCH' AND severity = 'critical'",
    )
    .bind(schedule_id.to_string())
    .bind(&attempt_id)
    .fetch_one(database.pool())
    .await
    .unwrap();
    assert_eq!(violation_count, 1);

    database.shutdown().await;
}

#[tokio::test]
async fn submit_finalizes_the_attempt_idempotently() {
    let database = mysql::TestDatabase::new(DELIVERY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();
    let (auth, student_key) = create_student_auth(database.pool(), schedule_id, "alice").await;
    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));
    let (bootstrap, _) = bootstrap_attempt(&app, &auth, schedule_id, "alice", &student_key).await;
    let attempt_id = bootstrap["data"]["attempt"]["id"].as_str().unwrap().to_owned();
    let attempt_token = bootstrap["data"]["attemptCredential"]["attemptToken"]
        .as_str()
        .unwrap()
        .to_owned();

    let response = app
        .clone()
        .oneshot(
            with_attempt_token(Request::builder(), &attempt_token)
                .method("POST")
                .uri(format!("/api/v1/student/sessions/{}/submit", schedule_id))
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&StudentSubmitRequest {
                        attempt_id: attempt_id.clone(),
                        student_key: student_key.clone(),
                    })
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let json = json_body(response).await;
    let submission_id = json["data"]["submissionId"].as_str().unwrap().to_owned();

    assert_eq!(json["data"]["attempt"]["phase"], "post-exam");
    assert_eq!(
        json["data"]["attempt"]["submittedAt"],
        json["data"]["submittedAt"]
    );

    let retry = app
        .oneshot(
            with_attempt_token(Request::builder(), &attempt_token)
                .method("POST")
                .uri(format!("/api/v1/student/sessions/{}/submit", schedule_id))
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&StudentSubmitRequest {
                        attempt_id,
                        student_key: student_key.clone(),
                    })
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(retry.status(), StatusCode::OK);
    let retry_json = json_body(retry).await;
    assert_eq!(retry_json["data"]["submissionId"], submission_id);

    database.shutdown().await;
}

#[tokio::test]
async fn submit_replays_cached_response_for_the_same_idempotency_key() {
    let database = mysql::TestDatabase::new(DELIVERY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();
    let (auth, student_key) = create_student_auth(database.pool(), schedule_id, "alice").await;
    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));
    let (bootstrap, _) = bootstrap_attempt(&app, &auth, schedule_id, "alice", &student_key).await;
    let attempt_id = bootstrap["data"]["attempt"]["id"].as_str().unwrap().to_owned();
    let attempt_token = bootstrap["data"]["attemptCredential"]["attemptToken"]
        .as_str()
        .unwrap()
        .to_owned();

    let first = app
        .clone()
        .oneshot(
            with_attempt_token(Request::builder(), &attempt_token)
                .method("POST")
                .uri(format!("/api/v1/student/sessions/{}/submit", schedule_id))
                .header("content-type", "application/json")
                .header("idempotency-key", "submit-replay-1")
                .body(Body::from(
                    serde_json::to_vec(&StudentSubmitRequest {
                        attempt_id: attempt_id.clone(),
                        student_key: student_key.clone(),
                    })
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(first.status(), StatusCode::OK);
    let first_json = json_body(first).await;
    let first_submission_id = first_json["data"]["submissionId"]
        .as_str()
        .unwrap()
        .to_owned();
    let first_submitted_at = first_json["data"]["submittedAt"]
        .as_str()
        .unwrap()
        .to_owned();

    sqlx::query(
        r#"
        UPDATE student_attempts
        SET final_submission = ?
        WHERE id = ?
        "#,
    )
    .bind(json!({
        "submissionId": "tampered-submission",
        "submittedAt": first_submitted_at,
        "answers": {"q99": "tampered"},
        "writingAnswers": {},
        "flags": {}
    }))
    .bind(attempt_id.clone())
    .execute(database.pool())
    .await
    .unwrap();

    let replay = app
        .oneshot(
            with_attempt_token(Request::builder(), &attempt_token)
                .method("POST")
                .uri(format!("/api/v1/student/sessions/{}/submit", schedule_id))
                .header("content-type", "application/json")
                .header("idempotency-key", "submit-replay-1")
                .body(Body::from(
                    serde_json::to_vec(&StudentSubmitRequest {
                        attempt_id,
                        student_key: student_key.clone(),
                    })
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(replay.status(), StatusCode::OK);
    let replay_json = json_body(replay).await;
    assert_eq!(replay_json["data"], first_json["data"]);
    assert_eq!(replay_json["data"]["submissionId"], first_submission_id);

    let idempotency_count: i64 = sqlx::query_scalar(
        r#"
        SELECT COUNT(*)
        FROM idempotency_keys
        WHERE actor_id = ?
          AND route_key = ?
          AND idempotency_key = ?
        "#,
    )
    .bind(student_key)
    .bind(format!(
        "POST:/api/v1/student/sessions/{}/submit",
        schedule_id
    ))
    .bind("submit-replay-1")
    .fetch_one(database.pool())
    .await
    .unwrap();
    assert_eq!(idempotency_count, 1);

    database.shutdown().await;
}

#[tokio::test]
async fn bootstrap_hydrates_existing_attempt_after_crash_reconnect() {
    let database = mysql::TestDatabase::new(DELIVERY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();
    let (auth, student_key) = create_student_auth(database.pool(), schedule_id, "alice").await;
    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));

    let (bootstrap, client_session_id) =
        bootstrap_attempt(&app, &auth, schedule_id, "alice", &student_key).await;
    start_runtime(database.pool(), schedule_id, "listening").await;
    let attempt_id = bootstrap["data"]["attempt"]["id"].as_str().unwrap().to_owned();
    let attempt_token = bootstrap["data"]["attemptCredential"]["attemptToken"]
        .as_str()
        .unwrap()
        .to_owned();

    let mutation = app
        .clone()
        .oneshot(
            with_attempt_token(Request::builder(), &attempt_token)
                .method("POST")
                .uri(format!(
                    "/api/v1/student/sessions/{}/mutations:batch",
                    schedule_id
                ))
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&StudentMutationBatchRequest {
                        attempt_id: attempt_id.clone(),
                        student_key: student_key.clone(),
                        client_session_id,
                        mutations: vec![ielts_backend_domain::attempt::MutationEnvelope {
                            id: "mutation-1".to_owned(),
                            seq: 1,
                            timestamp: Utc.with_ymd_and_hms(2026, 1, 10, 9, 5, 0).unwrap(),
                            mutation_type: "answer".to_owned(),
                            payload: json!({"questionId": "q1", "value": "A"}),
                        }],
                    })
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(mutation.status(), StatusCode::OK);

    let (rebootstrap, _) =
        bootstrap_attempt(&app, &auth, schedule_id, "alice", &student_key).await;
    assert_eq!(
        rebootstrap["data"]["attempt"]["id"],
        attempt_id
    );
    assert_eq!(rebootstrap["data"]["attempt"]["answers"]["q1"], "A");

    database.shutdown().await;
}

#[tokio::test]
async fn mutation_batch_persists_writing_answers_separately_and_tracks_current_question_id() {
    let database = mysql::TestDatabase::new(DELIVERY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();
    let (auth, student_key) = create_student_auth(database.pool(), schedule_id, "alice").await;
    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));
    let (bootstrap, client_session_id) =
        bootstrap_attempt(&app, &auth, schedule_id, "alice", &student_key).await;
    start_runtime(database.pool(), schedule_id, "writing").await;
    let attempt_id = bootstrap["data"]["attempt"]["id"].as_str().unwrap().to_owned();
    let attempt_token = bootstrap["data"]["attemptCredential"]["attemptToken"]
        .as_str()
        .unwrap()
        .to_owned();

    let response = app
        .oneshot(
            with_attempt_token(Request::builder(), &attempt_token)
                .method("POST")
                .uri(format!(
                    "/api/v1/student/sessions/{}/mutations:batch",
                    schedule_id
                ))
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&StudentMutationBatchRequest {
                        attempt_id: attempt_id.clone(),
                        student_key: student_key.clone(),
                        client_session_id,
                        mutations: vec![
                            ielts_backend_domain::attempt::MutationEnvelope {
                                id: "mutation-1".to_owned(),
                                seq: 1,
                                timestamp: Utc.with_ymd_and_hms(2026, 1, 10, 9, 5, 0).unwrap(),
                                mutation_type: "writing_answer".to_owned(),
                                payload: json!({"taskId": "task1", "value": "Draft 1"}),
                            },
                        ],
                    })
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let json = json_body(response).await;
    assert_eq!(json["data"]["attempt"]["writingAnswers"]["task1"], "Draft 1");
    assert_eq!(json["data"]["attempt"]["answers"], json!({}));
    assert_eq!(json["data"]["attempt"]["currentQuestionId"], "task1");

    database.shutdown().await;
}

#[tokio::test]
async fn mutation_batch_rejects_objective_mutations_outside_the_current_section() {
    let database = mysql::TestDatabase::new(DELIVERY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();
    let (auth, student_key) = create_student_auth(database.pool(), schedule_id, "alice").await;
    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));
    let (bootstrap, client_session_id) =
        bootstrap_attempt(&app, &auth, schedule_id, "alice", &student_key).await;
    start_runtime(database.pool(), schedule_id, "reading").await;
    let attempt_id = bootstrap["data"]["attempt"]["id"].as_str().unwrap().to_owned();
    let attempt_token = bootstrap["data"]["attemptCredential"]["attemptToken"]
        .as_str()
        .unwrap()
        .to_owned();

    // q1 is a listening question in the seeded content snapshot.
    let response = app
        .oneshot(
            with_attempt_token(Request::builder(), &attempt_token)
                .method("POST")
                .uri(format!(
                    "/api/v1/student/sessions/{}/mutations:batch",
                    schedule_id
                ))
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&StudentMutationBatchRequest {
                        attempt_id,
                        student_key: student_key.clone(),
                        client_session_id,
                        mutations: vec![ielts_backend_domain::attempt::MutationEnvelope {
                            id: "mutation-1".to_owned(),
                            seq: 1,
                            timestamp: Utc.with_ymd_and_hms(2026, 1, 10, 9, 5, 0).unwrap(),
                            mutation_type: "answer".to_owned(),
                            payload: json!({"questionId": "q1", "value": "A"}),
                        }],
                    })
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::CONFLICT);
    let json = json_body(response).await;
    assert_eq!(json["error"]["code"], "CONFLICT");
    assert_eq!(json["error"]["details"]["reason"], "OBJECTIVE_LOCKED");

    database.shutdown().await;
}

#[tokio::test]
async fn mutation_batch_surfaces_section_mismatch_with_reason() {
    let database = mysql::TestDatabase::new(DELIVERY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();
    let (auth, student_key) = create_student_auth(database.pool(), schedule_id, "alice").await;
    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));
    let (bootstrap, client_session_id) =
        bootstrap_attempt(&app, &auth, schedule_id, "alice", &student_key).await;
    start_runtime(database.pool(), schedule_id, "listening").await;
    let attempt_id = bootstrap["data"]["attempt"]["id"].as_str().unwrap().to_owned();
    let attempt_token = bootstrap["data"]["attemptCredential"]["attemptToken"]
        .as_str()
        .unwrap()
        .to_owned();

    let response = app
        .oneshot(
            with_attempt_token(Request::builder(), &attempt_token)
                .method("POST")
                .uri(format!(
                    "/api/v1/student/sessions/{}/mutations:batch",
                    schedule_id
                ))
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&StudentMutationBatchRequest {
                        attempt_id,
                        student_key: student_key.clone(),
                        client_session_id,
                        mutations: vec![ielts_backend_domain::attempt::MutationEnvelope {
                            id: "mutation-1".to_owned(),
                            seq: 1,
                            timestamp: Utc.with_ymd_and_hms(2026, 1, 10, 9, 5, 0).unwrap(),
                            mutation_type: "writing_answer".to_owned(),
                            payload: json!({"taskId": "stale", "value": "hello"}),
                        }],
                    })
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::CONFLICT);
    let json = json_body(response).await;
    assert_eq!(json["error"]["code"], "CONFLICT");
    assert_eq!(json["error"]["details"]["reason"], "SECTION_MISMATCH");

    database.shutdown().await;
}

#[tokio::test]
async fn mutation_batch_rejects_objective_mutations_when_proctor_paused_attempt() {
    let database = mysql::TestDatabase::new(DELIVERY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();
    let (auth, student_key) = create_student_auth(database.pool(), schedule_id, "alice").await;
    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));
    let (bootstrap, client_session_id) =
        bootstrap_attempt(&app, &auth, schedule_id, "alice", &student_key).await;
    start_runtime(database.pool(), schedule_id, "listening").await;
    let attempt_id = bootstrap["data"]["attempt"]["id"].as_str().unwrap().to_owned();
    let attempt_token = bootstrap["data"]["attemptCredential"]["attemptToken"]
        .as_str()
        .unwrap()
        .to_owned();

    sqlx::query("UPDATE student_attempts SET proctor_status = 'paused' WHERE id = ?")
        .bind(&attempt_id)
        .execute(database.pool())
        .await
        .unwrap();

    let response = app
        .oneshot(
            with_attempt_token(Request::builder(), &attempt_token)
                .method("POST")
                .uri(format!(
                    "/api/v1/student/sessions/{}/mutations:batch",
                    schedule_id
                ))
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&StudentMutationBatchRequest {
                        attempt_id,
                        student_key: student_key.clone(),
                        client_session_id,
                        mutations: vec![ielts_backend_domain::attempt::MutationEnvelope {
                            id: "mutation-1".to_owned(),
                            seq: 1,
                            timestamp: Utc.with_ymd_and_hms(2026, 1, 10, 9, 5, 0).unwrap(),
                            mutation_type: "answer".to_owned(),
                            payload: json!({"questionId": "q1", "value": "A"}),
                        }],
                    })
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::CONFLICT);
    let json = json_body(response).await;
    assert_eq!(json["error"]["code"], "CONFLICT");

    database.shutdown().await;
}

#[tokio::test]
async fn mutation_batch_rejects_objective_mutations_when_runtime_paused() {
    let database = mysql::TestDatabase::new(DELIVERY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();
    let (auth, student_key) = create_student_auth(database.pool(), schedule_id, "alice").await;
    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));
    let (bootstrap, client_session_id) =
        bootstrap_attempt(&app, &auth, schedule_id, "alice", &student_key).await;
    start_runtime(database.pool(), schedule_id, "listening").await;
    let attempt_id = bootstrap["data"]["attempt"]["id"].as_str().unwrap().to_owned();
    let attempt_token = bootstrap["data"]["attemptCredential"]["attemptToken"]
        .as_str()
        .unwrap()
        .to_owned();

    sqlx::query("UPDATE exam_session_runtimes SET status = 'paused' WHERE schedule_id = ?")
        .bind(schedule_id.to_string())
        .execute(database.pool())
        .await
        .unwrap();

    let response = app
        .oneshot(
            with_attempt_token(Request::builder(), &attempt_token)
                .method("POST")
                .uri(format!(
                    "/api/v1/student/sessions/{}/mutations:batch",
                    schedule_id
                ))
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&StudentMutationBatchRequest {
                        attempt_id,
                        student_key: student_key.clone(),
                        client_session_id,
                        mutations: vec![ielts_backend_domain::attempt::MutationEnvelope {
                            id: "mutation-1".to_owned(),
                            seq: 1,
                            timestamp: Utc.with_ymd_and_hms(2026, 1, 10, 9, 5, 0).unwrap(),
                            mutation_type: "answer".to_owned(),
                            payload: json!({"questionId": "q1", "value": "A"}),
                        }],
                    })
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::CONFLICT);
    let json = json_body(response).await;
    assert_eq!(json["error"]["code"], "CONFLICT");

    database.shutdown().await;
}

#[tokio::test]
async fn violation_snapshot_is_append_only_and_client_cannot_erase_entries() {
    let database = mysql::TestDatabase::new(DELIVERY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();
    let (auth, student_key) = create_student_auth(database.pool(), schedule_id, "alice").await;
    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));
    let (bootstrap, client_session_id) =
        bootstrap_attempt(&app, &auth, schedule_id, "alice", &student_key).await;
    let attempt_id = bootstrap["data"]["attempt"]["id"].as_str().unwrap().to_owned();
    let attempt_token = bootstrap["data"]["attemptCredential"]["attemptToken"]
        .as_str()
        .unwrap()
        .to_owned();

    let first = app
        .clone()
        .oneshot(
            with_attempt_token(Request::builder(), &attempt_token)
                .method("POST")
                .uri(format!(
                    "/api/v1/student/sessions/{}/mutations:batch",
                    schedule_id
                ))
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&StudentMutationBatchRequest {
                        attempt_id: attempt_id.clone(),
                        student_key: student_key.clone(),
                        client_session_id: client_session_id.clone(),
                        mutations: vec![ielts_backend_domain::attempt::MutationEnvelope {
                            id: "mutation-1".to_owned(),
                            seq: 1,
                            timestamp: Utc.with_ymd_and_hms(2026, 1, 10, 9, 5, 0).unwrap(),
                            mutation_type: "violation".to_owned(),
                            payload: json!({
                                "violations": [{
                                    "id": "v1",
                                    "timestamp": "2026-01-10T09:05:00Z",
                                    "type": "TEST_VIOLATION"
                                }]
                            }),
                        }],
                    })
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(first.status(), StatusCode::OK);

    let second = app
        .oneshot(
            with_attempt_token(Request::builder(), &attempt_token)
                .method("POST")
                .uri(format!(
                    "/api/v1/student/sessions/{}/mutations:batch",
                    schedule_id
                ))
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&StudentMutationBatchRequest {
                        attempt_id,
                        student_key: student_key.clone(),
                        client_session_id,
                        mutations: vec![ielts_backend_domain::attempt::MutationEnvelope {
                            id: "mutation-2".to_owned(),
                            seq: 2,
                            timestamp: Utc.with_ymd_and_hms(2026, 1, 10, 9, 5, 5).unwrap(),
                            mutation_type: "violation".to_owned(),
                            payload: json!({
                                "violations": []
                            }),
                        }],
                    })
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(second.status(), StatusCode::OK);
    let json = json_body(second).await;
    assert_eq!(json["data"]["attempt"]["violationsSnapshot"].as_array().unwrap().len(), 1);
    assert_eq!(json["data"]["attempt"]["violationsSnapshot"][0]["id"], "v1");

    database.shutdown().await;
}

#[tokio::test]
async fn position_mutation_is_telemetry_only_and_does_not_change_authoritative_state() {
    let database = mysql::TestDatabase::new(DELIVERY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();
    let (auth, student_key) = create_student_auth(database.pool(), schedule_id, "alice").await;
    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));
    let (bootstrap, client_session_id) =
        bootstrap_attempt(&app, &auth, schedule_id, "alice", &student_key).await;
    start_runtime(database.pool(), schedule_id, "listening").await;
    let attempt_id = bootstrap["data"]["attempt"]["id"].as_str().unwrap().to_owned();
    let attempt_token = bootstrap["data"]["attemptCredential"]["attemptToken"]
        .as_str()
        .unwrap()
        .to_owned();

    let response = app
        .oneshot(
            with_attempt_token(Request::builder(), &attempt_token)
                .method("POST")
                .uri(format!(
                    "/api/v1/student/sessions/{}/mutations:batch",
                    schedule_id
                ))
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&StudentMutationBatchRequest {
                        attempt_id,
                        student_key: student_key.clone(),
                        client_session_id,
                        mutations: vec![ielts_backend_domain::attempt::MutationEnvelope {
                            id: "mutation-1".to_owned(),
                            seq: 1,
                            timestamp: Utc.with_ymd_and_hms(2026, 1, 10, 9, 5, 0).unwrap(),
                            mutation_type: "position".to_owned(),
                            payload: json!({
                                "phase": "post-exam",
                                "currentModule": "writing",
                                "currentQuestionId": "task1"
                            }),
                        }],
                    })
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let json = json_body(response).await;
    assert_eq!(json["data"]["attempt"]["phase"], "exam");
    assert_eq!(json["data"]["attempt"]["currentModule"], "listening");
    assert_eq!(json["data"]["attempt"]["currentQuestionId"], serde_json::Value::Null);
    assert_eq!(json["data"]["attempt"]["recovery"]["clientPosition"]["phase"], "post-exam");

    database.shutdown().await;
}

#[tokio::test]
async fn oversized_mutation_batch_is_rejected_fast() {
    let database = mysql::TestDatabase::new(DELIVERY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();
    let (auth, student_key) = create_student_auth(database.pool(), schedule_id, "alice").await;
    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));
    let (bootstrap, client_session_id) =
        bootstrap_attempt(&app, &auth, schedule_id, "alice", &student_key).await;
    let attempt_id = bootstrap["data"]["attempt"]["id"].as_str().unwrap().to_owned();
    let attempt_token = bootstrap["data"]["attemptCredential"]["attemptToken"]
        .as_str()
        .unwrap()
        .to_owned();

    let mutations: Vec<ielts_backend_domain::attempt::MutationEnvelope> = (0..201)
        .map(|index| ielts_backend_domain::attempt::MutationEnvelope {
            id: format!("mutation-{}", index + 1),
            seq: (index + 1) as i64,
            timestamp: Utc.with_ymd_and_hms(2026, 1, 10, 9, 5, 0).unwrap(),
            mutation_type: "violation".to_owned(),
            payload: json!({"violations": []}),
        })
        .collect();

    let response = app
        .oneshot(
            with_attempt_token(Request::builder(), &attempt_token)
                .method("POST")
                .uri(format!(
                    "/api/v1/student/sessions/{}/mutations:batch",
                    schedule_id
                ))
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&StudentMutationBatchRequest {
                        attempt_id,
                        student_key: student_key.clone(),
                        client_session_id,
                        mutations,
                    })
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);

    database.shutdown().await;
}

#[tokio::test]
async fn attempt_token_rejects_schedule_mismatch() {
    let database = mysql::TestDatabase::new(DELIVERY_MIGRATIONS).await;
    let schedule_a = seed_schedule_with_slug(database.pool(), "cambridge-19-academic-a").await;
    let schedule_b = seed_schedule_with_slug(database.pool(), "cambridge-19-academic-b").await;
    let schedule_a_id = Uuid::parse_str(&schedule_a.id).unwrap();
    let schedule_b_id = Uuid::parse_str(&schedule_b.id).unwrap();
    let (auth, student_key) = create_student_auth(database.pool(), schedule_a_id, "alice").await;
    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));
    let (bootstrap, client_session_id) =
        bootstrap_attempt(&app, &auth, schedule_a_id, "alice", &student_key).await;
    let attempt_id = bootstrap["data"]["attempt"]["id"].as_str().unwrap().to_owned();
    let attempt_token = bootstrap["data"]["attemptCredential"]["attemptToken"]
        .as_str()
        .unwrap()
        .to_owned();

    let response = app
        .oneshot(
            with_attempt_token(Request::builder(), &attempt_token)
                .method("POST")
                .uri(format!(
                    "/api/v1/student/sessions/{}/mutations:batch",
                    schedule_b_id
                ))
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&StudentMutationBatchRequest {
                        attempt_id,
                        student_key: student_key.clone(),
                        client_session_id,
                        mutations: vec![ielts_backend_domain::attempt::MutationEnvelope {
                            id: "mutation-1".to_owned(),
                            seq: 1,
                            timestamp: Utc.with_ymd_and_hms(2026, 1, 10, 9, 5, 0).unwrap(),
                            mutation_type: "answer".to_owned(),
                            payload: json!({"questionId": "q1", "value": "A"}),
                        }],
                    })
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::FORBIDDEN);

    database.shutdown().await;
}

async fn bootstrap_attempt(
    app: &axum::Router,
    auth: &mysql::TestAuthContext,
    schedule_id: Uuid,
    candidate_id: &str,
    student_key: &str,
) -> (serde_json::Value, String) {
    let client_session_id = Uuid::new_v4().to_string();
    bootstrap_attempt_with_client_session_id(
        app,
        auth,
        schedule_id,
        candidate_id,
        student_key,
        &client_session_id,
    )
    .await
}

async fn bootstrap_attempt_with_client_session_id(
    app: &axum::Router,
    auth: &mysql::TestAuthContext,
    schedule_id: Uuid,
    candidate_id: &str,
    student_key: &str,
    client_session_id: &str,
) -> (serde_json::Value, String) {

    // First do precheck to set up integrity with client_session_id
    let precheck_response = app
        .clone()
        .oneshot(
            auth.with_csrf(Request::builder())
                .method("POST")
                .uri(format!("/api/v1/student/sessions/{schedule_id}/precheck"))
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&StudentPrecheckRequest {
                        student_key: student_key.to_owned(),
                        candidate_id: candidate_id.to_owned(),
                        candidate_name: format!("{candidate_id} Candidate"),
                        candidate_email: format!("{candidate_id}@example.com"),
                        email: Some(format!("{candidate_id}@example.com")),
                        wcode: Some("W123456".to_owned()),
                        client_session_id: client_session_id.to_owned(),
                        pre_check: json!({
                            "completedAt": "2026-01-10T08:50:00Z",
                            "browserFamily": "chrome",
                            "checks": [{"id": "browser", "status": "pass"}]
                        }),
                        device_fingerprint_hash: Some(format!("fp-{candidate_id}")),
                    })
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(precheck_response.status(), StatusCode::OK);

    // Then call bootstrap
    let response = app
        .clone()
        .oneshot(
            auth.with_csrf(Request::builder())
                .method("POST")
                .uri(format!("/api/v1/student/sessions/{schedule_id}/bootstrap"))
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&StudentBootstrapRequest {
                        student_key: student_key.to_owned(),
                        candidate_id: candidate_id.to_owned(),
                        candidate_name: format!("{candidate_id} Candidate"),
                        candidate_email: format!("{candidate_id}@example.com"),
                        email: Some(format!("{candidate_id}@example.com")),
                        wcode: Some("W123456".to_owned()),
                        client_session_id: client_session_id.to_owned(),
                    })
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    (json_body(response).await, client_session_id.to_owned())
}

async fn create_student_auth(
    pool: &sqlx::MySqlPool,
    schedule_id: Uuid,
    candidate_id: &str,
) -> (mysql::TestAuthContext, String) {
    let auth = mysql::create_authenticated_user(
        pool,
        UserRole::Student,
        &format!("{candidate_id}@example.com"),
        &format!("{candidate_id} Candidate"),
    )
    .await;
    let student_key = mysql::create_student_registration(
        pool,
        schedule_id,
        auth.user_id,
        candidate_id,
        &format!("{candidate_id} Candidate"),
        &format!("{candidate_id}@example.com"),
    )
    .await;
    (auth, student_key)
}

fn with_attempt_token(
    builder: axum::http::request::Builder,
    token: &str,
) -> axum::http::request::Builder {
    builder.header("authorization", format!("Bearer {token}"))
}

async fn seed_schedule(pool: &sqlx::MySqlPool) -> ielts_backend_domain::schedule::ExamSchedule {
    seed_schedule_with_slug(pool, "cambridge-19-academic-delivery").await
}

async fn seed_schedule_with_slug(
    pool: &sqlx::MySqlPool,
    slug: &str,
) -> ielts_backend_domain::schedule::ExamSchedule {
    let actor = contract_actor();
    let builder_service = BuilderService::new(pool.clone());
    let exam = builder_service
        .create_exam(
            &actor,
            CreateExamRequest {
                slug: slug.to_owned(),
                title: format!("Cambridge 19 Academic Delivery ({slug})"),
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
                    "reading": {"passages": [{"id": "reading-1", "blocks": [{"type": "TFNG", "questions": [{"id": "r1"}]}]}]},
                    "listening": {"parts": [{"id": "listening-1", "blocks": [{"type": "TFNG", "questions": [{"id": "q1"}]}]}]},
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
                publish_notes: Some("ready for delivery".to_owned()),
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
                cohort_name: "Delivery Cohort".to_owned(),
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

async fn start_runtime(pool: &sqlx::MySqlPool, schedule_id: Uuid, section_key: &str) {
    sqlx::query(
        r#"
        UPDATE exam_session_runtimes
        SET
            status = 'live',
            current_section_key = ?,
            waiting_for_next_section = false,
            actual_start_at = COALESCE(actual_start_at, NOW()),
            updated_at = NOW()
        WHERE schedule_id = ?
        "#,
    )
    .bind(section_key)
    .bind(schedule_id.to_string())
    .execute(pool)
    .await
    .unwrap();
}
