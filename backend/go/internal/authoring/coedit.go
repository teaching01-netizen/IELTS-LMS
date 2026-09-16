package authoring

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"strings"
	"time"

	"example.com/ielts-proctoring/internal/authoringcoedit"
	"example.com/ielts-proctoring/internal/authoringrealtime"
	"example.com/ielts-proctoring/internal/platform/tx"
	"github.com/google/uuid"
)

// This file owns the Go half of prompt co-editing: the document row, the
// atomic prompt/revision/event store, the freeze/close lifecycle, the partial
// non-collaborative field patch, and the legacy full-save guard.
//
// Why it lives in the authoring package rather than authoringcoedit:
// assessment_question_revisions and the durable authoring event are owned
// here, and the design requires the binary Yjs state, the materialized prompt,
// the question revision bump, and the event row to commit in ONE transaction.
// Splitting them across packages would mean either exporting the tx-level
// helpers or accepting two commits, and the design explicitly forbids the
// second ("Single ownership per field", docs/sat-authoring-coedit.md).
//
// The protocol vocabulary (tokens, signatures, identity, control client,
// metrics) lives in authoringcoedit and is imported here.

// CoeditDocument is one persisted collaborative prompt row.
type CoeditDocument struct {
	ID                   string
	OrganizationID       *string
	ExamID               string
	DraftVersionID       string
	ExamQuestionID       string
	QuestionRevisionID   string
	SchemaVersion        int
	FieldSet             string
	LifecycleState       authoringcoedit.LifecycleState
	SeedRevision         int
	MaterializedRevision int
	YdocState            []byte
	StateVector          []byte
	StateHash            []byte
	PreviousStateHash    []byte
	ClosedReason         *string
	// LastActorID is the staff user the server last resolved for this room.
	// It is the attribution fallback for a store that arrives without an actor
	// (a lifecycle flush after the editor's connection context is gone).
	LastActorID string
	UpdatedAt   time.Time
	StateEpoch  uint64
	// CommitSequence orders every accepted durable Yjs state, including
	// workspace/UI-only commits that do not create a question revision.
	CommitSequence    uint64
	FreezeOperationID *string
	FreezeExpiresAt   *time.Time
}

const coeditDocumentColumns = `id, organization_id, exam_id, draft_version_id, exam_question_id,
 question_revision_id, schema_version, field_set, lifecycle_state, seed_revision,
 materialized_revision, ydoc_state, state_vector, state_hash, previous_state_hash,
 closed_reason, last_actor_id, updated_at, state_epoch, commit_sequence,
 freeze_operation_id, freeze_expires_at`

func scanCoeditDocument(row interface {
	Scan(dest ...any) error
}) (CoeditDocument, error) {
	var doc CoeditDocument
	var org, examQuestionID, questionRevisionID, closedReason, lastActor, freezeOperationID sql.NullString
	var freezeExpiresAt sql.NullTime
	var state string
	err := row.Scan(&doc.ID, &org, &doc.ExamID, &doc.DraftVersionID, &examQuestionID,
		&questionRevisionID, &doc.SchemaVersion, &doc.FieldSet, &state, &doc.SeedRevision,
		&doc.MaterializedRevision, &doc.YdocState, &doc.StateVector, &doc.StateHash,
		&doc.PreviousStateHash, &closedReason, &lastActor, &doc.UpdatedAt,
		&doc.StateEpoch, &doc.CommitSequence, &freezeOperationID, &freezeExpiresAt)
	if err != nil {
		return CoeditDocument{}, err
	}
	if org.Valid {
		value := org.String
		doc.OrganizationID = &value
	}
	if examQuestionID.Valid {
		doc.ExamQuestionID = examQuestionID.String
	}
	if questionRevisionID.Valid {
		doc.QuestionRevisionID = questionRevisionID.String
	}
	if closedReason.Valid {
		value := closedReason.String
		doc.ClosedReason = &value
	}
	if lastActor.Valid {
		doc.LastActorID = strings.TrimSpace(lastActor.String)
	}
	if freezeOperationID.Valid {
		value := strings.TrimSpace(freezeOperationID.String)
		if value != "" {
			doc.FreezeOperationID = &value
		}
	}
	if freezeExpiresAt.Valid {
		value := freezeExpiresAt.Time
		doc.FreezeExpiresAt = &value
	}
	parsed, err := authoringcoedit.ParseLifecycleState(state)
	if err != nil {
		return CoeditDocument{}, err
	}
	doc.LifecycleState = parsed
	return doc, nil
}

// CoeditSeed is the payload Hocuspocus converts into the initial `prompt`
// fragment when a document has no committed binary state yet.
type CoeditSeed struct {
	Prompt           json.RawMessage `json:"prompt"`
	QuestionRevision int             `json:"questionRevision"`
	SeedRevision     int             `json:"seedRevision"`
}

// CoeditLoadResult is the private load response. An empty Yjs document is
// never rendered as an editable prompt while seed status is unresolved, so
// either YdocState or Seed is always populated.
type CoeditLoadResult struct {
	DocumentName         string `json:"documentName"`
	LifecycleState       string `json:"lifecycleState"`
	YdocState            []byte `json:"ydocState"`
	StateVector          []byte `json:"stateVector"`
	StateHash            string `json:"stateHash"`
	MaterializedRevision int    `json:"materializedRevision"`
	QuestionRevision     int    `json:"questionRevision"`
	// These fields are additive during the epoch/sequence rollout. Workspace
	// callers must use WorkspaceRevision instead of treating a workspace commit
	// as a question revision.
	StateEpoch        authoringcoedit.DecimalString `json:"stateEpoch,omitempty"`
	CommitSequence    authoringcoedit.DecimalString `json:"commitSequence,omitempty"`
	WorkspaceRevision int                           `json:"workspaceRevision,omitempty"`
	FreezeOperationID string                        `json:"freezeOperationId,omitempty"`
	FreezeExpiresAt   int64                         `json:"freezeExpiresAt,omitempty"`
	SchemaVersion     int                           `json:"schemaVersion"`
	FieldSet          string                        `json:"fieldSet"`
	ClosedReason      *string                       `json:"closedReason"`
	Seed              *CoeditSeed                   `json:"seed"`
}

// CoeditInitializeRequest is the private initialize call. Go stores the binary
// and hash WITHOUT bumping the question revision, because the materialized
// prompt is unchanged by seeding.
type CoeditInitializeRequest struct {
	DocumentName string
	YdocState    []byte
	StateVector  []byte
	StateHash    string
	Prompt       json.RawMessage
	// Workspace is populated only by the v2 exam-level room. Keeping it on the
	// shared request avoids a second private wire contract while v1 callers
	// continue to send Prompt.
	Workspace json.RawMessage
	ActorID   string
}

// CoeditStoreRequest is the private store call.
type CoeditStoreRequest struct {
	DocumentName      string
	PreviousStateHash string
	StateHash         string
	YdocState         []byte
	StateVector       []byte
	Prompt            json.RawMessage
	Workspace         json.RawMessage
	ActorID           string
	FreezeOperationID string
}

