use chrono::{DateTime, Utc};
use ielts_backend_domain::schedule::{
    AlertAckRequest, AttemptCommandRequest, CompleteExamRequest, DegradedLiveState,
    ExamSessionRuntime, ExtendSectionRequest, PresenceAction, ProctorAlert, ProctorPresence,
    ProctorPresenceRequest, ProctorSessionDetail, ProctorSessionSummary, RuntimeStatus,
    SectionRuntimeStatus, SessionAuditLog, SessionNote, StudentSessionSummary, ViolationRule,
};
use ielts_backend_infrastructure::{
    actor_context::{ActorContext, ActorRole},
    authorization::AuthorizationService,
    live_mode::LiveModeService,
    outbox::OutboxRepository,
};
use serde_json::{json, Value};
use sqlx::{FromRow, MySql, MySqlPool};
use thiserror::Error;
use uuid::{fmt::Hyphenated, Uuid};

use crate::delivery::{auto_submit_schedule_attempts_in_tx, DeliveryError};
use crate::scheduling::{SchedulingError, SchedulingService};

#[derive(Error, Debug)]
pub enum ProctoringError {
    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("Conflict: {0}")]
    Conflict(String),
    #[error("Not found")]
    NotFound,
    #[error("Validation error: {0}")]
    Validation(String),
}

pub struct ProctoringService {
    pool: MySqlPool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AutoAdvanceOutcome {
    pub schedule_id: Uuid,
    pub runtime_revision: i64,
}

impl ProctoringService {
    pub fn new(pool: MySqlPool) -> Self {
        Self { pool }
    }

    async fn load_config_snapshot_for_schedule(
        &self,
        schedule_id: Uuid,
    ) -> Result<Value, ProctoringError> {
        sqlx::query_scalar::<_, Value>(
            r#"
            SELECT v.config_snapshot
            FROM exam_schedules s
            JOIN exam_versions v ON v.id = s.published_version_id
            WHERE s.id = ?
            "#,
        )
        .bind(schedule_id.to_string())
        .fetch_optional(&self.pool)
        .await?
        .ok_or(ProctoringError::NotFound)
    }

    fn is_ielts_mode(config_snapshot: &Value) -> bool {
        config_snapshot
            .get("general")
            .and_then(|general| general.get("ieltsMode"))
            .and_then(Value::as_bool)
            .unwrap_or(false)
    }

    fn allowed_extension_minutes(config_snapshot: &Value) -> Vec<i64> {
        config_snapshot
            .get("delivery")
            .and_then(|delivery| delivery.get("allowedExtensionMinutes"))
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(Value::as_i64)
                    .filter(|value| *value > 0)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_else(|| vec![5, 10])
    }

    pub async fn list_sessions(
        &self,
        live_mode_enabled: bool,
    ) -> Result<Vec<ProctorSessionSummary>, ProctoringError> {
        let actor = system_actor();
        let scheduling = SchedulingService::new(self.pool.clone());
        let live_mode = LiveModeService::new(self.pool.clone());
        let schedules = scheduling
            .list_schedules(&actor)
            .await
            .map_err(map_scheduling_error)?;
        let mut items = Vec::with_capacity(schedules.len());

        for schedule in schedules {
            let schedule_id_uuid = Uuid::parse_str(&schedule.id).map_err(|_| ProctoringError::Validation("Invalid schedule ID".to_string()))?;
            let runtime = scheduling
                .get_runtime(&actor, schedule_id_uuid)
                .await
                .map_err(map_scheduling_error)?;
            let student_count: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM student_attempts WHERE schedule_id = ?")
                    .bind(&schedule.id)
                    .fetch_one(&self.pool)
                    .await?;
            let active_count: i64 = sqlx::query_scalar(
                r#"
                SELECT COUNT(*)
                FROM student_attempts
                WHERE schedule_id = ?
                  AND COALESCE(proctor_status, 'active') NOT IN ('terminated', 'paused')
                  AND phase = 'exam'
                "#,
            )
            .bind(&schedule.id)
            .fetch_one(&self.pool)
            .await?;
            let alert_count: i64 = sqlx::query_scalar(
                r#"
                SELECT COUNT(*)
                FROM session_audit_logs
                WHERE schedule_id = ?
                  AND acknowledged_at IS NULL
                  AND action_type IN (
                    'HEARTBEAT_LOST',
                    'DEVICE_CONTINUITY_FAILED',
                    'NETWORK_DISCONNECTED',
                    'AUTO_ACTION',
                    'STUDENT_WARN',
                    'STUDENT_PAUSE',
                    'STUDENT_TERMINATE'
                  )
                "#,
            )
            .bind(&schedule.id)
            .fetch_one(&self.pool)
            .await?;
            let violation_count: i64 = sqlx::query_scalar(
                r#"
                SELECT COUNT(*)
                FROM student_violation_events
                WHERE schedule_id = ?
                "#,
            )
            .bind(&schedule.id)
            .fetch_one(&self.pool)
            .await?;
            let degraded = live_mode
                .snapshot(live_mode_enabled, Some(schedule_id_uuid))
                .await?;

            items.push(ProctorSessionSummary {
                schedule,
                runtime,
                student_count,
                active_count,
                alert_count,
                violation_count,
                degraded_live_mode: degraded.degraded,
            });
        }

        Ok(items)
    }

    #[tracing::instrument(skip(self), fields(schedule_id = %schedule_id))]
    pub async fn get_session_detail(
        &self,
        schedule_id: Uuid,
        live_mode_enabled: bool,
    ) -> Result<ProctorSessionDetail, ProctoringError> {
        let actor = system_actor();
        let scheduling = SchedulingService::new(self.pool.clone());
        let schedule = scheduling
            .get_schedule(&actor, schedule_id)
            .await
            .map_err(map_scheduling_error)?;
        let runtime = scheduling
            .get_runtime(&actor, schedule_id)
            .await
            .map_err(map_scheduling_error)?;
        let degraded = LiveModeService::new(self.pool.clone())
            .snapshot(live_mode_enabled, Some(schedule_id))
            .await?;
        let sessions = self.load_student_sessions(schedule_id, &runtime).await?;
        let audit_logs = self.load_audit_logs(schedule_id).await?;
        let alerts = build_alerts(&audit_logs, &sessions);
        let notes = sqlx::query_as::<_, SessionNote>(
            "SELECT * FROM session_notes WHERE schedule_id = ? ORDER BY created_at DESC",
        )
        .bind(schedule_id.to_string())
        .fetch_all(&self.pool)
        .await?;
        let presence = sqlx::query_as::<_, ProctorPresence>(
            "SELECT * FROM proctor_presence WHERE schedule_id = ? AND left_at IS NULL ORDER BY last_heartbeat_at DESC",
        )
        .bind(schedule_id.to_string())
        .fetch_all(&self.pool)
        .await?;
        let violation_rules = sqlx::query_as::<_, ViolationRule>(
            "SELECT * FROM violation_rules WHERE schedule_id = ? ORDER BY created_at DESC",
        )
        .bind(schedule_id.to_string())
        .fetch_all(&self.pool)
        .await?;

        Ok(ProctorSessionDetail {
            schedule,
            runtime,
            sessions,
            alerts,
            audit_logs,
            notes,
            presence,
            violation_rules,
            degraded_live_mode: degraded.degraded,
        })
    }

