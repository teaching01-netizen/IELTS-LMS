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

// RED: enabled-section filtering must use the same effective provider, so a
// persisted assessment_sections science row is not dropped for legacy rows.
func TestEffectiveProviderKeepsScienceSectionRow(t *testing.T) {
	if !examdomain.ValidSectionKey(examdomain.EffectiveProviderKey(examdomain.ProviderIELTS, examdomain.ExamTypeACT), "science") {
		t.Fatal("legacy ACT row must accept science section key")
	}
	var _ = examruntime.PlanEntry{}
}
