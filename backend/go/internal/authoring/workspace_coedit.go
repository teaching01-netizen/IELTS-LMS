package authoring

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"reflect"
	"sort"
	"strings"
	"time"

	"example.com/ielts-proctoring/internal/authoringcoedit"
	"example.com/ielts-proctoring/internal/authoringrealtime"
	"example.com/ielts-proctoring/internal/platform/tx"
	"github.com/google/uuid"
)

// CoeditWorkspaceDocument is the exam-level v2 room. Its Y.Doc is the live
// merge/recovery source for all SAT authoring surfaces. Existing v1 prompt
// documents deliberately keep their own type and persistence path.
type CoeditWorkspaceDocument struct {
	ID                   string
	OrganizationID       *string
	ExamID               string
	DraftVersionID       string
	SchemaVersion        int
	FieldSet             string
	LifecycleState       authoringcoedit.LifecycleState
	YdocState            []byte
	StateVector          []byte
	StateHash            []byte
	PreviousStateHash    []byte
	WorkspaceJSON        []byte
	MaterializedRevision int
	LastActorID          string
	ClosedReason         *string
	StateEpoch           uint64
	CommitSequence       uint64
	FreezeOperationID    *string
	FreezeExpiresAt      *time.Time
}

const coeditWorkspaceColumns = `id, organization_id, exam_id, draft_version_id,
 schema_version, field_set, lifecycle_state, ydoc_state, state_vector,
 state_hash, previous_state_hash, workspace_json, materialized_revision,
	 last_actor_id, closed_reason, state_epoch, commit_sequence,
	 freeze_operation_id, freeze_expires_at`

func scanCoeditWorkspace(row interface{ Scan(dest ...any) error }) (CoeditWorkspaceDocument, error) {
	var out CoeditWorkspaceDocument
	var org, actor, reason, freezeOperationID sql.NullString
	var freezeExpiresAt sql.NullTime
	var state string
	if err := row.Scan(&out.ID, &org, &out.ExamID, &out.DraftVersionID,
		&out.SchemaVersion, &out.FieldSet, &state, &out.YdocState, &out.StateVector,
		&out.StateHash, &out.PreviousStateHash, &out.WorkspaceJSON,
		&out.MaterializedRevision, &actor, &reason, &out.StateEpoch,
		&out.CommitSequence, &freezeOperationID, &freezeExpiresAt); err != nil {
		return CoeditWorkspaceDocument{}, err
	}
	if org.Valid {
		value := org.String
		out.OrganizationID = &value
	}
	if actor.Valid {
		out.LastActorID = strings.TrimSpace(actor.String)
	}
	if reason.Valid {
		value := reason.String
		out.ClosedReason = &value
	}
	if freezeOperationID.Valid {
		value := strings.TrimSpace(freezeOperationID.String)
		if value != "" {
			out.FreezeOperationID = &value
		}
	}
	if freezeExpiresAt.Valid {
		value := freezeExpiresAt.Time
		out.FreezeExpiresAt = &value
	}
	parsed, err := authoringcoedit.ParseLifecycleState(state)
	if err != nil {
		return CoeditWorkspaceDocument{}, err
	}
	out.LifecycleState = parsed
	return out, nil
}

func workspaceIdentity(doc CoeditWorkspaceDocument) authoringcoedit.Identity {
	name, _ := authoringcoedit.NewWorkspaceDocumentName(doc.ID)
	var closed *authoringcoedit.CloseReason
	if doc.ClosedReason != nil {
		reason := authoringcoedit.CloseReason(*doc.ClosedReason)
		if reason.Valid() {
			closed = &reason
		}
	}
	return authoringcoedit.Identity{
		DocumentID:           doc.ID,
		DocumentName:         name,
		OrganizationID:       doc.OrganizationID,
		ExamID:               doc.ExamID,
		DraftVersionID:       doc.DraftVersionID,
		SchemaVersion:        doc.SchemaVersion,
		FieldSet:             doc.FieldSet,
		LifecycleState:       doc.LifecycleState,
		MaterializedRevision: doc.MaterializedRevision,
		ClosedReason:         closed,
		StateEpoch:           coeditDecimal(doc.StateEpoch),
		CommitSequence:       coeditDecimal(doc.CommitSequence),
		WorkspaceRevision:    doc.MaterializedRevision,
	}
}

