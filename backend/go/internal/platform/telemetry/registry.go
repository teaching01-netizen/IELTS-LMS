package telemetry

import (
	"fmt"
	"net/http"
	"sort"
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
}

// NewRegistry builds an empty registry.
func NewRegistry() *Registry {
	return &Registry{counters: map[string]float64{}, gauges: map[string]float64{}, names: map[string]string{}}
}

// DefaultRegistry is the process-wide registry served by /metrics.
var DefaultRegistry = NewRegistry()

// IncCounter adds 1 to the counter series name{labelPairs...}.
// labelPairs are alternating key,value strings; a dangling key is dropped.
func (r *Registry) IncCounter(name string, labelPairs ...string) {
	key, mname := seriesKey(name, labelPairs)
	r.mu.Lock()
	defer r.mu.Unlock()
	r.counters[key]++
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

// SetGauge sets a gauge on the process registry.
func SetGauge(name string, value float64, labelPairs ...string) {
	DefaultRegistry.SetGauge(name, value, labelPairs...)
}

// seriesKey normalizes a metric name + label pairs into a stable series key.
// Label pairs sort by key so insertion order never forks a series.
func seriesKey(name string, pairs []string) (key, metricName string) {
	metricName = sanitizeMetricName(name)
	type kv struct{ k, v string }
	var kvs []kv
	for i := 0; i+1 < len(pairs); i += 2 {
		k := sanitizeLabelName(pairs[i])
		if k == "" {
			continue
		}
		kvs = append(kvs, kv{k, pairs[i+1]})
	}
	sort.Slice(kvs, func(i, j int) bool { return kvs[i].k < kvs[j].k })
	var sb strings.Builder
	sb.WriteString(metricName)
	if len(kvs) > 0 {
		sb.WriteString("{")
		for i, p := range kvs {
			if i > 0 {
				sb.WriteString(",")
			}
			fmt.Fprintf(&sb, "%s=%q", p.k, p.v)
		}
		sb.WriteString("}")
	}
	return sb.String(), metricName
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
