package satpublish

import (
	"context"
	sqlmock "github.com/DATA-DOG/go-sqlmock"
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
		{
			// Model: verification/lean/sat-result Paper.duplicate_ids_double_circle (A-OPT).
			name: "duplicate choice id",
			question: Question{QuestionType: "single_choice", Prompt: content("Prompt"), Answer: `{"kind":"single_choice","options":[` +
				`{"id":"A","content":` + content("A") + `},{"id":"B","content":` + content("B") + `},` +
				`{"id":"B","content":` + content("C") + `},{"id":"D","content":` + content("D") + `}],"correctOptionId":"B"}`},
			wantCode: "sat.choice.id.duplicate",
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

func TestValidateQuestionSPRRequiresNumericAcceptedResponses(t *testing.T) {
	valid := ValidateQuestion(Question{
		QuestionType: "student_produced_response",
		Prompt:       content("Solve for x."),
		Answer:       `{"kind":"student_produced_response","acceptedResponses":["100/333"]}`,
	})
	if len(valid) != 0 {
		t.Fatalf("representable numeric accepted response should pass: %+v", valid)
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
			IsPretest:      index < 2,
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

// Student-produced response is Math-only: Reading & Writing must publish only
// multiple-choice questions, whatever path the draft was authored through.
func TestValidateModuleRestrictsStudentProducedResponseToMath(t *testing.T) {
	spr := Question{
		ExamQuestionID: "eq-spr",
		QuestionType:   "student_produced_response",
		Prompt:         content("Solve for x."),
		Answer:         `{"kind":"student_produced_response","acceptedResponses":["12"]}`,
		IsPretest:      true,
	}
	mcq := Question{
		ExamQuestionID: "eq-mcq",
		QuestionType:   "single_choice",
		Prompt:         content("Prompt"),
		Answer:         choiceAnswer("A", "A", "B", "C", "D"),
		IsPretest:      true,
	}
	module := func(section string, questions ...Question) Module {
		return Module{SectionKey: section, ModuleKey: section + "-m1", TargetQuestionCount: len(questions), Questions: questions}
	}

	issues := ValidateModule(module(SectionReadingWriting, mcq, spr))
	if len(issues) != 1 || issues[0].Code != "sat.rw.question_type" || issues[0].Path != "examQuestion:eq-spr:questionType" {
		t.Fatalf("RW SPR must be the only blocking issue, got %+v", issues)
	}
	if issues := ValidateModule(module(SectionMath, mcq, spr)); len(issues) != 0 {
		t.Fatalf("Math may mix multiple choice and SPR: %+v", issues)
	}
}

func TestValidateModuleRequiresExactlyTwoPretests(t *testing.T) {
	for _, count := range []int{0, 1, 2, 3} {
		questions := make([]Question, 4)
		for i := range questions {
			questions[i] = Question{ExamQuestionID: string(rune('a' + i)), QuestionType: "single_choice", Prompt: content("Prompt"), Answer: choiceAnswer("A", "A", "B", "C", "D"), IsPretest: i < count}
		}
		issues := ValidateModule(Module{SectionKey: SectionMath, ModuleKey: "math-m1", TargetQuestionCount: 4, Questions: questions})
		if hasCode(issues, "sat.module.pretest_count") != (count != 2) {
			t.Fatalf("pretest count %d: %+v", count, issues)
		}
	}
}

func TestValidateDraftRequiresAllThreeModulesInSelectedSection(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectQuery("sat_classroom_plan").WithArgs("draft").WillReturnRows(sqlmock.NewRows([]string{"plan"}).AddRow(nil))
	mock.ExpectQuery("SELECT s.section_key, m.module_key").WithArgs("draft", SectionReadingWriting).
		WillReturnRows(sqlmock.NewRows([]string{"section_key", "module_key", "title", "target", "id"}).AddRow(SectionReadingWriting, "rw-m1", "RW1", 2, "rw1"))
	mock.ExpectQuery("SELECT eq.id, r.question_type").WithArgs("rw1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "type", "prompt", "answer", "is_pretest"}).
			AddRow("q1", "single_choice", content("Prompt"), choiceAnswer("A", "A", "B", "C", "D"), true).
			AddRow("q2", "single_choice", content("Prompt"), choiceAnswer("A", "A", "B", "C", "D"), true))
	mock.ExpectQuery("assessment_scoring_policies").WithArgs("draft").WillReturnRows(sqlmock.NewRows([]string{"p"}))
	issues, err := ValidateDraftForScope(context.Background(), db, "draft", ScopeReadingWriting)
	if err != nil {
		t.Fatal(err)
	}
	if !hasCode(issues, "sat.module.missing") || len(issues) != 2 {
		t.Fatalf("missing adaptive modules were ignored: %+v", issues)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
