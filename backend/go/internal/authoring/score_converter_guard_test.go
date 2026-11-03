package authoring

import (
	"context"
	"encoding/json"
	"regexp"
	"strings"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/tx"
)

// FR-6: SetScoreConverter mirrors the creation rule — attaching a converter
// to a flexible or M1-only draft is refused with the creation message, while
// the clear (raw-only) path and strict drafts are untouched.

const guardConverter = `{"converterVersion":"classroom-v1","scoreType":"estimated_sat","calibrationSource":"staff_approved","sections":{},"tables":{}}`

const converterMirrorMessage = "Score converter is not supported for flexible or M1-only SAT exams; they report raw scores only."

func expectConverterDraft(mock sqlmock.Sqlmock, planRaw any, flexible int64) {
	mock.ExpectQuery(regexp.QuoteMeta("SELECT v.id FROM exam_versions v JOIN exam_entities e")).
		WithArgs("exam-1").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("draft-1"))
	mock.ExpectQuery("sat_classroom_plan").WithArgs("draft-1").
		WillReturnRows(sqlmock.NewRows([]string{"plan"}).AddRow(planRaw))
	mock.ExpectQuery("sat_flexible_count").WithArgs("draft-1").
		WillReturnRows(sqlmock.NewRows([]string{"sat_flexible_count"}).AddRow(flexible))
}

func expectConverterStored(mock sqlmock.Sqlmock, key, stored string) {
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO assessment_scoring_policies")).
		WithArgs(sqlmock.AnyArg(), "draft-1", key, stored).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE exam_versions SET revision = revision + 1")).
		WithArgs("draft-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
}

func TestSetScoreConverterRefusesFlaggedDraft(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := NewService(db, tx.NewRunner(db))

	begin(mock)
	expectConverterDraft(mock, nil, 1)
	mock.ExpectRollback()

	_, err = svc.SetScoreConverter(context.Background(), "exam-1", json.RawMessage(guardConverter))
	appErr, ok := apperrors.As(err)
	if !ok || appErr.Code != apperrors.CodeValidation || messageOf(t, err) != converterMirrorMessage {
		t.Fatalf("flagged attach must mirror the creation message, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestSetScoreConverterRefusesM1OnlyDraft(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := NewService(db, tx.NewRunner(db))

	begin(mock)
	expectConverterDraft(mock, `{"math":"m1_only"}`, 0)
	mock.ExpectRollback()

	_, err = svc.SetScoreConverter(context.Background(), "exam-1", json.RawMessage(guardConverter))
	if err == nil || !strings.Contains(err.Error(), "raw scores only") {
		t.Fatalf("m1_only attach must be refused, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestSetScoreConverterStrictDraftAttach(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := NewService(db, tx.NewRunner(db))

	begin(mock)
	expectConverterDraft(mock, nil, 0)
	expectConverterStored(mock, "estimated_sat", guardConverter)

	got, err := svc.SetScoreConverter(context.Background(), "exam-1", json.RawMessage(guardConverter))
	if err != nil {
		t.Fatalf("strict attach must pass, got %v", err)
	}
	if string(got) != guardConverter {
		t.Fatalf("strict attach must echo the converter, got %s", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestSetScoreConverterClearOnFlaggedDraft(t *testing.T) {
	// Clearing back to raw-only stays open on flagged drafts: no plan or
	// flag read, just the raw_only upsert.
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := NewService(db, tx.NewRunner(db))

	begin(mock)
	mock.ExpectQuery(regexp.QuoteMeta("SELECT v.id FROM exam_versions v JOIN exam_entities e")).
		WithArgs("exam-1").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("draft-1"))
	expectConverterStored(mock, "raw_only", "{}")

	got, err := svc.SetScoreConverter(context.Background(), "exam-1", nil)
	if err != nil || got != nil {
		t.Fatalf("clear on a flagged draft must pass raw-only, got %v, %v", got, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
