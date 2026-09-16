package authoring

import (
	"context"
	"database/sql"

	"example.com/ielts-proctoring/internal/authoringcoedit"
	"example.com/ielts-proctoring/internal/platform/tx"
)

// CoeditRebase durably installs a compacted prompt-room binary. The row lock,
// old hash, and old epoch form one compare-and-set boundary. Materialized
// question data and its domain revision are intentionally untouched.
func (s *Service) CoeditRebase(ctx context.Context, req CoeditRebaseRequest) (CoeditStoreResult, error) {
	if err := validateCoeditSizes(req.YdocState, req.StateVector, nil); err != nil {
		return CoeditStoreResult{}, err
	}
	_, id, err := authoringcoedit.ParseDocumentName(req.DocumentName)
	if err != nil {
		return CoeditStoreResult{}, authoringcoedit.New(authoringcoedit.CodeNotEditableDraft, "Unknown co-edit document.")
	}
	return s.coeditRebase(ctx, id, req)
}

func (s *Service) coeditRebase(ctx context.Context, id string, req CoeditRebaseRequest) (CoeditStoreResult, error) {
	expectedHash, err := decodeStateHash(req.ExpectedStateHash)
	if err != nil || len(expectedHash) == 0 {
		return CoeditStoreResult{}, authoringcoedit.New(authoringcoedit.CodePreviousHashMismatch,
			"The durable collaboration state changed; reload before compacting.")
	}
	newHash, err := decodeStateHash(req.StateHash)
	if err != nil || len(newHash) == 0 {
		return CoeditStoreResult{}, authoringcoedit.New(authoringcoedit.CodeRevisionConflict,
			"Collaboration state hash is invalid.")
	}
	expectedEpoch, ok := authoringcoedit.ParseDecimalString(string(req.ExpectedStateEpoch))
	if !ok {
		return CoeditStoreResult{}, authoringcoedit.New(authoringcoedit.CodeEpochMismatch,
			"The collaboration state epoch is invalid; reload before compacting.")
	}
	var out CoeditStoreResult
	err = s.runner.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		doc, err := selectCoeditDocumentByID(ctx, q, id, true)
		if err == sql.ErrNoRows {
			return authoringcoedit.New(authoringcoedit.CodeNotEditableDraft, "Unknown co-edit document.")
		}
		if err != nil {
			return err
		}
		switch doc.LifecycleState {
		case authoringcoedit.StateClosed:
			return authoringcoedit.New(authoringcoedit.CodeDocumentClosed, "This prompt's collaboration session was closed.")
		case authoringcoedit.StateFreezing, authoringcoedit.StateFrozen:
			return authoringcoedit.New(authoringcoedit.CodeDocumentFrozen, "This prompt is being published; try again in a moment.")
		}
		if doc.StateEpoch != expectedEpoch {
			return authoringcoedit.New(authoringcoedit.CodeEpochMismatch,
				"The collaboration state epoch is stale; reload before compacting.")
		}
		if !stringEqualBytes(doc.StateHash, expectedHash) {
			return authoringcoedit.New(authoringcoedit.CodePreviousHashMismatch,
				"The durable collaboration state changed; reload before compacting.")
		}
		result, err := q.ExecContext(ctx, `UPDATE authoring_coedit_documents
 SET ydoc_state = ?, state_vector = ?, previous_state_hash = state_hash,
     state_hash = ?, state_epoch = state_epoch + 1,
     commit_sequence = commit_sequence + 1, updated_at = NOW(6)
 WHERE id = ? AND state_epoch = ? AND state_hash = ?`,
			req.YdocState, req.StateVector, newHash, id, expectedEpoch, expectedHash)
		if err != nil {
			return err
		}
		affected, err := result.RowsAffected()
		if err != nil {
			return err
		}
		if affected == 0 {
			return authoringcoedit.New(authoringcoedit.CodeEpochMismatch,
				"The durable collaboration state changed; reload before compacting.")
		}
		doc.PreviousStateHash = append([]byte(nil), doc.StateHash...)
		doc.YdocState, doc.StateVector, doc.StateHash = req.YdocState, req.StateVector, newHash
		doc.StateEpoch++
		doc.CommitSequence++
		out = coeditResultFromDocument(doc, false)
		return nil
	})
	return out, err
}

