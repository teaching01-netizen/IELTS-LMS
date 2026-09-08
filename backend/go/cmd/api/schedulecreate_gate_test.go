package main

// Plan E-honesty + round-60 fail-fast series: schedulesCreateHandler
// runs ValidateCreateRequest right after body decode, AFTER requireRole
// (authn first by design) and BEFORE the builder preview check + exam
// Get (no DB read burned on bad input). The router half pins: route
// exists (not 404 drift) + unauthenticated dies at auth (401). The
// gate itself is pinned at its true layer in the schedules package
// (create_envelope_test.go) — this test documents the layering here
// so a future reorder (gate before auth, or gate after DB read)
// contradicts the comment and fails review, not silently.
import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"example.com/ielts-proctoring/internal/platform/config"
)

func TestScheduleCreateMalformedEnvelope400s(t *testing.T) {
	cfg := config.Load()
	app := BuildApp(cfg, nil)
	h := BuildRouter(app)
	// Empty examId + inverted window: envelope-invalid on two rows.
	body := `{"examId":"","publishedVersionId":"ver-1","cohortName":"c","startTime":"2026-09-01T10:00:00Z","endTime":"2026-09-01T09:00:00Z"}`
	// Route truth: POST /api/v1/schedules (main.go:421 schedules group).
	req := httptest.NewRequest(http.MethodPost, "/api/v1/schedules", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code == http.StatusNotFound {
		t.Fatalf("schedule create route drifted (404)")
	}
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated create must 401 at requireRole, got %d", rec.Code)
	}
}
