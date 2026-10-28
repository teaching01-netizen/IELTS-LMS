package runtime

import (
	"context"
	"database/sql"
	"regexp"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

// stageIELTSFirstSection stages the reads every first-section readiness call
// issues before it consults the attempt's timeline.
func stageIELTSFirstSection(mock sqlmock.Sqlmock, now, roomStart time.Time) {
	mock.ExpectQuery(regexp.QuoteMeta("FROM exam_schedules WHERE id = ? FOR SHARE")).WithArgs("sched-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "exam_id", "provider_key", "sat_timing_model", "ielts_timing_model", "sat_start_mode", "published_version_id", "status", "revision", "planned_duration_minutes"}).
			AddRow("sched-1", "exam-1", "ielts", "", TimingModelIELTSPersonal, "proctor", "pv-1", "live", 1, 180))
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_attempts a")).WithArgs("att-1", "sched-1", "user-1").
		WillReturnRows(sqlmock.NewRows([]string{"delivery_status", "submitted_at", "proctor_status", "extra_time_minutes", "recovery_control"}).AddRow("running", nil, "active", 0, ""))
	mock.ExpectQuery(regexp.QuoteMeta("FROM exam_session_runtimes WHERE schedule_id = ? FOR SHARE")).WithArgs("sched-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "status", "timing_model", "actual_start_at", "completion_reason", "ielts_preparation_seconds"}).
			AddRow("rt-1", StatusLive, TimingModelIELTSPersonal, roomStart, nil, 120))
	mock.ExpectQuery(regexp.QuoteMeta("FROM exam_session_runtime_sections\n\t\tWHERE runtime_id = ? AND section_key = ?")).WithArgs("rt-1", "listening").
		WillReturnRows(sqlmock.NewRows([]string{"section_order", "planned_duration_minutes", "gap_after_minutes", "extension_minutes", "status", "actual_start_at", "actual_end_at", "paused_at", "accumulated_paused_seconds"}).
			AddRow(0, 30, 0, 0, SectionLive, roomStart, nil, nil, 0))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT UTC_TIMESTAMP(6)")).WillReturnRows(sqlmock.NewRows([]string{"now"}).AddRow(now))
}

func timelineRows(state string, started, deadline, expected, prep any) *sqlmock.Rows {
	return sqlmock.NewRows([]string{"state", "started_at", "deadline_at", "expected_start_at", "preparation_deadline_at", "failure_reason", "paused_at"}).
		AddRow(state, started, deadline, expected, prep, nil, nil)
}

// A first activation answers with the persisted start/deadline, and the
// missing timeline is created active in one insert once readiness is complete.
func TestIELTSReadinessActivationReturnsPersistedTimes(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	roomStart := time.Date(2026, 10, 23, 9, 0, 0, 0, time.UTC)
	now := roomStart.Add(30 * time.Second)
	started := now.Add(5 * time.Millisecond)
	deadline := started.Add(30 * time.Minute)
	ready := true
	mock.ExpectBegin()
	stageIELTSFirstSection(mock, now, roomStart)
	mock.ExpectQuery(regexp.QuoteMeta("FROM ielts_attempt_section_timelines\n\t\t\tWHERE attempt_id = ? AND section_key = ? FOR UPDATE")).WithArgs("att-1", "listening").WillReturnError(sql.ErrNoRows)
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO ielts_attempt_section_timelines")).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectQuery(regexp.QuoteMeta("FROM ielts_attempt_section_timelines\n\t\t\tWHERE attempt_id = ? AND section_key = ? FOR UPDATE")).WithArgs("att-1", "listening").
		WillReturnRows(timelineRows("active", started, deadline, roomStart, roomStart.Add(2*time.Minute)))
	mock.ExpectExec(regexp.QuoteMeta("'IELTS_DELAYED_START'")).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	var out CohortReadiness
	changed := false
	q, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	if err := readyIELTSPersonalSectionInTx(context.Background(), q, "sched-1", "listening", "att-1", "user-1",
		IELTSReadinessSignals{ContentReady: &ready, LocalStorageReady: &ready, AudioReady: &ready}, &out, &changed); err != nil {
		t.Fatal(err)
	}
	if err := q.Commit(); err != nil {
		t.Fatal(err)
	}
	if out.Status != "active" || out.StartedAt == nil || !out.StartedAt.Equal(started) || out.DeadlineAt == nil || !out.DeadlineAt.Equal(deadline) || !changed {
		t.Fatalf("activation must return the persisted times: %+v changed=%v", out, changed)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// A retry of an already-active section takes the stable read branch: no
// insert, no update, no audit, the same stored times.
func TestIELTSReadinessActiveRetryIsReadOnly(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	roomStart := time.Date(2026, 10, 23, 9, 0, 0, 0, time.UTC)
	now := roomStart.Add(5 * time.Minute)
	started := roomStart.Add(30 * time.Second)
	deadline := started.Add(30 * time.Minute)
	mock.ExpectBegin()
	stageIELTSFirstSection(mock, now, roomStart)
	mock.ExpectQuery(regexp.QuoteMeta("FROM ielts_attempt_section_timelines\n\t\t\tWHERE attempt_id = ? AND section_key = ? FOR UPDATE")).WithArgs("att-1", "listening").
		WillReturnRows(timelineRows("active", started, deadline, roomStart, roomStart.Add(2*time.Minute)))
	mock.ExpectCommit()

	var out CohortReadiness
	changed := false
	q, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	if err := readyIELTSPersonalSectionInTx(context.Background(), q, "sched-1", "listening", "att-1", "user-1", IELTSReadinessSignals{}, &out, &changed); err != nil {
		t.Fatal(err)
	}
	if err := q.Commit(); err != nil {
		t.Fatal(err)
	}
	if out.Status != "active" || !out.StartedAt.Equal(started) || !out.DeadlineAt.Equal(deadline) || changed {
		t.Fatalf("active retry must replay the stored times without change: %+v changed=%v", out, changed)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
