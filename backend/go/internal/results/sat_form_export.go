package results

// SAT Forms worksheet.
//
// The two section sheets describe what a candidate scored. This sheet describes
// what the candidate declared outside the scored answers: the registration
// questions, the per-section entry forms and the Eva SIM questionnaire, plus
// the status of each form. It is one row per ATTEMPT, never per module, so a
// candidate appears exactly once regardless of how many modules they entered.
//
// The column set is data-dependent (it is the union of the form fields of every
// exam version present in the room), so the sheet carries its own width and
// numeric-column list instead of the frozen 50-column rawdata template
// (docs/plans/2026-11-01-sat-forms-xlsx-export-low-level.md).

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"

	"example.com/ielts-proctoring/internal/assessmentforms"
	"example.com/ielts-proctoring/internal/assessmentforms/definition"
	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/platform/apperrors"
)

// SATFormsSheetName is the worksheet name appended to the RAWDATA workbook.
const SATFormsSheetName = "SAT Forms"

// satFormKeys fixes the field-block order of the sheet. Status columns use the
// same order, so a reader scans registration before section entry before Eva.
var satFormKeys = []string{
	definition.FormRegistration,
	definition.FormVerbalEntry,
	definition.FormMathEntry,
	definition.FormEvaSim,
}

// satFormPrefix builds the machine header (row 1) of a field column.
var satFormPrefix = map[string]string{
	definition.FormRegistration: "reg",
	definition.FormVerbalEntry:  "verbal",
	definition.FormMathEntry:    "math",
	definition.FormEvaSim:       "eva",
}

// satFormLabel builds the human header (row 2) of a field column and the
// status column labels.
var satFormLabel = map[string]string{
	definition.FormRegistration: "Registration",
	definition.FormVerbalEntry:  "Verbal entry",
	definition.FormMathEntry:    "Math entry",
	definition.FormEvaSim:       "Eva SIM",
}

// satFormIdentityColumns leads every row: who the attempt belongs to and which
// exam version it was pinned to. attempt_id closes the row so the sheet can be
// joined back to the section sheets without relying on name/email uniqueness.
var satFormIdentityColumns = []struct {
	ID    string
	Label string
}{
	{"cm_user_id", "cm_user_id"},
	{"wcode", "wcode"},
	{"candidate_name", "Candidate name"},
	{"email", "email"},
	{"version", "Version"},
}

// satFormAttempt is one attempt's identity plus its four derived form statuses.
// Status values come from assessmentforms.StatusSQL, never from local logic.
type satFormAttempt struct {
	AttemptID     string
	CandidateID   string
	Wcode         string
	CandidateName string
	Email         string
	VersionID     string
	VersionNumber int
	Status        map[string]string
}

// satFormVersion is one exam version an attempt in the room is pinned to.
type satFormVersion struct {
	ID     string
	Number int
}

// satFormFieldColumn is one exported question column.
type satFormFieldColumn struct {
	FormKey  string
	Field    definition.Field
	HeaderID string // row 1, e.g. "reg.sat_seat_number"
	Header   string // row 2, e.g. "Registration · Seat number"
	Numeric  bool
}

// satFormsVisibleTo reports whether the actor may see candidate form answers.
// It mirrors the staff forms screen (admin, admin_observer, proctor); builders
// and graders never receive the sheet.
func satFormsVisibleTo(actor auth.ActorContext) bool {
	switch actor.Role {
	case auth.RoleAdmin, auth.RoleAdminObserver, auth.RoleProctor:
		return true
	}
	return false
}

