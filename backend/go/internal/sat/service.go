// Package sat owns the SAT completion compatibility and recovery hooks for the
// Go backend. Completion requires durable terminal modules and then seals the
// attempt; score conversion is intentionally outside this path.
package sat

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"

	"example.com/ielts-proctoring/internal/attempts"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/clock"
	"example.com/ielts-proctoring/internal/platform/telemetry"
	"example.com/ielts-proctoring/internal/platform/tx"
	"example.com/ielts-proctoring/internal/terminalization"
)

// Section keys owned by the SAT provider. The terminal-state vocabulary and the
// rule that consumes it live in attempts (the package below this one, which also
// gates the provisional submit on them): every check in this file that asks
// "may this attempt be finished?" calls attempts.SATModuleTerminal.
const (
	SectionReadingWriting = attempts.SATSectionReadingWriting
	SectionMath           = attempts.SATSectionMath
)

// maxSubmissionIDLen preserves the compatibility completion request limit.
// V2 submission receipts have their own wider limit and never pass through this
// SAT compatibility API.
const maxSubmissionIDLen = 36

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
	db               *sql.DB
	runner           *tx.Runner
	clock            clock.Clock
	scorer           Scorer
	completionSealer completionSealer
}

type completionSealer interface {
	SealCompletion(ctx context.Context, q tx.Tx, attempt attemptCore, req CompleteRequest, effectiveAt time.Time) (*AssessmentResult, bool, error)
}

type terminalizationCompletionSealer struct {
	service *terminalization.Service
}

