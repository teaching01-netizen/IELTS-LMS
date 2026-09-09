// Package results serves scored outcomes for IELTS, SAT, and ACT science.
//
// It covers the ready-to-release gate, SAT adaptive/scaled section detail,
// ACT science rows, proctor/timeout invalidation mapping, and snapshot
// re-materialization: released results are rebuilt from the persisted
// student_results snapshot instead of recomputed from live answers.
package results

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"example.com/ielts-proctoring/internal/assessscore"
	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/platform/apperrors"
)

// Outcome statuses owned by assessment_results (see 0044 lineage).
const (
	OutcomeScored             = "scored"
	OutcomePending            = "pending"
	OutcomeInvalidatedProctor = "invalidated_proctor"
	OutcomeInvalidatedTimeout = "invalidated_timeout"
)

// Release states shared by student_results and assessment_results.
const (
	ReleaseDraft           = "draft"
	ReleaseGradingComplete = "grading_complete"
	ReleaseReady           = "ready_to_release"
	ReleaseReleased        = "released"
	ReleaseReopened        = "reopened"
	ReleaseInvalidated     = "invalidated"
)

// Analytics aggregates release counters over the latest student_results
// versions (mirrors ResultsAnalytics: total_results, released_results,
// ready_to_release, average_overall_band, camelCase wire shape).
type Analytics struct {
	TotalResults       int64   `json:"totalResults"`
	ReleasedResults    int64   `json:"releasedResults"`
	ReadyToRelease     int64   `json:"readyToRelease"`
	AverageOverallBand float64 `json:"averageOverallBand"`
}

// Service reads results; release mutations live in grading.Service.
type Service struct {
	db *sql.DB
}

// NewService wires dependencies explicitly.
func NewService(db *sql.DB) *Service { return &Service{db: db} }

// ResultSummary is the list row shared by providers.
type ResultSummary struct {
	ID            string     `json:"id"`
	SubmissionID  *string    `json:"submissionId"`
	AttemptID     string     `json:"attemptId"`
	ProviderKey   string     `json:"providerKey"`
	Outcome       string     `json:"outcomeStatus"`
	ScoreKind     string     `json:"scoreKind"`
	TotalScore    *int       `json:"totalScore"`
	ReleaseState  string     `json:"releaseStatus"`
	ScheduleID    string     `json:"scheduleId"`
	ExamID        string     `json:"examId"`
	ExamTitle     string     `json:"examTitle"`
	VersionNumber int        `json:"versionNumber"`
	StudentID     string     `json:"studentId"`
	StudentName   string     `json:"studentName"`
	StudentEmail  *string    `json:"studentEmail"`
	CohortName    string     `json:"cohortName"`
	SubmittedAt   *time.Time `json:"submittedAt"`
}

// DashboardResult is the provider-neutral result row used by the admin
// results surface. IELTS rows come from the immutable student_results
// snapshot; SAT and ACT rows come from assessment_results.
type DashboardResult struct {
	ID            string             `json:"id"`
	SubmissionID  *string            `json:"submissionId,omitempty"`
	AttemptID     string             `json:"attemptId"`
	ProviderKey   string             `json:"providerKey"`
	OutcomeStatus string             `json:"outcomeStatus"`
	ReleaseStatus string             `json:"releaseStatus"`
	TotalScore    *int               `json:"totalScore,omitempty"`
	MaxScore      *int               `json:"maxScore,omitempty"`
	Percentage    *float64           `json:"percentage,omitempty"`
	OverallBand   *float64           `json:"overallBand,omitempty"`
	SectionBands  map[string]float64 `json:"sectionBands,omitempty"`
	StudentID     string             `json:"studentId"`
	StudentName   string             `json:"studentName"`
	StudentEmail  *string            `json:"studentEmail,omitempty"`
	ScheduleID    string             `json:"scheduleId"`
	ExamID        string             `json:"examId"`
	ExamTitle     string             `json:"examTitle"`
	CohortName    string             `json:"cohortName"`
	Institution   *string            `json:"institution,omitempty"`
	VersionNumber int                `json:"versionNumber"`
	SubmittedAt   *time.Time         `json:"submittedAt,omitempty"`
}

