// Service implements the V2 write algorithm: lock attempt, validate identity
// and session, exact-replay fast path, epoch fencing, runtime gate with
// server-authoritative timing, per-command idempotency/version rules,
// immutable mutation ledger, response projection, revision bump.
// Global lock order: attempt -> runtime -> active section (plan 20).
package attempts

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"time"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/clock"
	"example.com/ielts-proctoring/internal/platform/crypto"
	"example.com/ielts-proctoring/internal/platform/telemetry"
	"example.com/ielts-proctoring/internal/platform/tx"
	"github.com/google/uuid"
)

// ClosingGrace is the 30s post-deadline acceptance window (plan 26).
const ClosingGrace = 30 * time.Second

// SATSaveGrace is a save-only window after the visible clock reaches zero.
// The delivery reconciler waits for the same window before scoring a module.
// offcut: the server bounds arrival time; it cannot prove when an offline browser edit was typed.
const SATSaveGrace = 3 * time.Second

// Service owns response mutation (plan 4.1).
type Service struct {
	tx     *tx.Runner
	clock  clock.Clock
	secret []byte
	// rowFirst selects the plan-B3 rows-only write path (no blob
	// SELECT/UPDATE per answer). Off keeps mergeProjection. Wired via
	// SetRowFirst (BuildApp from ROW_FIRST_WRITES); tests set directly.
	rowFirst bool
	// bulkMin overrides bulkWriteThreshold (tests only; zero = the constant).
	bulkMin int
}

// SetRowFirst selects the B3 row-first write path. Chainable.
func (s *Service) SetRowFirst(on bool) *Service {
	s.rowFirst = on
	return s
}

// SetBulkThresholdForTest forces the batch I/O threshold so a test can drive
// the same batch through both strategies. Tests only: production uses
// bulkWriteThreshold.
func (s *Service) SetBulkThresholdForTest(n int) *Service {
	s.bulkMin = n
	return s
}

// RowFirst reports the write-path posture (tests + observability).
func (s *Service) RowFirst() bool { return s != nil && s.rowFirst }

func NewService(runner *tx.Runner, clk clock.Clock, secret []byte) *Service {
	return &Service{tx: runner, clock: clk, secret: secret}
}

// QuestionOwner resolves question -> module/section ownership. Providers plug
// IELTS/SAT/ACT validation behind this port; the core stays neutral (plan 15).
type QuestionOwner struct {
	ModuleID         string
	SectionKey       string
	ModuleState      string // must be active|review for writes
	ModuleDeadlineAt *time.Time
	TimingModel      string
	ModuleStartedAt  *time.Time
	EntryConfirmedAt *time.Time
}

// QuestionResolver maps question IDs to ownership within the attempt.
type QuestionResolver interface {
	Resolve(ctx context.Context, q tx.Tx, attemptID, questionID string) (QuestionOwner, error)
}

// QuestionVerdict is one question's resolution outcome. ResolveMany carries
// errors per question (not per call) so a batch can resolve every question it
// touched in one statement while the write loop still reports each error at the
// command that owns it.
type QuestionVerdict struct {
	Owner QuestionOwner
	Err   error
}

// BulkQuestionResolver is the optional set-based variant of QuestionResolver.
// A resolver that implements it lets a batch resolve all of its questions in
// one statement instead of one question->module query (plus, for legacy
// snapshot exams, one content-snapshot load) per answer. Resolvers that do not
// implement it keep the per-question contract.
type BulkQuestionResolver interface {
	ResolveMany(ctx context.Context, q tx.Tx, attemptID string, questionIDs []string) (map[string]QuestionVerdict, error)
}

// RuntimeGate is the runtime projection used for writability. Every field is
// read on the caller's transaction — the transaction that commits the write —
// either under the runtime/section row locks (v2Locker) or lock-free
// (snapshotLocker). A cached or otherwise stale view must never populate this
// struct: it authorizes writes, so its source has to be as current as the write
// itself. ensureWritable consumes every liveness field below, so none of them
// can silently go unenforced.
type RuntimeGate struct {
	Status                string
	TimingModel           string
	WaitingForNextSection bool
	ActiveSectionKey      string
	SectionLive           bool
	SectionPaused         bool
	SectionStarted        bool
	Now                   time.Time // authoritative DB time
}

// RuntimeLocker locks runtime + active section after the attempt.
type RuntimeLocker interface {
	Lock(ctx context.Context, q tx.Tx, scheduleID string) (RuntimeGate, error)
}

