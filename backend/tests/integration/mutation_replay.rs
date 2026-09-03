#[path = "../support/mysql.rs"]
mod mysql;

use chrono::{Duration, TimeZone, Utc};
use serde_json::json;
use sqlx::{mysql::MySqlPoolOptions, query_scalar};
use uuid::Uuid;

use ielts_backend_application::{
    builder::BuilderService,
    delivery::{DeliveryConflictReason, DeliveryError, DeliveryService, MutationBatchResponseMode},
    scheduling::SchedulingService,
};
use ielts_backend_domain::{
    attempt::{
        MutationCommand, MutationEnvelope, MutationType, StudentBootstrapRequest,
        StudentMutationBatchRequest, StudentSubmitRequest,
    },
    exam::{CreateExamRequest, ExamType, PublishExamRequest, SaveDraftRequest, Visibility},
    schedule::{CreateScheduleRequest, RuntimeCommandAction, RuntimeCommandRequest},
};
use ielts_backend_infrastructure::actor_context::{ActorContext, ActorRole};

const DELIVERY_MIGRATIONS: &[&str] = &[
    "0001_roles.sql",
    "0002_rls_helpers.sql",
    "0003_exam_core.sql",
    "0004_library_and_defaults.sql",
    "0005_scheduling_and_access.sql",
    "0006_delivery.sql",
    "0010_auth_security.sql",
    "0015_operation_write_hardening.sql",
];

const ACT_DELIVERY_MIGRATIONS: &[&str] = &[
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
    "0031_grading_export_profiles.sql",
    "0032_act_science_support.sql",
];

fn command(mutation_type: MutationType, payload: serde_json::Value) -> MutationCommand {
    serde_json::from_value(json!({
        "mutationType": mutation_type.as_str(),
        "payload": payload
    }))
    .expect("valid mutation command")
}

#[tokio::test]
async fn mutation_batches_replay_in_sequence_and_reject_overlapping_ranges() {
    let database = mysql::TestDatabase::new(DELIVERY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).expect("schedule id");
    let service = DeliveryService::new(database.pool().clone());
    let session = service
        .bootstrap(
            schedule_id,
            StudentBootstrapRequest {
                student_key: student_key(schedule_id, "alice"),
                candidate_id: "alice".to_owned(),
                candidate_name: "Alice Roe".to_owned(),
                candidate_email: "alice@example.com".to_owned(),
                email: Some("alice@example.com".to_owned()),
                wcode: Some("W123456".to_owned()),
                client_session_id: Uuid::new_v4().to_string(),
            },
        )
        .await
        .expect("bootstrap attempt");
    let attempt = session.attempt.expect("attempt");
    let attempt_id = attempt.id.clone();
    let student_key = student_key(schedule_id, "alice");
    let client_session_id = Uuid::new_v4().to_string();

    let first_batch = service
        .apply_mutation_batch(
            schedule_id,
            StudentMutationBatchRequest {
                attempt_id: attempt_id.clone(),
                student_key: student_key.clone(),
                client_session_id: client_session_id.clone(),
                mutations: vec![
                    MutationEnvelope {
                        id: "m1".to_owned(),
                        seq: 1,
                        timestamp: Utc.with_ymd_and_hms(2026, 1, 10, 9, 10, 0).unwrap(),
                        command: command(
                            MutationType::Answer,
                            json!({"questionId": "q1", "value": "A"}),
                        ),
                        base_revision: None,
                    },
                    MutationEnvelope {
                        id: "m2".to_owned(),
                        seq: 2,
                        timestamp: Utc.with_ymd_and_hms(2026, 1, 10, 9, 10, 5).unwrap(),
                        command: command(
                            MutationType::WritingAnswer,
                            json!({"taskId": "task-1", "value": "Draft 1"}),
                        ),
                        base_revision: None,
                    },
                ],
            },
            MutationBatchResponseMode::Full,
            None,
        )
        .await
        .expect("apply first batch");

    assert_eq!(first_batch.server_accepted_through_seq, 2);
    let first_attempt = first_batch
        .attempt
        .expect("full mutation response includes attempt");
    assert_eq!(first_attempt.answers["q1"], "A");
    assert_eq!(first_attempt.writing_answers["task-1"], "Draft 1");

    let second_batch = service
        .apply_mutation_batch(
            schedule_id,
            StudentMutationBatchRequest {
                attempt_id: attempt_id.clone(),
                student_key: student_key.clone(),
                client_session_id: client_session_id.clone(),
                mutations: vec![
                    MutationEnvelope {
                        id: "m3".to_owned(),
                        seq: 3,
                        timestamp: Utc.with_ymd_and_hms(2026, 1, 10, 9, 11, 0).unwrap(),
                        command: command(
                            MutationType::Answer,
                            json!({"questionId": "q1", "value": "B"}),
                        ),
                        base_revision: None,
                    },
                    MutationEnvelope {
                        id: "m4".to_owned(),
                        seq: 4,
                        timestamp: Utc.with_ymd_and_hms(2026, 1, 10, 9, 11, 5).unwrap(),
                        command: command(
                            MutationType::Flag,
                            json!({"questionId": "q1", "value": true}),
                        ),
                        base_revision: None,
                    },
                ],
            },
            MutationBatchResponseMode::Full,
            None,
        )
        .await
        .expect("apply second batch");

    assert_eq!(second_batch.server_accepted_through_seq, 4);
    let second_attempt = second_batch
        .attempt
        .expect("full mutation response includes attempt");
    assert_eq!(second_attempt.answers["q1"], "B");
    assert_eq!(second_attempt.flags["q1"], true);

    let overlap = service
        .apply_mutation_batch(
            schedule_id,
            StudentMutationBatchRequest {
                attempt_id: attempt_id.clone(),
                student_key: student_key.clone(),
                client_session_id,
                mutations: vec![MutationEnvelope {
                    id: "m-overlap".to_owned(),
                    seq: 4,
                    timestamp: Utc.with_ymd_and_hms(2026, 1, 10, 9, 12, 0).unwrap(),
                    command: command(
                        MutationType::Answer,
                        json!({"questionId": "q1", "value": "C"}),
                    ),
                    base_revision: None,
                }],
            },
            MutationBatchResponseMode::Full,
            None,
        )
        .await;

    assert!(overlap.is_err());

    let stored_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM student_attempt_mutations WHERE attempt_id = ?")
            .bind(attempt_id)
            .fetch_one(database.pool())
            .await
            .unwrap();
    assert_eq!(stored_count, 4);

    database.shutdown().await;
}

