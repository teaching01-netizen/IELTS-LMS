// Package sat owns the SAT provider completion policy for the Go backend.
//
// Split-brain model (mirrors the Rust assessment_delivery + durability V2):
//   - The V2 submit preamble only parks a PROVISIONAL receipt for SAT:
//     delivery_status='submitted', phase='post-exam', response digest persisted,
//     while submitted_at/final_submission stay NULL so the legacy
//     attempt_terminalizations compatibility trigger cannot manufacture a
//     terminal fact before scoring runs.
//   - True terminal state arrives here, in CompleteAssessment, or via the
//     ReconcileProvisional watchdog when the scorer path was skipped.
//
// Production scoring reads the table-driven conversion policy persisted in
// assessment_scoring_policies.policy_config. Missing entries fail closed so a
// practice result is never fabricated by the backend.
package sat

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/clock"
	"example.com/ielts-proctoring/internal/platform/telemetry"
	"example.com/ielts-proctoring/internal/platform/tx"
)

// Terminal states for assessment_module_attempts accepted at completion.
const (
	ModuleSubmitted = "submitted"
	ModuleLocked    = "locked"
)

// Section keys owned by the SAT provider.
const (
	SectionReadingWriting = "reading-writing"
	SectionMath           = "math"
)

// PolicyConfig carries the scoring policy row for one exam version.
type PolicyConfig struct {
	Raw json.RawMessage
}

// Scorer maps a normalized raw score to a scaled section score.
// Implementations must be deterministic in (section, route, normalized, max).
type Scorer interface {
	ScoreSection(sectionKey, route string, normalized, maxRaw int, policy PolicyConfig) (int, error)
}

// DeterministicScorer is retained as an explicit test fixture. Production
// construction uses PolicyScorer instead.
// It exists so the completion gate, persistence, and watchdog replay paths
// are exercisable without the official conversion tables. See the REAL
// SCORER HOOK note in the package doc before using scores downstream.
type DeterministicScorer struct{}

func (DeterministicScorer) ScoreSection(sectionKey, _ string, normalized, maxRaw int, policy PolicyConfig) (int, error) {
	if len(policy.Raw) == 0 || string(policy.Raw) == "null" {
		return 0, fmt.Errorf("SAT scoring policy is missing")
	}
	if maxRaw <= 0 {
		maxRaw = 1
	}
	if normalized < 0 {
		normalized = 0
	}
	if normalized > maxRaw {
		normalized = maxRaw
	}
	// 200 + round(600 * normalized / maxRaw), integer arithmetic.
	return 200 + (600*normalized+maxRaw/2)/maxRaw, nil
}

// PolicyScorer reads the provider conversion table persisted in
// assessment_scoring_policies.policy_config. The JSON shape mirrors the Rust
// scorer: {"readingWriting":{"lower":{"0":200,...},"higher":{...}},
// "math":{"lower":{...},"higher":{...}}}. Every requested raw score must
// have an explicit integer entry; there is intentionally no interpolation or
// default scale.
type PolicyScorer struct{}

func (PolicyScorer) ScoreSection(sectionKey, route string, normalized, _ int, policy PolicyConfig) (int, error) {
	sectionField := map[string]string{
		SectionReadingWriting: "readingWriting",
		SectionMath:           "math",
	}[sectionKey]
	if sectionField == "" {
		return 0, fmt.Errorf("assessment section is not supported by the scoring policy")
	}
	if normalized < 0 {
		normalized = 0
	}
	var root map[string]json.RawMessage
	if len(policy.Raw) == 0 || string(policy.Raw) == "null" || json.Unmarshal(policy.Raw, &root) != nil {
		return 0, fmt.Errorf("configured score is missing for the raw score and route")
	}
	var section map[string]json.RawMessage
	if json.Unmarshal(root[sectionField], &section) != nil {
		return 0, fmt.Errorf("configured score is missing for the raw score and route")
	}
	var routeScores map[string]json.RawMessage
	if json.Unmarshal(section[route], &routeScores) != nil {
		return 0, fmt.Errorf("configured score is missing for the raw score and route")
	}
	rawScore, ok := routeScores[strconv.Itoa(normalized)]
	if !ok {
		return 0, fmt.Errorf("configured score is missing for the raw score and route")
	}
	var score int64
	if err := json.Unmarshal(rawScore, &score); err != nil {
		return 0, fmt.Errorf("configured score is outside the supported integer range")
	}
	if int64(int(score)) != score {
		return 0, fmt.Errorf("configured score is outside the supported integer range")
	}
	return int(score), nil
}

// Service is the SAT completion service. All state flows through explicit SQL
// with row locks; there is no package-level state.
type Service struct {
	db     *sql.DB
	runner *tx.Runner
	clock  clock.Clock
	scorer Scorer
}

