package integration

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"example.com/ielts-proctoring/internal/student"
)

func TestPresenceFlushPreservesRecoveryAndSupersededOwnership(t *testing.T) {
	pool := testDB(t)
	// Connection-local tables isolate this contract from migrated fixtures.
	pool.SetMaxOpenConns(1)
	for _, query := range []string{
		`CREATE TEMPORARY TABLE student_attempts (
			id VARCHAR(96) PRIMARY KEY, schedule_id VARCHAR(96), integrity JSON,
			recovery JSON, recovery_control JSON NULL, active_client_session_id VARCHAR(96),
			revision BIGINT, updated_at DATETIME(6))`,
		`CREATE TEMPORARY TABLE student_heartbeat_events (
			id VARCHAR(96) PRIMARY KEY, attempt_id VARCHAR(96), schedule_id VARCHAR(96),
			mutation_id VARCHAR(160), event_type VARCHAR(32), payload JSON,
			client_timestamp DATETIME(6), server_received_at DATETIME(6),
			UNIQUE KEY mutation (attempt_id, mutation_id))`,
		`INSERT INTO student_attempts VALUES ('attempt', 'schedule',
			'{"answerMarker":42,"lastHeartbeatStatus":"reconnect"}',
			'{"answerRevision":17,"clientSessionId":"new"}', NULL, 'new', 5, UTC_TIMESTAMP(6))`,
		// A staff recovery fenced this attempt: owner cleared, control held.
		`INSERT INTO student_attempts VALUES ('held', 'schedule', '{}', '{}',
			'{"version":"staff_recovery_v1","phase":"held"}', '', 9, UTC_TIMESTAMP(6))`,
	} {
		if _, err := pool.Exec(query); err != nil {
			t.Fatal(err)
		}
	}
	svc := student.NewService(pool, nil)
	beat := student.PresenceDirty{AttemptID: "attempt", ScheduleID: "schedule", ClientSession: "old",
		Status: "disconnect", LastSeen: time.Now().UTC()}
	for range 2 {
		if err := svc.FlushPresence(context.Background(), []student.PresenceDirty{beat}); err != nil {
			t.Fatal(err)
		}
	}
	var integrityRaw, recoveryRaw, owner string
	var revision int64
	read := func() (map[string]any, map[string]any) {
		t.Helper()
		if err := pool.QueryRow(`SELECT integrity, recovery, active_client_session_id, revision FROM student_attempts WHERE id = 'attempt'`).
			Scan(&integrityRaw, &recoveryRaw, &owner, &revision); err != nil {
			t.Fatal(err)
		}
		var integrity, recovery map[string]any
		if err := json.Unmarshal([]byte(integrityRaw), &integrity); err != nil {
			t.Fatal(err)
		}
		if err := json.Unmarshal([]byte(recoveryRaw), &recovery); err != nil {
			t.Fatal(err)
		}
		return integrity, recovery
	}
	integrity, recovery := read()
	if owner != "new" || revision != 5 || integrity["lastHeartbeatStatus"] != "reconnect" || recovery["clientSessionId"] != "new" {
		t.Fatal("superseded heartbeat changed current ownership or metadata")
	}
	beat.ClientSession, beat.LastSeen = "new", beat.LastSeen.Add(time.Second)
	for range 2 {
		if err := svc.FlushPresence(context.Background(), []student.PresenceDirty{beat}); err != nil {
			t.Fatal(err)
		}
	}
	integrity, recovery = read()
	if owner != "new" || integrity["answerMarker"] != float64(42) || recovery["answerRevision"] != float64(17) || integrity["lastHeartbeatStatus"] != "disconnect" {
		t.Fatal("presence replaced answer recovery instead of merging its own metadata")
	}
	// A dirty beat captured before issuance must not refill a held owner.
	stale := student.PresenceDirty{AttemptID: "held", ScheduleID: "schedule", ClientSession: "old",
		Status: "reconnect", LastSeen: time.Now().UTC()}
	if err := svc.FlushPresence(context.Background(), []student.PresenceDirty{stale}); err != nil {
		t.Fatal(err)
	}
	var heldOwner string
	var heldRevision int64
	if err := pool.QueryRow(`SELECT active_client_session_id, revision FROM student_attempts WHERE id = 'held'`).
		Scan(&heldOwner, &heldRevision); err != nil {
		t.Fatal(err)
	}
	if heldOwner != "" || heldRevision != 9 {
		t.Fatalf("delayed flush claimed held recovery: owner=%q revision=%d", heldOwner, heldRevision)
	}
	var events int
	if err := pool.QueryRow("SELECT COUNT(*) FROM student_heartbeat_events").Scan(&events); err != nil || events != 3 {
		t.Fatalf("retried flush created duplicate events: count=%d err=%v", events, err)
	}
}
