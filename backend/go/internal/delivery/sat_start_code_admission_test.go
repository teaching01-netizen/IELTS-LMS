package delivery

import (
	"context"
	"database/sql"
	"errors"
	"testing"
	"time"

	"example.com/ielts-proctoring/internal/platform/telemetry"
)

func TestSATStartAdmissionSharesPerScheduleWaiterLimit(t *testing.T) {
	a := newSATStartAdmission()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	deadline := time.Now().Add(4 * time.Second)
	const scheduleID = "schedule"
	ownerRelease, err := a.acquireInitializer(ctx, scheduleID, deadline, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer ownerRelease()

	initializerWaitMetric := telemetry.MSATStartCodeAdmissionWaitTotal
	initializerLabels := []string{"stage", "initializer", "outcome", "waiting"}
	initializerBefore := telemetry.CounterValueForTest(telemetry.DefaultRegistry, initializerWaitMetric, initializerLabels...)
	const initializerWaiters = startCodeAdmissionWaiterLimit - 1
	results := make(chan error, initializerWaiters)
	for range initializerWaiters {
		go func() {
			release, err := a.acquireInitializer(ctx, scheduleID, deadline, nil)
			if err == nil {
				release()
			}
			results <- err
		}()
	}
	waitForSATAdmissionCounter(t, initializerWaitMetric, initializerBefore+initializerWaiters, initializerLabels...)

	capacityMetric := telemetry.MSATStartCodeAdmissionWaitTotal
	capacityLabels := []string{"stage", "capacity", "outcome", "waiting"}
	capacityBefore := telemetry.CounterValueForTest(telemetry.DefaultRegistry, capacityMetric, capacityLabels...)
	capacityResult := make(chan error, 1)
	go func() {
		capacityResult <- a.waitForCapacity(ctx, scheduleID, deadline, nil)
	}()
	waitForSATAdmissionCounter(t, capacityMetric, capacityBefore+1, capacityLabels...)
	if err := a.waitForCapacity(ctx, scheduleID, deadline, nil); !errors.Is(err, errStartCodeAdmissionWaiterLimit) {
		t.Fatalf("waiter beyond combined per-schedule limit: got %v", err)
	}

	ownerRelease()
	for range initializerWaiters {
		if err := <-results; err != nil {
			t.Fatalf("initializer waiter failed after release: %v", err)
		}
	}
	if err := <-capacityResult; err != nil {
		t.Fatalf("capacity waiter failed after release: %v", err)
	}
	a.mu.Lock()
	state := a.schedules[scheduleID]
	a.mu.Unlock()
	if state != nil {
		t.Fatalf("idle schedule admission state was not released: %+v", state)
	}
}

func TestSATStartAdmissionRuntimeReadyWakesSharedWaiters(t *testing.T) {
	a := newSATStartAdmission()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	const scheduleID = "ready-schedule"
	ownerRelease, err := a.acquireInitializer(ctx, scheduleID, time.Now().Add(time.Second), nil)
	if err != nil {
		t.Fatal(err)
	}
	const waiterCount = 16
	metric := telemetry.MSATStartCodeAdmissionWaitTotal
	labels := []string{"stage", "initializer", "outcome", "waiting"}
	before := telemetry.CounterValueForTest(telemetry.DefaultRegistry, metric, labels...)
	type result struct {
		release func()
		err     error
		timing  *SATStartCodeAdmissionTiming
	}
	results := make(chan result, waiterCount)
	for range waiterCount {
		go func() {
			timing := &SATStartCodeAdmissionTiming{}
			release, err := a.acquireInitializer(ctx, scheduleID, time.Now().Add(time.Second), timing)
			results <- result{release: release, err: err, timing: timing}
		}()
	}
	waitForSATAdmissionCounter(t, metric, before+waiterCount, labels...)
	a.markRuntimeReady(scheduleID)
	for range waiterCount {
		got := <-results
		if got.err != nil {
			t.Fatalf("runtime-ready waiter returned %v", got.err)
		}
		if got.timing.RuntimeInitializerWait <= 0 {
			t.Errorf("initializer queue wait was not recorded: %s", got.timing.RuntimeInitializerWait)
		}
		if got.release != nil {
			got.release()
			t.Fatal("runtime-ready waiter unexpectedly became initializer")
		}
	}
	ownerRelease()
	a.mu.Lock()
	state := a.schedules[scheduleID]
	a.mu.Unlock()
	if state != nil {
		t.Fatalf("runtime-ready admission state was not released: %+v", state)
	}
}

func TestSATStartAdmissionCancellationAndDeadlineReleaseWaiters(t *testing.T) {
	a := newSATStartAdmission()
	const scheduleID = "schedule"
	ownerRelease, err := a.acquireInitializer(context.Background(), scheduleID, time.Now().Add(time.Second), nil)
	if err != nil {
		t.Fatal(err)
	}

	metric := telemetry.MSATStartCodeAdmissionWaitTotal
	labels := []string{"stage", "initializer", "outcome", "waiting"}
	before := telemetry.CounterValueForTest(telemetry.DefaultRegistry, metric, labels...)
	ctx, cancel := context.WithCancel(context.Background())
	canceled := make(chan error, 1)
	go func() {
		_, err := a.acquireInitializer(ctx, scheduleID, time.Now().Add(time.Second), nil)
		canceled <- err
	}()
	waitForSATAdmissionCounter(t, metric, before+1, labels...)
	cancel()
	if err := <-canceled; !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled wait returned %v", err)
	}
	a.mu.Lock()
	waitersAfterCancel := a.schedules[scheduleID].waiters
	a.mu.Unlock()
	if waitersAfterCancel != 0 {
		t.Fatalf("canceled waiter leaked admission slot: %d", waitersAfterCancel)
	}

	deadlineResult := make(chan error, 1)
	go func() {
		_, err := a.acquireInitializer(context.Background(), scheduleID, time.Now().Add(20*time.Millisecond), nil)
		deadlineResult <- err
	}()
	if err := <-deadlineResult; !errors.Is(err, errStartCodeAdmissionDeadline) {
		t.Fatalf("admission deadline returned %v", err)
	}
	a.mu.Lock()
	waitersAfterDeadline := a.schedules[scheduleID].waiters
	a.mu.Unlock()
	if waitersAfterDeadline != 0 {
		t.Fatalf("deadline waiter leaked admission slot: %d", waitersAfterDeadline)
	}
	ownerRelease()
}

