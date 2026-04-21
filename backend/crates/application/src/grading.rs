use chrono::Utc;
use ielts_backend_domain::{
    grading::{
        ActorActionRequest, GradingSession, GradingSessionDetail, GradingSessionStatus,
        OverallGradingStatus, ReleaseEvent, ReleaseNowRequest, ReleaseStatus, ResultsAnalytics,
        ReviewAction, ReviewDraft, SaveReviewDraftRequest, ScheduleReleaseRequest,
        SectionGradingStatus, SectionSubmission, StartReviewRequest, StudentResult,
        StudentSubmission, SubmissionReviewBundle, WritingTaskSubmission,
    },
    schedule::{ExamSchedule, ScheduleStatus},
};
use ielts_backend_infrastructure::{
    actor_context::ActorContext,
    actor_context::ActorRole,
    authorization::AuthorizationService,
};
use serde_json::{json, Map, Value};
use sqlx::{FromRow, MySqlPool};
use thiserror::Error;
use uuid::{fmt::Hyphenated, Uuid};

#[derive(Error, Debug)]
pub enum GradingError {
    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("Conflict: {0}")]
    Conflict(String),
    #[error("Not found")]
    NotFound,
    #[error("Validation error: {0}")]
    Validation(String),
}

pub struct GradingService {
    pool: MySqlPool,
}

impl GradingService {
    pub fn new(pool: MySqlPool) -> Self {
        Self { pool }
    }

    fn ensure_can_grade_schedule(
        ctx: &ActorContext,
        schedule_id: &str,
        organization_id: Option<&str>,
    ) -> Result<(), GradingError> {
        let allowed = match organization_id {
            Some(org_id) => AuthorizationService::can_grade_submissions(
                ctx,
                schedule_id.to_owned(),
                org_id.to_owned(),
            ),
            None => match ctx.role {
                ActorRole::Admin | ActorRole::AdminObserver => true,
                ActorRole::Grader | ActorRole::Proctor => {
                    ctx.schedule_scope_id.as_deref() == Some(schedule_id)
                }
                ActorRole::Builder | ActorRole::Student => false,
            },
        };

        if allowed {
            Ok(())
        } else {
            Err(GradingError::NotFound)
        }
    }

    pub async fn list_sessions(&self, ctx: &ActorContext) -> Result<Vec<GradingSession>, GradingError> {
        self.ensure_materialized_state().await?;

        // Admins and AdminObservers can see all grading sessions
        // Other roles can only see grading sessions for their schedules
        let query = if matches!(
            ctx.role,
            ielts_backend_infrastructure::actor_context::ActorRole::Admin
                | ielts_backend_infrastructure::actor_context::ActorRole::AdminObserver
        ) {
            "SELECT * FROM grading_sessions ORDER BY updated_at DESC, start_time DESC"
        } else if let Some(ref schedule_id) = ctx.schedule_scope_id {
            "SELECT * FROM grading_sessions WHERE schedule_id = ? ORDER BY updated_at DESC, start_time DESC"
        } else {
            "SELECT * FROM grading_sessions WHERE 1=0 ORDER BY updated_at DESC, start_time DESC" // No access
        };

        let sessions = if let Some(schedule_id) = ctx.schedule_scope_id.clone() {
            sqlx::query_as::<_, GradingSession>(query)
                .bind(schedule_id.to_string())
                .fetch_all(&self.pool)
                .await?
        } else {
            sqlx::query_as::<_, GradingSession>(query)
                .fetch_all(&self.pool)
                .await?
        };

        Ok(sessions)
    }

    pub async fn get_session_detail(
        &self,
        ctx: &ActorContext,
        session_id: Uuid,
    ) -> Result<GradingSessionDetail, GradingError> {
        self.ensure_materialized_state().await?;

        let session =
            sqlx::query_as::<_, GradingSession>("SELECT * FROM grading_sessions WHERE id = ?")
                .bind(session_id.to_string())
                .fetch_optional(&self.pool)
                .await?
                .ok_or(GradingError::NotFound)?;

        let schedule = sqlx::query_as::<_, ExamSchedule>("SELECT * FROM exam_schedules WHERE id = ?")
            .bind(&session.schedule_id)
            .fetch_optional(&self.pool)
            .await?
            .ok_or(GradingError::NotFound)?;
        Self::ensure_can_grade_schedule(
            ctx,
            &session.schedule_id,
            schedule.organization_id.as_deref(),
        )?;

        let submissions = sqlx::query_as::<_, StudentSubmission>(
            "SELECT * FROM student_submissions WHERE schedule_id = ? ORDER BY submitted_at DESC",
        )
        .bind(&session.schedule_id)
        .fetch_all(&self.pool)
        .await?;

        Ok(GradingSessionDetail {
            session,
            submissions,
        })
    }

