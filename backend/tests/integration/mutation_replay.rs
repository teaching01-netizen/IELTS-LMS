#[path = "../support/mysql.rs"]
mod mysql;

use chrono::{Duration, TimeZone, Utc};
use serde_json::json;
use sqlx::query_scalar;
use uuid::Uuid;

use ielts_backend_application::{
    builder::BuilderService,
    delivery::{DeliveryConflictReason, DeliveryError, DeliveryService, MutationBatchResponseMode},
    proctoring::ProctoringService,
    scheduling::SchedulingService,
};
use ielts_backend_domain::{
    attempt::{
        MutationCommand, MutationEnvelope, MutationType, StudentBootstrapRequest,
        StudentMutationBatchRequest, StudentMutationResultStatus, StudentSubmitRequest,
    },
    exam::{CreateExamRequest, ExamType, PublishExamRequest, SaveDraftRequest, Visibility},
    schedule::{
        AttemptCommandRequest, CreateScheduleRequest, RuntimeCommandAction, RuntimeCommandRequest,
    },
};
use ielts_backend_infrastructure::actor_context::{ActorContext, ActorRole};

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
    "0031_grading_export_profiles.sql",
    "0032_provider_neutral_sat.sql",
    "0033_sat_runtime_authoring_hardening.sql",
    "0034_assessment_access_links.sql",
    "0035_autosave_durability_hardening.sql",
    "0036_question_revision_updated_by.sql",
    "0037_runtime_timing_model.sql",
    "0038_sat_section_timing_model.sql",
    "0039_schedule_provider_identity.sql",
    "0043_attempt_terminalizations.sql",
];

fn command(mutation_type: MutationType, payload: serde_json::Value) -> MutationCommand {
    serde_json::from_value(json!({
        "mutationType": mutation_type.as_str(),
        "payload": payload
    }))
    .expect("valid mutation command")
}

#[tokio::test]
async fn deadline_is_a_write_fence_but_duplicate_replay_remains_idempotent() {
    let database = mysql::TestDatabase::new(DELIVERY_MIGRATIONS).await;
    let pool = database.pool().clone();
    let schedule = seed_schedule(&pool).await;
    let schedule_id = Uuid::parse_str(&schedule.id).expect("schedule id");
    let actor = ActorContext::new(Uuid::new_v4().to_string(), ActorRole::Admin);
    SchedulingService::new(pool.clone())
        .apply_runtime_command(
            &actor,
            schedule_id,
            RuntimeCommandRequest {
                action: RuntimeCommandAction::StartRuntime,
                reason: None,
            },
        )
        .await
        .expect("start runtime");

    let service = DeliveryService::new(pool.clone());
    let client_session_id = Uuid::new_v4().to_string();
    let session = service
        .bootstrap(
            &ActorContext::new(Uuid::new_v4().to_string(), ActorRole::Admin),
            schedule_id,
            StudentBootstrapRequest {
                student_key: student_key(schedule_id, "deadline"),
                candidate_id: "deadline".to_owned(),
                candidate_name: "Deadline Student".to_owned(),
                candidate_email: "deadline@example.com".to_owned(),
                email: Some("deadline@example.com".to_owned()),
                wcode: Some("W654321".to_owned()),
                client_session_id: client_session_id.clone(),
            },
        )
        .await
        .expect("bootstrap attempt");
    let attempt = session.attempt.expect("attempt");

    let accepted = MutationEnvelope {
        id: "deadline-m1".to_owned(),
        seq: 1,
        timestamp: Utc::now(),
        command: command(
            MutationType::Answer,
            json!({"questionId": "l1", "value": "answer"}),
        ),
        base_revision: None,
    };
    service
        .apply_mutation_batch(
            schedule_id,
            StudentMutationBatchRequest {
                attempt_id: attempt.id.clone(),
                student_key: attempt.student_key.clone(),
                client_session_id: client_session_id.clone(),
                mutations: vec![accepted.clone()],
            },
            MutationBatchResponseMode::Full,
            None,
        )
        .await
        .expect("pre-deadline answer accepted");

    sqlx::query(
        r#"
        UPDATE exam_session_runtime_sections rs
        JOIN exam_session_runtimes r ON r.id = rs.runtime_id
        SET rs.actual_start_at = UTC_TIMESTAMP(6) - INTERVAL 31 MINUTE
        WHERE r.schedule_id = ? AND rs.section_key = r.current_section_key
        "#,
    )
    .bind(schedule_id.to_string())
    .execute(&pool)
    .await
    .expect("expire current section without running reconciler");

    let duplicate = service
        .apply_mutation_batch(
            schedule_id,
            StudentMutationBatchRequest {
                attempt_id: attempt.id.clone(),
                student_key: attempt.student_key.clone(),
                client_session_id: client_session_id.clone(),
                mutations: vec![accepted],
            },
            MutationBatchResponseMode::Full,
            None,
        )
        .await
        .expect("already accepted mutation remains replayable after deadline");
    assert_eq!(duplicate.applied_mutation_count, 0);
    assert_eq!(
        duplicate.mutation_results[0].status,
        StudentMutationResultStatus::Duplicate
    );

    let late = service
        .apply_mutation_batch(
            schedule_id,
            StudentMutationBatchRequest {
                attempt_id: attempt.id.clone(),
                student_key: attempt.student_key.clone(),
                client_session_id,
                mutations: vec![MutationEnvelope {
                    id: "deadline-m2".to_owned(),
                    seq: 2,
                    timestamp: Utc::now(),
                    command: command(
                        MutationType::Answer,
                        json!({"questionId": "l1", "value": "late"}),
                    ),
                    base_revision: None,
                }],
            },
            MutationBatchResponseMode::Full,
            None,
        )
        .await
        .expect_err("new answer after the authoritative deadline must fail");
    assert_eq!(late.conflict_reason_code(), Some("DEADLINE_EXPIRED"));

    let stored: serde_json::Value =
        sqlx::query_scalar("SELECT answers FROM student_attempts WHERE id = ?")
            .bind(&attempt.id)
            .fetch_one(&pool)
            .await
            .expect("read canonical answers");
    assert_eq!(stored["l1"], "answer");
    let late_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM student_attempt_mutations WHERE attempt_id = ? AND client_mutation_id = 'deadline-m2'",
    )
    .bind(&attempt.id)
    .fetch_one(&pool)
    .await
    .expect("count late mutation rows");
    assert_eq!(late_count, 0);

    database.shutdown().await;
}

