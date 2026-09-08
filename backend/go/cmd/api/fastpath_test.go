package main

// Plan D3: the entry fast path is fail-CLOSED on outage but fail-OPEN to
// mint on lookup trouble. Nil Schedules -> 503 (cannot mint either);
// lookup error or miss -> (nil,nil) so the caller mints. A lookup error
// must NEVER surface as a 503 — the mint tx (registration lock + replay)
// stays the correctness backstop. RED: all three.
import (
	"context"
	"errors"
	"testing"

	"example.com/ielts-proctoring/internal/schedules"
)

func TestFastPathNilSchedules503(t *testing.T) {
	a := &App{Schedules: nil}
	if _, err := a.fastPathAttempt(context.Background(), "sched-1", "reg-1"); err == nil {
		t.Fatalf("nil Schedules must fail closed with an error")
	}
}

func TestFastPathResolveFallsThrough(t *testing.T) {
	hit := schedules.AttemptRef{AttemptID: "att-1"}
	if ref, err := fastPathResolve(hit, true, nil); err != nil || ref == nil || ref.AttemptID != "att-1" {
		t.Fatalf("hit must return the ref, got %+v err=%v", ref, err)
	}
	if ref, err := fastPathResolve(schedules.AttemptRef{}, false, nil); err != nil || ref != nil {
		t.Fatalf("miss must return (nil,nil) for the mint path, got %+v err=%v", ref, err)
	}
	if ref, err := fastPathResolve(schedules.AttemptRef{}, false, errors.New("replica lag")); err != nil || ref != nil {
		t.Fatalf("lookup trouble must not error (mint is the backstop), got %+v err=%v", ref, err)
	}
}
