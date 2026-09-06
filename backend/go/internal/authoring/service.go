// Package authoring owns SAT/IELTS assessment authoring reads and writes.
//
// It mirrors backend/crates/application/src/assessment_authoring.rs: shell,
// preview, open_shell (clone-published-to-draft), sample-template fill,
// workbook import preview/commit/undo, question CRUD +
// batch/bulk/order/duplicate, revision save, delivery-settings update, and
// exam validation. All state flows through explicit SQL with row locks; the
// service holds no package-level state.
//
// SAT adaptive role checks: adaptive_role is one of none|base|lower_branch|
// higher_branch (migration 0032 CHECK). Every section needs exactly one base
// module plus lower_branch + higher_branch modules, and the routing policy
// (base/lower/higher module ids + minimum_correct_for_higher within
// 1..operational) must match those roles. IELTS providers skip adaptive
// checks; only SAT drafts enforce the blueprint gate in ValidateExam.
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

// Adaptive roles (migration 0032 CHECK vocabulary).
const (
	RoleNone         = "none"
	RoleBase         = "base"
	RoleLowerBranch  = "lower_branch"
	RoleHigherBranch = "higher_branch"
)

// SAT blueprint section keys (see exam_provider/sat.rs).
const (
	SectionReadingWriting = "reading-writing"
	SectionMath           = "math"
)

// Workbook import states (migration 0040).
const (
	ImportPreviewed = "previewed"
	ImportCommitted = "committed"
	ImportUndone    = "undone"
	ImportExpired   = "expired"
)

// Service wires authoring transitions explicitly.
type Service struct {
	db     *sql.DB
	runner *tx.Runner
}

// NewService wires dependencies explicitly.
func NewService(db *sql.DB, runner *tx.Runner) *Service {
	return &Service{db: db, runner: runner}
}

// Shell is the editable-draft projection (exam + sections + modules +
// questions). Wire shape mirrors AssessmentAuthoringShell (camelCase).
type Shell struct {
	ExamID          string    `json:"examId"`
	ProviderKey     string    `json:"providerKey"`
	VersionID       string    `json:"versionId"`
	VersionRevision int       `json:"versionRevision"`
	Sections        []Section `json:"sections"`
}

// Section is one draft section with modules + optional routing policy.
type Section struct {
	ID              string         `json:"id"`
	SectionKey      string         `json:"sectionKey"`
	Title           string         `json:"title"`
	DisplayOrder    int            `json:"displayOrder"`
	DurationSeconds int            `json:"durationSeconds"`
	BreakAfterSecs  int            `json:"breakAfterSeconds"`
	Revision        int            `json:"revision"`
	RoutingPolicy   *RoutingPolicy `json:"routingPolicy,omitempty"`
	Modules         []Module       `json:"modules"`
}

// RoutingPolicy mirrors the adaptive routing row.
type RoutingPolicy struct {
	ID                      string `json:"id"`
	BaseModuleID            string `json:"baseModuleId"`
	LowerModuleID           string `json:"lowerModuleId"`
	HigherModuleID          string `json:"higherModuleId"`
	PolicyKey               string `json:"policyKey"`
	MinimumCorrectForHigher int    `json:"minimumCorrectForHigher"`
	OperationalCount        int    `json:"operationalQuestionCount"`
	Revision                int    `json:"revision"`
}

// Module is one draft module with question summaries.
type Module struct {
	ID                  string            `json:"id"`
	ModuleKey           string            `json:"moduleKey"`
	Title               string            `json:"title"`
	DisplayOrder        int               `json:"displayOrder"`
	DurationSeconds     int               `json:"durationSeconds"`
	TargetQuestionCount int               `json:"targetQuestionCount"`
	AdaptiveRole        string            `json:"adaptiveRole"`
	ToolPolicy          json.RawMessage   `json:"toolPolicy"`
	Revision            int               `json:"revision"`
	Questions           []QuestionSummary `json:"questions"`
}

// QuestionSummary mirrors AssessmentQuestionSummary (trimmed).
type QuestionSummary struct {
	ExamQuestionID    string                   `json:"examQuestionId"`
	QuestionID        string                   `json:"questionId"`
	QuestionRevision  string                   `json:"questionRevisionId"`
	DisplayOrder      int                      `json:"displayOrder"`
	IsPretest         bool                     `json:"isPretest"`
	QuestionType      string                   `json:"questionType"`
	SemanticRevision  int                      `json:"semanticRevision"`
	Revision          int                      `json:"revision"`
	PromptPreview     string                   `json:"promptPreview"`
	AnswerKeyPreview  *string                  `json:"answerKeyPreview"`
	Domain            *string                  `json:"domain"`
	Skill             *string                  `json:"skill"`
	Difficulty        string                   `json:"difficulty"`
	Tags              []string                 `json:"tags"`
	HasStimulus       bool                     `json:"hasStimulus"`
	ContentComplexity string                   `json:"contentComplexity"`
	Readiness         QuestionReadinessSummary `json:"readiness"`
}

