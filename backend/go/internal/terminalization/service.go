// Package terminalization owns the immutable terminal fact for every attempt.
//
// T1: attempt_terminalizations.attempt_id is the PK, terminalization_id UNIQUE.
// T2: seal_attempt_in_tx is the ONLY writer of the receipt (attempt_terminalizations)
//
//	plus the submitted_at/final_submission compatibility projection.
//
// T3: immutability — the repository surface exposes FindByAttemptID + Insert ONLY.
// T4: outcome-only compatibility — existing_outcome == requested_outcome replays
//
//	with created:false (reason ignored); otherwise TERMINALIZATION_CONFLICT.
//
// Vocabulary: outcome submitted|terminated; reason student_submit|sat_complete|
// time_expired|auto_stop|proctor_complete|proctor_end|proctor_force_submit|
// proctor_terminate|legacy_unknown; actor student|proctor|system.
// SAT outcome_status: terminated+proctor=invalidated_proctor;
// terminated+other=invalidated_timeout; submitted=pending.
//
// Seal emits no live event — only the durable in-tx attempt_terminalized outbox row.
//
// Lock order everywhere: attempt -> runtime -> section.
package terminalization

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/google/uuid"

	"example.com/ielts-proctoring/internal/platform/answerblobs"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/telemetry"
	"example.com/ielts-proctoring/internal/platform/tx"
)

// materializeBlobsForSeal rebuilds the legacy answers/writing_answers/flags
// columns from attempt_responses_v2 rows and persists them (plan B3 seal-time
// correctness point). Called only for protocol-2 attempts: V1 blobs stay
// authoritative and are never touched (an empty rows table must not wipe
// them). Runs inside the caller's seal tx after the attempt lock.
func materializeBlobsForSeal(ctx context.Context, q tx.Tx, attemptID string) (answerblobs.Blobs, error) {
	rows, err := q.QueryContext(ctx,
		`SELECT question_id, module_id, CAST(response AS CHAR) FROM attempt_responses_v2 WHERE attempt_id = ? ORDER BY question_id`,
		attemptID)
	if err != nil {
		return answerblobs.Blobs{}, err
	}
	defer rows.Close()
	var cells []answerblobs.Cell
	for rows.Next() {
		var questionID, moduleID, raw string
		if err := rows.Scan(&questionID, &moduleID, &raw); err != nil {
			return answerblobs.Blobs{}, err
		}
		cells = append(cells, answerblobs.Cell{QuestionID: questionID, ModuleID: moduleID, Canonical: json.RawMessage(raw)})
	}
	if err := rows.Err(); err != nil {
		return answerblobs.Blobs{}, err
	}
	blobs, err := answerblobs.Assemble(cells)
	if err != nil {
		return answerblobs.Blobs{}, err
	}
	if _, err := q.ExecContext(ctx, `UPDATE student_attempts SET answers=?, writing_answers=?, flags=? WHERE id=?`, blobs.Answers, blobs.WritingAnswers, blobs.Flags, attemptID); err != nil {
		return answerblobs.Blobs{}, err
	}
	return blobs, nil
}

// Outcome vocabulary.
const (
	OutcomeSubmitted  = "submitted"
	OutcomeTerminated = "terminated"
)

// Reason vocabulary.
const (
	ReasonStudentSubmit    = "student_submit"
	ReasonSATComplete      = "sat_complete"
	ReasonTimeExpired      = "time_expired"
	ReasonAutoStop         = "auto_stop"
	ReasonProctorComplete  = "proctor_complete"
	ReasonProctorEnd       = "proctor_end"
	ReasonProctorForceSub  = "proctor_force_submit"
	ReasonProctorTerminate = "proctor_terminate"
	ReasonLegacyUnknown    = "legacy_unknown"
)

// Actor vocabulary.
const (
	ActorStudent = "student"
	ActorProctor = "proctor"
	ActorSystem  = "system"
)

// SAT materialized outcome statuses.
const (
	SATInvalidatedProctor = "invalidated_proctor"
	SATInvalidatedTimeout = "invalidated_timeout"
	SATPending            = "pending"
)

// Conflict detail reason codes.
const (
	ReasonTerminalizationConflict = "TERMINALIZATION_CONFLICT"
	ReasonBaseRevisionMismatch    = "BASE_REVISION_MISMATCH"
	ReasonAttemptProctorBlocked   = "ATTEMPT_PROCTOR_BLOCKED"
)

// ClaimPredicate is the conditional claim UPDATE predicate shared by the
// terminated and submitted claim paths. Both branches include the provisional
// OR-branch so rows written by the legacy/student path as
// submitted/post-exam with a NULL projection can still be claimed exactly once:
// ((submitted_at IS NULL AND phase <> 'post-exam') OR
//
//	(delivery_status = 'submitted' AND phase = 'post-exam' AND final_submission IS NULL))
const ClaimPredicate = "((submitted_at IS NULL AND phase <> 'post-exam') OR (delivery_status = 'submitted' AND phase = 'post-exam' AND final_submission IS NULL))"

// SealCommand is the single terminal intent for an attempt.
type SealCommand struct {
	AttemptID         string
	ScheduleID        string
	Outcome           string
	Reason            string
	ActorKind         string
	ActorID           *string
	ProctorNote       *string
	EffectiveAt       *time.Time
	MinAnswerRevision *uint64
	FinalSubmission   json.RawMessage
	RequestID         string
}

// SealResult is the seal outcome. Created=false is an outcome-compatible replay.
type SealResult struct {
	Created           bool
	TerminalizationID string
	Outcome           string
	Reason            string
	EffectiveAt       time.Time
	RecordedAt        time.Time
}

// Receipt is the immutable terminal fact row (attempt_id PK).
type Receipt struct {
	AttemptID         string
	OrganizationID    *string
	TerminalizationID string
	ScheduleID        string
	Outcome           string
	Reason            string
	ActorKind         string
	ActorID           *string
	EffectiveAt       time.Time
	RecordedAt        time.Time
	AnswerRevision    int64
	FinalSnapshot     json.RawMessage
	RequestID         string
}

// TerminalizationRepository is the immutable receipt store: lookup plus plain
// insert — the receipt row is never mutated or removed through this surface.
type TerminalizationRepository interface {
	FindByAttemptID(ctx context.Context, q tx.Tx, attemptID string) (*Receipt, error)
	Insert(ctx context.Context, q tx.Tx, r *Receipt) error
}

// OutboxEnqueuer is the minimal in-tx outbox hook for attempt_terminalized.
type OutboxEnqueuer interface {
	EnqueueInTx(ctx context.Context, q tx.Tx, aggregateKind, aggregateID string, revision int64, eventFamily string, payload json.RawMessage) error
}

