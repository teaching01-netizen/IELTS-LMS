use chrono::{DateTime, Utc};
use crate::grading::ObjectiveScoreSummary;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[cfg(feature = "sqlx")]
use sqlx::FromRow;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum AttemptPhase {
    PreCheck,
    Lobby,
    Exam,
    PostExam,
}

impl AttemptPhase {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::PreCheck => "pre-check",
            Self::Lobby => "lobby",
            Self::Exam => "exam",
            Self::PostExam => "post-exam",
        }
    }
}

impl PartialEq<&str> for AttemptPhase {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ModuleType {
    Listening,
    Reading,
    Writing,
    Speaking,
    Science,
}

impl ModuleType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Listening => "listening",
            Self::Reading => "reading",
            Self::Writing => "writing",
            Self::Speaking => "speaking",
            Self::Science => "science",
        }
    }

    pub fn from_section_key(value: &str) -> Option<Self> {
        match value {
            "listening" => Some(Self::Listening),
            "reading" => Some(Self::Reading),
            "writing" => Some(Self::Writing),
            "speaking" => Some(Self::Speaking),
            "science" => Some(Self::Science),
            _ => None,
        }
    }
}

impl PartialEq<&str> for ModuleType {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum HeartbeatEventType {
    Heartbeat,
    Disconnect,
    Reconnect,
    Lost,
}

impl HeartbeatEventType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Heartbeat => "heartbeat",
            Self::Disconnect => "disconnect",
            Self::Reconnect => "reconnect",
            Self::Lost => "lost",
        }
    }
}

impl PartialEq<&str> for HeartbeatEventType {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum MutationType {
    #[serde(rename = "answer")]
    Answer,
    #[serde(rename = "writing_answer")]
    WritingAnswer,
    #[serde(rename = "flag")]
    Flag,
    #[serde(rename = "position")]
    Position,
    #[serde(rename = "violation")]
    Violation,
    #[serde(rename = "precheck")]
    Precheck,
    #[serde(rename = "network")]
    Network,
    #[serde(rename = "heartbeat")]
    Heartbeat,
    #[serde(rename = "device_fingerprint")]
    DeviceFingerprint,
    #[serde(rename = "sync")]
    Sync,
    #[serde(rename = "SetSlot")]
    SetSlot,
    #[serde(rename = "ClearSlot")]
    ClearSlot,
    #[serde(rename = "SetScalar")]
    SetScalar,
    #[serde(rename = "ClearScalar")]
    ClearScalar,
    #[serde(rename = "SetChoice")]
    SetChoice,
    #[serde(rename = "ClearChoice")]
    ClearChoice,
    #[serde(rename = "SetEssayText")]
    SetEssayText,
    #[serde(rename = "ClearEssayText")]
    ClearEssayText,
}

impl MutationType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Answer => "answer",
            Self::WritingAnswer => "writing_answer",
            Self::Flag => "flag",
            Self::Position => "position",
            Self::Violation => "violation",
            Self::Precheck => "precheck",
            Self::Network => "network",
            Self::Heartbeat => "heartbeat",
            Self::DeviceFingerprint => "device_fingerprint",
            Self::Sync => "sync",
            Self::SetSlot => "SetSlot",
            Self::ClearSlot => "ClearSlot",
            Self::SetScalar => "SetScalar",
            Self::ClearScalar => "ClearScalar",
            Self::SetChoice => "SetChoice",
            Self::ClearChoice => "ClearChoice",
            Self::SetEssayText => "SetEssayText",
            Self::ClearEssayText => "ClearEssayText",
        }
    }
}

