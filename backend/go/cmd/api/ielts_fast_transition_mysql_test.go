package main

import (
	"context"
	"strings"
	"testing"
	"time"

	"example.com/ielts-proctoring/internal/platform/telemetry"
	examruntime "example.com/ielts-proctoring/internal/runtime"
)

// activationDelayCount reads the committed-activation histogram count.
func activationDelayCount(section string) string {
	prefix := telemetry.MIELTSSectionActivationDelay + `_count{section="` + section + `"} `
	for _, line := range strings.Split(telemetry.DefaultRegistry.Snapshot(), "\n") {
		if strings.HasPrefix(line, prefix) {
			return strings.TrimPrefix(line, prefix)
		}
	}
	return "0"
}

// V2 next-section eligibility is max(previous personal deadline + save grace
// + gap, room release); readiness and projection agree, an unreleased section
// advertises no start, and a ready candidate gets the full configured duration
// without waiting for anyone else. Requires an isolated, migrated TEST_MYSQL_DSN.
func TestIELTSFastTransitionEligibilityMySQL(t *testing.T) {
	f := seedIELTSLoadFixture(t, 2, 1, []string{"reading", "writing"}, 1)
	svc := newIELTSBudgetServices(t, true, false)
	ctx := context.Background()
	yes := true
	signals := examruntime.IELTSReadinessSignals{ContentReady: &yes, LocalStorageReady: &yes, AudioReady: &yes}
	ready := func(c ieltsLoadCandidate, section string) examruntime.CohortReadiness {
		t.Helper()
		out, err := svc.room.ReadyCohortSection(ctx, f.scheduleID, section, c.AttemptID, c.UserID, nil, signals)
		if err != nil {
			t.Fatalf("ready %s: %v", section, err)
		}
		return out
	}
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := f.db.Exec(query, args...); err != nil {
			t.Fatal(err)
		}
	}
	a, b := f.candidates[0], f.candidates[1]
	for _, c := range f.candidates {
		if out := ready(c, "reading"); out.Status != "active" {
			t.Fatalf("reading: %+v", out)
		}
	}
	// A's reading ended 1s ago (inside grace); B's ended 5s ago (grace over).
	exec(`UPDATE ielts_attempt_section_timelines SET deadline_at = UTC_TIMESTAMP(6) - INTERVAL 1 SECOND WHERE attempt_id = ? AND section_key = 'reading'`, a.AttemptID)
	exec(`UPDATE ielts_attempt_section_timelines SET deadline_at = UTC_TIMESTAMP(6) - INTERVAL 5 SECOND WHERE attempt_id = ? AND section_key = 'reading'`, b.AttemptID)

	if out := ready(a, "writing"); out.Status != "preparing" || out.ExpectedStartAt != nil || out.StartedAt != nil {
		t.Fatalf("unreleased writing must not advertise a start: %+v", out)
	}
	exec(`UPDATE exam_session_runtime_sections SET status = 'live', actual_start_at = UTC_TIMESTAMP(6) - INTERVAL 30 SECOND WHERE runtime_id = ? AND section_key = 'writing'`, f.runtimeID)

	var aDeadline time.Time
	if err := f.db.QueryRow(`SELECT deadline_at FROM ielts_attempt_section_timelines WHERE attempt_id = ? AND section_key = 'reading'`, a.AttemptID).Scan(&aDeadline); err != nil {
		t.Fatal(err)
	}
	early := ready(a, "writing")
	if early.Status != "preparing" || early.StartedAt != nil || early.ExpectedStartAt == nil ||
		!early.ExpectedStartAt.Equal(aDeadline.UTC().Add(examruntime.ResponseSaveGrace)) {
		t.Fatalf("inside grace must stay preparing until deadline+grace: %+v (deadline %v)", early, aDeadline)
	}
	view, err := loadStudentRuntimeContext(ctx, f.db, f.scheduleID, a.AttemptID)
	if err != nil {
		t.Fatal(err)
	}
	if got, _ := view["personalExpectedStartAt"].(*time.Time); got == nil || !got.Equal(*early.ExpectedStartAt) {
		t.Fatalf("projection expected start %v != readiness %v", view["personalExpectedStartAt"], early.ExpectedStartAt)
	}

	// B starts despite A still waiting, with the full configured duration.
	countBefore := activationDelayCount("writing")
	first := ready(b, "writing")
	if first.Status != "active" || first.StartedAt == nil || first.DeadlineAt == nil {
		t.Fatalf("B writing: %+v", first)
	}
	if got := first.DeadlineAt.Sub(*first.StartedAt); got != 60*time.Minute {
		t.Fatalf("assigned duration %v, want 60m", got)
	}
	countAfter := activationDelayCount("writing")
	if countAfter == countBefore {
		t.Fatalf("activation delay not observed (count %s)", countAfter)
	}
	again := ready(b, "writing")
	if !again.StartedAt.Equal(*first.StartedAt) || !again.DeadlineAt.Equal(*first.DeadlineAt) {
		t.Fatalf("duplicate activation moved the clock: %+v vs %+v", again, first)
	}
	if got := activationDelayCount("writing"); got != countAfter {
		t.Fatalf("duplicate activation observed again: %s -> %s", countAfter, got)
	}
	var timelines int
	if err := f.db.QueryRow(`SELECT COUNT(*) FROM ielts_attempt_section_timelines WHERE attempt_id = ? AND section_key = 'writing'`, b.AttemptID).Scan(&timelines); err != nil || timelines != 1 {
		t.Fatalf("writing timelines = %d (%v)", timelines, err)
	}
}

