package satlearning

import "fmt"

// ValidationError names the rejected field so handlers can return a stable
// 422/400 without parsing prose.
type ValidationError struct {
	Field   string
	Message string
}

func (e *ValidationError) Error() string { return e.Message }

func invalid(field, message string) error {
	return &ValidationError{Field: field, Message: message}
}

// DefaultPolicy is the creation default and the legacy fallback: report and
// PDF keys hidden, Study disabled, N=1, both preferences on.
func DefaultPolicy() Policy {
	return Policy{
		Revision:              0,
		ReportVisible:         false,
		IncludeAnswerKeyInPdf: false,
		Study: StudyPermissions{
			Enabled:             false,
			RequiredCompletions: DefaultRequiredCompletions,
			RevealAnswers:       true,
			Untimed:             true,
		},
	}
}

func DefaultClassroomPolicy(reportVisible bool) Policy {
	policy := DefaultPolicy()
	policy.ReportVisible = reportVisible
	policy.UnlimitedRetakes = true
	return policy
}

// ValidatePolicy rejects non-canonical policy values. Stored rows pass through
// the same validation on read: a zero threshold or enabled-with-no-permission
// row fails closed instead of being silently repaired.
func ValidatePolicy(p Policy) error {
	if p.Revision < 0 {
		return invalid("revision", "The policy revision must be a nonnegative whole number.")
	}
	if p.Study.RequiredCompletions < 1 || p.Study.RequiredCompletions > MaxRequiredCompletions {
		return invalid("study.requiredCompletions",
			fmt.Sprintf("Unlock after a whole number of completed attempts between 1 and %d.", MaxRequiredCompletions))
	}
	if p.Study.Enabled && !p.Study.RevealAnswers && !p.Study.Untimed {
		return invalid("study", "Allow students to reveal answers, remove the time limit, or turn Study mode off.")
	}
	if p.IncludeAnswerKeyInPdf && !p.ReportVisible {
		return invalid("includeAnswerKeyInPdf", "Answer keys require a visible score report.")
	}
	return nil
}

// NormalizePolicy applies the write-time coercions that are safe and
// conservative. New Study admissions are retired and a hidden report forces
// PDF keys off. An admitted attempt retains its own capability snapshot.
func NormalizePolicy(p Policy) Policy {
	p.Study.Enabled = false
	if !p.ReportVisible {
		p.IncludeAnswerKeyInPdf = false
	}
	return p
}

// Eligible applies the inclusive completion threshold. Disabled Study is
// never eligible regardless of the measured count.
func Eligible(p Policy, completed int64) bool {
	if !p.Study.Enabled {
		return false
	}
	return completed >= p.Study.RequiredCompletions && completed >= 0
}

// StudyCapabilities returns the effective grants for a new Study attempt.
func StudyCapabilities(p Policy) Capabilities {
	if !p.Study.Enabled {
		return Capabilities{}
	}
	return Capabilities{
		RevealAnswers: p.Study.RevealAnswers,
		Untimed:       p.Study.Untimed,
	}
}

// ResolveEligibility projects measured eligibility. `eligible` answers the
// threshold question; `canStart` additionally reflects an active attempt and
// the normal start window. Capabilities are withheld below the threshold so a
// locked state can never advertise assistance.
func ResolveEligibility(p Policy, completed int64, activeAttempt, startsOpen bool) Eligibility {
	out := Eligibility{
		CompletedTestAttempts: completed,
		RequiredCompletions:   p.Study.RequiredCompletions,
	}
	reason := func(r EligibilityReason) *EligibilityReason { return &r }
	if !p.Study.Enabled {
		out.Reason = reason(ReasonDisabled)
		return out
	}
	if completed < p.Study.RequiredCompletions || completed < 0 {
		out.Reason = reason(ReasonCompletionRequired)
		return out
	}
	out.Eligible = true
	out.Capabilities = StudyCapabilities(p)
	if activeAttempt {
		out.Reason = reason(ReasonActiveAttempt)
		return out
	}
	if !startsOpen {
		out.Reason = reason(ReasonStartsClosed)
		return out
	}
	out.CanStart = true
	return out
}

// TestSnapshot binds an answer-free, timer-authoritative Test admission.
func TestSnapshot(revision int64) Snapshot {
	return Snapshot{Mode: ModeTest, PolicyRevision: revision}
}

// StudySnapshot binds the capabilities enabled at admission. A later policy
// edit cannot rewrite this value.
func StudySnapshot(p Policy) Snapshot {
	return Snapshot{
		Mode:           ModeStudy,
		PolicyRevision: p.Revision,
		Capabilities:   StudyCapabilities(p),
	}
}
