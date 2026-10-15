// Package satrooms owns the SAT one-action "Create room" operation: it
// resolves (reuses or seals) the immutable release a room delivers, creates the
// backing schedule + access link + roster, and records a durable receipt, all
// in ONE transaction. Staff never publish; versioning stays server-side.
//
// Release rules (the exam lifecycle seals the working draft on publish, and a
// draft is only reopened by an explicit edit):
//
//   - A working draft that was cloned from the current published version and
//     has never been touched (exam_versions.revision = 0; every authoring
//     mutation bumps it in the same transaction) is byte-identical to that
//     release, so the room reuses the release and the draft stays open.
//   - Any other working draft is validated and sealed as the next version with
//     the scope the room needs, exactly as POST /exams/{id}/publish would.
//   - With no working draft the current published version is the latest saved
//     exam; the room reuses it when its scope covers the sections requested.
package satrooms

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"

	"example.com/ielts-proctoring/internal/accesslinks"
	"example.com/ielts-proctoring/internal/exams"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/tx"
)

// Service coordinates release resolution and room creation.
type Service struct {
	db          *sql.DB
	runner      *tx.Runner
	exams       *exams.Service
	accessLinks *accesslinks.Service
}

// NewService wires dependencies explicitly.
func NewService(db *sql.DB, runner *tx.Runner, examService *exams.Service, links *accesslinks.Service) *Service {
	return &Service{db: db, runner: runner, exams: examService, accessLinks: links}
}

// Request is the one-action create-room command.
type Request struct {
	// OperationKey is minted once per submission and reused for every retry of
	// that same submission. It scopes the receipt: (actor, key) is unique.
	OperationKey string
	// ExpectedExamRevision fences the exam entity (pointer flips: publish,
	// reopen, metadata). Required for a new operation.
	ExpectedExamRevision *int
	// ExpectedDraftVersionID fences which working draft the client saw. The
	// empty string asserts "no working draft". Required for a new operation.
	ExpectedDraftVersionID *string
	// ExpectedDraftRevision fences the draft content. Required when a draft exists.
	ExpectedDraftRevision *int
	// Room is the room-level configuration (the existing access-link request;
	// PublishedVersionID must be empty: the server chooses the release).
	Room accesslinks.CreateRequest
	// AllowSeal reports that the caller froze co-editing, so a seal is safe.
	// When false and the room would need a seal, CreateRoom fails retriably
	// with EXAM_REVISION_CHANGED instead of sealing unprotected.
	AllowSeal bool
}

// VersionInfo names the immutable release a room is pinned to.
type VersionInfo struct {
	ID     string `json:"id"`
	Number int    `json:"number"`
	Scope  string `json:"scope"`
	// CreatedNow is true when this operation sealed the release.
	CreatedNow bool `json:"createdNow"`
}

// ExamInfo is the exam state after the operation.
type ExamInfo struct {
	Revision int `json:"revision"`
}

// Result is the committed outcome of one operation.
type Result struct {
	Room     accesslinks.AccessLink `json:"room"`
	Version  VersionInfo            `json:"version"`
	Exam     ExamInfo               `json:"exam"`
	Replayed bool                   `json:"-"`
}

const maxOperationKeyLen = 128

// ScopeForSections maps a room's normalized section selection to the release
// scope it needs. Nil/empty means every section.
func ScopeForSections(sections []string) exams.SATPublishScope {
	var rw, math bool
	for _, key := range sections {
		switch key {
		case exams.LinkSectionReadingWriting:
			rw = true
		case exams.LinkSectionMath:
			math = true
		}
	}
	switch {
	case rw && !math:
		return exams.SATPublishScopeReadingWriting
	case math && !rw:
		return exams.SATPublishScopeMath
	default:
		return exams.SATPublishScopeFull
	}
}

// covers reports whether a release sealed with `have` can deliver a room that
// needs `need`. A full release was validated for every section, so it covers
// any narrower room (the room's own section list narrows delivery).
func covers(have string, need exams.SATPublishScope) bool {
	have = strings.TrimSpace(have)
	if have == "" || have == string(exams.SATPublishScopeFull) {
		return true
	}
	return have == string(need)
}