    pub async fn live_mode(
        &self,
        schedule_id: Option<Uuid>,
        live_mode_enabled: bool,
    ) -> Result<DegradedLiveState, ProctoringError> {
        LiveModeService::new(self.pool.clone())
            .snapshot(live_mode_enabled, schedule_id)
            .await
            .map_err(ProctoringError::from)
    }

    pub async fn record_presence(
        &self,
        ctx: &ActorContext,
        schedule_id: Uuid,
        proctor_id: &str,
        proctor_name: &str,
        req: ProctorPresenceRequest,
    ) -> Result<Vec<ProctorPresence>, ProctoringError> {
        let scheduling = SchedulingService::new(self.pool.clone());
        let schedule = scheduling
            .get_schedule(ctx, schedule_id)
            .await
            .map_err(map_scheduling_error)?;

        let organization_id = schedule.organization_id.as_ref().and_then(|s| Uuid::parse_str(s).ok());
        if let Some(org_id) = organization_id {
            if !AuthorizationService::can_proctor_schedule(ctx, schedule_id.to_string(), org_id.to_string()) {
                return Err(ProctoringError::NotFound);
            }
        }

        match req.action {
            PresenceAction::Join => {
                // Join should refresh joined_at so proctors can see when someone re-opened the cohort.
                sqlx::query(
                    r#"
                    INSERT INTO proctor_presence (
                        id, schedule_id, proctor_id, proctor_name, status,
                        joined_at, last_heartbeat_at, left_at
                    )
                    VALUES (?, ?, ?, ?, 'active', NOW(), NOW(), NULL)
                    ON DUPLICATE KEY UPDATE
                        proctor_name = VALUES(proctor_name),
                        status = 'active',
                        joined_at = VALUES(joined_at),
                        last_heartbeat_at = VALUES(last_heartbeat_at),
                        left_at = NULL
                    "#,
                )
                .bind(Uuid::new_v4().to_string())
                .bind(schedule_id.to_string())
                .bind(proctor_id)
                .bind(proctor_name)
                .execute(&self.pool)
                .await?;
            }
            PresenceAction::Heartbeat => {
                // Heartbeat should not reset joined_at.
                sqlx::query(
                    r#"
                    INSERT INTO proctor_presence (
                        id, schedule_id, proctor_id, proctor_name, status,
                        joined_at, last_heartbeat_at, left_at
                    )
                    VALUES (?, ?, ?, ?, 'active', NOW(), NOW(), NULL)
                    ON DUPLICATE KEY UPDATE
                        proctor_name = VALUES(proctor_name),
                        status = 'active',
                        last_heartbeat_at = VALUES(last_heartbeat_at),
                        left_at = NULL
                    "#,
                )
                .bind(Uuid::new_v4().to_string())
                .bind(schedule_id.to_string())
                .bind(proctor_id)
                .bind(proctor_name)
                .execute(&self.pool)
                .await?;
            }
            PresenceAction::Leave => {
                sqlx::query(
                    r#"
                    UPDATE proctor_presence
                    SET status = 'left', left_at = NOW(), last_heartbeat_at = NOW()
                    WHERE schedule_id = ? AND proctor_id = ? AND left_at IS NULL
                    "#,
                )
                .bind(schedule_id.to_string())
                .bind(proctor_id)
                .execute(&self.pool)
                .await?;
            }
        }

        sqlx::query_as::<_, ProctorPresence>(
            "SELECT * FROM proctor_presence WHERE schedule_id = ? AND left_at IS NULL ORDER BY last_heartbeat_at DESC",
        )
        .bind(schedule_id.to_string())
        .fetch_all(&self.pool)
        .await
        .map_err(ProctoringError::from)
    }

