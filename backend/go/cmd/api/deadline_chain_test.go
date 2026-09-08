package main

// Deepswe-consistency: MapDBError must see through wrapped errors.
// database/sql and the service layers wrap ctx.Err() (%w / fmt chains);
// == comparison misses every one of them and the 503 honesty silently
// regresses to 500. errors.Is is the contract.
import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"example.com/ielts-proctoring/internal/platform/httpx"
)

func TestMapDBErrorSeesThroughWraps(t *testing.T) {
	wrapped := fmt.Errorf("query poll: %w", context.DeadlineExceeded)
	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	rec := httptest.NewRecorder()
	httpx.WriteError(rec, req, MapDBError(wrapped))
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("wrapped deadline must 503, got %d", rec.Code)
	}
	wrappedCancel := fmt.Errorf("tx begin: %w", context.Canceled)
	rec2 := httptest.NewRecorder()
	httpx.WriteError(rec2, req, MapDBError(wrappedCancel))
	if rec2.Code != http.StatusServiceUnavailable {
		t.Fatalf("wrapped cancel must 503, got %d", rec2.Code)
	}
}
