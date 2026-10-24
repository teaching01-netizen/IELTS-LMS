package assessmentforms

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"strings"
	"time"

	"example.com/ielts-proctoring/internal/assessmentforms/definition"
	"example.com/ielts-proctoring/internal/platform/apperrors"
)

// Response statuses. External Eva is always not_tracked; it is never counted
// as submitted or not submitted.
const (
	StatusSubmitted         = "submitted"
	StatusNotSubmitted      = "not_submitted"
	StatusPendingCompletion = "pending_completion"
	StatusNotTracked        = "not_tracked"
	StatusNotApplicable     = "not_applicable"
)

const (
	DefaultPageSize = 50
	MaxPageSize     = 100
)

// Viewer is the authorized response-viewing scope. Admins see everything
// they can already administer; proctors only their assigned rooms. Builders
// and graders get no answer access from this feature.
type Viewer struct {
	All           bool
	ProctorUserID string
}

type ListFilter struct {
	ExamID, ScheduleID, VersionID, FormKey, Mode, Status, Cursor string
	Limit                                                        int
}

type ResponseRow struct {
	AttemptID     string     `json:"attemptId"`
	StudentName   string     `json:"studentName"`
	StudentEmail  string     `json:"studentEmail"`
	StudentCode   string     `json:"studentCode"`
	ExamID        string     `json:"examId"`
	ExamTitle     string     `json:"examTitle"`
	ScheduleID    string     `json:"scheduleId"`
	ScheduleName  string     `json:"scheduleName"`
	VersionID     string     `json:"versionId"`
	VersionNumber int        `json:"versionNumber"`
	FormKey       string     `json:"formKey"`
	Mode          *string    `json:"mode"`
	Status        string     `json:"status"`
	Collection    string     `json:"collection"`
	ClosedAt      *time.Time `json:"closedAt"`
	Revision      int64      `json:"revision"`
	UpdatedAt     *time.Time `json:"updatedAt"`
}

type ResponsePage struct {
	Items      []ResponseRow `json:"items"`
	NextCursor *string       `json:"nextCursor"`
}

// Status/mode are derived in SQL from the pinned version so status filters
// apply before LIMIT. offcut: JSON_EXTRACT per page candidate; precompute a
// per-version flag column if list scans grow beyond the keyset page.
const (
	evaEnabledSQL = `COALESCE(JSON_EXTRACT(v.config_snapshot, '$.forms.evaSim.enabled') = TRUE, FALSE)`
	evaModeSQL    = `JSON_UNQUOTE(JSON_EXTRACT(v.config_snapshot, '$.forms.evaSim.mode'))`
	hasFormsSQL   = `JSON_CONTAINS_PATH(v.config_snapshot, 'one', '$.forms')`
	hasRegSQL     = `COALESCE(JSON_LENGTH(v.config_snapshot, '$.forms.registration.fields'), 0) > 0`
	// Math in the effective sitting: release scope and access-link scope.
	includesMathSQL = `(COALESCE(v.sat_publish_scope, '') IN ('', 'full', 'math') AND (l.enabled_sections IS NULL OR JSON_CONTAINS(l.enabled_sections, '"math"')))`
	completedSQL    = `(a.delivery_status = 'submitted' AND COALESCE(a.proctor_status, 'active') <> 'terminated' AND s.status <> 'cancelled')`
)

func statusSQL(formKey string) string {
	if formKey == definition.FormRegistration {
		return `CASE WHEN r.attempt_id IS NOT NULL THEN 'submitted' WHEN NOT ` + hasFormsSQL + ` OR NOT ` + hasRegSQL + ` THEN 'not_applicable' ELSE 'not_submitted' END`
	}
	if formKey == definition.FormVerbalEntry || formKey == definition.FormMathEntry {
		section := definition.SectionReadingWriting
		if formKey == definition.FormMathEntry {
			section = definition.SectionMath
		}
		hasSection := `COALESCE(JSON_EXTRACT(v.config_snapshot,'$.forms.schemaVersion')=2,FALSE) AND NOT (JSON_EXTRACT(v.config_snapshot,'$.forms.sectionEntry."` + section + `".enabled') <=> CAST('false' AS JSON)) AND COALESCE(JSON_LENGTH(v.config_snapshot,'$.forms.sectionEntry."` + section + `".fields'),0)>0`
		applies := `(COALESCE(v.sat_publish_scope,'') IN ('','full','` + section + `') AND (l.enabled_sections IS NULL OR JSON_CONTAINS(l.enabled_sections,'"` + section + `"')))`
		ready := `EXISTS (SELECT 1 FROM assessment_module_attempts ma JOIN assessment_modules m ON m.id=ma.module_id JOIN assessment_sections sec ON sec.id=m.section_id WHERE ma.attempt_id=a.id AND sec.section_key='` + section + `') AND NOT EXISTS (SELECT 1 FROM assessment_attempt_breaks b WHERE b.attempt_id=a.id AND b.state<>'completed')`
		return `CASE WHEN NOT (` + hasSection + `) OR NOT ` + applies + ` THEN 'not_applicable' WHEN r.attempt_id IS NOT NULL THEN 'submitted' WHEN NOT (` + ready + `) THEN 'pending_section' ELSE 'not_submitted' END`
	}
	return `CASE WHEN NOT ` + hasFormsSQL + ` OR NOT ` + evaEnabledSQL + ` OR NOT ` + includesMathSQL + ` THEN 'not_applicable'
	WHEN ` + evaModeSQL + ` = 'embed' THEN 'not_tracked'
	WHEN r.attempt_id IS NOT NULL THEN 'submitted'
	WHEN NOT ` + completedSQL + ` THEN 'pending_completion'
	ELSE 'not_submitted' END`
}

