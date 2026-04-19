#[path = "../support/mysql.rs"]
mod mysql;

use serde_json::json;

use ielts_backend_infrastructure::idempotency::{IdempotencyLookupStatus, IdempotencyRepository};

const INFRA_MIGRATIONS: &[&str] = &[
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
async fn idempotency_keys_replay_same_hash_and_conflict_on_mismatch() {
    let database = mysql::TestDatabase::new(INFRA_MIGRATIONS).await;
    let repository = IdempotencyRepository::new(database.pool().clone());

    let (created_status, created) = repository
        .store_or_replay(
            "actor-1",
            "POST:/api/v1/student/sessions/submit",
            "idem-1",
            "hash-a",
            200,
            json!({ "ok": true }),
        )
        .await
        .expect("store idempotency record");
    assert_eq!(created_status, IdempotencyLookupStatus::Created);
    assert_eq!(created.response_status, 200);

    let (replay_status, replay) = repository
        .store_or_replay(
            "actor-1",
            "POST:/api/v1/student/sessions/submit",
            "idem-1",
            "hash-a",
            200,
            json!({ "ok": true }),
        )
        .await
        .expect("replay idempotency record");
    assert_eq!(replay_status, IdempotencyLookupStatus::Replay);
    assert_eq!(replay.response_body["ok"], true);

    let (conflict_status, conflict) = repository
        .store_or_replay(
            "actor-1",
            "POST:/api/v1/student/sessions/submit",
            "idem-1",
            "hash-b",
            409,
            json!({ "ok": false }),
        )
        .await
        .expect("conflict result");
    assert_eq!(conflict_status, IdempotencyLookupStatus::Conflict);
    assert_eq!(conflict.request_hash, "hash-a");

    database.shutdown().await;
}