impl PartialEq<&str> for MutationType {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct QuestionValueMutationPayload {
    pub question_id: String,
    pub value: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct QuestionIdMutationPayload {
    pub question_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct QuestionSlotValueMutationPayload {
    pub question_id: String,
    pub slot_index: u32,
    pub value: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct QuestionSlotIdMutationPayload {
    pub question_id: String,
    pub slot_index: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TaskValueMutationPayload {
    pub task_id: String,
    pub value: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TaskIdMutationPayload {
    pub task_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PositionMutationPayload {
    pub phase: AttemptPhase,
    pub current_module: ModuleType,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub current_question_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ViolationMutationPayload {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub violations: Option<Vec<ViolationSnapshotEntry>>,
    #[serde(flatten)]
    pub extra: std::collections::BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(transparent)]
pub struct TelemetryMutationPayload(pub serde_json::Map<String, Value>);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "mutationType", content = "payload")]
pub enum MutationCommand {
    #[serde(rename = "answer")]
    Answer(QuestionValueMutationPayload),
    #[serde(rename = "writing_answer")]
    WritingAnswer(TaskValueMutationPayload),
    #[serde(rename = "flag")]
    Flag(QuestionValueMutationPayload),
    #[serde(rename = "position")]
    Position(PositionMutationPayload),
    #[serde(rename = "violation")]
    Violation(ViolationMutationPayload),
    #[serde(rename = "precheck")]
    Precheck(TelemetryMutationPayload),
    #[serde(rename = "network")]
    Network(TelemetryMutationPayload),
    #[serde(rename = "heartbeat")]
    Heartbeat(TelemetryMutationPayload),
    #[serde(rename = "device_fingerprint")]
    DeviceFingerprint(TelemetryMutationPayload),
    #[serde(rename = "sync")]
    Sync(TelemetryMutationPayload),
    #[serde(rename = "SetSlot")]
    SetSlot(QuestionSlotValueMutationPayload),
    #[serde(rename = "ClearSlot")]
    ClearSlot(QuestionSlotIdMutationPayload),
    #[serde(rename = "SetScalar")]
    SetScalar(QuestionValueMutationPayload),
    #[serde(rename = "ClearScalar")]
    ClearScalar(QuestionIdMutationPayload),
    #[serde(rename = "SetChoice")]
    SetChoice(QuestionValueMutationPayload),
    #[serde(rename = "ClearChoice")]
    ClearChoice(QuestionIdMutationPayload),
    #[serde(rename = "SetEssayText")]
    SetEssayText(TaskValueMutationPayload),
    #[serde(rename = "ClearEssayText")]
    ClearEssayText(TaskIdMutationPayload),
}

impl MutationCommand {
    pub fn mutation_type(&self) -> MutationType {
        match self {
            Self::Answer(_) => MutationType::Answer,
            Self::WritingAnswer(_) => MutationType::WritingAnswer,
            Self::Flag(_) => MutationType::Flag,
            Self::Position(_) => MutationType::Position,
            Self::Violation(_) => MutationType::Violation,
            Self::Precheck(_) => MutationType::Precheck,
            Self::Network(_) => MutationType::Network,
            Self::Heartbeat(_) => MutationType::Heartbeat,
            Self::DeviceFingerprint(_) => MutationType::DeviceFingerprint,
            Self::Sync(_) => MutationType::Sync,
            Self::SetSlot(_) => MutationType::SetSlot,
            Self::ClearSlot(_) => MutationType::ClearSlot,
            Self::SetScalar(_) => MutationType::SetScalar,
            Self::ClearScalar(_) => MutationType::ClearScalar,
            Self::SetChoice(_) => MutationType::SetChoice,
            Self::ClearChoice(_) => MutationType::ClearChoice,
            Self::SetEssayText(_) => MutationType::SetEssayText,
            Self::ClearEssayText(_) => MutationType::ClearEssayText,
        }
    }

    pub fn payload_json(&self) -> Value {
        fn to_json<T: Serialize>(value: &T) -> Value {
            serde_json::to_value(value).unwrap_or_else(|_| Value::Object(Default::default()))
        }

        match self {
            Self::Answer(payload) => to_json(payload),
            Self::WritingAnswer(payload) => to_json(payload),
            Self::Flag(payload) => to_json(payload),
            Self::Position(payload) => to_json(payload),
            Self::Violation(payload) => to_json(payload),
            Self::Precheck(payload) => to_json(payload),
            Self::Network(payload) => to_json(payload),
            Self::Heartbeat(payload) => to_json(payload),
            Self::DeviceFingerprint(payload) => to_json(payload),
            Self::Sync(payload) => to_json(payload),
            Self::SetSlot(payload) => to_json(payload),
            Self::ClearSlot(payload) => to_json(payload),
            Self::SetScalar(payload) => to_json(payload),
            Self::ClearScalar(payload) => to_json(payload),
            Self::SetChoice(payload) => to_json(payload),
            Self::ClearChoice(payload) => to_json(payload),
            Self::SetEssayText(payload) => to_json(payload),
            Self::ClearEssayText(payload) => to_json(payload),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProctorStatus {
    Active,
    Warned,
    Paused,
    Terminated,
    Idle,
    Connecting,
}

impl ProctorStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Active => "active",
            Self::Warned => "warned",
            Self::Paused => "paused",
            Self::Terminated => "terminated",
            Self::Idle => "idle",
            Self::Connecting => "connecting",
        }
    }
}

impl PartialEq<&str> for ProctorStatus {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(transparent)]
pub struct ObjectiveAnswers(pub Value);

impl std::ops::Deref for ObjectiveAnswers {
    type Target = Value;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl std::ops::DerefMut for ObjectiveAnswers {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.0
    }
}

impl From<Value> for ObjectiveAnswers {
    fn from(value: Value) -> Self {
        Self(value)
    }
}

impl From<ObjectiveAnswers> for Value {
    fn from(value: ObjectiveAnswers) -> Self {
        value.0
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(transparent)]
pub struct WritingAnswers(pub Value);

impl std::ops::Deref for WritingAnswers {
    type Target = Value;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl std::ops::DerefMut for WritingAnswers {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.0
    }
}

impl From<Value> for WritingAnswers {
    fn from(value: Value) -> Self {
        Self(value)
    }
}

impl From<WritingAnswers> for Value {
    fn from(value: WritingAnswers) -> Self {
        value.0
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(transparent)]
pub struct QuestionFlags(pub Value);

impl std::ops::Deref for QuestionFlags {
    type Target = Value;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl std::ops::DerefMut for QuestionFlags {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.0
    }
}

impl From<Value> for QuestionFlags {
    fn from(value: Value) -> Self {
        Self(value)
    }
}

impl From<QuestionFlags> for Value {
    fn from(value: QuestionFlags) -> Self {
        value.0
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct StudentIntegrity {
    pub pre_check: Option<Value>,
    pub device_fingerprint_hash: Option<String>,
    pub client_session_id: Option<String>,
    pub last_disconnect_at: Option<DateTime<Utc>>,
    pub last_reconnect_at: Option<DateTime<Utc>>,
    pub last_heartbeat_at: Option<DateTime<Utc>>,
    pub last_heartbeat_status: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct StudentClientPosition {
    pub phase: Option<String>,
    pub current_module: Option<String>,
    pub current_question_id: Option<String>,
    pub at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct StudentRecovery {
    pub last_recovered_at: Option<DateTime<Utc>>,
    pub last_local_mutation_at: Option<DateTime<Utc>>,
    pub last_persisted_at: Option<DateTime<Utc>>,
    pub pending_mutation_count: i32,
    pub sync_state: Option<String>,
    pub server_accepted_through_seq: i64,
    pub client_session_id: Option<String>,
    pub client_position: Option<StudentClientPosition>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct ViolationSnapshotEntry {
    pub id: Option<String>,
    pub timestamp: Option<DateTime<Utc>>,
    #[serde(flatten)]
    pub extra: std::collections::BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(transparent)]
pub struct ViolationsSnapshot(pub Vec<ViolationSnapshotEntry>);

impl From<ViolationsSnapshot> for Value {
    fn from(snapshot: ViolationsSnapshot) -> Self {
        serde_json::to_value(snapshot).unwrap_or_else(|_| Value::Array(Vec::new()))
    }
}

impl From<StudentIntegrity> for Value {
    fn from(integrity: StudentIntegrity) -> Self {
        serde_json::to_value(integrity).unwrap_or_else(|_| Value::Object(Default::default()))
    }
}

impl From<StudentRecovery> for Value {
    fn from(recovery: StudentRecovery) -> Self {
        serde_json::to_value(recovery).unwrap_or_else(|_| Value::Object(Default::default()))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "sqlx", derive(FromRow))]
#[serde(rename_all = "camelCase")]
pub struct StudentAttempt {
    pub id: String,
    pub schedule_id: String,
    pub registration_id: Option<String>,
    pub student_key: String,
    pub organization_id: Option<String>,
    pub exam_id: String,
    pub published_version_id: String,
    pub exam_title: String,
    pub candidate_id: String,
    pub candidate_name: String,
    pub candidate_email: String,
    pub phase: AttemptPhase,
    pub current_module: ModuleType,
    pub current_question_id: Option<String>,
    pub answers: ObjectiveAnswers,
    pub writing_answers: WritingAnswers,
    pub flags: QuestionFlags,
    pub violations_snapshot: ViolationsSnapshot,
    pub integrity: StudentIntegrity,
    pub recovery: StudentRecovery,
    pub final_submission: Option<Value>,
    pub submitted_at: Option<DateTime<Utc>>,
    pub wcode: String,
    pub user_id: Option<String>,
    pub proctor_status: ProctorStatus,
    pub proctor_note: Option<String>,
    pub proctor_updated_at: Option<DateTime<Utc>>,
    pub proctor_updated_by: Option<String>,
    pub last_warning_id: Option<String>,
    pub last_acknowledged_warning_id: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub revision: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "sqlx", derive(FromRow))]
#[serde(rename_all = "camelCase")]
pub struct StudentAttemptMutation {
    pub id: String,
    pub attempt_id: String,
    pub schedule_id: String,
    pub client_session_id: String,
    pub mutation_type: MutationType,
    pub client_mutation_id: String,
    pub mutation_seq: i64,
    pub payload: Value,
    pub client_timestamp: DateTime<Utc>,
    pub server_received_at: DateTime<Utc>,
    pub applied_revision: Option<i32>,
    pub applied_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "sqlx", derive(FromRow))]
#[serde(rename_all = "camelCase")]
pub struct StudentHeartbeatEvent {
    pub id: String,
    pub attempt_id: String,
    pub schedule_id: String,
    pub event_type: HeartbeatEventType,
    pub payload: Option<Value>,
    pub client_timestamp: DateTime<Utc>,
    pub server_received_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudentSessionQuery {
    pub student_key: Option<String>,
    pub candidate_id: Option<String>,
    pub refresh_attempt_credential: Option<bool>,
    pub client_session_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudentPrecheckRequest {
    pub wcode: Option<String>,
    pub email: Option<String>,
    pub student_key: String,
    pub candidate_id: String,
    pub candidate_name: String,
    pub candidate_email: String,
    pub client_session_id: String,
    pub pre_check: Value,
    pub device_fingerprint_hash: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudentBootstrapRequest {
    pub wcode: Option<String>,
    pub email: Option<String>,
    pub student_key: String,
    pub candidate_id: String,
    pub candidate_name: String,
    pub candidate_email: String,
    pub client_session_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MutationEnvelope {
    pub id: String,
    pub seq: i64,
    pub timestamp: DateTime<Utc>,
    #[serde(flatten)]
    pub command: MutationCommand,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_revision: Option<i32>,
}

impl MutationEnvelope {
    pub fn mutation_type(&self) -> MutationType {
        self.command.mutation_type()
    }

    pub fn payload_json(&self) -> Value {
        self.command.payload_json()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudentMutationBatchRequest {
    pub attempt_id: String,
    pub student_key: String,
    pub client_session_id: String,
    pub mutations: Vec<MutationEnvelope>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudentHeartbeatRequest {
    pub attempt_id: Option<String>,
    pub student_key: String,
    pub client_session_id: String,
    pub event_type: HeartbeatEventType,
    pub payload: Option<Value>,
    pub client_timestamp: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudentAuditLogRequest {
    pub action_type: crate::schedule::AuditActionType,
    pub payload: Option<Value>,
    pub client_timestamp: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudentSubmitRequest {
    pub attempt_id: String,
    pub student_key: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_seen_revision: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub submission_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub client_session_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub client_final_seq: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub server_accepted_through_seq: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub final_answer_patch: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub final_client_snapshot_hash: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub answers: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub writing_answers: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub flags: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudentSessionContext {
    pub schedule: crate::schedule::ExamSchedule,
    pub version: crate::exam::ExamVersion,
    pub runtime: Option<crate::schedule::ExamSessionRuntime>,
    pub attempt: Option<StudentAttempt>,
    pub attempt_credential: Option<crate::auth::IssueAttemptToken>,
    pub degraded_live_mode: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudentStaticSessionContext {
    pub schedule: crate::schedule::ExamSchedule,
    pub version: crate::exam::ExamVersion,
    pub degraded_live_mode: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudentLiveSessionContext {
    pub runtime: Option<crate::schedule::ExamSessionRuntime>,
    pub attempt: Option<StudentAttempt>,
    pub degraded_live_mode: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudentMutationBatchResponse {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attempt: Option<StudentAttempt>,
    pub applied_mutation_count: usize,
    pub server_accepted_through_seq: i64,
    pub revision: i32,
    #[serde(default)]
    pub accepted_in_grace: bool,
    pub refreshed_attempt_credential: Option<crate::auth::IssueAttemptToken>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudentHeartbeatResponse {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attempt: Option<StudentAttempt>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runtime: Option<crate::schedule::ExamSessionRuntime>,
    pub refreshed_attempt_credential: Option<crate::auth::IssueAttemptToken>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudentSubmitResponse {
    pub attempt: StudentAttempt,
    pub submission_id: String,
    pub submitted_at: DateTime<Utc>,
    pub score: Option<ObjectiveScoreSummary>,
    pub refreshed_attempt_credential: Option<crate::auth::IssueAttemptToken>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudentRegistrationRequest {
    pub wcode: String,
    pub email: String,
    pub student_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudentRegistrationResponse {
    pub registration_id: String,
    pub wcode: String,
    pub email: String,
    pub student_name: String,
    pub access_state: String,
}

#[cfg(feature = "sqlx")]
mod sqlx_text_enums {
    use super::{
        AttemptPhase, HeartbeatEventType, ModuleType, MutationType, ObjectiveAnswers,
        ProctorStatus, QuestionFlags, StudentIntegrity, StudentRecovery, ViolationSnapshotEntry,
        ViolationsSnapshot, WritingAnswers,
    };

    use serde_json::Value;
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

    impl_text_enum!(AttemptPhase, {
        PreCheck => "pre-check",
        Lobby => "lobby",
        Exam => "exam",
        PostExam => "post-exam",
    });

    impl_text_enum!(ModuleType, {
        Listening => "listening",
        Reading => "reading",
        Writing => "writing",
        Speaking => "speaking",
        Science => "science",
    });

    impl_text_enum!(HeartbeatEventType, {
        Heartbeat => "heartbeat",
        Disconnect => "disconnect",
        Reconnect => "reconnect",
        Lost => "lost",
    });

    impl_text_enum!(MutationType, {
        Answer => "answer",
        WritingAnswer => "writing_answer",
        Flag => "flag",
        Position => "position",
        Violation => "violation",
        Precheck => "precheck",
        Network => "network",
        Heartbeat => "heartbeat",
        DeviceFingerprint => "device_fingerprint",
        Sync => "sync",
        SetSlot => "SetSlot",
        ClearSlot => "ClearSlot",
        SetScalar => "SetScalar",
        ClearScalar => "ClearScalar",
        SetChoice => "SetChoice",
        ClearChoice => "ClearChoice",
        SetEssayText => "SetEssayText",
        ClearEssayText => "ClearEssayText",
    });

    impl_text_enum!(ProctorStatus, {
        Active => "active",
        Warned => "warned",
        Paused => "paused",
        Terminated => "terminated",
        Idle => "idle",
        Connecting => "connecting",
    });

    macro_rules! impl_json_type {
        ($ty:ty, $fallback:expr) => {
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
                    let value = serde_json::to_value(self).unwrap_or_else(|_| $fallback);
                    <serde_json::Value as Encode<MySql>>::encode(value, buf)
                }
            }

            impl<'r> Decode<'r, MySql> for $ty {
                fn decode(value: sqlx::mysql::MySqlValueRef<'r>) -> Result<Self, BoxDynError> {
                    let json = <serde_json::Value as Decode<MySql>>::decode(value)?;
                    serde_json::from_value(json).map_err(|err| {
                        format!("invalid json for {}: {err}", stringify!($ty)).into()
                    })
                }
            }
        };
    }

    impl_json_type!(StudentIntegrity, Value::Object(Default::default()));
    impl_json_type!(StudentRecovery, Value::Object(Default::default()));
    impl_json_type!(ViolationsSnapshot, Value::Array(Vec::new()));
    impl_json_type!(ObjectiveAnswers, Value::Object(Default::default()));
    impl_json_type!(WritingAnswers, Value::Object(Default::default()));
    impl_json_type!(QuestionFlags, Value::Object(Default::default()));

    impl From<Vec<ViolationSnapshotEntry>> for ViolationsSnapshot {
        fn from(value: Vec<ViolationSnapshotEntry>) -> Self {
            Self(value)
        }
    }
}
