package integration

// One candidate's in-flight transaction must not stall another candidate's
// save (real MySQL; skips without TEST_MYSQL_DSN like the rest of this package).
//
// Every per-student delivery transaction locks the schedule's shared
// exam_session_runtimes row (and, under cohort timing, the active
// exam_session_runtime_sections row) to hold proctor writers off. Those locks
// must be shared: an exclusive lock there serializes the whole room at the
// module boundary, and an S->X upgrade on the late-answer recovery path waits
// on (or deadlocks with) every other candidate's open save. The hold below is
// the exact share lock a concurrent candidate's save holds.

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"example.com/ielts-proctoring/internal/delivery"
	"example.com/ielts-proctoring/internal/platform/tx"
	"example.com/ielts-proctoring/internal/proctor"
)

// sharedRowSaveBudget stays under the student client's 6s close/save timeout:
// a save that only lands after the client gave up is the "succeeded but the UI
// showed an error" symptom.
const sharedRowSaveBudget = 5 * time.Second

// holdSharedRows opens another candidate's transaction holding the runtime
// row (and the section row when sectionKey != "") FOR SHARE until the test ends.
func (f *adaptiveExam) holdSharedRows(t *testing.T, sectionKey string) {
	t.Helper()
	ctx := context.Background()
	held, err := f.db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatalf("begin holder tx: %v", err)
	}
	t.Cleanup(func() { _ = held.Rollback() })
	var runtimeID string
	if err := held.QueryRowContext(ctx,
		"SELECT id FROM exam_session_runtimes WHERE schedule_id = ? FOR SHARE", f.scheduleID).Scan(&runtimeID); err != nil {
		t.Fatalf("holder runtime lock: %v", err)
	}
	if sectionKey == "" {
		return
	}
	var sectionID string
	if err := held.QueryRowContext(ctx,
		"SELECT id FROM exam_session_runtime_sections WHERE runtime_id = ? AND section_key = ? FOR SHARE",
		runtimeID, sectionKey).Scan(&sectionID); err != nil {
		t.Fatalf("holder section lock: %v", err)
	}
}

// seedTimedOutStudent seeds a candidate whose Module 1 the worker already
// finalized as time_expired while its clock still has time left, so a save
// for it takes the timeout-recovery path. Returns the attempt and the module
// attempt id the client sends with the late answer.
func (f *adaptiveExam) seedTimedOutStudent(t *testing.T) (attemptID, moduleAttemptID string) {
	t.Helper()
	ctx := context.Background()
	attemptID = f.seedStudent(f.rw, 0, false)
	f.openWriterSession(t, attemptID)
	if err := f.db.QueryRowContext(ctx,
		"SELECT id FROM assessment_module_attempts WHERE attempt_id = ? AND module_id = ?",
		attemptID, f.rw.baseID).Scan(&moduleAttemptID); err != nil {
		t.Fatalf("read base module attempt: %v", err)
	}
	if _, err := f.db.ExecContext(ctx,
		"UPDATE assessment_module_attempts SET state = 'locked', completion_reason = 'time_expired' WHERE id = ?",
		moduleAttemptID); err != nil {
		t.Fatalf("finalize base module as timed out: %v", err)
	}
	return attemptID, moduleAttemptID
}

// saveWithin drives the single-response save under the client's budget.
// moduleAttemptID is set only for the late-answer (recovery) save.
func (f *adaptiveExam) saveWithin(attemptID, moduleAttemptID, examQuestionID, answer string) (time.Duration, error) {
	ctx, cancel := context.WithTimeout(context.Background(), sharedRowSaveBudget)
	defer cancel()
	clientSessionID, tokenID := writerSessionFor(attemptID)
	writeID := uuid.NewString()
	req := delivery.SaveResponseRequest{
		Response:          json.RawMessage(`"` + answer + `"`),
		EliminatedOptions: []string{},
		Annotations:       json.RawMessage(`{}`),
		ClientWriteID:     &writeID,
	}
	if moduleAttemptID != "" {
		req.ModuleAttemptID = &moduleAttemptID
	}
	started := time.Now()
	_, err := f.deliverySvc().SaveResponse(ctx, f.scheduleID, attemptID, f.scheduleID, examQuestionID, req, clientSessionID, tokenID)
	return time.Since(started), err
}

