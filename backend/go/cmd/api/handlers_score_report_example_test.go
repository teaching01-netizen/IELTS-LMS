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
	"example.com/ielts-proctoring/internal/platform/objectstore"
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
		WillReturnRows(sqlmock.NewRows([]string{"version", "version_revision", "exam_revision", "layout_revision"}).
			AddRow("draft-1", 7, 12, 3))
	version, versionRevision, examRevision, layoutRevision, err := scoreReportExampleVersion(t.Context(), app, "exam-draft")
	if err != nil || version != "draft-1" || versionRevision != 7 || examRevision != 12 || layoutRevision != 3 {
		t.Fatalf("draft version: %q %d %d %d err %v", version, versionRevision, examRevision, layoutRevision, err)
	}

	mock.ExpectQuery("SELECT COALESCE").WithArgs("exam-none").
		WillReturnRows(sqlmock.NewRows([]string{"version", "version_revision", "exam_revision", "layout_revision"}).
			AddRow(nil, 0, 0, 0))
	if _, _, _, _, err := scoreReportExampleVersion(t.Context(), app, "exam-none"); err == nil {
		t.Fatal("an exam with no draft and no published version must be refused")
	} else if typed, ok := apperrors.As(err); !ok || typed.Code != apperrors.CodeValidation {
		t.Fatalf("want validation, got %v", err)
	}

	mock.ExpectQuery("SELECT COALESCE").WithArgs("exam-missing").WillReturnError(sql.ErrNoRows)
	if _, _, _, _, err := scoreReportExampleVersion(t.Context(), app, "exam-missing"); err == nil {
		t.Fatal("a missing exam must be refused")
	} else if typed, ok := apperrors.As(err); !ok || typed.Code != apperrors.CodeNotFound {
		t.Fatalf("want not found, got %v", err)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestScoreReportExampleCacheRoundTrip(t *testing.T) {
	store := objectstore.NewLocalStore(t.TempDir())
	key := scoreReportExampleCacheKey("exam-1", "v1", 7, 12, 3, "SAT Practice 04")

	if _, ok := readCachedScoreReportExample(t.Context(), store, "exam-1", key); ok {
		t.Fatal("an empty cache must miss")
	}
	writeCachedScoreReportExample(t.Context(), store, "exam-1", key, []byte("%PDF-1.7 example"))
	pdf, ok := readCachedScoreReportExample(t.Context(), store, "exam-1", key)
	if !ok || string(pdf) != "%PDF-1.7 example" {
		t.Fatalf("cache hit = %v %q", ok, pdf)
	}

	other := scoreReportExampleCacheKey("exam-1", "v1", 8, 12, 3, "SAT Practice 04")
	if _, ok := readCachedScoreReportExample(t.Context(), store, "exam-1", other); ok {
		t.Fatal("a newer revision must miss the old artifact")
	}
	writeCachedScoreReportExample(t.Context(), store, "exam-1", other, []byte("new"))
	if pdf, ok := readCachedScoreReportExample(t.Context(), store, "exam-1", other); !ok || string(pdf) != "new" {
		t.Fatalf("new revision did not cache: %q %v", pdf, ok)
	}
}

func TestScoreReportExampleCacheKeyTracksEveryInput(t *testing.T) {
	base := scoreReportExampleCacheKey("exam-1", "v1", 7, 12, 3, "Practice")
	for name, changed := range map[string]string{
		"exam":     scoreReportExampleCacheKey("exam-2", "v1", 7, 12, 3, "Practice"),
		"version":  scoreReportExampleCacheKey("exam-1", "v2", 7, 12, 3, "Practice"),
		"content":  scoreReportExampleCacheKey("exam-1", "v1", 8, 12, 3, "Practice"),
		"metadata": scoreReportExampleCacheKey("exam-1", "v1", 7, 13, 3, "Practice"),
		"layout":   scoreReportExampleCacheKey("exam-1", "v1", 7, 12, 4, "Practice"),
		"title":    scoreReportExampleCacheKey("exam-1", "v1", 7, 12, 3, "Practice 2"),
	} {
		if changed == base {
			t.Fatalf("%s does not change the cache key", name)
		}
	}
}
