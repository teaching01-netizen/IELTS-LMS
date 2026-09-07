package delivery

import (
	"context"
	"encoding/json"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

func TestDeliveredQuestionsExcludeGradingSecrets(t *testing.T) {
	for _, answer := range []string{
		`{"kind":"single_choice","options":[{"id":"A","content":{"version":1,"nodes":[]}}],"correctOptionId":"A","internalNote":"secret"}`,
		`{"kind":"student_produced_response","acceptedResponses":["42"],"normalizeFraction":true,"normalizeDecimal":true,"numericTolerance":null,"internalNote":"secret"}`,
	} {
		t.Run(answer, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			mock.ExpectQuery("SELECT eq.id AS exam_question_id").WithArgs("mod-1").WillReturnRows(
				sqlmock.NewRows([]string{"id", "question_id", "display_order", "is_pretest", "question_type", "stimulus", "prompt", "answer", "metadata", "accessibility"}).
					AddRow("eq-1", "q-1", 0, false, "single_choice", `{}`, `{}`, answer, `{}`, `{}`))
			questions, err := deliverySvc(db).loadQuestions(context.Background(), "mod-1")
			if err != nil {
				t.Fatal(err)
			}
			var wire map[string]any
			if err := json.Unmarshal(questions[0].Answer, &wire); err != nil {
				t.Fatal(err)
			}
			for _, key := range []string{"correctOptionId", "acceptedResponses", "internalNote"} {
				if _, ok := wire[key]; ok {
					t.Errorf("student answer exposes %s", key)
				}
			}
			if wire["kind"] == "single_choice" && len(wire["options"].([]any)) != 1 {
				t.Fatal("choice options lost")
			}
			if wire["kind"] == "student_produced_response" && wire["normalizeFraction"] != true {
				t.Fatal("response normalization lost")
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}
