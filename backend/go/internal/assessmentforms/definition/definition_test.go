package definition

import (
	"encoding/json"
	"strings"
	"testing"
)

func mustJSON(t *testing.T, v any) []byte {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func TestDefaultSATFormsValid(t *testing.T) {
	f := DefaultSATForms()
	if issues := f.Validate(); len(issues) > 0 {
		t.Fatalf("default forms invalid: %v", issues)
	}
	if issues := f.ReadinessIssues(); len(issues) > 0 {
		t.Fatalf("disabled Eva must be ready: %v", issues)
	}
	parsed, issues := Parse(mustJSON(t, f))
	if len(issues) > 0 || parsed == nil {
		t.Fatalf("round trip failed: %v", issues)
	}
}

func TestParseRejectsUnknownKeysAndModes(t *testing.T) {
	for name, raw := range map[string]string{
		"unknown key":   `{"schemaVersion":1,"registration":{"fields":[]},"evaSim":{"enabled":false,"mode":"native"},"extra":1}`,
		"unknown mode":  `{"schemaVersion":1,"registration":{"fields":[]},"evaSim":{"enabled":true,"mode":"webhook"}}`,
		"bad version":   `{"schemaVersion":2,"registration":{"fields":[]},"evaSim":{"enabled":false,"mode":"native"}}`,
		"mixed native":  `{"schemaVersion":1,"registration":{"fields":[]},"evaSim":{"enabled":true,"mode":"native","url":"https://forms.example.org/x"}}`,
		"mixed embed":   `{"schemaVersion":1,"registration":{"fields":[]},"evaSim":{"enabled":true,"mode":"embed","url":"https://forms.example.org/x","fields":[{"id":"a","type":"text","label":"A","required":true,"scope":"all","maxLength":5}]}}`,
		"unsafe url":    `{"schemaVersion":1,"registration":{"fields":[]},"evaSim":{"enabled":true,"mode":"embed","url":"javascript:alert(1)"}}`,
		"dup ids":       `{"schemaVersion":1,"registration":{"fields":[{"id":"a","type":"text","label":"A","required":true,"scope":"all","maxLength":5},{"id":"a","type":"text","label":"B","required":true,"scope":"all","maxLength":5}]},"evaSim":{"enabled":false,"mode":"native"}}`,
		"eva rw scope":  `{"schemaVersion":1,"registration":{"fields":[]},"evaSim":{"enabled":true,"mode":"native","fields":[{"id":"a","type":"text","label":"A","required":true,"scope":"reading-writing","maxLength":5}]}}`,
		"choice no opt": `{"schemaVersion":1,"registration":{"fields":[{"id":"a","type":"single_choice","label":"A","required":true,"scope":"all"}]},"evaSim":{"enabled":false,"mode":"native"}}`,
	} {
		if _, issues := Parse([]byte(raw)); len(issues) == 0 {
			t.Errorf("%s: expected rejection", name)
		}
	}
}

func TestReadinessBlankBranches(t *testing.T) {
	f := DefaultSATForms()
	f.EvaSim.Enabled = true
	if len(f.ReadinessIssues()) != 1 {
		t.Fatal("enabled native with no fields must not be ready")
	}
	f.EvaSim = EvaSim{Enabled: true, Mode: ModeEmbed}
	if len(f.Validate()) != 0 {
		t.Fatal("blank embed URL is a saveable draft")
	}
	if len(f.ReadinessIssues()) != 1 {
		t.Fatal("blank embed URL must not be ready")
	}
}

func TestCanonicalEmbedURL(t *testing.T) {
	ok := []string{"https://forms.example.org/x?id=1&embedded=true", "https://docs.google.com/forms/d/e/abc/viewform", "https://8.8.8.8/form"}
	for _, raw := range ok {
		if _, err := CanonicalEmbedURL(raw); err != nil {
			t.Errorf("%s rejected: %v", raw, err)
		}
	}
	bad := []string{"", "http://forms.example.org", "https://user:pw@forms.example.org", "https://localhost/x", "https://127.0.0.1/x",
		"https://10.0.0.1/", "https://192.168.1.1/", "https://169.254.169.254/latest", "https://[::1]/", "https://intranet/",
		"https://svc.internal/x", "<iframe src=x>", "https://forms.example.org:8443/", "data:text/html,hi", "//forms.example.org/x",
		"https://" + strings.Repeat("a", 2050) + ".com"}
	for _, raw := range bad {
		if _, err := CanonicalEmbedURL(raw); err == nil {
			t.Errorf("%q accepted", raw)
		}
	}
	if !SameHost("https://app.example.com/form", "APP.example.com:443") {
		t.Fatal("same host must match")
	}
}

func TestApplicableFieldsByScope(t *testing.T) {
	f := DefaultSATForms()
	ids := func(fs []Field) string {
		var s []string
		for _, x := range fs {
			s = append(s, x.ID)
		}
		return strings.Join(s, ",")
	}
	if got := ids(ApplicableFields(f.Registration.Fields, nil)); got != "sat_admission_year,sat_seat_number,sat_expected_class" {
		t.Fatalf("full: %s", got)
	}
	if got := ids(ApplicableFields(f.Registration.Fields, map[string]bool{SectionReadingWriting: true})); got != "sat_admission_year,sat_seat_number" {
		t.Fatalf("rw only: %s", got)
	}
	if got := ids(ApplicableFields(f.Registration.Fields, map[string]bool{SectionMath: true})); got != "sat_admission_year,sat_seat_number,sat_expected_class" {
		t.Fatalf("math only: %s", got)
	}
}

func TestValidateAnswers(t *testing.T) {
	fields := DefaultSATForms().Registration.Fields
	got, errs := ValidateAnswers(fields, json.RawMessage(`{"sat_admission_year":2027,"sat_seat_number":" 007 ","sat_expected_class":"rank_2"}`))
	if len(errs) > 0 {
		t.Fatalf("valid answers rejected: %v", errs)
	}
	if got["sat_seat_number"] != "007" || got["sat_admission_year"] != 2027.0 {
		t.Fatalf("canonical answers wrong: %v", got)
	}
	cases := map[string]string{
		`{"sat_admission_year":70,"sat_seat_number":"A","sat_expected_class":"rank_1"}`:         "sat_admission_year",
		`{"sat_admission_year":2027.5,"sat_seat_number":"A","sat_expected_class":"rank_1"}`:     "sat_admission_year",
		`{"sat_admission_year":"2027","sat_seat_number":"A","sat_expected_class":"rank_1"}`:     "sat_admission_year",
		`{"sat_admission_year":2027,"sat_seat_number":"","sat_expected_class":"rank_1"}`:        "sat_seat_number",
		`{"sat_admission_year":2027,"sat_seat_number":"A","sat_expected_class":"rank_9"}`:       "sat_expected_class",
		`{"sat_admission_year":2027,"sat_seat_number":"A"}`:                                     "sat_expected_class",
		`{"sat_admission_year":2027,"sat_seat_number":"A","sat_expected_class":"rank_1","x":1}`: "x",
	}
	for raw, key := range cases {
		if _, errs := ValidateAnswers(fields, json.RawMessage(raw)); errs[key] == "" {
			t.Errorf("%s: expected error on %s, got %v", raw, key, errs)
		}
	}
	rw := ApplicableFields(fields, map[string]bool{SectionReadingWriting: true})
	if _, errs := ValidateAnswers(rw, json.RawMessage(`{"sat_admission_year":2027,"sat_seat_number":"A","sat_expected_class":"rank_1"}`)); errs["sat_expected_class"] == "" {
		t.Fatal("inapplicable answer must be rejected")
	}
}

func TestFromSnapshot(t *testing.T) {
	if f, err := FromSnapshot([]byte(`{"timing":{}}`)); f != nil || err != nil {
		t.Fatal("absent forms is legacy")
	}
	if _, err := FromSnapshot([]byte(`{"forms":{"schemaVersion":9}}`)); err == nil {
		t.Fatal("malformed forms must error")
	}
}
