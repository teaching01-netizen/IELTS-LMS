#[path = "../../../tests/support/mysql.rs"]
mod mysql;

use chrono::{Duration, Utc};
use ielts_backend_worker::jobs::{media, retention};
use mysql::TestDatabase;
use sqlx::MySqlPool;
use uuid::Uuid;

const MIGRATIONS: &[&str] = &[
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

#[derive(sqlx::FromRow)]
struct ScheduleMetadata {
    exam_id: Uuid,
    exam_title: String,
    published_version_id: Uuid,
}

#[tokio::test]
async fn retention_prunes_only_expired_non_live_operational_rows_in_batches() {
    let database = TestDatabase::new(MIGRATIONS).await;
    let pool = database.pool().clone();

    let completed_schedule_id = seed_schedule(&pool, "completed").await;
    let live_schedule_id = seed_schedule(&pool, "live").await;
    let submitted_attempt_id = seed_attempt(&pool, completed_schedule_id, true).await;
    let active_attempt_id = seed_attempt(&pool, live_schedule_id, false).await;

    insert_cache_rows(&pool).await;
    insert_idempotency_rows(&pool).await;
    insert_outbox_rows(&pool).await;

    for index in 0..1001 {
        insert_heartbeat(&pool, submitted_attempt_id, completed_schedule_id, 8, index).await;
        insert_mutation(
            &pool,
            submitted_attempt_id,
            completed_schedule_id,
            31,
            index,
        )
        .await;
    }

    insert_heartbeat(&pool, active_attempt_id, live_schedule_id, 8, 10_000).await;
    insert_mutation(&pool, active_attempt_id, live_schedule_id, 31, 10_000).await;

    let report = retention::run_once(pool.clone())
        .await
        .expect("run retention");

    assert_eq!(report.cache_rows, 2);
    assert_eq!(report.idempotency_rows, 1);
    assert_eq!(report.heartbeat_rows, 1000);
    assert_eq!(report.mutation_rows, 1000);
    assert_eq!(report.outbox_rows, 1);

    let cache_count = count_rows(&pool, "shared_cache_entries").await;
    let idempotency_count = count_rows(&pool, "idempotency_keys").await;
    let outbox_count = count_rows(&pool, "outbox_events").await;
    let heartbeat_count = count_rows(&pool, "student_heartbeat_events").await;
    let mutation_count = count_rows(&pool, "student_attempt_mutations").await;

    assert_eq!(
        cache_count, 2,
        "recent invalidations and fresh entries remain"
    );
    assert_eq!(
        idempotency_count, 1,
        "only the fresh idempotency key remains"
    );
    assert_eq!(
        outbox_count, 1,
        "only unpublished or fresh outbox rows remain"
    );
    assert_eq!(
        heartbeat_count, 2,
        "one completed row plus the live-schedule row remain"
    );
    assert_eq!(
        mutation_count, 2,
        "one submitted row plus the live-attempt row remain"
    );

    let live_heartbeat_count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM student_heartbeat_events WHERE schedule_id = ?",
    )
    .bind(live_schedule_id)
    .fetch_one(&pool)
    .await
    .expect("count live heartbeats");
    let live_mutation_count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM student_attempt_mutations WHERE attempt_id = ?",
    )
    .bind(active_attempt_id)
    .fetch_one(&pool)
    .await
    .expect("count live mutations");

    assert_eq!(live_heartbeat_count, 1);
    assert_eq!(live_mutation_count, 1);

    database.shutdown().await;
}

#[tokio::test]
async fn media_cleanup_orphans_stale_uploads_and_deletes_expired_assets_in_batches() {
    let database = TestDatabase::new(MIGRATIONS).await;
    let pool = database.pool().clone();

    let stale_pending_id = insert_media_asset(&pool, "pending", Some(2), 25).await;
    let fresh_pending_id = insert_media_asset(&pool, "pending", None, 1).await;
    let expired_asset_id = insert_media_asset(&pool, "orphaned", Some(-1), 48).await;
    let active_asset_id = insert_media_asset(&pool, "finalized", Some(3), 2).await;

    let report = media::run_once(pool.clone())
        .await
        .expect("run media cleanup");

    assert_eq!(report.orphaned_rows, 1);
    assert_eq!(report.deleted_rows, 1);

    let stale_status =
        sqlx::query_scalar::<_, String>("SELECT upload_status FROM media_assets WHERE id = ?")
            .bind(stale_pending_id)
            .fetch_one(&pool)
            .await
            .expect("load stale pending asset");
    let fresh_status =
        sqlx::query_scalar::<_, String>("SELECT upload_status FROM media_assets WHERE id = ?")
            .bind(fresh_pending_id)
            .fetch_one(&pool)
            .await
            .expect("load fresh pending asset");
    let active_status =
        sqlx::query_scalar::<_, String>("SELECT upload_status FROM media_assets WHERE id = ?")
            .bind(active_asset_id)
            .fetch_one(&pool)
            .await
            .expect("load active asset");
    let deleted_count =
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM media_assets WHERE id = ?")
            .bind(expired_asset_id)
            .fetch_one(&pool)
            .await
            .expect("count deleted asset");

    assert_eq!(stale_status, "orphaned");
    assert_eq!(fresh_status, "pending");
    assert_eq!(active_status, "finalized");
    assert_eq!(deleted_count, 0);

    database.shutdown().await;
}

