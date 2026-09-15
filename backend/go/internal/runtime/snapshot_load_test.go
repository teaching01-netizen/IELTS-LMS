package runtime

import (
	"context"
	"strings"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

// B2 RED: LoadSnapshot reads the runtime header with a committed (non-
// locking) read — no FOR UPDATE — plus section liveness, missing row = open
// gate (today's v2Locker behavior for schedules without a runtime yet).
func TestLoadSnapshotCommittedRead(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := NewService(nil, nil)
	_ = svc
	mock.ExpectQuery("FROM exam_session_runtimes WHERE schedule_id").
		WithArgs("sched-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "status", "active_section_key", "revision", "timing_model", "waiting_for_next_section"}).
			AddRow("rt-1", "live", "rw", 4, "cohort_section_v3", false))
	mock.ExpectQuery("FROM exam_session_runtime_sections WHERE").
		WithArgs("rt-1", "rw").
		WillReturnRows(sqlmock.NewRows([]string{"status"}).AddRow("live"))
	snap, err := LoadSnapshot(context.Background(), db, "sched-1", time.Now().UTC())
	if err != nil {
		t.Fatalf("LoadSnapshot: %v", err)
	}
	if snap.Status != StatusLive || snap.Revision != 4 || snap.TimingModel != "cohort_section_v3" {
		t.Fatalf("snapshot mismatch: %+v", snap)
	}
	if snap.ActiveSectionKey == nil || *snap.ActiveSectionKey != "rw" {
		t.Fatalf("active section mismatch: %+v", snap.ActiveSectionKey)
	}
	if !snap.SectionLive || !snap.SectionStarted {
		t.Fatalf("liveness flags mismatch: %+v", snap)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// B2 RED: missing runtime row = open gate (live/*, started), same as the
// FOR UPDATE path's ErrNoRows branch today.
func TestLoadSnapshotMissingRowOpenGate(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectQuery("FROM exam_session_runtimes WHERE schedule_id").
		WithArgs("sched-9").
		WillReturnRows(sqlmock.NewRows([]string{"id", "status", "active_section_key", "revision", "timing_model", "waiting_for_next_section"}))
	snap, err := LoadSnapshot(context.Background(), db, "sched-9", time.Now().UTC())
	if err != nil {
		t.Fatalf("LoadSnapshot: %v", err)
	}
	if snap.Status != StatusLive || !snap.SectionLive || !snap.SectionStarted {
		t.Fatalf("missing row must be open gate: %+v", snap)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// B2 RED: paused section surfaces SectionPaused (snapshot gate blocks).
func TestLoadSnapshotPausedSection(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectQuery("FROM exam_session_runtimes WHERE schedule_id").
		WithArgs("sched-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "status", "active_section_key", "revision", "timing_model", "waiting_for_next_section"}).
			AddRow("rt-1", "live", "rw", 4, "legacy_section_v1", false))
	mock.ExpectQuery("FROM exam_session_runtime_sections WHERE").
		WithArgs("rt-1", "rw").
		WillReturnRows(sqlmock.NewRows([]string{"status"}).AddRow("paused"))
	snap, err := LoadSnapshot(context.Background(), db, "sched-1", time.Now().UTC())
	if err != nil {
		t.Fatalf("LoadSnapshot: %v", err)
	}
	if !snap.SectionPaused || !snap.SectionStarted {
		t.Fatalf("paused section flags mismatch: %+v", snap)
	}
	if err := snap.CheckWritable(); err == nil {
		t.Fatalf("paused-section snapshot must block writes")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// Between sections: the active section is complete and the runtime is waiting
// for the next one. LoadSnapshot must surface the flag so the snapshot
// pre-gate (and the in-tx ensureWritable it mirrors) refuses writes with the
// explicit waiting message rather than a generic liveness failure.
func TestLoadSnapshotBetweenSectionsBlocksWrites(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectQuery("FROM exam_session_runtimes WHERE schedule_id").
		WithArgs("sched-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "status", "active_section_key", "revision", "timing_model", "waiting_for_next_section"}).
			AddRow("rt-1", "live", "rw", 12, "cohort_section_v3", true))
	mock.ExpectQuery("FROM exam_session_runtime_sections WHERE").
		WithArgs("rt-1", "rw").
		WillReturnRows(sqlmock.NewRows([]string{"status"}).AddRow("completed"))
	snap, err := LoadSnapshot(context.Background(), db, "sched-1", time.Now().UTC())
	if err != nil {
		t.Fatalf("LoadSnapshot: %v", err)
	}
	if !snap.WaitingForNextSection {
		t.Fatalf("waiting flag must be projected: %+v", snap)
	}
	err = snap.CheckWritable()
	if err == nil {
		t.Fatal("between-sections snapshot must block writes")
	}
	if !strings.Contains(err.Error(), "waiting") {
		t.Fatalf("expected the explicit waiting refusal, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// The between-sections window is also a wait for the *proctor*: an unrelated
// schedule that is live on a live section must not be affected by the flag.
func TestLoadSnapshotWaitingFlagFalseAllowsWrites(t *testing.T) {
	if err := (Snapshot{Status: StatusLive, ActiveSectionKey: strptr("rw"),
		SectionLive: true, SectionStarted: true}).CheckWritable(); err != nil {
		t.Fatalf("live section with no waiting must allow writes: %v", err)
	}
}