#[tokio::test]
async fn mutation_batches_use_server_canonical_sequence_even_when_client_sequence_overlaps() {
    let database = mysql::TestDatabase::new(DELIVERY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).expect("schedule id");
    start_live_runtime(database.pool(), schedule_id).await;
    let service = DeliveryService::new(database.pool().clone());
    let session = service
        .bootstrap(
            &ActorContext::new(Uuid::new_v4().to_string(), ActorRole::Admin),
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
                            MutationType::Answer,
                            json!({"questionId": "q2", "value": "B"}),
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
    assert_eq!(first_attempt.answers["q2"], "B");

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
        .await
        .expect("server assigns canonical sequence");

    assert_eq!(overlap.server_accepted_through_seq, 5);
    assert_eq!(overlap.mutation_results.len(), 1);
    assert_eq!(overlap.mutation_results[0].server_seq, 5);
    assert_eq!(overlap.attempt.expect("attempt").answers["q1"], "C");

    let stored_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM student_attempt_mutations WHERE attempt_id = ?")
            .bind(attempt_id)
            .fetch_one(database.pool())
            .await
            .unwrap();
    assert_eq!(stored_count, 5);

    database.shutdown().await;
}

#[tokio::test]
async fn operation_mutations_ignore_legacy_base_revision_and_preserve_other_fields() {
    let database = mysql::TestDatabase::new(DELIVERY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).expect("schedule id");
    start_live_runtime(database.pool(), schedule_id).await;
    let service = DeliveryService::new(database.pool().clone());
    let session = service
        .bootstrap(
            &ActorContext::new(Uuid::new_v4().to_string(), ActorRole::Admin),
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

    let legacy_revision_write = service
        .apply_mutation_batch(
            schedule_id,
            StudentMutationBatchRequest {
                attempt_id: attempt_id.clone(),
                student_key: student_key.clone(),
                client_session_id: client_session_id.clone(),
                mutations: vec![MutationEnvelope {
                    id: "op-legacy-revision".to_owned(),
                    seq: 2,
                    timestamp: Utc.with_ymd_and_hms(2026, 1, 10, 9, 10, 5).unwrap(),
                    command: command(
                        MutationType::SetScalar,
                        json!({
                            "baseRevision": 0,
                            "questionId": "q1",
                            "value": "UPDATED",
                        }),
                    ),
                    base_revision: None,
                }],
            },
            MutationBatchResponseMode::Full,
            None,
        )
        .await
        .expect("legacy baseRevision is not a student-write concurrency oracle");
    assert_eq!(legacy_revision_write.server_accepted_through_seq, 2);
    assert_eq!(
        legacy_revision_write.attempt.expect("attempt").answers["q1"],
        "UPDATED"
    );

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
    assert_eq!(second_attempt.answers["q1"], "UPDATED");
    assert_eq!(second_attempt.answers["q2"], "BRAVO");
    let stored_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM student_attempt_mutations WHERE attempt_id = ?")
            .bind(&attempt_id)
            .fetch_one(database.pool())
            .await
            .expect("count persisted mutation rows");
    assert_eq!(stored_count, 3);

    database.shutdown().await;
}

#[tokio::test]
async fn operation_mutations_with_idempotency_key_are_deterministic_and_do_not_duplicate_rows() {
    let database = mysql::TestDatabase::new(DELIVERY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).expect("schedule id");
    start_live_runtime(database.pool(), schedule_id).await;
    let service = DeliveryService::new(database.pool().clone());
    let session = service
        .bootstrap(
            &ActorContext::new(Uuid::new_v4().to_string(), ActorRole::Admin),
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
    start_live_runtime(database.pool(), schedule_id).await;
    let service = DeliveryService::new(database.pool().clone());
    let session = service
        .bootstrap(
            &ActorContext::new(Uuid::new_v4().to_string(), ActorRole::Admin),
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
            &ActorContext::new(Uuid::new_v4().to_string(), ActorRole::Admin),
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
    sqlx::query("UPDATE student_attempts SET phase = 'exam' WHERE id = ?")
        .bind(&attempt.id)
        .execute(database.pool())
        .await
        .expect("move attempt into exam phase");
    sqlx::query(
        r#"INSERT INTO exam_session_runtimes (
            id, schedule_id, exam_id, provider_key, status, plan_snapshot, actual_start_at,
            active_section_key, current_section_key, current_section_remaining_seconds
        ) VALUES (?, ?, ?, 'ielts', 'live', JSON_OBJECT(), NOW(), 'reading', 'reading', 3600)"#,
    )
    .bind(Uuid::new_v4().to_string())
    .bind(schedule.id.clone())
    .bind(schedule.exam_id.clone())
    .execute(database.pool())
    .await
    .expect("start exam runtime");

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
    start_live_runtime(database.pool(), schedule_id).await;
    let service = DeliveryService::new(database.pool().clone());
    let session = service
        .bootstrap(
            &ActorContext::new(Uuid::new_v4().to_string(), ActorRole::Admin),
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
    let answers: serde_json::Value =
        query_scalar("SELECT answers FROM student_attempts WHERE id = ?")
            .bind(&attempt_id)
            .fetch_one(database.pool())
            .await
            .expect("load materialized answers");
    assert_eq!(answers["q-slot-1"][1], "second-value");

    database.shutdown().await;
}

#[tokio::test]
async fn mutation_id_replay_after_session_takeover_is_exactly_once() {
    let database = mysql::TestDatabase::new(DELIVERY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).expect("schedule id");
    start_live_runtime(database.pool(), schedule_id).await;
    let service = DeliveryService::new(database.pool().clone());
    let session = service
        .bootstrap(
            &ActorContext::new(Uuid::new_v4().to_string(), ActorRole::Admin),
            schedule_id,
            StudentBootstrapRequest {
                student_key: student_key(schedule_id, "alice"),
                candidate_id: "alice".to_owned(),
                candidate_name: "Alice Roe".to_owned(),
                candidate_email: "alice@example.com".to_owned(),
                email: Some("alice@example.com".to_owned()),
                wcode: Some("W123456".to_owned()),
                client_session_id: "session-a".to_owned(),
            },
        )
        .await
        .expect("bootstrap attempt");
    let attempt_id = session.attempt.expect("attempt").id;
    let student_key = student_key(schedule_id, "alice");

    sqlx::query("UPDATE student_attempts SET active_client_session_id = ? WHERE id = ?")
        .bind("session-a")
        .bind(&attempt_id)
        .execute(database.pool())
        .await
        .expect("claim first writer");

    let mutation = MutationEnvelope {
        id: "takeover-replay-1".to_owned(),
        seq: 1,
        timestamp: Utc.with_ymd_and_hms(2026, 1, 10, 9, 35, 0).unwrap(),
        command: command(
            MutationType::Answer,
            json!({"questionId": "q1", "value": "A"}),
        ),
        base_revision: None,
    };
    service
        .apply_mutation_batch(
            schedule_id,
            StudentMutationBatchRequest {
                attempt_id: attempt_id.clone(),
                student_key: student_key.clone(),
                client_session_id: "session-a".to_owned(),
                mutations: vec![mutation.clone()],
            },
            MutationBatchResponseMode::Full,
            None,
        )
        .await
        .expect("first write");

    sqlx::query("UPDATE student_attempts SET active_client_session_id = ? WHERE id = ?")
        .bind("session-b")
        .bind(&attempt_id)
        .execute(database.pool())
        .await
        .expect("take over writer");

    let replay = service
        .apply_mutation_batch(
            schedule_id,
            StudentMutationBatchRequest {
                attempt_id: attempt_id.clone(),
                student_key,
                client_session_id: "session-b".to_owned(),
                mutations: vec![mutation],
            },
            MutationBatchResponseMode::Full,
            None,
        )
        .await
        .expect("same mutation must replay cleanly");

    assert_eq!(replay.applied_mutation_count, 0);
    assert_eq!(replay.mutation_results.len(), 1);
    assert_eq!(
        replay.mutation_results[0].status,
        StudentMutationResultStatus::Duplicate
    );
    assert_eq!(replay.mutation_results[0].server_seq, 1);
    let row_count: i64 = query_scalar(
        "SELECT COUNT(*) FROM student_attempt_mutations WHERE attempt_id = ? AND client_mutation_id = ?",
    )
    .bind(&attempt_id)
    .bind("takeover-replay-1")
    .fetch_one(database.pool())
    .await
    .expect("count mutation identity");
    assert_eq!(row_count, 1);
    let answers: serde_json::Value =
        query_scalar("SELECT answers FROM student_attempts WHERE id = ?")
            .bind(&attempt_id)
            .fetch_one(database.pool())
            .await
            .expect("load answers");
    assert_eq!(answers["q1"], "A");

    database.shutdown().await;
}

#[tokio::test]
async fn mutation_id_reuse_with_different_payload_is_rejected_without_mutation() {
    let database = mysql::TestDatabase::new(DELIVERY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).expect("schedule id");
    start_live_runtime(database.pool(), schedule_id).await;
    let service = DeliveryService::new(database.pool().clone());
    let session = service
        .bootstrap(
            &ActorContext::new(Uuid::new_v4().to_string(), ActorRole::Admin),
            schedule_id,
            StudentBootstrapRequest {
                student_key: student_key(schedule_id, "alice"),
                candidate_id: "alice".to_owned(),
                candidate_name: "Alice Roe".to_owned(),
                candidate_email: "alice@example.com".to_owned(),
                email: Some("alice@example.com".to_owned()),
                wcode: Some("W123456".to_owned()),
                client_session_id: "session-a".to_owned(),
            },
        )
        .await
        .expect("bootstrap attempt");
    let attempt_id = session.attempt.expect("attempt").id;
    let student_key = student_key(schedule_id, "alice");
    sqlx::query("UPDATE student_attempts SET active_client_session_id = ? WHERE id = ?")
        .bind("session-a")
        .bind(&attempt_id)
        .execute(database.pool())
        .await
        .expect("claim writer");

    service
        .apply_mutation_batch(
            schedule_id,
            StudentMutationBatchRequest {
                attempt_id: attempt_id.clone(),
                student_key: student_key.clone(),
                client_session_id: "session-a".to_owned(),
                mutations: vec![MutationEnvelope {
                    id: "reused-id-1".to_owned(),
                    seq: 1,
                    timestamp: Utc.with_ymd_and_hms(2026, 1, 10, 9, 36, 0).unwrap(),
                    command: command(
                        MutationType::Answer,
                        json!({"questionId": "q1", "value": "A"}),
                    ),
                    base_revision: None,
                }],
            },
            MutationBatchResponseMode::Full,
            None,
        )
        .await
        .expect("first write");

    sqlx::query("UPDATE student_attempts SET active_client_session_id = ? WHERE id = ?")
        .bind("session-b")
        .bind(&attempt_id)
        .execute(database.pool())
        .await
        .expect("take over writer");
    let error = service
        .apply_mutation_batch(
            schedule_id,
            StudentMutationBatchRequest {
                attempt_id: attempt_id.clone(),
                student_key,
                client_session_id: "session-b".to_owned(),
                mutations: vec![MutationEnvelope {
                    id: "reused-id-1".to_owned(),
                    seq: 2,
                    timestamp: Utc.with_ymd_and_hms(2026, 1, 10, 9, 36, 5).unwrap(),
                    command: command(
                        MutationType::Answer,
                        json!({"questionId": "q1", "value": "B"}),
                    ),
                    base_revision: None,
                }],
            },
            MutationBatchResponseMode::Full,
            None,
        )
        .await
        .expect_err("same mutation id with different contents must fail");
    match error {
        DeliveryError::Validation(message) => assert!(message.contains("different contents")),
        other => panic!("expected validation error, got {other:?}"),
    }

    let row_count: i64 = query_scalar(
        "SELECT COUNT(*) FROM student_attempt_mutations WHERE attempt_id = ? AND client_mutation_id = ?",
    )
    .bind(&attempt_id)
    .bind("reused-id-1")
    .fetch_one(database.pool())
    .await
    .expect("count mutation identity");
    assert_eq!(row_count, 1);
    let answers: serde_json::Value =
        query_scalar("SELECT answers FROM student_attempts WHERE id = ?")
            .bind(&attempt_id)
            .fetch_one(database.pool())
            .await
            .expect("load answers");
    assert_eq!(answers["q1"], "A");

    database.shutdown().await;
}

#[tokio::test]
async fn stale_writer_is_fenced_before_any_ledger_or_answer_mutation() {
    let database = mysql::TestDatabase::new(DELIVERY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).expect("schedule id");
    let service = DeliveryService::new(database.pool().clone());
    let session = service
        .bootstrap(
            &ActorContext::new(Uuid::new_v4().to_string(), ActorRole::Admin),
            schedule_id,
            StudentBootstrapRequest {
                student_key: student_key(schedule_id, "alice"),
                candidate_id: "alice".to_owned(),
                candidate_name: "Alice Roe".to_owned(),
                candidate_email: "alice@example.com".to_owned(),
                email: Some("alice@example.com".to_owned()),
                wcode: Some("W123456".to_owned()),
                client_session_id: "session-current".to_owned(),
            },
        )
        .await
        .expect("bootstrap attempt");
    let attempt_id = session.attempt.expect("attempt").id;
    sqlx::query("UPDATE student_attempts SET active_client_session_id = ? WHERE id = ?")
        .bind("session-current")
        .bind(&attempt_id)
        .execute(database.pool())
        .await
        .expect("claim current writer");

    let error = service
        .apply_mutation_batch(
            schedule_id,
            StudentMutationBatchRequest {
                attempt_id: attempt_id.clone(),
                student_key: student_key(schedule_id, "alice"),
                client_session_id: "session-stale".to_owned(),
                mutations: vec![MutationEnvelope {
                    id: "stale-writer-1".to_owned(),
                    seq: 1,
                    timestamp: Utc.with_ymd_and_hms(2026, 1, 10, 9, 37, 0).unwrap(),
                    command: command(
                        MutationType::Answer,
                        json!({"questionId": "q1", "value": "SHOULD-NOT-APPLY"}),
                    ),
                    base_revision: None,
                }],
            },
            MutationBatchResponseMode::Full,
            None,
        )
        .await
        .expect_err("stale writer must be fenced");
    match error {
        DeliveryError::Conflict {
            reason: Some(reason),
            ..
        } => assert_eq!(reason, DeliveryConflictReason::ActiveSessionSuperseded),
        other => panic!("expected active-session conflict, got {other:?}"),
    }

    let row_count: i64 =
        query_scalar("SELECT COUNT(*) FROM student_attempt_mutations WHERE attempt_id = ?")
            .bind(&attempt_id)
            .fetch_one(database.pool())
            .await
            .expect("count mutation rows");
    assert_eq!(row_count, 0);
    let answers: serde_json::Value =
        query_scalar("SELECT answers FROM student_attempts WHERE id = ?")
            .bind(&attempt_id)
            .fetch_one(database.pool())
            .await
            .expect("load answers");
    assert!(answers.get("q1").is_none());

    database.shutdown().await;
}

#[tokio::test]
async fn mixed_duplicate_and_new_batch_returns_ordered_explicit_acknowledgements() {
    let database = mysql::TestDatabase::new(DELIVERY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).expect("schedule id");
    start_live_runtime(database.pool(), schedule_id).await;
    let service = DeliveryService::new(database.pool().clone());
    let session = service
        .bootstrap(
            &ActorContext::new(Uuid::new_v4().to_string(), ActorRole::Admin),
            schedule_id,
            StudentBootstrapRequest {
                student_key: student_key(schedule_id, "alice"),
                candidate_id: "alice".to_owned(),
                candidate_name: "Alice Roe".to_owned(),
                candidate_email: "alice@example.com".to_owned(),
                email: Some("alice@example.com".to_owned()),
                wcode: Some("W123456".to_owned()),
                client_session_id: "session-a".to_owned(),
            },
        )
        .await
        .expect("bootstrap attempt");
    let attempt_id = session.attempt.expect("attempt").id;
    let student_key = student_key(schedule_id, "alice");
    sqlx::query("UPDATE student_attempts SET active_client_session_id = ? WHERE id = ?")
        .bind("session-a")
        .bind(&attempt_id)
        .execute(database.pool())
        .await
        .expect("claim writer");

    let first = MutationEnvelope {
        id: "ordered-ack-1".to_owned(),
        seq: 1,
        timestamp: Utc.with_ymd_and_hms(2026, 1, 10, 9, 38, 0).unwrap(),
        command: command(
            MutationType::Answer,
            json!({"questionId": "q1", "value": "A"}),
        ),
        base_revision: None,
    };
    service
        .apply_mutation_batch(
            schedule_id,
            StudentMutationBatchRequest {
                attempt_id: attempt_id.clone(),
                student_key: student_key.clone(),
                client_session_id: "session-a".to_owned(),
                mutations: vec![first.clone()],
            },
            MutationBatchResponseMode::Full,
            None,
        )
        .await
        .expect("seed first mutation");

    let response = service
        .apply_mutation_batch(
            schedule_id,
            StudentMutationBatchRequest {
                attempt_id: attempt_id.clone(),
                student_key,
                client_session_id: "session-a".to_owned(),
                mutations: vec![
                    first,
                    MutationEnvelope {
                        id: "ordered-ack-2".to_owned(),
                        seq: 2,
                        timestamp: Utc.with_ymd_and_hms(2026, 1, 10, 9, 38, 5).unwrap(),
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
        .expect("mixed replay/new batch");

    assert_eq!(response.applied_mutation_count, 1);
    assert_eq!(response.server_accepted_through_seq, 2);
    assert_eq!(response.mutation_results.len(), 2);
    assert_eq!(response.mutation_results[0].mutation_id, "ordered-ack-1");
    assert_eq!(
        response.mutation_results[0].status,
        StudentMutationResultStatus::Duplicate
    );
    assert_eq!(response.mutation_results[0].server_seq, 1);
    assert_eq!(response.mutation_results[1].mutation_id, "ordered-ack-2");
    assert_eq!(
        response.mutation_results[1].status,
        StudentMutationResultStatus::Applied
    );
    assert_eq!(response.mutation_results[1].server_seq, 2);
    let row_count: i64 =
        query_scalar("SELECT COUNT(*) FROM student_attempt_mutations WHERE attempt_id = ?")
            .bind(&attempt_id)
            .fetch_one(database.pool())
            .await
            .expect("count ledger rows");
    assert_eq!(row_count, 2);

    database.shutdown().await;
}

#[tokio::test]
async fn parallel_retries_for_same_operation_do_not_create_duplicate_mutation_ids() {
    let database = mysql::TestDatabase::new(DELIVERY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).expect("schedule id");
    start_live_runtime(database.pool(), schedule_id).await;
    let service_a = DeliveryService::new(database.pool().clone());
    let service_b = DeliveryService::new(database.pool().clone());
    let session = service_a
        .bootstrap(
            &ActorContext::new(Uuid::new_v4().to_string(), ActorRole::Admin),
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
    let actor = ActorContext::new(Uuid::new_v4().to_string(), ActorRole::Admin);

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
        service_a.bootstrap(&actor, schedule_id, req.clone()),
        service_b.bootstrap(&actor, schedule_id, req)
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

async fn start_live_runtime(pool: &sqlx::MySqlPool, schedule_id: Uuid) {
    let actor = ActorContext::new(Uuid::new_v4().to_string(), ActorRole::Admin);
    SchedulingService::new(pool.clone())
        .apply_runtime_command(
            &actor,
            schedule_id,
            RuntimeCommandRequest {
                action: RuntimeCommandAction::StartRuntime,
                reason: None,
            },
        )
        .await
        .expect("start live mutation-test runtime");
    ProctoringService::new(pool.clone())
        .end_section_now(
            &actor,
            schedule_id,
            AttemptCommandRequest {
                message: None,
                reason: Some("advance mutation fixture to reading".to_owned()),
                expected_active_section_key: Some("listening".to_owned()),
                expected_runtime_revision: None,
            },
        )
        .await
        .expect("advance mutation-test runtime to reading");
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
                provider_key: None,
                provider_exam_type: None,
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
                        "passages": [{
                            "id": "reading-1",
                            "title": "Reading Passage 1",
                            "blocks": [
                                {
                                    "id": "reading-block-1",
                                    "type": "SHORT_ANSWER",
                                    "questions": [
                                        {"id": "q1", "prompt": "Q1", "correctAnswer": "A"},
                                        {"id": "q2", "prompt": "Q2", "correctAnswer": "B"}
                                    ]
                                },
                                {
                                    "id": "reading-block-slot",
                                    "type": "SENTENCE_COMPLETION",
                                    "questions": [{
                                        "id": "q-slot-1",
                                        "sentence": "Complete __ and __.",
                                        "blanks": [
                                            {"id": "b1", "correctAnswer": "first"},
                                            {"id": "b2", "correctAnswer": "second"}
                                        ]
                                    }]
                                }
                            ]
                        }]
                    },
                    "listening": {
                        "parts": [{
                            "id": "listening-1",
                            "title": "Listening Part 1",
                            "blocks": [{
                                "id": "listening-block-1",
                                "type": "SHORT_ANSWER",
                                "questions": [{"id": "l1", "prompt": "L1", "correctAnswer": "answer"}]
                            }]
                        }]
                    },
                    "writing": {
                        "task1Prompt": "Summarise the chart.",
                        "task2Prompt": "Discuss both views.",
                        "tasks": [{"id": "task-1"}, {"id": "task-2"}]
                    },
                    "speaking": {"part1Topics": ["topic"], "cueCard": "cue", "part3Discussion": ["discussion"]}
                }),
                config_snapshot: json!({
                    "sections": {
                        "listening": {
                            "enabled": true, "label": "Listening", "order": 1, "duration": 30, "gapAfterMinutes": 5,
                            "bandScoreTable": {"39": 9.0, "37": 8.5, "35": 8.0, "32": 7.5, "30": 7.0, "26": 6.5, "23": 6.0, "18": 5.5, "16": 5.0, "13": 4.5, "10": 4.0, "6": 3.5, "4": 3.0, "2": 2.5}
                        },
                        "reading": {
                            "enabled": true, "label": "Reading", "order": 2, "duration": 60, "gapAfterMinutes": 0,
                            "bandScoreTable": {"39": 9.0, "37": 8.5, "35": 8.0, "33": 7.5, "30": 7.0, "27": 6.5, "23": 6.0, "19": 5.5, "15": 5.0, "13": 4.5, "10": 4.0, "8": 3.5, "6": 3.0, "4": 2.5}
                        },
                        "writing": {
                            "enabled": true, "label": "Writing", "order": 3, "duration": 60, "gapAfterMinutes": 10,
                            "tasks": [{"id": "task-1"}, {"id": "task-2"}]
                        },
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
                expected_draft_version_id: None,
                expected_draft_revision: None,
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