#[tokio::test]
async fn operation_mutations_reject_stale_revision_and_preserve_field_scope() {
    let database = mysql::TestDatabase::new(DELIVERY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).expect("schedule id");
    let service = DeliveryService::new(database.pool().clone());
    let session = service
        .bootstrap(
            schedule_id,
            StudentBootstrapRequest {
                student_key: student_key(schedule_id, "alice"),
                candidate_id: "alice".to_owned(),
                candidate_name: "Alice Roe".to_owned(),
                candidate_email: "alice@example.com".to_owned(),
                email: Some("alice@example.com".to_owned()),
                wcode: Some("W123456".to_owned()),
                client_session_id: Uuid::new_v4().to_string(),
            },
        )
        .await
        .expect("bootstrap attempt");
    let attempt = session.attempt.expect("attempt");
    let attempt_id = attempt.id.clone();
    let student_key = student_key(schedule_id, "alice");
    let client_session_id = Uuid::new_v4().to_string();

    let first = service
        .apply_mutation_batch(
            schedule_id,
            StudentMutationBatchRequest {
                attempt_id: attempt_id.clone(),
                student_key: student_key.clone(),
                client_session_id: client_session_id.clone(),
                mutations: vec![MutationEnvelope {
                    id: "op-1".to_owned(),
                    seq: 1,
                    timestamp: Utc.with_ymd_and_hms(2026, 1, 10, 9, 10, 0).unwrap(),
                    command: command(
                        MutationType::SetScalar,
                        json!({
                            "baseRevision": 0,
                            "questionId": "q1",
                            "value": "ALPHA",
                        }),
                    ),
                    base_revision: None,
                }],
            },
            MutationBatchResponseMode::Full,
            None,
        )
        .await
        .expect("apply first operation");

    assert_eq!(first.server_accepted_through_seq, 1);
    let first_attempt = first.attempt.expect("full response attempt");
    assert_eq!(first_attempt.answers["q1"], "ALPHA");

    let stale = service
        .apply_mutation_batch(
            schedule_id,
            StudentMutationBatchRequest {
                attempt_id: attempt_id.clone(),
                student_key: student_key.clone(),
                client_session_id: client_session_id.clone(),
                mutations: vec![MutationEnvelope {
                    id: "op-stale".to_owned(),
                    seq: 2,
                    timestamp: Utc.with_ymd_and_hms(2026, 1, 10, 9, 10, 5).unwrap(),
                    command: command(
                        MutationType::SetScalar,
                        json!({
                            "baseRevision": 0,
                            "questionId": "q1",
                            "value": "STALE",
                        }),
                    ),
                    base_revision: None,
                }],
            },
            MutationBatchResponseMode::Full,
            None,
        )
        .await
        .expect_err("stale revision must be rejected");

    match stale {
        DeliveryError::Conflict {
            reason: Some(reason),
            latest_revision: Some(latest_revision),
            ..
        } => {
            assert_eq!(reason, DeliveryConflictReason::BaseRevisionMismatch);
            assert_eq!(latest_revision, 1);
        }
        other => panic!("expected base revision mismatch conflict, got {:?}", other),
    }

    let second = service
        .apply_mutation_batch(
            schedule_id,
            StudentMutationBatchRequest {
                attempt_id: attempt_id.clone(),
                student_key: student_key.clone(),
                client_session_id: client_session_id.clone(),
                mutations: vec![MutationEnvelope {
                    id: "op-2".to_owned(),
                    seq: 2,
                    timestamp: Utc.with_ymd_and_hms(2026, 1, 10, 9, 11, 0).unwrap(),
                    command: command(
                        MutationType::SetScalar,
                        json!({
                            "baseRevision": 1,
                            "questionId": "q2",
                            "value": "BRAVO",
                        }),
                    ),
                    base_revision: None,
                }],
            },
            MutationBatchResponseMode::Full,
            None,
        )
        .await
        .expect("second operation should succeed");

    let second_attempt = second.attempt.expect("full response attempt");
    assert_eq!(second_attempt.answers["q1"], "ALPHA");
    assert_eq!(second_attempt.answers["q2"], "BRAVO");
    let stored_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM student_attempt_mutations WHERE attempt_id = ?")
            .bind(&attempt_id)
            .fetch_one(database.pool())
            .await
            .expect("count persisted mutation rows");
    assert_eq!(stored_count, 2);

    database.shutdown().await;
}

