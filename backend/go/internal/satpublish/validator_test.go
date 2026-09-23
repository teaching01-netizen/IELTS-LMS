package satpublish

import (
	"strings"
	"testing"
)

func content(text string) string {
	return `{"version":1,"nodes":[{"type":"paragraph","text":"` + text + `"}]}`
}

func choiceAnswer(correct string, optionContent ...string) string {
	options := make([]string, 0, len(optionContent))
	for index, text := range optionContent {
		options = append(options, `{"id":"`+string(rune('A'+index))+`","content":`+content(text)+`}`)
	}
	return `{"kind":"single_choice","options":[` + strings.Join(options, ",") + `],"correctOptionId":"` + correct + `"}`
}

func hasCode(issues []Issue, code string) bool {
	for _, issue := range issues {
		if issue.Code == code {
			return true
		}
	}
	return false
}

func TestValidateQuestionUsesOnlySATPublishRules(t *testing.T) {
	issues := ValidateQuestion(Question{
		ExamQuestionID: "eq-1",
		QuestionType:   "single_choice",
		Prompt:         content("Prompt"),
		Answer:         choiceAnswer("A", "A", "B", "C", "D"),
	})
	if len(issues) != 0 {
		t.Fatalf("complete question returned issues: %+v", issues)
	}
}

func TestValidateQuestionFlagsEachRequiredChoiceAndAnswerRule(t *testing.T) {
	tests := []struct {
		name     string
		question Question
		wantCode string
	}{
		{
			name:     "empty prompt",
			question: Question{QuestionType: "single_choice", Prompt: content("   "), Answer: choiceAnswer("A", "A", "B", "C", "D")},
			wantCode: "question.prompt.required",
		},
		{
			name:     "choice count",
			question: Question{QuestionType: "single_choice", Prompt: content("Prompt"), Answer: choiceAnswer("A", "A", "B", "C")},
			wantCode: "sat.choice.count",
		},
		{
			name:     "choice content",
			question: Question{QuestionType: "single_choice", Prompt: content("Prompt"), Answer: choiceAnswer("A", "A", " ", "C", "D")},
			wantCode: "sat.choice.content.required",
		},
		{
			name:     "missing correct answer",
			question: Question{QuestionType: "single_choice", Prompt: content("Prompt"), Answer: choiceAnswer("", "A", "B", "C", "D")},
			wantCode: "sat.correct_answer.required",
		},
		{
			name:     "invalid correct answer",
			question: Question{QuestionType: "single_choice", Prompt: content("Prompt"), Answer: choiceAnswer("E", "A", "B", "C", "D")},
			wantCode: "sat.correct_answer.invalid",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if !hasCode(ValidateQuestion(test.question), test.wantCode) {
				t.Fatalf("expected %s, got %+v", test.wantCode, ValidateQuestion(test.question))
			}
		})
	}
}

func TestValidateQuestionSPRRequiresOnlyAnAcceptedResponse(t *testing.T) {
	valid := ValidateQuestion(Question{
		QuestionType: "student_produced_response",
		Prompt:       content("Solve for x."),
		Answer:       `{"kind":"student_produced_response","acceptedResponses":["not a SAT numeric response"]}`,
	})
	if len(valid) != 0 {
		t.Fatalf("non-empty accepted response should pass: %+v", valid)
	}
	missing := ValidateQuestion(Question{
		QuestionType: "student_produced_response",
		Prompt:       content("Solve for x."),
		Answer:       `{"kind":"student_produced_response","acceptedResponses":[]}`,
	})
	if !hasCode(missing, "sat.spr.answer.required") {
		t.Fatalf("expected SPR answer requirement, got %+v", missing)
	}
}

func TestValidateModuleUsesConfiguredTarget(t *testing.T) {
	questions := make([]Question, 20)
	for index := range questions {
		questions[index] = Question{
			ExamQuestionID: string(rune('a' + index)),
			QuestionType:   "single_choice",
			Prompt:         content("Prompt"),
			Answer:         choiceAnswer("A", "A", "B", "C", "D"),
		}
	}
	if issues := ValidateModule(Module{SectionKey: "math", ModuleKey: "math-m1", Title: "Math Module", TargetQuestionCount: 20, Questions: questions}); len(issues) != 0 {
		t.Fatalf("configured target 20 should pass with 20 questions: %+v", issues)
	}
	issues := ValidateModule(Module{SectionKey: "math", ModuleKey: "math-m1", Title: "Math Module", TargetQuestionCount: 20, Questions: questions[:19]})
	if len(issues) != 1 || issues[0].Code != "sat.module.incomplete" {
		t.Fatalf("expected only module incompleteness, got %+v", issues)
	}
}