// AttemptScorer computes provider-owned score fields from the server's locked
// answer snapshot. It returns projection fields (for example score,
// providerKey, and section); it must not trust client score data.
type AttemptScorer interface {
	ScoreAttempt(ctx context.Context, q tx.Tx, attemptID, versionID string, answers json.RawMessage) (map[string]any, error)
}

// SQLTerminalizationRepository is the MySQL receipt store.
type SQLTerminalizationRepository struct{}

var _ TerminalizationRepository = (*SQLTerminalizationRepository)(nil)

// FindByAttemptID loads the receipt under SELECT ... FOR UPDATE.
func (SQLTerminalizationRepository) FindByAttemptID(ctx context.Context, q tx.Tx, attemptID string) (*Receipt, error) {
	const sel = "SELECT attempt_id, organization_id, terminalization_id, schedule_id, outcome, reason, actor_kind, actor_id, effective_at, recorded_at, answer_revision, final_snapshot, request_id FROM attempt_terminalizations WHERE attempt_id = ? FOR UPDATE"
	row := q.QueryRowContext(ctx, sel, attemptID)
	var r Receipt
	var org, actor sql.NullString
	var effAny, recAny any
	var snapshot []byte
	if err := row.Scan(&r.AttemptID, &org, &r.TerminalizationID, &r.ScheduleID, &r.Outcome, &r.Reason, &r.ActorKind, &actor, &effAny, &recAny, &r.AnswerRevision, &snapshot, &r.RequestID); err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	if org.Valid {
		v := org.String
		r.OrganizationID = &v
	}
	if actor.Valid {
		v := actor.String
		r.ActorID = &v
	}
	eff, ok := asTime(effAny)
	if !ok {
		return nil, fmt.Errorf("terminalization: invalid effective_at")
	}
	rec, ok := asTime(recAny)
	if !ok {
		return nil, fmt.Errorf("terminalization: invalid recorded_at")
	}
	r.EffectiveAt = eff
	r.RecordedAt = rec
	r.FinalSnapshot = append(json.RawMessage(nil), snapshot...)
	return &r, nil
}

// Insert performs a plain INSERT of the receipt (no upsert semantics).
func (SQLTerminalizationRepository) Insert(ctx context.Context, q tx.Tx, r *Receipt) error {
	const ins = "INSERT INTO attempt_terminalizations (attempt_id, organization_id, terminalization_id, schedule_id, outcome, reason, actor_kind, actor_id, effective_at, recorded_at, answer_revision, final_snapshot, request_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
	_, err := q.ExecContext(ctx, ins, r.AttemptID, r.OrganizationID, r.TerminalizationID, r.ScheduleID, r.Outcome, r.Reason, r.ActorKind, r.ActorID, r.EffectiveAt, r.RecordedAt, r.AnswerRevision, string(r.FinalSnapshot), r.RequestID)
	return err
}

// SQLOutboxEnqueuer writes durable outbox rows in-tx.
type SQLOutboxEnqueuer struct{}

var _ OutboxEnqueuer = (*SQLOutboxEnqueuer)(nil)

// EnqueueInTx inserts one outbox row in the caller's transaction.
func (SQLOutboxEnqueuer) EnqueueInTx(ctx context.Context, q tx.Tx, aggregateKind, aggregateID string, revision int64, eventFamily string, payload json.RawMessage) error {
	const ins = "INSERT INTO outbox_events (id, aggregate_kind, aggregate_id, revision, event_family, payload, created_at, publish_attempts) VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(6), 0)"
	_, err := q.ExecContext(ctx, ins, uuid.NewString(), aggregateKind, aggregateID, revision, eventFamily, string(payload))
	return err
}

// OutcomeCompat reports T4 outcome-only compatibility: the same outcome
// replays regardless of reason; a different outcome conflicts.
func OutcomeCompat(existingOutcome, requestedOutcome string) bool {
	return existingOutcome == requestedOutcome
}

// SATOutcomeStatus maps seal intent to the SAT materialized outcome_status:
// terminated+proctor=invalidated_proctor, terminated+other=invalidated_timeout,
// submitted=pending.
func SATOutcomeStatus(outcome, actorKind string) string {
	switch {
	case outcome == OutcomeTerminated && actorKind == ActorProctor:
		return SATInvalidatedProctor
	case outcome == OutcomeTerminated:
		return SATInvalidatedTimeout
	default:
		return SATPending
	}
}

func validOutcome(o string) bool { return o == OutcomeSubmitted || o == OutcomeTerminated }

func validReason(r string) bool {
	switch r {
	case ReasonStudentSubmit, ReasonSATComplete, ReasonTimeExpired, ReasonAutoStop,
		ReasonProctorComplete, ReasonProctorEnd, ReasonProctorForceSub,
		ReasonProctorTerminate, ReasonLegacyUnknown:
		return true
	}
	return false
}

func validActor(a string) bool { return a == ActorStudent || a == ActorProctor || a == ActorSystem }

// isDupKeyErr reports a duplicate-key receipt INSERT (PK/unique race):
// case-insensitive contains duplicate plus entry/unique/1062, or MySQL 1062.
func isDupKeyErr(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	if !strings.Contains(msg, "duplicate") {
		return false
	}
	return strings.Contains(msg, "entry") || strings.Contains(msg, "unique") || strings.Contains(msg, "1062")
}

// ValidateSealCommand enforces the outcome/reason/actor vocabulary.
func ValidateSealCommand(cmd SealCommand) error {
	if cmd.AttemptID == "" || cmd.ScheduleID == "" {
		return &apperrors.Error{Code: apperrors.CodeBadRequest, Message: "attempt id and schedule id are required.", HTTPStatus: 400}
	}
	if !validOutcome(cmd.Outcome) {
		return &apperrors.Error{Code: apperrors.CodeBadRequest, Message: "Terminalization outcome is not supported.", HTTPStatus: 400}
	}
	if !validReason(cmd.Reason) {
		return &apperrors.Error{Code: apperrors.CodeBadRequest, Message: "Terminalization reason is not supported.", HTTPStatus: 400}
	}
	if !validActor(cmd.ActorKind) {
		return &apperrors.Error{Code: apperrors.CodeBadRequest, Message: "Terminalization actor is not supported.", HTTPStatus: 400}
	}
	return nil
}

