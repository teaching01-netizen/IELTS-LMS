#[path = "../support/mysql.rs"]
mod mysql;

use chrono::{Duration, Utc};
use serde_json::json;
use uuid::Uuid;

use ielts_backend_application::{
    assessment_access_links::{
        AccessLinkAudienceType, AccessLinkAvailabilityType, AccessLinkMode,
        AssessmentAccessLinkService, CreateAssessmentAccessLinkRequest,
        DuplicateAssessmentAccessLinkRequest, DuplicateReleaseTarget,
    },
    assessment_authoring::{
        AssessmentAuthoringError, AssessmentAuthoringService, AssessmentAuthoringShell,
        BatchQuestionDraft, LoadSampleExamRequest, ModuleTimingUpdate, SampleExamModuleDraft,
        UpdateSectionDeliverySettingsRequest,
    },
    assessment_delivery::{
        AssessmentDeliveryConflictReason, AssessmentDeliveryError, AssessmentDeliveryService,
    },
    assessment_release::{AssessmentReleaseLifecycleState, AssessmentReleaseService},
    builder::{BuilderError, BuilderService},
    delivery::DeliveryService,
    proctoring::ProctoringService,
    sat_workbook::{
        SatWorkbookAsset, SatWorkbookCommitRequest, SatWorkbookModuleDraft, SatWorkbookPreview,
        SatWorkbookStagedAsset,
    },
    scheduling::SchedulingService,
};
use ielts_backend_domain::{
    assessment::{
        AccessibilityMetadata, AnswerDefinition, AssessmentModuleStartRequest,
        AssessmentModuleSubmitRequest, AssessmentResponseRequest, ChoiceOption,
        DeliveredAnswerDefinition, Difficulty, QuestionKind, QuestionMetadata,
        SaveQuestionRevisionRequest, StructuredContent,
    },
    attempt::{HeartbeatEventType, StudentBootstrapRequest, StudentHeartbeatRequest},
    exam::{CreateExamRequest, ExamEntity, ExamType, PublishExamRequest, Visibility},
    exam_provider::provider_for,
    schedule::{
        AttemptCommandRequest, CompleteExamRequest, CreateScheduleRequest, ExtendSectionRequest,
        RuntimeCommandAction, RuntimeCommandRequest, RuntimeStatus,
    },
};
use ielts_backend_infrastructure::actor_context::{ActorContext, ActorRole};

const SAT_MIGRATIONS: &[&str] = &[
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
    "0040_sat_workbook_import_recovery.sql",
];

