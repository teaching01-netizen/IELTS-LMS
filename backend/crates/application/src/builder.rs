use chrono::Utc;
use ielts_backend_domain::actor_context::ActorContext;
use ielts_backend_domain::exam::{
    CreateExamRequest, ExamEntity, ExamEvent, ExamEventAction, ExamValidationSummary, ExamVersion,
    ExamVersionMetadata, ExamVersionSummary, PublishExamRequest, SaveDraftRequest,
    UpdateExamRequest, ValidationIssue,
};
use ielts_backend_infrastructure::authorization::AuthorizationService;
use serde_json::Value;
use sqlx::{MySql, MySqlPool, QueryBuilder};
use thiserror::Error;
use uuid::Uuid;

use crate::validation::validate_exam_content;

const MAX_DRAFT_VERSIONS_PER_EXAM: usize = 3;

fn compact_duplicate_legacy_writing_chart_image(content: &mut Value) {
    let canonical_image_src = content
        .pointer("/writing/tasks")
        .and_then(Value::as_array)
        .and_then(|tasks| {
            tasks
                .iter()
                .find(|task| task.get("taskId").and_then(Value::as_str) == Some("task1"))
                .or_else(|| tasks.first())
        })
        .and_then(|task| task.pointer("/chart/imageSrc"))
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);

    let Some(canonical_image_src) = canonical_image_src else {
        return;
    };

    let legacy_image_src = content
        .pointer("/writing/task1Chart/imageSrc")
        .and_then(Value::as_str);

    if legacy_image_src != Some(canonical_image_src.as_str()) {
        return;
    }

    if let Some(task1_chart) = content
        .pointer_mut("/writing/task1Chart")
        .and_then(Value::as_object_mut)
    {
        task1_chart.remove("imageSrc");
    }
}

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

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::compact_duplicate_legacy_writing_chart_image;

    #[test]
    fn compact_duplicate_legacy_writing_chart_image_removes_only_identical_legacy_image() {
        let image_src = format!("data:image/png;base64,{}", "A".repeat(1024));
        let mut content = json!({
            "writing": {
                "task1Chart": {
                    "id": "chart-1",
                    "title": "Legacy chart",
                    "imageSrc": image_src
                },
                "tasks": [{
                    "taskId": "task1",
                    "chart": {
                        "id": "chart-1",
                        "title": "Canonical chart",
                        "imageSrc": image_src
                    }
                }]
            }
        });

        compact_duplicate_legacy_writing_chart_image(&mut content);

        assert!(content["writing"]["task1Chart"].get("imageSrc").is_none());
        assert_eq!(
            content["writing"]["tasks"][0]["chart"]["imageSrc"],
            image_src
        );
        assert_eq!(content["writing"]["task1Chart"]["title"], "Legacy chart");
    }

    #[test]
    fn compact_duplicate_legacy_writing_chart_image_keeps_different_legacy_image() {
        let mut content = json!({
            "writing": {
                "task1Chart": {
                    "id": "chart-1",
                    "imageSrc": "data:image/png;base64,legacy"
                },
                "tasks": [{
                    "taskId": "task1",
                    "chart": {
                        "id": "chart-1",
                        "imageSrc": "data:image/png;base64,canonical"
                    }
                }]
            }
        });

        compact_duplicate_legacy_writing_chart_image(&mut content);

        assert_eq!(
            content["writing"]["task1Chart"]["imageSrc"],
            "data:image/png;base64,legacy"
        );
    }
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
            SELECT v.id
            FROM exam_versions v
            WHERE
                v.exam_id = ?
                AND v.is_draft = true
                AND NOT EXISTS (
                    SELECT 1
                    FROM exam_schedules s
                    WHERE s.published_version_id = v.id
                )
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

    fn collect_publish_blocking_errors(
        exam: &ExamEntity,
        draft_version: &ExamVersion,
    ) -> Vec<ValidationIssue> {
        let mut errors = Vec::new();

        if exam.title.trim().is_empty() {
            errors.push(ValidationIssue {
                field: "title".to_owned(),
                message: "Exam title is required.".to_owned(),
            });
        }

        let content = &draft_version.content_snapshot;
        let config = &draft_version.config_snapshot;

        if content.is_null() {
            errors.push(ValidationIssue {
                field: "contentSnapshot".to_owned(),
                message: "Draft content is missing. Save a draft before publishing.".to_owned(),
            });
        }

        if config.is_null() {
            errors.push(ValidationIssue {
                field: "configSnapshot".to_owned(),
                message: "Draft configuration is missing. Save a draft before publishing."
                    .to_owned(),
            });
        }

        if !content.is_null() && !config.is_null() {
            let validation_result = validate_exam_content(content, config);
            for error in validation_result.errors {
                errors.push(ValidationIssue {
                    field: error.field,
                    message: error.message,
                });
            }
        }

        errors
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
        .bind(4)
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
            ielts_backend_domain::actor_context::ActorRole::Admin
                | ielts_backend_domain::actor_context::ActorRole::AdminObserver
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

        let draft_version_id = exam.current_draft_version_id.clone().unwrap();
        let draft_version = sqlx::query_as::<_, ExamVersion>(
            "SELECT * FROM exam_versions WHERE id = ? AND exam_id = ? FOR UPDATE",
        )
        .bind(&draft_version_id)
        .bind(&exam_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| {
            BuilderError::Validation(
                "Cannot publish exam without the current draft version".to_string(),
            )
        })?;

        let blocking_errors = Self::collect_publish_blocking_errors(&exam, &draft_version);
        if !blocking_errors.is_empty() {
            let details = blocking_errors
                .iter()
                .map(|issue| format!("{}: {}", issue.field, issue.message))
                .collect::<Vec<_>>()
                .join("; ");
            return Err(BuilderError::Validation(format!(
                "Exam content is not ready for publication: {details}"
            )));
        }

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
        .bind(exam.status.to_string())
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
        let mut version = sqlx::query_as::<_, ExamVersion>(
            r#"
            SELECT
                id,
                CAST(exam_id AS CHAR) AS exam_id,
                version_number,
                CAST(parent_version_id AS CHAR) AS parent_version_id,
                content_snapshot,
                config_snapshot,
                validation_snapshot,
                CAST(created_by AS CHAR) AS created_by,
                created_at,
                publish_notes,
                is_draft,
                is_published,
                revision
            FROM exam_versions
            WHERE id = ?
            "#,
        )
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

        compact_duplicate_legacy_writing_chart_image(&mut version.content_snapshot.0);

        Ok(version)
    }

    /// Get version metadata only, without loading large content/config snapshots.
    ///
    /// This is significantly faster than `get_version` because:
    /// 1. It doesn't load the large JSON columns (content_snapshot, config_snapshot)
    /// 2. It uses OCTET_LENGTH to compute sizes without transferring the data
    /// 3. Returns metadata useful for client-side lazy-loading decisions
    pub async fn get_version_metadata(
        &self,
        ctx: &ActorContext,
        version_id: String,
    ) -> Result<ExamVersionMetadata, BuilderError> {
        let version = sqlx::query_as::<_, ExamVersionMetadata>(
            r#"
            SELECT
                id,
                CAST(exam_id AS CHAR) AS exam_id,
                version_number,
                CAST(parent_version_id AS CHAR) AS parent_version_id,
                validation_snapshot,
                CAST(created_by AS CHAR) AS created_by,
                created_at,
                publish_notes,
                is_draft,
                is_published,
                revision,
                OCTET_LENGTH(content_snapshot) AS content_size_bytes,
                OCTET_LENGTH(config_snapshot) AS config_size_bytes
            FROM exam_versions
            WHERE id = ?
            "#,
        )
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
        let _exam = self.get_exam(ctx, exam_id.clone()).await?;

        let mut tx = self.pool.begin().await?;

        // Remove schedules first so published_version_id references are gone before
        // exam_versions are cascaded by exam_entities deletion.
        sqlx::query("DELETE FROM exam_schedules WHERE exam_id = ?")
            .bind(&exam_id)
            .execute(&mut *tx)
            .await?;

        let deleted = sqlx::query("DELETE FROM exam_entities WHERE id = ?")
            .bind(&exam_id)
            .execute(&mut *tx)
            .await?;

        if deleted.rows_affected() == 0 {
            return Err(BuilderError::NotFound);
        }

        tx.commit().await?;

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
