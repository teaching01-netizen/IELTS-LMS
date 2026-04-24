use chrono::Utc;
use ielts_backend_domain::exam::{
    CreateExamRequest, ExamEntity, ExamEvent, ExamEventAction, ExamStatus, ExamValidationSummary,
    ExamVersion, ExamVersionSummary, PublishExamRequest, SaveDraftRequest, UpdateExamRequest,
    ValidationIssue,
};
use ielts_backend_infrastructure::{
    actor_context::ActorContext, authorization::AuthorizationService,
};
use sqlx::{MySql, MySqlPool, QueryBuilder};
use thiserror::Error;
use uuid::Uuid;

use crate::validation::validate_exam_content;

const MAX_DRAFT_VERSIONS_PER_EXAM: usize = 3;

#[derive(Error, Debug)]
pub enum BuilderError {
    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("Conflict: {0}")]
    Conflict(String),
    #[error("Not found")]
    NotFound,
    #[error("Validation error: {0}")]
    Validation(String),
}

pub struct BuilderService {
    pool: MySqlPool,
}

impl BuilderService {
    pub fn new(pool: MySqlPool) -> Self {
        Self { pool }
    }

    async fn prune_old_draft_versions(
        tx: &mut sqlx::Transaction<'_, MySql>,
        exam_id: &str,
    ) -> Result<(), BuilderError> {
        let draft_version_ids: Vec<String> = sqlx::query_scalar(
            r#"
            SELECT id
            FROM exam_versions
            WHERE exam_id = ? AND is_draft = true
            ORDER BY created_at DESC, version_number DESC
            "#,
        )
        .bind(exam_id)
        .fetch_all(&mut **tx)
        .await?;

        if draft_version_ids.len() <= MAX_DRAFT_VERSIONS_PER_EXAM {
            return Ok(());
        }

        let ids_to_delete = &draft_version_ids[MAX_DRAFT_VERSIONS_PER_EXAM..];

        // exam_events has an FK to exam_versions without cascade, so delete events first.
        let mut delete_events =
            QueryBuilder::<MySql>::new("DELETE FROM exam_events WHERE version_id IN (");
        {
            let mut separated = delete_events.separated(", ");
            for version_id in ids_to_delete {
                separated.push_bind(version_id);
            }
        }
        delete_events.push(")");
        delete_events.build().execute(&mut **tx).await?;

        let mut delete_versions =
            QueryBuilder::<MySql>::new("DELETE FROM exam_versions WHERE id IN (");
        {
            let mut separated = delete_versions.separated(", ");
            for version_id in ids_to_delete {
                separated.push_bind(version_id);
            }
        }
        delete_versions.push(")");
        delete_versions.build().execute(&mut **tx).await?;

        Ok(())
    }

    pub async fn create_exam(
        &self,
        ctx: &ActorContext,
        req: CreateExamRequest,
    ) -> Result<ExamEntity, BuilderError> {
        let id = Uuid::new_v4().to_string();
        let now = Utc::now();

        sqlx::query(
            r#"
            INSERT INTO exam_entities (
                id, slug, title, exam_type, status, visibility,
                organization_id, owner_id, created_at, updated_at,
                schema_version, revision
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), ?, ?)
            "#,
        )
        .bind(id.to_string())
        .bind(&req.slug)
        .bind(&req.title)
        .bind(req.exam_type)
        .bind("draft")
        .bind(req.visibility)
        .bind(&req.organization_id)
        .bind(ctx.actor_id.to_string())
        .bind(1)
        .bind(0)
        .execute(&self.pool)
        .await?;

        let exam = sqlx::query_as::<_, ExamEntity>(
            "SELECT id, slug, title, exam_type, status, visibility, CAST(organization_id AS CHAR) as organization_id, CAST(owner_id AS CHAR) as owner_id, created_at, updated_at, published_at, archived_at, CAST(current_draft_version_id AS CHAR) as current_draft_version_id, CAST(current_published_version_id AS CHAR) as current_published_version_id, total_questions, total_reading_questions, total_listening_questions, schema_version, revision FROM exam_entities WHERE id = ?"
        )
            .bind(&id)
            .fetch_one(&self.pool)
            .await?;

