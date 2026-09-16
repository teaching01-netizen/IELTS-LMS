package authoring

import (
	"context"
	"database/sql"
	"strconv"
	"strings"
	"time"

	"example.com/ielts-proctoring/internal/authoringcoedit"
	"example.com/ielts-proctoring/internal/platform/tx"
)

// coeditDecimal keeps BIGINT values exact at the JSON boundary. JavaScript
// callers compare this value as text and never receive a rounded number.
func coeditDecimal(value uint64) authoringcoedit.DecimalString {
	return authoringcoedit.DecimalString(strconv.FormatUint(value, 10))
}

func coeditFreezeOperationID(doc CoeditDocument) string {
	if doc.FreezeOperationID == nil {
		return ""
	}
	return strings.TrimSpace(*doc.FreezeOperationID)
}

func coeditFreezeExpiresAt(doc CoeditDocument) int64 {
	if doc.FreezeExpiresAt == nil {
		return 0
	}
	return doc.FreezeExpiresAt.Unix()
}

func coeditFreezeOperationIDWorkspace(doc CoeditWorkspaceDocument) string {
	if doc.FreezeOperationID == nil {
		return ""
	}
	return strings.TrimSpace(*doc.FreezeOperationID)
}

func coeditFreezeExpiresAtWorkspace(doc CoeditWorkspaceDocument) int64 {
	if doc.FreezeExpiresAt == nil {
		return 0
	}
	return doc.FreezeExpiresAt.Unix()
}

func requireLifecycleOperation(operation authoringcoedit.CoeditLifecycleOperation) error {
	if operation.Valid() {
		return nil
	}
	return authoringcoedit.New(authoringcoedit.CodeFreezeConflict,
		"A valid lifecycle operation is required for this room transition.")
}

func requireFreshFreezeOperation(operation authoringcoedit.CoeditLifecycleOperation) error {
	if err := requireLifecycleOperation(operation); err != nil {
		return err
	}
	if operation.FreezeExpiresAt <= time.Now().Unix() {
		return authoringcoedit.New(authoringcoedit.CodeFreezeConflict,
			"The collaboration freeze lease has expired; start a new lifecycle operation.")
	}
	return nil
}

func lifecycleIDs(ids []string) ([]string, error) {
	seen := make(map[string]struct{}, len(ids))
	out := make([]string, 0, len(ids))
	for _, raw := range ids {
		id := strings.TrimSpace(raw)
		if id == "" {
			return nil, authoringcoedit.New(authoringcoedit.CodeNotEditableDraft,
				"Unknown co-edit document.")
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	return out, nil
}

func lifecycleStateError(raw string, operationID string) error {
	state, err := authoringcoedit.ParseLifecycleState(raw)
	if err != nil {
		return err
	}
	switch state {
	case authoringcoedit.StateClosed:
		return authoringcoedit.New(authoringcoedit.CodeDocumentClosed,
			"This collaboration session was closed.")
	case authoringcoedit.StateFreezing, authoringcoedit.StateFrozen:
		return authoringcoedit.New(authoringcoedit.CodeFreezeConflict,
			"Another lifecycle operation owns this collaboration session.")
	default:
		return authoringcoedit.New(authoringcoedit.CodeFreezeConflict,
			"This collaboration session cannot be transitioned by the requested operation.")
	}
}

func sameLifecycleOwner(owner sql.NullString, operationID string) bool {
	return owner.Valid && strings.TrimSpace(owner.String) == operationID
}

// CoeditMarkFreezing durably fences prompt rooms for one operation. The
// variadic form keeps old in-repository callers source-compatible while
// refusing to perform an unsafe unowned transition.
func (s *Service) CoeditMarkFreezing(ctx context.Context, documentIDs []string, operations ...authoringcoedit.CoeditLifecycleOperation) error {
	if len(documentIDs) == 0 {
		return nil
	}
	if len(operations) != 1 {
		return requireLifecycleOperation(authoringcoedit.CoeditLifecycleOperation{})
	}
	operation := operations[0]
	if err := requireFreshFreezeOperation(operation); err != nil {
		return err
	}
	ids, err := lifecycleIDs(documentIDs)
	if err != nil {
		return err
	}
	return s.runner.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		for _, id := range ids {
			if err := markCoeditDocumentFreezing(ctx, q, id, operation); err != nil {
				return err
			}
		}
		return nil
	})
}

