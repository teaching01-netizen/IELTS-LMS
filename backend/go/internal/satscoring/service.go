// Package satscoring owns the global SAT score-conversion policy
// (docs/scoreconverimplement.md): immutable published revisions, editable
// drafts, one atomically activated pointer, an append-only audit, and the
// read-time overlay that resolves every released SAT result against the
// active revision.
//
// Invariants (plan §2):
//   - INV-1 a published revision's content never changes; its sha256 is
//     verified whenever it is loaded.
//   - INV-2 the pointer references a published revision; revision numbers
//     are strictly increasing, allocated under the pointer lock.
//   - INV-5 publish requires the draft's base to equal the active revision.
//   - INV-6 nothing here writes results, module attempts or answers.
package satscoring

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/telemetry"
	"example.com/ielts-proctoring/internal/platform/tx"
	"example.com/ielts-proctoring/internal/satconvert"
)

// Statuses.
const (
	StatusDraft     = "draft"
	StatusPublished = "published"
)

// Audit actions.
const (
	ActionDraftCreated  = "draft_created"
	ActionDraftRestored = "draft_restored"
	ActionDraftSaved    = "draft_saved"
	ActionPublished     = "published"
)

// Error codes beyond the shared apperrors vocabulary.
const (
	CodeStaleBase          apperrors.Code = "STALE_BASE"
	CodePreconditionFailed apperrors.Code = "PRECONDITION_FAILED"
	CodeNotDraft           apperrors.Code = "NOT_A_DRAFT"
	CodeSuperseded         apperrors.Code = "REVISION_SUPERSEDED"
)

const (
	maxCalibrationSourceLen = 500
	maxNoteLen              = 1000
	maxRevisionListLen      = 200
	maxContentBytes         = 1 << 20
	revisionCacheCapacity   = 16
)

// ErrIntegrity means a published revision's stored content no longer matches
// its checksum (or cannot be parsed). Callers fail closed: no score.
var ErrIntegrity = errors.New("satscoring: published revision failed its integrity check")

// Revision is one policy snapshot.
type Revision struct {
	ID                string              `json:"id"`
	RevisionNumber    *int                `json:"revisionNumber"`
	Status            string              `json:"status"`
	BaseRevisionID    *string             `json:"baseRevisionId"`
	Content           *satconvert.Content `json:"content,omitempty"`
	ContentSHA256     *string             `json:"contentSha256"`
	CalibrationSource string              `json:"calibrationSource"`
	Note              string              `json:"note"`
	RestoredFromID    *string             `json:"restoredFromId"`
	Version           int                 `json:"version"`
	CreatedBy         string              `json:"createdBy"`
	CreatedAt         time.Time           `json:"createdAt"`
	UpdatedAt         time.Time           `json:"updatedAt"`
	PublishedAt       *time.Time          `json:"publishedAt"`
	PublishedBy       *string             `json:"publishedBy"`
	Active            bool                `json:"active"`
}

// Queryer is the read boundary shared by *sql.DB and tx.Tx.
type Queryer interface {
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
}

// Service is the policy store.
type Service struct {
	db  *sql.DB
	run *tx.Runner
}

// NewService wires the store. run may be nil in read-only tests.
func NewService(db *sql.DB, run *tx.Runner) *Service {
	if run == nil && db != nil {
		run = tx.NewRunner(db)
	}
	return &Service{db: db, run: run}
}

func notFound(what string) error {
	return apperrors.New(apperrors.CodeNotFound, what+" not found.")
}

func conflict(code apperrors.Code, msg string) error {
	return &apperrors.Error{Code: code, Message: msg, HTTPStatus: 409}
}

func validationError(msg string, errs, warns []satconvert.Issue) error {
	details := map[string]any{"errors": nonNil(errs), "warnings": nonNil(warns)}
	return &apperrors.Error{Code: apperrors.CodeValidation, Message: msg, Details: details, HTTPStatus: 422}
}

func nonNil(in []satconvert.Issue) []satconvert.Issue {
	if in == nil {
		return []satconvert.Issue{}
	}
	return in
}

// ---- revision cache (immutable, keyed by id) ----

var cache = struct {
	sync.Mutex
	byID  map[string]*Revision
	order []string
}{byID: map[string]*Revision{}}

func cacheGet(id string) *Revision {
	cache.Lock()
	defer cache.Unlock()
	return cache.byID[id]
}

