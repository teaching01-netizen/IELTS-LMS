package main

// Plan invariant I4: BuildRouter middleware order must stay
// recovery > request-id > trace > security > body-limit > auth > CSRF >
// rate-limit > authorization > handler > access-log. A reorder (e.g.
// auth before request-id, or access-log before auth) silently breaks
// request tracing, CSRF posture, or 429 observability. chi gives no
// order introspection, so pin the source order textually: each marker
// must appear exactly once inside BuildRouter, in plan order.
import (
	"os"
	"strings"
	"testing"
)

func TestMiddlewareOrderMatchesI4(t *testing.T) {
	src, err := os.ReadFile("main.go")
	if err != nil {
		t.Fatal(err)
	}
	body := string(src)
	start := strings.Index(body, "func BuildRouter(app *App) http.Handler {")
	if start < 0 {
		t.Fatalf("BuildRouter not found")
	}
	// Cut at the first route registration (order region ends there).
	end := strings.Index(body[start:], `r.Get("/healthz"`)
	if end < 0 {
		t.Fatalf("route block not found")
	}
	region := body[start : start+end]
	markers := []string{
		"httpx.Recovery",
		"httpx.RequestID",
		"httpx.Trace",
		"httpx.SecurityHeaders",
		"httpx.BodyLimit",
		"authMiddleware(app)",
		"csrfMiddleware(app)",
		"app.Tiers.Middleware",
		"authorizationPlaceholder",
		"httpx.AccessLog",
	}
	last := -1
	for _, m := range markers {
		idx := strings.Index(region, m)
		if idx < 0 {
			t.Fatalf("middleware marker missing in BuildRouter: %s", m)
		}
		if strings.Count(region, m) != 1 {
			t.Fatalf("middleware marker must appear exactly once: %s", m)
		}
		if idx < last {
			t.Fatalf("middleware order violated at %s (plan I4)", m)
		}
		last = idx
	}
}
