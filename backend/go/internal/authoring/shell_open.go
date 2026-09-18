package authoring

import (
	"context"
	"database/sql"
	"strings"

	"github.com/google/uuid"

	"example.com/ielts-proctoring/internal/authoringrealtime"
	"example.com/ielts-proctoring/internal/platform/tx"
)

// Shell loads the current-draft authoring projection (mirrors shell()).
//
// Phase 03 cutover: this is the bulk path (bulkShell) — one identity
// statement plus four version-scoped tree reads inside a single read-only
// snapshot. There is deliberately NO provider gate here, matching the
// historical Shell(); OpenShell/Preview keep their sat gates. The nested
// per-section/per-module loaders (loadSections/loadModules/loadSummaries/
// loadRouting) remain for the in-tx post-commit shell (buildShellTx) and the
// equivalence harness's old-path reference; the live read path no longer uses
// them.
//
// This is the STRICT variant: every caller operates on an exam that already
// has a draft (post-clone shell, workbook import, publish continuation), so no
// draft pointer is a 404 "Draft version not found." Those callers predate the
// lifecycle contract and are not user-facing reads. Use ShellLifecycle for
// anything a client can reach: it distinguishes NO_DRAFT from EXAM_NOT_FOUND
// instead of collapsing both into one 404.
func (s *Service) Shell(ctx context.Context, examID string) (Shell, error) {
	result, err := s.bulkShell(ctx, examID)
	if err != nil {
		return Shell{}, err
	}
	if result.State != ShellStateReady || result.Shell == nil {
		return Shell{}, notFoundError("Draft version not found.")
	}
	return *result.Shell, nil
}

// OpenShell opens the editable-draft authoring shell (mirrors open_shell:
// exam FOR UPDATE, sat-only gate, existing-draft shortcut returns Shell,
// otherwise clone_published_sat_to_draft_tx + conditional pointer CAS +
// version_created event, commit then re-read).
//
// THE DRAFT-POINTER INVARIANT
// "One current editable draft per exam" is structural, not enforced by a
// constraint: exam_entities.current_draft_version_id is a single column, so an
// exam row can name at most one draft. What concurrency has to protect is the
// transition from "none" to "one":
//
//	SELECT ... FOR UPDATE on the exam row serializes openers;
//	the CAS (SET current_draft_version_id = ? WHERE ... IS NULL) admits exactly
//	one winner even if the row lock were ever bypassed;
//	a loser rolls back its clone, so no orphan draft survives.
//
// The database is therefore the final authority and the client's disabled
// button is only UX protection. Removing the CAS would turn this into a
// check-then-act race that a fixture with a draft already present cannot
// detect (see openshell_concurrency_test.go, which races N openers on a
// published exam with no draft for exactly that reason).
func (s *Service) OpenShell(ctx context.Context, examID, actorID string) (Shell, error) {
	emission := &eventEmission{}
	// claimedDraftVersionID is the draft this command returned or created. It
	// is only used to report an integrity fault after the transaction, where
	// naming the offending version is what makes the failure actionable.
	claimedDraftVersionID := ""
	err := s.runner.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		// SELECT ... FOR UPDATE on exam_entities locks the authoring owner first.
		var providerKey string
		var draftID, publishedID sql.NullString
		if err := q.QueryRowContext(ctx, "SELECT provider_key, current_draft_version_id, current_published_version_id FROM exam_entities WHERE id = ? FOR UPDATE", examID).Scan(&providerKey, &draftID, &publishedID); err != nil {
			if err == sql.ErrNoRows {
				// The same typed code the shell READ uses: a 404 on this exam
				// route has exactly one meaning, so a caller never has to
				// wonder whether the open failed because the exam is gone or
				// because there was no draft to open.
				return examNotFoundError("Exam not found.")
			}
			return err
		}
		if providerKey != "sat" {
			return validationError("Assessment provider is not supported.")
		}
		if draftID.Valid && strings.TrimSpace(draftID.String) != "" {
			claimedDraftVersionID = strings.TrimSpace(draftID.String)
			return nil
		}
		if !publishedID.Valid || strings.TrimSpace(publishedID.String) == "" {
			return validationError("The SAT exam has neither an editable draft nor a published version to continue.")
		}
		draftVersionID, err := s.clonePublishedSATToDraftTx(ctx, q, examID, strings.TrimSpace(publishedID.String), actorID)
		if err != nil {
			return err
		}
		claimedDraftVersionID = draftVersionID
		// Conditional pointer CAS: only one opener may claim the draft.
		res, err := q.ExecContext(ctx, "UPDATE exam_entities SET current_draft_version_id = ?, updated_at = CURRENT_TIMESTAMP(6), revision = revision + 1 WHERE id = ? AND current_draft_version_id IS NULL", draftVersionID, examID)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n != 1 {
			return conflictError("The SAT draft changed while authoring was opening.")
		}
		if _, err := q.ExecContext(ctx, "INSERT INTO exam_events (id, exam_id, version_id, actor_id, action, created_at) VALUES (?, ?, ?, ?, 'version_created', CURRENT_TIMESTAMP(6))", uuid.NewString(), examID, draftVersionID, actorID); err != nil {
			return err
		}
		// Phase 02: draft.opened, emitted only on the clone path (the existing-
		// draft shortcut above returns early with no state change and no event).
		if s.eventsOn() {
			scope, err := resolveDraftScopeTx(ctx, q, draftVersionID)
			if err != nil {
				return err
			}
			if err := s.appendAuthoringEventTx(ctx, q, emission, "open_shell", scope, authoringrealtime.EventInput{
				Kind:    authoringrealtime.KindDraftOpened,
				ActorID: actorID,
				Entity: authoringrealtime.Entity{
					Kind:           authoringrealtime.EntityDraft,
					ExamID:         examID,
					DraftVersionID: draftVersionID,
				},
				ChangedFields: authoringrealtime.NewChangedFields(string(authoringrealtime.FieldDraftRevision)),
			}); err != nil {
				return err
			}
		}
		return nil
	})
	emission.flush(err)
	if err != nil {
		return Shell{}, err
	}
	// Re-read through the lifecycle contract. The command just claimed or
	// returned a draft, so anything other than READY means the exam's pointer
	// disagrees with the version table — an integrity fault, not "no draft".
	// Reporting it as the generic not-found (which the old client rendered as
	// the "no editable draft" surface) would hide a real data fault behind a
	// normal-looking lifecycle state.
	result, err := s.bulkShell(ctx, examID)
	if err != nil {
		return Shell{}, err
	}
	if result.State != ShellStateReady || result.Shell == nil {
		return Shell{}, draftIntegrityError(examID, claimedDraftVersionID)
	}
	return *result.Shell, nil
}

