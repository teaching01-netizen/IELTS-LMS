package main

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"example.com/ielts-proctoring/internal/platform/config"
)

func TestMediaImportURLRouteIsMountedBehindSessionAuth(t *testing.T) {
	h := BuildRouter(BuildApp(config.Load(), nil))
	req := httptest.NewRequest(http.MethodPost, "/api/v1/media/import-url", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("media import URL route must be mounted and session-gated, got %d (%s)", rec.Code, rec.Body.String())
	}
}
