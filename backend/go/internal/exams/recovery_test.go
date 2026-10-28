package exams

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"
)

func validRecoveryControl() RecoveryControl {
	return RecoveryControl{
		Version:            RecoveryControlVersion,
		ID:                 "control-1",
		Phase:              RecoveryPhaseWorking,
		ActiveGrantID:      "grant-1",
		OriginalSessionID:  "session-original",
		Target:             RecoveryTarget{SectionKey: LinkSectionReadingWriting, ModuleAttemptID: "module-attempt-1", ModuleID: "module-1"},
		FocusRunGeneration: 1,
		Suspended: []SuspendedRecoveryStage{{
			Target:           RecoveryTarget{SectionKey: LinkSectionMath, ModuleAttemptID: "module-attempt-2", ModuleID: "module-2"},
			State:            "active",
			RemainingSeconds: 840,
		}},
	}
}

func TestRecoveryControlJSONRoundTrip(t *testing.T) {
	control := validRecoveryControl()
	raw, err := json.Marshal(control)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	parsed, err := ParseRecoveryControl(raw)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if parsed == nil {
		t.Fatal("parse returned no control")
	}
	if parsed.ID != control.ID || parsed.Phase != control.Phase || !parsed.Target.Equal(control.Target) {
		t.Fatalf("round trip lost identity: %+v", parsed)
	}
	if len(parsed.Suspended) != 1 || parsed.Suspended[0].RemainingSeconds != 840 {
		t.Fatalf("round trip lost suspension: %+v", parsed.Suspended)
	}
}

func TestParseRecoveryControlEmptyIsAbsent(t *testing.T) {
	for _, raw := range [][]byte{nil, []byte(""), []byte("   \n\t")} {
		control, err := ParseRecoveryControl(raw)
		if err != nil {
			t.Fatalf("empty control must not be an error: %v", err)
		}
		if control != nil {
			t.Fatalf("empty control parsed as %+v", control)
		}
	}
}

func TestParseRecoveryControlFailsClosed(t *testing.T) {
	base := validRecoveryControl()

	tests := []struct {
		name   string
		mutate func(*RecoveryControl)
		raw    string
	}{
		{name: "unsupported version", mutate: func(c *RecoveryControl) { c.Version = "staff_recovery_v2" }},
		{name: "missing id", mutate: func(c *RecoveryControl) { c.ID = "  " }},
		{name: "unknown phase", mutate: func(c *RecoveryControl) { c.Phase = "paused" }},
		{name: "missing target section", mutate: func(c *RecoveryControl) { c.Target.SectionKey = "" }},
		{name: "module attempt without module", mutate: func(c *RecoveryControl) { c.Target.ModuleID = "" }},
		{name: "module without module attempt", mutate: func(c *RecoveryControl) { c.Target.ModuleAttemptID = "" }},
		{name: "negative suspension", mutate: func(c *RecoveryControl) { c.Suspended[0].RemainingSeconds = -1 }},
		{name: "suspension beyond a week", mutate: func(c *RecoveryControl) { c.Suspended[0].RemainingSeconds = 7*24*60*60 + 1 }},
		{name: "missing suspension state", mutate: func(c *RecoveryControl) { c.Suspended[0].State = "" }},
		{name: "duplicate suspension", mutate: func(c *RecoveryControl) {
			c.Suspended = append(c.Suspended, c.Suspended[0])
		}},
		{name: "malformed JSON", raw: `{"version":"staff_recovery_v1",`},
		{name: "wrong JSON type", raw: `{"version":1}`},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			raw := []byte(tc.raw)
			if tc.raw == "" {
				control := base
				tc.mutate(&control)
				var err error
				raw, err = json.Marshal(control)
				if err != nil {
					t.Fatalf("marshal: %v", err)
				}
			}
			control, err := ParseRecoveryControl(raw)
			if err == nil {
				t.Fatalf("parse accepted an untrustworthy control: %+v", control)
			}
			if !errors.Is(err, ErrRecoveryControlMalformed) {
				t.Fatalf("error = %v, want ErrRecoveryControlMalformed", err)
			}
		})
	}
}

func TestParseRecoveryControlToleratesUnknownFields(t *testing.T) {
	raw := []byte(`{
		"version":"staff_recovery_v1",
		"id":"control-1",
		"phase":"held",
		"activeGrantId":"grant-1",
		"originalSessionId":"session-1",
		"target":{"sectionKey":"math"},
		"focusRunGeneration":0,
		"futureField":{"ignored":true}
	}`)
	control, err := ParseRecoveryControl(raw)
	if err != nil {
		t.Fatalf("unknown fields must not break a known version: %v", err)
	}
	if control.Phase != RecoveryPhaseHeld || control.Target.SectionKey != LinkSectionMath {
		t.Fatalf("control = %+v", control)
	}
}

