package schedules

// Plan D3/E-exam-day: the duplicate-replay slice proves check-in retries
// collapse to the registration-locked replay instead of double minting.
// RED: in-tx replay of an existing attempt emits MDupAttemptReplay.
import (
	"context"
	"regexp"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/platform/telemetry"
	"example.com/ielts-proctoring/internal/platform/tx"
)

func TestCreateScheduleAttemptReplayEmitsCounter(t *testing.T) {
	reg := telemetry.NewRegistry()
	old := telemetry.DefaultRegistry
	telemetry.DefaultRegistry = reg
	defer func() { telemetry.DefaultRegistry = old }()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := NewService(db, tx.NewRunner(db))

	mock.ExpectBegin()
	mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
	now := time.Now().UTC()
	cols := []string{"id", "exam_id", "provider_key", "organization_id", "exam_title", "proctor_display_name", "grading_display_name", "published_version_id", "cohort_name", "institution", "start_time", "end_time", "planned_duration_minutes", "delivery_mode", "status", "revision", "recurrence_type", "recurrence_interval", "recurrence_end_date", "buffer_before_minutes", "buffer_after_minutes", "auto_start", "auto_stop", "created_at", "created_by", "updated_at", "sat_timing_model"}
	mock.ExpectQuery("FROM exam_schedules WHERE id").
		WithArgs("sched-1").
		WillReturnRows(sqlmock.NewRows(cols).AddRow("sched-1", "exam-1", "ielts", nil, "T", "T", "T", "v-1", "C", nil, now, now, 60, "cohort", "live", 1, "", 0, nil, nil, nil, false, false, now, "u", now, nil))
	mock.ExpectQuery("FROM schedule_registrations WHERE id").
		WithArgs("reg-1", "sched-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "wcode", "user_id"}).AddRow("reg-1", "W1", "u-1"))
	mock.ExpectQuery("FROM student_attempts WHERE registration_id").
		WithArgs("reg-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "protocol_version"}).AddRow("att-9", 2))
	mock.ExpectCommit()

	ref, err := svc.CreateScheduleAttempt(context.Background(), "sched-1", "reg-1", "key-1", "cand-1", "Name", "a@b.co", "sess-1")
	if err != nil {
		t.Fatalf("replay mint: %v", err)
	}
	if ref.AttemptID != "att-9" {
		t.Fatalf("must replay existing attempt, got %+v", ref)
	}
	if got := telemetry.CounterValueForTest(reg, telemetry.MDupAttemptReplay); got != 1 {
		t.Fatalf("replay must count 1, got %v", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
	_ = regexp.QuoteMeta
}