// CoeditWorkspaceRebase is the v2 durable compaction boundary. It preserves
// workspace JSON, materialized revision, and all question-domain revisions.
func (s *Service) CoeditWorkspaceRebase(ctx context.Context, req CoeditRebaseRequest) (CoeditStoreResult, error) {
	if err := validateCoeditWorkspaceSizes(req.YdocState, req.StateVector, nil); err != nil {
		return CoeditStoreResult{}, err
	}
	_, id, err := authoringcoedit.ParseWorkspaceDocumentName(req.DocumentName)
	if err != nil {
		return CoeditStoreResult{}, authoringcoedit.New(authoringcoedit.CodeNotEditableDraft, "Unknown co-edit workspace.")
	}
	expectedHash, err := decodeStateHash(req.ExpectedStateHash)
	if err != nil || len(expectedHash) == 0 {
		return CoeditStoreResult{}, authoringcoedit.New(authoringcoedit.CodePreviousHashMismatch,
			"The durable collaboration state changed; reload before compacting.")
	}
	newHash, err := decodeStateHash(req.StateHash)
	if err != nil || len(newHash) == 0 {
		return CoeditStoreResult{}, authoringcoedit.New(authoringcoedit.CodeRevisionConflict,
			"Collaboration state hash is invalid.")
	}
	expectedEpoch, ok := authoringcoedit.ParseDecimalString(string(req.ExpectedStateEpoch))
	if !ok {
		return CoeditStoreResult{}, authoringcoedit.New(authoringcoedit.CodeEpochMismatch,
			"The collaboration state epoch is invalid; reload before compacting.")
	}
	var out CoeditStoreResult
	err = s.runner.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		doc, err := selectCoeditWorkspaceByID(ctx, q, id, true)
		if err == sql.ErrNoRows {
			return authoringcoedit.New(authoringcoedit.CodeNotEditableDraft, "Unknown co-edit workspace.")
		}
		if err != nil {
			return err
		}
		switch doc.LifecycleState {
		case authoringcoedit.StateClosed:
			return authoringcoedit.New(authoringcoedit.CodeDocumentClosed, "This SAT draft collaboration session was closed.")
		case authoringcoedit.StateFreezing, authoringcoedit.StateFrozen:
			return authoringcoedit.New(authoringcoedit.CodeDocumentFrozen, "This SAT draft is being published; try again in a moment.")
		}
		if doc.StateEpoch != expectedEpoch {
			return authoringcoedit.New(authoringcoedit.CodeEpochMismatch,
				"The collaboration state epoch is stale; reload before compacting.")
		}
		if !stringEqualBytes(doc.StateHash, expectedHash) {
			return authoringcoedit.New(authoringcoedit.CodePreviousHashMismatch,
				"The durable collaboration state changed; reload before compacting.")
		}
		result, err := q.ExecContext(ctx, `UPDATE authoring_coedit_workspaces
 SET ydoc_state = ?, state_vector = ?, previous_state_hash = state_hash,
     state_hash = ?, state_epoch = state_epoch + 1,
     commit_sequence = commit_sequence + 1, updated_at = NOW(6)
 WHERE id = ? AND state_epoch = ? AND state_hash = ?`,
			req.YdocState, req.StateVector, newHash, id, expectedEpoch, expectedHash)
		if err != nil {
			return err
		}
		affected, err := result.RowsAffected()
		if err != nil {
			return err
		}
		if affected == 0 {
			return authoringcoedit.New(authoringcoedit.CodeEpochMismatch,
				"The durable collaboration state changed; reload before compacting.")
		}
		doc.PreviousStateHash = append([]byte(nil), doc.StateHash...)
		doc.YdocState, doc.StateVector, doc.StateHash = req.YdocState, req.StateVector, newHash
		doc.StateEpoch++
		doc.CommitSequence++
		out = workspaceResultFromDocument(doc, false)
		return nil
	})
	return out, err
}
