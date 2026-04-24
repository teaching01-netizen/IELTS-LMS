use chrono::{DateTime, Duration, Utc};
use ielts_backend_domain::schedule::{
    validate_email, validate_wcode, CreateScheduleRequest, DeliveryMode, ExamSchedule,
    ExamSessionRuntime, RecurrenceType, RuntimeCommandAction, RuntimeCommandEvent,
    RuntimeCommandRequest, RuntimeSectionState, RuntimeStatus, ScheduleSectionPlanEntry,
    ScheduleRegistration, ScheduleStatus, SectionRuntimeStatus, UpdateScheduleRequest,
};
use ielts_backend_infrastructure::{
    actor_context::ActorContext,
    authorization::AuthorizationService,
};
use serde_json::Value;
use sqlx::{FromRow, MySql, MySqlPool};
use thiserror::Error;
use uuid::{fmt::Hyphenated, Uuid};

use crate::delivery::{auto_submit_schedule_attempts_in_tx, DeliveryError};

#[derive(Error, Debug)]
pub enum SchedulingError {
    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("Conflict: {0}")]
    Conflict(String),
    #[error("Not found")]
    NotFound,
    #[error("Validation error: {0}")]
    Validation(String),
}

pub struct SchedulingService {
    pool: MySqlPool,
}

impl SchedulingService {
    pub fn new(pool: MySqlPool) -> Self {
        Self { pool }
    }

    async fn load_config_snapshot_for_schedule(
        &self,
        schedule_id: Uuid,
    ) -> Result<Value, SchedulingError> {
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
        .ok_or(SchedulingError::NotFound)
    }

    fn is_ielts_mode(config_snapshot: &Value) -> bool {
        config_snapshot
            .get("general")
            .and_then(|general| general.get("ieltsMode"))
            .and_then(Value::as_bool)
            .unwrap_or(false)
    }

    fn allow_pause(config_snapshot: &Value) -> bool {
        config_snapshot
            .get("progression")
            .and_then(|progression| progression.get("allowPause"))
            .and_then(Value::as_bool)
            .unwrap_or(false)
    }

    async fn load_registration_by_wcode(
        &self,
        schedule_id: Uuid,
        wcode: &str,
    ) -> Result<Option<ScheduleRegistrationRow>, SchedulingError> {
        sqlx::query_as::<_, ScheduleRegistrationRow>(
            r#"
            SELECT
                id,
                schedule_id,
                wcode,
                student_email,
                student_key,
                actor_id,
                student_id,
                student_name,
                access_state,
                allowed_from,
                allowed_until,
                extra_time_minutes,
                seat_label,
                metadata,
                created_at,
                updated_at,
                revision,
                user_id
            FROM schedule_registrations
            WHERE schedule_id = ?
              AND wcode = ?
            LIMIT 1
            "#,
        )
        .bind(schedule_id.to_string())
        .bind(wcode)
        .fetch_optional(&self.pool)
        .await
        .map_err(SchedulingError::from)
    }

    async fn update_registration_contact(
        &self,
        schedule_id: Uuid,
        wcode: &str,
        email: &str,
        student_name: &str,
        user_id: Uuid,
    ) -> Result<ScheduleRegistrationRow, SchedulingError> {
        sqlx::query(
            r#"
            UPDATE schedule_registrations
            SET
                student_email = ?,
                student_name = ?,
                student_id = ?,
                access_state = CASE
                    WHEN access_state = 'invited' THEN 'checked_in'
                    ELSE access_state
                END,
                user_id = ?,
                actor_id = ?,
                updated_at = NOW(),
                revision = revision + 1
            WHERE schedule_id = ?
              AND wcode = ?
            "#,
        )
        .bind(email)
        .bind(student_name)
        .bind(wcode)
        .bind(user_id.to_string())
        .bind(user_id.to_string())
        .bind(schedule_id.to_string())
        .bind(wcode)
        .execute(&self.pool)
        .await?;

        self.load_registration_by_wcode(schedule_id, wcode)
            .await?
            .ok_or(SchedulingError::NotFound)
    }

    pub async fn create_schedule(
        &self,
        ctx: &ActorContext,
        req: CreateScheduleRequest,
    ) -> Result<ExamSchedule, SchedulingError> {
        let exam = self.load_exam_context(req.exam_id.clone()).await?;
        let version = self.load_version_context(req.published_version_id.clone()).await?;

        if version.exam_id.to_string() != req.exam_id {
            return Err(SchedulingError::Validation(
                "Published version does not belong to the requested exam.".to_owned(),
            ));
        }

        let plan = build_section_plan(&version.config_snapshot)?;
        let planned_duration_minutes = plan_total_minutes(&plan);
        validate_schedule_window(req.start_time, req.end_time, planned_duration_minutes)?;

        let schedule_id = Uuid::new_v4();
        sqlx::query(
            r#"
            INSERT INTO exam_schedules (
                id, exam_id, organization_id, exam_title, published_version_id, cohort_name,
                institution, start_time, end_time, planned_duration_minutes, delivery_mode,
                recurrence_type, recurrence_interval, auto_start, auto_stop, status, created_by,
                created_at, updated_at, revision
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), ?)
            "#,
        )
        .bind(schedule_id.to_string())
        .bind(&req.exam_id)
        .bind(&exam.organization_id)
        .bind(&exam.title)
        .bind(&req.published_version_id)
        .bind(&req.cohort_name)
        .bind(req.institution)
        .bind(req.start_time)
        .bind(req.end_time)
        .bind(planned_duration_minutes)
        .bind(DeliveryMode::ProctorStart)
        .bind(RecurrenceType::None)
        .bind(1)
        .bind(req.auto_start)
        .bind(req.auto_stop)
        .bind(ScheduleStatus::Scheduled)
        .bind(ctx.actor_id.to_string())
        .bind(0)
        .execute(&self.pool)
        .await?;

        let schedule = sqlx::query_as::<_, ExamSchedule>("SELECT * FROM exam_schedules WHERE id = ?")
            .bind(schedule_id.to_string())
            .fetch_one(&self.pool)
            .await?;

