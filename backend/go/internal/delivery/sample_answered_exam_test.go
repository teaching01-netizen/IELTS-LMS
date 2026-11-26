package delivery

import (
	"encoding/json"
	"strings"
	"testing"

	"example.com/ielts-proctoring/internal/satlearning"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestSampleViewUsesTheRealQuestionCounts(t *testing.T) {
	sections := []DeliverySection{
		{SectionKey: "reading-writing", Title: "Reading & Writing", Modules: []DeliveryModule{
			{ModuleKey: "rw-m1", Title: "Module 1", Questions: []DeliveredQuestion{
				{Metadata: json.RawMessage(`{"domain":"Information and Ideas"}`)},
				{Metadata: json.RawMessage(`{"domain":"Craft and Structure"}`)},
			}},
		}},
		{SectionKey: "math", Title: "Math", Modules: []DeliveryModule{
			{ModuleKey: "math-m1", Title: "Module 1", Questions: []DeliveredQuestion{
				{Metadata: json.RawMessage(`{"domain":"Algebra"}`)},
			}},
			{ModuleKey: "math-m2-lower", Title: "Module 2 — Lower"},
		}},
	}
	view := sampleViewFromSections(sections)
	var parsed struct {
		Layout            string `json:"layout"`
		ShowCombinedScore bool   `json:"showCombinedScore"`
		Notice            string `json:"notice"`
		PrimaryScore      struct {
			Kind    string `json:"kind"`
			Correct int    `json:"correct"`
			Total   int    `json:"total"`
		} `json:"primaryScore"`
		Subjects []struct {
			Key        string `json:"key"`
			RawCorrect int    `json:"rawCorrect"`
			RawTotal   int    `json:"rawTotal"`
			Domains    []struct {
				Name     string `json:"name"`
				Correct  int    `json:"correct"`
				Total    int    `json:"total"`
				Accuracy int    `json:"accuracy"`
			} `json:"domains"`
		} `json:"subjects"`
	}
	if err := json.Unmarshal(view, &parsed); err != nil {
		t.Fatal(err)
	}
	if parsed.Layout != "full-sat" || !parsed.ShowCombinedScore {
		t.Fatalf("two subjects must read as a full report: %+v", parsed)
	}
	if parsed.PrimaryScore.Kind != "raw" || parsed.PrimaryScore.Correct != 3 || parsed.PrimaryScore.Total != 3 {
		t.Fatalf("sample must be perfect over the real question count: %+v", parsed.PrimaryScore)
	}
	if len(parsed.Subjects) != 2 || parsed.Subjects[0].RawCorrect != 2 || parsed.Subjects[1].RawCorrect != 1 {
		t.Fatalf("subjects do not match the version: %+v", parsed.Subjects)
	}
	if len(parsed.Subjects[0].Domains) != 2 || parsed.Subjects[0].Domains[0].Accuracy != 100 {
		t.Fatalf("domains were not carried through: %+v", parsed.Subjects[0].Domains)
	}
	if !strings.Contains(parsed.Notice, "Sample report") {
		t.Fatalf("the report must identify itself as a sample: %q", parsed.Notice)
	}
}

func TestSampleAnswersUseTheCorrectResponse(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	answer := func(id string) string {
		return `{"kind":"single_choice","correctOptionId":"` + id + `","options":[` +
			`{"id":"A","content":{"version":1,"nodes":[{"type":"paragraph","id":"a","text":"Choice A"}]}},` +
			`{"id":"B","content":{"version":1,"nodes":[{"type":"paragraph","id":"b","text":"Choice B"}]}}]}`
	}
	mock.ExpectQuery("SELECT m.title").
		WithArgs("v1").
		WillReturnRows(sqlmock.NewRows([]string{"title", "order", "id", "answer"}).
			AddRow("Module 1", 0, "eq-1", answer("B")).
			AddRow("Module 1", 1, "eq-2", `{"kind":"student_produced_response","acceptedResponses":["12"]}`))

	service := &Service{db: db}
	answers, err := service.sampleAnswers(t.Context(), "v1")
	if err != nil {
		t.Fatal(err)
	}
	if got := string(answers["eq-1"].response); got != `"B"` {
		t.Fatalf("choice response = %s", got)
	}
	if len(answers["eq-1"].key) != 1 || answers["eq-1"].key[0].Label != "B" || answers["eq-1"].key[0].Text != "Choice B" {
		t.Fatalf("choice key = %+v", answers["eq-1"].key)
	}
	if got := string(answers["eq-2"].response); got != `"12"` {
		t.Fatalf("numeric response = %s", got)
	}
	if len(answers["eq-2"].key) != 1 || answers["eq-2"].key[0].Text != "12" {
		t.Fatalf("numeric key = %+v", answers["eq-2"].key)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestSampleAnswersRefuseAQuestionWithoutAKey(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectQuery("SELECT m.title").
		WithArgs("v1").
		WillReturnRows(sqlmock.NewRows([]string{"title", "order", "id", "answer"}).
			AddRow("Module 1", 0, "eq-1", `{"kind":"single_choice"}`))

	service := &Service{db: db}
	if _, err := service.sampleAnswers(t.Context(), "v1"); err == nil {
		t.Fatal("a question without a correct answer must refuse the sample")
	} else if !strings.Contains(err.Error(), "Module 1, question 1") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestBuildSampleAnsweredExamUsesTheRealPaper(t *testing.T) {
	sections := []DeliverySection{
		{SectionKey: "reading-writing", Title: "Reading & Writing", Modules: []DeliveryModule{
			{ID: "mod-1", ModuleKey: "rw-m1", Title: "Module 1", Questions: []DeliveredQuestion{
				{ExamQuestionID: "eq-1", DisplayOrder: 0, Metadata: json.RawMessage(`{"domain":"information-and-ideas"}`)},
				{ExamQuestionID: "eq-2", DisplayOrder: 1, Metadata: json.RawMessage(`{"domain":"craft-and-structure"}`)},
			}},
		}},
		{SectionKey: "math", Title: "Math", Modules: []DeliveryModule{
			{ID: "mod-2", ModuleKey: "math-m1", Title: "Module 1", Questions: []DeliveredQuestion{
				{ExamQuestionID: "eq-3", DisplayOrder: 0, Metadata: json.RawMessage(`{"domain":"algebra"}`)},
			}},
		}},
	}
	answers := map[string]sampleAnswer{
		"eq-1": {key: []satlearning.AnswerKeyAnswer{{Label: "B", Text: "Choice B"}}, response: json.RawMessage(`"B"`)},
		"eq-2": {key: []satlearning.AnswerKeyAnswer{{Label: "A", Text: "Choice A"}}, response: json.RawMessage(`"A"`)},
		"eq-3": {key: []satlearning.AnswerKeyAnswer{{Label: "", Text: "12"}}, response: json.RawMessage(`"12"`)},
	}
	exam, view, err := buildSampleAnsweredExam("v1", "exam-1", "Practice", "Sample Student", sections, answers)
	if err != nil {
		t.Fatal(err)
	}
	if exam.ExamID != "exam-1" || exam.ExamTitle != "Practice" || exam.CandidateName != "Sample Student" || exam.VersionID != "v1" {
		t.Fatalf("identity is incomplete: %+v", exam)
	}
	if len(exam.Attempt.ModuleAttempts) != 2 || len(exam.Attempt.Responses) != 3 || len(exam.AnswerKey.Entries) != 3 {
		t.Fatalf("paper rows are incomplete: attempts=%d responses=%d key=%d",
			len(exam.Attempt.ModuleAttempts), len(exam.Attempt.Responses), len(exam.AnswerKey.Entries))
	}
	if exam.AnswerKey.Entries[0].Result != "correct" || string(exam.Attempt.Responses[0].Response) != `"B"` {
		t.Fatalf("first answer is not all-correct: %+v %s", exam.AnswerKey.Entries[0], exam.Attempt.Responses[0].Response)
	}
	var parsed struct {
		PrimaryScore struct {
			Correct int `json:"correct"`
			Total   int `json:"total"`
		} `json:"primaryScore"`
	}
	if err := json.Unmarshal(view, &parsed); err != nil {
		t.Fatal(err)
	}
	if parsed.PrimaryScore.Correct != 3 || parsed.PrimaryScore.Total != 3 {
		t.Fatalf("sample view must count the real paper: %+v", parsed.PrimaryScore)
	}

	if _, _, err := buildSampleAnsweredExam("v1", "exam-1", "Practice", "Sample Student", sections, map[string]sampleAnswer{}); err == nil {
		t.Fatal("a question without a prepared answer must refuse the sample")
	} else if !strings.Contains(err.Error(), "Module 1, question 1") {
		t.Fatalf("unexpected error: %v", err)
	}
}