#[tokio::test]
async fn operation_mutations_with_idempotency_key_are_deterministic_and_do_not_duplicate_rows() {
    let database = mysql::TestDatabase::new(DELIVERY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).expect("schedule id");
    let service = DeliveryService::new(database.pool().clone());
    let session = service
        .bootstrap(
            schedule_id,
            StudentBootstrapRequest {
                student_key: student_key(schedule_id, "alice"),
                candidate_id: "alice".to_owned(),
                candidate_name: "Alice Roe".to_owned(),
                candidate_email: "alice@example.com".to_owned(),
                email: Some("alice@example.com".to_owned()),
                wcode: Some("W123456".to_owned()),
                client_session_id: Uuid::new_v4().to_string(),
            },
        )
        .await
        .expect("bootstrap attempt");
    let attempt = session.attempt.expect("attempt");
    let attempt_id = attempt.id.clone();
    let student_key = student_key(schedule_id, "alice");
    let client_session_id = Uuid::new_v4().to_string();

    let batch = StudentMutationBatchRequest {
        attempt_id: attempt_id.clone(),
        student_key: student_key.clone(),
        client_session_id: client_session_id.clone(),
        mutations: vec![MutationEnvelope {
            id: "op-idempotent-1".to_owned(),
            seq: 1,
            timestamp: Utc.with_ymd_and_hms(2026, 1, 10, 9, 10, 0).unwrap(),
            command: command(
                MutationType::SetScalar,
                json!({
                    "baseRevision": 0,
                    "questionId": "q1",
                    "value": "ALPHA",
                }),
            ),
            base_revision: None,
        }],
    };

    let first = service
        .apply_mutation_batch(
            schedule_id,
            batch.clone(),
            MutationBatchResponseMode::Full,
            Some("idem-operation-1".to_owned()),
        )
        .await
        .expect("first idempotent request");
    let second = service
        .apply_mutation_batch(
            schedule_id,
            batch,
            MutationBatchResponseMode::Full,
            Some("idem-operation-1".to_owned()),
        )
        .await
        .expect("idempotent replay");

    assert_eq!(
        first.server_accepted_through_seq,
        second.server_accepted_through_seq
    );
    assert_eq!(first.revision, second.revision);
    let stored_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM student_attempt_mutations WHERE attempt_id = ?")
            .bind(&attempt_id)
            .fetch_one(database.pool())
            .await
            .expect("count persisted mutation rows");
    assert_eq!(stored_count, 1);

    database.shutdown().await;
}