    pub async fn end_section_now(
        &self,
        ctx: &ActorContext,
        schedule_id: Uuid,
        req: AttemptCommandRequest,
    ) -> Result<ExamSessionRuntime, ProctoringError> {
        let scheduling = SchedulingService::new(self.pool.clone());
        let schedule = scheduling
            .get_schedule(ctx, schedule_id)
            .await
            .map_err(map_scheduling_error)?;

        let organization_id = schedule.organization_id.as_ref().and_then(|s| Uuid::parse_str(s).ok());
        if let Some(org_id) = organization_id {
            if !AuthorizationService::can_proctor_schedule(ctx, schedule_id.to_string(), org_id.to_string()) {
                return Err(ProctoringError::NotFound);
            }
        }

        let config_snapshot = self.load_config_snapshot_for_schedule(schedule_id).await?;
        if Self::is_ielts_mode(&config_snapshot) {
            return Err(ProctoringError::Validation(
                "Proctor section override is disabled in IELTS authentic mode.".to_owned(),
            ));
        }

        let mut tx = self.pool.begin().await?;
        let runtime = sqlx::query_as::<_, RuntimeRow>(
            "SELECT * FROM exam_session_runtimes WHERE schedule_id = ? FOR UPDATE",
        )
        .bind(schedule_id.to_string())
        .fetch_optional(tx.as_mut())
        .await?
        .ok_or(ProctoringError::NotFound)?;
        if runtime.status != RuntimeStatus::Live {
            return Err(ProctoringError::Conflict(
                "Runtime must be live before ending a section.".to_owned(),
            ));
        }

        if let Some(expected) = req.expected_active_section_key.as_deref() {
            match runtime.active_section_key.as_deref() {
                Some(actual) if actual == expected => {}
                Some(_) => {
                    return Err(ProctoringError::Conflict(
                        "Runtime advanced; refresh before retrying.".to_owned(),
                    ));
                }
                None => {
                    return Err(ProctoringError::Conflict(
                        "Runtime has no active section; refresh before retrying.".to_owned(),
                    ));
                }
            }
        }

        let active_section_key = runtime.active_section_key.clone().ok_or_else(|| {
            ProctoringError::Conflict("No active section is available.".to_owned())
        })?;
        let sections = sqlx::query_as::<_, RuntimeSectionRow>(
            "SELECT * FROM exam_session_runtime_sections WHERE runtime_id = ? ORDER BY section_order ASC FOR UPDATE",
        )
        .bind(runtime.id)
        .fetch_all(tx.as_mut())
        .await
        .map_err(ProctoringError::from)?;
        let active_index = sections
            .iter()
            .position(|section| section.section_key == active_section_key)
            .ok_or_else(|| {
                ProctoringError::Conflict("Active section row is missing.".to_owned())
            })?;
        let next_section = sections
            .iter()
            .skip(active_index + 1)
            .find(|section| section.status == SectionRuntimeStatus::Locked);
        let completion_reason = "proctor_end";

        sqlx::query(
            r#"
            UPDATE exam_session_runtime_sections
            SET
                status = ?,
                actual_end_at = NOW(),
                completion_reason = ?,
                paused_at = NULL
            WHERE runtime_id = ? AND section_key = ?
            "#,
        )
        .bind(SectionRuntimeStatus::Completed)
        .bind(completion_reason)
        .bind(runtime.id)
        .bind(&active_section_key)
        .execute(&mut *tx)
        .await?;

        let next_section_key = next_section.map(|section| section.section_key.clone());
        if let Some(section) = next_section {
            sqlx::query(
                r#"
                UPDATE exam_session_runtime_sections
                SET
                    status = ?,
                    available_at = COALESCE(available_at, NOW()),
                    actual_start_at = COALESCE(actual_start_at, NOW())
                WHERE runtime_id = ? AND section_key = ?
                "#,
            )
            .bind(SectionRuntimeStatus::Live)
            .bind(runtime.id)
            .bind(&section.section_key)
            .execute(&mut *tx)
            .await?;

            sqlx::query(
                r#"
                UPDATE exam_session_runtimes
                SET
                    active_section_key = ?,
                    current_section_key = ?,
                    current_section_remaining_seconds = ?,
                    updated_at = NOW(),
                    revision = revision + 1
                WHERE id = ?
                "#,
            )
            .bind(&section.section_key)
            .bind(&section.section_key)
            .bind((section.planned_duration_minutes + section.extension_minutes) * 60)
            .bind(runtime.id)
            .execute(&mut *tx)
            .await?;
        } else {
            sqlx::query(
                r#"
                UPDATE exam_session_runtimes
                SET
                    status = ?,
                    actual_end_at = NOW(),
                    active_section_key = NULL,
                    current_section_key = NULL,
                    current_section_remaining_seconds = 0,
                    waiting_for_next_section = false,
                    updated_at = NOW(),
                    revision = revision + 1
                WHERE id = ?
                "#,
            )
            .bind(RuntimeStatus::Completed)
            .bind(runtime.id)
            .execute(&mut *tx)
            .await?;

            sqlx::query(
                "UPDATE exam_schedules SET status = 'completed', updated_at = NOW(), revision = revision + 1 WHERE id = ?",
            )
            .bind(schedule_id.to_string())
            .execute(&mut *tx)
            .await?;

            auto_submit_schedule_attempts_in_tx(tx.as_mut(), schedule_id, completion_reason)
                .await
                .map_err(|error| match error {
                    DeliveryError::Database(db) => ProctoringError::Database(db),
                    DeliveryError::Conflict { message, .. }
                    | DeliveryError::Validation(message)
                    | DeliveryError::Internal(message) => ProctoringError::Validation(message),
                    DeliveryError::NotFound => ProctoringError::NotFound,
                })?;
        }

        insert_control_event(
            &mut tx,
            runtime.id.into_uuid(),
            schedule_id,
            runtime.exam_id.into_uuid(),
            &ctx.actor_id.to_string(),
            "end_section_now",
            Some(&active_section_key),
            None,
            req.reason.as_deref(),
        )
        .await?;
        insert_audit_log(
            &mut tx,
            schedule_id,
            &ctx.actor_id.to_string(),
            "SECTION_END",
            None,
            Some(json!({ "sectionKey": active_section_key, "reason": req.reason })),
        )
        .await?;
        if let Some(next_key) = &next_section_key {
            insert_audit_log(
                &mut tx,
                schedule_id,
                &ctx.actor_id.to_string(),
                "SECTION_START",
                None,
                Some(json!({ "sectionKey": next_key })),
            )
            .await?;
        } else {
            insert_audit_log(
                &mut tx,
                schedule_id,
                &ctx.actor_id.to_string(),
                "SESSION_END",
                None,
                Some(json!({ "reason": req.reason })),
            )
            .await?;
        }
        OutboxRepository::enqueue_in_tx(
            &mut tx,
            "schedule_runtime",
            &schedule_id.to_string(),
            i64::from(runtime.revision + 1),
            "runtime_changed",
            &json!({ "scheduleId": schedule_id, "event": "end_section_now" }),
        )
        .await?;

        tx.commit().await?;
        SchedulingService::new(self.pool.clone())
            .get_runtime(&system_actor(), schedule_id)
            .await
            .map_err(map_scheduling_error)
    }

    pub async fn extend_section(
        &self,
        ctx: &ActorContext,
        schedule_id: Uuid,
        req: ExtendSectionRequest,
    ) -> Result<ExamSessionRuntime, ProctoringError> {
        let scheduling = SchedulingService::new(self.pool.clone());
        let schedule = scheduling
            .get_schedule(ctx, schedule_id)
            .await
            .map_err(map_scheduling_error)?;

        let organization_id = schedule.organization_id.as_ref().and_then(|s| Uuid::parse_str(s).ok());
        if let Some(org_id) = organization_id {
            if !AuthorizationService::can_proctor_schedule(ctx, schedule_id.to_string(), org_id.to_string()) {
                return Err(ProctoringError::NotFound);
            }
        }

        if req.minutes <= 0 {
            return Err(ProctoringError::Validation(
                "Extension minutes must be greater than zero.".to_owned(),
            ));
        }

        let config_snapshot = self.load_config_snapshot_for_schedule(schedule_id).await?;
        if Self::is_ielts_mode(&config_snapshot) {
            return Err(ProctoringError::Validation(
                "Section extensions are disabled in IELTS authentic mode.".to_owned(),
            ));
        }

        let allowed_extension_minutes = Self::allowed_extension_minutes(&config_snapshot);
        if allowed_extension_minutes.is_empty()
            || !allowed_extension_minutes.contains(&i64::from(req.minutes))
        {
            return Err(ProctoringError::Validation(format!(
                "Extension of {} minutes is not allowed by exam policy.",
                req.minutes
            )));
        }

        let mut tx = self.pool.begin().await?;
        let runtime = sqlx::query_as::<_, RuntimeRow>(
            "SELECT * FROM exam_session_runtimes WHERE schedule_id = ? FOR UPDATE",
        )
        .bind(schedule_id.to_string())
        .fetch_optional(tx.as_mut())
        .await?
        .ok_or(ProctoringError::NotFound)?;

        if let Some(expected) = req.expected_active_section_key.as_deref() {
            match runtime.active_section_key.as_deref() {
                Some(actual) if actual == expected => {}
                Some(_) => {
                    return Err(ProctoringError::Conflict(
                        "Runtime advanced; refresh before retrying.".to_owned(),
                    ));
                }
                None => {
                    return Err(ProctoringError::Conflict(
                        "Runtime has no active section; refresh before retrying.".to_owned(),
                    ));
                }
            }
        }

        let active_section_key = runtime.active_section_key.clone().ok_or_else(|| {
            ProctoringError::Conflict("No active section is available.".to_owned())
        })?;
        let _now = Utc::now();

        sqlx::query(
            r#"
            UPDATE exam_session_runtime_sections
            SET
                extension_minutes = extension_minutes + ?,
                projected_end_at = COALESCE(projected_end_at, NOW()) + INTERVAL ? MINUTE
            WHERE runtime_id = ? AND section_key = ?
            "#,
        )
        .bind(req.minutes)
        .bind(req.minutes)
        .bind(runtime.id)
        .bind(&active_section_key)
        .execute(&mut *tx)
        .await?;

        sqlx::query(
            r#"
            UPDATE exam_session_runtimes
            SET
                current_section_remaining_seconds = current_section_remaining_seconds + (? * 60),
                updated_at = NOW(),
                revision = revision + 1
            WHERE id = ?
            "#,
        )
        .bind(req.minutes)
        .bind(runtime.id)
        .execute(&mut *tx)
        .await?;

        insert_control_event(
            &mut tx,
            runtime.id.into_uuid(),
            schedule_id,
            runtime.exam_id.into_uuid(),
            &ctx.actor_id.to_string(),
            "extend_section",
            Some(&active_section_key),
            Some(req.minutes),
            req.reason.as_deref(),
        )
        .await?;
        insert_audit_log(
            &mut tx,
            schedule_id,
            &ctx.actor_id.to_string(),
            "EXTENSION_GRANTED",
            None,
            Some(json!({ "sectionKey": active_section_key, "minutes": req.minutes, "reason": req.reason })),
        )
        .await?;
        OutboxRepository::enqueue_in_tx(
            &mut tx,
            "schedule_runtime",
            &schedule_id.to_string(),
            i64::from(runtime.revision + 1),
            "runtime_changed",
            &json!({ "scheduleId": schedule_id, "event": "extend_section" }),
        )
        .await?;

        tx.commit().await?;
        SchedulingService::new(self.pool.clone())
            .get_runtime(&system_actor(), schedule_id)
            .await
            .map_err(map_scheduling_error)
    }

