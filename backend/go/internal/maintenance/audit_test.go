package maintenance

// Plan E-exam-day: the invariant audit is the integrity signal — every
// violated invariant must surface as an InvariantIssue carrying its
// low-cardinality name (the worker counts MInvariantViol{name} per
// issue). Clean DB returns zero issues; a violation returns exactly it.
// RED: both shapes.
import (
	"context"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

func TestAuditInvariantsClean(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	for i := 0; i < 3; i++ {
		mock.ExpectQuery("SELECT COUNT").
			WillReturnRows(sqlmock.NewRows([]string{"n"}).AddRow(int64(0)))
	}
	issues, err := AuditInvariants(context.Background(), db)
	if err != nil {
		t.Fatalf("clean audit: %v", err)
	}
	if len(issues) != 0 {
		t.Fatalf("clean DB must yield zero issues, got %+v", issues)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestAuditInvariantsViolation(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectQuery("SELECT COUNT").
		WillReturnRows(sqlmock.NewRows([]string{"n"}).AddRow(int64(3)))
	mock.ExpectQuery("SELECT COUNT").
		WillReturnRows(sqlmock.NewRows([]string{"n"}).AddRow(int64(0)))
	mock.ExpectQuery("SELECT COUNT").
		WillReturnRows(sqlmock.NewRows([]string{"n"}).AddRow(int64(0)))
	issues, err := AuditInvariants(context.Background(), db)
	if err != nil {
		t.Fatalf("audit: %v", err)
	}
	if len(issues) != 1 || issues[0].Name != "terminal_attempt_without_receipt" || issues[0].Count != 3 {
		t.Fatalf("must surface exactly the violated invariant, got %+v", issues)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
