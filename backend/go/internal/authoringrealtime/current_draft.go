package authoringrealtime

import (
	"context"
	"database/sql"
)

// CurrentDraftID resolves the working draft for an exam straight from the
// entity row. It backs re-subscribe revalidation: the binding is compared
// against CURRENT server state, never against anything the client said.
//
// Returns "" (with no error) when the exam exists but has no editable draft —
// a published exam, or one whose draft was removed. Callers translate that
// into draft_not_editable, which is a legitimate state and not a failure.
func CurrentDraftID(ctx context.Context, db replayQuerier, examID string) (string, error) {
	if db == nil {
		return "", sql.ErrConnDone
	}
	var draft sql.NullString
	if err := db.QueryRowContext(ctx, "SELECT current_draft_version_id FROM exam_entities WHERE id = ?", examID).Scan(&draft); err != nil {
		return "", err
	}
	if !draft.Valid {
		return "", nil
	}
	return draft.String, nil
}