// CoeditEnsureWorkspace resolves the current editable SAT draft and creates a
// single v2 row for it. A draft replacement naturally gets a new room because
// draft_version_id participates in the unique scope.
func (s *Service) CoeditEnsureWorkspace(ctx context.Context, examID, actorID string) (authoringcoedit.Identity, error) {
	var out authoringcoedit.Identity
	err := s.runner.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		var provider, draftID string
		var org sql.NullString
		err := q.QueryRowContext(ctx, `SELECT e.provider_key, e.current_draft_version_id, e.organization_id
  FROM exam_entities e
  JOIN exam_versions v ON v.id = e.current_draft_version_id
 WHERE e.id = ? AND v.is_draft = TRUE AND v.is_published = FALSE
 FOR UPDATE`, strings.TrimSpace(examID)).Scan(&provider, &draftID, &org)
		if err == sql.ErrNoRows {
			return authoringcoedit.New(authoringcoedit.CodeNotEditableDraft,
				"Only the current editable SAT draft can be co-edited.")
		}
		if err != nil {
			return err
		}
		if provider != "sat" {
			return authoringcoedit.New(authoringcoedit.CodeNotEditableDraft,
				"This collaboration room is only available for SAT authoring.")
		}
		var existing CoeditWorkspaceDocument
		existing, err = scanCoeditWorkspace(q.QueryRowContext(ctx, `SELECT `+coeditWorkspaceColumns+`
 FROM authoring_coedit_workspaces
 WHERE draft_version_id = ? AND exam_id = ? AND schema_version = ? FOR UPDATE`,
			draftID, examID, authoringcoedit.WorkspaceSchemaVersion))
		if err == nil {
			if existing.LifecycleState == authoringcoedit.StateClosed {
				return authoringcoedit.New(authoringcoedit.CodeDocumentClosed,
					"This SAT draft collaboration session was closed.")
			}
			out = workspaceIdentity(existing)
			return nil
		}
		if err != sql.ErrNoRows {
			return err
		}
		id := uuid.NewString()
		var organization any
		if org.Valid {
			organization = org.String
		}
		_, err = q.ExecContext(ctx, `INSERT INTO authoring_coedit_workspaces
 (id, organization_id, exam_id, draft_version_id, schema_version, field_set,
  lifecycle_state, materialized_revision, last_actor_id, created_at, updated_at)
 VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, NOW(6), NOW(6))`, id, organization, examID,
			draftID, authoringcoedit.WorkspaceSchemaVersion, authoringcoedit.FieldSetWorkspace,
			string(authoringcoedit.StateInitializing), actorID)
		if err != nil {
			// The unique scope makes concurrent tabs converge on one row.
			winner, readErr := scanCoeditWorkspace(q.QueryRowContext(ctx, `SELECT `+coeditWorkspaceColumns+`
 FROM authoring_coedit_workspaces
 WHERE draft_version_id = ? AND exam_id = ? AND schema_version = ? FOR UPDATE`,
				draftID, examID, authoringcoedit.WorkspaceSchemaVersion))
			if readErr != nil {
				return err
			}
			out = workspaceIdentity(winner)
			return nil
		}
		created := CoeditWorkspaceDocument{
			ID: id, OrganizationID: func() *string {
				if !org.Valid {
					return nil
				}
				value := org.String
				return &value
			}(), ExamID: examID, DraftVersionID: draftID,
			SchemaVersion:        authoringcoedit.WorkspaceSchemaVersion,
			FieldSet:             authoringcoedit.FieldSetWorkspace,
			LifecycleState:       authoringcoedit.StateInitializing,
			MaterializedRevision: 0,
		}
		out = workspaceIdentity(created)
		return nil
	})
	if err != nil {
		return authoringcoedit.Identity{}, err
	}
	return out, nil
}

func selectCoeditWorkspaceByID(ctx context.Context, q tx.Tx, id string, lock bool) (CoeditWorkspaceDocument, error) {
	query := `SELECT ` + coeditWorkspaceColumns + ` FROM authoring_coedit_workspaces WHERE id = ?`
	if lock {
		query += " FOR UPDATE"
	}
	return scanCoeditWorkspace(q.QueryRowContext(ctx, query, id))
}