    pub async fn complete_exam(
        &self,
        ctx: &ActorContext,
        schedule_id: Uuid,
        req: CompleteExamRequest,
    ) -> Result<ExamSessionRuntime, ProctoringError> {
        let scheduling = SchedulingService::new(self.pool.clone());
        let schedule = scheduling
            .get_schedule(ctx, schedule_id)
            .await
            .map_err(map_scheduling_error)?;

        let organization_id = schedule.organization_id.as_ref().and_then(|s| Uuid::parse_str(s).ok());
        if let Some(org_id) = organization_id {
            if !AuthorizationService::can_proctor_schedule(ctx, schedule_id.to_string(), org_id.to_string()) {
                return Err(ProctoringError::NotFound);
            }
        }

        let runtime = self.load_runtime_row(schedule_id).await?;
        if matches!(
            runtime.status,
            RuntimeStatus::Completed | RuntimeStatus::Cancelled
        ) {
            return SchedulingService::new(self.pool.clone())
                .get_runtime(&system_actor(), schedule_id)
                .await
                .map_err(map_scheduling_error);
        }

        let now = Utc::now();
        let mut tx = self.pool.begin().await?;

        sqlx::query(
            r#"
            UPDATE exam_session_runtimes
            SET
                status = ?,
                actual_end_at = NOW(),
                active_section_key = NULL,
                current_section_key = NULL,
                current_section_remaining_seconds = 0,
                waiting_for_next_section = false,
                updated_at = NOW(),
                revision = revision + 1
            WHERE id = ?
            "#,
        )
        .bind(RuntimeStatus::Completed)
        .bind(runtime.id)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            r#"
            UPDATE exam_session_runtime_sections
            SET
                status = ?,
                actual_end_at = COALESCE(actual_end_at, NOW()),
                completion_reason = COALESCE(completion_reason, 'proctor_complete'),
                paused_at = NULL
            WHERE runtime_id = ?
            "#,
        )
        .bind(SectionRuntimeStatus::Completed)
        .bind(runtime.id)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "UPDATE exam_schedules SET status = 'completed', updated_at = NOW(), revision = revision + 1 WHERE id = ?",
        )
        .bind(schedule_id.to_string())
        .execute(&mut *tx)
        .await?;

        auto_submit_schedule_attempts_in_tx(tx.as_mut(), schedule_id, "proctor_complete")
            .await
            .map_err(|error| match error {
                DeliveryError::Database(db) => ProctoringError::Database(db),
                DeliveryError::Conflict { message, .. }
                | DeliveryError::Validation(message)
                | DeliveryError::Internal(message) => ProctoringError::Validation(message),
                DeliveryError::NotFound => ProctoringError::NotFound,
            })?;

        insert_control_event(
            &mut tx,
            runtime.id.into_uuid(),
            schedule_id,
            runtime.exam_id.into_uuid(),
            &ctx.actor_id.to_string(),
            "complete_runtime",
            None,
            None,
            req.reason.as_deref(),
        )
        .await?;
        insert_audit_log(
            &mut tx,
            schedule_id,
            &ctx.actor_id.to_string(),
            "SESSION_END",
            None,
            Some(json!({ "reason": req.reason })),
        )
        .await?;
        OutboxRepository::enqueue_in_tx(
            &mut tx,
            "schedule_runtime",
            &schedule_id.to_string(),
            i64::from(runtime.revision + 1),
            "runtime_changed",
            &json!({ "scheduleId": schedule_id, "event": "complete_exam" }),
        )
        .await?;

