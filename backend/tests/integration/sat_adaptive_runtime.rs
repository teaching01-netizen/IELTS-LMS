#[path = "../support/mysql.rs"]
mod mysql;

use chrono::{Duration, Utc};
use serde_json::json;
use uuid::Uuid;

use ielts_backend_application::{
    assessment_authoring::{
        AssessmentAuthoringError, AssessmentAuthoringService, AssessmentAuthoringShell,
        ModuleTimingUpdate, UpdateSectionDeliverySettingsRequest,
    },
    assessment_delivery::AssessmentDeliveryService,
    builder::{BuilderError, BuilderService},
    delivery::DeliveryService,
    proctoring::ProctoringService,
    scheduling::SchedulingService,
};
use ielts_backend_domain::{
    assessment::{
        AssessmentModuleStartRequest, AssessmentModuleSubmitRequest, AssessmentResponseRequest,
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
        break_after_seconds: 7,
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
    assert_eq!(configured_rw.break_after_seconds, 7);
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
    assert!(paused_at.is_some());

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
    proctor
        .extend_attempt(
            &actor,
            schedule_id,
            Uuid::parse_str(&attempt_id).expect("attempt uuid"),
            ExtendSectionRequest {
                minutes: 5,
                reason: Some("integration accommodation".to_owned()),
                expected_active_section_key: None,
            },
        )
        .await
        .expect("extend SAT attempt");
    let extension_seconds: i32 = sqlx::query_scalar(
        "SELECT extension_seconds FROM assessment_module_attempts WHERE attempt_id = ? AND module_id = ?",
    )
    .bind(&attempt_id)
    .bind(&rw_base_id)
    .fetch_one(&pool)
    .await
    .expect("extension seconds");
    assert_eq!(extension_seconds, 300);

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

    sat.start_module(
        &schedule.id,
        &attempt_id,
        AssessmentModuleStartRequest {
            module_id: rw_higher_id.clone(),
        },
    )
    .await
    .expect("start adaptive module two");
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
    let now = Utc::now();
    assert!(available_at >= now + Duration::seconds(5));
    assert!(available_at <= now + Duration::seconds(9));
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
        "configured break must gate next section start"
    );

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
    sat.start_module(
        &schedule.id,
        &timeout_candidate.id,
        AssessmentModuleStartRequest {
            module_id: rw_base_id.clone(),
        },
    )
    .await
    .expect("start timeout module");
    sqlx::query(
        "UPDATE assessment_module_attempts SET allocated_seconds = 1, started_at = ? WHERE attempt_id = ? AND module_id = ?",
    )
    .bind(Utc::now() - Duration::seconds(3))
    .bind(&timeout_candidate.id)
    .bind(&rw_base_id)
    .execute(&pool)
    .await
    .expect("expire module");
    let outcomes = sat
        .reconcile_expired_modules_at(Utc::now(), 10)
        .await
        .expect("reconcile SAT expiry");
    assert!(outcomes
        .iter()
        .any(|outcome| outcome.attempt_id == timeout_candidate.id));
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
            module_id: rw_base_id,
        },
    )
    .await
    .expect("start completion candidate");

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
            let domain = if section.section_key == "math" {
                "algebra"
            } else {
                "information-and-ideas"
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
                    "skill": "release-regression",
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
