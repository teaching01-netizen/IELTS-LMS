package main

import (
	"context"
	"database/sql"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/attempts"
	"example.com/ielts-proctoring/internal/runtime"
)

// snapshotRuntimeGate maps a live runtime view onto the gate the write path
// consumes, including the active section key.
func TestSnapshotRuntimeGateMapping(t *testing.T) {
	snap := runtime.Snapshot{Status: runtime.StatusLive, ActiveSectionKey: strptrOrNil("rw"), Revision: 3, SectionLive: true, SectionStarted: true}
	now := time.Now().UTC()
	gate := snapshotRuntimeGate(snap, now)
	if gate.Status != "live" || !gate.SectionLive || !gate.SectionStarted {
		t.Fatalf("live snapshot must map to live gate: %+v", gate)
	}
	if gate.ActiveSectionKey != "rw" {
		t.Fatalf("active section must carry through: %+v", gate)
	}
	if gate.Now != now.UTC() {
		t.Fatalf("in-tx db time must be authoritative: %+v", gate)
	}
}

// A snapshot with no active section is "no section scoping": the gate must fall
// back to "*" so ensureQuestionAdmitted does not compare against a nil section.
func TestSnapshotRuntimeGateWithoutActiveSection(t *testing.T) {
	gate := snapshotRuntimeGate(runtime.Snapshot{Status: runtime.StatusLive, SectionLive: true, SectionStarted: true}, time.Now().UTC())
	if gate.ActiveSectionKey != "*" {
		t.Fatalf("missing active section must map to *: %+v", gate)
	}
}

// Between sections: the waiting flag reaches the gate, which is what turns an
// in-window save into the explicit 422 ("Exam runtime is waiting.") from the
// in-tx ensureWritable check rather than a generic liveness refusal.
func TestSnapshotRuntimeGateBetweenSections(t *testing.T) {
	snap := runtime.Snapshot{Status: runtime.StatusLive, ActiveSectionKey: strptrOrNil("rw"),
		Revision: 12, WaitingForNextSection: true}
	gate := snapshotRuntimeGate(snap, time.Now().UTC())
	if !gate.WaitingForNextSection {
		t.Fatalf("waiting flag must reach the gate: %+v", gate)
	}
}

