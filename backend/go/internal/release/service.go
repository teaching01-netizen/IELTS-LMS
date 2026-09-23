// Package release owns the assessment-release read slice for the Go backend
// (SAT provider).
//
// It mirrors backend/crates/application/src/assessment_release.rs
// (AssessmentReleaseService::get): the release row join over exam_entities +
// the current published/draft pointers, the SAT-only gate, row validation,
// lifecycle classification, the content summary (3 queries over the
// draft-or-published version) and the access summary (1 query over
// assessment_access_links). Reads are plain explicit-SQL queries on the pool
// with no writes, following the internal/delivery read structure.
package release

import (
	"context"
	"database/sql"
	"time"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/satpublish"
)

// LifecycleState is the release lifecycle wire value (snake_case, mirrors
// AssessmentReleaseLifecycleState).
type LifecycleState string

const (
	LifecycleNeverPublished     LifecycleState = "never_published"
	LifecyclePublishedCurrent   LifecycleState = "published_current"
	LifecycleUnpublishedChanges LifecycleState = "unpublished_changes"
)

// ReleasePublishedVersion mirrors ReleasePublishedVersion (camelCase wire shape).
type ReleasePublishedVersion struct {
	ID            string           `json:"id"`
	VersionNumber int              `json:"versionNumber"`
	Revision      int              `json:"revision"`
	PublishNotes  *string          `json:"publishNotes"`
	PublishScope  satpublish.Scope `json:"publishScope"`
	PublishedAt   time.Time        `json:"publishedAt"`
}

// ReleaseWorkingDraft mirrors ReleaseWorkingDraft (camelCase wire shape).
type ReleaseWorkingDraft struct {
	ID              string  `json:"id"`
	ParentVersionID *string `json:"parentVersionId"`
	VersionNumber   int     `json:"versionNumber"`
	Revision        int     `json:"revision"`
}

// ReleaseContentSummary mirrors ReleaseContentSummary (camelCase wire shape).
type ReleaseContentSummary struct {
	CandidateDurationSeconds int64 `json:"candidateDurationSeconds"`
	AuthoredQuestionCount    int64 `json:"authoredQuestionCount"`
	DeliveredQuestionCount   int64 `json:"deliveredQuestionCount"`
}

// ReleaseAccessSummary mirrors ReleaseAccessSummary (camelCase wire shape).
type ReleaseAccessSummary struct {
	TotalLinks                  int64 `json:"totalLinks"`
	LiveLinks                   int64 `json:"liveLinks"`
	UpcomingLinks               int64 `json:"upcomingLinks"`
	LinksOnCurrentRelease       int64 `json:"linksOnCurrentRelease"`
	LiveLinksOnPreviousReleases int64 `json:"liveLinksOnPreviousReleases"`
}

// ReleaseState mirrors AssessmentReleaseState (camelCase wire shape).
type ReleaseState struct {
	ExamID                  string                   `json:"examId"`
	ProviderKey             string                   `json:"providerKey"`
	State                   LifecycleState           `json:"state"`
	CurrentPublishedVersion *ReleasePublishedVersion `json:"currentPublishedVersion"`
	WorkingDraft            *ReleaseWorkingDraft     `json:"workingDraft"`
	Summary                 ReleaseContentSummary    `json:"summary"`
	Access                  ReleaseAccessSummary     `json:"access"`
}

// Service reads assessment-release state; there are no writes.
type Service struct {
	db *sql.DB
}

// NewService wires dependencies explicitly.
func NewService(db *sql.DB) *Service { return &Service{db: db} }

// releaseRow is the release join row (mirrors the Rust ReleaseRow): the exam
// plus its current published/draft pointers via LEFT JOINs.
type releaseRow struct {
	examID               string
	providerKey          string
	publishedID          sql.NullString
	publishedVersion     sql.NullInt64
	publishedRevision    sql.NullInt64
	publishedNotes       sql.NullString
	publishedScope       sql.NullString
	publishedCreatedAt   sql.NullTime
	publishedIsPublished sql.NullBool
	draftID              sql.NullString
	draftParentVersionID sql.NullString
	draftVersion         sql.NullInt64
	draftRevision        sql.NullInt64
	draftIsDraft         sql.NullBool
}