// CoeditStoreResult is the private store acknowledgement. The service turns it
// into the stateless browser `coedit.ack` frame and attaches the committed
// state VECTOR, which is the identity a browser compares against its own to
// decide Saved (see docs/sat-authoring-coedit.md). StateHash is durable
// provenance stored beside the binary; it never decides Saved.
type CoeditStoreResult struct {
	DocumentName         string                        `json:"documentName"`
	StateHash            string                        `json:"stateHash"`
	QuestionRevision     int                           `json:"questionRevision"`
	MaterializedRevision int                           `json:"materializedRevision"`
	StateEpoch           authoringcoedit.DecimalString `json:"stateEpoch,omitempty"`
	CommitSequence       authoringcoedit.DecimalString `json:"commitSequence,omitempty"`
	WorkspaceRevision    int                           `json:"workspaceRevision,omitempty"`
	FreezeOperationID    string                        `json:"freezeOperationId,omitempty"`
	FreezeExpiresAt      int64                         `json:"freezeExpiresAt,omitempty"`
	// Committed is false when the incoming state hash was already current
	// (idempotent replay) or when the request only seeded the document.
	Committed bool `json:"committed"`
	Duplicate bool `json:"duplicate"`
}

// CoeditRebaseRequest replaces a compacted durable Y.Doc under an explicit
// old-hash/epoch fence. It intentionally carries no prompt or workspace
// projection: compaction changes the binary representation, not domain data.
type CoeditRebaseRequest struct {
	DocumentName       string
	ExpectedStateHash  string
	ExpectedStateEpoch authoringcoedit.DecimalString
	StateHash          string
	YdocState          []byte
	StateVector        []byte
}

// coeditQuestionContext is the server-resolved binding for one exam question.
type coeditQuestionContext struct {
	ExamQuestionID     string
	QuestionID         string
	QuestionRevisionID string
	QuestionRevision   int
	Prompt             json.RawMessage
	DraftVersionID     string
	ExamID             string
	OrganizationID     *string
	ModuleID           string
}

// coeditDocumentColumns is the shared SELECT list for authoring_coedit_documents.
//
// resolveCoeditQuestionContextDoc is intentionally absent: the binding
// resolver lives next to it so the SELECT list and the struct stay in one
// place.

// resolveCoeditQuestionContext resolves the current editable-draft binding for
// an exam question. A question that is not in the current draft is refused:
// co-editing a published or replaced revision would bind a room to state that
// can never be published.
func resolveCoeditQuestionContext(ctx context.Context, q tx.Tx, examQuestionID string) (coeditQuestionContext, error) {
	var out coeditQuestionContext
	var org sql.NullString
	err := q.QueryRowContext(ctx, `SELECT eq.id, eq.question_id, eq.question_revision_id, eq.module_id,
       r.revision, CAST(r.prompt AS CHAR), v.id, e.id, e.organization_id
  FROM assessment_exam_questions eq
  JOIN assessment_question_revisions r ON r.id = eq.question_revision_id
  JOIN assessment_modules m ON m.id = eq.module_id
  JOIN assessment_sections s ON s.id = m.section_id
  JOIN exam_versions v ON v.id = s.exam_version_id
  JOIN exam_entities e ON e.id = v.exam_id
  WHERE eq.id = ? AND v.is_draft = TRUE AND v.is_published = FALSE
    AND e.current_draft_version_id = v.id
  FOR UPDATE`, strings.TrimSpace(examQuestionID)).Scan(&out.ExamQuestionID, &out.QuestionID,
		&out.QuestionRevisionID, &out.ModuleID, &out.QuestionRevision, &out.Prompt,
		&out.DraftVersionID, &out.ExamID, &org)
	if err == sql.ErrNoRows {
		return coeditQuestionContext{}, authoringcoedit.New(
			authoringcoedit.CodeNotEditableDraft,
			"Only questions in the current editable draft can be co-edited.")
	}
	if err != nil {
		return coeditQuestionContext{}, err
	}
	if org.Valid {
		value := org.String
		out.OrganizationID = &value
	}
	return out, nil
}

func coeditIdentityFromDocument(doc CoeditDocument) authoringcoedit.Identity {
	name, _ := authoringcoedit.NewDocumentName(doc.ID)
	var closed *authoringcoedit.CloseReason
	if doc.ClosedReason != nil {
		if reason := authoringcoedit.CloseReason(*doc.ClosedReason); reason.Valid() {
			closed = &reason
		}
	}
	return authoringcoedit.Identity{
		DocumentID:           doc.ID,
		DocumentName:         name,
		OrganizationID:       doc.OrganizationID,
		ExamID:               doc.ExamID,
		DraftVersionID:       doc.DraftVersionID,
		ExamQuestionID:       doc.ExamQuestionID,
		QuestionRevisionID:   doc.QuestionRevisionID,
		SchemaVersion:        doc.SchemaVersion,
		FieldSet:             doc.FieldSet,
		LifecycleState:       doc.LifecycleState,
		SeedRevision:         doc.SeedRevision,
		MaterializedRevision: doc.MaterializedRevision,
		ClosedReason:         closed,
		StateEpoch:           coeditDecimal(doc.StateEpoch),
		CommitSequence:       coeditDecimal(doc.CommitSequence),
	}
}

// CoeditEnsureDocument creates or loads the document row for a question that
// belongs to the current editable draft. It is the only writer of new rows,
// and its uniqueness race is resolved by re-selecting the winner.
func (s *Service) CoeditEnsureDocument(ctx context.Context, examQuestionID, actorID string) (authoringcoedit.Identity, error) {
	var out authoringcoedit.Identity
	err := s.runner.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		binding, err := resolveCoeditQuestionContext(ctx, q, examQuestionID)
		if err != nil {
			return err
		}
		existing, err := selectCoeditDocumentForScope(ctx, q, binding.DraftVersionID, binding.ExamQuestionID)
		if err != nil && !isCoeditNoRows(err) {
			return err
		}
		if err == nil {
			if existing.LifecycleState == authoringcoedit.StateClosed {
				return authoringcoedit.New(authoringcoedit.CodeDocumentClosed,
					"This prompt's collaboration session was closed; reopen the draft to start a new one.")
			}
			out = coeditIdentityFromDocument(existing)
			return nil
		}
		id := uuid.NewString()
		_, err = q.ExecContext(ctx, `INSERT INTO authoring_coedit_documents
 (id, organization_id, exam_id, draft_version_id, exam_question_id, question_revision_id,
  schema_version, field_set, lifecycle_state, seed_revision, materialized_revision,
  created_at, updated_at, last_actor_id)
 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(6), NOW(6), ?)`,
			id, binding.OrganizationID, binding.ExamID, binding.DraftVersionID, binding.ExamQuestionID,
			binding.QuestionRevisionID, authoringcoedit.SchemaVersion, authoringcoedit.FieldSetPrompt,
			string(authoringcoedit.StateInitializing), binding.QuestionRevision, binding.QuestionRevision,
			actorID)
		if err != nil {
			// Uniqueness race: another request created the row first. Re-read
			// the winner rather than applying a second seed.
			winner, readErr := selectCoeditDocumentForScope(ctx, q, binding.DraftVersionID, binding.ExamQuestionID)
			if readErr != nil {
				return err
			}
			out = coeditIdentityFromDocument(winner)
			return nil
		}
		doc := CoeditDocument{
			ID:                   id,
			OrganizationID:       binding.OrganizationID,
			ExamID:               binding.ExamID,
			DraftVersionID:       binding.DraftVersionID,
			ExamQuestionID:       binding.ExamQuestionID,
			QuestionRevisionID:   binding.QuestionRevisionID,
			SchemaVersion:        authoringcoedit.SchemaVersion,
			FieldSet:             authoringcoedit.FieldSetPrompt,
			LifecycleState:       authoringcoedit.StateInitializing,
			SeedRevision:         binding.QuestionRevision,
			MaterializedRevision: binding.QuestionRevision,
		}
		out = coeditIdentityFromDocument(doc)
		return nil
	})
	if err != nil {
		return authoringcoedit.Identity{}, err
	}
	return out, nil
}

