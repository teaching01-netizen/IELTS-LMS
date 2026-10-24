package telemetry

import (
	"fmt"
	"math"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
)

// Registry is a dependency-free Prometheus exposition registry (plan 68-69).
// Stdlib only: counters and gauges keyed by metric name + sorted label
// pairs. No external client library is vendored (go.mod stays minimal).
//
// Cardinality rule: callers must pass only low-cardinality label values
// (outcome, route template, method, status class). Never use attempt,
// schedule, user or session ids as label values; those belong in
// logs/traces, never in metric labels.
type Registry struct {
	mu       sync.Mutex
	counters map[string]float64
	gauges   map[string]float64
	names    map[string]string
	// histograms: metric name -> normalized label set (labelSetKey) -> series.
	histograms map[string]map[string]*histogramSeries
}

// NewRegistry builds an empty registry.
func NewRegistry() *Registry {
	return &Registry{counters: map[string]float64{}, gauges: map[string]float64{}, names: map[string]string{}, histograms: map[string]map[string]*histogramSeries{}}
}

// histogramBounds are the finite bucket upper bounds, ascending. The
// millisecond bounds make single SQL statements and short transactions
// visible; the rest serve the SAT handoff p99 alerts.
var histogramBounds = [...]float64{0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.5, 1, 2, 3, 5, 10, 15, 20, 30, 60, 120}

// histogramLe is the exposition "le" value of each bound, then "+Inf".
var histogramLe = func() []string {
	le := make([]string, 0, len(histogramBounds)+1)
	for _, bound := range histogramBounds {
		le = append(le, fmt.Sprint(bound))
	}
	return append(le, "+Inf")
}()

// histogramSeries is one label set of a histogram as plain numbers. buckets
// are NON-cumulative (index len(histogramBounds) is the overflow above the
// last bound); Snapshot accumulates them into Prometheus "le" buckets.
type histogramSeries struct {
	labels  []labelPair
	buckets [len(histogramBounds) + 1]uint64
	count   uint64
	sum     float64
}

// ObserveSeconds records a duration using bounded buckets suitable for SAT
// handoff p99 alerts. Labels obey the same cardinality rules as counters.
func ObserveSeconds(name string, value float64, labels ...string) {
	DefaultRegistry.ObserveSeconds(name, value, labels...)
}

func (r *Registry) ObserveSeconds(name string, value float64, labels ...string) {
	if value < 0 || math.IsNaN(value) || math.IsInf(value, 0) {
		return
	}
	name = sanitizeMetricName(name)
	pairs := normalizeLabels(labels)
	key := labelSetKey(pairs)
	// First bound >= value: the one bucket this observation lands in.
	bucket := sort.SearchFloat64s(histogramBounds[:], value)
	r.mu.Lock()
	defer r.mu.Unlock()
	series := r.histograms[name]
	if series == nil {
		series = map[string]*histogramSeries{}
		r.histograms[name] = series
	}
	h := series[key]
	if h == nil {
		h = &histogramSeries{labels: pairs}
		series[key] = h
	}
	h.buckets[bucket]++
	h.count++
	h.sum += value
	r.names[name] = "histogram"
}

// DefaultRegistry is the process-wide registry served by /metrics.
var DefaultRegistry = newDefaultRegistry()

func newDefaultRegistry() *Registry {
	r := NewRegistry()
	// These bounded SAT exam-day series back operational alerts and should be
	// visible before their first increment, including on a fresh deployment.
	for _, series := range []struct {
		name   string
		labels []string
	}{
		{MSATScoreSource, []string{"source", SATScoreV2}},
		{MSATScoreSource, []string{"source", SATScoreLegacy}},
		{MSATFinalizeTotal, []string{"outcome", FinalizeCompleted}},
		{MSATFinalizeTotal, []string{"outcome", FinalizeReplayed}},
		{MSATFinalizeTotal, []string{"outcome", FinalizeRejected}},
		{MSATHeartbeatTotal, []string{"path", HeartbeatMemory}},
		{MSATHeartbeatTotal, []string{"path", HeartbeatInline}},
		{MSATRecoveryBoundaryTotal, []string{"event", "opened"}},
		{MSATRecoveryBoundaryTotal, []string{"event", "settled"}},
		{MSATRecoveryBoundaryTotal, []string{"event", "expired"}},
		{MSATRecoveryBoundaryTotal, []string{"event", "entry_expired"}},
		{MSATRecoveryBoundaryTotal, []string{"event", "entry_resolved"}},
		{MSATRecoveryBoundaryTotal, []string{"event", "resolved"}},
		{MSATRecoveryRegistrationTotal, []string{"outcome", "registered"}},
		{MSATRecoveryRegistrationTotal, []string{"outcome", "replayed"}},
		{MSATRecoveryRegistrationTotal, []string{"outcome", "expired"}},
		{MSATCloseAdmissionTotal, []string{"outcome", "admitted"}},
		{MSATCloseAdmissionTotal, []string{"outcome", "admitted_after_wait"}},
		{MSATCloseAdmissionTotal, []string{"outcome", "rejected"}},
		{MSATCloseAdmissionTotal, []string{"outcome", "cancelled"}},
		{MSATCloseAdmissionTotal, []string{"outcome", "timed_out"}},
		{MSATRecoveryResolutionTotal, []string{"action", "continue_confirmed", "actor", "student", "outcome", "committed"}},
		{MSATRecoveryResolutionTotal, []string{"action", "continue_confirmed", "actor", "student", "outcome", "replayed"}},
		{MSATRecoveryResolutionTotal, []string{"action", "continue_confirmed", "actor", "staff", "outcome", "committed"}},
		{MSATRecoveryResolutionTotal, []string{"action", "continue_confirmed", "actor", "staff", "outcome", "replayed"}},
		{MSATRecoveryResolutionTotal, []string{"action", "activate_entry", "actor", "student", "outcome", "committed"}},
		{MSATRecoveryResolutionTotal, []string{"action", "activate_entry", "actor", "student", "outcome", "replayed"}},
		{MSATRecoveryResolutionTotal, []string{"action", "activate_entry", "actor", "staff", "outcome", "committed"}},
		{MSATRecoveryResolutionTotal, []string{"action", "activate_entry", "actor", "staff", "outcome", "replayed"}},
	} {
		r.RegisterCounter(series.name, series.labels...)
	}
	return r
}

