package liveupdates

// Plan E-exam-day: the slow-consumer slice (dropped frames) is the
// operator's backpressure proof. A full subscriber buffer drops (never
// blocks the publisher) and each drop counts on
// websocket_slow_client_disconnects_total. RED: Publish drops emit.
import (
	"testing"

	"example.com/ielts-proctoring/internal/platform/telemetry"
)

func TestPublishDropEmitsSlowDisconnect(t *testing.T) {
	reg := telemetry.NewRegistry()
	old := telemetry.DefaultRegistry
	telemetry.DefaultRegistry = reg
	defer func() { telemetry.DefaultRegistry = old }()

	h := NewHub()
	s1 := "sched-1"
	sub := h.Subscribe(RoleProctor, &s1, nil, []string{"sched-1"})
	defer h.Unsubscribe(sub)
	const extra = 5
	for i := 0; i < QueueCap+extra; i++ {
		h.Publish(Event{Kind: KindScheduleRuntime, ID: "sched-1", Revision: int64(i), Name: "x"})
	}
	if got := sub.Dropped(); got < extra {
		t.Fatalf("dropped = %d, want >= %d", got, extra)
	}
	if got := telemetry.CounterValueForTest(reg, telemetry.MWSSlowDisconnect); got < extra {
		t.Fatalf("slow-disconnect counter = %v, want >= %d", got, extra)
	}
}
