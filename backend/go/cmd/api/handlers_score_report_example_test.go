package main

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"example.com/ielts-proctoring/internal/answeredpdf"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"github.com/DATA-DOG/go-sqlmock"
)

func TestScoreReportExampleRenderErrors(t *testing.T) {
	tests := []struct {
		name       string
		err        error
		status     int
		message    string
		retryAfter string
	}{
		{"deadline", fmt.Errorf("print readiness: %w", context.DeadlineExceeded), http.StatusServiceUnavailable,
			"The score report example took too long. Please retry.", "2"},
		{"busy", answeredpdf.ErrBusy, http.StatusTooManyRequests, "RATE_LIMIT_EXCEEDED", "5"},
		{"incomplete", answeredpdf.ErrNotPrintable, http.StatusUnprocessableEntity,
			"The answered exam could not be printed completely.", ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			writeScoreReportExampleError(w, httptest.NewRequest(http.MethodGet, "/", nil), tt.err)
			if w.Code != tt.status || !strings.Contains(w.Body.String(), tt.message) ||
				w.Header().Get("Retry-After") != tt.retryAfter {
				t.Fatalf("status=%d headers=%v body=%s", w.Code, w.Header(), w.Body.String())
			}
		})
	}
}

func TestScoreReportExampleVersionUsesDraftThenPublished(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	app := &App{DB: db}

	mock.ExpectQuery("SELECT COALESCE").WithArgs("exam-draft").
		WillReturnRows(sqlmock.NewRows([]string{"version"}).AddRow("draft-1"))
	got, err := scoreReportExampleVersion(t.Context(), app, "exam-draft")
	if err != nil || got != "draft-1" {
		t.Fatalf("draft version: got %q err %v", got, err)
	}

	mock.ExpectQuery("SELECT COALESCE").WithArgs("exam-none").
		WillReturnRows(sqlmock.NewRows([]string{"version"}).AddRow(nil))
	if _, err := scoreReportExampleVersion(t.Context(), app, "exam-none"); err == nil {
		t.Fatal("an exam with no draft and no published version must be refused")
	} else if typed, ok := apperrors.As(err); !ok || typed.Code != apperrors.CodeValidation {
		t.Fatalf("want validation, got %v", err)
	}

	mock.ExpectQuery("SELECT COALESCE").WithArgs("exam-missing").WillReturnError(sql.ErrNoRows)
	if _, err := scoreReportExampleVersion(t.Context(), app, "exam-missing"); err == nil {
		t.Fatal("a missing exam must be refused")
	} else if typed, ok := apperrors.As(err); !ok || typed.Code != apperrors.CodeNotFound {
		t.Fatalf("want not found, got %v", err)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
