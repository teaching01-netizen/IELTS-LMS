package authoring

// Phase 02 unit tests for the pure bulk assembler.
//
// assembleShellTree is the whole semantic surface of the bulk read path: the
// four loaders only fetch rows, so ordering, grouping, empty-array-not-null,
// routing-null, tool_policy defaulting and policy_config parsing are all
// decided here. These tests pin each rule WITHOUT a database, so a regression
// is diagnosed in milliseconds instead of via a 147-question MySQL fixture.

import (
	"database/sql"
	"encoding/json"
	"strings"
	"testing"
)

// assembleFixture is one table-test input.
func assembleRows() (shellIdentity, []bulkSectionRow, []bulkModuleRow, []bulkRoutingRow, []bulkQuestionRow) {
	identity := shellIdentity{providerKey: "sat", versionID: "v-1", revision: 9}
	sections := []bulkSectionRow{
		{id: "sec-a", sectionKey: "reading-writing", title: "RW", displayOrder: 0, duration: 100, brk: 10, revision: 1},
		{id: "sec-b", sectionKey: "math", title: "Math", displayOrder: 1, duration: 200, brk: 0, revision: 2},
	}
	modules := []bulkModuleRow{
		{id: "mod-a1", sectionID: "sec-a", moduleKey: "rw-m1", title: "A1", displayOrder: 0, duration: 50, targetCount: 2, adaptiveRole: RoleBase, toolPolicy: sql.NullString{String: "[\"calculator\"]", Valid: true}, revision: 3},
		{id: "mod-a2", sectionID: "sec-a", moduleKey: "rw-m2-lower", title: "A2", displayOrder: 1, duration: 50, targetCount: 0, adaptiveRole: RoleLowerBranch, toolPolicy: sql.NullString{Valid: false}, revision: 4},
		{id: "mod-b1", sectionID: "sec-b", moduleKey: "math-m1", title: "B1", displayOrder: 0, duration: 60, targetCount: 1, adaptiveRole: RoleBase, toolPolicy: sql.NullString{String: "{}", Valid: true}, revision: 5},
	}
	routing := []bulkRoutingRow{
		{sectionID: "sec-a", id: "rp-a", baseModuleID: "mod-a1", lowerModuleID: "mod-a2", higherModuleID: "mod-a2", policyKey: "practice_threshold", policyConfig: sql.NullString{String: `{"minimumCorrectForHigher":13,"operationalQuestionCount":25}`, Valid: true}, revision: 6},
	}
	questions := []bulkQuestionRow{
		{moduleID: "mod-a1", examQuestionID: "eq-1", questionID: "q-1", revisionID: "rev-1", sectionKey: "reading-writing", displayOrder: 0},
		{moduleID: "mod-a1", examQuestionID: "eq-2", questionID: "q-2", revisionID: "rev-2", sectionKey: "reading-writing", displayOrder: 1},
		{moduleID: "mod-b1", examQuestionID: "eq-3", questionID: "q-3", revisionID: "rev-3", sectionKey: "math", displayOrder: 0},
	}
	return identity, sections, modules, routing, questions
}

// TestAssembleShellTreeHeader pins the header projection: the assembler must
// carry the identity through unchanged, including the revision the caller
// observed inside the snapshot.
func TestAssembleShellTreeHeader(t *testing.T) {
	identity, sections, modules, routing, questions := assembleRows()
	shell := assembleShellTree(identity, sections, modules, routing, questions, "exam-9")
	if shell.ExamID != "exam-9" || shell.ProviderKey != "sat" || shell.VersionID != "v-1" || shell.VersionRevision != 9 {
		t.Fatalf("header drifted: %+v", shell)
	}
}