func TestRecoveryTargetValidateProviderVocabulary(t *testing.T) {
	if err := (RecoveryTarget{SectionKey: "reading-writing"}).Validate(ProviderSAT); err != nil {
		t.Fatalf("valid SAT section rejected: %v", err)
	}
	if err := (RecoveryTarget{SectionKey: "science"}).Validate(ProviderSAT); err == nil {
		t.Fatal("SAT accepted an unrelated section")
	}
	if err := (RecoveryTarget{SectionKey: "listening"}).Validate(ProviderIELTS); err != nil {
		t.Fatalf("valid IELTS section rejected: %v", err)
	}
	if err := (RecoveryTarget{SectionKey: "reading-writing"}).Validate(ProviderACT); err == nil {
		t.Fatal("ACT accepted a SAT-only section")
	}
	if err := (RecoveryTarget{SectionKey: "science"}).Validate(ProviderACT); err != nil {
		t.Fatalf("valid ACT section rejected: %v", err)
	}
}

func TestRecoveryTargetNormalizesAndCompares(t *testing.T) {
	a := RecoveryTarget{SectionKey: " math ", ModuleAttemptID: " ma-1 ", ModuleID: " m-1 "}
	b := RecoveryTarget{SectionKey: "math", ModuleAttemptID: "ma-1", ModuleID: "m-1"}
	if !a.Equal(b) {
		t.Fatalf("%+v != %+v", a, b)
	}
	if a.Empty() || (RecoveryTarget{}).Empty() == false {
		t.Fatal("Empty did not follow the normalized target")
	}
	if err := a.Validate(ProviderSAT); err != nil {
		t.Fatalf("padded target rejected: %v", err)
	}
	if !strings.HasPrefix(RecoveryTargetKey(a), "math\x00") {
		t.Fatalf("key %q does not start with the normalized section", RecoveryTargetKey(a))
	}
}

func TestMergeSuspendedStagesKeepsFrozenValues(t *testing.T) {
	early := SuspendedRecoveryStage{
		Target:           RecoveryTarget{SectionKey: LinkSectionMath, ModuleAttemptID: "m2", ModuleID: "mod2"},
		State:            "active",
		RemainingSeconds: 600,
	}
	existing := []SuspendedRecoveryStage{early}
	incoming := []SuspendedRecoveryStage{
		// A later transfer observed less time; the earlier frozen value wins.
		{Target: early.Target, State: "active", RemainingSeconds: 120},
		{Target: RecoveryTarget{SectionKey: LinkSectionReadingWriting, ModuleAttemptID: "m3", ModuleID: "mod3"}, State: "active", RemainingSeconds: 300},
	}
	merged := MergeSuspendedStages(existing, incoming)
	if len(merged) != 2 {
		t.Fatalf("merged %d stages, want 2: %+v", len(merged), merged)
	}
	if merged[0].RemainingSeconds != 600 {
		t.Fatalf("frozen continuation was replaced: %+v", merged[0])
	}
	if !merged[1].Target.Equal(incoming[1].Target) {
		t.Fatalf("new stage missing: %+v", merged)
	}
	if again := MergeSuspendedStages(merged, incoming); len(again) != 2 {
		t.Fatalf("merge is not idempotent: %+v", again)
	}
	if MergeSuspendedStages(nil, nil) != nil {
		t.Fatal("empty merge should stay nil")
	}
}

func TestNewRecoveryControlIsHeldAndNormalized(t *testing.T) {
	control := NewRecoveryControl(" control-1 ", " session-1 ", RecoveryTarget{SectionKey: " listening "})
	if control.Phase != RecoveryPhaseHeld {
		t.Fatalf("phase = %q", control.Phase)
	}
	if control.ID != "control-1" || control.OriginalSessionID != "session-1" || control.Target.SectionKey != "listening" {
		t.Fatalf("control was not normalized: %+v", control)
	}
	if err := control.Validate(); err != nil {
		t.Fatalf("new control does not validate: %v", err)
	}
}

func TestRecoveryControlFocusDeadlineValidation(t *testing.T) {
	control := NewRecoveryControl("control-1", "session-1", RecoveryTarget{SectionKey: "science"})
	deadline := time.Date(2026, 10, 28, 12, 0, 0, 0, time.UTC)
	control.Phase = RecoveryPhaseWorking
	control.FocusDeadlineAt = &deadline
	raw, err := json.Marshal(control)
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := ParseRecoveryControl(raw)
	if err != nil {
		t.Fatalf("focus deadline control must parse: %v", err)
	}
	if parsed.FocusDeadlineAt == nil || !parsed.FocusDeadlineAt.Equal(deadline) {
		t.Fatalf("focus deadline round trip = %+v", parsed.FocusDeadlineAt)
	}

	zero := time.Time{}
	control.FocusDeadlineAt = &zero
	if err := control.Validate(); !errors.Is(err, ErrRecoveryControlMalformed) {
		t.Fatalf("zero focus deadline error = %v", err)
	}
}