func selectCoeditDocumentForScope(ctx context.Context, q tx.Tx, draftVersionID, examQuestionID string) (CoeditDocument, error) {
	query := `SELECT ` + coeditDocumentColumns + ` FROM authoring_coedit_documents
 WHERE draft_version_id = ? AND exam_question_id = ? AND schema_version = ? FOR UPDATE`
	doc, err := scanCoeditDocument(q.QueryRowContext(ctx, query, draftVersionID, examQuestionID, authoringcoedit.SchemaVersion))
	if err != nil {
		return CoeditDocument{}, err
	}
	return doc, nil
}

func selectCoeditDocumentByID(ctx context.Context, q tx.Tx, id string, lock bool) (CoeditDocument, error) {
	query := `SELECT ` + coeditDocumentColumns + ` FROM authoring_coedit_documents WHERE id = ?`
	if lock {
		query += " FOR UPDATE"
	}
	return scanCoeditDocument(q.QueryRowContext(ctx, query, id))
}

func isCoeditNoRows(err error) bool { return err == sql.ErrNoRows }

// CoeditLoad resolves a document for the Hocuspocus service. It returns the
// committed binary state when one exists, otherwise the seed the service must
// convert into the prompt fragment.
func (s *Service) CoeditLoad(ctx context.Context, documentName string) (CoeditLoadResult, error) {
	_, id, err := authoringcoedit.ParseDocumentName(documentName)
	if err != nil {
		return CoeditLoadResult{}, authoringcoedit.New(authoringcoedit.CodeNotEditableDraft, "Unknown co-edit document.")
	}
	doc, err := s.coeditLoadDocument(ctx, id)
	if err != nil {
		return CoeditLoadResult{}, err
	}
	return s.coeditBuildLoadResult(ctx, doc)
}

func (s *Service) coeditLoadDocument(ctx context.Context, id string) (CoeditDocument, error) {
	var doc CoeditDocument
	err := s.runner.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		loaded, err := selectCoeditDocumentByID(ctx, q, id, false)
		if err != nil {
			if err == sql.ErrNoRows {
				return authoringcoedit.New(authoringcoedit.CodeNotEditableDraft, "Unknown co-edit document.")
			}
			return err
		}
		doc = loaded
		return nil
	})
	if err != nil {
		return CoeditDocument{}, err
	}
	return doc, nil
}

func (s *Service) coeditBuildLoadResult(ctx context.Context, doc CoeditDocument) (CoeditLoadResult, error) {
	out := CoeditLoadResult{
		DocumentName:         string(mustDocumentName(doc.ID)),
		LifecycleState:       string(doc.LifecycleState),
		YdocState:            doc.YdocState,
		StateVector:          doc.StateVector,
		StateHash:            hex.EncodeToString(doc.StateHash),
		MaterializedRevision: doc.MaterializedRevision,
		QuestionRevision:     doc.MaterializedRevision,
		StateEpoch:           coeditDecimal(doc.StateEpoch),
		CommitSequence:       coeditDecimal(doc.CommitSequence),
		FreezeOperationID:    coeditFreezeOperationID(doc),
		FreezeExpiresAt:      coeditFreezeExpiresAt(doc),
		SchemaVersion:        doc.SchemaVersion,
		FieldSet:             doc.FieldSet,
		ClosedReason:         doc.ClosedReason,
	}
	if doc.LifecycleState == authoringcoedit.StateClosed {
		return CoeditLoadResult{}, authoringcoedit.New(authoringcoedit.CodeDocumentClosed,
			"This prompt's collaboration session was closed.")
	}
	if len(doc.YdocState) > 0 {
		return out, nil
	}
	// No binary state yet: hand the service the current prompt so it can seed.
	seed, err := s.coeditCurrentPrompt(ctx, doc)
	if err != nil {
		return CoeditLoadResult{}, err
	}
	out.Seed = &seed
	return out, nil
}

func mustDocumentName(id string) authoringcoedit.DocumentName {
	name, _ := authoringcoedit.NewDocumentName(id)
	return name
}

// coeditCurrentPrompt re-reads the current prompt under the row's binding. If
// the question mapping changed, the room must be reloaded rather than seeded
// from a revision the document does not describe.
func (s *Service) coeditCurrentPrompt(ctx context.Context, doc CoeditDocument) (CoeditSeed, error) {
	var seed CoeditSeed
	err := s.runner.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		binding, err := resolveCoeditQuestionContext(ctx, q, doc.ExamQuestionID)
		if err != nil {
			return err
		}
		if binding.DraftVersionID != doc.DraftVersionID {
			return authoringcoedit.New(authoringcoedit.CodeRevisionConflict,
				"The working draft changed; reopen the editor.")
		}
		if binding.QuestionRevisionID != doc.QuestionRevisionID {
			return authoringcoedit.New(authoringcoedit.CodeRevisionConflict,
				"Question changed while you were away; refresh before retrying.")
		}
		seed = CoeditSeed{
			Prompt:           binding.Prompt,
			QuestionRevision: binding.QuestionRevision,
			SeedRevision:     doc.SeedRevision,
		}
		return nil
	})
	if err != nil {
		return CoeditSeed{}, err
	}
	return seed, nil
}

// CoeditInitialize stores freshly seeded binary state without bumping the
// question revision: the materialized prompt is unchanged by seeding.
func (s *Service) CoeditInitialize(ctx context.Context, req CoeditInitializeRequest) (CoeditStoreResult, error) {
	if err := validateCoeditSizes(req.YdocState, req.StateVector, req.Prompt); err != nil {
		return CoeditStoreResult{}, err
	}
	_, id, err := authoringcoedit.ParseDocumentName(req.DocumentName)
	if err != nil {
		return CoeditStoreResult{}, authoringcoedit.New(authoringcoedit.CodeNotEditableDraft, "Unknown co-edit document.")
	}
	var out CoeditStoreResult
	err = s.runner.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		doc, err := selectCoeditDocumentByID(ctx, q, id, true)
		if err != nil {
			if err == sql.ErrNoRows {
				return authoringcoedit.New(authoringcoedit.CodeNotEditableDraft, "Unknown co-edit document.")
			}
			return err
		}
		if doc.LifecycleState == authoringcoedit.StateClosed {
			return authoringcoedit.New(authoringcoedit.CodeDocumentClosed, "This prompt's collaboration session was closed.")
		}
		if !authoringcoedit.CanTransition(doc.LifecycleState, authoringcoedit.StateActive) {
			return authoringcoedit.New(authoringcoedit.CodeDocumentFrozen, "This prompt is being published; try again in a moment.")
		}
		if doc.LifecycleState == authoringcoedit.StateFreezing || doc.LifecycleState == authoringcoedit.StateFrozen {
			return authoringcoedit.New(authoringcoedit.CodeDocumentFrozen, "This prompt is being published; try again in a moment.")
		}
		if err := s.assertCoeditBindingLocked(ctx, q, doc); err != nil {
			return err
		}
		// Compare-and-set: an existing binary state means another seed won.
		if len(doc.YdocState) > 0 {
			out = coeditResultFromDocument(doc, true)
			return nil
		}
		if doc.LifecycleState == authoringcoedit.StateInitializing {
			binding, err := resolveCoeditQuestionContext(ctx, q, doc.ExamQuestionID)
			if err != nil {
				return err
			}
			if binding.QuestionRevision != doc.SeedRevision {
				return authoringcoedit.New(authoringcoedit.CodeSeedConflict,
					"Question changed before collaboration could start; refresh before retrying.")
			}
		}
		hash, err := decodeStateHash(req.StateHash)
		if err != nil {
			return err
		}
		if _, err := q.ExecContext(ctx, `UPDATE authoring_coedit_documents
	 SET ydoc_state = ?, state_vector = ?, state_hash = ?, lifecycle_state = ?,
	     commit_sequence = commit_sequence + 1, last_actor_id = ?, updated_at = NOW(6)
	 WHERE id = ?`, req.YdocState, req.StateVector, hash, string(authoringcoedit.StateActive), req.ActorID, id); err != nil {
			return err
		}
		doc.YdocState = req.YdocState
		doc.StateVector = req.StateVector
		doc.StateHash = hash
		doc.LifecycleState = authoringcoedit.StateActive
		doc.CommitSequence++
		out = coeditResultFromDocument(doc, false)
		return nil
	})
	if err != nil {
		return CoeditStoreResult{}, err
	}
	return out, nil
}

