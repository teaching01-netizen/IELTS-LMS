package authoring

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"

	"example.com/ielts-proctoring/internal/platform/tx"
	"example.com/ielts-proctoring/internal/satpublish"
)

// GetClassroomPlan returns the active draft's plan, or the current published
// release's plan when no draft exists. Empty means standard full-adaptive.
func (s *Service) GetClassroomPlan(ctx context.Context, examID string) (satpublish.Plan, error) {
	var raw sql.NullString
	var draftID, publishedID, versionID sql.NullString
	var isDraft, isPublished sql.NullBool
	err := s.db.QueryRowContext(ctx, `
SELECT e.current_draft_version_id, e.current_published_version_id,
       v.id, v.is_draft, v.is_published, CAST(v.sat_classroom_plan AS CHAR)
FROM exam_entities e
LEFT JOIN exam_versions v
  ON v.id = COALESCE(NULLIF(e.current_draft_version_id, ''), NULLIF(e.current_published_version_id, ''))
 AND v.exam_id = e.id
WHERE e.id = ?`, examID).Scan(&draftID, &publishedID, &versionID, &isDraft, &isPublished, &raw)
	if err == sql.ErrNoRows {
		return nil, examNotFoundError("Exam not found.")
	}
	if err != nil {
		return nil, err
	}
	if draftID.Valid && strings.TrimSpace(draftID.String) != "" {
		if !versionID.Valid || !isDraft.Valid || !isDraft.Bool {
			return nil, draftIntegrityError(examID, strings.TrimSpace(draftID.String))
		}
	} else if publishedID.Valid && strings.TrimSpace(publishedID.String) != "" {
		if !versionID.Valid || !isPublished.Valid || !isPublished.Bool {
			return nil, notFoundError("The exam's published version is missing.")
		}
	} else {
		return nil, conflictError("The exam has no current draft or published version.")
	}
	return satpublish.ParsePlan(raw.String)
}

// SetClassroomPlan replaces the current draft's plan. The plan is validated by
// the same parser delivery uses; publish validation then requires exactly the
// modules the plan lets students receive.
func (s *Service) SetClassroomPlan(ctx context.Context, examID string, plan satpublish.Plan) (satpublish.Plan, error) {
	var stored any // NULL clears the plan back to the standard structure
	if len(plan) > 0 {
		raw, err := json.Marshal(plan)
		if err != nil {
			return nil, err
		}
		if _, err := satpublish.ParsePlan(string(raw)); err != nil {
			return nil, validationError(err.Error())
		}
		stored = string(raw)
	}
	err := s.runner.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		var draftID string
		if err := q.QueryRowContext(ctx, "SELECT v.id FROM exam_versions v JOIN exam_entities e ON e.current_draft_version_id = v.id WHERE e.id = ? AND v.is_draft = TRUE FOR UPDATE", examID).Scan(&draftID); err != nil {
			if err == sql.ErrNoRows {
				return notFoundError("The exam has no current draft.")
			}
			return err
		}
		_, err := q.ExecContext(ctx, "UPDATE exam_versions SET sat_classroom_plan = ?, revision = revision + 1 WHERE id = ?", stored, draftID)
		return err
	})
	if err != nil {
		return nil, err
	}
	if len(plan) == 0 {
		return nil, nil
	}
	return plan, nil
}
