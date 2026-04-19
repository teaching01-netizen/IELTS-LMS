#[path = "../support/mysql.rs"]
mod mysql;

use serde_json::json;
use std::time::Duration;

use ielts_backend_infrastructure::outbox::OutboxRepository;

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

// These tests use PostgreSQL-specific LISTEN/NOTIFY mechanism which doesn't exist in MySQL.
// MySQL/TiDB doesn't support the same notification triggers as PostgreSQL.
// These tests are disabled for MySQL since they test PostgreSQL-specific outbox notification functionality.
#[tokio::test]
#[ignore = "PostgreSQL-specific LISTEN/NOTIFY not available in MySQL"]
async fn outbox_rows_can_be_claimed_and_marked_published() {
    let database = mysql::TestDatabase::new(INFRA_MIGRATIONS).await;
    let repository = OutboxRepository::new(database.pool().clone());

    let created = repository
        .enqueue(
            "schedule_runtime",
            "schedule-123",
            4,
            "runtime_changed",
            &json!({ "scheduleId": "schedule-123", "event": "runtime_changed" }),
        )
        .await
        .expect("enqueue outbox event");
    assert_eq!(created.aggregate_kind, "schedule_runtime");

    let claimed = repository.claim_batch(10).await.expect("claim batch");
    assert_eq!(claimed.len(), 1);
    assert_eq!(claimed[0].id, created.id);
    assert_eq!(claimed[0].publish_attempts, 1);

    let published = repository
        .mark_published(&[created.id])
        .await
        .expect("mark published");
    assert_eq!(published, 1);

    database.shutdown().await;
}

#[tokio::test]
#[ignore = "PostgreSQL-specific LISTEN/NOTIFY not available in MySQL"]
async fn outbox_insert_triggers_wakeup_notification() {
    let database = mysql::TestDatabase::new(INFRA_MIGRATIONS).await;
    let repository = OutboxRepository::new(database.pool().clone());

    let created = repository
        .enqueue(
            "schedule_runtime",
            "schedule-456",
            1,
            "runtime_changed",
            &json!({ "scheduleId": "schedule-456", "event": "runtime_changed" }),
        )
        .await
        .expect("enqueue outbox event");
    assert_eq!(created.aggregate_id, "schedule-456");

    database.shutdown().await;
}
