use axum::{
    extract::{Extension, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use axum_extra::extract::cookie::{Cookie, CookieJar, SameSite};
use ielts_backend_application::auth::{AuthError, AuthService};
use ielts_backend_application::scheduling::SchedulingService;
use ielts_backend_domain::auth::{
    AccountActivationRequest, LoginRequest, PasswordResetCompleteRequest, PasswordResetRequest,
    SessionResponse, StudentEntryRequest,
};
use ielts_backend_infrastructure::actor_context::{ActorContext, ActorRole};
use uuid::Uuid;

use ielts_backend_infrastructure::rate_limit::{RateLimitConfig, RateLimitKey, RateLimitResult};

use crate::{
    http::{
        auth::{AuthenticatedUser, VerifiedCsrf},
        request_id::RequestId,
        response::{ApiError, ApiResponse},
        server_busy::server_busy_from_state,
    },
    state::AppState,
};

pub async fn login(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    jar: CookieJar,
    headers: axum::http::HeaderMap,
    Json(req): Json<LoginRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let normalized_email = req.email.trim().to_ascii_lowercase();

    // Apply IP-based rate limiting for login
    if let Some(ip_str) = ip_address(&headers) {
        if let Ok(ip) = ip_str.parse::<std::net::IpAddr>() {
            let key = RateLimitKey::Ip(ip);
            let config = RateLimitConfig::new(
                state.config.rate_limit_login_per_ip,
                state.config.rate_limit_login_per_ip_window_secs,
            );
            match state.rate_limiter.check_with_config(&key, &config).await {
                RateLimitResult::Allowed { .. } => {}
                RateLimitResult::Denied { retry_after } => {
                    return Err(ApiError::new(
                        StatusCode::TOO_MANY_REQUESTS,
                        "RATE_LIMIT_EXCEEDED",
                        &format!("Too many login attempts. Retry after {} seconds.", retry_after.as_secs()),
                    ));
                }
            }
        }
    }

    let account_key = RateLimitKey::Custom(format!("login-account:{normalized_email}"));
    let account_config = RateLimitConfig::new(
        state.config.rate_limit_login_per_account,
        state.config.rate_limit_login_per_account_window_secs,
    );
    match state
        .rate_limiter
        .check_with_config(&account_key, &account_config)
        .await
    {
        RateLimitResult::Allowed { .. } => {}
        RateLimitResult::Denied { retry_after } => {
            return Err(ApiError::new(
                StatusCode::TOO_MANY_REQUESTS,
                "RATE_LIMIT_EXCEEDED",
                &format!(
                    "Too many login attempts for this account. Retry after {} seconds.",
                    retry_after.as_secs()
                ),
            ));
        }
    }

    let service = AuthService::new(state.db_pool(), state.config.clone());
    let issued = service
        .login(req, user_agent(&headers), ip_address(&headers))
        .await
        .map_err(map_auth_error)?;
    let jar = with_auth_cookies(
        jar,
        &state,
        &issued.session_token,
        &issued.response.csrf_token,
    );
    Ok((
        jar,
        ApiResponse::success_with_request_id(issued.response, request_id.0),
    ))
}

pub async fn session(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    headers: axum::http::HeaderMap,
) -> Result<ApiResponse<SessionResponse>, ApiError> {
    let cookie = state.config.auth_session_cookie_name.clone();
    let session_token = extract_cookie(&headers, &cookie).ok_or_else(|| {
        ApiError::new(
            StatusCode::UNAUTHORIZED,
            "UNAUTHORIZED",
            "Authentication is required for this route.",
        )
    })?;
    let service = AuthService::new(state.db_pool(), state.config.clone());
    let response = service
        .session_response(session_token)
        .await
        .map_err(map_auth_error)?
        .ok_or_else(|| {
            ApiError::new(
                StatusCode::UNAUTHORIZED,
                "UNAUTHORIZED",
                "Authentication is required for this route.",
            )
        })?;
    Ok(ApiResponse::success_with_request_id(response, request_id.0))
}

pub async fn logout(
    State(state): State<AppState>,
    jar: CookieJar,
    headers: axum::http::HeaderMap,
    _principal: AuthenticatedUser,
    _csrf: VerifiedCsrf,
) -> Result<impl IntoResponse, ApiError> {
    let service = AuthService::new(state.db_pool(), state.config.clone());
    let session_token = extract_cookie(&headers, &state.config.auth_session_cookie_name)
        .ok_or_else(|| {
            ApiError::new(
                StatusCode::UNAUTHORIZED,
                "UNAUTHORIZED",
                "Authentication is required for this route.",
            )
        })?;
    service
        .logout(session_token)
        .await
        .map_err(map_auth_error)?;
    Ok((
        clear_auth_cookies(jar, &state),
        ApiResponse::success_with_request_id((), ""),
    ))
}

pub async fn logout_all(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    jar: CookieJar,
    principal: AuthenticatedUser,
    _csrf: VerifiedCsrf,
) -> Result<impl IntoResponse, ApiError> {
    let service = AuthService::new(state.db_pool(), state.config.clone());
    service
        .logout_all(principal.user.id)
        .await
        .map_err(map_auth_error)?;
    Ok((
        clear_auth_cookies(jar, &state),
        ApiResponse::success_with_request_id((), request_id.0),
    ))
}

pub async fn activate_account(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    jar: CookieJar,
    headers: axum::http::HeaderMap,
    Json(req): Json<AccountActivationRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let service = AuthService::new(state.db_pool(), state.config.clone());
    let issued = service
        .activate_account(req, user_agent(&headers), ip_address(&headers))
        .await
        .map_err(map_auth_error)?;
    let jar = with_auth_cookies(
        jar,
        &state,
        &issued.session_token,
        &issued.response.csrf_token,
    );
    Ok((
        jar,
        ApiResponse::success_with_request_id(issued.response, request_id.0),
    ))
}

pub async fn request_password_reset(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    headers: axum::http::HeaderMap,
    Json(req): Json<PasswordResetRequest>,
) -> Result<ApiResponse<()>, ApiError> {
    // Apply strict IP-based rate limiting for password reset
    if let Some(ip_str) = ip_address(&headers) {
        if let Ok(ip) = ip_str.parse::<std::net::IpAddr>() {
            let key = RateLimitKey::Ip(ip);
            let config = RateLimitConfig::new(
                state.config.rate_limit_password_reset_per_ip,
                state.config.rate_limit_password_reset_per_ip_window_secs,
            );
            match state.rate_limiter.check_with_config(&key, &config).await {
                RateLimitResult::Allowed { .. } => {}
                RateLimitResult::Denied { retry_after } => {
                    return Err(ApiError::new(
                        StatusCode::TOO_MANY_REQUESTS,
                        "RATE_LIMIT_EXCEEDED",
                        &format!("Too many password reset attempts. Retry after {} seconds.", retry_after.as_secs()),
                    ));
                }
            }
        }
    }

    let service = AuthService::new(state.db_pool(), state.config.clone());
    service
        .request_password_reset(req)
        .await
        .map_err(map_auth_error)?;
    Ok(ApiResponse::success_with_request_id((), request_id.0))
}

pub async fn complete_password_reset(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    jar: CookieJar,
    headers: axum::http::HeaderMap,
    Json(req): Json<PasswordResetCompleteRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let service = AuthService::new(state.db_pool(), state.config.clone());
    let issued = service
        .complete_password_reset(req, user_agent(&headers), ip_address(&headers))
        .await
        .map_err(map_auth_error)?;
    let jar = with_auth_cookies(
        jar,
        &state,
        &issued.session_token,
        &issued.response.csrf_token,
    );
    Ok((
        jar,
        ApiResponse::success_with_request_id(issued.response, request_id.0),
    ))
}

pub async fn student_entry(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    jar: CookieJar,
    headers: axum::http::HeaderMap,
    Json(req): Json<StudentEntryRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let schedule_id = Uuid::parse_str(req.schedule_id.trim()).map_err(|_| {
        ApiError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            "VALIDATION_ERROR",
            "Schedule ID must be a UUID.",
        )
    })?;

    let _permit = state
        .busy_gates
        .student_entry
        .clone()
        .try_acquire_owned()
        .map_err(|_| {
            server_busy_from_state(&state, &request_id.0, "student_entry", Some(schedule_id), Some(req.wcode.trim()))
        })?;

    if req.wcode.trim().is_empty() {
        return Err(ApiError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            "VALIDATION_ERROR",
            "Wcode is required.",
        ));
    }

    if req.student_name.trim().is_empty() {
        return Err(ApiError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            "VALIDATION_ERROR",
            "Student name is required.",
        ));
    }

    if req.email.trim().is_empty() {
        return Err(ApiError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            "VALIDATION_ERROR",
            "Email is required.",
        ));
    }

    let auth_service = AuthService::new(state.db_pool(), state.config.clone());
    let issued = auth_service
        .student_entry(
            schedule_id,
            req.wcode.clone(),
            req.student_name.clone(),
            user_agent(&headers),
            ip_address(&headers),
        )
        .await
        .map_err(map_auth_error)?;

    let user_id = Uuid::parse_str(&issued.response.user.id).map_err(|_| {
        ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "INTERNAL_ERROR",
            "Issued session contained an invalid user id.",
        )
    })?;

    let ctx = ActorContext::new(user_id.to_string(), ActorRole::Student)
        .with_schedule_scope_id(schedule_id.to_string());
    let scheduling_service = SchedulingService::new(state.db_pool());
    scheduling_service
        .create_student_registration(
            &ctx,
            schedule_id,
            req.wcode,
            req.email,
            req.student_name,
            user_id,
        )
        .await?;

    let jar = with_auth_cookies(
        jar,
        &state,
        &issued.session_token,
        &issued.response.csrf_token,
    );

    Ok((
        jar,
        ApiResponse::success_with_request_id(issued.response, request_id.0),
    ))
}