// loadSATFormsSheet reads and assembles the optional SAT Forms sheet. A nil
// sheet means "no form fields are configured for this room" and the workbook
// keeps its two section sheets.
func loadSATFormsSheet(ctx context.Context, tx *sql.Tx, actor auth.ActorContext, examID, scheduleID string) (*SATRawdataSheet, error) {
	// The schedule pin is read first: it decides column order even for a room
	// where the first attempt has not been created yet.
	pinned, err := satFormPinnedVersion(ctx, tx, actor, examID, scheduleID)
	if err != nil {
		return nil, err
	}
	attempts, err := satFormAttempts(ctx, tx, actor, examID, scheduleID)
	if err != nil {
		return nil, err
	}
	versions := satFormVersions(pinned, attempts)
	defs, err := satFormDefinitions(ctx, tx, versions)
	if err != nil {
		return nil, err
	}
	responses, err := satFormResponses(ctx, tx, actor, examID, scheduleID)
	if err != nil {
		return nil, err
	}
	sheet, ok := assembleSATForms(attempts, versions, defs, responses)
	if !ok {
		return nil, nil
	}
	return &sheet, nil
}

// satFormPinnedVersion reads exam_schedules.published_version_id: the version
// the room intends to administer. A missing row is not fatal (the attempts
// still carry their own versions); the pin only anchors column order.
func satFormPinnedVersion(ctx context.Context, tx *sql.Tx, actor auth.ActorContext, examID, scheduleID string) (satFormVersion, error) {
	scope, scopeArgs := resultScope("s", actor)
	query := `
		SELECT COALESCE(s.published_version_id, ''), COALESCE(v.version_number, 0)
		FROM exam_schedules s
		LEFT JOIN exam_versions v ON v.id = s.published_version_id
		WHERE s.exam_id = ? AND s.id = ?` + scope
	args := append([]any{examID, scheduleID}, scopeArgs...)

	var pinned satFormVersion
	err := tx.QueryRowContext(ctx, query, args...).Scan(&pinned.ID, &pinned.Number)
	if errors.Is(err, sql.ErrNoRows) {
		return satFormVersion{}, nil
	}
	if err != nil {
		return satFormVersion{}, err
	}
	return pinned, nil
}

// satFormAttempts loads one row per attempt in scope, with the four form
// statuses derived by the same SQL expression the staff forms screen uses
// (INV-2). A single response join per form key is required: the status
// expression keys on its own alias.
func satFormAttempts(ctx context.Context, tx *sql.Tx, actor auth.ActorContext, examID, scheduleID string) ([]satFormAttempt, error) {
	statuses := make([]string, len(satFormKeys))
	for i, formKey := range satFormKeys {
		expression, err := assessmentforms.StatusSQL(formKey, "r_"+satFormPrefix[formKey])
		if err != nil {
			return nil, err
		}
		statuses[i] = expression
	}
	scope, scopeArgs := resultScope("s", actor)
	query := `
		SELECT a.id, COALESCE(a.candidate_id, ''), COALESCE(a.wcode, ''),
			COALESCE(a.candidate_name, ''), a.candidate_email,
			a.published_version_id, v.version_number,
			` + strings.Join(statuses, ",\n\t\t\t") + `
		FROM student_attempts a
		JOIN exam_schedules s ON s.id = a.schedule_id
		JOIN exam_versions v ON v.id = a.published_version_id
		JOIN exam_entities exam ON exam.id = a.exam_id AND exam.provider_key = 'sat'
		LEFT JOIN assessment_access_links l ON l.schedule_id = a.schedule_id
		LEFT JOIN assessment_form_responses r_reg
			ON r_reg.attempt_id = a.id AND r_reg.form_key = 'registration'
		LEFT JOIN assessment_form_responses r_verbal
			ON r_verbal.attempt_id = a.id AND r_verbal.form_key = 'verbal_entry'
		LEFT JOIN assessment_form_responses r_math
			ON r_math.attempt_id = a.id AND r_math.form_key = 'math_entry'
		LEFT JOIN assessment_form_responses r_eva
			ON r_eva.attempt_id = a.id AND r_eva.form_key = 'eva_sim'
		WHERE a.exam_id = ? AND a.schedule_id = ?` + scope + `
		ORDER BY COALESCE(a.submitted_at, a.created_at) ASC, a.id ASC`
	args := append([]any{examID, scheduleID}, scopeArgs...)
	rows, err := tx.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []satFormAttempt{}
	for rows.Next() {
		var attempt satFormAttempt
		statusValues := make([]string, len(satFormKeys))
		dest := []any{
			&attempt.AttemptID, &attempt.CandidateID, &attempt.Wcode,
			&attempt.CandidateName, &attempt.Email,
			&attempt.VersionID, &attempt.VersionNumber,
		}
		for i := range statusValues {
			dest = append(dest, &statusValues[i])
		}
		if err := rows.Scan(dest...); err != nil {
			return nil, err
		}
		attempt.Status = make(map[string]string, len(satFormKeys))
		for i, formKey := range satFormKeys {
			attempt.Status[formKey] = statusValues[i]
		}
		out = append(out, attempt)
	}
	return out, rows.Err()
}