// IncCounter adds 1 to the counter series name{labelPairs...}.
// labelPairs are alternating key,value strings; a dangling key is dropped.
func (r *Registry) IncCounter(name string, labelPairs ...string) {
	key, mname := seriesKey(name, labelPairs)
	r.mu.Lock()
	defer r.mu.Unlock()
	r.counters[key]++
	r.names[mname] = "counter"
}

// RegisterCounter makes a counter series visible at zero before the first
// event. Incrementing the same name and labels later updates that series.
func (r *Registry) RegisterCounter(name string, labelPairs ...string) {
	key, mname := seriesKey(name, labelPairs)
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.counters[key]; !exists {
		r.counters[key] = 0
	}
	r.names[mname] = "counter"
}

// SetCounter sets the counter series name{labelPairs...} to value. It is for
// cumulative totals owned by another component (e.g. database/sql DBStats),
// which only ever grow while that component lives.
func (r *Registry) SetCounter(name string, value float64, labelPairs ...string) {
	key, mname := seriesKey(name, labelPairs)
	r.mu.Lock()
	defer r.mu.Unlock()
	r.counters[key] = value
	r.names[mname] = "counter"
}

// SetGauge sets the gauge series name{labelPairs...} to value.
func (r *Registry) SetGauge(name string, value float64, labelPairs ...string) {
	key, mname := seriesKey(name, labelPairs)
	r.mu.Lock()
	defer r.mu.Unlock()
	r.gauges[key] = value
	r.names[mname] = "gauge"
}

// IncCounter adds 1 on the process registry.
func IncCounter(name string, labelPairs ...string) {
	DefaultRegistry.IncCounter(name, labelPairs...)
}

// CounterValueForTest reads one series (test seam for wire-level outcome
// assertions). Returns 0 for absent series.
func CounterValueForTest(r *Registry, name string, labelPairs ...string) float64 {
	key, _ := seriesKey(name, labelPairs)
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.counters[key]
}

// GaugeValueForTest reads one gauge series (test seam for duration/lag
// assertions). Returns 0 for absent series.
func GaugeValueForTest(r *Registry, name string, labelPairs ...string) float64 {
	key, _ := seriesKey(name, labelPairs)
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.gauges[key]
}

// ResetForTest clears all series (test isolation; never call in prod).
func ResetForTest(r *Registry) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.counters = map[string]float64{}
	r.gauges = map[string]float64{}
	r.histograms = map[string]map[string]*histogramSeries{}
}

// SetCounter sets a cumulative counter on the process registry.
func SetCounter(name string, value float64, labelPairs ...string) {
	DefaultRegistry.SetCounter(name, value, labelPairs...)
}

// SetGauge sets a gauge on the process registry.
func SetGauge(name string, value float64, labelPairs ...string) {
	DefaultRegistry.SetGauge(name, value, labelPairs...)
}

// seriesKey normalizes a metric name + label pairs into a stable series key.
// Label pairs sort by key so insertion order never forks a series.
func seriesKey(name string, pairs []string) (key, metricName string) {
	metricName = sanitizeMetricName(name)
	return renderSeries(metricName, normalizeLabels(pairs), "", ""), metricName
}

type labelPair struct{ k, v string }

// normalizeLabels sanitizes alternating key,value strings (a dangling key or
// an empty sanitized key is dropped) and sorts them by key.
func normalizeLabels(pairs []string) []labelPair {
	var kvs []labelPair
	for i := 0; i+1 < len(pairs); i += 2 {
		k := sanitizeLabelName(pairs[i])
		if k == "" {
			continue
		}
		kvs = append(kvs, labelPair{k, pairs[i+1]})
	}
	sort.Slice(kvs, func(i, j int) bool { return kvs[i].k < kvs[j].k })
	return kvs
}

