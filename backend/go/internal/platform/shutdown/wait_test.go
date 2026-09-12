package shutdown

import (
	"context"
	"syscall"
	"testing"
	"time"
)

// WS-16 P2: shutdown contract. Wait returns on context cancellation
// (orchestrator stop) without needing a real SIGINT/SIGTERM, and
// DrainTimeout bounds in-flight draining at 30s.
func TestWaitReturnsOnContextCancel(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		defer close(done)
		Wait(ctx)
	}()
	cancel()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatalf("Wait must return promptly on context cancellation")
	}
}

func TestWaitReturnsOnPreCancelledContext(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	done := make(chan struct{})
	go func() {
		defer close(done)
		Wait(ctx)
	}()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatalf("Wait on an already-cancelled context must return immediately")
	}
}

func TestWaitReturnsOnSIGTERM(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan struct{})
	go func() {
		defer close(done)
		Wait(ctx)
	}()
	// Give Wait a moment to install its signal handler, then deliver a
	// real SIGTERM to this test process: Wait must observe it.
	time.Sleep(200 * time.Millisecond)
	if err := syscall.Kill(syscall.Getpid(), syscall.SIGTERM); err != nil {
		t.Skipf("cannot signal self: %v", err)
	}
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatalf("Wait must return on SIGTERM")
	}
}

func TestDrainTimeoutBoundsDraining(t *testing.T) {
	if DrainTimeout != 30*time.Second {
		t.Fatalf("DrainTimeout must bound draining at 30s, got %v", DrainTimeout)
	}
	if DrainTimeout <= 0 {
		t.Fatalf("DrainTimeout must be positive")
	}
}