type examState struct {
	provider, examType string
	draftID            sql.NullString
	publishedID        sql.NullString
	revision           int
	sectionScope       string
}

func (st examState) checkScope(need exams.SATPublishScope) error {
	if covers(st.sectionScope, need) {
		return nil
	}
	label := "the configured sections"
	switch st.sectionScope {
	case string(exams.SATPublishScopeReadingWriting):
		label = "Reading & Writing"
	case string(exams.SATPublishScopeMath):
		label = "Math"
	}
	e := apperrors.New(apperrors.CodeExamScopeUnavailable, "This exam includes only "+label+". Choose a room with those sections.")
	e.Details = map[string]any{"examScope": st.sectionScope, "requestedScope": string(need), "currentExamRevision": st.revision}
	return e
}

type draftState struct {
	id       string
	revision int
	// clean: cloned from the current release and never edited.
	clean bool
}

type releaseState struct {
	id     string
	number int
	scope  string
}

type queryRower interface {
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

func loadExam(ctx context.Context, q queryRower, examID string, lock bool) (examState, error) {
	var st examState
	query := "SELECT provider_key, exam_type, current_draft_version_id, current_published_version_id, revision, sat_section_scope FROM exam_entities WHERE id = ?"
	if lock {
		query += " FOR UPDATE"
	}
	err := q.QueryRowContext(ctx, query, examID).Scan(&st.provider, &st.examType, &st.draftID, &st.publishedID, &st.revision, &st.sectionScope)
	if err == sql.ErrNoRows {
		return st, apperrors.New(apperrors.CodeNotFound, "Exam not found.")
	}
	return st, err
}

func loadDraft(ctx context.Context, q queryRower, examID string, st examState, lock bool) (*draftState, error) {
	if !st.draftID.Valid || strings.TrimSpace(st.draftID.String) == "" {
		return nil, nil
	}
	var d draftState
	var parent sql.NullString
	var parentPublished sql.NullBool
	query := "SELECT d.id, d.revision, d.parent_version_id, p.is_published FROM exam_versions d LEFT JOIN exam_versions p ON p.id = d.parent_version_id WHERE d.id = ? AND d.exam_id = ? AND d.is_draft = TRUE"
	if lock {
		query += " FOR UPDATE"
	}
	err := q.QueryRowContext(ctx, query, st.draftID.String, examID).Scan(&d.id, &d.revision, &parent, &parentPublished)
	if err == sql.ErrNoRows {
		return nil, apperrors.New(apperrors.CodeDraftIntegrity, "The exam's working draft is missing.")
	}
	if err != nil {
		return nil, err
	}
	d.clean = d.revision == 0 && parent.Valid && parentPublished.Valid && parentPublished.Bool &&
		st.publishedID.Valid && parent.String == st.publishedID.String
	return &d, nil
}

func loadRelease(ctx context.Context, q queryRower, examID, versionID string) (releaseState, error) {
	var rel releaseState
	var scope sql.NullString
	err := q.QueryRowContext(ctx,
		"SELECT id, version_number, sat_publish_scope FROM exam_versions WHERE id = ? AND exam_id = ? AND is_published = TRUE",
		versionID, examID).Scan(&rel.id, &rel.number, &scope)
	if err == sql.ErrNoRows {
		return rel, apperrors.New(apperrors.CodeDraftIntegrity, "The exam's published version is missing.")
	}
	if err != nil {
		return rel, err
	}
	rel.scope = string(exams.SATPublishScopeFull)
	if scope.Valid && strings.TrimSpace(scope.String) != "" {
		rel.scope = scope.String
	}
	return rel, nil
}

// NeedsSeal reports, without locking, whether creating a room for these
// sections would seal a working draft. The HTTP layer uses it to freeze
// co-editing only when a seal will actually happen.
func (s *Service) NeedsSeal(ctx context.Context, examID string, sections []string) (bool, error) {
	normalized, err := accesslinks.NormalizeEnabledSections(sections)
	if err != nil {
		return false, apperrors.New(apperrors.CodeRoomInvalid, err.Error())
	}
	return s.sealNeeded(ctx, examID, ScopeForSections(normalized))
}

// sealNeeded is the unlocked read of the release decision: true when a working
// draft exists that is either edited or too narrow to deliver `need`.
func (s *Service) sealNeeded(ctx context.Context, examID string, need exams.SATPublishScope) (bool, error) {
	st, err := loadExam(ctx, s.db, examID, false)
	if err != nil {
		return false, err
	}
	if err := st.checkScope(need); err != nil {
		return false, err
	}
	draft, err := loadDraft(ctx, s.db, examID, st, false)
	if err != nil {
		return false, err
	}
	if draft == nil {
		return false, nil
	}
	if !draft.clean {
		return true, nil
	}
	rel, err := loadRelease(ctx, s.db, examID, st.publishedID.String)
	if err != nil {
		return false, err
	}
	return !covers(rel.scope, need), nil
}

func requestHash(examID string, req Request) (string, error) {
	raw, err := json.Marshal(map[string]any{
		"exam":     examID,
		"examRev":  req.ExpectedExamRevision,
		"draft":    req.ExpectedDraftVersionID,
		"draftRev": req.ExpectedDraftRevision,
		"room":     req.Room,
	})
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(raw)
	return fmt.Sprintf("%x", sum[:]), nil
}

func roomInvalid(err error) error {
	var typed *apperrors.Error
	if errors.As(err, &typed) && typed.Code == apperrors.CodeBadRequest {
		return apperrors.New(apperrors.CodeRoomInvalid, typed.Message)
	}
	return err
}

func revisionChanged(msg string, current int) *apperrors.Error {
	e := apperrors.New(apperrors.CodeExamRevisionChanged, msg)
	e.Details = map[string]any{"currentExamRevision": current}
	return e
}

// CreateRoom resolves the release and creates the room atomically.
func (s *Service) CreateRoom(ctx context.Context, actorID, examID string, req Request) (Result, error) {
	var zero Result
	key := strings.TrimSpace(req.OperationKey)
	if key == "" || len(key) > maxOperationKeyLen {
		return zero, apperrors.New(apperrors.CodeRoomInvalid, "operationKey must contain between 1 and 128 characters.")
	}
	if strings.TrimSpace(actorID) == "" {
		return zero, apperrors.New(apperrors.CodeBadRequest, "Created-by actor is required.")
	}
	if req.Room.PublishedVersionID != nil && strings.TrimSpace(*req.Room.PublishedVersionID) != "" {
		return zero, apperrors.New(apperrors.CodeRoomInvalid, "The release is chosen by the server; remove publishedVersionId.")
	}
	hash, err := requestHash(examID, req)
	if err != nil {
		return zero, err
	}
	// Fast replay: a retry of a committed operation never re-runs media checks.
	if receipt, found, err := s.lookupReceipt(ctx, s.db, actorID, key); err != nil {
		return zero, err
	} else if found {
		return s.replay(ctx, receipt, examID, hash)
	}
	if req.ExpectedExamRevision == nil || req.ExpectedDraftVersionID == nil ||
		*req.ExpectedExamRevision < 0 ||
		(strings.TrimSpace(*req.ExpectedDraftVersionID) != "" && req.ExpectedDraftRevision == nil) ||
		(req.ExpectedDraftRevision != nil && *req.ExpectedDraftRevision < 0) {
		return zero, apperrors.New(apperrors.CodeRoomInvalid, "Expected exam and working draft revisions are required; use an empty draft ID when no working draft exists.")
	}
	prepared, err := accesslinks.PrepareCreate(examID, actorID, req.Room)
	if err != nil {
		return zero, roomInvalid(err)
	}

	need := ScopeForSections(prepared.EnabledSections())
	// Media/readiness preflight runs OUTSIDE the transaction (object-store I/O)
	// and is re-fenced under the draft row lock inside it. Nothing to seal
	// means nothing to preflight.
	var pre exams.PublishPreflight
	if sealing, err := s.sealNeeded(ctx, examID, need); err != nil {
		return zero, err
	} else if sealing {
		pre, err = s.exams.PreflightSATPublish(ctx, examID, need)
		if err != nil {
			return zero, s.mapNotReady(ctx, examID, err)
		}
	}

	var out Result
	emission := &exams.PublishEmission{}
	err = s.runner.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		out = Result{}
		claimed, err := claimReceipt(ctx, q, actorID, key, examID, hash)
		if err != nil {
			return err
		}
		if !claimed {
			receipt, found, err := s.lookupReceipt(ctx, q, actorID, key)
			if err != nil {
				return err
			}
			if !found || !receipt.complete() {
				return apperrors.New(apperrors.CodeConflict, "This room is still being created; retry with the same operation key.")
			}
			if receipt.requestHash != hash || receipt.examID != examID {
				return apperrors.New(apperrors.CodeOperationKeyConflict, "This operation key was already used for a different room request; use a new key.")
			}
			out, err = s.recordedResult(ctx, receipt)
			return err
		}

		st, err := loadExam(ctx, q, examID, true)
		if err != nil {
			return err
		}
		if exams.EffectiveProviderKey(st.provider, st.examType) != exams.ProviderSAT {
			return apperrors.New(apperrors.CodeUnsupportedProvider, "One-action rooms are available for SAT exams only.")
		}
		if err := st.checkScope(need); err != nil {
			return err
		}
		if req.ExpectedExamRevision != nil && *req.ExpectedExamRevision != st.revision {
			return revisionChanged("The exam changed after this room was prepared. Review the latest exam and try again.", st.revision)
		}
		draft, err := loadDraft(ctx, q, examID, st, true)
		if err != nil {
			return err
		}
		if req.ExpectedDraftVersionID != nil {
			actual := ""
			if draft != nil {
				actual = draft.id
			}
			if strings.TrimSpace(*req.ExpectedDraftVersionID) != actual {
				return revisionChanged("The working draft changed after this room was prepared. Review the latest exam and try again.", st.revision)
			}
		}
		if req.ExpectedDraftRevision != nil && draft != nil && *req.ExpectedDraftRevision != draft.revision {
			return revisionChanged("The exam content changed after this room was prepared. Review the latest exam and try again.", st.revision)
		}

		var rel releaseState
		createdNow := false
		switch {
		case draft != nil && !draft.clean:
			if !req.AllowSeal {
				return revisionChanged("The exam has unsaved changes that must be captured first. Try again.", st.revision)
			}
			if pre.VersionID != draft.id || pre.Revision != draft.revision {
				return revisionChanged("The exam changed while its checks were running. Try again.", st.revision)
			}
			version, err := s.exams.PublishDraftInTx(ctx, q, actorID, examID, exams.PublishRequest{
				PublishScope:           need,
				Revision:               st.revision,
				ExpectedDraftVersionID: &draft.id,
				ExpectedDraftRevision:  &draft.revision,
				OperationKey:           key,
			}, pre, key, emission)
			if err != nil {
				return s.mapNotReadyIn(st.revision, err)
			}
			rel = releaseState{id: version.ID, number: version.VersionNumber, scope: string(need)}
			createdNow = true
		case st.publishedID.Valid && strings.TrimSpace(st.publishedID.String) != "":
			rel, err = loadRelease(ctx, q, examID, st.publishedID.String)
			if err != nil {
				return err
			}
			if !covers(rel.scope, need) {
				if draft != nil {
					// Clean draft whose parent release is too narrow: seal the
					// (identical) draft with the wider scope. Needs a freeze.
					if !req.AllowSeal {
						return revisionChanged("The exam must be captured for these sections first. Try again.", st.revision)
					}
					if pre.VersionID != draft.id || pre.Revision != draft.revision {
						return revisionChanged("The exam changed while its checks were running. Try again.", st.revision)
					}
					version, err := s.exams.PublishDraftInTx(ctx, q, actorID, examID, exams.PublishRequest{
						PublishScope:           need,
						Revision:               st.revision,
						ExpectedDraftVersionID: &draft.id,
						ExpectedDraftRevision:  &draft.revision,
						OperationKey:           key,
					}, pre, key, emission)
					if err != nil {
						return s.mapNotReadyIn(st.revision, err)
					}
					rel = releaseState{id: version.ID, number: version.VersionNumber, scope: string(need)}
					createdNow = true
					break
				}
				e := apperrors.New(apperrors.CodeExamScopeUnavailable,
					"The saved exam does not include the sections this room needs. Edit the exam once, then create the room.")
				e.Details = map[string]any{"savedScope": rel.scope, "requestedScope": string(need), "currentExamRevision": st.revision}
				return e
			}
		default:
			e := apperrors.New(apperrors.CodeExamNotReady, "The exam has no saved content yet.")
			e.Details = map[string]any{"issues": []map[string]any{{"code": "exam.empty", "path": "exam", "message": "Add questions to the exam before creating a room."}}, "currentExamRevision": st.revision}
			return e
		}

		prepared.PinVersion(rel.id)
		linkID, scheduleID, err := prepared.InsertWithScheduleTx(ctx, q)
		if err != nil {
			return roomInvalid(err)
		}
		var finalRevision int
		if err := q.QueryRowContext(ctx, "SELECT revision FROM exam_entities WHERE id = ?", examID).Scan(&finalRevision); err != nil {
			return err
		}
		link, err := s.accessLinks.GetInTx(ctx, q, linkID)
		if err != nil {
			return err
		}
		out = Result{
			Room:    link,
			Version: VersionInfo{ID: rel.id, Number: rel.number, Scope: rel.scope, CreatedNow: createdNow},
			Exam:    ExamInfo{Revision: finalRevision},
		}
		response, err := json.Marshal(out)
		if err != nil {
			return err
		}
		if _, err := q.ExecContext(ctx,
			"UPDATE sat_room_operations SET access_link_id = ?, schedule_id = ?, version_id = ?, version_number = ?, release_created = ?, exam_revision = ?, response_snapshot = ? WHERE actor_id = ? AND operation_key = ?",
			linkID, scheduleID, rel.id, rel.number, createdNow, finalRevision, string(response), actorID, key); err != nil {
			return err
		}
		return nil
	})
	emission.Flush(err)
	if err != nil {
		return zero, err
	}
	return out, nil
}

