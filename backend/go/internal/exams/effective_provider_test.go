package exams

import "testing"

// RED: legacy ACT exams carry exam_type='ACT' while provider_key stayed
// 'ielts' (created through the legacy IELTS path before ACT provider
// identity existed). Plan derivation, validation, and grading branches that
// key off provider_key alone drop the science section for these rows.
// EffectiveProviderKey must heal that mismatch: exam_type ACT wins.
func TestEffectiveProviderKeyHealsLegacyACTRows(t *testing.T) {
	cases := []struct {
		name        string
		providerKey string
		examType    string
		want        string
	}{
		{"act provider row stays act", ProviderACT, ExamTypeACT, ProviderACT},
		{"legacy act row heals to act", ProviderIELTS, ExamTypeACT, ProviderACT},
		{"legacy act row heals despite blank provider", "", ExamTypeACT, ProviderACT},
		{"ielts academic stays ielts", ProviderIELTS, ExamTypeAcademic, ProviderIELTS},
		{"ielts general stays ielts", ProviderIELTS, ExamTypeGeneralTraining, ProviderIELTS},
		{"sat stays sat", ProviderSAT, ExamTypeAcademic, ProviderSAT},
		{"unknown provider with act type still heals", "toefl", ExamTypeACT, ProviderACT},
	}
	for _, tc := range cases {
		if got := EffectiveProviderKey(tc.providerKey, tc.examType); got != tc.want {
			t.Fatalf("%s: EffectiveProviderKey(%q, %q) = %q, want %q", tc.name, tc.providerKey, tc.examType, got, tc.want)
		}
	}
}

// RED: science content on a legacy ACT row must validate against the ACT
// blueprint, not the IELTS one.
func TestValidateContentShapeAllowsScienceForLegacyACT(t *testing.T) {
	content := `{"sections": [{"key": "science"}, {"key": "reading"}]}`
	if issues := validateContentShape(content, "{}", ProviderIELTS); len(issues) != 1 {
		t.Fatalf("IELTS science content should yield 1 issue, got %v", issues)
	}
	if issues := validateContentShape(content, "{}", EffectiveProviderKey(ProviderIELTS, ExamTypeACT)); len(issues) != 0 {
		t.Fatalf("legacy ACT science content should validate clean, got %v", issues)
	}
}