func (s *Service) CoeditWorkspaceLoad(ctx context.Context, documentName string) (CoeditLoadResult, error) {
	_, id, err := authoringcoedit.ParseWorkspaceDocumentName(documentName)
	if err != nil {
		return CoeditLoadResult{}, authoringcoedit.New(authoringcoedit.CodeNotEditableDraft, "Unknown co-edit workspace.")
	}
	var doc CoeditWorkspaceDocument
	err = s.runner.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		doc, err = selectCoeditWorkspaceByID(ctx, q, id, false)
		return err
	})
	if err == sql.ErrNoRows {
		return CoeditLoadResult{}, authoringcoedit.New(authoringcoedit.CodeNotEditableDraft, "Unknown co-edit workspace.")
	}
	if err != nil {
		return CoeditLoadResult{}, err
	}
	if doc.LifecycleState == authoringcoedit.StateClosed {
		return CoeditLoadResult{}, authoringcoedit.New(authoringcoedit.CodeDocumentClosed, "This SAT draft collaboration session was closed.")
	}
	return CoeditLoadResult{
		DocumentName:   string(mustWorkspaceDocumentName(doc.ID)),
		LifecycleState: string(doc.LifecycleState),
		YdocState:      doc.YdocState, StateVector: doc.StateVector,
		StateHash:            hex.EncodeToString(doc.StateHash),
		MaterializedRevision: doc.MaterializedRevision,
		QuestionRevision:     doc.MaterializedRevision,
		StateEpoch:           coeditDecimal(doc.StateEpoch),
		CommitSequence:       coeditDecimal(doc.CommitSequence),
		WorkspaceRevision:    doc.MaterializedRevision,
		FreezeOperationID:    coeditFreezeOperationIDWorkspace(doc),
		FreezeExpiresAt:      coeditFreezeExpiresAtWorkspace(doc),
		SchemaVersion:        doc.SchemaVersion, FieldSet: doc.FieldSet,
		ClosedReason: doc.ClosedReason,
	}, nil
}

func mustWorkspaceDocumentName(id string) authoringcoedit.DocumentName {
	name, _ := authoringcoedit.NewWorkspaceDocumentName(id)
	return name
}

func (s *Service) CoeditWorkspaceInitialize(ctx context.Context, req CoeditInitializeRequest) (CoeditStoreResult, error) {
	if err := validateCoeditWorkspaceSizes(req.YdocState, req.StateVector, req.Workspace); err != nil {
		return CoeditStoreResult{}, err
	}
	_, id, err := authoringcoedit.ParseWorkspaceDocumentName(req.DocumentName)
	if err != nil {
		return CoeditStoreResult{}, authoringcoedit.New(authoringcoedit.CodeNotEditableDraft, "Unknown co-edit workspace.")
	}
	hash, err := decodeStateHash(req.StateHash)
	if err != nil {
		return CoeditStoreResult{}, err
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
		if doc.LifecycleState == authoringcoedit.StateClosed {
			return authoringcoedit.New(authoringcoedit.CodeDocumentClosed, "This SAT draft collaboration session was closed.")
		}
		if !authoringcoedit.CanTransition(doc.LifecycleState, authoringcoedit.StateActive) ||
			doc.LifecycleState == authoringcoedit.StateFreezing ||
			doc.LifecycleState == authoringcoedit.StateFrozen {
			return authoringcoedit.New(authoringcoedit.CodeDocumentFrozen, "This SAT draft is being published; try again in a moment.")
		}
		if len(doc.YdocState) > 0 {
			out = workspaceResultFromDocument(doc, true)
			return nil
		}
		if _, err := q.ExecContext(ctx, `UPDATE authoring_coedit_workspaces
	 SET ydoc_state = ?, state_vector = ?, state_hash = ?, workspace_json = ?,
	     lifecycle_state = ?, commit_sequence = commit_sequence + 1,
	     last_actor_id = ?, updated_at = NOW(6) WHERE id = ?`,
			req.YdocState, req.StateVector, hash, nonEmptyJSON(req.Workspace),
			string(authoringcoedit.StateActive), req.ActorID, id); err != nil {
			return err
		}
		doc.YdocState, doc.StateVector, doc.StateHash, doc.WorkspaceJSON = req.YdocState, req.StateVector, hash, req.Workspace
		doc.LifecycleState = authoringcoedit.StateActive
		doc.CommitSequence++
		out = workspaceResultFromDocument(doc, false)
		return nil
	})
	return out, err
}

func (s *Service) CoeditWorkspaceStore(ctx context.Context, req CoeditStoreRequest) (CoeditStoreResult, error) {
	return s.coeditWorkspaceStore(ctx, req, false)
}

// CoeditWorkspaceFinalStore persists the last owned freeze snapshot and keeps
// the workspace row fenced until its lifecycle operation closes or aborts it.
func (s *Service) CoeditWorkspaceFinalStore(ctx context.Context, req CoeditStoreRequest) (CoeditStoreResult, error) {
	return s.coeditWorkspaceStore(ctx, req, true)
}

