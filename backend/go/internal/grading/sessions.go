package grading

import (
	"context"
	"database/sql"
	"encoding/json"
	"sort"
	"strings"
	"time"

	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/platform/apperrors"
)

// Grading session read model (GET /grading/sessions, GET /grading/sessions/{id}).
//
// Mirrors backend/crates/api/src/routes/grading.rs (list_sessions, get_session)
// and backend/crates/application/src/grading/mod.rs
// (list_sessions, list_sessions_page, get_session_detail_page) with the
// domain DTOs in backend/crates/domain/src/grading.rs
// (GradingSession, GradingSessionDetail, GradingSessionPagination,
// GradingSessionPage, camelCase wire shape).
//
// Preview-runtime schedules (reserved `__preview_runtime__:` cohort
// namespace) are always excluded so they never surface in grading.
//
// Grader scope: Admin/AdminObserver see all rows; graders are restricted to
// their assigned schedules via the allowedScheduleIDs set, which the HTTP
// layer loads from schedule_staff_assignments (role='grader', revoked_at IS
// NULL, same query as the Rust assigned_schedule_ids helper). When that
// mechanism yields no assignments the list returns no rows and the detail
// path returns NOT_FOUND instead of leaking cross-schedule state. The Go
// auth.ActorContext has no per-request DB lookup, so unlike the Rust
// service the schedule-scope fallback (ctx.ScheduleScope) only applies when
// no explicit allow-list is passed; handlers always pass the allow-list for
// graders, keeping assignment checks at the HTTP data boundary.
const previewRuntimeCohortPrefix = "__preview_runtime__:"

const gradingSessionColumns = "grading_sessions.id, grading_sessions.schedule_id, " +
	"grading_sessions.exam_id, grading_sessions.exam_title, " +
	"grading_sessions.published_version_id, grading_sessions.cohort_name, " +
	"grading_sessions.institution, grading_sessions.start_time, grading_sessions.end_time, " +
	"grading_sessions.status, grading_sessions.total_students, grading_sessions.submitted_count, " +
	"grading_sessions.pending_manual_reviews, grading_sessions.in_progress_reviews, " +
	"grading_sessions.finalized_reviews, grading_sessions.overdue_reviews, " +
	"grading_sessions.assigned_teachers, grading_sessions.created_at, " +
	"grading_sessions.created_by, grading_sessions.updated_at"

const gradingSubmissionColumns = "s.id, s.attempt_id, s.schedule_id, s.exam_id, " +
	"s.published_version_id, s.student_id, s.student_name, s.student_email, " +
	"s.cohort_name, s.submitted_at, s.time_spent_seconds, s.grading_status, " +
	"s.assigned_teacher_id, s.assigned_teacher_name, s.is_flagged, s.flag_reason, " +
	"s.is_overdue, s.due_date, s.section_statuses, s.created_at, s.updated_at"

// GradingSession is one grading_sessions read-model row (camelCase).
type GradingSession struct {
	ID                   string    `json:"id"`
	ScheduleID           string    `json:"scheduleId"`
	ExamID               string    `json:"examId"`
	ExamTitle            string    `json:"examTitle"`
	PublishedVersionID   string    `json:"publishedVersionId"`
	CohortName           string    `json:"cohortName"`
	Institution          *string   `json:"institution,omitempty"`
	StartTime            time.Time `json:"startTime"`
	EndTime              time.Time `json:"endTime"`
	Status               string    `json:"status"`
	TotalStudents        int       `json:"totalStudents"`
	SubmittedCount       int       `json:"submittedCount"`
	PendingManualReviews int       `json:"pendingManualReviews"`
	InProgressReviews    int       `json:"inProgressReviews"`
	FinalizedReviews     int       `json:"finalizedReviews"`
	OverdueReviews       int       `json:"overdueReviews"`
	AssignedTeachers     any       `json:"assignedTeachers"`
	CreatedAt            time.Time `json:"createdAt"`
	CreatedBy            string    `json:"createdBy"`
	UpdatedAt            time.Time `json:"updatedAt"`
}

// GradingSessionPagination mirrors the Rust GradingSessionPagination DTO.
type GradingSessionPagination struct {
	Page     uint64 `json:"page"`
	PageSize uint64 `json:"pageSize"`
	Total    uint64 `json:"total"`
	HasMore  bool   `json:"hasMore"`
}

