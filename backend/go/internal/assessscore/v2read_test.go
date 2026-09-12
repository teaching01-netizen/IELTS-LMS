package assessscore

import "testing"

func TestV2ResponseToScorerInputParity(t *testing.T) {
	cases := []struct {
		name      string
		canonical string
		want      string
		wantOK    bool
	}{
		{"single choice", `{"answer":"B","markedForReview":false,"eliminatedOptions":[],"annotations":[]}`, `"B"`, true},
		{"empty answer string still usable", `{"answer":"","markedForReview":false,"eliminatedOptions":[],"annotations":[]}`, `""`, true},
		{"null answer unusable", `{"answer":null,"markedForReview":false,"eliminatedOptions":[],"annotations":[]}`, "", false},
		{"missing answer unusable", `{"markedForReview":false}`, "", false},
		{"empty payload unusable", "", "", false},
		{"malformed payload unusable", "not-json", "", false},
		{"numeric answer", `{"answer":42,"markedForReview":true}`, "42", true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := V2ResponseToScorerInput(tc.canonical)
			if ok != tc.wantOK || got != tc.want {
				t.Fatalf("V2ResponseToScorerInput(%q) = (%q,%v), want (%q,%v)", tc.canonical, got, ok, tc.want, tc.wantOK)
			}
		})
	}
}

func TestV2ScorerVerdictMatchesLegacy(t *testing.T) {
	key := `{"kind":"single_choice","correctOptionId":"B"}`
	// Same logical answer must score identically through the V2 envelope and
	// the legacy JSON-string response.
	for _, tc := range []struct {
		canonical string
		legacy    string
		want      bool
	}{
		{`{"answer":"B"}`, `"B"`, true},
		{`{"answer":"A"}`, `"A"`, false},
		{`{"answer":null}`, "null", false},
	} {
		v2in, v2ok := V2ResponseToScorerInput(tc.canonical)
		gotV2 := v2ok && SATResponseCorrect(key, true, v2in)
		gotLegacy := SATResponseCorrect(key, true, tc.legacy)
		if gotV2 != gotLegacy || gotV2 != tc.want {
			t.Fatalf("parity break for %q: v2=%v legacy=%v want=%v", tc.canonical, gotV2, gotLegacy, tc.want)
		}
	}
}

// Exam-day re-audit defect 7: verdict parity across the SPR matrix —
// single-choice equality, accepted-response matching, ASCII case folding,
// fraction/decimal normalization, and explicit tolerance. delivery now
// imports SATResponseCorrect directly, but this table pins the shared
// semantics both paths execute.
func TestV2ScorerVerdictMatchesLegacySPRMatrix(t *testing.T) {
	sprKey := func(accepted []string, extra string) string {
		return `{"kind":"student_produced_response","acceptedResponses":[` + joinQuoted(accepted) + `],` + extra + `}`
	}
	cases := []struct {
		name      string
		key       string
		canonical string
		legacy    string
		want      bool
	}{
		{"spr exact", sprKey([]string{"42"}, `"normalizeFraction":false,"normalizeDecimal":false,"numericTolerance":null`), `{"answer":"42"}`, `"42"`, true},
		{"spr wrong", sprKey([]string{"42"}, `"normalizeFraction":false,"normalizeDecimal":false,"numericTolerance":null`), `{"answer":"43"}`, `"43"`, false},
		{"spr case fold", sprKey([]string{"ABC"}, `"normalizeFraction":false,"normalizeDecimal":false,"numericTolerance":null`), `{"answer":"abc"}`, `"abc"`, true},
		{"spr fraction", sprKey([]string{"1/2"}, `"normalizeFraction":true,"normalizeDecimal":false,"numericTolerance":null`), `{"answer":"0.5"}`, `"0.5"`, true},
		{"spr tolerance", sprKey([]string{"100"}, `"normalizeFraction":false,"normalizeDecimal":true,"numericTolerance":"0.5"`), `{"answer":"100.4"}`, `"100.4"`, true},
		{"spr outside tolerance", sprKey([]string{"100"}, `"normalizeFraction":false,"normalizeDecimal":true,"numericTolerance":"0.5"`), `{"answer":"101"}`, `"101"`, false},
		{"spr decimal off no match", sprKey([]string{"42"}, `"normalizeFraction":false,"normalizeDecimal":false,"numericTolerance":null`), `{"answer":"42.0"}`, `"42.0"`, false},
		{"single choice exact", `{"kind":"single_choice","correctOptionId":"B"}`, `{"answer":"B"}`, `"B"`, true},
		{"single choice miss", `{"kind":"single_choice","correctOptionId":"B"}`, `{"answer":"A"}`, `"A"`, false},
		{"keyless null verdict", `{"kind":"single_choice","correctOptionId":null}`, `{"answer":"B"}`, `"B"`, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			v2in, v2ok := V2ResponseToScorerInput(tc.canonical)
			gotV2 := v2ok && SATResponseCorrect(tc.key, true, v2in)
			gotLegacy := SATResponseCorrect(tc.key, true, tc.legacy)
			if gotV2 != gotLegacy || gotV2 != tc.want {
				t.Fatalf("parity break for %s: v2=%v legacy=%v want=%v", tc.name, gotV2, gotLegacy, tc.want)
			}
		})
	}
}

func joinQuoted(in []string) string {
	out := ""
	for i, s := range in {
		if i > 0 {
			out += ","
		}
		out += `"` + s + `"`
	}
	return out
}

func TestV2MarkedForReview(t *testing.T) {
	if !V2MarkedForReview(`{"answer":"A","markedForReview":true}`) {
		t.Fatal("expected marked review true")
	}
	if V2MarkedForReview(`{"answer":"A","markedForReview":false}`) {
		t.Fatal("expected marked review false")
	}
	if V2MarkedForReview("") || V2MarkedForReview("not-json") {
		t.Fatal("expected false for empty/malformed")
	}
}
