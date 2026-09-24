package proctor

import (
	"context"
	"regexp"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/outbox"
)

// The personal-model completion sweep (plan 2026-09-24) is the only thing that
// ends a sat_personal_v1 runtime, because section clocks never expire those
// attempts. It must therefore be exact: complete once admission is closed AND
// every admitted attempt is terminal, and never before.

var personalRuntimeModelRead = regexp.QuoteMeta("SELECT timing_model FROM exam_session_runtimes WHERE id = ?")
var scheduleEndTimeRead = regexp.QuoteMeta("SELECT end_time FROM exam_schedules WHERE id = ?")
var openAttemptProbe = regexp.QuoteMeta("COALESCE(delivery_status, 'running') NOT IN ('submitted', 'terminated', 'locked', 'cancelled')")

// expectPersonalSweepScan programmes the out-of-band candidate transaction with a
// cohort schedule (so the section path gets nothing) plus one personal candidate.
func expectPersonalSweepScan(mock sqlmock.Sqlmock, asOf time.Time, scheduleID string, limit int64) {
	mock.ExpectBegin()
	mock.ExpectExec(setTimeZone).WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery(candidateQuery).
		WithArgs(asOf, asOf, asOf, limit).
		WillReturnRows(sqlmock.NewRows([]string{"schedule_id", "auto_submit", "provider_key"}))
	mock.ExpectQuery(personalCandidateQuery).
		WithArgs(asOf, limit).
		WillReturnRows(sqlmock.NewRows([]string{"schedule_id"}).AddRow(scheduleID))
	mock.ExpectCommit()
}

// expectPersonalSweepTxPrologue programmes the per-schedule completion
// transaction up to the runtime's timing-model read.
func expectPersonalSweepTxPrologue(mock sqlmock.Sqlmock, scheduleID, runtimeID, status, timingModel string) {
	mock.ExpectBegin()
	mock.ExpectExec(setTimeZone).WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery(regexp.QuoteMeta("FROM exam_schedules WHERE id = ? FOR UPDATE")).
		WithArgs(scheduleID).
		WillReturnRows(sqlmock.NewRows([]string{"id", "exam_id", "provider_key", "sat_timing_model", "published_version_id", "status", "revision", "planned_duration_minutes"}).
			AddRow(scheduleID, "exam-1", "sat", timingModel, "ver-1", "live", 3, 134))
	mock.ExpectQuery(attemptsLock).
		WithArgs(scheduleID).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("att-1"))
	mock.ExpectQuery(runtimeLock).
		WithArgs(scheduleID).
		WillReturnRows(sqlmock.NewRows([]string{"id", "status", "active_section_key", "waiting_for_next_section", "is_overrun", "revision"}).
			AddRow(runtimeID, status, nil, false, false, 7))
	mock.ExpectQuery(personalRuntimeModelRead).
		WithArgs(runtimeID).
		WillReturnRows(sqlmock.NewRows([]string{"timing_model"}).AddRow(timingModel))
}

// expectPersonalSweepAdmissionCheck programmes the admission-closure read (the
// schedule end_time plus the authoritative instant it is compared against).
func expectPersonalSweepAdmissionCheck(mock sqlmock.Sqlmock, scheduleID string, endTime, dbNow time.Time) {
	mock.ExpectQuery(scheduleEndTimeRead).
		WithArgs(scheduleID).
		WillReturnRows(sqlmock.NewRows([]string{"end_time"}).AddRow(endTime))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT UTC_TIMESTAMP(6)")).
		WillReturnRows(sqlmock.NewRows([]string{"ts"}).AddRow(dbNow))
}

// expectPersonalSweepOpenProbe programmes the still-open attempt probe.
func expectPersonalSweepOpenProbe(mock sqlmock.Sqlmock, scheduleID string, open bool) {
	mock.ExpectQuery(openAttemptProbe).
		WithArgs(scheduleID).
		WillReturnRows(sqlmock.NewRows([]string{"open"}).AddRow(open))
}

// expectPersonalSweepCompletion programmes the completion effects.
func expectPersonalSweepCompletion(mock sqlmock.Sqlmock, scheduleID, runtimeID string, revision int64) {
	mock.ExpectExec(regexp.QuoteMeta("UPDATE exam_session_runtimes SET status = 'completed'")).
		WithArgs(runtimeID).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE exam_session_runtime_sections SET status = 'completed'")).
		WithArgs("admission_closed_attempts_terminal", runtimeID).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE exam_schedules SET status = 'completed'")).
		WithArgs(scheduleID).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO cohort_control_events")).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO session_audit_logs")).WillReturnResult(sqlmock.NewResult(0, 1))
	expectRuntimeRevisionRead(mock, revision)
	mock.ExpectCommit()
}

