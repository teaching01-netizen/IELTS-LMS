use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

#[cfg(feature = "sqlx")]
use sqlx::FromRow;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "sqlx", derive(FromRow))]
#[serde(rename_all = "camelCase")]
pub struct ExamSchedule {
    pub id: String,
    pub exam_id: String,
    pub organization_id: Option<String>,
    pub exam_title: String,
    pub published_version_id: String,
    pub cohort_name: String,
    pub institution: Option<String>,
    pub start_time: DateTime<Utc>,
    pub end_time: DateTime<Utc>,
    pub planned_duration_minutes: i32,
    pub delivery_mode: DeliveryMode,
    pub recurrence_type: RecurrenceType,
    pub recurrence_interval: i32,
    pub recurrence_end_date: Option<NaiveDate>,
    pub buffer_before_minutes: Option<i32>,
    pub buffer_after_minutes: Option<i32>,
    pub auto_start: bool,
    pub auto_stop: bool,
    pub status: ScheduleStatus,
    pub created_at: DateTime<Utc>,
    pub created_by: String,
    pub updated_at: DateTime<Utc>,
    pub revision: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DeliveryMode {
    ProctorStart,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RecurrenceType {
    None,
    Daily,
    Weekly,
    Monthly,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ScheduleStatus {
    Scheduled,
    Live,
    Completed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeStatus {
    NotStarted,
    Live,
    Paused,
    Completed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SectionRuntimeStatus {
    Locked,
    Live,
    Paused,
    Completed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleSectionPlanEntry {
    pub section_key: String,
    pub label: String,
    pub order: i32,
    pub duration_minutes: i32,
    pub gap_after_minutes: i32,
    pub start_offset_minutes: i32,
    pub end_offset_minutes: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSectionState {
    pub id: String,
    pub runtime_id: String,
    pub section_key: String,
    pub label: String,
    pub section_order: i32,
    pub planned_duration_minutes: i32,
    pub gap_after_minutes: i32,
    pub status: SectionRuntimeStatus,
    pub available_at: Option<DateTime<Utc>>,
    pub actual_start_at: Option<DateTime<Utc>>,
    pub actual_end_at: Option<DateTime<Utc>>,
    pub paused_at: Option<DateTime<Utc>>,
    pub accumulated_paused_seconds: i32,
    pub extension_minutes: i32,
    pub completion_reason: Option<String>,
    pub projected_start_at: Option<DateTime<Utc>>,
    pub projected_end_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExamSessionRuntime {
    pub id: String,
    pub schedule_id: String,
    pub exam_id: String,
    pub status: RuntimeStatus,
    pub plan_snapshot: Vec<ScheduleSectionPlanEntry>,
    pub actual_start_at: Option<DateTime<Utc>>,
    pub actual_end_at: Option<DateTime<Utc>>,
    pub active_section_key: Option<String>,
    pub current_section_key: Option<String>,
    pub current_section_remaining_seconds: i32,
    pub waiting_for_next_section: bool,
    pub is_overrun: bool,
    pub total_paused_seconds: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub revision: i32,
    pub sections: Vec<RuntimeSectionState>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "sqlx", derive(FromRow))]
#[serde(rename_all = "camelCase")]
pub struct CohortControlEvent {
    pub id: String,
    pub schedule_id: String,
    pub runtime_id: String,
    pub exam_id: String,
    pub actor_id: String,
    pub action: RuntimeCommandEvent,
    pub section_key: Option<String>,
    pub minutes: Option<i32>,
    pub reason: Option<String>,
    pub payload: Option<serde_json::Value>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeCommandEvent {
    StartRuntime,
    PauseRuntime,
    ResumeRuntime,
    ExtendSection,
    EndSectionNow,
    CompleteRuntime,
    AutoTimeout,
}

#[cfg(feature = "sqlx")]
mod sqlx_text_enums {
    use super::{
        DeliveryMode, RecurrenceType, RuntimeCommandEvent, RuntimeStatus, ScheduleStatus,
        SectionRuntimeStatus,
    };

    use sqlx::{
        decode::Decode,
        encode::Encode,
        error::BoxDynError,
        mysql::MySqlTypeInfo,
        MySql, Type,
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

    impl_text_enum!(DeliveryMode, {
        ProctorStart => "proctor_start",
    });

    impl_text_enum!(RecurrenceType, {
        None => "none",
        Daily => "daily",
        Weekly => "weekly",
        Monthly => "monthly",
    });

    impl_text_enum!(ScheduleStatus, {
        Scheduled => "scheduled",
        Live => "live",
        Completed => "completed",
        Cancelled => "cancelled",
    });

    impl_text_enum!(RuntimeStatus, {
        NotStarted => "not_started",
        Live => "live",
        Paused => "paused",
        Completed => "completed",
        Cancelled => "cancelled",
    });

    impl_text_enum!(SectionRuntimeStatus, {
        Locked => "locked",
        Live => "live",
        Paused => "paused",
        Completed => "completed",
    });

    impl_text_enum!(RuntimeCommandEvent, {
        StartRuntime => "start_runtime",
        PauseRuntime => "pause_runtime",
        ResumeRuntime => "resume_runtime",
        ExtendSection => "extend_section",
        EndSectionNow => "end_section_now",
        CompleteRuntime => "complete_runtime",
        AutoTimeout => "auto_timeout",
    });
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateScheduleRequest {
    pub exam_id: String,
    pub published_version_id: String,
    pub cohort_name: String,
    pub institution: Option<String>,
    pub start_time: DateTime<Utc>,
    pub end_time: DateTime<Utc>,
    pub auto_start: bool,
    pub auto_stop: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateScheduleRequest {
    pub published_version_id: Option<String>,
    pub cohort_name: Option<String>,
    pub institution: Option<String>,
    pub start_time: Option<DateTime<Utc>>,
    pub end_time: Option<DateTime<Utc>>,
    pub auto_start: Option<bool>,
    pub auto_stop: Option<bool>,
    pub status: Option<ScheduleStatus>,
    pub revision: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeCommandAction {
    StartRuntime,
    PauseRuntime,
    ResumeRuntime,
    EndRuntime,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeCommandRequest {
    pub action: RuntimeCommandAction,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, sqlx::Type)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "text", rename_all = "snake_case")]
pub enum PresenceAction {
    Join,
    Heartbeat,
    Leave,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "sqlx", derive(FromRow))]
#[serde(rename_all = "camelCase")]
pub struct ProctorPresence {
    pub id: String,
    pub schedule_id: String,
    pub proctor_id: String,
    pub proctor_name: String,
    pub status: String,
    pub joined_at: DateTime<Utc>,
    pub last_heartbeat_at: DateTime<Utc>,
    pub left_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "sqlx", derive(FromRow))]
#[serde(rename_all = "camelCase")]
pub struct SessionAuditLog {
    pub id: String,
    pub schedule_id: String,
    pub actor: String,
    pub action_type: String,
    pub target_student_id: Option<String>,
    pub payload: Option<Value>,
    pub acknowledged_at: Option<DateTime<Utc>>,
    pub acknowledged_by: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "sqlx", derive(FromRow))]
#[serde(rename_all = "camelCase")]
pub struct SessionNote {
    pub id: String,
    pub schedule_id: String,
    pub author: String,
    pub category: String,
    pub content: String,
    pub is_resolved: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "sqlx", derive(FromRow))]
#[serde(rename_all = "camelCase")]
pub struct ViolationRule {
    pub id: String,
    pub schedule_id: String,
    pub trigger_type: String,
    pub threshold: i32,
    pub specific_violation_type: Option<String>,
    pub specific_severity: Option<String>,
    pub action: String,
    pub is_enabled: bool,
    pub created_at: DateTime<Utc>,
    pub created_by: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudentSessionSummary {
    pub attempt_id: String,
    pub student_id: String,
    pub student_name: String,
    pub student_email: String,
    pub schedule_id: String,
    pub status: String,
    pub current_section: String,
    pub time_remaining: i32,
    pub runtime_status: RuntimeStatus,
    pub runtime_current_section: Option<String>,
    pub runtime_time_remaining_seconds: i32,
    pub runtime_section_status: Option<String>,
    pub runtime_waiting: bool,
    pub violations: Value,
    pub warnings: i32,
    pub last_activity: DateTime<Utc>,
    pub exam_id: Uuid,
    pub exam_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProctorAlert {
    pub id: Uuid,
    pub severity: String,
    #[serde(rename = "type")]
    pub alert_type: String,
    pub student_name: String,
    pub student_id: String,
    pub timestamp: DateTime<Utc>,
    pub message: String,
    pub is_acknowledged: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProctorSessionSummary {
    pub schedule: ExamSchedule,
    pub runtime: ExamSessionRuntime,
    pub student_count: i64,
    pub active_count: i64,
    pub alert_count: i64,
    pub violation_count: i64,
    pub degraded_live_mode: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProctorSessionDetail {
    pub schedule: ExamSchedule,
    pub runtime: ExamSessionRuntime,
    pub sessions: Vec<StudentSessionSummary>,
    pub alerts: Vec<ProctorAlert>,
    pub audit_logs: Vec<SessionAuditLog>,
    pub notes: Vec<SessionNote>,
    pub presence: Vec<ProctorPresence>,
    pub violation_rules: Vec<ViolationRule>,
    pub degraded_live_mode: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProctorPresenceRequest {
    pub action: PresenceAction,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtendSectionRequest {
    pub minutes: i32,
    pub reason: Option<String>,
    pub expected_active_section_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompleteExamRequest {
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttemptCommandRequest {
    pub message: Option<String>,
    pub reason: Option<String>,
    pub expected_active_section_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlertAckRequest {
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DegradedLiveState {
    pub degraded: bool,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LiveUpdateEvent {
    pub kind: String,
    pub id: String,
    pub revision: i64,
    pub event: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleRegistration {
    pub id: Uuid,
    pub schedule_id: Uuid,
    pub wcode: String,
    pub email: String,
    pub student_key: String,
    pub actor_id: Option<String>,
    pub student_id: String,
    pub student_name: String,
    pub access_state: String,
    pub allowed_from: Option<DateTime<Utc>>,
    pub allowed_until: Option<DateTime<Utc>>,
    pub extra_time_minutes: i32,
    pub seat_label: Option<String>,
    pub metadata: Option<Value>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub revision: i32,
}

// Validation functions
pub fn validate_wcode(wcode: &str) -> Result<(), String> {
    let regex = regex::Regex::new(r"^W[0-9]{6}$").unwrap();
    if regex.is_match(wcode) {
        Ok(())
    } else {
        Err("Wcode must be in format W followed by 6 digits (e.g., W250334)".to_string())
    }
}

pub fn validate_email(email: &str) -> Result<(), String> {
    let regex = regex::Regex::new(r"^[^@]+@[^@]+\.[^@]+$").unwrap();
    if regex.is_match(email) {
        Ok(())
    } else {
        Err("Invalid email format".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_wcode_accepts_expected_format() {
        assert!(validate_wcode("W123456").is_ok());
        assert!(validate_wcode("w123456").is_err());
        assert!(validate_wcode("W12345").is_err());
        assert!(validate_wcode("W1234567").is_err());
        assert!(validate_wcode("X123456").is_err());
    }
}
