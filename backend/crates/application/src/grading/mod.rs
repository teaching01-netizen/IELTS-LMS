pub mod ports;
pub mod projection_sync;
pub mod review_actions;
pub mod session_queries;

use chrono::{DateTime, Utc};
use ielts_backend_domain::{
    grading::{
        ActorActionRequest, GradingScheduleObjectiveOverride, GradingSession, GradingSessionDetail,
        GradingSessionPagination, GradingSessionStatus, ObjectiveOverrideDeleteRequest,
        ObjectiveOverrideUpsertRequest, OverallGradingStatus, ReleaseEvent, ReleaseNowRequest,
        ReleaseStatus, ResultsAnalytics, ReviewAction, ReviewDraft, ReviewDraftSummary,
        SaveReviewDraftRequest, ScheduleReleaseRequest, SectionGradingStatus, SectionSubmission,
        StartReviewRequest, StudentResult, StudentSubmission, SubmissionReviewBundle,
        SubmissionReviewSummary, WritingTaskSubmission,
    },
    schedule::{ExamSchedule, ScheduleStatus},
};
use ielts_backend_infrastructure::{
    actor_context::ActorContext, actor_context::ActorRole, authorization::AuthorizationService,
};
use serde_json::{json, Map, Value};
use sqlx::{FromRow, MySql, MySqlPool, QueryBuilder};
use std::collections::{HashMap, HashSet};
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

#[derive(Debug, Clone, Default)]
pub struct GradingProjectionRequest {
    pub watermark: Option<DateTime<Utc>>,
    pub bootstrap_after: Option<DateTime<Utc>>,
    pub batch_size: Option<i64>,
}

#[derive(Debug, Clone, Default)]
pub struct GradingProjectionReport {
    pub schedule_rows_synced: u64,
    pub submission_rows_synced: u64,
    pub section_rows_synced: u64,
    pub writing_task_rows_synced: u64,
    pub affected_schedule_ids: HashSet<String>,
    pub next_watermark: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectiveAutoGradingBackfillRequest {
    pub apply: bool,
    pub schedule_id: Option<String>,
    pub exam_id: Option<String>,
    pub published_version_id: Option<String>,
    pub attempt_id: Option<String>,
    pub submission_id: Option<String>,
    pub limit: Option<u64>,
}

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectiveAutoGradingBackfillReport {
    pub attempts_scanned: u64,
    pub submissions_matched: u64,
    pub submissions_missing: u64,
    pub sections_checked: u64,
    pub sections_needing_update: u64,
    pub sections_updated: u64,
    pub submissions_updated: u64,
}

pub struct GradingService {
    pool: MySqlPool,
    sync_on_read_fallback: bool,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ObjectiveOverridePayload {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    correct_answer: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    accepted_answers: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    correct_option_ids: Option<Vec<String>>,
    scoring_rule: String,
    max_score: i64,
}

impl GradingService {
    pub fn new(pool: MySqlPool) -> Self {
        Self {
            pool,
            sync_on_read_fallback: false,
        }
    }

    pub fn with_sync_on_read_fallback(pool: MySqlPool, sync_on_read_fallback: bool) -> Self {
        Self {
            pool,
            sync_on_read_fallback,
        }
    }

