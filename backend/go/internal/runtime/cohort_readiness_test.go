package runtime

import (
	"context"
	"database/sql"
	"example.com/ielts-proctoring/internal/platform/apperrors"
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

func TestCohortReadinessDoesNotBlockOnMissingStudents(t *testing.T) {
	yes, no := true, false
	rtt, invalidRTT := 100, -1
	now := time.Date(2026, 10, 18, 3, 0, 0, 0, time.UTC)
	existingStart := now.Add(-time.Minute)
	cases := []struct {
		name          string
		section       string
		roomStatus    string
		sectionStatus string
		proctorStatus string
		remaining     int
		rtt           *int
		signals       []IELTSReadinessSignals
		existingStart *time.Time
		register      bool
		start         bool
		invalid       bool
	}{
		{name: "missing student does not block", remaining: 1, rtt: &rtt, register: true, start: true},
		{name: "all ready still starts", rtt: &rtt, register: true, start: true},
		{name: "explicitly prepared starts", remaining: 1, rtt: &rtt, signals: []IELTSReadinessSignals{{ContentReady: &yes, LocalStorageReady: &yes}}, register: true, start: true},
		{name: "unpainted content does not start", remaining: 2, rtt: &rtt, signals: []IELTSReadinessSignals{{ContentReady: &no}}},
		{name: "failed answer storage does not start", remaining: 2, rtt: &rtt, signals: []IELTSReadinessSignals{{LocalStorageReady: &no}}},
		{name: "listening waits for audio", section: "listening", remaining: 2, rtt: &rtt, signals: []IELTSReadinessSignals{{AudioReady: &no}}},
		{name: "listening ready does not wait for missing student", section: "listening", remaining: 1, rtt: &rtt, signals: []IELTSReadinessSignals{{ContentReady: &yes, LocalStorageReady: &yes, AudioReady: &yes}}, register: true, start: true},
		{name: "reading needs no audio", remaining: 1, rtt: &rtt, signals: []IELTSReadinessSignals{{AudioReady: &no}}, register: true, start: true},
		{name: "latency probe does not start", remaining: 2},
		{name: "room pause prevents start", roomStatus: StatusPaused, remaining: 1, rtt: &rtt, register: true},
		{name: "section pause prevents start", sectionStatus: SectionPaused, remaining: 1, rtt: &rtt, register: true},
		{name: "paused student cannot start the room", proctorStatus: "paused", remaining: 1, rtt: &rtt, register: true},
		{name: "reconnecting student receives original start", existingStart: &existingStart, rtt: &rtt},
		{name: "retry cannot restart timer", existingStart: &existingStart, signals: []IELTSReadinessSignals{{ContentReady: &no}}},
		{name: "invalid transport measurement rejected", rtt: &invalidRTT, invalid: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			svc := NewService(tx.NewRunner(db), nil)
			section, roomStatus, sectionStatus := tc.section, tc.roomStatus, tc.sectionStatus
			if section == "" {
				section = "reading"
			}
			if roomStatus == "" {
				roomStatus = StatusLive
			}
			if sectionStatus == "" {
				sectionStatus = SectionLocked
			}
			proctorStatus := tc.proctorStatus
			if proctorStatus == "" {
				proctorStatus = "active"
			}
			mock.ExpectBegin()
			mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
			mock.ExpectQuery("SELECT COALESCE.*timing_model.*FROM exam_session_runtimes").WithArgs("sch").WillReturnRows(sqlmock.NewRows([]string{"timing_model"}).AddRow(TimingModelLegacy))
			mock.ExpectQuery("FROM exam_schedules WHERE id").WithArgs("sch").WillReturnRows(sqlmock.NewRows(scheduleLockColumns).AddRow("sch", "exam", "ielts", "", "", "proctor", "ver", "live", 1, 120))
			mock.ExpectQuery("FROM student_attempts WHERE schedule_id").WithArgs("sch").WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("a").AddRow("b"))
			mock.ExpectQuery("FROM exam_session_runtimes WHERE schedule_id").WithArgs("sch").WillReturnRows(sqlmock.NewRows([]string{"id", "schedule_id", "exam_id", "status", "section", "revision", "model"}).AddRow("rt", "sch", "exam", roomStatus, section, 1, TimingModelLegacy))
			mock.ExpectQuery("FROM student_attempts WHERE id").WithArgs("a", "sch", "student-a").WillReturnRows(sqlmock.NewRows([]string{"recovery_control", "proctor_status"}).AddRow("", proctorStatus))
			mock.ExpectQuery("SELECT status, actual_start_at").WithArgs("rt", section).WillReturnRows(sqlmock.NewRows([]string{"status", "start"}).AddRow(sectionStatus, tc.existingStart))
			mock.ExpectQuery("SELECT UTC_TIMESTAMP").WillReturnRows(sqlmock.NewRows([]string{"now"}).AddRow(now))
			if tc.register {
				mock.ExpectExec("INSERT INTO ielts_section_readiness").WithArgs("rt", section, "a", *tc.rtt).WillReturnResult(sqlmock.NewResult(0, 1))
			}
			if tc.existingStart == nil && !tc.invalid {
				mock.ExpectQuery("SELECT COALESCE.*SUM").WithArgs("rt", section, "sch").WillReturnRows(sqlmock.NewRows([]string{"remaining", "rtt"}).AddRow(tc.remaining, 100))
			}
			if tc.start {
				mock.ExpectExec("UPDATE exam_session_runtime_sections SET status = 'live'").WithArgs(now.Add(800*time.Millisecond), "rt", section).WillReturnResult(sqlmock.NewResult(0, 1))
				mock.ExpectExec("UPDATE exam_session_runtimes SET waiting").WithArgs("rt").WillReturnResult(sqlmock.NewResult(0, 1))
				mock.ExpectExec("UPDATE student_attempts sa").WithArgs("rt", section, "sch").WillReturnResult(sqlmock.NewResult(0, 2))
				mock.ExpectExec("INSERT INTO outbox_events").WillReturnResult(sqlmock.NewResult(0, 1))
			}
			if tc.invalid {
				mock.ExpectRollback()
			} else {
				mock.ExpectCommit()
			}
			got, err := svc.ReadyCohortSection(context.Background(), "sch", section, "a", "student-a", tc.rtt, tc.signals...)
			if tc.invalid {
				appErr, ok := apperrors.As(err)
				if !ok || appErr.Code != apperrors.CodeValidation {
					t.Fatalf("expected validation error, got %v", err)
				}
			} else {
				if err != nil {
					t.Fatal(err)
				}
				wantStart := tc.existingStart
				if tc.start {
					start := now.Add(800 * time.Millisecond)
					wantStart = &start
				}
				if (got.StartedAt == nil) != (wantStart == nil) || (wantStart != nil && !got.StartedAt.Equal(*wantStart)) {
					t.Fatalf("start = %v, want %v", got.StartedAt, wantStart)
				}
				if tc.existingStart == nil && got.RemainingStudents != tc.remaining {
					t.Fatalf("missing-student diagnostics = %d, want %d", got.RemainingStudents, tc.remaining)
				}
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