// QuestionReadinessSummary is the provider validation projection used by the
// authoring question list and readiness filters.
type QuestionReadinessSummary struct {
	Status             string `json:"status"`
	BlockingIssueCount int    `json:"blockingIssueCount"`
	WarningCount       int    `json:"warningCount"`
}

// QuestionDetail mirrors AssessmentQuestionDetail (trimmed JSON payloads).
type QuestionDetail struct {
	ExamQuestionID string          `json:"examQuestionId"`
	ModuleID       string          `json:"moduleId"`
	ModuleKey      string          `json:"moduleKey"`
	SectionKey     string          `json:"sectionKey"`
	DisplayOrder   int             `json:"displayOrder"`
	IsPretest      bool            `json:"isPretest"`
	QuestionType   string          `json:"questionType"`
	Stimulus       json.RawMessage `json:"stimulus"`
	Prompt         json.RawMessage `json:"prompt"`
	Answer         json.RawMessage `json:"answerDefinition"`
	Rationale      json.RawMessage `json:"rationale"`
	Metadata       json.RawMessage `json:"metadata"`
}

// ValidationIssue is one blocking/warning finding.
type ValidationIssue struct {
	Code     string `json:"code"`
	Path     string `json:"path"`
	Message  string `json:"message"`
	Blocking bool   `json:"blocking"`
}

// ValidationReport mirrors AssessmentValidationReport.
type ValidationReport struct {
	ExamID          string            `json:"examId"`
	VersionID       string            `json:"versionId"`
	VersionRevision int               `json:"versionRevision"`
	Valid           bool              `json:"valid"`
	Errors          []ValidationIssue `json:"errors"`
	Warnings        []ValidationIssue `json:"warnings"`
}

// ImportPreview is the staged workbook-import projection.
type ImportPreview struct {
	ImportID          string          `json:"importId"`
	ExamID            string          `json:"examId"`
	ExpectedVersionID string          `json:"expectedVersionId"`
	State             string          `json:"state"`
	AssetManifest     json.RawMessage `json:"assetManifest"`
	Available         bool            `json:"available"`
}

// UndoState mirrors SatWorkbookUndoState.
type UndoState struct {
	ImportID  string `json:"importId"`
	Available bool   `json:"available"`
}

// CommitResult mirrors SatWorkbookCommitResult.
type CommitResult struct {
	Shell Shell     `json:"shell"`
	Undo  UndoState `json:"undo"`
}

// QuestionDraft carries new-question content payloads. It is also the wire
// shape used by complete SAT replacements, so keep the JSON names aligned
// with the frontend assessment contracts.
type QuestionDraft struct {
	QuestionType  string          `json:"questionType"`
	Stimulus      json.RawMessage `json:"stimulus"`
	Prompt        json.RawMessage `json:"prompt"`
	Answer        json.RawMessage `json:"answer"`
	Rationale     json.RawMessage `json:"rationale"`
	Metadata      json.RawMessage `json:"metadata"`
	Accessibility json.RawMessage `json:"accessibility"`
	IsPretest     bool            `json:"isPretest"`
}

// SampleExamModuleDraft identifies the destination module for a complete
// sample or workbook replacement.
type SampleExamModuleDraft struct {
	ModuleID  string          `json:"moduleId"`
	Questions []QuestionDraft `json:"questions"`
}

// LoadSampleExamRequest is the atomic complete-draft replacement contract.
type LoadSampleExamRequest struct {
	ExpectedVersionID       string                  `json:"expectedVersionId"`
	ExpectedVersionRevision int                     `json:"expectedVersionRevision"`
	Modules                 []SampleExamModuleDraft `json:"modules"`
}

// ModuleTiming carries one delivery-settings module update.
type ModuleTiming struct {
	ModuleID         string
	DurationSeconds  int
	ExpectedRevision int
}

// DeliverySettingsRequest mirrors UpdateSectionDeliverySettingsRequest.
type DeliverySettingsRequest struct {
	ExpectedSectionRevision int
	BreakAfterSeconds       int
	ModuleTimings           []ModuleTiming
	MinimumCorrectForHigher int
	ExpectedRoutingRevision int
}

// BulkAction is move|duplicate|set_pretest|patch_metadata|delete.
type BulkAction struct {
	Type                string
	DestinationModuleID string
	PretestValue        bool
	Patch               map[string]any
}