#[tokio::test]
async fn sat_adaptive_runtime_is_transactional_proctored_and_idempotent() {
    let database = mysql::TestDatabase::new(SAT_MIGRATIONS).await;
    let pool = database.pool().clone();
    let actor = ActorContext::new(Uuid::new_v4().to_string(), ActorRole::Admin);

    let builder = BuilderService::new(pool.clone());
    let exam = builder
        .create_exam(
            &actor,
            CreateExamRequest {
                slug: format!("sat-adaptive-{}", Uuid::new_v4().simple()),
                title: "SAT Adaptive Integration".to_owned(),
                exam_type: ExamType::Academic.as_str().to_owned(),
                visibility: Visibility::Organization.as_str().to_owned(),
                organization_id: Some("sat-test-org".to_owned()),
                provider_key: Some("sat".to_owned()),
                provider_exam_type: Some("sat".to_owned()),
            },
        )
        .await
        .expect("create SAT exam");
    let authoring = AssessmentAuthoringService::new(pool.clone());
    let initial_shell = authoring
        .shell(&exam.id)
        .await
        .expect("SAT authoring shell");
    let version_id = initial_shell.version_id.clone();
    let rw_section = initial_shell
        .sections
        .iter()
        .find(|section| section.section_key == "reading-writing")
        .expect("rw section")
        .clone();
    let routing = rw_section
        .routing_policy
        .as_ref()
        .expect("rw routing policy")
        .clone();
    let settings_request = UpdateSectionDeliverySettingsRequest {
        expected_section_revision: rw_section.revision,
        break_after_seconds: 60,
        module_timings: rw_section
            .modules
            .iter()
            .map(|module| ModuleTimingUpdate {
                module_id: module.id.clone(),
                duration_seconds: module.duration_seconds,
                expected_revision: module.revision,
            })
            .collect(),
        minimum_correct_for_higher: 1,
        expected_routing_revision: routing.revision,
    };
    let configured_shell = authoring
        .update_section_delivery_settings(&exam.id, &rw_section.id, settings_request.clone())
        .await
        .expect("configure SAT delivery and routing through authoring service");
    let configured_rw = configured_shell
        .sections
        .iter()
        .find(|section| section.id == rw_section.id)
        .expect("configured rw section");
    assert_eq!(configured_rw.break_after_seconds, 60);
    assert_eq!(
        configured_rw
            .routing_policy
            .as_ref()
            .expect("configured routing")
            .minimum_correct_for_higher,
        1
    );
    let stale_update = authoring
        .update_section_delivery_settings(&exam.id, &rw_section.id, settings_request)
        .await;
    assert!(
        matches!(stale_update, Err(AssessmentAuthoringError::Conflict(_))),
        "stale delivery settings revision must be rejected"
    );

    let rw_section_id = rw_section.id.clone();
    let rw_base_id = module_id(&pool, &rw_section_id, "base").await;
    let rw_higher_id = module_id(&pool, &rw_section_id, "higher_branch").await;
    let rw_lower_id = module_id(&pool, &rw_section_id, "lower_branch").await;
    let question_ids = seed_base_questions(&pool, &rw_base_id).await;

    let scheduling = SchedulingService::new(pool.clone());
    let schedule = scheduling
        .create_schedule(
            &actor,
            CreateScheduleRequest {
                exam_id: exam.id.clone(),
                published_version_id: version_id.clone(),
                cohort_name: "SAT Integration Cohort".to_owned(),
                proctor_display_name: "SAT Adaptive Integration".to_owned(),
                grading_display_name: "SAT Adaptive Integration".to_owned(),
                institution: Some("Test Centre".to_owned()),
                start_time: Utc::now() - Duration::minutes(1),
                end_time: Utc::now() + Duration::minutes(180),
                auto_start: false,
                auto_stop: false,
            },
        )
        .await
        .expect("create SAT schedule");
    let schedule_id = Uuid::parse_str(&schedule.id).expect("schedule uuid");
    scheduling
        .apply_runtime_command(
            &actor,
            schedule_id,
            RuntimeCommandRequest {
                action: RuntimeCommandAction::StartRuntime,
                reason: None,
            },
        )
        .await
        .expect("proctor starts cohort");

    let delivery = DeliveryService::new(pool.clone());
    let candidate = delivery
        .bootstrap(
            schedule_id,
            StudentBootstrapRequest {
                wcode: Some("W123456".to_owned()),
                email: Some("adaptive@example.com".to_owned()),
                student_key: format!("sat-student-{schedule_id}-adaptive"),
                candidate_id: "adaptive".to_owned(),
                candidate_name: "Adaptive Student".to_owned(),
                candidate_email: "adaptive@example.com".to_owned(),
                client_session_id: Uuid::new_v4().to_string(),
            },
        )
        .await
        .expect("student bootstrap")
        .attempt
        .expect("attempt");
    let attempt_id = candidate.id.clone();

    let sat = AssessmentDeliveryService::new(pool.clone());
    let initial = sat
        .bootstrap(&schedule.id, &attempt_id)
        .await
        .expect("SAT bootstrap");
    let base_attempt = initial
        .attempt
        .module_attempts
        .iter()
        .find(|attempt| attempt.module_id == rw_base_id)
        .expect("base module attempt");
    assert_eq!(base_attempt.state, "not_started");
    assert!(
        base_attempt.started_at.is_none(),
        "bootstrap must not start timer"
    );

    let started = sat
        .start_module(
            &schedule.id,
            &attempt_id,
            AssessmentModuleStartRequest {
                module_id: rw_base_id.clone(),
            },
        )
        .await
        .expect("explicit module start");
    let started_base = started
        .attempt
        .module_attempts
        .iter()
        .find(|attempt| attempt.module_id == rw_base_id)
        .expect("started base");
    assert_eq!(started_base.state, "active");
    assert!(started_base.started_at.is_some());
    assert_eq!(started.timing.timing_model, "cohort_section_v3");
    assert_eq!(started.timing.authority, "cohort_runtime");
    assert_eq!(started.timing.stage_key.as_deref(), Some("reading-writing"));
    let shared_section_deadline = started.timing.deadline_at.expect("shared section deadline");

    // Audit timestamps may differ per candidate, but they must never create exam time.
    sqlx::query(
        "UPDATE assessment_module_attempts SET started_at = DATE_SUB(started_at, INTERVAL 90 SECOND) WHERE attempt_id = ? AND module_id = ?",
    )
    .bind(&attempt_id)
    .bind(&rw_base_id)
    .execute(&pool)
    .await
    .expect("skew first candidate audit start time");

    let timeout_candidate = delivery
        .bootstrap(
            schedule_id,
            StudentBootstrapRequest {
                wcode: Some("W654321".to_owned()),
                email: Some("timeout@example.com".to_owned()),
                student_key: format!("sat-student-{schedule_id}-timeout"),
                candidate_id: "timeout".to_owned(),
                candidate_name: "Timeout Student".to_owned(),
                candidate_email: "timeout@example.com".to_owned(),
                client_session_id: "timeout-client".to_owned(),
            },
        )
        .await
        .expect("timeout student bootstrap")
        .attempt
        .expect("timeout attempt");
    sat.bootstrap(&schedule.id, &timeout_candidate.id)
        .await
        .expect("timeout SAT bootstrap");
    let timeout_started = sat
        .start_module(
            &schedule.id,
            &timeout_candidate.id,
            AssessmentModuleStartRequest {
                module_id: rw_base_id.clone(),
            },
        )
        .await
        .expect("start second candidate on shared M1 clock");
    assert_eq!(
        timeout_started.timing.deadline_at,
        Some(shared_section_deadline),
        "late/staggered candidates must receive the same absolute cohort deadline"
    );

    let completion_candidate = delivery
        .bootstrap(
            schedule_id,
            StudentBootstrapRequest {
                wcode: Some("W777777".to_owned()),
                email: Some("completion@example.com".to_owned()),
                student_key: format!("sat-student-{schedule_id}-complete"),
                candidate_id: "complete".to_owned(),
                candidate_name: "Completion Student".to_owned(),
                candidate_email: "completion@example.com".to_owned(),
                client_session_id: Uuid::new_v4().to_string(),
            },
        )
        .await
        .expect("completion student bootstrap")
        .attempt
        .expect("completion attempt");
    sat.bootstrap(&schedule.id, &completion_candidate.id)
        .await
        .expect("completion SAT bootstrap");
    sat.start_module(
        &schedule.id,
        &completion_candidate.id,
        AssessmentModuleStartRequest {
            module_id: rw_base_id.clone(),
        },
    )
    .await
    .expect("start completion candidate on shared M1 clock");

    let proctor = ProctoringService::new(pool.clone());
    proctor
        .pause_attempt(
            &actor,
            schedule_id,
            Uuid::parse_str(&attempt_id).expect("attempt uuid"),
            command_request("integration pause"),
        )
        .await
        .expect("pause SAT attempt");
    let paused_at: Option<chrono::DateTime<Utc>> = sqlx::query_scalar(
        "SELECT paused_at FROM assessment_module_attempts WHERE attempt_id = ? AND module_id = ?",
    )
    .bind(&attempt_id)
    .bind(&rw_base_id)
    .fetch_one(&pool)
    .await
    .expect("paused timestamp");
    assert!(
        paused_at.is_some(),
        "disciplinary pause freezes the student's module timer while the cohort section clock keeps running"
    );

    let paused_save = sat
        .save_response(
            &schedule.id,
            &attempt_id,
            &question_ids[0],
            AssessmentResponseRequest {
                revision: 0,
                response: Some(json!("A")),
                marked_for_review: false,
                eliminated_options: Vec::new(),
                annotations: json!({}),
                module_attempt_id: None,
                stage_key: None,
                runtime_revision: None,
                client_write_id: None,
            },
        )
        .await;
    assert!(
        paused_save.is_err(),
        "paused attempt must reject answer writes"
    );

    proctor
        .resume_attempt(
            &actor,
            schedule_id,
            Uuid::parse_str(&attempt_id).expect("attempt uuid"),
            command_request("integration resume"),
        )
        .await
        .expect("resume SAT attempt");
    assert!(
        proctor
            .extend_attempt(
                &actor,
                schedule_id,
                Uuid::parse_str(&attempt_id).expect("attempt uuid"),
                ExtendSectionRequest {
                    minutes: 5,
                    reason: Some("individual extension must use a timing group".to_owned()),
                    expected_active_section_key: None,
                    expected_runtime_revision: None,
                },
            )
            .await
            .is_err(),
        "shared-clock SAT must reject hidden per-student timer extensions"
    );
    let pre_extension_runtime = scheduling
        .get_runtime(&actor, schedule_id)
        .await
        .expect("runtime before shared extension");
    let extended_runtime = proctor
        .extend_section(
            &actor,
            schedule_id,
            ExtendSectionRequest {
                minutes: 5,
                reason: Some("cohort extension".to_owned()),
                expected_active_section_key: Some("reading-writing".to_owned()),
                expected_runtime_revision: Some(pre_extension_runtime.revision),
            },
        )
        .await
        .expect("extend shared M1 stage");
    let extended_deadline = extended_runtime
        .current_section_deadline_at
        .expect("extended runtime deadline");
    assert_eq!(
        extended_deadline - shared_section_deadline,
        Duration::minutes(5)
    );
    assert!(
        proctor
            .extend_section(
                &actor,
                schedule_id,
                ExtendSectionRequest {
                    minutes: 5,
                    reason: Some("stale duplicate extension".to_owned()),
                    expected_active_section_key: Some("reading-writing".to_owned()),
                    expected_runtime_revision: Some(pre_extension_runtime.revision),
                },
            )
            .await
            .is_err(),
        "stale runtime revision must not double-extend the shared cohort deadline"
    );
    let extension_seconds: i32 = sqlx::query_scalar(
        "SELECT extension_seconds FROM assessment_module_attempts WHERE attempt_id = ? AND module_id = ?",
    )
    .bind(&attempt_id)
    .bind(&rw_base_id)
    .fetch_one(&pool)
    .await
    .expect("extension seconds");
    assert_eq!(
        extension_seconds, 300,
        "cohort section extension must extend active personal module timers by the same amount"
    );

    sat.save_response(
        &schedule.id,
        &attempt_id,
        &question_ids[0],
        AssessmentResponseRequest {
            revision: 0,
            response: Some(json!("A")),
            marked_for_review: false,
            eliminated_options: Vec::new(),
            annotations: json!({}),
            module_attempt_id: None,
            stage_key: None,
            runtime_revision: None,
            client_write_id: None,
        },
    )
    .await
    .expect("save correct operational response");

    let routed = sat
        .submit_module(
            &schedule.id,
            &attempt_id,
            AssessmentModuleSubmitRequest {
                module_id: rw_base_id.clone(),
            },
        )
        .await
        .expect("submit module one");
    let selected = routed
        .attempt
        .module_attempts
        .iter()
        .find(|attempt| attempt.module_id == rw_higher_id)
        .expect("higher module attempt");
    assert_eq!(selected.state, "not_started");
    assert!(selected.started_at.is_none());
    assert_eq!(
        sqlx::query_scalar::<_, String>(
            "SELECT selected_route FROM assessment_route_decisions WHERE attempt_id = ? AND section_id = ?",
        )
        .bind(&attempt_id)
        .bind(&rw_section_id)
        .fetch_one(&pool)
        .await
        .expect("route decision"),
        "higher"
    );

    sat.submit_module(
        &schedule.id,
        &attempt_id,
        AssessmentModuleSubmitRequest {
            module_id: rw_base_id.clone(),
        },
    )
    .await
    .expect("duplicate submit is idempotent");
    let decision_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM assessment_route_decisions WHERE attempt_id = ? AND section_id = ?",
    )
    .bind(&attempt_id)
    .bind(&rw_section_id)
    .fetch_one(&pool)
    .await
    .expect("decision count");
    assert_eq!(decision_count, 1);

    let higher_started = sat
        .start_module(
            &schedule.id,
            &attempt_id,
            AssessmentModuleStartRequest {
                module_id: rw_higher_id.clone(),
            },
        )
        .await
        .expect("Module 2 starts immediately after this student submits Module 1");
    assert_eq!(
        higher_started.timing.stage_key.as_deref(),
        Some("reading-writing"),
        "Module 1 and Module 2 share one cohort section boundary"
    );

    sqlx::query(
        "UPDATE assessment_module_attempts SET started_at = DATE_SUB(UTC_TIMESTAMP(6), INTERVAL 90 MINUTE) WHERE attempt_id = ? AND module_id = ?",
    )
    .bind(&timeout_candidate.id)
    .bind(&rw_base_id)
    .execute(&pool)
    .await
    .expect("expire only the timeout candidate personal M1 timer");
    let m1_timeout_outcomes = sat
        .reconcile_expired_modules_at(Utc::now(), 10)
        .await
        .expect("reconcile personal M1 timeout without moving the cohort section clock");
    assert!(m1_timeout_outcomes
        .iter()
        .any(|outcome| outcome.attempt_id == timeout_candidate.id));
    assert!(
        !m1_timeout_outcomes
            .iter()
            .any(|outcome| outcome.attempt_id == completion_candidate.id),
        "another student's module must not be finalized by a peer's personal module timeout"
    );
    let timed_out_state: (String, Option<String>) = sqlx::query_as(
        "SELECT state, completion_reason FROM assessment_module_attempts WHERE attempt_id = ? AND module_id = ?",
    )
    .bind(&timeout_candidate.id)
    .bind(&rw_base_id)
    .fetch_one(&pool)
    .await
    .expect("timed out base state");
    assert_eq!(timed_out_state.0, "locked");
    assert_eq!(timed_out_state.1.as_deref(), Some("time_expired"));
    let lower_state: String = sqlx::query_scalar(
        "SELECT state FROM assessment_module_attempts WHERE attempt_id = ? AND module_id = ?",
    )
    .bind(&timeout_candidate.id)
    .bind(&rw_lower_id)
    .fetch_one(&pool)
    .await
    .expect("lower route module");
    assert_eq!(lower_state, "not_started");

    let lower_started = sat
        .start_module(
            &schedule.id,
            &timeout_candidate.id,
            AssessmentModuleStartRequest {
                module_id: rw_lower_id.clone(),
            },
        )
        .await
        .expect("timed-out M1 candidate can enter routed M2 immediately");
    assert_eq!(
        higher_started.timing.deadline_at, lower_started.timing.deadline_at,
        "all students remain capped by the same fixed section deadline"
    );

    let after_branch = sat
        .submit_module(
            &schedule.id,
            &attempt_id,
            AssessmentModuleSubmitRequest {
                module_id: rw_higher_id.clone(),
            },
        )
        .await
        .expect("submit adaptive module two");
    let math_base = after_branch
        .sections
        .iter()
        .find(|section| section.section_key == "math")
        .and_then(|section| {
            section
                .modules
                .iter()
                .find(|module| module.adaptive_role == "base")
        })
        .expect("math base module");
    let math_attempt = after_branch
        .attempt
        .module_attempts
        .iter()
        .find(|attempt| attempt.module_id == math_base.id)
        .expect("math module attempt");
    let available_at = math_attempt.available_at.expect("math availability");
    assert!(available_at <= Utc::now() + Duration::seconds(2));
    assert!(math_attempt.started_at.is_none());
    assert!(
        sat.start_module(
            &schedule.id,
            &attempt_id,
            AssessmentModuleStartRequest {
                module_id: math_base.id.clone(),
            },
        )
        .await
        .is_err(),
        "Math must remain locked while the shared Reading/Writing section is live"
    );

    sqlx::query(
        r#"
        UPDATE exam_session_runtime_sections rs
        JOIN exam_session_runtimes r ON r.id = rs.runtime_id
        SET rs.actual_start_at = DATE_SUB(
            UTC_TIMESTAMP(6),
            INTERVAL ((rs.planned_duration_minutes + rs.extension_minutes) * 60
                + rs.accumulated_paused_seconds + 5) SECOND
        )
        WHERE r.schedule_id = ? AND rs.section_key = 'reading-writing'
        "#,
    )
    .bind(&schedule.id)
    .execute(&pool)
    .await
    .expect("expire shared RW section by only a few seconds");
    proctor
        .reconcile_expired_sections_at(Utc::now(), 10)
        .await
        .expect("advance cohort into the scheduled shared break");
    sat.reconcile_expired_modules_at(Utc::now(), 10)
        .await
        .expect("reconcile candidates left in RW M2");
    let break_runtime = SchedulingService::new(pool.clone())
        .get_runtime(&actor, schedule_id)
        .await
        .expect("read shared break runtime");
    assert_eq!(
        break_runtime.current_section_key.as_deref(),
        Some("sat:break:reading-writing")
    );
    assert!(
        sat.start_module(
            &schedule.id,
            &attempt_id,
            AssessmentModuleStartRequest {
                module_id: math_base.id.clone(),
            },
        )
        .await
        .is_err(),
        "shared break stage must gate Math"
    );
    sqlx::query(
        r#"
        UPDATE exam_session_runtime_sections rs
        JOIN exam_session_runtimes r ON r.id = rs.runtime_id
        SET rs.actual_start_at = ?
        WHERE r.schedule_id = ? AND rs.section_key = 'sat:break:reading-writing'
        "#,
    )
    .bind(Utc::now() - Duration::minutes(2))
    .bind(&schedule.id)
    .execute(&pool)
    .await
    .expect("expire shared break stage");
    proctor
        .reconcile_expired_sections_at(Utc::now(), 10)
        .await
        .expect("advance cohort to Math M1");
    sat.start_module(
        &schedule.id,
        &attempt_id,
        AssessmentModuleStartRequest {
            module_id: math_base.id.clone(),
        },
    )
    .await
    .expect("Math opens automatically when the shared Math section becomes live");

    // The timeout candidate timed out independently inside the shared Reading/Writing section above.

    let disconnected = delivery
        .record_heartbeat(
            schedule_id,
            StudentHeartbeatRequest {
                attempt_id: Some(timeout_candidate.id.clone()),
                student_key: timeout_candidate.student_key.clone(),
                client_session_id: "timeout-client".to_owned(),
                event_type: HeartbeatEventType::Disconnect,
                payload: None,
                client_timestamp: Utc::now(),
            },
        )
        .await
        .expect("record disconnect");
    assert_eq!(
        disconnected.integrity.last_heartbeat_status.as_deref(),
        Some("lost")
    );
    let reconnected = delivery
        .record_heartbeat(
            schedule_id,
            StudentHeartbeatRequest {
                attempt_id: Some(timeout_candidate.id.clone()),
                student_key: timeout_candidate.student_key.clone(),
                client_session_id: "timeout-client".to_owned(),
                event_type: HeartbeatEventType::Reconnect,
                payload: None,
                client_timestamp: Utc::now(),
            },
        )
        .await
        .expect("record reconnect");
    assert_eq!(
        reconnected.integrity.last_heartbeat_status.as_deref(),
        Some("ok")
    );

    proctor
        .terminate_attempt(
            &actor,
            schedule_id,
            Uuid::parse_str(&timeout_candidate.id).expect("timeout attempt uuid"),
            command_request("integration terminate"),
        )
        .await
        .expect("terminate SAT student");
    let terminated: (String, Option<chrono::DateTime<Utc>>) =
        sqlx::query_as("SELECT phase, submitted_at FROM student_attempts WHERE id = ?")
            .bind(&timeout_candidate.id)
            .fetch_one(&pool)
            .await
            .expect("terminated attempt");
    assert_eq!(terminated.0, "post-exam");
    assert!(terminated.1.is_some());

    // The completion candidate remains independently active until the cohort is explicitly completed.

    let completed_runtime = proctor
        .complete_exam(
            &actor,
            schedule_id,
            CompleteExamRequest {
                reason: Some("integration cohort complete".to_owned()),
            },
        )
        .await
        .expect("complete SAT cohort");
    assert_eq!(completed_runtime.status, RuntimeStatus::Completed);
    let completion_submission: Option<chrono::DateTime<Utc>> =
        sqlx::query_scalar("SELECT submitted_at FROM student_attempts WHERE id = ?")
            .bind(&completion_candidate.id)
            .fetch_one(&pool)
            .await
            .expect("completion submission");
    assert!(completion_submission.is_some());
    let completion_module_state: String = sqlx::query_scalar(
        "SELECT state FROM assessment_module_attempts WHERE attempt_id = ? ORDER BY created_at LIMIT 1",
    )
    .bind(&completion_candidate.id)
    .fetch_one(&pool)
    .await
    .expect("completion module state");
    assert_eq!(completion_module_state, "locked");

    database.shutdown().await;
}