// Service seals attempts through the receipt-first transaction.
type Service struct {
	tx            *tx.Runner
	repo          TerminalizationRepository
	outbx         OutboxEnqueuer
	attemptScorer AttemptScorer
	// outboxExecOnly skips the wakeup attempt_terminalized INSERT (B4.1).
	outboxExecOnly bool
}

// SetOutboxExecOnly toggles B4.1 executable-only enqueueing (chainable).
func (s *Service) SetOutboxExecOnly(on bool) *Service {
	s.outboxExecOnly = on
	return s
}

// NewService builds the terminalization service with constructor injection.
func NewService(runner *tx.Runner, repo TerminalizationRepository, outbx OutboxEnqueuer) *Service {
	if repo == nil {
		repo = SQLTerminalizationRepository{}
	}
	if outbx == nil {
		outbx = SQLOutboxEnqueuer{}
	}
	return &Service{tx: runner, repo: repo, outbx: outbx}
}

// SetAttemptScorer wires a provider scorer after composition. Keeping the
// callback at the terminalization boundary means every generic seal path
// (student, proctor, worker) receives the same server-authoritative scoring.
func (s *Service) SetAttemptScorer(scorer AttemptScorer) *Service {
	s.attemptScorer = scorer
	return s
}

// Terminalize runs the full receipt-first seal inside one transaction.
//
// Telemetry increments happen outside the tx closure, after the commit
// decision: Created=true emits MTerminalCreated (outcome accepted),
// Created=false emits MTerminalReplay (outcome exact_replay), and
// TerminalConflict/Conflict apperrors emit MTerminalConflict.
func (s *Service) Terminalize(ctx context.Context, cmd SealCommand) (*SealResult, error) {
	if err := ValidateSealCommand(cmd); err != nil {
		return nil, err
	}
	var out *SealResult
	err := s.tx.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		res, err := s.sealAttemptInTx(ctx, q, cmd)
		if err != nil {
			return err
		}
		out = res
		return nil
	})
	if err != nil {
		if appErr, ok := apperrors.As(err); ok {
			switch appErr.Code {
			case apperrors.CodeTerminalConflict, apperrors.CodeConflict:
				telemetry.IncCounter(telemetry.MTerminalConflict)
			}
		}
		return nil, err
	}
	if out != nil {
		if out.Created {
			telemetry.IncCounter(telemetry.MTerminalCreated, "outcome", telemetry.OutcomeAccepted)
		} else {
			telemetry.IncCounter(telemetry.MTerminalReplay, "outcome", telemetry.OutcomeExactReplay)
		}
	}
	return out, nil
}

// TerminalizeInTx seals an attempt on a transaction owned by the caller.
// Compatibility handlers use this when they must apply a final legacy patch
// and create the immutable receipt without opening a second transaction.
// Callers own commit/rollback; the regular Terminalize method remains the
// preferred entry point when no surrounding transaction is required.
func (s *Service) TerminalizeInTx(ctx context.Context, q tx.Tx, cmd SealCommand) (*SealResult, error) {
	if err := ValidateSealCommand(cmd); err != nil {
		return nil, err
	}
	return s.sealAttemptInTx(ctx, q, cmd)
}

// MaterializeProviderResultInTx exposes the provider projection step to a
// compatibility sealer that already owns the attempt transaction. It is kept
// deliberately narrow: callers cannot mutate the immutable receipt through
// this method and must supply the receipt's already-recorded identity.
func (s *Service) MaterializeProviderResultInTx(ctx context.Context, q tx.Tx, attemptID, providerKey, outcome, reason, actorKind, terminalizationID string, effectiveAt time.Time, snapshot, projection json.RawMessage) error {
	return s.materializeProviderResult(ctx, q, attemptID, providerKey, outcome, reason, actorKind, terminalizationID, effectiveAt, snapshot, projection)
}

// attemptRow is the locked attempt subset the seal needs.
type attemptRow struct {
	ID              string
	ScheduleID      string
	OrganizationID  *string
	ExamID          string
	PublishedVerID  string
	Phase           string
	DeliveryStatus  string
	ProctorStatus   string
	Revision        int64
	AnswerRevision  int64
	Answers         json.RawMessage
	WritingAnswers  json.RawMessage
	Flags           json.RawMessage
	ProtocolVersion int
}

