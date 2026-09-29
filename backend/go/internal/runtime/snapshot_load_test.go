package runtime

import (
	"context"
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
		WillReturnRows(sqlmock.NewRows([]string{
			"status", "actual_start_at", "planned_duration_minutes",
			"extension_minutes", "accumulated_paused_seconds", "paused_at",
		}).AddRow("live", nil, nil, nil, nil, nil))
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
		WillReturnRows(sqlmock.NewRows([]string{
			"status", "actual_start_at", "planned_duration_minutes",
			"extension_minutes", "accumulated_paused_seconds", "paused_at",
		}).AddRow("paused", nil, nil, nil, nil, nil))
	snap, err := LoadSnapshot(context.Background(), db, "sched-1", time.Now().UTC())
	if err != nil {
		t.Fatalf("LoadSnapshot: %v", err)
	}
	if !snap.SectionPaused || !snap.SectionStarted || snap.SectionLive {
		t.Fatalf("paused section flags mismatch: %+v", snap)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// A planned-but-locked section row exists from the moment the runtime is
// planned, but the section has not opened: SectionStarted must stay false so the
// write gate refuses it as "has not started" instead of treating the row's
// existence as a start.
func TestLoadSnapshotLockedSectionNotStarted(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectQuery("FROM exam_session_runtimes WHERE schedule_id").
		WithArgs("sched-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "status", "active_section_key", "revision", "timing_model", "waiting_for_next_section"}).
			AddRow("rt-1", "live", "math", 2, "legacy_section_v1", false))
	mock.ExpectQuery("FROM exam_session_runtime_sections WHERE").
		WithArgs("rt-1", "math").
		WillReturnRows(sqlmock.NewRows([]string{
			"status", "actual_start_at", "planned_duration_minutes",
			"extension_minutes", "accumulated_paused_seconds", "paused_at",
		}).AddRow("locked", nil, nil, nil, nil, nil))
	snap, err := LoadSnapshot(context.Background(), db, "sched-1", time.Now().UTC())
	if err != nil {
		t.Fatalf("LoadSnapshot: %v", err)
	}
	if snap.SectionStarted || snap.SectionLive || snap.SectionPaused {
		t.Fatalf("a locked section must not report started/live/paused: %+v", snap)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// Between sections: the active section is complete and the runtime is waiting
// for the next one. LoadSnapshot must surface the flag so the in-tx
// ensureWritable refuses the window with the explicit waiting message rather than
// a generic liveness failure.
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
		WillReturnRows(sqlmock.NewRows([]string{
			"status", "actual_start_at", "planned_duration_minutes",
			"extension_minutes", "accumulated_paused_seconds", "paused_at",
		}).AddRow("completed", nil, nil, nil, nil, nil))
	snap, err := LoadSnapshot(context.Background(), db, "sched-1", time.Now().UTC())
	if err != nil {
		t.Fatalf("LoadSnapshot: %v", err)
	}
	if !snap.WaitingForNextSection {
		t.Fatalf("waiting flag must be projected: %+v", snap)
	}
	// The completed section is not live, and the waiting flag is what makes the
	// gate answer "Exam runtime is waiting." rather than "Exam section is not
	// live." (pinned in attempts' writability matrix).
	if snap.SectionLive || !snap.SectionStarted {
		t.Fatalf("completed section flags mismatch: %+v", snap)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
