package proctor

import (
	"context"
	"database/sql/driver"
	"regexp"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

// The staff run sheet reads one published version's authored sections and
// modules. These cases pin the two things the projection must never get wrong:
// an adaptive section's length is Module 1 + the LONGER branch (never the stored
// sum, never base*2), and a section without adaptive roles keeps its authored
// length. The stored 105-minute Math row is the pre-0065 overstatement: a
// student who finishes Module 2 on time otherwise waits out a branch they never
// sat before the break window opens.

func examPlanQuerier(t *testing.T) (sqlmock.Sqlmock, sessionQuerier) {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return mock, db
}

func planSectionPlanRows(mock sqlmock.Sqlmock, rows ...[]driver.Value) {
	out := sqlmock.NewRows([]string{"id", "section_key", "title", "display_order", "duration_seconds", "break_after_seconds"})
	for _, row := range rows {
		out.AddRow(row...)
	}
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_sections WHERE exam_version_id")).
		WithArgs("pv-1").
		WillReturnRows(out)
}

func planModulePlanRows(mock sqlmock.Sqlmock, rows ...[]driver.Value) {
	out := sqlmock.NewRows([]string{"section_id", "module_key", "title", "adaptive_role", "duration_seconds"})
	for _, row := range rows {
		out.AddRow(row...)
	}
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_modules m")).
		WithArgs("pv-1").
		WillReturnRows(out)
}

func TestLoadExamPlanDerivesCandidateSectionLength(t *testing.T) {
	mock, q := examPlanQuerier(t)
	planSectionPlanRows(
		mock,
		[]driver.Value{"sec-rw", "reading-writing", "Reading & Writing", 0, 5760, 600},
		[]driver.Value{"sec-math", "math", "Math", 1, 6300, 0},
	)
	planModulePlanRows(
		mock,
		[]driver.Value{"sec-math", "math-m1", "Module 1", "base", 2100},
		[]driver.Value{"sec-math", "math-m2-lower", "Module 2 — Lower", "lower_branch", 2100},
		[]driver.Value{"sec-math", "math-m2-higher", "Module 2 — Higher", "higher_branch", 2100},
	)

	plan, err := loadExamPlan(context.Background(), q, "pv-1")
	if err != nil {
		t.Fatalf("loadExamPlan must succeed: %v", err)
	}
	if len(plan) != 2 {
		t.Fatalf("expected both sections, got %+v", plan)
	}
	if plan[0].SectionKey != "reading-writing" || plan[0].DurationMinutes != 96 || plan[0].GapAfterMinutes != 10 {
		t.Fatalf("a section without adaptive rows keeps its authored length: got %+v", plan[0])
	}
	if plan[1].DurationMinutes != 70 {
		t.Fatalf("Math is Module 1 + one 35-minute branch: want 70 minutes, got %d (stored row said 105)", plan[1].DurationMinutes)
	}
	if len(plan[1].Modules) != 3 {
		t.Fatalf("every authored module must reach the run sheet, got %+v", plan[1].Modules)
	}
	if plan[1].Modules[0].ModuleKey != "math-m1" || plan[1].Modules[0].DurationMinutes != 35 || plan[1].Modules[0].AdaptiveRole != "base" {
		t.Fatalf("module projection lost its identity: %+v", plan[1].Modules[0])
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// The branch a candidate sits is chosen by routing, so the section length takes
// the LONGER branch: 30 + 40 = 70, not 60 (base*2) and not 95 (the sum).
func TestLoadExamPlanUsesTheLongerBranch(t *testing.T) {
	mock, q := examPlanQuerier(t)
	planSectionPlanRows(mock, []driver.Value{"sec-math", "math", "Math", 0, 5700, 0})
	planModulePlanRows(
		mock,
		[]driver.Value{"sec-math", "math-m1", "Module 1", "base", 1800},
		[]driver.Value{"sec-math", "math-m2-lower", "Module 2 — Lower", "lower_branch", 2100},
		[]driver.Value{"sec-math", "math-m2-higher", "Module 2 — Higher", "higher_branch", 2400},
	)

	plan, err := loadExamPlan(context.Background(), q, "pv-1")
	if err != nil {
		t.Fatalf("loadExamPlan must succeed: %v", err)
	}
	if plan[0].DurationMinutes != 70 {
		t.Fatalf("want base 30 + higher 40 = 70 minutes, got %d", plan[0].DurationMinutes)
	}
}

// An incomplete adaptive shape (no branch modules yet) cannot prove a candidate
// length; the authored value stands rather than an invented one.
func TestLoadExamPlanKeepsAuthoredLengthForIncompleteShape(t *testing.T) {
	mock, q := examPlanQuerier(t)
	planSectionPlanRows(mock, []driver.Value{"sec-math", "math", "Math", 0, 4200, 0})
	planModulePlanRows(mock, []driver.Value{"sec-math", "math-m1", "Module 1", "base", 2100})

	plan, err := loadExamPlan(context.Background(), q, "pv-1")
	if err != nil {
		t.Fatalf("loadExamPlan must succeed: %v", err)
	}
	if plan[0].DurationMinutes != 70 {
		t.Fatalf("want the authored 70 minutes, got %d", plan[0].DurationMinutes)
	}
	if len(plan[0].Modules) != 1 {
		t.Fatalf("the authored module must still be listed, got %+v", plan[0].Modules)
	}
}

// A runtime/schedule read with no published version skips the read entirely
// instead of querying with an empty key (mirrors the link-scope skip).
func TestLoadExamPlanWithoutVersionSkipsRead(t *testing.T) {
	mock, q := examPlanQuerier(t)
	plan, err := loadExamPlan(context.Background(), q, "")
	if err != nil {
		t.Fatalf("loadExamPlan must succeed: %v", err)
	}
	if plan != nil {
		t.Fatalf("no version means no plan, got %+v", plan)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
