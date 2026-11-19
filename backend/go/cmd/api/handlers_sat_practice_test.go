package main

import (
	"net/http"
	"net/http/httptest"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
	"github.com/go-chi/chi/v5"

	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/platform/tx"
	"example.com/ielts-proctoring/internal/schedules"
)

func TestPracticeLearningStateRequiresIdentityProof(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	app := &App{DB: db, Schedules: schedules.NewService(db, tx.NewRunner(db))}
	router := chi.NewRouter()
	router.Get("/practice/schedules/{scheduleID}/learning-state", practiceLearningStateHandler(app))
	request := httptest.NewRequest(http.MethodGet, "/practice/schedules/practice-1/learning-state", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, request)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401: %s", rec.Code, rec.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestPracticeStartRequiresIdentityProof(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	app := &App{DB: db, Schedules: schedules.NewService(db, tx.NewRunner(db))}
	router := chi.NewRouter()
	router.Post("/practice/schedules/{scheduleID}/attempts", practiceStartHandler(app))
	request := httptest.NewRequest(http.MethodPost, "/practice/schedules/practice-1/attempts",
		http.NoBody)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, request)
	if rec.Code != http.StatusServiceUnavailable && rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401 or 503: %s", rec.Code, rec.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// A matching practice-session token must produce a plain nil, not a typed nil
// *apperrors.Error carried as a non-nil error interface.
func TestPracticeCSRFMatchingTokenReturnsPlainNil(t *testing.T) {
	request := httptest.NewRequest(http.MethodPost, "/practice/schedules/practice-1/attempts", http.NoBody)
	request.Header.Set("x-csrf-token", "session-token")
	identity := practiceIdentity{Session: &auth.Session{CSRFToken: "session-token"}}
	if err := requirePracticeCSRF(request, identity); err != nil {
		t.Fatalf("matching CSRF returned %#v", err)
	}
	request.Header.Set("x-csrf-token", "wrong")
	if err := requirePracticeCSRF(request, identity); err == nil {
		t.Fatal("a mismatched CSRF token must be rejected")
	}
}