func validationError(msg string) *apperrors.Error {
	return apperrors.New(apperrors.CodeValidation, msg)
}

func notFoundError(msg string) *apperrors.Error {
	return apperrors.New(apperrors.CodeNotFound, msg)
}

func conflictError(msg string) *apperrors.Error {
	return apperrors.New(apperrors.CodeConflict, msg)
}

// Shell loads the current-draft authoring projection (mirrors shell()).
func (s *Service) Shell(ctx context.Context, examID string) (Shell, error) {
	var providerKey string
	var draftID sql.NullString
	if err := s.db.QueryRowContext(ctx, "SELECT provider_key, current_draft_version_id FROM exam_entities WHERE id = ?", examID).Scan(&providerKey, &draftID); err != nil {
		if err == sql.ErrNoRows {
			return Shell{}, notFoundError("Exam not found.")
		}
		return Shell{}, err
	}
	if !draftID.Valid || strings.TrimSpace(draftID.String) == "" {
		return Shell{}, notFoundError("Draft version not found.")
	}
	var rev int
	if err := s.db.QueryRowContext(ctx, "SELECT revision FROM exam_versions WHERE id = ? AND exam_id = ? AND is_draft = TRUE", draftID.String, examID).Scan(&rev); err != nil {
		if err == sql.ErrNoRows {
			return Shell{}, notFoundError("Draft version not found.")
		}
		return Shell{}, err
	}
	sections, err := s.loadSections(ctx, s.db, draftID.String)
	if err != nil {
		return Shell{}, err
	}
	return Shell{ExamID: examID, ProviderKey: providerKey, VersionID: draftID.String, VersionRevision: rev, Sections: sections}, nil
}

// OpenShell opens the editable-draft authoring shell (mirrors open_shell:
// exam FOR UPDATE, sat-only gate, existing-draft shortcut returns Shell,
// otherwise clone_published_sat_to_draft_tx + conditional pointer CAS +
// version_created event, commit then Shell).
func (s *Service) OpenShell(ctx context.Context, examID, actorID string) (Shell, error) {
	err := s.runner.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		// SELECT ... FOR UPDATE on exam_entities locks the authoring owner first.
		var providerKey string
		var draftID, publishedID sql.NullString
		if err := q.QueryRowContext(ctx, "SELECT provider_key, current_draft_version_id, current_published_version_id FROM exam_entities WHERE id = ? FOR UPDATE", examID).Scan(&providerKey, &draftID, &publishedID); err != nil {
			if err == sql.ErrNoRows {
				return notFoundError("Exam not found.")
			}
			return err
		}
		if providerKey != "sat" {
			return validationError("Assessment provider is not supported.")
		}
		if draftID.Valid && strings.TrimSpace(draftID.String) != "" {
			return nil
		}
		if !publishedID.Valid || strings.TrimSpace(publishedID.String) == "" {
			return validationError("The SAT exam has neither an editable draft nor a published version to continue.")
		}
		draftVersionID, err := s.clonePublishedSATToDraftTx(ctx, q, examID, strings.TrimSpace(publishedID.String), actorID)
		if err != nil {
			return err
		}
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
		return nil
	})
	if err != nil {
		return Shell{}, err
	}
	return s.Shell(ctx, examID)
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

// Preview returns the delivery projection for SAT drafts (mirrors preview();
// non-SAT providers are rejected as unsupported).
func (s *Service) Preview(ctx context.Context, examID string) (Shell, error) {
	var providerKey string
	if err := s.db.QueryRowContext(ctx, "SELECT provider_key FROM exam_entities WHERE id = ?", examID).Scan(&providerKey); err != nil {
		if err == sql.ErrNoRows {
			return Shell{}, notFoundError("Exam not found.")
		}
		return Shell{}, err
	}
	if providerKey != "sat" {
		return Shell{}, validationError("Assessment provider is not supported.")
	}
	return s.Shell(ctx, examID)
}

