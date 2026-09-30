package results

import (
	"context"
	"database/sql"
	"sort"
	"strconv"
	"strings"
	"time"

	"example.com/ielts-proctoring/internal/assessscore"
	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/platform/apperrors"
)

// SATRawdataExport is the wire payload for
// GET /v1/results/sat/export/rawdata.
//
// The backend owns the schema, ordering, row generation, and validation: the
// header rows and the 50-column body are produced here for both the legacy JSON
// projection and the workbook download.
type SATRawdataExport struct {
	SchemaVersion int               `json:"schemaVersion"`
	ExamID        string            `json:"examId"`
	ScheduleID    string            `json:"scheduleId"`
	HeaderRows    [][]string        `json:"headerRows"`
	Rows          [][]string        `json:"rows"`
	Sheets        []SATRawdataSheet `json:"sheets"`
	ColumnCount   int               `json:"columnCount"`
	RowCount      int               `json:"rowCount"`
}

// SATRawdataSheet is one section-specific sheet in the RAWDATA workbook.
type SATRawdataSheet struct {
	Name       string     `json:"name"`
	SectionKey string     `json:"sectionKey"`
	HeaderRows [][]string `json:"headerRows"`
	Rows       [][]string `json:"rows"`
}

// satRawdataModuleStateNotStarted: a module that exists but was never entered.
// Its เติมชุดข้อสอบ code is exported, but questions and points stay blank —
// unanswered questions are never marked wrong.
//
// Every other module state is administered. In particular 'locked' is NOT a
// never-entered state: the delivery layer writes state='locked' with
// locked_at/submitted_at when a module ends (auto-submit / time expiry) and
// counts ('submitted','locked') together as finished (delivery/start_submit.go,
// delivery/reconcile.go), so its answers must be exported like a submission.
const satRawdataModuleStateNotStarted = "not_started"

// satRawdataAttempt is one student_attempts row. It carries the attempt's
// immutable published version implicitly: every module/question read joins
// through the attempt (s.exam_version_id = a.published_version_id), so a later
// exam version can never leak into an older attempt's export.
type satRawdataAttempt struct {
	ID                 string
	CandidateID        string
	CandidateName      string
	Email              string
	PublishedVersionID string
	OrderKey           time.Time
}

// satRawdataModule is one administered module placement (assessment module
// attempt). A data row is one attempt + one module.
type satRawdataModule struct {
	AttemptID     string
	ModuleID      string
	SectionKey    string
	ModuleKey     string
	AdaptiveRole  string
	State         string
	ExamVersionID string
	SectionOrder  int
	ModuleOrder   int
}

// satRawdataCellKey deduplicates questions per administered placement, not per
// exam question: many students share the same bank question, and an
// (attempt, module, examQuestion) triple is the smallest administered unit.
// The module id is included on top of the plan's attempt+question pair so a
// bank question reused across two modules of one attempt is exported at both
// placements instead of collapsing to one.
type satRawdataCellKey struct {
	AttemptID      string
	ModuleID       string
	ExamQuestionID string
}

// satRawdataCell is one exported question value already resolved to its CSV
// cell ("1", "0", "No answer", or "").
type satRawdataCell struct {
	DisplayOrder int
	Value        string
}

