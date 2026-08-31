use axum::{
    body::Body,
    extract::{Extension, Multipart, Path, State},
    http::{header, Response, StatusCode},
    Json,
};
use ielts_backend_application::assessment_authoring::{
    AssessmentAuthoringError, AssessmentAuthoringService, AssessmentAuthoringShell,
    AssessmentPreviewProjection, AssessmentQuestionDetail, AssessmentQuestionSummary,
    AssessmentValidationReport, BatchCreateQuestionsRequest, BatchCreateQuestionsResult,
    BulkQuestionRequest, BulkQuestionResult, DuplicateQuestionRequest, LoadSampleExamRequest,
    ReorderQuestionsRequest, SatWorkbookCommitResult, SatWorkbookUndoState,
    UpdateSectionDeliverySettingsRequest,
};
use ielts_backend_application::sat_workbook::{
    build_sat_workbook_template, parse_sat_workbook, SatWorkbookCommitRequest, SatWorkbookError,
    SatWorkbookPreview,
};
use ielts_backend_domain::assessment::SaveQuestionRevisionRequest;
use ielts_backend_domain::auth::UserRole;
use uuid::Uuid;

use crate::{
    http::{
        auth::{AuthenticatedUser, VerifiedCsrf},
        request_id::RequestId,
        response::{ApiError, ApiResponse},
    },
    state::AppState,
};

fn map_error(error: AssessmentAuthoringError) -> ApiError {
    match error {
        AssessmentAuthoringError::Database(error) => ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "DATABASE_ERROR",
            &error.to_string(),
        ),
        AssessmentAuthoringError::NotFound => ApiError::new(
            StatusCode::NOT_FOUND,
            "NOT_FOUND",
            "Assessment resource not found.",
        ),
        AssessmentAuthoringError::Conflict(message) => {
            ApiError::new(StatusCode::CONFLICT, "QUESTION_REVISION_CONFLICT", &message)
        }
        AssessmentAuthoringError::Validation(issues) => ApiError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            "VALIDATION_ERROR",
            "Assessment validation failed.",
        )
        .with_details(serde_json::json!({ "issues": issues })),
        AssessmentAuthoringError::InvalidData(message) => ApiError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            "INVALID_ASSESSMENT",
            &message,
        ),
        AssessmentAuthoringError::UnsupportedProvider => ApiError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            "UNSUPPORTED_PROVIDER",
            "The assessment provider is not supported.",
        ),
    }
}

fn map_workbook_error(error: SatWorkbookError) -> ApiError {
    match error {
        SatWorkbookError::TooLarge => ApiError::new(
            StatusCode::PAYLOAD_TOO_LARGE,
            "SAT_WORKBOOK_TOO_LARGE",
            &error.to_string(),
        ),
        SatWorkbookError::InvalidWorkbook(_) => ApiError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            "INVALID_SAT_WORKBOOK",
            &error.to_string(),
        ),
        SatWorkbookError::Template(_) => ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "SAT_WORKBOOK_TEMPLATE_ERROR",
            &error.to_string(),
        ),
    }
}

async fn require_staff(
    state: &AppState,
    principal: &AuthenticatedUser,
    exam_id: &str,
) -> Result<(), ApiError> {
    principal.require_one_of(&[UserRole::Admin, UserRole::Builder])?;
    let ctx = principal.actor_context();
    ielts_backend_application::builder::BuilderService::new(state.db_pool())
        .get_exam(&ctx, exam_id.to_owned())
        .await
        .map(|_| ())
        .map_err(ApiError::from)
}

async fn require_sat_shell(
    state: &AppState,
    principal: &AuthenticatedUser,
    exam_id: &str,
) -> Result<AssessmentAuthoringShell, ApiError> {
    require_staff(state, principal, exam_id).await?;
    let shell = AssessmentAuthoringService::new(state.db_pool())
        .shell(exam_id)
        .await
        .map_err(map_error)?;
    if shell.provider_key != "sat" {
        return Err(ApiError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            "UNSUPPORTED_PROVIDER",
            "SAT workbook import is only available for SAT exams.",
        ));
    }
    Ok(shell)
}