// CreateQuestion appends one question to a module under draft locks (mirrors
// create_question: locks current draft for module, appends display_order).
func (s *Service) CreateQuestion(ctx context.Context, moduleID, actorID string, draft QuestionDraft) (QuestionDetail, error) {
	if strings.TrimSpace(draft.QuestionType) == "" {
		return QuestionDetail{}, validationError("Question type is required.")
	}
	var out QuestionDetail
	err := s.runner.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		// SELECT ... FOR UPDATE on the module serializes appends.
		var sectionKey, moduleKey string
		if err := q.QueryRowContext(ctx, "SELECT s.section_key, m.module_key FROM assessment_modules m JOIN assessment_sections s ON s.id = m.section_id WHERE m.id = ? FOR UPDATE", moduleID).Scan(&sectionKey, &moduleKey); err != nil {
			if err == sql.ErrNoRows {
				return notFoundError("Module not found.")
			}
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
		out = QuestionDetail{ExamQuestionID: examQuestionID, ModuleID: moduleID, ModuleKey: moduleKey, SectionKey: sectionKey, DisplayOrder: order, IsPretest: draft.IsPretest, QuestionType: draft.QuestionType, Stimulus: nonEmptyJSON(draft.Stimulus), Prompt: nonEmptyJSON(draft.Prompt), Answer: nonEmptyJSON(draft.Answer), Rationale: nonEmptyJSON(draft.Rationale), Metadata: nonEmptyJSON(draft.Metadata)}
		return nil
	})
	return out, err
}

// BatchCreateQuestions inserts many questions into one module (mirrors
// batch_create_questions). The whole batch runs in a single transaction:
// the module row is locked once and display orders are assigned
// deterministically from the pre-batch MAX(display_order), so concurrent
// batches cannot interleave or duplicate orders.
func (s *Service) BatchCreateQuestions(ctx context.Context, moduleID, actorID string, drafts []QuestionDraft) ([]QuestionSummary, error) {
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
	out := make([]QuestionSummary, 0, len(drafts))
	err := s.runner.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		// SELECT ... FOR UPDATE on the module serializes concurrent batches.
		var sectionKey, moduleKey string
		if err := q.QueryRowContext(ctx, "SELECT s.section_key, m.module_key FROM assessment_modules m JOIN assessment_sections s ON s.id = m.section_id WHERE m.id = ? FOR UPDATE", moduleID).Scan(&sectionKey, &moduleKey); err != nil {
			if err == sql.ErrNoRows {
				return notFoundError("Module not found.")
			}
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
			out = append(out, QuestionSummary{ExamQuestionID: examQuestionID, QuestionID: questionID, QuestionRevision: revisionID, DisplayOrder: order, IsPretest: d.IsPretest, QuestionType: d.QuestionType})
			order++
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

const questionDetailQuery = "SELECT eq.id, eq.module_id, m.module_key, s.section_key, eq.display_order, eq.is_pretest, r.question_type, CAST(r.stimulus AS CHAR), CAST(r.prompt AS CHAR), CAST(r.answer_definition AS CHAR), CAST(r.rationale AS CHAR), CAST(r.metadata AS CHAR) FROM assessment_exam_questions eq JOIN assessment_modules m ON m.id = eq.module_id JOIN assessment_sections s ON s.id = m.section_id JOIN assessment_question_revisions r ON r.id = eq.question_revision_id WHERE eq.id = ?"

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
	err := row.Scan(&d.ExamQuestionID, &d.ModuleID, &d.ModuleKey, &d.SectionKey, &d.DisplayOrder, &isPretest, &d.QuestionType, rawScanner(&d.Stimulus), rawScanner(&d.Prompt), rawScanner(&d.Answer), rawScanner(&d.Rationale), rawScanner(&d.Metadata))
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
	err := s.runner.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
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
		newRevisionID := uuid.NewString()
		if _, err := q.ExecContext(ctx, "INSERT INTO assessment_question_revisions (id, question_id, semantic_revision, state, question_type, stimulus, prompt, answer_definition, rationale, metadata, accessibility, revision, created_by, created_at, updated_at) VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, 0, ?, NOW(6), NOW(6))", newRevisionID, questionID, semanticRev+1, orDefault(draft.QuestionType, "multiple_choice"), nonEmptyJSON(draft.Stimulus), nonEmptyJSON(draft.Prompt), nonEmptyJSON(draft.Answer), nonEmptyJSON(draft.Rationale), nonEmptyJSON(draft.Metadata), nonEmptyJSON(draft.Accessibility), actorID); err != nil {
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
		return nil
	})
	return out, err
}

// DeleteQuestion removes one exam question (mirrors delete_question).
func (s *Service) DeleteQuestion(ctx context.Context, examQuestionID string) error {
	return s.runner.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
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
		_ = moduleID
		return nil
	})
}

