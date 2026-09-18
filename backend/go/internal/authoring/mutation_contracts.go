package authoring

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/google/uuid"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/tx"
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

// normalizeOperationKey trims and validates a client-supplied idempotency
// key: 1..128 chars of printable non-space content.
func normalizeOperationKey(key string) (string, error) {
	trimmed := strings.TrimSpace(key)
	if trimmed == "" || len(trimmed) > 128 {
		return "", validationError("operationKey must contain between 1 and 128 characters.")
	}
	return trimmed, nil
}

// claimOperationKey inserts (actor, scope, key) with the request fingerprint.
// First claim wins; a replay with the same fingerprint returns the stored
// result, a reuse with a different fingerprint is a 409 so a retried
// create/duplicate/commit can never silently mint a second effect.
func claimOperationKey(ctx context.Context, q tx.Tx, actor, scope, key, fingerprint string) (replay []byte, claimed bool, err error) {
	res, err := q.ExecContext(ctx, "INSERT IGNORE INTO authoring_operation_keys (actor_id, scope, operation_key, request_hash, created_at, expires_at) VALUES (?, ?, ?, ?, NOW(6), DATE_ADD(NOW(6), INTERVAL 7 DAY))", actor, scope, key, fingerprint)
	if err != nil {
		return nil, false, err
	}
	n, _ := res.RowsAffected()
	if n == 1 {
		return nil, true, nil
	}
	var storedHash string
	var storedResult []byte
	if err := q.QueryRowContext(ctx, "SELECT request_hash, result_json FROM authoring_operation_keys WHERE actor_id = ? AND scope = ? AND operation_key = ?", actor, scope, key).Scan(&storedHash, &storedResult); err != nil {
		return nil, false, err
	}
	if storedHash != fingerprint {
		return nil, false, apperrors.New(apperrors.CodeConflict, "This operation key was already used with different content; use a new key.")
	}
	return storedResult, false, nil
}

// storeOperationResult persists the successful outcome for key replays.
func storeOperationResult(ctx context.Context, q tx.Tx, actor, scope, key string, result any) error {
	raw, err := json.Marshal(result)
	if err != nil {
		return err
	}
	_, err = q.ExecContext(ctx, "UPDATE authoring_operation_keys SET result_json = ? WHERE actor_id = ? AND scope = ? AND operation_key = ?", string(raw), actor, scope, key)
	return err
}

// moduleCapacityFence loads one module FOR UPDATE and rejects an insert of
// `additional` questions when it would exceed target_question_count.
// Every insert path (create, batch, duplicate, bulk move/duplicate) must run
// this inside its transaction after locking the destination module row, so
// two concurrent authors racing the last slot produce exactly one winner.
func moduleCapacityFence(ctx context.Context, q tx.Tx, moduleID string, additional int) error {
	var target int
	if err := q.QueryRowContext(ctx, "SELECT target_question_count FROM assessment_modules WHERE id = ? FOR UPDATE", moduleID).Scan(&target); err != nil {
		if err == sql.ErrNoRows {
			return notFoundError("Module not found.")
		}
		return err
	}
	var current int
	if err := q.QueryRowContext(ctx, "SELECT COUNT(*) FROM assessment_exam_questions WHERE module_id = ?", moduleID).Scan(&current); err != nil {
		return err
	}
	if current+additional > target {
		return validationError(fmt.Sprintf("Module already has %d of %d questions; cannot add %d more.", current, target, additional))
	}
	return nil
}

// OperationOption carries optional retry-safety for mutating calls.
type OperationOption func(*operationConfig)

type operationConfig struct {
	operationKey string
}

// WithOperationKey makes create/duplicate/commit replay-safe: a retry with
// the same key and identical content returns the original outcome instead of
// minting a second question set.
func WithOperationKey(key string) OperationOption {
	return func(c *operationConfig) {
		c.operationKey = key
	}
}

func operationFingerprint(v any) (string, error) {
	raw, err := json.Marshal(v)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(raw)
	return fmt.Sprintf("%x", sum[:]), nil
}
