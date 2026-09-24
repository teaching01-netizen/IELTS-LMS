package main

// Real-DB proof for runtime Start's lock order and version fence (CONC-002 /
// CONC-003). sqlmock pins the statement contract (internal/runtime); only
// InnoDB row locks can prove the interleavings. Gated on TEST_MYSQL_DSN with a
// unique actor + exam per run and best-effort cleanup, mirroring
// contracts_mysql_test.go and authoring_concurrency_mysql_test.go.
//
// Two facts are proven against a live InnoDB:
//
//  1. Start takes the schedule row FIRST and plans from what it finds under
//     that lock. A second connection holds the row the way a schedule edit (or
//     a check-in) does; Start must not have planned anything while the row is
//     held, and once the holder switches the version and commits, Start plans
//     from — and goes live on — the new version. The old state
//     (schedule = V2, runtime plan = V1) is unreachable.
//  2. Start and CreateScheduleAttempt overlap without an InnoDB deadlock, with
//     every attempt governed by the live runtime's clock whichever side won.
//     Neither path runs under a retrying transaction, and the retry hook is
//     installed anyway so an absorbed transient would still be visible.

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"example.com/ielts-proctoring/internal/authoring"
	"example.com/ielts-proctoring/internal/exams"
	"example.com/ielts-proctoring/internal/platform/tx"
	examruntime "example.com/ielts-proctoring/internal/runtime"
	"example.com/ielts-proctoring/internal/schedules"
	_ "github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
)

type startRaceHarness struct {
	db        *sql.DB
	schedules *schedules.Service
	runtime   *examruntime.Service
	actor     string
	examID    string
	v1        string
	v2        string
	seq       atomic.Int64
	created   []string
	createdMu sync.Mutex
}

func newStartRaceHarness(t *testing.T) *startRaceHarness {
	t.Helper()
	dsn := os.Getenv("TEST_MYSQL_DSN")
	if dsn == "" {
		t.Skip("TEST_MYSQL_DSN not set; requires isolated MySQL")
	}
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	ctx := context.Background()
	runner := tx.NewRunner(db)
	examService := exams.NewService(db, runner)
	authors := authoring.NewService(db, runner)
	actor := "start-race-" + uuid.NewString()
	provider := "sat"
	exam, err := examService.Create(ctx, exams.CreateRequest{Slug: actor, Title: "Start race proof", ExamType: "Academic", Visibility: "private", ProviderKey: &provider, OwnerID: actor})
	if err != nil {
		t.Fatal(err)
	}
	h := &startRaceHarness{
		db:        db,
		schedules: schedules.NewService(db, runner),
		runtime:   examruntime.NewService(runner, nil),
		actor:     actor,
		examID:    exam.ID,
	}
	t.Cleanup(func() {
		// Best-effort, dependency-ordered. A leftover row is logged rather
		// than failing the run: the schema's cascade rules are not this
		// test's contract.
		h.createdMu.Lock()
		ids := append([]string(nil), h.created...)
		h.createdMu.Unlock()
		for _, scheduleID := range ids {
			for _, stmt := range []string{
				"DELETE FROM cohort_control_events WHERE schedule_id = ?",
				"DELETE FROM exam_session_runtime_sections WHERE runtime_id IN (SELECT id FROM exam_session_runtimes WHERE schedule_id = ?)",
				"DELETE FROM exam_session_runtimes WHERE schedule_id = ?",
				"DELETE FROM student_attempts WHERE schedule_id = ?",
				"DELETE FROM schedule_registrations WHERE schedule_id = ?",
				"DELETE FROM exam_schedules WHERE id = ?",
			} {
				if _, err := db.Exec(stmt, scheduleID); err != nil {
					t.Logf("cleanup %q for %s: %v", stmt, scheduleID, err)
				}
			}
		}
		if err := examService.Delete(ctx, exam.ID); err != nil {
			t.Logf("cleanup exam %s: %v", exam.ID, err)
		}
		if _, err := db.Exec("DELETE FROM assessment_questions WHERE created_by = ?", actor); err != nil {
			t.Logf("cleanup questions for %s: %v", actor, err)
		}
	})

	// V1: a publishable SAT draft. This proof is about the schedule lock and the
	// version fence, not question content, so every module carries one valid
	// question at a matching target (makeSATDraftPublishable); the published
	// version still holds the real SAT sections, modules and authored lengths.
	makeSATDraftPublishable(t, ctx, db, authors, actor, exam.ID)
	current, err := authors.Shell(ctx, exam.ID)
	if err != nil {
		t.Fatal(err)
	}
	v1, err := examService.Publish(ctx, exam.ID, actor, exams.PublishRequest{Revision: exam.Revision, ExpectedDraftVersionID: &current.VersionID, ExpectedDraftRevision: &current.VersionRevision})
	if err != nil {
		t.Fatal(err)
	}
	// V2: reopen the draft (which clones the published version), add a second
	// question to the first module and raise that module's target to match, then
	// publish again. Only the fence is under test; the version must just differ.
	reopened, err := authors.OpenShell(ctx, exam.ID, actor)
	if err != nil {
		t.Fatal(err)
	}
	reopenedModule := reopened.Sections[0].Modules[0].ID
	if _, err := db.ExecContext(ctx, "UPDATE assessment_modules SET target_question_count = 2 WHERE id = ?", reopenedModule); err != nil {
		t.Fatal(err)
	}
	if _, err := authors.CreateQuestion(ctx, reopenedModule, actor, validSATPublishSPR()); err != nil {
		t.Fatal(err)
	}
	latest, err := authors.Shell(ctx, exam.ID)
	if err != nil {
		t.Fatal(err)
	}
	v2, err := examService.Publish(ctx, exam.ID, actor, exams.PublishRequest{Revision: latest.VersionRevision})
	if err != nil {
		t.Fatal(err)
	}
	if v1.ID == v2.ID {
		t.Fatalf("the two publishes must produce distinct versions, both were %s", v1.ID)
	}
	h.v1, h.v2 = v1.ID, v2.ID
	return h
}