async fn seed_schedule(pool: &MySqlPool, status: &str) -> Uuid {
    let exam_id = Uuid::new_v4();
    let version_id = Uuid::new_v4();
    let schedule_id = Uuid::new_v4();
    let now = Utc::now();

    sqlx::query(
        r#"
        INSERT INTO exam_entities (
            id, slug, title, exam_type, status, visibility, owner_id,
            created_at, updated_at, current_published_version_id, revision
        )
        VALUES (?, ?, ?, 'Academic', 'published', 'private', 'owner-1', ?, ?, ?, 0)
        "#,
    )
    .bind(exam_id)
    .bind(format!("exam-{schedule_id}"))
    .bind(format!("Exam {schedule_id}"))
    .bind(now)
    .bind(now)
    .bind(version_id)
    .execute(pool)
    .await
    .expect("insert exam");

    sqlx::query(
        r#"
        INSERT INTO exam_versions (
            id, exam_id, version_number, content_snapshot, config_snapshot,
            created_by, created_at, is_draft, is_published, revision
        )
        VALUES (?, ?, 1, JSON_OBJECT(), JSON_OBJECT(), 'owner-1', ?, false, true, 0)
        "#,
    )
    .bind(version_id)
    .bind(exam_id)
    .bind(now)
    .execute(pool)
    .await
    .expect("insert version");

    sqlx::query(
        r#"
        INSERT INTO exam_schedules (
            id, exam_id, exam_title, published_version_id, cohort_name,
            start_time, end_time, planned_duration_minutes, delivery_mode,
            status, created_by, created_at, updated_at, revision
        )
        VALUES (?, ?, 'Exam title', ?, 'Cohort A', ?, ?, 180, 'proctor_start', ?, 'owner-1', ?, ?, 0)
        "#,
    )
    .bind(schedule_id)
    .bind(exam_id)
    .bind(version_id)
    .bind(now)
    .bind(now + Duration::hours(3))
    .bind(status)
    .bind(now)
    .bind(now)
    .execute(pool)
    .await
    .expect("insert schedule");

    schedule_id
}

async fn seed_attempt(pool: &MySqlPool, schedule_id: Uuid, submitted: bool) -> Uuid {
    let exam_row = sqlx::query_as::<_, ScheduleMetadata>(
        "SELECT exam_id, exam_title, published_version_id FROM exam_schedules WHERE id = ?",
    )
    .bind(schedule_id)
    .fetch_one(pool)
    .await
    .expect("load schedule metadata");
    let attempt_id = Uuid::new_v4();
    let submitted_at = submitted.then(|| Utc::now() - Duration::days(10));

    sqlx::query(
        r#"
        INSERT INTO student_attempts (
            id, schedule_id, student_key, exam_id, published_version_id, exam_title,
            candidate_id, candidate_name, candidate_email, phase, current_module,
            answers, writing_answers, flags, violations_snapshot, integrity, recovery,
            submitted_at, created_at, updated_at, revision
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'exam', 'reading', JSON_OBJECT(), JSON_OBJECT(), JSON_OBJECT(), JSON_ARRAY(), JSON_OBJECT(), JSON_OBJECT(), ?, NOW(), NOW(), 0)
        "#,
    )
    .bind(attempt_id)
    .bind(schedule_id)
    .bind(format!("student-{attempt_id}"))
    .bind(exam_row.exam_id)
    .bind(exam_row.published_version_id)
    .bind(exam_row.exam_title)
    .bind(format!("candidate-{attempt_id}"))
    .bind("Candidate")
    .bind("candidate@example.com")
    .bind(submitted_at)
    .execute(pool)
    .await
    .expect("insert attempt");

    attempt_id
}

async fn insert_cache_rows(pool: &MySqlPool) {
    sqlx::query(
        r#"
        INSERT INTO shared_cache_entries (
            cache_key, payload, revision, invalidated_at, expires_at, created_at, updated_at
        )
        VALUES
            ('cache-invalid-old', JSON_OBJECT(), 1, NOW() - INTERVAL 25 HOUR, NULL, NOW(), NOW()),
            ('cache-invalid-recent', JSON_OBJECT(), 1, NOW() - INTERVAL 1 HOUR, NULL, NOW(), NOW()),
            ('cache-expired-old', JSON_OBJECT(), 1, NULL, NOW() - INTERVAL 25 HOUR, NOW(), NOW()),
            ('cache-fresh', JSON_OBJECT(), 1, NULL, NOW() + INTERVAL 2 HOUR, NOW(), NOW())
        "#,
    )
    .execute(pool)
    .await
    .expect("insert cache rows");
}