// SaveResponses implements the canonical V2 write algorithm (plan 20).
func (s *Service) SaveResponses(ctx context.Context, bearer string, cmd SaveResponsesCommand, qr QuestionResolver, rl RuntimeLocker) (SaveResult, error) {
	if err := ValidateSaveEnvelope(cmd); err != nil {
		return SaveResult{}, err
	}
	claims, err := crypto.VerifyAttemptToken(s.secret, s.clock.Now(), bearer)
	if err != nil {
		return SaveResult{}, &apperrors.Error{Code: apperrors.CodeAttemptTokenInvalid, Message: "Invalid attempt credential.", HTTPStatus: 401}
	}
	if claims.AttemptID != cmd.AttemptID {
		return SaveResult{}, &apperrors.Error{Code: apperrors.CodeAttemptTokenInvalid, Message: "Attempt credential mismatch.", HTTPStatus: 401}
	}
	if cmd.BearerTokenID != "" && cmd.BearerTokenID != claims.TokenID {
		return SaveResult{}, &apperrors.Error{Code: apperrors.CodeAttemptTokenInvalid, Message: "Attempt credential mismatch.", HTTPStatus: 401}
	}
	var out SaveResult
	// B1: hot write path runs READ COMMITTED (point gets + explicit FOR
	// UPDATE; no snapshot dependency). Seal stays RR.
	// E3: bounded RC retry (3) absorbs transient InnoDB deadlocks/lock-waits
	// under the 500-way wave. Idempotency-safe: write_id UNIQUE +
	// exact-replay turn the retried attempt into a replay, not a duplicate.
	// The absorbed count labels retried_accepted (E3 observability).
	retried, rerr := s.tx.WithTxRCRetryCounted(ctx, 3, func(ctx context.Context, q tx.Tx) error {
		res, err := s.saveInTx(ctx, q, claims, cmd, qr, rl)
		if err != nil {
			return err
		}
		out = res
		return nil
	})
	err = rerr
	// Telemetry records the commit decision outside the tx (plan 69):
	// success emits accepted / retried_accepted (or exact_replay on the
	// fast path), fencing and validation failures map to the outcome
	// vocabulary.
	if err != nil {
		outcome := v2BatchOutcome(err)
		telemetry.IncCounter(telemetry.MV2BatchTotal, "outcome", outcome)
		for range cmd.Commands {
			telemetry.IncCounter(telemetry.MV2CommandsTotal, "outcome", outcome)
		}
		return out, err
	}
	outcome := successOutcome(out.Replayed, retried)
	telemetry.IncCounter(telemetry.MV2BatchTotal, "outcome", outcome)
	for range cmd.Commands {
		telemetry.IncCounter(telemetry.MV2CommandsTotal, "outcome", outcome)
	}
	return out, nil
}

// successOutcome labels a committed batch (plan E3): exact_replay wins over
// retry count (a replay is a replay); otherwise >=1 absorbed transient
// (deadlock/lock-wait counted on db_deadlocks_total{kind}) labels
// retried_accepted so contended waves stay distinguishable from clean ones.
// retries counts absorbed transients observed during this call.
func successOutcome(replayed bool, retries int) string {
	if replayed {
		return telemetry.OutcomeExactReplay
	}
	if retries > 0 {
		return telemetry.OutcomeRetriedAccepted
	}
	return telemetry.OutcomeAccepted
}

// v2BatchOutcome maps a save error to the plan 69 outcome label vocabulary.
func v2BatchOutcome(err error) string {
	if e, ok := apperrors.As(err); ok {
		switch e.Code {
		case apperrors.CodeLeaseFenced:
			return telemetry.OutcomeLeaseFenced
		case apperrors.CodeControlEpochStale:
			return telemetry.OutcomeControlStale
		case apperrors.CodeVersionCollision, apperrors.CodeResponseRevisionMismatch:
			return telemetry.OutcomeVersionConflict
		case apperrors.CodeWriteIDConflict:
			return telemetry.OutcomeWriteConflict
		case apperrors.CodeAttemptNotWritable, apperrors.CodeDeadlineExpired, apperrors.CodeAttemptProctorBlocked:
			return telemetry.OutcomeNotWritable
		}
	}
	return telemetry.OutcomeRejected
}