#[tokio::test]
async fn idempotency_hash_mismatch_rejects_conflict_without_partial_writes() {
    let database = mysql::TestDatabase::new(DELIVERY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).expect("schedule id");
    let service = DeliveryService::new(database.pool().clone());
    let session = service
        .bootstrap(
            schedule_id,
            StudentBootstrapRequest {
                student_key: student_key(schedule_id, "alice"),
                candidate_id: "alice".to_owned(),
                candidate_name: "Alice Roe".to_owned(),
                candidate_email: "alice@example.com".to_owned(),
                email: Some("alice@example.com".to_owned()),
                wcode: Some("W123456".to_owned()),
                client_session_id: Uuid::new_v4().to_string(),
            },
        )
        .await
        .expect("bootstrap attempt");
    let attempt = session.attempt.expect("attempt");
    let attempt_id = attempt.id.clone();
    let student_key = student_key(schedule_id, "alice");
    let client_session_id = Uuid::new_v4().to_string();

    let original = StudentMutationBatchRequest {
        attempt_id: attempt_id.clone(),
        student_key: student_key.clone(),
        client_session_id: client_session_id.clone(),
        mutations: vec![MutationEnvelope {
            id: "op-hash-1".to_owned(),
            seq: 1,
            timestamp: Utc.with_ymd_and_hms(2026, 1, 10, 9, 20, 0).unwrap(),
            command: command(
                MutationType::SetScalar,
                json!({
                    "baseRevision": 0,
                    "questionId": "q1",
                    "value": "ALPHA",
                }),
            ),
            base_revision: None,
        }],
    };
    service
        .apply_mutation_batch(
            schedule_id,
            original,
            MutationBatchResponseMode::Full,
            Some("idem-hash-1".to_owned()),
        )
        .await
        .expect("store first idempotency result");

    let mismatch = StudentMutationBatchRequest {
        attempt_id: attempt_id.clone(),
        student_key: student_key.clone(),
        client_session_id: client_session_id.clone(),
        mutations: vec![MutationEnvelope {
            id: "op-hash-2".to_owned(),
            seq: 2,
            timestamp: Utc.with_ymd_and_hms(2026, 1, 10, 9, 20, 5).unwrap(),
            command: command(
                MutationType::SetScalar,
                json!({
                    "baseRevision": 1,
                    "questionId": "q1",
                    "value": "BRAVO",
                }),
            ),
            base_revision: None,
        }],
    };
    let err = service
        .apply_mutation_batch(
            schedule_id,
            mismatch,
            MutationBatchResponseMode::Full,
            Some("idem-hash-1".to_owned()),
        )
        .await
        .expect_err("mismatched payload must conflict");
    match err {
        DeliveryError::Conflict { message, .. } => {
            assert!(
                message.contains("Idempotency-Key does not match the original request."),
                "unexpected conflict message: {message}"
            );
        }
        other => panic!("expected idempotency conflict, got {:?}", other),
    }

    let stored_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM student_attempt_mutations WHERE attempt_id = ?")
            .bind(&attempt_id)
            .fetch_one(database.pool())
            .await
            .expect("count persisted mutation rows");
    assert_eq!(stored_count, 1);

    database.shutdown().await;
}

