package integration

// P0 schema-contract regression coverage for migration 0072
// (assessment_results.submission_id nullable).
//
// A SAT terminal result is attempt-owned: 0044_assessment_result_outcomes.sql
// and internal/terminalization/service.go both materialize it with
// submission_id = NULL, because a SAT attempt may have no student_submissions
// row. Deployed schemas still carried 0032's NOT NULL contract, so completion
// failed with MySQL 1048 ("Column 'submission_id' cannot be null") *after* the
// modules had already been finalized — stranding the attempt with answers and
// locked modules but no result row, which is what the reconciler then retried
// forever.
//
// Both tests below drive the REAL completion/reconciliation stack against a
// migrated database (skipping without TEST_MYSQL_DSN like the rest of this
// package). They fail with 1048 on the pre-0072 schema, which is exactly the
// production failure the forward migration repairs.

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"github.com/google/uuid"

	"example.com/ielts-proctoring/internal/platform/clock"
	"example.com/ielts-proctoring/internal/platform/tx"
	"example.com/ielts-proctoring/internal/sat"
	"example.com/ielts-proctoring/internal/terminalization"
)

// countStudentSubmissions reports the legacy IELTS/grading rows for an attempt.
func (f *adaptiveExam) countStudentSubmissions(t *testing.T, attemptID string) int {
	t.Helper()
	var n int
	if err := f.db.QueryRowContext(context.Background(),
		`SELECT COUNT(*) FROM student_submissions WHERE attempt_id = ?`, attemptID).Scan(&n); err != nil {
		t.Fatalf("count student_submissions: %v", err)
	}
	return n
}

func (f *adaptiveExam) countSATResults(t *testing.T, attemptID string) int {
	t.Helper()
	var n int
	if err := f.db.QueryRowContext(context.Background(),
		`SELECT COUNT(*) FROM assessment_results WHERE attempt_id = ? AND provider_key = 'sat'`, attemptID).Scan(&n); err != nil {
		t.Fatalf("count SAT results: %v", err)
	}
	return n
}

func (f *adaptiveExam) countTerminalizations(t *testing.T, attemptID string) int {
	t.Helper()
	var n int
	if err := f.db.QueryRowContext(context.Background(),
		`SELECT COUNT(*) FROM attempt_terminalizations WHERE attempt_id = ?`, attemptID).Scan(&n); err != nil {
		t.Fatalf("count terminalizations: %v", err)
	}
	return n
}

// satResultRow reads the materialized SAT outcome contract for one attempt.
func (f *adaptiveExam) satResultRow(t *testing.T, attemptID string) (submissionID sql.NullString, outcomeStatus, releaseStatus string) {
	t.Helper()
	if err := f.db.QueryRowContext(context.Background(),
		`SELECT submission_id, outcome_status, release_status FROM assessment_results
		 WHERE attempt_id = ? AND provider_key = 'sat'`, attemptID).
		Scan(&submissionID, &outcomeStatus, &releaseStatus); err != nil {
		t.Fatalf("read SAT result row: %v", err)
	}
	return submissionID, outcomeStatus, releaseStatus
}

func (f *adaptiveExam) moduleState(t *testing.T, attemptID, moduleID string) string {
	t.Helper()
	var state string
	if err := f.db.QueryRowContext(context.Background(),
		`SELECT state FROM assessment_module_attempts WHERE attempt_id = ? AND module_id = ?`,
		attemptID, moduleID).Scan(&state); err != nil {
		t.Fatalf("read module state for %s: %v", moduleID, err)
	}
	return state
}

// expireModule backdates a module attempt's authoritative window so the
// reconciler finalizes it, without touching its state or anything else.
func (f *adaptiveExam) expireModule(t *testing.T, attemptID, moduleID string) {
	t.Helper()
	if _, err := f.db.ExecContext(context.Background(),
		`UPDATE assessment_module_attempts SET started_at = UTC_TIMESTAMP(6) - INTERVAL 2 HOUR
		 WHERE attempt_id = ? AND module_id = ?`, attemptID, moduleID); err != nil {
		t.Fatalf("expire module %s: %v", moduleID, err)
	}
}