// SATModule mirrors one administered SAT module attempt inside a section.
// Rows come from assessment_module_attempts joined to assessment_modules;
// a branch that was never administered is not returned (the UI renders it
// as "Not administered") rather than as a zero row.
type SATModule struct {
	ModuleKey      string  `json:"moduleKey"`
	AdaptiveRole   string  `json:"adaptiveRole"`
	RawCorrect     int64   `json:"rawCorrect"`
	Operational    int64   `json:"operationalQuestionCount"`
	State          string  `json:"state"`
	IsAdministered bool    `json:"isAdministered"`
	DisplayOrder   int     `json:"displayOrder"`
}

// SATQuestion is one administered SAT question with its sealed response and
// server-computed verdict. IsCorrect is nil (JSON null) whenever no verdict
// may be shown: pretest items, unanswered items, missing keys, pending or
// invalidated outcomes. A nil verdict never renders as incorrect.
type SATQuestion struct {
	QuestionID      string `json:"questionId"`
	DisplayOrder    int    `json:"displayOrder"`
	ModuleKey       string `json:"moduleKey"`
	SectionKey      string `json:"sectionKey"`
	Response        any    `json:"response"`
	CorrectAnswer   any    `json:"correctAnswer"`
	IsCorrect       *bool  `json:"isCorrect"`
	IsPretest       bool   `json:"isPretest"`
	MarkedForReview bool   `json:"markedForReview"`
}

// SATSection mirrors one adaptive/scaled SAT section outcome.
type SATSection struct {
	SectionKey  string      `json:"sectionKey"`
	Route       *string     `json:"route"`
	RawCorrect  int64       `json:"rawCorrect"`
	Operational int64       `json:"operationalQuestionCount"`
	Scaled      *int        `json:"scaledScore"`
	Details     any         `json:"details"`
	Modules     []SATModule `json:"modules"`
}

// SATDetail is the full SAT result with adaptive/scaled sections.
type SATDetail struct {
	Summary   ResultSummary `json:"summary"`
	Payload   any           `json:"scorePayload"`
	Sections  []SATSection  `json:"sections"`
	Questions []SATQuestion `json:"questions"`
}

// ACTScienceRow is one ACT science outcome row.
type ACTScienceRow struct {
	AttemptID  string  `json:"attemptId"`
	TotalScore int     `json:"totalScore"`
	MaxScore   int     `json:"maxScore"`
	Percentage float64 `json:"percentage"`
	Outcome    string  `json:"outcomeStatus"`
	Release    string  `json:"releaseStatus"`
}

// Analytics mirrors grading::analytics: one aggregate row over the latest
// student_results version per submission (ielts provider only). Scope follows
// append_result_scope: platform readers (admin/admin_observer) see all rows;
// tenant actors narrow to their organization plus a live staff assignment;
// actors with neither see zero rows (AND 1 = 0).
func (s *Service) Analytics(ctx context.Context, actor auth.ActorContext) (Analytics, error) {
	query := "SELECT COUNT(*) AS total_results, COUNT(CASE WHEN results.release_status = \u0027released\u0027 THEN 1 END) AS released_results, COUNT(CASE WHEN results.release_status = \u0027ready_to_release\u0027 THEN 1 END) AS ready_to_release, COALESCE(AVG(results.overall_band), 0) AS average_overall_band FROM student_results results JOIN student_submissions submissions ON submissions.id = results.submission_id JOIN exam_schedules schedules ON schedules.id = submissions.schedule_id WHERE submissions.provider_key = \u0027ielts\u0027 AND results.version = (SELECT MAX(latest.version) FROM student_results latest WHERE latest.submission_id = results.submission_id)"
	args := []any{}
	if actor.IsPlatformRead() {
		// Platform scope: no additional predicate.
	} else if actor.OrgID != nil && *actor.OrgID != "" {
		query += " AND schedules.organization_id = ? AND EXISTS (SELECT 1 FROM schedule_staff_assignments assignment WHERE assignment.schedule_id = submissions.schedule_id AND assignment.user_id = ? AND assignment.role = ? AND assignment.revoked_at IS NULL)"
		args = append(args, *actor.OrgID, actor.UserID, actor.Role)
	} else {
		query += " AND 1 = 0"
	}
	var out Analytics
	if err := s.db.QueryRowContext(ctx, query, args...).Scan(&out.TotalResults, &out.ReleasedResults, &out.ReadyToRelease, &out.AverageOverallBand); err != nil {
		return Analytics{}, err
	}
	return out, nil
}

