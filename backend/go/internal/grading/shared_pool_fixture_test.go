package grading

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

type sharedPoolFixtureBlank struct {
	CaseSensitive bool   `json:"caseSensitive"`
	Answer        string `json:"answer"`
}

type sharedPoolFixtureCase struct {
	ID               string                   `json:"id"`
	Pool             []string                 `json:"pool"`
	Blanks           []sharedPoolFixtureBlank `json:"blanks"`
	ExpectedPoolSize int                      `json:"expectedPoolSize"`
	Expected         []bool                   `json:"expected"`
}

// TestSharedPoolConsumptionContract pins the shared-pool rule the website must
// mirror: grading-equivalent de-duplication, one-shot consumption in blank
// order, and case-variant siblings staying independently consumable when the
// pool is strict.
func TestSharedPoolConsumptionContract(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "testdata", "objective-grading-parity", "shared-pool-consumption.json"))
	if err != nil {
		t.Fatalf("read shared pool fixture: %v", err)
	}
	var fixture struct {
		Cases []sharedPoolFixtureCase `json:"cases"`
	}
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatalf("decode shared pool fixture: %v", err)
	}
	if len(fixture.Cases) == 0 {
		t.Fatal("shared pool fixture is empty")
	}

	for _, testCase := range fixture.Cases {
		testCase := testCase
		t.Run(testCase.ID, func(t *testing.T) {
			poolValues := make([]any, len(testCase.Pool))
			for index, value := range testCase.Pool {
				poolValues[index] = value
			}
			question := map[string]any{"sharedAcceptedAnswers": poolValues}
			blanks := make([]any, 0, len(testCase.Blanks))
			for index, blank := range testCase.Blanks {
				blanks = append(blanks, map[string]any{
					"id":            fmt.Sprintf("b%d", index),
					"caseSensitive": blank.CaseSensitive,
				})
			}

			pool := sentenceAnswerPool(question, blanks)
			if len(pool) != testCase.ExpectedPoolSize {
				t.Fatalf("pool size = %d (%q), want %d", len(pool), pool, testCase.ExpectedPoolSize)
			}

			matcher := newAnswerPool(pool)
			if len(testCase.Expected) != len(testCase.Blanks) {
				t.Fatalf("fixture expected has %d verdicts for %d blanks", len(testCase.Expected), len(testCase.Blanks))
			}
			for index, blank := range testCase.Blanks {
				got := matcher.consume(blank.Answer, blank.CaseSensitive)
				if got != testCase.Expected[index] {
					t.Fatalf("blank %d (%q, caseSensitive=%v) = %v, want %v", index, blank.Answer, blank.CaseSensitive, got, testCase.Expected[index])
				}
			}
		})
	}
}