// GradingSessionPage is one page of the grading queue plus its cursor.
type GradingSessionPage struct {
	Sessions   []GradingSession         `json:"sessions"`
	Pagination GradingSessionPagination `json:"pagination"`
}

// GradingSubmission is the student_submissions row projection used by the
// session detail page (camelCase). nickname/ieltsCourse resolve from
// schedule_registrations.metadata, mirroring the Rust student_submission_query
// join; studentEmail is omitted when NULL.
type GradingSubmission struct {
	ID                  string     `json:"id"`
	AttemptID           string     `json:"attemptId"`
	ScheduleID          string     `json:"scheduleId"`
	ExamID              string     `json:"examId"`
	PublishedVersionID  string     `json:"publishedVersionId"`
	StudentID           string     `json:"studentId"`
	StudentName         string     `json:"studentName"`
	StudentEmail        *string    `json:"studentEmail,omitempty"`
	Nickname            *string    `json:"nickname,omitempty"`
	IELTSCourse         *string    `json:"ieltsCourse,omitempty"`
	CohortName          string     `json:"cohortName"`
	SubmittedAt         time.Time  `json:"submittedAt"`
	TimeSpentSeconds    int        `json:"timeSpentSeconds"`
	GradingStatus       string     `json:"gradingStatus"`
	AssignedTeacherID   *string    `json:"assignedTeacherId,omitempty"`
	AssignedTeacherName *string    `json:"assignedTeacherName,omitempty"`
	IsFlagged           bool       `json:"isFlagged"`
	FlagReason          *string    `json:"flagReason,omitempty"`
	IsOverdue           bool       `json:"isOverdue"`
	DueDate             *time.Time `json:"dueDate,omitempty"`
	SectionStatuses     any        `json:"sectionStatuses"`
	CreatedAt           time.Time  `json:"createdAt"`
	UpdatedAt           time.Time  `json:"updatedAt"`
}

// GradingSessionDetail is one session plus its submissions page.
type GradingSessionDetail struct {
	Session     GradingSession            `json:"session"`
	Submissions []GradingSubmission       `json:"submissions"`
	Pagination  *GradingSessionPagination `json:"pagination,omitempty"`
}

// GetSubmission returns the complete IELTS submission read model used by the
// student review workspace. Keeping this query beside the session detail query
// prevents the single-submission path from drifting into a smaller, legacy
// payload.
func (s *Service) GetSubmission(ctx context.Context, submissionID string) (GradingSubmission, error) {
	query := "SELECT " + gradingSubmissionColumns + ", " +
		"JSON_UNQUOTE(JSON_EXTRACT(r.metadata, '$.nickname')), " +
		"JSON_UNQUOTE(JSON_EXTRACT(r.metadata, '$.ieltsCourse')) " +
		"FROM student_submissions s LEFT JOIN schedule_registrations r " +
		"ON r.schedule_id = s.schedule_id AND r.student_id = s.student_id " +
		"WHERE s.id = ? AND s.provider_key = 'ielts'"
	submission, err := scanGradingSubmission(s.db.QueryRowContext(ctx, query, submissionID))
	if err == sql.ErrNoRows {
		return GradingSubmission{}, notFoundError("Submission not found.")
	}
	if err != nil {
		return GradingSubmission{}, err
	}
	return submission, nil
}

// IsGradingAdmin reports the all-rows scope (Admin/AdminObserver).
func IsGradingAdmin(role string) bool {
	return role == auth.RoleAdmin || role == auth.RoleAdminObserver
}

// ClampSessionsLimit mirrors the Rust legacy list clamp (1..500, default 200).
func ClampSessionsLimit(limit int) int {
	if limit <= 0 {
		return 200
	}
	if limit < 1 {
		return 1
	}
	if limit > 500 {
		return 500
	}
	return limit
}

func clampSessionPage(page uint64) uint64 {
	if page < 1 {
		return 1
	}
	return page
}

func clampSessionPageSize(pageSize uint64) uint64 {
	if pageSize < 1 {
		return 1
	}
	if pageSize > 100 {
		return 100
	}
	return pageSize
}

func gradingSessionAdmin(role string) bool { return IsGradingAdmin(role) }

type gradingSessionWhere struct {
	clause string
	args   []any
}