// clonePublishedSATToDraftTx deep-copies a published SAT version into a new
// draft (mirrors clone_published_sat_to_draft_tx + clone_sat_version_tx with
// source_is_published/target_is_draft: version copy, section/module/question/
// revision/asset deep copy with ID remap across every table the Rust clone
// copies: exam_versions, assessment_sections, assessment_modules,
// assessment_routing_policies, assessment_scoring_policies,
// assessment_question_revisions, assessment_exam_questions).
func (s *Service) clonePublishedSATToDraftTx(ctx context.Context, q tx.Tx, examID, publishedVersionID, actorID string) (string, error) {
	// SELECT ... FOR UPDATE on the published source fences the clone.
	var contentSnapshot, configSnapshot string
	if err := q.QueryRowContext(ctx, "SELECT CAST(content_snapshot AS CHAR), CAST(config_snapshot AS CHAR) FROM exam_versions WHERE id = ? AND exam_id = ? AND is_published = TRUE FOR UPDATE", publishedVersionID, examID).Scan(&contentSnapshot, &configSnapshot); err != nil {
		if err == sql.ErrNoRows {
			return "", validationError("The published SAT version is unavailable for draft continuation.")
		}
		return "", err
	}
	var nextVersionNumber int
	if err := q.QueryRowContext(ctx, "SELECT COALESCE(MAX(version_number), 0) + 1 FROM exam_versions WHERE exam_id = ?", examID).Scan(&nextVersionNumber); err != nil {
		return "", err
	}
	draftVersionID := uuid.NewString()
	if _, err := q.ExecContext(ctx, "INSERT INTO exam_versions (id, exam_id, version_number, parent_version_id, content_snapshot, config_snapshot, validation_snapshot, created_by, is_draft, is_published, revision) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, TRUE, FALSE, 0)", draftVersionID, examID, nextVersionNumber, publishedVersionID, contentSnapshot, configSnapshot, actorID); err != nil {
		return "", err
	}
	type sectionCloneRow struct {
		id, sectionKey, title              string
		displayOrder, duration, breakAfter int
		instructions, toolPolicy           string
	}
	secRows, err := q.QueryContext(ctx, "SELECT id, section_key, title, display_order, duration_seconds, break_after_seconds, CAST(instructions AS CHAR), CAST(tool_policy AS CHAR) FROM assessment_sections WHERE exam_version_id = ? ORDER BY display_order, id", publishedVersionID)
	if err != nil {
		return "", err
	}
	sections := []sectionCloneRow{}
	for secRows.Next() {
		var sr sectionCloneRow
		if err := secRows.Scan(&sr.id, &sr.sectionKey, &sr.title, &sr.displayOrder, &sr.duration, &sr.breakAfter, &sr.instructions, &sr.toolPolicy); err != nil {
			secRows.Close()
			return "", err
		}
		sections = append(sections, sr)
	}
	secRows.Close()
	if err := secRows.Err(); err != nil {
		return "", err
	}
	if len(sections) == 0 {
		return "", validationError("The published SAT version has no assessment sections to continue editing.")
	}
	sectionIDs := make(map[string]string, len(sections))
	for _, sr := range sections {
		newSectionID := uuid.NewString()
		sectionIDs[sr.id] = newSectionID
		if _, err := q.ExecContext(ctx, "INSERT INTO assessment_sections (id, exam_version_id, section_key, title, display_order, duration_seconds, break_after_seconds, instructions, tool_policy, revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)", newSectionID, draftVersionID, sr.sectionKey, sr.title, sr.displayOrder, sr.duration, sr.breakAfter, sr.instructions, sr.toolPolicy); err != nil {
			return "", err
		}
	}
	type moduleCloneRow struct {
		id, sectionID, moduleKey, title, adaptiveRole string
		displayOrder, duration, targetCount           int
		instructions, toolPolicy                      string
	}
	modRows, err := q.QueryContext(ctx, "SELECT m.id, m.section_id, m.module_key, m.title, m.display_order, m.duration_seconds, m.target_question_count, m.adaptive_role, CAST(m.instructions AS CHAR), CAST(m.tool_policy AS CHAR) FROM assessment_modules m JOIN assessment_sections s ON s.id = m.section_id WHERE s.exam_version_id = ? ORDER BY s.display_order, m.display_order, m.id", publishedVersionID)
	if err != nil {
		return "", err
	}
	modules := []moduleCloneRow{}
	for modRows.Next() {
		var mr moduleCloneRow
		if err := modRows.Scan(&mr.id, &mr.sectionID, &mr.moduleKey, &mr.title, &mr.displayOrder, &mr.duration, &mr.targetCount, &mr.adaptiveRole, &mr.instructions, &mr.toolPolicy); err != nil {
			modRows.Close()
			return "", err
		}
		modules = append(modules, mr)
	}
	modRows.Close()
	if err := modRows.Err(); err != nil {
		return "", err
	}
	moduleIDs := make(map[string]string, len(modules))
	for _, mr := range modules {
		newSectionID, ok := sectionIDs[mr.sectionID]
		if !ok {
			return "", validationError("A published SAT module references an unknown section.")
		}
		newModuleID := uuid.NewString()
		moduleIDs[mr.id] = newModuleID
		if _, err := q.ExecContext(ctx, "INSERT INTO assessment_modules (id, section_id, module_key, title, display_order, duration_seconds, target_question_count, adaptive_role, instructions, tool_policy, revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)", newModuleID, newSectionID, mr.moduleKey, mr.title, mr.displayOrder, mr.duration, mr.targetCount, mr.adaptiveRole, mr.instructions, mr.toolPolicy); err != nil {
			return "", err
		}
	}
	type routingCloneRow struct {
		sectionID, baseID, lowerID, higherID, policyKey, policyConfig string
	}
	rtRows, err := q.QueryContext(ctx, "SELECT rp.section_id, rp.base_module_id, rp.lower_module_id, rp.higher_module_id, rp.policy_key, CAST(rp.policy_config AS CHAR) FROM assessment_routing_policies rp JOIN assessment_sections s ON s.id = rp.section_id WHERE s.exam_version_id = ?", publishedVersionID)
	if err != nil {
		return "", err
	}
	routings := []routingCloneRow{}
	for rtRows.Next() {
		var rr routingCloneRow
		if err := rtRows.Scan(&rr.sectionID, &rr.baseID, &rr.lowerID, &rr.higherID, &rr.policyKey, &rr.policyConfig); err != nil {
			rtRows.Close()
			return "", err
		}
		routings = append(routings, rr)
	}
	rtRows.Close()
	if err := rtRows.Err(); err != nil {
		return "", err
	}
	for _, rr := range routings {
		newSectionID, ok := sectionIDs[rr.sectionID]
		if !ok {
			return "", validationError("A SAT routing policy references an unknown section.")
		}
		newBaseID, ok := moduleIDs[rr.baseID]
		if !ok {
			return "", validationError("A SAT routing policy references an unknown base module.")
		}
		newLowerID, ok := moduleIDs[rr.lowerID]
		if !ok {
			return "", validationError("A SAT routing policy references an unknown lower module.")
		}
		newHigherID, ok := moduleIDs[rr.higherID]
		if !ok {
			return "", validationError("A SAT routing policy references an unknown higher module.")
		}
		if _, err := q.ExecContext(ctx, "INSERT INTO assessment_routing_policies (id, section_id, base_module_id, lower_module_id, higher_module_id, policy_key, policy_config, revision) VALUES (?, ?, ?, ?, ?, ?, ?, 0)", uuid.NewString(), newSectionID, newBaseID, newLowerID, newHigherID, rr.policyKey, rr.policyConfig); err != nil {
			return "", err
		}
	}
	var scoringKey, scoringConfig string
	if err := q.QueryRowContext(ctx, "SELECT policy_key, CAST(policy_config AS CHAR) FROM assessment_scoring_policies WHERE exam_version_id = ?", publishedVersionID).Scan(&scoringKey, &scoringConfig); err != nil {
		if err != sql.ErrNoRows {
			return "", err
		}
	} else if _, err := q.ExecContext(ctx, "INSERT INTO assessment_scoring_policies (id, exam_version_id, policy_key, policy_config, revision) VALUES (?, ?, ?, ?, 0)", uuid.NewString(), draftVersionID, scoringKey, scoringConfig); err != nil {
		return "", err
	}
	type questionCloneRow struct {
		sourceModuleID, sourceRevisionID, questionID string
		maxSemantic                                  sql.NullInt64
		questionType                                 string
		stimulus, prompt, answer, rationale          string
		metadata, accessibility                      string
		displayOrder                                 int
		isPretest                                    bool
	}
	qRows, err := q.QueryContext(ctx, "SELECT m.id, qr.id, eq.question_id, (SELECT MAX(r2.semantic_revision) FROM assessment_question_revisions r2 WHERE r2.question_id = eq.question_id), qr.question_type, CAST(qr.stimulus AS CHAR), CAST(qr.prompt AS CHAR), CAST(qr.answer_definition AS CHAR), CAST(qr.rationale AS CHAR), CAST(qr.metadata AS CHAR), CAST(qr.accessibility AS CHAR), eq.display_order, eq.is_pretest FROM assessment_exam_questions eq JOIN assessment_modules m ON m.id = eq.module_id JOIN assessment_sections s ON s.id = m.section_id JOIN assessment_question_revisions qr ON qr.id = eq.question_revision_id WHERE s.exam_version_id = ? ORDER BY s.display_order, m.display_order, eq.display_order, eq.id", publishedVersionID)
	if err != nil {
		return "", err
	}
	questions := []questionCloneRow{}
	for qRows.Next() {
		var qr questionCloneRow
		if err := qRows.Scan(&qr.sourceModuleID, &qr.sourceRevisionID, &qr.questionID, &qr.maxSemantic, &qr.questionType, &qr.stimulus, &qr.prompt, &qr.answer, &qr.rationale, &qr.metadata, &qr.accessibility, &qr.displayOrder, &qr.isPretest); err != nil {
			qRows.Close()
			return "", err
		}
		questions = append(questions, qr)
	}
	qRows.Close()
	if err := qRows.Err(); err != nil {
		return "", err
	}
	revisionIDs := make(map[string]string, len(questions))
	nextSemantic := map[string]int64{}
	for _, src := range questions {
		newRevisionID, ok := revisionIDs[src.sourceRevisionID]
		if !ok {
			semantic := src.maxSemantic.Int64 + 1
			if next, seen := nextSemantic[src.questionID]; seen {
				semantic = next
			}
			nextSemantic[src.questionID] = semantic + 1
			newRevisionID = uuid.NewString()
			revisionIDs[src.sourceRevisionID] = newRevisionID
			if _, err := q.ExecContext(ctx, "INSERT INTO assessment_question_revisions (id, question_id, semantic_revision, revision, state, question_type, stimulus, prompt, answer_definition, rationale, metadata, accessibility, created_by) VALUES (?, ?, ?, 0, 'draft', ?, ?, ?, ?, ?, ?, ?, ?)", newRevisionID, src.questionID, semantic, src.questionType, src.stimulus, src.prompt, src.answer, src.rationale, src.metadata, src.accessibility, actorID); err != nil {
				return "", err
			}
		}
		newModuleID, ok := moduleIDs[src.sourceModuleID]
		if !ok {
			return "", validationError("A published SAT question references an unknown module.")
		}
		if _, err := q.ExecContext(ctx, "INSERT INTO assessment_exam_questions (id, module_id, question_id, question_revision_id, display_order, is_pretest) VALUES (?, ?, ?, ?, ?, ?)", uuid.NewString(), newModuleID, src.questionID, newRevisionID, src.displayOrder, src.isPretest); err != nil {
			return "", err
		}
	}
	return draftVersionID, nil
}