// seedReadingWritingOnlyLink scopes the sitting to Reading & Writing through its
// Student Access link — the mechanism operators use for a single-section run.
// The link narrows both the required section set at completion
// (attempts.satRequiredSectionsTx) and the section advance after the last
// module, so finishing the routed branch genuinely ends the exam.
func (f *adaptiveExam) seedReadingWritingOnlyLink(t *testing.T) {
	t.Helper()
	if _, err := f.db.ExecContext(context.Background(), `INSERT INTO assessment_access_links (
		id, exam_id, published_version_id, schedule_id, name, audience_type,
		access_mode, availability_type, created_by, enabled_sections
	) VALUES (?, ?, ?, ?, 'Reading & Writing only', 'anyone', 'open', 'anytime', ?, ?)`,
		uuid.NewString(), f.examID, f.versionID, f.scheduleID, f.owner,
		`["reading-writing"]`); err != nil {
		t.Fatalf("seed reading-writing-only access link: %v", err)
	}
}

// The P0 contract: an attempt-owned SAT outcome materializes without any
// student_submissions row, as pending and with submission_id = NULL.
func TestSATCompletionWithoutSubmissionRowMaterializesNullableResult(t *testing.T) {
	f := newAdaptiveExam(t)
	attemptID := f.seedStudent(f.rw, 2, false)
	f.seedTerminalModules(attemptID)

	if got := f.countStudentSubmissions(t, attemptID); got != 0 {
		t.Fatalf("fixture must hold no student_submissions row for the attempt, got %d", got)
	}

	completion := sat.NewService(f.db, tx.NewRunner(f.db), clock.System{}, nil)
	result, err := completion.CompleteAssessment(context.Background(), sat.CompleteRequest{
		AttemptID: attemptID, ScheduleID: f.scheduleID, SubmissionID: attemptID,
		ActorKind: "student", ActorID: attemptID,
	})
	if err != nil {
		t.Fatalf("SAT completion must not require a student_submissions row (0072): %v", err)
	}
	if result == nil || result.OutcomeStatus != terminalization.SATPending {
		t.Fatalf("completion must materialize a pending SAT outcome, got %+v", result)
	}
	if result.TotalScore != nil || len(result.Sections) != 0 {
		t.Fatalf("an unscored pending outcome must carry no score or sections, got total=%v sections=%d",
			result.TotalScore, len(result.Sections))
	}

	submissionID, outcomeStatus, releaseStatus := f.satResultRow(t, attemptID)
	if outcomeStatus != terminalization.SATPending {
		t.Fatalf("assessment_results.outcome_status = %q, want %q", outcomeStatus, terminalization.SATPending)
	}
	if submissionID.Valid {
		t.Fatalf("an attempt-owned SAT outcome must store submission_id = NULL, got %q", submissionID.String)
	}
	if releaseStatus != "pending" {
		t.Fatalf("an unscored SAT outcome must stay release_status = pending, got %q", releaseStatus)
	}
	if got := f.countStudentSubmissions(t, attemptID); got != 0 {
		t.Fatalf("completion must not manufacture a student_submissions row, got %d", got)
	}
	if got := f.countTerminalizations(t, attemptID); got != 1 {
		t.Fatalf("completion must record exactly one terminal receipt, got %d", got)
	}

	// The other half of the production failure: the attempt itself is terminal.
	var phase, deliveryStatus string
	var submittedAt sql.NullTime
	if err := f.db.QueryRowContext(context.Background(),
		`SELECT phase, delivery_status, submitted_at FROM student_attempts WHERE id = ?`, attemptID).
		Scan(&phase, &deliveryStatus, &submittedAt); err != nil {
		t.Fatalf("read terminal attempt state: %v", err)
	}
	if phase != "post-exam" || deliveryStatus != "submitted" || !submittedAt.Valid {
		t.Fatalf("completion must leave the attempt terminal; phase=%q delivery=%q submitted_at=%v",
			phase, deliveryStatus, submittedAt)
	}
}

