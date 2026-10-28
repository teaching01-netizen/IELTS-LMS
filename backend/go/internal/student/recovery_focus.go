package student

import (
	"context"
	"encoding/json"
	"strings"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/tx"
)

// recoveryMutationIDs loads the pinned focus once per recovered legacy batch.
// Ordinary attempts retain their existing query count. IDs from another
// section never become writable just because a cookie identifies the student.
func recoveryMutationIDs(ctx context.Context, q tx.Tx, row v1AttemptRow) (map[string]bool, error) {
	if row.RecoveryControl == nil {
		return nil, nil
	}
	var raw string
	if err := q.QueryRowContext(ctx, `SELECT CAST(content_snapshot AS CHAR) FROM exam_versions WHERE id=?`, row.PublishedVersionID).Scan(&raw); err != nil {
		return nil, err
	}
	return recoverySnapshotIDs([]byte(raw), row.RecoveryControl.Target.SectionKey, row.RecoveryControl.Target.ModuleID)
}

func recoverySnapshotIDs(raw []byte, sectionKey, moduleID string) (map[string]bool, error) {
	var root map[string]any
	if err := json.Unmarshal(raw, &root); err != nil {
		return nil, err
	}
	var focus any = root[sectionKey]
	if sections, ok := root["sections"].([]any); ok {
		for _, entry := range sections {
			section, ok := entry.(map[string]any)
			if !ok {
				continue
			}
			key, _ := section["sectionKey"].(string)
			if key == "" {
				key, _ = section["section_key"].(string)
			}
			if key != sectionKey {
				continue
			}
			focus = section
			if moduleID != "" {
				focus = nil
				if modules, ok := section["modules"].([]any); ok {
					for _, item := range modules {
						m, ok := item.(map[string]any)
						if ok && m["id"] == moduleID {
							focus = m
							break
						}
					}
				}
			}
			break
		}
	}
	if focus == nil {
		return nil, recoveryFocusError()
	}
	ids := map[string]bool{}
	var walk func(any, string)
	walk = func(value any, parent string) {
		switch node := value.(type) {
		case map[string]any:
			id, _ := node["id"].(string)
			if id != "" {
				ids[id] = true
				if parent != "" {
					ids[parent+":"+id] = true
				}
				parent = id
			}
			for _, child := range node {
				walk(child, parent)
			}
		case []any:
			for _, child := range node {
				walk(child, parent)
			}
		}
	}
	walk(focus, "")
	return ids, nil
}

func validateRecoveryMutation(row v1AttemptRow, ids map[string]bool, mutation V1Mutation) error {
	if row.RecoveryControl == nil {
		return nil
	}
	switch mutation.Type {
	case "answer", "flag", "SetSlot", "ClearSlot", "SetScalar", "ClearScalar", "SetChoice", "ClearChoice":
		if !ids[payloadString(mutation.Payload, "questionId")] {
			return recoveryFocusError()
		}
	case "writing_answer", "SetEssayText", "ClearEssayText":
		if row.RecoveryControl.Target.SectionKey != "writing" || !ids[payloadString(mutation.Payload, "taskId")] {
			return recoveryFocusError()
		}
	case "position":
		module := payloadString(mutation.Payload, "currentModule")
		question := payloadString(mutation.Payload, "currentQuestionId")
		if module != "" && module != row.RecoveryControl.Target.SectionKey {
			return recoveryFocusError()
		}
		if question != "" && !ids[question] {
			return recoveryFocusError()
		}
	}
	return nil
}

func validateRecoveryPatch(row v1AttemptRow, ids map[string]bool, patch map[string]json.RawMessage) error {
	if row.RecoveryControl == nil {
		return nil
	}
	for _, key := range []string{"answers", "writingAnswers", "flags"} {
		raw := patch[key]
		if len(raw) == 0 || strings.TrimSpace(string(raw)) == "null" {
			continue
		}
		var values map[string]json.RawMessage
		if err := json.Unmarshal(raw, &values); err != nil {
			return err
		}
		if key == "writingAnswers" && len(values) > 0 && row.RecoveryControl.Target.SectionKey != "writing" {
			return recoveryFocusError()
		}
		for id := range values {
			if !ids[id] {
				return recoveryFocusError()
			}
		}
	}
	return nil
}

func recoveryFocusError() error {
	return &apperrors.Error{Code: apperrors.CodeConflict, HTTPStatus: 409, Message: "Only the focused recovery section can be changed.", Details: map[string]any{"reason": "RECOVERY_FOCUS"}}
}
