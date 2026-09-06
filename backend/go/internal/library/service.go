// Package library owns thin explicit-SQL content-library intents.
//
// It mirrors backend/crates/application/src/library.rs: passage CRUD,
// question-bank CRUD, exam defaults get/update, and grading export
// profile listing over passage_library_items, question_bank_items,
// admin_default_profiles, and grading_export_profiles. Authorization is
// scope-checked at the application layer: platform actors see shared
// (NULL-org) plus tenant rows; tenant actors see their org plus shared
// rows; writes require a tenant org or platform scope. Updates carry a
// revision fence (409 on mismatch).
package library

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"

	"github.com/google/uuid"

	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/tx"
)

// DefaultListLimit bounds library list responses.
const DefaultListLimit = 100

// Service wires library transitions explicitly.
type Service struct {
	db     *sql.DB
	runner *tx.Runner
}

// NewService wires dependencies explicitly.
func NewService(db *sql.DB, runner *tx.Runner) *Service {
	return &Service{db: db, runner: runner}
}

// Passage is the passage_library_items row projection.
type Passage struct {
	ID                   string          `json:"id"`
	OrganizationID       *string         `json:"organizationId"`
	Title                string          `json:"title"`
	PassageSnapshot      json.RawMessage `json:"passageSnapshot"`
	Difficulty           string          `json:"difficulty"`
	Topic                string          `json:"topic"`
	Tags                 json.RawMessage `json:"tags"`
	WordCount            *int            `json:"wordCount,omitempty"`
	EstimatedTimeMinutes *int            `json:"estimatedTimeMinutes,omitempty"`
	UsageCount           int             `json:"usageCount"`
	CreatedBy            string          `json:"createdBy"`
	CreatedAt            sql.NullTime    `json:"createdAt"`
	UpdatedAt            sql.NullTime    `json:"updatedAt"`
	Revision             int             `json:"revision"`
}

// QuestionItem is the question_bank_items row projection.
type QuestionItem struct {
	ID             string          `json:"id"`
	OrganizationID *string         `json:"organizationId"`
	QuestionType   string          `json:"questionType"`
	BlockSnapshot  json.RawMessage `json:"blockSnapshot"`
	Difficulty     string          `json:"difficulty"`
	Topic          string          `json:"topic"`
	Tags           json.RawMessage `json:"tags"`
	UsageCount     int             `json:"usageCount"`
	CreatedBy      string          `json:"createdBy"`
	CreatedAt      sql.NullTime    `json:"createdAt"`
	UpdatedAt      sql.NullTime    `json:"updatedAt"`
	Revision       int             `json:"revision"`
}

// ExamDefaults is the admin_default_profiles row projection.
type ExamDefaults struct {
	ID             string          `json:"id"`
	OrganizationID *string         `json:"organizationId"`
	ProfileName    string          `json:"profileName"`
	ConfigSnapshot json.RawMessage `json:"configSnapshot"`
	IsActive       bool            `json:"isActive"`
	CreatedBy      string          `json:"createdBy"`
	Revision       int             `json:"revision"`
}

// ExportProfile is the grading_export_profiles row projection.
type ExportProfile struct {
	ID             string          `json:"id"`
	OrganizationID *string         `json:"organizationId"`
	ProfileName    string          `json:"profileName"`
	ConfigSnapshot json.RawMessage `json:"configSnapshot"`
	CreatedBy      string          `json:"createdBy"`
	Revision       int             `json:"revision"`
}

// CreatePassageRequest mirrors CreatePassageRequest.
type CreatePassageRequest struct {
	Title                string
	PassageSnapshot      json.RawMessage
	Difficulty           string
	Topic                string
	Tags                 json.RawMessage
	WordCount            *int
	EstimatedTimeMinutes *int
}

// UpdatePassageRequest mirrors UpdatePassageRequest (revision fenced).
type UpdatePassageRequest struct {
	Title                *string
	PassageSnapshot      json.RawMessage
	Difficulty           *string
	Topic                *string
	Tags                 json.RawMessage
	WordCount            *int
	EstimatedTimeMinutes *int
	Revision             int
}

// CreateQuestionRequest mirrors CreateQuestionRequest.
type CreateQuestionRequest struct {
	QuestionType  string
	BlockSnapshot json.RawMessage
	Difficulty    string
	Topic         string
	Tags          json.RawMessage
}