func (s *Service) saveInTx(ctx context.Context, q tx.Tx, claims crypto.AttemptClaims, cmd SaveResponsesCommand, qr QuestionResolver, rl RuntimeLocker) (SaveResult, error) {
	attempt, err := lockAttempt(ctx, q, cmd.AttemptID)
	if err != nil {
		return SaveResult{}, err
	}
	if attempt.ProtocolVersion != 2 {
		return SaveResult{}, apperrors.New(apperrors.CodeConflict, "Protocol version unsupported.")
	}
	if claims.ScheduleID != attempt.ScheduleID || claims.UserID != attempt.UserID {
		return SaveResult{}, &apperrors.Error{Code: apperrors.CodeAttemptTokenInvalid, Message: "Attempt credential mismatch.", HTTPStatus: 401}
	}
	if claims.OrganizationID != "" && attempt.OrganizationID != "" && claims.OrganizationID != attempt.OrganizationID {
		return SaveResult{}, &apperrors.Error{Code: apperrors.CodeAttemptTokenInvalid, Message: "Attempt credential mismatch.", HTTPStatus: 401}
	}
	if err := s.validateTokenSession(ctx, q, claims); err != nil {
		return SaveResult{}, err
	}
	// Exact-replay fast path: authorized at current lease, skips epoch
	// equality + runtime gate; never mutates twice (plan 21).
	io := s.ioFor(ctx, q, cmd, attempt, qr)
	if len(cmd.Commands) > 0 {
		replay, acks, rev, err := exactReplay(ctx, q, io, cmd)
		if err != nil {
			return SaveResult{}, err
		}
		if replay {
			if err := validateClaimLease(attempt, claims); err != nil {
				return SaveResult{}, err
			}
			if attempt.ProviderKey == string(ProviderSAT) && attempt.DeadlineAt != nil && !s.clock.Now().Before(*attempt.DeadlineAt) {
				telemetry.IncCounter(telemetry.MSATResponseReplayAfterTerminal)
			}
			return SaveResult{Acks: acks, ResponseRevision: rev, ServerTime: s.clock.Now(), Replayed: true}, nil
		}
	}
	// Fencing (plan 22-25).
	if cmd.LeaseEpoch != attempt.LeaseEpoch {
		return SaveResult{}, leaseFenced()
	}
	if cmd.ControlEpoch != attempt.ControlEpoch {
		return SaveResult{}, controlStale(cmd.ControlEpoch, attempt.ControlEpoch)
	}
	if err := ensureActiveSession(ctx, q, attempt, claims); err != nil {
		return SaveResult{}, err
	}
	// Runtime gate (non-replay only) with server-authoritative time.
	var gate RuntimeGate
	if rl != nil {
		g, err := rl.Lock(ctx, q, attempt.ScheduleID)
		if err != nil {
			return SaveResult{}, err
		}
		gate = g
	} else {
		now, err := dbTime(ctx, q)
		if err != nil {
			return SaveResult{}, err
		}
		gate = RuntimeGate{Status: "live", ActiveSectionKey: "*", SectionLive: true, SectionStarted: true, Now: now}
	}
	now := gate.Now
	if now.IsZero() {
		now, err = dbTime(ctx, q)
		if err != nil {
			return SaveResult{}, err
		}
	}
	if len(cmd.Commands) == 0 {
		if err := ensureWritable(attempt, gate, now); err != nil {
			return SaveResult{}, err
		}
		return SaveResult{ResponseRevision: attempt.ResponseRevision, ServerTime: now}, nil
	}
	acks := make([]Ack, 0, len(cmd.Commands))
	revision := attempt.ResponseRevision
	changed := 0
	for _, c := range cmd.Commands {
		reqHash, err := commandHash(c)
		if err != nil {
			return SaveResult{}, err
		}
		// Idempotency probe.
		stored, err := io.ledgerByWrite(c.WriteID)
		if err != nil {
			return SaveResult{}, err
		}
		if stored != nil {
			if stored.RequestHash != reqHash {
				return SaveResult{}, &apperrors.Error{Code: apperrors.CodeWriteIDConflict, Message: fmt.Sprintf("Write %q was already used with different content.", c.WriteID), HTTPStatus: 409, Details: map[string]any{"writeId": c.WriteID}}
			}
			canonical, err := decodeResponsePayload(stored.CanonicalRaw)
			if err != nil {
				return SaveResult{}, err
			}
			acks = append(acks, Ack{
				WriteID: c.WriteID, QuestionID: c.QuestionID, ClientVersion: c.ClientVersion,
				Outcome: "duplicate", ServerRevision: stored.ServerRevision, Replayed: true,
				CanonicalResponse: canonical, ContentHash: stored.ResponseHash,
			})
			continue
		}
		// New write: writability applies only to new write IDs so exact
		// duplicates stay replayable post-terminal (per spec).
		if err := ensureWritable(attempt, gate, now); err != nil {
			return SaveResult{}, err
		}
		owner, err := io.owner(c.QuestionID)
		if err != nil {
			return SaveResult{}, err
		}
		if err := ensureQuestionAdmittedForProvider(owner, gate, c.QuestionID, attempt.ProviderKey); err != nil {
			return SaveResult{}, err
		}
		// Version-collision probe.
		colliding, err := io.ledgerByVersion(cmd.LeaseEpoch, c.QuestionID, c.ClientVersion)
		if err != nil {
			return SaveResult{}, err
		}
		if colliding != nil {
			return SaveResult{}, &apperrors.Error{Code: apperrors.CodeVersionCollision, Message: "Client version already used by another write.", HTTPStatus: 409, Details: map[string]any{"questionId": c.QuestionID, "clientVersion": c.ClientVersion, "existingWriteId": colliding.WriteID}}
		}
		respHash, err := HashResponse(payloadToAny(c.Response))
		if err != nil {
			return SaveResult{}, err
		}
		// Projection with per-question monotonic rule (plan 22).
		cur, err := io.projection(c.QuestionID)
		if err != nil {
			return SaveResult{}, err
		}
		newer := true
		if cur != nil && cur.LeaseEpoch != nil && cur.ClientVersion != nil {
			newer = cmd.LeaseEpoch > *cur.LeaseEpoch || (cmd.LeaseEpoch == *cur.LeaseEpoch && c.ClientVersion > *cur.ClientVersion)
		}
		outcome := "applied"
		serverRev := revision + 1
		ackCanonical := c.Response
		ackHash := respHash
		if !newer {
			outcome = "superseded"
			if cur.ServerRevision != nil {
				serverRev = *cur.ServerRevision
			}
			current, err := io.projectionContent(c.QuestionID)
			if err != nil {
				return SaveResult{}, err
			}
			ackCanonical, err = decodeResponsePayload(current.CanonicalRaw)
			if err != nil {
				return SaveResult{}, err
			}
			ackHash = current.ResponseHash
		} else {
			revision++
			serverRev = revision
			changed++
			if revision == 0 {
				return SaveResult{}, &apperrors.Error{Code: apperrors.CodeBadRequest, Message: "Response revision overflow.", HTTPStatus: 400}
			}
			canonical, err := CanonicalJSON(payloadToAny(c.Response))
			if err != nil {
				return SaveResult{}, err
			}
			// B3: row-first persists only the answer cell row (no blob
			// SELECT/UPDATE); legacy keeps the blob merge. Both share the
			// same canonical bytes + idempotency/version fencing above, and
			// the I/O strategy only decides WHEN those statements are
			// issued (per command, or once for the whole batch).
			writing := strings.Contains(strings.ToLower(owner.ModuleID), "writing")
			if err := io.applyProjection(projectionWrite{
				AttemptID: cmd.AttemptID, QuestionID: c.QuestionID, ModuleID: owner.ModuleID,
				LeaseEpoch: cmd.LeaseEpoch, ControlEpoch: cmd.ControlEpoch, ClientVersion: c.ClientVersion,
				WriteID: c.WriteID, RequestHash: reqHash, ResponseHash: respHash, ServerRevision: serverRev,
				Canonical: canonical, Payload: c.Response, Writing: writing, Now: now,
			}); err != nil {
				return SaveResult{}, err
			}
			if isPersonalTimingModel(owner.TimingModel) {
				if _, err := q.ExecContext(ctx, `
					UPDATE assessment_module_attempts
					SET entry_entered_at = COALESCE(entry_entered_at, UTC_TIMESTAMP(6)), revision = revision + 1
					WHERE attempt_id = ? AND module_id = ? AND state IN ('active', 'review')
					  AND entry_confirmed_at IS NOT NULL AND entry_entered_at IS NULL
					  AND started_at <= UTC_TIMESTAMP(6)`,
					cmd.AttemptID, owner.ModuleID); err != nil {
					return SaveResult{}, err
				}
			}
		}
		canonical, err := CanonicalJSON(commandToAny(cmd.LeaseEpoch, c))
		_ = canonical
		if err != nil {
			return SaveResult{}, err
		}
		payloadCanon, err := CanonicalJSON(payloadToAny(ackCanonical))
		if err != nil {
			return SaveResult{}, err
		}
		if err := io.insertLedger(ledgerWrite{
			AttemptID: cmd.AttemptID, WriteID: c.WriteID, LeaseEpoch: cmd.LeaseEpoch, ControlEpoch: cmd.ControlEpoch,
			QuestionID: c.QuestionID, ClientVersion: c.ClientVersion, RequestHash: reqHash,
			ResponseHash: ackHash, Outcome: outcome, ServerRevision: serverRev,
			CanonicalPayload: string(payloadCanon), Now: now,
		}); err != nil {
			return SaveResult{}, err
		}
		acks = append(acks, Ack{
			WriteID: c.WriteID, QuestionID: c.QuestionID, ClientVersion: c.ClientVersion,
			Outcome: outcome, ServerRevision: serverRev, CanonicalResponse: ackCanonical, ContentHash: ackHash,
		})
	}
	// The set-based strategy emits its deferred writes here, in the same
	// order the per-command strategy writes them: projection, then ledger.
	if err := io.flush(); err != nil {
		return SaveResult{}, err
	}
	if changed > 0 {
		if _, err := q.ExecContext(ctx, `UPDATE student_attempts SET response_revision=?, answer_revision=answer_revision+?, revision=revision+1 WHERE id=?`, revision, changed, cmd.AttemptID); err != nil {
			return SaveResult{}, err
		}
	}
	auditPayload, err := json.Marshal(map[string]any{
		"requestedCount":   len(cmd.Commands),
		"appliedCount":     changed,
		"responseRevision": revision,
		"controlEpoch":     cmd.ControlEpoch,
		"leaseEpoch":       cmd.LeaseEpoch,
	})
	if err != nil {
		return SaveResult{}, err
	}
	if _, err := q.ExecContext(ctx, `
		INSERT INTO session_audit_logs (id, schedule_id, actor, action_type, target_student_id, payload, created_at)
		VALUES (?, ?, ?, 'STUDENT_MUTATION_BATCH', ?, ?, ?)`,
		uuid.NewString(), attempt.ScheduleID, claims.UserID, attempt.ID, string(auditPayload), now); err != nil {
		return SaveResult{}, err
	}
	return SaveResult{Acks: acks, ResponseRevision: revision, ServerTime: now}, nil
}

