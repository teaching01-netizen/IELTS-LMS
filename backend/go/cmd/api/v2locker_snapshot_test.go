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
		WillReturnRows(sqlmock.NewRows([]string{"id", "status", "active_section_key", "revision", "timing_model", "waiting_for_next_section"}).
			AddRow("rt-1", "paused", "rw", 3, "legacy_section_v1", false))
	mock.ExpectQuery("FROM exam_session_runtime_sections WHERE").
		WithArgs("rt-1", "rw").
		WillReturnRows(sqlmock.NewRows([]string{
			"status", "actual_start_at", "planned_duration_minutes",
			"extension_minutes", "accumulated_paused_seconds", "paused_at",
		}).AddRow("live", nil, nil, nil, nil, nil))
	if _, err := lk.gateFor(context.Background(), "sched-1"); err == nil {
		t.Fatalf("paused snapshot must block at pre-gate")
	}
	// Control command bumps revision; cache invalidated; reload live.
	cache.Invalidate("sched-1")
	mock.ExpectQuery("FROM exam_session_runtimes WHERE schedule_id").
		WithArgs("sched-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "status", "active_section_key", "revision", "timing_model", "waiting_for_next_section"}).
			AddRow("rt-1", "live", "rw", 4, "legacy_section_v1", false))
	mock.ExpectQuery("FROM exam_session_runtime_sections WHERE").
		WithArgs("rt-1", "rw").
		WillReturnRows(sqlmock.NewRows([]string{
			"status", "actual_start_at", "planned_duration_minutes",
			"extension_minutes", "accumulated_paused_seconds", "paused_at",
		}).AddRow("live", nil, nil, nil, nil, nil))
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

// Between sections: a waiting snapshot must map its flag onto the gate, which
// is what turns an in-window save into the explicit 422 ("Exam runtime is
// waiting.") rather than a generic liveness refusal — the V2 batch transport
// otherwise never sees the flag, since it locks through this snapshot path.
func TestSnapshotLockerBetweenSectionsBlocked(t *testing.T) {
	snap := runtime.Snapshot{Status: runtime.StatusLive, ActiveSectionKey: strptrOrNil("rw"),
		Revision: 12, WaitingForNextSection: true}
	gate := snapshotGateOf(snap, time.Now().UTC())
	if !gate.WaitingForNextSection {
		t.Fatalf("waiting flag must reach the gate: %+v", gate)
	}
	// The snapshot pre-gate refuses the window, and the flag reaching the gate
	// is what makes the in-tx ensureWritable re-check return the explicit
	// "Exam runtime is waiting." 422 (pinned in attempts' writability matrix).
	err := snap.CheckWritable()
	if err == nil {
		t.Fatal("waiting snapshot must block writes")
	}
	appErr, ok := apperrors.As(err)
	if !ok || appErr.HTTPStatus != 422 {
		t.Fatalf("waiting gate must be a 422: %v", err)
	}
}

func strptrOrNil(s string) *string { return &s }
