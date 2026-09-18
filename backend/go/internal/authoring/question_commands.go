package authoring

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"slices"
	"strings"

	"github.com/google/uuid"

	"example.com/ielts-proctoring/internal/authoringrealtime"
	"example.com/ielts-proctoring/internal/platform/tx"
)

// CreateQuestion appends one question to a module under draft locks (mirrors
// create_question: locks current draft for module, appends display_order).
func (s *Service) CreateQuestion(ctx context.Context, moduleID, actorID string, draft QuestionDraft, opts ...OperationOption) (QuestionDetail, error) {
	cfg := operationConfig{}
	for _, opt := range opts {
		opt(&cfg)
	}
	var operationKey string
	var fingerprint string
	if strings.TrimSpace(cfg.operationKey) != "" {
		key, err := normalizeOperationKey(cfg.operationKey)
		if err != nil {
			return QuestionDetail{}, err
		}
		operationKey = key
		fp, err := operationFingerprint(map[string]any{"module": moduleID, "draft": draft})
		if err != nil {
			return QuestionDetail{}, err
		}
		fingerprint = fp
	}
	scope := "create:" + moduleID
	var out QuestionDetail
	emission := &eventEmission{}
	err := s.runner.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		if operationKey != "" {
			replay, claimed, err := claimOperationKey(ctx, q, actorID, scope, operationKey, fingerprint)
			if err != nil {
				return err
			}
			if !claimed {
				if len(replay) == 0 {
					return conflictError("This create is still being processed; retry with the same operation key.")
				}
				if err := json.Unmarshal(replay, &out); err != nil {
					return err
				}
				return nil
			}
		}
		if err := touchModuleDraft(ctx, q, moduleID); err != nil {
			return err
		}
		// SELECT ... FOR UPDATE on the module serializes appends.
		var sectionKey, moduleKey string
		if err := q.QueryRowContext(ctx, "SELECT s.section_key, m.module_key FROM assessment_modules m JOIN assessment_sections s ON s.id = m.section_id WHERE m.id = ? FOR UPDATE", moduleID).Scan(&sectionKey, &moduleKey); err != nil {
			if err == sql.ErrNoRows {
				return notFoundError("Module not found.")
			}
			return err
		}
		if isEmptyQuestionDraft(draft) {
			draft = defaultSATQuestionDraft(sectionKey)
		}
		if strings.TrimSpace(draft.QuestionType) == "" {
			return validationError("Question type is required.")
		}
		// Capacity gate inside the same tx that locked the module row: a
		// second concurrent create racing the last slot loses here instead
		// of silently overfilling the module past target_question_count.
		if err := moduleCapacityFence(ctx, q, moduleID, 1); err != nil {
			return err
		}
		var nextOrder sql.NullInt64
		if err := q.QueryRowContext(ctx, "SELECT COALESCE(MAX(display_order), -1) + 1 FROM assessment_exam_questions WHERE module_id = ?", moduleID).Scan(&nextOrder); err != nil {
			return err
		}
		order := 0
		if nextOrder.Valid {
			order = int(nextOrder.Int64)
		}
		questionID := uuid.NewString()
		revisionID := uuid.NewString()
		examQuestionID := uuid.NewString()
		providerKey := "sat"
		if _, err := q.ExecContext(ctx, "INSERT INTO assessment_questions (id, provider_key, created_by, created_at, updated_at) VALUES (?, ?, ?, NOW(6), NOW(6))", questionID, providerKey, actorID); err != nil {
			return err
		}
		if _, err := q.ExecContext(ctx, "INSERT INTO assessment_question_revisions (id, question_id, semantic_revision, state, question_type, stimulus, prompt, answer_definition, rationale, metadata, accessibility, revision, created_by, created_at, updated_at) VALUES (?, ?, 1, 'draft', ?, ?, ?, ?, ?, ?, ?, 0, ?, NOW(6), NOW(6))", revisionID, questionID, draft.QuestionType, nonEmptyJSON(draft.Stimulus), nonEmptyJSON(draft.Prompt), nonEmptyJSON(draft.Answer), nonEmptyJSON(draft.Rationale), nonEmptyJSON(draft.Metadata), nonEmptyJSON(draft.Accessibility), actorID); err != nil {
			return err
		}
		if _, err := q.ExecContext(ctx, "INSERT INTO assessment_exam_questions (id, module_id, question_id, question_revision_id, display_order, is_pretest, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, NOW(6), NOW(6))", examQuestionID, moduleID, questionID, revisionID, order, draft.IsPretest); err != nil {
			return err
		}
		// Re-read the row so the response carries the server revision ids,
		// state, and accessibility the flat literal could never provide.
		detail, err := scanQuestionDetail(q.QueryRowContext(ctx, questionDetailQuery, examQuestionID))
		if err != nil {
			return err
		}
		out = detail
		// Phase 02: question.created carries the NEW placement. A fresh
		// revision row starts at revision 0, while draftRevision is the
		// post-bump working-draft generation.
		if s.eventsOn() {
			scope, err := resolveModuleScopeTx(ctx, q, moduleID)
			if err != nil {
				return err
			}
			if err := s.appendAuthoringEventTx(ctx, q, emission, "create", scope, authoringrealtime.EventInput{
				Kind:    authoringrealtime.KindQuestionCreated,
				ActorID: actorID,
				Entity: authoringrealtime.Entity{
					Kind:           authoringrealtime.EntityQuestion,
					ExamQuestionID: examQuestionID,
					QuestionID:     strPtr(questionID),
					ModuleID:       strPtr(moduleID),
				},
				ChangedFields: authoringrealtime.NewChangedFields(
					string(authoringrealtime.FieldDisplayOrder),
					string(authoringrealtime.FieldQuestionType),
				),
				CausationID: operationKey,
			}); err != nil {
				return err
			}
		}
		if operationKey != "" {
			if err := storeOperationResult(ctx, q, actorID, scope, operationKey, out); err != nil {
				return err
			}
		}
		return nil
	})
	emission.flush(err)
	return out, err
}