func lockAttempt(ctx context.Context, q tx.Tx, id string) (AttemptState, error) {
	var a AttemptState
	var deadline, grace, submitted sql.NullTime
	var finalSub, providerKey, timingModel sql.NullString
	// Round 166: fresh entry-minted attempts carry NULL organization_id
	// (game-day: 5 submit-path 500s `converting NULL to string`). Scan
	// nullable and default to "" so NULL orgs submit cleanly.
	var org sql.NullString
	err := q.QueryRowContext(ctx, `SELECT id, schedule_id, user_id, organization_id, protocol_version, delivery_status, phase, lease_epoch, control_epoch, response_revision, deadline_at, closing_grace_until, submitted_at, final_submission, proctor_status, COALESCE((SELECT provider_key FROM exam_entities WHERE id = student_attempts.exam_id), ''), COALESCE((SELECT timing_model FROM exam_session_runtimes WHERE schedule_id = student_attempts.schedule_id), '') FROM student_attempts WHERE id=? FOR UPDATE`, id).Scan(&a.ID, &a.ScheduleID, &a.UserID, &org, &a.ProtocolVersion, &a.DeliveryStatus, &a.Phase, &a.LeaseEpoch, &a.ControlEpoch, &a.ResponseRevision, &deadline, &grace, &submitted, &finalSub, &a.ProctorStatus, &providerKey, &timingModel)
	if org.Valid {
		a.OrganizationID = org.String
	}
	if err == sql.ErrNoRows {
		return a, &apperrors.Error{Code: apperrors.CodeNotFound, Message: "Attempt not found.", HTTPStatus: 404}
	}
	if err != nil {
		return a, err
	}
	if deadline.Valid {
		t := deadline.Time.UTC()
		a.DeadlineAt = &t
	}
	if grace.Valid {
		t := grace.Time.UTC()
		a.ClosingGraceUntil = &t
	}
	if submitted.Valid {
		t := submitted.Time.UTC()
		a.SubmittedAt = &t
	}
	if finalSub.Valid {
		s := finalSub.String
		a.FinalSubmission = &s
	}
	if providerKey.Valid {
		a.ProviderKey = providerKey.String
	}
	if timingModel.Valid {
		a.TimingModel = timingModel.String
	}
	return a, nil
}

