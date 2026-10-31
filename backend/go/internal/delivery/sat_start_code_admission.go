package delivery

import (
	"context"
	"database/sql"
	"errors"
	"math/rand/v2"
	"sync"
	"time"

	"example.com/ielts-proctoring/internal/platform/telemetry"
)

const SATStartCodeAdmissionWaitLimit = 15 * time.Second

const (
	startCodeAdmissionWaiterLimit = 600
	startCodeAdmissionWaitLimit   = SATStartCodeAdmissionWaitLimit
	startCodeCapacityPollMin      = 5 * time.Millisecond
	startCodeCapacityPollMax      = 25 * time.Millisecond
	startCodeActiveStartDefault   = 24
)

var (
	errStartCodeCapacityFull         = errors.New("sat start-code pending capacity is full")
	errStartCodeAdmissionDeadline    = errors.New("sat start-code admission wait deadline reached")
	errStartCodeAdmissionWaiterLimit = errors.New("sat start-code admission waiter limit reached")
	errStartCodeRuntimeAlreadyExists = errors.New("sat start-code runtime already exists on exclusive path")
	errStartCodeReservationNotUsable = errors.New("sat start-code reservation is no longer usable")
)

type satStartAdmission struct {
	mu                 sync.Mutex
	schedules          map[string]*satStartAdmissionSchedule
	activeStartWorkers chan struct{}
	startWorkerWaiters []*satStartWorkerWaiter
	totalWaiters       int
}

// satStartWorkerWaiter receives a released worker slot directly, so queued
// starts are admitted in arrival order instead of racing a broadcast wakeup.
type satStartWorkerWaiter struct {
	ready   chan struct{}
	granted bool
}

type satStartAdmissionSchedule struct {
	initializing bool
	runtimeReady bool
	waiters      int
	changed      chan struct{}
}

func newSATStartAdmission() *satStartAdmission {
	return newSATStartAdmissionWithLimit(startCodeActiveStartDefault)
}

func newSATStartAdmissionWithLimit(activeLimit int) *satStartAdmission {
	if activeLimit < 1 {
		activeLimit = 1
	}
	return &satStartAdmission{
		schedules:          make(map[string]*satStartAdmissionSchedule),
		activeStartWorkers: make(chan struct{}, activeLimit),
	}
}

// satStartActiveWorkerLimit gives starts half of the pool. Close admission
// takes a quarter (satCloseActiveLimit), so a start wave overlapping a close
// wave still leaves a quarter for saves, heartbeats, and bootstrap reads.
func satStartActiveWorkerLimit(db any) int {
	statsProvider, ok := db.(interface{ Stats() sql.DBStats })
	if !ok {
		return startCodeActiveStartDefault
	}
	maxOpen := statsProvider.Stats().MaxOpenConnections
	if maxOpen < 1 {
		return startCodeActiveStartDefault
	}
	if limit := maxOpen / 2; limit > 1 {
		return limit
	}
	return 1
}

func (s *Service) startCodeAdmission() *satStartAdmission {
	s.satStartAdmissionOnce.Do(func() {
		if s.satStartAdmission == nil {
			s.satStartAdmission = newSATStartAdmissionWithLimit(satStartActiveWorkerLimit(s.dbStats))
		}
	})
	return s.satStartAdmission
}

// acquireStartWorker places all StartWithCode database work behind one
// process-local active-work cap. Waiters hold no database connection; the
// durable slot table remains the cross-process authority.
func (a *satStartAdmission) acquireStartWorker(ctx context.Context, scheduleID string, deadline time.Time, timing *SATStartCodeAdmissionTiming) (func(), error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	a.mu.Lock()
	if !time.Now().Before(deadline) {
		a.mu.Unlock()
		return nil, errStartCodeAdmissionDeadline
	}
	state := a.scheduleLocked(scheduleID)
	if len(a.startWorkerWaiters) == 0 && len(a.activeStartWorkers) < cap(a.activeStartWorkers) {
		a.activeStartWorkers <- struct{}{}
		a.deleteIdleScheduleLocked(scheduleID, state)
		a.mu.Unlock()
		return a.startWorkerReleaseFunc(), nil
	}
	if _, ok := a.enterWaitLocked(state); !ok {
		a.deleteIdleScheduleLocked(scheduleID, state)
		a.mu.Unlock()
		return nil, errStartCodeAdmissionWaiterLimit
	}
	waiter := &satStartWorkerWaiter{ready: make(chan struct{})}
	a.startWorkerWaiters = append(a.startWorkerWaiters, waiter)
	waitBegan := time.Now()
	a.mu.Unlock()
	telemetry.IncCounter(telemetry.MSATStartCodeAdmissionWaitTotal, "stage", "start_worker", "outcome", "waiting")

	deadlineTimer := time.NewTimer(time.Until(deadline))
	defer deadlineTimer.Stop()
	var waitErr error
	select {
	case <-waiter.ready:
	case <-ctx.Done():
		waitErr = ctx.Err()
	case <-deadlineTimer.C:
		waitErr = errStartCodeAdmissionDeadline
	}
	timing.record("start_worker_wait", time.Since(waitBegan))
	if waitErr != nil {
		a.cancelStartWorkerWaiter(waiter)
	}
	a.leaveWaiter(scheduleID)
	if waitErr != nil {
		return nil, waitErr
	}
	return a.startWorkerReleaseFunc(), nil
}