// ReorderQuestions rewrites display_order under module locks (mirrors
// reorder_questions; expected ids fence stale consoles).
func (s *Service) ReorderQuestions(ctx context.Context, moduleID string, expectedIDs, orderedIDs []string) error {
	if len(orderedIDs) == 0 {
		return validationError("At least one question id is required.")
	}
	return s.runner.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		// SELECT ... FOR UPDATE on the module row serializes reorder vs edits.
		var exists string
		if err := q.QueryRowContext(ctx, "SELECT id FROM assessment_modules WHERE id = ? FOR UPDATE", moduleID).Scan(&exists); err != nil {
			if err == sql.ErrNoRows {
				return notFoundError("Module not found.")
			}
			return err
		}
		rows, err := q.QueryContext(ctx, "SELECT id FROM assessment_exam_questions WHERE module_id = ? ORDER BY display_order ASC FOR UPDATE", moduleID)
		if err != nil {
			return err
		}
		current := []string{}
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				rows.Close()
				return err
			}
			current = append(current, id)
		}
		rows.Close()
		if len(expectedIDs) > 0 && !sameSet(current, expectedIDs) {
			return conflictError("Questions changed while you were editing; refresh before retrying.")
		}
		if !sameSet(current, orderedIDs) {
			return validationError("Reorder list must contain exactly the module questions.")
		}
		for i, id := range orderedIDs {
			if _, err := q.ExecContext(ctx, "UPDATE assessment_exam_questions SET display_order = ?, updated_at = NOW(6) WHERE id = ? AND module_id = ?", i, id, moduleID); err != nil {
				return err
			}
		}
		return nil
	})
}

// DuplicateQuestion copies one exam question into a module (mirrors
// duplicate_question).
func (s *Service) DuplicateQuestion(ctx context.Context, examQuestionID string, destModuleID *string, actorID string) (QuestionDetail, error) {
	var out QuestionDetail
	err := s.runner.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
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
		var nextOrder sql.NullInt64
		if err := q.QueryRowContext(ctx, "SELECT COALESCE(MAX(display_order), -1) + 1 FROM assessment_exam_questions WHERE module_id = ?", dest).Scan(&nextOrder); err != nil {
			return err
		}
		newOrder := 0
		if nextOrder.Valid {
			newOrder = int(nextOrder.Int64)
		}
		newID := uuid.NewString()
		if _, err := q.ExecContext(ctx, "INSERT INTO assessment_exam_questions (id, module_id, question_id, question_revision_id, display_order, is_pretest, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, NOW(6), NOW(6))", newID, dest, questionID, revisionID, newOrder, pretest); err != nil {
			return err
		}
		_ = actorID
		_ = order
		detail, err := scanQuestionDetail(q.QueryRowContext(ctx, questionDetailQuery, newID))
		if err != nil {
			return err
		}
		out = detail
		return nil
	})
	return out, err
}

// BulkQuestions applies one move|duplicate|set_pretest|patch_metadata|delete
// action to many questions under module locks (mirrors bulk_questions).
func (s *Service) BulkQuestions(ctx context.Context, questionIDs []string, action BulkAction, actorID string) (int, error) {
	if len(questionIDs) == 0 {
		return 0, validationError("At least one question id is required.")
	}
	switch action.Type {
	case "move", "duplicate", "set_pretest", "patch_metadata", "delete":
	default:
		return 0, validationError(fmt.Sprintf("Unknown bulk action %q.", action.Type))
	}
	affected := 0
	err := s.runner.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
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
				if _, err := q.ExecContext(ctx, "INSERT INTO assessment_exam_questions (id, module_id, question_id, question_revision_id, display_order, is_pretest, created_at, updated_at) VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(display_order), -1) + 1 FROM (SELECT display_order FROM assessment_exam_questions WHERE module_id = ?) AS m), ?, NOW(6), NOW(6))", uuid.NewString(), dest, questionID, revisionID, dest, pretest); err != nil {
					return err
				}
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
				res, err := q.ExecContext(ctx, "UPDATE assessment_question_revisions SET metadata = ?, updated_at = NOW(6) WHERE id = ?", string(patched), revisionID)
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
			_ = actorID
			affected++
		}
		return nil
	})
	return affected, err
}

// SaveRevision creates a new sealed revision pointer for a question (mirrors
// save_question_revision; draft->sealed flip under locks).
func (s *Service) SaveRevision(ctx context.Context, examQuestionID, actorID string) (QuestionDetail, error) {
	var out QuestionDetail
	err := s.runner.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		// SELECT ... FOR UPDATE on the revision row serializes seal vs edit.
		var revisionID string
		if err := q.QueryRowContext(ctx, "SELECT question_revision_id FROM assessment_exam_questions WHERE id = ? FOR UPDATE", examQuestionID).Scan(&revisionID); err != nil {
			if err == sql.ErrNoRows {
				return notFoundError("Question not found.")
			}
			return err
		}
		if _, err := q.ExecContext(ctx, "UPDATE assessment_question_revisions SET state = 'sealed', sealed_at = NOW(6), updated_at = NOW(6) WHERE id = ? AND state = 'draft'", revisionID); err != nil {
			return err
		}
		_ = actorID
		detail, err := scanQuestionDetail(q.QueryRowContext(ctx, questionDetailQuery, examQuestionID))
		if err != nil {
			return err
		}
		out = detail
		return nil
	})
	return out, err
}

