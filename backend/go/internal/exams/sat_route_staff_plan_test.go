package exams

import (
	"context"
	"regexp"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/platform/apperrors"
)

// F1 (docs/plans/2026-10-13-sat-classroom-formal-verification-plan.md): a
// staff_selects session on a plan-shaped section would route the student at
// Module 1 close with no staff decision, so creation must refuse it.
func TestPersistSATSessionStaffSelectsRejectsPlanShape(t *testing.T) {
	ctx := context.Background()
	newDB := func(t *testing.T) (sqlmock.Sqlmock, RoutePolicyExecer) {
		db, mock, err := sqlmock.New()
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { db.Close() })
		return mock, db
	}

	t.Run("plan-shaped section is refused and nothing is written", func(t *testing.T) {
		mock, db := newDB(t)
		mock.ExpectQuery("sat_classroom_plan").WithArgs("v1").WillReturnRows(sqlmock.NewRows([]string{"plan"}).AddRow(`{"math":"m1_hard"}`))
		err := PersistSATSession(ctx, db, "s1", "sat", "v1", SATSession{Classroom: true, Route: SATRouteStaffSelects}, nil)
		if apperr, ok := apperrors.As(err); !ok || apperr.Code != apperrors.CodeValidation {
			t.Fatalf("staff_selects on a plan-shaped section must be a validation error, got %v", err)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatal(err)
		}
	})
	t.Run("plan-shaped section outside the run scope is allowed", func(t *testing.T) {
		mock, db := newDB(t)
		mock.ExpectQuery("sat_classroom_plan").WithArgs("v1").WillReturnRows(sqlmock.NewRows([]string{"plan"}).AddRow(`{"math":"m1_hard"}`))
		mock.ExpectExec(regexp.QuoteMeta("UPDATE exam_schedules SET sat_session_mode = 'classroom', sat_route_policy = ? WHERE id = ?")).
			WithArgs("staff_selects", "s1").WillReturnResult(sqlmock.NewResult(0, 1))
		if err := PersistSATSession(ctx, db, "s1", "sat", "v1", SATSession{Classroom: true, Route: SATRouteStaffSelects}, map[string]bool{LinkSectionReadingWriting: true}); err != nil {
			t.Fatalf("out-of-scope plan must not block staff_selects: %v", err)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatal(err)
		}
	})
}