async fn insert_idempotency_rows(pool: &MySqlPool) {
    sqlx::query(
        r#"
        INSERT INTO idempotency_keys (
            actor_id, route_key, idempotency_key, request_hash, response_status,
            response_body, created_at, expires_at
        )
        VALUES
            ('actor-1', 'route-a', 'expired', 'hash-a', 200, JSON_OBJECT(), NOW() - INTERVAL 5 DAY, NOW() - INTERVAL 2 DAY),
            ('actor-1', 'route-a', 'fresh', 'hash-b', 200, JSON_OBJECT(), NOW(), NOW() + INTERVAL 2 DAY)
        "#,
    )
    .execute(pool)
    .await
    .expect("insert idempotency rows");
}

async fn insert_outbox_rows(pool: &MySqlPool) {
    sqlx::query(
        r#"
        INSERT INTO outbox_events (
            id, aggregate_kind, aggregate_id, revision, event_family, payload,
            created_at, claimed_at, published_at, publish_attempts
        )
        VALUES
            (?, 'schedule_runtime', 'old', 1, 'runtime_changed', JSON_OBJECT(), NOW() - INTERVAL 4 DAY, NOW() - INTERVAL 4 DAY, NOW() - INTERVAL 4 DAY, 1),
            (?, 'schedule_runtime', 'fresh', 1, 'runtime_changed', JSON_OBJECT(), NOW(), NULL, NULL, 0)
        "#,
    )
    .bind(Uuid::new_v4())
    .bind(Uuid::new_v4())
    .execute(pool)
    .await
    .expect("insert outbox rows");
}

async fn insert_heartbeat(
    pool: &MySqlPool,
    attempt_id: Uuid,
    schedule_id: Uuid,
    age_days: i64,
    suffix: i64,
) {
    let timestamp = Utc::now() - Duration::days(age_days);

    sqlx::query(
        r#"
        INSERT INTO student_heartbeat_events (
            id, attempt_id, schedule_id, event_type, payload, client_timestamp, server_received_at
        )
        VALUES (?, ?, ?, 'disconnect', JSON_OBJECT('seq', ?), ?, ?)
        "#,
    )
    .bind(Uuid::new_v4())
    .bind(attempt_id)
    .bind(schedule_id)
    .bind(suffix)
    .bind(timestamp)
    .bind(timestamp)
    .execute(pool)
    .await
    .expect("insert heartbeat");
}

async fn insert_mutation(
    pool: &MySqlPool,
    attempt_id: Uuid,
    schedule_id: Uuid,
    age_days: i64,
    sequence: i64,
) {
    let timestamp = Utc::now() - Duration::days(age_days);

    sqlx::query(
        r#"
        INSERT INTO student_attempt_mutations (
            id, attempt_id, schedule_id, client_session_id, mutation_type,
            client_mutation_id, mutation_seq, payload, client_timestamp,
            server_received_at, applied_revision, applied_at
        )
        VALUES (?, ?, ?, ?, 'answer.set', ?, ?, JSON_OBJECT(), ?, ?, 1, ?)
        "#,
    )
    .bind(Uuid::new_v4())
    .bind(attempt_id)
    .bind(schedule_id)
    .bind(Uuid::new_v4())
    .bind(format!("mutation-{sequence}"))
    .bind(sequence)
    .bind(timestamp)
    .bind(timestamp)
    .bind(timestamp)
    .execute(pool)
    .await
    .expect("insert mutation");
}

async fn insert_media_asset(
    pool: &MySqlPool,
    upload_status: &str,
    delete_after_days: Option<i64>,
    age_hours: i64,
) -> Uuid {
    let id = Uuid::new_v4();
    let created_at = Utc::now() - Duration::hours(age_hours);

    sqlx::query(
        r#"
        INSERT INTO media_assets (
            id, owner_kind, owner_id, content_type, file_name, upload_status,
            object_key, upload_url, delete_after_at, created_at, updated_at
        )
        VALUES (?, 'submission', 'submission-1', 'audio/webm', 'clip.webm', ?, ?, 'https://upload.local', ?, ?, ?)
        "#,
    )
    .bind(id)
    .bind(upload_status)
    .bind(format!("asset-{id}"))
    .bind(delete_after_days.map(|days| Utc::now() + Duration::days(days)))
    .bind(created_at)
    .bind(created_at)
    .execute(pool)
    .await
    .expect("insert media asset");

    id
}

async fn count_rows(pool: &MySqlPool, table_name: &str) -> i64 {
    sqlx::query_scalar::<_, i64>(&format!("SELECT COUNT(*) FROM {table_name}"))
        .fetch_one(pool)
        .await
        .expect("count rows")
}
