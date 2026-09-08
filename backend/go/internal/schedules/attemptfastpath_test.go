package schedules

import (
	"context"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

// D3 RED: retry for a registration that already has an attempt collapses to
// one unlocked SELECT (no schedule/registration FOR UPDATE, no INSERT).
func TestLookupAttemptByRegistrationFastPath(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := NewService(db, nil)
	mock.ExpectQuery("FROM student_attempts WHERE registration_id").
		WithArgs("reg-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "schedule_id", "protocol_version"}).
			AddRow("att-9", "sched-1", 2))
	ref, found, err := svc.LookupAttemptByRegistration(context.Background(), "sched-1", "reg-1")
	if err != nil {
		t.Fatalf("lookup: %v", err)
	}
	if !found {
		t.Fatalf("must find the provisioned attempt")
	}
	if ref.AttemptID != "att-9" || ref.ScheduleID != "sched-1" {
		t.Fatalf("wrong ref: %+v", ref)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// D3 RED: no row -> not found (caller proceeds to the mint tx), no error.
func TestLookupAttemptByRegistrationMiss(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := NewService(db, nil)
	mock.ExpectQuery("FROM student_attempts WHERE registration_id").
		WithArgs("reg-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "schedule_id", "protocol_version"}))
	_, found, err := svc.LookupAttemptByRegistration(context.Background(), "sched-1", "reg-1")
	if err != nil {
		t.Fatalf("lookup: %v", err)
	}
	if found {
		t.Fatalf("must report miss")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
