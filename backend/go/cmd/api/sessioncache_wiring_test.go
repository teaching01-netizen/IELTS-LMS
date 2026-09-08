package main

import (
	"testing"

	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/platform/config"
)

// A2 RED: BuildApp wires a session cache from config — disabled by default
// (nil-safe behavior identical to today), enabled with configured bounds.
func TestBuildAppSessionCacheWiring(t *testing.T) {
	cfg := config.Load()
	cfg.SessionCacheEnabled = false
	app := BuildApp(cfg, nil)
	if app.SessionCache == nil {
		t.Fatalf("BuildApp must always set SessionCache (disabled cache, never nil)")
	}
	if app.SessionCache.HitRate() != 0 {
		t.Fatalf("fresh cache hit rate must be 0")
	}

	cfg2 := config.Load()
	cfg2.SessionCacheEnabled = true
	cfg2.SessionCacheMax = 1000
	cfg2.SessionTouchCoalesceSecs = 60
	app2 := BuildApp(cfg2, nil)
	if app2.SessionCache == nil {
		t.Fatalf("BuildApp must set SessionCache when enabled")
	}
	_ = auth.RoleAdmin
}
