package main

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"github.com/google/uuid"

	"example.com/ielts-proctoring/internal/delivery"
	"example.com/ielts-proctoring/internal/platform/tx"
	examruntime "example.com/ielts-proctoring/internal/runtime"
)

func TestSATStudentPauseKeepsPersonalClockAndRespectsRoomPauseMySQL(t *testing.T) {
	db := staleETagTestDB(t)
	ctx := context.Background()
	scheduleID, attemptID, moduleID, _, _ := seedStaleETagExam(t, db)
	runner := tx.NewRunner(db)
	svc := delivery.NewService(db, runner)
	userID, deviceID, tokenID := uuid.NewString(), uuid.NewString(), uuid.NewString()
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := db.ExecContext(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec(`UPDATE exam_schedules SET sat_timing_model = 'sat_personal_v1' WHERE id = ?`, scheduleID)
	exec(`UPDATE exam_session_runtimes SET status = 'live', timing_model = 'sat_personal_v1' WHERE schedule_id = ?`, scheduleID)
	exec(`UPDATE assessment_module_attempts SET started_at = DATE_SUB(UTC_TIMESTAMP(6), INTERVAL 60 SECOND) WHERE attempt_id = ? AND module_id = ?`, attemptID, moduleID)
	exec(`INSERT INTO users (id, email, role, state, display_name) VALUES (?, ?, 'student', 'active', 'Pause Student')`, userID, userID+"@example.test")
	t.Cleanup(func() { _, _ = db.Exec("DELETE FROM users WHERE id = ?", userID) })
	exec(`UPDATE student_attempts SET user_id = ?, active_client_session_id = ? WHERE id = ?`, userID, deviceID, attemptID)
	exec(`INSERT INTO attempt_sessions (id, user_id, schedule_id, attempt_id, client_session_id, token_id, expires_at)
		VALUES (?, ?, ?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 30 MINUTE))`, uuid.NewString(), userID, scheduleID, attemptID, deviceID, tokenID)

	initial, err := svc.ReadStudentPause(ctx, scheduleID, attemptID)
	if err != nil || initial.Allowed || initial.Paused {
		t.Fatalf("default state = %+v err=%v", initial, err)
	}
	if _, err := svc.SetStudentPause(ctx, scheduleID, attemptID, true, uint64(initial.ControlEpoch), deviceID, tokenID); err == nil {
		t.Fatal("the default clock must not let a student pause")
	}
	exec(`INSERT INTO sat_activity_policies (schedule_id, policy_revision, pause_on_leave) VALUES (?, 1, TRUE)`, scheduleID)
	paused, err := svc.SetStudentPause(ctx, scheduleID, attemptID, true, uint64(initial.ControlEpoch), deviceID, tokenID)
	if err != nil || !paused.Allowed || !paused.Paused {
		t.Fatalf("pause = %+v err=%v", paused, err)
	}
	changed, err := svc.ReconcileAttemptTimeout(ctx, scheduleID, attemptID, time.Now().UTC().Add(2*time.Hour))
	if err != nil || changed {
		t.Fatalf("paused clock reconciled unexpectedly: %v err=%v", changed, err)
	}
	exec(`UPDATE assessment_module_attempts SET paused_at = DATE_SUB(UTC_TIMESTAMP(6), INTERVAL 30 SECOND) WHERE attempt_id = ? AND module_id = ?`, attemptID, moduleID)
	exec(`UPDATE exam_session_runtimes SET status = 'paused' WHERE schedule_id = ?`, scheduleID)
	exec(`UPDATE sat_activity_policies SET pause_on_leave = FALSE WHERE schedule_id = ?`, scheduleID)
	resumed, err := svc.SetStudentPause(ctx, scheduleID, attemptID, false, uint64(paused.ControlEpoch), deviceID, tokenID)
	if err != nil || resumed.Paused {
		t.Fatalf("release student pause = %+v err=%v", resumed, err)
	}
	var pausedAt sql.NullTime
	var credited int
	readClock := func() {
		t.Helper()
		if err := db.QueryRowContext(ctx, `SELECT paused_at, accumulated_paused_seconds FROM assessment_module_attempts
			WHERE attempt_id = ? AND module_id = ?`, attemptID, moduleID).Scan(&pausedAt, &credited); err != nil {
			t.Fatal(err)
		}
	}
	readClock()
	if !pausedAt.Valid || credited != 0 {
		t.Fatalf("room pause was released early: pausedAt=%+v credited=%d", pausedAt, credited)
	}
	if err := runner.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		if _, err := q.ExecContext(ctx, `UPDATE exam_session_runtimes SET status = 'live' WHERE schedule_id = ?`, scheduleID); err != nil {
			return err
		}
		return examruntime.SyncSATPauseInTx(ctx, q, scheduleID, attemptID)
	}); err != nil {
		t.Fatal(err)
	}
	readClock()
	if pausedAt.Valid || credited < 30 {
		t.Fatalf("clock did not preserve paused time: pausedAt=%+v credited=%d", pausedAt, credited)
	}
}
