package telemetry

import (
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCounterAccumulates(t *testing.T) {
	r := NewRegistry()
	r.IncCounter(MV2BatchTotal, "outcome", OutcomeAccepted)
	r.IncCounter(MV2BatchTotal, "outcome", OutcomeAccepted)
	r.IncCounter(MV2BatchTotal, "outcome", OutcomeRejected)
	snap := r.Snapshot()
	if !strings.Contains(snap, MV2BatchTotal+"{outcome=\"accepted\"} 2") {
		t.Fatalf("accepted series must total 2:\n%s", snap)
	}
	if !strings.Contains(snap, MV2BatchTotal+"{outcome=\"rejected\"} 1") {
		t.Fatalf("rejected series must stay separate:\n%s", snap)
	}
	if !strings.Contains(snap, "# TYPE "+MV2BatchTotal+" counter") {
		t.Fatalf("counter TYPE header missing:\n%s", snap)
	}
}

func TestLabelOrderNeverForksSeries(t *testing.T) {
	r := NewRegistry()
	r.IncCounter(MHTTPRequestsTotal, "method", "POST", "route", "GET /x")
	r.IncCounter(MHTTPRequestsTotal, "route", "GET /x", "method", "POST")
	snap := r.Snapshot()
	if !strings.Contains(snap, "{method=\"POST\",route=\"GET /x\"} 2") {
		t.Fatalf("insertion order must not fork series:\n%s", snap)
	}
}

func TestGaugeOverwritesAndSanitizes(t *testing.T) {
	r := NewRegistry()
	r.SetGauge(MOutboxPending, 3)
	r.SetGauge(MOutboxPending, 7)
	r.IncCounter("bad metric!name", "bad-label!", "v")
	snap := r.Snapshot()
	if !strings.Contains(snap, MOutboxPending+" 7\n") {
		t.Fatalf("gauge must overwrite:\n%s", snap)
	}
	if !strings.Contains(snap, "bad_metric_name{bad_label_=\"v\"} 1") {
		t.Fatalf("names must sanitize:\n%s", snap)
	}
	if !strings.Contains(snap, "# TYPE "+MOutboxPending+" gauge") {
		t.Fatalf("gauge TYPE header missing:\n%s", snap)
	}
}

func TestHandlerContentType(t *testing.T) {
	r := NewRegistry()
	r.IncCounter(MTerminalCreated, "outcome", OutcomeAccepted)
	rec := httptest.NewRecorder()
	r.Handler()(rec, httptest.NewRequest("GET", "/metrics", nil))
	if ct := rec.Header().Get("Content-Type"); ct != "text/plain; version=0.0.4" {
		t.Fatalf("content type must be prometheus text, got %q", ct)
	}
	if !strings.Contains(rec.Body.String(), MTerminalCreated) {
		t.Fatalf("body must carry series:\n%s", rec.Body.String())
	}
}
