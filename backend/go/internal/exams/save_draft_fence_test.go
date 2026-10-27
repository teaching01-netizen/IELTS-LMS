package exams

import (
	"context"
	"regexp"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/tx"
)

// The draft pointer can move to another version with the same revision
// between an editor's load and its save. The expected version id is checked
// under the same row lock as the revision, so that save conflicts instead of
// overwriting the other version.
func TestSaveDraftRejectsAnotherDraftVersionWithTheSameRevision(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	s := NewService(db, tx.NewRunner(db))

	reopenBegin(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM exam_versions v JOIN exam_entities e")).
		WithArgs("exam-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "revision", "config"}).AddRow("ver-new", 3, "{}"))
	mock.ExpectRollback()

	expected := "ver-loaded"
	_, err = s.SaveDraft(context.Background(), "exam-1", "actor-1", SaveDraftRequest{
		Content:                []byte(`{"title":"x"}`),
		Config:                 []byte(`{}`),
		Revision:               3,
		ExpectedDraftVersionID: &expected,
	})
	appErr, ok := err.(*apperrors.Error)
	if !ok || appErr.Code != apperrors.CodeConflict {
		t.Fatalf("expected a conflict, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
