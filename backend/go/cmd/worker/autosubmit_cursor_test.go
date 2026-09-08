package main

import (
	"context"
	"regexp"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

// B4 RED: cursor fan-out pages WHERE id > ? ORDER BY id LIMIT ? and merges.
func TestListAutoSubmitAttemptsPages(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	w := &worker{db: db}
	mock.ExpectQuery(regexp.QuoteMeta("WHERE schedule_id = ? AND submitted_at IS NULL") + ".*" + regexp.QuoteMeta("AND a.id > ?") + ".*" + regexp.QuoteMeta("ORDER BY a.id") + ".*" + regexp.QuoteMeta("LIMIT ?")).
		WithArgs("sched-1", "", 2).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("att-1").AddRow("att-2"))
	mock.ExpectQuery("ORDER BY a.id").
		WithArgs("sched-1", "att-2", 2).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("att-3").AddRow("att-4"))
	mock.ExpectQuery("ORDER BY a.id").
		WithArgs("sched-1", "att-4", 2).
		WillReturnRows(sqlmock.NewRows([]string{"id"}))
	ids, err := w.listAutoSubmitAttempts(context.Background(), "sched-1", 2)
	if err != nil {
		t.Fatalf("listAutoSubmitAttempts: %v", err)
	}
	if len(ids) != 4 || ids[0] != "att-1" || ids[1] != "att-2" || ids[2] != "att-3" || ids[3] != "att-4" {
		t.Fatalf("paged ids = %v", ids)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// B4: empty eligible set short-circuits after one page (no cursor loop).
func TestListAutoSubmitAttemptsEmpty(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	w := &worker{db: db}
	mock.ExpectQuery("ORDER BY a.id").
		WithArgs("sched-1", "", 50).
		WillReturnRows(sqlmock.NewRows([]string{"id"}))
	ids, err := w.listAutoSubmitAttempts(context.Background(), "sched-1", 50)
	if err != nil {
		t.Fatalf("listAutoSubmitAttempts: %v", err)
	}
	if len(ids) != 0 {
		t.Fatalf("empty set must yield no ids, got %v", ids)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
