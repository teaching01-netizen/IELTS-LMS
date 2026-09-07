package attempts

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestSATEnvelopeRejectsMalformedAnchorsAndOversizeNotes(t *testing.T) {
	valid := SATTextAnnotation{ID: "a1", Kind: "highlight", Anchor: SATTextAnchor{NodeID: "p1", StartOffset: 0, EndOffset: 4, Exact: "text"}, CreatedAt: "2026-09-06T00:00:00Z", UpdatedAt: "2026-09-06T00:00:00Z"}
	cases := map[string]func(*Annotation){
		"unknown version": func(a *Annotation) { a.Version = 3 },
		"empty node":      func(a *Annotation) { a.Annotations[0].Anchor.NodeID = "" },
		"negative offset": func(a *Annotation) { a.Annotations[0].Anchor.StartOffset = -1 },
		"empty range":     func(a *Annotation) { a.Annotations[0].Anchor.EndOffset = 0 },
		"unknown kind":    func(a *Annotation) { a.Annotations[0].Kind = "script" },
		"oversize note":   func(a *Annotation) { a.Annotations[0].Note = strings.Repeat("x", 2001) },
		"duplicate id":    func(a *Annotation) { a.Annotations = append(a.Annotations, valid) },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			a := Annotation{ID: "sat-annotations", Kind: "sat_annotations", Version: 2, Annotations: []SATTextAnnotation{valid}}
			mutate(&a)
			if err := ValidatePayload(ResponsePayload{Annotations: []Annotation{a}}); err == nil {
				t.Fatal("malformed SAT annotation accepted")
			}
		})
	}
}

func TestSATAnchoredNoteSurvivesCanonicalResponse(t *testing.T) {
	raw := `{"answer":"A","markedForReview":false,"eliminatedOptions":[],"annotations":[{"id":"sat-annotations","kind":"sat_annotations","version":2,"legacyQuestionNote":"earlier note","annotations":[{"id":"a1","kind":"highlight","anchor":{"nodeId":"stimulus:p1","startOffset":4,"endOffset":12,"exact":"evidence","prefix":"The ","suffix":" shows"},"note":"Compare claim","createdAt":"2026-09-06T00:00:00Z","updatedAt":"2026-09-06T00:00:00Z"}]}]}`
	var payload ResponsePayload
	if err := json.Unmarshal([]byte(raw), &payload); err != nil {
		t.Fatal(err)
	}
	if err := ValidatePayload(payload); err != nil {
		t.Fatal(err)
	}
	canonical, err := CanonicalJSON(payloadToAny(payload))
	if err != nil {
		t.Fatal(err)
	}
	var expected, actual any
	_ = json.Unmarshal([]byte(raw), &expected)
	_ = json.Unmarshal(canonical, &actual)
	want, _ := CanonicalJSON(expected)
	got, _ := CanonicalJSON(actual)
	if string(want) != string(got) {
		t.Fatalf("annotation lost during canonicalization:\nwant %s\ngot %s", want, got)
	}
}
