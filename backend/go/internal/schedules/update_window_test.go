package schedules

// Plan E-honesty + round-62 fail-fast series: ValidateUpdateWindow is
// the schedule-update pre-tx gate — an explicitly inverted start/end
// pair 400s before the FOR UPDATE row lock. Both-nil (keep existing)
// and single-sided patches always pass here; the merged-window check
// inside the tx stays authoritative for those (it sees the stored row).
// RED: table on the exported gate.
import (
	"testing"
	"time"
)

func TestValidateUpdateWindowEnvelope(t *testing.T) {
	start := time.Now().UTC().Add(time.Hour)
	end := start.Add(3 * time.Hour)
	if err := ValidateUpdateWindow(nil, nil); err != nil {
		t.Fatalf("both-nil must pass, got %v", err)
	}
	if err := ValidateUpdateWindow(&start, nil); err != nil {
		t.Fatalf("start-only must pass, got %v", err)
	}
	if err := ValidateUpdateWindow(nil, &end); err != nil {
		t.Fatalf("end-only must pass, got %v", err)
	}
	if err := ValidateUpdateWindow(&start, &end); err != nil {
		t.Fatalf("ordered pair must pass, got %v", err)
	}
	inv := start.Add(-time.Hour)
	if err := ValidateUpdateWindow(&start, &inv); err == nil {
		t.Fatalf("inverted pair must fail")
	}
	if err := ValidateUpdateWindow(&start, &start); err == nil {
		t.Fatalf("equal pair must fail")
	}
}
