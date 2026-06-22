use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
#[cfg(feature = "sqlx")]
use sqlx::FromRow;
use std::fmt;

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

json_wrapper!(ExamContentSnapshot);
json_wrapper!(ExamConfigSnapshot);
json_wrapper!(ExamValidationSnapshot);
json_wrapper!(ExamEventPayload);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "sqlx", derive(FromRow))]
#[serde(rename_all = "camelCase")]
pub struct ExamEntity {
    pub id: String,
    pub slug: String,
    pub title: String,
    pub exam_type: ExamType,
    pub status: ExamStatus,
    pub visibility: Visibility,
    pub organization_id: Option<String>,
    pub owner_id: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub published_at: Option<DateTime<Utc>>,
    pub archived_at: Option<DateTime<Utc>>,
    pub current_draft_version_id: Option<String>,
    pub current_published_version_id: Option<String>,
    pub total_questions: Option<i32>,
    pub total_reading_questions: Option<i32>,
    pub total_listening_questions: Option<i32>,
    pub schema_version: i32,
    pub revision: i32,
}

impl ExamEntity {
    pub fn get_exam_type(&self) -> Result<ExamType, String> {
        Ok(self.exam_type.clone())
    }

    pub fn get_status(&self) -> Result<ExamStatus, String> {
        Ok(self.status.clone())
    }