// reconcileAdapter implements the delivery.AssessmentCompleter interface
// without importing delivery (which would create a package cycle): when the
// reconcile loop finalizes the last open module, delivery calls back here to
// run CompleteAssessment with submission_id=attempt_id, actor student/
// attempt_id, mirroring Rust reconcile_attempt_timeout -> complete_assessment.
// The method value keeps delivery decoupled: delivery stores the
// CompleteReconciledAssessment func shape, never the sat package.
func (s *Service) ReconcileAdapter() func(ctx context.Context, scheduleID, attemptID string) error {
	return func(ctx context.Context, scheduleID, attemptID string) error {
		_, err := s.CompleteAssessment(ctx, CompleteRequest{
			ScheduleID:   scheduleID,
			AttemptID:    attemptID,
			SubmissionID: attemptID,
			ActorKind:    "student",
			ActorID:      attemptID,
		})
		return err
	}
}

// NewService wires dependencies explicitly. A nil scorer selects the
// fail-closed, table-driven production scorer.
func NewService(db *sql.DB, runner *tx.Runner, clk clock.Clock, scorer Scorer) *Service {
	if scorer == nil {
		scorer = PolicyScorer{}
	}
	return &Service{db: db, runner: runner, clock: clk, scorer: scorer}
}

// CompleteRequest asks for true terminal completion of a SAT attempt.
type CompleteRequest struct {
	ScheduleID   string
	AttemptID    string
	SubmissionID string
	ActorKind    string // student | system
	ActorID      string
	RequestID    string
}

// SectionResult is one persisted section outcome.
type SectionResult struct {
	SectionKey               string         `json:"sectionKey"`
	Route                    *string        `json:"route"`
	RawCorrect               int64          `json:"rawCorrect"`
	OperationalQuestionCount int64          `json:"operationalQuestionCount"`
	ScaledScore              *int           `json:"scaledScore"`
	Details                  map[string]any `json:"details"`
}

// AssessmentResult is the completion outcome.
type AssessmentResult struct {
	ID            string          `json:"id"`
	SubmissionID  string          `json:"submissionId"`
	AttemptID     string          `json:"attemptId"`
	ProviderKey   string          `json:"providerKey"`
	OutcomeStatus string          `json:"outcomeStatus"`
	ScoreKind     string          `json:"scoreKind"`
	TotalScore    *int            `json:"totalScore"`
	ScorePayload  map[string]any  `json:"scorePayload"`
	ReleaseStatus string          `json:"releaseStatus"`
	Sections      []SectionResult `json:"sections"`
}

type attemptCore struct {
	ID             string
	ScheduleID     string
	OrganizationID sql.NullString
	ExamID         string
	PublishedVerID string
	ProctorStatus  string
	DeliveryStatus string
	Phase          string
	AnswerRevision int64
}

type moduleRow struct {
	SectionKey      string
	ModuleKey       string
	AdaptiveRole    string
	State           string
	RawCorrect      sql.NullInt64
	OperationalCons sql.NullInt64
	TargetCount     int64
}

// CompleteAssessment runs the true-terminal gate: proctor/receipt terminated
// => ProctorBlocked; submission idempotency => return bound result, no re-seal; require
// all modules submitted|locked else Conflict; score, INSERT
// student_submissions + assessment_results(scored/ready_to_release) +
// sections, seal sat_complete.
func (s *Service) CompleteAssessment(ctx context.Context, req CompleteRequest) (*AssessmentResult, error) {
	if strings.TrimSpace(req.AttemptID) == "" || strings.TrimSpace(req.ScheduleID) == "" {
		return nil, apperrors.New(apperrors.CodeBadRequest, "Attempt and schedule ids are required.")
	}
	if strings.TrimSpace(req.SubmissionID) == "" || len(req.SubmissionID) > 36 {
		return nil, apperrors.New(apperrors.CodeBadRequest, "submissionId must contain between one and 36 characters.")
	}
	// Outcome is captured inside the closure and emitted once after the
	// retry wrapper returns: WithTxRetry reruns the closure on transient
	// infra errors (deadlock/lock-wait), so emitting inside would
	// double-count one logical finalization (e.g. rejected then completed).
	var out *AssessmentResult
	var outcome string
	err := s.runner.WithTxRetry(ctx, 3, func(ctx context.Context, t tx.Tx) error {
		now, err := dbTime(ctx, t)
		if err != nil {
			return err
		}
		attempt, err := lockAttempt(ctx, t, req.AttemptID, req.ScheduleID)
		if err != nil {
			return err
		}
		if err := rejectIfTerminated(ctx, t, attempt); err != nil {
			return err
		}
		// Submission idempotency: a bound SAT submission returns the
		// existing result instead of scoring twice. No re-seal here: the
		// first completion already terminalized the attempt (final_submission
		// non-NULL), so sealAttemptTx's guarded UPDATE would match 0 rows
		// and 409 every idempotent retry. A mismatched req.SubmissionID on
		// a bound attempt still returns the bound result — the submission
		// id is the client's idempotency key, not a selector.
		if existingID, err := lockedSubmissionID(ctx, t, attempt.ID); err != nil {
			outcome = telemetry.FinalizeRejected
			return err
		} else if existingID != "" {
			res, err := loadResultTx(ctx, t, existingID)
			if err != nil {
				return err
			}
			if res == nil {
				return apperrors.New(apperrors.CodeInternal, "SAT submission exists without an assessment result.")
			}
			out = res
			outcome = telemetry.FinalizeReplayed
			return nil
		}
		res, err := s.scoreAndPersist(ctx, t, attempt, req.SubmissionID, req.ActorKind, req.ActorID, newRequestID(req.RequestID), now)
		if err != nil {
			outcome = telemetry.FinalizeRejected
			return err
		}
		out = res
		outcome = telemetry.FinalizeCompleted
		return nil
	})
	if outcome != "" {
		telemetry.IncCounter(telemetry.MSATFinalizeTotal, "outcome", outcome)
	}
	if err != nil {
		return nil, err
	}
	return out, nil
}

