package main

import (
	"testing"
	"time"

	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/platform/config"
)

// WS-16: BuildApp session-cache wiring — behavioral divergence (hit path vs
// miss path), not a nil guard. Enabled must store + serve (Put then Get
// hits, HitRate 1); disabled must never store (Put dropped, Get misses,
// HitRate 0 = today's DB behavior). Load-bearing production line: main.go
// BuildApp SessionCache wiring (Enabled: cfg.SessionCacheEnabled).
func TestBuildAppSessionCacheWiring(t *testing.T) {
	now := time.Now().UTC()
	mkSession := func() auth.Session {
		return auth.Session{
			ID: "sess-1", UserID: "u-1", Role: auth.RoleAdmin,
			ExpiresAt: now.Add(time.Hour), IdleTimeoutAt: now.Add(time.Hour),
		}
	}

	cfg := config.Load()
	cfg.SessionCacheEnabled = false
	off := BuildApp(cfg, nil)
	if off.SessionCache == nil {
		t.Fatalf("BuildApp must always set SessionCache (disabled cache, never nil)")
	}
	off.SessionCache.Put("h-off", mkSession(), now)
	if _, ok := off.SessionCache.Get("h-off", now); ok {
		t.Fatalf("disabled cache must miss (Put must be dropped = today's DB path)")
	}
	if got := off.SessionCache.Len(); got != 0 {
		t.Fatalf("disabled cache must store nothing, Len=%d", got)
	}
	if got := off.SessionCache.HitRate(); got != 0 {
		t.Fatalf("disabled cache hit rate must be 0, got %v", got)
	}

	cfg2 := config.Load()
	cfg2.SessionCacheEnabled = true
	cfg2.SessionCacheMax = 1000
	cfg2.SessionTouchCoalesceSecs = 60
	on := BuildApp(cfg2, nil)
	if on.SessionCache == nil {
		t.Fatalf("BuildApp must set SessionCache when enabled")
	}
	on.SessionCache.Put("h-on", mkSession(), now)
	got, ok := on.SessionCache.Get("h-on", now)
	if !ok {
		t.Fatalf("enabled cache must serve the stored session (hit path)")
	}
	if got.UserID != "u-1" {
		t.Fatalf("hit must return the stored session, got user %q", got.UserID)
	}
	if hr := on.SessionCache.HitRate(); hr != 1 {
		t.Fatalf("enabled cache hit rate must be 1 after Put+Get, got %v", hr)
	}
}
