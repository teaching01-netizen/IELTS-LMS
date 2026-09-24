package integration

// Real-MySQL verification of the SAT section-advance path — the surface the
// reported bug actually lives on.
//
// The reported symptom: a candidate who finishes Module 2 of section 1 does not
// reach the break at the authored boundary, because the section clock was
// authored as Module 1 + BOTH Module 2 branches (96 minutes of Reading &
// Writing, 105 of Math) while a candidate sits Module 1 + one branch (64 / 70).
//
// This test drives the REAL path end to end against MySQL:
//
//	exams.Create -> authoring blueprint (assessment_sections + assessment_modules)
//	  -> exams.Publish -> schedules.Create
//	  -> schedules.ApplyRuntimeCommand(start)          [runtimePlanIn + runtime.Start]
//	  -> proctor.ReconcileExpiredSections(asOf)        [the advance state machine]
//
// and observes when the between-sections window opens (exam_session_runtimes
// .waiting_for_next_section, the flag the student's break screen keys on) for:
//
//	A. the candidate-length clock (64 / 70) — the break must open at the authored
//	   boundary plus the 30s closing grace;
//	B. the pre-repair snapshot (96 / 105) — the reported symptom, reproduced;
//	C. an accumulated proctor pause and a proctor extension — the boundary moves
//	   with the clock the candidates are on;
//	D. migration 0067 repairing a not-yet-started runtime row, after which that
//	   section runs its candidate length.
//
// It then takes the staff session-detail read (proctor.GetSessionDetail, the
// body of GET /proctor/sessions/{scheduleID}) and dumps the payload for the
// browser-side projection check.
//
// Nothing here changes production behavior: the only writes are fixture rows in
// the test database plus the timestamps a test must stage to decide "before"
// and "after" a boundary.
//
// Two clock facts shape the fixture. First, the SAT branch of the reconciler
// takes its decision instant from the database clock (UTC_TIMESTAMP(6)) rather
// than from the caller's asOf, so a section close cannot race the save grace;
// "just inside the boundary" therefore cannot be chosen by passing an asOf in
// the past — it is chosen by moving the section's start relative to the clock the
// decision is taken on (see stage). Second, a SAT section closes at its authored
// boundary plus attempts.SATSaveGrace, so every boundary asserted below is the
// start the subtest staged plus that grace.
//
// Timeline model: this file verifies the deployed cohort_section_v3 advance —
// section clocks expire and the room then waits out the authored gap. Newly
// created SAT schedules opt into the attempt-owned model, where a section clock
// never expires, so the fixture pins its schedules to the cohort model before
// starting them.

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"example.com/ielts-proctoring/internal/attempts"
	"example.com/ielts-proctoring/internal/authoring"
	"example.com/ielts-proctoring/internal/exams"
	"example.com/ielts-proctoring/internal/platform/tx"
	"example.com/ielts-proctoring/internal/proctor"
	"example.com/ielts-proctoring/internal/schedules"
	"github.com/google/uuid"
)

const verifyDefaultDumpPath = "/tmp/sat-session-detail.json"

// applyRepair0067 executes the shipped repair migration exactly as written, so
// the repair under test is the file that ships rather than a copy in the test.
func applyRepair0067(t *testing.T, db *sql.DB) {
	t.Helper()
	var body []byte
	var err error
	for _, dir := range []string{
		filepath.Join("..", "migrations"),
		filepath.Join("..", "..", "migrations"),
	} {
		body, err = os.ReadFile(filepath.Join(dir, "0067_sat_runtime_section_candidate_duration.sql"))
		if err == nil {
			break
		}
	}
	if err != nil {
		t.Fatalf("read 0067 migration: %v", err)
	}
	// The file's own commentary contains semicolons, so drop whole-line `--`
	// comments before splitting on statement terminators.
	code := make([]string, 0)
	for _, line := range strings.Split(string(body), "\n") {
		if strings.HasPrefix(strings.TrimSpace(line), "--") {
			continue
		}
		code = append(code, line)
	}
	for _, stmt := range strings.Split(strings.Join(code, "\n"), ";") {
		if strings.TrimSpace(stmt) == "" {
			continue
		}
		if _, err := db.ExecContext(context.Background(), stmt); err != nil {
			t.Fatalf("apply 0067 statement: %v (%.120q)", err, stmt)
		}
	}
}

type satSectionRoom struct {
	Key       string
	Status    string
	Planned   int
	Extension int
	Paused    int
	Gap       int
	StartAt   *time.Time
	EndAt     *time.Time
}

func (s satSectionRoom) String() string {
	stamp := func(t *time.Time) string {
		if t == nil {
			return "—"
		}
		return t.UTC().Format("15:04:05")
	}
	return fmt.Sprintf(
		"%-15s status=%-9s planned=%3d ext=%d paused=%4ds gap=%2dm start=%s end=%s",
		s.Key, s.Status, s.Planned, s.Extension, s.Paused, s.Gap, stamp(s.StartAt), stamp(s.EndAt),
	)
}

