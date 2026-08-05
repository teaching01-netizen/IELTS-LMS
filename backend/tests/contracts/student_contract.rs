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
    builder::BuilderService,
    grading::{GradingProjectionRequest, GradingService},
    scheduling::SchedulingService,
};
use ielts_backend_domain::{
    attempt::{
        HeartbeatEventType, MutationCommand, MutationType, StudentAuditLogRequest,
        StudentBootstrapRequest, StudentHeartbeatRequest, StudentMutationBatchRequest,
        StudentPrecheckRequest, StudentSubmitRequest,
    },
    auth::UserRole,
    exam::{CreateExamRequest, ExamType, PublishExamRequest, SaveDraftRequest, Visibility},
    schedule::{
        AttemptCommandRequest, CreateScheduleRequest, RuntimeCommandAction, RuntimeCommandRequest,
    },
};
use ielts_backend_infrastructure::{
    actor_context::{ActorContext, ActorRole},
    auth::{sign_attempt_token, AttemptTokenClaims},
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
    "0025_join_storm_admission_queue.sql",
    "0026_relax_access_code_constraints.sql",
    "0027_grading_objective_overrides.sql",
    "0028_grading_objective_grading_source.sql",
    "0029_release_events_timestamp_precision.sql",
    "0030_outbox_retry_policy.sql",
    "0031_heartbeat_events_idempotency.sql",
];

fn command(mutation_type: MutationType, payload: serde_json::Value) -> MutationCommand {
    serde_json::from_value(json!({
        "mutationType": mutation_type.as_str(),
        "payload": payload
    }))
    .expect("valid mutation command")
}

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

    let status = response.status();
    let json = json_body(response).await;
    assert_eq!(status, StatusCode::OK, "session response: {json}");
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
async fn live_session_applies_schedule_overload_backpressure() {
    let database = mysql::TestDatabase::new(DELIVERY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();
    let (auth, _student_key) = create_student_auth(database.pool(), schedule_id, "alice").await;
    let mut config = AppConfig::default();
    config.rate_limit_student_live_per_schedule = 1;
    config.rate_limit_student_live_per_schedule_window_secs = 60;
    config.rate_limit_student_live_global = 100;
    config.rate_limit_student_live_global_window_secs = 60;
    let app = build_router(AppState::with_pool(config, database.pool().clone()));

    let first = app
        .clone()
        .oneshot(
            auth.with_auth(Request::builder().uri(format!(
                "/api/v1/student/sessions/{schedule_id}/live?candidateId=alice"
            )))
            .body(Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(first.status(), StatusCode::OK);

    let limited = app
        .oneshot(
            auth.with_auth(Request::builder().uri(format!(
                "/api/v1/student/sessions/{schedule_id}/live?candidateId=alice"
            )))
            .body(Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(limited.status(), StatusCode::TOO_MANY_REQUESTS);
    let json = json_body(limited).await;
    assert_eq!(json["success"], false);
    assert_eq!(json["error"]["code"], "RATE_LIMIT_EXCEEDED");
    assert_eq!(json["error"]["details"]["scope"], "schedule");

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

    assert_eq!(json["data"]["studentKey"], student_key);
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
async fn precheck_replays_same_idempotency_key_and_rejects_hash_mismatch() {
    let database = mysql::TestDatabase::new(DELIVERY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();
    let (auth, student_key) = create_student_auth(database.pool(), schedule_id, "alice").await;
    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));

    let request = StudentPrecheckRequest {
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
    };

    let first = app
        .clone()
        .oneshot(
            auth.with_csrf(Request::builder())
                .method("POST")
                .uri(format!("/api/v1/student/sessions/{}/precheck", schedule_id))
                .header("content-type", "application/json")
                .header("idempotency-key", "precheck-replay-1")
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
            auth.with_csrf(Request::builder())
                .method("POST")
                .uri(format!("/api/v1/student/sessions/{}/precheck", schedule_id))
                .header("content-type", "application/json")
                .header("idempotency-key", "precheck-replay-1")
                .body(Body::from(serde_json::to_vec(&request).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(replay.status(), StatusCode::OK);
    let replay_json = json_body(replay).await;
    assert_eq!(replay_json["data"], first_json["data"]);

    let attempt_id = first_json["data"]["id"].as_str().unwrap().to_owned();
    let precheck_audit_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM session_audit_logs WHERE schedule_id = ? AND target_student_id = ? AND action_type = 'STUDENT_PRECHECK'",
    )
    .bind(schedule_id.to_string())
    .bind(&attempt_id)
    .fetch_one(database.pool())
    .await
    .unwrap();
    assert_eq!(precheck_audit_count, 1);

    let conflict_payload = StudentPrecheckRequest {
        pre_check: json!({
            "completedAt": "2026-01-10T08:51:00Z",
            "browserFamily": "firefox",
            "checks": [{"id": "browser", "status": "pass"}]
        }),
        ..request
    };
    let conflict = app
        .oneshot(
            auth.with_csrf(Request::builder())
                .method("POST")
                .uri(format!("/api/v1/student/sessions/{}/precheck", schedule_id))
                .header("content-type", "application/json")
                .header("idempotency-key", "precheck-replay-1")
                .body(Body::from(serde_json::to_vec(&conflict_payload).unwrap()))
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
async fn precheck_derives_identity_from_enrollment_not_request_body() {
    let database = mysql::TestDatabase::new(DELIVERY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();
    let (auth, student_key) = create_student_auth(database.pool(), schedule_id, "alice").await;
    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));

    // The body claims a DIFFERENT candidate ("mallory") than the enrolled
    // "alice" whose session is authenticated. Identity must come from the
    // authorized enrollment, not from the request fields.
    let response = app
        .oneshot(
            auth.with_csrf(Request::builder())
                .method("POST")
                .uri(format!("/api/v1/student/sessions/{}/precheck", schedule_id))
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&StudentPrecheckRequest {
                        student_key: format!("student-{schedule_id}-mallory"),
                        candidate_id: "mallory".to_owned(),
                        candidate_name: "Mallory Q".to_owned(),
                        candidate_email: "mallory@example.com".to_owned(),
                        email: Some("mallory@example.com".to_owned()),
                        wcode: Some("WMALLORY".to_owned()),
                        client_session_id: Uuid::new_v4().to_string(),
                        pre_check: json!({
                            "completedAt": "2026-01-10T08:50:00Z",
                            "browserFamily": "chrome",
                            "checks": [{"id": "browser", "status": "pass"}]
                        }),
                        device_fingerprint_hash: Some("fp-mallory-device".to_owned()),
                    })
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let json = json_body(response).await;

    // The authoritative attempt reflects the ENROLLED identity (alice),
    // not the "mallory" claims in the body.
    assert_eq!(json["data"]["studentKey"], student_key);
    assert_eq!(json["data"]["candidateId"], "alice");
    assert_eq!(json["data"]["candidateName"], "alice Candidate");
    assert_eq!(json["data"]["candidateEmail"], "alice@example.com");
    assert_eq!(json["data"]["phase"], "lobby");

    // The persisted attempt row carries the enrolled identity as well.
    let (row_candidate_id, row_candidate_name, row_candidate_email, row_student_key): (
        String,
        String,
        String,
        String,
    ) = sqlx::query_as(
        "SELECT candidate_id, candidate_name, candidate_email, student_key FROM student_attempts WHERE schedule_id = ?",
    )
    .bind(schedule_id.to_string())
    .fetch_one(database.pool())
    .await
    .unwrap();
    assert_eq!(row_candidate_id, "alice");
    assert_eq!(row_candidate_name, "alice Candidate");
    assert_eq!(row_candidate_email, "alice@example.com");
    assert_eq!(row_student_key, student_key);

    // Exactly one audit event, attributed to the enrolled identity.
    let precheck_audit_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM session_audit_logs WHERE schedule_id = ? AND action_type = 'STUDENT_PRECHECK'",
    )
    .bind(schedule_id.to_string())
    .fetch_one(database.pool())
    .await
    .unwrap();
    assert_eq!(precheck_audit_count, 1);
    let audit_actor: String = sqlx::query_scalar(
        "SELECT actor FROM session_audit_logs WHERE schedule_id = ? AND action_type = 'STUDENT_PRECHECK'",
    )
    .bind(schedule_id.to_string())
    .fetch_one(database.pool())
    .await
    .unwrap();
    assert_eq!(audit_actor, "alice Candidate");

    // Device fingerprint and check results are persisted, both in the
    // response and at the DB level.
    assert_eq!(
        json["data"]["integrity"]["deviceFingerprintHash"],
        "fp-mallory-device"
    );
    assert_eq!(
        json["data"]["integrity"]["preCheck"]["completedAt"],
        "2026-01-10T08:50:00Z"
    );
    let db_integrity: serde_json::Value = sqlx::query_scalar(
        "SELECT integrity FROM student_attempts WHERE schedule_id = ?",
    )
    .bind(schedule_id.to_string())
    .fetch_one(database.pool())
    .await
    .unwrap();
    assert_eq!(db_integrity["deviceFingerprintHash"], "fp-mallory-device");
    assert_eq!(db_integrity["preCheck"]["checks"][0]["id"], "browser");

    // The response returns the authoritative attempt (same persisted row).
    let row_id: String = sqlx::query_scalar("SELECT id FROM student_attempts WHERE schedule_id = ?")
        .bind(schedule_id.to_string())
        .fetch_one(database.pool())
        .await
        .unwrap();
    assert_eq!(json["data"]["id"], row_id);

    database.shutdown().await;
}

#[tokio::test]
async fn precheck_retry_after_timeout_keeps_attempt_singular() {
    let database = mysql::TestDatabase::new(DELIVERY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();
    let (auth, student_key) = create_student_auth(database.pool(), schedule_id, "alice").await;
    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));

    let request = StudentPrecheckRequest {
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
    };
    let idempotency_key = "precheck-timeout-retry-1";

    let first = app
        .clone()
        .oneshot(
            auth.with_csrf(Request::builder())
                .method("POST")
                .uri(format!("/api/v1/student/sessions/{}/precheck", schedule_id))
                .header("content-type", "application/json")
                .header("idempotency-key", idempotency_key)
                .body(Body::from(serde_json::to_vec(&request).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(first.status(), StatusCode::OK);
    let first_json = json_body(first).await;
    let attempt_id = first_json["data"]["id"].as_str().unwrap().to_owned();

    // Client timeout: the client never saw the first response and retries
    // with the same key and payload. The attempt must remain valid and
    // singular.
    let retry = app
        .oneshot(
            auth.with_csrf(Request::builder())
                .method("POST")
                .uri(format!("/api/v1/student/sessions/{}/precheck", schedule_id))
                .header("content-type", "application/json")
                .header("idempotency-key", idempotency_key)
                .body(Body::from(serde_json::to_vec(&request).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(retry.status(), StatusCode::OK);
    let retry_json = json_body(retry).await;
    assert_eq!(retry_json["data"]["id"], attempt_id);
    assert_eq!(retry_json["data"], first_json["data"]);

    let attempt_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM student_attempts WHERE schedule_id = ?",
    )
    .bind(schedule_id.to_string())
    .fetch_one(database.pool())
    .await
    .unwrap();
    assert_eq!(attempt_count, 1, "retry must not create a second attempt");

    let audit_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM session_audit_logs WHERE schedule_id = ? AND action_type = 'STUDENT_PRECHECK'",
    )
    .bind(schedule_id.to_string())
    .fetch_one(database.pool())
    .await
    .unwrap();
    assert_eq!(audit_count, 1, "retry must not duplicate the audit event");

    database.shutdown().await;
}

#[tokio::test]
async fn precheck_concurrent_identical_requests_yield_one_logical_result() {
    let database = mysql::TestDatabase::new(DELIVERY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();
    let (auth, student_key) = create_student_auth(database.pool(), schedule_id, "alice").await;
    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));

    let request = StudentPrecheckRequest {
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
    };
    let idempotency_key = "precheck-race-1";

    // Two identical requests in flight at once: the UNIQUE constraints on
    // student_attempts(schedule_id, student_key) and idempotency_keys
    // (actor_id, route_key, idempotency_key) mean at most one of them can
    // win the writes. The contract is one logical result: no duplicate
    // attempt, no duplicate audit, no 500.
    let first = app.clone().oneshot(
        auth.with_csrf(Request::builder())
            .method("POST")
            .uri(format!("/api/v1/student/sessions/{}/precheck", schedule_id))
            .header("content-type", "application/json")
            .header("idempotency-key", idempotency_key)
            .body(Body::from(serde_json::to_vec(&request).unwrap()))
            .unwrap(),
    );
    let second = app.clone().oneshot(
        auth.with_csrf(Request::builder())
            .method("POST")
            .uri(format!("/api/v1/student/sessions/{}/precheck", schedule_id))
            .header("content-type", "application/json")
            .header("idempotency-key", idempotency_key)
            .body(Body::from(serde_json::to_vec(&request).unwrap()))
            .unwrap(),
    );
    let (first, second) = tokio::join!(first, second);
    let first = first.unwrap();
    let second = second.unwrap();

    let first_status = first.status();
    let second_status = second.status();
    let first_json = json_body(first).await;
    let second_json = json_body(second).await;
    assert_eq!(
        first_status,
        StatusCode::OK,
        "concurrent precheck must not 500: {first_json}"
    );
    assert_eq!(
        second_status,
        StatusCode::OK,
        "concurrent precheck must not 500: {second_json}"
    );
    assert_eq!(
        first_json["data"]["id"], second_json["data"]["id"],
        "both responses must reference the same attempt"
    );
    assert_eq!(first_json["data"], second_json["data"]);

    let attempt_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM student_attempts WHERE schedule_id = ?",
    )
    .bind(schedule_id.to_string())
    .fetch_one(database.pool())
    .await
    .unwrap();
    assert_eq!(attempt_count, 1, "race must leave exactly one attempt row");

    let audit_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM session_audit_logs WHERE schedule_id = ? AND action_type = 'STUDENT_PRECHECK'",
    )
    .bind(schedule_id.to_string())
    .fetch_one(database.pool())
    .await
    .unwrap();
    assert_eq!(audit_count, 1, "race must leave exactly one audit event");

    // The attempt-created audit is written only by the winner of the attempt
    // INSERT (the loser adopts the existing row and returns before it); pin
    // that it stays singular under the race.
    let attempt_created_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM session_audit_logs WHERE schedule_id = ? AND target_student_id = ? AND action_type = 'STUDENT_ATTEMPT_CREATED'",
    )
    .bind(schedule_id.to_string())
    .bind(first_json["data"]["id"].as_str().unwrap().to_owned())
    .fetch_one(database.pool())
    .await
    .unwrap();
    assert_eq!(
        attempt_created_count, 1,
        "race must leave exactly one attempt-created audit"
    );

    database.shutdown().await;
}

#[tokio::test]
async fn precheck_does_not_start_runtime_or_expose_section_state() {
    let database = mysql::TestDatabase::new(DELIVERY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();
    let (auth, student_key) = create_student_auth(database.pool(), schedule_id, "alice").await;
    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));

    let response = app
        .clone()
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
    assert_eq!(json["data"]["phase"], "lobby");

    // Pre-check must not start the exam runtime: no runtime row exists at
    // all (the runtime row is only created by the proctor's StartRuntime
    // command; until then the API synthesizes a "not_started" runtime).
    let runtime_row_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM exam_session_runtimes WHERE schedule_id = ?",
    )
    .bind(schedule_id.to_string())
    .fetch_one(database.pool())
    .await
    .unwrap();
    assert_eq!(
        runtime_row_count, 0,
        "pre-check must not create or start the runtime row"
    );

    // Pre-check must not set section availability or deadlines: no runtime
    // sections exist either.
    let started_sections: i64 = sqlx::query_scalar(
        r#"
        SELECT COUNT(*)
        FROM exam_session_runtime_sections s
        JOIN exam_session_runtimes r ON r.id = s.runtime_id
        WHERE r.schedule_id = ?
          AND (s.status <> 'locked' OR s.available_at IS NOT NULL OR s.actual_start_at IS NOT NULL)
        "#,
    )
    .bind(schedule_id.to_string())
    .fetch_one(database.pool())
    .await
    .unwrap();
    assert_eq!(
        started_sections, 0,
        "pre-check must not set any section deadline"
    );

    // The live context — the only student endpoint that carries
    // running-exam section state — must still report the waiting room:
    // runtime not started, no deadline, attempt still in the lobby.
    // (The API surface has no dedicated section-content route; section
    // state is only reachable through the runtime in this context.)
    let live = app
        .oneshot(
            auth.with_auth(Request::builder().uri(format!(
                "/api/v1/student/sessions/{schedule_id}/live?candidateId=alice"
            )))
            .body(Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(live.status(), StatusCode::OK);
    let live_json = json_body(live).await;
    assert_eq!(live_json["data"]["runtime"]["status"], "not_started");
    assert_eq!(live_json["data"]["attempt"]["phase"], "lobby");
    assert_eq!(
        live_json["data"]["runtime"]["activeSectionKey"],
        serde_json::Value::Null
    );
    assert_eq!(
        live_json["data"]["runtime"]["currentSectionKey"],
        serde_json::Value::Null
    );
    assert_eq!(
        live_json["data"]["runtime"]["currentSectionDeadlineAt"],
        serde_json::Value::Null
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

    assert_eq!(json["data"]["attempt"]["studentKey"], student_key);
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
    SchedulingService::new(database.pool().clone())
        .apply_runtime_command(
            &contract_actor(),
            schedule_id,
            RuntimeCommandRequest {
                action: RuntimeCommandAction::StartRuntime,
                reason: Some("contract runtime start".to_owned()),
            },
        )
        .await
        .unwrap();
    let attempt_id = bootstrap["data"]["attempt"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let attempt_token = bootstrap["data"]["attemptCredential"]["attemptToken"]
        .as_str()
        .unwrap()
        .to_owned();
    let base_revision = bootstrap["data"]["attempt"]["revision"]
        .as_i64()
        .unwrap() as i32;

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
                    serde_json::to_vec(&json!({
                        "attemptId": attempt_id.clone(),
                        "mutations": [
                            {
                                "mutationId": "mutation-1",
                                "baseRevision": base_revision,
                                "type": "SetScalar",
                                "questionId": "q1",
                                "value": "A"
                            }
                        ]
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let json = json_body(response).await;
    assert_eq!(json["data"]["appliedMutationCount"], 1);
    assert_eq!(json["data"]["serverAcceptedThroughSeq"], 1);
    assert_eq!(json["data"]["attempt"]["answers"]["q1"], "A");
    assert_eq!(json["data"]["attempt"]["recovery"]["syncState"], "saved");

    database.shutdown().await;
}

#[tokio::test]
async fn sentence_completion_student_answers_remain_array_backed_per_question() {
    let database = mysql::TestDatabase::new(DELIVERY_MIGRATIONS).await;
    let schedule = seed_schedule_with_slug_content_and_config(
        database.pool(),
        "cambridge-19-academic-sentence-array-contract",
        delivery_block_matrix_content_snapshot(),
        sample_delivery_config(),
    )
    .await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();
    let (auth, student_key) = create_student_auth(database.pool(), schedule_id, "alice").await;
    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));
    let (bootstrap, _client_session_id) =
        bootstrap_attempt(&app, &auth, schedule_id, "alice", &student_key).await;
    start_runtime(database.pool(), schedule_id, "reading").await;

    let attempt_id = bootstrap["data"]["attempt"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let attempt_token = bootstrap["data"]["attemptCredential"]["attemptToken"]
        .as_str()
        .unwrap()
        .to_owned();
    let base_revision = bootstrap["data"]["attempt"]["revision"]
        .as_i64()
        .unwrap() as i32;

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
                    serde_json::to_vec(&json!({
                        "attemptId": attempt_id,
                        "mutations": [{
                            "mutationId": "sentence-array-1",
                            "baseRevision": base_revision,
                            "type": "SetChoice",
                            "questionId": "r-sentence-q1",
                            "value": ["first", "second"]
                        }]
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    let status = response.status();
    let json = json_body(response).await;
    assert_eq!(status, StatusCode::OK, "sentence mutation response: {json}");
    assert_eq!(json["data"]["attempt"]["answers"]["r-sentence-q1"], json!(["first", "second"]));

    database.shutdown().await;
}

#[tokio::test]
async fn mutation_batch_returns_full_commit_payload() {
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
    SchedulingService::new(database.pool().clone())
        .apply_runtime_command(
            &contract_actor(),
            schedule_id,
            RuntimeCommandRequest {
                action: RuntimeCommandAction::StartRuntime,
                reason: Some("contract runtime start".to_owned()),
            },
        )
        .await
        .unwrap();
    let attempt_id = bootstrap["data"]["attempt"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let attempt_token = bootstrap["data"]["attemptCredential"]["attemptToken"]
        .as_str()
        .unwrap()
        .to_owned();
    let base_revision = bootstrap["data"]["attempt"]["revision"]
        .as_i64()
        .unwrap() as i32;

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
                    serde_json::to_vec(&json!({
                        "attemptId": attempt_id,
                        "mutations": [{
                            "mutationId": "mutation-ack-1",
                            "baseRevision": base_revision,
                            "type": "SetScalar",
                            "questionId": "q1",
                            "value": "A"
                        }]
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let json = json_body(response).await;

    assert_eq!(json["data"]["appliedMutationCount"], 1);
    assert_eq!(json["data"]["serverAcceptedThroughSeq"], 1);
    assert_eq!(json["data"]["revision"], base_revision + 1);
    assert!(json["data"].get("attempt").is_some());

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

    let attempt_id = bootstrap_phone["data"]["attempt"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    assert_eq!(bootstrap_computer["data"]["attempt"]["id"], attempt_id);
    let attempt_token_phone = bootstrap_phone["data"]["attemptCredential"]["attemptToken"]
        .as_str()
        .unwrap()
        .to_owned();
    let attempt_token_computer = bootstrap_computer["data"]["attemptCredential"]["attemptToken"]
        .as_str()
        .unwrap()
        .to_owned();
    let base_revision = bootstrap_phone["data"]["attempt"]["revision"]
        .as_i64()
        .unwrap() as i32;

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
                    serde_json::to_vec(&json!({
                        "attemptId": attempt_id.clone(),
                        "mutations": [{
                            "mutationId": "mutation-1",
                            "baseRevision": base_revision,
                            "type": "SetScalar",
                            "questionId": "q1",
                            "value": "A"
                        }]
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(first.status(), StatusCode::OK);
    // Session B is an independent client session writing a DIFFERENT
    // question. Under the base-revision gate (BEX-003/BEX-032) it must base
    // its batch on the CURRENT revision (post-A), not the bootstrap one —
    // the contract being verified is that independent sections can both
    // persist, not that stale bases are tolerated.
    let first_json = json_body(first).await;
    let revision_after_first = first_json["data"]["revision"].as_i64().unwrap() as i32;
    assert!(revision_after_first >= base_revision + 1);

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
                    serde_json::to_vec(&json!({
                        "attemptId": attempt_id.clone(),
                        "mutations": [{
                            "mutationId": "mutation-2",
                            "baseRevision": revision_after_first,
                            "type": "SetScalar",
                            "questionId": "r1",
                            "value": "B"
                        }]
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(second.status(), StatusCode::OK);

    let answers: serde_json::Value =
        sqlx::query_scalar("SELECT answers FROM student_attempts WHERE id = ?")
            .bind(&attempt_id)
            .fetch_one(database.pool())
            .await
            .unwrap();

    assert_eq!(answers["q1"], "A");
    assert_eq!(answers["r1"], "B");

    database.shutdown().await;
}

// BEX-033 contract: an idempotent mutation-batch replay must return the
// cached stable response (200), a hash-mismatched batch with the same key must
// conflict (409), and neither path may mutate persisted state.
#[tokio::test]
async fn mutation_batch_idempotency_replay_returns_stable_response_and_hash_mismatch_conflicts() {
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
    start_runtime(database.pool(), schedule_id, "listening").await;
    let attempt_id = bootstrap["data"]["attempt"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let attempt_token = bootstrap["data"]["attemptCredential"]["attemptToken"]
        .as_str()
        .unwrap()
        .to_owned();
    let base_revision = bootstrap["data"]["attempt"]["revision"]
        .as_i64()
        .unwrap() as i32;
    let uri = format!("/api/v1/student/sessions/{schedule_id}/mutations:batch");
    let request = json!({
        "attemptId": attempt_id.clone(),
        "mutations": [
            {
                "mutationId": "mutation-1",
                "baseRevision": base_revision,
                "type": "SetScalar",
                "questionId": "q1",
                "value": "A"
            },
            {
                "mutationId": "mutation-2",
                "baseRevision": base_revision,
                "type": "SetScalar",
                "questionId": "q1",
                "value": "B"
            }
        ]
    });
    let request_body = serde_json::to_vec(&request).unwrap();

    let post = |body: Vec<u8>| {
        let app = app.clone();
        let attempt_token = attempt_token.clone();
        let uri = uri.clone();
        async move {
            app.oneshot(
                with_attempt_token(Request::builder(), &attempt_token)
                    .method("POST")
                    .uri(uri)
                    .header("content-type", "application/json")
                    .header("idempotency-key", "mutation-replay-1")
                    .body(Body::from(body))
                    .unwrap(),
            )
            .await
            .unwrap()
        }
    };

    // First request: fully applied.
    let first = post(request_body.clone()).await;
    assert_eq!(first.status(), StatusCode::OK);
    let first_json = json_body(first).await;
    assert_eq!(first_json["data"]["appliedMutationCount"], 2);
    assert_eq!(first_json["data"]["serverAcceptedThroughSeq"], 2);
    assert_eq!(
        first_json["data"]["revision"],
        base_revision as i64 + 1,
        "one accepted batch advances the revision exactly once"
    );
    let first_data = first_json["data"].clone();

    // The idempotent response was persisted for the key, so the replay below
    // is served from cache instead of being re-applied.
    let stored_status: i32 = sqlx::query_scalar(
        "SELECT response_status FROM idempotency_keys WHERE actor_id = ? AND route_key = ? AND idempotency_key = ?",
    )
    .bind(&student_key)
    .bind(format!("POST:/api/v1/student/sessions/{schedule_id}/mutations:batch"))
    .bind("mutation-replay-1")
    .fetch_one(database.pool())
    .await
    .unwrap();
    assert_eq!(stored_status, 200);

    // Byte-identical replay with the same key: stable 200, same body, and no
    // database change.
    let replay = post(request_body).await;
    let replay_status = replay.status();
    let replay_json = json_body(replay).await;
    assert_eq!(
        replay_status,
        StatusCode::OK,
        "identical replay must return the cached response, not a conflict: {replay_json}"
    );
    assert_eq!(replay_json["data"].clone(), first_data);
    let mutation_rows: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM student_attempt_mutations WHERE attempt_id = ?")
            .bind(&attempt_id)
            .fetch_one(database.pool())
            .await
            .unwrap();
    assert_eq!(mutation_rows, 2, "replay must not duplicate mutation rows");
    let stored_revision: i32 =
        sqlx::query_scalar("SELECT revision FROM student_attempts WHERE id = ?")
            .bind(&attempt_id)
            .fetch_one(database.pool())
            .await
            .unwrap();
    assert_eq!(stored_revision, base_revision + 1);
    let answers: serde_json::Value =
        sqlx::query_scalar("SELECT answers FROM student_attempts WHERE id = ?")
            .bind(&attempt_id)
            .fetch_one(database.pool())
            .await
            .unwrap();
    assert_eq!(answers["q1"], "B", "the batch applied both mutations in order");

    // Same key with a DIFFERENT batch: 409 hash-mismatch conflict, and the
    // rejected batch must not change any persisted state.
    let conflict = post(
        serde_json::to_vec(&json!({
            "attemptId": attempt_id.clone(),
            "mutations": [{
                "mutationId": "mutation-3",
                "baseRevision": base_revision,
                "type": "SetScalar",
                "questionId": "q3",
                "value": "C"
            }]
        }))
        .unwrap(),
    )
    .await;
    let conflict_status = conflict.status();
    let conflict_json = json_body(conflict).await;
    assert_eq!(conflict_status, StatusCode::CONFLICT);
    assert_eq!(conflict_json["error"]["code"], "CONFLICT");
    assert_eq!(
        conflict_json["error"]["message"],
        "Idempotency-Key does not match the original request."
    );
    let mutation_rows_after_conflict: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM student_attempt_mutations WHERE attempt_id = ?",
    )
    .bind(&attempt_id)
    .fetch_one(database.pool())
    .await
    .unwrap();
    assert_eq!(mutation_rows_after_conflict, 2);

    database.shutdown().await;
}

// BEX-032: a mutation batch based on a stale revision is rejected atomically
// with 409 CONFLICT / `BASE_REVISION_MISMATCH` carrying `latestRevision` and
// the accepted mutation-sequence watermark (`serverAcceptedThroughSeq`), and
// the server's persisted answers, revision, and mutation rows are preserved.
#[tokio::test]
async fn mutation_batch_revision_conflict_reports_latest_revision_and_watermark_and_preserves_server_answers() {
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
    let attempt_id = bootstrap["data"]["attempt"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let attempt_token = bootstrap["data"]["attemptCredential"]["attemptToken"]
        .as_str()
        .unwrap()
        .to_owned();
    let base_revision = bootstrap["data"]["attempt"]["revision"]
        .as_i64()
        .unwrap() as i32;
    let uri = format!("/api/v1/student/sessions/{schedule_id}/mutations:batch");

    // Accepted batch: q1 = "A", revision N -> N+1, watermark -> 1.
    let accepted = app
        .clone()
        .oneshot(
            with_attempt_token(Request::builder(), &attempt_token)
                .method("POST")
                .uri(&uri)
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "attemptId": attempt_id.clone(),
                        "mutations": [{
                            "mutationId": "bex032-mut-1",
                            "baseRevision": base_revision,
                            "type": "SetScalar",
                            "questionId": "q1",
                            "value": "A"
                        }]
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(accepted.status(), StatusCode::OK);
    let accepted_json = json_body(accepted).await;
    assert_eq!(accepted_json["data"]["appliedMutationCount"], 1);
    assert_eq!(accepted_json["data"]["serverAcceptedThroughSeq"], 1);
    let revision_after = accepted_json["data"]["revision"].as_i64().unwrap();
    assert_eq!(revision_after, base_revision as i64 + 1);

    // Snapshot the authoritative persisted state after the accepted batch.
    let answers_snapshot: serde_json::Value =
        sqlx::query_scalar("SELECT answers FROM student_attempts WHERE id = ?")
            .bind(&attempt_id)
            .fetch_one(database.pool())
            .await
            .unwrap();
    assert_eq!(answers_snapshot["q1"], "A");

    // Stale batch from the same session: baseRevision = N is now below the
    // current revision N+1.
    let conflict = app
        .oneshot(
            with_attempt_token(Request::builder(), &attempt_token)
                .method("POST")
                .uri(&uri)
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "attemptId": attempt_id.clone(),
                        "mutations": [{
                            "mutationId": "bex032-mut-2",
                            "baseRevision": base_revision,
                            "type": "SetScalar",
                            "questionId": "q1",
                            "value": "B"
                        }]
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let conflict_status = conflict.status();
    let conflict_json = json_body(conflict).await;
    assert_eq!(
        conflict_status,
        StatusCode::CONFLICT,
        "stale batch must conflict: {conflict_json}"
    );
    assert_eq!(conflict_json["error"]["code"], "CONFLICT");
    assert_eq!(
        conflict_json["error"]["details"]["reason"],
        "BASE_REVISION_MISMATCH"
    );
    assert_eq!(
        conflict_json["error"]["details"]["latestRevision"]
            .as_i64()
            .unwrap(),
        revision_after,
        "conflict must report the attempt's current revision"
    );
    assert_eq!(
        conflict_json["error"]["details"]["serverAcceptedThroughSeq"]
            .as_i64()
            .unwrap(),
        1,
        "conflict must report the accepted mutation-sequence watermark"
    );
    assert_eq!(
        conflict_json["error"]["details"]["activeSessionId"],
        client_session_id,
        "conflict must identify the session that owns the accepted state"
    );

    // DB-level: the server's current answers are preserved byte-for-byte.
    let answers_after: serde_json::Value =
        sqlx::query_scalar("SELECT answers FROM student_attempts WHERE id = ?")
            .bind(&attempt_id)
            .fetch_one(database.pool())
            .await
            .unwrap();
    assert_eq!(
        answers_after, answers_snapshot,
        "a rejected stale batch must not change the persisted answers"
    );
    assert_eq!(answers_after["q1"], "A");
    let stored_revision: i32 =
        sqlx::query_scalar("SELECT revision FROM student_attempts WHERE id = ?")
            .bind(&attempt_id)
            .fetch_one(database.pool())
            .await
            .unwrap();
    assert_eq!(
        stored_revision, revision_after as i32,
        "a rejected stale batch must not advance the revision"
    );
    let mutation_rows: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM student_attempt_mutations WHERE attempt_id = ?")
            .bind(&attempt_id)
            .fetch_one(database.pool())
            .await
            .unwrap();
    assert_eq!(
        mutation_rows, 1,
        "a rejected stale batch must not persist any mutation row"
    );

    database.shutdown().await;
}

// BEX-033: the same idempotency key with an identical batch applies exactly
// once (one row per client mutation id, revision advanced once), and every
// retry — including a retry framed as a network timeout, where the client
// re-sends the same batch after (possibly) never seeing the response —
// returns the stable cached response and changes nothing in the database.
#[tokio::test]
async fn mutation_batch_same_key_identical_batch_applies_once_and_retry_after_timeout_does_not_duplicate() {
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
    start_runtime(database.pool(), schedule_id, "listening").await;
    let attempt_id = bootstrap["data"]["attempt"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let attempt_token = bootstrap["data"]["attemptCredential"]["attemptToken"]
        .as_str()
        .unwrap()
        .to_owned();
    let base_revision = bootstrap["data"]["attempt"]["revision"]
        .as_i64()
        .unwrap() as i32;
    let uri = format!("/api/v1/student/sessions/{schedule_id}/mutations:batch");
    let request = json!({
        "attemptId": attempt_id.clone(),
        "mutations": [{
            "mutationId": "mutation-timeout-1",
            "baseRevision": base_revision,
            "type": "SetScalar",
            "questionId": "q1",
            "value": "A"
        }]
    });
    let request_body = serde_json::to_vec(&request).unwrap();

    let post = |body: Vec<u8>| {
        let app = app.clone();
        let attempt_token = attempt_token.clone();
        let uri = uri.clone();
        async move {
            app.oneshot(
                with_attempt_token(Request::builder(), &attempt_token)
                    .method("POST")
                    .uri(uri)
                    .header("content-type", "application/json")
                    .header("idempotency-key", "mutation-timeout-key-1")
                    .body(Body::from(body))
                    .unwrap(),
            )
            .await
            .unwrap()
        }
    };

    // First attempt — the client times out and never sees this response.
    let first = post(request_body.clone()).await;
    assert_eq!(first.status(), StatusCode::OK);
    let first_json = json_body(first).await;
    assert_eq!(first_json["data"]["appliedMutationCount"], 1);
    assert_eq!(first_json["data"]["serverAcceptedThroughSeq"], 1);
    let first_data = first_json["data"].clone();

    // Applied exactly once at the row level.
    let per_id_rows: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM student_attempt_mutations WHERE attempt_id = ? AND client_mutation_id = ?",
    )
    .bind(&attempt_id)
    .bind("mutation-timeout-1")
    .fetch_one(database.pool())
    .await
    .unwrap();
    assert_eq!(per_id_rows, 1, "the same mutation id must be applied at most once");
    let stored_revision: i32 =
        sqlx::query_scalar("SELECT revision FROM student_attempts WHERE id = ?")
            .bind(&attempt_id)
            .fetch_one(database.pool())
            .await
            .unwrap();
    assert_eq!(stored_revision, base_revision + 1, "revision advanced exactly once");

    // Retry after the "timeout": identical body, same key — stable response,
    // no duplicate answer write.
    let retry = post(request_body).await;
    let retry_status = retry.status();
    let retry_json = json_body(retry).await;
    assert_eq!(
        retry_status,
        StatusCode::OK,
        "retry after timeout must succeed: {retry_json}"
    );
    assert_eq!(retry_json["data"].clone(), first_data);
    let answers: serde_json::Value =
        sqlx::query_scalar("SELECT answers FROM student_attempts WHERE id = ?")
            .bind(&attempt_id)
            .fetch_one(database.pool())
            .await
            .unwrap();
    assert_eq!(answers["q1"], "A", "the retry must not duplicate the answer write");
    let per_id_rows_after_retry: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM student_attempt_mutations WHERE attempt_id = ? AND client_mutation_id = ?",
    )
    .bind(&attempt_id)
    .bind("mutation-timeout-1")
    .fetch_one(database.pool())
    .await
    .unwrap();
    assert_eq!(per_id_rows_after_retry, 1);
    let stored_revision_after_retry: i32 =
        sqlx::query_scalar("SELECT revision FROM student_attempts WHERE id = ?")
            .bind(&attempt_id)
            .fetch_one(database.pool())
            .await
            .unwrap();
    assert_eq!(stored_revision_after_retry, base_revision + 1);

    // A second retry is equally stable.
    let retry_2 = post(serde_json::to_vec(&request).unwrap()).await;
    assert_eq!(retry_2.status(), StatusCode::OK);
    assert_eq!(json_body(retry_2).await["data"].clone(), first_data);

    database.shutdown().await;
}

// BEX-033 cross-session: the in-batch dedupe is scoped per
// (attempt_id, client_session_id, client_mutation_id), so a duplicate mutation
// id arriving from ANOTHER client session is not deduped by id — ownership is
// enforced by the base-revision gate (BEX-003): a second session composing its
// batch from state older than the current revision is rejected atomically with
// 409 BASE_REVISION_MISMATCH, so the mutation id is never applied twice. A
// second session with a FRESH base is blocked by the physical unique index
// (attempt_id, client_mutation_id) (migration 0017) with an atomic 500
// DATABASE_ERROR instead of re-applying.
#[tokio::test]
async fn mutation_batch_duplicate_mutation_id_from_other_client_session_is_not_applied_twice() {
    let database = mysql::TestDatabase::new(DELIVERY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();
    let (auth, student_key) = create_student_auth(database.pool(), schedule_id, "alice").await;
    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));
    let (bootstrap_a, _session_a) = bootstrap_attempt_with_client_session_id(
        &app,
        &auth,
        schedule_id,
        "alice",
        &student_key,
        "phone-client-1",
    )
    .await;
    let (bootstrap_b, _session_b) = bootstrap_attempt_with_client_session_id(
        &app,
        &auth,
        schedule_id,
        "alice",
        &student_key,
        "computer-client-1",
    )
    .await;
    start_runtime(database.pool(), schedule_id, "listening").await;
    let attempt_id = bootstrap_a["data"]["attempt"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    assert_eq!(bootstrap_b["data"]["attempt"]["id"], attempt_id);
    let attempt_token_a = bootstrap_a["data"]["attemptCredential"]["attemptToken"]
        .as_str()
        .unwrap()
        .to_owned();
    let attempt_token_b = bootstrap_b["data"]["attemptCredential"]["attemptToken"]
        .as_str()
        .unwrap()
        .to_owned();
    let base_revision = bootstrap_a["data"]["attempt"]["revision"]
        .as_i64()
        .unwrap() as i32;
    let uri = format!("/api/v1/student/sessions/{schedule_id}/mutations:batch");

    // Session A accepts mutation id "shared-mut-1": revision N -> N+1.
    let session_a = app
        .clone()
        .oneshot(
            with_attempt_token(Request::builder(), &attempt_token_a)
                .method("POST")
                .uri(&uri)
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "attemptId": attempt_id.clone(),
                        "mutations": [{
                            "mutationId": "shared-mut-1",
                            "baseRevision": base_revision,
                            "type": "SetScalar",
                            "questionId": "q1",
                            "value": "A"
                        }]
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(session_a.status(), StatusCode::OK);
    let session_a_json = json_body(session_a).await;
    let revision_after_a = session_a_json["data"]["revision"].as_i64().unwrap();
    assert_eq!(revision_after_a, base_revision as i64 + 1);

    // Session B (bootstrapped before A's write) sends the SAME mutation id
    // from the stale base: rejected by the ownership gate, not applied twice.
    let session_b = app
        .clone()
        .oneshot(
            with_attempt_token(Request::builder(), &attempt_token_b)
                .method("POST")
                .uri(&uri)
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "attemptId": attempt_id.clone(),
                        "mutations": [{
                            "mutationId": "shared-mut-1",
                            "baseRevision": base_revision,
                            "type": "SetScalar",
                            "questionId": "q1",
                            "value": "A"
                        }]
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let session_b_status = session_b.status();
    let session_b_json = json_body(session_b).await;
    assert_eq!(
        session_b_status,
        StatusCode::CONFLICT,
        "stale cross-session duplicate must conflict: {session_b_json}"
    );
    assert_eq!(
        session_b_json["error"]["details"]["reason"],
        "BASE_REVISION_MISMATCH"
    );

    // DB-level: the mutation id exists exactly once; answers and revision are
    // unchanged by session B's attempt.
    let shared_rows: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM student_attempt_mutations WHERE attempt_id = ? AND client_mutation_id = ?",
    )
    .bind(&attempt_id)
    .bind("shared-mut-1")
    .fetch_one(database.pool())
    .await
    .unwrap();
    assert_eq!(shared_rows, 1, "the mutation id must not be applied twice");
    let answers: serde_json::Value =
        sqlx::query_scalar("SELECT answers FROM student_attempts WHERE id = ?")
            .bind(&attempt_id)
            .fetch_one(database.pool())
            .await
            .unwrap();
    assert_eq!(answers["q1"], "A");
    let stored_revision: i32 =
        sqlx::query_scalar("SELECT revision FROM student_attempts WHERE id = ?")
            .bind(&attempt_id)
            .fetch_one(database.pool())
            .await
            .unwrap();
    assert_eq!(stored_revision, revision_after_a as i32);

    // A THIRD session bootstrapped AFTER A's write has a fresh base; the same
    // mutation id is not deduped across sessions (different client_session_id)
    // and the base gate does not fire — the physical unique index
    // (attempt_id, client_mutation_id) blocks the duplicate row atomically.
    let (bootstrap_c, _session_c) = bootstrap_attempt_with_client_session_id(
        &app,
        &auth,
        schedule_id,
        "alice",
        &student_key,
        "tablet-client-1",
    )
    .await;
    let attempt_token_c = bootstrap_c["data"]["attemptCredential"]["attemptToken"]
        .as_str()
        .unwrap()
        .to_owned();
    let fresh_base_revision = bootstrap_c["data"]["attempt"]["revision"]
        .as_i64()
        .unwrap() as i32;
    assert_eq!(fresh_base_revision, revision_after_a as i32);
    let session_c = app
        .oneshot(
            with_attempt_token(Request::builder(), &attempt_token_c)
                .method("POST")
                .uri(&uri)
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "attemptId": attempt_id.clone(),
                        "mutations": [{
                            "mutationId": "shared-mut-1",
                            "baseRevision": fresh_base_revision,
                            "type": "SetScalar",
                            "questionId": "q1",
                            "value": "A"
                        }]
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let session_c_status = session_c.status();
    let session_c_json = json_body(session_c).await;
    assert_eq!(
        session_c_status,
        StatusCode::INTERNAL_SERVER_ERROR,
        "fresh-base cross-session duplicate must be blocked by the unique index: {session_c_json}"
    );
    assert_eq!(session_c_json["error"]["code"], "DATABASE_ERROR");
    let shared_rows_after_c: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM student_attempt_mutations WHERE attempt_id = ? AND client_mutation_id = ?",
    )
    .bind(&attempt_id)
    .bind("shared-mut-1")
    .fetch_one(database.pool())
    .await
    .unwrap();
    assert_eq!(shared_rows_after_c, 1, "the unique index must reject the duplicate row");

    database.shutdown().await;
}

// BEX-034: a database failure in the middle of a mutation batch aborts the
// whole transaction — no partial answers, no partial revision increment, no
// partial mutation rows, no cached idempotent response — and a retry of the
// complete batch applies cleanly.
#[tokio::test]
async fn mutation_batch_mid_batch_database_failure_rolls_back_atomically_and_retry_applies_fully() {
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
    start_runtime(database.pool(), schedule_id, "listening").await;
    let attempt_id = bootstrap["data"]["attempt"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let attempt_token = bootstrap["data"]["attemptCredential"]["attemptToken"]
        .as_str()
        .unwrap()
        .to_owned();
    let base_revision = bootstrap["data"]["attempt"]["revision"]
        .as_i64()
        .unwrap() as i32;
    let uri = format!("/api/v1/student/sessions/{schedule_id}/mutations:batch");

    let answers_before: serde_json::Value =
        sqlx::query_scalar("SELECT answers FROM student_attempts WHERE id = ?")
            .bind(&attempt_id)
            .fetch_one(database.pool())
            .await
            .unwrap();
    let revision_before: i32 =
        sqlx::query_scalar("SELECT revision FROM student_attempts WHERE id = ?")
            .bind(&attempt_id)
            .fetch_one(database.pool())
            .await
            .unwrap();

    // Mutation-2's client_mutation_id exceeds the VARCHAR(255) column width,
    // so its INSERT fails after mutation-1's INSERT already executed inside
    // the same transaction.
    let oversized_mutation_id = "x".repeat(300);
    let failed = app
        .clone()
        .oneshot(
            with_attempt_token(Request::builder(), &attempt_token)
                .method("POST")
                .uri(&uri)
                .header("content-type", "application/json")
                .header("idempotency-key", "bex034-txn-key-1")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "attemptId": attempt_id.clone(),
                        "mutations": [
                            {
                                "mutationId": "txn-mut-1",
                                "baseRevision": base_revision,
                                "type": "SetScalar",
                                "questionId": "q1",
                                "value": "A"
                            },
                            {
                                "mutationId": oversized_mutation_id,
                                "baseRevision": base_revision,
                                "type": "SetScalar",
                                "questionId": "q1",
                                "value": "B"
                            }
                        ]
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let failed_status = failed.status();
    let failed_json = json_body(failed).await;
    assert_eq!(
        failed_status,
        StatusCode::INTERNAL_SERVER_ERROR,
        "mid-batch DB failure must surface as 500: {failed_json}"
    );
    assert_eq!(failed_json["error"]["code"], "DATABASE_ERROR");

    // No partial state leaked from the aborted transaction.
    // serverAcceptedThroughSeq is derived from MAX(mutation_seq) inside the
    // same transaction, so rows == 0 implies the watermark is unchanged too.
    let answers_after_failure: serde_json::Value =
        sqlx::query_scalar("SELECT answers FROM student_attempts WHERE id = ?")
            .bind(&attempt_id)
            .fetch_one(database.pool())
            .await
            .unwrap();
    assert_eq!(
        answers_after_failure, answers_before,
        "no partial answer snapshot may persist"
    );
    let revision_after_failure: i32 =
        sqlx::query_scalar("SELECT revision FROM student_attempts WHERE id = ?")
            .bind(&attempt_id)
            .fetch_one(database.pool())
            .await
            .unwrap();
    assert_eq!(
        revision_after_failure, revision_before,
        "no partial revision increment may persist"
    );
    let rows_after_failure: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM student_attempt_mutations WHERE attempt_id = ?")
            .bind(&attempt_id)
            .fetch_one(database.pool())
            .await
            .unwrap();
    assert_eq!(rows_after_failure, 0, "no partial mutation row may persist");
    let idempotency_rows_after_failure: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM idempotency_keys WHERE actor_id = ? AND idempotency_key = ?",
    )
    .bind(&student_key)
    .bind("bex034-txn-key-1")
    .fetch_one(database.pool())
    .await
    .unwrap();
    assert_eq!(
        idempotency_rows_after_failure, 0,
        "no idempotent response may be cached for the failed batch"
    );

    // Retry the complete batch with the corrected mutation id and the same
    // key: fully applied, revision advanced exactly once, watermark advanced.
    let retried = app
        .oneshot(
            with_attempt_token(Request::builder(), &attempt_token)
                .method("POST")
                .uri(&uri)
                .header("content-type", "application/json")
                .header("idempotency-key", "bex034-txn-key-1")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "attemptId": attempt_id.clone(),
                        "mutations": [
                            {
                                "mutationId": "txn-mut-1",
                                "baseRevision": base_revision,
                                "type": "SetScalar",
                                "questionId": "q1",
                                "value": "A"
                            },
                            {
                                "mutationId": "txn-mut-2",
                                "baseRevision": base_revision,
                                "type": "SetScalar",
                                "questionId": "q1",
                                "value": "B"
                            }
                        ]
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let retried_status = retried.status();
    let retried_json = json_body(retried).await;
    assert_eq!(retried_status, StatusCode::OK, "retry must apply: {retried_json}");
    assert_eq!(retried_json["data"]["appliedMutationCount"], 2);
    assert_eq!(retried_json["data"]["serverAcceptedThroughSeq"], 2);
    assert_eq!(retried_json["data"]["revision"], base_revision as i64 + 1);
    let answers_final: serde_json::Value =
        sqlx::query_scalar("SELECT answers FROM student_attempts WHERE id = ?")
            .bind(&attempt_id)
            .fetch_one(database.pool())
            .await
            .unwrap();
    assert_eq!(answers_final["q1"], "B", "the complete retried batch must be applied");
    let rows_final: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM student_attempt_mutations WHERE attempt_id = ?")
            .bind(&attempt_id)
            .fetch_one(database.pool())
            .await
            .unwrap();
    assert_eq!(rows_final, 2);
    let revision_final: i32 =
        sqlx::query_scalar("SELECT revision FROM student_attempts WHERE id = ?")
            .bind(&attempt_id)
            .fetch_one(database.pool())
            .await
            .unwrap();
    assert_eq!(revision_final, base_revision + 1, "revision advanced exactly once");

    database.shutdown().await;
}

#[tokio::test]
async fn heartbeat_ack_mode_records_presence_without_touching_attempt_revision() {
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
    let attempt_id = bootstrap["data"]["attempt"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let attempt_token = bootstrap["data"]["attemptCredential"]["attemptToken"]
        .as_str()
        .unwrap()
        .to_owned();
    let before_revision: i32 =
        sqlx::query_scalar("SELECT revision FROM student_attempts WHERE id = ?")
            .bind(&attempt_id)
            .fetch_one(database.pool())
            .await
            .unwrap();

    let response = app
        .oneshot(
            with_attempt_token(Request::builder(), &attempt_token)
                .method("POST")
                .uri(format!(
                    "/api/v1/student/sessions/{}/heartbeat?responseMode=ack",
                    schedule_id
                ))
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&StudentHeartbeatRequest {
                        attempt_id: Some(attempt_id.clone()),
                        student_key: student_key.clone(),
                        client_session_id: client_session_id.clone(),
                        event_type: HeartbeatEventType::Heartbeat,
                        payload: None,
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
    assert!(json["data"].get("attempt").is_none());

    let after_revision: i32 =
        sqlx::query_scalar("SELECT revision FROM student_attempts WHERE id = ?")
            .bind(&attempt_id)
            .fetch_one(database.pool())
            .await
            .unwrap();
    assert_eq!(after_revision, before_revision);

    let presence: (String, String) = sqlx::query_as(
        "SELECT last_heartbeat_status, client_session_id FROM student_attempt_presence WHERE attempt_id = ?",
    )
    .bind(&attempt_id)
    .fetch_one(database.pool())
    .await
    .unwrap();
    assert_eq!(presence.0, "ok");
    assert_eq!(presence.1, client_session_id);

    database.shutdown().await;
}

#[tokio::test]
async fn heartbeat_defaults_to_ack_response_without_touching_attempt_revision() {
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
    let attempt_id = bootstrap["data"]["attempt"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let attempt_token = bootstrap["data"]["attemptCredential"]["attemptToken"]
        .as_str()
        .unwrap()
        .to_owned();
    let before_revision: i32 =
        sqlx::query_scalar("SELECT revision FROM student_attempts WHERE id = ?")
            .bind(&attempt_id)
            .fetch_one(database.pool())
            .await
            .unwrap();

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
                        event_type: HeartbeatEventType::Heartbeat,
                        payload: None,
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
    assert!(json["data"].get("attempt").is_none());

    let after_revision: i32 =
        sqlx::query_scalar("SELECT revision FROM student_attempts WHERE id = ?")
            .bind(&attempt_id)
            .fetch_one(database.pool())
            .await
            .unwrap();
    assert_eq!(after_revision, before_revision);

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
    let attempt_id = bootstrap["data"]["attempt"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let attempt_token = bootstrap["data"]["attemptCredential"]["attemptToken"]
        .as_str()
        .unwrap()
        .to_owned();
    let revision_at_bootstrap = bootstrap["data"]["attempt"]["revision"].as_i64().unwrap();

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
                        event_type: HeartbeatEventType::Disconnect,
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

    assert_eq!(
        json["data"]["attempt"]["integrity"]["lastHeartbeatStatus"],
        "lost"
    );
    assert_ne!(
        json["data"]["attempt"]["integrity"]["lastDisconnectAt"],
        serde_json::Value::Null
    );
    assert_eq!(
        json["data"]["attempt"]["revision"].as_i64(),
        Some(revision_at_bootstrap),
        "network-transition heartbeat must not bump the attempt revision (BEX-050)"
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
    let attempt_id = bootstrap["data"]["attempt"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let attempt_token = bootstrap["data"]["attemptCredential"]["attemptToken"]
        .as_str()
        .unwrap()
        .to_owned();
    let revision_at_bootstrap = bootstrap["data"]["attempt"]["revision"].as_i64().unwrap();

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
                        event_type: HeartbeatEventType::Lost,
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
    let json = json_body(response).await;
    assert_eq!(
        json["data"]["attempt"]["revision"].as_i64(),
        Some(revision_at_bootstrap),
        "network-transition heartbeat must not bump the attempt revision (BEX-050)"
    );

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
async fn student_heartbeat_does_not_resume_a_paused_runtime() {
    let database = mysql::TestDatabase::new(DELIVERY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();
    let admin_auth = mysql::create_authenticated_user(
        database.pool(),
        UserRole::Admin,
        "admin@example.com",
        "Admin",
    )
    .await;
    let (student_auth, student_key) = create_student_auth(database.pool(), schedule_id, "alice").await;
    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));
    let (bootstrap, client_session_id) =
        bootstrap_attempt(&app, &student_auth, schedule_id, "alice", &student_key).await;
    let attempt_id = bootstrap["data"]["attempt"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let attempt_token = bootstrap["data"]["attemptCredential"]["attemptToken"]
        .as_str()
        .unwrap()
        .to_owned();
    let (phase_before, proctor_status_before): (Option<String>, Option<String>) = sqlx::query_as(
        "SELECT phase, proctor_status FROM student_attempts WHERE id = ?",
    )
    .bind(&attempt_id)
    .fetch_one(database.pool())
    .await
    .unwrap();
    let attempt_revision_before: i32 =
        sqlx::query_scalar("SELECT revision FROM student_attempts WHERE id = ?")
            .bind(&attempt_id)
            .fetch_one(database.pool())
            .await
            .unwrap();

    // Proctor starts the runtime and pauses it.
    let start = admin_runtime_command(
        &app,
        &admin_auth,
        schedule_id,
        json!({ "action": "start_runtime" }),
    )
    .await;
    assert_eq!(start.status(), StatusCode::OK);
    let pause = admin_runtime_command(
        &app,
        &admin_auth,
        schedule_id,
        json!({ "action": "pause_runtime" }),
    )
    .await;
    assert_eq!(pause.status(), StatusCode::OK);
    let paused_projection = admin_runtime_projection(&app, &admin_auth, schedule_id).await;
    assert_eq!(paused_projection["data"]["status"], "paused");
    let paused_runtime_revision = paused_projection["data"]["revision"].as_i64().unwrap();

    // A student heartbeat while the runtime is paused must succeed, must NOT
    // resume the runtime, and must leave the attempt untouched.
    let heartbeat = app
        .clone()
        .oneshot(
            with_attempt_token(Request::builder(), &attempt_token)
                .method("POST")
                .uri(format!(
                    "/api/v1/student/sessions/{schedule_id}/heartbeat",
                ))
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&StudentHeartbeatRequest {
                        attempt_id: Some(attempt_id.clone()),
                        student_key: student_key.clone(),
                        client_session_id,
                        event_type: HeartbeatEventType::Heartbeat,
                        payload: None,
                        client_timestamp: Utc.with_ymd_and_hms(2026, 1, 10, 9, 6, 0).unwrap(),
                    })
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(heartbeat.status(), StatusCode::OK);

    let after_heartbeat = admin_runtime_projection(&app, &admin_auth, schedule_id).await;
    assert_eq!(
        after_heartbeat["data"]["status"],
        "paused",
        "a student heartbeat must not resume the runtime"
    );
    assert_eq!(
        after_heartbeat["data"]["revision"].as_i64().unwrap(),
        paused_runtime_revision,
        "a student heartbeat must not bump the runtime revision"
    );

    let (phase_after, proctor_status_after): (Option<String>, Option<String>) = sqlx::query_as(
        "SELECT phase, proctor_status FROM student_attempts WHERE id = ?",
    )
    .bind(&attempt_id)
    .fetch_one(database.pool())
    .await
    .unwrap();
    assert_eq!(phase_after, phase_before, "heartbeat must not change the attempt phase");
    assert_eq!(
        proctor_status_after, proctor_status_before,
        "a cohort pause must not pause the attempt"
    );
    let attempt_revision_after: i32 =
        sqlx::query_scalar("SELECT revision FROM student_attempts WHERE id = ?")
            .bind(&attempt_id)
            .fetch_one(database.pool())
            .await
            .unwrap();
    assert_eq!(attempt_revision_after, attempt_revision_before);

    // The proctor can still resume afterwards.
    let resume = admin_runtime_command(
        &app,
        &admin_auth,
        schedule_id,
        json!({ "action": "resume_runtime" }),
    )
    .await;
    assert_eq!(resume.status(), StatusCode::OK);
    let resume_json = json_body(resume).await;
    assert_eq!(resume_json["data"]["status"], "live");

    database.shutdown().await;
}

#[tokio::test]
async fn cohort_pause_and_individual_pause_leave_distinct_append_only_trails() {
    let database = mysql::TestDatabase::new(DELIVERY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();
    let admin_auth = mysql::create_authenticated_user(
        database.pool(),
        UserRole::Admin,
        "admin@example.com",
        "Admin",
    )
    .await;
    let (student_auth, student_key) = create_student_auth(database.pool(), schedule_id, "alice").await;
    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));
    let (bootstrap, _client_session_id) =
        bootstrap_attempt(&app, &student_auth, schedule_id, "alice", &student_key).await;
    let attempt_id = bootstrap["data"]["attempt"]["id"]
        .as_str()
        .unwrap()
        .to_owned();

    // (a) Cohort pause: the running runtime pauses, alice's attempt stays untouched.
    let start = admin_runtime_command(
        &app,
        &admin_auth,
        schedule_id,
        json!({ "action": "start_runtime" }),
    )
    .await;
    assert_eq!(start.status(), StatusCode::OK);
    let pause = admin_runtime_command(
        &app,
        &admin_auth,
        schedule_id,
        json!({ "action": "pause_runtime" }),
    )
    .await;
    assert_eq!(pause.status(), StatusCode::OK);
    let paused_projection = admin_runtime_projection(&app, &admin_auth, schedule_id).await;
    assert_eq!(paused_projection["data"]["status"], "paused");
    let proctor_status: Option<String> =
        sqlx::query_scalar("SELECT proctor_status FROM student_attempts WHERE id = ?")
            .bind(&attempt_id)
            .fetch_one(database.pool())
            .await
            .unwrap();
    assert_ne!(
        proctor_status.as_deref(),
        Some("paused"),
        "a cohort pause must not pause the attempt itself"
    );

    // (b) Resume the cohort runtime before pausing the individual attempt.
    let resume = admin_runtime_command(
        &app,
        &admin_auth,
        schedule_id,
        json!({ "action": "resume_runtime" }),
    )
    .await;
    assert_eq!(resume.status(), StatusCode::OK);

    // (c) Individual pause: the attempt pauses while the runtime stays live.
    let individual = app
        .clone()
        .oneshot(
            admin_auth
                .with_csrf(Request::builder())
                .method("POST")
                .uri(format!(
                    "/api/v1/proctor/sessions/{schedule_id}/attempts/{attempt_id}/pause"
                ))
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&AttemptCommandRequest {
                        message: None,
                        reason: Some("individual-check".to_owned()),
                        expected_active_section_key: None,
                    })
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(individual.status(), StatusCode::OK);
    let individual_json = json_body(individual).await;
    assert_eq!(individual_json["data"]["status"], "paused");
    let proctor_status: String =
        sqlx::query_scalar("SELECT proctor_status FROM student_attempts WHERE id = ?")
            .bind(&attempt_id)
            .fetch_one(database.pool())
            .await
            .unwrap();
    assert_eq!(proctor_status, "paused");
    let runtime_after_individual = admin_runtime_projection(&app, &admin_auth, schedule_id).await;
    assert_eq!(
        runtime_after_individual["data"]["status"],
        "live",
        "an individual pause must not pause the cohort runtime"
    );

    // (d) Two separate append-only trails, both attributed to the proctor actor:
    // session_audit_logs carries the STUDENT_PAUSE audit; cohort_control_events
    // carries exactly one PauseRuntime control event.
    let student_audits: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM session_audit_logs WHERE schedule_id = ? AND action_type = 'STUDENT_PAUSE'",
    )
    .bind(schedule_id.to_string())
    .fetch_one(database.pool())
    .await
    .unwrap();
    assert_eq!(student_audits, 1, "individual pause appends one STUDENT_PAUSE audit");
    let control_events: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM cohort_control_events WHERE schedule_id = ? AND action = 'pause_runtime'",
    )
    .bind(schedule_id.to_string())
    .fetch_one(database.pool())
    .await
    .unwrap();
    assert_eq!(control_events, 1, "cohort pause appends one pause_runtime control event");
    let control_actor: String = sqlx::query_scalar(
        "SELECT actor_id FROM cohort_control_events WHERE schedule_id = ? AND action = 'pause_runtime'",
    )
    .bind(schedule_id.to_string())
    .fetch_one(database.pool())
    .await
    .unwrap();
    assert_eq!(control_actor, admin_auth.user_id.to_string());

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
    let attempt_id = bootstrap["data"]["attempt"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
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
                        action_type:
                            ielts_backend_domain::schedule::AuditActionType::ViolationDetected,
                        payload: Some(json!({
                            "event": "VIOLATION_DETECTED",
                            "violationId": "vio-student-audit-1",
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
    let attempt_id = bootstrap["data"]["attempt"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
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
                .header("idempotency-key", "submission-idempotent-1")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "attemptId": attempt_id.clone(),
                        "lastSeenRevision": 0,
                        "submissionId": "submission-idempotent-1",
                        "clientFinalSeq": 0,
                        "serverAcceptedThroughSeq": 0
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    let attempt_revision = bootstrap["data"]["attempt"]["revision"]
        .as_i64()
        .unwrap() as i32;

    assert_eq!(response.status(), StatusCode::CONFLICT);
    let json = json_body(response).await;
    assert_eq!(json["error"]["code"], "CONFLICT");

    let retry = app
        .oneshot(
            with_attempt_token(Request::builder(), &attempt_token)
                .method("POST")
                .uri(format!("/api/v1/student/sessions/{}/submit", schedule_id))
                .header("content-type", "application/json")
                .header("idempotency-key", "submission-idempotent-1")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "attemptId": attempt_id.clone(),
                        "lastSeenRevision": attempt_revision,
                        "submissionId": "submission-idempotent-1",
                        "clientFinalSeq": 0,
                        "serverAcceptedThroughSeq": 0
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(retry.status(), StatusCode::CONFLICT);
    let retry_json = json_body(retry).await;
    assert_eq!(retry_json["error"]["code"], "CONFLICT");

    let ledger_row: (i64, Option<String>, Option<String>) = sqlx::query_as(
        "SELECT COUNT(*), MAX(submission_source), MAX(idempotency_key) FROM attempt_submission_ledger WHERE attempt_id = ?",
    )
    .bind(&attempt_id)
    .fetch_one(database.pool())
    .await
    .unwrap();
    assert_eq!(ledger_row.0, 0);
    assert_eq!(ledger_row.1, None);
    assert_eq!(ledger_row.2, None);

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
    let attempt_id = bootstrap["data"]["attempt"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let attempt_token = bootstrap["data"]["attemptCredential"]["attemptToken"]
        .as_str()
        .unwrap()
        .to_owned();
    let attempt_revision = bootstrap["data"]["attempt"]["revision"]
        .as_i64()
        .unwrap() as i32;

    let first = app
        .clone()
        .oneshot(
            with_attempt_token(Request::builder(), &attempt_token)
                .method("POST")
                .uri(format!("/api/v1/student/sessions/{}/submit", schedule_id))
                .header("content-type", "application/json")
                .header("idempotency-key", "submit-replay-1")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "attemptId": attempt_id.clone(),
                        "lastSeenRevision": attempt_revision,
                        "submissionId": "submission-replay-1",
                        "clientFinalSeq": 0,
                        "serverAcceptedThroughSeq": 0
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(first.status(), StatusCode::CONFLICT);
    let first_json = json_body(first).await;
    assert_eq!(first_json["error"]["code"], "CONFLICT");

    let replay = app
        .oneshot(
            with_attempt_token(Request::builder(), &attempt_token)
                .method("POST")
                .uri(format!("/api/v1/student/sessions/{}/submit", schedule_id))
                .header("content-type", "application/json")
                .header("idempotency-key", "submit-replay-1")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "attemptId": attempt_id,
                        "lastSeenRevision": attempt_revision,
                        "submissionId": "submission-replay-1",
                        "clientFinalSeq": 0,
                        "serverAcceptedThroughSeq": 0
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(replay.status(), StatusCode::CONFLICT);
    let replay_json = json_body(replay).await;
    assert_eq!(replay_json["error"]["code"], "CONFLICT");

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
    assert_eq!(idempotency_count, 0);

    database.shutdown().await;
}

// BEX-060 — a final answer patch reconciles a stale `lastSeenRevision`:
// the client's authoritative final state is merged over the persisted
// answers, so the submit succeeds instead of returning BASE_REVISION_MISMATCH.
#[tokio::test]
async fn bex060_final_patch_reconciles_stale_last_seen_revision() {
    let database = mysql::TestDatabase::new(DELIVERY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();
    let (auth, student_key) = create_student_auth(database.pool(), schedule_id, "alice").await;
    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));
    // The runtime row only exists after the real StartRuntime command (a bare
    // UPDATE on exam_session_runtimes is a silent no-op); bootstrapping after
    // the start creates the attempt with phase `exam` so the submit phase
    // gate passes.
    let (bootstrap, _client_session_id) = start_runtime_and_rebootstrap(
        &app,
        database.pool(),
        &auth,
        schedule_id,
        &student_key,
    )
    .await;
    let attempt_id = bootstrap["data"]["attempt"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let attempt_token = bootstrap["data"]["attemptCredential"]["attemptToken"]
        .as_str()
        .unwrap()
        .to_owned();
    let base_revision = bootstrap["data"]["attempt"]["revision"]
        .as_i64()
        .unwrap() as i32;
    assert_eq!(bootstrap["data"]["attempt"]["phase"], "exam");

    // Session A accepts one mutation: the attempt advances to revision + 1.
    let mutation_response = app
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
                    serde_json::to_vec(&json!({
                        "attemptId": attempt_id.clone(),
                        "mutations": [{
                            "mutationId": "mutation-submit-stale-1",
                            "baseRevision": base_revision,
                            "type": "SetScalar",
                            "questionId": "q1",
                            "value": "A"
                        }]
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(mutation_response.status(), StatusCode::OK);
    let mutation_json = json_body(mutation_response).await;
    let revision_after_mutation = mutation_json["data"]["revision"].as_i64().unwrap();
    assert_eq!(revision_after_mutation, base_revision as i64 + 1);

    // The client fell behind (lastSeenRevision 0) but carries the final
    // patch: the patch reconciles the stale revision instead of conflicting.
    let response = app
        .oneshot(
            with_attempt_token(Request::builder(), &attempt_token)
                .method("POST")
                .uri(format!("/api/v1/student/sessions/{}/submit", schedule_id))
                .header("content-type", "application/json")
                .header("idempotency-key", "submit-stale-with-patch")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "attemptId": attempt_id.clone(),
                        "lastSeenRevision": 0,
                        "submissionId": "submit-stale-with-patch",
                        "clientFinalSeq": 1,
                        "serverAcceptedThroughSeq": 1,
                        "finalAnswerPatch": {
                            "answers": { "q1": "B" },
                            "writingAnswers": {},
                            "flags": {}
                        }
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(
        response.status(),
        StatusCode::OK,
        "final patch must reconcile the stale lastSeenRevision: {}",
        json_body(response).await
    );
    let json = json_body(response).await;
    assert_eq!(json["data"]["attempt"]["phase"], "post-exam");
    assert_eq!(
        json["data"]["attempt"]["answers"]["q1"], "B",
        "the response attempt must reflect the patched answers"
    );

    // The patched value is what the final snapshot (grading input) carries,
    // and the persisted answers are reconciled to the same patched state so
    // the response attempt and any in-grace merge never see stale answers.
    let final_submission: serde_json::Value =
        sqlx::query_scalar("SELECT final_submission FROM student_attempts WHERE id = ?")
            .bind(&attempt_id)
            .fetch_one(database.pool())
            .await
            .unwrap();
    assert_eq!(
        final_submission["answers"]["q1"], "B",
        "final snapshot must carry the patched answer"
    );
    assert_eq!(
        final_submission["finalFlush"]["finalPatchApplied"], true,
        "finalFlush must record that the patch was applied"
    );
    assert_eq!(final_submission["finalFlush"]["replayIncomplete"], false);
    let answers = persisted_answers(database.pool(), &attempt_id).await;
    assert_eq!(answers["q1"], "B");
    assert_eq!(
        persisted_revision(database.pool(), &attempt_id).await,
        revision_after_mutation + 1,
        "submit bumps the revision exactly once"
    );
    assert_eq!(
        persisted_audit_by_action(database.pool(), &attempt_id, "STUDENT_SUBMIT").await,
        1,
        "exactly one STUDENT_SUBMIT audit row"
    );

    database.shutdown().await;
}

// BEX-060 — a stale `lastSeenRevision` WITHOUT a final patch is still a
// structured BASE_REVISION_MISMATCH conflict and must not seal the attempt.
#[tokio::test]
async fn bex060_stale_last_seen_revision_without_patch_returns_base_revision_mismatch() {
    let database = mysql::TestDatabase::new(DELIVERY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();
    let (auth, student_key) = create_student_auth(database.pool(), schedule_id, "alice").await;
    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));
    let (bootstrap, _) = start_runtime_and_rebootstrap(
        &app,
        database.pool(),
        &auth,
        schedule_id,
        &student_key,
    )
    .await;
    let attempt_id = bootstrap["data"]["attempt"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let attempt_token = bootstrap["data"]["attemptCredential"]["attemptToken"]
        .as_str()
        .unwrap()
        .to_owned();
    let base_revision = bootstrap["data"]["attempt"]["revision"]
        .as_i64()
        .unwrap() as i32;

    let mutation_response = app
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
                    serde_json::to_vec(&json!({
                        "attemptId": attempt_id.clone(),
                        "mutations": [{
                            "mutationId": "mutation-stale-no-patch-1",
                            "baseRevision": base_revision,
                            "type": "SetScalar",
                            "questionId": "q1",
                            "value": "A"
                        }]
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(mutation_response.status(), StatusCode::OK);
    let revision_after_mutation = persisted_revision(database.pool(), &attempt_id).await;

    let (status, json) = post_submit_json(
        &app,
        &attempt_token,
        schedule_id,
        Some("submit-stale-no-patch"),
        json!({
            "attemptId": attempt_id.clone(),
            "lastSeenRevision": base_revision,
            "submissionId": "submit-stale-no-patch",
            "clientFinalSeq": 1,
            "serverAcceptedThroughSeq": 1
        }),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{json}");
    assert_eq!(json["error"]["code"], "CONFLICT");
    assert_eq!(
        json["error"]["details"]["reason"], "BASE_REVISION_MISMATCH",
        "stale revision without a patch must conflict: {json}"
    );
    assert_eq!(json["error"]["details"]["latestRevision"].as_i64().unwrap(), revision_after_mutation);
    assert_eq!(
        persisted_revision(database.pool(), &attempt_id).await,
        revision_after_mutation,
        "conflict must not bump the revision"
    );
    let submitted_at: Option<chrono::DateTime<Utc>> = sqlx::query_scalar(
        "SELECT submitted_at FROM student_attempts WHERE id = ?",
    )
    .bind(&attempt_id)
    .fetch_one(database.pool())
    .await
    .unwrap();
    assert!(submitted_at.is_none(), "conflict must not seal the attempt");
    assert_eq!(
        persisted_audit_by_action(database.pool(), &attempt_id, "STUDENT_SUBMIT").await,
        0
    );

    database.shutdown().await;
}

// BEX-060 — a sequence gap (client has mutations the server has not accepted)
// without a final patch returns FINAL_FLUSH_REQUIRED; nothing is persisted.
#[tokio::test]
async fn bex060_sequence_gap_without_patch_returns_final_flush_required() {
    let database = mysql::TestDatabase::new(DELIVERY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();
    let (auth, student_key) = create_student_auth(database.pool(), schedule_id, "alice").await;
    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));
    let (bootstrap, _) = start_runtime_and_rebootstrap(
        &app,
        database.pool(),
        &auth,
        schedule_id,
        &student_key,
    )
    .await;
    let attempt_id = bootstrap["data"]["attempt"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let attempt_token = bootstrap["data"]["attemptCredential"]["attemptToken"]
        .as_str()
        .unwrap()
        .to_owned();
    let attempt_revision = bootstrap["data"]["attempt"]["revision"]
        .as_i64()
        .unwrap() as i32;

    // clientFinalSeq 2 > serverAcceptedThroughSeq 1: a pending gap.
    let (status, json) = post_submit_json(
        &app,
        &attempt_token,
        schedule_id,
        Some("submit-gap-no-patch"),
        json!({
            "attemptId": attempt_id.clone(),
            "lastSeenRevision": attempt_revision,
            "submissionId": "submit-gap-no-patch",
            "clientFinalSeq": 2,
            "serverAcceptedThroughSeq": 1
        }),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{json}");
    assert_eq!(json["error"]["code"], "CONFLICT");
    assert_eq!(
        json["error"]["details"]["reason"], "FINAL_FLUSH_REQUIRED",
        "a sequence gap without a final patch must demand a final flush: {json}"
    );
    assert_eq!(
        persisted_revision(database.pool(), &attempt_id).await,
        attempt_revision as i64,
        "rejection must not bump the revision"
    );
    let submitted_at: Option<chrono::DateTime<Utc>> = sqlx::query_scalar(
        "SELECT submitted_at FROM student_attempts WHERE id = ?",
    )
    .bind(&attempt_id)
    .fetch_one(database.pool())
    .await
    .unwrap();
    assert!(submitted_at.is_none(), "rejection must not seal the attempt");
    let final_submission: Option<serde_json::Value> = sqlx::query_scalar(
        "SELECT final_submission FROM student_attempts WHERE id = ?",
    )
    .bind(&attempt_id)
    .fetch_one(database.pool())
    .await
    .unwrap();
    assert!(final_submission.is_none());
    assert_eq!(
        persisted_audit_by_action(database.pool(), &attempt_id, "STUDENT_SUBMIT").await,
        0
    );

    // Same gap with clientFinalSeq present but serverAcceptedThroughSeq
    // absent (client_final_seq > 0): also a gap, also FINAL_FLUSH_REQUIRED.
    let (status, json) = post_submit_json(
        &app,
        &attempt_token,
        schedule_id,
        Some("submit-gap-no-server-seq"),
        json!({
            "attemptId": attempt_id.clone(),
            "lastSeenRevision": attempt_revision,
            "submissionId": "submit-gap-no-server-seq",
            "clientFinalSeq": 1
        }),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{json}");
    assert_eq!(json["error"]["code"], "CONFLICT");
    assert_eq!(
        json["error"]["details"]["reason"], "FINAL_FLUSH_REQUIRED",
        "a client-only seq gap without a final patch must demand a final flush: {json}"
    );

    // Gate precedence: with BOTH a stale lastSeenRevision and a sequence gap
    // (no patch), the revision gate fires first -> BASE_REVISION_MISMATCH,
    // not FINAL_FLUSH_REQUIRED.
    let (status, json) = post_submit_json(
        &app,
        &attempt_token,
        schedule_id,
        Some("submit-gap-stale-revision"),
        json!({
            "attemptId": attempt_id.clone(),
            "lastSeenRevision": attempt_revision + 1,
            "submissionId": "submit-gap-stale-revision",
            "clientFinalSeq": 2,
            "serverAcceptedThroughSeq": 1
        }),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{json}");
    assert_eq!(json["error"]["code"], "CONFLICT");
    assert_eq!(
        json["error"]["details"]["reason"], "BASE_REVISION_MISMATCH",
        "the revision gate must precede the flush gate: {json}"
    );

    database.shutdown().await;
}

// BEX-060 — a submit with no flush metadata at all (no seq values, no patch)
// returns FINAL_FLUSH_REQUIRED once the runtime is live.
#[tokio::test]
async fn bex060_missing_flush_metadata_returns_final_flush_required() {
    let database = mysql::TestDatabase::new(DELIVERY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();
    let (auth, student_key) = create_student_auth(database.pool(), schedule_id, "alice").await;
    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));
    let (bootstrap, _) = start_runtime_and_rebootstrap(
        &app,
        database.pool(),
        &auth,
        schedule_id,
        &student_key,
    )
    .await;
    let attempt_id = bootstrap["data"]["attempt"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let attempt_token = bootstrap["data"]["attemptCredential"]["attemptToken"]
        .as_str()
        .unwrap()
        .to_owned();
    let attempt_revision = bootstrap["data"]["attempt"]["revision"]
        .as_i64()
        .unwrap() as i32;

    let (status, json) = post_submit_json(
        &app,
        &attempt_token,
        schedule_id,
        Some("submit-no-flush-metadata"),
        json!({
            "attemptId": attempt_id.clone(),
            "lastSeenRevision": attempt_revision,
            "submissionId": "submit-no-flush-metadata"
        }),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{json}");
    assert_eq!(json["error"]["code"], "CONFLICT");
    assert_eq!(
        json["error"]["details"]["reason"], "FINAL_FLUSH_REQUIRED",
        "no flush metadata must demand a final flush: {json}"
    );
    assert_eq!(
        persisted_audit_by_action(database.pool(), &attempt_id, "STUDENT_SUBMIT").await,
        0
    );

    database.shutdown().await;
}

// BEX-060 — a sequence gap IS accepted when a final patch reconciles it: the
// final snapshot carries the patched state and finalFlush records
// replayIncomplete: true (only persistable when a patch is present).
#[tokio::test]
async fn bex060_sequence_gap_reconciled_by_patch_persists_replay_incomplete() {
    let database = mysql::TestDatabase::new(DELIVERY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();
    let (auth, student_key) = create_student_auth(database.pool(), schedule_id, "alice").await;
    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));
    let (bootstrap, _) = start_runtime_and_rebootstrap(
        &app,
        database.pool(),
        &auth,
        schedule_id,
        &student_key,
    )
    .await;
    let attempt_id = bootstrap["data"]["attempt"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let attempt_token = bootstrap["data"]["attemptCredential"]["attemptToken"]
        .as_str()
        .unwrap()
        .to_owned();
    let attempt_revision = bootstrap["data"]["attempt"]["revision"]
        .as_i64()
        .unwrap() as i32;

    let (status, json) = post_submit_json(
        &app,
        &attempt_token,
        schedule_id,
        Some("submit-gap-with-patch"),
        json!({
            "attemptId": attempt_id.clone(),
            "lastSeenRevision": attempt_revision,
            "submissionId": "submit-gap-with-patch",
            "clientFinalSeq": 2,
            "serverAcceptedThroughSeq": 1,
            "finalAnswerPatch": {
                "answers": { "q1": "reconciled" },
                "writingAnswers": {},
                "flags": {}
            }
        }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json}");
    assert_eq!(json["data"]["attempt"]["phase"], "post-exam");

    let final_submission: serde_json::Value =
        sqlx::query_scalar("SELECT final_submission FROM student_attempts WHERE id = ?")
            .bind(&attempt_id)
            .fetch_one(database.pool())
            .await
            .unwrap();
    assert_eq!(
        final_submission["answers"]["q1"], "reconciled",
        "the patch reconciles the gap in the final snapshot"
    );
    assert_eq!(final_submission["finalFlush"]["clientFinalSeq"], 2);
    assert_eq!(final_submission["finalFlush"]["serverAcceptedThroughSeq"], 1);
    assert_eq!(
        final_submission["finalFlush"]["replayIncomplete"], true,
        "replayIncomplete records the reconciled gap"
    );
    assert_eq!(final_submission["finalFlush"]["finalPatchApplied"], true);
    assert_eq!(
        persisted_revision(database.pool(), &attempt_id).await,
        attempt_revision as i64 + 1,
        "submit bumps the revision exactly once"
    );
    assert_eq!(
        persisted_audit_by_action(database.pool(), &attempt_id, "STUDENT_SUBMIT").await,
        1
    );

    database.shutdown().await;
}

#[tokio::test]
async fn submit_rejects_missing_seq_without_final_patch() {
    let database = mysql::TestDatabase::new(DELIVERY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();
    let (auth, student_key) = create_student_auth(database.pool(), schedule_id, "alice").await;
    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));
    let (bootstrap, _) = bootstrap_attempt(&app, &auth, schedule_id, "alice", &student_key).await;
    let attempt_id = bootstrap["data"]["attempt"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let attempt_token = bootstrap["data"]["attemptCredential"]["attemptToken"]
        .as_str()
        .unwrap()
        .to_owned();
    let attempt_revision = bootstrap["data"]["attempt"]["revision"]
        .as_i64()
        .unwrap() as i32;

    let response = app
        .oneshot(
            with_attempt_token(Request::builder(), &attempt_token)
                .method("POST")
                .uri(format!("/api/v1/student/sessions/{}/submit", schedule_id))
                .header("content-type", "application/json")
                .header("idempotency-key", "submit-missing-seq")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "attemptId": attempt_id,
                        "lastSeenRevision": attempt_revision,
                        "submissionId": "submit-missing-seq"
                    }))
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
    let attempt_id = bootstrap["data"]["attempt"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let attempt_token = bootstrap["data"]["attemptCredential"]["attemptToken"]
        .as_str()
        .unwrap()
        .to_owned();
    let base_revision = bootstrap["data"]["attempt"]["revision"]
        .as_i64()
        .unwrap() as i32;

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
                    serde_json::to_vec(&json!({
                        "attemptId": attempt_id.clone(),
                        "mutations": [{
                            "mutationId": "mutation-1",
                            "baseRevision": base_revision,
                            "type": "SetScalar",
                            "questionId": "q1",
                            "value": "A"
                        }]
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(mutation.status(), StatusCode::OK);

    let (rebootstrap, _) = bootstrap_attempt(&app, &auth, schedule_id, "alice", &student_key).await;
    assert_eq!(rebootstrap["data"]["attempt"]["id"], attempt_id);
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
    let attempt_id = bootstrap["data"]["attempt"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let attempt_token = bootstrap["data"]["attemptCredential"]["attemptToken"]
        .as_str()
        .unwrap()
        .to_owned();
    let base_revision = bootstrap["data"]["attempt"]["revision"]
        .as_i64()
        .unwrap() as i32;

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
                    serde_json::to_vec(&json!({
                        "attemptId": attempt_id.clone(),
                        "mutations": [{
                            "mutationId": "mutation-1",
                            "baseRevision": base_revision,
                            "type": "SetEssayText",
                            "taskId": "task1",
                            "value": "Draft 1"
                        }]
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let json = json_body(response).await;
    assert_eq!(
        json["data"]["attempt"]["writingAnswers"]["task1"],
        "Draft 1"
    );
    assert_eq!(json["data"]["attempt"]["answers"], json!({}));
    assert_eq!(json["data"]["attempt"]["currentQuestionId"], "task1");

    database.shutdown().await;
}

#[tokio::test]
async fn mutation_batch_accepts_objective_mutations_outside_the_current_section() {
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
    let attempt_id = bootstrap["data"]["attempt"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let attempt_token = bootstrap["data"]["attemptCredential"]["attemptToken"]
        .as_str()
        .unwrap()
        .to_owned();

    // Policy: cross-section objective mutations are accepted.
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
                    serde_json::to_vec(&json!({
                        "attemptId": attempt_id,
                        "mutations": [{
                            "mutationId": "mutation-1",
                            "baseRevision": 1,
                            "type": "SetScalar",
                            "questionId": "q1",
                            "value": "A"
                        }]
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let json = json_body(response).await;
    assert_eq!(json["data"]["attempt"]["answers"]["q1"], "A");

    database.shutdown().await;
}

#[tokio::test]
async fn mutation_batch_accepts_recent_previous_section_answer_during_section_transition() {
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
    SchedulingService::new(database.pool().clone())
        .apply_runtime_command(
            &contract_actor(),
            schedule_id,
            RuntimeCommandRequest {
                action: RuntimeCommandAction::StartRuntime,
                reason: Some("contract runtime start".to_owned()),
            },
        )
        .await
        .unwrap();
    transition_runtime_from_listening_to_reading(database.pool(), schedule_id).await;
    let attempt_id = bootstrap["data"]["attempt"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
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
                    serde_json::to_vec(&json!({
                        "attemptId": attempt_id,
                        "mutations": [
                            {
                                "mutationId": "mutation-late-listening-1",
                                "baseRevision": 1,
                                "type": "SetChoice",
                                "questionId": "q1",
                                "value": "T"
                            },
                            {
                                "mutationId": "mutation-live-reading-1",
                                "baseRevision": 1,
                                "type": "SetChoice",
                                "questionId": "r1",
                                "value": "T"
                            }
                        ]
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    let status = response.status();
    let json = json_body(response).await;
    assert_eq!(status, StatusCode::OK, "{json}");
    assert_eq!(json["data"]["appliedMutationCount"], 2);
    assert_eq!(json["data"]["serverAcceptedThroughSeq"], 2);
    assert_eq!(json["data"]["attempt"]["answers"]["q1"], "T");
    assert_eq!(json["data"]["attempt"]["answers"]["r1"], "T");

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
    let (bootstrap, _client_session_id) =
        bootstrap_attempt(&app, &auth, schedule_id, "alice", &student_key).await;
    SchedulingService::new(database.pool().clone())
        .apply_runtime_command(
            &contract_actor(),
            schedule_id,
            RuntimeCommandRequest {
                action: RuntimeCommandAction::StartRuntime,
                reason: Some("contract runtime start".to_owned()),
            },
        )
        .await
        .unwrap();
    let attempt_id = bootstrap["data"]["attempt"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
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
                    serde_json::to_vec(&json!({
                        "attemptId": attempt_id,
                        "mutations": [{
                            "mutationId": "mutation-1",
                            "baseRevision": 1,
                            "type": "SetEssayText",
                            "taskId": "task1",
                            "value": "hello"
                        }]
                    }))
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
async fn late_mutation_from_old_section_accepted_in_grace_then_section_mismatch_after_backdate() {
    let database = mysql::TestDatabase::new(DELIVERY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();
    let admin_auth = mysql::create_authenticated_user(
        database.pool(),
        UserRole::Admin,
        "admin@example.com",
        "Admin",
    )
    .await;
    let (student_auth, student_key) = create_student_auth(database.pool(), schedule_id, "alice").await;
    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));
    let (_bootstrap, _client_session_id) =
        bootstrap_attempt(&app, &student_auth, schedule_id, "alice", &student_key).await;
    let start = admin_runtime_command(
        &app,
        &admin_auth,
        schedule_id,
        json!({ "action": "start_runtime" }),
    )
    .await;
    assert_eq!(start.status(), StatusCode::OK);
    let (bootstrap_after_start, _) =
        bootstrap_attempt(&app, &student_auth, schedule_id, "alice", &student_key).await;
    let attempt_id = bootstrap_after_start["data"]["attempt"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let attempt_token = bootstrap_after_start["data"]["attemptCredential"]["attemptToken"]
        .as_str()
        .unwrap()
        .to_owned();
    let attempt_revision = bootstrap_after_start["data"]["attempt"]["revision"]
        .as_i64()
        .unwrap() as i32;

    // BEX-022: the proctor advances listening -> reading through the control
    // surface, not via a raw SQL transition.
    let advance = admin_end_section_now(
        &app,
        &admin_auth,
        schedule_id,
        json!({ "expectedActiveSectionKey": "listening", "reason": "advance to reading" }),
    )
    .await;
    assert_eq!(advance.status(), StatusCode::OK);
    assert_eq!(json_body(advance).await["data"]["activeSectionKey"], "reading");

    let mutation_request = async |question_id: &str, mutation_id: &str, revision: i32| {
        app.clone()
            .oneshot(
                with_attempt_token(Request::builder(), &attempt_token)
                    .method("POST")
                    .uri(format!(
                        "/api/v1/student/sessions/{schedule_id}/mutations:batch"
                    ))
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::to_vec(&json!({
                            "attemptId": attempt_id.clone(),
                            "mutations": [{
                                "mutationId": mutation_id,
                                "baseRevision": revision,
                                "type": "SetChoice",
                                "questionId": question_id,
                                "value": "T"
                            }]
                        }))
                        .unwrap(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap()
    };

    // (a) IMMEDIATELY after the advance the just-completed section is still in
    // the transition grace window: a late listening answer is accepted.
    let in_grace = mutation_request("q1", "mutation-late-listening-in-grace", attempt_revision).await;
    assert_eq!(in_grace.status(), StatusCode::OK);
    let in_grace_json = json_body(in_grace).await;
    assert_eq!(in_grace_json["data"]["appliedMutationCount"], 1);
    let revision_after_grace = in_grace_json["data"]["revision"].as_i64().unwrap() as i32;

    // (b) Backdate the completed section beyond the grace window: the same late
    // listening mutation must now surface the section-lock conflict.
    sqlx::query(
        r#"
        UPDATE exam_session_runtime_sections
        SET actual_end_at = NOW() - INTERVAL 360 SECOND
        WHERE runtime_id = (SELECT id FROM exam_session_runtimes WHERE schedule_id = ?)
          AND section_key = 'listening'
        "#,
    )
    .bind(schedule_id.to_string())
    .execute(database.pool())
    .await
    .expect("backdate listening actual end beyond grace");

    let past_grace = mutation_request("q1", "mutation-late-listening-past-grace", revision_after_grace).await;
    assert_eq!(past_grace.status(), StatusCode::CONFLICT);
    let past_grace_json = json_body(past_grace).await;
    assert_eq!(past_grace_json["error"]["code"], "CONFLICT");
    assert_eq!(
        past_grace_json["error"]["details"]["reason"],
        "SECTION_MISMATCH",
        "past-grace conflict body: {past_grace_json}"
    );
    assert!(
        past_grace_json["error"]["message"]
            .as_str()
            .unwrap()
            .contains("q1"),
        "the conflict must name the offending question: {past_grace_json}"
    );

    // (c) The ACTIVE section stays writable in the same state.
    let active_section = mutation_request("r1", "mutation-live-reading", revision_after_grace).await;
    assert_eq!(active_section.status(), StatusCode::OK);
    let active_section_json = json_body(active_section).await;
    assert_eq!(active_section_json["data"]["appliedMutationCount"], 1);
    assert_eq!(active_section_json["data"]["attempt"]["answers"]["r1"], "T");

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
    let attempt_id = bootstrap["data"]["attempt"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
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
                    serde_json::to_vec(&json!({
                        "attemptId": attempt_id,
                        "mutations": [{
                            "mutationId": "mutation-1",
                            "baseRevision": 1,
                            "type": "SetScalar",
                            "questionId": "q1",
                            "value": "A"
                        }]
                    }))
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
async fn mutation_batch_accepts_objective_mutations_when_runtime_paused() {
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
    let attempt_id = bootstrap["data"]["attempt"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let attempt_token = bootstrap["data"]["attemptCredential"]["attemptToken"]
        .as_str()
        .unwrap()
        .to_owned();
    let base_revision = bootstrap["data"]["attempt"]["revision"]
        .as_i64()
        .unwrap() as i32;

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
                    serde_json::to_vec(&json!({
                        "attemptId": attempt_id,
                        "mutations": [{
                            "mutationId": "mutation-1",
                            "baseRevision": base_revision,
                            "type": "SetScalar",
                            "questionId": "q1",
                            "value": "A"
                        }]
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let json = json_body(response).await;
    assert_eq!(json["data"]["appliedMutationCount"], 1);

    database.shutdown().await;
}

#[tokio::test]
async fn mutation_batch_rejects_invalid_values_for_each_supported_block_type() {
    let database = mysql::TestDatabase::new(DELIVERY_MIGRATIONS).await;
    let schedule = seed_schedule_with_slug_content_and_config(
        database.pool(),
        "cambridge-19-academic-delivery-invalid-block-matrix",
        delivery_block_matrix_content_snapshot(),
        sample_delivery_config(),
    )
    .await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();
    let (auth, student_key) = create_student_auth(database.pool(), schedule_id, "alice").await;
    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));
    let (bootstrap, client_session_id) =
        bootstrap_attempt(&app, &auth, schedule_id, "alice", &student_key).await;
    let attempt_id = bootstrap["data"]["attempt"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let attempt_token = bootstrap["data"]["attemptCredential"]["attemptToken"]
        .as_str()
        .unwrap()
        .to_owned();

    let invalid_cases = vec![
        ("reading", "r-tfng-q1", json!("X")),
        ("reading", "r-cloze-q1", json!(["not-a-string"])),
        ("reading", "r-matching-q1", json!("zzz")),
        ("reading", "r-map-q1", json!(true)),
        ("reading", "r-short-q1", json!(123)),
        ("reading", "r-sentence-q1", json!("single-string")),
        ("reading", "r-note-q1", json!(["a", "b"])),
        ("listening", "l-multi", json!(["A", "Z"])),
        ("listening", "l-single-q1", json!("Z")),
        ("listening", "l-single-legacy", json!("Q")),
        ("listening", "l-diagram", json!("nose")),
        ("listening", "l-flow", json!(["step-1", "step-2", "step-3"])),
        ("listening", "l-table", json!(["r1c1", "r1c2", "r1c3"])),
        ("listening", "l-classify", json!(["Gamma"])),
        ("listening", "l-match-features", json!(["Z"])),
    ];

    for (idx, (section_key, question_id, invalid_value)) in invalid_cases.iter().enumerate() {
        start_runtime(database.pool(), schedule_id, section_key).await;
        let response = app
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
                                id: format!("invalid-case-{idx}"),
                                seq: (idx + 1) as i64,
                                timestamp: Utc.with_ymd_and_hms(2026, 1, 10, 9, 5, 0).unwrap(),
                                command: command(
                                    MutationType::Answer,
                                    json!({"questionId": question_id, "value": invalid_value}),
                                ),
                                base_revision: None,
                            }],
                        })
                        .unwrap(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(
            response.status(),
            StatusCode::UNPROCESSABLE_ENTITY,
            "expected validation error for questionId={question_id}"
        );
        let json = json_body(response).await;
        assert_eq!(json["error"]["code"], "VALIDATION_ERROR");
    }

    database.shutdown().await;
}

#[tokio::test]
async fn mutation_batch_rejects_objective_mutations_when_runtime_waiting_for_next_section() {
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
    let attempt_id = bootstrap["data"]["attempt"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let attempt_token = bootstrap["data"]["attemptCredential"]["attemptToken"]
        .as_str()
        .unwrap()
        .to_owned();

    sqlx::query(
        "UPDATE exam_session_runtimes SET waiting_for_next_section = true WHERE schedule_id = ?",
    )
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
                            id: "mutation-waiting-lock-1".to_owned(),
                            seq: 1,
                            timestamp: Utc.with_ymd_and_hms(2026, 1, 10, 9, 5, 0).unwrap(),
                            command: command(
                                MutationType::Answer,
                                json!({"questionId": "q1", "value": "A"}),
                            ),
                            base_revision: None,
                        }],
                    })
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let json = json_body(response).await;
    assert_eq!(json["error"]["code"], "VALIDATION_ERROR");

    database.shutdown().await;
}

#[tokio::test]
async fn submit_blocks_while_runtime_live_with_unanswered_policy_block_but_allows_after_completed()
{
    let database = mysql::TestDatabase::new(DELIVERY_MIGRATIONS).await;
    let mut config_snapshot = sample_delivery_config();
    config_snapshot["progression"] = json!({ "unansweredSubmissionPolicy": "block" });
    let schedule = seed_schedule_with_slug_content_and_config(
        database.pool(),
        "cambridge-19-academic-delivery-unanswered-policy",
        default_delivery_content_snapshot(),
        config_snapshot,
    )
    .await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();
    let (auth, student_key) = create_student_auth(database.pool(), schedule_id, "alice").await;
    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));
    let (_bootstrap, _) = bootstrap_attempt(&app, &auth, schedule_id, "alice", &student_key).await;
    let actor = contract_actor();
    SchedulingService::new(database.pool().clone())
        .apply_runtime_command(
            &actor,
            schedule_id,
            RuntimeCommandRequest {
                action: RuntimeCommandAction::StartRuntime,
                reason: Some("contract runtime start".to_owned()),
            },
        )
        .await
        .unwrap();
    let (bootstrap_after_start, _) =
        bootstrap_attempt(&app, &auth, schedule_id, "alice", &student_key).await;
    let attempt_id = bootstrap_after_start["data"]["attempt"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let attempt_token = bootstrap_after_start["data"]["attemptCredential"]["attemptToken"]
        .as_str()
        .unwrap()
        .to_owned();
    let attempt_revision = bootstrap_after_start["data"]["attempt"]["revision"]
        .as_i64()
        .unwrap() as i32;

    let live_submit = app
        .clone()
        .oneshot(
            with_attempt_token(Request::builder(), &attempt_token)
                .method("POST")
                .uri(format!("/api/v1/student/sessions/{}/submit", schedule_id))
                .header("content-type", "application/json")
                .header("idempotency-key", "submit-live-unanswered-blocked")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "attemptId": attempt_id.clone(),
                        "lastSeenRevision": attempt_revision,
                        "submissionId": "submit-live-unanswered-blocked",
                        "clientFinalSeq": 0,
                        "serverAcceptedThroughSeq": 0
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(live_submit.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let live_json = json_body(live_submit).await;
    assert_eq!(live_json["error"]["code"], "VALIDATION_ERROR");

    SchedulingService::new(database.pool().clone())
        .apply_runtime_command(
            &actor,
            schedule_id,
            RuntimeCommandRequest {
                action: RuntimeCommandAction::EndRuntime,
                reason: Some("contract runtime end".to_owned()),
            },
        )
        .await
        .unwrap();

    let completed_submit = app
        .oneshot(
            with_attempt_token(Request::builder(), &attempt_token)
                .method("POST")
                .uri(format!("/api/v1/student/sessions/{}/submit", schedule_id))
                .header("content-type", "application/json")
                .header("idempotency-key", "submit-completed-unanswered-allowed")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "attemptId": attempt_id,
                        "lastSeenRevision": attempt_revision,
                        "submissionId": "submit-completed-unanswered-allowed",
                        "clientFinalSeq": 0,
                        "serverAcceptedThroughSeq": 0
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let completed_status = completed_submit.status();
    let completed_json = json_body(completed_submit).await;
    assert_eq!(
        completed_status,
        StatusCode::OK,
        "completed submit body: {}",
        completed_json
    );

    database.shutdown().await;
}

#[tokio::test]
async fn student_cannot_advance_runtime_and_submit_does_not_unlock_next_section() {
    let database = mysql::TestDatabase::new(DELIVERY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();
    let admin_auth = mysql::create_authenticated_user(
        database.pool(),
        UserRole::Admin,
        "admin@example.com",
        "Admin",
    )
    .await;
    let (student_auth, student_key) = create_student_auth(database.pool(), schedule_id, "alice").await;
    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));
    let (_bootstrap, _) = bootstrap_attempt(&app, &student_auth, schedule_id, "alice", &student_key).await;
    let start = admin_runtime_command(
        &app,
        &admin_auth,
        schedule_id,
        json!({ "action": "start_runtime" }),
    )
    .await;
    assert_eq!(start.status(), StatusCode::OK);
    let (bootstrap_after_start, _) =
        bootstrap_attempt(&app, &student_auth, schedule_id, "alice", &student_key).await;
    let attempt_id = bootstrap_after_start["data"]["attempt"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let attempt_token = bootstrap_after_start["data"]["attemptCredential"]["attemptToken"]
        .as_str()
        .unwrap()
        .to_owned();
    let attempt_revision = bootstrap_after_start["data"]["attempt"]["revision"]
        .as_i64()
        .unwrap() as i32;

    // BEX-022: the student principal cannot authoritatively advance the cohort.
    let forbidden = app
        .clone()
        .oneshot(
            student_auth.with_csrf(Request::builder())
                .method("POST")
                .uri(format!(
                    "/api/v1/proctor/sessions/{schedule_id}/control/end-section-now"
                ))
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({ "reason": "student attempted to advance" }))
                        .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(forbidden.status(), StatusCode::FORBIDDEN);
    let forbidden_json = json_body(forbidden).await;
    assert_eq!(forbidden_json["error"]["code"], "FORBIDDEN");
    assert_eq!(
        forbidden_json["error"]["message"],
        "The authenticated user is not allowed to access this route."
    );

    // BEX-022: alice's own submit seals HER attempt but must not advance or
    // unlock anything on the runtime side.
    let submit = app
        .clone()
        .oneshot(
            with_attempt_token(Request::builder(), &attempt_token)
                .method("POST")
                .uri(format!("/api/v1/student/sessions/{schedule_id}/submit"))
                .header("content-type", "application/json")
                .header("idempotency-key", "submit-no-advance")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "attemptId": attempt_id.clone(),
                        "lastSeenRevision": attempt_revision,
                        "submissionId": "submit-no-advance",
                        "clientFinalSeq": 0,
                        "serverAcceptedThroughSeq": 0
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(submit.status(), StatusCode::OK);
    let submit_json = json_body(submit).await;
    assert_eq!(submit_json["data"]["attempt"]["phase"], "post-exam");

    // The attempt is marked complete in the DB (submitted_at set)...
    let (phase, submitted_at): (String, Option<chrono::DateTime<Utc>>) = sqlx::query_as(
        "SELECT phase, submitted_at FROM student_attempts WHERE id = ?",
    )
    .bind(&attempt_id)
    .fetch_one(database.pool())
    .await
    .expect("attempt row");
    assert_eq!(phase, "post-exam");
    assert!(submitted_at.is_some(), "submit must seal the attempt");

    // ...while the runtime stays live on the same section and the next section
    // remains locked: student-visible state matches persisted reality.
    let runtime = admin_runtime_projection(&app, &admin_auth, schedule_id).await;
    let data = &runtime["data"];
    assert_eq!(data["status"], "live");
    assert_eq!(data["activeSectionKey"], "listening");
    assert_eq!(data["currentSectionKey"], "listening");
    let sections = data["sections"].as_array().expect("sections");
    assert_eq!(sections[0]["sectionKey"], "listening");
    assert_eq!(sections[0]["status"], "live");
    assert_eq!(sections[1]["sectionKey"], "reading");
    assert_eq!(sections[1]["status"], "locked", "submit must not unlock the next section");
    assert_eq!(data["revision"], 1, "no student action may bump the runtime revision");

    let (db_status, db_active, db_current): (String, Option<String>, Option<String>) = sqlx::query_as(
        "SELECT status, active_section_key, current_section_key FROM exam_session_runtimes WHERE schedule_id = ?",
    )
    .bind(schedule_id.to_string())
    .fetch_one(database.pool())
    .await
    .expect("runtime row");
    assert_eq!(db_status, "live");
    assert_eq!(db_active.as_deref(), Some("listening"));
    assert_eq!(db_current.as_deref(), Some("listening"));

    let advance_events: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM cohort_control_events WHERE schedule_id = ? AND action = 'end_section_now'",
    )
    .bind(schedule_id.to_string())
    .fetch_one(database.pool())
    .await
    .unwrap();
    assert_eq!(advance_events, 0, "student actions must not append control events");

    database.shutdown().await;
}

#[tokio::test]
async fn violation_mutation_is_rejected_by_public_mutation_batch_route() {
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
    let attempt_id = bootstrap["data"]["attempt"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
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
                    serde_json::to_vec(&json!({
                        "attemptId": attempt_id,
                        "mutations": [{
                            "id": "mutation-1",
                            "seq": 1,
                            "timestamp": "2026-01-10T09:05:00Z",
                            "mutationType": "violation",
                            "payload": {
                                "violations": [{
                                    "id": "v1",
                                    "timestamp": "2026-01-10T09:05:00Z",
                                    "type": "TEST_VIOLATION"
                                }]
                            }
                        }]
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let json = json_body(response).await;
    assert_eq!(json["error"]["code"], "VALIDATION_ERROR");

    database.shutdown().await;
}

#[tokio::test]
async fn position_mutation_is_rejected_by_public_mutation_batch_route() {
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
    let attempt_id = bootstrap["data"]["attempt"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
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
                    serde_json::to_vec(&json!({
                        "attemptId": attempt_id,
                        "mutations": [{
                            "id": "mutation-1",
                            "seq": 1,
                            "timestamp": "2026-01-10T09:05:00Z",
                            "mutationType": "position",
                            "payload": {
                                "phase": "post-exam",
                                "currentModule": "writing",
                                "currentQuestionId": "task1"
                            }
                        }]
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let json = json_body(response).await;
    assert_eq!(json["error"]["code"], "VALIDATION_ERROR");

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
    let attempt_id = bootstrap["data"]["attempt"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let attempt_token = bootstrap["data"]["attemptCredential"]["attemptToken"]
        .as_str()
        .unwrap()
        .to_owned();

    let mutations: Vec<ielts_backend_domain::attempt::MutationEnvelope> = (0..201)
        .map(|index| ielts_backend_domain::attempt::MutationEnvelope {
            id: format!("mutation-{}", index + 1),
            seq: (index + 1) as i64,
            timestamp: Utc.with_ymd_and_hms(2026, 1, 10, 9, 5, 0).unwrap(),
            command: command(MutationType::Violation, json!({"violations": []})),
            base_revision: None,
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
    let attempt_id = bootstrap["data"]["attempt"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
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
                    serde_json::to_vec(&json!({
                        "attemptId": attempt_id,
                        "mutations": [{
                            "mutationId": "mutation-1",
                            "baseRevision": 1,
                            "type": "SetScalar",
                            "questionId": "q1",
                            "value": "A"
                        }]
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    let json = json_body(response).await;
    assert_eq!(json["error"]["code"], "FORBIDDEN");

    database.shutdown().await;
}

// BEX-001 — Student opens an enrolled schedule.
// The read-only session/static/live endpoints must return the schedule, the
// published exam version, and the runtime status without creating an attempt,
// and must never expose another candidate's attempt to the requesting student.
#[tokio::test]
async fn read_only_session_requests_do_not_create_an_attempt_nor_expose_another_candidates_attempt()
{
    let database = mysql::TestDatabase::new(DELIVERY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();
    let (auth_alice, _alice_key) = create_student_auth(database.pool(), schedule_id, "alice").await;
    let (auth_bob, bob_key) =
        create_student_auth_with_wcode(database.pool(), schedule_id, "bob", "W000002").await;
    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));

    // Bob's attempt exists (he already went through pre-check + bootstrap). Alice
    // never bootstrapped.
    let (bob_bootstrap, _) = bootstrap_attempt(&app, &auth_bob, schedule_id, "bob", &bob_key).await;
    let bob_attempt_id = bob_bootstrap["data"]["attempt"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let bob_student_key =
        sqlx::query_scalar::<_, String>("SELECT student_key FROM student_attempts WHERE id = ?")
            .bind(&bob_attempt_id)
            .fetch_one(database.pool())
            .await
            .unwrap();
    assert_eq!(bob_student_key, bob_key);

    // Alice requests the session context while asking for candidateId=bob. The
    // attempt lookup is driven by Alice's own enrollment (student key), so Bob's
    // attempt must not come back.
    let session_response = app
        .clone()
        .oneshot(
            auth_alice.with_auth(Request::builder().uri(format!(
                "/api/v1/student/sessions/{schedule_id}?candidateId=bob"
            )))
            .body(Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    let session_status = session_response.status();
    let session_json = json_body(session_response).await;
    assert_eq!(session_status, StatusCode::OK, "session: {session_json}");
    assert_eq!(session_json["data"]["schedule"]["id"], schedule.id.to_string());
    assert_eq!(
        session_json["data"]["version"]["id"],
        schedule.published_version_id.to_string()
    );
    assert_eq!(session_json["data"]["runtime"]["status"], "not_started");
    assert_eq!(session_json["data"]["attempt"], serde_json::Value::Null);

    // Static session context: schedule + published version, no attempt/runtime.
    let static_response = app
        .clone()
        .oneshot(
            auth_alice.with_auth(Request::builder().uri(format!(
                "/api/v1/student/sessions/{schedule_id}/static"
            )))
            .body(Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    let static_status = static_response.status();
    let static_json = json_body(static_response).await;
    assert_eq!(static_status, StatusCode::OK, "static: {static_json}");
    assert_eq!(static_json["data"]["schedule"]["id"], schedule.id.to_string());
    assert_eq!(
        static_json["data"]["version"]["id"],
        schedule.published_version_id.to_string()
    );
    assert_eq!(static_json["data"]["runtime"], serde_json::Value::Null);
    assert!(static_json["data"].get("attempt").is_none());

    // Live session context: runtime status returned, attempt still null for Alice.
    let live_response = app
        .clone()
        .oneshot(
            auth_alice.with_auth(Request::builder().uri(format!(
                "/api/v1/student/sessions/{schedule_id}/live?candidateId=bob"
            )))
            .body(Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    let live_status = live_response.status();
    let live_json = json_body(live_response).await;
    assert_eq!(live_status, StatusCode::OK, "live: {live_json}");
    assert_eq!(live_json["data"]["runtime"]["status"], "not_started");
    assert_eq!(live_json["data"]["attempt"], serde_json::Value::Null);

    // None of the read-only requests created an attempt; Bob's is the only row.
    let attempt_keys: Vec<String> = sqlx::query_scalar(
        "SELECT student_key FROM student_attempts WHERE schedule_id = ?",
    )
    .bind(schedule_id.to_string())
    .fetch_all(database.pool())
    .await
    .unwrap();
    assert_eq!(
        attempt_keys,
        vec![bob_key],
        "read-only requests must not create an attempt and must not expose Bob's attempt"
    );

    database.shutdown().await;
}

// BEX-002 — Request body carries an attemptId that differs from the
// route-authorized attempt → 422 VALIDATION_ERROR on the mutation batch and
// submit endpoints that accept an attemptId in the body.
#[tokio::test]
async fn mutation_batch_rejects_request_body_with_another_attempt_id() {
    let database = mysql::TestDatabase::new(DELIVERY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();
    let (auth, student_key) = create_student_auth(database.pool(), schedule_id, "alice").await;
    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));
    let (bootstrap, _) = bootstrap_attempt(&app, &auth, schedule_id, "alice", &student_key).await;
    let attempt_token = bootstrap["data"]["attemptCredential"]["attemptToken"]
        .as_str()
        .unwrap()
        .to_owned();
    let base_revision = bootstrap["data"]["attempt"]["revision"]
        .as_i64()
        .unwrap() as i32;

    let response = app
        .oneshot(
            with_attempt_token(Request::builder(), &attempt_token)
                .method("POST")
                .uri(format!(
                    "/api/v1/student/sessions/{schedule_id}/mutations:batch"
                ))
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "attemptId": Uuid::new_v4().to_string(),
                        "mutations": [{
                            "mutationId": "mutation-foreign-attempt-1",
                            "baseRevision": base_revision,
                            "type": "SetScalar",
                            "questionId": "q1",
                            "value": "A"
                        }]
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let json = json_body(response).await;
    assert_eq!(json["error"]["code"], "VALIDATION_ERROR");
    assert_eq!(json["success"], false);

    database.shutdown().await;
}

#[tokio::test]
async fn submit_rejects_request_body_with_another_attempt_id() {
    let database = mysql::TestDatabase::new(DELIVERY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();
    let (auth, student_key) = create_student_auth(database.pool(), schedule_id, "alice").await;
    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));
    let (bootstrap, _) = bootstrap_attempt(&app, &auth, schedule_id, "alice", &student_key).await;
    start_runtime(database.pool(), schedule_id, "listening").await;
    let attempt_token = bootstrap["data"]["attemptCredential"]["attemptToken"]
        .as_str()
        .unwrap()
        .to_owned();
    let base_revision = bootstrap["data"]["attempt"]["revision"]
        .as_i64()
        .unwrap() as i32;

    let response = app
        .oneshot(
            with_attempt_token(Request::builder(), &attempt_token)
                .method("POST")
                .uri(format!("/api/v1/student/sessions/{schedule_id}/submit"))
                .header("content-type", "application/json")
                .header("idempotency-key", "submit-foreign-attempt-1")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "attemptId": Uuid::new_v4().to_string(),
                        "lastSeenRevision": base_revision,
                        "submissionId": "submit-foreign-attempt-1",
                        "clientFinalSeq": 0,
                        "serverAcceptedThroughSeq": 0
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let json = json_body(response).await;
    assert_eq!(json["error"]["code"], "VALIDATION_ERROR");
    assert_eq!(json["success"], false);

    database.shutdown().await;
}

// BEX-002 — Expired attempt token → 401 UNAUTHORIZED.
// Tokens are HMAC-signed `AttemptTokenClaims` carrying `exp`; an explicitly
// past-dated signature is rejected by the `AttemptPrincipal` extractor before
// the route logic runs.
#[tokio::test]
async fn expired_attempt_token_is_rejected_with_unauthorized() {
    let database = mysql::TestDatabase::new(DELIVERY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();
    let (auth, student_key) = create_student_auth(database.pool(), schedule_id, "alice").await;
    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));
    let (bootstrap, _) = bootstrap_attempt(&app, &auth, schedule_id, "alice", &student_key).await;
    let attempt_id = bootstrap["data"]["attempt"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let base_revision = bootstrap["data"]["attempt"]["revision"]
        .as_i64()
        .unwrap() as i32;

    let expired_token = sign_attempt_token(
        &AppConfig::default(),
        &AttemptTokenClaims {
            token_id: "expired-token-id".to_owned(),
            user_id: auth.user_id.to_string(),
            schedule_id: schedule_id.to_string(),
            attempt_id: attempt_id.clone(),
            client_session_id: "expired-client-session-1".to_owned(),
            exp: Utc::now() - Duration::seconds(60),
        },
    );

    let response = app
        .oneshot(
            with_attempt_token(Request::builder(), &expired_token)
                .method("POST")
                .uri(format!(
                    "/api/v1/student/sessions/{schedule_id}/mutations:batch"
                ))
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "attemptId": attempt_id,
                        "mutations": [{
                            "mutationId": "mutation-expired-token-1",
                            "baseRevision": base_revision,
                            "type": "SetScalar",
                            "questionId": "q1",
                            "value": "A"
                        }]
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    let json = json_body(response).await;
    assert_eq!(json["error"]["code"], "UNAUTHORIZED");
    assert_eq!(json["success"], false);

    database.shutdown().await;
}

// BEX-002 — Student is not enrolled for the schedule → 403 FORBIDDEN. The
// enrollment check happens before any delivery work: a student user with no
// `schedule_registrations` row for the schedule is rejected by every student
// session endpoint.
#[tokio::test]
async fn student_not_enrolled_for_schedule_receives_forbidden() {
    let database = mysql::TestDatabase::new(DELIVERY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();
    let unenrolled = mysql::create_authenticated_user(
        database.pool(),
        UserRole::Student,
        "charlie@example.com",
        "Charlie Candidate",
    )
    .await;
    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));

    let session_response = app
        .clone()
        .oneshot(
            unenrolled.with_auth(Request::builder().uri(format!(
                "/api/v1/student/sessions/{schedule_id}?candidateId=charlie"
            )))
            .body(Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(session_response.status(), StatusCode::FORBIDDEN);
    let session_json = json_body(session_response).await;
    assert_eq!(session_json["error"]["code"], "FORBIDDEN");
    assert_eq!(session_json["success"], false);

    let live_response = app
        .clone()
        .oneshot(
            unenrolled.with_auth(Request::builder().uri(format!(
                "/api/v1/student/sessions/{schedule_id}/live?candidateId=charlie"
            )))
            .body(Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(live_response.status(), StatusCode::FORBIDDEN);
    let live_json = json_body(live_response).await;
    assert_eq!(live_json["error"]["code"], "FORBIDDEN");

    let static_response = app
        .oneshot(
            unenrolled.with_auth(Request::builder().uri(format!(
                "/api/v1/student/sessions/{schedule_id}/static"
            )))
            .body(Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(static_response.status(), StatusCode::FORBIDDEN);
    let static_json = json_body(static_response).await;
    assert_eq!(static_json["error"]["code"], "FORBIDDEN");

    database.shutdown().await;
}

// BEX-003 — Active client-session ownership, mutation path.
// Session A accepts q1="A"; Session B then writes the same question from an
// OLDER base revision. The mutation batch path enforces `baseRevision` against
// the attempt's current revision: a batch based strictly below the current
// revision is rejected atomically with 409 CONFLICT / `BASE_REVISION_MISMATCH`
// carrying `latestRevision`, the accepted per-session mutation watermark
// (`serverAcceptedThroughSeq`), and the active session that owns the accepted
// state (`activeSessionId`), so Session A's answer is preserved and no partial
// state is persisted for Session B's stale batch.
#[tokio::test]
async fn mutation_batch_from_second_client_session_with_stale_base_revision_returns_conflict_and_preserves_first_client_answer()
{
    let database = mysql::TestDatabase::new(DELIVERY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();
    let (auth, student_key) = create_student_auth(database.pool(), schedule_id, "alice").await;
    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));

    let (bootstrap_a, _session_a) = bootstrap_attempt_with_client_session_id(
        &app,
        &auth,
        schedule_id,
        "alice",
        &student_key,
        "phone-client-1",
    )
    .await;
    let (bootstrap_b, _session_b) = bootstrap_attempt_with_client_session_id(
        &app,
        &auth,
        schedule_id,
        "alice",
        &student_key,
        "computer-client-1",
    )
    .await;
    let attempt_id = bootstrap_a["data"]["attempt"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    assert_eq!(bootstrap_b["data"]["attempt"]["id"], attempt_id);
    let attempt_token_a = bootstrap_a["data"]["attemptCredential"]["attemptToken"]
        .as_str()
        .unwrap()
        .to_owned();
    let attempt_token_b = bootstrap_b["data"]["attemptCredential"]["attemptToken"]
        .as_str()
        .unwrap()
        .to_owned();
    let base_revision = bootstrap_a["data"]["attempt"]["revision"]
        .as_i64()
        .unwrap() as i32;

    // Session A accepts q1 = "A"; the server revision and watermark advance.
    let session_a_response = app
        .clone()
        .oneshot(
            with_attempt_token(Request::builder(), &attempt_token_a)
                .method("POST")
                .uri(format!(
                    "/api/v1/student/sessions/{schedule_id}/mutations:batch"
                ))
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "attemptId": attempt_id.clone(),
                        "mutations": [{
                            "mutationId": "mutation-session-a-1",
                            "baseRevision": base_revision,
                            "type": "SetScalar",
                            "questionId": "q1",
                            "value": "A"
                        }]
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let session_a_status = session_a_response.status();
    let session_a_body = json_body(session_a_response).await;
    assert_eq!(session_a_status, StatusCode::OK);
    let session_a_json = session_a_body;
    assert_eq!(session_a_json["data"]["appliedMutationCount"], 1);
    assert_eq!(session_a_json["data"]["serverAcceptedThroughSeq"], 1);
    let revision_after_a = session_a_json["data"]["revision"].as_i64().unwrap();
    assert_eq!(revision_after_a, base_revision as i64 + 1);

    // Session B writes the same question from the stale base revision.
    let session_b_response = app
        .oneshot(
            with_attempt_token(Request::builder(), &attempt_token_b)
                .method("POST")
                .uri(format!(
                    "/api/v1/student/sessions/{schedule_id}/mutations:batch"
                ))
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "attemptId": attempt_id.clone(),
                        "mutations": [{
                            "mutationId": "mutation-session-b-1",
                            "baseRevision": base_revision,
                            "type": "SetScalar",
                            "questionId": "q1",
                            "value": "B"
                        }]
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    // The stale batch must be rejected atomically: 409 BASE_REVISION_MISMATCH
    // carrying the current revision, the per-session accepted watermark, and
    // the active writer session. Session A's answer stays authoritative.
    let session_b_status = session_b_response.status();
    let session_b_json = json_body(session_b_response).await;
    assert_eq!(
        session_b_status,
        StatusCode::CONFLICT,
        "stale base revision batch: {session_b_json}"
    );
    assert_eq!(session_b_json["error"]["code"], "CONFLICT");
    assert_eq!(
        session_b_json["error"]["details"]["reason"],
        "BASE_REVISION_MISMATCH",
        "stale batch response: {session_b_json}"
    );
    assert_eq!(
        session_b_json["error"]["details"]["latestRevision"]
            .as_i64()
            .unwrap(),
        revision_after_a,
        "conflict must report the attempt's current accepted revision"
    );
    // The per-session accepted mutation watermark of the requesting session
    // has not advanced (Session B has no accepted mutations), matching the
    // `serverAcceptedThroughSeq` semantics of mutation success responses.
    assert_eq!(
        session_b_json["error"]["details"]["serverAcceptedThroughSeq"]
            .as_i64()
            .unwrap(),
        0,
        "stale batch response: {session_b_json}"
    );
    // The conflict identifies the session that owns the accepted state.
    assert_eq!(
        session_b_json["error"]["details"]["activeSessionId"],
        "phone-client-1",
        "stale batch response: {session_b_json}"
    );

    let answers: serde_json::Value =
        sqlx::query_scalar("SELECT answers FROM student_attempts WHERE id = ?")
            .bind(&attempt_id)
            .fetch_one(database.pool())
            .await
            .unwrap();
    assert_eq!(
        answers["q1"], "A",
        "the stale session's batch must not overwrite the first session's accepted answer"
    );
    let stored_revision: i32 =
        sqlx::query_scalar("SELECT revision FROM student_attempts WHERE id = ?")
            .bind(&attempt_id)
            .fetch_one(database.pool())
            .await
            .unwrap();
    assert_eq!(
        stored_revision, revision_after_a as i32,
        "a rejected stale batch must not advance the attempt revision"
    );

    database.shutdown().await;
}

// BEX-003 + BEX-033 — a base-revision conflict is NOT a poison pill. The
// rejected batch persisted nothing, so re-flushing the SAME mutations at the
// CURRENT revision (exactly what the client reconciliation does after
// refetching the session) succeeds and applies each mutation exactly once
// (idempotency across conflict); a later identical replay is a 200 no-op.
#[tokio::test]
async fn mutation_batch_rejected_for_stale_revision_then_replayed_latest_revision_applies_once() {
    let database = mysql::TestDatabase::new(DELIVERY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();
    let (auth, student_key) = create_student_auth(database.pool(), schedule_id, "alice").await;
    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));

    let (bootstrap_a, _session_a) = bootstrap_attempt_with_client_session_id(
        &app,
        &auth,
        schedule_id,
        "alice",
        &student_key,
        "phone-client-1",
    )
    .await;
    let (bootstrap_b, _session_b) = bootstrap_attempt_with_client_session_id(
        &app,
        &auth,
        schedule_id,
        "alice",
        &student_key,
        "computer-client-1",
    )
    .await;
    let attempt_id = bootstrap_a["data"]["attempt"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let attempt_token_a = bootstrap_a["data"]["attemptCredential"]["attemptToken"]
        .as_str()
        .unwrap()
        .to_owned();
    let attempt_token_b = bootstrap_b["data"]["attemptCredential"]["attemptToken"]
        .as_str()
        .unwrap()
        .to_owned();
    let base_revision = bootstrap_a["data"]["attempt"]["revision"]
        .as_i64()
        .unwrap() as i32;
    let batch_uri = format!("/api/v1/student/sessions/{schedule_id}/mutations:batch");

    // Session A accepts q1 = "A"; the server revision advances.
    let session_a_response = app
        .clone()
        .oneshot(
            with_attempt_token(Request::builder(), &attempt_token_a)
                .method("POST")
                .uri(&batch_uri)
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "attemptId": attempt_id.clone(),
                        "mutations": [{
                            "mutationId": "mutation-session-a-1",
                            "baseRevision": base_revision,
                            "type": "SetScalar",
                            "questionId": "q1",
                            "value": "A"
                        }]
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(session_a_response.status(), StatusCode::OK);
    let session_a_json = json_body(session_a_response).await;
    let revision_after_a = session_a_json["data"]["revision"].as_i64().unwrap();

    // Session B flushes the target mutation from the stale base → 409, and
    // NOTHING is persisted for it.
    let session_b_mutation = json!({
        "attemptId": attempt_id.clone(),
        "mutations": [{
            "mutationId": "mutation-session-b-1",
            "baseRevision": base_revision,
            "type": "SetScalar",
            "questionId": "q1",
            "value": "B2"
        }]
    });
    let stale_response = app
        .clone()
        .oneshot(
            with_attempt_token(Request::builder(), &attempt_token_b)
                .method("POST")
                .uri(&batch_uri)
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_vec(&session_b_mutation).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(stale_response.status(), StatusCode::CONFLICT);
    let stale_json = json_body(stale_response).await;
    assert_eq!(
        stale_json["error"]["details"]["reason"],
        "BASE_REVISION_MISMATCH",
        "stale batch response: {stale_json}"
    );
    assert_eq!(
        stale_json["error"]["details"]["latestRevision"]
            .as_i64()
            .unwrap(),
        revision_after_a
    );

    // The client reconciles: refetch state and re-flush the SAME mutation id
    // at the CURRENT revision. It must be applied exactly once.
    let reconciled = json!({
        "attemptId": attempt_id.clone(),
        "mutations": [{
            "mutationId": "mutation-session-b-1",
            "baseRevision": revision_after_a,
            "type": "SetScalar",
            "questionId": "q1",
            "value": "B2"
        }]
    });
    let retry_response = app
        .clone()
        .oneshot(
            with_attempt_token(Request::builder(), &attempt_token_b)
                .method("POST")
                .uri(&batch_uri)
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_vec(&reconciled).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(
        retry_response.status(),
        StatusCode::OK,
        "replaying the same mutation at the current revision must be accepted"
    );
    let retry_json = json_body(retry_response).await;
    assert_eq!(retry_json["data"]["appliedMutationCount"], 1);
    assert_eq!(
        retry_json["data"]["revision"].as_i64().unwrap(),
        revision_after_a + 1
    );

    // A later identical replay (e.g. reconnect retry) is a 200 no-op even
    // though its base is now stale again: already-applied mutation ids
    // short-circuit BEFORE the base-revision gate (BEX-033).
    let replay_response = app
        .oneshot(
            with_attempt_token(Request::builder(), &attempt_token_b)
                .method("POST")
                .uri(&batch_uri)
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_vec(&reconciled).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(replay_response.status(), StatusCode::OK);
    let replay_json = json_body(replay_response).await;
    assert_eq!(replay_json["data"]["appliedMutationCount"], 0);

    let stored_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM student_attempt_mutations WHERE attempt_id = ? AND client_mutation_id = ?",
    )
    .bind(&attempt_id)
    .bind("mutation-session-b-1")
    .fetch_one(database.pool())
    .await
    .unwrap();
    assert_eq!(
        stored_count, 1,
        "the replayed mutation must be persisted exactly once"
    );

    let answers: serde_json::Value =
        sqlx::query_scalar("SELECT answers FROM student_attempts WHERE id = ?")
            .bind(&attempt_id)
            .fetch_one(database.pool())
            .await
            .unwrap();
    assert_eq!(answers["q1"], "B2");

    database.shutdown().await;
}

// BEX-003 — Active client-session ownership, submit path.
// After Session A's mutations advance the attempt revision, Session B submits
// with a stale `lastSeenRevision`. The submit path enforces revision
// freshness and returns the documented conflict shape: 409 CONFLICT with
// reason `BASE_REVISION_MISMATCH`, `latestRevision`, and the active session
// that owns the accepted state (`activeSessionId`), without sealing the
// attempt or overwriting the valid session's answer.
#[tokio::test]
async fn submit_from_second_client_session_with_stale_revision_returns_base_revision_mismatch_conflict()
{
    let database = mysql::TestDatabase::new(DELIVERY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();
    let (auth, student_key) = create_student_auth(database.pool(), schedule_id, "alice").await;
    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));

    let (bootstrap_a, _session_a) = bootstrap_attempt_with_client_session_id(
        &app,
        &auth,
        schedule_id,
        "alice",
        &student_key,
        "phone-client-1",
    )
    .await;
    let (bootstrap_b, _session_b) = bootstrap_attempt_with_client_session_id(
        &app,
        &auth,
        schedule_id,
        "alice",
        &student_key,
        "computer-client-1",
    )
    .await;
    // The runtime gate row is created by the proctor-side StartRuntime
    // command; a bare UPDATE on `exam_session_runtimes` is a silent no-op
    // until that row exists (see SchedulingService::start_runtime).
    SchedulingService::new(database.pool().clone())
        .apply_runtime_command(
            &contract_actor(),
            schedule_id,
            RuntimeCommandRequest {
                action: RuntimeCommandAction::StartRuntime,
                reason: Some("contract runtime start (BEX-003)".to_owned()),
            },
        )
        .await
        .unwrap();
    let attempt_id = bootstrap_a["data"]["attempt"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let attempt_token_a = bootstrap_a["data"]["attemptCredential"]["attemptToken"]
        .as_str()
        .unwrap()
        .to_owned();
    let attempt_token_b = bootstrap_b["data"]["attemptCredential"]["attemptToken"]
        .as_str()
        .unwrap()
        .to_owned();
    let base_revision = bootstrap_a["data"]["attempt"]["revision"]
        .as_i64()
        .unwrap() as i32;

    let mutation_response = app
        .clone()
        .oneshot(
            with_attempt_token(Request::builder(), &attempt_token_a)
                .method("POST")
                .uri(format!(
                    "/api/v1/student/sessions/{schedule_id}/mutations:batch"
                ))
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "attemptId": attempt_id.clone(),
                        "mutations": [{
                            "mutationId": "mutation-session-a-1",
                            "baseRevision": base_revision,
                            "type": "SetScalar",
                            "questionId": "q1",
                            "value": "A"
                        }]
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(mutation_response.status(), StatusCode::OK);
    let mutation_json = json_body(mutation_response).await;
    let revision_after_a = mutation_json["data"]["revision"].as_i64().unwrap();
    assert_eq!(revision_after_a, base_revision as i64 + 1);
    assert_eq!(
        mutation_json["data"]["attempt"]["phase"], "exam",
        "session A mutation with a live runtime gate must persist phase `exam`"
    );

    // Session B submits with the pre-Session-A revision.
    let submit_response = app
        .oneshot(
            with_attempt_token(Request::builder(), &attempt_token_b)
                .method("POST")
                .uri(format!("/api/v1/student/sessions/{schedule_id}/submit"))
                .header("content-type", "application/json")
                .header("idempotency-key", "submit-stale-session-b")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "attemptId": attempt_id.clone(),
                        "lastSeenRevision": base_revision,
                        "submissionId": "submit-stale-session-b",
                        "clientFinalSeq": 0,
                        "serverAcceptedThroughSeq": 1
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(submit_response.status(), StatusCode::CONFLICT);
    let submit_json = json_body(submit_response).await;
    assert_eq!(submit_json["error"]["code"], "CONFLICT");
    assert_eq!(
        submit_json["error"]["details"]["reason"],
        "BASE_REVISION_MISMATCH",
        "stale submit response: {submit_json}"
    );
    assert_eq!(
        submit_json["error"]["details"]["latestRevision"]
            .as_i64()
            .unwrap(),
        revision_after_a
    );
    assert_eq!(
        submit_json["error"]["details"]["activeSessionId"],
        "phone-client-1",
        "the stale submit conflict must identify the session that owns the accepted state: {submit_json}"
    );

    // Session A's accepted answer is preserved and the attempt is not sealed.
    let answers: serde_json::Value =
        sqlx::query_scalar("SELECT answers FROM student_attempts WHERE id = ?")
            .bind(&attempt_id)
            .fetch_one(database.pool())
            .await
            .unwrap();
    assert_eq!(answers["q1"], "A");
    let submitted_at: Option<chrono::DateTime<Utc>> = sqlx::query_scalar(
        "SELECT submitted_at FROM student_attempts WHERE id = ?",
    )
    .bind(&attempt_id)
    .fetch_one(database.pool())
    .await
    .unwrap();
    assert!(submitted_at.is_none(), "stale submit must not seal the attempt");

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

// `schedule_registrations` enforces UNIQUE(schedule_id, wcode), so a second
// registration on the same schedule must be inserted with a distinct access
// code (the shared helper always uses the empty default).
async fn create_student_auth_with_wcode(
    pool: &sqlx::MySqlPool,
    schedule_id: Uuid,
    candidate_id: &str,
    wcode: &str,
) -> (mysql::TestAuthContext, String) {
    let auth = mysql::create_authenticated_user(
        pool,
        UserRole::Student,
        &format!("{candidate_id}@example.com"),
        &format!("{candidate_id} Candidate"),
    )
    .await;
    let student_key = format!("student-{schedule_id}-{candidate_id}");
    sqlx::query(
        r#"
        INSERT INTO schedule_registrations (
            id, schedule_id, user_id, actor_id, student_key, student_id, student_name, student_email,
            wcode, access_state, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'checked_in', NOW(), NOW())
        "#,
    )
    .bind(Uuid::new_v4().to_string())
    .bind(schedule_id.to_string())
    .bind(auth.user_id.to_string())
    .bind(auth.user_id.to_string())
    .bind(&student_key)
    .bind(candidate_id)
    .bind(format!("{candidate_id} Candidate"))
    .bind(format!("{candidate_id}@example.com"))
    .bind(wcode)
    .execute(pool)
    .await
    .unwrap();
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
    seed_schedule_with_slug_content_and_config(
        pool,
        slug,
        default_delivery_content_snapshot(),
        sample_delivery_config(),
    )
    .await
}

async fn seed_schedule_with_slug_content_and_config(
    pool: &sqlx::MySqlPool,
    slug: &str,
    content_snapshot: serde_json::Value,
    config_snapshot: serde_json::Value,
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
                content_snapshot,
                config_snapshot,
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

fn default_delivery_content_snapshot() -> serde_json::Value {
    json!({
        "reading": {"passages": [{"id": "reading-1", "title": "Reading Passage 1", "blocks": [{"type": "TFNG", "mode": "TFNG", "questions": [{"id": "r1"}]}]}]},
        "listening": {"parts": [{"id": "listening-1", "title": "Listening Part 1", "blocks": [
            {"type": "TFNG", "mode": "TFNG", "questions": [{"id": "q1"}]},
            {"id": "l-choice-1", "type": "SINGLE_MCQ", "questions": [{"id": "l-choice-1", "stem": "Pick one", "options": [{"id": "A", "text": "Option A", "isCorrect": false}, {"id": "B", "text": "Option B", "isCorrect": true}, {"id": "C", "text": "Option C", "isCorrect": false}]}]},
            {"id": "l-blank-2", "type": "SENTENCE_COMPLETION", "questions": [{"id": "l-blank-2", "sentence": "Fill __ then __.", "blanks": [{"id": "l-blank-2:b1", "correctAnswer": "first"}, {"id": "l-blank-2:b2", "correctAnswer": "second"}]}]},
            {"id": "l-tfng-1", "type": "TFNG", "mode": "TFNG", "questions": [{"id": "l-tfng-1", "statement": "The sky is blue.", "correctAnswer": "T"}]},
            {"id": "l-short-1", "type": "SHORT_ANSWER", "questions": [{"id": "l-short-1", "prompt": "Name the diagram", "correctAnswer": "diagram"}]},
            {"id": "l-short-2", "type": "SHORT_ANSWER", "questions": [{"id": "l-short-2", "prompt": "Name the fuel", "correctAnswer": "petrol"}]},
            {"id": "l-multi-1", "type": "MULTI_MCQ", "stem": "Select two answers.", "requiredSelections": 2, "options": [{"id": "A", "text": "Option A", "isCorrect": true}, {"id": "B", "text": "Option B", "isCorrect": false}, {"id": "C", "text": "Option C", "isCorrect": true}, {"id": "D", "text": "Option D", "isCorrect": false}]},
            {"id": "l-match-1", "type": "MATCHING", "headings": [{"id": "h1", "text": "Heading I"}, {"id": "h2", "text": "Heading II"}, {"id": "h3", "text": "Heading III"}], "questions": [{"id": "l-match-q1", "statement": "Match this to a heading.", "correctAnswer": "ii"}]},
            {"id": "l-map-1", "type": "DIAGRAM_LABELING", "imageUrl": "https://example.com/diagram.png", "labels": [{"id": "l1", "correctAnswer": "nose"}, {"id": "l2", "correctAnswer": "ear"}]},
            {"id": "l-blank-shared-1", "type": "SENTENCE_COMPLETION", "questions": [{"id": "l-blank-shared-1", "sentence": "Complete: __", "acceptAnyAnswerKey": true, "sharedAcceptedAnswers": ["apple"], "blanks": [{"id": "l-blank-shared-1:b1"}]}]}
        ]}]},
        "writing": {"task1Prompt": "Summarise the chart.", "task2Prompt": "Discuss both views.", "tasks": [{"id": "writing-1"}]},
        "speaking": {"part1Topics": ["topic"], "cueCard": "cue", "part3Discussion": ["discussion"]}
    })
}

fn delivery_block_matrix_content_snapshot() -> serde_json::Value {
    json!({
        "reading": {
            "passages": [{
                "id": "reading-matrix-p1",
                "title": "Reading Passage Matrix",
                "blocks": [
                    { "id": "r-tfng", "type": "TFNG", "mode": "TFNG", "questions": [{ "id": "r-tfng-q1", "statement": "Statement 1" }] },
                    { "id": "r-cloze", "type": "CLOZE", "questions": [{ "id": "r-cloze-q1", "prompt": "Fill blank" }] },
                    { "id": "r-matching", "type": "MATCHING", "headings": [{ "id": "i", "text": "Heading I" }, { "id": "ii", "text": "Heading II" }], "questions": [{ "id": "r-matching-q1", "statement": "Match this" }] },
                    { "id": "r-map", "type": "MAP", "questions": [{ "id": "r-map-q1", "label": "Spot A" }] },
                    { "id": "r-short", "type": "SHORT_ANSWER", "questions": [{ "id": "r-short-q1", "prompt": "Name the animal", "correctAnswer": "fox" }] },
                    { "id": "r-sentence", "type": "SENTENCE_COMPLETION", "questions": [{ "id": "r-sentence-q1", "sentence": "Fill __ then __.", "blanks": [{ "id": "b1", "correctAnswer": "first" }, { "id": "b2", "correctAnswer": "second" }] }] },
                    { "id": "r-note", "type": "NOTE_COMPLETION", "questions": [{ "id": "r-note-q1", "noteText": "Write a note __.", "blanks": [{ "id": "n1", "correctAnswer": "note answer" }] }] }
                ]
            }]
        },
        "listening": {
            "parts": [{
                "id": "listening-matrix-p1",
                "title": "Listening Part Matrix",
                "blocks": [
                    { "id": "l-multi", "type": "MULTI_MCQ", "stem": "Select the correct answers.", "requiredSelections": 2, "options": [{ "id": "A", "text": "Option A", "isCorrect": true }, { "id": "B", "text": "Option B", "isCorrect": false }, { "id": "C", "text": "Option C", "isCorrect": true }] },
                    { "id": "l-single-question-set", "type": "SINGLE_MCQ", "questions": [{ "id": "l-single-q1", "stem": "Pick one", "options": [{ "id": "A", "text": "Option A", "isCorrect": false }, { "id": "B", "text": "Option B", "isCorrect": true }] }] },
                    { "id": "l-single-legacy", "type": "SINGLE_MCQ", "stem": "Pick one (legacy)", "options": [{ "id": "X", "text": "Option X", "isCorrect": false }, { "id": "Y", "text": "Option Y", "isCorrect": true }] },
                    { "id": "l-diagram", "type": "DIAGRAM_LABELING", "imageUrl": "https://example.com/diagram.png", "labels": [{ "id": "l1", "correctAnswer": "nose" }, { "id": "l2", "correctAnswer": "ear" }] },
                    { "id": "l-flow", "type": "FLOW_CHART", "steps": [{ "id": "s1", "label": "Step 1", "correctAnswer": "step-1" }, { "id": "s2", "label": "Step 2", "correctAnswer": "step-2" }] },
                    { "id": "l-table", "type": "TABLE_COMPLETION", "headers": ["Col 1", "Col 2"], "rows": [["", ""]], "cells": [{ "id": "c1", "correctAnswer": "r1c1" }, { "id": "c2", "correctAnswer": "r1c2" }] },
                    { "id": "l-classify", "type": "CLASSIFICATION", "categories": ["Alpha", "Beta"], "items": [{ "id": "i1", "text": "Item 1", "correctCategory": "Alpha" }, { "id": "i2", "text": "Item 2", "correctCategory": "Beta" }] },
                    { "id": "l-match-features", "type": "MATCHING_FEATURES", "options": ["X", "Y"], "features": [{ "id": "f1", "text": "Feature 1", "correctMatch": "X" }, { "id": "f2", "text": "Feature 2", "correctMatch": "Y" }] }
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
        "progression": {"allowPause": true},
        "sections": {
            "listening": {"enabled": true, "label": "Listening", "order": 1, "duration": 30, "gapAfterMinutes": 5, "bandScoreTable": { "39": 9.0, "37": 8.5, "35": 8.0, "32": 7.5, "30": 7.0, "26": 6.5, "23": 6.0, "18": 5.5, "16": 5.0, "13": 4.5, "10": 4.0, "6": 3.5, "4": 3.0, "2": 2.5 }},
            "reading": {"enabled": true, "label": "Reading", "order": 2, "duration": 60, "gapAfterMinutes": 0, "bandScoreTable": { "39": 9.0, "37": 8.5, "35": 8.0, "33": 7.5, "30": 7.0, "27": 6.5, "23": 6.0, "19": 5.5, "15": 5.0, "13": 4.5, "10": 4.0, "8": 3.5, "6": 3.0, "4": 2.5 }},
            "writing": {"enabled": true, "label": "Writing", "order": 3, "duration": 60, "gapAfterMinutes": 10},
            "speaking": {"enabled": true, "label": "Speaking", "order": 4, "duration": 15, "gapAfterMinutes": 0}
        }
    })
}

async fn json_body(response: axum::response::Response) -> serde_json::Value {
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    serde_json::from_slice(&body).unwrap()
}

async fn admin_runtime_command(
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

async fn admin_end_section_now(
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

async fn transition_runtime_from_listening_to_reading(pool: &sqlx::MySqlPool, schedule_id: Uuid) {
    let runtime_id: String =
        sqlx::query_scalar("SELECT id FROM exam_session_runtimes WHERE schedule_id = ?")
            .bind(schedule_id.to_string())
            .fetch_one(pool)
            .await
            .unwrap();

    sqlx::query(
        r#"
        UPDATE exam_session_runtime_sections
        SET status = 'completed', actual_end_at = NOW(), completion_reason = 'time_expired'
        WHERE runtime_id = ? AND section_key = 'listening'
        "#,
    )
    .bind(&runtime_id)
    .execute(pool)
    .await
    .unwrap();

    sqlx::query(
        r#"
        UPDATE exam_session_runtime_sections
        SET status = 'live', available_at = COALESCE(available_at, NOW()), actual_start_at = COALESCE(actual_start_at, NOW())
        WHERE runtime_id = ? AND section_key = 'reading'
        "#,
    )
    .bind(&runtime_id)
    .execute(pool)
    .await
    .unwrap();

    sqlx::query(
        r#"
        UPDATE exam_session_runtimes
        SET
            status = 'live',
            active_section_key = 'reading',
            current_section_key = 'reading',
            waiting_for_next_section = false,
            actual_start_at = COALESCE(actual_start_at, NOW()),
            updated_at = NOW()
        WHERE schedule_id = ?
        "#,
    )
    .bind(schedule_id.to_string())
    .execute(pool)
    .await
    .unwrap();
}

// ---------------------------------------------------------------------------
// BEX-030 / BEX-031 — supported mutation command matrix and validation rejects
// ---------------------------------------------------------------------------

async fn post_mutation_batch_json(
    app: &axum::Router,
    attempt_token: &str,
    schedule_id: Uuid,
    body: serde_json::Value,
) -> (StatusCode, serde_json::Value) {
    let response = app
        .clone()
        .oneshot(
            with_attempt_token(Request::builder(), attempt_token)
                .method("POST")
                .uri(format!(
                    "/api/v1/student/sessions/{schedule_id}/mutations:batch"
                ))
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_vec(&body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let json = json_body(response).await;
    (status, json)
}

// Single-mutation batch in the new-style flat shape: `mutation_fields` carries
// the command's own fields (e.g. {"type": "SetScalar", "questionId": "q1",
// "value": "A"}); mutationId/baseRevision are merged in.
async fn post_single_mutation_batch(
    app: &axum::Router,
    attempt_token: &str,
    schedule_id: Uuid,
    attempt_id: &str,
    mutation_id: &str,
    base_revision: i32,
    mutation_fields: serde_json::Value,
) -> (StatusCode, serde_json::Value) {
    let mut mutation = mutation_fields.as_object().cloned().unwrap_or_default();
    mutation.insert("mutationId".to_owned(), json!(mutation_id));
    mutation.insert("baseRevision".to_owned(), json!(base_revision));
    post_mutation_batch_json(
        app,
        attempt_token,
        schedule_id,
        json!({
            "attemptId": attempt_id,
            "mutations": [serde_json::Value::Object(mutation)]
        }),
    )
    .await
}

// A single keyed value from the persisted `answers` JSON column (or the whole
// object when `key` is None).
async fn persisted_answers(
    pool: &sqlx::MySqlPool,
    attempt_id: &str,
) -> serde_json::Value {
    sqlx::query_scalar("SELECT answers FROM student_attempts WHERE id = ?")
        .bind(attempt_id)
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn persisted_writing_answers(
    pool: &sqlx::MySqlPool,
    attempt_id: &str,
) -> serde_json::Value {
    sqlx::query_scalar("SELECT writing_answers FROM student_attempts WHERE id = ?")
        .bind(attempt_id)
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn persisted_flags(pool: &sqlx::MySqlPool, attempt_id: &str) -> serde_json::Value {
    sqlx::query_scalar("SELECT flags FROM student_attempts WHERE id = ?")
        .bind(attempt_id)
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn persisted_revision(pool: &sqlx::MySqlPool, attempt_id: &str) -> i64 {
    sqlx::query_scalar("SELECT revision FROM student_attempts WHERE id = ?")
        .bind(attempt_id)
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn persisted_mutation_row_count(pool: &sqlx::MySqlPool, attempt_id: &str) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM student_attempt_mutations WHERE attempt_id = ?")
        .bind(attempt_id)
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn persisted_recovery(pool: &sqlx::MySqlPool, attempt_id: &str) -> serde_json::Value {
    sqlx::query_scalar("SELECT recovery FROM student_attempts WHERE id = ?")
        .bind(attempt_id)
        .fetch_one(pool)
        .await
        .unwrap()
}

// BEX-030 — every supported objective mutation command against its matching
// block type in the active section, with DB round-trip, empty-vs-clear
// semantics, and a full authoritative response per batch.
#[tokio::test]
async fn mutation_batch_supported_command_matrix_objective_questions() {
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
    start_runtime(database.pool(), schedule_id, "listening").await;
    let attempt_id = bootstrap["data"]["attempt"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let attempt_token = bootstrap["data"]["attemptCredential"]["attemptToken"]
        .as_str()
        .unwrap()
        .to_owned();
    let mut base_revision = bootstrap["data"]["attempt"]["revision"]
        .as_i64()
        .unwrap() as i32;

    // --- SetScalar: persisted in answers + authoritative response -----------
    let (status, json) = post_mutation_batch_json(
        &app,
        &attempt_token,
        schedule_id,
        json!({
            "attemptId": attempt_id.clone(),
            "mutations": [{
                "mutationId": "bex030-scalar-set",
                "baseRevision": base_revision,
                "type": "SetScalar",
                "questionId": "q1",
                "value": "A"
            }]
        }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["data"]["appliedMutationCount"], 1);
    assert_eq!(json["data"]["serverAcceptedThroughSeq"], 1);
    assert_eq!(json["data"]["attempt"]["answers"]["q1"], "A");
    assert_eq!(json["data"]["attempt"]["revision"], base_revision + 1);
    base_revision = json["data"]["revision"].as_i64().unwrap() as i32;

    let answers: serde_json::Value =
        sqlx::query_scalar("SELECT answers FROM student_attempts WHERE id = ?")
            .bind(&attempt_id)
            .fetch_one(database.pool())
            .await
            .unwrap();
    assert_eq!(answers["q1"], "A");

    // --- SetChoice: valid option persisted; invalid option rejected ---------
    let (status, json) = post_mutation_batch_json(
        &app,
        &attempt_token,
        schedule_id,
        json!({
            "attemptId": attempt_id.clone(),
            "mutations": [{
                "mutationId": "bex030-choice-set",
                "baseRevision": base_revision,
                "type": "SetChoice",
                "questionId": "l-choice-1",
                "value": "B"
            }]
        }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["data"]["attempt"]["answers"]["l-choice-1"], "B");
    base_revision = json["data"]["revision"].as_i64().unwrap() as i32;

    // Invalid option value -> 422 VALIDATION_ERROR, revision untouched.
    let (status, json) = post_mutation_batch_json(
        &app,
        &attempt_token,
        schedule_id,
        json!({
            "attemptId": attempt_id.clone(),
            "mutations": [{
                "mutationId": "bex030-choice-invalid",
                "baseRevision": base_revision,
                "type": "SetChoice",
                "questionId": "l-choice-1",
                "value": "Z"
            }]
        }),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(json["error"]["code"], "VALIDATION_ERROR");
    assert_eq!(
        json["error"]["message"],
        "Answer value is not valid for this question."
    );
    // Explicit pin: the rejected batch must not advance revision or persist answers.
    let answers_after_reject: serde_json::Value =
        sqlx::query_scalar("SELECT answers FROM student_attempts WHERE id = ?")
            .bind(&attempt_id)
            .fetch_one(database.pool())
            .await
            .unwrap();
    let revision_after_reject: i64 =
        sqlx::query_scalar("SELECT revision FROM student_attempts WHERE id = ?")
            .bind(&attempt_id)
            .fetch_one(database.pool())
            .await
            .unwrap();
    assert_eq!(revision_after_reject, i64::from(base_revision));
    assert_eq!(answers_after_reject["l-choice-1"], "B");

    // --- SetSlot: array-backed 2-blank question ------------------------------
    let (status, json) = post_mutation_batch_json(
        &app,
        &attempt_token,
        schedule_id,
        json!({
            "attemptId": attempt_id.clone(),
            "mutations": [{
                "mutationId": "bex030-slot-set-0",
                "baseRevision": base_revision,
                "type": "SetSlot",
                "questionId": "l-blank-2",
                "slotIndex": 0,
                "value": "alpha"
            }]
        }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["data"]["attempt"]["answers"]["l-blank-2"], json!(["alpha"]));
    base_revision = json["data"]["revision"].as_i64().unwrap() as i32;

    let (status, json) = post_mutation_batch_json(
        &app,
        &attempt_token,
        schedule_id,
        json!({
            "attemptId": attempt_id.clone(),
            "mutations": [{
                "mutationId": "bex030-slot-set-1",
                "baseRevision": base_revision,
                "type": "SetSlot",
                "questionId": "l-blank-2",
                "slotIndex": 1,
                "value": ""
            }]
        }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    // Empty string in a slot is present, not cleared.
    assert_eq!(
        json["data"]["attempt"]["answers"]["l-blank-2"],
        json!(["alpha", ""])
    );
    base_revision = json["data"]["revision"].as_i64().unwrap() as i32;

    // --- ClearSlot: slot becomes explicit JSON null (not removed, not "") ----
    let (status, json) = post_mutation_batch_json(
        &app,
        &attempt_token,
        schedule_id,
        json!({
            "attemptId": attempt_id.clone(),
            "mutations": [{
                "mutationId": "bex030-slot-clear-0",
                "baseRevision": base_revision,
                "type": "ClearSlot",
                "questionId": "l-blank-2",
                "slotIndex": 0
            }]
        }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        json["data"]["attempt"]["answers"]["l-blank-2"],
        json!([null, ""])
    );
    base_revision = json["data"]["revision"].as_i64().unwrap() as i32;

    // --- SetFlag: flags[questionId] = boolean --------------------------------
    let (status, json) = post_mutation_batch_json(
        &app,
        &attempt_token,
        schedule_id,
        json!({
            "attemptId": attempt_id.clone(),
            "mutations": [{
                "mutationId": "bex030-flag-set",
                "baseRevision": base_revision,
                "type": "SetFlag",
                "questionId": "q1",
                "value": true
            }]
        }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["data"]["attempt"]["flags"]["q1"], true);
    base_revision = json["data"]["revision"].as_i64().unwrap() as i32;

    // --- Empty value vs explicit clear on a Text question --------------------
    // SetScalar "" stores an empty string (key present, not null).
    let (status, json) = post_mutation_batch_json(
        &app,
        &attempt_token,
        schedule_id,
        json!({
            "attemptId": attempt_id.clone(),
            "mutations": [{
                "mutationId": "bex030-scalar-empty",
                "baseRevision": base_revision,
                "type": "SetScalar",
                "questionId": "q1",
                "value": ""
            }]
        }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["data"]["attempt"]["answers"]["q1"], "");
    assert_eq!(json["data"]["attempt"]["answers"]["q1"].is_null(), false);
    base_revision = json["data"]["revision"].as_i64().unwrap() as i32;

    // ClearScalar writes an explicit JSON null (distinct from "").
    let (status, json) = post_mutation_batch_json(
        &app,
        &attempt_token,
        schedule_id,
        json!({
            "attemptId": attempt_id.clone(),
            "mutations": [{
                "mutationId": "bex030-scalar-clear",
                "baseRevision": base_revision,
                "type": "ClearScalar",
                "questionId": "q1"
            }]
        }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["data"]["attempt"]["answers"]["q1"].is_null(), true);
    base_revision = json["data"]["revision"].as_i64().unwrap() as i32;

    // --- ClearChoice: removed from persisted answers as explicit null --------
    let (status, json) = post_mutation_batch_json(
        &app,
        &attempt_token,
        schedule_id,
        json!({
            "attemptId": attempt_id.clone(),
            "mutations": [{
                "mutationId": "bex030-choice-clear",
                "baseRevision": base_revision,
                "type": "ClearChoice",
                "questionId": "l-choice-1"
            }]
        }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["data"]["attempt"]["answers"]["l-choice-1"].is_null(), true);
    assert_eq!(json["data"]["attempt"]["answers"]["q1"].is_null(), true);

    // Final DB round-trip: clears persist as explicit JSON nulls.
    let answers: serde_json::Value =
        sqlx::query_scalar("SELECT answers FROM student_attempts WHERE id = ?")
            .bind(&attempt_id)
            .fetch_one(database.pool())
            .await
            .unwrap();
    assert_eq!(answers["q1"], serde_json::Value::Null);
    assert_eq!(answers["l-choice-1"], serde_json::Value::Null);
    assert_eq!(answers["l-blank-2"], json!([null, ""]));
    assert!(answers.as_object().unwrap().contains_key("q1"));
    assert!(answers.as_object().unwrap().contains_key("l-choice-1"));

    let flags: serde_json::Value =
        sqlx::query_scalar("SELECT flags FROM student_attempts WHERE id = ?")
            .bind(&attempt_id)
            .fetch_one(database.pool())
            .await
            .unwrap();
    assert_eq!(flags["q1"], true);

    database.shutdown().await;
}

// BEX-030 — writing commands (SetEssayText / ClearEssayText) with unicode and
// multiline values round-tripped byte-exactly through the DB and the response.
#[tokio::test]
async fn mutation_batch_supported_command_matrix_writing_unicode() {
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
    start_runtime(database.pool(), schedule_id, "writing").await;
    let attempt_id = bootstrap["data"]["attempt"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let attempt_token = bootstrap["data"]["attemptCredential"]["attemptToken"]
        .as_str()
        .unwrap()
        .to_owned();
    let mut base_revision = bootstrap["data"]["attempt"]["revision"]
        .as_i64()
        .unwrap() as i32;

    // --- SetEssayText: persisted in writingAnswers + authoritative response --
    let (status, json) = post_mutation_batch_json(
        &app,
        &attempt_token,
        schedule_id,
        json!({
            "attemptId": attempt_id.clone(),
            "mutations": [{
                "mutationId": "bex030-essay-set",
                "baseRevision": base_revision,
                "type": "SetEssayText",
                "taskId": "task1",
                "value": "Draft 1"
            }]
        }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["data"]["attempt"]["writingAnswers"]["task1"], "Draft 1");
    assert_eq!(json["data"]["attempt"]["answers"], json!({}));
    base_revision = json["data"]["revision"].as_i64().unwrap() as i32;

    let writing_answers: serde_json::Value =
        sqlx::query_scalar("SELECT writing_answers FROM student_attempts WHERE id = ?")
            .bind(&attempt_id)
            .fetch_one(database.pool())
            .await
            .unwrap();
    assert_eq!(writing_answers["task1"], "Draft 1");

    // --- Unicode + multiline: byte-exact round trip --------------------------
    let unicode_draft = "第一段 引言\nsecond line 🎯\tTAB\nfinal line with emoji 🚀";
    let (status, json) = post_mutation_batch_json(
        &app,
        &attempt_token,
        schedule_id,
        json!({
            "attemptId": attempt_id.clone(),
            "mutations": [{
                "mutationId": "bex030-essay-unicode",
                "baseRevision": base_revision,
                "type": "SetEssayText",
                "taskId": "task1",
                "value": unicode_draft
            }]
        }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["data"]["attempt"]["writingAnswers"]["task1"], unicode_draft);
    base_revision = json["data"]["revision"].as_i64().unwrap() as i32;

    let writing_answers: serde_json::Value =
        sqlx::query_scalar("SELECT writing_answers FROM student_attempts WHERE id = ?")
            .bind(&attempt_id)
            .fetch_one(database.pool())
            .await
            .unwrap();
    assert_eq!(writing_answers["task1"], unicode_draft);

    // --- Empty value vs explicit clear ---------------------------------------
    let (status, json) = post_mutation_batch_json(
        &app,
        &attempt_token,
        schedule_id,
        json!({
            "attemptId": attempt_id.clone(),
            "mutations": [{
                "mutationId": "bex030-essay-empty",
                "baseRevision": base_revision,
                "type": "SetEssayText",
                "taskId": "task1",
                "value": ""
            }]
        }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["data"]["attempt"]["writingAnswers"]["task1"], "");
    assert_eq!(json["data"]["attempt"]["writingAnswers"]["task1"].is_null(), false);
    base_revision = json["data"]["revision"].as_i64().unwrap() as i32;

    let (status, json) = post_mutation_batch_json(
        &app,
        &attempt_token,
        schedule_id,
        json!({
            "attemptId": attempt_id.clone(),
            "mutations": [{
                "mutationId": "bex030-essay-clear",
                "baseRevision": base_revision,
                "type": "ClearEssayText",
                "taskId": "task1"
            }]
        }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["data"]["attempt"]["writingAnswers"]["task1"].is_null(), true);

    let writing_answers: serde_json::Value =
        sqlx::query_scalar("SELECT writing_answers FROM student_attempts WHERE id = ?")
            .bind(&attempt_id)
            .fetch_one(database.pool())
            .await
            .unwrap();
    assert_eq!(writing_answers["task1"], serde_json::Value::Null);
    assert!(writing_answers
        .as_object()
        .unwrap()
        .contains_key("task1"));

    database.shutdown().await;
}

// BEX-035 — full question-type round trip. For every supported IELTS question
// type the plan pins: mutation command → persisted `answers`/`writing_answers`
// (exact JSON shape) → hydrated live attempt (response == persisted) →
// submitted `final_submission` (grading input) == persisted. Auto-grading
// results are then produced through the same projection cycle the worker runs
// (`GradingService::run_projection_cycle`) so that "correct grades correct,
// wrong/absent grades wrong" (plus case/whitespace-aware rules) are pinned
// end-to-end for the types whose block metadata carries answer keys.
#[tokio::test]
async fn bex035_question_type_round_trip_matrix() {
    let database = mysql::TestDatabase::new(DELIVERY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();
    let (auth, student_key) = create_student_auth(database.pool(), schedule_id, "alice").await;
    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));
    let (bootstrap, _client_session_id) = {
        // The attempt phase is computed at creation from the runtime status;
        // submit requires phase `exam`, so the runtime must be live FIRST
        // (the gate row only exists after the proctor-side StartRuntime
        // command; a bare UPDATE on exam_session_runtimes is a silent no-op).
        SchedulingService::new(database.pool().clone())
            .apply_runtime_command(
                &contract_actor(),
                schedule_id,
                RuntimeCommandRequest {
                    action: RuntimeCommandAction::StartRuntime,
                    reason: Some("contract runtime start (BEX-035)".to_owned()),
                },
            )
            .await
            .unwrap();
        bootstrap_attempt(&app, &auth, schedule_id, "alice", &student_key).await
    };
    assert_eq!(
        bootstrap["data"]["attempt"]["phase"],
        "exam",
        "attempt must be phase=exam for submit"
    );
    let attempt_id = bootstrap["data"]["attempt"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let attempt_token = bootstrap["data"]["attemptCredential"]["attemptToken"]
        .as_str()
        .unwrap()
        .to_owned();
    let mut base_revision = bootstrap["data"]["attempt"]["revision"]
        .as_i64()
        .unwrap() as i32;

    let expect_ok = |status: StatusCode, json: &serde_json::Value, label: &str| {
        assert_eq!(status, StatusCode::OK, "{label} failed: {json}");
    };
    let expect_422 = |status: StatusCode, json: &serde_json::Value, label: &str| {
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{label}: {json}");
        assert_eq!(json["error"]["code"], "VALIDATION_ERROR", "{label}: {json}");
    };

    // ---- 1. Single answer (SHORT_ANSWER Text): value stored byte-exact ----
    let (status, json) = post_single_mutation_batch(
        &app,
        &attempt_token,
        schedule_id,
        &attempt_id,
        "bex035-short-set",
        base_revision,
        json!({"type": "SetScalar", "questionId": "l-short-1", "value": "Diagram"}),
    )
    .await;
    expect_ok(status, &json, "SetScalar l-short-1");
    assert_eq!(json["data"]["attempt"]["answers"]["l-short-1"], "Diagram");
    base_revision = json["data"]["revision"].as_i64().unwrap() as i32;
    let answers = persisted_answers(database.pool(), &attempt_id).await;
    assert_eq!(answers["l-short-1"], "Diagram", "case preserved in DB");

    // Whitespace variant is stored as typed (no normalization at mutation).
    let (status, json) = post_single_mutation_batch(
        &app,
        &attempt_token,
        schedule_id,
        &attempt_id,
        "bex035-short-whitespace",
        base_revision,
        json!({"type": "SetScalar", "questionId": "l-short-1", "value": "  diagram  "}),
    )
    .await;
    expect_ok(status, &json, "SetScalar whitespace variant");
    base_revision = json["data"]["revision"].as_i64().unwrap() as i32;
    let answers = persisted_answers(database.pool(), &attempt_id).await;
    assert_eq!(answers["l-short-1"], "  diagram  ");

    // ---- 2. Multi-select (MULTI_MCQ): SetChoice carries the array value ----
    let (status, json) = post_single_mutation_batch(
        &app,
        &attempt_token,
        schedule_id,
        &attempt_id,
        "bex035-multi-set",
        base_revision,
        json!({"type": "SetChoice", "questionId": "l-multi-1", "value": ["A", "C"]}),
    )
    .await;
    expect_ok(status, &json, "SetChoice l-multi-1 array");
    assert_eq!(json["data"]["attempt"]["answers"]["l-multi-1"], json!(["A", "C"]));
    base_revision = json["data"]["revision"].as_i64().unwrap() as i32;
    let answers = persisted_answers(database.pool(), &attempt_id).await;
    assert_eq!(answers["l-multi-1"], json!(["A", "C"]));

    // Order is preserved in storage; grading compares sets (order-insensitive).
    let (status, json) = post_single_mutation_batch(
        &app,
        &attempt_token,
        schedule_id,
        &attempt_id,
        "bex035-multi-reorder",
        base_revision,
        json!({"type": "SetChoice", "questionId": "l-multi-1", "value": ["C", "A"]}),
    )
    .await;
    expect_ok(status, &json, "SetChoice l-multi-1 reorder");
    base_revision = json["data"]["revision"].as_i64().unwrap() as i32;
    let answers = persisted_answers(database.pool(), &attempt_id).await;
    assert_eq!(answers["l-multi-1"], json!(["C", "A"]));

    // Wrong selection count (max = correct count = 2) is rejected atomically.
    let (status, json) = post_single_mutation_batch(
        &app,
        &attempt_token,
        schedule_id,
        &attempt_id,
        "bex035-multi-too-many",
        base_revision,
        json!({"type": "SetChoice", "questionId": "l-multi-1", "value": ["A", "B", "C"]}),
    )
    .await;
    expect_422(status, &json, "l-multi-1 too many selections");
    assert_eq!(json["error"]["message"], "Too many selections for this question.");
    let answers = persisted_answers(database.pool(), &attempt_id).await;
    assert_eq!(answers["l-multi-1"], json!(["C", "A"]), "rejected batch must not persist");
    assert_eq!(persisted_revision(database.pool(), &attempt_id).await, i64::from(base_revision));

    // ---- 3. True/False/Not Given (full-metadata TFNG → strict Enum) --------
    for (idx, value) in ["T", "NG"].iter().enumerate() {
        let (status, json) = post_single_mutation_batch(
            &app,
            &attempt_token,
            schedule_id,
            &attempt_id,
            &format!("bex035-tfng-set-{idx}"),
            base_revision,
            json!({"type": "SetScalar", "questionId": "l-tfng-1", "value": value}),
        )
        .await;
        expect_ok(status, &json, &format!("SetScalar l-tfng-1 = {value}"));
        base_revision = json["data"]["revision"].as_i64().unwrap() as i32;
    }
    let answers = persisted_answers(database.pool(), &attempt_id).await;
    assert_eq!(answers["l-tfng-1"], "NG");

    // Outside the {T,F,NG} set — including the "True" spelling and lowercase —
    // is rejected at mutation (Enum strictness; never reaches grading).
    for (idx, value) in ["True", "t"].iter().enumerate() {
        let (status, json) = post_single_mutation_batch(
            &app,
            &attempt_token,
            schedule_id,
            &attempt_id,
            &format!("bex035-tfng-reject-{idx}"),
            base_revision,
            json!({"type": "SetScalar", "questionId": "l-tfng-1", "value": value}),
        )
        .await;
        expect_422(status, &json, &format!("SetScalar l-tfng-1 = {value}"));
        assert_eq!(
            json["error"]["message"],
            "Answer value is not valid for this question."
        );
    }
    let answers = persisted_answers(database.pool(), &attempt_id).await;
    assert_eq!(answers["l-tfng-1"], "NG", "rejected TFNG variant must not persist");
    assert_eq!(
        persisted_revision(database.pool(), &attempt_id).await,
        i64::from(base_revision),
        "rejected batch must not advance the revision"
    );

    // Final TFNG answer for the grading leg.
    let (status, json) = post_single_mutation_batch(
        &app,
        &attempt_token,
        schedule_id,
        &attempt_id,
        "bex035-tfng-final",
        base_revision,
        json!({"type": "SetScalar", "questionId": "l-tfng-1", "value": "T"}),
    )
    .await;
    expect_ok(status, &json, "SetScalar l-tfng-1 = T");
    base_revision = json["data"]["revision"].as_i64().unwrap() as i32;

    // ---- 4. Matching (MATCHING → per-question Enum of roman headings) ------
    let (status, json) = post_single_mutation_batch(
        &app,
        &attempt_token,
        schedule_id,
        &attempt_id,
        "bex035-match-set",
        base_revision,
        json!({"type": "SetScalar", "questionId": "l-match-q1", "value": "ii"}),
    )
    .await;
    expect_ok(status, &json, "SetScalar l-match-q1 = ii");
    assert_eq!(json["data"]["attempt"]["answers"]["l-match-q1"], "ii");
    base_revision = json["data"]["revision"].as_i64().unwrap() as i32;
    let answers = persisted_answers(database.pool(), &attempt_id).await;
    assert_eq!(answers["l-match-q1"], "ii");

    // The heading value set is strict: "1" is not a valid roman numeral.
    let (status, json) = post_single_mutation_batch(
        &app,
        &attempt_token,
        schedule_id,
        &attempt_id,
        "bex035-match-reject",
        base_revision,
        json!({"type": "SetScalar", "questionId": "l-match-q1", "value": "1"}),
    )
    .await;
    expect_422(status, &json, "SetScalar l-match-q1 = 1");
    let answers = persisted_answers(database.pool(), &attempt_id).await;
    assert_eq!(answers["l-match-q1"], "ii");
    assert_eq!(
        persisted_revision(database.pool(), &attempt_id).await,
        i64::from(base_revision),
        "rejected batch must not advance the revision"
    );

    // ---- 5. Sentence completion with several slots (ArrayText) -------------
    // Partial fill pins the exact persisted shape: ["first"].
    let (status, json) = post_single_mutation_batch(
        &app,
        &attempt_token,
        schedule_id,
        &attempt_id,
        "bex035-slot0-set",
        base_revision,
        json!({"type": "SetSlot", "questionId": "l-blank-2", "slotIndex": 0, "value": "first"}),
    )
    .await;
    expect_ok(status, &json, "SetSlot l-blank-2[0]");
    assert_eq!(json["data"]["attempt"]["answers"]["l-blank-2"], json!(["first"]));
    base_revision = json["data"]["revision"].as_i64().unwrap() as i32;
    let answers = persisted_answers(database.pool(), &attempt_id).await;
    assert_eq!(answers["l-blank-2"], json!(["first"]), "partial fill shape");

    let (status, json) = post_single_mutation_batch(
        &app,
        &attempt_token,
        schedule_id,
        &attempt_id,
        "bex035-slot1-set",
        base_revision,
        json!({"type": "SetSlot", "questionId": "l-blank-2", "slotIndex": 1, "value": "second"}),
    )
    .await;
    expect_ok(status, &json, "SetSlot l-blank-2[1]");
    base_revision = json["data"]["revision"].as_i64().unwrap() as i32;
    let answers = persisted_answers(database.pool(), &attempt_id).await;
    assert_eq!(answers["l-blank-2"], json!(["first", "second"]));

    // ClearSlot writes an explicit JSON null at the slot (array length kept).
    let (status, json) = post_single_mutation_batch(
        &app,
        &attempt_token,
        schedule_id,
        &attempt_id,
        "bex035-slot0-clear",
        base_revision,
        json!({"type": "ClearSlot", "questionId": "l-blank-2", "slotIndex": 0}),
    )
    .await;
    expect_ok(status, &json, "ClearSlot l-blank-2[0]");
    assert_eq!(
        json["data"]["attempt"]["answers"]["l-blank-2"],
        json!([null, "second"])
    );
    base_revision = json["data"]["revision"].as_i64().unwrap() as i32;

    // Per-blank sub-ids are section-registered: flags accept the sub-id. The
    // seed spells blank ids as "{question_id}:{blank_id}" already, so the
    // registered key is the raw concat "{question_id}:{blank_id}" = the
    // double-prefixed "l-blank-2:l-blank-2:b1".
    let (status, json) = post_single_mutation_batch(
        &app,
        &attempt_token,
        schedule_id,
        &attempt_id,
        "bex035-flag-subid",
        base_revision,
        json!({"type": "SetFlag", "questionId": "l-blank-2:l-blank-2:b1", "value": true}),
    )
    .await;
    expect_ok(status, &json, "SetFlag on per-blank sub-id");
    assert_eq!(json["data"]["attempt"]["flags"]["l-blank-2:l-blank-2:b1"], true);
    base_revision = json["data"]["revision"].as_i64().unwrap() as i32;

    // ---- 6. Diagram labels (DIAGRAM_LABELING → block-level ArrayText) ------
    // Labels have per-label ids, but they are section-registered only; the
    // value lives at the block id as a slot array.
    let (status, json) = post_single_mutation_batch(
        &app,
        &attempt_token,
        schedule_id,
        &attempt_id,
        "bex035-map-slot0",
        base_revision,
        json!({"type": "SetSlot", "questionId": "l-map-1", "slotIndex": 0, "value": "nose"}),
    )
    .await;
    expect_ok(status, &json, "SetSlot l-map-1[0]");
    assert_eq!(json["data"]["attempt"]["answers"]["l-map-1"], json!(["nose"]));
    base_revision = json["data"]["revision"].as_i64().unwrap() as i32;

    let (status, json) = post_single_mutation_batch(
        &app,
        &attempt_token,
        schedule_id,
        &attempt_id,
        "bex035-map-slot1",
        base_revision,
        json!({"type": "SetSlot", "questionId": "l-map-1", "slotIndex": 1, "value": "ear"}),
    )
    .await;
    expect_ok(status, &json, "SetSlot l-map-1[1]");
    base_revision = json["data"]["revision"].as_i64().unwrap() as i32;

    let (status, json) = post_single_mutation_batch(
        &app,
        &attempt_token,
        schedule_id,
        &attempt_id,
        "bex035-map-slot1-clear",
        base_revision,
        json!({"type": "ClearSlot", "questionId": "l-map-1", "slotIndex": 1}),
    )
    .await;
    expect_ok(status, &json, "ClearSlot l-map-1[1]");
    assert_eq!(json["data"]["attempt"]["answers"]["l-map-1"], json!(["nose", null]));
    base_revision = json["data"]["revision"].as_i64().unwrap() as i32;

    // A SetScalar against the per-label sub-id is accepted-but-ignored (the
    // sub-id has section registration only, no value constraint).
    let (status, json) = post_single_mutation_batch(
        &app,
        &attempt_token,
        schedule_id,
        &attempt_id,
        "bex035-map-subid-ignored",
        base_revision,
        json!({"type": "SetScalar", "questionId": "l-map-1:l1", "value": "x"}),
    )
    .await;
    expect_ok(status, &json, "SetScalar on per-label sub-id");
    // The no-op still persists as a stored mutation, so the revision advances;
    // only the applied count is 0 and the answers byte-unchanged.
    assert_eq!(json["data"]["appliedMutationCount"], 0);
    assert_eq!(json["data"]["revision"].as_i64().unwrap(), i64::from(base_revision) + 1);
    base_revision = json["data"]["revision"].as_i64().unwrap() as i32;
    let answers = persisted_answers(database.pool(), &attempt_id).await;
    assert_eq!(answers["l-map-1"], json!(["nose", null]));

    // ---- Shared-answer sentence (case-folded grading variant) --------------
    let (status, json) = post_single_mutation_batch(
        &app,
        &attempt_token,
        schedule_id,
        &attempt_id,
        "bex035-shared-set",
        base_revision,
        json!({"type": "SetSlot", "questionId": "l-blank-shared-1", "slotIndex": 0, "value": "Apple"}),
    )
    .await;
    expect_ok(status, &json, "SetSlot l-blank-shared-1[0]");
    base_revision = json["data"]["revision"].as_i64().unwrap() as i32;
    let answers = persisted_answers(database.pool(), &attempt_id).await;
    assert_eq!(answers["l-blank-shared-1"], json!(["Apple"]), "case preserved in DB");

    // ---- 7. Cleared answers (explicit JSON null shapes, keys retained) -----
    // SINGLE_MCQ: set, then clear via ClearChoice.
    let (status, json) = post_single_mutation_batch(
        &app,
        &attempt_token,
        schedule_id,
        &attempt_id,
        "bex035-choice-set",
        base_revision,
        json!({"type": "SetChoice", "questionId": "l-choice-1", "value": "B"}),
    )
    .await;
    expect_ok(status, &json, "SetChoice l-choice-1");
    base_revision = json["data"]["revision"].as_i64().unwrap() as i32;

    // Enum case variant: lowercase option id is outside the allowed set.
    let (status, json) = post_single_mutation_batch(
        &app,
        &attempt_token,
        schedule_id,
        &attempt_id,
        "bex035-choice-case-reject",
        base_revision,
        json!({"type": "SetChoice", "questionId": "l-choice-1", "value": "b"}),
    )
    .await;
    expect_422(status, &json, "SetChoice l-choice-1 = b");
    assert_eq!(
        json["error"]["message"],
        "Answer value is not valid for this question."
    );
    assert_eq!(
        persisted_revision(database.pool(), &attempt_id).await,
        i64::from(base_revision),
        "rejected batch must not advance the revision"
    );

    let (status, json) = post_single_mutation_batch(
        &app,
        &attempt_token,
        schedule_id,
        &attempt_id,
        "bex035-choice-clear",
        base_revision,
        json!({"type": "ClearChoice", "questionId": "l-choice-1"}),
    )
    .await;
    expect_ok(status, &json, "ClearChoice l-choice-1");
    assert_eq!(json["data"]["attempt"]["answers"]["l-choice-1"].is_null(), true);
    base_revision = json["data"]["revision"].as_i64().unwrap() as i32;

    // Text: SetScalar then ClearScalar → explicit null, key retained.
    let (status, json) = post_single_mutation_batch(
        &app,
        &attempt_token,
        schedule_id,
        &attempt_id,
        "bex035-short2-set",
        base_revision,
        json!({"type": "SetScalar", "questionId": "l-short-2", "value": "diesel"}),
    )
    .await;
    expect_ok(status, &json, "SetScalar l-short-2");
    base_revision = json["data"]["revision"].as_i64().unwrap() as i32;

    let (status, json) = post_single_mutation_batch(
        &app,
        &attempt_token,
        schedule_id,
        &attempt_id,
        "bex035-short2-clear",
        base_revision,
        json!({"type": "ClearScalar", "questionId": "l-short-2"}),
    )
    .await;
    expect_ok(status, &json, "ClearScalar l-short-2");
    assert_eq!(json["data"]["attempt"]["answers"]["l-short-2"].is_null(), true);
    base_revision = json["data"]["revision"].as_i64().unwrap() as i32;

    // Restore a case-variant of the correct answer ("petrol") so the grading
    // leg pins the plain-text case rule: "Petrol" is accepted and stored
    // byte-exact (Text constraint is permissive), but plain-text grading is
    // case-SENSITIVE (only the shared-answer path folds case) → grades wrong.
    let (status, json) = post_single_mutation_batch(
        &app,
        &attempt_token,
        schedule_id,
        &attempt_id,
        "bex035-short2-wrong",
        base_revision,
        json!({"type": "SetScalar", "questionId": "l-short-2", "value": "Petrol"}),
    )
    .await;
    expect_ok(status, &json, "SetScalar l-short-2 (case-variant final)");
    base_revision = json["data"]["revision"].as_i64().unwrap() as i32;

    // TFNG legacy-minimal question (q1, no metadata): Text constraint; cleared
    // to pin "unanswered" in the final submission.
    let (status, json) = post_single_mutation_batch(
        &app,
        &attempt_token,
        schedule_id,
        &attempt_id,
        "bex035-q1-set",
        base_revision,
        json!({"type": "SetScalar", "questionId": "q1", "value": "T"}),
    )
    .await;
    expect_ok(status, &json, "SetScalar q1");
    base_revision = json["data"]["revision"].as_i64().unwrap() as i32;

    let (status, json) = post_single_mutation_batch(
        &app,
        &attempt_token,
        schedule_id,
        &attempt_id,
        "bex035-q1-clear",
        base_revision,
        json!({"type": "ClearScalar", "questionId": "q1"}),
    )
    .await;
    expect_ok(status, &json, "ClearScalar q1");
    base_revision = json["data"]["revision"].as_i64().unwrap() as i32;

    let answers = persisted_answers(database.pool(), &attempt_id).await;
    assert_eq!(answers["q1"], serde_json::Value::Null);
    assert!(answers.as_object().unwrap().contains_key("q1"), "clear keeps the key");

    // ---- 8. Writing tasks: separate writingAnswers map ---------------------
    start_runtime(database.pool(), schedule_id, "writing").await;
    let (status, json) = post_single_mutation_batch(
        &app,
        &attempt_token,
        schedule_id,
        &attempt_id,
        "bex035-essay-set",
        base_revision,
        json!({"type": "SetEssayText", "taskId": "task1", "value": "Draft 1"}),
    )
    .await;
    expect_ok(status, &json, "SetEssayText task1");
    assert_eq!(json["data"]["attempt"]["writingAnswers"]["task1"], "Draft 1");
    base_revision = json["data"]["revision"].as_i64().unwrap() as i32;

    let unicode_draft = "第一段 引言\nsecond line 🎯\tTAB\nfinal line with emoji 🚀";
    let (status, json) = post_single_mutation_batch(
        &app,
        &attempt_token,
        schedule_id,
        &attempt_id,
        "bex035-essay-unicode",
        base_revision,
        json!({"type": "SetEssayText", "taskId": "task2", "value": unicode_draft}),
    )
    .await;
    expect_ok(status, &json, "SetEssayText task2 unicode");
    base_revision = json["data"]["revision"].as_i64().unwrap() as i32;
    let writing_answers = persisted_writing_answers(database.pool(), &attempt_id).await;
    assert_eq!(writing_answers["task2"], unicode_draft, "byte-exact unicode/multiline");

    let (status, json) = post_single_mutation_batch(
        &app,
        &attempt_token,
        schedule_id,
        &attempt_id,
        "bex035-essay-clear",
        base_revision,
        json!({"type": "ClearEssayText", "taskId": "task1"}),
    )
    .await;
    expect_ok(status, &json, "ClearEssayText task1");
    assert_eq!(json["data"]["attempt"]["writingAnswers"]["task1"].is_null(), true);
    base_revision = json["data"]["revision"].as_i64().unwrap() as i32;
    let writing_answers = persisted_writing_answers(database.pool(), &attempt_id).await;
    assert_eq!(writing_answers["task1"], serde_json::Value::Null);
    assert!(writing_answers.as_object().unwrap().contains_key("task1"));

    // ---- 9. Hydration: the live attempt mirrors persisted state ------------
    let live = app
        .clone()
        .oneshot(
            auth.with_auth(Request::builder().uri(format!(
                "/api/v1/student/sessions/{schedule_id}/live?candidateId=alice"
            )))
            .body(Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(live.status(), StatusCode::OK);
    let live_json = json_body(live).await;
    let answers = persisted_answers(database.pool(), &attempt_id).await;
    let writing_answers = persisted_writing_answers(database.pool(), &attempt_id).await;
    let flags = persisted_flags(database.pool(), &attempt_id).await;
    assert_eq!(
        live_json["data"]["attempt"]["answers"], answers,
        "hydrated answers must equal persisted answers"
    );
    assert_eq!(
        live_json["data"]["attempt"]["writingAnswers"], writing_answers,
        "hydrated writingAnswers must equal persisted writingAnswers"
    );
    assert_eq!(
        live_json["data"]["attempt"]["flags"], flags,
        "hydrated flags must equal persisted flags"
    );

    // ---- 10. Submission: final_submission carries the persisted snapshot ---
    let submit = app
        .clone()
        .oneshot(
            with_attempt_token(Request::builder(), &attempt_token)
                .method("POST")
                .uri(format!("/api/v1/student/sessions/{schedule_id}/submit"))
                .header("idempotency-key", "bex035-submit-1")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "attemptId": attempt_id.clone(),
                        "lastSeenRevision": base_revision,
                        "submissionId": "bex035-submission-1",
                        "clientFinalSeq": 0,
                        "serverAcceptedThroughSeq": 0
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let submit_status = submit.status();
    let submit_json = json_body(submit).await;
    assert_eq!(submit_status, StatusCode::OK, "submit conflict body: {submit_json}");
    assert_eq!(submit_json["data"]["attempt"]["phase"], "post-exam");

    let final_submission: serde_json::Value =
        sqlx::query_scalar("SELECT final_submission FROM student_attempts WHERE id = ?")
            .bind(&attempt_id)
            .fetch_one(database.pool())
            .await
            .unwrap();
    let answers = persisted_answers(database.pool(), &attempt_id).await;
    let writing_answers = persisted_writing_answers(database.pool(), &attempt_id).await;
    assert_eq!(
        final_submission["answers"], answers,
        "grading input (final_submission.answers) must equal persisted answers"
    );
    assert_eq!(
        final_submission["writingAnswers"], writing_answers,
        "grading input (final_submission.writingAnswers) must equal persisted writingAnswers"
    );

    // ---- 11. Grading leg ----------------------------------------------------
    // Empirical pin: submit alone does NOT project auto-grading rows; the
    // projection cycle (worker-equivalent) produces them synchronously.
    let sections_before: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM section_submissions WHERE submission_id IN (SELECT id FROM student_submissions WHERE attempt_id = ?)",
    )
    .bind(&attempt_id)
    .fetch_one(database.pool())
    .await
    .unwrap();
    assert_eq!(sections_before, 0, "submit must not project grading synchronously");

    let grading = GradingService::new(database.pool().clone());
    let report = grading
        .run_projection_cycle(GradingProjectionRequest {
            watermark: None,
            bootstrap_after: None,
            batch_size: None,
        })
        .await
        .unwrap();
    assert!(
        report.submission_rows_synced >= 1 && report.section_rows_synced >= 1,
        "projection must materialize the submission: {report:?}"
    );

    let auto: serde_json::Value = sqlx::query_scalar(
        "SELECT section_submissions.auto_grading_results FROM section_submissions JOIN student_submissions ON student_submissions.id = section_submissions.submission_id WHERE student_submissions.attempt_id = ? AND section_submissions.section = 'listening'",
    )
    .bind(&attempt_id)
    .fetch_one(database.pool())
    .await
    .unwrap();
    let question_results = auto["questionResults"].as_array().unwrap();
    let result_for = |question_id: &str| -> &serde_json::Value {
        question_results
            .iter()
            .find(|entry| entry["questionId"] == question_id)
            .unwrap_or_else(|| panic!("missing grading row for {question_id}"))
    };

    // Correct answers grade correct (TextAnyOf with whitespace collapse).
    assert_eq!(result_for("l-short-1")["isCorrect"], true, "  diagram  == diagram");
    assert_eq!(result_for("l-tfng-1")["isCorrect"], true);
    assert_eq!(result_for("l-match-q1")["isCorrect"], true);
    // Multi-select grades as an order-insensitive set.
    assert_eq!(result_for("l-multi-1")["isCorrect"], true, "[\"C\",\"A\"] equals set A,C");
    // Sentence slots grade per blank; cleared slots are absent → wrong. The
    // grading questionId is the same raw "{question_id}:{blank_id}" concat.
    assert_eq!(result_for("l-blank-2:l-blank-2:b1")["isCorrect"], false, "cleared blank");
    assert_eq!(result_for("l-blank-2:l-blank-2:b2")["isCorrect"], true);
    // Diagram labels grade per label; the cleared label is wrong.
    assert_eq!(result_for("l-map-1:l1")["isCorrect"], true);
    assert_eq!(result_for("l-map-1:l2")["isCorrect"], false, "cleared label");
    // Shared-answer sentence folds case: "Apple" matches "apple".
    assert_eq!(result_for("l-blank-shared-1:l-blank-shared-1:b1")["isCorrect"], true);
    // Wrong, case-variant, and cleared answers grade wrong.
    assert_eq!(
        result_for("l-short-2")["isCorrect"],
        false,
        "\"Petrol\" != \"petrol\" (plain-text grading is case-sensitive)"
    );
    assert_eq!(result_for("l-choice-1")["isCorrect"], false, "cleared choice");
    // The legacy-minimal TFNG question (q1, no answer key) has no grading spec.
    assert!(
        question_results.iter().all(|entry| entry["questionId"] != "q1"),
        "q1 has no correctAnswer metadata, so no grading row may exist"
    );

    database.shutdown().await;
}

// ---- BEX-070/071 helpers (grading leg, mirrors the bex035 pattern) --------

// Live-runtime bootstrap for a fresh candidate (the StartRuntime command must
// already have been applied once for the schedule — it is not idempotent).
// Each candidate needs a distinct registration wcode on the shared schedule.
async fn bex070_bootstrap_attempt(
    app: &axum::Router,
    pool: &sqlx::MySqlPool,
    schedule_id: Uuid,
    candidate_id: &str,
    wcode: &str,
) -> (String, String, i32) {
    let (auth, student_key) =
        create_student_auth_with_wcode(pool, schedule_id, candidate_id, wcode).await;
    let (bootstrap, _client_session_id) =
        bootstrap_attempt(app, &auth, schedule_id, candidate_id, &student_key).await;
    assert_eq!(
        bootstrap["data"]["attempt"]["phase"],
        "exam",
        "attempt for {candidate_id} must be phase=exam for submit"
    );
    let attempt_id = bootstrap["data"]["attempt"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let attempt_token = bootstrap["data"]["attemptCredential"]["attemptToken"]
        .as_str()
        .unwrap()
        .to_owned();
    let base_revision = bootstrap["data"]["attempt"]["revision"]
        .as_i64()
        .unwrap() as i32;
    (attempt_id, attempt_token, base_revision)
}

// Mutate with an OK expectation; returns the new revision.
async fn bex070_mutate_ok(
    app: &axum::Router,
    attempt_token: &str,
    schedule_id: Uuid,
    attempt_id: &str,
    mutation_id: &str,
    base_revision: i32,
    mutation_fields: serde_json::Value,
) -> i32 {
    let (status, json) = post_single_mutation_batch(
        app,
        attempt_token,
        schedule_id,
        attempt_id,
        mutation_id,
        base_revision,
        mutation_fields,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{mutation_id} failed: {json}");
    json["data"]["revision"].as_i64().unwrap() as i32
}

// Mutate with a 422 VALIDATION_ERROR expectation; revision must not advance.
async fn bex070_mutate_rejected(
    app: &axum::Router,
    pool: &sqlx::MySqlPool,
    attempt_token: &str,
    schedule_id: Uuid,
    attempt_id: &str,
    mutation_id: &str,
    base_revision: i32,
    mutation_fields: serde_json::Value,
) {
    let (status, json) = post_single_mutation_batch(
        app,
        attempt_token,
        schedule_id,
        attempt_id,
        mutation_id,
        base_revision,
        mutation_fields,
    )
    .await;
    assert_eq!(
        status,
        StatusCode::UNPROCESSABLE_ENTITY,
        "{mutation_id}: {json}"
    );
    assert_eq!(json["error"]["code"], "VALIDATION_ERROR", "{mutation_id}: {json}");
    assert_eq!(
        persisted_revision(pool, attempt_id).await,
        i64::from(base_revision),
        "{mutation_id}: rejected batch must not advance the revision"
    );
}

// Submit the attempt (answers already persisted via mutations; an optional
// finalAnswerPatch carries patch-only values such as Enum whitespace/case
// probes or the writing essay), run the worker-equivalent projection cycle,
// and return (final_submission, listening auto_grading_results).
async fn bex070_submit_and_project_listening(
    app: &axum::Router,
    pool: &sqlx::MySqlPool,
    schedule_id: Uuid,
    attempt_token: &str,
    attempt_id: &str,
    base_revision: i32,
    idempotency_key: &str,
    submission_id: &str,
    final_answer_patch: Option<serde_json::Value>,
) -> (serde_json::Value, serde_json::Value) {
    let mut body = json!({
        "attemptId": attempt_id,
        "lastSeenRevision": base_revision,
        "submissionId": submission_id,
        "clientFinalSeq": 0,
        "serverAcceptedThroughSeq": 0,
    });
    if let Some(patch) = final_answer_patch {
        body["finalAnswerPatch"] = patch;
    }
    let (status, json) =
        post_submit_json(app, attempt_token, schedule_id, Some(idempotency_key), body).await;
    assert_eq!(status, StatusCode::OK, "submit conflict body: {json}");
    assert_eq!(json["data"]["attempt"]["phase"], "post-exam");

    let grading = GradingService::new(pool.clone());
    let report = grading
        .run_projection_cycle(GradingProjectionRequest {
            watermark: None,
            bootstrap_after: None,
            batch_size: None,
        })
        .await
        .unwrap();
    assert!(
        report.submission_rows_synced >= 1 && report.section_rows_synced >= 1,
        "projection must materialize the submission: {report:?}"
    );

    let auto: serde_json::Value = sqlx::query_scalar(
        "SELECT section_submissions.auto_grading_results FROM section_submissions JOIN student_submissions ON student_submissions.id = section_submissions.submission_id WHERE student_submissions.attempt_id = ? AND section_submissions.section = 'listening'",
    )
    .bind(attempt_id)
    .fetch_one(pool)
    .await
    .unwrap();
    let final_submission = persisted_final_submission(pool, attempt_id).await;
    (final_submission, auto)
}

fn bex070_result_for<'a>(
    question_results: &'a [serde_json::Value],
    question_id: &str,
) -> &'a serde_json::Value {
    question_results
        .iter()
        .find(|entry| entry["questionId"] == question_id)
        .unwrap_or_else(|| panic!("missing grading row for {question_id}"))
}

async fn bex071_listening_auto_results(
    pool: &sqlx::MySqlPool,
    attempt_id: &str,
) -> serde_json::Value {
    sqlx::query_scalar::<_, serde_json::Value>(
        "SELECT section_submissions.auto_grading_results FROM section_submissions JOIN student_submissions ON student_submissions.id = section_submissions.submission_id WHERE student_submissions.attempt_id = ? AND section_submissions.section = 'listening'",
    )
    .bind(attempt_id)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn bex071_listening_section_answers(
    pool: &sqlx::MySqlPool,
    attempt_id: &str,
) -> serde_json::Value {
    sqlx::query_scalar::<_, serde_json::Value>(
        "SELECT section_submissions.answers FROM section_submissions JOIN student_submissions ON student_submissions.id = section_submissions.submission_id WHERE student_submissions.attempt_id = ? AND section_submissions.section = 'listening'",
    )
    .bind(attempt_id)
    .fetch_one(pool)
    .await
    .unwrap()
}

// BEX-070 — per-type objective grading matrix. Every objective question type
// in the seed snapshot is pinned for: exact correct, incorrect, blank, extra
// whitespace, and case handling. The mutation layer is the first line of
// enforcement for Enum-constrained types (whitespace/case variants are
// rejected with 422); the grading layer is probed directly through the submit
// finalAnswerPatch path (the only way a non-conforming value can reach the
// final snapshot) and must still grade those variants wrong.
#[tokio::test]
async fn bex070_objective_grading_matrix() {
    let database = mysql::TestDatabase::new(DELIVERY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();
    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));
    SchedulingService::new(database.pool().clone())
        .apply_runtime_command(
            &contract_actor(),
            schedule_id,
            RuntimeCommandRequest {
                action: RuntimeCommandAction::StartRuntime,
                reason: Some("contract runtime start (BEX-070)".to_owned()),
            },
        )
        .await
        .unwrap();

    // ---- Attempt A (alice): exact-answer cells -----------------------------
    let (attempt_id, attempt_token, mut revision) =
        bex070_bootstrap_attempt(&app, database.pool(), schedule_id, "alice", "w-bex070-alice").await;
    revision = bex070_mutate_ok(
        &app,
        &attempt_token,
        schedule_id,
        &attempt_id,
        "bex070-a-short1",
        revision,
        json!({"type": "SetScalar", "questionId": "l-short-1", "value": "diagram"}),
    )
    .await;
    revision = bex070_mutate_ok(
        &app,
        &attempt_token,
        schedule_id,
        &attempt_id,
        "bex070-a-short2",
        revision,
        json!({"type": "SetScalar", "questionId": "l-short-2", "value": "petrol"}),
    )
    .await;
    revision = bex070_mutate_ok(
        &app,
        &attempt_token,
        schedule_id,
        &attempt_id,
        "bex070-a-tfng",
        revision,
        json!({"type": "SetScalar", "questionId": "l-tfng-1", "value": "T"}),
    )
    .await;
    revision = bex070_mutate_ok(
        &app,
        &attempt_token,
        schedule_id,
        &attempt_id,
        "bex070-a-match",
        revision,
        json!({"type": "SetScalar", "questionId": "l-match-q1", "value": "ii"}),
    )
    .await;
    revision = bex070_mutate_ok(
        &app,
        &attempt_token,
        schedule_id,
        &attempt_id,
        "bex070-a-multi",
        revision,
        json!({"type": "SetChoice", "questionId": "l-multi-1", "value": ["C", "A"]}),
    )
    .await;
    revision = bex070_mutate_ok(
        &app,
        &attempt_token,
        schedule_id,
        &attempt_id,
        "bex070-a-choice",
        revision,
        json!({"type": "SetChoice", "questionId": "l-choice-1", "value": "B"}),
    )
    .await;
    // Sentence blank 1 exact; blank 2 left cleared → blank cell.
    revision = bex070_mutate_ok(
        &app,
        &attempt_token,
        schedule_id,
        &attempt_id,
        "bex070-a-blank-slot0",
        revision,
        json!({"type": "SetSlot", "questionId": "l-blank-2", "slotIndex": 0, "value": "first"}),
    )
    .await;
    // Diagram labels both exact.
    revision = bex070_mutate_ok(
        &app,
        &attempt_token,
        schedule_id,
        &attempt_id,
        "bex070-a-map-slot0",
        revision,
        json!({"type": "SetSlot", "questionId": "l-map-1", "slotIndex": 0, "value": "nose"}),
    )
    .await;
    revision = bex070_mutate_ok(
        &app,
        &attempt_token,
        schedule_id,
        &attempt_id,
        "bex070-a-map-slot1",
        revision,
        json!({"type": "SetSlot", "questionId": "l-map-1", "slotIndex": 1, "value": "ear"}),
    )
    .await;
    // Shared-answer sentence: exact pool value.
    revision = bex070_mutate_ok(
        &app,
        &attempt_token,
        schedule_id,
        &attempt_id,
        "bex070-a-shared",
        revision,
        json!({"type": "SetSlot", "questionId": "l-blank-shared-1", "slotIndex": 0, "value": "apple"}),
    )
    .await;
    let (final_submission, auto) = bex070_submit_and_project_listening(
        &app,
        database.pool(),
        schedule_id,
        &attempt_token,
        &attempt_id,
        revision,
        "bex070-a-submit",
        "bex070-a-submission",
        None,
    )
    .await;
    assert_eq!(
        final_submission["answers"]["l-blank-2"],
        json!(["first"]),
        "final snapshot carries the persisted partial fill"
    );
    let results = auto["questionResults"].as_array().unwrap();
    // All 11 seed objective questions grade; the legacy-minimal TFNG (q1) does not.
    assert_eq!(results.len(), 11, "seed listening spec count: {auto}");
    let result_for = |question_id: &str| bex070_result_for(results, question_id);
    assert_eq!(result_for("l-short-1")["isCorrect"], true, "Text exact");
    assert_eq!(result_for("l-short-2")["isCorrect"], true, "Text exact");
    assert_eq!(result_for("l-tfng-1")["isCorrect"], true, "Enum exact");
    assert_eq!(result_for("l-match-q1")["isCorrect"], true, "Enum exact");
    assert_eq!(result_for("l-choice-1")["isCorrect"], true, "Enum exact");
    assert_eq!(
        result_for("l-multi-1")["isCorrect"], true,
        "set exact, order-insensitive [\"C\",\"A\"]"
    );
    assert_eq!(result_for("l-blank-2:l-blank-2:b1")["isCorrect"], true, "sentence exact");
    assert_eq!(
        result_for("l-blank-2:l-blank-2:b2")["isCorrect"], false,
        "sentence blank (cleared slot)"
    );
    assert_eq!(result_for("l-map-1:l1")["isCorrect"], true, "diagram exact");
    assert_eq!(result_for("l-map-1:l2")["isCorrect"], true, "diagram exact");
    assert_eq!(
        result_for("l-blank-shared-1:l-blank-shared-1:b1")["isCorrect"], true,
        "shared pool exact"
    );
    assert!(
        results.iter().all(|entry| entry["questionId"] != "q1"),
        "legacy-minimal q1 has no grading row"
    );

    // ---- Attempt B (bob): whitespace, case, incorrect (mutation path) ------
    let (attempt_id, attempt_token, mut revision) =
        bex070_bootstrap_attempt(&app, database.pool(), schedule_id, "bob", "w-bex070-bob").await;
    // Text: whitespace collapses → correct; case is sensitive → wrong.
    revision = bex070_mutate_ok(
        &app,
        &attempt_token,
        schedule_id,
        &attempt_id,
        "bex070-b-short1",
        revision,
        json!({"type": "SetScalar", "questionId": "l-short-1", "value": "  diagram  "}),
    )
    .await;
    revision = bex070_mutate_ok(
        &app,
        &attempt_token,
        schedule_id,
        &attempt_id,
        "bex070-b-short2",
        revision,
        json!({"type": "SetScalar", "questionId": "l-short-2", "value": "Petrol"}),
    )
    .await;
    // Sentence: whitespace collapses per blank; case is sensitive.
    revision = bex070_mutate_ok(
        &app,
        &attempt_token,
        schedule_id,
        &attempt_id,
        "bex070-b-blank-slot0",
        revision,
        json!({"type": "SetSlot", "questionId": "l-blank-2", "slotIndex": 0, "value": "first "}),
    )
    .await;
    revision = bex070_mutate_ok(
        &app,
        &attempt_token,
        schedule_id,
        &attempt_id,
        "bex070-b-blank-slot1",
        revision,
        json!({"type": "SetSlot", "questionId": "l-blank-2", "slotIndex": 1, "value": "SECOND"}),
    )
    .await;
    // Diagram: whitespace collapses per label; case is sensitive.
    revision = bex070_mutate_ok(
        &app,
        &attempt_token,
        schedule_id,
        &attempt_id,
        "bex070-b-map-slot0",
        revision,
        json!({"type": "SetSlot", "questionId": "l-map-1", "slotIndex": 0, "value": " nose "}),
    )
    .await;
    revision = bex070_mutate_ok(
        &app,
        &attempt_token,
        schedule_id,
        &attempt_id,
        "bex070-b-map-slot1",
        revision,
        json!({"type": "SetSlot", "questionId": "l-map-1", "slotIndex": 1, "value": "Ear"}),
    )
    .await;
    // Enum/set incorrect answers (valid values, wrong picks).
    revision = bex070_mutate_ok(
        &app,
        &attempt_token,
        schedule_id,
        &attempt_id,
        "bex070-b-tfng",
        revision,
        json!({"type": "SetScalar", "questionId": "l-tfng-1", "value": "F"}),
    )
    .await;
    revision = bex070_mutate_ok(
        &app,
        &attempt_token,
        schedule_id,
        &attempt_id,
        "bex070-b-match",
        revision,
        json!({"type": "SetScalar", "questionId": "l-match-q1", "value": "i"}),
    )
    .await;
    revision = bex070_mutate_ok(
        &app,
        &attempt_token,
        schedule_id,
        &attempt_id,
        "bex070-b-multi",
        revision,
        json!({"type": "SetChoice", "questionId": "l-multi-1", "value": ["A", "B"]}),
    )
    .await;
    revision = bex070_mutate_ok(
        &app,
        &attempt_token,
        schedule_id,
        &attempt_id,
        "bex070-b-choice",
        revision,
        json!({"type": "SetChoice", "questionId": "l-choice-1", "value": "A"}),
    )
    .await;
    // Shared sentence: value outside the pool.
    revision = bex070_mutate_ok(
        &app,
        &attempt_token,
        schedule_id,
        &attempt_id,
        "bex070-b-shared",
        revision,
        json!({"type": "SetSlot", "questionId": "l-blank-shared-1", "slotIndex": 0, "value": "pear"}),
    )
    .await;
    let (_, auto) = bex070_submit_and_project_listening(
        &app,
        database.pool(),
        schedule_id,
        &attempt_token,
        &attempt_id,
        revision,
        "bex070-b-submit",
        "bex070-b-submission",
        None,
    )
    .await;
    let results = auto["questionResults"].as_array().unwrap();
    let result_for = |question_id: &str| bex070_result_for(results, question_id);
    assert_eq!(result_for("l-short-1")["isCorrect"], true, "Text whitespace collapses");
    assert_eq!(result_for("l-short-2")["isCorrect"], false, "Text case-sensitive");
    assert_eq!(result_for("l-blank-2:l-blank-2:b1")["isCorrect"], true, "sentence whitespace collapses");
    assert_eq!(result_for("l-blank-2:l-blank-2:b2")["isCorrect"], false, "sentence case-sensitive");
    assert_eq!(result_for("l-map-1:l1")["isCorrect"], true, "diagram whitespace collapses");
    assert_eq!(result_for("l-map-1:l2")["isCorrect"], false, "diagram case-sensitive");
    assert_eq!(result_for("l-tfng-1")["isCorrect"], false, "Enum incorrect");
    assert_eq!(result_for("l-match-q1")["isCorrect"], false, "Enum incorrect");
    assert_eq!(result_for("l-multi-1")["isCorrect"], false, "set incorrect");
    assert_eq!(result_for("l-choice-1")["isCorrect"], false, "Enum incorrect");
    assert_eq!(
        result_for("l-blank-shared-1:l-blank-shared-1:b1")["isCorrect"], false,
        "shared pool: value outside pool is wrong"
    );

    // ---- Attempt C (carol): patch-path whitespace probes + text wrong/blank -
    // Enum/set whitespace variants are rejected at the mutation layer...
    let (attempt_id, attempt_token, mut revision) =
        bex070_bootstrap_attempt(&app, database.pool(), schedule_id, "carol", "w-bex070-carol").await;
    bex070_mutate_rejected(
        &app,
        database.pool(),
        &attempt_token,
        schedule_id,
        &attempt_id,
        "bex070-c-tfng-ws",
        revision,
        json!({"type": "SetScalar", "questionId": "l-tfng-1", "value": " T "}),
    )
    .await;
    bex070_mutate_rejected(
        &app,
        database.pool(),
        &attempt_token,
        schedule_id,
        &attempt_id,
        "bex070-c-match-ws",
        revision,
        json!({"type": "SetScalar", "questionId": "l-match-q1", "value": "ii "}),
    )
    .await;
    bex070_mutate_rejected(
        &app,
        database.pool(),
        &attempt_token,
        schedule_id,
        &attempt_id,
        "bex070-c-choice-ws",
        revision,
        json!({"type": "SetChoice", "questionId": "l-choice-1", "value": " B"}),
    )
    .await;
    bex070_mutate_rejected(
        &app,
        database.pool(),
        &attempt_token,
        schedule_id,
        &attempt_id,
        "bex070-c-multi-ws",
        revision,
        json!({"type": "SetChoice", "questionId": "l-multi-1", "value": ["A", "C "]}),
    )
    .await;
    // ... so the finalAnswerPatch path is the only way they can reach the
    // final snapshot; grading must still grade them wrong.
    revision = bex070_mutate_ok(
        &app,
        &attempt_token,
        schedule_id,
        &attempt_id,
        "bex070-c-short1",
        revision,
        json!({"type": "SetScalar", "questionId": "l-short-1", "value": "bicycle"}),
    )
    .await;
    revision = bex070_mutate_ok(
        &app,
        &attempt_token,
        schedule_id,
        &attempt_id,
        "bex070-c-short2-clear",
        revision,
        json!({"type": "ClearScalar", "questionId": "l-short-2"}),
    )
    .await;
    revision = bex070_mutate_ok(
        &app,
        &attempt_token,
        schedule_id,
        &attempt_id,
        "bex070-c-blank-slot0",
        revision,
        json!({"type": "SetSlot", "questionId": "l-blank-2", "slotIndex": 0, "value": "wrong"}),
    )
    .await;
    revision = bex070_mutate_ok(
        &app,
        &attempt_token,
        schedule_id,
        &attempt_id,
        "bex070-c-blank-slot1",
        revision,
        json!({"type": "SetSlot", "questionId": "l-blank-2", "slotIndex": 1, "value": "wrong2"}),
    )
    .await;
    revision = bex070_mutate_ok(
        &app,
        &attempt_token,
        schedule_id,
        &attempt_id,
        "bex070-c-map-slot0",
        revision,
        json!({"type": "SetSlot", "questionId": "l-map-1", "slotIndex": 0, "value": "nose"}),
    )
    .await;
    revision = bex070_mutate_ok(
        &app,
        &attempt_token,
        schedule_id,
        &attempt_id,
        "bex070-c-map-slot1",
        revision,
        json!({"type": "SetSlot", "questionId": "l-map-1", "slotIndex": 1, "value": "leg"}),
    )
    .await;
    let (final_submission, auto) = bex070_submit_and_project_listening(
        &app,
        database.pool(),
        schedule_id,
        &attempt_token,
        &attempt_id,
        revision,
        "bex070-c-submit",
        "bex070-c-submission",
        Some(json!({
            "answers": {
                "l-tfng-1": " T ",
                "l-match-q1": "ii ",
                "l-choice-1": " B",
                "l-multi-1": ["A", "C "]
            },
            "writingAnswers": {},
            "flags": {}
        })),
    )
    .await;
    // The patch is merged into the snapshot byte-exact (no validation).
    assert_eq!(final_submission["answers"]["l-tfng-1"], " T ");
    let results = auto["questionResults"].as_array().unwrap();
    let result_for = |question_id: &str| bex070_result_for(results, question_id);
    assert_eq!(result_for("l-short-1")["isCorrect"], false, "Text incorrect");
    assert_eq!(result_for("l-short-2")["isCorrect"], false, "Text blank (cleared)");
    assert_eq!(result_for("l-blank-2:l-blank-2:b1")["isCorrect"], false, "sentence incorrect");
    assert_eq!(result_for("l-blank-2:l-blank-2:b2")["isCorrect"], false, "sentence incorrect");
    assert_eq!(result_for("l-map-1:l1")["isCorrect"], true);
    assert_eq!(result_for("l-map-1:l2")["isCorrect"], false, "diagram incorrect");
    assert_eq!(
        result_for("l-tfng-1")["isCorrect"], false,
        "Enum whitespace variant must grade wrong (patch path)"
    );
    assert_eq!(
        result_for("l-match-q1")["isCorrect"], false,
        "Enum whitespace variant must grade wrong (patch path)"
    );
    assert_eq!(
        result_for("l-choice-1")["isCorrect"], false,
        "Enum whitespace variant must grade wrong (patch path)"
    );
    assert_eq!(
        result_for("l-multi-1")["isCorrect"], false,
        "set whitespace variant must grade wrong (ExactSet is byte-strict)"
    );
    assert_eq!(
        result_for("l-blank-shared-1:l-blank-shared-1:b1")["isCorrect"], false,
        "shared blank (unanswered)"
    );

    // ---- Attempt D (dave): blank matrix (nothing answered) -----------------
    let (attempt_id, attempt_token, revision) =
        bex070_bootstrap_attempt(&app, database.pool(), schedule_id, "dave", "w-bex070-dave").await;
    let (_, auto) = bex070_submit_and_project_listening(
        &app,
        database.pool(),
        schedule_id,
        &attempt_token,
        &attempt_id,
        revision,
        "bex070-d-submit",
        "bex070-d-submission",
        None,
    )
    .await;
    let results = auto["questionResults"].as_array().unwrap();
    assert_eq!(results.len(), 11);
    for entry in results {
        assert_eq!(
            entry["isCorrect"], false,
            "unanswered {} must grade wrong: {auto}",
            entry["questionId"]
        );
        assert_eq!(entry["awardedScore"], 0);
    }
    assert_eq!(auto["totalScore"], 0, "blank matrix totals zero");
    assert_eq!(auto["maxScore"], 11, "blank matrix keeps full max");

    // ---- Attempt E (erin): patch-path case probes + shared case-fold -------
    let (attempt_id, attempt_token, revision) =
        bex070_bootstrap_attempt(&app, database.pool(), schedule_id, "erin", "w-bex070-erin").await;
    let (_, auto) = bex070_submit_and_project_listening(
        &app,
        database.pool(),
        schedule_id,
        &attempt_token,
        &attempt_id,
        revision,
        "bex070-e-submit",
        "bex070-e-submission",
        Some(json!({
            "answers": {
                "l-tfng-1": "t",
                "l-choice-1": "b",
                "l-multi-1": ["a", "c"],
                "l-blank-shared-1": ["APPLE"]
            },
            "writingAnswers": {},
            "flags": {}
        })),
    )
    .await;
    let results = auto["questionResults"].as_array().unwrap();
    let result_for = |question_id: &str| bex070_result_for(results, question_id);
    assert_eq!(
        result_for("l-tfng-1")["isCorrect"], false,
        "Enum case variant must grade wrong (patch path)"
    );
    assert_eq!(
        result_for("l-choice-1")["isCorrect"], false,
        "Enum case variant must grade wrong (patch path)"
    );
    assert_eq!(
        result_for("l-multi-1")["isCorrect"], false,
        "set case variant must grade wrong"
    );
    assert_eq!(
        result_for("l-blank-shared-1:l-blank-shared-1:b1")["isCorrect"], true,
        "shared pool folds case: \"APPLE\" == \"apple\""
    );

    database.shutdown().await;
}

// BEX-070 — shared-answer pool consumption semantics: a shared pool is
// consumed in blank order; a repeated (already consumed) value grades wrong
// even when case-folded; wrong values are NOT consumed; when blanks outnumber
// the valid answers, the excess blanks must grade wrong.
#[tokio::test]
async fn bex070_shared_answer_pool_matrix() {
    let database = mysql::TestDatabase::new(DELIVERY_MIGRATIONS).await;
    // Augment the seed snapshot locally with two shared-pool sentences:
    // l-blank-shared-2 has a 2-answer pool and l-blank-shared-3 has a 1-answer
    // pool with 2 blanks (blanks outnumber valid answers).
    let mut snapshot = default_delivery_content_snapshot();
    let blocks = snapshot["listening"]["parts"][0]["blocks"]
        .as_array_mut()
        .expect("listening blocks");
    blocks.push(json!({
        "id": "l-blank-shared-2",
        "type": "SENTENCE_COMPLETION",
        "questions": [{
            "id": "l-blank-shared-2",
            "sentence": "Shared pool of two: __ and __.",
            "acceptAnyAnswerKey": true,
            "sharedAcceptedAnswers": ["apple", "banana"],
            "blanks": [{"id": "b1"}, {"id": "b2"}]
        }]
    }));
    blocks.push(json!({
        "id": "l-blank-shared-3",
        "type": "SENTENCE_COMPLETION",
        "questions": [{
            "id": "l-blank-shared-3",
            "sentence": "Shared pool of one: __ and __.",
            "acceptAnyAnswerKey": true,
            "sharedAcceptedAnswers": ["apple"],
            "blanks": [{"id": "b1"}, {"id": "b2"}]
        }]
    }));
    let schedule = seed_schedule_with_slug_content_and_config(
        database.pool(),
        "cambridge-19-academic-bex070-shared-pool",
        snapshot,
        sample_delivery_config(),
    )
    .await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();
    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));
    SchedulingService::new(database.pool().clone())
        .apply_runtime_command(
            &contract_actor(),
            schedule_id,
            RuntimeCommandRequest {
                action: RuntimeCommandAction::StartRuntime,
                reason: Some("contract runtime start (BEX-070 shared pool)".to_owned()),
            },
        )
        .await
        .unwrap();

    // ---- Attempt F1 (fiona): pool values (case-folded) + duplicate ---------
    let (attempt_id, attempt_token, mut revision) =
        bex070_bootstrap_attempt(&app, database.pool(), schedule_id, "fiona", "w-bex070-fiona").await;
    revision = bex070_mutate_ok(
        &app,
        &attempt_token,
        schedule_id,
        &attempt_id,
        "bex070-f1-s2-slot0",
        revision,
        json!({"type": "SetSlot", "questionId": "l-blank-shared-2", "slotIndex": 0, "value": "APPLE"}),
    )
    .await;
    revision = bex070_mutate_ok(
        &app,
        &attempt_token,
        schedule_id,
        &attempt_id,
        "bex070-f1-s2-slot1",
        revision,
        json!({"type": "SetSlot", "questionId": "l-blank-shared-2", "slotIndex": 1, "value": "Banana"}),
    )
    .await;
    revision = bex070_mutate_ok(
        &app,
        &attempt_token,
        schedule_id,
        &attempt_id,
        "bex070-f1-s3-slot0",
        revision,
        json!({"type": "SetSlot", "questionId": "l-blank-shared-3", "slotIndex": 0, "value": "apple"}),
    )
    .await;
    revision = bex070_mutate_ok(
        &app,
        &attempt_token,
        schedule_id,
        &attempt_id,
        "bex070-f1-s3-slot1",
        revision,
        json!({"type": "SetSlot", "questionId": "l-blank-shared-3", "slotIndex": 1, "value": "apple"}),
    )
    .await;
    let (_, auto) = bex070_submit_and_project_listening(
        &app,
        database.pool(),
        schedule_id,
        &attempt_token,
        &attempt_id,
        revision,
        "bex070-f1-submit",
        "bex070-f1-submission",
        None,
    )
    .await;
    let results = auto["questionResults"].as_array().unwrap();
    assert_eq!(results.len(), 15, "augmented snapshot spec count: {auto}");
    let result_for = |question_id: &str| bex070_result_for(results, question_id);
    assert_eq!(
        result_for("l-blank-shared-2:b1")["isCorrect"], true,
        "shared pool: case-folded pool value is correct"
    );
    assert_eq!(
        result_for("l-blank-shared-2:b2")["isCorrect"], true,
        "shared pool: second distinct pool value is correct"
    );
    assert_eq!(
        result_for("l-blank-shared-3:b1")["isCorrect"], true,
        "first blank consumes the only valid answer"
    );
    assert_eq!(
        result_for("l-blank-shared-3:b2")["isCorrect"], false,
        "duplicate consumption: repeated value must grade wrong"
    );
    // 2 (pool-2 sentence) + 1 (pool-1 first blank) — the consumed duplicate
    // and every unanswered seed question grade wrong.
    assert_eq!(auto["totalScore"], 3, "consumption-aware totals: {auto}");

    // ---- Attempt F2 (george): order independence + wrong-not-consumed ------
    let (attempt_id, attempt_token, mut revision) =
        bex070_bootstrap_attempt(&app, database.pool(), schedule_id, "george", "w-bex070-george").await;
    revision = bex070_mutate_ok(
        &app,
        &attempt_token,
        schedule_id,
        &attempt_id,
        "bex070-f2-s2-slot0",
        revision,
        json!({"type": "SetSlot", "questionId": "l-blank-shared-2", "slotIndex": 0, "value": "banana"}),
    )
    .await;
    revision = bex070_mutate_ok(
        &app,
        &attempt_token,
        schedule_id,
        &attempt_id,
        "bex070-f2-s2-slot1",
        revision,
        json!({"type": "SetSlot", "questionId": "l-blank-shared-2", "slotIndex": 1, "value": "apple"}),
    )
    .await;
    revision = bex070_mutate_ok(
        &app,
        &attempt_token,
        schedule_id,
        &attempt_id,
        "bex070-f2-s3-slot0",
        revision,
        json!({"type": "SetSlot", "questionId": "l-blank-shared-3", "slotIndex": 0, "value": "cherry"}),
    )
    .await;
    revision = bex070_mutate_ok(
        &app,
        &attempt_token,
        schedule_id,
        &attempt_id,
        "bex070-f2-s3-slot1",
        revision,
        json!({"type": "SetSlot", "questionId": "l-blank-shared-3", "slotIndex": 1, "value": "apple"}),
    )
    .await;
    let (_, auto) = bex070_submit_and_project_listening(
        &app,
        database.pool(),
        schedule_id,
        &attempt_token,
        &attempt_id,
        revision,
        "bex070-f2-submit",
        "bex070-f2-submission",
        None,
    )
    .await;
    let results = auto["questionResults"].as_array().unwrap();
    let result_for = |question_id: &str| bex070_result_for(results, question_id);
    assert_eq!(
        result_for("l-blank-shared-2:b1")["isCorrect"], true,
        "shared pool is order-independent (banana first)"
    );
    assert_eq!(
        result_for("l-blank-shared-2:b2")["isCorrect"], true,
        "shared pool is order-independent (apple second)"
    );
    assert_eq!(
        result_for("l-blank-shared-3:b1")["isCorrect"], false,
        "value outside the pool is wrong"
    );
    assert_eq!(
        result_for("l-blank-shared-3:b2")["isCorrect"], true,
        "a wrong value is NOT consumed; the valid answer remains available"
    );

    // ---- Attempt F3 (hannah): case-folded duplicate consumption ------------
    let (attempt_id, attempt_token, mut revision) =
        bex070_bootstrap_attempt(&app, database.pool(), schedule_id, "hannah", "w-bex070-hannah").await;
    revision = bex070_mutate_ok(
        &app,
        &attempt_token,
        schedule_id,
        &attempt_id,
        "bex070-f3-s2-slot0",
        revision,
        json!({"type": "SetSlot", "questionId": "l-blank-shared-2", "slotIndex": 0, "value": "apple"}),
    )
    .await;
    revision = bex070_mutate_ok(
        &app,
        &attempt_token,
        schedule_id,
        &attempt_id,
        "bex070-f3-s2-slot1",
        revision,
        json!({"type": "SetSlot", "questionId": "l-blank-shared-2", "slotIndex": 1, "value": "banana"}),
    )
    .await;
    revision = bex070_mutate_ok(
        &app,
        &attempt_token,
        schedule_id,
        &attempt_id,
        "bex070-f3-s3-slot0",
        revision,
        json!({"type": "SetSlot", "questionId": "l-blank-shared-3", "slotIndex": 0, "value": "apple"}),
    )
    .await;
    revision = bex070_mutate_ok(
        &app,
        &attempt_token,
        schedule_id,
        &attempt_id,
        "bex070-f3-s3-slot1",
        revision,
        json!({"type": "SetSlot", "questionId": "l-blank-shared-3", "slotIndex": 1, "value": "APPLE"}),
    )
    .await;
    let (_, auto) = bex070_submit_and_project_listening(
        &app,
        database.pool(),
        schedule_id,
        &attempt_token,
        &attempt_id,
        revision,
        "bex070-f3-submit",
        "bex070-f3-submission",
        None,
    )
    .await;
    let results = auto["questionResults"].as_array().unwrap();
    let result_for = |question_id: &str| bex070_result_for(results, question_id);
    assert_eq!(
        result_for("l-blank-shared-3:b1")["isCorrect"], true,
        "first blank consumes \"apple\""
    );
    assert_eq!(
        result_for("l-blank-shared-3:b2")["isCorrect"], false,
        "case-folded repeat is still a consumed duplicate"
    );
    assert_eq!(
        result_for("l-blank-shared-3:b2")["correctAnswer"], "apple",
        "the pool is the correctAnswer display"
    );

    database.shutdown().await;
}

// BEX-071 — submission-to-grading consistency: grading reads the immutable
// final_submission snapshot (not the live answers cache), later attempt-cache
// changes cannot affect results, re-running the projection produces the same
// result, objective totals equal the per-question sums, and writing answers
// remain available for manual/AI grading.
#[tokio::test]
async fn bex071_submission_to_grading_consistency() {
    let database = mysql::TestDatabase::new(DELIVERY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();
    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));
    SchedulingService::new(database.pool().clone())
        .apply_runtime_command(
            &contract_actor(),
            schedule_id,
            RuntimeCommandRequest {
                action: RuntimeCommandAction::StartRuntime,
                reason: Some("contract runtime start (BEX-071)".to_owned()),
            },
        )
        .await
        .unwrap();
    let (attempt_id, attempt_token, mut revision) =
        bex070_bootstrap_attempt(&app, database.pool(), schedule_id, "iris", "w-bex071-iris").await;

    // 7 correct + 4 wrong on purpose (mix of exact, case, blank cells).
    revision = bex070_mutate_ok(
        &app,
        &attempt_token,
        schedule_id,
        &attempt_id,
        "bex071-short1",
        revision,
        json!({"type": "SetScalar", "questionId": "l-short-1", "value": "diagram"}),
    )
    .await;
    revision = bex070_mutate_ok(
        &app,
        &attempt_token,
        schedule_id,
        &attempt_id,
        "bex071-short2",
        revision,
        json!({"type": "SetScalar", "questionId": "l-short-2", "value": "Petrol"}),
    )
    .await;
    revision = bex070_mutate_ok(
        &app,
        &attempt_token,
        schedule_id,
        &attempt_id,
        "bex071-tfng",
        revision,
        json!({"type": "SetScalar", "questionId": "l-tfng-1", "value": "T"}),
    )
    .await;
    revision = bex070_mutate_ok(
        &app,
        &attempt_token,
        schedule_id,
        &attempt_id,
        "bex071-match",
        revision,
        json!({"type": "SetScalar", "questionId": "l-match-q1", "value": "ii"}),
    )
    .await;
    revision = bex070_mutate_ok(
        &app,
        &attempt_token,
        schedule_id,
        &attempt_id,
        "bex071-multi",
        revision,
        json!({"type": "SetChoice", "questionId": "l-multi-1", "value": ["A", "C"]}),
    )
    .await;
    revision = bex070_mutate_ok(
        &app,
        &attempt_token,
        schedule_id,
        &attempt_id,
        "bex071-choice",
        revision,
        json!({"type": "SetChoice", "questionId": "l-choice-1", "value": "A"}),
    )
    .await;
    revision = bex070_mutate_ok(
        &app,
        &attempt_token,
        schedule_id,
        &attempt_id,
        "bex071-blank-slot0",
        revision,
        json!({"type": "SetSlot", "questionId": "l-blank-2", "slotIndex": 0, "value": "first"}),
    )
    .await;
    revision = bex070_mutate_ok(
        &app,
        &attempt_token,
        schedule_id,
        &attempt_id,
        "bex071-map-slot0",
        revision,
        json!({"type": "SetSlot", "questionId": "l-map-1", "slotIndex": 0, "value": "nose"}),
    )
    .await;
    revision = bex070_mutate_ok(
        &app,
        &attempt_token,
        schedule_id,
        &attempt_id,
        "bex071-shared",
        revision,
        json!({"type": "SetSlot", "questionId": "l-blank-shared-1", "slotIndex": 0, "value": "apple"}),
    )
    .await;

    // The writing essay rides the final patch (SetEssayText is section-gated
    // while listening is the active runtime). The key must be the content-
    // declared task id ("writing-1"): the projection materializes per-task
    // rows only for content task ids, while the delivery-side mutation set
    // falls back to the legacy "task1"/"task2" keys.
    let essay = "The chart shows a steady increase in online sales.";
    let (status, json) = post_submit_json(
        &app,
        &attempt_token,
        schedule_id,
        Some("bex071-submit"),
        json!({
            "attemptId": attempt_id.clone(),
            "lastSeenRevision": revision,
            "submissionId": "bex071-submission-1",
            "clientFinalSeq": 0,
            "serverAcceptedThroughSeq": 0,
            "finalAnswerPatch": {
                "answers": {},
                "writingAnswers": { "writing-1": essay },
                "flags": {}
            }
        }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "submit conflict body: {json}");
    assert_eq!(json["data"]["attempt"]["phase"], "post-exam");

    let final_submission = persisted_final_submission(database.pool(), &attempt_id).await;
    assert_eq!(final_submission["writingAnswers"]["writing-1"], essay);
    assert_eq!(final_submission["answers"]["l-short-1"], "diagram");

    // ---- First projection run ----------------------------------------------
    let grading = GradingService::new(database.pool().clone());
    let report1 = grading
        .run_projection_cycle(GradingProjectionRequest {
            watermark: None,
            bootstrap_after: None,
            batch_size: None,
        })
        .await
        .unwrap();
    assert!(
        report1.submission_rows_synced >= 1 && report1.section_rows_synced >= 1,
        "projection must materialize the submission: {report1:?}"
    );

    let auto1 = bex071_listening_auto_results(database.pool(), &attempt_id).await;
    let section_answers1 = bex071_listening_section_answers(database.pool(), &attempt_id).await;

    // Totals identity: sum of per-question marks equals the section totals.
    let results = auto1["questionResults"].as_array().unwrap();
    assert_eq!(results.len(), 11);
    let awarded_sum: i64 = results.iter().map(|entry| entry["awardedScore"].as_i64().unwrap()).sum();
    let max_sum: i64 = results.iter().map(|entry| entry["maxScore"].as_i64().unwrap()).sum();
    assert_eq!(auto1["totalScore"], awarded_sum, "sum(awardedScore) == totalScore");
    assert_eq!(auto1["maxScore"], max_sum, "sum(maxScore) == maxScore");
    assert_eq!(awarded_sum, 7, "designed mix: 7 correct of 11");
    assert_eq!(max_sum, 11);
    assert!(
        (auto1["percentage"].as_f64().unwrap() - (7.0 / 11.0 * 100.0)).abs() < 1e-9,
        "percentage must be totalScore/maxScore*100: {auto1}"
    );
    // Per-question mix (also re-pins the totals' building blocks).
    let result_for = |question_id: &str| bex070_result_for(results, question_id);
    for (question_id, expected) in [
        ("l-short-1", true),
        ("l-tfng-1", true),
        ("l-match-q1", true),
        ("l-multi-1", true),
        ("l-blank-2:l-blank-2:b1", true),
        ("l-map-1:l1", true),
        ("l-blank-shared-1:l-blank-shared-1:b1", true),
        ("l-short-2", false),
        ("l-choice-1", false),
        ("l-blank-2:l-blank-2:b2", false),
        ("l-map-1:l2", false),
    ] {
        assert_eq!(result_for(question_id)["isCorrect"], expected, "{question_id}");
    }

    // Writing answers remain available for manual/AI grading: the immutable
    // snapshot keeps writingAnswers and the projection materializes per-task
    // rows (needs_review) plus the writing section payload.
    let writing_task: (String, String, String) = sqlx::query_as(
        "SELECT task_id, student_text, grading_status FROM writing_task_submissions WHERE submission_id = (SELECT id FROM student_submissions WHERE attempt_id = ?)",
    )
    .bind(&attempt_id)
    .fetch_one(database.pool())
    .await
    .unwrap();
    assert_eq!(writing_task.0, "writing-1");
    assert_eq!(writing_task.1, essay, "writing answer must survive the projection");
    assert_eq!(writing_task.2, "needs_review");
    let writing_section: (String, serde_json::Value) = sqlx::query_as(
        "SELECT grading_status, answers FROM section_submissions WHERE submission_id = (SELECT id FROM student_submissions WHERE attempt_id = ?) AND section = 'writing'",
    )
    .bind(&attempt_id)
    .fetch_one(database.pool())
    .await
    .unwrap();
    assert_eq!(writing_section.0, "needs_review");
    assert_eq!(writing_section.1["tasks"][0]["taskId"], "writing-1");
    assert_eq!(writing_section.1["tasks"][0]["text"], essay);

    // ---- Tamper with the LIVE attempt cache (post-submit) ------------------
    // The attempt-cache columns are mutable after submit; grading must keep
    // reading the immutable final_submission snapshot.
    sqlx::query(
        "UPDATE student_attempts SET answers = ?, writing_answers = ?, flags = ? WHERE id = ?",
    )
    .bind(json!({"l-short-1": "tampered", "q1": "T"}).to_string())
    .bind(json!({"task1": "tampered essay"}).to_string())
    .bind(json!({"l-short-1": true}).to_string())
    .bind(&attempt_id)
    .execute(database.pool())
    .await
    .unwrap();
    assert_eq!(
        persisted_answers(database.pool(), &attempt_id).await["l-short-1"],
        "tampered",
        "precondition: the live cache really changed"
    );

    // ---- Second projection run: results must be unchanged ------------------
    let report2 = grading
        .run_projection_cycle(GradingProjectionRequest {
            watermark: None,
            bootstrap_after: None,
            batch_size: None,
        })
        .await
        .unwrap();
    // The no-watermark cycle re-processes every submitted attempt and
    // re-writes identical values (idempotent content), so the counts are >= 1
    // again while the persisted JSON must be byte-identical.
    assert!(
        report2.submission_rows_synced >= 1 && report2.section_rows_synced >= 1,
        "re-run must re-sync the same attempt: {report2:?}"
    );
    let auto2 = bex071_listening_auto_results(database.pool(), &attempt_id).await;
    let section_answers2 = bex071_listening_section_answers(database.pool(), &attempt_id).await;
    assert_eq!(
        auto1, auto2,
        "grading must read final_submission, not the live answers cache"
    );
    assert_eq!(
        section_answers1, section_answers2,
        "section payload must stay the submitted snapshot"
    );
    let final_submission_after = persisted_final_submission(database.pool(), &attempt_id).await;
    assert_eq!(final_submission, final_submission_after, "final snapshot is immutable");
    let writing_task_after: (String, String, String) = sqlx::query_as(
        "SELECT task_id, student_text, grading_status FROM writing_task_submissions WHERE submission_id = (SELECT id FROM student_submissions WHERE attempt_id = ?)",
    )
    .bind(&attempt_id)
    .fetch_one(database.pool())
    .await
    .unwrap();
    assert_eq!(
        writing_task_after.1, essay,
        "tampered live writing_answers must not reach the writing rows"
    );

    // ---- Third projection run: re-running grading produces the same result --
    let report3 = grading
        .run_projection_cycle(GradingProjectionRequest {
            watermark: None,
            bootstrap_after: None,
            batch_size: None,
        })
        .await
        .unwrap();
    assert!(report3.submission_rows_synced >= 1);
    let auto3 = bex071_listening_auto_results(database.pool(), &attempt_id).await;
    assert_eq!(auto1, auto3, "re-running grading must produce the same result");

    database.shutdown().await;
}

// BEX-030 — the allowlisted legacy payload path: legacy envelopes (attemptId +
// id/seq/timestamp/baseRevision + mutationType/payload) apply the same
// commands, while non-allowlisted legacy types are rejected with the exact
// allowlist message.
#[tokio::test]
async fn mutation_batch_legacy_envelope_allowlist_and_rejects() {
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
    let attempt_id = bootstrap["data"]["attempt"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let attempt_token = bootstrap["data"]["attemptCredential"]["attemptToken"]
        .as_str()
        .unwrap()
        .to_owned();
    let base_revision = bootstrap["data"]["attempt"]["revision"]
        .as_i64()
        .unwrap() as i32;

    let mut current_revision = base_revision;
    let legacy_envelope = |id: &str, seq: i64, base_rev: i32, mutation_type: &str, payload: serde_json::Value| {
        json!({
            "id": id,
            "seq": seq,
            "timestamp": "2026-01-10T09:05:00Z",
            "baseRevision": base_rev,
            "mutationType": mutation_type,
            "payload": payload
        })
    };

    // --- Allowlisted legacy commands apply (SetScalar, SetChoice, SetSlot) ---
    let (status, json) = post_mutation_batch_json(
        &app,
        &attempt_token,
        schedule_id,
        json!({
            "attemptId": attempt_id.clone(),
            "studentKey": student_key.clone(),
            "clientSessionId": client_session_id.clone(),
            "mutations": [
                legacy_envelope("legacy-scalar-1", 1, current_revision, "SetScalar", json!({"questionId": "q1", "value": "A"})),
                legacy_envelope("legacy-choice-1", 2, current_revision, "SetChoice", json!({"questionId": "l-choice-1", "value": "C"})),
                legacy_envelope("legacy-slot-1", 3, current_revision, "SetSlot", json!({"questionId": "l-blank-2", "slotIndex": 0, "value": "legacy"}))
            ]
        }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["data"]["appliedMutationCount"], 3);
    assert_eq!(json["data"]["serverAcceptedThroughSeq"], 3);
    assert_eq!(json["data"]["attempt"]["answers"]["q1"], "A");
    assert_eq!(json["data"]["attempt"]["answers"]["l-choice-1"], "C");
    assert_eq!(json["data"]["attempt"]["answers"]["l-blank-2"], json!(["legacy"]));
    current_revision = json["data"]["revision"].as_i64().unwrap() as i32;

    // --- Non-allowlisted legacy types are rejected with the exact message ----
    let (status, json) = post_mutation_batch_json(
        &app,
        &attempt_token,
        schedule_id,
        json!({
            "attemptId": attempt_id.clone(),
            "studentKey": student_key.clone(),
            "clientSessionId": client_session_id.clone(),
            "mutations": [
                legacy_envelope("legacy-position-1", 1, current_revision, "position", json!({"phase": "exam", "currentModule": "listening"}))
            ]
        }),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(json["error"]["code"], "VALIDATION_ERROR");
    assert_eq!(
        json["error"]["message"],
        "Legacy mutation type `position` is not allowed for mutation batch."
    );

    let (status, json) = post_mutation_batch_json(
        &app,
        &attempt_token,
        schedule_id,
        json!({
            "attemptId": attempt_id.clone(),
            "studentKey": student_key.clone(),
            "clientSessionId": client_session_id.clone(),
            "mutations": [
                legacy_envelope("legacy-answer-1", 1, current_revision, "answer", json!({"questionId": "q1", "value": "A"}))
            ]
        }),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(json["error"]["code"], "VALIDATION_ERROR");
    assert_eq!(
        json["error"]["message"],
        "Legacy mutation type `answer` is not allowed for mutation batch."
    );

    // --- Legacy SetEssayText applies once the writing section is active ------
    // NOTE: seq is intentionally reused (1) after seqs 1-3 were already accepted
    // for this client session. Uniqueness is keyed on the client mutation id, and
    // the seq gate rejects only within-batch duplicates. If a future schema adds a
    // unique index on (attempt_id, client_session_id, mutation_seq), this batch
    // would fail — extend the assertion accordingly rather than reusing seq.
    start_runtime(database.pool(), schedule_id, "writing").await;
    let (status, json) = post_mutation_batch_json(
        &app,
        &attempt_token,
        schedule_id,
        json!({
            "attemptId": attempt_id.clone(),
            "studentKey": student_key.clone(),
            "clientSessionId": client_session_id.clone(),
            "mutations": [
                legacy_envelope("legacy-essay-1", 1, current_revision, "SetEssayText", json!({"taskId": "task1", "value": "legacy draft"}))
            ]
        }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        json["data"]["attempt"]["writingAnswers"]["task1"],
        "legacy draft"
    );

    database.shutdown().await;
}

// BEX-031 — validation rejects: unknown top-level fields (strict-only and
// mixed legacy payloads), unknown mutation types, and missing question/task
// identifiers all yield 422 VALIDATION_ERROR before any state is touched.
#[tokio::test]
async fn mutation_batch_rejects_unknown_top_level_fields_and_malformed_commands() {
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
    let attempt_id = bootstrap["data"]["attempt"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let attempt_token = bootstrap["data"]["attemptCredential"]["attemptToken"]
        .as_str()
        .unwrap()
        .to_owned();
    let base_revision = bootstrap["data"]["attempt"]["revision"]
        .as_i64()
        .unwrap() as i32;

    // (a) Strict-only payload with an unknown top-level field -> 422.
    //     The strict parse rejects it (deny_unknown_fields) and the legacy
    //     fallback must reject it too (it also denies unknown fields), so the
    //     batch is never accepted.
    let (status, json) = post_mutation_batch_json(
        &app,
        &attempt_token,
        schedule_id,
        json!({
            "attemptId": attempt_id.clone(),
            "mutations": [{
                "mutationId": "bex031-a",
                "baseRevision": base_revision,
                "type": "SetScalar",
                "questionId": "q1",
                "value": "A"
            }],
            "unexpectedTopLevelField": 1
        }),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(json["error"]["code"], "VALIDATION_ERROR");
    assert!(
        json["error"]["message"]
            .as_str()
            .unwrap()
            .contains("Invalid mutation batch payload"),
        "expected the dual-parse failure message, got {:?}",
        json["error"]["message"]
    );

    // (b) Payload carrying BOTH strict markers and legacy keys plus an unknown
    //     top-level field -> 422. The strict parse rejects the legacy keys, and
    //     the legacy parse must NOT silently accept the unknown field.
    let (status, json) = post_mutation_batch_json(
        &app,
        &attempt_token,
        schedule_id,
        json!({
            "attemptId": attempt_id.clone(),
            "studentKey": student_key.clone(),
            "clientSessionId": client_session_id.clone(),
            "mutations": [{
                "id": "bex031-b",
                "seq": 1,
                "mutationType": "SetScalar",
                "payload": {"questionId": "q1", "value": "A"}
            }],
            "unexpectedTopLevelField": 1
        }),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(json["error"]["code"], "VALIDATION_ERROR");
    assert!(
        json["error"]["message"]
            .as_str()
            .unwrap()
            .contains("Invalid mutation batch payload"),
        "expected the dual-parse failure message, got {:?}",
        json["error"]["message"]
    );

    // (c) Unknown mutation type -> 422.
    let (status, json) = post_mutation_batch_json(
        &app,
        &attempt_token,
        schedule_id,
        json!({
            "attemptId": attempt_id.clone(),
            "mutations": [{
                "mutationId": "bex031-c",
                "baseRevision": base_revision,
                "type": "teleport",
                "payload": {}
            }]
        }),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(json["error"]["code"], "VALIDATION_ERROR");

    // (d) SetScalar missing questionId -> 422.
    let (status, json) = post_mutation_batch_json(
        &app,
        &attempt_token,
        schedule_id,
        json!({
            "attemptId": attempt_id.clone(),
            "mutations": [{
                "mutationId": "bex031-d",
                "baseRevision": base_revision,
                "type": "SetScalar",
                "value": "A"
            }]
        }),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(json["error"]["code"], "VALIDATION_ERROR");

    // (e) SetEssayText missing taskId -> 422.
    let (status, json) = post_mutation_batch_json(
        &app,
        &attempt_token,
        schedule_id,
        json!({
            "attemptId": attempt_id.clone(),
            "mutations": [{
                "mutationId": "bex031-e",
                "baseRevision": base_revision,
                "type": "SetEssayText",
                "value": "orphan essay"
            }]
        }),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(json["error"]["code"], "VALIDATION_ERROR");

    // No state was touched by any rejected batch.
    let answers: serde_json::Value =
        sqlx::query_scalar("SELECT answers FROM student_attempts WHERE id = ?")
            .bind(&attempt_id)
            .fetch_one(database.pool())
            .await
            .unwrap();
    assert_eq!(answers, json!({}));

    database.shutdown().await;
}

// ---------------------------------------------------------------------------
// BEX-040 — reconnect replay: offline-composed mutations replayed in chunks
// apply deterministically, advance the per-session watermark, and never lose
// or duplicate an accepted mutation.
// ---------------------------------------------------------------------------
#[tokio::test]
async fn bex040_reconnect_replay_chunked_batches_apply_in_order_without_loss() {
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
    // Real runtime start (INSERTs the runtime row; the SQL-only helper cannot
    // be used because it merely UPDATes and would silently leave the runtime
    // absent, disabling the section/objective gates). bex041 instead drives
    // the admin HTTP start_runtime command — both are equivalent real starts.
    SchedulingService::new(database.pool().clone())
        .apply_runtime_command(
            &contract_actor(),
            schedule_id,
            RuntimeCommandRequest {
                action: RuntimeCommandAction::StartRuntime,
                reason: Some("contract runtime start".to_owned()),
            },
        )
        .await
        .unwrap();
    let attempt_id = bootstrap["data"]["attempt"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let attempt_token = bootstrap["data"]["attemptCredential"]["attemptToken"]
        .as_str()
        .unwrap()
        .to_owned();
    let base_revision = bootstrap["data"]["attempt"]["revision"]
        .as_i64()
        .unwrap() as i32;

    // The offline client composed 6 mutations (client order 1..6) while
    // disconnected; on reconnect it replays them in 2 chunks of 3 under the
    // SAME client_session_id. q1 is written three times and l-short-1 twice,
    // so "latest seq wins" is observable both across chunks and within a
    // chunk.
    let chunk1 = json!([
        {"mutationId": "reconnect-m1", "baseRevision": base_revision, "type": "SetChoice", "questionId": "q1", "value": "F"},
        {"mutationId": "reconnect-m2", "baseRevision": base_revision, "type": "SetScalar", "questionId": "l-short-1", "value": "diagram"},
        {"mutationId": "reconnect-m3", "baseRevision": base_revision, "type": "SetChoice", "questionId": "q1", "value": "T"}
    ]);
    let (status, chunk1_json) = post_mutation_batch_json(
        &app,
        &attempt_token,
        schedule_id,
        json!({ "attemptId": attempt_id.clone(), "mutations": chunk1.clone() }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{chunk1_json}");
    // (a)/(c) deterministic order within a chunk: the LAST mutation for q1
    // wins even though an earlier one in the same batch wrote the same key.
    assert_eq!(chunk1_json["data"]["appliedMutationCount"], 3);
    assert_eq!(chunk1_json["data"]["serverAcceptedThroughSeq"], 3);
    assert_eq!(
        chunk1_json["data"]["attempt"]["answers"]["q1"],
        "T",
        "within-chunk latest wins (m3 after m1)"
    );
    assert_eq!(chunk1_json["data"]["attempt"]["answers"]["l-short-1"], "diagram");
    assert_eq!(chunk1_json["data"]["revision"], base_revision + 1);

    let revision_after_chunk1 = chunk1_json["data"]["revision"].as_i64().unwrap() as i32;
    let chunk2 = json!([
        {"mutationId": "reconnect-m4", "baseRevision": revision_after_chunk1, "type": "SetChoice", "questionId": "l-tfng-1", "value": "F"},
        {"mutationId": "reconnect-m5", "baseRevision": revision_after_chunk1, "type": "SetChoice", "questionId": "q1", "value": "F"},
        {"mutationId": "reconnect-m6", "baseRevision": revision_after_chunk1, "type": "SetScalar", "questionId": "l-short-1", "value": "petrol"}
    ]);
    let (status, chunk2_json) = post_mutation_batch_json(
        &app,
        &attempt_token,
        schedule_id,
        json!({ "attemptId": attempt_id.clone(), "mutations": chunk2.clone() }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{chunk2_json}");
    // (b) watermark advances 3 -> 6; (c) latest seq wins ACROSS chunks too.
    assert_eq!(chunk2_json["data"]["appliedMutationCount"], 3);
    assert_eq!(chunk2_json["data"]["serverAcceptedThroughSeq"], 6);
    assert_eq!(chunk2_json["data"]["revision"], base_revision + 2);
    assert_eq!(
        chunk2_json["data"]["attempt"]["answers"]["q1"],
        "F",
        "cross-chunk latest wins (m5 seq 5 after m3 seq 3)"
    );
    assert_eq!(chunk2_json["data"]["attempt"]["answers"]["l-short-1"], "petrol");
    assert_eq!(chunk2_json["data"]["attempt"]["answers"]["l-tfng-1"], "F");
    assert_eq!(
        persisted_revision(database.pool(), &attempt_id).await,
        i64::from(base_revision + 2),
        "persisted revision matches the student-visible revision"
    );

    // (b) the recovery watermark and pending count reflect the persisted
    // state on the response AND in the DB.
    assert_eq!(
        chunk2_json["data"]["attempt"]["recovery"]["serverAcceptedThroughSeq"], 6
    );
    assert_eq!(chunk2_json["data"]["attempt"]["recovery"]["pendingMutationCount"], 0);
    assert_eq!(chunk2_json["data"]["attempt"]["recovery"]["syncState"], "saved");
    assert_eq!(
        chunk2_json["data"]["attempt"]["recovery"]["clientSessionId"],
        client_session_id
    );
    let db_recovery = persisted_recovery(database.pool(), &attempt_id).await;
    assert_eq!(db_recovery["serverAcceptedThroughSeq"], 6);
    assert_eq!(db_recovery["pendingMutationCount"], 0);
    assert_eq!(db_recovery["syncState"], "saved");
    assert_eq!(db_recovery["clientSessionId"], client_session_id);

    // (d) no accepted mutation lost during chunking: exactly one row per
    // client_mutation_id, seqs 1..6 contiguous, exactly two revision bumps.
    assert_eq!(
        persisted_mutation_row_count(database.pool(), &attempt_id).await,
        6,
        "all six accepted mutations persisted exactly once"
    );
    let distinct_ids: i64 = sqlx::query_scalar(
        "SELECT COUNT(DISTINCT client_mutation_id) FROM student_attempt_mutations WHERE attempt_id = ?",
    )
    .bind(&attempt_id)
    .fetch_one(database.pool())
    .await
    .unwrap();
    assert_eq!(distinct_ids, 6, "no duplicate client_mutation_id rows");
    let seqs: String = sqlx::query_scalar(
        "SELECT GROUP_CONCAT(mutation_seq ORDER BY mutation_seq) FROM student_attempt_mutations WHERE attempt_id = ?",
    )
    .bind(&attempt_id)
    .fetch_one(database.pool())
    .await
    .unwrap();
    assert_eq!(seqs, "1,2,3,4,5,6", "watermark seqs are contiguous and in apply order");

    // (d) partial replay: the client re-sends chunk 1 (identical ids/values)
    // after chunk 2 already committed. Dedupe must short-circuit with a 200,
    // zero applied mutations, the CURRENT watermark, and no extra rows. The
    // replayed base is deliberately stale (bootstrap revision): a 200 — not
    // 409 BASE_REVISION_MISMATCH — proves the dedupe fires BEFORE the
    // base-revision gate.
    let (status, replay_json) = post_mutation_batch_json(
        &app,
        &attempt_token,
        schedule_id,
        json!({ "attemptId": attempt_id.clone(), "mutations": chunk1.clone() }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{replay_json}");
    assert_eq!(replay_json["data"]["appliedMutationCount"], 0);
    assert_eq!(replay_json["data"]["serverAcceptedThroughSeq"], 6);
    assert_eq!(replay_json["data"]["revision"], base_revision + 2);
    assert_eq!(
        persisted_mutation_row_count(database.pool(), &attempt_id).await,
        6,
        "replayed chunk must not duplicate or lose rows"
    );
    let answers = persisted_answers(database.pool(), &attempt_id).await;
    assert_eq!(answers["q1"], "F");
    assert_eq!(answers["l-short-1"], "petrol");
    assert_eq!(answers["l-tfng-1"], "F");

    database.shutdown().await;
}

// ---------------------------------------------------------------------------
// BEX-041 — replay across section transition: pending mutations composed
// before a transition are either accepted within the configured grace
// boundary or rejected with a structured section-lock reason. Never a
// generic failure, and never partial state on rejection.
// ---------------------------------------------------------------------------
#[tokio::test]
async fn bex041_replay_across_section_transition_grace_or_structured_conflict() {
    let database = mysql::TestDatabase::new(DELIVERY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();
    let admin_auth = mysql::create_authenticated_user(
        database.pool(),
        UserRole::Admin,
        "admin@example.com",
        "Admin",
    )
    .await;
    let (auth, student_key) = create_student_auth(database.pool(), schedule_id, "alice").await;
    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));
    let (bootstrap, _client_session_id) =
        bootstrap_attempt(&app, &auth, schedule_id, "alice", &student_key).await;
    let start = admin_runtime_command(
        &app,
        &admin_auth,
        schedule_id,
        json!({ "action": "start_runtime" }),
    )
    .await;
    assert_eq!(start.status(), StatusCode::OK);
    let attempt_id = bootstrap["data"]["attempt"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let attempt_token = bootstrap["data"]["attemptCredential"]["attemptToken"]
        .as_str()
        .unwrap()
        .to_owned();
    let mut revision = bootstrap["data"]["attempt"]["revision"]
        .as_i64()
        .unwrap() as i32;

    // ---- (a) TIMER EXPIRY ------------------------------------------------
    // The client composes a listening mutation while the section is live,
    // the section expires (timer path), and the client replays it after the
    // transition.
    let pending_timer_expiry = json!({
        "mutationId": "pending-timer-expiry",
        "baseRevision": revision,
        "type": "SetChoice",
        "questionId": "q1",
        "value": "T"
    });
    transition_runtime_from_listening_to_reading(database.pool(), schedule_id).await;

    // Within the 300s grace window the late listening answer is accepted.
    let (status, json) = post_mutation_batch_json(
        &app,
        &attempt_token,
        schedule_id,
        json!({ "attemptId": attempt_id.clone(), "mutations": [pending_timer_expiry] }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json}");
    assert_eq!(json["data"]["appliedMutationCount"], 1);
    assert_eq!(json["data"]["serverAcceptedThroughSeq"], 1);
    revision = json["data"]["revision"].as_i64().unwrap() as i32;
    assert_eq!(json["data"]["attempt"]["answers"]["q1"], "T");

    // Backdate the completed section beyond the grace boundary: the same
    // kind of late replay must now surface a STRUCTURED section-lock.
    sqlx::query(
        r#"
        UPDATE exam_session_runtime_sections
        SET actual_end_at = NOW() - INTERVAL 360 SECOND
        WHERE runtime_id = (SELECT id FROM exam_session_runtimes WHERE schedule_id = ?)
          AND section_key = 'listening'
        "#,
    )
    .bind(schedule_id.to_string())
    .execute(database.pool())
    .await
    .unwrap();
    let (status, json) = post_mutation_batch_json(
        &app,
        &attempt_token,
        schedule_id,
        json!({
            "attemptId": attempt_id.clone(),
            "mutations": [{
                "mutationId": "pending-timer-expiry-past-grace",
                "baseRevision": revision,
                "type": "SetChoice",
                "questionId": "q1",
                "value": "F"
            }]
        }),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{json}");
    assert_eq!(json["error"]["code"], "CONFLICT");
    assert_eq!(json["error"]["details"]["reason"], "SECTION_MISMATCH");
    assert!(
        json["error"]["message"].as_str().unwrap().contains("q1"),
        "conflict must name the offending question: {json}"
    );
    // No partial state on rejection.
    assert_eq!(persisted_revision(database.pool(), &attempt_id).await, revision as i64);
    assert_eq!(
        persisted_mutation_row_count(database.pool(), &attempt_id).await,
        1,
        "rejected replay must not insert a mutation row"
    );
    let answers = persisted_answers(database.pool(), &attempt_id).await;
    assert_eq!(answers["q1"], "T", "rejected replay must not touch answers");

    // ---- (b) PROCTOR SECTION ADVANCE --------------------------------------
    // The proctor advances reading -> writing through the control surface;
    // a reading mutation composed before the advance is replayed after the
    // grace window has been pushed out (backdate) and must be rejected with
    // the structured reason.
    let advance = admin_end_section_now(
        &app,
        &admin_auth,
        schedule_id,
        json!({ "expectedActiveSectionKey": "reading", "reason": "advance to writing" }),
    )
    .await;
    assert_eq!(advance.status(), StatusCode::OK);
    assert_eq!(json_body(advance).await["data"]["activeSectionKey"], "writing");
    sqlx::query(
        r#"
        UPDATE exam_session_runtime_sections
        SET actual_end_at = NOW() - INTERVAL 360 SECOND
        WHERE runtime_id = (SELECT id FROM exam_session_runtimes WHERE schedule_id = ?)
          AND section_key = 'reading'
        "#,
    )
    .bind(schedule_id.to_string())
    .execute(database.pool())
    .await
    .unwrap();
    let (status, json) = post_mutation_batch_json(
        &app,
        &attempt_token,
        schedule_id,
        json!({
            "attemptId": attempt_id.clone(),
            "mutations": [{
                "mutationId": "pending-proctor-advance",
                "baseRevision": revision,
                "type": "SetChoice",
                "questionId": "r1",
                "value": "T"
            }]
        }),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{json}");
    assert_eq!(json["error"]["code"], "CONFLICT");
    assert_eq!(json["error"]["details"]["reason"], "SECTION_MISMATCH");
    assert_eq!(persisted_revision(database.pool(), &attempt_id).await, revision as i64);
    assert_eq!(
        persisted_mutation_row_count(database.pool(), &attempt_id).await,
        1,
        "proctor-advance rejection must not insert rows"
    );

    // ---- (c) RUNTIME PAUSE -------------------------------------------------
    // (c1) Cohort pause: the runtime status flips to 'paused'; the mutation
    // gate pins OBJECTIVE_LOCKED (objective_mutation_gate blocks any runtime
    // status of paused/completed/cancelled).
    let pause = admin_runtime_command(
        &app,
        &admin_auth,
        schedule_id,
        json!({ "action": "pause_runtime" }),
    )
    .await;
    assert_eq!(pause.status(), StatusCode::OK);
    let (status, json) = post_mutation_batch_json(
        &app,
        &attempt_token,
        schedule_id,
        json!({
            "attemptId": attempt_id.clone(),
            "mutations": [{
                "mutationId": "pending-runtime-pause",
                "baseRevision": revision,
                "type": "SetEssayText",
                "taskId": "task1",
                "value": "draft during pause"
            }]
        }),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{json}");
    assert_eq!(json["error"]["code"], "CONFLICT");
    assert_eq!(
        json["error"]["details"]["reason"], "OBJECTIVE_LOCKED",
        "cohort runtime pause must reject with OBJECTIVE_LOCKED: {json}"
    );
    assert_eq!(persisted_revision(database.pool(), &attempt_id).await, revision as i64);
    assert_eq!(
        persisted_mutation_row_count(database.pool(), &attempt_id).await,
        1,
        "runtime-pause rejection must not insert rows"
    );
    let writing_answers = persisted_writing_answers(database.pool(), &attempt_id).await;
    assert_eq!(writing_answers, json!({}), "runtime-pause rejection must not touch writing answers");

    // (c2) Individual attempt pause: the attempt's proctor_status flips to
    // 'paused' while the runtime stays live; the gate pins
    // ATTEMPT_PROCTOR_BLOCKED.
    let resume = admin_runtime_command(
        &app,
        &admin_auth,
        schedule_id,
        json!({ "action": "resume_runtime" }),
    )
    .await;
    assert_eq!(resume.status(), StatusCode::OK);
    let individual = app
        .clone()
        .oneshot(
            admin_auth
                .with_csrf(Request::builder())
                .method("POST")
                .uri(format!(
                    "/api/v1/proctor/sessions/{schedule_id}/attempts/{attempt_id}/pause"
                ))
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&AttemptCommandRequest {
                        message: None,
                        reason: Some("individual-check".to_owned()),
                        expected_active_section_key: None,
                    })
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(individual.status(), StatusCode::OK);
    // Pin (BEX-041): the individual pause bumps the attempt revision exactly
    // once (update_attempt_status runs revision = revision + 1), so a client
    // re-bases its pending mutation on the post-pause revision; otherwise the
    // base-revision gate (which runs BEFORE the proctor gate) would fire
    // BASE_REVISION_MISMATCH instead of the pause reason.
    let revision_after_pause = persisted_revision(database.pool(), &attempt_id).await as i32;
    assert_eq!(
        revision_after_pause, revision + 1,
        "individual attempt pause bumps the attempt revision once"
    );
    let (status, json) = post_mutation_batch_json(
        &app,
        &attempt_token,
        schedule_id,
        json!({
            "attemptId": attempt_id.clone(),
            "mutations": [{
                "mutationId": "pending-attempt-pause",
                "baseRevision": revision_after_pause,
                "type": "SetEssayText",
                "taskId": "task1",
                "value": "draft while attempt paused"
            }]
        }),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{json}");
    assert_eq!(json["error"]["code"], "CONFLICT");
    assert_eq!(
        json["error"]["details"]["reason"], "ATTEMPT_PROCTOR_BLOCKED",
        "individual attempt pause must reject with ATTEMPT_PROCTOR_BLOCKED: {json}"
    );
    assert_eq!(
        persisted_revision(database.pool(), &attempt_id).await,
        revision_after_pause as i64,
        "attempt-pause rejection must not bump the revision"
    );
    assert_eq!(
        persisted_mutation_row_count(database.pool(), &attempt_id).await,
        1,
        "attempt-pause rejection must not insert rows"
    );
    let resume = app
        .clone()
        .oneshot(
            admin_auth
                .with_csrf(Request::builder())
                .method("POST")
                .uri(format!(
                    "/api/v1/proctor/sessions/{schedule_id}/attempts/{attempt_id}/resume"
                ))
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&AttemptCommandRequest {
                        message: None,
                        reason: Some("resume-after-check".to_owned()),
                        expected_active_section_key: None,
                    })
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resume.status(), StatusCode::OK);

    // ---- (d) FINAL COMPLETION ----------------------------------------------
    // end_runtime auto-submits the attempt (submitted_at = NOW, revision+1).
    // Within the 300s post-submit grace the mutation gate is bypassed and the
    // pending writing answer is accepted (acceptedInGrace = true).
    // The individual resume above bumped the attempt revision once more, so
    // pin the auto-submit bump relative to the pre-end state instead of the
    // stale local variable.
    let revision_before_end = persisted_revision(database.pool(), &attempt_id).await as i32;
    let end = admin_runtime_command(
        &app,
        &admin_auth,
        schedule_id,
        json!({ "action": "end_runtime" }),
    )
    .await;
    assert_eq!(end.status(), StatusCode::OK);
    let revision_after_end = persisted_revision(database.pool(), &attempt_id).await as i32;
    assert_eq!(
        revision_after_end, revision_before_end + 1,
        "auto-submit on end_runtime bumps the attempt revision once"
    );
    let (status, json) = post_mutation_batch_json(
        &app,
        &attempt_token,
        schedule_id,
        json!({
            "attemptId": attempt_id.clone(),
            "mutations": [{
                "mutationId": "pending-final-completion-in-grace",
                "baseRevision": revision_after_end,
                "type": "SetEssayText",
                "taskId": "task1",
                "value": "final draft within grace"
            }]
        }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json}");
    assert_eq!(json["data"]["appliedMutationCount"], 1);
    assert_eq!(json["data"]["serverAcceptedThroughSeq"], 2);
    assert_eq!(
        json["data"]["acceptedInGrace"], true,
        "post-submit grace must accept the pending writing mutation: {json}"
    );
    let revision_after_grace = json["data"]["revision"].as_i64().unwrap() as i32;
    // The grace-accepted recovery fields (postSubmitGraceAcceptedAt,
    // postSubmitGraceLastAppliedMutationCount) are persisted in the DB
    // recovery JSON but NOT echoed in the response attempt: the typed
    // StudentRecovery serialization drops unknown keys. Pin the persisted
    // contract instead.
    let db_recovery = persisted_recovery(database.pool(), &attempt_id).await;
    assert_eq!(
        db_recovery["postSubmitGraceAcceptedAt"].is_string(),
        true,
        "post-submit grace acceptance must persist postSubmitGraceAcceptedAt: {db_recovery}"
    );
    assert_eq!(db_recovery["postSubmitGraceLastAppliedMutationCount"], 1);
    assert_eq!(db_recovery["serverAcceptedThroughSeq"], 2);

    // After the grace window (backdate submitted_at) the same replay is a
    // structured ATTEMPT_SUBMITTED conflict — never a generic failure.
    sqlx::query("UPDATE student_attempts SET submitted_at = NOW() - INTERVAL 360 SECOND WHERE id = ?")
        .bind(&attempt_id)
        .execute(database.pool())
        .await
        .unwrap();
    let (status, json) = post_mutation_batch_json(
        &app,
        &attempt_token,
        schedule_id,
        json!({
            "attemptId": attempt_id.clone(),
            "mutations": [{
                "mutationId": "pending-final-completion-past-grace",
                "baseRevision": revision_after_grace,
                "type": "SetEssayText",
                "taskId": "task1",
                "value": "too late"
            }]
        }),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{json}");
    assert_eq!(json["error"]["code"], "CONFLICT");
    assert_eq!(
        json["error"]["details"]["reason"], "ATTEMPT_SUBMITTED",
        "post-grace replay after final completion must be ATTEMPT_SUBMITTED: {json}"
    );
    assert_eq!(
        persisted_revision(database.pool(), &attempt_id).await,
        revision_after_grace as i64,
        "post-grace rejection must not bump the revision"
    );
    assert_eq!(
        persisted_mutation_row_count(database.pool(), &attempt_id).await,
        2,
        "post-grace rejection must not insert a mutation row"
    );
    let writing_answers = persisted_writing_answers(database.pool(), &attempt_id).await;
    assert_eq!(
        writing_answers["task1"], "final draft within grace",
        "post-grace rejection must not touch writing answers"
    );

    database.shutdown().await;
}

// ---------------------------------------------------------------------------
// BEX-042 — crash recovery: after a browser crash and re-bootstrap the
// existing attempt is returned, the live runtime section is authoritative,
// the server revision is returned, accepted mutations are never replayed
// twice, and pending client mutations continue from the accepted watermark.
// ---------------------------------------------------------------------------
#[tokio::test]
async fn bex042_crash_recovery_returns_attempt_and_continues_from_watermark() {
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
    // Real runtime start (INSERTs the runtime row; see BEX-040 comment).
    SchedulingService::new(database.pool().clone())
        .apply_runtime_command(
            &contract_actor(),
            schedule_id,
            RuntimeCommandRequest {
                action: RuntimeCommandAction::StartRuntime,
                reason: Some("contract runtime start".to_owned()),
            },
        )
        .await
        .unwrap();
    let attempt_id = bootstrap["data"]["attempt"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let attempt_token = bootstrap["data"]["attemptCredential"]["attemptToken"]
        .as_str()
        .unwrap()
        .to_owned();
    let base_revision = bootstrap["data"]["attempt"]["revision"]
        .as_i64()
        .unwrap() as i32;

    // Pre-crash: two accepted mutations under client_session_id.
    let (status, json) = post_mutation_batch_json(
        &app,
        &attempt_token,
        schedule_id,
        json!({
            "attemptId": attempt_id.clone(),
            "mutations": [
                {
                    "mutationId": "crash-m1",
                    "baseRevision": base_revision,
                    "type": "SetChoice",
                    "questionId": "q1",
                    "value": "T"
                },
                {
                    "mutationId": "crash-m2",
                    "baseRevision": base_revision,
                    "type": "SetScalar",
                    "questionId": "l-short-1",
                    "value": "diagram"
                }
            ]
        }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json}");
    assert_eq!(json["data"]["appliedMutationCount"], 2);
    assert_eq!(json["data"]["serverAcceptedThroughSeq"], 2);
    let revision_before_crash = json["data"]["revision"].as_i64().unwrap() as i32;
    let recovery_before = persisted_recovery(database.pool(), &attempt_id).await;
    assert_eq!(recovery_before["serverAcceptedThroughSeq"], 2);
    assert_eq!(recovery_before["syncState"], "saved");
    assert_eq!(recovery_before["clientSessionId"], client_session_id);

    // Crash: the client bootstraps again with the SAME client_session_id.
    let (rebootstrap, _) = bootstrap_attempt_with_client_session_id(
        &app,
        &auth,
        schedule_id,
        "alice",
        &student_key,
        &client_session_id,
    )
    .await;
    // (a) existing attempt returned (precheck/bootstrap idempotency).
    assert_eq!(rebootstrap["data"]["attempt"]["id"], attempt_id);
    assert_eq!(rebootstrap["data"]["attempt"]["answers"]["q1"], "T");
    assert_eq!(rebootstrap["data"]["attempt"]["answers"]["l-short-1"], "diagram");
    // (b) current runtime section is authoritative: the live runtime row
    // drives the phase and the current section (exam/listening), not any
    // pre-crash client snapshot.
    assert_eq!(rebootstrap["data"]["attempt"]["phase"], "exam");
    assert_eq!(rebootstrap["data"]["runtime"]["currentSectionKey"], "listening");
    assert_eq!(rebootstrap["data"]["attempt"]["currentModule"], "listening");
    let live_section: String = sqlx::query_scalar(
        "SELECT current_section_key FROM exam_session_runtimes WHERE schedule_id = ?",
    )
    .bind(schedule_id.to_string())
    .fetch_one(database.pool())
    .await
    .unwrap();
    assert_eq!(live_section, "listening");
    // (c) server revision returned matches persisted reality.
    assert_eq!(
        rebootstrap["data"]["attempt"]["revision"],
        revision_before_crash,
        "re-bootstrap returns the persisted server revision"
    );
    assert_eq!(
        persisted_revision(database.pool(), &attempt_id).await,
        revision_before_crash as i64
    );
    // The precheck step resets recovery on EVERY bootstrap (delivery
    // persist_precheck writes serverAcceptedThroughSeq: 0, syncState: idle,
    // pendingMutationCount: 0 while preserving clientSessionId). Pin that
    // contract: after re-bootstrap the client must rely on the last batch
    // RESPONSE watermark, not the recovery blob; persisted rows survive.
    let recovery_after = persisted_recovery(database.pool(), &attempt_id).await;
    assert_eq!(recovery_after["serverAcceptedThroughSeq"], 0);
    assert_eq!(recovery_after["syncState"], "idle");
    assert_eq!(recovery_after["pendingMutationCount"], 0);
    assert_eq!(recovery_after["clientSessionId"], client_session_id);
    assert_eq!(
        persisted_mutation_row_count(database.pool(), &attempt_id).await,
        2,
        "persisted accepted mutations survive the crash"
    );

    let fresh_token = rebootstrap["data"]["attemptCredential"]["attemptToken"]
        .as_str()
        .unwrap()
        .to_owned();

    // (d) accepted mutations are NOT replayed twice: the identical two
    // mutations re-sent after re-bootstrap dedupe to appliedMutationCount 0.
    // The re-sent base is the stale pre-crash bootstrap revision — the 200
    // (not 409 BASE_REVISION_MISMATCH) proves dedupe fires before the
    // base-revision gate.
    let (status, json) = post_mutation_batch_json(
        &app,
        &fresh_token,
        schedule_id,
        json!({
            "attemptId": attempt_id.clone(),
            "mutations": [
                {
                    "mutationId": "crash-m1",
                    "baseRevision": base_revision,
                    "type": "SetChoice",
                    "questionId": "q1",
                    "value": "T"
                },
                {
                    "mutationId": "crash-m2",
                    "baseRevision": base_revision,
                    "type": "SetScalar",
                    "questionId": "l-short-1",
                    "value": "diagram"
                }
            ]
        }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json}");
    assert_eq!(json["data"]["appliedMutationCount"], 0);
    assert_eq!(
        json["data"]["serverAcceptedThroughSeq"], 2,
        "dedupe returns the accepted watermark, not zero"
    );
    assert_eq!(json["data"]["revision"], revision_before_crash);
    assert_eq!(
        persisted_mutation_row_count(database.pool(), &attempt_id).await,
        2,
        "re-sent accepted mutations must not be applied twice"
    );

    // (e) pending client mutations continue from the accepted watermark:
    // seq 3 (base = current revision) applies and advances the watermark.
    let (status, json) = post_mutation_batch_json(
        &app,
        &fresh_token,
        schedule_id,
        json!({
            "attemptId": attempt_id.clone(),
            "mutations": [{
                "mutationId": "crash-m3",
                "baseRevision": revision_before_crash,
                "type": "SetChoice",
                "questionId": "q1",
                "value": "F"
            }]
        }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json}");
    assert_eq!(json["data"]["appliedMutationCount"], 1);
    assert_eq!(json["data"]["serverAcceptedThroughSeq"], 3);
    assert_eq!(json["data"]["revision"], revision_before_crash + 1);
    assert_eq!(
        persisted_mutation_row_count(database.pool(), &attempt_id).await,
        3
    );
    let answers = persisted_answers(database.pool(), &attempt_id).await;
    assert_eq!(answers["q1"], "F", "latest seq wins after recovery");
    assert_eq!(answers["l-short-1"], "diagram");

    database.shutdown().await;
}

// ---------------------------------------------------------------------------
// BEX-050 / BEX-051 / BEX-052 — heartbeat acknowledgement, network
// transition idempotency, violation identity (contract tests)
// ---------------------------------------------------------------------------

async fn post_heartbeat_json(
    app: &axum::Router,
    attempt_token: &str,
    schedule_id: Uuid,
    query: &str,
    req: &StudentHeartbeatRequest,
) -> (StatusCode, serde_json::Value) {
    let response = app
        .clone()
        .oneshot(
            with_attempt_token(Request::builder(), attempt_token)
                .method("POST")
                .uri(format!(
                    "/api/v1/student/sessions/{}/heartbeat{}",
                    schedule_id, query
                ))
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_vec(req).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let json = json_body(response).await;
    (status, json)
}

async fn post_audit_json(
    app: &axum::Router,
    attempt_token: &str,
    schedule_id: Uuid,
    req: &StudentAuditLogRequest,
) -> (StatusCode, serde_json::Value) {
    let response = app
        .clone()
        .oneshot(
            with_attempt_token(Request::builder(), attempt_token)
                .method("POST")
                .uri(format!("/api/v1/student/sessions/{}/audit", schedule_id))
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_vec(req).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let json = json_body(response).await;
    (status, json)
}

// Drains the live-update channel and returns how many schedule_alert events
// with the given schedule id and event name are queued. The test subscribes
// before the request, so every matching event must have been published by
// that request.
fn live_alert_count(
    rx: &mut tokio::sync::broadcast::Receiver<ielts_backend_domain::schedule::LiveUpdateEvent>,
    schedule_id: &str,
    event: &str,
) -> i64 {
    let mut count = 0i64;
    loop {
        match rx.try_recv() {
            Ok(update) => {
                if update.kind == "schedule_alert"
                    && update.id == schedule_id
                    && update.event == event
                {
                    count += 1;
                }
            }
            Err(tokio::sync::broadcast::error::TryRecvError::Empty)
            | Err(tokio::sync::broadcast::error::TryRecvError::Closed) => break,
            Err(tokio::sync::broadcast::error::TryRecvError::Lagged(_)) => {
                panic!("live update channel lagged; alert assertions are unreliable")
            }
        }
    }
    count
}

async fn persisted_integrity(pool: &sqlx::MySqlPool, attempt_id: &str) -> serde_json::Value {
    sqlx::query_scalar("SELECT integrity FROM student_attempts WHERE id = ?")
        .bind(attempt_id)
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn persisted_audit_count(pool: &sqlx::MySqlPool, attempt_id: &str) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM session_audit_logs WHERE target_student_id = ?")
        .bind(attempt_id)
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn persisted_audit_by_action(
    pool: &sqlx::MySqlPool,
    attempt_id: &str,
    action: &str,
) -> i64 {
    sqlx::query_scalar(
        "SELECT COUNT(*) FROM session_audit_logs WHERE target_student_id = ? AND action_type = ?",
    )
    .bind(attempt_id)
    .bind(action)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn persisted_heartbeat_event_count(pool: &sqlx::MySqlPool, attempt_id: &str) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM student_heartbeat_events WHERE attempt_id = ?")
        .bind(attempt_id)
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn persisted_violation_count(pool: &sqlx::MySqlPool, attempt_id: &str) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM student_violation_events WHERE attempt_id = ?")
        .bind(attempt_id)
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn persisted_violation_snapshot_length(pool: &sqlx::MySqlPool, attempt_id: &str) -> i64 {
    sqlx::query_scalar(
        "SELECT JSON_LENGTH(COALESCE(violations_snapshot, JSON_ARRAY())) FROM student_attempts WHERE id = ?",
    )
    .bind(attempt_id)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn persisted_violations_snapshot(
    pool: &sqlx::MySqlPool,
    attempt_id: &str,
) -> serde_json::Value {
    sqlx::query_scalar(
        "SELECT COALESCE(violations_snapshot, JSON_ARRAY()) FROM student_attempts WHERE id = ?",
    )
    .bind(attempt_id)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn persisted_presence_status(pool: &sqlx::MySqlPool, attempt_id: &str) -> String {
    sqlx::query_scalar(
        "SELECT last_heartbeat_status FROM student_attempt_presence WHERE attempt_id = ?",
    )
    .bind(attempt_id)
    .fetch_one(pool)
    .await
    .unwrap()
}

// (last_disconnect_at, last_reconnect_at) as strings; NULL stays NULL.
async fn persisted_presence_transition_times(
    pool: &sqlx::MySqlPool,
    attempt_id: &str,
) -> (Option<String>, Option<String>) {
    sqlx::query_as(
        "SELECT DATE_FORMAT(last_disconnect_at, '%Y-%m-%dT%H:%i:%sZ'), DATE_FORMAT(last_reconnect_at, '%Y-%m-%dT%H:%i:%sZ') FROM student_attempt_presence WHERE attempt_id = ?",
    )
    .bind(attempt_id)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn persisted_current_section_key(pool: &sqlx::MySqlPool, schedule_id: Uuid) -> String {
    sqlx::query_scalar(
        "SELECT current_section_key FROM exam_session_runtimes WHERE schedule_id = ?",
    )
    .bind(schedule_id.to_string())
    .fetch_one(pool)
    .await
    .unwrap()
}

#[tokio::test]
async fn bex050_ack_heartbeat_returns_no_attempt_and_preserves_revision_and_answers() {
    let database = mysql::TestDatabase::new(DELIVERY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();
    let (auth, student_key) = create_student_auth(database.pool(), schedule_id, "alice").await;
    let state = AppState::with_pool(AppConfig::default(), database.pool().clone());
    let mut live_rx = state.live_updates.subscribe_all();
    let app = build_router(state);
    let (bootstrap, client_session_id) =
        bootstrap_attempt(&app, &auth, schedule_id, "alice", &student_key).await;
    let attempt_id = bootstrap["data"]["attempt"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let attempt_token = bootstrap["data"]["attemptCredential"]["attemptToken"]
        .as_str()
        .unwrap()
        .to_owned();

    let revision_before = persisted_revision(database.pool(), &attempt_id).await;
    let answers_before = persisted_answers(database.pool(), &attempt_id).await;
    let audit_before = persisted_audit_count(database.pool(), &attempt_id).await;
    let events_before = persisted_heartbeat_event_count(database.pool(), &attempt_id).await;

    // No responseMode: acknowledgement-only heartbeat.
    let (status, json) = post_heartbeat_json(
        &app,
        &attempt_token,
        schedule_id,
        "",
        &StudentHeartbeatRequest {
            attempt_id: Some(attempt_id.clone()),
            student_key: student_key.clone(),
            client_session_id: client_session_id.clone(),
            event_type: HeartbeatEventType::Heartbeat,
            payload: Some(json!({"seq": 1})),
            client_timestamp: Utc.with_ymd_and_hms(2026, 1, 10, 9, 10, 0).unwrap(),
        },
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json}");
    // Acknowledgement-only: neither attempt nor runtime hydration.
    assert!(json["data"].get("attempt").is_none(), "{json}");
    assert!(json["data"].get("runtime").is_none(), "{json}");
    // Fresh credential: the bootstrap token is not near expiry.
    assert!(json["data"]["refreshedAttemptCredential"].is_null(), "{json}");

    // Revision, answers, audit trail and event log are untouched.
    assert_eq!(
        persisted_revision(database.pool(), &attempt_id).await,
        revision_before
    );
    assert_eq!(persisted_answers(database.pool(), &attempt_id).await, answers_before);
    assert_eq!(persisted_audit_count(database.pool(), &attempt_id).await, audit_before);
    assert_eq!(
        persisted_heartbeat_event_count(database.pool(), &attempt_id).await,
        events_before
    );
    assert_eq!(live_alert_count(&mut live_rx, &schedule.id, "student_network"), 0);

    // Integrity still records the liveness signal.
    let integrity = persisted_integrity(database.pool(), &attempt_id).await;
    assert_eq!(integrity["lastHeartbeatStatus"], "ok");
    assert_ne!(integrity["lastHeartbeatAt"], serde_json::Value::Null);
    assert_eq!(persisted_presence_status(database.pool(), &attempt_id).await, "ok");

    database.shutdown().await;
}

#[tokio::test]
async fn bex050_full_heartbeat_returns_attempt_and_runtime_hydration() {
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
    let attempt_id = bootstrap["data"]["attempt"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let attempt_token = bootstrap["data"]["attemptCredential"]["attemptToken"]
        .as_str()
        .unwrap()
        .to_owned();
    let revision_before = persisted_revision(database.pool(), &attempt_id).await;
    let answers_before = persisted_answers(database.pool(), &attempt_id).await;

    // A real runtime row (SchedulingService, as in bex041) is required for
    // the runtime hydration branch.
    SchedulingService::new(database.pool().clone())
        .apply_runtime_command(
            &contract_actor(),
            schedule_id,
            RuntimeCommandRequest {
                action: RuntimeCommandAction::StartRuntime,
                reason: Some("bex050 runtime start".to_owned()),
            },
        )
        .await
        .unwrap();

    let (status, json) = post_heartbeat_json(
        &app,
        &attempt_token,
        schedule_id,
        "?responseMode=full",
        &StudentHeartbeatRequest {
            attempt_id: Some(attempt_id.clone()),
            student_key: student_key.clone(),
            client_session_id,
            event_type: HeartbeatEventType::Heartbeat,
            payload: None,
            client_timestamp: Utc.with_ymd_and_hms(2026, 1, 10, 9, 10, 5).unwrap(),
        },
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json}");
    let data = &json["data"];
    assert!(data["attempt"].is_object(), "full mode hydrates the attempt: {json}");
    assert_eq!(data["attempt"]["revision"].as_i64(), Some(revision_before));
    assert!(data["runtime"].is_object(), "full mode hydrates the runtime: {json}");
    let db_section = persisted_current_section_key(database.pool(), schedule_id).await;
    assert_eq!(
        data["runtime"]["currentSectionKey"].as_str(),
        Some(db_section.as_str()),
        "runtime hydration must reflect the persisted runtime: {json}"
    );
    assert_eq!(data["runtime"]["status"], "live");

    // Full mode still never touches revision or answers.
    assert_eq!(
        persisted_revision(database.pool(), &attempt_id).await,
        revision_before
    );
    assert_eq!(persisted_answers(database.pool(), &attempt_id).await, answers_before);

    database.shutdown().await;
}

#[tokio::test]
async fn bex050_heartbeat_returns_refreshed_credential_when_near_expiry() {
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
    let attempt_id = bootstrap["data"]["attempt"]["id"]
        .as_str()
        .unwrap()
        .to_owned();

    // The refresh decision keys on the SIGNED claims exp (<= 5 minutes to
    // expiry), not on the DB row. Craft a token over the bootstrap attempt
    // session that expires in 3 minutes; the session row keeps its original
    // unexpired expires_at so authorization still passes.
    let (token_id, user_id): (String, String) = sqlx::query_as(
        "SELECT token_id, user_id FROM attempt_sessions WHERE attempt_id = ? AND client_session_id = ?",
    )
    .bind(&attempt_id)
    .bind(&client_session_id)
    .fetch_one(database.pool())
    .await
    .unwrap();
    let near_expiry_token = sign_attempt_token(
        &AppConfig::default(),
        &AttemptTokenClaims {
            token_id,
            user_id,
            schedule_id: schedule_id.to_string(),
            attempt_id: attempt_id.clone(),
            client_session_id: client_session_id.clone(),
            exp: Utc::now() + Duration::minutes(3),
        },
    );

    let (status, json) = post_heartbeat_json(
        &app,
        &near_expiry_token,
        schedule_id,
        "",
        &StudentHeartbeatRequest {
            attempt_id: Some(attempt_id.clone()),
            student_key: student_key.clone(),
            client_session_id: client_session_id.clone(),
            event_type: HeartbeatEventType::Heartbeat,
            payload: None,
            client_timestamp: Utc.with_ymd_and_hms(2026, 1, 10, 9, 11, 0).unwrap(),
        },
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json}");
    let refreshed = json["data"]["refreshedAttemptCredential"].clone();
    assert!(refreshed.is_object(), "near-expiry token must be refreshed: {json}");
    let refreshed_token = refreshed["attemptToken"].as_str().unwrap().to_owned();
    assert_ne!(refreshed_token, near_expiry_token, "refresh must rotate the token");

    // The refreshed credential authorizes a follow-up request...
    let (status, json) = post_heartbeat_json(
        &app,
        &refreshed_token,
        schedule_id,
        "",
        &StudentHeartbeatRequest {
            attempt_id: Some(attempt_id.clone()),
            student_key: student_key.clone(),
            client_session_id: client_session_id.clone(),
            event_type: HeartbeatEventType::Heartbeat,
            payload: None,
            client_timestamp: Utc.with_ymd_and_hms(2026, 1, 10, 9, 11, 5).unwrap(),
        },
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json}");
    // ...and is not immediately refreshed again (fresh exp).
    assert!(json["data"]["refreshedAttemptCredential"].is_null(), "{json}");

    database.shutdown().await;
}

#[tokio::test]
async fn bex051_network_transitions_update_integrity_and_are_idempotent_under_retry() {
    let database = mysql::TestDatabase::new(DELIVERY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();
    let (auth, student_key) = create_student_auth(database.pool(), schedule_id, "alice").await;
    let state = AppState::with_pool(AppConfig::default(), database.pool().clone());
    let mut live_rx = state.live_updates.subscribe_all();
    let app = build_router(state);
    let (bootstrap, client_session_id) =
        bootstrap_attempt(&app, &auth, schedule_id, "alice", &student_key).await;
    let attempt_id = bootstrap["data"]["attempt"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let attempt_token = bootstrap["data"]["attemptCredential"]["attemptToken"]
        .as_str()
        .unwrap()
        .to_owned();
    let revision_before = persisted_revision(database.pool(), &attempt_id).await;
    let answers_before = persisted_answers(database.pool(), &attempt_id).await;
    let audit_before = persisted_audit_count(database.pool(), &attempt_id).await;

    let disconnect_ts = Utc.with_ymd_and_hms(2026, 1, 10, 9, 12, 0).unwrap();
    let reconnect_ts = Utc.with_ymd_and_hms(2026, 1, 10, 9, 12, 30).unwrap();
    let lost_ts = Utc.with_ymd_and_hms(2026, 1, 10, 9, 13, 0).unwrap();
    let payload = json!({"source": "browser"});

    // ---- Disconnect: integrity lost + audit + event + alert, no revision ----
    let disconnect_request = StudentHeartbeatRequest {
        attempt_id: Some(attempt_id.clone()),
        student_key: student_key.clone(),
        client_session_id: client_session_id.clone(),
        event_type: HeartbeatEventType::Disconnect,
        payload: Some(payload.clone()),
        client_timestamp: disconnect_ts,
    };
    let (status, json) =
        post_heartbeat_json(&app, &attempt_token, schedule_id, "", &disconnect_request).await;
    assert_eq!(status, StatusCode::OK, "{json}");
    assert_eq!(
        json["data"]["attempt"]["integrity"]["lastHeartbeatStatus"],
        "lost"
    );
    assert_ne!(
        json["data"]["attempt"]["integrity"]["lastDisconnectAt"],
        serde_json::Value::Null
    );
    assert!(json["data"].get("runtime").is_none(), "{json}");
    assert_eq!(
        persisted_revision(database.pool(), &attempt_id).await,
        revision_before
    );
    assert_eq!(persisted_answers(database.pool(), &attempt_id).await, answers_before);
    assert_eq!(
        persisted_audit_by_action(database.pool(), &attempt_id, "NETWORK_DISCONNECTED").await,
        1
    );
    assert_eq!(persisted_heartbeat_event_count(database.pool(), &attempt_id).await, 1);
    assert_eq!(persisted_presence_status(database.pool(), &attempt_id).await, "lost");
    let (last_disconnect_at, last_reconnect_at) =
        persisted_presence_transition_times(database.pool(), &attempt_id).await;
    assert!(last_disconnect_at.is_some());
    assert!(last_reconnect_at.is_none());
    assert_eq!(
        live_alert_count(&mut live_rx, &schedule.id, "network_disconnected"),
        1
    );

    // ---- Disconnect retry (identical clientTimestamp): one logical event ----
    let (status, json) =
        post_heartbeat_json(&app, &attempt_token, schedule_id, "", &disconnect_request).await;
    assert_eq!(status, StatusCode::OK, "{json}");
    assert_eq!(
        persisted_audit_by_action(database.pool(), &attempt_id, "NETWORK_DISCONNECTED").await,
        1,
        "retry must not create a second audit row"
    );
    assert_eq!(
        persisted_heartbeat_event_count(database.pool(), &attempt_id).await,
        1,
        "retry must not create a second heartbeat event row"
    );
    assert_eq!(
        live_alert_count(&mut live_rx, &schedule.id, "network_disconnected"),
        0,
        "retry must not re-alert proctors"
    );
    assert_eq!(
        persisted_revision(database.pool(), &attempt_id).await,
        revision_before
    );
    assert_eq!(persisted_answers(database.pool(), &attempt_id).await, answers_before);

    // ---- Reconnect: status ok, lastReconnectAt set, disconnect preserved ----
    let reconnect_request = StudentHeartbeatRequest {
        attempt_id: Some(attempt_id.clone()),
        student_key: student_key.clone(),
        client_session_id: client_session_id.clone(),
        event_type: HeartbeatEventType::Reconnect,
        payload: Some(payload.clone()),
        client_timestamp: reconnect_ts,
    };
    let (status, json) =
        post_heartbeat_json(&app, &attempt_token, schedule_id, "", &reconnect_request).await;
    assert_eq!(status, StatusCode::OK, "{json}");
    assert_eq!(
        json["data"]["attempt"]["integrity"]["lastHeartbeatStatus"],
        "ok"
    );
    assert_ne!(
        json["data"]["attempt"]["integrity"]["lastReconnectAt"],
        serde_json::Value::Null
    );
    assert_eq!(
        persisted_audit_by_action(database.pool(), &attempt_id, "NETWORK_RECONNECTED").await,
        1
    );
    assert_eq!(persisted_heartbeat_event_count(database.pool(), &attempt_id).await, 2);
    assert_eq!(persisted_presence_status(database.pool(), &attempt_id).await, "ok");
    let (last_disconnect_at, last_reconnect_at) =
        persisted_presence_transition_times(database.pool(), &attempt_id).await;
    assert!(
        last_disconnect_at.is_some(),
        "reconnect must not clobber lastDisconnectAt (COALESCE first-wins)"
    );
    assert!(last_reconnect_at.is_some());
    assert_eq!(
        live_alert_count(&mut live_rx, &schedule.id, "network_reconnected"),
        1
    );

    // ---- Reconnect retry: still one logical event ----
    let (status, json) =
        post_heartbeat_json(&app, &attempt_token, schedule_id, "", &reconnect_request).await;
    assert_eq!(status, StatusCode::OK, "{json}");
    assert_eq!(
        persisted_audit_by_action(database.pool(), &attempt_id, "NETWORK_RECONNECTED").await,
        1
    );
    assert_eq!(persisted_heartbeat_event_count(database.pool(), &attempt_id).await, 2);
    assert_eq!(
        live_alert_count(&mut live_rx, &schedule.id, "network_reconnected"),
        0
    );
    assert_eq!(
        persisted_revision(database.pool(), &attempt_id).await,
        revision_before
    );

    // ---- Lost: status lost + lastDisconnectAt, HEARTBEAT_LOST audit ----
    let lost_request = StudentHeartbeatRequest {
        attempt_id: Some(attempt_id.clone()),
        student_key: student_key.clone(),
        client_session_id: client_session_id.clone(),
        event_type: HeartbeatEventType::Lost,
        payload: Some(payload.clone()),
        client_timestamp: lost_ts,
    };
    let (status, json) =
        post_heartbeat_json(&app, &attempt_token, schedule_id, "", &lost_request).await;
    assert_eq!(status, StatusCode::OK, "{json}");
    assert_eq!(
        json["data"]["attempt"]["integrity"]["lastHeartbeatStatus"],
        "lost"
    );
    assert_eq!(
        persisted_audit_by_action(database.pool(), &attempt_id, "HEARTBEAT_LOST").await,
        1
    );
    assert_eq!(persisted_heartbeat_event_count(database.pool(), &attempt_id).await, 3);
    assert_eq!(persisted_presence_status(database.pool(), &attempt_id).await, "lost");
    let (last_disconnect_at, _) =
        persisted_presence_transition_times(database.pool(), &attempt_id).await;
    assert!(last_disconnect_at.is_some());
    assert_eq!(live_alert_count(&mut live_rx, &schedule.id, "heartbeat_lost"), 1);

    // ---- Lost retry: still one logical event ----
    let (status, json) =
        post_heartbeat_json(&app, &attempt_token, schedule_id, "", &lost_request).await;
    assert_eq!(status, StatusCode::OK, "{json}");
    assert_eq!(
        persisted_audit_by_action(database.pool(), &attempt_id, "HEARTBEAT_LOST").await,
        1
    );
    assert_eq!(persisted_heartbeat_event_count(database.pool(), &attempt_id).await, 3);
    assert_eq!(live_alert_count(&mut live_rx, &schedule.id, "heartbeat_lost"), 0);

    // Totals: exactly one audit row and one event row per transition, and the
    // attempt revision/answers were never touched.
    assert_eq!(
        persisted_audit_count(database.pool(), &attempt_id).await,
        audit_before + 3
    );
    assert_eq!(persisted_heartbeat_event_count(database.pool(), &attempt_id).await, 3);
    assert_eq!(
        persisted_revision(database.pool(), &attempt_id).await,
        revision_before
    );
    assert_eq!(persisted_answers(database.pool(), &attempt_id).await, answers_before);

    // The single NETWORK_DISCONNECTED audit row carries the transition metadata.
    let audit_payload: serde_json::Value = sqlx::query_scalar(
        "SELECT payload FROM session_audit_logs WHERE target_student_id = ? AND action_type = 'NETWORK_DISCONNECTED' LIMIT 1",
    )
    .bind(&attempt_id)
    .fetch_one(database.pool())
    .await
    .unwrap();
    assert_eq!(audit_payload["eventType"], "disconnect");
    assert_eq!(audit_payload["payload"]["source"], "browser");

    database.shutdown().await;
}

#[tokio::test]
async fn bex052_violation_delivery_is_idempotent_with_single_alert() {
    let database = mysql::TestDatabase::new(DELIVERY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();
    let (auth, student_key) = create_student_auth(database.pool(), schedule_id, "alice").await;
    let state = AppState::with_pool(AppConfig::default(), database.pool().clone());
    let mut live_rx = state.live_updates.subscribe_all();
    let app = build_router(state);
    let (bootstrap, _client_session_id) =
        bootstrap_attempt(&app, &auth, schedule_id, "alice", &student_key).await;
    let attempt_id = bootstrap["data"]["attempt"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let attempt_token = bootstrap["data"]["attemptCredential"]["attemptToken"]
        .as_str()
        .unwrap()
        .to_owned();
    let revision_before = persisted_revision(database.pool(), &attempt_id).await;
    let audit_before = persisted_audit_count(database.pool(), &attempt_id).await;
    let ts = Utc.with_ymd_and_hms(2026, 1, 10, 9, 14, 0).unwrap();

    let violation_request = StudentAuditLogRequest {
        action_type: ielts_backend_domain::schedule::AuditActionType::ViolationDetected,
        payload: Some(json!({
            "event": "VIOLATION_DETECTED",
            "violationId": "vio-bex052-1",
            "violationType": "TAB_SWITCH",
            "severity": "high",
            "message": "Tab switching detected."
        })),
        client_timestamp: Some(ts),
    };

    // First delivery: one violation record, one snapshot entry, revision +1,
    // one append-only audit row, one proctor alert.
    let (status, json) = post_audit_json(&app, &attempt_token, schedule_id, &violation_request).await;
    assert_eq!(status, StatusCode::OK, "{json}");
    assert_eq!(persisted_violation_count(database.pool(), &attempt_id).await, 1);
    assert_eq!(persisted_violation_snapshot_length(database.pool(), &attempt_id).await, 1);
    let snapshot = persisted_violations_snapshot(database.pool(), &attempt_id).await;
    assert_eq!(snapshot[0]["id"], "vio-bex052-1");
    assert_eq!(
        persisted_revision(database.pool(), &attempt_id).await,
        revision_before + 1
    );
    assert_eq!(
        persisted_audit_count(database.pool(), &attempt_id).await,
        audit_before + 1
    );
    assert_eq!(live_alert_count(&mut live_rx, &schedule.id, "alert_changed"), 1);

    // Retry with the same violationId: no second violation record, no second
    // snapshot entry, no revision bump, no second proctor alert. The audit
    // log remains append-only (the retry is itself an auditable event).
    let (status, json) = post_audit_json(&app, &attempt_token, schedule_id, &violation_request).await;
    assert_eq!(status, StatusCode::OK, "{json}");
    assert_eq!(persisted_violation_count(database.pool(), &attempt_id).await, 1);
    assert_eq!(persisted_violation_snapshot_length(database.pool(), &attempt_id).await, 1);
    assert_eq!(
        persisted_revision(database.pool(), &attempt_id).await,
        revision_before + 1,
        "duplicate delivery must not bump the revision"
    );
    assert_eq!(
        persisted_audit_count(database.pool(), &attempt_id).await,
        audit_before + 2,
        "audit trail is append-only per delivery"
    );
    assert_eq!(
        live_alert_count(&mut live_rx, &schedule.id, "alert_changed"),
        0,
        "duplicate delivery must not re-alert proctors"
    );

    // A distinct violationId creates a second record, a second snapshot
    // entry, bumps the revision again and alerts once more.
    let (status, json) = post_audit_json(
        &app,
        &attempt_token,
        schedule_id,
        &StudentAuditLogRequest {
            action_type: ielts_backend_domain::schedule::AuditActionType::ViolationDetected,
            payload: Some(json!({
                "event": "VIOLATION_DETECTED",
                "violationId": "vio-bex052-2",
                "violationType": "FACE_LOOKAWAY",
                "severity": "medium",
                "message": "Face lookaway."
            })),
            client_timestamp: Some(ts),
        },
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json}");
    assert_eq!(persisted_violation_count(database.pool(), &attempt_id).await, 2);
    assert_eq!(persisted_violation_snapshot_length(database.pool(), &attempt_id).await, 2);
    assert_eq!(
        persisted_revision(database.pool(), &attempt_id).await,
        revision_before + 2
    );
    assert_eq!(live_alert_count(&mut live_rx, &schedule.id, "alert_changed"), 1);

    database.shutdown().await;
}

#[tokio::test]
async fn bex052_invalid_severity_is_ignored_and_blank_violation_id_is_rejected() {
    let database = mysql::TestDatabase::new(DELIVERY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();
    let (auth, student_key) = create_student_auth(database.pool(), schedule_id, "alice").await;
    let state = AppState::with_pool(AppConfig::default(), database.pool().clone());
    let mut live_rx = state.live_updates.subscribe_all();
    let app = build_router(state);
    let (bootstrap, _client_session_id) =
        bootstrap_attempt(&app, &auth, schedule_id, "alice", &student_key).await;
    let attempt_id = bootstrap["data"]["attempt"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let attempt_token = bootstrap["data"]["attemptCredential"]["attemptToken"]
        .as_str()
        .unwrap()
        .to_owned();
    let revision_before = persisted_revision(database.pool(), &attempt_id).await;
    let audit_before = persisted_audit_count(database.pool(), &attempt_id).await;
    let ts = Utc.with_ymd_and_hms(2026, 1, 10, 9, 14, 30).unwrap();

    // Invalid severity: 200, audit row appended, but no violation record, no
    // snapshot change, no revision bump, no alert.
    let (status, json) = post_audit_json(
        &app,
        &attempt_token,
        schedule_id,
        &StudentAuditLogRequest {
            action_type: ielts_backend_domain::schedule::AuditActionType::ViolationDetected,
            payload: Some(json!({
                "violationId": "vio-invalid-severity",
                "violationType": "TAB_SWITCH",
                "severity": "extreme",
                "message": "Not in the allowlist."
            })),
            client_timestamp: Some(ts),
        },
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json}");
    assert_eq!(persisted_violation_count(database.pool(), &attempt_id).await, 0);
    assert_eq!(persisted_violation_snapshot_length(database.pool(), &attempt_id).await, 0);
    assert_eq!(
        persisted_revision(database.pool(), &attempt_id).await,
        revision_before
    );
    assert_eq!(
        persisted_audit_count(database.pool(), &attempt_id).await,
        audit_before + 1,
        "audit log records the delivery even when the violation is ignored"
    );
    assert_eq!(live_alert_count(&mut live_rx, &schedule.id, "alert_changed"), 0);

    // Blank/missing violationId: 422, and the entire audit write rolls back.
    let (status, json) = post_audit_json(
        &app,
        &attempt_token,
        schedule_id,
        &StudentAuditLogRequest {
            action_type: ielts_backend_domain::schedule::AuditActionType::ViolationDetected,
            payload: Some(json!({
                "violationType": "TAB_SWITCH",
                "severity": "high"
            })),
            client_timestamp: Some(ts),
        },
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{json}");
    assert_eq!(json["error"]["code"], "VALIDATION_ERROR");
    assert_eq!(
        persisted_audit_count(database.pool(), &attempt_id).await,
        audit_before + 1,
        "422 must roll back the audit append"
    );
    assert_eq!(persisted_violation_count(database.pool(), &attempt_id).await, 0);
    assert_eq!(
        persisted_revision(database.pool(), &attempt_id).await,
        revision_before
    );

    database.shutdown().await;
}

#[tokio::test]
async fn bex052_student_cannot_forge_another_attempt_violation() {
    let database = mysql::TestDatabase::new(DELIVERY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();
    let other_schedule = seed_schedule_with_slug(
        database.pool(),
        "cambridge-19-academic-delivery-forgery",
    )
    .await;
    let other_schedule_id = Uuid::parse_str(&other_schedule.id).unwrap();
    let (auth, student_key) = create_student_auth(database.pool(), schedule_id, "alice").await;
    let (bob_auth, bob_student_key) =
        create_student_auth_with_wcode(database.pool(), schedule_id, "bob", "W000002").await;
    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));
    let (bootstrap, _) = bootstrap_attempt(&app, &auth, schedule_id, "alice", &student_key).await;
    let (bob_bootstrap, _) =
        bootstrap_attempt(&app, &bob_auth, schedule_id, "bob", &bob_student_key).await;
    let alice_attempt_id = bootstrap["data"]["attempt"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let bob_attempt_id = bob_bootstrap["data"]["attempt"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let alice_token = bootstrap["data"]["attemptCredential"]["attemptToken"]
        .as_str()
        .unwrap()
        .to_owned();
    let ts = Utc.with_ymd_and_hms(2026, 1, 10, 9, 15, 0).unwrap();

    // Alice's credential cannot post to another schedule's audit path: the
    // claims schedule_id must match the path.
    let (status, json) = post_audit_json(
        &app,
        &alice_token,
        other_schedule_id,
        &StudentAuditLogRequest {
            action_type: ielts_backend_domain::schedule::AuditActionType::ViolationDetected,
            payload: Some(json!({
                "violationId": "vio-cross-schedule",
                "violationType": "TAB_SWITCH",
                "severity": "high"
            })),
            client_timestamp: Some(ts),
        },
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{json}");
    assert_eq!(json["error"]["code"], "FORBIDDEN");

    // A body that claims Bob's attempt id is ignored: the violation is
    // attributed to the caller's own attempt from the token claims.
    let (status, json) = post_audit_json(
        &app,
        &alice_token,
        schedule_id,
        &StudentAuditLogRequest {
            action_type: ielts_backend_domain::schedule::AuditActionType::ViolationDetected,
            payload: Some(json!({
                "violationId": "vio-forged",
                "violationType": "TAB_SWITCH",
                "severity": "high",
                "attemptId": bob_attempt_id.clone()
            })),
            client_timestamp: Some(ts),
        },
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json}");
    let attributed: String = sqlx::query_scalar(
        "SELECT attempt_id FROM student_violation_events WHERE violation_id = 'vio-forged'",
    )
    .fetch_one(database.pool())
    .await
    .unwrap();
    assert_eq!(attributed, alice_attempt_id, "violation must land on the caller's attempt");
    assert_eq!(persisted_violation_count(database.pool(), &bob_attempt_id).await, 0);
    assert_eq!(persisted_violation_count(database.pool(), &alice_attempt_id).await, 1);

    database.shutdown().await;
}

// ---------------------------------------------------------------------------
// BEX-060/061/062/063 — section/final submission gates (contract tests)
// ---------------------------------------------------------------------------

// Real StartRuntime (INSERTs the exam_session_runtimes row; a bare UPDATE on
// that table is a silent no-op until the row exists) followed by a fresh
// bootstrap. Bootstrapping after the start creates/refreshes the attempt with
// phase `exam`, which the submit phase gate requires.
async fn start_runtime_and_rebootstrap(
    app: &axum::Router,
    pool: &sqlx::MySqlPool,
    auth: &mysql::TestAuthContext,
    schedule_id: Uuid,
    student_key: &str,
) -> (serde_json::Value, String) {
    SchedulingService::new(pool.clone())
        .apply_runtime_command(
            &contract_actor(),
            schedule_id,
            RuntimeCommandRequest {
                action: RuntimeCommandAction::StartRuntime,
                reason: Some("contract runtime start (BEX-060)".to_owned()),
            },
        )
        .await
        .unwrap();
    bootstrap_attempt(app, auth, schedule_id, "alice", student_key).await
}

async fn post_submit_json(
    app: &axum::Router,
    attempt_token: &str,
    schedule_id: Uuid,
    idempotency_key: Option<&str>,
    body: serde_json::Value,
) -> (StatusCode, serde_json::Value) {
    let mut builder = Request::builder();
    if let Some(key) = idempotency_key {
        builder = builder.header("idempotency-key", key);
    }
    let response = app
        .clone()
        .oneshot(
            with_attempt_token(builder, attempt_token)
                .method("POST")
                .uri(format!("/api/v1/student/sessions/{schedule_id}/submit"))
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_vec(&body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let json = json_body(response).await;
    (status, json)
}

async fn persisted_final_submission(
    pool: &sqlx::MySqlPool,
    attempt_id: &str,
) -> serde_json::Value {
    sqlx::query_scalar("SELECT final_submission FROM student_attempts WHERE id = ?")
        .bind(attempt_id)
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn persisted_submitted_at(
    pool: &sqlx::MySqlPool,
    attempt_id: &str,
) -> Option<chrono::DateTime<Utc>> {
    sqlx::query_scalar("SELECT submitted_at FROM student_attempts WHERE id = ?")
        .bind(attempt_id)
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn persisted_idempotency_count(
    pool: &sqlx::MySqlPool,
    actor_id: &str,
    route_key: &str,
    idempotency_key: &str,
) -> i64 {
    sqlx::query_scalar(
        "SELECT COUNT(*) FROM idempotency_keys WHERE actor_id = ? AND route_key = ? AND idempotency_key = ?",
    )
    .bind(actor_id)
    .bind(route_key)
    .bind(idempotency_key)
    .fetch_one(pool)
    .await
    .unwrap()
}

// The canonical final-snapshot hash exactly as the server computes it:
// sha256 over the 3-key canonical JSON. serde_json (default features) sorts
// object keys alphabetically, so key insertion order never changes the hash.
fn final_snapshot_sha256(
    answers: &serde_json::Value,
    writing_answers: &serde_json::Value,
    flags: &serde_json::Value,
) -> String {
    let canonical = serde_json::to_string(&json!({
        "answers": answers,
        "writingAnswers": writing_answers,
        "flags": flags
    }))
    .unwrap();
    ielts_backend_infrastructure::auth::sha256_hex(&canonical)
}

// BEX-061 — a matching finalClientSnapshotHash is accepted; the snapshot is
// hashed as raw bytes (unicode and HTML essay text are not normalized).
#[tokio::test]
async fn bex061_matching_final_snapshot_hash_accepted() {
    let database = mysql::TestDatabase::new(DELIVERY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();
    let (auth, student_key) = create_student_auth(database.pool(), schedule_id, "alice").await;
    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));
    let (bootstrap, _) = start_runtime_and_rebootstrap(
        &app,
        database.pool(),
        &auth,
        schedule_id,
        &student_key,
    )
    .await;
    let attempt_id = bootstrap["data"]["attempt"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let attempt_token = bootstrap["data"]["attemptCredential"]["attemptToken"]
        .as_str()
        .unwrap()
        .to_owned();
    let base_revision = bootstrap["data"]["attempt"]["revision"]
        .as_i64()
        .unwrap() as i32;

    let (status, json) = post_single_mutation_batch(
        &app,
        &attempt_token,
        schedule_id,
        &attempt_id,
        "bex061-scalar-unicode",
        base_revision,
        json!({"type": "SetScalar", "questionId": "l-short-1", "value": "café ☕"}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json}");
    let revision = json["data"]["revision"].as_i64().unwrap() as i32;

    // The raw-HTML essay rides in the final patch (a pre-submit SetEssayText
    // would be section-gated while listening is active). The hash therefore
    // covers the patch-merged final state, exactly as the server computes it:
    // persisted answers + patch writing answers + persisted flags.
    let html_essay = "<p>Hello &amp; welcome</p>";
    let answers = persisted_answers(database.pool(), &attempt_id).await;
    let flags = persisted_flags(database.pool(), &attempt_id).await;
    let hash = final_snapshot_sha256(
        &answers,
        &json!({ "task1": html_essay }),
        &flags,
    );

    let (status, json) = post_submit_json(
        &app,
        &attempt_token,
        schedule_id,
        Some("submit-hash-match"),
        json!({
            "attemptId": attempt_id.clone(),
            "lastSeenRevision": revision,
            "submissionId": "submit-hash-match",
            "clientFinalSeq": 2,
            "serverAcceptedThroughSeq": 2,
            "finalAnswerPatch": {
                "answers": {},
                "writingAnswers": { "task1": html_essay },
                "flags": {}
            },
            "finalClientSnapshotHash": hash
        }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "matching hash must be accepted: {json}");
    assert_eq!(json["data"]["attempt"]["phase"], "post-exam");

    let final_submission = persisted_final_submission(database.pool(), &attempt_id).await;
    assert_eq!(
        final_submission["answers"]["l-short-1"], "café ☕",
        "unicode answer must be preserved byte-exact in the final snapshot"
    );
    assert_eq!(
        final_submission["writingAnswers"]["task1"], "<p>Hello &amp; welcome</p>",
        "raw HTML essay must be hashed and stored without normalization"
    );
    assert_eq!(
        persisted_audit_by_action(database.pool(), &attempt_id, "STUDENT_SUBMIT").await,
        1
    );

    database.shutdown().await;
}

// BEX-061 — a mismatching finalClientSnapshotHash is a structured
// FINAL_PAYLOAD_HASH_MISMATCH conflict and nothing is persisted.
#[tokio::test]
async fn bex061_mismatching_final_snapshot_hash_returns_structured_conflict() {
    let database = mysql::TestDatabase::new(DELIVERY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();
    let (auth, student_key) = create_student_auth(database.pool(), schedule_id, "alice").await;
    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));
    let (bootstrap, _) = start_runtime_and_rebootstrap(
        &app,
        database.pool(),
        &auth,
        schedule_id,
        &student_key,
    )
    .await;
    let attempt_id = bootstrap["data"]["attempt"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let attempt_token = bootstrap["data"]["attemptCredential"]["attemptToken"]
        .as_str()
        .unwrap()
        .to_owned();
    let base_revision = bootstrap["data"]["attempt"]["revision"]
        .as_i64()
        .unwrap() as i32;

    let (status, json) = post_single_mutation_batch(
        &app,
        &attempt_token,
        schedule_id,
        &attempt_id,
        "bex061-mismatch-setup",
        base_revision,
        json!({"type": "SetScalar", "questionId": "l-short-1", "value": "café ☕"}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json}");
    let revision = json["data"]["revision"].as_i64().unwrap() as i32;

    let answers = persisted_answers(database.pool(), &attempt_id).await;
    let writing_answers = persisted_writing_answers(database.pool(), &attempt_id).await;
    let flags = persisted_flags(database.pool(), &attempt_id).await;
    let correct_hash = final_snapshot_sha256(&answers, &writing_answers, &flags);
    // Flip one character: the hash must not match.
    let wrong_hash = format!("{}0", &correct_hash[..63]);

    let (status, json) = post_submit_json(
        &app,
        &attempt_token,
        schedule_id,
        Some("submit-hash-mismatch"),
        json!({
            "attemptId": attempt_id.clone(),
            "lastSeenRevision": revision,
            "submissionId": "submit-hash-mismatch",
            "clientFinalSeq": 1,
            "serverAcceptedThroughSeq": 1,
            "finalClientSnapshotHash": wrong_hash
        }),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{json}");
    assert_eq!(json["error"]["code"], "CONFLICT");
    assert_eq!(
        json["error"]["details"]["reason"], "FINAL_PAYLOAD_HASH_MISMATCH",
        "hash mismatch must be a structured conflict: {json}"
    );
    assert_eq!(
        persisted_revision(database.pool(), &attempt_id).await,
        revision as i64,
        "hash-mismatch rejection must not bump the revision"
    );
    assert!(persisted_submitted_at(database.pool(), &attempt_id).await.is_none());
    let final_submission: Option<serde_json::Value> = sqlx::query_scalar(
        "SELECT final_submission FROM student_attempts WHERE id = ?",
    )
    .bind(&attempt_id)
    .fetch_one(database.pool())
    .await
    .unwrap();
    assert!(final_submission.is_none(), "no final_submission write on hash mismatch");
    assert_eq!(
        persisted_audit_by_action(database.pool(), &attempt_id, "STUDENT_SUBMIT").await,
        0
    );

    database.shutdown().await;
}

// BEX-061 — the same logical final JSON hashes identically regardless of key
// insertion order, and unicode/HTML content hashes as raw bytes. Two attempts
// submit patches built with different key orders and the SAME hash: both are
// accepted.
#[tokio::test]
async fn bex061_canonical_hash_key_order_unicode_and_html_stable() {
    let database = mysql::TestDatabase::new(DELIVERY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();
    let (auth_alice, student_key_alice) =
        create_student_auth(database.pool(), schedule_id, "alice").await;
    // schedule_registrations enforces UNIQUE(schedule_id, wcode): bob must
    // register with a distinct access code.
    let (auth_bob, student_key_bob) =
        create_student_auth_with_wcode(database.pool(), schedule_id, "bob", "W654321").await;
    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));
    // Start the runtime once (a second StartRuntime command would collide on
    // the UNIQUE runtime row), then bootstrap both attempts with phase `exam`.
    SchedulingService::new(database.pool().clone())
        .apply_runtime_command(
            &contract_actor(),
            schedule_id,
            RuntimeCommandRequest {
                action: RuntimeCommandAction::StartRuntime,
                reason: Some("contract runtime start (BEX-061)".to_owned()),
            },
        )
        .await
        .unwrap();
    let (bootstrap_alice, _) = bootstrap_attempt(
        &app,
        &auth_alice,
        schedule_id,
        "alice",
        &student_key_alice,
    )
    .await;
    let (bootstrap_bob, _) =
        bootstrap_attempt(&app, &auth_bob, schedule_id, "bob", &student_key_bob).await;
    let alice_attempt_id = bootstrap_alice["data"]["attempt"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let alice_token = bootstrap_alice["data"]["attemptCredential"]["attemptToken"]
        .as_str()
        .unwrap()
        .to_owned();
    let bob_attempt_id = bootstrap_bob["data"]["attempt"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let bob_token = bootstrap_bob["data"]["attemptCredential"]["attemptToken"]
        .as_str()
        .unwrap()
        .to_owned();
    let alice_revision = bootstrap_alice["data"]["attempt"]["revision"]
        .as_i64()
        .unwrap() as i32;
    let bob_revision = bootstrap_bob["data"]["attempt"]["revision"]
        .as_i64()
        .unwrap() as i32;

    // The patches carry the full final state (fresh attempts start empty), so
    // the hash is computed over the patch content alone — the same logical
    // JSON in both key orders.
    let answers_value = json!({"l-short-1": "café ☕"});
    let writing_value = json!({"task1": "<p>Hello &amp; welcome</p>"});
    let flags_value = json!({"l-short-1": true});

    // Canonical strings built with DIFFERENT top-level key insertion orders
    // must be byte-identical (serde_json serializes keys alphabetically).
    let canonical_order_a = serde_json::to_string(&json!({
        "answers": answers_value.clone(),
        "writingAnswers": writing_value.clone(),
        "flags": flags_value.clone()
    }))
    .unwrap();
    let mut map_order_b = serde_json::Map::new();
    map_order_b.insert("flags".to_owned(), flags_value.clone());
    map_order_b.insert("writingAnswers".to_owned(), writing_value.clone());
    map_order_b.insert("answers".to_owned(), answers_value.clone());
    let canonical_order_b =
        serde_json::to_string(&serde_json::Value::Object(map_order_b)).unwrap();
    assert_eq!(
        canonical_order_a, canonical_order_b,
        "same logical JSON must canonicalize to the same string"
    );
    let hash = final_snapshot_sha256(&answers_value, &writing_value, &flags_value);

    // Patch A: json! macro insertion order (answers, writingAnswers, flags).
    let patch_a = json!({
        "answers": answers_value.clone(),
        "writingAnswers": writing_value.clone(),
        "flags": flags_value.clone()
    });
    // Patch B: serde_json::Map insertion order (flags, writingAnswers, answers).
    let mut patch_map_b = serde_json::Map::new();
    patch_map_b.insert("flags".to_owned(), flags_value.clone());
    patch_map_b.insert("writingAnswers".to_owned(), writing_value.clone());
    patch_map_b.insert("answers".to_owned(), answers_value.clone());
    let patch_b = serde_json::Value::Object(patch_map_b);

    let (status_a, json_a) = post_submit_json(
        &app,
        &alice_token,
        schedule_id,
        Some("submit-hash-order-a"),
        json!({
            "attemptId": alice_attempt_id.clone(),
            "lastSeenRevision": alice_revision,
            "submissionId": "submit-hash-order-a",
            "clientFinalSeq": 0,
            "serverAcceptedThroughSeq": 0,
            "finalAnswerPatch": patch_a,
            "finalClientSnapshotHash": hash.clone()
        }),
    )
    .await;
    assert_eq!(status_a, StatusCode::OK, "{json_a}");
    let (status_b, json_b) = post_submit_json(
        &app,
        &bob_token,
        schedule_id,
        Some("submit-hash-order-b"),
        json!({
            "attemptId": bob_attempt_id.clone(),
            "lastSeenRevision": bob_revision,
            "submissionId": "submit-hash-order-b",
            "clientFinalSeq": 0,
            "serverAcceptedThroughSeq": 0,
            "finalAnswerPatch": patch_b,
            "finalClientSnapshotHash": hash
        }),
    )
    .await;
    assert_eq!(status_b, StatusCode::OK, "{json_b}");

    let alice_final = persisted_final_submission(database.pool(), &alice_attempt_id).await;
    assert_eq!(alice_final["answers"]["l-short-1"], "café ☕");
    assert_eq!(
        alice_final["writingAnswers"]["task1"], "<p>Hello &amp; welcome</p>",
        "HTML essay must be stored raw (no normalization)"
    );
    let bob_final = persisted_final_submission(database.pool(), &bob_attempt_id).await;
    assert_eq!(bob_final["answers"]["l-short-1"], "café ☕");
    assert_eq!(bob_final["writingAnswers"]["task1"], "<p>Hello &amp; welcome</p>");

    database.shutdown().await;
}

// BEX-062 — the submit API requires a non-empty Idempotency-Key header;
// missing, empty, and whitespace-only keys are 422 VALIDATION_ERROR with no
// persisted effect.
#[tokio::test]
async fn bex062_submit_requires_non_empty_idempotency_key() {
    let database = mysql::TestDatabase::new(DELIVERY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();
    let (auth, student_key) = create_student_auth(database.pool(), schedule_id, "alice").await;
    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));
    let (bootstrap, _) = start_runtime_and_rebootstrap(
        &app,
        database.pool(),
        &auth,
        schedule_id,
        &student_key,
    )
    .await;
    let attempt_id = bootstrap["data"]["attempt"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let attempt_token = bootstrap["data"]["attemptCredential"]["attemptToken"]
        .as_str()
        .unwrap()
        .to_owned();
    let attempt_revision = bootstrap["data"]["attempt"]["revision"]
        .as_i64()
        .unwrap() as i32;
    let body = json!({
        "attemptId": attempt_id.clone(),
        "lastSeenRevision": attempt_revision,
        "submissionId": "submit-no-key"
    });

    let (status, json) = post_submit_json(&app, &attempt_token, schedule_id, None, body.clone())
        .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{json}");
    assert_eq!(json["error"]["code"], "VALIDATION_ERROR");
    assert_eq!(
        json["error"]["message"],
        "Idempotency-Key header is required for submit requests."
    );

    for (label, key) in [("empty", Some("")), ("whitespace", Some("   "))] {
        let (status, json) = post_submit_json(&app, &attempt_token, schedule_id, key, body.clone())
            .await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{label}: {json}");
        assert_eq!(json["error"]["code"], "VALIDATION_ERROR", "{label}");
        assert_eq!(
            json["error"]["message"], "Idempotency-Key header cannot be empty.",
            "{label}"
        );
    }

    assert_eq!(
        persisted_revision(database.pool(), &attempt_id).await,
        attempt_revision as i64,
        "key rejections must not bump the revision"
    );
    assert!(persisted_submitted_at(database.pool(), &attempt_id).await.is_none());
    assert_eq!(
        persisted_audit_by_action(database.pool(), &attempt_id, "STUDENT_SUBMIT").await,
        0
    );

    database.shutdown().await;
}

// BEX-062 — the same idempotency key with the same payload replays the cached
// receipt: identical submissionId AND submittedAt, one STUDENT_SUBMIT row.
#[tokio::test]
async fn bex062_same_key_same_payload_replays_cached_receipt() {
    let database = mysql::TestDatabase::new(DELIVERY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();
    let (auth, student_key) = create_student_auth(database.pool(), schedule_id, "alice").await;
    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));
    let (bootstrap, _) = start_runtime_and_rebootstrap(
        &app,
        database.pool(),
        &auth,
        schedule_id,
        &student_key,
    )
    .await;
    let attempt_id = bootstrap["data"]["attempt"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let attempt_token = bootstrap["data"]["attemptCredential"]["attemptToken"]
        .as_str()
        .unwrap()
        .to_owned();
    let attempt_revision = bootstrap["data"]["attempt"]["revision"]
        .as_i64()
        .unwrap() as i32;
    let body = json!({
        "attemptId": attempt_id.clone(),
        "lastSeenRevision": attempt_revision,
        "submissionId": "submit-cached-receipt",
        "clientFinalSeq": 0,
        "serverAcceptedThroughSeq": 0
    });

    let (status, json) = post_submit_json(
        &app,
        &attempt_token,
        schedule_id,
        Some("submit-cached-receipt"),
        body.clone(),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json}");
    let submission_id = json["data"]["submissionId"].as_str().unwrap().to_owned();
    let submitted_at = json["data"]["submittedAt"].as_str().unwrap().to_owned();

    let (status, replay) = post_submit_json(
        &app,
        &attempt_token,
        schedule_id,
        Some("submit-cached-receipt"),
        body,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{replay}");
    assert_eq!(
        replay["data"]["submissionId"].as_str().unwrap(),
        submission_id,
        "same key + same payload must return the same receipt"
    );
    assert_eq!(
        replay["data"]["submittedAt"].as_str().unwrap(),
        submitted_at,
        "same key + same payload must return the same submittedAt"
    );
    assert_eq!(replay["data"]["attempt"]["phase"], "post-exam");

    let route_key = format!("POST:/api/v1/student/sessions/{schedule_id}/submit");
    assert_eq!(
        persisted_idempotency_count(database.pool(), &student_key, &route_key, "submit-cached-receipt").await,
        1,
        "exactly one idempotency row for the key"
    );
    assert_eq!(
        persisted_audit_by_action(database.pool(), &attempt_id, "STUDENT_SUBMIT").await,
        1,
        "replay must not add a second STUDENT_SUBMIT row"
    );
    assert_eq!(
        persisted_mutation_row_count(database.pool(), &attempt_id).await,
        0
    );

    database.shutdown().await;
}

// BEX-062 — the same idempotency key with a DIFFERENT payload is a structured
// conflict and never mutates the sealed attempt.
#[tokio::test]
async fn bex062_same_key_different_payload_returns_idempotency_conflict() {
    let database = mysql::TestDatabase::new(DELIVERY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();
    let (auth, student_key) = create_student_auth(database.pool(), schedule_id, "alice").await;
    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));
    let (bootstrap, _) = start_runtime_and_rebootstrap(
        &app,
        database.pool(),
        &auth,
        schedule_id,
        &student_key,
    )
    .await;
    let attempt_id = bootstrap["data"]["attempt"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let attempt_token = bootstrap["data"]["attemptCredential"]["attemptToken"]
        .as_str()
        .unwrap()
        .to_owned();
    let attempt_revision = bootstrap["data"]["attempt"]["revision"]
        .as_i64()
        .unwrap() as i32;

    let (status, json) = post_submit_json(
        &app,
        &attempt_token,
        schedule_id,
        Some("submit-key-p1"),
        json!({
            "attemptId": attempt_id.clone(),
            "lastSeenRevision": attempt_revision,
            "submissionId": "submit-key-p1",
            "clientFinalSeq": 0,
            "serverAcceptedThroughSeq": 0
        }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json}");
    let submission_id = json["data"]["submissionId"].as_str().unwrap().to_owned();
    let revision_after_submit = persisted_revision(database.pool(), &attempt_id).await;

    // Same key, different payload (clientFinalSeq differs): the cached
    // response belongs to the original request, so this must conflict.
    let (status, json) = post_submit_json(
        &app,
        &attempt_token,
        schedule_id,
        Some("submit-key-p1"),
        json!({
            "attemptId": attempt_id.clone(),
            "lastSeenRevision": attempt_revision,
            "submissionId": "submit-key-p1",
            "clientFinalSeq": 1,
            "serverAcceptedThroughSeq": 1
        }),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{json}");
    assert_eq!(json["error"]["code"], "CONFLICT");
    assert_eq!(
        json["error"]["message"], "Idempotency-Key does not match the original request.",
        "{json}"
    );
    assert_eq!(
        persisted_revision(database.pool(), &attempt_id).await,
        revision_after_submit,
        "idempotency conflict must not bump the revision"
    );
    assert_eq!(
        persisted_audit_by_action(database.pool(), &attempt_id, "STUDENT_SUBMIT").await,
        1,
        "idempotency conflict must not add a second STUDENT_SUBMIT row"
    );
    let final_submission = persisted_final_submission(database.pool(), &attempt_id).await;
    assert_eq!(
        final_submission["submissionId"], submission_id,
        "the sealed final_submission must stay untouched"
    );

    database.shutdown().await;
}

// BEX-062 — a NEW idempotency key after a successful submission returns the
// same terminal attempt without duplicate grading: identical submissionId and
// submittedAt, revision unchanged, no new STUDENT_SUBMIT row, final_submission
// untouched.
#[tokio::test]
async fn bex062_new_key_after_submission_returns_terminal_attempt() {
    let database = mysql::TestDatabase::new(DELIVERY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();
    let (auth, student_key) = create_student_auth(database.pool(), schedule_id, "alice").await;
    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));
    let (bootstrap, _) = start_runtime_and_rebootstrap(
        &app,
        database.pool(),
        &auth,
        schedule_id,
        &student_key,
    )
    .await;
    let attempt_id = bootstrap["data"]["attempt"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let attempt_token = bootstrap["data"]["attemptCredential"]["attemptToken"]
        .as_str()
        .unwrap()
        .to_owned();
    let attempt_revision = bootstrap["data"]["attempt"]["revision"]
        .as_i64()
        .unwrap() as i32;

    let (status, json) = post_submit_json(
        &app,
        &attempt_token,
        schedule_id,
        Some("submit-new-key-first"),
        json!({
            "attemptId": attempt_id.clone(),
            "lastSeenRevision": attempt_revision,
            "submissionId": "submit-new-key-first",
            "clientFinalSeq": 0,
            "serverAcceptedThroughSeq": 0
        }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json}");
    let submission_id = json["data"]["submissionId"].as_str().unwrap().to_owned();
    let submitted_at = json["data"]["submittedAt"].as_str().unwrap().to_owned();
    let revision_after_submit = persisted_revision(database.pool(), &attempt_id).await;
    let final_submission_before =
        persisted_final_submission(database.pool(), &attempt_id).await;

    // A fresh key replays the terminal attempt: same receipt, no re-grading.
    let (status, json) = post_submit_json(
        &app,
        &attempt_token,
        schedule_id,
        Some("submit-new-key-second"),
        json!({
            "attemptId": attempt_id.clone(),
            "lastSeenRevision": attempt_revision + 1,
            "submissionId": "submit-new-key-second",
            "clientFinalSeq": 0,
            "serverAcceptedThroughSeq": 0
        }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json}");
    assert_eq!(
        json["data"]["submissionId"].as_str().unwrap(),
        submission_id,
        "a new key after submission must return the same terminal submission"
    );
    assert_eq!(json["data"]["submittedAt"].as_str().unwrap(), submitted_at);
    assert_eq!(json["data"]["attempt"]["phase"], "post-exam");
    assert_eq!(
        persisted_revision(database.pool(), &attempt_id).await,
        revision_after_submit,
        "new-key submit must NOT bump the revision (no duplicate grading)"
    );
    assert_eq!(
        persisted_audit_by_action(database.pool(), &attempt_id, "STUDENT_SUBMIT").await,
        1,
        "exactly one STUDENT_SUBMIT row total"
    );
    assert_eq!(
        persisted_final_submission(database.pool(), &attempt_id).await,
        final_submission_before,
        "final_submission must be unchanged"
    );

    database.shutdown().await;
}

// BEX-062 — two concurrent submits with the same idempotency key produce
// exactly one submission ledger entry: both callers receive the same valid
// receipt, one STUDENT_SUBMIT audit row, one idempotency row.
#[tokio::test]
async fn bex062_concurrent_same_key_submits_produce_single_ledger_entry() {
    let database = mysql::TestDatabase::new(DELIVERY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();
    let (auth, student_key) = create_student_auth(database.pool(), schedule_id, "alice").await;
    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));
    let (bootstrap, _) = start_runtime_and_rebootstrap(
        &app,
        database.pool(),
        &auth,
        schedule_id,
        &student_key,
    )
    .await;
    let attempt_id = bootstrap["data"]["attempt"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let attempt_token = bootstrap["data"]["attemptCredential"]["attemptToken"]
        .as_str()
        .unwrap()
        .to_owned();
    let attempt_revision = bootstrap["data"]["attempt"]["revision"]
        .as_i64()
        .unwrap() as i32;
    let body = json!({
        "attemptId": attempt_id.clone(),
        "lastSeenRevision": attempt_revision,
        "submissionId": "submit-concurrent-1",
        "clientFinalSeq": 0,
        "serverAcceptedThroughSeq": 0
    });

    let first = app.clone().oneshot(
        with_attempt_token(Request::builder(), &attempt_token)
            .method("POST")
            .uri(format!("/api/v1/student/sessions/{schedule_id}/submit"))
            .header("content-type", "application/json")
            .header("idempotency-key", "submit-concurrent-1")
            .body(Body::from(serde_json::to_vec(&body).unwrap()))
            .unwrap(),
    );
    let second = app.clone().oneshot(
        with_attempt_token(Request::builder(), &attempt_token)
            .method("POST")
            .uri(format!("/api/v1/student/sessions/{schedule_id}/submit"))
            .header("content-type", "application/json")
            .header("idempotency-key", "submit-concurrent-1")
            .body(Body::from(serde_json::to_vec(&body).unwrap()))
            .unwrap(),
    );
    let (first, second) = tokio::join!(first, second);

    let first = first.unwrap();
    let second = second.unwrap();
    let first_status = first.status();
    let first_json = json_body(first).await;
    let second_status = second.status();
    let second_json = json_body(second).await;
    assert_eq!(first_status, StatusCode::OK, "first concurrent submit: {first_json}");
    assert_eq!(second_status, StatusCode::OK, "second concurrent submit: {second_json}");
    assert_eq!(
        first_json["data"]["submissionId"],
        second_json["data"]["submissionId"],
        "both concurrent callers must receive the same receipt"
    );
    assert_eq!(
        first_json["data"]["submittedAt"],
        second_json["data"]["submittedAt"]
    );
    assert_eq!(
        persisted_audit_by_action(database.pool(), &attempt_id, "STUDENT_SUBMIT").await,
        1,
        "concurrent submits must produce exactly ONE STUDENT_SUBMIT ledger entry"
    );
    let route_key = format!("POST:/api/v1/student/sessions/{schedule_id}/submit");
    assert_eq!(
        persisted_idempotency_count(database.pool(), &student_key, &route_key, "submit-concurrent-1").await,
        1,
        "exactly one idempotency row for the shared key"
    );
    assert_eq!(
        persisted_revision(database.pool(), &attempt_id).await,
        attempt_revision as i64 + 1,
        "the submit bumps the revision exactly once"
    );
    // The vestigial attempt_submission_ledger table is not populated by the
    // student submit path; the submission ledger is the STUDENT_SUBMIT audit
    // row + the idempotency row (see docs/failure-cases.md BEX-062).
    let ledger_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM attempt_submission_ledger WHERE attempt_id = ?",
    )
    .bind(&attempt_id)
    .fetch_one(database.pool())
    .await
    .unwrap();
    assert_eq!(ledger_count, 0);

    database.shutdown().await;
}

// BEX-063 — a mutation arriving just INSIDE the post-submit grace window is
// accepted and merged into the final snapshot that grading reads.
#[tokio::test]
async fn bex063_mutation_inside_grace_merged_into_final_snapshot() {
    let database = mysql::TestDatabase::new(DELIVERY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();
    let (auth, student_key) = create_student_auth(database.pool(), schedule_id, "alice").await;
    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));
    let (bootstrap, _) = start_runtime_and_rebootstrap(
        &app,
        database.pool(),
        &auth,
        schedule_id,
        &student_key,
    )
    .await;
    let attempt_id = bootstrap["data"]["attempt"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let attempt_token = bootstrap["data"]["attemptCredential"]["attemptToken"]
        .as_str()
        .unwrap()
        .to_owned();
    let base_revision = bootstrap["data"]["attempt"]["revision"]
        .as_i64()
        .unwrap() as i32;

    let (status, json) = post_single_mutation_batch(
        &app,
        &attempt_token,
        schedule_id,
        &attempt_id,
        "bex063-pre-submit",
        base_revision,
        json!({"type": "SetScalar", "questionId": "l-short-1", "value": "pre-submit"}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json}");
    let revision_before_submit = json["data"]["revision"].as_i64().unwrap() as i32;

    let (status, json) = post_submit_json(
        &app,
        &attempt_token,
        schedule_id,
        Some("submit-grace-1"),
        json!({
            "attemptId": attempt_id.clone(),
            "lastSeenRevision": revision_before_submit,
            "submissionId": "submit-grace-1",
            "clientFinalSeq": 1,
            "serverAcceptedThroughSeq": 1
        }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json}");
    let revision_after_submit = persisted_revision(database.pool(), &attempt_id).await;
    assert_eq!(
        persisted_audit_by_action(database.pool(), &attempt_id, "STUDENT_SUBMIT").await,
        1
    );

    // Default grace window is 300s; a submit made moments ago is inside it.
    let (status, json) = post_single_mutation_batch(
        &app,
        &attempt_token,
        schedule_id,
        &attempt_id,
        "bex063-grace-1",
        revision_after_submit as i32,
        json!({"type": "SetScalar", "questionId": "l-short-1", "value": "grace-value"}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json}");
    assert_eq!(json["data"]["appliedMutationCount"], 1);
    assert_eq!(
        json["data"]["acceptedInGrace"], true,
        "a mutation inside the grace window must be accepted in grace: {json}"
    );
    let revision_after_grace = json["data"]["revision"].as_i64().unwrap() as i32;
    assert_eq!(revision_after_grace, revision_after_submit as i32 + 1);

    // The persisted answers AND the final snapshot (grading input) both carry
    // the grace-accepted value.
    let answers = persisted_answers(database.pool(), &attempt_id).await;
    assert_eq!(answers["l-short-1"], "grace-value");
    let final_submission = persisted_final_submission(database.pool(), &attempt_id).await;
    assert_eq!(
        final_submission["answers"]["l-short-1"], "grace-value",
        "grading must never start from a snapshot older than the finalized submission"
    );
    assert_eq!(
        final_submission["graceMerge"]["acceptedInGrace"], true,
        "grace merge must be recorded in the final snapshot"
    );
    assert_eq!(final_submission["graceMerge"]["lastAppliedMutationCount"], 1);
    assert_eq!(final_submission["graceMerge"]["mergeCount"], 1);
    assert_eq!(final_submission["graceMerge"]["appliedMutationTotal"], 1);
    assert_eq!(final_submission["graceMerge"]["graceWindowSeconds"], 300);
    assert!(
        final_submission["graceMerge"]["firstAcceptedAt"].is_string(),
        "{final_submission}"
    );
    assert_eq!(
        final_submission["finalFlush"]["serverAcceptedThroughSeq"], 2,
        "the grace merge extends the accepted watermark in the snapshot"
    );

    let recovery = persisted_recovery(database.pool(), &attempt_id).await;
    assert!(
        recovery["postSubmitGraceAcceptedAt"].is_string(),
        "grace acceptance must persist postSubmitGraceAcceptedAt: {recovery}"
    );
    assert_eq!(recovery["postSubmitGraceLastAppliedMutationCount"], 1);

    database.shutdown().await;
}

// BEX-063 — a mutation arriving just OUTSIDE the grace window is rejected
// with ATTEMPT_SUBMITTED; replaying an already accepted in-grace mutation
// stays idempotent (200, applied 0), and the finalized snapshot is untouched.
#[tokio::test]
async fn bex063_mutation_outside_grace_rejected_and_accepted_replay_idempotent() {
    let database = mysql::TestDatabase::new(DELIVERY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).unwrap();
    let (auth, student_key) = create_student_auth(database.pool(), schedule_id, "alice").await;
    let app = build_router(AppState::with_pool(
        AppConfig::default(),
        database.pool().clone(),
    ));
    let (bootstrap, _) = start_runtime_and_rebootstrap(
        &app,
        database.pool(),
        &auth,
        schedule_id,
        &student_key,
    )
    .await;
    let attempt_id = bootstrap["data"]["attempt"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let attempt_token = bootstrap["data"]["attemptCredential"]["attemptToken"]
        .as_str()
        .unwrap()
        .to_owned();
    let base_revision = bootstrap["data"]["attempt"]["revision"]
        .as_i64()
        .unwrap() as i32;

    let (status, json) = post_single_mutation_batch(
        &app,
        &attempt_token,
        schedule_id,
        &attempt_id,
        "bex063-pre-submit",
        base_revision,
        json!({"type": "SetScalar", "questionId": "l-short-1", "value": "pre-submit"}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json}");
    let revision_before_submit = json["data"]["revision"].as_i64().unwrap() as i32;

    let (status, json) = post_submit_json(
        &app,
        &attempt_token,
        schedule_id,
        Some("submit-grace-2"),
        json!({
            "attemptId": attempt_id.clone(),
            "lastSeenRevision": revision_before_submit,
            "submissionId": "submit-grace-2",
            "clientFinalSeq": 1,
            "serverAcceptedThroughSeq": 1
        }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json}");
    let revision_after_submit = persisted_revision(database.pool(), &attempt_id).await as i32;

    // In-grace acceptance (the replay target for later).
    let grace_body = json!({
        "attemptId": attempt_id.clone(),
        "mutations": [{
            "mutationId": "bex063-grace-accepted",
            "baseRevision": revision_after_submit,
            "type": "SetScalar",
            "questionId": "l-short-1",
            "value": "grace-value"
        }]
    });
    let (status, json) = post_mutation_batch_json(
        &app,
        &attempt_token,
        schedule_id,
        grace_body.clone(),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json}");
    assert_eq!(json["data"]["acceptedInGrace"], true);
    let revision_after_grace = json["data"]["revision"].as_i64().unwrap() as i32;

    // Backdate submitted_at 360s: the 300s grace window has closed.
    sqlx::query("UPDATE student_attempts SET submitted_at = NOW() - INTERVAL 360 SECOND WHERE id = ?")
        .bind(&attempt_id)
        .execute(database.pool())
        .await
        .unwrap();

    // A NEW mutation just outside the grace boundary is a structured
    // ATTEMPT_SUBMITTED conflict — never a generic failure.
    let (status, json) = post_single_mutation_batch(
        &app,
        &attempt_token,
        schedule_id,
        &attempt_id,
        "bex063-past-grace-new",
        revision_after_grace,
        json!({"type": "SetScalar", "questionId": "l-short-1", "value": "too-late"}),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{json}");
    assert_eq!(json["error"]["code"], "CONFLICT");
    assert_eq!(
        json["error"]["details"]["reason"], "ATTEMPT_SUBMITTED",
        "out-of-grace mutation must be ATTEMPT_SUBMITTED: {json}"
    );
    assert_eq!(
        persisted_revision(database.pool(), &attempt_id).await,
        revision_after_grace as i64,
        "rejection must not bump the revision"
    );
    assert_eq!(
        persisted_mutation_row_count(database.pool(), &attempt_id).await,
        2,
        "rejection must not insert a mutation row"
    );

    // Replaying the already accepted in-grace mutation stays idempotent: the
    // dedupe short-circuit runs before the submitted gate → 200 applied 0.
    let (status, json) = post_mutation_batch_json(
        &app,
        &attempt_token,
        schedule_id,
        grace_body,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json}");
    assert_eq!(json["data"]["appliedMutationCount"], 0);
    assert_eq!(
        persisted_revision(database.pool(), &attempt_id).await,
        revision_after_grace as i64,
        "post-submit replay must not bump the revision"
    );
    assert_eq!(
        persisted_mutation_row_count(database.pool(), &attempt_id).await,
        2
    );

    // The finalized snapshot still carries the grace-accepted value — grading
    // never starts from an older snapshot than the finalized submission.
    let answers = persisted_answers(database.pool(), &attempt_id).await;
    assert_eq!(answers["l-short-1"], "grace-value");
    let final_submission = persisted_final_submission(database.pool(), &attempt_id).await;
    assert_eq!(
        final_submission["answers"]["l-short-1"], "grace-value",
        "the final snapshot must retain the grace-accepted answer"
    );
    assert_eq!(final_submission["graceMerge"]["acceptedInGrace"], true);

    database.shutdown().await;
}