// isEmptyQuestionDraft reports whether the client sent no draft content at
// all (the empty-body POST .../questions path). A draft that names a
// question type but leaves payloads blank is an explicit (still valid) draft.
func isEmptyQuestionDraft(draft QuestionDraft) bool {
	return strings.TrimSpace(draft.QuestionType) == "" &&
		len(bytes.TrimSpace(draft.Stimulus)) == 0 &&
		len(bytes.TrimSpace(draft.Prompt)) == 0 &&
		len(bytes.TrimSpace(draft.Answer)) == 0 &&
		len(bytes.TrimSpace(draft.Rationale)) == 0 &&
		len(bytes.TrimSpace(draft.Metadata)) == 0 &&
		len(bytes.TrimSpace(draft.Accessibility)) == 0 &&
		!draft.IsPretest
}

// defaultSATQuestionDraft synthesizes the blank editor draft for a section.
// Reading & Writing only supports single_choice; math defaults to
// single_choice as well (SPR stays an explicit author choice), so the authored
// question opens incomplete-but-valid-shaped and the readiness gate
// (validateSATQuestion) reports what is still missing.
func defaultSATQuestionDraft(sectionKey string) QuestionDraft {
	questionType := "single_choice"
	if sectionKey != SectionReadingWriting && sectionKey != SectionMath {
		sectionKey = SectionReadingWriting
	}
	answer := json.RawMessage(`{"kind":"single_choice","options":[{"id":"A","content":{"version":2,"nodes":[],"document":{"type":"doc","content":[{"type":"paragraph"}]}}},{"id":"B","content":{"version":2,"nodes":[],"document":{"type":"doc","content":[{"type":"paragraph"}]}}},{"id":"C","content":{"version":2,"nodes":[],"document":{"type":"doc","content":[{"type":"paragraph"}]}}},{"id":"D","content":{"version":2,"nodes":[],"document":{"type":"doc","content":[{"type":"paragraph"}]}}}],"correctOptionId":null}`)
	metadata, _ := json.Marshal(map[string]any{
		"sectionKey": sectionKey,
		"domain":     nil,
		"skill":      nil,
		"difficulty": "medium",
		"tags":       []string{},
	})
	emptyDoc := json.RawMessage(`{"version":2,"nodes":[],"document":{"type":"doc","content":[{"type":"paragraph"}]}}`)
	return QuestionDraft{
		QuestionType:  questionType,
		Stimulus:      emptyDoc,
		Prompt:        emptyDoc,
		Answer:        answer,
		Rationale:     emptyDoc,
		Metadata:      metadata,
		Accessibility: json.RawMessage(`{"longDescription":null}`),
	}
}

// BatchCreateQuestions inserts many questions into one module (mirrors
// batch_create_questions). The whole batch runs in a single transaction:
// the module row is locked once and display orders are assigned
// deterministically from the pre-batch MAX(display_order), so concurrent
// batches cannot interleave or duplicate orders.
func (s *Service) BatchCreateQuestions(ctx context.Context, moduleID, actorID string, drafts []QuestionDraft, opts ...OperationOption) ([]QuestionSummary, error) {
	if len(drafts) == 0 {
		return nil, validationError("At least one question is required.")
	}
	if len(drafts) > 200 {
		return nil, validationError("Batch create accepts at most 200 questions.")
	}
	for _, d := range drafts {
		if strings.TrimSpace(d.QuestionType) == "" {
			return nil, validationError("Question type is required.")
		}
	}
	cfg := operationConfig{}
	for _, opt := range opts {
		opt(&cfg)
	}
	var operationKey, fingerprint string
	if strings.TrimSpace(cfg.operationKey) != "" {
		key, err := normalizeOperationKey(cfg.operationKey)
		if err != nil {
			return nil, err
		}
		operationKey = key
		fp, err := operationFingerprint(map[string]any{"module": moduleID, "drafts": drafts})
		if err != nil {
			return nil, err
		}
		fingerprint = fp
	}
	scope := "batch:" + moduleID
	out := make([]QuestionSummary, 0, len(drafts))
	emission := &eventEmission{}
	err := s.runner.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		if operationKey != "" {
			replay, claimed, err := claimOperationKey(ctx, q, actorID, scope, operationKey, fingerprint)
			if err != nil {
				return err
			}
			if !claimed {
				if len(replay) == 0 {
					return conflictError("This batch create is still being processed; retry with the same operation key.")
				}
				var replayed []QuestionSummary
				if err := json.Unmarshal(replay, &replayed); err != nil {
					return err
				}
				out = replayed
				return nil
			}
		}
		if err := touchModuleDraft(ctx, q, moduleID); err != nil {
			return err
		}
		// SELECT ... FOR UPDATE on the module serializes concurrent batches.
		var sectionKey, moduleKey string
		if err := q.QueryRowContext(ctx, "SELECT s.section_key, m.module_key FROM assessment_modules m JOIN assessment_sections s ON s.id = m.section_id WHERE m.id = ? FOR UPDATE", moduleID).Scan(&sectionKey, &moduleKey); err != nil {
			if err == sql.ErrNoRows {
				return notFoundError("Module not found.")
			}
			return err
		}
		// Batch capacity gate in the same tx that locked the module: the
		// whole batch is rejected when it would exceed target_question_count.
		if err := moduleCapacityFence(ctx, q, moduleID, len(drafts)); err != nil {
			return err
		}
		var base sql.NullInt64
		if err := q.QueryRowContext(ctx, "SELECT COALESCE(MAX(display_order), -1) FROM assessment_exam_questions WHERE module_id = ?", moduleID).Scan(&base); err != nil {
			return err
		}
		order := 0
		if base.Valid {
			order = int(base.Int64) + 1
		}
		for _, d := range drafts {
			questionID := uuid.NewString()
			revisionID := uuid.NewString()
			examQuestionID := uuid.NewString()
			providerKey := "sat"
			if _, err := q.ExecContext(ctx, "INSERT INTO assessment_questions (id, provider_key, created_by, created_at, updated_at) VALUES (?, ?, ?, NOW(6), NOW(6))", questionID, providerKey, actorID); err != nil {
				return err
			}
			if _, err := q.ExecContext(ctx, "INSERT INTO assessment_question_revisions (id, question_id, semantic_revision, state, question_type, stimulus, prompt, answer_definition, rationale, metadata, accessibility, revision, created_by, created_at, updated_at) VALUES (?, ?, 1, 'draft', ?, ?, ?, ?, ?, ?, ?, 0, ?, NOW(6), NOW(6))", revisionID, questionID, d.QuestionType, nonEmptyJSON(d.Stimulus), nonEmptyJSON(d.Prompt), nonEmptyJSON(d.Answer), nonEmptyJSON(d.Rationale), nonEmptyJSON(d.Metadata), nonEmptyJSON(d.Accessibility), actorID); err != nil {
				return err
			}
			if _, err := q.ExecContext(ctx, "INSERT INTO assessment_exam_questions (id, module_id, question_id, question_revision_id, display_order, is_pretest, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, NOW(6), NOW(6))", examQuestionID, moduleID, questionID, revisionID, order, d.IsPretest); err != nil {
				return err
			}
			_ = sectionKey
			_ = moduleKey
			out = append(out, (questionValidationRow{
				examQuestionID: examQuestionID, questionID: questionID, revisionID: revisionID,
				sectionKey: sectionKey, displayOrder: order, isPretest: d.IsPretest,
				semanticRevision: 1, questionType: d.QuestionType,
				stimulus: string(nonEmptyJSON(d.Stimulus)), prompt: string(nonEmptyJSON(d.Prompt)), answer: string(nonEmptyJSON(d.Answer)),
				rationale: string(nonEmptyJSON(d.Rationale)), metadata: string(nonEmptyJSON(d.Metadata)),
			}).summary())
			order++
		}
		// Phase 02: one coarse event per batch (never N) — receivers refetch.
		if s.eventsOn() {
			scope, err := resolveModuleScopeTx(ctx, q, moduleID)
			if err != nil {
				return err
			}
			ids := make([]string, 0, len(out))
			for _, summary := range out {
				ids = append(ids, summary.ExamQuestionID)
			}
			if err := s.appendAuthoringEventTx(ctx, q, emission, "batch", scope, authoringrealtime.EventInput{
				Kind:                    authoringrealtime.KindQuestionBulkChanged,
				ActorID:                 actorID,
				Entity:                  authoringrealtime.Entity{Kind: authoringrealtime.EntityModule, ModuleID: strPtr(moduleID)},
				AffectedExamQuestionIDs: boundedIDs(ids),
				ChangedFields:           authoringrealtime.NewChangedFields("displayOrder"),
			}); err != nil {
				return err
			}
		}
		if operationKey != "" {
			if err := storeOperationResult(ctx, q, actorID, scope, operationKey, out); err != nil {
				return err
			}
		}
		return nil
	})
	emission.flush(err)
	if err != nil {
		return nil, err
	}
	return out, nil
}