// ListDashboard returns the latest result row for every provider visible to
// the actor. The endpoint intentionally has one provider-neutral contract so
// the admin surface cannot silently fall back to a fabricated IELTS table
// when SAT or ACT attempts are present.
func (s *Service) ListDashboard(ctx context.Context, actor auth.ActorContext, provider string, limit int) ([]DashboardResult, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	provider = strings.TrimSpace(provider)
	switch provider {
	case "", "ielts", "sat", "act":
	default:
		return nil, &apperrors.Error{Code: apperrors.CodeValidation, Message: "provider must be ielts, sat, or act.", HTTPStatus: 422}
	}

	rows := make([]DashboardResult, 0, limit)
	var err error
	if provider == "" || provider == "ielts" {
		var ielts []DashboardResult
		ielts, err = s.listIELTSDashboard(ctx, actor, limit)
		if err != nil {
			return nil, err
		}
		rows = append(rows, ielts...)
	}
	if provider == "" || provider == "sat" || provider == "act" {
		var assessment []DashboardResult
		assessment, err = s.listAssessmentDashboard(ctx, actor, provider, limit)
		if err != nil {
			return nil, err
		}
		rows = append(rows, assessment...)
	}

	sort.SliceStable(rows, func(i, j int) bool {
		left, right := rows[i].SubmittedAt, rows[j].SubmittedAt
		switch {
		case left == nil && right == nil:
			return rows[i].ID > rows[j].ID
		case left == nil:
			return false
		case right == nil:
			return true
		default:
			if left.Equal(*right) {
				return rows[i].ID > rows[j].ID
			}
			return left.After(*right)
		}
	})
	if len(rows) > limit {
		rows = rows[:limit]
	}
	return rows, nil
}

func (s *Service) listIELTSDashboard(ctx context.Context, actor auth.ActorContext, limit int) ([]DashboardResult, error) {
	query := `
		SELECT result.id, result.submission_id, submission.attempt_id,
			result.release_status, result.overall_band, result.section_bands,
			submission.student_id, submission.student_name, submission.student_email,
			sch.id, submission.exam_id, sch.exam_title,
			version.version_number, sch.cohort_name, sch.institution,
			submission.submitted_at
		FROM student_results result
		JOIN student_submissions submission ON submission.id = result.submission_id
		JOIN exam_schedules sch ON sch.id = submission.schedule_id
		JOIN exam_versions version ON version.id = submission.published_version_id
		WHERE submission.provider_key = 'ielts'
		  AND result.version = (
			SELECT MAX(latest.version)
			FROM student_results latest
			WHERE latest.submission_id = result.submission_id
		  )`
	scope, args := resultScope("sch", actor)
	query += scope + " ORDER BY submission.submitted_at DESC, result.id DESC LIMIT ?"
	args = append(args, limit)
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]DashboardResult, 0, limit)
	for rows.Next() {
		var (
			row          DashboardResult
			submissionID sql.NullString
			email        sql.NullString
			overallBand  sql.NullFloat64
			sectionBands sql.NullString
			institution  sql.NullString
			submittedAt  sql.NullTime
		)
		if err := rows.Scan(
			&row.ID, &submissionID, &row.AttemptID, &row.ReleaseStatus,
			&overallBand, &sectionBands, &row.StudentID, &row.StudentName,
			&email, &row.ScheduleID, &row.ExamID, &row.ExamTitle,
			&row.VersionNumber, &row.CohortName, &institution, &submittedAt,
		); err != nil {
			return nil, err
		}
		row.ProviderKey = "ielts"
		row.OutcomeStatus = OutcomeScored
		row.SubmissionID = nullableStringPtr(submissionID)
		row.OverallBand = nullableFloatPtr(overallBand)
		row.SectionBands = decodeSectionBands(sectionBands)
		row.StudentEmail = nullableStringPtr(email)
		row.Institution = nullableStringPtr(institution)
		row.SubmittedAt = nullableTimePtr(submittedAt)
		out = append(out, row)
	}
	return out, rows.Err()
}

