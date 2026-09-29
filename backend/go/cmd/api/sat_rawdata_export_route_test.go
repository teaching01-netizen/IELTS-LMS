package main

// Route pin for the SAT RAWDATA export endpoint. The unit suite proves row
// assembly; this proves the endpoint is actually mounted at the documented
// path, is session-gated (401, never 404), and rejects the wrong method with
// the stable 405 envelope.
import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"example.com/ielts-proctoring/internal/platform/config"
)

func TestSATRawdataExportRouteIsMountedAndSessionGated(t *testing.T) {
	h := BuildRouter(BuildApp(config.Load(), nil))
	req := httptest.NewRequest(http.MethodGet, "/api/v1/results/sat/export/rawdata?examId=exam-1&scheduleId=schedule-1", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code == http.StatusNotFound {
		t.Fatalf("RAWDATA export path drifted (404): %s", rec.Body.String())
	}
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous export must be 401, got %d (%s)", rec.Code, rec.Body.String())
	}
}

func TestSATRawdataExportRouteRejectsWrongMethod(t *testing.T) {
	h := BuildRouter(BuildApp(config.Load(), nil))
	req := httptest.NewRequest(http.MethodPost, "/api/v1/results/sat/export/rawdata", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("POST export must be 405, got %d (%s)", rec.Code, rec.Body.String())
	}
	if allow := rec.Header().Get("Allow"); !strings.Contains(allow, "GET") {
		t.Fatalf("Allow header must contain GET, got %q", allow)
	}
}
