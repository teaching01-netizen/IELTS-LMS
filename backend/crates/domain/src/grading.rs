use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::HashSet, fmt};

#[cfg(feature = "sqlx")]
use sqlx::FromRow;

macro_rules! json_wrapper {
    ($name:ident) => {
        #[derive(Debug, Clone, Serialize, Deserialize, Default)]
        #[serde(transparent)]
        pub struct $name(pub Value);

        impl std::ops::Deref for $name {
            type Target = Value;

            fn deref(&self) -> &Self::Target {
                &self.0
            }
        }

        impl std::ops::DerefMut for $name {
            fn deref_mut(&mut self) -> &mut Self::Target {
                &mut self.0
            }
        }

        impl From<Value> for $name {
            fn from(value: Value) -> Self {
                Self(value)
            }
        }

        impl From<$name> for Value {
            fn from(value: $name) -> Self {
                value.0
            }
        }
    };
}

json_wrapper!(TeacherAssignments);
json_wrapper!(SubmissionSectionStatuses);
json_wrapper!(SectionAnswers);
json_wrapper!(SectionAutoGradingResults);
json_wrapper!(WritingRubricAssessment);
json_wrapper!(ReviewAnnotations);
json_wrapper!(ReviewSectionDrafts);
json_wrapper!(ReviewDrawings);
json_wrapper!(ReviewTeacherSummary);
json_wrapper!(ReviewChecklist);
json_wrapper!(ResultSectionBands);
json_wrapper!(ResultListeningSection);
json_wrapper!(ResultReadingSection);
json_wrapper!(ResultWritingSections);
json_wrapper!(ResultSpeakingSection);

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
    pub assigned_teachers: TeacherAssignments,
    pub created_at: DateTime<Utc>,
    pub created_by: String,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GradingSessionStatus {
    Scheduled,
    Live,
    InProgress,
    Completed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SectionGradingStatus {
    Pending,
    AutoGraded,
    NeedsReview,
    InReview,
    Finalized,
    Reopened,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum OverallGradingStatus {
    NotSubmitted,
    Submitted,
    InProgress,
    GradingComplete,
    ReadyToRelease,
    Released,
    Reopened,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ReleaseStatus {
    Draft,
    GradingComplete,
    ReadyToRelease,
    Released,
    Reopened,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ObjectiveVerificationStatus {
    VerifiedCorrect,
    VerifiedIncorrect,
    VerifiedUnanswered,
    NeedsRecheck,
    Invalid,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum ObjectiveIntegrityIssueCode {
    MissingAnswerKey,
    InvalidAnswerKey,
    AnswerKeyViolatesScoringRule,
    UnsupportedQuestionType,
    DuplicateQuestionId,
    UnknownStudentAnswerId,
    AnswerPayloadTypeInvalid,
    SectionMappingUnavailable,
    SectionMappingAmbiguous,
    SubmissionMergeIncomplete,
    GradingSourceStale,
    ManualOverrideStale,
}

impl ObjectiveIntegrityIssueCode {
    pub const fn is_invalid(self) -> bool {
        matches!(
            self,
            Self::InvalidAnswerKey
                | Self::AnswerKeyViolatesScoringRule
                | Self::UnsupportedQuestionType
                | Self::DuplicateQuestionId
        )
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ObjectiveIntegrityStatus {
    Verified,
    NeedsRecheck,
    Invalid,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectiveQuestionAudit {
    pub question_id: String,
    pub section: String,
    pub status: ObjectiveVerificationStatus,
    pub student_answer: Option<Value>,
    pub accepted_answers: Vec<String>,
    pub awarded_score: Option<f64>,
    pub max_score: f64,
    pub issue_code: Option<ObjectiveIntegrityIssueCode>,
    pub issue_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectiveGradingAudit {
    pub section: String,
    pub expected_question_count: u32,
    pub verified_correct_count: u32,
    pub verified_incorrect_count: u32,
    pub verified_unanswered_count: u32,
    pub unresolved_count: u32,
    pub invalid_count: u32,
    pub unknown_answer_count: u32,
    pub integrity_status: ObjectiveIntegrityStatus,
    pub grading_source_version_id: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub unknown_answer_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub issue_codes: Vec<ObjectiveIntegrityIssueCode>,
    pub questions: Vec<ObjectiveQuestionAudit>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ObjectiveIntegrityInvariantError {
    ExpectedQuestionAccountingMismatch {
        expected: u32,
        accounted: u32,
    },
    QuestionCountMismatch {
        expected: u32,
        actual: u32,
    },
    DuplicateQuestionIdentity {
        identity: String,
    },
    UnknownAnswerCountMismatch {
        expected: u32,
        actual: u32,
    },
    IntegrityStatusMismatch {
        expected: ObjectiveIntegrityStatus,
        actual: ObjectiveIntegrityStatus,
    },
}

impl fmt::Display for ObjectiveIntegrityInvariantError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ExpectedQuestionAccountingMismatch {
                expected,
                accounted,
            } => write!(
                formatter,
                "objective question accounting mismatch: expected {expected}, accounted {accounted}"
            ),
            Self::QuestionCountMismatch { expected, actual } => write!(
                formatter,
                "objective audit question count mismatch: expected {expected}, actual {actual}"
            ),
            Self::DuplicateQuestionIdentity { identity } => {
                write!(
                    formatter,
                    "duplicate objective question identity: {identity}"
                )
            }
            Self::UnknownAnswerCountMismatch { expected, actual } => write!(
                formatter,
                "unknown objective answer count mismatch: expected {expected}, actual {actual}"
            ),
            Self::IntegrityStatusMismatch { expected, actual } => write!(
                formatter,
                "objective integrity status mismatch: expected {expected:?}, actual {actual:?}"
            ),
        }
    }
}

impl std::error::Error for ObjectiveIntegrityInvariantError {}

impl ObjectiveGradingAudit {
    pub fn from_questions(
        section: impl Into<String>,
        grading_source_version_id: impl Into<String>,
        questions: Vec<ObjectiveQuestionAudit>,
        unknown_answer_ids: Vec<String>,
        issue_codes: Vec<ObjectiveIntegrityIssueCode>,
    ) -> Self {
        let expected_question_count = questions.len().try_into().unwrap_or(u32::MAX);
        let verified_correct_count = questions
            .iter()
            .filter(|question| question.status == ObjectiveVerificationStatus::VerifiedCorrect)
            .count()
            .try_into()
            .unwrap_or(u32::MAX);
        let verified_incorrect_count = questions
            .iter()
            .filter(|question| question.status == ObjectiveVerificationStatus::VerifiedIncorrect)
            .count()
            .try_into()
            .unwrap_or(u32::MAX);
        let verified_unanswered_count = questions
            .iter()
            .filter(|question| question.status == ObjectiveVerificationStatus::VerifiedUnanswered)
            .count()
            .try_into()
            .unwrap_or(u32::MAX);
        let invalid_count = questions
            .iter()
            .filter(|question| question.status == ObjectiveVerificationStatus::Invalid)
            .count()
            .try_into()
            .unwrap_or(u32::MAX);
        let unresolved_count = expected_question_count
            .saturating_sub(verified_correct_count)
            .saturating_sub(verified_incorrect_count)
            .saturating_sub(verified_unanswered_count);
        let mut unknown_answer_ids = unknown_answer_ids;
        unknown_answer_ids.sort();
        unknown_answer_ids.dedup();
        let unknown_answer_count = unknown_answer_ids.len().try_into().unwrap_or(u32::MAX);
        let mut issue_codes = issue_codes;
        for question in &questions {
            if let Some(issue_code) = question.issue_code {
                if !issue_codes.contains(&issue_code) {
                    issue_codes.push(issue_code);
                }
            }
        }
        if unknown_answer_count > 0
            && !issue_codes.contains(&ObjectiveIntegrityIssueCode::UnknownStudentAnswerId)
        {
            issue_codes.push(ObjectiveIntegrityIssueCode::UnknownStudentAnswerId);
        }
        let integrity_status = derive_integrity_status(
            invalid_count,
            unresolved_count,
            unknown_answer_count,
            &issue_codes,
        );

        Self {
            section: section.into(),
            expected_question_count,
            verified_correct_count,
            verified_incorrect_count,
            verified_unanswered_count,
            unresolved_count,
            invalid_count,
            unknown_answer_count,
            integrity_status,
            grading_source_version_id: grading_source_version_id.into(),
            unknown_answer_ids,
            issue_codes,
            questions,
        }
    }

    pub fn validate(&self) -> Result<(), ObjectiveIntegrityInvariantError> {
        let actual_question_count = self.questions.len().try_into().unwrap_or(u32::MAX);
        if actual_question_count != self.expected_question_count {
            return Err(ObjectiveIntegrityInvariantError::QuestionCountMismatch {
                expected: self.expected_question_count,
                actual: actual_question_count,
            });
        }

        let mut identities = HashSet::new();
        for question in &self.questions {
            let identity = format!("{}:{}", question.section, question.question_id);
            if !identities.insert(identity.clone()) {
                return Err(
                    ObjectiveIntegrityInvariantError::DuplicateQuestionIdentity { identity },
                );
            }
        }

        let verified_correct_count = self
            .questions
            .iter()
            .filter(|question| question.status == ObjectiveVerificationStatus::VerifiedCorrect)
            .count()
            .try_into()
            .unwrap_or(u32::MAX);
        let verified_incorrect_count = self
            .questions
            .iter()
            .filter(|question| question.status == ObjectiveVerificationStatus::VerifiedIncorrect)
            .count()
            .try_into()
            .unwrap_or(u32::MAX);
        let verified_unanswered_count = self
            .questions
            .iter()
            .filter(|question| question.status == ObjectiveVerificationStatus::VerifiedUnanswered)
            .count()
            .try_into()
            .unwrap_or(u32::MAX);
        let invalid_count = self
            .questions
            .iter()
            .filter(|question| question.status == ObjectiveVerificationStatus::Invalid)
            .count()
            .try_into()
            .unwrap_or(u32::MAX);
        let unresolved_count = self
            .expected_question_count
            .saturating_sub(verified_correct_count)
            .saturating_sub(verified_incorrect_count)
            .saturating_sub(verified_unanswered_count);
        let accounted = verified_correct_count
            .saturating_add(verified_incorrect_count)
            .saturating_add(verified_unanswered_count)
            .saturating_add(unresolved_count);
        if accounted != self.expected_question_count
            || verified_correct_count != self.verified_correct_count
            || verified_incorrect_count != self.verified_incorrect_count
            || verified_unanswered_count != self.verified_unanswered_count
            || unresolved_count != self.unresolved_count
            || invalid_count != self.invalid_count
        {
            return Err(
                ObjectiveIntegrityInvariantError::ExpectedQuestionAccountingMismatch {
                    expected: self.expected_question_count,
                    accounted,
                },
            );
        }

        let actual_unknown_count = self.unknown_answer_ids.len().try_into().unwrap_or(u32::MAX);
        if actual_unknown_count != self.unknown_answer_count {
            return Err(
                ObjectiveIntegrityInvariantError::UnknownAnswerCountMismatch {
                    expected: self.unknown_answer_count,
                    actual: actual_unknown_count,
                },
            );
        }

        let expected_integrity_status = derive_integrity_status(
            self.invalid_count,
            self.unresolved_count,
            self.unknown_answer_count,
            &self.issue_codes,
        );
        if expected_integrity_status != self.integrity_status {
            return Err(ObjectiveIntegrityInvariantError::IntegrityStatusMismatch {
                expected: expected_integrity_status,
                actual: self.integrity_status,
            });
        }
        Ok(())
    }

    pub fn has_blocking_issue(&self) -> bool {
        self.integrity_status != ObjectiveIntegrityStatus::Verified
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectiveIntegrityIssueSummary {
    pub submission_id: String,
    pub student_id: String,
    pub student_name: String,
    pub section: String,
    pub question_id: Option<String>,
    pub question_number: Option<String>,
    pub code: ObjectiveIntegrityIssueCode,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectiveIntegrityOverview {
    pub student_count: u64,
    pub expected_answer_count: u64,
    pub verified_correct_count: u64,
    pub verified_incorrect_count: u64,
    pub verified_unanswered_count: u64,
    pub needs_recheck_count: u64,
    pub invalid_count: u64,
    pub integrity_status: ObjectiveIntegrityStatus,
    pub issues: Vec<ObjectiveIntegrityIssueSummary>,
}

fn derive_integrity_status(
    invalid_count: u32,
    unresolved_count: u32,
    unknown_answer_count: u32,
    issue_codes: &[ObjectiveIntegrityIssueCode],
) -> ObjectiveIntegrityStatus {
    if invalid_count > 0 || issue_codes.iter().any(|code| code.is_invalid()) {
        ObjectiveIntegrityStatus::Invalid
    } else if unresolved_count > 0 || unknown_answer_count > 0 || !issue_codes.is_empty() {
        ObjectiveIntegrityStatus::NeedsRecheck
    } else {
        ObjectiveIntegrityStatus::Verified
    }
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub nickname: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ielts_course: Option<String>,
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
    pub section_statuses: SubmissionSectionStatuses,
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
    pub answers: SectionAnswers,
    pub auto_grading_results: Option<SectionAutoGradingResults>,
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
    pub rubric_assessment: Option<WritingRubricAssessment>,
    pub annotations: ReviewAnnotations,
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
    pub section_drafts: ReviewSectionDrafts,
    pub annotations: ReviewAnnotations,
    pub drawings: ReviewDrawings,
    pub overall_feedback: Option<String>,
    pub student_visible_notes: Option<String>,
    pub internal_notes: Option<String>,
    pub teacher_summary: ReviewTeacherSummary,
    pub checklist: ReviewChecklist,
    pub has_unsaved_changes: bool,
    pub last_auto_save_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub revision: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
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
    pub section_bands: ResultSectionBands,
    pub listening_result: Option<ResultListeningSection>,
    pub reading_result: Option<ResultReadingSection>,
    pub writing_results: ResultWritingSections,
    pub speaking_result: Option<ResultSpeakingSection>,
    pub teacher_summary: ReviewTeacherSummary,
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MediaAssetStatus {
    Pending,
    Finalized,
    Orphaned,
    Deleted,
}

#[cfg(feature = "sqlx")]
mod sqlx_text_enums {
    use super::{
        GradingSessionStatus, MediaAssetStatus, OverallGradingStatus, ReleaseStatus,
        ResultListeningSection, ResultReadingSection, ResultSectionBands, ResultSpeakingSection,
        ResultWritingSections, ReviewAction, ReviewAnnotations, ReviewChecklist, ReviewDrawings,
        ReviewSectionDrafts, ReviewTeacherSummary, SectionAnswers, SectionAutoGradingResults,
        SectionGradingStatus, SubmissionSectionStatuses, TeacherAssignments,
        WritingRubricAssessment,
    };

    use sqlx::{
        decode::Decode, encode::Encode, error::BoxDynError, mysql::MySqlTypeInfo, MySql, Type,
    };
    fn invalid_enum_value(name: &str, value: &str) -> BoxDynError {
        format!("invalid {name} value: {value}").into()
    }

    macro_rules! impl_text_enum {
        ($ty:ty, { $($variant:ident => $value:expr),+ $(,)? }) => {
            impl Type<MySql> for $ty {
                fn type_info() -> MySqlTypeInfo {
                    <&str as Type<MySql>>::type_info()
                }

                fn compatible(ty: &MySqlTypeInfo) -> bool {
                    <&str as Type<MySql>>::compatible(ty)
                }
            }

            impl<'q> Encode<'q, MySql> for $ty {
                fn encode_by_ref(&self, buf: &mut Vec<u8>) -> sqlx::encode::IsNull {
                    let value = match self {
                        $(Self::$variant => $value,)+
                    };
                    <&str as Encode<MySql>>::encode_by_ref(&value, buf)
                }
            }

            impl<'r> Decode<'r, MySql> for $ty {
                fn decode(value: sqlx::mysql::MySqlValueRef<'r>) -> Result<Self, BoxDynError> {
                    let text = <&str as Decode<MySql>>::decode(value)?;
                    match text {
                        $($value => Ok(Self::$variant),)+
                        other => Err(invalid_enum_value(stringify!($ty), other)),
                    }
                }
            }
        };
    }

    impl_text_enum!(GradingSessionStatus, {
        Scheduled => "scheduled",
        Live => "live",
        InProgress => "in_progress",
        Completed => "completed",
        Cancelled => "cancelled",
    });

    impl_text_enum!(SectionGradingStatus, {
        Pending => "pending",
        AutoGraded => "auto_graded",
        NeedsReview => "needs_review",
        InReview => "in_review",
        Finalized => "finalized",
        Reopened => "reopened",
    });

    impl_text_enum!(OverallGradingStatus, {
        NotSubmitted => "not_submitted",
        Submitted => "submitted",
        InProgress => "in_progress",
        GradingComplete => "grading_complete",
        ReadyToRelease => "ready_to_release",
        Released => "released",
        Reopened => "reopened",
    });

    impl_text_enum!(ReleaseStatus, {
        Draft => "draft",
        GradingComplete => "grading_complete",
        ReadyToRelease => "ready_to_release",
        Released => "released",
        Reopened => "reopened",
    });

    impl_text_enum!(ReviewAction, {
        ReviewStarted => "review_started",
        ReviewAssigned => "review_assigned",
        DraftSaved => "draft_saved",
        CommentAdded => "comment_added",
        CommentUpdated => "comment_updated",
        RubricUpdated => "rubric_updated",
        ReviewFinalized => "review_finalized",
        ReviewReopened => "review_reopened",
        ScoreOverride => "score_override",
        FeedbackUpdated => "feedback_updated",
        ReleaseNow => "release_now",
        MarkReadyToRelease => "mark_ready_to_release",
    });

    impl_text_enum!(MediaAssetStatus, {
        Pending => "pending",
        Finalized => "finalized",
        Orphaned => "orphaned",
        Deleted => "deleted",
    });

    macro_rules! impl_json_wrapper_type {
        ($ty:ty) => {
            impl Type<MySql> for $ty {
                fn type_info() -> MySqlTypeInfo {
                    <serde_json::Value as Type<MySql>>::type_info()
                }

                fn compatible(ty: &MySqlTypeInfo) -> bool {
                    <serde_json::Value as Type<MySql>>::compatible(ty)
                }
            }

            impl<'q> Encode<'q, MySql> for $ty {
                fn encode_by_ref(&self, buf: &mut Vec<u8>) -> sqlx::encode::IsNull {
                    <serde_json::Value as Encode<MySql>>::encode_by_ref(&self.0, buf)
                }
            }

            impl<'r> Decode<'r, MySql> for $ty {
                fn decode(value: sqlx::mysql::MySqlValueRef<'r>) -> Result<Self, BoxDynError> {
                    let json = <serde_json::Value as Decode<MySql>>::decode(value)?;
                    Ok(Self(json))
                }
            }
        };
    }

    impl_json_wrapper_type!(TeacherAssignments);
    impl_json_wrapper_type!(SubmissionSectionStatuses);
    impl_json_wrapper_type!(SectionAnswers);
    impl_json_wrapper_type!(SectionAutoGradingResults);
    impl_json_wrapper_type!(WritingRubricAssessment);
    impl_json_wrapper_type!(ReviewAnnotations);
    impl_json_wrapper_type!(ReviewSectionDrafts);
    impl_json_wrapper_type!(ReviewDrawings);
    impl_json_wrapper_type!(ReviewTeacherSummary);
    impl_json_wrapper_type!(ReviewChecklist);
    impl_json_wrapper_type!(ResultSectionBands);
    impl_json_wrapper_type!(ResultListeningSection);
    impl_json_wrapper_type!(ResultReadingSection);
    impl_json_wrapper_type!(ResultWritingSections);
    impl_json_wrapper_type!(ResultSpeakingSection);
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pagination: Option<GradingSessionPagination>,
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
pub struct GradingSessionPagination {
    pub page: u64,
    pub page_size: u64,
    pub total: u64,
    pub has_more: bool,
}

/// A single page of the grading session queue. Used by the paginated
/// `GET /api/v1/grading/sessions?page=&pageSize=&search=` endpoint.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GradingSessionPage {
    pub sessions: Vec<GradingSession>,
    pub pagination: GradingSessionPagination,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewDraftSummary {
    pub id: String,
    pub submission_id: String,
    pub teacher_id: String,
    pub release_status: ReleaseStatus,
    pub has_unsaved_changes: bool,
    pub last_auto_save_at: Option<DateTime<Utc>>,
    pub updated_at: DateTime<Utc>,
    pub revision: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmissionReviewSummary {
    pub submission: StudentSubmission,
    pub review_draft: Option<ReviewDraftSummary>,
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
    pub section_drafts: ReviewSectionDrafts,
    pub annotations: ReviewAnnotations,
    pub drawings: ReviewDrawings,
    pub overall_feedback: Option<String>,
    pub student_visible_notes: Option<String>,
    pub internal_notes: Option<String>,
    pub teacher_summary: ReviewTeacherSummary,
    pub checklist: ReviewChecklist,
    pub has_unsaved_changes: bool,
    pub revision: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartReviewRequest {}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActorActionRequest {}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectiveQuestionOverrideRequest {
    pub is_correct: bool,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseNowRequest {
    pub revision_reason: Option<String>,
    pub grader_override_confirmed: Option<bool>,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectiveOverrideUpsertRequest {
    pub correct_answer: Option<String>,
    pub accepted_answers: Option<Vec<String>>,
    pub excluded_answers: Option<Vec<String>>,
    pub correct_option_ids: Option<Vec<String>>,
    pub scoring_rule: String,
    pub max_score: i64,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectiveOverrideDeleteRequest {
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "sqlx", derive(FromRow))]
#[serde(rename_all = "camelCase")]
pub struct GradingScheduleObjectiveOverride {
    pub schedule_id: String,
    pub question_id: String,
    pub override_json: Value,
    pub updated_by_actor_id: String,
    pub updated_by_actor_name: String,
    pub updated_at: DateTime<Utc>,
}

#[cfg(test)]
mod objective_integrity_tests {
    use super::*;

    fn question(question_id: &str, status: ObjectiveVerificationStatus) -> ObjectiveQuestionAudit {
        ObjectiveQuestionAudit {
            question_id: question_id.to_owned(),
            section: "reading".to_owned(),
            status,
            student_answer: None,
            accepted_answers: Vec::new(),
            awarded_score: None,
            max_score: 1.0,
            issue_code: None,
            issue_message: None,
        }
    }

    #[test]
    fn audit_counts_all_terminal_and_unresolved_question_states() {
        let audit = ObjectiveGradingAudit::from_questions(
            "reading",
            "version-1",
            vec![
                question("q1", ObjectiveVerificationStatus::VerifiedCorrect),
                question("q2", ObjectiveVerificationStatus::VerifiedIncorrect),
                question("q3", ObjectiveVerificationStatus::VerifiedUnanswered),
                question("q4", ObjectiveVerificationStatus::NeedsRecheck),
            ],
            Vec::new(),
            Vec::new(),
        );

        assert_eq!(audit.expected_question_count, 4);
        assert_eq!(audit.verified_correct_count, 1);
        assert_eq!(audit.verified_incorrect_count, 1);
        assert_eq!(audit.verified_unanswered_count, 1);
        assert_eq!(audit.unresolved_count, 1);
        assert_eq!(
            audit.integrity_status,
            ObjectiveIntegrityStatus::NeedsRecheck
        );
        assert!(audit.validate().is_ok());
    }

    #[test]
    fn audit_rejects_a_verified_status_with_unresolved_questions() {
        let mut audit = ObjectiveGradingAudit::from_questions(
            "reading",
            "version-1",
            vec![question("q1", ObjectiveVerificationStatus::NeedsRecheck)],
            Vec::new(),
            Vec::new(),
        );
        audit.integrity_status = ObjectiveIntegrityStatus::Verified;

        assert!(matches!(
            audit.validate(),
            Err(ObjectiveIntegrityInvariantError::IntegrityStatusMismatch { .. })
        ));
    }

    #[test]
    fn audit_rejects_duplicate_section_question_identity() {
        let audit = ObjectiveGradingAudit::from_questions(
            "reading",
            "version-1",
            vec![
                question("q1", ObjectiveVerificationStatus::VerifiedCorrect),
                question("q1", ObjectiveVerificationStatus::VerifiedIncorrect),
            ],
            Vec::new(),
            Vec::new(),
        );

        assert!(matches!(
            audit.validate(),
            Err(ObjectiveIntegrityInvariantError::DuplicateQuestionIdentity { .. })
        ));
    }
}