#[tokio::test]
async fn submit_rejects_missing_seq_without_final_patch() {
    let database = mysql::TestDatabase::new(DELIVERY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).expect("schedule id");
    let service = DeliveryService::new(database.pool().clone());
    let session = service
        .bootstrap(
            schedule_id,
            StudentBootstrapRequest {
                student_key: student_key(schedule_id, "alice"),
                candidate_id: "alice".to_owned(),
                candidate_name: "Alice Roe".to_owned(),
                candidate_email: "alice@example.com".to_owned(),
                email: Some("alice@example.com".to_owned()),
                wcode: Some("W123456".to_owned()),
                client_session_id: Uuid::new_v4().to_string(),
            },
        )
        .await
        .expect("bootstrap attempt");
    let attempt = session.attempt.expect("attempt");

    let submit_error = service
        .submit_attempt(
            schedule_id,
            StudentSubmitRequest {
                attempt_id: attempt.id.clone(),
                student_key: student_key(schedule_id, "alice"),
                last_seen_revision: Some(attempt.revision),
                submission_id: Some("submit-missing-seq".to_owned()),
                client_session_id: None,
                client_final_seq: None,
                server_accepted_through_seq: None,
                final_answer_patch: None,
                final_client_snapshot_hash: None,
                answers: None,
                writing_answers: None,
                flags: None,
            },
            Some("submit-missing-seq".to_owned()),
        )
        .await
        .expect_err("submit without final flush metadata should conflict");

    match submit_error {
        DeliveryError::Conflict {
            reason: Some(reason),
            ..
        } => assert_eq!(reason, DeliveryConflictReason::FinalFlushRequired),
        other => panic!("expected FinalFlushRequired conflict, got: {other:?}"),
    }

    database.shutdown().await;
}

#[tokio::test]
async fn operation_set_slot_persists_mutation_and_answer_slot_rows() {
    let database = mysql::TestDatabase::new(DELIVERY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).expect("schedule id");
    let service = DeliveryService::new(database.pool().clone());
    let session = service
        .bootstrap(
            schedule_id,
            StudentBootstrapRequest {
                student_key: student_key(schedule_id, "alice"),
                candidate_id: "alice".to_owned(),
                candidate_name: "Alice Roe".to_owned(),
                candidate_email: "alice@example.com".to_owned(),
                email: Some("alice@example.com".to_owned()),
                wcode: Some("W123456".to_owned()),
                client_session_id: Uuid::new_v4().to_string(),
            },
        )
        .await
        .expect("bootstrap attempt");
    let attempt = session.attempt.expect("attempt");
    let attempt_id = attempt.id.clone();
    let student_key = student_key(schedule_id, "alice");
    let client_session_id = Uuid::new_v4().to_string();

    let response = service
        .apply_mutation_batch(
            schedule_id,
            StudentMutationBatchRequest {
                attempt_id: attempt_id.clone(),
                student_key: student_key.clone(),
                client_session_id: client_session_id.clone(),
                mutations: vec![MutationEnvelope {
                    id: "slot-1".to_owned(),
                    seq: 1,
                    timestamp: Utc.with_ymd_and_hms(2026, 1, 10, 9, 30, 0).unwrap(),
                    command: command(
                        MutationType::SetSlot,
                        json!({
                            "baseRevision": 0,
                            "questionId": "q-slot-1",
                            "slotIndex": 1,
                            "value": "second-value",
                        }),
                    ),
                    base_revision: None,
                }],
            },
            MutationBatchResponseMode::Full,
            None,
        )
        .await
        .expect("set slot mutation");
    assert_eq!(response.applied_mutation_count, 1);

    let mutation_rows: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM student_attempt_mutations WHERE attempt_id = ?")
            .bind(&attempt_id)
            .fetch_one(database.pool())
            .await
            .expect("count mutation rows");
    assert_eq!(mutation_rows, 1);
    let slot_rows: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM student_attempt_answer_slots WHERE attempt_id = ? AND question_id = ?",
    )
    .bind(&attempt_id)
    .bind("q-slot-1")
    .fetch_one(database.pool())
    .await
    .expect("count slot rows");
    assert_eq!(slot_rows, 1);

    database.shutdown().await;
}

