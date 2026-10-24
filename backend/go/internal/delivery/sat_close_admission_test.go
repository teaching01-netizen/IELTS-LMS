package delivery

import (
	"context"
	"errors"
	"testing"
	"time"

	"example.com/ielts-proctoring/internal/platform/tx"
	"github.com/DATA-DOG/go-sqlmock"
)

func TestSATCloseActiveLimitReservesHalfOfFinitePool(t *testing.T) {
	for _, tc := range []struct {
		maxOpen int
		want    int
	}{
		{maxOpen: 0, want: satCloseDefaultActiveLimit},
		{maxOpen: 1, want: 1},
		{maxOpen: 2, want: 1},
		{maxOpen: 100, want: 50},
		{maxOpen: 120, want: 60},
	} {
		if got := satCloseActiveLimit(tc.maxOpen); got != tc.want {
			t.Errorf("satCloseActiveLimit(%d) = %d, want %d", tc.maxOpen, got, tc.want)
		}
	}
}

func TestSATCloseAdmissionQueuesFIFOAndReleaseIsIdempotent(t *testing.T) {
	gate := newSATCloseAdmission(1)
	firstRelease, err := gate.acquire(context.Background())
	if err != nil {
		t.Fatalf("first close must acquire the idle slot: %v", err)
	}
	type result struct {
		release func()
		err     error
	}
	results := make(chan result, 2)
	started := make(chan struct{}, 2)
	for i := 0; i < 2; i++ {
		go func() {
			started <- struct{}{}
			release, err := gate.acquire(context.Background())
			results <- result{release: release, err: err}
		}()
		<-started
		waitForSATCloseWaiters(t, gate, i+1)
	}
	firstRelease()
	first := <-results
	if first.err != nil || first.release == nil {
		t.Fatalf("FIFO head was not admitted after release: %+v", first)
	}
	waitForSATCloseWaiters(t, gate, 1)
	select {
	case unexpected := <-results:
		t.Fatalf("second waiter passed the FIFO head: %+v", unexpected)
	default:
	}
	first.release()
	first.release()
	second := <-results
	if second.err != nil || second.release == nil {
		t.Fatalf("second waiter was not admitted after FIFO head released: %+v", second)
	}
	second.release()
	if release, err := gate.acquire(context.Background()); err != nil {
		t.Fatalf("released capacity must be reusable: %v", err)
	} else {
		release()
	}
}

func TestSATCloseAdmissionRemovesCancelledWaiterAndBoundsQueue(t *testing.T) {
	gate := newSATCloseAdmission(1)
	firstRelease, err := gate.acquire(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	result := make(chan error, 1)
	go func() {
		_, err := gate.acquire(ctx)
		result <- err
	}()
	waitForSATCloseWaiters(t, gate, 1)
	cancel()
	if err := <-result; !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled waiter error = %v, want context.Canceled", err)
	}
	waitForSATCloseWaiters(t, gate, 0)
	firstRelease()

	firstRelease, err = gate.acquire(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	deadlineCtx, deadlineCancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	if _, err := gate.acquire(deadlineCtx); !errors.Is(err, context.DeadlineExceeded) {
		deadlineCancel()
		t.Fatalf("deadline waiter error = %v, want context.DeadlineExceeded", err)
	}
	deadlineCancel()
	waitForSATCloseWaiters(t, gate, 0)
	firstRelease()

	firstRelease, err = gate.acquire(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer firstRelease()
	waiting := make([]context.CancelFunc, gate.maxQueued)
	for i := range waiting {
		ctx, cancel := context.WithCancel(context.Background())
		waiting[i] = cancel
		go func() {
			_, _ = gate.acquire(ctx)
		}()
		waitForSATCloseWaiters(t, gate, i+1)
	}
	if _, err := gate.acquire(context.Background()); !errors.Is(err, ErrSATCloseAdmissionFull) {
		t.Fatalf("request beyond queue capacity error = %v, want ErrSATCloseAdmissionFull", err)
	}
	for _, cancel := range waiting {
		cancel()
	}
	waitForSATCloseWaiters(t, gate, 0)
}

func waitForSATCloseWaiters(t *testing.T, gate *satCloseAdmission, want int) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		gate.mu.Lock()
		got := len(gate.waiters)
		gate.mu.Unlock()
		if got == want {
			return
		}
		time.Sleep(time.Millisecond)
	}
	gate.mu.Lock()
	got := len(gate.waiters)
	gate.mu.Unlock()
	t.Fatalf("close waiters = %d, want %d", got, want)
}

func TestSATCloseAdmissionContextReusesTheAPIReservation(t *testing.T) {
	db, _, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	service := NewService(db, tx.NewRunner(db))
	service.satCloseAdmission = newSATCloseAdmission(1)

	ctx, release, err := service.AcquireSATCloseAdmission(context.Background())
	if err != nil {
		t.Fatalf("acquire close slot: %v", err)
	}
	defer release()
	if !hasSATCloseAdmission(ctx) {
		t.Fatal("acquired context must carry the close reservation")
	}

	_, err = service.CloseModule(ctx, "schedule", "attempt", "schedule", ModuleCloseRequest{
		ModuleID: "module", ModuleAttemptID: "module-attempt", CloseID: "close-operation",
	})
	if errors.Is(err, ErrSATCloseAdmissionFull) {
		t.Fatal("service attempted to acquire the already-reserved close slot twice")
	}
}

func TestCloseModuleReturnsBackpressureBeforeDatabaseWork(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	service := NewService(db, tx.NewRunner(db))
	service.satCloseAdmission = newSATCloseAdmission(1)
	service.satCloseAdmission.maxQueued = 0
	release, err := service.satCloseAdmission.acquire(context.Background())
	if err != nil {
		t.Fatal("test must occupy close capacity")
	}
	defer release()

	_, err = service.CloseModule(context.Background(), "schedule", "attempt", "schedule", ModuleCloseRequest{
		ModuleID: "module", ModuleAttemptID: "module-attempt", CloseID: "close-operation",
	})
	if !errors.Is(err, ErrSATCloseAdmissionFull) {
		t.Fatalf("full gate error = %v, want ErrSATCloseAdmissionFull", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("rejected close performed database work: %v", err)
	}
}
