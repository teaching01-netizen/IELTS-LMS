package exams

import (
	"context"
	"regexp"
	"strings"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

const branchCountQuery = "SELECT s.section_key, COUNT(eq.id) FROM assessment_sections s JOIN assessment_modules m"

func TestParseSATRoutePolicy(t *testing.T) {
	for raw, want := range map[string]SATRoutePolicy{"": SATRouteAdaptive, " Adaptive ": SATRouteAdaptive, "force_lower": SATRouteForceLower, "force_higher": SATRouteForceHigher} {
		got, err := ParseSATRoutePolicy(raw)
		if err != nil || got != want {
			t.Errorf("ParseSATRoutePolicy(%q) = %q, %v; want %q", raw, got, err, want)
		}
	}
	if got, err := ParseSATRoutePolicy("staff_selects"); err != nil || got != SATRouteStaffSelects || got.Branch() != "" {
		t.Errorf("staff_selects must parse with no fixed branch, got %q, %v", got, err)
	}
	if _, err := ParseSATRoutePolicy("random"); err == nil {
		t.Error("unsupported policy must be rejected")
	}
}

func TestParseSATSession(t *testing.T) {
	ok := map[[2]string]SATSession{
		{"", ""}:                     {Route: SATRouteAdaptive},
		{"practice", ""}:             {Route: SATRouteAdaptive},
		{"classroom", ""}:            {Classroom: true, Route: SATRouteAdaptive},
		{"", "force_higher"}:         {Classroom: true, Route: SATRouteForceHigher},
		{"classroom", "force_lower"}: {Classroom: true, Route: SATRouteForceLower},
		{"", "staff_selects"}:        {Classroom: true, Route: SATRouteStaffSelects},
	}
	for in, want := range ok {
		got, err := ParseSATSession(in[0], in[1])
		if err != nil || got != want {
			t.Errorf("ParseSATSession(%q, %q) = %+v, %v; want %+v", in[0], in[1], got, err, want)
		}
	}
	for _, in := range [][2]string{{"practice", "force_lower"}, {"exam", ""}, {"practice", "staff_selects"}} {
		if _, err := ParseSATSession(in[0], in[1]); err == nil {
			t.Errorf("ParseSATSession(%q, %q) must fail", in[0], in[1])
		}
	}
}

func TestPersistSATSession(t *testing.T) {
	newDB := func(t *testing.T) (RoutePolicyExecer, sqlmock.Sqlmock) {
		db, mock, err := sqlmock.New()
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { db.Close() })
		return db, mock
	}
	ctx := context.Background()

	t.Run("adaptive writes nothing", func(t *testing.T) {
		db, mock := newDB(t)
		mock.ExpectQuery("sat_classroom_plan").WithArgs("v1").WillReturnRows(sqlmock.NewRows([]string{"plan"}).AddRow(nil))
		if err := PersistSATSession(ctx, db, "s1", "sat", "v1", SATSession{}, nil); err != nil {
			t.Fatal(err)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatal(err)
		}
	})
	t.Run("plan-bearing version cannot be scheduled as practice", func(t *testing.T) {
		db, mock := newDB(t)
		mock.ExpectQuery("sat_classroom_plan").WithArgs("v1").WillReturnRows(sqlmock.NewRows([]string{"plan"}).AddRow(`{"math":"m2_easy"}`))
		err := PersistSATSession(ctx, db, "s1", "sat", "v1", SATSession{}, nil)
		if err == nil || !strings.Contains(err.Error(), "classroom module plan") {
			t.Fatalf("plan-bearing practice schedule must be rejected, got %v", err)
		}
		// A run narrowed to a section the plan does not touch is still standard practice.
		mock.ExpectQuery("sat_classroom_plan").WithArgs("v1").WillReturnRows(sqlmock.NewRows([]string{"plan"}).AddRow(`{"math":"m2_easy"}`))
		if err := PersistSATSession(ctx, db, "s1", "sat", "v1", SATSession{}, map[string]bool{"reading-writing": true}); err != nil {
			t.Fatalf("out-of-scope plan must not block practice: %v", err)
		}
	})
	t.Run("classroom adaptive stores the mode only", func(t *testing.T) {
		db, mock := newDB(t)
		mock.ExpectExec(regexp.QuoteMeta("UPDATE exam_schedules SET sat_session_mode = 'classroom' WHERE id = ?")).
			WithArgs("s1").WillReturnResult(sqlmock.NewResult(0, 1))
		if err := PersistSATSession(ctx, db, "s1", "sat", "v1", SATSession{Classroom: true, Route: SATRouteAdaptive}, nil); err != nil {
			t.Fatal(err)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatal(err)
		}
	})
	t.Run("staff_selects stores the policy when the plan has no shaped sections", func(t *testing.T) {
		db, mock := newDB(t)
		mock.ExpectQuery("sat_classroom_plan").WithArgs("v1").WillReturnRows(sqlmock.NewRows([]string{"plan"}).AddRow(nil))
		mock.ExpectExec(regexp.QuoteMeta("UPDATE exam_schedules SET sat_session_mode = 'classroom', sat_route_policy = ? WHERE id = ?")).
			WithArgs("staff_selects", "s1").WillReturnResult(sqlmock.NewResult(0, 1))
		if err := PersistSATSession(ctx, db, "s1", "sat", "v1", SATSession{Classroom: true, Route: SATRouteStaffSelects}, nil); err != nil {
			t.Fatal(err)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatal(err)
		}
	})
	t.Run("rollout gate blocks new classroom sessions only", func(t *testing.T) {
		SetClassroomCreationEnabled(false)
		t.Cleanup(func() { SetClassroomCreationEnabled(true) })
		db, mock := newDB(t)
		mock.ExpectQuery("sat_classroom_plan").WithArgs("v1").WillReturnRows(sqlmock.NewRows([]string{"plan"}).AddRow(nil))
		err := PersistSATSession(ctx, db, "s1", "sat", "v1", SATSession{Classroom: true, Route: SATRouteStaffSelects}, nil)
		if err == nil || !strings.Contains(err.Error(), "not enabled") {
			t.Fatalf("classroom creation must be gated, got %v", err)
		}
		if err := PersistSATSession(ctx, db, "s1", "sat", "v1", SATSession{}, nil); err != nil {
			t.Fatalf("practice sessions must be unaffected: %v", err)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatal(err)
		}
	})
	t.Run("non-SAT provider is rejected", func(t *testing.T) {
		db, _ := newDB(t)
		if err := PersistSATSession(ctx, db, "s1", "ielts", "v1", SATSession{Classroom: true, Route: SATRouteForceHigher}, nil); err == nil {
			t.Fatal("forced policy on a non-SAT schedule must fail")
		}
	})
	t.Run("empty forced branch is rejected", func(t *testing.T) {
		db, mock := newDB(t)
		mock.ExpectQuery("sat_classroom_plan").WithArgs("v1").WillReturnRows(sqlmock.NewRows([]string{"plan"}).AddRow(nil))
		mock.ExpectQuery(regexp.QuoteMeta(branchCountQuery)).WithArgs("lower_branch", "v1").
			WillReturnRows(sqlmock.NewRows([]string{"section_key", "n"}).AddRow("reading-writing", 22).AddRow("math", 0))
		if err := PersistSATSession(ctx, db, "s1", "sat", "v1", SATSession{Classroom: true, Route: SATRouteForceLower}, nil); err == nil {
			t.Fatal("empty math lower branch must fail an unscoped run")
		}
	})
	t.Run("sections outside scope are not checked", func(t *testing.T) {
		db, mock := newDB(t)
		mock.ExpectQuery("sat_classroom_plan").WithArgs("v1").WillReturnRows(sqlmock.NewRows([]string{"plan"}).AddRow(nil))
		mock.ExpectQuery(regexp.QuoteMeta(branchCountQuery)).WithArgs("higher_branch", "v1").
			WillReturnRows(sqlmock.NewRows([]string{"section_key", "n"}).AddRow("reading-writing", 22).AddRow("math", 0))
		mock.ExpectExec(regexp.QuoteMeta("UPDATE exam_schedules SET sat_session_mode = 'classroom', sat_route_policy = ? WHERE id = ?")).
			WithArgs("force_higher", "s1").WillReturnResult(sqlmock.NewResult(0, 1))
		scope := map[string]bool{LinkSectionReadingWriting: true}
		if err := PersistSATSession(ctx, db, "s1", "sat", "v1", SATSession{Classroom: true, Route: SATRouteForceHigher}, scope); err != nil {
			t.Fatal(err)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatal(err)
		}
	})
	t.Run("forced route conflicting with the module plan is rejected", func(t *testing.T) {
		db, mock := newDB(t)
		mock.ExpectQuery("sat_classroom_plan").WithArgs("v1").
			WillReturnRows(sqlmock.NewRows([]string{"plan"}).AddRow(`{"math":"m2_hard"}`))
		mock.ExpectQuery(regexp.QuoteMeta(branchCountQuery)).WithArgs("lower_branch", "v1").
			WillReturnRows(sqlmock.NewRows([]string{"section_key", "n"}).AddRow("math", 10))
		if err := PersistSATSession(ctx, db, "s1", "sat", "v1", SATSession{Classroom: true, Route: SATRouteForceLower}, nil); err == nil {
			t.Fatal("force_lower on a Hard-only math plan must fail")
		}
	})
}