func markCoeditDocumentFreezing(ctx context.Context, q tx.Tx, id string, operation authoringcoedit.CoeditLifecycleOperation) error {
	result, err := q.ExecContext(ctx, `UPDATE authoring_coedit_documents
 SET lifecycle_state = ?, freeze_operation_id = ?, freeze_expires_at = ?, updated_at = NOW(6)
 WHERE id = ? AND lifecycle_state IN (?, ?)`,
		string(authoringcoedit.StateFreezing), operation.FreezeOperationID,
		lifecycleExpiryTime(operation), id,
		string(authoringcoedit.StateActive), string(authoringcoedit.StateInitializing))
	if err != nil {
		return err
	}
	if affected, err := result.RowsAffected(); err != nil {
		return err
	} else if affected > 0 {
		return nil
	}

	var state string
	var owner sql.NullString
	err = q.QueryRowContext(ctx, `SELECT lifecycle_state, freeze_operation_id
 FROM authoring_coedit_documents WHERE id = ? FOR UPDATE`, id).Scan(&state, &owner)
	if err == sql.ErrNoRows {
		return authoringcoedit.New(authoringcoedit.CodeNotEditableDraft, "Unknown co-edit document.")
	}
	if err != nil {
		return err
	}
	parsed, parseErr := authoringcoedit.ParseLifecycleState(state)
	if parseErr != nil {
		return parseErr
	}
	if parsed == authoringcoedit.StateFreezing &&
		sameLifecycleOwner(owner, operation.FreezeOperationID) {
		return nil
	}
	return lifecycleStateError(state, operation.FreezeOperationID)
}

// CoeditAbortFreeze releases only the rows owned by operation. A closed row is
// intentionally left closed, even if an old cleanup attempt arrives late.
func (s *Service) CoeditAbortFreeze(ctx context.Context, documentIDs []string, operation authoringcoedit.CoeditLifecycleOperation) error {
	if len(documentIDs) == 0 {
		return nil
	}
	if err := requireLifecycleOperation(operation); err != nil {
		return err
	}
	ids, err := lifecycleIDs(documentIDs)
	if err != nil {
		return err
	}
	return s.runner.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		for _, id := range ids {
			if err := abortCoeditDocumentFreeze(ctx, q, id, operation); err != nil {
				return err
			}
		}
		return nil
	})
}

// CoeditRenewFreeze extends only freezing rows owned by operation. Renewal is
// monotonic at the SQL boundary: a delayed heartbeat can never shorten a
// lease that a newer heartbeat already extended.
func (s *Service) CoeditRenewFreeze(ctx context.Context, documentIDs []string, operation authoringcoedit.CoeditLifecycleOperation) error {
	if len(documentIDs) == 0 {
		return nil
	}
	if err := requireFreshFreezeOperation(operation); err != nil {
		return err
	}
	ids, err := lifecycleIDs(documentIDs)
	if err != nil {
		return err
	}
	return s.runner.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		for _, id := range ids {
			if err := renewCoeditDocumentFreeze(ctx, q, id, operation); err != nil {
				return err
			}
		}
		return nil
	})
}

