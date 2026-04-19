#[path = "../support/mysql.rs"]
mod mysql;

use chrono::{Duration, TimeZone, Utc};
use serde_json::json;
use uuid::Uuid;

use ielts_backend_application::{
    builder::BuilderService, delivery::DeliveryService, scheduling::SchedulingService,
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
    "0010_auth_security.sql",
];

#[tokio::test]
async fn phase_progression_precheck_lobby_exam_post_exam() {
    let database = mysql::TestDatabase::new(DELIVERY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).expect("schedule id");
    let service = DeliveryService::new(database.pool().clone());

    let student_key = format!("student-{}-alice", schedule_id);
    let wcode = "W123456".to_owned();

    let bootstrap = service
        .bootstrap(
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
    let attempt = bootstrap.attempt.expect("attempt");
    assert_eq!(attempt.phase, "pre-check");

    let precheck = service
        .persist_precheck(
            schedule_id,
            StudentPrecheckRequest {
                attempt_id: None,
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
        )
        .await
        .expect("persist precheck");
    assert_eq!(precheck.phase, "lobby");

    SchedulingService::new(database.pool().clone())
        .apply_runtime_command(
            &ActorContext::new(Uuid::new_v4().to_string(), ActorRole::Admin),
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
    assert_eq!(attempt_after_runtime.phase, "exam");

    let submitted = service
        .submit_attempt(
            schedule_id,
            StudentSubmitRequest {
                attempt_id: attempt_after_runtime.id.clone(),
                student_key: student_key.clone(),
            },
            None,
        )
        .await
        .expect("submit");
    assert_eq!(submitted.attempt.phase, "post-exam");

    let stored_phase: String =
        sqlx::query_scalar("SELECT phase FROM student_attempts WHERE id = ?")
            .bind(attempt_after_runtime.id)
            .fetch_one(database.pool())
            .await
            .unwrap();
    assert_eq!(stored_phase, "post-exam");

    database.shutdown().await;
}

async fn seed_schedule(pool: &sqlx::MySqlPool) -> ielts_backend_domain::schedule::ExamSchedule {
    let actor = ActorContext::new(Uuid::new_v4().to_string(), ActorRole::Admin);
    let builder_service = BuilderService::new(pool.clone());
    let exam = builder_service
        .create_exam(
            &actor,
            CreateExamRequest {
                slug: "cambridge-19-academic-lifecycle".to_owned(),
                title: "Cambridge 19 Academic Lifecycle".to_owned(),
                exam_type: ExamType::Academic.as_str().to_owned(),
                visibility: Visibility::Organization.as_str().to_owned(),
                organization_id: Some("org-1".to_owned()),
            },
        )
        .await
        .expect("seed exam");

    builder_service
        .save_draft(
            &actor,
            exam.id,
            SaveDraftRequest {
                content_snapshot: json!({
                    "reading": {"passages": [{"id": "reading-1"}]},
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
        .get_exam(&actor, exam.id)
        .await
        .expect("exam after draft");

    let published_version = builder_service
        .publish_exam(
            &actor,
            exam.id,
            PublishExamRequest {
                publish_notes: Some("ready for lifecycle".to_owned()),
                revision: exam_after_draft.revision,
            },
        )
        .await
        .expect("publish exam");

    SchedulingService::new(pool.clone())
        .create_schedule(
            &actor,
            CreateScheduleRequest {
                exam_id: exam.id,
                published_version_id: published_version.id,
                cohort_name: "Lifecycle Cohort".to_owned(),
                institution: Some("IELTS Centre".to_owned()),
                start_time: Utc.with_ymd_and_hms(2026, 1, 10, 9, 0, 0).unwrap(),
                end_time: Utc.with_ymd_and_hms(2026, 1, 10, 9, 0, 0).unwrap()
                    + Duration::minutes(180),
                auto_start: false,
                auto_stop: false,
                delivery_mode: ielts_backend_domain::schedule::DeliveryMode::ProctorStart,
                recurrence_type: ielts_backend_domain::schedule::RecurrenceType::Once,
                recurrence_param: None,
                organization_id: Some("org-1".to_owned()),
                metadata: None,
            },
        )
        .await
        .expect("create schedule")
}
