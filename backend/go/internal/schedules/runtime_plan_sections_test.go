package schedules

// Student Access section scope (migration 0066) reaching the runtime plan.
//
// runtimePlanIn is the one place that decides "which sections does this run
// have": every downstream behavior (exam_session_runtime_sections, proctor
// section advance, stepCompleteRuntime, auto-submit, the student's clocks)
// inherits its answer. These cases pin that a scoped link narrows the plan, that
// the narrowing survives both fallback paths (the easiest place to silently
// regain the dropped section), and that a version-disabled section can never be
// re-enabled by a link — the two levels of on/off are ANDed, not merged.

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"regexp"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	examdomain "example.com/ielts-proctoring/internal/exams"
	examruntime "example.com/ielts-proctoring/internal/runtime"
)

// planVersionRows stages the pinned-version read (config snapshot + exam type).
func planVersionRows(mock sqlmock.Sqlmock, config, examType string) {
	mock.ExpectQuery(regexp.QuoteMeta("FROM exam_versions v JOIN exam_entities e")).
		WithArgs("pv-1").
		WillReturnRows(sqlmock.NewRows([]string{"config_snapshot", "exam_type"}).AddRow(config, examType))
}

// planLinkScopeRows stages the link scope read. A NULL value is an unscoped link.
func planLinkScopeRows(mock sqlmock.Sqlmock, scheduleID string, scope any) {
	mock.ExpectQuery(regexp.QuoteMeta("enabled_sections FROM assessment_access_links WHERE schedule_id")).
		WithArgs(scheduleID).
		WillReturnRows(sqlmock.NewRows([]string{"enabled_sections"}).AddRow(scope))
}

// planModuleRows stages the version's authored module rows — (section_key,
// adaptive_role, duration_seconds), exactly as the role-agnostic read returns
// them: the runtime plan folds them through exams.AdaptiveRoleSeconds to derive
// an adaptive section's candidate length (Module 1 plus the longer branch).
// Staged separately from planSectionRows because the derivation is the point —
// the stored section row may disagree. Non-adaptive roles are staged too and
// must be ignored by the fold.
func planModuleRows(mock sqlmock.Sqlmock, rows ...[]driver.Value) {
	out := sqlmock.NewRows([]string{"section_key", "adaptive_role", "duration_seconds"})
	for _, row := range rows {
		out.AddRow(row...)
	}
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_modules m")).
		WithArgs("pv-1").
		WillReturnRows(out)
}

// planSectionRows stages the version's authored section rows.
func planSectionRows(mock sqlmock.Sqlmock, rows ...[]driver.Value) {
	out := sqlmock.NewRows([]string{"section_key", "title", "display_order", "duration_seconds", "break_after_seconds"})
	for _, row := range rows {
		out.AddRow(row...)
	}
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_sections WHERE exam_version_id")).
		WithArgs("pv-1").
		WillReturnRows(out)
}

func planSectionKeys(plan []examruntime.PlanEntry) []string {
	keys := make([]string, 0, len(plan))
	for _, entry := range plan {
		keys = append(keys, entry.SectionKey)
	}
	return keys
}

func assertPlanKeys(t *testing.T, plan []examruntime.PlanEntry, want ...string) {
	t.Helper()
	got := planSectionKeys(plan)
	if len(got) != len(want) {
		t.Fatalf("plan sections = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("plan sections = %v, want %v", got, want)
		}
	}
}

func satPlanSchedule() Schedule {
	return Schedule{ID: "sched-1", ProviderKey: "sat", PublishedVersionID: "pv-1", PlannedDurationMinutes: 134}
}

func testPlanQuerier(t *testing.T) (*sql.DB, sqlmock.Sqlmock) {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db, mock
}

