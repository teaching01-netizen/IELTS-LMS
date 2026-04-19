use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

#[cfg(feature = "sqlx")]
use sqlx::FromRow;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "sqlx", derive(FromRow))]
#[serde(rename_all = "camelCase")]
pub struct GradingSession {
    pub id: String,
    pub schedule_id: String,
    pub exam_id: String,
    pub exam_title: String,
    pub published_version_id: String,
    pub cohort_name: String,
    pub institution: Option<String>,
    pub start_time: DateTime<Utc>,
    pub end_time: DateTime<Utc>,
    pub status: GradingSessionStatus,
    pub total_students: i32,
    pub submitted_count: i32,
    pub pending_manual_reviews: i32,
    pub in_progress_reviews: i32,
    pub finalized_reviews: i32,
    pub overdue_reviews: i32,
    pub assigned_teachers: Value,
    pub created_at: DateTime<Utc>,
    pub created_by: String,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, sqlx::Type)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "text", rename_all = "snake_case")]
pub enum GradingSessionStatus {
    Scheduled,
    Live,
    InProgress,
    Completed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, sqlx::Type)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "text", rename_all = "snake_case")]
pub enum SectionGradingStatus {
    Pending,
    AutoGraded,
    NeedsReview,
    InReview,
    Finalized,
    Reopened,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, sqlx::Type)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "text", rename_all = "snake_case")]
pub enum OverallGradingStatus {
    NotSubmitted,
    Submitted,
    InProgress,
    GradingComplete,
    ReadyToRelease,
    Released,
    Reopened,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, sqlx::Type)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "text", rename_all = "snake_case")]
pub enum ReleaseStatus {
    Draft,
    GradingComplete,
    ReadyToRelease,
    Released,
    Reopened,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "sqlx", derive(FromRow))]
#[serde(rename_all = "camelCase")]
pub struct StudentSubmission {
    pub id: String,
    pub attempt_id: String,
    pub schedule_id: String,
    pub exam_id: String,
    pub published_version_id: String,
    pub student_id: String,
    pub student_name: String,
    pub student_email: Option<String>,
    pub cohort_name: String,
    pub submitted_at: DateTime<Utc>,
    pub time_spent_seconds: i32,
    pub grading_status: OverallGradingStatus,
    pub assigned_teacher_id: Option<String>,
    pub assigned_teacher_name: Option<String>,
    pub is_flagged: bool,
    pub flag_reason: Option<String>,
    pub is_overdue: bool,
    pub due_date: Option<DateTime<Utc>>,
    pub section_statuses: Value,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "sqlx", derive(FromRow))]
#[serde(rename_all = "camelCase")]
pub struct SectionSubmission {
    pub id: String,
    pub submission_id: String,
    pub section: String,
    pub answers: Value,
    pub auto_grading_results: Option<Value>,
    pub grading_status: SectionGradingStatus,
    pub reviewed_by: Option<String>,
    pub reviewed_at: Option<DateTime<Utc>>,
    pub finalized_by: Option<String>,
    pub finalized_at: Option<DateTime<Utc>>,
    pub submitted_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "sqlx", derive(FromRow))]
#[serde(rename_all = "camelCase")]
pub struct WritingTaskSubmission {
    pub id: String,
    pub section_submission_id: String,
    pub submission_id: String,
    pub task_id: String,
    pub task_label: String,
    pub prompt: String,
    pub student_text: String,
    pub word_count: i32,
    pub rubric_assessment: Option<Value>,
    pub annotations: Value,
    pub overall_feedback: Option<String>,
    pub student_visible_notes: Option<String>,
    pub grading_status: SectionGradingStatus,
    pub submitted_at: DateTime<Utc>,
    pub graded_by: Option<String>,
    pub graded_at: Option<DateTime<Utc>>,
    pub finalized_by: Option<String>,
    pub finalized_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "sqlx", derive(FromRow))]
#[serde(rename_all = "camelCase")]
pub struct ReviewDraft {
    pub id: String,
    pub submission_id: String,
    pub student_id: String,
    pub teacher_id: String,
    pub release_status: ReleaseStatus,
    pub section_drafts: Value,
    pub annotations: Value,
    pub drawings: Value,
    pub overall_feedback: Option<String>,
    pub student_visible_notes: Option<String>,
    pub internal_notes: Option<String>,
    pub teacher_summary: Value,
    pub checklist: Value,
    pub has_unsaved_changes: bool,
    pub last_auto_save_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub revision: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, sqlx::Type)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "text", rename_all = "snake_case")]