func renewCoeditDocumentFreeze(ctx context.Context, q tx.Tx, id string, operation authoringcoedit.CoeditLifecycleOperation) error {
	result, err := q.ExecContext(ctx, `UPDATE authoring_coedit_documents
 SET freeze_expires_at = ?, updated_at = NOW(6)
 WHERE id = ? AND lifecycle_state = ? AND freeze_operation_id = ?
   AND (freeze_expires_at IS NULL OR freeze_expires_at < ?)`,
		lifecycleExpiryTime(operation), id, string(authoringcoedit.StateFreezing),
		operation.FreezeOperationID, lifecycleExpiryTime(operation))
	if err != nil {
		return err
	}
	if affected, err := result.RowsAffected(); err != nil {
		return err
	} else if affected > 0 {
		return nil
	}

	var state string
	var owner sql.NullString
	err = q.QueryRowContext(ctx, `SELECT lifecycle_state, freeze_operation_id
 FROM authoring_coedit_documents WHERE id = ? FOR UPDATE`, id).Scan(&state, &owner)
	if err == sql.ErrNoRows {
		return authoringcoedit.New(authoringcoedit.CodeNotEditableDraft, "Unknown co-edit document.")
	}
	if err != nil {
		return err
	}
	parsed, parseErr := authoringcoedit.ParseLifecycleState(state)
	if parseErr != nil {
		return parseErr
	}
	if parsed == authoringcoedit.StateFreezing && sameLifecycleOwner(owner, operation.FreezeOperationID) {
		// The existing expiry is already at least as fresh as this heartbeat.
		return nil
	}
	return lifecycleStateError(state, operation.FreezeOperationID)
}

func abortCoeditDocumentFreeze(ctx context.Context, q tx.Tx, id string, operation authoringcoedit.CoeditLifecycleOperation) error {
	result, err := q.ExecContext(ctx, `UPDATE authoring_coedit_documents
 SET lifecycle_state = ?, freeze_operation_id = NULL, freeze_expires_at = NULL, updated_at = NOW(6)
 WHERE id = ? AND lifecycle_state IN (?, ?) AND freeze_operation_id = ?`,
		string(authoringcoedit.StateActive), id,
		string(authoringcoedit.StateFreezing), string(authoringcoedit.StateFrozen),
		operation.FreezeOperationID)
	if err != nil {
		return err
	}
	if affected, err := result.RowsAffected(); err != nil {
		return err
	} else if affected > 0 {
		return nil
	}

	var state string
	var owner sql.NullString
	err = q.QueryRowContext(ctx, `SELECT lifecycle_state, freeze_operation_id
 FROM authoring_coedit_documents WHERE id = ? FOR UPDATE`, id).Scan(&state, &owner)
	if err == sql.ErrNoRows {
		return authoringcoedit.New(authoringcoedit.CodeNotEditableDraft, "Unknown co-edit document.")
	}
	if err != nil {
		return err
	}
	parsed, parseErr := authoringcoedit.ParseLifecycleState(state)
	if parseErr != nil {
		return parseErr
	}
	switch parsed {
	case authoringcoedit.StateClosed, authoringcoedit.StateActive, authoringcoedit.StateInitializing:
		return nil
	case authoringcoedit.StateFreezing, authoringcoedit.StateFrozen:
		if sameLifecycleOwner(owner, operation.FreezeOperationID) {
			return authoringcoedit.New(authoringcoedit.CodeFreezeConflict,
				"The collaboration freeze could not be released.")
		}
		return authoringcoedit.New(authoringcoedit.CodeFreezeConflict,
			"Another lifecycle operation owns this collaboration session.")
	default:
		return lifecycleStateError(state, operation.FreezeOperationID)
	}
}

// CoeditReopenActive is retained as a compatibility name, but it cannot be
// called without an owner anymore. New code should use CoeditAbortFreeze.
func (s *Service) CoeditReopenActive(ctx context.Context, documentIDs []string, operations ...authoringcoedit.CoeditLifecycleOperation) error {
	if len(documentIDs) == 0 {
		return nil
	}
	if len(operations) != 1 {
		return requireLifecycleOperation(authoringcoedit.CoeditLifecycleOperation{})
	}
	return s.CoeditAbortFreeze(ctx, documentIDs, operations[0])
}

