package httpx

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestTokenBucketRefillUsesMaxRequestsNotCapacity(t *testing.T) {
	b := &TokenBucket{max: 10, window: time.Second, burst: 10}
	start := time.Unix(100, 0)

	for i := 0; i < 20; i++ {
		if result := b.allow(start); !result.Allowed {
			t.Fatalf("initial burst request %d was denied: %+v", i+1, result)
		}
	}

	allowed := 0
	for i := 0; i < 6; i++ {
		if b.allow(start.Add(500 * time.Millisecond)).Allowed {
			allowed++
		}
	}

	if allowed != 5 {
		t.Fatalf("allowed %d requests after a half-window refill, want 5", allowed)
	}
}

func TestBucketStoreRejectsNewKeyWhenAllEntriesAreActive(t *testing.T) {
	now := time.Unix(200, 0)
	store := newBucketStoreWithClock(1, time.Minute, func() time.Time { return now })
	cfg := RateLimitConfig{MaxRequests: 1, Window: time.Minute}

	if result := store.Allow(cfg, "key-a"); !result.Allowed {
		t.Fatalf("first key was denied: %+v", result)
	}

	if result := store.Allow(cfg, "key-b"); result.Allowed || !result.CapacityLimited {
		t.Fatalf("new key was not rejected as capacity-limited: %+v", result)
	}

	if result := store.Allow(cfg, "key-a"); result.Allowed {
		t.Fatalf("active key was reset after the new key was rejected: %+v", result)
	}
}

func TestBucketStoreEvictsIdleKeyBeforeRejectingNewKey(t *testing.T) {
	now := time.Unix(100, 0)
	store := newBucketStoreWithClock(1, time.Minute, func() time.Time { return now })
	cfg := RateLimitConfig{MaxRequests: 1, Window: time.Minute}

	if result := store.Allow(cfg, "key-a"); !result.Allowed {
		t.Fatalf("first key was denied: %+v", result)
	}

	now = now.Add(time.Minute)
	if result := store.Allow(cfg, "key-b"); !result.Allowed || result.CapacityLimited {
		t.Fatalf("idle key was not evicted before admitting a new key: %+v", result)
	}
}

func TestRateLimitCapacityUses429Envelope(t *testing.T) {
	now := time.Unix(100, 0)
	store := newBucketStoreWithClock(1, time.Minute, func() time.Time { return now })
	cfg := RateLimitConfig{MaxRequests: 1, Window: time.Minute}
	handler := store.RateLimit(cfg, func(r *http.Request) string {
		return r.URL.Path
	}, nil)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))

	first := httptest.NewRecorder()
	firstReq := httptest.NewRequest(http.MethodGet, "/key-a", nil)
	handler.ServeHTTP(first, firstReq)
	if first.Code != http.StatusNoContent {
		t.Fatalf("first key request was denied: %d", first.Code)
	}

	second := httptest.NewRecorder()
	secondReq := httptest.NewRequest(http.MethodGet, "/key-b", nil)
	handler.ServeHTTP(second, secondReq)
	if second.Code != http.StatusTooManyRequests {
		t.Fatalf("capacity-limited request must be 429, got %d", second.Code)
	}
	if got := second.Header().Get("Retry-After"); got != "1" {
		t.Fatalf("capacity-limited request must retry after 1 second, got %q", got)
	}
}