// UpdateQuestionRequest mirrors UpdateQuestionRequest (revision fenced).
type UpdateQuestionRequest struct {
	QuestionType  *string
	BlockSnapshot json.RawMessage
	Difficulty    *string
	Topic         *string
	Tags          json.RawMessage
	Revision      int
}

// UpdateDefaultsRequest mirrors UpdateExamDefaultsRequest.
type UpdateDefaultsRequest struct {
	ProfileName    *string
	ConfigSnapshot json.RawMessage
}

// ListFilter narrows library lists.
type ListFilter struct {
	Difficulty *string
	Topic      *string
	Type       *string
	Limit      int
}

func listLimit(limit int) int {
	if limit < 1 {
		return DefaultListLimit
	}
	if limit > 500 {
		return 500
	}
	return limit
}

func validDifficulty(d string) bool {
	switch d {
	case "easy", "medium", "hard":
		return true
	}
	return false
}

func requireWritableOrg(actor auth.ActorContext) (*string, *apperrors.Error) {
	if actor.Role == auth.RoleAdmin {
		return actor.OrgID, nil
	}
	if actor.OrgID != nil && *actor.OrgID != "" {
		return actor.OrgID, nil
	}
	return nil, &apperrors.Error{Code: apperrors.CodeNotFound, Message: "Library item not found.", HTTPStatus: 404}
}

func scanPassage(rows *sql.Rows) (Passage, error) {
	var p Passage
	var org sql.NullString
	var snap, tags []byte
	var wc, etm sql.NullInt64
	if err := rows.Scan(&p.ID, &org, &p.Title, &snap, &p.Difficulty, &p.Topic, &tags, &wc, &etm, &p.UsageCount, &p.CreatedBy, &p.CreatedAt, &p.UpdatedAt, &p.Revision); err != nil {
		return p, err
	}
	if org.Valid {
		v := org.String
		p.OrganizationID = &v
	}
	p.PassageSnapshot = append(json.RawMessage(nil), snap...)
	p.Tags = append(json.RawMessage(nil), tags...)
	if wc.Valid {
		v := int(wc.Int64)
		p.WordCount = &v
	}
	if etm.Valid {
		v := int(etm.Int64)
		p.EstimatedTimeMinutes = &v
	}
	return p, nil
}

func scanQuestion(rows *sql.Rows) (QuestionItem, error) {
	var q QuestionItem
	var org sql.NullString
	var snap, tags []byte
	if err := rows.Scan(&q.ID, &org, &q.QuestionType, &snap, &q.Difficulty, &q.Topic, &tags, &q.UsageCount, &q.CreatedBy, &q.CreatedAt, &q.UpdatedAt, &q.Revision); err != nil {
		return q, err
	}
	if org.Valid {
		v := org.String
		q.OrganizationID = &v
	}
	q.BlockSnapshot = append(json.RawMessage(nil), snap...)
	q.Tags = append(json.RawMessage(nil), tags...)
	return q, nil
}

func scanQuestionRow(row interface {
	Scan(dest ...any) error
}) (QuestionItem, error) {
	var q QuestionItem
	var org sql.NullString
	var snap, tags []byte
	if err := row.Scan(&q.ID, &org, &q.QuestionType, &snap, &q.Difficulty, &q.Topic, &tags, &q.UsageCount, &q.CreatedBy, &q.CreatedAt, &q.UpdatedAt, &q.Revision); err != nil {
		return q, err
	}
	if org.Valid {
		v := org.String
		q.OrganizationID = &v
	}
	q.BlockSnapshot = append(json.RawMessage(nil), snap...)
	q.Tags = append(json.RawMessage(nil), tags...)
	return q, nil
}

const passageCols = "id, organization_id, title, passage_snapshot, difficulty, topic, tags, word_count, estimated_time_minutes, usage_count, created_by, created_at, updated_at, revision"
const questionCols = "id, organization_id, question_type, block_snapshot, difficulty, topic, tags, usage_count, created_by, created_at, updated_at, revision"

