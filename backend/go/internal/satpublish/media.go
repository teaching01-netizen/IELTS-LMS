package satpublish

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

type AssetReference struct {
	AssetID        string
	ExamQuestionID string
	Path           string
}

// CollectDraftAssetReferences walks authored SAT image content for the
// selected release scope. The returned paths identify question and content.
func CollectDraftAssetReferences(ctx context.Context, q Queryer, versionID string, scope Scope) ([]AssetReference, error) {
	normalizedScope, err := NormalizeScope(scope)
	if err != nil {
		return nil, err
	}
	query := `SELECT eq.id, CAST(r.stimulus AS CHAR), CAST(r.prompt AS CHAR), CAST(r.answer_definition AS CHAR)
		FROM assessment_exam_questions eq
		JOIN assessment_modules m ON m.id = eq.module_id
		JOIN assessment_sections s ON s.id = m.section_id
		JOIN assessment_question_revisions r ON r.id = eq.question_revision_id
		WHERE s.exam_version_id = ?`
	args := []any{versionID}
	if normalizedScope != ScopeFull {
		keys, err := normalizedScope.SectionKeys()
		if err != nil {
			return nil, err
		}
		query += " AND s.section_key IN (" + strings.TrimSuffix(strings.Repeat("?,", len(keys)), ",") + ")"
		for _, key := range keys {
			args = append(args, key)
		}
	}
	query += " ORDER BY s.display_order, m.display_order, eq.display_order, eq.id"
	rows, err := q.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	refs := make([]AssetReference, 0)
	for rows.Next() {
		var questionID, stimulus, prompt, answer string
		if err := rows.Scan(&questionID, &stimulus, &prompt, &answer); err != nil {
			return nil, err
		}
		for _, item := range []struct{ field, raw string }{{"stimulus", stimulus}, {"prompt", prompt}} {
			refs = append(refs, CollectRichContentAssetReferences(item.raw, "examQuestion:"+questionID+":"+item.field, questionID)...)
		}
		var answerObject map[string]json.RawMessage
		if json.Unmarshal([]byte(answer), &answerObject) != nil {
			continue
		}
		var options []struct {
			Content json.RawMessage `json:"content"`
		}
		if json.Unmarshal(answerObject["options"], &options) != nil {
			continue
		}
		for index, option := range options {
			if len(option.Content) == 0 || string(option.Content) == "null" {
				continue
			}
			path := fmt.Sprintf("examQuestion:%s:answer.options[%d].content", questionID, index)
			refs = append(refs, CollectRichContentAssetReferences(string(option.Content), path, questionID)...)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return refs, nil
}

// CollectRichContentAssetReferences is a pure walker for one serialized
// StructuredContent value. It ignores external image URLs and returns stable
// asset IDs with their authoring paths.
func CollectRichContentAssetReferences(raw, path, questionID string) []AssetReference {
	var root any
	if json.Unmarshal([]byte(raw), &root) != nil {
		return nil
	}
	refs := make([]AssetReference, 0)
	var walk func(any, string)
	walk = func(value any, at string) {
		switch typed := value.(type) {
		case map[string]any:
			if stringFieldJSON(typed, "type") == "image" {
				attrs, _ := typed["attrs"].(map[string]any)
				assetID := stringFieldJSON(attrs, "assetId", "asset_id")
				assetPath := at + ".attrs.assetId"
				if assetID == "" {
					assetID = stringFieldJSON(typed, "assetId", "asset_id")
					assetPath = at + ".assetId"
				}
				if assetID = strings.TrimSpace(assetID); assetID != "" {
					refs = append(refs, AssetReference{AssetID: assetID, ExamQuestionID: questionID, Path: assetPath})
				}
			}
			keys := make([]string, 0, len(typed))
			for key := range typed {
				keys = append(keys, key)
			}
			sort.Strings(keys)
			for _, key := range keys {
				walk(typed[key], at+"."+key)
			}
		case []any:
			for index, child := range typed {
				walk(child, fmt.Sprintf("%s[%d]", at, index))
			}
		}
	}
	walk(root, path)
	return refs
}

func stringFieldJSON(object map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := object[key].(string); ok && strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}