const questionDetailQuery = "SELECT eq.id, eq.module_id, m.module_key, s.section_key, eq.display_order, eq.is_pretest, eq.question_revision_id, eq.question_id, r.semantic_revision, r.revision, r.state, r.question_type, CAST(r.stimulus AS CHAR), CAST(r.prompt AS CHAR), CAST(r.answer_definition AS CHAR), CAST(r.rationale AS CHAR), CAST(r.metadata AS CHAR), CAST(r.accessibility AS CHAR) FROM assessment_exam_questions eq JOIN assessment_modules m ON m.id = eq.module_id JOIN assessment_sections s ON s.id = m.section_id JOIN assessment_question_revisions r ON r.id = eq.question_revision_id WHERE eq.id = ?"

// ListQuestions returns one provider-validated summary per question in a
// module (mirrors the Rust summaries() projection).
func (s *Service) ListQuestions(ctx context.Context, moduleID string) ([]QuestionSummary, error) {
	var exists string
	if err := s.db.QueryRowContext(ctx, "SELECT m.id FROM assessment_modules m JOIN assessment_sections s ON s.id = m.section_id WHERE m.id = ?", moduleID).Scan(&exists); err != nil {
		if err == sql.ErrNoRows {
			return nil, notFoundError("Module not found.")
		}
		return nil, err
	}
	rows, err := loadQuestionValidationRows(ctx, s.db, moduleID)
	if err != nil {
		return nil, err
	}
	out := make([]QuestionSummary, 0, len(rows))
	for _, row := range rows {
		out = append(out, row.summary())
	}
	return out, nil
}

// GetQuestion loads one exam-question detail.
func (s *Service) GetQuestion(ctx context.Context, examQuestionID string) (QuestionDetail, error) {
	return scanQuestionDetail(s.db.QueryRowContext(ctx, questionDetailQuery, examQuestionID))
}

func scanQuestionDetail(row *sql.Row) (QuestionDetail, error) {
	var d QuestionDetail
	var isPretest bool
	err := row.Scan(&d.ExamQuestionID, &d.ModuleID, &d.ModuleKey, &d.SectionKey, &d.DisplayOrder, &isPretest, &d.Question.ID, &d.Question.QuestionID, &d.Question.SemanticRevision, &d.Question.Revision, &d.Question.State, &d.Question.QuestionType, rawScanner(&d.Question.Stimulus), rawScanner(&d.Question.Prompt), rawScanner(&d.Question.Answer), rawScanner(&d.Question.Rationale), rawScanner(&d.Question.Metadata), rawScanner(&d.Question.Accessibility))
	if err != nil {
		if err == sql.ErrNoRows {
			return QuestionDetail{}, notFoundError("Question not found.")
		}
		return QuestionDetail{}, err
	}
	d.IsPretest = isPretest
	return d, nil
}