func scopeOf(link accesslinks.AccessLink) string {
	return string(link.PublishScope)
}

type receipt struct {
	requestHash   string
	examID        string
	accessLinkID  sql.NullString
	versionID     sql.NullString
	versionNumber sql.NullInt64
	releaseNew    bool
	examRevision  sql.NullInt64
	response      sql.NullString
}

func (r receipt) complete() bool { return r.accessLinkID.Valid }

func (r receipt) versionInfo() VersionInfo {
	return VersionInfo{ID: r.versionID.String, Number: int(r.versionNumber.Int64), CreatedNow: r.releaseNew}
}

func claimReceipt(ctx context.Context, q tx.Tx, actorID, key, examID, hash string) (bool, error) {
	res, err := q.ExecContext(ctx,
		"INSERT IGNORE INTO sat_room_operations (actor_id, operation_key, exam_id, request_hash) VALUES (?, ?, ?, ?)",
		actorID, key, examID, hash)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n == 1, nil
}

func (s *Service) lookupReceipt(ctx context.Context, q queryRower, actorID, key string) (receipt, bool, error) {
	var r receipt
	err := q.QueryRowContext(ctx,
		"SELECT request_hash, exam_id, access_link_id, version_id, version_number, release_created, exam_revision, CAST(response_snapshot AS CHAR) FROM sat_room_operations WHERE actor_id = ? AND operation_key = ?",
		actorID, key).Scan(&r.requestHash, &r.examID, &r.accessLinkID, &r.versionID, &r.versionNumber, &r.releaseNew, &r.examRevision, &r.response)
	if err == sql.ErrNoRows {
		return r, false, nil
	}
	if err != nil {
		return r, false, err
	}
	return r, true, nil
}

