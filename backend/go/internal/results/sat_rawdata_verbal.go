package results

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"sort"
	"strconv"
	"strings"

	"example.com/ielts-proctoring/internal/assessscore"
	"example.com/ielts-proctoring/internal/auth"
)

const (
	SATRawdataVerbalSchemaVersion = 1
	SATRawdataVerbalColumnCount   = 50

	satRawdataEmailColumn        = 2
	satRawdataPercentageColumn   = 3
	satRawdataPointsReceivedCol  = 4
	satRawdataPointsAvailableCol = 5
	satRawdataQuestionStartCol   = 21
	satRawdataModuleCodeColumn   = 48
)

var satRawdataVerbalHeaderRow1 = [SATRawdataVerbalColumnCount]string{
	"A", "B", "C", "D", "E", "F", "G", "H", "I", "J",
	"K", "L", "M", "N", "O", "P", "Q", "R", "S", "T",
	"U", "V", "W", "X", "Y", "Z", "AA", "AB", "AC", "AD",
	"AE", "AF", "AG", "AH", "AI", "AJ", "AK", "AL", "AM", "AN",
	"AO", "AP", "AQ", "AR", "AS", "AT", "AU", "AV", "AW", "",
}

var satRawdataVerbalHeaderRow2 = [SATRawdataVerbalColumnCount]string{
	"First name", "Last name", "email", "Percentage", "Points received", "Points available",
	"Minutes", "Seconds", "Date started", "Date finished", "Requires grading", "Certificate Serial",
	"cm_user_id", "Access code", "IP Address", "Extra information 1", "Extra information 2",
	"Extra information 3", "Extra information 4", "Extra information 5", "",
	"Q1", "Q2", "Q3", "Q4", "Q5", "Q6", "Q7", "Q8", "Q9", "Q10",
	"Q11", "Q12", "Q13", "Q14", "Q15", "Q16", "Q17", "Q18", "Q19", "Q20",
	"Q21", "Q22", "Q23", "Q24", "Q25", "Q26", "Q27", "เติมชุดข้อสอบ", "RECHECK",
}

type SATRawdataVerbalExport struct {
	SchemaVersion int        `json:"schemaVersion"`
	HeaderRows    [][]string `json:"headerRows"`
	Rows          [][]string `json:"rows"`
}

type satRawdataAttempt struct {
	ID    string
	Email string
}

type satRawdataModule struct {
	AttemptID    string
	ModuleID     string
	AdaptiveRole string
	DisplayOrder int
	State        string
	StartedAt    sql.NullTime
}

type satRawdataQuestionIdentity struct {
	AttemptID      string
	ExamQuestionID string
}

type satRawdataModuleIdentity struct {
	AttemptID string
	ModuleID  string
}

type satRawdataQuestion struct {
	AttemptID        string
	ModuleID         string
	ExamQuestionID   string
	DisplayOrder     int
	AnswerDefinition sql.NullString
	LegacyResponse   sql.NullString
	LegacyMarked     sql.NullBool
	LegacySavedAt    sql.NullTime
	V2Canonical      sql.NullString
	V2Present        bool
	V2SavedAt        sql.NullTime
}

// ExportSATRawdataVerbal returns every attempt in one selected SAT Student
// Access schedule. All reads share one repeatable-read snapshot, and the
// attempt set is the root so result state never filters unfinished attempts.
func (s *Service) ExportSATRawdataVerbal(ctx context.Context, actor auth.ActorContext, examID, scheduleID string) (*SATRawdataVerbalExport, error) {
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	scope, scopeArgs := resultScope("sch", actor)
	args := append([]any{examID, scheduleID}, scopeArgs...)
	attempts, err := loadSATRawdataAttempts(ctx, tx, scope, args...)
	if err != nil {
		return nil, err
	}
	modules := []satRawdataModule{}
	questions := []satRawdataQuestion{}
	if len(attempts) > 0 {
		modules, err = loadSATRawdataModules(ctx, tx, scope, args...)
		if err != nil {
			return nil, err
		}
		questions, err = loadSATRawdataQuestions(ctx, tx, scope, args...)
		if err != nil {
			return nil, err
		}
	}
	rows, err := buildSATRawdataVerbalRows(attempts, modules, questions)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return &SATRawdataVerbalExport{
		SchemaVersion: SATRawdataVerbalSchemaVersion,
		HeaderRows:    satRawdataVerbalHeaderRows(),
		Rows:          rows,
	}, nil
}

func satRawdataVerbalHeaderRows() [][]string {
	return [][]string{
		append([]string(nil), satRawdataVerbalHeaderRow1[:]...),
		append([]string(nil), satRawdataVerbalHeaderRow2[:]...),
	}
}