// sessionListWhere builds the shared WHERE fragment for the session list:
// e.provider_key='ielts' + preview-runtime cohort exclusion + optional
// LIKE search on exam_title/cohort_name + grader IN-list. Empty grader
// allow-lists (and graders with neither allow-list nor schedule scope)
// collapse to WHERE 1=0 so no rows leak.
func sessionListWhere(role string, scheduleScope []string, allowed []string, search string) gradingSessionWhere {
	exclusion := "grading_sessions.cohort_name NOT LIKE '" + previewRuntimeCohortPrefix + "%'"
	where := "e.provider_key = 'ielts' AND " + exclusion
	var args []any
	if strings.TrimSpace(search) != "" {
		where += " AND (grading_sessions.exam_title LIKE ? OR grading_sessions.cohort_name LIKE ?)"
		pattern := "%" + strings.TrimSpace(search) + "%"
		args = append(args, pattern, pattern)
	}
	if gradingSessionAdmin(role) {
		return gradingSessionWhere{clause: where, args: args}
	}
	if allowed != nil {
		if len(allowed) == 0 {
			return gradingSessionWhere{clause: "1=0"}
		}
		sorted := append([]string(nil), allowed...)
		sort.Strings(sorted)
		placeholders := strings.TrimSuffix(strings.Repeat("?,", len(sorted)), ",")
		where = "e.provider_key = 'ielts' AND grading_sessions.schedule_id IN (" + placeholders + ") AND " + exclusion
		if strings.TrimSpace(search) != "" {
			where += " AND (grading_sessions.exam_title LIKE ? OR grading_sessions.cohort_name LIKE ?)"
		}
		listArgs := make([]any, 0, len(sorted)+len(args))
		for _, id := range sorted {
			listArgs = append(listArgs, id)
		}
		listArgs = append(listArgs, args...)
		return gradingSessionWhere{clause: where, args: listArgs}
	}
	if len(scheduleScope) == 1 {
		return gradingSessionWhere{
			clause: "e.provider_key = 'ielts' AND grading_sessions.schedule_id = ? AND " + exclusion + searchSuffix(search),
			args:   append([]any{scheduleScope[0]}, args...),
		}
	}
	return gradingSessionWhere{clause: "1=0"}
}

func searchSuffix(search string) string {
	if strings.TrimSpace(search) == "" {
		return ""
	}
	return " AND (grading_sessions.exam_title LIKE ? OR grading_sessions.cohort_name LIKE ?)"
}

func scanGradingSession(row interface{ Scan(dest ...any) error }) (GradingSession, error) {
	var s GradingSession
	var institution sql.NullString
	var assignedRaw sql.NullString
	if err := row.Scan(&s.ID, &s.ScheduleID, &s.ExamID, &s.ExamTitle, &s.PublishedVersionID,
		&s.CohortName, &institution, &s.StartTime, &s.EndTime, &s.Status,
		&s.TotalStudents, &s.SubmittedCount, &s.PendingManualReviews, &s.InProgressReviews,
		&s.FinalizedReviews, &s.OverdueReviews, &assignedRaw,
		&s.CreatedAt, &s.CreatedBy, &s.UpdatedAt); err != nil {
		return GradingSession{}, err
	}
	if institution.Valid {
		v := institution.String
		s.Institution = &v
	}
	s.AssignedTeachers = gradingJSONValue(assignedRaw)
	return s, nil
}

func gradingJSONValue(raw sql.NullString) any {
	if !raw.Valid || strings.TrimSpace(raw.String) == "" {
		return []any{}
	}
	var v any
	if json.Unmarshal([]byte(raw.String), &v) == nil {
		return v
	}
	return raw.String
}

func nullStringPtr(n sql.NullString) *string {
	if !n.Valid {
		return nil
	}
	v := n.String
	return &v
}

func nullTimePtr(n sql.NullTime) *time.Time {
	if !n.Valid {
		return nil
	}
	v := n.Time.UTC()
	return &v
}

