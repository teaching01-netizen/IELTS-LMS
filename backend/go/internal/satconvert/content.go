package satconvert

// Global score-conversion policy content (schemaVersion 1).
//
// One Content holds both subjects. A full two-module topology resolves through
// a 2D matrix indexed by (Module 1 correct, Module 2 correct); a standalone
// Module 2 resolves through its own 1D table. Lookups are exact: a table is
// used only when its declared operational counts equal the attempt's, and any
// missing entry yields "unavailable", never a neighbouring or interpolated
// number. The package stays pure (no database) so the same code backs the
// publish validator, the lookup preview, the impact report and the read-time
// overlay.

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

// ContentSchemaVersion is the only content shape this build understands.
const ContentSchemaVersion = 1

// Table kinds.
const (
	KindMatrix  = "matrix"
	KindModule2 = "module2"
)

// MaxMatrixOperational bounds one matrix axis; MaxModule2Operational bounds a
// 1D table (matching the legacy per-exam converter limit).
const (
	MaxMatrixOperational  = 200
	MaxModule2Operational = 500
)

// Content is the whole policy for both subjects.
type Content struct {
	SchemaVersion int                       `json:"schemaVersion"`
	Sections      map[string]*SectionPolicy `json:"sections"`
}

// SectionPolicy is one subject's tables and topology assignments.
type SectionPolicy struct {
	Tables map[string]*PolicyTable `json:"tables"`
	Assign map[string][]string     `json:"assign"`
}

// PolicyTable is a matrix (full topologies) or a module2 table (standalone).
// Nil entries are only legal in drafts; Validate reports them as errors.
type PolicyTable struct {
	Kind          string       `json:"kind"`
	M1Operational int          `json:"m1Operational,omitempty"`
	M2Operational int          `json:"m2Operational,omitempty"`
	Operational   int          `json:"operational,omitempty"`
	Cells         [][]*int     `json:"cells,omitempty"`
	Scores        []*ScoreCell `json:"scores,omitempty"`
}

// ScoreCell is one 1D entry: an integer point or a {low, high} range.
type ScoreCell Score

// UnmarshalJSON accepts an integer or {"low","high"}.
func (s *ScoreCell) UnmarshalJSON(b []byte) error {
	var point int
	if err := json.Unmarshal(b, &point); err == nil {
		*s = ScoreCell{Low: point, High: point}
		return nil
	}
	var r struct {
		Low  *int `json:"low"`
		High *int `json:"high"`
	}
	dec := json.NewDecoder(bytes.NewReader(b))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&r); err != nil || r.Low == nil || r.High == nil {
		return fmt.Errorf(`expected an integer or {"low", "high"}`)
	}
	*s = ScoreCell{Low: *r.Low, High: *r.High}
	return nil
}

// MarshalJSON emits an integer for a point and an object for a range.
func (s ScoreCell) MarshalJSON() ([]byte, error) {
	if s.Low == s.High {
		return json.Marshal(s.Low)
	}
	return json.Marshal(struct {
		Low  int `json:"low"`
		High int `json:"high"`
	}{s.Low, s.High})
}

// Issue is one validation finding addressed to a cell or table.
type Issue struct {
	Code    string `json:"code"`
	Path    string `json:"path"`
	Message string `json:"message"`
	Section string `json:"section,omitempty"`
	TableID string `json:"tableId,omitempty"`
	Row     *int   `json:"row,omitempty"`
	Col     *int   `json:"col,omitempty"`
}

var allTopologies = []Topology{FullLower, FullHigher, M2LowerOnly, M2HigherOnly}

func knownTopology(t Topology) bool {
	for _, k := range allTopologies {
		if t == k {
			return true
		}
	}
	return false
}

func (t Topology) standalone() bool { return t == M2LowerOnly || t == M2HigherOnly }

// EmptyContent is the skeleton a first draft starts from.
func EmptyContent() *Content {
	c := &Content{SchemaVersion: ContentSchemaVersion, Sections: map[string]*SectionPolicy{}}
	for _, s := range []string{SectionReadingWriting, SectionMath} {
		c.Sections[s] = &SectionPolicy{Tables: map[string]*PolicyTable{}, Assign: map[string][]string{}}
	}
	return c
}

