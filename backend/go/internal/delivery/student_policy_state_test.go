package delivery

import (
	"context"
	"regexp"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/platform/apperrors"
)

// StudentPolicyState is the live projection a foreground poll consumes; it
// must reflect the room row, not an exam-level default.
func TestStudentPolicyStateProjectsRoomPolicy(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectQuery(regexp.QuoteMeta("JOIN exam_entities e ON e.id = a.exam_id")).
		WithArgs("att-1", "sched-1").
		WillReturnRows(sqlmock.NewRows([]string{"provider_key"}).AddRow("sat"))
	mock.ExpectQuery(regexp.QuoteMeta("FROM sat_activity_policies WHERE schedule_id")).
		WithArgs("sched-1").
		WillReturnRows(keyPolicyRows(true, true))
	service := &Service{db: db}
	state, err := service.StudentPolicyState(context.Background(), "sched-1", "att-1")
	if err != nil {
		t.Fatal(err)
	}
	want := StudentPolicyState{Revision: 4, ReportVisible: true, IncludeAnswerKeyInPdf: true}
	if state != want {
		t.Fatalf("state = %+v, want %+v", state, want)
	}
}

func TestStudentPolicyStateRejectsForeignAttempt(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectQuery(regexp.QuoteMeta("JOIN exam_entities e ON e.id = a.exam_id")).
		WithArgs("att-1", "sched-1").
		WillReturnRows(sqlmock.NewRows([]string{"provider_key"}).AddRow("ielts"))
	service := &Service{db: db}
	_, err = service.StudentPolicyState(context.Background(), "sched-1", "att-1")
	typed, ok := apperrors.As(err)
	if !ok || typed.Code != apperrors.CodeNotFound {
		t.Fatalf("want NOT_FOUND, got %v", err)
	}
}