// sealAttemptInTx implements the 12 seal steps. The receipt INSERT (step 8)
// always precedes the claim UPDATE (step 10) in the same tx.
func (s *Service) sealAttemptInTx(ctx context.Context, q tx.Tx, cmd SealCommand) (*SealResult, error) {
	// Step 1: lock attempt FOR UPDATE.
	const lockAttempt = "SELECT id, schedule_id, organization_id, exam_id, published_version_id, phase, COALESCE(delivery_status,'running'), COALESCE(proctor_status,'active'), revision, answer_revision, answers, writing_answers, flags, COALESCE(protocol_version,1) FROM student_attempts WHERE id = ? AND schedule_id = ? FOR UPDATE"
	var a attemptRow
	var org sql.NullString
	var answers, writing, flags []byte
	if err := q.QueryRowContext(ctx, lockAttempt, cmd.AttemptID, cmd.ScheduleID).Scan(&a.ID, &a.ScheduleID, &org, &a.ExamID, &a.PublishedVerID, &a.Phase, &a.DeliveryStatus, &a.ProctorStatus, &a.Revision, &a.AnswerRevision, &answers, &writing, &flags, &a.ProtocolVersion); err != nil {
		if err == sql.ErrNoRows {
			return nil, &apperrors.Error{Code: apperrors.CodeNotFound, Message: "Attempt not found.", HTTPStatus: 404}
		}
		return nil, err
	}
	if org.Valid {
		v := org.String
		a.OrganizationID = &v
	}
	a.Answers = append(json.RawMessage(nil), answers...)
	a.WritingAnswers = append(json.RawMessage(nil), writing...)
	a.Flags = append(json.RawMessage(nil), flags...)

	// B3 seal-time correctness point: V2 attempts rebuild blob columns from
	// rows synchronously so grading/snapshot never see staleness. V1 blobs
	// stay authoritative (never touched).
	if a.ProtocolVersion == 2 {
		blobs, merr := materializeBlobsForSeal(ctx, q, a.ID)
		if merr != nil {
			return nil, merr
		}
		a.Answers = json.RawMessage(blobs.Answers)
		a.WritingAnswers = json.RawMessage(blobs.WritingAnswers)
		a.Flags = json.RawMessage(blobs.Flags)
	}

	// Provider key for snapshot + SAT materialization.
	var providerNull sql.NullString
	if err := q.QueryRowContext(ctx, "SELECT provider_key FROM exam_entities WHERE id = ?", a.ExamID).Scan(&providerNull); err != nil && err != sql.ErrNoRows {
		return nil, err
	}
	providerKey := "legacy"
	if providerNull.Valid && providerNull.String != "" {
		providerKey = providerNull.String
	}

	// Step 2: replay check — receipt FOR UPDATE.
	existing, err := s.repo.FindByAttemptID(ctx, q, a.ID)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		// T4 outcome-only compat: reason ignored on replay.
		if OutcomeCompat(existing.Outcome, cmd.Outcome) {
			if err := s.materializeProviderResult(ctx, q, a.ID, providerKey, existing.Outcome, existing.Reason, existing.ActorKind, existing.TerminalizationID, existing.EffectiveAt, existing.FinalSnapshot, nil); err != nil {
				return nil, err
			}
			return &SealResult{Created: false, TerminalizationID: existing.TerminalizationID, Outcome: existing.Outcome, Reason: existing.Reason, EffectiveAt: existing.EffectiveAt, RecordedAt: existing.RecordedAt}, nil
		}
		return nil, &apperrors.Error{
			Code:       apperrors.CodeTerminalConflict,
			Message:    fmt.Sprintf("Attempt is already terminalized as %s (%s).", existing.Outcome, existing.Reason),
			HTTPStatus: 409,
			Details: map[string]any{
				"reason":            ReasonTerminalizationConflict,
				"outcome":           existing.Outcome,
				"terminalReason":    existing.Reason,
				"terminalizationId": existing.TerminalizationID,
				"latestRevision":    a.Revision,
			},
		}
	}

	// Step 3: validate outcome/reason vocabulary.
	if err := ValidateSealCommand(cmd); err != nil {
		return nil, err
	}

	// Step 4: optional min_answer_revision fence => 409 BASE_REVISION_MISMATCH.
	if cmd.MinAnswerRevision != nil && uint64(a.AnswerRevision) < *cmd.MinAnswerRevision {
		return nil, &apperrors.Error{
			Code:       apperrors.CodeConflict,
			Message:    fmt.Sprintf("Attempt answers are not persisted through the required revision (required %d, actual %d).", *cmd.MinAnswerRevision, a.AnswerRevision),
			HTTPStatus: 409,
			Details: map[string]any{
				"reason":           ReasonBaseRevisionMismatch,
				"latestRevision":   a.Revision,
				"answerRevision":   a.AnswerRevision,
				"requiredRevision": *cmd.MinAnswerRevision,
			},
		}
	}

	// Step 7: recorded_at=UTC_TIMESTAMP(6) read in-tx; effective=cmd or recorded.
	var recordedAny any
	if err := q.QueryRowContext(ctx, "SELECT UTC_TIMESTAMP(6)").Scan(&recordedAny); err != nil {
		return nil, err
	}
	recordedAt, ok := asTime(recordedAny)
	if !ok {
		return nil, fmt.Errorf("terminalization: invalid UTC_TIMESTAMP(6)")
	}
	effectiveAt := recordedAt
	if cmd.EffectiveAt != nil {
		effectiveAt = cmd.EffectiveAt.UTC()
	}

	// Step 5: if sat+terminated lock SAT modules UPDATE ... state='locked' ... WHERE state IN (not_started,active,review).
	if providerKey == "sat" && cmd.Outcome == OutcomeTerminated {
		const lockMods = "UPDATE assessment_module_attempts SET state = 'locked', locked_at = COALESCE(locked_at, ?), paused_at = NULL, completion_reason = COALESCE(completion_reason, ?), revision = revision + 1 WHERE attempt_id = ? AND state IN ('not_started', 'active', 'review')"
		if _, err := q.ExecContext(ctx, lockMods, effectiveAt, cmd.Reason, a.ID); err != nil {
			return nil, err
		}
	}

	// Step 6: build server snapshot FOR UPDATE (attempt row already locked; SAT detail locked below).
	snapshot, err := buildServerSnapshot(ctx, q, a, providerKey)
	if err != nil {
		return nil, err
	}
	// Provider scoring is part of the seal transaction. The callback receives
	// only the server-locked answer snapshot; client-provided score fields are
	// rejected before the scorer is invoked.
	if providerKey == "act" && cmd.Outcome == OutcomeSubmitted && s.attemptScorer != nil {
		if jsonObjectHasKey(cmd.FinalSubmission, "score") {
			return nil, &apperrors.Error{Code: apperrors.CodeBadRequest, Message: "Client-supplied ACT scores are rejected; scoring is server-authoritative.", HTTPStatus: 400}
		}
		fields, err := s.attemptScorer.ScoreAttempt(ctx, q, a.ID, a.PublishedVerID, a.Answers)
		if err != nil {
			return nil, err
		}
		cmd.FinalSubmission, err = mergeJSONObject(cmd.FinalSubmission, fields)
		if err != nil {
			return nil, err
		}
		snapshot, err = mergeJSONObject(snapshot, fields)
		if err != nil {
			return nil, err
		}
	}

	// IDs: uuid.
	terminalizationID := uuid.NewString()
	requestID := cmd.RequestID
	if _, err := uuid.Parse(requestID); err != nil {
		requestID = uuid.NewString()
	}

	// Step 8: plain INSERT receipt BEFORE claim UPDATE.
	receipt := &Receipt{
		AttemptID:         a.ID,
		OrganizationID:    a.OrganizationID,
		TerminalizationID: terminalizationID,
		ScheduleID:        a.ScheduleID,
		Outcome:           cmd.Outcome,
		Reason:            cmd.Reason,
		ActorKind:         cmd.ActorKind,
		ActorID:           cmd.ActorID,
		EffectiveAt:       effectiveAt,
		RecordedAt:        recordedAt,
		AnswerRevision:    a.AnswerRevision,
		FinalSnapshot:     snapshot,
		RequestID:         requestID,
	}
	if err := s.repo.Insert(ctx, q, receipt); err != nil {
		if isDupKeyErr(err) {
			existing, ferr := s.repo.FindByAttemptID(ctx, q, a.ID)
			if ferr != nil {
				return nil, ferr
			}
			if existing == nil {
				return nil, err
			}
			if OutcomeCompat(existing.Outcome, cmd.Outcome) {
				if merr := s.materializeProviderResult(ctx, q, a.ID, providerKey, existing.Outcome, existing.Reason, existing.ActorKind, existing.TerminalizationID, existing.EffectiveAt, existing.FinalSnapshot, nil); merr != nil {
					return nil, merr
				}
				return &SealResult{Created: false, TerminalizationID: existing.TerminalizationID, Outcome: existing.Outcome, Reason: existing.Reason, EffectiveAt: existing.EffectiveAt, RecordedAt: existing.RecordedAt}, nil
			}
			return nil, &apperrors.Error{
				Code:       apperrors.CodeTerminalConflict,
				Message:    fmt.Sprintf("Attempt is already terminalized as %s (%s).", existing.Outcome, existing.Reason),
				HTTPStatus: 409,
				Details: map[string]any{
					"reason":            ReasonTerminalizationConflict,
					"outcome":           existing.Outcome,
					"terminalReason":    existing.Reason,
					"terminalizationId": existing.TerminalizationID,
					"latestRevision":    a.Revision,
				},
			}
		}
		return nil, err
	}

	// Step 9: build final_submission projection.
	projection := buildFinalSubmission(snapshot, cmd, terminalizationID, effectiveAt)

	// Step 10: conditional claim UPDATE. Terminated sets proctor fields;
	// submitted additionally requires COALESCE(proctor_status,'active')<>'terminated'.
	// Both include the provisional OR-branch (ClaimPredicate). rows!=1 => Conflict.
	var claimRes sql.Result
	if cmd.Outcome == OutcomeTerminated {
		stmt := "UPDATE student_attempts SET phase = 'post-exam', delivery_status = 'terminated', final_submission = ?, submitted_at = COALESCE(submitted_at, ?), proctor_status = 'terminated', proctor_note = COALESCE(?, proctor_note), proctor_updated_at = UTC_TIMESTAMP(6), proctor_updated_by = ?, updated_at = UTC_TIMESTAMP(6), revision = revision + 1, control_epoch = control_epoch + 1 WHERE id = ? AND schedule_id = ? AND " + ClaimPredicate
		claimRes, err = q.ExecContext(ctx, stmt, string(projection), effectiveAt, cmd.ProctorNote, cmd.ActorID, a.ID, a.ScheduleID)
	} else {
		stmt := "UPDATE student_attempts SET phase = 'post-exam', delivery_status = 'submitted', final_submission = ?, submitted_at = COALESCE(submitted_at, ?), updated_at = UTC_TIMESTAMP(6), revision = revision + 1, control_epoch = control_epoch + 1 WHERE id = ? AND schedule_id = ? AND " + ClaimPredicate + " AND COALESCE(proctor_status, 'active') <> 'terminated'"
		claimRes, err = q.ExecContext(ctx, stmt, string(projection), effectiveAt, a.ID, a.ScheduleID)
	}
	if err != nil {
		return nil, err
	}
	n, err := claimRes.RowsAffected()
	if err != nil {
		return nil, err
	}
	if n != 1 {
		msg := "Attempt is blocked by proctor termination."
		if cmd.Outcome == OutcomeTerminated {
			msg = "Attempt could not be claimed for proctor termination."
		}
		return nil, &apperrors.Error{
			Code:       apperrors.CodeConflict,
			Message:    msg,
			HTTPStatus: 409,
			Details:    map[string]any{"reason": ReasonAttemptProctorBlocked, "latestRevision": a.Revision},
		}
	}

	// Step 11: SAT materialize.
	if err := s.materializeProviderResult(ctx, q, a.ID, providerKey, cmd.Outcome, cmd.Reason, cmd.ActorKind, terminalizationID, effectiveAt, snapshot, projection); err != nil {
		return nil, err
	}

	// Step 12: outbox enqueue + return created:true. No live event.
	payload, _ := json.Marshal(map[string]any{
		"terminalizationId": terminalizationID,
		"attemptId":         a.ID,
		"scheduleId":        a.ScheduleID,
		"organizationId":    a.OrganizationID,
		"outcome":           cmd.Outcome,
		"reason":            cmd.Reason,
		"answerRevision":    a.AnswerRevision,
	})
	// B4.1: exec-only mode skips the wakeup INSERT (live moves to Hub in C).
	if !s.outboxExecOnly {
		if err := s.outbx.EnqueueInTx(ctx, q, "attempt_terminalization", a.ID, a.Revision+1, "attempt_terminalized", payload); err != nil {
			return nil, err
		}
	}
	return &SealResult{Created: true, TerminalizationID: terminalizationID, Outcome: cmd.Outcome, Reason: cmd.Reason, EffectiveAt: effectiveAt, RecordedAt: recordedAt}, nil
}

