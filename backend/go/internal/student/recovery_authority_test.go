package student

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	examdomain "example.com/ielts-proctoring/internal/exams"
	"example.com/ielts-proctoring/internal/platform/apperrors"
)

func TestV1RecoveryHoldCannotClaimEmptyWriter(t *testing.T) {
	for _, phase := range []string{examdomain.RecoveryPhaseHeld, examdomain.RecoveryPhaseReturning} {
		t.Run(phase, func(t *testing.T) {
			row := v1AttemptRow{ID: "attempt-1", RecoveryControl: &examdomain.RecoveryControl{Phase: phase}}
			// A nil SQL handle proves refusal precedes any owner-claim statement.
			_, err := ensureV1ClientSession(context.Background(), nil, row, "old-browser")
			var appErr *apperrors.Error
			if !errors.As(err, &appErr) || appErr.Details["reason"] != "RECOVERY_HELD" {
				t.Fatalf("err=%v", err)
			}
		})
	}
}

func TestV1RecoveryWorkingRejectsPreviousBrowser(t *testing.T) {
	row := v1AttemptRow{ID: "attempt-1", RecoveryControl: &examdomain.RecoveryControl{Phase: examdomain.RecoveryPhaseWorking}, ActiveClientSessionID: sql.NullString{String: "new-browser", Valid: true}}
	if _, err := ensureV1ClientSession(context.Background(), nil, row, "old-browser"); err == nil {
		t.Fatal("old browser regained authority")
	}
	if got, err := ensureV1ClientSession(context.Background(), nil, row, "new-browser"); err != nil || got != "new-browser" {
		t.Fatalf("got=%s err=%v", got, err)
	}
}

func TestV1RecoveryFocusRejectsOtherSectionsAndFinalPatches(t *testing.T) {
	raw := []byte(`{"listening":{"parts":[{"id":"part-l","blocks":[{"id":"question-l","labels":[{"id":"slot-l"}]}]}]},"writing":{"tasks":[{"id":"task-w"}]}}`)
	ids, err := recoverySnapshotIDs(raw, "listening", "")
	if err != nil {
		t.Fatal(err)
	}
	row := v1AttemptRow{RecoveryControl: &examdomain.RecoveryControl{Phase: examdomain.RecoveryPhaseWorking, Target: examdomain.RecoveryTarget{SectionKey: "listening"}}}
	for _, tc := range []struct {
		typ, key, id string
		allowed      bool
	}{
		{"answer", "questionId", "question-l", true}, {"answer", "questionId", "question-l:slot-l", true}, {"answer", "questionId", "task-w", false}, {"writing_answer", "taskId", "task-w", false}, {"position", "currentModule", "writing", false},
	} {
		got := validateRecoveryMutation(row, ids, V1Mutation{Type: tc.typ, Payload: map[string]any{tc.key: tc.id}})
		if (got == nil) != tc.allowed {
			t.Fatalf("%+v err=%v", tc, got)
		}
	}
	if err := validateRecoveryPatch(row, ids, map[string]json.RawMessage{"writingAnswers": json.RawMessage(`{"task-w":"changed"}`)}); err == nil {
		t.Fatal("final patch modified a saved successor")
	}
}

// An audit can authenticate before transfer and acquire this lock afterward.
// It must use the current writer before recording a violation or rule input.
func TestRecordAuditRechecksRecoveryWriterUnderLock(t *testing.T) {
	for _, tc := range []struct {
		name, phase, owner, caller string
		allowed                    bool
	}{
		{"old writer after transfer", examdomain.RecoveryPhaseWorking, "new-browser", "old-browser", false},
		{"writer held for transfer", examdomain.RecoveryPhaseHeld, "", "old-browser", false},
		{"writer returning", examdomain.RecoveryPhaseReturning, "", "new-browser", false},
		{"current recovered writer", examdomain.RecoveryPhaseWorking, "new-browser", "new-browser", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			control := examdomain.NewRecoveryControl("recovery-1", "old-browser", examdomain.RecoveryTarget{SectionKey: "reading"})
			control.Phase = tc.phase
			raw, err := json.Marshal(control)
			if err != nil {
				t.Fatal(err)
			}
			mock.ExpectBegin()
			mock.ExpectQuery("FROM student_attempts WHERE id = .* AND schedule_id = .* FOR UPDATE").WithArgs("attempt-1", "schedule-1").WillReturnRows(
				sqlmock.NewRows([]string{"id", "schedule_id", "student_key", "user_id", "candidate_name", "active_client_session_id", "recovery_control", "integrity", "recovery", "violations_snapshot"}).AddRow("attempt-1", "schedule-1", "student-1", "user-1", "Candidate", tc.owner, string(raw), "{}", "{}", "[]"))
			if tc.allowed {
				mock.ExpectExec("INSERT INTO session_audit_logs").WillReturnResult(sqlmock.NewResult(1, 1))
				mock.ExpectExec("INSERT INTO student_violation_events").WillReturnResult(sqlmock.NewResult(1, 1))
				mock.ExpectExec("UPDATE student_attempts").WillReturnResult(sqlmock.NewResult(0, 1))
				mock.ExpectCommit()
			} else {
				mock.ExpectRollback()
			}
			err = NewService(db, nil).RecordAudit(context.Background(), AuditRequest{
				AttemptID: "attempt-1", ScheduleID: "schedule-1", ActorUserID: "user-1", ClientSessionID: tc.caller,
				ActionType: "VIOLATION_DETECTED", Payload: json.RawMessage(`{"violationId":"v-1","violationType":"TAB_SWITCH","severity":"high","message":"Changed tab"}`),
			})
			if tc.allowed && err != nil {
				t.Fatal(err)
			}
			if !tc.allowed {
				var appErr *apperrors.Error
				if !errors.As(err, &appErr) || appErr.Code != apperrors.CodeActiveSessionSuperseded {
					t.Fatalf("old audit must be fenced before any write, got %v", err)
				}
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}
