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

// Service owns response mutation (plan 4.1).
type Service struct {
	tx     *tx.Runner
	clock  clock.Clock
	secret []byte
	// rowFirst selects the plan-B3 rows-only write path (no blob
	// SELECT/UPDATE per answer). Off keeps mergeProjection. Wired via
	// SetRowFirst (BuildApp from ROW_FIRST_WRITES); tests set directly.
	rowFirst bool
}

// SetRowFirst selects the B3 row-first write path. Chainable.
func (s *Service) SetRowFirst(on bool) *Service {
	s.rowFirst = on
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
	ModuleID    string
	SectionKey  string
	ModuleState string // must be active|review for writes
}

// QuestionResolver maps question IDs to ownership within the attempt.
type QuestionResolver interface {
	Resolve(ctx context.Context, q tx.Tx, attemptID, questionID string) (QuestionOwner, error)
}

// RuntimeGate is the locked runtime projection used for writability.
type RuntimeGate struct {
	Status                string
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
	if len(cmd.Commands) > 0 {
		replay, acks, rev, err := exactReplay(ctx, q, cmd)
		if err != nil {
			return SaveResult{}, err
		}
		if replay {
			if err := validateClaimLease(attempt, claims); err != nil {
				return SaveResult{}, err
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
		var storedHash string
		var storedRev uint64
		var storedResp string
		var storedResponseHash, storedOutcome string
		err = q.QueryRowContext(ctx, `SELECT request_hash, response_hash, outcome, server_revision, CAST(canonical_response AS CHAR) FROM attempt_mutations_v2 WHERE attempt_id=? AND client_write_id=? FOR UPDATE`, cmd.AttemptID, c.WriteID).Scan(&storedHash, &storedResponseHash, &storedOutcome, &storedRev, &storedResp)
		switch {
		case err == nil:
			if storedHash != reqHash {
				return SaveResult{}, &apperrors.Error{Code: apperrors.CodeWriteIDConflict, Message: fmt.Sprintf("Write %q was already used with different content.", c.WriteID), HTTPStatus: 409, Details: map[string]any{"writeId": c.WriteID}}
			}
			canonical, err := decodeResponsePayload(storedResp)
			if err != nil {
				return SaveResult{}, err
			}
			acks = append(acks, Ack{
				WriteID: c.WriteID, QuestionID: c.QuestionID, ClientVersion: c.ClientVersion,
				Outcome: "duplicate", ServerRevision: storedRev, Replayed: true,
				CanonicalResponse: canonical, ContentHash: storedResponseHash,
			})
			continue
		case err != sql.ErrNoRows:
			return SaveResult{}, err
		}
		// New write: writability applies only to new write IDs so exact
		// duplicates stay replayable post-terminal (per spec).
		if err := ensureWritable(attempt, gate, now); err != nil {
			return SaveResult{}, err
		}
		owner, err := qr.Resolve(ctx, q, cmd.AttemptID, c.QuestionID)
		if err != nil {
			return SaveResult{}, err
		}
		if owner.ModuleState != "active" && owner.ModuleState != "review" {
			return SaveResult{}, &apperrors.Error{Code: apperrors.CodeAttemptNotWritable, Message: "Question module is not active.", HTTPStatus: 422}
		}
		if gate.ActiveSectionKey != "*" && gate.ActiveSectionKey != "" && owner.SectionKey != gate.ActiveSectionKey {
			return SaveResult{}, &apperrors.Error{Code: apperrors.CodeBadRequest, Message: "Question is not in the active section.", HTTPStatus: 400}
		}
		// Version-collision probe.
		var existingWrite string
		err = q.QueryRowContext(ctx, `SELECT client_write_id FROM attempt_mutations_v2 WHERE attempt_id=? AND lease_epoch=? AND question_id=? AND client_version=? FOR UPDATE`, cmd.AttemptID, cmd.LeaseEpoch, c.QuestionID, c.ClientVersion).Scan(&existingWrite)
		if err == nil {
			return SaveResult{}, &apperrors.Error{Code: apperrors.CodeVersionCollision, Message: "Client version already used by another write.", HTTPStatus: 409, Details: map[string]any{"questionId": c.QuestionID, "clientVersion": c.ClientVersion, "existingWriteId": existingWrite}}
		} else if err != sql.ErrNoRows {
			return SaveResult{}, err
		}
		respHash, err := HashResponse(payloadToAny(c.Response))
		if err != nil {
			return SaveResult{}, err
		}
		// Projection with per-question monotonic rule (plan 22).
		var curLease *uint64
		var curVersion *uint64
		var curRev *uint64
		err = q.QueryRowContext(ctx, `SELECT lease_epoch, client_version, server_revision FROM attempt_responses_v2 WHERE attempt_id=? AND question_id=? FOR UPDATE`, cmd.AttemptID, c.QuestionID).Scan(&curLease, &curVersion, &curRev)
		newer := true
		if err == nil && curLease != nil && curVersion != nil {
			newer = cmd.LeaseEpoch > *curLease || (cmd.LeaseEpoch == *curLease && c.ClientVersion > *curVersion)
		} else if err != nil && err != sql.ErrNoRows {
			return SaveResult{}, err
		}
		outcome := "applied"
		serverRev := revision + 1
		ackCanonical := c.Response
		ackHash := respHash
		if !newer {
			outcome = "superseded"
			if curRev != nil {
				serverRev = *curRev
			}
			var currentRaw string
			var currentHash string
			if err := q.QueryRowContext(ctx, `SELECT CAST(response AS CHAR), response_hash FROM attempt_responses_v2 WHERE attempt_id=? AND question_id=?`, cmd.AttemptID, c.QuestionID).Scan(&currentRaw, &currentHash); err != nil {
				return SaveResult{}, err
			}
			ackCanonical, err = decodeResponsePayload(currentRaw)
			if err != nil {
				return SaveResult{}, err
			}
			ackHash = currentHash
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
			// B3: row-first path persists only the answer cell row (no blob
			// SELECT/UPDATE); legacy path keeps mergeProjection. Both share
			// the same canonical bytes + idempotency/version fencing above.
			if s.rowFirst {
				if err := upsertResponseRow(ctx, q, cmd.AttemptID, c.QuestionID, owner.ModuleID, cmd.LeaseEpoch, cmd.ControlEpoch, c.ClientVersion, c.WriteID, reqHash, canonical, respHash, serverRev, now); err != nil {
					return SaveResult{}, err
				}
			} else {
				writing := strings.Contains(strings.ToLower(owner.ModuleID), "writing")
				answersJSON, writingJSON, flagsJSON, err := mergeProjection(ctx, q, cmd.AttemptID, c.QuestionID, canonical, c, writing, owner.ModuleID, cmd.LeaseEpoch, cmd.ControlEpoch, reqHash, serverRev, respHash, now)
				if err != nil {
					return SaveResult{}, err
				}
				_ = answersJSON
				_ = writingJSON
				_ = flagsJSON
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
		if _, err := q.ExecContext(ctx, `INSERT INTO attempt_mutations_v2 (id, attempt_id, client_write_id, lease_epoch, control_epoch, question_id, client_version, request_hash, response_hash, outcome, server_revision, canonical_response, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, uuid.NewString(), cmd.AttemptID, c.WriteID, cmd.LeaseEpoch, cmd.ControlEpoch, c.QuestionID, c.ClientVersion, reqHash, ackHash, outcome, serverRev, string(payloadCanon), now); err != nil {
			if isDup(err) {
				return SaveResult{}, &apperrors.Error{Code: apperrors.CodeWriteIDConflict, Message: fmt.Sprintf("Write %q was already used with different content.", c.WriteID), HTTPStatus: 409}
			}
			return SaveResult{}, err
		}
		acks = append(acks, Ack{
			WriteID: c.WriteID, QuestionID: c.QuestionID, ClientVersion: c.ClientVersion,
			Outcome: outcome, ServerRevision: serverRev, CanonicalResponse: ackCanonical, ContentHash: ackHash,
		})
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
	var finalSub sql.NullString
	err := q.QueryRowContext(ctx, `SELECT id, schedule_id, user_id, organization_id, protocol_version, delivery_status, phase, lease_epoch, control_epoch, response_revision, deadline_at, closing_grace_until, submitted_at, final_submission, proctor_status FROM student_attempts WHERE id=? FOR UPDATE`, id).Scan(&a.ID, &a.ScheduleID, &a.UserID, &a.OrganizationID, &a.ProtocolVersion, &a.DeliveryStatus, &a.Phase, &a.LeaseEpoch, &a.ControlEpoch, &a.ResponseRevision, &deadline, &grace, &submitted, &finalSub, &a.ProctorStatus)
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
	return a, nil
}

func (s *Service) validateTokenSession(ctx context.Context, q tx.Tx, claims crypto.AttemptClaims) error {
	var revoked sql.NullTime
	var expires sql.NullTime
	var attemptID, sessionID string
	err := q.QueryRowContext(ctx, `SELECT attempt_id, client_session_id, revoked_at, expires_at FROM attempt_sessions WHERE token_id=? FOR UPDATE`, claims.TokenID).Scan(&attemptID, &sessionID, &revoked, &expires)
	if err == sql.ErrNoRows {
		return &apperrors.Error{Code: apperrors.CodeUnauthorized, Message: "Attempt credential session is not recognized.", HTTPStatus: 401}
	}
	if err != nil {
		return err
	}
	if revoked.Valid || (expires.Valid && expires.Time.Before(s.clock.Now())) {
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
func exactReplay(ctx context.Context, q tx.Tx, cmd SaveResponsesCommand) (bool, []Ack, uint64, error) {
	acks := make([]Ack, 0, len(cmd.Commands))
	for _, c := range cmd.Commands {
		reqHash, err := commandHash(c)
		if err != nil {
			return false, nil, 0, err
		}
		var storedHash, responseHash, outcome, storedResp string
		var storedRev uint64
		err = q.QueryRowContext(ctx, `SELECT request_hash, response_hash, outcome, server_revision, CAST(canonical_response AS CHAR) FROM attempt_mutations_v2 WHERE attempt_id=? AND client_write_id=? FOR UPDATE`, cmd.AttemptID, c.WriteID).Scan(&storedHash, &responseHash, &outcome, &storedRev, &storedResp)
		if err == sql.ErrNoRows {
			return false, nil, 0, nil
		}
		if err != nil {
			return false, nil, 0, err
		}
		if storedHash != reqHash {
			return false, nil, 0, &apperrors.Error{Code: apperrors.CodeWriteIDConflict, Message: fmt.Sprintf("Write %q was already used with different content.", c.WriteID), HTTPStatus: 409, Details: map[string]any{"writeId": c.WriteID}}
		}
		canonical, err := decodeResponsePayload(storedResp)
		if err != nil {
			return false, nil, 0, err
		}
		acks = append(acks, Ack{
			WriteID: c.WriteID, QuestionID: c.QuestionID, ClientVersion: c.ClientVersion,
			Outcome: "duplicate", ServerRevision: storedRev, Replayed: true,
			CanonicalResponse: canonical, ContentHash: responseHash,
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
	switch a.DeliveryStatus {
	case "submitted", "terminated", "locked", "cancelled":
		return &apperrors.Error{Code: apperrors.CodeAttemptNotWritable, Message: "Attempt is closed.", HTTPStatus: 422}
	}
	if a.DeliveryStatus == "paused" || a.Phase == "post-exam" || a.SubmittedAt != nil {
		return &apperrors.Error{Code: apperrors.CodeAttemptNotWritable, Message: "Attempt is not writable.", HTTPStatus: 422}
	}
	if a.ProctorStatus == "terminated" || a.ProctorStatus == "paused" {
		return &apperrors.Error{Code: apperrors.CodeAttemptProctorBlocked, Message: "Attempt is blocked by proctor state.", HTTPStatus: 403}
	}
	if gate.Status != "" && gate.Status != "live" {
		return &apperrors.Error{Code: apperrors.CodeAttemptNotWritable, Message: "Exam runtime is not live.", HTTPStatus: 422}
	}
	if gate.WaitingForNextSection {
		return &apperrors.Error{Code: apperrors.CodeAttemptNotWritable, Message: "Exam runtime is waiting.", HTTPStatus: 422}
	}
	if a.ClosingGraceUntil != nil && now.After(*a.ClosingGraceUntil) {
		return &apperrors.Error{Code: apperrors.CodeDeadlineExpired, Message: "Response deadline has passed.", HTTPStatus: 422}
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
	ansCanon, err := CanonicalJSON(payloadAnswer(c.Response))
	if err != nil {
		return "", "", "", err
	}
	if writing {
		writingMap[questionID] = json.RawMessage(ansCanon)
	} else {
		answers[questionID] = json.RawMessage(ansCanon)
	}
	if c.Response.MarkedForReview {
		flags[questionID] = json.RawMessage("true")
	} else {
		delete(flags, questionID)
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
	if _, err := q.ExecContext(ctx, `INSERT INTO attempt_responses_v2 (attempt_id, question_id, module_id, lease_epoch, control_epoch, client_version, client_write_id, request_hash, response, response_hash, server_revision, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE module_id=VALUES(module_id), lease_epoch=VALUES(lease_epoch), control_epoch=VALUES(control_epoch), client_version=VALUES(client_version), client_write_id=VALUES(client_write_id), request_hash=VALUES(request_hash), response=VALUES(response), response_hash=VALUES(response_hash), server_revision=VALUES(server_revision), updated_at=VALUES(updated_at)`, attemptID, questionID, moduleID, leaseEpoch, controlEpoch, c.ClientVersion, c.WriteID, reqHash, string(canonical), respHash, serverRev, now); err != nil {
		return "", "", "", err
	}
	return string(aJ), string(wJ), string(fJ), nil
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