// buildServerSnapshot builds the server-side snapshot; SAT detail rows are read FOR UPDATE.
func buildServerSnapshot(ctx context.Context, q tx.Tx, a attemptRow, providerKey string) (json.RawMessage, error) {
	ans := a.Answers
	if len(ans) == 0 {
		ans = json.RawMessage("{}")
	}
	wr := a.WritingAnswers
	if len(wr) == 0 {
		wr = json.RawMessage("{}")
	}
	fl := a.Flags
	if len(fl) == 0 {
		fl = json.RawMessage("{}")
	}
	var org any
	if a.OrganizationID != nil {
		org = *a.OrganizationID
	}
	snap := map[string]any{
		"attemptId":          a.ID,
		"scheduleId":         a.ScheduleID,
		"organizationId":     org,
		"examId":             a.ExamID,
		"publishedVersionId": a.PublishedVerID,
		"providerKey":        providerKey,
		"answerRevision":     a.AnswerRevision,
		"answers":            json.RawMessage(ans),
		"writingAnswers":     json.RawMessage(wr),
		"flags":              json.RawMessage(fl),
	}
	if providerKey == "sat" {
		const selMods = "SELECT id, module_id, state, allocated_seconds, started_at, submitted_at, locked_at, completion_reason, revision FROM assessment_module_attempts WHERE attempt_id = ? ORDER BY created_at, id FOR UPDATE"
		mrows, err := q.QueryContext(ctx, selMods, a.ID)
		if err != nil {
			return nil, err
		}
		mods := []any{}
		scanErr := func() error {
			defer mrows.Close()
			for mrows.Next() {
				var id, moduleID, state string
				var allocated, rev int64
				var startedAny, submittedAny, lockedAny any
				var reason sql.NullString
				if err := mrows.Scan(&id, &moduleID, &state, &allocated, &startedAny, &submittedAny, &lockedAny, &reason, &rev); err != nil {
					return err
				}
				m := map[string]any{"id": id, "moduleId": moduleID, "state": state, "allocatedSeconds": allocated, "revision": rev}
				if t, ok := asTime(startedAny); ok {
					m["startedAt"] = t
				}
				if t, ok := asTime(submittedAny); ok {
					m["submittedAt"] = t
				}
				if t, ok := asTime(lockedAny); ok {
					m["lockedAt"] = t
				}
				if reason.Valid {
					m["completionReason"] = reason.String
				}
				mods = append(mods, m)
			}
			return mrows.Err()
		}()
		if scanErr != nil {
			return nil, scanErr
		}
		const selResp = "SELECT id, module_attempt_id, exam_question_id, response, marked_for_review, eliminated_options, annotations, revision FROM assessment_question_responses WHERE module_attempt_id IN (SELECT id FROM assessment_module_attempts WHERE attempt_id = ?) ORDER BY module_attempt_id, exam_question_id FOR UPDATE"
		rrows, err := q.QueryContext(ctx, selResp, a.ID)
		if err != nil {
			return nil, err
		}
		resps := []any{}
		scanErr = func() error {
			defer rrows.Close()
			for rrows.Next() {
				var id, modAttemptID, examQID string
				var response, elim, ann []byte
				var markedAny any
				var rev int64
				if err := rrows.Scan(&id, &modAttemptID, &examQID, &response, &markedAny, &elim, &ann, &rev); err != nil {
					return err
				}
				if len(response) == 0 {
					response = []byte("null")
				}
				if len(elim) == 0 {
					elim = []byte("[]")
				}
				if len(ann) == 0 {
					ann = []byte("[]")
				}
				resps = append(resps, map[string]any{
					"id": id, "moduleAttemptId": modAttemptID, "examQuestionId": examQID,
					"response": json.RawMessage(response), "markedForReview": asBool(markedAny),
					"eliminatedOptions": json.RawMessage(elim), "annotations": json.RawMessage(ann),
					"revision": rev,
				})
			}
			return rrows.Err()
		}()
		if scanErr != nil {
			return nil, scanErr
		}
		snap["assessment"] = map[string]any{"moduleAttempts": mods, "responses": resps}
	}
	return json.Marshal(snap)
}