func (f *adaptiveExam) storedLegacyAnswer(t *testing.T, moduleAttemptID, examQuestionID string) sql.NullString {
	t.Helper()
	var response sql.NullString
	if err := f.db.QueryRowContext(context.Background(),
		"SELECT response FROM assessment_question_responses WHERE module_attempt_id = ? AND exam_question_id = ?",
		moduleAttemptID, examQuestionID).Scan(&response); err != nil && err != sql.ErrNoRows {
		t.Fatalf("read stored answer: %v", err)
	}
	return response
}

// The troubled candidate's late answer (timeout recovery) used to upgrade its
// runtime share lock to exclusive, so it waited behind every open save in the
// room and, with two late savers, deadlocked.
func TestSATLateAnswerRecoveryIsNotBlockedByAnotherCandidatesOpenSave(t *testing.T) {
	f := newAdaptiveExam(t)
	attemptID, moduleAttemptID := f.seedTimedOutStudent(t)
	question := f.examQuestionIDs(t, f.rw.baseID)[0]

	f.holdSharedRows(t, "")
	elapsed, err := f.saveWithin(attemptID, moduleAttemptID, question, "B")
	if err != nil {
		t.Fatalf("late answer must not wait on another candidate's open save: %v (after %s)", err, elapsed)
	}
	if got := f.storedLegacyAnswer(t, moduleAttemptID, question); !got.Valid {
		t.Fatal("the admitted late answer must be stored")
	}
}

// useCohortSectionClock moves the schedule onto cohort_section_v3 with a live
// Reading and Writing section clock that started a minute ago (120 planned).
func (f *adaptiveExam) useCohortSectionClock(t *testing.T) {
	t.Helper()
	ctx := context.Background()
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := f.db.ExecContext(ctx, query, args...); err != nil {
			t.Fatalf("seed cohort clock: %v", err)
		}
	}
	exec(`UPDATE exam_session_runtimes SET timing_model = 'cohort_section_v3', active_section_key = 'reading-writing' WHERE schedule_id = ?`, f.scheduleID)
	exec(`INSERT INTO exam_session_runtime_sections (
		id, runtime_id, section_key, label, section_order, planned_duration_minutes, status, actual_start_at
	) SELECT ?, id, 'reading-writing', 'Reading and Writing', 0, 120, 'live', UTC_TIMESTAMP() - INTERVAL 1 MINUTE
	FROM exam_session_runtimes WHERE schedule_id = ?`, uuid.NewString(), f.scheduleID)
	t.Cleanup(func() {
		for _, stmt := range []string{
			"DELETE FROM cohort_control_events WHERE schedule_id = ?",
			"DELETE FROM session_audit_logs WHERE schedule_id = ?",
			"DELETE FROM student_violation_events WHERE schedule_id = ?",
			"DELETE FROM exam_session_runtime_sections WHERE runtime_id IN (SELECT id FROM exam_session_runtimes WHERE schedule_id = ?)",
		} {
			if _, err := f.db.ExecContext(ctx, stmt, f.scheduleID); err != nil {
				t.Errorf("cleanup cohort clock (%.50q): %v", stmt, err)
			}
		}
	})
}

func (f *adaptiveExam) proctorSvc() *proctor.Service {
	// Production wiring: no in-tx outbox enqueuer, exec-only outbox posture.
	return proctor.NewService(tx.NewRunner(f.db), f.db, nil, nil, nil).SetOutboxExecOnly(true)
}

func (f *adaptiveExam) proctorActor() proctor.Actor {
	return proctor.Actor{ID: f.owner, Role: proctor.RoleAdmin, CSRFVerified: true}
}