func (s *Service) replay(ctx context.Context, r receipt, examID, hash string) (Result, error) {
	var zero Result
	if r.requestHash != hash || r.examID != examID {
		return zero, apperrors.New(apperrors.CodeOperationKeyConflict, "This operation key was already used for a different room request; use a new key.")
	}
	if !r.complete() {
		return zero, apperrors.New(apperrors.CodeConflict, "This room is still being created; retry with the same operation key.")
	}
	return s.recordedResult(ctx, r)
}

func (s *Service) recordedResult(ctx context.Context, r receipt) (Result, error) {
	if r.response.Valid {
		var out Result
		if err := json.Unmarshal([]byte(r.response.String), &out); err != nil {
			return Result{}, err
		}
		out.Replayed = true
		return out, nil
	}
	// Pre-0089 receipts did not retain response fields. Preserve their room
	// identity where possible; a missing live row is uncertainty, not no commit.
	link, err := s.accessLinks.Get(ctx, r.accessLinkID.String)
	if err != nil {
		return Result{}, apperrors.New(apperrors.CodeServiceUnavailable, "The operation committed, but its legacy room response is unavailable. Keep the same operation key.")
	}
	info := r.versionInfo()
	info.Scope = scopeOf(link)
	return Result{Room: link, Version: info, Exam: ExamInfo{Revision: int(r.examRevision.Int64)}, Replayed: true}, nil
}

