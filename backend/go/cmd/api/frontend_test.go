package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"example.com/ielts-proctoring/internal/platform/config"
)

func TestFrontendHandlerServesAssetsAndSPAFallback(t *testing.T) {
	distDir := t.TempDir()
	if err := os.Mkdir(filepath.Join(distDir, "assets"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(distDir, "index.html"), []byte("<div id=app>IELTS</div>"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(distDir, "assets", "app.js"), []byte("console.log('ok')"), 0o644); err != nil {
		t.Fatal(err)
	}

	h := frontendHandler(distDir)
	tests := []struct {
		name       string
		path       string
		wantStatus int
		wantBody   string
	}{
		{name: "root", path: "/", wantStatus: http.StatusOK, wantBody: "IELTS"},
		{name: "client route", path: "/builder/exams/123", wantStatus: http.StatusOK, wantBody: "IELTS"},
		{name: "asset", path: "/assets/app.js", wantStatus: http.StatusOK, wantBody: "console.log"},
		{name: "missing asset", path: "/assets/missing.js", wantStatus: http.StatusNotFound, wantBody: `"code":"NOT_FOUND"`},
		{name: "unknown API", path: "/api/not-a-route", wantStatus: http.StatusNotFound, wantBody: `"code":"NOT_FOUND"`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, tt.path, nil)
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, req)
			if rec.Code != tt.wantStatus {
				t.Fatalf("GET %s: status = %d, want %d (%s)", tt.path, rec.Code, tt.wantStatus, rec.Body.String())
			}
			if !strings.Contains(rec.Body.String(), tt.wantBody) {
				t.Fatalf("GET %s: body %q does not contain %q", tt.path, rec.Body.String(), tt.wantBody)
			}
		})
	}
}

func TestBuildRouterServesConfiguredFrontend(t *testing.T) {
	distDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(distDir, "index.html"), []byte("frontend-ready"), 0o644); err != nil {
		t.Fatal(err)
	}
	cfg := config.Load()
	cfg.FrontendDistDir = distDir

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	BuildRouter(BuildApp(cfg, nil)).ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("configured frontend root must return 200, got %d (%s)", rec.Code, rec.Body.String())
	}
	if body := rec.Body.String(); body != "frontend-ready" {
		t.Fatalf("configured frontend root body = %q, want %q", body, "frontend-ready")
	}
}
