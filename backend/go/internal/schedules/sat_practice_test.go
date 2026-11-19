package schedules

import (
	"context"
	"regexp"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/platform/tx"
	"example.com/ielts-proctoring/internal/satlearning"
)

func TestPracticeAdmissionOpen(t *testing.T) {
	now := time.Date(2026, 11, 18, 1, 0, 0, 0, time.UTC)
	base := practiceSchedule{Status: StatusLive, EndTime: now.Add(time.Hour), TimingModel: "sat_personal_v1"}
	if !practiceAdmissionOpen(base, now) {
		t.Fatal("live practice activity must be open before its end")
	}
	closed := base
	closed.EndTime = now.Add(-time.Second)
	if practiceAdmissionOpen(closed, now) {
		t.Fatal("personal practice activity must close at end_time")
	}
	cancelled := base
	cancelled.Status = StatusCancelled
	if practiceAdmissionOpen(cancelled, now) {
		t.Fatal("cancelled activity must be closed")
	}
}

func TestPracticeAttemptStatus(t *testing.T) {
	now := time.Now().UTC()
	for _, tc := range []struct {
		name      string
		submitted *time.Time
		phase     string
		proctor   string
		outcome   string
		want      string
	}{
		{"active", nil, "exam", "active", "", "active"},
		{"submitted", &now, "post-exam", "active", "submitted", "submitted"},
		{"terminated precedence", &now, "post-exam", "active", "terminated", "terminated"},
		{"proctor terminated", nil, "exam", "terminated", "", "terminated"},
	} {
		latest := practiceLatest{SubmittedAt: tc.submitted, Phase: tc.phase, Proctor: tc.proctor, Outcome: tc.outcome}
		if got := practiceAttemptStatus(latest); got != tc.want {
			t.Fatalf("%s: status = %q, want %q", tc.name, got, tc.want)
		}
	}
}

func TestPracticeRetakeRequiresConfirmedSubmission(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	now := time.Now().UTC()
	mock.ExpectBegin()
	mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery(regexp.QuoteMeta("FROM exam_schedules WHERE id = ? AND provider_key = 'sat'")).
		WithArgs("practice-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "exam_id", "published_version_id", "exam_title", "organization_id", "status", "end_time", "sat_timing_model", "sat_session_mode", "sat_start_mode", "revision"}).
			AddRow("practice-1", "exam-1", "v1", "Practice", nil, "live", now.Add(time.Hour), "sat_personal_v1", "practice", "proctor", 1))
	mock.ExpectQuery("SELECT UTC_TIMESTAMP").WillReturnRows(sqlmock.NewRows([]string{"now"}).AddRow(now))
	mock.ExpectExec("INSERT INTO sat_practice_students").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery("SELECT latest_ordinal, active_attempt_id FROM sat_practice_students").
		WithArgs("practice-1", "student-1").
		WillReturnRows(sqlmock.NewRows([]string{"latest_ordinal", "active_attempt_id"}).AddRow(1, nil))
	mock.ExpectQuery("FROM student_attempts sa").
		WithArgs("practice-1", "student-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "submitted_at", "phase", "proctor_status", "outcome", "mode", "ordinal", "created_at"}).
			AddRow("att-1", now.Add(-time.Minute), "post-exam", "terminated", "", "test", 1, now.Add(-time.Hour)))
	mock.ExpectRollback()

	svc := NewService(db, tx.NewRunner(db))
	_, err = svc.StartPracticeAttempt(context.Background(), "practice-1", PracticeStartInput{
		StudentID: "student-1", Mode: satlearning.ModeTest, Intent: "retake",
		ObservedOrdinal: 1, OperationKey: "retake-key",
	})
	if err == nil {
		t.Fatal("a terminated practice attempt must not permit a retake")
	}
	if typed, ok := err.(interface{ Unwrap() error }); ok {
		_ = typed
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestPracticeLearningStateProjectsMeasuredHistory(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	now := time.Now().UTC()
	mock.ExpectQuery(regexp.QuoteMeta("FROM exam_schedules WHERE id = ? AND provider_key = 'sat'")).
		WithArgs("practice-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "exam_id", "published_version_id", "exam_title", "organization_id", "status", "end_time", "sat_timing_model", "sat_session_mode", "sat_start_mode", "revision"}).
			AddRow("practice-1", "exam-1", "v1", "Practice", nil, "live", now.Add(time.Hour), "sat_personal_v1", "practice", "proctor", 1))
	mock.ExpectQuery("SELECT UTC_TIMESTAMP").WillReturnRows(sqlmock.NewRows([]string{"now"}).AddRow(now))
	mock.ExpectQuery("FROM sat_activity_policies").WithArgs("practice-1").
		WillReturnRows(sqlmock.NewRows([]string{"policy_revision", "report_visible", "include_answer_key_in_pdf", "study_enabled", "study_required_completions", "study_reveal_answers", "study_untimed", "unlimited_retakes", "pause_on_leave"}).
			AddRow(int64(2), true, false, true, int64(1), true, true, false, false))
	mock.ExpectQuery("COALESCE\\(l.mode, 'test'\\) = 'test'").
		WithArgs("practice-1", "student-1", "v1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int64(1)))
	mock.ExpectQuery("SELECT latest_ordinal, active_attempt_id FROM sat_practice_students").
		WithArgs("practice-1", "student-1").
		WillReturnRows(sqlmock.NewRows([]string{"latest_ordinal", "active_attempt_id"}).AddRow(2, "att-2"))
	mock.ExpectQuery("FROM student_attempts sa").
		WithArgs("practice-1", "student-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "ordinal", "mode", "policy_revision", "reveal_answers", "untimed", "submitted_at", "phase", "proctor_status", "outcome", "created_at"}).
			AddRow("att-2", 2, "study", int64(2), true, true, nil, "exam", "active", "", now).
			AddRow("att-1", 1, "test", int64(2), false, false, now.Add(-time.Minute), "post-exam", "active", "submitted", now.Add(-time.Hour)))

	state, err := NewService(db, tx.NewRunner(db)).PracticeLearningState(context.Background(), "practice-1", "student-1")
	if err != nil {
		t.Fatal(err)
	}
	if state.CompletedTestAttempts != 1 || state.LastOrdinal != 2 || state.CanStart || state.Eligible {
		t.Fatalf("state = %+v", state)
	}
	if state.ActiveAttempt == nil || state.ActiveAttempt.Mode != satlearning.ModeStudy ||
		!state.ActiveAttempt.Learning.Capabilities.Untimed {
		t.Fatalf("active = %+v", state.ActiveAttempt)
	}
	if len(state.Attempts) != 2 || state.Attempts[1].Status != "submitted" {
		t.Fatalf("attempts = %+v", state.Attempts)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
