package liveupdates

import (
	"testing"
)

// TestSubscribeAuthoringIsExamScoped pins the fan-out rule: only subscribers
// bound to the event's exam are candidates, and the injected matcher decides
// the rest.
func TestSubscribeAuthoringIsExamScoped(t *testing.T) {
	hub := NewHub()
	defer func() {
		for _, s := range []*Subscription{} {
			hub.Unsubscribe(s)
		}
	}()
	matching := hub.SubscribeAuthoring("exam-1", func(e Event) bool { return e.ID == "exam-1" })
	other := hub.SubscribeAuthoring("exam-2", func(e Event) bool { return e.ID == "exam-2" })
	defer hub.Unsubscribe(matching)
	defer hub.Unsubscribe(other)

	hub.Publish(Event{SequenceID: 1, Kind: KindAuthoring, ID: "exam-1"})

	select {
	case got := <-matching.Channel():
		if got.SequenceID != 1 {
			t.Fatalf("wrong event: %+v", got)
		}
	default:
		t.Fatal("the matching subscriber must receive the event")
	}

	select {
	case got := <-other.Channel():
		t.Fatalf("another exam must never receive it: %+v", got)
	default:
	}
}

// TestAuthoringSubscribersDoNotReceiveRuntimeFrames pins topic isolation.
func TestAuthoringSubscribersDoNotReceiveRuntimeFrames(t *testing.T) {
	hub := NewHub()
	sub := hub.SubscribeAuthoring("exam-1", func(Event) bool { return true })
	defer hub.Unsubscribe(sub)

	hub.Publish(Event{SequenceID: 2, Kind: KindScheduleRuntime, ID: "sched-1"})
	hub.Publish(Event{SequenceID: 3, Kind: KindAttempt, ID: "attempt-1"})

	select {
	case got := <-sub.Channel():
		t.Fatalf("runtime frames must never reach an authoring socket: %+v", got)
	default:
	}
}

// TestRuntimeSubscribersDoNotReceiveAuthoringFrames pins the reverse direction.
func TestRuntimeSubscribersDoNotReceiveAuthoringFrames(t *testing.T) {
	hub := NewHub()
	admin := hub.Subscribe(RoleAdmin, nil, nil, nil)
	defer hub.Unsubscribe(admin)

	hub.Publish(Event{SequenceID: 4, Kind: KindAuthoring, ID: "exam-1"})

	select {
	case got := <-admin.Channel():
		t.Fatalf("a runtime subscriber must not receive authoring frames: %+v", got)
	default:
	}
}

// TestAuthoringMatcherIsFailClosed pins that a nil matcher never broadcasts.
func TestAuthoringMatcherIsFailClosed(t *testing.T) {
	hub := NewHub()
	sub := hub.SubscribeAuthoring("exam-1", nil)
	defer hub.Unsubscribe(sub)

	hub.Publish(Event{SequenceID: 5, Kind: KindAuthoring, ID: "exam-1"})

	select {
	case got := <-sub.Channel():
		t.Fatalf("a nil matcher must fail closed: %+v", got)
	default:
	}
}

// TestEmptyExamSubscriptionNeverMatches pins the wiring-mistake guard.
func TestEmptyExamSubscriptionNeverMatches(t *testing.T) {
	hub := NewHub()
	sub := hub.SubscribeAuthoring("", func(Event) bool { return true })
	defer hub.Unsubscribe(sub)

	hub.Publish(Event{SequenceID: 6, Kind: KindAuthoring, ID: ""})
	select {
	case got := <-sub.Channel():
		t.Fatalf("an unscoped subscription must never match: %+v", got)
	default:
	}
}

// TestAuthoringUnsubscribeClearsIndex pins that the exam index does not leak.
func TestAuthoringUnsubscribeClearsIndex(t *testing.T) {
	hub := NewHub()
	sub := hub.SubscribeAuthoring("exam-1", func(Event) bool { return true })
	hub.Unsubscribe(sub)

	hub.mu.RLock()
	n := len(hub.byExam)
	hub.mu.RUnlock()
	if n != 0 {
		t.Fatalf("the exam index must be empty after unsubscribe, got %d buckets", n)
	}
}

// TestAuthoringSlowSubscriberDropsWithoutStalling pins the non-blocking rule:
// a full buffer drops and counts, and the publisher is never blocked.
func TestAuthoringSlowSubscriberDropsWithoutStalling(t *testing.T) {
	hub := NewHub()
	sub := hub.SubscribeAuthoring("exam-1", func(Event) bool { return true })
	defer hub.Unsubscribe(sub)

	for i := 0; i < QueueCap+16; i++ {
		hub.Publish(Event{SequenceID: int64(i + 1), Kind: KindAuthoring, ID: "exam-1"})
	}
	if sub.Dropped() == 0 {
		t.Fatal("overflow must be counted")
	}
}
