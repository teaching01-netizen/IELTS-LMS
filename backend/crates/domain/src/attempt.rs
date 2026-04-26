use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

#[cfg(feature = "sqlx")]
use sqlx::FromRow;

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
    pub phase: String,
    pub current_module: String,
    pub current_question_id: Option<String>,
    pub answers: Value,
    pub writing_answers: Value,
    pub flags: Value,
    pub violations_snapshot: Value,
    pub integrity: Value,
    pub recovery: Value,
    pub final_submission: Option<Value>,
    pub submitted_at: Option<DateTime<Utc>>,
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
    pub mutation_type: String,
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
    pub event_type: String,
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
    pub mutation_type: String,
    pub payload: Value,
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
    pub event_type: String,
    pub payload: Option<Value>,
    pub client_timestamp: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudentAuditLogRequest {
    pub action_type: String,
    pub payload: Option<Value>,
    pub client_timestamp: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudentSubmitRequest {
    pub attempt_id: String,
    pub student_key: String,
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
    pub refreshed_attempt_credential: Option<crate::auth::IssueAttemptToken>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudentHeartbeatResponse {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attempt: Option<StudentAttempt>,
    pub refreshed_attempt_credential: Option<crate::auth::IssueAttemptToken>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudentSubmitResponse {
    pub attempt: StudentAttempt,
    pub submission_id: String,
    pub submitted_at: DateTime<Utc>,
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
