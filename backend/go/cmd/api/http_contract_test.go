package main

// WS-13.3/13.6 pins: uniform conditional reads on the runtime poll and an
// explicit same-origin CORS posture (code, not absence of a mount).
import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// Same-origin/non-browser requests pass through with no CORS headers;
// cross-origin preflights are refused (403), not silently allowed.
func TestCORSSameOriginOnly(t *testing.T) {
	h := authzTestRouter()
	// No Origin: plain passthrough.
	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("same-origin healthz must 200, got %d", rec.Code)
	}
	if rec.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatal("same-origin response must not carry ACAO")
	}
	// Cross-origin preflight: refused closed.
	pre := httptest.NewRequest(http.MethodOptions, "/api/v1/auth/session", nil)
	pre.Header.Set("Origin", "https://evil.example")
	prec := httptest.NewRecorder()
	h.ServeHTTP(prec, pre)
	if prec.Code != http.StatusForbidden {
		t.Fatalf("cross-origin preflight must 403, got %d", prec.Code)
	}
}
