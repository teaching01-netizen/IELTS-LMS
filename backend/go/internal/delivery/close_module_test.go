package delivery

import (
	"context"
	"database/sql"
	"testing"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

func TestPendingCloseWritesValidatesMembershipAndVersions(t *testing.T) {
	for _, tc := range []struct {
		name       string
		rows       *sqlmock.Rows
		version    int64
		validation bool
		pending    int
	}{
		{"acknowledged", sqlmock.NewRows([]string{"id", "client_version"}).AddRow("q1", 4), 4, false, 0},
		{"newer acknowledged", sqlmock.NewRows([]string{"id", "client_version"}).AddRow("q1", 5), 4, false, 0},
		{"unsaved module question", sqlmock.NewRows([]string{"id", "client_version"}).AddRow("q1", nil), 4, false, 1},
		{"older write", sqlmock.NewRows([]string{"id", "client_version"}).AddRow("q1", 3), 4, false, 1},
		{"unsaved foreign question", sqlmock.NewRows([]string{"id", "client_version"}), 4, true, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			mock.ExpectBegin()
			tx, err := db.BeginTx(context.Background(), &sql.TxOptions{})
			if err != nil {
				t.Fatal(err)
			}
			mock.ExpectQuery("FROM assessment_exam_questions eq LEFT JOIN attempt_responses_v2").WithArgs("a1", "m1", "q1").WillReturnRows(tc.rows)
			pending, err := pendingCloseWritesTx(context.Background(), tx, "a1", "m1", []ModuleCloseAnswer{{QuestionID: "q1", ClientVersion: tc.version}})
			if tc.validation {
				e, ok := apperrors.As(err)
				if !ok || e.Code != apperrors.CodeValidation {
					t.Fatalf("expected validation, got %v", err)
				}
			} else if err != nil || len(pending) != tc.pending {
				t.Fatalf("pending=%v err=%v", pending, err)
			}
			mock.ExpectRollback()
			_ = tx.Rollback()
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestPendingCloseWritesRejectsDuplicateAndInvalidEntries(t *testing.T) {
	for _, entries := range [][]ModuleCloseAnswer{
		{{QuestionID: "q1", ClientVersion: 0}},
		{{QuestionID: "", ClientVersion: 1}},
		{{QuestionID: "q1", ClientVersion: 1}, {QuestionID: "q1", ClientVersion: 2}},
	} {
		// Invalid manifests fail before any database access.
		_, err := pendingCloseWritesTx(context.Background(), nil, "a1", "m1", entries)
		e, ok := apperrors.As(err)
		if !ok || e.Code != apperrors.CodeValidation {
			t.Fatalf("expected validation, got %v", err)
		}
	}
}
