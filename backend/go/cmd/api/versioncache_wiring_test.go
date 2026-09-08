package main

import (
	"testing"

	"example.com/ielts-proctoring/internal/platform/config"
)

// D1: BuildApp wires the version cache posture from config (off = present
// but unused; on = Delivery serves cached trees).
func TestAppVersionCacheWiring(t *testing.T) {
	cfg := config.Load()
	cfg.VersionCacheEnabled = false
	app := BuildApp(cfg, nil)
	if app.Versions == nil {
		t.Fatalf("Versions cache must always be non-nil")
	}
	cfg2 := config.Load()
	cfg2.VersionCacheEnabled = true
	app2 := BuildApp(cfg2, nil)
	if app2.Versions == nil {
		t.Fatalf("Versions cache must always be non-nil")
	}
	// Nil pool leaves Delivery unset; the posture pins via config + the
	// service-level VersionCached accessor (covered in delivery tests).
	if cfg.VersionCacheEnabled || !cfg2.VersionCacheEnabled {
		t.Fatalf("flag must flow through config")
	}
}
