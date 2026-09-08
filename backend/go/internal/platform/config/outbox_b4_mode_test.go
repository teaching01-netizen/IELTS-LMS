package config

import (
	"testing"
)

// B4 RED: OUTBOX_EXEC_ONLY defaults off (ship keeps wakeup enqueueing until
// Phase C hub publish lands; flipping on stops wakeup-family INSERTs).
func TestOutboxExecOnlyDefaultsOff(t *testing.T) {
	t.Setenv("OUTBOX_EXEC_ONLY", "")
	if cfg := Load(); cfg.OutboxExecOnly {
		t.Fatalf("OUTBOX_EXEC_ONLY must default off")
	}
}

func TestOutboxExecOnlyOnParses(t *testing.T) {
	for _, v := range []string{"on", "1", "true", " ON "} {
		t.Setenv("OUTBOX_EXEC_ONLY", v)
		if cfg := Load(); !cfg.OutboxExecOnly {
			t.Fatalf("OUTBOX_EXEC_ONLY=%q must enable", v)
		}
	}
}

// B4 RED: worker pool envs fall back to the shared pool max.
func TestWorkerPoolDefaultsFollowShared(t *testing.T) {
	t.Setenv("DB_POOL_MAX_CONNECTIONS", "20")
	t.Setenv("DB_POOL_MAX_API", "")
	t.Setenv("DB_POOL_MAX_WORKER", "")
	cfg := Load()
	if cfg.DBPoolMaxAPI != 20 || cfg.DBPoolMaxWorker != 20 {
		t.Fatalf("pool split must fall back to shared max, got api=%d worker=%d", cfg.DBPoolMaxAPI, cfg.DBPoolMaxWorker)
	}
}

func TestWorkerPoolExplicitSplit(t *testing.T) {
	t.Setenv("DB_POOL_MAX_CONNECTIONS", "20")
	t.Setenv("DB_POOL_MAX_API", "40")
	t.Setenv("DB_POOL_MAX_WORKER", "10")
	cfg := Load()
	if cfg.DBPoolMaxAPI != 40 || cfg.DBPoolMaxWorker != 10 {
		t.Fatalf("explicit split must hold, got api=%d worker=%d", cfg.DBPoolMaxAPI, cfg.DBPoolMaxWorker)
	}
}

// B4 RED: claim partitions default 1 (today's single consumer), mode update.
func TestClaimPartitionsDefaults(t *testing.T) {
	t.Setenv("WORKER_CLAIM_PARTITIONS", "")
	t.Setenv("OUTBOX_CLAIM_MODE", "")
	cfg := Load()
	if cfg.WorkerClaimPartitions != 1 {
		t.Fatalf("partitions must default 1, got %d", cfg.WorkerClaimPartitions)
	}
	if cfg.OutboxClaimMode != OutboxClaimUpdate {
		t.Fatalf("claim mode must default update, got %q", cfg.OutboxClaimMode)
	}
}

func TestClaimModeSkipLockedParses(t *testing.T) {
	t.Setenv("OUTBOX_CLAIM_MODE", "skiplocked")
	if cfg := Load(); cfg.OutboxClaimMode != OutboxClaimSkipLocked {
		t.Fatalf("skiplocked must parse, got %q", cfg.OutboxClaimMode)
	}
}

func TestClaimModeUnknownFailsClosed(t *testing.T) {
	t.Setenv("OUTBOX_CLAIM_MODE", "bogus")
	cfg := Load()
	if err := cfg.ValidateForRuntime(); err == nil {
		t.Fatalf("unknown claim mode must fail validation")
	}
}
