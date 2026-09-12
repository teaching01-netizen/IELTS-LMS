// Package act owns server-authoritative ACT science scoring.
//
// The client never supplies a score: ComputeScienceScore derives
// {totalScore, maxScore, percentage} from the exam config, the sealed content
// snapshot, and the persisted answers at seal time. SealScienceScore is the
// seal-time hook that writes that score into final_submission.score, and
// ListScienceReports serves GET /api/v1/results/act-science.
package act

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/tx"
)

// ExamTypeACT is the widened exam type; SectionScience is the widened section key.
// Both originate from the 0050_act_science_support migration lineage.
const (
	ExamTypeACT    = "ACT"
	SectionScience = "science"
)

// Answer is one sealed student answer keyed by question.
type Answer struct {
	QuestionID string
	Answer     any
}

// Score is the server-authoritative ACT science outcome.
type Score struct {
	TotalScore int     `json:"totalScore"`
	MaxScore   int     `json:"maxScore"`
	Percentage float64 `json:"percentage"`
}

// ComputeScienceScore derives the objective score from config + content +
// sealed answers. config carries the exam config snapshot (tolerance,
// per-question weights live under content); content carries the sealed
// question list with keys and accepted answers; answers are the persisted
// student responses; now is the DB clock at seal time (reserved for future
// late-penalty policy; currently unused). Client-supplied scores are never
// read here by construction.
func ComputeScienceScore(config, content map[string]any, answers []Answer, now time.Time) (Score, error) {
	key := answerKeyFromContent(content)
	weights := weightsFromConfig(config, len(key))
	total := len(key)
	if total == 0 {
		return Score{}, fmt.Errorf("ACT science content carries no scorable questions")
	}
	byQuestion := map[string]any{}
	for _, a := range answers {
		byQuestion[a.QuestionID] = a.Answer
	}
	scored := 0
	max := 0
	// Deterministic order: iterate the content-derived key sequence.
	for i, q := range orderedQuestions(content) {
		w := 1
		if i < len(weights) {
			w = weights[i]
		}
		max += w
		accepted := key[q]
		given, ok := byQuestion[q]
		if !ok {
			continue
		}
		if answersEqual(given, accepted) {
			scored += w
		}
	}
	pct := 0.0
	if max > 0 {
		pct = float64(scored) / float64(max) * 100
	}
	return Score{TotalScore: scored, MaxScore: max, Percentage: pct}, nil
}

// Service wires seal-time scoring and science reporting.
type Service struct {
	db     *sql.DB
	runner *tx.Runner
}

// NewService wires dependencies explicitly.
func NewService(db *sql.DB, runner *tx.Runner) *Service {
	return &Service{db: db, runner: runner}
}

// SealScienceScore is the seal-time hook: it recomputes the authoritative
// score inside the caller's terminalization transaction and merges it into
// final_submission.score. It returns the computed score. Client payloads are
// ignored; passing a client score is a validation error.
//
// The generic terminalization service wires the equivalent ScoreAttempt method
// below, so this lower-level helper remains useful for focused integrations
// and tests that already own a final_submission row.
func SealScienceScore(ctx context.Context, t tx.Tx, attemptID string, config, content map[string]any, answers []Answer, clientScorePresent bool) (Score, error) {
	if clientScorePresent {
		return Score{}, &apperrors.Error{Code: apperrors.CodeBadRequest, Message: "Client-supplied ACT scores are rejected; scoring is server-authoritative.", HTTPStatus: 400}
	}
	score, err := ComputeScienceScore(config, content, answers, time.Now().UTC())
	if err != nil {
		return Score{}, err
	}
	scoreJSON, _ := json.Marshal(score)
	// Lock the attempt row, then merge score into final_submission.score.
	var finalSub sql.NullString
	if err := t.QueryRowContext(ctx,
		"SELECT final_submission FROM student_attempts WHERE id = ? FOR UPDATE", attemptID).Scan(&finalSub); err != nil {
		return Score{}, err
	}
	merged := map[string]any{}
	if finalSub.Valid && strings.TrimSpace(finalSub.String) != "" {
		_ = json.Unmarshal([]byte(finalSub.String), &merged)
	}
	var scoreVal any
	_ = json.Unmarshal(scoreJSON, &scoreVal)
	merged["score"] = scoreVal
	merged["providerKey"] = "act"
	merged["section"] = SectionScience
	out, _ := json.Marshal(merged)
	if _, err := t.ExecContext(ctx,
		"UPDATE student_attempts SET final_submission = ? WHERE id = ?", string(out), attemptID); err != nil {
		return Score{}, err
	}
	return score, nil
}

