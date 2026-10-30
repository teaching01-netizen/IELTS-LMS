package main

import (
	"context"
	"testing"
	"time"

	"example.com/ielts-proctoring/internal/attempts"
	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/clock"
	"example.com/ielts-proctoring/internal/platform/tx"
)

// A sitting grant whose stored horizon has passed is refused with the typed
// expiry reason while its signed token still verifies. Renewal cannot help, so
// the client must stop retrying and ask for re-entry.
func TestExamGrantExpiredHorizonReportsTypedReasonMySQL(t *testing.T) {
	f, _ := readyContinuityIELTS(t)
	c := f.candidates[0]
	app := continuityApp(f)
	app.Config.ExamAccessEnabled = true
	app.Config.ExamAccessMaxHours = 12
	if _, err := f.db.Exec("DELETE FROM attempt_sessions WHERE attempt_id = ?", c.AttemptID); err != nil {
		t.Fatal(err)
	}
	var token string
	err := tx.NewRunner(f.db).WithTxRCRetry(context.Background(), 3, func(ctx context.Context, q tx.Tx) error {
		var err error
		token, _, err = auth.IssueExamGrantTx(ctx, q, app.Config, c.UserID, f.scheduleID, c.AttemptID, c.ClientSessionID, nil, 1, time.Now().UTC(), auth.ExamGrantOptions{})
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = f.db.Exec("UPDATE attempt_sessions SET expires_at = UTC_TIMESTAMP(6) - INTERVAL 1 SECOND WHERE attempt_id = ?", c.AttemptID); err != nil {
		t.Fatal(err)
	}
	svc := attempts.NewService(tx.NewRunner(f.db), clock.System{}, []byte(submitTestSecret))
	_, err = svc.ResumeAccess(context.Background(), token, c.AttemptID)
	if appErr, ok := apperrors.As(err); !ok || appErr.Code != apperrors.CodeExamAccessExpired {
		t.Fatalf("expired stored horizon: want %s, got %v", apperrors.CodeExamAccessExpired, err)
	}
}
