package authoring

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/google/uuid"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/tx"
)

// RegisterSATWorkbookPreview records only a valid, renderer-checked preview.
// Replacing a previous preview for the same actor keeps staged media and
// import recovery bounded to one active workbook session.
func (s *Service) RegisterSATWorkbookPreview(ctx context.Context, examID, actorID string, preview SatWorkbookPreview) error {
	if !preview.Valid {
		return validationError("Only a valid SAT workbook can be staged for import.")
	}
	shell, err := s.Shell(ctx, examID)
	if err != nil {
		return err
	}
	if shell.ProviderKey != "sat" {
		return validationError("Assessment provider is not supported.")
	}
	manifest := make([]SatWorkbookAsset, 0, len(preview.Assets))
	for _, asset := range preview.Assets {
		asset.DataBase64 = nil
		manifest = append(manifest, asset)
	}
	manifestJSON, err := json.Marshal(manifest)
	if err != nil {
		return err
	}
	return s.runner.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		var provider string
		var currentDraft sql.NullString
		if err := q.QueryRowContext(ctx, "SELECT provider_key, current_draft_version_id FROM exam_entities WHERE id = ? FOR UPDATE", examID).Scan(&provider, &currentDraft); err != nil {
			if err == sql.ErrNoRows {
				return notFoundError("Exam not found.")
			}
			return err
		}
		if provider != "sat" || !currentDraft.Valid || strings.TrimSpace(currentDraft.String) == "" {
			return validationError("The SAT exam does not have an editable draft.")
		}
		var revision int
		if err := q.QueryRowContext(ctx, "SELECT revision FROM exam_versions WHERE id = ? AND exam_id = ? AND is_draft = TRUE FOR UPDATE", currentDraft.String, examID).Scan(&revision); err != nil {
			if err == sql.ErrNoRows {
				return notFoundError("Draft version not found.")
			}
			return err
		}
		if revision != shell.VersionRevision || currentDraft.String != shell.VersionID {
			return conflictError("The SAT draft changed while the workbook was being checked. Run the checks again.")
		}
		if _, err := q.ExecContext(ctx, "UPDATE sat_workbook_imports SET state = 'expired', updated_at = CURRENT_TIMESTAMP(6) WHERE exam_id = ? AND created_by = ? AND state = 'previewed'", examID, actorID); err != nil {
			return err
		}
		_, err := q.ExecContext(ctx, "INSERT INTO sat_workbook_imports (id, exam_id, expected_version_id, expected_version_revision, asset_manifest, state, created_by, expires_at) VALUES (?, ?, ?, ?, ?, 'previewed', ?, DATE_ADD(CURRENT_TIMESTAMP(6), INTERVAL 1 DAY))", preview.ImportID, examID, shell.VersionID, shell.VersionRevision, string(manifestJSON), actorID)
		return err
	})
}

// LoadSampleExam atomically replaces the current SAT draft with the complete
// built-in sample sent by the frontend.
func (s *Service) LoadSampleExam(ctx context.Context, examID string, request LoadSampleExamRequest, actorID string) (Shell, error) {
	requests := make([]satReplacementRequest, 0, len(request.Modules))
	for _, module := range request.Modules {
		requests = append(requests, satReplacementRequest{ModuleID: module.ModuleID, Questions: module.Questions})
	}
	return s.replaceCompleteSATDraft(ctx, examID, request.ExpectedVersionID, request.ExpectedVersionRevision, actorID, requests, nil)
}

// CommitSATWorkbook validates the staged import again under locks, checkpoints
// the existing draft, replaces all question placements, and records the
// revision needed for a safe one-step undo.
func (s *Service) CommitSATWorkbook(ctx context.Context, examID string, request SatWorkbookCommitRequest, actorID string, opts ...OperationOption) (CommitResult, error) {
	if strings.TrimSpace(request.ImportID) == "" {
		return CommitResult{}, validationError("Workbook import id is required.")
	}
	if len(request.Modules) != len(satWorkbookModules) {
		return CommitResult{}, validationError("A complete SAT workbook must contain all six modules.")
	}
	cfg := operationConfig{}
	for _, opt := range opts {
		opt(&cfg)
	}
	var operationKey, fingerprint string
	if strings.TrimSpace(cfg.operationKey) != "" {
		key, err := normalizeOperationKey(cfg.operationKey)
		if err != nil {
			return CommitResult{}, err
		}
		operationKey = key
		fp, err := operationFingerprint(map[string]any{"import": request.ImportID, "version": request.ExpectedVersionID, "rev": request.ExpectedVersionRevision, "modules": request.Modules, "assets": request.Assets})
		if err != nil {
			return CommitResult{}, err
		}
		fingerprint = fp
	}
	scope := "workbook:" + examID
	requests := make([]satReplacementRequest, 0, len(request.Modules))
	for _, module := range request.Modules {
		requests = append(requests, satReplacementRequest{
			ModuleKey:  module.ModuleKey,
			SectionKey: module.SectionKey,
			Questions:  module.Questions,
		})
	}
	// Single-tx path: claim + mutation + replay-store commit atomically
	// inside replaceCompleteSATDraftOpKey (no pre/post-tx window).
	if operationKey != "" {
		shell, err := s.replaceCompleteSATDraftOpKey(ctx, examID, request.ExpectedVersionID, request.ExpectedVersionRevision, actorID, requests, &satImportRequest{ImportID: request.ImportID, Assets: request.Assets}, operationKey, scope, fingerprint)
		if err != nil {
			return CommitResult{}, err
		}
		return CommitResult{Shell: shell, Undo: UndoState{ImportID: request.ImportID, Available: true}}, nil
	}
	shell, err := s.replaceCompleteSATDraft(ctx, examID, request.ExpectedVersionID, request.ExpectedVersionRevision, actorID, requests, &satImportRequest{ImportID: request.ImportID, Assets: request.Assets})
	if err != nil {
		return CommitResult{}, err
	}
	return CommitResult{Shell: shell, Undo: UndoState{ImportID: request.ImportID, Available: true}}, nil
}

