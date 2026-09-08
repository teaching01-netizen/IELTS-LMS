package config

import (
	"testing"
)

// A2 RED: SESSION_CACHE defaults off (behavior-preserving ship state).
func TestSessionCacheDefaultsOff(t *testing.T) {
	t.Setenv("SESSION_CACHE", "")
	t.Setenv("SESSION_CACHE_MAX", "")
	t.Setenv("SESSION_TOUCH_COALESCE_SECS", "")
	cfg := Load()
	if cfg.SessionCacheEnabled {
		t.Fatalf("SESSION_CACHE must default off")
	}
	if cfg.SessionCacheMax != 150000 {
		t.Fatalf("SESSION_CACHE_MAX default = %d, want 150000", cfg.SessionCacheMax)
	}
	if cfg.SessionTouchCoalesceSecs != 300 {
		t.Fatalf("SESSION_TOUCH_COALESCE_SECS default = %d, want 300", cfg.SessionTouchCoalesceSecs)
	}
}

// A2 RED: explicit on + bounds parse; garbage max falls back to default.
func TestSessionCacheExplicitParses(t *testing.T) {
	t.Setenv("SESSION_CACHE", "on")
	t.Setenv("SESSION_CACHE_MAX", "1000")
	t.Setenv("SESSION_TOUCH_COALESCE_SECS", "60")
	cfg := Load()
	if !cfg.SessionCacheEnabled {
		t.Fatalf("SESSION_CACHE=on must enable")
	}
	if cfg.SessionCacheMax != 1000 {
		t.Fatalf("SESSION_CACHE_MAX = %d, want 1000", cfg.SessionCacheMax)
	}
	if cfg.SessionTouchCoalesceSecs != 60 {
		t.Fatalf("SESSION_TOUCH_COALESCE_SECS = %d, want 60", cfg.SessionTouchCoalesceSecs)
	}
}

// A2 RED: non-positive max/coalesce fall back to safe defaults (never
// unbounded cache, never zero-window hot UPDATE loop).
func TestSessionCacheBoundsFallBack(t *testing.T) {
	t.Setenv("SESSION_CACHE", "1")
	t.Setenv("SESSION_CACHE_MAX", "-5")
	t.Setenv("SESSION_TOUCH_COALESCE_SECS", "0")
	cfg := Load()
	if cfg.SessionCacheMax != 150000 {
		t.Fatalf("bad max must fall back to 150000, got %d", cfg.SessionCacheMax)
	}
	if cfg.SessionTouchCoalesceSecs != 300 {
		t.Fatalf("bad coalesce must fall back to 300, got %d", cfg.SessionTouchCoalesceSecs)
	}
}
