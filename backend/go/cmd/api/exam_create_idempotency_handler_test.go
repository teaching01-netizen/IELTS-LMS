package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/exams"
	"example.com/ielts-proctoring/internal/platform/tx"
	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

func TestExamsCreateHandlerPassesIdempotencyHeaderToActorScopedClaim(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	app := &App{Exams: exams.NewService(db, tx.NewRunner(db))}

	const actorID = "admin-1"
	const operationKey = "sat-create-retry"
	mock.ExpectBegin()
	mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec("INSERT IGNORE INTO authoring_operation_keys").
		WithArgs(actorID, "exam-create", operationKey, sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery("SELECT request_hash, result_json FROM authoring_operation_keys").
		WithArgs(actorID, "exam-create", operationKey).
		WillReturnRows(sqlmock.NewRows([]string{"request_hash", "result_json"}).AddRow(strings.Repeat("a", 64), []byte(`{"id":"prior-exam"}`)))
	mock.ExpectRollback()

	req := httptest.NewRequest(http.MethodPost, "/v1/exams", strings.NewReader(`{
		"slug":"retryable-sat",
		"title":"Retryable SAT",
		"examType":"Academic",
		"visibility":"private",
		"providerKey":"sat"
	}`))
	req.Header.Set("Idempotency-Key", operationKey)
	req = req.WithContext(sessionCtx(req.Context(), &auth.Session{UserID: actorID, Role: auth.RoleAdmin}))
	rec := httptest.NewRecorder()
	examsCreateHandler(app)(rec, req)
	if rec.Code != http.StatusConflict {
		t.Fatalf("different payload for a claimed key should return 409, got %d: %s", rec.Code, rec.Body.String())
	}
	var response struct {
		Code string `json:"code"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode conflict response: %v", err)
	}
	if response.Code != "CONFLICT" {
		t.Fatalf("conflict response code = %q, want CONFLICT", response.Code)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
