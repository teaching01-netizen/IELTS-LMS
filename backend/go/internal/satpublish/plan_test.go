package satpublish

import (
	"context"
	"encoding/json"
	"strconv"
	"strings"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

func TestParsePlan(t *testing.T) {
	for _, raw := range []string{"", "null", "{}"} {
		if p, err := ParsePlan(raw); err != nil || p != nil {
			t.Fatalf("ParsePlan(%q) = %v, %v; want nil plan", raw, p, err)
		}
	}
	p, err := ParsePlan(`{"math":"m2_hard"}`)
	if err != nil || p.ShapeFor(SectionMath) != ShapeM2Hard {
		t.Fatalf("got %v, %v", p, err)
	}
	for _, bad := range []string{`{"math":"m3"}`, `{"writing":"m1_easy"}`, `[`} {
		if _, err := ParsePlan(bad); err == nil {
			t.Fatalf("ParsePlan(%q) must fail", bad)
		}
	}
}

func TestPlanUsesAndEntryRole(t *testing.T) {
	cases := []struct {
		shape Shape
		entry string
		uses  map[string]bool
	}{
		{"", RoleBase, map[string]bool{RoleBase: true, RoleLower: true, RoleHigher: true}},
		{ShapeM1Easy, RoleBase, map[string]bool{RoleBase: true, RoleLower: true}},
		{ShapeM1Hard, RoleBase, map[string]bool{RoleBase: true, RoleHigher: true}},
		{ShapeM2Easy, RoleLower, map[string]bool{RoleLower: true}},
		{ShapeM2Hard, RoleHigher, map[string]bool{RoleHigher: true}},
	}
	for _, tc := range cases {
		p := Plan{SectionMath: tc.shape}
		if tc.shape.EntryRole() != tc.entry {
			t.Errorf("%q entry = %q, want %q", tc.shape, tc.shape.EntryRole(), tc.entry)
		}
		for _, role := range allRoles {
			if p.Uses(SectionMath, role) != tc.uses[role] {
				t.Errorf("%q uses(%s) = %v", tc.shape, role, !tc.uses[role])
			}
		}
	}
}

func TestValidateDraftPlanOnlyRequiresDeliveredModules(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectQuery("sat_classroom_plan").WithArgs("draft").
		WillReturnRows(sqlmock.NewRows([]string{"plan"}).AddRow(`{"math":"m2_hard"}`))
	// Only the hard module is authored; M1 and Easy are absent and not required.
	mock.ExpectQuery("SELECT s.section_key, m.module_key").WithArgs("draft", SectionMath).
		WillReturnRows(sqlmock.NewRows([]string{"section_key", "module_key", "title", "target", "id"}).
			AddRow(SectionMath, "math-m2-higher", "Hard", 0, "mh").
			AddRow(SectionMath, "math-m1", "M1 draft", 5, "m1"))
	mock.ExpectQuery("SELECT eq.id, r.question_type").WithArgs("mh").
		WillReturnRows(sqlmock.NewRows([]string{"id", "type", "prompt", "answer", "is_pretest"}))
	mock.ExpectQuery("assessment_scoring_policies").WithArgs("draft").WillReturnRows(sqlmock.NewRows([]string{"p"}))
	issues, err := ValidateDraftForScope(context.Background(), db, "draft", ScopeMath)
	if err != nil {
		t.Fatal(err)
	}
	for _, is := range issues {
		if is.Code == "sat.module.missing" || is.Path == "math.math-m1" {
			t.Fatalf("unused module gated publish: %+v", is)
		}
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func converterJSON(t *testing.T, sections map[string]map[string]string, ops map[string]int) string {
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

// converterGate validates a Math draft under the plan with one operational
// question per module (plus the two pretests) and the given scoring policy.
func converterGate(t *testing.T, plan, policy string) []Issue {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectQuery("sat_classroom_plan").WithArgs("draft").WillReturnRows(sqlmock.NewRows([]string{"plan"}).AddRow(plan))
	mods := sqlmock.NewRows([]string{"section_key", "module_key", "title", "target", "id"})
	for _, key := range []string{"math-m1", "math-m2-lower", "math-m2-higher"} {
		mods.AddRow(SectionMath, key, key, 3, key)
	}
	mock.ExpectQuery("SELECT s.section_key, m.module_key").WithArgs("draft", SectionMath).WillReturnRows(mods)
	used := Plan{SectionMath: Shape(strings.Trim(strings.TrimPrefix(plan, `{"math":`), `"}`))}
	if plan == "" {
		used = nil
	}
	for _, key := range []string{"math-m1", "math-m2-lower", "math-m2-higher"} {
		if !used.Uses(SectionMath, RoleOfModuleKey(key)) {
			continue
		}
		mock.ExpectQuery("SELECT eq.id, r.question_type").WithArgs(key).
			WillReturnRows(sqlmock.NewRows([]string{"id", "type", "prompt", "answer", "is_pretest"}).
				AddRow(key+"-q", "single_choice", content("Prompt"), choiceAnswer("A", "A", "B", "C", "D"), false).
				AddRow(key+"-p1", "single_choice", content("Prompt"), choiceAnswer("A", "A", "B", "C", "D"), true).
				AddRow(key+"-p2", "single_choice", content("Prompt"), choiceAnswer("A", "A", "B", "C", "D"), true))
	}
	policyRows := sqlmock.NewRows([]string{"p"})
	if policy != "" {
		policyRows.AddRow(policy)
	}
	mock.ExpectQuery("assessment_scoring_policies").WithArgs("draft").WillReturnRows(policyRows)
	issues, err := ValidateDraftForScope(context.Background(), db, "draft", ScopeMath)
	if err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
	return issues
}

func converterCodes(issues []Issue) []string {
	var out []string
	for _, is := range issues {
		if strings.HasPrefix(is.Code, "sat.converter.") {
			out = append(out, is.Code+": "+is.Message)
		}
	}
	return out
}

// §2 release-time rule (SC-05 publish side): a declared converter must cover
// every route the plan can deliver, for the exact operational count.
func TestConverterGate(t *testing.T) {
	full := map[string]map[string]string{"math": {"full_lower": "l", "full_higher": "h"}}
	cases := []struct {
		name, plan, policy string
		blocked            int
	}{
		{"no policy row publishes raw-only", "", "", 0},
		{"legacy linear policy is ignored", "", `{"math":{"lower":{"0":200}}}`, 0},
		{"full plan, both full tables", "", converterJSON(t, full, map[string]int{"l": 2, "h": 2}), 0},
		{"full plan, higher table missing", "", converterJSON(t, map[string]map[string]string{"math": {"full_lower": "l"}}, map[string]int{"l": 2}), 1},
		{"full plan, wrong operational count", "", converterJSON(t, full, map[string]int{"l": 2, "h": 3}), 1},
		{"forced easy needs only full_lower", `{"math":"m1_easy"}`, converterJSON(t, map[string]map[string]string{"math": {"full_lower": "l"}}, map[string]int{"l": 2}), 0},
		{"forced hard rejects a lower-only converter", `{"math":"m1_hard"}`, converterJSON(t, map[string]map[string]string{"math": {"full_lower": "l"}}, map[string]int{"l": 2}), 1},
		{"standalone never accepts a full table (SC-04)", `{"math":"m2_hard"}`, converterJSON(t, full, map[string]int{"l": 1, "h": 1}), 1},
		{"standalone with its own table", `{"math":"m2_hard"}`, converterJSON(t, map[string]map[string]string{"math": {"m2_higher_only": "s"}}, map[string]int{"s": 1}), 0},
		{"corrupt converter", "", `{"converterVersion":"v","scoreType":"estimated_sat"}`, 1},
	}
	for _, tc := range cases {
		got := converterCodes(converterGate(t, tc.plan, tc.policy))
		if len(got) != tc.blocked {
			t.Errorf("%s: converter issues = %v; want %d", tc.name, got, tc.blocked)
		}
	}
}
