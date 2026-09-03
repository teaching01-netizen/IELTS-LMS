use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResponsePayload {
    #[serde(default)]
    pub answer: serde_json::Value,
    #[serde(default)]
    pub marked_for_review: bool,
    #[serde(default)]
    pub eliminated_options: Vec<String>,
    #[serde(default)]
    pub annotations: Vec<serde_json::Value>,
}

impl Default for ResponsePayload {
    fn default() -> Self {
        Self {
            answer: serde_json::Value::Null,
            marked_for_review: false,
            eliminated_options: Vec::new(),
            annotations: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResponseCommandV2 {
    pub write_id: String,
    pub question_id: String,
    pub client_version: i64,
    pub response: ResponsePayload,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResponseBatchRequestV2 {
    pub lease_epoch: i64,
    pub control_epoch: i64,
    pub commands: Vec<ResponseCommandV2>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ResponseOutcome {
    Applied,
    Duplicate,
    Superseded,
}

impl ResponseOutcome {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Applied => "applied",
            Self::Duplicate => "duplicate",
            Self::Superseded => "superseded",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResponseAcknowledgementV2 {
    pub write_id: String,
    pub question_id: String,
    pub client_version: i64,
    pub outcome: ResponseOutcome,
    pub server_revision: i64,
    pub canonical_response: ResponsePayload,
    pub content_hash: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResponseBatchResponseV2 {
    pub attempt_revision: i64,
    pub server_time: DateTime<Utc>,
    pub acknowledgements: Vec<ResponseAcknowledgementV2>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResponseSnapshotV2 {
    pub attempt_id: String,
    pub protocol_version: i32,
    pub delivery_status: String,
    pub lease_epoch: i64,
    pub control_epoch: i64,
    pub attempt_revision: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deadline_at: Option<DateTime<Utc>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub closing_grace_until: Option<DateTime<Utc>>,
    pub responses: Vec<ResponseAcknowledgementV2>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmitAttemptV2Request {
    pub submission_id: String,
    pub lease_epoch: i64,
    pub control_epoch: i64,
    #[serde(default)]
    pub final_commands: Vec<ResponseCommandV2>,
    pub expected_attempt_revision: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmitAttemptV2Response {
    pub attempt_id: String,
    pub submission_id: String,
    pub status: String,
    pub attempt_revision: i64,
    pub final_response_digest: String,
    pub submitted_at: DateTime<Utc>,
    pub acknowledgements: Vec<ResponseAcknowledgementV2>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TakeoverLeaseRequest {
    pub client_session_id: String,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TakeoverLeaseResponse {
    pub attempt_id: String,
    pub client_session_id: String,
    pub lease_epoch: i64,
    pub expires_at: DateTime<Utc>,
    pub token: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DurabilityErrorCode {
    InvalidResponse,
    QuestionNotInAttempt,
    LeaseFenced,
    ControlEpochStale,
    VersionCollision,
    IdempotencyKeyReused,
    AttemptNotWritable,
    RateLimited,
    TemporaryUnavailable,
    ProtocolVersionUnsupported,
}

impl DurabilityErrorCode {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::InvalidResponse => "INVALID_RESPONSE",
            Self::QuestionNotInAttempt => "QUESTION_NOT_IN_ATTEMPT",
            Self::LeaseFenced => "LEASE_FENCED",
            Self::ControlEpochStale => "CONTROL_EPOCH_STALE",
            Self::VersionCollision => "VERSION_COLLISION",
            Self::IdempotencyKeyReused => "IDEMPOTENCY_KEY_REUSED",
            Self::AttemptNotWritable => "ATTEMPT_NOT_WRITABLE",
            Self::RateLimited => "RATE_LIMITED",
            Self::TemporaryUnavailable => "TEMPORARY_UNAVAILABLE",
            Self::ProtocolVersionUnsupported => "PROTOCOL_VERSION_UNSUPPORTED",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DurabilityErrorResponse {
    pub error_code: DurabilityErrorCode,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<serde_json::Value>,
}