#[tokio::test]
async fn sat_shared_clock_rejects_individual_extra_time_at_runtime_start() {
    let database = mysql::TestDatabase::new(SAT_MIGRATIONS).await;
    let pool = database.pool().clone();
    let actor = ActorContext::new(Uuid::new_v4().to_string(), ActorRole::Admin);
    let builder = BuilderService::new(pool.clone());
    let exam = create_sat_exam(&builder, &actor, "SAT Accommodation Guard").await;
    let authoring = AssessmentAuthoringService::new(pool.clone());
    let shell = authoring.shell(&exam.id).await.expect("SAT shell");
    let schedule =
        create_sat_schedule_for_shell(&pool, &actor, &exam, &shell, "Accommodation Guard").await;

    sqlx::query(
        r#"INSERT INTO schedule_registrations
           (id, schedule_id, student_key, actor_id, student_id, student_name, student_email,
            access_state, extra_time_minutes, wcode, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'checked_in', 30, ?, NOW(), NOW())"#,
    )
    .bind(Uuid::new_v4().to_string())
    .bind(&schedule.id)
    .bind(format!("sat-accommodation-{}", schedule.id))
    .bind("sat-accommodation-actor")
    .bind("sat-accommodation-student")
    .bind("Accommodation Student")
    .bind("accommodation@example.com")
    .bind("W900001")
    .execute(&pool)
    .await
    .expect("insert individual accommodation");

    let err = SchedulingService::new(pool.clone())
        .apply_runtime_command(
            &actor,
            Uuid::parse_str(&schedule.id).expect("schedule uuid"),
            RuntimeCommandRequest {
                action: RuntimeCommandAction::StartRuntime,
                reason: None,
            },
        )
        .await
        .expect_err("shared-clock SAT must not silently ignore individual extra time");
    assert!(err
        .to_string()
        .contains("separate accommodation timing cohorts"));

    let runtime_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM exam_session_runtimes WHERE schedule_id = ?")
            .bind(&schedule.id)
            .fetch_one(&pool)
            .await
            .expect("runtime count");
    assert_eq!(
        runtime_count, 0,
        "failed accommodation validation must be side-effect free"
    );

    database.shutdown().await;
}

#[tokio::test]
async fn sat_validation_rejects_non_whole_minute_module_and_break_timings() {
    let database = mysql::TestDatabase::new(SAT_MIGRATIONS).await;
    let pool = database.pool().clone();
    let actor = ActorContext::new(Uuid::new_v4().to_string(), ActorRole::Admin);
    let builder = BuilderService::new(pool.clone());
    let exam = create_sat_exam(&builder, &actor, "SAT Exact Timing Validation").await;
    let authoring = AssessmentAuthoringService::new(pool.clone());
    let shell = authoring.shell(&exam.id).await.expect("SAT shell");
    let rw = shell
        .sections
        .iter()
        .find(|section| section.section_key == "reading-writing")
        .expect("RW section");
    let base = rw
        .modules
        .iter()
        .find(|module| module.adaptive_role == "base")
        .expect("RW base");

    sqlx::query(
        "UPDATE assessment_modules SET duration_seconds = duration_seconds + 1 WHERE id = ?",
    )
    .bind(&base.id)
    .execute(&pool)
    .await
    .expect("introduce one-second module drift");
    sqlx::query("UPDATE assessment_sections SET break_after_seconds = 61 WHERE id = ?")
        .bind(&rw.id)
        .execute(&pool)
        .await
        .expect("introduce one-second break drift");

    let report = authoring
        .validate(&exam.id)
        .await
        .expect("validate SAT timing");
    assert!(!report.valid);
    assert!(
        report.errors.iter().any(|issue| {
            issue.path.contains(".duration") && issue.message.contains("whole number of minutes")
        }),
        "module precision error must be blocking"
    );
    assert!(
        report.errors.iter().any(|issue| {
            issue.path.ends_with(".break") && issue.message.contains("whole number of minutes")
        }),
        "break precision error must be blocking"
    );

    database.shutdown().await;
}

#[tokio::test]
async fn sat_recovery_catches_student_up_across_multiple_missed_cohort_stages() {
    let database = mysql::TestDatabase::new(SAT_MIGRATIONS).await;
    let pool = database.pool().clone();
    let actor = ActorContext::new(Uuid::new_v4().to_string(), ActorRole::Admin);
    let builder = BuilderService::new(pool.clone());
    let exam = create_sat_exam(&builder, &actor, "SAT Multi Stage Recovery").await;
    let authoring = AssessmentAuthoringService::new(pool.clone());
    let initial_shell = authoring.shell(&exam.id).await.expect("SAT shell");
    let initial_rw = initial_shell
        .sections
        .iter()
        .find(|section| section.section_key == "reading-writing")
        .expect("RW section")
        .clone();
    let routing = initial_rw
        .routing_policy
        .as_ref()
        .expect("RW routing policy");
    let shell = authoring
        .update_section_delivery_settings(
            &exam.id,
            &initial_rw.id,
            UpdateSectionDeliverySettingsRequest {
                expected_section_revision: initial_rw.revision,
                break_after_seconds: initial_rw.break_after_seconds,
                module_timings: initial_rw
                    .modules
                    .iter()
                    .map(|module| ModuleTimingUpdate {
                        module_id: module.id.clone(),
                        duration_seconds: module.duration_seconds,
                        expected_revision: module.revision,
                    })
                    .collect(),
                minimum_correct_for_higher: 1,
                expected_routing_revision: routing.revision,
            },
        )
        .await
        .expect("configure deterministic recovery routing threshold");
    let rw = shell
        .sections
        .iter()
        .find(|section| section.section_key == "reading-writing")
        .expect("configured RW section");
    let math = shell
        .sections
        .iter()
        .find(|section| section.section_key == "math")
        .expect("Math section");
    let rw_base_id = module_id(&pool, &rw.id, "base").await;
    let math_base_id = module_id(&pool, &math.id, "base").await;
    seed_base_questions(&pool, &rw_base_id).await;

    let schedule =
        create_sat_schedule_for_shell(&pool, &actor, &exam, &shell, "Multi Stage Recovery").await;
    let schedule_id = Uuid::parse_str(&schedule.id).expect("schedule uuid");
    let scheduling = SchedulingService::new(pool.clone());
    scheduling
        .apply_runtime_command(
            &actor,
            schedule_id,
            RuntimeCommandRequest {
                action: RuntimeCommandAction::StartRuntime,
                reason: None,
            },
        )
        .await
        .expect("start SAT cohort");

    let delivery = DeliveryService::new(pool.clone());
    let candidate = delivery
        .bootstrap(
            schedule_id,
            StudentBootstrapRequest {
                wcode: Some("W900002".to_owned()),
                email: Some("outage@example.com".to_owned()),
                student_key: format!("sat-outage-{schedule_id}"),
                candidate_id: "outage".to_owned(),
                candidate_name: "Outage Recovery Student".to_owned(),
                candidate_email: "outage@example.com".to_owned(),
                client_session_id: Uuid::new_v4().to_string(),
            },
        )
        .await
        .expect("bootstrap outage candidate")
        .attempt
        .expect("attempt");
    let sat = AssessmentDeliveryService::new(pool.clone());
    sat.bootstrap(&schedule.id, &candidate.id)
        .await
        .expect("SAT bootstrap");
    sat.start_module(
        &schedule.id,
        &candidate.id,
        AssessmentModuleStartRequest {
            module_id: rw_base_id.clone(),
        },
    )
    .await
    .expect("start RW M1");

    let as_of = Utc::now();
    sqlx::query(
        r#"UPDATE exam_session_runtime_sections rs
           JOIN exam_session_runtimes r ON r.id = rs.runtime_id
           SET rs.actual_start_at = ?
           WHERE r.schedule_id = ? AND rs.section_key = 'reading-writing'"#,
    )
    .bind(as_of - Duration::minutes(80))
    .bind(&schedule.id)
    .execute(&pool)
    .await
    .expect("simulate reconciler outage across M1, M2, and break");

    let proctor = ProctoringService::new(pool.clone());
    proctor
        .reconcile_expired_sections_at(as_of, 10)
        .await
        .expect("catch cohort runtime up after outage");
    let runtime = scheduling
        .get_runtime(&actor, schedule_id)
        .await
        .expect("runtime after catch-up");
    assert_eq!(runtime.current_section_key.as_deref(), Some("math"));
    assert_eq!(runtime.status, RuntimeStatus::Live);

    let outcomes = sat
        .reconcile_expired_modules_at(as_of, 10)
        .await
        .expect("catch student modules up to cohort runtime");
    assert!(outcomes
        .iter()
        .any(|outcome| outcome.attempt_id == candidate.id));

    let rw_m1: (String, Option<String>) = sqlx::query_as(
        "SELECT state, completion_reason FROM assessment_module_attempts WHERE attempt_id = ? AND module_id = ?",
    )
    .bind(&candidate.id)
    .bind(&rw_base_id)
    .fetch_one(&pool)
    .await
    .expect("RW M1 state");
    assert_eq!(rw_m1.0, "locked");
    assert_eq!(rw_m1.1.as_deref(), Some("time_expired"));

    let stale_rw_m2_count: i64 = sqlx::query_scalar(
        r#"SELECT COUNT(*)
           FROM assessment_module_attempts ma
           JOIN assessment_modules m ON m.id = ma.module_id
           JOIN assessment_sections s ON s.id = m.section_id
           WHERE ma.attempt_id = ? AND s.section_key = 'reading-writing'
             AND m.adaptive_role IN ('lower_branch', 'higher_branch')
             AND ma.state = 'locked' AND ma.completion_reason = 'time_expired'"#,
    )
    .bind(&candidate.id)
    .fetch_one(&pool)
    .await
    .expect("stale RW M2 count");
    assert_eq!(
        stale_rw_m2_count, 1,
        "recovery must finalize the routed M2 even though it was never started"
    );

    let math_state: String = sqlx::query_scalar(
        "SELECT state FROM assessment_module_attempts WHERE attempt_id = ? AND module_id = ?",
    )
    .bind(&candidate.id)
    .bind(&math_base_id)
    .fetch_one(&pool)
    .await
    .expect("Math M1 attempt");
    assert_eq!(math_state, "not_started");

    let started_math = sat
        .start_module(
            &schedule.id,
            &candidate.id,
            AssessmentModuleStartRequest {
                module_id: math_base_id.clone(),
            },
        )
        .await
        .expect("student must be able to resume at current Math M1 stage");
    assert!(started_math
        .attempt
        .module_attempts
        .iter()
        .any(|module| { module.module_id == math_base_id && module.state == "active" }));

    database.shutdown().await;
}

async fn create_sat_schedule_for_shell(
    pool: &sqlx::MySqlPool,
    actor: &ActorContext,
    exam: &ExamEntity,
    shell: &AssessmentAuthoringShell,
    cohort_name: &str,
) -> ielts_backend_domain::schedule::ExamSchedule {
    SchedulingService::new(pool.clone())
        .create_schedule(
            actor,
            CreateScheduleRequest {
                exam_id: exam.id.clone(),
                published_version_id: shell.version_id.clone(),
                cohort_name: cohort_name.to_owned(),
                proctor_display_name: cohort_name.to_owned(),
                grading_display_name: cohort_name.to_owned(),
                institution: Some("Integration Centre".to_owned()),
                start_time: Utc::now() - Duration::minutes(1),
                end_time: Utc::now() + Duration::minutes(180),
                auto_start: false,
                auto_stop: false,
            },
        )
        .await
        .expect("create SAT schedule")
}

async fn module_id(pool: &sqlx::MySqlPool, section_id: &str, role: &str) -> String {
    sqlx::query_scalar(
        "SELECT id FROM assessment_modules WHERE section_id = ? AND adaptive_role = ? ORDER BY display_order LIMIT 1",
    )
    .bind(section_id)
    .bind(role)
    .fetch_one(pool)
    .await
    .expect("module id")
}

