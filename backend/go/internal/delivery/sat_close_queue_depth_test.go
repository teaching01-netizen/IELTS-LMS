package delivery

// Plan 2026-11-04 §4 Track B (visible queue): the close bulkhead exposes
// its current waiter count for the additive 429 queueDepth detail. The
// accessor is a sample, never an admission decision: nil service or gate
// reads 0 (unknown), which the envelope omits.
import "testing"

func TestSATCloseQueueDepthNilSafe(t *testing.T) {
	var nilService *Service
	if got := nilService.SATCloseQueueDepth(); got != 0 {
		t.Fatalf("nil service depth must be 0, got %d", got)
	}
	if got := (&Service{}).SATCloseQueueDepth(); got != 0 {
		t.Fatalf("gateless service depth must be 0, got %d", got)
	}
}

func TestSATCloseQueueDepthIdleGate(t *testing.T) {
	s := &Service{satCloseAdmission: newSATCloseAdmission(1)}
	if got := s.SATCloseQueueDepth(); got != 0 {
		t.Fatalf("idle gate depth must be 0, got %d", got)
	}
}