func invariantError(msg string) *apperrors.Error {
	return apperrors.New(apperrors.CodeAssessmentReleaseInvariant, msg)
} // Get returns the release state for one exam (mirrors
// AssessmentReleaseService::get): release row join, SAT-only gate, row
// validation, lifecycle classification, content summary over the
// draft-or-published version, and the access summary.
func (s *Service) Get(ctx context.Context, examID string) (*ReleaseState, error) {
	row, err := s.loadReleaseRow(ctx, examID)
	if err != nil {
		return nil, err
	}
	if row.providerKey != "sat" {
		return nil, apperrors.New(apperrors.CodeUnsupportedProvider, "Assessment release is only available for SAT exams.")
	}
	if err := validateReleaseRow(&row); err != nil {
		return nil, err
	}
	state, err := classifyReleaseState(&row)
	if err != nil {
		return nil, err
	}
	published, err := publishedVersionFromRow(&row)
	if err != nil {
		return nil, err
	}
	draft, err := workingDraftFromRow(&row)
	if err != nil {
		return nil, err
	}
	var versionID string
	switch {
	case row.draftID.Valid:
		versionID = row.draftID.String
	case row.publishedID.Valid:
		versionID = row.publishedID.String
	}
	summary := ReleaseContentSummary{}
	if versionID != "" {
		summary, err = s.contentSummary(ctx, versionID)
		if err != nil {
			return nil, err
		}
	}
	var publishedID *string
	if row.publishedID.Valid {
		publishedID = &row.publishedID.String
	}
	access, err := s.accessSummary(ctx, examID, publishedID)
	if err != nil {
		return nil, err
	}
	return &ReleaseState{
		ExamID:                  row.examID,
		ProviderKey:             row.providerKey,
		State:                   state,
		CurrentPublishedVersion: published,
		WorkingDraft:            draft,
		Summary:                 summary,
		Access:                  access,
	}, nil
}

