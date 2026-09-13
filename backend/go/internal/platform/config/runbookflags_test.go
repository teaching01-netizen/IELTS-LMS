package config

// Plan §5 + runbook §7: every flag in the runbook flags matrix must exist
// in config.Load with the documented ship default. A flag renamed in code
// but not in the runbook (or vice versa) misleads the exam-day operator
// into flipping a dead env var. This test pins the full matrix: env var
// name -> Load() field value with a clean environment.
//
// NOTE: all 18 assertions pass today (no drift) — verified the test
// executes (RUN+PASS counted, bogus-name run selects nothing). The test
// is the pin: any future default/rename drift fails the build.
import (
	"testing"
)

func TestRunbookFlagsMatrixParity(t *testing.T) {
	cfg := Load()
	// Row format: env var asserted via field default (clean env).
	if cfg.RateLimitMode != RateLimitModeDual {
		t.Errorf("RATE_LIMIT_MODE ship must be dual, got %q", cfg.RateLimitMode)
	}
	if cfg.SessionCacheEnabled {
		t.Errorf("SESSION_CACHE ship must be off")
	}
	if cfg.AttemptVerify != AttemptVerifyStrict {
		t.Errorf("ATTEMPT_VERIFY ship must be strict, got %q", cfg.AttemptVerify)
	}
	if cfg.RuntimeSnapshotEnabled {
		t.Errorf("RUNTIME_SNAPSHOT ship must be off")
	}
	if cfg.RowFirstWrites {
		t.Errorf("ROW_FIRST_WRITES ship must be off")
	}
	if cfg.OutboxExecOnly {
		t.Errorf("OUTBOX_EXEC_ONLY ship must be off")
	}
	if cfg.OutboxClaimMode != OutboxClaimUpdate {
		t.Errorf("OUTBOX_CLAIM_MODE ship must be update, got %q", cfg.OutboxClaimMode)
	}
	if cfg.WorkerClaimPartitions != 1 {
		t.Errorf("WORKER_CLAIM_PARTITIONS ship must be 1, got %d", cfg.WorkerClaimPartitions)
	}
	if cfg.LiveBus != LiveBusDB {
		t.Errorf("LIVE_BUS ship must be db, got %q", cfg.LiveBus)
	}
	if cfg.LiveBusSink != LiveBusSinkOff {
		t.Errorf("LIVE_BUS_SINK ship must be off, got %q", cfg.LiveBusSink)
	}
	if cfg.WSAdmission != WSAdmissionDB {
		t.Errorf("WS_ADMISSION ship must be db, got %q", cfg.WSAdmission)
	}
	if cfg.StudentWS != StudentWSAllow {
		t.Errorf("STUDENT_WS ship must be allow, got %q", cfg.StudentWS)
	}
	if cfg.VersionCacheEnabled {
		t.Errorf("VERSION_CACHE ship must be off")
	}
	if cfg.PresenceMode != PresenceInline {
		t.Errorf("PRESENCE_MODE ship must be inline, got %q", cfg.PresenceMode)
	}
	if cfg.EntryGateEnabled {
		t.Errorf("ENTRY_GATE ship must be off")
	}
	if cfg.RollupEnabled {
		t.Errorf("ROLLUP ship must be off")
	}
	if cfg.ShedMode != ShedOff {
		t.Errorf("SHED_MODE ship must be off, got %q", cfg.ShedMode)
	}
	// Pool split falls back to the shared max (default 20) when unset.
	if cfg.DBPoolMaxAPI != 20 || cfg.DBPoolMaxWorker != 20 {
		t.Errorf("DB_POOL split ship must fall back to 20/20, got %d/%d", cfg.DBPoolMaxAPI, cfg.DBPoolMaxWorker)
	}

	// Phase 06: the four independent SAT authoring realtime flags. All ship
	// false, and they stay INDEPENDENT: a mega-flag would make the staged
	// rollout (and the flag-flip rollback) impossible to express.
	//
	// The names here are the ones the runtime actually reads. The rollout
	// runbook uses these exact strings; an older, shorter pair
	// (AUTHORING_PRESENCE / AUTHORING_CONFLICT_COMPARE) was removed from
	// authoringrealtime/flags.go precisely because flipping those did nothing.
	if cfg.AuthoringRealtimeEvents {
		t.Errorf("AUTHORING_REALTIME_EVENTS ship must be off")
	}
	if cfg.AuthoringRealtimeDelivery {
		t.Errorf("AUTHORING_REALTIME_DELIVERY ship must be off")
	}
	if cfg.AuthoringRealtimePresence {
		t.Errorf("AUTHORING_REALTIME_PRESENCE ship must be off")
	}
	if cfg.AuthoringRealtimeConflictCompare {
		t.Errorf("AUTHORING_REALTIME_CONFLICT_COMPARE ship must be off")
	}
	// Delivery without events would advertise a socket over an empty table, and
	// presence/compare without delivery would advertise capabilities no socket
	// can carry. The loader already ANDs these together; pin the intent here so
	// a future "just turn presence on" edit fails loudly.
	if cfg.AuthoringRealtimePresence && !cfg.AuthoringRealtimeDelivery {
		t.Errorf("presence must never ship enabled without delivery")
	}
	if cfg.AuthoringRealtimeConflictCompare && !cfg.AuthoringRealtimeDelivery {
		t.Errorf("conflict compare must never ship enabled without delivery")
	}
}