func loadSATRawdataAttempts(ctx context.Context, tx *sql.Tx, scope string, args ...any) ([]satRawdataAttempt, error) {
	rows, err := tx.QueryContext(ctx, `SELECT a.id, a.candidate_email
		FROM student_attempts a
		JOIN exam_schedules sch ON sch.id = a.schedule_id
		JOIN exam_entities exam ON exam.id = a.exam_id AND exam.provider_key = 'sat'
		JOIN exam_versions version ON version.id = a.published_version_id
		WHERE a.exam_id = ? AND a.schedule_id = ?`+scope+`
		ORDER BY a.created_at ASC, a.id ASC`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []satRawdataAttempt{}
	for rows.Next() {
		var attempt satRawdataAttempt
		var email sql.NullString
		if err := rows.Scan(&attempt.ID, &email); err != nil {
			return nil, err
		}
		attempt.Email = email.String
		out = append(out, attempt)
	}
	return out, rows.Err()
}

func loadSATRawdataModules(ctx context.Context, tx *sql.Tx, scope string, args ...any) ([]satRawdataModule, error) {
	rows, err := tx.QueryContext(ctx, `SELECT a.id, m.id, m.adaptive_role, m.display_order, ma.state, ma.started_at
		FROM student_attempts a
		JOIN exam_schedules sch ON sch.id = a.schedule_id
		JOIN exam_entities exam ON exam.id = a.exam_id AND exam.provider_key = 'sat'
		JOIN exam_versions version ON version.id = a.published_version_id
		JOIN assessment_module_attempts ma ON ma.attempt_id = a.id
		JOIN assessment_modules m ON m.id = ma.module_id
		JOIN assessment_sections s ON s.id = m.section_id
			AND s.exam_version_id = a.published_version_id
			AND s.section_key = 'reading-writing'
		WHERE a.exam_id = ? AND a.schedule_id = ?`+scope+`
		ORDER BY a.created_at ASC, a.id ASC, m.display_order ASC, m.id ASC`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []satRawdataModule{}
	for rows.Next() {
		var module satRawdataModule
		if err := rows.Scan(&module.AttemptID, &module.ModuleID, &module.AdaptiveRole,
			&module.DisplayOrder, &module.State, &module.StartedAt); err != nil {
			return nil, err
		}
		out = append(out, module)
	}
	return out, rows.Err()
}

func loadSATRawdataQuestions(ctx context.Context, tx *sql.Tx, scope string, args ...any) ([]satRawdataQuestion, error) {
	rows, err := tx.QueryContext(ctx, `SELECT a.id, m.id, eq.id, eq.display_order,
		CAST(qr.answer_definition AS CHAR), ar.response, ar.marked_for_review, ar.updated_at,
		CAST(v.response AS CHAR), v.question_id IS NOT NULL, v.updated_at
		FROM student_attempts a
		JOIN exam_schedules sch ON sch.id = a.schedule_id
		JOIN exam_entities exam ON exam.id = a.exam_id AND exam.provider_key = 'sat'
		JOIN exam_versions version ON version.id = a.published_version_id
		JOIN assessment_module_attempts ma ON ma.attempt_id = a.id
		JOIN assessment_modules m ON m.id = ma.module_id
		JOIN assessment_sections s ON s.id = m.section_id
			AND s.exam_version_id = a.published_version_id
			AND s.section_key = 'reading-writing'
		JOIN assessment_exam_questions eq ON eq.module_id = m.id
		JOIN assessment_question_revisions qr ON qr.id = eq.question_revision_id
		LEFT JOIN assessment_question_responses ar
			ON ar.module_attempt_id = ma.id AND ar.exam_question_id = eq.id
		LEFT JOIN attempt_responses_v2 v
			ON v.attempt_id = a.id AND v.module_id = m.id
			AND v.question_id IN (eq.id, eq.question_id)
		WHERE a.exam_id = ? AND a.schedule_id = ?`+scope+`
		ORDER BY a.created_at ASC, a.id ASC, m.display_order ASC, m.id ASC, eq.display_order ASC,
			CASE WHEN (CAST(v.question_id AS CHAR) COLLATE utf8mb4_unicode_ci) = eq.id THEN 0 ELSE 1 END`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []satRawdataQuestion{}
	seen := make(map[satRawdataQuestionIdentity]struct{})
	for rows.Next() {
		var question satRawdataQuestion
		var v2Present sql.NullBool
		if err := rows.Scan(&question.AttemptID, &question.ModuleID, &question.ExamQuestionID,
			&question.DisplayOrder, &question.AnswerDefinition, &question.LegacyResponse,
			&question.LegacyMarked, &question.LegacySavedAt, &question.V2Canonical,
			&v2Present, &question.V2SavedAt); err != nil {
			return nil, err
		}
		identity := satRawdataQuestionIdentity{AttemptID: question.AttemptID, ExamQuestionID: question.ExamQuestionID}
		if _, duplicate := seen[identity]; duplicate {
			continue
		}
		seen[identity] = struct{}{}
		question.V2Present = v2Present.Valid && v2Present.Bool
		out = append(out, question)
	}
	return out, rows.Err()
}

func buildSATRawdataVerbalRows(attempts []satRawdataAttempt, modules []satRawdataModule, questions []satRawdataQuestion) ([][]string, error) {
	modulesByAttempt := make(map[string][]satRawdataModule, len(attempts))
	for _, module := range modules {
		modulesByAttempt[module.AttemptID] = append(modulesByAttempt[module.AttemptID], module)
	}
	questionsByModule := make(map[satRawdataModuleIdentity][]satRawdataQuestion)
	for _, question := range questions {
		key := satRawdataModuleIdentity{AttemptID: question.AttemptID, ModuleID: question.ModuleID}
		questionsByModule[key] = append(questionsByModule[key], question)
	}

	rows := make([][]string, 0, len(attempts))
	for _, attempt := range attempts {
		attemptModules := modulesByAttempt[attempt.ID]
		if len(attemptModules) == 0 {
			row := make([]string, SATRawdataVerbalColumnCount)
			row[satRawdataEmailColumn] = attempt.Email
			if err := validateSATRawdataVerbalRow(row); err != nil {
				return nil, err
			}
			rows = append(rows, row)
			continue
		}
		sort.SliceStable(attemptModules, func(i, j int) bool {
			if attemptModules[i].DisplayOrder != attemptModules[j].DisplayOrder {
				return attemptModules[i].DisplayOrder < attemptModules[j].DisplayOrder
			}
			return attemptModules[i].ModuleID < attemptModules[j].ModuleID
		})
		for _, module := range attemptModules {
			row := make([]string, SATRawdataVerbalColumnCount)
			row[satRawdataEmailColumn] = attempt.Email
			row[satRawdataModuleCodeColumn] = rawdataModuleCode(module.AdaptiveRole)
			moduleQuestions := questionsByModule[satRawdataModuleIdentity{AttemptID: attempt.ID, ModuleID: module.ModuleID}]
			byOrder := make(map[int][]satRawdataQuestion)
			for _, question := range moduleQuestions {
				byOrder[question.DisplayOrder] = append(byOrder[question.DisplayOrder], question)
			}
			structureValid := len(moduleQuestions) == 27 && len(byOrder) == 27
			for order := 1; order <= 27; order++ {
				if len(byOrder[order]) != 1 {
					structureValid = false
				}
			}
			if !structureValid {
				slog.Warn("SAT RAWDATA module has invalid Q1-Q27 structure",
					"attempt_id", attempt.ID,
					"module_id", module.ModuleID,
					"question_count", len(moduleQuestions),
				)
			}
			if !module.StartedAt.Valid && module.State == "not_started" {
				if err := validateSATRawdataVerbalRow(row); err != nil {
					return nil, err
				}
				rows = append(rows, row)
				continue
			}

			correct := 0
			for order := 1; order <= 27; order++ {
				atOrder := byOrder[order]
				if len(atOrder) != 1 {
					continue
				}
				cell := satRawdataQuestionCell(atOrder[0])
				row[satRawdataQuestionStartCol+order-1] = cell
				if cell == "1" {
					correct++
				}
			}
			if structureValid {
				row[satRawdataPercentageColumn] = fmt.Sprintf("%.2f%%", float64(correct)*100/27)
				row[satRawdataPointsReceivedCol] = strconv.Itoa(correct)
				row[satRawdataPointsAvailableCol] = "27"
			}
			if err := validateSATRawdataVerbalRow(row); err != nil {
				return nil, err
			}
			rows = append(rows, row)
		}
	}
	return rows, nil
}

func satRawdataQuestionCell(question satRawdataQuestion) string {
	resolved, err := resolveSATResponse(question.V2Present, question.V2Canonical, question.V2SavedAt,
		question.LegacyResponse, question.LegacyMarked, question.LegacySavedAt)
	if err != nil {
		return ""
	}
	if !resolved.HasAnswer {
		return "No answer"
	}
	var response string
	if err := json.Unmarshal(resolved.Answer, &response); err != nil {
		return ""
	}
	if strings.TrimSpace(response) == "" {
		return "No answer"
	}
	if !question.AnswerDefinition.Valid || !assessscore.SATHasKey(question.AnswerDefinition.String) {
		return ""
	}
	if assessscore.SATResponseCorrect(question.AnswerDefinition.String, true, string(resolved.Answer)) {
		return "1"
	}
	return "0"
}

func rawdataModuleCode(role string) string {
	switch role {
	case "base":
		return "A"
	case "lower_branch":
		return "B"
	case "higher_branch":
		return "C"
	default:
		return ""
	}
}

func validateSATRawdataVerbalRow(row []string) error {
	if len(row) != SATRawdataVerbalColumnCount {
		return fmt.Errorf("SAT RAWDATA Verbal row has %d columns; expected %d", len(row), SATRawdataVerbalColumnCount)
	}
	return nil
}
