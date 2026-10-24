package delivery

import (
	"context"
	"database/sql/driver"
	"regexp"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/platform/apperrors"
)

func expectStaffNextModuleTx(mock sqlmock.Sqlmock, policy string) {
	expectStaffNextModuleTxWithPlan(mock, policy, nil)
}

func expectStaffNextModuleTxWithPlan(mock sqlmock.Sqlmock, policy string, plan driver.Value) {
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_modules m JOIN assessment_sections s ON s.id = m.section_id WHERE m.id = ?")).
		WithArgs("mod-base").
		WillReturnRows(nextModuleSectionRows([]driver.Value{"sec-1", "math", 0, "base", "pv-1"}))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_routing_policies WHERE section_id = ?")).
		WithArgs("sec-1").
		WillReturnRows(sqlmock.NewRows([]string{"section_id", "base_module_id", "lower_module_id", "higher_module_id", "policy_key", "policy_config", "policy_revision"}).
			AddRow("sec-1", "mod-base", "mod-lower", "mod-higher", "practice_threshold", `{"minimumCorrectForHigher":13}`, 1))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT COALESCE(sch.sat_route_policy, 'adaptive') FROM student_attempts sa")).
		WithArgs("att-1").
		WillReturnRows(sqlmock.NewRows([]string{"policy"}).AddRow(policy))
	mock.ExpectQuery("sat_classroom_plan").WithArgs("pv-1").WillReturnRows(sqlmock.NewRows([]string{"plan"}).AddRow(plan))
}

// staff_selects closes Module 1 without a route decision or Module 2 attempt.
func TestNextModuleTxStaffSelectsWaitsForAssignment(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := deliverySvc(db)
	mock.ExpectBegin()
	txn, err := db.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	expectStaffNextModuleTx(mock, "staff_selects")

	next, err := svc.nextModuleTx(context.Background(), txn, "att-1", "ma-base", "mod-base", 20, 25, routeAudit{})
	if err != nil {
		t.Fatal(err)
	}
	if next == nil || !next.awaitingRoute || next.id != "" {
		t.Fatalf("staff_selects must report an awaiting row with no module, got %+v", next)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func staffRouteSvc(t *testing.T) (*Service, sqlmock.Sqlmock) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	svc := deliverySvc(db)
	svc.liveDirect = true
	return svc, mock
}

func expectStaffRouteBegin(mock sqlmock.Sqlmock) {
	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta("SET time_zone = '+00:00'")).WillReturnResult(sqlmock.NewResult(0, 0))
}

func expectStaffRouteLockAndModuleOne(mock sqlmock.Sqlmock, policy, state string) {
	expectStaffRouteLockRow(mock, policy, false)
	expectStaffRouteModuleOne(mock, state)
}