// buildFinalSubmission projects the compatibility final_submission. Server
// snapshot values win for answers/writingAnswers/flags/providerKey; the seal
// always stamps submittedAt/completionReason/terminalizationOutcome/
// terminalizationId, and terminated marks terminated:true.
func buildFinalSubmission(snapshot json.RawMessage, cmd SealCommand, terminalizationID string, effectiveAt time.Time) json.RawMessage {
	var snap map[string]any
	_ = json.Unmarshal(snapshot, &snap)
	var proj map[string]any
	if len(cmd.FinalSubmission) > 0 {
		if err := json.Unmarshal(cmd.FinalSubmission, &proj); err != nil || proj == nil {
			proj = map[string]any{}
		}
	} else {
		proj = map[string]any{
			"submissionId":     "submission-" + strings.ReplaceAll(uuid.NewString(), "-", ""),
			"submittedAt":      effectiveAt.Format(time.RFC3339Nano),
			"answers":          snap["answers"],
			"writingAnswers":   snap["writingAnswers"],
			"flags":            snap["flags"],
			"completionReason": cmd.Reason,
			"autoSubmission":   cmd.Outcome == OutcomeSubmitted && cmd.Reason != ReasonStudentSubmit,
		}
		if cmd.Outcome == OutcomeTerminated {
			proj["terminated"] = true
		}
	}
	proj["submittedAt"] = effectiveAt.Format(time.RFC3339Nano)
	proj["completionReason"] = cmd.Reason
	proj["terminalizationOutcome"] = cmd.Outcome
	proj["terminalizationId"] = terminalizationID
	if cmd.Outcome == OutcomeSubmitted && cmd.Reason != ReasonStudentSubmit {
		// Keep the compatibility projection explicit about why the candidate did
		// not submit locally. This is consumed by result/recovery clients and is
		// especially important when the seal was requested by a proctor or the
		// runtime timeout reconciler.
		proj["autoSubmission"] = true
		proj["submissionPolicy"] = "forced_auto_submit"
	}
	for _, k := range []string{"answers", "writingAnswers", "flags", "providerKey"} {
		if v, ok := snap[k]; ok {
			if _, present := proj[k]; !present {
				proj[k] = v
			}
		}
	}
	if cmd.Outcome == OutcomeTerminated {
		proj["terminated"] = true
	}
	b, _ := json.Marshal(proj)
	return b
}

func jsonObjectHasKey(raw json.RawMessage, key string) bool {
	if len(raw) == 0 || strings.TrimSpace(string(raw)) == "" || string(raw) == "null" {
		return false
	}
	var object map[string]any
	if err := json.Unmarshal(raw, &object); err != nil || object == nil {
		return false
	}
	_, ok := object[key]
	return ok
}

func mergeJSONObject(raw json.RawMessage, fields map[string]any) (json.RawMessage, error) {
	object := map[string]any{}
	if len(raw) > 0 && strings.TrimSpace(string(raw)) != "" && string(raw) != "null" {
		if err := json.Unmarshal(raw, &object); err != nil {
			return nil, err
		}
		if object == nil {
			object = map[string]any{}
		}
	}
	for key, value := range fields {
		object[key] = value
	}
	encoded, err := json.Marshal(object)
	if err != nil {
		return nil, err
	}
	return encoded, nil
}

func (s *Service) materializeProviderResult(ctx context.Context, q tx.Tx, attemptID, providerKey, outcome, reason, actorKind, terminalizationID string, effectiveAt time.Time, snapshot, projection json.RawMessage) error {
	if err := s.materializeSATResult(ctx, q, attemptID, providerKey, outcome, reason, actorKind, terminalizationID, effectiveAt, snapshot); err != nil {
		return err
	}
	if providerKey == "act" {
		return s.materializeACTResult(ctx, q, attemptID, outcome, reason, actorKind, terminalizationID, effectiveAt, snapshot, projection)
	}
	return nil
}

