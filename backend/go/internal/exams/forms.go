package exams

import (
	"encoding/json"

	"example.com/ielts-proctoring/internal/assessmentforms/definition"
)

// preserveForms keeps the forms property owned by the forms endpoint when a
// whole-config draft save omits it (older clients, timing saves, imports). An
// explicit non-null forms value must itself be valid.
func preserveForms(incoming json.RawMessage, stored string) (json.RawMessage, error) {
	var next map[string]json.RawMessage
	if err := json.Unmarshal(incoming, &next); err != nil || next == nil {
		// Non-object configs keep their historical pass-through behavior.
		return incoming, nil
	}
	if raw, ok := next[definition.SnapshotKey]; ok && string(raw) != "null" {
		if _, issues := definition.Parse(raw); len(issues) > 0 {
			e := validationError("Form settings are invalid: " + issues[0].Message)
			e.Details = map[string]any{"path": "forms." + issues[0].Path}
			return nil, e
		}
		return incoming, nil
	}
	var prev map[string]json.RawMessage
	if json.Unmarshal([]byte(stored), &prev) != nil {
		return incoming, nil
	}
	raw, ok := prev[definition.SnapshotKey]
	if !ok || string(raw) == "null" {
		return incoming, nil
	}
	next[definition.SnapshotKey] = raw
	return json.Marshal(next)
}