// Both version sections present, link scoped to Reading & Writing: the run holds
// Reading & Writing only, so the exam ends when it does.
func TestRuntimePlanInNarrowsToLinkScope(t *testing.T) {
	db, mock := testPlanQuerier(t)
	planVersionRows(mock, "{}", "Academic")
	planLinkScopeRows(mock, "sched-1", `["reading-writing"]`)
	planModuleRows(mock)
	planSectionRows(mock,
		[]driver.Value{"reading-writing", "Reading and Writing", 0, 3840, 0},
		[]driver.Value{"math", "Math", 1, 4200, 0})

	plan, model, err := runtimePlanIn(context.Background(), db, satPlanSchedule())
	if err != nil {
		t.Fatalf("runtimePlanIn must succeed: %v", err)
	}
	if model != examruntime.TimingModelCohortSection {
		t.Fatalf("SAT must plan the cohort section clock, got %q", model)
	}
	assertPlanKeys(t, plan, "reading-writing")
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// A math-only scope is the mirror case: the run ends after Math.
func TestRuntimePlanInNarrowsToMathOnly(t *testing.T) {
	db, mock := testPlanQuerier(t)
	planVersionRows(mock, "{}", "Academic")
	planLinkScopeRows(mock, "sched-1", `["math"]`)
	planModuleRows(mock)
	planSectionRows(mock,
		[]driver.Value{"reading-writing", "Reading and Writing", 0, 3840, 0},
		[]driver.Value{"math", "Math", 1, 4200, 0})

	plan, _, err := runtimePlanIn(context.Background(), db, satPlanSchedule())
	if err != nil {
		t.Fatalf("runtimePlanIn must succeed: %v", err)
	}
	assertPlanKeys(t, plan, "math")
}

// A link with no scope (NULL) keeps every section the version enables.
func TestRuntimePlanInUnscopedLinkKeepsEverySection(t *testing.T) {
	db, mock := testPlanQuerier(t)
	planVersionRows(mock, "{}", "Academic")
	planLinkScopeRows(mock, "sched-1", nil)
	planModuleRows(mock)
	planSectionRows(mock,
		[]driver.Value{"reading-writing", "Reading and Writing", 0, 3840, 0},
		[]driver.Value{"math", "Math", 1, 4200, 0})

	plan, _, err := runtimePlanIn(context.Background(), db, satPlanSchedule())
	if err != nil {
		t.Fatalf("runtimePlanIn must succeed: %v", err)
	}
	assertPlanKeys(t, plan, "reading-writing", "math")
}

// A schedule with no link at all keeps every section too — admin-created
// schedules never gained a scope and must not lose a section to this feature.
func TestRuntimePlanInWithoutLinkKeepsEverySection(t *testing.T) {
	db, mock := testPlanQuerier(t)
	planVersionRows(mock, "{}", "Academic")
	mock.ExpectQuery(regexp.QuoteMeta("enabled_sections FROM assessment_access_links WHERE schedule_id")).
		WithArgs("sched-1").
		WillReturnError(sql.ErrNoRows)
	planModuleRows(mock)
	planSectionRows(mock,
		[]driver.Value{"reading-writing", "Reading and Writing", 0, 3840, 0},
		[]driver.Value{"math", "Math", 1, 4200, 0})

	plan, _, err := runtimePlanIn(context.Background(), db, satPlanSchedule())
	if err != nil {
		t.Fatalf("runtimePlanIn must succeed: %v", err)
	}
	assertPlanKeys(t, plan, "reading-writing", "math")
}

// The config fallback is filtered too: an empty config snapshot with no section
// rows would otherwise hand a verbal-only link its Math back.
func TestRuntimePlanInFiltersConfigFallback(t *testing.T) {
	db, mock := testPlanQuerier(t)
	planVersionRows(mock, `{"sections":{"reading-writing":{"enabled":true,"order":0,"duration":64},"math":{"enabled":true,"order":1,"duration":70}}}`, "Academic")
	planLinkScopeRows(mock, "sched-1", `["reading-writing"]`)
	planModuleRows(mock)
	planSectionRows(mock)

	plan, _, err := runtimePlanIn(context.Background(), db, satPlanSchedule())
	if err != nil {
		t.Fatalf("runtimePlanIn must succeed: %v", err)
	}
	assertPlanKeys(t, plan, "reading-writing")
}

// The hardcoded fallback is filtered too: a version with no usable plan at all
// must still respect the link scope.
func TestRuntimePlanInFiltersHardcodedFallback(t *testing.T) {
	db, mock := testPlanQuerier(t)
	planVersionRows(mock, "", "Academic")
	planLinkScopeRows(mock, "sched-1", `["math"]`)
	planModuleRows(mock)
	planSectionRows(mock)

	plan, _, err := runtimePlanIn(context.Background(), db, satPlanSchedule())
	if err != nil {
		t.Fatalf("runtimePlanIn must succeed: %v", err)
	}
	assertPlanKeys(t, plan, "math")
}

// A link may only NARROW: selecting both sections cannot re-enable one the
// version disabled. The intersection, not a replacement, is what enforces it.
func TestRuntimePlanInCannotWidenPastVersionConfig(t *testing.T) {
	db, mock := testPlanQuerier(t)
	planVersionRows(mock, `{"sections":{"reading-writing":{"enabled":true,"order":0,"duration":64},"math":{"enabled":false,"order":1,"duration":70}}}`, "Academic")
	planLinkScopeRows(mock, "sched-1", `["reading-writing","math"]`)
	planModuleRows(mock)
	planSectionRows(mock)

	plan, _, err := runtimePlanIn(context.Background(), db, satPlanSchedule())
	if err != nil {
		t.Fatalf("runtimePlanIn must succeed: %v", err)
	}
	assertPlanKeys(t, plan, "reading-writing")
}

// A session with no schedule id (plan derivation off the pool, as in the
// pre-start previews) skips the scope read entirely rather than querying with an
// empty key.
func TestRuntimePlanInWithoutScheduleIDSkipsScopeRead(t *testing.T) {
	db, mock := testPlanQuerier(t)
	planVersionRows(mock, "{}", "Academic")
	planModuleRows(mock)
	planSectionRows(mock,
		[]driver.Value{"reading-writing", "Reading and Writing", 0, 3840, 0},
		[]driver.Value{"math", "Math", 1, 4200, 0})

	plan, _, err := runtimePlanIn(context.Background(), db, Schedule{ProviderKey: "sat", PublishedVersionID: "pv-1"})
	if err != nil {
		t.Fatalf("runtimePlanIn must succeed: %v", err)
	}
	assertPlanKeys(t, plan, "reading-writing", "math")
}

// The stored section length can be the pre-CandidateSectionSeconds
// overstatement (0065's Math 105 minutes, Reading & Writing 96). The runtime
// clock is derived from the modules instead, so a stale row cannot put the
// cohort on an extra branch-long wait after Module 2.
func TestRuntimePlanInDerivesCandidateSectionLengthFromModules(t *testing.T) {
	db, mock := testPlanQuerier(t)
	planVersionRows(mock, "{}", "Academic")
	planLinkScopeRows(mock, "sched-1", nil)
	planModuleRows(mock,
		[]driver.Value{"math", "base", 2100},
		[]driver.Value{"math", "lower_branch", 2100},
		[]driver.Value{"math", "higher_branch", 2100})
	planSectionRows(mock, []driver.Value{"math", "Math", 0, 6300, 0})

	plan, _, err := runtimePlanIn(context.Background(), db, satPlanSchedule())
	if err != nil {
		t.Fatalf("runtimePlanIn must succeed: %v", err)
	}
	if len(plan) != 1 {
		t.Fatalf("expected one plan entry, got %+v", plan)
	}
	if plan[0].DurationMinutes != 70 {
		t.Fatalf("a candidate sits Module 1 plus ONE branch: want 70 minutes, got %d (stored row said 105)", plan[0].DurationMinutes)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// The branch a candidate sits is chosen by routing, so the section length is
// base + the LONGER branch. Base 30 + higher 40 = 70 — not base*2 (60) and not
// the sum of all three (95).
func TestRuntimePlanInUsesTheLongerBranch(t *testing.T) {
	db, mock := testPlanQuerier(t)
	planVersionRows(mock, "{}", "Academic")
	planLinkScopeRows(mock, "sched-1", nil)
	planModuleRows(mock,
		[]driver.Value{"math", "base", 1800},
		[]driver.Value{"math", "lower_branch", 2100},
		[]driver.Value{"math", "higher_branch", 2400})
	planSectionRows(mock, []driver.Value{"math", "Math", 0, 5700, 0})

	plan, _, err := runtimePlanIn(context.Background(), db, satPlanSchedule())
	if err != nil {
		t.Fatalf("runtimePlanIn must succeed: %v", err)
	}
	if plan[0].DurationMinutes != 70 {
		t.Fatalf("want base 30 + higher 40 = 70 minutes, got %d", plan[0].DurationMinutes)
	}
}

// The SQL this fold replaced compared adaptive_role under the column's
// utf8mb4_0900_ai_ci collation, so a stored 'BASE' or 'Lower_Branch' matched
// the adaptive vocabulary — and the schema's CHECK admits those variants (it
// rejects padded roles, whose comparison is NO PAD). The Go fold must reproduce
// that comparison, or the section silently keeps the authored row: 105 minutes
// here, exactly the pre-candidate-length overstatement this derivation exists
// to keep off the clock.
func TestRuntimePlanInFoldsCaseVariantRolesLikeTheRemovedSQL(t *testing.T) {
	db, mock := testPlanQuerier(t)
	planVersionRows(mock, "{}", "Academic")
	planLinkScopeRows(mock, "sched-1", nil)
	planModuleRows(mock,
		[]driver.Value{"math", "BASE", 2100},
		[]driver.Value{"math", "Lower_Branch", 2400},
		[]driver.Value{"math", "higher_branch", 1800})
	planSectionRows(mock, []driver.Value{"math", "Math", 0, 6300, 0})

	plan, _, err := runtimePlanIn(context.Background(), db, satPlanSchedule())
	if err != nil {
		t.Fatalf("runtimePlanIn must succeed: %v", err)
	}
	if plan[0].DurationMinutes != 75 {
		t.Fatalf("case-variant roles must fold like the SQL collation: want 2100 + 2400 = 75 minutes, got %d (authored row said 105)", plan[0].DurationMinutes)
	}
}

// A section with no adaptive roles (IELTS/ACT) has no candidate shape to
// derive: its authored length stands.
func TestRuntimePlanInKeepsAuthoredLengthWithoutAdaptiveRoles(t *testing.T) {
	db, mock := testPlanQuerier(t)
	planVersionRows(mock, "{}", "Academic")
	planLinkScopeRows(mock, "sched-1", nil)
	planModuleRows(mock)
	planSectionRows(mock, []driver.Value{"reading-writing", "Reading and Writing", 0, 3600, 0})

	plan, _, err := runtimePlanIn(context.Background(), db, satPlanSchedule())
	if err != nil {
		t.Fatalf("runtimePlanIn must succeed: %v", err)
	}
	if plan[0].DurationMinutes != 60 {
		t.Fatalf("a non-adaptive section keeps its authored length: want 60, got %d", plan[0].DurationMinutes)
	}
}

// An incomplete adaptive shape (no branch modules yet) cannot prove a candidate
// length; the plan falls back to what the author sees rather than inventing one.
func TestRuntimePlanInKeepsAuthoredLengthForIncompleteAdaptiveShape(t *testing.T) {
	db, mock := testPlanQuerier(t)
	planVersionRows(mock, "{}", "Academic")
	planLinkScopeRows(mock, "sched-1", nil)
	planModuleRows(mock, []driver.Value{"math", "base", 2100})
	planSectionRows(mock, []driver.Value{"math", "Math", 0, 4200, 0})

	plan, _, err := runtimePlanIn(context.Background(), db, satPlanSchedule())
	if err != nil {
		t.Fatalf("runtimePlanIn must succeed: %v", err)
	}
	if plan[0].DurationMinutes != 70 {
		t.Fatalf("want the authored 70 minutes, got %d", plan[0].DurationMinutes)
	}
}

// Duplicate role rows keep the largest value — the rule the SQL MAX(...) used
// to own inside the query and exams.AdaptiveRoleSeconds now owns — so a stray
// smaller authored row can never shorten a candidate's clock.
func TestRuntimePlanInKeepsLargestDuplicateRoleSeconds(t *testing.T) {
	db, mock := testPlanQuerier(t)
	planVersionRows(mock, "{}", "Academic")
	planLinkScopeRows(mock, "sched-1", nil)
	planModuleRows(mock,
		[]driver.Value{"math", "base", 1500},
		[]driver.Value{"math", "base", 2100},
		[]driver.Value{"math", "lower_branch", 1800})
	planSectionRows(mock, []driver.Value{"math", "Math", 0, 6000, 0})

	plan, _, err := runtimePlanIn(context.Background(), db, satPlanSchedule())
	if err != nil {
		t.Fatalf("runtimePlanIn must succeed: %v", err)
	}
	if plan[0].DurationMinutes != 65 {
		t.Fatalf("want the larger duplicate base + lower branch = 65 minutes, got %d", plan[0].DurationMinutes)
	}
}

// The fold ignores roles outside the adaptive vocabulary — 'none' is the only
// non-adaptive value the schema's CHECK admits (an empty role is rejected with
// Error 3819): it contributes nothing, so the authored section length stands.
// The old SQL made the same choice with an IN (...) filter.
func TestRuntimePlanInIgnoresUnknownModuleRoles(t *testing.T) {
	db, mock := testPlanQuerier(t)
	planVersionRows(mock, "{}", "Academic")
	planLinkScopeRows(mock, "sched-1", nil)
	planModuleRows(mock,
		[]driver.Value{"reading-writing", "none", 3600},
		[]driver.Value{"reading-writing", "none", 1800})
	planSectionRows(mock, []driver.Value{"reading-writing", "Reading and Writing", 0, 3600, 0})

	plan, _, err := runtimePlanIn(context.Background(), db, satPlanSchedule())
	if err != nil {
		t.Fatalf("runtimePlanIn must succeed: %v", err)
	}
	if plan[0].DurationMinutes != 60 {
		t.Fatalf("unknown roles must not prove a candidate length: want the authored 60 minutes, got %d", plan[0].DurationMinutes)
	}
}

// The stored scope parser fails open: NULL, empty, malformed, and unrecognized
// values all mean "no narrowing", so corruption cannot empty a run's plan.
func TestParseStoredSectionScopeFailsOpen(t *testing.T) {
	cases := map[string]string{
		"null":         "",
		"empty array":  "[]",
		"malformed":    "nope",
		"unknown keys": `["science"]`,
	}
	for name, raw := range cases {
		if got := examdomain.ParseStoredSectionScope(raw); got != nil {
			t.Fatalf("%s must mean no narrowing, got %v", name, got)
		}
	}
	got := examdomain.ParseStoredSectionScope(`["math"]`)
	if !got["math"] || len(got) != 1 {
		t.Fatalf("expected a math-only scope, got %v", got)
	}
}