#[tokio::test]
async fn parallel_retries_for_same_operation_do_not_create_duplicate_mutation_ids() {
    let database = mysql::TestDatabase::new(DELIVERY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).expect("schedule id");
    let service_a = DeliveryService::new(database.pool().clone());
    let service_b = DeliveryService::new(database.pool().clone());
    let session = service_a
        .bootstrap(
            schedule_id,
            StudentBootstrapRequest {
                student_key: student_key(schedule_id, "alice"),
                candidate_id: "alice".to_owned(),
                candidate_name: "Alice Roe".to_owned(),
                candidate_email: "alice@example.com".to_owned(),
                email: Some("alice@example.com".to_owned()),
                wcode: Some("W123456".to_owned()),
                client_session_id: Uuid::new_v4().to_string(),
            },
        )
        .await
        .expect("bootstrap attempt");
    let attempt = session.attempt.expect("attempt");
    let attempt_id = attempt.id.clone();
    let student_key = student_key(schedule_id, "alice");
    let client_session_id = Uuid::new_v4().to_string();

    let req = StudentMutationBatchRequest {
        attempt_id: attempt_id.clone(),
        student_key: student_key.clone(),
        client_session_id: client_session_id.clone(),
        mutations: vec![MutationEnvelope {
            id: "parallel-dup-1".to_owned(),
            seq: 1,
            timestamp: Utc.with_ymd_and_hms(2026, 1, 10, 9, 40, 0).unwrap(),
            command: command(
                MutationType::SetScalar,
                json!({
                    "baseRevision": 0,
                    "questionId": "q1",
                    "value": "ALPHA",
                }),
            ),
            base_revision: None,
        }],
    };

    let (left, right) = tokio::join!(
        service_a.apply_mutation_batch(
            schedule_id,
            req.clone(),
            MutationBatchResponseMode::Full,
            None
        ),
        service_b.apply_mutation_batch(schedule_id, req, MutationBatchResponseMode::Full, None)
    );
    assert!(left.is_ok(), "left retry should succeed");
    assert!(right.is_ok(), "right retry should succeed");

    let duplicate_id_groups: i64 = sqlx::query_scalar(
        r#"
        SELECT COUNT(*)
        FROM (
            SELECT client_mutation_id
            FROM student_attempt_mutations
            WHERE attempt_id = ?
            GROUP BY client_mutation_id
            HAVING COUNT(*) > 1
        ) dup
        "#,
    )
    .bind(&attempt_id)
    .fetch_one(database.pool())
    .await
    .expect("check duplicate mutation ids");
    assert_eq!(duplicate_id_groups, 0);

    database.shutdown().await;
}

#[tokio::test]
async fn bootstrap_is_idempotent_under_concurrent_race_for_same_student() {
    let database = mysql::TestDatabase::new(DELIVERY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).expect("schedule id");
    let service_a = DeliveryService::new(database.pool().clone());
    let service_b = DeliveryService::new(database.pool().clone());

    let req = StudentBootstrapRequest {
        student_key: student_key(schedule_id, "alice"),
        candidate_id: "alice".to_owned(),
        candidate_name: "Alice Roe".to_owned(),
        candidate_email: "alice@example.com".to_owned(),
        email: Some("alice@example.com".to_owned()),
        wcode: Some("W123456".to_owned()),
        client_session_id: Uuid::new_v4().to_string(),
    };

    let (left, right) = tokio::join!(
        service_a.bootstrap(schedule_id, req.clone()),
        service_b.bootstrap(schedule_id, req)
    );
    let left_attempt_id = left
        .expect("left bootstrap")
        .attempt
        .expect("left attempt")
        .id;
    let right_attempt_id = right
        .expect("right bootstrap")
        .attempt
        .expect("right attempt")
        .id;

    assert_eq!(left_attempt_id, right_attempt_id);

    let attempt_count: i64 = query_scalar(
        "SELECT COUNT(*) FROM student_attempts WHERE schedule_id = ? AND student_key = ?",
    )
    .bind(schedule_id.to_string())
    .bind(student_key(schedule_id, "alice"))
    .fetch_one(database.pool())
    .await
    .expect("count attempt rows");
    assert_eq!(attempt_count, 1);

    database.shutdown().await;
}