// loadReleaseRow loads the exam plus its current published/draft pointers.
func (s *Service) loadReleaseRow(ctx context.Context, examID string) (releaseRow, error) {
	var row releaseRow
	err := s.db.QueryRowContext(ctx,
		"SELECT e.id AS exam_id, e.provider_key, "+
			"pv.id AS published_id, pv.version_number AS published_version_number, "+
			"pv.revision AS published_revision, pv.publish_notes AS published_notes, "+
			"pv.sat_publish_scope AS published_scope, "+
			"pv.created_at AS published_created_at, "+
			"pv.is_published AS published_is_published, "+
			"dv.id AS draft_id, dv.parent_version_id AS draft_parent_version_id, "+
			"dv.version_number AS draft_version_number, "+
			"dv.revision AS draft_revision, dv.is_draft AS draft_is_draft "+
			"FROM exam_entities e "+
			"LEFT JOIN exam_versions pv ON pv.id = e.current_published_version_id "+
			"LEFT JOIN exam_versions dv ON dv.id = e.current_draft_version_id "+
			"WHERE e.id = ?",
		examID).Scan(
		&row.examID, &row.providerKey,
		&row.publishedID, &row.publishedVersion,
		&row.publishedRevision, &row.publishedNotes,
		&row.publishedScope,
		&row.publishedCreatedAt,
		&row.publishedIsPublished,
		&row.draftID, &row.draftParentVersionID,
		&row.draftVersion,
		&row.draftRevision, &row.draftIsDraft,
	)
	if err == sql.ErrNoRows {
		return releaseRow{}, apperrors.New(apperrors.CodeNotFound, "Assessment release not found.")
	}
	return row, err
} // contentSummary mirrors content_summary_tx: candidate duration, authored
// questions, and delivered (base + branch) targets for one version.
// Candidate duration is base-module time + the LONGER branch per section +
// breaks: a candidate takes M1 plus exactly one M2 branch, so summing all
// three authored modules would overstate the longest real sitting.
func (s *Service) contentSummary(ctx context.Context, versionID string) (ReleaseContentSummary, error) {
	var out ReleaseContentSummary
	var rawScope sql.NullString
	if err := s.db.QueryRowContext(ctx,
		"SELECT sat_publish_scope FROM exam_versions WHERE id = ?", versionID).Scan(&rawScope); err != nil {
		return ReleaseContentSummary{}, err
	}
	sectionFilter, filterArgs := sectionScopeSQL(rawScope.String)
	sectionRows, err := s.db.QueryContext(ctx,
		"SELECT COALESCE(MAX(CASE WHEN m.adaptive_role = 'base' THEN m.duration_seconds ELSE 0 END), 0) + "+
			"GREATEST(COALESCE(MAX(CASE WHEN m.adaptive_role = 'lower_branch' THEN m.duration_seconds ELSE 0 END), 0), "+
			"COALESCE(MAX(CASE WHEN m.adaptive_role = 'higher_branch' THEN m.duration_seconds ELSE 0 END), 0)), "+
			"s.break_after_seconds FROM assessment_sections s "+
			"LEFT JOIN assessment_modules m ON m.section_id = s.id "+
			"WHERE s.exam_version_id = ?"+sectionFilter+
			" GROUP BY s.id, s.display_order, s.break_after_seconds ORDER BY s.display_order, s.id",
		append([]any{versionID}, filterArgs...)...)
	if err != nil {
		return ReleaseContentSummary{}, err
	}
	type sectionTime struct{ candidate, gap int64 }
	times := make([]sectionTime, 0)
	for sectionRows.Next() {
		var item sectionTime
		if err := sectionRows.Scan(&item.candidate, &item.gap); err != nil {
			sectionRows.Close()
			return ReleaseContentSummary{}, err
		}
		times = append(times, item)
	}
	if err := sectionRows.Err(); err != nil {
		sectionRows.Close()
		return ReleaseContentSummary{}, err
	}
	sectionRows.Close()
	for index, item := range times {
		out.CandidateDurationSeconds += item.candidate
		if index < len(times)-1 {
			out.CandidateDurationSeconds += item.gap
		}
	}
	if err := s.db.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM assessment_exam_questions q "+
			"JOIN assessment_modules m ON m.id = q.module_id "+
			"JOIN assessment_sections s ON s.id = m.section_id "+
			"WHERE s.exam_version_id = ?"+sectionFilter,
		append([]any{versionID}, filterArgs...)...).Scan(&out.AuthoredQuestionCount); err != nil {
		return ReleaseContentSummary{}, err
	}
	if err := s.db.QueryRowContext(ctx,
		"SELECT CAST(COALESCE(SUM(section_plan.base_target + section_plan.branch_target), 0) AS SIGNED) FROM ("+
			"SELECT s.id, "+
			"MAX(CASE WHEN m.adaptive_role = 'base' THEN m.target_question_count ELSE 0 END) AS base_target, "+
			"MAX(CASE WHEN m.adaptive_role IN ('lower_branch', 'higher_branch') THEN m.target_question_count ELSE 0 END) AS branch_target "+
			"FROM assessment_sections s "+
			"LEFT JOIN assessment_modules m ON m.section_id = s.id "+
			"WHERE s.exam_version_id = ?"+sectionFilter+" GROUP BY s.id) section_plan",
		append([]any{versionID}, filterArgs...)...).Scan(&out.DeliveredQuestionCount); err != nil {
		return ReleaseContentSummary{}, err
	}
	return out, nil
}

func sectionScopeSQL(raw string) (string, []any) {
	switch raw {
	case "", string(satpublish.ScopeFull):
		return "", nil
	case string(satpublish.ScopeReadingWriting):
		return " AND s.section_key = ?", []any{"reading-writing"}
	case string(satpublish.ScopeMath):
		return " AND s.section_key = ?", []any{"math"}
	default:
		return " AND 1 = 0", nil
	}
}

