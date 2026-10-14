package satconvert

import (
	"strings"
	"testing"
)

// matrixContent builds a policy with one matrix per full topology. The cell
// value is 200 + 10*(m1+m2), clamped to 800, so it is monotonic by default.
func matrixContent(m1, m2 int) *Content {
	cells := make([][]*int, m1+1)
	for r := range cells {
		cells[r] = make([]*int, m2+1)
		for c := range cells[r] {
			v := min(200+10*(r+c), 800)
			cells[r][c] = &v
		}
	}
	c := EmptyContent()
	c.Sections[SectionMath].Tables["m"] = &PolicyTable{Kind: KindMatrix, M1Operational: m1, M2Operational: m2, Cells: cells}
	c.Sections[SectionMath].Assign["full_lower"] = []string{"m"}
	c.Sections[SectionMath].Assign["full_higher"] = []string{"m"} // explicit shared assignment
	return c
}

func TestContentResolveMatrixAndSharedAssignment(t *testing.T) {
	c := matrixContent(3, 4)
	for _, topo := range []Topology{FullLower, FullHigher} {
		got, ok := c.Resolve(SectionMath, topo, 2, 3, 4, 4)
		if !ok || got != (Score{Low: 260, High: 260}) {
			t.Fatalf("%s: got %+v ok=%v, want 260", topo, got, ok)
		}
	}
	// M1 and M2 are not interchangeable coordinates.
	c.Sections[SectionMath].Tables["m"].Cells[1][3] = new(500)
	if got, _ := c.Resolve(SectionMath, FullLower, 1, 3, 3, 4); got.Low != 500 {
		t.Fatalf("T[1][3] = %+v, want 500", got)
	}
	if got, _ := c.Resolve(SectionMath, FullLower, 3, 3, 1, 4); got.Low == 500 {
		t.Fatalf("T[3][1] must not read T[1][3]")
	}
}

func TestContentResolveFailsClosed(t *testing.T) {
	c := matrixContent(3, 4)
	cases := map[string]func() (Score, bool){
		"operational count mismatch (M1)": func() (Score, bool) { return c.Resolve(SectionMath, FullLower, 1, 4, 1, 4) },
		"operational count mismatch (M2)": func() (Score, bool) { return c.Resolve(SectionMath, FullLower, 1, 3, 1, 5) },
		"raw above operational":           func() (Score, bool) { return c.Resolve(SectionMath, FullLower, 4, 3, 1, 4) },
		"negative raw":                    func() (Score, bool) { return c.Resolve(SectionMath, FullLower, -1, 3, 1, 4) },
		"other subject":                   func() (Score, bool) { return c.Resolve(SectionReadingWriting, FullLower, 1, 3, 1, 4) },
		"unassigned topology":             func() (Score, bool) { return c.Resolve(SectionMath, M2LowerOnly, 0, 0, 1, 4) },
		"unknown topology":                func() (Score, bool) { return c.Resolve(SectionMath, Topology("x"), 1, 3, 1, 4) },
		"nil policy":                      func() (Score, bool) { return (*Content)(nil).Resolve(SectionMath, FullLower, 1, 3, 1, 4) },
	}
	for name, run := range cases {
		if got, ok := run(); ok || got != (Score{}) {
			t.Errorf("%s: got %+v ok=%v, want unavailable", name, got, ok)
		}
	}
	// A null cell (draft) and an invalid cell never produce a number.
	c.Sections[SectionMath].Tables["m"].Cells[1][1] = nil
	if _, ok := c.Resolve(SectionMath, FullLower, 1, 3, 1, 4); ok {
		t.Fatal("null cell converted")
	}
	c.Sections[SectionMath].Tables["m"].Cells[1][1] = new(205)
	if _, ok := c.Resolve(SectionMath, FullLower, 1, 3, 1, 4); ok {
		t.Fatal("invalid cell converted")
	}
}

