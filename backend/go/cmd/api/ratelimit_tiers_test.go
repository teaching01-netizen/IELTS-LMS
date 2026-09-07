package main

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/platform/config"
	"example.com/ielts-proctoring/internal/platform/httpx"
	"github.com/go-chi/chi/v5"
)

// buildTierProbeRouter mounts representative tier middleware over stub
// handlers so the tier matrix runs without a DB or domain services.
func buildTierProbeRouter() http.Handler {
	budgets := map[string]httpx.TierBudget{
		httpx.TierAuthCritical: {PerMin: 1000},
		httpx.TierAnonAuth:     {PerMin: 1},
		httpx.TierAuthedReads:  {PerMin: 1000},
		httpx.TierPolling:      {PerMin: 2},
		httpx.TierHeartbeat:    {PerMin: 1000},
		httpx.TierWrites:       {PerMin: 1000},
		httpx.TierBackstop:     {PerMin: 100000},
	}
	ts := httpx.NewTierSet(budgets, nil, 10000)
	ok := func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) }
	r := chi.NewRouter()
	r.Use(httpx.Recovery)
	r.Use(httpx.RequestID)
	r.Get("/healthz", func(w http.ResponseWriter, req *http.Request) { w.WriteHeader(http.StatusOK) })
	r.Get("/metrics", func(w http.ResponseWriter, req *http.Request) { w.WriteHeader(http.StatusOK) })
	r.Route("/api/v1", func(r chi.Router) {
		r.With(ts.Middleware(httpx.TierAuthCritical, httpx.ClientIPKey)).Get("/auth/session", ok)
		r.With(ts.Middleware(httpx.TierAnonAuth, httpx.ClientIPKey)).Post("/auth/login", ok)
		r.With(ts.Middleware(httpx.TierPolling, httpx.ClientIPKey)).Get("/student/sessions/{scheduleID}/live", ok)
		r.With(ts.Middleware(httpx.TierHeartbeat, httpx.ClientIPKey)).Post("/student/sessions/{scheduleID}/heartbeat", ok)
		r.With(ts.Middleware(httpx.TierWrites, httpx.ClientIPKey)).Post("/student/sessions/{scheduleID}/submit", ok)
		r.With(ts.Middleware(httpx.TierAuthedReads, httpx.ClientIPKey)).Get("/exams", ok)
	})
	_ = auth.RoleAdmin
	_ = config.Config{}
	_ = SessionOf
	return r
}

func serveTierProbe(t *testing.T, h http.Handler, method, target, remote string) (int, http.Header) {
	t.Helper()
	req, _ := http.NewRequest(method, target, nil)
	req.RemoteAddr = remote
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec.Code, rec.Header()
}

// AT-01: exhausting the polling tier must not touch auth-critical.
func TestTierIsolationPollingStormSparesSession(t *testing.T) {
	h := buildTierProbeRouter()
	for i := 0; i < 6; i++ {
		serveTierProbe(t, h, "GET", "/api/v1/student/sessions/sched-1/live", "198.51.100.9:1")
	}
	// Polling tier (budget 2/min, prefilter 4) must be denying now.
	if code, _ := serveTierProbe(t, h, "GET", "/api/v1/student/sessions/sched-1/live", "198.51.100.9:1"); code != 429 {
		t.Fatalf("exhausted polling tier must 429, got %d", code)
	}
	// auth-critical from the same IP must still pass.
	if code, _ := serveTierProbe(t, h, "GET", "/api/v1/auth/session", "198.51.100.9:1"); code != 200 {
		t.Fatalf("session read must survive a polling storm, got %d", code)
	}
}

// AT-03: anonymous login attempts are throttled per IP.
func TestTierAnonAuthThrottlesLogin(t *testing.T) {
	h := buildTierProbeRouter()
	seen429 := false
	for i := 0; i < 8; i++ {
		if code, _ := serveTierProbe(t, h, "POST", "/api/v1/auth/login", "198.51.100.9:2"); code == 429 {
			seen429 = true
			break
		}
	}
	if !seen429 {
		t.Fatalf("login burst past budget 1/min must eventually 429")
	}
}

// AT-05: 429 envelope keeps core fields and names the tier.
func TestTierDenialEnvelopeNamesTier(t *testing.T) {
	h := buildTierProbeRouter()
	var tierHeader, retryAfter string
	var code int
	for i := 0; i < 8; i++ {
		var hdr http.Header
		code, hdr = serveTierProbe(t, h, "POST", "/api/v1/auth/login", "198.51.100.9:3")
		if code == 429 {
			tierHeader = hdr.Get("X-RateLimit-Tier")
			retryAfter = hdr.Get("Retry-After")
			break
		}
	}
	if code != 429 {
		t.Fatalf("expected a 429, got %d", code)
	}
	if retryAfter == "" {
		t.Fatalf("429 must carry Retry-After")
	}
	if tierHeader != httpx.TierAnonAuth {
		t.Fatalf("429 must name its tier %q, got %q", httpx.TierAnonAuth, tierHeader)
	}
}

// AT-06: probes are exempt from limiting.
func TestTierProbesExempt(t *testing.T) {
	h := buildTierProbeRouter()
	for i := 0; i < 20; i++ {
		if code, _ := serveTierProbe(t, h, "GET", "/healthz", "198.51.100.9:4"); code != 200 {
			t.Fatalf("healthz must stay 200, got %d", code)
		}
		if code, _ := serveTierProbe(t, h, "GET", "/metrics", "198.51.100.9:4"); code != 200 {
			t.Fatalf("metrics must stay 200, got %d", code)
		}
	}
}
