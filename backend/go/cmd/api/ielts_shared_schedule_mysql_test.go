package main

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"example.com/ielts-proctoring/internal/attempts"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/tx"
	"example.com/ielts-proctoring/internal/proctor"
	examruntime "example.com/ielts-proctoring/internal/runtime"
)

// Requires an isolated, migrated TEST_MYSQL_DSN (migration 0114).

func sharedFixtureNow(t *testing.T, f ieltsLoadFixture) time.Time {
	t.Helper()
	var now time.Time
	if err := f.db.QueryRow("SELECT UTC_TIMESTAMP(6)").Scan(&now); err != nil {
		t.Fatal(err)
	}
	return now.UTC()
}

func loadSharedSchedule(t *testing.T, f ieltsLoadFixture, runtimeID string) examruntime.IELTSSharedSchedule {
	t.Helper()
	var raw string
	if err := f.db.QueryRow("SELECT ielts_shared_schedule FROM exam_session_runtimes WHERE id = ?", runtimeID).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	s, err := examruntime.ParseIELTSSharedSchedule([]byte(raw))
	if err != nil {
		t.Fatal(err)
	}
	return s
}

// convertToSharedRoom rewrites the fixture's first room onto a committed
// timetable whose Reading ended a minute ago: the section rows still say
// Reading is live, exactly as when the reconciler has not run yet.
func convertToSharedRoom(t *testing.T, f ieltsLoadFixture) examruntime.IELTSSharedSchedule {
	t.Helper()
	ctx := context.Background()
	start := sharedFixtureNow(t, f).Add(-61 * time.Minute)
	schedule, err := examruntime.BuildIELTSSharedSchedule(start, []examruntime.PlanEntry{
		{SectionKey: "reading", Order: 0, DurationMinutes: 60},
		{SectionKey: "writing", Order: 1, DurationMinutes: 60},
	}, examruntime.ResponseSaveGrace)
	if err != nil {
		t.Fatal(err)
	}
	err = tx.NewRunner(f.db).WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		if _, err := q.ExecContext(ctx, `UPDATE exam_schedules SET ielts_timing_model = ? WHERE id = ?`, examruntime.TimingModelIELTSSharedSchedule, f.scheduleID); err != nil {
			return err
		}
		if _, err := q.ExecContext(ctx, `UPDATE exam_session_runtimes SET timing_model = ? WHERE id = ?`, examruntime.TimingModelIELTSSharedSchedule, f.runtimeID); err != nil {
			return err
		}
		if _, err := q.ExecContext(ctx, `UPDATE exam_session_runtime_sections SET actual_start_at = ? WHERE runtime_id = ? AND section_key = 'reading'`, start, f.runtimeID); err != nil {
			return err
		}
		return examruntime.StoreIELTSSharedScheduleInTx(ctx, q, f.runtimeID, schedule)
	})
	if err != nil {
		t.Fatal(err)
	}
	return schedule
}