// ReconcileProvisional is the SAT watchdog: provider SAT AND delivery
// submitted AND phase post-exam AND submitted_at NULL AND final_submission
// NULL AND no V2 receipt AND all modules terminal => lock, re-check, score,
// complete, terminalize. It never fabricates a score: attempts with no
// modules, a missing scoring policy, or a raced terminal state are skipped.
func (s *Service) ReconcileProvisional(ctx context.Context) (int64, error) {
	return s.ReconcileProvisionalBatch(ctx, 250)
}

// ReconcileProvisionalBatch bounds one watchdog pass to batchSize candidates.
func (s *Service) ReconcileProvisionalBatch(ctx context.Context, batchSize int64) (int64, error) {
	if batchSize < 1 {
		batchSize = 250
	}
	type candidate struct{ attemptID, scheduleID string }
	var cands []candidate
	// Candidate scan runs outside a transaction (read-only sweep); every
	// candidate is re-locked and re-checked inside its own transaction.
	rows, err := s.db.QueryContext(ctx, `
		SELECT a.id, a.schedule_id
		FROM student_attempts a
		JOIN exam_entities e ON e.id = a.exam_id
		WHERE e.provider_key = 'sat'
		  AND a.delivery_status = 'submitted'
		  AND a.phase = 'post-exam'
		  AND a.submitted_at IS NULL
		  AND a.final_submission IS NULL
		  AND COALESCE(a.proctor_status, 'active') <> 'terminated'
		  AND NOT EXISTS (SELECT 1 FROM attempt_submissions_v2 r WHERE r.attempt_id = a.id)
		  AND NOT EXISTS (SELECT 1 FROM attempt_terminalizations t WHERE t.attempt_id = a.id)
		  AND EXISTS (SELECT 1 FROM assessment_module_attempts ma WHERE ma.attempt_id = a.id)
		  AND NOT EXISTS (
			SELECT 1 FROM assessment_module_attempts ma
			WHERE ma.attempt_id = a.id AND ma.state NOT IN ('submitted', 'locked')
		  )
		ORDER BY a.updated_at ASC
		LIMIT ?`, batchSize)
	if err != nil {
		return 0, err
	}
	for rows.Next() {
		var c candidate
		if err := rows.Scan(&c.attemptID, &c.scheduleID); err != nil {
			rows.Close()
			return 0, err
		}
		cands = append(cands, c)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}

	var repaired int64
	for _, c := range cands {
		done, err := s.repairOne(ctx, c.attemptID, c.scheduleID)
		if err != nil {
			// A raced terminal state or a concurrently completed attempt is
			// benign; anything else aborts loudly via the returned error
			// only when it is not a writability conflict.
			if appErr, ok := apperrors.As(err); ok {
				switch appErr.Code {
				case apperrors.CodeAttemptNotWritable, apperrors.CodeAttemptProctorBlocked,
					apperrors.CodeConflict, apperrors.CodeTerminalConflict:
					continue
				}
			}
			return repaired, err
		}
		if done {
			repaired++
		}
	}
	return repaired, nil
}