async fn require_module_staff(
    state: &AppState,
    principal: &AuthenticatedUser,
    module_id: &str,
) -> Result<(), ApiError> {
    principal.require_one_of(&[UserRole::Admin, UserRole::Builder])?;
    let pool = state.db_pool();
    let exam_id: Option<String> = sqlx::query_scalar(
        "SELECT v.exam_id FROM assessment_modules m JOIN assessment_sections s ON s.id = m.section_id JOIN exam_versions v ON v.id = s.exam_version_id WHERE m.id = ?",
    )
    .bind(module_id)
    .fetch_optional(&pool)
    .await
    .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "DATABASE_ERROR", &error.to_string()))?;
    require_staff(
        state,
        principal,
        &exam_id.ok_or_else(|| {
            ApiError::new(
                StatusCode::NOT_FOUND,
                "NOT_FOUND",
                "Assessment module not found.",
            )
        })?,
    )
    .await
}

async fn require_exam_question_staff(
    state: &AppState,
    principal: &AuthenticatedUser,
    exam_question_id: &str,
) -> Result<(), ApiError> {
    principal.require_one_of(&[UserRole::Admin, UserRole::Builder])?;
    let pool = state.db_pool();
    let exam_id: Option<String> = sqlx::query_scalar(
        "SELECT v.exam_id FROM assessment_exam_questions eq JOIN assessment_modules m ON m.id = eq.module_id JOIN assessment_sections s ON s.id = m.section_id JOIN exam_versions v ON v.id = s.exam_version_id WHERE eq.id = ?",
    )
    .bind(exam_question_id)
    .fetch_optional(&pool)
    .await
    .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "DATABASE_ERROR", &error.to_string()))?;
    require_staff(
        state,
        principal,
        &exam_id.ok_or_else(|| {
            ApiError::new(
                StatusCode::NOT_FOUND,
                "NOT_FOUND",
                "Assessment question not found.",
            )
        })?,
    )
    .await
}

async fn require_revision_staff(
    state: &AppState,
    principal: &AuthenticatedUser,
    revision_id: &str,
) -> Result<(), ApiError> {
    principal.require_one_of(&[UserRole::Admin, UserRole::Builder])?;
    let pool = state.db_pool();
    let exam_id: Option<String> = sqlx::query_scalar(
        "SELECT v.exam_id FROM assessment_question_revisions qr JOIN assessment_exam_questions eq ON eq.question_revision_id = qr.id JOIN assessment_modules m ON m.id = eq.module_id JOIN assessment_sections s ON s.id = m.section_id JOIN exam_versions v ON v.id = s.exam_version_id WHERE qr.id = ?",
    )
    .bind(revision_id)
    .fetch_optional(&pool)
    .await
    .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "DATABASE_ERROR", &error.to_string()))?;
    require_staff(
        state,
        principal,
        &exam_id.ok_or_else(|| {
            ApiError::new(
                StatusCode::NOT_FOUND,
                "NOT_FOUND",
                "Question revision not found.",
            )
        })?,
    )
    .await
}

pub async fn get_authoring_shell(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    Path(exam_id): Path<Uuid>,
) -> Result<ApiResponse<AssessmentAuthoringShell>, ApiError> {
    let exam_id = exam_id.to_string();
    require_staff(&state, &principal, &exam_id).await?;
    let shell = AssessmentAuthoringService::new(state.db_pool())
        .shell(&exam_id)
        .await
        .map_err(map_error)?;
    Ok(ApiResponse::success_with_request_id(shell, request_id.0))
}

pub async fn get_preview_projection(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    Path(exam_id): Path<Uuid>,
) -> Result<ApiResponse<AssessmentPreviewProjection>, ApiError> {
    let exam_id = exam_id.to_string();
    require_staff(&state, &principal, &exam_id).await?;
    let preview = AssessmentAuthoringService::new(state.db_pool())
        .preview(&exam_id)
        .await
        .map_err(map_error)?;
    Ok(ApiResponse::success_with_request_id(preview, request_id.0))
}

