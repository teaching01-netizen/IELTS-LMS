package definition

import "testing"

func TestParseSeparateSectionFormsV2(t *testing.T) {
	raw := []byte(`{"schemaVersion":2,"registration":{"fields":[{"id":"seat","type":"text","label":"Seat","required":true,"maxLength":255}]},"sectionEntry":{"reading-writing":{"fields":[]},"math":{"fields":[{"id":"class","type":"single_choice","label":"Expected Class","required":true,"options":[{"id":"rank_1","label":"Rank 1"}]}]}},"evaSim":{"enabled":false,"mode":"native"}}`)
	f, issues := Parse(raw)
	if len(issues) > 0 || f == nil {
		t.Fatalf("valid separate section forms rejected: %v", issues)
	}
	if f.SchemaVersion != 2 || len(f.Registration.Fields) != 1 {
		t.Fatal("version/common form not preserved")
	}
	if fields := ApplicableFields(f.Registration.Fields, nil); len(fields) != 1 {
		t.Fatal("v2 common fields must be applicable without legacy scope")
	}
}

func TestUpgradeSectionFormsPreservesAndCopies(t *testing.T) {
	original := DefaultSATForms()
	upgraded := UpgradeSectionForms(original)
	if len(upgraded.Validate()) != 0 || len(upgraded.Registration.Fields) != 2 || len(upgraded.SectionFields(SectionMath)) != 1 {
		t.Fatalf("invalid upgrade: %+v", upgraded)
	}
	before := original.Registration.Fields[2].Options[0].Label
	changed := upgraded.SectionEntry[SectionMath]
	changed.Fields[0].Options[0].Label = "Changed independently"
	if original.Registration.Fields[2].Options[0].Label != before {
		t.Fatal("upgrade shares option memory with original")
	}
	if original.SchemaVersion != 1 || original.Registration.Fields[2].Scope != ScopeMath {
		t.Fatal("upgrade rewrote legacy definition")
	}
}

func TestDisabledSectionKeepsItsQuestions(t *testing.T) {
	f := DefaultSectionSATForms()
	off := false
	math := f.SectionEntry[SectionMath]
	math.Enabled = &off
	f.SectionEntry[SectionMath] = math
	if len(f.Validate()) != 0 {
		t.Fatalf("disabled form must retain valid questions: %v", f.Validate())
	}
	if len(f.SectionFields(SectionMath)) != 0 || len(f.SectionEntry[SectionMath].Fields) != 1 {
		t.Fatal("disable must skip collection without deleting questions")
	}
}
