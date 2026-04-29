use async_trait::async_trait;
use axum::{
    extract::FromRequestParts,
    http::{
        header::{AUTHORIZATION, COOKIE, HOST, ORIGIN, REFERER},
        request::Parts,
        HeaderMap, StatusCode,
    },
};
use ielts_backend_application::auth::{
    AttemptAuthorization, AuthError, AuthService, AuthenticatedSession,
};
use ielts_backend_domain::auth::{User, UserRole, UserSession};
use ielts_backend_infrastructure::actor_context::{ActorContext, ActorRole};
use uuid::Uuid;

use crate::{http::response::ApiError, state::AppState};

#[derive(Debug, Clone)]
pub struct AuthenticatedUser {
    pub user: User,
    pub session: UserSession,
}

#[derive(Debug, Clone)]
pub struct AttemptPrincipal {
    pub authorization: AttemptAuthorization,
}

#[derive(Debug, Clone, Copy)]
pub struct VerifiedCsrf;

impl AuthenticatedUser {
    pub fn actor_context(&self) -> ActorContext {
        ActorContext::new(self.user.id.clone(), self.user.role.actor_role())
    }

    pub fn require_one_of(&self, roles: &[UserRole]) -> Result<(), ApiError> {
        if roles.iter().any(|role| *role == self.user.role) {
            Ok(())
        } else {
            Err(ApiError::new(
                StatusCode::FORBIDDEN,
                "FORBIDDEN",
                "The authenticated user is not allowed to access this route.",
            ))
        }
    }

    pub fn display_name(&self) -> String {
        self.user
            .display_name
            .clone()
            .unwrap_or_else(|| self.user.email.clone())
    }
}

#[async_trait]
impl FromRequestParts<AppState> for AuthenticatedUser {
    type Rejection = ApiError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let headers = parts.headers.clone();
        let cookie_name = state.config.auth_session_cookie_name.clone();
        let pool = state.db_pool();
        let config = state.config.clone();

        let session_token = parse_cookie(headers.get(COOKIE), &cookie_name)
            .ok_or_else(unauthorized)?
            .to_owned();
        let service = AuthService::new(pool, config);
        let session = service
            .current_session(&session_token)
            .await
            .map_err(map_auth_error)?
            .ok_or_else(unauthorized)?;
        Ok(from_session(session))
    }
}

#[async_trait]
impl FromRequestParts<AppState> for AttemptPrincipal {
    type Rejection = ApiError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let bearer = extract_bearer(&parts.headers).map(str::to_owned);
        let pool = state.db_pool();
        let config = state.config.clone();

        let token = bearer.ok_or_else(unauthorized)?;
        let service = AuthService::new(pool, config);
        let authorization = service
            .authorize_attempt_token(&token)
            .await
            .map_err(map_auth_error)?;
        Ok(AttemptPrincipal { authorization })
    }
}

#[async_trait]
impl FromRequestParts<AppState> for VerifiedCsrf {
    type Rejection = ApiError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let headers = parts.headers.clone();
        let host = headers
            .get(HOST)
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned);
        let cookie_name = state.config.auth_session_cookie_name.clone();
        let pool = state.db_pool();
        let config = state.config.clone();

        let session_token = parse_cookie(headers.get(COOKIE), &cookie_name)
            .ok_or_else(unauthorized)?
            .to_owned();
        let service = AuthService::new(pool, config);
        let session = service
            .current_session(&session_token)
            .await
            .map_err(map_auth_error)?
            .ok_or_else(unauthorized)?;
        let csrf_header = headers
            .get("x-csrf-token")
            .and_then(|value| value.to_str().ok())
            .ok_or_else(|| {
                ApiError::new(
                    StatusCode::FORBIDDEN,
                    "CSRF_REJECTED",
                    "Missing x-csrf-token header.",
                )
            })?;
        if csrf_header != session.session.csrf_token {
            return Err(ApiError::new(
                StatusCode::FORBIDDEN,
                "CSRF_REJECTED",
                "CSRF token mismatch.",
            ));
        }
        if !same_origin_allowed(&headers, host.as_deref()) {
            return Err(ApiError::new(
                StatusCode::FORBIDDEN,
                "CSRF_REJECTED",
                "Origin validation failed.",
            ));
        }
        Ok(VerifiedCsrf)
    }
}

pub fn parse_cookie<'a>(
    header: Option<&'a axum::http::HeaderValue>,
    name: &str,
) -> Option<&'a str> {
    let header = header?.to_str().ok()?;
    header.split(';').find_map(|pair| {
        let (key, value) = pair.trim().split_once('=')?;
        if key == name {
            Some(value)
        } else {
            None
        }
    })
}

fn extract_bearer(headers: &HeaderMap) -> Option<&str> {
    let value = headers.get(AUTHORIZATION)?.to_str().ok()?;
    value.strip_prefix("Bearer ")
}

fn same_origin_allowed(headers: &HeaderMap, host: Option<&str>) -> bool {
    let Some(host) = host else {
        return true;
    };

    for header in [ORIGIN, REFERER] {
        let Some(value) = headers.get(header).and_then(|value| value.to_str().ok()) else {
            continue;
        };
        if !value.contains(host) {
            return false;
        }
    }
    true
}

fn unauthorized() -> ApiError {
    ApiError::new(
        StatusCode::UNAUTHORIZED,
        "UNAUTHORIZED",
        "Authentication is required for this route.",
    )
}

fn map_auth_error(error: AuthError) -> ApiError {
    match error {
        AuthError::Database(err) => ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "DATABASE_ERROR",
            &err.to_string(),
        ),
        AuthError::InvalidCredentials | AuthError::Unauthorized => unauthorized(),
        AuthError::Forbidden => ApiError::new(
            StatusCode::FORBIDDEN,
            "FORBIDDEN",
            "The authenticated user is not allowed to access this route.",
        ),
        AuthError::Conflict(message) => ApiError::new(StatusCode::CONFLICT, "CONFLICT", &message),
        AuthError::Validation(message) => ApiError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            "VALIDATION_ERROR",
            &message,
        ),
    }
}

fn from_session(session: AuthenticatedSession) -> AuthenticatedUser {
    AuthenticatedUser {
        user: session.user,
        session: session.session,
    }
}

trait RoleActorExt {
    fn actor_role(&self) -> ActorRole;
}

impl RoleActorExt for UserRole {
    fn actor_role(&self) -> ActorRole {
        match self {
            UserRole::Admin => ActorRole::Admin,
            UserRole::Builder => ActorRole::Builder,
            UserRole::Proctor => ActorRole::Proctor,
            UserRole::Grader => ActorRole::Grader,
            UserRole::Student => ActorRole::Student,
        }
    }
}

pub fn parse_uuid_or_400(value: &str, field: &str) -> Result<Uuid, ApiError> {
    Uuid::parse_str(value).map_err(|_| {
        ApiError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            "VALIDATION_ERROR",
            &format!("{field} must be a valid UUID."),
        )
    })
}

pub fn actor_context_from_principal(principal: &AuthenticatedUser) -> ActorContext {
    ActorContext::new(principal.user.id.clone(), principal.user.role.actor_role())
}
