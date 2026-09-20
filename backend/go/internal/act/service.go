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
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/telemetry"
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
	results, err := computeScienceAutoGradingResults(config, content, answers, now, nil)
	if err != nil {
		return Score{}, err
	}
	total, _ := numberAsInt(results["totalScore"])
	max, _ := numberAsInt(results["maxScore"])
	percentage, _ := numVal(results["percentage"])
	return Score{TotalScore: total, MaxScore: max, Percentage: percentage}, nil
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
		// Phase 02 observability: forged client scores are rejected before
		// any seal write; the rejection emits only a safe counter (no
		// answer contents, no attempt/user ids in labels).
		telemetry.IncCounter(telemetry.MACTScoreFailure, "provider", "act", "section", SectionScience, "outcome", "client_score_rejected")
		return Score{}, &apperrors.Error{Code: apperrors.CodeBadRequest, Message: "Client-supplied ACT scores are rejected; scoring is server-authoritative.", HTTPStatus: 400}
	}
	score, err := ComputeScienceScore(config, content, answers, time.Now().UTC())
	if err != nil {
		telemetry.IncCounter(telemetry.MACTScoreFailure, "provider", "act", "section", SectionScience, "outcome", "score_error")
		return Score{}, err
	}
	telemetry.IncCounter(telemetry.MACTScoreTotal, "provider", "act", "section", SectionScience, "outcome", "scored")
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

// Canonical sealed content (Phase 02 blocker 2 resolution): the immutable
// exam_versions.content_snapshot row is the single source of truth at seal
// time. ScoreAttempt reads it under the terminal attempt lock and returns
// ONLY the redacted server-owned projection (score/providerKey/section —
// pinned by TestContractScoreAttemptRedactedProjection, never keys or
// student payloads). The seal step embeds the sealed content copy separately
// via SealedContent (same tx, same version row): the embedded
// final_submission.content copy — content-addressed by contentHash — is what
// detail replay (buildScienceQuestions) reads, never a fresh exam_versions
// read. Later authoring edits mint new version rows and can never change a
// sealed result: the seal carries its own content + hash.
//
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
		telemetry.IncCounter(telemetry.MACTScoreFailure, "provider", "act", "section", SectionScience, "outcome", "score_error")
		return nil, err
	}
	telemetry.IncCounter(telemetry.MACTScoreTotal, "provider", "act", "section", SectionScience, "outcome", "scored")
	return map[string]any{
		"score":       score,
		"providerKey": "act",
		"section":     SectionScience,
	}, nil
}

// ScoreAttemptDetails computes the Rust-compatible objective result payload
// used by section_submissions. It is separate from ScoreAttempt so the
// compatibility final_submission remains a deliberately redacted projection.
func (s *Service) ScoreAttemptDetails(ctx context.Context, q tx.Tx, attemptID, versionID string, answersRaw json.RawMessage) (map[string]any, error) {
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
	overrides := map[string]map[string]any{}
	var scheduleID string
	if err := q.QueryRowContext(ctx, "SELECT schedule_id FROM student_attempts WHERE id = ?", attemptID).Scan(&scheduleID); err == nil {
		rows, queryErr := q.QueryContext(ctx,
			"SELECT question_id, override_json FROM grading_schedule_question_overrides WHERE schedule_id = ?", scheduleID)
		if queryErr != nil {
			return nil, queryErr
		}
		for rows.Next() {
			var id, raw string
			if err := rows.Scan(&id, &raw); err != nil {
				rows.Close()
				return nil, err
			}
			var value map[string]any
			if json.Unmarshal([]byte(raw), &value) == nil {
				overrides[id] = value
			}
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return nil, err
		}
		rows.Close()
	} else if err != sql.ErrNoRows {
		return nil, err
	}
	answers := decodeAnswers(answersRaw)
	results, err := computeScienceAutoGradingResults(config, content, answers, time.Now().UTC(), overrides)
	if err != nil {
		return nil, err
	}
	if integrity, ok := results["integrity"].(map[string]any); ok {
		// Release validation pins every objective audit to the published
		// version used for the seal; "unknown" is only valid for standalone
		// score calculations that do not own a version row.
		integrity["gradingSourceVersionId"] = versionID
	}
	return map[string]any{
		"score": Score{
			TotalScore: mustInt(results["totalScore"]), MaxScore: mustInt(results["maxScore"]),
			Percentage: mustFloat(results["percentage"]),
		},
		"providerKey": "act", "section": SectionScience,
		"content": content, "contentHash": SealedContentHash(content),
		"autoGradingResults": results,
	}, nil
}