func cachePut(rev *Revision) {
	cache.Lock()
	defer cache.Unlock()
	if _, ok := cache.byID[rev.ID]; ok {
		return
	}
	if len(cache.order) >= revisionCacheCapacity {
		delete(cache.byID, cache.order[0])
		cache.order = cache.order[1:]
	}
	cache.byID[rev.ID] = rev
	cache.order = append(cache.order, rev.ID)
}

// ResetCacheForTest clears the immutable-revision cache.
func ResetCacheForTest() {
	cache.Lock()
	defer cache.Unlock()
	cache.byID = map[string]*Revision{}
	cache.order = nil
}

// ---- reads ----

const revisionCols = "id, revision_number, status, base_revision_id, CAST(content AS CHAR), content_sha256, calibration_source, note, restored_from_id, version, created_by, created_at, updated_at, published_at, published_by"

type rowScanner interface{ Scan(dest ...any) error }

func scanRevision(row rowScanner, withContent bool) (*Revision, error) {
	var (
		rev                        Revision
		number                     sql.NullInt64
		base, sha, restored, pubBy sql.NullString
		content                    sql.NullString
		published                  sql.NullTime
	)
	if err := row.Scan(&rev.ID, &number, &rev.Status, &base, &content, &sha, &rev.CalibrationSource, &rev.Note, &restored,
		&rev.Version, &rev.CreatedBy, &rev.CreatedAt, &rev.UpdatedAt, &published, &pubBy); err != nil {
		return nil, err
	}
	if number.Valid {
		n := int(number.Int64)
		rev.RevisionNumber = &n
	}
	rev.BaseRevisionID = nullStr(base)
	rev.ContentSHA256 = nullStr(sha)
	rev.RestoredFromID = nullStr(restored)
	rev.PublishedBy = nullStr(pubBy)
	if published.Valid {
		t := published.Time.UTC()
		rev.PublishedAt = &t
	}
	rev.CreatedAt, rev.UpdatedAt = rev.CreatedAt.UTC(), rev.UpdatedAt.UTC()
	if withContent {
		c, err := satconvert.ParseContent([]byte(content.String))
		if err != nil {
			if rev.Status == StatusPublished {
				return nil, fmt.Errorf("%w: %v", ErrIntegrity, err)
			}
			return nil, err
		}
		if rev.Status == StatusPublished {
			sum, err := c.Checksum()
			if err != nil || rev.ContentSHA256 == nil || sum != *rev.ContentSHA256 {
				return nil, ErrIntegrity
			}
		}
		rev.Content = c
	}
	return &rev, nil
}

func nullStr(s sql.NullString) *string {
	if !s.Valid {
		return nil
	}
	v := s.String
	return &v
}

// activeID reads the pointer (one primary-key read).
func activeID(ctx context.Context, q Queryer) (*string, error) {
	var id sql.NullString
	err := q.QueryRowContext(ctx, "SELECT revision_id FROM sat_score_conversion_active WHERE id = 1").Scan(&id)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return nullStr(id), nil
}

// ActiveRevision returns the active policy with parsed, checksum-verified
// content, or (nil, nil) when none is active. A corrupted revision returns
// ErrIntegrity. Published revisions are immutable, so they are cached by id;
// only the pointer is read every call, so every instance agrees immediately.
func (s *Service) ActiveRevision(ctx context.Context, q Queryer) (*Revision, error) {
	return ActiveRevision(ctx, q)
}

// ActiveRevision is the package-level form used by read paths that have a
// Queryer but no Service.
func ActiveRevision(ctx context.Context, q Queryer) (*Revision, error) {
	id, err := activeID(ctx, q)
	if err != nil || id == nil {
		return nil, err
	}
	if rev := cacheGet(*id); rev != nil {
		return rev, nil
	}
	rev, err := scanRevision(q.QueryRowContext(ctx, "SELECT "+revisionCols+" FROM sat_score_conversion_revisions WHERE id = ? AND status = 'published'", *id), true)
	if err == sql.ErrNoRows {
		return nil, ErrIntegrity
	}
	if err != nil {
		return nil, err
	}
	rev.Active = true
	cachePut(rev)
	return rev, nil
}

// GetRevision returns one revision with content.
func (s *Service) GetRevision(ctx context.Context, id string) (*Revision, error) {
	rev, err := scanRevision(s.db.QueryRowContext(ctx, "SELECT "+revisionCols+" FROM sat_score_conversion_revisions WHERE id = ?", id), true)
	if err == sql.ErrNoRows {
		return nil, notFound("Revision")
	}
	if err != nil {
		return nil, err
	}
	active, err := activeID(ctx, s.db)
	if err != nil {
		return nil, err
	}
	rev.Active = active != nil && *active == rev.ID
	return rev, nil
}