// ParseContent decodes the structure of a policy. It rejects unknown fields,
// unknown sections/topologies/kinds and a wrong schemaVersion, but it does NOT
// demand completeness: incomplete drafts parse and are reported by Validate.
// Every error is a complete sentence safe to show staff.
func ParseContent(raw []byte) (*Content, error) {
	var c Content
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&c); err != nil {
		return nil, fmt.Errorf("Score conversion content is not valid: %v.", err)
	}
	if dec.More() {
		return nil, fmt.Errorf("Score conversion content has trailing data.")
	}
	if c.SchemaVersion != ContentSchemaVersion {
		return nil, fmt.Errorf("schemaVersion must be %d.", ContentSchemaVersion)
	}
	if c.Sections == nil {
		c.Sections = map[string]*SectionPolicy{}
	}
	for key, sec := range c.Sections {
		if !sectionKeys[key] {
			return nil, fmt.Errorf("Unknown section %q in score conversion content.", key)
		}
		if sec == nil {
			return nil, fmt.Errorf("Section %q must be an object.", key)
		}
		if sec.Tables == nil {
			sec.Tables = map[string]*PolicyTable{}
		}
		if sec.Assign == nil {
			sec.Assign = map[string][]string{}
		}
		for id, t := range sec.Tables {
			if t == nil {
				return nil, fmt.Errorf("Table %q in %s must be an object.", id, key)
			}
			if t.Kind != KindMatrix && t.Kind != KindModule2 {
				return nil, fmt.Errorf("Table %q in %s has unknown kind %q.", id, key, t.Kind)
			}
		}
		for topo := range sec.Assign {
			if !knownTopology(Topology(topo)) {
				return nil, fmt.Errorf("Unknown topology %q for %s.", topo, key)
			}
		}
	}
	return &c, nil
}

// Canonical returns the deterministic encoding the checksum is computed over
// (Go marshals map keys in sorted order and the structs have fixed field order).
func (c *Content) Canonical() ([]byte, error) { return json.Marshal(c) }

// Checksum is the hex sha256 of the canonical encoding.
func (c *Content) Checksum() (string, error) {
	b, err := c.Canonical()
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:]), nil
}

// SectionChecksum hashes one subject's policy so a publish can prove the other
// subject was carried over unchanged. An absent section hashes as empty.
func (c *Content) SectionChecksum(section string) (string, error) {
	sec := c.Sections[section]
	if sec == nil {
		sec = &SectionPolicy{Tables: map[string]*PolicyTable{}, Assign: map[string][]string{}}
	}
	b, err := json.Marshal(sec)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:]), nil
}

// Clone deep-copies the policy via its canonical encoding.
func (c *Content) Clone() (*Content, error) {
	b, err := c.Canonical()
	if err != nil {
		return nil, err
	}
	return ParseContent(b)
}

func sortedKeys[V any](m map[string]V) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

// Validate reports every error (blocks publish) and warning (does not) in
// deterministic order. It never modifies the policy.
func (c *Content) Validate() (errs, warns []Issue) {
	assigned := 0
	for _, section := range sortedKeys(c.Sections) {
		sec := c.Sections[section]
		base := "sections." + section
		for _, id := range sortedKeys(sec.Tables) {
			t := sec.Tables[id]
			path := base + ".tables." + id
			switch t.Kind {
			case KindMatrix:
				validateMatrix(section, id, path, t, &errs, &warns)
			case KindModule2:
				validateModule2(section, id, path, t, &errs, &warns)
			}
		}
		used := map[string]bool{}
		for _, topoKey := range sortedKeys(sec.Assign) {
			topo := Topology(topoKey)
			ids := sec.Assign[topoKey]
			path := base + ".assign." + topoKey
			if len(ids) == 0 {
				errs = append(errs, Issue{Code: "empty_assignment", Path: path, Message: fmt.Sprintf("%s %s lists no table.", section, topoKey), Section: section})
				continue
			}
			seenID := map[string]bool{}
			seenDims := map[string]string{}
			for _, id := range ids {
				if seenID[id] {
					errs = append(errs, Issue{Code: "duplicate_assignment", Path: path, Message: fmt.Sprintf("%s %s lists table %q twice.", section, topoKey, id), Section: section, TableID: id})
					continue
				}
				seenID[id] = true
				t, ok := sec.Tables[id]
				if !ok {
					errs = append(errs, Issue{Code: "unknown_table", Path: path, Message: fmt.Sprintf("%s %s references missing table %q.", section, topoKey, id), Section: section, TableID: id})
					continue
				}
				used[id] = true
				want := KindMatrix
				if topo.standalone() {
					want = KindModule2
				}
				if t.Kind != want {
					errs = append(errs, Issue{Code: "kind_mismatch", Path: path, Message: fmt.Sprintf("%s %s needs a %s table; %q is a %s table.", section, topoKey, want, id, t.Kind), Section: section, TableID: id})
					continue
				}
				dims := fmt.Sprintf("%d/%d/%d", t.M1Operational, t.M2Operational, t.Operational)
				if other, dup := seenDims[dims]; dup {
					errs = append(errs, Issue{Code: "duplicate_profile", Path: path, Message: fmt.Sprintf("%s %s lists tables %q and %q with the same dimensions; the lookup would be ambiguous.", section, topoKey, other, id), Section: section, TableID: id})
				}
				seenDims[dims] = id
				assigned++
			}
		}
		for _, id := range sortedKeys(sec.Tables) {
			if !used[id] {
				warns = append(warns, Issue{Code: "unassigned_table", Path: base + ".tables." + id, Message: fmt.Sprintf("Table %q is not assigned to any route and is never used.", id), Section: section, TableID: id})
			}
		}
	}
	if assigned == 0 {
		errs = append(errs, Issue{Code: "empty_policy", Path: "sections", Message: "Assign at least one conversion table before publishing."})
	}
	return errs, warns
}

