package delivery

import (
	"context"
	"errors"
	"sync"
	"time"

	"example.com/ielts-proctoring/internal/platform/telemetry"
)

const (
	satCloseDefaultActiveLimit = 16
	satCloseQueuedPerActive    = 20
)

var ErrSATCloseAdmissionFull = errors.New("SAT module-close capacity is full")
var ErrSATCloseAdmissionUnavailable = errors.New("SAT module-close admission is unavailable")

type satCloseAdmissionContextKey struct{}

func hasSATCloseAdmission(ctx context.Context) bool {
	if ctx == nil {
		return false
	}
	_, ok := ctx.Value(satCloseAdmissionContextKey{}).(struct{})
	return ok
}

// satCloseActiveLimit bounds closes so saves, lifecycle reads, and staff
// controls keep connections during a synchronized transition wave.
func satCloseActiveLimit(maxOpen int) int {
	if maxOpen < 1 {
		return satCloseDefaultActiveLimit
	}
	// Starts take half of the pool (satStartActiveWorkerLimit); closes take a
	// quarter so both waves together still leave a quarter for other traffic.
	limit := maxOpen / 4
	if limit < 1 {
		return 1
	}
	return limit
}

type satCloseWaiter struct {
	ready   chan struct{}
	granted bool // guarded by satCloseAdmission.mu
}

type satCloseAdmission struct {
	mu          sync.Mutex
	activeLimit int
	maxQueued   int
	active      int
	waiters     []*satCloseWaiter
}

func newSATCloseAdmission(activeLimit int) *satCloseAdmission {
	if activeLimit < 1 {
		activeLimit = 1
	}
	return &satCloseAdmission{
		activeLimit: activeLimit,
		maxQueued:   activeLimit * satCloseQueuedPerActive,
	}
}

// AcquireSATCloseAdmission reserves one close slot before the API's shared
// database-backed write limiter. The returned context marks the reservation
// so the close service does not acquire the same slot twice.
func (s *Service) AcquireSATCloseAdmission(ctx context.Context) (context.Context, func(), error) {
	if s == nil || s.satCloseAdmission == nil || ctx == nil {
		return nil, nil, ErrSATCloseAdmissionUnavailable
	}
	release, err := s.satCloseAdmission.acquire(ctx)
	if err != nil {
		return nil, nil, err
	}
	return context.WithValue(ctx, satCloseAdmissionContextKey{}, struct{}{}), release, nil
}

// acquire bounds both active closes and queued requests. Waiters are served in
// FIFO order, hold no database connection, and are removed on cancellation.
func (a *satCloseAdmission) acquire(ctx context.Context) (func(), error) {
	if ctx == nil {
		return nil, ErrSATCloseAdmissionUnavailable
	}
	startedAt := time.Now()
	if err := ctx.Err(); err != nil {
		countSATCloseAdmissionOutcome("cancelled")
		return nil, err
	}

	a.mu.Lock()
	if a.active < a.activeLimit && len(a.waiters) == 0 {
		a.active++
		a.mu.Unlock()
		if err := ctx.Err(); err != nil {
			a.release()
			countSATCloseAdmissionOutcome(satCloseContextOutcome(err))
			return nil, err
		}
		countSATCloseAdmissionOutcome("admitted")
		return a.releaseFunc(), nil
	}
	if len(a.waiters) >= a.maxQueued {
		a.mu.Unlock()
		countSATCloseAdmissionOutcome("rejected")
		observeSATCloseAdmissionWait("rejected", startedAt)
		return nil, ErrSATCloseAdmissionFull
	}
	waiter := &satCloseWaiter{ready: make(chan struct{})}
	a.waiters = append(a.waiters, waiter)
	a.mu.Unlock()

	select {
	case <-waiter.ready:
		if err := ctx.Err(); err != nil {
			a.returnGrantedSlot(waiter)
			outcome := satCloseContextOutcome(err)
			countSATCloseAdmissionOutcome(outcome)
			observeSATCloseAdmissionWait(outcome, startedAt)
			return nil, err
		}
		countSATCloseAdmissionOutcome("admitted_after_wait")
		observeSATCloseAdmissionWait("admitted_after_wait", startedAt)
		return a.releaseFunc(), nil
	case <-ctx.Done():
		a.cancelWaiter(waiter)
		outcome := satCloseContextOutcome(ctx.Err())
		countSATCloseAdmissionOutcome(outcome)
		observeSATCloseAdmissionWait(outcome, startedAt)
		return nil, ctx.Err()
	}
}

func (a *satCloseAdmission) releaseFunc() func() {
	var once sync.Once
	return func() {
		once.Do(a.release)
	}
}

func (a *satCloseAdmission) release() {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.releaseLocked()
}

func (a *satCloseAdmission) cancelWaiter(waiter *satCloseWaiter) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if waiter.granted {
		a.releaseLocked()
		return
	}
	for i, queued := range a.waiters {
		if queued != waiter {
			continue
		}
		copy(a.waiters[i:], a.waiters[i+1:])
		a.waiters[len(a.waiters)-1] = nil
		a.waiters = a.waiters[:len(a.waiters)-1]
		return
	}
}

func (a *satCloseAdmission) returnGrantedSlot(waiter *satCloseWaiter) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if waiter.granted {
		a.releaseLocked()
	}
}

func (a *satCloseAdmission) releaseLocked() {
	for len(a.waiters) > 0 {
		waiter := a.waiters[0]
		a.waiters[0] = nil
		a.waiters = a.waiters[1:]
		if waiter == nil {
			continue
		}
		waiter.granted = true
		close(waiter.ready)
		return
	}
	if a.active > 0 {
		a.active--
	}
}

func satCloseContextOutcome(err error) string {
	if errors.Is(err, context.DeadlineExceeded) {
		return "timed_out"
	}
	return "cancelled"
}

func countSATCloseAdmissionOutcome(outcome string) {
	telemetry.IncCounter(telemetry.MSATCloseAdmissionTotal, "outcome", outcome)
}

func observeSATCloseAdmissionWait(outcome string, startedAt time.Time) {
	telemetry.ObserveSeconds(
		telemetry.MSATCloseAdmissionWaitSeconds,
		time.Since(startedAt).Seconds(),
		"outcome", outcome,
	)
}