// SealedContent loads the canonical sealed ACT content for a published
// version under the caller's terminal lock and returns the normalized copy
// plus its SealedContentHash. The seal step (terminalization + V2 direct
// sealer) embeds both into the sealed artifacts so detail replay is
// byte-deterministic without re-reading exam_versions after commit.
func (s *Service) SealedContent(ctx context.Context, q tx.Tx, versionID string) (map[string]any, string, error) {
	var contentRaw sql.NullString
	if err := q.QueryRowContext(ctx,
		"SELECT content_snapshot FROM exam_versions WHERE id = ?",
		versionID).Scan(&contentRaw); err != nil {
		return nil, "", err
	}
	content, err := decodeObject(contentRaw)
	if err != nil {
		return nil, "", fmt.Errorf("ACT sealed content is invalid: %w", err)
	}
	content = normalizeScienceContent(content)
	return content, SealedContentHash(content), nil
}

// SealedContentHash is the deterministic identity of sealed ACT content: the
// SHA-256 hex of the canonical question sequence
// "questionId\x00<canonical-correct-json>" joined per ordered question.
// Seal and detail-replay compare this hash to prove the embedded copy is the
// version-row content at seal time. Deterministic: map iteration is sorted,
// JSON encoding is canonical (encoding/json with sorted keys for the
// single correct value).
func SealedContentHash(content map[string]any) string {
	normalized := normalizeScienceContent(content)
	key := answerKeyFromContent(normalized)
	order := orderedQuestions(normalized)
	ids := append([]string(nil), order...)
	sort.Strings(ids)
	h := sha256.New()
	for _, id := range ids {
		encoded, _ := json.Marshal(key[id])
		h.Write([]byte(id))
		h.Write([]byte{0})
		h.Write(encoded)
		h.Write([]byte{0})
	}
	return hex.EncodeToString(h.Sum(nil))
}

// Canonical result store (Phase 02 blocker 1 resolution):
// assessment_results is the single source of truth for terminal ACT reads.
// final_submission.score is the write-time compatibility projection stamped
// inside the seal transaction (same tx that inserts the receipt); the
// terminalization materializer then copies that sealed score into
// assessment_results.score_payload + total_score atomically. After commit,
// every reader — ListScienceReports (aggregate), GetScienceDetail (aggregate
// + embedded-copy replay), LoadResultForAttempt (bootstrap) — reads the
// persisted assessment_results row (or the final_submission copy of the same
// sealed bytes for list/detail aggregates). Scores are never recomputed on
// read; SealScienceScore and ScoreAttempt are the only writers, both inside
// the seal transaction.
//
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
	if rawQuestions, ok := content["questions"].([]any); ok {
		questions := make([]any, 0, len(rawQuestions))
		for _, raw := range rawQuestions {
			if question, ok := raw.(map[string]any); ok {
				questions = append(questions, normalizeScienceQuestionWithRule(question, ""))
			}
		}
		content["questions"] = questions
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
			fallbackRule := firstNonEmptyString(block, "scoringRule", "answerRule")
			if blockQuestions, ok := block["questions"].([]any); ok {
				for _, rawQuestion := range blockQuestions {
					if question, ok := rawQuestion.(map[string]any); ok {
						questions = append(questions, normalizeScienceQuestionWithRule(question, fallbackRule))
					}
				}
				continue
			}
			if _, ok := block["id"].(string); ok {
				questions = append(questions, normalizeScienceQuestionWithRule(block, fallbackRule))
			}
		}
	}
	content["questions"] = questions
	return content
}

func normalizeScienceQuestion(question map[string]any) map[string]any {
	return normalizeScienceQuestionWithRule(question, "")
}