// SATWorkbookUndoState returns an undo only while the committed version is
// still the active draft and has not been edited after import.
func (s *Service) SATWorkbookUndoState(ctx context.Context, examID string) (*UndoState, error) {
	var state UndoState
	var importedVersion, currentVersion sql.NullString
	var importedRevision, currentRevision sql.NullInt64
	if err := s.db.QueryRowContext(ctx, `SELECT i.id, i.imported_version_id, i.imported_version_revision, e.current_draft_version_id, v.revision
		FROM sat_workbook_imports i
		JOIN exam_entities e ON e.id = i.exam_id
		LEFT JOIN exam_versions v ON v.id = e.current_draft_version_id
		WHERE i.exam_id = ? AND i.state = 'committed'
		ORDER BY i.created_at DESC LIMIT 1`, examID).Scan(&state.ImportID, &importedVersion, &importedRevision, &currentVersion, &currentRevision); err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	state.Available = importedVersion.Valid && currentVersion.Valid && importedVersion.String == currentVersion.String && importedRevision.Valid && currentRevision.Valid && importedRevision.Int64 == currentRevision.Int64
	return &state, nil
}

// UndoSATWorkbook restores the immutable checkpoint created at commit time.
func (s *Service) UndoSATWorkbook(ctx context.Context, examID, importID, actorID string) (Shell, error) {
	err := s.runner.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		var provider string
		var currentDraft sql.NullString
		if err := q.QueryRowContext(ctx, "SELECT provider_key, current_draft_version_id FROM exam_entities WHERE id = ? FOR UPDATE", examID).Scan(&provider, &currentDraft); err != nil {
			if err == sql.ErrNoRows {
				return notFoundError("Exam not found.")
			}
			return err
		}
		if provider != "sat" {
			return validationError("Assessment provider is not supported.")
		}
		var checkpoint, imported, assetIDsRaw sql.NullString
		var importedRevision sql.NullInt64
		var createdBy string
		if err := q.QueryRowContext(ctx, `SELECT checkpoint_version_id, imported_version_id, imported_version_revision, created_by, CAST(asset_ids AS CHAR)
				FROM sat_workbook_imports WHERE id = ? AND exam_id = ? AND state = 'committed' FOR UPDATE`, importID, examID).Scan(&checkpoint, &imported, &importedRevision, &createdBy, &assetIDsRaw); err != nil {
			if err == sql.ErrNoRows {
				return conflictError("This SAT workbook import can no longer be undone.")
			}
			return err
		}
		if actorID != "" && createdBy != actorID {
			return apperrors.New(apperrors.CodeForbidden, "Only the staff member who imported this workbook can undo it.")
		}
		if !checkpoint.Valid || !imported.Valid || !importedRevision.Valid || !currentDraft.Valid || currentDraft.String != imported.String {
			return conflictError("The SAT changed after this import. Undo is no longer available.")
		}
		var currentRevision int
		var isDraft bool
		if err := q.QueryRowContext(ctx, "SELECT revision, is_draft FROM exam_versions WHERE id = ? AND exam_id = ? FOR UPDATE", imported.String, examID).Scan(&currentRevision, &isDraft); err != nil {
			return err
		}
		if !isDraft || int64(currentRevision) != importedRevision.Int64 {
			return conflictError("The SAT was edited after this import. Undo is no longer available.")
		}
		var checkpointDraft, checkpointPublished bool
		if err := q.QueryRowContext(ctx, "SELECT is_draft, is_published FROM exam_versions WHERE id = ? AND exam_id = ? FOR UPDATE", checkpoint.String, examID).Scan(&checkpointDraft, &checkpointPublished); err != nil {
			if err == sql.ErrNoRows {
				return conflictError("The SAT workbook recovery checkpoint is no longer available.")
			}
			return err
		}
		if checkpointDraft || checkpointPublished {
			return conflictError("The SAT workbook recovery checkpoint is no longer available.")
		}
		if _, err := q.ExecContext(ctx, "UPDATE exam_versions SET is_draft = FALSE WHERE id = ? AND is_draft = TRUE", imported.String); err != nil {
			return err
		}
		result, err := q.ExecContext(ctx, "UPDATE exam_versions SET is_draft = TRUE WHERE id = ? AND exam_id = ? AND is_draft = FALSE AND is_published = FALSE", checkpoint.String, examID)
		if err != nil {
			return err
		}
		if n, _ := result.RowsAffected(); n != 1 {
			return conflictError("The SAT workbook recovery checkpoint could not be restored.")
		}
		if _, err := q.ExecContext(ctx, "UPDATE exam_entities SET current_draft_version_id = ?, updated_at = CURRENT_TIMESTAMP(6), revision = revision + 1 WHERE id = ?", checkpoint.String, examID); err != nil {
			return err
		}
		if assetIDsRaw.Valid && strings.TrimSpace(assetIDsRaw.String) != "" && strings.TrimSpace(assetIDsRaw.String) != "null" {
			var assetIDs []string
			if err := json.Unmarshal([]byte(assetIDsRaw.String), &assetIDs); err != nil {
				return validationError("The imported media recovery record is unreadable.")
			}
			if len(assetIDs) > 0 {
				args := append([]any{examID}, stringsToAny(assetIDs)...)
				if _, err := q.ExecContext(ctx, "UPDATE media_assets SET upload_status = 'orphaned', delete_after_at = DATE_ADD(CURRENT_TIMESTAMP(6), INTERVAL 7 DAY), updated_at = CURRENT_TIMESTAMP(6) WHERE owner_kind = 'assessment_exam' AND owner_id = ? AND id IN ("+sqlPlaceholders(len(assetIDs))+")", args...); err != nil {
					return err
				}
			}
		}
		updated, err := q.ExecContext(ctx, "UPDATE sat_workbook_imports SET state = 'undone', undone_at = CURRENT_TIMESTAMP(6), updated_at = CURRENT_TIMESTAMP(6) WHERE id = ? AND exam_id = ? AND state = 'committed'", importID, examID)
		if err != nil {
			return err
		}
		if n, _ := updated.RowsAffected(); n != 1 {
			return conflictError("The SAT workbook import was already undone.")
		}
		if _, err := q.ExecContext(ctx, "INSERT INTO exam_events (id, exam_id, version_id, actor_id, action, payload, created_at) VALUES (?, ?, ?, ?, 'version_restored', ?, CURRENT_TIMESTAMP(6))", uuid.NewString(), examID, checkpoint.String, actorID, fmt.Sprintf(`{"reason":"sat_workbook_import_undo","importId":%q}`, importID)); err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		return Shell{}, err
	}
	return s.Shell(ctx, examID)
}

