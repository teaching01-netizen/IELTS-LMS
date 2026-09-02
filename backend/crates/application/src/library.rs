use chrono::Utc;
use ielts_backend_domain::library::{
    AdminDefaultProfile, CreateGradingExportProfileRequest, CreatePassageRequest,
    CreateQuestionRequest, Difficulty, GradingExportProfile, PassageLibraryItem, QuestionBankItem,
    UpdateExamDefaultsRequest, UpdatePassageRequest, UpdateQuestionRequest,
};
use ielts_backend_infrastructure::actor_context::{AccessScope, ActorContext};
use sqlx::{MySql, MySqlPool, QueryBuilder};
use thiserror::Error;
use uuid::Uuid;

#[derive(Error, Debug)]
pub enum LibraryError {
    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("Conflict: {0}")]
    Conflict(String),
    #[error("Not found")]
    NotFound,
    #[error("Validation error: {0}")]
    Validation(String),
}

pub struct LibraryService {
    pool: MySqlPool,
}

impl LibraryService {
    pub fn new(pool: MySqlPool) -> Self {
        Self { pool }
    }

    // Passage Library

    pub async fn create_passage(
        &self,
        ctx: &ActorContext,
        req: CreatePassageRequest,
    ) -> Result<PassageLibraryItem, LibraryError> {
        let id = Uuid::new_v4();
        let now = Utc::now();
        let organization_id = writable_organization_id(ctx)?;

        sqlx::query(
            r#"
            INSERT INTO passage_library_items (
                id, organization_id, title, passage_snapshot, difficulty, topic,
                tags, word_count, estimated_time_minutes, usage_count,
                created_by, created_at, updated_at, revision
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), ?)
            "#,
        )
        .bind(id.to_string())
        .bind(organization_id)
        .bind(&req.title)
        .bind(&req.passage_snapshot)
        .bind(req.difficulty)
        .bind(&req.topic)
        .bind(&req.tags)
        .bind(req.word_count)
        .bind(req.estimated_time_minutes)
        .bind(0)
        .bind(ctx.actor_id.to_string())
        .bind(0)
        .execute(&self.pool)
        .await?;

        let passage = sqlx::query_as::<_, PassageLibraryItem>(
            "SELECT * FROM passage_library_items WHERE id = ?",
        )
        .bind(id.to_string())
        .fetch_one(&self.pool)
        .await?;

