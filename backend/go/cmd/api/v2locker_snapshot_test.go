package main

import (
	"context"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/attempts"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/runtime"
)

func snapshotGateOf(snap runtime.Snapshot, now time.Time) attempts.RuntimeGate {
	return snapshotRuntimeGate(snap, now)
}

// B2 RED: snapshot pre-gate maps a live snapshot to a live gate (no SQL).
func TestSnapshotLockerLiveGate(t *testing.T) {
	snap := runtime.Snapshot{Status: runtime.StatusLive, ActiveSectionKey: strptrOrNil("rw"), Revision: 3, SectionLive: true, SectionStarted: true}
	now := time.Now().UTC()
	gate := snapshotGateOf(snap, now)
	if gate.Status != "live" || !gate.SectionLive || !gate.SectionStarted {
		t.Fatalf("live snapshot must map to live gate: %+v", gate)
	}
	if gate.ActiveSectionKey != "rw" {
		t.Fatalf("active section must carry through: %+v", gate)
	}
}

// B2 RED: paused snapshot blocks at the pre-gate with today's 422 family.
func TestSnapshotLockerPausedBlocked(t *testing.T) {
	snap := runtime.Snapshot{Status: runtime.StatusPaused, Revision: 3}
	if err := snap.CheckWritable(); err == nil {
		t.Fatalf("paused snapshot must block")
	}
	if _, ok := apperrors.As(snap.CheckWritable()); !ok {
		t.Fatalf("block must be apperrors-coded")
	}
}

// B2 RED: snapshotLocker refreshes once on stale snapshot then succeeds:
// first load paused (gate blocks), refresh loads live (gate passes).
func TestSnapshotLockerRefreshOnce(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	cache := runtime.NewSnapshotCache(time.Second)
	lk := snapshotLocker{db: db, cache: cache}
	// First load: paused runtime.
	mock.ExpectQuery("FROM exam_session_runtimes WHERE schedule_id").
		WithArgs("sched-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "status", "active_section_key", "revision", "timing_model"}).
			AddRow("rt-1", "paused", "rw", 3, "legacy_section_v1"))
	mock.ExpectQuery("FROM exam_session_runtime_sections WHERE").
		WithArgs("rt-1", "rw").
		WillReturnRows(sqlmock.NewRows([]string{"status"}).AddRow("live"))
	if _, err := lk.gateFor(context.Background(), "sched-1"); err == nil {
		t.Fatalf("paused snapshot must block at pre-gate")
	}
	// Control command bumps revision; cache invalidated; reload live.
	cache.Invalidate("sched-1")
	mock.ExpectQuery("FROM exam_session_runtimes WHERE schedule_id").
		WithArgs("sched-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "status", "active_section_key", "revision", "timing_model"}).
			AddRow("rt-1", "live", "rw", 4, "legacy_section_v1"))
	mock.ExpectQuery("FROM exam_session_runtime_sections WHERE").
		WithArgs("rt-1", "rw").
		WillReturnRows(sqlmock.NewRows([]string{"status"}).AddRow("live"))
	gate, err := lk.gateFor(context.Background(), "sched-1")
	if err != nil {
		t.Fatalf("refreshed live snapshot must pass: %v", err)
	}
	if gate.Status != "live" {
		t.Fatalf("refreshed gate must be live: %+v", gate)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func strptrOrNil(s string) *string { return &s }
