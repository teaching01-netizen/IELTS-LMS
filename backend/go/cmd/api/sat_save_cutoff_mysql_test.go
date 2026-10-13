package main

import (
	"context"
	"strings"
	"testing"

	"github.com/google/uuid"

	"example.com/ielts-proctoring/internal/attempts"
	"example.com/ielts-proctoring/internal/delivery"
	"example.com/ielts-proctoring/internal/platform/clock"
	"example.com/ielts-proctoring/internal/platform/crypto"
	"example.com/ielts-proctoring/internal/platform/tx"
)

// NT-6 / D1(a): the save cutoff is the module-lock commit, not the deadline.
// Inside [deadline, deadline+W) a save that commits before the close is
// counted (TestSATClientStartHandoffMySQL); this pins the other order: once
// the close commits, a save in the same window is refused and the scored
// snapshot is unchanged.
func TestSATSaveAfterModuleCloseIsRefusedInsideCloseWindowMySQL(t *testing.T) {
	db := staleETagTestDB(t)
	ctx := context.Background()
	schedule, attempt, base, _, _ := seedStaleETagExam(t, db)
	session, token := seedHandoffWriter(t, db, schedule, attempt)
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := db.ExecContext(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec("UPDATE exam_session_runtimes SET timing_model = 'sat_personal_v1', sat_handoff_mode = 'client_start' WHERE schedule_id = ?", schedule)
	exec("UPDATE exam_schedules SET sat_timing_model = 'sat_personal_v1' WHERE id = ?", schedule)
	var moduleAttempt, question string
	if err := db.QueryRowContext(ctx, "SELECT id FROM assessment_module_attempts WHERE attempt_id = ? AND module_id = ?", attempt, base).Scan(&moduleAttempt); err != nil {
		t.Fatal(err)
	}
	// Five seconds past the deadline: inside the personal close window.
	exec("UPDATE assessment_module_attempts SET started_at = DATE_SUB(UTC_TIMESTAMP(6), INTERVAL 3605 SECOND) WHERE id = ?", moduleAttempt)
	if err := db.QueryRowContext(ctx, "SELECT question_id FROM attempt_responses_v2 WHERE attempt_id = ? LIMIT 1", attempt).Scan(&question); err != nil {
		t.Fatal(err)
	}
	var user string
	if err := db.QueryRow("SELECT user_id FROM attempt_sessions WHERE token_id = ?", token).Scan(&user); err != nil {
		t.Fatal(err)
	}
	exec("UPDATE student_attempts SET user_id = ?, active_client_session_id = ? WHERE id = ?", user, session, attempt)

	svc := delivery.NewService(db, tx.NewRunner(db))
	req := delivery.ModuleCloseRequest{ModuleID: base, ModuleAttemptID: moduleAttempt, CloseID: "close-nt6"}
	if _, err := svc.CloseModule(ctx, schedule, attempt, schedule, req, session, token); err != nil {
		t.Fatalf("close inside the window: %v", err)
	}
	var rawBefore int
	if err := db.QueryRowContext(ctx, "SELECT raw_correct FROM assessment_module_attempts WHERE id = ?", moduleAttempt).Scan(&rawBefore); err != nil {
		t.Fatal(err)
	}

	bearer, err := crypto.SignAttemptToken([]byte(submitTestSecret), crypto.AttemptClaims{
		TokenID: token, UserID: user, ScheduleID: schedule, AttemptID: attempt, ClientSessionID: session, Exp: 1 << 40,
	})
	if err != nil {
		t.Fatal(err)
	}
	writeService := attempts.NewService(tx.NewRunner(db), clock.System{}, []byte(submitTestSecret)).SetRowFirst(true)
	result, err := writeService.SaveResponses(ctx, bearer, attempts.SaveResponsesCommand{
		AttemptID: attempt, LeaseEpoch: 1, ControlEpoch: 1,
		Commands: []attempts.ResponseCommand{{QuestionID: question, WriteID: uuid.NewString(), ClientVersion: 9, Response: attempts.ResponsePayload{Answer: "D"}}},
	}, v2Resolver{}, v2Locker{})
	if err == nil || !strings.Contains(err.Error(), "module is not active") {
		t.Fatalf("a save after the module close must be refused as not writable, got %+v %v", result, err)
	}
	var rawAfter int
	if err := db.QueryRowContext(ctx, "SELECT raw_correct FROM assessment_module_attempts WHERE id = ?", moduleAttempt).Scan(&rawAfter); err != nil {
		t.Fatal(err)
	}
	if rawAfter != rawBefore {
		t.Fatalf("locked module score changed: %d -> %d", rawBefore, rawAfter)
	}
}
