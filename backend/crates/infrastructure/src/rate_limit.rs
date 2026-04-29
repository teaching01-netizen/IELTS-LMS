//! Rate limiting infrastructure for API protection.
//!
//! Provides token-bucket rate limiting with configurable limits per route category.
//! Supports limiting by IP address, user ID, attempt ID, and custom keys.

use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;

/// Unique identifier for a rate limit bucket.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum RateLimitKey {
    /// Limit by IP address (for unauthenticated or login routes)
    Ip(IpAddr),
    /// Limit by user ID (for authenticated routes)
    User(String),
    /// Limit by attempt ID (for student exam hot paths)
    Attempt(String),
    /// Custom key for specialized limiting
    Custom(String),
}

/// Result of a rate limit check.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RateLimitResult {
    /// Request is allowed, remaining requests and reset time included.
    Allowed {
        remaining: u32,
        reset_after: Duration,
    },
    /// Request is denied, retry after duration provided.
    Denied { retry_after: Duration },
}

/// Configuration for a single rate limit bucket.
#[derive(Debug, Clone, Copy)]
pub struct RateLimitConfig {
    /// Maximum number of requests allowed in the window.
    pub max_requests: u32,
    /// Time window for the rate limit.
    pub window: Duration,
    /// Burst allowance for short spikes.
    pub burst: u32,
}

impl RateLimitConfig {
    /// Create a new rate limit configuration.
    pub fn new(max_requests: u32, window_secs: u64) -> Self {
        Self {
            max_requests,
            window: Duration::from_secs(window_secs),
            burst: 0,
        }
    }

    /// Set burst allowance.
    pub fn with_burst(mut self, burst: u32) -> Self {
        self.burst = burst;
        self
    }
}

/// A single bucket tracking request capacity.
#[derive(Debug)]
struct Bucket {
    tokens: f64,
    last_refill: Instant,
    window: Duration,
    max_requests: u32,
    burst: u32,
    last_seen: Instant,
}

impl Bucket {
    fn new(config: &RateLimitConfig, now: Instant) -> Self {
        let capacity = config.max_requests.saturating_add(config.burst);
        Self {
            tokens: capacity as f64,
            last_refill: now,
            window: config.window,
            max_requests: config.max_requests,
            burst: config.burst,
            last_seen: now,
        }
    }

    fn check_and_record(&mut self, now: Instant) -> RateLimitResult {
        self.last_seen = now;
        self.refill(now);

        let effective_limit = self.capacity();

        if self.tokens < 1.0 {
            return RateLimitResult::Denied {
                retry_after: self.retry_after(),
            };
        }

        self.tokens -= 1.0;

        let remaining = self.tokens.floor().min(effective_limit as f64) as u32;
        let reset_after = self.reset_after();

        RateLimitResult::Allowed {
            remaining,
            reset_after,
        }
    }

    fn peek(&self, now: Instant) -> RateLimitResult {
        let mut projected = self.clone_for_peek();
        projected.refill(now);
        let effective_limit = projected.capacity();

        if projected.tokens < 1.0 {
            RateLimitResult::Denied {
                retry_after: projected.retry_after(),
            }
        } else {
            RateLimitResult::Allowed {
                remaining: projected.tokens.floor().min(effective_limit as f64) as u32,
                reset_after: projected.reset_after(),
            }
        }
    }

    fn refill(&mut self, now: Instant) {
        let elapsed = now.saturating_duration_since(self.last_refill);
        if elapsed.is_zero() {
            return;
        }

        let capacity = self.capacity() as f64;
        let refill_per_second = capacity / self.window.as_secs_f64().max(1.0);
        self.tokens = (self.tokens + elapsed.as_secs_f64() * refill_per_second).min(capacity);
        self.last_refill = now;
    }

    fn is_idle(&mut self, now: Instant) -> bool {
        self.refill(now);
        self.tokens >= self.capacity() as f64
    }

    fn capacity(&self) -> u32 {
        self.max_requests.saturating_add(self.burst).max(1)
    }

    fn retry_after(&self) -> Duration {
        let capacity = self.capacity() as f64;
        let refill_per_second = capacity / self.window.as_secs_f64().max(1.0);
        Duration::from_secs_f64(((1.0 - self.tokens).max(0.0)) / refill_per_second)
    }

    fn reset_after(&self) -> Duration {
        let capacity = self.capacity() as f64;
        let missing_tokens = (capacity - self.tokens).max(0.0);
        let refill_per_second = capacity / self.window.as_secs_f64().max(1.0);
        Duration::from_secs_f64(missing_tokens / refill_per_second)
    }