        Ok(schedule)
    }

    pub async fn list_schedules(
        &self,
        ctx: &ActorContext,
    ) -> Result<Vec<ExamSchedule>, SchedulingError> {
        // Admins and AdminObservers can see all schedules
        // Other roles can only see schedules from their organization
        let query = if matches!(
            ctx.role,
            ielts_backend_infrastructure::actor_context::ActorRole::Admin
                | ielts_backend_infrastructure::actor_context::ActorRole::AdminObserver
        ) {
            "SELECT * FROM exam_schedules ORDER BY start_time ASC, created_at DESC"
        } else if let Some(ref org_id) = ctx.organization_id {
            "SELECT * FROM exam_schedules WHERE organization_id = ? ORDER BY start_time ASC, created_at DESC"
        } else {
            "SELECT * FROM exam_schedules WHERE 1=0 ORDER BY start_time ASC, created_at DESC" // No access
        };

        let schedules = if let Some(org_id) = ctx.organization_id.clone() {
            sqlx::query_as::<_, ExamSchedule>(query)
                .bind(org_id.to_string())
                .fetch_all(&self.pool)
                .await?
        } else {
            sqlx::query_as::<_, ExamSchedule>(query)
                .fetch_all(&self.pool)
                .await?
        };

        Ok(schedules)
    }

    pub async fn get_schedule(
        &self,
        ctx: &ActorContext,
        schedule_id: Uuid,
    ) -> Result<ExamSchedule, SchedulingError> {
        let schedule = sqlx::query_as::<_, ExamSchedule>("SELECT * FROM exam_schedules WHERE id = ?")
            .bind(schedule_id.to_string())
            .fetch_optional(&self.pool)
            .await?
            .ok_or(SchedulingError::NotFound)?;

        // Check authorization: user must have access to this schedule
        let organization_id = schedule.organization_id.as_ref().and_then(|s| Uuid::parse_str(s).ok());
        if let Some(org_id) = organization_id {
            if !AuthorizationService::can_access_schedule(ctx, schedule_id.to_string(), org_id.to_string()) {
                return Err(SchedulingError::NotFound);
            }
        }

        Ok(schedule)
    }

    pub async fn update_schedule(
        &self,
        ctx: &ActorContext,
        schedule_id: Uuid,
        req: UpdateScheduleRequest,
    ) -> Result<ExamSchedule, SchedulingError> {
        let existing = self.get_schedule(ctx, schedule_id).await?;

        // Check if user can modify this schedule
        let organization_id = existing.organization_id.as_ref().and_then(|s| Uuid::parse_str(s).ok());
        if let Some(org_id) = organization_id {
            if !AuthorizationService::can_access_organization_exams(ctx, org_id.to_string()) {
                return Err(SchedulingError::NotFound);
            }
        }

        if existing.revision != req.revision {
            return Err(SchedulingError::Conflict(
                "Schedule has been modified by another user.".to_owned(),
            ));
        }

        let requested_version_id = req.published_version_id.clone();
        let version_changed = requested_version_id
            .as_deref()
            .is_some_and(|next| next != existing.published_version_id);

        if version_changed && existing.status != ScheduleStatus::Scheduled {
            return Err(SchedulingError::Validation(
                "Cannot change published version for a non-scheduled session.".to_owned(),
            ));
        }

        let next_start_time = req.start_time.unwrap_or(existing.start_time);
        let next_end_time = req.end_time.unwrap_or(existing.end_time);

        let time_window_changed =
            req.start_time.is_some() || req.end_time.is_some();

        let (published_version_id_update, planned_duration_minutes_update) = if version_changed {
            let next_version_id = requested_version_id
                .clone()
                .ok_or_else(|| SchedulingError::Validation("Missing publishedVersionId".to_owned()))?;
            let version = self.load_version_context(next_version_id.clone()).await?;

            if version.exam_id.to_string() != existing.exam_id {
                return Err(SchedulingError::Validation(
                    "Published version does not belong to the schedule exam.".to_owned(),
                ));
            }

            let plan = build_section_plan(&version.config_snapshot)?;
            let planned_duration_minutes = plan_total_minutes(&plan);
            validate_schedule_window(next_start_time, next_end_time, planned_duration_minutes)?;

            (Some(next_version_id), Some(planned_duration_minutes))
        } else {
            if time_window_changed {
                validate_schedule_window(
                    next_start_time,
                    next_end_time,
                    existing.planned_duration_minutes,
                )?;
            }
            (None, None)
        };

        sqlx::query(
            r#"
            UPDATE exam_schedules
            SET
                published_version_id = COALESCE(?, published_version_id),
                cohort_name = COALESCE(?, cohort_name),
                institution = COALESCE(?, institution),
                start_time = COALESCE(?, start_time),
                end_time = COALESCE(?, end_time),
                planned_duration_minutes = COALESCE(?, planned_duration_minutes),
                auto_start = COALESCE(?, auto_start),
                auto_stop = COALESCE(?, auto_stop),
                status = COALESCE(?, status),
                updated_at = NOW(),
                revision = revision + 1
            WHERE id = ?
            "#,
        )
        .bind(published_version_id_update)
        .bind(req.cohort_name)
        .bind(req.institution)
        .bind(req.start_time)
        .bind(req.end_time)
        .bind(planned_duration_minutes_update)
        .bind(req.auto_start)
        .bind(req.auto_stop)
        .bind(req.status)
        .bind(schedule_id.to_string())
        .execute(&self.pool)
        .await?;

        let updated = sqlx::query_as::<_, ExamSchedule>("SELECT * FROM exam_schedules WHERE id = ?")
            .bind(schedule_id.to_string())
            .fetch_one(&self.pool)
            .await?;

        Ok(updated)
    }

    pub async fn delete_schedule(
        &self,
        ctx: &ActorContext,
        schedule_id: Uuid,
    ) -> Result<(), SchedulingError> {
        let schedule = self.get_schedule(ctx, schedule_id).await?;

        // Check if user can delete this schedule
        let organization_id = schedule.organization_id.as_ref().and_then(|s| Uuid::parse_str(s).ok());
        if let Some(org_id) = organization_id {
            if !AuthorizationService::can_access_organization_exams(ctx, org_id.to_string()) {
                return Err(SchedulingError::NotFound);
            }
        }

        let deleted = sqlx::query("DELETE FROM exam_schedules WHERE id = ?")
            .bind(schedule_id.to_string())
            .execute(&self.pool)
            .await?;

        if deleted.rows_affected() == 0 {
            return Err(SchedulingError::NotFound);
        }

        Ok(())
    }

    pub async fn get_runtime(
        &self,
        ctx: &ActorContext,
        schedule_id: Uuid,
    ) -> Result<ExamSessionRuntime, SchedulingError> {
        // Check authorization before accessing runtime
        let schedule = self.get_schedule(ctx, schedule_id).await?;

        if let Some(runtime_row) = sqlx::query_as::<_, RuntimeRow>(
            "SELECT * FROM exam_session_runtimes WHERE schedule_id = ?",
        )
        .bind(schedule_id.to_string())
        .fetch_optional(&self.pool)
        .await?
        {
            if schedule.auto_stop
                && schedule.status != ScheduleStatus::Cancelled
                && schedule.status != ScheduleStatus::Completed
                && Utc::now() >= schedule.end_time
                && !matches!(runtime_row.status, RuntimeStatus::Completed | RuntimeStatus::Cancelled)
            {
                self.end_runtime(&system_actor(), schedule_id, "auto_stop")
                    .await?;
                let refreshed = sqlx::query_as::<_, RuntimeRow>(
                    "SELECT * FROM exam_session_runtimes WHERE schedule_id = ?",
                )
                .bind(schedule_id.to_string())
                .fetch_one(&self.pool)
                .await?;
                return self.hydrate_runtime(refreshed).await;
            }

            return self.hydrate_runtime(runtime_row).await;
        }

        let context = self.load_schedule_context(schedule_id).await?;
        Ok(build_not_started_runtime(&context.schedule, &context.plan))
    }

    pub async fn apply_runtime_command(
        &self,
        ctx: &ActorContext,
        schedule_id: Uuid,
        req: RuntimeCommandRequest,
    ) -> Result<ExamSessionRuntime, SchedulingError> {
        // Check authorization before applying runtime command
        self.get_schedule(ctx, schedule_id).await?;

        match req.action {
            RuntimeCommandAction::StartRuntime => self.start_runtime(ctx, schedule_id).await,
            RuntimeCommandAction::PauseRuntime => {
                self.pause_runtime(ctx, schedule_id, req.reason).await
            }
            RuntimeCommandAction::ResumeRuntime => self.resume_runtime(ctx, schedule_id).await,
            RuntimeCommandAction::EndRuntime => {
                self.end_runtime(ctx, schedule_id, "proctor_complete").await
            }
        }
    }

    async fn start_runtime(
        &self,
        ctx: &ActorContext,
        schedule_id: Uuid,
    ) -> Result<ExamSessionRuntime, SchedulingError> {
        if sqlx::query_scalar::<_, Hyphenated>(
            "SELECT id FROM exam_session_runtimes WHERE schedule_id = ?",
        )
        .bind(schedule_id.to_string())
        .fetch_optional(&self.pool)
        .await?
        .is_some()
        {
            return Err(SchedulingError::Conflict(
                "Runtime already exists for this schedule.".to_owned(),
            ));
        }

        let context = self.load_schedule_context(schedule_id).await?;
        let runtime_id = Uuid::new_v4();
        let now = Utc::now();
        let plan_snapshot = serde_json::to_value(&context.plan).expect("serialize plan snapshot");

        let mut tx = self.pool.begin().await?;

        sqlx::query(
            r#"
            INSERT INTO exam_session_runtimes (
                id, schedule_id, exam_id, status, plan_snapshot, actual_start_at, actual_end_at,
                active_section_key, current_section_key, current_section_remaining_seconds,
                waiting_for_next_section, is_overrun, total_paused_seconds, created_at, updated_at, revision
            )
            VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, false, false, 0, NOW(), NOW(), 0)
            "#,
        )
        .bind(runtime_id.to_string())
        .bind(&context.schedule.id)
        .bind(&context.schedule.exam_id)
        .bind(RuntimeStatus::Live)
        .bind(plan_snapshot)
        .bind(now)
        .bind(context.plan.first().map(|entry| entry.section_key.clone()))
        .bind(context.plan.first().map(|entry| entry.section_key.clone()))
        .bind(context.plan.first().map(|entry| entry.duration_minutes * 60).unwrap_or(0))
        .execute(&mut *tx)
        .await?;

        for (index, entry) in context.plan.iter().enumerate() {
            let projected_start = context.schedule.start_time
                + Duration::minutes(i64::from(entry.start_offset_minutes));
            let projected_end = context.schedule.start_time
                + Duration::minutes(i64::from(entry.end_offset_minutes));
            let (status, available_at, actual_start_at) = if index == 0 {
                (SectionRuntimeStatus::Live, Some(now), Some(now))
            } else {
                (SectionRuntimeStatus::Locked, None, None)
            };

            sqlx::query(
                r#"
                INSERT INTO exam_session_runtime_sections (
                    id, runtime_id, section_key, label, section_order, planned_duration_minutes,
                    gap_after_minutes, status, available_at, actual_start_at, actual_end_at, paused_at,
                    accumulated_paused_seconds, extension_minutes, completion_reason, projected_start_at, projected_end_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 0, 0, NULL, ?, ?)
                "#,
            )
            .bind(Uuid::new_v4().to_string())
            .bind(runtime_id.to_string())
            .bind(&entry.section_key)
            .bind(&entry.label)
            .bind(entry.order)
            .bind(entry.duration_minutes)
            .bind(entry.gap_after_minutes)
            .bind(status)
            .bind(available_at)
            .bind(actual_start_at)
            .bind(projected_start)
            .bind(projected_end)
            .execute(&mut *tx)
            .await?;
        }

        sqlx::query(
            "UPDATE exam_schedules SET status = ?, updated_at = NOW(), revision = revision + 1 WHERE id = ?",
        )
        .bind(ScheduleStatus::Live)
        .bind(schedule_id.to_string())
        .execute(&mut *tx)
        .await?;

        insert_control_event(
            &mut tx,
            runtime_id.to_string(),
            context.schedule.id.clone(),
            context.schedule.exam_id.clone(),
            &ctx.actor_id.to_string(),
            RuntimeCommandEvent::StartRuntime,
            None,
        )
        .await?;

        tx.commit().await?;

        self.get_runtime(ctx, schedule_id).await
    }

    async fn pause_runtime(
        &self,
        ctx: &ActorContext,
        schedule_id: Uuid,
        reason: Option<String>,
    ) -> Result<ExamSessionRuntime, SchedulingError> {
        let config_snapshot = self.load_config_snapshot_for_schedule(schedule_id).await?;
        if Self::is_ielts_mode(&config_snapshot) || !Self::allow_pause(&config_snapshot) {
            return Err(SchedulingError::Validation(
                "Cohort pause is disabled by exam policy.".to_owned(),
            ));
        }

        let runtime = sqlx::query_as::<_, RuntimeRow>(
            "SELECT * FROM exam_session_runtimes WHERE schedule_id = ?",
        )
        .bind(schedule_id.to_string())
        .fetch_optional(&self.pool)
        .await?
        .ok_or(SchedulingError::NotFound)?;

        if runtime.status != RuntimeStatus::Live {
            return Err(SchedulingError::Conflict("Runtime is not live.".to_owned()));
        }

        let active_section_key = runtime.active_section_key.clone().ok_or_else(|| {
            SchedulingError::Conflict("Runtime has no active section.".to_owned())
        })?;
        let now = Utc::now();
        let mut tx = self.pool.begin().await?;

        sqlx::query(
            "UPDATE exam_session_runtimes SET status = ?, updated_at = NOW(), revision = revision + 1 WHERE id = ?",
        )
        .bind(RuntimeStatus::Paused)
        .bind(runtime.id)
        .execute(&mut *tx)
        .await?;

        sqlx::query(
            "UPDATE exam_session_runtime_sections SET status = ?, paused_at = NOW() WHERE runtime_id = ? AND section_key = ?",
        )
        .bind(SectionRuntimeStatus::Paused)
        .bind(runtime.id)
        .bind(active_section_key)
        .execute(&mut *tx)
        .await?;

        insert_control_event(
            &mut tx,
            runtime.id.to_string(),
            schedule_id.to_string(),
            runtime.exam_id.to_string(),
            &ctx.actor_id.to_string(),
            RuntimeCommandEvent::PauseRuntime,
            reason,
        )
        .await?;

        tx.commit().await?;

        self.get_runtime(ctx, schedule_id).await
    }

    async fn resume_runtime(
        &self,
        ctx: &ActorContext,
        schedule_id: Uuid,
    ) -> Result<ExamSessionRuntime, SchedulingError> {
        let runtime = sqlx::query_as::<_, RuntimeRow>(
            "SELECT * FROM exam_session_runtimes WHERE schedule_id = ?",
        )
        .bind(schedule_id.to_string())
        .fetch_optional(&self.pool)
        .await?
        .ok_or(SchedulingError::NotFound)?;

        if runtime.status != RuntimeStatus::Paused {
            return Err(SchedulingError::Conflict(
                "Runtime is not paused.".to_owned(),
            ));
        }

        let active_section_key = runtime.active_section_key.clone().ok_or_else(|| {
            SchedulingError::Conflict("Runtime has no active section.".to_owned())
        })?;
        let paused_at = sqlx::query_scalar::<_, Option<DateTime<Utc>>>(
            "SELECT paused_at FROM exam_session_runtime_sections WHERE runtime_id = ? AND section_key = ?",
        )
        .bind(runtime.id)
        .bind(&active_section_key)
        .fetch_one(&self.pool)
        .await?;
        let now = Utc::now();
        let paused_seconds = paused_at
            .map(|started| (now - started).num_seconds().max(0) as i32)
            .unwrap_or(0);
        let mut tx = self.pool.begin().await?;

        sqlx::query(
            "UPDATE exam_session_runtimes SET status = ?, total_paused_seconds = total_paused_seconds + ?, updated_at = NOW(), revision = revision + 1 WHERE id = ?",
        )
        .bind(RuntimeStatus::Live)
        .bind(paused_seconds)
        .bind(runtime.id)
        .execute(&mut *tx)
        .await?;

        sqlx::query(
            "UPDATE exam_session_runtime_sections SET status = ?, paused_at = NULL, accumulated_paused_seconds = accumulated_paused_seconds + ? WHERE runtime_id = ? AND section_key = ?",
        )
        .bind(SectionRuntimeStatus::Live)
        .bind(paused_seconds)
        .bind(runtime.id)
        .bind(active_section_key)
        .execute(&mut *tx)
        .await?;

        insert_control_event(
            &mut tx,
            runtime.id.to_string(),
            schedule_id.to_string(),
            runtime.exam_id.to_string(),
            &ctx.actor_id.to_string(),
            RuntimeCommandEvent::ResumeRuntime,
            None,
        )
        .await?;

        tx.commit().await?;

        self.get_runtime(ctx, schedule_id).await
    }

    async fn end_runtime(
        &self,
        ctx: &ActorContext,
        schedule_id: Uuid,
        completion_reason: &str,
    ) -> Result<ExamSessionRuntime, SchedulingError> {
        let runtime = sqlx::query_as::<_, RuntimeRow>(
            "SELECT * FROM exam_session_runtimes WHERE schedule_id = ?",
        )
        .bind(schedule_id.to_string())
        .fetch_optional(&self.pool)
        .await?
        .ok_or(SchedulingError::NotFound)?;

        if matches!(
            runtime.status,
            RuntimeStatus::Completed | RuntimeStatus::Cancelled
        ) {
            return self.hydrate_runtime(runtime).await;
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
                completion_reason = COALESCE(completion_reason, ?),
                paused_at = NULL
            WHERE runtime_id = ?
            "#,
        )
        .bind(SectionRuntimeStatus::Completed)
        .bind(completion_reason)
        .bind(runtime.id)
        .execute(&mut *tx)
        .await?;

        sqlx::query(
            "UPDATE exam_schedules SET status = ?, updated_at = NOW(), revision = revision + 1 WHERE id = ?",
        )
        .bind(ScheduleStatus::Completed)
        .bind(schedule_id.to_string())
        .execute(&mut *tx)
        .await?;

        auto_submit_schedule_attempts_in_tx(tx.as_mut(), schedule_id, completion_reason)
            .await
            .map_err(|error| match error {
                DeliveryError::Database(db) => SchedulingError::Database(db),
                DeliveryError::Conflict { message, .. }
                | DeliveryError::Validation(message)
                | DeliveryError::Internal(message) => SchedulingError::Validation(message),
                DeliveryError::NotFound => SchedulingError::NotFound,
            })?;

        insert_control_event(
            &mut tx,
            runtime.id.to_string(),
            schedule_id.to_string(),
            runtime.exam_id.to_string(),
            &ctx.actor_id.to_string(),
            RuntimeCommandEvent::CompleteRuntime,
            None,
        )
        .await?;

        tx.commit().await?;

        let refreshed = sqlx::query_as::<_, RuntimeRow>(
            "SELECT * FROM exam_session_runtimes WHERE schedule_id = ?",
        )
        .bind(schedule_id.to_string())
        .fetch_one(&self.pool)
        .await?;

        self.hydrate_runtime(refreshed).await
    }

    async fn hydrate_runtime(
        &self,
        runtime_row: RuntimeRow,
    ) -> Result<ExamSessionRuntime, SchedulingError> {
        let sections = sqlx::query_as::<_, RuntimeSectionRow>(
            "SELECT * FROM exam_session_runtime_sections WHERE runtime_id = ? ORDER BY section_order ASC",
        )
        .bind(runtime_row.id)
        .fetch_all(&self.pool)
        .await?;

        let now = Utc::now();
        let computed_runtime = compute_runtime_remaining_seconds(
            runtime_row.current_section_key.as_deref(),
            runtime_row.active_section_key.as_deref(),
            &sections,
            now,
        );
        let current_section_remaining_seconds = computed_runtime
            .map(|computed| computed.remaining_seconds)
            .unwrap_or(runtime_row.current_section_remaining_seconds);
        let is_overrun = computed_runtime
            .map(|computed| computed.is_overrun)
            .unwrap_or(runtime_row.is_overrun);

        Ok(ExamSessionRuntime {
            id: runtime_row.id.to_string(),
            schedule_id: runtime_row.schedule_id.to_string(),
            exam_id: runtime_row.exam_id.to_string(),
            status: runtime_row.status,
            plan_snapshot: serde_json::from_value(runtime_row.plan_snapshot).unwrap_or_default(),
            actual_start_at: runtime_row.actual_start_at,
            actual_end_at: runtime_row.actual_end_at,
            active_section_key: runtime_row.active_section_key,
            current_section_key: runtime_row.current_section_key,
            current_section_remaining_seconds,
            waiting_for_next_section: runtime_row.waiting_for_next_section,
            is_overrun,
            total_paused_seconds: runtime_row.total_paused_seconds,
            created_at: runtime_row.created_at,
            updated_at: runtime_row.updated_at,
            revision: runtime_row.revision,
            sections: sections.into_iter().map(Into::into).collect(),
        })
    }

    async fn load_schedule_context(
        &self,
        schedule_id: Uuid,
    ) -> Result<ScheduleContext, SchedulingError> {
        let schedule = self
            .get_schedule(
                &ActorContext::new(
                    Uuid::nil().to_string(),
                    ielts_backend_infrastructure::actor_context::ActorRole::Admin,
                ),
                schedule_id,
            )
            .await?;
        let version = self
            .load_version_context(schedule.published_version_id.clone())
            .await?;
        let plan = build_section_plan(&version.config_snapshot)?;

        Ok(ScheduleContext { schedule, plan })
    }

    async fn load_exam_context(&self, exam_id: String) -> Result<ExamContext, SchedulingError> {
        sqlx::query_as::<_, ExamContext>(
            "SELECT title, organization_id FROM exam_entities WHERE id = ?",
        )
        .bind(&exam_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or(SchedulingError::NotFound)
    }

    async fn load_version_context(
        &self,
        version_id: String,
    ) -> Result<VersionContext, SchedulingError> {
        sqlx::query_as::<_, VersionContext>(
            "SELECT exam_id, config_snapshot FROM exam_versions WHERE id = ?",
        )
        .bind(&version_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or(SchedulingError::NotFound)
    }

    pub async fn create_student_registration(
        &self,
        ctx: &ActorContext,
        schedule_id: Uuid,
        wcode: String,
        email: String,
        student_name: String,
        user_id: Uuid,
    ) -> Result<ScheduleRegistration, SchedulingError> {
        validate_wcode(&wcode).map_err(|e| SchedulingError::Validation(e))?;
        validate_email(&email).map_err(|e| SchedulingError::Validation(e))?;

        self.get_schedule(ctx, schedule_id).await?;

        let user_id_str = user_id.to_string();

        if let Some(row) = self.load_registration_by_wcode(schedule_id, &wcode).await? {
            let same_user = row
                .user_id
                .map(|id| id.into_uuid())
                .is_some_and(|id| id == user_id)
                || row.actor_id.as_deref() == Some(user_id_str.as_str());

            if same_user {
                let existing_name = row.student_name.trim();
                let requested_name = student_name.trim();
                if !existing_name.is_empty() && existing_name != requested_name {
                    return Err(SchedulingError::Conflict(
                        "Student name is locked for this registration.".to_owned(),
                    ));
                }

                let existing_email = row
                    .student_email
                    .as_deref()
                    .unwrap_or_default()
                    .trim()
                    .to_ascii_lowercase();
                let requested_email = email.trim().to_ascii_lowercase();
                if !existing_email.is_empty() && existing_email != requested_email {
                    return Err(SchedulingError::Conflict(
                        "Email is locked for this registration.".to_owned(),
                    ));
                }

                let updated = self
                    .update_registration_contact(
                        schedule_id,
                        &wcode,
                        &email,
                        &student_name,
                        user_id,
                    )
                    .await?;
                return Ok(updated.into_domain());
            }

            return Err(SchedulingError::Conflict(format!(
                "Wcode {} is already registered for this schedule",
                wcode
            )));
        }

        let student_key = format!("student-{}-{}", schedule_id, wcode);
        let registration_id = Uuid::new_v4();

        let inserted = sqlx::query(
            r#"
            INSERT INTO schedule_registrations (
                id, schedule_id, user_id, actor_id, wcode, student_key, student_id, student_name, student_email,
                access_state, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'checked_in', NOW(), NOW())
            "#
        )
        .bind(registration_id.to_string())
        .bind(schedule_id.to_string())
        .bind(user_id.to_string())
        .bind(user_id.to_string())
        .bind(&wcode)
        .bind(&student_key)
        .bind(&wcode)
        .bind(&student_name)
        .bind(&email)
        .execute(&self.pool)
        .await;

        match inserted {
            Ok(_) => {
                let row = self
                    .load_registration_by_wcode(schedule_id, &wcode)
                    .await?
                    .ok_or(SchedulingError::NotFound)?;
                Ok(row.into_domain())
            }
            Err(err) if is_mysql_duplicate_key(&err) => {
                // Raced with another request. If it's ours, treat as idempotent.
                let Some(row) = self.load_registration_by_wcode(schedule_id, &wcode).await? else {
                    return Err(SchedulingError::Database(err));
                };

                let same_user = row
                    .user_id
                    .map(|id| id.into_uuid())
                    .is_some_and(|id| id == user_id)
                    || row.actor_id.as_deref() == Some(user_id_str.as_str());

                if same_user {
                    let existing_name = row.student_name.trim();
                    let requested_name = student_name.trim();
                    if !existing_name.is_empty() && existing_name != requested_name {
                        return Err(SchedulingError::Conflict(
                            "Student name is locked for this registration.".to_owned(),
                        ));
                    }

                    let existing_email = row
                        .student_email
                        .as_deref()
                        .unwrap_or_default()
                        .trim()
                        .to_ascii_lowercase();
                    let requested_email = email.trim().to_ascii_lowercase();
                    if !existing_email.is_empty() && existing_email != requested_email {
                        return Err(SchedulingError::Conflict(
                            "Email is locked for this registration.".to_owned(),
                        ));
                    }

                    let updated = self
                        .update_registration_contact(
                            schedule_id,
                            &wcode,
                            &email,
                            &student_name,
                            user_id,
                        )
                        .await?;
                    Ok(updated.into_domain())
                } else {
                    Err(SchedulingError::Conflict(format!(
                        "Wcode {} is already registered for this schedule",
                        wcode
                    )))
                }
            }
            Err(err) => Err(SchedulingError::Database(err)),
        }
    }
}

fn is_mysql_duplicate_key(err: &sqlx::Error) -> bool {
    match err {
        sqlx::Error::Database(db_err) => db_err.code().as_deref() == Some("1062"),
        _ => false,
    }
}

#[derive(Debug, Clone, FromRow)]
struct ExamContext {
    title: String,
    organization_id: Option<String>,
}

#[derive(Debug, Clone, FromRow)]
struct VersionContext {
    exam_id: Hyphenated,
    config_snapshot: Value,
}

#[derive(Debug, Clone)]
struct ScheduleContext {
    schedule: ExamSchedule,
    plan: Vec<ScheduleSectionPlanEntry>,
}

#[derive(Debug, Clone, FromRow)]
struct ScheduleRegistrationRow {
    id: Hyphenated,
    schedule_id: Hyphenated,
    wcode: String,
    student_email: Option<String>,
    student_key: String,
    actor_id: Option<String>,
    student_id: String,
    student_name: String,
    access_state: String,
    allowed_from: Option<DateTime<Utc>>,
    allowed_until: Option<DateTime<Utc>>,
    extra_time_minutes: i32,
    seat_label: Option<String>,
    metadata: Option<Value>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    revision: i32,
    user_id: Option<Hyphenated>,
}

impl ScheduleRegistrationRow {
    fn into_domain(self) -> ScheduleRegistration {
        ScheduleRegistration {
            id: self.id.into_uuid(),
            schedule_id: self.schedule_id.into_uuid(),
            wcode: self.wcode,
            email: self.student_email.unwrap_or_default(),
            student_key: self.student_key,
            actor_id: self.actor_id,
            student_id: self.student_id,
            student_name: self.student_name,
            access_state: self.access_state,
            allowed_from: self.allowed_from,
            allowed_until: self.allowed_until,
            extra_time_minutes: self.extra_time_minutes,
            seat_label: self.seat_label,
            metadata: self.metadata,
            created_at: self.created_at,
            updated_at: self.updated_at,
            revision: self.revision,
        }
    }
}

#[derive(Debug, Clone, FromRow)]
struct RuntimeRow {
    id: Hyphenated,
    schedule_id: Hyphenated,
    exam_id: Hyphenated,
    status: RuntimeStatus,
    plan_snapshot: Value,
    actual_start_at: Option<DateTime<Utc>>,
    actual_end_at: Option<DateTime<Utc>>,
    active_section_key: Option<String>,
    current_section_key: Option<String>,
    current_section_remaining_seconds: i32,
    waiting_for_next_section: bool,
    is_overrun: bool,
    total_paused_seconds: i32,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    revision: i32,
}

#[derive(Debug, Clone, FromRow)]
struct RuntimeSectionRow {
    id: Hyphenated,
    runtime_id: Hyphenated,
    section_key: String,
    label: String,
    section_order: i32,
    planned_duration_minutes: i32,
    gap_after_minutes: i32,
    status: SectionRuntimeStatus,
    available_at: Option<DateTime<Utc>>,
    actual_start_at: Option<DateTime<Utc>>,
    actual_end_at: Option<DateTime<Utc>>,
    paused_at: Option<DateTime<Utc>>,
    accumulated_paused_seconds: i32,
    extension_minutes: i32,
    completion_reason: Option<String>,
    projected_start_at: Option<DateTime<Utc>>,
    projected_end_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct ComputedSectionTime {
    remaining_seconds: i32,
    is_overrun: bool,
}

fn compute_runtime_remaining_seconds(
    current_section_key: Option<&str>,
    active_section_key: Option<&str>,
    sections: &[RuntimeSectionRow],
    now: DateTime<Utc>,
) -> Option<ComputedSectionTime> {
    let section_key = current_section_key.or(active_section_key)?;
    let section = sections.iter().find(|section| section.section_key == section_key)?;
    let actual_start_at = section.actual_start_at?;

    Some(compute_section_remaining_seconds(
        actual_start_at,
        section.planned_duration_minutes,
        section.extension_minutes,
        section.paused_at,
        section.accumulated_paused_seconds,
        section.status.clone(),
        now,
    ))
}

fn compute_section_remaining_seconds(
    actual_start_at: DateTime<Utc>,
    planned_duration_minutes: i32,
    extension_minutes: i32,
    paused_at: Option<DateTime<Utc>>,
    accumulated_paused_seconds: i32,
    status: SectionRuntimeStatus,
    now: DateTime<Utc>,
) -> ComputedSectionTime {
    let duration_seconds = i64::from(planned_duration_minutes.saturating_add(extension_minutes))
        .saturating_mul(60);

    let time_base = if status == SectionRuntimeStatus::Paused || paused_at.is_some() {
        paused_at.unwrap_or(now)
    } else {
        now
    };

    let raw_elapsed_seconds = (time_base - actual_start_at).num_seconds().max(0);
    let elapsed_seconds = raw_elapsed_seconds.saturating_sub(i64::from(accumulated_paused_seconds.max(0)));

    let remaining_seconds = (duration_seconds - elapsed_seconds).clamp(0, duration_seconds);

    ComputedSectionTime {
        remaining_seconds: remaining_seconds as i32,
        is_overrun: elapsed_seconds > duration_seconds,
    }
}

impl From<RuntimeSectionRow> for RuntimeSectionState {
    fn from(value: RuntimeSectionRow) -> Self {
        Self {
            id: value.id.to_string(),
            runtime_id: value.runtime_id.to_string(),
            section_key: value.section_key,
            label: value.label,
            section_order: value.section_order,
            planned_duration_minutes: value.planned_duration_minutes,
            gap_after_minutes: value.gap_after_minutes,
            status: value.status,
            available_at: value.available_at,
            actual_start_at: value.actual_start_at,
            actual_end_at: value.actual_end_at,
            paused_at: value.paused_at,
            accumulated_paused_seconds: value.accumulated_paused_seconds,
            extension_minutes: value.extension_minutes,
            completion_reason: value.completion_reason,
            projected_start_at: value.projected_start_at,
            projected_end_at: value.projected_end_at,
        }
    }
}

fn system_actor() -> ActorContext {
    ActorContext::new(
        Uuid::nil().to_string(),
        ielts_backend_infrastructure::actor_context::ActorRole::Admin,
    )
}

#[cfg(test)]
mod computed_time_tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn compute_section_remaining_seconds_counts_down_when_live() {
        let start = Utc.with_ymd_and_hms(2026, 4, 20, 0, 0, 0).unwrap();
        let now = start + chrono::Duration::seconds(30);

        let computed = compute_section_remaining_seconds(
            start,
            10,
            0,
            None,
            0,
            SectionRuntimeStatus::Live,
            now,
        );

        assert_eq!(computed.remaining_seconds, 600 - 30);
        assert_eq!(computed.is_overrun, false);
    }

    #[test]
    fn compute_section_remaining_seconds_freezes_when_paused() {
        let start = Utc.with_ymd_and_hms(2026, 4, 20, 0, 0, 0).unwrap();
        let paused_at = start + chrono::Duration::seconds(20);
        let now = start + chrono::Duration::seconds(50);

        let computed = compute_section_remaining_seconds(
            start,
            10,
            0,
            Some(paused_at),
            0,
            SectionRuntimeStatus::Paused,
            now,
        );

        assert_eq!(computed.remaining_seconds, 600 - 20);
        assert_eq!(computed.is_overrun, false);
    }

    #[test]
    fn compute_section_remaining_seconds_includes_extensions() {
        let start = Utc.with_ymd_and_hms(2026, 4, 20, 0, 0, 0).unwrap();
        let now = start + chrono::Duration::seconds(30);

        let computed = compute_section_remaining_seconds(
            start,
            10,
            5,
            None,
            0,
            SectionRuntimeStatus::Live,
            now,
        );

        assert_eq!(computed.remaining_seconds, (15 * 60) - 30);
        assert_eq!(computed.is_overrun, false);
    }

    #[test]
    fn compute_section_remaining_seconds_clamps_to_zero_and_marks_overrun() {
        let start = Utc.with_ymd_and_hms(2026, 4, 20, 0, 0, 0).unwrap();
        let now = start + chrono::Duration::seconds(700);

        let computed = compute_section_remaining_seconds(
            start,
            10,
            0,
            None,
            0,
            SectionRuntimeStatus::Live,
            now,
        );

        assert_eq!(computed.remaining_seconds, 0);
        assert_eq!(computed.is_overrun, true);
    }
}

async fn insert_control_event(
    tx: &mut sqlx::Transaction<'_, sqlx::MySql>,
    runtime_id: String,
    schedule_id: String,
    exam_id: String,
    actor_id: &str,
    action: RuntimeCommandEvent,
    reason: Option<String>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        INSERT INTO cohort_control_events (
            id, schedule_id, runtime_id, exam_id, actor_id, action, reason, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
        "#,
    )
    .bind(Uuid::new_v4().to_string())
    .bind(schedule_id.to_string())
    .bind(runtime_id.to_string())
    .bind(exam_id.to_string())
    .bind(actor_id)
    .bind(action)
    .bind(reason)
    .execute(tx.as_mut())
    .await?;

    Ok(())
}

fn build_not_started_runtime(
    schedule: &ExamSchedule,
    plan: &[ScheduleSectionPlanEntry],
) -> ExamSessionRuntime {
    let created_at = Utc::now();

    ExamSessionRuntime {
        id: Uuid::nil().to_string(),
        schedule_id: schedule.id.clone(),
        exam_id: schedule.exam_id.clone(),
        status: RuntimeStatus::NotStarted,
        plan_snapshot: plan.to_vec(),
        actual_start_at: None,
        actual_end_at: None,
        active_section_key: None,
        current_section_key: None,
        current_section_remaining_seconds: 0,
        waiting_for_next_section: false,
        is_overrun: false,
        total_paused_seconds: 0,
        created_at,
        updated_at: created_at,
        revision: 0,
        sections: plan
            .iter()
            .map(|entry| RuntimeSectionState {
                id: Uuid::nil().to_string(),
                runtime_id: Uuid::nil().to_string(),
                section_key: entry.section_key.clone(),
                label: entry.label.clone(),
                section_order: entry.order,
                planned_duration_minutes: entry.duration_minutes,
                gap_after_minutes: entry.gap_after_minutes,
                status: SectionRuntimeStatus::Locked,
                available_at: None,
                actual_start_at: None,
                actual_end_at: None,
                paused_at: None,
                accumulated_paused_seconds: 0,
                extension_minutes: 0,
                completion_reason: None,
                projected_start_at: Some(
                    schedule.start_time + Duration::minutes(i64::from(entry.start_offset_minutes)),
                ),
                projected_end_at: Some(
                    schedule.start_time + Duration::minutes(i64::from(entry.end_offset_minutes)),
                ),
            })
            .collect(),
    }
}

fn build_section_plan(
    config_snapshot: &Value,
) -> Result<Vec<ScheduleSectionPlanEntry>, SchedulingError> {
    let sections = config_snapshot
        .get("sections")
        .and_then(Value::as_object)
        .ok_or_else(|| {
            SchedulingError::Validation("Exam config is missing section settings.".to_owned())
        })?;

    let ordered_keys = ["listening", "reading", "writing", "speaking"];
    let mut entries = Vec::new();

    for (default_order, key) in ordered_keys.into_iter().enumerate() {
        let Some(section) = sections.get(key).and_then(Value::as_object) else {
            continue;
        };

        let enabled = section
            .get("enabled")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        if !enabled {
            continue;
        }

        let duration = section
            .get("duration")
            .and_then(Value::as_i64)
            .unwrap_or_default() as i32;
        if duration <= 0 {
            return Err(SchedulingError::Validation(format!(
                "Section `{key}` must have a positive duration."
            )));
        }

        let gap_after_minutes = section
            .get("gapAfterMinutes")
            .and_then(Value::as_i64)
            .unwrap_or_default() as i32;
        if gap_after_minutes < 0 {
            return Err(SchedulingError::Validation(format!(
                "Section `{key}` cannot have a negative gap."
            )));
        }

        let order = section
            .get("order")
            .and_then(Value::as_i64)
            .map(|value| value as i32)
            .unwrap_or((default_order + 1) as i32);
        let label = section
            .get("label")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned)
            .unwrap_or_else(|| key.to_owned());

        entries.push(ScheduleSectionPlanEntry {
            section_key: key.to_owned(),
            label,
            order,
            duration_minutes: duration,
            gap_after_minutes,
            start_offset_minutes: 0,
            end_offset_minutes: 0,
        });
    }

    if entries.is_empty() {
        return Err(SchedulingError::Validation(
            "At least one enabled section is required.".to_owned(),
        ));
    }

    entries.sort_by_key(|entry| entry.order);

    let mut running_offset = 0;
    for entry in &mut entries {
        entry.start_offset_minutes = running_offset;
        entry.end_offset_minutes = running_offset + entry.duration_minutes;
        running_offset = entry.end_offset_minutes + entry.gap_after_minutes;
    }

    if let Some(last) = entries.last_mut() {
        running_offset = last.end_offset_minutes;
    }

    for entry in &mut entries {
        if entry.end_offset_minutes > running_offset {
            running_offset = entry.end_offset_minutes;
        }
    }

    Ok(entries)
}

