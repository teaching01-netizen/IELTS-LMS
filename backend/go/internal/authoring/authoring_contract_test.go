package authoring

import (
	"encoding/json"
	"testing"
)

// The frontend POSTs .../modules/{id}/questions with no body; the service
// must synthesize a section-aware blank editor draft instead of rejecting it
// with "Question type is required." (regression: 400 Invalid request body).
func TestIsEmptyQuestionDraftAcceptsEmptyBody(t *testing.T) {
	if !isEmptyQuestionDraft(QuestionDraft{}) {
		t.Fatal("zero draft must be treated as the empty-body create path")
	}
	if isEmptyQuestionDraft(QuestionDraft{QuestionType: "single_choice"}) {
		t.Fatal("explicit question type must not take the default-draft path")
	}
}

func TestDefaultSATQuestionDraftIsSectionAware(t *testing.T) {
	rw := defaultSATQuestionDraft(SectionReadingWriting)
	if rw.QuestionType != "single_choice" {
		t.Fatalf("rw default type = %q, want single_choice", rw.QuestionType)
	}
	var rwMeta map[string]any
	if err := json.Unmarshal(rw.Metadata, &rwMeta); err != nil || rwMeta["sectionKey"] != SectionReadingWriting {
		t.Fatalf("rw default metadata = %s", string(rw.Metadata))
	}
	math := defaultSATQuestionDraft(SectionMath)
	var mathMeta map[string]any
	if err := json.Unmarshal(math.Metadata, &mathMeta); err != nil || mathMeta["sectionKey"] != SectionMath {
		t.Fatalf("math default metadata = %s", string(math.Metadata))
	}
	for name, raw := range map[string]json.RawMessage{"stimulus": rw.Stimulus, "prompt": rw.Prompt, "answer": rw.Answer, "rationale": rw.Rationale} {
		var decoded map[string]any
		if err := json.Unmarshal(raw, &decoded); err != nil {
			t.Fatalf("default %s is not JSON: %v", name, err)
		}
	}
	var answer map[string]any
	if err := json.Unmarshal(rw.Answer, &answer); err != nil || answer["kind"] != "single_choice" {
		t.Fatalf("default answer = %s", string(rw.Answer))
	}
	options, _ := answer["options"].([]any)
	if len(options) != 4 {
		t.Fatalf("default answer options = %d, want 4", len(options))
	}
}

// QuestionDetail must serialize the nested shape the workspace binds:
// { examQuestionId, ..., question: { id, questionId, revision, state,
// questionType, stimulus, prompt, answer, rationale, metadata, accessibility } }.
// `answer` (not `answerDefinition`) matches AnswerDefinition on the wire.
func TestQuestionDetailSerializesNestedFrontendShape(t *testing.T) {
	detail := QuestionDetail{
		ExamQuestionID: "eq-1", ModuleID: "mod-1", ModuleKey: "rw-m1",
		SectionKey: SectionReadingWriting, DisplayOrder: 0,
		Question: QuestionRevisionDetail{
			ID: "rev-1", QuestionID: "q-1", SemanticRevision: 1, Revision: 3,
			State: "draft", QuestionType: "single_choice",
			Stimulus: json.RawMessage(`{}`), Prompt: json.RawMessage(`{}`),
			Answer:    json.RawMessage(`{"kind":"single_choice"}`),
			Rationale: json.RawMessage(`{}`), Metadata: json.RawMessage(`{}`),
			Accessibility: json.RawMessage(`{}`),
		},
	}
	encoded, err := json.Marshal(detail)
	if err != nil {
		t.Fatal(err)
	}
	var wire map[string]any
	if err := json.Unmarshal(encoded, &wire); err != nil {
		t.Fatal(err)
	}
	question, ok := wire["question"].(map[string]any)
	if !ok {
		t.Fatalf("detail missing nested question: %s", string(encoded))
	}
	for _, key := range []string{"id", "questionId", "revision", "state", "questionType", "answer", "accessibility"} {
		if _, ok := question[key]; !ok {
			t.Fatalf("nested question missing %q: %s", key, string(encoded))
		}
	}
	if _, ok := question["answerDefinition"]; ok {
		t.Fatalf("nested question must use `answer`, not `answerDefinition`: %s", string(encoded))
	}
	if question["revision"].(float64) != 3 {
		t.Fatalf("fencing revision lost: %s", string(encoded))
	}
}
