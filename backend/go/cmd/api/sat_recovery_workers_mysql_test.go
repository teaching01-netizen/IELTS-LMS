package main

import (
	"context"
	"testing"
	"time"

	"example.com/ielts-proctoring/internal/delivery"
	"example.com/ielts-proctoring/internal/liveupdates"
	"example.com/ielts-proctoring/internal/platform/tx"
	"github.com/google/uuid"
)

func TestSATRecoveryTwoWorkerBoundarySweepIsIdempotentMySQL(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	dbA := staleETagTestDB(t)
	dbA.SetMaxOpenConns(4)
	scheduleID, attemptID, baseModuleID, _, _ := seedStaleETagExam(t, dbA)
	t.Cleanup(func() {
		if _, err := dbA.Exec(
			`DELETE FROM live_update_events WHERE event_target_id IN (?, ?)`, attemptID, scheduleID); err != nil {
			t.Errorf("delete SAT worker test live events: %v", err)
		}
	})

	policy := `{"version":"sat_recovery_v1","recoverySeconds":120,"entryRecoverySeconds":120,"lateAnswerPolicy":"frozen_arrival_window"}`
	if _, err := dbA.ExecContext(ctx,
		`UPDATE exam_schedules SET sat_timing_model = 'sat_personal_v1', sat_delivery_policy = CAST(? AS JSON) WHERE id = ?`,
		policy, scheduleID); err != nil {
		t.Fatalf("enable SAT recovery policy: %v", err)
	}
	if _, err := dbA.ExecContext(ctx,
		`UPDATE exam_session_runtimes SET timing_model = 'sat_personal_v1' WHERE schedule_id = ?`, scheduleID); err != nil {
		t.Fatalf("enable SAT personal runtime: %v", err)
	}

	var moduleAttemptID string
	if err := dbA.QueryRowContext(ctx,
		`SELECT id FROM assessment_module_attempts WHERE attempt_id = ? AND module_id = ?`, attemptID, baseModuleID).
		Scan(&moduleAttemptID); err != nil {
		t.Fatalf("read Module 1 attempt: %v", err)
	}
	startedAt := time.Now().UTC().Add(-3605 * time.Second)
	if _, err := dbA.ExecContext(ctx,
		`UPDATE assessment_module_attempts SET started_at = ? WHERE id = ?`, startedAt, moduleAttemptID); err != nil {
		t.Fatalf("make Module 1 deadline due: %v", err)
	}
	if _, err := dbA.ExecContext(ctx, `
		INSERT INTO assessment_module_boundaries (
			module_attempt_id, attempt_id, phase, policy_version, work_deadline_at,
			entry_deadline_at, recovery_deadline_at, next_action_at
		)
		SELECT ma.id, ma.attempt_id, 'working', 'sat_recovery_v1',
			TIMESTAMPADD(SECOND, ma.allocated_seconds + ma.extension_seconds + ma.accumulated_paused_seconds, ma.started_at),
			NULL,
			TIMESTAMPADD(SECOND, ma.allocated_seconds + ma.extension_seconds + ma.accumulated_paused_seconds + 120, ma.started_at),
			TIMESTAMPADD(SECOND, ma.allocated_seconds + ma.extension_seconds + ma.accumulated_paused_seconds, ma.started_at)
		FROM assessment_module_attempts ma WHERE ma.id = ?`, moduleAttemptID); err != nil {
		t.Fatalf("seed due SAT recovery boundary: %v", err)
	}

	dbB := staleETagTestDB(t)
	dbB.SetMaxOpenConns(4)
	workers := []*delivery.Service{
		delivery.NewService(dbA, tx.NewRunner(dbA)).SetLive("sat-recovery-worker-a-"+uuid.NewString(), nil),
		delivery.NewService(dbB, tx.NewRunner(dbB)).SetLive("sat-recovery-worker-b-"+uuid.NewString(), nil),
	}
	asOf := time.Now().UTC()
	type sweepResult struct {
		changed int64
		err     error
	}
	start := make(chan struct{})
	results := make(chan sweepResult, len(workers))
	for _, worker := range workers {
		go func(worker *delivery.Service) {
			<-start
			changed, err := worker.ReconcilePersonalTimeouts(ctx, asOf, 10)
			results <- sweepResult{changed: changed, err: err}
		}(worker)
	}
	close(start)

	var totalChanged int64
	for range workers {
		result := <-results
		if result.err != nil {
			t.Fatalf("concurrent SAT recovery sweep: %v", result.err)
		}
		totalChanged += result.changed
	}
	if totalChanged != 1 {
		t.Fatalf("concurrent workers changed %d boundaries, want exactly one", totalChanged)
	}

	var phase string
	var revision uint64
	var workDeadline, recoveryDeadline, nextAction time.Time
	if err := dbA.QueryRowContext(ctx, `
		SELECT phase, revision, work_deadline_at, recovery_deadline_at, next_action_at
		FROM assessment_module_boundaries WHERE module_attempt_id = ?`, moduleAttemptID).
		Scan(&phase, &revision, &workDeadline, &recoveryDeadline, &nextAction); err != nil {
		t.Fatalf("read reconciled recovery boundary: %v", err)
	}
	if phase != "collecting" || revision != 2 {
		t.Fatalf("boundary phase/revision = %s/%d, want collecting/2", phase, revision)
	}
	if nextAction.Before(recoveryDeadline.Add(-time.Millisecond)) || nextAction.After(recoveryDeadline.Add(time.Millisecond)) {
		t.Fatalf("next action %s does not match recovery deadline %s", nextAction, recoveryDeadline)
	}
	if !workDeadline.Before(asOf) || !recoveryDeadline.After(asOf) {
		t.Fatalf("fixture deadlines are not in the intended window: work=%s recovery=%s asOf=%s", workDeadline, recoveryDeadline, asOf)
	}

	var moduleState string
	if err := dbA.QueryRowContext(ctx,
		`SELECT state FROM assessment_module_attempts WHERE id = ?`, moduleAttemptID).Scan(&moduleState); err != nil {
		t.Fatalf("read Module 1 state: %v", err)
	}
	if moduleState != "active" {
		t.Fatalf("Module 1 state = %q, want active while its recovery window is collecting", moduleState)
	}
	var routeDecisions int
	if err := dbA.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM assessment_route_decisions WHERE attempt_id = ?`, attemptID).Scan(&routeDecisions); err != nil {
		t.Fatalf("count route decisions: %v", err)
	}
	if routeDecisions != 0 {
		t.Fatalf("recovery boundary created %d route decisions, want none before settlement", routeDecisions)
	}

	assertSingleHintPair := func() {
		t.Helper()
		rows, err := dbA.QueryContext(ctx, `
			SELECT event_kind, event_target_id, COUNT(*)
			FROM live_update_events
			WHERE event_target_id IN (?, ?) AND event_name = 'sat_module_submitted'
			GROUP BY event_kind, event_target_id`, attemptID, scheduleID)
		if err != nil {
			t.Fatalf("query durable module hints: %v", err)
		}
		defer rows.Close()
		got := map[string]int{}
		for rows.Next() {
			var kind, target string
			var count int
			if err := rows.Scan(&kind, &target, &count); err != nil {
				t.Fatalf("read durable module hint: %v", err)
			}
			got[kind+":"+target] = count
		}
		if err := rows.Err(); err != nil {
			t.Fatalf("finish durable module hint query: %v", err)
		}
		if len(got) != 2 || got[liveupdates.KindAttempt+":"+attemptID] != 1 || got[liveupdates.KindScheduleRoster+":"+scheduleID] != 1 {
			t.Fatalf("durable module hint pair = %v, want one attempt and one schedule-roster hint", got)
		}
	}
	assertSingleHintPair()

	for _, worker := range workers {
		changed, err := worker.ReconcilePersonalTimeouts(ctx, time.Now().UTC(), 10)
		if err != nil {
			t.Fatalf("replay SAT recovery sweep after hint loss: %v", err)
		}
		if changed != 0 {
			t.Fatalf("replayed worker changed %d boundaries, want no-op", changed)
		}
	}
	assertSingleHintPair()
}