func TestIELTSSharedScheduleAdvancesWithoutAnyReadinessMySQL(t *testing.T) {
	f := seedIELTSLoadFixture(t, 3, 1, []string{"reading", "writing"}, 2)
	svc := newIELTSBudgetServices(t, false, false)
	ctx := context.Background()
	schedule := convertToSharedRoom(t, f)
	writing, _ := schedule.WindowFor("writing")
	reading, _ := schedule.WindowFor("reading")

	// Nobody called /ready and the worker has not run: the live view already
	// resolves Writing from the committed timetable.
	view, err := proctor.LoadSessionRuntimeBySchedule(ctx, f.db, f.scheduleID)
	if err != nil {
		t.Fatal(err)
	}
	if view.ActiveSectionKey == nil || *view.ActiveSectionKey != "writing" || view.CurrentSectionDeadlineAt == nil || !view.CurrentSectionDeadlineAt.Equal(writing.DeadlineAt) {
		t.Fatalf("view did not resolve the scheduled section: %+v", view)
	}

	// The write gate uses the timetable too: Reading is closed (evidence-only),
	// Writing accepts a normal write under the existing epoch contract.
	c := f.candidates[0]
	save := func(writeID, questionID string) error {
		_, err := svc.saver.SaveResponses(ctx, c.Token, attempts.SaveResponsesCommand{
			AttemptID: c.AttemptID, LeaseEpoch: 1, ControlEpoch: 1,
			Commands: []attempts.ResponseCommand{{WriteID: writeID, QuestionID: questionID, ClientVersion: 1, Response: attempts.ResponsePayload{Answer: "A"}}},
		}, v2Resolver{}, v2Locker{})
		return err
	}
	err = save("shared-r1", f.questions["reading"][0])
	var appErr *apperrors.Error
	if !errors.As(err, &appErr) || appErr.Details["reason"] != attempts.ReasonIELTSSectionClosed || appErr.Details["sectionKey"] != "reading" {
		t.Fatalf("stale Reading write was not refused by the timetable: %v", err)
	}
	if err := save("shared-w1", f.questions["writing"][0]); err != nil {
		t.Fatalf("scheduled Writing write refused: %v", err)
	}

	// The projector materializes the exact timetable instants, once.
	if _, err := svc.staff.ReconcileExpiredSections(ctx, time.Now().UTC(), 50, "test"); err != nil {
		t.Fatal(err)
	}
	var readingEnd, writingStart time.Time
	var active string
	if err := f.db.QueryRow(`SELECT (SELECT actual_end_at FROM exam_session_runtime_sections WHERE runtime_id = r.id AND section_key = 'reading'),
		(SELECT actual_start_at FROM exam_session_runtime_sections WHERE runtime_id = r.id AND section_key = 'writing'), r.active_section_key
		FROM exam_session_runtimes r WHERE r.id = ?`, f.runtimeID).Scan(&readingEnd, &writingStart, &active); err != nil {
		t.Fatal(err)
	}
	if active != "writing" || !readingEnd.Equal(reading.SaveUntil) || !writingStart.Equal(writing.StartAt) {
		t.Fatalf("projection drifted from the timetable: active=%s end=%s start=%s", active, readingEnd, writingStart)
	}
	epochs := map[string]int{}
	for _, cand := range f.candidates {
		var deadline time.Time
		var epoch int
		if err := f.db.QueryRow(`SELECT deadline_at, control_epoch FROM student_attempts WHERE id = ?`, cand.AttemptID).Scan(&deadline, &epoch); err != nil {
			t.Fatal(err)
		}
		if !deadline.Equal(writing.DeadlineAt) {
			t.Fatalf("attempt %s has its own deadline %s, want %s", cand.AttemptID, deadline, writing.DeadlineAt)
		}
		epochs[cand.AttemptID] = epoch
	}
	var revision int64
	if err := f.db.QueryRow(`SELECT revision FROM exam_session_runtimes WHERE id = ?`, f.runtimeID).Scan(&revision); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.staff.ReconcileExpiredSections(ctx, time.Now().UTC(), 50, "test"); err != nil {
		t.Fatal(err)
	}
	var again int64
	if err := f.db.QueryRow(`SELECT revision FROM exam_session_runtimes WHERE id = ?`, f.runtimeID).Scan(&again); err != nil {
		t.Fatal(err)
	}
	for _, cand := range f.candidates {
		var epoch int
		_ = f.db.QueryRow(`SELECT control_epoch FROM student_attempts WHERE id = ?`, cand.AttemptID).Scan(&epoch)
		if epoch != epochs[cand.AttemptID] {
			t.Fatalf("a replayed projection bumped the epoch again")
		}
	}
	if again != revision {
		t.Fatalf("a replayed projection moved the runtime revision %d -> %d", revision, again)
	}
}

// failingOutbox fails the final step of Start, after the timetable was stored.
type failingOutbox struct{}

func (failingOutbox) EnqueueInTx(context.Context, tx.Tx, string, string, int64, string, json.RawMessage) error {
	return errors.New("injected outbox failure")
}

func sharedPlanner(plan []examruntime.PlanEntry) examruntime.StartPlanner {
	return func(context.Context, tx.Tx, examruntime.StartSchedule) ([]examruntime.PlanEntry, string, error) {
		return plan, examruntime.TimingModelIELTSSharedSchedule, nil
	}
}