pub async fn open_authoring_shell(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    _csrf: VerifiedCsrf,
    Path(exam_id): Path<Uuid>,
) -> Result<ApiResponse<AssessmentAuthoringShell>, ApiError> {
    let exam_id = exam_id.to_string();
    require_staff(&state, &principal, &exam_id).await?;
    let shell = AssessmentAuthoringService::new(state.db_pool())
        .open_shell(&exam_id, &principal.user.id)
        .await
        .map_err(map_error)?;
    Ok(ApiResponse::success_with_request_id(shell, request_id.0))
}

pub async fn list_questions(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    Path(module_id): Path<Uuid>,
) -> Result<ApiResponse<Vec<AssessmentQuestionSummary>>, ApiError> {
    require_module_staff(&state, &principal, &module_id.to_string()).await?;
    let questions = AssessmentAuthoringService::new(state.db_pool())
        .list_questions(&module_id.to_string())
        .await
        .map_err(map_error)?;
    Ok(ApiResponse::success_with_request_id(
        questions,
        request_id.0,
    ))
}

pub async fn create_question(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    _csrf: VerifiedCsrf,
    Path(module_id): Path<Uuid>,
) -> Result<ApiResponse<AssessmentQuestionDetail>, ApiError> {
    require_module_staff(&state, &principal, &module_id.to_string()).await?;
    let question = AssessmentAuthoringService::new(state.db_pool())
        .create_question(&module_id.to_string(), &principal.user.id)
        .await
        .map_err(map_error)?;
    Ok(ApiResponse::success_with_request_id(question, request_id.0))
}

pub async fn batch_create_questions(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    _csrf: VerifiedCsrf,
    Path(module_id): Path<Uuid>,
    Json(request): Json<BatchCreateQuestionsRequest>,
) -> Result<ApiResponse<BatchCreateQuestionsResult>, ApiError> {
    require_module_staff(&state, &principal, &module_id.to_string()).await?;
    let result = AssessmentAuthoringService::new(state.db_pool())
        .batch_create_questions(&module_id.to_string(), request, &principal.user.id)
        .await
        .map_err(map_error)?;
    Ok(ApiResponse::success_with_request_id(result, request_id.0))
}

pub async fn download_sat_workbook_template(
    State(state): State<AppState>,
    principal: AuthenticatedUser,
    Path(exam_id): Path<Uuid>,
) -> Result<Response<Body>, ApiError> {
    let exam_id = exam_id.to_string();
    require_sat_shell(&state, &principal, &exam_id).await?;
    let bytes = build_sat_workbook_template().map_err(map_workbook_error)?;
    Response::builder()
        .status(StatusCode::OK)
        .header(
            header::CONTENT_TYPE,
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        .header(
            header::CONTENT_DISPOSITION,
            "attachment; filename=SAT-Authoring-Template.xlsx",
        )
        .header(header::CACHE_CONTROL, "private, no-store")
        .body(Body::from(bytes))
        .map_err(|error| {
            ApiError::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                "SAT_WORKBOOK_RESPONSE_ERROR",
                &error.to_string(),
            )
        })
}