// assertCoeditBindingLocked refuses a document whose draft or question
// revision mapping moved on, or whose draft is no longer the current draft.
func (s *Service) assertCoeditBindingLocked(ctx context.Context, q tx.Tx, doc CoeditDocument) error {
	var currentDraft, currentRevisionID sql.NullString
	var isDraft bool
	err := q.QueryRowContext(ctx, `SELECT e.current_draft_version_id, v.is_draft, eq.question_revision_id
  FROM assessment_exam_questions eq
  JOIN assessment_modules m ON m.id = eq.module_id
  JOIN assessment_sections s ON s.id = m.section_id
  JOIN exam_versions v ON v.id = s.exam_version_id
  JOIN exam_entities e ON e.id = v.exam_id
  WHERE eq.id = ?`, doc.ExamQuestionID).Scan(&currentDraft, &isDraft, &currentRevisionID)
	if err == sql.ErrNoRows {
		return authoringcoedit.New(authoringcoedit.CodeNotEditableDraft, "Question no longer exists.")
	}
	if err != nil {
		return err
	}
	if !isDraft || !currentDraft.Valid || currentDraft.String != doc.DraftVersionID {
		return authoringcoedit.New(authoringcoedit.CodeRevisionConflict,
			"The working draft changed; reopen the editor.")
	}
	if currentRevisionID.Valid && currentRevisionID.String != doc.QuestionRevisionID {
		return authoringcoedit.New(authoringcoedit.CodeRevisionConflict,
			"Question changed while you were editing; refresh before retrying.")
	}
	return nil
}

// CoeditStore commits a collaborative prompt change while the durable row is
// active. A freezing row must use CoeditFinalStore; ordinary stores remain
// rejected so a stale connection cannot cross the lifecycle fence.
func (s *Service) CoeditStore(ctx context.Context, req CoeditStoreRequest) (CoeditStoreResult, error) {
	return s.coeditStore(ctx, req, false)
}

// CoeditFinalStore commits the last state observed by an owned freeze. It
// shares the ordinary prompt/hash/projection/event transaction but deliberately
// leaves the row in freezing until the lifecycle owner closes or aborts it.
func (s *Service) CoeditFinalStore(ctx context.Context, req CoeditStoreRequest) (CoeditStoreResult, error) {
	return s.coeditStore(ctx, req, true)
}

func (s *Service) coeditStore(ctx context.Context, req CoeditStoreRequest, final bool) (CoeditStoreResult, error) {
	if err := validateCoeditSizes(req.YdocState, req.StateVector, req.Prompt); err != nil {
		return CoeditStoreResult{}, err
	}
	_, id, err := authoringcoedit.ParseDocumentName(req.DocumentName)
	if err != nil {
		return CoeditStoreResult{}, authoringcoedit.New(authoringcoedit.CodeNotEditableDraft, "Unknown co-edit document.")
	}
	if final && strings.TrimSpace(req.FreezeOperationID) == "" {
		return CoeditStoreResult{}, authoringcoedit.New(authoringcoedit.CodeFreezeConflict,
			"A freeze operation is required for the final store.")
	}
	emission := &eventEmission{}
	var out CoeditStoreResult
	txErr := s.runner.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		doc, err := selectCoeditDocumentByID(ctx, q, id, true)
		if err != nil {
			if err == sql.ErrNoRows {
				return authoringcoedit.New(authoringcoedit.CodeNotEditableDraft, "Unknown co-edit document.")
			}
			return err
		}
		if doc.LifecycleState == authoringcoedit.StateClosed {
			return authoringcoedit.New(authoringcoedit.CodeDocumentClosed, "This prompt's collaboration session was closed.")
		}
		if final {
			if doc.LifecycleState != authoringcoedit.StateFreezing {
				return authoringcoedit.New(authoringcoedit.CodeFinalStoreRequired,
					"The final store is only valid for a freezing collaboration session.")
			}
			if coeditFreezeOperationID(doc) != strings.TrimSpace(req.FreezeOperationID) {
				return authoringcoedit.New(authoringcoedit.CodeFreezeConflict,
					"Another lifecycle operation owns this collaboration session.")
			}
			if !lifecycleLeaseActive(doc.FreezeExpiresAt) {
				return authoringcoedit.New(authoringcoedit.CodeFreezeConflict,
					"The collaboration freeze lease has expired; start a new lifecycle operation.")
			}
		} else {
			switch doc.LifecycleState {
			case authoringcoedit.StateFreezing, authoringcoedit.StateFrozen:
				return authoringcoedit.New(authoringcoedit.CodeDocumentFrozen, "This prompt is being published; try again in a moment.")
			}
		}
		if err := s.assertCoeditBindingLocked(ctx, q, doc); err != nil {
			return err
		}
		incomingHash, err := decodeStateHash(req.StateHash)
		if err != nil {
			return err
		}
		// Idempotent same-hash store: acknowledge without a revision bump or
		// sequence change. The response still carries the current fence metadata.
		if len(doc.StateHash) > 0 && stringEqualBytes(doc.StateHash, incomingHash) {
			out = coeditResultFromDocument(doc, true)
			return nil
		}
		if len(doc.StateHash) > 0 {
			previous, err := decodeStateHash(req.PreviousStateHash)
			if err != nil || !stringEqualBytes(doc.StateHash, previous) {
				return authoringcoedit.New(authoringcoedit.CodePreviousHashMismatch,
					"Collaboration state advanced elsewhere; reload the prompt before continuing.")
			}
		}
		if doc.LifecycleState == authoringcoedit.StateInitializing {
			binding, err := resolveCoeditQuestionContext(ctx, q, doc.ExamQuestionID)
			if err != nil {
				return err
			}
			if binding.QuestionRevision != doc.SeedRevision {
				return authoringcoedit.New(authoringcoedit.CodeSeedConflict,
					"Question changed before collaboration could start; refresh before retrying.")
			}
		}
		actorID := strings.TrimSpace(req.ActorID)
		if actorID == "" {
			actorID = doc.LastActorID
		}
		if err := touchQuestionDraft(ctx, q, doc.ExamQuestionID); err != nil {
			return err
		}
		var newRevision int
		if _, err := q.ExecContext(ctx, `UPDATE assessment_question_revisions
 SET prompt = ?, revision = revision + 1, state = 'draft', sealed_at = NULL, updated_by = ?, updated_at = NOW(6)
 WHERE id = ?`, nonEmptyJSON(req.Prompt), actorID, doc.QuestionRevisionID); err != nil {
			return err
		}
		if err := q.QueryRowContext(ctx, `SELECT revision FROM assessment_question_revisions WHERE id = ?`, doc.QuestionRevisionID).Scan(&newRevision); err != nil {
			return err
		}
		lifecycle := authoringcoedit.StateActive
		if final {
			lifecycle = authoringcoedit.StateFreezing
		}
		if _, err := q.ExecContext(ctx, `UPDATE authoring_coedit_documents
 SET ydoc_state = ?, state_vector = ?, previous_state_hash = state_hash, state_hash = ?,
     lifecycle_state = ?, materialized_revision = ?, commit_sequence = commit_sequence + 1,
     last_actor_id = ?, updated_at = NOW(6)
 WHERE id = ?`, req.YdocState, req.StateVector, incomingHash, string(lifecycle),
			newRevision, actorID, id); err != nil {
			return err
		}
		if s.eventsOn() && actorID != "" {
			scope, err := resolveQuestionScopeTx(ctx, q, doc.ExamQuestionID)
			if err != nil {
				return err
			}
			questionID, moduleID, err := coeditEventHints(ctx, q, doc.ExamQuestionID)
			if err != nil {
				return err
			}
			source := "coedit_store"
			if final {
				source = "coedit_final_store"
			}
			if err := s.appendAuthoringEventTx(ctx, q, emission, source, scope, authoringrealtime.EventInput{
				Kind:    authoringrealtime.KindQuestionChanged,
				ActorID: actorID,
				Entity: authoringrealtime.Entity{
					Kind:           authoringrealtime.EntityQuestion,
					ExamQuestionID: doc.ExamQuestionID,
					QuestionID:     strPtr(questionID),
					ModuleID:       strPtr(moduleID),
				},
				Revision:      newRevision,
				ChangedFields: authoringrealtime.NewChangedFields("prompt"),
				CausationID:   coeditCausationID(incomingHash),
			}); err != nil {
				return err
			}
		}
		doc.PreviousStateHash = append([]byte(nil), doc.StateHash...)
		doc.YdocState = req.YdocState
		doc.StateVector = req.StateVector
		doc.StateHash = incomingHash
		doc.MaterializedRevision = newRevision
		doc.CommitSequence++
		doc.LifecycleState = lifecycle
		out = coeditResultFromDocument(doc, false)
		return nil
	})
	emission.flush(txErr)
	if txErr != nil {
		return CoeditStoreResult{}, txErr
	}
	return out, nil
}