func scanGradingSubmission(row interface{ Scan(dest ...any) error }) (GradingSubmission, error) {
	var s GradingSubmission
	var email, nickname, course, teacherID, teacherName, flagReason sql.NullString
	var dueDate sql.NullTime
	var sectionsRaw sql.NullString
	var flagged, overdue sql.NullBool
	if err := row.Scan(&s.ID, &s.AttemptID, &s.ScheduleID, &s.ExamID,
		&s.PublishedVersionID, &s.StudentID, &s.StudentName, &email,
		&s.CohortName, &s.SubmittedAt, &s.TimeSpentSeconds, &s.GradingStatus,
		&teacherID, &teacherName, &flagged, &flagReason,
		&overdue, &dueDate, &sectionsRaw, &s.CreatedAt, &s.UpdatedAt,
		&nickname, &course); err != nil {
		return GradingSubmission{}, err
	}
	s.StudentEmail = nullStringPtr(email)
	s.Nickname = nullStringPtr(nonEmptyNullString(nickname))
	s.IELTSCourse = nullStringPtr(nonEmptyNullString(course))
	s.AssignedTeacherID = nullStringPtr(teacherID)
	s.AssignedTeacherName = nullStringPtr(teacherName)
	s.FlagReason = nullStringPtr(flagReason)
	s.IsFlagged = flagged.Valid && flagged.Bool
	s.IsOverdue = overdue.Valid && overdue.Bool
	s.DueDate = nullTimePtr(dueDate)
	s.SectionStatuses = gradingJSONValue(sectionsRaw)
	return s, nil
}

func nonEmptyNullString(n sql.NullString) sql.NullString {
	if !n.Valid || strings.TrimSpace(n.String) == "" || n.String == "null" {
		return sql.NullString{}
	}
	// MySQL JSON_UNQUOTE(NULL) yields SQL NULL; JSON_UNQUOTE of a JSON null
	// yields the string "null", which carries no nickname/course value.
	return n
}

func gradingCanReadSession(role string, allowed []string, scope []string, scheduleID string) bool {
	if gradingSessionAdmin(role) {
		return true
	}
	if allowed != nil {
		for _, id := range allowed {
			if id == scheduleID {
				return true
			}
		}
		return false
	}
	for _, id := range scope {
		if id == scheduleID {
			return true
		}
	}
	return false
}

func notFoundError(msg string) *apperrors.Error {
	return apperrors.New(apperrors.CodeNotFound, msg)
}

// ListSessions mirrors the Rust legacy list_sessions: recency-ordered rows
// capped at limit (clamped 1..500, default 200). Admins see all rows;
// graders are narrowed by allowedScheduleIDs (nil allow-list falls back to
// the actor schedule scope; an empty grader set returns no rows).
func (s *Service) ListSessions(ctx context.Context, role string, allowedScheduleIDs []string, scheduleScope []string, limit int) ([]GradingSession, error) {
	capped := ClampSessionsLimit(limit)
	allowed := allowedScheduleIDs
	if !gradingSessionAdmin(role) && allowed == nil {
		allowed = append([]string(nil), scheduleScope...)
	}
	where := sessionListWhere(role, scheduleScope, allowed, "")
	query := "SELECT " + gradingSessionColumns + " FROM grading_sessions " +
		"JOIN exam_entities e ON e.id = grading_sessions.exam_id " +
		"WHERE " + where.clause + " " +
		"ORDER BY grading_sessions.updated_at DESC, grading_sessions.start_time DESC, grading_sessions.id DESC LIMIT ?"
	args := append(append([]any{}, where.args...), capped)
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []GradingSession{}
	for rows.Next() {
		session, err := scanGradingSession(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, session)
	}
	return out, rows.Err()
}

