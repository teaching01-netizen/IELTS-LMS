package liveupdates

import (
	"testing"
	"time"
)

// C2 RED: caps — total/user/schedule reject with reason; same-shape success.
func TestAdmissionCaps(t *testing.T) {
	a := NewAdmission(AdmissionCaps{Total: 2, PerUser: 1, PerSchedule: 2, TTL: time.Minute})
	defer a.Stop()
	if _, ok, reason := a.Acquire("u1", strptr("s1")); !ok || reason != "" {
		t.Fatalf("first acquire must admit, got ok=%v reason=%q", ok, reason)
	}
	if _, ok, reason := a.Acquire("u1", strptr("s1")); ok || reason != "user_cap" {
		t.Fatalf("second user conn must hit user_cap, got ok=%v reason=%q", ok, reason)
	}
	if _, ok, reason := a.Acquire("u2", strptr("s1")); !ok || reason != "" {
		t.Fatalf("u2 must admit, got ok=%v reason=%q", ok, reason)
	}
	if _, ok, reason := a.Acquire("u3", strptr("s2")); ok || reason != "total_cap" {
		t.Fatalf("third conn must hit total_cap, got ok=%v reason=%q", ok, reason)
	}
	a2 := NewAdmission(AdmissionCaps{Total: 100, PerUser: 100, PerSchedule: 1, TTL: time.Minute})
	defer a2.Stop()
	if _, ok, _ := a2.Acquire("u1", strptr("s1")); !ok {
		t.Fatalf("a2 first must admit")
	}
	if _, ok, reason := a2.Acquire("u2", strptr("s1")); ok || reason != "schedule_cap" {
		t.Fatalf("same-schedule must hit schedule_cap, got ok=%v reason=%q", ok, reason)
	}
}

// C2 RED: heartbeat extends TTL; release frees caps; expiry frees caps.
func TestAdmissionLifecycle(t *testing.T) {
	a := NewAdmission(AdmissionCaps{Total: 1, PerUser: 1, PerSchedule: 1, TTL: 60 * time.Millisecond})
	defer a.Stop()
	tok, ok, _ := a.Acquire("u1", strptr("s1"))
	if !ok {
		t.Fatalf("must admit")
	}
	if !a.Heartbeat(tok) {
		t.Fatalf("heartbeat on live lease must succeed")
	}
	if a.Heartbeat("bogus") {
		t.Fatalf("heartbeat on unknown token must fail")
	}
	a.Release(tok)
	if _, ok, _ := a.Acquire("u1", strptr("s1")); !ok {
		t.Fatalf("release must free caps")
	}
	if _, ok, _ := a.Acquire("u2", nil); ok {
		t.Fatalf("total=1 must still hold")
	}
	a.Release("nonexistent")
	time.Sleep(120 * time.Millisecond)
	if _, ok, _ := a.Acquire("u9", nil); !ok {
		t.Fatalf("expiry must free caps")
	}
}

// C2 RED: background reaper expires TTL entries (memory bounded without
// explicit release); Active() reports live count.
func TestAdmissionReaperAndActive(t *testing.T) {
	a := NewAdmission(AdmissionCaps{Total: 100, PerUser: 100, PerSchedule: 100, TTL: 40 * time.Millisecond})
	defer a.Stop()
	for i := 0; i < 5; i++ {
		if _, ok, _ := a.Acquire("u", nil); !ok {
			t.Fatalf("must admit")
		}
	}
	if got := a.Active(); got != 5 {
		t.Fatalf("active = %d, want 5", got)
	}
	deadline := time.Now().Add(3 * time.Second)
	for a.Active() != 0 && time.Now().Before(deadline) {
		time.Sleep(20 * time.Millisecond)
	}
	if got := a.Active(); got != 0 {
		t.Fatalf("reaper must drain expired, active = %d", got)
	}
}

// C2: concurrent acquires never exceed caps and never race (run -race).
func TestAdmissionConcurrentAcquire(t *testing.T) {
	a := NewAdmission(AdmissionCaps{Total: 100, PerUser: 10, PerSchedule: 50, TTL: time.Minute})
	defer a.Stop()
	done := make(chan bool, 40)
	for i := 0; i < 40; i++ {
		go func(n int) {
			user := string(rune('a' + n%5))
			_, ok, _ := a.Acquire(user, strptr("s1"))
			done <- ok
		}(i)
	}
	admitted := 0
	for i := 0; i < 40; i++ {
		if <-done {
			admitted++
		}
	}
	// schedule cap 50 >> 40 contenders, but per-user cap 10 x 5 users = 50;
	// all 40 must admit (no over-admit possible: admitted <= min(total)).
	if admitted != 40 {
		t.Fatalf("admitted = %d, want 40", admitted)
	}
	if got := a.Active(); got != 40 {
		t.Fatalf("active = %d, want 40", got)
	}
	// Over-cap hammer: 200 contenders on total=100 must admit <= 100.
	a2 := NewAdmission(AdmissionCaps{Total: 100, PerUser: 200, PerSchedule: 200, TTL: time.Minute})
	defer a2.Stop()
	done2 := make(chan bool, 200)
	for i := 0; i < 200; i++ {
		go func(n int) {
			_, ok, _ := a2.Acquire("u", nil)
			done2 <- ok
		}(i)
	}
	admitted2 := 0
	for i := 0; i < 200; i++ {
		if <-done2 {
			admitted2++
		}
	}
	if admitted2 != 100 {
		t.Fatalf("admitted2 = %d, want exactly 100", admitted2)
	}
}

func strptr(s string) *string { return &s }
