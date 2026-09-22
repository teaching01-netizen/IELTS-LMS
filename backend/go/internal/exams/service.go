// Package exams owns thin explicit-SQL exam CRUD for IELTS/SAT/ACT.
//
// It mirrors backend/crates/application/src/builder.rs (create/list/get/
// update/save-draft/publish/delete + validate + version/event accessors) with
// constructor injection, ctx everywhere, explicit SQL and no package globals.
// provider_key awareness: ielts is the default neutral provider; sat uses its
// normalized four-rule publish contract; ACT widens ExamType + the science
// section key (migration 0050 lineage).
package exams

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/authoringrealtime"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/tx"
	"example.com/ielts-proctoring/internal/satpublish"
)

// Provider keys.
const (
	ProviderIELTS = "ielts"
	ProviderSAT   = "sat"
	ProviderACT   = "act"
)

// Exam types (wire values; ACT widened by migration 0050, mirrors
// backend/crates/domain/src/exam.rs ExamType + ACT fork lineage).
const (
	ExamTypeAcademic        = "Academic"
	ExamTypeGeneralTraining = "General Training"
	ExamTypeACT             = "ACT"
)

// Exam statuses.
const (
	StatusDraft       = "draft"
	StatusInReview    = "in_review"
	StatusApproved    = "approved"
	StatusRejected    = "rejected"
	StatusScheduled   = "scheduled"
	StatusPublished   = "published"
	StatusArchived    = "archived"
	StatusUnpublished = "unpublished"
)

// Visibilities.
const (
	VisibilityPrivate      = "private"
	VisibilityOrganization = "organization"
	VisibilityPublic       = "public"
)

// Section keys by provider. IELTS owns listening/reading/writing/speaking;
// SAT owns reading-writing/math (see exam_provider/sat.rs blueprint); ACT
// adds science (migration 0050).
var (
	IELTSSectionKeys = []string{"listening", "reading", "writing", "speaking"}
	SATSectionKeys   = []string{"reading-writing", "math"}
	ACTSectionKeys   = []string{"listening", "reading", "writing", "speaking", "science"}
)

// SectionKeyAllowlist returns the valid section keys for a provider.
func SectionKeyAllowlist(providerKey string) []string {
	switch strings.ToLower(strings.TrimSpace(providerKey)) {
	case ProviderSAT:
		return append([]string(nil), SATSectionKeys...)
	case ProviderACT:
		return append([]string(nil), ACTSectionKeys...)
	default:
		return append([]string(nil), IELTSSectionKeys...)
	}
}

// ValidSectionKey reports whether a section key is allowed for a provider.
func ValidSectionKey(providerKey, sectionKey string) bool {
	for _, k := range SectionKeyAllowlist(providerKey) {
		if k == sectionKey {
			return true
		}
	}
	return false
}

// ValidExamType reports whether an exam_type wire value is known (incl ACT).
func ValidExamType(examType string) bool {
	switch examType {
	case ExamTypeAcademic, ExamTypeGeneralTraining, ExamTypeACT:
		return true
	default:
		return false
	}
}

// ValidProviderKey reports whether a provider_key wire value is known.
func ValidProviderKey(providerKey string) bool {
	switch strings.ToLower(strings.TrimSpace(providerKey)) {
	case ProviderIELTS, ProviderSAT, ProviderACT:
		return true
	default:
		return false
	}
}

// NormalizeProviderKey defaults blank to ielts.
func NormalizeProviderKey(providerKey string) string {
	p := strings.ToLower(strings.TrimSpace(providerKey))
	if p == "" {
		return ProviderIELTS
	}
	return p
}

// EffectiveProviderKey heals legacy ACT rows: exams created through the
// legacy IELTS path carry provider_key='ielts' while exam_type='ACT'
// (provider_exam_type='ACT'). Plan derivation, content validation, and
// section allowlists must treat those rows as ACT so the science section is
// not silently dropped. exam_type ACT always wins; otherwise the stored
// provider key (normalized) is authoritative.
func EffectiveProviderKey(providerKey, examType string) string {
	if strings.EqualFold(strings.TrimSpace(examType), ExamTypeACT) {
		return ProviderACT
	}
	return NormalizeProviderKey(providerKey)
}

// Service wires exam transitions explicitly.
type Service struct {
	db     *sql.DB
	runner *tx.Runner
	// liveOrigin is this instance's bus origin id (mirrors delivery.Service and
	// authoring.Service). Empty = no bus: eventsOn() stays false.
	liveOrigin string
	// eventsEnabled is the AUTHORING_REALTIME_EVENTS gate (Phase 02). Off by
	// default: byte-identical legacy publish behavior with no bus INSERT.
	eventsEnabled bool
}

// NewService wires dependencies explicitly.
func NewService(db *sql.DB, runner *tx.Runner) *Service {
	return &Service{db: db, runner: runner}
}

// Exam is the list/detail row mirrored from ExamEntity (camelCase wire shape
// is the handler's job; this struct keeps snake parity with columns).
type Exam struct {
	ID                      string    `json:"id"`
	Slug                    string    `json:"slug"`
	Title                   string    `json:"title"`
	ProviderKey             string    `json:"providerKey"`
	ProviderExamType        *string   `json:"providerExamType,omitempty"`
	ExamType                string    `json:"examType"`
	Status                  string    `json:"status"`
	Visibility              string    `json:"visibility"`
	OrganizationID          *string   `json:"organizationId,omitempty"`
	OwnerID                 string    `json:"ownerId"`
	CurrentDraftVersionID   *string   `json:"currentDraftVersionId,omitempty"`
	CurrentPublishedVersion *string   `json:"currentPublishedVersionId,omitempty"`
	SchemaVersion           int       `json:"schemaVersion"`
	Revision                int       `json:"revision"`
	CreatedAt               time.Time `json:"createdAt"`
	UpdatedAt               time.Time `json:"updatedAt"`
	CanEdit                 bool      `json:"canEdit"`
	CanPublish              bool      `json:"canPublish"`
	CanDelete               bool      `json:"canDelete"`
}

// Version is the exam_versions row projection used by ListVersions.
type Version struct {
	ID            string          `json:"id"`
	ExamID        string          `json:"examId"`
	VersionNumber int             `json:"versionNumber"`
	ParentVersion *string         `json:"parentVersionId,omitempty"`
	Content       json.RawMessage `json:"contentSnapshot"`
	Config        json.RawMessage `json:"configSnapshot"`
	Validation    json.RawMessage `json:"validationSnapshot,omitempty"`
	CreatedAt     time.Time       `json:"createdAt"`
	CreatedBy     string          `json:"createdBy"`
	PublishNotes  *string         `json:"publishNotes,omitempty"`
	IsDraft       bool            `json:"isDraft"`
	IsPublished   bool            `json:"isPublished"`
	Revision      int             `json:"revision"`
}

