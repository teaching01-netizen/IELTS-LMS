package sat

// Plan E-exam-day: the SAT provisional age gauge is the stuck-provisional
// signal. The probe returns the oldest stuck provisional age; no stuck
// rows returns 0 without error. RED: both shapes.
import (
	"context"
	"database/sql"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/platform/clock"
)

func TestOldestProvisionalAgeSeconds(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := NewService(db, nil, clock.System{}, nil)
	mock.ExpectQuery("FROM student_attempts a").
		WillReturnRows(sqlmock.NewRows([]string{"age"}).AddRow(int64(422)))
	if got, err := svc.OldestProvisionalAgeSeconds(context.Background()); err != nil || got != 422 {
		t.Fatalf("age = %d, err = %v; want 422, nil", got, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestOldestProvisionalAgeEmpty(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := NewService(db, nil, clock.System{}, nil)
	mock.ExpectQuery("FROM student_attempts a").
		WillReturnRows(sqlmock.NewRows([]string{"age"}).AddRow(sql.NullInt64{}))
	if got, err := svc.OldestProvisionalAgeSeconds(context.Background()); err != nil || got != 0 {
		t.Fatalf("empty age = %d, err = %v; want 0, nil", got, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
