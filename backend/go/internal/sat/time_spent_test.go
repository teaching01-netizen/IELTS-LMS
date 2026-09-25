package sat

// Time accounting remains available to the retained scoring utilities, though
// SAT completion no longer derives or persists a score.
import (
	"context"
	"database/sql"
	"math"
	"regexp"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/platform/tx"
)

// inTx runs one helper inside a sqlmock-backed transaction. Callers register
// satBegin(mock) first so the expectations stay in execution order.
func inTx(db *sql.DB, fn func(ctx context.Context, q tx.Tx) error) error {
	return tx.NewRunner(db).WithTxRCRetry(context.Background(), 1, fn)
}

// The derivation query must ask the database for the pause-aware expression —
// a plain TIMESTAMPDIFF would over-report every paused-student attempt.
func TestTimeSpentDerivationUsesAuthoritativeModuleTiming(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	satBegin(mock)
	mock.ExpectQuery(regexp.QuoteMeta("SUM(GREATEST(TIMESTAMPDIFF(SECOND, started_at, COALESCE(submitted_at, paused_at, UTC_TIMESTAMP(6))) - accumulated_paused_seconds, 0)) FROM assessment_module_attempts WHERE attempt_id = ? AND started_at IS NOT NULL")).
		WithArgs("att-1").
		WillReturnRows(sqlmock.NewRows([]string{"seconds"}).AddRow(int64(600)))
	mock.ExpectCommit()

	var got int64
	if err := inTx(db, func(ctx context.Context, q tx.Tx) error {
		value, err := loadTimeSpentSeconds(ctx, q, "att-1")
		got = value
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if got != 600 {
		t.Fatalf("time spent = %d, want 600", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// A negative aggregate (clock skew between modules) clamps to zero instead of
// persisting a nonsensical negative duration into a signed INT column.
func TestTimeSpentClampsNegativeAggregate(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	satBegin(mock)
	mock.ExpectQuery(regexp.QuoteMeta("started_at IS NOT NULL")).
		WillReturnRows(sqlmock.NewRows([]string{"seconds"}).AddRow(int64(-90)))
	mock.ExpectCommit()

	var got int64
	if err := inTx(db, func(ctx context.Context, q tx.Tx) error {
		value, err := loadTimeSpentSeconds(ctx, q, "att-1")
		got = value
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if got != 0 {
		t.Fatalf("negative aggregate must clamp to 0, got %d", got)
	}
	if math.Signbit(float64(got)) {
		t.Fatal("duration must never be negative")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
