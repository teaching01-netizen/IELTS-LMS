package answerblobs

import (
	"encoding/json"
	"testing"
)

func TestAssembleSkipsFlagOnlyNullAnswer(t *testing.T) {
	// Flagging a slot (e.g. "blk:feat-x") stores {"answer":null,
	// "markedForReview":true} alongside the real array answer ("blk":
	// [...]). The null must not become an answers entry, otherwise it
	// shadows the array during projection and the slot grades as
	// unanswered while the answer is intact.
	blobs, err := Assemble([]Cell{
		{QuestionID: "blk-1", ModuleID: "mod-reading", Canonical: json.RawMessage(`{"answer":["A. hand collecting","B. using bait"],"markedForReview":false}`)},
		{QuestionID: "blk-1:feat-x", ModuleID: "mod-reading", Canonical: json.RawMessage(`{"answer":null,"markedForReview":true}`)},
	})
	if err != nil {
		t.Fatal(err)
	}
	if blobs.Answers != `{"blk-1":["A. hand collecting","B. using bait"]}` {
		t.Fatalf("flag-only null must not create an answers entry, got %s", blobs.Answers)
	}
	if blobs.Flags != `{"blk-1:feat-x":true}` {
		t.Fatalf("flag must still be recorded, got %s", blobs.Flags)
	}
}