async fn seed_base_questions(pool: &sqlx::MySqlPool, module_id: &str) -> Vec<String> {
    let mut ids = Vec::new();
    for (index, is_pretest) in [false, false, true].into_iter().enumerate() {
        let question_id = Uuid::new_v4().to_string();
        let revision_id = Uuid::new_v4().to_string();
        let exam_question_id = Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO assessment_questions (id, provider_key, created_by) VALUES (?, 'sat', 'integration-test')",
        )
        .bind(&question_id)
        .execute(pool)
        .await
        .expect("question");
        sqlx::query(
            "INSERT INTO assessment_question_revisions (id, question_id, semantic_revision, state, question_type, stimulus, prompt, answer_definition, rationale, metadata, accessibility, created_by) VALUES (?, ?, 1, 'draft', 'single_choice', ?, ?, ?, ?, ?, ?, 'integration-test')",
        )
        .bind(&revision_id)
        .bind(&question_id)
        .bind(json!({"version": 1, "nodes": []}))
        .bind(json!({"version": 1, "nodes": []}))
        .bind(json!({
            "kind": "single_choice",
            "options": [],
            "correct_option_id": "A"
        }))
        .bind(json!({"version": 1, "nodes": []}))
        .bind(json!({
            "sectionKey": "reading-writing",
            "domain": "information-and-ideas",
            "skill": "integration",
            "difficulty": "medium",
            "tags": []
        }))
        .bind(json!({"longDescription": null}))
        .execute(pool)
        .await
        .expect("question revision");
        sqlx::query(
            "INSERT INTO assessment_exam_questions (id, module_id, question_id, question_revision_id, display_order, is_pretest) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(&exam_question_id)
        .bind(module_id)
        .bind(&question_id)
        .bind(&revision_id)
        .bind(index as i32)
        .bind(is_pretest)
        .execute(pool)
        .await
        .expect("exam question");
        ids.push(exam_question_id);
    }
    ids
}

fn command_request(reason: &str) -> AttemptCommandRequest {
    AttemptCommandRequest {
        message: None,
        reason: Some(reason.to_owned()),
        expected_active_section_key: None,
        expected_runtime_revision: None,
    }
}

#[tokio::test]
async fn sat_staff_preview_reuses_delivery_projection_without_runtime_side_effects() {
    let database = mysql::TestDatabase::new(SAT_MIGRATIONS).await;
    let pool = database.pool().clone();
    let actor = ActorContext::new(Uuid::new_v4().to_string(), ActorRole::Admin);
    let builder = BuilderService::new(pool.clone());
    let exam = create_sat_exam(&builder, &actor, "SAT Staff Preview").await;
    let authoring = AssessmentAuthoringService::new(pool.clone());
    let shell = authoring.shell(&exam.id).await.expect("authoring shell");
    let rw = shell
        .sections
        .iter()
        .find(|section| section.section_key == "reading-writing")
        .expect("reading-writing section");
    let base = rw
        .modules
        .iter()
        .find(|module| module.adaptive_role == "base")
        .expect("base module");
    let question_ids = seed_base_questions(&pool, &base.id).await;
    let revision_id: String = sqlx::query_scalar(
        "SELECT question_revision_id FROM assessment_exam_questions WHERE id = ?",
    )
    .bind(&question_ids[0])
    .fetch_one(&pool)
    .await
    .expect("question revision id");
    sqlx::query("UPDATE assessment_question_revisions SET answer_definition = ?, rationale = ? WHERE id = ?")
        .bind(json!({
            "kind": "single_choice",
            "options": [{
                "id": "A",
                "content": {"version": 1, "nodes": [{"type": "paragraph", "id": "answer-a", "text": "Answer A"}]}
            }],
            "correctOptionId": "A"
        }))
        .bind(json!({"version": 1, "nodes": [{"type": "paragraph", "id": "rationale", "text": "Private rationale"}]}))
        .bind(&revision_id)
        .execute(&pool)
        .await
        .expect("seed answer and rationale");
    sqlx::query("UPDATE assessment_sections SET instructions = ? WHERE id = ?")
        .bind(json!({"version": 1, "nodes": [{"type": "paragraph", "id": "section-directions", "text": "Real section directions"}]}))
        .bind(&rw.id)
        .execute(&pool)
        .await
        .expect("section directions");
    sqlx::query("UPDATE assessment_modules SET instructions = ? WHERE id = ?")
        .bind(json!({"version": 1, "nodes": [{"type": "paragraph", "id": "module-directions", "text": "Real module directions"}]}))
        .bind(&base.id)
        .execute(&pool)
        .await
        .expect("module directions");

    let before: (i64, i64, i64, i64) = (
        sqlx::query_scalar("SELECT COUNT(*) FROM exam_schedules")
            .fetch_one(&pool)
            .await
            .unwrap(),
        sqlx::query_scalar("SELECT COUNT(*) FROM exam_session_runtimes")
            .fetch_one(&pool)
            .await
            .unwrap(),
        sqlx::query_scalar("SELECT COUNT(*) FROM student_attempts")
            .fetch_one(&pool)
            .await
            .unwrap(),
        sqlx::query_scalar("SELECT COUNT(*) FROM assessment_module_attempts")
            .fetch_one(&pool)
            .await
            .unwrap(),
    );

    let preview = authoring
        .preview(&exam.id)
        .await
        .expect("staff preview projection");
    assert_eq!(preview.version_id, shell.version_id);
    assert_eq!(preview.provider_key, "sat");
    let preview_rw = preview
        .sections
        .iter()
        .find(|section| section.id == rw.id)
        .expect("preview reading-writing section");
    let preview_base = preview_rw
        .modules
        .iter()
        .find(|module| module.id == base.id)
        .expect("preview base module");
    assert_eq!(preview_base.questions.len(), question_ids.len());
    assert!(matches!(
        preview_base.questions[0].answer,
        DeliveredAnswerDefinition::SingleChoice { .. }
    ));
    let wire = serde_json::to_value(&preview).expect("serialize preview");
    let wire_text = wire.to_string();
    assert!(wire_text.contains("Real section directions"));
    assert!(wire_text.contains("Real module directions"));
    assert!(wire_text.contains("Answer A"));
    assert!(!wire_text.contains("correctOptionId"));
    assert!(!wire_text.contains("Private rationale"));

    let after: (i64, i64, i64, i64) = (
        sqlx::query_scalar("SELECT COUNT(*) FROM exam_schedules")
            .fetch_one(&pool)
            .await
            .unwrap(),
        sqlx::query_scalar("SELECT COUNT(*) FROM exam_session_runtimes")
            .fetch_one(&pool)
            .await
            .unwrap(),
        sqlx::query_scalar("SELECT COUNT(*) FROM student_attempts")
            .fetch_one(&pool)
            .await
            .unwrap(),
        sqlx::query_scalar("SELECT COUNT(*) FROM assessment_module_attempts")
            .fetch_one(&pool)
            .await
            .unwrap(),
    );
    assert_eq!(
        after, before,
        "preview must not create runtime or attempt state"
    );
}

#[tokio::test]
async fn sat_sample_loader_replaces_full_draft_atomically() {
    let database = mysql::TestDatabase::new(SAT_MIGRATIONS).await;
    let pool = database.pool().clone();
    let actor = ActorContext::new(Uuid::new_v4().to_string(), ActorRole::Admin);
    let builder = BuilderService::new(pool.clone());
    let exam = create_sat_exam(&builder, &actor, "SAT Sample Loader").await;
    let authoring = AssessmentAuthoringService::new(pool.clone());

    let initial = authoring
        .shell(&exam.id)
        .await
        .expect("initial sample shell");
    let base_module = initial.sections[0]
        .modules
        .iter()
        .find(|module| module.adaptive_role == "base")
        .expect("base module");
    let old_question = authoring
        .create_question(&base_module.id, &actor.actor_id)
        .await
        .expect("seed old draft question");
    let before_load = authoring
        .shell(&exam.id)
        .await
        .expect("shell before sample load");
    let request = complete_sample_request(&before_load);

    let loaded = authoring
        .load_sample_exam(&exam.id, request.clone(), &actor.actor_id)
        .await
        .expect("transactional sample load");
    assert_eq!(loaded.version_revision, before_load.version_revision + 1);
    let total_questions: usize = loaded
        .sections
        .iter()
        .flat_map(|section| &section.modules)
        .map(|module| module.questions.len())
        .sum();
    assert_eq!(total_questions, 147);
    for section in &loaded.sections {
        for module in &section.modules {
            assert_eq!(
                module.questions.len(),
                module.target_question_count as usize
            );
            assert_eq!(
                module
                    .questions
                    .iter()
                    .filter(|question| question.is_pretest)
                    .count(),
                2
            );
        }
    }
    let old_placement_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM assessment_exam_questions WHERE id = ?")
            .bind(&old_question.exam_question_id)
            .fetch_one(&pool)
            .await
            .expect("old placement count");
    assert_eq!(old_placement_count, 0);

    let stale = authoring
        .load_sample_exam(&exam.id, request, &actor.actor_id)
        .await;
    assert!(matches!(stale, Err(AssessmentAuthoringError::Conflict(_))));

    let current = authoring
        .shell(&exam.id)
        .await
        .expect("current loaded shell");
    let mut invalid = complete_sample_request(&current);
    invalid.modules[0].questions.pop();
    let invalid_result = authoring
        .load_sample_exam(&exam.id, invalid, &actor.actor_id)
        .await;
    assert!(matches!(
        invalid_result,
        Err(AssessmentAuthoringError::InvalidData(_))
    ));
    let after_invalid = authoring
        .shell(&exam.id)
        .await
        .expect("shell after invalid load");
    let after_invalid_total: usize = after_invalid
        .sections
        .iter()
        .flat_map(|section| &section.modules)
        .map(|module| module.questions.len())
        .sum();
    assert_eq!(after_invalid_total, 147);
    assert_eq!(after_invalid.version_revision, current.version_revision);

    database.shutdown().await;
}