func (s *Service) repairOne(ctx context.Context, attemptID, scheduleID string) (bool, error) {
	var done bool
	var outcome string
	err := s.runner.WithTxRetry(ctx, 3, func(ctx context.Context, t tx.Tx) error {
		now, err := dbTime(ctx, t)
		if err != nil {
			return err
		}
		attempt, err := lockAttempt(ctx, t, attemptID, scheduleID)
		if err != nil {
			return err
		}
		// Re-check the watchdog predicate under the row lock.
		if !(attempt.DeliveryStatus == "submitted" && attempt.Phase == "post-exam") {
			return nil
		}
		if err := rejectIfTerminated(ctx, t, attempt); err != nil {
			return err
		}
		var submittedNull, finalNull bool
		if err := t.QueryRowContext(ctx,
			"SELECT submitted_at IS NULL, final_submission IS NULL FROM student_attempts WHERE id = ? FOR UPDATE",
			attempt.ID).Scan(&submittedNull, &finalNull); err != nil {
			return err
		}
		if !submittedNull || !finalNull {
			return nil
		}
		if existingID, err := lockedSubmissionID(ctx, t, attempt.ID); err != nil {
			return err
		} else if existingID != "" {
			return nil // Raced with the student completion path; it owns the seal.
		}
		// Never fake a score: without terminal modules or a scoring policy
		// there is nothing to persist, so leave the attempt provisional.
		mods, err := loadModules(ctx, t, attempt.ID)
		if err != nil {
			return err
		}
		if len(mods) == 0 {
			return nil
		}
		for _, m := range mods {
			if m.State != ModuleSubmitted && m.State != ModuleLocked {
				return nil
			}
		}
		if _, err := loadPolicy(ctx, t, attempt.PublishedVerID); err != nil {
			return nil
		}
		submissionID := uuid.NewString()
		if len(submissionID) > 36 {
			submissionID = submissionID[:36]
		}
		_, err = s.scoreAndPersist(ctx, t, attempt, submissionID, "system", "", uuid.NewString(), now)
		if err != nil {
			outcome = telemetry.FinalizeRejected
			return err
		}
		done = true
		outcome = telemetry.FinalizeCompleted
		return nil
	})
	// Single emission after the retry wrapper (see CompleteAssessment): a
	// transient retry must not double-count one logical repair.
	if outcome != "" {
		telemetry.IncCounter(telemetry.MSATFinalizeTotal, "outcome", outcome)
	}
	return done, err
}

// OldestProvisionalAgeSeconds reports the age in seconds of the oldest SAT
// provisional completion; NULL (no rows) returns 0 without error.
func (s *Service) OldestProvisionalAgeSeconds(ctx context.Context) (int64, error) {
	var age sql.NullInt64
	if err := s.db.QueryRowContext(ctx, `
		SELECT COALESCE(MAX(TIMESTAMPDIFF(SECOND, a.updated_at, UTC_TIMESTAMP(6))), 0)
		FROM student_attempts a
		JOIN exam_entities e ON e.id = a.exam_id
		WHERE e.provider_key = 'sat'
		  AND a.delivery_status = 'submitted'
		  AND a.phase = 'post-exam'
		  AND a.submitted_at IS NULL
		  AND a.final_submission IS NULL
		  AND NOT EXISTS (SELECT 1 FROM attempt_terminalizations t WHERE t.attempt_id = a.id)`).Scan(&age); err != nil {
		return 0, err
	}
	if !age.Valid {
		return 0, nil
	}
	return age.Int64, nil
}

