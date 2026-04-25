#[path = "../support/mysql.rs"]
mod mysql;

use chrono::{Duration, TimeZone, Utc};
use serde_json::json;
use uuid::Uuid;

use ielts_backend_application::{
    builder::BuilderService,
    delivery::{DeliveryService, MutationBatchResponseMode},
    scheduling::SchedulingService,
};
use ielts_backend_domain::{
    attempt::{MutationEnvelope, StudentBootstrapRequest, StudentMutationBatchRequest},
    exam::{CreateExamRequest, ExamType, PublishExamRequest, SaveDraftRequest, Visibility},
    schedule::CreateScheduleRequest,
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
async fn revision_increments_and_mutations_record_applied_revision() {
    let database = mysql::TestDatabase::new(DELIVERY_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).expect("schedule id");
    let service = DeliveryService::new(database.pool().clone());

    let student_key = format!("student-{}-alice", schedule_id);
    let session = service
        .bootstrap(
            schedule_id,
            StudentBootstrapRequest {
                student_key: student_key.clone(),
                candidate_id: "alice".to_owned(),
                candidate_name: "Alice Roe".to_owned(),
                candidate_email: "alice@example.com".to_owned(),
                email: Some("alice@example.com".to_owned()),
                wcode: Some("W123456".to_owned()),
                client_session_id: Uuid::new_v4().to_string(),
            },
        )
        .await
        .expect("bootstrap");
    let attempt = session.attempt.expect("attempt");
    assert_eq!(attempt.revision, 0);

    let client_session_id = Uuid::new_v4().to_string();
    let first = service
        .apply_mutation_batch(
            schedule_id,
            StudentMutationBatchRequest {
                attempt_id: attempt.id,
                student_key: student_key.clone(),
                client_session_id: client_session_id.clone(),
                mutations: vec![
                    MutationEnvelope {
                        id: "m1".to_owned(),
                        seq: 1,
                        timestamp: Utc.with_ymd_and_hms(2026, 1, 10, 9, 10, 0).unwrap(),
                        mutation_type: "answer".to_owned(),
                        payload: json!({"questionId": "q1", "value": "A"}),
                    },
                    MutationEnvelope {
                        id: "m2".to_owned(),
                        seq: 2,
                        timestamp: Utc.with_ymd_and_hms(2026, 1, 10, 9, 10, 5).unwrap(),
                        mutation_type: "writing_answer".to_owned(),
                        payload: json!({"taskId": "task-1", "value": "Draft 1"}),
                    },
                ],
            },
            MutationBatchResponseMode::Full,
            None,
        )
        .await
        .expect("apply first batch");
    let first_attempt = first.attempt.expect("full mutation response includes attempt");
    assert_eq!(first_attempt.revision, 1);
    let attempt_id = first_attempt.id.clone();

    let applied_1: i64 = sqlx::query_scalar(
        "SELECT applied_revision FROM student_attempt_mutations WHERE attempt_id = ? AND client_mutation_id = ?",
    )
    .bind(attempt_id.clone())
    .bind("m1")
    .fetch_one(database.pool())
    .await
    .unwrap();
    assert_eq!(applied_1, 1);

    let second = service
        .apply_mutation_batch(
            schedule_id,
            StudentMutationBatchRequest {
                attempt_id,
                student_key: student_key.clone(),
                client_session_id,
                mutations: vec![MutationEnvelope {
                    id: "m3".to_owned(),
                    seq: 3,
                    timestamp: Utc.with_ymd_and_hms(2026, 1, 10, 9, 11, 0).unwrap(),
                    mutation_type: "answer".to_owned(),
                    payload: json!({"questionId": "q2", "value": "B"}),
                }],
            },
            MutationBatchResponseMode::Full,
            None,
        )
        .await
        .expect("apply second batch");
    let second_attempt = second.attempt.expect("full mutation response includes attempt");
    assert_eq!(second_attempt.revision, 2);

    let applied_2: i64 = sqlx::query_scalar(
        "SELECT applied_revision FROM student_attempt_mutations WHERE attempt_id = ? AND client_mutation_id = ?",
    )
    .bind(second_attempt.id)
    .bind("m3")
    .fetch_one(database.pool())
    .await
    .unwrap();
    assert_eq!(applied_2, 2);

    database.shutdown().await;
}

async fn seed_schedule(pool: &sqlx::MySqlPool) -> ielts_backend_domain::schedule::ExamSchedule {
    let actor = ActorContext::new(Uuid::new_v4().to_string(), ActorRole::Admin);
    let builder_service = BuilderService::new(pool.clone());
    let exam = builder_service
        .create_exam(
            &actor,
            CreateExamRequest {
                slug: "cambridge-19-academic-revision".to_owned(),
                title: "Cambridge 19 Academic Revision".to_owned(),
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
        .get_exam(&actor, exam_id.clone())
        .await
        .expect("exam after draft");

    let published_version = builder_service
        .publish_exam(
            &actor,
            exam_id.clone(),
            PublishExamRequest {
                publish_notes: Some("ready for revision".to_owned()),
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
                cohort_name: "Revision Cohort".to_owned(),
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
