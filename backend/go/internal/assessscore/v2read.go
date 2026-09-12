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
