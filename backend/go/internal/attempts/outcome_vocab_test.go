package attempts

// Plan 69: the v2 outcome vocabulary is the operator's failure-mode
// slice. Every fencing/validation code must map to its own label (never
// collapse into generic rejected), and unknown errors stay rejected.
// Pure function — no DB, no registry. RED: full code table.
import (
	"errors"
	"testing"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/telemetry"
)

func TestV2BatchOutcomeVocabulary(t *testing.T) {
	cases := []struct {
		code apperrors.Code
		want string
	}{
		{apperrors.CodeLeaseFenced, telemetry.OutcomeLeaseFenced},
		{apperrors.CodeControlEpochStale, telemetry.OutcomeControlStale},
		{apperrors.CodeVersionCollision, telemetry.OutcomeVersionConflict},
		{apperrors.CodeResponseRevisionMismatch, telemetry.OutcomeVersionConflict},
		{apperrors.CodeWriteIDConflict, telemetry.OutcomeWriteConflict},
		{apperrors.CodeAttemptNotWritable, telemetry.OutcomeNotWritable},
		{apperrors.CodeDeadlineExpired, telemetry.OutcomeNotWritable},
		{apperrors.CodeAttemptProctorBlocked, telemetry.OutcomeNotWritable},
	}
	for _, c := range cases {
		err := &apperrors.Error{Code: c.code, Message: "x", HTTPStatus: 409}
		if got := v2BatchOutcome(err); got != c.want {
			t.Fatalf("code %s: got %q want %q", c.code, got, c.want)
		}
	}
	if got := v2BatchOutcome(errors.New("boom")); got != telemetry.OutcomeRejected {
		t.Fatalf("unknown error must be rejected, got %q", got)
	}
	if got := v2BatchOutcome(&apperrors.Error{Code: apperrors.CodeBadRequest, Message: "x", HTTPStatus: 400}); got != telemetry.OutcomeRejected {
		t.Fatalf("unmapped code must be rejected, got %q", got)
	}
}
