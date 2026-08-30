use std::collections::HashSet;

use chrono::{DateTime, Duration, Utc};
use ielts_backend_domain::schedule::CreateScheduleRequest;
use ielts_backend_infrastructure::actor_context::ActorContext;
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, MySql, MySqlPool, Transaction};
use thiserror::Error;
use uuid::Uuid;

use crate::scheduling::{SchedulingError, SchedulingService};

const ANYTIME_BACKING_HORIZON_DAYS: i64 = 3_650;
const MAX_LINK_NAME_CHARS: usize = 160;
const MAX_AUDIENCE_LABEL_CHARS: usize = 255;
const MAX_SELECTED_STUDENTS: usize = 10_000;

#[derive(Debug, Error)]
pub enum AssessmentAccessLinkError {
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("scheduling error: {0}")]
    Scheduling(#[from] SchedulingError),
    #[error("access link was not found")]
    NotFound,
    #[error("access link conflict: {0}")]
    Conflict(String),
    #[error("access link validation failed: {0}")]
    Validation(String),
    #[error("access link is not currently available: {0}")]
    Unavailable(String),
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AccessLinkAudienceType {
    Anyone,
    Cohort,
    SelectedStudents,
}

impl AccessLinkAudienceType {
    fn as_str(self) -> &'static str {
        match self {
            Self::Anyone => "anyone",
            Self::Cohort => "cohort",
            Self::SelectedStudents => "selected_students",
        }
    }

    fn parse(value: &str) -> Result<Self, AssessmentAccessLinkError> {
        match value {
            "anyone" => Ok(Self::Anyone),
            "cohort" => Ok(Self::Cohort),
            "selected_students" => Ok(Self::SelectedStudents),
            _ => Err(AssessmentAccessLinkError::Validation(
                "Unknown access-link audience type.".to_owned(),
            )),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AccessLinkMode {
    StudentCode,
    Open,
}

impl AccessLinkMode {
    fn as_str(self) -> &'static str {
        match self {
            Self::StudentCode => "student_code",
            Self::Open => "open",
        }
    }

    fn parse(value: &str) -> Result<Self, AssessmentAccessLinkError> {
        match value {
            "student_code" => Ok(Self::StudentCode),
            "open" => Ok(Self::Open),
            _ => Err(AssessmentAccessLinkError::Validation(
                "Unknown access-link access mode.".to_owned(),
            )),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AccessLinkAvailabilityType {
    Scheduled,
    Anytime,
}

impl AccessLinkAvailabilityType {
    fn as_str(self) -> &'static str {
        match self {
            Self::Scheduled => "scheduled",
            Self::Anytime => "anytime",
        }
    }

    fn parse(value: &str) -> Result<Self, AssessmentAccessLinkError> {
        match value {
            "scheduled" => Ok(Self::Scheduled),
            "anytime" => Ok(Self::Anytime),
            _ => Err(AssessmentAccessLinkError::Validation(
                "Unknown access-link availability type.".to_owned(),
            )),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AccessLinkLifecycleState {
    Active,
    Paused,
    Revoked,
}

impl AccessLinkLifecycleState {
    fn as_str(self) -> &'static str {
        match self {
            Self::Active => "active",
            Self::Paused => "paused",
            Self::Revoked => "revoked",
        }
    }

    fn parse(value: &str) -> Result<Self, AssessmentAccessLinkError> {
        match value {
            "active" => Ok(Self::Active),
            "paused" => Ok(Self::Paused),
            "revoked" => Ok(Self::Revoked),
            _ => Err(AssessmentAccessLinkError::Validation(
                "Unknown access-link lifecycle state.".to_owned(),
            )),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AccessLinkStatus {
    Live,
    Upcoming,
    Ended,
    Paused,
    Revoked,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccessLinkMetrics {
    pub registered: i64,
    pub started: i64,
    pub submitted: i64,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PublishedAccessVersionSummary {
    pub id: String,
    pub version_number: i32,
    pub revision: i32,
    pub publish_notes: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccessDistributionOverview {
    pub current_published_version: Option<PublishedAccessVersionSummary>,
    pub links: Vec<AssessmentAccessLink>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssessmentAccessLink {
    pub id: String,
    pub exam_id: String,
    pub exam_title: String,
    pub provider_key: String,
    pub published_version_id: String,
    pub version_number: i32,
    pub schedule_id: String,
    pub name: String,
    pub audience_type: AccessLinkAudienceType,
    pub audience_label: Option<String>,
    pub access_mode: AccessLinkMode,
    pub availability_type: AccessLinkAvailabilityType,
    pub opens_at: Option<DateTime<Utc>>,
    pub closes_at: Option<DateTime<Utc>>,
    pub lifecycle_state: AccessLinkLifecycleState,
    pub status: AccessLinkStatus,
    pub selected_student_count: i64,
    pub metrics: AccessLinkMetrics,
    pub is_current_release: bool,
    pub has_participation: bool,
    pub revision: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicAssessmentAccessLink {
    pub id: String,
    pub exam_title: String,
    pub provider_key: String,
    pub version_number: i32,
    pub name: String,
    pub audience_type: AccessLinkAudienceType,
    pub audience_label: Option<String>,
    pub access_mode: AccessLinkMode,
    pub availability_type: AccessLinkAvailabilityType,
    pub opens_at: Option<DateTime<Utc>>,
    pub closes_at: Option<DateTime<Utc>>,
    pub status: AccessLinkStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AccessLinkMemberInput {
    pub student_code: String,
    pub student_name: Option<String>,
    pub student_email: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccessLinkMember {
    pub student_code: String,
    pub student_name: Option<String>,
    pub student_email: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateAssessmentAccessLinkRequest {
    #[serde(default)]
    pub published_version_id: Option<String>,
    pub name: String,
    pub audience_type: AccessLinkAudienceType,
    pub audience_label: Option<String>,
    pub access_mode: AccessLinkMode,
    pub availability_type: AccessLinkAvailabilityType,
    pub opens_at: Option<DateTime<Utc>>,
    pub closes_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub selected_students: Vec<AccessLinkMemberInput>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdateAssessmentAccessLinkRequest {
    pub revision: i32,
    pub name: String,
    pub audience_type: AccessLinkAudienceType,
    pub audience_label: Option<String>,
    pub access_mode: AccessLinkMode,
    pub availability_type: AccessLinkAvailabilityType,
    pub opens_at: Option<DateTime<Utc>>,
    pub closes_at: Option<DateTime<Utc>>,
    pub selected_students: Option<Vec<AccessLinkMemberInput>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SetAccessLinkLifecycleRequest {
    pub revision: i32,
    pub state: AccessLinkLifecycleState,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum DuplicateReleaseTarget {
    #[default]
    Source,
    Current,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DuplicateAssessmentAccessLinkRequest {
    pub revision: i32,
    pub name: Option<String>,
    #[serde(default)]
    pub release_target: DuplicateReleaseTarget,
    pub availability_type: Option<AccessLinkAvailabilityType>,
    pub opens_at: Option<DateTime<Utc>>,
    pub closes_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccessLinkActivity {
    pub kind: String,
    pub student_name: String,
    pub occurred_at: DateTime<Utc>,
}

#[derive(Debug, Clone)]
pub struct ResolvedAccessLinkEntry {
    pub schedule_id: String,
    pub provider_key: String,
    pub access_mode: AccessLinkMode,
    pub audience_type: AccessLinkAudienceType,
}

#[derive(Debug, FromRow)]
struct AccessLinkRow {
    id: String,
    exam_id: String,
    exam_title: String,
    provider_key: String,
    published_version_id: String,
    version_number: i32,
    schedule_id: String,
    name: String,
    audience_type: String,
    audience_label: Option<String>,
    access_mode: String,
    availability_type: String,
    opens_at: Option<DateTime<Utc>>,
    closes_at: Option<DateTime<Utc>>,
    lifecycle_state: String,
    revision: i32,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    selected_student_count: i64,
    registered_count: i64,
    started_count: i64,
    submitted_count: i64,
    is_current_release: bool,
    has_participation: bool,
}

#[derive(Debug, FromRow)]
struct LinkLockRow {
    schedule_id: String,
    lifecycle_state: String,
    revision: i32,
}

#[derive(Debug, FromRow)]
struct DuplicateSourceRow {
    exam_id: String,
    published_version_id: String,
    name: String,
    audience_type: String,
    audience_label: Option<String>,
    access_mode: String,
    availability_type: String,
    opens_at: Option<DateTime<Utc>>,
    closes_at: Option<DateTime<Utc>>,
    revision: i32,
}

#[derive(Debug, FromRow)]
struct ActivityRow {
    kind: String,
    student_name: String,
    occurred_at: DateTime<Utc>,
}

pub struct AssessmentAccessLinkService {
    pool: MySqlPool,
}

impl AssessmentAccessLinkService {
    pub fn new(pool: MySqlPool) -> Self {
        Self { pool }
    }

    pub async fn overview(
        &self,
        exam_id: &str,
    ) -> Result<AccessDistributionOverview, AssessmentAccessLinkError> {
        let current_published_version = sqlx::query_as::<_, PublishedAccessVersionSummary>(
            r#"
            SELECT v.id, v.version_number, v.revision, v.publish_notes, v.created_at
            FROM exam_entities e
            JOIN exam_versions v ON v.id = e.current_published_version_id
            WHERE e.id = ? AND v.is_published = TRUE
            "#,
        )
        .bind(exam_id)
        .fetch_optional(&self.pool)
        .await?;
        let links = self.list_for_exam(exam_id).await?;
        Ok(AccessDistributionOverview {
            current_published_version,
            links,
        })
    }

    pub async fn list_for_exam(
        &self,
        exam_id: &str,
    ) -> Result<Vec<AssessmentAccessLink>, AssessmentAccessLinkError> {
        let rows = sqlx::query_as::<_, AccessLinkRow>(&format!(
            "{} WHERE l.exam_id = ? ORDER BY l.updated_at DESC, l.id",
            link_select_sql()
        ))
        .bind(exam_id)
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter().map(link_from_row).collect()
    }

    pub async fn get(
        &self,
        link_id: &str,
    ) -> Result<AssessmentAccessLink, AssessmentAccessLinkError> {
        let row =
            sqlx::query_as::<_, AccessLinkRow>(&format!("{} WHERE l.id = ?", link_select_sql()))
                .bind(link_id)
                .fetch_optional(&self.pool)
                .await?
                .ok_or(AssessmentAccessLinkError::NotFound)?;
        link_from_row(row)
    }

    pub async fn public_link(
        &self,
        link_id: &str,
    ) -> Result<PublicAssessmentAccessLink, AssessmentAccessLinkError> {
        let link = self.get(link_id).await?;
        Ok(PublicAssessmentAccessLink {
            id: link.id,
            exam_title: link.exam_title,
            provider_key: link.provider_key,
            version_number: link.version_number,
            name: link.name,
            audience_type: link.audience_type,
            audience_label: link.audience_label,
            access_mode: link.access_mode,
            availability_type: link.availability_type,
            opens_at: link.opens_at,
            closes_at: link.closes_at,
            status: link.status,
        })
    }

    pub async fn create(
        &self,
        ctx: &ActorContext,
        exam_id: &str,
        request: CreateAssessmentAccessLinkRequest,
    ) -> Result<AssessmentAccessLink, AssessmentAccessLinkError> {
        validate_request_fields(
            &request.name,
            request.audience_type,
            request.audience_label.as_deref(),
            request.access_mode,
            request.availability_type,
            request.opens_at,
            request.closes_at,
            &request.selected_students,
        )?;
        let now = Utc::now();
        let (schedule_start, schedule_end) = backing_schedule_window(
            request.availability_type,
            request.opens_at,
            request.closes_at,
            now,
        )?;
        let name = normalize_name(&request.name)?;
        let audience_label = normalize_optional_label(request.audience_label.as_deref())?;
        let cohort_name = audience_label.clone().unwrap_or_else(|| name.clone());
        let normalized_members = normalize_members(&request.selected_students)?;
        let link_id = Uuid::new_v4().to_string();

        let mut tx = self.pool.begin().await?;
        let published_version_id =
            resolve_published_version_tx(&mut tx, exam_id, request.published_version_id.as_deref())
                .await?;
        let scheduling = SchedulingService::new(self.pool.clone());
        let schedule = scheduling
            .create_schedule_in_transaction(
                ctx,
                CreateScheduleRequest {
                    exam_id: exam_id.to_owned(),
                    published_version_id: published_version_id.clone(),
                    cohort_name,
                    proctor_display_name: "Proctor".to_owned(),
                    grading_display_name: "Grading Team".to_owned(),
                    institution: None,
                    start_time: schedule_start,
                    end_time: schedule_end,
                    auto_start: false,
                    auto_stop: false,
                },
                &mut tx,
            )
            .await?;

        sqlx::query(
            r#"
            INSERT INTO assessment_access_links (
                id, exam_id, published_version_id, schedule_id, name, audience_type,
                audience_label, access_mode, availability_type, opens_at, closes_at,
                lifecycle_state, created_by, revision
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, 0)
            "#,
        )
        .bind(&link_id)
        .bind(exam_id)
        .bind(&published_version_id)
        .bind(&schedule.id)
        .bind(&name)
        .bind(request.audience_type.as_str())
        .bind(&audience_label)
        .bind(request.access_mode.as_str())
        .bind(request.availability_type.as_str())
        .bind(request.opens_at)
        .bind(request.closes_at)
        .bind(ctx.actor_id.to_string())
        .execute(&mut *tx)
        .await?;
        replace_members_tx(&mut tx, &link_id, &normalized_members).await?;
        tx.commit().await?;
        self.get(&link_id).await
    }

    pub async fn update(
        &self,
        link_id: &str,
        request: UpdateAssessmentAccessLinkRequest,
    ) -> Result<AssessmentAccessLink, AssessmentAccessLinkError> {
        let mut tx = self.pool.begin().await?;
        let current = lock_link_tx(&mut tx, link_id).await?;
        if current.revision != request.revision {
            return Err(AssessmentAccessLinkError::Conflict(
                "Student Link changed while you were editing it. Refresh and try again.".to_owned(),
            ));
        }
        if AccessLinkLifecycleState::parse(&current.lifecycle_state)?
            == AccessLinkLifecycleState::Revoked
        {
            return Err(AssessmentAccessLinkError::Conflict(
                "Revoked Student Links are immutable. Duplicate it to create a new link."
                    .to_owned(),
            ));
        }
        let existing_members = if request.selected_students.is_none() {
            list_members_tx(&mut tx, link_id).await?
        } else {
            Vec::new()
        };
        let member_inputs = request
            .selected_students
            .as_deref()
            .unwrap_or(&existing_members);
        validate_request_fields(
            &request.name,
            request.audience_type,
            request.audience_label.as_deref(),
            request.access_mode,
            request.availability_type,
            request.opens_at,
            request.closes_at,
            member_inputs,
        )?;
        let normalized_members = normalize_members(member_inputs)?;
        let name = normalize_name(&request.name)?;
        let audience_label = normalize_optional_label(request.audience_label.as_deref())?;
        let (schedule_start, schedule_end) = backing_schedule_window(
            request.availability_type,
            request.opens_at,
            request.closes_at,
            Utc::now(),
        )?;
        validate_window_for_existing_schedule_tx(
            &mut tx,
            &current.schedule_id,
            schedule_start,
            schedule_end,
        )
        .await?;
        let cohort_name = audience_label.clone().unwrap_or_else(|| name.clone());
        sqlx::query(
            "UPDATE exam_schedules SET cohort_name = ?, start_time = ?, end_time = ?, updated_at = NOW(), revision = revision + 1 WHERE id = ?",
        )
        .bind(cohort_name)
        .bind(schedule_start)
        .bind(schedule_end)
        .bind(&current.schedule_id)
        .execute(&mut *tx)
        .await?;

        let result = sqlx::query(
            r#"
            UPDATE assessment_access_links
            SET name = ?, audience_type = ?, audience_label = ?, access_mode = ?,
                availability_type = ?, opens_at = ?, closes_at = ?, revision = revision + 1,
                updated_at = CURRENT_TIMESTAMP(6)
            WHERE id = ? AND revision = ?
            "#,
        )
        .bind(name)
        .bind(request.audience_type.as_str())
        .bind(audience_label)
        .bind(request.access_mode.as_str())
        .bind(request.availability_type.as_str())
        .bind(request.opens_at)
        .bind(request.closes_at)
        .bind(link_id)
        .bind(request.revision)
        .execute(&mut *tx)
        .await?;
        if result.rows_affected() != 1 {
            return Err(AssessmentAccessLinkError::Conflict(
                "Student Link changed while you were editing it.".to_owned(),
            ));
        }
        if request.selected_students.is_some()
            || request.audience_type == AccessLinkAudienceType::SelectedStudents
        {
            replace_members_tx(&mut tx, link_id, &normalized_members).await?;
        } else if request.audience_type != AccessLinkAudienceType::SelectedStudents {
            replace_members_tx(&mut tx, link_id, &[]).await?;
        }
        tx.commit().await?;
        self.get(link_id).await
    }

    pub async fn set_lifecycle(
        &self,
        link_id: &str,
        request: SetAccessLinkLifecycleRequest,
    ) -> Result<AssessmentAccessLink, AssessmentAccessLinkError> {
        let mut tx = self.pool.begin().await?;
        let current = lock_link_tx(&mut tx, link_id).await?;
        if current.revision != request.revision {
            return Err(AssessmentAccessLinkError::Conflict(
                "Student Link changed while you were editing it. Refresh and try again.".to_owned(),
            ));
        }
        let current_state = AccessLinkLifecycleState::parse(&current.lifecycle_state)?;
        if current_state == AccessLinkLifecycleState::Revoked && request.state != current_state {
            return Err(AssessmentAccessLinkError::Conflict(
                "A revoked Student Link cannot be reactivated.".to_owned(),
            ));
        }
        let result = sqlx::query(
            "UPDATE assessment_access_links SET lifecycle_state = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP(6) WHERE id = ? AND revision = ?",
        )
        .bind(request.state.as_str())
        .bind(link_id)
        .bind(request.revision)
        .execute(&mut *tx)
        .await?;
        if result.rows_affected() != 1 {
            return Err(AssessmentAccessLinkError::Conflict(
                "Student Link changed while you were editing it.".to_owned(),
            ));
        }
        tx.commit().await?;
        self.get(link_id).await
    }

    pub async fn duplicate(
        &self,
        ctx: &ActorContext,
        link_id: &str,
        request: DuplicateAssessmentAccessLinkRequest,
    ) -> Result<AssessmentAccessLink, AssessmentAccessLinkError> {
        let mut tx = self.pool.begin().await?;
        let source = sqlx::query_as::<_, DuplicateSourceRow>(
            r#"
            SELECT exam_id, published_version_id, name, audience_type, audience_label,
                   access_mode, availability_type, opens_at, closes_at, revision
            FROM assessment_access_links
            WHERE id = ?
            FOR UPDATE
            "#,
        )
        .bind(link_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or(AssessmentAccessLinkError::NotFound)?;
        if source.revision != request.revision {
            return Err(AssessmentAccessLinkError::Conflict(
                "Student Link changed before it could be duplicated. Refresh and try again."
                    .to_owned(),
            ));
        }

        let audience_type = AccessLinkAudienceType::parse(&source.audience_type)?;
        let access_mode = AccessLinkMode::parse(&source.access_mode)?;
        let source_availability = AccessLinkAvailabilityType::parse(&source.availability_type)?;
        let availability_type = request.availability_type.unwrap_or(source_availability);
        let name = request
            .name
            .unwrap_or_else(|| format!("{} Copy", source.name));
        let (opens_at, closes_at) = match availability_type {
            AccessLinkAvailabilityType::Scheduled => (
                request.opens_at.or(source.opens_at),
                request.closes_at.or(source.closes_at),
            ),
            AccessLinkAvailabilityType::Anytime => (None, None),
        };
        let members = list_members_tx(&mut tx, link_id).await?;
        validate_request_fields(
            &name,
            audience_type,
            source.audience_label.as_deref(),
            access_mode,
            availability_type,
            opens_at,
            closes_at,
            &members,
        )?;
        let normalized_name = normalize_name(&name)?;
        let audience_label = normalize_optional_label(source.audience_label.as_deref())?;
        let normalized_members = normalize_members(&members)?;
        let (schedule_start, schedule_end) =
            backing_schedule_window(availability_type, opens_at, closes_at, Utc::now())?;
        let requested_version_id = match request.release_target {
            DuplicateReleaseTarget::Source => Some(source.published_version_id.as_str()),
            DuplicateReleaseTarget::Current => None,
        };
        let published_version_id =
            resolve_published_version_tx(&mut tx, &source.exam_id, requested_version_id).await?;
        let cohort_name = audience_label
            .clone()
            .unwrap_or_else(|| normalized_name.clone());
        let scheduling = SchedulingService::new(self.pool.clone());
        let schedule = scheduling
            .create_schedule_in_transaction(
                ctx,
                CreateScheduleRequest {
                    exam_id: source.exam_id.clone(),
                    published_version_id: published_version_id.clone(),
                    cohort_name,
                    proctor_display_name: "Proctor".to_owned(),
                    grading_display_name: "Grading Team".to_owned(),
                    institution: None,
                    start_time: schedule_start,
                    end_time: schedule_end,
                    auto_start: false,
                    auto_stop: false,
                },
                &mut tx,
            )
            .await?;

        let new_link_id = Uuid::new_v4().to_string();
        sqlx::query(
            r#"
            INSERT INTO assessment_access_links (
                id, exam_id, published_version_id, schedule_id, name, audience_type,
                audience_label, access_mode, availability_type, opens_at, closes_at,
                lifecycle_state, created_by, revision
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, 0)
            "#,
        )
        .bind(&new_link_id)
        .bind(&source.exam_id)
        .bind(&published_version_id)
        .bind(&schedule.id)
        .bind(&normalized_name)
        .bind(audience_type.as_str())
        .bind(&audience_label)
        .bind(access_mode.as_str())
        .bind(availability_type.as_str())
        .bind(opens_at)
        .bind(closes_at)
        .bind(ctx.actor_id.to_string())
        .execute(&mut *tx)
        .await?;
        replace_members_tx(&mut tx, &new_link_id, &normalized_members).await?;
        tx.commit().await?;
        self.get(&new_link_id).await
    }

    pub async fn list_members(
        &self,
        link_id: &str,
    ) -> Result<Vec<AccessLinkMember>, AssessmentAccessLinkError> {
        let mut tx = self.pool.begin().await?;
        let _ = lock_link_tx(&mut tx, link_id).await?;
        let members = list_members_tx(&mut tx, link_id).await?;
        tx.commit().await?;
        Ok(members
            .into_iter()
            .map(|input| AccessLinkMember {
                student_code: input.student_code,
                student_name: input.student_name,
                student_email: input.student_email,
            })
            .collect())
    }

    pub async fn activity(
        &self,
        link_id: &str,
    ) -> Result<Vec<AccessLinkActivity>, AssessmentAccessLinkError> {
        let link = self.get(link_id).await?;
        let rows = sqlx::query_as::<_, ActivityRow>(
            r#"
            SELECT kind, student_name, occurred_at
            FROM (
                SELECT 'joined' AS kind, student_name, created_at AS occurred_at
                FROM schedule_registrations WHERE schedule_id = ?
                UNION ALL
                SELECT 'started' AS kind, candidate_name AS student_name, created_at AS occurred_at
                FROM student_attempts WHERE schedule_id = ?
                UNION ALL
                SELECT 'submitted' AS kind, candidate_name AS student_name, submitted_at AS occurred_at
                FROM student_attempts WHERE schedule_id = ? AND submitted_at IS NOT NULL
            ) activity
            ORDER BY occurred_at DESC
            LIMIT 50
            "#,
        )
        .bind(&link.schedule_id)
        .bind(&link.schedule_id)
        .bind(&link.schedule_id)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|row| AccessLinkActivity {
                kind: row.kind,
                student_name: row.student_name,
                occurred_at: row.occurred_at,
            })
            .collect())
    }

    pub async fn resolve_entry(
        &self,
        link_id: &str,
        student_code: Option<&str>,
        student_name: &str,
        student_email: &str,
    ) -> Result<ResolvedAccessLinkEntry, AssessmentAccessLinkError> {
        let link = self.get(link_id).await?;
        match link.status {
            AccessLinkStatus::Live => {}
            AccessLinkStatus::Upcoming => {
                return Err(AssessmentAccessLinkError::Unavailable(
                    "This Student Link is not open yet.".to_owned(),
                ))
            }
            AccessLinkStatus::Ended => {
                return Err(AssessmentAccessLinkError::Unavailable(
                    "This Student Link has ended.".to_owned(),
                ))
            }
            AccessLinkStatus::Paused => {
                return Err(AssessmentAccessLinkError::Unavailable(
                    "This Student Link is paused.".to_owned(),
                ))
            }
            AccessLinkStatus::Revoked => {
                return Err(AssessmentAccessLinkError::Unavailable(
                    "This Student Link has been revoked.".to_owned(),
                ))
            }
        }
        if link.audience_type == AccessLinkAudienceType::SelectedStudents {
            let code = student_code
                .map(ielts_backend_domain::schedule::normalize_access_code)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| {
                    AssessmentAccessLinkError::Unavailable(
                        "A student code is required for this Student Link.".to_owned(),
                    )
                })?;
            let (expected_name, expected_email) = sqlx::query_as::<_, (Option<String>, Option<String>)>(
                "SELECT student_name, student_email FROM assessment_access_link_members WHERE link_id = ? AND student_code = ? LIMIT 1",
            )
            .bind(link_id)
            .bind(code)
            .fetch_optional(&self.pool)
            .await?
            .ok_or_else(|| {
                AssessmentAccessLinkError::Unavailable(
                    "This student code is not included in this Student Link.".to_owned(),
                )
            })?;
            validate_selected_student_identity(
                expected_name.as_deref(),
                expected_email.as_deref(),
                student_name,
                student_email,
            )?;
        }
        Ok(ResolvedAccessLinkEntry {
            schedule_id: link.schedule_id,
            provider_key: link.provider_key,
            access_mode: link.access_mode,
            audience_type: link.audience_type,
        })
    }
}

fn link_select_sql() -> &'static str {
    r#"
    SELECT
        l.id, l.exam_id, e.title AS exam_title, e.provider_key,
        l.published_version_id, v.version_number, l.schedule_id, l.name,
        l.audience_type, l.audience_label, l.access_mode, l.availability_type,
        l.opens_at, l.closes_at, l.lifecycle_state, l.revision, l.created_at, l.updated_at,
        (SELECT COUNT(*) FROM assessment_access_link_members m WHERE m.link_id = l.id) AS selected_student_count,
        (SELECT COUNT(*) FROM schedule_registrations r WHERE r.schedule_id = l.schedule_id) AS registered_count,
        (SELECT COUNT(*) FROM student_attempts a WHERE a.schedule_id = l.schedule_id) AS started_count,
        (SELECT COUNT(*) FROM student_attempts a WHERE a.schedule_id = l.schedule_id AND a.submitted_at IS NOT NULL) AS submitted_count,
        (l.published_version_id = e.current_published_version_id) AS is_current_release,
        (EXISTS(SELECT 1 FROM schedule_registrations r WHERE r.schedule_id = l.schedule_id LIMIT 1)
          OR EXISTS(SELECT 1 FROM student_attempts a WHERE a.schedule_id = l.schedule_id LIMIT 1)) AS has_participation
    FROM assessment_access_links l
    JOIN exam_entities e ON e.id = l.exam_id
    JOIN exam_versions v ON v.id = l.published_version_id
    "#
}

fn link_from_row(row: AccessLinkRow) -> Result<AssessmentAccessLink, AssessmentAccessLinkError> {
    let lifecycle_state = AccessLinkLifecycleState::parse(&row.lifecycle_state)?;
    let availability_type = AccessLinkAvailabilityType::parse(&row.availability_type)?;
    let status = derive_status(
        lifecycle_state,
        availability_type,
        row.opens_at,
        row.closes_at,
        Utc::now(),
    );
    Ok(AssessmentAccessLink {
        id: row.id,
        exam_id: row.exam_id,
        exam_title: row.exam_title,
        provider_key: row.provider_key,
        published_version_id: row.published_version_id,
        version_number: row.version_number,
        schedule_id: row.schedule_id,
        name: row.name,
        audience_type: AccessLinkAudienceType::parse(&row.audience_type)?,
        audience_label: row.audience_label,
        access_mode: AccessLinkMode::parse(&row.access_mode)?,
        availability_type,
        opens_at: row.opens_at,
        closes_at: row.closes_at,
        lifecycle_state,
        status,
        selected_student_count: row.selected_student_count,
        metrics: AccessLinkMetrics {
            registered: row.registered_count,
            started: row.started_count,
            submitted: row.submitted_count,
        },
        is_current_release: row.is_current_release,
        has_participation: row.has_participation,
        revision: row.revision,
        created_at: row.created_at,
        updated_at: row.updated_at,
    })
}

fn derive_status(
    lifecycle: AccessLinkLifecycleState,
    availability: AccessLinkAvailabilityType,
    opens_at: Option<DateTime<Utc>>,
    closes_at: Option<DateTime<Utc>>,
    now: DateTime<Utc>,
) -> AccessLinkStatus {
    match lifecycle {
        AccessLinkLifecycleState::Revoked => return AccessLinkStatus::Revoked,
        AccessLinkLifecycleState::Paused => return AccessLinkStatus::Paused,
        AccessLinkLifecycleState::Active => {}
    }
    if availability == AccessLinkAvailabilityType::Anytime {
        return AccessLinkStatus::Live;
    }
    if opens_at.is_some_and(|opens| now < opens) {
        return AccessLinkStatus::Upcoming;
    }
    if closes_at.is_some_and(|closes| now >= closes) {
        return AccessLinkStatus::Ended;
    }
    AccessLinkStatus::Live
}

fn normalize_name(value: &str) -> Result<String, AssessmentAccessLinkError> {
    let value = value.trim();
    if value.is_empty() {
        return Err(AssessmentAccessLinkError::Validation(
            "Student Link name is required.".to_owned(),
        ));
    }
    if value.chars().count() > MAX_LINK_NAME_CHARS {
        return Err(AssessmentAccessLinkError::Validation(format!(
            "Student Link name must be {MAX_LINK_NAME_CHARS} characters or fewer."
        )));
    }
    Ok(value.to_owned())
}

fn normalize_optional_label(
    value: Option<&str>,
) -> Result<Option<String>, AssessmentAccessLinkError> {
    let Some(value) = value else { return Ok(None) };
    let value = value.trim();
    if value.is_empty() {
        return Ok(None);
    }
    if value.chars().count() > MAX_AUDIENCE_LABEL_CHARS {
        return Err(AssessmentAccessLinkError::Validation(format!(
            "Audience name must be {MAX_AUDIENCE_LABEL_CHARS} characters or fewer."
        )));
    }
    Ok(Some(value.to_owned()))
}

fn normalize_members(
    members: &[AccessLinkMemberInput],
) -> Result<Vec<AccessLinkMemberInput>, AssessmentAccessLinkError> {
    if members.len() > MAX_SELECTED_STUDENTS {
        return Err(AssessmentAccessLinkError::Validation(format!(
            "A Student Link can include at most {MAX_SELECTED_STUDENTS} selected students."
        )));
    }
    let mut seen = HashSet::with_capacity(members.len());
    let mut normalized = Vec::with_capacity(members.len());
    for member in members {
        let code = ielts_backend_domain::schedule::normalize_access_code(&member.student_code);
        if code.is_empty() {
            return Err(AssessmentAccessLinkError::Validation(
                "Every selected student needs a student code.".to_owned(),
            ));
        }
        let dedupe_key = code.to_ascii_lowercase();
        if !seen.insert(dedupe_key) {
            return Err(AssessmentAccessLinkError::Validation(format!(
                "Student code {code} appears more than once."
            )));
        }
        normalized.push(AccessLinkMemberInput {
            student_code: code,
            student_name: member
                .student_name
                .as_deref()
                .map(str::trim)
                .filter(|v| !v.is_empty())
                .map(ToOwned::to_owned),
            student_email: member
                .student_email
                .as_deref()
                .map(str::trim)
                .filter(|v| !v.is_empty())
                .map(ToOwned::to_owned),
        });
    }
    Ok(normalized)
}

fn validate_request_fields(
    name: &str,
    audience_type: AccessLinkAudienceType,
    audience_label: Option<&str>,
    access_mode: AccessLinkMode,
    availability_type: AccessLinkAvailabilityType,
    opens_at: Option<DateTime<Utc>>,
    closes_at: Option<DateTime<Utc>>,
    selected_students: &[AccessLinkMemberInput],
) -> Result<(), AssessmentAccessLinkError> {
    normalize_name(name)?;
    let label = normalize_optional_label(audience_label)?;
    if audience_type != AccessLinkAudienceType::Anyone && label.is_none() {
        return Err(AssessmentAccessLinkError::Validation(
            "An audience name is required for cohort and selected-student links.".to_owned(),
        ));
    }
    if audience_type == AccessLinkAudienceType::SelectedStudents {
        if access_mode != AccessLinkMode::StudentCode {
            return Err(AssessmentAccessLinkError::Validation(
                "Selected-student links must require a student code.".to_owned(),
            ));
        }
        if selected_students.is_empty() {
            return Err(AssessmentAccessLinkError::Validation(
                "Add at least one selected student.".to_owned(),
            ));
        }
    }
    normalize_members(selected_students)?;
    match availability_type {
        AccessLinkAvailabilityType::Anytime => Ok(()),
        AccessLinkAvailabilityType::Scheduled => match (opens_at, closes_at) {
            (Some(opens), Some(closes)) if closes > opens => Ok(()),
            (Some(_), Some(_)) => Err(AssessmentAccessLinkError::Validation(
                "Closing time must be after opening time.".to_owned(),
            )),
            _ => Err(AssessmentAccessLinkError::Validation(
                "Scheduled Student Links need both an opening and closing time.".to_owned(),
            )),
        },
    }
}

fn backing_schedule_window(
    availability_type: AccessLinkAvailabilityType,
    opens_at: Option<DateTime<Utc>>,
    closes_at: Option<DateTime<Utc>>,
    now: DateTime<Utc>,
) -> Result<(DateTime<Utc>, DateTime<Utc>), AssessmentAccessLinkError> {
    match availability_type {
        AccessLinkAvailabilityType::Anytime => Ok((
            now - Duration::minutes(1),
            now + Duration::days(ANYTIME_BACKING_HORIZON_DAYS),
        )),
        AccessLinkAvailabilityType::Scheduled => match (opens_at, closes_at) {
            (Some(opens), Some(closes)) if closes > opens => Ok((opens, closes)),
            (Some(_), Some(_)) => Err(AssessmentAccessLinkError::Validation(
                "Closing time must be after opening time.".to_owned(),
            )),
            _ => Err(AssessmentAccessLinkError::Validation(
                "Scheduled Student Links need both an opening and closing time.".to_owned(),
            )),
        },
    }
}

fn validate_selected_student_identity(
    expected_name: Option<&str>,
    expected_email: Option<&str>,
    actual_name: &str,
    actual_email: &str,
) -> Result<(), AssessmentAccessLinkError> {
    if expected_name
        .is_some_and(|expected| !expected.trim().eq_ignore_ascii_case(actual_name.trim()))
    {
        return Err(AssessmentAccessLinkError::Unavailable(
            "The entered student name does not match this Student Link.".to_owned(),
        ));
    }
    if expected_email
        .is_some_and(|expected| !expected.trim().eq_ignore_ascii_case(actual_email.trim()))
    {
        return Err(AssessmentAccessLinkError::Unavailable(
            "The entered email does not match this Student Link.".to_owned(),
        ));
    }
    Ok(())
}

async fn resolve_published_version_tx(
    tx: &mut Transaction<'_, MySql>,
    exam_id: &str,
    requested_version_id: Option<&str>,
) -> Result<String, AssessmentAccessLinkError> {
    let version_id = if let Some(version_id) = requested_version_id {
        version_id.to_owned()
    } else {
        sqlx::query_scalar::<_, Option<String>>(
            "SELECT current_published_version_id FROM exam_entities WHERE id = ? FOR UPDATE",
        )
        .bind(exam_id)
        .fetch_optional(&mut **tx)
        .await?
        .ok_or(AssessmentAccessLinkError::NotFound)?
        .ok_or_else(|| {
            AssessmentAccessLinkError::Validation(
                "Publish the exam before creating Student Access.".to_owned(),
            )
        })?
    };

    let published: Option<bool> =
        sqlx::query_scalar("SELECT is_published FROM exam_versions WHERE id = ? AND exam_id = ?")
            .bind(&version_id)
            .bind(exam_id)
            .fetch_optional(&mut **tx)
            .await?;
    match published {
        Some(true) => Ok(version_id),
        Some(false) => Err(AssessmentAccessLinkError::Validation(
            "Student Access can only target an immutable published version.".to_owned(),
        )),
        None => Err(AssessmentAccessLinkError::NotFound),
    }
}

async fn validate_window_for_existing_schedule_tx(
    tx: &mut Transaction<'_, MySql>,
    schedule_id: &str,
    start: DateTime<Utc>,
    end: DateTime<Utc>,
) -> Result<(), AssessmentAccessLinkError> {
    let planned: i32 = sqlx::query_scalar(
        "SELECT planned_duration_minutes FROM exam_schedules WHERE id = ? FOR UPDATE",
    )
    .bind(schedule_id)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or(AssessmentAccessLinkError::NotFound)?;
    if end <= start || (end - start).num_minutes() < i64::from(planned) {
        return Err(AssessmentAccessLinkError::Validation(format!(
            "Student Link availability must allow at least {planned} minutes for the exam."
        )));
    }
    Ok(())
}

async fn lock_link_tx(
    tx: &mut Transaction<'_, MySql>,
    link_id: &str,
) -> Result<LinkLockRow, AssessmentAccessLinkError> {
    sqlx::query_as::<_, LinkLockRow>(
        r#"
        SELECT schedule_id, lifecycle_state, revision
        FROM assessment_access_links WHERE id = ? FOR UPDATE
        "#,
    )
    .bind(link_id)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or(AssessmentAccessLinkError::NotFound)
}

async fn replace_members_tx(
    tx: &mut Transaction<'_, MySql>,
    link_id: &str,
    members: &[AccessLinkMemberInput],
) -> Result<(), AssessmentAccessLinkError> {
    sqlx::query("DELETE FROM assessment_access_link_members WHERE link_id = ?")
        .bind(link_id)
        .execute(&mut **tx)
        .await?;
    for member in members {
        sqlx::query(
            "INSERT INTO assessment_access_link_members (link_id, student_code, student_name, student_email) VALUES (?, ?, ?, ?)",
        )
        .bind(link_id)
        .bind(&member.student_code)
        .bind(&member.student_name)
        .bind(&member.student_email)
        .execute(&mut **tx)
        .await?;
    }
    Ok(())
}

async fn list_members_tx(
    tx: &mut Transaction<'_, MySql>,
    link_id: &str,
) -> Result<Vec<AccessLinkMemberInput>, AssessmentAccessLinkError> {
    let rows = sqlx::query_as::<_, (String, Option<String>, Option<String>)>(
        "SELECT student_code, student_name, student_email FROM assessment_access_link_members WHERE link_id = ? ORDER BY student_code",
    )
    .bind(link_id)
    .fetch_all(&mut **tx)
    .await?;
    Ok(rows
        .into_iter()
        .map(
            |(student_code, student_name, student_email)| AccessLinkMemberInput {
                student_code,
                student_name,
                student_email,
            },
        )
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn status_is_derived_from_lifecycle_before_time_window() {
        let now = Utc.with_ymd_and_hms(2026, 8, 28, 12, 0, 0).unwrap();
        assert_eq!(
            derive_status(
                AccessLinkLifecycleState::Paused,
                AccessLinkAvailabilityType::Anytime,
                None,
                None,
                now,
            ),
            AccessLinkStatus::Paused
        );
        assert_eq!(
            derive_status(
                AccessLinkLifecycleState::Revoked,
                AccessLinkAvailabilityType::Scheduled,
                Some(now - Duration::hours(1)),
                Some(now + Duration::hours(1)),
                now,
            ),
            AccessLinkStatus::Revoked
        );
    }

    #[test]
    fn scheduled_status_transitions_are_boundary_safe() {
        let now = Utc.with_ymd_and_hms(2026, 8, 28, 12, 0, 0).unwrap();
        assert_eq!(
            derive_status(
                AccessLinkLifecycleState::Active,
                AccessLinkAvailabilityType::Scheduled,
                Some(now + Duration::seconds(1)),
                Some(now + Duration::hours(3)),
                now,
            ),
            AccessLinkStatus::Upcoming
        );
        assert_eq!(
            derive_status(
                AccessLinkLifecycleState::Active,
                AccessLinkAvailabilityType::Scheduled,
                Some(now - Duration::hours(1)),
                Some(now + Duration::hours(1)),
                now,
            ),
            AccessLinkStatus::Live
        );
        assert_eq!(
            derive_status(
                AccessLinkLifecycleState::Active,
                AccessLinkAvailabilityType::Scheduled,
                Some(now - Duration::hours(3)),
                Some(now),
                now,
            ),
            AccessLinkStatus::Ended
        );
    }

    #[test]
    fn selected_student_identity_locks_only_fields_that_are_configured() {
        assert!(validate_selected_student_identity(
            Some("Ada Student"),
            Some("ADA@example.com"),
            " ada student ",
            "ada@EXAMPLE.com",
        )
        .is_ok());
        assert!(
            validate_selected_student_identity(None, None, "Anyone", "any@example.com").is_ok()
        );
        assert!(validate_selected_student_identity(
            Some("Ada Student"),
            None,
            "Different Name",
            "ada@example.com",
        )
        .is_err());
        assert!(validate_selected_student_identity(
            None,
            Some("ada@example.com"),
            "Ada Student",
            "other@example.com",
        )
        .is_err());
    }

    #[test]
    fn selected_students_require_code_mode_and_unique_codes() {
        let members = vec![AccessLinkMemberInput {
            student_code: "W123456".to_owned(),
            student_name: None,
            student_email: None,
        }];
        assert!(validate_request_fields(
            "Class A",
            AccessLinkAudienceType::SelectedStudents,
            Some("Class A"),
            AccessLinkMode::Open,
            AccessLinkAvailabilityType::Anytime,
            None,
            None,
            &members,
        )
        .is_err());
        assert!(normalize_members(&[
            members[0].clone(),
            AccessLinkMemberInput {
                student_code: "w123456".to_owned(),
                student_name: None,
                student_email: None,
            },
        ])
        .is_err());
    }
    #[test]
    fn create_request_accepts_frontend_shape_without_version_id() {
        let request: CreateAssessmentAccessLinkRequest =
            serde_json::from_value(serde_json::json!({
                "name": "Saturday Class",
                "audienceType": "anyone",
                "audienceLabel": null,
                "accessMode": "student_code",
                "availabilityType": "anytime",
                "opensAt": null,
                "closesAt": null,
                "selectedStudents": []
            }))
            .expect("frontend create request");
        assert!(request.published_version_id.is_none());
    }

    #[test]
    fn duplicate_request_accepts_current_release_target_and_revision() {
        let request: DuplicateAssessmentAccessLinkRequest =
            serde_json::from_value(serde_json::json!({
                "revision": 3,
                "name": "Saturday Class",
                "releaseTarget": "current"
            }))
            .expect("frontend duplicate request");
        assert_eq!(request.revision, 3);
        assert_eq!(request.release_target, DuplicateReleaseTarget::Current);
    }
}
