// Package grading owns the IELTS grading state machine for the Go backend.
//
// States (mirrored from the Rust grading service and the 0008 schema):
// objective auto-grade -> writing review (pending/auto_graded/needs_review/
// in_review/finalized) -> submission grading_status (submitted/in_progress/
// grading_complete/ready_to_release/released/reopened) -> results release
// states (draft/grading_complete/ready_to_release/released/reopened) with
// score overrides and draft checkpoints. Every transition is an explicit,
// locked SQL statement; services hold no package-level state.
package grading

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"
	"time"

	"github.com/google/uuid"

	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/tx"
)

// Submission grading lifecycle.
const (
	SubmissionSubmitted       = "submitted"
	SubmissionInProgress      = "in_progress"
	SubmissionGradingComplete = "grading_complete"
	SubmissionReadyToRelease  = "ready_to_release"
	SubmissionReleased        = "released"
	SubmissionReopened        = "reopened"
)

// Section grading lifecycle.
const (
	SectionPending     = "pending"
	SectionAutoGraded  = "auto_graded"
	SectionNeedsReview = "needs_review"
	SectionInReview    = "in_review"
	SectionFinalized   = "finalized"
	SectionReopened    = "reopened"
)

// Result release lifecycle.
const (
	ReleaseDraft           = "draft"
	ReleaseGradingComplete = "grading_complete"
	ReleaseReady           = "ready_to_release"
	ReleaseReleased        = "released"
	ReleaseReopened        = "reopened"
)

// Service wires grading transitions explicitly.
type Service struct {
	db     *sql.DB
	runner *tx.Runner
}

// NewService wires dependencies explicitly.
func NewService(db *sql.DB, runner *tx.Runner) *Service {
	return &Service{db: db, runner: runner}
}

// ObjectiveResult is one auto-graded objective outcome.
type ObjectiveResult struct {
	QuestionID string  `json:"questionId"`
	Correct    bool    `json:"correct"`
	Points     float64 `json:"points"`
	MaxPoints  float64 `json:"maxPoints"`
}

// GradeObjective auto-scores reading/listening answers against the sealed key,
// honoring schedule-scoped overrides from
// grading_schedule_question_overrides. It persists auto_grading_results on
// each section_submissions row and returns per-question outcomes.
//
// Key precedence per question mirrors the Rust objective pipeline: an explicit
// schedule override wins; otherwise the sealed answer_definition from the
// pinned exam version decides; unanswered or key-less questions score zero.
// A non-empty answer with no matching key is never awarded credit — the prior
// behavior treated any non-empty string as correct, inflating scores that the
// integrity and release gates then trusted.
func (s *Service) GradeObjective(ctx context.Context, submissionID string, answers map[string]any) ([]ObjectiveResult, error) {
	var out []ObjectiveResult
	err := s.runner.WithTxRetry(ctx, 3, func(ctx context.Context, t tx.Tx) error {
		var scheduleID, publishedVersionID string
		if err := t.QueryRowContext(ctx,
			"SELECT schedule_id, published_version_id FROM student_submissions WHERE id = ? FOR UPDATE", submissionID).Scan(&scheduleID, &publishedVersionID); err != nil {
			if err == sql.ErrNoRows {
				return apperrors.New(apperrors.CodeNotFound, "Submission not found.")
			}
			return err
		}
		overrides, err := loadScheduleOverrides(ctx, t, scheduleID)
		if err != nil {
			return err
		}
		expectedVersionID := publishedVersionID
		var src string
		var srcVersion sql.NullString
		if serr := t.QueryRowContext(ctx,
			"SELECT source, version_id FROM grading_schedule_objective_grading_source WHERE schedule_id = ?", scheduleID).Scan(&src, &srcVersion); serr != nil && serr != sql.ErrNoRows {
			return serr
		} else if serr == nil && src == "draft_version" && srcVersion.Valid && strings.TrimSpace(srcVersion.String) != "" {
			expectedVersionID = strings.TrimSpace(srcVersion.String)
		}
		keys, err := loadObjectiveAnswerKey(ctx, t, expectedVersionID)
		if err != nil {
			return err
		}
		rows, err := t.QueryContext(ctx, `
			SELECT id, section, answers FROM section_submissions
			WHERE submission_id = ? AND section IN ('listening','reading','science') FOR UPDATE`, submissionID)
		if err != nil {
			return err
		}
		type sec struct {
			id, name string
			answers  string
		}
		var secs []sec
		for rows.Next() {
			var c sec
			if err := rows.Scan(&c.id, &c.name, &c.answers); err != nil {
				rows.Close()
				return err
			}
			secs = append(secs, c)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}
		for _, c := range secs {
			var stored map[string]any
			_ = json.Unmarshal([]byte(c.answers), &stored)
			merged := map[string]any{}
			for k, v := range stored {
				merged[k] = v
			}
			for k, v := range answers {
				merged[k] = v
			}
			results := scoreObjective(merged, overrides, keys)
			out = append(out, results...)
			autoJSON, _ := json.Marshal(map[string]any{"questions": results})
			if _, err := t.ExecContext(ctx, `
				UPDATE section_submissions
				SET auto_grading_results = ?, grading_status = 'auto_graded'
				WHERE id = ?`, string(autoJSON), c.id); err != nil {
				return err
			}
		}
		return nil
	})
	return out, err
}

// OverrideObjectiveQuestion records a teacher override for one objective
// question and appends a review_events audit row in the same transaction.
func (s *Service) OverrideObjectiveQuestion(ctx context.Context, submissionID, section, questionID string, points float64, teacherID, teacherName string) error {
	if strings.TrimSpace(questionID) == "" || strings.TrimSpace(section) == "" {
		return apperrors.New(apperrors.CodeBadRequest, "Section and question id are required.")
	}
	switch section {
	case "listening", "reading", "science":
	default:
		return apperrors.New(apperrors.CodeBadRequest, "Unknown objective section.")
	}
	if points < 0 || points > 100 {
		return apperrors.New(apperrors.CodeBadRequest, "Override points must be within 0..100.")
	}
	return s.runner.WithTxRetry(ctx, 3, func(ctx context.Context, t tx.Tx) error {
		var subStatus string
		if err := t.QueryRowContext(ctx,
			"SELECT grading_status FROM student_submissions WHERE id = ? FOR UPDATE", submissionID).Scan(&subStatus); err != nil {
			if err == sql.ErrNoRows {
				return apperrors.New(apperrors.CodeNotFound, "Submission not found.")
			}
			return err
		}
		if subStatus == SubmissionReleased {
			return &apperrors.Error{Code: apperrors.CodeConflict, Message: "Released submissions cannot take overrides.", HTTPStatus: 409}
		}
		var sectionID string
		err := t.QueryRowContext(ctx, `
			SELECT id FROM section_submissions
			WHERE submission_id = ? AND section = ? FOR UPDATE`, submissionID, section).Scan(&sectionID)
		if err == sql.ErrNoRows {
			return apperrors.New(apperrors.CodeNotFound, "Section submission not found.")
		}
		if err != nil {
			return err
		}
		if _, err := t.ExecContext(ctx, `
			INSERT INTO review_events
				(id, submission_id, teacher_id, teacher_name, action, section, question_id, payload, created_at)
			VALUES (?, ?, ?, ?, 'score_override', ?, ?, ?, UTC_TIMESTAMP(6))`,
			uuid.NewString(), submissionID, teacherID, teacherName, section, questionID,
			string(mustJSON(map[string]any{"points": points}))); err != nil {
			return err
		}
		// Merge the override into the persisted auto-grading snapshot.
		var autoJSON sql.NullString
		if err := t.QueryRowContext(ctx,
			"SELECT auto_grading_results FROM section_submissions WHERE id = ? FOR UPDATE", sectionID).Scan(&autoJSON); err != nil {
			return err
		}
		snap := map[string]any{}
		if autoJSON.Valid {
			_ = json.Unmarshal([]byte(autoJSON.String), &snap)
		}
		over, _ := snap["overrides"].(map[string]any)
		if over == nil {
			over = map[string]any{}
		}
		over[questionID] = map[string]any{"points": points, "by": teacherID}
		snap["overrides"] = over
		if _, err := t.ExecContext(ctx,
			"UPDATE section_submissions SET auto_grading_results = ? WHERE id = ?",
			string(mustJSON(snap)), sectionID); err != nil {
			return err
		}
		return nil
	})
}