// TestAssembleShellTreeOrdering pins that the assembler preserves the input
// order of every level. The loaders order by display_order; the assembler must
// not re-sort, because re-sorting would silently diverge from the nested
// loaders' SQL ordering (and would hide a loader that stopped ordering).
func TestAssembleShellTreeOrdering(t *testing.T) {
	identity, sections, modules, routing, questions := assembleRows()
	shell := assembleShellTree(identity, sections, modules, routing, questions, "exam-9")

	if len(shell.Sections) != 2 || shell.Sections[0].ID != "sec-a" || shell.Sections[1].ID != "sec-b" {
		t.Fatalf("section order drifted: %+v", shell.Sections)
	}
	if len(shell.Sections[0].Modules) != 2 ||
		shell.Sections[0].Modules[0].ID != "mod-a1" ||
		shell.Sections[0].Modules[1].ID != "mod-a2" {
		t.Fatalf("module order drifted: %+v", shell.Sections[0].Modules)
	}
	questionsA1 := shell.Sections[0].Modules[0].Questions
	if len(questionsA1) != 2 || questionsA1[0].ExamQuestionID != "eq-1" || questionsA1[1].ExamQuestionID != "eq-2" {
		t.Fatalf("question order drifted: %+v", questionsA1)
	}

	// Reverse the question input: the projection must follow the input order,
	// proving the assembler is a pure grouping function and not a sorter.
	reversed := []bulkQuestionRow{questions[1], questions[0], questions[2]}
	shell = assembleShellTree(identity, sections, modules, routing, reversed, "exam-9")
	questionsA1 = shell.Sections[0].Modules[0].Questions
	if questionsA1[0].ExamQuestionID != "eq-2" || questionsA1[1].ExamQuestionID != "eq-1" {
		t.Fatalf("assembler re-sorted questions instead of preserving input order: %+v", questionsA1)
	}
}

// TestAssembleShellTreeGrouping pins that questions land in the module they
// belong to and nowhere else — including that a module in another section is
// never cross-contaminated.
func TestAssembleShellTreeGrouping(t *testing.T) {
	identity, sections, modules, routing, questions := assembleRows()
	shell := assembleShellTree(identity, sections, modules, routing, questions, "exam-9")

	if got := len(shell.Sections[0].Modules[0].Questions); got != 2 {
		t.Fatalf("mod-a1 questions = %d, want 2", got)
	}
	if got := len(shell.Sections[0].Modules[1].Questions); got != 0 {
		t.Fatalf("mod-a2 questions = %d, want 0", got)
	}
	if got := len(shell.Sections[1].Modules[0].Questions); got != 1 {
		t.Fatalf("mod-b1 questions = %d, want 1", got)
	}
	if shell.Sections[1].Modules[0].Questions[0].ExamQuestionID != "eq-3" {
		t.Fatalf("mod-b1 got the wrong question: %+v", shell.Sections[1].Modules[0].Questions)
	}
}

// TestAssembleShellTreeEmptyArraysNotNil pins the wire contract: every empty
// collection serializes as [] and never as null. A nil slice would emit
// "null" and break the frontend + contracts_mysql_test.go.
func TestAssembleShellTreeEmptyArraysNotNil(t *testing.T) {
	identity, _, _, _, _ := assembleRows()

	// Empty version: no sections at all.
	shell := assembleShellTree(identity, nil, nil, nil, nil, "exam-9")
	if shell.Sections == nil {
		t.Fatal("empty version must produce a non-nil sections slice")
	}
	payload, err := json.Marshal(shell)
	if err != nil {
		t.Fatal(err)
	}
	if string(payload) != `{"examId":"exam-9","providerKey":"sat","versionId":"v-1","versionRevision":9,"sections":[]}` {
		t.Fatalf("empty-version payload drifted: %s", payload)
	}

	// A section with no modules, and a module with no questions.
	shell = assembleShellTree(identity,
		[]bulkSectionRow{{id: "sec-empty", sectionKey: "math", title: "Empty", displayOrder: 0}},
		[]bulkModuleRow{{id: "mod-empty", sectionID: "sec-empty", moduleKey: "math-m1", title: "M", displayOrder: 0}},
		nil, nil, "exam-9")
	if shell.Sections[0].Modules == nil {
		t.Fatal("a section with no modules must produce a non-nil slice")
	}
	if shell.Sections[0].Modules[0].Questions == nil {
		t.Fatal("a module with no questions must produce a non-nil slice")
	}
	payload, err = json.Marshal(shell)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(payload), `"modules":[`) || !strings.Contains(string(payload), `"questions":[]`) {
		t.Fatalf("empty collections must serialize as []: %s", payload)
	}
}

