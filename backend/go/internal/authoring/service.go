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
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"fmt"
	"slices"
	"strings"

	"github.com/google/uuid"

	"example.com/ielts-proctoring/internal/authoringrealtime"
	"example.com/ielts-proctoring/internal/delivery"
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
	// deliverySvc builds Preview's candidate-facing projection. Nil keeps the
	// historical posture (derived per call from db/runner); production injects
	// the shared graph service so Preview never mints a bare per-request
	// service without the cache.
	deliverySvc *delivery.Service
	// previewCache is the revision-keyed delivery-tree cache Preview serves
	// through (the shared delivery VersionCache; key is (versionID, revision)).
	// Nil disables caching: Preview bulk-loads directly. No globals: tests
	// inject a fresh cache or leave it nil.
	previewCache *delivery.VersionCache
	// liveOrigin is this instance's bus origin id (mirrors delivery.Service).
	// Empty = no bus (tests, or a nil deps.LiveBus): eventsOn() stays false.
	liveOrigin string
	// eventsEnabled is the AUTHORING_REALTIME_EVENTS gate (Phase 02). Off by
	// default: byte-identical legacy behavior with no bus INSERT.
	eventsEnabled bool
	// coeditEnabled is retained as an internal compatibility seam for the
	// prompt co-editing guard. The application enables it by default.
	coeditEnabled bool
}

// NewService wires dependencies explicitly.
func NewService(db *sql.DB, runner *tx.Runner) *Service {
	return &Service{db: db, runner: runner}
}

// SetDeliveryService injects the shared delivery service Preview builds its
// projection with (chainable, nil-safe: nil restores the derived default).
// A setter — not a constructor change — so the existing NewService call sites
// (app graph plus in-package tests) stay untouched.
func (s *Service) SetDeliveryService(d *delivery.Service) *Service {
	if s != nil {
		s.deliverySvc = d
	}
	return s
}

// SetPreviewCache wires the revision-keyed delivery-tree cache Preview serves
// through (chainable, nil-safe: nil disables caching and Preview bulk-loads
// directly, which is also the VERSION_CACHE=off kill-switch posture).
func (s *Service) SetPreviewCache(c *delivery.VersionCache) *Service {
	if s != nil {
		s.previewCache = c
	}
	return s
}

// PreviewCached reports whether Preview serves through the revision-keyed
// cache (assertable without a pool).
func (s *Service) PreviewCached() bool { return s != nil && s.previewCache != nil }