    pub async fn get_submission_bundle(
        &self,
        ctx: &ActorContext,
        submission_id: Uuid,
    ) -> Result<SubmissionReviewBundle, GradingError> {
        self.ensure_materialized_state().await?;
        let submission_id = submission_id.to_string();

        let submission = sqlx::query_as::<_, StudentSubmission>(
            "SELECT * FROM student_submissions WHERE id = ?",
        )
        .bind(&submission_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or(GradingError::NotFound)?;

        // Get the schedule to get organization_id
        let schedule = sqlx::query_as::<_, ExamSchedule>(
            "SELECT * FROM exam_schedules WHERE id = ?",
        )
        .bind(&submission.schedule_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or(GradingError::NotFound)?;

        // Check authorization: user must have access to grade this schedule
        Self::ensure_can_grade_schedule(
            ctx,
            &submission.schedule_id,
            schedule.organization_id.as_deref(),
        )?;

        let sections = sqlx::query_as::<_, SectionSubmission>(
            "SELECT * FROM section_submissions WHERE submission_id = ? ORDER BY section ASC",
        )
        .bind(&submission_id)
        .fetch_all(&self.pool)
        .await?;
        let writing_tasks = sqlx::query_as::<_, WritingTaskSubmission>(
            "SELECT * FROM writing_task_submissions WHERE submission_id = ? ORDER BY task_id ASC",
        )
        .bind(&submission_id)
        .fetch_all(&self.pool)
        .await?;
        let review_draft = sqlx::query_as::<_, ReviewDraft>(
            "SELECT * FROM review_drafts WHERE submission_id = ?",
        )
        .bind(&submission_id)
        .fetch_optional(&self.pool)
        .await?;

        Ok(SubmissionReviewBundle {
            submission,
            sections,
            writing_tasks,
            review_draft,
        })
    }

    pub async fn start_review(
        &self,
        ctx: &ActorContext,
        submission_id: Uuid,
        _req: StartReviewRequest,
    ) -> Result<ReviewDraft, GradingError> {
        self.ensure_materialized_state().await?;
        let submission_id_uuid = submission_id;
        let submission_id = submission_id_uuid.to_string();

        // Get submission to check authorization
        let submission = sqlx::query_as::<_, StudentSubmission>(
            "SELECT * FROM student_submissions WHERE id = ?",
        )
        .bind(&submission_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or(GradingError::NotFound)?;

        // Get the schedule to get organization_id
        let schedule = sqlx::query_as::<_, ExamSchedule>(
            "SELECT * FROM exam_schedules WHERE id = ?",
        )
        .bind(&submission.schedule_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or(GradingError::NotFound)?;

        // Check authorization: user must have access to grade this schedule
        Self::ensure_can_grade_schedule(
            ctx,
            &submission.schedule_id,
            schedule.organization_id.as_deref(),
        )?;

        if let Some(existing) =
            sqlx::query_as::<_, ReviewDraft>("SELECT * FROM review_drafts WHERE submission_id = ?")
                .bind(&submission_id)
                .fetch_optional(&self.pool)
                .await?
        {
            return Ok(existing);
        }

        let submission = sqlx::query_as::<_, StudentSubmission>(
            "SELECT * FROM student_submissions WHERE id = ?",
        )
        .bind(&submission_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or(GradingError::NotFound)?;
        let actor_id_str = ctx.actor_id.to_string();
        let draft_id = Uuid::new_v4().hyphenated();
        sqlx::query(
            r#"
            INSERT INTO review_drafts (
                id, submission_id, student_id, teacher_id, release_status,
                section_drafts, annotations, drawings, teacher_summary, checklist,
                has_unsaved_changes, created_at, updated_at, revision
            )
            VALUES (?, ?, ?, ?, 'draft', JSON_OBJECT(), JSON_ARRAY(), JSON_ARRAY(), JSON_OBJECT(), JSON_OBJECT(), false, NOW(), NOW(), 0)
            "#,
        )
        .bind(draft_id)
        .bind(&submission_id)
        .bind(submission.student_id)
        .bind(&actor_id_str)
        .execute(&self.pool)
        .await?;

        let draft = sqlx::query_as::<_, ReviewDraft>("SELECT * FROM review_drafts WHERE id = ?")
            .bind(draft_id)
            .fetch_one(&self.pool)
            .await?;

        sqlx::query(
            r#"
            UPDATE student_submissions
            SET
                grading_status = 'in_progress',
                assigned_teacher_id = ?,
                assigned_teacher_name = ?,
                updated_at = NOW()
            WHERE id = ?
            "#,
        )
        .bind(&actor_id_str)
        .bind("") // actor_name not available in ActorContext
        .bind(&submission_id)
        .execute(&self.pool)
        .await?;
        self.insert_review_event(
            submission_id_uuid,
            &actor_id_str,
            "",
            ReviewAction::ReviewStarted,
            None,
            Some("submitted"),
            Some("in_progress"),
            Some(json!({ "startedBy": actor_id_str })),
        )
        .await?;

        Ok(draft)
    }

    pub async fn get_review_draft(&self, submission_id: Uuid) -> Result<ReviewDraft, GradingError> {
        self.ensure_materialized_state().await?;

        sqlx::query_as::<_, ReviewDraft>("SELECT * FROM review_drafts WHERE submission_id = ?")
            .bind(submission_id.to_string())
            .fetch_optional(&self.pool)
            .await?
            .ok_or(GradingError::NotFound)
    }

    #[tracing::instrument(skip(self, req), fields(submission_id = %submission_id))]
    pub async fn save_review_draft(
        &self,
        ctx: &ActorContext,
        submission_id: Uuid,
        req: SaveReviewDraftRequest,
    ) -> Result<ReviewDraft, GradingError> {
        self.ensure_materialized_state().await?;
        let submission_id_db = submission_id.to_string();

        // Get submission to check authorization
        let submission = sqlx::query_as::<_, StudentSubmission>(
            "SELECT * FROM student_submissions WHERE id = ?",
        )
        .bind(&submission_id_db)
        .fetch_optional(&self.pool)
        .await?
        .ok_or(GradingError::NotFound)?;

        // Get the schedule to get organization_id
        let schedule = sqlx::query_as::<_, ExamSchedule>(
            "SELECT * FROM exam_schedules WHERE id = ?",
        )
        .bind(&submission.schedule_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or(GradingError::NotFound)?;

        // Check authorization: user must have access to grade this schedule
        Self::ensure_can_grade_schedule(
            ctx,
            &submission.schedule_id,
            schedule.organization_id.as_deref(),
        )?;

        let existing = self.get_review_draft(submission_id).await?;
        if let Some(revision) = req.revision {
            if revision != existing.revision {
                return Err(GradingError::Conflict(
                    "Review draft has been modified by another grader.".to_owned(),
                ));
            }
        }

        let next_release_status = req
            .release_status
            .unwrap_or_else(|| existing.release_status.clone());
        let actor_id_str = ctx.actor_id.to_string();
        sqlx::query(
            r#"
            UPDATE review_drafts
            SET
                teacher_id = ?,
                release_status = ?,
                section_drafts = ?,
                annotations = ?,
                drawings = ?,
                overall_feedback = ?,
                student_visible_notes = ?,
                internal_notes = ?,
                teacher_summary = ?,
                checklist = ?,
                has_unsaved_changes = ?,
                last_auto_save_at = NOW(),
                updated_at = NOW(),
                revision = revision + 1
            WHERE submission_id = ?
            "#,
        )
        .bind(&actor_id_str)
        .bind(next_release_status)
        .bind(req.section_drafts)
        .bind(req.annotations)
        .bind(req.drawings)
        .bind(req.overall_feedback)
        .bind(req.student_visible_notes)
        .bind(req.internal_notes)
        .bind(req.teacher_summary)
        .bind(req.checklist)
        .bind(req.has_unsaved_changes)
        .bind(&submission_id_db)
        .execute(&self.pool)
        .await?;

        let draft = sqlx::query_as::<_, ReviewDraft>("SELECT * FROM review_drafts WHERE submission_id = ?")
            .bind(&submission_id_db)
            .fetch_one(&self.pool)
            .await?;

        self.insert_review_event(
            submission_id,
            &actor_id_str,
            &actor_id_str,
            ReviewAction::DraftSaved,
            None,
            None,
            None,
            None,
        )
        .await?;

        Ok(draft)
    }

    pub async fn mark_grading_complete(
        &self,
        ctx: &ActorContext,
        submission_id: Uuid,
        _req: ActorActionRequest,
    ) -> Result<ReviewDraft, GradingError> {
        self.transition_release_status(
            ctx,
            submission_id,
            ReleaseStatus::GradingComplete,
            OverallGradingStatus::GradingComplete,
            ReviewAction::ReviewFinalized,
        )
        .await
    }

    pub async fn mark_ready_to_release(
        &self,
        ctx: &ActorContext,
        submission_id: Uuid,
        _req: ActorActionRequest,
    ) -> Result<ReviewDraft, GradingError> {
        self.transition_release_status(
            ctx,
            submission_id,
            ReleaseStatus::ReadyToRelease,
            OverallGradingStatus::ReadyToRelease,
            ReviewAction::MarkReadyToRelease,
        )
        .await
    }

    pub async fn reopen_review(
        &self,
        ctx: &ActorContext,
        submission_id: Uuid,
        _req: ActorActionRequest,
    ) -> Result<ReviewDraft, GradingError> {
        self.transition_release_status(
            ctx,
            submission_id,
            ReleaseStatus::Reopened,
            OverallGradingStatus::Reopened,
            ReviewAction::ReviewReopened,
        )
        .await
    }

    #[tracing::instrument(skip(self, req), fields(submission_id = %submission_id))]
    pub async fn release_now(
        &self,
        ctx: &ActorContext,
        submission_id: Uuid,
        req: ReleaseNowRequest,
    ) -> Result<StudentResult, GradingError> {
        self.ensure_materialized_state().await?;
        let submission_id_db = submission_id.to_string();

        let submission = sqlx::query_as::<_, StudentSubmission>(
            "SELECT * FROM student_submissions WHERE id = ?",
        )
        .bind(&submission_id_db)
        .fetch_optional(&self.pool)
        .await?
        .ok_or(GradingError::NotFound)?;

        // Get the schedule to get organization_id
        let schedule = sqlx::query_as::<_, ExamSchedule>(
            "SELECT * FROM exam_schedules WHERE id = ?",
        )
        .bind(&submission.schedule_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or(GradingError::NotFound)?;

        // Check authorization: user must have access to grade this schedule
        Self::ensure_can_grade_schedule(
            ctx,
            &submission.schedule_id,
            schedule.organization_id.as_deref(),
        )?;

        let draft = self.get_review_draft(submission_id).await?;
        let section_bands = build_section_bands(&draft.section_drafts);
        let overall_band = average_band(&section_bands);
        let now = Utc::now();
        let actor_id_str = ctx.actor_id.to_string();

        let existing = sqlx::query_as::<_, StudentResult>(
            "SELECT * FROM student_results WHERE submission_id = ? ORDER BY updated_at DESC LIMIT 1",
        )
        .bind(&submission_id_db)
        .fetch_optional(&self.pool)
        .await?;
        let revision_reason = req.revision_reason.clone();
        let result = if let Some(existing) = existing {
            sqlx::query(
                r#"
                UPDATE student_results
                SET
                    release_status = 'released',
                    released_at = NOW(),
                    released_by = ?,
                    overall_band = ?,
                    section_bands = ?,
                    teacher_summary = ?,
                    version = version + 1,
                    revision_reason = ?,
                    updated_at = NOW()
                WHERE id = ?
                "#,
            )
            .bind(&actor_id_str)
            .bind(overall_band)
            .bind(&section_bands)
            .bind(draft.teacher_summary.clone())
            .bind(revision_reason.clone())
            .bind(&existing.id)
            .execute(&self.pool)
            .await?;

            sqlx::query_as::<_, StudentResult>("SELECT * FROM student_results WHERE id = ?")
                .bind(&existing.id)
                .fetch_one(&self.pool)
                .await?
        } else {
            let result_id = Uuid::new_v4().hyphenated();
            sqlx::query(
                r#"
                INSERT INTO student_results (
                    id, submission_id, student_id, student_name, release_status, released_at,
                    released_by, overall_band, section_bands, writing_results,
                    teacher_summary, version, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, 'released', NOW(), ?, ?, ?, JSON_OBJECT(), ?, 1, NOW(), NOW())
                "#,
            )
            .bind(result_id)
            .bind(&submission_id_db)
            .bind(submission.student_id)
            .bind(submission.student_name)
            .bind(&actor_id_str)
            .bind(overall_band)
            .bind(&section_bands)
            .bind(draft.teacher_summary.clone())
            .execute(&self.pool)
            .await?;

            sqlx::query_as::<_, StudentResult>("SELECT * FROM student_results WHERE id = ?")
                .bind(result_id)
                .fetch_one(&self.pool)
                .await?
        };

        sqlx::query(
            "UPDATE review_drafts SET release_status = 'released', updated_at = NOW() WHERE submission_id = ?",
        )
        .bind(&submission_id_db)
        .execute(&self.pool)
        .await?;
        sqlx::query(
            "UPDATE student_submissions SET grading_status = 'released', updated_at = NOW() WHERE id = ?",
        )
        .bind(&submission_id_db)
        .execute(&self.pool)
        .await?;
        sqlx::query(
            r#"
            INSERT INTO release_events (id, result_id, submission_id, actor_id, action, payload, created_at)
            VALUES (?, ?, ?, ?, 'released', ?, NOW())
            "#,
        )
        .bind(Uuid::new_v4().to_string())
        .bind(&result.id)
        .bind(&submission_id_db)
        .bind(&actor_id_str)
        .bind(json!({ "overallBand": overall_band, "revisionReason": revision_reason }))
        .execute(&self.pool)
        .await?;
        self.insert_review_event(
            submission_id,
            &actor_id_str,
            "", // actor_name not available in ActorContext
            ReviewAction::ReleaseNow,
            None,
            Some("ready_to_release"),
            Some("released"),
            Some(json!({ "releasedBy": actor_id_str })),
        )
        .await?;

        Ok(result)
    }

    #[tracing::instrument(skip(self, req), fields(submission_id = %submission_id))]
    pub async fn schedule_release(
        &self,
        ctx: &ActorContext,
        submission_id: Uuid,
        req: ScheduleReleaseRequest,
    ) -> Result<ReviewDraft, GradingError> {
        self.ensure_materialized_state().await?;
        let submission_id_db = submission_id.to_string();

        let submission = sqlx::query_as::<_, StudentSubmission>(
            "SELECT * FROM student_submissions WHERE id = ?",
        )
        .bind(&submission_id_db)
        .fetch_optional(&self.pool)
        .await?
        .ok_or(GradingError::NotFound)?;

        // Get the schedule to get organization_id
        let schedule = sqlx::query_as::<_, ExamSchedule>(
            "SELECT * FROM exam_schedules WHERE id = ?",
        )
        .bind(&submission.schedule_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or(GradingError::NotFound)?;

        // Check authorization: user must have access to grade this schedule
        Self::ensure_can_grade_schedule(
            ctx,
            &submission.schedule_id,
            schedule.organization_id.as_deref(),
        )?;

        let draft = self.get_review_draft(submission_id).await?;
        let section_bands = build_section_bands(&draft.section_drafts);
        let overall_band = average_band(&section_bands);
        let now = Utc::now();
        let actor_id_str = ctx.actor_id.to_string();

        let existing = sqlx::query_as::<_, StudentResult>(
            "SELECT * FROM student_results WHERE submission_id = ? ORDER BY updated_at DESC LIMIT 1",
        )
        .bind(&submission_id_db)
        .fetch_optional(&self.pool)
        .await?;
        if let Some(existing) = existing {
            sqlx::query(
                r#"
                UPDATE student_results
                SET
                    release_status = 'ready_to_release',
                    released_at = NULL,
                    released_by = NULL,
                    scheduled_release_date = ?,
                    overall_band = ?,
                    section_bands = ?,
                    teacher_summary = ?,
                    updated_at = NOW()
                WHERE id = ?
                "#,
            )
            .bind(req.release_at)
            .bind(overall_band)
            .bind(&section_bands)
            .bind(draft.teacher_summary.clone())
            .bind(existing.id)
            .execute(&self.pool)
            .await?;
        } else {
            let result_id = Uuid::new_v4().hyphenated();
            sqlx::query(
                r#"
                INSERT INTO student_results (
                    id, submission_id, student_id, student_name, release_status,
                    scheduled_release_date, overall_band, section_bands, writing_results,
                    teacher_summary, version, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, 'ready_to_release', ?, ?, ?, JSON_OBJECT(), ?, 1, NOW(), NOW())
                "#,
            )
            .bind(result_id)
            .bind(&submission_id_db)
            .bind(submission.student_id)
            .bind(submission.student_name)
            .bind(req.release_at)
            .bind(overall_band)
            .bind(&section_bands)
            .bind(draft.teacher_summary.clone())
            .execute(&self.pool)
            .await?;
        }

        sqlx::query(
            "UPDATE review_drafts SET release_status = 'ready_to_release', has_unsaved_changes = false, updated_at = NOW() WHERE submission_id = ?",
        )
        .bind(&submission_id_db)
        .execute(&self.pool)
        .await?;
        let updated_draft = sqlx::query_as::<_, ReviewDraft>("SELECT * FROM review_drafts WHERE submission_id = ?")
            .bind(&submission_id_db)
            .fetch_one(&self.pool)
            .await?;
        sqlx::query(
            "UPDATE student_submissions SET grading_status = 'ready_to_release', updated_at = NOW() WHERE id = ?",
        )
        .bind(&submission_id_db)
        .execute(&self.pool)
        .await?;
        let event_id = Uuid::new_v4().hyphenated();
        let result_row = sqlx::query_as::<_, StudentResult>(
            "SELECT * FROM student_results WHERE submission_id = ? ORDER BY updated_at DESC LIMIT 1",
        )
        .bind(&submission_id_db)
        .fetch_optional(&self.pool)
        .await?;

        if let Some(result) = result_row {
            sqlx::query(
                r#"
                INSERT INTO release_events (id, result_id, submission_id, actor_id, action, payload, created_at)
                VALUES (?, ?, ?, ?, 'scheduled', ?, NOW())
                "#,
            )
            .bind(event_id)
            .bind(result.id)
            .bind(&submission_id_db)
            .bind(&actor_id_str)
            .bind(json!({
                "overallBand": overall_band,
                "scheduledReleaseDate": req.release_at,
                "teacherName": "", // actor_name not available in ActorContext
            }))
            .execute(&self.pool)
            .await?;
        }

        Ok(updated_draft)
    }

    pub async fn list_results(&self, ctx: &ActorContext) -> Result<Vec<StudentResult>, GradingError> {
        self.ensure_materialized_state().await?;

        // Admins and AdminObservers can see all results
        // Other roles can only see results for their schedules
        let query = if matches!(
            ctx.role,
            ielts_backend_infrastructure::actor_context::ActorRole::Admin
                | ielts_backend_infrastructure::actor_context::ActorRole::AdminObserver
        ) {
            "SELECT * FROM student_results ORDER BY updated_at DESC, created_at DESC"
        } else if let Some(ref schedule_id) = ctx.schedule_scope_id {
            "SELECT * FROM student_results WHERE schedule_id = ? ORDER BY updated_at DESC, created_at DESC"
        } else {
            "SELECT * FROM student_results WHERE 1=0 ORDER BY updated_at DESC, created_at DESC" // No access
        };

        let results = if let Some(schedule_id) = ctx.schedule_scope_id.clone() {
            sqlx::query_as::<_, StudentResult>(query)
                .bind(schedule_id.to_string())
                .fetch_all(&self.pool)
                .await?
        } else {
            sqlx::query_as::<_, StudentResult>(query)
                .fetch_all(&self.pool)
                .await?
        };

        Ok(results)
    }

    pub async fn get_result(&self, result_id: Uuid) -> Result<StudentResult, GradingError> {
        sqlx::query_as::<_, StudentResult>("SELECT * FROM student_results WHERE id = ?")
            .bind(result_id)
            .fetch_optional(&self.pool)
            .await?
            .ok_or(GradingError::NotFound)
    }

    pub async fn get_result_events(
        &self,
        result_id: Uuid,
    ) -> Result<Vec<ReleaseEvent>, GradingError> {
        sqlx::query_as::<_, ReleaseEvent>(
            "SELECT * FROM release_events WHERE result_id = ? ORDER BY created_at DESC",
        )
        .bind(result_id)
        .fetch_all(&self.pool)
        .await
        .map_err(GradingError::from)
    }

    pub async fn analytics(&self) -> Result<ResultsAnalytics, GradingError> {
        self.ensure_materialized_state().await?;

        let total_results: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM student_results")
            .fetch_one(&self.pool)
            .await?;
        let released_results: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM student_results WHERE release_status = 'released'",
        )
        .fetch_one(&self.pool)
        .await?;
        let ready_to_release: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM student_results WHERE release_status = 'ready_to_release'",
        )
        .fetch_one(&self.pool)
        .await?;
        let average_overall_band: f64 =
            sqlx::query_scalar("SELECT COALESCE(AVG(overall_band), 0) FROM student_results")
                .fetch_one(&self.pool)
                .await?;

        Ok(ResultsAnalytics {
            total_results,
            released_results,
            ready_to_release,
            average_overall_band,
        })
    }

    pub async fn export_results(&self, ctx: &ActorContext) -> Result<Value, GradingError> {
        let results = self.list_results(ctx).await?;
        Ok(json!({
            "format": "json",
            "generatedAt": Utc::now(),
            "count": results.len(),
            "items": results,
        }))
    }

    async fn transition_release_status(
        &self,
        ctx: &ActorContext,
        submission_id: Uuid,
        release_status: ReleaseStatus,
        grading_status: OverallGradingStatus,
        event: ReviewAction,
    ) -> Result<ReviewDraft, GradingError> {
        self.ensure_materialized_state().await?;
        let submission_id_db = submission_id.to_string();
        let actor_id_str = ctx.actor_id.to_string();
        sqlx::query(
            r#"
            UPDATE review_drafts
            SET release_status = ?, updated_at = NOW(), revision = revision + 1
            WHERE submission_id = ?
            "#,
        )
        .bind(release_status)
        .bind(&submission_id_db)
        .execute(&self.pool)
        .await?;
        let draft = sqlx::query_as::<_, ReviewDraft>("SELECT * FROM review_drafts WHERE submission_id = ?")
            .bind(&submission_id_db)
            .fetch_optional(&self.pool)
            .await?
            .ok_or(GradingError::NotFound)?;
        sqlx::query(
            "UPDATE student_submissions SET grading_status = ?, updated_at = NOW() WHERE id = ?",
        )
        .bind(grading_status)
        .bind(&submission_id_db)
        .execute(&self.pool)
        .await?;
        self.insert_review_event(
            submission_id,
            &actor_id_str,
            "", // actor_name not available in ActorContext
            event,
            None,
            None,
            None,
            None,
        )
        .await?;

        Ok(draft)
    }

    #[allow(clippy::too_many_arguments)]
    async fn insert_review_event(
        &self,
        submission_id: Uuid,
        teacher_id: &str,
        teacher_name: &str,
        action: ReviewAction,
        section: Option<&str>,
        from_status: Option<&str>,
        to_status: Option<&str>,
        payload: Option<Value>,
    ) -> Result<(), GradingError> {
        sqlx::query(
            r#"
            INSERT INTO review_events (
                id, submission_id, teacher_id, teacher_name, action, section,
                from_status, to_status, payload, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
            "#,
        )
        .bind(Uuid::new_v4().hyphenated())
        .bind(submission_id.to_string())
        .bind(teacher_id)
        .bind(teacher_name)
        .bind(action)
        .bind(section)
        .bind(from_status)
        .bind(to_status)
        .bind(payload)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    async fn ensure_materialized_state(&self) -> Result<(), GradingError> {
        self.sync_sessions_from_schedules().await?;
        self.sync_submissions_from_attempts().await?;
        self.refresh_session_counters().await?;
        Ok(())
    }

    async fn sync_sessions_from_schedules(&self) -> Result<(), GradingError> {
        let schedules = sqlx::query_as::<_, ScheduleSeedRow>(
            r#"
            SELECT
                id,
                exam_id,
                exam_title,
                published_version_id,
                cohort_name,
                institution,
                start_time,
                end_time,
                status,
                created_at,
                created_by,
                updated_at
            FROM exam_schedules
            ORDER BY start_time ASC
            "#,
        )
        .fetch_all(&self.pool)
        .await?;

        for schedule in schedules {
            let assigned_teachers = json!([]);
            sqlx::query(
                r#"
                INSERT INTO grading_sessions (
                    id, schedule_id, exam_id, exam_title, published_version_id, cohort_name,
                    institution, start_time, end_time, status, total_students, submitted_count,
                    pending_manual_reviews, in_progress_reviews, finalized_reviews, overdue_reviews,
                    assigned_teachers, created_at, created_by, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, 0, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                    exam_id = VALUES(exam_id),
                    exam_title = VALUES(exam_title),
                    published_version_id = VALUES(published_version_id),
                    cohort_name = VALUES(cohort_name),
                    institution = VALUES(institution),
                    start_time = VALUES(start_time),
                    end_time = VALUES(end_time),
                    status = VALUES(status),
                    updated_at = VALUES(updated_at)
                "#,
            )
            .bind(schedule.id)
            .bind(schedule.id)
            .bind(schedule.exam_id)
            .bind(schedule.exam_title)
            .bind(schedule.published_version_id)
            .bind(schedule.cohort_name)
            .bind(schedule.institution)
            .bind(schedule.start_time)
            .bind(schedule.end_time)
            .bind(map_schedule_status(schedule.status))
            .bind(assigned_teachers)
            .bind(schedule.created_at)
            .bind(schedule.created_by)
            .bind(schedule.updated_at)
            .execute(&self.pool)
            .await?;
        }

        Ok(())
    }

    async fn sync_submissions_from_attempts(&self) -> Result<(), GradingError> {
        let attempts = sqlx::query_as::<_, AttemptSubmissionRow>(
            r#"
            SELECT
                a.id,
                a.schedule_id,
                a.exam_id,
                a.published_version_id,
                a.candidate_id,
                a.candidate_name,
                a.candidate_email,
                s.cohort_name,
                a.submitted_at,
                a.final_submission
            FROM student_attempts a
            JOIN exam_schedules s ON s.id = a.schedule_id
            WHERE a.final_submission IS NOT NULL
            ORDER BY a.updated_at ASC
            "#,
        )
        .fetch_all(&self.pool)
        .await?;

        for attempt in attempts {
            let attempt_id = attempt.id.to_string();
            let submitted_at = attempt.submitted_at.unwrap_or_else(Utc::now);
            let section_statuses = json!({
                "listening": "auto_graded",
                "reading": "auto_graded",
                "writing": "needs_review",
                "speaking": "pending"
            });

            let existing_submission_id = sqlx::query_scalar::<_, String>(
                "SELECT id FROM student_submissions WHERE attempt_id = ?",
            )
            .bind(&attempt_id)
            .fetch_optional(&self.pool)
            .await?;
            let submission_id = existing_submission_id.unwrap_or_else(|| Uuid::new_v4().to_string());

            sqlx::query(
                r#"
                INSERT INTO student_submissions (
                    id, attempt_id, schedule_id, exam_id, published_version_id, student_id,
                    student_name, student_email, cohort_name, submitted_at, grading_status,
                    section_statuses, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', ?, NOW(), NOW())
                ON DUPLICATE KEY UPDATE
                    submitted_at = VALUES(submitted_at),
                    student_name = VALUES(student_name),
                    student_email = VALUES(student_email),
                    cohort_name = VALUES(cohort_name),
                    updated_at = VALUES(updated_at)
                "#,
            )
            .bind(&submission_id)
            .bind(&attempt_id)
            .bind(attempt.schedule_id)
            .bind(attempt.exam_id)
            .bind(attempt.published_version_id)
            .bind(attempt.candidate_id)
            .bind(attempt.candidate_name)
            .bind(attempt.candidate_email)
            .bind(attempt.cohort_name)
            .bind(submitted_at)
            .bind(&section_statuses)
            .execute(&self.pool)
            .await?;

            let submission = sqlx::query_as::<_, StudentSubmission>(
                "SELECT * FROM student_submissions WHERE attempt_id = ?",
            )
            .bind(&attempt_id)
            .fetch_one(&self.pool)
            .await?;

            self.ensure_section_submissions(&submission, &attempt.final_submission)
                .await?;
        }

        Ok(())
    }

    async fn ensure_section_submissions(
        &self,
        submission: &StudentSubmission,
        final_submission: &Value,
    ) -> Result<(), GradingError> {
        let answers = final_submission
            .get("answers")
            .cloned()
            .unwrap_or_else(|| json!({}));
        let writing_answers = final_submission
            .get("writingAnswers")
            .cloned()
            .unwrap_or_else(|| json!({}));
        let submitted_at = submission.submitted_at;

        for (section, payload, status) in [
            (
                "listening",
                json!({ "type": "listening", "answers": answers.clone() }),
                SectionGradingStatus::AutoGraded,
            ),
            (
                "reading",
                json!({ "type": "reading", "answers": answers.clone() }),
                SectionGradingStatus::AutoGraded,
            ),
            (
                "writing",
                json!({ "type": "writing", "tasks": writing_task_array(&writing_answers) }),
                SectionGradingStatus::NeedsReview,
            ),
            (
                "speaking",
                json!({ "type": "speaking", "responses": [] }),
                SectionGradingStatus::Pending,
            ),
        ] {
            let existing_section_id = sqlx::query_scalar::<_, String>(
                "SELECT id FROM section_submissions WHERE submission_id = ? AND section = ?",
            )
            .bind(&submission.id)
            .bind(section)
            .fetch_optional(&self.pool)
            .await?;
            let section_id = existing_section_id.unwrap_or_else(|| Uuid::new_v4().to_string());

            sqlx::query(
                r#"
                INSERT INTO section_submissions (
                    id, submission_id, section, answers, auto_grading_results, grading_status, submitted_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                    answers = VALUES(answers),
                    auto_grading_results = COALESCE(auto_grading_results, VALUES(auto_grading_results)),
                    submitted_at = VALUES(submitted_at)
                "#,
            )
            .bind(&section_id)
            .bind(&submission.id)
            .bind(section)
            .bind(&payload)
            .bind(if matches!(status, SectionGradingStatus::AutoGraded) {
                Some(json!({ "generatedAt": submitted_at, "totalScore": 0, "maxScore": 0, "percentage": 0, "questionResults": [] }))
            } else {
                None
            })
            .bind(status)
            .bind(submitted_at)
            .execute(&self.pool)
            .await?;

            if section == "writing" {
                let tasks = writing_task_entries(&writing_answers);
                for (task_id, value) in tasks {
                    let task_label = value
                        .get("label")
                        .and_then(Value::as_str)
                        .unwrap_or(&task_id);
                    let prompt = value
                        .get("prompt")
                        .and_then(Value::as_str)
                        .unwrap_or("");
                    let student_text = value
                        .get("text")
                        .and_then(Value::as_str)
                        .unwrap_or("");
                    let word_count = value
                        .get("wordCount")
                        .and_then(Value::as_i64)
                        .unwrap_or(0)
                        .clamp(0, i32::MAX as i64) as i32;

                    sqlx::query(
                        r#"
                        INSERT INTO writing_task_submissions (
                            id, section_submission_id, submission_id, task_id, task_label, prompt,
                            student_text, word_count, annotations, grading_status, submitted_at
                        )
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        ON DUPLICATE KEY UPDATE
                            task_label = VALUES(task_label),
                            prompt = VALUES(prompt),
                            student_text = VALUES(student_text),
                            word_count = VALUES(word_count)
                        "#,
                    )
                    .bind(Uuid::new_v4().to_string())
                    .bind(&section_id)
                    .bind(&submission.id)
                    .bind(&task_id)
                    .bind(task_label)
                    .bind(prompt)
                    .bind(student_text)
                    .bind(word_count)
                    .bind(json!([]))
                    .bind(SectionGradingStatus::NeedsReview)
                    .bind(submitted_at)
                    .execute(&self.pool)
                    .await?;
                }
            }
        }

        Ok(())
    }

    async fn refresh_session_counters(&self) -> Result<(), GradingError> {
        let rows = sqlx::query_as::<_, SessionCounterRow>(REFRESH_SESSION_COUNTERS_SQL)
        .fetch_all(&self.pool)
        .await?;

        for row in rows {
            sqlx::query(
                r#"
                UPDATE grading_sessions
                SET
                    total_students = ?,
                    submitted_count = ?,
                    pending_manual_reviews = ?,
                    in_progress_reviews = ?,
                    finalized_reviews = ?,
                    overdue_reviews = ?,
                    updated_at = NOW()
                WHERE schedule_id = ?
                "#,
            )
            .bind(row.total_students as i32)
            .bind(row.submitted_count as i32)
            .bind(row.pending_manual_reviews as i32)
            .bind(row.in_progress_reviews as i32)
            .bind(row.finalized_reviews as i32)
            .bind(row.overdue_reviews as i32)
            .bind(row.schedule_id)
            .execute(&self.pool)
            .await?;
        }

        Ok(())
    }
}

// MySQL returns `DECIMAL` for `SUM(...)` in many cases, which `sqlx` will not decode into `i64`.
// Using `COUNT(CASE WHEN ... THEN 1 END)` keeps the column type as an integer while producing the
// same result.
const REFRESH_SESSION_COUNTERS_SQL: &str = r#"
SELECT
    schedule_id,
    COUNT(*) AS total_students,
    COUNT(*) AS submitted_count,
    COUNT(CASE WHEN grading_status IN ('submitted', 'reopened') THEN 1 END) AS pending_manual_reviews,
    COUNT(CASE WHEN grading_status = 'in_progress' THEN 1 END) AS in_progress_reviews,
    COUNT(CASE WHEN grading_status IN ('grading_complete', 'ready_to_release', 'released') THEN 1 END) AS finalized_reviews,
    COUNT(CASE WHEN is_overdue THEN 1 END) AS overdue_reviews
FROM student_submissions
GROUP BY schedule_id
"#;

#[derive(FromRow)]
struct ScheduleSeedRow {
    id: Hyphenated,
    exam_id: Hyphenated,
    exam_title: String,
    published_version_id: Hyphenated,
    cohort_name: String,
    institution: Option<String>,
    start_time: chrono::DateTime<Utc>,
    end_time: chrono::DateTime<Utc>,
    status: ScheduleStatus,
    created_at: chrono::DateTime<Utc>,
    created_by: String,
    updated_at: chrono::DateTime<Utc>,
}

#[derive(FromRow)]
struct AttemptSubmissionRow {
    id: Hyphenated,
    schedule_id: Hyphenated,
    exam_id: Hyphenated,
    published_version_id: Hyphenated,
    candidate_id: String,
    candidate_name: String,
    candidate_email: String,
    cohort_name: String,
    submitted_at: Option<chrono::DateTime<Utc>>,
    final_submission: Value,
}

#[derive(FromRow)]
struct SessionCounterRow {
    schedule_id: Hyphenated,
    total_students: i64,
    submitted_count: i64,
    pending_manual_reviews: i64,
    in_progress_reviews: i64,
    finalized_reviews: i64,
    overdue_reviews: i64,
}

fn map_schedule_status(status: ScheduleStatus) -> GradingSessionStatus {
    match status {
        ScheduleStatus::Scheduled => GradingSessionStatus::Scheduled,
        ScheduleStatus::Live => GradingSessionStatus::Live,
        ScheduleStatus::Completed => GradingSessionStatus::Completed,
        ScheduleStatus::Cancelled => GradingSessionStatus::Cancelled,
    }
}

fn writing_task_array(writing_answers: &Value) -> Value {
    Value::Array(
        writing_task_entries(writing_answers)
            .into_iter()
            .map(|(task_id, value)| {
                let text_value = value
                    .get("text")
                    .cloned()
                    .unwrap_or_else(|| value.clone());
                json!({
                    "taskId": task_id,
                    "text": text_value,
                    "wordCount": word_count(&value)
                })
            })
            .collect(),
    )
}

#[cfg(test)]
mod refresh_session_counters_tests {
    use super::REFRESH_SESSION_COUNTERS_SQL;

    #[test]
    fn refresh_session_counters_query_avoids_mysql_decimal_sum_type() {
        assert!(
            !REFRESH_SESSION_COUNTERS_SQL.contains("SUM("),
            "SUM(...) frequently yields DECIMAL in MySQL, which breaks decoding into i64"
        );
        assert!(
            REFRESH_SESSION_COUNTERS_SQL.contains("pending_manual_reviews"),
            "sanity check: query should still compute pending_manual_reviews"
        );
    }
}

fn writing_task_entries(writing_answers: &Value) -> Vec<(String, Value)> {
    let Some(items) = writing_answers.as_object() else {
        return vec![];
    };

    items
        .iter()
        .map(|(task_id, value)| {
            let normalized = match value {
                Value::Null => json!({
                    "label": task_id,
                    "prompt": "",
                    "text": "",
                    "wordCount": 0
                }),
                Value::String(text) => json!({
                    "label": task_id,
                    "prompt": "",
                    "text": text,
                    "wordCount": text.split_whitespace().count()
                }),
                Value::Object(_) => {
                    let label = value
                        .get("label")
                        .and_then(Value::as_str)
                        .unwrap_or(task_id);
                    let prompt = value
                        .get("prompt")
                        .and_then(Value::as_str)
                        .unwrap_or("");
                    let text = value
                        .get("text")
                        .and_then(Value::as_str)
                        .unwrap_or("");
                    let word_count = value
                        .get("wordCount")
                        .and_then(Value::as_i64)
                        .unwrap_or_else(|| text.split_whitespace().count() as i64);
                    json!({
                        "label": label,
                        "prompt": prompt,
                        "text": text,
                        "wordCount": word_count
                    })
                }
                _ => json!({
                    "label": task_id,
                    "prompt": "",
                    "text": "",
                    "wordCount": 0
                }),
            };

            (task_id.clone(), normalized)
        })
        .collect()
}

fn word_count(value: &Value) -> i32 {
    match value {
        Value::String(text) => text.split_whitespace().count() as i32,
        _ => value
            .get("text")
            .and_then(|v| v.as_str())
            .map(|s| s.split_whitespace().count() as i32)
            .unwrap_or(0),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn writing_task_array_supports_string_writing_answers() {
        let writing_answers = json!({
            "task1": "Hello world"
        });

        let tasks = writing_task_array(&writing_answers);
        assert_eq!(
            tasks,
            json!([
                {"taskId": "task1", "text": "Hello world", "wordCount": 2}
            ])
        );
    }

    #[test]
    fn writing_task_entries_normalizes_string_payloads_for_downstream_inserts() {
        let writing_answers = json!({
            "task1": "Hello world"
        });

        let entries = writing_task_entries(&writing_answers);
        assert_eq!(entries.len(), 1);

        let (task_id, value) = &entries[0];
        assert_eq!(task_id, "task1");
        assert_eq!(value.get("text").and_then(Value::as_str), Some("Hello world"));
        assert_eq!(value.get("label").and_then(Value::as_str), Some("task1"));
        assert_eq!(value.get("prompt").and_then(Value::as_str), Some(""));
        assert_eq!(value.get("wordCount").and_then(Value::as_i64), Some(2));
    }
}

fn build_section_bands(section_drafts: &Value) -> Value {
    let mut section_bands = Map::new();
    for key in ["listening", "reading", "speaking"] {
        section_bands.insert(
            key.to_owned(),
            json!(extract_overall_band(section_drafts.get(key))),
        );
    }

    let writing_value = section_drafts
        .get("writing")
        .and_then(Value::as_object)
        .map(|writing| {
            let values = writing
                .values()
                .filter_map(|value| value.get("overallBand").and_then(Value::as_f64))
                .collect::<Vec<_>>();
            if values.is_empty() {
                0.0
            } else {
                values.iter().sum::<f64>() / values.len() as f64
            }
        })
        .unwrap_or(0.0);
    section_bands.insert("writing".to_owned(), json!(writing_value));

    Value::Object(section_bands)
}

fn extract_overall_band(value: Option<&Value>) -> f64 {
    value
        .and_then(|value| value.get("overallBand"))
        .and_then(Value::as_f64)
        .unwrap_or(0.0)
}

fn average_band(section_bands: &Value) -> f64 {
    let values = section_bands
        .as_object()
        .map(|bands| {
            bands
                .values()
                .filter_map(Value::as_f64)
                .filter(|value| *value > 0.0)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    if values.is_empty() {
        0.0
    } else {
        values.iter().sum::<f64>() / values.len() as f64
    }
}
