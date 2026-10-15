// Package satconvert owns SAT classroom score conversion. The per-exam
// Converter uses one-dimensional tables keyed by section and topology; global
// Content uses matrices for full topologies and one-dimensional tables for
// standalone Module 2. Both require exact operational dimensions and fail
// closed for missing or invalid scores. The global policy has a separate Lean
// model at verification/lean/sat-score-conversion; ConvertTopo models the
// per-exam converter at verification/lean/sat-result.
package satconvert

import (
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"
)

// Topology is the set of modules a student was administered in one section.
type Topology string

const (
	FullLower    Topology = "full_lower"     // M1 + lower M2
	FullHigher   Topology = "full_higher"    // M1 + higher M2
	M2LowerOnly  Topology = "m2_lower_only"  // standalone lower M2
	M2HigherOnly Topology = "m2_higher_only" // standalone higher M2
)

// Full reports whether the topology is a complete two-module section; only
// those may contribute to a 400–1600 total.
func (t Topology) Full() bool { return t == FullLower || t == FullHigher }

// Adaptive roles as stored in assessment_modules.adaptive_role (mirrors
// satpublish, which imports this package).
const (
	roleBase   = "base"
	roleLower  = "lower_branch"
	roleHigher = "higher_branch"
)

// TopologyOf maps the administered roles of one section to its topology; ok is
// false for any other combination (M1 only, both branches, unknown roles).
func TopologyOf(roles []string) (Topology, bool) {
	seen := map[string]int{}
	for _, r := range roles {
		seen[r]++
	}
	key := fmt.Sprintf("%d%d%d/%d", seen[roleBase], seen[roleLower], seen[roleHigher], len(roles))
	switch key {
	case "110/2":
		return FullLower, true
	case "101/2":
		return FullHigher, true
	case "010/1":
		return M2LowerOnly, true
	case "001/1":
		return M2HigherOnly, true
	}
	return "", false
}

const (
	MinScaled = 200
	MaxScaled = 800
	ScoreType = "estimated_sat"
)

// Score is one converted section score: a point when Low == High, otherwise
// the range a reference conversion supplied (§2: preserve ranges).
type Score struct {
	Low  int `json:"low"`
	High int `json:"high"`
}

// Table maps every raw score 0..OperationalQuestions to a Score.
type Table struct {
	OperationalQuestions int
	Scores               []Score // index = raw score
}

// Converter is a parsed, structurally valid policy_config.
type Converter struct {
	Version           string
	CalibrationSource string
	Sections          map[string]map[Topology]string
	Tables            map[string]Table
}

type rawConverter struct {
	ConverterVersion  string                       `json:"converterVersion"`
	ScoreType         string                       `json:"scoreType"`
	CalibrationSource string                       `json:"calibrationSource"`
	Sections          map[string]map[string]string `json:"sections"`
	Tables            map[string]rawTable          `json:"tables"`
}

type rawTable struct {
	OperationalQuestions *int                       `json:"operationalQuestions"`
	Scores               map[string]json.RawMessage `json:"scores"`
}

// Configured reports whether a stored policy_config declares a versioned
// converter. The legacy linear 'practice' policy has no converterVersion and
// is never used for conversion.
func Configured(raw []byte) bool {
	var probe struct {
		ConverterVersion *string `json:"converterVersion"`
	}
	return json.Unmarshal(raw, &probe) == nil && probe.ConverterVersion != nil
}

// Section keys (mirrors satpublish, which imports this package).
const (
	SectionReadingWriting = "reading-writing"
	SectionMath           = "math"
)

var sectionKeys = map[string]bool{SectionReadingWriting: true, SectionMath: true}

// Parse decodes and structurally validates a converter. Every error is a
// complete sentence safe to show staff.
func Parse(raw []byte) (*Converter, error) {
	var in rawConverter
	dec := json.NewDecoder(strings.NewReader(string(raw)))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&in); err != nil {
		return nil, fmt.Errorf("Score converter is not valid JSON: %v.", err)
	}
	if dec.More() {
		return nil, fmt.Errorf("Score converter has trailing content.")
	}
	version := strings.TrimSpace(in.ConverterVersion)
	if version == "" || len(version) > 64 {
		return nil, fmt.Errorf("converterVersion must contain between 1 and 64 characters.")
	}
	if in.ScoreType != ScoreType {
		return nil, fmt.Errorf("scoreType must be %q.", ScoreType)
	}
	if strings.TrimSpace(in.CalibrationSource) == "" {
		return nil, fmt.Errorf("calibrationSource is required.")
	}
	out := &Converter{Version: version, CalibrationSource: strings.TrimSpace(in.CalibrationSource), Sections: map[string]map[Topology]string{}, Tables: map[string]Table{}}
	for id, t := range in.Tables {
		table, err := parseTable(id, t)
		if err != nil {
			return nil, err
		}
		out.Tables[id] = table
	}
	for section, topos := range in.Sections {
		if !sectionKeys[section] {
			return nil, fmt.Errorf("Unknown section %q in score converter.", section)
		}
		out.Sections[section] = map[Topology]string{}
		for topo, id := range topos {
			switch Topology(topo) {
			case FullLower, FullHigher, M2LowerOnly, M2HigherOnly:
			default:
				return nil, fmt.Errorf("Unknown topology %q for %s.", topo, section)
			}
			if _, ok := out.Tables[id]; !ok {
				return nil, fmt.Errorf("%s %s references missing table %q.", section, topo, id)
			}
			out.Sections[section][Topology(topo)] = id
		}
	}
	return out, nil
}