        // Record creation event
        self.record_event(
            &exam.id,
            None,
            ctx,
            ExamEventAction::Created,
            None,
            Some("draft".to_string()),
            None,
        )
        .await?;

        Ok(exam)
    }

    pub async fn list_exams(&self, ctx: &ActorContext) -> Result<Vec<ExamEntity>, BuilderError> {
        // Admins and AdminObservers can see all exams
        // Other roles can only see exams from their organization
        let query = if matches!(
            ctx.role,
            ielts_backend_infrastructure::actor_context::ActorRole::Admin
                | ielts_backend_infrastructure::actor_context::ActorRole::AdminObserver
        ) {
            "SELECT * FROM exam_entities ORDER BY updated_at DESC, created_at DESC"
        } else if let Some(ref org_id) = ctx.organization_id {
            "SELECT * FROM exam_entities WHERE organization_id = ? ORDER BY updated_at DESC, created_at DESC"
        } else {
            "SELECT * FROM exam_entities WHERE 1=0 ORDER BY updated_at DESC, created_at DESC"
            // No access
        };

        let exams = if let Some(org_id) = ctx.organization_id.clone() {
            sqlx::query_as::<_, ExamEntity>(query)
                .bind(org_id.to_string())
                .fetch_all(&self.pool)
                .await?
        } else {
            sqlx::query_as::<_, ExamEntity>(query)
                .fetch_all(&self.pool)
                .await?
        };

        Ok(exams)
    }

    pub async fn get_exam(
        &self,
        ctx: &ActorContext,
        id: String,
    ) -> Result<ExamEntity, BuilderError> {
        let exam = sqlx::query_as::<_, ExamEntity>("SELECT * FROM exam_entities WHERE id = ?")
            .bind(&id)
            .fetch_optional(&self.pool)
            .await?
            .ok_or(BuilderError::NotFound)?;

        // Check authorization: user must have access to this exam
        if let Some(org_id_str) = &exam.organization_id {
            if let Ok(org_id) = Uuid::parse_str(org_id_str) {
                if !AuthorizationService::can_access_organization_exams(ctx, org_id.to_string()) {
                    return Err(BuilderError::NotFound);
                }
            }
        }

        Ok(exam)
    }

    pub async fn update_exam(
        &self,
        ctx: &ActorContext,
        id: String,
        req: UpdateExamRequest,
    ) -> Result<ExamEntity, BuilderError> {
        let existing = self.get_exam(ctx, id.clone()).await?;

        if existing.revision != req.revision {
            return Err(BuilderError::Conflict(
                "Exam has been modified by another user".to_string(),
            ));
        }

        let _updated_at = Utc::now();

        sqlx::query(
            r#"
            UPDATE exam_entities
            SET 
                title = COALESCE(?, title),
                status = COALESCE(?, status),
                visibility = COALESCE(?, visibility),
                organization_id = COALESCE(?, organization_id),
                updated_at = NOW(),
                revision = revision + 1
            WHERE id = ?
            "#,
        )
        .bind(&req.title)
        .bind(req.status)
        .bind(req.visibility)
        .bind(&req.organization_id)
        .bind(&id)
        .execute(&self.pool)
        .await?;

        let exam = sqlx::query_as::<_, ExamEntity>(
            "SELECT id, slug, title, exam_type, status, visibility, CAST(organization_id AS CHAR) as organization_id, CAST(owner_id AS CHAR) as owner_id, created_at, updated_at, published_at, archived_at, CAST(current_draft_version_id AS CHAR) as current_draft_version_id, CAST(current_published_version_id AS CHAR) as current_published_version_id, total_questions, total_reading_questions, total_listening_questions, schema_version, revision FROM exam_entities WHERE id = ?"
        )
            .bind(&id)
            .fetch_one(&self.pool)
            .await?;

        Ok(exam)
    }

    pub async fn save_draft(
        &self,
        ctx: &ActorContext,
        exam_id: String,
        req: SaveDraftRequest,
    ) -> Result<ExamVersion, BuilderError> {
        let mut tx = self.pool.begin().await?;

        // Verify exam exists and check revision
        let exam: ExamEntity =
            sqlx::query_as("SELECT * FROM exam_entities WHERE id = ? FOR UPDATE")
                .bind(&exam_id)
                .fetch_optional(&mut *tx)
                .await?
                .ok_or(BuilderError::NotFound)?;

        // Check authorization: user must have access to this exam
        if let Some(org_id_str) = &exam.organization_id {
            if let Ok(org_id) = Uuid::parse_str(org_id_str) {
                if !AuthorizationService::can_modify_exam_content(ctx, org_id.to_string()) {
                    return Err(BuilderError::NotFound);
                }
            }
        }

        if exam.revision != req.revision {
            return Err(BuilderError::Conflict(
                "Draft has been modified by another user".to_string(),
            ));
        }

        // Get next version number - MySQL equivalent: use subquery with MAX
        let version_number: i32 = sqlx::query_scalar(
            "SELECT COALESCE(MAX(version_number), 0) + 1 FROM exam_versions WHERE exam_id = ?",
        )
        .bind(&exam_id)
        .fetch_one(&mut *tx)
        .await?;

        // Create new draft version
        let version_id = Uuid::new_v4().to_string();

        sqlx::query(
            r#"
            INSERT INTO exam_versions (
                id, exam_id, version_number, content_snapshot, config_snapshot,
                created_by, created_at, is_draft, is_published, revision
            )
            VALUES (?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?)
            "#,
        )
        .bind(&version_id)
        .bind(&exam_id)
        .bind(version_number)
        .bind(&req.content_snapshot)
        .bind(&req.config_snapshot)
        .bind(ctx.actor_id.to_string())
        .bind(true)
        .bind(false)
        .bind(0)
        .execute(&mut *tx)
        .await?;

        let version = sqlx::query_as::<_, ExamVersion>("SELECT * FROM exam_versions WHERE id = ?")
            .bind(&version_id)
            .fetch_one(&mut *tx)
            .await?;

        // Update exam's current draft version pointer and increment revision
        sqlx::query(
            r#"
            UPDATE exam_entities
            SET
                current_draft_version_id = ?,
                updated_at = NOW(),
                revision = revision + 1
            WHERE id = ?
            "#,
        )
        .bind(&version_id)
        .bind(&exam_id)
        .execute(&mut *tx)
        .await?;

        // Record draft saved event
        sqlx::query(
            r#"
            INSERT INTO exam_events (id, exam_id, version_id, actor_id, action, created_at)
            VALUES (?, ?, ?, ?, ?, NOW())
            "#,
        )
        .bind(Uuid::new_v4().to_string())
        .bind(&exam_id)
        .bind(&version_id)
        .bind(ctx.actor_id.to_string())
        .bind(ExamEventAction::DraftSaved)
        .execute(&mut *tx)
        .await?;

        Self::prune_old_draft_versions(&mut tx, &exam_id).await?;

        tx.commit().await?;

        Ok(version)
    }

    #[tracing::instrument(
        skip(self, ctx, req),
        fields(actor_id = %ctx.actor_id, exam_id = %exam_id)
    )]
    pub async fn publish_exam(
        &self,
        ctx: &ActorContext,
        exam_id: String,
        req: PublishExamRequest,
    ) -> Result<ExamVersion, BuilderError> {
        let mut tx = self.pool.begin().await?;

        // Verify exam exists and check revision
        let exam: ExamEntity =
            sqlx::query_as("SELECT * FROM exam_entities WHERE id = ? FOR UPDATE")
                .bind(&exam_id)
                .fetch_optional(&mut *tx)
                .await?
                .ok_or(BuilderError::NotFound)?;

        // Check authorization: user must have access to this exam
        if let Some(org_id_str) = &exam.organization_id {
            if let Ok(org_id) = Uuid::parse_str(org_id_str) {
                if !AuthorizationService::can_modify_exam_content(ctx, org_id.to_string()) {
                    return Err(BuilderError::NotFound);
                }
            }
        }

        if exam.revision != req.revision {
            return Err(BuilderError::Conflict(
                "Exam has been modified by another user".to_string(),
            ));
        }

        if exam.current_draft_version_id.is_none() {
            return Err(BuilderError::Validation(
                "Cannot publish exam without a draft version".to_string(),
            ));
        }

        let draft_version_id = exam.current_draft_version_id.unwrap();

        // Update the draft version to published
        sqlx::query(
            r#"
            UPDATE exam_versions
            SET
                is_draft = false,
                is_published = true,
                publish_notes = ?,
                created_at = NOW(),
                revision = revision + 1
            WHERE id = ?
            "#,
        )
        .bind(&req.publish_notes)
        .bind(&draft_version_id)
        .execute(&mut *tx)
        .await?;

        let version = sqlx::query_as::<_, ExamVersion>("SELECT * FROM exam_versions WHERE id = ?")
            .bind(&draft_version_id)
            .fetch_one(&mut *tx)
            .await?;

        // Update exam entity
        sqlx::query(
            r#"
            UPDATE exam_entities
            SET
                current_draft_version_id = NULL,
                current_published_version_id = ?,
                status = ?,
                published_at = NOW(),
                updated_at = NOW(),
                revision = revision + 1
            WHERE id = ?
            "#,
        )
        .bind(&draft_version_id)
        .bind("published")
        .bind(&exam_id)
        .execute(&mut *tx)
        .await?;

        // Record publish event
        sqlx::query(
            r#"
            INSERT INTO exam_events (id, exam_id, version_id, actor_id, action, from_state, to_state, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
            "#,
        )
        .bind(Uuid::new_v4().to_string())
        .bind(&exam_id)
        .bind(&draft_version_id)
        .bind(ctx.actor_id.to_string())
        .bind(ExamEventAction::Published)
        .bind("draft".to_string())
        .bind("published".to_string())
        .execute(&mut *tx)
        .await?;

        tx.commit().await?;

        Ok(version)
    }

    pub async fn get_version(
        &self,
        ctx: &ActorContext,
        version_id: String,
    ) -> Result<ExamVersion, BuilderError> {
        let version = sqlx::query_as::<_, ExamVersion>("SELECT * FROM exam_versions WHERE id = ?")
            .bind(&version_id)
            .fetch_optional(&self.pool)
            .await?
            .ok_or(BuilderError::NotFound)?;

        // Check authorization: user must have access to the exam
        let exam = self.get_exam(ctx, version.exam_id.clone()).await?;
        if let Some(org_id_str) = &exam.organization_id {
            if let Ok(org_id) = Uuid::parse_str(org_id_str) {
                if !AuthorizationService::can_access_organization_exams(ctx, org_id.to_string()) {
                    return Err(BuilderError::NotFound);
                }
            }
        }

        Ok(version)
    }

    pub async fn list_versions(
        &self,
        ctx: &ActorContext,
        exam_id: String,
    ) -> Result<Vec<ExamVersion>, BuilderError> {
        // Check authorization: user must have access to the exam
        let exam = self.get_exam(ctx, exam_id.clone()).await?;

        sqlx::query_as::<_, ExamVersion>(
            "SELECT * FROM exam_versions WHERE exam_id = ? ORDER BY created_at DESC",
        )
        .bind(&exam_id)
        .fetch_all(&self.pool)
        .await
        .map_err(BuilderError::from)
    }

    pub async fn list_version_summaries(
        &self,
        ctx: &ActorContext,
        exam_id: String,
    ) -> Result<Vec<ExamVersionSummary>, BuilderError> {
        // Check authorization: user must have access to the exam
        let exam = self.get_exam(ctx, exam_id.clone()).await?;

        sqlx::query_as::<_, ExamVersionSummary>(
            r#"
            SELECT
              id,
              exam_id,
              version_number,
              parent_version_id,
              validation_snapshot,
              created_by,
              created_at,
              publish_notes,
              is_draft,
              is_published
            FROM
              exam_versions
            WHERE
              exam_id = ?
            ORDER BY
              created_at DESC
            "#,
        )
        .bind(&exam_id)
        .fetch_all(&self.pool)
        .await
        .map_err(BuilderError::from)
    }

    pub async fn list_events(
        &self,
        ctx: &ActorContext,
        exam_id: String,
    ) -> Result<Vec<ExamEvent>, BuilderError> {
        // Check authorization: user must have access to the exam
        let exam = self.get_exam(ctx, exam_id.clone()).await?;

        sqlx::query_as::<_, ExamEvent>(
            "SELECT * FROM exam_events WHERE exam_id = ? ORDER BY created_at DESC",
        )
        .bind(&exam_id)
        .fetch_all(&self.pool)
        .await
        .map_err(BuilderError::from)
    }

    pub async fn delete_exam(
        &self,
        ctx: &ActorContext,
        exam_id: String,
    ) -> Result<(), BuilderError> {
        // Check authorization: user must have access to this exam
        let exam = self.get_exam(ctx, exam_id.clone()).await?;

        let deleted = sqlx::query("DELETE FROM exam_entities WHERE id = ?")
            .bind(&exam_id)
            .execute(&self.pool)
            .await?;

        if deleted.rows_affected() == 0 {
            return Err(BuilderError::NotFound);
        }

        Ok(())
    }

    #[tracing::instrument(skip(self, ctx), fields(actor_id = %ctx.actor_id, exam_id = %exam_id))]
    pub async fn validate_exam(
        &self,
        ctx: &ActorContext,
        exam_id: String,
    ) -> Result<ExamValidationSummary, BuilderError> {
        let exam = self.get_exam(ctx, exam_id.clone()).await?;
        let mut errors = Vec::new();
        let mut warnings = Vec::new();

        // 1. Validate exam title
        if exam.title.trim().is_empty() {
            errors.push(ValidationIssue {
                field: "title".to_owned(),
                message: "Exam title is required.".to_owned(),
            });
        }

        // 2. Validate draft version exists
        let draft_version = if let Some(draft_version_id) = exam.current_draft_version_id {
            let version = self.get_version(ctx, draft_version_id).await?;

            // 3. Validate content and config snapshots
            let content = &version.content_snapshot;
            let config = &version.config_snapshot;

            // Check for empty content/config (warnings)
            if content.is_null() {
                errors.push(ValidationIssue {
                    field: "contentSnapshot".to_owned(),
                    message: "Draft content is missing. Save a draft before publishing.".to_owned(),
                });
            } else if content.as_object().is_some_and(|value| value.is_empty()) {
                warnings.push(ValidationIssue {
                    field: "contentSnapshot".to_owned(),
                    message: "Draft content is empty and should be reviewed before publishing."
                        .to_owned(),
                });
            }

            if config.is_null() {
                errors.push(ValidationIssue {
                    field: "configSnapshot".to_owned(),
                    message: "Draft configuration is missing. Save a draft before publishing."
                        .to_owned(),
                });
            } else if config.as_object().is_some_and(|value| value.is_empty()) {
                warnings.push(ValidationIssue {
                    field: "configSnapshot".to_owned(),
                    message:
                        "Draft configuration is empty and should be reviewed before publishing."
                            .to_owned(),
                });
            }

            // 4. Perform comprehensive content validation
            if !content.is_null() && !config.is_null() {
                let validation_result = validate_exam_content(content, config);

                // Add validation errors
                for error in validation_result.errors {
                    errors.push(ValidationIssue {
                        field: error.field,
                        message: error.message,
                    });
                }

                // Add validation warnings
                for warning in validation_result.warnings {
                    warnings.push(ValidationIssue {
                        field: warning.field,
                        message: warning.message,
                    });
                }
            }

            Some(version)
        } else {
            errors.push(ValidationIssue {
                field: "draftVersion".to_owned(),
                message: "Create and save a draft version before publishing.".to_owned(),
            });
            None
        };

        Ok(ExamValidationSummary {
            exam_id: exam.id,
            draft_version_id: draft_version.as_ref().map(|version| version.id.clone()),
            can_publish: errors.is_empty(),
            errors,
            warnings,
            validated_at: Utc::now(),
        })
    }

    #[allow(clippy::too_many_arguments)]
    async fn record_event(
        &self,
        exam_id: &String,
        version_id: Option<String>,
        ctx: &ActorContext,
        action: ExamEventAction,
        from_state: Option<String>,
        to_state: Option<String>,
        payload: Option<serde_json::Value>,
    ) -> Result<(), BuilderError> {
        sqlx::query(
            r#"
            INSERT INTO exam_events (id, exam_id, version_id, actor_id, action, from_state, to_state, payload, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
            "#,
        )
        .bind(Uuid::new_v4().to_string())
        .bind(exam_id)
        .bind(version_id)
        .bind(ctx.actor_id.to_string())
        .bind(action)
        .bind(&from_state)
        .bind(&to_state)
        .bind(&payload)
        .execute(&self.pool)
        .await?;

        Ok(())
    }
}