#[tokio::test]
async fn sat_workbook_commit_is_atomic_recoverable_and_invalidates_undo_after_edit() {
    let database = mysql::TestDatabase::new(SAT_MIGRATIONS).await;
    let pool = database.pool().clone();
    let actor = ActorContext::new(Uuid::new_v4().to_string(), ActorRole::Admin);
    let builder = BuilderService::new(pool.clone());
    let exam = create_sat_exam(&builder, &actor, "SAT Workbook Commit").await;
    let authoring = AssessmentAuthoringService::new(pool.clone());

    let before = authoring
        .shell(&exam.id)
        .await
        .expect("workbook baseline shell");
    let sample = complete_sample_request(&before);
    let modules: Vec<SatWorkbookModuleDraft> = before
        .sections
        .iter()
        .flat_map(|section| {
            section.modules.iter().map(|module| {
                let questions = sample
                    .modules
                    .iter()
                    .find(|candidate| candidate.module_id == module.id)
                    .expect("matching sample module")
                    .questions
                    .clone();
                SatWorkbookModuleDraft {
                    module_key: module.module_key.clone(),
                    section_key: section.section_key.clone(),
                    questions,
                }
            })
        })
        .collect();

    let preview = SatWorkbookPreview {
        import_id: Uuid::new_v4().to_string(),
        template_version: "1".to_owned(),
        row_count: 147,
        question_count: 147,
        valid: true,
        modules: modules.clone(),
        assets: vec![],
        issues: vec![],
    };
    authoring
        .register_sat_workbook_preview(&exam.id, &preview, &actor.actor_id)
        .await
        .expect("register workbook preview");
    let request = SatWorkbookCommitRequest {
        import_id: preview.import_id.clone(),
        expected_version_id: before.version_id.clone(),
        expected_version_revision: before.version_revision,
        modules: modules.clone(),
        assets: vec![],
    };
    let mut unregistered_request = request.clone();
    unregistered_request.import_id = Uuid::new_v4().to_string();
    let rejected = authoring
        .commit_sat_workbook(&exam.id, unregistered_request, &actor.actor_id)
        .await;
    assert!(
        matches!(&rejected, Err(AssessmentAuthoringError::Conflict(message)) if message.contains("preview")),
        "an unregistered workbook preview must be rejected: {rejected:?}"
    );
    let unchanged = authoring
        .shell(&exam.id)
        .await
        .expect("shell after rejected import");
    assert_eq!(unchanged.version_id, before.version_id);
    assert_eq!(unchanged.version_revision, before.version_revision);

    let committed = authoring
        .commit_sat_workbook(&exam.id, request.clone(), &actor.actor_id)
        .await
        .expect("atomic workbook commit");
    let loaded = &committed.shell;
    assert!(committed.undo.available);
    assert_eq!(committed.undo.import_id, preview.import_id);
    assert_eq!(loaded.version_revision, before.version_revision + 1);
    assert_eq!(
        loaded
            .sections
            .iter()
            .flat_map(|section| &section.modules)
            .map(|module| module.questions.len())
            .sum::<usize>(),
        147
    );
    assert!(loaded
        .sections
        .iter()
        .flat_map(|section| &section.modules)
        .all(|module| {
            module.questions.len() == module.target_question_count as usize
                && module
                    .questions
                    .iter()
                    .filter(|question| question.is_pretest)
                    .count()
                    == 2
        }));
    assert!(
        authoring
            .sat_workbook_undo_state(&exam.id)
            .await
            .expect("undo state")
            .expect("committed import")
            .available
    );

    let restored = authoring
        .undo_sat_workbook_import(&exam.id, &committed.undo.import_id, &actor.actor_id)
        .await
        .expect("undo workbook import");
    assert_ne!(restored.version_id, before.version_id);
    assert_eq!(
        restored
            .sections
            .iter()
            .flat_map(|section| &section.modules)
            .map(|module| module.questions.len())
            .sum::<usize>(),
        0
    );
    assert!(authoring
        .sat_workbook_undo_state(&exam.id)
        .await
        .expect("undo state after restore")
        .is_none());

    let second_preview = SatWorkbookPreview {
        import_id: Uuid::new_v4().to_string(),
        template_version: "1".to_owned(),
        row_count: 147,
        question_count: 147,
        valid: true,
        modules: modules.clone(),
        assets: vec![],
        issues: vec![],
    };
    authoring
        .register_sat_workbook_preview(&exam.id, &second_preview, &actor.actor_id)
        .await
        .expect("register second workbook preview");
    let second = authoring
        .commit_sat_workbook(
            &exam.id,
            SatWorkbookCommitRequest {
                import_id: second_preview.import_id.clone(),
                expected_version_id: restored.version_id.clone(),
                expected_version_revision: restored.version_revision,
                modules,
                assets: vec![],
            },
            &actor.actor_id,
        )
        .await
        .expect("second workbook commit");
    let first_question_id = second.shell.sections[0].modules[0].questions[0]
        .exam_question_id
        .clone();
    let question = authoring
        .question(&first_question_id)
        .await
        .expect("imported question")
        .question;
    authoring
        .save_question_revision(
            &question.id,
            SaveQuestionRevisionRequest {
                revision: question.revision,
                question_type: question.question_type,
                stimulus: question.stimulus,
                prompt: question.prompt,
                answer: question.answer,
                rationale: question.rationale,
                metadata: question.metadata,
                accessibility: question.accessibility,
            },
            &actor.actor_id,
        )
        .await
        .expect("post-import edit");
    let stale_undo = authoring
        .undo_sat_workbook_import(&exam.id, &second.undo.import_id, &actor.actor_id)
        .await;
    assert!(matches!(
        stale_undo,
        Err(AssessmentAuthoringError::Conflict(_))
    ));

    let stale_commit = authoring
        .commit_sat_workbook(&exam.id, request, &actor.actor_id)
        .await;
    assert!(matches!(
        stale_commit,
        Err(AssessmentAuthoringError::Conflict(_))
    ));

    database.shutdown().await;
}

#[tokio::test]
async fn sat_workbook_media_is_verified_promoted_and_orphaned_on_undo() {
    let database = mysql::TestDatabase::new(SAT_MIGRATIONS).await;
    let pool = database.pool().clone();
    let actor = ActorContext::new(Uuid::new_v4().to_string(), ActorRole::Admin);
    let builder = BuilderService::new(pool.clone());
    let exam = create_sat_exam(&builder, &actor, "SAT Workbook Media").await;
    let authoring = AssessmentAuthoringService::new(pool.clone());
    let before = authoring.shell(&exam.id).await.expect("workbook baseline");
    let sample = complete_sample_request(&before);
    let mut modules: Vec<SatWorkbookModuleDraft> = before
        .sections
        .iter()
        .flat_map(|section| {
            section.modules.iter().map(|module| {
                let questions = sample
                    .modules
                    .iter()
                    .find(|candidate| candidate.module_id == module.id)
                    .expect("matching sample module")
                    .questions
                    .clone();
                SatWorkbookModuleDraft {
                    module_key: module.module_key.clone(),
                    section_key: section.section_key.clone(),
                    questions,
                }
            })
        })
        .collect();
    modules[0].questions[0].prompt = StructuredContent {
        version: 2,
        nodes: vec![],
        document: Some(json!({
            "type": "doc",
            "content": [
                {"type": "paragraph", "content": [{"type": "text", "text": "Use the graph to answer the question."}]},
                {"type": "image", "attrs": {
                    "assetId": "workbook:graph_01",
                    "alt": "A test graph",
                    "caption": "Workbook graph"
                }}
            ]
        })),
    };

    let import_id = Uuid::new_v4().to_string();
    let asset_id = Uuid::new_v4().to_string();
    let size_bytes = 123_i64;
    let checksum = "workbook-checksum";
    sqlx::query(
        r#"
        INSERT INTO media_assets (
            id, owner_kind, owner_id, content_type, file_name, upload_status,
            object_key, size_bytes, checksum_sha256, upload_url, download_url,
            delete_after_at, created_at, updated_at
        )
        VALUES (?, 'assessment_import', ?, 'image/png', 'graph_01.png', 'finalized',
                ?, ?, ?, 'https://upload.invalid', 'https://download.invalid',
                DATE_ADD(NOW(), INTERVAL 1 DAY), NOW(), NOW())
        "#,
    )
    .bind(&asset_id)
    .bind(&import_id)
    .bind(format!("media/{asset_id}/graph_01.png"))
    .bind(size_bytes)
    .bind(checksum)
    .execute(&pool)
    .await
    .expect("stage workbook media");

    let preview = SatWorkbookPreview {
        import_id: import_id.clone(),
        template_version: "1".to_owned(),
        row_count: 147,
        question_count: 147,
        valid: true,
        modules: modules.clone(),
        assets: vec![SatWorkbookAsset {
            key: "graph_01".to_owned(),
            file_name: "graph_01.png".to_owned(),
            content_type: "image/png".to_owned(),
            size_bytes: size_bytes as usize,
            checksum_sha256: checksum.to_owned(),
            alt_text: "A test graph".to_owned(),
            caption: Some("Workbook graph".to_owned()),
            data_base64: None,
        }],
        issues: vec![],
    };
    authoring
        .register_sat_workbook_preview(&exam.id, &preview, &actor.actor_id)
        .await
        .expect("register workbook preview");
    let committed = authoring
        .commit_sat_workbook(
            &exam.id,
            SatWorkbookCommitRequest {
                import_id: import_id.clone(),
                expected_version_id: before.version_id.clone(),
                expected_version_revision: before.version_revision,
                modules,
                assets: vec![SatWorkbookStagedAsset {
                    key: "graph_01".to_owned(),
                    asset_id: asset_id.clone(),
                }],
            },
            &actor.actor_id,
        )
        .await
        .expect("commit workbook with media");

    let media: (String, String, String, Option<chrono::DateTime<Utc>>) = sqlx::query_as(
        "SELECT owner_kind, owner_id, upload_status, delete_after_at FROM media_assets WHERE id = ?",
    )
    .bind(&asset_id)
    .fetch_one(&pool)
    .await
    .expect("promoted media row");
    assert_eq!(media.0, "assessment_exam");
    assert_eq!(media.1, exam.id);
    assert_eq!(media.2, "finalized");
    assert!(media.3.is_none());

    let first_question_id = committed.shell.sections[0].modules[0].questions[0]
        .exam_question_id
        .clone();
    let question = authoring
        .question(&first_question_id)
        .await
        .expect("imported media question");
    let document = question
        .question
        .prompt
        .document
        .as_ref()
        .expect("rich prompt with media");
    let image = &document["content"][1];
    assert_eq!(image["type"], "image");
    assert_eq!(image["attrs"]["assetId"], asset_id);
    assert_eq!(image["attrs"]["alt"], "A test graph");
    assert_eq!(image["attrs"]["caption"], "Workbook graph");
    assert!(image["attrs"].get("src").is_none());

    authoring
        .undo_sat_workbook_import(&exam.id, &committed.undo.import_id, &actor.actor_id)
        .await
        .expect("undo workbook with media");
    let orphan: (String, String, Option<chrono::DateTime<Utc>>) = sqlx::query_as(
        "SELECT owner_kind, upload_status, delete_after_at FROM media_assets WHERE id = ?",
    )
    .bind(&asset_id)
    .fetch_one(&pool)
    .await
    .expect("orphaned media row");
    assert_eq!(orphan.0, "assessment_exam");
    assert_eq!(orphan.1, "orphaned");
    assert!(orphan.2.is_some());

    database.shutdown().await;
}

fn complete_sample_request(shell: &AssessmentAuthoringShell) -> LoadSampleExamRequest {
    LoadSampleExamRequest {
        expected_version_id: shell.version_id.clone(),
        expected_version_revision: shell.version_revision,
        modules: shell
            .sections
            .iter()
            .flat_map(|section| {
                section
                    .modules
                    .iter()
                    .map(move |module| SampleExamModuleDraft {
                        module_id: module.id.clone(),
                        questions: (0..module.target_question_count)
                            .map(|index| {
                                integration_sample_question(
                                    &section.section_key,
                                    &module.module_key,
                                    index,
                                )
                            })
                            .collect(),
                    })
            })
            .collect(),
    }
}

fn integration_sample_question(
    section_key: &str,
    module_key: &str,
    index: i32,
) -> BatchQuestionDraft {
    let paragraph = |value: &str| StructuredContent {
        version: 1,
        nodes: vec![ielts_backend_domain::assessment::ContentNode::Paragraph {
            id: Uuid::new_v4().to_string(),
            text: value.to_owned(),
        }],
        document: None,
    };
    let domain = if section_key == "math" {
        "algebra"
    } else {
        "information-and-ideas"
    };
    let skill = if section_key == "math" {
        "Linear Equations in One Variable"
    } else {
        "Central Ideas and Details"
    };
    let options = ["A", "B", "C", "D"]
        .into_iter()
        .map(|id| ChoiceOption {
            id: id.to_owned(),
            content: paragraph(&format!("Choice {id} for {module_key} {}", index + 1)),
        })
        .collect();
    BatchQuestionDraft {
        question_type: QuestionKind::SingleChoice,
        stimulus: paragraph(&format!("Sample context for {module_key} {}", index + 1)),
        prompt: paragraph(&format!("Sample question for {module_key} {}?", index + 1)),
        answer: AnswerDefinition::SingleChoice {
            options,
            correct_option_id: Some("A".to_owned()),
        },
        rationale: paragraph("Choice A is the keyed integration-test response."),
        metadata: QuestionMetadata {
            section_key: section_key.to_owned(),
            domain: Some(domain.to_owned()),
            skill: Some(skill.to_owned()),
            difficulty: Difficulty::Medium,
            tags: vec![
                " sample-integration ".to_owned(),
                "SAMPLE-INTEGRATION".to_owned(),
            ],
        },
        accessibility: AccessibilityMetadata {
            long_description: None,
        },
        is_pretest: index == 4 || index == module_target_pretest_second(section_key),
    }
}

fn module_target_pretest_second(section_key: &str) -> i32 {
    if section_key == "math" {
        17
    } else {
        20
    }
}

#[tokio::test]
async fn sat_authoring_mutation_advances_draft_revision_and_rejects_stale_publish() {
    let database = mysql::TestDatabase::new(SAT_MIGRATIONS).await;
    let pool = database.pool().clone();
    let actor = ActorContext::new(Uuid::new_v4().to_string(), ActorRole::Admin);
    let builder = BuilderService::new(pool.clone());
    let exam = create_sat_exam(&builder, &actor, "SAT Revision Guard").await;
    let authoring = AssessmentAuthoringService::new(pool.clone());

    let before = authoring.shell(&exam.id).await.expect("initial SAT shell");
    let base_module_id = before.sections[0]
        .modules
        .iter()
        .find(|module| module.adaptive_role == "base")
        .expect("base module")
        .id
        .clone();

    authoring
        .create_question(&base_module_id, &actor.actor_id)
        .await
        .expect("create SAT question");
    let after = authoring.shell(&exam.id).await.expect("updated SAT shell");
    assert_eq!(after.version_revision, before.version_revision + 1);

    let current_exam = builder
        .get_exam(&actor, exam.id.clone())
        .await
        .expect("current exam");
    let result = builder
        .publish_exam(
            &actor,
            exam.id.clone(),
            PublishExamRequest {
                publish_notes: Some("stale publish must fail".to_owned()),
                revision: current_exam.revision,
                expected_draft_version_id: Some(before.version_id),
                expected_draft_revision: Some(before.version_revision),
            },
        )
        .await;

    assert!(matches!(result, Err(BuilderError::Conflict(_))));
    database.shutdown().await;
}