func validateMatrix(section, id, path string, t *PolicyTable, errs, warns *[]Issue) {
	if t.M1Operational < 1 || t.M1Operational > MaxMatrixOperational || t.M2Operational < 1 || t.M2Operational > MaxMatrixOperational {
		*errs = append(*errs, Issue{Code: "invalid_dimensions", Path: path, Message: fmt.Sprintf("Table %q needs m1Operational and m2Operational between 1 and %d.", id, MaxMatrixOperational), Section: section, TableID: id})
		return
	}
	if t.Operational != 0 || len(t.Scores) != 0 {
		*errs = append(*errs, Issue{Code: "invalid_shape", Path: path, Message: fmt.Sprintf("Matrix table %q must not carry 1D fields.", id), Section: section, TableID: id})
	}
	rows, cols := t.M1Operational+1, t.M2Operational+1
	if len(t.Cells) != rows {
		*errs = append(*errs, Issue{Code: "incomplete", Path: path + ".cells", Message: fmt.Sprintf("Table %q must have %d rows (Module 1 correct 0 to %d); it has %d.", id, rows, t.M1Operational, len(t.Cells)), Section: section, TableID: id})
		return
	}
	for r, row := range t.Cells {
		if len(row) != cols {
			*errs = append(*errs, Issue{Code: "incomplete", Path: fmt.Sprintf("%s.cells[%d]", path, r), Message: fmt.Sprintf("Table %q row %d must have %d cells (Module 2 correct 0 to %d); it has %d.", id, r, cols, t.M2Operational, len(row)), Section: section, TableID: id, Row: new(r)})
			continue
		}
		for col, cell := range row {
			cellPath := fmt.Sprintf("%s.cells[%d][%d]", path, r, col)
			if cell == nil {
				*errs = append(*errs, Issue{Code: "incomplete", Path: cellPath, Message: fmt.Sprintf("Module 1 correct %d, Module 2 correct %d has no score.", r, col), Section: section, TableID: id, Row: new(r), Col: new(col)})
				continue
			}
			if _, err := checkScore(Score{*cell, *cell}); err != nil {
				*errs = append(*errs, Issue{Code: "invalid_score", Path: cellPath, Message: fmt.Sprintf("Module 1 correct %d, Module 2 correct %d: %v", r, col, err), Section: section, TableID: id, Row: new(r), Col: new(col)})
			}
		}
	}
	// Non-monotonic cells are review warnings, never an error and never fixed.
	for r := range rows {
		if len(t.Cells[r]) != cols {
			continue
		}
		for col := range cols {
			cur := t.Cells[r][col]
			if cur == nil {
				continue
			}
			var left, up *int
			if col > 0 {
				left = t.Cells[r][col-1]
			}
			if r > 0 && len(t.Cells[r-1]) == cols {
				up = t.Cells[r-1][col]
			}
			switch {
			case left != nil && *cur < *left:
				*warns = append(*warns, Issue{Code: "non_monotonic", Path: fmt.Sprintf("%s.cells[%d][%d]", path, r, col), Message: fmt.Sprintf("Module 1 correct %d, Module 2 correct %d (%d) is lower than the previous Module 2 value (%d).", r, col, *cur, *left), Section: section, TableID: id, Row: new(r), Col: new(col)})
			case up != nil && *cur < *up:
				*warns = append(*warns, Issue{Code: "non_monotonic", Path: fmt.Sprintf("%s.cells[%d][%d]", path, r, col), Message: fmt.Sprintf("Module 1 correct %d, Module 2 correct %d (%d) is lower than the previous Module 1 value (%d).", r, col, *cur, *up), Section: section, TableID: id, Row: new(r), Col: new(col)})
			}
		}
	}
}

