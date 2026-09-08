package main

// Plan E-honesty + round-61 fail-fast series (honest-layering sequel to
// round 60): schedulesRuntimeCommandHandler runs
// ValidateRuntimeCommandAction post-decode, AFTER requireRole (authn
// first by design) and BEFORE the schedule Get + proctor-assignment
// read (no DB burned on an unknown action). The router half pins: route
// exists (not 404 drift) + unauthenticated dies at auth (401). The gate
// itself is pinned in the schedules package (command_vocab_test.go).
import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"example.com/ielts-proctoring/internal/platform/config"
)

func TestRuntimeCommandUnknownActionLayering(t *testing.T) {
	cfg := config.Load()
	app := BuildApp(cfg, nil)
	h := BuildRouter(app)
	// Unknown action: envelope-invalid regardless of auth.
	body := `{"action":"frobnicate"}`
	// Route truth: POST /api/v1/schedules/{id}/runtime/commands
	// (main.go:428).
	req := httptest.NewRequest(http.MethodPost, "/api/v1/schedules/sched-1/runtime/commands", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code == http.StatusNotFound {
		t.Fatalf("runtime command route drifted (404)")
	}
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated command must 401 at requireRole, got %d", rec.Code)
	}
}
