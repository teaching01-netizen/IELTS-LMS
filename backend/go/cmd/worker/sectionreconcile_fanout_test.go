package main

// The section-reconcile outbox family hands a finished cohort section's open
// module attempts to delivery, one attempt at a time. These cases pin the
// contract the worker's comment promises: attempts are independent (one
// transient failure must not stop the rest of the cohort from closing), and
// the event only retries with backoff when nothing at all progressed.
//
// No database is involved: executeSectionAttemptReconcileEvent talks to the
// delivery surface alone, so the fake below is the whole arrangement.

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"example.com/ielts-proctoring/internal/outbox"
)

// captureDelivery records the attempts it was asked to reconcile and fails the
// named ones, so a test can assert per-attempt continuation.
type captureDelivery struct {
	reconciled   []string
	fail         map[string]error
	timeoutCalls int
	timeoutAt    time.Time
	timeoutBatch int64
}

func (c *captureDelivery) ReconcileTimeouts(_ context.Context, at time.Time, batch int64) (int64, error) {
	c.timeoutCalls++
	c.timeoutAt = at
	c.timeoutBatch = batch
	return 0, nil
}

func (c *captureDelivery) ReconcilePersonalTimeouts(_ context.Context, _ time.Time, _ int64) (int64, error) {
	return 0, nil
}

func (c *captureDelivery) ReconcileAttemptTimeout(_ context.Context, _, attemptID string, _ time.Time) (bool, error) {
	c.reconciled = append(c.reconciled, attemptID)
	if err, ok := c.fail[attemptID]; ok {
		return false, err
	}
	return true, nil
}

func sectionReconcileEvent(t *testing.T, payload any) outbox.Event {
	t.Helper()
	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	return outbox.Event{
		ID: "ev-section-1", AggregateKind: "schedule", AggregateID: "sched-1",
		Revision: 8, Family: outbox.FamilySectionAttemptsReconcile,
		Payload: raw, CreatedAt: time.Now().UTC(), PublishAttempts: 1,
	}
}

func sectionReconcileWorker(delivery *captureDelivery) *worker {
	return &worker{workerID: "test-worker", delivery: delivery}
}

// One transient failure must not stop the cohort from closing: the remaining
// attempts still reconcile and the event acks.
func TestSectionReconcileContinuesPastFailingAttempt(t *testing.T) {
	delivery := &captureDelivery{fail: map[string]error{"att-2": errors.New("lock timeout")}}
	w := sectionReconcileWorker(delivery)
	event := sectionReconcileEvent(t, map[string]any{
		"scheduleId": "sched-1", "sectionKey": "reading-writing",
		"attemptIds": []string{"att-1", "att-2", "att-3"}, "reason": "section_ended",
	})

	if err := w.executeOutboxEvent(context.Background(), event); err != nil {
		t.Fatalf("a batch that progressed must ack, got %v", err)
	}
	want := []string{"att-1", "att-2", "att-3"}
	if len(delivery.reconciled) != len(want) {
		t.Fatalf("every attempt must be reconciled, got %v", delivery.reconciled)
	}
	for i, id := range want {
		if delivery.reconciled[i] != id {
			t.Fatalf("attempt order must follow the payload: want %v, got %v", want, delivery.reconciled)
		}
	}
}

// Nothing progressed and something failed transiently: the event must retry.
func TestSectionReconcileRetriesWhenNothingProgressed(t *testing.T) {
	delivery := &captureDelivery{fail: map[string]error{
		"att-1": errors.New("first failure"),
		"att-2": errors.New("second failure"),
	}}
	w := sectionReconcileWorker(delivery)
	event := sectionReconcileEvent(t, map[string]any{
		"scheduleId": "sched-1", "sectionKey": "math", "attemptIds": []string{"att-1", "att-2"},
	})

	err := w.executeOutboxEvent(context.Background(), event)
	if err == nil {
		t.Fatal("a batch where nothing progressed must surface an error so the event retries")
	}
	if !strings.Contains(err.Error(), "first failure") {
		t.Fatalf("the surfaced error must carry the first failure, got %v", err)
	}
	if len(delivery.reconciled) != 2 {
		t.Fatalf("both attempts must be tried before giving up, got %v", delivery.reconciled)
	}
}