pub enum ReviewAction {
    ReviewStarted,
    ReviewAssigned,
    DraftSaved,
    CommentAdded,
    CommentUpdated,
    RubricUpdated,
    ReviewFinalized,
    ReviewReopened,
    ScoreOverride,
    FeedbackUpdated,
    ReleaseNow,
    MarkReadyToRelease,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "sqlx", derive(FromRow))]
#[serde(rename_all = "camelCase")]
pub struct ReviewEvent {
    pub id: String,
    pub submission_id: String,
    pub teacher_id: String,
    pub teacher_name: String,
    pub action: ReviewAction,
    pub section: Option<String>,
    pub task_id: Option<String>,
    pub annotation_id: Option<String>,
    pub question_id: Option<String>,
    pub from_status: Option<String>,
    pub to_status: Option<String>,
    pub payload: Option<Value>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "sqlx", derive(FromRow))]
#[serde(rename_all = "camelCase")]
pub struct StudentResult {
    pub id: String,
    pub submission_id: String,
    pub student_id: String,
    pub student_name: String,
    pub release_status: ReleaseStatus,
    pub released_at: Option<DateTime<Utc>>,
    pub released_by: Option<String>,
    pub scheduled_release_date: Option<DateTime<Utc>>,
    pub overall_band: f64,
    pub section_bands: Value,
    pub listening_result: Option<Value>,
    pub reading_result: Option<Value>,
    pub writing_results: Value,
    pub speaking_result: Option<Value>,
    pub teacher_summary: Value,
    pub version: i32,
    pub previous_version_id: Option<String>,
    pub revision_reason: Option<String>,
    pub authorized_actor_id: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "sqlx", derive(FromRow))]
#[serde(rename_all = "camelCase")]
pub struct ReleaseEvent {
    pub id: String,
    pub result_id: String,
    pub submission_id: String,
    pub actor_id: String,
    pub action: String,
    pub payload: Option<Value>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, sqlx::Type)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "text", rename_all = "snake_case")]
pub enum MediaAssetStatus {
    Pending,
    Finalized,
    Orphaned,
    Deleted,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "sqlx", derive(FromRow))]
#[serde(rename_all = "camelCase")]
pub struct MediaAsset {
    pub id: String,
    pub owner_kind: String,
    pub owner_id: String,
    pub content_type: String,
    pub file_name: String,
    pub upload_status: MediaAssetStatus,
    pub object_key: String,
    pub size_bytes: Option<i64>,
    pub checksum_sha256: Option<String>,
    pub upload_url: String,
    pub download_url: Option<String>,
    pub delete_after_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadIntent {
    pub asset: MediaAsset,
    pub upload_url: String,
    pub headers: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GradingSessionDetail {
    pub session: GradingSession,
    pub submissions: Vec<StudentSubmission>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmissionReviewBundle {
    pub submission: StudentSubmission,
    pub sections: Vec<SectionSubmission>,
    pub writing_tasks: Vec<WritingTaskSubmission>,
    pub review_draft: Option<ReviewDraft>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResultsAnalytics {
    pub total_results: i64,
    pub released_results: i64,
    pub ready_to_release: i64,
    pub average_overall_band: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveReviewDraftRequest {
    pub teacher_id: String,
    pub release_status: Option<ReleaseStatus>,
    pub section_drafts: Value,
    pub annotations: Value,
    pub drawings: Value,
    pub overall_feedback: Option<String>,
    pub student_visible_notes: Option<String>,
    pub internal_notes: Option<String>,
    pub teacher_summary: Value,
    pub checklist: Value,
    pub has_unsaved_changes: bool,
    pub revision: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartReviewRequest {
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActorActionRequest {
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseNowRequest {
    pub revision_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleReleaseRequest {
    pub release_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadIntentRequest {
    pub owner_kind: String,
    pub owner_id: String,
    pub content_type: String,
    pub file_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompleteUploadRequest {
    pub size_bytes: Option<i64>,
    pub checksum_sha256: Option<String>,
}
