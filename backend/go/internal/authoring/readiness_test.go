package authoring

import "testing"

func validPrompt() string {
	return `{"version":1,"nodes":[{"type":"paragraph","id":"p1","text":"Read the passage."}]}`
}

func validChoiceAnswer() string {
	return `{"kind":"single_choice","options":[{"id":"A","content":{"version":1,"nodes":[{"type":"paragraph","id":"a","text":"A"}]}},{"id":"B","content":{"version":1,"nodes":[{"type":"paragraph","id":"b","text":"B"}]}},{"id":"C","content":{"version":1,"nodes":[{"type":"paragraph","id":"c","text":"C"}]}},{"id":"D","content":{"version":1,"nodes":[{"type":"paragraph","id":"d","text":"D"}]}}],"correctOptionId":"A"}`
}

func validMetadata() string {
	return `{"sectionKey":"reading-writing","domain":"information-and-ideas","skill":"Inferences","difficulty":"medium","tags":["demo"]}`
}

func emptyContent() string {
	return `{"version":1,"nodes":[]}`
}

func TestValidateSATQuestionReturnsReadyForCompleteQuestion(t *testing.T) {
	issues := validateSATQuestion(SectionReadingWriting, "single_choice", `{}`, validPrompt(), validChoiceAnswer(), `{}`, validMetadata())
	if len(issues) != 0 {
		t.Fatalf("complete question returned validation issues: %+v", issues)
	}
}

func TestValidateSATQuestionFlagsIncompleteAndInvalidSeparately(t *testing.T) {
	incomplete := validateSATQuestion(SectionReadingWriting, "single_choice", `{}`, `{}`, `{"kind":"single_choice","options":[]}`, `{}`, `{}`)
	if !containsIssueCode(incomplete, "question.prompt.required") || !containsIssueCode(incomplete, "sat.choice.count") {
		t.Fatalf("expected required and choice-count issues, got %+v", incomplete)
	}

	invalid := validateSATQuestion(SectionReadingWriting, "student_produced_response", `{}`, validPrompt(), `{"kind":"student_produced_response","acceptedResponses":["1"]}`, `{}`, validMetadata())
	if !containsIssueCode(invalid, "sat.spr.math_only") || !containsIssueCode(invalid, "sat.rw.question_type") {
		t.Fatalf("expected provider-invalid issues, got %+v", invalid)
	}
}

func containsIssueCode(issues []ValidationIssue, code string) bool {
	for _, issue := range issues {
		if issue.Code == code {
			return true
		}
	}
	return false
}

func TestQuestionSummaryIncludesProviderReadinessAndPreview(t *testing.T) {
	row := questionValidationRow{
		examQuestionID: "eq-1", questionID: "q-1", revisionID: "qr-1", sectionKey: SectionReadingWriting,
		questionType: "single_choice", stimulus: emptyContent(), prompt: validPrompt(), answer: validChoiceAnswer(), rationale: emptyContent(), metadata: validMetadata(),
	}
	summary := row.summary()
	if summary.Readiness.Status != "ready" || summary.Readiness.BlockingIssueCount != 0 {
		t.Fatalf("unexpected readiness: %+v", summary.Readiness)
	}
	if summary.PromptPreview != "Read the passage." || summary.AnswerKeyPreview == nil || *summary.AnswerKeyPreview != "A" {
		t.Fatalf("unexpected summary previews: %+v", summary)
	}
	if summary.Domain == nil || *summary.Domain != "information-and-ideas" || summary.ContentComplexity != "plain" {
		t.Fatalf("unexpected summary metadata: %+v", summary)
	}
}
