package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"example.com/ielts-proctoring/internal/platform/config"
)

func metricsRouter(cfg config.Config) http.Handler {
	return BuildRouter(BuildApp(cfg, nil))
}

// WS-10a: /metrics is private by default — no token configured and none
// supplied must deny closed (403), never serve open.
func TestMetricsPrivateByDefault(t *testing.T) {
	cfg := config.Load()
	cfg.MetricsPublic = false
	cfg.MetricsToken = ""
	h := metricsRouter(cfg)
	req := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("private /metrics without token must be 403, got %d", rec.Code)
	}
	// A supplied bearer must NOT open a tokenless deployment (fail closed).
	req2 := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	req2.Header.Set("Authorization", "Bearer anything")
	rec2 := httptest.NewRecorder()
	h.ServeHTTP(rec2, req2)
	if rec2.Code != http.StatusForbidden {
		t.Fatalf("tokenless deployment must deny even with a bearer, got %d", rec2.Code)
	}
}

// WS-10a: correct bearer serves the Prometheus exposition; wrong/missing
// bearers deny (constant-time compare must not panic on length mismatch).
func TestMetricsBearerGate(t *testing.T) {
	cfg := config.Load()
	cfg.MetricsPublic = false
	cfg.MetricsToken = "test-scrape-secret-0123456789abcdef"
	h := metricsRouter(cfg)

	good := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	good.Header.Set("Authorization", "Bearer test-scrape-secret-0123456789abcdef")
	grec := httptest.NewRecorder()
	h.ServeHTTP(grec, good)
	if grec.Code != http.StatusOK {
		t.Fatalf("correct bearer must serve /metrics, got %d (%s)", grec.Code, grec.Body.String())
	}
	if ct := grec.Header().Get("Content-Type"); !strings.Contains(ct, "text/plain") {
		t.Fatalf("metrics content type must be Prometheus text, got %q", ct)
	}

	for _, tc := range []struct {
		name   string
		header string
	}{
		{"missing header", ""},
		{"wrong secret", "Bearer wrong-secret"},
		{"wrong length secret", "Bearer short"},
		{"no bearer scheme", "Token test-scrape-secret-0123456789abcdef"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/metrics", nil)
			if tc.header != "" {
				req.Header.Set("Authorization", tc.header)
			}
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, req)
			if rec.Code != http.StatusForbidden {
				t.Fatalf("bad credential must deny /metrics with 403, got %d", rec.Code)
			}
		})
	}
}

// WS-10a: METRICS_PUBLIC=1 exposes /metrics without credentials
// (trusted-network scrapes).
func TestMetricsPublicServesOpen(t *testing.T) {
	cfg := config.Load()
	cfg.MetricsPublic = true
	h := metricsRouter(cfg)
	req := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("public /metrics must be 200, got %d (%s)", rec.Code, rec.Body.String())
	}
}
