package authoring

import (
	"context"
	"database/sql"
	"encoding/json"

	"github.com/google/uuid"

	"example.com/ielts-proctoring/internal/platform/tx"
	"example.com/ielts-proctoring/internal/satconvert"
	"example.com/ielts-proctoring/internal/satpublish"
)

// GetScoreConverter returns the current draft's versioned SAT score converter,
// or nil when the draft reports raw scores only.
func (s *Service) GetScoreConverter(ctx context.Context, examID string) (json.RawMessage, error) {
	var raw sql.NullString
	err := s.db.QueryRowContext(ctx, "SELECT CAST(sp.policy_config AS CHAR) FROM exam_entities e JOIN exam_versions v ON v.id = e.current_draft_version_id LEFT JOIN assessment_scoring_policies sp ON sp.exam_version_id = v.id WHERE e.id = ?", examID).Scan(&raw)
	if err == sql.ErrNoRows {
		return nil, notFoundError("The exam has no current draft.")
	}
	if err != nil {
		return nil, err
	}
	if !raw.Valid || !satconvert.Configured([]byte(raw.String)) {
		return nil, nil
	}
	return json.RawMessage(raw.String), nil
}

// SetScoreConverter replaces the current draft's converter (nil = raw scores
// only). Published versions are never touched, so results already scored keep
// the converter version they were scored with; publish validation then
// requires a table for every route the draft's plan can deliver.
func (s *Service) SetScoreConverter(ctx context.Context, examID string, converter json.RawMessage) (json.RawMessage, error) {
	key, stored := "raw_only", "{}"
	if len(converter) > 0 && string(converter) != "null" {
		if _, err := satconvert.Parse(converter); err != nil {
			return nil, validationError(err.Error())
		}
		key, stored = satconvert.ScoreType, string(converter)
	}
	err := s.runner.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		var draftID string
		if err := q.QueryRowContext(ctx, "SELECT v.id FROM exam_versions v JOIN exam_entities e ON e.current_draft_version_id = v.id WHERE e.id = ? AND v.is_draft = TRUE FOR UPDATE", examID).Scan(&draftID); err != nil {
			if err == sql.ErrNoRows {
				return notFoundError("The exam has no current draft.")
			}
			return err
		}
		if key != "raw_only" {
			// Mirror of the creation rule: flexible and M1-only exams report
			// raw scores only, so a converter attached here would publish
			// yet never convert. The clear (null) path stays open.
			plan, err := satpublish.LoadPlan(ctx, q, draftID)
			if err != nil {
				return err
			}
			flexible, err := satpublish.LoadFlexibleFlag(ctx, q, draftID)
			if err != nil {
				return err
			}
			m1Only := false
			for _, shape := range plan {
				if shape == satpublish.ShapeM1Only {
					m1Only = true
					break
				}
			}
			if flexible || m1Only {
				return validationError("Score converter is not supported for flexible or M1-only SAT exams; they report raw scores only.")
			}
		}
		if _, err := q.ExecContext(ctx, "INSERT INTO assessment_scoring_policies (id, exam_version_id, policy_key, policy_config, revision) VALUES (?, ?, ?, ?, 0) ON DUPLICATE KEY UPDATE policy_key = VALUES(policy_key), policy_config = VALUES(policy_config), revision = revision + 1", uuid.NewString(), draftID, key, stored); err != nil {
			return err
		}
		// Readiness is keyed by the draft revision; a new converter needs a new check.
		_, err := q.ExecContext(ctx, "UPDATE exam_versions SET revision = revision + 1 WHERE id = ?", draftID)
		return err
	})
	if err != nil {
		return nil, err
	}
	if key == "raw_only" {
		return nil, nil
	}
	return converter, nil
}