func TestSATStartAdmissionCapacityCancellationAndDeadlineReleaseWaiters(t *testing.T) {
	a := newSATStartAdmission()
	const scheduleID = "capacity-schedule"
	metric := telemetry.MSATStartCodeAdmissionWaitTotal
	labels := []string{"stage", "capacity", "outcome", "waiting"}

	ctx, cancel := context.WithCancel(context.Background())
	canceled := make(chan error, 1)
	timing := &SATStartCodeAdmissionTiming{}
	before := telemetry.CounterValueForTest(telemetry.DefaultRegistry, metric, labels...)
	go func() {
		canceled <- a.waitForCapacity(ctx, scheduleID, time.Now().Add(time.Second), timing)
	}()
	waitForSATAdmissionCounter(t, metric, before+1, labels...)
	cancel()
	if err := <-canceled; !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled capacity wait returned %v", err)
	}
	if timing.SlotCapacityWait <= 0 {
		t.Fatalf("capacity queue wait was not recorded: %s", timing.SlotCapacityWait)
	}
	a.mu.Lock()
	state := a.schedules[scheduleID]
	a.mu.Unlock()
	if state != nil {
		t.Fatalf("canceled capacity wait leaked schedule state: %+v", state)
	}

	deadline := time.Now().Add(20 * time.Millisecond)
	var waitErr error
	for waitErr == nil {
		waitErr = a.waitForCapacity(context.Background(), scheduleID, deadline, nil)
	}
	if !errors.Is(waitErr, errStartCodeAdmissionDeadline) {
		t.Fatalf("capacity deadline returned %v", waitErr)
	}
	a.mu.Lock()
	state = a.schedules[scheduleID]
	a.mu.Unlock()
	if state != nil {
		t.Fatalf("timed-out capacity wait leaked schedule state: %+v", state)
	}
}
func TestSATStartAdmissionBoundsActiveWorkersAndWakesQueuedStart(t *testing.T) {
	a := newSATStartAdmissionWithLimit(1)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	const scheduleID = "worker-schedule"
	firstRelease, err := a.acquireStartWorker(ctx, scheduleID, time.Now().Add(time.Second), nil)
	if err != nil {
		t.Fatal(err)
	}

	metric := telemetry.MSATStartCodeAdmissionWaitTotal
	labels := []string{"stage", "start_worker", "outcome", "waiting"}
	before := telemetry.CounterValueForTest(telemetry.DefaultRegistry, metric, labels...)
	type result struct {
		release func()
		err     error
		timing  *SATStartCodeAdmissionTiming
	}
	resultCh := make(chan result, 1)
	timing := &SATStartCodeAdmissionTiming{}
	go func() {
		release, err := a.acquireStartWorker(ctx, scheduleID, time.Now().Add(time.Second), timing)
		resultCh <- result{release: release, err: err, timing: timing}
	}()
	waitForSATAdmissionCounter(t, metric, before+1, labels...)
	select {
	case got := <-resultCh:
		if got.release != nil {
			got.release()
		}
		t.Fatalf("queued start acquired a worker before one was released: %+v", got)
	default:
	}

	firstRelease()
	var secondRelease func()
	select {
	case got := <-resultCh:
		if got.err != nil {
			t.Fatalf("queued start returned %v after worker release", got.err)
		}
		secondRelease = got.release
	case <-ctx.Done():
		t.Fatal("queued start was not woken after worker release")
	}
	if timing.StartWorkerWait <= 0 {
		t.Fatalf("start-worker queue wait was not recorded: %s", timing.StartWorkerWait)
	}
	if secondRelease == nil {
		t.Fatal("queued start received no worker release function")
	}
	a.mu.Lock()
	active := len(a.activeStartWorkers)
	a.mu.Unlock()
	if active != 1 {
		t.Fatalf("active worker count=%d, want 1", active)
	}
	secondRelease()
	a.mu.Lock()
	active = len(a.activeStartWorkers)
	a.mu.Unlock()
	if active != 0 {
		t.Fatalf("active worker leaked after release: %d", active)
	}
}