// Under cohort timing every save reads the shared section clock. An exclusive
// lock there made each candidate's save wait for every other candidate's.
func TestSATCohortSaveIsNotBlockedByAnotherCandidatesOpenSave(t *testing.T) {
	f := newAdaptiveExam(t)
	f.useCohortSectionClock(t)
	attemptID := f.seedStudent(f.rw, 0, false)
	f.openWriterSession(t, attemptID)
	question := f.examQuestionIDs(t, f.rw.baseID)[0]

	f.holdSharedRows(t, "reading-writing")
	if elapsed, err := f.saveWithin(attemptID, "", question, "B"); err != nil {
		t.Fatalf("cohort save must not wait on another candidate's open save: %v (after %s)", err, elapsed)
	}
}

// The module-end backstop (timeout reconcile) reads the section clock for every
// candidate whose module ran out. It must not queue behind other candidates.
func TestSATModuleEndReconcileIsNotBlockedByAnotherCandidatesOpenSave(t *testing.T) {
	f := newAdaptiveExam(t)
	f.useCohortSectionClock(t)
	attemptID := f.seedStudent(f.rw, 2, true) // personal module allotment elapsed

	f.holdSharedRows(t, "reading-writing")
	ctx, cancel := context.WithTimeout(context.Background(), sharedRowSaveBudget)
	defer cancel()
	changed, err := f.deliverySvc().ReconcileAttemptTimeout(ctx, f.scheduleID, attemptID, time.Now().UTC())
	if err != nil {
		t.Fatalf("module-end reconcile must not wait on another candidate's open save: %v", err)
	}
	if !changed {
		t.Fatal("the expired Module 1 must be finalized")
	}
	if state, _ := f.moduleAttemptState(t, attemptID, f.rw.baseID); state != "locked" {
		t.Fatalf("Module 1 state = %q, want locked", state)
	}
}

// A proctor acting on the troubled candidate (warn/extend/pause one attempt)
// must not stall behind, or stall, the rest of the room.
func TestSATProctorActionOnOneCandidateIsNotBlockedByAnotherCandidatesOpenSave(t *testing.T) {
	f := newAdaptiveExam(t)
	f.useCohortSectionClock(t)
	attemptID := f.seedStudent(f.rw, 0, false)

	f.holdSharedRows(t, "reading-writing")
	ctx, cancel := context.WithTimeout(context.Background(), sharedRowSaveBudget)
	defer cancel()
	msg := "contention probe"
	if err := f.proctorSvc().Warn(ctx, f.proctorActor(), f.scheduleID, attemptID, proctor.AttemptCommand{Message: &msg}); err != nil {
		t.Fatalf("per-attempt proctor command must not wait on another candidate's open save: %v", err)
	}
	var warnings int
	if err := f.db.QueryRowContext(context.Background(),
		"SELECT COUNT(*) FROM student_violation_events WHERE attempt_id = ? AND violation_type = 'PROCTOR_WARNING'",
		attemptID).Scan(&warnings); err != nil {
		t.Fatalf("read warnings: %v", err)
	}
	if warnings != 1 {
		t.Fatalf("recorded warnings = %d, want 1", warnings)
	}
}

// Every candidate enters the scheduled break together; the personal break
// path used to upgrade its runtime share lock to exclusive.
func TestSATPersonalBreakEntryIsNotBlockedByAnotherCandidatesOpenSave(t *testing.T) {
	f := newAdaptiveExam(t)
	ctx := context.Background()
	if _, err := f.db.ExecContext(ctx,
		"UPDATE exam_session_runtimes SET timing_model = 'sat_personal_v1' WHERE schedule_id = ?", f.scheduleID); err != nil {
		t.Fatalf("set personal timing: %v", err)
	}
	attemptID := f.seedStudent(f.rw, 0, false)
	f.openWriterSession(t, attemptID)
	breakID := uuid.NewString()
	if _, err := f.db.ExecContext(ctx,
		"INSERT INTO assessment_attempt_breaks (id, attempt_id, after_section_id, duration_seconds) VALUES (?, ?, ?, 600)",
		breakID, attemptID, f.rw.sectionID); err != nil {
		t.Fatalf("seed scheduled break: %v", err)
	}
	t.Cleanup(func() {
		if _, err := f.db.ExecContext(ctx, "DELETE FROM assessment_attempt_breaks WHERE id = ?", breakID); err != nil {
			t.Errorf("cleanup scheduled break: %v", err)
		}
	})

	f.holdSharedRows(t, "")
	clientSessionID, tokenID := writerSessionFor(attemptID)
	callCtx, cancel := context.WithTimeout(ctx, sharedRowSaveBudget)
	defer cancel()
	if _, err := f.deliverySvc().StartBreak(callCtx, f.scheduleID, attemptID, f.scheduleID, breakID, nil, clientSessionID, tokenID); err != nil {
		t.Fatalf("break entry must not wait on another candidate's open save: %v", err)
	}
	var state string
	if err := f.db.QueryRowContext(ctx, "SELECT state FROM assessment_attempt_breaks WHERE id = ?", breakID).Scan(&state); err != nil {
		t.Fatalf("read break: %v", err)
	}
	if state != "armed" {
		t.Fatalf("break state = %q, want armed", state)
	}
}

