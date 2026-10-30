package background

import (
	"testing"
	"time"
)

func TestSectionReconcileIntervalClamp(t *testing.T) {
	for tickMs, want := range map[int]time.Duration{
		-5:   time.Second,
		0:    time.Second,
		1:    250 * time.Millisecond,
		249:  250 * time.Millisecond,
		250:  250 * time.Millisecond,
		1000: time.Second,
		2500: 2500 * time.Millisecond,
	} {
		if got := sectionReconcileInterval(tickMs); got != want {
			t.Fatalf("sectionReconcileInterval(%d) = %v, want %v", tickMs, got, want)
		}
	}
}

func TestSectionReconcileCycleWithoutProctorIsNoop(t *testing.T) {
	if err := (&Runner{}).runSectionReconcileCycle(t.Context()); err != nil {
		t.Fatal(err)
	}
}
