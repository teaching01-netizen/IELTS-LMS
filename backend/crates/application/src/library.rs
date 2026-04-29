use chrono::Utc;
use ielts_backend_domain::library::{
    AdminDefaultProfile, CreatePassageRequest, CreateQuestionRequest, Difficulty,
    PassageLibraryItem, QuestionBankItem, UpdateExamDefaultsRequest, UpdatePassageRequest,
    UpdateQuestionRequest,
};
use ielts_backend_infrastructure::actor_context::ActorContext;
use sqlx::MySqlPool;
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
        .bind(ctx.organization_id.as_ref().map(|id| id.to_string()))
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
        _ctx: &ActorContext,
        id: Uuid,
    ) -> Result<PassageLibraryItem, LibraryError> {
        sqlx::query_as::<_, PassageLibraryItem>("SELECT * FROM passage_library_items WHERE id = ?")
            .bind(id.to_string())
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

        if existing.revision != req.revision {
            return Err(LibraryError::Conflict(
                "Passage has been modified by another user".to_string(),
            ));
        }

        let updated_at = Utc::now();

        sqlx::query(
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

    pub async fn delete_passage(&self, _ctx: &ActorContext, id: Uuid) -> Result<(), LibraryError> {
        let result = sqlx::query("DELETE FROM passage_library_items WHERE id = ?")
            .bind(id.to_string())
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
        let mut query = String::from(
            "SELECT * FROM passage_library_items WHERE (organization_id = ? OR organization_id IS NULL)",
        );

        if difficulty.is_some() {
            query.push_str(" AND difficulty = ?");
        }

        if topic.is_some() {
            query.push_str(" AND topic = ?");
        }

        query.push_str(" ORDER BY updated_at DESC LIMIT ?");

        let org_id = ctx.organization_id.as_ref().map(|id| id.to_string());
        let mut q = sqlx::query_as::<_, PassageLibraryItem>(&query).bind(org_id);

        if let Some(diff) = difficulty {
            q = q.bind(diff);
        }

        if let Some(t) = topic {
            q = q.bind(t);
        }

        q = q.bind(limit);

        q.fetch_all(&self.pool).await.map_err(LibraryError::from)
    }

    // Question Bank

    pub async fn create_question(
        &self,
        ctx: &ActorContext,
        req: CreateQuestionRequest,
    ) -> Result<QuestionBankItem, LibraryError> {
        let id = Uuid::new_v4();
        let now = Utc::now();

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
        .bind(ctx.organization_id.as_ref().map(|id| id.to_string()))
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
        _ctx: &ActorContext,
        id: Uuid,
    ) -> Result<QuestionBankItem, LibraryError> {
        sqlx::query_as::<_, QuestionBankItem>("SELECT * FROM question_bank_items WHERE id = ?")
            .bind(id.to_string())
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

        if existing.revision != req.revision {
            return Err(LibraryError::Conflict(
                "Question has been modified by another user".to_string(),
            ));
        }

        let updated_at = Utc::now();

        sqlx::query(
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
            "#,
        )
        .bind(&req.question_type)
        .bind(&req.block_snapshot)
        .bind(&req.difficulty)
        .bind(&req.topic)
        .bind(&req.tags)
        .bind(id.to_string())
        .execute(&self.pool)
        .await?;

        let question =
            sqlx::query_as::<_, QuestionBankItem>("SELECT * FROM question_bank_items WHERE id = ?")
                .bind(id.to_string())
                .fetch_one(&self.pool)
                .await?;

        Ok(question)
    }

    pub async fn delete_question(&self, _ctx: &ActorContext, id: Uuid) -> Result<(), LibraryError> {
        let result = sqlx::query("DELETE FROM question_bank_items WHERE id = ?")
            .bind(id.to_string())
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
        let mut query = String::from(
            "SELECT * FROM question_bank_items WHERE (organization_id = ? OR organization_id IS NULL)",
        );

        if question_type.is_some() {
            query.push_str(" AND question_type = ?");
        }

        if difficulty.is_some() {
            query.push_str(" AND difficulty = ?");
        }

        if topic.is_some() {
            query.push_str(" AND topic = ?");
        }

        query.push_str(" ORDER BY updated_at DESC LIMIT ?");

        let org_id = ctx.organization_id.as_ref().map(|id| id.to_string());
        let mut q = sqlx::query_as::<_, QuestionBankItem>(&query).bind(&org_id);

        if let Some(qt) = question_type {
            q = q.bind(qt);
        }

        if let Some(diff) = difficulty {
            q = q.bind(diff);
        }

        if let Some(t) = topic {
            q = q.bind(t);
        }

        q = q.bind(limit);

        q.fetch_all(&self.pool).await.map_err(LibraryError::from)
    }

    // Admin Default Profiles

    pub async fn get_exam_defaults(
        &self,
        ctx: &ActorContext,
    ) -> Result<AdminDefaultProfile, LibraryError> {
        let organization_id = ctx.organization_id.as_ref().map(|id| id.to_string());
        sqlx::query_as::<_, AdminDefaultProfile>(
            "SELECT * FROM admin_default_profiles WHERE is_active = true AND organization_id <=> ? LIMIT 1",
        )
        .bind(organization_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or(LibraryError::NotFound)
    }

    pub async fn update_exam_defaults(
        &self,
        ctx: &ActorContext,
        req: UpdateExamDefaultsRequest,
    ) -> Result<AdminDefaultProfile, LibraryError> {
        let organization_id = ctx.organization_id.as_ref().map(|id| id.to_string());
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

            sqlx::query(
                r#"
                UPDATE admin_default_profiles
                SET
                    config_snapshot = ?,
                    updated_at = NOW(),
                    revision = revision + 1
                WHERE id = ?
                "#,
            )
            .bind(&req.config_snapshot)
            .bind(&existing.id)
            .execute(&self.pool)
            .await?;

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
