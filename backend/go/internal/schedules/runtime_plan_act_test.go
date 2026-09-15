package schedules

import (
	"testing"

	examdomain "example.com/ielts-proctoring/internal/exams"
	examruntime "example.com/ielts-proctoring/internal/runtime"
)

// RED: a legacy ACT exam (provider_key='ielts', exam_type='ACT') with science
// enabled in config and no assessment_sections rows must still produce a
// science plan entry. Today configuredRuntimePlan(raw, 'ielts') drops
// science, the empty plan falls through to the reading fallback, and preview
// of the only enabled section hard-fails.
func TestConfiguredRuntimePlanKeepsScienceForLegacyACT(t *testing.T) {
	raw := `{"sections": {"science": {"label": "Science", "order": 0, "enabled": true, "duration": 40, "gapAfterMinutes": 0}, "reading": {"label": "Reading", "order": 1, "enabled": false, "duration": 60}}}`
	plan := configuredRuntimePlan(raw, examdomain.EffectiveProviderKey(examdomain.ProviderIELTS, examdomain.ExamTypeACT))
	if len(plan) != 1 {
		t.Fatalf("expected 1 science plan entry, got %+v", plan)
	}
	if plan[0].SectionKey != "science" {
		t.Fatalf("expected science plan entry, got %+v", plan[0])
	}
}

// Phase 02: the empty-plan fallback for ACT is a single Science section
// (default 40 minutes), never the IELTS reading entry — a Science-less ACT
// plan silently drops the only scorable section.
func TestFallbackRuntimePlanKeepsScienceForACT(t *testing.T) {
	plan := fallbackRuntimePlan(examdomain.ProviderACT, 0)
	if len(plan) != 1 || plan[0].SectionKey != "science" {
		t.Fatalf("ACT fallback must be a single science entry, got %+v", plan)
	}
	if plan[0].DurationMinutes != 40 {
		t.Fatalf("ACT fallback must default to 40 minutes, got %+v", plan)
	}
	legacy := fallbackRuntimePlan(examdomain.EffectiveProviderKey(examdomain.ProviderIELTS, examdomain.ExamTypeACT), 0)
	if len(legacy) != 1 || legacy[0].SectionKey != "science" {
		t.Fatalf("legacy ACT fallback must heal to science, got %+v", legacy)
	}
}

// A section authored with no break must plan a zero-minute gap. The duration
// conversion floors at one minute (a zero-length section is not a section),
// but a gap of zero is the "advance immediately" case the section reconciler
// supports explicitly — reusing the duration floor here persisted
// gap_after_minutes = 1 and put the cohort on an unearned one-minute break
// after any section whose author left the break empty (SAT Math by default).
func TestZeroAuthoredBreakPlansAZeroGap(t *testing.T) {
	if got := ceilGapMinutes(0); got != 0 {
		t.Fatalf("a zero authored break must plan gap 0, got %d", got)
	}
	if got := ceilGapMinutes(600); got != 10 {
		t.Fatalf("a 600s authored break must plan gap 10, got %d", got)
	}
	if got := ceilGapMinutes(61); got != 2 {
		t.Fatalf("a partial minute must round up, got %d", got)
	}
	// Durations keep the one-minute floor: a section cannot be zero length.
	if got := ceilMinutes(0); got != 1 {
		t.Fatalf("a zero duration must keep the one-minute floor, got %d", got)
	}
	plan := configuredRuntimePlan(`{"sections":{"reading-writing":{"enabled":true,"order":0,"duration":64,"gapAfterMinutes":0}}}`, examdomain.ProviderSAT)
	if len(plan) != 1 || plan[0].GapAfterMinutes != 0 {
		t.Fatalf("the config plan path must also keep a zero gap, got %+v", plan)
	}
}

// RED: enabled-section filtering must use the same effective provider, so a
// persisted assessment_sections science row is not dropped for legacy rows.
func TestEffectiveProviderKeepsScienceSectionRow(t *testing.T) {
	if !examdomain.ValidSectionKey(examdomain.EffectiveProviderKey(examdomain.ProviderIELTS, examdomain.ExamTypeACT), "science") {
		t.Fatal("legacy ACT row must accept science section key")
	}
	var _ = examruntime.PlanEntry{}
}