func expectStaffRouteLockRow(mock sqlmock.Sqlmock, policy string, sealed bool) {
	expectStaffRouteBegin(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_attempts sa JOIN exam_schedules sch ON sch.id = sa.schedule_id WHERE sa.id = ? AND sa.schedule_id = ? FOR UPDATE")).
		WithArgs("att-1", "sched-1").
		WillReturnRows(sqlmock.NewRows([]string{"policy", "sealed"}).AddRow(policy, sealed))
}

func expectStaffRouteModuleOne(mock sqlmock.Sqlmock, state string) {
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_module_attempts ma JOIN assessment_modules m ON m.id = ma.module_id AND m.adaptive_role = 'base'")).
		WithArgs("att-1", "math").
		WillReturnRows(sqlmock.NewRows([]string{"sid", "mid", "maid", "state", "raw", "op"}).AddRow("sec-1", "mod-base", "ma-base", state, 20, 25))
}

func TestAssignStaffRouteGuards(t *testing.T) {
	ctx := context.Background()

	t.Run("replay of the committed choice is idempotent", func(t *testing.T) {
		svc, mock := staffRouteSvc(t)
		expectStaffRouteLockAndModuleOne(mock, "staff_selects", "locked")
		mock.ExpectQuery(regexp.QuoteMeta("SELECT selected_route FROM assessment_route_decisions")).
			WithArgs("att-1", "sec-1").WillReturnRows(sqlmock.NewRows([]string{"r"}).AddRow("higher"))
		mock.ExpectQuery(regexp.QuoteMeta("SELECT selected_module_id FROM assessment_route_decisions")).
			WithArgs("att-1", "sec-1").WillReturnRows(sqlmock.NewRows([]string{"m"}).AddRow("mod-higher"))
		mock.ExpectCommit()
		out, err := svc.AssignStaffRoute(ctx, "staff-1", "sched-1", "att-1", "math", "higher")
		if err != nil || !out.Replayed || out.SelectedModuleID != "mod-higher" {
			t.Fatalf("identical repeat must replay the decision, got %+v, %v", out, err)
		}
	})

	t.Run("opposite choice after commit is a conflict", func(t *testing.T) {
		svc, mock := staffRouteSvc(t)
		expectStaffRouteLockAndModuleOne(mock, "staff_selects", "locked")
		mock.ExpectQuery(regexp.QuoteMeta("SELECT selected_route FROM assessment_route_decisions")).
			WithArgs("att-1", "sec-1").WillReturnRows(sqlmock.NewRows([]string{"r"}).AddRow("higher"))
		mock.ExpectRollback()
		_, err := svc.AssignStaffRoute(ctx, "staff-2", "sched-1", "att-1", "math", "lower")
		if deliveryCodeOf(err) != apperrors.CodeAssessmentConflict {
			t.Fatalf("want ASSESSMENT_CONFLICT, got %v", err)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatal(err)
		}
	})

	t.Run("module 1 still open is a conflict", func(t *testing.T) {
		svc, mock := staffRouteSvc(t)
		expectStaffRouteLockAndModuleOne(mock, "staff_selects", "active")
		mock.ExpectQuery(regexp.QuoteMeta("SELECT selected_route FROM assessment_route_decisions")).
			WithArgs("att-1", "sec-1").WillReturnRows(sqlmock.NewRows([]string{"r"}))
		mock.ExpectRollback()
		_, err := svc.AssignStaffRoute(ctx, "staff-1", "sched-1", "att-1", "math", "lower")
		if deliveryCodeOf(err) != apperrors.CodeAssessmentConflict {
			t.Fatalf("want ASSESSMENT_CONFLICT, got %v", err)
		}
	})

	t.Run("session that is not staff_selects is refused", func(t *testing.T) {
		svc, mock := staffRouteSvc(t)
		expectStaffRouteBegin(mock)
		mock.ExpectQuery(regexp.QuoteMeta("FROM student_attempts sa JOIN exam_schedules sch")).
			WillReturnRows(sqlmock.NewRows([]string{"policy", "sealed"}).AddRow("force_lower", false))
		mock.ExpectRollback()
		_, err := svc.AssignStaffRoute(ctx, "staff-1", "sched-1", "att-1", "math", "higher")
		if deliveryCodeOf(err) != apperrors.CodeAssessmentConflict {
			t.Fatalf("want ASSESSMENT_CONFLICT, got %v", err)
		}
	})

	// F3 (TC-10): a retry whose first response was lost must get the committed
	// outcome even after the student seals; only a new choice is refused.
	t.Run("replay of the committed choice after the attempt is sealed", func(t *testing.T) {
		svc, mock := staffRouteSvc(t)
		expectStaffRouteLockRow(mock, "staff_selects", true)
		expectStaffRouteModuleOne(mock, "submitted")
		mock.ExpectQuery(regexp.QuoteMeta("SELECT selected_route FROM assessment_route_decisions")).
			WithArgs("att-1", "sec-1").WillReturnRows(sqlmock.NewRows([]string{"r"}).AddRow("higher"))
		mock.ExpectQuery(regexp.QuoteMeta("SELECT selected_module_id FROM assessment_route_decisions")).
			WithArgs("att-1", "sec-1").WillReturnRows(sqlmock.NewRows([]string{"m"}).AddRow("mod-higher"))
		mock.ExpectCommit()
		out, err := svc.AssignStaffRoute(ctx, "staff-1", "sched-1", "att-1", "math", "higher")
		if err != nil || !out.Replayed || out.SelectedModuleID != "mod-higher" {
			t.Fatalf("identical repeat after seal must replay the decision, got %+v, %v", out, err)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatal(err)
		}
	})

	t.Run("sealed attempt with no decision is refused", func(t *testing.T) {
		svc, mock := staffRouteSvc(t)
		expectStaffRouteLockRow(mock, "staff_selects", true)
		expectStaffRouteModuleOne(mock, "locked")
		mock.ExpectQuery(regexp.QuoteMeta("SELECT selected_route FROM assessment_route_decisions")).
			WithArgs("att-1", "sec-1").WillReturnRows(sqlmock.NewRows([]string{"r"}))
		mock.ExpectRollback()
		_, err := svc.AssignStaffRoute(ctx, "staff-1", "sched-1", "att-1", "math", "higher")
		if deliveryCodeOf(err) != apperrors.CodeAssessmentConflict {
			t.Fatalf("want ASSESSMENT_CONFLICT, got %v", err)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatal(err)
		}
	})

	// F1 (spec 5.3 step 3): the plan fixes the section's branch, so a staff
	// choice of the other branch is refused and nothing is committed.
	t.Run("plan-shaped section refuses a branch the plan does not allow", func(t *testing.T) {
		svc, mock := staffRouteSvc(t)
		expectStaffRouteLockAndModuleOne(mock, "staff_selects", "locked")
		mock.ExpectQuery(regexp.QuoteMeta("SELECT selected_route FROM assessment_route_decisions")).
			WithArgs("att-1", "sec-1").WillReturnRows(sqlmock.NewRows([]string{"r"}))
		mock.ExpectQuery(regexp.QuoteMeta("SELECT COUNT(eq.id) FROM assessment_modules m LEFT JOIN assessment_exam_questions eq")).
			WithArgs("sec-1", "lower_branch").WillReturnRows(sqlmock.NewRows([]string{"n"}).AddRow(5))
		expectStaffNextModuleTxWithPlan(mock, "staff_selects", `{"math":"m1_hard"}`)
		mock.ExpectRollback()
		_, err := svc.AssignStaffRoute(ctx, "staff-1", "sched-1", "att-1", "math", "lower")
		if deliveryCodeOf(err) != apperrors.CodeValidation {
			t.Fatalf("want VALIDATION_ERROR for a plan-disallowed branch, got %v", err)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatal(err)
		}
	})

	t.Run("invalid route never opens a transaction", func(t *testing.T) {
		svc, _ := staffRouteSvc(t)
		if _, err := svc.AssignStaffRoute(ctx, "staff-1", "sched-1", "att-1", "math", "middle"); deliveryCodeOf(err) != apperrors.CodeValidation {
			t.Fatalf("want VALIDATION_ERROR, got %v", err)
		}
	})
}

// The first assignment commits the decision (classroom_staff_selects) and the
// Module 2 attempt, an audit row and the live event in one transaction.
func TestAssignStaffRouteCommitsDecisionAndModule(t *testing.T) {
	svc, mock := staffRouteSvc(t)
	expectStaffRouteLockAndModuleOne(mock, "staff_selects", "locked")
	mock.ExpectQuery(regexp.QuoteMeta("SELECT selected_route FROM assessment_route_decisions")).
		WithArgs("att-1", "sec-1").WillReturnRows(sqlmock.NewRows([]string{"r"}))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT COUNT(eq.id) FROM assessment_modules m")).
		WithArgs("sec-1", "higher_branch").WillReturnRows(sqlmock.NewRows([]string{"n"}).AddRow(22))
	expectStaffNextModuleTx(mock, "staff_selects")
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO assessment_route_decisions")).
		WithArgs(sqlmock.AnyArg(), "att-1", "sec-1", "ma-base", "mod-base", "mod-higher", "higher", 20, 25, "classroom_staff_selects", 1, sqlmock.AnyArg(), "staff_selected", "att-1", "mod-base", sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_modules m JOIN assessment_sections s ON s.id = m.section_id WHERE m.id = ?")).
		WithArgs("mod-higher").
		WillReturnRows(sqlmock.NewRows([]string{"id", "section_id", "section_key", "module_key", "duration_seconds", "adaptive_role", "tool_policy"}).
			AddRow("mod-higher", "sec-1", "math", "math-m2-higher", 2100, "higher_branch", nil))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT break_after_seconds FROM assessment_sections")).
		WithArgs("sec-1").WillReturnRows(sqlmock.NewRows([]string{"b"}).AddRow(0))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT UTC_TIMESTAMP(6)")).WillReturnRows(sqlmock.NewRows([]string{"now"}).AddRow(time.Now().UTC()))
	mock.ExpectQuery("timing_model").WithArgs("att-1", "att-1").
		WillReturnRows(sqlmock.NewRows([]string{"cohort", "personal"}).AddRow(0, 0))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO assessment_module_attempts")).
		WithArgs(sqlmock.AnyArg(), "att-1", "mod-higher", 2100, sqlmock.AnyArg(), "").
		WillReturnResult(sqlmock.NewResult(1, 1))
	deliverySATPolicyRead(mock, "att-1")
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO session_audit_logs")).
		WithArgs(sqlmock.AnyArg(), "sched-1", "staff-1", "att-1", sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT COALESCE(MAX(revision), 0) FROM assessment_module_attempts")).
		WithArgs("att-1").WillReturnRows(sqlmock.NewRows([]string{"rev"}).AddRow(3))
	mock.ExpectCommit()

	out, err := svc.AssignStaffRoute(context.Background(), "staff-1", "sched-1", "att-1", "math", "higher")
	if err != nil {
		t.Fatal(err)
	}
	if out.Replayed || out.Route != "higher" || out.SelectedModuleID != "mod-higher" {
		t.Fatalf("unexpected result %+v", out)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestListStaffRouteQueue(t *testing.T) {
	policyQ := regexp.QuoteMeta("SELECT COALESCE(sat_route_policy, 'adaptive') FROM exam_schedules WHERE id = ?")
	t.Run("other policies are disabled and run no queue query", func(t *testing.T) {
		db, mock, err := sqlmock.New()
		if err != nil {
			t.Fatal(err)
		}
		defer db.Close()
		mock.ExpectQuery(policyQ).WithArgs("sched-1").WillReturnRows(sqlmock.NewRows([]string{"p"}).AddRow("force_lower"))
		out, err := deliverySvc(db).ListStaffRouteQueue(context.Background(), "sched-1")
		if err != nil || out.Enabled || len(out.Items) != 0 {
			t.Fatalf("got %+v, %v", out, err)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatal(err)
		}
	})
	t.Run("staff_selects lists waiting students", func(t *testing.T) {
		db, mock, err := sqlmock.New()
		if err != nil {
			t.Fatal(err)
		}
		defer db.Close()
		mock.ExpectQuery(policyQ).WithArgs("sched-1").WillReturnRows(sqlmock.NewRows([]string{"p"}).AddRow("staff_selects"))
		mock.ExpectQuery("FROM student_attempts sa").WithArgs("sched-1").
			WillReturnRows(sqlmock.NewRows([]string{"id", "name", "key", "raw", "total"}).AddRow("att-1", "Ada", "math", 20, 22).AddRow("att-2", "Bo", "math", nil, nil))
		out, err := deliverySvc(db).ListStaffRouteQueue(context.Background(), "sched-1")
		if err != nil || !out.Enabled || len(out.Items) != 2 {
			t.Fatalf("got %+v, %v", out, err)
		}
		if out.Items[0].RawCorrect == nil || *out.Items[0].RawCorrect != 20 || out.Items[1].RawCorrect != nil {
			t.Fatalf("raw mapping wrong: %+v", out.Items)
		}
	})
}

// F1 at the finalize boundary (plan NT-2): a staff_selects attempt waits for
// staff even when the plan fixes its section's branch. A staff choice the plan
// does not allow still waits, so nothing is routed without a permitted staff choice.
func TestNextModuleTxStaffSelectsPlanShapeWaitsForStaff(t *testing.T) {
	cases := map[string]routeAudit{
		"no staff choice":                      {},
		"staff choice the plan does not allow": {staffRoute: "lower"},
	}
	for name, audit := range cases {
		t.Run(name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			svc := deliverySvc(db)
			mock.ExpectBegin()
			txn, err := db.BeginTx(context.Background(), nil)
			if err != nil {
				t.Fatal(err)
			}
			expectStaffNextModuleTxWithPlan(mock, "staff_selects", `{"math":"m1_hard"}`)

			next, err := svc.nextModuleTx(context.Background(), txn, "att-1", "ma-base", "mod-base", 20, 25, audit)
			if err != nil {
				t.Fatal(err)
			}
			if next == nil || !next.awaitingRoute || next.id != "" {
				t.Fatalf("staff_selects on a plan-shaped section must wait for staff, got %+v", next)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}
