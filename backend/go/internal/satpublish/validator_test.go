package satpublish

import (
	"context"
	"fmt"
	sqlmock "github.com/DATA-DOG/go-sqlmock"
	"strconv"
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
	}
	mcq := Question{
		ExamQuestionID: "eq-mcq",
		QuestionType:   "single_choice",
		Prompt:         content("Prompt"),
		Answer:         choiceAnswer("A", "A", "B", "C", "D"),
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

// Full-size modules publish without any pretest designation.
func TestValidateModuleFullSizeWithoutPretests(t *testing.T) {
	for section, count := range map[string]int{SectionReadingWriting: 27, SectionMath: 22} {
		questions := make([]Question, count)
		for i := range questions {
			questions[i] = Question{ExamQuestionID: strconv.Itoa(i), QuestionType: "single_choice", Prompt: content("Prompt"), Answer: choiceAnswer("A", "A", "B", "C", "D")}
		}
		if issues := ValidateModule(Module{SectionKey: section, ModuleKey: section + "-m1", TargetQuestionCount: count, Questions: questions}); len(issues) != 0 {
			t.Fatalf("%s full module: %+v", section, issues)
		}
	}
}

// Every question counts toward the converter's operational total.
func TestValidateDraftCountsEveryQuestionAsOperational(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectQuery("sat_classroom_plan").WithArgs("draft").WillReturnRows(sqlmock.NewRows([]string{"plan"}).AddRow(`{"math":"m2_hard"}`))
	mock.ExpectQuery("sat_flexible_count").WithArgs("draft").WillReturnRows(sqlmock.NewRows([]string{"sat_flexible_count"}).AddRow(int64(0)))
	mock.ExpectQuery("SELECT s.section_key, m.module_key").WithArgs("draft", SectionMath).
		WillReturnRows(sqlmock.NewRows([]string{"section_key", "module_key", "title", "target", "id"}).AddRow(SectionMath, "math-m2-higher", "Hard", 2, "mh"))
	mock.ExpectQuery("SELECT eq.id, r.question_type").WithArgs("mh").
		WillReturnRows(sqlmock.NewRows([]string{"id", "type", "prompt", "answer"}).
			AddRow("q1", "single_choice", content("Prompt"), choiceAnswer("A", "A", "B", "C", "D")).
			AddRow("q2", "single_choice", content("Prompt"), choiceAnswer("A", "A", "B", "C", "D")))
	policy := converterJSON(t, map[string]map[string]string{"math": {"m2_higher_only": "s"}}, map[string]int{"s": 2})
	mock.ExpectQuery("assessment_scoring_policies").WithArgs("draft").WillReturnRows(sqlmock.NewRows([]string{"policy_key", "policy_config"}).AddRow("estimated_sat", policy))
	mock.ExpectQuery("config_snapshot").WithArgs("draft").WillReturnRows(sqlmock.NewRows([]string{"c"}).AddRow(`{}`))
	issues, err := ValidateDraftForScope(context.Background(), db, "draft", ScopeMath)
	if err != nil {
		t.Fatal(err)
	}
	if len(issues) != 0 {
		t.Fatalf("a 2-question table must cover a 2-question module: %+v", issues)
	}
}

func TestValidateDraftRequiresAllThreeModulesInSelectedSection(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectQuery("sat_classroom_plan").WithArgs("draft").WillReturnRows(sqlmock.NewRows([]string{"plan"}).AddRow(nil))
	mock.ExpectQuery("sat_flexible_count").WithArgs("draft").WillReturnRows(sqlmock.NewRows([]string{"sat_flexible_count"}).AddRow(int64(0)))
	mock.ExpectQuery("SELECT s.section_key, m.module_key").WithArgs("draft", SectionReadingWriting).
		WillReturnRows(sqlmock.NewRows([]string{"section_key", "module_key", "title", "target", "id"}).AddRow(SectionReadingWriting, "rw-m1", "RW1", 2, "rw1"))
	mock.ExpectQuery("SELECT eq.id, r.question_type").WithArgs("rw1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "type", "prompt", "answer"}).
			AddRow("q1", "single_choice", content("Prompt"), choiceAnswer("A", "A", "B", "C", "D")).
			AddRow("q2", "single_choice", content("Prompt"), choiceAnswer("A", "A", "B", "C", "D")))
	mock.ExpectQuery("assessment_scoring_policies").WithArgs("draft").WillReturnRows(sqlmock.NewRows([]string{"policy_key", "policy_config"}))
	mock.ExpectQuery("config_snapshot").WithArgs("draft").WillReturnRows(sqlmock.NewRows([]string{"c"}).AddRow(`{}`))
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

func TestValidateModuleFlexible(t *testing.T) {
	mk := func(n, target int) Module {
		qs := make([]Question, n)
		for i := range qs {
			qs[i] = Question{ExamQuestionID: strconv.Itoa(i), QuestionType: "single_choice", Prompt: content("Prompt"), Answer: choiceAnswer("A", "A", "B", "C", "D")}
		}
		return Module{SectionKey: SectionMath, ModuleKey: "math-m1", Title: "Math Module 1", TargetQuestionCount: target, Questions: qs}
	}
	if issues := ValidateModuleFlexible(mk(0, 22)); !hasCode(issues, "sat.module.empty") {
		t.Fatalf("empty flexible module must block: %+v", issues)
	} else {
		for _, is := range issues {
			if is.Code == "sat.module.empty" && !is.Blocking {
				t.Fatalf("sat.module.empty must block: %+v", issues)
			}
		}
	}
	issues := ValidateModuleFlexible(mk(10, 22))
	if !hasCode(issues, "sat.module.flexible_note") {
		t.Fatalf("partial flexible module must note: %+v", issues)
	}
	for _, is := range issues {
		if is.Blocking {
			t.Fatalf("partial flexible module must not block: %+v", issues)
		}
	}
	if issues := ValidateModuleFlexible(mk(22, 22)); len(issues) != 0 {
		t.Fatalf("full flexible module must pass clean: %+v", issues)
	}
	if issues := ValidateModuleFlexible(mk(23, 22)); !hasCode(issues, "sat.module.incomplete") {
		t.Fatalf("over-target flexible module must block: %+v", issues)
	}
}

// FR-1 publish gate matrix (BUG-001): a flexible full-shape draft with N=10
// authored Module 1 questions publishes iff threshold <= 10. Strict drafts,
// m1_only, and m2-only shapes never raise the gate.
func TestValidateDraftThresholdGateMatrix(t *testing.T) {
	questionRows := func(n int) *sqlmock.Rows {
		rows := sqlmock.NewRows([]string{"id", "type", "prompt", "answer"})
		for i := 0; i < n; i++ {
			rows.AddRow("q"+strconv.Itoa(i), "single_choice", content("Prompt"), choiceAnswer("A", "A", "B", "C", "D"))
		}
		return rows
	}
	for _, tc := range []struct {
		threshold int
		blocked   bool
	}{
		{1, false},
		{10, false},
		{11, true},
		{13, true},
		{27, true},
	} {
		t.Run(fmt.Sprintf("threshold_%d", tc.threshold), func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			mock.ExpectQuery("sat_classroom_plan").WithArgs("draft").WillReturnRows(sqlmock.NewRows([]string{"plan"}).AddRow(nil))
			mock.ExpectQuery("sat_flexible_count").WithArgs("draft").WillReturnRows(sqlmock.NewRows([]string{"sat_flexible_count"}).AddRow(int64(1)))
			mock.ExpectQuery("SELECT s.section_key, m.module_key").WithArgs("draft", SectionMath).
				WillReturnRows(sqlmock.NewRows([]string{"section_key", "module_key", "title", "target", "id"}).
					AddRow(SectionMath, "math-m1", "Module 1", 27, "m1").
					AddRow(SectionMath, "math-m2-lower", "Lower", 27, "ml").
					AddRow(SectionMath, "math-m2-higher", "Higher", 27, "mh"))
			mock.ExpectQuery("SELECT eq.id, r.question_type").WithArgs("m1").WillReturnRows(questionRows(10))
			mock.ExpectQuery("SELECT eq.id, r.question_type").WithArgs("ml").WillReturnRows(questionRows(1))
			mock.ExpectQuery("SELECT eq.id, r.question_type").WithArgs("mh").WillReturnRows(questionRows(1))
			mock.ExpectQuery("assessment_routing_policies").WithArgs("draft").
				WillReturnRows(sqlmock.NewRows([]string{"section_key", "policy_config"}).
					AddRow(SectionMath, fmt.Sprintf(`{"minimumCorrectForHigher":%d}`, tc.threshold)))
			mock.ExpectQuery("assessment_scoring_policies").WithArgs("draft").WillReturnRows(sqlmock.NewRows([]string{"policy_key", "policy_config"}))
			mock.ExpectQuery("config_snapshot").WithArgs("draft").WillReturnRows(sqlmock.NewRows([]string{"c"}).AddRow(`{}`))
			issues, err := ValidateDraftForScope(context.Background(), db, "draft", ScopeMath)
			if err != nil {
				t.Fatal(err)
			}
			if !tc.blocked {
				for _, is := range issues {
					if is.Blocking {
						t.Fatalf("threshold %d with N=10 must pass, got blocking %+v (all %+v)", tc.threshold, is, issues)
					}
				}
			} else {
				found := false
				for _, is := range issues {
					if is.Code != "sat.threshold.unreachable" {
						continue
					}
					found = true
					if !is.Blocking {
						t.Fatalf("sat.threshold.unreachable must block: %+v", is)
					}
					if is.Path != SectionMath+".minimumCorrectForHigher" {
						t.Fatalf("wrong issue path: %+v", is)
					}
					if !strings.Contains(is.Message, strconv.Itoa(tc.threshold)) || !strings.Contains(is.Message, "10") || !strings.Contains(is.Message, SectionMath) {
						t.Fatalf("message must name section, threshold, and authored N: %+v", is)
					}
				}
				if !found {
					t.Fatalf("threshold %d with N=10 must be refused, got %+v", tc.threshold, issues)
				}
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

// The gate is M1-based only: strict drafts keep their blueprint-max bound,
// and m1_only / m2-only shapes never raise it (their threshold row, if any,
// is unused at close). None of these issue the routing read.
func TestValidateDraftThresholdGateSkipsNonM1Shapes(t *testing.T) {
	cases := []struct {
		name     string
		plan     any
		flexible int64
		modKey   string
		modID    string
	}{
		{"strict_full_shape", nil, 0, "math-m1", "m1"},
		{"flexible_m1_only", `{"math":"m1_only"}`, 1, "math-m1", "m1"},
		{"flexible_m2_only", `{"math":"m2_easy"}`, 1, "math-m2-lower", "ml"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			mock.ExpectQuery("sat_classroom_plan").WithArgs("draft").WillReturnRows(sqlmock.NewRows([]string{"plan"}).AddRow(tc.plan))
			mock.ExpectQuery("sat_flexible_count").WithArgs("draft").WillReturnRows(sqlmock.NewRows([]string{"sat_flexible_count"}).AddRow(tc.flexible))
			mock.ExpectQuery("SELECT s.section_key, m.module_key").WithArgs("draft", SectionMath).
				WillReturnRows(sqlmock.NewRows([]string{"section_key", "module_key", "title", "target", "id"}).
					AddRow(SectionMath, tc.modKey, "Module", 27, tc.modID))
			rows := sqlmock.NewRows([]string{"id", "type", "prompt", "answer"})
			for i := 0; i < 10; i++ {
				rows.AddRow("q"+strconv.Itoa(i), "single_choice", content("Prompt"), choiceAnswer("A", "A", "B", "C", "D"))
			}
			mock.ExpectQuery("SELECT eq.id, r.question_type").WithArgs(tc.modID).WillReturnRows(rows)
			// No assessment_routing_policies expectation: the gate must not read it.
			mock.ExpectQuery("assessment_scoring_policies").WithArgs("draft").WillReturnRows(sqlmock.NewRows([]string{"policy_key", "policy_config"}))
			mock.ExpectQuery("config_snapshot").WithArgs("draft").WillReturnRows(sqlmock.NewRows([]string{"c"}).AddRow(`{}`))
			issues, err := ValidateDraftForScope(context.Background(), db, "draft", ScopeMath)
			if err != nil {
				t.Fatal(err)
			}
			if hasCode(issues, "sat.threshold.unreachable") {
				t.Fatalf("%s must not raise the threshold gate, got %+v", tc.name, issues)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

// Flexible M1-only drafts publish with a partial base module, no M2 gate, and
// no converter requirement (raw-score report).
func TestValidateDraftFlexibleM1Only(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectQuery("sat_classroom_plan").WithArgs("draft").WillReturnRows(sqlmock.NewRows([]string{"plan"}).AddRow(`{"math":"m1_only"}`))
	mock.ExpectQuery("sat_flexible_count").WithArgs("draft").WillReturnRows(sqlmock.NewRows([]string{"sat_flexible_count"}).AddRow(int64(1)))
	mock.ExpectQuery("SELECT s.section_key, m.module_key").WithArgs("draft", SectionMath).
		WillReturnRows(sqlmock.NewRows([]string{"section_key", "module_key", "title", "target", "id"}).
			AddRow(SectionMath, "math-m1", "Module 1", 22, "m1").
			AddRow(SectionMath, "math-m2-lower", "Lower", 22, "ml").
			AddRow(SectionMath, "math-m2-higher", "Higher", 22, "mh"))
	mock.ExpectQuery("SELECT eq.id, r.question_type").WithArgs("m1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "type", "prompt", "answer"}).
			AddRow("q1", "single_choice", content("Prompt"), choiceAnswer("A", "A", "B", "C", "D")))
	mock.ExpectQuery("assessment_scoring_policies").WithArgs("draft").WillReturnRows(sqlmock.NewRows([]string{"policy_key", "policy_config"}))
	mock.ExpectQuery("config_snapshot").WithArgs("draft").WillReturnRows(sqlmock.NewRows([]string{"c"}).AddRow(`{}`))
	issues, err := ValidateDraftForScope(context.Background(), db, "draft", ScopeMath)
	if err != nil {
		t.Fatal(err)
	}
	if !hasCode(issues, "sat.module.flexible_note") {
		t.Fatalf("partial flexible base must note: %+v", issues)
	}
	for _, is := range issues {
		if is.Blocking {
			t.Fatalf("flexible M1-only draft must not block: %+v", issues)
		}
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