// readScopeClause appends the tenant read scope: platform actors see all,
// tenant actors see their org plus shared (NULL-org) rows, others see none.
func readScopeClause(actor auth.ActorContext, args []any) (string, []any) {
	if actor.IsPlatformWrite() || actor.IsPlatformRead() {
		return "", args
	}
	if actor.OrgID != nil && *actor.OrgID != "" {
		return " AND (organization_id = ? OR organization_id IS NULL)", append(args, *actor.OrgID)
	}
	return " AND 1 = 0", args
}

// ensureWritableResource rejects writes to foreign-org rows (404, never 403 leak).
func ensureWritableResource(actor auth.ActorContext, resourceOrg *string) *apperrors.Error {
	if actor.IsPlatformWrite() {
		return nil
	}
	if actor.OrgID == nil || *actor.OrgID == "" {
		return &apperrors.Error{Code: apperrors.CodeNotFound, Message: "Library item not found.", HTTPStatus: 404}
	}
	var res string
	if resourceOrg != nil {
		res = *resourceOrg
	}
	if res != *actor.OrgID {
		return &apperrors.Error{Code: apperrors.CodeNotFound, Message: "Library item not found.", HTTPStatus: 404}
	}
	return nil
}

func nullableRaw(b json.RawMessage) any {
	if len(b) == 0 {
		return nil
	}
	return string(b)
}

func nullableStrPtr(s *string) any {
	if s == nil {
		return nil
	}
	return *s
}

func nullableIntPtr(n *int) any {
	if n == nil {
		return nil
	}
	return *n
}

// CreatePassage inserts a passage_library_items row scoped to the writable org.
func (s *Service) CreatePassage(ctx context.Context, actor auth.ActorContext, req CreatePassageRequest) (Passage, error) {
	var zero Passage
	orgID, appErr := requireWritableOrg(actor)
	if appErr != nil {
		return zero, appErr
	}
	if req.Title == "" {
		return zero, apperrors.New(apperrors.CodeBadRequest, "Title is required.")
	}
	if !validDifficulty(req.Difficulty) {
		return zero, apperrors.New(apperrors.CodeBadRequest, "Difficulty must be easy, medium, or hard.")
	}
	wc := 0
	if req.WordCount != nil {
		wc = *req.WordCount
	}
	etm := 0
	if req.EstimatedTimeMinutes != nil {
		etm = *req.EstimatedTimeMinutes
	}
	id := uuid.NewString()
	if _, err := s.db.ExecContext(ctx, "INSERT INTO passage_library_items (id, organization_id, title, passage_snapshot, difficulty, topic, tags, word_count, estimated_time_minutes, usage_count, created_by, created_at, updated_at, revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, NOW(), NOW(), 0)", id, orgID, req.Title, nullableRaw(req.PassageSnapshot), req.Difficulty, req.Topic, nullableRaw(req.Tags), wc, etm, actor.UserID); err != nil {
		return zero, err
	}
	return s.GetPassage(ctx, actor, id)
}

// GetPassage reads one passage within read scope.
func (s *Service) GetPassage(ctx context.Context, actor auth.ActorContext, id string) (Passage, error) {
	var zero Passage
	query := "SELECT " + passageCols + " FROM passage_library_items WHERE id = ?"
	clause, args := readScopeClause(actor, []any{id})
	row := s.db.QueryRowContext(ctx, query+clause, args...)
	p, err := scanPassageRow(row)
	if err == sql.ErrNoRows {
		return zero, apperrors.New(apperrors.CodeNotFound, "Library item not found.")
	}
	return p, err
}