// satFormVersions orders the versions present in the room: the schedule's
// pinned version first (its fields are the intended column set), then every
// other version carried by an attempt, ordered by (version_number, id) so the
// header is deterministic.
func satFormVersions(pinned satFormVersion, attempts []satFormAttempt) []satFormVersion {
	out := []satFormVersion{}
	seen := map[string]bool{}
	if pinned.ID != "" {
		out = append(out, pinned)
		seen[pinned.ID] = true
	}
	var rest []satFormVersion
	for _, attempt := range attempts {
		if attempt.VersionID == "" || seen[attempt.VersionID] {
			continue
		}
		seen[attempt.VersionID] = true
		rest = append(rest, satFormVersion{ID: attempt.VersionID, Number: attempt.VersionNumber})
	}
	sort.Slice(rest, func(i, j int) bool {
		if rest[i].Number != rest[j].Number {
			return rest[i].Number < rest[j].Number
		}
		return rest[i].ID < rest[j].ID
	})
	return append(out, rest...)
}

// satFormDefinitions loads the form definitions of the given versions.
//
// Absent forms (a legacy snapshot without the "forms" key) are not an error:
// they simply contribute no columns. A present-but-unparseable definition is
// an error, because blank columns would misreport what was configured.
func satFormDefinitions(ctx context.Context, tx *sql.Tx, versions []satFormVersion) (map[string]*definition.Forms, error) {
	out := map[string]*definition.Forms{}
	if len(versions) == 0 {
		return out, nil
	}
	placeholders := strings.TrimSuffix(strings.Repeat("?,", len(versions)), ",")
	query := `SELECT id, version_number, CAST(config_snapshot AS CHAR) FROM exam_versions WHERE id IN (` + placeholders + `)`
	args := make([]any, len(versions))
	for i, version := range versions {
		args[i] = version.ID
	}
	rows, err := tx.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var id string
		var number int
		var snapshot sql.NullString
		if err := rows.Scan(&id, &number, &snapshot); err != nil {
			return nil, err
		}
		var raw []byte
		if snapshot.Valid {
			raw = []byte(snapshot.String)
		}
		forms, err := definition.FromSnapshot(raw)
		if err != nil {
			return nil, apperrors.New(apperrors.CodeInvalidAssessment,
				fmt.Sprintf("Version %d (%s) has invalid form settings; fix the version before exporting.", number, id))
		}
		out[id] = forms
	}
	return out, rows.Err()
}

// satFormResponses loads every stored answer set for the attempts in scope,
// keyed attempt -> form -> answers. Undecodable answers abort the export: a
// blank cell would claim the candidate answered nothing.
func satFormResponses(ctx context.Context, tx *sql.Tx, actor auth.ActorContext, examID, scheduleID string) (map[string]map[string]definition.Answers, error) {
	scope, scopeArgs := resultScope("s", actor)
	query := `
		SELECT r.attempt_id, r.form_key, CAST(r.answers AS CHAR)
		FROM assessment_form_responses r
		JOIN student_attempts a ON a.id = r.attempt_id
		JOIN exam_schedules s ON s.id = a.schedule_id
		JOIN exam_entities exam ON exam.id = a.exam_id AND exam.provider_key = 'sat'
		WHERE a.exam_id = ? AND a.schedule_id = ?` + scope + `
		ORDER BY r.attempt_id ASC, r.form_key ASC`
	args := append([]any{examID, scheduleID}, scopeArgs...)
	rows, err := tx.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := map[string]map[string]definition.Answers{}
	for rows.Next() {
		var attemptID, formKey string
		var raw sql.NullString
		if err := rows.Scan(&attemptID, &formKey, &raw); err != nil {
			return nil, err
		}
		answers := definition.Answers{}
		if raw.Valid {
			trimmed := strings.TrimSpace(raw.String)
			if trimmed != "" && trimmed != "null" {
				if err := json.Unmarshal([]byte(trimmed), &answers); err != nil {
					return nil, apperrors.New(apperrors.CodeInternal, "Stored form answers could not be read; the export was aborted.")
				}
			}
		}
		if out[attemptID] == nil {
			out[attemptID] = map[string]definition.Answers{}
		}
		out[attemptID][formKey] = answers
	}
	return out, rows.Err()
}