func (s *Service) listAssessmentDashboard(ctx context.Context, actor auth.ActorContext, provider string, limit int) ([]DashboardResult, error) {
	query := `
		SELECT ar.id, ar.submission_id, ar.attempt_id, ar.provider_key,
			ar.outcome_status, ar.total_score, ar.release_status,
			a.candidate_id, a.candidate_name, a.candidate_email,
			sch.id, a.exam_id, sch.exam_title, sch.cohort_name, sch.institution,
			version.version_number, a.submitted_at,
			COALESCE(
				JSON_UNQUOTE(JSON_EXTRACT(ar.score_payload, '$.score.maxScore')),
				JSON_UNQUOTE(JSON_EXTRACT(ar.score_payload, '$.maxScore')),
				''
			),
			COALESCE(
				JSON_UNQUOTE(JSON_EXTRACT(ar.score_payload, '$.score.percentage')),
				JSON_UNQUOTE(JSON_EXTRACT(ar.score_payload, '$.percentage')),
				''
			)
		FROM assessment_results ar
		JOIN student_attempts a ON a.id = ar.attempt_id
		JOIN exam_schedules sch ON sch.id = a.schedule_id
		JOIN exam_versions version ON version.id = a.published_version_id
		WHERE a.submitted_at IS NOT NULL`
	args := []any{}
	if provider != "" {
		query += " AND ar.provider_key = ?"
		args = append(args, provider)
	} else {
		query += " AND ar.provider_key IN ('sat', 'act')"
	}
	scope, scopeArgs := resultScope("sch", actor)
	query += scope + " ORDER BY a.submitted_at DESC, ar.id DESC LIMIT ?"
	args = append(args, scopeArgs...)
	args = append(args, limit)
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]DashboardResult, 0, limit)
	for rows.Next() {
		var (
			row                       DashboardResult
			submissionID, email       sql.NullString
			totalScore                sql.NullInt64
			institution               sql.NullString
			submittedAt               sql.NullTime
			maxScoreText, percentText sql.NullString
		)
		if err := rows.Scan(
			&row.ID, &submissionID, &row.AttemptID, &row.ProviderKey,
			&row.OutcomeStatus, &totalScore, &row.ReleaseStatus,
			&row.StudentID, &row.StudentName, &email, &row.ScheduleID,
			&row.ExamID, &row.ExamTitle, &row.CohortName, &institution,
			&row.VersionNumber, &submittedAt, &maxScoreText, &percentText,
		); err != nil {
			return nil, err
		}
		row.SubmissionID = nullableStringPtr(submissionID)
		row.TotalScore = nullableIntPtr(totalScore)
		row.StudentEmail = nullableStringPtr(email)
		row.Institution = nullableStringPtr(institution)
		row.SubmittedAt = nullableTimePtr(submittedAt)
		row.MaxScore = parseIntPtr(maxScoreText.String)
		row.Percentage = parseFloatPtr(percentText.String)
		out = append(out, row)
	}
	return out, rows.Err()
}

func resultScope(scheduleAlias string, actor auth.ActorContext) (string, []any) {
	if actor.IsPlatformRead() {
		return "", nil
	}
	if actor.OrgID == nil || strings.TrimSpace(*actor.OrgID) == "" {
		return " AND 1 = 0", nil
	}
	return " AND " + scheduleAlias + ".organization_id = ? AND EXISTS (SELECT 1 FROM schedule_staff_assignments assignment WHERE assignment.schedule_id = " + scheduleAlias + ".id AND assignment.user_id = ? AND assignment.role = ? AND assignment.revoked_at IS NULL)", []any{*actor.OrgID, actor.UserID, actor.Role}
}

func decodeSectionBands(raw sql.NullString) map[string]float64 {
	if !raw.Valid || strings.TrimSpace(raw.String) == "" {
		return nil
	}
	var out map[string]float64
	if err := json.Unmarshal([]byte(raw.String), &out); err != nil {
		return nil
	}
	return out
}

func nullableStringPtr(value sql.NullString) *string {
	if !value.Valid {
		return nil
	}
	out := value.String
	return &out
}

func nullableIntPtr(value sql.NullInt64) *int {
	if !value.Valid {
		return nil
	}
	out := int(value.Int64)
	return &out
}

func nullableFloatPtr(value sql.NullFloat64) *float64 {
	if !value.Valid {
		return nil
	}
	out := value.Float64
	return &out
}

func nullableTimePtr(value sql.NullTime) *time.Time {
	if !value.Valid {
		return nil
	}
	out := value.Time.UTC()
	return &out
}

