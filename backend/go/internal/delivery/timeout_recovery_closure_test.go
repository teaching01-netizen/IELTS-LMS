package delivery

// Timeout-recovery closure at the adaptive route decision.
//
// Recovery rescored a locked/time_expired module through
// repairTimeoutFinalizedModuleTx while assessment_route_decisions kept the
// branch it had already chosen. In cohort timing the successor module is
// inserted not_started, so the "downstream started" check stayed open and the
// module's score could move away from the stored route.

import (
	"context"
	"errors"
	"regexp"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/platform/apperrors"
)

func recoveryConflictReason(err error) string {
	var appErr *apperrors.Error
	if !errors.As(err, &appErr) || appErr.Details == nil {
		return ""
	}
	reason, _ := appErr.Details["reason"].(string)
	return reason
}

func timeoutRecoveryFixture(t *testing.T, routeDecided int) error {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := deliverySvc(db)
	mock.ExpectBegin()
	txn, txerr := db.BeginTx(context.Background(), nil)
	if txerr != nil {
		t.Fatal(txerr)
	}

	mock.ExpectQuery(regexp.QuoteMeta("SELECT EXISTS(SELECT 1 FROM student_submissions WHERE attempt_id = ? AND provider_key = 'sat')")).
		WithArgs("att-1").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(0))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT EXISTS(SELECT 1 FROM assessment_module_attempts downstream")).
		WithArgs("mod-base", "att-1").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(0))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT EXISTS(SELECT 1 FROM assessment_route_decisions WHERE attempt_id = ? AND base_module_attempt_id = ?)")).
		WithArgs("att-1", "ma-base").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(routeDecided))
	if routeDecided == 0 {
		// A decided route short-circuits before the cohort-clock read, so this
		// expectation exists only for the control case.
		mock.ExpectQuery(regexp.QuoteMeta("SELECT timing_model FROM exam_session_runtimes WHERE schedule_id = ? FOR SHARE")).
			WithArgs("sched-1").
			WillReturnRows(sqlmock.NewRows([]string{"timing_model"}).AddRow("legacy_section_v1"))
	}

	reason := "time_expired"
	module := saveActiveModule{
		id:               "ma-base",
		moduleID:         "mod-base",
		state:            "locked",
		completionReason: &reason,
	}
	err = svc.ensureTimeoutResponseRecoveryTx(
		context.Background(), txn, "sched-1", "att-1", module, time.Now().UTC(), SaveResponseRequest{})
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
	return err
}

// A routed base module closes recovery: the decision row is what proves the
// score and the branch can no longer be reconciled with each other.
func TestTimeoutRecoveryClosedAfterRouteDecision(t *testing.T) {
	err := timeoutRecoveryFixture(t, 1)
	if err == nil {
		t.Fatal("recovery must be closed once the adaptive route is decided")
	}
	if got := recoveryConflictReason(err); got != "TIMEOUT_RECOVERY_CLOSED" {
		t.Fatalf("reason = %q, want TIMEOUT_RECOVERY_CLOSED", got)
	}
}

// Control: without a route decision the same input passes the new gate and
// fails later on the module clock, proving the gate — not the fixture — is what
// rejected the routed case above.
func TestTimeoutRecoveryStaysOpenUntilRouteDecisionExists(t *testing.T) {
	err := timeoutRecoveryFixture(t, 0)
	if err == nil {
		t.Fatal("a never-started module must still be refused")
	}
	if got := recoveryConflictReason(err); got != "RUNTIME_NOT_LIVE" {
		t.Fatalf("reason = %q, want RUNTIME_NOT_LIVE", got)
	}
}
