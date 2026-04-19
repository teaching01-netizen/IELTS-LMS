#[path = "../support/mysql.rs"]
mod mysql;

use chrono::{Duration, TimeZone, Utc};
use serde_json::json;
use uuid::Uuid;

use ielts_backend_application::{builder::BuilderService, scheduling::SchedulingService};
use ielts_backend_domain::{
    exam::{CreateExamRequest, ExamType, PublishExamRequest, SaveDraftRequest, Visibility},
    schedule::CreateScheduleRequest,
};
use ielts_backend_infrastructure::actor_context::{ActorContext, ActorRole};

const SCHEDULING_MIGRATIONS: &[&str] = &[
    "0001_roles.sql",
    "0002_rls_helpers.sql",
    "0003_exam_core.sql",
    "0004_library_and_defaults.sql",
    "0005_scheduling_and_access.sql",
    "0006_delivery.sql",
    "0007_proctoring.sql",
    "0010_auth_security.sql",
];

#[tokio::test]
async fn registration_rejects_invalid_wcode_and_prevents_duplicates() {
    let database = mysql::TestDatabase::new(SCHEDULING_MIGRATIONS).await;
    let schedule = seed_schedule(database.pool()).await;
    let schedule_id = Uuid::parse_str(&schedule.id).expect("schedule id");
    let service = SchedulingService::new(database.pool().clone());
    let actor = ActorContext::new(Uuid::new_v4().to_string(), ActorRole::Admin);
    let user_id = Uuid::new_v4();

    let invalid = service
        .create_student_registration(
            &actor,
            schedule_id,
            "123456".to_owned(),
            "alice@example.com".to_owned(),
            "Alice Roe".to_owned(),
            user_id,
        )
        .await;
    assert!(invalid.is_err());

    let created = service
        .create_student_registration(
            &actor,
            schedule_id,
            "W123456".to_owned(),
            "alice@example.com".to_owned(),
            "Alice Roe".to_owned(),
            user_id,
        )
        .await
        .expect("create registration");
    assert_eq!(created.wcode, "W123456");
    assert_eq!(
        created.student_key,
        format!("student-{}-W123456", schedule_id)
    );

    let duplicate = service
        .create_student_registration(
            &actor,
            schedule_id,
            "W123456".to_owned(),
            "other@example.com".to_owned(),
            "Other Name".to_owned(),
            Uuid::new_v4(),
        )
        .await;
    assert!(duplicate.is_err());

    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM schedule_registrations WHERE schedule_id = ? AND wcode = ?",
    )
    .bind(schedule_id.to_string())
    .bind("W123456")
    .fetch_one(database.pool())
    .await
    .unwrap();
    assert_eq!(count, 1);

    database.shutdown().await;
}

async fn seed_schedule(pool: &sqlx::MySqlPool) -> ielts_backend_domain::schedule::ExamSchedule {
    let actor = ActorContext::new(Uuid::new_v4().to_string(), ActorRole::Admin);
    let builder_service = BuilderService::new(pool.clone());
    let exam = builder_service
        .create_exam(
            &actor,
            CreateExamRequest {
                slug: "cambridge-19-academic-registration".to_owned(),
                title: "Cambridge 19 Academic Registration".to_owned(),
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
                publish_notes: Some("ready for registration".to_owned()),
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
                cohort_name: "Registration Cohort".to_owned(),
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