func (s *Service) coeditWorkspaceStore(ctx context.Context, req CoeditStoreRequest, final bool) (CoeditStoreResult, error) {
	if err := validateCoeditWorkspaceSizes(req.YdocState, req.StateVector, req.Workspace); err != nil {
		return CoeditStoreResult{}, err
	}
	_, id, err := authoringcoedit.ParseWorkspaceDocumentName(req.DocumentName)
	if err != nil {
		return CoeditStoreResult{}, authoringcoedit.New(authoringcoedit.CodeNotEditableDraft, "Unknown co-edit workspace.")
	}
	if final && strings.TrimSpace(req.FreezeOperationID) == "" {
		return CoeditStoreResult{}, authoringcoedit.New(authoringcoedit.CodeFreezeConflict,
			"A freeze operation is required for the final store.")
	}
	incoming, err := decodeStateHash(req.StateHash)
	if err != nil {
		return CoeditStoreResult{}, err
	}
	previous, err := decodeStateHash(req.PreviousStateHash)
	if err != nil {
		return CoeditStoreResult{}, err
	}
	var out CoeditStoreResult
	emission := &eventEmission{}
	err = s.runner.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		doc, err := selectCoeditWorkspaceByID(ctx, q, id, true)
		if err == sql.ErrNoRows {
			return authoringcoedit.New(authoringcoedit.CodeNotEditableDraft, "Unknown co-edit workspace.")
		}
		if err != nil {
			return err
		}
		if doc.LifecycleState == authoringcoedit.StateClosed {
			return authoringcoedit.New(authoringcoedit.CodeDocumentClosed, "This SAT draft collaboration session was closed.")
		}
		if final {
			if doc.LifecycleState != authoringcoedit.StateFreezing {
				return authoringcoedit.New(authoringcoedit.CodeFinalStoreRequired,
					"The final store is only valid for a freezing collaboration session.")
			}
			if coeditFreezeOperationIDWorkspace(doc) != strings.TrimSpace(req.FreezeOperationID) {
				return authoringcoedit.New(authoringcoedit.CodeFreezeConflict,
					"Another lifecycle operation owns this collaboration session.")
			}
			if !lifecycleLeaseActive(doc.FreezeExpiresAt) {
				return authoringcoedit.New(authoringcoedit.CodeFreezeConflict,
					"The collaboration freeze lease has expired; start a new lifecycle operation.")
			}
		} else if doc.LifecycleState == authoringcoedit.StateFreezing || doc.LifecycleState == authoringcoedit.StateFrozen {
			return authoringcoedit.New(authoringcoedit.CodeDocumentFrozen, "This SAT draft is being published; try again in a moment.")
		}
		if len(doc.StateHash) > 0 && stringEqualBytes(doc.StateHash, incoming) {
			out = workspaceResultFromDocument(doc, true)
			return nil
		}
		if len(doc.StateHash) > 0 && !stringEqualBytes(doc.StateHash, previous) {
			return authoringcoedit.New(authoringcoedit.CodePreviousHashMismatch, "Collaboration state advanced elsewhere; reconnect before continuing.")
		}
		actorID := firstNonEmpty(req.ActorID, doc.LastActorID)
		changed, err := s.materializeWorkspaceTx(ctx, q, doc, req.Workspace, actorID, incoming, emission)
		if err != nil {
			return err
		}
		nextRevision := doc.MaterializedRevision
		if changed {
			nextRevision++
		}
		lifecycle := authoringcoedit.StateActive
		if final {
			lifecycle = authoringcoedit.StateFreezing
		}
		if _, err := q.ExecContext(ctx, `UPDATE authoring_coedit_workspaces
 SET ydoc_state = ?, state_vector = ?, previous_state_hash = state_hash,
     state_hash = ?, workspace_json = ?, lifecycle_state = ?,
     materialized_revision = ?, commit_sequence = commit_sequence + 1,
     last_actor_id = ?, updated_at = NOW(6)
 WHERE id = ?`, req.YdocState, req.StateVector, incoming, nonEmptyJSON(req.Workspace),
			string(lifecycle), nextRevision, actorID, id); err != nil {
			return err
		}
		doc.PreviousStateHash = append([]byte(nil), doc.StateHash...)
		doc.YdocState, doc.StateVector, doc.StateHash, doc.WorkspaceJSON = req.YdocState, req.StateVector, incoming, req.Workspace
		doc.MaterializedRevision, doc.LifecycleState = nextRevision, lifecycle
		doc.CommitSequence++
		out = workspaceResultFromDocument(doc, false)
		return nil
	})
	emission.flush(err)
	return out, err
}