func resetToScheduled(t *testing.T, f ieltsLoadFixture) {
	t.Helper()
	for _, q := range []string{
		`DELETE FROM exam_session_runtime_sections WHERE runtime_id = ?`,
		`DELETE FROM exam_session_runtimes WHERE id = ?`,
	} {
		if _, err := f.db.Exec(q, f.runtimeID); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := f.db.Exec(`UPDATE exam_schedules SET status = 'scheduled', ielts_timing_model = ? WHERE id = ?`, examruntime.TimingModelIELTSSharedSchedule, f.scheduleID); err != nil {
		t.Fatal(err)
	}
}

func TestIELTSSharedScheduleStartPauseResumeMySQL(t *testing.T) {
	f := seedIELTSLoadFixture(t, 3, 1, []string{"reading", "writing"}, 1)
	ctx := context.Background()
	resetToScheduled(t, f)
	plan := []examruntime.PlanEntry{
		{SectionKey: "reading", Label: "Reading", Order: 0, DurationMinutes: 60},
		{SectionKey: "writing", Label: "Writing", Order: 1, DurationMinutes: 60, GapAfterMinutes: 0},
	}
	runner := tx.NewRunner(f.db)

	// A failure after the timetable is written rolls the whole Start back.
	if _, err := examruntime.NewService(runner, failingOutbox{}).Start(ctx, f.scheduleID, "proctor-1", sharedPlanner(plan)); err == nil {
		t.Fatal("injected failure did not fail Start")
	}
	var runtimes int
	var status string
	if err := f.db.QueryRow(`SELECT (SELECT COUNT(*) FROM exam_session_runtimes WHERE schedule_id = s.id), s.status FROM exam_schedules s WHERE s.id = ?`, f.scheduleID).Scan(&runtimes, &status); err != nil {
		t.Fatal(err)
	}
	if runtimes != 0 || status != "scheduled" {
		t.Fatalf("partial Start committed: runtimes=%d status=%s", runtimes, status)
	}
	// A plan the timetable cannot represent is refused before anything commits.
	bad := append([]examruntime.PlanEntry{}, plan...)
	bad[1].DurationMinutes = 0
	if _, err := examruntime.NewService(runner, nil).Start(ctx, f.scheduleID, "proctor-1", sharedPlanner(bad)); err == nil {
		t.Fatal("non-positive duration accepted")
	}

	room := examruntime.NewService(runner, nil)
	before := sharedFixtureNow(t, f)
	runtimeID, err := room.Start(ctx, f.scheduleID, "proctor-1", sharedPlanner(plan))
	if err != nil {
		t.Fatal(err)
	}
	schedule := loadSharedSchedule(t, f, runtimeID)
	first := schedule.Windows[0]
	if lead := first.StartAt.Sub(before); lead < examruntime.IELTSSharedDeliveryLead || lead > examruntime.IELTSSharedDeliveryLead+5*time.Second {
		t.Fatalf("first window lead %s", lead)
	}
	var rowStart, projectedEnd time.Time
	if err := f.db.QueryRow(`SELECT actual_start_at, projected_end_at FROM exam_session_runtime_sections WHERE runtime_id = ? AND section_key = 'reading'`, runtimeID).Scan(&rowStart, &projectedEnd); err != nil {
		t.Fatal(err)
	}
	if !rowStart.Equal(first.StartAt) || !projectedEnd.Equal(first.SaveUntil) {
		t.Fatalf("row projection %s/%s != timetable %s/%s", rowStart, projectedEnd, first.StartAt, first.SaveUntil)
	}
	assertSharedDeadlines(t, f, first.DeadlineAt)

	// Pause before the first start: the whole timetable moves, no time awarded.
	if err := room.Pause(ctx, f.scheduleID, examruntime.RevisionFence{}, nil, "proctor-1"); err != nil {
		t.Fatal(err)
	}
	time.Sleep(1100 * time.Millisecond)
	if err := room.Resume(ctx, f.scheduleID, examruntime.RevisionFence{}, "proctor-1"); err != nil {
		t.Fatal(err)
	}
	if err := room.Resume(ctx, f.scheduleID, examruntime.RevisionFence{}, "proctor-1"); err == nil {
		t.Fatal("duplicate resume accepted")
	}
	resumed := loadSharedSchedule(t, f, runtimeID)
	shift := resumed.Windows[0].StartAt.Sub(first.StartAt)
	if shift < time.Second || shift%time.Second != 0 || resumed.ScheduleRevision != 3 {
		t.Fatalf("pause credit %s revision %d", shift, resumed.ScheduleRevision)
	}
	for i, w := range resumed.Windows {
		if w.DeadlineAt.Sub(w.StartAt) != schedule.Windows[i].DeadlineAt.Sub(schedule.Windows[i].StartAt) {
			t.Fatalf("window %d duration changed", i)
		}
	}
	if err := f.db.QueryRow(`SELECT actual_start_at FROM exam_session_runtime_sections WHERE runtime_id = ? AND section_key = 'reading'`, runtimeID).Scan(&rowStart); err != nil {
		t.Fatal(err)
	}
	if !rowStart.Equal(resumed.Windows[0].StartAt) {
		t.Fatalf("row start %s != timetable %s", rowStart, resumed.Windows[0].StartAt)
	}
	assertSharedDeadlines(t, f, resumed.Windows[0].DeadlineAt)

	// Readiness only reports the committed window; it never moves it.
	c := f.candidates[0]
	ready := true
	rtt := 50
	got, err := room.ReadyCohortSection(ctx, f.scheduleID, "reading", c.AttemptID, c.UserID, &rtt, examruntime.IELTSReadinessSignals{ContentReady: &ready, LocalStorageReady: &ready})
	if err != nil || got.StartedAt == nil || !got.StartedAt.Equal(resumed.Windows[0].StartAt) {
		t.Fatalf("readiness moved or hid the timetable: %+v %v", got, err)
	}
	if after := loadSharedSchedule(t, f, runtimeID); after.ScheduleRevision != resumed.ScheduleRevision {
		t.Fatal("readiness changed the timetable")
	}

	// Completing the room ends the timetable in the same statement.
	if err := room.Complete(ctx, f.scheduleID, "proctor_complete", "proctor-1"); err != nil {
		t.Fatal(err)
	}
	if ended := loadSharedSchedule(t, f, runtimeID); ended.Status != examruntime.SharedScheduleEnded || ended.ScheduleRevision != resumed.ScheduleRevision+1 {
		t.Fatalf("completion did not end the timetable: %+v", ended)
	}
}

func assertSharedDeadlines(t *testing.T, f ieltsLoadFixture, want time.Time) {
	t.Helper()
	for _, c := range f.candidates {
		var deadline time.Time
		if err := f.db.QueryRow(`SELECT deadline_at FROM student_attempts WHERE id = ?`, c.AttemptID).Scan(&deadline); err != nil {
			t.Fatal(err)
		}
		if !deadline.Equal(want) {
			t.Fatalf("attempt %s deadline %s, want shared %s", c.AttemptID, deadline, want)
		}
	}
}

// Readiness, response writes and two projector passes race across the same
// committed boundary. One transition commits, every epoch moves once, and a
// write either lands or is fenced by the existing epoch contract.
func TestIELTSSharedScheduleBoundaryRaceMySQL(t *testing.T) {
	f := seedIELTSLoadFixture(t, 3, 1, []string{"reading", "writing"}, 2)
	svc := newIELTSBudgetServices(t, false, false)
	ctx := context.Background()
	schedule := convertToSharedRoom(t, f)
	writing, _ := schedule.WindowFor("writing")
	ready := true
	signals := examruntime.IELTSReadinessSignals{ContentReady: &ready, LocalStorageReady: &ready}
	start := make(chan struct{})
	errs := make(chan error, 16)
	run := func(name string, fn func() error) {
		go func() {
			<-start
			if err := fn(); err != nil {
				errs <- errors.New(name + ": " + err.Error())
				return
			}
			errs <- nil
		}()
	}
	jobs := 0
	for i, c := range f.candidates {
		c, i := c, i
		rtt := 20
		run("ready", func() error {
			_, err := svc.room.ReadyCohortSection(ctx, f.scheduleID, "writing", c.AttemptID, c.UserID, &rtt, signals)
			return err
		})
		run("save", func() error {
			_, err := svc.saver.SaveResponses(ctx, c.Token, attempts.SaveResponsesCommand{
				AttemptID: c.AttemptID, LeaseEpoch: 1, ControlEpoch: 1,
				Commands: []attempts.ResponseCommand{{WriteID: "race-w-" + string(rune('a'+i)), QuestionID: f.questions["writing"][0], ClientVersion: 1, Response: attempts.ResponsePayload{Answer: "A"}}},
			}, v2Resolver{}, v2Locker{})
			var appErr *apperrors.Error
			if errors.As(err, &appErr) && appErr.Code == apperrors.CodeControlEpochStale {
				return nil
			}
			return err
		})
		jobs += 2
	}
	for range 2 {
		run("reconcile", func() error {
			_, err := svc.staff.ReconcileExpiredSections(ctx, time.Now().UTC(), 50, "race")
			return err
		})
		jobs++
	}
	close(start)
	for range jobs {
		if err := <-errs; err != nil {
			t.Fatalf("racing operation failed: %v", err)
		}
	}
	var started int
	var writingStart time.Time
	if err := f.db.QueryRow(`SELECT COUNT(*) FROM session_audit_logs WHERE schedule_id = ? AND action_type = 'SECTION_START'`, f.scheduleID).Scan(&started); err != nil {
		t.Fatal(err)
	}
	if err := f.db.QueryRow(`SELECT actual_start_at FROM exam_session_runtime_sections WHERE runtime_id = ? AND section_key = 'writing'`, f.runtimeID).Scan(&writingStart); err != nil {
		t.Fatal(err)
	}
	if started != 1 || !writingStart.Equal(writing.StartAt) {
		t.Fatalf("transitions=%d start=%s want one at %s", started, writingStart, writing.StartAt)
	}
	for _, c := range f.candidates {
		var epoch int
		if err := f.db.QueryRow(`SELECT control_epoch FROM student_attempts WHERE id = ?`, c.AttemptID).Scan(&epoch); err != nil {
			t.Fatal(err)
		}
		if epoch != 2 {
			t.Fatalf("attempt epoch %d, want exactly one bump", epoch)
		}
	}
}
