package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"

	"example.com/ielts-proctoring/internal/attempts"
)

// V2 response rows are the exact saved text source; sealed answer maps recover
// writing tasks from older projections that stored essays in answers.
func recoverSealedWritingForReview(ctx context.Context, db *sql.DB, submissionID string, tasks []map[string]any) error {
	if len(tasks) == 0 {
		return nil
	}
	missing := false
	for _, task := range tasks {
		if text, _ := task["studentText"].(string); text == "" {
			missing = true
		}
	}
	var raw sql.NullString
	var attemptID string
	var protocolVersion int
	err := db.QueryRowContext(ctx, `SELECT a.id, COALESCE(a.protocol_version, 1), a.final_submission FROM student_submissions s JOIN student_attempts a ON a.id = s.attempt_id AND a.terminal_generation = s.terminal_generation AND a.submitted_at IS NOT NULL WHERE s.id = ? AND s.provider_key = 'ielts'`, submissionID).Scan(&attemptID, &protocolVersion, &raw)
	if err == sql.ErrNoRows {
		return nil
	}
	if err != nil {
		return err
	}
	if protocolVersion < 2 && !missing {
		return nil
	}
	var sealed struct {
		Answers        map[string]json.RawMessage `json:"answers"`
		WritingAnswers map[string]json.RawMessage `json:"writingAnswers"`
	}
	if raw.Valid && strings.TrimSpace(raw.String) != "" {
		if err := json.Unmarshal([]byte(raw.String), &sealed); err != nil {
			return err
		}
	}
	rowAnswers := map[string]json.RawMessage{}
	rowWritingAnswers := map[string]json.RawMessage{}
	if protocolVersion >= 2 {
		blobs, err := attempts.MaterializeBlobs(ctx, db, attemptID)
		if err != nil {
			return err
		}
		if err := json.Unmarshal([]byte(blobs.Answers), &rowAnswers); err != nil {
			return err
		}
		if err := json.Unmarshal([]byte(blobs.WritingAnswers), &rowWritingAnswers); err != nil {
			return err
		}
	}
	for _, task := range tasks {
		id, _ := task["taskId"].(string)
		value, hasRowAnswer := rowWritingAnswers[id]
		if !hasRowAnswer {
			value, hasRowAnswer = rowAnswers[id]
		}
		if hasRowAnswer {
			var text string
			if json.Unmarshal(value, &text) != nil {
				var object struct {
					Text string `json:"text"`
				}
				if json.Unmarshal(value, &object) == nil {
					text = object.Text
				}
			}
			task["studentText"] = text
			task["wordCount"] = len(strings.Fields(text))
			continue
		}
		if task["studentText"] != "" {
			continue
		}
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