// Event is one exam_events audit row.
type Event struct {
	ID        string          `json:"id"`
	ExamID    string          `json:"examId"`
	VersionID *string         `json:"versionId,omitempty"`
	ActorID   string          `json:"actorId"`
	CreatedAt time.Time       `json:"createdAt"`
	Action    string          `json:"action"`
	FromState *string         `json:"fromState,omitempty"`
	ToState   *string         `json:"toState,omitempty"`
	Payload   json.RawMessage `json:"payload,omitempty"`
}

// ValidationIssue is one field/message finding (mirrors domain ValidationIssue).
type ValidationIssue struct {
	Field   string `json:"field"`
	Message string `json:"message"`
}

// ValidationReport mirrors ExamValidationSummary for the publish gate.
type ValidationReport struct {
	ExamID         string            `json:"examId"`
	DraftVersionID *string           `json:"draftVersionId,omitempty"`
	CanPublish     bool              `json:"canPublish"`
	Errors         []ValidationIssue `json:"errors"`
	Warnings       []ValidationIssue `json:"warnings"`
	ValidatedAt    time.Time         `json:"validatedAt"`
}

// CreateRequest mirrors CreateExamRequest (wire camelCase).
type CreateRequest struct {
	Slug             string
	Title            string
	ExamType         string
	Visibility       string
	OrganizationID   *string
	ProviderKey      *string
	ProviderExamType *string
	OwnerID          string
}

// UpdateRequest mirrors UpdateExamRequest with revision fencing.
type UpdateRequest struct {
	Title          *string
	Status         *string
	Visibility     *string
	OrganizationID *string
	Revision       int
}

// SaveDraftRequest mirrors SaveDraftRequest with revision fencing.
type SaveDraftRequest struct {
	Content  json.RawMessage
	Config   json.RawMessage
	Revision int
}