// coeditEventHints resolves the question id and module id hints the content-free
// event carries. Ids only: the payload never includes prompt content.
func coeditEventHints(ctx context.Context, q tx.Tx, examQuestionID string) (string, string, error) {
	var questionID, moduleID string
	if err := q.QueryRowContext(ctx, `SELECT question_id, module_id FROM assessment_exam_questions WHERE id = ?`, examQuestionID).Scan(&questionID, &moduleID); err != nil {
		if err == sql.ErrNoRows {
			return "", "", notFoundError("Question not found.")
		}
		return "", "", err
	}
	return questionID, moduleID, nil
}

func coeditCausationID(stateHash []byte) string {
	encoded := hex.EncodeToString(stateHash)
	if len(encoded) > 16 {
		encoded = encoded[:16]
	}
	return "coedit:" + encoded
}

func coeditResultFromDocument(doc CoeditDocument, duplicate bool) CoeditStoreResult {
	return CoeditStoreResult{
		DocumentName:         string(mustDocumentName(doc.ID)),
		StateHash:            hex.EncodeToString(doc.StateHash),
		QuestionRevision:     doc.MaterializedRevision,
		MaterializedRevision: doc.MaterializedRevision,
		StateEpoch:           coeditDecimal(doc.StateEpoch),
		CommitSequence:       coeditDecimal(doc.CommitSequence),
		FreezeOperationID:    coeditFreezeOperationID(doc),
		FreezeExpiresAt:      coeditFreezeExpiresAt(doc),
		Committed:            !duplicate,
		Duplicate:            duplicate,
	}
}

func validateCoeditSizes(ydoc, vector, prompt []byte) error {
	if len(ydoc) > authoringcoedit.MaxYdocStateBytes {
		return authoringcoedit.New(authoringcoedit.CodeOversized,
			"Collaboration state is too large to save. Remove some content and try again.")
	}
	if len(vector) > authoringcoedit.MaxStateVectorBytes {
		return authoringcoedit.New(authoringcoedit.CodeOversized,
			"Collaboration state vector is too large to save.")
	}
	if len(prompt) > authoringcoedit.MaxPromptJSONBytes {
		return authoringcoedit.New(authoringcoedit.CodeOversized,
			"Prompt is too large to save. Split the question or remove content.")
	}
	return nil
}

func decodeStateHash(raw string) ([]byte, error) {
	trimmed := strings.TrimSpace(strings.ToLower(raw))
	if trimmed == "" {
		return nil, nil
	}
	decoded, err := hex.DecodeString(trimmed)
	if err != nil || len(decoded) != sha256.Size {
		return nil, authoringcoedit.New(authoringcoedit.CodeRevisionConflict, "Collaboration state hash is invalid.")
	}
	return decoded, nil
}

func stringEqualBytes(a, b []byte) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// activeCoeditRoomQuery is the ONE definition of "an unclosed room covers this
// exam question". There are two room families and both own question content:
//
//   - v1 question-scoped prompt documents (authoring_coedit_documents), and
//   - v2 exam-level workspace rooms (authoring_coedit_workspaces), which carry
//     the question's rich roots AND its scalar record, so they own the same
//     columns a legacy full-revision save writes.
//
// A guard that listed only the first family was blind to the second: an active
// exam room accepted a legacy prompt-bearing write and the stale full-column
// snapshot then raced the CRDT store. Both the read-only pre-check and the
// in-transaction guard run THIS query, so they cannot disagree.
const activeCoeditRoomQuery = `SELECT COUNT(*) FROM (
 SELECT id FROM authoring_coedit_documents
  WHERE exam_question_id = ? AND lifecycle_state <> ?
 UNION ALL
 SELECT w.id
   FROM authoring_coedit_workspaces w
   JOIN exam_entities e ON e.id = w.exam_id
   JOIN exam_versions v ON v.id = w.draft_version_id
   JOIN assessment_sections s ON s.exam_version_id = v.id
   JOIN assessment_modules m ON m.section_id = s.id
   JOIN assessment_exam_questions eq ON eq.module_id = m.id
  WHERE eq.id = ? AND v.is_draft = TRUE AND v.is_published = FALSE
    AND e.current_draft_version_id = v.id
    AND w.lifecycle_state <> ?
) active_rooms`

// activeCoeditRoomExistsTx answers activeCoeditRoomQuery on any handle: a
// *sql.DB for the pre-check, or the save transaction's own Tx so a staggered
// deployment cannot interleave a legacy write with a collaborative one.
//
// A missing table means the migration is not applied; that is not "an active
// room", so it must not block a legacy write.
func activeCoeditRoomExistsTx(ctx context.Context, q tx.Tx, examQuestionID string) (bool, error) {
	id := strings.TrimSpace(examQuestionID)
	var count int
	if err := q.QueryRowContext(ctx, activeCoeditRoomQuery,
		id, string(authoringcoedit.StateClosed),
		id, string(authoringcoedit.StateClosed)).Scan(&count); err != nil {
		if isMissingTable(err) {
			return false, nil
		}
		return false, err
	}
	return count > 0, nil
}

// CoeditActiveForQuestion reports whether an unclosed room exists for an exam
// question. The legacy full-revision save path refuses a prompt-bearing write
// while this is true, so a mixed-version client cannot silently clobber a
// collaborative prompt.
func (s *Service) CoeditActiveForQuestion(ctx context.Context, examQuestionID string) (bool, error) {
	if s == nil || s.db == nil {
		return false, nil
	}
	return activeCoeditRoomExistsTx(ctx, s.db, examQuestionID)
}

