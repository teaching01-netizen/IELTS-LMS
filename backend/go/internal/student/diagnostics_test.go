package student

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"github.com/DATA-DOG/go-sqlmock"
)

func TestDiagnosticRejectsPrivatePayloadBeforePersistence(t *testing.T) {
	db, _, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	err = NewService(db, nil).RecordAudit(context.Background(), AuditRequest{
		AttemptID: "attempt", ScheduleID: "room", ActorUserID: "student", ActionType: "STUDENT_DIAGNOSTIC",
		Payload: json.RawMessage(`{"eventId":"63dc3b48-c2d6-48ae-8354-af6c67ae7196","event":"mounted","occurredAt":"2026-11-05T13:46:25Z","version":"test","pageId":"a0e57b2f-42d2-4bdf-a1d2-dab56c8a8adb","answers":{"q1":"B"}}`),
	})
	var appErr *apperrors.Error
	if !errors.As(err, &appErr) || appErr.Code != apperrors.CodeValidation {
		t.Fatalf("expected validation rejection, got %v", err)
	}
}

func TestDiagnosticRechecksWriterAfterAuthentication(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectBegin()
	mock.ExpectQuery("FROM student_attempts WHERE id = .* AND schedule_id = .* FOR UPDATE").WithArgs("attempt", "room").WillReturnRows(
		sqlmock.NewRows([]string{"id", "schedule_id", "student_key", "user_id", "candidate_name", "active_client_session_id", "recovery_control", "integrity", "recovery", "violations_snapshot"}).AddRow("attempt", "room", "student", "user", "Candidate", "new-writer", "", "{}", "{}", "[]"))
	mock.ExpectRollback()
	err = NewService(db, nil).RecordAudit(context.Background(), AuditRequest{AttemptID: "attempt", ScheduleID: "room", ActorUserID: "user", ClientSessionID: "old-writer", ActionType: "STUDENT_DIAGNOSTIC",
		Payload: json.RawMessage(`{"eventId":"63dc3b48-c2d6-48ae-8354-af6c67ae7196","event":"mounted","occurredAt":"2026-11-05T13:46:25Z","version":"test","pageId":"a0e57b2f-42d2-4bdf-a1d2-dab56c8a8adb"}`)})
	var appErr *apperrors.Error
	if !errors.As(err, &appErr) || appErr.Code != apperrors.CodeActiveSessionSuperseded {
		t.Fatalf("expected writer fence, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
