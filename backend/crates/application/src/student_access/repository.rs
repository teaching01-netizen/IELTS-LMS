use sqlx::{query_as, query_scalar, MySqlPool};
use thiserror::Error;
use uuid::Uuid;

const PREVIEW_RUNTIME_COHORT_PREFIX: &str = "__preview_runtime__:";
const PREVIEW_RUNTIME_INSTITUTION: &str = "preview-runtime";

#[derive(Debug, sqlx::FromRow)]
struct PreviewScheduleRow {
    cohort_name: String,
    institution: Option<String>,
}

#[derive(Debug, Error)]
pub enum StudentAccessRepositoryError {
    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("Not found")]
    NotFound,
}

#[derive(Clone)]
pub struct StudentAccessRepository {
    pool: MySqlPool,
}

impl StudentAccessRepository {
    pub fn new(pool: MySqlPool) -> Self {
        Self { pool }
    }

    pub async fn is_preview_runtime_schedule(
        &self,
        schedule_id: Uuid,
    ) -> Result<bool, StudentAccessRepositoryError> {
        let schedule = query_as::<_, PreviewScheduleRow>(
            "SELECT cohort_name, institution FROM exam_schedules WHERE id = ?",
        )
        .bind(schedule_id.to_string())
        .fetch_optional(&self.pool)
        .await?;

        let Some(schedule) = schedule else {
            return Ok(false);
        };

        Ok(schedule
            .cohort_name
            .starts_with(PREVIEW_RUNTIME_COHORT_PREFIX)
            && schedule.institution.as_deref() == Some(PREVIEW_RUNTIME_INSTITUTION))
    }

    pub async fn load_attempt_student_key(
        &self,
        attempt_id: &str,
    ) -> Result<String, StudentAccessRepositoryError> {
        query_scalar("SELECT student_key FROM student_attempts WHERE id = ?")
            .bind(attempt_id)
            .fetch_optional(&self.pool)
            .await?
            .ok_or(StudentAccessRepositoryError::NotFound)
    }

    pub async fn load_attempt_candidate_name(
        &self,
        attempt_id: &str,
    ) -> Result<String, StudentAccessRepositoryError> {
        query_scalar("SELECT candidate_name FROM student_attempts WHERE id = ?")
            .bind(attempt_id)
            .fetch_optional(&self.pool)
            .await?
            .ok_or(StudentAccessRepositoryError::NotFound)
    }
}