func (s *Service) validateTokenSession(ctx context.Context, q tx.Tx, claims crypto.AttemptClaims) error {
	if strings.TrimSpace(claims.TokenID) == "" {
		log.Printf("attempts: session fence rejected empty token id (attempt %s)", claims.AttemptID)
		return &apperrors.Error{Code: apperrors.CodeUnauthorized, Message: "Attempt credential session is not recognized.", HTTPStatus: 401}
	}
	var revoked sql.NullTime
	var expires sql.NullTime
	var attemptID, sessionID string
	err := q.QueryRowContext(ctx, `SELECT attempt_id, client_session_id, revoked_at, expires_at FROM attempt_sessions WHERE token_id=? AND revoked_at IS NULL FOR UPDATE`, claims.TokenID).Scan(&attemptID, &sessionID, &revoked, &expires)
	if err == sql.ErrNoRows {
		log.Printf("attempts: session fence rejected unknown-or-revoked token (attempt %s)", claims.AttemptID)
		return &apperrors.Error{Code: apperrors.CodeUnauthorized, Message: "Attempt credential session is not recognized.", HTTPStatus: 401}
	}
	if err != nil {
		return err
	}
	if revoked.Valid || (expires.Valid && expires.Time.Before(s.clock.Now())) {
		log.Printf("attempts: session fence rejected expired token (attempt %s)", claims.AttemptID)
		return &apperrors.Error{Code: apperrors.CodeUnauthorized, Message: "Attempt credential is revoked or expired.", HTTPStatus: 401}
	}
	if attemptID != claims.AttemptID || sessionID != claims.ClientSessionID {
		return &apperrors.Error{Code: apperrors.CodeUnauthorized, Message: "Attempt credential binding mismatch.", HTTPStatus: 401}
	}
	return nil
}

func validateClaimLease(a AttemptState, claims crypto.AttemptClaims) error {
	if claims.LeaseEpoch == nil || *claims.LeaseEpoch != a.LeaseEpoch {
		return leaseFenced()
	}
	return nil
}

func ensureActiveSession(ctx context.Context, q tx.Tx, a AttemptState, claims crypto.AttemptClaims) error {
	// First-writer-wins claim is enforced by a conditional UPDATE elsewhere;
	// here we fence mismatched active sessions.
	var active sql.NullString
	if err := q.QueryRowContext(ctx, `SELECT active_client_session_id FROM student_attempts WHERE id=?`, a.ID).Scan(&active); err != nil {
		return err
	}
	if active.Valid && active.String != "" && active.String != claims.ClientSessionID {
		return leaseFenced()
	}
	return nil
}

// exactReplay returns stored acks when every write ID matches stored hash.
// ioFor picks the batch's I/O strategy (batch_io.go). Both drive the same
// validation loop; only the number of round trips under the attempt lock
// differs. bulkMin overrides the threshold in tests that need to force a
// strategy (it is not a deployment option: the value is the package constant).
func (s *Service) ioFor(ctx context.Context, q tx.Tx, cmd SaveResponsesCommand, attempt AttemptState, qr QuestionResolver) saveIO {
	threshold := bulkWriteThreshold
	if s.bulkMin > 0 {
		threshold = s.bulkMin
	}
	if len(cmd.Commands) > threshold {
		return &batchIO{
			ctx: ctx, q: q, attemptID: cmd.AttemptID, lease: cmd.LeaseEpoch,
			rowFirst: s.rowFirst, qr: qr, commands: cmd.Commands,
		}
	}
	return perCommandIO{ctx: ctx, q: q, attemptID: cmd.AttemptID, rowFirst: s.rowFirst, qr: qr}
}