// CoeditWorkspaceMarkFreezing is the owner-aware lifecycle fence for v2 rooms.
func (s *Service) CoeditWorkspaceMarkFreezing(ctx context.Context, documentIDs []string, operations ...authoringcoedit.CoeditLifecycleOperation) error {
	if len(documentIDs) == 0 {
		return nil
	}
	if len(operations) != 1 {
		return requireLifecycleOperation(authoringcoedit.CoeditLifecycleOperation{})
	}
	operation := operations[0]
	if err := requireFreshFreezeOperation(operation); err != nil {
		return err
	}
	ids, err := lifecycleIDs(documentIDs)
	if err != nil {
		return err
	}
	return s.runner.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		for _, id := range ids {
			if err := markCoeditWorkspaceFreezing(ctx, q, id, operation); err != nil {
				return err
			}
		}
		return nil
	})
}

func markCoeditWorkspaceFreezing(ctx context.Context, q tx.Tx, id string, operation authoringcoedit.CoeditLifecycleOperation) error {
	result, err := q.ExecContext(ctx, `UPDATE authoring_coedit_workspaces
 SET lifecycle_state = ?, freeze_operation_id = ?, freeze_expires_at = ?, updated_at = NOW(6)
 WHERE id = ? AND lifecycle_state IN (?, ?)`,
		string(authoringcoedit.StateFreezing), operation.FreezeOperationID,
		lifecycleExpiryTime(operation), id,
		string(authoringcoedit.StateActive), string(authoringcoedit.StateInitializing))
	if err != nil {
		return err
	}
	if affected, err := result.RowsAffected(); err != nil {
		return err
	} else if affected > 0 {
		return nil
	}

	var state string
	var owner sql.NullString
	err = q.QueryRowContext(ctx, `SELECT lifecycle_state, freeze_operation_id
 FROM authoring_coedit_workspaces WHERE id = ? FOR UPDATE`, id).Scan(&state, &owner)
	if err == sql.ErrNoRows {
		return authoringcoedit.New(authoringcoedit.CodeNotEditableDraft, "Unknown co-edit workspace.")
	}
	if err != nil {
		return err
	}
	parsed, parseErr := authoringcoedit.ParseLifecycleState(state)
	if parseErr != nil {
		return parseErr
	}
	if parsed == authoringcoedit.StateFreezing &&
		sameLifecycleOwner(owner, operation.FreezeOperationID) {
		return nil
	}
	return lifecycleStateError(state, operation.FreezeOperationID)
}

// CoeditWorkspaceAbortFreeze is the owner-aware abort for v2 rooms.
func (s *Service) CoeditWorkspaceAbortFreeze(ctx context.Context, documentIDs []string, operation authoringcoedit.CoeditLifecycleOperation) error {
	if len(documentIDs) == 0 {
		return nil
	}
	if err := requireLifecycleOperation(operation); err != nil {
		return err
	}
	ids, err := lifecycleIDs(documentIDs)
	if err != nil {
		return err
	}
	return s.runner.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		for _, id := range ids {
			if err := abortCoeditWorkspaceFreeze(ctx, q, id, operation); err != nil {
				return err
			}
		}
		return nil
	})
}

// CoeditWorkspaceRenewFreeze is the v2 counterpart to CoeditRenewFreeze.
func (s *Service) CoeditWorkspaceRenewFreeze(ctx context.Context, documentIDs []string, operation authoringcoedit.CoeditLifecycleOperation) error {
	if len(documentIDs) == 0 {
		return nil
	}
	if err := requireFreshFreezeOperation(operation); err != nil {
		return err
	}
	ids, err := lifecycleIDs(documentIDs)
	if err != nil {
		return err
	}
	return s.runner.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		for _, id := range ids {
			if err := renewCoeditWorkspaceFreeze(ctx, q, id, operation); err != nil {
				return err
			}
		}
		return nil
	})
}

