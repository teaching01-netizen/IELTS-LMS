package satlearning

// QualifiedTestAttempt is the single completion-count predicate. It mirrors
// the canonical lifecycle facts:
//
//   - a valid submission exists (`submitted_at` set by the normal completion
//     path);
//   - termination wins over a submitted timestamp, whether recorded on the
//     attempt compatibility field or the current-generation terminal receipt;
//   - a terminal receipt for another generation cannot speak for this attempt;
//   - Study work is assisted and never counts toward the Test threshold.
//
// Phase text is deliberately ignored: successful ordinary completions finish
// in `post-exam`, so testing `phase != 'post-exam'` would exclude exactly the
// attempts this feature must count.
func QualifiedTestAttempt(f CompletionFacts) bool {
	if f.Mode != ModeTest {
		return false
	}
	if !f.Submitted {
		return false
	}
	if !f.TerminalGenerationCurrent {
		return false
	}
	if f.TerminalOutcome == "terminated" {
		return false
	}
	if f.ProctorStatus == "terminated" {
		return false
	}
	return true
}