// exactReplay is the plan-21 fast path: when EVERY command of the batch is
// already in the ledger with matching content, the batch returns the stored
// acks and mutates nothing. It short-circuits at the first unseen write id
// (today's semantics: a partial replay falls through to the normal loop, which
// re-classifies each command), and a stored row with different content fails
// the batch here — before the epoch fences. The I/O strategy only changes
// whether those probes are one statement or N.
func exactReplay(ctx context.Context, q tx.Tx, io saveIO, cmd SaveResponsesCommand) (bool, []Ack, uint64, error) {
	acks := make([]Ack, 0, len(cmd.Commands))
	for _, c := range cmd.Commands {
		reqHash, err := commandHash(c)
		if err != nil {
			return false, nil, 0, err
		}
		stored, err := io.ledgerByWrite(c.WriteID)
		if err != nil {
			return false, nil, 0, err
		}
		if stored == nil {
			return false, nil, 0, nil
		}
		if stored.RequestHash != reqHash {
			return false, nil, 0, &apperrors.Error{Code: apperrors.CodeWriteIDConflict, Message: fmt.Sprintf("Write %q was already used with different content.", c.WriteID), HTTPStatus: 409, Details: map[string]any{"writeId": c.WriteID}}
		}
		canonical, err := decodeResponsePayload(stored.CanonicalRaw)
		if err != nil {
			return false, nil, 0, err
		}
		acks = append(acks, Ack{
			WriteID: c.WriteID, QuestionID: c.QuestionID, ClientVersion: c.ClientVersion,
			Outcome: "duplicate", ServerRevision: stored.ServerRevision, Replayed: true,
			CanonicalResponse: canonical, ContentHash: stored.ResponseHash,
		})
	}
	var rev uint64
	if err := q.QueryRowContext(ctx, `SELECT response_revision FROM student_attempts WHERE id=?`, cmd.AttemptID).Scan(&rev); err != nil {
		return false, nil, 0, err
	}
	return true, acks, rev, nil
}

// ensureWritable enforces terminal/pause/deadline/grace/proctor gates.
func ensureWritable(a AttemptState, gate RuntimeGate, now time.Time) error {
	// Either the runtime gate or the locked attempt row may carry the model
	// (the attempt row is the durable one: a schedule whose runtime row is
	// missing mid-transition must still read as personal).
	personalSAT := isPersonalTimingModel(gate.TimingModel) || isPersonalTimingModel(a.TimingModel)
	// The student clock freezes at the SAT deadline. The runtime waits for the
	// short save window before advancing, while other providers retain their
	// existing closing grace.
	closingGraceActive := a.ClosingGraceUntil != nil && !now.After(*a.ClosingGraceUntil)
	satClosing := !personalSAT && a.ProviderKey == string(ProviderSAT) && a.DeadlineAt != nil &&
		!now.Before(*a.DeadlineAt) && now.Before(a.DeadlineAt.Add(SATSaveGrace)) && closingGraceActive
	switch a.DeliveryStatus {
	case "submitted", "terminated", "locked", "cancelled":
		if a.ProviderKey == string(ProviderSAT) {
			telemetry.IncCounter(telemetry.MSATResponseWriteAfterTerminal)
		}
		return &apperrors.Error{Code: apperrors.CodeAttemptNotWritable, Message: "Attempt is closed.", HTTPStatus: 422}
	}
	if a.DeliveryStatus == "paused" || a.Phase == "post-exam" || a.SubmittedAt != nil {
		return &apperrors.Error{Code: apperrors.CodeAttemptNotWritable, Message: "Attempt is not writable.", HTTPStatus: 422}
	}
	if a.ProctorStatus == "terminated" || a.ProctorStatus == "paused" {
		return &apperrors.Error{Code: apperrors.CodeAttemptProctorBlocked, Message: "Attempt is blocked by proctor state.", HTTPStatus: 403}
	}
	if gate.Status != "" && gate.Status != "live" && !(satClosing && gate.Status == "completed") {
		return &apperrors.Error{Code: apperrors.CodeAttemptNotWritable, Message: "Exam runtime is not live.", HTTPStatus: 422}
	}
	// SAT may drain already-visible responses briefly after the display clock
	// ends. The module gate below applies the same cap to shorter module clocks.
	if !personalSAT && a.ProviderKey == string(ProviderSAT) && a.DeadlineAt != nil && !now.Before(*a.DeadlineAt) && !satClosing {
		telemetry.IncCounter(telemetry.MSATResponseWriteAfterTerminal)
		return &apperrors.Error{Code: apperrors.CodeDeadlineExpired, Message: "Response deadline has passed.", HTTPStatus: 422}
	}
	if !personalSAT && gate.WaitingForNextSection && !closingGraceActive && !satClosing {
		return &apperrors.Error{Code: apperrors.CodeAttemptNotWritable, Message: "Exam runtime is waiting.", HTTPStatus: 422}
	}
	// Section liveness (audit finding 3). These flags used to be computed by both
	// lockers and read by nobody, so a paused section was enforced only by the
	// snapshot pre-gate (and not at all with RUNTIME_SNAPSHOT off, where the
	// FOR UPDATE path's SectionPaused had no consumer). The rule is enforced here
	// — on the write's own transaction — so both modes reject the same writes.
	if !personalSAT && !gate.SectionStarted && !satClosing {
		return &apperrors.Error{Code: apperrors.CodeAttemptNotWritable, Message: "Exam section has not started.", HTTPStatus: 422}
	}
	if !personalSAT && gate.SectionPaused {
		return &apperrors.Error{Code: apperrors.CodeAttemptNotWritable, Message: "Exam section is paused.", HTTPStatus: 422}
	}
	if !personalSAT && !gate.SectionLive && !closingGraceActive && !satClosing {
		return &apperrors.Error{Code: apperrors.CodeAttemptNotWritable, Message: "Exam section is not live.", HTTPStatus: 422}
	}
	// The attempt-level closing grace rides the cohort section clock. A
	// personal SAT attempt owns its own module/break deadline instead, so the
	// section-derived grace must never cut its answers short (plan 2026-09-24,
	// full-entry-time).
	if !personalSAT && a.ClosingGraceUntil != nil && now.After(*a.ClosingGraceUntil) {
		return &apperrors.Error{Code: apperrors.CodeDeadlineExpired, Message: "Response deadline has passed.", HTTPStatus: 422}
	}
	return nil
}