func TestContentStandaloneModuleTwoUsesOwnTable(t *testing.T) {
	c := matrixContent(3, 4)
	sec := c.Sections[SectionMath]
	sec.Tables["s"] = &PolicyTable{Kind: KindModule2, Operational: 4, Scores: []*ScoreCell{{200, 200}, {300, 300}, {400, 450}, {500, 500}, {600, 600}}}
	sec.Assign["m2_lower_only"] = []string{"s"}
	if got, ok := c.Resolve(SectionMath, M2LowerOnly, 0, 0, 2, 4); !ok || got != (Score{Low: 400, High: 450}) {
		t.Fatalf("standalone = %+v ok=%v", got, ok)
	}
	// The higher standalone route has no table and must not borrow the lower one
	// or a full matrix.
	if _, ok := c.Resolve(SectionMath, M2HigherOnly, 0, 0, 2, 4); ok {
		t.Fatal("standalone higher borrowed another table")
	}
	if _, ok := c.Resolve(SectionMath, M2LowerOnly, 0, 0, 2, 5); ok {
		t.Fatal("standalone converted with a mismatched operational count")
	}
}

func TestContentProfilesPickExactDimensions(t *testing.T) {
	c := matrixContent(3, 4)
	sec := c.Sections[SectionMath]
	other := matrixContent(2, 2).Sections[SectionMath].Tables["m"]
	other.Cells[0][0] = new(800)
	sec.Tables["p"] = other
	sec.Assign["full_lower"] = []string{"m", "p"}
	if got, ok := c.Resolve(SectionMath, FullLower, 0, 2, 0, 2); !ok || got.Low != 800 {
		t.Fatalf("profile (2,2) = %+v ok=%v", got, ok)
	}
	if got, ok := c.Resolve(SectionMath, FullLower, 0, 3, 0, 4); !ok || got.Low != 200 {
		t.Fatalf("profile (3,4) = %+v ok=%v", got, ok)
	}
}

func codes(issues []Issue) string {
	var out []string
	for _, i := range issues {
		out = append(out, i.Code)
	}
	return strings.Join(out, ",")
}

func TestContentValidateErrors(t *testing.T) {
	c := matrixContent(2, 2)
	tbl := c.Sections[SectionMath].Tables["m"]
	tbl.Cells[0][1] = nil      // incomplete
	tbl.Cells[1][1] = new(205) // not a multiple of 10
	tbl.Cells[2][2] = new(810) // above 800
	tbl.Cells[1][0] = new(190) // below 200
	errs, _ := c.Validate()
	got := map[string]bool{}
	for _, e := range errs {
		if e.Row == nil || e.Col == nil {
			t.Fatalf("cell error without coordinates: %+v", e)
		}
		got[e.Path] = true
	}
	for _, p := range []string{
		"sections.math.tables.m.cells[0][1]", "sections.math.tables.m.cells[1][1]",
		"sections.math.tables.m.cells[2][2]", "sections.math.tables.m.cells[1][0]",
	} {
		if !got[p] {
			t.Errorf("missing error for %s; got %v", p, got)
		}
	}
	if len(errs) != 4 {
		t.Fatalf("errors = %d (%s), want 4", len(errs), codes(errs))
	}
}

func TestContentValidateShapeAndAssignment(t *testing.T) {
	c := matrixContent(2, 2)
	sec := c.Sections[SectionMath]
	sec.Tables["m"].Cells = sec.Tables["m"].Cells[:2] // missing a row
	sec.Assign["m2_lower_only"] = []string{"m"}       // matrix on a standalone route
	sec.Assign["m2_higher_only"] = []string{"ghost"}
	sec.Assign["full_higher"] = nil
	errs, _ := c.Validate()
	want := map[string]bool{"incomplete": true, "kind_mismatch": true, "unknown_table": true, "empty_assignment": true}
	for _, e := range errs {
		delete(want, e.Code)
	}
	if len(want) != 0 {
		t.Fatalf("missing codes %v in %s", want, codes(errs))
	}
	if errs, _ := EmptyContent().Validate(); codes(errs) != "empty_policy" {
		t.Fatalf("empty policy = %s", codes(errs))
	}
}

