use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::{FromRow, MySql, MySqlPool, Transaction};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AssessmentReleaseError {
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("assessment release was not found")]
    NotFound,
    #[error("assessment release invariant failed: {0}")]
    Invariant(String),
    #[error("assessment release is only available for SAT exams")]
    UnsupportedProvider,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AssessmentReleaseLifecycleState {
    NeverPublished,
    PublishedCurrent,
    UnpublishedChanges,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleasePublishedVersion {
    pub id: String,
    pub version_number: i32,
    pub revision: i32,
    pub publish_notes: Option<String>,
    pub published_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseWorkingDraft {
    pub id: String,
    pub parent_version_id: Option<String>,
    pub version_number: i32,
    pub revision: i32,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseContentSummary {
    pub candidate_duration_seconds: i64,
    pub authored_question_count: i64,
    pub delivered_question_count: i64,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseAccessSummary {
    pub total_links: i64,
    pub live_links: i64,
    pub upcoming_links: i64,
    pub links_on_current_release: i64,
    pub live_links_on_previous_releases: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssessmentReleaseState {
    pub exam_id: String,
    pub provider_key: String,
    pub state: AssessmentReleaseLifecycleState,
    pub current_published_version: Option<ReleasePublishedVersion>,
    pub working_draft: Option<ReleaseWorkingDraft>,
    pub summary: ReleaseContentSummary,
    pub access: ReleaseAccessSummary,
}

#[derive(Debug, FromRow)]
struct ReleaseRow {
    exam_id: String,
    provider_key: String,
    published_id: Option<String>,
    published_version_number: Option<i32>,
    published_revision: Option<i32>,
    published_notes: Option<String>,
    published_created_at: Option<DateTime<Utc>>,
    published_is_published: Option<bool>,
    draft_id: Option<String>,
    draft_parent_version_id: Option<String>,
    draft_version_number: Option<i32>,
    draft_revision: Option<i32>,
    draft_is_draft: Option<bool>,
}

#[derive(Debug, FromRow)]
struct AccessSummaryRow {
    total_links: i64,
    live_links: i64,
    upcoming_links: i64,
    links_on_current_release: i64,
    live_links_on_previous_releases: i64,
}

pub struct AssessmentReleaseService {
    pool: MySqlPool,
}

impl AssessmentReleaseService {
    pub fn new(pool: MySqlPool) -> Self {
        Self { pool }
    }

    pub async fn get(
        &self,
        exam_id: &str,
    ) -> Result<AssessmentReleaseState, AssessmentReleaseError> {
        let mut tx = self.pool.begin().await?;
        let row = sqlx::query_as::<_, ReleaseRow>(
            r#"
            SELECT e.id AS exam_id, e.provider_key,
                   pv.id AS published_id, pv.version_number AS published_version_number,
                   pv.revision AS published_revision, pv.publish_notes AS published_notes,
                   pv.created_at AS published_created_at,
                   pv.is_published AS published_is_published,
                   dv.id AS draft_id, dv.parent_version_id AS draft_parent_version_id,
                   dv.version_number AS draft_version_number,
                   dv.revision AS draft_revision, dv.is_draft AS draft_is_draft
            FROM exam_entities e
            LEFT JOIN exam_versions pv ON pv.id = e.current_published_version_id
            LEFT JOIN exam_versions dv ON dv.id = e.current_draft_version_id
            WHERE e.id = ?
            "#,
        )
        .bind(exam_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or(AssessmentReleaseError::NotFound)?;

        if row.provider_key != "sat" {
            return Err(AssessmentReleaseError::UnsupportedProvider);
        }
        validate_release_row(&row)?;
        let state = classify_release_state(&row)?;
        let current_published_version = published_version_from_row(&row)?;
        let working_draft = working_draft_from_row(&row)?;
        let content_version_id = row.draft_id.as_deref().or(row.published_id.as_deref());

        let summary = if let Some(version_id) = content_version_id {
            Self::content_summary_tx(&mut tx, version_id).await?
        } else {
            ReleaseContentSummary::default()
        };
        let access = Self::access_summary_tx(&mut tx, exam_id, row.published_id.as_deref()).await?;
        tx.commit().await?;

        Ok(AssessmentReleaseState {
            exam_id: row.exam_id,
            provider_key: row.provider_key,
            state,
            current_published_version,
            working_draft,
            summary,
            access,
        })
    }

    async fn content_summary_tx(
        tx: &mut Transaction<'_, MySql>,
        version_id: &str,
    ) -> Result<ReleaseContentSummary, AssessmentReleaseError> {
        let candidate_duration_seconds: i64 = sqlx::query_scalar(
            "SELECT CAST(COALESCE(SUM(duration_seconds + break_after_seconds), 0) AS SIGNED) FROM assessment_sections WHERE exam_version_id = ?",
        )
        .bind(version_id)
        .fetch_one(&mut **tx)
        .await?;
        let authored_question_count: i64 = sqlx::query_scalar(
            r#"
            SELECT COUNT(*)
            FROM assessment_exam_questions q
            JOIN assessment_modules m ON m.id = q.module_id
            JOIN assessment_sections s ON s.id = m.section_id
            WHERE s.exam_version_id = ?
            "#,
        )
        .bind(version_id)
        .fetch_one(&mut **tx)
        .await?;
        let delivered_question_count: i64 = sqlx::query_scalar(
            r#"
            SELECT CAST(COALESCE(SUM(section_plan.base_target + section_plan.branch_target), 0) AS SIGNED)
            FROM (
                SELECT s.id,
                       MAX(CASE WHEN m.adaptive_role = 'base' THEN m.target_question_count ELSE 0 END) AS base_target,
                       MAX(CASE WHEN m.adaptive_role IN ('lower_branch', 'higher_branch') THEN m.target_question_count ELSE 0 END) AS branch_target
                FROM assessment_sections s
                LEFT JOIN assessment_modules m ON m.section_id = s.id
                WHERE s.exam_version_id = ?
                GROUP BY s.id
            ) section_plan
            "#,
        )
        .bind(version_id)
        .fetch_one(&mut **tx)
        .await?;
        Ok(ReleaseContentSummary {
            candidate_duration_seconds,
            authored_question_count,
            delivered_question_count,
        })
    }

    async fn access_summary_tx(
        tx: &mut Transaction<'_, MySql>,
        exam_id: &str,
        current_published_version_id: Option<&str>,
    ) -> Result<ReleaseAccessSummary, AssessmentReleaseError> {
        let row = sqlx::query_as::<_, AccessSummaryRow>(
            r#"
            SELECT COUNT(*) AS total_links,
                   CAST(COALESCE(SUM(CASE WHEN l.lifecycle_state = 'active'
                     AND (l.availability_type = 'anytime' OR (l.opens_at <= NOW() AND l.closes_at > NOW())) THEN 1 ELSE 0 END), 0) AS SIGNED) AS live_links,
                   CAST(COALESCE(SUM(CASE WHEN l.lifecycle_state = 'active' AND l.availability_type = 'scheduled' AND l.opens_at > NOW() THEN 1 ELSE 0 END), 0) AS SIGNED) AS upcoming_links,
                   CAST(COALESCE(SUM(CASE WHEN l.published_version_id <=> ? THEN 1 ELSE 0 END), 0) AS SIGNED) AS links_on_current_release,
                   CAST(COALESCE(SUM(CASE WHEN NOT (l.published_version_id <=> ?)
                     AND l.lifecycle_state = 'active'
                     AND (l.availability_type = 'anytime' OR (l.opens_at <= NOW() AND l.closes_at > NOW())) THEN 1 ELSE 0 END), 0) AS SIGNED) AS live_links_on_previous_releases
            FROM assessment_access_links l WHERE l.exam_id = ?
            "#,
        )
        .bind(current_published_version_id)
        .bind(current_published_version_id)
        .bind(exam_id)
        .fetch_one(&mut **tx)
        .await?;
        Ok(ReleaseAccessSummary {
            total_links: row.total_links,
            live_links: row.live_links,
            upcoming_links: row.upcoming_links,
            links_on_current_release: row.links_on_current_release,
            live_links_on_previous_releases: row.live_links_on_previous_releases,
        })
    }
}

fn classify_release_state(
    row: &ReleaseRow,
) -> Result<AssessmentReleaseLifecycleState, AssessmentReleaseError> {
    let Some(published_id) = row.published_id.as_deref() else {
        return Ok(AssessmentReleaseLifecycleState::NeverPublished);
    };
    let Some(draft_id) = row.draft_id.as_deref() else {
        return Ok(AssessmentReleaseLifecycleState::PublishedCurrent);
    };
    if draft_id == published_id {
        return Err(AssessmentReleaseError::Invariant(
            "published and draft pointers reference the same version".to_owned(),
        ));
    }
    if row.draft_parent_version_id.as_deref() == Some(published_id) && row.draft_revision == Some(0)
    {
        Ok(AssessmentReleaseLifecycleState::PublishedCurrent)
    } else {
        Ok(AssessmentReleaseLifecycleState::UnpublishedChanges)
    }
}

fn validate_release_row(row: &ReleaseRow) -> Result<(), AssessmentReleaseError> {
    if row.published_id.is_some() && row.published_is_published != Some(true) {
        return Err(AssessmentReleaseError::Invariant(
            "current published pointer does not reference a published version".to_owned(),
        ));
    }
    if row.draft_id.is_some() && row.draft_is_draft != Some(true) {
        return Err(AssessmentReleaseError::Invariant(
            "current draft pointer does not reference a draft version".to_owned(),
        ));
    }
    Ok(())
}

fn published_version_from_row(
    row: &ReleaseRow,
) -> Result<Option<ReleasePublishedVersion>, AssessmentReleaseError> {
    let Some(id) = row.published_id.clone() else {
        return Ok(None);
    };
    let version_number = row.published_version_number.ok_or_else(|| {
        AssessmentReleaseError::Invariant("published version number is missing".to_owned())
    })?;
    let revision = row.published_revision.ok_or_else(|| {
        AssessmentReleaseError::Invariant("published revision is missing".to_owned())
    })?;
    let published_at = row.published_created_at.ok_or_else(|| {
        AssessmentReleaseError::Invariant("published timestamp is missing".to_owned())
    })?;
    Ok(Some(ReleasePublishedVersion {
        id,
        version_number,
        revision,
        publish_notes: row.published_notes.clone(),
        published_at,
    }))
}

fn working_draft_from_row(
    row: &ReleaseRow,
) -> Result<Option<ReleaseWorkingDraft>, AssessmentReleaseError> {
    let Some(id) = row.draft_id.clone() else {
        return Ok(None);
    };
    let version_number = row.draft_version_number.ok_or_else(|| {
        AssessmentReleaseError::Invariant("draft version number is missing".to_owned())
    })?;
    let revision = row
        .draft_revision
        .ok_or_else(|| AssessmentReleaseError::Invariant("draft revision is missing".to_owned()))?;
    Ok(Some(ReleaseWorkingDraft {
        id,
        parent_version_id: row.draft_parent_version_id.clone(),
        version_number,
        revision,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(published: bool, draft_revision: Option<i32>, parent_matches: bool) -> ReleaseRow {
        ReleaseRow {
            exam_id: "exam".to_owned(),
            provider_key: "sat".to_owned(),
            published_id: published.then(|| "published".to_owned()),
            published_version_number: published.then_some(4),
            published_revision: published.then_some(1),
            published_notes: None,
            published_created_at: published.then(Utc::now),
            published_is_published: published.then_some(true),
            draft_id: draft_revision.map(|_| "draft".to_owned()),
            draft_parent_version_id: if parent_matches && published {
                Some("published".to_owned())
            } else {
                None
            },
            draft_version_number: draft_revision.map(|_| 5),
            draft_revision,
            draft_is_draft: draft_revision.map(|_| true),
        }
    }

    #[test]
    fn classifies_release_lifecycle_without_exposing_untouched_continuation() {
        assert_eq!(
            classify_release_state(&row(false, Some(0), false)).unwrap(),
            AssessmentReleaseLifecycleState::NeverPublished
        );
        assert_eq!(
            classify_release_state(&row(true, None, false)).unwrap(),
            AssessmentReleaseLifecycleState::PublishedCurrent
        );
        assert_eq!(
            classify_release_state(&row(true, Some(0), true)).unwrap(),
            AssessmentReleaseLifecycleState::PublishedCurrent
        );
        assert_eq!(
            classify_release_state(&row(true, Some(1), true)).unwrap(),
            AssessmentReleaseLifecycleState::UnpublishedChanges
        );
        assert_eq!(
            classify_release_state(&row(true, Some(0), false)).unwrap(),
            AssessmentReleaseLifecycleState::UnpublishedChanges
        );
    }
}
