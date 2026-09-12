package authoring

import (
	"context"
	"database/sql"
	"regexp"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/tx"
)

func codeOf(err error) apperrors.Code {
	if e, ok := apperrors.As(err); ok {
		return e.Code
	}
	return ""
}

func begin(mock sqlmock.Sqlmock) {
	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta("SET time_zone")).WillReturnResult(sqlmock.NewResult(0, 0))
}

// ListQuestions on a missing module rejects with NOT_FOUND before listing.
func TestListQuestionsModuleNotFound(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	s := NewService(db, tx.NewRunner(db))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_modules")).
		WithArgs("missing-module").
		WillReturnError(sql.ErrNoRows)
	if _, err := s.ListQuestions(context.Background(), "missing-module"); codeOf(err) != apperrors.CodeNotFound {
		t.Fatalf("expected NOT_FOUND on missing module, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// OpenShell with an existing draft shortcuts to Shell without cloning:
// the tx only reads the locked exam row, commits, then the bulk Shell
// projects (single identity JOIN + sections short-circuit for the empty
// draft). Phase 03 keeps the single write Tx (option (a)): the FOR UPDATE on
// the exam row serializes concurrent opens, so exactly one opener can win the
// pointer CAS and every loser either sees the winner's draft or takes the
// documented 409 — proven live by TestOpenShellConcurrentSingleClone.
func TestOpenShellDraftShortcut(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	s := NewService(db, tx.NewRunner(db))
	begin(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM exam_entities WHERE id = ? FOR UPDATE")).
		WithArgs("exam-1").
		WillReturnRows(sqlmock.NewRows([]string{"provider_key", "current_draft_version_id", "current_published_version_id"}).
			AddRow("sat", "draft-v1", nil))
	mock.ExpectCommit()
	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta("SELECT e.provider_key, e.current_draft_version_id, v.revision")).
		WithArgs("exam-1").
		WillReturnRows(sqlmock.NewRows([]string{"provider_key", "current_draft_version_id", "revision"}).
			AddRow("sat", "draft-v1", 3))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_sections WHERE exam_version_id = ?")).
		WithArgs("draft-v1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "section_key", "title", "display_order", "duration_seconds", "break_after_seconds", "revision"}))
	mock.ExpectRollback()
	shell, err := s.OpenShell(context.Background(), "exam-1", "actor-1")
	if err != nil {
		t.Fatalf("OpenShell draft shortcut must succeed: %v", err)
	}
	if shell.ExamID != "exam-1" || shell.VersionID != "draft-v1" || shell.ProviderKey != "sat" || shell.VersionRevision != 3 {
		t.Fatalf("unexpected shortcut shell: %+v", shell)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
