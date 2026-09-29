package grading

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"
	"time"

	"example.com/ielts-proctoring/internal/platform/apperrors"
)

// ReviewDraft is the complete review checkpoint returned to the web client.
// JSON columns stay as decoded values so the API preserves the Rust payload
// shape while allowing the Go transition service to keep them schema-agnostic.
type ReviewDraft struct {
	ID                  string     `json:"id"`
	SubmissionID        string     `json:"submissionId"`
	StudentID           string     `json:"studentId"`
	TeacherID           string     `json:"teacherId"`
	ReleaseStatus       string     `json:"releaseStatus"`
	SectionDrafts       any        `json:"sectionDrafts"`
	Annotations         any        `json:"annotations"`
	Drawings            any        `json:"drawings"`
	OverallFeedback     *string    `json:"overallFeedback,omitempty"`
	StudentVisibleNotes *string    `json:"studentVisibleNotes,omitempty"`
	InternalNotes       *string    `json:"internalNotes,omitempty"`
	TeacherSummary      any        `json:"teacherSummary"`
	Checklist           any        `json:"checklist"`
	HasUnsavedChanges   bool       `json:"hasUnsavedChanges"`
	LastAutoSaveAt      *time.Time `json:"lastAutoSaveAt,omitempty"`
	CreatedAt           time.Time  `json:"createdAt"`
	UpdatedAt           time.Time  `json:"updatedAt"`
	Revision            int        `json:"revision"`
}

// GetReviewDraft loads the provider-scoped review checkpoint in the same
// shape returned by the Rust grading API. Missing drafts remain NOT_FOUND so
// callers can distinguish "start review" from a failed database read.
func (s *Service) GetReviewDraft(ctx context.Context, submissionID string) (ReviewDraft, error) {
	var draft ReviewDraft
	var sectionDrafts, annotations, drawings, teacherSummary, checklist sql.NullString
	var overallFeedback, studentVisibleNotes, internalNotes sql.NullString
	var lastAutoSaveAt sql.NullTime
	var hasUnsavedChanges sql.NullBool
	err := s.db.QueryRowContext(ctx, `
		SELECT d.id, d.submission_id, d.student_id, d.teacher_id, d.release_status,
		       d.section_drafts, d.annotations, d.drawings, d.overall_feedback,
		       d.student_visible_notes, d.internal_notes, d.teacher_summary,
		       d.checklist, d.has_unsaved_changes, d.last_auto_save_at,
		       d.created_at, d.updated_at, d.revision
		FROM review_drafts d
		JOIN student_submissions s ON s.id = d.submission_id
		WHERE d.submission_id = ? AND s.provider_key IN ('ielts','act')`, submissionID).Scan(
		&draft.ID, &draft.SubmissionID, &draft.StudentID, &draft.TeacherID, &draft.ReleaseStatus,
		&sectionDrafts, &annotations, &drawings, &overallFeedback,
		&studentVisibleNotes, &internalNotes, &teacherSummary, &checklist,
		&hasUnsavedChanges, &lastAutoSaveAt, &draft.CreatedAt, &draft.UpdatedAt, &draft.Revision,
	)
	if err == sql.ErrNoRows {
		return ReviewDraft{}, apperrors.New(apperrors.CodeNotFound, "Review draft not found.")
	}
	if err != nil {
		return ReviewDraft{}, err
	}
	draft.SectionDrafts = decodeReviewJSON(sectionDrafts, map[string]any{})
	draft.Annotations = decodeReviewJSON(annotations, []any{})
	draft.Drawings = decodeReviewJSON(drawings, []any{})
	draft.TeacherSummary = decodeReviewJSON(teacherSummary, map[string]any{})
	draft.Checklist = decodeReviewJSON(checklist, map[string]any{})
	draft.OverallFeedback = nullableReviewString(overallFeedback)
	draft.StudentVisibleNotes = nullableReviewString(studentVisibleNotes)
	draft.InternalNotes = nullableReviewString(internalNotes)
	if hasUnsavedChanges.Valid {
		draft.HasUnsavedChanges = hasUnsavedChanges.Bool
	}
	if lastAutoSaveAt.Valid {
		value := lastAutoSaveAt.Time.UTC()
		draft.LastAutoSaveAt = &value
	}
	draft.CreatedAt = draft.CreatedAt.UTC()
	draft.UpdatedAt = draft.UpdatedAt.UTC()
	return draft, nil
}

func decodeReviewJSON(raw sql.NullString, fallback any) any {
	if !raw.Valid || strings.TrimSpace(raw.String) == "" {
		return fallback
	}
	var value any
	if err := json.Unmarshal([]byte(raw.String), &value); err != nil || value == nil {
		return fallback
	}
	return value
}

func nullableReviewString(raw sql.NullString) *string {
	if !raw.Valid {
		return nil
	}
	value := raw.String
	return &value
}