func (a *satStartAdmission) startWorkerReleaseFunc() func() {
	var once sync.Once
	return func() {
		once.Do(a.releaseStartWorker)
	}
}

func (a *satStartAdmission) releaseStartWorker() {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.releaseStartWorkerLocked()
}

// releaseStartWorkerLocked hands the slot to the oldest waiter, keeping the
// active count unchanged, or frees it when nobody is queued.
func (a *satStartAdmission) releaseStartWorkerLocked() {
	for len(a.startWorkerWaiters) > 0 {
		waiter := a.startWorkerWaiters[0]
		a.startWorkerWaiters[0] = nil
		a.startWorkerWaiters = a.startWorkerWaiters[1:]
		if waiter == nil {
			continue
		}
		waiter.granted = true
		close(waiter.ready)
		return
	}
	<-a.activeStartWorkers
}

// cancelStartWorkerWaiter removes a timed-out waiter, or passes on a slot that
// was granted in the same instant the wait gave up.
func (a *satStartAdmission) cancelStartWorkerWaiter(waiter *satStartWorkerWaiter) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if waiter.granted {
		a.releaseStartWorkerLocked()
		return
	}
	for i, queued := range a.startWorkerWaiters {
		if queued != waiter {
			continue
		}
		copy(a.startWorkerWaiters[i:], a.startWorkerWaiters[i+1:])
		a.startWorkerWaiters[len(a.startWorkerWaiters)-1] = nil
		a.startWorkerWaiters = a.startWorkerWaiters[:len(a.startWorkerWaiters)-1]
		return
	}
}

// acquireInitializer admits one cold-runtime initializer per schedule in this
// API process. The gate is advisory only; the database schedule lock remains
// authoritative across processes.
func (a *satStartAdmission) acquireInitializer(ctx context.Context, scheduleID string, deadline time.Time, timing *SATStartCodeAdmissionTiming) (func(), error) {
	for {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		a.mu.Lock()
		if !time.Now().Before(deadline) {
			a.mu.Unlock()
			return nil, errStartCodeAdmissionDeadline
		}
		state := a.scheduleLocked(scheduleID)
		if state.runtimeReady {
			a.mu.Unlock()
			return nil, nil
		}
		if !state.initializing {
			state.initializing = true
			a.mu.Unlock()
			return func() { a.releaseInitializer(scheduleID) }, nil
		}
		signal, ok := a.enterWaitLocked(state)
		if !ok {
			a.mu.Unlock()
			return nil, errStartCodeAdmissionWaiterLimit
		}
		waitBegan := time.Now()
		a.mu.Unlock()
		telemetry.IncCounter(telemetry.MSATStartCodeAdmissionWaitTotal, "stage", "initializer", "outcome", "waiting")
		waitErr := waitForSATStartAdmission(ctx, deadline, signal, 0)
		runtimeReady := a.leaveInitializerWaiter(scheduleID)
		timing.record("initializer_wait", time.Since(waitBegan))
		if waitErr != nil {
			return nil, waitErr
		}
		if runtimeReady {
			return nil, nil
		}
	}
}

// waitForCapacity registers against the same per-schedule waiter bound as the
// initializer gate. Its timer guarantees cross-process progress checks even
// when no local reservation settlement can publish a wakeup.
func (a *satStartAdmission) waitForCapacity(ctx context.Context, scheduleID string, deadline time.Time, timing *SATStartCodeAdmissionTiming) error {
	a.mu.Lock()
	if !time.Now().Before(deadline) {
		a.mu.Unlock()
		return errStartCodeAdmissionDeadline
	}
	state := a.scheduleLocked(scheduleID)
	signal, ok := a.enterWaitLocked(state)
	if !ok {
		a.mu.Unlock()
		return errStartCodeAdmissionWaiterLimit
	}
	waitBegan := time.Now()
	a.mu.Unlock()
	telemetry.IncCounter(telemetry.MSATStartCodeAdmissionWaitTotal, "stage", "capacity", "outcome", "waiting")
	defer a.leaveWaiter(scheduleID)
	waitErr := waitForSATStartAdmission(ctx, deadline, signal, nextSATStartCapacityPoll())
	timing.record("capacity_wait", time.Since(waitBegan))
	return waitErr
}

