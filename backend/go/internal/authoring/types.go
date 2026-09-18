package authoring

import (
	"encoding/json"

	"example.com/ielts-proctoring/internal/platform/apperrors"
)

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