// snapshotLocker reads the runtime + active section on the transaction it is
// handed, without locks: a paused section arrives at the gate as paused, a live
// one as live. The gate's authority is this read, not any cached view.
func TestSnapshotLockerReadsCurrentStateOnTheTransaction(t *testing.T) {
	cases := []struct {
		name        string
		section     string
		wantLive    bool
		wantPaused  bool
		wantStarted bool
	}{
		{"live", "live", true, false, true},
		{"paused", "paused", false, true, true},
		{"planned but locked", "locked", false, false, false},
		{"completed", "completed", false, false, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			mock.ExpectBegin()
			sqlTx, err := db.Begin()
			if err != nil {
				t.Fatal(err)
			}
			mock.ExpectQuery("FROM exam_session_runtimes WHERE schedule_id").
				WithArgs("sched-1").
				WillReturnRows(sqlmock.NewRows([]string{"id", "status", "active_section_key", "revision", "timing_model", "waiting_for_next_section"}).
					AddRow("rt-1", "live", "rw", 4, "legacy_section_v1", false))
			mock.ExpectQuery("FROM exam_session_runtime_sections").
				WithArgs("rt-1", "rw").
				WillReturnRows(sqlmock.NewRows([]string{"status"}).AddRow(tc.section))
			mock.ExpectQuery("SELECT UTC_TIMESTAMP").
				WillReturnRows(sqlmock.NewRows([]string{"now"}).AddRow(time.Now().UTC()))
			mock.ExpectRollback()

			gate, err := snapshotLocker{}.Lock(context.Background(), sqlTx, "sched-1")
			if err != nil {
				t.Fatal(err)
			}
			if gate.SectionLive != tc.wantLive || gate.SectionPaused != tc.wantPaused || gate.SectionStarted != tc.wantStarted {
				t.Fatalf("%s section must map to live=%v paused=%v started=%v, got %+v",
					tc.section, tc.wantLive, tc.wantPaused, tc.wantStarted, gate)
			}
			if err := sqlTx.Rollback(); err != nil {
				t.Fatal(err)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

// A schedule with no runtime row at all is an open gate, exactly as v2Locker's
// ErrNoRows branch treats it (legacy schedules without a runtime).
func TestSnapshotLockerOpenGateWithoutRuntimeRow(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectBegin()
	sqlTx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	mock.ExpectQuery("FROM exam_session_runtimes WHERE schedule_id").WithArgs("sched-1").WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery("SELECT UTC_TIMESTAMP").WillReturnRows(sqlmock.NewRows([]string{"now"}).AddRow(time.Now().UTC()))
	mock.ExpectRollback()

	gate, err := snapshotLocker{}.Lock(context.Background(), sqlTx, "sched-1")
	if err != nil {
		t.Fatal(err)
	}
	if gate.Status != "live" || !gate.SectionLive || !gate.SectionStarted || gate.ActiveSectionKey != "*" {
		t.Fatalf("missing runtime must be an open gate: %+v", gate)
	}
	if err := sqlTx.Rollback(); err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// The two gate modes must reach the SAME verdict for the same committed section
// state — one shared mapping (runtime.SectionLiveness), so "no mode silently
// skips the check" is a testable property rather than a comment. Each mode is
// driven through its own SQL shape (FOR UPDATE vs lock-free) against the same
// staged rows.
func TestLockerModesAgreeOnEverySectionStatus(t *testing.T) {
	for _, status := range []string{"live", "paused", "locked", "completed", ""} {
		t.Run("section="+status, func(t *testing.T) {
			locked, unlocked := status, status
			v2 := lockWithV2Locker(t, &locked)
			snap := lockWithSnapshotLocker(t, &unlocked)
			if v2.Status != snap.Status || v2.WaitingForNextSection != snap.WaitingForNextSection ||
				v2.ActiveSectionKey != snap.ActiveSectionKey || v2.SectionLive != snap.SectionLive ||
				v2.SectionPaused != snap.SectionPaused || v2.SectionStarted != snap.SectionStarted {
				t.Fatalf("gate modes disagree for section %q: v2Locker=%+v snapshotLocker=%+v", status, v2, snap)
			}
		})
	}
}

// lockWithV2Locker runs the FOR UPDATE gate against staged rows; a nil status
// stages a runtime whose active section has no row (fail closed).
func lockWithV2Locker(t *testing.T, sectionStatus *string) attempts.RuntimeGate {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectBegin()
	mock.ExpectQuery("FROM exam_session_runtimes WHERE schedule_id").WithArgs("sched-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "status", "timing_model", "active_section_key", "waiting_for_next_section"}).
			AddRow("rt-1", "live", "legacy_section_v1", "rw", false))
	mock.ExpectQuery("SELECT UTC_TIMESTAMP").WillReturnRows(sqlmock.NewRows([]string{"now"}).AddRow(time.Now().UTC()))
	sectionRow(mock, sectionStatus)
	mock.ExpectRollback()
	sqlTx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	gate, err := v2Locker{}.Lock(context.Background(), sqlTx, "sched-1")
	if err != nil {
		t.Fatal(err)
	}
	if err := sqlTx.Rollback(); err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
	return gate
}

// lockWithSnapshotLocker is the same staged state through the lock-free gate.
func lockWithSnapshotLocker(t *testing.T, sectionStatus *string) attempts.RuntimeGate {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectBegin()
	mock.ExpectQuery("FROM exam_session_runtimes WHERE schedule_id").WithArgs("sched-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "status", "active_section_key", "revision", "timing_model", "waiting_for_next_section"}).
			AddRow("rt-1", "live", "rw", 4, "legacy_section_v1", false))
	sectionRow(mock, sectionStatus)
	mock.ExpectQuery("SELECT UTC_TIMESTAMP").WillReturnRows(sqlmock.NewRows([]string{"now"}).AddRow(time.Now().UTC()))
	mock.ExpectRollback()
	sqlTx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	gate, err := snapshotLocker{}.Lock(context.Background(), sqlTx, "sched-1")
	if err != nil {
		t.Fatal(err)
	}
	if err := sqlTx.Rollback(); err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
	return gate
}

// Both modes must satisfy the same port (and both are the RuntimeLockerFor
// choices).
var (
	_ attempts.RuntimeLocker = v2Locker{}
	_ attempts.RuntimeLocker = snapshotLocker{}
)

func strptrOrNil(s string) *string { return &s }
