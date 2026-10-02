package liveupdates

import (
	"sync"
	"testing"
)

func TestSharedHubCountsConcurrentPublisherDrops(t *testing.T) {
	hub := NewHub()
	sub := hub.Subscribe(RoleAdmin, nil, nil, nil)
	defer hub.Unsubscribe(sub)
	const publishers, events = 8, 256
	var wg sync.WaitGroup
	for range publishers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for range events {
				hub.Publish(Event{Kind: KindScheduleRuntime, ID: "schedule"})
				_ = sub.Dropped()
			}
		}()
	}
	wg.Wait()
	if got, want := sub.Dropped(), int64(publishers*events-QueueCap); got != want {
		t.Fatalf("drops = %d, want %d", got, want)
	}
}
