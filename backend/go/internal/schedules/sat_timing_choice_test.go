package schedules

import (
	"context"
	"database/sql"
	"regexp"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/platform/tx"
	examruntime "example.com/ielts-proctoring/internal/runtime"
)

// The sat_personal_v1 rollout (plan 2026-09-24) is opt-in per created schedule
// and reversible without rewriting a live session, and the stored choice must
// ride along on every read of the schedule so the client and the run sheet can
// label the plan.

var timingChoiceWrite = regexp.QuoteMeta("UPDATE exam_schedules SET sat_timing_model = ? WHERE id = ?")

// A newly created SAT schedule opts into the personal timing model.
func TestPersistSatTimingChoiceOptsNewSatSchedulesIn(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta("SET time_zone")).WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec(timingChoiceWrite).
		WithArgs(examruntime.TimingModelPersonal, "sched-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	if err := writeTimingChoice(t, db, "sched-1", "sat"); err != nil {
		t.Fatalf("a new SAT schedule must opt in: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// The off switch stops new schedules from opting in. Existing rows keep their
// stored choice, which is why this is a Create-time decision only.
func TestPersistSatTimingChoiceHonoursTheOffSwitch(t *testing.T) {
	t.Setenv(satPersonalTimingEnv, "off")
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta("SET time_zone")).WillReturnResult(sqlmock.NewResult(0, 0))
	// No UPDATE: sqlmock fails on an unexpected statement.
	mock.ExpectCommit()

	if err := writeTimingChoice(t, db, "sched-1", "sat"); err != nil {
		t.Fatalf("the off switch must be a clean no-op: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// A non-SAT schedule never carries the SAT timing choice.
func TestPersistSatTimingChoiceIgnoresNonSatSchedules(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta("SET time_zone")).WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectCommit()

	if err := writeTimingChoice(t, db, "sched-1", "ielts"); err != nil {
		t.Fatalf("a non-SAT schedule must be untouched: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func writeTimingChoice(t *testing.T, db *sql.DB, scheduleID, providerKey string) error {
	t.Helper()
	return tx.NewRunner(db).WithTx(context.Background(), func(ctx context.Context, q tx.Tx) error {
		return persistSatTimingChoice(ctx, q, scheduleID, providerKey)
	})
}

// The stored choice is projected on every read (Get/List share scanSchedule), so
// the client can render the plan label without a second endpoint.
func TestScanScheduleProjectsTheStoredTimingChoice(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := NewService(db, tx.NewRunner(db))

	now := time.Date(2026, 9, 24, 9, 0, 0, 0, time.UTC)
	mock.ExpectQuery(regexp.QuoteMeta("sat_timing_model FROM exam_schedules WHERE id = ?")).
		WithArgs("sched-1").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "exam_id", "provider_key", "organization_id", "exam_title",
			"proctor_display_name", "grading_display_name", "published_version_id",
			"cohort_name", "institution", "start_time", "end_time",
			"planned_duration_minutes", "delivery_mode", "status", "revision",
			"recurrence_type", "recurrence_interval", "recurrence_end_date",
			"buffer_before_minutes", "buffer_after_minutes", "auto_start", "auto_stop",
			"created_at", "created_by", "updated_at", "sat_timing_model",
		}).AddRow(
			"sched-1", "exam-1", "sat", nil, "SAT Practice",
			"SAT Practice", "SAT Practice", "pv-1",
			"Cohort A", nil, now, now.Add(4*time.Hour),
			134, "online", "scheduled", 3,
			"none", 1, nil,
			0, 0, true, false,
			now, "admin-1", now, examruntime.TimingModelPersonal,
		))

	sch, err := svc.Get(context.Background(), "sched-1")
	if err != nil {
		t.Fatalf("get schedule: %v", err)
	}
	if sch.SatTimingModel == nil || *sch.SatTimingModel != examruntime.TimingModelPersonal {
		t.Fatalf("the stored timing choice must be projected, got %v", sch.SatTimingModel)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// A legacy row (NULL choice) projects as no choice, so old schedules keep the
// deployed cohort model.
func TestScanScheduleLeavesALegacyChoiceUnset(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := NewService(db, tx.NewRunner(db))

	now := time.Date(2026, 9, 24, 9, 0, 0, 0, time.UTC)
	mock.ExpectQuery(regexp.QuoteMeta("sat_timing_model FROM exam_schedules WHERE id = ?")).
		WithArgs("sched-1").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "exam_id", "provider_key", "organization_id", "exam_title",
			"proctor_display_name", "grading_display_name", "published_version_id",
			"cohort_name", "institution", "start_time", "end_time",
			"planned_duration_minutes", "delivery_mode", "status", "revision",
			"recurrence_type", "recurrence_interval", "recurrence_end_date",
			"buffer_before_minutes", "buffer_after_minutes", "auto_start", "auto_stop",
			"created_at", "created_by", "updated_at", "sat_timing_model",
		}).AddRow(
			"sched-1", "exam-1", "sat", nil, "SAT Practice",
			"SAT Practice", "SAT Practice", "pv-1",
			"Cohort A", nil, now, now.Add(4*time.Hour),
			134, "online", "scheduled", 3,
			"none", 1, nil,
			0, 0, true, false,
			now, "admin-1", now, nil,
		))

	sch, err := svc.Get(context.Background(), "sched-1")
	if err != nil {
		t.Fatalf("get schedule: %v", err)
	}
	if sch.SatTimingModel != nil {
		t.Fatalf("a legacy row must project as no choice, got %q", *sch.SatTimingModel)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
