package exams

import (
	"context"
	"testing"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

func TestPublishCannotWidenSATExamSectionScope(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectBegin()
	q, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	mock.ExpectQuery("SELECT v.id, v.version_number").WillReturnRows(sqlmock.NewRows([]string{"id", "version_number", "content", "config", "revision", "provider", "exam_type", "organization_id", "sat_section_scope"}).AddRow("draft", 1, "{}", "{}", 0, "sat", "Academic", nil, "reading-writing"))
	_, err = (&Service{}).publishDraftTx(context.Background(), q, "staff", "exam", PublishRequest{}, SATPublishScopeFull, "", 0, "", &eventEmission{})
	typed, ok := apperrors.As(err)
	if !ok || typed.Code != apperrors.CodeExamScopeUnavailable {
		t.Fatalf("scope unavailable required, got %v", err)
	}
	mock.ExpectRollback()
	if err := q.Rollback(); err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