// TestAssembleShellTreeMissingRoutingIsNil pins the loadRouting parity: a
// section with no routing row projects routingPolicy:null (NOT an empty
// object), and a section WITH a row gets the parsed projection.
func TestAssembleShellTreeMissingRoutingIsNil(t *testing.T) {
	identity, sections, modules, routing, questions := assembleRows()
	shell := assembleShellTree(identity, sections, modules, routing, questions, "exam-9")

	if shell.Sections[0].RoutingPolicy == nil {
		t.Fatal("sec-a has a routing row and must project a policy")
	}
	if shell.Sections[1].RoutingPolicy != nil {
		t.Fatalf("sec-b has no routing row and must project nil, got %+v", shell.Sections[1].RoutingPolicy)
	}
	payload, err := json.Marshal(shell.Sections[1])
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(payload), `"routingPolicy":null`) {
		t.Fatalf("missing routing must serialize as null: %s", payload)
	}
}

// TestAssembleShellTreePolicyConfigParsing pins the threshold parse rules
// (float64, truncated to int; absent/unparseable stays 0) and the derived
// operational count: policy_config is threshold-only on real rows, so
// OperationalCount comes from the SAT blueprint for the section's base
// module (math/math-m1 -> 20), never from a stored operationalQuestionCount
// key (a stale stored value must not win).
func TestAssembleShellTreePolicyConfigParsing(t *testing.T) {
	cases := []struct {
		name          string
		config        sql.NullString
		wantThreshold int
	}{
		{"threshold only (real shape)", sql.NullString{String: `{"minimumCorrectForHigher":7}`, Valid: true}, 7},
		{"stale stored count ignored", sql.NullString{String: `{"minimumCorrectForHigher":13,"operationalQuestionCount":25}`, Valid: true}, 13},
		{"no keys", sql.NullString{String: `{"unrelated":true}`, Valid: true}, 0},
		{"invalid json", sql.NullString{String: `not json at all`, Valid: true}, 0},
		{"null column", sql.NullString{Valid: false}, 0},
		{"fractional truncates", sql.NullString{String: `{"minimumCorrectForHigher":13.9}`, Valid: true}, 13},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			identity := shellIdentity{providerKey: "sat", versionID: "v-1"}
			sections := []bulkSectionRow{{id: "sec-a", sectionKey: "math"}}
			modules := []bulkModuleRow{{
				id: "mod-a1", sectionID: "sec-a", moduleKey: "math-m1",
				title: "M1", displayOrder: 0, targetCount: 22, adaptiveRole: RoleBase,
			}}
			routing := []bulkRoutingRow{{
				sectionID: "sec-a", id: "rp-1", baseModuleID: "mod-a1",
				lowerModuleID: "mod-a1", higherModuleID: "mod-a1",
				policyKey:    "practice_threshold",
				policyConfig: testCase.config, revision: 4,
			}}
			shell := assembleShellTree(identity, sections, modules, routing, nil, "exam-9")
			policy := shell.Sections[0].RoutingPolicy
			if policy == nil {
				t.Fatal("routing row present but policy is nil")
			}
			if policy.MinimumCorrectForHigher != testCase.wantThreshold {
				t.Fatalf("minimumCorrectForHigher = %d, want %d", policy.MinimumCorrectForHigher, testCase.wantThreshold)
			}
			if policy.OperationalCount != 20 {
				t.Fatalf("operationalQuestionCount = %d, want 20 (SAT math blueprint)", policy.OperationalCount)
			}
			if policy.Revision != 4 || policy.ID != "rp-1" || policy.PolicyKey != "practice_threshold" {
				t.Fatalf("policy scalar fields drifted: %+v", policy)
			}
		})
	}
}