// PublishRequest mirrors PublishExamRequest with revision fencing.
// OperationKey makes a lost-response publish retry converge on the original
// release instead of sealing a second published version.
type PublishRequest struct {
	PublishNotes           *string
	Revision               int
	ExpectedDraftVersionID *string
	ExpectedDraftRevision  *int
	OperationKey           string
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

// claimPublishOperationKey mirrors authoring.claimOperationKey for the
// publish path so a lost-response retry replays the sealed version.
func claimPublishOperationKey(ctx context.Context, q tx.Tx, actor, scope, key, fingerprint string) (replay []byte, claimed bool, err error) {
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

const examColumns = "id, slug, title, provider_key, provider_exam_type, exam_type, status, visibility, organization_id, owner_id, current_draft_version_id, current_published_version_id, schema_version, revision, created_at, updated_at"

func scanExam(row interface {
	Scan(dest ...any) error
}) (Exam, error) {
	var e Exam
	var providerExamType, orgID, draftID, pubID sql.NullString
	if err := row.Scan(&e.ID, &e.Slug, &e.Title, &e.ProviderKey, &providerExamType, &e.ExamType, &e.Status, &e.Visibility, &orgID, &e.OwnerID, &draftID, &pubID, &e.SchemaVersion, &e.Revision, &e.CreatedAt, &e.UpdatedAt); err != nil {
		return Exam{}, err
	}
	if providerExamType.Valid {
		v := providerExamType.String
		e.ProviderExamType = &v
	}
	if orgID.Valid {
		v := orgID.String
		e.OrganizationID = &v
	}
	if draftID.Valid {
		v := draftID.String
		e.CurrentDraftVersionID = &v
	}
	if pubID.Valid {
		v := pubID.String
		e.CurrentPublishedVersion = &v
	}
	return e, nil
}

func validateCreate(req CreateRequest) error {
	if strings.TrimSpace(req.Slug) == "" {
		return validationError("Exam slug is required.")
	}
	if strings.TrimSpace(req.Title) == "" {
		return validationError("Exam title is required.")
	}
	if !ValidExamType(req.ExamType) {
		return validationError(fmt.Sprintf("Invalid exam type %q; expected Academic, General Training, or ACT.", req.ExamType))
	}
	switch req.Visibility {
	case VisibilityPrivate, VisibilityOrganization, VisibilityPublic:
	default:
		return validationError(fmt.Sprintf("Invalid visibility %q.", req.Visibility))
	}
	if req.ProviderKey != nil && !ValidProviderKey(*req.ProviderKey) {
		return validationError(fmt.Sprintf("Invalid provider key %q; expected ielts, sat, or act.", *req.ProviderKey))
	}
	if strings.TrimSpace(req.OwnerID) == "" {
		return validationError("Exam owner is required.")
	}
	return nil
}

func requireReadActor(actor auth.ActorContext) error {
	if err := actor.RequireOneOf(auth.RoleAdmin, auth.RoleAdminObserver, auth.RoleBuilder); err != nil {
		return err
	}
	return nil
}

func requireWriteActor(actor auth.ActorContext) error {
	if err := actor.RequireOneOf(auth.RoleAdmin, auth.RoleBuilder); err != nil {
		return err
	}
	return nil
}

func applyExamPermissions(actor auth.ActorContext, exam Exam) Exam {
	canModify := actor.Role == auth.RoleAdmin || actor.Role == auth.RoleBuilder
	exam.CanEdit = canModify
	exam.CanPublish = canModify
	exam.CanDelete = canModify
	return exam
}

// actorExamScope appends the tenant predicate used by the Rust builder
// service. Platform readers see all exams; builders see only their
// organization. A builder without an organization is deliberately scoped to
// no rows rather than being treated as platform-scoped.
func actorExamScope(actor auth.ActorContext) (string, []any) {
	if actor.IsPlatformRead() {
		return "", nil
	}
	if actor.OrgID == nil || strings.TrimSpace(*actor.OrgID) == "" {
		return " AND 1 = 0", nil
	}
	return " AND organization_id = ?", []any{strings.TrimSpace(*actor.OrgID)}
}

// ListForActor is the authorization-aware exam list boundary. The legacy
// List method remains available to migration/seed tooling, while HTTP paths
// must use this method so tenant scope cannot be supplied by a request body.
func (s *Service) ListForActor(ctx context.Context, actor auth.ActorContext, providerKey *string) ([]Exam, error) {
	if err := requireReadActor(actor); err != nil {
		return nil, err
	}
	query := "SELECT " + examColumns + " FROM exam_entities WHERE 1 = 1"
	args := []any{}
	if providerKey != nil && strings.TrimSpace(*providerKey) != "" {
		p := NormalizeProviderKey(*providerKey)
		if !ValidProviderKey(p) {
			return nil, validationError(fmt.Sprintf("Invalid provider key %q; expected ielts, sat, or act.", *providerKey))
		}
		query += " AND provider_key = ?"
		args = append(args, p)
	}
	scope, scopeArgs := actorExamScope(actor)
	query += scope
	args = append(args, scopeArgs...)
	query += " ORDER BY updated_at DESC, id DESC"
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Exam
	for rows.Next() {
		e, err := scanExam(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, applyExamPermissions(actor, e))
	}
	return out, rows.Err()
}

// GetForActor loads an exam only when the actor is allowed to read its tenant.
func (s *Service) GetForActor(ctx context.Context, actor auth.ActorContext, id string) (Exam, error) {
	if err := requireReadActor(actor); err != nil {
		return Exam{}, err
	}
	query := "SELECT " + examColumns + " FROM exam_entities WHERE id = ?"
	args := []any{id}
	scope, scopeArgs := actorExamScope(actor)
	query += scope
	args = append(args, scopeArgs...)
	e, err := scanExam(s.db.QueryRowContext(ctx, query, args...))
	if err != nil {
		if err == sql.ErrNoRows {
			return Exam{}, notFoundError("Exam not found.")
		}
		return Exam{}, err
	}
	return applyExamPermissions(actor, e), nil
}

// CreateForActor derives owner and tenant from the authenticated actor. In
// particular, a builder cannot create an exam in an organization supplied by
// the client payload.
func (s *Service) CreateForActor(ctx context.Context, actor auth.ActorContext, req CreateRequest) (Exam, error) {
	if err := requireWriteActor(actor); err != nil {
		return Exam{}, err
	}
	req.OwnerID = actor.UserID
	if actor.Role == auth.RoleAdmin {
		req.OrganizationID = nil
	} else {
		if actor.OrgID == nil || strings.TrimSpace(*actor.OrgID) == "" {
			return Exam{}, notFoundError("Exam organization not found.")
		}
		orgID := strings.TrimSpace(*actor.OrgID)
		req.OrganizationID = &orgID
	}
	exam, err := s.Create(ctx, req)
	if err != nil {
		return Exam{}, err
	}
	return applyExamPermissions(actor, exam), nil
}

// UpdateForActor enforces the writer role and tenant scope before applying
// the revision-fenced mutation.
func (s *Service) UpdateForActor(ctx context.Context, actor auth.ActorContext, id string, req UpdateRequest) (Exam, error) {
	if err := requireWriteActor(actor); err != nil {
		return Exam{}, err
	}
	if _, err := s.GetForActor(ctx, actor, id); err != nil {
		return Exam{}, err
	}
	if actor.Role != auth.RoleAdmin {
		req.OrganizationID = nil
	}
	exam, err := s.Update(ctx, id, req)
	if err != nil {
		return Exam{}, err
	}
	return applyExamPermissions(actor, exam), nil
}

func (s *Service) DeleteForActor(ctx context.Context, actor auth.ActorContext, id string) error {
	if err := requireWriteActor(actor); err != nil {
		return err
	}
	if _, err := s.GetForActor(ctx, actor, id); err != nil {
		return err
	}
	return s.Delete(ctx, id)
}

func (s *Service) SaveDraftForActor(ctx context.Context, actor auth.ActorContext, examID string, req SaveDraftRequest) (Version, error) {
	if err := requireWriteActor(actor); err != nil {
		return Version{}, err
	}
	if _, err := s.GetForActor(ctx, actor, examID); err != nil {
		return Version{}, err
	}
	return s.SaveDraft(ctx, examID, actor.UserID, req)
}

func (s *Service) PublishForActor(ctx context.Context, actor auth.ActorContext, examID string, req PublishRequest) (Version, error) {
	if err := requireWriteActor(actor); err != nil {
		return Version{}, err
	}
	if _, err := s.GetForActor(ctx, actor, examID); err != nil {
		return Version{}, err
	}
	return s.Publish(ctx, examID, actor.UserID, req)
}

func (s *Service) ListEventsForActor(ctx context.Context, actor auth.ActorContext, examID string) ([]Event, error) {
	if err := requireReadActor(actor); err != nil {
		return nil, err
	}
	if _, err := s.GetForActor(ctx, actor, examID); err != nil {
		return nil, err
	}
	return s.ListEvents(ctx, examID)
}

func (s *Service) GetValidationForActor(ctx context.Context, actor auth.ActorContext, examID string) (ValidationReport, error) {
	if err := requireReadActor(actor); err != nil {
		return ValidationReport{}, err
	}
	if _, err := s.GetForActor(ctx, actor, examID); err != nil {
		return ValidationReport{}, err
	}
	return s.GetValidation(ctx, examID)
}

func (s *Service) ListVersionsForActor(ctx context.Context, actor auth.ActorContext, examID string) ([]Version, error) {
	if err := requireReadActor(actor); err != nil {
		return nil, err
	}
	if _, err := s.GetForActor(ctx, actor, examID); err != nil {
		return nil, err
	}
	return s.ListVersions(ctx, examID)
}

func (s *Service) ListVersionSummariesForActor(ctx context.Context, actor auth.ActorContext, examID string) ([]VersionSummary, error) {
	if err := requireReadActor(actor); err != nil {
		return nil, err
	}
	if _, err := s.GetForActor(ctx, actor, examID); err != nil {
		return nil, err
	}
	return s.ListVersionSummaries(ctx, examID)
}

// List returns exams optionally filtered by provider_key (mirrors
// list_exams_for_provider; empty filter returns all).
func (s *Service) List(ctx context.Context, providerKey *string) ([]Exam, error) {
	query := "SELECT " + examColumns + " FROM exam_entities"
	args := []any{}
	if providerKey != nil && strings.TrimSpace(*providerKey) != "" {
		p := NormalizeProviderKey(*providerKey)
		if !ValidProviderKey(p) {
			return nil, validationError(fmt.Sprintf("Invalid provider key %q; expected ielts, sat, or act.", *providerKey))
		}
		query += " WHERE provider_key = ?"
		args = append(args, p)
	}
	query += " ORDER BY updated_at DESC, id DESC"
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Exam
	for rows.Next() {
		e, err := scanExam(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// Create inserts an exam row plus a created audit event and an empty draft
// version skeleton (mirrors builder create_exam; SAT/ACT provider rows carry
// provider_key + provider_exam_type explicitly).
func (s *Service) Create(ctx context.Context, req CreateRequest) (Exam, error) {
	if err := validateCreate(req); err != nil {
		return Exam{}, err
	}
	providerKey := NormalizeProviderKey(firstNonEmpty(req.ProviderKey))
	id := uuid.NewString()
	orgID := sql.NullString{}
	if req.OrganizationID != nil && strings.TrimSpace(*req.OrganizationID) != "" {
		orgID = sql.NullString{String: strings.TrimSpace(*req.OrganizationID), Valid: true}
	}
	providerExamType := sql.NullString{}
	if req.ProviderExamType != nil && strings.TrimSpace(*req.ProviderExamType) != "" {
		providerExamType = sql.NullString{String: strings.TrimSpace(*req.ProviderExamType), Valid: true}
	}
	if providerKey == ProviderSAT && !providerExamType.Valid {
		providerExamType = sql.NullString{String: "digital_sat", Valid: true}
	}
	schemaVersion := 1
	if providerKey == ProviderSAT {
		schemaVersion = 4
	}
	var created Exam
	err := s.runner.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		res, err := q.ExecContext(ctx, "INSERT INTO exam_entities (id, slug, title, provider_key, provider_exam_type, exam_type, status, visibility, organization_id, owner_id, created_at, updated_at, schema_version, revision) VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, NOW(), NOW(), ?, 0)", id, strings.TrimSpace(req.Slug), strings.TrimSpace(req.Title), providerKey, nullableString(providerExamType), req.ExamType, req.Visibility, nullableString(orgID), strings.TrimSpace(req.OwnerID), schemaVersion)
		if err != nil {
			if isDuplicateKey(err) {
				return conflictError(fmt.Sprintf("Exam slug %q is already taken.", req.Slug))
			}
			return err
		}
		_ = res
		var versionID string
		if providerKey == ProviderSAT {
			// SAT creation owns the complete editable blueprint. The authoring
			// shell requires sections, adaptive modules, routing policies, and a
			// table-driven scoring policy before the first sample/workbook import.
			versionID, err = initializeSATDraftTx(ctx, q, id, strings.TrimSpace(req.OwnerID))
			if err != nil {
				return err
			}
		} else {
			versionID = uuid.NewString()
			if _, err := q.ExecContext(ctx, "INSERT INTO exam_versions (id, exam_id, version_number, parent_version_id, content_snapshot, config_snapshot, validation_snapshot, created_by, created_at, is_draft, is_published, revision) VALUES (?, ?, 1, NULL, '{}', '{}', NULL, ?, NOW(), TRUE, FALSE, 0)", versionID, id, strings.TrimSpace(req.OwnerID)); err != nil {
				return err
			}
			// The initial entity revision is the draft-version fence exposed to the
			// builder. Both the skeleton version and the entity therefore start at
			// zero; the first SaveDraft owns the first revision transition.
			if _, err := q.ExecContext(ctx, "UPDATE exam_entities SET current_draft_version_id = ? WHERE id = ?", versionID, id); err != nil {
				return err
			}
		}
		if _, err := q.ExecContext(ctx, "INSERT INTO exam_events (id, exam_id, version_id, actor_id, action, from_state, to_state, created_at) VALUES (?, ?, ?, ?, 'created', NULL, 'draft', NOW())", uuid.NewString(), id, versionID, strings.TrimSpace(req.OwnerID)); err != nil {
			return err
		}
		row := q.QueryRowContext(ctx, "SELECT "+examColumns+" FROM exam_entities WHERE id = ?", id)
		e, err := scanExam(row)
		if err != nil {
			return err
		}
		created = e
		return nil
	})
	return created, err
}

// Get loads one exam or returns NOT_FOUND.
func (s *Service) Get(ctx context.Context, id string) (Exam, error) {
	row := s.db.QueryRowContext(ctx, "SELECT "+examColumns+" FROM exam_entities WHERE id = ?", id)
	e, err := scanExam(row)
	if err != nil {
		if err == sql.ErrNoRows {
			return Exam{}, notFoundError("Exam not found.")
		}
		return Exam{}, err
	}
	return e, nil
}

// Update applies title/status/visibility with revision fencing (mirrors
// builder update_exam; stale revision is a CONFLICT).
func (s *Service) Update(ctx context.Context, id string, req UpdateRequest) (Exam, error) {
	if req.Title != nil && strings.TrimSpace(*req.Title) == "" {
		return Exam{}, validationError("Exam title is required.")
	}
	if req.Status != nil {
		switch *req.Status {
		case StatusDraft, StatusInReview, StatusApproved, StatusRejected, StatusScheduled, StatusPublished, StatusArchived, StatusUnpublished:
		default:
			return Exam{}, validationError(fmt.Sprintf("Invalid status %q.", *req.Status))
		}
	}
	if req.Visibility != nil {
		switch *req.Visibility {
		case VisibilityPrivate, VisibilityOrganization, VisibilityPublic:
		default:
			return Exam{}, validationError(fmt.Sprintf("Invalid visibility %q.", *req.Visibility))
		}
	}
	var updated Exam
	err := s.runner.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		row := q.QueryRowContext(ctx, "SELECT "+examColumns+" FROM exam_entities WHERE id = ? FOR UPDATE", id)
		existing, err := scanExam(row)
		if err != nil {
			if err == sql.ErrNoRows {
				return notFoundError("Exam not found.")
			}
			return err
		}
		if existing.Revision != req.Revision {
			return conflictError("Exam changed while you were editing; refresh before retrying.")
		}
		res, err := q.ExecContext(ctx, "UPDATE exam_entities SET title = COALESCE(?, title), status = COALESCE(?, status), visibility = COALESCE(?, visibility), organization_id = COALESCE(?, organization_id), updated_at = NOW(), revision = revision + 1 WHERE id = ? AND revision = ?", nullableStrPtr(req.Title), nullableStrPtr(req.Status), nullableStrPtr(req.Visibility), nullableStrPtr(req.OrganizationID), id, req.Revision)
		if err != nil {
			return err
		}
		n, _ := res.RowsAffected()
		if n != 1 {
			return conflictError("Exam changed while you were editing; refresh before retrying.")
		}
		row2 := q.QueryRowContext(ctx, "SELECT "+examColumns+" FROM exam_entities WHERE id = ?", id)
		e, err := scanExam(row2)
		if err != nil {
			return err
		}
		updated = e
		return nil
	})
	return updated, err
}

// Delete removes an exam (cascades to versions/events via FK).
func (s *Service) Delete(ctx context.Context, id string) error {
	return s.runner.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		// exam_events.version_id is intentionally restrictive so an event cannot
		// outlive its version. Delete the exam-owned audit rows first; the exam
		// deletion then cascades the versions and the remaining exam-owned rows.
		if _, err := q.ExecContext(ctx, "DELETE FROM exam_events WHERE exam_id = ?", id); err != nil {
			return err
		}
		// Internal version lineage must be detached before the exam cascade;
		// MySQL checks self-referential foreign keys during the cascade.
		if _, err := q.ExecContext(ctx, "UPDATE exam_versions SET parent_version_id = NULL WHERE exam_id = ?", id); err != nil {
			return err
		}
		res, err := q.ExecContext(ctx, "DELETE FROM exam_entities WHERE id = ?", id)
		if err != nil {
			return err
		}
		n, _ := res.RowsAffected()
		if n != 1 {
			return notFoundError("Exam not found.")
		}
		return nil
	})
}

