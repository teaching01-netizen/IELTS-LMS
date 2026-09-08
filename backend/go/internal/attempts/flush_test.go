package attempts

import (
	"context"
	"regexp"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

// B3 RED: FlushStaleBlobs materializes + persists blobs for recently-active
// V2 attempts (bounded batch), skipping terminal ones. Returns flush count.
func TestFlushStaleBlobs(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_attempts WHERE protocol_version = 2")).
		WithArgs(50).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("att-1").AddRow("att-2"))
	// att-1 has rows -> materialize + update.
	mock.ExpectQuery(regexp.QuoteMeta("FROM attempt_responses_v2 WHERE attempt_id")).
		WithArgs("att-1").
		WillReturnRows(sqlmock.NewRows([]string{"question_id", "module_id", "response"}).
			AddRow("q-1", "mod-reading", `{"answer":"A","markedForReview":false,"eliminatedOptions":[],"annotations":[]}`))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE student_attempts SET answers=?, writing_answers=?, flags=? WHERE id=?")).
		WithArgs(`{"q-1":"A"}`, "{}", "{}", "att-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	// att-2 has no rows -> empty triple persisted (keeps read view fresh).
	mock.ExpectQuery(regexp.QuoteMeta("FROM attempt_responses_v2 WHERE attempt_id")).
		WithArgs("att-2").
		WillReturnRows(sqlmock.NewRows([]string{"question_id", "module_id", "response"}))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE student_attempts SET answers=?, writing_answers=?, flags=? WHERE id=?")).
		WithArgs("{}", "{}", "{}", "att-2").
		WillReturnResult(sqlmock.NewResult(0, 1))
	n, err := FlushStaleBlobs(context.Background(), db, 50)
	if err != nil {
		t.Fatalf("FlushStaleBlobs: %v", err)
	}
	if n != 2 {
		t.Fatalf("flushed = %d, want 2", n)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// B3 RED: no candidates -> zero flushes, zero writes.
func TestFlushStaleBlobsEmpty(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_attempts WHERE protocol_version = 2")).
		WithArgs(50).
		WillReturnRows(sqlmock.NewRows([]string{"id"}))
	n, err := FlushStaleBlobs(context.Background(), db, 50)
	if err != nil {
		t.Fatalf("FlushStaleBlobs: %v", err)
	}
	if n != 0 {
		t.Fatalf("flushed = %d, want 0", n)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