func (h *startRaceHarness) newSchedule(t *testing.T, versionID string) schedules.Schedule {
	t.Helper()
	start := time.Now().UTC().Add(time.Hour).Truncate(time.Second)
	sch, err := h.schedules.Create(context.Background(), schedules.CreateRequest{
		ExamID:             h.examID,
		PublishedVersionID: versionID,
		CohortName:         "start race " + uuid.NewString()[:8],
		StartTime:          start,
		EndTime:            start.Add(3 * time.Hour),
		CreatedBy:          h.actor,
	})
	if err != nil {
		t.Fatal(err)
	}
	h.createdMu.Lock()
	h.created = append(h.created, sch.ID)
	h.createdMu.Unlock()
	// Both proofs here assert that the live runtime's clock governs every
	// attempt, which is the cohort model. A newly created SAT schedule selects
	// sat_personal_v1, where each attempt owns its own module and break deadline
	// and no cohort deadline is written, so pin the deployed cohort model.
	if _, err := h.db.ExecContext(context.Background(), "UPDATE exam_schedules SET sat_timing_model = NULL WHERE id = ?", sch.ID); err != nil {
		t.Fatal(err)
	}
	return sch
}

func (h *startRaceHarness) register(t *testing.T, scheduleID string) schedules.Registration {
	t.Helper()
	n := h.seq.Add(1)
	reg, err := h.schedules.CreateRegistration(context.Background(), scheduleID, schedules.RegistrationRequest{
		Wcode:       fmt.Sprintf("W%06d", 100000+n),
		Email:       fmt.Sprintf("race-%d-%s@example.com", n, uuid.NewString()[:8]),
		StudentName: "Race Student",
		// user_id is varchar(36): the registration carries the bare uuid.
		UserID: uuid.NewString(),
	})
	if err != nil {
		t.Fatal(err)
	}
	return reg
}

func isInnoDBDeadlock(err error) bool {
	if err == nil {
		return false
	}
	s := strings.ToLower(err.Error())
	return strings.Contains(s, "1213") || strings.Contains(s, "deadlock")
}

func oneSectionPlan() []examruntime.PlanEntry {
	return []examruntime.PlanEntry{{SectionKey: "reading-writing", Label: "Reading and Writing", Order: 0, DurationMinutes: 32}}
}

