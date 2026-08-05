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

#[tokio::test]
async fn mutation_batch_rejects_replayed_idempotency_key_and_hash_mismatch() {
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

    assert_eq!(replay.status(), StatusCode::CONFLICT);
    let replay_json = json_body(replay).await;
    assert_eq!(replay_json["error"]["code"], "CONFLICT");

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

#[tokio::test]
async fn submit_applies_final_patch_even_if_last_seen_revision_is_behind() {
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
    assert_eq!(mutation_response.status(), StatusCode::OK);

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

    assert_eq!(response.status(), StatusCode::CONFLICT);
    let json = json_body(response).await;
    assert_eq!(json["error"]["code"], "CONFLICT");

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
            {"id": "l-blank-2", "type": "SENTENCE_COMPLETION", "questions": [{"id": "l-blank-2", "sentence": "Fill __ then __.", "blanks": [{"id": "l-blank-2:b1", "correctAnswer": "first"}, {"id": "l-blank-2:b2", "correctAnswer": "second"}]}]}
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