func normalizeScienceQuestionWithRule(question map[string]any, fallbackRule string) map[string]any {
	out := map[string]any{}
	for key, value := range question {
		out[key] = value
	}
	for _, key := range []string{"id", "questionId", "question_id"} {
		if value, ok := question[key]; ok {
			out["questionId"] = value
			break
		}
	}
	if _, ok := out["correctAnswer"]; !ok {
		if value, ok := question["correct_answer"]; ok {
			out["correctAnswer"] = value
		}
	}
	if _, ok := out["scoringRule"]; !ok {
		if rule, ok := out["answerRule"]; ok {
			out["scoringRule"] = rule
		} else if fallbackRule != "" {
			out["scoringRule"] = fallbackRule
		}
	}
	if options, ok := question["options"].([]any); ok {
		correctIDs := make([]string, 0)
		for _, rawOption := range options {
			option, _ := rawOption.(map[string]any)
			if correct, _ := option["isCorrect"].(bool); correct {
				if id, ok := firstString(option, "id", "key", "value"); ok {
					correctIDs = append(correctIDs, id)
				}
			}
		}
		if len(correctIDs) == 1 {
			if _, ok := out["correctAnswer"]; !ok {
				out["correctAnswer"] = correctIDs[0]
			}
		} else if len(correctIDs) > 1 {
			out["correctOptionIds"] = correctIDs
			out["correctAnswer"] = correctIDs
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
	SkillCategory string `json:"skillCategory,omitempty"`
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
	Course      string            `json:"course,omitempty"`
	TotalScore  int               `json:"totalScore"`
	MaxScore    int               `json:"maxScore"`
	Percentage  float64           `json:"percentage"`
	Outcome     string            `json:"outcomeStatus"`
	Release     string            `json:"releaseStatus"`
	Integrity   string            `json:"integrityStatus,omitempty"`
	AutoResults map[string]any    `json:"autoGradingResults,omitempty"`
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
// release state from assessment_results when present. Identity uses the
// central effective-provider predicate (exam_type ACT heals legacy
// provider_key='ielts' rows, Phase 02 blocker 4); genuine IELTS rows
// (exam_type != 'ACT') never match.
func (s *Service) ListScienceReports(ctx context.Context, f ReportFilter) ([]ScienceReport, error) {
	limit := f.Limit
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	query := `
		SELECT a.id, a.schedule_id, a.candidate_id, a.candidate_name,
			COALESCE(JSON_UNQUOTE(JSON_EXTRACT(ss.auto_grading_results, '$.totalScore')), JSON_UNQUOTE(JSON_EXTRACT(a.final_submission, '$.score.totalScore')), '0'),
			COALESCE(JSON_UNQUOTE(JSON_EXTRACT(ss.auto_grading_results, '$.maxScore')), JSON_UNQUOTE(JSON_EXTRACT(a.final_submission, '$.score.maxScore')), '0'),
			COALESCE(JSON_UNQUOTE(JSON_EXTRACT(ss.auto_grading_results, '$.percentage')), JSON_UNQUOTE(JSON_EXTRACT(a.final_submission, '$.score.percentage')), '0'),
			COALESCE(ar.release_status, 'ready_to_release')
		FROM student_attempts a
		JOIN exam_entities e ON e.id = a.exam_id
		LEFT JOIN student_submissions sub ON sub.attempt_id = a.id AND sub.provider_key = 'act'
		LEFT JOIN section_submissions ss ON ss.submission_id = sub.id AND ss.section = 'science'
		LEFT JOIN assessment_results ar
			ON ar.attempt_id = a.id AND ar.provider_key = 'act'
		WHERE (e.provider_key = 'act' OR e.exam_type = 'ACT')
		  AND (ss.id IS NOT NULL OR JSON_UNQUOTE(JSON_EXTRACT(a.final_submission, '$.section')) = 'science')
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
		telemetry.IncCounter(telemetry.MACTResultFailure, "provider", "act", "section", SectionScience, "outcome", "list_error")
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
	if err := rows.Err(); err != nil {
		telemetry.IncCounter(telemetry.MACTResultFailure, "provider", "act", "section", SectionScience, "outcome", "list_error")
		return nil, err
	}
	telemetry.IncCounter(telemetry.MACTResultTotal, "provider", "act", "section", SectionScience, "outcome", "listed")
	return out, nil
}

// GetScienceDetail loads one sealed ACT science attempt with per-question
// rows for the results detail surface. The stored score is authoritative;
// per-question verdicts replay answersEqual against the sealed content key.
// Unsealed (pending) or missing attempts return NOT_FOUND so the UI renders
// its pending empty state instead of a fabricated table. Identity uses the
// central effective-provider predicate (exam_type ACT heals legacy rows).
// The actor scope mirrors the science list intent: platform readers see all
// rows; tenant actors narrow to their organization plus a live staff
// assignment; actors with neither see NOT_FOUND, so graders cannot probe
// other schedules.
func (s *Service) GetScienceDetail(ctx context.Context, actor auth.ActorContext, attemptID string) (*ScienceDetail, error) {
	if strings.TrimSpace(attemptID) == "" {
		return nil, apperrors.New(apperrors.CodeBadRequest, "Attempt id is required.")
	}
	var (
		scheduleID, studentID, studentName string
		course                             sql.NullString
		finalSub                           sql.NullString
		sealedSub                          sql.NullString
		submittedAt                        sql.NullTime
		outcome, release                   sql.NullString
	)
	scope, scopeArgs := actResultScope(actor)
	query := `
		SELECT a.schedule_id, a.candidate_id, a.candidate_name,
			JSON_UNQUOTE(JSON_EXTRACT(reg.metadata, '$.ieltsCourse')),
			COALESCE(ss.auto_grading_results, a.final_submission), a.final_submission, a.submitted_at,
			ar.outcome_status, ar.release_status
		FROM student_attempts a
		JOIN exam_entities e ON e.id = a.exam_id
		JOIN exam_schedules sch ON sch.id = a.schedule_id
		LEFT JOIN schedule_registrations reg ON reg.id = a.registration_id
		LEFT JOIN student_submissions sub ON sub.attempt_id = a.id AND sub.provider_key = 'act'
		LEFT JOIN section_submissions ss ON ss.submission_id = sub.id AND ss.section = 'science'
		LEFT JOIN assessment_results ar
			ON ar.attempt_id = a.id AND ar.provider_key = 'act'
		WHERE a.id = ? AND (e.provider_key = 'act' OR e.exam_type = 'ACT')
		  AND a.submitted_at IS NOT NULL` + scope
	args := append([]any{attemptID}, scopeArgs...)
	err := s.db.QueryRowContext(ctx, query, args...).
		Scan(&scheduleID, &studentID, &studentName, &course, &finalSub, &sealedSub, &submittedAt, &outcome, &release)
	if err == sql.ErrNoRows {
		telemetry.IncCounter(telemetry.MACTResultTotal, "provider", "act", "section", SectionScience, "outcome", "not_found")
		return nil, apperrors.New(apperrors.CodeNotFound, "ACT result not found.")
	}
	if err != nil {
		telemetry.IncCounter(telemetry.MACTResultFailure, "provider", "act", "section", SectionScience, "outcome", "detail_error")
		return nil, err
	}
	snap := map[string]any{}
	if finalSub.Valid && strings.TrimSpace(finalSub.String) != "" {
		_ = json.Unmarshal([]byte(finalSub.String), &snap)
	}
	fallbackSnap := map[string]any{}
	if sealedSub.Valid && strings.TrimSpace(sealedSub.String) != "" {
		_ = json.Unmarshal([]byte(sealedSub.String), &fallbackSnap)
	}
	score, _ := snap["score"].(map[string]any)
	if score == nil {
		if _, ok := snap["totalScore"]; ok {
			score = snap
		}
	}
	detail := &ScienceDetail{
		AttemptID: attemptID, ScheduleID: scheduleID,
		StudentID: studentID, StudentName: studentName, Course: nullableString(course),
		Outcome:   firstNonEmpty(nullableString(outcome), "scored"),
		Release:   firstNonEmpty(nullableString(release), "ready_to_release"),
		Questions: []ScienceQuestion{},
	}
	if audit, ok := snap["integrity"].(map[string]any); ok {
		if status, ok := audit["integrityStatus"].(string); ok {
			detail.Integrity = status
		}
	}
	if _, ok := snap["questionResults"]; ok {
		detail.AutoResults = snap
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
		detail.Questions = buildScienceQuestions(snap, fallbackSnap)
	}
	telemetry.IncCounter(telemetry.MACTResultTotal, "provider", "act", "section", SectionScience, "outcome", "detailed")
	return detail, nil
}

// buildScienceQuestions replays the sealed answers against the sealed
// content key embedded in final_submission (falling back to the content
// snapshot shape). Ordering follows the sealed key order, capped at 500.
//
// Single source of truth (Phase 02 blocker 2): the embedded
// final_submission.content copy written by ScoreAttempt at seal time —
// content-addressed by final_submission.contentHash — is authoritative for
// detail replay. exam_versions is NEVER re-read here: the seal carries its
// own content so later authoring edits cannot move the replay. The
// contentSnapshot alias exists only for pre-Phase-02 seals that embedded
// the raw snapshot shape.
func buildScienceQuestions(snap map[string]any, fallback ...map[string]any) []ScienceQuestion {
	fallbackSnap := map[string]any{}
	if len(fallback) > 0 && fallback[0] != nil {
		fallbackSnap = fallback[0]
	}
	categoryByID := scienceCategoryByQuestionID(scienceContentSnapshot(snap))
	if len(categoryByID) == 0 {
		categoryByID = scienceCategoryByQuestionID(scienceContentSnapshot(fallbackSnap))
	}
	if raw, ok := snap["questionResults"].([]any); ok {
		return scienceQuestionsFromResults(raw, categoryByID)
	}
	out := []ScienceQuestion{}
	content := scienceContentSnapshot(snap)
	if content == nil {
		content = scienceContentSnapshot(fallbackSnap)
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
			QuestionID: questionID, DisplayOrder: i + 1, SkillCategory: categoryByID[questionID],
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
			SkillCategory: categoryByID[questionID],
			Response:      given, Answered: isScienceAnswered(given, true),
		})
	}
	return out
}

func scienceContentSnapshot(snap map[string]any) map[string]any {
	if snap == nil {
		return nil
	}
	if content, ok := snap["content"].(map[string]any); ok {
		return content
	}
	if raw, ok := snap["contentSnapshot"]; ok {
		if encoded, err := json.Marshal(raw); err == nil {
			var content map[string]any
			if json.Unmarshal(encoded, &content) == nil {
				return content
			}
		}
	}
	return nil
}

func scienceCategoryByQuestionID(content map[string]any) map[string]string {
	if content == nil {
		return nil
	}
	normalized := normalizeScienceContent(content)
	raw, _ := normalized["questions"].([]any)
	out := make(map[string]string, len(raw))
	for _, item := range raw {
		question, _ := item.(map[string]any)
		if question == nil {
			continue
		}
		id, _ := firstString(question, "questionId", "question_id", "id")
		category, _ := question["skillCategory"].(string)
		if id != "" && category != "" {
			out[id] = category
		}
	}
	return out
}

func scienceQuestionsFromResults(raw []any, categoryByID ...map[string]string) []ScienceQuestion {
	out := make([]ScienceQuestion, 0, len(raw))
	categoryLookup := map[string]string{}
	if len(categoryByID) > 0 && categoryByID[0] != nil {
		categoryLookup = categoryByID[0]
	}
	for index, item := range raw {
		result, _ := item.(map[string]any)
		if result == nil {
			continue
		}
		id, _ := result["questionId"].(string)
		skillCategory, _ := result["skillCategory"].(string)
		if skillCategory == "" {
			skillCategory = categoryLookup[id]
		}
		answer, present := result["studentAnswer"]
		answerText, _ := answer.(string)
		question := ScienceQuestion{
			QuestionID: id, DisplayOrder: index + 1, SkillCategory: skillCategory,
			Response: answerText, CorrectAnswer: result["correctAnswer"],
			Answered: present && strings.TrimSpace(answerText) != "",
		}
		if verdict, ok := result["isCorrect"].(bool); ok {
			question.IsCorrect = &verdict
		}
		if !question.Answered {
			question.Response = nil
		}
		out = append(out, question)
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