        tx.commit().await?;
        SchedulingService::new(self.pool.clone())
            .get_runtime(&system_actor(), schedule_id)
            .await
            .map_err(map_scheduling_error)
    }

    pub async fn warn_attempt(
        &self,
        ctx: &ActorContext,
        schedule_id: Uuid,
        attempt_id: Uuid,
        req: AttemptCommandRequest,
    ) -> Result<StudentSessionSummary, ProctoringError> {
        let scheduling = SchedulingService::new(self.pool.clone());
        let schedule = scheduling
            .get_schedule(ctx, schedule_id)
            .await
            .map_err(map_scheduling_error)?;

        let organization_id = schedule.organization_id.as_ref().and_then(|s| Uuid::parse_str(s).ok());
        if let Some(org_id) = organization_id {
            if !AuthorizationService::can_access_student_data(ctx, schedule_id.to_string(), "", org_id.to_string()) {
                return Err(ProctoringError::NotFound);
            }
        }

        let description = req
            .message
            .clone()
            .unwrap_or_else(|| "Proctor warning issued.".to_owned());
        let warning_id = Uuid::new_v4();
        let now = Utc::now();
        let warning_json = json!({
            "id": warning_id,
            "type": "PROCTOR_WARNING",
            "severity": "medium",
            "timestamp": now,
            "description": description
        });
        let mut tx = self.pool.begin().await?;

        sqlx::query(
            r#"
            INSERT INTO student_violation_events (
                id, schedule_id, attempt_id, violation_type, severity, description, payload, created_at
            )
            VALUES (?, ?, ?, 'PROCTOR_WARNING', 'medium', ?, ?, NOW())
            "#,
        )
        .bind(warning_id.to_string())
        .bind(schedule_id.to_string())
        .bind(attempt_id.to_string())
        .bind(&description)
        .bind(json!({ "message": description }))
        .execute(&mut *tx)
        .await?;

        sqlx::query(
            r#"
            UPDATE student_attempts
            SET
                proctor_status = 'warned',
                proctor_note = ?,
                proctor_updated_at = NOW(),
                proctor_updated_by = ?,
                last_warning_id = ?,
                violations_snapshot = JSON_MERGE_PRESERVE(COALESCE(violations_snapshot, JSON_ARRAY()), ?),
                updated_at = NOW(),
                revision = revision + 1
            WHERE id = ? AND schedule_id = ?
            "#,
        )
        .bind(&description)
        .bind(&ctx.actor_id.to_string())
        .bind(warning_id.to_string())
        .bind(warning_json)
        .bind(attempt_id.to_string())
        .bind(schedule_id.to_string())
        .execute(&mut *tx)
        .await?;

        insert_audit_log(
            &mut tx,
            schedule_id,
            &ctx.actor_id.to_string(),
            "STUDENT_WARN",
            Some(attempt_id),
            Some(json!({ "message": req.message, "warningId": warning_id, "severity": "medium" })),
        )
        .await?;
        OutboxRepository::enqueue_in_tx(
            &mut tx,
            "schedule_roster",
            &schedule_id.to_string(),
            0,
            "roster_changed",
            &json!({ "scheduleId": schedule_id, "event": "warn_attempt", "attemptId": attempt_id }),
        )
        .await?;

        tx.commit().await?;
        self.load_student_session(schedule_id, attempt_id).await
    }

    pub async fn pause_attempt(
        &self,
        ctx: &ActorContext,
        schedule_id: Uuid,
        attempt_id: Uuid,
        req: AttemptCommandRequest,
    ) -> Result<StudentSessionSummary, ProctoringError> {
        let scheduling = SchedulingService::new(self.pool.clone());
        let schedule = scheduling
            .get_schedule(ctx, schedule_id)
            .await
            .map_err(map_scheduling_error)?;

        let organization_id = schedule.organization_id.as_ref().and_then(|s| Uuid::parse_str(s).ok());
        if let Some(org_id) = organization_id {
            if !AuthorizationService::can_access_student_data(ctx, schedule_id.to_string(), "", org_id.to_string()) {
                return Err(ProctoringError::NotFound);
            }
        }

        self.update_attempt_status(
            schedule_id,
            attempt_id,
            &ctx.actor_id,
            "paused",
            None,
            "STUDENT_PAUSE",
            req,
        )
        .await
    }

    pub async fn resume_attempt(
        &self,
        ctx: &ActorContext,
        schedule_id: Uuid,
        attempt_id: Uuid,
        req: AttemptCommandRequest,
    ) -> Result<StudentSessionSummary, ProctoringError> {
        let scheduling = SchedulingService::new(self.pool.clone());
        let schedule = scheduling
            .get_schedule(ctx, schedule_id)
            .await
            .map_err(map_scheduling_error)?;

        let organization_id = schedule.organization_id.as_ref().and_then(|s| Uuid::parse_str(s).ok());
        if let Some(org_id) = organization_id {
            if !AuthorizationService::can_access_student_data(ctx, schedule_id.to_string(), "", org_id.to_string()) {
                return Err(ProctoringError::NotFound);
            }
        }

        self.update_attempt_status(
            schedule_id,
            attempt_id,
            &ctx.actor_id,
            "active",
            None,
            "STUDENT_RESUME",
            req,
        )
        .await
    }

    pub async fn terminate_attempt(
        &self,
        ctx: &ActorContext,
        schedule_id: Uuid,
        attempt_id: Uuid,
        req: AttemptCommandRequest,
    ) -> Result<StudentSessionSummary, ProctoringError> {
        let scheduling = SchedulingService::new(self.pool.clone());
        let schedule = scheduling
            .get_schedule(ctx, schedule_id)
            .await
            .map_err(map_scheduling_error)?;

        let organization_id = schedule.organization_id.as_ref().and_then(|s| Uuid::parse_str(s).ok());
        if let Some(org_id) = organization_id {
            if !AuthorizationService::can_access_student_data(ctx, schedule_id.to_string(), "", org_id.to_string()) {
                return Err(ProctoringError::NotFound);
            }
        }

        self.update_attempt_status(
            schedule_id,
            attempt_id,
            &ctx.actor_id,
            "terminated",
            Some("post-exam"),
            "STUDENT_TERMINATE",
            req,
        )
        .await
    }

    pub async fn auto_advance_expired_sections(
        &self,
        limit: i64,
    ) -> Result<Vec<AutoAdvanceOutcome>, ProctoringError> {
        let limit = limit.max(1);
        let candidates = sqlx::query_as::<_, AutoAdvanceCandidateRow>(
            r#"
            SELECT r.schedule_id AS schedule_id
            FROM exam_session_runtimes r
            JOIN exam_session_runtime_sections s
              ON s.runtime_id = r.id
             AND s.section_key = r.active_section_key
            JOIN exam_schedules sch
              ON sch.id = r.schedule_id
            JOIN exam_versions v
              ON v.id = sch.published_version_id
            WHERE r.status = 'live'
              AND r.active_section_key IS NOT NULL
              AND s.status = 'live'
              AND s.actual_start_at IS NOT NULL
              AND s.paused_at IS NULL
              AND COALESCE(
                    JSON_UNQUOTE(JSON_EXTRACT(v.config_snapshot, '$.progression.autoSubmit')),
                    'true'
                  ) = 'true'
              AND NOW() >= DATE_ADD(
                    s.actual_start_at,
                    INTERVAL ((s.planned_duration_minutes + s.extension_minutes) * 60 + s.accumulated_paused_seconds) SECOND
                  )
            ORDER BY s.actual_start_at ASC
            LIMIT ?
            "#,
        )
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;

        let mut outcomes = Vec::new();
        for candidate in candidates {
            let schedule_id = match Uuid::parse_str(&candidate.schedule_id) {
                Ok(value) => value,
                Err(_) => continue,
            };
            if let Some(revision) = self.auto_advance_schedule_if_expired(schedule_id).await? {
                outcomes.push(AutoAdvanceOutcome {
                    schedule_id,
                    runtime_revision: revision,
                });
            }
        }

        Ok(outcomes)
    }

    async fn auto_advance_schedule_if_expired(
        &self,
        schedule_id: Uuid,
    ) -> Result<Option<i64>, ProctoringError> {
        let mut tx = self.pool.begin().await?;

        let runtime = sqlx::query_as::<_, RuntimeRow>(
            "SELECT * FROM exam_session_runtimes WHERE schedule_id = ? FOR UPDATE",
        )
        .bind(schedule_id.to_string())
        .fetch_optional(tx.as_mut())
        .await?
        .ok_or(ProctoringError::NotFound)?;

        if runtime.status != RuntimeStatus::Live {
            return Ok(None);
        }

        let active_section_key = match runtime.active_section_key.as_deref() {
            Some(value) if !value.trim().is_empty() => value.to_owned(),
            _ => return Ok(None),
        };

        let sections = sqlx::query_as::<_, RuntimeSectionRow>(
            "SELECT * FROM exam_session_runtime_sections WHERE runtime_id = ? ORDER BY section_order ASC FOR UPDATE",
        )
        .bind(runtime.id)
        .fetch_all(tx.as_mut())
        .await
        .map_err(ProctoringError::from)?;

        let active_index = sections
            .iter()
            .position(|section| section.section_key == active_section_key)
            .ok_or_else(|| ProctoringError::Conflict("Active section row is missing.".to_owned()))?;
        let active_section = sections
            .get(active_index)
            .ok_or_else(|| ProctoringError::Conflict("Active section row is missing.".to_owned()))?;
        if active_section.status != SectionRuntimeStatus::Live {
            return Ok(None);
        }
        if active_section.paused_at.is_some() {
            return Ok(None);
        }
        let Some(actual_start_at) = active_section.actual_start_at else {
            return Ok(None);
        };

        let now = Utc::now();
        let computed = compute_section_remaining_seconds(
            actual_start_at,
            active_section.planned_duration_minutes,
            active_section.extension_minutes,
            active_section.paused_at,
            active_section.accumulated_paused_seconds,
            active_section.status.clone(),
            now,
        );
        if computed > 0 {
            return Ok(None);
        }

        let completion_reason = "time_expired";
        sqlx::query(
            r#"
            UPDATE exam_session_runtime_sections
            SET
                status = ?,
                actual_end_at = NOW(),
                completion_reason = ?,
                paused_at = NULL
            WHERE runtime_id = ? AND section_key = ?
            "#,
        )
        .bind(SectionRuntimeStatus::Completed)
        .bind(completion_reason)
        .bind(runtime.id)
        .bind(&active_section_key)
        .execute(tx.as_mut())
        .await?;

        let next_section = sections
            .iter()
            .skip(active_index + 1)
            .find(|section| section.status == SectionRuntimeStatus::Locked);
        let next_section_key = next_section.map(|section| section.section_key.clone());

        if let Some(section) = next_section {
            sqlx::query(
                r#"
                UPDATE exam_session_runtime_sections
                SET
                    status = ?,
                    available_at = COALESCE(available_at, NOW()),
                    actual_start_at = COALESCE(actual_start_at, NOW())
                WHERE runtime_id = ? AND section_key = ?
                "#,
            )
            .bind(SectionRuntimeStatus::Live)
            .bind(runtime.id)
            .bind(&section.section_key)
            .execute(tx.as_mut())
            .await?;

            sqlx::query(
                r#"
                UPDATE exam_session_runtimes
                SET
                    active_section_key = ?,
                    current_section_key = ?,
                    current_section_remaining_seconds = ?,
                    waiting_for_next_section = false,
                    updated_at = NOW(),
                    revision = revision + 1
                WHERE id = ?
                "#,
            )
            .bind(&section.section_key)
            .bind(&section.section_key)
            .bind((section.planned_duration_minutes + section.extension_minutes) * 60)
            .bind(runtime.id)
            .execute(tx.as_mut())
            .await?;
        } else {
            sqlx::query(
                r#"
                UPDATE exam_session_runtimes
                SET
                    status = ?,
                    actual_end_at = NOW(),
                    active_section_key = NULL,
                    current_section_key = NULL,
                    current_section_remaining_seconds = 0,
                    waiting_for_next_section = false,
                    updated_at = NOW(),
                    revision = revision + 1
                WHERE id = ?
                "#,
            )
            .bind(RuntimeStatus::Completed)
            .bind(runtime.id)
            .execute(tx.as_mut())
            .await?;

            sqlx::query(
                "UPDATE exam_schedules SET status = 'completed', updated_at = NOW(), revision = revision + 1 WHERE id = ?",
            )
            .bind(schedule_id.to_string())
            .execute(tx.as_mut())
            .await?;

            auto_submit_schedule_attempts_in_tx(tx.as_mut(), schedule_id, completion_reason)
                .await
                .map_err(|error| match error {
                    DeliveryError::Database(db) => ProctoringError::Database(db),
                    DeliveryError::Conflict { message, .. }
                    | DeliveryError::Validation(message)
                    | DeliveryError::Internal(message) => ProctoringError::Validation(message),
                    DeliveryError::NotFound => ProctoringError::NotFound,
                })?;
        }

        insert_audit_log(
            &mut tx,
            schedule_id,
            "system",
            "SECTION_END",
            None,
            Some(json!({ "sectionKey": active_section_key, "reason": completion_reason })),
        )
        .await?;
        if let Some(next_key) = &next_section_key {
            insert_audit_log(
                &mut tx,
                schedule_id,
                "system",
                "SECTION_START",
                None,
                Some(json!({ "sectionKey": next_key })),
            )
            .await?;
        } else {
            insert_audit_log(
                &mut tx,
                schedule_id,
                "system",
                "SESSION_END",
                None,
                Some(json!({ "reason": completion_reason })),
            )
            .await?;
        }

        tx.commit().await?;

        Ok(Some(i64::from(runtime.revision + 1)))
    }

    #[tracing::instrument(skip(self), fields(alert_id = %alert_id, actor_id = %ctx.actor_id))]
    pub async fn acknowledge_alert(
        &self,
        ctx: &ActorContext,
        alert_id: Uuid,
        _req: AlertAckRequest,
    ) -> Result<SessionAuditLog, ProctoringError> {
        // Get the alert to check which schedule it belongs to
        let alert: SessionAuditLog = sqlx::query_as(
            "SELECT * FROM session_audit_logs WHERE id = ?"
        )
        .bind(alert_id.to_string())
        .fetch_optional(&self.pool)
        .await?
        .ok_or(ProctoringError::NotFound)?;

        let scheduling = SchedulingService::new(self.pool.clone());
        let schedule_id_uuid = Uuid::parse_str(&alert.schedule_id).map_err(|_| ProctoringError::Validation("Invalid schedule ID".to_string()))?;
        let schedule = scheduling
            .get_schedule(ctx, schedule_id_uuid)
            .await
            .map_err(map_scheduling_error)?;

        let organization_id = schedule.organization_id.as_ref().and_then(|s| Uuid::parse_str(s).ok());
        if let Some(org_id) = organization_id {
            if !AuthorizationService::can_access_student_data(ctx, schedule_id_uuid.to_string(), "", org_id.to_string()) {
                return Err(ProctoringError::NotFound);
            }
        }

        sqlx::query(
            r#"
            UPDATE session_audit_logs
            SET acknowledged_at = NOW(), acknowledged_by = ?
            WHERE id = ?
            "#,
        )
        .bind(&ctx.actor_id.to_string())
        .bind(alert_id.to_string())
        .execute(&self.pool)
            .await?;

        sqlx::query_as::<_, SessionAuditLog>("SELECT * FROM session_audit_logs WHERE id = ?")
            .bind(alert_id.to_string())
            .fetch_optional(&self.pool)
            .await?
            .ok_or(ProctoringError::NotFound)
    }

    async fn update_attempt_status(
        &self,
        schedule_id: Uuid,
        attempt_id: Uuid,
        actor_id: &str,
        proctor_status: &str,
        phase: Option<&str>,
        action_type: &str,
        req: AttemptCommandRequest,
    ) -> Result<StudentSessionSummary, ProctoringError> {
        let now = Utc::now();
        let mut tx = self.pool.begin().await?;

        sqlx::query(
            r#"
            UPDATE student_attempts
            SET
                proctor_status = ?,
                phase = COALESCE(?, phase),
                proctor_note = COALESCE(?, proctor_note),
                proctor_updated_at = NOW(),
                proctor_updated_by = ?,
                updated_at = NOW(),
                revision = revision + 1
            WHERE id = ? AND schedule_id = ?
            "#,
        )
        .bind(proctor_status)
        .bind(phase)
        .bind(req.reason.clone().or(req.message.clone()))
        .bind(actor_id)
        .bind(attempt_id.to_string())
        .bind(schedule_id.to_string())
        .execute(&mut *tx)
        .await?;

        insert_audit_log(
            &mut tx,
            schedule_id,
            actor_id,
            action_type,
            Some(attempt_id),
            Some(json!({ "message": req.message, "reason": req.reason })),
        )
        .await?;
        OutboxRepository::enqueue_in_tx(
            &mut tx,
            "schedule_roster",
            &schedule_id.to_string(),
            0,
            "roster_changed",
            &json!({ "scheduleId": schedule_id, "event": action_type, "attemptId": attempt_id }),
        )
        .await?;

        tx.commit().await?;
        self.load_student_session(schedule_id, attempt_id).await
    }

    async fn load_student_sessions(
        &self,
        schedule_id: Uuid,
        runtime: &ExamSessionRuntime,
    ) -> Result<Vec<StudentSessionSummary>, ProctoringError> {
        let rows = sqlx::query_as::<_, AttemptProjectionRow>(
            r#"
            SELECT
                id,
                candidate_id,
                candidate_name,
                candidate_email,
                schedule_id,
                current_module,
                phase,
                integrity,
                violations_snapshot,
                exam_id,
                exam_title,
                updated_at,
                COALESCE(proctor_status, 'active') AS proctor_status,
                last_warning_id
            FROM student_attempts
            WHERE schedule_id = ?
            ORDER BY updated_at DESC
            "#,
        )
        .bind(schedule_id.to_string())
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .into_iter()
            .map(|row| attempt_row_to_session(row, runtime))
            .collect())
    }

    async fn load_student_session(
        &self,
        schedule_id: Uuid,
        attempt_id: Uuid,
    ) -> Result<StudentSessionSummary, ProctoringError> {
        let runtime = SchedulingService::new(self.pool.clone())
            .get_runtime(&system_actor(), schedule_id)
            .await
            .map_err(map_scheduling_error)?;
        let row = sqlx::query_as::<_, AttemptProjectionRow>(
            r#"
            SELECT
                id,
                candidate_id,
                candidate_name,
                candidate_email,
                schedule_id,
                current_module,
                phase,
                integrity,
                violations_snapshot,
                exam_id,
                exam_title,
                updated_at,
                COALESCE(proctor_status, 'active') AS proctor_status,
                last_warning_id
            FROM student_attempts
            WHERE id = ? AND schedule_id = ?
            "#,
        )
        .bind(attempt_id.to_string())
        .bind(schedule_id.to_string())
        .fetch_optional(&self.pool)
        .await?
        .ok_or(ProctoringError::NotFound)?;

        Ok(attempt_row_to_session(row, &runtime))
    }

    async fn load_runtime_row(&self, schedule_id: Uuid) -> Result<RuntimeRow, ProctoringError> {
        sqlx::query_as::<_, RuntimeRow>(
            "SELECT * FROM exam_session_runtimes WHERE schedule_id = ?",
        )
        .bind(schedule_id.to_string())
        .fetch_optional(&self.pool)
        .await?
        .ok_or(ProctoringError::NotFound)
    }

    async fn load_runtime_section_rows(
        &self,
        runtime_id: Uuid,
    ) -> Result<Vec<RuntimeSectionRow>, ProctoringError> {
        sqlx::query_as::<_, RuntimeSectionRow>(
            "SELECT * FROM exam_session_runtime_sections WHERE runtime_id = ? ORDER BY section_order ASC",
        )
        .bind(runtime_id.hyphenated())
        .fetch_all(&self.pool)
        .await
        .map_err(ProctoringError::from)
    }

    async fn load_audit_logs(
        &self,
        schedule_id: Uuid,
    ) -> Result<Vec<SessionAuditLog>, ProctoringError> {
        sqlx::query_as::<_, SessionAuditLog>(
            "SELECT * FROM session_audit_logs WHERE schedule_id = ? ORDER BY created_at DESC",
        )
        .bind(schedule_id.to_string())
        .fetch_all(&self.pool)
        .await
        .map_err(ProctoringError::from)
    }
}

