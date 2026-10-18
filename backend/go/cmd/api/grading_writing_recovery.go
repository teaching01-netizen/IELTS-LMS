package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"
)

// Older normalized writing modules sealed their saved essays in answers.
// Recover only known writing task IDs, from the immutable submitted snapshot.
func recoverSealedWritingForReview(ctx context.Context, db *sql.DB, submissionID string, tasks []map[string]any) error {
	missing := false
	for _, task := range tasks {
		if text, _ := task["studentText"].(string); text == "" {
			missing = true
		}
	}
	if !missing {
		return nil
	}
	var raw sql.NullString
	err := db.QueryRowContext(ctx, `SELECT a.final_submission FROM student_submissions s JOIN student_attempts a ON a.id = s.attempt_id WHERE s.id = ? AND s.provider_key = 'ielts'`, submissionID).Scan(&raw)
	if err == sql.ErrNoRows || (err == nil && !raw.Valid) {
		return nil
	}
	if err != nil {
		return err
	}
	var sealed struct {
		Answers        map[string]json.RawMessage `json:"answers"`
		WritingAnswers map[string]json.RawMessage `json:"writingAnswers"`
	}
	if err := json.Unmarshal([]byte(raw.String), &sealed); err != nil {
		return err
	}
	for _, task := range tasks {
		if task["studentText"] != "" {
			continue
		}
		id, _ := task["taskId"].(string)
		value, exists := sealed.WritingAnswers[id]
		if !exists {
			value = sealed.Answers[id]
		}
		var text string
		if json.Unmarshal(value, &text) != nil {
			var object struct {
				Text string `json:"text"`
			}
			if json.Unmarshal(value, &object) == nil {
				text = object.Text
			}
		}
		if text != "" {
			task["studentText"] = text
			task["wordCount"] = len(strings.Fields(text))
		}
	}
	return nil
}