// UpdateQuestion replaces the revision payload for one exam question (mirrors
// save_question; bumps semantic_revision + revision under locks).
func (s *Service) UpdateQuestion(ctx context.Context, examQuestionID, actorID string, expectedRevision int, draft QuestionDraft) (QuestionDetail, error) {
	var out QuestionDetail
	emission := &eventEmission{}
	err := s.runner.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		if err := touchQuestionDraft(ctx, q, examQuestionID); err != nil {
			return err
		}
		// SELECT ... FOR UPDATE on assessment_exam_questions serializes edits.
		var questionID, revisionID string
		var semanticRev, rev int
		if err := q.QueryRowContext(ctx, "SELECT eq.question_id, eq.question_revision_id, r.semantic_revision, r.revision FROM assessment_exam_questions eq JOIN assessment_question_revisions r ON r.id = eq.question_revision_id WHERE eq.id = ? FOR UPDATE", examQuestionID).Scan(&questionID, &revisionID, &semanticRev, &rev); err != nil {
			if err == sql.ErrNoRows {
				return notFoundError("Question not found.")
			}
			return err
		}
		if rev != expectedRevision {
			return conflictError("Question changed while you were editing; refresh before retrying.")
		}
		// Co-editing guard: a whole-revision replacement carries a prompt, so
		// it is refused while a collaborative room owns that prompt.
		if err := s.coeditGuardTx(ctx, q, examQuestionID, draft); err != nil {
			return err
		}
		newRevisionID := uuid.NewString()
		if _, err := q.ExecContext(ctx, "INSERT INTO assessment_question_revisions (id, question_id, semantic_revision, state, question_type, stimulus, prompt, answer_definition, rationale, metadata, accessibility, revision, created_by, created_at, updated_at) VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, 0, ?, NOW(6), NOW(6))", newRevisionID, questionID, semanticRev+1, orDefault(draft.QuestionType, "single_choice"), nonEmptyJSON(draft.Stimulus), nonEmptyJSON(draft.Prompt), nonEmptyJSON(draft.Answer), nonEmptyJSON(draft.Rationale), nonEmptyJSON(draft.Metadata), nonEmptyJSON(draft.Accessibility), actorID); err != nil {
			return err
		}
		if _, err := q.ExecContext(ctx, "UPDATE assessment_exam_questions SET question_revision_id = ?, is_pretest = ?, updated_at = NOW(6) WHERE id = ?", newRevisionID, draft.IsPretest, examQuestionID); err != nil {
			return err
		}
		_ = revisionID
		detail, err := scanQuestionDetail(q.QueryRowContext(ctx, questionDetailQuery, examQuestionID))
		if err != nil {
			return err
		}
		out = detail
		// Phase 02: one question.changed carrying the NEW revision (read from
		// the re-read detail), in-tx with the revision insert.
		if s.eventsOn() {
			scope, err := resolveQuestionScopeTx(ctx, q, examQuestionID)
			if err != nil {
				return err
			}
			if err := s.appendAuthoringEventTx(ctx, q, emission, "save", scope, authoringrealtime.EventInput{
				Kind:    authoringrealtime.KindQuestionChanged,
				ActorID: actorID,
				Entity: authoringrealtime.Entity{
					Kind:           authoringrealtime.EntityQuestion,
					ExamQuestionID: examQuestionID,
					QuestionID:     strPtr(questionID),
					ModuleID:       strPtr(detail.ModuleID),
				},
				ChangedFields: authoringrealtime.NewChangedFields("prompt", "stimulus", "answer", "rationale", "metadata.domain", "metadata.skill", "metadata.difficulty", "metadata.tags", "accessibility", "isPretest", "questionType"),
			}); err != nil {
				return err
			}
		}
		return nil
	})
	emission.flush(err)
	return out, err
}

// DeleteQuestion removes one exam question (mirrors delete_question).
// actorID is the server-resolved staff user recorded on the tombstone event;
// it is never accepted from the request body.
func (s *Service) DeleteQuestion(ctx context.Context, examQuestionID, actorID string) error {
	emission := &eventEmission{}
	err := s.runner.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		if err := touchQuestionDraft(ctx, q, examQuestionID); err != nil {
			return err
		}
		// SELECT ... FOR UPDATE serializes delete vs reorder/duplicate.
		var moduleID string
		if err := q.QueryRowContext(ctx, "SELECT module_id FROM assessment_exam_questions WHERE id = ? FOR UPDATE", examQuestionID).Scan(&moduleID); err != nil {
			if err == sql.ErrNoRows {
				return notFoundError("Question not found.")
			}
			return err
		}
		if _, err := q.ExecContext(ctx, "DELETE FROM assessment_exam_questions WHERE id = ?", examQuestionID); err != nil {
			return err
		}
		// Phase 02: tombstone event. questionId is null by contract; receivers
		// must not dereference it and keep local unsaved work.
		if s.eventsOn() {
			scope, err := resolveModuleScopeTx(ctx, q, moduleID)
			if err != nil {
				return err
			}
			if err := s.appendAuthoringEventTx(ctx, q, emission, "delete", scope, authoringrealtime.EventInput{
				Kind:    authoringrealtime.KindQuestionDeleted,
				ActorID: actorID,
				Entity: authoringrealtime.Entity{
					Kind:           authoringrealtime.EntityQuestion,
					ExamQuestionID: examQuestionID,
					QuestionID:     nil,
					ModuleID:       strPtr(moduleID),
				},
			}); err != nil {
				return err
			}
		}
		return nil
	})
	emission.flush(err)
	return err
}