func TestContentValidateDuplicateProfileAndUnassigned(t *testing.T) {
	c := matrixContent(2, 2)
	sec := c.Sections[SectionMath]
	sec.Tables["dup"] = matrixContent(2, 2).Sections[SectionMath].Tables["m"]
	sec.Tables["spare"] = matrixContent(1, 1).Sections[SectionMath].Tables["m"]
	sec.Assign["full_lower"] = []string{"m", "dup"}
	errs, warns := c.Validate()
	if codes(errs) != "duplicate_profile" {
		t.Fatalf("errors = %s", codes(errs))
	}
	if codes(warns) != "unassigned_table" {
		t.Fatalf("warnings = %s", codes(warns))
	}
}

func TestContentNonMonotonicIsWarningOnly(t *testing.T) {
	c := matrixContent(2, 2)
	tbl := c.Sections[SectionMath].Tables["m"]
	tbl.Cells[1][1] = new(200) // below its left and upper neighbours (210)
	errs, warns := c.Validate()
	if len(errs) != 0 {
		t.Fatalf("score decrease must not be an error: %s", codes(errs))
	}
	if len(warns) == 0 || warns[0].Code != "non_monotonic" || warns[0].Row == nil || *warns[0].Row != 1 || *warns[0].Col != 1 {
		t.Fatalf("warnings = %+v", warns)
	}
	if got := *tbl.Cells[1][1]; got != 200 {
		t.Fatalf("validate modified a cell: %d", got)
	}
	if _, ok := c.Resolve(SectionMath, FullLower, 1, 2, 1, 2); !ok {
		t.Fatal("a non-monotonic table must still convert")
	}
}

func TestParseContentStructure(t *testing.T) {
	good := `{"schemaVersion":1,"sections":{"math":{"tables":{"s":{"kind":"module2","operational":2,"scores":[200,{"low":300,"high":310},null]}},"assign":{"m2_lower_only":["s"]}}}}`
	c, err := ParseContent([]byte(good))
	if err != nil {
		t.Fatal(err)
	}
	if c.Sections[SectionMath].Tables["s"].Scores[2] != nil {
		t.Fatal("null score must stay null in a draft")
	}
	if errs, _ := c.Validate(); codes(errs) != "incomplete" {
		t.Fatalf("draft null: %s", codes(errs))
	}
	for name, raw := range map[string]string{
		"wrong version":    `{"schemaVersion":2,"sections":{}}`,
		"unknown section":  `{"schemaVersion":1,"sections":{"science":{"tables":{},"assign":{}}}}`,
		"unknown topology": `{"schemaVersion":1,"sections":{"math":{"tables":{},"assign":{"full":["x"]}}}}`,
		"unknown kind":     `{"schemaVersion":1,"sections":{"math":{"tables":{"a":{"kind":"cube"}},"assign":{}}}}`,
		"unknown field":    `{"schemaVersion":1,"sections":{},"extra":1}`,
		"trailing data":    `{"schemaVersion":1,"sections":{}} {}`,
		"string score":     `{"schemaVersion":1,"sections":{"math":{"tables":{"a":{"kind":"module2","operational":1,"scores":["abc",200]}},"assign":{}}}}`,
	} {
		if _, err := ParseContent([]byte(raw)); err == nil {
			t.Errorf("%s: parsed", name)
		}
	}
}

