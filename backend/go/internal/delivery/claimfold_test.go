package delivery

import (
	"context"
	"database/sql"
	"encoding/json"
	"regexp"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/platform/apperrors"
)

// B2: claimWriterSessionTx locks the attempt, claims a free writer slot in-tx,
// and commits without a separate pre-tx round trip.
func TestClaimWriterSessionTxClaimsFree(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	ctx := context.Background()
	mock.ExpectBegin()
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	// Revocation re-check first: live token row.
	mock.ExpectQuery(regexp.QuoteMeta("FROM attempt_sessions")).
		WithArgs("tok-1").
		WillReturnRows(sqlmock.NewRows([]string{"schedule_id", "attempt_id", "client_session_id", "expires_at", "lease_epoch"}).
			AddRow("sched-1", "att-1", "sess-mine", time.Now().Add(time.Hour), 1))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT active_client_session_id, lease_epoch FROM student_attempts WHERE id = ? AND schedule_id = ? FOR UPDATE")).
		WithArgs("att-1", "sched-1").
		WillReturnRows(sqlmock.NewRows([]string{"active_client_session_id", "lease_epoch"}).AddRow(nil, 1))
	mock.ExpectExec(regexp.QuoteMeta("SET active_client_session_id")).
		WithArgs("sess-mine", "att-1", "sched-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	if err := claimWriterSessionTx(ctx, tx, "sched-1", "att-1", "sess-mine", "tok-1"); err != nil {
		_ = tx.Rollback()
		t.Fatalf("free slot must claim: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// B2 RED: a slot owned by another session surfaces ACTIVE_SESSION_SUPERSEDED.
func TestClaimWriterSessionTxSuperseded(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	ctx := context.Background()
	mock.ExpectBegin()
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	mock.ExpectQuery(regexp.QuoteMeta("FROM attempt_sessions")).
		WithArgs("tok-1").
		WillReturnRows(sqlmock.NewRows([]string{"schedule_id", "attempt_id", "client_session_id", "expires_at", "lease_epoch"}).
			AddRow("sched-1", "att-1", "sess-mine", time.Now().Add(time.Hour), 1))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT active_client_session_id, lease_epoch FROM student_attempts WHERE id = ? AND schedule_id = ? FOR UPDATE")).
		WithArgs("att-1", "sched-1").
		WillReturnRows(sqlmock.NewRows([]string{"active_client_session_id", "lease_epoch"}).AddRow("sess-other", 1))
	mock.ExpectRollback()
	err = claimWriterSessionTx(ctx, tx, "sched-1", "att-1", "sess-mine", "tok-1")
	_ = tx.Rollback()
	if deliveryCodeOf(err) != apperrors.CodeActiveSessionSuperseded {
		t.Fatalf("superseded slot must 409, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// B2: folded claim fires INSIDE SaveResponse's mutation tx when a bearer
// session is bound — no pre-tx round trip. The locked writer/lease read
// precedes the remaining workable reads in the same tx.
func TestSaveResponseFoldedClaimInTx(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := deliverySvc(db)
	now := time.Now().UTC()
	deliverySaveBinding(mock)
	deliverySaveProtocol(mock)
	deliverySaveBegin(mock)
	// ensureAttemptCanWorkTx reads the attempt state, including the writer
	// authority that the later token check validates against.
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_attempts WHERE id = ? AND schedule_id = ? FOR UPDATE")).
		WithArgs("att-1", "sched-1").
		WillReturnRows(sqlmock.NewRows([]string{"proctor_status", "delivery_status", "submitted_at", "phase", "sat_start_code_required", "sat_start_code_accepted_at", "active_client_session_id", "lease_epoch", "control_epoch"}).
			AddRow("active", "running", nil, "exam", false, nil, "sess-1", 1, 1))
	mock.ExpectQuery(regexp.QuoteMeta("FROM exam_session_runtimes WHERE schedule_id = ? FOR SHARE")).
		WithArgs("sched-1").
		WillReturnRows(sqlmock.NewRows([]string{"status"}).AddRow("live"))
	// ...then the folded claim: revocation re-check; attempt ownership came
	// from the already-locked attempt snapshot.
	mock.ExpectQuery(regexp.QuoteMeta("FROM attempt_sessions")).
		WithArgs("tok-1").
		WillReturnRows(sqlmock.NewRows([]string{"schedule_id", "attempt_id", "client_session_id", "expires_at", "lease_epoch"}).
			AddRow("sched-1", "att-1", "sess-1", time.Now().Add(time.Hour), 1))
	// ...then the module + legacy-gate remainder.
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_module_attempts WHERE attempt_id = ? AND state IN")).
		WithArgs("att-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "module_id", "state", "allocated_seconds", "available_at", "started_at", "paused_at", "accumulated_paused_seconds", "extension_seconds", "completion_reason"}).
			AddRow("ma-1", "mod-1", "active", 3600, now.Add(-time.Minute), now.Add(-time.Minute), nil, 0, 0, nil))
	mock.ExpectQuery(regexp.QuoteMeta("FROM exam_session_runtimes WHERE schedule_id = ? FOR SHARE")).
		WithArgs("sched-1").
		WillReturnError(sql.ErrNoRows)
	// SAT-006: legacy gate reads the authoritative in-tx DB time after locks.
	mock.ExpectQuery(regexp.QuoteMeta("SELECT UTC_TIMESTAMP(6)")).
		WillReturnRows(sqlmock.NewRows([]string{"ts"}).AddRow(now))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_exam_questions WHERE id = ? AND module_id = ?")).
		WithArgs("eq-1", "mod-1").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("eq-1"))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_question_responses WHERE module_attempt_id = ? AND exam_question_id = ? FOR UPDATE")).
		WithArgs("ma-1", "eq-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "module_attempt_id", "exam_question_id", "response", "marked_for_review", "eliminated_options", "annotations", "revision"}).
			AddRow("resp-1", "ma-1", "eq-1", `"A"`, false, `[]`, `{}`, 3))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_question_responses WHERE id = ? FOR UPDATE")).
		WithArgs("resp-1").
		WillReturnRows(sqlmock.NewRows([]string{"client_write_id"}).AddRow(nil))
	mock.ExpectCommit()
	req := SaveResponseRequest{Revision: 3, Response: json.RawMessage(`"A"`), EliminatedOptions: []string{}, Annotations: json.RawMessage(`{}`)}
	snap, err := svc.SaveResponse(context.Background(), "sched-1", "att-1", "sched-1", "eq-1", req, "sess-1", "tok-1")
	if err != nil {
		t.Fatalf("folded claim save must succeed, got %v", err)
	}
	if snap == nil || snap.ID != "resp-1" {
		t.Fatalf("unexpected snapshot %+v", snap)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// Revoked token fails closed in-tx: a revocation landing between the
// edge verify and commit must not write (TOCTOU close).
func TestClaimWriterSessionTxRevokedRejects(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	ctx := context.Background()
	mock.ExpectBegin()
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	mock.ExpectQuery(regexp.QuoteMeta("FROM attempt_sessions")).
		WithArgs("tok-revoked").
		WillReturnError(sql.ErrNoRows)
	mock.ExpectRollback()
	if err := claimWriterSessionTx(ctx, tx, "sched-1", "att-1", "sess-mine", "tok-revoked"); err == nil {
		_ = tx.Rollback()
		t.Fatal("revoked token must fail closed, got nil")
	}
	_ = tx.Rollback()
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// Empty writer identity fails closed: the delivery edge guarantees
// non-empty (every minted bearer carries one), so an empty id is a
// programming error that must surface, never a legacy case to skip.
func TestClaimWriterSessionTxEmptyRejects(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	ctx := context.Background()
	mock.ExpectBegin()
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	mock.ExpectRollback()
	if err := claimWriterSessionTx(ctx, tx, "sched-1", "att-1", "", "tok-1"); err == nil {
		_ = tx.Rollback()
		t.Fatal("empty session must fail closed, got nil")
	}
	_ = tx.Rollback()
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