// GetOperation returns the committed outcome of an operation key for the actor.
func (s *Service) GetOperation(ctx context.Context, actorID, key string) (Result, string, error) {
	var zero Result
	r, found, err := s.lookupReceipt(ctx, s.db, actorID, strings.TrimSpace(key))
	if err != nil {
		return zero, "", err
	}
	if !found || !r.complete() {
		return zero, "", apperrors.New(apperrors.CodeOperationNotFound, "No room was created with this operation key.")
	}
	out, err := s.recordedResult(ctx, r)
	return out, r.examID, err
}

// mapNotReady turns a preflight rejection (media) into EXAM_NOT_READY.
func (s *Service) mapNotReady(ctx context.Context, examID string, err error) error {
	current := 0
	if _, ok := notReadyIssues(err); ok {
		_ = s.db.QueryRowContext(ctx, "SELECT revision FROM exam_entities WHERE id = ?", examID).Scan(&current)
	}
	return s.mapNotReadyIn(current, err)
}

func (s *Service) mapNotReadyIn(currentRevision int, err error) error {
	issues, ok := notReadyIssues(err)
	if !ok {
		return err
	}
	var typed *apperrors.Error
	_ = errors.As(err, &typed)
	e := apperrors.New(apperrors.CodeExamNotReady, "Fix the exam issues before creating a room.")
	e.Details = map[string]any{"issues": issues, "currentExamRevision": currentRevision}
	if typed != nil && typed.Details != nil {
		if code, ok := typed.Details["code"]; ok {
			e.Details["code"] = code
		}
	}
	return e
}

// notReadyIssues extracts the blocking findings from a publish rejection:
// either the full list (blockingIssues) or the media diagnostics (issues).
func notReadyIssues(err error) ([]map[string]any, bool) {
	var typed *apperrors.Error
	if !errors.As(err, &typed) || typed.Code != apperrors.CodeValidation || typed.Details == nil {
		return nil, false
	}
	raw, ok := typed.Details["blockingIssues"]
	if !ok {
		raw, ok = typed.Details["issues"]
	}
	if !ok {
		return nil, false
	}
	encoded, marshalErr := json.Marshal(raw)
	if marshalErr != nil {
		return nil, false
	}
	var decoded []map[string]any
	if json.Unmarshal(encoded, &decoded) != nil || len(decoded) == 0 {
		return nil, false
	}
	out := make([]map[string]any, 0, len(decoded))
	for _, item := range decoded {
		entry := map[string]any{"code": item["code"], "path": item["path"], "message": item["message"]}
		if asset, ok := item["assetId"]; ok {
			entry["assetId"] = asset
		}
		out = append(out, entry)
	}
	return out, true
}

// NewOperationKey is a helper for tests and tools.
func NewOperationKey() string { return uuid.NewString() }
