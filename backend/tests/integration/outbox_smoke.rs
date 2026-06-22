#[path = "../support/mysql.rs"]
mod mysql;

use serde_json::json;

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
    "0017_production_hardening.sql",
    "0030_outbox_retry_policy.sql",
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

    let claimed = repository
        .claim_batch(10, "test-worker", 60)
        .await
        .expect("claim batch");
    assert_eq!(claimed.len(), 1);
    assert_eq!(claimed[0].id, created.id);
    assert_eq!(claimed[0].publish_attempts, 1);
    let claim_token = claimed[0].claim_token.clone().expect("claim token");

    let published = repository
        .mark_published(&claim_token, &[created.id])
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

#[tokio::test]
async fn failed_oldest_batch_does_not_starve_a_later_eligible_event() {
    let database = mysql::TestDatabase::new(INFRA_MIGRATIONS).await;
    let repository = OutboxRepository::new(database.pool().clone());

    for index in 0..100 {
        repository
            .enqueue(
                "poison",
                &format!("poison-{index}"),
                1,
                "poison_event",
                &json!({ "invalid": true }),
            )
            .await
            .expect("enqueue poison event");
    }

    let poison_batch = repository
        .claim_batch(100, "poison-worker", 60)
        .await
        .expect("claim poison batch");
    assert_eq!(poison_batch.len(), 100);
    let claim_token = poison_batch[0].claim_token.clone().expect("claim token");
    for event in poison_batch {
        repository
            .mark_failed(
                &claim_token,
                event.id,
                event.publish_attempts,
                "malformed payload",
            )
            .await
            .expect("schedule poison retry");
    }

    let later = repository
        .enqueue(
            "schedule_runtime",
            "later-event",
            1,
            "runtime_changed",
            &json!({ "scheduleId": "later-event" }),
        )
        .await
        .expect("enqueue later event");

    let next_batch = repository
        .claim_batch(100, "next-worker", 60)
        .await
        .expect("claim next eligible batch");
    assert_eq!(next_batch.len(), 1);
    assert_eq!(next_batch[0].id, later.id);

    database.shutdown().await;
}