func (a *satStartAdmission) scheduleLocked(scheduleID string) *satStartAdmissionSchedule {
	state := a.schedules[scheduleID]
	if state == nil {
		state = &satStartAdmissionSchedule{changed: make(chan struct{})}
		a.schedules[scheduleID] = state
	}
	return state
}

func (a *satStartAdmission) enterWaitLocked(state *satStartAdmissionSchedule) (<-chan struct{}, bool) {
	if state.waiters >= startCodeAdmissionWaiterLimit || a.totalWaiters >= startCodeAdmissionWaiterLimit {
		return nil, false
	}
	state.waiters++
	a.totalWaiters++
	return state.changed, true
}

func (a *satStartAdmission) leaveWaiter(scheduleID string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	state := a.schedules[scheduleID]
	if state == nil {
		return
	}
	state.waiters--
	a.totalWaiters--
	a.deleteIdleScheduleLocked(scheduleID, state)
}

func (a *satStartAdmission) leaveInitializerWaiter(scheduleID string) bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	state := a.schedules[scheduleID]
	if state == nil {
		return false
	}
	state.waiters--
	a.totalWaiters--
	runtimeReady := state.runtimeReady
	a.deleteIdleScheduleLocked(scheduleID, state)
	return runtimeReady
}

func (a *satStartAdmission) releaseInitializer(scheduleID string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	state := a.schedules[scheduleID]
	if state == nil || !state.initializing {
		return
	}
	state.initializing = false
	a.signalLocked(state)
	a.deleteIdleScheduleLocked(scheduleID, state)
}

// markRuntimeReady releases initializer waiters as shared-runtime callers.
// The database remains authoritative; a stale local hint takes the transaction's
// existing shared-to-exclusive retry path.
func (a *satStartAdmission) markRuntimeReady(scheduleID string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	state := a.schedules[scheduleID]
	if state == nil {
		return
	}
	state.runtimeReady = true
	state.initializing = false
	a.signalLocked(state)
	a.deleteIdleScheduleLocked(scheduleID, state)
}

func (a *satStartAdmission) notifySchedule(scheduleID string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if state := a.schedules[scheduleID]; state != nil {
		a.signalLocked(state)
	}
}

func (a *satStartAdmission) signalLocked(state *satStartAdmissionSchedule) {
	close(state.changed)
	state.changed = make(chan struct{})
}

func (a *satStartAdmission) deleteIdleScheduleLocked(scheduleID string, state *satStartAdmissionSchedule) {
	if !state.initializing && state.waiters == 0 {
		delete(a.schedules, scheduleID)
	}
}

func waitForSATStartAdmission(ctx context.Context, deadline time.Time, changed <-chan struct{}, pollDelay time.Duration) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	remaining := time.Until(deadline)
	if remaining <= 0 {
		return errStartCodeAdmissionDeadline
	}
	deadlineTimer := time.NewTimer(remaining)
	defer deadlineTimer.Stop()
	if pollDelay <= 0 {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-deadlineTimer.C:
			return errStartCodeAdmissionDeadline
		case <-changed:
			if time.Until(deadline) <= 0 {
				return errStartCodeAdmissionDeadline
			}
			return ctx.Err()
		}
	}
	if pollDelay > remaining {
		pollDelay = remaining
	}
	pollTimer := time.NewTimer(pollDelay)
	defer pollTimer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-deadlineTimer.C:
		return errStartCodeAdmissionDeadline
	case <-pollTimer.C:
		if err := ctx.Err(); err != nil {
			return err
		}
		if time.Until(deadline) <= 0 {
			return errStartCodeAdmissionDeadline
		}
		return nil
	case <-changed:
		jitter := nextSATStartCapacityPoll()
		if jitter > time.Until(deadline) {
			jitter = time.Until(deadline)
		}
		jitterTimer := time.NewTimer(jitter)
		defer jitterTimer.Stop()
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-deadlineTimer.C:
			return errStartCodeAdmissionDeadline
		case <-jitterTimer.C:
			if err := ctx.Err(); err != nil {
				return err
			}
			if time.Until(deadline) <= 0 {
				return errStartCodeAdmissionDeadline
			}
			return nil
		}
	}
}

func nextSATStartCapacityPoll() time.Duration {
	span := int64(startCodeCapacityPollMax - startCodeCapacityPollMin)
	return startCodeCapacityPollMin + time.Duration(rand.Int64N(span+1))
}
