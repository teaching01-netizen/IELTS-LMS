package satconvert

import (
	"encoding/json"
	"strconv"
	"strings"
	"testing"
)

// LinearTable is a test fixture: raw r of n ↦ base + 10·r, capped at 800.
func linearTable(n, base int) map[string]any {
	scores := map[string]any{}
	for r := 0; r <= n; r++ {
		scores[strconv.Itoa(r)] = min(base+10*r, 800)
	}
	return map[string]any{"operationalQuestions": n, "scores": scores}
}

func policy(t *testing.T, sections map[string]map[string]string, tables map[string]any) []byte {
	t.Helper()
	raw, err := json.Marshal(map[string]any{
		"converterVersion": "classroom-v1", "scoreType": "estimated_sat", "calibrationSource": "staff_approved",
		"sections": sections, "tables": tables,
	})
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func TestParseAcceptsPointsAndRanges(t *testing.T) {
	table := linearTable(3, 200)
	table["scores"].(map[string]any)["2"] = map[string]int{"low": 210, "high": 230}
	c, err := Parse(policy(t, map[string]map[string]string{"math": {"full_lower": "m"}}, map[string]any{"m": table}))
	if err != nil {
		t.Fatal(err)
	}
	if s, ok := c.Convert("math", FullLower, 2, 3); !ok || s != (Score{210, 230}) {
		t.Fatalf("range entry = %+v %v", s, ok)
	}
	if s, ok := c.Convert("math", FullLower, 3, 3); !ok || s != (Score{230, 230}) {
		t.Fatalf("point entry = %+v %v", s, ok)
	}
}

func TestParseRejectsInvalidTables(t *testing.T) {
	sections := map[string]map[string]string{"math": {"full_lower": "m"}}
	withScore := func(raw string, v any) map[string]any {
		table := linearTable(3, 200)
		table["scores"].(map[string]any)[raw] = v
		return table
	}
	missing := linearTable(3, 200)
	delete(missing["scores"].(map[string]any), "1")
	extra := linearTable(3, 200)
	extra["scores"].(map[string]any)["4"] = 800
	cases := map[string][]byte{
		"null entry":         policy(t, sections, map[string]any{"m": withScore("1", nil)}),
		"out of range":       policy(t, sections, map[string]any{"m": withScore("1", 7000)}),
		"not multiple of 10": policy(t, sections, map[string]any{"m": withScore("1", 215)}),
		"inverted range":     policy(t, sections, map[string]any{"m": withScore("1", map[string]int{"low": 300, "high": 250})}),
		"fraction":           policy(t, sections, map[string]any{"m": withScore("1", 210.5)}),
		"missing raw":        policy(t, sections, map[string]any{"m": missing}),
		"extra raw":          policy(t, sections, map[string]any{"m": extra}),
		"dangling table":     policy(t, map[string]map[string]string{"math": {"full_lower": "nope"}}, map[string]any{"m": linearTable(3, 200)}),
		"unknown topology":   policy(t, map[string]map[string]string{"math": {"full": "m"}}, map[string]any{"m": linearTable(3, 200)}),
		"unknown section":    policy(t, map[string]map[string]string{"science": {"full_lower": "m"}}, map[string]any{"m": linearTable(3, 200)}),
		"bad score type":     []byte(strings.Replace(string(policy(t, sections, map[string]any{"m": linearTable(3, 200)})), "estimated_sat", "official", 1)),
		"no version":         []byte(`{"scoreType":"estimated_sat","calibrationSource":"x","sections":{},"tables":{}}`),
		"unknown field":      []byte(`{"converterVersion":"v","scoreType":"estimated_sat","calibrationSource":"x","sections":{},"tables":{},"interpolate":true}`),
	}
	for name, raw := range cases {
		if _, err := Parse(raw); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}

// The legacy linear 'practice' policy from sat_initialization.go is never a
// converter, so it can never produce a number.
func TestLegacyPolicyIsNotConfigured(t *testing.T) {
	if Configured([]byte(`{"readingWriting":{"lower":{"0":200}},"math":{"lower":{"0":200}}}`)) {
		t.Fatal("legacy policy treated as a converter")
	}
	if !Configured(policy(t, nil, nil)) {
		t.Fatal("converter not detected")
	}
}

func TestTopologyOf(t *testing.T) {
	cases := []struct {
		roles []string
		want  Topology
		ok    bool
	}{
		{[]string{"base", "lower_branch"}, FullLower, true},
		{[]string{"lower_branch", "base"}, FullLower, true},
		{[]string{"base", "higher_branch"}, FullHigher, true},
		{[]string{"lower_branch"}, M2LowerOnly, true},
		{[]string{"higher_branch"}, M2HigherOnly, true},
		{[]string{"base"}, "", false},
		{[]string{"base", "lower_branch", "higher_branch"}, "", false},
		{[]string{"base", "base"}, "", false},
		{[]string{"lower_branch", "higher_branch"}, "", false},
		{[]string{""}, "", false},
		{nil, "", false},
	}
	for _, c := range cases {
		if got, ok := TopologyOf(c.roles); got != c.want || ok != c.ok {
			t.Errorf("TopologyOf(%v) = %q,%v; want %q,%v", c.roles, got, ok, c.want, c.ok)
		}
	}
}

// SC-03/SC-04/SC-05: a conversion uses only the table of its own topology and
// operational count; a standalone M2 never borrows the full table.
func TestConvertIsTopologyExact(t *testing.T) {
	c, err := Parse(policy(t, map[string]map[string]string{
		"math": {"full_lower": "fl", "full_higher": "fh"},
	}, map[string]any{"fl": linearTable(44, 200), "fh": linearTable(44, 300)}))
	if err != nil {
		t.Fatal(err)
	}
	if s, _ := c.Convert("math", FullLower, 10, 44); s.Low != 300 {
		t.Fatalf("lower = %+v", s)
	}
	if s, _ := c.Convert("math", FullHigher, 10, 44); s.Low != 400 {
		t.Fatalf("higher = %+v", s)
	}
	for name, ok := range map[string]bool{
		"standalone lower": second(c.Convert("math", M2LowerOnly, 10, 22)),
		"other section":    second(c.Convert("reading-writing", FullLower, 10, 44)),
		"count mismatch":   second(c.Convert("math", FullLower, 10, 43)),
		"raw above count":  second(c.Convert("math", FullLower, 45, 44)),
		"negative raw":     second(c.Convert("math", FullLower, -1, 44)),
	} {
		if ok {
			t.Errorf("%s converted", name)
		}
	}
	// Even with an equal operational count, a standalone never borrows a full table.
	same, err := Parse(policy(t, map[string]map[string]string{
		"math": {"full_lower": "fl", "full_higher": "fh"},
	}, map[string]any{"fl": linearTable(22, 200), "fh": linearTable(22, 300)}))
	if err != nil {
		t.Fatal(err)
	}
	for _, topo := range []Topology{M2LowerOnly, M2HigherOnly} {
		if _, ok := same.Convert("math", topo, 10, 22); ok {
			t.Errorf("%s borrowed a full table", topo)
		}
	}
	var nilConv *Converter
	if _, ok := nilConv.Convert("math", FullLower, 1, 44); ok {
		t.Fatal("nil converter converted")
	}
}

func second(_ Score, ok bool) bool { return ok }

// SC-01/SC-02: a total only from two full-topology sections.
func TestTotal(t *testing.T) {
	rw, math := &Score{600, 620}, &Score{700, 700}
	if s, ok := Total(rw, math, FullLower, FullHigher); !ok || s != (Score{1300, 1320}) {
		t.Fatalf("full total = %+v %v", s, ok)
	}
	for name, ok := range map[string]bool{
		"math only":       second(Total(nil, math, "", FullHigher)),
		"standalone rw":   second(Total(rw, math, M2LowerOnly, FullHigher)),
		"standalone both": second(Total(rw, math, M2LowerOnly, M2HigherOnly)),
	} {
		if ok {
			t.Errorf("%s produced a total", name)
		}
	}
}

func TestMissing(t *testing.T) {
	c, err := Parse(policy(t, map[string]map[string]string{"math": {"full_lower": "fl"}}, map[string]any{"fl": linearTable(44, 200)}))
	if err != nil {
		t.Fatal(err)
	}
	got := c.Missing([]Requirement{
		{"math", FullLower, 44}, {"math", FullHigher, 44}, {"math", M2LowerOnly, 22}, {"reading-writing", FullLower, 54},
	})
	if len(got) != 3 {
		t.Fatalf("missing = %v", got)
	}
	if got := c.Missing([]Requirement{{"math", FullLower, 43}}); len(got) != 1 || !strings.Contains(got[0], "covers 44") {
		t.Fatalf("count mismatch = %v", got)
	}
	if got := c.Missing([]Requirement{{"math", FullLower, 44}}); len(got) != 0 {
		t.Fatalf("complete = %v", got)
	}
}
