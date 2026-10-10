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
	mu                  sync.Mutex
	schedules           map[string]*satStartAdmissionSchedule
	activeStartWorkers  chan struct{}
	startWorkersChanged chan struct{}
	totalWaiters        int
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
		schedules:           make(map[string]*satStartAdmissionSchedule),
		activeStartWorkers:  make(chan struct{}, activeLimit),
		startWorkersChanged: make(chan struct{}),
	}
}

func satStartActiveWorkerLimit(db any) int {
	statsProvider, ok := db.(interface{ Stats() sql.DBStats })
	if !ok {
		return startCodeActiveStartDefault
	}
	maxOpen := statsProvider.Stats().MaxOpenConnections
	if maxOpen < 1 {
		return startCodeActiveStartDefault
	}
	reserved := maxOpen / 4
	if reserved < 1 {
		reserved = 1
	}
	limit := maxOpen - reserved
	if limit < 1 {
		return 1
	}
	return limit
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
		if len(a.activeStartWorkers) < cap(a.activeStartWorkers) {
			a.activeStartWorkers <- struct{}{}
			a.deleteIdleScheduleLocked(scheduleID, state)
			a.mu.Unlock()
			var once sync.Once
			return func() {
				once.Do(a.releaseStartWorker)
			}, nil
		}
		_, ok := a.enterWaitLocked(state)
		if !ok {
			a.mu.Unlock()
			return nil, errStartCodeAdmissionWaiterLimit
		}
		changed := a.startWorkersChanged
		waitBegan := time.Now()
		a.mu.Unlock()
		telemetry.IncCounter(telemetry.MSATStartCodeAdmissionWaitTotal, "stage", "start_worker", "outcome", "waiting")
		waitErr := waitForSATStartAdmission(ctx, deadline, changed, 0)
		timing.record("start_worker_wait", time.Since(waitBegan))
		a.leaveWaiter(scheduleID)
		if waitErr != nil {
			return nil, waitErr
		}
	}
}

func (a *satStartAdmission) releaseStartWorker() {
	a.mu.Lock()
	defer a.mu.Unlock()
	<-a.activeStartWorkers
	close(a.startWorkersChanged)
	a.startWorkersChanged = make(chan struct{})
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