type satRoomState struct {
	RuntimeStatus string
	Waiting       bool
	Overrun       bool
	ActiveKey     string
	Remaining     int64
	Sections      []satSectionRoom
}

func (st satRoomState) section(key string) satSectionRoom {
	for _, s := range st.Sections {
		if s.Key == key {
			return s
		}
	}
	return satSectionRoom{Key: key}
}

type satAdvanceFixture struct {
	t         *testing.T
	db        *sql.DB
	examSvc   *exams.Service
	schedules *schedules.Service
	proctor   *proctor.Service
	actor     string
	examID    string
	versionID string
	created   []string
}

func newSATAdvanceFixture(t *testing.T) *satAdvanceFixture {
	t.Helper()
	db := testDB(t)
	ctx := context.Background()
	runner := tx.NewRunner(db)
	actor := "advance-verify-" + uuid.NewString()
	provider := "sat"

	f := &satAdvanceFixture{
		t:         t,
		db:        db,
		examSvc:   exams.NewService(db, runner),
		schedules: schedules.NewService(db, runner),
		proctor:   proctor.NewService(runner, db, nil, nil, nil),
		actor:     actor,
	}

	exam, err := f.examSvc.Create(ctx, exams.CreateRequest{
		Slug:        actor,
		Title:       "SAT section advance verification",
		ExamType:    "Academic",
		Visibility:  "private",
		ProviderKey: &provider,
		OwnerID:     actor,
	})
	if err != nil {
		t.Fatalf("create SAT exam: %v", err)
	}
	f.examID = exam.ID

	// The real blueprint: two sections with Module 1 + both Module 2 branches.
	// Publish enforces full-size modules (27 RW / 22 Math), so load a
	// complete valid sample through the real replacement path instead of a
	// single-question stub.
	shell, err := authoring.NewService(db, runner).Shell(ctx, exam.ID)
	if err != nil {
		t.Fatalf("authoring shell: %v", err)
	}
	authors := authoring.NewService(db, runner)
	sample := buildSectionAdvanceSample(shell)
	if _, err := authors.LoadSampleExam(ctx, exam.ID, authoring.LoadSampleExamRequest{
		ExpectedVersionID:       shell.VersionID,
		ExpectedVersionRevision: shell.VersionRevision,
		Modules:                 sample,
	}, actor); err != nil {
		t.Fatalf("load full-size SAT sample: %v", err)
	}
	current, err := authors.Shell(ctx, exam.ID)
	if err != nil {
		t.Fatalf("authoring shell (reopened): %v", err)
	}
	published, err := f.examSvc.Publish(ctx, exam.ID, actor, exams.PublishRequest{
		Revision:               exam.Revision,
		ExpectedDraftVersionID: &current.VersionID,
		ExpectedDraftRevision:  &current.VersionRevision,
	})
	if err != nil {
		t.Fatalf("publish version: %v", err)
	}
	f.versionID = published.ID
	t.Cleanup(f.cleanup)
	return f
}

// buildSectionAdvanceSample generates a full-size, publish-valid SAT sample:
// every module carries exactly its blueprint target count with two pretests.
// Minimal but valid content (visible prompt, four-option single-choice
// answer, matching section metadata) through the real LoadSampleExam path,
// mirroring the frontend buildCompleteSatSample.
func buildSectionAdvanceSample(shell authoring.Shell) []authoring.SampleExamModuleDraft {
	textContent := func(text string) json.RawMessage {
		raw, _ := json.Marshal(map[string]any{
			"version": 1,
			"nodes":   []any{map[string]any{"type": "text", "text": text}},
		})
		return raw
	}
	option := func(id string) any {
		return map[string]any{"id": id, "content": map[string]any{
			"version": 1,
			"nodes":   []any{map[string]any{"type": "text", "text": "Option " + id}},
		}}
	}
	answer, _ := json.Marshal(map[string]any{
		"kind":            "single_choice",
		"options":         []any{option("A"), option("B"), option("C"), option("D")},
		"correctOptionId": "A",
	})
	empty := json.RawMessage(`{"version":1,"nodes":[]}`)
	modules := make([]authoring.SampleExamModuleDraft, 0, 6)
	for _, section := range shell.Sections {
		domain, skill := "information-and-ideas", "Central Ideas and Details"
		if section.SectionKey == "math" {
			domain, skill = "algebra", "Linear Equations in One Variable"
		}
		metadata, _ := json.Marshal(map[string]any{
			"sectionKey": section.SectionKey, "domain": domain, "skill": skill, "difficulty": "medium",
		})
		for _, module := range section.Modules {
			questions := make([]authoring.QuestionDraft, 0, module.TargetQuestionCount)
			for i := 0; i < module.TargetQuestionCount; i++ {
				questions = append(questions, authoring.QuestionDraft{
					QuestionType:  "single_choice",
					Stimulus:      empty,
					Prompt:        textContent(fmt.Sprintf("%s question %d", module.ModuleKey, i+1)),
					Answer:        answer,
					Rationale:     empty,
					Metadata:      metadata,
					Accessibility: json.RawMessage(`{}`),
					IsPretest:     i < 2,
				})
			}
			modules = append(modules, authoring.SampleExamModuleDraft{
				ModuleID:  module.ID,
				Questions: questions,
			})
		}
	}
	return modules
}

