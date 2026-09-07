package authoring

import (
	"context"
	"database/sql"

	"example.com/ielts-proctoring/internal/platform/tx"
	"github.com/google/uuid"
)

// Touch the owning draft in the same transaction as every content mutation.
// This both excludes published content and invalidates stale publish/import checks.
func touchModuleDraft(ctx context.Context, q tx.Tx, moduleID string) error {
	var versionID string
	err := q.QueryRowContext(ctx, `SELECT v.id FROM exam_entities e
 JOIN exam_versions v ON v.id = e.current_draft_version_id
 JOIN assessment_sections s ON s.exam_version_id = v.id
 JOIN assessment_modules m ON m.section_id = s.id
 WHERE m.id = ? AND v.is_draft = TRUE AND v.is_published = FALSE FOR UPDATE`, moduleID).Scan(&versionID)
	if err == sql.ErrNoRows {
		return conflictError("Module is not in an editable draft; reopen the exam before editing.")
	}
	if err != nil {
		return err
	}
	_, err = q.ExecContext(ctx, "UPDATE exam_versions SET revision = revision + 1 WHERE id = ?", versionID)
	return err
}

func touchQuestionDraft(ctx context.Context, q tx.Tx, questionID string) error {
	var moduleID string
	err := q.QueryRowContext(ctx, "SELECT module_id FROM assessment_exam_questions WHERE id = ? FOR UPDATE", questionID).Scan(&moduleID)
	if err == sql.ErrNoRows {
		return notFoundError("Question not found.")
	}
	if err != nil {
		return err
	}
	return touchModuleDraft(ctx, q, moduleID)
}

// A duplicate owns its content so editing it cannot change its source.
func cloneQuestionContent(ctx context.Context, q tx.Tx, revisionID, actorID string) (string, string, error) {
	questionID, newRevisionID := uuid.NewString(), uuid.NewString()
	result, err := q.ExecContext(ctx, `INSERT INTO assessment_questions (id, provider_key, created_by, created_at, updated_at)
 SELECT ?, original.provider_key, ?, NOW(6), NOW(6) FROM assessment_questions original
 JOIN assessment_question_revisions r ON r.question_id = original.id WHERE r.id = ?`, questionID, actorID, revisionID)
	if err != nil {
		return "", "", err
	}
	if n, _ := result.RowsAffected(); n != 1 {
		return "", "", notFoundError("Question not found.")
	}
	_, err = q.ExecContext(ctx, `INSERT INTO assessment_question_revisions
 (id, question_id, semantic_revision, revision, state, question_type, stimulus, prompt, answer_definition, rationale, metadata, accessibility, created_by)
 SELECT ?, ?, 1, 0, 'draft', question_type, stimulus, prompt, answer_definition, rationale, metadata, accessibility, ?
 FROM assessment_question_revisions WHERE id = ?`, newRevisionID, questionID, actorID, revisionID)
	return questionID, newRevisionID, err
}
