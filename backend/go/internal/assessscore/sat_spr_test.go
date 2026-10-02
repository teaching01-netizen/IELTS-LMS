package assessscore

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

func strictKey(values ...string) string {
	raw, _ := json.Marshal(map[string]any{"kind": "student_produced_response", "acceptedResponses": values, "normalizeFraction": true, "normalizeDecimal": true, "numericTolerance": nil})
	return string(raw)
}

func TestStrictSATSPRGrading(t *testing.T) {
	cases := []struct {
		key, response string
		want          bool
	}{
		{"2/3", "2/3", true}, {"2/3", "4/6", true},
		{"2/3", ".6666", true}, {"2/3", ".6667", true}, {"2/3", "0.666", true}, {"2/3", "0.667", true},
		{"2/3", ".66", false}, {"2/3", "0.67", false}, {"2/3", ".6665", false}, {"2/3", ".6668", false},
		{"2/3", "1/3", false}, {"2/3", "0.6667", false},
		{"-1/3", "-.3333", true}, {"-1/3", "-.333", true}, {"-1/3", "-.3334", false}, {"-1/3", "-.33", false},
		{"-1/3", ".3333", false}, {"-1/3", "-0.333", true},
		{"3.5", "7/2", true}, {"3.5", "3.50", true}, {"3.5", "31/2", false}, {"3.5", "3 1/2", false},
		{"12", "24/2", true}, {"12", "12.00", true}, {"12", "11.99", false},
		{"12345", "12344", false}, {"0", "-0", true}, {"0", ".0001", false},
		{"1/99999", ".0000", false}, {"1/99999", "0", false},
		{"1.23456", "1.234", true}, {"1.23456", "1.235", true}, {"1.23456", "1.23", false},
		{"10.23456", "10.23", true}, {"10.23656", "10.24", true}, {"10.23456", "1.23", false},
		{".1234", ".123", false}, {".1234", ".1234", true}, {".667", "2/3", false},
		{"3.14159265", "3.142", true}, {"3.14159265", "3.141", true}, {"3.14159265", "3.14", false},
		{"9.9999", "10.00", true}, {"9.9999", "10", true}, {"9.9999", "9.999", true},
		{"1000.123", "1000", true}, {"1000.123", "1001", false}, {"99999.9", "99999", true},
		{"12", "1e1", false}, {"12", "0xC", false}, {"12", "12%", false}, {"12", "$12", false},
		{"12", "12abc", false}, {"12", "1_2", false}, {"12", "12/0", false}, {"12", "12.", false},
		{"12", "1.2/3", false}, {"12", "+12", false}, {"12", "NaN", false}, {"12", "Inf", false},
		{"12", "123456", false}, {"12", "", false}, {"12", "12/1/1", false}, {"12", " 12 ", true},
	}
	for _, tc := range cases {
		t.Run(tc.key+"/"+tc.response, func(t *testing.T) {
			raw, _ := json.Marshal(tc.response)
			if got := SATResponseCorrectWithPolicy(strictKey(tc.key), true, string(raw), SATSPRStrictV1); got != tc.want {
				t.Fatalf("key %s response %s: got %v want %v", tc.key, tc.response, got, tc.want)
			}
		})
	}
	for _, raw := range []string{"null", "12", `{}`, `{"answer":"12"}`, `true`} {
		if SATResponseCorrectWithPolicy(strictKey("12"), true, raw, SATSPRStrictV1) {
			t.Fatalf("non-string accepted: %s", raw)
		}
	}
	if SATResponseCorrectWithPolicy(strictKey("12"), false, `"12"`, SATSPRStrictV1) {
		t.Fatal("missing response accepted")
	}
	if !SATResponseCorrectWithPolicy(strictKey("12", "24"), true, `"24"`, SATSPRStrictV1) {
		t.Fatal("second accepted value rejected")
	}
}

func TestStrictSATSPRDefinition(t *testing.T) {
	for _, key := range []string{"100/333", "3.14159265", "99999", "-99999", "2/3", "0", "0.0001"} {
		if err := ValidateSATSPRDefinition(strictKey(key)); err != nil {
			t.Errorf("valid key %s: %v", key, err)
		}
	}
	for _, key := range []string{"", "ABC", "1/0", "1e3", "0x10", "1 1/2", "123456", "1/999999", strings.Repeat("1", 257)} {
		if err := ValidateSATSPRDefinition(strictKey(key)); err == nil {
			t.Errorf("invalid key accepted: %s", key)
		}
	}
	for _, def := range []string{
		`{"kind":"student_produced_response","acceptedResponses":["12",null]}`,
		`{"kind":"student_produced_response","acceptedResponses":["12",""]}`,
		`{"kind":"student_produced_response","acceptedResponses":["12"],"normalizeFraction":false}`,
		`{"kind":"student_produced_response","acceptedResponses":["12"],"normalizeDecimal":"true"}`,
		`{"kind":"student_produced_response","acceptedResponses":["12"],"numericTolerance":"0"}`,
		`{"kind":"student_produced_response","acceptedResponses":["12"],"numericTolerance":0.1}`,
	} {
		if ValidateSATSPRDefinition(def) == nil {
			t.Errorf("invalid definition accepted: %s", def)
		}
		if SATResponseCorrectWithPolicy(def, true, `"12"`, SATSPRStrictV1) {
			t.Errorf("invalid definition granted credit: %s", def)
		}
		if SATHasKeyWithPolicy(def, SATSPRStrictV1) {
			t.Errorf("invalid strict key reported usable: %s", def)
		}
	}
}

func TestSATSPRPolicyCompatibility(t *testing.T) {
	for config, want := range map[string]string{"": "", `{}`: "", `{"other":true}`: "", `{"satStudentResponseScoring":"strict_v1"}`: SATSPRStrictV1, `{"satStudentResponseScoring":"future"}`: "invalid", `{"satStudentResponseScoring":null}`: "invalid"} {
		if got := SATSPRPolicy(config); got != want {
			t.Errorf("config %s: got %s want %s", config, got, want)
		}
	}
	def := strictKey("2/3")
	if SATResponseCorrect(def, true, `".6667"`) {
		t.Fatal("legacy grading changed")
	}
	if !SATResponseCorrectWithPolicy(def, true, `".6667"`, SATSPRStrictV1) {
		t.Fatal("strict policy not used")
	}
	if SATResponseCorrectWithPolicy(def, true, `"2/3"`, "future") {
		t.Fatal("unknown policy accepted")
	}
	if SATHasKeyWithPolicy(def, "future") {
		t.Fatal("unknown policy reported usable")
	}
	if !SATHasKeyWithPolicy(def, SATSPRStrictV1) {
		t.Fatal("valid strict key reported unusable")
	}
}

func TestStrictSATSPRExactEquivalence(t *testing.T) {
	for numerator := 1; numerator <= 9; numerator++ {
		for denominator := 1; denominator <= 9; denominator++ {
			key := newKeyFraction(numerator, denominator)
			if !SATResponseCorrectWithPolicy(strictKey(key), true, `"`+newKeyFraction(numerator*2, denominator*2)+`"`, SATSPRStrictV1) {
				t.Fatalf("equivalent fraction rejected: %s", key)
			}
		}
	}
}

func newKeyFraction(numerator, denominator int) string {
	return fmt.Sprintf("%d/%d", numerator, denominator)
}
