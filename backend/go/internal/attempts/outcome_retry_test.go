package attempts

// Plan E3: a batch that deadlocks once then commits must NOT look like a
// clean first-try accept on v2_response_batch_total. Operators need the
// retried_accepted slice to see wave pressure the retry loop absorbed.
// RED: retried success must emit OutcomeRetriedAccepted, not OutcomeAccepted.
import (
	"testing"

	"example.com/ielts-proctoring/internal/platform/telemetry"
)

func TestRetriedOutcomeLabel(t *testing.T) {
	if telemetry.OutcomeRetriedAccepted == "" {
		t.Fatalf("retried-accepted outcome label must be defined")
	}
	if telemetry.OutcomeRetriedAccepted == telemetry.OutcomeAccepted {
		t.Fatalf("retried-accepted must differ from accepted (got %q)", telemetry.OutcomeRetriedAccepted)
	}
	if got := successOutcome(false, 1); got != telemetry.OutcomeRetriedAccepted {
		t.Fatalf("1 retry then accept must label retried_accepted, got %q", got)
	}
	if got := successOutcome(false, 0); got != telemetry.OutcomeAccepted {
		t.Fatalf("0 retries then accept must stay accepted, got %q", got)
	}
	if got := successOutcome(true, 2); got != telemetry.OutcomeExactReplay {
		t.Fatalf("replay stays exact_replay regardless of retries, got %q", got)
	}
}