// CoeditActiveDocuments lists unclosed documents for a draft (freeze inputs).
func (s *Service) CoeditActiveDocuments(ctx context.Context, draftVersionID string) ([]CoeditDocument, error) {
	if s == nil || s.db == nil {
		return nil, nil
	}
	rows, err := s.db.QueryContext(ctx, `WITH coedit_scope AS (SELECT ? AS scope_id, ? AS closed_state)
 SELECT `+coeditDocumentColumns+` FROM authoring_coedit_documents
 WHERE draft_version_id = (SELECT scope_id FROM coedit_scope)
   AND lifecycle_state <> (SELECT closed_state FROM coedit_scope)
 UNION ALL
	 SELECT id, organization_id, exam_id, draft_version_id, NULL, NULL,
	        schema_version, field_set, lifecycle_state, 0, materialized_revision,
	        ydoc_state, state_vector, state_hash, previous_state_hash,
	        closed_reason, last_actor_id, updated_at, state_epoch, commit_sequence,
	        freeze_operation_id, freeze_expires_at
   FROM authoring_coedit_workspaces
  WHERE draft_version_id = (SELECT scope_id FROM coedit_scope)
    AND lifecycle_state <> (SELECT closed_state FROM coedit_scope) ORDER BY id ASC`,
		strings.TrimSpace(draftVersionID), string(authoringcoedit.StateClosed))
	if err != nil {
		if isMissingTable(err) {
			return nil, nil
		}
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var out []CoeditDocument
	for rows.Next() {
		doc, err := scanCoeditDocument(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, doc)
	}
	return out, rows.Err()
}

// CoeditDocumentsForExam lists unclosed documents for an exam, used by the
// publish path when only the exam id is known.
func (s *Service) CoeditDocumentsForExam(ctx context.Context, examID string) ([]CoeditDocument, error) {
	if s == nil || s.db == nil {
		return nil, nil
	}
	rows, err := s.db.QueryContext(ctx, `WITH coedit_scope AS (SELECT ? AS scope_id, ? AS closed_state)
 SELECT `+coeditDocumentColumns+` FROM authoring_coedit_documents
 WHERE exam_id = (SELECT scope_id FROM coedit_scope)
   AND lifecycle_state <> (SELECT closed_state FROM coedit_scope)
 UNION ALL
	 SELECT id, organization_id, exam_id, draft_version_id, NULL, NULL,
	        schema_version, field_set, lifecycle_state, 0, materialized_revision,
	        ydoc_state, state_vector, state_hash, previous_state_hash,
	        closed_reason, last_actor_id, updated_at, state_epoch, commit_sequence,
	        freeze_operation_id, freeze_expires_at
   FROM authoring_coedit_workspaces
  WHERE exam_id = (SELECT scope_id FROM coedit_scope)
    AND lifecycle_state <> (SELECT closed_state FROM coedit_scope) ORDER BY id ASC`,
		strings.TrimSpace(examID), string(authoringcoedit.StateClosed))
	if err != nil {
		if isMissingTable(err) {
			return nil, nil
		}
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var out []CoeditDocument
	for rows.Next() {
		doc, err := scanCoeditDocument(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, doc)
	}
	return out, rows.Err()
}

// CoeditCloseDocuments closes documents with a closed-vocabulary reason.
func (s *Service) CoeditCloseDocuments(ctx context.Context, documentIDs []string, reason authoringcoedit.CloseReason) error {
	if len(documentIDs) == 0 {
		return nil
	}
	if !reason.Valid() {
		return authoringcoedit.New(authoringcoedit.CodeDisabled, "Unknown co-edit close reason.")
	}
	return s.runner.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		for _, id := range documentIDs {
			if _, err := q.ExecContext(ctx, `UPDATE authoring_coedit_documents
 SET lifecycle_state = ?, closed_reason = ?, closed_at = NOW(6), updated_at = NOW(6)
 WHERE id = ? AND lifecycle_state <> ?`,
				string(authoringcoedit.StateClosed), string(reason), id,
				string(authoringcoedit.StateClosed)); err != nil {
				return err
			}
		}
		return nil
	})
}

// CoeditCloseByScope closes every unclosed document for a draft. Destructive
// lifecycle mutations call this AFTER their own transaction commits, so a
// failed mutation never closes rooms it did not affect.
func (s *Service) CoeditCloseByScope(ctx context.Context, draftVersionID string, reason authoringcoedit.CloseReason) ([]string, error) {
	docs, err := s.CoeditActiveDocuments(ctx, draftVersionID)
	if err != nil {
		return nil, err
	}
	ids := make([]string, 0, len(docs))
	for _, doc := range docs {
		ids = append(ids, doc.ID)
	}
	if err := s.CoeditCloseDocuments(ctx, ids, reason); err != nil {
		return nil, err
	}
	return ids, nil
}

// CoeditVerifyManifest verifies every freeze-manifest hash and materialized
// revision against MySQL. Publish proceeds only when all entries match: a
// manifest claiming a state MySQL never committed is exactly the split-room
// condition the design halts on ("Rooms, leases, freeze / flush / close",
// docs/sat-authoring-coedit.md).
func (s *Service) CoeditVerifyManifest(ctx context.Context, manifest []authoringcoedit.FreezeManifestEntry) error {
	for _, entry := range manifest {
		_, id, schemaVersion, err := authoringcoedit.ParseAnyDocumentName(entry.DocumentName)
		if err != nil {
			authoringcoedit.EmitManifestMismatch()
			return authoringcoedit.New(authoringcoedit.CodeSignatureInvalid, "Freeze manifest contains an unknown document.")
		}
		if schemaVersion == authoringcoedit.WorkspaceSchemaVersion {
			doc, loadErr := s.CoeditWorkspaceLoad(ctx, entry.DocumentName)
			if loadErr != nil {
				authoringcoedit.EmitManifestMismatch()
				return loadErr
			}
			if !strings.EqualFold(doc.StateHash, strings.TrimSpace(entry.StateHash)) {
				authoringcoedit.EmitManifestMismatch()
				return authoringcoedit.New(authoringcoedit.CodeRevisionConflict,
					"Collaboration state changed during publish; try again.")
			}
			if entry.MaterializedRevision != 0 && entry.MaterializedRevision != doc.MaterializedRevision {
				authoringcoedit.EmitManifestMismatch()
				return authoringcoedit.New(authoringcoedit.CodeRevisionConflict,
					"Collaboration state changed during publish; try again.")
			}
			if err := verifyCoeditManifestCounters(entry, doc.StateEpoch, doc.CommitSequence, doc.MaterializedRevision); err != nil {
				authoringcoedit.EmitManifestMismatch()
				return err
			}
			continue
		}
		doc, err := s.coeditLoadDocument(ctx, id)
		if err != nil {
			authoringcoedit.EmitManifestMismatch()
			return err
		}
		expected := hex.EncodeToString(doc.StateHash)
		if !strings.EqualFold(expected, strings.TrimSpace(entry.StateHash)) {
			authoringcoedit.EmitManifestMismatch()
			return authoringcoedit.New(authoringcoedit.CodeRevisionConflict,
				"Collaboration state changed during publish; try again.")
		}
		if entry.MaterializedRevision != 0 && entry.MaterializedRevision != doc.MaterializedRevision {
			authoringcoedit.EmitManifestMismatch()
			return authoringcoedit.New(authoringcoedit.CodeRevisionConflict,
				"Collaboration state changed during publish; try again.")
		}
		if err := verifyCoeditManifestCounters(entry, coeditDecimal(doc.StateEpoch), coeditDecimal(doc.CommitSequence), 0); err != nil {
			authoringcoedit.EmitManifestMismatch()
			return err
		}
	}
	return nil
}

