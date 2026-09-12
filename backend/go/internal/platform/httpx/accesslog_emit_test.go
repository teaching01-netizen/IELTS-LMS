package httpx

// Plan 69/E-exam-day: every request must count on http_requests_total
// {route,method,status} and restore the in-flight gauge to 0 — the
// traffic + saturation signal. Labels stay low-cardinality: the route
// template (never raw IDs), method, and 1xx..5xx class. RED: AccessLog
// emits the counter and balances the gauge.
import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"example.com/ielts-proctoring/internal/platform/telemetry"
)

func TestAccessLogEmitsCounterAndGauge(t *testing.T) {
	reg := telemetry.NewRegistry()
	old := telemetry.DefaultRegistry
	telemetry.DefaultRegistry = reg
	defer func() { telemetry.DefaultRegistry = old }()

	// WithRoute OUTSIDE: it annotates ctx before AccessLog reads routeOf.
	h := WithRoute(AccessLog(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusCreated)
	})), "/api/v1/student/sessions/{id}/runtime")
	req := httptest.NewRequest(http.MethodGet, "/api/v1/student/sessions/s1/runtime", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("status must pass through, got %d", rec.Code)
	}
	if got := telemetry.CounterValueForTest(reg, telemetry.MHTTPRequestsTotal,
		"route", "/api/v1/student/sessions/{id}/runtime", "method", "GET", "status", "2xx"); got != 1 {
		t.Fatalf("request counter must be 1, got %v", got)
	}

	// WithRoute INSIDE (production order: r.Use(AccessLog) is outer): the
	// inner template back-reports through the route holder, so the label
	// is still the template — never the raw path.
	hInner := AccessLog(WithRoute(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusCreated)
	}), "GET /readyz"))
	reqInner := httptest.NewRequest(http.MethodGet, "/readyz", nil)
	hInner.ServeHTTP(httptest.NewRecorder(), reqInner)
	if got := telemetry.CounterValueForTest(reg, telemetry.MHTTPRequestsTotal,
		"route", "GET /readyz", "method", "GET", "status", "2xx"); got != 1 {
		t.Fatalf("inner-WithRoute template must propagate, got %v", got)
	}
	if got := telemetry.GaugeValueForTest(reg, telemetry.MHTTPInFlight, "route", "global"); got != 0 {
		t.Fatalf("in-flight gauge must return to 0, got %v", got)
	}

	// 5xx buckets separately (error-rate slice).
	h500 := WithRoute(AccessLog(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	})), "/x")
	req2 := httptest.NewRequest(http.MethodPost, "/x", nil)
	ctx := context.WithValue(req2.Context(), CtxRouteTemplate, "/x")
	h500.ServeHTTP(httptest.NewRecorder(), req2.WithContext(ctx))
	if got := telemetry.CounterValueForTest(reg, telemetry.MHTTPRequestsTotal,
		"route", "/x", "method", "POST", "status", "5xx"); got != 1 {
		t.Fatalf("5xx counter must be 1, got %v", got)
	}
}