// ReorderQuestions rewrites display_order under module locks (mirrors
// reorder_questions; expected ids fence stale consoles). actorID is the
// server-resolved staff user recorded on the moved event.
func (s *Service) ReorderQuestions(ctx context.Context, moduleID string, expectedIDs, orderedIDs []string, actorID string) error {
	if len(orderedIDs) == 0 {
		return validationError("At least one question id is required.")
	}
	emission := &eventEmission{}
	err := s.runner.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		if err := touchModuleDraft(ctx, q, moduleID); err != nil {
			return err
		}
		// SELECT ... FOR UPDATE on the module row serializes reorder vs edits.
		var exists string
		if err := q.QueryRowContext(ctx, "SELECT id FROM assessment_modules WHERE id = ? FOR UPDATE", moduleID).Scan(&exists); err != nil {
			if err == sql.ErrNoRows {
				return notFoundError("Module not found.")
			}
			return err
		}
		rows, err := q.QueryContext(ctx, "SELECT id, display_order FROM assessment_exam_questions WHERE module_id = ? ORDER BY display_order ASC FOR UPDATE", moduleID)
		if err != nil {
			return err
		}
		current := []string{}
		maxOrder := -1
		for rows.Next() {
			var id string
			var order int
			if err := rows.Scan(&id, &order); err != nil {
				rows.Close()
				return err
			}
			current = append(current, id)
			if order > maxOrder {
				maxOrder = order
			}
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}
		if expectedIDs != nil && !slices.Equal(current, expectedIDs) {
			return conflictError("Questions changed while you were editing; refresh before retrying.")
		}
		if !sameSet(current, orderedIDs) {
			return validationError("Reorder list must contain exactly the module questions.")
		}
		for i, id := range current {
			if _, err := q.ExecContext(ctx, "UPDATE assessment_exam_questions SET display_order = ? WHERE id = ? AND module_id = ?", maxOrder+1+i, id, moduleID); err != nil {
				return err
			}
		}
		for i, id := range orderedIDs {
			if _, err := q.ExecContext(ctx, "UPDATE assessment_exam_questions SET display_order = ?, updated_at = NOW(6) WHERE id = ? AND module_id = ?", i, id, moduleID); err != nil {
				return err
			}
		}
		// Phase 02: one question.moved for the whole module rewrite. Receivers
		// refetch authoritative order instead of replaying the permutation.
		if s.eventsOn() {
			scope, err := resolveModuleScopeTx(ctx, q, moduleID)
			if err != nil {
				return err
			}
			if err := s.appendAuthoringEventTx(ctx, q, emission, "reorder", scope, authoringrealtime.EventInput{
				Kind:    authoringrealtime.KindQuestionMoved,
				ActorID: actorID,
				Entity: authoringrealtime.Entity{
					Kind:     authoringrealtime.EntityModule,
					ModuleID: strPtr(moduleID),
				},
				AffectedExamQuestionIDs: boundedIDs(orderedIDs),
				ChangedFields:           authoringrealtime.NewChangedFields("displayOrder"),
			}); err != nil {
				return err
			}
		}
		return nil
	})
	emission.flush(err)
	return err
}

// DuplicateQuestion copies one exam question into a module (mirrors
// duplicate_question).
func (s *Service) DuplicateQuestion(ctx context.Context, examQuestionID string, destModuleID *string, actorID string, insertAfter *string, opts ...OperationOption) (QuestionDetail, error) {
	cfg := operationConfig{}
	for _, opt := range opts {
		opt(&cfg)
	}
	var operationKey string
	var fingerprint string
	if strings.TrimSpace(cfg.operationKey) != "" {
		key, err := normalizeOperationKey(cfg.operationKey)
		if err != nil {
			return QuestionDetail{}, err
		}
		operationKey = key
		fp, err := operationFingerprint(map[string]any{"source": examQuestionID, "dest": destModuleID, "after": insertAfter})
		if err != nil {
			return QuestionDetail{}, err
		}
		fingerprint = fp
	}
	scope := "duplicate:" + examQuestionID
	var out QuestionDetail
	emission := &eventEmission{}
	err := s.runner.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		if operationKey != "" {
			replay, claimed, err := claimOperationKey(ctx, q, actorID, scope, operationKey, fingerprint)
			if err != nil {
				return err
			}
			if !claimed {
				if len(replay) == 0 {
					return conflictError("This duplicate is still being processed; retry with the same operation key.")
				}
				if err := json.Unmarshal(replay, &out); err != nil {
					return err
				}
				return nil
			}
		}
		if err := touchQuestionDraft(ctx, q, examQuestionID); err != nil {
			return err
		}
		// SELECT ... FOR UPDATE on the source row serializes duplicate vs edit.
		var srcModule, questionID, revisionID string
		var order int
		var pretest bool
		if err := q.QueryRowContext(ctx, "SELECT module_id, question_id, question_revision_id, display_order, is_pretest FROM assessment_exam_questions WHERE id = ? FOR UPDATE", examQuestionID).Scan(&srcModule, &questionID, &revisionID, &order, &pretest); err != nil {
			if err == sql.ErrNoRows {
				return notFoundError("Question not found.")
			}
			return err
		}
		dest := srcModule
		if destModuleID != nil && strings.TrimSpace(*destModuleID) != "" {
			dest = strings.TrimSpace(*destModuleID)
		}
		if dest != srcModule {
			if err := touchModuleDraft(ctx, q, dest); err != nil {
				return err
			}
		}
		// A cross-module duplicate is an insert into dest; same-module
		// duplicate also grows the module by one. Fence both before the copy.
		if err := moduleCapacityFence(ctx, q, dest, 1); err != nil {
			return err
		}
		var nextOrder sql.NullInt64
		if err := q.QueryRowContext(ctx, "SELECT COALESCE(MAX(display_order), -1) + 1 FROM assessment_exam_questions WHERE module_id = ?", dest).Scan(&nextOrder); err != nil {
			return err
		}
		newOrder := 0
		if nextOrder.Valid {
			newOrder = int(nextOrder.Int64)
		}
		if insertAfter != nil {
			var anchorOrder int
			err := q.QueryRowContext(ctx, "SELECT display_order FROM assessment_exam_questions WHERE id = ? AND module_id = ? FOR UPDATE", *insertAfter, dest).Scan(&anchorOrder)
			if err == sql.ErrNoRows {
				return validationError("Insertion anchor must belong to the destination module.")
			}
			if err != nil {
				return err
			}
			newOrder = anchorOrder + 1
			if _, err := q.ExecContext(ctx, "UPDATE assessment_exam_questions SET display_order = display_order + 1 WHERE module_id = ? AND display_order >= ? ORDER BY display_order DESC", dest, newOrder); err != nil {
				return err
			}
		}
		questionID, revisionID, err := cloneQuestionContent(ctx, q, revisionID, actorID)
		if err != nil {
			return err
		}
		newID := uuid.NewString()
		if _, err := q.ExecContext(ctx, "INSERT INTO assessment_exam_questions (id, module_id, question_id, question_revision_id, display_order, is_pretest, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, NOW(6), NOW(6))", newID, dest, questionID, revisionID, newOrder, pretest); err != nil {
			return err
		}
		_ = order
		detail, err := scanQuestionDetail(q.QueryRowContext(ctx, questionDetailQuery, newID))
		if err != nil {
			return err
		}
		out = detail
		// Phase 02: one question.duplicated naming the NEW placement.
		if s.eventsOn() {
			scope, err := resolveModuleScopeTx(ctx, q, dest)
			if err != nil {
				return err
			}
			if err := s.appendAuthoringEventTx(ctx, q, emission, "duplicate", scope, authoringrealtime.EventInput{
				Kind:    authoringrealtime.KindQuestionDuplicated,
				ActorID: actorID,
				Entity: authoringrealtime.Entity{
					Kind:           authoringrealtime.EntityQuestion,
					ExamQuestionID: newID,
					QuestionID:     strPtr(questionID),
					ModuleID:       strPtr(dest),
				},
				CausationID: operationKey,
			}); err != nil {
				return err
			}
		}
		if operationKey != "" {
			if err := storeOperationResult(ctx, q, actorID, scope, operationKey, out); err != nil {
				return err
			}
		}
		return nil
	})
	emission.flush(err)
	return out, err
}

