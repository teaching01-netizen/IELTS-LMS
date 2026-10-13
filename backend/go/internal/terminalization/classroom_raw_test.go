package terminalization

import (
	"context"
	"encoding/json"
	"regexp"
	"strconv"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/satconvert"
)

// Counterexample from verification/lean/sat-result (Report.adjacent_duplicates):
// sections tied on display_order interleave their module rows, and adjacency
// grouping reported each section twice.
func TestClassroomRawScoreGroupsInterleavedSectionsOnce(t *testing.T) {
	db, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherRegexp))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectQuery(regexp.QuoteMeta("sat_score_report_enabled")).
		WithArgs("attempt-1").
		WillReturnRows(sqlmock.NewRows([]string{"enabled"}).AddRow(true))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_module_attempts ma")).
		WithArgs("attempt-1").
		WillReturnRows(sqlmock.NewRows([]string{"section_key", "module_key", "raw", "op", "unscored"}).
			AddRow("reading-writing", "rw-m1", int64(10), int64(27), false).
			AddRow("math", "math-m1", int64(8), int64(22), false).
			AddRow("reading-writing", "rw-m2", int64(12), int64(27), false).
			AddRow("math", "math-m2", int64(9), int64(22), false))
	expectNoConverter(mock, "attempt-1")

	raw, err := classroomRawScoreTx(context.Background(), db, "attempt-1")
	if err != nil {
		t.Fatal(err)
	}
	sections := raw["sections"].([]map[string]any)
	if len(sections) != 2 {
		t.Fatalf("want one entry per section, got %d: %+v", len(sections), sections)
	}
	for _, want := range []struct {
		key          string
		correct, all int64
	}{{"reading-writing", 22, 54}, {"math", 17, 44}} {
		var got map[string]any
		for _, s := range sections {
			if s["sectionKey"] == want.key {
				got = s
			}
		}
		if got == nil || got["rawCorrect"] != want.correct || got["total"] != want.all || len(got["modules"].([]map[string]any)) != 2 {
			t.Fatalf("section %s = %+v", want.key, got)
		}
	}
	if raw["rawCorrect"] != int64(39) || raw["total"] != int64(98) {
		t.Fatalf("totals = %v / %v", raw["rawCorrect"], raw["total"])
	}
}

func linearConverter(t *testing.T, sections map[string]map[string]string, ops map[string]int) string {
	t.Helper()
	tables := map[string]any{}
	for id, n := range ops {
		scores := map[string]int{}
		for r := 0; r <= n; r++ {
			scores[strconv.Itoa(r)] = min(200+10*r, 800)
		}
		tables[id] = map[string]any{"operationalQuestions": n, "scores": scores}
	}
	raw, err := json.Marshal(map[string]any{"converterVersion": "classroom-v1", "scoreType": "estimated_sat", "calibrationSource": "staff_approved", "sections": sections, "tables": tables})
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

type modRow struct {
	section, key string
	raw, op      int64
}

// convertedReport runs classroomRawScoreTx over administered module rows with
// the given stored scoring policy ("" = no policy row).
func convertedReport(t *testing.T, policy string, mods ...modRow) map[string]any {
	t.Helper()
	db, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherRegexp))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectQuery(regexp.QuoteMeta("sat_score_report_enabled")).WithArgs("a").
		WillReturnRows(sqlmock.NewRows([]string{"enabled"}).AddRow(true))
	rows := sqlmock.NewRows([]string{"section_key", "module_key", "raw", "op", "unscored"})
	for _, m := range mods {
		rows.AddRow(m.section, m.key, m.raw, m.op, false)
	}
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_module_attempts ma")).WithArgs("a").WillReturnRows(rows)
	if policy == "" {
		expectNoConverter(mock, "a")
	} else {
		mock.ExpectQuery(regexp.QuoteMeta("assessment_scoring_policies")).WithArgs("a").
			WillReturnRows(sqlmock.NewRows([]string{"p"}).AddRow(policy))
	}
	out, err := classroomRawScoreTx(context.Background(), db, "a")
	if err != nil || out == nil {
		t.Fatalf("report = %v, %v", out, err)
	}
	return out
}

func sectionOf(t *testing.T, out map[string]any, key string) map[string]any {
	t.Helper()
	for _, s := range out["sections"].([]map[string]any) {
		if s["sectionKey"] == key {
			if _, leaked := s["roles"]; leaked {
				t.Fatalf("internal roles leaked into %s", key)
			}
			return s
		}
	}
	t.Fatalf("no section %s", key)
	return nil
}

var fullTables = map[string]map[string]string{
	"reading-writing": {"full_lower": "rwl", "full_higher": "rwh"},
	"math":            {"full_lower": "ml", "full_higher": "mh"},
}

