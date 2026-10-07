package main

// Real-InnoDB check that the default V2 runtime gate (v2Locker) lets every
// candidate in a schedule pass it at once. It used to take the shared
// runtime and section rows FOR UPDATE, so each responses:batch and submit in
// the room waited for every other candidate's open transaction.
//
// Gated on TEST_MYSQL_DSN like the other real-MySQL suites in this package.

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestV2LockerDoesNotSerializeCandidatesInOneSchedule(t *testing.T) {
	db := staleETagTestDB(t)
	scheduleID, _, _, _, _ := seedStaleETagExam(t, db)
	ctx := context.Background()
	if _, err := db.ExecContext(ctx,
		"UPDATE exam_session_runtimes SET timing_model = 'cohort_section_v3', active_section_key = 'reading-writing' WHERE schedule_id = ?",
		scheduleID); err != nil {
		t.Fatalf("seed cohort runtime: %v", err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO exam_session_runtime_sections (
		id, runtime_id, section_key, label, section_order, planned_duration_minutes, status, actual_start_at
	) SELECT ?, id, 'reading-writing', 'Reading and Writing', 0, 120, 'live', UTC_TIMESTAMP()
	FROM exam_session_runtimes WHERE schedule_id = ?`, uuid.NewString(), scheduleID); err != nil {
		t.Fatalf("seed live section: %v", err)
	}
	// Registered after the seed, so it runs before the runtime row is deleted.
	t.Cleanup(func() {
		if _, err := db.ExecContext(context.Background(),
			"DELETE FROM exam_session_runtime_sections WHERE runtime_id IN (SELECT id FROM exam_session_runtimes WHERE schedule_id = ?)",
			scheduleID); err != nil {
			t.Errorf("cleanup live section: %v", err)
		}
	})

	// Candidate A passes the gate and keeps its transaction open (a slow save).
	first, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatalf("begin first tx: %v", err)
	}
	defer func() { _ = first.Rollback() }()
	if gate, err := (v2Locker{}).Lock(ctx, first, scheduleID); err != nil || !gate.SectionLive {
		t.Fatalf("first gate: live=%v err=%v", gate.SectionLive, err)
	}

	// Candidate B must pass the same gate without waiting for A.
	callCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	second, err := db.BeginTx(callCtx, nil)
	if err != nil {
		t.Fatalf("begin second tx: %v", err)
	}
	defer func() { _ = second.Rollback() }()
	gate, err := (v2Locker{}).Lock(callCtx, second, scheduleID)
	if err != nil {
		t.Fatalf("second candidate's gate must not wait on the first candidate's open transaction: %v", err)
	}
	if !gate.SectionLive || gate.ActiveSectionKey != "reading-writing" {
		t.Fatalf("second gate = %+v, want the live reading-writing section", gate)
	}
}
