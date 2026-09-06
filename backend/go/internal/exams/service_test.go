package exams

import "testing"

func TestValidExamTypeIncludesACT(t *testing.T) {
	for _, valid := range []string{ExamTypeAcademic, ExamTypeGeneralTraining, ExamTypeACT} {
		if !ValidExamType(valid) {
			t.Fatalf("expected exam type %q to be valid", valid)
		}
	}
	for _, invalid := range []string{"", "academic", "SAT", "General", "IELTS", "act"} {
		if ValidExamType(invalid) {
			t.Fatalf("expected exam type %q to be invalid", invalid)
		}
	}
}

func TestSectionKeyAllowlistScience(t *testing.T) {
	// IELTS allowlist: classic four sections, no science.
	for _, key := range []string{"listening", "reading", "writing", "speaking"} {
		if !ValidSectionKey(ProviderIELTS, key) {
			t.Fatalf("expected IELTS section %q to be allowed", key)
		}
	}
	if ValidSectionKey(ProviderIELTS, "science") {
		t.Fatal("IELTS allowlist must not include science")
	}
	if ValidSectionKey(ProviderIELTS, "reading-writing") {
		t.Fatal("IELTS allowlist must not include SAT reading-writing")
	}
	// SAT allowlist: adaptive sections only.
	for _, key := range SATSectionKeys {
		if !ValidSectionKey(ProviderSAT, key) {
			t.Fatalf("expected SAT section %q to be allowed", key)
		}
	}
	if ValidSectionKey(ProviderSAT, "science") {
		t.Fatal("SAT allowlist must not include science")
	}
	// ACT allowlist: classic four plus science (migration 0050).
	for _, key := range []string{"listening", "reading", "writing", "speaking", "science"} {
		if !ValidSectionKey(ProviderACT, key) {
			t.Fatalf("expected ACT section %q to be allowed", key)
		}
	}
	if ValidSectionKey(ProviderACT, "reading-writing") {
		t.Fatal("ACT allowlist must not include SAT reading-writing")
	}
}

func TestValidateCreateRejectsBadProviderAndType(t *testing.T) {
	badProvider := "toefl"
	if err := validateCreate(CreateRequest{Slug: "s", Title: "T", ExamType: ExamTypeACT, Visibility: VisibilityPrivate, OwnerID: "u", ProviderKey: &badProvider}); err == nil {
		t.Fatal("expected provider validation error")
	}
	if err := validateCreate(CreateRequest{Slug: "s", Title: "T", ExamType: "SAT", Visibility: VisibilityPrivate, OwnerID: "u"}); err == nil {
		t.Fatal("expected exam-type validation error")
	}
	if err := validateCreate(CreateRequest{Slug: "s", Title: "   ", ExamType: ExamTypeACT, Visibility: VisibilityPrivate, OwnerID: "u"}); err == nil {
		t.Fatal("expected title validation error")
	}
}