#[tokio::test]
async fn mutation_batch_does_not_require_a_second_pool_connection() {
    let database = mysql::TestDatabase::new(ACT_DELIVERY_MIGRATIONS).await;
    let schedule = seed_act_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).expect("schedule id");
    SchedulingService::new(database.pool().clone())
        .apply_runtime_command(
            &ActorContext::new(Uuid::new_v4().to_string(), ActorRole::Admin),
            schedule_id,
            RuntimeCommandRequest {
                action: RuntimeCommandAction::StartRuntime,
                reason: Some("single connection regression".to_owned()),
            },
        )
        .await
        .expect("start ACT runtime");
    let client_session_id = Uuid::new_v4().to_string();
    let student_key = student_key(schedule_id, "single-connection");
    let bootstrap = DeliveryService::new(database.pool().clone())
        .bootstrap(
            schedule_id,
            StudentBootstrapRequest {
                student_key: student_key.clone(),
                candidate_id: "single-connection".to_owned(),
                candidate_name: "Single Connection Roe".to_owned(),
                candidate_email: "single-connection@example.com".to_owned(),
                email: Some("single-connection@example.com".to_owned()),
                wcode: Some("W123457".to_owned()),
                client_session_id: client_session_id.clone(),
            },
        )
        .await
        .expect("bootstrap attempt");
    let attempt_id = bootstrap.attempt.expect("attempt").id;

    let restricted_pool = MySqlPoolOptions::new()
        .max_connections(1)
        .acquire_timeout(std::time::Duration::from_millis(250))
        .connect(&database.database_url())
        .await
        .expect("connect to restricted test pool");
    let result = DeliveryService::new(restricted_pool.clone())
        .apply_mutation_batch(
            schedule_id,
            StudentMutationBatchRequest {
                attempt_id: attempt_id.clone(),
                student_key: student_key.clone(),
                client_session_id: client_session_id.clone(),
                mutations: vec![MutationEnvelope {
                    id: "single-connection-mutation".to_owned(),
                    seq: 1,
                    timestamp: Utc.with_ymd_and_hms(2026, 1, 10, 9, 10, 0).unwrap(),
                    command: command(
                        MutationType::Answer,
                        json!({"questionId": "q1", "value": "a"}),
                    ),
                    base_revision: None,
                }],
            },
            MutationBatchResponseMode::Full,
            None,
        )
        .await;

    let mutation = result.expect("mutation must succeed with one available pool connection");
    let submit_result = DeliveryService::new(restricted_pool.clone())
        .submit_attempt(
            schedule_id,
            StudentSubmitRequest {
                attempt_id,
                student_key,
                last_seen_revision: Some(mutation.attempt.as_ref().expect("attempt").revision),
                submission_id: Some("single-connection-submit".to_owned()),
                client_session_id: Some(client_session_id),
                client_final_seq: Some(1),
                server_accepted_through_seq: Some(1),
                final_answer_patch: None,
                final_client_snapshot_hash: None,
                answers: None,
                writing_answers: None,
                flags: None,
            },
            None,
        )
        .await;

    restricted_pool.close().await;
    database.shutdown().await;

    assert_eq!(mutation.server_accepted_through_seq, 1);
    assert_eq!(
        mutation.attempt.expect("full mutation response").answers["q1"],
        "a"
    );
    assert!(
        submit_result.is_ok(),
        "submit must succeed with one available pool connection"
    );
}