func viewerSQL(v Viewer) (string, []any, error) {
	if v.All {
		return "", nil, nil
	}
	if strings.TrimSpace(v.ProctorUserID) != "" {
		return ` AND EXISTS (SELECT 1 FROM schedule_staff_assignments ssa WHERE ssa.schedule_id = a.schedule_id AND ssa.user_id = ? AND ssa.role = 'proctor' AND ssa.revoked_at IS NULL)`, []any{v.ProctorUserID}, nil
	}
	return "", nil, apperrors.New(apperrors.CodeForbidden, "You do not have access to form responses.")
}

func normalizeFormKey(key string) (string, error) {
	switch strings.TrimSpace(key) {
	case "", definition.FormRegistration:
		return definition.FormRegistration, nil
	case definition.FormVerbalEntry, definition.FormMathEntry:
		return strings.TrimSpace(key), nil
	case definition.FormEvaSim, "eva-sim":
		return definition.FormEvaSim, nil
	}
	return "", apperrors.New(apperrors.CodeValidation, "Unknown form key.")
}

type cursorPayload struct {
	After string `json:"a"`
	Bind  string `json:"b"`
}

func filterBinding(f ListFilter) string {
	return strings.Join([]string{f.ExamID, f.ScheduleID, f.VersionID, f.FormKey, f.Mode, f.Status}, "\x1f")
}

// rowQuery is the shared attempt-first projection: scope and filters are SQL
// predicates applied before LIMIT; answers are not read here.
func rowQuery(formKey, where string) string {
	modeSQL := "NULL"
	if formKey == definition.FormEvaSim {
		modeSQL = `CASE WHEN ` + hasFormsSQL + ` AND ` + evaEnabledSQL + ` THEN ` + evaModeSQL + ` ELSE NULL END`
	}
	return `SELECT * FROM (SELECT a.id AS attempt_id, COALESCE(a.candidate_name, '') AS candidate_name, COALESCE(a.candidate_email, '') AS candidate_email,
	COALESCE(sr.wcode, a.candidate_id, a.student_key, '') AS candidate_code, a.exam_id, COALESCE(e.title, '') AS exam_title,
	a.schedule_id, COALESCE(s.cohort_name, '') AS schedule_name, a.published_version_id, v.version_number,
	` + modeSQL + ` AS eva_mode,
	` + statusSQL(formKey) + ` AS form_status,
	s.eva_sim_closed_at, COALESCE(r.revision, 0) AS revision, r.updated_at
FROM student_attempts a
JOIN exam_schedules s ON s.id = a.schedule_id
JOIN exam_versions v ON v.id = a.published_version_id
JOIN exam_entities e ON e.id = a.exam_id
LEFT JOIN schedule_registrations sr ON sr.id = a.registration_id AND sr.schedule_id = a.schedule_id
LEFT JOIN assessment_access_links l ON l.schedule_id = a.schedule_id
LEFT JOIN assessment_form_responses r ON r.attempt_id = a.id AND r.form_key = ?
WHERE ` + where + `) t WHERE 1 = 1`
}