// ScoreAttempt implements terminalization.AttemptScorer without importing the
// terminalization package. It loads the published ACT snapshots in the same
// transaction that owns the terminal attempt lock, flattens the canonical
// science editor shape into the scoring shape, and returns only server-owned
// projection fields.
func (s *Service) ScoreAttempt(ctx context.Context, q tx.Tx, _ string, versionID string, answersRaw json.RawMessage) (map[string]any, error) {
	var configRaw, contentRaw sql.NullString
	if err := q.QueryRowContext(ctx,
		"SELECT config_snapshot, content_snapshot FROM exam_versions WHERE id = ?",
		versionID).Scan(&configRaw, &contentRaw); err != nil {
		return nil, err
	}
	config, err := decodeObject(configRaw)
	if err != nil {
		return nil, fmt.Errorf("ACT scoring config is invalid: %w", err)
	}
	content, err := decodeObject(contentRaw)
	if err != nil {
		return nil, fmt.Errorf("ACT scoring content is invalid: %w", err)
	}
	content = normalizeScienceContent(content)
	answers := decodeAnswers(answersRaw)
	score, err := ComputeScienceScore(config, content, answers, time.Now().UTC())
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"score":       score,
		"providerKey": "act",
		"section":     SectionScience,
	}, nil
}

// LoadResultForAttempt returns the persisted ACT result for a terminal
// attempt. Delivery reads this after the terminalization transaction commits;
// it never recomputes a score during bootstrap.
func LoadResultForAttempt(ctx context.Context, db *sql.DB, attemptID string) (map[string]any, error) {
	if db == nil || strings.TrimSpace(attemptID) == "" {
		return nil, nil
	}
	var id, submissionID, provider, outcome, release sql.NullString
	var total sql.NullInt64
	var payload sql.NullString
	err := db.QueryRowContext(ctx, `
		SELECT id, submission_id, provider_key, outcome_status, total_score, score_payload, release_status
		FROM assessment_results
		WHERE attempt_id = ? AND provider_key = 'act'`, attemptID).
		Scan(&id, &submissionID, &provider, &outcome, &total, &payload, &release)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	result := map[string]any{
		"id":            id.String,
		"attemptId":     attemptID,
		"providerKey":   provider.String,
		"outcomeStatus": outcome.String,
		"scorePayload":  map[string]any{},
		"releaseStatus": release.String,
	}
	if submissionID.Valid {
		result["submissionId"] = submissionID.String
	}
	if total.Valid {
		result["totalScore"] = total.Int64
	}
	if strings.TrimSpace(payload.String) != "" {
		var decoded map[string]any
		if err := json.Unmarshal([]byte(payload.String), &decoded); err != nil {
			return nil, fmt.Errorf("ACT result payload is invalid: %w", err)
		}
		result["scorePayload"] = decoded
	}
	return result, nil
}

func decodeObject(raw sql.NullString) (map[string]any, error) {
	if !raw.Valid || strings.TrimSpace(raw.String) == "" || raw.String == "null" {
		return map[string]any{}, nil
	}
	var out map[string]any
	if err := json.Unmarshal([]byte(raw.String), &out); err != nil || out == nil {
		if err == nil {
			err = fmt.Errorf("expected a JSON object")
		}
		return nil, err
	}
	return out, nil
}