// SaveDraft upserts the teacher review draft checkpoint (idempotent by
// submission_id) and marks the submission in_progress. It delegates to
// SaveDraftWithRevision with no expected revision (first-write wins on
// insert, blind merge on update).
func (s *Service) SaveDraft(ctx context.Context, submissionID, teacherID string, draft map[string]any) error {
	return s.SaveDraftWithRevision(ctx, submissionID, teacherID, draft, nil)
}

// SaveDraftWithRevision persists every draft column the writer supplies
// (section drafts, annotations, drawings, summary, checklist) and fences
// concurrent writers with an optimistic revision compare: when expected is
// non-nil the UPDATE carries AND revision = ? and a zero row count surfaces
// a 409 DRAFT_REVISION_MISMATCH so no save silently discards another
// teacher's columns. A nil expected revision keeps the legacy blind-merge
// behavior for callers without a read-modify-write cycle.
func (s *Service) SaveDraftWithRevision(ctx context.Context, submissionID, teacherID string, draft map[string]any, expected *int) error {
	return s.runner.WithTxRetry(ctx, 3, func(ctx context.Context, t tx.Tx) error {
		var studentID string
		if err := t.QueryRowContext(ctx,
			"SELECT student_id FROM student_submissions WHERE id = ? FOR UPDATE", submissionID).Scan(&studentID); err != nil {
			if err == sql.ErrNoRows {
				return apperrors.New(apperrors.CodeNotFound, "Submission not found.")
			}
			return err
		}
		sectionDrafts := string(mustJSON(draftSectionDrafts(draft)))
		annotations := string(mustJSON(draftField(draft, "annotations", "[]")))
		drawings := string(mustJSON(draftField(draft, "drawings", "[]")))
		summary := string(mustJSON(draftField(draft, "teacherSummary", "{}")))
		checklist := string(mustJSON(draftField(draft, "checklist", "[]")))
		if expected != nil {
			res, err := t.ExecContext(ctx, `
				UPDATE review_drafts
				SET teacher_id = ?, section_drafts = ?, annotations = ?, drawings = ?,
					teacher_summary = ?, checklist = ?, has_unsaved_changes = FALSE,
					revision = revision + 1, updated_at = UTC_TIMESTAMP(6)
				WHERE submission_id = ? AND revision = ?`,
				teacherID, sectionDrafts, annotations, drawings, summary, checklist,
				submissionID, *expected)
			if err != nil {
				return err
			}
			if n, err := res.RowsAffected(); err != nil {
				return err
			} else if n == 0 {
				var have int
				if qerr := t.QueryRowContext(ctx,
					"SELECT revision FROM review_drafts WHERE submission_id = ?", submissionID).Scan(&have); qerr == sql.ErrNoRows {
					// No draft row yet: fall through to the insert below.
				} else if qerr != nil {
					return qerr
				} else {
					return &apperrors.Error{Code: apperrors.CodeConflict, Message: "Review draft was modified by another teacher.", HTTPStatus: 409, Details: map[string]any{"code": "DRAFT_REVISION_MISMATCH", "expectedRevision": *expected, "revision": have}}
				}
			} else {
				if _, err := t.ExecContext(ctx, `
					UPDATE student_submissions SET grading_status = 'in_progress', updated_at = UTC_TIMESTAMP(6)
					WHERE id = ? AND grading_status = 'submitted'`, submissionID); err != nil {
					return err
				}
				return s.appendReviewEvent(ctx, t, submissionID, teacherID, "draft_saved", nil, nil)
			}
		}
		if _, err := t.ExecContext(ctx, `
			INSERT INTO review_drafts
				(id, submission_id, student_id, teacher_id, release_status, section_drafts,
				 annotations, drawings, teacher_summary, checklist, has_unsaved_changes, revision)
			VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, FALSE, 0)
			ON DUPLICATE KEY UPDATE
				teacher_id = VALUES(teacher_id), section_drafts = VALUES(section_drafts),
				annotations = VALUES(annotations), drawings = VALUES(drawings),
				teacher_summary = VALUES(teacher_summary), checklist = VALUES(checklist),
				revision = revision + 1, updated_at = UTC_TIMESTAMP(6)`,
			uuid.NewString(), submissionID, studentID, teacherID,
			sectionDrafts, annotations, drawings, summary, checklist); err != nil {
			return err
		}
		if _, err := t.ExecContext(ctx, `
			UPDATE student_submissions SET grading_status = 'in_progress', updated_at = UTC_TIMESTAMP(6)
			WHERE id = ? AND grading_status = 'submitted'`, submissionID); err != nil {
			return err
		}
		return s.appendReviewEvent(ctx, t, submissionID, teacherID, "draft_saved", nil, nil)
	})
}

// draftSectionDrafts extracts the section-drafts payload from the merged
// writer map: callers either pass section drafts at top level or nest them
// under sectionDrafts (see gradingReviewDraftPutHandler).
func draftSectionDrafts(draft map[string]any) any {
	if draft == nil {
		return map[string]any{}
	}
	if nested, ok := draft["sectionDrafts"]; ok && nested != nil {
		return nested
	}
	out := map[string]any{}
	for k, v := range draft {
		out[k] = v
	}
	delete(out, "annotations")
	delete(out, "drawings")
	delete(out, "teacherSummary")
	delete(out, "checklist")
	return out
}

// draftField pulls one sibling column out of the merged writer map,
// falling back to the parsed JSON default when absent.
func draftField(draft map[string]any, key, defJSON string) any {
	if draft != nil {
		if v, ok := draft[key]; ok && v != nil {
			return v
		}
	}
	var v any
	if err := json.Unmarshal([]byte(defJSON), &v); err != nil {
		return defJSON
	}
	return v
}

// MarkComplete moves submitted|in_progress -> grading_complete.
func (s *Service) MarkComplete(ctx context.Context, submissionID, teacherID string) error {
	return s.transitionSubmission(ctx, submissionID, teacherID, "review_finalized",
		[]string{SubmissionSubmitted, SubmissionInProgress}, SubmissionGradingComplete)
}

// MarkReadyToRelease moves grading_complete -> ready_to_release.
func (s *Service) MarkReadyToRelease(ctx context.Context, submissionID, teacherID string) error {
	return s.transitionSubmission(ctx, submissionID, teacherID, "mark_ready_to_release",
		[]string{SubmissionGradingComplete}, SubmissionReadyToRelease)
}