func scanRows(rows *sql.Rows, formKey string) ([]ResponseRow, error) {
	defer rows.Close()
	out := []ResponseRow{}
	for rows.Next() {
		var row ResponseRow
		var mode sql.NullString
		var closedAt, updatedAt sql.NullTime
		if err := rows.Scan(&row.AttemptID, &row.StudentName, &row.StudentEmail, &row.StudentCode, &row.ExamID, &row.ExamTitle,
			&row.ScheduleID, &row.ScheduleName, &row.VersionID, &row.VersionNumber, &mode, &row.Status, &closedAt, &row.Revision, &updatedAt); err != nil {
			return nil, err
		}
		row.FormKey = formKey
		if mode.Valid {
			m := mode.String
			row.Mode = &m
		}
		row.Collection = "open"
		if closedAt.Valid {
			at := closedAt.Time.UTC()
			row.ClosedAt, row.Collection = &at, "closed"
		}
		if updatedAt.Valid {
			at := updatedAt.Time.UTC()
			row.UpdatedAt = &at
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

func (s *Service) ListResponses(ctx context.Context, viewer Viewer, f ListFilter) (ResponsePage, error) {
	formKey, err := normalizeFormKey(f.FormKey)
	if err != nil {
		return ResponsePage{}, err
	}
	f.FormKey = formKey
	if f.Limit <= 0 {
		f.Limit = DefaultPageSize
	}
	if f.Limit > MaxPageSize {
		f.Limit = MaxPageSize
	}
	scope, scopeArgs, err := viewerSQL(viewer)
	if err != nil {
		return ResponsePage{}, err
	}
	after := ""
	if c := strings.TrimSpace(f.Cursor); c != "" {
		raw, err := base64.RawURLEncoding.DecodeString(c)
		var p cursorPayload
		if err != nil || json.Unmarshal(raw, &p) != nil || p.Bind != filterBinding(f) {
			return ResponsePage{}, apperrors.New(apperrors.CodeValidation, "The page cursor does not match these filters. Reload the list.")
		}
		after = p.After
	}
	where := "a.id > ?" + scope
	args := []any{formKey, after}
	args = append(args, scopeArgs...)
	if f.ExamID != "" {
		where += " AND a.exam_id = ?"
		args = append(args, f.ExamID)
	}
	if f.ScheduleID != "" {
		where += " AND a.schedule_id = ?"
		args = append(args, f.ScheduleID)
	}
	if f.VersionID != "" {
		where += " AND a.published_version_id = ?"
		args = append(args, f.VersionID)
	}
	query := rowQuery(formKey, where)
	switch f.Mode {
	case "":
	case definition.ModeNative, definition.ModeEmbed:
		query += " AND t.eva_mode = ?"
		args = append(args, f.Mode)
	default:
		return ResponsePage{}, apperrors.New(apperrors.CodeValidation, "mode must be native or embed.")
	}
	switch f.Status {
	case "":
		query += " AND t.form_status <> 'not_applicable'"
	case StatusSubmitted, StatusNotSubmitted, StatusPendingCompletion, StatusNotTracked, StatusNotApplicable, "pending_section":
		query += " AND t.form_status = ?"
		args = append(args, f.Status)
	default:
		return ResponsePage{}, apperrors.New(apperrors.CodeValidation, "Unknown response status filter.")
	}
	query += " ORDER BY t.attempt_id ASC LIMIT ?"
	args = append(args, f.Limit+1)
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return ResponsePage{}, err
	}
	items, err := scanRows(rows, formKey)
	if err != nil {
		return ResponsePage{}, err
	}
	out := ResponsePage{Items: items}
	if len(out.Items) > f.Limit {
		out.Items = out.Items[:f.Limit]
		raw, _ := json.Marshal(cursorPayload{After: out.Items[len(out.Items)-1].AttemptID, Bind: filterBinding(f)})
		next := base64.RawURLEncoding.EncodeToString(raw)
		out.NextCursor = &next
	}
	return out, nil
}

// ResponseDetail is one attempt's form with pinned labels. External Eva has
// no answer object.
type ResponseDetail struct {
	ResponseRow
	Fields           []definition.Field `json:"fields"`
	Answers          definition.Answers `json:"answers"`
	EmbedHost        string             `json:"embedHost,omitempty"`
	FirstSubmittedAt *time.Time         `json:"firstSubmittedAt"`
}

func (s *Service) ResponseDetailFor(ctx context.Context, viewer Viewer, attemptID, formKey string) (ResponseDetail, error) {
	key, err := normalizeFormKey(formKey)
	if err != nil {
		return ResponseDetail{}, err
	}
	scope, scopeArgs, err := viewerSQL(viewer)
	if err != nil {
		return ResponseDetail{}, err
	}
	args := append([]any{key, attemptID}, scopeArgs...)
	rows, err := s.db.QueryContext(ctx, rowQuery(key, "a.id = ?"+scope), args...)
	if err != nil {
		return ResponseDetail{}, err
	}
	items, err := scanRows(rows, key)
	if err != nil {
		return ResponseDetail{}, err
	}
	if len(items) != 1 {
		return ResponseDetail{}, apperrors.New(apperrors.CodeNotFound, "Response not found.")
	}
	out := ResponseDetail{ResponseRow: items[0], Fields: []definition.Field{}}
	c, err := loadAttemptContext(ctx, s.db, attemptID)
	if err != nil {
		return ResponseDetail{}, err
	}
	if c.Forms == nil {
		return out, nil
	}
	if key == definition.FormEvaSim && c.Forms.EvaSim.Mode == definition.ModeEmbed {
		out.EmbedHost = definition.EmbedHost(c.Forms.EvaSim.URL)
		return out, nil
	}
	if key == definition.FormRegistration {
		out.Fields = definition.ApplicableFields(c.Forms.Registration.Fields, c.Sections)
	} else if key == definition.FormVerbalEntry {
		out.Fields = c.Forms.SectionFields(definition.SectionReadingWriting)
	} else if key == definition.FormMathEntry {
		out.Fields = c.Forms.SectionFields(definition.SectionMath)
	} else {
		out.Fields = c.Forms.EvaSim.Fields
	}
	resp, err := loadResponse(ctx, s.db, attemptID, key, "")
	if err != nil {
		return ResponseDetail{}, err
	}
	if resp != nil {
		out.Answers = resp.Answers
		first := resp.FirstSubmittedAt.UTC()
		out.FirstSubmittedAt = &first
	}
	return out, nil
}