#[tokio::test]
async fn sat_publish_replay_returns_the_same_immutable_version_once() {
    let database = mysql::TestDatabase::new(SAT_MIGRATIONS).await;
    let pool = database.pool().clone();
    let actor = ActorContext::new(Uuid::new_v4().to_string(), ActorRole::Admin);
    let builder = BuilderService::new(pool.clone());
    let exam = create_sat_exam(&builder, &actor, "SAT Publish Replay").await;
    let authoring = AssessmentAuthoringService::new(pool.clone());
    let shell = authoring.shell(&exam.id).await.expect("SAT shell");

    seed_valid_sat_draft(&pool, &shell).await;
    let report = authoring.validate(&exam.id).await.expect("SAT validation");
    assert!(
        report.valid,
        "seeded SAT draft must be publishable: {:?}",
        report.errors
    );
    assert_eq!(report.version_id, shell.version_id);
    assert_eq!(report.version_revision, shell.version_revision);

    let current_exam = builder
        .get_exam(&actor, exam.id.clone())
        .await
        .expect("current exam");
    let request = PublishExamRequest {
        publish_notes: Some("Release replay test".to_owned()),
        revision: current_exam.revision,
        expected_draft_version_id: Some(shell.version_id.clone()),
        expected_draft_revision: Some(shell.version_revision),
    };

    let first = builder
        .publish_exam(&actor, exam.id.clone(), request.clone())
        .await
        .expect("first publish");

    let after_publish = builder
        .get_exam(&actor, exam.id.clone())
        .await
        .expect("exam after publish");
    assert_eq!(
        after_publish.current_published_version_id.as_deref(),
        Some(first.id.as_str())
    );
    let next_draft_id = after_publish
        .current_draft_version_id
        .clone()
        .expect("SAT publish must immediately create the next editable draft");
    assert_ne!(next_draft_id, first.id);

    let next_version = builder
        .get_version(&actor, next_draft_id.clone())
        .await
        .expect("next SAT draft version");
    assert!(next_version.is_draft);
    assert!(!next_version.is_published);
    assert_eq!(
        next_version.parent_version_id.as_deref(),
        Some(first.id.as_str())
    );
    assert_eq!(next_version.version_number, first.version_number + 1);

    let next_shell = authoring
        .shell(&exam.id)
        .await
        .expect("authoring shell remains available after publish");
    assert_eq!(next_shell.version_id, next_draft_id);
    let next_question_count: usize = next_shell
        .sections
        .iter()
        .flat_map(|section| section.modules.iter())
        .map(|module| module.questions.len())
        .sum();
    assert_eq!(next_question_count, 147);
    let next_report = authoring
        .validate(&exam.id)
        .await
        .expect("continued draft validates");
    assert!(
        next_report.valid,
        "continued draft must preserve published content"
    );

    let sealed_source_revisions: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM assessment_question_revisions qr JOIN assessment_exam_questions eq ON eq.question_revision_id = qr.id JOIN assessment_modules m ON m.id = eq.module_id JOIN assessment_sections s ON s.id = m.section_id WHERE s.exam_version_id = ? AND qr.state = 'sealed'",
    )
    .bind(&first.id)
    .fetch_one(&pool)
    .await
    .expect("sealed source revision count");
    let editable_clone_revisions: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM assessment_question_revisions qr JOIN assessment_exam_questions eq ON eq.question_revision_id = qr.id JOIN assessment_modules m ON m.id = eq.module_id JOIN assessment_sections s ON s.id = m.section_id WHERE s.exam_version_id = ? AND qr.state = 'draft'",
    )
    .bind(&next_shell.version_id)
    .fetch_one(&pool)
    .await
    .expect("editable clone revision count");
    assert_eq!(sealed_source_revisions, 147);
    assert_eq!(editable_clone_revisions, 147);

    let replay = builder
        .publish_exam(&actor, exam.id.clone(), request)
        .await
        .expect("safe publish replay");

    assert_eq!(replay.id, first.id);
    assert_eq!(replay.version_number, first.version_number);
    assert!(first.is_published);
    assert!(!first.is_draft);

    let published_events: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM exam_events WHERE exam_id = ? AND action = 'published'",
    )
    .bind(&exam.id)
    .fetch_one(&pool)
    .await
    .expect("published event count");
    assert_eq!(
        published_events, 1,
        "publish replay must not duplicate audit events"
    );
    let version_created_events: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM exam_events WHERE exam_id = ? AND action = 'version_created'",
    )
    .bind(&exam.id)
    .fetch_one(&pool)
    .await
    .expect("version-created event count");
    assert_eq!(version_created_events, 1);

    database.shutdown().await;
}

#[tokio::test]
async fn opening_legacy_published_sat_without_draft_recovers_editable_child_once() {
    let database = mysql::TestDatabase::new(SAT_MIGRATIONS).await;
    let pool = database.pool().clone();
    let actor = ActorContext::new(Uuid::new_v4().to_string(), ActorRole::Admin);
    let builder = BuilderService::new(pool.clone());
    let exam = create_sat_exam(&builder, &actor, "SAT Legacy Draft Recovery").await;
    let authoring = AssessmentAuthoringService::new(pool.clone());
    let shell = authoring.shell(&exam.id).await.expect("SAT shell");
    seed_valid_sat_draft(&pool, &shell).await;
    let report = authoring.validate(&exam.id).await.expect("SAT validation");
    assert!(report.valid);
    let current_exam = builder
        .get_exam(&actor, exam.id.clone())
        .await
        .expect("current exam");
    let published = builder
        .publish_exam(
            &actor,
            exam.id.clone(),
            PublishExamRequest {
                publish_notes: None,
                revision: current_exam.revision,
                expected_draft_version_id: Some(shell.version_id),
                expected_draft_revision: Some(shell.version_revision),
            },
        )
        .await
        .expect("publish SAT");
    let generated_draft_id: String =
        sqlx::query_scalar("SELECT current_draft_version_id FROM exam_entities WHERE id = ?")
            .bind(&exam.id)
            .fetch_one(&pool)
            .await
            .expect("generated draft id");

    sqlx::query("UPDATE exam_entities SET current_draft_version_id = NULL WHERE id = ?")
        .bind(&exam.id)
        .execute(&pool)
        .await
        .expect("simulate legacy missing draft pointer");
    sqlx::query("DELETE FROM exam_events WHERE exam_id = ? AND version_id = ? AND action = 'version_created'")
        .bind(&exam.id)
        .bind(&generated_draft_id)
        .execute(&pool)
        .await
        .expect("remove synthetic continuation audit event");
    sqlx::query("DELETE FROM exam_versions WHERE id = ? AND is_draft = TRUE")
        .bind(&generated_draft_id)
        .execute(&pool)
        .await
        .expect("simulate legacy publish without continuation draft");

    let recovered = authoring
        .open_shell(&exam.id, &actor.actor_id)
        .await
        .expect("opening Builder repairs legacy published SAT");
    assert_ne!(recovered.version_id, published.id);
    let recovered_version = builder
        .get_version(&actor, recovered.version_id.clone())
        .await
        .expect("recovered draft version");
    assert!(recovered_version.is_draft);
    assert_eq!(
        recovered_version.parent_version_id.as_deref(),
        Some(published.id.as_str())
    );
    let recovered_question_count: usize = recovered
        .sections
        .iter()
        .flat_map(|section| section.modules.iter())
        .map(|module| module.questions.len())
        .sum();
    assert_eq!(recovered_question_count, 147);

    let reopened = authoring
        .open_shell(&exam.id, &actor.actor_id)
        .await
        .expect("reopening Builder is idempotent");
    assert_eq!(reopened.version_id, recovered.version_id);
    let draft_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM exam_versions WHERE exam_id = ? AND is_draft = TRUE",
    )
    .bind(&exam.id)
    .fetch_one(&pool)
    .await
    .expect("draft count");
    assert_eq!(draft_count, 1);

    database.shutdown().await;
}

#[tokio::test]
async fn sat_release_state_and_student_access_survive_publish_updates() {
    let database = mysql::TestDatabase::new(SAT_MIGRATIONS).await;
    let pool = database.pool().clone();
    let actor = ActorContext::new(Uuid::new_v4().to_string(), ActorRole::Admin);
    let builder = BuilderService::new(pool.clone());
    let authoring = AssessmentAuthoringService::new(pool.clone());
    let release = AssessmentReleaseService::new(pool.clone());
    let access = AssessmentAccessLinkService::new(pool.clone());
    let exam = create_sat_exam(&builder, &actor, "SAT Release State").await;
    let shell = authoring.shell(&exam.id).await.expect("initial SAT shell");
    seed_valid_sat_draft(&pool, &shell).await;

    let before_publish = release.get(&exam.id).await.expect("release before publish");
    assert_eq!(
        before_publish.state,
        AssessmentReleaseLifecycleState::NeverPublished
    );

    let current_exam = builder
        .get_exam(&actor, exam.id.clone())
        .await
        .expect("exam before first publish");
    let first_published = builder
        .publish_exam(
            &actor,
            exam.id.clone(),
            PublishExamRequest {
                publish_notes: Some("First release".to_owned()),
                revision: current_exam.revision,
                expected_draft_version_id: Some(shell.version_id.clone()),
                expected_draft_revision: Some(shell.version_revision),
            },
        )
        .await
        .expect("first publish");

    let after_publish = release.get(&exam.id).await.expect("release after publish");
    assert_eq!(
        after_publish.state,
        AssessmentReleaseLifecycleState::PublishedCurrent
    );
    assert_eq!(
        after_publish
            .current_published_version
            .as_ref()
            .expect("current release")
            .id,
        first_published.id
    );
    assert_eq!(after_publish.summary.authored_question_count, 147);
    assert_eq!(after_publish.summary.delivered_question_count, 98);

    let old_link = access
        .create(
            &actor,
            &exam.id,
            CreateAssessmentAccessLinkRequest {
                published_version_id: None,
                name: "Saturday Class".to_owned(),
                audience_type: AccessLinkAudienceType::Anyone,
                audience_label: None,
                access_mode: AccessLinkMode::StudentCode,
                availability_type: AccessLinkAvailabilityType::Anytime,
                opens_at: None,
                closes_at: None,
                selected_students: Vec::new(),
            },
        )
        .await
        .expect("create link against current release");
    assert_eq!(old_link.published_version_id, first_published.id);
    assert!(old_link.is_current_release);

    let continuation = authoring.shell(&exam.id).await.expect("continuation shell");
    let first_question_id = continuation.sections[0].modules[0].questions[0]
        .exam_question_id
        .clone();
    let detail = authoring
        .question(&first_question_id)
        .await
        .expect("continuation question");
    let question = detail.question;
    authoring
        .save_question_revision(
            &question.id,
            SaveQuestionRevisionRequest {
                revision: question.revision,
                question_type: question.question_type,
                stimulus: question.stimulus,
                prompt: question.prompt,
                answer: question.answer,
                rationale: StructuredContent {
                    version: 1,
                    nodes: vec![ielts_backend_domain::assessment::ContentNode::Paragraph {
                        id: Uuid::new_v4().to_string(),
                        text: "Updated after the first release.".to_owned(),
                    }],
                    document: None,
                },
                metadata: question.metadata,
                accessibility: question.accessibility,
            },
            &actor.actor_id,
        )
        .await
        .expect("edit continuation draft");

    let changed = release.get(&exam.id).await.expect("changed release state");
    assert_eq!(
        changed.state,
        AssessmentReleaseLifecycleState::UnpublishedChanges
    );
    assert_eq!(
        changed
            .current_published_version
            .as_ref()
            .expect("published remains current")
            .id,
        first_published.id
    );

    let updated_shell = authoring.shell(&exam.id).await.expect("updated shell");
    let updated_exam = builder
        .get_exam(&actor, exam.id.clone())
        .await
        .expect("exam before update publish");
    let second_published = builder
        .publish_exam(
            &actor,
            exam.id.clone(),
            PublishExamRequest {
                publish_notes: Some("Question rationale updated".to_owned()),
                revision: updated_exam.revision,
                expected_draft_version_id: Some(updated_shell.version_id.clone()),
                expected_draft_revision: Some(updated_shell.version_revision),
            },
        )
        .await
        .expect("publish update");
    assert_ne!(second_published.id, first_published.id);

    let old_link_after_publish = access
        .get(&old_link.id)
        .await
        .expect("old link after publish");
    assert_eq!(
        old_link_after_publish.published_version_id,
        first_published.id
    );
    assert!(!old_link_after_publish.is_current_release);

    let current_link = access
        .duplicate(
            &actor,
            &old_link.id,
            DuplicateAssessmentAccessLinkRequest {
                revision: old_link_after_publish.revision,
                name: Some("Saturday Class".to_owned()),
                release_target: DuplicateReleaseTarget::Current,
                availability_type: None,
                opens_at: None,
                closes_at: None,
            },
        )
        .await
        .expect("create replacement against current release");
    assert_eq!(current_link.published_version_id, second_published.id);
    assert!(current_link.is_current_release);
    assert_ne!(current_link.id, old_link.id);

    let final_state = release.get(&exam.id).await.expect("final release state");
    assert_eq!(
        final_state.state,
        AssessmentReleaseLifecycleState::PublishedCurrent
    );
    assert_eq!(final_state.access.total_links, 2);
    assert_eq!(final_state.access.links_on_current_release, 1);
    assert_eq!(final_state.access.live_links_on_previous_releases, 1);

    database.shutdown().await;
}