// accessSummary mirrors access_summary_tx: link totals over
// assessment_access_links for one exam.
func (s *Service) accessSummary(ctx context.Context, examID string, currentPublishedVersionID *string) (ReleaseAccessSummary, error) {
	var out ReleaseAccessSummary
	var publishedID any
	if currentPublishedVersionID != nil {
		publishedID = *currentPublishedVersionID
	}
	err := s.db.QueryRowContext(ctx,
		"SELECT COUNT(*) AS total_links, "+
			"CAST(COALESCE(SUM(CASE WHEN l.lifecycle_state = 'active' AND (l.availability_type = 'anytime' OR (l.opens_at <= NOW() AND l.closes_at > NOW())) THEN 1 ELSE 0 END), 0) AS SIGNED) AS live_links, "+
			"CAST(COALESCE(SUM(CASE WHEN l.lifecycle_state = 'active' AND l.availability_type = 'scheduled' AND l.opens_at > NOW() THEN 1 ELSE 0 END), 0) AS SIGNED) AS upcoming_links, "+
			"CAST(COALESCE(SUM(CASE WHEN l.published_version_id <=> ? THEN 1 ELSE 0 END), 0) AS SIGNED) AS links_on_current_release, "+
			"CAST(COALESCE(SUM(CASE WHEN NOT (l.published_version_id <=> ?) AND l.lifecycle_state = 'active' AND (l.availability_type = 'anytime' OR (l.opens_at <= NOW() AND l.closes_at > NOW())) THEN 1 ELSE 0 END), 0) AS SIGNED) AS live_links_on_previous_releases "+
			"FROM assessment_access_links l WHERE l.exam_id = ?",
		publishedID, publishedID, examID).Scan(
		&out.TotalLinks, &out.LiveLinks, &out.UpcomingLinks,
		&out.LinksOnCurrentRelease, &out.LiveLinksOnPreviousReleases,
	)
	return out, err
}

// classifyReleaseState mirrors classify_release_state: no published pointer
// means never published; no draft, or a clean draft still parented on the
// published version at revision 0, means published-current; anything else
// means unpublished changes. Published and draft must never alias.
func classifyReleaseState(row *releaseRow) (LifecycleState, error) {
	if !row.publishedID.Valid {
		return LifecycleNeverPublished, nil
	}
	if !row.draftID.Valid {
		return LifecyclePublishedCurrent, nil
	}
	if row.draftID.String == row.publishedID.String {
		return "", invariantError("published and draft pointers reference the same version")
	}
	if row.draftParentVersionID.Valid &&
		row.draftParentVersionID.String == row.publishedID.String &&
		row.draftRevision.Valid && row.draftRevision.Int64 == 0 {
		return LifecyclePublishedCurrent, nil
	}
	return LifecycleUnpublishedChanges, nil
}

// validateReleaseRow mirrors validate_release_row: the published pointer must
// reference a published version and the draft pointer a draft version.
func validateReleaseRow(row *releaseRow) error {
	if row.publishedID.Valid && (!row.publishedIsPublished.Valid || !row.publishedIsPublished.Bool) {
		return invariantError("current published pointer does not reference a published version")
	}
	if row.draftID.Valid && (!row.draftIsDraft.Valid || !row.draftIsDraft.Bool) {
		return invariantError("current draft pointer does not reference a draft version")
	}
	return nil
}

// publishedVersionFromRow mirrors published_version_from_row.
func publishedVersionFromRow(row *releaseRow) (*ReleasePublishedVersion, error) {
	if !row.publishedID.Valid {
		return nil, nil
	}
	if !row.publishedVersion.Valid {
		return nil, invariantError("published version number is missing")
	}
	if !row.publishedRevision.Valid {
		return nil, invariantError("published revision is missing")
	}
	if !row.publishedCreatedAt.Valid {
		return nil, invariantError("published timestamp is missing")
	}
	out := &ReleasePublishedVersion{
		ID:            row.publishedID.String,
		VersionNumber: int(row.publishedVersion.Int64),
		Revision:      int(row.publishedRevision.Int64),
		PublishedAt:   row.publishedCreatedAt.Time.UTC(),
		PublishScope:  satpublish.Scope(row.publishedScope.String),
	}
	if out.PublishScope == "" {
		out.PublishScope = satpublish.ScopeFull
	}
	if row.publishedNotes.Valid {
		notes := row.publishedNotes.String
		out.PublishNotes = &notes
	}
	return out, nil
}

// workingDraftFromRow mirrors working_draft_from_row.
func workingDraftFromRow(row *releaseRow) (*ReleaseWorkingDraft, error) {
	if !row.draftID.Valid {
		return nil, nil
	}
	if !row.draftVersion.Valid {
		return nil, invariantError("draft version number is missing")
	}
	if !row.draftRevision.Valid {
		return nil, invariantError("draft revision is missing")
	}
	out := &ReleaseWorkingDraft{
		ID:            row.draftID.String,
		VersionNumber: int(row.draftVersion.Int64),
		Revision:      int(row.draftRevision.Int64),
	}
	if row.draftParentVersionID.Valid {
		parent := row.draftParentVersionID.String
		out.ParentVersionID = &parent
	}
	return out, nil
}
