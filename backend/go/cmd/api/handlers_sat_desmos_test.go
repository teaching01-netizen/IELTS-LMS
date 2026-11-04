package main

// Plan 2026-11-04 §4 Track B: the Desmos outcome beacon contract
// (POST /api/v1/sat/desmos-outcome) plus the additive 429/503 queue
// fields. The beacon decode is the client-visible shape pin: a renamed
// frontend field, an open vocabulary, or unbounded durations must fail
// loudly as 400, never silently as a dropped series.
import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"example.com/ielts-proctoring/internal/delivery"
	"example.com/ielts-proctoring/internal/platform/config"
	"example.com/ielts-proctoring/internal/platform/telemetry"
)

func desmosBeaconRequest(t *testing.T, body string) *http.Request {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/sat/desmos-outcome", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	return req
}

func TestDecodeDesmosOutcomeValid(t *testing.T) {
	for _, tc := range []struct{ mode, outcome string }{
		{"scientific", "ready"},
		{"graphing", "ready"},
		{"scientific", "timeout"},
		{"graphing", "blocked"},
		{"scientific", "error"},
	} {
		req := desmosBeaconRequest(t, `{"scheduleId":"sched-1","attemptId":"att-1","moduleAttemptId":"ma-1","mode":"`+tc.mode+`","outcome":"`+tc.outcome+`","durationMs":1200,"buildSHA":"abc123"}`)
		got, err := decodeDesmosOutcomeBody(req)
		if err != nil {
			t.Fatalf("mode=%s outcome=%s must decode: %v", tc.mode, tc.outcome, err)
		}
		if got.Mode != tc.mode || got.Outcome != tc.outcome || got.DurationMs != 1200 {
			t.Fatalf("decoded beacon mismatch: %+v", got)
		}
	}
}

func TestDecodeDesmosOutcomeInvalid(t *testing.T) {
	valid := `{"scheduleId":"sched-1","attemptId":"att-1","moduleAttemptId":"ma-1","mode":"scientific","outcome":"ready","durationMs":1200,"buildSHA":"abc123"}`
	cases := map[string]string{
		"missing schedule":   `{"attemptId":"att-1","moduleAttemptId":"ma-1","mode":"scientific","outcome":"ready","durationMs":1200,"buildSHA":"abc123"}`,
		"missing attempt":    `{"scheduleId":"sched-1","moduleAttemptId":"ma-1","mode":"scientific","outcome":"ready","durationMs":1200,"buildSHA":"abc123"}`,
		"missing module":     `{"scheduleId":"sched-1","attemptId":"att-1","mode":"scientific","outcome":"ready","durationMs":1200,"buildSHA":"abc123"}`,
		"bad mode":           strings.Replace(valid, `"scientific"`, `"four-function"`, 1),
		"bad outcome":        strings.Replace(valid, `"ready"`, `"slow"`, 1),
		"negative duration":  strings.Replace(valid, `1200`, `-5`, 1),
		"absurd duration":    strings.Replace(valid, `1200`, `99999999999`, 1),
		"empty build":        strings.Replace(valid, `"abc123"`, `""`, 1),
		"unknown field":      strings.Replace(valid, `"buildSHA":"abc123"`, `"buildSHA":"abc123","extra":1`, 1),
		"non-object":         `[1,2,3]`,
		"wrong duration str": strings.Replace(valid, `1200`, `"fast"`, 1),
	}
	for name, body := range cases {
		req := desmosBeaconRequest(t, body)
		if _, err := decodeDesmosOutcomeBody(req); err == nil {
			t.Errorf("%s must be a 400-class decode error, decoded clean", name)
		}
	}
}

func TestDesmosBeaconRequiresBearer(t *testing.T) {
	cfg := config.Load()
	app := BuildApp(cfg, nil)
	rec := httptest.NewRecorder()
	req := desmosBeaconRequest(t, `{"scheduleId":"s","attemptId":"a","moduleAttemptId":"m","mode":"scientific","outcome":"ready","durationMs":1,"buildSHA":"b"}`)
	satDesmosOutcomeHandler(app).ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("bearer-less beacon must 401, got %d", rec.Code)
	}
	if code := decodeCode(t, rec); code != "ATTEMPT_TOKEN_INVALID" {
		t.Fatalf("bearer-less beacon envelope must be ATTEMPT_TOKEN_INVALID, got %q", code)
	}
}

func TestDesmosBeaconRejectsUnverifiableBearer(t *testing.T) {
	cfg := config.Load()
	app := BuildApp(cfg, nil)
	rec := httptest.NewRecorder()
	req := desmosBeaconRequest(t, `{"scheduleId":"s","attemptId":"a","moduleAttemptId":"m","mode":"scientific","outcome":"ready","durationMs":1,"buildSHA":"b"}`)
	req.Header.Set("Authorization", "Bearer not-a-real-token")
	satDesmosOutcomeHandler(app).ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("forged beacon bearer must 401, got %d (%s)", rec.Code, rec.Body.String())
	}
}