func (s *Service) list(ctx context.Context, where, order string) ([]Revision, error) {
	active, err := activeID(ctx, s.db)
	if err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx, fmt.Sprintf("SELECT %s FROM sat_score_conversion_revisions WHERE %s ORDER BY %s LIMIT %d", revisionCols, where, order, maxRevisionListLen))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Revision{}
	for rows.Next() {
		rev, err := scanRevision(rows, false)
		if err != nil {
			return nil, err
		}
		rev.Active = active != nil && *active == rev.ID
		out = append(out, *rev)
	}
	return out, rows.Err()
}

// ListRevisions returns published revisions, newest first, without content.
func (s *Service) ListRevisions(ctx context.Context) ([]Revision, error) {
	return s.list(ctx, "status = 'published'", "revision_number DESC")
}

// ListDrafts returns drafts, most recently edited first, without content.
func (s *Service) ListDrafts(ctx context.Context) ([]Revision, error) {
	return s.list(ctx, "status = 'draft'", "updated_at DESC, id")
}

// ---- writes ----

func insertAudit(ctx context.Context, q tx.Tx, actorID, action string, revisionID, fromID *string, requestID string, detail map[string]any) error {
	var detailJSON any
	if detail != nil {
		b, err := json.Marshal(detail)
		if err != nil {
			return err
		}
		detailJSON = string(b)
	}
	_, err := q.ExecContext(ctx, "INSERT INTO sat_score_conversion_audit (id, actor_id, action, revision_id, from_revision_id, request_id, detail) VALUES (?, ?, ?, ?, ?, ?, ?)",
		uuid.NewString(), actorID, action, revisionID, fromID, truncate(requestID, 128), detailJSON)
	return err
}

func truncate(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}

// CreateDraft copies fromRevisionID (default: the active revision, else an
// empty skeleton) into a new draft based on the current active revision.
func (s *Service) CreateDraft(ctx context.Context, actorID, requestID string, fromRevisionID *string) (*Revision, error) {
	var out *Revision
	err := s.run.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		active, err := activeID(ctx, q)
		if err != nil {
			return err
		}
		sourceID := active
		if fromRevisionID != nil && strings.TrimSpace(*fromRevisionID) != "" {
			sourceID = fromRevisionID
		}
		content := satconvert.EmptyContent()
		calibration, note := "", ""
		if sourceID != nil {
			src, err := scanRevision(q.QueryRowContext(ctx, "SELECT "+revisionCols+" FROM sat_score_conversion_revisions WHERE id = ?", *sourceID), true)
			if err == sql.ErrNoRows {
				return notFound("Revision")
			}
			if err != nil {
				return err
			}
			content, calibration = src.Content, src.CalibrationSource
		}
		raw, err := content.Canonical()
		if err != nil {
			return err
		}
		id := uuid.NewString()
		var restored *string
		action := ActionDraftCreated
		if fromRevisionID != nil && strings.TrimSpace(*fromRevisionID) != "" {
			restored, action = fromRevisionID, ActionDraftRestored
		}
		if _, err := q.ExecContext(ctx, "INSERT INTO sat_score_conversion_revisions (id, status, base_revision_id, content, calibration_source, note, restored_from_id, created_by) VALUES (?, 'draft', ?, ?, ?, ?, ?, ?)",
			id, active, string(raw), calibration, note, restored, actorID); err != nil {
			return err
		}
		if err := insertAudit(ctx, q, actorID, action, &id, sourceID, requestID, nil); err != nil {
			return err
		}
		out, err = scanRevision(q.QueryRowContext(ctx, "SELECT "+revisionCols+" FROM sat_score_conversion_revisions WHERE id = ?", id), true)
		return err
	})
	return out, err
}

