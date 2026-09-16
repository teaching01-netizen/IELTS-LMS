package main

// WS-13.8 drift pin: every route registered in BuildRouter must have a
// matching OpenAPI path (param names normalized). A router change without
// a spec update fails here, not silently in client integration.
//
// Normalization: chi `{param}` == OpenAPI `{param}` after mount-prefix
// expansion; the spec serves /api/v1 as its base (servers: /api/v1), so
// mount-relative patterns expand against their /api/v1/<mount> prefix.
// Full-path (authorize) registrations are absolute already.
import (
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
)

func loadSpecPaths(t *testing.T) map[string]bool {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "api", "openapi", "openapi.yaml"))
	if err != nil {
		t.Skipf("openapi spec not found (monorepo layout): %v", err)
	}
	// Stdlib-only scan: top-level path keys look like "  /v1/...:".
	out := map[string]bool{}
	for _, line := range strings.Split(string(raw), "\n") {
		if !strings.HasPrefix(line, "  /") || !strings.HasSuffix(strings.TrimSpace(line), ":") {
			continue
		}
		p := strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(line), ":"))
		out[p] = true
	}
	return out
}

func normalizePath(p string) string {
	// Collapse all {param} to {} for shape comparison.
	return regexp.MustCompile(`\{[^}]+\}`).ReplaceAllString(p, "{}")
}

func TestOpenAPICoversRouter(t *testing.T) {
	spec := loadSpecPaths(t)
	norm := map[string]bool{}
	for p := range spec {
		norm[normalizePath(p)] = true
	}
	src, err := os.ReadFile("main.go")
	if err != nil {
		t.Fatal(err)
	}
	body := string(src)
	// Mount prefixes for authzRoute patterns: track r.Route("/<mount>")
	// is impractical textually; instead expand every mount-relative
	// pattern against every known mount and accept if ANY expansion
	// matches. Over-acceptance is bounded: unknown segments still miss.
	mounts := []string{"/api/v1/auth", "/api/v1/exams", "/api/v1/assessment-access",
		"/api/v1/assessment-release", "/api/v1/assessment-authoring", "/api/v1/assessment-delivery",
		"/api/v1/versions", "/api/v1/schedules", "/api/v1/student/sessions", "/api/v1/proctor",
		"/api/v1/library", "/api/v1/settings", "/api/v1/grading", "/api/v1/results",
		"/api/v1/media", "/api/v1/answer-history", "/api/v1/access-links", "/api/v1/student",
		"/api/v1/runtime", "/api/v1/live", "/api/v1/ws", "/api/v1/admin", "/api/v2/student/attempts",
		"/v2/student/attempts",
	}
	var missing []string
	seen := map[string]bool{}
	for _, m := range regexp.MustCompile(`authzRoute\(r,\s*"[A-Z]+",\s*"([^"]+)"\)`).FindAllStringSubmatch(body, -1) {
		pattern := m[1]
		if seen[pattern] {
			continue
		}
		seen[pattern] = true
		if pattern == "/" {
			continue // mount roots map to several spec paths; covered by Table test
		}
		matched := false
		for _, mount := range mounts {
			full := mount + pattern
			rel := strings.TrimPrefix(full, "/api/v1")
			if rel == "" {
				rel = "/"
			}
			if norm[normalizePath(rel)] || norm[normalizePath(strings.TrimSuffix(rel, "/"))] {
				matched = true
				break
			}
		}
		if !matched {
			missing = append(missing, pattern)
		}
	}
	sort.Strings(missing)
	if len(missing) > 0 {
		t.Fatalf("router patterns without spec paths: %v", missing)
	}
	// Strict pin: every absolute authorize() path (minus probes) must
	// exist in the spec. The spec serves paths relative to its /api/v1
	// server base ("/assessment-authoring/...") with its own param
	// spellings, so strip the version prefix and compare normalized.
	var missingAbs []string
	seenAbs := map[string]bool{}
	for _, m := range regexp.MustCompile(`authorize\(\s*"[A-Z]+\s+(/[^"]+)"`).FindAllStringSubmatch(body, -1) {
		p := m[1]
		if p == "/healthz" || p == "/readyz" || p == "/metrics" {
			continue
		}
		rel := strings.TrimPrefix(p, "/api/v1")
		if seenAbs[rel] {
			continue
		}
		seenAbs[rel] = true
		if !norm[normalizePath(rel)] {
			missingAbs = append(missingAbs, rel)
		}
	}
	sort.Strings(missingAbs)
	if len(missingAbs) > 0 {
		t.Fatalf("absolute authoring/release paths missing from spec: %v", missingAbs)
	}
}

func TestOpenAPIRateLimitedResponseContract(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "api", "openapi", "openapi.yaml"))
	if err != nil {
		t.Skipf("openapi spec not found (monorepo layout): %v", err)
	}
	body := string(raw)
	for _, needle := range []string{
		"    RateLimited:\n",
		"        Retry-After:",
		"        X-RateLimit-Tier:",
		"schema: { $ref: \"#/components/schemas/ErrorEnvelope\" }",
		"retryAfterSeconds:",
		"tier:",
	} {
		if !strings.Contains(body, needle) {
			t.Errorf("OpenAPI rate-limit contract is missing %q", needle)
		}
	}

	rateLimitedPaths := []string{
		"/auth/student/entry",
		"/grading/export",
		"/results/export",
		"/results/export-profile",
	}
	for _, path := range rateLimitedPaths {
		start := strings.Index(body, "  "+path+":")
		if start < 0 {
			t.Errorf("rate-limited path %s is missing from OpenAPI", path)
			continue
		}
		end := len(body)
		if next := strings.Index(body[start+1:], "\n  /"); next >= 0 {
			end = start + 1 + next
		}
		block := body[start:end]
		want := "\"429\": { $ref: \"#/components/responses/RateLimited\" }"
		if !strings.Contains(block, want) {
			t.Errorf("rate-limited path %s must reference components/responses/RateLimited", path)
		}
	}
	if got := strings.Count(body, "\"429\": { $ref: \"#/components/responses/RateLimited\" }"); got != len(rateLimitedPaths) {
		t.Fatalf("expected one reusable RateLimited ref for each rate-limited endpoint, got %d", got)
	}
}

func TestRateLimitRuntimeValidationPrecedesRouterConstruction(t *testing.T) {
	src, err := os.ReadFile("main.go")
	if err != nil {
		t.Fatal(err)
	}
	body := string(src)
	validate := strings.Index(body, "cfg.ValidateForRuntime()")
	buildRouter := strings.Index(body, "BuildRouter(app)")
	if validate < 0 || buildRouter < 0 {
		t.Fatalf("startup must contain both runtime validation and router construction")
	}
	if validate > buildRouter {
		t.Fatalf("invalid configuration must be rejected before router construction")
	}
}