func renewCoeditWorkspaceFreeze(ctx context.Context, q tx.Tx, id string, operation authoringcoedit.CoeditLifecycleOperation) error {
	result, err := q.ExecContext(ctx, `UPDATE authoring_coedit_workspaces
 SET freeze_expires_at = ?, updated_at = NOW(6)
 WHERE id = ? AND lifecycle_state = ? AND freeze_operation_id = ?
   AND (freeze_expires_at IS NULL OR freeze_expires_at < ?)`,
		lifecycleExpiryTime(operation), id, string(authoringcoedit.StateFreezing),
		operation.FreezeOperationID, lifecycleExpiryTime(operation))
	if err != nil {
		return err
	}
	if affected, err := result.RowsAffected(); err != nil {
		return err
	} else if affected > 0 {
		return nil
	}

	var state string
	var owner sql.NullString
	err = q.QueryRowContext(ctx, `SELECT lifecycle_state, freeze_operation_id
 FROM authoring_coedit_workspaces WHERE id = ? FOR UPDATE`, id).Scan(&state, &owner)
	if err == sql.ErrNoRows {
		return authoringcoedit.New(authoringcoedit.CodeNotEditableDraft, "Unknown co-edit workspace.")
	}
	if err != nil {
		return err
	}
	parsed, parseErr := authoringcoedit.ParseLifecycleState(state)
	if parseErr != nil {
		return parseErr
	}
	if parsed == authoringcoedit.StateFreezing && sameLifecycleOwner(owner, operation.FreezeOperationID) {
		return nil
	}
	return lifecycleStateError(state, operation.FreezeOperationID)
}

func abortCoeditWorkspaceFreeze(ctx context.Context, q tx.Tx, id string, operation authoringcoedit.CoeditLifecycleOperation) error {
	result, err := q.ExecContext(ctx, `UPDATE authoring_coedit_workspaces
 SET lifecycle_state = ?, freeze_operation_id = NULL, freeze_expires_at = NULL, updated_at = NOW(6)
 WHERE id = ? AND lifecycle_state IN (?, ?) AND freeze_operation_id = ?`,
		string(authoringcoedit.StateActive), id,
		string(authoringcoedit.StateFreezing), string(authoringcoedit.StateFrozen),
		operation.FreezeOperationID)
	if err != nil {
		return err
	}
	if affected, err := result.RowsAffected(); err != nil {
		return err
	} else if affected > 0 {
		return nil
	}

	var state string
	var owner sql.NullString
	err = q.QueryRowContext(ctx, `SELECT lifecycle_state, freeze_operation_id
 FROM authoring_coedit_workspaces WHERE id = ? FOR UPDATE`, id).Scan(&state, &owner)
	if err == sql.ErrNoRows {
		return authoringcoedit.New(authoringcoedit.CodeNotEditableDraft, "Unknown co-edit workspace.")
	}
	if err != nil {
		return err
	}
	parsed, parseErr := authoringcoedit.ParseLifecycleState(state)
	if parseErr != nil {
		return parseErr
	}
	switch parsed {
	case authoringcoedit.StateClosed, authoringcoedit.StateActive, authoringcoedit.StateInitializing:
		return nil
	case authoringcoedit.StateFreezing, authoringcoedit.StateFrozen:
		if sameLifecycleOwner(owner, operation.FreezeOperationID) {
			return authoringcoedit.New(authoringcoedit.CodeFreezeConflict,
				"The collaboration freeze could not be released.")
		}
		return authoringcoedit.New(authoringcoedit.CodeFreezeConflict,
			"Another lifecycle operation owns this collaboration session.")
	default:
		return lifecycleStateError(state, operation.FreezeOperationID)
	}
}

// CoeditWorkspaceReopenActive is retained as a safe compatibility wrapper.
func (s *Service) CoeditWorkspaceReopenActive(ctx context.Context, documentIDs []string, operations ...authoringcoedit.CoeditLifecycleOperation) error {
	if len(documentIDs) == 0 {
		return nil
	}
	if len(operations) != 1 {
		return requireLifecycleOperation(authoringcoedit.CoeditLifecycleOperation{})
	}
	return s.CoeditWorkspaceAbortFreeze(ctx, documentIDs, operations[0])
}

func lifecycleExpiryTime(operation authoringcoedit.CoeditLifecycleOperation) time.Time {
	return time.Unix(operation.FreezeExpiresAt, 0).UTC()
}