pub async fn preview_sat_workbook(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    _csrf: VerifiedCsrf,
    Path(exam_id): Path<Uuid>,
    mut multipart: Multipart,
) -> Result<ApiResponse<SatWorkbookPreview>, ApiError> {
    let exam_id = exam_id.to_string();
    require_sat_shell(&state, &principal, &exam_id).await?;
    let mut workbook = None;
    while let Some(field) = multipart.next_field().await.map_err(|error| {
        ApiError::new(
            StatusCode::BAD_REQUEST,
            "INVALID_MULTIPART",
            &error.to_string(),
        )
    })? {
        if field.name() != Some("file") {
            continue;
        }
        if field
            .file_name()
            .is_some_and(|name| !name.to_ascii_lowercase().ends_with(".xlsx"))
        {
            return Err(ApiError::new(
                StatusCode::UNPROCESSABLE_ENTITY,
                "INVALID_SAT_WORKBOOK_TYPE",
                "Choose an .xlsx SAT workbook.",
            ));
        }
        workbook = Some(field.bytes().await.map_err(|error| {
            ApiError::new(
                StatusCode::BAD_REQUEST,
                "SAT_WORKBOOK_READ_ERROR",
                &error.to_string(),
            )
        })?);
        break;
    }
    let workbook = workbook.ok_or_else(|| {
        ApiError::new(
            StatusCode::BAD_REQUEST,
            "SAT_WORKBOOK_REQUIRED",
            "Attach an .xlsx workbook in the file field.",
        )
    })?;
    let preview = parse_sat_workbook(&workbook).map_err(map_workbook_error)?;
    if preview.valid {
        AssessmentAuthoringService::new(state.db_pool())
            .register_sat_workbook_preview(&exam_id, &preview, &principal.user.id)
            .await
            .map_err(map_error)?;
    }
    Ok(ApiResponse::success_with_request_id(preview, request_id.0))
}

pub async fn commit_sat_workbook(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    _csrf: VerifiedCsrf,
    Path(exam_id): Path<Uuid>,
    Json(request): Json<SatWorkbookCommitRequest>,
) -> Result<ApiResponse<SatWorkbookCommitResult>, ApiError> {
    let exam_id = exam_id.to_string();
    require_staff(&state, &principal, &exam_id).await?;
    let result = AssessmentAuthoringService::new(state.db_pool())
        .commit_sat_workbook(&exam_id, request, &principal.user.id)
        .await
        .map_err(map_error)?;
    Ok(ApiResponse::success_with_request_id(result, request_id.0))
}

pub async fn get_sat_workbook_undo_state(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    Path(exam_id): Path<Uuid>,
) -> Result<ApiResponse<Option<SatWorkbookUndoState>>, ApiError> {
    let exam_id = exam_id.to_string();
    require_sat_shell(&state, &principal, &exam_id).await?;
    let state = AssessmentAuthoringService::new(state.db_pool())
        .sat_workbook_undo_state(&exam_id)
        .await
        .map_err(map_error)?;
    Ok(ApiResponse::success_with_request_id(state, request_id.0))
}

pub async fn undo_sat_workbook_import(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    _csrf: VerifiedCsrf,
    Path((exam_id, import_id)): Path<(Uuid, Uuid)>,
) -> Result<ApiResponse<AssessmentAuthoringShell>, ApiError> {
    let exam_id = exam_id.to_string();
    require_staff(&state, &principal, &exam_id).await?;
    let shell = AssessmentAuthoringService::new(state.db_pool())
        .undo_sat_workbook_import(&exam_id, &import_id.to_string(), &principal.user.id)
        .await
        .map_err(map_error)?;
    Ok(ApiResponse::success_with_request_id(shell, request_id.0))
}

pub async fn load_sample_exam(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    _csrf: VerifiedCsrf,
    Path(exam_id): Path<Uuid>,
    Json(request): Json<LoadSampleExamRequest>,
) -> Result<ApiResponse<AssessmentAuthoringShell>, ApiError> {
    let exam_id = exam_id.to_string();
    require_staff(&state, &principal, &exam_id).await?;
    let shell = AssessmentAuthoringService::new(state.db_pool())
        .load_sample_exam(&exam_id, request, &principal.user.id)
        .await
        .map_err(map_error)?;
    Ok(ApiResponse::success_with_request_id(shell, request_id.0))
}

pub async fn get_exam_question(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    Path(exam_question_id): Path<Uuid>,
) -> Result<ApiResponse<AssessmentQuestionDetail>, ApiError> {
    require_exam_question_staff(&state, &principal, &exam_question_id.to_string()).await?;
    let question = AssessmentAuthoringService::new(state.db_pool())
        .question(&exam_question_id.to_string())
        .await
        .map_err(map_error)?;
    Ok(ApiResponse::success_with_request_id(question, request_id.0))
}

