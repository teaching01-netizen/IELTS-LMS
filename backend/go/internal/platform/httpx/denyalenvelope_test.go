package httpx

// Plan E2/C3: the 429 envelope is the client queue contract — every tiered
// denial must carry Retry-After (header) + retryAfterSeconds (body) floored
// at 1s, and the X-RateLimit-Tier header + tier body detail when tiered.
// The student entry-queue retry loop (entryQueueRetry) and the k6 wave
// scripts parse exactly these fields; a rename breaks the queue on exam
// day. RED: envelope shape + floor.
import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestTierDenialEnvelopeShape(t *testing.T) {
	req, _ := http.NewRequest(http.MethodGet, "/api/v1/student/sessions/s1/runtime", nil)
	req.RemoteAddr = "198.51.100.9:1234"
	rec := httptest.NewRecorder()
	denyTierRateLimit(rec, req, "polling", "ip", 2*time.Second)
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("denial must 429, got %d", rec.Code)
	}
	if got := rec.Header().Get("Retry-After"); got != "2" {
		t.Fatalf("Retry-After header must be 2, got %q", got)
	}
	if got := rec.Header().Get("X-RateLimit-Tier"); got != "polling" {
		t.Fatalf("tier header must be polling, got %q", got)
	}
	// Envelope truth (apperrors.Envelope): details ride FLAT alongside
	// code/message (no {error:{}} wrapper) — the shape entryQueueRetry
	// and the k6 waves parse.
	var body struct {
		Code    string         `json:"code"`
		Details map[string]any `json:"details"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("denial body must be JSON: %v", err)
	}
	if body.Details["retryAfterSeconds"] != float64(2) {
		t.Fatalf("body must carry retryAfterSeconds=2, got %v", body.Details)
	}
	if body.Details["tier"] != "polling" {
		t.Fatalf("body must carry tier=polling, got %v", body.Details)
	}
}

func TestTierDenialRetryAfterFloored(t *testing.T) {
	req, _ := http.NewRequest(http.MethodGet, "/x", nil)
	req.RemoteAddr = "198.51.100.9:1234"
	rec := httptest.NewRecorder()
	denyTierRateLimit(rec, req, "heartbeat", "attempt", 0)
	if got := rec.Header().Get("Retry-After"); got != "1" {
		t.Fatalf("sub-second retry must floor to 1, got %q", got)
	}
	// Untiered legacy path: no tier header, core fields unchanged.
	rec2 := httptest.NewRecorder()
	req2, _ := http.NewRequest(http.MethodGet, "/x", nil)
	req2.RemoteAddr = "198.51.100.9:1234"
	denyRateLimitWithTier(rec2, req2, "", 5*time.Second)
	if got := rec2.Header().Get("X-RateLimit-Tier"); got != "" {
		t.Fatalf("untiered denial must not set tier header, got %q", got)
	}
	if got := rec2.Header().Get("Retry-After"); got != "5" {
		t.Fatalf("untiered Retry-After must be 5, got %q", got)
	}
}