    fn clone_for_peek(&self) -> Self {
        Self {
            tokens: self.tokens,
            last_refill: self.last_refill,
            window: self.window,
            max_requests: self.max_requests,
            burst: self.burst,
            last_seen: self.last_seen,
        }
    }
}

/// In-memory token-bucket rate limiter.
#[derive(Debug, Clone)]
pub struct RateLimiter {
    buckets: Arc<RwLock<HashMap<RateLimitKey, Bucket>>>,
    default_config: RateLimitConfig,
    bucket_cap: usize,
}

impl RateLimiter {
    /// Create a new rate limiter with default configuration.
    pub fn new(default_config: RateLimitConfig) -> Self {
        Self::with_bucket_cap(default_config, 10_000)
    }

    /// Create a new rate limiter with an upper bound on tracked buckets.
    pub fn with_bucket_cap(default_config: RateLimitConfig, bucket_cap: usize) -> Self {
        Self {
            buckets: Arc::new(RwLock::new(HashMap::new())),
            default_config,
            bucket_cap: bucket_cap.max(1),
        }
    }

    /// Check if a request is allowed and record it.
    pub async fn check(&self, key: &RateLimitKey) -> RateLimitResult {
        let now = Instant::now();
        let mut buckets = self.buckets.write().await;
        self.evict_if_needed(&mut buckets, key, now);

        let bucket = buckets
            .entry(key.clone())
            .or_insert_with(|| Bucket::new(&self.default_config, now));

        bucket.check_and_record(now)
    }

    /// Check with a specific configuration (for route-specific limits).
    pub async fn check_with_config(
        &self,
        key: &RateLimitKey,
        config: &RateLimitConfig,
    ) -> RateLimitResult {
        let now = Instant::now();
        let mut buckets = self.buckets.write().await;
        self.evict_if_needed(&mut buckets, key, now);

        // Use entry API to handle the case where bucket exists with different config
        let bucket = buckets
            .entry(key.clone())
            .or_insert_with(|| Bucket::new(config, now));

        // If bucket exists but was created with different config, we keep using it
        // (config changes only affect new buckets)
        bucket.check_and_record(now)
    }

    /// Get current state without recording (for status checks).
    pub async fn peek(&self, key: &RateLimitKey) -> Option<RateLimitResult> {
        let now = Instant::now();
        let buckets = self.buckets.read().await;

        buckets.get(key).map(|bucket| bucket.peek(now))
    }

    /// Clean up expired buckets to prevent memory growth.
    pub async fn cleanup(&self) {
        let now = Instant::now();
        let mut buckets = self.buckets.write().await;

        buckets.retain(|_, bucket| !bucket.is_idle(now));
    }

    /// Returns the number of active buckets currently stored.
    pub async fn bucket_count(&self) -> usize {
        self.buckets.read().await.len()
    }

    fn evict_if_needed(
        &self,
        buckets: &mut HashMap<RateLimitKey, Bucket>,
        incoming_key: &RateLimitKey,
        now: Instant,
    ) {
        if buckets.contains_key(incoming_key) || buckets.len() < self.bucket_cap {
            return;
        }

        buckets.retain(|_, bucket| !bucket.is_idle(now));

        while buckets.len() >= self.bucket_cap {
            let Some(oldest_key) = buckets
                .iter()
                .min_by_key(|(_, bucket)| bucket.last_seen)
                .map(|(key, _)| key.clone())
            else {
                break;
            };
            buckets.remove(&oldest_key);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::Ipv4Addr;
    use uuid::Uuid;

    #[tokio::test]
    async fn allows_requests_under_limit() {
        let limiter = RateLimiter::new(RateLimitConfig::new(5, 60));
        let key = RateLimitKey::Ip(IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1)));

        // Should allow 5 requests
        for i in 0..5 {
            let result = limiter.check(&key).await;
            assert!(
                matches!(result, RateLimitResult::Allowed { remaining, .. } if remaining == 5 - i - 1),
                "Request {} should be allowed with {} remaining",
                i + 1,
                5 - i - 1
            );
        }
    }