// ListSessionsPage mirrors Rust list_sessions_page: one recency-ordered page
// plus the total count under the same scope, with optional LIKE search on
// exam_title/cohort_name. Page floors at 1; pageSize clamps to 1..100.
func (s *Service) ListSessionsPage(ctx context.Context, role string, allowedScheduleIDs []string, scheduleScope []string, page, pageSize uint64, search string) (GradingSessionPage, error) {
	page = clampSessionPage(page)
	pageSize = clampSessionPageSize(pageSize)
	allowed := allowedScheduleIDs
	if !gradingSessionAdmin(role) && allowed == nil {
		allowed = append([]string(nil), scheduleScope...)
	}
	where := sessionListWhere(role, scheduleScope, allowed, search)
	from := "FROM grading_sessions JOIN exam_entities e ON e.id = grading_sessions.exam_id WHERE " + where.clause
	var total int64
	if err := s.db.QueryRowContext(ctx, "SELECT COUNT(*) "+from, where.args...).Scan(&total); err != nil {
		return GradingSessionPage{}, err
	}
	offset := int64((page - 1) * pageSize)
	query := "SELECT " + gradingSessionColumns + " " + from + " " +
		"ORDER BY grading_sessions.updated_at DESC, grading_sessions.start_time DESC, grading_sessions.id DESC LIMIT ? OFFSET ?"
	args := append(append(append([]any{}, where.args...), int64(pageSize)), offset)
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return GradingSessionPage{}, err
	}
	defer rows.Close()
	sessions := []GradingSession{}
	for rows.Next() {
		session, err := scanGradingSession(rows)
		if err != nil {
			return GradingSessionPage{}, err
		}
		sessions = append(sessions, session)
	}
	if err := rows.Err(); err != nil {
		return GradingSessionPage{}, err
	}
	totalU := uint64(0)
	if total > 0 {
		totalU = uint64(total)
	}
	return GradingSessionPage{
		Sessions: sessions,
		Pagination: GradingSessionPagination{
			Page:     page,
			PageSize: pageSize,
			Total:    totalU,
			HasMore:  offset+int64(pageSize) < total,
		},
	}, nil
}

// GetSessionDetail mirrors Rust get_session_detail_page: loads the session
// (ielts provider only), enforces grader schedule scoping on the session's
// schedule_id, then returns the COUNT plus one submissions page ordered by
// submitted_at DESC. Page floors at 1; pageSize clamps to 1..100.
func (s *Service) GetSessionDetail(ctx context.Context, role string, allowedScheduleIDs []string, scheduleScope []string, sessionID string, page, pageSize uint64) (GradingSessionDetail, error) {
	page = clampSessionPage(page)
	pageSize = clampSessionPageSize(pageSize)
	var session GradingSession
	err := func() error {
		scanned, scanErr := scanGradingSession(s.db.QueryRowContext(ctx,
			"SELECT "+gradingSessionColumns+" FROM grading_sessions "+
				"JOIN exam_entities e ON e.id = grading_sessions.exam_id "+
				"WHERE grading_sessions.id = ? AND e.provider_key = 'ielts'", sessionID))
		session = scanned
		return scanErr
	}()
	if err == sql.ErrNoRows {
		return GradingSessionDetail{}, notFoundError("Resource not found.")
	}
	if err != nil {
		return GradingSessionDetail{}, err
	}
	if !gradingCanReadSession(role, allowedScheduleIDs, scheduleScope, session.ScheduleID) {
		return GradingSessionDetail{}, notFoundError("Resource not found.")
	}
	var total int64
	if err := s.db.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM student_submissions WHERE schedule_id = ? AND provider_key = 'ielts'",
		session.ScheduleID).Scan(&total); err != nil {
		return GradingSessionDetail{}, err
	}
	offset := int64((page - 1) * pageSize)
	subQuery := "SELECT " + gradingSubmissionColumns + ", " +
		"JSON_UNQUOTE(JSON_EXTRACT(r.metadata, '$.nickname')), " +
		"JSON_UNQUOTE(JSON_EXTRACT(r.metadata, '$.ieltsCourse')) " +
		"FROM student_submissions s LEFT JOIN schedule_registrations r " +
		"ON r.schedule_id = s.schedule_id AND r.student_id = s.student_id " +
		"WHERE s.provider_key = 'ielts' AND s.schedule_id = ? " +
		"ORDER BY s.submitted_at DESC, s.id DESC LIMIT ? OFFSET ?"
	rows, err := s.db.QueryContext(ctx, subQuery, session.ScheduleID, int64(pageSize), offset)
	if err != nil {
		return GradingSessionDetail{}, err
	}
	defer rows.Close()
	submissions := []GradingSubmission{}
	for rows.Next() {
		sub, err := scanGradingSubmission(rows)
		if err != nil {
			return GradingSessionDetail{}, err
		}
		submissions = append(submissions, sub)
	}
	if err := rows.Err(); err != nil {
		return GradingSessionDetail{}, err
	}
	totalU := uint64(0)
	if total > 0 {
		totalU = uint64(total)
	}
	return GradingSessionDetail{
		Session:     session,
		Submissions: submissions,
		Pagination: &GradingSessionPagination{
			Page:     page,
			PageSize: pageSize,
			Total:    totalU,
			HasMore:  offset+int64(pageSize) < total,
		},
	}, nil
}