// labelSetKey identifies a normalized label set; only equality matters.
func labelSetKey(kvs []labelPair) string {
	if len(kvs) == 0 {
		return ""
	}
	return renderSeries("", kvs, "", "")
}

// renderSeries writes metricName{k="v",...}, with the optional extra pair
// (the histogram "le") inserted at its sorted position.
func renderSeries(metricName string, kvs []labelPair, extraK, extraV string) string {
	var sb strings.Builder
	sb.WriteString(metricName)
	if len(kvs) == 0 && extraK == "" {
		return sb.String()
	}
	sb.WriteString("{")
	n := 0
	write := func(k, v string) {
		if n > 0 {
			sb.WriteString(",")
		}
		sb.WriteString(k)
		sb.WriteString("=")
		sb.WriteString(strconv.Quote(v))
		n++
	}
	extraDone := extraK == ""
	for _, p := range kvs {
		if !extraDone && extraK < p.k {
			write(extraK, extraV)
			extraDone = true
		}
		write(p.k, p.v)
	}
	if !extraDone {
		write(extraK, extraV)
	}
	sb.WriteString("}")
	return sb.String()
}

func sanitizeMetricName(s string) string {
	s = strings.TrimSpace(s)
	var sb strings.Builder
	for i, r := range s {
		if (r >= 97 && r <= 122) || (r >= 65 && r <= 90) || r == 95 || r == 58 || (r >= 48 && r <= 57 && i > 0) {
			sb.WriteRune(r)
		} else {
			sb.WriteRune(95)
		}
	}
	if sb.Len() == 0 {
		return "unnamed_metric"
	}
	return sb.String()
}

func sanitizeLabelName(s string) string {
	s = strings.TrimSpace(s)
	var sb strings.Builder
	for i, r := range s {
		if (r >= 97 && r <= 122) || (r >= 65 && r <= 90) || r == 95 || (r >= 48 && r <= 57 && i > 0) {
			sb.WriteRune(r)
		} else {
			sb.WriteRune(95)
		}
	}
	return sb.String()
}

// Snapshot renders the exposition text: one TYPE header per metric name,
// series sorted for stable output.
func (r *Registry) Snapshot() string {
	r.mu.Lock()
	type series struct {
		name  string
		key   string
		kind  string
		value float64
	}
	var all []series
	type histogramCopy struct {
		name string
		histogramSeries
	}
	var histograms []histogramCopy
	for name, set := range r.histograms {
		for _, h := range set {
			histograms = append(histograms, histogramCopy{name, *h})
		}
	}
	for k, v := range r.counters {
		all = append(all, series{name: metricOf(k), key: k, kind: "counter", value: v})
	}
	for k, v := range r.gauges {
		all = append(all, series{name: metricOf(k), key: k, kind: "gauge", value: v})
	}
	names := map[string]string{}
	for n, kind := range r.names {
		names[n] = kind
	}
	r.mu.Unlock()
	// Exposition strings are built outside the lock, from the copied numbers.
	for _, h := range histograms {
		var cumulative uint64
		for i, le := range histogramLe {
			cumulative += h.buckets[i]
			all = append(all, series{name: h.name, key: renderSeries(h.name+"_bucket", h.labels, "le", le), kind: "histogram", value: float64(cumulative)})
		}
		all = append(all,
			series{name: h.name, key: renderSeries(h.name+"_count", h.labels, "", ""), kind: "histogram", value: float64(h.count)},
			series{name: h.name, key: renderSeries(h.name+"_sum", h.labels, "", ""), kind: "histogram", value: h.sum},
		)
	}
	sort.Slice(all, func(i, j int) bool {
		if all[i].name != all[j].name {
			return all[i].name < all[j].name
		}
		return all[i].key < all[j].key
	})
	var sb strings.Builder
	lastName := ""
	for _, s := range all {
		if s.name != lastName {
			kind := names[s.name]
			if kind == "" {
				kind = s.kind
			}
			fmt.Fprintf(&sb, "# HELP %s %s\n", s.name, metricHelp(s.name))
			fmt.Fprintf(&sb, "# TYPE %s %s\n", s.name, kind)
			lastName = s.name
		}
		fmt.Fprintf(&sb, "%s %v\n", s.key, s.value)
	}
	return sb.String()
}

func metricHelp(name string) string {
	if help, ok := metricHelpText[name]; ok {
		return help
	}
	return fmt.Sprintf("Application metric %s.", name)
}

func metricOf(key string) string {
	if i := strings.Index(key, "{"); i >= 0 {
		return key[:i]
	}
	return key
}

// Handler serves the Prometheus exposition with the stable content type.
func (r *Registry) Handler() http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/plain; version=0.0.4")
		_, _ = w.Write([]byte(r.Snapshot()))
	}
}