// ensureQuestionAdmitted enforces module ownership for one write: unassigned
// (normalized question, no module attempt for this attempt) rejects with a
// distinct message so adaptive-branch bypass attempts are distinguishable
// from ordinary inactive-module writes; section mismatch stays BAD_REQUEST.
func ensureQuestionAdmitted(owner QuestionOwner, gate RuntimeGate, questionID string) error {
	return ensureQuestionAdmittedForProvider(owner, gate, questionID, "")
}

func ensureQuestionAdmittedForProvider(owner QuestionOwner, gate RuntimeGate, questionID, provider string) error {
	if owner.ModuleState == "unassigned" {
		return &apperrors.Error{Code: apperrors.CodeAttemptNotWritable, Message: "Question is not in an assigned module for this attempt.", HTTPStatus: 422, Details: map[string]any{"questionId": questionID}}
	}
	if owner.ModuleState != "active" && owner.ModuleState != "review" {
		return &apperrors.Error{Code: apperrors.CodeAttemptNotWritable, Message: "Question module is not active.", HTTPStatus: 422}
	}
	if provider == string(ProviderSAT) && owner.ModuleDeadlineAt == nil {
		return &apperrors.Error{Code: apperrors.CodeAttemptNotWritable, Message: "SAT module deadline is unavailable.", HTTPStatus: 422}
	}
	personalSAT := isPersonalTimingModel(owner.TimingModel)
	if personalSAT && (owner.EntryConfirmedAt == nil || owner.ModuleStartedAt == nil || gate.Now.Before(*owner.ModuleStartedAt)) {
		return &apperrors.Error{Code: apperrors.CodeAttemptNotWritable, Message: "SAT module entry is not confirmed.", HTTPStatus: 422}
	}
	// The attempt deadline covers the shared SAT section clock. Module 1 can
	// have a shorter personal clock, so enforce the effective module boundary
	// here too; otherwise a fresh V2 write could slip in before the timeout
	// worker terminalizes the module.
	satClosing := provider == string(ProviderSAT) && owner.ModuleDeadlineAt != nil &&
		!gate.Now.Before(*owner.ModuleDeadlineAt) && gate.Now.Before(owner.ModuleDeadlineAt.Add(SATSaveGrace))
	if owner.ModuleDeadlineAt != nil && !gate.Now.Before(*owner.ModuleDeadlineAt) && !satClosing {
		telemetry.IncCounter(telemetry.MSATResponseWriteAfterTerminal)
		return &apperrors.Error{Code: apperrors.CodeDeadlineExpired, Message: "Response deadline has passed.", HTTPStatus: 422}
	}
	if !personalSAT && gate.ActiveSectionKey != "*" && gate.ActiveSectionKey != "" && owner.SectionKey != gate.ActiveSectionKey && !satClosing {
		return &apperrors.Error{Code: apperrors.CodeBadRequest, Message: "Question is not in the active section.", HTTPStatus: 400}
	}
	return nil
}

func leaseFenced() *apperrors.Error {
	return &apperrors.Error{Code: apperrors.CodeLeaseFenced, Message: "Writer lease is stale; another device took over.", HTTPStatus: 403}
}

func controlStale(want, got uint64) *apperrors.Error {
	return &apperrors.Error{Code: apperrors.CodeControlEpochStale, Message: "Command crossed a pause/resume control boundary.", HTTPStatus: 409, Details: map[string]any{"requestControlEpoch": want, "currentControlEpoch": got}}
}

func commandHash(c ResponseCommand) (string, error) {
	return HashResponse(commandToAny(0, c))
}

func commandToAny(lease uint64, c ResponseCommand) any {
	m := map[string]any{"writeId": c.WriteID, "questionId": c.QuestionID, "clientVersion": c.ClientVersion, "response": payloadToAny(c.Response)}
	if lease != 0 {
		m["leaseEpoch"] = lease
	}
	return m
}