func decodeAnswers(raw json.RawMessage) []Answer {
	var object map[string]any
	if len(raw) == 0 || json.Unmarshal(raw, &object) != nil || object == nil {
		return nil
	}
	if nested, ok := object["answers"].(map[string]any); ok {
		object = nested
	}
	out := make([]Answer, 0, len(object))
	for questionID, answer := range object {
		out = append(out, Answer{QuestionID: questionID, Answer: answer})
	}
	return out
}

// normalizeScienceContent accepts both the provider-neutral ACT editor
// snapshot (science.stimuli[].blocks[].questions/options) and the compact
// questions[] shape used by the scoring core.
func normalizeScienceContent(content map[string]any) map[string]any {
	if _, ok := content["questions"].([]any); ok {
		return content
	}
	science, _ := content["science"].(map[string]any)
	stimuli, _ := science["stimuli"].([]any)
	questions := make([]any, 0)
	for _, rawStimulus := range stimuli {
		stimulus, _ := rawStimulus.(map[string]any)
		blocks, _ := stimulus["blocks"].([]any)
		for _, rawBlock := range blocks {
			block, _ := rawBlock.(map[string]any)
			if blockQuestions, ok := block["questions"].([]any); ok {
				for _, rawQuestion := range blockQuestions {
					if question, ok := rawQuestion.(map[string]any); ok {
						questions = append(questions, normalizeScienceQuestion(question))
					}
				}
				continue
			}
			if _, ok := block["id"].(string); ok {
				questions = append(questions, normalizeScienceQuestion(block))
			}
		}
	}
	content["questions"] = questions
	return content
}

func normalizeScienceQuestion(question map[string]any) map[string]any {
	out := map[string]any{}
	for _, key := range []string{"id", "questionId", "question_id"} {
		if value, ok := question[key]; ok {
			out["questionId"] = value
			break
		}
	}
	for _, key := range []string{"correctAnswer", "correct_answer", "answer"} {
		if value, ok := question[key]; ok {
			out["correctAnswer"] = value
			return out
		}
	}
	if options, ok := question["options"].([]any); ok {
		for _, rawOption := range options {
			option, _ := rawOption.(map[string]any)
			if correct, _ := option["isCorrect"].(bool); correct {
				if id, ok := option["id"]; ok {
					out["correctAnswer"] = id
				} else if text, ok := option["text"]; ok {
					out["correctAnswer"] = text
				}
				break
			}
		}
	}
	return out
}

// ScienceReport is one row for GET /api/v1/results/act-science.
type ScienceReport struct {
	AttemptID    string  `json:"attemptId"`
	ScheduleID   string  `json:"scheduleId"`
	StudentID    string  `json:"studentId"`
	StudentName  string  `json:"studentName"`
	TotalScore   int     `json:"totalScore"`
	MaxScore     int     `json:"maxScore"`
	Percentage   float64 `json:"percentage"`
	ReleaseState string  `json:"releaseStatus"`
}

// ScienceQuestion is one sealed ACT science question with its server-side
// verdict. IsCorrect is nil (JSON null) whenever no verdict may be shown:
// unanswered items or questions without a sealed key. A nil verdict never
// renders as incorrect.
type ScienceQuestion struct {
	QuestionID    string `json:"questionId"`
	DisplayOrder  int    `json:"displayOrder"`
	Response      any    `json:"response"`
	CorrectAnswer any    `json:"correctAnswer"`
	IsCorrect     *bool  `json:"isCorrect"`
	Answered      bool   `json:"answered"`
}