func validateModule2(section, id, path string, t *PolicyTable, errs, warns *[]Issue) {
	if t.Operational < 1 || t.Operational > MaxModule2Operational {
		*errs = append(*errs, Issue{Code: "invalid_dimensions", Path: path, Message: fmt.Sprintf("Table %q needs operational between 1 and %d.", id, MaxModule2Operational), Section: section, TableID: id})
		return
	}
	if t.M1Operational != 0 || t.M2Operational != 0 || len(t.Cells) != 0 {
		*errs = append(*errs, Issue{Code: "invalid_shape", Path: path, Message: fmt.Sprintf("Module 2 table %q must not carry matrix fields.", id), Section: section, TableID: id})
	}
	if len(t.Scores) != t.Operational+1 {
		*errs = append(*errs, Issue{Code: "incomplete", Path: path + ".scores", Message: fmt.Sprintf("Table %q must map raw scores 0 to %d; it has %d entries.", id, t.Operational, len(t.Scores)), Section: section, TableID: id})
		return
	}
	var prev *ScoreCell
	for raw, s := range t.Scores {
		entry := fmt.Sprintf("%s.scores[%d]", path, raw)
		if s == nil {
			*errs = append(*errs, Issue{Code: "incomplete", Path: entry, Message: fmt.Sprintf("Raw score %d has no score.", raw), Section: section, TableID: id, Row: new(raw)})
			prev = nil
			continue
		}
		if _, err := checkScore(Score(*s)); err != nil {
			*errs = append(*errs, Issue{Code: "invalid_score", Path: entry, Message: fmt.Sprintf("Raw score %d: %v", raw, err), Section: section, TableID: id, Row: new(raw)})
		} else if prev != nil && s.Low < prev.Low {
			*warns = append(*warns, Issue{Code: "non_monotonic", Path: entry, Message: fmt.Sprintf("Raw score %d (%d) is lower than raw score %d (%d).", raw, s.Low, raw-1, prev.Low), Section: section, TableID: id, Row: new(raw)})
		}
		prev = s
	}
}

// Resolve returns the score for one section/topology and module raw scores.
// Full topologies read the matrix cell [m1Raw][m2Raw]; standalone Module 2
// topologies read the 1D table at m2Raw and ignore the m1 arguments. The
// table must declare exactly the attempt's operational counts and the entry
// must be present and valid, otherwise ok is false.
func (c *Content) Resolve(section string, topo Topology, m1Raw, m1Ops, m2Raw, m2Ops int) (Score, bool) {
	if c == nil {
		return Score{}, false
	}
	sec := c.Sections[section]
	if sec == nil || !knownTopology(topo) {
		return Score{}, false
	}
	for _, id := range sec.Assign[string(topo)] {
		t := sec.Tables[id]
		if t == nil {
			continue
		}
		if topo.standalone() {
			if t.Kind != KindModule2 || t.Operational != m2Ops || m2Raw < 0 || m2Raw > m2Ops || len(t.Scores) != m2Ops+1 {
				continue
			}
			if s := t.Scores[m2Raw]; s != nil {
				if v, err := checkScore(Score(*s)); err == nil {
					return v, true
				}
			}
			return Score{}, false
		}
		if t.Kind != KindMatrix || t.M1Operational != m1Ops || t.M2Operational != m2Ops {
			continue
		}
		if m1Raw < 0 || m1Raw > m1Ops || m2Raw < 0 || m2Raw > m2Ops || len(t.Cells) != m1Ops+1 || len(t.Cells[m1Raw]) != m2Ops+1 {
			return Score{}, false
		}
		if cell := t.Cells[m1Raw][m2Raw]; cell != nil {
			if v, err := checkScore(Score{*cell, *cell}); err == nil {
				return v, true
			}
		}
		return Score{}, false
	}
	return Score{}, false
}

// PublishIssues is Validate plus the publish-only rule that a calibration
// source must be recorded.
func (c *Content) PublishIssues(calibrationSource string) (errs, warns []Issue) {
	errs, warns = c.Validate()
	if strings.TrimSpace(calibrationSource) == "" {
		errs = append(errs, Issue{Code: "calibration_source_required", Path: "calibrationSource", Message: "calibrationSource is required to publish."})
	}
	return errs, warns
}
