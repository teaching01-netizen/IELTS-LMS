package runtime

import (
	"context"
	"database/sql"
	"example.com/ielts-proctoring/internal/platform/tx"
	sqlmock "github.com/DATA-DOG/go-sqlmock"
	"testing"
	"time"
)

func TestIELTSProctorStartPreparesBeforeStartingClock(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := NewService(tx.NewRunner(db), nil)
	mock.ExpectBegin()
	mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
			mock.ExpectQuery("FROM exam_schedules WHERE id").WithArgs("sch").WillReturnRows(sqlmock.NewRows(scheduleLockColumns).AddRow("sch", "exam", "ielts", "", "", "proctor", "ver", "scheduled", 1, 30))
	mock.ExpectQuery("FROM student_attempts WHERE schedule_id").WithArgs("sch").WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("a"))
	mock.ExpectQuery("SELECT id, status FROM exam_session_runtimes").WithArgs("sch").WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery("SELECT provider_key FROM exam_entities").WithArgs("exam").WillReturnRows(sqlmock.NewRows([]string{"provider_key"}).AddRow("ielts"))
	mock.ExpectExec("INSERT INTO exam_session_runtimes").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("INSERT INTO exam_session_runtime_sections").WithArgs(sqlmock.AnyArg(), sqlmock.AnyArg(), "listening", "Listening", 0, 30, 0, "locked").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("UPDATE exam_schedules SET status = 'live'").WithArgs("sch", "ver", int64(1)).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("UPDATE student_attempts sa").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("INSERT INTO cohort_control_events").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("INSERT INTO outbox_events").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	_, err = svc.Start(context.Background(), "sch", "admin", staticPlanner([]PlanEntry{{SectionKey: "listening", Label: "Listening", DurationMinutes: 30}}, TimingModelLegacy))
	if err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestCohortReadinessWaitsForEveryStudent(t *testing.T) {
	for _, remaining := range []int{1, 0} {
		t.Run(string(rune('0'+remaining)), func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			svc := NewService(tx.NewRunner(db), nil)
			now := time.Date(2026, 10, 18, 3, 0, 0, 0, time.UTC)
			mock.ExpectBegin()
			mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
			mock.ExpectQuery("SELECT COALESCE\\(timing_model, ''\\) FROM exam_session_runtimes WHERE schedule_id = \\?").WithArgs("sch").WillReturnRows(sqlmock.NewRows([]string{"timing_model"}).AddRow(TimingModelLegacy))
			mock.ExpectQuery("FROM exam_schedules WHERE id").WithArgs("sch").WillReturnRows(sqlmock.NewRows(scheduleLockColumns).AddRow("sch", "exam", "ielts", "", "", "proctor", "ver", "live", 1, 120))
			mock.ExpectQuery("FROM student_attempts WHERE schedule_id").WithArgs("sch").WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("a").AddRow("b"))
			mock.ExpectQuery("FROM exam_session_runtimes WHERE schedule_id").WithArgs("sch").WillReturnRows(sqlmock.NewRows([]string{"id", "schedule_id", "exam_id", "status", "section", "revision", "model"}).AddRow("rt", "sch", "exam", "live", "reading", 1, TimingModelLegacy))
			mock.ExpectQuery("SELECT COUNT.*FROM student_attempts WHERE id").WithArgs("a", "sch", "student-a").WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))
			mock.ExpectQuery("SELECT status, actual_start_at").WithArgs("rt", "reading").WillReturnRows(sqlmock.NewRows([]string{"status", "start"}).AddRow("locked", nil))
			mock.ExpectQuery("SELECT UTC_TIMESTAMP").WillReturnRows(sqlmock.NewRows([]string{"now"}).AddRow(now))
			mock.ExpectExec("INSERT INTO ielts_section_readiness").WithArgs("rt", "reading", "a", 100).WillReturnResult(sqlmock.NewResult(0, 1))
			mock.ExpectQuery("SELECT COALESCE.*SUM").WithArgs("rt", "reading", "sch").WillReturnRows(sqlmock.NewRows([]string{"remaining", "rtt"}).AddRow(remaining, 100))
			if remaining == 0 {
				mock.ExpectExec("UPDATE exam_session_runtime_sections SET status = 'live'").WithArgs(now.Add(800*time.Millisecond), "rt", "reading").WillReturnResult(sqlmock.NewResult(0, 1))
				mock.ExpectExec("UPDATE exam_session_runtimes SET waiting").WithArgs("rt").WillReturnResult(sqlmock.NewResult(0, 1))
				mock.ExpectExec("UPDATE student_attempts sa").WithArgs("rt", "reading", "sch").WillReturnResult(sqlmock.NewResult(0, 2))
				mock.ExpectExec("INSERT INTO outbox_events").WillReturnResult(sqlmock.NewResult(0, 1))
			}
			mock.ExpectCommit()
			rtt := 100
			got, err := svc.ReadyCohortSection(context.Background(), "sch", "reading", "a", "student-a", &rtt)
			if err != nil {
				t.Fatal(err)
			}
			if (got.StartedAt != nil) != (remaining == 0) {
				t.Fatalf("section clock started before cohort ready: %+v", got)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestCohortStartLeadTracksMeasuredTransport(t *testing.T) {
	if cohortStartLead(500) <= cohortStartLead(10) {
		t.Fatal("synchronization must account for slower transport")
	}
	if cohortStartLead(100000) != cohortStartLead(10000) {
		t.Fatal("untrusted transport measurements must be bounded")
	}
}