    async fn maybe_sync_on_read(&self) -> Result<(), GradingError> {
        if self.sync_on_read_fallback {
            self.ensure_materialized_state().await?;
        }
        Ok(())
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

    pub async fn list_sessions(
        &self,
        ctx: &ActorContext,
        limit: u64,
    ) -> Result<Vec<GradingSession>, GradingError> {
        self.maybe_sync_on_read().await?;
        let capped_limit = limit.clamp(1, 500) as i64;

        // Admins and AdminObservers can see all grading sessions
        // Other roles can only see grading sessions for their schedules
        let query = if matches!(
            ctx.role,
            ielts_backend_infrastructure::actor_context::ActorRole::Admin
                | ielts_backend_infrastructure::actor_context::ActorRole::AdminObserver
        ) {
            "SELECT * FROM grading_sessions ORDER BY updated_at DESC, start_time DESC, id DESC LIMIT ?"
        } else if let Some(ref schedule_id) = ctx.schedule_scope_id {
            "SELECT * FROM grading_sessions WHERE schedule_id = ? ORDER BY updated_at DESC, start_time DESC, id DESC LIMIT ?"
        } else {
            "SELECT * FROM grading_sessions WHERE 1=0 ORDER BY updated_at DESC, start_time DESC, id DESC LIMIT ?"
            // No access
        };

        let sessions = if let Some(schedule_id) = ctx.schedule_scope_id.clone() {
            sqlx::query_as::<_, GradingSession>(query)
                .bind(schedule_id.to_string())
                .bind(capped_limit)
                .fetch_all(&self.pool)
                .await?
        } else {
            sqlx::query_as::<_, GradingSession>(query)
                .bind(capped_limit)
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
        self.get_session_detail_page(ctx, session_id, 1, 25).await
    }

    pub async fn get_session_detail_page(
        &self,
        ctx: &ActorContext,
        session_id: Uuid,
        page: u64,
        page_size: u64,
    ) -> Result<GradingSessionDetail, GradingError> {
        self.maybe_sync_on_read().await?;
        let page = page.max(1);
        let page_size = page_size.clamp(1, 100);
        let offset = ((page - 1) * page_size) as i64;
        let page_size_i64 = page_size as i64;

        let session =
            sqlx::query_as::<_, GradingSession>("SELECT * FROM grading_sessions WHERE id = ?")
                .bind(session_id.to_string())
                .fetch_optional(&self.pool)
                .await?
                .ok_or(GradingError::NotFound)?;

        let schedule =
            sqlx::query_as::<_, ExamSchedule>("SELECT * FROM exam_schedules WHERE id = ?")
                .bind(&session.schedule_id)
                .fetch_optional(&self.pool)
                .await?
                .ok_or(GradingError::NotFound)?;
        Self::ensure_can_grade_schedule(
            ctx,
            &session.schedule_id,
            schedule.organization_id.as_deref(),
        )?;

        let total_submissions: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM student_submissions WHERE schedule_id = ?")
                .bind(&session.schedule_id)
                .fetch_one(&self.pool)
                .await?;
        let submissions_sql = student_submission_query(
            "WHERE s.schedule_id = ? ORDER BY s.submitted_at DESC LIMIT ? OFFSET ?",
        );
        let submissions = sqlx::query_as::<_, StudentSubmission>(&submissions_sql)
            .bind(&session.schedule_id)
            .bind(page_size_i64)
            .bind(offset)
            .fetch_all(&self.pool)
            .await?;
        let total = total_submissions.max(0) as u64;
        let has_more = offset.saturating_add(page_size_i64) < total_submissions.max(0);

        Ok(GradingSessionDetail {
            session,
            submissions,
            pagination: Some(GradingSessionPagination {
                page,
                page_size,
                total,
                has_more,
            }),
        })
    }

    pub async fn get_submission_summary(
        &self,
        ctx: &ActorContext,
        submission_id: Uuid,
    ) -> Result<SubmissionReviewSummary, GradingError> {
        self.maybe_sync_on_read().await?;
        let submission_id = submission_id.to_string();

        let submission_sql = student_submission_query("WHERE s.id = ?");
        let submission = sqlx::query_as::<_, StudentSubmission>(&submission_sql)
            .bind(&submission_id)
            .fetch_optional(&self.pool)
            .await?
            .ok_or(GradingError::NotFound)?;

        // Get the schedule to get organization_id
        let schedule =
            sqlx::query_as::<_, ExamSchedule>("SELECT * FROM exam_schedules WHERE id = ?")
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

        let review_draft =
            sqlx::query_as::<_, ReviewDraft>("SELECT * FROM review_drafts WHERE submission_id = ?")
                .bind(&submission_id)
                .fetch_optional(&self.pool)
                .await?;

        Ok(SubmissionReviewSummary {
            submission,
            review_draft: review_draft.map(|draft| ReviewDraftSummary {
                id: draft.id,
                submission_id: draft.submission_id,
                teacher_id: draft.teacher_id,
                release_status: draft.release_status,
                has_unsaved_changes: draft.has_unsaved_changes,
                last_auto_save_at: draft.last_auto_save_at,
                updated_at: draft.updated_at,
                revision: draft.revision,
            }),
        })
    }

    pub async fn get_submission_sections(
        &self,
        ctx: &ActorContext,
        submission_id: Uuid,
    ) -> Result<Vec<SectionSubmission>, GradingError> {
        let summary = self.get_submission_summary(ctx, submission_id).await?;
        let sections = sqlx::query_as::<_, SectionSubmission>(
            "SELECT * FROM section_submissions WHERE submission_id = ? ORDER BY section ASC",
        )
        .bind(&summary.submission.id)
        .fetch_all(&self.pool)
        .await?;
        Ok(sections)
    }

    pub async fn get_submission_writing_tasks(
        &self,
        ctx: &ActorContext,
        submission_id: Uuid,
    ) -> Result<Vec<WritingTaskSubmission>, GradingError> {
        let summary = self.get_submission_summary(ctx, submission_id).await?;
        let writing_tasks = sqlx::query_as::<_, WritingTaskSubmission>(
            "SELECT * FROM writing_task_submissions WHERE submission_id = ? ORDER BY task_id ASC",
        )
        .bind(&summary.submission.id)
        .fetch_all(&self.pool)
        .await?;
        Ok(writing_tasks)
    }

    pub async fn get_submission_bundle(
        &self,
        ctx: &ActorContext,
        submission_id: Uuid,
    ) -> Result<SubmissionReviewBundle, GradingError> {
        let summary = self.get_submission_summary(ctx, submission_id).await?;
        let sections = self.get_submission_sections(ctx, submission_id).await?;
        let writing_tasks = self
            .get_submission_writing_tasks(ctx, submission_id)
            .await?;
        let review_draft =
            sqlx::query_as::<_, ReviewDraft>("SELECT * FROM review_drafts WHERE submission_id = ?")
                .bind(summary.submission.id.clone())
                .fetch_optional(&self.pool)
                .await?;

        Ok(SubmissionReviewBundle {
            submission: summary.submission,
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
        let submission_id_uuid = submission_id;
        let submission_id = submission_id_uuid.to_string();

        // Get submission to check authorization
        let submission_sql = student_submission_query("WHERE s.id = ?");
        let submission = sqlx::query_as::<_, StudentSubmission>(&submission_sql)
            .bind(&submission_id)
            .fetch_optional(&self.pool)
            .await?
            .ok_or(GradingError::NotFound)?;

        // Get the schedule to get organization_id
        let schedule =
            sqlx::query_as::<_, ExamSchedule>("SELECT * FROM exam_schedules WHERE id = ?")
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

        let submission_sql = student_submission_query("WHERE s.id = ?");
        let submission = sqlx::query_as::<_, StudentSubmission>(&submission_sql)
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
        self.maybe_sync_on_read().await?;

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
        let submission_id_db = submission_id.to_string();

        // Get submission to check authorization
        let submission_sql = student_submission_query("WHERE s.id = ?");
        let submission = sqlx::query_as::<_, StudentSubmission>(&submission_sql)
            .bind(&submission_id_db)
            .fetch_optional(&self.pool)
            .await?
            .ok_or(GradingError::NotFound)?;

        // Get the schedule to get organization_id
        let schedule =
            sqlx::query_as::<_, ExamSchedule>("SELECT * FROM exam_schedules WHERE id = ?")
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
        let revision = req.revision.ok_or_else(|| {
            GradingError::Validation(
                "Review draft revision is required for optimistic locking.".to_owned(),
            )
        })?;
        if revision != existing.revision {
            return Err(GradingError::Conflict(
                "Review draft has been modified by another grader.".to_owned(),
            ));
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

        let draft =
            sqlx::query_as::<_, ReviewDraft>("SELECT * FROM review_drafts WHERE submission_id = ?")
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
        let submission_id_db = submission_id.to_string();

        let submission_sql = student_submission_query("WHERE s.id = ?");
        let submission = sqlx::query_as::<_, StudentSubmission>(&submission_sql)
            .bind(&submission_id_db)
            .fetch_optional(&self.pool)
            .await?
            .ok_or(GradingError::NotFound)?;

        // Get the schedule to get organization_id
        let schedule =
            sqlx::query_as::<_, ExamSchedule>("SELECT * FROM exam_schedules WHERE id = ?")
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
        if draft.release_status != ReleaseStatus::ReadyToRelease {
            return Err(GradingError::Conflict(format!(
                "Cannot release result from {:?} state.",
                draft.release_status
            )));
        }
        validate_release_override_requirement(&submission, &req)?;
        let section_bands = build_section_bands(&draft.section_drafts);
        let overall_band = average_band(&section_bands);
        let now = Utc::now();
        let actor_id_str = ctx.actor_id.to_string();
        let writing_tasks = sqlx::query_as::<_, WritingTaskSubmission>(
            "SELECT * FROM writing_task_submissions WHERE submission_id = ? ORDER BY task_id ASC",
        )
        .bind(&submission_id_db)
        .fetch_all(&self.pool)
        .await?;

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
                    writing_results = ?,
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
            .bind(build_writing_results(&draft, &writing_tasks))
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
                VALUES (?, ?, ?, ?, 'released', NOW(), ?, ?, ?, ?, ?, 1, NOW(), NOW())
                "#,
            )
            .bind(result_id)
            .bind(&submission_id_db)
            .bind(submission.student_id)
            .bind(submission.student_name)
            .bind(&actor_id_str)
            .bind(overall_band)
            .bind(&section_bands)
            .bind(build_writing_results(&draft, &writing_tasks))
            .bind(draft.teacher_summary.clone())
            .execute(&self.pool)
            .await?;

            sqlx::query_as::<_, StudentResult>("SELECT * FROM student_results WHERE id = ?")
                .bind(result_id)
                .fetch_one(&self.pool)
                .await?
        };

        sqlx::query(
            "UPDATE review_drafts SET release_status = 'released', has_unsaved_changes = false, updated_at = NOW(), revision = revision + 1 WHERE submission_id = ?",
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
            VALUES (?, ?, ?, ?, 'released', ?, NOW(6))
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
        let submission_id_db = submission_id.to_string();

        let submission_sql = student_submission_query("WHERE s.id = ?");
        let submission = sqlx::query_as::<_, StudentSubmission>(&submission_sql)
            .bind(&submission_id_db)
            .fetch_optional(&self.pool)
            .await?
            .ok_or(GradingError::NotFound)?;

        // Get the schedule to get organization_id
        let schedule =
            sqlx::query_as::<_, ExamSchedule>("SELECT * FROM exam_schedules WHERE id = ?")
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
        if draft.release_status != ReleaseStatus::ReadyToRelease {
            return Err(GradingError::Conflict(format!(
                "Cannot schedule release from {:?} state.",
                draft.release_status
            )));
        }
        let section_bands = build_section_bands(&draft.section_drafts);
        let overall_band = average_band(&section_bands);
        let now = Utc::now();
        let actor_id_str = ctx.actor_id.to_string();
        let writing_tasks = sqlx::query_as::<_, WritingTaskSubmission>(
            "SELECT * FROM writing_task_submissions WHERE submission_id = ? ORDER BY task_id ASC",
        )
        .bind(&submission_id_db)
        .fetch_all(&self.pool)
        .await?;

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
                    writing_results = ?,
                    teacher_summary = ?,
                    updated_at = NOW()
                WHERE id = ?
                "#,
            )
            .bind(req.release_at)
            .bind(overall_band)
            .bind(&section_bands)
            .bind(build_writing_results(&draft, &writing_tasks))
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
                VALUES (?, ?, ?, ?, 'ready_to_release', ?, ?, ?, ?, ?, 1, NOW(), NOW())
                "#,
            )
            .bind(result_id)
            .bind(&submission_id_db)
            .bind(submission.student_id)
            .bind(submission.student_name)
            .bind(req.release_at)
            .bind(overall_band)
            .bind(&section_bands)
            .bind(build_writing_results(&draft, &writing_tasks))
            .bind(draft.teacher_summary.clone())
            .execute(&self.pool)
            .await?;
        }

        sqlx::query(
            "UPDATE review_drafts SET release_status = 'ready_to_release', has_unsaved_changes = false, updated_at = NOW(), revision = revision + 1 WHERE submission_id = ?",
        )
        .bind(&submission_id_db)
        .execute(&self.pool)
        .await?;
        let updated_draft =
            sqlx::query_as::<_, ReviewDraft>("SELECT * FROM review_drafts WHERE submission_id = ?")
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
                VALUES (?, ?, ?, ?, 'scheduled', ?, NOW(6))
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

    pub async fn list_results(
        &self,
        ctx: &ActorContext,
    ) -> Result<Vec<StudentResult>, GradingError> {
        self.maybe_sync_on_read().await?;

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
            "SELECT * FROM student_results WHERE 1=0 ORDER BY updated_at DESC, created_at DESC"
            // No access
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
            .bind(result_id.to_string())
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
        .bind(result_id.to_string())
        .fetch_all(&self.pool)
        .await
        .map_err(GradingError::from)
    }

    pub async fn analytics(&self) -> Result<ResultsAnalytics, GradingError> {
        self.maybe_sync_on_read().await?;

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
        let submission_id_db = submission_id.to_string();
        let actor_id_str = ctx.actor_id.to_string();
        let current_draft = self.get_review_draft(submission_id).await?;
        Self::ensure_valid_release_transition(&current_draft.release_status, &release_status)?;
        sqlx::query(
            r#"
            UPDATE review_drafts
            SET release_status = ?, has_unsaved_changes = false, updated_at = NOW(), revision = revision + 1
            WHERE submission_id = ?
            "#,
        )
        .bind(release_status)
        .bind(&submission_id_db)
        .execute(&self.pool)
        .await?;
        let draft =
            sqlx::query_as::<_, ReviewDraft>("SELECT * FROM review_drafts WHERE submission_id = ?")
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

    fn ensure_valid_release_transition(
        current: &ReleaseStatus,
        next: &ReleaseStatus,
    ) -> Result<(), GradingError> {
        let allowed = matches!(
            (current, next),
            (ReleaseStatus::Draft, ReleaseStatus::GradingComplete)
                | (ReleaseStatus::Reopened, ReleaseStatus::GradingComplete)
                | (
                    ReleaseStatus::GradingComplete,
                    ReleaseStatus::ReadyToRelease
                )
                | (ReleaseStatus::ReadyToRelease, ReleaseStatus::Reopened)
                | (ReleaseStatus::Released, ReleaseStatus::Reopened)
        );

        if allowed {
            Ok(())
        } else {
            Err(GradingError::Conflict(format!(
                "Invalid release transition from {:?} to {:?}.",
                current, next
            )))
        }
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

    pub async fn run_projection_cycle(
        &self,
        request: GradingProjectionRequest,
    ) -> Result<GradingProjectionReport, GradingError> {
        let cycle_batch_size = request.batch_size.unwrap_or(500).max(1);
        let schedule_sync = self
            .sync_sessions_from_schedules(request.watermark, cycle_batch_size)
            .await?;
        let submission_sync = self
            .sync_submissions_from_attempts(
                request.watermark,
                request.bootstrap_after,
                cycle_batch_size,
            )
            .await?;
        let mut affected_schedule_ids = schedule_sync.affected_schedule_ids;
        affected_schedule_ids.extend(submission_sync.affected_schedule_ids.clone());

        if !affected_schedule_ids.is_empty() {
            self.refresh_session_counters_for_schedules(&affected_schedule_ids)
                .await?;
        }

        let next_watermark = [
            request.watermark,
            schedule_sync.max_updated_at,
            submission_sync.max_updated_at,
        ]
        .into_iter()
        .flatten()
        .max();

        Ok(GradingProjectionReport {
            schedule_rows_synced: schedule_sync.rows_synced,
            submission_rows_synced: submission_sync.submission_rows_synced,
            section_rows_synced: submission_sync.section_rows_synced,
            writing_task_rows_synced: submission_sync.writing_task_rows_synced,
            affected_schedule_ids,
            next_watermark,
        })
    }

    pub async fn backfill_objective_auto_grading(
        &self,
        request: ObjectiveAutoGradingBackfillRequest,
    ) -> Result<ObjectiveAutoGradingBackfillReport, GradingError> {
        let mut builder = QueryBuilder::<MySql>::new(
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
                a.final_submission,
                v.content_snapshot,
                v.config_snapshot,
                a.updated_at
            FROM student_attempts a
            JOIN exam_schedules s ON s.id = a.schedule_id
            JOIN exam_versions v ON v.id = a.published_version_id
            WHERE a.submitted_at IS NOT NULL
            "#,
        );

        if let Some(schedule_id) = request.schedule_id.as_deref() {
            builder.push(" AND a.schedule_id = ").push_bind(schedule_id);
        }
        if let Some(exam_id) = request.exam_id.as_deref() {
            builder.push(" AND a.exam_id = ").push_bind(exam_id);
        }
        if let Some(published_version_id) = request.published_version_id.as_deref() {
            builder
                .push(" AND a.published_version_id = ")
                .push_bind(published_version_id);
        }
        if let Some(attempt_id) = request.attempt_id.as_deref() {
            builder.push(" AND a.id = ").push_bind(attempt_id);
        }

        builder.push(" ORDER BY a.updated_at ASC, a.id ASC");
        if let Some(limit) = request.limit.map(|value| value.max(1)) {
            let limit_i64 = i64::try_from(limit).unwrap_or(i64::MAX);
            builder.push(" LIMIT ").push_bind(limit_i64);
        }

        let attempts: Vec<AttemptSubmissionRow> =
            builder.build_query_as().fetch_all(&self.pool).await?;
        let mut report = ObjectiveAutoGradingBackfillReport::default();
        report.attempts_scanned = attempts.len() as u64;
        let mut override_cache: HashMap<String, HashMap<String, ObjectiveOverridePayload>> =
            HashMap::new();

        for attempt in attempts {
            let attempt_id = attempt.id.to_string();
            let submission_sql = student_submission_query("WHERE s.attempt_id = ?");
            let submission = sqlx::query_as::<_, StudentSubmission>(&submission_sql)
                .bind(&attempt_id)
                .fetch_optional(&self.pool)
                .await?;

            let Some(submission) = submission else {
                report.submissions_missing = report.submissions_missing.saturating_add(1);
                continue;
            };

            if let Some(submission_id_filter) = request.submission_id.as_deref() {
                if submission.id != submission_id_filter {
                    continue;
                }
            }

            report.submissions_matched = report.submissions_matched.saturating_add(1);

            let schedule_id_db = attempt.schedule_id.to_string();
            if !override_cache.contains_key(&schedule_id_db) {
                let overrides = self
                    .load_schedule_objective_override_lookup(&schedule_id_db)
                    .await?;
                override_cache.insert(schedule_id_db.clone(), overrides);
            }
            let overrides = override_cache
                .get(&schedule_id_db)
                .map(|map| map as &HashMap<String, ObjectiveOverridePayload>);

            let answers = attempt
                .final_submission
                .get("answers")
                .cloned()
                .unwrap_or_else(|| json!({}));
            let answer_sections = build_objective_answer_sections(&attempt.content_snapshot);
            let listening_answers =
                filter_answers_for_section(&answers, &answer_sections, "listening");
            let reading_answers = filter_answers_for_section(&answers, &answer_sections, "reading");
            let listening_auto_results = compute_objective_auto_grading_results(
                "listening",
                &listening_answers,
                &attempt.content_snapshot,
                submission.submitted_at,
                overrides,
            );
            let reading_auto_results = compute_objective_auto_grading_results(
                "reading",
                &reading_answers,
                &attempt.content_snapshot,
                submission.submitted_at,
                overrides,
            );

            let existing_sections = sqlx::query_as::<_, SectionSubmission>(
                "SELECT * FROM section_submissions WHERE submission_id = ? AND section IN ('listening', 'reading')",
            )
            .bind(&submission.id)
            .fetch_all(&self.pool)
            .await?;

            let existing_map = existing_sections
                .into_iter()
                .map(|section| {
                    (
                        section.section,
                        section.auto_grading_results.map(Into::into),
                    )
                })
                .collect::<HashMap<String, Option<Value>>>();

            let listening_needs_update = existing_map
                .get("listening")
                .and_then(|value| value.as_ref())
                .is_none_or(|value| *value != listening_auto_results);
            let reading_needs_update = existing_map
                .get("reading")
                .and_then(|value| value.as_ref())
                .is_none_or(|value| *value != reading_auto_results);

            report.sections_checked = report.sections_checked.saturating_add(2);
            if listening_needs_update {
                report.sections_needing_update = report.sections_needing_update.saturating_add(1);
            }
            if reading_needs_update {
                report.sections_needing_update = report.sections_needing_update.saturating_add(1);
            }

            if request.apply && (listening_needs_update || reading_needs_update) {
                self.ensure_objective_section_submissions(
                    &submission,
                    &attempt.final_submission,
                    &attempt.content_snapshot,
                    &attempt.config_snapshot,
                )
                .await?;
                report.submissions_updated = report.submissions_updated.saturating_add(1);
                report.sections_updated = report.sections_updated.saturating_add(
                    u64::from(listening_needs_update) + u64::from(reading_needs_update),
                );
            }
        }

        Ok(report)
    }

    pub async fn regrade_schedule_objectives_from_latest_draft(
        &self,
        ctx: &ActorContext,
        actor_name: &str,
        schedule_id: Uuid,
        reason: String,
    ) -> Result<(ObjectiveAutoGradingBackfillReport, String), GradingError> {
        let schedule_id_db = schedule_id.to_string();
        if reason.trim().is_empty() {
            return Err(GradingError::Validation(
                "Regrade reason is required.".to_owned(),
            ));
        }

        if ctx.schedule_scope_id.as_deref() != Some(&schedule_id_db)
            && !matches!(ctx.role, ActorRole::Admin | ActorRole::AdminObserver)
        {
            return Err(GradingError::Validation(
                "Missing schedule scope for regrade access.".to_owned(),
            ));
        }

        let exam_id: String = sqlx::query_scalar(
            "SELECT exam_id FROM exam_schedules WHERE id = ?",
        )
        .bind(&schedule_id_db)
        .fetch_optional(&self.pool)
        .await?
        .ok_or(GradingError::NotFound)?;

        let draft_version_id: Option<String> = sqlx::query_scalar(
            "SELECT CAST(current_draft_version_id AS CHAR) AS current_draft_version_id FROM exam_entities WHERE id = ?",
        )
        .bind(&exam_id)
        .fetch_optional(&self.pool)
        .await?;
        let Some(draft_version_id) = draft_version_id.filter(|id| !id.trim().is_empty()) else {
            return Err(GradingError::Validation(
                "No draft version found for this exam.".to_owned(),
            ));
        };

        let (draft_content_snapshot, draft_config_snapshot) = sqlx::query_as::<_, (Value, Value)>(
            "SELECT content_snapshot, config_snapshot FROM exam_versions WHERE id = ?",
        )
        .bind(&draft_version_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or(GradingError::NotFound)?;

        let actor_id = ctx.actor_id.clone();
        self.append_schedule_override_event(
            &schedule_id_db,
            &actor_id,
            actor_name,
            "objective_regrade_triggered",
            json!({
                "reason": reason,
                "source": "latest_draft",
                "examId": exam_id,
                "draftVersionId": draft_version_id.clone(),
            }),
        )
        .await?;

        // Persist the grading source so future sync-on-read projection cycles keep objective
        // sections aligned with the same draft version until an admin changes it again.
        self.upsert_schedule_objective_grading_source(
            &schedule_id_db,
            &actor_id,
            actor_name,
            "draft_version",
            Some(&draft_version_id),
        )
        .await?;

        let report = self
            .backfill_objective_auto_grading_from_snapshots(
                &schedule_id_db,
                &draft_content_snapshot,
                &draft_config_snapshot,
            )
            .await?;

        self.append_schedule_override_event(
            &schedule_id_db,
            &actor_id,
            actor_name,
            "objective_regrade_completed",
            json!({
                "source": "latest_draft",
                "draftVersionId": draft_version_id.clone(),
                "report": report,
            }),
        )
        .await?;

        Ok((report, draft_version_id))
    }

    pub async fn list_schedule_objective_overrides(
        &self,
        ctx: &ActorContext,
        schedule_id: Uuid,
    ) -> Result<Vec<GradingScheduleObjectiveOverride>, GradingError> {
        let schedule_id_db = schedule_id.to_string();
        if ctx.schedule_scope_id.as_deref() != Some(&schedule_id_db)
            && !matches!(ctx.role, ActorRole::Admin | ActorRole::AdminObserver)
        {
            return Err(GradingError::Validation(
                "Missing schedule scope for override access.".to_owned(),
            ));
        }

        let rows = sqlx::query_as::<_, GradingScheduleObjectiveOverride>(
            r#"
            SELECT
                schedule_id,
                question_id,
                override_json,
                updated_by_actor_id,
                updated_by_actor_name,
                updated_at
            FROM grading_schedule_question_overrides
            WHERE schedule_id = ?
            ORDER BY updated_at DESC, question_id ASC
            "#,
        )
        .bind(&schedule_id_db)
        .fetch_all(&self.pool)
        .await?;

        Ok(rows)
    }

    pub async fn upsert_schedule_objective_override(
        &self,
        ctx: &ActorContext,
        actor_name: &str,
        schedule_id: Uuid,
        question_id: String,
        req: ObjectiveOverrideUpsertRequest,
    ) -> Result<(GradingScheduleObjectiveOverride, ObjectiveAutoGradingBackfillReport), GradingError>
    {
        let schedule_id_db = schedule_id.to_string();
        if req.reason.trim().is_empty() {
            return Err(GradingError::Validation(
                "Override reason is required.".to_owned(),
            ));
        }
        if req.scoring_rule.trim().is_empty() {
            return Err(GradingError::Validation(
                "Override scoringRule is required.".to_owned(),
            ));
        }
        if req.max_score < 0 {
            return Err(GradingError::Validation(
                "Override maxScore must be >= 0.".to_owned(),
            ));
        }
        if ctx.schedule_scope_id.as_deref() != Some(&schedule_id_db)
            && !matches!(ctx.role, ActorRole::Admin | ActorRole::AdminObserver)
        {
            return Err(GradingError::Validation(
                "Missing schedule scope for override access.".to_owned(),
            ));
        }

        let before = sqlx::query_scalar::<_, Value>(
            r#"
            SELECT override_json
            FROM grading_schedule_question_overrides
            WHERE schedule_id = ? AND question_id = ?
            "#,
        )
        .bind(&schedule_id_db)
        .bind(&question_id)
        .fetch_optional(&self.pool)
        .await?;

        let payload = ObjectiveOverridePayload {
            correct_answer: req.correct_answer.clone(),
            accepted_answers: req.accepted_answers.clone(),
            correct_option_ids: req.correct_option_ids.clone(),
            scoring_rule: req.scoring_rule.clone(),
            max_score: req.max_score,
        };
        let override_json = serde_json::to_value(&payload).map_err(|err| {
            GradingError::Validation(format!("Invalid override payload: {err}"))
        })?;

        if payload.correct_answer.is_none()
            && payload.accepted_answers.as_ref().is_none_or(|v| v.is_empty())
            && payload.correct_option_ids.as_ref().is_none_or(|v| v.is_empty())
        {
            return Err(GradingError::Validation(
                "Override must include correctAnswer, acceptedAnswers, or correctOptionIds."
                    .to_owned(),
            ));
        }

        let actor_id = ctx.actor_id.clone();
        sqlx::query(
            r#"
            INSERT INTO grading_schedule_question_overrides (
                schedule_id,
                question_id,
                override_json,
                updated_by_actor_id,
                updated_by_actor_name,
                updated_at
            )
            VALUES (?, ?, ?, ?, ?, NOW())
            ON DUPLICATE KEY UPDATE
                override_json = VALUES(override_json),
                updated_by_actor_id = VALUES(updated_by_actor_id),
                updated_by_actor_name = VALUES(updated_by_actor_name),
                updated_at = NOW()
            "#,
        )
        .bind(&schedule_id_db)
        .bind(&question_id)
        .bind(&override_json)
        .bind(&actor_id)
        .bind(actor_name)
        .execute(&self.pool)
        .await?;

        self.append_schedule_override_event(
            &schedule_id_db,
            &actor_id,
            actor_name,
            "objective_override_upserted",
            json!({
                "questionId": question_id,
                "reason": req.reason,
                "before": before,
                "after": override_json,
            }),
        )
        .await?;

        self.append_schedule_override_event(
            &schedule_id_db,
            &actor_id,
            actor_name,
            "objective_regrade_triggered",
            json!({ "reason": "schedule objective override changed" }),
        )
        .await?;

        let report = self
            .backfill_objective_auto_grading(ObjectiveAutoGradingBackfillRequest {
                apply: true,
                schedule_id: Some(schedule_id_db.clone()),
                ..Default::default()
            })
            .await?;

        self.append_schedule_override_event(
            &schedule_id_db,
            &actor_id,
            actor_name,
            "objective_regrade_completed",
            json!({ "report": report }),
        )
        .await?;

        let row = sqlx::query_as::<_, GradingScheduleObjectiveOverride>(
            r#"
            SELECT
                schedule_id,
                question_id,
                override_json,
                updated_by_actor_id,
                updated_by_actor_name,
                updated_at
            FROM grading_schedule_question_overrides
            WHERE schedule_id = ? AND question_id = ?
            "#,
        )
        .bind(&schedule_id_db)
        .bind(&question_id)
        .fetch_one(&self.pool)
        .await?;

        Ok((row, report))
    }

    pub async fn delete_schedule_objective_override(
        &self,
        ctx: &ActorContext,
        actor_name: &str,
        schedule_id: Uuid,
        question_id: String,
        req: ObjectiveOverrideDeleteRequest,
    ) -> Result<(ObjectiveAutoGradingBackfillReport, bool), GradingError> {
        let schedule_id_db = schedule_id.to_string();
        if req.reason.trim().is_empty() {
            return Err(GradingError::Validation(
                "Override reason is required.".to_owned(),
            ));
        }
        if ctx.schedule_scope_id.as_deref() != Some(&schedule_id_db)
            && !matches!(ctx.role, ActorRole::Admin | ActorRole::AdminObserver)
        {
            return Err(GradingError::Validation(
                "Missing schedule scope for override access.".to_owned(),
            ));
        }

        let before = sqlx::query_scalar::<_, Value>(
            r#"
            SELECT override_json
            FROM grading_schedule_question_overrides
            WHERE schedule_id = ? AND question_id = ?
            "#,
        )
        .bind(&schedule_id_db)
        .bind(&question_id)
        .fetch_optional(&self.pool)
        .await?;

        let result = sqlx::query(
            r#"
            DELETE FROM grading_schedule_question_overrides
            WHERE schedule_id = ? AND question_id = ?
            "#,
        )
        .bind(&schedule_id_db)
        .bind(&question_id)
        .execute(&self.pool)
        .await?;
        let deleted = result.rows_affected() > 0;

        let actor_id = ctx.actor_id.clone();
        self.append_schedule_override_event(
            &schedule_id_db,
            &actor_id,
            actor_name,
            "objective_override_deleted",
            json!({
                "questionId": question_id,
                "reason": req.reason,
                "before": before,
                "deleted": deleted
            }),
        )
        .await?;

        self.append_schedule_override_event(
            &schedule_id_db,
            &actor_id,
            actor_name,
            "objective_regrade_triggered",
            json!({ "reason": "schedule objective override changed" }),
        )
        .await?;

        let report = self
            .backfill_objective_auto_grading(ObjectiveAutoGradingBackfillRequest {
                apply: true,
                schedule_id: Some(schedule_id_db.clone()),
                ..Default::default()
            })
            .await?;

        self.append_schedule_override_event(
            &schedule_id_db,
            &actor_id,
            actor_name,
            "objective_regrade_completed",
            json!({ "report": report }),
        )
        .await?;

        Ok((report, deleted))
    }

    async fn load_schedule_objective_override_lookup(
        &self,
        schedule_id: &str,
    ) -> Result<HashMap<String, ObjectiveOverridePayload>, GradingError> {
        let rows = sqlx::query_as::<_, (String, Value)>(
            r#"
            SELECT question_id, override_json
            FROM grading_schedule_question_overrides
            WHERE schedule_id = ?
            "#,
        )
        .bind(schedule_id)
        .fetch_all(&self.pool)
        .await?;

        let mut lookup = HashMap::<String, ObjectiveOverridePayload>::new();
        for (question_id, override_json) in rows {
            let parsed: ObjectiveOverridePayload = match serde_json::from_value(override_json) {
                Ok(value) => value,
                Err(_) => continue,
            };
            lookup.insert(question_id, parsed);
        }
        Ok(lookup)
    }

    async fn append_schedule_override_event(
        &self,
        schedule_id: &str,
        actor_id: &str,
        actor_name: &str,
        action: &str,
        payload_json: Value,
    ) -> Result<(), GradingError> {
        let event_id = Uuid::new_v4().to_string();
        sqlx::query(
            r#"
            INSERT INTO grading_schedule_override_events (
                id,
                schedule_id,
                actor_id,
                actor_name,
                action,
                payload_json,
                created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, NOW())
            "#,
        )
        .bind(&event_id)
        .bind(schedule_id)
        .bind(actor_id)
        .bind(actor_name)
        .bind(action)
        .bind(payload_json)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn upsert_schedule_objective_grading_source(
        &self,
        schedule_id: &str,
        actor_id: &str,
        actor_name: &str,
        source: &str,
        version_id: Option<&str>,
    ) -> Result<(), GradingError> {
        sqlx::query(
            r#"
            INSERT INTO grading_schedule_objective_grading_source (
                schedule_id,
                source,
                version_id,
                updated_by_actor_id,
                updated_by_actor_name,
                updated_at
            )
            VALUES (?, ?, ?, ?, ?, NOW())
            ON DUPLICATE KEY UPDATE
                source = VALUES(source),
                version_id = VALUES(version_id),
                updated_by_actor_id = VALUES(updated_by_actor_id),
                updated_by_actor_name = VALUES(updated_by_actor_name),
                updated_at = NOW()
            "#,
        )
        .bind(schedule_id)
        .bind(source)
        .bind(version_id)
        .bind(actor_id)
        .bind(actor_name)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn load_schedule_objective_grading_source_version_id(
        &self,
        schedule_id: &str,
    ) -> Result<Option<String>, GradingError> {
        let row: Option<(String, Option<String>)> = sqlx::query_as(
            r#"
            SELECT
                source,
                CAST(version_id AS CHAR) AS version_id
            FROM grading_schedule_objective_grading_source
            WHERE schedule_id = ?
            "#,
        )
        .bind(schedule_id)
        .fetch_optional(&self.pool)
        .await?;

        let Some((source, version_id)) = row else {
            return Ok(None);
        };
        if source != "draft_version" {
            return Ok(None);
        }
        Ok(version_id.filter(|id| !id.trim().is_empty()))
    }

    async fn ensure_materialized_state(&self) -> Result<(), GradingError> {
        self.run_projection_cycle(GradingProjectionRequest::default())
            .await?;
        Ok(())
    }

    async fn sync_sessions_from_schedules(
        &self,
        watermark: Option<DateTime<Utc>>,
        batch_size: i64,
    ) -> Result<ScheduleSyncReport, GradingError> {
        let schedules = if let Some(watermark) = watermark {
            sqlx::query_as::<_, ScheduleSeedRow>(
                r#"
                SELECT
                    id,
                    exam_id,
                    grading_display_name AS exam_title,
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
                WHERE updated_at >= ?
                ORDER BY updated_at ASC, id ASC
                LIMIT ?
                "#,
            )
            .bind(watermark)
            .bind(batch_size)
            .fetch_all(&self.pool)
            .await?
        } else {
            sqlx::query_as::<_, ScheduleSeedRow>(
                r#"
                SELECT
                    id,
                    exam_id,
                    grading_display_name AS exam_title,
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
                ORDER BY updated_at ASC, id ASC
                LIMIT ?
                "#,
            )
            .bind(batch_size)
            .fetch_all(&self.pool)
            .await?
        };
        let mut rows_synced: u64 = 0;
        let mut affected_schedule_ids = HashSet::new();
        let mut max_updated_at: Option<DateTime<Utc>> = None;

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
            rows_synced = rows_synced.saturating_add(1);
            max_updated_at = Some(max_updated_at.map_or(schedule.updated_at, |current| {
                current.max(schedule.updated_at)
            }));
            affected_schedule_ids.insert(schedule.id.to_string());
        }

        Ok(ScheduleSyncReport {
            rows_synced,
            affected_schedule_ids,
            max_updated_at,
        })
    }

    async fn sync_submissions_from_attempts(
        &self,
        watermark: Option<DateTime<Utc>>,
        bootstrap_after: Option<DateTime<Utc>>,
        batch_size: i64,
    ) -> Result<SubmissionSyncReport, GradingError> {
        let attempts = if let Some(watermark) = watermark {
            sqlx::query_as::<_, AttemptSubmissionRow>(
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
                    a.final_submission,
                    v.content_snapshot,
                    v.config_snapshot,
                    a.updated_at
                FROM (
                    SELECT
                        id,
                        schedule_id,
                        exam_id,
                        published_version_id,
                        candidate_id,
                        candidate_name,
                        candidate_email,
                        submitted_at,
                        final_submission,
                        updated_at
                    FROM student_attempts
                    WHERE submitted_at IS NOT NULL
                      AND updated_at >= ?
                    ORDER BY updated_at ASC, id ASC
                    LIMIT ?
                ) a
                JOIN exam_schedules s ON s.id = a.schedule_id
                JOIN exam_versions v ON v.id = a.published_version_id
                "#,
            )
            .bind(watermark)
            .bind(batch_size)
            .fetch_all(&self.pool)
            .await?
        } else if let Some(bootstrap_after) = bootstrap_after {
            sqlx::query_as::<_, AttemptSubmissionRow>(
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
                    a.final_submission,
                    v.content_snapshot,
                    v.config_snapshot,
                    a.updated_at
                FROM (
                    SELECT
                        id,
                        schedule_id,
                        exam_id,
                        published_version_id,
                        candidate_id,
                        candidate_name,
                        candidate_email,
                        submitted_at,
                        final_submission,
                        updated_at
                    FROM student_attempts
                    WHERE submitted_at IS NOT NULL
                      AND updated_at >= ?
                    ORDER BY updated_at ASC, id ASC
                    LIMIT ?
                ) a
                JOIN exam_schedules s ON s.id = a.schedule_id
                JOIN exam_versions v ON v.id = a.published_version_id
                "#,
            )
            .bind(bootstrap_after)
            .bind(batch_size)
            .fetch_all(&self.pool)
            .await?
        } else {
            sqlx::query_as::<_, AttemptSubmissionRow>(
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
                    a.final_submission,
                    v.content_snapshot,
                    v.config_snapshot,
                    a.updated_at
                FROM (
                    SELECT
                        id,
                        schedule_id,
                        exam_id,
                        published_version_id,
                        candidate_id,
                        candidate_name,
                        candidate_email,
                        submitted_at,
                        final_submission,
                        updated_at
                    FROM student_attempts
                    WHERE submitted_at IS NOT NULL
                    ORDER BY updated_at ASC, id ASC
                    LIMIT ?
                ) a
                JOIN exam_schedules s ON s.id = a.schedule_id
                JOIN exam_versions v ON v.id = a.published_version_id
                "#,
            )
            .bind(batch_size)
            .fetch_all(&self.pool)
            .await?
        };
        let mut submission_rows_synced: u64 = 0;
        let mut section_rows_synced: u64 = 0;
        let mut writing_task_rows_synced: u64 = 0;
        let mut affected_schedule_ids = HashSet::new();
        let mut max_updated_at: Option<DateTime<Utc>> = None;
        let mut objective_source_version_cache: HashMap<String, Option<String>> = HashMap::new();
        let mut objective_source_snapshot_cache: HashMap<String, (Value, Value)> = HashMap::new();

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
            let submission_id =
                existing_submission_id.unwrap_or_else(|| Uuid::new_v4().to_string());

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
            submission_rows_synced = submission_rows_synced.saturating_add(1);
            affected_schedule_ids.insert(attempt.schedule_id.to_string());
            max_updated_at = Some(max_updated_at.map_or(attempt.updated_at, |current| {
                current.max(attempt.updated_at)
            }));

            let submission_sql = student_submission_query("WHERE s.attempt_id = ?");
            let submission = sqlx::query_as::<_, StudentSubmission>(&submission_sql)
                .bind(&attempt_id)
                .fetch_one(&self.pool)
                .await?;

            let section_sync = self
                .ensure_section_submissions(
                    &submission,
                    &attempt.final_submission,
                    &attempt.content_snapshot,
                    &attempt.config_snapshot,
                )
                .await?;
            section_rows_synced =
                section_rows_synced.saturating_add(section_sync.section_rows_synced);
            writing_task_rows_synced =
                writing_task_rows_synced.saturating_add(section_sync.writing_task_rows_synced);

            // If the schedule has an objective grading source override (e.g. draft version),
            // apply objective section sync again using that source so sync-on-read projection
            // does not overwrite admin-triggered regrades.
            let schedule_id_db = attempt.schedule_id.to_string();
            let source_version_id = if let Some(cached) =
                objective_source_version_cache.get(&schedule_id_db).cloned()
            {
                cached
            } else {
                let loaded = self
                    .load_schedule_objective_grading_source_version_id(&schedule_id_db)
                    .await?;
                objective_source_version_cache.insert(schedule_id_db.clone(), loaded.clone());
                loaded
            };

            if let Some(source_version_id) = source_version_id {
                let (source_content_snapshot, source_config_snapshot) =
                    if let Some(cached) = objective_source_snapshot_cache.get(&source_version_id) {
                        (cached.0.clone(), cached.1.clone())
                    } else {
                        let loaded: (Value, Value) = sqlx::query_as(
                            "SELECT content_snapshot, config_snapshot FROM exam_versions WHERE id = ?",
                        )
                        .bind(&source_version_id)
                        .fetch_optional(&self.pool)
                        .await?
                        .ok_or(GradingError::NotFound)?;
                        objective_source_snapshot_cache
                            .insert(source_version_id.clone(), (loaded.0.clone(), loaded.1.clone()));
                        loaded
                    };

                let objective_sync = self
                    .ensure_objective_section_submissions(
                        &submission,
                        &attempt.final_submission,
                        &source_content_snapshot,
                        &source_config_snapshot,
                    )
                    .await?;
                section_rows_synced =
                    section_rows_synced.saturating_add(objective_sync.section_rows_synced);
            }
        }

        Ok(SubmissionSyncReport {
            submission_rows_synced,
            section_rows_synced,
            writing_task_rows_synced,
            affected_schedule_ids,
            max_updated_at,
        })
    }

    async fn ensure_section_submissions(
        &self,
        submission: &StudentSubmission,
        final_submission: &Value,
        content_snapshot: &Value,
        config_snapshot: &Value,
    ) -> Result<SectionSyncReport, GradingError> {
        self.ensure_section_submissions_with_mode(
            submission,
            final_submission,
            content_snapshot,
            config_snapshot,
            SectionSyncMode::Full,
        )
        .await
    }

    async fn ensure_objective_section_submissions(
        &self,
        submission: &StudentSubmission,
        final_submission: &Value,
        content_snapshot: &Value,
        config_snapshot: &Value,
    ) -> Result<SectionSyncReport, GradingError> {
        self.ensure_section_submissions_with_mode(
            submission,
            final_submission,
            content_snapshot,
            config_snapshot,
            SectionSyncMode::ObjectiveOnly,
        )
        .await
    }

    async fn ensure_section_submissions_with_mode(
        &self,
        submission: &StudentSubmission,
        final_submission: &Value,
        content_snapshot: &Value,
        config_snapshot: &Value,
        mode: SectionSyncMode,
    ) -> Result<SectionSyncReport, GradingError> {
        let answers = final_submission
            .get("answers")
            .cloned()
            .unwrap_or_else(|| json!({}));
        let writing_answers = final_submission
            .get("writingAnswers")
            .cloned()
            .unwrap_or_else(|| json!({}));
        let submitted_at = submission.submitted_at;
        let overrides = self
            .load_schedule_objective_override_lookup(&submission.schedule_id)
            .await?;
        let section_specs = build_section_sync_specs(
            mode,
            &answers,
            &writing_answers,
            content_snapshot,
            config_snapshot,
            submitted_at,
            Some(&overrides),
        );
        let mut section_rows_synced: u64 = 0;
        let mut writing_task_rows_synced: u64 = 0;

        for section_spec in section_specs {
            let existing_section_id = sqlx::query_scalar::<_, String>(
                "SELECT id FROM section_submissions WHERE submission_id = ? AND section = ?",
            )
            .bind(&submission.id)
            .bind(section_spec.section)
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
                    auto_grading_results = VALUES(auto_grading_results),
                    submitted_at = VALUES(submitted_at)
                "#,
            )
            .bind(&section_id)
            .bind(&submission.id)
            .bind(section_spec.section)
            .bind(&section_spec.payload)
            .bind(section_spec.auto_grading_results)
            .bind(section_spec.grading_status)
            .bind(submitted_at)
            .execute(&self.pool)
            .await?;
            section_rows_synced = section_rows_synced.saturating_add(1);

            if section_spec.section == "writing" {
                let tasks =
                    writing_task_entries(&writing_answers, content_snapshot, config_snapshot);
                for (task_id, value) in tasks {
                    let task_label = value
                        .get("label")
                        .and_then(Value::as_str)
                        .unwrap_or(&task_id);
                    let prompt = value.get("prompt").and_then(Value::as_str).unwrap_or("");
                    let student_text = value.get("text").and_then(Value::as_str).unwrap_or("");
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
                    writing_task_rows_synced = writing_task_rows_synced.saturating_add(1);
                }
            }
        }

        Ok(SectionSyncReport {
            section_rows_synced,
            writing_task_rows_synced,
        })
    }

    async fn refresh_session_counters_for_schedules(
        &self,
        schedule_ids: &HashSet<String>,
    ) -> Result<(), GradingError> {
        for schedule_id in schedule_ids {
            let row = sqlx::query_as::<_, SessionCounterRow>(
                r#"
                SELECT
                    CAST(? AS CHAR(36)) AS schedule_id,
                    COUNT(*) AS total_students,
                    COUNT(*) AS submitted_count,
                    COUNT(CASE WHEN grading_status IN ('submitted', 'reopened') THEN 1 END) AS pending_manual_reviews,
                    COUNT(CASE WHEN grading_status = 'in_progress' THEN 1 END) AS in_progress_reviews,
                    COUNT(CASE WHEN grading_status IN ('grading_complete', 'ready_to_release', 'released') THEN 1 END) AS finalized_reviews,
                    COUNT(CASE WHEN is_overdue THEN 1 END) AS overdue_reviews
                FROM student_submissions
                WHERE schedule_id = ?
                "#,
            )
            .bind(schedule_id)
            .bind(schedule_id)
            .fetch_one(&self.pool)
            .await?;

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
            .bind((row.total_students.max(0)).clamp(0, i32::MAX as i64) as i32)
            .bind((row.submitted_count.max(0)).clamp(0, i32::MAX as i64) as i32)
            .bind((row.pending_manual_reviews.max(0)).clamp(0, i32::MAX as i64) as i32)
            .bind((row.in_progress_reviews.max(0)).clamp(0, i32::MAX as i64) as i32)
            .bind((row.finalized_reviews.max(0)).clamp(0, i32::MAX as i64) as i32)
            .bind((row.overdue_reviews.max(0)).clamp(0, i32::MAX as i64) as i32)
            .bind(&row.schedule_id)
            .execute(&self.pool)
            .await?;
        }

        Ok(())
    }

    async fn backfill_objective_auto_grading_from_snapshots(
        &self,
        schedule_id: &str,
        content_snapshot: &Value,
        config_snapshot: &Value,
    ) -> Result<ObjectiveAutoGradingBackfillReport, GradingError> {
        let mut builder = QueryBuilder::<MySql>::new(
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
                a.final_submission,
                a.updated_at
            FROM student_attempts a
            JOIN exam_schedules s ON s.id = a.schedule_id
            WHERE a.submitted_at IS NOT NULL
              AND a.schedule_id = 
            "#,
        );
        builder.push_bind(schedule_id);

        builder.push(" ORDER BY a.updated_at ASC, a.id ASC");

        let attempts: Vec<AttemptDraftBackfillRow> =
            builder.build_query_as().fetch_all(&self.pool).await?;
        let mut report = ObjectiveAutoGradingBackfillReport::default();
        report.attempts_scanned = attempts.len() as u64;
        let mut override_cache: HashMap<String, HashMap<String, ObjectiveOverridePayload>> =
            HashMap::new();
        let answer_sections = build_objective_answer_sections(content_snapshot);

        for attempt in attempts {
            let attempt_id = attempt.id.to_string();
            let submission_sql = student_submission_query("WHERE s.attempt_id = ?");
            let submission = sqlx::query_as::<_, StudentSubmission>(&submission_sql)
                .bind(&attempt_id)
                .fetch_optional(&self.pool)
                .await?;
            let Some(submission) = submission else {
                report.submissions_missing = report.submissions_missing.saturating_add(1);
                continue;
            };

            report.submissions_matched = report.submissions_matched.saturating_add(1);

            let schedule_id_db = attempt.schedule_id.to_string();
            if !override_cache.contains_key(&schedule_id_db) {
                let overrides = self
                    .load_schedule_objective_override_lookup(&schedule_id_db)
                    .await?;
                override_cache.insert(schedule_id_db.clone(), overrides);
            }
            let overrides = override_cache
                .get(&schedule_id_db)
                .map(|map| map as &HashMap<String, ObjectiveOverridePayload>);

            let answers = attempt
                .final_submission
                .get("answers")
                .cloned()
                .unwrap_or_else(|| json!({}));
            let listening_answers =
                filter_answers_for_section(&answers, &answer_sections, "listening");
            let reading_answers = filter_answers_for_section(&answers, &answer_sections, "reading");
            let listening_auto_results = compute_objective_auto_grading_results(
                "listening",
                &listening_answers,
                content_snapshot,
                submission.submitted_at,
                overrides,
            );
            let reading_auto_results = compute_objective_auto_grading_results(
                "reading",
                &reading_answers,
                content_snapshot,
                submission.submitted_at,
                overrides,
            );

            let existing_sections = sqlx::query_as::<_, SectionSubmission>(
                "SELECT * FROM section_submissions WHERE submission_id = ? AND section IN ('listening', 'reading')",
            )
            .bind(&submission.id)
            .fetch_all(&self.pool)
            .await?;

            let existing_map = existing_sections
                .into_iter()
                .map(|section| {
                    (
                        section.section,
                        section.auto_grading_results.map(Into::into),
                    )
                })
                .collect::<HashMap<String, Option<Value>>>();

            let listening_needs_update = existing_map
                .get("listening")
                .and_then(|value| value.as_ref())
                .is_none_or(|value| *value != listening_auto_results);
            let reading_needs_update = existing_map
                .get("reading")
                .and_then(|value| value.as_ref())
                .is_none_or(|value| *value != reading_auto_results);

            report.sections_checked = report.sections_checked.saturating_add(2);
            if listening_needs_update {
                report.sections_needing_update = report.sections_needing_update.saturating_add(1);
            }
            if reading_needs_update {
                report.sections_needing_update = report.sections_needing_update.saturating_add(1);
            }

            if listening_needs_update || reading_needs_update {
                self.ensure_objective_section_submissions(
                    &submission,
                    &attempt.final_submission,
                    content_snapshot,
                    config_snapshot,
                )
                .await?;
                report.submissions_updated = report.submissions_updated.saturating_add(1);
                report.sections_updated = report.sections_updated.saturating_add(
                    u64::from(listening_needs_update) + u64::from(reading_needs_update),
                );
            }
        }

        Ok(report)
    }
}

fn student_submission_query(suffix: &str) -> String {
    format!(
        r#"
        SELECT
            s.*,
            JSON_UNQUOTE(JSON_EXTRACT(r.metadata, '$.nickname')) AS nickname,
            JSON_UNQUOTE(JSON_EXTRACT(r.metadata, '$.ieltsCourse')) AS ielts_course
        FROM student_submissions s
        LEFT JOIN schedule_registrations r
            ON r.schedule_id = s.schedule_id
            AND r.student_id = s.student_id
        {suffix}
        "#
    )
}

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
    content_snapshot: Value,
    config_snapshot: Value,
    updated_at: chrono::DateTime<Utc>,
}

#[derive(FromRow)]
struct AttemptDraftBackfillRow {
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
    updated_at: chrono::DateTime<Utc>,
}

#[derive(FromRow)]
struct SessionCounterRow {
    schedule_id: String,
    total_students: i64,
    submitted_count: i64,
    pending_manual_reviews: i64,
    in_progress_reviews: i64,
    finalized_reviews: i64,
    overdue_reviews: i64,
}

#[derive(Debug, Clone, Default)]
struct SectionSyncReport {
    section_rows_synced: u64,
    writing_task_rows_synced: u64,
}

#[derive(Debug, Clone, Default)]
struct ScheduleSyncReport {
    rows_synced: u64,
    affected_schedule_ids: HashSet<String>,
    max_updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Default)]
struct SubmissionSyncReport {
    submission_rows_synced: u64,
    section_rows_synced: u64,
    writing_task_rows_synced: u64,
    affected_schedule_ids: HashSet<String>,
    max_updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SectionSyncMode {
    Full,
    ObjectiveOnly,
}

#[derive(Debug, Clone)]
struct SectionSyncSpec {
    section: &'static str,
    payload: Value,
    auto_grading_results: Option<Value>,
    grading_status: SectionGradingStatus,
}

fn build_section_sync_specs(
    mode: SectionSyncMode,
    answers: &Value,
    writing_answers: &Value,
    content_snapshot: &Value,
    config_snapshot: &Value,
    submitted_at: DateTime<Utc>,
    overrides: Option<&HashMap<String, ObjectiveOverridePayload>>,
) -> Vec<SectionSyncSpec> {
    let answer_sections = build_objective_answer_sections(content_snapshot);
    let listening_answers = filter_answers_for_section(answers, &answer_sections, "listening");
    let reading_answers = filter_answers_for_section(answers, &answer_sections, "reading");
    let listening_auto_results = compute_objective_auto_grading_results(
        "listening",
        &listening_answers,
        content_snapshot,
        submitted_at,
        overrides,
    );
    let reading_auto_results = compute_objective_auto_grading_results(
        "reading",
        &reading_answers,
        content_snapshot,
        submitted_at,
        overrides,
    );

    let mut specs = vec![
        SectionSyncSpec {
            section: "listening",
            payload: json!({ "type": "listening", "answers": listening_answers }),
            auto_grading_results: Some(listening_auto_results),
            grading_status: SectionGradingStatus::AutoGraded,
        },
        SectionSyncSpec {
            section: "reading",
            payload: json!({ "type": "reading", "answers": reading_answers }),
            auto_grading_results: Some(reading_auto_results),
            grading_status: SectionGradingStatus::AutoGraded,
        },
    ];

    if mode == SectionSyncMode::Full {
        specs.push(SectionSyncSpec {
            section: "writing",
            payload: json!({ "type": "writing", "tasks": writing_task_array(writing_answers, content_snapshot, config_snapshot) }),
            auto_grading_results: None,
            grading_status: SectionGradingStatus::NeedsReview,
        });
        specs.push(SectionSyncSpec {
            section: "speaking",
            payload: json!({ "type": "speaking", "responses": [] }),
            auto_grading_results: None,
            grading_status: SectionGradingStatus::Pending,
        });
    }

    specs
}

fn map_schedule_status(status: ScheduleStatus) -> GradingSessionStatus {
    match status {
        ScheduleStatus::Scheduled => GradingSessionStatus::Scheduled,
        ScheduleStatus::Live => GradingSessionStatus::Live,
        ScheduleStatus::Completed => GradingSessionStatus::Completed,
        ScheduleStatus::Cancelled => GradingSessionStatus::Cancelled,
    }
}

fn writing_task_array(
    writing_answers: &Value,
    content_snapshot: &Value,
    config_snapshot: &Value,
) -> Value {
    Value::Array(
        writing_task_entries(writing_answers, content_snapshot, config_snapshot)
            .into_iter()
            .map(|(task_id, value)| {
                let text_value = value.get("text").cloned().unwrap_or_else(|| value.clone());
                json!({
                    "taskId": task_id,
                    "text": text_value,
                    "wordCount": word_count(&value)
                })
            })
            .collect(),
    )
}

#[derive(Debug, Clone)]
struct WritingTaskDescriptor {
    task_id: String,
    label: String,
    prompt: String,
}

fn writing_task_entries(
    writing_answers: &Value,
    content_snapshot: &Value,
    config_snapshot: &Value,
) -> Vec<(String, Value)> {
    build_writing_task_descriptors(writing_answers, content_snapshot, config_snapshot)
        .into_iter()
        .map(|descriptor| {
            let normalized =
                normalize_writing_task_value(&descriptor, writing_answers.get(&descriptor.task_id));
            (descriptor.task_id, normalized)
        })
        .collect()
}

fn build_writing_task_descriptors(
    writing_answers: &Value,
    content_snapshot: &Value,
    config_snapshot: &Value,
) -> Vec<WritingTaskDescriptor> {
    let mut content_labels = HashMap::new();
    let mut prompts = HashMap::new();

    if let Some(tasks) = content_snapshot
        .get("writing")
        .and_then(|writing| writing.get("tasks"))
        .and_then(Value::as_array)
    {
        for task in tasks {
            let Some(task_id) = writing_task_id(task) else {
                continue;
            };
            if let Some(label) = non_empty_string(task.get("label")) {
                content_labels.insert(task_id.clone(), label);
            }
            if let Some(prompt) = non_empty_string(task.get("prompt")) {
                prompts.insert(task_id, prompt);
            }
        }
    }

    if let Some(writing) = content_snapshot.get("writing") {
        for (task_id, prompt_key) in [("task1", "task1Prompt"), ("task2", "task2Prompt")] {
            if let Some(prompt) = non_empty_string(writing.get(prompt_key)) {
                prompts.entry(task_id.to_owned()).or_insert(prompt);
            }
        }
    }

    let mut descriptors = Vec::new();
    let mut seen = HashSet::new();

    if let Some(tasks) = config_snapshot
        .get("sections")
        .and_then(|sections| sections.get("writing"))
        .and_then(|writing| writing.get("tasks"))
        .and_then(Value::as_array)
    {
        for task in tasks {
            let Some(task_id) = writing_task_id(task) else {
                continue;
            };
            let label = non_empty_string(task.get("label"))
                .or_else(|| content_labels.get(&task_id).cloned())
                .unwrap_or_else(|| task_id.clone());
            let prompt = prompts.get(&task_id).cloned().unwrap_or_default();
            push_writing_task_descriptor(
                &mut descriptors,
                &mut seen,
                WritingTaskDescriptor {
                    task_id,
                    label,
                    prompt,
                },
            );
        }
    }

    if let Some(tasks) = content_snapshot
        .get("writing")
        .and_then(|writing| writing.get("tasks"))
        .and_then(Value::as_array)
    {
        for task in tasks {
            let Some(task_id) = writing_task_id(task) else {
                continue;
            };
            let label = content_labels
                .get(&task_id)
                .cloned()
                .unwrap_or_else(|| task_id.clone());
            let prompt = prompts.get(&task_id).cloned().unwrap_or_default();
            push_writing_task_descriptor(
                &mut descriptors,
                &mut seen,
                WritingTaskDescriptor {
                    task_id,
                    label,
                    prompt,
                },
            );
        }
    }

    if descriptors.is_empty() {
        for task_id in ["task1", "task2"] {
            if let Some(prompt) = prompts.get(task_id).cloned() {
                push_writing_task_descriptor(
                    &mut descriptors,
                    &mut seen,
                    WritingTaskDescriptor {
                        task_id: task_id.to_owned(),
                        label: content_labels
                            .get(task_id)
                            .cloned()
                            .unwrap_or_else(|| task_id.to_owned()),
                        prompt,
                    },
                );
            }
        }
    }

    if let Some(items) = writing_answers.as_object() {
        for (task_id, value) in items {
            if seen.contains(task_id) {
                continue;
            }
            let label = non_empty_string(value.get("label"))
                .or_else(|| content_labels.get(task_id).cloned())
                .unwrap_or_else(|| task_id.clone());
            let prompt = prompts
                .get(task_id)
                .cloned()
                .or_else(|| non_empty_string(value.get("prompt")))
                .unwrap_or_default();
            push_writing_task_descriptor(
                &mut descriptors,
                &mut seen,
                WritingTaskDescriptor {
                    task_id: task_id.clone(),
                    label,
                    prompt,
                },
            );
        }
    }

    descriptors
}

fn push_writing_task_descriptor(
    descriptors: &mut Vec<WritingTaskDescriptor>,
    seen: &mut HashSet<String>,
    descriptor: WritingTaskDescriptor,
) {
    if seen.insert(descriptor.task_id.clone()) {
        descriptors.push(descriptor);
    }
}

fn normalize_writing_task_value(
    descriptor: &WritingTaskDescriptor,
    value: Option<&Value>,
) -> Value {
    let mut label = descriptor.label.clone();
    let mut prompt = descriptor.prompt.clone();

    let (value_label, value_prompt, text, word_count) = match value {
        Some(Value::String(text)) => (
            None,
            None,
            text.clone(),
            text.split_whitespace().count() as i64,
        ),
        Some(Value::Object(_)) => {
            let value_label = non_empty_string(value.and_then(|item| item.get("label")));
            let value_prompt = non_empty_string(value.and_then(|item| item.get("prompt")));
            let text = value
                .and_then(|item| item.get("text"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_owned();
            let word_count = value
                .and_then(|item| item.get("wordCount"))
                .and_then(Value::as_i64)
                .unwrap_or_else(|| text.split_whitespace().count() as i64);
            (value_label, value_prompt, text, word_count)
        }
        _ => (None, None, String::new(), 0),
    };

    if label.is_empty() {
        label = value_label.unwrap_or_else(|| descriptor.task_id.clone());
    }
    if prompt.is_empty() {
        prompt = value_prompt.unwrap_or_default();
    }

    json!({
        "label": label,
        "prompt": prompt,
        "text": text,
        "wordCount": word_count
    })
}

fn writing_task_id(task: &Value) -> Option<String> {
    task.get("id")
        .or_else(|| task.get("taskId"))
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(ToOwned::to_owned)
}

fn non_empty_string(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
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

fn build_objective_answer_sections(content_snapshot: &Value) -> HashMap<String, String> {
    let mut sections = HashMap::new();

    if let Some(passages) = content_snapshot
        .get("reading")
        .and_then(|reading| reading.get("passages"))
        .and_then(Value::as_array)
    {
        for passage in passages {
            if let Some(blocks) = passage.get("blocks").and_then(Value::as_array) {
                for block in blocks {
                    index_objective_block_sections(block, "reading", &mut sections);
                }
            }
        }
    }

    if let Some(parts) = content_snapshot
        .get("listening")
        .and_then(|listening| listening.get("parts"))
        .and_then(Value::as_array)
    {
        for part in parts {
            if let Some(blocks) = part.get("blocks").and_then(Value::as_array) {
                for block in blocks {
                    index_objective_block_sections(block, "listening", &mut sections);
                }
            }
        }
    }

    sections
}

fn filter_answers_for_section(
    answers: &Value,
    answer_sections: &HashMap<String, String>,
    section_key: &str,
) -> Value {
    if answer_sections.is_empty() {
        return answers.clone();
    }

    let Some(items) = answers.as_object() else {
        return json!({});
    };

    Value::Object(
        items
            .iter()
            .filter(|(question_id, _)| {
                answer_sections
                    .get(*question_id)
                    .is_some_and(|section| section == section_key)
            })
            .map(|(question_id, value)| (question_id.clone(), value.clone()))
            .collect(),
    )
}

fn index_objective_block_sections(
    block: &Value,
    section_key: &str,
    sections: &mut HashMap<String, String>,
) {
    if register_sub_answer_tree_sections(block, section_key, sections) {
        return;
    }

    let Some(block_type) = block.get("type").and_then(Value::as_str) else {
        return;
    };
    let block_id = block.get("id").and_then(Value::as_str);

    match block_type {
        "TFNG" | "CLOZE" | "MATCHING" | "MAP" | "SHORT_ANSWER" => {
            register_question_array_sections(block, section_key, sections);
        }
        "SENTENCE_COMPLETION" | "NOTE_COMPLETION" => {
            if let Some(questions) = block.get("questions").and_then(Value::as_array) {
                for question in questions {
                    let Some(question_id) = question.get("id").and_then(Value::as_str) else {
                        continue;
                    };
                    register_answer_section(sections, question_id, section_key);
                    if let Some(blanks) = question.get("blanks").and_then(Value::as_array) {
                        for blank in blanks {
                            if let Some(blank_id) = blank.get("id").and_then(Value::as_str) {
                                register_answer_section(
                                    sections,
                                    &format!("{question_id}:{blank_id}"),
                                    section_key,
                                );
                            }
                        }
                    }
                }
            }
        }
        "MULTI_MCQ" => {
            if let Some(block_id) = block_id {
                register_answer_section(sections, block_id, section_key);
            }
        }
        "SINGLE_MCQ" => {
            if let Some(questions) = block.get("questions").and_then(Value::as_array) {
                if !questions.is_empty() {
                    register_question_array_sections(block, section_key, sections);
                    return;
                }
            }
            if let Some(block_id) = block_id {
                register_answer_section(sections, block_id, section_key);
            }
        }
        "DIAGRAM_LABELING" => {
            register_block_slot_sections(block, block_id, "labels", section_key, sections);
        }
        "FLOW_CHART" => {
            register_block_slot_sections(block, block_id, "steps", section_key, sections);
        }
        "TABLE_COMPLETION" => {
            register_block_slot_sections(block, block_id, "cells", section_key, sections);
        }
        "CLASSIFICATION" => {
            register_block_slot_sections(block, block_id, "items", section_key, sections);
        }
        "MATCHING_FEATURES" => {
            register_block_slot_sections(block, block_id, "features", section_key, sections);
        }
        _ => {}
    }
}

fn register_sub_answer_tree_sections(
    block: &Value,
    section_key: &str,
    sections: &mut HashMap<String, String>,
) -> bool {
    let enabled = block
        .get("subAnswerModeEnabled")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    if !enabled {
        return false;
    }

    let Some(block_id) = block.get("id").and_then(Value::as_str) else {
        return false;
    };
    let Some(roots) = block.get("answerTree").and_then(Value::as_array) else {
        return false;
    };
    if roots.is_empty() {
        return false;
    }

    for root in roots {
        let Some(root_id) = root.get("id").and_then(Value::as_str) else {
            continue;
        };
        let mut stack: Vec<&Value> = vec![root];
        while let Some(node) = stack.pop() {
            let children = node.get("children").and_then(Value::as_array);
            let is_leaf = children.map(|items| items.is_empty()).unwrap_or(true);
            if is_leaf {
                if let Some(node_id) = node.get("id").and_then(Value::as_str) {
                    register_answer_section(
                        sections,
                        &format!("{block_id}::tree::{root_id}::{node_id}"),
                        section_key,
                    );
                }
                continue;
            }
            if let Some(children) = children {
                for child in children {
                    stack.push(child);
                }
            }
        }
    }

    true
}

fn register_question_array_sections(
    block: &Value,
    section_key: &str,
    sections: &mut HashMap<String, String>,
) {
    if let Some(questions) = block.get("questions").and_then(Value::as_array) {
        for question in questions {
            if let Some(question_id) = question.get("id").and_then(Value::as_str) {
                register_answer_section(sections, question_id, section_key);
            }
        }
    }
}

fn register_block_slot_sections(
    block: &Value,
    block_id: Option<&str>,
    slot_key: &str,
    section_key: &str,
    sections: &mut HashMap<String, String>,
) {
    let Some(block_id) = block_id else {
        return;
    };
    register_answer_section(sections, block_id, section_key);
    if let Some(slots) = block.get(slot_key).and_then(Value::as_array) {
        for slot in slots {
            if let Some(slot_id) = slot.get("id").and_then(Value::as_str) {
                register_answer_section(sections, &format!("{block_id}:{slot_id}"), section_key);
            }
        }
    }
}

fn register_answer_section(
    sections: &mut HashMap<String, String>,
    answer_key: &str,
    section_key: &str,
) {
    sections
        .entry(answer_key.to_owned())
        .or_insert_with(|| section_key.to_owned());
}

#[derive(Debug, Clone)]
struct ObjectiveAnswerSpec {
    question_id: String,
    expected: ObjectiveExpectedAnswer,
    scoring_rule: String,
    correct_answer: Value,
    max_score: i64,
    has_override: bool,
}

#[derive(Debug, Clone)]
enum ObjectiveExpectedAnswer {
    TextAnyOf(HashSet<String>),
    ExactSet(HashSet<String>),
}

impl ObjectiveExpectedAnswer {
    fn matches(&self, value: &Value, scoring_rule: &str) -> bool {
        let _ = scoring_rule;
        match self {
            Self::TextAnyOf(expected) => {
                let values = strict_text_values(value);
                let Some(answer) = values.first() else {
                    return false;
                };
                expected.contains(answer.trim())
            }
            Self::ExactSet(expected) => strict_text_set(value) == *expected,
        }
    }
}

fn compute_objective_auto_grading_results(
    section_key: &str,
    section_answers: &Value,
    content_snapshot: &Value,
    submitted_at: DateTime<Utc>,
    overrides: Option<&HashMap<String, ObjectiveOverridePayload>>,
) -> Value {
    let answer_map =
        build_effective_objective_answer_map(section_key, section_answers, content_snapshot);
    let specs = build_objective_scoring_specs(content_snapshot, section_key, overrides);
    let mut total_score = 0i64;
    let mut max_score = 0i64;
    let mut question_results = Vec::with_capacity(specs.len());

    for spec in specs {
        let question_max = spec.max_score.max(0);
        max_score += question_max;
        let student_answer = answer_map
            .get(&spec.question_id)
            .cloned()
            .unwrap_or(Value::Null);
        let is_correct = spec
            .expected
            .matches(&student_answer, &spec.scoring_rule);
        if is_correct {
            total_score += question_max;
        }

        question_results.push(json!({
            "questionId": spec.question_id,
            "studentAnswer": value_to_display_text(&student_answer),
            "correctAnswer": value_to_display_text(&spec.correct_answer),
            "isCorrect": is_correct,
            "awardedScore": if is_correct { question_max } else { 0 },
            "maxScore": question_max,
            "scoringRule": spec.scoring_rule,
            "hasOverride": spec.has_override
        }));
    }

    let percentage = if max_score > 0 {
        (total_score as f64 / max_score as f64) * 100.0
    } else {
        0.0
    };

    json!({
        "generatedAt": submitted_at,
        "totalScore": total_score,
        "maxScore": max_score,
        "percentage": percentage,
        "questionResults": question_results
    })
}

fn build_effective_objective_answer_map(
    section_key: &str,
    section_answers: &Value,
    content_snapshot: &Value,
) -> Map<String, Value> {
    let base_answers = section_answers.as_object().cloned().unwrap_or_default();
    let mut expanded = base_answers.clone();

    let mut index_slots_for_blocks = |blocks: &[Value]| {
        for block in blocks {
            index_block_slot_answer_aliases(block, &base_answers, &mut expanded);
        }
    };

    match section_key {
        "reading" => {
            if let Some(passages) = content_snapshot
                .get("reading")
                .and_then(|reading| reading.get("passages"))
                .and_then(Value::as_array)
            {
                for passage in passages {
                    if let Some(blocks) = passage.get("blocks").and_then(Value::as_array) {
                        index_slots_for_blocks(blocks);
                    }
                }
            }
        }
        "listening" => {
            if let Some(parts) = content_snapshot
                .get("listening")
                .and_then(|listening| listening.get("parts"))
                .and_then(Value::as_array)
            {
                for part in parts {
                    if let Some(blocks) = part.get("blocks").and_then(Value::as_array) {
                        index_slots_for_blocks(blocks);
                    }
                }
            }
        }
        _ => {}
    }

    expanded
}

fn index_block_slot_answer_aliases(
    block: &Value,
    base_answers: &Map<String, Value>,
    expanded: &mut Map<String, Value>,
) {
    let Some(block_type) = block.get("type").and_then(Value::as_str) else {
        return;
    };

    match block_type {
        "SENTENCE_COMPLETION" | "NOTE_COMPLETION" => {
            if let Some(questions) = block.get("questions").and_then(Value::as_array) {
                for question in questions {
                    let Some(question_id) = question.get("id").and_then(Value::as_str) else {
                        continue;
                    };
                    if let Some(blanks) = question.get("blanks").and_then(Value::as_array) {
                        for (blank_index, blank) in blanks.iter().enumerate() {
                            let Some(blank_id) = blank.get("id").and_then(Value::as_str) else {
                                continue;
                            };
                            copy_array_slot_alias(
                                base_answers,
                                expanded,
                                question_id,
                                blank_index,
                                &format!("{question_id}:{blank_id}"),
                            );
                        }
                    }
                }
            }
        }
        "DIAGRAM_LABELING" => {
            let Some(block_id) = block.get("id").and_then(Value::as_str) else {
                return;
            };
            if let Some(labels) = block.get("labels").and_then(Value::as_array) {
                for (label_index, label) in labels.iter().enumerate() {
                    let Some(label_id) = label.get("id").and_then(Value::as_str) else {
                        continue;
                    };
                    copy_array_slot_alias(
                        base_answers,
                        expanded,
                        block_id,
                        label_index,
                        &format!("{block_id}:{label_id}"),
                    );
                }
            }
        }
        "FLOW_CHART" => {
            let Some(block_id) = block.get("id").and_then(Value::as_str) else {
                return;
            };
            if let Some(steps) = block.get("steps").and_then(Value::as_array) {
                for (step_index, step) in steps.iter().enumerate() {
                    let Some(step_id) = step.get("id").and_then(Value::as_str) else {
                        continue;
                    };
                    copy_array_slot_alias(
                        base_answers,
                        expanded,
                        block_id,
                        step_index,
                        &format!("{block_id}:{step_id}"),
                    );
                }
            }
        }
        "TABLE_COMPLETION" => {
            let Some(block_id) = block.get("id").and_then(Value::as_str) else {
                return;
            };
            if let Some(cells) = block.get("cells").and_then(Value::as_array) {
                for (cell_index, cell) in cells.iter().enumerate() {
                    let Some(cell_id) = cell.get("id").and_then(Value::as_str) else {
                        continue;
                    };
                    copy_array_slot_alias(
                        base_answers,
                        expanded,
                        block_id,
                        cell_index,
                        &format!("{block_id}:{cell_id}"),
                    );
                }
            }
        }
        "CLASSIFICATION" => {
            let Some(block_id) = block.get("id").and_then(Value::as_str) else {
                return;
            };
            if let Some(items) = block.get("items").and_then(Value::as_array) {
                for (item_index, item) in items.iter().enumerate() {
                    let Some(item_id) = item.get("id").and_then(Value::as_str) else {
                        continue;
                    };
                    copy_array_slot_alias(
                        base_answers,
                        expanded,
                        block_id,
                        item_index,
                        &format!("{block_id}:{item_id}"),
                    );
                }
            }
        }
        "MATCHING_FEATURES" => {
            let Some(block_id) = block.get("id").and_then(Value::as_str) else {
                return;
            };
            if let Some(features) = block.get("features").and_then(Value::as_array) {
                for (feature_index, feature) in features.iter().enumerate() {
                    let Some(feature_id) = feature.get("id").and_then(Value::as_str) else {
                        continue;
                    };
                    copy_array_slot_alias(
                        base_answers,
                        expanded,
                        block_id,
                        feature_index,
                        &format!("{block_id}:{feature_id}"),
                    );
                }
            }
        }
        _ => {}
    }
}

fn copy_array_slot_alias(
    base_answers: &Map<String, Value>,
    expanded: &mut Map<String, Value>,
    array_question_id: &str,
    slot_index: usize,
    slot_question_id: &str,
) {
    if expanded.contains_key(slot_question_id) {
        return;
    }

    let Some(values) = base_answers
        .get(array_question_id)
        .and_then(Value::as_array)
    else {
        return;
    };
    let Some(slot_value) = values.get(slot_index) else {
        return;
    };

    expanded.insert(slot_question_id.to_owned(), slot_value.clone());
}

fn build_objective_scoring_specs(
    content_snapshot: &Value,
    section_key: &str,
    overrides: Option<&HashMap<String, ObjectiveOverridePayload>>,
) -> Vec<ObjectiveAnswerSpec> {
    let mut specs = Vec::<ObjectiveAnswerSpec>::new();
    let mut seen = HashSet::<String>::new();

    match section_key {
        "reading" => {
            if let Some(passages) = content_snapshot
                .get("reading")
                .and_then(|reading| reading.get("passages"))
                .and_then(Value::as_array)
            {
                for passage in passages {
                    if let Some(blocks) = passage.get("blocks").and_then(Value::as_array) {
                        for block in blocks {
                            index_objective_block_scoring_specs(block, &mut specs, &mut seen);
                        }
                    }
                }
            }
        }
        "listening" => {
            if let Some(parts) = content_snapshot
                .get("listening")
                .and_then(|listening| listening.get("parts"))
                .and_then(Value::as_array)
            {
                for part in parts {
                    if let Some(blocks) = part.get("blocks").and_then(Value::as_array) {
                        for block in blocks {
                            index_objective_block_scoring_specs(block, &mut specs, &mut seen);
                        }
                    }
                }
            }
        }
        _ => {}
    }

    if let Some(overrides) = overrides {
        apply_objective_scoring_overrides(&mut specs, overrides);
    }

    specs
}

fn apply_objective_scoring_overrides(
    specs: &mut [ObjectiveAnswerSpec],
    overrides: &HashMap<String, ObjectiveOverridePayload>,
) {
    let index = specs
        .iter()
        .enumerate()
        .map(|(idx, spec)| (spec.question_id.clone(), idx))
        .collect::<HashMap<_, _>>();

    for (question_id, override_payload) in overrides {
        let Some(idx) = index.get(question_id).copied() else {
            continue;
        };
        let spec = &mut specs[idx];
        spec.scoring_rule = override_payload.scoring_rule.clone();
        spec.max_score = override_payload.max_score;
        spec.has_override = true;

        if let Some(option_ids) = override_payload
            .correct_option_ids
            .as_ref()
            .map(|values| values.iter().filter(|v| !v.is_empty()).cloned().collect::<Vec<_>>())
            .filter(|values| !values.is_empty())
        {
            if option_ids.len() > 1 {
                spec.expected =
                    ObjectiveExpectedAnswer::ExactSet(option_ids.iter().cloned().collect());
                spec.correct_answer = Value::Array(
                    option_ids
                        .into_iter()
                        .map(Value::String)
                        .collect::<Vec<_>>(),
                );
            } else {
                spec.expected =
                    ObjectiveExpectedAnswer::TextAnyOf(option_ids.iter().cloned().collect());
                spec.correct_answer = Value::String(option_ids.join(" | "));
            }
            continue;
        }

        let accepted = resolve_override_accepted_answers(
            override_payload.correct_answer.as_deref(),
            override_payload.accepted_answers.as_deref(),
        );
        if !accepted.is_empty() {
            spec.expected = ObjectiveExpectedAnswer::TextAnyOf(accepted.iter().cloned().collect());
            spec.correct_answer = Value::String(accepted.join(" | "));
        }
    }
}

fn resolve_override_accepted_answers(
    correct_answer: Option<&str>,
    accepted_answers: Option<&[String]>,
) -> Vec<String> {
    let mut seen = HashSet::<String>::new();
    let mut resolved = Vec::<String>::new();

    if let Some(values) = accepted_answers {
        for value in values.iter().map(|value| value.as_str()) {
            for variant in split_accepted_answer_variants(value) {
                let trimmed = variant.trim();
                if trimmed.is_empty() {
                    continue;
                }
                if !seen.insert(trimmed.to_owned()) {
                    continue;
                }
                resolved.push(trimmed.to_owned());
            }
        }
    }

    if resolved.is_empty() {
        if let Some(correct) = correct_answer {
            for variant in split_accepted_answer_variants(correct) {
                let trimmed = variant.trim();
                if trimmed.is_empty() {
                    continue;
                }
                if !seen.insert(trimmed.to_owned()) {
                    continue;
                }
                resolved.push(trimmed.to_owned());
            }
        }
    }

    resolved
}

fn index_objective_block_scoring_specs(
    block: &Value,
    specs: &mut Vec<ObjectiveAnswerSpec>,
    seen: &mut HashSet<String>,
) {
    if register_sub_answer_tree_scoring_specs(block, specs, seen) {
        return;
    }

    let Some(block_type) = block.get("type").and_then(Value::as_str) else {
        return;
    };
    let block_id = block.get("id").and_then(Value::as_str);
    let fallback_rule = block
        .get("answerRule")
        .and_then(Value::as_str)
        .unwrap_or("exact_match");

    match block_type {
        "TFNG" | "CLOZE" | "MATCHING" | "MAP" | "SHORT_ANSWER" => {
            if let Some(questions) = block.get("questions").and_then(Value::as_array) {
                for question in questions {
                    let Some(question_id) = question.get("id").and_then(Value::as_str) else {
                        continue;
                    };
                    let accepted = resolve_accepted_answers(
                        question.get("correctAnswer"),
                        question.get("acceptedAnswers"),
                    );
                    if accepted.is_empty() {
                        continue;
                    }
                    let scoring_rule = question
                        .get("answerRule")
                        .and_then(Value::as_str)
                        .unwrap_or(fallback_rule);
                    insert_text_answer_spec(
                        specs,
                        seen,
                        question_id,
                        accepted,
                        scoring_rule.to_owned(),
                    );
                }
            }
        }
        "SENTENCE_COMPLETION" | "NOTE_COMPLETION" => {
            if let Some(questions) = block.get("questions").and_then(Value::as_array) {
                for question in questions {
                    let Some(question_id) = question.get("id").and_then(Value::as_str) else {
                        continue;
                    };
                    let scoring_rule = question
                        .get("answerRule")
                        .and_then(Value::as_str)
                        .unwrap_or(fallback_rule)
                        .to_owned();
                    if let Some(blanks) = question.get("blanks").and_then(Value::as_array) {
                        for blank in blanks {
                            let Some(blank_id) = blank.get("id").and_then(Value::as_str) else {
                                continue;
                            };
                            let accepted = resolve_accepted_answers(
                                blank.get("correctAnswer"),
                                blank.get("acceptedAnswers"),
                            );
                            if accepted.is_empty() {
                                continue;
                            }
                            insert_text_answer_spec(
                                specs,
                                seen,
                                &format!("{question_id}:{blank_id}"),
                                accepted,
                                scoring_rule.clone(),
                            );
                        }
                    }
                }
            }
        }
        "MULTI_MCQ" => {
            let Some(block_id) = block_id else {
                return;
            };
            let expected = block
                .get("options")
                .and_then(Value::as_array)
                .map(|options| {
                    options
                        .iter()
                        .filter(|entry| {
                            entry
                                .get("isCorrect")
                                .and_then(Value::as_bool)
                                .unwrap_or(false)
                        })
                        .filter_map(|entry| entry.get("id").and_then(Value::as_str))
                        .map(ToOwned::to_owned)
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            insert_exact_set_spec(specs, seen, block_id, expected, "multi_choice".to_owned());
        }
        "SINGLE_MCQ" => {
            if let Some(questions) = block.get("questions").and_then(Value::as_array) {
                if !questions.is_empty() {
                    for question in questions {
                        let Some(question_id) = question.get("id").and_then(Value::as_str) else {
                            continue;
                        };
                        let expected =
                            question
                                .get("options")
                                .and_then(Value::as_array)
                                .and_then(|options| {
                                    options.iter().find_map(|entry| {
                                        entry
                                            .get("isCorrect")
                                            .and_then(Value::as_bool)
                                            .filter(|flag| *flag)
                                            .and_then(|_| entry.get("id"))
                                            .and_then(Value::as_str)
                                            .map(ToOwned::to_owned)
                                    })
                                });
                        if let Some(expected) = expected {
                            insert_text_answer_spec(
                                specs,
                                seen,
                                question_id,
                                vec![expected],
                                "single_choice".to_owned(),
                            );
                        }
                    }
                    return;
                }
            }
            let Some(block_id) = block_id else {
                return;
            };
            let expected = block
                .get("options")
                .and_then(Value::as_array)
                .and_then(|options| {
                    options.iter().find_map(|entry| {
                        entry
                            .get("isCorrect")
                            .and_then(Value::as_bool)
                            .filter(|flag| *flag)
                            .and_then(|_| entry.get("id"))
                            .and_then(Value::as_str)
                            .map(ToOwned::to_owned)
                    })
                });
            if let Some(expected) = expected {
                insert_text_answer_spec(
                    specs,
                    seen,
                    block_id,
                    vec![expected],
                    "single_choice".to_owned(),
                );
            }
        }
        "DIAGRAM_LABELING" => {
            register_text_slot_specs(block, block_id, "labels", "diagram_label", specs, seen);
        }
        "FLOW_CHART" => {
            register_text_slot_specs(block, block_id, "steps", "flow_chart", specs, seen);
        }
        "TABLE_COMPLETION" => {
            register_text_slot_specs(block, block_id, "cells", "table_completion", specs, seen);
        }
        "CLASSIFICATION" => {
            let Some(block_id) = block_id else {
                return;
            };
            if let Some(items) = block.get("items").and_then(Value::as_array) {
                for item in items {
                    let Some(item_id) = item.get("id").and_then(Value::as_str) else {
                        continue;
                    };
                    let accepted = resolve_accepted_answers(item.get("correctCategory"), None);
                    if accepted.is_empty() {
                        continue;
                    }
                    insert_text_answer_spec(
                        specs,
                        seen,
                        &format!("{block_id}:{item_id}"),
                        accepted,
                        "classification".to_owned(),
                    );
                }
            }
        }
        "MATCHING_FEATURES" => {
            let Some(block_id) = block_id else {
                return;
            };
            if let Some(features) = block.get("features").and_then(Value::as_array) {
                for feature in features {
                    let Some(feature_id) = feature.get("id").and_then(Value::as_str) else {
                        continue;
                    };
                    let accepted = resolve_accepted_answers(feature.get("correctMatch"), None);
                    if accepted.is_empty() {
                        continue;
                    }
                    insert_text_answer_spec(
                        specs,
                        seen,
                        &format!("{block_id}:{feature_id}"),
                        accepted,
                        "matching_features".to_owned(),
                    );
                }
            }
        }
        _ => {}
    }
}

fn register_sub_answer_tree_scoring_specs(
    block: &Value,
    specs: &mut Vec<ObjectiveAnswerSpec>,
    seen: &mut HashSet<String>,
) -> bool {
    let enabled = block
        .get("subAnswerModeEnabled")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    if !enabled {
        return false;
    }

    let Some(block_id) = block.get("id").and_then(Value::as_str) else {
        return false;
    };
    let Some(roots) = block.get("answerTree").and_then(Value::as_array) else {
        return false;
    };
    if roots.is_empty() {
        return false;
    }

    for root in roots {
        let Some(root_id) = root.get("id").and_then(Value::as_str) else {
            continue;
        };
        let mut stack: Vec<&Value> = vec![root];
        while let Some(node) = stack.pop() {
            let children = node.get("children").and_then(Value::as_array);
            let is_leaf = children.map(|entries| entries.is_empty()).unwrap_or(true);
            if is_leaf {
                let Some(node_id) = node.get("id").and_then(Value::as_str) else {
                    continue;
                };
                let accepted = resolve_accepted_answers(
                    node.get("correctAnswer"),
                    node.get("acceptedAnswers"),
                );
                if accepted.is_empty() {
                    continue;
                }
                insert_text_answer_spec(
                    specs,
                    seen,
                    &format!("{block_id}::tree::{root_id}::{node_id}"),
                    accepted,
                    "sub_answer_tree".to_owned(),
                );
                continue;
            }

            if let Some(children) = children {
                for child in children {
                    stack.push(child);
                }
            }
        }
    }

    true
}

fn register_text_slot_specs(
    block: &Value,
    block_id: Option<&str>,
    slot_key: &str,
    scoring_rule: &str,
    specs: &mut Vec<ObjectiveAnswerSpec>,
    seen: &mut HashSet<String>,
) {
    let Some(block_id) = block_id else {
        return;
    };
    if let Some(slots) = block.get(slot_key).and_then(Value::as_array) {
        for slot in slots {
            let Some(slot_id) = slot.get("id").and_then(Value::as_str) else {
                continue;
            };
            let accepted =
                resolve_accepted_answers(slot.get("correctAnswer"), slot.get("acceptedAnswers"));
            if accepted.is_empty() {
                continue;
            }
            insert_text_answer_spec(
                specs,
                seen,
                &format!("{block_id}:{slot_id}"),
                accepted,
                scoring_rule.to_owned(),
            );
        }
    }
}

fn insert_text_answer_spec(
    specs: &mut Vec<ObjectiveAnswerSpec>,
    seen: &mut HashSet<String>,
    question_id: &str,
    accepted_answers: Vec<String>,
    scoring_rule: String,
) {
    if seen.contains(question_id) {
        return;
    }
    let normalized = accepted_answers
        .iter()
        .map(|value| value.to_owned())
        .filter(|value| !value.is_empty())
        .collect::<HashSet<_>>();
    if normalized.is_empty() {
        return;
    }
    seen.insert(question_id.to_owned());

    specs.push(ObjectiveAnswerSpec {
        question_id: question_id.to_owned(),
        expected: ObjectiveExpectedAnswer::TextAnyOf(normalized),
        scoring_rule,
        correct_answer: Value::String(accepted_answers.join(" | ")),
        max_score: 1,
        has_override: false,
    });
}

fn insert_exact_set_spec(
    specs: &mut Vec<ObjectiveAnswerSpec>,
    seen: &mut HashSet<String>,
    question_id: &str,
    expected_values: Vec<String>,
    scoring_rule: String,
) {
    if seen.contains(question_id) {
        return;
    }

    let normalized = expected_values
        .iter()
        .map(|value| value.to_owned())
        .filter(|value| !value.is_empty())
        .collect::<HashSet<_>>();
    if normalized.is_empty() {
        return;
    }
    seen.insert(question_id.to_owned());

    specs.push(ObjectiveAnswerSpec {
        question_id: question_id.to_owned(),
        expected: ObjectiveExpectedAnswer::ExactSet(normalized),
        scoring_rule,
        correct_answer: Value::Array(
            expected_values
                .into_iter()
                .map(Value::String)
                .collect::<Vec<_>>(),
        ),
        max_score: 1,
        has_override: false,
    });
}

fn resolve_accepted_answers(
    correct_answer: Option<&Value>,
    accepted_answers: Option<&Value>,
) -> Vec<String> {
    let mut seen = HashSet::<String>::new();
    let mut resolved = Vec::<String>::new();

    if let Some(values) = accepted_answers.and_then(Value::as_array) {
        for value in values.iter().filter_map(Value::as_str) {
            for variant in split_accepted_answer_variants(value) {
                let trimmed = variant.trim();
                if trimmed.is_empty() {
                    continue;
                }
                if !seen.insert(trimmed.to_owned()) {
                    continue;
                }
                resolved.push(trimmed.to_owned());
            }
        }
    }

    if resolved.is_empty() {
        if let Some(correct) = correct_answer.and_then(Value::as_str) {
            for variant in split_accepted_answer_variants(correct) {
                let trimmed = variant.trim();
                if trimmed.is_empty() {
                    continue;
                }
                if !seen.insert(trimmed.to_owned()) {
                    continue;
                }
                resolved.push(trimmed.to_owned());
            }
        }
    }

    resolved
}

fn split_accepted_answer_variants(value: &str) -> Vec<&str> {
    if value.contains('|') {
        value.split('|').collect::<Vec<_>>()
    } else {
        vec![value]
    }
}

fn strict_text_values(value: &Value) -> Vec<String> {
    match value {
        Value::String(text) => {
            if text.is_empty() {
                Vec::new()
            } else {
                vec![text.clone()]
            }
        }
        Value::Array(values) => values.iter().flat_map(strict_text_values).collect(),
        _ => Vec::new(),
    }
}

fn validate_release_override_requirement(
    submission: &StudentSubmission,
    req: &ReleaseNowRequest,
) -> Result<(), GradingError> {
    let override_required = submission.is_flagged
        && submission.flag_reason.as_deref() == Some("merge_incomplete_override_required");
    if !override_required {
        return Ok(());
    }

    if req.grader_override_confirmed.unwrap_or(false) {
        return Ok(());
    }

    Err(GradingError::Conflict(
        "Explicit grader override confirmation is required before release.".to_owned(),
    ))
}

fn strict_text_set(value: &Value) -> HashSet<String> {
    strict_text_values(value)
        .into_iter()
        .filter(|entry| !entry.is_empty())
        .collect()
}

fn value_to_display_text(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::String(text) => text.clone(),
        Value::Array(values) => values
            .iter()
            .map(value_to_display_text)
            .filter(|text| !text.is_empty())
            .collect::<Vec<_>>()
            .join(", "),
        _ => value.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;
    use serde_json::json;

    fn sample_submission(is_flagged: bool, flag_reason: Option<&str>) -> StudentSubmission {
        StudentSubmission {
            id: "sub-1".to_owned(),
            attempt_id: "attempt-1".to_owned(),
            schedule_id: "sched-1".to_owned(),
            exam_id: "exam-1".to_owned(),
            published_version_id: "ver-1".to_owned(),
            student_id: "student-1".to_owned(),
            student_name: "Student".to_owned(),
            student_email: Some("student@example.com".to_owned()),
            nickname: None,
            ielts_course: None,
            cohort_name: "Cohort".to_owned(),
            submitted_at: Utc.with_ymd_and_hms(2026, 1, 1, 0, 0, 0).unwrap(),
            time_spent_seconds: 120,
            grading_status: OverallGradingStatus::ReadyToRelease,
            assigned_teacher_id: None,
            assigned_teacher_name: None,
            is_flagged,
            flag_reason: flag_reason.map(ToOwned::to_owned),
            is_overdue: false,
            due_date: None,
            section_statuses: json!({
                "listening": "auto_graded",
                "reading": "auto_graded",
                "writing": "needs_review",
                "speaking": "pending"
            })
            .into(),
            created_at: Utc.with_ymd_and_hms(2026, 1, 1, 0, 0, 0).unwrap(),
            updated_at: Utc.with_ymd_and_hms(2026, 1, 1, 0, 0, 0).unwrap(),
        }
    }

    #[test]
    fn release_requires_explicit_override_for_merge_incomplete_submissions() {
        let submission = sample_submission(true, Some("merge_incomplete_override_required"));
        let no_override = ReleaseNowRequest {
            revision_reason: None,
            grader_override_confirmed: None,
        };

        let denied = validate_release_override_requirement(&submission, &no_override);
        assert!(matches!(denied, Err(GradingError::Conflict(_))));

        let with_override = ReleaseNowRequest {
            revision_reason: Some("manual approve".to_owned()),
            grader_override_confirmed: Some(true),
        };
        assert!(validate_release_override_requirement(&submission, &with_override).is_ok());
    }

    #[test]
    fn release_override_gate_is_not_applied_for_other_submission_flags() {
        let submission = sample_submission(true, Some("manual_review_priority"));
        let req = ReleaseNowRequest {
            revision_reason: None,
            grader_override_confirmed: None,
        };

        assert!(validate_release_override_requirement(&submission, &req).is_ok());
    }

    #[test]
    fn writing_task_array_supports_string_writing_answers() {
        let writing_answers = json!({
            "task1": "Hello world"
        });

        let tasks = writing_task_array(&writing_answers, &json!({}), &json!({}));
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

        let entries = writing_task_entries(&writing_answers, &json!({}), &json!({}));
        assert_eq!(entries.len(), 1);

        let (task_id, value) = &entries[0];
        assert_eq!(task_id, "task1");
        assert_eq!(
            value.get("text").and_then(Value::as_str),
            Some("Hello world")
        );
        assert_eq!(value.get("label").and_then(Value::as_str), Some("task1"));
        assert_eq!(value.get("prompt").and_then(Value::as_str), Some(""));
        assert_eq!(value.get("wordCount").and_then(Value::as_i64), Some(2));
    }

    #[test]
    fn writing_task_entries_uses_published_prompts_for_string_answers() {
        let writing_answers = json!({
            "task1": "Hello world"
        });
        let content_snapshot = json!({
            "writing": {
                "tasks": [
                    { "taskId": "task1", "label": "Task 1", "prompt": "Summarise the chart." },
                    { "taskId": "task2", "label": "Task 2", "prompt": "Discuss both views." }
                ]
            }
        });
        let config_snapshot = json!({
            "sections": {
                "writing": {
                    "tasks": [
                        { "id": "task1", "label": "Task 1" },
                        { "id": "task2", "label": "Task 2" }
                    ]
                }
            }
        });

        let entries = writing_task_entries(&writing_answers, &content_snapshot, &config_snapshot);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].0, "task1");
        assert_eq!(
            entries[0].1.get("prompt").and_then(Value::as_str),
            Some("Summarise the chart.")
        );
        assert_eq!(
            entries[0].1.get("text").and_then(Value::as_str),
            Some("Hello world")
        );
        assert_eq!(entries[1].0, "task2");
        assert_eq!(
            entries[1].1.get("prompt").and_then(Value::as_str),
            Some("Discuss both views.")
        );
        assert_eq!(entries[1].1.get("text").and_then(Value::as_str), Some(""));
    }

    #[test]
    fn objective_text_matches_ignores_word_limit_rules() {
        let expected = ObjectiveExpectedAnswer::TextAnyOf(
            ["crowd".to_owned(), "crowd noise".to_owned()]
                .into_iter()
                .collect(),
        );
        let value = Value::String("crowd noise".to_owned());
        assert!(expected.matches(&value, "ONE_WORD"));
    }

    #[test]
    fn objective_text_matches_trims_student_answer_before_matching() {
        let expected = ObjectiveExpectedAnswer::TextAnyOf(["NOT GIVEN".to_owned()].into_iter().collect());
        let value = Value::String("NOT GIVEN   ".to_owned());
        assert!(expected.matches(&value, "ONE_WORD"));
    }

    #[test]
    fn objective_answers_are_scoped_to_their_materialized_section() {
        let answers = json!({
            "listening-q1": "A",
            "reading-q1": "B"
        });
        let content_snapshot = json!({
            "listening": {
                "parts": [{
                    "blocks": [{
                        "type": "SHORT_ANSWER",
                        "questions": [{ "id": "listening-q1" }]
                    }]
                }]
            },
            "reading": {
                "passages": [{
                    "blocks": [{
                        "type": "SHORT_ANSWER",
                        "questions": [{ "id": "reading-q1" }]
                    }]
                }]
            }
        });

        let answer_sections = build_objective_answer_sections(&content_snapshot);
        assert_eq!(
            filter_answers_for_section(&answers, &answer_sections, "listening"),
            json!({ "listening-q1": "A" })
        );
        assert_eq!(
            filter_answers_for_section(&answers, &answer_sections, "reading"),
            json!({ "reading-q1": "B" })
        );
    }

    #[test]
    fn objective_sections_include_tree_leaf_answer_ids() {
        let answers = json!({
            "tree-reading::tree::root-a::leaf-a": "cat",
            "tree-listening::tree::root-b::leaf-x": "dog"
        });
        let content_snapshot = json!({
            "listening": {
                "parts": [{
                    "blocks": [{
                        "id": "tree-listening",
                        "type": "SHORT_ANSWER",
                        "subAnswerModeEnabled": true,
                        "answerTree": [{
                            "id": "root-b",
                            "children": [{ "id": "leaf-x", "acceptedAnswers": ["dog"] }]
                        }]
                    }]
                }]
            },
            "reading": {
                "passages": [{
                    "blocks": [{
                        "id": "tree-reading",
                        "type": "SHORT_ANSWER",
                        "subAnswerModeEnabled": true,
                        "answerTree": [{
                            "id": "root-a",
                            "children": [{ "id": "leaf-a", "acceptedAnswers": ["cat"] }]
                        }]
                    }]
                }]
            }
        });

        let answer_sections = build_objective_answer_sections(&content_snapshot);
        assert_eq!(
            filter_answers_for_section(&answers, &answer_sections, "reading"),
            json!({ "tree-reading::tree::root-a::leaf-a": "cat" })
        );
        assert_eq!(
            filter_answers_for_section(&answers, &answer_sections, "listening"),
            json!({ "tree-listening::tree::root-b::leaf-x": "dog" })
        );
    }

    #[test]
    fn objective_sections_include_single_mcq_question_ids() {
        let answers = json!({
            "reading-q1": "A",
            "listening-legacy-block": "B"
        });
        let content_snapshot = json!({
            "listening": {
                "parts": [{
                    "blocks": [{
                        "id": "listening-legacy-block",
                        "type": "SINGLE_MCQ",
                        "options": [{ "id": "A" }, { "id": "B" }]
                    }]
                }]
            },
            "reading": {
                "passages": [{
                    "blocks": [{
                        "id": "reading-block-1",
                        "type": "SINGLE_MCQ",
                        "questions": [{
                            "id": "reading-q1",
                            "options": [{ "id": "A" }, { "id": "B" }]
                        }]
                    }]
                }]
            }
        });

        let answer_sections = build_objective_answer_sections(&content_snapshot);
        assert_eq!(
            filter_answers_for_section(&answers, &answer_sections, "reading"),
            json!({ "reading-q1": "A" })
        );
        assert_eq!(
            filter_answers_for_section(&answers, &answer_sections, "listening"),
            json!({ "listening-legacy-block": "B" })
        );
    }

    #[test]
    fn objective_sections_route_all_supported_block_answer_shapes() {
        let answers = json!({
            "r-tfng-q1": "T",
            "r-cloze-q1": "alpha",
            "r-matching-q1": "i",
            "r-map-q1": "A",
            "r-short-q1": "fox",
            "r-sentence-q1": ["first", "second"],
            "r-sentence-q1:b1": "first",
            "r-sentence-q1:b2": "second",
            "r-note-q1": ["note answer"],
            "r-note-q1:n1": "note answer",
            "l-multi": ["A", "C"],
            "l-single-q1": "B",
            "l-single-legacy": "Y",
            "l-diagram": ["nose", "ear"],
            "l-diagram:l1": "nose",
            "l-diagram:l2": "ear",
            "l-flow": ["step-1", "step-2"],
            "l-flow:s1": "step-1",
            "l-flow:s2": "step-2",
            "l-table": ["r1c1", "r1c2"],
            "l-table:c1": "r1c1",
            "l-table:c2": "r1c2",
            "l-classify": ["Alpha", "Beta"],
            "l-classify:i1": "Alpha",
            "l-classify:i2": "Beta",
            "l-match-features": ["X", "Y"],
            "l-match-features:f1": "X",
            "l-match-features:f2": "Y"
        });
        let content_snapshot = json!({
            "reading": {
                "passages": [{
                    "blocks": [
                        {
                            "id": "r-tfng",
                            "type": "TFNG",
                            "mode": "TFNG",
                            "questions": [{ "id": "r-tfng-q1" }]
                        },
                        {
                            "id": "r-cloze",
                            "type": "CLOZE",
                            "questions": [{ "id": "r-cloze-q1" }]
                        },
                        {
                            "id": "r-matching",
                            "type": "MATCHING",
                            "headings": [{ "id": "h1", "text": "Heading 1" }],
                            "questions": [{ "id": "r-matching-q1" }]
                        },
                        {
                            "id": "r-map",
                            "type": "MAP",
                            "questions": [{ "id": "r-map-q1" }]
                        },
                        {
                            "id": "r-short",
                            "type": "SHORT_ANSWER",
                            "questions": [{ "id": "r-short-q1" }]
                        },
                        {
                            "id": "r-sentence",
                            "type": "SENTENCE_COMPLETION",
                            "questions": [{
                                "id": "r-sentence-q1",
                                "blanks": [{ "id": "b1" }, { "id": "b2" }]
                            }]
                        },
                        {
                            "id": "r-note",
                            "type": "NOTE_COMPLETION",
                            "questions": [{
                                "id": "r-note-q1",
                                "blanks": [{ "id": "n1" }]
                            }]
                        }
                    ]
                }]
            },
            "listening": {
                "parts": [{
                    "blocks": [
                        {
                            "id": "l-multi",
                            "type": "MULTI_MCQ",
                            "requiredSelections": 2,
                            "options": [{ "id": "A" }, { "id": "B" }, { "id": "C" }]
                        },
                        {
                            "id": "l-single-question-set",
                            "type": "SINGLE_MCQ",
                            "questions": [{
                                "id": "l-single-q1",
                                "options": [{ "id": "A" }, { "id": "B" }]
                            }]
                        },
                        {
                            "id": "l-single-legacy",
                            "type": "SINGLE_MCQ",
                            "options": [{ "id": "X" }, { "id": "Y" }]
                        },
                        {
                            "id": "l-diagram",
                            "type": "DIAGRAM_LABELING",
                            "labels": [{ "id": "l1" }, { "id": "l2" }]
                        },
                        {
                            "id": "l-flow",
                            "type": "FLOW_CHART",
                            "steps": [{ "id": "s1" }, { "id": "s2" }]
                        },
                        {
                            "id": "l-table",
                            "type": "TABLE_COMPLETION",
                            "cells": [{ "id": "c1" }, { "id": "c2" }]
                        },
                        {
                            "id": "l-classify",
                            "type": "CLASSIFICATION",
                            "categories": ["Alpha", "Beta"],
                            "items": [{ "id": "i1" }, { "id": "i2" }]
                        },
                        {
                            "id": "l-match-features",
                            "type": "MATCHING_FEATURES",
                            "options": ["X", "Y"],
                            "features": [{ "id": "f1" }, { "id": "f2" }]
                        }
                    ]
                }]
            }
        });

        let answer_sections = build_objective_answer_sections(&content_snapshot);
        assert_eq!(
            filter_answers_for_section(&answers, &answer_sections, "reading"),
            json!({
                "r-tfng-q1": "T",
                "r-cloze-q1": "alpha",
                "r-matching-q1": "i",
                "r-map-q1": "A",
                "r-short-q1": "fox",
                "r-sentence-q1": ["first", "second"],
                "r-sentence-q1:b1": "first",
                "r-sentence-q1:b2": "second",
                "r-note-q1": ["note answer"],
                "r-note-q1:n1": "note answer"
            })
        );
        assert_eq!(
            filter_answers_for_section(&answers, &answer_sections, "listening"),
            json!({
                "l-multi": ["A", "C"],
                "l-single-q1": "B",
                "l-single-legacy": "Y",
                "l-diagram": ["nose", "ear"],
                "l-diagram:l1": "nose",
                "l-diagram:l2": "ear",
                "l-flow": ["step-1", "step-2"],
                "l-flow:s1": "step-1",
                "l-flow:s2": "step-2",
                "l-table": ["r1c1", "r1c2"],
                "l-table:c1": "r1c1",
                "l-table:c2": "r1c2",
                "l-classify": ["Alpha", "Beta"],
                "l-classify:i1": "Alpha",
                "l-classify:i2": "Beta",
                "l-match-features": ["X", "Y"],
                "l-match-features:f1": "X",
                "l-match-features:f2": "Y"
            })
        );
    }

    #[test]
    fn objective_auto_grading_supports_array_backed_slot_answers_and_strict_match() {
        let section_answers = json!({
            "sentence-1": ["HALF WAY"]
        });
        let content_snapshot = json!({
            "reading": {
                "passages": [{
                    "blocks": [{
                        "id": "sentence-block-1",
                        "type": "SENTENCE_COMPLETION",
                        "questions": [{
                            "id": "sentence-1",
                            "blanks": [{ "id": "blank-1", "correctAnswer": "half way" }]
                        }]
                    }]
                }]
            }
        });

        let results = compute_objective_auto_grading_results(
            "reading",
            &section_answers,
            &content_snapshot,
            Utc.with_ymd_and_hms(2026, 1, 1, 0, 0, 0).unwrap(),
            None,
        );

        assert_eq!(results["totalScore"], 0);
        assert_eq!(results["maxScore"], 1);
        assert_eq!(
            results["questionResults"][0]["questionId"],
            "sentence-1:blank-1"
        );
        assert_eq!(results["questionResults"][0]["studentAnswer"], "HALF WAY");
        assert_eq!(results["questionResults"][0]["correctAnswer"], "half way");
        assert_eq!(results["questionResults"][0]["isCorrect"], false);
    }

    #[test]
    fn objective_auto_grading_enforces_word_count_upper_bounds() {
        let content_snapshot = json!({
            "reading": {
                "passages": [{
                    "blocks": [{
                        "id": "short-block-1",
                        "type": "SHORT_ANSWER",
                        "questions": [{
                            "id": "short-1",
                            "correctAnswer": "New York",
                            "answerRule": "TWO_WORDS"
                        }]
                    }]
                }]
            }
        });

        let correct = compute_objective_auto_grading_results(
            "reading",
            &json!({ "short-1": "New York" }),
            &content_snapshot,
            Utc.with_ymd_and_hms(2026, 1, 1, 0, 0, 0).unwrap(),
            None,
        );
        assert_eq!(correct["totalScore"], 1);

        let incorrect = compute_objective_auto_grading_results(
            "reading",
            &json!({ "short-1": "New York City" }),
            &content_snapshot,
            Utc.with_ymd_and_hms(2026, 1, 1, 0, 0, 0).unwrap(),
            None,
        );
        assert_eq!(incorrect["totalScore"], 0);
    }

    #[test]
    fn objective_auto_grading_accepts_answers_under_word_limit() {
        let content_snapshot = json!({
            "listening": {
                "parts": [{
                    "blocks": [{
                        "id": "short-block-1",
                        "type": "SHORT_ANSWER",
                        "questions": [{
                            "id": "short-1",
                            "correctAnswer": "CD",
                            "answerRule": "TWO_WORDS"
                        }]
                    }]
                }]
            }
        });

        let results = compute_objective_auto_grading_results(
            "listening",
            &json!({ "short-1": "CD" }),
            &content_snapshot,
            Utc.with_ymd_and_hms(2026, 1, 1, 0, 0, 0).unwrap(),
            None,
        );

        assert_eq!(results["totalScore"], 1);
        assert_eq!(results["questionResults"][0]["isCorrect"], true);
    }

    #[test]
    fn objective_auto_grading_treats_pipe_delimited_correct_answer_as_alternatives() {
        let section_answers = json!({
            "short-1": "triangular graph"
        });
        let content_snapshot = json!({
            "reading": {
                "passages": [{
                    "blocks": [{
                        "id": "short-block-1",
                        "type": "SHORT_ANSWER",
                        "questions": [{
                            "id": "short-1",
                            "correctAnswer": "graph | triangular graph"
                        }]
                    }]
                }]
            }
        });

        let results = compute_objective_auto_grading_results(
            "reading",
            &section_answers,
            &content_snapshot,
            Utc.with_ymd_and_hms(2026, 1, 1, 0, 0, 0).unwrap(),
            None,
        );

        assert_eq!(results["totalScore"], 1);
        assert_eq!(results["maxScore"], 1);
        assert_eq!(results["questionResults"][0]["questionId"], "short-1");
        assert_eq!(results["questionResults"][0]["isCorrect"], true);
    }

    #[test]
    fn objective_only_section_sync_plan_excludes_writing_and_speaking() {
        let answers = json!({
            "l-q1": "A",
            "r-q1": "B"
        });
        let content_snapshot = json!({
            "listening": {
                "parts": [{
                    "blocks": [{
                        "type": "SHORT_ANSWER",
                        "questions": [{ "id": "l-q1", "correctAnswer": "A" }]
                    }]
                }]
            },
            "reading": {
                "passages": [{
                    "blocks": [{
                        "type": "SHORT_ANSWER",
                        "questions": [{ "id": "r-q1", "correctAnswer": "B" }]
                    }]
                }]
            }
        });

        let specs = build_section_sync_specs(
            SectionSyncMode::ObjectiveOnly,
            &answers,
            &json!({}),
            &content_snapshot,
            &json!({}),
            Utc.with_ymd_and_hms(2026, 1, 1, 0, 0, 0).unwrap(),
            None,
        );
        let sections = specs.iter().map(|spec| spec.section).collect::<Vec<_>>();

        assert_eq!(sections, vec!["listening", "reading"]);
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

fn build_writing_results(draft: &ReviewDraft, writing_tasks: &[WritingTaskSubmission]) -> Value {
    let mut results = Map::new();

    for task in writing_tasks {
        results.insert(task.task_id.clone(), build_writing_result(draft, task));
    }

    Value::Object(results)
}

fn build_writing_result(draft: &ReviewDraft, task: &WritingTaskSubmission) -> Value {
    let rubric = draft
        .section_drafts
        .get("writing")
        .and_then(Value::as_object)
        .and_then(|writing| writing.get(&task.task_id));
    let annotations = draft
        .annotations
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter(|annotation| {
                    annotation.get("taskId").and_then(Value::as_str) == Some(task.task_id.as_str())
                        && annotation.get("visibility").and_then(Value::as_str)
                            == Some("student_visible")
                })
                .cloned()
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let drawings = draft
        .drawings
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter(|drawing| {
                    drawing.get("taskId").and_then(Value::as_str) == Some(task.task_id.as_str())
                        && drawing.get("visibility").and_then(Value::as_str)
                            == Some("student_visible")
                })
                .cloned()
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    json!({
        "taskId": &task.task_id,
        "taskLabel": &task.task_label,
        "prompt": &task.prompt,
        "studentText": &task.student_text,
        "wordCount": task.word_count,
        "rubricScores": {
            "taskResponse": rubric
                .and_then(|value| value.get("taskResponseBand"))
                .and_then(Value::as_f64)
                .unwrap_or(0.0),
            "coherence": rubric
                .and_then(|value| value.get("coherenceBand"))
                .and_then(Value::as_f64)
                .unwrap_or(0.0),
            "lexical": rubric
                .and_then(|value| value.get("lexicalBand"))
                .and_then(Value::as_f64)
                .unwrap_or(0.0),
            "grammar": rubric
                .and_then(|value| value.get("grammarBand"))
                .and_then(Value::as_f64)
                .unwrap_or(0.0)
        },
        "annotations": annotations,
        "drawings": drawings,
        "criterionFeedback": {
            "taskResponse": rubric
                .and_then(|value| value.get("taskResponseNotes"))
                .and_then(Value::as_str),
            "coherence": rubric
                .and_then(|value| value.get("coherenceNotes"))
                .and_then(Value::as_str),
            "lexical": rubric
                .and_then(|value| value.get("lexicalNotes"))
                .and_then(Value::as_str),
            "grammar": rubric
                .and_then(|value| value.get("grammarNotes"))
                .and_then(Value::as_str)
        }
    })
}
