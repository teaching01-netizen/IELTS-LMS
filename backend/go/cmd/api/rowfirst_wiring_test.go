package main

import (
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/platform/config"
)

// WS-16: BuildApp row-first wiring — behavioral divergence at the service
// branch, not just the App flag. With a pool present, ROW_FIRST_WRITES must
// propagate to the Attempts service (the V2 write path keys its branch off
// Attempts.RowFirst; Student read-through keys off the same config flag in
// BuildApp). A wiring that sets App.Config but drops SetRowFirst would keep
// legacy SQL everywhere while the flag claims row-first. Load-bearing line:
// main.go BuildApp Attempts .SetRowFirst(cfg.RowFirstWrites).
func TestAppRowFirstWiring(t *testing.T) {
	for _, tc := range []struct {
		name string
		on   bool
	}{
		{"off keeps legacy write path", false},
		{"on selects row-first write path", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			pool, _, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer func() { _ = pool.Close() }()
			cfg := config.Load()
			cfg.RowFirstWrites = tc.on
			app := BuildApp(cfg, pool)
			if app.RowFirst() != tc.on {
				t.Fatalf("App.RowFirst must mirror config (%v), got %v", tc.on, app.RowFirst())
			}
			if app.Attempts == nil {
				t.Fatalf("pool build must wire the Attempts service")
			}
			if got := app.Attempts.RowFirst(); got != tc.on {
				t.Fatalf("Attempts service row-first branch must be %v, got %v (V2 write path)", tc.on, got)
			}
		})
	}

	// Nil-pool keeps today's degrade posture without panicking.
	cfg := config.Load()
	cfg.RowFirstWrites = false
	if app := BuildApp(cfg, nil); app.RowFirst() {
		t.Fatalf("flag-off must keep legacy write path")
	}
}