// ScienceDetail is the per-student ACT science report backing the results
// question-level table. Score stays the sealed aggregate; Questions replays
// the same key comparison as seal time (ComputeScienceScore) without ever
// recomputing the stored total.
type ScienceDetail struct {
	AttemptID   string            `json:"attemptId"`
	ScheduleID  string            `json:"scheduleId"`
	StudentID   string            `json:"studentId"`
	StudentName string            `json:"studentName"`
	TotalScore  int               `json:"totalScore"`
	MaxScore    int               `json:"maxScore"`
	Percentage  float64           `json:"percentage"`
	Outcome     string            `json:"outcomeStatus"`
	Release     string            `json:"releaseStatus"`
	SubmittedAt *time.Time        `json:"submittedAt,omitempty"`
	Questions   []ScienceQuestion `json:"questions"`
}

// ReportFilter scopes the science report listing.
type ReportFilter struct {
	ScheduleID string
	Limit      int
	Offset     int
}

// ListScienceReports queries sealed ACT science outcomes. It reads the score
// persisted at seal time (never recomputing client-side) and joins the
// release state from assessment_results when present.
func (s *Service) ListScienceReports(ctx context.Context, f ReportFilter) ([]ScienceReport, error) {
	limit := f.Limit
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	query := `
		SELECT a.id, a.schedule_id, a.candidate_id, a.candidate_name,
			COALESCE(JSON_UNQUOTE(JSON_EXTRACT(a.final_submission, '$.score.totalScore')), '0'),
			COALESCE(JSON_UNQUOTE(JSON_EXTRACT(a.final_submission, '$.score.maxScore')), '0'),
			COALESCE(JSON_UNQUOTE(JSON_EXTRACT(a.final_submission, '$.score.percentage')), '0'),
			COALESCE(ar.release_status, 'ready_to_release')
		FROM student_attempts a
		JOIN exam_entities e ON e.id = a.exam_id
		LEFT JOIN assessment_results ar
			ON ar.attempt_id = a.id AND ar.provider_key = 'act'
		WHERE e.provider_key = 'act'
		  AND JSON_UNQUOTE(JSON_EXTRACT(a.final_submission, '$.section')) = 'science'
		  AND a.submitted_at IS NOT NULL`
	args := []any{}
	if strings.TrimSpace(f.ScheduleID) != "" {
		query += " AND a.schedule_id = ?"
		args = append(args, f.ScheduleID)
	}
	query += " ORDER BY a.submitted_at DESC LIMIT ? OFFSET ?"
	args = append(args, limit, maxInt(f.Offset, 0))
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ScienceReport
	for rows.Next() {
		var r ScienceReport
		var totalStr, maxStr, pctStr string
		if err := rows.Scan(&r.AttemptID, &r.ScheduleID, &r.StudentID, &r.StudentName,
			&totalStr, &maxStr, &pctStr, &r.ReleaseState); err != nil {
			return nil, err
		}
		r.TotalScore = atoi(totalStr)
		r.MaxScore = atoi(maxStr)
		r.Percentage = atof(pctStr)
		out = append(out, r)
	}
	return out, rows.Err()
}