// workspaceQuestionProjection is the small, content-bearing subset of the
// exam workspace that can be materialized into the existing question
// revision. The workspace also contains delivery/access/UI values; those are
// written through their existing revision-fenced APIs and are intentionally
// ignored here.
type workspaceQuestionProjection struct {
	questionType       *string
	isPretest          *bool
	answer             json.RawMessage
	answerPresent      bool
	metadata           json.RawMessage
	metadataPresent    bool
	accessibility      json.RawMessage
	accessibilityExist bool
	stimulus           json.RawMessage
	stimulusPresent    bool
	prompt             json.RawMessage
	promptPresent      bool
	rationale          json.RawMessage
	rationalePresent   bool
	choices            map[string]json.RawMessage
}

type workspaceQuestionRow struct {
	examQuestionID, moduleID, questionID, revisionID, questionType string
	revision                                                       int
	isPretest                                                      bool
	stimulus, prompt, answer, rationale, metadata, accessibility   json.RawMessage
}

// materializeWorkspaceTx projects accepted question fields in the same
// transaction as the workspace binary. It is deliberately a no-op for a
// scalar-only/UI-only snapshot, so ordinary room presence and navigation do
// not create question revisions.
func (s *Service) materializeWorkspaceTx(
	ctx context.Context,
	q tx.Tx,
	doc CoeditWorkspaceDocument,
	workspace []byte,
	actorID string,
	stateHash []byte,
	emission *eventEmission,
) (bool, error) {
	projections, err := parseWorkspaceQuestionProjection(workspace)
	if err != nil {
		return false, err
	}
	if len(projections) == 0 {
		return false, nil
	}
	changed := false

	questionIDs := make([]string, 0, len(projections))
	for questionID := range projections {
		questionIDs = append(questionIDs, questionID)
	}
	sort.Strings(questionIDs)
	for _, examQuestionID := range questionIDs {
		projection := projections[examQuestionID]
		if projection == nil {
			continue
		}
		row, err := loadWorkspaceQuestionTx(ctx, q, examQuestionID, doc.DraftVersionID)
		if err == sql.ErrNoRows {
			// A stale room can contain a question deleted by a serialized
			// structural command. The command's authoritative result wins; do
			// not resurrect the row while flushing the old Y.Doc.
			continue
		}
		if err != nil {
			return false, err
		}

		next := row
		changedFields := make([]string, 0, 8)
		if projection.questionType != nil && row.questionType != *projection.questionType {
			next.questionType = *projection.questionType
			changedFields = appendUniqueString(changedFields, "questionType")
		}
		if projection.promptPresent && !workspaceJSONEqual(row.prompt, projection.prompt) {
			next.prompt = cloneJSON(projection.prompt)
			changedFields = appendUniqueString(changedFields, "prompt")
		}
		if projection.stimulusPresent && !workspaceJSONEqual(row.stimulus, projection.stimulus) {
			next.stimulus = cloneJSON(projection.stimulus)
			changedFields = appendUniqueString(changedFields, "stimulus")
		}
		if projection.rationalePresent && !workspaceJSONEqual(row.rationale, projection.rationale) {
			next.rationale = cloneJSON(projection.rationale)
			changedFields = appendUniqueString(changedFields, "rationale")
		}
		if projection.metadataPresent {
			metadata, err := normalizeSATQuestionMetadata(projection.metadata)
			if err != nil {
				return false, err
			}
			if !workspaceJSONEqual(row.metadata, metadata) {
				next.metadata = cloneJSON(metadata)
				changedFields = appendUniqueString(changedFields,
					"metadata.domain", "metadata.skill", "metadata.difficulty", "metadata.tags")
			}
		}
		if projection.accessibilityExist && !workspaceJSONEqual(row.accessibility, projection.accessibility) {
			next.accessibility = cloneJSON(projection.accessibility)
			changedFields = appendUniqueString(changedFields, "accessibility")
		}
		if projection.answerPresent || len(projection.choices) > 0 {
			answer, err := mergeWorkspaceAnswer(row.answer, projection.answer, projection.answerPresent, projection.choices)
			if err != nil {
				return false, err
			}
			if !workspaceJSONEqual(row.answer, answer) {
				next.answer = cloneJSON(answer)
				changedFields = appendUniqueString(changedFields, "answer")
			}
		}
		if projection.isPretest != nil && row.isPretest != *projection.isPretest {
			next.isPretest = *projection.isPretest
			changedFields = appendUniqueString(changedFields, "isPretest")
		}
		if len(changedFields) == 0 {
			continue
		}
		changed = true

		if err := touchQuestionDraft(ctx, q, examQuestionID); err != nil {
			return false, err
		}
		if _, err := q.ExecContext(ctx, `UPDATE assessment_question_revisions
 SET question_type = ?, stimulus = ?, prompt = ?, answer_definition = ?,
     rationale = ?, metadata = ?, accessibility = ?, revision = revision + 1,
     state = 'draft', sealed_at = NULL, updated_by = ?, updated_at = NOW(6)
 WHERE id = ?`, next.questionType, nonEmptyJSON(next.stimulus), nonEmptyJSON(next.prompt),
			nonEmptyJSON(next.answer), nonEmptyJSON(next.rationale), nonEmptyJSON(next.metadata),
			nonEmptyJSON(next.accessibility), nullableActor(actorID), next.revisionID); err != nil {
			return false, err
		}
		if projection.isPretest != nil && row.isPretest != *projection.isPretest {
			if _, err := q.ExecContext(ctx, `UPDATE assessment_exam_questions
 SET is_pretest = ?, updated_at = NOW(6) WHERE id = ?`, next.isPretest, examQuestionID); err != nil {
				return false, err
			}
		}

		if s.eventsOn() && strings.TrimSpace(actorID) != "" {
			scope, err := resolveQuestionScopeTx(ctx, q, examQuestionID)
			if err != nil {
				return false, err
			}
			if err := s.appendAuthoringEventTx(ctx, q, emission, "coedit_workspace_store", scope, authoringrealtime.EventInput{
				Kind:    authoringrealtime.KindQuestionChanged,
				ActorID: actorID,
				Entity: authoringrealtime.Entity{
					Kind:           authoringrealtime.EntityQuestion,
					ExamQuestionID: examQuestionID,
					QuestionID:     strPtr(next.questionID),
					ModuleID:       strPtr(next.moduleID),
				},
				Revision:      next.revision + 1,
				ChangedFields: authoringrealtime.NewChangedFields(changedFields...),
				CausationID:   coeditCausationID(stateHash),
			}); err != nil {
				return false, err
			}
		}
	}
	return changed, nil
}