// UpdateDeliverySettings rewrites section break + module timings + routing
// threshold under locks (mirrors update_section_delivery_settings with
// revision fencing on section, modules, and routing rows).
func (s *Service) UpdateDeliverySettings(ctx context.Context, examID, sectionID string, req DeliverySettingsRequest) (Shell, error) {
	if req.BreakAfterSeconds < 0 {
		return Shell{}, validationError("Break duration cannot be negative.")
	}
	for _, t := range req.ModuleTimings {
		if t.DurationSeconds <= 0 {
			return Shell{}, validationError("Every SAT module duration must be greater than zero.")
		}
	}
	var shell Shell
	err := s.runner.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		// SELECT ... FOR UPDATE on the draft version serializes settings edits.
		var draftID string
		if err := q.QueryRowContext(ctx, "SELECT v.id FROM assessment_sections s JOIN exam_versions v ON v.id = s.exam_version_id JOIN exam_entities e ON e.id = v.exam_id WHERE s.id = ? AND e.id = ? AND v.is_draft = TRUE AND e.current_draft_version_id = v.id FOR UPDATE", sectionID, examID).Scan(&draftID); err != nil {
			if err == sql.ErrNoRows {
				return notFoundError("Section not found in the current draft.")
			}
			return err
		}
		// SELECT ... FOR UPDATE on the section row fences break/timing edits.
		var sectionRev int
		if err := q.QueryRowContext(ctx, "SELECT revision FROM assessment_sections WHERE id = ? FOR UPDATE", sectionID).Scan(&sectionRev); err != nil {
			return err
		}
		if sectionRev != req.ExpectedSectionRevision {
			return conflictError("Section delivery settings changed while you were editing.")
		}
		// SELECT ... FOR UPDATE on module rows fences per-module timing edits.
		type modRow struct {
			id, role string
			rev      int
		}
		rows, err := q.QueryContext(ctx, "SELECT id, adaptive_role, revision FROM assessment_modules WHERE section_id = ? ORDER BY display_order FOR UPDATE", sectionID)
		if err != nil {
			return err
		}
		mods := []modRow{}
		for rows.Next() {
			var m modRow
			if err := rows.Scan(&m.id, &m.role, &m.rev); err != nil {
				rows.Close()
				return err
			}
			mods = append(mods, m)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}
		if len(mods) != len(req.ModuleTimings) {
			return validationError("Delivery settings must include every module in the section.")
		}
		byID := map[string]modRow{}
		for _, m := range mods {
			byID[m.id] = m
		}
		for _, t := range req.ModuleTimings {
			m, ok := byID[t.ModuleID]
			if !ok {
				return validationError("Delivery settings contain an unknown or missing module.")
			}
			if m.rev != t.ExpectedRevision {
				return conflictError("Module timing changed while you were editing.")
			}
		}
		// SELECT ... FOR UPDATE on the routing row fences threshold edits.
		var routingID, baseID, lowerID, higherID string
		var routingRev int
		if err := q.QueryRowContext(ctx, "SELECT id, base_module_id, lower_module_id, higher_module_id, revision FROM assessment_routing_policies WHERE section_id = ? FOR UPDATE", sectionID).Scan(&routingID, &baseID, &lowerID, &higherID, &routingRev); err != nil {
			if err == sql.ErrNoRows {
				return validationError("Adaptive routing policy is missing.")
			}
			return err
		}
		if routingRev != req.ExpectedRoutingRevision {
			return conflictError("Adaptive routing settings changed while you were editing.")
		}
		hasBase, hasLower, hasHigher := false, false, false
		for _, m := range mods {
			switch m.role {
			case RoleBase:
				hasBase = hasBase || true
				if m.id != baseID {
					return validationError("Adaptive routing policy does not match the section module roles.")
				}
			case RoleLowerBranch:
				hasLower = true
				if m.id != lowerID {
					return validationError("Adaptive routing policy does not match the section module roles.")
				}
			case RoleHigherBranch:
				hasHigher = true
				if m.id != higherID {
					return validationError("Adaptive routing policy does not match the section module roles.")
				}
			}
		}
		if !hasBase || !hasLower || !hasHigher {
			return validationError("Each section needs lower and higher adaptive branches.")
		}
		if req.MinimumCorrectForHigher < 1 {
			return validationError("Higher-route threshold must be between 1 and the operational question count.")
		}
		{
			// Upper bound mirrors the Rust blueprint derivation
			// (target_question_count - pretest_count).max(1) against the live base module.
			var targetCount int
			if err := q.QueryRowContext(ctx, "SELECT target_question_count FROM assessment_modules WHERE id = ?", baseID).Scan(&targetCount); err != nil {
				return err
			}
			var pretestCount int
			if err := q.QueryRowContext(ctx, "SELECT COUNT(*) FROM assessment_exam_questions WHERE module_id = ? AND is_pretest = TRUE", baseID).Scan(&pretestCount); err != nil {
				return err
			}
			operational := targetCount - pretestCount
			if operational < 1 {
				operational = 1
			}
			if req.MinimumCorrectForHigher > operational {
				return validationError("Higher-route threshold must be between 1 and the operational question count.")
			}
		}
		for _, t := range req.ModuleTimings {
			res, err := q.ExecContext(ctx, "UPDATE assessment_modules SET duration_seconds = ?, revision = revision + 1, updated_at = NOW(6) WHERE id = ? AND section_id = ? AND revision = ?", t.DurationSeconds, t.ModuleID, sectionID, t.ExpectedRevision)
			if err != nil {
				return err
			}
			if n, _ := res.RowsAffected(); n != 1 {
				return conflictError("Module timing changed while you were editing.")
			}
		}
		sectionDuration := 0
		for _, t := range req.ModuleTimings {
			sectionDuration += t.DurationSeconds
		}
		res, err := q.ExecContext(ctx, "UPDATE assessment_sections SET duration_seconds = ?, break_after_seconds = ?, revision = revision + 1, updated_at = NOW(6) WHERE id = ? AND revision = ?", sectionDuration, req.BreakAfterSeconds, sectionID, req.ExpectedSectionRevision)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n != 1 {
			return conflictError("Section delivery settings changed while you were editing.")
		}
		if _, err := q.ExecContext(ctx, "UPDATE assessment_routing_policies SET policy_config = ?, revision = revision + 1 WHERE id = ? AND revision = ?", fmt.Sprintf("{\"minimumCorrectForHigher\":%d}", req.MinimumCorrectForHigher), routingID, req.ExpectedRoutingRevision); err != nil {
			return err
		}
		if _, err := q.ExecContext(ctx, "UPDATE exam_versions SET revision = revision + 1 WHERE id = ?", draftID); err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		return Shell{}, err
	}
	shell, err = s.Shell(ctx, examID)
	return shell, err
}

