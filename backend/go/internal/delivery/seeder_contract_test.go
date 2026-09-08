package delivery

// Plan E-honesty, round 82 (live rehearsal): bootstrap on a schedule
// whose pinned version HAS base modules seeded zero module rows —
// module-start then 404s. The seeder contract pins the two halves:
// (a) with a base module present it inserts exactly one not_started
// row; (b) with no base module present it is a silent no-op (the
// caller-visible symptom, not a seeder error — the gap is upstream
// data/shape, surfaced by the round-81 disambiguated 404).
import (
	"context"
	"regexp"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

func TestEnsureBaseModuleAttemptSeedsFirstBase(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := &Service{db: db}
	mock.ExpectQuery(regexp.QuoteMeta("SELECT id FROM assessment_module_attempts WHERE attempt_id = ?")).
		WithArgs("attempt-1").
		WillReturnRows(sqlmock.NewRows([]string{"id"}))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO assessment_module_attempts")).
		WithArgs(sqlmock.AnyArg(), "attempt-1", "mod-base-1", 3600).
		WillReturnResult(sqlmock.NewResult(1, 1))
	sections := []DeliverySection{{Modules: []DeliveryModule{
		{ID: "mod-base-1", AdaptiveRole: "base", DurationSeconds: 3600},
		{ID: "mod-branch-1", AdaptiveRole: "lower_branch", DurationSeconds: 3600},
	}}}
	if err := svc.ensureBaseModuleAttempt(context.Background(), "attempt-1", sections); err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestEnsureBaseModuleAttemptNoBaseIsNoop(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := &Service{db: db}
	mock.ExpectQuery(regexp.QuoteMeta("SELECT id FROM assessment_module_attempts WHERE attempt_id = ?")).
		WithArgs("attempt-1").
		WillReturnRows(sqlmock.NewRows([]string{"id"}))
	sections := []DeliverySection{{Modules: []DeliveryModule{
		{ID: "mod-branch-1", AdaptiveRole: "lower_branch", DurationSeconds: 3600},
	}}}
	if err := svc.ensureBaseModuleAttempt(context.Background(), "attempt-1", sections); err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