// The recovery contract the fix depends on: the timeout reconciler finalizes
// the last open module, completion then succeeds (materializing the nullable
// result), and a second reconciliation pass is a no-op that neither re-finalizes
// nor re-completes.
func TestSATTimeoutReconcileCompletesLastModuleAndSecondPassIsNoOp(t *testing.T) {
	f := newAdaptiveExam(t)
	attemptID := f.seedStudent(f.rw, 2, true)
	f.seedReadingWritingOnlyLink(t)

	ctx := context.Background()
	completer := sat.NewService(f.db, tx.NewRunner(f.db), clock.System{}, nil).ReconcileAdapter()
	calls := 0
	svc := f.deliverySvc().SetCompleter(func(ctx context.Context, scheduleID, attemptID string) error {
		calls++
		return completer(ctx, scheduleID, attemptID)
	})

	// Pass 1: the expired Module 1 is finalized and its adaptive branch opens.
	// The branch is still open, so completion must not run yet.
	changed, err := svc.ReconcileAttemptTimeout(ctx, f.scheduleID, attemptID, time.Now().UTC())
	if err != nil {
		t.Fatalf("first reconciliation failed: %v", err)
	}
	if !changed {
		t.Fatal("first reconciliation must finalize the expired Module 1")
	}
	if calls != 0 {
		t.Fatalf("completion must wait for the last open module, got %d calls", calls)
	}
	if state := f.moduleState(t, attemptID, f.rw.highID); state != "not_started" {
		t.Fatalf("routed branch state = %q, want not_started", state)
	}
	if got := f.countSATResults(t, attemptID); got != 0 {
		t.Fatalf("no result may exist while a module is still open, got %d", got)
	}

	// The routed branch becomes the last open module and its window elapses.
	if _, err := f.db.ExecContext(ctx,
		`UPDATE assessment_module_attempts SET state = 'active' WHERE attempt_id = ? AND module_id = ?`,
		attemptID, f.rw.highID); err != nil {
		t.Fatalf("activate routed branch: %v", err)
	}
	f.expireModule(t, attemptID, f.rw.highID)

	// Pass 2: finalizing the last module must complete the attempt.
	changed, err = svc.ReconcileAttemptTimeout(ctx, f.scheduleID, attemptID, time.Now().UTC())
	if err != nil {
		t.Fatalf("reconciliation that completes the attempt failed: %v", err)
	}
	if !changed {
		t.Fatal("the pass that finalizes the last module must report work")
	}
	if calls != 1 {
		t.Fatalf("finalizing the last module must trigger exactly one completion, got %d", calls)
	}
	submissionID, outcomeStatus, releaseStatus := f.satResultRow(t, attemptID)
	if outcomeStatus != terminalization.SATPending {
		t.Fatalf("recovered result outcome_status = %q, want %q", outcomeStatus, terminalization.SATPending)
	}
	if submissionID.Valid {
		t.Fatalf("recovered attempt-owned result must store submission_id = NULL, got %q", submissionID.String)
	}
	if releaseStatus != "pending" {
		t.Fatalf("recovered result release_status = %q, want pending", releaseStatus)
	}
	for _, moduleID := range []string{f.rw.baseID, f.rw.highID} {
		if state := f.moduleState(t, attemptID, moduleID); state != "locked" {
			t.Fatalf("module %s state = %q, want locked", moduleID, state)
		}
	}
	if got := f.countTerminalizations(t, attemptID); got != 1 {
		t.Fatalf("recovery must record exactly one terminal receipt, got %d", got)
	}
	if got := f.countStudentSubmissions(t, attemptID); got != 0 {
		t.Fatalf("recovery must not manufacture a student_submissions row, got %d", got)
	}

	// Pass 3: the result exists, so the attempt is steady — the sweep must be a
	// clean no-op (reconcileSteady short-circuits before any lock or completion).
	changed, err = svc.ReconcileAttemptTimeout(ctx, f.scheduleID, attemptID, time.Now().UTC())
	if err != nil {
		t.Fatalf("second reconciliation must be a no-op, got: %v", err)
	}
	if changed {
		t.Fatal("second reconciliation must report no work")
	}
	if calls != 1 {
		t.Fatalf("a completed attempt must not be completed again, got %d calls", calls)
	}
	if got := f.countSATResults(t, attemptID); got != 1 {
		t.Fatalf("SAT results after the repeat pass = %d, want 1", got)
	}
	if got := f.countTerminalizations(t, attemptID); got != 1 {
		t.Fatalf("terminal receipts after the repeat pass = %d, want 1", got)
	}
}
