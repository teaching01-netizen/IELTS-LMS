use std::fmt;

use uuid::Uuid;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ActorRole {
    Admin,
    Builder,
    Student,
    Proctor,
    Grader,
    AdminObserver,
}

impl ActorRole {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Admin => "admin",
            Self::Builder => "builder",
            Self::Student => "student",
            Self::Proctor => "proctor",
            Self::Grader => "grader",
            Self::AdminObserver => "admin_observer",
        }
    }
}

impl fmt::Display for ActorRole {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ActorContext {
    pub actor_id: String,
    pub role: ActorRole,
    pub organization_id: Option<String>,
    pub schedule_scope_id: Option<String>,
    pub student_scope_key: Option<String>,
}

impl ActorContext {
    pub fn new(actor_id: String, role: ActorRole) -> Self {
        Self {
            actor_id,
            role,
            organization_id: None,
            schedule_scope_id: None,
            student_scope_key: None,
        }
    }

    pub fn with_organization_id(mut self, organization_id: String) -> Self {
        self.organization_id = Some(organization_id);
        self
    }

    pub fn with_schedule_scope_id(mut self, schedule_scope_id: String) -> Self {
        self.schedule_scope_id = Some(schedule_scope_id);
        self
    }

    pub fn with_student_scope_key(mut self, student_scope_key: impl Into<String>) -> Self {
        self.student_scope_key = Some(student_scope_key.into());
        self
    }
}