// SaveDraft replaces the current draft content/config snapshots with revision
// fencing (mirrors builder save_draft; SAT/ACT-only shape checks stay in
// authoring.validate paths).
func (s *Service) SaveDraft(ctx context.Context, examID string, actorID string, req SaveDraftRequest) (Version, error) {
	if len(bytesTrim(req.Content)) == 0 || string(bytesTrim(req.Content)) == "null" {
		return Version{}, validationError("Draft content is missing. Save a draft before publishing.")
	}
	if len(bytesTrim(req.Config)) == 0 || string(bytesTrim(req.Config)) == "null" {
		return Version{}, validationError("Draft configuration is missing. Save a draft before publishing.")
	}
	var out Version
	err := s.runner.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		var draftID string
		var draftRev int
		if err := q.QueryRowContext(ctx, "SELECT v.id, v.revision FROM exam_versions v JOIN exam_entities e ON e.id = v.exam_id WHERE v.exam_id = ? AND v.is_draft = TRUE AND e.current_draft_version_id = v.id FOR UPDATE", examID).Scan(&draftID, &draftRev); err != nil {
			if err == sql.ErrNoRows {
				return notFoundError("Draft version not found.")
			}
			return err
		}
		if draftRev != req.Revision {
			return conflictError("Draft changed while you were editing; refresh before retrying.")
		}
		res, err := q.ExecContext(ctx, "UPDATE exam_versions SET content_snapshot = ?, config_snapshot = ?, revision = revision + 1 WHERE id = ? AND revision = ?", string(req.Content), string(req.Config), draftID, req.Revision)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n != 1 {
			return conflictError("Draft changed while you were editing; refresh before retrying.")
		}
		if _, err := q.ExecContext(ctx, "UPDATE exam_entities SET revision = revision + 1, updated_at = NOW() WHERE id = ?", examID); err != nil {
			return err
		}
		if _, err := q.ExecContext(ctx, "INSERT INTO exam_events (id, exam_id, version_id, actor_id, action, created_at) VALUES (?, ?, ?, ?, 'draft_saved', NOW())", uuid.NewString(), examID, draftID, actorID); err != nil {
			return err
		}
		v, err := loadVersion(ctx, q, draftID)
		if err != nil {
			return err
		}
		out = v
		return nil
	})
	return out, err
}

