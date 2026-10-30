package runtime

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

// The shared timetable is not a readiness barrier: an ordinary probe returns
// the committed window and records nothing. Only a device that verified its
// whole offline package creates the roster-visible row (proctor visibility),
// and it may do so without a transport measurement.
func TestIELTSSharedReadinessRecordsOnlyVerifiedOfflinePackage(t *testing.T) {
	start := time.Date(2026, 10, 30, 3, 0, 0, 0, time.UTC)
	schedule, err := BuildIELTSSharedSchedule(start, sharedPlan(), ResponseSaveGrace)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(schedule)
	if err != nil {
		t.Fatal(err)
	}
	now := start.Add(-time.Minute)
	yes := true

	for _, tc := range []struct {
		name      string
		roundTrip *int
		offline   *bool
		record    bool
	}{
		{name: "probe", offline: nil},
		{name: "probe with rtt", roundTrip: intPtr(40)},
		{name: "offline package verified", roundTrip: intPtr(40), offline: &yes, record: true},
		{name: "offline package verified without rtt", offline: &yes, record: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			mock.ExpectBegin()
			mock.ExpectQuery("SELECT 1 FROM student_attempts WHERE id").WithArgs("att-1", "sched-1", "user-1").
				WillReturnRows(sqlmock.NewRows([]string{"one"}).AddRow(1))
			mock.ExpectQuery("SELECT id FROM exam_session_runtimes WHERE schedule_id").WithArgs("sched-1").
				WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("rt-1"))
			mock.ExpectQuery("SELECT ielts_shared_schedule FROM exam_session_runtimes WHERE id").WithArgs("rt-1").
				WillReturnRows(sqlmock.NewRows([]string{"schedule"}).AddRow(string(raw)))
			mock.ExpectQuery("SELECT UTC_TIMESTAMP").WillReturnRows(sqlmock.NewRows([]string{"now"}).AddRow(now))
			if tc.record {
				wantMS := 0
				if tc.roundTrip != nil {
					wantMS = *tc.roundTrip
				}
				mock.ExpectExec("INSERT INTO ielts_section_readiness").WithArgs("rt-1", "listening", "att-1", wantMS).
					WillReturnResult(sqlmock.NewResult(1, 1))
			}
			mock.ExpectCommit()

			q, err := db.Begin()
			if err != nil {
				t.Fatal(err)
			}
			var out CohortReadiness
			signals := IELTSReadinessSignals{ContentReady: &yes, LocalStorageReady: &yes, AudioReady: &yes, OfflinePackageReady: tc.offline}
			if err := readyIELTSSharedSectionInTx(context.Background(), q, "sched-1", "listening", "att-1", "user-1", tc.roundTrip, signals, &out); err != nil {
				t.Fatal(err)
			}
			if err := q.Commit(); err != nil {
				t.Fatal(err)
			}
			if out.StartedAt == nil || !out.StartedAt.Equal(schedule.Windows[0].StartAt) || out.DeadlineAt == nil || !out.DeadlineAt.Equal(schedule.Windows[0].DeadlineAt) {
				t.Fatalf("readiness must return the committed window: %+v", out)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func intPtr(v int) *int { return &v }