fn with_auth_cookies(
    jar: CookieJar,
    state: &AppState,
    session_token: &str,
    csrf_token: &str,
) -> CookieJar {
    let secure = state.config.auth_cookie_secure;
    let session_cookie = Cookie::build((
        state.config.auth_session_cookie_name.clone(),
        session_token.to_owned(),
    ))
    .http_only(true)
    .same_site(SameSite::Lax)
    .path("/")
    .secure(secure)
    .build();
    let csrf_cookie = Cookie::build((
        state.config.auth_csrf_cookie_name.clone(),
        csrf_token.to_owned(),
    ))
    .http_only(false)
    .same_site(SameSite::Lax)
    .path("/")
    .secure(secure)
    .build();
    jar.add(session_cookie).add(csrf_cookie)
}

fn clear_auth_cookies(jar: CookieJar, state: &AppState) -> CookieJar {
    let session_cookie = Cookie::build((state.config.auth_session_cookie_name.clone(), ""))
        .path("/")
        .build();
    let csrf_cookie = Cookie::build((state.config.auth_csrf_cookie_name.clone(), ""))
        .path("/")
        .build();
    jar.remove(session_cookie).remove(csrf_cookie)
}

fn extract_cookie<'a>(headers: &'a axum::http::HeaderMap, name: &str) -> Option<&'a str> {
    headers
        .get(axum::http::header::COOKIE)?
        .to_str()
        .ok()?
        .split(';')
        .find_map(|pair| {
            let (key, value) = pair.trim().split_once('=')?;
            if key == name {
                Some(value)
            } else {
                None
            }
        })
}

fn user_agent(headers: &axum::http::HeaderMap) -> Option<&str> {
    headers
        .get(axum::http::header::USER_AGENT)
        .and_then(|value| value.to_str().ok())
}

fn ip_address(headers: &axum::http::HeaderMap) -> Option<&str> {
    let raw = headers
        .get("x-forwarded-for")
        .and_then(|value| value.to_str().ok())?;
    let first = raw.split(',').next()?.trim();
    if first.is_empty() || first.eq_ignore_ascii_case("unknown") {
        None
    } else {
        Some(first)
    }
}

fn map_auth_error(error: AuthError) -> ApiError {
    match error {
        AuthError::Database(err) => ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "DATABASE_ERROR",
            &err.to_string(),
        ),
        AuthError::InvalidCredentials | AuthError::Unauthorized => ApiError::new(
            StatusCode::UNAUTHORIZED,
            "UNAUTHORIZED",
            "Invalid email or password.",
        ),
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
