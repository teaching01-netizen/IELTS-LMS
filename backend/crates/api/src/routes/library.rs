use axum::{
    extract::{Extension, Path, State},
    http::StatusCode,
    Json,
};
use ielts_backend_application::library::{LibraryError, LibraryService};
use ielts_backend_domain::auth::UserRole;
use ielts_backend_domain::library::{
    CreatePassageRequest, CreateQuestionRequest, PassageLibraryItem, QuestionBankItem,
    UpdatePassageRequest, UpdateQuestionRequest,
};
use uuid::Uuid;

use crate::{
    http::{
        auth::{AuthenticatedUser, VerifiedCsrf},
        request_id::RequestId,
        response::{ApiError, ApiResponse},
    },
    state::AppState,
};

// Passage routes

pub async fn create_passage(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    _csrf: VerifiedCsrf,
    Json(req): Json<CreatePassageRequest>,
) -> Result<ApiResponse<PassageLibraryItem>, ApiError> {
    principal.require_one_of(&[UserRole::Admin, UserRole::Builder])?;
    let ctx = principal.actor_context();
    let service = LibraryService::new(state.db_pool());
    let passage = service.create_passage(&ctx, req).await?;
    Ok(ApiResponse::success_with_request_id(passage, request_id.0))
}

pub async fn get_passage(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    Path(id): Path<Uuid>,
) -> Result<ApiResponse<PassageLibraryItem>, ApiError> {
    principal.require_one_of(&[UserRole::Admin, UserRole::AdminObserver, UserRole::Builder])?;
    let ctx = principal.actor_context();
    let service = LibraryService::new(state.db_pool());
    let passage = service.get_passage(&ctx, id).await?;
    Ok(ApiResponse::success_with_request_id(passage, request_id.0))
}

pub async fn update_passage(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    _csrf: VerifiedCsrf,
    Path(id): Path<Uuid>,
    Json(req): Json<UpdatePassageRequest>,
) -> Result<ApiResponse<PassageLibraryItem>, ApiError> {
    principal.require_one_of(&[UserRole::Admin, UserRole::Builder])?;
    let ctx = principal.actor_context();
    let service = LibraryService::new(state.db_pool());
    let passage = service.update_passage(&ctx, id, req).await?;
    Ok(ApiResponse::success_with_request_id(passage, request_id.0))
}

pub async fn delete_passage(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    _csrf: VerifiedCsrf,
    Path(id): Path<Uuid>,
) -> Result<ApiResponse<()>, ApiError> {
    principal.require_one_of(&[UserRole::Admin, UserRole::Builder])?;
    let ctx = principal.actor_context();
    let service = LibraryService::new(state.db_pool());
    service.delete_passage(&ctx, id).await?;
    Ok(ApiResponse::success_with_request_id((), request_id.0))
}

pub async fn list_passages(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
) -> Result<ApiResponse<Vec<PassageLibraryItem>>, ApiError> {
    principal.require_one_of(&[UserRole::Admin, UserRole::AdminObserver, UserRole::Builder])?;
    let ctx = principal.actor_context();
    let service = LibraryService::new(state.db_pool());
    let passages = service.list_passages(&ctx, None, None, 25).await?;
    Ok(ApiResponse::success_with_request_id(passages, request_id.0))
}

// Question routes

pub async fn create_question(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    _csrf: VerifiedCsrf,
    Json(req): Json<CreateQuestionRequest>,
) -> Result<ApiResponse<QuestionBankItem>, ApiError> {
    principal.require_one_of(&[UserRole::Admin, UserRole::Builder])?;
    let ctx = principal.actor_context();
    let service = LibraryService::new(state.db_pool());
    let question = service.create_question(&ctx, req).await?;
    Ok(ApiResponse::success_with_request_id(question, request_id.0))
}

pub async fn get_question(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    Path(id): Path<Uuid>,
) -> Result<ApiResponse<QuestionBankItem>, ApiError> {
    principal.require_one_of(&[UserRole::Admin, UserRole::AdminObserver, UserRole::Builder])?;
    let ctx = principal.actor_context();
    let service = LibraryService::new(state.db_pool());
    let question = service.get_question(&ctx, id).await?;
    Ok(ApiResponse::success_with_request_id(question, request_id.0))
}

pub async fn update_question(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    _csrf: VerifiedCsrf,
    Path(id): Path<Uuid>,
    Json(req): Json<UpdateQuestionRequest>,
) -> Result<ApiResponse<QuestionBankItem>, ApiError> {
    principal.require_one_of(&[UserRole::Admin, UserRole::Builder])?;
    let ctx = principal.actor_context();
    let service = LibraryService::new(state.db_pool());
    let question = service.update_question(&ctx, id, req).await?;
    Ok(ApiResponse::success_with_request_id(question, request_id.0))
}

pub async fn delete_question(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    _csrf: VerifiedCsrf,
    Path(id): Path<Uuid>,
) -> Result<ApiResponse<()>, ApiError> {
    principal.require_one_of(&[UserRole::Admin, UserRole::Builder])?;
    let ctx = principal.actor_context();
    let service = LibraryService::new(state.db_pool());
    service.delete_question(&ctx, id).await?;
    Ok(ApiResponse::success_with_request_id((), request_id.0))
}

pub async fn list_questions(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
) -> Result<ApiResponse<Vec<QuestionBankItem>>, ApiError> {
    principal.require_one_of(&[UserRole::Admin, UserRole::AdminObserver, UserRole::Builder])?;
    let ctx = principal.actor_context();
    let service = LibraryService::new(state.db_pool());
    let questions = service.list_questions(&ctx, None, None, None, 25).await?;
    Ok(ApiResponse::success_with_request_id(
        questions,
        request_id.0,
    ))
}

impl From<LibraryError> for ApiError {
    fn from(err: LibraryError) -> Self {
        match err {
            LibraryError::Conflict(msg) => ApiError::new(StatusCode::CONFLICT, "CONFLICT", &msg),
            LibraryError::NotFound => {
                ApiError::new(StatusCode::NOT_FOUND, "NOT_FOUND", "Resource not found")
            }
            LibraryError::Validation(msg) => {
                ApiError::new(StatusCode::UNPROCESSABLE_ENTITY, "VALIDATION_ERROR", &msg)
            }
            LibraryError::Database(err) => ApiError::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                "DATABASE_ERROR",
                &err.to_string(),
            ),
        }
    }
}