func (f *satAdvanceFixture) cleanup() {
	ctx := context.Background()
	for _, scheduleID := range f.created {
		for _, stmt := range []string{
			"DELETE FROM outbox_events WHERE aggregate_id = ?",
			"DELETE FROM session_audit_logs WHERE schedule_id = ?",
			"DELETE FROM cohort_control_events WHERE schedule_id = ?",
			"DELETE FROM student_attempts WHERE schedule_id = ?",
			"DELETE FROM schedule_registrations WHERE schedule_id = ?",
			"DELETE FROM exam_session_runtime_sections WHERE runtime_id IN (SELECT id FROM exam_session_runtimes WHERE schedule_id = ?)",
			"DELETE FROM exam_session_runtimes WHERE schedule_id = ?",
			"DELETE FROM exam_schedules WHERE id = ?",
		} {
			if _, err := f.db.ExecContext(ctx, stmt, scheduleID); err != nil {
				f.t.Logf("cleanup %.60q for %s: %v", stmt, scheduleID, err)
			}
		}
	}
	if err := f.examSvc.Delete(ctx, f.examID); err != nil {
		f.t.Logf("cleanup exam %s: %v", f.examID, err)
	}
}

// newSchedule pins the published version and starts nothing yet.
func (f *satAdvanceFixture) newSchedule(start time.Time) string {
	f.t.Helper()
	sch, err := f.schedules.Create(context.Background(), schedules.CreateRequest{
		ExamID:             f.examID,
		PublishedVersionID: f.versionID,
		CohortName:         "verify " + uuid.NewString()[:8],
		StartTime:          start,
		EndTime:            start.Add(4 * time.Hour),
		CreatedBy:          f.actor,
	})
	if err != nil {
		f.t.Fatalf("create schedule: %v", err)
	}
	f.created = append(f.created, sch.ID)
	// This file verifies the deployed cohort advance, so pin the schedule to it:
	// a newly created SAT schedule selects sat_personal_v1 (attempt-owned timing,
	// where section clocks never expire), which is a different state machine.
	f.exec(`UPDATE exam_schedules SET sat_timing_model = NULL WHERE id = ?`, sch.ID)
	return sch.ID
}

// start runs the proctor's Start command: runtimePlanIn derives the plan from
// the published version and runtime.Start writes the clock rows.
func (f *satAdvanceFixture) start(scheduleID string) {
	f.t.Helper()
	if _, err := f.schedules.ApplyRuntimeCommand(context.Background(), scheduleID, schedules.RuntimeCommand{
		Action:  schedules.CommandStart,
		ActorID: f.actor,
	}); err != nil {
		f.t.Fatalf("start schedule %s: %v", scheduleID, err)
	}
}

// dbNow reads the clock the SAT reconciler decides with.
func (f *satAdvanceFixture) dbNow() time.Time {
	f.t.Helper()
	var now time.Time
	if err := f.db.QueryRowContext(context.Background(), "SELECT UTC_TIMESTAMP(6)").Scan(&now); err != nil {
		f.t.Fatalf("read database clock: %v", err)
	}
	return now.UTC()
}

// stage rewinds the room to a fresh session with `elapsed` on section 1's clock —
// measured against the database clock, because that is the clock the SAT branch
// decides on — and returns the start instant it wrote. Every boundary this file
// asserts is that start plus the authored length plus attempts.SATSaveGrace.
//
// The rewind is what lets one schedule walk the whole timeline: sections go back
// to locked/live and the runtime back to live on section 1, after which the plan
// derives each later boundary from the start this step staged (section 1 ends at
// start + 64m + grace, Math starts at that end + the authored 10-minute gap, and
// Math ends at its own start + 70m + grace). Staging is the only fixture
// manipulation of the clock; the advance decisions themselves are real.
func (f *satAdvanceFixture) stage(scheduleID string, elapsed time.Duration) time.Time {
	f.t.Helper()
	start := f.dbNow().Add(-elapsed)
	f.exec(`UPDATE exam_session_runtime_sections rs
		JOIN exam_session_runtimes r ON r.id = rs.runtime_id
		SET rs.status = 'locked', rs.actual_start_at = NULL, rs.actual_end_at = NULL,
		    rs.completion_reason = NULL, rs.paused_at = NULL, rs.available_at = NULL
		WHERE r.schedule_id = ?`, scheduleID)
	f.exec(`UPDATE exam_session_runtime_sections rs
		JOIN exam_session_runtimes r ON r.id = rs.runtime_id
		SET rs.status = 'live', rs.actual_start_at = ?, rs.available_at = ?
		WHERE r.schedule_id = ? AND rs.section_key = 'reading-writing'`, start, start, scheduleID)
	f.exec(`UPDATE exam_session_runtimes
		SET status = 'live', active_section_key = 'reading-writing', current_section_key = 'reading-writing',
		    waiting_for_next_section = false, is_overrun = false,
		    actual_start_at = ?, actual_end_at = NULL, updated_at = ?
		WHERE schedule_id = ?`, start, start, scheduleID)
	f.exec(`UPDATE exam_schedules SET status = 'live' WHERE id = ?`, scheduleID)
	return start
}

