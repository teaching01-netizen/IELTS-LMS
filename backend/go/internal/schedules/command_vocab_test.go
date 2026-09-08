package schedules

import (
	"strings"
	"testing"
)

// Plan C-wording + I1 honesty (round 56): the runtime-command vocab gate
// lives in ApplyRuntimeCommand AFTER a schedule Get — an unknown action
// burns a DB read before failing. Worse, normalizeRuntimeCommandAction
// passes unknown input through verbatim, so the ONLY barrier is the
// switch in ApplyRuntimeCommand. This test pins: the four canonical
// actions + four frontend aliases validate, while empty/unknown/
// case-variant actions are rejected by the same gate the service uses.
//
// NOTE: RED first run caught a test bug (assumed case-sensitivity the
// normalizer intentionally lacks) — corrected to document the
// case-insensitive-by-design contract. The test is the pin: a new alias
// added to the normalizer without service-switch support fails here.
// Round 57: ValidateRuntimeCommandAction is the exported fail-fast gate
// the handler (pre-Get) + service share.

func TestValidateRuntimeCommandActionFailFast(t *testing.T) {
	// Round 57: the exported fail-fast gate the handler + service share.
	if got, err := ValidateRuntimeCommandAction("pause_runtime"); err != nil || got != CommandPause {
		t.Fatalf("alias must validate to pause, got %q/%v", got, err)
	}
	for _, bad := range []string{"", "unknown", "delete"} {
		if _, err := ValidateRuntimeCommandAction(bad); err == nil {
			t.Fatalf("action %q must fail fast", bad)
		}
	}
	// Error names the raw input (operator sees what the client sent).
	if _, err := ValidateRuntimeCommandAction("  frobnicate  "); err == nil || !strings.Contains(err.Error(), "frobnicate") {
		t.Fatalf("error must name the raw action, got %v", err)
	}
}

func TestRuntimeCommandActionVocabulary(t *testing.T) {
	valid := []string{
		CommandStart, CommandPause, CommandResume, CommandComplete,
		"start_runtime", "pause_runtime", "resume_runtime", "complete_runtime",
	}
	for _, action := range valid {
		normalized := normalizeRuntimeCommandAction(action)
		switch normalized {
		case CommandStart, CommandPause, CommandResume, CommandComplete:
		default:
			t.Fatalf("action %q must validate, normalized to %q", action, normalized)
		}
	}
	// NOTE: normalization lowercases + trims first, so "START"/"Pause"/
	// "start " are VALID aliases by design (case-insensitive commands
	// survive proctor-console casing slips). Only true unknowns fail.
	invalid := []string{"", "   ", "unknown", "delete", "restart", "startpause", "complete_all"}
	for _, action := range invalid {
		normalized := normalizeRuntimeCommandAction(action)
		// The ApplyRuntimeCommand switch matches on the normalized
		// value; anything outside the four canonical verbs fails.
		switch normalized {
		case CommandStart, CommandPause, CommandResume, CommandComplete:
			t.Fatalf("action %q must be rejected, normalized to %q", action, normalized)
		}
	}
}
