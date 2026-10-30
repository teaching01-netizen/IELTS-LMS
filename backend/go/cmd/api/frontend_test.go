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

func TestFrontendHandlerServesPrecompressedImmutableAssets(t *testing.T) {
	distDir := t.TempDir()
	if err := os.Mkdir(filepath.Join(distDir, "assets"), 0o755); err != nil {
		t.Fatal(err)
	}
	for name, body := range map[string]string{
		"index.html":        "<div id=app></div>",
		"assets/app.js":     "raw-js",
		"assets/app.js.br":  "br-js",
		"assets/app.js.gz":  "gz-js",
		"assets/font.woff2": "font",
	} {
		if err := os.WriteFile(filepath.Join(distDir, name), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	h := frontendHandler(distDir)
	tests := []struct {
		name, path, accept, wantBody, wantEncoding, wantCache string
	}{
		{"brotli preferred", "/assets/app.js", "gzip, deflate, br", "br-js", "br", "public, max-age=31536000, immutable"},
		{"gzip only", "/assets/app.js", "gzip", "gz-js", "gzip", "public, max-age=31536000, immutable"},
		{"br refused", "/assets/app.js", "br;q=0, gzip", "gz-js", "gzip", "public, max-age=31536000, immutable"},
		{"identity", "/assets/app.js", "", "raw-js", "", "public, max-age=31536000, immutable"},
		{"no variant", "/assets/font.woff2", "br", "font", "", "public, max-age=31536000, immutable"},
		{"document", "/", "br", "<div id=app>", "", "no-cache"},
		{"client route", "/student/x", "br", "<div id=app>", "", "no-cache"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, tt.path, nil)
			if tt.accept != "" {
				req.Header.Set("Accept-Encoding", tt.accept)
			}
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, req)
			if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), tt.wantBody) {
				t.Fatalf("status=%d body=%q, want 200 containing %q", rec.Code, rec.Body.String(), tt.wantBody)
			}
			if got := rec.Header().Get("Content-Encoding"); got != tt.wantEncoding {
				t.Fatalf("Content-Encoding = %q, want %q", got, tt.wantEncoding)
			}
			if got := rec.Header().Get("Cache-Control"); got != tt.wantCache {
				t.Fatalf("Cache-Control = %q, want %q", got, tt.wantCache)
			}
			if tt.path == "/assets/app.js" && !strings.HasPrefix(rec.Header().Get("Content-Type"), "text/javascript") {
				t.Fatalf("Content-Type = %q, want text/javascript", rec.Header().Get("Content-Type"))
			}
		})
	}
}