// previewDelivery returns the injected delivery service, deriving one from
// (db, runner) when none was injected (tests, worker, cache-off).
func (s *Service) previewDelivery() *delivery.Service {
	if s != nil && s.deliverySvc != nil {
		return s.deliverySvc
	}
	var db *sql.DB
	var runner *tx.Runner
	if s != nil {
		db, runner = s.db, s.runner
	}
	return delivery.NewService(db, runner)
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
	RoutingPolicy   *RoutingPolicy `json:"routingPolicy"`
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

// QuestionRevisionDetail mirrors the frontend QuestionRevision nested inside
// AssessmentQuestionDetail. The frontend never consumes flat detail fields;
// it reads `detail.question` (revision id, question id, fencing revision,
// state) and binds `revision` to the server fencing counter on every save.
type QuestionRevisionDetail struct {
	ID               string          `json:"id"`
	QuestionID       string          `json:"questionId"`
	SemanticRevision int             `json:"semanticRevision"`
	Revision         int             `json:"revision"`
	State            string          `json:"state"`
	QuestionType     string          `json:"questionType"`
	Stimulus         json.RawMessage `json:"stimulus"`
	Prompt           json.RawMessage `json:"prompt"`
	Answer           json.RawMessage `json:"answer"`
	Rationale        json.RawMessage `json:"rationale"`
	Metadata         json.RawMessage `json:"metadata"`
	Accessibility    json.RawMessage `json:"accessibility"`
}

// QuestionDetail mirrors AssessmentQuestionDetail: placement fields plus the
// nested `question` revision payload.
type QuestionDetail struct {
	ExamQuestionID string                 `json:"examQuestionId"`
	ModuleID       string                 `json:"moduleId"`
	ModuleKey      string                 `json:"moduleKey"`
	SectionKey     string                 `json:"sectionKey"`
	DisplayOrder   int                    `json:"displayOrder"`
	IsPretest      bool                   `json:"isPretest"`
	Question       QuestionRevisionDetail `json:"question"`
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

// Shell loads the current-draft authoring projection (mirrors shell()).
//
// Phase 03 cutover: this is the bulk path (bulkShell) — one identity
// statement plus four version-scoped tree reads inside a single read-only
// snapshot. There is deliberately NO provider gate here, matching the
// historical Shell(); OpenShell/Preview keep their sat gates. Error
// codes/messages are unchanged ("Exam not found."/"Draft version not
// found.", both 404). The nested per-section/per-module loaders
// (loadSections/loadModules/loadSummaries/loadRouting) remain for the
// in-tx post-commit shell (buildShellTx) and the equivalence harness's
// old-path reference; the live read path no longer uses them.
func (s *Service) Shell(ctx context.Context, examID string) (Shell, error) {
	return s.bulkShell(ctx, examID)
}

// OpenShell opens the editable-draft authoring shell (mirrors open_shell:
// exam FOR UPDATE, sat-only gate, existing-draft shortcut returns Shell,
// otherwise clone_published_sat_to_draft_tx + conditional pointer CAS +
// version_created event, commit then Shell).
func (s *Service) OpenShell(ctx context.Context, examID, actorID string) (Shell, error) {
	emission := &eventEmission{}
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

// Preview contains renderable candidate content, not authoring summaries.
type Preview struct {
	ExamID          string                     `json:"examId"`
	ProviderKey     string                     `json:"providerKey"`
	VersionID       string                     `json:"versionId"`
	VersionRevision int                        `json:"versionRevision"`
	Sections        []delivery.DeliverySection `json:"sections"`
}

// Preview loads the candidate-facing projection of the current draft
// (identity + revision once, sat gate BEFORE any cache read, then exactly
// the delivery projection via the bulk loader — never the discarded authoring
// Shell() call the old implementation paid for).
//
// Single build: identity+revision resolve once (inside the snapshot when the
// cache is off, via a single snapshot query when it is on), the sat 422 gate
// runs BEFORE any cache lookup or population (non-sat drafts never touch the
// cache), and the delivery tree comes from the injected loader:
//   - cache on  -> deliverySvc.LoadSectionsBulkWithRevision loader through
//     previewCache.GetChecked(versionID, probedRevision) — a revision
//     mismatch reloads inside the same snapshot (never a stale tree);
//   - cache off -> deliverySvc.LoadSectionsBulk directly (3 statements).
//
// Revision-keyed safety notes: every mutation path bumps
// exam_versions.revision (touchModuleDraft/touchQuestionDraft cover
// create/batch/update/delete/duplicate/bulk/reorder/save-revision;
// UpdateDeliverySettings bumps directly; replaceCompleteSATDraft bumps), so a
// revision mismatch always forces a reload. UndoSATWorkbook swaps the draft
// pointer WITHOUT bumping exam_versions.revision — safe under the
// (versionID, revision) key because the pointer change yields a different
// versionID, whose probe+load describe the restored content. Authz ordering is
// unchanged: handlers gate (role -> tenant GetForActor) before this service.
func (s *Service) Preview(ctx context.Context, examID string) (Preview, error) {
	if s == nil {
		return Preview{}, errNoDatabase
	}
	deliver := s.previewDelivery()
	// Identity+revision resolve once, inside one snapshot-backed query. The
	// sat gate runs BEFORE any cache lookup or population: a non-sat draft
	// returns 422 and never touches the cache.
	var identity shellIdentity
	if err := s.withReadSnapshot(ctx, func(ctx context.Context, q queryRowContexter) error {
		id, err := resolveShellIdentity(ctx, q, examID)
		if err != nil {
			return err
		}
		identity = id
		return nil
	}); err != nil {
		return Preview{}, err
	}
	if identity.providerKey != "sat" {
		return Preview{}, validationError("Assessment provider is not supported.")
	}
	if s.previewCache == nil {
		// Cache off (nil-safe default, also the VERSION_CACHE=off
		// kill-switch posture): one bulk delivery build, 3 statements.
		deliverySections, err := deliver.LoadSectionsBulk(ctx, identity.versionID)
		if err != nil {
			return Preview{}, err
		}
		return Preview{ExamID: examID, ProviderKey: identity.providerKey, VersionID: identity.versionID, VersionRevision: identity.revision, Sections: deliverySections}, nil
	}
	// Cache on: serve the delivery tree through GetChecked singleflight keyed
	// on (versionID, probedRevision). Hit = zero tree statements; miss = the
	// BulkSectionsLoader's 4 statements (3 tree + revision probe INSIDE the
	// same snapshot, so the stored revision describes the stored tree).
	probedRev := int64(identity.revision)
	loader := deliver.BulkSectionsLoader(ctx, identity.versionID)
	sections, err := s.previewCache.GetChecked(ctx, identity.versionID, probedRev, loader)
	if err != nil {
		return Preview{}, err
	}
	return Preview{ExamID: examID, ProviderKey: identity.providerKey, VersionID: identity.versionID, VersionRevision: identity.revision, Sections: sections}, nil
}

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
		deriveRoutingOperational(rp, sr.key, mods)
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
		// NOTE: operationalQuestionCount is NOT parsed from policy_config
		// (see assembleShellTree): real rows are threshold-only, so parsing
		// projected 0 and stuck the release page at 1. The nested path is
		// only used by buildShellTx and the equivalence harness; both set it
		// via deriveRoutingOperational below.
	}
	return &rp, nil
}

// deriveRoutingOperational sets rp.OperationalCount from the live base module
// shape (see derivedOperationalCount in bulk_read.go). Callers that assemble
// a Section outside assembleShellTree must call this so both read paths
// project the same derived value.
func deriveRoutingOperational(rp *RoutingPolicy, sectionKey string, mods []Module) {
	if rp == nil {
		return
	}
	for _, m := range mods {
		if m.ID != rp.BaseModuleID {
			continue
		}
		pretest := 0
		for _, qs := range m.Questions {
			if qs.IsPretest {
				pretest++
			}
		}
		rp.OperationalCount = derivedOperationalCount(sectionKey, m.ModuleKey, m.TargetQuestionCount, pretest)
		return
	}
	rp.OperationalCount = 1
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
