package grading

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

type fullCoverageFixture struct {
	Section   string                    `json:"section"`
	ExamState map[string]any            `json:"examState"`
	Answers   map[string]any            `json:"answers"`
	Keys      map[string]string         `json:"keys"`
	Overrides map[string]ParityOverride `json:"overrides"`
	VersionID string                    `json:"versionId"`
	Expected  struct {
		TotalScore float64 `json:"totalScore"`
		MaxScore   float64 `json:"maxScore"`
		Questions  []struct {
			QuestionID   string   `json:"questionId"`
			Correctness  *bool    `json:"correctness"`
			AwardedScore *float64 `json:"awardedScore"`
			MaxScore     *float64 `json:"maxScore"`
		} `json:"questions"`
	} `json:"expected"`
}

func loadFullCoverageFixture(t *testing.T) fullCoverageFixture {
	t.Helper()
	path := filepath.Join("..", "..", "..", "..", "testdata", "objective-grading-parity", "full-coverage-exam.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read full-coverage fixture: %v", err)
	}
	var fixture fullCoverageFixture
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatalf("decode full-coverage fixture: %v", err)
	}
	return fixture
}

func TestFullCoverageExamMatchesExpected(t *testing.T) {
	fixture := loadFullCoverageFixture(t)
	result := GradeContentForParity(ParityInput{
		Section: fixture.Section, Content: fixture.ExamState, Answers: fixture.Answers,
		Keys: fixture.Keys, Overrides: fixture.Overrides, VersionID: fixture.VersionID,
	})
	if result.TotalScore != fixture.Expected.TotalScore || result.MaxScore != fixture.Expected.MaxScore {
		t.Fatalf("totals = %v/%v, want %v/%v", result.TotalScore, result.MaxScore, fixture.Expected.TotalScore, fixture.Expected.MaxScore)
	}
	byID := map[string]ParityQuestionResult{}
	for _, question := range result.Questions {
		byID[question.QuestionID] = question
	}
	for _, expected := range fixture.Expected.Questions {
		question, ok := byID[expected.QuestionID]
		if !ok {
			t.Fatalf("expected question %q missing from Go results", expected.QuestionID)
		}
		if !equalOptionalBool(expected.Correctness, question.Correctness) {
			t.Fatalf("%s correctness = %v, want %v", expected.QuestionID, question.Correctness, expected.Correctness)
		}
		if !equalOptionalNumber(expected.AwardedScore, question.AwardedScore) {
			t.Fatalf("%s awarded = %v, want %v", expected.QuestionID, question.AwardedScore, expected.AwardedScore)
		}
		if !equalOptionalNumber(expected.MaxScore, question.MaxScore) {
			t.Fatalf("%s max = %v, want %v", expected.QuestionID, question.MaxScore, expected.MaxScore)
		}
	}
}

func TestFullCoverageFixtureCoversEveryKeySourceRow(t *testing.T) {
	fixture := loadFullCoverageFixture(t)
	reading, _ := fixture.ExamState["reading"].(map[string]any)
	passages, _ := reading["passages"].([]any)
	seen := map[string]bool{}
	var walkBlocks func(blocks []any)
	walkBlocks = func(blocks []any) {
		for _, raw := range blocks {
			block, _ := raw.(map[string]any)
			if block == nil {
				continue
			}
			if questionType, ok := block["type"].(string); ok {
				seen[questionType] = true
			}
			if children, ok := block["children"].([]any); ok {
				walkBlocks(children)
			}
			if tree, ok := block["answerTree"].([]any); ok {
				walkBlocks(tree)
			}
		}
	}
	for _, rawPassage := range passages {
		passage, _ := rawPassage.(map[string]any)
		blocks, _ := passage["blocks"].([]any)
		walkBlocks(blocks)
	}
	for _, required := range []string{
		"TFNG", "CLOZE", "MATCHING", "MAP", "SHORT_ANSWER", "SENTENCE_COMPLETION",
		"NOTE_COMPLETION", "DIAGRAM_LABELING", "FLOW_CHART", "TABLE_COMPLETION",
		"CLASSIFICATION", "MATCHING_FEATURES", "MULTI_MCQ", "SINGLE_MCQ",
	} {
		if !seen[required] {
			t.Fatalf("full-coverage exam is missing %s", required)
		}
	}
}