func (f *satAdvanceFixture) exec(query string, args ...any) {
	f.t.Helper()
	if _, err := f.db.ExecContext(context.Background(), query, args...); err != nil {
		f.t.Fatalf("exec %.80q: %v", query, err)
	}
}

func (f *satAdvanceFixture) state(scheduleID string) satRoomState {
	f.t.Helper()
	ctx := context.Background()
	var st satRoomState
	if err := f.db.QueryRowContext(ctx, `
		SELECT status, waiting_for_next_section, is_overrun,
		       COALESCE(active_section_key, ''), current_section_remaining_seconds
		FROM exam_session_runtimes WHERE schedule_id = ?`, scheduleID).Scan(
		&st.RuntimeStatus, &st.Waiting, &st.Overrun, &st.ActiveKey, &st.Remaining); err != nil {
		f.t.Fatalf("read runtime: %v", err)
	}
	rows, err := f.db.QueryContext(ctx, `
		SELECT rs.section_key, rs.status, rs.planned_duration_minutes, rs.extension_minutes,
		       rs.accumulated_paused_seconds, rs.gap_after_minutes, rs.actual_start_at, rs.actual_end_at
		FROM exam_session_runtime_sections rs
		JOIN exam_session_runtimes r ON r.id = rs.runtime_id
		WHERE r.schedule_id = ?
		ORDER BY rs.section_order`, scheduleID)
	if err != nil {
		f.t.Fatalf("read sections: %v", err)
	}
	defer rows.Close()
	for rows.Next() {
		var s satSectionRoom
		var start, end sql.NullTime
		if err := rows.Scan(&s.Key, &s.Status, &s.Planned, &s.Extension, &s.Paused, &s.Gap, &start, &end); err != nil {
			f.t.Fatalf("scan section: %v", err)
		}
		if start.Valid {
			s.StartAt = &start.Time
		}
		if end.Valid {
			s.EndAt = &end.Time
		}
		st.Sections = append(st.Sections, s)
	}
	return st
}

// detail runs the staff session-detail read (the body of
// GET /proctor/sessions/{scheduleID}) and returns the runtime projection the
// proctor room and the student app both count on.
func (f *satAdvanceFixture) detail(scheduleID string) proctor.SessionRuntime {
	f.t.Helper()
	detail, err := f.proctor.GetSessionDetail(context.Background(), proctor.Actor{
		ID: f.actor, Role: proctor.RoleAdmin, CSRFVerified: true,
	}, scheduleID, 20, 20)
	if err != nil {
		f.t.Fatalf("GetSessionDetail %s: %v", scheduleID, err)
	}
	return detail.Runtime
}

// sweep runs the real reconciler the way the worker does — its own clock as
// asOf, while the SAT branch decides on the database clock — and reports what the
// room holds. `elapsed` is what the subtest staged on section 1's clock, logged
// beside what the database clock then held relative to the staged start.
func (f *satAdvanceFixture) sweep(label string, scheduleID string, elapsed time.Duration, start time.Time) satRoomState {
	f.t.Helper()
	asOf := time.Now().UTC()
	outcomes, err := f.proctor.ReconcileExpiredSections(context.Background(), asOf, 50, "integration-verify")
	if err != nil {
		f.t.Fatalf("%s: reconcile at %s: %v", label, asOf, err)
	}
	st := f.state(scheduleID)
	f.t.Logf("%-32s clk=+%-7s db=+%-7s runtime=%-9s waiting=%-5v active=%-15s  %s",
		label, elapsed.Round(time.Second), asOf.Sub(start).Round(time.Second),
		st.RuntimeStatus, st.Waiting, st.ActiveKey, describeSections(st))
	for _, section := range st.Sections {
		f.t.Logf("%-32s   %s", "", section)
	}
	f.t.Logf("%-32s   reconcile outcomes: %d", "", len(outcomes))
	return st
}

func describeSections(st satRoomState) string {
	parts := make([]string, 0, len(st.Sections))
	for _, s := range st.Sections {
		parts = append(parts, fmt.Sprintf("%s:%s", s.Key, s.Status))
	}
	return strings.Join(parts, " ")
}