// The share lock must still exclude runtime writers: a proctor extension
// waits until the candidate's transaction ends, so no save is judged against
// a clock that changes underneath it. Then it applies.
func TestSATSectionExtensionStillWaitsForOpenCandidateTransactions(t *testing.T) {
	f := newAdaptiveExam(t)
	f.useCohortSectionClock(t)
	ctx := context.Background()
	held, err := f.db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatalf("begin holder tx: %v", err)
	}
	defer func() { _ = held.Rollback() }()
	var runtimeID string
	if err := held.QueryRowContext(ctx,
		"SELECT id FROM exam_session_runtimes WHERE schedule_id = ? FOR SHARE", f.scheduleID).Scan(&runtimeID); err != nil {
		t.Fatalf("holder runtime lock: %v", err)
	}

	extend := func(timeout time.Duration) error {
		callCtx, cancel := context.WithTimeout(ctx, timeout)
		defer cancel()
		return f.proctorSvc().ExtendSection(callCtx, f.proctorActor(), f.scheduleID, proctor.ExtendSectionCommand{Minutes: 5})
	}
	if err := extend(time.Second); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("a section extension must wait for an open candidate transaction; got %v, want a lock-wait deadline", err)
	}
	if err := held.Rollback(); err != nil {
		t.Fatalf("release holder: %v", err)
	}
	if err := extend(sharedRowSaveBudget); err != nil {
		t.Fatalf("extension after the candidate committed: %v", err)
	}
	var minutes int
	if err := f.db.QueryRowContext(ctx,
		"SELECT extension_minutes FROM exam_session_runtime_sections WHERE runtime_id = ? AND section_key = 'reading-writing'",
		runtimeID).Scan(&minutes); err != nil {
		t.Fatalf("read extension: %v", err)
	}
	if minutes != 5 {
		t.Fatalf("extension_minutes = %d, want exactly 5 (the blocked attempt must not have applied)", minutes)
	}
}

// The room at the module boundary: several candidates' late answers land at
// once. Each must be admitted and stored within the client budget.
func TestSATConcurrentLateAnswersAllLand(t *testing.T) {
	const candidates = 8
	f := newAdaptiveExam(t)
	question := f.examQuestionIDs(t, f.rw.baseID)[0]
	type candidate struct{ attemptID, moduleAttemptID string }
	seeded := make([]candidate, candidates)
	for i := range seeded {
		seeded[i].attemptID, seeded[i].moduleAttemptID = f.seedTimedOutStudent(t)
	}

	errs := make([]error, candidates)
	var start, done sync.WaitGroup
	start.Add(1)
	for i, c := range seeded {
		done.Add(1)
		go func(i int, c candidate) {
			defer done.Done()
			start.Wait()
			_, errs[i] = f.saveWithin(c.attemptID, c.moduleAttemptID, question, "B")
		}(i, c)
	}
	start.Done()
	done.Wait()
	for i, c := range seeded {
		if errs[i] != nil {
			t.Errorf("candidate %d late answer: %v", i, errs[i])
			continue
		}
		if got := f.storedLegacyAnswer(t, c.moduleAttemptID, question); !got.Valid {
			t.Errorf("candidate %d: admitted late answer was not stored", i)
		}
	}
}
