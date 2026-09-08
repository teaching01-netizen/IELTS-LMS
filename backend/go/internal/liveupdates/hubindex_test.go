package liveupdates

import (
	"testing"
)

// C1 RED: publish fans out O(subs-of-schedule): a runtime frame for sched-1
// reaches only sched-1 subscribers (isolation), measured by receipt.
func TestHubScheduleFanoutIsolation(t *testing.T) {
	h := NewHub()
	s1 := "sched-1"
	s2 := "sched-2"
	sub1 := h.Subscribe(RoleProctor, &s1, nil, []string{"sched-1"})
	sub2 := h.Subscribe(RoleProctor, &s2, nil, []string{"sched-2"})
	h.Publish(Event{Kind: KindScheduleRuntime, ID: "sched-1", Revision: 3, Name: "runtime_changed"})
	select {
	case <-sub1.Channel():
	default:
		t.Fatalf("sched-1 sub must receive its frame")
	}
	select {
	case e := <-sub2.Channel():
		t.Fatalf("sched-2 sub must not receive sched-1 frame, got %+v", e)
	default:
	}
	h.Unsubscribe(sub1)
	h.Unsubscribe(sub2)
}

// C1: concurrent Subscribe/Publish/Unsubscribe never races (run with -race).
func TestHubConcurrentPublishSubscribe(t *testing.T) {
	h := NewHub()
	done := make(chan struct{})
	go func() {
		defer close(done)
		for i := 0; i < 200; i++ {
			h.Publish(Event{Kind: KindScheduleRuntime, ID: "sched-1", Revision: int64(i)})
		}
	}()
	for i := 0; i < 20; i++ {
		s := "sched-1"
		sub := h.Subscribe(RoleProctor, &s, nil, []string{"sched-1"})
		for len(sub.Channel()) > 0 {
			<-sub.Channel()
		}
		h.Unsubscribe(sub)
	}
	<-done
}

// C1 RED: drop counter increments when a subscriber buffer is full
// (non-blocking publish never stalls the publisher).
func TestHubDropCountsOnFullBuffer(t *testing.T) {
	h := NewHub()
	s1 := "sched-1"
	sub := h.Subscribe(RoleProctor, &s1, nil, []string{"sched-1"})
	for i := 0; i < QueueCap+5; i++ {
		h.Publish(Event{Kind: KindScheduleRuntime, ID: "sched-1", Revision: int64(i), Name: "x"})
	}
	if got := sub.Dropped(); got < 5 {
		t.Fatalf("dropped = %d, want >= 5", got)
	}
	h.Unsubscribe(sub)
}
