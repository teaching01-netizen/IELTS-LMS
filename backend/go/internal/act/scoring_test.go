package act

import (
	"testing"
	"time"
)

func actContent() map[string]any {
	return map[string]any{"questions": []any{
		map[string]any{"questionId": "q1", "correctAnswer": "A"},
		map[string]any{"questionId": "q2", "correctAnswer": "B"},
		map[string]any{"questionId": "q3", "correctAnswer": "C"},
	}}
}

// Full marks: every answer equals the key.
func TestACTScienceFullMarks(t *testing.T) {
	score, err := ComputeScienceScore(map[string]any{}, actContent(), []Answer{
		{QuestionID: "q1", Answer: "A"},
		{QuestionID: "q2", Answer: "B"},
		{QuestionID: "q3", Answer: "C"},
	}, time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	if score.TotalScore != 3 || score.MaxScore != 3 || score.Percentage != 100 {
		t.Fatalf("full marks wrong: %+v", score)
	}
}

// Partial: one wrong, one unanswered (unanswered scores 0, never errors).
func TestACTSciencePartialAndMissing(t *testing.T) {
	score, err := ComputeScienceScore(map[string]any{}, actContent(), []Answer{
		{QuestionID: "q1", Answer: "A"},
		{QuestionID: "q2", Answer: "zzz"},
	}, time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	if score.TotalScore != 1 || score.MaxScore != 3 {
		t.Fatalf("partial wrong: %+v", score)
	}
}

// Case-insensitive single-token answers match (science convention).
func TestACTScienceCaseInsensitive(t *testing.T) {
	score, err := ComputeScienceScore(map[string]any{}, actContent(), []Answer{
		{QuestionID: "q1", Answer: "a"},
		{QuestionID: "q2", Answer: " b "},
		{QuestionID: "q3", Answer: "C"},
	}, time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	if score.TotalScore != 3 {
		t.Fatalf("case-insensitive match failed: %+v", score)
	}
}

// Weighted config scales per-question points deterministically.
func TestACTScienceWeights(t *testing.T) {
	cfg := map[string]any{"weights": []any{float64(2), float64(1), float64(3)}}
	score, err := ComputeScienceScore(cfg, actContent(), []Answer{
		{QuestionID: "q1", Answer: "A"},
		{QuestionID: "q2", Answer: "nope"},
		{QuestionID: "q3", Answer: "C"},
	}, time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	if score.TotalScore != 5 || score.MaxScore != 6 {
		t.Fatalf("weighted wrong: %+v", score)
	}
}

// Content with no scorable questions errors (never a silent zero).
func TestACTScienceEmptyContentErrors(t *testing.T) {
	if _, err := ComputeScienceScore(map[string]any{}, map[string]any{}, nil, time.Now().UTC()); err == nil {
		t.Fatal("empty content must error")
	}
}

// Alternate key shapes (question_id / correct_answer) resolve the same.
func TestACTScienceAlternateKeyShapes(t *testing.T) {
	content := map[string]any{"questions": []any{
		map[string]any{"question_id": "q1", "correct_answer": "A"},
	}}
	score, err := ComputeScienceScore(map[string]any{}, content, []Answer{{QuestionID: "q1", Answer: "A"}}, time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	if score.TotalScore != 1 || score.MaxScore != 1 {
		t.Fatalf("alternate shapes wrong: %+v", score)
	}
}
