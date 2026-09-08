package main

// Plan E1 honesty: a DB deadline under a wedged MySQL must surface as a
// retryable 503 SERVICE_UNAVAILABLE (never 500 INTERNAL, never a hang).
// Clients + orchestrator treat 503 as "retry elsewhere"; 500 means "bug".
import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/httpx"
)

func TestDeadlineMapsToRetryable503(t *testing.T) {
	ctx, cancel := context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
	defer cancel()
	req := httptest.NewRequest(http.MethodGet, "/x", nil).WithContext(ctx)
	rec := httptest.NewRecorder()
	httpx.WriteError(rec, req, MapDBError(ctx.Err()))
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("deadline must 503, got %d", rec.Code)
	}
	if got := rec.Header().Get("Content-Type"); got != "application/json" {
		t.Fatalf("deadline must keep the stable envelope, got %q", got)
	}
	var _ = apperrors.CodeServiceUnavailable
}
