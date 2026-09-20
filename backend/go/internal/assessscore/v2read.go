package assessscore

import (
	"encoding/json"
)

// V2ResponseToScorerInput converts one V2 canonical response payload into the
// JSON-string scorer input used by delivery.responseIsCorrect /
// SATResponseCorrect. The canonical payload is the full envelope
// {"answer":..., "markedForReview":..., ...}; the scorer consumes only the
// "answer" field re-encoded as JSON (legacy assessment_question_responses
// stores exactly that JSON string). Returns ("", false) when the payload
// carries no usable answer (null/missing/unmarshalable) so callers apply the
// standard incorrect/null-verdict rules instead of inventing semantics.
//
// Parity anchor: attempts.payloadAnswer extracts p.Answer and mergeProjection
// persists CanonicalJSON(payloadAnswer(...)); answerblobs.Project extracts
// the same "answer" field. This function is the read-side mirror of that
// write-side extraction.
func V2ResponseToScorerInput(canonical string) (string, bool) {
	if canonical == "" {
		return "", false
	}
	var envelope struct {
		Answer json.RawMessage `json:"answer"`
	}
	if err := json.Unmarshal([]byte(canonical), &envelope); err != nil {
		return "", false
	}
	if len(envelope.Answer) == 0 || string(envelope.Answer) == "null" {
		return "", false
	}
	// Re-encode through RawMessage to normalize whitespace without changing
	// the value: the scorer unmarshals it as a JSON string.
	var probe any
	if err := json.Unmarshal(envelope.Answer, &probe); err != nil {
		return "", false
	}
	normalized, err := json.Marshal(probe)
	if err != nil {
		return "", false
	}
	return string(normalized), true
}

// V2MarkedForReview extracts markedForReview from one V2 canonical payload.
// Missing/unmarshalable payloads report false (never reviewed).
func V2MarkedForReview(canonical string) bool {
	if canonical == "" {
		return false
	}
	var envelope struct {
		MarkedForReview bool `json:"markedForReview"`
	}
	if err := json.Unmarshal([]byte(canonical), &envelope); err != nil {
		return false
	}
	return envelope.MarkedForReview
}

// v2AnnotationsKind is the write-side marker (attempts.Annotation.Kind) that
// identifies the wrapped SAT annotations element inside the canonical
// annotations array.
const v2AnnotationsKind = "sat_annotations"

// v2AnnotationsEnvelope is the per-question annotation shape the legacy
// ResponseSnapshot carries (assessment_question_responses.annotations), and
// therefore the shape the V2 read projection must reproduce.
type v2AnnotationsEnvelope struct {
	Version            int             `json:"version"`
	LegacyQuestionNote string          `json:"legacyQuestionNote,omitempty"`
	Annotations        json.RawMessage `json:"annotations"`
}

// V2EliminatedOptions projects eliminatedOptions from one V2 canonical
// payload to canonical JSON. Missing/null/unmarshalable payloads project to
// [] so every response snapshot carries the candidate-facing array default.
func V2EliminatedOptions(canonical string) json.RawMessage {
	const def = "[]"
	if canonical == "" {
		return json.RawMessage(def)
	}
	var envelope struct {
		EliminatedOptions json.RawMessage `json:"eliminatedOptions"`
	}
	if err := json.Unmarshal([]byte(canonical), &envelope); err != nil {
		return json.RawMessage(def)
	}
	raw := envelope.EliminatedOptions
	if len(raw) == 0 || string(raw) == "null" {
		return json.RawMessage(def)
	}
	// Re-encode through RawMessage to normalize whitespace without changing
	// the value (mirrors V2ResponseToScorerInput).
	var probe any
	if err := json.Unmarshal(raw, &probe); err != nil {
		return json.RawMessage(def)
	}
	normalized, err := json.Marshal(probe)
	if err != nil {
		return json.RawMessage(def)
	}
	return json.RawMessage(normalized)
}

// V2AnnotationsEnvelope projects annotations from one V2 canonical payload
// to the legacy per-question envelope shape. The canonical write-side form
// is the wrapped array [{id:"sat-annotations", kind:"sat_annotations",
// version, legacyQuestionNote, annotations:[...]}] (attempts.ResponsePayload);
// the read side unwraps that element to its envelope so V2 and legacy rows
// merge into one shape. A payload already stored as a bare envelope object
// passes through; missing/null/empty-array/unwrappable payloads project to {}
// so every response snapshot carries a valid JSON object.
func V2AnnotationsEnvelope(canonical string) json.RawMessage {
	const def = "{}"
	if canonical == "" {
		return json.RawMessage(def)
	}
	var envelope struct {
		Annotations json.RawMessage `json:"annotations"`
	}
	if err := json.Unmarshal([]byte(canonical), &envelope); err != nil {
		return json.RawMessage(def)
	}
	raw := envelope.Annotations
	if len(raw) == 0 || string(raw) == "null" {
		return json.RawMessage(def)
	}

	// Wrapped canonical form: take the first sat_annotations element and
	// rebuild its envelope. The inner annotations array is carried verbatim.
	var wrapped []struct {
		Kind               string          `json:"kind"`
		Version            int             `json:"version"`
		LegacyQuestionNote string          `json:"legacyQuestionNote"`
		Annotations        json.RawMessage `json:"annotations"`
	}
	if err := json.Unmarshal(raw, &wrapped); err == nil {
		for _, element := range wrapped {
			if element.Kind != v2AnnotationsKind {
				continue
			}
			inner := element.Annotations
			if len(inner) == 0 || string(inner) == "null" {
				inner = json.RawMessage("[]")
			}
			env, err := json.Marshal(v2AnnotationsEnvelope{
				Version:            element.Version,
				LegacyQuestionNote: element.LegacyQuestionNote,
				Annotations:        inner,
			})
			if err != nil {
				return json.RawMessage(def)
			}
			return json.RawMessage(env)
		}
	}

	// Legacy bare-envelope passthrough: any JSON object that is not the
	// wrapped array keeps its content (re-encoded, sorted keys).
	var object map[string]json.RawMessage
	if err := json.Unmarshal(raw, &object); err == nil && object != nil {
		normalized, err := json.Marshal(object)
		if err == nil {
			return json.RawMessage(normalized)
		}
	}
	return json.RawMessage(def)
}