// Track B queue fields on the close path: the admission-full 429 carries
// the sampled bulkhead depth; the historical no-queue shape is unchanged.
func TestCloseAdmissionFull429CarriesQueueDepth(t *testing.T) {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/modules/close", nil)
	writeDeliveryCloseErrorWithQueue(rec, req, 12, delivery.ErrSATCloseAdmissionFull)
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("full close must 429, got %d", rec.Code)
	}
	if got := rec.Header().Get("Retry-After"); got != "1" {
		t.Fatalf("Retry-After must be 1, got %q", got)
	}
	if got := rec.Header().Get("X-Queue-Depth"); got != "12" {
		t.Fatalf("X-Queue-Depth must be 12, got %q", got)
	}
	var body struct {
		Code    string         `json:"code"`
		Details map[string]any `json:"details"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("close 429 body must be JSON: %v", err)
	}
	if body.Details["retryAfterSeconds"] != float64(1) || body.Details["queueDepth"] != float64(12) {
		t.Fatalf("close 429 body must carry retryAfterSeconds=1 + queueDepth=12, got %v", body.Details)
	}
}

func TestCloseAdmissionFull429WithoutQueueKeepsLegacyShape(t *testing.T) {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/modules/close", nil)
	writeDeliveryCloseErrorWithQueue(rec, req, -1, delivery.ErrSATCloseAdmissionFull)
	if rec.Code != http.StatusTooManyRequests || rec.Header().Get("Retry-After") != "1" {
		t.Fatalf("legacy close 429 shape must hold: status=%d headers=%v", rec.Code, rec.Header())
	}
	if got := rec.Header().Get("X-Queue-Depth"); got != "" {
		t.Fatalf("unknown queue must not set X-Queue-Depth, got %q", got)
	}
	var body struct {
		Details map[string]any `json:"details"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("close 429 body must be JSON: %v", err)
	}
	if _, ok := body.Details["queueDepth"]; ok {
		t.Fatalf("unknown queue must not set details.queueDepth, got %v", body.Details)
	}
}

// Track B queue fields on the 503 path: budget-exhaustion 503s carry the
// position when known and keep the historical shape when unknown.
func TestEntryError503CarriesQueueDepthWhenKnown(t *testing.T) {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/modules/start", nil)
	writeEntryErrorWithQueue(rec, req, context.DeadlineExceeded, 4)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("entry exhaustion must 503, got %d", rec.Code)
	}
	if got := rec.Header().Get("Retry-After"); got != "1" {
		t.Fatalf("Retry-After must be 1, got %q", got)
	}
	if got := rec.Header().Get("X-Queue-Depth"); got != "4" {
		t.Fatalf("X-Queue-Depth must be 4, got %q", got)
	}
	var body struct {
		Details map[string]any `json:"details"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("503 body must be JSON: %v", err)
	}
	if body.Details["retryAfterSeconds"] != float64(1) || body.Details["queueDepth"] != float64(4) {
		t.Fatalf("503 body must carry retryAfterSeconds=1 + queueDepth=4, got %v", body.Details)
	}
}

func TestEntryError503WithoutQueueKeepsLegacyShape(t *testing.T) {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/modules/start", nil)
	writeEntryErrorWithQueue(rec, req, context.DeadlineExceeded, -1)
	if rec.Code != http.StatusServiceUnavailable || rec.Header().Get("Retry-After") != "1" {
		t.Fatalf("legacy 503 shape must hold: status=%d headers=%v", rec.Code, rec.Header())
	}
	if got := rec.Header().Get("X-Queue-Depth"); got != "" {
		t.Fatalf("unknown queue must not set X-Queue-Depth, got %q", got)
	}
}

// The beacon registers closed-vocabulary series only: outcome/mode labels
// are emitted, never ids. A successful ready beacon increments both the
// outcome counter and the ready-latency histogram; failures increment the
// counter without touching the histogram.
func TestDesmosOutcomeMetricsUseClosedVocabulary(t *testing.T) {
	reg := telemetry.NewRegistry()
	old := telemetry.DefaultRegistry
	telemetry.DefaultRegistry = reg
	defer func() { telemetry.DefaultRegistry = old }()

	telemetry.IncCounter(telemetry.MSATDesmosOutcomeTotal, "outcome", telemetry.DesmosOutcomeTimeout, "mode", telemetry.DesmosModeGraphing)
	telemetry.ObserveSeconds(telemetry.MSATDesmosReadySeconds, 1.2, "mode", telemetry.DesmosModeScientific)
	if got := telemetry.CounterValueForTest(reg, telemetry.MSATDesmosOutcomeTotal, "outcome", "timeout", "mode", "graphing"); got != 1 {
		t.Fatalf("desmos outcome counter must be 1, got %v", got)
	}
	snap := reg.Snapshot()
	for _, needle := range []string{`sat_desmos_outcome_total{mode="graphing",outcome="timeout"} 1`, `sat_desmos_ready_seconds_count{mode="scientific"} 1`} {
		if !strings.Contains(snap, needle) {
			t.Fatalf("exposition must contain %q\n%s", needle, snap)
		}
	}
	if strings.Contains(snap, "sched-") || strings.Contains(snap, "att-") {
		t.Fatalf("no id may leak into desmos series labels\n%s", snap)
	}
}

func TestCloseQueueDepthHelper(t *testing.T) {
	if got := closeQueueDepth(nil); got != -1 {
		t.Fatalf("nil app depth must be unknown (-1), got %d", got)
	}
	cfg := config.Load()
	app := BuildApp(cfg, nil)
	if got := closeQueueDepth(app); got != -1 {
		t.Fatalf("nil-delivery depth must be unknown (-1), got %d", got)
	}
}