func parseTable(id string, t rawTable) (Table, error) {
	if t.OperationalQuestions == nil || *t.OperationalQuestions <= 0 || *t.OperationalQuestions > 500 {
		return Table{}, fmt.Errorf("Table %q needs operationalQuestions between 1 and 500.", id)
	}
	n := *t.OperationalQuestions
	if len(t.Scores) != n+1 {
		return Table{}, fmt.Errorf("Table %q must map exactly raw scores 0 to %d; it has %d entries.", id, n, len(t.Scores))
	}
	scores := make([]Score, n+1)
	for raw := 0; raw <= n; raw++ {
		entry, ok := t.Scores[strconv.Itoa(raw)]
		if !ok {
			return Table{}, fmt.Errorf("Table %q is missing raw score %d.", id, raw)
		}
		s, err := parseScore(entry)
		if err != nil {
			return Table{}, fmt.Errorf("Table %q raw score %d: %v", id, raw, err)
		}
		scores[raw] = s
	}
	return Table{OperationalQuestions: n, Scores: scores}, nil
}

func parseScore(entry json.RawMessage) (Score, error) {
	// Pointers make JSON null fail closed instead of decoding to 0.
	var point *int
	if json.Unmarshal(entry, &point) == nil {
		if point == nil {
			return Score{}, fmt.Errorf("a score is required.")
		}
		return checkScore(Score{*point, *point})
	}
	var r struct {
		Low  *int `json:"low"`
		High *int `json:"high"`
	}
	dec := json.NewDecoder(strings.NewReader(string(entry)))
	dec.DisallowUnknownFields()
	if dec.Decode(&r) != nil || r.Low == nil || r.High == nil {
		return Score{}, fmt.Errorf("expected an integer or {\"low\", \"high\"}.")
	}
	return checkScore(Score{*r.Low, *r.High})
}

func checkScore(s Score) (Score, error) {
	if s.Low < MinScaled || s.High > MaxScaled || s.Low > s.High || s.Low%10 != 0 || s.High%10 != 0 {
		return Score{}, fmt.Errorf("scores must be multiples of 10 within 200–800, low ≤ high.")
	}
	return s, nil
}

// Convert returns the score for (section, topology, raw) when the converter
// has a table for exactly that topology whose operational count equals the
// attempt's; ok is false otherwise.
func (c *Converter) Convert(section string, topo Topology, raw, operational int) (Score, bool) {
	if c == nil {
		return Score{}, false
	}
	id, ok := c.Sections[section][topo]
	if !ok {
		return Score{}, false
	}
	t := c.Tables[id]
	if operational != t.OperationalQuestions || raw < 0 || raw > operational {
		return Score{}, false
	}
	return t.Scores[raw], true
}

// Total is the 400–1600 total: present only when both sections converted from
// full two-module topologies (SC-01, SC-02, §3 "no invented 1600 total").
func Total(rw, math *Score, rwTopo, mathTopo Topology) (Score, bool) {
	if rw == nil || math == nil || !rwTopo.Full() || !mathTopo.Full() {
		return Score{}, false
	}
	return Score{rw.Low + math.Low, rw.High + math.High}, true
}

// Requirement is one table a publish needs: the section, the topology a plan
// can deliver, and the operational count students will see.
type Requirement struct {
	Section     string
	Topology    Topology
	Operational int
}

// Missing lists, in a stable order, every requirement the converter cannot
// convert (no table for the topology, or a table for another count).
func (c *Converter) Missing(reqs []Requirement) []string {
	var out []string
	for _, r := range reqs {
		id, ok := c.Sections[r.Section][r.Topology]
		switch {
		case !ok:
			out = append(out, fmt.Sprintf("%s %s has no conversion table.", r.Section, r.Topology))
		case c.Tables[id].OperationalQuestions != r.Operational:
			out = append(out, fmt.Sprintf("%s %s table %q covers %d operational questions; the exam delivers %d.", r.Section, r.Topology, id, c.Tables[id].OperationalQuestions, r.Operational))
		}
	}
	sort.Strings(out)
	return out
}