// scoreAndPersist aggregates terminal modules, scores sections, and persists
// student_submissions + assessment_results(scored/ready_to_release) +
// section rows, then seals sat_complete. Callers hold the attempt lock.
func (s *Service) scoreAndPersist(ctx context.Context, t tx.Tx, attempt attemptCore, submissionID, actorKind, actorID, requestID string, now time.Time) (*AssessmentResult, error) {
	mods, err := loadModules(ctx, t, attempt.ID)
	if err != nil {
		return nil, err
	}
	if len(mods) == 0 {
		return nil, &apperrors.Error{Code: apperrors.CodeConflict, Message: "The SAT attempt has no module submissions.", HTTPStatus: 409}
	}
	for _, m := range mods {
		if m.State != ModuleSubmitted && m.State != ModuleLocked {
			return nil, &apperrors.Error{Code: apperrors.CodeConflict, Message: "All SAT modules must be submitted before finalization.", HTTPStatus: 409}
		}
	}
	policy, err := loadPolicy(ctx, t, attempt.PublishedVerID)
	if err != nil {
		return nil, &apperrors.Error{Code: apperrors.CodeBadRequest, Message: "SAT scoring policy is missing.", HTTPStatus: 400}
	}

	type accum struct {
		raw, operational, target int64
		route                    *string
		modules                  []any
	}
	aggs := map[string]*accum{}
	for _, m := range mods {
		a := aggs[m.SectionKey]
		if a == nil {
			a = &accum{}
			aggs[m.SectionKey] = a
		}
		a.raw += nullInt(m.RawCorrect)
		a.operational += nullInt(m.OperationalCons)
		if m.AdaptiveRole == "base" {
			a.target += m.TargetCount
		}
		if route, ok := routeFromAdaptiveRole(m.AdaptiveRole); ok {
			if a.route != nil && *a.route != route {
				return nil, &apperrors.Error{Code: apperrors.CodeBadRequest, Message: "Multiple adaptive branches were submitted for one SAT section.", HTTPStatus: 400}
			}
			r := route
			a.route = &r
			a.target += m.TargetCount
		}
		a.modules = append(a.modules, map[string]any{
			"moduleKey": m.ModuleKey, "state": m.State,
			"rawCorrect": nullInt(m.RawCorrect), "operationalQuestionCount": nullInt(m.OperationalCons),
		})
	}

	var sections []SectionResult
	for sectionKey, a := range aggs {
		maxRaw := a.target
		if maxRaw < 1 {
			maxRaw = 1
		}
		// Live-rehearsal P0: partial module coverage (answered < placed <
		// target) normalizes UP to the full base+branch target scale, so the
		// index can exceed the per-module table max (practice tables stop at
		// 27 RW / 22 math) and terminal submit fails closed with
		// "configured score is missing". Clamp to the target scale: the
		// table is authoritative in range, and above-scale means a
		// perfect-or-better paper, which the table max scores at 800.
		normalized := normalizedRaw(a.raw, a.operational, maxRaw)
		if normalized > maxRaw {
			normalized = maxRaw
		}
		route := "lower"
		if a.route != nil {
			route = *a.route
		}
		scaled, err := s.scorer.ScoreSection(sectionKey, route, int(normalized), int(maxRaw), policy)
		if err != nil {
			return nil, &apperrors.Error{Code: apperrors.CodeBadRequest, Message: err.Error(), HTTPStatus: 400}
		}
		sc := scaled
		r := route
		sections = append(sections, SectionResult{
			SectionKey: sectionKey, Route: &r,
			RawCorrect: a.raw, OperationalQuestionCount: a.operational,
			ScaledScore: &sc,
			Details:     map[string]any{"normalizedRawCorrect": normalized, "modules": a.modules},
		})
	}
	scaledBy := map[string]*int{}
	for i := range sections {
		scaledBy[sections[i].SectionKey] = sections[i].ScaledScore
	}
	total := totalScore(scaledBy[SectionReadingWriting], scaledBy[SectionMath])
	scorePayload := map[string]any{
		"providerKey": "sat", "scoreKind": "practice",
		"totalScore": total, "sections": sections,
	}

	// Global submission ownership: a submission id belongs to exactly one attempt.
	var owner string
	err = t.QueryRowContext(ctx, "SELECT attempt_id FROM student_submissions WHERE id = ? FOR UPDATE", submissionID).Scan(&owner)
	switch {
	case err == nil && owner != attempt.ID:
		return nil, &apperrors.Error{Code: apperrors.CodeConflict, Message: "submissionId is already bound to another attempt.", HTTPStatus: 409, Details: map[string]any{"code": "SUBMISSION_ID_MISUSE"}}
	case err == sql.ErrNoRows:
		candidate, name, email, cohort := attemptCandidate(ctx, t, attempt.ID)
		sectionStatuses, _ := json.Marshal(map[string]string{SectionReadingWriting: "auto_graded", SectionMath: "auto_graded"})
		if _, err := t.ExecContext(ctx, `
			INSERT INTO student_submissions
				(id, attempt_id, schedule_id, exam_id, published_version_id, provider_key,
				 student_id, student_name, student_email, cohort_name,
				 submitted_at, time_spent_seconds, grading_status, section_statuses)
			VALUES (?, ?, ?, ?, ?, 'sat', ?, ?, ?, ?, ?, 0, 'submitted', ?)`,
			submissionID, attempt.ID, attempt.ScheduleID, attempt.ExamID, attempt.PublishedVerID,
			candidate, name, email, cohort, now, string(sectionStatuses)); err != nil {
			// The missing-row SELECT locks nothing, so a concurrent INSERT
			// of the same id (or the UNIQUE attempt_id twin) surfaces as
			// a duplicate key: converge same-attempt twins to the winner's
			// result (idempotent success), 409 only cross-attempt misuse.
			if isDupSubmissionKey(err) {
				var dupOwner string
				// Current read: FOR UPDATE is load-bearing here. The
				// tx runs at REPEATABLE READ, so a plain re-read could
				// miss the just-committed winner and misroute a
				// same-attempt twin to MISUSE below.
				ownerErr := t.QueryRowContext(ctx, "SELECT attempt_id FROM student_submissions WHERE id = ? FOR UPDATE", submissionID).Scan(&dupOwner)
				if ownerErr == nil {
					if dupOwner != attempt.ID {
						return nil, submissionMisuseError()
					}
					// Same-attempt twin: the winner's submission row is
					// ours. If it already scored, return its result;
					// otherwise the winner is still persisting — tell
					// the loser to retry rather than double-score.
					wonRes, werr := loadResultTx(ctx, t, submissionID)
					if werr != nil || wonRes == nil {
						if werr != nil {
							return nil, werr
						}
						return nil, &apperrors.Error{Code: apperrors.CodeConflict, Message: "A concurrent finalization owns this submission; retry.", HTTPStatus: 409}
					}
					return wonRes, nil
				}
				if ownerErr != sql.ErrNoRows {
					return nil, ownerErr
				}
				// Same id absent but a UNIQUE(attempt_id) twin won with
				// a different id: the attempt already has a bound
				// submission — return its result (idempotent success).
				// Only reached when the same-id lookup missed AND no
				// bound row locked: near-dead in InnoDB (a duplicate
				// implies a winner row visible to current reads), so a
				// miss here is a transient visibility gap — retry,
				// never permanent MISUSE (which tells clients not to
				// retry).
				boundID, berr := lockedSubmissionID(ctx, t, attempt.ID)
				if berr != nil {
					return nil, berr
				}
				if boundID != "" {
					boundRes, rerr := loadResultTx(ctx, t, boundID)
					if rerr != nil || boundRes == nil {
						if rerr != nil {
							return nil, rerr
						}
						return nil, &apperrors.Error{Code: apperrors.CodeConflict, Message: "A concurrent finalization owns this attempt; retry.", HTTPStatus: 409}
					}
					return boundRes, nil
				}
				return nil, &apperrors.Error{Code: apperrors.CodeConflict, Message: "A concurrent finalization is in progress; retry.", HTTPStatus: 409}
			}
			return nil, err
		}
	case err != nil:
		return nil, err
	}

	resultID := uuid.NewString()
	payloadJSON, _ := json.Marshal(scorePayload)
	if _, err := t.ExecContext(ctx, `
		INSERT INTO assessment_results
			(id, attempt_id, submission_id, provider_key, outcome_status, total_score, score_payload, release_status)
		VALUES (?, ?, ?, 'sat', 'scored', ?, ?, 'ready_to_release')`,
		resultID, attempt.ID, submissionID, total, string(payloadJSON)); err != nil {
		return nil, err
	}
	for _, sec := range sections {
		detailsJSON, _ := json.Marshal(sec.Details)
		var routeVal any
		if sec.Route != nil {
			routeVal = *sec.Route
		}
		if _, err := t.ExecContext(ctx, `
			INSERT INTO assessment_section_results
				(id, assessment_result_id, section_key, route, raw_correct, operational_question_count, scaled_score, details)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			uuid.NewString(), resultID, sec.SectionKey, routeVal, sec.RawCorrect, sec.OperationalQuestionCount, sec.ScaledScore, string(detailsJSON)); err != nil {
			return nil, err
		}
	}

	if err := sealAttemptTx(ctx, t, attempt, "submitted", "sat_complete", orStudent(actorKind), strOrNil(actorID), map[string]any{
		"submissionId": submissionID, "providerKey": "sat", "assessmentResultId": resultID,
	}, now, requestID); err != nil {
		return nil, err
	}
	return &AssessmentResult{
		ID: resultID, SubmissionID: submissionID, AttemptID: attempt.ID,
		ProviderKey: "sat", OutcomeStatus: "scored", TotalScore: &total,
		ScoreKind:    "practice",
		ScorePayload: scorePayload, ReleaseStatus: "ready_to_release", Sections: sections,
	}, nil
}

func lockAttempt(ctx context.Context, t tx.Tx, attemptID, scheduleID string) (attemptCore, error) {
	var a attemptCore
	err := t.QueryRowContext(ctx, `
		SELECT id, schedule_id, organization_id, exam_id, published_version_id,
			COALESCE(proctor_status, 'active'), COALESCE(delivery_status, 'running'),
			COALESCE(phase, ''), answer_revision
		FROM student_attempts WHERE id = ? AND schedule_id = ? FOR UPDATE`,
		attemptID, scheduleID).Scan(
		&a.ID, &a.ScheduleID, &a.OrganizationID, &a.ExamID, &a.PublishedVerID,
		&a.ProctorStatus, &a.DeliveryStatus, &a.Phase, &a.AnswerRevision)
	if err == sql.ErrNoRows {
		return a, apperrors.New(apperrors.CodeNotFound, "Attempt not found.")
	}
	return a, err
}

func rejectIfTerminated(ctx context.Context, t tx.Tx, a attemptCore) error {
	var outcome sql.NullString
	err := t.QueryRowContext(ctx,
		"SELECT outcome FROM attempt_terminalizations WHERE attempt_id = ? FOR UPDATE", a.ID).Scan(&outcome)
	if err != nil && err != sql.ErrNoRows {
		return err
	}
	if a.ProctorStatus == "terminated" || (outcome.Valid && outcome.String == "terminated") {
		return &apperrors.Error{Code: apperrors.CodeAttemptProctorBlocked, Message: "Your SAT attempt has been terminated by the proctor.", HTTPStatus: 403}
	}
	return nil
}

func lockedSubmissionID(ctx context.Context, t tx.Tx, attemptID string) (string, error) {
	var id sql.NullString
	err := t.QueryRowContext(ctx,
		"SELECT id FROM student_submissions WHERE attempt_id = ? AND provider_key = 'sat' FOR UPDATE", attemptID).Scan(&id)
	if err == sql.ErrNoRows {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return id.String, nil
}

func loadModules(ctx context.Context, t tx.Tx, attemptID string) ([]moduleRow, error) {
	rows, err := t.QueryContext(ctx, `
		SELECT s.section_key, m.module_key, m.adaptive_role, ma.state,
			ma.raw_correct, ma.operational_question_count, m.target_question_count
		FROM assessment_module_attempts ma
		JOIN assessment_modules m ON m.id = ma.module_id
		JOIN assessment_sections s ON s.id = m.section_id
		WHERE ma.attempt_id = ?
		ORDER BY s.display_order, m.display_order FOR UPDATE`, attemptID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []moduleRow
	for rows.Next() {
		var m moduleRow
		if err := rows.Scan(&m.SectionKey, &m.ModuleKey, &m.AdaptiveRole, &m.State,
			&m.RawCorrect, &m.OperationalCons, &m.TargetCount); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func loadPolicy(ctx context.Context, t tx.Tx, versionID string) (PolicyConfig, error) {
	var raw sql.NullString
	err := t.QueryRowContext(ctx,
		"SELECT policy_config FROM assessment_scoring_policies WHERE exam_version_id = ?", versionID).Scan(&raw)
	if err == sql.ErrNoRows || !raw.Valid || strings.TrimSpace(raw.String) == "" {
		return PolicyConfig{}, sql.ErrNoRows
	}
	if err != nil {
		return PolicyConfig{}, err
	}
	return PolicyConfig{Raw: json.RawMessage(raw.String)}, nil
}

// LoadResultForAttempt reads the persisted result for a terminal attempt.
// Delivery uses this after the terminal write commits so bootstrap can return
// the same result object as the result endpoints. It deliberately does not
// lock: this is a post-commit read and the terminal projection is immutable
// for the duration of the request.
func LoadResultForAttempt(ctx context.Context, db *sql.DB, attemptID string) (*AssessmentResult, error) {
	if db == nil || strings.TrimSpace(attemptID) == "" {
		return nil, nil
	}
	return loadResult(ctx, db, "attempt_id = ?", attemptID, false, true)
}

func loadResultTx(ctx context.Context, t tx.Tx, submissionID string) (*AssessmentResult, error) {
	return loadResult(ctx, t, "submission_id = ?", submissionID, true, false)
}

type resultQueryer interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}

func loadResult(ctx context.Context, q resultQueryer, predicate string, arg any, lock, selectSubmissionID bool) (*AssessmentResult, error) {
	var (
		id, attemptID, submissionID, provider, outcome, release sql.NullString
		total                                                   sql.NullInt64
		payload                                                 sql.NullString
	)
	lockClause := ""
	if lock {
		lockClause = " FOR UPDATE"
	}
	selectCols := "id, attempt_id, provider_key, outcome_status, total_score, score_payload, release_status"
	if selectSubmissionID {
		selectCols = "id, attempt_id, submission_id, provider_key, outcome_status, total_score, score_payload, release_status"
	}
	row := q.QueryRowContext(ctx, "SELECT "+selectCols+" FROM assessment_results WHERE "+predicate+lockClause, arg)
	var scanErr error
	if selectSubmissionID {
		scanErr = row.Scan(&id, &attemptID, &submissionID, &provider, &outcome, &total, &payload, &release)
	} else {
		scanErr = row.Scan(&id, &attemptID, &provider, &outcome, &total, &payload, &release)
		submissionID = sql.NullString{String: fmt.Sprint(arg), Valid: true}
	}
	err := scanErr
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var scorePayload map[string]any
	_ = json.Unmarshal([]byte(payload.String), &scorePayload)
	var sections []SectionResult
	srows, err := q.QueryContext(ctx, `
		SELECT section_key, route, raw_correct, operational_question_count, scaled_score, details
		FROM assessment_section_results WHERE assessment_result_id = ?`, id.String)
	if err != nil {
		return nil, err
	}
	for srows.Next() {
		var sec SectionResult
		var route sql.NullString
		var scaled sql.NullInt64
		var details sql.NullString
		if err := srows.Scan(&sec.SectionKey, &route, &sec.RawCorrect, &sec.OperationalQuestionCount, &scaled, &details); err != nil {
			srows.Close()
			return nil, err
		}
		if route.Valid {
			r := route.String
			sec.Route = &r
		}
		if scaled.Valid {
			v := int(scaled.Int64)
			sec.ScaledScore = &v
		}
		_ = json.Unmarshal([]byte(details.String), &sec.Details)
		sections = append(sections, sec)
	}
	srows.Close()
	if err := srows.Err(); err != nil {
		return nil, err
	}
	res := &AssessmentResult{
		ID: id.String, SubmissionID: submissionID.String, AttemptID: attemptID.String,
		ProviderKey: provider.String, OutcomeStatus: outcome.String,
		ScoreKind:    "practice",
		ScorePayload: scorePayload, ReleaseStatus: release.String, Sections: sections,
	}
	if total.Valid {
		v := int(total.Int64)
		res.TotalScore = &v
	}
	return res, nil
}

// sealAttemptTx writes the immutable terminal fact plus the submitted
// projection. It mirrors the shared terminalization writer's submitted path:
// INSERT attempt_terminalizations, then claim the attempt projection with a
// guarded UPDATE whose affected row count decides writability.
func sealAttemptTx(ctx context.Context, t tx.Tx, a attemptCore, outcome, reason, actorKind string, actorID *string, finalSubmission map[string]any, effectiveAt time.Time, requestID string) error {
	terminalizationID := uuid.NewString()
	if finalSubmission == nil {
		finalSubmission = map[string]any{}
	}
	finalSubmission["submittedAt"] = effectiveAt.UTC()
	finalSubmission["completionReason"] = reason
	finalSubmission["terminalizationOutcome"] = outcome
	finalSubmission["terminalizationId"] = terminalizationID
	projectionJSON, _ := json.Marshal(finalSubmission)
	snapshotJSON, _ := json.Marshal(map[string]any{
		"attemptId": a.ID, "scheduleId": a.ScheduleID,
		"organizationId": nullStr(a.OrganizationID), "examId": a.ExamID,
		"providerKey": "sat", "answerRevision": a.AnswerRevision,
		"completionReason": reason, "terminalizationId": terminalizationID,
	})
	var actorVal any
	if actorID != nil {
		actorVal = *actorID
	}
	var orgVal any
	if a.OrganizationID.Valid {
		orgVal = a.OrganizationID.String
	}
	if _, err := t.ExecContext(ctx, `
		INSERT INTO attempt_terminalizations
			(attempt_id, organization_id, terminalization_id, schedule_id,
			 outcome, reason, actor_kind, actor_id, effective_at, recorded_at,
			 answer_revision, final_snapshot, request_id)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(6), ?, ?, ?)`,
		a.ID, orgVal, terminalizationID, a.ScheduleID,
		outcome, reason, actorKind, actorVal, effectiveAt.UTC(),
		a.AnswerRevision, string(snapshotJSON), requestID); err != nil {
		return err
	}
	res, err := t.ExecContext(ctx, `
		UPDATE student_attempts
		SET phase = 'post-exam', delivery_status = 'submitted', final_submission = ?,
			submitted_at = COALESCE(submitted_at, ?),
			updated_at = UTC_TIMESTAMP(6), revision = revision + 1, control_epoch = control_epoch + 1
		WHERE id = ? AND schedule_id = ?
		  AND ((submitted_at IS NULL AND phase <> 'post-exam')
			OR (delivery_status = 'submitted' AND phase = 'post-exam' AND final_submission IS NULL))
		  AND COALESCE(proctor_status, 'active') <> 'terminated'`,
		string(projectionJSON), effectiveAt.UTC(), a.ID, a.ScheduleID)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n != 1 {
		return &apperrors.Error{Code: apperrors.CodeTerminalConflict, Message: "SAT attempt changed before terminalization completed.", HTTPStatus: 409}
	}
	return nil
}

// attemptCandidate returns (id, name, email, cohort): SELECT order is
// candidate_id, candidate_name, candidate_email, student_key. Callers bind
// positionally (id→student_id, name→student_name, email→student_email), so
// keep this order — swapping name/email silently misattributes results.
func attemptCandidate(ctx context.Context, t tx.Tx, attemptID string) (id, name, email, cohort string) {
	_ = t.QueryRowContext(ctx,
		"SELECT candidate_id, candidate_name, candidate_email, COALESCE(student_key, '') FROM student_attempts WHERE id = ?",
		attemptID).Scan(&id, &name, &email, &cohort)
	return id, name, email, cohort
}

func routeFromAdaptiveRole(role string) (string, bool) {
	switch role {
	case "lower_branch":
		return "lower", true
	case "higher_branch":
		return "higher", true
	default:
		return "", false
	}
}

// normalizedRaw scales raw hits by operational coverage: round(raw * max /
// operational), clamped to [0, max]. Zero operational coverage yields 0.
func normalizedRaw(raw, operational, max int64) int64 {
	if operational <= 0 || max <= 0 {
		return 0
	}
	n := (raw*max + operational/2) / operational
	if n < 0 {
		return 0
	}
	if n > max {
		return max
	}
	return n
}

func totalScore(readingWriting, math *int) int {
	total := 0
	if readingWriting != nil {
		total += *readingWriting
	}
	if math != nil {
		total += *math
	}
	return total
}

func submissionMisuseError() *apperrors.Error {
	return &apperrors.Error{Code: apperrors.CodeConflict, Message: "submissionId is already bound to another attempt.", HTTPStatus: 409, Details: map[string]any{"code": "SUBMISSION_ID_MISUSE"}}
}

func isDupSubmissionKey(err error) bool {
	if err == nil {
		return false
	}
	s := strings.ToLower(err.Error())
	return strings.Contains(s, "duplicate") || strings.Contains(s, "1062")
}

func nullInt(n sql.NullInt64) int64 {
	if n.Valid {
		return n.Int64
	}
	return 0
}

func nullStr(n sql.NullString) any {
	if n.Valid {
		return n.String
	}
	return nil
}

func strOrNil(s string) *string {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return &s
}

func orStudent(kind string) string {
	if kind == "system" {
		return "system"
	}
	return "student"
}

func newRequestID(hint string) string {
	if strings.TrimSpace(hint) != "" {
		return hint
	}
	return uuid.NewString()
}

func dbTime(ctx context.Context, t tx.Tx) (time.Time, error) {
	var now time.Time
	if err := t.QueryRowContext(ctx, "SELECT UTC_TIMESTAMP(6)").Scan(&now); err != nil {
		return time.Time{}, err
	}
	return now.UTC(), nil
}
