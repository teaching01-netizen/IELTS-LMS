package telemetry

import (
	"fmt"
	"math"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync"
	"testing"
)

func TestDurationHistogramExposition(t *testing.T) {
	r := NewRegistry()
	r.ObserveSeconds(MSATRouteLagSeconds, 1, "basis", "client_confirmed")
	r.ObserveSeconds(MSATRouteLagSeconds, 3, "basis", "client_confirmed")
	r.ObserveSeconds(MSATRouteLagSeconds, math.NaN(), "basis", "client_confirmed")
	for _, expected := range []string{
		"# TYPE sat_route_lag_seconds histogram",
		"sat_route_lag_seconds_bucket{basis=\"client_confirmed\",le=\"2\"} 1",
		"sat_route_lag_seconds_bucket{basis=\"client_confirmed\",le=\"+Inf\"} 2",
		"sat_route_lag_seconds_sum{basis=\"client_confirmed\"} 4",
		"sat_route_lag_seconds_count{basis=\"client_confirmed\"} 2",
	} {
		if !strings.Contains(r.Snapshot(), expected) {
			t.Fatalf("missing %s in %s", expected, r.Snapshot())
		}
	}
}

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

// legacyHistogramLines is the pre-numeric ObserveSeconds algorithm (one
// string series per bucket, built per observation), run over the current
// bounds. It is the oracle for the exposition the numeric series must render.
func legacyHistogramLines(name string, observations []struct {
	value  float64
	labels []string
}) map[string]float64 {
	samples := map[string]float64{}
	name = sanitizeMetricName(name)
	for _, o := range observations {
		if o.value < 0 || math.IsNaN(o.value) || math.IsInf(o.value, 0) {
			continue
		}
		for _, bound := range histogramBounds {
			key, _ := seriesKey(name+"_bucket", append(append([]string{}, o.labels...), "le", fmt.Sprint(bound)))
			if o.value <= bound {
				samples[key]++
			} else if _, exists := samples[key]; !exists {
				samples[key] = 0
			}
		}
		inf, _ := seriesKey(name+"_bucket", append(append([]string{}, o.labels...), "le", "+Inf"))
		count, _ := seriesKey(name+"_count", o.labels)
		sum, _ := seriesKey(name+"_sum", o.labels)
		samples[inf]++
		samples[count]++
		samples[sum] += o.value
	}
	return samples
}

func TestHistogramExpositionMatchesLegacySeries(t *testing.T) {
	observations := []struct {
		value  float64
		labels []string
	}{
		{0, []string{"operation", "query", "outcome", "ok"}},
		{0.001, []string{"outcome", "ok", "operation", "query"}}, // label permutation, exact bound
		{0.0015, []string{"operation", "query", "outcome", "ok"}},
		{0.1, []string{"operation", "exec", "outcome", "error"}},
		{0.75, []string{"operation", "exec", "outcome", "error"}},
		{120, []string{"operation", "exec", "outcome", "error"}},
		{121, []string{"operation", "exec", "outcome", "error"}}, // overflow: +Inf only
		{3, []string{"zeta", "z", "a", "first"}},                 // labels sorting on both sides of "le"
		{2.5, nil},
		{-1, []string{"operation", "query", "outcome", "ok"}},
		{math.Inf(1), []string{"operation", "query", "outcome", "ok"}},
	}
	r := NewRegistry()
	for _, o := range observations {
		r.ObserveSeconds("db_query_seconds", o.value, o.labels...)
	}
	want := legacyHistogramLines("db_query_seconds", observations)
	got := map[string]float64{}
	for _, line := range strings.Split(strings.TrimSpace(r.Snapshot()), "\n") {
		if strings.HasPrefix(line, "#") {
			continue
		}
		i := strings.LastIndex(line, " ")
		var v float64
		if _, err := fmt.Sscan(line[i+1:], &v); err != nil {
			t.Fatalf("unparseable line %q", line)
		}
		got[line[:i]] = v
		if want := fmt.Sprintf("%s %v", line[:i], want[line[:i]]); line != want {
			t.Fatalf("line %q, legacy renders %q", line, want)
		}
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("series differ:\n got %v\nwant %v", got, want)
	}
	if !strings.Contains(r.Snapshot(), `db_query_seconds_bucket{le="0.001",operation="query",outcome="ok"} 2`) {
		t.Fatalf("millisecond bucket missing:\n%s", r.Snapshot())
	}
}

// A dangling label key is dropped, as for counters. (The string-keyed
// implementation appended "le" after it and rendered {dangling="le"}.)
func TestHistogramDropsDanglingLabelKey(t *testing.T) {
	r := NewRegistry()
	r.ObserveSeconds(MQueryDur, 2.5, "dangling")
	if !strings.Contains(r.Snapshot(), MQueryDur+`_bucket{le="3"} 1`+"\n") || strings.Contains(r.Snapshot(), "dangling") {
		t.Fatalf("dangling key must be dropped:\n%s", r.Snapshot())
	}
}

func TestHistogramResetForTest(t *testing.T) {
	r := NewRegistry()
	r.ObserveSeconds(MQueryDur, 0.01, "operation", "query")
	ResetForTest(r)
	if strings.Contains(r.Snapshot(), MQueryDur+"_bucket") {
		t.Fatalf("reset must drop histogram series:\n%s", r.Snapshot())
	}
	r.ObserveSeconds(MQueryDur, 0.01, "operation", "query")
	if !strings.Contains(r.Snapshot(), MQueryDur+`_count{operation="query"} 1`) {
		t.Fatalf("series must restart after reset:\n%s", r.Snapshot())
	}
}

func TestHistogramConcurrentObserveAndScrape(t *testing.T) {
	r := NewRegistry()
	var wg sync.WaitGroup
	for g := 0; g < 8; g++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := 0; i < 500; i++ {
				r.ObserveSeconds(MQueryDur, 0.004, "operation", "query")
				if i%100 == 0 {
					_ = r.Snapshot()
				}
			}
		}()
	}
	wg.Wait()
	snap := r.Snapshot()
	for _, line := range []string{
		MQueryDur + `_bucket{le="0.002",operation="query"} 0`,
		MQueryDur + `_bucket{le="0.005",operation="query"} 4000`,
		MQueryDur + `_bucket{le="+Inf",operation="query"} 4000`,
		MQueryDur + `_count{operation="query"} 4000`,
	} {
		if !strings.Contains(snap, line+"\n") {
			t.Fatalf("missing %q in:\n%s", line, snap)
		}
	}
}