// Once admission has closed and every admitted attempt is terminal, the sweep
// ends the personal runtime and the schedule.
func TestPersonalRuntimeCompletesWhenAdmissionClosedAndAttemptsTerminal(t *testing.T) {
	svc, mock, outbx := newMockService(t)
	base := time.Date(2026, 9, 24, 9, 0, 0, 0, time.UTC)
	endTime := base.Add(4 * time.Hour)
	asOf := endTime.Add(time.Minute)

	expectPersonalSweepScan(mock, asOf, "sched-1", 10)
	expectPersonalSweepTxPrologue(mock, "sched-1", "rt-1", "live", "sat_personal_v1")
	expectPersonalSweepAdmissionCheck(mock, "sched-1", endTime, asOf)
	expectPersonalSweepOpenProbe(mock, "sched-1", false)
	expectPersonalSweepCompletion(mock, "sched-1", "rt-1", 9)

	outcomes, err := svc.ReconcileExpiredSections(context.Background(), asOf, 10, "test")
	if err != nil {
		t.Fatalf("reconcile: %v", err)
	}
	if len(outcomes) != 1 || outcomes[0].RuntimeRevision != 9 {
		t.Fatalf("expected the personal runtime to complete at revision 9, got %+v", outcomes)
	}
	if !contains(outbx.families, outbox.FamilyRuntimeChanged) {
		t.Fatalf("completing a personal runtime must wake the runtime family, got %v", outbx.families)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// A still-open attempt keeps its runtime alive: unlike a cohort section, a
// personal candidate is never cut off by the schedule's end_time, so the sweep
// must not complete the runtime under them.
func TestPersonalRuntimeSweepLeavesAStillOpenAttemptRunning(t *testing.T) {
	svc, mock, _ := newMockService(t)
	base := time.Date(2026, 9, 24, 9, 0, 0, 0, time.UTC)
	endTime := base.Add(4 * time.Hour)
	asOf := endTime.Add(time.Minute)

	expectPersonalSweepScan(mock, asOf, "sched-1", 10)
	expectPersonalSweepTxPrologue(mock, "sched-1", "rt-1", "live", "sat_personal_v1")
	expectPersonalSweepAdmissionCheck(mock, "sched-1", endTime, asOf)
	expectPersonalSweepOpenProbe(mock, "sched-1", true)
	// No completion effects: the runtime stays live and the tx is a clean no-op.
	mock.ExpectCommit()

	outcomes, err := svc.ReconcileExpiredSections(context.Background(), asOf, 10, "test")
	if err != nil {
		t.Fatalf("reconcile: %v", err)
	}
	if len(outcomes) != 0 {
		t.Fatalf("an open attempt must keep its runtime alive, got %+v", outcomes)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// The in-tx guards are the real defence: a stale candidate selection (a closed
// race, a runtime someone else already completed, or a model switch) must not end
// a session. Each guard is pinned by where the transaction stops.
func TestPersonalRuntimeSweepIgnoresAnEarlyOrNonPersonalRuntime(t *testing.T) {
	endTime := time.Date(2026, 9, 24, 13, 0, 0, 0, time.UTC)
	closedAt := endTime.Add(time.Hour)
	for _, tc := range []struct {
		name        string
		timingModel string
		status      string
		dbNow       time.Time
		// closesAtDB is whether the transaction reaches the admission-closure
		// read; beforeDB is whether it also reaches the open-attempt probe. The
		// model and status guards return before either.
		closesAtDB bool
		beforeDB   bool
	}{
		{
			name:        "admission still open",
			timingModel: "sat_personal_v1",
			status:      "live",
			dbNow:       endTime.Add(-time.Hour),
			closesAtDB:  true,
		},
		{
			name:        "runtime already completed",
			timingModel: "sat_personal_v1",
			status:      "completed",
			dbNow:       closedAt,
		},
		{
			name:        "routed away from the personal model",
			timingModel: "cohort_section_v3",
			status:      "live",
			dbNow:       closedAt,
		},
		{
			name:        "an attempt is still open",
			timingModel: "sat_personal_v1",
			status:      "live",
			dbNow:       closedAt,
			closesAtDB:  true,
			beforeDB:    true,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			svc, mock, _ := newMockService(t)
			asOf := tc.dbNow

			expectPersonalSweepScan(mock, asOf, "sched-1", 10)
			expectPersonalSweepTxPrologue(mock, "sched-1", "rt-1", tc.status, tc.timingModel)
			if tc.closesAtDB {
				expectPersonalSweepAdmissionCheck(mock, "sched-1", endTime, tc.dbNow)
			}
			if tc.beforeDB {
				expectPersonalSweepOpenProbe(mock, "sched-1", true)
			}
			mock.ExpectCommit()

			outcomes, err := svc.ReconcileExpiredSections(context.Background(), asOf, 10, "test")
			if err != nil {
				t.Fatalf("reconcile: %v", err)
			}
			if len(outcomes) != 0 {
				t.Fatalf("runtime must not be completed, got %+v", outcomes)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}