// materializeSATResult locks assessment_results FOR UPDATE and enforces the SAT
// outcome rule: terminated+exists+differs => DELETE sections + UPDATE
// invalidated; none => INSERT invalidated; submitted+exists noop.
func (s *Service) materializeSATResult(ctx context.Context, q tx.Tx, attemptID, providerKey, outcome, reason, actorKind, terminalizationID string, effectiveAt time.Time, snapshot json.RawMessage) error {
	if providerKey != "sat" {
		return nil
	}
	want := SATOutcomeStatus(outcome, actorKind)
	const sel = "SELECT id, outcome_status FROM assessment_results WHERE attempt_id = ? AND provider_key = 'sat' FOR UPDATE"
	var resultID, existingStatus string
	err := q.QueryRowContext(ctx, sel, attemptID).Scan(&resultID, &existingStatus)
	switch {
	case err == nil:
		if outcome == OutcomeTerminated && existingStatus != want {
			if _, err := q.ExecContext(ctx, "DELETE FROM assessment_section_results WHERE assessment_result_id = ?", resultID); err != nil {
				return err
			}
			payload, _ := json.Marshal(map[string]any{
				"providerKey": "sat", "outcomeStatus": want, "completionReason": reason,
				"terminalizationId": terminalizationID, "submittedAt": effectiveAt,
				"snapshot": json.RawMessage(snapshot),
			})
			_, err = q.ExecContext(ctx, "UPDATE assessment_results SET submission_id = NULL, total_score = NULL, outcome_status = ?, release_status = 'invalidated', score_payload = ?, updated_at = UTC_TIMESTAMP(6), revision = revision + 1 WHERE id = ?", want, string(payload), resultID)
			return err
		}
		// submitted+exists noop; terminated+exists+same noop.
		return nil
	case err == sql.ErrNoRows:
		payload, _ := json.Marshal(map[string]any{
			"providerKey": "sat", "outcomeStatus": want, "completionReason": reason,
			"terminalizationId": terminalizationID, "submittedAt": effectiveAt,
			"snapshot": json.RawMessage(snapshot),
		})
		relStatus := "pending"
		if outcome == OutcomeTerminated {
			relStatus = "invalidated"
		}
		_, err = q.ExecContext(ctx, "INSERT INTO assessment_results (id, attempt_id, submission_id, provider_key, outcome_status, total_score, score_payload, release_status) VALUES (?, ?, NULL, 'sat', ?, NULL, ?, ?)", uuid.NewString(), attemptID, want, string(payload), relStatus)
		return err
	default:
		return err
	}
}

// materializeACTResult keeps the provider-neutral result table aligned with
// the ACT final_submission projection. ACT has one objective section, so the
// score payload is sufficient for reports while the immutable terminal
// snapshot remains the source of truth for audit/replay.
func (s *Service) materializeACTResult(ctx context.Context, q tx.Tx, attemptID, outcome, reason, actorKind, terminalizationID string, effectiveAt time.Time, snapshot, projection json.RawMessage) error {
	want := "invalidated_timeout"
	if actorKind == ActorProctor {
		want = "invalidated_proctor"
	}
	if outcome == OutcomeSubmitted {
		want = "scored"
	}
	var score map[string]any
	var snap map[string]any
	_ = json.Unmarshal(snapshot, &snap)
	if raw, ok := snap["score"]; ok {
		if value, ok := raw.(map[string]any); ok {
			score = value
		}
	}
	payload := map[string]any{
		"providerKey": "act", "outcomeStatus": want,
		"completionReason": reason, "terminalizationId": terminalizationID,
		"submittedAt": effectiveAt, "snapshot": json.RawMessage(snapshot),
	}
	if score != nil {
		payload["score"] = score
	}
	payloadJSON, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	var existingID, existingStatus string
	err = q.QueryRowContext(ctx, "SELECT id, outcome_status FROM assessment_results WHERE attempt_id = ? AND provider_key = 'act' FOR UPDATE", attemptID).Scan(&existingID, &existingStatus)
	if err == nil {
		if existingStatus == want {
			return nil
		}
		_, err = q.ExecContext(ctx, "UPDATE assessment_results SET submission_id = NULL, total_score = NULL, outcome_status = ?, release_status = 'invalidated', score_payload = ?, updated_at = UTC_TIMESTAMP(6), revision = revision + 1 WHERE id = ?", want, string(payloadJSON), existingID)
		return err
	}
	if err != sql.ErrNoRows {
		return err
	}
	var total any
	releaseStatus := "invalidated"
	var submissionID any
	if outcome == OutcomeSubmitted {
		releaseStatus = "ready_to_release"
		if value, ok := score["totalScore"].(float64); ok {
			total = int64(value)
		}
		var projectionObject map[string]any
		_ = json.Unmarshal(projection, &projectionObject)
		if value, ok := projectionObject["submissionId"].(string); ok && value != "" {
			submissionID = value
		}
	}
	_, err = q.ExecContext(ctx, "INSERT INTO assessment_results (id, attempt_id, submission_id, provider_key, outcome_status, total_score, score_payload, release_status) VALUES (?, ?, ?, 'act', ?, ?, ?, ?)", uuid.NewString(), attemptID, submissionID, want, total, string(payloadJSON), releaseStatus)
	return err
}

// StragglerRow is one terminal-without-receipt attempt awaiting repair.
type StragglerRow struct {
	AttemptID      string
	ScheduleID     string
	OrganizationID *string
	ExamID         string
	AnswerRevision int64
	SubmittedAt    time.Time
	ProctorStatus  string
}

// stragglerSweepSQL is the missing-receipt repair predicate:
// submitted_at IS NOT NULL AND NOT EXISTS receipt. NEVER delivery_status
// alone — provisional rows are submitted/post-exam/NULL/NULL and must be
// repaired, not skipped.
const stragglerSweepSQL = "SELECT a.id, a.schedule_id, a.organization_id, a.exam_id, a.answer_revision, a.submitted_at, COALESCE(a.proctor_status,'active') FROM student_attempts a WHERE a.submitted_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM attempt_terminalizations t WHERE t.attempt_id = a.id) ORDER BY a.updated_at ASC, a.id ASC LIMIT ? FOR UPDATE"