func TestContentChecksumsAreStableAndSectionScoped(t *testing.T) {
	a, b := matrixContent(2, 2), matrixContent(2, 2)
	ca, _ := a.Checksum()
	cb, _ := b.Checksum()
	if ca != cb || len(ca) != 64 {
		t.Fatalf("checksum not deterministic: %s vs %s", ca, cb)
	}
	// A round trip through JSON keeps the checksum.
	raw, _ := a.Canonical()
	re, err := ParseContent(raw)
	if err != nil {
		t.Fatal(err)
	}
	if cr, _ := re.Checksum(); cr != ca {
		t.Fatalf("round trip changed checksum")
	}
	// Editing the Reading & Writing side leaves Math's section hash alone.
	mathBefore, _ := a.SectionChecksum(SectionMath)
	rwBefore, _ := a.SectionChecksum(SectionReadingWriting)
	a.Sections[SectionReadingWriting] = matrixContent(1, 1).Sections[SectionMath]
	mathAfter, _ := a.SectionChecksum(SectionMath)
	rwAfter, _ := a.SectionChecksum(SectionReadingWriting)
	if mathBefore != mathAfter || rwBefore == rwAfter {
		t.Fatal("section checksum is not scoped to its subject")
	}
}

func TestContentPublishIssuesNeedCalibrationSource(t *testing.T) {
	c := matrixContent(1, 1)
	if errs, _ := c.PublishIssues("  "); codes(errs) != "calibration_source_required" {
		t.Fatalf("errors = %s", codes(errs))
	}
	if errs, _ := c.PublishIssues("College Board practice test 4"); len(errs) != 0 {
		t.Fatalf("errors = %s", codes(errs))
	}
}

func TestContentTotalRequiresFullTopologiesOnly(t *testing.T) {
	rw, math := Score{Low: 600, High: 600}, Score{Low: 700, High: 700}
	if _, ok := Total(&rw, &math, FullLower, M2HigherOnly); ok {
		t.Fatal("a standalone module contributed to the total")
	}
	if tot, ok := Total(&rw, &math, FullLower, FullHigher); !ok || tot.Low != 1300 {
		t.Fatalf("total = %+v ok=%v", tot, ok)
	}
}

// TestContentChecksumIsPinned fixes the canonical encoding. Published revisions store the
// sha256 of this encoding and every read verifies it, so ANY change to the struct tags,
// field order or omitempty rules would make every existing revision fail its integrity
// check and withhold all converted scores. If this test fails, the change needs an
// encoding-version migration, not an updated golden value.
func TestContentChecksumIsPinned(t *testing.T) {
	c := EmptyContent()
	c.Sections[SectionReadingWriting].Tables["a"] = &PolicyTable{Kind: KindMatrix, M1Operational: 1, M2Operational: 1,
		Cells: [][]*int{{new(200), new(210)}, {new(210), new(220)}}}
	c.Sections[SectionReadingWriting].Assign["full_lower"] = []string{"a"}
	c.Sections[SectionReadingWriting].Assign["full_higher"] = []string{"a"}
	c.Sections[SectionMath].Tables["s"] = &PolicyTable{Kind: KindModule2, Operational: 2,
		Scores: []*ScoreCell{{Low: 200, High: 200}, {Low: 300, High: 320}, {Low: 400, High: 400}}}
	c.Sections[SectionMath].Assign["m2_lower_only"] = []string{"s"}
	raw, err := c.Canonical()
	if err != nil {
		t.Fatal(err)
	}
	const wantJSON = `{"schemaVersion":1,"sections":{"math":{"tables":{"s":{"kind":"module2","operational":2,"scores":[200,{"low":300,"high":320},400]}},"assign":{"m2_lower_only":["s"]}},"reading-writing":{"tables":{"a":{"kind":"matrix","m1Operational":1,"m2Operational":1,"cells":[[200,210],[210,220]]}},"assign":{"full_higher":["a"],"full_lower":["a"]}}}}`
	if string(raw) != wantJSON {
		t.Fatalf("canonical encoding changed:\n%s\nwant\n%s", raw, wantJSON)
	}
	sum, err := c.Checksum()
	if err != nil {
		t.Fatal(err)
	}
	if want := "b013527844c9df180bbed2ea604798c15791db7c999c4b43011ffbd0f803736b"; sum != want {
		t.Fatalf("checksum = %s", sum)
	}
}