// CoeditVerifyManifestOwned verifies the service manifest and the durable
// lifecycle fence in one transaction. The row locks close the race where a
// token/recovery request could otherwise change ownership between a manifest
// read and the publish decision.
func (s *Service) CoeditVerifyManifestOwned(ctx context.Context, expectedNames []authoringcoedit.DocumentName, manifest []authoringcoedit.FreezeManifestEntry, operation authoringcoedit.CoeditLifecycleOperation) error {
	if err := requireFreshFreezeOperation(operation); err != nil {
		authoringcoedit.EmitManifestMismatch()
		return err
	}
	expected := make(map[string]struct{}, len(expectedNames))
	for _, raw := range expectedNames {
		name, _, _, err := authoringcoedit.ParseAnyDocumentName(string(raw))
		if err != nil {
			authoringcoedit.EmitManifestMismatch()
			return authoringcoedit.New(authoringcoedit.CodeSignatureInvalid, "Freeze manifest contains an unknown document.")
		}
		expected[string(name)] = struct{}{}
	}
	if len(expected) != len(manifest) {
		authoringcoedit.EmitManifestMismatch()
		return authoringcoedit.New(authoringcoedit.CodeRevisionConflict, "Collaboration rooms changed during publish; try again.")
	}

	seen := make(map[string]struct{}, len(manifest))
	err := s.runner.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		for _, entry := range manifest {
			name, id, schemaVersion, err := authoringcoedit.ParseAnyDocumentName(entry.DocumentName)
			if err != nil {
				return authoringcoedit.New(authoringcoedit.CodeSignatureInvalid, "Freeze manifest contains an unknown document.")
			}
			if _, ok := expected[string(name)]; !ok {
				return authoringcoedit.New(authoringcoedit.CodeRevisionConflict, "Freeze manifest contains an unexpected room.")
			}
			if _, duplicate := seen[string(name)]; duplicate {
				return authoringcoedit.New(authoringcoedit.CodeRevisionConflict, "Freeze manifest contains a duplicate room.")
			}
			seen[string(name)] = struct{}{}

			if schemaVersion == authoringcoedit.WorkspaceSchemaVersion {
				doc, err := selectCoeditWorkspaceByID(ctx, q, id, true)
				if err == sql.ErrNoRows {
					return authoringcoedit.New(authoringcoedit.CodeNotEditableDraft, "Unknown co-edit workspace.")
				}
				if err != nil {
					return err
				}
				if err := verifyOwnedWorkspaceManifestEntry(entry, doc, operation); err != nil {
					return err
				}
				continue
			}

			doc, err := selectCoeditDocumentByID(ctx, q, id, true)
			if err == sql.ErrNoRows {
				return authoringcoedit.New(authoringcoedit.CodeNotEditableDraft, "Unknown co-edit document.")
			}
			if err != nil {
				return err
			}
			if err := verifyOwnedDocumentManifestEntry(entry, doc, operation); err != nil {
				return err
			}
		}
		if len(seen) != len(expected) {
			return authoringcoedit.New(authoringcoedit.CodeRevisionConflict, "Freeze manifest is incomplete; try again.")
		}
		return nil
	})
	if err != nil {
		authoringcoedit.EmitManifestMismatch()
	}
	return err
}

func verifyOwnedDocumentManifestEntry(entry authoringcoedit.FreezeManifestEntry, doc CoeditDocument, operation authoringcoedit.CoeditLifecycleOperation) error {
	if err := verifyOwnedLifecycle(doc.LifecycleState, coeditFreezeOperationID(doc), doc.FreezeExpiresAt, operation); err != nil {
		return err
	}
	if !strings.EqualFold(hex.EncodeToString(doc.StateHash), strings.TrimSpace(entry.StateHash)) {
		return authoringcoedit.New(authoringcoedit.CodeRevisionConflict, "Collaboration state changed during publish; try again.")
	}
	if entry.MaterializedRevision != 0 && entry.MaterializedRevision != doc.MaterializedRevision {
		return authoringcoedit.New(authoringcoedit.CodeRevisionConflict, "Collaboration state changed during publish; try again.")
	}
	return verifyCoeditManifestCounters(entry, coeditDecimal(doc.StateEpoch), coeditDecimal(doc.CommitSequence), 0)
}

func verifyOwnedWorkspaceManifestEntry(entry authoringcoedit.FreezeManifestEntry, doc CoeditWorkspaceDocument, operation authoringcoedit.CoeditLifecycleOperation) error {
	if err := verifyOwnedLifecycle(doc.LifecycleState, coeditFreezeOperationIDWorkspace(doc), doc.FreezeExpiresAt, operation); err != nil {
		return err
	}
	if !strings.EqualFold(hex.EncodeToString(doc.StateHash), strings.TrimSpace(entry.StateHash)) {
		return authoringcoedit.New(authoringcoedit.CodeRevisionConflict, "Collaboration state changed during publish; try again.")
	}
	if entry.MaterializedRevision != 0 && entry.MaterializedRevision != doc.MaterializedRevision {
		return authoringcoedit.New(authoringcoedit.CodeRevisionConflict, "Collaboration state changed during publish; try again.")
	}
	return verifyCoeditManifestCounters(entry, coeditDecimal(doc.StateEpoch), coeditDecimal(doc.CommitSequence), doc.MaterializedRevision)
}

func verifyOwnedLifecycle(state authoringcoedit.LifecycleState, owner string, expiresAt *time.Time, operation authoringcoedit.CoeditLifecycleOperation) error {
	if state == authoringcoedit.StateClosed {
		return authoringcoedit.New(authoringcoedit.CodeDocumentClosed, "This collaboration session was closed.")
	}
	if state != authoringcoedit.StateFreezing || owner != operation.FreezeOperationID || !lifecycleLeaseActive(expiresAt) {
		return authoringcoedit.New(authoringcoedit.CodeFreezeConflict, "Another lifecycle operation owns this collaboration session.")
	}
	return nil
}

func verifyCoeditManifestCounters(entry authoringcoedit.FreezeManifestEntry, stateEpoch, commitSequence authoringcoedit.DecimalString, workspaceRevision int) error {
	if entry.StateEpoch != "" && string(entry.StateEpoch) != string(stateEpoch) {
		return authoringcoedit.New(authoringcoedit.CodeEpochMismatch,
			"Collaboration state changed during publish; try again.")
	}
	if entry.CommitSequence != "" && string(entry.CommitSequence) != string(commitSequence) {
		return authoringcoedit.New(authoringcoedit.CodeRevisionConflict,
			"Collaboration state changed during publish; try again.")
	}
	if entry.WorkspaceRevision != 0 && entry.WorkspaceRevision != workspaceRevision {
		return authoringcoedit.New(authoringcoedit.CodeRevisionConflict,
			"Collaboration state changed during publish; try again.")
	}
	return nil
}

// CoeditFieldPatch is the partial non-collaborative update. `prompt` is
// structurally absent: it is not a field of this struct, so no caller can
// smuggle a prompt through the allow-list.
type CoeditFieldPatch struct {
	QuestionType  *string         `json:"questionType"`
	Stimulus      json.RawMessage `json:"stimulus"`
	Answer        json.RawMessage `json:"answer"`
	Rationale     json.RawMessage `json:"rationale"`
	Metadata      json.RawMessage `json:"metadata"`
	Accessibility json.RawMessage `json:"accessibility"`
}