fn plan_total_minutes(plan: &[ScheduleSectionPlanEntry]) -> i32 {
    plan.last()
        .map(|entry| entry.end_offset_minutes)
        .unwrap_or(0)
}

fn validate_schedule_window(
    start_time: DateTime<Utc>,
    end_time: DateTime<Utc>,
    planned_duration_minutes: i32,
) -> Result<(), SchedulingError> {
    if end_time <= start_time {
        return Err(SchedulingError::Validation(
            "Scheduled end time must be after the start time.".to_owned(),
        ));
    }

    let window_minutes = (end_time - start_time).num_minutes();
    if window_minutes < i64::from(planned_duration_minutes) {
        return Err(SchedulingError::Validation(format!(
            "Scheduled window must be at least {planned_duration_minutes} minutes."
        )));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;
    use serde_json::json;

    #[test]
    fn build_section_plan_respects_order_and_gap_offsets() {
        let config = json!({
            "sections": {
                "listening": {"enabled": true, "label": "Listening", "order": 1, "duration": 30, "gapAfterMinutes": 5},
                "reading": {"enabled": true, "label": "Reading", "order": 2, "duration": 60, "gapAfterMinutes": 0},
                "writing": {"enabled": true, "label": "Writing", "order": 3, "duration": 60, "gapAfterMinutes": 10},
                "speaking": {"enabled": true, "label": "Speaking", "order": 4, "duration": 15, "gapAfterMinutes": 0}
            }
        });

        let plan = build_section_plan(&config).expect("build plan");
        assert_eq!(plan.len(), 4);
        assert_eq!(plan[0].section_key, "listening");
        assert_eq!(plan[0].start_offset_minutes, 0);
        assert_eq!(plan[0].end_offset_minutes, 30);
        assert_eq!(plan[1].section_key, "reading");
        assert_eq!(plan[1].start_offset_minutes, 35);
        assert_eq!(plan[1].end_offset_minutes, 95);
        assert_eq!(plan[2].section_key, "writing");
        assert_eq!(plan[2].start_offset_minutes, 95);
        assert_eq!(plan[2].end_offset_minutes, 155);
        assert_eq!(plan[3].section_key, "speaking");
        assert_eq!(plan[3].start_offset_minutes, 165);
        assert_eq!(plan[3].end_offset_minutes, 180);
    }

    #[test]
    fn validate_schedule_window_requires_sufficient_duration() {
        let start = Utc.with_ymd_and_hms(2026, 1, 10, 9, 0, 0).unwrap();
        let end = Utc.with_ymd_and_hms(2026, 1, 10, 12, 0, 0).unwrap();
        validate_schedule_window(start, end, 180).expect("window matches duration");

        let too_short_end = Utc.with_ymd_and_hms(2026, 1, 10, 11, 0, 0).unwrap();
        assert!(validate_schedule_window(start, too_short_end, 180).is_err());

        let invalid_end = Utc.with_ymd_and_hms(2026, 1, 10, 8, 59, 0).unwrap();
        assert!(validate_schedule_window(start, invalid_end, 10).is_err());
    }
}
