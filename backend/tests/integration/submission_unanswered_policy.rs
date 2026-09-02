#[path = "../support/mysql.rs"]
mod mysql;

use chrono::{Duration, TimeZone, Utc};
use serde_json::json;
use uuid::Uuid;

use ielts_backend_application::{
    builder::BuilderService,
    delivery::{DeliveryError, DeliveryService},
    scheduling::SchedulingService,
};
use ielts_backend_domain::{
    attempt::{StudentBootstrapRequest, StudentPrecheckRequest, StudentSubmitRequest},
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

#[tokio::test]
async fn submit_attempt_blocks_unanswered_while_live_and_allows_after_completion() {
    let database = mysql::TestDatabase::new(DELIVERY_MIGRATIONS).await;
    let schedule = seed_schedule_with_unanswered_block_policy(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).expect("schedule id");
    let actor = ActorContext::new(Uuid::new_v4().to_string(), ActorRole::Admin);

    let service = DeliveryService::new(database.pool().clone());
    let student_key = format!("student-{}-alice", schedule_id);
    let wcode = "W123456".to_owned();

    let bootstrap = service
        .bootstrap(
            &ActorContext::new(Uuid::new_v4().to_string(), ActorRole::Admin),
            schedule_id,
            StudentBootstrapRequest {
                student_key: student_key.clone(),
                candidate_id: "alice".to_owned(),
                candidate_name: "Alice Roe".to_owned(),
                candidate_email: "alice@example.com".to_owned(),
                email: Some("alice@example.com".to_owned()),
                wcode: Some(wcode.clone()),
                client_session_id: Uuid::new_v4().to_string(),
            },
        )
        .await
        .expect("bootstrap");
    let _attempt = bootstrap.attempt.expect("attempt");

    service
        .persist_precheck(
            &ActorContext::new(Uuid::new_v4().to_string(), ActorRole::Admin),
            schedule_id,
            StudentPrecheckRequest {
                student_key: student_key.clone(),
                candidate_id: "alice".to_owned(),
                candidate_name: "Alice Roe".to_owned(),
                candidate_email: "alice@example.com".to_owned(),
                email: Some("alice@example.com".to_owned()),
                wcode: Some(wcode.clone()),
                client_session_id: Uuid::new_v4().to_string(),
                pre_check: json!({
                    "completedAt": "2026-01-10T08:50:00Z",
                    "checks": [{"id": "browser", "status": "pass"}]
                }),
                device_fingerprint_hash: Some("fp-alice".to_owned()),
            },
            None,
        )
        .await
        .expect("persist precheck");

    SchedulingService::new(database.pool().clone())
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

    let bootstrap_again = service
        .bootstrap(
            &ActorContext::new(Uuid::new_v4().to_string(), ActorRole::Admin),
            schedule_id,
            StudentBootstrapRequest {
                student_key: student_key.clone(),
                candidate_id: "alice".to_owned(),
                candidate_name: "Alice Roe".to_owned(),
                candidate_email: "alice@example.com".to_owned(),
                email: Some("alice@example.com".to_owned()),
                wcode: Some(wcode.clone()),
                client_session_id: Uuid::new_v4().to_string(),
            },
        )
        .await
        .expect("bootstrap after runtime start");
    let attempt_after_runtime = bootstrap_again.attempt.expect("attempt after runtime");

    let blocked_while_live = service
        .submit_attempt(
            schedule_id,
            StudentSubmitRequest {
                attempt_id: attempt_after_runtime.id.clone(),
                student_key: student_key.clone(),
                answers: None,
                writing_answers: None,
                flags: None,
                last_seen_revision: Some(attempt_after_runtime.revision),
                submission_id: Some("submission-live-blocked".to_owned()),
                client_session_id: None,
                client_final_seq: Some(0),
                server_accepted_through_seq: Some(0),
                final_answer_patch: None,
                final_client_snapshot_hash: None,
            },
            None,
        )
        .await
        .expect_err("submit should block while live when unanswered policy is block");
    assert!(matches!(
        blocked_while_live,
        DeliveryError::Validation(message)
            if message == "Runtime is live and unanswered submission policy is set to block."
    ));

    SchedulingService::new(database.pool().clone())
        .apply_runtime_command(
            &actor,
            schedule_id,
            RuntimeCommandRequest {
                action: RuntimeCommandAction::EndRuntime,
                reason: None,
            },
        )
        .await
        .expect("end runtime");

    let submitted_again = service
        .submit_attempt(
            schedule_id,
            StudentSubmitRequest {
                attempt_id: attempt_after_runtime.id.clone(),
                student_key: student_key.clone(),
                answers: None,
                writing_answers: None,
                flags: None,
                last_seen_revision: Some(attempt_after_runtime.revision),
                submission_id: Some("submission-after-complete".to_owned()),
                client_session_id: None,
                client_final_seq: Some(0),
                server_accepted_through_seq: Some(0),
                final_answer_patch: None,
                final_client_snapshot_hash: None,
            },
            None,
        )
        .await
        .expect("submit should remain idempotent after completed");

    assert_eq!(submitted_again.attempt.phase, "post-exam");

    database.shutdown().await;
}

async fn seed_schedule_with_unanswered_block_policy(
    pool: &sqlx::MySqlPool,
) -> ielts_backend_domain::schedule::ExamSchedule {
    let actor = ActorContext::new(Uuid::new_v4().to_string(), ActorRole::Admin);
    let builder_service = BuilderService::new(pool.clone());
    let exam = builder_service
        .create_exam(
            &actor,
            CreateExamRequest {
                slug: "cambridge-19-academic-unanswered-policy".to_owned(),
                title: "Cambridge 19 Academic Unanswered Policy".to_owned(),
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
                            "title": "Passage 1",
                            "content": "seeded",
                            "blocks": [{
                                "id": "reading-block-1",
                                "type": "SHORT_ANSWER",
                                "instruction": "Answer the question.",
                                "questions": [{
                                    "id": "q1",
                                    "prompt": "Question 1",
                                    "correctAnswer": "seeded answer",
                                    "answerRule": "ONE_WORD"
                                }]
                            }]
                        }]
                    },
                    "listening": { "parts": [] },
                    "writing": { "tasks": [] },
                    "speaking": { "part1Topics": [], "cueCard": "", "part3Discussion": [] }
                }),
                config_snapshot: json!({
                    "sections": {
                        "reading": {"enabled": true, "label": "Reading", "order": 1, "duration": 60, "gapAfterMinutes": 0, "bandScoreTable": {"1": 1.0}},
                        "listening": {"enabled": false, "label": "Listening", "order": 0, "duration": 30, "gapAfterMinutes": 0},
                        "writing": {"enabled": false, "label": "Writing", "order": 2, "duration": 60, "gapAfterMinutes": 0},
                        "speaking": {"enabled": false, "label": "Speaking", "order": 3, "duration": 15, "gapAfterMinutes": 0}
                    },
                    "progression": {
                        "unansweredSubmissionPolicy": "block"
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
                publish_notes: Some("ready for policy test".to_owned()),
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
                cohort_name: "Policy Cohort".to_owned(),
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