func waitForSATAdmissionCounter(t *testing.T, metric string, atLeast float64, labels ...string) {
	t.Helper()
	timer := time.NewTimer(5 * time.Second)
	defer timer.Stop()
	ticker := time.NewTicker(time.Millisecond)
	defer ticker.Stop()
	for {
		if telemetry.CounterValueForTest(telemetry.DefaultRegistry, metric, labels...) >= atLeast {
			return
		}
		select {
		case <-ticker.C:
		case <-timer.C:
			t.Fatalf("timed out waiting for telemetry counter %s labels=%v value>=%v", metric, labels, atLeast)
		}
	}
}

func TestSATStartAdmissionRejectsExpiredDeadlineBeforeGrantOrQueue(t *testing.T) {
	a := newSATStartAdmission()
	ctx := context.Background()
	deadline := time.Now().Add(-time.Millisecond)

	if release, err := a.acquireStartWorker(ctx, "worker", deadline, nil); release != nil || !errors.Is(err, errStartCodeAdmissionDeadline) {
		t.Fatalf("expired worker admission returned release=%v err=%v", release != nil, err)
	}
	if release, err := a.acquireInitializer(ctx, "initializer", deadline, nil); release != nil || !errors.Is(err, errStartCodeAdmissionDeadline) {
		t.Fatalf("expired initializer admission returned release=%v err=%v", release != nil, err)
	}
	if err := a.waitForCapacity(ctx, "capacity", deadline, nil); !errors.Is(err, errStartCodeAdmissionDeadline) {
		t.Fatalf("expired capacity admission returned %v", err)
	}

	a.mu.Lock()
	defer a.mu.Unlock()
	if len(a.activeStartWorkers) != 0 || a.totalWaiters != 0 || len(a.schedules) != 0 {
		t.Fatalf("expired requests mutated admission state: workers=%d waiters=%d schedules=%d",
			len(a.activeStartWorkers), a.totalWaiters, len(a.schedules))
	}
}