// SaveDraft replaces a draft's content and metadata under an optimistic lock.
// Incomplete cells (null) are saved; malformed structure is rejected.
func (s *Service) SaveDraft(ctx context.Context, actorID, requestID, id string, expectedVersion int, content json.RawMessage, calibrationSource, note string) (*Revision, error) {
	if len(content) > maxContentBytes {
		return nil, &apperrors.Error{Code: apperrors.CodePayloadTooLarge, Message: "Score conversion content is too large.", HTTPStatus: 413}
	}
	if len(calibrationSource) > maxCalibrationSourceLen || len(note) > maxNoteLen {
		return nil, apperrors.New(apperrors.CodeValidation, fmt.Sprintf("calibrationSource must be at most %d and note at most %d characters.", maxCalibrationSourceLen, maxNoteLen))
	}
	parsed, err := satconvert.ParseContent(content)
	if err != nil {
		return nil, apperrors.New(apperrors.CodeValidation, err.Error())
	}
	canonical, err := parsed.Canonical()
	if err != nil {
		return nil, err
	}
	var out *Revision
	err = s.run.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		var status string
		var version int
		err := q.QueryRowContext(ctx, "SELECT status, version FROM sat_score_conversion_revisions WHERE id = ? FOR UPDATE", id).Scan(&status, &version)
		if err == sql.ErrNoRows {
			return notFound("Draft")
		}
		if err != nil {
			return err
		}
		if status != StatusDraft {
			return conflict(CodeNotDraft, "Published revisions are immutable; create a new draft instead.")
		}
		if version != expectedVersion {
			return &apperrors.Error{Code: CodePreconditionFailed, Message: "The draft changed since you loaded it. Reload to see the latest version.", HTTPStatus: 412,
				Details: map[string]any{"currentVersion": version}}
		}
		if _, err := q.ExecContext(ctx, "UPDATE sat_score_conversion_revisions SET content = ?, calibration_source = ?, note = ?, version = version + 1 WHERE id = ? AND status = 'draft'",
			string(canonical), calibrationSource, note, id); err != nil {
			return err
		}
		if err := insertAudit(ctx, q, actorID, ActionDraftSaved, &id, nil, requestID, map[string]any{"version": version + 1}); err != nil {
			return err
		}
		out, err = scanRevision(q.QueryRowContext(ctx, "SELECT "+revisionCols+" FROM sat_score_conversion_revisions WHERE id = ?", id), true)
		return err
	})
	return out, err
}

// Validate reports the errors and warnings of any stored revision.
func (s *Service) Validate(ctx context.Context, id string) (errs, warns []satconvert.Issue, err error) {
	rev, err := s.GetRevision(ctx, id)
	if err != nil {
		return nil, nil, err
	}
	errs, warns = rev.Content.PublishIssues(rev.CalibrationSource)
	return nonNil(errs), nonNil(warns), nil
}

// PublishResult is the outcome of Publish.
type PublishResult struct {
	Revision      *Revision `json:"revision"`
	AlreadyActive bool      `json:"alreadyActive"`
}

// Publish makes a draft the active revision in one transaction (plan §4).
func (s *Service) Publish(ctx context.Context, actorID, requestID, id string) (*PublishResult, error) {
	var result *PublishResult
	outcome := "error"
	err := s.run.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		// The pointer row is the global publish lock: concurrent publishes
		// serialize here, and revision numbers are allocated under it.
		var activeRev sql.NullString
		if err := q.QueryRowContext(ctx, "SELECT revision_id FROM sat_score_conversion_active WHERE id = 1 FOR UPDATE").Scan(&activeRev); err != nil {
			return err
		}
		var status string
		var base sql.NullString
		var raw, calibration string
		err := q.QueryRowContext(ctx, "SELECT status, base_revision_id, CAST(content AS CHAR), calibration_source FROM sat_score_conversion_revisions WHERE id = ? FOR UPDATE", id).Scan(&status, &base, &raw, &calibration)
		if err == sql.ErrNoRows {
			outcome = "not_found"
			return notFound("Draft")
		}
		if err != nil {
			return err
		}
		if status == StatusPublished {
			if activeRev.Valid && activeRev.String == id {
				rev, err := loadActiveForResult(ctx, q, id)
				if err != nil {
					return err
				}
				result, outcome = &PublishResult{Revision: rev, AlreadyActive: true}, "already_active"
				return nil
			}
			outcome = "conflict"
			return conflict(CodeSuperseded, "This revision was superseded by a later activation. Restore it as a new draft to activate it again.")
		}
		if base.Valid != activeRev.Valid || (base.Valid && base.String != activeRev.String) {
			outcome = "stale_base"
			return conflict(CodeStaleBase, "Another administrator published a newer revision after this draft was created. Create a new draft from the active revision and re-apply your edits.")
		}
		content, err := satconvert.ParseContent([]byte(raw))
		if err != nil {
			outcome = "invalid"
			return apperrors.New(apperrors.CodeValidation, err.Error())
		}
		if errs, warns := content.PublishIssues(calibration); len(errs) > 0 {
			outcome = "invalid"
			return validationError("The score conversion has errors and cannot be published.", errs, warns)
		}
		canonical, err := content.Canonical()
		if err != nil {
			return err
		}
		sum, err := content.Checksum()
		if err != nil {
			return err
		}
		var next int
		if err := q.QueryRowContext(ctx, "SELECT COALESCE(MAX(revision_number), 0) + 1 FROM sat_score_conversion_revisions").Scan(&next); err != nil {
			return err
		}
		res, err := q.ExecContext(ctx, "UPDATE sat_score_conversion_revisions SET status = 'published', revision_number = ?, content = ?, content_sha256 = ?, published_at = UTC_TIMESTAMP(6), published_by = ?, version = version + 1 WHERE id = ? AND status = 'draft'",
			next, string(canonical), sum, actorID, id)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n != 1 {
			return conflict(apperrors.CodeConflict, "The draft could not be published.")
		}
		if _, err := q.ExecContext(ctx, "UPDATE sat_score_conversion_active SET revision_id = ?, activated_at = UTC_TIMESTAMP(6), activated_by = ? WHERE id = 1", id, actorID); err != nil {
			return err
		}
		var from *string
		if activeRev.Valid {
			from = &activeRev.String
		}
		if err := insertAudit(ctx, q, actorID, ActionPublished, &id, from, requestID, map[string]any{"revisionNumber": next, "contentSha256": sum}); err != nil {
			return err
		}
		rev, err := loadActiveForResult(ctx, q, id)
		if err != nil {
			return err
		}
		result, outcome = &PublishResult{Revision: rev}, "published"
		return nil
	})
	telemetry.IncCounter(telemetry.MSATScoreConversionPublishTotal, "outcome", outcome)
	if err == nil && result != nil && result.Revision.RevisionNumber != nil {
		telemetry.SetGauge(telemetry.MSATScoreConversionActiveRev, float64(*result.Revision.RevisionNumber))
	}
	return result, err
}

