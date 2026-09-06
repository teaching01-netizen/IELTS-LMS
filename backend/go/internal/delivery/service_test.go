package delivery

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"regexp"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/tx"
)

var errTimeoutComplete = errors.New("complete_assessment timeout")

func deliveryCodeOf(err error) apperrors.Code {
	if e, ok := apperrors.As(err); ok {
		return e.Code
	}
	return ""
}

func deliverySvc(db *sql.DB) *Service { return NewService(db, tx.NewRunner(db)) }

// URL schedule id must equal the bearer schedule id: FORBIDDEN before any DB
// access, mirroring the auth boundary in Bootstrap.
func TestDeliveryBootstrapScheduleMismatchForbidden(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := deliverySvc(db)
	_, err = svc.Bootstrap(context.Background(), "sched-bearer", "attempt-1", "sched-url")
	if deliveryCodeOf(err) != apperrors.CodeForbidden {
		t.Fatalf("expected FORBIDDEN on schedule mismatch, got %v", err)
	}
	if appErr, ok := apperrors.As(err); ok {
		if appErr.Message != "Attempt credential does not match the schedule." {
			t.Fatalf("unexpected mismatch message %q", appErr.Message)
		}
	} else {
		t.Fatalf("expected *apperrors.Error, got %T", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// Missing schedule binding surfaces NOT_FOUND from the schedule_binding
// query (no further queries run).
func TestDeliveryBootstrapScheduleBindingNotFound(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := deliverySvc(db)
	mock.ExpectQuery(regexp.QuoteMeta("FROM exam_schedules s JOIN exam_entities e")).
		WithArgs("sched-1").WillReturnError(sql.ErrNoRows)
	_, err = svc.Bootstrap(context.Background(), "sched-1", "attempt-1", "sched-1")
	if deliveryCodeOf(err) != apperrors.CodeNotFound {
		t.Fatalf("expected NOT_FOUND on missing schedule binding, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func deliverySaveBegin(mock sqlmock.Sqlmock) {
	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta("SET time_zone")).WillReturnResult(sqlmock.NewResult(0, 0))
}

func deliverySaveBinding(mock sqlmock.Sqlmock) {
	mock.ExpectQuery(regexp.QuoteMeta("FROM exam_schedules s JOIN exam_entities e")).
		WithArgs("sched-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "exam_id", "provider_key", "published_version_id"}).
			AddRow("sched-1", "exam-1", "sat", "pv-1"))
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_attempts WHERE id = ?")).
		WithArgs("att-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "schedule_id", "exam_id"}).
			AddRow("att-1", "sched-1", "exam-1"))
}

func deliverySaveWorkableTx(mock sqlmock.Sqlmock, startedAt time.Time) {
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_attempts WHERE id = ? AND schedule_id = ? FOR UPDATE")).
		WithArgs("att-1", "sched-1").
		WillReturnRows(sqlmock.NewRows([]string{"proctor_status", "delivery_status", "submitted_at", "phase"}).
			AddRow("active", "running", nil, "exam"))
	mock.ExpectQuery(regexp.QuoteMeta("FROM exam_session_runtimes WHERE schedule_id = ? FOR UPDATE")).
		WithArgs("sched-1").
		WillReturnRows(sqlmock.NewRows([]string{"status"}).AddRow("live"))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_module_attempts WHERE attempt_id = ? AND state IN")).
		WithArgs("att-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "module_id", "state", "allocated_seconds", "available_at", "started_at", "paused_at", "accumulated_paused_seconds", "extension_seconds", "completion_reason"}).
			AddRow("ma-1", "mod-1", "active", 3600, startedAt, startedAt, nil, 0, 0, nil))
	mock.ExpectQuery(regexp.QuoteMeta("FROM exam_session_runtimes WHERE schedule_id = ? FOR UPDATE")).
		WithArgs("sched-1").
		WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_exam_questions WHERE id = ? AND module_id = ?")).
		WithArgs("eq-1", "mod-1").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("eq-1"))
}

// Stale revision on an existing row surfaces CONFLICT without any write.
func TestDeliverySaveResponseRevisionMismatch(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := deliverySvc(db)
	now := time.Now().UTC()
	deliverySaveBinding(mock)
	deliverySaveBegin(mock)
	deliverySaveWorkableTx(mock, now.Add(-time.Minute))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_question_responses WHERE module_attempt_id = ? AND exam_question_id = ? FOR UPDATE")).
		WithArgs("ma-1", "eq-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "module_attempt_id", "exam_question_id", "response", "marked_for_review", "eliminated_options", "annotations", "revision"}).
			AddRow("resp-1", "ma-1", "eq-1", `"A"`, false, `[]`, `{}`, 3))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_question_responses WHERE id = ? FOR UPDATE")).
		WithArgs("resp-1").
		WillReturnRows(sqlmock.NewRows([]string{"client_write_id"}).AddRow(nil))
	mock.ExpectRollback()
	req := SaveResponseRequest{Revision: 1, Response: json.RawMessage(`"B"`), EliminatedOptions: []string{}, Annotations: json.RawMessage(`{}`)}
	_, err = svc.SaveResponse(context.Background(), "sched-1", "att-1", "sched-1", "eq-1", req)
	if deliveryCodeOf(err) != apperrors.CodeAssessmentConflict {
		t.Fatalf("expected ASSESSMENT_CONFLICT on stale revision, got %v", err)
	}
	if appErr, ok := apperrors.As(err); ok {
		if appErr.Message != "Question response revision is stale." {
			t.Fatalf("unexpected mismatch message %q", appErr.Message)
		}
		if appErr.Details["reason"] != "RESPONSE_REVISION_MISMATCH" {
			t.Fatalf("expected reason RESPONSE_REVISION_MISMATCH, got %v", appErr.Details)
		}
	} else {
		t.Fatalf("expected *apperrors.Error, got %T", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// Exact payload replay returns the snapshot with commit and no write.
func TestDeliverySaveResponseExactReplay(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := deliverySvc(db)
	now := time.Now().UTC()
	deliverySaveBinding(mock)
	deliverySaveBegin(mock)
	deliverySaveWorkableTx(mock, now.Add(-time.Minute))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_question_responses WHERE module_attempt_id = ? AND exam_question_id = ? FOR UPDATE")).
		WithArgs("ma-1", "eq-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "module_attempt_id", "exam_question_id", "response", "marked_for_review", "eliminated_options", "annotations", "revision"}).
			AddRow("resp-1", "ma-1", "eq-1", `"A"`, false, `[]`, `{}`, 3))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_question_responses WHERE id = ? FOR UPDATE")).
		WithArgs("resp-1").
		WillReturnRows(sqlmock.NewRows([]string{"client_write_id"}).AddRow(nil))
	mock.ExpectCommit()
	req := SaveResponseRequest{Revision: 3, Response: json.RawMessage(`"A"`), EliminatedOptions: []string{}, Annotations: json.RawMessage(`{}`)}
	snap, err := svc.SaveResponse(context.Background(), "sched-1", "att-1", "sched-1", "eq-1", req)
	if err != nil {
		t.Fatalf("expected exact replay to succeed, got %v", err)
	}
	if snap == nil || snap.ID != "resp-1" || snap.Revision != 3 || snap.ExamQuestionID != "eq-1" {
		t.Fatalf("unexpected replay snapshot %+v", snap)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// A writer slot owned by another client session surfaces
// ACTIVE_SESSION_SUPERSEDED (409 + reason detail): the claim UPDATE matches
// no row and the FOR UPDATE check reads a different session id.
func TestDeliveryEnsureActiveWriterSuperseded(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := deliverySvc(db)
	deliverySaveBegin(mock)
	mock.ExpectExec(regexp.QuoteMeta("SET active_client_session_id")).
		WithArgs("sess-mine", "att-1", "sched-1").
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT active_client_session_id FROM student_attempts WHERE id = ? AND schedule_id = ? FOR UPDATE")).
		WithArgs("att-1", "sched-1").
		WillReturnRows(sqlmock.NewRows([]string{"active_client_session_id"}).AddRow("sess-other"))
	mock.ExpectRollback()
	err = svc.EnsureActiveWriter(context.Background(), "att-1", "sched-1", "sess-mine")
	if deliveryCodeOf(err) != apperrors.CodeActiveSessionSuperseded {
		t.Fatalf("expected ACTIVE_SESSION_SUPERSEDED on superseded writer, got %v", err)
	}
	if appErr, ok := apperrors.As(err); ok {
		if appErr.Message != "A newer student session owns this attempt." {
			t.Fatalf("unexpected superseded message %q", appErr.Message)
		}
		if appErr.Details["reason"] != "ACTIVE_SESSION_SUPERSEDED" {
			t.Fatalf("expected reason ACTIVE_SESSION_SUPERSEDED, got %v", appErr.Details)
		}
	} else {
		t.Fatalf("expected *apperrors.Error, got %T", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// A missing attempt commits a no-op reconcile (false, nil): Rust returns
// Ok(false) after committing the empty tx.
func TestDeliveryReconcileMissingAttemptNoop(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := deliverySvc(db)
	deliverySaveBegin(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_attempts WHERE id = ? AND schedule_id = ? FOR UPDATE")).
		WithArgs("att-1", "sched-1").
		WillReturnError(sql.ErrNoRows)
	mock.ExpectCommit()
	changed, err := svc.ReconcileAttemptTimeout(context.Background(), "sched-1", "att-1", time.Now().UTC())
	if err != nil {
		t.Fatalf("expected no-op reconcile to succeed, got %v", err)
	}
	if changed {
		t.Fatal("expected no-op reconcile to report unchanged")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// A legacy-model active module past its personal deadline finalizes to
// locked/time_expired; terminal completion fires only when no follow-up
// module is inserted. Row order: reconcile tx (attempt, runtime, open row,
// scoring, finalize CAS, current section, next-section lookup) then commit.
// A drained attempt with terminal modules but no SAT result re-arms
// completion: the previous pass finalized everything and committed, but the
// completer failed afterwards. The next sweep must retry completion instead
// of stranding the attempt (audit P1).
func TestDeliveryReconcileDrainedMissingResultRetriesCompletion(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	completed := false
	svc := deliverySvc(db)
	svc.SetCompleter(func(ctx context.Context, scheduleID, attemptID string) error {
		completed = true
		return nil
	})
	deliveryReconcileDrainedStranded(mock)
	changed, err := svc.ReconcileAttemptTimeout(context.Background(), "sched-1", "att-1", time.Now().UTC())
	if err != nil {
		t.Fatalf("expected stranded reconcile to succeed, got %v", err)
	}
	if changed {
		t.Fatal("expected stranded reconcile to report unchanged (no module work this pass)")
	}
	if !completed {
		t.Fatal("completer must fire for a drained attempt with terminal modules and no result")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// A drained attempt whose result already exists stays a no-op: the backstop
// terminal-module probe finds nothing and the completer never fires, so
// steady-state reads of finished attempts cost one probe and no 503.
func TestDeliveryReconcileDrainedCompletedNoop(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := deliverySvc(db)
	svc.SetCompleter(func(ctx context.Context, scheduleID, attemptID string) error {
		t.Fatal("completer must not fire for a fully completed attempt")
		return nil
	})
	deliveryReconcileDrained(mock)
	changed, err := svc.ReconcileAttemptTimeout(context.Background(), "sched-1", "att-1", time.Now().UTC())
	if err != nil {
		t.Fatalf("expected completed reconcile to succeed, got %v", err)
	}
	if changed {
		t.Fatal("expected completed reconcile to report unchanged")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// A completer failure after commit surfaces a retryable recovery error and
// reports changed so the worker revisits the attempt instead of dropping it.
func TestDeliveryReconcileCompleterFailureRetryable(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := deliverySvc(db)
	svc.SetCompleter(func(ctx context.Context, scheduleID, attemptID string) error {
		return errTimeoutComplete
	})
	deliveryReconcileDrainedStranded(mock)
	changed, err := svc.ReconcileAttemptTimeout(context.Background(), "sched-1", "att-1", time.Now().UTC())
	if err == nil {
		t.Fatal("expected completer failure to surface a retryable error")
	}
	if deliveryCodeOf(err) != apperrors.CodeRecoveryFailed {
		t.Fatalf("expected SERVICE_RECOVERY_FAILED, got %v", err)
	}
	if !changed {
		t.Fatal("expected changed=true so the sweep revisits the attempt")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestDeliveryReconcileLegacyExpiryFinalizes(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	completed := false
	svc := deliverySvc(db)
	svc.SetCompleter(func(ctx context.Context, scheduleID, attemptID string) error {
		completed = true
		return nil
	})
	now := time.Now().UTC()
	started := now.Add(-2 * time.Hour)
	deliverySaveBegin(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_attempts WHERE id = ? AND schedule_id = ? FOR UPDATE")).
		WithArgs("att-1", "sched-1").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("att-1"))
	mock.ExpectQuery(regexp.QuoteMeta("FROM exam_session_runtimes WHERE schedule_id = ? FOR UPDATE")).
		WithArgs("sched-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "status", "timing_model", "active_section_key"}).
			AddRow("rt-1", "live", "legacy", nil))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_module_attempts WHERE attempt_id = ? AND state IN")).
		WithArgs("att-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "module_id", "state", "allocated_seconds", "available_at", "started_at", "paused_at", "accumulated_paused_seconds", "extension_seconds", "completion_reason"}).
			AddRow("ma-1", "mod-1", "active", 3600, started, started, nil, 0, 0, nil))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_exam_questions eq JOIN assessment_question_revisions")).
		WithArgs("ma-1", "mod-1").
		WillReturnRows(sqlmock.NewRows([]string{"is_pretest", "answer_definition", "response"}))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE assessment_module_attempts SET state = ?")).
		WithArgs("locked", true, "time_expired", 0, 0, "ma-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_modules m JOIN assessment_sections s ON")).
		WithArgs("mod-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "break_after_seconds"}).AddRow("sec-1", 0))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_modules m JOIN assessment_sections s ON s.id = m.section_id WHERE m.id = ?")).
		WithArgs("mod-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "section_key", "display_order", "adaptive_role", "exam_version_id"}).
			AddRow("sec-1", "reading", 1, "lower_branch", "pv-1"))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_sections WHERE exam_version_id = ? AND display_order > ?")).
		WithArgs("pv-1", 1).
		WillReturnError(sql.ErrNoRows)
	mock.ExpectCommit()
	changed, err := svc.ReconcileAttemptTimeout(context.Background(), "sched-1", "att-1", now)
	if err != nil {
		t.Fatalf("expected expiry reconcile to succeed, got %v", err)
	}
	if !changed {
		t.Fatal("expected expiry reconcile to report changed")
	}
	if !completed {
		t.Fatal("completer must fire when the last open module is finalized (terminal)")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
