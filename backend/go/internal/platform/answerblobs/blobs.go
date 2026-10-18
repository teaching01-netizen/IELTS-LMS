// Package answerblobs is the plan-B3 leaf codec for the row-first read view.
// It owns the PURE projection (no SQL, no domain imports) shared by the V2
// write path (internal/attempts) and the seal path
// (internal/terminalization): row cells -> legacy answers/writing_answers/
// flags triple. Both packages keep their own SQL readers (the Sealer
// interface lives in attempts precisely to avoid an import cycle between
// them) and delegate assembly here so the triple is byte-identical
// everywhere. CanonicalJSON stays in attempts (idempotency depends on it);
// callers pass already-canonical payload bytes.
package answerblobs

import (
	"encoding/json"
	"strings"
)

// Blobs is the materialized legacy triple.
type Blobs struct {
	Answers        string
	WritingAnswers string
	Flags          string
}

// Cell is one stored answer cell: question, module, canonical payload bytes.
type Cell struct {
	QuestionID string
	ModuleID   string
	SectionKey string
	Canonical  json.RawMessage
}

// Assemble projects cells into the legacy triple. The normalized section owns
// the writing/answer split; snapshot-backed cells fall back to their module key.
// Writing cells land in writing_answers; all others land in answers. The stored value is
// the canonical payload's "answer" field (mergeProjection's payloadAnswer
// extraction); markedForReview sets flags. Empty input yields "{}" triple
// (never NULL). Malformed cells fall back to the raw value as the answer.
func Assemble(cells []Cell) (Blobs, error) {
	answers := map[string]json.RawMessage{}
	writing := map[string]json.RawMessage{}
	flags := map[string]json.RawMessage{}
	for _, c := range cells {
		ans, fset := Project(c.ModuleID, c.SectionKey, c.Canonical)
		if ans.IsAnswer {
			answers[c.QuestionID] = ans.Value
		} else {
			writing[c.QuestionID] = ans.Value
		}
		if fset.Set {
			flags[c.QuestionID] = fset.Value
		}
	}
	aJ, err := json.Marshal(answers)
	if err != nil {
		return Blobs{}, err
	}
	wJ, err := json.Marshal(writing)
	if err != nil {
		return Blobs{}, err
	}
	fJ, err := json.Marshal(flags)
	if err != nil {
		return Blobs{}, err
	}
	return Blobs{Answers: string(aJ), WritingAnswers: string(wJ), Flags: string(fJ)}, nil
}

// Answer is one projected answer cell.
type Answer struct {
	IsAnswer bool // true -> answers, false -> writing_answers
	Value    json.RawMessage
}

// Flag is one projected flags cell.
type Flag struct {
	Set   bool
	Value json.RawMessage
}

// payload mirrors the canonical response envelope's answer/flag fields.
type payload struct {
	Answer          json.RawMessage `json:"answer"`
	MarkedForReview bool            `json:"markedForReview"`
}

// Project applies the legacy mergeProjection semantics to one stored
// canonical payload: extract the "answer" field, split answers vs
// writing_answers by module, set flags iff markedForReview.
func Project(moduleID, sectionKey string, canonical json.RawMessage) (Answer, Flag) {
	var p payload
	if err := json.Unmarshal(canonical, &p); err != nil || len(p.Answer) == 0 {
		if IsWritingResponse(moduleID, sectionKey) {
			return Answer{Value: canonical}, Flag{}
		}
		return Answer{IsAnswer: true, Value: canonical}, Flag{}
	}
	ans := Answer{Value: p.Answer}
	if !IsWritingResponse(moduleID, sectionKey) {
		ans.IsAnswer = true
	}
	var flag Flag
	if p.MarkedForReview {
		flag = Flag{Set: true, Value: json.RawMessage("true")}
	}
	return ans, flag
}

// IsWritingResponse uses section identity for normalized modules (whose IDs
// are opaque), retaining module-key compatibility for legacy snapshots.
func IsWritingResponse(moduleID, sectionKey string) bool {
	if sectionKey = strings.TrimSpace(sectionKey); sectionKey != "" {
		return strings.EqualFold(sectionKey, "writing")
	}
	return strings.Contains(strings.ToLower(moduleID), "writing")
}