// RepairMissingReceipts sweeps terminal-without-receipt stragglers and
// manufactures legacy_unknown receipts (outcome derived from proctor_status),
// logging a WARN per repair. Races with the DB trigger resolve via the
// receipt PK (duplicate INSERT = already repaired, skipped).
func RepairMissingReceipts(ctx context.Context, db tx.DB, batchSize int) (int64, error) {
	if batchSize < 1 {
		batchSize = 1
	}
	sqlTx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead})
	if err != nil {
		return 0, err
	}
	defer func() { _ = sqlTx.Rollback() }()
	if _, err := sqlTx.ExecContext(ctx, "SET time_zone = '+00:00'"); err != nil {
		return 0, err
	}
	rows, err := sqlTx.QueryContext(ctx, stragglerSweepSQL, batchSize)
	if err != nil {
		return 0, err
	}
	var stragglers []StragglerRow
	var failures []string
	func() {
		defer rows.Close()
		for rows.Next() {
			var st StragglerRow
			var org sql.NullString
			var submittedAny any
			if err := rows.Scan(&st.AttemptID, &st.ScheduleID, &org, &st.ExamID, &st.AnswerRevision, &submittedAny, &st.ProctorStatus); err != nil {
				log.Printf("WARN missing-receipt repair scan failed err=%v", err)
				failures = append(failures, fmt.Sprintf("scan: %v", err))
				continue
			}
			if org.Valid {
				v := org.String
				st.OrganizationID = &v
			}
			if t, ok := asTime(submittedAny); ok {
				st.SubmittedAt = t
			}
			stragglers = append(stragglers, st)
		}
	}()
	if err := rows.Err(); err != nil {
		return 0, err
	}
	var repaired int64
	for _, st := range stragglers {
		outcome := OutcomeSubmitted
		if st.ProctorStatus == "terminated" {
			outcome = OutcomeTerminated
		}
		var snap []byte
		snapRow := sqlTx.QueryRowContext(ctx, "SELECT JSON_OBJECT('attemptId', id, 'scheduleId', schedule_id, 'organizationId', organization_id, 'examId', exam_id, 'publishedVersionId', published_version_id, 'providerKey', 'legacy', 'answerRevision', answer_revision, 'answers', answers, 'writingAnswers', writing_answers, 'flags', flags) FROM student_attempts WHERE id = ? FOR UPDATE", st.AttemptID)
		if err := snapRow.Scan(&snap); err != nil {
			log.Printf("WARN missing-receipt repair snapshot failed attempt_id=%s err=%v", st.AttemptID, err)
			failures = append(failures, fmt.Sprintf("snapshot %s: %v", st.AttemptID, err))
			continue
		}
		tid := uuid.NewString()
		var effArg any
		if !st.SubmittedAt.IsZero() {
			effArg = st.SubmittedAt
		}
		_, err = sqlTx.ExecContext(ctx, "INSERT INTO attempt_terminalizations (attempt_id, organization_id, terminalization_id, schedule_id, outcome, reason, actor_kind, actor_id, effective_at, recorded_at, answer_revision, final_snapshot, request_id) VALUES (?, ?, ?, ?, ?, 'legacy_unknown', 'system', NULL, COALESCE(?, UTC_TIMESTAMP(6)), UTC_TIMESTAMP(6), ?, ?, ?)", st.AttemptID, st.OrganizationID, tid, st.ScheduleID, outcome, effArg, st.AnswerRevision, string(snap), uuid.NewString())
		if err != nil {
			if isDupKeyErr(err) {
				continue
			}
			log.Printf("WARN missing-receipt repair insert failed attempt_id=%s err=%v", st.AttemptID, err)
			failures = append(failures, fmt.Sprintf("insert %s: %v", st.AttemptID, err))
			continue
		}
		log.Printf("WARN missing-receipt repair manufactured legacy_unknown receipt attempt_id=%s terminalization_id=%s outcome=%s", st.AttemptID, tid, outcome)
		repaired++
	}
	if err := sqlTx.Commit(); err != nil {
		return 0, err
	}
	// Telemetry stays outside the tx: one increment per repaired receipt.
	for i := int64(0); i < repaired; i++ {
		telemetry.IncCounter(telemetry.MRepairMissing)
	}
	if len(failures) > 0 {
		return repaired, fmt.Errorf("missing-receipt repair completed with %d failures: %s", len(failures), failures[0])
	}
	return repaired, nil
}

// satGapSweepSQL is the SAT gap repair predicate: phase post-exam AND provider
// sat AND receipt exists AND result missing.
const satGapSweepSQL = "SELECT a.id FROM student_attempts a JOIN exam_entities e ON e.id = a.exam_id JOIN attempt_terminalizations t ON t.attempt_id = a.id LEFT JOIN assessment_results ar ON ar.attempt_id = a.id AND ar.provider_key = 'sat' WHERE a.phase = 'post-exam' AND e.provider_key = 'sat' AND ar.id IS NULL ORDER BY a.updated_at ASC, a.id ASC LIMIT ? FOR UPDATE"

// RepairSATResults materializes missing SAT invalidated/pending results for
// terminalized SAT attempts that lost the step-11 write.
func RepairSATResults(ctx context.Context, db tx.DB, batchSize int) (int64, error) {
	if batchSize < 1 {
		batchSize = 1
	}
	svc := NewService(tx.NewRunner(db), SQLTerminalizationRepository{}, SQLOutboxEnqueuer{})
	var repaired int64
	err := svc.tx.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		rows, err := q.QueryContext(ctx, satGapSweepSQL, batchSize)
		if err != nil {
			return err
		}
		var ids []string
		func() {
			defer rows.Close()
			for rows.Next() {
				var id string
				if err := rows.Scan(&id); err != nil {
					continue
				}
				ids = append(ids, id)
			}
		}()
		if err := rows.Err(); err != nil {
			return err
		}
		for _, id := range ids {
			receipt, err := svc.repo.FindByAttemptID(ctx, q, id)
			if err != nil || receipt == nil {
				continue
			}
			if err := svc.materializeSATResult(ctx, q, id, "sat", receipt.Outcome, receipt.Reason, receipt.ActorKind, receipt.TerminalizationID, receipt.EffectiveAt, receipt.FinalSnapshot); err != nil {
				return err
			}
			repaired++
		}
		return nil
	})
	return repaired, err
}

// asTime coerces driver time representations (time.Time, or TEXT when the DSN
// lacks parseTime) to UTC. It reports false for NULL/unparseable values.
func asTime(v any) (time.Time, bool) {
	switch t := v.(type) {
	case nil:
		return time.Time{}, false
	case time.Time:
		return t.UTC(), true
	case []byte:
		return parseDBTime(string(t))
	case string:
		return parseDBTime(t)
	default:
		return time.Time{}, false
	}
}

func parseDBTime(s string) (time.Time, bool) {
	s = strings.TrimSpace(s)
	if s == "" {
		return time.Time{}, false
	}
	for _, layout := range []string{"2006-01-02 15:04:05.999999", "2006-01-02 15:04:05", time.RFC3339Nano, time.RFC3339, "2006-01-02T15:04:05.999999"} {
		if t, err := time.ParseInLocation(layout, s, time.UTC); err == nil {
			return t.UTC(), true
		}
	}
	return time.Time{}, false
}

// asBool coerces driver boolean representations (bool/int/TEXT) to bool.
func asBool(v any) bool {
	switch t := v.(type) {
	case nil:
		return false
	case bool:
		return t
	case int64:
		return t != 0
	case int32:
		return t != 0
	case int:
		return t != 0
	case []byte:
		s := strings.TrimSpace(string(t))
		return s == "1" || strings.EqualFold(s, "true")
	case string:
		s := strings.TrimSpace(t)
		return s == "1" || strings.EqualFold(s, "true")
	default:
		return false
	}
}