    pub fn get_visibility(&self) -> Result<Visibility, String> {
        Ok(self.visibility.clone())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum ExamType {
    #[serde(rename = "Academic")]
    Academic,
    #[serde(rename = "General Training")]
    GeneralTraining,
}

#[cfg(feature = "sqlx")]
mod sqlx_exam_enums {
    use super::{ExamStatus, ExamType, Visibility};
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

    impl_text_enum!(ExamType, {
        Academic => "Academic",
        GeneralTraining => "General Training",
    });

    impl_text_enum!(ExamStatus, {
        Draft => "draft",
        InReview => "in_review",
        Approved => "approved",
        Rejected => "rejected",
        Scheduled => "scheduled",
        Published => "published",
        Archived => "archived",
        Unpublished => "unpublished",
    });

    impl_text_enum!(Visibility, {
        Private => "private",
        Organization => "organization",
        Public => "public",
    });
}

impl ExamType {
    pub fn as_str(&self) -> &'static str {
        match self {
            ExamType::Academic => "Academic",
            ExamType::GeneralTraining => "General Training",
        }
    }

    pub fn from_str(s: &str) -> Result<Self, String> {
        match s {
            "Academic" => Ok(ExamType::Academic),
            "General Training" => Ok(ExamType::GeneralTraining),
            _ => Err(format!("Invalid ExamType: {}", s)),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ExamStatus {
    Draft,
    InReview,
    Approved,
    Rejected,
    Scheduled,
    Published,
    Archived,
    Unpublished,
}

impl ExamStatus {
    pub fn from_str(s: &str) -> Result<Self, String> {
        match s {
            "draft" => Ok(ExamStatus::Draft),
            "in_review" => Ok(ExamStatus::InReview),
            "approved" => Ok(ExamStatus::Approved),
            "rejected" => Ok(ExamStatus::Rejected),
            "scheduled" => Ok(ExamStatus::Scheduled),
            "published" => Ok(ExamStatus::Published),
            "archived" => Ok(ExamStatus::Archived),
            "unpublished" => Ok(ExamStatus::Unpublished),
            _ => Err(format!("Invalid ExamStatus: {}", s)),
        }
    }
}

impl fmt::Display for ExamStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ExamStatus::Draft => write!(f, "draft"),
            ExamStatus::InReview => write!(f, "in_review"),
            ExamStatus::Approved => write!(f, "approved"),
            ExamStatus::Rejected => write!(f, "rejected"),
            ExamStatus::Scheduled => write!(f, "scheduled"),
            ExamStatus::Published => write!(f, "published"),
            ExamStatus::Archived => write!(f, "archived"),
            ExamStatus::Unpublished => write!(f, "unpublished"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Visibility {
    Private,
    Organization,
    Public,
}

impl Visibility {
    pub fn from_str(s: &str) -> Result<Self, String> {
        match s {
            "private" => Ok(Visibility::Private),
            "organization" => Ok(Visibility::Organization),
            "public" => Ok(Visibility::Public),
            _ => Err(format!("Invalid Visibility: {}", s)),
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Visibility::Private => "private",
            Visibility::Organization => "organization",
            Visibility::Public => "public",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "sqlx", derive(FromRow))]
#[serde(rename_all = "camelCase")]
pub struct ExamVersion {
    pub id: String,
    pub exam_id: String,
    pub version_number: i32,
    pub parent_version_id: Option<String>,
    pub content_snapshot: ExamContentSnapshot,
    pub config_snapshot: ExamConfigSnapshot,
    pub validation_snapshot: Option<ExamValidationSnapshot>,
    pub created_by: String,
    pub created_at: DateTime<Utc>,
    pub publish_notes: Option<String>,
    pub is_draft: bool,
    pub is_published: bool,
    pub revision: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "sqlx", derive(FromRow))]
#[serde(rename_all = "camelCase")]
pub struct ExamVersionSummary {
    pub id: String,
    pub exam_id: String,
    pub version_number: i32,
    pub parent_version_id: Option<String>,
    pub validation_snapshot: Option<ExamValidationSnapshot>,
    pub created_by: String,
    pub created_at: DateTime<Utc>,
    pub publish_notes: Option<String>,
    pub is_draft: bool,
    pub is_published: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "sqlx", derive(FromRow))]
#[serde(rename_all = "camelCase")]
pub struct ExamEvent {
    pub id: String,
    pub exam_id: String,
    pub version_id: Option<String>,
    pub actor_id: String,
    pub action: ExamEventAction,
    pub from_state: Option<String>,
    pub to_state: Option<String>,
    pub payload: Option<ExamEventPayload>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ExamEventAction {
    Created,
    DraftSaved,
    SubmittedForReview,
    Approved,
    Rejected,
    Published,
    Unpublished,
    Scheduled,
    Archived,
    Restored,
    Cloned,
    VersionCreated,
    VersionRestored,
    PermissionsUpdated,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "sqlx", derive(FromRow))]
#[serde(rename_all = "camelCase")]
pub struct ExamMembership {
    pub id: String,
    pub exam_id: String,
    pub actor_id: String,
    pub role: MembershipRole,
    pub granted_by: String,
    pub created_at: DateTime<Utc>,
    pub revoked_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MembershipRole {
    Owner,
    Reviewer,
    Grader,
}

#[cfg(feature = "sqlx")]
mod sqlx_text_enums {
    use super::{ExamEventAction, MembershipRole};

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

    impl_text_enum!(ExamEventAction, {
        Created => "created",
        DraftSaved => "draft_saved",
        SubmittedForReview => "submitted_for_review",
        Approved => "approved",
        Rejected => "rejected",
        Published => "published",
        Unpublished => "unpublished",
        Scheduled => "scheduled",
        Archived => "archived",
        Restored => "restored",
        Cloned => "cloned",
        VersionCreated => "version_created",
        VersionRestored => "version_restored",
        PermissionsUpdated => "permissions_updated",
    });

    impl_text_enum!(MembershipRole, {
        Owner => "owner",
        Reviewer => "reviewer",
        Grader => "grader",
    });
}

#[cfg(feature = "sqlx")]
mod sqlx_json_wrappers {
    use super::{
        ExamConfigSnapshot, ExamContentSnapshot, ExamEventPayload, ExamValidationSnapshot,
    };
    use sqlx::{
        decode::Decode, encode::Encode, error::BoxDynError, mysql::MySqlTypeInfo, MySql, Type,
    };

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

    impl_json_wrapper_type!(ExamContentSnapshot);
    impl_json_wrapper_type!(ExamConfigSnapshot);
    impl_json_wrapper_type!(ExamValidationSnapshot);
    impl_json_wrapper_type!(ExamEventPayload);
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateExamRequest {
    pub slug: String,
    pub title: String,
    pub exam_type: String,
    pub visibility: String,
    pub organization_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateExamRequest {
    pub title: Option<String>,
    pub status: Option<String>,
    pub visibility: Option<String>,
    pub organization_id: Option<String>,
    pub revision: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveDraftRequest {
    pub content_snapshot: serde_json::Value,
    pub config_snapshot: serde_json::Value,
    pub revision: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishExamRequest {
    pub publish_notes: Option<String>,
    pub revision: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloneExamRequest {
    pub new_slug: String,
    pub new_title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ValidationIssue {
    pub field: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExamValidationSummary {
    pub exam_id: String,
    pub draft_version_id: Option<String>,
    pub can_publish: bool,
    pub errors: Vec<ValidationIssue>,
    pub warnings: Vec<ValidationIssue>,
    pub validated_at: DateTime<Utc>,
}

/// Metadata-only representation for lists and lazy-loading
/// Contains version info plus content size hints for client-side decisions
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "sqlx", derive(FromRow))]
#[serde(rename_all = "camelCase")]
pub struct ExamVersionMetadata {
    pub id: String,
    pub exam_id: String,
    pub version_number: i32,
    pub parent_version_id: Option<String>,
    pub validation_snapshot: Option<ExamValidationSnapshot>,
    pub created_by: String,
    pub created_at: DateTime<Utc>,
    pub publish_notes: Option<String>,
    pub is_draft: bool,
    pub is_published: bool,
    pub revision: i32,
    /// Approximate size of content_snapshot in bytes (computed via OCTET_LENGTH)
    pub content_size_bytes: Option<i64>,
    /// Approximate size of config_snapshot in bytes (computed via OCTET_LENGTH)
    pub config_size_bytes: Option<i64>,
}

/// Lossless editable content projection for builder/admin consumers.
/// Answer-key and configuration fields must be preserved in this projection.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExamVersionBuilderContent {
    pub content_snapshot: serde_json::Value,
    pub config_snapshot: serde_json::Value,
}

/// Query parameter for content projection
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VersionProjection {
    /// Full version with all data (default, backward compatible)
    Full,
    /// Metadata only (no content snapshots)
    Metadata,
    /// Builder mode (content with answers stripped)
    Builder,
    /// Grading mode (content with answers included)
    Grading,
}

impl Default for VersionProjection {
    fn default() -> Self {
        Self::Full
    }
}