type satReplacementRequest struct {
	ModuleID, ModuleKey, SectionKey string
	Questions                       []QuestionDraft
}

type satImportRequest struct {
	ImportID string
	Assets   []SatWorkbookStagedAsset
}

type satTargetModule struct {
	ID, SectionKey, ModuleKey string
	TargetCount               int
}

func (s *Service) replaceCompleteSATDraft(ctx context.Context, examID, expectedVersionID string, expectedRevision int, actorID string, requests []satReplacementRequest, importRequest *satImportRequest) (Shell, error) {
	return s.replaceCompleteSATDraftOpKey(ctx, examID, expectedVersionID, expectedRevision, actorID, requests, importRequest, "", "", "")
}

// replaceCompleteSATDraftOpKey runs claim + mutation + replay-store in ONE
// tx: the opkey row, the draft replacement, and the stored replay result
// commit atomically, so a crash can never leave a claimed key without a
// replayable result (or a committed draft without one). The replay Shell
// is built from in-tx reads; every other op (create/duplicate/batch/bulk)
// already claims+stores in-tx via claimOperationKey/storeOperationResult.
func (s *Service) replaceCompleteSATDraftOpKey(ctx context.Context, examID, expectedVersionID string, expectedRevision int, actorID string, requests []satReplacementRequest, importRequest *satImportRequest, operationKey, opScope, opFingerprint string) (Shell, error) {
	for moduleIndex := range requests {
		for questionIndex := range requests[moduleIndex].Questions {
			metadata, err := normalizeSATQuestionMetadata(requests[moduleIndex].Questions[questionIndex].Metadata)
			if err != nil {
				return Shell{}, err
			}
			requests[moduleIndex].Questions[questionIndex].Metadata = metadata
		}
	}
	var replayed CommitResult
	var replayHit bool
	var committed CommitResult
	err := s.runner.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		if operationKey != "" {
			replay, claimed, err := claimOperationKey(ctx, q, actorID, opScope, operationKey, opFingerprint)
			if err != nil {
				return err
			}
			if !claimed {
				if len(replay) == 0 {
					return conflictError("This workbook commit is still being processed; retry with the same operation key.")
				}
				if err := json.Unmarshal(replay, &replayed); err != nil {
					return err
				}
				replayHit = true
				return nil
			}
		}
		var provider string
		var currentDraft sql.NullString
		if err := q.QueryRowContext(ctx, "SELECT provider_key, current_draft_version_id FROM exam_entities WHERE id = ? FOR UPDATE", examID).Scan(&provider, &currentDraft); err != nil {
			if err == sql.ErrNoRows {
				return notFoundError("Exam not found.")
			}
			return err
		}
		if provider != "sat" || !currentDraft.Valid || currentDraft.String != expectedVersionID {
			return conflictError("The SAT draft changed before the complete replacement could be applied. Refresh and try again.")
		}
		var actualRevision int
		if err := q.QueryRowContext(ctx, "SELECT revision FROM exam_versions WHERE id = ? AND exam_id = ? AND is_draft = TRUE FOR UPDATE", expectedVersionID, examID).Scan(&actualRevision); err != nil {
			if err == sql.ErrNoRows {
				return notFoundError("Draft version not found.")
			}
			return err
		}
		if actualRevision != expectedRevision {
			return conflictError("The SAT draft changed before the complete replacement could be applied. Refresh and try again.")
		}

		var manifest []SatWorkbookAsset
		var stagedIDs []string
		if importRequest != nil {
			var expectedID, createdBy string
			var importRevision int
			var manifestRaw string
			if err := q.QueryRowContext(ctx, `SELECT expected_version_id, expected_version_revision, asset_manifest, created_by
				FROM sat_workbook_imports WHERE id = ? AND exam_id = ? AND state = 'previewed' AND expires_at > CURRENT_TIMESTAMP(6) FOR UPDATE`, importRequest.ImportID, examID).Scan(&expectedID, &importRevision, &manifestRaw, &createdBy); err != nil {
				if err == sql.ErrNoRows {
					return conflictError("This SAT workbook preview has expired or was already used. Check the workbook again before importing.")
				}
				return err
			}
			if createdBy != actorID || expectedID != expectedVersionID || importRevision != expectedRevision {
				return conflictError("The SAT workbook preview does not belong to the current draft session.")
			}
			if err := json.Unmarshal([]byte(manifestRaw), &manifest); err != nil {
				return validationError("The workbook asset manifest is unreadable.")
			}
			staged, err := verifySATWorkbookAssetsTx(ctx, q, importRequest.ImportID, manifest, importRequest.Assets)
			if err != nil {
				return err
			}
			stagedIDs = staged.ids
			for index := range requests {
				for questionIndex := range requests[index].Questions {
					if err := materializeSATWorkbookAssets(&requests[index].Questions[questionIndex], staged.byKey); err != nil {
						return err
					}
				}
			}
		}

		targets, err := loadSATTargetModules(ctx, q, expectedVersionID)
		if err != nil {
			return err
		}
		if len(targets) != len(satWorkbookModules) || len(requests) != len(targets) {
			return validationError("Complete SAT replacement must contain every module exactly once.")
		}
		byID := make(map[string]int, len(requests))
		byKey := make(map[string]int, len(requests))
		for index, request := range requests {
			if request.ModuleID != "" {
				if _, exists := byID[request.ModuleID]; exists {
					return validationError("Complete SAT replacement contains a duplicate module.")
				}
				byID[request.ModuleID] = index
			}
			if request.ModuleKey != "" {
				if _, exists := byKey[request.ModuleKey]; exists {
					return validationError("The workbook contains a duplicate SAT module.")
				}
				byKey[request.ModuleKey] = index
			}
		}
		requestByTarget := make(map[string]satReplacementRequest, len(targets))
		usedRequests := make(map[int]bool, len(requests))
		for _, target := range targets {
			requestIndex, ok := byID[target.ID]
			if !ok {
				requestIndex, ok = byKey[target.ModuleKey]
			}
			if !ok || usedRequests[requestIndex] {
				return validationError("Complete SAT replacement contains an unknown or missing module.")
			}
			usedRequests[requestIndex] = true
			request := requests[requestIndex]
			if request.SectionKey != "" && request.SectionKey != target.SectionKey {
				return validationError("The workbook module does not match its SAT section.")
			}
			if request.ModuleKey != "" && request.ModuleKey != target.ModuleKey {
				return validationError("The workbook module does not match its SAT destination.")
			}
			spec, known := satBlueprintModule(target.SectionKey, target.ModuleKey)
			if !known || target.TargetCount != spec.questionCount {
				return validationError("SAT module target count does not match the provider blueprint.")
			}
			if len(request.Questions) != target.TargetCount {
				return validationError(fmt.Sprintf("%s requires exactly %d questions.", target.ModuleKey, target.TargetCount))
			}
			pretestCount := 0
			for index, question := range request.Questions {
				if question.IsPretest {
					pretestCount++
				}
				issues := validateReplacementQuestion(target.SectionKey, question)
				if len(issues) > 0 {
					return workbookValidationError(issues, target.ModuleKey, index)
				}
			}
			if pretestCount != spec.pretestCount {
				return validationError(fmt.Sprintf("%s requires exactly %d pretest questions.", target.ModuleKey, spec.pretestCount))
			}
			requestByTarget[target.ID] = request
		}
		if len(usedRequests) != len(requests) {
			return validationError("Complete SAT replacement contains an unknown or missing module.")
		}

		checkpointID := ""
		if importRequest != nil {
			checkpointID, err = cloneSATDraftVersionTx(ctx, q, examID, expectedVersionID, actorID)
			if err != nil {
				return err
			}
		}
		moduleIDs := make([]string, 0, len(targets))
		for _, target := range targets {
			moduleIDs = append(moduleIDs, target.ID)
		}
		previousIDs, err := loadSATQuestionIDs(ctx, q, expectedVersionID)
		if err != nil {
			return err
		}
		if _, err := q.ExecContext(ctx, "DELETE FROM assessment_exam_questions WHERE module_id IN ("+sqlPlaceholders(len(moduleIDs))+")", stringsToAny(moduleIDs)...); err != nil {
			return err
		}
		// Existing question rows remain reachable from the recovery checkpoint.
		// Keep those rows for recovery; a sample replacement without a checkpoint
		// can safely remove its now-unreferenced question records.
		if len(previousIDs) > 0 {
			if _, err := q.ExecContext(ctx, "DELETE q FROM assessment_questions q WHERE q.id IN ("+sqlPlaceholders(len(previousIDs))+") AND NOT EXISTS (SELECT 1 FROM assessment_exam_questions eq WHERE eq.question_id = q.id)", stringsToAny(previousIDs)...); err != nil {
				return err
			}
		}
		for _, target := range targets {
			request := requestByTarget[target.ID]
			for index, question := range request.Questions {
				if err := insertSATQuestionTx(ctx, q, actorID, target.ID, index, question); err != nil {
					return err
				}
			}
		}
		if _, err := q.ExecContext(ctx, "UPDATE exam_versions SET revision = revision + 1 WHERE id = ? AND exam_id = ?", expectedVersionID, examID); err != nil {
			return err
		}
		if importRequest != nil {
			if len(stagedIDs) > 0 {
				promoted, err := q.ExecContext(ctx, "UPDATE media_assets SET owner_kind = 'assessment_exam', owner_id = ?, delete_after_at = NULL, updated_at = CURRENT_TIMESTAMP(6) WHERE owner_kind = 'assessment_import' AND owner_id = ? AND upload_status = 'finalized' AND id IN ("+sqlPlaceholders(len(stagedIDs))+")", append([]any{examID, importRequest.ImportID}, stringsToAny(stagedIDs)...)...)
				if err != nil {
					return err
				}
				if n, _ := promoted.RowsAffected(); n != int64(len(stagedIDs)) {
					return conflictError("A staged workbook image changed before import. Check the workbook again.")
				}
			}
			var postRevision int
			if err := q.QueryRowContext(ctx, "SELECT revision FROM exam_versions WHERE id = ?", expectedVersionID).Scan(&postRevision); err != nil {
				return err
			}
			assetIDsJSON, _ := json.Marshal(stagedIDs)
			updated, err := q.ExecContext(ctx, "UPDATE sat_workbook_imports SET checkpoint_version_id = ?, imported_version_id = ?, imported_version_revision = ?, asset_ids = ?, state = 'committed', updated_at = CURRENT_TIMESTAMP(6) WHERE id = ? AND exam_id = ? AND state = 'previewed'", checkpointID, expectedVersionID, postRevision, string(assetIDsJSON), importRequest.ImportID, examID)
			if err != nil {
				return err
			}
			if n, _ := updated.RowsAffected(); n != 1 {
				return conflictError("The SAT workbook import was already completed or expired.")
			}
			if _, err := q.ExecContext(ctx, "INSERT INTO exam_events (id, exam_id, version_id, actor_id, action, payload, created_at) VALUES (?, ?, ?, ?, 'version_created', ?, CURRENT_TIMESTAMP(6))", uuid.NewString(), examID, checkpointID, actorID, fmt.Sprintf(`{"reason":"sat_workbook_import_checkpoint","importId":%q}`, importRequest.ImportID)); err != nil {
				return err
			}
		}
		// Build the replay Shell from in-tx reads and store it with the
		// key in the SAME tx: commit is atomic over (claim, mutation,
		// replay result). A crash before commit leaves no partial effect
		// and no poisoned key; a crash after commit leaves a replayable
		// result (the committed import row is itself idempotent via the
		// previewed->committed CAS above).
		if operationKey != "" && !replayHit {
			shell, err := buildShellTx(ctx, s, q, examID)
			if err != nil {
				return err
			}
			committed = CommitResult{Shell: shell, Undo: UndoState{ImportID: importRequestID(importRequest), Available: true}}
			if err := storeOperationResult(ctx, q, actorID, opScope, operationKey, committed); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return Shell{}, err
	}
	if replayHit {
		return replayed.Shell, nil
	}
	if operationKey != "" {
		return committed.Shell, nil
	}
	return s.Shell(ctx, examID)
}