        Ok(passage)
    }

    pub async fn get_passage(
        &self,
        ctx: &ActorContext,
        id: Uuid,
    ) -> Result<PassageLibraryItem, LibraryError> {
        let mut query =
            QueryBuilder::<MySql>::new("SELECT * FROM passage_library_items WHERE id = ");
        query.push_bind(id.to_string());
        append_read_scope(&mut query, ctx);
        query
            .build_query_as::<PassageLibraryItem>()
            .fetch_optional(&self.pool)
            .await?
            .ok_or(LibraryError::NotFound)
    }

    pub async fn update_passage(
        &self,
        ctx: &ActorContext,
        id: Uuid,
        req: UpdatePassageRequest,
    ) -> Result<PassageLibraryItem, LibraryError> {
        let existing = self.get_passage(ctx, id).await?;
        ensure_writable_resource(ctx, existing.organization_id.as_deref())?;

        if existing.revision != req.revision {
            return Err(LibraryError::Conflict(
                "Passage has been modified by another user".to_string(),
            ));
        }

        let updated_at = Utc::now();

        let result = sqlx::query(
            r#"
            UPDATE passage_library_items
            SET
                title = COALESCE(?, title),
                passage_snapshot = COALESCE(?, passage_snapshot),
                difficulty = COALESCE(?, difficulty),
                topic = COALESCE(?, topic),
                tags = COALESCE(?, tags),
                word_count = COALESCE(?, word_count),
                estimated_time_minutes = COALESCE(?, estimated_time_minutes),
                updated_at = NOW(),
                revision = revision + 1
            WHERE id = ?
              AND revision = ?
              AND (? IS NULL OR organization_id = ?)
            "#,
        )
        .bind(&req.title)
        .bind(&req.passage_snapshot)
        .bind(&req.difficulty)
        .bind(&req.topic)
        .bind(&req.tags)
        .bind(req.word_count)
        .bind(req.estimated_time_minutes)
        .bind(id.to_string())
        .bind(existing.revision)
        .bind(if ctx.is_platform_write() {
            None
        } else {
            ctx.organization_id.as_deref()
        })
        .bind(if ctx.is_platform_write() {
            None
        } else {
            ctx.organization_id.as_deref()
        })
        .execute(&self.pool)
        .await?;
        if result.rows_affected() != 1 {
            return Err(LibraryError::Conflict(
                "Passage has been modified by another user".to_owned(),
            ));
        }

        let passage = sqlx::query_as::<_, PassageLibraryItem>(
            "SELECT * FROM passage_library_items WHERE id = ?",
        )
        .bind(id.to_string())
        .fetch_one(&self.pool)
        .await?;

        Ok(passage)
    }

    pub async fn delete_passage(&self, ctx: &ActorContext, id: Uuid) -> Result<(), LibraryError> {
        let existing = self.get_passage(ctx, id).await?;
        ensure_writable_resource(ctx, existing.organization_id.as_deref())?;
        let result = sqlx::query(
            "DELETE FROM passage_library_items WHERE id = ? AND (? IS NULL OR organization_id = ?)",
        )
        .bind(id.to_string())
        .bind(if ctx.is_platform_write() {
            None
        } else {
            ctx.organization_id.as_deref()
        })
        .bind(if ctx.is_platform_write() {
            None
        } else {
            ctx.organization_id.as_deref()
        })
        .execute(&self.pool)
        .await?;

        if result.rows_affected() == 0 {
            return Err(LibraryError::NotFound);
        }

        Ok(())
    }

    pub async fn list_passages(
        &self,
        ctx: &ActorContext,
        difficulty: Option<Difficulty>,
        topic: Option<String>,
        limit: i64,
    ) -> Result<Vec<PassageLibraryItem>, LibraryError> {
        let mut query =
            QueryBuilder::<MySql>::new("SELECT * FROM passage_library_items WHERE 1 = 1");
        append_read_scope(&mut query, ctx);
        if let Some(diff) = difficulty {
            query.push(" AND difficulty = ").push_bind(diff);
        }
        if let Some(topic) = topic {
            query.push(" AND topic = ").push_bind(topic);
        }
        query
            .push(" ORDER BY updated_at DESC, id DESC LIMIT ")
            .push_bind(limit);
        query
            .build_query_as::<PassageLibraryItem>()
            .fetch_all(&self.pool)
            .await
            .map_err(LibraryError::from)
    }

    // Question Bank

    pub async fn create_question(
        &self,
        ctx: &ActorContext,
        req: CreateQuestionRequest,
    ) -> Result<QuestionBankItem, LibraryError> {
        let id = Uuid::new_v4();
        let now = Utc::now();
        let organization_id = writable_organization_id(ctx)?;

        sqlx::query(
            r#"
            INSERT INTO question_bank_items (
                id, organization_id, question_type, block_snapshot, difficulty, topic,
                tags, usage_count, created_by, created_at, updated_at, revision
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), ?)
            "#,
        )
        .bind(id.to_string())
        .bind(organization_id)
        .bind(&req.question_type)
        .bind(&req.block_snapshot)
        .bind(req.difficulty)
        .bind(&req.topic)
        .bind(&req.tags)
        .bind(0)
        .bind(ctx.actor_id.to_string())
        .bind(0)
        .execute(&self.pool)
        .await?;

        let question =
            sqlx::query_as::<_, QuestionBankItem>("SELECT * FROM question_bank_items WHERE id = ?")
                .bind(id.to_string())
                .fetch_one(&self.pool)
                .await?;

        Ok(question)
    }

    pub async fn get_question(
        &self,
        ctx: &ActorContext,
        id: Uuid,
    ) -> Result<QuestionBankItem, LibraryError> {
        let mut query = QueryBuilder::<MySql>::new("SELECT * FROM question_bank_items WHERE id = ");
        query.push_bind(id.to_string());
        append_read_scope(&mut query, ctx);
        query
            .build_query_as::<QuestionBankItem>()
            .fetch_optional(&self.pool)
            .await?
            .ok_or(LibraryError::NotFound)
    }

    pub async fn update_question(
        &self,
        ctx: &ActorContext,
        id: Uuid,
        req: UpdateQuestionRequest,
    ) -> Result<QuestionBankItem, LibraryError> {
        let existing = self.get_question(ctx, id).await?;
        ensure_writable_resource(ctx, existing.organization_id.as_deref())?;

        if existing.revision != req.revision {
            return Err(LibraryError::Conflict(
                "Question has been modified by another user".to_string(),
            ));
        }

        let updated_at = Utc::now();

        let result = sqlx::query(
            r#"
            UPDATE question_bank_items
            SET
                question_type = COALESCE(?, question_type),
                block_snapshot = COALESCE(?, block_snapshot),
                difficulty = COALESCE(?, difficulty),
                topic = COALESCE(?, topic),
                tags = COALESCE(?, tags),
                updated_at = NOW(),
                revision = revision + 1
            WHERE id = ?
              AND revision = ?
              AND (? IS NULL OR organization_id = ?)
            "#,
        )
        .bind(&req.question_type)
        .bind(&req.block_snapshot)
        .bind(&req.difficulty)
        .bind(&req.topic)
        .bind(&req.tags)
        .bind(id.to_string())
        .bind(existing.revision)
        .bind(if ctx.is_platform_write() {
            None
        } else {
            ctx.organization_id.as_deref()
        })
        .bind(if ctx.is_platform_write() {
            None
        } else {
            ctx.organization_id.as_deref()
        })
        .execute(&self.pool)
        .await?;
        if result.rows_affected() != 1 {
            return Err(LibraryError::Conflict(
                "Question has been modified by another user".to_owned(),
            ));
        }

        let question =
            sqlx::query_as::<_, QuestionBankItem>("SELECT * FROM question_bank_items WHERE id = ?")
                .bind(id.to_string())
                .fetch_one(&self.pool)
                .await?;

        Ok(question)
    }

    pub async fn delete_question(&self, ctx: &ActorContext, id: Uuid) -> Result<(), LibraryError> {
        let existing = self.get_question(ctx, id).await?;
        ensure_writable_resource(ctx, existing.organization_id.as_deref())?;
        let result = sqlx::query(
            "DELETE FROM question_bank_items WHERE id = ? AND (? IS NULL OR organization_id = ?)",
        )
        .bind(id.to_string())
        .bind(if ctx.is_platform_write() {
            None
        } else {
            ctx.organization_id.as_deref()
        })
        .bind(if ctx.is_platform_write() {
            None
        } else {
            ctx.organization_id.as_deref()
        })
        .execute(&self.pool)
        .await?;

        if result.rows_affected() == 0 {
            return Err(LibraryError::NotFound);
        }

        Ok(())
    }

    pub async fn list_questions(
        &self,
        ctx: &ActorContext,
        question_type: Option<String>,
        difficulty: Option<Difficulty>,
        topic: Option<String>,
        limit: i64,
    ) -> Result<Vec<QuestionBankItem>, LibraryError> {
        let mut query = QueryBuilder::<MySql>::new("SELECT * FROM question_bank_items WHERE 1 = 1");
        append_read_scope(&mut query, ctx);
        if let Some(question_type) = question_type {
            query.push(" AND question_type = ").push_bind(question_type);
        }
        if let Some(diff) = difficulty {
            query.push(" AND difficulty = ").push_bind(diff);
        }
        if let Some(topic) = topic {
            query.push(" AND topic = ").push_bind(topic);
        }
        query
            .push(" ORDER BY updated_at DESC, id DESC LIMIT ")
            .push_bind(limit);
        query
            .build_query_as::<QuestionBankItem>()
            .fetch_all(&self.pool)
            .await
            .map_err(LibraryError::from)
    }

    // Grading Export Profiles

    pub async fn list_grading_export_profiles(
        &self,
        ctx: &ActorContext,
    ) -> Result<Vec<GradingExportProfile>, LibraryError> {
        let mut query =
            QueryBuilder::<MySql>::new("SELECT * FROM grading_export_profiles WHERE 1 = 1");
        append_read_scope(&mut query, ctx);
        query.push(" ORDER BY updated_at DESC, id DESC");
        query
            .build_query_as::<GradingExportProfile>()
            .fetch_all(&self.pool)
            .await
            .map_err(LibraryError::from)
    }

    pub async fn create_grading_export_profile(
        &self,
        ctx: &ActorContext,
        req: CreateGradingExportProfileRequest,
    ) -> Result<GradingExportProfile, LibraryError> {
        let profile_name = req.profile_name.trim();
        if profile_name.is_empty() {
            return Err(LibraryError::Validation(
                "Export profile name is required".to_string(),
            ));
        }
        if profile_name.chars().count() > 255 {
            return Err(LibraryError::Validation(
                "Export profile name must be 255 characters or fewer".to_string(),
            ));
        }
        if !req.config_snapshot.is_object() {
            return Err(LibraryError::Validation(
                "Export profile snapshot must be a JSON object".to_string(),
            ));
        }

        let id = Uuid::new_v4();
        let organization_id = writable_organization_id(ctx)?;
        sqlx::query(
            r#"
            INSERT INTO grading_export_profiles (
                id, organization_id, profile_name, config_snapshot,
                created_by, created_at, updated_at, revision
            )
            VALUES (?, ?, ?, ?, ?, NOW(), NOW(), 0)
            "#,
        )
        .bind(id.to_string())
        .bind(organization_id)
        .bind(profile_name)
        .bind(&req.config_snapshot)
        .bind(&ctx.actor_id)
        .execute(&self.pool)
        .await?;

        sqlx::query_as::<_, GradingExportProfile>(
            "SELECT * FROM grading_export_profiles WHERE id = ?",
        )
        .bind(id.to_string())
        .fetch_one(&self.pool)
        .await
        .map_err(LibraryError::from)
    }

    // Admin Default Profiles

    pub async fn get_exam_defaults(
        &self,
        ctx: &ActorContext,
    ) -> Result<AdminDefaultProfile, LibraryError> {
        let mut query = QueryBuilder::<MySql>::new(
            "SELECT * FROM admin_default_profiles WHERE is_active = true",
        );
        append_read_scope(&mut query, ctx);
        query.push(" ORDER BY organization_id IS NULL ASC, updated_at DESC LIMIT 1");
        query
            .build_query_as::<AdminDefaultProfile>()
            .fetch_optional(&self.pool)
            .await?
            .ok_or(LibraryError::NotFound)
    }

    pub async fn update_exam_defaults(
        &self,
        ctx: &ActorContext,
        req: UpdateExamDefaultsRequest,
    ) -> Result<AdminDefaultProfile, LibraryError> {
        let organization_id = writable_organization_id(ctx)?;
        let existing = sqlx::query_as::<_, AdminDefaultProfile>(
            "SELECT * FROM admin_default_profiles WHERE is_active = true AND organization_id <=> ? LIMIT 1",
        )
        .bind(organization_id.clone())
        .fetch_optional(&self.pool)
        .await?;

        if let Some(existing) = existing {
            if existing.revision != req.revision {
                return Err(LibraryError::Conflict(
                    "Defaults have been modified by another user".to_string(),
                ));
            }

            let result = sqlx::query(
                r#"
                UPDATE admin_default_profiles
                SET
                    config_snapshot = ?,
                    updated_at = NOW(),
                    revision = revision + 1
                WHERE id = ? AND revision = ?
                "#,
            )
            .bind(&req.config_snapshot)
            .bind(&existing.id)
            .bind(req.revision)
            .execute(&self.pool)
            .await?;
            if result.rows_affected() != 1 {
                return Err(LibraryError::Conflict(
                    "Defaults have been modified by another user".to_owned(),
                ));
            }

            let profile = sqlx::query_as::<_, AdminDefaultProfile>(
                "SELECT * FROM admin_default_profiles WHERE id = ?",
            )
            .bind(&existing.id)
            .fetch_one(&self.pool)
            .await?;

            return Ok(profile);
        }

        let id = Uuid::new_v4();
        sqlx::query(
            r#"
            INSERT INTO admin_default_profiles (
                id,
                organization_id,
                profile_name,
                config_snapshot,
                is_active,
                created_by,
                created_at,
                updated_at,
                revision
            )
            VALUES (?, ?, ?, ?, true, ?, NOW(), NOW(), 0)
            "#,
        )
        .bind(id.to_string())
        .bind(organization_id)
        .bind("Default")
        .bind(&req.config_snapshot)
        .bind(ctx.actor_id.to_string())
        .execute(&self.pool)
        .await?;

        let profile = sqlx::query_as::<_, AdminDefaultProfile>(
            "SELECT * FROM admin_default_profiles WHERE id = ?",
        )
        .bind(id.to_string())
        .fetch_one(&self.pool)
        .await?;

        Ok(profile)
    }
}

