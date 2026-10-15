package sat

import (
	"context"
	"errors"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
	"github.com/go-sql-driver/mysql"

	"example.com/ielts-proctoring/internal/platform/tx"
)

type overlayTestSealer struct {
	calls int
}

func (s *overlayTestSealer) SealCompletion(_ context.Context, _ tx.Tx, _ attemptCore, _ CompleteRequest, _ time.Time) (*AssessmentResult, bool, error) {
	s.calls++
	return &AssessmentResult{ScorePayload: map[string]any{
		"classroomRaw": map[string]any{"rawCorrect": 8, "totalScaled": 1100},
	}}, true, nil
}

// Ordered expectations detect an overlay before commit or inside a retry.
// The sealer deliberately returns a payload even when Commit subsequently fails.
func TestCompletionOverlayRunsOnlyAfterSuccessfulCommit(t *testing.T) {
	for _, tc := range []struct {
		name      string
		commitErr error
		retry     bool
		policyErr error
	}{
		{name: "success"},
		{name: "deadlock retries commit", commitErr: &mysql.MySQLError{Number: 1213}, retry: true},
		{name: "commit failure", commitErr: errors.New("commit failed")},
		{name: "policy failure degrades to raw", policyErr: errors.New("policy unavailable")},
	} {
		t.Run(tc.name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			svc := satService(db)
			sealer := &overlayTestSealer{}
			svc.completionSealer = sealer
			expectTx := func(commitErr error) {
				expectCompleteAssessmentPrefix(mock, "running", "exam", "active", satCompleteTopologyRows())
				satNotAwaitingStaffRoute(mock)
				commit := mock.ExpectCommit()
				if commitErr != nil {
					commit.WillReturnError(commitErr)
				}
			}
			expectTx(tc.commitErr)
			if tc.retry {
				expectTx(nil)
			}
			wantSuccess := tc.commitErr == nil || tc.retry
			if wantSuccess {
				query := mock.ExpectQuery("SELECT revision_id FROM sat_score_conversion_active")
				if tc.policyErr != nil {
					query.WillReturnError(tc.policyErr)
				} else {
					query.WillReturnRows(sqlmock.NewRows([]string{"revision_id"}).AddRow(nil))
				}
			}
			out, err := svc.CompleteAssessment(context.Background(), CompleteRequest{
				AttemptID: "att-1", ScheduleID: "sched-1", SubmissionID: "sub-1",
			})
			if !wantSuccess {
				if !errors.Is(err, tc.commitErr) || out != nil {
					t.Fatalf("failed commit exposed result: %+v, %v", out, err)
				}
			} else {
				if err != nil || out == nil {
					t.Fatalf("completion = %+v, %v", out, err)
				}
				raw := out.ScorePayload["classroomRaw"].(map[string]any)
				if raw["rawCorrect"] != 8 {
					t.Fatalf("raw score changed: %+v", raw)
				}
				if (raw["totalScaled"] == nil) != (tc.policyErr != nil) {
					t.Fatalf("unexpected conversion on policy failure: %+v", raw)
				}
			}
			wantCalls := 1
			if tc.retry {
				wantCalls = 2
			}
			if sealer.calls != wantCalls {
				t.Fatalf("sealer calls = %d, want %d", sealer.calls, wantCalls)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}
