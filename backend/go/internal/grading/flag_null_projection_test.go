package grading

import "testing"

// A student flag on a slot stores a null slot answer alongside the real
// array answer. The array element must win: the slot grades from the array
// instead of reading as unanswered.
func TestProjectionPrefersArrayOverFlagOnlyNullSlot(t *testing.T) {
	content := map[string]any{
		"reading": map[string]any{
			"passages": []any{
				map[string]any{
					"id": "p1",
					"blocks": []any{
						map[string]any{
							"id":      "blk-1",
							"type":    "MATCHING_FEATURES",
							"options": []any{"A. hand collecting", "B. using bait"},
							"features": []any{
								map[string]any{"id": "f1", "text": "Feature one", "correctMatch": "A. hand collecting"},
								map[string]any{"id": "f2", "text": "Feature two", "correctMatch": "B. using bait"},
							},
						},
					},
				},
			},
		},
	}
	answers := map[string]any{
		"blk-1":      []any{"A. hand collecting", "B. using bait"},
		"blk-1:f1":   nil,
		"blk-1:f2":   nil,
	}
	result := GradeContentForParity(ParityInput{Section: "reading", Content: content, Answers: answers})
	byID := map[string]string{}
	for _, q := range result.Questions {
		byID[q.QuestionID] = q.Status
	}
	if byID["blk-1:f1"] != "verified_correct" {
		t.Fatalf("blk-1:f1 status = %q, want verified_correct (array must win over null slot)", byID["blk-1:f1"])
	}
	if byID["blk-1:f2"] != "verified_correct" {
		t.Fatalf("blk-1:f2 status = %q, want verified_correct (array must win over null slot)", byID["blk-1:f2"])
	}
}