// TestAssembleShellTreeOperational Derivation pins the fallback when the
// base module is not a known blueprint module: target minus authored pretest
// in the base module, floored at 1.
func TestAssembleShellTreeOperationalDerivation(t *testing.T) {
	identity := shellIdentity{providerKey: "sat", versionID: "v-1"}
	sections := []bulkSectionRow{{id: "sec-a", sectionKey: "custom", title: "C", displayOrder: 0}}
	modules := []bulkModuleRow{{
		id: "mod-a1", sectionID: "sec-a", moduleKey: "custom-m1",
		title: "M1", displayOrder: 0, targetCount: 10, adaptiveRole: RoleBase,
	}}
	routing := []bulkRoutingRow{{
		sectionID: "sec-a", id: "rp-1", baseModuleID: "mod-a1",
		lowerModuleID: "mod-a1", higherModuleID: "mod-a1",
		policyKey:    "practice_threshold",
		policyConfig: sql.NullString{String: `{"minimumCorrectForHigher":3}`, Valid: true},
		revision:     1,
	}}
	questions := []bulkQuestionRow{
		{moduleID: "mod-a1", examQuestionID: "eq-1", questionID: "q-1", revisionID: "rev-1", sectionKey: "custom", displayOrder: 0, isPretest: false},
		{moduleID: "mod-a1", examQuestionID: "eq-2", questionID: "q-2", revisionID: "rev-2", sectionKey: "custom", displayOrder: 1, isPretest: true},
		{moduleID: "mod-a1", examQuestionID: "eq-3", questionID: "q-3", revisionID: "rev-3", sectionKey: "custom", displayOrder: 2, isPretest: true},
	}
	shell := assembleShellTree(identity, sections, modules, routing, questions, "exam-9")
	// target 10 - 2 authored pretest = 8 (row.summary() preserves isPretest).
	if got := shell.Sections[0].RoutingPolicy.OperationalCount; got != 8 {
		t.Fatalf("operationalQuestionCount = %d, want 8 (10 target - 2 pretest)", got)
	}

	// Missing base module never projects 0 (the release page would clamp to 1).
	shell = assembleShellTree(identity, sections, nil, routing, nil, "exam-9")
	if got := shell.Sections[0].RoutingPolicy.OperationalCount; got != 1 {
		t.Fatalf("operationalQuestionCount without base = %d, want floor 1", got)
	}
}

// TestAssembleShellTreeToolPolicyDefault pins loadModules' tool_policy rule:
// NULL or blank becomes {}, anything else passes through verbatim (including
// the JSON array form the SAT math modules use).
func TestAssembleShellTreeToolPolicyDefault(t *testing.T) {
	cases := []struct {
		name string
		raw  sql.NullString
		want string
	}{
		{"null column", sql.NullString{Valid: false}, "{}"},
		{"blank string", sql.NullString{String: "   ", Valid: true}, "{}"},
		{"empty string", sql.NullString{String: "", Valid: true}, "{}"},
		{"object", sql.NullString{String: `{"calculator":false}`, Valid: true}, `{"calculator":false}`},
		{"array", sql.NullString{String: `["calculator","reference_sheet"]`, Valid: true}, `["calculator","reference_sheet"]`},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			identity := shellIdentity{providerKey: "sat", versionID: "v-1"}
			sections := []bulkSectionRow{{id: "sec-a", sectionKey: "math"}}
			modules := []bulkModuleRow{{id: "mod-a", sectionID: "sec-a", moduleKey: "math-m1", toolPolicy: testCase.raw}}
			shell := assembleShellTree(identity, sections, modules, nil, nil, "exam-9")
			got := string(shell.Sections[0].Modules[0].ToolPolicy)
			if got != testCase.want {
				t.Fatalf("toolPolicy = %q, want %q", got, testCase.want)
			}
		})
	}
}

