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
	planSectionRows(mock,
		[]driver.Value{"reading-writing", "Reading and Writing", 0, 3840, 0},
		[]driver.Value{"math", "Math", 1, 4200, 0})

	plan, _, err := runtimePlanIn(context.Background(), db, Schedule{ProviderKey: "sat", PublishedVersionID: "pv-1"})
	if err != nil {
		t.Fatalf("runtimePlanIn must succeed: %v", err)
	}
	assertPlanKeys(t, plan, "reading-writing", "math")
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