func (s terminalizationCompletionSealer) SealCompletion(ctx context.Context, q tx.Tx, attempt attemptCore, req CompleteRequest, effectiveAt time.Time) (*AssessmentResult, bool, error) {
	if s.service == nil {
		return nil, false, apperrors.New(apperrors.CodeInternal, "SAT terminalization is unavailable.")
	}
	projection, err := json.Marshal(map[string]any{"submissionId": req.SubmissionID, "providerKey": "sat"})
	if err != nil {
		return nil, false, err
	}
	seal, err := s.service.TerminalizeInTx(ctx, q, terminalization.SealCommand{
		AttemptID: attempt.ID, ScheduleID: attempt.ScheduleID,
		Outcome: terminalization.OutcomeSubmitted, Reason: terminalization.ReasonSATComplete,
		ActorKind: orStudent(req.ActorKind), ActorID: strOrNil(req.ActorID),
		EffectiveAt: &effectiveAt, FinalSubmission: projection, RequestID: newRequestID(req.RequestID),
	})
	if err != nil {
		return nil, false, err
	}
	result, err := loadResult(ctx, q, "attempt_id = ?", attempt.ID, true, true)
	if err != nil {
		return nil, false, err
	}
	if result == nil {
		return nil, false, apperrors.New(apperrors.CodeInternal, "SAT completion has no materialized assessment result.")
	}
	return result, seal.Created, nil
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

// NewService wires dependencies explicitly. The scoring implementation remains
// available for a later scoring path; completion never invokes it.
// A terminalizer can be shared with the application graph so its transaction
// and outbox configuration stay consistent with V2 submit.
func NewService(db *sql.DB, runner *tx.Runner, clk clock.Clock, scorer Scorer, terminalizers ...*terminalization.Service) *Service {
	if scorer == nil {
		scorer = PolicyScorer{}
	}
	var terminalizer *terminalization.Service
	if len(terminalizers) > 0 {
		terminalizer = terminalizers[0]
	}
	if terminalizer == nil && runner != nil {
		terminalizer = terminalization.NewService(runner, nil, nil)
	}
	return &Service{
		db: db, runner: runner, clock: clk, scorer: scorer,
		completionSealer: terminalizationCompletionSealer{service: terminalizer},
	}
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
	State string
}

// CompleteAssessment validates the SAT module topology and idempotently seals
// the attempt. The terminalization service materializes the lightweight SAT
// pending result with no scaled score.
func (s *Service) CompleteAssessment(ctx context.Context, req CompleteRequest) (*AssessmentResult, error) {
	if strings.TrimSpace(req.AttemptID) == "" || strings.TrimSpace(req.ScheduleID) == "" {
		return nil, apperrors.New(apperrors.CodeBadRequest, "Attempt and schedule ids are required.")
	}
	if strings.TrimSpace(req.SubmissionID) == "" || len(req.SubmissionID) > maxSubmissionIDLen {
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
		if err := attempts.EnsureSATModuleTopologyTx(ctx, t, attempt.ID); err != nil {
			outcome = telemetry.FinalizeRejected
			return err
		}
		if s.completionSealer == nil {
			return apperrors.New(apperrors.CodeInternal, "SAT terminalization is unavailable.")
		}
		res, created, err := s.completionSealer.SealCompletion(ctx, t, attempt, req, now)
		if err != nil {
			outcome = telemetry.FinalizeRejected
			return err
		}
		out = res
		if created {
			outcome = telemetry.FinalizeCompleted
		} else {
			outcome = telemetry.FinalizeReplayed
		}
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

// ReconcileProvisional is a compatibility repair for old SAT attempts left in
// the provisional state. It checks the terminal module topology and seals the
// attempt without generating a score.
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
	// Candidate scan runs outside a transaction (read-only sweep); each
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
		  AND NOT EXISTS (SELECT 1 FROM attempt_terminalizations t WHERE t.attempt_id = a.id)
		  AND NOT EXISTS (SELECT 1 FROM assessment_results ar WHERE ar.attempt_id = a.id AND ar.provider_key = 'sat')
		  AND EXISTS (SELECT 1 FROM assessment_module_attempts ma WHERE ma.attempt_id = a.id)
		  AND NOT EXISTS (
			SELECT 1 FROM assessment_module_attempts ma
			WHERE ma.attempt_id = a.id AND ma.state NOT IN (?, ?)
		  )
		ORDER BY a.updated_at ASC
		LIMIT ?`, attempts.SATModuleSubmitted, attempts.SATModuleLocked, batchSize)
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
		// An existing result without a terminal fact is an older partial repair
		// state; leave it for the dedicated data repair path.
		var existingResultID sql.NullString
		if err := t.QueryRowContext(ctx,
			"SELECT id FROM assessment_results WHERE attempt_id = ? AND provider_key = 'sat' FOR UPDATE",
			attempt.ID).Scan(&existingResultID); err != nil && err != sql.ErrNoRows {
			return err
		}
		if existingResultID.Valid {
			return nil
		}
		if err := attempts.EnsureSATModuleTopologyTx(ctx, t, attempt.ID); err != nil {
			if appErr, ok := apperrors.As(err); ok && appErr.Code == apperrors.CodeConflict {
				return nil
			}
			return err
		}
		if s.completionSealer == nil {
			return apperrors.New(apperrors.CodeInternal, "SAT terminalization is unavailable.")
		}
		_, created, err := s.completionSealer.SealCompletion(ctx, t, attempt, CompleteRequest{
			AttemptID: attempt.ID, ScheduleID: attempt.ScheduleID, SubmissionID: attempt.ID,
			ActorKind: terminalization.ActorSystem, RequestID: uuid.NewString(),
		}, now)
		if err != nil {
			outcome = telemetry.FinalizeRejected
			return err
		}
		done = created
		if done {
			outcome = telemetry.FinalizeCompleted
		} else {
			outcome = telemetry.FinalizeReplayed
		}
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

// resultAccum carries the administered adaptive route and its module identity
// into the integrity fence that compares it with the recorded route decision.
type resultAccum struct {
	route          *string
	branchModuleID string
}

// moduleStatesAcceptable reports whether every loaded module row is in a state
// the completion path accepts as done. The rule is owned by attempts
// (SATModuleTerminal, which the provisional submit gate also uses); this is only
// the loop over already-loaded rows, shared by the finalizer and the watchdog so
// the check cannot drift between them.
func moduleStatesAcceptable(mods []moduleRow) bool {
	for _, m := range mods {
		if !attempts.SATModuleTerminal(m.State) {
			return false
		}
	}
	return true
}

// routeDecision is one recorded adaptive-routing decision for an attempt,
// keyed by section key: the module the router selected and the route name
// that selected it.
type routeDecision struct {
	SelectedModuleID string
	SelectedRoute    string
}

// assertResultRouteIntegrity is the last-line fence before a result is
// persisted: every administered adaptive branch must be the module the route
// decision recorded for its section (selected_module_id), and the recorded
// route name must match the branch's adaptive slot (higher <-> higher_branch,
// lower <-> lower_branch). The result otherwise derives its route from the
// administered branch alone and would confidently persist a branch the router
// never selected. A mismatch fails loudly with SAT_ADAPTIVE_ROUTE_INTEGRITY
// and persists nothing; the log carries identities only, never answers.
func assertResultRouteIntegrity(ctx context.Context, attemptID string, decisions map[string]routeDecision, sections map[string]*resultAccum) error {
	for sectionKey, a := range sections {
		if a.route == nil {
			continue
		}
		decision, ok := decisions[sectionKey]
		if !ok {
			return resultRouteIntegrityError(ctx, attemptID, sectionKey, "", "", a.branchModuleID, *a.route, "route_decision_missing")
		}
		if decision.SelectedModuleID != a.branchModuleID || decision.SelectedRoute != *a.route {
			return resultRouteIntegrityError(ctx, attemptID, sectionKey, decision.SelectedModuleID, decision.SelectedRoute, a.branchModuleID, *a.route, "route_module_mismatch")
		}
	}
	return nil
}

func resultRouteIntegrityError(ctx context.Context, attemptID, sectionKey, selectedModuleID, selectedRoute, actualModuleID, actualRoute, reason string) error {
	telemetry.IncCounter(telemetry.MSATAdaptiveIntegrityViolation, "reason", reason)
	slog.ErrorContext(ctx, "SAT adaptive result integrity violation",
		slog.String("code", "SAT_ADAPTIVE_ROUTE_INTEGRITY"),
		slog.String("attempt_id", attemptID),
		slog.String("section_key", sectionKey),
		slog.String("selected_route", selectedRoute),
		slog.String("selected_module_id", selectedModuleID),
		slog.String("actual_module_id", actualModuleID),
		slog.String("actual_route", actualRoute))
	conflict := apperrors.New(apperrors.CodeAssessmentConflict, "The recorded adaptive route does not match the administered module.")
	conflict.Details = map[string]any{
		"reason":           "SAT_ADAPTIVE_ROUTE_INTEGRITY",
		"attemptId":        attemptID,
		"sectionKey":       sectionKey,
		"selectedRoute":    selectedRoute,
		"selectedModuleId": selectedModuleID,
		"actualModuleId":   actualModuleID,
		"actualRoute":      actualRoute,
	}
	return conflict
}

// loadTimeSpentSeconds derives the attempt's active exam time from the
// authoritative module timing: each module that actually ran contributes its
// wall time from start to submit (still-paused modules stop at paused_at),
// minus the pause time the runtime accumulated for it. Clamped at zero per
// module so a clock anomaly can never subtract from another module's time.
//
// Audit finding 4: this value used to be a hardcoded 0, so every completed SAT
// silently claimed the student spent no time at all.
func loadTimeSpentSeconds(ctx context.Context, t tx.Tx, attemptID string) (int64, error) {
	var seconds sql.NullInt64
	err := t.QueryRowContext(ctx, `
		SELECT SUM(GREATEST(TIMESTAMPDIFF(SECOND, started_at, COALESCE(submitted_at, paused_at, UTC_TIMESTAMP(6))) - accumulated_paused_seconds, 0))
		FROM assessment_module_attempts
		WHERE attempt_id = ? AND started_at IS NOT NULL`, attemptID).Scan(&seconds)
	if err != nil {
		return 0, err
	}
	if !seconds.Valid || seconds.Int64 < 0 {
		return 0, nil
	}
	return seconds.Int64, nil
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
