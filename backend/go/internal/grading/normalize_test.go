package grading

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type answerCleaningFixture struct {
	MatchPairs []struct {
		Name    string `json:"name"`
		Student string `json:"student"`
		Key     string `json:"key"`
		Match   bool   `json:"match"`
	} `json:"matchPairs"`
	CaseExactPairs []struct {
		Name     string `json:"name"`
		Student  string `json:"student"`
		Excluded string `json:"excluded"`
		Match    bool   `json:"match"`
	} `json:"caseExactPairs"`
	Idempotent []string `json:"idempotent"`
}

func loadAnswerCleaningFixture(t *testing.T) answerCleaningFixture {
	t.Helper()
	path := filepath.Join("..", "..", "..", "..", "testdata", "objective-grading-parity", "answer-cleaning.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read shared answer-cleaning fixture: %v", err)
	}
	var fixture answerCleaningFixture
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatalf("decode shared answer-cleaning fixture: %v", err)
	}
	if len(fixture.MatchPairs) == 0 {
		t.Fatal("shared answer-cleaning fixture has no match pairs")
	}
	return fixture
}

func TestAnswerCleaningSharedFixture(t *testing.T) {
	fixture := loadAnswerCleaningFixture(t)
	for _, pair := range fixture.MatchPairs {
		pair := pair
		t.Run(pair.Name, func(t *testing.T) {
			if got := answersMatch(pair.Student, pair.Key); got != pair.Match {
				t.Fatalf("answersMatch(%q, %q) = %v, want %v", pair.Student, pair.Key, got, pair.Match)
			}
		})
	}
	for _, pair := range fixture.CaseExactPairs {
		pair := pair
		t.Run(pair.Name, func(t *testing.T) {
			if got := answersMatchCaseExact(pair.Student, pair.Excluded); got != pair.Match {
				t.Fatalf("answersMatchCaseExact(%q, %q) = %v, want %v", pair.Student, pair.Excluded, got, pair.Match)
			}
		})
	}
	for _, value := range fixture.Idempotent {
		cleaned := normalizeAnswer(value)
		if again := normalizeAnswer(cleaned); again != cleaned {
			t.Fatalf("normalizeAnswer is not idempotent for %q: %q -> %q", value, cleaned, again)
		}
	}
}

func TestProjectionMatchesRavisaraInvisibleCharacter(t *testing.T) {
	// Regression: Ravisara's saved answer had a zero-width character after
	// "waiter". The sealed key is plain text and must still match.
	if !projectionAnswerMatches("waiter", []string{"waiter\u200b"}, false) {
		t.Fatal("projectionAnswerMatches rejected an answer differing only by an invisible character")
	}
	if !answersMatch("waiter", "waiter\u200b") {
		t.Fatal("answersMatch rejected an answer differing only by an invisible character")
	}
}

func FuzzAnswerCleaningIdempotentAndStable(f *testing.F) {
	fixture := answerCleaningFixture{}
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "testdata", "objective-grading-parity", "answer-cleaning.json"))
	if err == nil {
		_ = json.Unmarshal(raw, &fixture)
	}
	for _, pair := range fixture.MatchPairs {
		f.Add(pair.Student, pair.Key)
	}
	f.Add("Garden hall", "  GARDEN   HALL ")
	f.Add("waiter\u200b", "waiter")

	f.Fuzz(func(t *testing.T, student, key string) {
		cleaned := normalizeAnswer(student)
		if again := normalizeAnswer(cleaned); again != cleaned {
			t.Fatalf("normalizeAnswer not idempotent: %q -> %q -> %q", student, cleaned, again)
		}
		// Extra spaces and different case must not change the verdict.
		spaced := "  " + strings.Join(strings.Fields(student), "   ") + "  "
		if answersMatch(student, key) != answersMatch(spaced, key) {
			t.Fatalf("extra spaces changed match: %q vs %q against %q", student, spaced, key)
		}
		cased := strings.ToUpper(student)
		if answersMatch(student, key) != answersMatch(cased, key) {
			t.Fatalf("case changed match: %q vs %q against %q", student, cased, key)
		}
	})
}