func lifecycleLeaseActive(expiresAt *time.Time) bool {
	return expiresAt != nil && expiresAt.After(time.Now())
}

// CoeditRecoverExpiredFreezes reopens only durable freezing rows whose lease
// has definitely expired. Frozen rows are deliberately excluded: their final
// state is ambiguous and must be reconciled by an explicit lifecycle action.
func (s *Service) CoeditRecoverExpiredFreezes(ctx context.Context) ([]string, error) {
	var recovered []string
	err := s.runner.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		rows, err := q.QueryContext(ctx, `SELECT id FROM authoring_coedit_documents
 WHERE lifecycle_state = ? AND freeze_operation_id IS NOT NULL
   AND freeze_expires_at IS NOT NULL AND freeze_expires_at <= NOW(6)
 ORDER BY id FOR UPDATE`, string(authoringcoedit.StateFreezing))
		if err != nil {
			if isMissingTable(err) {
				return nil
			}
			return err
		}
		defer func() { _ = rows.Close() }()
		var ids []string
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				return err
			}
			ids = append(ids, id)
		}
		if err := rows.Err(); err != nil {
			return err
		}
		for _, id := range ids {
			result, err := q.ExecContext(ctx, `UPDATE authoring_coedit_documents
 SET lifecycle_state = ?, freeze_operation_id = NULL, freeze_expires_at = NULL, updated_at = NOW(6)
 WHERE id = ? AND lifecycle_state = ? AND freeze_operation_id IS NOT NULL
   AND freeze_expires_at IS NOT NULL AND freeze_expires_at <= NOW(6)`,
				string(authoringcoedit.StateActive), id, string(authoringcoedit.StateFreezing))
			if err != nil {
				return err
			}
			affected, err := result.RowsAffected()
			if err != nil {
				return err
			}
			if affected > 0 {
				recovered = append(recovered, id)
			}
		}
		return nil
	})
	if err == nil && len(recovered) > 0 {
		authoringcoedit.EmitFreezeRecovery()
	}
	return recovered, err
}

// CoeditWorkspaceRecoverExpiredFreezes is the v2 counterpart to
// CoeditRecoverExpiredFreezes. It intentionally has a separate method so a
// caller can report which room family recovered without inspecting table rows.
func (s *Service) CoeditWorkspaceRecoverExpiredFreezes(ctx context.Context) ([]string, error) {
	var recovered []string
	err := s.runner.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		rows, err := q.QueryContext(ctx, `SELECT id FROM authoring_coedit_workspaces
 WHERE lifecycle_state = ? AND freeze_operation_id IS NOT NULL
   AND freeze_expires_at IS NOT NULL AND freeze_expires_at <= NOW(6)
 ORDER BY id FOR UPDATE`, string(authoringcoedit.StateFreezing))
		if err != nil {
			if isMissingTable(err) {
				return nil
			}
			return err
		}
		defer func() { _ = rows.Close() }()
		var ids []string
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				return err
			}
			ids = append(ids, id)
		}
		if err := rows.Err(); err != nil {
			return err
		}
		for _, id := range ids {
			result, err := q.ExecContext(ctx, `UPDATE authoring_coedit_workspaces
 SET lifecycle_state = ?, freeze_operation_id = NULL, freeze_expires_at = NULL, updated_at = NOW(6)
 WHERE id = ? AND lifecycle_state = ? AND freeze_operation_id IS NOT NULL
   AND freeze_expires_at IS NOT NULL AND freeze_expires_at <= NOW(6)`,
				string(authoringcoedit.StateActive), id, string(authoringcoedit.StateFreezing))
			if err != nil {
				return err
			}
			affected, err := result.RowsAffected()
			if err != nil {
				return err
			}
			if affected > 0 {
				recovered = append(recovered, id)
			}
		}
		return nil
	})
	if err == nil && len(recovered) > 0 {
		authoringcoedit.EmitFreezeRecovery()
	}
	return recovered, err
}
