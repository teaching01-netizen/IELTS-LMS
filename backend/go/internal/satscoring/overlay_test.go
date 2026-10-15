package satscoring

import (
	"testing"

	"example.com/ielts-proctoring/internal/satconvert"
)

func TestSectionQualified(t *testing.T) {
	for _, tc := range []struct {
		section map[string]any
		want    bool
	}{
		{map[string]any{}, true},
		{map[string]any{Module1QualifiedKey: true}, true},
		{map[string]any{Module1QualifiedKey: false}, false},
	} {
		if got := SectionQualified(tc.section); got != tc.want {
			t.Fatalf("SectionQualified(%v) = %v, want %v", tc.section, got, tc.want)
		}
	}
}

// ApplyRevision never converts a section whose Module 1 missed the threshold of
// its fixed Module 2 plan; a qualified or unflagged section still converts.
func TestApplyRevisionSkipsUnqualifiedSection(t *testing.T) {
	score := 500
	rev := &Revision{Content: &satconvert.Content{Sections: map[string]*satconvert.SectionPolicy{
		satconvert.SectionMath: {
			Tables: map[string]*satconvert.PolicyTable{"t": {Kind: satconvert.KindMatrix, M1Operational: 1, M2Operational: 1,
				Cells: [][]*int{{&score, &score}, {&score, &score}}}},
			Assign: map[string][]string{string(satconvert.FullHigher): {"t"}},
		},
	}}}
	for _, tc := range []struct {
		qualified any
		want      string
	}{{nil, "converted"}, {true, "converted"}, {false, "unavailable"}} {
		s := map[string]any{"sectionKey": satconvert.SectionMath, "modules": []any{
			map[string]any{"moduleKey": "math-m1", "rawCorrect": float64(1), "total": float64(1)},
			map[string]any{"moduleKey": "math-m2-higher", "rawCorrect": float64(1), "total": float64(1)},
		}}
		if tc.qualified != nil {
			s[Module1QualifiedKey] = tc.qualified
		}
		ApplyRevision(rev, map[string]any{"sections": []any{s}})
		if s["conversionStatus"] != tc.want || (tc.want == "unavailable") != (s["scaled"] == nil) {
			t.Fatalf("qualified=%v: %+v", tc.qualified, s)
		}
	}
}
