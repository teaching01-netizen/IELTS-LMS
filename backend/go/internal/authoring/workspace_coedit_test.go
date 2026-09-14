package authoring

import (
	"encoding/json"
	"testing"
)

func TestParseWorkspaceQuestionProjectionSupportsRichAndScalarRoots(t *testing.T) {
	projections, err := parseWorkspaceQuestionProjection([]byte(`{
		"question/eq-1/scalar": {
			"questionType": "single_choice",
			"isPretest": true,
			"answer": {"kind":"single_choice","options":[{"id":"A"}],"correctOptionId":"A"},
			"metadata": {"sectionKey":"math","tags":[]},
			"accessibility": {"longDescription":null}
		},
		"rich:question/eq-1/prompt": {"version":2,"nodes":[]},
		"rich:question/eq-1/choice/A": {"version":2,"nodes":[{"type":"paragraph"}]},
		"delivery/section-1": {"baseMinutes":35}
	}`))
	if err != nil {
		t.Fatal(err)
	}
	projection := projections["eq-1"]
	if projection == nil || projection.questionType == nil || *projection.questionType != "single_choice" {
		t.Fatalf("expected the question scalar projection, got %+v", projection)
	}
	if projection.isPretest == nil || !*projection.isPretest {
		t.Fatalf("expected isPretest to be projected, got %+v", projection.isPretest)
	}
	if !projection.promptPresent || len(projection.choices) != 1 {
		t.Fatalf("expected prompt and one choice rich root, got %+v", projection)
	}
	if _, ok := projections["section-1"]; ok {
		t.Fatal("delivery values must not become question projections")
	}
}

func TestMergeWorkspaceAnswerPreservesChoiceContentAndAppliesRichChoice(t *testing.T) {
	current := json.RawMessage(`{
		"kind":"single_choice",
		"options":[
			{"id":"A","content":{"version":2,"nodes":[{"type":"paragraph","text":"old A"}]}},
			{"id":"B","content":{"version":2,"nodes":[{"type":"paragraph","text":"old B"}]}}
		],
		"correctOptionId":"A"
	}`)
	incoming := json.RawMessage(`{
		"kind":"single_choice",
		"options":[{"id":"B"},{"id":"A"}],
		"correctOptionId":"B"
	}`)
	choiceB := json.RawMessage(`{"version":2,"nodes":[{"type":"paragraph","text":"new B"}]}`)
	merged, err := mergeWorkspaceAnswer(current, incoming, true, map[string]json.RawMessage{"B": choiceB})
	if err != nil {
		t.Fatal(err)
	}
	var answer map[string]any
	if err := json.Unmarshal(merged, &answer); err != nil {
		t.Fatal(err)
	}
	options, ok := answer["options"].([]any)
	if !ok || len(options) != 2 {
		t.Fatalf("expected two merged options, got %#v", answer["options"])
	}
	first := options[0].(map[string]any)
	if first["id"] != "B" || first["content"].(map[string]any)["nodes"].([]any)[0].(map[string]any)["text"] != "new B" {
		t.Fatalf("rich choice content/order was not applied: %#v", first)
	}
	second := options[1].(map[string]any)
	if second["id"] != "A" || second["content"].(map[string]any)["nodes"].([]any)[0].(map[string]any)["text"] != "old A" {
		t.Fatalf("existing choice content was not preserved: %#v", second)
	}
}

func TestParseWorkspaceQuestionProjectionRejectsMalformedScalar(t *testing.T) {
	if _, err := parseWorkspaceQuestionProjection([]byte(`{"question/eq-1/scalar":true}`)); err == nil {
		t.Fatal("expected malformed scalar to be rejected")
	}
}
