package schedules

// A fresh check-in must wake staff sockets: the proctor roster otherwise
// shows the joined candidate only on its next detail poll.
import (
	"context"
	"regexp"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/platform/tx"
)

func expectFreshMint(mock sqlmock.Sqlmock, withWakeup bool) {
	mock.ExpectBegin()
	mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
	now := time.Now().UTC()
	cols := []string{"id", "exam_id", "provider_key", "organization_id", "exam_title", "proctor_display_name", "grading_display_name", "published_version_id", "cohort_name", "institution", "start_time", "end_time", "planned_duration_minutes", "delivery_mode", "status", "revision", "recurrence_type", "recurrence_interval", "recurrence_end_date", "buffer_before_minutes", "buffer_after_minutes", "auto_start", "auto_stop", "created_at", "created_by", "updated_at", "sat_timing_model", "ielts_timing_model", "sat_start_mode", "sat_session_mode", "sat_route_policy"}
	mock.ExpectQuery("FROM exam_schedules WHERE id").
		WithArgs("sched-1").
		WillReturnRows(sqlmock.NewRows(cols).AddRow("sched-1", "exam-1", "ielts", nil, "T", "T", "T", "v-1", "C", nil, now, now, 60, "cohort", "live", 1, "", 0, nil, nil, nil, false, false, now, "u", now, nil, nil, "proctor", "practice", nil))
	mock.ExpectQuery("FROM schedule_registrations WHERE id").
		WithArgs("reg-1", "sched-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "wcode", "user_id"}).AddRow("reg-1", "W1", "u-1"))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT exam_type FROM exam_entities WHERE id = ?")).
		WithArgs("exam-1").
		WillReturnRows(sqlmock.NewRows([]string{"exam_type"}).AddRow("Academic"))
	mock.ExpectQuery("FROM student_attempts WHERE registration_id").
		WithArgs("reg-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "protocol_version"}))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT sat_timing_model FROM exam_schedules WHERE id = ?")).
		WithArgs("sched-1").
		WillReturnRows(sqlmock.NewRows([]string{"sat_timing_model"}).AddRow(nil))
	mock.ExpectExec("INSERT INTO student_attempts").WillReturnResult(sqlmock.NewResult(0, 1))
	if withWakeup {
		mock.ExpectExec("INSERT INTO outbox_events").
			WithArgs(sqlmock.AnyArg(), "schedule_roster", "sched-1", int64(0), "roster_changed", sqlmock.AnyArg()).
			WillReturnResult(sqlmock.NewResult(0, 1))
	}
	mock.ExpectQuery("FROM exam_session_runtimes WHERE schedule_id").
		WithArgs("sched-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "active_section_key"}))
	mock.ExpectCommit()
}

func TestCreateScheduleAttemptWakesRoster(t *testing.T) {
	for _, execOnly := range []bool{false, true} {
		db, mock, err := sqlmock.New()
		if err != nil {
			t.Fatal(err)
		}
		svc := NewService(db, tx.NewRunner(db)).SetOutboxExecOnly(execOnly)
		expectFreshMint(mock, !execOnly)
		if _, err := svc.CreateScheduleAttempt(context.Background(), "sched-1", "reg-1", "key-1", "cand-1", "Name", "a@b.co", "sess-1"); err != nil {
			t.Fatalf("execOnly=%v mint: %v", execOnly, err)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatalf("execOnly=%v: %v", execOnly, err)
		}
		db.Close()
	}
}
