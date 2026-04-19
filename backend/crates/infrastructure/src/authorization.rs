use crate::actor_context::{ActorContext, ActorRole};
use uuid::Uuid;

/// Application-level authorization service
/// Replaces PostgreSQL RLS policies which are not available in MySQL/TiDB
pub struct AuthorizationService;

impl AuthorizationService {
    /// Check if the actor can access exams for a given organization
    pub fn can_access_organization_exams(actor: &ActorContext, organization_id: String) -> bool {
        match actor.role {
            ActorRole::Admin | ActorRole::AdminObserver => true,
            ActorRole::Builder | ActorRole::Proctor | ActorRole::Grader => {
                actor.organization_id.as_ref() == Some(&organization_id)
            }
            ActorRole::Student => false,
        }
    }

    /// Check if the actor can access a specific schedule
    pub fn can_access_schedule(actor: &ActorContext, schedule_id: String, organization_id: String) -> bool {
        match actor.role {
            ActorRole::Admin | ActorRole::AdminObserver => true,
            ActorRole::Builder | ActorRole::Proctor | ActorRole::Grader => {
                actor.organization_id.as_ref() == Some(&organization_id)
            }
            ActorRole::Student => actor.schedule_scope_id.as_ref() == Some(&schedule_id),
        }
    }

    /// Check if the actor can access student data for a specific schedule
    pub fn can_access_student_data(
        actor: &ActorContext,
        schedule_id: String,
        student_key: &str,
        organization_id: String,
    ) -> bool {
        match actor.role {
            ActorRole::Admin | ActorRole::AdminObserver => true,
            ActorRole::Proctor | ActorRole::Grader => {
                actor.organization_id.as_ref() == Some(&organization_id)
                    && actor.schedule_scope_id.as_ref() == Some(&schedule_id)
            }
            ActorRole::Builder => actor.organization_id.as_ref() == Some(&organization_id),
            ActorRole::Student => {
                actor.schedule_scope_id.as_ref() == Some(&schedule_id)
                    && actor.student_scope_key.as_deref() == Some(student_key)
            }
        }
    }

    /// Check if the actor can modify exam content
    pub fn can_modify_exam_content(actor: &ActorContext, organization_id: String) -> bool {
        matches!(
            actor.role,
            ActorRole::Admin | ActorRole::Builder | ActorRole::AdminObserver
        ) && (actor.role == ActorRole::Admin
            || actor.role == ActorRole::AdminObserver
            || actor.organization_id.as_ref() == Some(&organization_id))
    }

    /// Check if the actor can grade submissions
    pub fn can_grade_submissions(actor: &ActorContext, schedule_id: String, organization_id: String) -> bool {
        match actor.role {
            ActorRole::Admin | ActorRole::AdminObserver => true,
            ActorRole::Grader | ActorRole::Proctor => {
                actor.organization_id.as_ref() == Some(&organization_id)
                    && actor.schedule_scope_id.as_ref() == Some(&schedule_id)
            }
            ActorRole::Builder | ActorRole::Student => false,
        }
    }

    /// Check if the actor can proctor a schedule
    pub fn can_proctor_schedule(actor: &ActorContext, schedule_id: String, organization_id: String) -> bool {
        match actor.role {
            ActorRole::Admin | ActorRole::AdminObserver => true,
            ActorRole::Proctor => {
                actor.organization_id.as_ref() == Some(&organization_id)
                    && actor.schedule_scope_id.as_ref() == Some(&schedule_id)
            }
            ActorRole::Builder | ActorRole::Grader | ActorRole::Student => false,
        }
    }
}