// satFormFieldsForVersion returns the fields one version contributes to one
// form key.
//
// Section entry deliberately reads SectionEntry[key].Fields instead of
// Forms.SectionFields(): the latter is nil when staff disabled collection,
// which is right for the student screen but wrong for an export that must keep
// answers captured under an earlier version. Embedded Eva has no native
// questions, so it contributes no field columns (its status is not_tracked).
func satFormFieldsForVersion(forms *definition.Forms, formKey string) []definition.Field {
	if forms == nil {
		return nil
	}
	switch formKey {
	case definition.FormRegistration:
		return forms.Registration.Fields
	case definition.FormVerbalEntry:
		if forms.SchemaVersion != definition.SchemaVersionSections {
			return nil
		}
		return forms.SectionEntry[definition.SectionReadingWriting].Fields
	case definition.FormMathEntry:
		if forms.SchemaVersion != definition.SchemaVersionSections {
			return nil
		}
		return forms.SectionEntry[definition.SectionMath].Fields
	case definition.FormEvaSim:
		if forms.EvaSim.Mode != definition.ModeNative {
			return nil
		}
		return forms.EvaSim.Fields
	}
	return nil
}

// satFormColumns builds the field columns: form by form, pinned version first,
// then the other versions present in the room. A field ID that appears in more
// than one version collapses to its first occurrence (the pinned definition
// wins the label and options).
func satFormColumns(versions []satFormVersion, defs map[string]*definition.Forms) []satFormFieldColumn {
	out := []satFormFieldColumn{}
	for _, formKey := range satFormKeys {
		seen := map[string]bool{}
		for _, version := range versions {
			forms, ok := defs[version.ID]
			if !ok {
				continue
			}
			for _, field := range satFormFieldsForVersion(forms, formKey) {
				if seen[field.ID] {
					continue
				}
				seen[field.ID] = true
				out = append(out, satFormFieldColumn{
					FormKey:  formKey,
					Field:    field,
					HeaderID: satFormPrefix[formKey] + "." + field.ID,
					Header:   satFormLabel[formKey] + " · " + strings.TrimSpace(field.Label),
					Numeric:  field.Type == definition.TypeNumber,
				})
			}
		}
	}
	return out
}

// satFormValueFields indexes the fields each version defines, so an answer is
// rendered with the vocabulary of the version the attempt was pinned to.
//
// Column headers use the room's pinned version (FR-3), but an answer belongs to
// the attempt's own version: a choice option added in a later version must
// export its label, not its raw ID (FR-5). The index keeps that lookup O(1)
// instead of scanning up to 50 fields per cell.
func satFormValueFields(defs map[string]*definition.Forms) map[string]map[string]map[string]definition.Field {
	out := make(map[string]map[string]map[string]definition.Field, len(defs))
	for versionID, forms := range defs {
		if forms == nil {
			continue
		}
		byForm := make(map[string]map[string]definition.Field, len(satFormKeys))
		for _, formKey := range satFormKeys {
			fields := satFormFieldsForVersion(forms, formKey)
			if len(fields) == 0 {
				continue
			}
			byID := make(map[string]definition.Field, len(fields))
			for _, field := range fields {
				byID[field.ID] = field
			}
			byForm[formKey] = byID
		}
		out[versionID] = byForm
	}
	return out
}