// ReleaseNow moves ready_to_release -> released and materializes a new
// student_results snapshot. Result creation belongs to this transition (the
// ready state is only a gate), matching the Rust release contract and keeping
// direct release and scheduled release on the same snapshot model.
func (s *Service) ReleaseNow(ctx context.Context, submissionID, teacherID string) error {
	return s.runner.WithTxRetry(ctx, 3, func(ctx context.Context, t tx.Tx) error {
		var studentID, studentName, scheduleID, publishedVersionID, status string
		if err := t.QueryRowContext(ctx,
			"SELECT student_id, student_name, schedule_id, published_version_id, grading_status FROM student_submissions WHERE id = ? FOR UPDATE", submissionID).Scan(
			&studentID, &studentName, &scheduleID, &publishedVersionID, &status); err != nil {
			if err == sql.ErrNoRows {
				return apperrors.New(apperrors.CodeNotFound, "Submission not found.")
			}
			return err
		}
		if status != SubmissionReadyToRelease {
			return &apperrors.Error{Code: apperrors.CodeConflict, Message: "Only ready_to_release submissions can be released.", HTTPStatus: 409}
		}
		var releaseStatus string
		var sectionDrafts, annotations, drawings, teacherSummary sql.NullString
		if err := t.QueryRowContext(ctx, `
			SELECT release_status, section_drafts, annotations, drawings, teacher_summary
			FROM review_drafts WHERE submission_id = ? FOR UPDATE`, submissionID).Scan(
			&releaseStatus, &sectionDrafts, &annotations, &drawings, &teacherSummary); err != nil {
			if err == sql.ErrNoRows {
				return apperrors.New(apperrors.CodeNotFound, "Review draft not found.")
			}
			return err
		}
		if releaseStatus != ReleaseReady {
			return &apperrors.Error{Code: apperrors.CodeConflict, Message: "Cannot release result from " + releaseStatus + " state.", HTTPStatus: 409}
		}
		if err := lockObjectiveIntegrityForSubmission(ctx, t, submissionID, scheduleID, publishedVersionID); err != nil {
			return err
		}
		now, err := dbNow(ctx, t)
		if err != nil {
			return err
		}
		draft := map[string]any{}
		if sectionDrafts.Valid && strings.TrimSpace(sectionDrafts.String) != "" {
			if err := json.Unmarshal([]byte(sectionDrafts.String), &draft); err != nil {
				return &apperrors.Error{Code: apperrors.CodeConflict, Message: "Review draft is invalid.", HTTPStatus: 409}
			}
		}
		sectionBands := buildSectionBands(draft)
		overallBand := averageBand(sectionBands)
		writingJSON, err := buildWritingResults(ctx, t, submissionID, draft, annotations.String, drawings.String)
		if err != nil {
			return err
		}
		summaryJSON := "{}"
		if teacherSummary.Valid && strings.TrimSpace(teacherSummary.String) != "" {
			summaryJSON = teacherSummary.String
		}
		var previousResultID sql.NullString
		var previousVersion sql.NullInt64
		if err := t.QueryRowContext(ctx,
			"SELECT id, version FROM student_results WHERE submission_id = ? ORDER BY updated_at DESC LIMIT 1 FOR UPDATE",
			submissionID).Scan(&previousResultID, &previousVersion); err != nil && err != sql.ErrNoRows {
			return err
		}
		version := 1
		var previousID any
		if previousResultID.Valid {
			previousID = previousResultID.String
			if previousVersion.Valid {
				version = int(previousVersion.Int64) + 1
			}
		}
		resultID := uuid.NewString()
		if _, err := t.ExecContext(ctx, `
			INSERT INTO student_results (
				id, submission_id, student_id, student_name, release_status, released_at,
				released_by, overall_band, section_bands, writing_results, teacher_summary,
				version, previous_version_id, authorized_actor_id, created_at, updated_at
			)
			VALUES (?, ?, ?, ?, 'released', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			resultID, submissionID, studentID, studentName, now, teacherID,
			overallBand, string(mustJSON(sectionBands)), writingJSON, summaryJSON,
			version, previousID, teacherID, now, now); err != nil {
			return err
		}
		if _, err := t.ExecContext(ctx,
			"UPDATE review_drafts SET release_status = 'released', has_unsaved_changes = FALSE, updated_at = ?, revision = revision + 1 WHERE submission_id = ?", now, submissionID); err != nil {
			return err
		}
		if _, err := t.ExecContext(ctx,
			"UPDATE student_submissions SET grading_status = 'released', updated_at = ? WHERE id = ?", now, submissionID); err != nil {
			return err
		}
		if _, err := t.ExecContext(ctx, `
			INSERT INTO release_events
				(id, result_id, submission_id, actor_id, action, payload, created_at)
			VALUES (?, ?, ?, ?, 'released', '{}', ?)`,
			uuid.NewString(), resultID, submissionID, teacherID, now); err != nil {
			return err
		}
		return s.appendReviewEvent(ctx, t, submissionID, teacherID, "release_now", strPtr(SubmissionReadyToRelease), strPtr(SubmissionReleased))
	})
}

// ScheduleRelease pins a future release timestamp for a ready_to_release
// review draft. It adapts the Rust grading schedule_release flow: a draft
// ready_to_release pre-check plus a FOR UPDATE recheck, an objective-grading
// integrity lock, a section-band snapshot, a result upsert carrying
// scheduled_release_date (UPDATE when an unreleased result exists, INSERT
// with a version bump otherwise), draft + submission flips to
// ready_to_release, and a scheduled release_events row — all in one
// retryable transaction. Like its Rust counterpart it writes no
// review_events audit row; the scheduled release_events row is the record.
func (s *Service) ScheduleRelease(ctx context.Context, submissionID, teacherID string, releaseAt time.Time) error {
	if releaseAt.IsZero() {
		return apperrors.New(apperrors.CodeBadRequest, "releaseAt is required.")
	}
	return s.runner.WithTxRetry(ctx, 3, func(ctx context.Context, t tx.Tx) error {
		now, _ := dbNow(ctx, t)
		// Timestamps more than an hour stale can only come from a stale
		// client clock or replay; the draft-state gates below stay
		// authoritative. The hour grace keeps Tell-don't-ask callers with
		// skewed clocks on the state-conflict path.
		if !releaseAt.After(now.Add(-time.Hour)) {
			return &apperrors.Error{Code: apperrors.CodeBadRequest, Message: "releaseAt must be in the future.", HTTPStatus: 400}
		}
		var studentID, studentName, scheduleID, publishedVersionID, subStatus string
		if err := t.QueryRowContext(ctx,
			"SELECT student_id, student_name, schedule_id, published_version_id, grading_status FROM student_submissions WHERE id = ? FOR UPDATE",
			submissionID).Scan(&studentID, &studentName, &scheduleID, &publishedVersionID, &subStatus); err != nil {
			if err == sql.ErrNoRows {
				return apperrors.New(apperrors.CodeNotFound, "Submission not found.")
			}
			return err
		}
		if subStatus != SubmissionGradingComplete && subStatus != SubmissionReadyToRelease {
			return &apperrors.Error{Code: apperrors.CodeConflict, Message: "Only grading_complete submissions can be scheduled for release.", HTTPStatus: 409}
		}
		// Pre-check outside the row lock: only ready_to_release drafts schedule.
		var preStatus string
		if err := t.QueryRowContext(ctx,
			"SELECT release_status FROM review_drafts WHERE submission_id = ?", submissionID).Scan(&preStatus); err != nil {
			if err == sql.ErrNoRows {
				return apperrors.New(apperrors.CodeNotFound, "Review draft not found.")
			}
			return err
		}
		if preStatus != ReleaseReady {
			return scheduleReleaseConflict(preStatus)
		}
		// FOR UPDATE recheck under the lock, pulling the snapshot payload.
		var lockedStatus string
		var sectionDrafts, annotations, drawings, teacherSummary sql.NullString
		if err := t.QueryRowContext(ctx,
			`SELECT release_status, section_drafts, annotations, drawings, teacher_summary
			FROM review_drafts WHERE submission_id = ? FOR UPDATE`, submissionID).Scan(
			&lockedStatus, &sectionDrafts, &annotations, &drawings, &teacherSummary); err != nil {
			if err == sql.ErrNoRows {
				return apperrors.New(apperrors.CodeNotFound, "Review draft not found.")
			}
			return err
		}
		if lockedStatus != ReleaseReady {
			return scheduleReleaseConflict(lockedStatus)
		}
		if err := lockObjectiveIntegrityForSubmission(ctx, t, submissionID, scheduleID, publishedVersionID); err != nil {
			return err
		}
		now, err := dbNow(ctx, t)
		if err != nil {
			return err
		}
		draft := map[string]any{}
		if sectionDrafts.Valid && strings.TrimSpace(sectionDrafts.String) != "" {
			_ = json.Unmarshal([]byte(sectionDrafts.String), &draft)
		}
		bands := buildSectionBands(draft)
		overall := averageBand(bands)
		bandsJSON := string(mustJSON(bands))
		summaryJSON := "{}"
		if teacherSummary.Valid && strings.TrimSpace(teacherSummary.String) != "" {
			summaryJSON = teacherSummary.String
		}
		writingJSON, err := buildWritingResults(ctx, t, submissionID, draft, annotations.String, drawings.String)
		if err != nil {
			return err
		}
		// Existing-result lookup: an unreleased row is refreshed in place,
		// otherwise a new versioned row chains previous_version_id.
		var existingID, existingStatus string
		var existingVersion int
		lookupErr := t.QueryRowContext(ctx,
			"SELECT id, release_status, version FROM student_results WHERE submission_id = ? ORDER BY updated_at DESC LIMIT 1 FOR UPDATE",
			submissionID).Scan(&existingID, &existingStatus, &existingVersion)
		if lookupErr != nil && lookupErr != sql.ErrNoRows {
			return lookupErr
		}
		resultID := ""
		if lookupErr == nil && existingStatus != ReleaseReleased {
			if _, err := t.ExecContext(ctx, `
				UPDATE student_results
				SET release_status = 'ready_to_release', released_at = NULL, released_by = NULL,
					scheduled_release_date = ?, overall_band = ?, section_bands = ?,
					writing_results = ?, teacher_summary = ?, updated_at = ?
				WHERE id = ?`,
				releaseAt.UTC(), overall, bandsJSON, writingJSON, summaryJSON, now, existingID); err != nil {
				return err
			}
			resultID = existingID
		} else {
			version := 1
			var previousVersionID any
			if lookupErr == nil {
				version = existingVersion + 1
				previousVersionID = existingID
			}
			resultID = uuid.NewString()
			if _, err := t.ExecContext(ctx, `
				INSERT INTO student_results
					(id, submission_id, student_id, student_name, release_status,
					 scheduled_release_date, overall_band, section_bands, writing_results,
					 teacher_summary, version, previous_version_id, authorized_actor_id)
				VALUES (?, ?, ?, ?, 'ready_to_release', ?, ?, ?, ?, ?, ?, ?, ?)`,
				resultID, submissionID, studentID, studentName,
				releaseAt.UTC(), overall, bandsJSON, writingJSON, summaryJSON,
				version, previousVersionID, teacherID); err != nil {
				return err
			}
		}
		if _, err := t.ExecContext(ctx,
			"UPDATE review_drafts SET release_status = 'ready_to_release', has_unsaved_changes = FALSE, updated_at = UTC_TIMESTAMP(6), revision = revision + 1 WHERE submission_id = ?",
			submissionID); err != nil {
			return err
		}
		if _, err := t.ExecContext(ctx,
			"UPDATE student_submissions SET grading_status = 'ready_to_release', updated_at = ? WHERE id = ?", now, submissionID); err != nil {
			return err
		}
		payload := string(mustJSON(map[string]any{
			"overallBand":          overall,
			"scheduledReleaseDate": releaseAt.UTC().Format(time.RFC3339),
			"teacherName":          "", // actor display name is unavailable in the service; mirrors Rust.
		}))
		if _, err := t.ExecContext(ctx, `
			INSERT INTO release_events
				(id, result_id, submission_id, actor_id, action, payload, created_at)
			VALUES (?, ?, ?, ?, 'scheduled', ?, UTC_TIMESTAMP(6))`,
			uuid.NewString(), resultID, submissionID, teacherID, payload); err != nil {
			return err
		}
		return nil
	})
}

func scheduleReleaseConflict(status string) error {
	return &apperrors.Error{Code: apperrors.CodeConflict, Message: "Cannot schedule release from " + status + " state.", HTTPStatus: 409}
}

// ReopenReview moves released|ready_to_release|grading_complete -> reopened
// on both the submission and its result rows.
func (s *Service) ReopenReview(ctx context.Context, submissionID, teacherID, reason string) error {
	return s.runner.WithTxRetry(ctx, 3, func(ctx context.Context, t tx.Tx) error {
		var status string
		if err := t.QueryRowContext(ctx,
			"SELECT grading_status FROM student_submissions WHERE id = ? FOR UPDATE", submissionID).Scan(&status); err != nil {
			if err == sql.ErrNoRows {
				return apperrors.New(apperrors.CodeNotFound, "Submission not found.")
			}
			return err
		}
		switch status {
		case SubmissionReleased, SubmissionReadyToRelease, SubmissionGradingComplete:
		default:
			return &apperrors.Error{Code: apperrors.CodeConflict, Message: "Only finalized submissions can be reopened.", HTTPStatus: 409}
		}
		now, _ := dbNow(ctx, t)
		if _, err := t.ExecContext(ctx,
			"UPDATE student_submissions SET grading_status = 'reopened', updated_at = ? WHERE id = ?", now, submissionID); err != nil {
			return err
		}
		if _, err := t.ExecContext(ctx,
			"UPDATE student_results SET release_status = 'reopened', revision_reason = ?, updated_at = ? WHERE submission_id = ?",
			reason, now, submissionID); err != nil {
			return err
		}
		if _, err := t.ExecContext(ctx, `
			UPDATE review_drafts
			SET release_status = 'reopened', has_unsaved_changes = FALSE,
				updated_at = ?, revision = revision + 1
			WHERE submission_id = ?`, now, submissionID); err != nil {
			return err
		}
		return s.appendReviewEvent(ctx, t, submissionID, teacherID, "review_reopened", strPtr(status), strPtr(SubmissionReopened))
	})
}

// Export builds the caller-owned result payload for download. Profiles come
// from grading_export_profiles: the profile row is resolved in-DB and its
// organization must own each submission's schedule, and non-platform callers
// additionally need a live staff assignment on that schedule. Unknown
// profiles, cross-org ids, and unassigned schedules simply yield no rows
// instead of leaking data.
func (s *Service) Export(ctx context.Context, actor auth.ActorContext, submissionIDs []string, profileID string) ([]map[string]any, error) {
	if len(submissionIDs) == 0 {
		return nil, apperrors.New(apperrors.CodeBadRequest, "At least one submission id is required.")
	}
	if len(submissionIDs) > 1000 {
		return nil, apperrors.New(apperrors.CodeBadRequest, "Export batch is limited to 1000 submissions.")
	}
	placeholders := strings.Repeat("?,", len(submissionIDs))
	placeholders = strings.TrimSuffix(placeholders, ",")
	query := `SELECT sub.id, sub.student_id, sub.student_name, sub.grading_status, sub.section_statuses
		FROM student_submissions sub
		JOIN exam_schedules sch ON sch.id = sub.schedule_id
		JOIN grading_export_profiles prof ON prof.id = ?
			AND (prof.organization_id IS NULL OR prof.organization_id = sch.organization_id)
		WHERE sub.id IN (` + placeholders + `)`
	args := make([]any, 0, len(submissionIDs)+2)
	args = append(args, profileID)
	for _, id := range submissionIDs {
		args = append(args, id)
	}
	if !actor.IsPlatformRead() {
		query += " AND EXISTS (SELECT 1 FROM schedule_staff_assignments assignment WHERE assignment.schedule_id = sub.schedule_id AND assignment.user_id = ? AND assignment.revoked_at IS NULL)"
		args = append(args, actor.UserID)
	}
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id, studentID, studentName, status, sections string
		if err := rows.Scan(&id, &studentID, &studentName, &status, &sections); err != nil {
			return nil, err
		}
		var secVal any
		_ = json.Unmarshal([]byte(sections), &secVal)
		out = append(out, map[string]any{
			"submissionId": id, "studentId": studentID, "studentName": studentName,
			"gradingStatus": status, "sections": secVal, "exportProfileId": profileID,
		})
	}
	return out, rows.Err()
}

// GradingSourceResponse mirrors the Rust ObjectiveGradingSourceResponse wire
// shape (camelCase): the schedule's active draft grading-source version.
type GradingSourceResponse struct {
	DraftVersionID *string `json:"draftVersionId"`
}

// GradingSourceVersionID loads the schedule's active objective-grading
// source version. It mirrors Rust
// load_schedule_objective_grading_source_version_id: SELECT source,
// version_id FROM grading_schedule_objective_grading_source WHERE
// schedule_id=? and returns the version only when source=draft_version;
// a missing row, any other source, or a blank version yields nil.
func (s *Service) GradingSourceVersionID(ctx context.Context, scheduleID string) (*string, error) {
	return loadScheduleObjectiveGradingSourceVersionID(ctx, s.db, scheduleID)
}

func loadScheduleObjectiveGradingSourceVersionID(ctx context.Context, db *sql.DB, scheduleID string) (*string, error) {
	var source string
	var versionID sql.NullString
	err := db.QueryRowContext(ctx,
		"SELECT source, version_id FROM grading_schedule_objective_grading_source WHERE schedule_id = ?",
		scheduleID).Scan(&source, &versionID)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if source != "draft_version" {
		return nil, nil
	}
	if !versionID.Valid || strings.TrimSpace(versionID.String) == "" {
		return nil, nil
	}
	trimmed := strings.TrimSpace(versionID.String)
	return &trimmed, nil
}

// Objective integrity roll-up states (mirrored from the Rust
// ObjectiveIntegrityStatus snake_case wire values).
const (
	integrityVerified     = "verified"
	integrityNeedsRecheck = "needs_recheck"
	integrityInvalid      = "invalid"
)

// ObjectiveIntegrityIssue mirrors the Rust ObjectiveIntegrityIssueSummary
// wire shape (camelCase counts, snake_case code). QuestionID and
// QuestionNumber stay null for section-level issues, matching Rust Option
// serialization.
type ObjectiveIntegrityIssue struct {
	SubmissionID   string  `json:"submissionId"`
	StudentID      string  `json:"studentId"`
	StudentName    string  `json:"studentName"`
	Section        string  `json:"section"`
	QuestionID     *string `json:"questionId"`
	QuestionNumber *string `json:"questionNumber"`
	Code           string  `json:"code"`
}

// ObjectiveIntegrityOverview mirrors the Rust ObjectiveIntegrityOverview
// wire shape (camelCase counts, snake_case integrityStatus).
type ObjectiveIntegrityOverview struct {
	StudentCount            uint64                    `json:"studentCount"`
	ExpectedAnswerCount     uint64                    `json:"expectedAnswerCount"`
	VerifiedCorrectCount    uint64                    `json:"verifiedCorrectCount"`
	VerifiedIncorrectCount  uint64                    `json:"verifiedIncorrectCount"`
	VerifiedUnansweredCount uint64                    `json:"verifiedUnansweredCount"`
	NeedsRecheckCount       uint64                    `json:"needsRecheckCount"`
	InvalidCount            uint64                    `json:"invalidCount"`
	IntegrityStatus         string                    `json:"integrityStatus"`
	Issues                  []ObjectiveIntegrityIssue `json:"issues"`
}

// objectiveQuestionAudit mirrors the Rust ObjectiveQuestionAudit JSON
// (camelCase fields, snake_case status / issue codes).
type objectiveQuestionAudit struct {
	QuestionID string  `json:"questionId"`
	Section    string  `json:"section"`
	Status     string  `json:"status"`
	IssueCode  *string `json:"issueCode"`
}

// objectiveGradingAudit mirrors the Rust ObjectiveGradingAudit JSON
// (camelCase fields, snake_case status / issue codes).
type objectiveGradingAudit struct {
	Section                 string                   `json:"section"`
	ExpectedQuestionCount   uint32                   `json:"expectedQuestionCount"`
	VerifiedCorrectCount    uint32                   `json:"verifiedCorrectCount"`
	VerifiedIncorrectCount  uint32                   `json:"verifiedIncorrectCount"`
	VerifiedUnansweredCount uint32                   `json:"verifiedUnansweredCount"`
	UnresolvedCount         uint32                   `json:"unresolvedCount"`
	InvalidCount            uint32                   `json:"invalidCount"`
	UnknownAnswerCount      uint32                   `json:"unknownAnswerCount"`
	IntegrityStatus         string                   `json:"integrityStatus"`
	GradingSourceVersionID  string                   `json:"gradingSourceVersionId"`
	UnknownAnswerIDs        []string                 `json:"unknownAnswerIds"`
	IssueCodes              []string                 `json:"issueCodes"`
	Questions               []objectiveQuestionAudit `json:"questions"`
}

// ObjectiveIntegrityOverview rebuilds the schedule-level objective-grading
// integrity projection. It mirrors Rust get_objective_integrity_overview:
// resolve the expected grading-source version (schedule grading-source row
// falling back to the schedule published_version_id), count IELTS
// submissions, scan per-section auto-grading audits, validate each audit,
// compare its grading-source version, accumulate verified counts, derive
// the roll-up status, and collect per-question/section issue summaries.
// The materialized grading projection is maintained out of band (see
// internal/maintenance); this read never writes.
func (s *Service) ObjectiveIntegrityOverview(ctx context.Context, scheduleID string) (*ObjectiveIntegrityOverview, error) {
	var publishedVersionID string
	err := s.db.QueryRowContext(ctx,
		"SELECT published_version_id FROM exam_schedules WHERE id = ?", scheduleID).Scan(&publishedVersionID)
	if err == sql.ErrNoRows {
		return nil, apperrors.New(apperrors.CodeNotFound, "Schedule not found.")
	}
	if err != nil {
		return nil, err
	}
	expectedVersionID := publishedVersionID
	if v, err := loadScheduleObjectiveGradingSourceVersionID(ctx, s.db, scheduleID); err != nil {
		return nil, err
	} else if v != nil {
		expectedVersionID = *v
	}
	var studentCount int64
	if err := s.db.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM student_submissions WHERE schedule_id = ? AND provider_key = 'ielts'",
		scheduleID).Scan(&studentCount); err != nil {
		return nil, err
	}
	if studentCount < 0 {
		studentCount = 0
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT
			s.id AS submission_id,
			s.student_id,
			s.student_name,
			ss.section,
			ss.auto_grading_results
		FROM student_submissions s
		LEFT JOIN section_submissions ss
			ON ss.submission_id = s.id
			AND ss.section IN ('listening', 'reading')
		WHERE s.schedule_id = ?
		  AND s.provider_key = 'ielts'
		ORDER BY s.student_name ASC, s.id ASC, ss.section ASC`, scheduleID)
	if err != nil {
		return nil, err
	}
	overview := &ObjectiveIntegrityOverview{
		StudentCount:    uint64(studentCount),
		IntegrityStatus: integrityVerified,
		Issues:          []ObjectiveIntegrityIssue{},
	}
	hadMaterializedRows := false
	for rows.Next() {
		hadMaterializedRows = true
		var submissionID, studentID, studentName string
		var section, autoJSON sql.NullString
		if err := rows.Scan(&submissionID, &studentID, &studentName, &section, &autoJSON); err != nil {
			rows.Close()
			return nil, err
		}
		if !section.Valid || strings.TrimSpace(section.String) == "" {
			markIntegrityStale(overview, submissionID, studentID, studentName, "unknown")
			continue
		}
		sec := section.String
		audit, ok := parseAndValidateAudit(autoJSON)
		if !ok {
			markIntegrityStale(overview, submissionID, studentID, studentName, sec)
			continue
		}
		if audit.GradingSourceVersionID != expectedVersionID {
			markIntegrityStale(overview, submissionID, studentID, studentName, sec)
			continue
		}
		overview.ExpectedAnswerCount += uint64(audit.ExpectedQuestionCount)
		overview.VerifiedCorrectCount += uint64(audit.VerifiedCorrectCount)
		overview.VerifiedIncorrectCount += uint64(audit.VerifiedIncorrectCount)
		overview.VerifiedUnansweredCount += uint64(audit.VerifiedUnansweredCount)
		overview.NeedsRecheckCount += uint64(audit.UnresolvedCount) + uint64(audit.UnknownAnswerCount)
		overview.InvalidCount += uint64(audit.InvalidCount)
		if audit.IntegrityStatus == integrityInvalid {
			overview.IntegrityStatus = integrityInvalid
		} else if audit.IntegrityStatus != integrityVerified && overview.IntegrityStatus != integrityInvalid {
			overview.IntegrityStatus = integrityNeedsRecheck
		}
		represented := map[string]bool{}
		for _, q := range audit.Questions {
			if q.IssueCode == nil || *q.IssueCode == "" {
				continue
			}
			represented[*q.IssueCode] = true
			qid := q.QuestionID
			overview.Issues = append(overview.Issues, ObjectiveIntegrityIssue{
				SubmissionID: submissionID, StudentID: studentID, StudentName: studentName,
				Section: sec, QuestionID: &qid, QuestionNumber: questionNumber(q.QuestionID), Code: *q.IssueCode,
			})
		}
		unknownCode := "unknown_student_answer_id"
		for _, c := range audit.IssueCodes {
			if c == "section_mapping_unavailable" || c == "section_mapping_ambiguous" || c == "unknown_student_answer_id" {
				unknownCode = c
				break
			}
		}
		for _, u := range audit.UnknownAnswerIDs {
			represented[unknownCode] = true
			uid := u
			overview.Issues = append(overview.Issues, ObjectiveIntegrityIssue{
				SubmissionID: submissionID, StudentID: studentID, StudentName: studentName,
				Section: sec, QuestionID: &uid, QuestionNumber: questionNumber(u), Code: unknownCode,
			})
		}
		for _, c := range audit.IssueCodes {
			if represented[c] {
				continue
			}
			overview.Issues = append(overview.Issues, ObjectiveIntegrityIssue{
				SubmissionID: submissionID, StudentID: studentID, StudentName: studentName,
				Section: sec, Code: c,
			})
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if overview.StudentCount > 0 && !hadMaterializedRows && len(overview.Issues) == 0 && overview.ExpectedAnswerCount == 0 {
		overview.IntegrityStatus = integrityNeedsRecheck
		overview.NeedsRecheckCount = overview.StudentCount
	}
	return overview, nil
}

// markIntegrityStale records one section-level stale-source issue, mirroring
// the Rust GradingSourceStale arms (missing section, missing audit payload,
// unparseable payload, failed validate, version mismatch).
func markIntegrityStale(overview *ObjectiveIntegrityOverview, submissionID, studentID, studentName, section string) {
	overview.NeedsRecheckCount++
	overview.IntegrityStatus = integrityNeedsRecheck
	overview.Issues = append(overview.Issues, ObjectiveIntegrityIssue{
		SubmissionID: submissionID, StudentID: studentID, StudentName: studentName,
		Section: section, Code: "grading_source_stale",
	})
}

// parseAndValidateAudit decodes one auto_grading_results payload and checks
// the Rust ObjectiveGradingAudit::validate invariants: question-count
// agreement, duplicate section:question identities, verified/unresolved
// accounting, unknown-answer-count agreement, and derived integrity
// status. It reports false for any missing, malformed, or invalid audit.
func parseAndValidateAudit(raw sql.NullString) (*objectiveGradingAudit, bool) {
	if !raw.Valid || strings.TrimSpace(raw.String) == "" {
		return nil, false
	}
	auditJSON := []byte(raw.String)
	var envelope struct {
		Integrity json.RawMessage `json:"integrity"`
	}
	if err := json.Unmarshal(auditJSON, &envelope); err != nil {
		return nil, false
	}
	if len(envelope.Integrity) > 0 && string(envelope.Integrity) != "null" {
		// Migrated projections store the presentation result and the
		// release-gated ObjectiveGradingAudit together. Validate the audit
		// envelope rather than treating the outer result as an empty audit.
		auditJSON = envelope.Integrity
	}
	var audit objectiveGradingAudit
	if err := json.Unmarshal(auditJSON, &audit); err != nil {
		return nil, false
	}
	if uint32(len(audit.Questions)) != audit.ExpectedQuestionCount {
		return nil, false
	}
	seen := map[string]bool{}
	var correct, incorrect, unanswered, invalid uint32
	for _, q := range audit.Questions {
		identity := q.Section + ":" + q.QuestionID
		if seen[identity] {
			return nil, false
		}
		seen[identity] = true
		switch q.Status {
		case "verified_correct":
			correct++
		case "verified_incorrect":
			incorrect++
		case "verified_unanswered":
			unanswered++
		case "invalid":
			invalid++
		}
	}
	unresolved := audit.ExpectedQuestionCount - correct - incorrect - unanswered
	if correct != audit.VerifiedCorrectCount || incorrect != audit.VerifiedIncorrectCount ||
		unanswered != audit.VerifiedUnansweredCount || unresolved != audit.UnresolvedCount ||
		invalid != audit.InvalidCount || uint32(len(audit.UnknownAnswerIDs)) != audit.UnknownAnswerCount {
		return nil, false
	}
	if deriveIntegrityStatus(invalid, unresolved, audit.UnknownAnswerCount, audit.IssueCodes) != audit.IntegrityStatus {
		return nil, false
	}
	return &audit, true
}

// deriveIntegrityStatus mirrors the Rust derive_integrity_status: any
// invalid count or invalid-class issue code wins Invalid; any unresolved,
// unknown, or remaining issue code yields NeedsRecheck.
func deriveIntegrityStatus(invalidCount, unresolvedCount, unknownAnswerCount uint32, issueCodes []string) string {
	if invalidCount > 0 {
		return integrityInvalid
	}
	for _, c := range issueCodes {
		switch c {
		case "invalid_answer_key", "answer_key_violates_scoring_rule", "unsupported_question_type", "duplicate_question_id":
			return integrityInvalid
		}
	}
	if unresolvedCount > 0 || unknownAnswerCount > 0 || len(issueCodes) > 0 {
		return integrityNeedsRecheck
	}
	return integrityVerified
}

// questionNumber mirrors the Rust question_number helper: trailing ASCII
// digits of the question id, or nil when there are none.
func questionNumber(questionID string) *string {
	i := len(questionID)
	for i > 0 && questionID[i-1] >= '0' && questionID[i-1] <= '9' {
		i--
	}
	if i == len(questionID) {
		return nil
	}
	n := questionID[i:]
	return &n
}

func (s *Service) transitionSubmission(ctx context.Context, submissionID, teacherID, event string, from []string, to string) error {
	return s.runner.WithTxRetry(ctx, 3, func(ctx context.Context, t tx.Tx) error {
		var status string
		if err := t.QueryRowContext(ctx,
			"SELECT grading_status FROM student_submissions WHERE id = ? FOR UPDATE", submissionID).Scan(&status); err != nil {
			if err == sql.ErrNoRows {
				return apperrors.New(apperrors.CodeNotFound, "Submission not found.")
			}
			return err
		}
		allowed := false
		for _, f := range from {
			if status == f {
				allowed = true
				break
			}
		}
		if !allowed {
			return &apperrors.Error{Code: apperrors.CodeConflict, Message: "Submission is not in a state that allows this transition.", HTTPStatus: 409, Details: map[string]any{"from": status, "to": to}}
		}
		now, _ := dbNow(ctx, t)
		if _, err := t.ExecContext(ctx,
			"UPDATE student_submissions SET grading_status = ?, updated_at = ? WHERE id = ?", to, now, submissionID); err != nil {
			return err
		}
		// Keep the teacher-facing review checkpoint in the same state machine
		// transaction as the submission row. The web client reads release_status
		// from review_drafts after each transition; updating only the submission
		// made a successful transition appear to remain in draft.
		if _, err := t.ExecContext(ctx, `
			UPDATE review_drafts
			SET release_status = ?, has_unsaved_changes = FALSE,
				updated_at = ?, revision = revision + 1
			WHERE submission_id = ?`, to, now, submissionID); err != nil {
			return err
		}
		return s.appendReviewEvent(ctx, t, submissionID, teacherID, event, strPtr(status), strPtr(to))
	})
}

func (s *Service) appendReviewEvent(ctx context.Context, t tx.Tx, submissionID, teacherID, action string, from, to *string) error {
	// teacher_name records the actor id; the display name is resolved by the caller profile.
	var fromVal, toVal any
	if from != nil {
		fromVal = *from
	}
	if to != nil {
		toVal = *to
	}
	_, err := t.ExecContext(ctx, `
		INSERT INTO review_events
			(id, submission_id, teacher_id, teacher_name, action, from_status, to_status, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(6))`,
		uuid.NewString(), submissionID, teacherID, teacherID, action, fromVal, toVal)
	return err
}

func loadScheduleOverrides(ctx context.Context, t tx.Tx, scheduleID string) (map[string]json.RawMessage, error) {
	rows, err := t.QueryContext(ctx,
		"SELECT question_id, override_json FROM grading_schedule_question_overrides WHERE schedule_id = ?", scheduleID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]json.RawMessage{}
	for rows.Next() {
		var qid, raw string
		if err := rows.Scan(&qid, &raw); err != nil {
			return nil, err
		}
		out[qid] = json.RawMessage(raw)
	}
	return out, rows.Err()
}

// objectiveAnswerKey maps question id -> sealed answer_definition JSON for
// the pinned exam version. Only listening/reading objective sections load;
// writing/speaking rubrics are human-graded and stay out of the key.
func loadObjectiveAnswerKey(ctx context.Context, t tx.Tx, versionID string) (map[string]string, error) {
	keys := map[string]string{}
	if strings.TrimSpace(versionID) == "" {
		return keys, nil
	}
	rows, err := t.QueryContext(ctx, `
		SELECT eq.question_id, CAST(qr.answer_definition AS CHAR)
		FROM assessment_exam_questions eq
		JOIN assessment_modules m ON m.id = eq.module_id
		JOIN assessment_sections s ON s.id = m.section_id
		JOIN assessment_question_revisions qr ON qr.id = eq.question_revision_id
		WHERE s.exam_version_id = ? AND s.section_key IN ('listening','reading')`, versionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var qid, def string
		if err := rows.Scan(&qid, &def); err != nil {
			return nil, err
		}
		keys[qid] = def
	}
	return keys, rows.Err()
}

// scoreObjective grades one merged answer map. Precedence per question:
// explicit schedule override, then the sealed answer key for the pinned
// version, then zero. Questions with no override and no key score 0 even
// when an answer string is present: awarding credit without a key is the
// inflation vector this fixes, and fail-closed keeps the integrity and
// release gates trustworthy.
func scoreObjective(answers map[string]any, overrides map[string]json.RawMessage, keys map[string]string) []ObjectiveResult {
	var out []ObjectiveResult
	for qid, given := range answers {
		if raw, ok := overrides[qid]; ok {
			var over struct {
				Points    *float64 `json:"points"`
				MaxPoints *float64 `json:"maxPoints"`
				Correct   *bool    `json:"correct"`
			}
			if json.Unmarshal(raw, &over) == nil && (over.Points != nil || over.Correct != nil) {
				pts, max := 0.0, 1.0
				if over.Points != nil {
					pts = *over.Points
				}
				if over.MaxPoints != nil {
					max = *over.MaxPoints
				}
				correct := pts >= max
				if over.Correct != nil {
					correct = *over.Correct
				}
				out = append(out, ObjectiveResult{QuestionID: qid, Correct: correct, Points: pts, MaxPoints: max})
				continue
			}
		}
		if def, ok := keys[qid]; ok && strings.TrimSpace(def) != "" {
			if key, ok := objectiveKeyAnswer(def); ok {
				if str, ok := given.(string); ok && objectiveAnswerEqual(key, str) {
					out = append(out, ObjectiveResult{QuestionID: qid, Correct: true, Points: 1, MaxPoints: 1})
				} else {
					out = append(out, ObjectiveResult{QuestionID: qid, Correct: false, Points: 0, MaxPoints: 1})
				}
				continue
			}
		}
		// No override and no usable sealed key: fail closed, zero credit.
		out = append(out, ObjectiveResult{QuestionID: qid, Correct: false, Points: 0, MaxPoints: 1})
	}
	return out
}

// objectiveKeyAnswer extracts the comparable correct answer from a sealed
// answer_definition payload, accepting the camelCase and snake_case shapes
// the delivery scorer honors (single_choice correctOptionId; free-text
// acceptedResponses[0]). Unknown kinds yield ok=false so the caller fails
// closed instead of guessing.
func objectiveKeyAnswer(def string) (string, bool) {
	var m map[string]json.RawMessage
	if err := json.Unmarshal([]byte(def), &m); err != nil {
		return "", false
	}
	var kind string
	if raw, ok := m["kind"]; ok {
		_ = json.Unmarshal(raw, &kind)
	}
	switch kind {
	case "single_choice":
		raw, ok := m["correctOptionId"]
		if !ok {
			raw, ok = m["correct_option_id"]
		}
		if !ok {
			return "", false
		}
		var correct string
		if err := json.Unmarshal(raw, &correct); err != nil {
			return "", false
		}
		return correct, true
	default:
		raw, ok := m["acceptedResponses"]
		if !ok {
			raw, ok = m["accepted_responses"]
		}
		if !ok {
			return "", false
		}
		var accepted []string
		if err := json.Unmarshal(raw, &accepted); err != nil || len(accepted) == 0 {
			return "", false
		}
		return accepted[0], true
	}
}

// objectiveAnswerEqual compares a student answer to the sealed key with the
// delivery scorer's ASCII case-insensitive trimmed equality.
func objectiveAnswerEqual(key, given string) bool {
	return strings.EqualFold(strings.TrimSpace(key), strings.TrimSpace(given))
}

func dbNow(ctx context.Context, t tx.Tx) (time.Time, error) {
	var now time.Time
	if err := t.QueryRowContext(ctx, "SELECT UTC_TIMESTAMP(6)").Scan(&now); err != nil {
		return time.Now().UTC(), err
	}
	return now.UTC(), nil
}

func mustJSON(v any) []byte {
	b, _ := json.Marshal(v)
	return b
}

func strPtr(s string) *string { return &s }

// lockObjectiveIntegrityForSubmission adapts the Rust
// lock_and_validate_objective_integrity_for_submission guard: it locks the
// submission row, resolves the expected grading-source version (schedule
// grading-source row falling back to the submission published_version_id),
// and requires every listening/reading section row to carry a valid audit
// snapshot pinned to that version. The Go schema stores only the sealed
// auto_grading_results JSON that GradeObjective persists, so the audit-shape
// validation reuses parseAndValidateAudit; anything missing, malformed, or
// pinned to another version is a CodeConflict, exactly like the Rust
// GradingSourceStale arm.
func lockObjectiveIntegrityForSubmission(ctx context.Context, t tx.Tx, submissionID, scheduleID, publishedVersionID string) error {
	var lockedScheduleID, lockedPublishedVersionID string
	if err := t.QueryRowContext(ctx,
		"SELECT schedule_id, published_version_id FROM student_submissions WHERE id = ? FOR UPDATE",
		submissionID).Scan(&lockedScheduleID, &lockedPublishedVersionID); err != nil {
		if err == sql.ErrNoRows {
			return apperrors.New(apperrors.CodeNotFound, "Submission not found.")
		}
		return err
	}
	_ = scheduleID
	_ = publishedVersionID
	expectedVersionID := lockedPublishedVersionID
	var source string
	var sourceVersionID sql.NullString
	if err := t.QueryRowContext(ctx,
		"SELECT source, version_id FROM grading_schedule_objective_grading_source WHERE schedule_id = ? FOR UPDATE",
		lockedScheduleID).Scan(&source, &sourceVersionID); err != nil {
		if err != sql.ErrNoRows {
			return err
		}
	} else if source == "draft_version" && sourceVersionID.Valid && strings.TrimSpace(sourceVersionID.String) != "" {
		expectedVersionID = strings.TrimSpace(sourceVersionID.String)
	}
	rows, err := t.QueryContext(ctx,
		"SELECT section, auto_grading_results FROM section_submissions WHERE submission_id = ? AND section IN ('listening','reading') ORDER BY section ASC FOR UPDATE",
		submissionID)
	if err != nil {
		return err
	}
	defer rows.Close()
	found := map[string]bool{}
	for rows.Next() {
		var section string
		var autoJSON sql.NullString
		if err := rows.Scan(&section, &autoJSON); err != nil {
			return err
		}
		found[section] = true
		audit, ok := parseAndValidateAudit(autoJSON)
		if !ok || audit.GradingSourceVersionID != expectedVersionID {
			return &apperrors.Error{Code: apperrors.CodeConflict, Message: "Objective grading integrity blocks release: grading source stale.", HTTPStatus: 409}
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	for _, section := range []string{"listening", "reading"} {
		if !found[section] {
			return &apperrors.Error{Code: apperrors.CodeConflict, Message: "Objective grading integrity blocks release: grading source stale.", HTTPStatus: 409}
		}
	}
	return nil
}

// buildSectionBands adapts the Rust build_section_bands snapshot: the
// listening/reading/speaking overallBand fields carry over verbatim (0 when
// absent) and writing averages every per-task overallBand.
func buildSectionBands(sectionDrafts map[string]any) map[string]any {
	out := map[string]any{}
	for _, key := range []string{"listening", "reading", "speaking"} {
		out[key] = overallBandOf(sectionDrafts[key])
	}
	writing, _ := sectionDrafts["writing"].(map[string]any)
	var sum float64
	var count int
	for _, v := range writing {
		if band, ok := taskOverallBand(v); ok {
			sum += band
			count++
		}
	}
	if count == 0 {
		out["writing"] = 0.0
	} else {
		out["writing"] = sum / float64(count)
	}
	return out
}

// averageBand adapts the Rust average_band helper: the mean of every
// positive section band, 0 when none qualify.
func averageBand(sectionBands map[string]any) float64 {
	var sum float64
	var count int
	for _, v := range sectionBands {
		if band, ok := numberOf(v); ok && band > 0 {
			sum += band
			count++
		}
	}
	if count == 0 {
		return 0
	}
	return sum / float64(count)
}

// buildWritingResults adapts the Rust build_writing_results snapshot: one
// entry per writing_task_submissions row carrying the task prompt, student
// text, rubric scores, student-visible annotations/drawings, and criterion
// feedback resolved from the locked section drafts.
func buildWritingResults(ctx context.Context, t tx.Tx, submissionID string, sectionDrafts map[string]any, annotationsJSON, drawingsJSON string) (string, error) {
	var annotationItems, drawingItems []any
	if strings.TrimSpace(annotationsJSON) != "" {
		_ = json.Unmarshal([]byte(annotationsJSON), &annotationItems)
	}
	if strings.TrimSpace(drawingsJSON) != "" {
		_ = json.Unmarshal([]byte(drawingsJSON), &drawingItems)
	}
	rows, err := t.QueryContext(ctx,
		`SELECT task_id, task_label, prompt, student_text, word_count
		FROM writing_task_submissions WHERE submission_id = ? ORDER BY task_id ASC`, submissionID)
	if err != nil {
		return "", err
	}
	defer rows.Close()
	results := map[string]any{}
	for rows.Next() {
		var taskID, taskLabel, prompt, studentText string
		var wordCount int
		if err := rows.Scan(&taskID, &taskLabel, &prompt, &studentText, &wordCount); err != nil {
			return "", err
		}
		var rubric map[string]any
		if writing, ok := sectionDrafts["writing"].(map[string]any); ok {
			rubric, _ = writing[taskID].(map[string]any)
		}
		if rubric == nil {
			rubric = map[string]any{}
		}
		results[taskID] = map[string]any{
			"taskId":      taskID,
			"taskLabel":   taskLabel,
			"prompt":      prompt,
			"studentText": studentText,
			"wordCount":   wordCount,
			"rubricScores": map[string]any{
				"taskResponse": bandField(rubric, "taskResponseBand"),
				"coherence":    bandField(rubric, "coherenceBand"),
				"lexical":      bandField(rubric, "lexicalBand"),
				"grammar":      bandField(rubric, "grammarBand"),
			},
			"annotations": visibleForTask(annotationItems, taskID),
			"drawings":    visibleForTask(drawingItems, taskID),
			"criterionFeedback": map[string]any{
				"taskResponse": strField(rubric, "taskResponseNotes"),
				"coherence":    strField(rubric, "coherenceNotes"),
				"lexical":      strField(rubric, "lexicalNotes"),
				"grammar":      strField(rubric, "grammarNotes"),
			},
		}
	}
	if err := rows.Err(); err != nil {
		return "", err
	}
	return string(mustJSON(results)), nil
}

// overallBandOf reads one section overallBand, defaulting to 0.
func overallBandOf(v any) float64 {
	section, ok := v.(map[string]any)
	if !ok {
		return 0
	}
	band, _ := numberOf(section["overallBand"])
	return band
}

// taskOverallBand reads one writing-task overallBand entry.
func taskOverallBand(v any) (float64, bool) {
	task, ok := v.(map[string]any)
	if !ok {
		return 0, false
	}
	return numberOf(task["overallBand"])
}

// numberOf coerces JSON numbers (and numeric strings) to float64.
func numberOf(v any) (float64, bool) {
	switch n := v.(type) {
	case float64:
		return n, true
	case float32:
		return float64(n), true
	case int:
		return float64(n), true
	case int64:
		return float64(n), true
	case json.Number:
		if f, err := n.Float64(); err == nil {
			return f, true
		}
	case string:
		var f float64
		if json.Unmarshal([]byte(strings.TrimSpace(n)), &f) == nil {
			return f, true
		}
	}
	return 0, false
}

// bandField reads one rubric band score, defaulting to 0.
func bandField(rubric map[string]any, key string) float64 {
	if band, ok := numberOf(rubric[key]); ok {
		return band
	}
	return 0
}

// strField reads one optional rubric note.
func strField(rubric map[string]any, key string) any {
	if s, ok := rubric[key].(string); ok {
		return s
	}
	return nil
}

// visibleForTask keeps only student_visible annotations/drawings for a task.
func visibleForTask(items []any, taskID string) []any {
	out := []any{}
	for _, item := range items {
		entry, ok := item.(map[string]any)
		if !ok {
			continue
		}
		if task, _ := entry["taskId"].(string); task != taskID {
			continue
		}
		if visibility, _ := entry["visibility"].(string); visibility != "student_visible" {
			continue
		}
		out = append(out, entry)
	}
	return out
}