// buildShellTx reads the post-commit draft shell inside the replace tx
// (same snapshot that committed the mutation).
func buildShellTx(ctx context.Context, s *Service, q tx.Tx, examID string) (Shell, error) {
	var providerKey string
	var draftID sql.NullString
	if err := q.QueryRowContext(ctx, "SELECT provider_key, current_draft_version_id FROM exam_entities WHERE id = ?", examID).Scan(&providerKey, &draftID); err != nil {
		if err == sql.ErrNoRows {
			return Shell{}, notFoundError("Exam not found.")
		}
		return Shell{}, err
	}
	if !draftID.Valid || draftID.String == "" {
		return Shell{}, notFoundError("Draft version not found.")
	}
	var rev int
	if err := q.QueryRowContext(ctx, "SELECT revision FROM exam_versions WHERE id = ? AND exam_id = ? AND is_draft = TRUE", draftID.String, examID).Scan(&rev); err != nil {
		if err == sql.ErrNoRows {
			return Shell{}, notFoundError("Draft version not found.")
		}
		return Shell{}, err
	}
	sections, err := s.loadSections(ctx, q, draftID.String)
	if err != nil {
		return Shell{}, err
	}
	return Shell{ExamID: examID, ProviderKey: providerKey, VersionID: draftID.String, VersionRevision: rev, Sections: sections}, nil
}