// TestStartWaitsForTheScheduleLockAndPlansFromTheVersionItFinds is the
// deterministic barrier for CONC-002/003: an editor holds the schedule row,
// Start must block on it BEFORE planning, and after the editor switches the
// version and commits, Start plans from and goes live on that version.
func TestStartWaitsForTheScheduleLockAndPlansFromTheVersionItFinds(t *testing.T) {
	h := newStartRaceHarness(t)
	ctx := context.Background()
	sch := h.newSchedule(t, h.v1)

	// Editor B holds the schedule row, exactly as a schedule edit or a
	// check-in does for the duration of its transaction.
	editor, err := h.db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = editor.Rollback() }()
	var held string
	if err := editor.QueryRowContext(ctx, "SELECT id FROM exam_schedules WHERE id = ? FOR UPDATE", sch.ID).Scan(&held); err != nil {
		t.Fatal(err)
	}

	// Proctor A presses Start while B holds the row.
	plannedFrom := make(chan string, 1)
	done := make(chan error, 1)
	go func() {
		_, err := h.runtime.Start(ctx, sch.ID, h.actor, func(_ context.Context, _ tx.Tx, locked examruntime.StartSchedule) ([]examruntime.PlanEntry, string, error) {
			plannedFrom <- locked.PublishedVersionID
			return oneSectionPlan(), examruntime.TimingModelCohortSection, nil
		})
		done <- err
	}()

	// Schedule-first order: while B holds the row, A cannot have planned. A
	// Start that locked attempts/runtime first and took the schedule last
	// would already be past its planner here.
	select {
	case v := <-plannedFrom:
		t.Fatalf("Start planned (from %s) while the schedule row was held by another transaction", v)
	case err := <-done:
		t.Fatalf("Start finished (%v) while the schedule row was held by another transaction", err)
	case <-time.After(750 * time.Millisecond):
	}

	// B switches the version and commits; A may now proceed.
	if _, err := editor.ExecContext(ctx, "UPDATE exam_schedules SET published_version_id = ?, revision = revision + 1, updated_at = NOW() WHERE id = ?", h.v2, sch.ID); err != nil {
		t.Fatal(err)
	}
	if err := editor.Commit(); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("Start must succeed once the schedule row is released: %v", err)
		}
	case <-time.After(20 * time.Second):
		t.Fatal("Start did not complete after the schedule row was released")
	}
	var planned string
	select {
	case planned = <-plannedFrom:
	case <-time.After(2 * time.Second):
		t.Fatal("Start returned success without ever planning (idempotent path taken on a schedule with no runtime)")
	}
	if planned != h.v2 {
		t.Fatalf("Start planned from %s, but the schedule it made live names %s", planned, h.v2)
	}

	var status, version string
	if err := h.db.QueryRowContext(ctx, "SELECT status, published_version_id FROM exam_schedules WHERE id = ?", sch.ID).Scan(&status, &version); err != nil {
		t.Fatal(err)
	}
	if status != schedules.StatusLive || version != h.v2 {
		t.Fatalf("schedule must be live on the version Start planned from, got %s/%s (planned %s)", status, version, planned)
	}
	var liveRuntimes int
	if err := h.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM exam_session_runtimes WHERE schedule_id = ? AND status = 'live'", sch.ID).Scan(&liveRuntimes); err != nil {
		t.Fatal(err)
	}
	if liveRuntimes != 1 {
		t.Fatalf("exactly one live runtime must exist, got %d", liveRuntimes)
	}
}

// TestStartAndCheckInDoNotDeadlock overlaps a proctor Start with a burst of
// student check-ins on fresh schedules, repeatedly. Both paths now take the
// schedule row first, so there is no cycle for InnoDB to break; every attempt
// ends up governed by the live runtime's clock whichever side won the row.
func TestStartAndCheckInDoNotDeadlock(t *testing.T) {
	h := newStartRaceHarness(t)
	ctx := context.Background()
	var absorbed atomic.Int64
	// SetRetryHook returns the restore closure for the hook it installed;
	// deferring it directly is what keeps the counting hook from leaking into
	// later tests in the package.
	defer tx.SetRetryHook(func(error) { absorbed.Add(1) })()

	const rounds = 6
	const students = 4
	for round := 0; round < rounds; round++ {
		sch := h.newSchedule(t, h.v1)
		regs := make([]schedules.Registration, 0, students)
		for i := 0; i < students; i++ {
			regs = append(regs, h.register(t, sch.ID))
		}

		release := make(chan struct{})
		errs := make(chan error, students+1)
		var wg sync.WaitGroup
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-release
			_, err := h.schedules.ApplyRuntimeCommand(ctx, sch.ID, schedules.RuntimeCommand{Action: schedules.CommandStart, ActorID: h.actor})
			errs <- err
		}()
		for _, reg := range regs {
			wg.Add(1)
			go func(reg schedules.Registration) {
				defer wg.Done()
				<-release
				_, err := h.schedules.CreateScheduleAttempt(ctx, sch.ID, reg.ID, reg.StudentKey, reg.Wcode, "Race Student", "race@example.com", "session-"+reg.ID)
				errs <- err
			}(reg)
		}
		close(release)
		wg.Wait()
		close(errs)
		for err := range errs {
			if isInnoDBDeadlock(err) {
				t.Fatalf("round %d: InnoDB deadlock between Start and check-in: %v", round, err)
			}
			if err != nil {
				t.Fatalf("round %d: %v", round, err)
			}
		}

		var status, version string
		if err := h.db.QueryRowContext(ctx, "SELECT status, published_version_id FROM exam_schedules WHERE id = ?", sch.ID).Scan(&status, &version); err != nil {
			t.Fatal(err)
		}
		if status != schedules.StatusLive || version != h.v1 {
			t.Fatalf("round %d: schedule must be live on %s, got %s/%s", round, h.v1, status, version)
		}
		var attempts, ungoverned int
		if err := h.db.QueryRowContext(ctx, "SELECT COUNT(*), COALESCE(SUM(deadline_at IS NULL), 0) FROM student_attempts WHERE schedule_id = ?", sch.ID).Scan(&attempts, &ungoverned); err != nil {
			t.Fatal(err)
		}
		if attempts != students {
			t.Fatalf("round %d: every check-in must mint an attempt, got %d of %d", round, attempts, students)
		}
		if ungoverned != 0 {
			t.Fatalf("round %d: %d attempt(s) have no deadline from the live runtime's clock", round, ungoverned)
		}
	}
	if n := absorbed.Load(); n != 0 {
		t.Fatalf("no transient (deadlock / lock wait) may be absorbed by a retry, %d were", n)
	}
}