// satFormAnswerField picks the field definition that renders one answer: the
// attempt's version when it defines the question, otherwise the column's
// (pinned) definition so a legacy attempt still renders stored text/number.
func satFormAnswerField(column satFormFieldColumn, attemptVersionID string, valueFields map[string]map[string]map[string]definition.Field) definition.Field {
	if byForm := valueFields[attemptVersionID]; byForm != nil {
		if field, ok := byForm[column.FormKey][column.Field.ID]; ok {
			return field
		}
	}
	return column.Field
}

// satFormValue renders one stored answer.
//
// single_choice is stored as an option ID but exported as the option label
// pinned by that attempt's version; an option removed from every version falls
// back to the raw ID rather than a blank (the answer exists). Unanswered fields
// are blank, never "0" and never a placeholder.
func satFormValue(field definition.Field, answers definition.Answers) string {
	if len(answers) == 0 {
		return ""
	}
	value, ok := answers[field.ID]
	if !ok || value == nil {
		return ""
	}
	switch field.Type {
	case definition.TypeText:
		text, _ := value.(string)
		return text
	case definition.TypeNumber:
		number, ok := value.(float64)
		if !ok {
			return ""
		}
		return satFormNumber(number)
	case definition.TypeSingleChoice:
		optionID, _ := value.(string)
		for _, option := range field.Options {
			if option.ID == optionID {
				return option.Label
			}
		}
		return optionID
	}
	return ""
}

// satFormNumber renders a stored number without a trailing ".0" for integers,
// so the workbook can write it as a numeric cell.
func satFormNumber(number float64) string {
	if number == math.Trunc(number) && math.Abs(number) < 1e15 {
		return strconv.FormatInt(int64(number), 10)
	}
	return strconv.FormatFloat(number, 'f', -1, 64)
}

// assembleSATForms projects one row per attempt. The second return value is
// false when no form field exists in any version present, in which case the
// workbook keeps its two section sheets instead of shipping a status-only
// sheet.
func assembleSATForms(attempts []satFormAttempt, versions []satFormVersion, defs map[string]*definition.Forms, responses map[string]map[string]definition.Answers) (SATRawdataSheet, bool) {
	columns := satFormColumns(versions, defs)
	if len(columns) == 0 {
		return SATRawdataSheet{}, false
	}

	width := len(satFormIdentityColumns) + len(columns) + len(satFormKeys) + 1
	headerID := make([]string, 0, width)
	headerLabel := make([]string, 0, width)
	for _, identity := range satFormIdentityColumns {
		headerID = append(headerID, identity.ID)
		headerLabel = append(headerLabel, identity.Label)
	}
	numeric := []int{}
	for _, column := range columns {
		if column.Numeric {
			numeric = append(numeric, len(headerID))
		}
		headerID = append(headerID, column.HeaderID)
		headerLabel = append(headerLabel, column.Header)
	}
	for _, formKey := range satFormKeys {
		headerID = append(headerID, "status."+formKey)
		headerLabel = append(headerLabel, satFormLabel[formKey]+" status")
	}
	headerID = append(headerID, "attempt_id")
	headerLabel = append(headerLabel, "attempt_id")

	sheet := SATRawdataSheet{
		Name:           SATFormsSheetName,
		HeaderRows:     [][]string{headerID, headerLabel},
		Rows:           [][]string{},
		ColumnCount:    len(headerID),
		NumericColumns: numeric,
	}
	valueFields := satFormValueFields(defs)
	for _, attempt := range attempts {
		row := make([]string, 0, width)
		row = append(row,
			attempt.CandidateID,
			attempt.Wcode,
			strings.TrimSpace(attempt.CandidateName),
			attempt.Email,
			strconv.Itoa(attempt.VersionNumber),
		)
		for _, column := range columns {
			field := satFormAnswerField(column, attempt.VersionID, valueFields)
			row = append(row, satFormValue(field, responses[attempt.AttemptID][column.FormKey]))
		}
		for _, formKey := range satFormKeys {
			row = append(row, attempt.Status[formKey])
		}
		row = append(row, attempt.AttemptID)
		sheet.Rows = append(sheet.Rows, row)
	}
	return sheet, true
}
