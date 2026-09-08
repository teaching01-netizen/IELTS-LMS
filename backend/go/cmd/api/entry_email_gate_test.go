package main

// Plan E-honesty + round-64 fail-fast series (entry-wave hot path):
// studentEntryHandler runs schedules.ValidateEmail right after the
// presence check — a shapeless email (no @, no domain dot) 400s BEFORE
// link resolution + rate-limit buckets + user lookup (nil-DB would 500
// if the request got that far). Honest layering per round 60: route
// exists (not 404) + no-auth entry is anonymous by design, so the gate
// itself fires pre-DB. NOTE: VALIDATION_ERROR maps to 422 (not 400) —
// the assertion pins rejection-before-DB (422), distinct from a 500
// (reached DB) or 429 (reached buckets).
import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"example.com/ielts-proctoring/internal/platform/config"
)

func TestEntryShapelessEmail400sPreDB(t *testing.T) {
	cfg := config.Load()
	app := BuildApp(cfg, nil)
	h := BuildRouter(app)
	// Route truth: POST /api/v1/auth/student/entry (k6 0_entry_wave.js).
	body := `{"wcode":"W123456","email":"no-at-sign","studentName":"Ada","scheduleId":"sched-1"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/student/entry", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	// RemoteAddr feeds the per-email+IP bucket; fixed value keeps the
	// bucket cold so the email gate (not 429) decides.
	req.RemoteAddr = "10.9.9.9:1234"
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code == http.StatusNotFound {
		t.Fatalf("entry route drifted (404)")
	}
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("shapeless email must 422 at the entry gate (pre-DB), got %d", rec.Code)
	}
}
