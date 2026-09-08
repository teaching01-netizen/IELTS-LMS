package httpx

// Plan E3 dashboards: http_request_duration_seconds{route,method,status}
// is the per-endpoint p50/p99 source. AccessLog already measures latency
// for the log line but never emits it — the dashboard has no latency
// signal. RED: one request through AccessLog emits the duration series.
import (
	"net/http"
	"net/http/httptest"
	"testing"

	"example.com/ielts-proctoring/internal/platform/telemetry"
)

func TestAccessLogEmitsDuration(t *testing.T) {
	reg := telemetry.NewRegistry()
	old := telemetry.DefaultRegistry
	telemetry.DefaultRegistry = reg
	defer func() { telemetry.DefaultRegistry = old }()
	// Order matters: WithRoute must wrap OUTSIDE AccessLog (route template
	// set before AccessLog reads it) — same order as main.go's route().
	h := WithRoute(AccessLog(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})), "GET /test/dur")
	req := httptest.NewRequest(http.MethodGet, "/test/dur", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if got := telemetry.GaugeValueForTest(reg, telemetry.MHTTPRequestDur, "route", "GET /test/dur", "method", "GET", "status", "2xx"); got <= 0 {
		t.Fatalf("AccessLog must emit duration > 0, got %v", got)
	}
}
