package terminalization

import (
	"context"
	"database/sql"
	"encoding/json"
	"regexp"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/platform/tx"
)

const rawScoreQuery = "FROM assessment_module_attempts ma"

// expectNoConverter answers the converter lookup with "no scoring policy row".
func expectNoConverter(mock sqlmock.Sqlmock, attemptID string) {
	mock.ExpectQuery(regexp.QuoteMeta("assessment_scoring_policies")).WithArgs(attemptID).WillReturnError(sql.ErrNoRows)
}

func materializeClassroom(t *testing.T, mode string, sections *sqlmock.Rows, wantInsert []any) {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	sealBeginUTC(mock)
	mock.ExpectQuery(regexp.QuoteMeta("SELECT sat_start_code_required = 1")).
		WillReturnRows(sqlmock.NewRows([]string{"n"}).AddRow(false))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_results WHERE attempt_id")).WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery(regexp.QuoteMeta("SELECT COALESCE(e.sat_score_report_enabled, FALSE)")).
		WithArgs("att-1").WillReturnRows(sqlmock.NewRows([]string{"enabled"}).AddRow(mode == "classroom"))
	if sections != nil {
		mock.ExpectQuery(regexp.QuoteMeta(rawScoreQuery)).WithArgs("att-1").WillReturnRows(sections)
		if wantInsert[0] == "scored" {
			expectNoConverter(mock, "att-1")
		}
	}
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO assessment_results")).
		WithArgs(sqlmock.AnyArg(), "att-1", wantInsert[0], sqlmock.AnyArg(), wantInsert[1]).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	svc := NewService(tx.NewRunner(db), SQLTerminalizationRepository{}, SQLOutboxEnqueuer{})
	err = svc.tx.WithTx(context.Background(), func(ctx context.Context, q tx.Tx) error {
		return svc.materializeSATResult(ctx, q, "att-1", "sat", OutcomeSubmitted, ReasonSATComplete, ActorStudent, "term-1", time.Now(), json.RawMessage(`{}`))
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func scoreRows() *sqlmock.Rows {
	return sqlmock.NewRows([]string{"section_key", "module_key", "c", "t", "unscored"})
}

func TestClassroomSubmitReleasesRawScore(t *testing.T) {
	materializeClassroom(t, "classroom",
		scoreRows().AddRow("reading-writing", "m1", 20, 27, false).AddRow("math", "m1", 15, 22, false),
		[]any{"scored", "released"})
}

func TestClassroomUnscoredModuleStaysPending(t *testing.T) {
	materializeClassroom(t, "classroom",
		scoreRows().AddRow("reading-writing", "m1", 20, 27, false).AddRow("math", "m1", 0, 0, true),
		[]any{"pending", "pending"})
}

func TestClassroomWithoutModulesStaysPending(t *testing.T) {
	materializeClassroom(t, "classroom", scoreRows(), []any{"pending", "pending"})
}

// NT-5 / TC-15: a failed score read keeps the seal (commit) and withholds the score.
func TestClassroomScoreFailureKeepsReceiptAndWithholds(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	sealBeginUTC(mock)
	mock.ExpectQuery(regexp.QuoteMeta("SELECT sat_start_code_required = 1")).
		WillReturnRows(sqlmock.NewRows([]string{"n"}).AddRow(false))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_results WHERE attempt_id")).WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery(regexp.QuoteMeta("SELECT COALESCE(e.sat_score_report_enabled, FALSE)")).
		WithArgs("att-1").WillReturnRows(sqlmock.NewRows([]string{"enabled"}).AddRow(true))
	mock.ExpectQuery(regexp.QuoteMeta(rawScoreQuery)).WithArgs("att-1").WillReturnError(sql.ErrConnDone)
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO assessment_results")).
		WithArgs(sqlmock.AnyArg(), "att-1", "pending", sqlmock.AnyArg(), "pending").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()
	svc := NewService(tx.NewRunner(db), SQLTerminalizationRepository{}, SQLOutboxEnqueuer{})
	if err := svc.tx.WithTx(context.Background(), func(ctx context.Context, q tx.Tx) error {
		return svc.materializeSATResult(ctx, q, "att-1", "sat", OutcomeSubmitted, ReasonSATComplete, ActorStudent, "term-1", time.Now(), json.RawMessage(`{}`))
	}); err != nil {
		t.Fatalf("score failure must not abort the seal: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestPracticeSubmitKeepsScoreWithheld(t *testing.T) {
	materializeClassroom(t, "practice", nil, []any{"pending", "pending"})
}

// The repair sweep releases a withheld classroom result once every module is
// scored, and leaves it withheld otherwise; it never writes anything but the
// result row.
func TestRepairClassroomResults(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	sealBeginUTC(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_results ar JOIN student_attempts a")).WithArgs(10).
		WillReturnRows(sqlmock.NewRows([]string{"id", "attempt_id"}).AddRow("res-1", "att-1").AddRow("res-2", "att-2"))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT COALESCE(e.sat_score_report_enabled, FALSE)")).
		WithArgs("att-1").WillReturnRows(sqlmock.NewRows([]string{"enabled"}).AddRow(true))
	mock.ExpectQuery(regexp.QuoteMeta(rawScoreQuery)).WithArgs("att-1").
		WillReturnRows(scoreRows().AddRow("math", "m1", 15, 22, false))
	expectNoConverter(mock, "att-1")
	mock.ExpectExec(regexp.QuoteMeta("UPDATE assessment_results SET outcome_status = 'scored', release_status = 'released'")).
		WithArgs(sqlmock.AnyArg(), "res-1").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT COALESCE(e.sat_score_report_enabled, FALSE)")).
		WithArgs("att-2").WillReturnRows(sqlmock.NewRows([]string{"enabled"}).AddRow(true))
	mock.ExpectQuery(regexp.QuoteMeta(rawScoreQuery)).WithArgs("att-2").
		WillReturnRows(scoreRows().AddRow("math", "m1", 0, 0, true))
	mock.ExpectCommit()

	repaired, pending, err := RepairClassroomResults(context.Background(), db, 10)
	if err != nil || repaired != 1 || pending != 1 {
		t.Fatalf("repaired=%d pending=%d err=%v; want 1/1", repaired, pending, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