// UpdatePassage patches a passage with revision fencing (409 on mismatch).
func (s *Service) UpdatePassage(ctx context.Context, actor auth.ActorContext, id string, req UpdatePassageRequest) (Passage, error) {
	var zero Passage
	existing, err := s.GetPassage(ctx, actor, id)
	if err != nil {
		return zero, err
	}
	if appErr := ensureWritableResource(actor, existing.OrganizationID); appErr != nil {
		return zero, appErr
	}
	if existing.Revision != req.Revision {
		return zero, &apperrors.Error{Code: apperrors.CodeConflict, Message: "Passage has been modified by another user.", HTTPStatus: 409}
	}
	if req.Difficulty != nil && !validDifficulty(*req.Difficulty) {
		return zero, apperrors.New(apperrors.CodeBadRequest, "Difficulty must be easy, medium, or hard.")
	}
	args := []any{nullableStrPtr(req.Title), nullableRaw(req.PassageSnapshot), nullableStrPtr(req.Difficulty), nullableStrPtr(req.Topic), nullableRaw(req.Tags), nullableIntPtr(req.WordCount), nullableIntPtr(req.EstimatedTimeMinutes), id, existing.Revision}
	if !actor.IsPlatformWrite() {
		args = append(args, *actor.OrgID, *actor.OrgID)
	} else {
		args = append(args, nil, nil)
	}
	res, err := s.db.ExecContext(ctx, "UPDATE passage_library_items SET title = COALESCE(?, title), passage_snapshot = COALESCE(?, passage_snapshot), difficulty = COALESCE(?, difficulty), topic = COALESCE(?, topic), tags = COALESCE(?, tags), word_count = COALESCE(?, word_count), estimated_time_minutes = COALESCE(?, estimated_time_minutes), updated_at = NOW(), revision = revision + 1 WHERE id = ? AND revision = ? AND (? IS NULL OR organization_id = ?)", args...)
	if err != nil {
		return zero, err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return zero, err
	}
	if n != 1 {
		return zero, &apperrors.Error{Code: apperrors.CodeConflict, Message: "Passage has been modified by another user.", HTTPStatus: 409}
	}
	return s.GetPassage(ctx, actor, id)
}

// DeletePassage removes a passage within writable scope. When expectedRevision
// is non-nil the delete is fenced on it (409 on mismatch), mirroring the
// update fence; a nil revision preserves the legacy unfenced behavior.
func (s *Service) DeletePassage(ctx context.Context, actor auth.ActorContext, id string, expectedRevision *int) error {
	existing, err := s.GetPassage(ctx, actor, id)
	if err != nil {
		return err
	}
	if appErr := ensureWritableResource(actor, existing.OrganizationID); appErr != nil {
		return appErr
	}
	if expectedRevision != nil && existing.Revision != *expectedRevision {
		return &apperrors.Error{Code: apperrors.CodeConflict, Message: "Passage has been modified by another user.", HTTPStatus: 409}
	}
	args := []any{id}
	if expectedRevision != nil {
		args = append(args, *expectedRevision)
	}
	if !actor.IsPlatformWrite() {
		args = append(args, *actor.OrgID, *actor.OrgID)
	} else {
		args = append(args, nil, nil)
	}
	query := "DELETE FROM passage_library_items WHERE id = ?"
	if expectedRevision != nil {
		query += " AND revision = ?"
	}
	query += " AND (? IS NULL OR organization_id = ?)"
	res, err := s.db.ExecContext(ctx, query, args...)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		if expectedRevision != nil {
			return &apperrors.Error{Code: apperrors.CodeConflict, Message: "Passage has been modified by another user.", HTTPStatus: 409}
		}
		return apperrors.New(apperrors.CodeNotFound, "Library item not found.")
	}
	return nil
}