// BulkResult mirrors the frontend BulkQuestionResult: affected + created ids
// plus the re-projected summaries the list pane re-renders.
type BulkResult struct {
	AffectedQuestionIDs []string          `json:"affectedQuestionIds"`
	CreatedQuestionIDs  []string          `json:"createdQuestionIds"`
	UpdatedQuestions    []QuestionSummary `json:"updatedQuestions"`
}

// ExamQuestionIDForRevision resolves the exam-question placement that
// currently points at a revision id (the save-revision route is addressed by
// revision id while fencing + reads are placement-scoped).
func (s *Service) ExamQuestionIDForRevision(ctx context.Context, revisionID string) (string, error) {
	var examQuestionID string
	if err := s.db.QueryRowContext(ctx, "SELECT eq.id FROM assessment_exam_questions eq WHERE eq.question_revision_id = ?", revisionID).Scan(&examQuestionID); err != nil {
		if err == sql.ErrNoRows {
			return "", notFoundError("Question not found.")
		}
		return "", err
	}
	return examQuestionID, nil
}

// BulkQuestions applies one move|duplicate|set_pretest|patch_metadata|delete
// action to many questions under module locks (mirrors bulk_questions).
func (s *Service) BulkQuestions(ctx context.Context, questionIDs []string, action BulkAction, actorID string, expectedRevisions map[string]int, opts ...OperationOption) (BulkResult, error) {
	if len(questionIDs) == 0 {
		return BulkResult{}, validationError("At least one question id is required.")
	}
	switch action.Type {
	case "move", "duplicate", "set_pretest", "patch_metadata", "delete":
	default:
		return BulkResult{}, validationError(fmt.Sprintf("Unknown bulk action %q.", action.Type))
	}
	seen := make(map[string]bool, len(questionIDs))
	for _, id := range questionIDs {
		if seen[id] {
			return BulkResult{}, validationError("Question ids must be unique.")
		}
		seen[id] = true
		if expectedRevisions != nil {
			if _, ok := expectedRevisions[id]; !ok {
				return BulkResult{}, validationError("Expected revisions must include every selected question.")
			}
		}
	}
	cfg := operationConfig{}
	for _, opt := range opts {
		opt(&cfg)
	}
	var operationKey, fingerprint string
	if strings.TrimSpace(cfg.operationKey) != "" {
		key, err := normalizeOperationKey(cfg.operationKey)
		if err != nil {
			return BulkResult{}, err
		}
		operationKey = key
		fp, err := operationFingerprint(map[string]any{"ids": questionIDs, "action": action, "revs": expectedRevisions})
		if err != nil {
			return BulkResult{}, err
		}
		fingerprint = fp
	}
	scope := "bulk:" + action.Type
	result := BulkResult{AffectedQuestionIDs: []string{}, CreatedQuestionIDs: []string{}, UpdatedQuestions: []QuestionSummary{}}
	affectedModules := map[string]bool{}
	emission := &eventEmission{}
	err := s.runner.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		if operationKey != "" {
			replay, claimed, err := claimOperationKey(ctx, q, actorID, scope, operationKey, fingerprint)
			if err != nil {
				return err
			}
			if !claimed {
				if len(replay) == 0 {
					return conflictError("This bulk action is still being processed; retry with the same operation key.")
				}
				var replayed BulkResult
				if err := json.Unmarshal(replay, &replayed); err != nil {
					return err
				}
				result = replayed
				return nil
			}
		}
		// Validate every optimistic revision before applying any of the batch.
		for _, id := range questionIDs {
			if err := touchQuestionDraft(ctx, q, id); err != nil {
				return err
			}
			if expectedRevisions != nil {
				var revision int
				if err := q.QueryRowContext(ctx, "SELECT r.revision FROM assessment_exam_questions eq JOIN assessment_question_revisions r ON r.id = eq.question_revision_id WHERE eq.id = ? FOR UPDATE", id).Scan(&revision); err != nil {
					return err
				}
				if revision != expectedRevisions[id] {
					return conflictError("Question changed while you were editing; refresh before retrying.")
				}
			}
		}
		if action.DestinationModuleID != "" {
			if err := touchModuleDraft(ctx, q, action.DestinationModuleID); err != nil {
				return err
			}
		}
		if action.Type == "move" || action.Type == "duplicate" {
			if strings.TrimSpace(action.DestinationModuleID) == "" {
				return validationError("Destination module is required for move.")
			}
			// Net inserts into dest = questions not already there, so moving
			// within the same module never trips the fence spuriously.
			placement := map[string]string{}
			for _, id := range questionIDs {
				var moduleID string
				if err := q.QueryRowContext(ctx, "SELECT module_id FROM assessment_exam_questions WHERE id = ?", id).Scan(&moduleID); err != nil {
					if err == sql.ErrNoRows {
						return notFoundError("Question not found.")
					}
					return err
				}
				placement[id] = moduleID
			}
			netInserts := 0
			for _, id := range questionIDs {
				if placement[id] != action.DestinationModuleID {
					netInserts++
				}
			}
			if action.Type == "duplicate" {
				netInserts = len(questionIDs)
			}
			if netInserts > 0 {
				if err := moduleCapacityFence(ctx, q, action.DestinationModuleID, netInserts); err != nil {
					return err
				}
			}
		}
		for _, id := range questionIDs {
			// SELECT ... FOR UPDATE per row serializes bulk vs single edits.
			var moduleID string
			if err := q.QueryRowContext(ctx, "SELECT module_id FROM assessment_exam_questions WHERE id = ? FOR UPDATE", id).Scan(&moduleID); err != nil {
				if err == sql.ErrNoRows {
					return notFoundError("Question not found.")
				}
				return err
			}
			switch action.Type {
			case "delete":
				if _, err := q.ExecContext(ctx, "DELETE FROM assessment_exam_questions WHERE id = ?", id); err != nil {
					return err
				}
			case "move":
				if strings.TrimSpace(action.DestinationModuleID) == "" {
					return validationError("Destination module is required for move.")
				}
				if _, err := q.ExecContext(ctx, "UPDATE assessment_exam_questions SET module_id = ?, display_order = (SELECT COALESCE(MAX(display_order), -1) + 1 FROM (SELECT display_order FROM assessment_exam_questions WHERE module_id = ?) AS m), updated_at = NOW(6) WHERE id = ?", action.DestinationModuleID, action.DestinationModuleID, id); err != nil {
					return err
				}
			case "duplicate":
				dest := moduleID
				if strings.TrimSpace(action.DestinationModuleID) != "" {
					dest = action.DestinationModuleID
				}
				var questionID, revisionID string
				var pretest bool
				if err := q.QueryRowContext(ctx, "SELECT question_id, question_revision_id, is_pretest FROM assessment_exam_questions WHERE id = ?", id).Scan(&questionID, &revisionID, &pretest); err != nil {
					return err
				}
				questionID, revisionID, err := cloneQuestionContent(ctx, q, revisionID, actorID)
				if err != nil {
					return err
				}
				newID := uuid.NewString()
				if _, err := q.ExecContext(ctx, "INSERT INTO assessment_exam_questions (id, module_id, question_id, question_revision_id, display_order, is_pretest, created_at, updated_at) VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(display_order), -1) + 1 FROM (SELECT display_order FROM assessment_exam_questions WHERE module_id = ?) AS m), ?, NOW(6), NOW(6))", newID, dest, questionID, revisionID, dest, pretest); err != nil {
					return err
				}
				result.CreatedQuestionIDs = append(result.CreatedQuestionIDs, newID)
				affectedModules[dest] = true
			case "set_pretest":
				if _, err := q.ExecContext(ctx, "UPDATE assessment_exam_questions SET is_pretest = ?, updated_at = NOW(6) WHERE id = ?", action.PretestValue, id); err != nil {
					return err
				}
			case "patch_metadata":
				if len(action.Patch) == 0 {
					return validationError("Metadata patch must not be empty.")
				}
				var revisionID string
				if err := q.QueryRowContext(ctx, "SELECT question_revision_id FROM assessment_exam_questions WHERE id = ?", id).Scan(&revisionID); err != nil {
					return err
				}
				var raw sql.NullString
				if err := q.QueryRowContext(ctx, "SELECT CAST(metadata AS CHAR) FROM assessment_question_revisions WHERE id = ? FOR UPDATE", revisionID).Scan(&raw); err != nil {
					return err
				}
				merged := map[string]any{}
				if raw.Valid && strings.TrimSpace(raw.String) != "" && strings.TrimSpace(raw.String) != "null" {
					if err := json.Unmarshal([]byte(raw.String), &merged); err != nil {
						return validationError("Question metadata is not a JSON object.")
					}
				}
				if merged == nil {
					merged = map[string]any{}
				}
				for k, v := range action.Patch {
					merged[k] = v
				}
				patched, err := json.Marshal(merged)
				if err != nil {
					return err
				}
				patched, err = normalizeSATQuestionMetadata(patched)
				if err != nil {
					return err
				}
				res, err := q.ExecContext(ctx, "UPDATE assessment_question_revisions SET metadata = ?, revision = revision + 1, updated_at = NOW(6) WHERE id = ?", string(patched), revisionID)
				if err != nil {
					return err
				}
				if n, _ := res.RowsAffected(); n != 1 {
					return notFoundError("Question not found.")
				}
				if _, err := q.ExecContext(ctx, "UPDATE assessment_exam_questions SET updated_at = NOW(6) WHERE id = ?", id); err != nil {
					return err
				}
			}
			if action.Type == "set_pretest" || action.Type == "move" {
				if _, err := q.ExecContext(ctx, "UPDATE assessment_question_revisions r JOIN assessment_exam_questions eq ON eq.question_revision_id = r.id SET r.revision = r.revision + 1 WHERE eq.id = ?", id); err != nil {
					return err
				}
			}
			_ = actorID
			result.AffectedQuestionIDs = append(result.AffectedQuestionIDs, id)
			affectedModules[moduleID] = true
			if action.Type == "move" && strings.TrimSpace(action.DestinationModuleID) != "" {
				affectedModules[action.DestinationModuleID] = true
			}
		}
		if action.Type != "delete" {
			for moduleID := range affectedModules {
				rows, err := loadQuestionValidationRows(ctx, q, moduleID)
				if err != nil {
					return err
				}
				for _, row := range rows {
					result.UpdatedQuestions = append(result.UpdatedQuestions, row.summary())
				}
			}
		}
		// Phase 02: ONE coarse event per bulk call regardless of N, keyed to the
		// first affected module (receivers refetch shell + tree authoritatively).
		if s.eventsOn() && len(result.AffectedQuestionIDs) > 0 {
			primaryModule := ""
			if len(questionIDs) > 0 {
				if err := q.QueryRowContext(ctx, "SELECT module_id FROM assessment_exam_questions WHERE id = ?", questionIDs[0]).Scan(&primaryModule); err != nil {
					if err == sql.ErrNoRows {
						primaryModule = ""
					} else {
						return err
					}
				}
			}
			if primaryModule == "" {
				for moduleID := range affectedModules {
					primaryModule = moduleID
					break
				}
			}
			if primaryModule != "" {
				scope, err := resolveModuleScopeTx(ctx, q, primaryModule)
				if err != nil {
					return err
				}
				changed := []string{"displayOrder", "moduleId", "isPretest", "metadata.domain", "metadata.skill", "metadata.difficulty", "metadata.tags"}
				if err := s.appendAuthoringEventTx(ctx, q, emission, "bulk", scope, authoringrealtime.EventInput{
					Kind:                    authoringrealtime.KindQuestionBulkChanged,
					ActorID:                 actorID,
					Entity:                  authoringrealtime.Entity{Kind: authoringrealtime.EntityModule, ModuleID: strPtr(primaryModule)},
					AffectedExamQuestionIDs: boundedIDs(append(append([]string{}, result.AffectedQuestionIDs...), result.CreatedQuestionIDs...)),
					ChangedFields:           authoringrealtime.NewChangedFields(changed...),
					CausationID:             operationKey,
				}); err != nil {
					return err
				}
			}
		}
		if operationKey != "" {
			if err := storeOperationResult(ctx, q, actorID, scope, operationKey, result); err != nil {
				return err
			}
		}
		return nil
	})
	emission.flush(err)
	if err != nil {
		return BulkResult{}, err
	}
	return result, nil
}