// SC-01: a full adaptive sitting gets two converted sections and a total.
func TestConvertedFullExam(t *testing.T) {
	out := convertedReport(t, linearConverter(t, fullTables, map[string]int{"rwl": 50, "rwh": 50, "ml": 40, "mh": 40}),
		modRow{"reading-writing", "rw-m1", 20, 25}, modRow{"reading-writing", "rw-m2-higher", 20, 25},
		modRow{"math", "math-m1", 10, 20}, modRow{"math", "math-m2-lower", 5, 20})
	rw, math := sectionOf(t, out, "reading-writing"), sectionOf(t, out, "math")
	if rw["topology"] != "full_higher" || rw["scaled"] != (satconvert.Score{Low: 600, High: 600}) || rw["conversionStatus"] != "converted" {
		t.Fatalf("rw = %+v", rw)
	}
	if math["topology"] != "full_lower" || math["scaled"] != (satconvert.Score{Low: 350, High: 350}) {
		t.Fatalf("math = %+v", math)
	}
	if out["totalScaled"] != (satconvert.Score{Low: 950, High: 950}) {
		t.Fatalf("total = %+v", out["totalScaled"])
	}
	if conv, _ := out["conversion"].(map[string]any); conv["converterVersion"] != "classroom-v1" {
		t.Fatalf("conversion = %+v", out["conversion"])
	}
}

// SC-02: a Math-only sitting gets the Math score and no total.
func TestConvertedMathOnlyHasNoTotal(t *testing.T) {
	out := convertedReport(t, linearConverter(t, fullTables, map[string]int{"rwl": 50, "rwh": 50, "ml": 40, "mh": 40}),
		modRow{"math", "math-m1", 10, 20}, modRow{"math", "math-m2-higher", 10, 20})
	if sectionOf(t, out, "math")["scaled"] != (satconvert.Score{Low: 400, High: 400}) {
		t.Fatalf("math = %+v", out)
	}
	if _, ok := out["totalScaled"]; ok {
		t.Fatal("single-section sitting got a total")
	}
}

// SC-04: a standalone M2 with only full tables is unavailable, never the full
// table's number; with its own table it converts but never yields a total.
func TestStandaloneNeedsItsOwnTable(t *testing.T) {
	mods := []modRow{{"reading-writing", "rw-m2-lower", 10, 25}, {"math", "math-m2-higher", 10, 20}}
	out := convertedReport(t, linearConverter(t, fullTables, map[string]int{"rwl": 25, "rwh": 25, "ml": 20, "mh": 20}), mods...)
	for _, key := range []string{"reading-writing", "math"} {
		s := sectionOf(t, out, key)
		if s["conversionStatus"] != "unavailable" || s["scaled"] != nil {
			t.Fatalf("%s borrowed a full table: %+v", key, s)
		}
	}
	own := map[string]map[string]string{"reading-writing": {"m2_lower_only": "rs"}, "math": {"m2_higher_only": "ms"}}
	out = convertedReport(t, linearConverter(t, own, map[string]int{"rs": 25, "ms": 20}), mods...)
	if sectionOf(t, out, "math")["scaled"] != (satconvert.Score{Low: 300, High: 300}) || sectionOf(t, out, "math")["topology"] != "m2_higher_only" {
		t.Fatalf("standalone math = %+v", sectionOf(t, out, "math"))
	}
	if _, ok := out["totalScaled"]; ok {
		t.Fatal("standalone sitting got an invented total")
	}
}

// SC-05: a table for another operational count, or a corrupt converter, marks
// the section unavailable; the raw report is still released.
func TestConversionUnavailableFailsClosed(t *testing.T) {
	mods := []modRow{{"math", "math-m1", 10, 20}, {"math", "math-m2-lower", 10, 20}}
	out := convertedReport(t, linearConverter(t, fullTables, map[string]int{"rwl": 50, "rwh": 50, "ml": 41, "mh": 40}), mods...)
	if s := sectionOf(t, out, "math"); s["conversionStatus"] != "unavailable" || s["scaled"] != nil || s["rawCorrect"] != int64(20) {
		t.Fatalf("count mismatch converted: %+v", s)
	}
	out = convertedReport(t, `{"converterVersion":"v","scoreType":"estimated_sat"}`, mods...)
	if s := sectionOf(t, out, "math"); s["conversionStatus"] != "unavailable" || out["conversion"] != nil {
		t.Fatalf("corrupt converter: %+v", out)
	}
	// Legacy linear practice table: no conversion fields at all.
	out = convertedReport(t, `{"math":{"lower":{"0":200}}}`, mods...)
	if s := sectionOf(t, out, "math"); s["conversionStatus"] != nil || out["conversion"] != nil {
		t.Fatalf("legacy policy converted: %+v", out)
	}
}