// ValidateExam runs the SAT adaptive gate when the exam provider is sat
// (base + lower/higher branches, routing match, threshold range, non-empty
// base) and a light structural gate otherwise. A mid-check draft revision
// move is a CONFLICT (mirrors validate()).
func (s *Service) ValidateExam(ctx context.Context, examID string) (ValidationReport, error) {
	shell, err := s.Shell(ctx, examID)
	if err != nil {
		return ValidationReport{}, err
	}
	rep := ValidationReport{ExamID: examID, VersionID: shell.VersionID, VersionRevision: shell.VersionRevision, Errors: []ValidationIssue{}, Warnings: []ValidationIssue{}}
	if shell.ProviderKey != "sat" {
		for _, sec := range shell.Sections {
			if len(sec.Modules) == 0 {
				rep.Errors = append(rep.Errors, ValidationIssue{Path: sec.SectionKey, Message: "Section must contain at least one module.", Blocking: true})
			}
		}
		rep.Valid = len(rep.Errors) == 0
		return rep, nil
	}
	return s.validateSATExam(ctx, shell, rep)
}

type sectionQuerier interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func (s *Service) loadSections(ctx context.Context, q sectionQuerier, versionID string) ([]Section, error) {
	rows, err := q.QueryContext(ctx, "SELECT id, section_key, title, display_order, duration_seconds, break_after_seconds, revision FROM assessment_sections WHERE exam_version_id = ? ORDER BY display_order ASC", versionID)
	if err != nil {
		if isMissingTable(err) {
			return []Section{}, nil
		}
		return nil, err
	}
	type secRow struct {
		id, key, title       string
		order, dur, brk, rev int
	}
	secs := []secRow{}
	for rows.Next() {
		var r secRow
		if err := rows.Scan(&r.id, &r.key, &r.title, &r.order, &r.dur, &r.brk, &r.rev); err != nil {
			rows.Close()
			return nil, err
		}
		secs = append(secs, r)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	out := make([]Section, 0, len(secs))
	for _, sr := range secs {
		mods, err := s.loadModules(ctx, q, sr.id)
		if err != nil {
			return nil, err
		}
		rp, err := s.loadRouting(ctx, q, sr.id)
		if err != nil {
			return nil, err
		}
		out = append(out, Section{ID: sr.id, SectionKey: sr.key, Title: sr.title, DisplayOrder: sr.order, DurationSeconds: sr.dur, BreakAfterSecs: sr.brk, Revision: sr.rev, RoutingPolicy: rp, Modules: mods})
	}
	return out, nil
}

func (s *Service) loadModules(ctx context.Context, q sectionQuerier, sectionID string) ([]Module, error) {
	rows, err := q.QueryContext(ctx, "SELECT id, module_key, title, display_order, duration_seconds, target_question_count, adaptive_role, tool_policy, revision FROM assessment_modules WHERE section_id = ? ORDER BY display_order ASC", sectionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Module{}
	for rows.Next() {
		var m Module
		var tool sql.NullString
		if err := rows.Scan(&m.ID, &m.ModuleKey, &m.Title, &m.DisplayOrder, &m.DurationSeconds, &m.TargetQuestionCount, &m.AdaptiveRole, &tool, &m.Revision); err != nil {
			return nil, err
		}
		if tool.Valid && strings.TrimSpace(tool.String) != "" {
			m.ToolPolicy = json.RawMessage(tool.String)
		} else {
			m.ToolPolicy = json.RawMessage("{}")
		}
		qs, err := s.loadSummaries(ctx, q, m.ID)
		if err != nil {
			return nil, err
		}
		m.Questions = qs
		out = append(out, m)
	}
	return out, rows.Err()
}

func (s *Service) loadSummaries(ctx context.Context, q interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}, moduleID string) ([]QuestionSummary, error) {
	rows, err := loadQuestionValidationRows(ctx, q, moduleID)
	if err != nil {
		return nil, err
	}
	out := make([]QuestionSummary, 0, len(rows))
	for _, row := range rows {
		out = append(out, row.summary())
	}
	return out, nil
}

func (s *Service) loadRouting(ctx context.Context, q interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, sectionID string) (*RoutingPolicy, error) {
	var rp RoutingPolicy
	var cfg string
	err := q.QueryRowContext(ctx, "SELECT id, base_module_id, lower_module_id, higher_module_id, policy_key, policy_config, revision FROM assessment_routing_policies WHERE section_id = ?", sectionID).Scan(&rp.ID, &rp.BaseModuleID, &rp.LowerModuleID, &rp.HigherModuleID, &rp.PolicyKey, &cfg, &rp.Revision)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		if isMissingTable(err) {
			return nil, nil
		}
		return nil, err
	}
	var parsed map[string]any
	if err := json.Unmarshal([]byte(cfg), &parsed); err == nil {
		if v, ok := parsed["minimumCorrectForHigher"].(float64); ok {
			rp.MinimumCorrectForHigher = int(v)
		}
		if v, ok := parsed["operationalQuestionCount"].(float64); ok {
			rp.OperationalCount = int(v)
		}
	}
	return &rp, nil
}