struct ActiveSatResponseFixture {
    schedule_id: String,
    attempt_id: String,
    question_id: String,
}

async fn seed_active_sat_response_fixture(
    pool: &sqlx::MySqlPool,
    label: &str,
) -> ActiveSatResponseFixture {
    let actor = ActorContext::new(Uuid::new_v4().to_string(), ActorRole::Admin);
    let builder = BuilderService::new(pool.clone());
    let exam = builder
        .create_exam(
            &actor,
            CreateExamRequest {
                slug: format!("sat-durability-{label}-{}", Uuid::new_v4().simple()),
                title: format!("SAT Durability {label}"),
                exam_type: ExamType::Academic.as_str().to_owned(),
                visibility: Visibility::Organization.as_str().to_owned(),
                organization_id: Some("sat-durability-org".to_owned()),
                provider_key: Some("sat".to_owned()),
                provider_exam_type: Some("sat".to_owned()),
            },
        )
        .await
        .expect("create SAT durability exam");
    let authoring = AssessmentAuthoringService::new(pool.clone());
    let shell = authoring.shell(&exam.id).await.expect("SAT shell");
    let rw_section = shell
        .sections
        .iter()
        .find(|section| section.section_key == "reading-writing")
        .expect("reading-writing section");
    let base_module_id = module_id(pool, &rw_section.id, "base").await;
    let question_ids = seed_base_questions(pool, &base_module_id).await;

    let schedule = SchedulingService::new(pool.clone())
        .create_schedule(
            &actor,
            CreateScheduleRequest {
                exam_id: exam.id.clone(),
                published_version_id: shell.version_id.clone(),
                cohort_name: format!("SAT Durability {label}"),
                proctor_display_name: format!("SAT Durability {label}"),
                grading_display_name: format!("SAT Durability {label}"),
                institution: Some("Test Centre".to_owned()),
                start_time: Utc::now() - Duration::minutes(1),
                end_time: Utc::now() + Duration::minutes(180),
                auto_start: false,
                auto_stop: false,
            },
        )
        .await
        .expect("create SAT durability schedule");
    let schedule_uuid = Uuid::parse_str(&schedule.id).expect("schedule uuid");
    SchedulingService::new(pool.clone())
        .apply_runtime_command(
            &actor,
            schedule_uuid,
            RuntimeCommandRequest {
                action: RuntimeCommandAction::StartRuntime,
                reason: None,
            },
        )
        .await
        .expect("start SAT runtime");
    let attempt = DeliveryService::new(pool.clone())
        .bootstrap(
            schedule_uuid,
            StudentBootstrapRequest {
                wcode: Some(format!("W-{label}")),
                email: Some(format!("{label}@example.com")),
                student_key: format!("sat-student-{schedule_uuid}-{label}"),
                candidate_id: label.to_owned(),
                candidate_name: format!("SAT Student {label}"),
                candidate_email: format!("{label}@example.com"),
                client_session_id: "sat-session-a".to_owned(),
            },
        )
        .await
        .expect("bootstrap SAT student")
        .attempt
        .expect("SAT attempt");
    let sat = AssessmentDeliveryService::new(pool.clone());
    sat.bootstrap(&schedule.id, &attempt.id)
        .await
        .expect("initialize SAT module attempts");
    sat.start_module(
        &schedule.id,
        &attempt.id,
        AssessmentModuleStartRequest {
            module_id: base_module_id,
        },
    )
    .await
    .expect("start SAT base module");

    ActiveSatResponseFixture {
        schedule_id: schedule.id,
        attempt_id: attempt.id,
        question_id: question_ids[0].clone(),
    }
}

#[tokio::test]
async fn sat_predeadline_response_repairs_timeout_finalization_and_adaptive_route() {
    let database = mysql::TestDatabase::new(SAT_MIGRATIONS).await;
    let fixture = seed_active_sat_response_fixture(database.pool(), "timeout-ingress").await;
    let sat = AssessmentDeliveryService::new(database.pool().clone());
    sat.ensure_active_writer(&fixture.schedule_id, &fixture.attempt_id, "sat-session-a")
        .await
        .expect("claim SAT writer");

    let live = sat
        .bootstrap(&fixture.schedule_id, &fixture.attempt_id)
        .await
        .expect("live SAT bootstrap");
    let active = live
        .attempt
        .module_attempts
        .iter()
        .find(|module| module.state == "active")
        .expect("active SAT module");
    let module_attempt_id = active.id.clone();
    let module_id = active.module_id.clone();
    let deadline = active
        .deadline_at
        .expect("authoritative personal SAT module deadline");
    let stage_key = live.timing.stage_key.clone().expect("SAT stage key");
    let runtime_revision = live.timing.runtime_revision;

    sqlx::query(
        "UPDATE assessment_routing_policies SET policy_config = ? WHERE base_module_id = ?",
    )
    .bind(json!({"minimumCorrectForHigher": 1}))
    .bind(&module_id)
    .execute(database.pool())
    .await
    .expect("configure deterministic timeout recovery route");
    let (lower_module_id, higher_module_id): (String, String) = sqlx::query_as(
        "SELECT lower_module_id, higher_module_id FROM assessment_routing_policies WHERE base_module_id = ?",
    )
    .bind(&module_id)
    .fetch_one(database.pool())
    .await
    .expect("load SAT branch ids");

    let outcomes = sat
        .reconcile_expired_modules_at(deadline + Duration::seconds(1), 50)
        .await
        .expect("finalize SAT M1 at timeout");
    assert!(outcomes
        .iter()
        .any(|outcome| outcome.attempt_id == fixture.attempt_id));
    let finalized: (String, Option<String>, Option<i32>, Option<i32>) = sqlx::query_as(
        "SELECT state, completion_reason, raw_correct, operational_question_count FROM assessment_module_attempts WHERE id = ?",
    )
    .bind(&module_attempt_id)
    .fetch_one(database.pool())
    .await
    .expect("timeout-finalized SAT module");
    assert_eq!(finalized.0, "locked");
    assert_eq!(finalized.1.as_deref(), Some("time_expired"));
    assert_eq!(finalized.2, Some(0));
    assert_eq!(finalized.3, Some(2));

    let before_route: (String, String, i32) = sqlx::query_as(
        "SELECT selected_route, selected_module_id, raw_correct FROM assessment_route_decisions WHERE attempt_id = ?",
    )
    .bind(&fixture.attempt_id)
    .fetch_one(database.pool())
    .await
    .expect("timeout route decision");
    assert_eq!(before_route.0, "lower");
    assert_eq!(before_route.1, lower_module_id);
    assert_eq!(before_route.2, 0);
    let pending_before: (String, String, String) = sqlx::query_as(
        "SELECT id, module_id, state FROM assessment_module_attempts WHERE attempt_id = ? AND module_id = ?",
    )
    .bind(&fixture.attempt_id)
    .bind(&before_route.1)
    .fetch_one(database.pool())
    .await
    .expect("pending lower branch");
    assert_eq!(pending_before.2, "not_started");

    let recovered = sat
        .save_response_at(
            &fixture.schedule_id,
            &fixture.attempt_id,
            &fixture.question_id,
            deadline,
            AssessmentResponseRequest {
                revision: 0,
                response: Some(json!("A")),
                marked_for_review: false,
                eliminated_options: Vec::new(),
                annotations: json!({"version": 1, "note": "deadline ingress"}),
                module_attempt_id: Some(module_attempt_id.clone()),
                stage_key: Some(stage_key.clone()),
                runtime_revision: Some(runtime_revision),
                client_write_id: Some("timeout-ingress-write-1".to_owned()),
            },
        )
        .await
        .expect("pre-deadline response must survive timeout finalization");
    assert_eq!(recovered.module_attempt_id, module_attempt_id);
    assert_eq!(recovered.response, Some(json!("A")));

    let repaired_score: (Option<i32>, Option<i32>) = sqlx::query_as(
        "SELECT raw_correct, operational_question_count FROM assessment_module_attempts WHERE id = ?",
    )
    .bind(&module_attempt_id)
    .fetch_one(database.pool())
    .await
    .expect("repaired SAT score");
    assert_eq!(repaired_score, (Some(1), Some(2)));
    let after_route: (String, String, i32) = sqlx::query_as(
        "SELECT selected_route, selected_module_id, raw_correct FROM assessment_route_decisions WHERE attempt_id = ?",
    )
    .bind(&fixture.attempt_id)
    .fetch_one(database.pool())
    .await
    .expect("repaired SAT route decision");
    assert_eq!(after_route.0, "higher");
    assert_eq!(after_route.1, higher_module_id);
    assert_eq!(after_route.2, 1);
    let pending_after: (String, String, String) =
        sqlx::query_as("SELECT id, module_id, state FROM assessment_module_attempts WHERE id = ?")
            .bind(&pending_before.0)
            .fetch_one(database.pool())
            .await
            .expect("retargeted pending branch");
    assert_eq!(pending_after.1, higher_module_id);
    assert_eq!(pending_after.2, "not_started");

    let second_question_id: String = sqlx::query_scalar(
        "SELECT id FROM assessment_exam_questions WHERE module_id = ? ORDER BY display_order LIMIT 1 OFFSET 1",
    )
    .bind(&module_id)
    .fetch_one(database.pool())
    .await
    .expect("second SAT question");
    let late = sat
        .save_response_at(
            &fixture.schedule_id,
            &fixture.attempt_id,
            &second_question_id,
            deadline + Duration::milliseconds(1),
            AssessmentResponseRequest {
                revision: 0,
                response: Some(json!("A")),
                marked_for_review: false,
                eliminated_options: Vec::new(),
                annotations: json!({}),
                module_attempt_id: Some(module_attempt_id.clone()),
                stage_key: Some(stage_key),
                runtime_revision: Some(runtime_revision),
                client_write_id: Some("timeout-ingress-write-late".to_owned()),
            },
        )
        .await
        .expect_err("post-deadline response must remain rejected");
    assert!(matches!(
        late,
        AssessmentDeliveryError::StructuredConflict {
            reason: AssessmentDeliveryConflictReason::DeadlineExpired,
            ..
        }
    ));
    let late_row_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM assessment_question_responses WHERE module_attempt_id = ? AND exam_question_id = ?",
    )
    .bind(&module_attempt_id)
    .bind(&second_question_id)
    .fetch_one(database.pool())
    .await
    .expect("count rejected late response");
    assert_eq!(late_row_count, 0);

    database.shutdown().await;
}

