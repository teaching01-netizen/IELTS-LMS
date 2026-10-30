package main

import (
	"context"
	"sync"
	"testing"
	"time"

	examruntime "example.com/ielts-proctoring/internal/runtime"
)

// Requires an isolated, migrated TEST_MYSQL_DSN. Two devices race to start
// the released section while a third never reports ready, then reconnects.
func TestIELTSSharedTransitionDoesNotWaitForDisconnectedStudentMySQL(t *testing.T) {
	f := seedIELTSLoadFixture(t, 3, 1, []string{"reading", "writing"}, 1)
	svc := newIELTSBudgetServices(t, true, false)
	ctx := context.Background()
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := f.db.ExecContext(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	// Reuse the exam/attempt fixture with a shared-clock room that has just
	// released writing; nobody has acknowledged the transition yet.
	exec(`UPDATE exam_schedules SET ielts_timing_model = NULL WHERE id = ?`, f.scheduleID)
	exec(`UPDATE exam_session_runtimes SET timing_model = ?, active_section_key = 'writing', current_section_key = 'writing', revision = 1 WHERE id = ?`, examruntime.TimingModelLegacy, f.runtimeID)
	exec(`UPDATE exam_session_runtime_sections SET status = 'completed', actual_end_at = UTC_TIMESTAMP(6) WHERE runtime_id = ? AND section_key = 'reading'`, f.runtimeID)
	exec(`UPDATE exam_session_runtime_sections SET available_at = UTC_TIMESTAMP(6) WHERE runtime_id = ? AND section_key = 'writing'`, f.runtimeID)
	ready := true
	signals := examruntime.IELTSReadinessSignals{ContentReady: &ready, LocalStorageReady: &ready, AudioReady: &ready}
	var results [2]examruntime.CohortReadiness
	var errors [2]error
	var wg sync.WaitGroup
	start := make(chan struct{})
	for i := range results {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			c := f.candidates[i]
			rtt := 100
			results[i], errors[i] = svc.room.ReadyCohortSection(ctx, f.scheduleID, "writing", c.AttemptID, c.UserID, &rtt, signals)
		}(i)
	}
	close(start)
	wg.Wait()
	for i, result := range results {
		if errors[i] != nil || result.StartedAt == nil {
			t.Fatalf("student %d blocked by missing student: %+v, %v", i, result, errors[i])
		}
	}
	if !results[0].StartedAt.Equal(*results[1].StartedAt) {
		t.Fatalf("concurrent devices received different starts: %+v", results)
	}
	// Neither reconnect nor duplicate readiness may reset the shared timer or
	// bump its control epoch again. No RTT is needed to recover an armed start.
	for _, c := range f.candidates {
		result, err := svc.room.ReadyCohortSection(ctx, f.scheduleID, "writing", c.AttemptID, c.UserID, nil, signals)
		if err != nil || result.StartedAt == nil || !result.StartedAt.Equal(*results[0].StartedAt) {
			t.Fatalf("reconnect/retry moved the shared start: %+v, %v", result, err)
		}
		var deadline time.Time
		var epoch int
		if err := f.db.QueryRowContext(ctx, `SELECT deadline_at, control_epoch FROM student_attempts WHERE id = ?`, c.AttemptID).Scan(&deadline, &epoch); err != nil {
			t.Fatal(err)
		}
		if !deadline.Equal(results[0].StartedAt.Add(time.Hour)) || epoch != 2 {
			t.Fatalf("student has a separate/reset clock: deadline=%v epoch=%d", deadline, epoch)
		}
	}
	var revision, personalClocks int
	if err := f.db.QueryRowContext(ctx, `SELECT revision, (SELECT COUNT(*) FROM ielts_attempt_section_timelines WHERE runtime_id = ?) FROM exam_session_runtimes WHERE id = ?`, f.runtimeID, f.runtimeID).Scan(&revision, &personalClocks); err != nil {
		t.Fatal(err)
	}
	if revision != 2 || personalClocks != 0 {
		t.Fatalf("expected one shared start and no personal clocks: revision=%d personalClocks=%d", revision, personalClocks)
	}
}