func TestSATStartAndCloseLimitsShareFinitePool(t *testing.T) {
	for _, maxOpen := range []int{4, 10, 20, 40, 50, 100} {
		db := fakeSATDBStats{maxOpen: maxOpen}
		start := satStartActiveWorkerLimit(db)
		closeLimit := satCloseActiveLimit(maxOpen)
		if reserved := maxOpen - start - closeLimit; reserved < maxOpen/4 {
			t.Errorf("maxOpen=%d start=%d close=%d leaves %d connections, want >= %d", maxOpen, start, closeLimit, reserved, maxOpen/4)
		}
	}
}

type fakeSATDBStats struct{ maxOpen int }

func (f fakeSATDBStats) Stats() sql.DBStats { return sql.DBStats{MaxOpenConnections: f.maxOpen} }

func TestSATStartWorkerWaitersAreAdmittedFIFO(t *testing.T) {
	a := newSATStartAdmissionWithLimit(1)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	deadline := time.Now().Add(5 * time.Second)
	release, err := a.acquireStartWorker(ctx, "s", deadline, nil)
	if err != nil {
		t.Fatal(err)
	}
	const waiters = 5
	order := make(chan int, waiters)
	for i := 0; i < waiters; i++ {
		go func(i int) {
			r, err := a.acquireStartWorker(ctx, "s", deadline, nil)
			if err != nil {
				t.Errorf("waiter %d: %v", i, err)
				order <- -1
				return
			}
			order <- i
			r()
		}(i)
		// Wait until waiter i is queued before starting the next one.
		for {
			a.mu.Lock()
			queued := len(a.startWorkerWaiters)
			a.mu.Unlock()
			if queued == i+1 {
				break
			}
			time.Sleep(time.Millisecond)
		}
	}
	release()
	for want := 0; want < waiters; want++ {
		if got := <-order; got != want {
			t.Fatalf("admission order: got waiter %d, want %d", got, want)
		}
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if len(a.activeStartWorkers) != 0 || len(a.startWorkerWaiters) != 0 || a.totalWaiters != 0 || len(a.schedules) != 0 {
		t.Fatalf("leaked state: active=%d queued=%d waiters=%d schedules=%d",
			len(a.activeStartWorkers), len(a.startWorkerWaiters), a.totalWaiters, len(a.schedules))
	}
}

func TestSATStartWorkerTimedOutWaiterDoesNotLeakSlot(t *testing.T) {
	a := newSATStartAdmissionWithLimit(1)
	ctx := context.Background()
	release, err := a.acquireStartWorker(ctx, "s", time.Now().Add(time.Second), nil)
	if err != nil {
		t.Fatal(err)
	}
	if r, err := a.acquireStartWorker(ctx, "s", time.Now().Add(20*time.Millisecond), nil); r != nil || !errors.Is(err, errStartCodeAdmissionDeadline) {
		t.Fatalf("queued waiter returned release=%v err=%v", r != nil, err)
	}
	release()
	a.mu.Lock()
	defer a.mu.Unlock()
	if len(a.activeStartWorkers) != 0 || len(a.startWorkerWaiters) != 0 || a.totalWaiters != 0 {
		t.Fatalf("leaked state: active=%d queued=%d waiters=%d", len(a.activeStartWorkers), len(a.startWorkerWaiters), a.totalWaiters)
	}
}