#[tokio::test]
async fn stale_sat_question_editor_cannot_overwrite_the_winning_revision() {
    let database = mysql::TestDatabase::new(SAT_MIGRATIONS).await;
    let pool = database.pool().clone();
    let actor = ActorContext::new(Uuid::new_v4().to_string(), ActorRole::Admin);
    let builder = BuilderService::new(pool.clone());
    let exam = create_sat_exam(&builder, &actor, "SAT Staff Concurrency").await;
    let authoring = AssessmentAuthoringService::new(pool.clone());
    let shell = authoring
        .shell(&exam.id)
        .await
        .expect("SAT authoring shell");
    let rw_section = shell
        .sections
        .iter()
        .find(|section| section.section_key == "reading-writing")
        .expect("reading-writing section");
    let base_module_id = module_id(&pool, &rw_section.id, "base").await;
    let question_ids = seed_base_questions(&pool, &base_module_id).await;
    let detail = authoring
        .question(&question_ids[0])
        .await
        .expect("seeded SAT question");
    let original = detail.question;

    let winning_rationale = StructuredContent {
        version: 1,
        nodes: vec![ielts_backend_domain::assessment::ContentNode::Paragraph {
            id: Uuid::new_v4().to_string(),
            text: "Editor A authoritative rationale".to_owned(),
        }],
        document: None,
    };
    let winner = authoring
        .save_question_revision(
            &original.id,
            SaveQuestionRevisionRequest {
                revision: original.revision,
                question_type: original.question_type.clone(),
                stimulus: original.stimulus.clone(),
                prompt: original.prompt.clone(),
                answer: original.answer.clone(),
                rationale: winning_rationale.clone(),
                metadata: original.metadata.clone(),
                accessibility: original.accessibility.clone(),
            },
            "editor-a",
        )
        .await
        .expect("editor A save");
    assert_eq!(winner.revision, original.revision + 1);

    let stale = authoring
        .save_question_revision(
            &original.id,
            SaveQuestionRevisionRequest {
                revision: original.revision,
                question_type: original.question_type,
                stimulus: original.stimulus,
                prompt: original.prompt,
                answer: original.answer,
                rationale: StructuredContent {
                    version: 1,
                    nodes: vec![ielts_backend_domain::assessment::ContentNode::Paragraph {
                        id: Uuid::new_v4().to_string(),
                        text: "Editor B stale rationale".to_owned(),
                    }],
                    document: None,
                },
                metadata: original.metadata,
                accessibility: original.accessibility,
            },
            "editor-b",
        )
        .await;
    assert!(matches!(stale, Err(AssessmentAuthoringError::Conflict(_))));

    let persisted = authoring
        .question(&question_ids[0])
        .await
        .expect("authoritative SAT question")
        .question;
    assert_eq!(persisted.revision, winner.revision);
    assert_eq!(persisted.rationale, winning_rationale);
    let updated_by: String =
        sqlx::query_scalar("SELECT updated_by FROM assessment_question_revisions WHERE id = ?")
            .bind(&original.id)
            .fetch_one(&pool)
            .await
            .expect("question updater");
    assert_eq!(updated_by, "editor-a");

    database.shutdown().await;
}

#[tokio::test]
async fn sat_response_replay_after_lost_ack_is_a_true_no_op() {
    let database = mysql::TestDatabase::new(SAT_MIGRATIONS).await;
    let fixture = seed_active_sat_response_fixture(database.pool(), "lost-ack").await;
    let sat = AssessmentDeliveryService::new(database.pool().clone());
    sat.ensure_active_writer(&fixture.schedule_id, &fixture.attempt_id, "sat-session-a")
        .await
        .expect("claim SAT writer");

    let request = AssessmentResponseRequest {
        revision: 0,
        response: Some(json!("A")),
        marked_for_review: false,
        eliminated_options: Vec::new(),
        annotations: json!({"version": 1, "note": ""}),
        module_attempt_id: None,
        stage_key: None,
        runtime_revision: None,
        client_write_id: None,
    };
    let first = sat
        .save_response(
            &fixture.schedule_id,
            &fixture.attempt_id,
            &fixture.question_id,
            request.clone(),
        )
        .await
        .expect("first SAT answer commit");
    let replay = sat
        .save_response(
            &fixture.schedule_id,
            &fixture.attempt_id,
            &fixture.question_id,
            request,
        )
        .await
        .expect("lost acknowledgement replay");

    assert_eq!(replay.id, first.id);
    assert_eq!(replay.revision, first.revision);
    assert_eq!(replay.response, first.response);
    let row_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM assessment_question_responses WHERE module_attempt_id = ? AND exam_question_id = ?",
    )
    .bind(&first.module_attempt_id)
    .bind(&fixture.question_id)
    .fetch_one(database.pool())
    .await
    .expect("count SAT response rows");
    assert_eq!(row_count, 1);

    database.shutdown().await;
}

#[tokio::test]
async fn sat_stale_revision_with_different_state_conflicts_without_overwrite() {
    let database = mysql::TestDatabase::new(SAT_MIGRATIONS).await;
    let fixture = seed_active_sat_response_fixture(database.pool(), "stale-revision").await;
    let sat = AssessmentDeliveryService::new(database.pool().clone());
    sat.ensure_active_writer(&fixture.schedule_id, &fixture.attempt_id, "sat-session-a")
        .await
        .expect("claim SAT writer");

    sat.save_response(
        &fixture.schedule_id,
        &fixture.attempt_id,
        &fixture.question_id,
        AssessmentResponseRequest {
            revision: 0,
            response: Some(json!("A")),
            marked_for_review: false,
            eliminated_options: Vec::new(),
            annotations: json!({}),
            module_attempt_id: None,
            stage_key: None,
            runtime_revision: None,
            client_write_id: None,
        },
    )
    .await
    .expect("initial SAT response");
    let current = sat
        .save_response(
            &fixture.schedule_id,
            &fixture.attempt_id,
            &fixture.question_id,
            AssessmentResponseRequest {
                revision: 0,
                response: Some(json!("B")),
                marked_for_review: true,
                eliminated_options: vec!["A".to_owned()],
                annotations: json!({"version": 1, "note": "current"}),
                module_attempt_id: None,
                stage_key: None,
                runtime_revision: None,
                client_write_id: None,
            },
        )
        .await
        .expect("advance SAT response revision");
    assert_eq!(current.revision, 1);

    let stale = sat
        .save_response(
            &fixture.schedule_id,
            &fixture.attempt_id,
            &fixture.question_id,
            AssessmentResponseRequest {
                revision: 0,
                response: Some(json!("C")),
                marked_for_review: false,
                eliminated_options: Vec::new(),
                annotations: json!({}),
                module_attempt_id: None,
                stage_key: None,
                runtime_revision: None,
                client_write_id: None,
            },
        )
        .await
        .expect_err("stale different SAT state must conflict");
    assert!(matches!(
        stale,
        AssessmentDeliveryError::StructuredConflict {
            reason: AssessmentDeliveryConflictReason::ResponseRevisionMismatch,
            ..
        }
    ));

    let persisted: (Option<serde_json::Value>, bool, i32) = sqlx::query_as(
        "SELECT response, marked_for_review, revision FROM assessment_question_responses WHERE id = ?",
    )
    .bind(&current.id)
    .fetch_one(database.pool())
    .await
    .expect("load persisted SAT response");
    assert_eq!(persisted.0, Some(json!("B")));
    assert!(persisted.1);
    assert_eq!(persisted.2, 1);

    database.shutdown().await;
}

#[tokio::test]
async fn sat_stale_session_is_fenced_before_response_persistence() {
    let database = mysql::TestDatabase::new(SAT_MIGRATIONS).await;
    let fixture = seed_active_sat_response_fixture(database.pool(), "stale-session").await;
    let sat = AssessmentDeliveryService::new(database.pool().clone());
    sat.ensure_active_writer(
        &fixture.schedule_id,
        &fixture.attempt_id,
        "sat-session-current",
    )
    .await
    .expect("claim current SAT writer");

    let stale = sat
        .ensure_active_writer(
            &fixture.schedule_id,
            &fixture.attempt_id,
            "sat-session-stale",
        )
        .await
        .expect_err("old SAT session must be fenced");
    assert!(matches!(
        stale,
        ielts_backend_application::assessment_delivery::AssessmentDeliveryError::ActiveSessionSuperseded
    ));
    let response_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM assessment_question_responses r JOIN assessment_module_attempts m ON m.id = r.module_attempt_id WHERE m.attempt_id = ?",
    )
    .bind(&fixture.attempt_id)
    .fetch_one(database.pool())
    .await
    .expect("count SAT responses");
    assert_eq!(response_count, 0);

    database.shutdown().await;
}

async fn create_sat_exam(
    builder: &BuilderService,
    actor: &ActorContext,
    title: &str,
) -> ExamEntity {
    builder
        .create_exam(
            actor,
            CreateExamRequest {
                slug: format!("sat-release-{}", Uuid::new_v4().simple()),
                title: title.to_owned(),
                exam_type: ExamType::Academic.as_str().to_owned(),
                visibility: Visibility::Organization.as_str().to_owned(),
                organization_id: Some("sat-release-test-org".to_owned()),
                provider_key: Some("sat".to_owned()),
                provider_exam_type: Some("sat".to_owned()),
            },
        )
        .await
        .expect("create SAT release exam")
}

async fn seed_valid_sat_draft(pool: &sqlx::MySqlPool, shell: &AssessmentAuthoringShell) {
    let blueprint = provider_for("sat").expect("SAT provider").blueprint();
    for section in &shell.sections {
        for module in &section.modules {
            let blueprint_module = blueprint
                .module(&section.section_key, &module.module_key)
                .expect("SAT blueprint module");
            let (domain, skill) = if section.section_key == "math" {
                ("algebra", "Linear Equations in One Variable")
            } else {
                ("information-and-ideas", "Central Ideas and Details")
            };
            for display_order in 0..module.target_question_count {
                let question_id = Uuid::new_v4().to_string();
                let revision_id = Uuid::new_v4().to_string();
                let exam_question_id = Uuid::new_v4().to_string();
                let prompt = content_with_text(&format!(
                    "{} {} question {}",
                    section.title,
                    module.title,
                    display_order + 1
                ));
                let answer = json!({
                    "kind": "single_choice",
                    "options": [
                        {"id": "A", "content": content_with_text("Choice A")},
                        {"id": "B", "content": content_with_text("Choice B")},
                        {"id": "C", "content": content_with_text("Choice C")},
                        {"id": "D", "content": content_with_text("Choice D")}
                    ],
                    "correct_option_id": "A"
                });
                sqlx::query(
                    "INSERT INTO assessment_questions (id, provider_key, created_by) VALUES (?, 'sat', 'release-test')",
                )
                .bind(&question_id)
                .execute(pool)
                .await
                .expect("insert SAT release question");

                sqlx::query(
                    "INSERT INTO assessment_question_revisions (id, question_id, semantic_revision, state, question_type, stimulus, prompt, answer_definition, rationale, metadata, accessibility, created_by) VALUES (?, ?, 1, 'draft', 'single_choice', ?, ?, ?, ?, ?, ?, 'release-test')",
                )
                .bind(&revision_id)
                .bind(&question_id)
                .bind(json!({"version": 1, "nodes": []}))
                .bind(prompt)
                .bind(answer)
                .bind(content_with_text("Correct because A is the seeded answer."))
                .bind(json!({
                    "sectionKey": section.section_key,
                    "domain": domain,
                    "skill": skill,
                    "difficulty": "medium",
                    "tags": ["release-test"]
                }))                .bind(json!({"longDescription": null}))
                .execute(pool)
                .await
                .expect("insert SAT release question revision");

                let first_pretest_index =
                    module.target_question_count - blueprint_module.pretest_count;
                let is_pretest = display_order >= first_pretest_index;
                sqlx::query(
                    "INSERT INTO assessment_exam_questions (id, module_id, question_id, question_revision_id, display_order, is_pretest) VALUES (?, ?, ?, ?, ?, ?)",
                )
                .bind(&exam_question_id)
                .bind(&module.id)
                .bind(&question_id)
                .bind(&revision_id)
                .bind(display_order)
                .bind(is_pretest)
                .execute(pool)
                .await
                .expect("attach SAT release question");
            }
        }
    }
}

fn content_with_text(text: &str) -> serde_json::Value {
    json!({
        "version": 1,
        "nodes": [
            {
                "type": "paragraph",
                "id": Uuid::new_v4().to_string(),
                "text": text
            }
        ]
    })
}