#[derive(FromRow)]
struct AttemptProjectionRow {
    id: Hyphenated,
    candidate_id: String,
    candidate_name: String,
    candidate_email: String,
    schedule_id: Hyphenated,
    current_module: String,
    phase: String,
    integrity: Value,
    violations_snapshot: Value,
    exam_id: Hyphenated,
    exam_title: String,
    updated_at: DateTime<Utc>,
    proctor_status: String,
    last_warning_id: Option<String>,
}

#[derive(FromRow)]
struct RuntimeRow {
    id: Hyphenated,
    exam_id: Hyphenated,
    status: RuntimeStatus,
    active_section_key: Option<String>,
    revision: i32,
}

#[derive(FromRow)]
struct RuntimeSectionRow {
    section_key: String,
    section_order: i32,
    planned_duration_minutes: i32,
    extension_minutes: i32,
    status: SectionRuntimeStatus,
    actual_start_at: Option<DateTime<Utc>>,
    paused_at: Option<DateTime<Utc>>,
    accumulated_paused_seconds: i32,
}

#[derive(FromRow)]
struct AutoAdvanceCandidateRow {
    schedule_id: String,
}

fn compute_section_remaining_seconds(
    actual_start_at: DateTime<Utc>,
    planned_duration_minutes: i32,
    extension_minutes: i32,
    paused_at: Option<DateTime<Utc>>,
    accumulated_paused_seconds: i32,
    status: SectionRuntimeStatus,
    now: DateTime<Utc>,
) -> i32 {
    let duration_seconds = i64::from(planned_duration_minutes.saturating_add(extension_minutes))
        .saturating_mul(60);

    let time_base = if status == SectionRuntimeStatus::Paused || paused_at.is_some() {
        paused_at.unwrap_or(now)
    } else {
        now
    };

    let raw_elapsed_seconds = (time_base - actual_start_at).num_seconds().max(0);
    let elapsed_seconds = raw_elapsed_seconds
        .saturating_sub(i64::from(accumulated_paused_seconds.max(0)));
    let remaining_seconds = (duration_seconds - elapsed_seconds).clamp(0, duration_seconds);

    remaining_seconds as i32
}