fn writable_organization_id(ctx: &ActorContext) -> Result<Option<String>, LibraryError> {
    match ctx.access_scope() {
        Some(AccessScope::PlatformWrite) => Ok(None),
        Some(AccessScope::Tenant {
            organization_id, ..
        }) => Ok(Some(organization_id)),
        _ => Err(LibraryError::NotFound),
    }
}

fn ensure_writable_resource(
    ctx: &ActorContext,
    resource_organization_id: Option<&str>,
) -> Result<(), LibraryError> {
    match ctx.access_scope() {
        Some(AccessScope::PlatformWrite) => Ok(()),
        Some(AccessScope::Tenant {
            organization_id, ..
        }) if resource_organization_id == Some(organization_id.as_str()) => Ok(()),
        _ => Err(LibraryError::NotFound),
    }
}

fn append_read_scope(query: &mut QueryBuilder<'_, MySql>, ctx: &ActorContext) {
    match ctx.access_scope() {
        Some(AccessScope::PlatformRead | AccessScope::PlatformWrite) => {}
        Some(AccessScope::Tenant {
            organization_id, ..
        }) => {
            query
                .push(" AND (organization_id = ")
                .push_bind(organization_id)
                .push(" OR organization_id IS NULL)");
        }
        None => {
            query.push(" AND 1 = 0");
        }
    };
}