pub async fn delete_exam_question(
    State(state): State<AppState>,
    principal: AuthenticatedUser,
    _csrf: VerifiedCsrf,
    Path(exam_question_id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    require_exam_question_staff(&state, &principal, &exam_question_id.to_string()).await?;
    AssessmentAuthoringService::new(state.db_pool())
        .delete_question(&exam_question_id.to_string())
        .await
        .map_err(map_error)?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn patch_question_revision(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    _csrf: VerifiedCsrf,
    Path(revision_id): Path<Uuid>,
    Json(request): Json<SaveQuestionRevisionRequest>,
) -> Result<ApiResponse<ielts_backend_domain::assessment::QuestionRevision>, ApiError> {
    require_revision_staff(&state, &principal, &revision_id.to_string()).await?;
    let question = AssessmentAuthoringService::new(state.db_pool())
        .save_question_revision(&revision_id.to_string(), request, &principal.user.id)
        .await
        .map_err(map_error)?;
    Ok(ApiResponse::success_with_request_id(question, request_id.0))
}

pub async fn update_section_delivery_settings(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    _csrf: VerifiedCsrf,
    Path((exam_id, section_id)): Path<(Uuid, Uuid)>,
    Json(request): Json<UpdateSectionDeliverySettingsRequest>,
) -> Result<ApiResponse<AssessmentAuthoringShell>, ApiError> {
    let exam_id = exam_id.to_string();
    require_staff(&state, &principal, &exam_id).await?;
    let shell = AssessmentAuthoringService::new(state.db_pool())
        .update_section_delivery_settings(&exam_id, &section_id.to_string(), request)
        .await
        .map_err(map_error)?;
    Ok(ApiResponse::success_with_request_id(shell, request_id.0))
}

pub async fn validate_exam(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    Path(exam_id): Path<Uuid>,
) -> Result<ApiResponse<AssessmentValidationReport>, ApiError> {
    let exam_id = exam_id.to_string();
    require_staff(&state, &principal, &exam_id).await?;
    let report = AssessmentAuthoringService::new(state.db_pool())
        .validate(&exam_id)
        .await
        .map_err(map_error)?;
    Ok(ApiResponse::success_with_request_id(report, request_id.0))
}

pub async fn duplicate_exam_question(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    _csrf: VerifiedCsrf,
    Path(exam_question_id): Path<Uuid>,
    Json(request): Json<DuplicateQuestionRequest>,
) -> Result<ApiResponse<AssessmentQuestionDetail>, ApiError> {
    require_exam_question_staff(&state, &principal, &exam_question_id.to_string()).await?;
    let question = AssessmentAuthoringService::new(state.db_pool())
        .duplicate_question(&exam_question_id.to_string(), request, &principal.user.id)
        .await
        .map_err(map_error)?;
    Ok(ApiResponse::success_with_request_id(question, request_id.0))
}

pub async fn reorder_module_questions(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    _csrf: VerifiedCsrf,
    Path(module_id): Path<Uuid>,
    Json(request): Json<ReorderQuestionsRequest>,
) -> Result<ApiResponse<Vec<AssessmentQuestionSummary>>, ApiError> {
    require_module_staff(&state, &principal, &module_id.to_string()).await?;
    let questions = AssessmentAuthoringService::new(state.db_pool())
        .reorder_questions(&module_id.to_string(), request)
        .await
        .map_err(map_error)?;
    Ok(ApiResponse::success_with_request_id(
        questions,
        request_id.0,
    ))
}

pub async fn bulk_questions(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    _csrf: VerifiedCsrf,
    Json(request): Json<BulkQuestionRequest>,
) -> Result<ApiResponse<BulkQuestionResult>, ApiError> {
    principal.require_one_of(&[UserRole::Admin, UserRole::Builder])?;
    if let Some(first_question_id) = request.question_ids.first() {
        require_exam_question_staff(&state, &principal, first_question_id).await?;
    }
    let result = AssessmentAuthoringService::new(state.db_pool())
        .bulk_questions(request, &principal.user.id)
        .await
        .map_err(map_error)?;
    Ok(ApiResponse::success_with_request_id(result, request_id.0))
}
