package runtime

import (
	"context"
	"database/sql"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/platform/tx"
)

func pollRow(rev int64, status, active string) *sqlmock.Rows {
	return sqlmock.NewRows([]string{"id", "status", "active_section_key", "revision", "timing_model", "waiting_for_next_section"}).
		AddRow("rt-1", status, active, rev, "legacy_section_v1", false)
}

func sectionRow(status string) *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"status",
		"actual_start_at",
		"planned_duration_minutes",
		"extension_minutes",
		"accumulated_paused_seconds",
		"paused_at",
	}).AddRow(status, nil, nil, nil, nil, nil)
}

func timedSectionRow(status string, startedAt time.Time, plannedMinutes int64) *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"status",
		"actual_start_at",
		"planned_duration_minutes",
		"extension_minutes",
		"accumulated_paused_seconds",
		"paused_at",
	}).AddRow(status, startedAt, plannedMinutes, int64(0), int64(0), sql.NullTime{})
}

// C3: sinceRevision == current -> notModified (handler renders 304). The
// second poll hits the B2 cache (zero SQL: no further expectations set —
// any extra query fails the test).
func TestPollNotModified(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := NewService(tx.NewRunner(db), nil).SetSnapshotCache(NewSnapshotCache(time.Minute))
	mock.ExpectQuery("FROM exam_session_runtimes WHERE schedule_id").
		WithArgs("sched-1").
		WillReturnRows(pollRow(9, "live", "rw"))
	mock.ExpectQuery("FROM exam_session_runtime_sections").
		WithArgs("rt-1", "rw").
		WillReturnRows(sectionRow("live"))
	now := time.Now().UTC()
	since := int64(8)
	view, notModified, err := svc.PollView(context.Background(), db, "sched-1", &since, now)
	if err != nil {
		t.Fatalf("poll: %v", err)
	}
	if notModified || view.Revision != 9 || view.Status != "live" {
		t.Fatalf("delta must carry current view: %+v modified=%v", view, !notModified)
	}
	// Cache hit: zero SQL, equal cursor -> not-modified.
	since9 := int64(9)
	view2, notModified2, err := svc.PollView(context.Background(), db, "sched-1", &since9, now)
	if err != nil {
		t.Fatalf("poll2: %v", err)
	}
	if !notModified2 || view2.Revision != 9 {
		t.Fatalf("equal revision must report not-modified: %+v", view2)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// C3: control command (invalidation) within 60s -> fast-lane 2s.
func TestPollDeltaFastLane(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	cache := NewSnapshotCache(time.Minute)
	svc := NewService(tx.NewRunner(db), nil).SetSnapshotCache(cache)
	cache.Invalidate("sched-1") // a control command just committed
	mock.ExpectQuery("FROM exam_session_runtimes WHERE schedule_id").
		WithArgs("sched-1").
		WillReturnRows(pollRow(10, "paused", "rw"))
	mock.ExpectQuery("FROM exam_session_runtime_sections").
		WithArgs("rt-1", "rw").
		WillReturnRows(sectionRow("paused"))
	since := int64(9)
	view, notModified, err := svc.PollView(context.Background(), db, "sched-1", &since, time.Now().UTC())
	if err != nil {
		t.Fatalf("poll: %v", err)
	}
	if notModified {
		t.Fatalf("bumped revision must report delta")
	}
	if view.Revision != 10 || view.Status != "paused" {
		t.Fatalf("delta must carry new revision/status: %+v", view)
	}
	if view.PollAfterSecs != PollFastLaneSecs {
		t.Fatalf("fresh control command must fast-lane %ds, got %d", PollFastLaneSecs, view.PollAfterSecs)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// C3: steady-state (no recent invalidation) -> slow poll 20-30s.
func TestPollDeltaSteadyState(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := NewService(tx.NewRunner(db), nil).SetSnapshotCache(NewSnapshotCache(time.Minute))
	mock.ExpectQuery("FROM exam_session_runtimes WHERE schedule_id").
		WithArgs("sched-1").
		WillReturnRows(pollRow(10, "live", "rw"))
	mock.ExpectQuery("FROM exam_session_runtime_sections").
		WithArgs("rt-1", "rw").
		WillReturnRows(sectionRow("live"))
	since := int64(9)
	view, notModified, err := svc.PollView(context.Background(), db, "sched-1", &since, time.Now().UTC())
	if err != nil {
		t.Fatalf("poll: %v", err)
	}
	if notModified {
		t.Fatalf("bumped revision must report delta")
	}
	if view.PollAfterSecs < 20 || view.PollAfterSecs > 30 {
		t.Fatalf("steady state must poll slowly 20-30s, got %d", view.PollAfterSecs)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// A student must poll tightly near the authoritative section deadline even
// when no proctor command invalidated the runtime cache. Otherwise an
// automatic section transition can be committed on time but remain invisible
// in the browser for the 25-second steady-state interval.
func TestPollDeltaNearSectionDeadlineUsesFastLane(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := NewService(tx.NewRunner(db), nil).SetSnapshotCache(NewSnapshotCache(time.Minute))
	now := time.Date(2026, 9, 19, 10, 0, 59, 0, time.UTC)
	mock.ExpectQuery("FROM exam_session_runtimes WHERE schedule_id").
		WithArgs("sched-1").
		WillReturnRows(pollRow(10, "live", "rw"))
	mock.ExpectQuery("FROM exam_session_runtime_sections").
		WithArgs("rt-1", "rw").
		WillReturnRows(timedSectionRow("live", now.Add(-59*time.Second), 1))

	since := int64(9)
	view, notModified, err := svc.PollView(context.Background(), db, "sched-1", &since, now)
	if err != nil {
		t.Fatalf("poll: %v", err)
	}
	if notModified {
		t.Fatalf("new revision must report delta")
	}
	if view.PollAfterSecs != PollFastLaneSecs {
		t.Fatalf("section within fast-lane window must poll every %ds, got %d", PollFastLaneSecs, view.PollAfterSecs)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// A deadline wake replaces a minute of 2s polls; waiting rooms see Start or
// Resume within PollWaitingSecs.
func TestPollAfterSecsCadence(t *testing.T) {
	now := time.Date(2026, 9, 19, 10, 0, 0, 0, time.UTC)
	at := func(d time.Duration) *time.Time { t := now.Add(d); return &t }
	cases := []struct {
		name string
		snap Snapshot
		want int
	}{
		{"deadline in 10s wakes just past it", Snapshot{Status: StatusLive, SectionDeadlineAt: at(10 * time.Second)}, 11},
		{"deadline in 500ms", Snapshot{Status: StatusLive, SectionDeadlineAt: at(500 * time.Millisecond)}, PollFastLaneSecs},
		{"deadline in 40s rests", Snapshot{Status: StatusLive, SectionDeadlineAt: at(40 * time.Second)}, PollSteadySecs},
		{"deadline passed 5s ago fast-lanes", Snapshot{Status: StatusLive, SectionDeadlineAt: at(-5 * time.Second)}, PollFastLaneSecs},
		{"deadline long past rests", Snapshot{Status: StatusLive, SectionDeadlineAt: at(-2 * time.Minute)}, PollSteadySecs},
		{"no deadline rests", Snapshot{Status: StatusLive}, PollSteadySecs},
		{"not started waits", Snapshot{Status: StatusNotStarted}, PollWaitingSecs},
		{"paused waits", Snapshot{Status: StatusPaused}, PollWaitingSecs},
		{"section paused waits", Snapshot{Status: StatusLive, SectionPaused: true}, PollWaitingSecs},
		{"between sections waits", Snapshot{Status: StatusLive, WaitingForNextSection: true}, PollWaitingSecs},
		{"paused near deadline keeps the earlier wake", Snapshot{Status: StatusPaused, SectionDeadlineAt: at(2 * time.Second)}, 3},
	}
	for _, tc := range cases {
		if got := pollAfterSecs(tc.snap, now); got != tc.want {
			t.Errorf("%s: got %d, want %d", tc.name, got, tc.want)
		}
	}
}