// TestAssembleShellTreeRoutingFirstRowWins pins the documented tie-break.
// uq_assessment_routing_section makes a second row per section impossible in
// production; the nested loader read one row via QueryRowContext, so if the
// invariant is ever broken the bulk path must not silently pick a different
// row than the old path did.
func TestAssembleShellTreeRoutingFirstRowWins(t *testing.T) {
	identity := shellIdentity{providerKey: "sat", versionID: "v-1"}
	sections := []bulkSectionRow{{id: "sec-a", sectionKey: "math"}}
	routing := []bulkRoutingRow{
		{sectionID: "sec-a", id: "rp-first", policyKey: "practice_threshold", revision: 1},
		{sectionID: "sec-a", id: "rp-second", policyKey: "practice_threshold", revision: 2},
	}
	shell := assembleShellTree(identity, sections, nil, routing, nil, "exam-9")
	if shell.Sections[0].RoutingPolicy.ID != "rp-first" {
		t.Fatalf("first routing row must win (QueryRowContext parity), got %q", shell.Sections[0].RoutingPolicy.ID)
	}
}

// TestAssembleShellTreeOrphanRowsAreDropped pins the join semantics: a module
// whose section is not in the sections result (impossible under the FK, but
// cheap to guarantee) and questions whose module is absent must not appear,
// and must not panic.
func TestAssembleShellTreeOrphanRowsAreDropped(t *testing.T) {
	identity := shellIdentity{providerKey: "sat", versionID: "v-1"}
	sections := []bulkSectionRow{{id: "sec-a", sectionKey: "math"}}
	modules := []bulkModuleRow{
		{id: "mod-a", sectionID: "sec-a", moduleKey: "math-m1"},
		{id: "mod-orphan", sectionID: "sec-missing", moduleKey: "ghost"},
	}
	questions := []bulkQuestionRow{
		{moduleID: "mod-orphan", examQuestionID: "eq-orphan"},
		{moduleID: "mod-a", examQuestionID: "eq-1"},
	}
	shell := assembleShellTree(identity, sections, modules, nil, questions, "exam-9")
	if len(shell.Sections) != 1 || len(shell.Sections[0].Modules) != 1 {
		t.Fatalf("orphan module leaked into the tree: %+v", shell.Sections)
	}
	if shell.Sections[0].Modules[0].ID != "mod-a" {
		t.Fatalf("wrong module projected: %+v", shell.Sections[0].Modules[0])
	}
	if len(shell.Sections[0].Modules[0].Questions) != 1 ||
		shell.Sections[0].Modules[0].Questions[0].ExamQuestionID != "eq-1" {
		t.Fatalf("orphan question leaked into the tree: %+v", shell.Sections[0].Modules[0].Questions)
	}
}

// TestAssembleShellTreeSectionScalars pins the section projection field by
// field: a swapped column (duration vs break) would pass every ordering test
// but break the UI.
func TestAssembleShellTreeSectionScalars(t *testing.T) {
	identity := shellIdentity{providerKey: "sat", versionID: "v-1"}
	sections := []bulkSectionRow{{id: "sec-a", sectionKey: "reading-writing", title: "RW", displayOrder: 7, duration: 3840, brk: 600, revision: 11}}
	shell := assembleShellTree(identity, sections, nil, nil, nil, "exam-9")
	got := shell.Sections[0]
	if got.SectionKey != "reading-writing" || got.Title != "RW" || got.DisplayOrder != 7 ||
		got.DurationSeconds != 3840 || got.BreakAfterSecs != 600 || got.Revision != 11 {
		t.Fatalf("section scalars drifted: %+v", got)
	}
	payload, err := json.Marshal(got)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(payload), `"breakAfterSeconds":600`) {
		t.Fatalf("breakAfterSeconds field name drifted: %s", payload)
	}
}