func loadWorkspaceQuestionTx(ctx context.Context, q tx.Tx, examQuestionID, draftVersionID string) (workspaceQuestionRow, error) {
	var row workspaceQuestionRow
	err := q.QueryRowContext(ctx, `SELECT eq.id, eq.module_id, eq.question_id,
       eq.question_revision_id, r.revision, r.question_type,
       eq.is_pretest,
       CAST(r.stimulus AS CHAR), CAST(r.prompt AS CHAR),
       CAST(r.answer_definition AS CHAR), CAST(r.rationale AS CHAR),
       CAST(r.metadata AS CHAR), CAST(r.accessibility AS CHAR)
  FROM assessment_exam_questions eq
  JOIN assessment_modules m ON m.id = eq.module_id
  JOIN assessment_sections s ON s.id = m.section_id
  JOIN exam_versions v ON v.id = s.exam_version_id
  JOIN assessment_question_revisions r ON r.id = eq.question_revision_id
 WHERE eq.id = ? AND s.exam_version_id = ?
   AND v.is_draft = TRUE AND v.is_published = FALSE
 FOR UPDATE`, examQuestionID, draftVersionID).Scan(
		&row.examQuestionID, &row.moduleID, &row.questionID, &row.revisionID,
		&row.revision, &row.questionType, &row.isPretest, rawScanner(&row.stimulus), rawScanner(&row.prompt),
		rawScanner(&row.answer), rawScanner(&row.rationale), rawScanner(&row.metadata),
		rawScanner(&row.accessibility),
	)
	return row, err
}

