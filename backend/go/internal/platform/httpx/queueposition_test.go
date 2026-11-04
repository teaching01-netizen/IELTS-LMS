package httpx

// Plan 2026-11-04 §4 Track B (visible queue): 429/503 envelopes carry an
// ADDITIVE queue position ({retryAfterSeconds, queueDepth?} + X-Queue-Depth
// header). Core fields stay byte-identical when the queue is unknown, so
// every existing envelope consumer keeps passing. RED: queue present when
// known, absent when unknown.
import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func decodeQueueEnvelope(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var body struct {
		Code    string         `json:"code"`
		Details map[string]any `json:"details"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("denial body must be JSON: %v", err)
	}
	if body.Code != "RATE_LIMIT_EXCEEDED" {
		t.Fatalf("code must be RATE_LIMIT_EXCEEDED, got %q", body.Code)
	}
	return body.Details
}

func TestQueueDenialCarriesPosition(t *testing.T) {
	req, _ := http.NewRequest(http.MethodGet, "/api/v1/student/sessions/s1/runtime", nil)
	req.RemoteAddr = "198.51.100.9:1234"
	rec := httptest.NewRecorder()
	WriteRateLimitExceededWithQueue(rec, req, "sat-close", "attempt", 2*time.Second, 7)
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("denial must 429, got %d", rec.Code)
	}
	if got := rec.Header().Get("Retry-After"); got != "2" {
		t.Fatalf("Retry-After must be 2, got %q", got)
	}
	if got := rec.Header().Get("X-Queue-Depth"); got != "7" {
		t.Fatalf("X-Queue-Depth must be 7, got %q", got)
	}
	details := decodeQueueEnvelope(t, rec)
	if details["retryAfterSeconds"] != float64(2) {
		t.Fatalf("body must carry retryAfterSeconds=2, got %v", details)
	}
	if details["queueDepth"] != float64(7) {
		t.Fatalf("body must carry queueDepth=7, got %v", details)
	}
	if details["tier"] != "sat-close" {
		t.Fatalf("body must keep tier=sat-close, got %v", details)
	}
}

func TestQueueDenialOmitsUnknownQueue(t *testing.T) {
	req, _ := http.NewRequest(http.MethodGet, "/x", nil)
	req.RemoteAddr = "198.51.100.9:1234"
	rec := httptest.NewRecorder()
	WriteRateLimitExceededWithQueue(rec, req, "polling", "ip", 2*time.Second, -1)
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("denial must 429, got %d", rec.Code)
	}
	if got := rec.Header().Get("X-Queue-Depth"); got != "" {
		t.Fatalf("unknown queue must not set X-Queue-Depth, got %q", got)
	}
	details := decodeQueueEnvelope(t, rec)
	if _, ok := details["queueDepth"]; ok {
		t.Fatalf("unknown queue must not set details.queueDepth, got %v", details)
	}
	if details["retryAfterSeconds"] != float64(2) {
		t.Fatalf("core retryAfterSeconds must survive, got %v", details)
	}
}

func TestQueueDenialZeroIsPresent(t *testing.T) {
	// Position zero (head of queue) is a known position, not unknown.
	req, _ := http.NewRequest(http.MethodGet, "/x", nil)
	req.RemoteAddr = "198.51.100.9:1234"
	rec := httptest.NewRecorder()
	WriteRateLimitExceededWithQueue(rec, req, "sat-close", "attempt", time.Second, 0)
	if got := rec.Header().Get("X-Queue-Depth"); got != "0" {
		t.Fatalf("queue head must set X-Queue-Depth=0, got %q", got)
	}
	if details := decodeQueueEnvelope(t, rec); details["queueDepth"] != float64(0) {
		t.Fatalf("queue head must set details.queueDepth=0, got %v", details)
	}
}

func TestUntieredDenialStaysQueueFree(t *testing.T) {
	// The legacy untiered path keeps its exact historical shape.
	req, _ := http.NewRequest(http.MethodGet, "/x", nil)
	req.RemoteAddr = "198.51.100.9:1234"
	rec := httptest.NewRecorder()
	denyRateLimit(rec, req, 3*time.Second)
	if got := rec.Header().Get("X-Queue-Depth"); got != "" {
		t.Fatalf("untiered denial must not set X-Queue-Depth, got %q", got)
	}
	if details := decodeQueueEnvelope(t, rec); details["retryAfterSeconds"] != float64(3) {
		t.Fatalf("untiered retryAfterSeconds must be 3, got %v", details)
	}
}
