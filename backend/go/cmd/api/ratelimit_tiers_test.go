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

// Student figures are reads: a module's worth of image GETs must not spend the
// attempt's writes budget that answer saves and module submits draw from.
func TestTierMediaContentSparesAttemptWrites(t *testing.T) {
	t.Setenv("RATE_LIMIT_WRITES_PER_MIN", "2")
	h := BuildRouter(BuildApp(config.Load(), nil))
	send := func(method, target string) (int, string) {
		req := httptest.NewRequest(method, target, nil)
		req.Header.Set("Authorization", "Bearer attempt-token")
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec.Code, rec.Header().Get("X-RateLimit-Tier")
	}
	for i := 0; i < 5; i++ {
		if code, tier := send(http.MethodGet, "/api/v1/media/asset-1/content"); code == http.StatusTooManyRequests {
			t.Fatalf("image GET %d was throttled by the %q tier", i+1, tier)
		}
	}
	save := "/api/v1/assessment-delivery/schedules/sched-1/responses/q-1"
	for i := 0; i < 2; i++ {
		if code, tier := send(http.MethodPatch, save); code == http.StatusTooManyRequests {
			t.Fatalf("answer save %d was throttled by the %q tier after image reads", i+1, tier)
		}
	}
	// The writes budget is live: the third save in the window is denied.
	if code, tier := send(http.MethodPatch, save); code != http.StatusTooManyRequests || tier != httpx.TierWrites {
		t.Fatalf("third save must hit the writes tier, got %d (%q)", code, tier)
	}
}

// The SAT state view is polled for the whole exam: it must draw on the reads
// budget, never the writes budget that answer saves and module submits share.
func TestTierDeliveryStateSparesAttemptWrites(t *testing.T) {
	t.Setenv("RATE_LIMIT_WRITES_PER_MIN", "2")
	h := BuildRouter(BuildApp(config.Load(), nil))
	send := func(method, target string) (int, string) {
		req := httptest.NewRequest(method, target, nil)
		req.Header.Set("Authorization", "Bearer attempt-token")
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec.Code, rec.Header().Get("X-RateLimit-Tier")
	}
	reads := []string{
		"/api/v1/assessment-delivery/schedules/sched-1/state",
		"/api/v1/assessment-delivery/schedules/sched-1/modules/mod-1/entry-state",
	}
	for i := 0; i < 5; i++ {
		for _, target := range reads {
			if code, tier := send(http.MethodGet, target); code == http.StatusTooManyRequests {
				t.Fatalf("state read %d (%s) was throttled by the %q tier", i+1, target, tier)
			}
		}
	}
	save := "/api/v1/assessment-delivery/schedules/sched-1/responses/q-1"
	for i := 0; i < 2; i++ {
		if code, tier := send(http.MethodPatch, save); code == http.StatusTooManyRequests {
			t.Fatalf("answer save %d was throttled by the %q tier after state reads", i+1, tier)
		}
	}
	if code, tier := send(http.MethodPatch, save); code != http.StatusTooManyRequests || tier != httpx.TierWrites {
		t.Fatalf("third save must hit the writes tier, got %d (%q)", code, tier)
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

func serveRouterTier(h http.Handler, method, target string, cookie *http.Cookie) (int, string) {
	req := httptest.NewRequest(method, target, nil)
	if cookie != nil {
		req.AddCookie(cookie)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec.Code, rec.Header().Get("X-RateLimit-Tier")
}

var studentCheckinRoutes = []struct{ method, target string }{
	{http.MethodGet, "/api/v1/public/access-links/link-1"},
	{http.MethodPost, "/api/v1/public/access-links/link-1/resolve-entry"},
	{http.MethodGet, "/api/v1/auth/student/schedules/sched-1"},
	{http.MethodPost, "/api/v1/auth/student/entry"},
}

// A room of students behind one NAT address checks in on its own budget; the
// strict per-IP login budget is neither spent by check-in nor loosened by it.
func TestTierStudentCheckinSeparateFromLogin(t *testing.T) {
	t.Setenv("RATE_LIMIT_ANON_AUTH_PER_MIN", "2")
	h := BuildRouter(BuildApp(config.Load(), nil))
	for round := 0; round < 3; round++ {
		for _, rt := range studentCheckinRoutes {
			if code, tier := serveRouterTier(h, rt.method, rt.target, nil); code == http.StatusTooManyRequests {
				t.Fatalf("check-in %s %s was throttled by the %q tier", rt.method, rt.target, tier)
			}
		}
	}
	for i := 0; i < 2; i++ {
		if code, tier := serveRouterTier(h, http.MethodPost, "/api/v1/auth/login", nil); code == http.StatusTooManyRequests {
			t.Fatalf("login %d was throttled by the %q tier", i+1, tier)
		}
	}
	if code, tier := serveRouterTier(h, http.MethodPost, "/api/v1/auth/login", nil); code != http.StatusTooManyRequests || tier != httpx.TierAnonAuth {
		t.Fatalf("third login must hit the anon-auth tier, got %d (%q)", code, tier)
	}
}

func TestTierStudentCheckinBudgetIsLive(t *testing.T) {
	t.Setenv("RATE_LIMIT_STUDENT_CHECKIN_PER_MIN", "2")
	h := BuildRouter(BuildApp(config.Load(), nil))
	for i, rt := range studentCheckinRoutes[:2] {
		if code, tier := serveRouterTier(h, rt.method, rt.target, nil); code == http.StatusTooManyRequests {
			t.Fatalf("check-in %d was throttled by the %q tier", i+1, tier)
		}
	}
	rt := studentCheckinRoutes[2]
	if code, tier := serveRouterTier(h, rt.method, rt.target, nil); code != http.StatusTooManyRequests || tier != httpx.TierStudentCheckin {
		t.Fatalf("third check-in must hit the student-checkin tier, got %d (%q)", code, tier)
	}
}

// Cookieless session checks never reach the DB, so a room's first page loads
// are not counted; a presented cookie costs a lookup and stays limited.
func TestTierSessionCheckWithoutCookieIsNotCounted(t *testing.T) {
	t.Setenv("RATE_LIMIT_AUTH_CRITICAL_PER_MIN", "1")
	app := BuildApp(config.Load(), nil)
	h := BuildRouter(app)
	for i := 0; i < 5; i++ {
		if code, tier := serveRouterTier(h, http.MethodGet, "/api/v1/auth/session", nil); code == http.StatusTooManyRequests {
			t.Fatalf("cookieless session check %d was throttled by the %q tier", i+1, tier)
		}
	}
	bogus := &http.Cookie{Name: app.Config.EffectiveSessionCookieName(), Value: "not-a-session"}
	if code, tier := serveRouterTier(h, http.MethodGet, "/api/v1/auth/session", bogus); code == http.StatusTooManyRequests {
		t.Fatalf("first cookie-bearing session check was throttled by the %q tier", tier)
	}
	if code, tier := serveRouterTier(h, http.MethodGet, "/api/v1/auth/session", bogus); code != http.StatusTooManyRequests || tier != httpx.TierAuthCritical {
		t.Fatalf("second cookie-bearing session check must hit auth-critical, got %d (%q)", code, tier)
	}
}