// TestSATSectionAdvanceOpensTheBreakAtTheRuntimeClock is the verification this
// pass exists for.
func TestSATSectionAdvanceOpensTheBreakAtTheRuntimeClock(t *testing.T) {
	f := newSATAdvanceFixture(t)
	ctx := context.Background()
	// The schedule's own window, long enough that admission never closes while a
	// subtest walks a section clock. The boundaries under test are staged against
	// the database clock (see stage), not against this instant.
	window := time.Now().UTC().Truncate(time.Second).Add(-6 * time.Hour)

	t.Run("real start derives the candidate-length clock", func(t *testing.T) {
		scheduleID := f.newSchedule(window)
		f.start(scheduleID)
		st := f.state(scheduleID)
		for _, s := range st.Sections {
			t.Logf("runtime plan row: %s", s)
		}
		rw, math := st.section("reading-writing"), st.section("math")
		if rw.Planned != 64 {
			t.Errorf("Reading & Writing must clock Module 1 + one branch (64 min), got %d", rw.Planned)
		}
		if math.Planned != 70 {
			t.Errorf("Math must clock Module 1 + one branch (70 min), got %d", math.Planned)
		}
		if rw.Gap != 10 {
			t.Errorf("the authored 10-minute break after section 1 must be snapshotted, got %d", rw.Gap)
		}
		if st.RuntimeStatus != "live" || rw.Status != "live" {
			t.Fatalf("start must leave the runtime and section 1 live, got runtime=%s section=%s", st.RuntimeStatus, rw.Status)
		}
	})

	t.Run("candidate-length clock opens the break at the authored boundary", func(t *testing.T) {
		scheduleID := f.newSchedule(window)
		f.start(scheduleID)

		// Five seconds inside the clock: section 1 is live, no break is open, and
		// the read publishes the authored 64-minute boundary the client counts to.
		insideElapsed := 64*time.Minute - 5*time.Second
		insideStart := f.stage(scheduleID, insideElapsed)
		before := f.sweep("5s inside the clock", scheduleID, insideElapsed, insideStart)
		if before.section("reading-writing").Status != "live" || before.Waiting {
			t.Errorf("inside the clock the section must still be live and no break open, got %s waiting=%v",
				before.section("reading-writing").Status, before.Waiting)
		}
		// The read the room and the student both use publishes the deadline the
		// client counts to: the staged start + the authored 64 minutes.
		read := f.detail(scheduleID)
		if read.CurrentSectionDeadlineAt == nil || !read.CurrentSectionDeadlineAt.UTC().Equal(insideStart.Add(64*time.Minute)) {
			t.Errorf("the published deadline must be the authored 64-minute boundary, got %v", read.CurrentSectionDeadlineAt)
		}
		if read.NextSectionStartAt != nil {
			t.Errorf("no break may be announced before the boundary, got next start %v", read.NextSectionStartAt)
		}

		// The authored boundary plus the SAT save grace: the section completes and
		// the room enters the authored 10-minute break.
		closeElapsed := 64*time.Minute + attempts.SATSaveGrace + 10*time.Second
		closedStart := f.stage(scheduleID, closeElapsed)
		at := f.sweep("boundary + save grace", scheduleID, closeElapsed, closedStart)
		rw := at.section("reading-writing")
		if rw.Status != "completed" {
			t.Fatalf("at the authored boundary + save grace the section must complete, got %s", rw.Status)
		}
		if !at.Waiting {
			t.Fatal("the break must be open for the room (waiting_for_next_section) at the authored boundary")
		}
		if wantEnd := closedStart.Add(64*time.Minute + attempts.SATSaveGrace); rw.EndAt == nil || !rw.EndAt.UTC().Equal(wantEnd) {
			t.Errorf("section 1 must end at its authored 64-minute boundary + the save grace, want %v, got %v", wantEnd, rw.EndAt)
		}

		// The window holds through the authored gap: the next section's start is
		// still in the future.
		during := f.sweep("inside the 10-minute break", scheduleID, closeElapsed, closedStart)
		if !during.Waiting {
			t.Error("the break must stay open through the authored gap")
		}

		// Once the gap elapses Math goes live, on the timeline the plan preserved
		// rather than at the instant of the sweep.
		mathElapsed := 64*time.Minute + attempts.SATSaveGrace + 10*time.Minute + 10*time.Second
		mathStart := f.stage(scheduleID, mathElapsed)
		after := f.sweep("gap elapsed", scheduleID, mathElapsed, mathStart)
		math := after.section("math")
		if math.Status != "live" {
			t.Fatalf("Math must go live when the authored gap elapses, got %s", math.Status)
		}
		if want := mathStart.Add(64*time.Minute + attempts.SATSaveGrace + 10*time.Minute); math.StartAt == nil || !math.StartAt.UTC().Equal(want) {
			t.Errorf("Math must start at section 1's end + the authored gap, want %v, got %v", want, math.StartAt)
		}
		if after.Waiting {
			t.Error("the break must close when the next section starts")
		}
	})

	t.Run("pre-repair snapshot reproduces the reported symptom", func(t *testing.T) {
		scheduleID := f.newSchedule(window)
		f.start(scheduleID)
		// The production state: the session was started while the authored row
		// still summed Module 1 + BOTH branches. 0065 repaired the authored row;
		// this session's runtime snapshot keeps what it started with.
		f.exec(`UPDATE exam_session_runtime_sections rs JOIN exam_session_runtimes r ON r.id = rs.runtime_id
			SET rs.planned_duration_minutes = 96 WHERE r.schedule_id = ? AND rs.section_key = 'reading-writing'`, scheduleID)

		// The authored 64-minute boundary plus the save grace, and the inflated
		// 96-minute clock is still running, so the room shows no break: the
		// reported symptom.
		boundaryElapsed := 64*time.Minute + attempts.SATSaveGrace
		boundaryStart := f.stage(scheduleID, boundaryElapsed)
		at := f.sweep("authored 64-minute boundary", scheduleID, boundaryElapsed, boundaryStart)
		rw := at.section("reading-writing")
		if rw.Status != "live" {
			t.Fatalf("the inflated snapshot must still hold section 1 live at 64 minutes, got %s", rw.Status)
		}
		if at.Waiting {
			t.Fatal("no break can be open yet — this is the reported symptom (candidates finished Module 2, section 1 still running)")
		}
		// current_section_remaining_seconds on the row is a cache written at the
		// last transition; the read recomputes from the deadline, which is what
		// the client counts. The inflated row publishes 96 minutes from the
		// section's start, so at the authored boundary the board still shows 32
		// minutes of Reading & Writing and no break.
		read := f.detail(scheduleID)
		if read.CurrentSectionDeadlineAt == nil || !read.CurrentSectionDeadlineAt.UTC().Equal(boundaryStart.Add(96*time.Minute)) {
			t.Errorf("the inflated snapshot must publish its 96-minute deadline, got %v", read.CurrentSectionDeadlineAt)
		}
		impliedRemaining := read.CurrentSectionDeadlineAt.Sub(boundaryStart.Add(64 * time.Minute)).Round(time.Second)
		t.Logf("at the authored boundary the room still counts %s of Reading & Writing (waiting=%v, next=%v); the row cache reads %ds",
			impliedRemaining, read.WaitingForNextSection, read.NextSectionStartAt, at.Remaining)
		if impliedRemaining != 32*time.Minute {
			t.Errorf("the inflated clock must leave 32 minutes where the authored clock leaves none, got %s", impliedRemaining)
		}

		// The inflated clock only opens the break 32 minutes late.
		inflatedElapsed := 96*time.Minute + attempts.SATSaveGrace + 10*time.Second
		inflatedStart := f.stage(scheduleID, inflatedElapsed)
		late := f.sweep("inflated 96-minute boundary", scheduleID, inflatedElapsed, inflatedStart)
		if late.section("reading-writing").Status != "completed" || !late.Waiting {
			t.Fatalf("the inflated clock only opens the break 32 minutes late, got section=%s waiting=%v",
				late.section("reading-writing").Status, late.Waiting)
		}
		if end := late.section("reading-writing").EndAt; end == nil ||
			!end.UTC().Equal(inflatedStart.Add(96*time.Minute+attempts.SATSaveGrace)) {
			t.Errorf("the break opens from the inflated end, got %v", end)
		}
	})

	t.Run("pause and extension move the boundary with the clock", func(t *testing.T) {
		// The 5-minute pause moves section 1's boundary from 64 to 69 minutes; the
		// unpublished boundary and the moved one are probed on the same schedule.
		paused := f.newSchedule(window)
		f.start(paused)
		f.exec(`UPDATE exam_session_runtime_sections rs JOIN exam_session_runtimes r ON r.id = rs.runtime_id
			SET rs.accumulated_paused_seconds = 300 WHERE r.schedule_id = ? AND rs.section_key = 'reading-writing'`, paused)

		pausedEarlyElapsed := 64*time.Minute + attempts.SATSaveGrace + 10*time.Second
		pausedEarly := f.stage(paused, pausedEarlyElapsed)
		at := f.sweep("pause: unpaused boundary + grace", paused, pausedEarlyElapsed, pausedEarly)
		if at.section("reading-writing").Status != "live" || at.Waiting {
			t.Errorf("a 5-minute pause must hold section 1 open past its unpaused boundary, got %s waiting=%v",
				at.section("reading-writing").Status, at.Waiting)
		}
		pausedElapsed := 69*time.Minute + attempts.SATSaveGrace + 10*time.Second
		pausedStart := f.stage(paused, pausedElapsed)
		pausedBoundary := f.sweep("pause: 5m past the boundary", paused, pausedElapsed, pausedStart)
		if pausedBoundary.section("reading-writing").Status != "completed" || !pausedBoundary.Waiting {
			t.Errorf("the paused clock must open the break 5 minutes past the boundary, got %s waiting=%v",
				pausedBoundary.section("reading-writing").Status, pausedBoundary.Waiting)
		}
		if end := pausedBoundary.section("reading-writing").EndAt; end == nil ||
			!end.UTC().Equal(pausedStart.Add(69*time.Minute+attempts.SATSaveGrace)) {
			t.Errorf("the paused section must end 5 minutes past its authored boundary, got %v", end)
		}

		extended := f.newSchedule(window)
		f.start(extended)
		f.exec(`UPDATE exam_session_runtime_sections rs JOIN exam_session_runtimes r ON r.id = rs.runtime_id
			SET rs.extension_minutes = 5 WHERE r.schedule_id = ? AND rs.section_key = 'reading-writing'`, extended)

		extEarlyElapsed := 64*time.Minute + attempts.SATSaveGrace + 10*time.Second
		extEarly := f.stage(extended, extEarlyElapsed)
		atExt := f.sweep("extension: authored boundary + grace", extended, extEarlyElapsed, extEarly)
		if atExt.section("reading-writing").Status != "live" || atExt.Waiting {
			t.Errorf("a proctor extension must hold section 1 open, got %s waiting=%v",
				atExt.section("reading-writing").Status, atExt.Waiting)
		}
		extElapsed := 69*time.Minute + attempts.SATSaveGrace + 10*time.Second
		extStart := f.stage(extended, extElapsed)
		extBoundary := f.sweep("extension: 5m past the boundary", extended, extElapsed, extStart)
		if extBoundary.section("reading-writing").Status != "completed" || !extBoundary.Waiting {
			t.Errorf("the extended clock must open the break at the extension's boundary, got %s waiting=%v",
				extBoundary.section("reading-writing").Status, extBoundary.Waiting)
		}
		if end := extBoundary.section("reading-writing").EndAt; end == nil ||
			!end.UTC().Equal(extStart.Add(69*time.Minute+attempts.SATSaveGrace)) {
			t.Errorf("the extended section must end 5 minutes past its authored boundary, got %v", end)
		}
	})

	t.Run("migration 0067 repairs a not-yet-started inflated section", func(t *testing.T) {
		scheduleID := f.newSchedule(window)
		f.start(scheduleID)
		// Math has not started: the pre-repair snapshot overstates it.
		f.exec(`UPDATE exam_session_runtime_sections rs JOIN exam_session_runtimes r ON r.id = rs.runtime_id
			SET rs.planned_duration_minutes = 105 WHERE r.schedule_id = ? AND rs.section_key = 'math'`, scheduleID)
		inflated := f.state(scheduleID).section("math")
		if inflated.Planned != 105 {
			t.Fatalf("fixture must hold Math at 105 before the repair, got %d", inflated.Planned)
		}

		applyRepair0067(t, f.db)
		repaired := f.state(scheduleID).section("math")
		if repaired.Planned != 70 {
			t.Fatalf("0067 must repair the not-started Math clock to 70, got %d", repaired.Planned)
		}
		t.Logf("0067 repair: locked Math clock %d -> %d minutes", inflated.Planned, repaired.Planned)

		// Walking the room forward, the repaired clock is the one Math then runs:
		// section 1 ends at 64 plus the save grace, the break elapses, and Math
		// opens on the timeline the plan preserved.
		breakElapsed := 64*time.Minute + attempts.SATSaveGrace + 10*time.Minute + 10*time.Second
		breakStart := f.stage(scheduleID, breakElapsed)
		f.sweep("break elapsed, Math opens", scheduleID, breakElapsed, breakStart)
		mathStart := breakStart.Add(64*time.Minute + attempts.SATSaveGrace + 10*time.Minute)
		if got := f.state(scheduleID).section("math").StartAt; got == nil || !got.UTC().Equal(mathStart) {
			t.Fatalf("Math must open after the break, want %v, got %v", mathStart, got)
		}

		// Five seconds inside Math's own 70 minutes it is still running...
		earlyElapsed := 64*time.Minute + attempts.SATSaveGrace + 10*time.Minute + 70*time.Minute - 5*time.Second
		earlyStart := f.stage(scheduleID, earlyElapsed)
		early := f.sweep("Math: 5s inside its 70 minutes", scheduleID, earlyElapsed, earlyStart)
		if early.section("math").Status != "live" {
			t.Errorf("the repaired Math clock must run its full 70 minutes, got %s", early.section("math").Status)
		}

		// ...and only completes at its boundary plus the save grace.
		endElapsed := 64*time.Minute + attempts.SATSaveGrace + 10*time.Minute + 70*time.Minute + attempts.SATSaveGrace + 10*time.Second
		endStart := f.stage(scheduleID, endElapsed)
		end := f.sweep("Math: boundary + save grace", scheduleID, endElapsed, endStart)
		math := end.section("math")
		if math.Status != "completed" {
			t.Errorf("Math must complete on its 70-minute clock, got %s", math.Status)
		}
		wantEnd := endStart.Add(64*time.Minute + attempts.SATSaveGrace + 10*time.Minute + 70*time.Minute + attempts.SATSaveGrace)
		if math.EndAt == nil || !math.EndAt.UTC().Equal(wantEnd) {
			t.Errorf("Math must end exactly 70 minutes (plus the save grace) after it started, want %v, got %v", wantEnd, math.EndAt)
		}
	})

	t.Run("staff session detail carries the room's own clock", func(t *testing.T) {
		scheduleID := f.newSchedule(window)
		f.start(scheduleID)
		f.exec(`UPDATE exam_session_runtime_sections rs JOIN exam_session_runtimes r ON r.id = rs.runtime_id
			SET rs.planned_duration_minutes = 96 WHERE r.schedule_id = ? AND rs.section_key = 'reading-writing'`, scheduleID)
		// Mid-way through the inflated section, exactly where the panel was read.
		panelElapsed := 70 * time.Minute
		panelStart := f.stage(scheduleID, panelElapsed)
		f.sweep("panel read instant", scheduleID, panelElapsed, panelStart)

		detail, err := f.proctor.GetSessionDetail(ctx, proctor.Actor{
			ID: f.actor, Role: proctor.RoleAdmin, CSRFVerified: true,
		}, scheduleID, 20, 20)
		if err != nil {
			t.Fatalf("GetSessionDetail: %v", err)
		}
		if detail.Runtime.WaitingForNextSection || detail.Runtime.NextSectionStartAt != nil {
			t.Errorf("the inflated mid-section read must not announce a break: waiting=%v next=%v",
				detail.Runtime.WaitingForNextSection, detail.Runtime.NextSectionStartAt)
		}
		for _, section := range detail.Runtime.Sections {
			t.Logf("detail runtime section: key=%-15s label=%-18s planned=%3d gap=%2dm status=%s",
				section.SectionKey, section.Label, section.PlannedDurationMinutes, section.GapAfterMinutes, section.Status)
		}
		for _, plan := range detail.Runtime.ExamPlan {
			t.Logf("detail examPlan section: key=%-15s label=%-18s length=%3d gap=%2dm modules=%d",
				plan.SectionKey, plan.Label, plan.DurationMinutes, plan.GapAfterMinutes, len(plan.Modules))
		}
		rw, math := detail.Runtime.Sections[0], detail.Runtime.Sections[1]
		if rw.PlannedDurationMinutes != 96 {
			t.Errorf("the room holds 96 minutes for section 1; the detail read must say so, got %d", rw.PlannedDurationMinutes)
		}
		if len(detail.Runtime.ExamPlan) != 2 || detail.Runtime.ExamPlan[0].DurationMinutes != 64 {
			t.Errorf("the authored plan must still carry the candidate length (64), got %+v", detail.Runtime.ExamPlan)
		}
		if math.PlannedDurationMinutes != 70 {
			t.Errorf("Math's runtime clock should be untouched at 70, got %d", math.PlannedDurationMinutes)
		}

		payload, err := json.Marshal(detail)
		if err != nil {
			t.Fatalf("marshal detail: %v", err)
		}
		path := os.Getenv("SAT_VERIFY_DUMP")
		if path == "" {
			path = verifyDefaultDumpPath
		}
		if err := os.WriteFile(path, payload, 0o644); err != nil {
			t.Fatalf("write detail payload: %v", err)
		}
		t.Logf("wrote staff session-detail payload (%d bytes) to %s", len(payload), path)
	})

	t.Run("the same read inside the break window", func(t *testing.T) {
		scheduleID := f.newSchedule(window)
		f.start(scheduleID)
		// The candidate-length session at its own boundary: the section
		// completes and the between-sections window opens.
		windowElapsed := 64*time.Minute + attempts.SATSaveGrace + 10*time.Second
		windowStart := f.stage(scheduleID, windowElapsed)
		st := f.sweep("break window opens", scheduleID, windowElapsed, windowStart)
		if !st.Waiting {
			t.Fatal("the break must be open in the between-sections window")
		}
		runtime := f.detail(scheduleID)
		if !runtime.WaitingForNextSection || runtime.NextSectionStartAt == nil {
			t.Fatalf("the read must announce the break: waiting=%v next=%v",
				runtime.WaitingForNextSection, runtime.NextSectionStartAt)
		}
		if want := windowStart.Add(64*time.Minute + attempts.SATSaveGrace + 10*time.Minute); !runtime.NextSectionStartAt.UTC().Equal(want) {
			t.Errorf("the announced start must be section 1's end + the authored gap, want %v, got %v", want, runtime.NextSectionStartAt)
		}
		t.Logf("break window: waiting=%v next section starts=%v (section 1 ended %v)",
			runtime.WaitingForNextSection, runtime.NextSectionStartAt, runtime.Sections[0].ActualEndAt)

		payload, err := json.Marshal(runtime)
		if err != nil {
			t.Fatalf("marshal runtime: %v", err)
		}
		path := os.Getenv("SAT_VERIFY_BREAK_DUMP")
		if path == "" {
			path = "/tmp/sat-session-break-open.json"
		}
		if err := os.WriteFile(path, payload, 0o644); err != nil {
			t.Fatalf("write break payload: %v", err)
		}
		t.Logf("wrote between-sections runtime payload (%d bytes) to %s", len(payload), path)
	})
}