func parseWorkspaceQuestionProjection(workspace []byte) (map[string]*workspaceQuestionProjection, error) {
	if len(bytes.TrimSpace(workspace)) == 0 || bytes.Equal(bytes.TrimSpace(workspace), []byte("null")) {
		return nil, nil
	}
	var values map[string]json.RawMessage
	if err := json.Unmarshal(workspace, &values); err != nil || values == nil {
		return nil, authoringcoedit.New(authoringcoedit.CodeOversized, "SAT collaboration workspace is invalid.")
	}
	projections := make(map[string]*workspaceQuestionProjection)
	for key, value := range values {
		if strings.HasPrefix(key, "question/") {
			rest := strings.TrimPrefix(key, "question/")
			parts := strings.SplitN(rest, "/", 2)
			if len(parts) != 2 || strings.TrimSpace(parts[0]) == "" {
				continue
			}
			projection := projections[parts[0]]
			if projection == nil {
				projection = &workspaceQuestionProjection{}
				projections[parts[0]] = projection
			}
			if err := applyWorkspaceQuestionMapValue(projection, parts[1], value); err != nil {
				return nil, err
			}
			continue
		}
		if !strings.HasPrefix(key, "rich:question/") {
			continue
		}
		rest := strings.TrimPrefix(key, "rich:question/")
		parts := strings.SplitN(rest, "/", 2)
		if len(parts) != 2 || strings.TrimSpace(parts[0]) == "" {
			continue
		}
		projection := projections[parts[0]]
		if projection == nil {
			projection = &workspaceQuestionProjection{}
			projections[parts[0]] = projection
		}
		if err := applyWorkspaceQuestionRichValue(projection, parts[1], value); err != nil {
			return nil, err
		}
	}
	return projections, nil
}

func applyWorkspaceQuestionMapValue(projection *workspaceQuestionProjection, field string, raw json.RawMessage) error {
	if field == "scalar" {
		var values map[string]json.RawMessage
		if err := json.Unmarshal(raw, &values); err != nil || values == nil {
			return authoringcoedit.New(authoringcoedit.CodeOversized, "SAT question settings are invalid.")
		}
		for name, value := range values {
			if err := applyWorkspaceQuestionMapValue(projection, name, value); err != nil {
				return err
			}
		}
		return nil
	}
	switch field {
	case "isPretest":
		var isPretest bool
		if err := json.Unmarshal(raw, &isPretest); err != nil {
			return authoringcoedit.New(authoringcoedit.CodeOversized, "SAT pretest setting is invalid.")
		}
		projection.isPretest = &isPretest
	case "questionType":
		var questionType string
		if err := json.Unmarshal(raw, &questionType); err != nil || strings.TrimSpace(questionType) == "" {
			return authoringcoedit.New(authoringcoedit.CodeOversized, "SAT question type is invalid.")
		}
		projection.questionType = &questionType
	case "answer":
		projection.answer = cloneJSON(raw)
		projection.answerPresent = true
	case "metadata":
		projection.metadata = cloneJSON(raw)
		projection.metadataPresent = true
	case "accessibility":
		projection.accessibility = cloneJSON(raw)
		projection.accessibilityExist = true
	}
	return nil
}

func applyWorkspaceQuestionRichValue(projection *workspaceQuestionProjection, field string, raw json.RawMessage) error {
	switch field {
	case "prompt":
		projection.prompt = cloneJSON(raw)
		projection.promptPresent = true
	case "stimulus":
		projection.stimulus = cloneJSON(raw)
		projection.stimulusPresent = true
	case "rationale":
		projection.rationale = cloneJSON(raw)
		projection.rationalePresent = true
	default:
		if !strings.HasPrefix(field, "choice/") {
			return nil
		}
		optionID := strings.TrimPrefix(field, "choice/")
		if strings.TrimSpace(optionID) == "" {
			return nil
		}
		if projection.choices == nil {
			projection.choices = make(map[string]json.RawMessage)
		}
		projection.choices[optionID] = cloneJSON(raw)
	}
	return nil
}