func parseIntPtr(value string) *int {
	parsed, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil {
		return nil
	}
	return &parsed
}

func parseFloatPtr(value string) *float64 {
	parsed, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
	if err != nil {
		return nil
	}
	return &parsed
}

// ListReadyToRelease returns scored, unreleased assessment results.
func (s *Service) ListReadyToRelease(ctx context.Context, actor auth.ActorContext, provider string, limit int) ([]ResultSummary, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	query := `
		SELECT ar.id, ar.submission_id, ar.attempt_id, ar.provider_key, ar.outcome_status, ar.total_score, ar.release_status,
			a.schedule_id, a.exam_id, sch.exam_title, version.version_number,
			a.candidate_id, a.candidate_name, a.candidate_email, sch.cohort_name, a.submitted_at
		FROM assessment_results ar
		JOIN student_attempts a ON a.id = ar.attempt_id
		JOIN exam_schedules sch ON sch.id = a.schedule_id
		JOIN exam_versions version ON version.id = a.published_version_id
		WHERE ar.outcome_status = 'scored' AND ar.release_status = 'ready_to_release'`
	args := []any{}
	if strings.TrimSpace(provider) != "" {
		query += " AND ar.provider_key = ?"
		args = append(args, provider)
	}
	if actor.IsPlatformRead() {
		// Platform scope: no additional predicate.
	} else if actor.OrgID != nil && *actor.OrgID != "" {
		query += " AND sch.organization_id = ? AND EXISTS (SELECT 1 FROM schedule_staff_assignments assignment WHERE assignment.schedule_id = a.schedule_id AND assignment.user_id = ? AND assignment.role = ? AND assignment.revoked_at IS NULL)"
		args = append(args, *actor.OrgID, actor.UserID, actor.Role)
	} else {
		query += " AND 1 = 0"
	}
	query += " ORDER BY ar.created_at ASC LIMIT ?"
	args = append(args, limit)
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ResultSummary
	for rows.Next() {
		var r ResultSummary
		var total sql.NullInt64
		var sub, email sql.NullString
		var submittedAt sql.NullTime
		if err := rows.Scan(&r.ID, &sub, &r.AttemptID, &r.ProviderKey, &r.Outcome, &total, &r.ReleaseState,
			&r.ScheduleID, &r.ExamID, &r.ExamTitle, &r.VersionNumber,
			&r.StudentID, &r.StudentName, &email, &r.CohortName, &submittedAt); err != nil {
			return nil, err
		}
		r.SubmissionID = nullableStringPtr(sub)
		r.StudentEmail = nullableStringPtr(email)
		r.SubmittedAt = nullableTimePtr(submittedAt)
		r.TotalScore = nullableIntPtr(total)
		if r.ProviderKey == "sat" {
			r.ScoreKind = "practice"
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// GetSATResult loads one SAT result with its adaptive/scaled sections.
// The actor scope mirrors ListDashboard/resultScope: platform readers see
// all rows; tenant actors narrow to their organization plus a live staff
// assignment; actors with neither see NOT_FOUND (never cross-schedule
// state, and graders cannot probe other schedules by result id).
func (s *Service) GetSATResult(ctx context.Context, actor auth.ActorContext, resultID string) (*SATDetail, error) {
	var (
		id, attemptID, provider, outcome, release string
		sub, email                                sql.NullString
		studentID, studentName                    string
		total                                     sql.NullInt64
		payload                                   sql.NullString
		submittedAt                               sql.NullTime
		scheduleID, examID, examTitle, cohortName string
		versionNumber                             int
	)
	scope, scopeArgs := resultScope("sch", actor)
	query := `
		SELECT ar.id, ar.attempt_id, ar.submission_id, ar.provider_key, ar.outcome_status,
			ar.total_score, ar.score_payload, ar.release_status,
			a.schedule_id, a.exam_id, sch.exam_title, version.version_number,
			a.candidate_id, a.candidate_name, a.candidate_email, sch.cohort_name, a.submitted_at
		FROM assessment_results ar
		JOIN student_attempts a ON a.id = ar.attempt_id
		JOIN exam_schedules sch ON sch.id = a.schedule_id
		JOIN exam_versions version ON version.id = a.published_version_id
		WHERE ar.id = ? AND ar.provider_key = 'sat'` + scope
	args := append([]any{resultID}, scopeArgs...)
	err := s.db.QueryRowContext(ctx, query, args...).
		Scan(&id, &attemptID, &sub, &provider, &outcome, &total, &payload, &release,
			&scheduleID, &examID, &examTitle, &versionNumber,
			&studentID, &studentName, &email, &cohortName, &submittedAt)
	if err == sql.ErrNoRows {
		return nil, apperrors.New(apperrors.CodeNotFound, "SAT result not found.")
	}
	if err != nil {
		return nil, err
	}
	sum := ResultSummary{
		ID: id, AttemptID: attemptID, ProviderKey: provider, Outcome: outcome,
		ScoreKind:    "practice",
		ReleaseState: release, ScheduleID: scheduleID, ExamID: examID,
		ExamTitle: examTitle, VersionNumber: versionNumber, StudentID: studentID,
		StudentName: studentName, CohortName: cohortName,
		SubmissionID: nullableStringPtr(sub), TotalScore: nullableIntPtr(total),
		StudentEmail: nullableStringPtr(email), SubmittedAt: nullableTimePtr(submittedAt),
	}
	var payloadVal any
	if payload.Valid {
		_ = json.Unmarshal([]byte(payload.String), &payloadVal)
	}
	sections, err := s.satSections(ctx, id)
	if err != nil {
		return nil, err
	}
	// Module + question detail is best-effort read-path enrichment: section
	// aggregates stay authoritative, so a detail-query failure degrades to
	// empty detail instead of failing the whole result.
	if sum.Outcome == OutcomeScored {
		if modules, byModule, err := s.satModules(ctx, attemptID); err == nil {
			attachSATModules(sections, modules, byModule)
		}
		if questions, err := s.satQuestions(ctx, attemptID); err == nil {
			return &SATDetail{Summary: sum, Payload: payloadVal, Sections: sections, Questions: questions}, nil
		}
	}
	return &SATDetail{Summary: sum, Payload: payloadVal, Sections: sections, Questions: []SATQuestion{}}, nil
}

// ListACTScience serves GET /api/v1/results/act-science from the sealed
// final_submission score, joined to the invalidation-aware outcome row.
func (s *Service) ListACTScience(ctx context.Context, scheduleID string, limit int) ([]ACTScienceRow, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	query := `
		SELECT a.id,
			COALESCE(JSON_UNQUOTE(JSON_EXTRACT(a.final_submission, '$.score.totalScore')), '0'),
			COALESCE(JSON_UNQUOTE(JSON_EXTRACT(a.final_submission, '$.score.maxScore')), '0'),
			COALESCE(JSON_UNQUOTE(JSON_EXTRACT(a.final_submission, '$.score.percentage')), '0'),
			COALESCE(ar.outcome_status, 'scored'),
			COALESCE(ar.release_status, 'ready_to_release')
		FROM student_attempts a
		JOIN exam_entities e ON e.id = a.exam_id
		LEFT JOIN assessment_results ar ON ar.attempt_id = a.id AND ar.provider_key = 'act'
		WHERE e.provider_key = 'act'
		  AND a.submitted_at IS NOT NULL`
	args := []any{}
	if strings.TrimSpace(scheduleID) != "" {
		query += " AND a.schedule_id = ?"
		args = append(args, scheduleID)
	}
	query += " ORDER BY a.submitted_at DESC LIMIT ?"
	args = append(args, limit)
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ACTScienceRow
	for rows.Next() {
		var r ACTScienceRow
		var totalStr, maxStr, pctStr string
		if err := rows.Scan(&r.AttemptID, &totalStr, &maxStr, &pctStr, &r.Outcome, &r.Release); err != nil {
			return nil, err
		}
		r.TotalScore = parseIntPrefix(totalStr)
		r.MaxScore = parseIntPrefix(maxStr)
		_, _ = fmt.Sscanf(strings.TrimSpace(pctStr), "%f", &r.Percentage)
		out = append(out, r)
	}
	return out, rows.Err()
}

// RematerializeFromSnapshot rebuilds a released IELTS result view from the
// persisted student_results snapshot row instead of recomputing bands from
// live answers. The snapshot is authoritative once released.
func (s *Service) RematerializeFromSnapshot(ctx context.Context, actor auth.ActorContext, resultID string) (map[string]any, error) {
	var (
		submissionID, payloadListening, payloadReading, payloadWriting, payloadSpeaking sql.NullString
		bands                                                                           sql.NullString
		studentID                                                                       sql.NullString
		band                                                                            sql.NullFloat64
		release                                                                         string
	)
	err := s.db.QueryRowContext(ctx, `
		SELECT submission_id, student_id, release_status, overall_band, section_bands,
			listening_result, reading_result, writing_results, speaking_result
		FROM student_results WHERE id = ?`, resultID).
		Scan(&submissionID, &studentID, &release, &band, &bands,
			&payloadListening, &payloadReading, &payloadWriting, &payloadSpeaking)
	if err == sql.ErrNoRows {
		return nil, apperrors.New(apperrors.CodeNotFound, "Result not found.")
	}
	if err != nil {
		return nil, err
	}
	if actor.Role == auth.RoleStudent {
		if !studentID.Valid || actor.UserID != studentID.String {
			return nil, apperrors.New(apperrors.CodeNotFound, "Result not found.")
		}
	}
	if release != ReleaseReleased && release != ReleaseReopened {
		return nil, &apperrors.Error{Code: apperrors.CodeConflict, Message: "Only released results re-materialize from snapshot.", HTTPStatus: 409}
	}
	out := map[string]any{"resultId": resultID, "releaseStatus": release}
	if submissionID.Valid {
		out["submissionId"] = submissionID.String
	}
	if band.Valid {
		out["overallBand"] = band.Float64
	}
	for key, raw := range map[string]sql.NullString{
		"sectionBands": bands, "listening": payloadListening, "reading": payloadReading,
		"writing": payloadWriting, "speaking": payloadSpeaking,
	} {
		if raw.Valid && strings.TrimSpace(raw.String) != "" {
			var v any
			if json.Unmarshal([]byte(raw.String), &v) == nil {
				out[key] = v
			} else {
				out[key] = raw.String
			}
		}
	}
	return out, nil
}

func (s *Service) satSections(ctx context.Context, resultID string) ([]SATSection, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT section_key, route, raw_correct, operational_question_count, scaled_score, details
		FROM assessment_section_results WHERE assessment_result_id = ?`, resultID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []SATSection{}
	for rows.Next() {
		var sec SATSection
		var route sql.NullString
		var scaled sql.NullInt64
		var details sql.NullString
		if err := rows.Scan(&sec.SectionKey, &route, &sec.RawCorrect, &sec.Operational, &scaled, &details); err != nil {
			return nil, err
		}
		if route.Valid {
			v := route.String
			sec.Route = &v
		}
		if scaled.Valid {
			v := int(scaled.Int64)
			sec.Scaled = &v
		}
		if details.Valid {
			var v any
			if json.Unmarshal([]byte(details.String), &v) == nil {
				sec.Details = v
			}
		}
		sec.Modules = []SATModule{}
		out = append(out, sec)
	}
	if out == nil {
		out = []SATSection{}
	}
	return out, rows.Err()
}

// satModules loads one row per administered module attempt for an SAT
// attempt, ordered by section then module display order. Attempts without
// module rows (provisional, invalidated) yield an empty slice, never an
// error, so section aggregates stay authoritative.
func (s *Service) satModules(ctx context.Context, attemptID string) ([]SATModule, map[string]string, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT s.section_key, m.module_key, m.adaptive_role, m.display_order,
			ma.state, ma.raw_correct, ma.operational_question_count
		FROM assessment_module_attempts ma
		JOIN assessment_modules m ON m.id = ma.module_id
		JOIN assessment_sections s ON s.id = m.section_id
		WHERE ma.attempt_id = ?
		ORDER BY s.display_order, m.display_order`, attemptID)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	modules := []SATModule{}
	byModule := map[string]string{}
	for rows.Next() {
		var sectionKey, moduleKey, role, state string
		var displayOrder int
		var raw, operational sql.NullInt64
		if err := rows.Scan(&sectionKey, &moduleKey, &role, &displayOrder, &state, &raw, &operational); err != nil {
			return nil, nil, err
		}
		mod := SATModule{
			ModuleKey: moduleKey, AdaptiveRole: role,
			State: state, IsAdministered: true, DisplayOrder: displayOrder,
		}
		if raw.Valid {
			mod.RawCorrect = raw.Int64
		}
		if operational.Valid {
			mod.Operational = operational.Int64
		}
		modules = append(modules, mod)
		byModule[moduleKey] = sectionKey
	}
	return modules, byModule, rows.Err()
}

// attachSATModules nests each administered module under its section.
func attachSATModules(sections []SATSection, modules []SATModule, byModule map[string]string) {
	if len(modules) == 0 {
		return
	}
	index := map[string]int{}
	for i := range sections {
		index[sections[i].SectionKey] = i
		if sections[i].Modules == nil {
			sections[i].Modules = []SATModule{}
		}
	}
	for _, mod := range modules {
		sectionKey, ok := byModule[mod.ModuleKey]
		if !ok {
			continue
		}
		pos, ok := index[sectionKey]
		if !ok {
			continue
		}
		sections[pos].Modules = append(sections[pos].Modules, mod)
	}
}

// satQuestions loads one row per administered SAT question with the sealed
// response and a server-computed verdict. Verdict semantics:
//   - pretest, unanswered, missing key, or malformed definition/render
//     => IsCorrect nil (JSON null), never incorrect;
//   - otherwise the seal-time comparison (single-choice option id,
//     student-produced accepted/numeric-tolerance) decides true/false.
//
// Rows pin to eq.question_revision_id (the administered revision), cap at
// 500, and order deterministically by section/module/question display
// order so large adaptive exams paginate stably on the client.
func (s *Service) satQuestions(ctx context.Context, attemptID string) ([]SATQuestion, error) {
	out := []SATQuestion{}
	rows, err := s.db.QueryContext(ctx, `
		SELECT s.section_key, m.module_key, m.display_order, eq.display_order,
			eq.question_id, eq.is_pretest, ar.marked_for_review, ar.response,
			CAST(qr.answer_definition AS CHAR)
		FROM assessment_module_attempts ma
		JOIN assessment_modules m ON m.id = ma.module_id
		JOIN assessment_sections s ON s.id = m.section_id
		JOIN assessment_exam_questions eq ON eq.module_id = m.id
		JOIN assessment_question_revisions qr ON qr.id = eq.question_revision_id
		LEFT JOIN assessment_question_responses ar
			ON ar.module_attempt_id = ma.id AND ar.exam_question_id = eq.id
		WHERE ma.attempt_id = ?
		ORDER BY s.display_order, m.display_order, eq.display_order
		LIMIT 500`, attemptID)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var sectionKey, moduleKey, questionID string
		var moduleOrder, questionOrder int
		var isPretest bool
		var marked sql.NullBool
		var response, answerDef sql.NullString
		if err := rows.Scan(&sectionKey, &moduleKey, &moduleOrder, &questionOrder,
			&questionID, &isPretest, &marked, &response, &answerDef); err != nil {
			return out, err
		}
		question := SATQuestion{
			QuestionID: questionID, DisplayOrder: questionOrder,
			ModuleKey: moduleKey, SectionKey: sectionKey,
			IsPretest: isPretest,
			MarkedForReview: marked.Valid && marked.Bool,
		}
		if response.Valid && strings.TrimSpace(response.String) != "" {
			var decoded any
			if json.Unmarshal([]byte(response.String), &decoded) == nil {
				question.Response = decoded
			} else {
				question.Response = response.String
			}
		}
		answerJSON := ""
		if answerDef.Valid {
			answerJSON = answerDef.String
		}
		if key, ok := assessscore.SATCorrectAnswer(answerJSON); ok {
			question.CorrectAnswer = key
		}
		// Null-verdict rule: pretest, unanswered, or key-less rows never
		// claim incorrect. Only a answered, keyed, operational row gets a
		// true/false verdict from the seal-time comparison.
		answered := response.Valid && strings.TrimSpace(response.String) != "" && response.String != "null"
		if !isPretest && answered && assessscore.SATHasKey(answerJSON) {
			verdict := assessscore.SATResponseCorrect(answerJSON, response.Valid, response.String)
			question.IsCorrect = &verdict
		}
		out = append(out, question)
	}
	if err := rows.Err(); err != nil {
		return out, err
	}
	return out, nil
}

func parseIntPrefix(s string) int {
	n := 0
	for _, c := range strings.TrimSpace(s) {
		if c < '0' || c > '9' {
			break
		}
		n = n*10 + int(c-'0')
	}
	return n
}
