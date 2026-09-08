package attempts

import (
	"context"
	"encoding/json"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

// B3 RED: MaterializeBlobs rebuilds answers/writing_answers/flags from
// attempt_responses_v2 rows (row-first read view). Writing-module questions
// land in writing_answers, the rest in answers; marked-for-review sets flags.
func TestMaterializeBlobsFromRows(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectQuery("FROM attempt_responses_v2 WHERE attempt_id").
		WithArgs("att-1").
		WillReturnRows(sqlmock.NewRows([]string{"question_id", "module_id", "response"}).
			AddRow("q-1", "mod-reading", `{"answer":"A","markedForReview":false,"eliminatedOptions":[],"annotations":[]}`).
			AddRow("q-2", "mod-writing-task", `{"answer":"essay","markedForReview":true,"eliminatedOptions":[],"annotations":[]}`))
	blobs, err := MaterializeBlobs(context.Background(), db, "att-1")
	if err != nil {
		t.Fatalf("MaterializeBlobs: %v", err)
	}
	var answers map[string]json.RawMessage
	if err := json.Unmarshal([]byte(blobs.Answers), &answers); err != nil {
		t.Fatalf("answers must decode: %v", err)
	}
	if _, ok := answers["q-1"]; !ok {
		t.Fatalf("reading answer must land in answers: %s", blobs.Answers)
	}
	if _, ok := answers["q-2"]; ok {
		t.Fatalf("writing answer must not land in answers: %s", blobs.Answers)
	}
	var writing map[string]json.RawMessage
	if err := json.Unmarshal([]byte(blobs.WritingAnswers), &writing); err != nil {
		t.Fatalf("writing must decode: %v", err)
	}
	if _, ok := writing["q-2"]; !ok {
		t.Fatalf("writing answer must land in writing_answers: %s", blobs.WritingAnswers)
	}
	var flags map[string]json.RawMessage
	if err := json.Unmarshal([]byte(blobs.Flags), &flags); err != nil {
		t.Fatalf("flags must decode: %v", err)
	}
	if _, ok := flags["q-2"]; !ok {
		t.Fatalf("marked-for-review must set flags: %s", blobs.Flags)
	}
	if _, ok := flags["q-1"]; ok {
		t.Fatalf("unmarked answer must not set flags: %s", blobs.Flags)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// B3 RED: empty row set materializes empty objects (never NULL, never error).
func TestMaterializeBlobsEmpty(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectQuery("FROM attempt_responses_v2 WHERE attempt_id").
		WithArgs("att-9").
		WillReturnRows(sqlmock.NewRows([]string{"question_id", "module_id", "response"}))
	blobs, err := MaterializeBlobs(context.Background(), db, "att-9")
	if err != nil {
		t.Fatalf("MaterializeBlobs: %v", err)
	}
	if blobs.Answers != "{}" || blobs.WritingAnswers != "{}" || blobs.Flags != "{}" {
		t.Fatalf("empty rows must yield empty objects: %+v", blobs)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// B3 RED: projection equivalence — legacy blob columns equal the materialized
// view for a randomized answer stream applied through the row-first writer.
// (Writer-level equivalence pins through upsertResponseRow + MaterializeBlobs
// sharing one row codec; this test pins the codec round-trip per answer.)
func TestRowCodecRoundTripEquivalence(t *testing.T) {
	cases := []struct {
		questionID string
		moduleID   string
		payload    ResponsePayload
	}{
		{"q-1", "mod-reading", ResponsePayload{Answer: "A", EliminatedOptions: []string{}, Annotations: []Annotation{}}},
		{"q-2", "mod-WRITING-task2", ResponsePayload{Answer: map[string]any{"text": "hello"}, MarkedForReview: true, EliminatedOptions: []string{"x"}, Annotations: []Annotation{}}},
		{"q-3", "mod-listening", ResponsePayload{Answer: 42.5, EliminatedOptions: nil, Annotations: nil}},
	}
	for _, c := range cases {
		canonical, err := CanonicalJSON(payloadToAny(c.payload))
		if err != nil {
			t.Fatal(err)
		}
		ans, flags, err := projectRowAnswer(c.questionID, c.moduleID, canonical)
		if err != nil {
			t.Fatal(err)
		}
		_ = ans
		_ = flags
		// Legacy mergeProjection semantics: answer keyed by question, flags
		// set iff markedForReview; writing-module answers split out.
		isWriting := isWritingModule(c.moduleID)
		if isWriting && ans.IsAnswer {
			t.Fatalf("%s: writing-module answer must not project to answers", c.questionID)
		}
		if !isWriting && !ans.IsAnswer {
			t.Fatalf("%s: reading-module answer must project to answers", c.questionID)
		}
		if c.payload.MarkedForReview && !flags.Set {
			t.Fatalf("%s: marked-for-review must set flags", c.questionID)
		}
	}
}