func loadActiveForResult(ctx context.Context, q tx.Tx, id string) (*Revision, error) {
	rev, err := scanRevision(q.QueryRowContext(ctx, "SELECT "+revisionCols+" FROM sat_score_conversion_revisions WHERE id = ?", id), true)
	if err != nil {
		return nil, err
	}
	rev.Active = true
	return rev, nil
}

// LookupResult is one resolved preview lookup.
type LookupResult struct {
	Status string            `json:"status"`
	Scaled *satconvert.Score `json:"scaled,omitempty"`
	Reason string            `json:"reason,omitempty"`
}

// Lookup resolves one section/topology/raw triple against a stored revision.
// For standalone topologies m1 is ignored and m2 is the module's raw score.
func (s *Service) Lookup(ctx context.Context, revisionID, section string, topo satconvert.Topology, m1 int, m2 *int, m1Ops, m2Ops *int) (*LookupResult, error) {
	rev, err := s.GetRevision(ctx, revisionID)
	if err != nil {
		return nil, err
	}
	return LookupContent(rev.Content, section, topo, m1, m2, m1Ops, m2Ops), nil
}

// LookupContent resolves against in-memory content. When the operational
// counts are omitted they default to the selected table's own dimensions, so
// the preview can answer "what does this cell convert to".
func LookupContent(c *satconvert.Content, section string, topo satconvert.Topology, m1 int, m2 *int, m1Ops, m2Ops *int) *LookupResult {
	unavailable := func(reason string) *LookupResult { return &LookupResult{Status: "unavailable", Reason: reason} }
	sec := c.Sections[section]
	if sec == nil || len(sec.Assign[string(topo)]) == 0 {
		return unavailable("No table is assigned to this route.")
	}
	second := 0
	if m2 != nil {
		second = *m2
	}
	// Default the counts to the first assigned table's own dimensions.
	t := sec.Tables[sec.Assign[string(topo)][0]]
	if t == nil {
		return unavailable("The assigned table does not exist.")
	}
	a, b := t.M1Operational, t.M2Operational
	if t.Kind == satconvert.KindModule2 {
		a, b = 0, t.Operational
	}
	if m1Ops != nil {
		a = *m1Ops
	}
	if m2Ops != nil {
		b = *m2Ops
	}
	if score, ok := c.Resolve(section, topo, m1, a, second, b); ok {
		return &LookupResult{Status: "converted", Scaled: &score}
	}
	return unavailable("No score is defined for these raw scores and question counts.")
}