async fn seed_act_schedule(pool: &sqlx::MySqlPool) -> ielts_backend_domain::schedule::ExamSchedule {
    let actor = ActorContext::new(Uuid::new_v4().to_string(), ActorRole::Admin);
    let builder_service = BuilderService::new(pool.clone());
    let exam = builder_service
        .create_exam(
            &actor,
            CreateExamRequest {
                slug: "act-single-connection-mutation".to_owned(),
                title: "ACT Single Connection Mutation".to_owned(),
                exam_type: ExamType::Act.as_str().to_owned(),
                visibility: Visibility::Organization.as_str().to_owned(),
                organization_id: Some("org-1".to_owned()),
            },
        )
        .await
        .expect("seed ACT exam");

    builder_service
        .save_draft(
            &actor,
            exam.id.clone(),
            SaveDraftRequest {
                content_snapshot: json!({
                    "science": {
                        "stimuli": [{
                            "id": "act-stimulus-1",
                            "title": "ACT Science Stimulus",
                            "content": "A science passage.",
                            "blocks": [{
                                "id": "act-block-1",
                                "type": "SINGLE_MCQ",
                                "instruction": "Choose one answer.",
                                "questions": [{
                                    "id": "q1",
                                    "stem": "Which answer is correct?",
                                    "skillCategory": "interpretation_of_data",
                                    "options": [
                                        {"id": "a", "text": "Answer A", "isCorrect": true},
                                        {"id": "b", "text": "Answer B", "isCorrect": false},
                                        {"id": "c", "text": "Answer C", "isCorrect": false},
                                        {"id": "d", "text": "Answer D", "isCorrect": false}
                                    ]
                                }]
                            }]
                        }]
                    }
                }),
                config_snapshot: json!({
                    "general": {"type": "ACT"},
                    "progression": {"allowPause": false},
                    "scoring": {"mode": "raw_percent", "percentageDecimals": 2},
                    "sections": {
                        "science": {
                            "enabled": true,
                            "label": "Science",
                            "order": 1,
                            "duration": 40,
                            "allowPause": false,
                            "questionCount": 1
                        }
                    }
                }),
                revision: exam.revision,
            },
        )
        .await
        .expect("save ACT draft");

    let exam_after_draft = builder_service
        .get_exam(&actor, exam.id.clone())
        .await
        .expect("get ACT exam after draft");
    let published_version = builder_service
        .publish_exam(
            &actor,
            exam.id.clone(),
            PublishExamRequest {
                publish_notes: Some("single connection regression".to_owned()),
                revision: exam_after_draft.revision,
            },
        )
        .await
        .expect("publish ACT exam");

    SchedulingService::new(pool.clone())
        .create_schedule(
            &actor,
            CreateScheduleRequest {
                exam_id: exam.id,
                published_version_id: published_version.id,
                cohort_name: "ACT Single Connection Cohort".to_owned(),
                proctor_display_name: "ACT Proctor".to_owned(),
                grading_display_name: "ACT Grader".to_owned(),
                institution: Some("ACT Test Centre".to_owned()),
                start_time: Utc.with_ymd_and_hms(2026, 1, 10, 9, 0, 0).unwrap(),
                end_time: Utc.with_ymd_and_hms(2026, 1, 10, 12, 0, 0).unwrap(),
                auto_start: false,
                auto_stop: false,
            },
        )
        .await
        .expect("create ACT schedule")
}

async fn seed_schedule(pool: &sqlx::MySqlPool) -> ielts_backend_domain::schedule::ExamSchedule {
    let actor = ActorContext::new(Uuid::new_v4().to_string(), ActorRole::Admin);
    let builder_service = BuilderService::new(pool.clone());
    let exam = builder_service
        .create_exam(
            &actor,
            CreateExamRequest {
                slug: "cambridge-19-academic-mutation".to_owned(),
                title: "Cambridge 19 Academic Mutation".to_owned(),
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
                    "reading": {
                        "passages": [
                            {
                                "id": "reading-1",
                                "blocks": [
                                    {
                                        "id": "reading-block-1",
                                        "type": "SHORT_ANSWER",
                                        "questions": [
                                            {"id": "q1", "prompt": "Q1"},
                                            {"id": "q2", "prompt": "Q2"}
                                        ]
                                    },
                                    {
                                        "id": "reading-block-slot",
                                        "type": "SENTENCE_COMPLETION",
                                        "questions": [
                                            {
                                                "id": "q-slot-1",
                                                "blanks": [{"id": "b1"}, {"id": "b2"}]
                                            }
                                        ]
                                    }
                                ]
                            }
                        ]
                    },
                    "listening": {"parts": [{"id": "listening-1"}]},
                    "writing": {"tasks": [{"id": "writing-1"}]},
                    "speaking": {"part1Topics": ["topic"], "cueCard": "cue", "part3Discussion": ["discussion"]}
                }),
                config_snapshot: json!({
                    "sections": {
                        "listening": {"enabled": true, "label": "Listening", "order": 1, "duration": 30, "gapAfterMinutes": 5},
                        "reading": {"enabled": true, "label": "Reading", "order": 2, "duration": 60, "gapAfterMinutes": 0},
                        "writing": {"enabled": true, "label": "Writing", "order": 3, "duration": 60, "gapAfterMinutes": 10},
                        "speaking": {"enabled": true, "label": "Speaking", "order": 4, "duration": 15, "gapAfterMinutes": 0}
                    }
                }),
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
                publish_notes: Some("ready for mutation replay".to_owned()),
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
                cohort_name: "Mutation Replay Cohort".to_owned(),
                proctor_display_name: exam.title.clone(),
                grading_display_name: exam.title.clone(),
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

fn student_key(schedule_id: Uuid, candidate_id: &str) -> String {
    format!("student-{schedule_id}-{candidate_id}")
}
