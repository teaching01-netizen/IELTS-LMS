use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[cfg(feature = "sqlx")]
use sqlx::FromRow;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "sqlx", derive(FromRow))]
#[serde(rename_all = "camelCase")]
pub struct PassageLibraryItem {
    pub id: String,
    pub organization_id: Option<String>,
    pub title: String,
    pub passage_snapshot: serde_json::Value,
    pub difficulty: Difficulty,
    pub topic: String,
    pub tags: serde_json::Value,
    pub word_count: i32,
    pub estimated_time_minutes: i32,
    pub usage_count: i32,
    pub created_by: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub revision: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "sqlx", derive(FromRow))]
#[serde(rename_all = "camelCase")]
pub struct QuestionBankItem {
    pub id: String,
    pub organization_id: Option<String>,
    pub question_type: String,
    pub block_snapshot: serde_json::Value,
    pub difficulty: Difficulty,
    pub topic: String,
    pub tags: serde_json::Value,
    pub usage_count: i32,
    pub created_by: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub revision: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, sqlx::Type)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "text", rename_all = "snake_case")]
pub enum Difficulty {
    Easy,
    Medium,
    Hard,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "sqlx", derive(FromRow))]
#[serde(rename_all = "camelCase")]
pub struct AdminDefaultProfile {
    pub id: String,
    pub organization_id: Option<String>,
    pub profile_name: String,
    pub config_snapshot: serde_json::Value,
    pub is_active: bool,
    pub created_by: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub revision: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatePassageRequest {
    pub title: String,
    pub passage_snapshot: serde_json::Value,
    pub difficulty: Difficulty,
    pub topic: String,
    pub tags: serde_json::Value,
    pub word_count: i32,
    pub estimated_time_minutes: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePassageRequest {
    pub title: Option<String>,
    pub passage_snapshot: Option<serde_json::Value>,
    pub difficulty: Option<Difficulty>,
    pub topic: Option<String>,
    pub tags: Option<serde_json::Value>,
    pub word_count: Option<i32>,
    pub estimated_time_minutes: Option<i32>,
    pub revision: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateQuestionRequest {
    pub question_type: String,
    pub block_snapshot: serde_json::Value,
    pub difficulty: Difficulty,
    pub topic: String,
    pub tags: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateQuestionRequest {
    pub question_type: Option<String>,
    pub block_snapshot: Option<serde_json::Value>,
    pub difficulty: Option<Difficulty>,
    pub topic: Option<String>,
    pub tags: Option<serde_json::Value>,
    pub revision: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateExamDefaultsRequest {
    pub config_snapshot: serde_json::Value,
    pub revision: i32,
}