// Publish seals the current draft (mirrors builder publish_exam): validates
// non-empty snapshots, flips is_draft/is_published, points
// current_published_version_id, and records a published event. Expected
// draft id/revision fencing rejects stale consoles with CONFLICT.
func (s *Service) Publish(ctx context.Context, examID string, actorID string, req PublishRequest) (Version, error) {
	var out Version
	emission := &eventEmission{}
	normalizedKey := strings.TrimSpace(req.OperationKey)
	if normalizedKey != "" && len(normalizedKey) > 128 {
		return Version{}, validationError("operationKey must contain between 1 and 128 characters.")
	}
	publishScope := "publish:" + examID
	var publishFingerprint string
	if normalizedKey != "" {
		raw, err := json.Marshal(map[string]any{"exam": examID, "rev": req.Revision, "draft": req.ExpectedDraftVersionID, "draftRev": req.ExpectedDraftRevision, "notes": req.PublishNotes})
		if err != nil {
			return Version{}, err
		}
		// Fingerprint mirrors authoring.operationFingerprint; exams must
		// not import authoring, so the sha is computed inline.
		sum := sha256.Sum256(raw)
		publishFingerprint = fmt.Sprintf("%x", sum[:])
	}
	err := s.runner.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		if normalizedKey != "" {
			replay, claimed, err := claimPublishOperationKey(ctx, q, actorID, publishScope, normalizedKey, publishFingerprint)
			if err != nil {
				return err
			}
			if !claimed {
				if len(replay) == 0 {
					return conflictError("This publish is still being processed; retry with the same operation key.")
				}
				var replayed Version
				if err := json.Unmarshal(replay, &replayed); err != nil {
					return err
				}
				out = replayed
				return nil
			}
		}
		var draftID string
		var versionNumber int
		var content, config string
		var draftRev int
		var providerKey, examType string
		var organizationID sql.NullString
		if err := q.QueryRowContext(ctx, "SELECT v.id, v.version_number, CAST(v.content_snapshot AS CHAR), CAST(v.config_snapshot AS CHAR), v.revision, e.provider_key, e.exam_type, e.organization_id FROM exam_versions v JOIN exam_entities e ON e.id = v.exam_id WHERE v.exam_id = ? AND v.is_draft = TRUE AND v.id = (SELECT current_draft_version_id FROM exam_entities WHERE id = ?) FOR UPDATE", examID, examID).Scan(&draftID, &versionNumber, &content, &config, &draftRev, &providerKey, &examType, &organizationID); err != nil {
			if err == sql.ErrNoRows {
				return notFoundError("Draft version not found.")
			}
			return err
		}
		if req.ExpectedDraftVersionID != nil && *req.ExpectedDraftVersionID != draftID {
			return conflictError("Draft changed while publish checks were running. Run the checks again.")
		}
		if req.ExpectedDraftRevision != nil && *req.ExpectedDraftRevision != draftRev {
			return conflictError("Draft changed while publish checks were running. Run the checks again.")
		}
		var entityRevision int
		if err := q.QueryRowContext(ctx, "SELECT revision FROM exam_entities WHERE id = ? FOR UPDATE", examID).Scan(&entityRevision); err != nil {
			return err
		}
		// SAT sends both counters: revision fences the entity and
		// expectedDraftRevision fences its content. Legacy IELTS clients send
		// only revision, which historically fences the draft.
		if req.ExpectedDraftRevision != nil {
			if entityRevision != req.Revision {
				return conflictError("Exam changed while publish checks were running. Run the checks again.")
			}
		} else if draftRev != req.Revision {
			return conflictError("Draft changed while publish checks were running. Run the checks again.")
		}
		provider := EffectiveProviderKey(providerKey, examType)
		if provider != ProviderSAT {
			if isEmptySnapshot(content) {
				return validationError("Draft content is missing. Save a draft before publishing.")
			}
			if isEmptySnapshot(config) {
				return validationError("Draft configuration is missing. Save a draft before publishing.")
			}
			if issues := validateContentShape(content, config, provider); len(issues) > 0 {
				return validationError("Draft content is invalid: " + issues[0].Message)
			}
		}
		if provider == ProviderSAT {
			issues, err := satpublish.ValidateDraft(ctx, q, draftID)
			if err != nil {
				return err
			}
			if len(issues) > 0 {
				first := issues[0]
				rejection := validationError("SAT publish requirements are not met: " + first.Message)
				rejection.Details = map[string]any{"code": first.Code, "path": first.Path}
				return rejection
			}
		}
		if _, err := q.ExecContext(ctx, "UPDATE exam_versions SET is_draft = FALSE, is_published = TRUE, publish_notes = ?, revision = revision + 1 WHERE id = ?", nullableStrPtr(req.PublishNotes), draftID); err != nil {
			return err
		}
		// The entity and draft remain locked until both publication pointers commit.
		if _, err := q.ExecContext(ctx, "UPDATE exam_entities SET current_draft_version_id = NULL, current_published_version_id = ?, status = 'published', published_at = NOW(), revision = revision + 1 WHERE id = ?", draftID, examID); err != nil {
			return err
		}
		if _, err := q.ExecContext(ctx, "INSERT INTO exam_events (id, exam_id, version_id, actor_id, action, from_state, to_state, created_at) VALUES (?, ?, ?, ?, 'published', 'draft', 'published', NOW())", uuid.NewString(), examID, draftID, actorID); err != nil {
			return err
		}
		// Phase 02: exam.published, appended in-tx with the pointer flip so a
		// rollback leaves no event.
		//
		// Publishing REMOVES the working draft (current_draft_version_id -> NULL),
		// so this is a draft REPLACEMENT with no successor. Subscribers learn their
		// workspace is no longer editable, stop autosaving against it, and keep
		// local dirty work.
		//
		// DraftRevision is the post-flip generation (the UPDATE above bumps it by
		// one); the entity revision is not meaningful for an exam-scoped event, so
		// it stays 0. The emission is recorded on the publisher so the metric is
		// counted only after this transaction commits.
		if s.eventsOn() {
			evt, err := authoringrealtime.NewEvent(authoringrealtime.EventInput{
				Kind:           authoringrealtime.KindDraftReplaced,
				OrganizationID: orgPtr(organizationID),
				ExamID:         examID,
				DraftVersionID: draftID,
				DraftRevision:  draftRev + 1,
				ActorID:        actorID,
				Entity: authoringrealtime.Entity{
					Kind:   authoringrealtime.EntityExam,
					ExamID: examID,
				},
				ChangedFields: authoringrealtime.NewChangedFields(
					string(authoringrealtime.FieldDeliverySettings),
					string(authoringrealtime.FieldDraftRevision),
				),
				CausationID: normalizedKey,
			})
			if err == nil {
				err = authoringrealtime.AppendInTx(ctx, q, s.liveOrigin, evt)
			}
			if err != nil {
				emission.operation = "publish"
				return authoringrealtime.WrapPublishError(err)
			}
			emission.operation = "publish"
			emission.appended = true
		}
		_ = versionNumber
		v, err := loadVersion(ctx, q, draftID)
		if err != nil {
			return err
		}
		out = v
		if normalizedKey != "" {
			raw, err := json.Marshal(out)
			if err != nil {
				return err
			}
			if _, err := q.ExecContext(ctx, "UPDATE authoring_operation_keys SET result_json = ? WHERE actor_id = ? AND scope = ? AND operation_key = ?", string(raw), actorID, publishScope, normalizedKey); err != nil {
				return err
			}
		}
		return nil
	})
	emission.flush(err)
	return out, err
}