// GetScienceDetail loads one sealed ACT science attempt with per-question
// rows for the results detail surface. The stored score is authoritative;
// per-question verdicts replay answersEqual against the sealed content key.
// Unsealed (pending) or missing attempts return NOT_FOUND so the UI renders
// its pending empty state instead of a fabricated table. The actor scope
// mirrors the science list intent: platform readers see all rows; tenant
// actors narrow to their organization plus a live staff assignment; actors
// with neither see NOT_FOUND, so graders cannot probe other schedules.
func (s *Service) GetScienceDetail(ctx context.Context, actor auth.ActorContext, attemptID string) (*ScienceDetail, error) {
	if strings.TrimSpace(attemptID) == "" {
		return nil, apperrors.New(apperrors.CodeBadRequest, "Attempt id is required.")
	}
	var (
		scheduleID, studentID, studentName string
		finalSub                           sql.NullString
		submittedAt                        sql.NullTime
		outcome, release                   sql.NullString
	)
	scope, scopeArgs := actResultScope(actor)
	query := `
		SELECT a.schedule_id, a.candidate_id, a.candidate_name,
			a.final_submission, a.submitted_at,
			ar.outcome_status, ar.release_status
		FROM student_attempts a
		JOIN exam_entities e ON e.id = a.exam_id
		JOIN exam_schedules sch ON sch.id = a.schedule_id
		LEFT JOIN assessment_results ar
			ON ar.attempt_id = a.id AND ar.provider_key = 'act'
		WHERE a.id = ? AND e.provider_key = 'act'
		  AND a.submitted_at IS NOT NULL` + scope
	args := append([]any{attemptID}, scopeArgs...)
	err := s.db.QueryRowContext(ctx, query, args...).
		Scan(&scheduleID, &studentID, &studentName, &finalSub, &submittedAt, &outcome, &release)
	if err == sql.ErrNoRows {
		return nil, apperrors.New(apperrors.CodeNotFound, "ACT result not found.")
	}
	if err != nil {
		return nil, err
	}
	snap := map[string]any{}
	if finalSub.Valid && strings.TrimSpace(finalSub.String) != "" {
		_ = json.Unmarshal([]byte(finalSub.String), &snap)
	}
	score, _ := snap["score"].(map[string]any)
	detail := &ScienceDetail{
		AttemptID: attemptID, ScheduleID: scheduleID,
		StudentID: studentID, StudentName: studentName,
		Outcome:   firstNonEmpty(nullableString(outcome), "scored"),
		Release:   firstNonEmpty(nullableString(release), "ready_to_release"),
		Questions: []ScienceQuestion{},
	}
	if total, ok := numVal(score["totalScore"]); ok {
		detail.TotalScore = int(total)
	}
	if max, ok := numVal(score["maxScore"]); ok {
		detail.MaxScore = int(max)
	}
	if pct, ok := numVal(score["percentage"]); ok {
		detail.Percentage = pct
	}
	if submittedAt.Valid {
		ts := submittedAt.Time.UTC()
		detail.SubmittedAt = &ts
	}
	if detail.Outcome == "scored" {
		detail.Questions = buildScienceQuestions(snap)
	}
	return detail, nil
}

// buildScienceQuestions replays the sealed answers against the sealed
// content key embedded in final_submission (falling back to the content
// snapshot shape). Ordering follows the sealed key order, capped at 500.
func buildScienceQuestions(snap map[string]any) []ScienceQuestion {
	out := []ScienceQuestion{}
	content, _ := snap["content"].(map[string]any)
	if content == nil {
		if raw, ok := snap["contentSnapshot"]; ok {
			if encoded, err := json.Marshal(raw); err == nil {
				_ = json.Unmarshal(encoded, &content)
			}
		}
	}
	var keyOrder []string
	key := map[string]any{}
	if content != nil {
		normalized := normalizeScienceContent(content)
		keyOrder = orderedQuestions(normalized)
		key = answerKeyFromContent(normalized)
	}
	answers := map[string]any{}
	if raw, ok := snap["answers"]; ok {
		if flattened, ok := raw.(map[string]any); ok {
			answers = flattened
		}
	}
	for i, questionID := range keyOrder {
		if len(out) >= 500 {
			break
		}
		given, present := answers[questionID]
		question := ScienceQuestion{
			QuestionID: questionID, DisplayOrder: i + 1,
			Answered: isScienceAnswered(given, present),
		}
		if present {
			question.Response = given
		}
		if accepted, ok := key[questionID]; ok {
			question.CorrectAnswer = accepted
			// Verdict only for answered, keyed rows; unanswered stays null.
			if question.Answered {
				verdict := answersEqual(given, accepted)
				question.IsCorrect = &verdict
			}
		}
		out = append(out, question)
	}
	// Answers without a sealed key still surface (key-less, verdict null)
	// so the table never silently drops a student response.
	for questionID, given := range answers {
		if _, ok := key[questionID]; ok {
			continue
		}
		if len(out) >= 500 {
			break
		}
		out = append(out, ScienceQuestion{
			QuestionID: questionID, DisplayOrder: len(out) + 1,
			Response: given, Answered: isScienceAnswered(given, true),
		})
	}
	return out
}