func payloadToAny(p ResponsePayload) any {
	elim := make([]any, 0, len(p.EliminatedOptions))
	for _, e := range p.EliminatedOptions {
		elim = append(elim, e)
	}
	ann := make([]any, 0, len(p.Annotations))
	for _, a := range p.Annotations {
		m := map[string]any{"id": a.ID, "kind": a.Kind}
		if a.Kind == "sat_annotations" {
			m["version"] = a.Version
			m["legacyQuestionNote"] = a.LegacyQuestionNote
			items := a.Annotations
			if items == nil {
				items = []SATTextAnnotation{}
			}
			// CanonicalJSON accepts JSON values, so convert typed anchors before hashing.
			raw, _ := json.Marshal(items)
			var values any
			_ = json.Unmarshal(raw, &values)
			m["annotations"] = values
		}
		if a.Start != nil {
			m["start"] = *a.Start
		}
		if a.End != nil {
			m["end"] = *a.End
		}
		if a.Text != "" {
			m["text"] = a.Text
		}
		ann = append(ann, m)
	}
	return map[string]any{"answer": p.Answer, "markedForReview": p.MarkedForReview, "eliminatedOptions": elim, "annotations": ann}
}

func decodeResponsePayload(raw string) (ResponsePayload, error) {
	var payload ResponsePayload
	if err := json.Unmarshal([]byte(raw), &payload); err != nil {
		return ResponsePayload{}, err
	}
	if payload.EliminatedOptions == nil {
		payload.EliminatedOptions = []string{}
	}
	if payload.Annotations == nil {
		payload.Annotations = []Annotation{}
	}
	return payload, nil
}

// mergeProjection upserts the row-per-question projection. Full implementation
// merges answers/writing/flags JSON columns; this keeps explicit SQL visible.
// The INSERT names every NOT NULL projection column (module_id, control_epoch,
// client_write_id, request_hash, response) so the write satisfies migration
// 0049 with no migration change; response stores the canonical payload bytes.
func mergeProjection(ctx context.Context, q tx.Tx, attemptID, questionID string, canonical []byte, c ResponseCommand, writing bool, moduleID string, leaseEpoch, controlEpoch uint64, reqHash string, serverRev uint64, respHash string, now time.Time) (string, string, string, error) {
	var answersRaw, writingRaw, flagsRaw sql.NullString
	err := q.QueryRowContext(ctx, `SELECT answers, writing_answers, flags FROM student_attempts WHERE id=? FOR UPDATE`, attemptID).Scan(&answersRaw, &writingRaw, &flagsRaw)
	if err != nil {
		return "", "", "", err
	}
	answers := mapToAny(answersRaw.String)
	writingMap := mapToAny(writingRaw.String)
	flags := mapToAny(flagsRaw.String)
	if err := mergeProjectionBlob(answers, writingMap, flags, questionID, c.Response, writing); err != nil {
		return "", "", "", err
	}
	aJ, err := json.Marshal(answers)
	if err != nil {
		return "", "", "", err
	}
	wJ, err := json.Marshal(writingMap)
	if err != nil {
		return "", "", "", err
	}
	fJ, err := json.Marshal(flags)
	if err != nil {
		return "", "", "", err
	}
	if _, err := q.ExecContext(ctx, `UPDATE student_attempts SET answers=?, writing_answers=?, flags=? WHERE id=?`, string(aJ), string(wJ), string(fJ), attemptID); err != nil {
		return "", "", "", err
	}
	if _, err := q.ExecContext(ctx, cellInsertPrefix+"(?,?,?,?,?,?,?,?,?,?,?,?)"+cellUpsertUpdates, attemptID, questionID, moduleID, leaseEpoch, controlEpoch, c.ClientVersion, c.WriteID, reqHash, string(canonical), respHash, serverRev, now); err != nil {
		return "", "", "", err
	}
	return string(aJ), string(wJ), string(fJ), nil
}

// mergeProjectionBlob applies one accepted response to the legacy answer blob
// maps in memory. It is the single owner of the blob merge rule (answer cell
// routing + the review flag): the per-command strategy writes the maps back
// immediately, the set-based strategy merges every accepted command into the
// same maps and writes them once.
func mergeProjectionBlob(answers, writingMap, flags map[string]json.RawMessage, questionID string, payload ResponsePayload, writing bool) error {
	ansCanon, err := CanonicalJSON(payloadAnswer(payload))
	if err != nil {
		return err
	}
	if writing {
		writingMap[questionID] = json.RawMessage(ansCanon)
	} else {
		answers[questionID] = json.RawMessage(ansCanon)
	}
	if payload.MarkedForReview {
		flags[questionID] = json.RawMessage("true")
	} else {
		delete(flags, questionID)
	}
	return nil
}

func mapToAny(s string) map[string]json.RawMessage {
	m := map[string]json.RawMessage{}
	if s != "" {
		_ = json.Unmarshal([]byte(s), &m)
	}
	return m
}

func payloadAnswer(p ResponsePayload) any { return p.Answer }

func dbTime(ctx context.Context, q tx.Tx) (time.Time, error) {
	var t time.Time
	if err := q.QueryRowContext(ctx, `SELECT UTC_TIMESTAMP(6)`).Scan(&t); err != nil {
		return time.Time{}, err
	}
	return t.UTC(), nil
}

func isDup(err error) bool {
	if err == nil {
		return false
	}
	s := strings.ToLower(err.Error())
	return strings.Contains(s, "duplicate") || strings.Contains(s, "1062")
}