// ReopenDraft heals clone-database IELTS exams that lost their editable draft
// (orphan NULL/NULL pointers from failed clone writes, or published rows whose
// draft was sealed by Publish). It inserts a fresh draft seeded from the
// latest surviving version — published snapshots stay immutable; the new draft
// parents from them — or an empty skeleton when no version survives, CASes
// current_draft_version_id only when the exam still lacks a live draft, and
// records a version_created event. A healthy exam with a live draft pointer
// shortcuts to the existing draft so Retry/concurrent callers converge without
// duplicating versions.
func (s *Service) ReopenDraft(ctx context.Context, examID string, actorID string) (Version, error) {
	var out Version
	err := s.runner.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		row := q.QueryRowContext(ctx, "SELECT "+examColumns+" FROM exam_entities WHERE id = ? FOR UPDATE", examID)
		exam, err := scanExam(row)
		if err != nil {
			if err == sql.ErrNoRows {
				return notFoundError("Exam not found.")
			}
			return err
		}
		if exam.CurrentDraftVersionID != nil && strings.TrimSpace(*exam.CurrentDraftVersionID) != "" {
			v, err := loadVersion(ctx, q, strings.TrimSpace(*exam.CurrentDraftVersionID))
			if err != nil {
				if err == sql.ErrNoRows {
					return notFoundError("Draft version not found.")
				}
				return err
			}
			if !v.IsDraft {
				return notFoundError("Draft version not found.")
			}
			out = v
			return nil
		}
		type survivingVersion struct {
			id            string
			versionNumber int
			content       string
			config        string
		}
		rows, err := q.QueryContext(ctx, "SELECT id, version_number, CAST(content_snapshot AS CHAR), CAST(config_snapshot AS CHAR), created_by, is_draft, is_published, revision FROM exam_versions WHERE exam_id = ? ORDER BY version_number DESC, created_at DESC", examID)
		if err != nil {
			return err
		}
		var latest *survivingVersion
		for rows.Next() {
			var sv survivingVersion
			var createdBy string
			var isDraft, isPublished bool
			var revision int
			if err := rows.Scan(&sv.id, &sv.versionNumber, &sv.content, &sv.config, &createdBy, &isDraft, &isPublished, &revision); err != nil {
				rows.Close()
				return err
			}
			if latest == nil {
				copy := sv
				latest = &copy
			}
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}
		seedContent := "{}"
		seedConfig := "{}"
		var parentVersionID *string
		if latest != nil {
			if strings.TrimSpace(latest.content) != "" {
				seedContent = latest.content
			}
			if strings.TrimSpace(latest.config) != "" {
				seedConfig = latest.config
			}
			parent := latest.id
			parentVersionID = &parent
		}
		var nextVersionNumber int
		if err := q.QueryRowContext(ctx, "SELECT COALESCE(MAX(version_number), 0) + 1 FROM exam_versions WHERE exam_id = ?", examID).Scan(&nextVersionNumber); err != nil {
			return err
		}
		newVersionID := uuid.NewString()
		if _, err := q.ExecContext(ctx, "INSERT INTO exam_versions (id, exam_id, version_number, parent_version_id, content_snapshot, config_snapshot, validation_snapshot, created_by, created_at, is_draft, is_published, revision) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, NOW(), TRUE, FALSE, 0)", newVersionID, examID, nextVersionNumber, nullableStrPtr(parentVersionID), seedContent, seedConfig, strings.TrimSpace(actorID)); err != nil {
			return err
		}
		res, err := q.ExecContext(ctx, "UPDATE exam_entities SET current_draft_version_id = ?, updated_at = NOW(), revision = revision + 1 WHERE id = ? AND current_draft_version_id IS NULL", newVersionID, examID)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n != 1 {
			return conflictError("The exam draft changed while reopening. Refresh and try again.")
		}
		if _, err := q.ExecContext(ctx, "INSERT INTO exam_events (id, exam_id, version_id, actor_id, action, created_at) VALUES (?, ?, ?, ?, 'version_created', NOW())", uuid.NewString(), examID, newVersionID, strings.TrimSpace(actorID)); err != nil {
			return err
		}
		v, err := loadVersion(ctx, q, newVersionID)
		if err != nil {
			return err
		}
		out = v
		return nil
	})
	return out, err
}

