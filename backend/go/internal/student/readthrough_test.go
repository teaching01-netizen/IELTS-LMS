package student

import (
	"context"
	"regexp"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

// B3 RED: GetSession on a protocol-2 attempt under row-first reads answers
// through the rows materializer (blob columns stale) — not the columns.
func TestGetSessionRowFirstReadThrough(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := NewService(db, nil).SetRowFirst(true)
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_attempts WHERE id = ?")).
		WithArgs("att-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "schedule_id", "phase", "answers", "protocol_version"}).
			AddRow("att-1", "sched-1", "exam", "{}", 2))
	mock.ExpectQuery(regexp.QuoteMeta("FROM attempt_responses_v2 WHERE attempt_id")).
		WithArgs("att-1").
		WillReturnRows(sqlmock.NewRows([]string{"question_id", "module_id", "response"}).
			AddRow("q-1", "mod-reading", `{"answer":"A","markedForReview":false,"eliminatedOptions":[],"annotations":[]}`))
	sess, err := svc.GetSession(context.Background(), "att-1")
	if err != nil {
		t.Fatalf("GetSession: %v", err)
	}
	if string(sess.Answers) != `{"q-1":"A"}` {
		t.Fatalf("answers must come from rows, got %s", string(sess.Answers))
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// B3 RED: GetSession on a protocol-1 attempt keeps column reads (authoritative).
func TestGetSessionLegacyKeepsColumns(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := NewService(db, nil).SetRowFirst(true)
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_attempts WHERE id = ?")).
		WithArgs("att-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "schedule_id", "phase", "answers", "protocol_version"}).
			AddRow("att-1", "sched-1", "exam", `{"q-0":"kept"}`, 1))
	sess, err := svc.GetSession(context.Background(), "att-1")
	if err != nil {
		t.Fatalf("GetSession: %v", err)
	}
	if string(sess.Answers) != `{"q-0":"kept"}` {
		t.Fatalf("V1 answers must stay column-authoritative, got %s", string(sess.Answers))
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// B3 RED: row-first OFF keeps today's column read even for protocol-2.
func TestGetSessionRowFirstOffKeepsColumns(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := NewService(db, nil)
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_attempts WHERE id = ?")).
		WithArgs("att-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "schedule_id", "phase", "answers"}).
			AddRow("att-1", "sched-1", "exam", `{"q-0":"col"}`))
	sess, err := svc.GetSession(context.Background(), "att-1")
	if err != nil {
		t.Fatalf("GetSession: %v", err)
	}
	if string(sess.Answers) != `{"q-0":"col"}` {
		t.Fatalf("flag-off must keep column read, got %s", string(sess.Answers))
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
