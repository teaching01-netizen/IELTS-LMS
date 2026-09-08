package answerblobs

import (
	"encoding/json"
	"testing"
)

// Leaf codec: writing-module split, flags, empty triple, malformed fallback.
func TestAssembleSplitAndFlags(t *testing.T) {
	blobs, err := Assemble([]Cell{
		{QuestionID: "q-1", ModuleID: "mod-reading", Canonical: json.RawMessage(`{"answer":"A","markedForReview":false}`)},
		{QuestionID: "q-2", ModuleID: "mod-Writing-task", Canonical: json.RawMessage(`{"answer":{"text":"hi"},"markedForReview":true}`)},
	})
	if err != nil {
		t.Fatal(err)
	}
	if blobs.Answers != `{"q-1":"A"}` {
		t.Fatalf("answers = %s", blobs.Answers)
	}
	if blobs.WritingAnswers != `{"q-2":{"text":"hi"}}` {
		t.Fatalf("writing = %s", blobs.WritingAnswers)
	}
	if blobs.Flags != `{"q-2":true}` {
		t.Fatalf("flags = %s", blobs.Flags)
	}
}

func TestAssembleEmpty(t *testing.T) {
	blobs, err := Assemble(nil)
	if err != nil {
		t.Fatal(err)
	}
	if blobs.Answers != "{}" || blobs.WritingAnswers != "{}" || blobs.Flags != "{}" {
		t.Fatalf("empty must yield empty triple: %+v", blobs)
	}
}

func TestProjectMalformedFallback(t *testing.T) {
	ans, flag := Project("mod-reading", json.RawMessage(`not-json`))
	if !ans.IsAnswer || string(ans.Value) != `not-json` {
		t.Fatalf("malformed reading cell must fall back to raw answer: %+v", ans)
	}
	if flag.Set {
		t.Fatalf("malformed cell must not set flags")
	}
	wans, _ := Project("mod-writing", json.RawMessage(`not-json`))
	if wans.IsAnswer {
		t.Fatalf("malformed writing cell must split to writing: %+v", wans)
	}
}