func (s *Service) ReopenDraftForActor(ctx context.Context, actor auth.ActorContext, examID string) (Version, error) {
	if err := requireWriteActor(actor); err != nil {
		return Version{}, err
	}
	if _, err := s.GetForActor(ctx, actor, examID); err != nil {
		return Version{}, err
	}
	return s.ReopenDraft(ctx, examID, actor.UserID)
}

// ListEvents returns the append-only audit trail for an exam.
func (s *Service) ListEvents(ctx context.Context, examID string) ([]Event, error) {
	rows, err := s.db.QueryContext(ctx, "SELECT id, exam_id, version_id, actor_id, action, from_state, to_state, payload, created_at FROM exam_events WHERE exam_id = ? ORDER BY created_at DESC, id DESC", examID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Event
	for rows.Next() {
		var e Event
		var versionID, fromState, toState sql.NullString
		var payload sql.NullString
		if err := rows.Scan(&e.ID, &e.ExamID, &versionID, &e.ActorID, &e.Action, &fromState, &toState, &payload, &e.CreatedAt); err != nil {
			return nil, err
		}
		if versionID.Valid {
			v := versionID.String
			e.VersionID = &v
		}
		if fromState.Valid {
			v := fromState.String
			e.FromState = &v
		}
		if toState.Valid {
			v := toState.String
			e.ToState = &v
		}
		if payload.Valid && strings.TrimSpace(payload.String) != "" {
			e.Payload = json.RawMessage(payload.String)
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// GetValidation mirrors builder validate_exam for the IELTS path (non-empty
// title + draft snapshots + content/config structural checks) and returns a
// publish-gate report. SAT uses the normalized four-rule publish contract;
// ACT science sections are allow-listed here.
func (s *Service) GetValidation(ctx context.Context, examID string) (ValidationReport, error) {
	exam, err := s.Get(ctx, examID)
	if err != nil {
		return ValidationReport{}, err
	}
	rep := ValidationReport{Errors: []ValidationIssue{}, Warnings: []ValidationIssue{}, ValidatedAt: time.Now().UTC(), ExamID: examID}
	if EffectiveProviderKey(exam.ProviderKey, exam.ExamType) == ProviderSAT {
		if exam.CurrentDraftVersionID == nil {
			rep.Errors = append(rep.Errors, ValidationIssue{Field: "contentSnapshot", Message: "Draft content is missing. Save a draft before publishing."})
			rep.CanPublish = false
			return rep, nil
		}
		rep.DraftVersionID = exam.CurrentDraftVersionID
		issues, err := satpublish.ValidateDraft(ctx, s.db, *exam.CurrentDraftVersionID)
		if err != nil {
			return ValidationReport{}, err
		}
		for _, issue := range issues {
			rep.Errors = append(rep.Errors, ValidationIssue{Field: issue.Path, Message: issue.Message})
		}
		rep.CanPublish = len(rep.Errors) == 0
		return rep, nil
	}
	if strings.TrimSpace(exam.Title) == "" {
		rep.Errors = append(rep.Errors, ValidationIssue{Field: "title", Message: "Exam title is required."})
	}
	if exam.CurrentDraftVersionID == nil {
		rep.Errors = append(rep.Errors, ValidationIssue{Field: "contentSnapshot", Message: "Draft content is missing. Save a draft before publishing."})
		rep.CanPublish = len(rep.Errors) == 0
		return rep, nil
	}
	rep.DraftVersionID = exam.CurrentDraftVersionID
	var content, config sql.NullString
	if err := s.db.QueryRowContext(ctx, "SELECT CAST(content_snapshot AS CHAR), CAST(config_snapshot AS CHAR) FROM exam_versions WHERE id = ?", *exam.CurrentDraftVersionID).Scan(&content, &config); err != nil {
		if err == sql.ErrNoRows {
			rep.Errors = append(rep.Errors, ValidationIssue{Field: "contentSnapshot", Message: "Draft content is missing. Save a draft before publishing."})
			rep.CanPublish = false
			return rep, nil
		}
		return ValidationReport{}, err
	}
	contentStr := strings.TrimSpace(nullStr(content))
	configStr := strings.TrimSpace(nullStr(config))
	if isMissingSnapshot(contentStr) {
		rep.Errors = append(rep.Errors, ValidationIssue{Field: "contentSnapshot", Message: "Draft content is missing. Save a draft before publishing."})
	} else if isEmptySnapshot(contentStr) {
		rep.Errors = append(rep.Errors, ValidationIssue{Field: "contentSnapshot", Message: "Draft content is empty. Save question content before publishing."})
	}
	if isMissingSnapshot(configStr) {
		rep.Errors = append(rep.Errors, ValidationIssue{Field: "configSnapshot", Message: "Draft configuration is missing. Save a draft before publishing."})
	} else if isEmptySnapshot(configStr) {
		rep.Errors = append(rep.Errors, ValidationIssue{Field: "configSnapshot", Message: "Draft configuration is empty. Save delivery configuration before publishing."})
	}
	if !isEmptySnapshot(contentStr) && !isEmptySnapshot(configStr) {
		rep.Errors = append(rep.Errors, validateContentShape(contentStr, configStr, EffectiveProviderKey(exam.ProviderKey, exam.ExamType))...)
	}
	rep.CanPublish = len(rep.Errors) == 0
	return rep, nil
}

// ListVersions returns every version for an exam, newest first.
func (s *Service) ListVersions(ctx context.Context, examID string) ([]Version, error) {
	rows, err := s.db.QueryContext(ctx, "SELECT id, exam_id, version_number, parent_version_id, CAST(content_snapshot AS CHAR), CAST(config_snapshot AS CHAR), CAST(validation_snapshot AS CHAR), created_by, publish_notes, is_draft, is_published, revision, created_at FROM exam_versions WHERE exam_id = ? ORDER BY version_number DESC, created_at DESC", examID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Version
	for rows.Next() {
		v, err := scanVersion(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

// validateContentShape checks section keys in content.config against the
// provider allowlist: unknown sections are errors (mirrors validate_exam_content
// structural gate; SAT blueprint depth lives in authoring).
func validateContentShape(contentStr, configStr, providerKey string) []ValidationIssue {
	var issues []ValidationIssue
	var content map[string]any
	if err := json.Unmarshal([]byte(contentStr), &content); err != nil {
		return []ValidationIssue{{Field: "contentSnapshot", Message: "Draft content is not valid JSON."}}
	}
	_ = configStr
	sections, ok := content["sections"]
	if !ok {
		return issues
	}
	arr, ok := sections.([]any)
	if !ok {
		return []ValidationIssue{{Field: "contentSnapshot.sections", Message: "Draft sections must be a list."}}
	}
	for i, item := range arr {
		m, ok := item.(map[string]any)
		if !ok {
			continue
		}
		key, _ := m["key"].(string)
		if strings.TrimSpace(key) == "" {
			key, _ = m["sectionKey"].(string)
		}
		if strings.TrimSpace(key) == "" {
			issues = append(issues, ValidationIssue{Field: fmt.Sprintf("contentSnapshot.sections[%d]", i), Message: "Section key is required."})
			continue
		}
		if !ValidSectionKey(providerKey, key) {
			issues = append(issues, ValidationIssue{Field: fmt.Sprintf("contentSnapshot.sections[%d]", i), Message: fmt.Sprintf("Section %q is not part of the %s provider blueprint.", key, NormalizeProviderKey(providerKey))})
		}
	}
	return issues
}

// VersionSummary is the light ExamVersionSummary projection: row identity plus
// validation snapshot, without the heavy content/config snapshots.
// It mirrors BuilderService::list_version_summaries (auth lives in handlers).
type VersionSummary struct {
	ID            string          `json:"id"`
	ExamID        string          `json:"examId"`
	VersionNumber int             `json:"versionNumber"`
	ParentVersion *string         `json:"parentVersionId,omitempty"`
	Validation    json.RawMessage `json:"validationSnapshot,omitempty"`
	CreatedBy     string          `json:"createdBy"`
	CreatedAt     time.Time       `json:"createdAt"`
	PublishNotes  *string         `json:"publishNotes,omitempty"`
	IsDraft       bool            `json:"isDraft"`
	IsPublished   bool            `json:"isPublished"`
}

// ListVersionSummaries returns the light summary rows for an exam, newest
// first (mirrors list_version_summaries: exam_id = ? ORDER BY created_at DESC).
func (s *Service) ListVersionSummaries(ctx context.Context, examID string) ([]VersionSummary, error) {
	rows, err := s.db.QueryContext(ctx, "SELECT id, exam_id, version_number, parent_version_id, CAST(validation_snapshot AS CHAR), created_by, created_at, publish_notes, is_draft, is_published FROM exam_versions WHERE exam_id = ? ORDER BY created_at DESC", examID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []VersionSummary
	for rows.Next() {
		var v VersionSummary
		var parent, validation, notes sql.NullString
		if err := rows.Scan(&v.ID, &v.ExamID, &v.VersionNumber, &parent, &validation, &v.CreatedBy, &v.CreatedAt, &notes, &v.IsDraft, &v.IsPublished); err != nil {
			return nil, err
		}
		if parent.Valid {
			p := parent.String
			v.ParentVersion = &p
		}
		if validation.Valid && strings.TrimSpace(validation.String) != "" && strings.TrimSpace(validation.String) != "null" {
			v.Validation = json.RawMessage(validation.String)
		}
		if notes.Valid {
			n := notes.String
			v.PublishNotes = &n
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

func loadVersion(ctx context.Context, q tx.Tx, id string) (Version, error) {
	row := q.QueryRowContext(ctx, "SELECT id, exam_id, version_number, parent_version_id, CAST(content_snapshot AS CHAR), CAST(config_snapshot AS CHAR), CAST(validation_snapshot AS CHAR), created_by, publish_notes, is_draft, is_published, revision, created_at FROM exam_versions WHERE id = ?", id)
	return scanVersion(row)
}

func scanVersion(row interface {
	Scan(dest ...any) error
}) (Version, error) {
	var v Version
	var parent sql.NullString
	var content, config, validation sql.NullString
	var notes sql.NullString
	if err := row.Scan(&v.ID, &v.ExamID, &v.VersionNumber, &parent, &content, &config, &validation, &v.CreatedBy, &notes, &v.IsDraft, &v.IsPublished, &v.Revision, &v.CreatedAt); err != nil {
		return Version{}, err
	}
	if parent.Valid {
		p := parent.String
		v.ParentVersion = &p
	}
	if content.Valid && strings.TrimSpace(content.String) != "" {
		v.Content = json.RawMessage(content.String)
	}
	if config.Valid && strings.TrimSpace(config.String) != "" {
		v.Config = json.RawMessage(config.String)
	}
	if validation.Valid && strings.TrimSpace(validation.String) != "" && strings.TrimSpace(validation.String) != "null" {
		v.Validation = json.RawMessage(validation.String)
	}
	if notes.Valid {
		n := notes.String
		v.PublishNotes = &n
	}
	return v, nil
}

func firstNonEmpty(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

func nullableString(n sql.NullString) any {
	if !n.Valid {
		return nil
	}
	return n.String
}

func nullableStrPtr(p *string) any {
	if p == nil {
		return nil
	}
	return *p
}

func nullStr(n sql.NullString) string {
	if !n.Valid {
		return ""
	}
	return n.String
}

func bytesTrim(b json.RawMessage) []byte {
	return []byte(strings.TrimSpace(string(b)))
}

// isMissingSnapshot reports absent snapshots: empty or null (any case /
// whitespace). isEmptySnapshot widens that to placeholder empties ({} and
// [] plus variants) so both Publish and GetValidation reject them. Publish
// and GetValidation share them so an empty object can never seal or gate as
// publishable.
func isMissingSnapshot(s string) bool {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "", "null":
		return true
	}
	return false
}

// isEmptySnapshot reports missing/placeholder snapshots: empty, null,
// {} / [], or whitespace/case variants of those. Publish and GetValidation
// share it so an empty object can never seal or gate as publishable.
func isEmptySnapshot(s string) bool {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "", "null", "{}", "[]":
		return true
	}
	return false
}

func isDuplicateKey(err error) bool {
	if err == nil {
		return false
	}
	s := strings.ToLower(err.Error())
	return strings.Contains(s, "duplicate") && (strings.Contains(s, "entry") || strings.Contains(s, "unique") || strings.Contains(s, "1062"))
}