fn system_actor() -> ActorContext {
    ActorContext::new(Uuid::nil().to_string(), ActorRole::Admin)
}

fn map_scheduling_error(error: SchedulingError) -> ProctoringError {
    match error {
        SchedulingError::Database(error) => ProctoringError::Database(error),
        SchedulingError::Conflict(message) => ProctoringError::Conflict(message),
        SchedulingError::NotFound => ProctoringError::NotFound,
        SchedulingError::Validation(message) => ProctoringError::Validation(message),
    }
}

fn attempt_row_to_session(
    row: AttemptProjectionRow,
    runtime: &ExamSessionRuntime,
) -> StudentSessionSummary {
    let heartbeat_status = row
        .integrity
        .get("lastHeartbeatStatus")
        .and_then(Value::as_str)
        .unwrap_or("idle");
    let status = if row.proctor_status == "terminated" || row.phase == "post-exam" {
        "terminated".to_owned()
    } else if row.proctor_status == "paused" {
        "paused".to_owned()
    } else if heartbeat_status == "lost" {
        "connecting".to_owned()
    } else if row.proctor_status == "warned" {
        "warned".to_owned()
    } else if row.phase == "exam" {
        "active".to_owned()
    } else {
        "idle".to_owned()
    };
    let runtime_section_status = runtime
        .sections
        .iter()
        .find(|section| Some(section.section_key.clone()) == runtime.current_section_key)
        .map(|section| section_status_name(&section.status));
    let last_activity = row
        .integrity
        .get("lastHeartbeatAt")
        .and_then(Value::as_str)
        .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
        .map(|value| value.with_timezone(&Utc))
        .unwrap_or(row.updated_at);
    let warnings = row
        .violations_snapshot
        .as_array()
        .map(|violations| {
            violations
                .iter()
                .filter(|entry| {
                    matches!(
                        entry.get("type").and_then(Value::as_str),
                        Some("PROCTOR_WARNING") | Some("AUTO_WARNING")
                    )
                })
                .count() as i32
        })
        .unwrap_or_else(|| i32::from(row.last_warning_id.is_some()));

    StudentSessionSummary {
        attempt_id: row.id.to_string(),
        student_id: row.candidate_id,
        student_name: row.candidate_name,
        student_email: row.candidate_email,
        schedule_id: row.schedule_id.to_string(),
        status,
        current_section: row.current_module,
        time_remaining: runtime.current_section_remaining_seconds,
        runtime_status: runtime.status.clone(),
        runtime_current_section: runtime.current_section_key.clone(),
        runtime_time_remaining_seconds: runtime.current_section_remaining_seconds,
        runtime_section_status,
        runtime_waiting: runtime.waiting_for_next_section,
        violations: row.violations_snapshot,
        warnings,
        last_activity,
        exam_id: row.exam_id.into_uuid(),
        exam_name: row.exam_title,
    }
}

