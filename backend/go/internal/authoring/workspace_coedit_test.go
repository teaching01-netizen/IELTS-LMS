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

const workspaceStudentResponseAnswer = `{
	"kind":"student_produced_response",
	"acceptedResponses":["4","4.0","8/2"],
	"normalizeFraction":false,
	"normalizeDecimal":false,
	"numericTolerance":"0.001"
}`

func TestMergeWorkspaceAnswerPreservesStudentResponseWithStaleChoices(t *testing.T) {
	updated := json.RawMessage(`{
		"kind":"student_produced_response","acceptedResponses":["12","24/2"],
		"normalizeFraction":true,"normalizeDecimal":true,"numericTolerance":null
	}`)
	choices := map[string]json.RawMessage{
		"A": json.RawMessage(`{"version":2,"nodes":[],"document":{"type":"doc","content":[{"type":"paragraph"}]}}`),
	}
	for _, test := range []struct {
		name            string
		current         json.RawMessage
		incoming        json.RawMessage
		incomingPresent bool
		want            json.RawMessage
	}{
		{"switch from multiple choice", json.RawMessage(validChoiceAnswer()), json.RawMessage(workspaceStudentResponseAnswer), true, json.RawMessage(workspaceStudentResponseAnswer)},
		{"update student response", json.RawMessage(workspaceStudentResponseAnswer), updated, true, updated},
		{"choice-only update", json.RawMessage(workspaceStudentResponseAnswer), nil, false, json.RawMessage(workspaceStudentResponseAnswer)},
	} {
		t.Run(test.name, func(t *testing.T) {
			merged, err := mergeWorkspaceAnswer(test.current, test.incoming, test.incomingPresent, choices)
			if err != nil {
				t.Fatal(err)
			}
			if !workspaceJSONEqual(merged, test.want) {
				t.Fatalf("stale choices changed the student-response definition: got %s, want %s", merged, test.want)
			}
		})
	}
}

func TestWorkspaceStudentResponseProjectionRecognizesAnswerKey(t *testing.T) {
	workspace := json.RawMessage(`{
		"question/eq-1/scalar": {
			"questionType":"student_produced_response",
			"answer":` + workspaceStudentResponseAnswer + `
		},
		"rich:question/eq-1/choice/A":{"version":2,"nodes":[]}
	}`)
	projections, err := parseWorkspaceQuestionProjection(workspace)
	if err != nil {
		t.Fatal(err)
	}
	projection := projections["eq-1"]
	if projection == nil || projection.questionType == nil {
		t.Fatal("student-response scalar was not projected")
	}
	merged, err := mergeWorkspaceAnswer(json.RawMessage(validChoiceAnswer()), projection.answer, projection.answerPresent, projection.choices)
	if err != nil {
		t.Fatal(err)
	}
	row := questionValidationRow{
		examQuestionID: "eq-1", questionID: "q-1", revisionID: "qr-1", sectionKey: SectionMath,
		questionType: *projection.questionType, stimulus: emptyContent(), prompt: validPrompt(),
		answer: string(merged), rationale: emptyContent(),
		metadata: `{"sectionKey":"math","domain":"algebra","skill":"Linear Functions","difficulty":"medium","tags":[]}`,
	}
	summary := row.summary()
	if summary.AnswerKeyPreview == nil || *summary.AnswerKeyPreview != "4" {
		t.Fatalf("student-response answer key was lost: %+v", summary)
	}
	if summary.Readiness.Status != "ready" || summary.Readiness.BlockingIssueCount != 0 {
		t.Fatalf("valid student response was not ready: %+v", summary.Readiness)
	}

	row.metadata = `{"sectionKey":"math","difficulty":"medium","tags":[]}`
	issues := validateSATQuestion(row.sectionKey, row.questionType, row.stimulus, row.prompt, row.answer, row.rationale, row.metadata)
	if len(issues) != 2 || !containsIssueCode(issues, "sat.metadata.domain.required") || !containsIssueCode(issues, "sat.metadata.skill.required") {
		t.Fatalf("expected only the unrelated metadata issues, got %+v", issues)
	}
	summary = row.summary()
	if summary.AnswerKeyPreview == nil || *summary.AnswerKeyPreview != "4" || summary.Readiness.BlockingIssueCount != 2 {
		t.Fatalf("metadata issues changed the student-response answer key: %+v", summary)
	}
}

func TestMergeWorkspaceAnswerSwitchesStudentResponseBackToMultipleChoice(t *testing.T) {
	incoming := json.RawMessage(`{
		"kind":"single_choice","options":[{"id":"A"},{"id":"B"},{"id":"C"},{"id":"D"}],"correctOptionId":"B"
	}`)
	var expected struct {
		Options []struct {
			ID      string          `json:"id"`
			Content json.RawMessage `json:"content"`
		} `json:"options"`
	}
	if err := json.Unmarshal([]byte(validChoiceAnswer()), &expected); err != nil {
		t.Fatal(err)
	}
	choices := make(map[string]json.RawMessage, len(expected.Options))
	for _, option := range expected.Options {
		choices[option.ID] = option.Content
	}
	merged, err := mergeWorkspaceAnswer(json.RawMessage(workspaceStudentResponseAnswer), incoming, true, choices)
	if err != nil {
		t.Fatal(err)
	}
	var answer map[string]any
	if err := json.Unmarshal(merged, &answer); err != nil {
		t.Fatal(err)
	}
	if answer["kind"] != "single_choice" || answer["correctOptionId"] != "B" || answer["acceptedResponses"] != nil {
		t.Fatalf("incorrect answer after switching back to multiple choice: %s", merged)
	}
	issues := validateSATQuestion(SectionReadingWriting, "single_choice", emptyContent(), validPrompt(), string(merged), emptyContent(), validMetadata())
	if len(issues) != 0 {
		t.Fatalf("multiple-choice content or answer key was lost: %+v", issues)
	}
}

func TestParseWorkspaceQuestionProjectionRejectsMalformedScalar(t *testing.T) {
	if _, err := parseWorkspaceQuestionProjection([]byte(`{"question/eq-1/scalar":true}`)); err == nil {
		t.Fatal("expected malformed scalar to be rejected")
	}
}
