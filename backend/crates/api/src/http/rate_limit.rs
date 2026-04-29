//! Rate limiting middleware for Axum routes.
//!
//! Provides extractors that check rate limits before allowing requests.

use axum::{
    extract::{ConnectInfo, FromRequestParts},
    http::{request::Parts, StatusCode},
};
use ielts_backend_infrastructure::rate_limit::{RateLimitConfig, RateLimitKey, RateLimitResult};
use std::net::SocketAddr;

use crate::{http::response::ApiError, state::AppState};

/// Rate limit check result that allows the request through.
#[derive(Debug, Clone)]
pub struct RateLimitChecked;

/// Rate limit check for IP-based limiting (for unauthenticated routes like login).
#[derive(Debug, Clone)]
pub struct IpRateLimitChecked;

/// Rate limit check for user-based limiting (for authenticated routes).
#[derive(Debug, Clone)]
pub struct UserRateLimitChecked;

/// Rate limit check for attempt-based limiting (for student exam hot paths).
#[derive(Debug, Clone)]
pub struct AttemptRateLimitChecked;

/// Extract client IP from connection info.
fn extract_client_ip(connect_info: &ConnectInfo<SocketAddr>) -> std::net::IpAddr {
    connect_info.0.ip()
}

/// Helper function to check rate limit and return appropriate error.
async fn check_rate_limit(
    state: &AppState,
    key: &RateLimitKey,
    config: &RateLimitConfig,
) -> Result<RateLimitChecked, ApiError> {
    match state.rate_limiter.check_with_config(key, config).await {
        RateLimitResult::Allowed { .. } => Ok(RateLimitChecked),
        RateLimitResult::Denied { retry_after } => {
            let retry_secs = retry_after.as_secs();
            Err(ApiError::new(
                StatusCode::TOO_MANY_REQUESTS,
                "RATE_LIMIT_EXCEEDED",
                &format!("Rate limit exceeded. Retry after {} seconds.", retry_secs),
            ))
        }
    }
}

#[async_trait::async_trait]
impl<S> FromRequestParts<S> for IpRateLimitChecked
where
    S: Send + Sync,
{
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        // For IP-based rate limiting, we need the ConnectInfo extension
        // This is a simplified version - in production, you'd extract from state
        Err(ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "NOT_IMPLEMENTED",
            "IP rate limiting requires ConnectInfo extractor.",
        ))
    }
}

/// Create a rate limit key from user ID.
pub fn user_rate_limit_key(user_id: impl Into<String>) -> RateLimitKey {
    RateLimitKey::User(user_id.into())
}

/// Create a rate limit key from attempt ID.
pub fn attempt_rate_limit_key(attempt_id: impl Into<String>) -> RateLimitKey {
    RateLimitKey::Attempt(attempt_id.into())
}

/// Create a rate limit key from IP address.
pub fn ip_rate_limit_key(ip: std::net::IpAddr) -> RateLimitKey {
    RateLimitKey::Ip(ip)
}