fn build_alerts(
    audit_logs: &[SessionAuditLog],
    sessions: &[StudentSessionSummary],
) -> Vec<ProctorAlert> {
    audit_logs
        .iter()
        .filter(|log| {
            matches!(
                log.action_type.as_str(),
                "HEARTBEAT_LOST"
                    | "DEVICE_CONTINUITY_FAILED"
                    | "NETWORK_DISCONNECTED"
                    | "AUTO_ACTION"
                    | "STUDENT_WARN"
                    | "STUDENT_PAUSE"
                    | "STUDENT_TERMINATE"
            )
        })
        .map(|log| {
            let session = log
                .target_student_id
                .as_ref()
                .and_then(|target| sessions.iter().find(|session| session.attempt_id == *target));
            let severity = log
                .payload
                .as_ref()
                .and_then(|payload| payload.get("severity"))
                .and_then(Value::as_str)
                .unwrap_or(match log.action_type.as_str() {
                    "DEVICE_CONTINUITY_FAILED" | "STUDENT_TERMINATE" => "critical",
                    "HEARTBEAT_LOST" | "NETWORK_DISCONNECTED" => "high",
                    "STUDENT_WARN" => "medium",
                    _ => "medium",
                })
                .to_owned();
            let message = log
                .payload
                .as_ref()
                .and_then(|payload| payload.get("message").or_else(|| payload.get("reason")))
                .and_then(Value::as_str)
                .unwrap_or_else(|| default_alert_message(&log.action_type))
                .to_owned();

            ProctorAlert {
                id: Uuid::parse_str(&log.id).unwrap_or(Uuid::nil()),
                severity,
                alert_type: log.action_type.clone(),
                student_name: session
                    .map(|session| session.student_name.clone())
                    .unwrap_or_else(|| "Candidate".to_owned()),
                student_id: session
                    .map(|session| session.student_id.clone())
                    .unwrap_or_else(|| "unknown".to_owned()),
                timestamp: log.created_at,
                message,
                is_acknowledged: log.acknowledged_at.is_some(),
            }
        })
        .collect()
}

fn default_alert_message(action_type: &str) -> &'static str {
    match action_type {
        "HEARTBEAT_LOST" => "Candidate heartbeat was lost.",
        "DEVICE_CONTINUITY_FAILED" => "Device continuity validation failed.",
        "NETWORK_DISCONNECTED" => "Candidate went offline.",
        "STUDENT_WARN" => "Proctor warning issued.",
        "STUDENT_PAUSE" => "Candidate session paused by proctor.",
        "STUDENT_TERMINATE" => "Candidate session terminated by proctor.",
        _ => "Monitoring alert detected.",
    }
}

fn section_status_name(status: &SectionRuntimeStatus) -> String {
    match status {
        SectionRuntimeStatus::Locked => "locked",
        SectionRuntimeStatus::Live => "live",
        SectionRuntimeStatus::Paused => "paused",
        SectionRuntimeStatus::Completed => "completed",
    }
    .to_owned()
}

#[allow(clippy::too_many_arguments)]
async fn insert_control_event(
    tx: &mut sqlx::Transaction<'_, sqlx::MySql>,
    runtime_id: Uuid,
    schedule_id: Uuid,
    exam_id: Uuid,
    actor_id: &str,
    action: &str,
    section_key: Option<&str>,
    minutes: Option<i32>,
    reason: Option<&str>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        INSERT INTO cohort_control_events (
            id, schedule_id, runtime_id, exam_id, actor_id, action, section_key, minutes, reason, payload, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
        "#,
    )
    .bind(Uuid::new_v4().to_string())
    .bind(schedule_id.to_string())
    .bind(runtime_id.to_string())
    .bind(exam_id.to_string())
    .bind(actor_id)
    .bind(action)
    .bind(section_key)
    .bind(minutes)
    .bind(reason)
    .bind(json!(null))
    .execute(tx.as_mut())
    .await?;

    Ok(())
}

async fn insert_audit_log(
    tx: &mut sqlx::Transaction<'_, sqlx::MySql>,
    schedule_id: Uuid,
    actor: &str,
    action_type: &str,
    target_attempt_id: Option<Uuid>,
    metadata: Option<Value>,
) -> Result<(), sqlx::Error> {
    let target_attempt_id = target_attempt_id.map(|value| value.to_string());
    sqlx::query(
        r#"
        INSERT INTO session_audit_logs (
            id, schedule_id, actor, action_type, target_student_id, payload, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, NOW())
        "#,
    )
    .bind(Uuid::new_v4().to_string())
    .bind(schedule_id.to_string())
    .bind(actor)
    .bind(action_type)
    .bind(target_attempt_id)
    .bind(metadata)
    .execute(tx.as_mut())
    .await?;

    Ok(())
}
