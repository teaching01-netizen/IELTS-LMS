package student

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"testing"

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