// ExportSATRawdata builds the complete RAWDATA projection for one SAT
// Student Access group.
//
// Scope is the attempt itself, not its result: every student_attempts row for
// the (exam, schedule) pair is exported regardless of delivery state or
// assessment_results presence, so not-started, active, review, submitted,
// pending, unscored, invalidated, terminated, disconnected, and legacy
// attempts all appear.
//
// All reads run in a single read-only repeatable-read transaction so the file
// describes one committed snapshot instead of a moving target while students
// are still answering.
func (s *Service) ExportSATRawdata(ctx context.Context, actor auth.ActorContext, examID, scheduleID string) (*SATRawdataExport, error) {
	examID = strings.TrimSpace(examID)
	scheduleID = strings.TrimSpace(scheduleID)
	if examID == "" || scheduleID == "" {
		return nil, &apperrors.Error{Code: apperrors.CodeValidation, Message: "examId and scheduleId are required.", HTTPStatus: 422}
	}

	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	attempts, err := satRawdataAttempts(ctx, tx, actor, examID, scheduleID)
	if err != nil {
		return nil, err
	}
	modules, err := satRawdataModules(ctx, tx, actor, examID, scheduleID)
	if err != nil {
		return nil, err
	}
	cells, err := satRawdataCells(ctx, tx, actor, examID, scheduleID)
	if err != nil {
		return nil, err
	}

	out := assembleSATRawdata(attempts, modules, cells, examID, scheduleID)
	if err := validateSATRawdataHeaders(out.HeaderRows); err != nil {
		return nil, err
	}
	if err := validateSATRawdataRows(out.Rows); err != nil {
		return nil, err
	}
	for _, sheet := range out.Sheets {
		if err := validateSATRawdataHeaders(sheet.HeaderRows); err != nil {
			return nil, err
		}
		if err := validateSATRawdataRows(sheet.Rows); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return out, nil
}

// satRawdataAttempts loads every attempt in scope. It starts from
// student_attempts so attempts without an assessment_results row are retained.
func satRawdataAttempts(ctx context.Context, tx *sql.Tx, actor auth.ActorContext, examID, scheduleID string) ([]satRawdataAttempt, error) {
	scope, scopeArgs := resultScope("sch", actor)
	query := `
		SELECT a.id, a.candidate_id, COALESCE(a.candidate_name, ''), a.candidate_email, a.published_version_id,
			COALESCE(a.submitted_at, a.created_at)
		FROM student_attempts a
		JOIN exam_schedules sch ON sch.id = a.schedule_id
		JOIN exam_entities exam ON exam.id = a.exam_id AND exam.provider_key = 'sat'
		WHERE a.exam_id = ? AND a.schedule_id = ?` + scope + `
		ORDER BY COALESCE(a.submitted_at, a.created_at) ASC, a.id ASC`
	args := append([]any{examID, scheduleID}, scopeArgs...)
	rows, err := tx.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []satRawdataAttempt{}
	for rows.Next() {
		var attempt satRawdataAttempt
		if err := rows.Scan(&attempt.ID, &attempt.CandidateID, &attempt.CandidateName, &attempt.Email, &attempt.PublishedVersionID, &attempt.OrderKey); err != nil {
			return nil, err
		}
		out = append(out, attempt)
	}
	return out, rows.Err()
}

// satRawdataModules loads every administered module placement for the attempts
// in scope, pinned to each attempt's published version. One bulk query, not
// one per student.
func satRawdataModules(ctx context.Context, tx *sql.Tx, actor auth.ActorContext, examID, scheduleID string) (map[string][]satRawdataModule, error) {
	scope, scopeArgs := resultScope("sch", actor)
	// The projected module identity is assessment_modules.id (`m.id`), NOT the
	// module-attempt row id (`ma.id`): the question query groups its cells by
	// m.id, so both reads must agree on the same key. (uq_assessment_attempt_module
	// makes (attempt_id, m.id) unique, so this cannot collide.)
	query := `
		SELECT ma.attempt_id, m.id, s.section_key, m.module_key, m.adaptive_role, ma.state,
			s.exam_version_id, s.display_order, m.display_order
		FROM assessment_module_attempts ma
		JOIN student_attempts a ON a.id = ma.attempt_id
		JOIN exam_schedules sch ON sch.id = a.schedule_id
		JOIN exam_entities exam ON exam.id = a.exam_id AND exam.provider_key = 'sat'
		JOIN assessment_modules m ON m.id = ma.module_id
		JOIN assessment_sections s ON s.id = m.section_id
		WHERE a.exam_id = ? AND a.schedule_id = ?
		  AND s.exam_version_id = a.published_version_id` + scope + `
		ORDER BY ma.attempt_id ASC, s.display_order ASC, m.display_order ASC, ma.id ASC`
	args := append([]any{examID, scheduleID}, scopeArgs...)
	rows, err := tx.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := map[string][]satRawdataModule{}
	for rows.Next() {
		var module satRawdataModule
		if err := rows.Scan(&module.AttemptID, &module.ModuleID, &module.SectionKey,
			&module.ModuleKey, &module.AdaptiveRole, &module.State,
			&module.ExamVersionID, &module.SectionOrder, &module.ModuleOrder); err != nil {
			return nil, err
		}
		out[module.AttemptID] = append(out[module.AttemptID], module)
	}
	return out, rows.Err()
}

// satRawdataCells loads every administered question with its sealed key and
// resolved response. V2-first read (mirrors the seal JOIN): the V2 canonical
// payload wins per question; the legacy row is only read when no V2 payload
// exists. Reads are bounded to the attempt's published version and dedupe to
// exactly one row per administered question.
func satRawdataCells(ctx context.Context, tx *sql.Tx, actor auth.ActorContext, examID, scheduleID string) (map[string][]satRawdataCell, error) {
	scope, scopeArgs := resultScope("sch", actor)
	query := `
		SELECT ma.attempt_id, m.id AS module_id, eq.id AS exam_question_id, eq.display_order,
			CAST(qr.answer_definition AS CHAR), CAST(v.response AS CHAR), CAST(ar.response AS CHAR)
		FROM assessment_module_attempts ma
		JOIN student_attempts a ON a.id = ma.attempt_id
		JOIN exam_schedules sch ON sch.id = a.schedule_id
		JOIN exam_entities exam ON exam.id = a.exam_id AND exam.provider_key = 'sat'
		JOIN assessment_modules m ON m.id = ma.module_id
		JOIN assessment_sections s ON s.id = m.section_id
		JOIN assessment_exam_questions eq ON eq.module_id = m.id
		JOIN assessment_question_revisions qr ON qr.id = eq.question_revision_id
		LEFT JOIN assessment_question_responses ar
			ON ar.module_attempt_id = ma.id AND ar.exam_question_id = eq.id
		LEFT JOIN attempt_responses_v2 v
			ON v.attempt_id = ma.attempt_id AND v.question_id IN (eq.id, eq.question_id)
			AND v.module_id = m.id
			AND s.exam_version_id = (SELECT published_version_id FROM student_attempts WHERE id = ma.attempt_id)
		WHERE a.exam_id = ? AND a.schedule_id = ?
		  AND s.exam_version_id = a.published_version_id` + scope + `
		ORDER BY ma.attempt_id ASC, m.id ASC, eq.display_order ASC,
			CASE WHEN (CAST(v.question_id AS CHAR) COLLATE utf8mb4_unicode_ci) = eq.id THEN 0 ELSE 1 END`
	args := append([]any{examID, scheduleID}, scopeArgs...)
	rows, err := tx.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := map[string][]satRawdataCell{}
	seen := map[satRawdataCellKey]struct{}{}
	for rows.Next() {
		var attemptID, moduleID, examQuestionID string
		var displayOrder int
		var answerDef, v2Canonical, legacy sql.NullString
		if err := rows.Scan(&attemptID, &moduleID, &examQuestionID, &displayOrder,
			&answerDef, &v2Canonical, &legacy); err != nil {
			return nil, err
		}
		key := satRawdataCellKey{AttemptID: attemptID, ModuleID: moduleID, ExamQuestionID: examQuestionID}
		if _, dup := seen[key]; dup {
			// Second V2 match for the same question (eq.id + eq.question_id
			// variants): ORDER BY placed the eq.id match first, so drop the
			// duplicate instead of exporting the question twice.
			continue
		}
		seen[key] = struct{}{}
		group := satRawdataCellGroupKey(attemptID, moduleID)
		out[group] = append(out[group], satRawdataCell{
			DisplayOrder: displayOrder,
			Value:        satRawdataAnswerCell(answerDef.String, v2Canonical, legacy),
		})
	}
	return out, rows.Err()
}

// satRawdataResponseState is the three-way outcome of resolving one question's
// response. It exists so the CSV can tell "the candidate answered nothing"
// apart from "a response row exists whose content cannot be decoded": the first
// is "No answer", the second is an indeterminate cell that must stay blank.
type satRawdataResponseState int

const (
	// satRawdataResponseUnreadable: a V2 payload exists but cannot be decoded,
	// so the cell stays blank — never "No answer" (which asserts the candidate
	// left it empty) and never "0" (which asserts it wrong).
	satRawdataResponseUnreadable satRawdataResponseState = iota
	// satRawdataResponseNone: no response at all for an administered question.
	satRawdataResponseNone
	// satRawdataResponseAnswered: a usable response was resolved.
	satRawdataResponseAnswered
)

// satRawdataAnswerCell resolves one exported question cell.
//
//   - missing answer key           -> "" (cannot determine safely)
//   - response row unreadable      -> "" (cannot determine safely)
//   - key present, no answer       -> "No answer"
//   - answered                     -> "1"/"0"
//
// It never converts an unknown row to "0": "0" means incorrect.
func satRawdataAnswerCell(answerJSON string, v2Canonical sql.NullString, legacy sql.NullString) string {
	if !assessscore.SATHasKey(answerJSON) {
		return ""
	}
	response, state := satRawdataResponse(v2Canonical, legacy)
	switch state {
	case satRawdataResponseNone:
		return SATRawdataAnswerNoAnswer
	case satRawdataResponseUnreadable:
		return ""
	}
	if assessscore.SATResponseCorrect(answerJSON, true, response) {
		return SATRawdataAnswerCorrect
	}
	return SATRawdataAnswerIncorrect
}

// satRawdataResponse applies the V2-first rule: a present V2 canonical payload
// owns the question (a corrupt payload is never backfilled from the legacy
// row), and the legacy row is read only when no V2 payload exists.
//
// The three-way result carries the §14 distinction: a V2 row whose answer is
// null/absent is the candidate answering nothing ("No answer"), while a V2 row
// that cannot be decoded at all is an indeterminate cell ("") — the exporter
// must not claim the question was left blank, and must not claim it was wrong.
func satRawdataResponse(v2Canonical sql.NullString, legacy sql.NullString) (string, satRawdataResponseState) {
	if v2Canonical.Valid && strings.TrimSpace(v2Canonical.String) != "" {
		input, state := assessscore.ClassifyV2Response(v2Canonical.String)
		switch state {
		case assessscore.V2ResponseAnswered:
			return input, satRawdataResponseAnswered
		case assessscore.V2ResponseMalformed:
			return "", satRawdataResponseUnreadable
		default:
			return "", satRawdataResponseNone
		}
	}
	if legacy.Valid && strings.TrimSpace(legacy.String) != "" && legacy.String != "null" {
		return legacy.String, satRawdataResponseAnswered
	}
	return "", satRawdataResponseNone
}

// satRawdataCellGroupKey buckets question cells by administered placement.
func satRawdataCellGroupKey(attemptID, moduleID string) string {
	return attemptID + "\x1f" + moduleID
}

// assembleSATRawdata projects the loaded attempts/modules/cells into rows
// in memory. Row = one attempt + one section module.
func assembleSATRawdata(attempts []satRawdataAttempt, modulesByAttempt map[string][]satRawdataModule, cellsByModule map[string][]satRawdataCell, examID, scheduleID string) *SATRawdataExport {
	out := &SATRawdataExport{
		SchemaVersion: SATRawdataSchemaVersion,
		ExamID:        examID,
		ScheduleID:    scheduleID,
		HeaderRows:    SATRawdataHeaderRows(),
		Rows:          [][]string{},
		Sheets: []SATRawdataSheet{
			{Name: "SAT Math", SectionKey: SATRawdataSectionMath, HeaderRows: SATRawdataHeaderRows(), Rows: [][]string{}},
			{Name: "SAT Verbal", SectionKey: SATRawdataSectionReadingWriting, HeaderRows: SATRawdataHeaderRows(), Rows: [][]string{}},
		},
		ColumnCount: SATRawdataColumns,
	}
	sheetBySection := map[string]int{
		SATRawdataSectionMath:           0,
		SATRawdataSectionReadingWriting: 1,
	}
	appendRow := func(sheetIndex int, row []string) {
		out.Rows = append(out.Rows, row)
		out.Sheets[sheetIndex].Rows = append(out.Sheets[sheetIndex].Rows, row)
	}
	identityRow := func(attempt satRawdataAttempt) []string {
		row := make([]string, SATRawdataColumns)
		row[satRawdataColFirstName] = strings.TrimSpace(attempt.CandidateName)
		row[satRawdataColEmail] = attempt.Email
		row[satRawdataColCandidateID] = attempt.CandidateID
		return row
	}
	for _, attempt := range attempts {
		modules := modulesByAttempt[attempt.ID]
		if len(modules) == 0 {
			// Attempt existence is the export boundary: preserve identity even
			// when the student never entered a module. There is no section to
			// assign, so include that identity row on both section sheets.
			row := identityRow(attempt)
			out.Rows = append(out.Rows, row)
			for i := range out.Sheets {
				out.Sheets[i].Rows = append(out.Sheets[i].Rows, row)
			}
			continue
		}
		emitted := 0
		for _, module := range modules {
			// Defense in depth on top of the SQL version fence: a module
			// placement that does not belong to the attempt's immutable
			// published version is never projected, even if a future query
			// change drops the WHERE predicate.
			if module.ExamVersionID != attempt.PublishedVersionID {
				continue
			}
			sectionKey := strings.TrimSpace(module.SectionKey)
			questionCount := satRawdataQuestionCount(sectionKey)
			if questionCount == 0 {
				// Unknown section: nothing to project, never infer a range.
				continue
			}
			row := make([]string, SATRawdataColumns)
			row[satRawdataColFirstName] = strings.TrimSpace(attempt.CandidateName)
			row[satRawdataColEmail] = attempt.Email
			row[satRawdataColCandidateID] = attempt.CandidateID
			row[satRawdataColModuleCode] = satRawdataModuleCode(module.AdaptiveRole)
			row[satRawdataColRecheck] = SATRawdataRecheck

			values := make([]string, questionCount)
			if module.State != satRawdataModuleStateNotStarted {
				cells := append([]satRawdataCell(nil), cellsByModule[satRawdataCellGroupKey(module.AttemptID, module.ModuleID)]...)
				// Student delivery numbers the sorted questions sequentially.
				// display_order is a sort key and can have gaps after authoring edits.
				sort.Slice(cells, func(i, j int) bool { return cells[i].DisplayOrder < cells[j].DisplayOrder })
				received := 0
				for i, cell := range cells {
					if i >= questionCount {
						break
					}
					values[i] = cell.Value
					if cell.Value == SATRawdataAnswerCorrect {
						received++
					}
				}
				// Points come from the exported Q cells, never from
				// raw_correct / operational_question_count (SAT scoring
				// rules are out of band for this compatibility projection).
				//
				// A module that was entered but has no administered questions
				// therefore reports 0 / 27 (22) / "0.00%": the denominator is the
				// section's fixed question count, so an empty module is a score of
				// zero, not a missing score. Only a module that was never entered
				// (state not_started) keeps these three cells blank.
				row[satRawdataColPointsReceived] = strconv.Itoa(received)
				row[satRawdataColPointsAvailable] = strconv.Itoa(questionCount)
				row[satRawdataColPercentage] = satRawdataPercentage(received, questionCount)
			}
			for i, value := range values {
				row[satRawdataColFirstQuestion+i] = value
			}
			appendRow(sheetBySection[sectionKey], row)
			emitted++
		}
		if emitted == 0 {
			// The attempt had module placements but none could be projected
			// (unmapped section or a foreign version). Attempt existence is
			// still the export boundary, so keep one blank row rather than
			// silently dropping the student.
			row := identityRow(attempt)
			out.Rows = append(out.Rows, row)
			for i := range out.Sheets {
				out.Sheets[i].Rows = append(out.Sheets[i].Rows, row)
			}
		}
	}
	out.RowCount = len(out.Rows)
	return out
}
