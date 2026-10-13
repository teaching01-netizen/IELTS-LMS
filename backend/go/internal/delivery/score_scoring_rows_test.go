package delivery

import (
	"database/sql"
	"testing"
)

// Model: verification/lean/sat-result (Scoring.score_raw, Scoring.score_op,
// Scoring.score_pretest_irrelevant): pretest rows never count toward either
// total, and raw never exceeds operational.
func TestScoreScoringRowsSkipsPretest(t *testing.T) {
	def := sql.NullString{String: `{"kind":"single_choice","correctOptionId":"o1"}`, Valid: true}
	right := sql.NullString{String: `"o1"`, Valid: true}
	wrong := sql.NullString{String: `"o2"`, Valid: true}
	rows := []scoringRow{
		{examQuestionID: "pretest-right", isPretest: true, answerDefinition: def, response: right},
		{examQuestionID: "pretest-wrong", isPretest: true, answerDefinition: def, response: wrong},
		{examQuestionID: "op-right", answerDefinition: def, response: right},
		{examQuestionID: "op-wrong", answerDefinition: def, response: wrong},
		{examQuestionID: "op-unanswered", answerDefinition: def},
	}
	raw, op := scoreScoringRows(rows)
	if raw != 1 || op != 3 {
		t.Fatalf("scoreScoringRows = (%d, %d), want (1, 3)", raw, op)
	}
	if raw2, op2 := scoreScoringRows(rows[2:]); raw2 != raw || op2 != op {
		t.Fatalf("dropping pretest rows changed the score: (%d, %d) vs (%d, %d)", raw2, op2, raw, op)
	}
}
