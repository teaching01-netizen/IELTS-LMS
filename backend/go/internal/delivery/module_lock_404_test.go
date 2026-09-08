package delivery

// Plan E-honesty, round 81 (live rehearsal): StartModule's module-row
// lock returned "Attempt not found." when the MODULE row was missing —
// indistinguishable from a bad attempt id, even though attempt binding
// had already passed. Two live hours burned on this masquerade. The
// lock miss must name the module row, never the attempt.
import (
	"context"
	"regexp"
	"strings"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/tx"
)

func TestModuleLockMissNamesModuleNotAttempt(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := NewService(db, tx.NewRunner(db))
	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta("SET time_zone")).WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_module_attempts WHERE attempt_id = ? AND module_id = ? FOR UPDATE")).
		WithArgs("attempt-1", "module-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "module_id", "state", "allocated_seconds", "available_at", "started_at", "paused_at", "accumulated_paused_seconds", "extension_seconds", "completion_reason"}))
	mock.ExpectRollback()
	err = svc.runner.WithTx(context.Background(), func(ctx context.Context, q tx.Tx) error {
		_, lerr := lockModuleAttemptTx(ctx, q, "attempt-1", "module-1")
		return lerr
	})
	if err == nil {
		t.Fatalf("lock miss must fail")
	}
	e, ok := apperrors.As(err)
	if !ok {
		t.Fatalf("lock miss must be a typed error, got %T (%v)", err, err)
	}
	if e.HTTPStatus != 404 {
		t.Fatalf("lock miss must stay 404, got %d", e.HTTPStatus)
	}
	if strings.Contains(e.Message, "Attempt not found") {
		t.Fatalf("lock miss must not masquerade as attempt-404, got %q", e.Message)
	}
	if !strings.Contains(strings.ToLower(e.Message), "module") {
		t.Fatalf("lock miss must name the module row, got %q", e.Message)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
