use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::{FromRow, MySql, MySqlPool, QueryBuilder};
use uuid::Uuid;

use ielts_backend_domain::{
    assessment::{AssessmentRoute, AssessmentSectionResult},
    grading::{ReleaseEvent, ResultsAnalytics, StudentResult},
};
use ielts_backend_infrastructure::actor_context::{ActorContext, ActorRole};

use crate::grading::{GradingError, GradingService};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SatResultSummary {
    pub id: String,
    pub submission_id: Option<String>,
    pub outcome_status: String,
    pub schedule_id: String,
    pub exam_id: String,
    pub exam_title: String,
    pub version_number: i32,
    pub student_id: String,
    pub student_name: String,
    pub student_email: Option<String>,
    pub cohort_name: String,
    pub submitted_at: DateTime<Utc>,
    pub total_score: Option<i32>,
    pub score_kind: String,
    pub release_status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SatResultDetail {
    pub summary: SatResultSummary,
    pub score_payload: Value,
    pub sections: Vec<AssessmentSectionResult>,
}

#[derive(Debug, Clone, FromRow)]
struct SatResultSummaryRow {
    id: String,
    submission_id: Option<String>,
    outcome_status: String,
    schedule_id: String,
    exam_id: String,
    exam_title: String,
    version_number: i32,
    student_id: String,
    student_name: String,
    student_email: Option<String>,
    cohort_name: String,
    submitted_at: DateTime<Utc>,
    total_score: Option<i32>,
    release_status: String,
}

#[derive(Debug, Clone, FromRow)]
struct SatSectionResultRow {
    section_key: String,
    route: Option<String>,
    raw_correct: i32,
    operational_question_count: i32,
    scaled_score: Option<i32>,
    details: Value,
}

pub struct ResultsService {
    grading: GradingService,
    pool: MySqlPool,
}

impl ResultsService {
    pub fn new(pool: MySqlPool) -> Self {
        Self {
            grading: GradingService::new(pool.clone()),
            pool,
        }
    }

    pub async fn list_results(
        &self,
        ctx: &ActorContext,
    ) -> Result<Vec<StudentResult>, GradingError> {
        self.grading.list_results(ctx).await
    }

    pub async fn get_result(
        &self,
        ctx: &ActorContext,
        result_id: Uuid,
    ) -> Result<StudentResult, GradingError> {
        self.grading.get_result(ctx, result_id).await
    }

    pub async fn analytics(&self, ctx: &ActorContext) -> Result<ResultsAnalytics, GradingError> {
        self.grading.analytics(ctx).await
    }

    pub async fn export_results(&self, ctx: &ActorContext) -> Result<Value, GradingError> {
        self.grading.export_results(ctx).await
    }

    pub async fn get_events(
        &self,
        ctx: &ActorContext,
        result_id: Uuid,
    ) -> Result<Vec<ReleaseEvent>, GradingError> {
        self.grading.get_result_events(ctx, result_id).await
    }

    pub async fn list_sat_results(
        &self,
        ctx: &ActorContext,
    ) -> Result<Vec<SatResultSummary>, GradingError> {
        Ok(self
            .load_sat_result_rows(ctx, None)
            .await?
            .into_iter()
            .map(map_sat_summary)
            .collect())
    }

    pub async fn get_sat_result(
        &self,
        ctx: &ActorContext,
        result_id: Uuid,
    ) -> Result<SatResultDetail, GradingError> {
        let row = self
            .load_sat_result_rows(ctx, Some(result_id))
            .await?
            .into_iter()
            .next()
            .ok_or(GradingError::NotFound)?;
        let result_id = row.id.clone();
        let score_payload: Value = sqlx::query_scalar(
            "SELECT score_payload FROM assessment_results WHERE id = ? AND provider_key = 'sat'",
        )
        .bind(&result_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or(GradingError::NotFound)?;
        let sections = sqlx::query_as::<_, SatSectionResultRow>(
            r#"
            SELECT section_key, route, raw_correct, operational_question_count, scaled_score, details
            FROM assessment_section_results
            WHERE assessment_result_id = ?
            ORDER BY FIELD(section_key, 'reading-writing', 'math'), section_key
            "#,
        )
        .bind(&result_id)
        .fetch_all(&self.pool)
        .await?
        .into_iter()
        .map(|section| AssessmentSectionResult {
            section_key: section.section_key,
            route: section.route.as_deref().and_then(parse_assessment_route),
            raw_correct: section.raw_correct,
            operational_question_count: section.operational_question_count,
            scaled_score: section.scaled_score,
            details: section.details,
        })
        .collect();

        Ok(SatResultDetail {
            summary: map_sat_summary(row),
            score_payload,
            sections,
        })
    }

    async fn load_sat_result_rows(
        &self,
        ctx: &ActorContext,
        result_id: Option<Uuid>,
    ) -> Result<Vec<SatResultSummaryRow>, GradingError> {
        let mut query = QueryBuilder::<MySql>::new(
            r#"
            SELECT
                ar.id,
                ar.submission_id,
                ar.outcome_status,
                a.schedule_id,
                a.exam_id,
                e.title AS exam_title,
                ev.version_number,
                a.candidate_id AS student_id,
                a.candidate_name AS student_name,
                a.candidate_email AS student_email,
                s.cohort_name,
                COALESCE(a.submitted_at, ar.created_at) AS submitted_at,
                ar.total_score,
                ar.release_status
            FROM assessment_results ar
            JOIN student_attempts a ON a.id = ar.attempt_id
            JOIN exam_schedules s ON s.id = a.schedule_id
            JOIN exam_entities e ON e.id = a.exam_id
            JOIN exam_versions ev ON ev.id = a.published_version_id
            WHERE ar.provider_key = 'sat'
              AND e.provider_key = 'sat'
            "#,
        );

        if let Some(result_id) = result_id {
            query.push(" AND ar.id = ").push_bind(result_id.to_string());
        }

        match ctx.access_scope() {
            Some(
                ielts_backend_infrastructure::actor_context::AccessScope::PlatformRead
                | ielts_backend_infrastructure::actor_context::AccessScope::PlatformWrite,
            ) => {}
            Some(ielts_backend_infrastructure::actor_context::AccessScope::Tenant {
                organization_id,
                ..
            }) => {
                query
                    .push(" AND e.organization_id = ")
                    .push_bind(organization_id);
            }
            None => {
                query.push(" AND 1 = 0");
            }
        }

        if !matches!(ctx.role, ActorRole::Admin | ActorRole::AdminObserver) {
            query
                .push(
                    r#"
                    AND EXISTS (
                        SELECT 1
                        FROM schedule_staff_assignments assignment
                        WHERE assignment.schedule_id = a.schedule_id
                          AND assignment.user_id =
                    "#,
                )
                .push_bind(&ctx.actor_id)
                .push(" AND assignment.role = ")
                .push_bind(ctx.role.as_str())
                .push(" AND assignment.revoked_at IS NULL)");
        }

        if let Some(schedule_id) = ctx.schedule_scope_id.as_ref() {
            query.push(" AND a.schedule_id = ").push_bind(schedule_id);
        }

        query.push(" ORDER BY a.submitted_at DESC, ar.created_at DESC");
        Ok(query
            .build_query_as::<SatResultSummaryRow>()
            .fetch_all(&self.pool)
            .await?)
    }
}

fn map_sat_summary(row: SatResultSummaryRow) -> SatResultSummary {
    SatResultSummary {
        id: row.id,
        submission_id: row.submission_id,
        outcome_status: row.outcome_status,
        schedule_id: row.schedule_id,
        exam_id: row.exam_id,
        exam_title: row.exam_title,
        version_number: row.version_number,
        student_id: row.student_id,
        student_name: row.student_name,
        student_email: row.student_email,
        cohort_name: row.cohort_name,
        submitted_at: row.submitted_at,
        total_score: row.total_score,
        score_kind: "practice".to_owned(),
        release_status: row.release_status,
    }
}

fn parse_assessment_route(route: &str) -> Option<AssessmentRoute> {
    match route {
        "lower" => Some(AssessmentRoute::Lower),
        "higher" => Some(AssessmentRoute::Higher),
        _ => None,
    }
}
