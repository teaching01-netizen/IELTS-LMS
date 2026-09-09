package httpx

// Plan single-deploy scale (round 137, TDD): the staggered 5k wave showed
// connection EOFs under sustained 5k concurrency while the app stayed
// healthy — the conn layer (WriteTimeout vs slow saturated handlers) is
// the next lever. Pin the current defaults first so tuning is a
// deliberate diff, not drift.
import (
	"testing"
	"time"
)

func TestDefaultServerConfigBoundsWaveSaturation(t *testing.T) {
	cfg := DefaultServerConfig()
	if cfg.ReadHeaderTimeout != 5*time.Second {
		t.Fatalf("ReadHeaderTimeout = %v, want 5s", cfg.ReadHeaderTimeout)
	}
	if cfg.ReadTimeout != 15*time.Second {
		t.Fatalf("ReadTimeout = %v, want 15s", cfg.ReadTimeout)
	}
	if cfg.WriteTimeout != 30*time.Second {
		t.Fatalf("WriteTimeout = %v, want 30s", cfg.WriteTimeout)
	}
	if cfg.IdleTimeout != 120*time.Second {
		t.Fatalf("IdleTimeout = %v, want 120s", cfg.IdleTimeout)
	}
	// Wave finding (round 136): saturated entry handlers ran up to ~38s
	// (p95 43s incl. queue sleeps client-side). A 30s WriteTimeout can
	// therefore sever slow-but-healthy admissions mid-wave — the EOF
	// class. This test documents the bound; raising it is the lever.
	if cfg.WriteTimeout < 30*time.Second {
		t.Fatalf("WriteTimeout = %v, must stay >= 30s until the wave lever lands", cfg.WriteTimeout)
	}
}