func isScienceAnswered(value any, present bool) bool {
	if !present || value == nil {
		return false
	}
	if s, ok := value.(string); ok {
		return strings.TrimSpace(s) != ""
	}
	return true
}

func nullableString(value sql.NullString) string {
	if !value.Valid {
		return ""
	}
	return value.String
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func numVal(value any) (float64, bool) {
	switch n := value.(type) {
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
	}
	return 0, false
}

// actResultScope mirrors results.resultScope against the joined schedule
// alias: platform readers carry no predicate, tenant actors narrow to
// their organization plus a live staff assignment, and actors with
// neither match nothing (the detail then surfaces NOT_FOUND).
func actResultScope(actor auth.ActorContext) (string, []any) {
	if actor.IsPlatformRead() {
		return "", nil
	}
	if actor.OrgID == nil || strings.TrimSpace(*actor.OrgID) == "" {
		return " AND 1 = 0", nil
	}
	return " AND sch.organization_id = ? AND EXISTS (SELECT 1 FROM schedule_staff_assignments assignment WHERE assignment.schedule_id = sch.id AND assignment.user_id = ? AND assignment.role = ? AND assignment.revoked_at IS NULL)", []any{*actor.OrgID, actor.UserID, actor.Role}
}

func answerKeyFromContent(content map[string]any) map[string]any {
	out := map[string]any{}
	for _, q := range orderedQuestions(content) {
		if accepted, ok := acceptedAnswer(content, q); ok {
			out[q] = accepted
		}
	}
	return out
}

func orderedQuestions(content map[string]any) []string {
	raw, ok := content["questions"].([]any)
	if !ok {
		return nil
	}
	var ids []string
	for _, item := range raw {
		m, ok := item.(map[string]any)
		if !ok {
			continue
		}
		for _, k := range []string{"questionId", "question_id", "id"} {
			if v, ok := m[k].(string); ok && strings.TrimSpace(v) != "" {
				ids = append(ids, v)
				break
			}
		}
	}
	return ids
}

func acceptedAnswer(content map[string]any, questionID string) (any, bool) {
	raw, _ := content["questions"].([]any)
	for _, item := range raw {
		m, _ := item.(map[string]any)
		if m == nil {
			continue
		}
		for _, k := range []string{"questionId", "question_id", "id"} {
			if v, _ := m[k].(string); v == questionID {
				for _, ak := range []string{"correctAnswer", "correct_answer", "answer"} {
					if v, ok := m[ak]; ok {
						return v, true
					}
				}
			}
		}
	}
	return nil, false
}

func weightsFromConfig(config map[string]any, n int) []int {
	w := make([]int, n)
	for i := range w {
		w[i] = 1
	}
	raw, ok := config["weights"].([]any)
	if !ok {
		return w
	}
	for i := range w {
		if i < len(raw) {
			switch v := raw[i].(type) {
			case float64:
				if v >= 1 {
					w[i] = int(v)
				}
			case int:
				if v >= 1 {
					w[i] = v
				}
			}
		}
	}
	return w
}

func answersEqual(given, accepted any) bool {
	gn, _ := json.Marshal(given)
	an, _ := json.Marshal(accepted)
	if string(gn) == string(an) {
		return true
	}
	// Case-insensitive string fallback for single-token science answers.
	gs, gok := given.(string)
	as, aok := accepted.(string)
	if gok && aok {
		return strings.EqualFold(strings.TrimSpace(gs), strings.TrimSpace(as))
	}
	return false
}

func atoi(s string) int {
	n := 0
	for _, c := range s {
		if c < '0' || c > '9' {
			break
		}
		n = n*10 + int(c-'0')
	}
	return n
}

func atof(s string) float64 {
	var f float64
	_, _ = fmt.Sscanf(strings.TrimSpace(s), "%f", &f)
	return f
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}