// ListPassages lists passages within read scope, newest first.
func (s *Service) ListPassages(ctx context.Context, actor auth.ActorContext, f ListFilter) ([]Passage, error) {
	query := "SELECT " + passageCols + " FROM passage_library_items WHERE 1 = 1"
	clause, args := readScopeClause(actor, nil)
	query += clause
	if f.Difficulty != nil && *f.Difficulty != "" {
		query += " AND difficulty = ?"
		args = append(args, *f.Difficulty)
	}
	if f.Topic != nil && *f.Topic != "" {
		query += " AND topic = ?"
		args = append(args, *f.Topic)
	}
	query += " ORDER BY updated_at DESC, id DESC LIMIT ?"
	args = append(args, listLimit(f.Limit))
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Passage{}
	for rows.Next() {
		p, err := scanPassage(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// IncrementPassageUsage atomically records one library use. Usage is an
// activity counter rather than a content edit, so it does not consume the
// revision fence; shared rows remain usable by tenant-scoped readers.
func (s *Service) IncrementPassageUsage(ctx context.Context, actor auth.ActorContext, id string) (Passage, error) {
	var zero Passage
	if _, err := s.GetPassage(ctx, actor, id); err != nil {
		return zero, err
	}
	clause, args := readScopeClause(actor, []any{id})
	res, err := s.db.ExecContext(ctx, "UPDATE passage_library_items SET usage_count = usage_count + 1, updated_at = NOW() WHERE id = ?"+clause, args...)
	if err != nil {
		return zero, err
	}
	if n, err := res.RowsAffected(); err != nil {
		return zero, err
	} else if n != 1 {
		return zero, apperrors.New(apperrors.CodeNotFound, "Library item not found.")
	}
	return s.GetPassage(ctx, actor, id)
}

// CreateQuestion inserts a question_bank_items row scoped to the writable org.
func (s *Service) CreateQuestion(ctx context.Context, actor auth.ActorContext, req CreateQuestionRequest) (QuestionItem, error) {
	var zero QuestionItem
	orgID, appErr := requireWritableOrg(actor)
	if appErr != nil {
		return zero, appErr
	}
	if req.QuestionType == "" {
		return zero, apperrors.New(apperrors.CodeBadRequest, "Question type is required.")
	}
	if !validDifficulty(req.Difficulty) {
		return zero, apperrors.New(apperrors.CodeBadRequest, "Difficulty must be easy, medium, or hard.")
	}
	id := uuid.NewString()
	if _, err := s.db.ExecContext(ctx, "INSERT INTO question_bank_items (id, organization_id, question_type, block_snapshot, difficulty, topic, tags, usage_count, created_by, created_at, updated_at, revision) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, NOW(), NOW(), 0)", id, orgID, req.QuestionType, nullableRaw(req.BlockSnapshot), req.Difficulty, req.Topic, nullableRaw(req.Tags), actor.UserID); err != nil {
		return zero, err
	}
	return s.GetQuestion(ctx, actor, id)
}

// GetQuestion reads one question within read scope.
func (s *Service) GetQuestion(ctx context.Context, actor auth.ActorContext, id string) (QuestionItem, error) {
	var zero QuestionItem
	query := "SELECT " + questionCols + " FROM question_bank_items WHERE id = ?"
	clause, args := readScopeClause(actor, []any{id})
	row := s.db.QueryRowContext(ctx, query+clause, args...)
	q, err := scanQuestionRow(row)
	if err == sql.ErrNoRows {
		return zero, apperrors.New(apperrors.CodeNotFound, "Library item not found.")
	}
	return q, err
}

// UpdateQuestion patches a question with revision fencing (409 on mismatch).
func (s *Service) UpdateQuestion(ctx context.Context, actor auth.ActorContext, id string, req UpdateQuestionRequest) (QuestionItem, error) {
	var zero QuestionItem
	existing, err := s.GetQuestion(ctx, actor, id)
	if err != nil {
		return zero, err
	}
	if appErr := ensureWritableResource(actor, existing.OrganizationID); appErr != nil {
		return zero, appErr
	}
	if existing.Revision != req.Revision {
		return zero, &apperrors.Error{Code: apperrors.CodeConflict, Message: "Question has been modified by another user.", HTTPStatus: 409}
	}
	if req.Difficulty != nil && !validDifficulty(*req.Difficulty) {
		return zero, apperrors.New(apperrors.CodeBadRequest, "Difficulty must be easy, medium, or hard.")
	}
	args := []any{nullableStrPtr(req.QuestionType), nullableRaw(req.BlockSnapshot), nullableStrPtr(req.Difficulty), nullableStrPtr(req.Topic), nullableRaw(req.Tags), id, existing.Revision}
	if !actor.IsPlatformWrite() {
		args = append(args, *actor.OrgID, *actor.OrgID)
	} else {
		args = append(args, nil, nil)
	}
	res, err := s.db.ExecContext(ctx, "UPDATE question_bank_items SET question_type = COALESCE(?, question_type), block_snapshot = COALESCE(?, block_snapshot), difficulty = COALESCE(?, difficulty), topic = COALESCE(?, topic), tags = COALESCE(?, tags), updated_at = NOW(), revision = revision + 1 WHERE id = ? AND revision = ? AND (? IS NULL OR organization_id = ?)", args...)
	if err != nil {
		return zero, err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return zero, err
	}
	if n != 1 {
		return zero, &apperrors.Error{Code: apperrors.CodeConflict, Message: "Question has been modified by another user.", HTTPStatus: 409}
	}
	return s.GetQuestion(ctx, actor, id)
}

// DeleteQuestion removes a question within writable scope. When expectedRevision
// is non-nil the delete is fenced on it (409 on mismatch), mirroring the
// update fence; a nil revision preserves the legacy unfenced behavior.
func (s *Service) DeleteQuestion(ctx context.Context, actor auth.ActorContext, id string, expectedRevision *int) error {
	existing, err := s.GetQuestion(ctx, actor, id)
	if err != nil {
		return err
	}
	if appErr := ensureWritableResource(actor, existing.OrganizationID); appErr != nil {
		return appErr
	}
	if expectedRevision != nil && existing.Revision != *expectedRevision {
		return &apperrors.Error{Code: apperrors.CodeConflict, Message: "Question has been modified by another user.", HTTPStatus: 409}
	}
	args := []any{id}
	if expectedRevision != nil {
		args = append(args, *expectedRevision)
	}
	if !actor.IsPlatformWrite() {
		args = append(args, *actor.OrgID, *actor.OrgID)
	} else {
		args = append(args, nil, nil)
	}
	query := "DELETE FROM question_bank_items WHERE id = ?"
	if expectedRevision != nil {
		query += " AND revision = ?"
	}
	query += " AND (? IS NULL OR organization_id = ?)"
	res, err := s.db.ExecContext(ctx, query, args...)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		if expectedRevision != nil {
			return &apperrors.Error{Code: apperrors.CodeConflict, Message: "Question has been modified by another user.", HTTPStatus: 409}
		}
		return apperrors.New(apperrors.CodeNotFound, "Library item not found.")
	}
	return nil
}

// ListQuestions lists questions within read scope, newest first.
func (s *Service) ListQuestions(ctx context.Context, actor auth.ActorContext, f ListFilter) ([]QuestionItem, error) {
	query := "SELECT " + questionCols + " FROM question_bank_items WHERE 1 = 1"
	clause, args := readScopeClause(actor, nil)
	query += clause
	if f.Type != nil && *f.Type != "" {
		query += " AND question_type = ?"
		args = append(args, *f.Type)
	}
	if f.Difficulty != nil && *f.Difficulty != "" {
		query += " AND difficulty = ?"
		args = append(args, *f.Difficulty)
	}
	if f.Topic != nil && *f.Topic != "" {
		query += " AND topic = ?"
		args = append(args, *f.Topic)
	}
	query += " ORDER BY updated_at DESC, id DESC LIMIT ?"
	args = append(args, listLimit(f.Limit))
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []QuestionItem{}
	for rows.Next() {
		q, err := scanQuestion(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, q)
	}
	return out, rows.Err()
}

// IncrementQuestionUsage atomically records one question-bank use without
// changing the content revision.
func (s *Service) IncrementQuestionUsage(ctx context.Context, actor auth.ActorContext, id string) (QuestionItem, error) {
	var zero QuestionItem
	if _, err := s.GetQuestion(ctx, actor, id); err != nil {
		return zero, err
	}
	clause, args := readScopeClause(actor, []any{id})
	res, err := s.db.ExecContext(ctx, "UPDATE question_bank_items SET usage_count = usage_count + 1, updated_at = NOW() WHERE id = ?"+clause, args...)
	if err != nil {
		return zero, err
	}
	if n, err := res.RowsAffected(); err != nil {
		return zero, err
	} else if n != 1 {
		return zero, apperrors.New(apperrors.CodeNotFound, "Library item not found.")
	}
	return s.GetQuestion(ctx, actor, id)
}

// ListExportProfiles lists grading_export_profiles within read scope.
func (s *Service) ListExportProfiles(ctx context.Context, actor auth.ActorContext) ([]ExportProfile, error) {
	query := "SELECT id, organization_id, profile_name, config_snapshot, created_by, created_at, updated_at, revision FROM grading_export_profiles WHERE 1 = 1"
	clause, args := readScopeClause(actor, nil)
	rows, err := s.db.QueryContext(ctx, query+clause+" ORDER BY updated_at DESC, id DESC", args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ExportProfile{}
	for rows.Next() {
		var p ExportProfile
		var org sql.NullString
		var snap []byte
		var created, updated sql.NullTime
		if err := rows.Scan(&p.ID, &org, &p.ProfileName, &snap, &p.CreatedBy, &created, &updated, &p.Revision); err != nil {
			return nil, err
		}
		if org.Valid {
			v := org.String
			p.OrganizationID = &v
		}
		p.ConfigSnapshot = append(json.RawMessage(nil), snap...)
		out = append(out, p)
	}
	return out, rows.Err()
}

// CreateExportProfileRequest mirrors CreateGradingExportProfileRequest.
type CreateExportProfileRequest struct {
	ProfileName    string
	ConfigSnapshot json.RawMessage
}

// CreateExportProfile inserts a grading_export_profiles row (name + object snapshot validated).
func (s *Service) CreateExportProfile(ctx context.Context, actor auth.ActorContext, req CreateExportProfileRequest) (ExportProfile, error) {
	var zero ExportProfile
	orgID, appErr := requireWritableOrg(actor)
	if appErr != nil {
		return zero, appErr
	}
	name := strings.TrimSpace(req.ProfileName)
	if name == "" {
		return zero, apperrors.New(apperrors.CodeBadRequest, "Export profile name is required.")
	}
	if len([]rune(name)) > 255 {
		return zero, apperrors.New(apperrors.CodeBadRequest, "Export profile name must be 255 characters or fewer.")
	}
	var probe map[string]any
	if err := json.Unmarshal(req.ConfigSnapshot, &probe); err != nil || probe == nil {
		return zero, apperrors.New(apperrors.CodeBadRequest, "Export profile snapshot must be a JSON object.")
	}
	id := uuid.NewString()
	if _, err := s.db.ExecContext(ctx, "INSERT INTO grading_export_profiles (id, organization_id, profile_name, config_snapshot, created_by, created_at, updated_at, revision) VALUES (?, ?, ?, ?, ?, NOW(), NOW(), 0)", id, orgID, name, string(req.ConfigSnapshot), actor.UserID); err != nil {
		return zero, err
	}
	row := s.db.QueryRowContext(ctx, "SELECT id, organization_id, profile_name, config_snapshot, created_by, created_at, updated_at, revision FROM grading_export_profiles WHERE id = ?", id)
	var p ExportProfile
	var org sql.NullString
	var snap []byte
	var created, updated sql.NullTime
	if err := row.Scan(&p.ID, &org, &p.ProfileName, &snap, &p.CreatedBy, &created, &updated, &p.Revision); err != nil {
		return zero, err
	}
	if org.Valid {
		v := org.String
		p.OrganizationID = &v
	}
	p.ConfigSnapshot = append(json.RawMessage(nil), snap...)
	return p, nil
}

// GetExamDefaults reads the active admin_default_profiles row (tenant-org preferred, shared fallback).
func (s *Service) GetExamDefaults(ctx context.Context, actor auth.ActorContext) (ExamDefaults, error) {
	var zero ExamDefaults
	query := "SELECT id, organization_id, profile_name, config_snapshot, is_active, created_by, revision FROM admin_default_profiles WHERE is_active = true"
	clause, args := readScopeClause(actor, nil)
	row := s.db.QueryRowContext(ctx, query+clause+" ORDER BY organization_id IS NULL ASC, updated_at DESC LIMIT 1", args...)
	var d ExamDefaults
	var org sql.NullString
	var snap []byte
	var active sql.NullBool
	if err := row.Scan(&d.ID, &org, &d.ProfileName, &snap, &active, &d.CreatedBy, &d.Revision); err != nil {
		if err == sql.ErrNoRows {
			return zero, apperrors.New(apperrors.CodeNotFound, "Exam defaults not found.")
		}
		return zero, err
	}
	if org.Valid {
		v := org.String
		d.OrganizationID = &v
	}
	d.ConfigSnapshot = append(json.RawMessage(nil), snap...)
	d.IsActive = active.Valid && active.Bool
	return d, nil
}

// UpdateExamDefaults upserts the writable-org defaults row with revision
// fencing. The read-modify-write runs in one tx with the existing row locked
// (FOR UPDATE), and a code-level guard rejects a second active row for the
// org before insert, since no partial unique index can be added without a
// migration (see summary DDL).
func (s *Service) UpdateExamDefaults(ctx context.Context, actor auth.ActorContext, req UpdateDefaultsRequest, revision int) (ExamDefaults, error) {
	var zero ExamDefaults
	orgID, appErr := requireWritableOrg(actor)
	if appErr != nil {
		return zero, appErr
	}
	var out ExamDefaults
	err := s.runner.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		var existingID string
		var existingRev int
		err := q.QueryRowContext(ctx, "SELECT id, revision FROM admin_default_profiles WHERE is_active = true AND organization_id <=> ? LIMIT 1 FOR UPDATE", orgID).Scan(&existingID, &existingRev)
		if err != nil && err != sql.ErrNoRows {
			return err
		}
		if err == nil {
			if existingRev != revision {
				return &apperrors.Error{Code: apperrors.CodeConflict, Message: "Defaults have been modified by another user.", HTTPStatus: 409}
			}
			res, err := q.ExecContext(ctx, "UPDATE admin_default_profiles SET config_snapshot = ?, updated_at = NOW(), revision = revision + 1 WHERE id = ? AND revision = ?", nullableRaw(req.ConfigSnapshot), existingID, revision)
			if err != nil {
				return err
			}
			n, err := res.RowsAffected()
			if err != nil {
				return err
			}
			if n != 1 {
				return &apperrors.Error{Code: apperrors.CodeConflict, Message: "Defaults have been modified by another user.", HTTPStatus: 409}
			}
			row := q.QueryRowContext(ctx, "SELECT id, organization_id, profile_name, config_snapshot, is_active, created_by, revision FROM admin_default_profiles WHERE id = ?", existingID)
			d, err := scanDefaultsRow(row)
			if err != nil {
				return err
			}
			out = d
			return nil
		}
		var activeCount int
		if err := q.QueryRowContext(ctx, "SELECT COUNT(*) FROM admin_default_profiles WHERE is_active = true AND organization_id <=> ?", orgID).Scan(&activeCount); err != nil {
			return err
		}
		if activeCount != 0 {
			return &apperrors.Error{Code: apperrors.CodeConflict, Message: "Defaults have been modified by another user.", HTTPStatus: 409}
		}
		id := uuid.NewString()
		if _, err := q.ExecContext(ctx, "INSERT INTO admin_default_profiles (id, organization_id, profile_name, config_snapshot, is_active, created_by, created_at, updated_at, revision) VALUES (?, ?, 'Default', ?, true, ?, NOW(), NOW(), 0)", id, orgID, nullableRaw(req.ConfigSnapshot), actor.UserID); err != nil {
			return err
		}
		row := q.QueryRowContext(ctx, "SELECT id, organization_id, profile_name, config_snapshot, is_active, created_by, revision FROM admin_default_profiles WHERE id = ?", id)
		d, err := scanDefaultsRow(row)
		if err != nil {
			return err
		}
		out = d
		return nil
	})
	if err != nil {
		return zero, err
	}
	return out, nil
}

func scanDefaultsRow(row interface {
	Scan(dest ...any) error
}) (ExamDefaults, error) {
	var zero ExamDefaults
	var d ExamDefaults
	var org sql.NullString
	var snap []byte
	var active sql.NullBool
	if err := row.Scan(&d.ID, &org, &d.ProfileName, &snap, &active, &d.CreatedBy, &d.Revision); err != nil {
		return zero, err
	}
	if org.Valid {
		v := org.String
		d.OrganizationID = &v
	}
	d.ConfigSnapshot = append(json.RawMessage(nil), snap...)
	d.IsActive = active.Valid && active.Bool
	return d, nil
}

func scanPassageRow(row interface {
	Scan(dest ...any) error
}) (Passage, error) {
	var p Passage
	var org sql.NullString
	var snap, tags []byte
	var wc, etm sql.NullInt64
	if err := row.Scan(&p.ID, &org, &p.Title, &snap, &p.Difficulty, &p.Topic, &tags, &wc, &etm, &p.UsageCount, &p.CreatedBy, &p.CreatedAt, &p.UpdatedAt, &p.Revision); err != nil {
		return p, err
	}
	if org.Valid {
		v := org.String
		p.OrganizationID = &v
	}
	p.PassageSnapshot = append(json.RawMessage(nil), snap...)
	p.Tags = append(json.RawMessage(nil), tags...)
	if wc.Valid {
		v := int(wc.Int64)
		p.WordCount = &v
	}
	if etm.Valid {
		v := int(etm.Int64)
		p.EstimatedTimeMinutes = &v
	}
	return p, nil
}
