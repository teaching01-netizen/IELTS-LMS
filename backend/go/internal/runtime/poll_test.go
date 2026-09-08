package runtime

import (
	"context"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/platform/tx"
)

func pollRow(rev int64, status, active string) *sqlmock.Rows {
	return sqlmock.NewRows([]string{"id", "status", "active_section_key", "revision", "timing_model"}).
		AddRow("rt-1", status, active, rev, "legacy_section_v1")
}

func sectionRow(status string) *sqlmock.Rows {
	return sqlmock.NewRows([]string{"status"}).AddRow(status)
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
