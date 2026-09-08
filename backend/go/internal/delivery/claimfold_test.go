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

// B2 RED: claimWriterSessionTx claims a free slot in-tx (conditional UPDATE
// matches) then verifies equality — one PK row, no separate pre-tx.
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
	mock.ExpectExec(regexp.QuoteMeta("SET active_client_session_id")).
		WithArgs("sess-mine", "att-1", "sched-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT active_client_session_id FROM student_attempts WHERE id = ? AND schedule_id = ? FOR UPDATE")).
		WithArgs("att-1", "sched-1").
		WillReturnRows(sqlmock.NewRows([]string{"active_client_session_id"}).AddRow("sess-mine"))
	mock.ExpectCommit()
	if err := claimWriterSessionTx(ctx, tx, "sched-1", "att-1", "sess-mine"); err != nil {
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
	mock.ExpectExec(regexp.QuoteMeta("SET active_client_session_id")).
		WithArgs("sess-mine", "att-1", "sched-1").
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT active_client_session_id FROM student_attempts WHERE id = ? AND schedule_id = ? FOR UPDATE")).
		WithArgs("att-1", "sched-1").
		WillReturnRows(sqlmock.NewRows([]string{"active_client_session_id"}).AddRow("sess-other"))
	mock.ExpectRollback()
	err = claimWriterSessionTx(ctx, tx, "sched-1", "att-1", "sess-mine")
	_ = tx.Rollback()
	if deliveryCodeOf(err) != apperrors.CodeActiveSessionSuperseded {
		t.Fatalf("superseded slot must 409, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// B2: folded claim fires INSIDE SaveResponse's mutation tx when a bearer
// session is bound — no pre-tx round trip. Exact-replay path proves it: the
// claim UPDATE + verify SELECT precede the workable reads in one tx.
func TestSaveResponseFoldedClaimInTx(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := deliverySvc(db)
	now := time.Now().UTC()
	deliverySaveBinding(mock)
	deliverySaveBegin(mock)
	// ensureAttemptCanWorkTx first (attempt row + runtime status)...
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_attempts WHERE id = ? AND schedule_id = ? FOR UPDATE")).
		WithArgs("att-1", "sched-1").
		WillReturnRows(sqlmock.NewRows([]string{"proctor_status", "delivery_status", "submitted_at", "phase"}).
			AddRow("active", "running", nil, "exam"))
	mock.ExpectQuery(regexp.QuoteMeta("FROM exam_session_runtimes WHERE schedule_id = ? FOR UPDATE")).
		WithArgs("sched-1").
		WillReturnRows(sqlmock.NewRows([]string{"status"}).AddRow("live"))
	// ...then the folded claim: conditional UPDATE + FOR UPDATE verify...
	mock.ExpectExec(regexp.QuoteMeta("SET active_client_session_id")).
		WithArgs("sess-1", "att-1", "sched-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT active_client_session_id FROM student_attempts WHERE id = ? AND schedule_id = ? FOR UPDATE")).
		WithArgs("att-1", "sched-1").
		WillReturnRows(sqlmock.NewRows([]string{"active_client_session_id"}).AddRow("sess-1"))
	// ...then the module + legacy-gate remainder.
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_module_attempts WHERE attempt_id = ? AND state IN")).
		WithArgs("att-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "module_id", "state", "allocated_seconds", "available_at", "started_at", "paused_at", "accumulated_paused_seconds", "extension_seconds", "completion_reason"}).
			AddRow("ma-1", "mod-1", "active", 3600, now.Add(-time.Minute), now.Add(-time.Minute), nil, 0, 0, nil))
	mock.ExpectQuery(regexp.QuoteMeta("FROM exam_session_runtimes WHERE schedule_id = ? FOR UPDATE")).
		WithArgs("sched-1").
		WillReturnError(sql.ErrNoRows)
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
	snap, err := svc.SaveResponse(context.Background(), "sched-1", "att-1", "sched-1", "eq-1", req, "sess-1")
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

// B2 RED: empty session id skips (legacy callers/tests without writer binding).
func TestClaimWriterSessionTxEmptySkips(t *testing.T) {
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
	if err := claimWriterSessionTx(ctx, tx, "sched-1", "att-1", ""); err != nil {
		_ = tx.Rollback()
		t.Fatalf("empty session must skip: %v", err)
	}
	_ = tx.Rollback()
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
