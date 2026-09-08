package student

import (
	"context"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

// D2 RED: FlushDirty multi-INSERTs transition events + updates integrity ONLY
// for transitioned attempts (steady beats already in the map cost zero SQL).
func TestFlushDirtyBatch(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := NewService(db, nil)
	p := NewPresenceMap(90 * time.Second)
	now := time.Now().UTC()
	p.Touch("att-1", "sched-1", "sess-a", "heartbeat", now)
	p.Touch("att-2", "sched-1", "sess-b", "heartbeat", now)
	if got := p.DrainDirty(); len(got) != 2 {
		t.Fatalf("first touches must drain both: %+v", got)
	}
	p.Touch("att-1", "sched-1", "sess-a", "heartbeat", now.Add(time.Second))
	p.Touch("att-1", "sched-1", "sess-a", "disconnect", now.Add(2*time.Second))
	p.Touch("att-2", "sched-1", "sess-b", "heartbeat", now.Add(3*time.Second))
	dirty := p.DrainDirty()
	if len(dirty) != 1 || dirty[0].AttemptID != "att-1" {
		t.Fatalf("only the transition must flush: %+v", dirty)
	}
	mock.ExpectExec("INSERT INTO student_heartbeat_events").
		WithArgs(sqlmock.AnyArg(), "att-1", "sched-1", sqlmock.AnyArg(), "disconnect", sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectQuery("SELECT integrity, recovery FROM student_attempts").
		WithArgs("att-1").
		WillReturnRows(sqlmock.NewRows([]string{"integrity", "recovery"}).AddRow(`{}`, `{}`))
	mock.ExpectExec("UPDATE student_attempts SET integrity").
		WithArgs(sqlmock.AnyArg(), sqlmock.AnyArg(), "sess-a", "att-1", "sched-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	if err := svc.FlushPresence(context.Background(), dirty); err != nil {
		t.Fatalf("flush: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// D2 RED: empty drain = zero SQL.
func TestFlushDirtyEmptyNoSQL(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := NewService(db, nil)
	// No expectations: any query fails.
	if err := svc.FlushPresence(context.Background(), nil); err != nil {
		t.Fatalf("flush: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