// CoeditFieldPatchFromRequest builds a partial patch from handler-decoded
// fields. It exists so the wire-decoding layer never constructs the patch
// struct literal by hand (and so `prompt` has no path in at all).
func CoeditFieldPatchFromRequest(questionType *string, stimulus, answer, rationale, metadata, accessibility json.RawMessage) CoeditFieldPatch {
	return CoeditFieldPatch{
		QuestionType:  questionType,
		Stimulus:      stimulus,
		Answer:        answer,
		Rationale:     rationale,
		Metadata:      metadata,
		Accessibility: accessibility,
	}
}

// Present reports whether the patch carries at least one allow-listed field.
func (p CoeditFieldPatch) Present() bool {
	if p.QuestionType != nil {
		return true
	}
	for _, raw := range []json.RawMessage{p.Stimulus, p.Answer, p.Rationale, p.Metadata, p.Accessibility} {
		if len(strings.TrimSpace(string(raw))) > 0 {
			return true
		}
	}
	return false
}

// PatchRevisionFields updates only the allow-listed non-prompt fields of a
// revision. During co-editing this is the ONLY HTTP path that may write a
// question revision, and by construction it cannot touch the prompt.
func (s *Service) PatchRevisionFields(ctx context.Context, revisionID, actorID string, expectedRevision int, patch CoeditFieldPatch) (QuestionRevisionDetail, error) {
	if !patch.Present() {
		return QuestionRevisionDetail{}, validationError("At least one field must be provided.")
	}
	emission := &eventEmission{}
	var out QuestionRevisionDetail
	err := s.runner.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		var examQuestionID string
		if err := q.QueryRowContext(ctx, `SELECT eq.id FROM assessment_exam_questions eq WHERE eq.question_revision_id = ?`, revisionID).Scan(&examQuestionID); err != nil {
			if err == sql.ErrNoRows {
				return notFoundError("Question revision not found.")
			}
			return err
		}
		if err := touchQuestionDraft(ctx, q, examQuestionID); err != nil {
			return err
		}
		var rev int
		if err := q.QueryRowContext(ctx, `SELECT revision FROM assessment_question_revisions WHERE id = ? FOR UPDATE`, revisionID).Scan(&rev); err != nil {
			if err == sql.ErrNoRows {
				return notFoundError("Question revision not found.")
			}
			return err
		}
		if rev != expectedRevision {
			return conflictError("Question changed while you were editing; refresh before retrying.")
		}
		sets := make([]string, 0, 8)
		args := make([]any, 0, 10)
		present := make([]string, 0, 8)
		if patch.QuestionType != nil {
			sets = append(sets, "question_type = ?")
			args = append(args, orDefault(*patch.QuestionType, "single_choice"))
			present = append(present, "questionType")
		}
		if len(strings.TrimSpace(string(patch.Stimulus))) > 0 {
			sets = append(sets, "stimulus = ?")
			args = append(args, nonEmptyJSON(patch.Stimulus))
			present = append(present, "stimulus")
		}
		if len(strings.TrimSpace(string(patch.Answer))) > 0 {
			sets = append(sets, "answer_definition = ?")
			args = append(args, nonEmptyJSON(patch.Answer))
			present = append(present, "answer")
		}
		if len(strings.TrimSpace(string(patch.Rationale))) > 0 {
			sets = append(sets, "rationale = ?")
			args = append(args, nonEmptyJSON(patch.Rationale))
			present = append(present, "rationale")
		}
		if len(strings.TrimSpace(string(patch.Metadata))) > 0 {
			metadata := nonEmptyJSON(patch.Metadata)
			if normalized, err := normalizeSATQuestionMetadata(metadata); err != nil {
				return err
			} else {
				metadata = normalized
			}
			sets = append(sets, "metadata = ?")
			args = append(args, metadata)
			present = append(present, "metadata")
		}
		if len(strings.TrimSpace(string(patch.Accessibility))) > 0 {
			sets = append(sets, "accessibility = ?")
			args = append(args, nonEmptyJSON(patch.Accessibility))
			present = append(present, "accessibility")
		}
		// `prompt` is never in sets: the partial patch cannot write it.
		if len(sets) == 0 {
			return validationError("At least one field must be provided.")
		}
		sets = append(sets, "revision = revision + 1", "state = 'draft'", "sealed_at = NULL",
			"updated_by = ?", "updated_at = NOW(6)")
		args = append(args, actorID, revisionID)
		if _, err := q.ExecContext(ctx, "UPDATE assessment_question_revisions SET "+strings.Join(sets, ", ")+" WHERE id = ?", args...); err != nil {
			return err
		}
		detail, err := scanQuestionDetail(q.QueryRowContext(ctx, questionDetailQuery, examQuestionID))
		if err != nil {
			return err
		}
		out = detail.Question
		if s.eventsOn() {
			scope, err := resolveQuestionScopeTx(ctx, q, examQuestionID)
			if err != nil {
				return err
			}
			if err := s.appendAuthoringEventTx(ctx, q, emission, "coedit_field_patch", scope, authoringrealtime.EventInput{
				Kind:    authoringrealtime.KindQuestionChanged,
				ActorID: actorID,
				Entity: authoringrealtime.Entity{
					Kind:           authoringrealtime.EntityQuestion,
					ExamQuestionID: examQuestionID,
					QuestionID:     strPtr(detail.Question.QuestionID),
					ModuleID:       strPtr(detail.ModuleID),
				},
				Revision:      detail.Question.Revision,
				ChangedFields: authoringrealtime.NewChangedFields(present...),
			}); err != nil {
				return err
			}
		}
		return nil
	})
	emission.flush(err)
	return out, err
}

// SetCoeditEnabled wires the prompt co-editing guard (chainable). The
// application calls it with true by default; tests may still use false to
// exercise legacy transaction behavior.
func (s *Service) SetCoeditEnabled(on bool) *Service {
	if s != nil {
		s.coeditEnabled = on
	}
	return s
}

// CoeditEnabled reports the gate (assertable without a pool).
func (s *Service) CoeditEnabled() bool { return s != nil && s.coeditEnabled }

// coeditGuardTx refuses a legacy prompt-bearing revision save while an active
// co-edit document exists for the question. It runs INSIDE the save
// transaction, so a staggered frontend deployment cannot interleave a legacy
// prompt write with a collaborative one. It never silently strips the prompt:
// a mixed-version client sees a typed COEDIT_ACTIVE conflict instead of a
// false success.
//
// Gated on the service flag so the flag-off path issues no query and behaves
// exactly as it did before co-editing existed.
func (s *Service) coeditGuardTx(ctx context.Context, q tx.Tx, examQuestionID string, draft QuestionDraft) error {
	if s == nil || !s.coeditEnabled {
		return nil
	}
	if len(strings.TrimSpace(string(draft.Prompt))) == 0 {
		return nil
	}
	// activeCoeditRoomExistsTx is the same union the read-only pre-check uses,
	// so an exam-level workspace room refuses a legacy prompt write here too.
	active, err := activeCoeditRoomExistsTx(ctx, q, examQuestionID)
	if err != nil {
		return err
	}
	if active {
		authoringcoedit.EmitGuard(authoringcoedit.OutcomeConflict)
		return authoringcoedit.New(authoringcoedit.CodeActiveConflict,
			"This prompt is being edited collaboratively. Use the collaborative editor or refresh to continue.")
	}
	return nil
}

// Legacy prompt-bearing writes have exactly one pre-check —
// CoeditActiveForQuestion — and exactly one authoritative guard, coeditGuardTx
// inside the save transaction. Both run activeCoeditRoomQuery. A second
// pre-check wrapper lived here and was never called by production code, which
// made it a second place for the definition to drift.
