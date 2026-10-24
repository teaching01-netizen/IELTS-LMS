package main

import (
	"context"
	"testing"
	"time"

	"example.com/ielts-proctoring/internal/delivery"
	"example.com/ielts-proctoring/internal/platform/tx"
	examruntime "example.com/ielts-proctoring/internal/runtime"
	"github.com/google/uuid"
)

// A room extension and a room pause/resume move a recovery-policy module's
// clock; the working boundary must move with it in the same transaction, so
// the due sweep does not collect (and later block) a module whose time has
// not run out.
func TestSATRecoveryBoundaryFollowsModuleClockMySQL(t *testing.T) {
	db := staleETagTestDB(t)
	ctx := context.Background()
	scheduleID, attemptID, baseModuleID, _, _ := seedStaleETagExam(t, db)
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := db.ExecContext(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec(`UPDATE exam_schedules SET sat_timing_model = 'sat_personal_v1', sat_delivery_policy = CAST(? AS JSON) WHERE id = ?`,
		`{"version":"sat_recovery_v1","recoverySeconds":120,"entryRecoverySeconds":120,"lateAnswerPolicy":"frozen_arrival_window"}`, scheduleID)
	exec(`UPDATE exam_session_runtimes SET timing_model = 'sat_personal_v1', status = 'live', active_section_key = 'reading-writing' WHERE schedule_id = ?`, scheduleID)
	exec(`INSERT INTO exam_session_runtime_sections (id, runtime_id, section_key, label, section_order, planned_duration_minutes, status, actual_start_at)
		SELECT ?, id, 'reading-writing', 'Reading', 0, 60, 'live', UTC_TIMESTAMP(6) FROM exam_session_runtimes WHERE schedule_id = ?`, uuid.NewString(), scheduleID)
	var moduleAttemptID string
	if err := db.QueryRowContext(ctx, `SELECT id FROM assessment_module_attempts WHERE attempt_id = ? AND module_id = ?`, attemptID, baseModuleID).Scan(&moduleAttemptID); err != nil {
		t.Fatal(err)
	}
	// 30 seconds of a 3600-second module left, with its working boundary.
	exec(`UPDATE assessment_module_attempts SET started_at = DATE_SUB(UTC_TIMESTAMP(6), INTERVAL 3570 SECOND) WHERE id = ?`, moduleAttemptID)
	exec(`INSERT INTO assessment_module_boundaries (module_attempt_id, attempt_id, phase, policy_version, work_deadline_at, recovery_deadline_at, next_action_at)
		SELECT ma.id, ma.attempt_id, 'working', 'sat_recovery_v1',
			TIMESTAMPADD(SECOND, ma.allocated_seconds, ma.started_at),
			TIMESTAMPADD(SECOND, ma.allocated_seconds + 120, ma.started_at),
			TIMESTAMPADD(SECOND, ma.allocated_seconds, ma.started_at)
		FROM assessment_module_attempts ma WHERE ma.id = ?`, moduleAttemptID)

	misaligned := func() int {
		t.Helper()
		var n int
		if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM assessment_module_boundaries b JOIN assessment_module_attempts ma ON ma.id = b.module_attempt_id
			WHERE b.module_attempt_id = ? AND (
			  b.work_deadline_at <> TIMESTAMPADD(SECOND, ma.allocated_seconds + ma.extension_seconds + ma.accumulated_paused_seconds, ma.started_at)
			  OR b.next_action_at <> b.work_deadline_at
			  OR b.recovery_deadline_at <> TIMESTAMPADD(SECOND, 120, b.work_deadline_at))`, moduleAttemptID).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}

	runner := tx.NewRunner(db)
	room := examruntime.NewService(runner, nil)
	if err := room.Extend(ctx, scheduleID, examruntime.RevisionFence{}, 10, nil); err != nil {
		t.Fatalf("extend: %v", err)
	}
	if n := misaligned(); n != 0 {
		t.Fatal("room extension must move the working boundary with the module clock")
	}

	if err := room.Pause(ctx, scheduleID, examruntime.RevisionFence{}, nil, "realign-auditor"); err != nil {
		t.Fatalf("pause: %v", err)
	}
	// Simulate a 20-minute pause without sleeping.
	exec(`UPDATE assessment_module_attempts SET paused_at = DATE_SUB(UTC_TIMESTAMP(6), INTERVAL 1200 SECOND) WHERE id = ?`, moduleAttemptID)
	if err := room.Resume(ctx, scheduleID, examruntime.RevisionFence{}, "realign-auditor"); err != nil {
		t.Fatalf("resume: %v", err)
	}
	var paused int
	if err := db.QueryRowContext(ctx, `SELECT accumulated_paused_seconds FROM assessment_module_attempts WHERE id = ?`, moduleAttemptID).Scan(&paused); err != nil {
		t.Fatal(err)
	}
	if paused < 1200 {
		t.Fatalf("resume must credit the paused interval, got %d", paused)
	}
	if n := misaligned(); n != 0 {
		t.Fatal("resume must move the working boundary by the credited pause")
	}

	// Without the extension and pause the module would be past its recovery
	// deadline by now; with them it still has time, so the sweep leaves it working.
	worker := delivery.NewService(db, runner)
	if _, err := worker.ReconcilePersonalTimeouts(ctx, time.Now().UTC().Add(5*time.Minute), 50); err != nil {
		t.Fatal(err)
	}
	var phase string
	if err := db.QueryRowContext(ctx, `SELECT phase FROM assessment_module_boundaries WHERE module_attempt_id = ?`, moduleAttemptID).Scan(&phase); err != nil {
		t.Fatal(err)
	}
	if phase != "working" {
		t.Fatalf("a module with time left must stay working, got %s", phase)
	}
}