func importRequestID(r *satImportRequest) string {
	if r == nil {
		return ""
	}
	return r.ImportID
}

func workbookValidationError(issues []ValidationIssue, moduleKey string, index int) *apperrors.Error {
	err := apperrors.New(apperrors.CodeValidation, "SAT workbook validation failed.")
	for issueIndex := range issues {
		issues[issueIndex].Path = fmt.Sprintf("modules.%s.questions.%d.%s", moduleKey, index, issues[issueIndex].Path)
	}
	err.Details = map[string]any{"issues": issues}
	return err
}

func loadSATTargetModules(ctx context.Context, q tx.Tx, versionID string) ([]satTargetModule, error) {
	rows, err := q.QueryContext(ctx, `SELECT m.id, s.section_key, m.module_key, m.target_question_count
		FROM assessment_modules m
		JOIN assessment_sections s ON s.id = m.section_id
		WHERE s.exam_version_id = ?
		ORDER BY s.display_order, m.display_order, m.id FOR UPDATE`, versionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	targets := make([]satTargetModule, 0)
	for rows.Next() {
		var target satTargetModule
		if err := rows.Scan(&target.ID, &target.SectionKey, &target.ModuleKey, &target.TargetCount); err != nil {
			return nil, err
		}
		targets = append(targets, target)
	}
	return targets, rows.Err()
}

func validateReplacementQuestion(section string, question QuestionDraft) []ValidationIssue {
	issues := validateSATQuestion(section, question.QuestionType, string(nonEmptyJSON(question.Stimulus)), string(nonEmptyJSON(question.Prompt)), string(nonEmptyJSON(question.Answer)), string(nonEmptyJSON(question.Rationale)), string(nonEmptyJSON(question.Metadata)))
	return issues
}

func normalizeSATQuestionMetadata(raw json.RawMessage) (json.RawMessage, error) {
	var metadata map[string]any
	if err := json.Unmarshal(nonEmptyJSON(raw), &metadata); err != nil || metadata == nil {
		return raw, nil
	}
	value, exists := metadata["tags"]
	if !exists {
		metadata["tags"] = []string{}
		encoded, err := json.Marshal(metadata)
		return encoded, err
	}
	tags, ok := value.([]any)
	if !ok {
		return nil, validationError("Question tags must be a list of strings.")
	}
	normalized := make([]string, 0, len(tags))
	for _, rawTag := range tags {
		tag, ok := rawTag.(string)
		if !ok {
			return nil, validationError("Question tags must be a list of strings.")
		}
		tag = strings.TrimSpace(tag)
		if tag == "" {
			continue
		}
		if len([]rune(tag)) > 64 {
			return nil, validationError("Question tags cannot exceed 64 characters.")
		}
		duplicate := false
		for _, existing := range normalized {
			if strings.EqualFold(existing, tag) {
				duplicate = true
				break
			}
		}
		if duplicate {
			continue
		}
		normalized = append(normalized, tag)
		if len(normalized) > 24 {
			return nil, validationError("A question can contain at most 24 tags.")
		}
	}
	metadata["tags"] = normalized
	encoded, err := json.Marshal(metadata)
	return encoded, err
}

func insertSATQuestionTx(ctx context.Context, q tx.Tx, actorID, moduleID string, displayOrder int, draft QuestionDraft) error {
	questionID := uuid.NewString()
	revisionID := uuid.NewString()
	examQuestionID := uuid.NewString()
	if _, err := q.ExecContext(ctx, "INSERT INTO assessment_questions (id, provider_key, created_by, created_at, updated_at) VALUES (?, 'sat', ?, CURRENT_TIMESTAMP(6), CURRENT_TIMESTAMP(6))", questionID, actorID); err != nil {
		return err
	}
	if _, err := q.ExecContext(ctx, `INSERT INTO assessment_question_revisions
		(id, question_id, semantic_revision, revision, state, question_type, stimulus, prompt, answer_definition, rationale, metadata, accessibility, created_by, created_at, updated_at)
		VALUES (?, ?, 1, 0, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(6), CURRENT_TIMESTAMP(6))`,
		revisionID, questionID, draft.QuestionType, nonEmptyJSON(draft.Stimulus), nonEmptyJSON(draft.Prompt), nonEmptyJSON(draft.Answer), nonEmptyJSON(draft.Rationale), nonEmptyJSON(draft.Metadata), nonEmptyJSON(draft.Accessibility), actorID); err != nil {
		return err
	}
	_, err := q.ExecContext(ctx, "INSERT INTO assessment_exam_questions (id, module_id, question_id, question_revision_id, display_order, is_pretest, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(6), CURRENT_TIMESTAMP(6))", examQuestionID, moduleID, questionID, revisionID, displayOrder, draft.IsPretest)
	return err
}

type stagedSATAssets struct {
	byKey map[string]string
	ids   []string
}

func verifySATWorkbookAssetsTx(ctx context.Context, q tx.Tx, importID string, manifest []SatWorkbookAsset, requested []SatWorkbookStagedAsset) (stagedSATAssets, error) {
	if len(manifest) != len(requested) {
		return stagedSATAssets{}, validationError("Every embedded workbook image must finish staging before import.")
	}
	result := stagedSATAssets{byKey: make(map[string]string, len(requested)), ids: make([]string, 0, len(requested))}
	for _, asset := range requested {
		if strings.TrimSpace(asset.Key) == "" || strings.TrimSpace(asset.AssetID) == "" {
			return stagedSATAssets{}, validationError("Workbook staged assets require both a key and asset id.")
		}
		if _, exists := result.byKey[asset.Key]; exists {
			return stagedSATAssets{}, validationError("The workbook contains a duplicate staged asset key.")
		}
		result.byKey[asset.Key] = asset.AssetID
		result.ids = append(result.ids, asset.AssetID)
	}
	if len(manifest) == 0 {
		return result, nil
	}
	args := []any{importID}
	for _, assetID := range result.ids {
		args = append(args, assetID)
	}
	rows, err := q.QueryContext(ctx, "SELECT id, content_type, file_name, size_bytes, checksum_sha256 FROM media_assets WHERE owner_kind = 'assessment_import' AND owner_id = ? AND upload_status = 'finalized' AND id IN ("+sqlPlaceholders(len(result.ids))+") FOR UPDATE", args...)
	if err != nil {
		return stagedSATAssets{}, err
	}
	type storedAsset struct {
		id, contentType, fileName string
		size                      sql.NullInt64
		checksum                  sql.NullString
	}
	byID := map[string]storedAsset{}
	for rows.Next() {
		var asset storedAsset
		if err := rows.Scan(&asset.id, &asset.contentType, &asset.fileName, &asset.size, &asset.checksum); err != nil {
			rows.Close()
			return stagedSATAssets{}, err
		}
		byID[asset.id] = asset
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return stagedSATAssets{}, err
	}
	rows.Close()
	if len(byID) != len(manifest) {
		return stagedSATAssets{}, conflictError("A staged workbook image is missing or no longer finalized.")
	}
	for _, asset := range manifest {
		assetID, ok := result.byKey[asset.Key]
		if !ok {
			return stagedSATAssets{}, validationError(fmt.Sprintf("Workbook image %q was not staged.", asset.Key))
		}
		stored, ok := byID[assetID]
		if !ok || !stored.size.Valid || !stored.checksum.Valid || stored.contentType != asset.ContentType || stored.fileName != asset.FileName || stored.size.Int64 != int64(asset.SizeBytes) || !strings.EqualFold(stored.checksum.String, asset.ChecksumSHA256) {
			return stagedSATAssets{}, conflictError(fmt.Sprintf("Workbook image %q does not match the checked workbook.", asset.Key))
		}
	}
	return result, nil
}

func materializeSATWorkbookAssets(question *QuestionDraft, byKey map[string]string) error {
	for _, content := range []*json.RawMessage{&question.Stimulus, &question.Prompt, &question.Rationale} {
		if err := materializeSATWorkbookContent(content, byKey); err != nil {
			return err
		}
	}
	var answer map[string]any
	if err := json.Unmarshal(nonEmptyJSON(question.Answer), &answer); err == nil && answer != nil {
		if options, ok := answer["options"].([]any); ok {
			for index := range options {
				option, ok := options[index].(map[string]any)
				if !ok {
					continue
				}
				content, ok := option["content"]
				if !ok {
					continue
				}
				rawBytes, err := json.Marshal(content)
				if err != nil {
					return err
				}
				raw := json.RawMessage(rawBytes)
				if err := materializeSATWorkbookContent(&raw, byKey); err != nil {
					return err
				}
				var updated any
				if err := json.Unmarshal(raw, &updated); err != nil {
					return err
				}
				option["content"] = updated
			}
			value, err := json.Marshal(answer)
			if err != nil {
				return err
			}
			question.Answer = value
		}
	}
	return nil
}

func materializeSATWorkbookContent(raw *json.RawMessage, byKey map[string]string) error {
	var value any
	if err := json.Unmarshal(nonEmptyJSON(*raw), &value); err != nil {
		return validationError("Workbook content is not valid structured content.")
	}
	if err := materializeSATWorkbookJSON(value, byKey); err != nil {
		return err
	}
	result, err := json.Marshal(value)
	if err != nil {
		return err
	}
	*raw = result
	return nil
}

func materializeSATWorkbookJSON(value any, byKey map[string]string) error {
	switch typed := value.(type) {
	case []any:
		for _, child := range typed {
			if err := materializeSATWorkbookJSON(child, byKey); err != nil {
				return err
			}
		}
	case map[string]any:
		if typed["type"] == "image" {
			attrs, ok := typed["attrs"].(map[string]any)
			if !ok {
				return validationError("Workbook image attributes are missing.")
			}
			key, _ := attrs["workbookKey"].(string)
			if key == "" {
				assetID, _ := attrs["assetId"].(string)
				key = strings.TrimPrefix(assetID, "workbook:")
			}
			if key == "" {
				return validationError("Workbook imports may only use images defined on the Assets sheet.")
			}
			assetID, ok := byKey[key]
			if !ok {
				return validationError(fmt.Sprintf("Workbook image %q was not staged.", key))
			}
			attrs["assetId"] = assetID
			delete(attrs, "workbookKey")
			delete(attrs, "src")
		}
		for _, child := range typed {
			if err := materializeSATWorkbookJSON(child, byKey); err != nil {
				return err
			}
		}
	}
	return nil
}

func sqlPlaceholders(count int) string {
	if count <= 0 {
		return "NULL"
	}
	return strings.TrimSuffix(strings.Repeat("?,", count), ",")
}

func stringsToAny(values []string) []any {
	args := make([]any, len(values))
	for index, value := range values {
		args[index] = value
	}
	return args
}

func loadSATQuestionIDs(ctx context.Context, q tx.Tx, versionID string) ([]string, error) {
	rows, err := q.QueryContext(ctx, "SELECT DISTINCT eq.question_id FROM assessment_exam_questions eq JOIN assessment_modules m ON m.id = eq.module_id JOIN assessment_sections s ON s.id = m.section_id WHERE s.exam_version_id = ?", versionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ids := make([]string, 0)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// cloneSATDraftVersionTx creates an immutable, non-draft copy of the current
// draft. Section/module ids are remapped; question records are shared but get
// checkpoint revisions, so restoring the checkpoint is independent of the
// replacement rows written afterward.
func cloneSATDraftVersionTx(ctx context.Context, q tx.Tx, examID, sourceVersionID, actorID string) (string, error) {
	var contentSnapshot, configSnapshot string
	if err := q.QueryRowContext(ctx, "SELECT CAST(content_snapshot AS CHAR), CAST(config_snapshot AS CHAR) FROM exam_versions WHERE id = ? AND exam_id = ? AND is_draft = TRUE FOR UPDATE", sourceVersionID, examID).Scan(&contentSnapshot, &configSnapshot); err != nil {
		if err == sql.ErrNoRows {
			return "", notFoundError("Draft version not found.")
		}
		return "", err
	}
	var nextVersion int
	if err := q.QueryRowContext(ctx, "SELECT COALESCE(MAX(version_number), 0) + 1 FROM exam_versions WHERE exam_id = ?", examID).Scan(&nextVersion); err != nil {
		return "", err
	}
	checkpointID := uuid.NewString()
	if _, err := q.ExecContext(ctx, `INSERT INTO exam_versions
		(id, exam_id, version_number, parent_version_id, content_snapshot, config_snapshot, validation_snapshot, created_by, is_draft, is_published, revision)
		VALUES (?, ?, ?, ?, ?, ?, NULL, ?, FALSE, FALSE, 0)`, checkpointID, examID, nextVersion, sourceVersionID, contentSnapshot, configSnapshot, actorID); err != nil {
		return "", err
	}

	sections, err := loadCheckpointSections(ctx, q, sourceVersionID)
	if err != nil {
		return "", err
	}
	if len(sections) == 0 {
		return "", validationError("The SAT draft has no assessment sections to checkpoint.")
	}
	sectionIDs := make(map[string]string, len(sections))
	for _, section := range sections {
		newID := uuid.NewString()
		sectionIDs[section.id] = newID
		if _, err := q.ExecContext(ctx, `INSERT INTO assessment_sections
			(id, exam_version_id, section_key, title, display_order, duration_seconds, break_after_seconds, instructions, tool_policy, revision)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`, newID, checkpointID, section.key, section.title, section.order, section.duration, section.breakAfter, section.instructions, section.toolPolicy); err != nil {
			return "", err
		}
	}

	modules, err := loadCheckpointModules(ctx, q, sourceVersionID)
	if err != nil {
		return "", err
	}
	moduleIDs := make(map[string]string, len(modules))
	for _, module := range modules {
		newSectionID, ok := sectionIDs[module.sectionID]
		if !ok {
			return "", validationError("A SAT module references an unknown section.")
		}
		newID := uuid.NewString()
		moduleIDs[module.id] = newID
		if _, err := q.ExecContext(ctx, `INSERT INTO assessment_modules
			(id, section_id, module_key, title, display_order, duration_seconds, target_question_count, adaptive_role, instructions, tool_policy, revision)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`, newID, newSectionID, module.key, module.title, module.order, module.duration, module.targetCount, module.role, module.instructions, module.toolPolicy); err != nil {
			return "", err
		}
	}

	if err := cloneCheckpointRouting(ctx, q, sourceVersionID, sectionIDs, moduleIDs); err != nil {
		return "", err
	}
	if err := cloneCheckpointScoring(ctx, q, sourceVersionID, checkpointID); err != nil {
		return "", err
	}
	if err := cloneCheckpointQuestions(ctx, q, sourceVersionID, actorID, moduleIDs); err != nil {
		return "", err
	}
	return checkpointID, nil
}

type checkpointSectionRow struct {
	id, key, title, instructions, toolPolicy string
	order, duration, breakAfter              int
}

func loadCheckpointSections(ctx context.Context, q tx.Tx, versionID string) ([]checkpointSectionRow, error) {
	rows, err := q.QueryContext(ctx, "SELECT id, section_key, title, display_order, duration_seconds, break_after_seconds, CAST(instructions AS CHAR), CAST(tool_policy AS CHAR) FROM assessment_sections WHERE exam_version_id = ? ORDER BY display_order, id", versionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []checkpointSectionRow{}
	for rows.Next() {
		var row checkpointSectionRow
		if err := rows.Scan(&row.id, &row.key, &row.title, &row.order, &row.duration, &row.breakAfter, &row.instructions, &row.toolPolicy); err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

type checkpointModuleRow struct {
	id, sectionID, key, title, role, instructions, toolPolicy string
	order, duration, targetCount                              int
}

func loadCheckpointModules(ctx context.Context, q tx.Tx, versionID string) ([]checkpointModuleRow, error) {
	rows, err := q.QueryContext(ctx, "SELECT m.id, m.section_id, m.module_key, m.title, m.display_order, m.duration_seconds, m.target_question_count, m.adaptive_role, CAST(m.instructions AS CHAR), CAST(m.tool_policy AS CHAR) FROM assessment_modules m JOIN assessment_sections s ON s.id = m.section_id WHERE s.exam_version_id = ? ORDER BY s.display_order, m.display_order, m.id", versionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []checkpointModuleRow{}
	for rows.Next() {
		var row checkpointModuleRow
		if err := rows.Scan(&row.id, &row.sectionID, &row.key, &row.title, &row.order, &row.duration, &row.targetCount, &row.role, &row.instructions, &row.toolPolicy); err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

func cloneCheckpointRouting(ctx context.Context, q tx.Tx, versionID string, sectionIDs, moduleIDs map[string]string) error {
	rows, err := q.QueryContext(ctx, "SELECT rp.section_id, rp.base_module_id, rp.lower_module_id, rp.higher_module_id, rp.policy_key, CAST(rp.policy_config AS CHAR) FROM assessment_routing_policies rp JOIN assessment_sections s ON s.id = rp.section_id WHERE s.exam_version_id = ?", versionID)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var sectionID, baseID, lowerID, higherID, policyKey, policyConfig string
		if err := rows.Scan(&sectionID, &baseID, &lowerID, &higherID, &policyKey, &policyConfig); err != nil {
			return err
		}
		newSection, ok1 := sectionIDs[sectionID]
		newBase, ok2 := moduleIDs[baseID]
		newLower, ok3 := moduleIDs[lowerID]
		newHigher, ok4 := moduleIDs[higherID]
		if !ok1 || !ok2 || !ok3 || !ok4 {
			return validationError("A SAT routing policy references an unknown module or section.")
		}
		if _, err := q.ExecContext(ctx, "INSERT INTO assessment_routing_policies (id, section_id, base_module_id, lower_module_id, higher_module_id, policy_key, policy_config, revision) VALUES (?, ?, ?, ?, ?, ?, ?, 0)", uuid.NewString(), newSection, newBase, newLower, newHigher, policyKey, policyConfig); err != nil {
			return err
		}
	}
	return rows.Err()
}

func cloneCheckpointScoring(ctx context.Context, q tx.Tx, versionID, checkpointID string) error {
	var policyKey, policyConfig string
	if err := q.QueryRowContext(ctx, "SELECT policy_key, CAST(policy_config AS CHAR) FROM assessment_scoring_policies WHERE exam_version_id = ?", versionID).Scan(&policyKey, &policyConfig); err != nil {
		if err == sql.ErrNoRows {
			return nil
		}
		return err
	}
	_, err := q.ExecContext(ctx, "INSERT INTO assessment_scoring_policies (id, exam_version_id, policy_key, policy_config, revision) VALUES (?, ?, ?, ?, 0)", uuid.NewString(), checkpointID, policyKey, policyConfig)
	return err
}

func cloneCheckpointQuestions(ctx context.Context, q tx.Tx, versionID, actorID string, moduleIDs map[string]string) error {
	rows, err := q.QueryContext(ctx, `SELECT m.id, qr.id, eq.question_id,
		COALESCE((SELECT MAX(r2.semantic_revision) FROM assessment_question_revisions r2 WHERE r2.question_id = eq.question_id), 0),
		qr.question_type, CAST(qr.stimulus AS CHAR), CAST(qr.prompt AS CHAR),
		CAST(qr.answer_definition AS CHAR), CAST(qr.rationale AS CHAR),
		CAST(qr.metadata AS CHAR), CAST(qr.accessibility AS CHAR),
		eq.display_order, eq.is_pretest
		FROM assessment_exam_questions eq
		JOIN assessment_modules m ON m.id = eq.module_id
		JOIN assessment_sections s ON s.id = m.section_id
		JOIN assessment_question_revisions qr ON qr.id = eq.question_revision_id
		WHERE s.exam_version_id = ?
		ORDER BY s.display_order, m.display_order, eq.display_order, eq.id`, versionID)
	if err != nil {
		return err
	}
	defer rows.Close()
	type sourceQuestion struct {
		moduleID, revisionID, questionID, questionType string
		maxSemantic                                    int
		stimulus, prompt, answer, rationale            string
		metadata, accessibility                        string
		displayOrder                                   int
		isPretest                                      bool
	}
	sources := []sourceQuestion{}
	for rows.Next() {
		var source sourceQuestion
		if err := rows.Scan(&source.moduleID, &source.revisionID, &source.questionID, &source.maxSemantic, &source.questionType, &source.stimulus, &source.prompt, &source.answer, &source.rationale, &source.metadata, &source.accessibility, &source.displayOrder, &source.isPretest); err != nil {
			return err
		}
		sources = append(sources, source)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	newRevisionBySource := map[string]string{}
	nextSemantic := map[string]int{}
	for _, source := range sources {
		newRevisionID := newRevisionBySource[source.revisionID]
		if newRevisionID == "" {
			semantic := source.maxSemantic + 1
			if next, ok := nextSemantic[source.questionID]; ok {
				semantic = next
			}
			nextSemantic[source.questionID] = semantic + 1
			newRevisionID = uuid.NewString()
			newRevisionBySource[source.revisionID] = newRevisionID
			if _, err := q.ExecContext(ctx, `INSERT INTO assessment_question_revisions
				(id, question_id, semantic_revision, revision, state, question_type, stimulus, prompt, answer_definition, rationale, metadata, accessibility, created_by)
				VALUES (?, ?, ?, 0, 'draft', ?, ?, ?, ?, ?, ?, ?, ?)`, newRevisionID, source.questionID, semantic, source.questionType, source.stimulus, source.prompt, source.answer, source.rationale, source.metadata, source.accessibility, actorID); err != nil {
				return err
			}
		}
		newModuleID, ok := moduleIDs[source.moduleID]
		if !ok {
			return validationError("A SAT question references an unknown module.")
		}
		if _, err := q.ExecContext(ctx, "INSERT INTO assessment_exam_questions (id, module_id, question_id, question_revision_id, display_order, is_pretest) VALUES (?, ?, ?, ?, ?, ?)", uuid.NewString(), newModuleID, source.questionID, newRevisionID, source.displayOrder, source.isPretest); err != nil {
			return err
		}
	}
	return nil
}
