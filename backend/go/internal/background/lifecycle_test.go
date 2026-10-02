package background

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func waitState(t *testing.T, l *Lifecycle, want string) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if l.State() == want {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatalf("state = %s, want %s", l.State(), want)
}

func TestLifecycleIdleDoesNoPeriodicWorkAndConcurrentWakeResumesOnce(t *testing.T) {
	var resumes, drains, parks atomic.Int32
	l := NewLifecycle(context.Background(), 20*time.Millisecond, LifecycleHooks{
		Resume: func(context.Context) error { resumes.Add(1); return nil },
		Drain:  func(context.Context) error { drains.Add(1); return nil },
		Park:   func() error { parks.Add(1); return nil },
	})
	defer l.Close()
	waitState(t, l, "idle")
	before := drains.Load()
	time.Sleep(80 * time.Millisecond)
	if drains.Load() != before {
		t.Fatal("idle runtime polled again")
	}
	var wg sync.WaitGroup
	hold := make(chan struct{})
	for range 24 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			release, err := l.Reserve(context.Background())
			if err != nil {
				t.Error(err)
				return
			}
			defer release()
			<-hold
		}()
	}
	waitState(t, l, "active")
	close(hold)
	wg.Wait()
	if resumes.Load() != 2 {
		t.Fatalf("activation count = %d", resumes.Load())
	}
	waitState(t, l, "idle")
	if parks.Load() != 2 {
		t.Fatalf("park count = %d", parks.Load())
	}
}

func TestLifecycleRequestDuringDrainPreventsParking(t *testing.T) {
	draining := make(chan struct{})
	var first atomic.Bool
	var parks atomic.Int32
	l := NewLifecycle(context.Background(), 20*time.Millisecond, LifecycleHooks{
		Resume: func(context.Context) error { return nil },
		Drain: func(ctx context.Context) error {
			if first.CompareAndSwap(false, true) {
				close(draining)
				<-ctx.Done()
				return ctx.Err()
			}
			return nil
		},
		Park: func() error { parks.Add(1); return nil },
	})
	defer l.Close()
	select {
	case <-draining:
	case <-time.After(3 * time.Second):
		t.Fatal("drain did not start")
	}
	release, err := l.Reserve(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if parks.Load() != 0 {
		t.Fatal("parked across an arriving request")
	}
	time.Sleep(30 * time.Millisecond)
	if l.State() != "active" {
		t.Fatal("slept with a request in flight")
	}
	release()
	waitState(t, l, "idle")
}

func TestLifecycleUnknownWorkRefusesIdle(t *testing.T) {
	var parks atomic.Int32
	l := NewLifecycle(context.Background(), 20*time.Millisecond, LifecycleHooks{
		Resume: func(context.Context) error { return nil },
		Drain:  func(context.Context) error { return errors.New("database unavailable") },
		Park:   func() error { parks.Add(1); return nil },
	})
	defer l.Close()
	waitState(t, l, "active")
	time.Sleep(80 * time.Millisecond)
	if parks.Load() != 0 {
		t.Fatal("parked when the work check failed")
	}
}

func TestLifecycleInternalTrackingDoesNotWakeIdleJobs(t *testing.T) {
	var resumes atomic.Int32
	l := NewLifecycle(context.Background(), 20*time.Millisecond, LifecycleHooks{
		Resume: func(context.Context) error { resumes.Add(1); return nil },
	})
	defer l.Close()
	waitState(t, l, "idle")
	release := l.Track()
	release()
	time.Sleep(30 * time.Millisecond)
	if resumes.Load() != 1 {
		t.Fatal("dependency probe restarted jobs")
	}
}
