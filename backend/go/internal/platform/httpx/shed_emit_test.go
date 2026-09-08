package httpx

// Plan E2: denials served under exam-shed budgets must count on
// shed_exam_requests_total IN ADDITION to the per-tier denial counter —
// that slice is the exam-day dashboard's shed-pressure signal. Ship
// budgets (shed off) must NOT touch it. RED: shed-on denial emits both.
import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"example.com/ielts-proctoring/internal/platform/telemetry"
)

func TestShedDenialEmitsBothCounters(t *testing.T) {
	reg := telemetry.NewRegistry()
	old := telemetry.DefaultRegistry
	telemetry.DefaultRegistry = reg
	defer func() { telemetry.DefaultRegistry = old }()
	defer SetShedExam(false)

	mkReq := func() *http.Request {
		req, _ := http.NewRequest(http.MethodGet, "/api/v1/student/sessions/s1/runtime", nil)
		req.RemoteAddr = "198.51.100.9:1234"
		return req
	}

	SetShedExam(true)
	rec := httptest.NewRecorder()
	denyTierRateLimit(rec, mkReq(), "polling", "ip", 2*time.Second)
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("denial must 429, got %d", rec.Code)
	}
	if got := telemetry.CounterValueForTest(reg, telemetry.MRatelimitDeniedTotal, "tier", "polling", "key_class", "ip"); got != 1 {
		t.Fatalf("tier denial counter must be 1, got %v", got)
	}
	if got := telemetry.CounterValueForTest(reg, telemetry.MShedExam); got != 1 {
		t.Fatalf("shed counter must be 1 under exam budgets, got %v", got)
	}

	SetShedExam(false)
	rec2 := httptest.NewRecorder()
	denyTierRateLimit(rec2, mkReq(), "polling", "ip", 2*time.Second)
	if got := telemetry.CounterValueForTest(reg, telemetry.MShedExam); got != 1 {
		t.Fatalf("shed counter must stay 1 with shed off, got %v", got)
	}
	if got := telemetry.CounterValueForTest(reg, telemetry.MRatelimitDeniedTotal, "tier", "polling", "key_class", "ip"); got != 2 {
		t.Fatalf("tier denial counter must be 2, got %v", got)
	}
}