func nonEmptyJSON(b json.RawMessage) json.RawMessage {
	if len(b) == 0 || strings.TrimSpace(string(b)) == "" {
		return json.RawMessage("{}")
	}
	return b
}

func orDefault(v, def string) string {
	if strings.TrimSpace(v) == "" {
		return def
	}
	return v
}

func sameSet(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	seen := map[string]int{}
	for _, v := range a {
		seen[v]++
	}
	for _, v := range b {
		seen[v]--
		if seen[v] < 0 {
			return false
		}
	}
	return true
}

func rawScanner(dst *json.RawMessage) sql.Scanner {
	return &rawScan{dst: dst}
}

type rawScan struct {
	dst *json.RawMessage
}

func (r *rawScan) Scan(src any) error {
	switch v := src.(type) {
	case nil:
		*r.dst = json.RawMessage("{}")
	case string:
		if strings.TrimSpace(v) == "" {
			*r.dst = json.RawMessage("{}")
		} else {
			*r.dst = json.RawMessage(v)
		}
	case []byte:
		if len(v) == 0 {
			*r.dst = json.RawMessage("{}")
		} else {
			*r.dst = append(json.RawMessage(nil), v...)
		}
	default:
		*r.dst = json.RawMessage("{}")
	}
	return nil
}

func isMissingTable(err error) bool {
	if err == nil {
		return false
	}
	s := strings.ToLower(err.Error())
	return strings.Contains(s, "doesn't exist") || strings.Contains(s, "table") && strings.Contains(s, "not exist") || strings.Contains(s, "no such table")
}