    #[tokio::test]
    async fn denies_requests_over_limit() {
        let limiter = RateLimiter::new(RateLimitConfig::new(2, 60));
        let key = RateLimitKey::Ip(IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1)));

        // First 2 requests allowed
        assert!(matches!(
            limiter.check(&key).await,
            RateLimitResult::Allowed { .. }
        ));
        assert!(matches!(
            limiter.check(&key).await,
            RateLimitResult::Allowed { .. }
        ));

        // Third request denied
        let result = limiter.check(&key).await;
        assert!(
            matches!(result, RateLimitResult::Denied { .. }),
            "Third request should be denied"
        );
    }

    #[tokio::test]
    async fn burst_allows_temporary_spike() {
        let limiter = RateLimiter::new(RateLimitConfig::new(2, 60).with_burst(3));
        let key = RateLimitKey::Ip(IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1)));

        // Should allow 5 requests (2 base + 3 burst)
        for i in 0..5 {
            let result = limiter.check(&key).await;
            assert!(
                matches!(result, RateLimitResult::Allowed { .. }),
                "Request {} should be allowed with burst",
                i + 1
            );
        }

        // Sixth request denied
        let result = limiter.check(&key).await;
        assert!(
            matches!(result, RateLimitResult::Denied { .. }),
            "Sixth request should be denied"
        );
    }

    #[tokio::test]
    async fn different_keys_have_separate_buckets() {
        let limiter = RateLimiter::new(RateLimitConfig::new(1, 60));
        let key1 = RateLimitKey::Ip(IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1)));
        let key2 = RateLimitKey::Ip(IpAddr::V4(Ipv4Addr::new(127, 0, 0, 2)));

        // First IP uses its only request
        assert!(matches!(
            limiter.check(&key1).await,
            RateLimitResult::Allowed { .. }
        ));
        assert!(matches!(
            limiter.check(&key1).await,
            RateLimitResult::Denied { .. }
        ));

        // Second IP still has its request available
        assert!(matches!(
            limiter.check(&key2).await,
            RateLimitResult::Allowed { .. }
        ));
    }

    #[tokio::test]
    async fn user_keys_work_correctly() {
        let limiter = RateLimiter::new(RateLimitConfig::new(3, 60));
        let user_id = Uuid::new_v4().to_string();
        let key = RateLimitKey::User(user_id);

        for i in 0..3 {
            let result = limiter.check(&key).await;
            assert!(
                matches!(result, RateLimitResult::Allowed { remaining, .. } if remaining == 3 - i - 1),
                "User request {} should be allowed",
                i + 1
            );
        }

        assert!(matches!(
            limiter.check(&key).await,
            RateLimitResult::Denied { .. }
        ));
    }

    #[tokio::test]
    async fn attempt_keys_for_student_hot_paths() {
        let limiter = RateLimiter::new(RateLimitConfig::new(100, 60).with_burst(50));
        let attempt_id = Uuid::new_v4().to_string();
        let key = RateLimitKey::Attempt(attempt_id);

        // Simulate many heartbeats/mutations
        for _ in 0..150 {
            assert!(matches!(
                limiter.check(&key).await,
                RateLimitResult::Allowed { .. }
            ));
        }

        // Should eventually rate limit
        assert!(matches!(
            limiter.check(&key).await,
            RateLimitResult::Denied { .. }
        ));
    }

    #[tokio::test]
    async fn peek_does_not_record() {
        let limiter = RateLimiter::new(RateLimitConfig::new(1, 60));
        let key = RateLimitKey::Ip(IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1)));

        // Peek multiple times - should not affect actual check
        for _ in 0..10 {
            let _ = limiter.peek(&key).await;
        }

        // Should still have full limit available
        let result = limiter.check(&key).await;
        assert!(matches!(
            result,
            RateLimitResult::Allowed { remaining: 0, .. }
        ));
    }

    #[tokio::test]
    async fn cleanup_removes_empty_buckets() {
        let limiter = RateLimiter::new(RateLimitConfig::new(1, 1)); // 1 second window
        let key = RateLimitKey::Ip(IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1)));

        // Make a request
        limiter.check(&key).await;

        // Wait for window to expire
        tokio::time::sleep(Duration::from_millis(1100)).await;

        // Cleanup should remove the bucket
        limiter.cleanup().await;

        // Should be allowed again (new bucket)
        let result = limiter.check(&key).await;
        assert!(matches!(
            result,
            RateLimitResult::Allowed { remaining: 0, .. }
        ));
    }

    #[tokio::test]
    async fn bucket_cap_evicts_oldest_idle_bucket() {
        let limiter = RateLimiter::with_bucket_cap(RateLimitConfig::new(5, 60), 2);
        let key1 = RateLimitKey::Custom("bucket-1".to_owned());
        let key2 = RateLimitKey::Custom("bucket-2".to_owned());
        let key3 = RateLimitKey::Custom("bucket-3".to_owned());

        limiter.check(&key1).await;
        limiter.check(&key2).await;
        limiter.check(&key3).await;

        assert_eq!(limiter.bucket_count().await, 2);
        assert!(limiter.peek(&key1).await.is_none());
        assert!(limiter.peek(&key2).await.is_some());
        assert!(limiter.peek(&key3).await.is_some());
    }
}