// Concurrent duplicate readiness for one eligible candidate creates one
// timeline with one start; every caller sees the same persisted times. A
// paused room never assigns a working clock.
func TestIELTSFastTransitionConcurrentReadinessMySQL(t *testing.T) {
	f := seedIELTSLoadFixture(t, 2, 1, []string{"reading", "writing"}, 1)
	svc := newIELTSBudgetServices(t, true, false)
	ctx := context.Background()
	yes := true
	signals := examruntime.IELTSReadinessSignals{ContentReady: &yes, LocalStorageReady: &yes, AudioReady: &yes}
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := f.db.Exec(query, args...); err != nil {
			t.Fatal(err)
		}
	}
	a, b := f.candidates[0], f.candidates[1]
	for _, c := range f.candidates {
		if out, err := svc.room.ReadyCohortSection(ctx, f.scheduleID, "reading", c.AttemptID, c.UserID, nil, signals); err != nil || out.Status != "active" {
			t.Fatalf("reading: %+v %v", out, err)
		}
	}
	exec(`UPDATE ielts_attempt_section_timelines SET deadline_at = UTC_TIMESTAMP(6) - INTERVAL 5 SECOND
		WHERE attempt_id IN (?, ?) AND section_key = 'reading'`, a.AttemptID, b.AttemptID)
	exec(`UPDATE exam_session_runtime_sections SET status = 'live', actual_start_at = UTC_TIMESTAMP(6) - INTERVAL 10 SECOND
		WHERE runtime_id = ? AND section_key = 'writing'`, f.runtimeID)

	const callers = 8
	results := make(chan examruntime.CohortReadiness, callers)
	errs := make(chan error, callers)
	start := make(chan struct{})
	for range callers {
		go func() {
			<-start
			out, err := svc.room.ReadyCohortSection(ctx, f.scheduleID, "writing", a.AttemptID, a.UserID, nil, signals)
			if err != nil {
				errs <- err
				return
			}
			results <- out
		}()
	}
	close(start)
	var first *examruntime.CohortReadiness
	for range callers {
		select {
		case err := <-errs:
			t.Fatalf("concurrent ready: %v", err)
		case out := <-results:
			if out.Status != "active" || out.StartedAt == nil || out.DeadlineAt == nil {
				t.Fatalf("concurrent ready result: %+v", out)
			}
			if first == nil {
				first = &out
			} else if !out.StartedAt.Equal(*first.StartedAt) || !out.DeadlineAt.Equal(*first.DeadlineAt) {
				t.Fatalf("callers saw different clocks: %+v vs %+v", out, *first)
			}
		}
	}
	var rows, revision int
	if err := f.db.QueryRow(`SELECT COUNT(*), MAX(revision) FROM ielts_attempt_section_timelines
		WHERE attempt_id = ? AND section_key = 'writing'`, a.AttemptID).Scan(&rows, &revision); err != nil || rows != 1 || revision != 1 {
		t.Fatalf("writing timelines = %d revision = %d (%v); want one row written once", rows, revision, err)
	}

	// B is eligible too, but a paused room assigns no clock.
	exec(`UPDATE exam_session_runtimes SET status = 'paused' WHERE id = ?`, f.runtimeID)
	out, err := svc.room.ReadyCohortSection(ctx, f.scheduleID, "writing", b.AttemptID, b.UserID, nil, signals)
	if err != nil || out.Status != "preparing" || out.StartedAt != nil {
		t.Fatalf("paused room must not activate: %+v %v", out, err)
	}
}