// SaveRevision updates a question in the current draft and advances its fencing
// counter. The response is the QuestionRevision the editor installs in its cache.
func (s *Service) SaveRevision(ctx context.Context, examQuestionID, revisionID string, expectedRevision int, draft QuestionDraft, actorID string) (QuestionRevisionDetail, error) {
	var out QuestionDetail
	emission := &eventEmission{}
	err := s.runner.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		if err := touchQuestionDraft(ctx, q, examQuestionID); err != nil {
			return err
		}
		// SELECT ... FOR UPDATE on the exam-question row serializes seal vs edit.
		var currentRevisionID string
		if err := q.QueryRowContext(ctx, "SELECT question_revision_id FROM assessment_exam_questions WHERE id = ? FOR UPDATE", examQuestionID).Scan(&currentRevisionID); err != nil {
			if err == sql.ErrNoRows {
				return notFoundError("Question not found.")
			}
			return err
		}
		if currentRevisionID != revisionID {
			return conflictError("Question changed while you were editing; refresh before retrying.")
		}
		var rev int
		var state string
		if err := q.QueryRowContext(ctx, "SELECT revision, state FROM assessment_question_revisions WHERE id = ? FOR UPDATE", revisionID).Scan(&rev, &state); err != nil {
			if err == sql.ErrNoRows {
				return notFoundError("Question not found.")
			}
			return err
		}
		if rev != expectedRevision {
			return conflictError("Question changed while you were editing; refresh before retrying.")
		}
		// Co-editing guard: an active collaborative room owns this prompt. The
		// check runs in-tx so a staggered deployment cannot interleave writers.
		if err := s.coeditGuardTx(ctx, q, examQuestionID, draft); err != nil {
			return err
		}
		questionType := orDefault(draft.QuestionType, "single_choice")
		metadata := nonEmptyJSON(draft.Metadata)
		if normalized, err := normalizeSATQuestionMetadata(metadata); err != nil {
			return err
		} else {
			metadata = normalized
		}
		if _, err := q.ExecContext(ctx, "UPDATE assessment_question_revisions SET question_type = ?, stimulus = ?, prompt = ?, answer_definition = ?, rationale = ?, metadata = ?, accessibility = ?, revision = revision + 1, state = 'draft', sealed_at = NULL, updated_by = ?, updated_at = NOW(6) WHERE id = ?", questionType, nonEmptyJSON(draft.Stimulus), nonEmptyJSON(draft.Prompt), nonEmptyJSON(draft.Answer), nonEmptyJSON(draft.Rationale), metadata, nonEmptyJSON(draft.Accessibility), actorID, revisionID); err != nil {
			return err
		}
		detail, err := scanQuestionDetail(q.QueryRowContext(ctx, questionDetailQuery, examQuestionID))
		if err != nil {
			return err
		}
		out = detail
		// Phase 02: one question.changed per revision save (in-tx with the bump).
		if s.eventsOn() {
			scope, err := resolveQuestionScopeTx(ctx, q, examQuestionID)
			if err != nil {
				return err
			}
			if err := s.appendAuthoringEventTx(ctx, q, emission, "save_revision", scope, authoringrealtime.EventInput{
				Kind:    authoringrealtime.KindQuestionChanged,
				ActorID: actorID,
				Entity: authoringrealtime.Entity{
					Kind:           authoringrealtime.EntityQuestion,
					ExamQuestionID: examQuestionID,
					QuestionID:     strPtr(detail.Question.ID),
					ModuleID:       strPtr(detail.ModuleID),
				},
				ChangedFields: authoringrealtime.NewChangedFields("prompt", "stimulus", "answer", "rationale", "metadata.domain", "metadata.skill", "metadata.difficulty", "metadata.tags", "accessibility", "questionType"),
			}); err != nil {
				return err
			}
		}
		return nil
	})
	emission.flush(err)
	return out.Question, err
}