func mergeWorkspaceAnswer(current, incoming json.RawMessage, incomingPresent bool, choices map[string]json.RawMessage) (json.RawMessage, error) {
	if !incomingPresent && len(choices) == 0 {
		return cloneJSON(current), nil
	}
	var answer map[string]any
	if incomingPresent {
		if err := json.Unmarshal(incoming, &answer); err != nil || answer == nil {
			return nil, authoringcoedit.New(authoringcoedit.CodeOversized, "SAT answer settings are invalid.")
		}
	} else if err := json.Unmarshal(nonEmptyJSON(current), &answer); err != nil || answer == nil {
		return nil, authoringcoedit.New(authoringcoedit.CodeOversized, "SAT answer settings are invalid.")
	}
	if len(choices) == 0 {
		return json.Marshal(answer)
	}

	var currentAnswer map[string]any
	if err := json.Unmarshal(nonEmptyJSON(current), &currentAnswer); err != nil || currentAnswer == nil {
		currentAnswer = map[string]any{}
	}
	currentOptions := optionContentByID(currentAnswer)
	options, ok := answer["options"].([]any)
	if !ok {
		// A choice fragment can arrive before the scalar answer root. Preserve
		// the current answer rather than turning a rich choice edit into an
		// invalid answer definition.
		answer = currentAnswer
		options, _ = answer["options"].([]any)
	}
	for _, rawOption := range options {
		option, ok := rawOption.(map[string]any)
		if !ok {
			continue
		}
		optionID, _ := option["id"].(string)
		if content, exists := choices[optionID]; exists {
			var value any
			if json.Unmarshal(content, &value) == nil {
				option["content"] = value
			}
		} else if _, exists := option["content"]; !exists {
			if content, exists := currentOptions[optionID]; exists {
				option["content"] = content
			}
		}
	}
	answer["options"] = options
	return json.Marshal(answer)
}

func optionContentByID(answer map[string]any) map[string]any {
	out := make(map[string]any)
	options, _ := answer["options"].([]any)
	for _, rawOption := range options {
		option, ok := rawOption.(map[string]any)
		if !ok {
			continue
		}
		id, _ := option["id"].(string)
		if content, exists := option["content"]; exists && id != "" {
			out[id] = content
		}
	}
	return out
}

func workspaceJSONEqual(left, right json.RawMessage) bool {
	var a, b any
	if json.Unmarshal(left, &a) != nil || json.Unmarshal(right, &b) != nil {
		return bytes.Equal(bytes.TrimSpace(left), bytes.TrimSpace(right))
	}
	return reflect.DeepEqual(a, b)
}

func cloneJSON(raw json.RawMessage) json.RawMessage {
	return append(json.RawMessage(nil), raw...)
}

func appendUniqueString(values []string, additions ...string) []string {
	for _, addition := range additions {
		seen := false
		for _, value := range values {
			if value == addition {
				seen = true
				break
			}
		}
		if !seen {
			values = append(values, addition)
		}
	}
	return values
}

func nullableActor(actorID string) any {
	if strings.TrimSpace(actorID) == "" {
		return nil
	}
	return actorID
}

// CoeditWorkspaceCloseDocuments permanently closes exam-level rooms after the
// authoritative mutation has committed.
func (s *Service) CoeditWorkspaceCloseDocuments(ctx context.Context, documentIDs []string, reason authoringcoedit.CloseReason) error {
	if len(documentIDs) == 0 {
		return nil
	}
	if !reason.Valid() {
		return authoringcoedit.New(authoringcoedit.CodeDisabled, "Unknown co-edit close reason.")
	}
	return s.runner.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		for _, id := range documentIDs {
			if _, err := q.ExecContext(ctx, `UPDATE authoring_coedit_workspaces
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

func workspaceResultFromDocument(doc CoeditWorkspaceDocument, duplicate bool) CoeditStoreResult {
	return CoeditStoreResult{
		DocumentName:         string(mustWorkspaceDocumentName(doc.ID)),
		StateHash:            hex.EncodeToString(doc.StateHash),
		QuestionRevision:     doc.MaterializedRevision,
		MaterializedRevision: doc.MaterializedRevision,
		StateEpoch:           coeditDecimal(doc.StateEpoch),
		CommitSequence:       coeditDecimal(doc.CommitSequence),
		WorkspaceRevision:    doc.MaterializedRevision,
		FreezeOperationID:    coeditFreezeOperationIDWorkspace(doc),
		FreezeExpiresAt:      coeditFreezeExpiresAtWorkspace(doc),
		Committed:            !duplicate, Duplicate: duplicate,
	}
}

func validateCoeditWorkspaceSizes(ydoc, vector, workspace []byte) error {
	if len(ydoc) > authoringcoedit.MaxYdocStateBytes || len(vector) > authoringcoedit.MaxStateVectorBytes || len(workspace) > authoringcoedit.MaxWorkspaceJSONBytes {
		return authoringcoedit.New(authoringcoedit.CodeOversized, "SAT collaboration state is too large to save.")
	}
	if len(workspace) > 0 && !json.Valid(workspace) {
		return authoringcoedit.New(authoringcoedit.CodeOversized, "SAT collaboration state is invalid.")
	}
	return nil
}

func firstNonEmpty(value, fallback string) string {
	if strings.TrimSpace(value) != "" {
		return value
	}
	return fallback
}
