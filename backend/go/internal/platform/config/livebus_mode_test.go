package config

import (
	"testing"
)

// C1 RED: LIVE_BUS selects the live path. db (ship state) keeps today's
// AppendInTx-in-tx + forwarder poll; direct publishes Hub-only post-commit
// with zero live-bus SQL on hot paths. Unknown values fail closed.
func TestLiveBusDefaultsDB(t *testing.T) {
	t.Setenv("LIVE_BUS", "")
	if cfg := Load(); cfg.LiveBus != LiveBusDB {
		t.Fatalf("LIVE_BUS must default db, got %q", cfg.LiveBus)
	}
}

func TestLiveBusDirectParses(t *testing.T) {
	t.Setenv("LIVE_BUS", "direct")
	if cfg := Load(); cfg.LiveBus != LiveBusDirect {
		t.Fatalf("direct must parse, got %q", cfg.LiveBus)
	}
}

func TestLiveBusUnknownFailsClosed(t *testing.T) {
	t.Setenv("LIVE_BUS", "bogus")
	cfg := Load()
	if cfg.IsDirect() {
		t.Fatalf("unknown mode must not report direct")
	}
	if err := cfg.ValidateForRuntime(); err == nil {
		t.Fatalf("unknown LIVE_BUS must fail validation")
	}
}

// C1 RED: LIVE_BUS_SINK selects the debug sink. off (default) stops
// live-bus writes entirely; sample keeps a 1:1000 async row for debugging.
func TestLiveBusSinkDefaultsOff(t *testing.T) {
	t.Setenv("LIVE_BUS_SINK", "")
	if cfg := Load(); cfg.LiveBusSink != LiveBusSinkOff {
		t.Fatalf("sink must default off, got %q", cfg.LiveBusSink)
	}
}

func TestLiveBusSinkSampleParses(t *testing.T) {
	t.Setenv("LIVE_BUS_SINK", "sample")
	if cfg := Load(); cfg.LiveBusSink != LiveBusSinkSample {
		t.Fatalf("sample must parse, got %q", cfg.LiveBusSink)
	}
}

// C1: direct without exec-only fails closed (wakeup rows would be dropped).
func TestLiveBusDirectRequiresExecOnly(t *testing.T) {
	t.Setenv("LIVE_BUS", "direct")
	t.Setenv("OUTBOX_EXEC_ONLY", "")
	if err := Load().ValidateForRuntime(); err == nil {
		t.Fatalf("direct without exec-only must fail validation")
	}
	t.Setenv("OUTBOX_EXEC_ONLY", "on")
	// AuthSecret default is weak; only assert the live/outbox rule here by
	// checking IsDirect + OutboxExecOnly parse (full Validate needs secrets).
	cfg := Load()
	if !cfg.IsDirect() || !cfg.OutboxExecOnly {
		t.Fatalf("direct+exec-only must parse, got %+v", cfg.LiveBus)
	}
}

func TestLiveBusSinkUnknownFailsClosed(t *testing.T) {
	t.Setenv("LIVE_BUS_SINK", "bogus")
	if err := Load().ValidateForRuntime(); err == nil {
		t.Fatalf("unknown sink must fail validation")
	}
}