// A clean batch acks without an error.
func TestSectionReconcileAcksOnFullSuccess(t *testing.T) {
	delivery := &captureDelivery{}
	w := sectionReconcileWorker(delivery)
	event := sectionReconcileEvent(t, map[string]any{
		"scheduleId": "sched-1", "sectionKey": "math", "attemptIds": []string{"att-1"},
	})

	if err := w.executeOutboxEvent(context.Background(), event); err != nil {
		t.Fatalf("a fully reconciled batch must ack, got %v", err)
	}
}

func TestTimeoutReconcileCycleUsesTheProvidedServerInstant(t *testing.T) {
	delivery := &captureDelivery{}
	w := sectionReconcileWorker(delivery)
	at := time.Date(2026, 9, 23, 10, 30, 0, 0, time.UTC)
	w.runTimeoutReconcileCycle(context.Background(), at)
	if delivery.timeoutCalls != 1 || !delivery.timeoutAt.Equal(at) || delivery.timeoutBatch <= 0 {
		t.Fatalf("timeout sweep must run once with the supplied instant and a bounded batch: %+v", delivery)
	}
}

func TestSATTimeoutOnlyWorkerModeFlag(t *testing.T) {
	if !satTimeoutsOnlyRequested([]string{"--sat-timeouts-only"}) {
		t.Fatal("activity-driven timeout worker flag was not recognized")
	}
	if satTimeoutsOnlyRequested([]string{"requeue-dead-letter", "--id", "dead-letter"}) {
		t.Fatal("operator requeue command must not select timeout-only mode")
	}
}

// A payload written before the schedule id was duplicated onto the payload
// falls back to the aggregate id; with neither, the event is unusable.
func TestSectionReconcileScheduleIDFallbackAndMissing(t *testing.T) {
	delivery := &captureDelivery{}
	w := sectionReconcileWorker(delivery)
	event := sectionReconcileEvent(t, map[string]any{"attemptIds": []string{"att-1"}})
	event.AggregateID = "sched-from-aggregate"

	if err := w.executeOutboxEvent(context.Background(), event); err != nil {
		t.Fatalf("the aggregate id must stand in for a missing schedule id, got %v", err)
	}

	event.AggregateID = ""
	err := w.executeOutboxEvent(context.Background(), event)
	if err == nil {
		t.Fatal("an event with no schedule id at all must fail rather than silently ack")
	}
	if len(delivery.reconciled) != 1 {
		t.Fatalf("the unusable event must not touch delivery, got %v", delivery.reconciled)
	}
}

// An empty fan-out list is a no-op: the section had no open module attempts.
func TestSectionReconcileEmptyFanOutIsNoOp(t *testing.T) {
	delivery := &captureDelivery{}
	w := sectionReconcileWorker(delivery)
	event := sectionReconcileEvent(t, map[string]any{"scheduleId": "sched-1", "attemptIds": []string{}})

	if err := w.executeOutboxEvent(context.Background(), event); err != nil {
		t.Fatalf("an empty fan-out must ack, got %v", err)
	}
	if len(delivery.reconciled) != 0 {
		t.Fatalf("an empty fan-out must not call delivery, got %v", delivery.reconciled)
	}
}

// Without a delivery surface the family is a benign no-op (tests and the
// maintenance-only worker topology never wire one).
func TestSectionReconcileWithoutDeliveryIsNoOp(t *testing.T) {
	w := &worker{workerID: "test-worker"}
	event := sectionReconcileEvent(t, map[string]any{"scheduleId": "sched-1", "attemptIds": []string{"att-1"}})

	if err := w.executeOutboxEvent(context.Background(), event); err != nil {
		t.Fatalf("a worker without delivery must ack the family, got %v", err)
	}
}

// A malformed payload must fail loudly instead of acking and dropping the
// cohort's module finalization.
func TestSectionReconcileRejectsMalformedPayload(t *testing.T) {
	w := sectionReconcileWorker(&captureDelivery{})
	event := sectionReconcileEvent(t, map[string]any{"scheduleId": "sched-1"})
	event.Payload = []byte("{not json")

	if err := w.executeOutboxEvent(context.Background(), event); err == nil {
		t.Fatal("a malformed payload must fail")
	}
}
