package student

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
	"time"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/tx"
	"github.com/google/uuid"
)

// V1MutationBatchWire is the compatibility request envelope. Mutations stay
// raw at the HTTP boundary because the retired client shipped two wire
// shapes: command-style {mutationId,type,...} and ledger-style
// {id,mutationType,payload}.
type V1MutationBatchWire struct {
	AttemptID       string            `json:"attemptId"`
	StudentKey      string            `json:"studentKey"`
	ClientSessionID string            `json:"clientSessionId"`
	Mutations       []json.RawMessage `json:"mutations"`
}

// V1MutationBatchRequest is the normalized V1 write request after the
// handler has attached the authenticated actor.
type V1MutationBatchRequest struct {
	AttemptID       string
	ScheduleID      string
	StudentKey      string
	ClientSessionID string
	ActorUserID     string
	Mutations       []V1Mutation
}

// V1Mutation is the server-normalized legacy mutation ledger row.
type V1Mutation struct {
	ID        string
	Seq       int64
	Timestamp time.Time
	Type      string
	Payload   map[string]any
}

// V1MutationResult mirrors StudentMutationResult from the Rust API.
type V1MutationResult struct {
	MutationID      string `json:"mutationId"`
	Status          string `json:"status"`
	ServerSeq       int64  `json:"serverSeq"`
	AppliedRevision *int64 `json:"appliedRevision,omitempty"`
}

// V1MutationBatchResponse is intentionally compatible with both old clients
// and the current recovery code. The attempt projection is included so a
// successful legacy flush can reconcile without a follow-up read.
type V1MutationBatchResponse struct {
	Attempt                    map[string]any     `json:"attempt,omitempty"`
	AppliedMutationCount       int                `json:"appliedMutationCount"`
	ServerAcceptedThroughSeq   int64              `json:"serverAcceptedThroughSeq"`
	Revision                   int64              `json:"revision"`
	AcceptedInGrace            bool               `json:"acceptedInGrace"`
	MutationResults            []V1MutationResult `json:"mutationResults"`
	RefreshedAttemptCredential any                `json:"refreshedAttemptCredential"`
}

// V1SubmitRequest is the old submit envelope. The final patch is applied
// while the attempt is locked, immediately before terminalization.
type V1SubmitRequest struct {
	AttemptID                string
	ScheduleID               string
	StudentKey               string
	ClientSessionID          string
	ActorUserID              string
	LastSeenRevision         *int64
	SubmissionID             string
	ClientFinalSeq           *int64
	ServerAcceptedThroughSeq *int64
	FinalAnswerPatch         json.RawMessage
}

// V1SubmitPreparation is the result of applying the final patch. The caller
// must seal the same transaction before committing it.
type V1SubmitPreparation struct {
	Attempt            map[string]any
	FinalSubmission    json.RawMessage
	AlreadyTerminal    bool
	StoredSubmissionID string
}

type v1AttemptRow struct {
	ID                    string
	ScheduleID            string
	StudentKey            string
	UserID                sql.NullString
	ExamID                string
	PublishedVersionID    string
	ExamTitle             string
	CandidateID           string
	CandidateName         string
	CandidateEmail        string
	Phase                 string
	CurrentModule         string
	CurrentQuestionID     sql.NullString
	Answers               json.RawMessage
	WritingAnswers        json.RawMessage
	Flags                 json.RawMessage
	Violations            json.RawMessage
	Integrity             json.RawMessage
	Recovery              json.RawMessage
	FinalSubmission       sql.NullString
	SubmittedAt           sql.NullTime
	CreatedAt             sql.NullTime
	UpdatedAt             sql.NullTime
	Revision              int64
	AnswerRevision        int64
	ProtocolVersion       int
	DeliveryStatus        string
	LeaseEpoch            int64
	ControlEpoch          int64
	ResponseRevision      int64
	DeadlineAt            sql.NullTime
	ClosingGraceUntil     sql.NullTime
	FinalResponseDigest   sql.NullString
	ActiveClientSessionID sql.NullString
	ProctorStatus         string
}

// ParseMutationBatch normalizes both V1 mutation envelopes. It deliberately
// keeps command validation here, at the compatibility boundary, so callers
// cannot accidentally persist an unknown mutation as an opaque event.
func ParseMutationBatch(wire V1MutationBatchWire) ([]V1Mutation, error) {
	if strings.TrimSpace(wire.AttemptID) == "" {
		return nil, validationError("attemptId is required.")
	}
	if len(wire.Mutations) == 0 {
		return nil, validationError("Mutation batch must contain at least one mutation.")
	}
	if len(wire.Mutations) > 500 {
		return nil, validationError("Mutation batch exceeds the maximum of 500 mutations.")
	}
	mutations := make([]V1Mutation, 0, len(wire.Mutations))
	seenIDs := make(map[string]struct{}, len(wire.Mutations))
	for index, raw := range wire.Mutations {
		mutation, err := parseMutation(raw, int64(index+1))
		if err != nil {
			return nil, err
		}
		if _, exists := seenIDs[mutation.ID]; exists {
			return nil, validationError("Mutation ids must be unique within a batch.")
		}
		seenIDs[mutation.ID] = struct{}{}
		mutations = append(mutations, mutation)
	}
	return mutations, nil
}

func parseMutation(raw json.RawMessage, fallbackSeq int64) (V1Mutation, error) {
	var object map[string]json.RawMessage
	if err := json.Unmarshal(raw, &object); err != nil || object == nil {
		return V1Mutation{}, validationError("Each mutation must be a JSON object.")
	}

	var id, mutationType string
	if value, ok := object["mutationId"]; ok {
		_ = json.Unmarshal(value, &id)
	}
	if id == "" {
		if value, ok := object["id"]; ok {
			_ = json.Unmarshal(value, &id)
		}
	}
	if value, ok := object["type"]; ok {
		_ = json.Unmarshal(value, &mutationType)
	}
	if mutationType == "" {
		if value, ok := object["mutationType"]; ok {
			_ = json.Unmarshal(value, &mutationType)
		}
	}
	if strings.TrimSpace(id) == "" || len(id) > 255 {
		return V1Mutation{}, validationError("Mutation id is required and must be at most 255 characters.")
	}
	mutationType = normalizeMutationType(mutationType)
	if !supportedMutationType(mutationType) {
		return V1Mutation{}, validationError(fmt.Sprintf("Mutation type %q is not supported.", mutationType))
	}

	seq := fallbackSeq
	if value, ok := object["seq"]; ok {
		var parsed int64
		if json.Unmarshal(value, &parsed) == nil && parsed > 0 {
			seq = parsed
		}
	}
	timestamp := time.Now().UTC()
	if value, ok := object["timestamp"]; ok {
		var rawTimestamp string
		if json.Unmarshal(value, &rawTimestamp) == nil && strings.TrimSpace(rawTimestamp) != "" {
			if parsed, err := time.Parse(time.RFC3339Nano, rawTimestamp); err == nil {
				timestamp = parsed.UTC()
			}
		}
	}

	payload := map[string]any{}
	if rawPayload, ok := object["payload"]; ok {
		if err := json.Unmarshal(rawPayload, &payload); err != nil || payload == nil {
			return V1Mutation{}, validationError("Mutation payload must be a JSON object.")
		}
	} else {
		for key, value := range object {
			switch key {
			case "id", "mutationId", "mutationType", "type", "seq", "timestamp", "baseRevision":
				continue
			}
			var decoded any
			if err := json.Unmarshal(value, &decoded); err != nil {
				return V1Mutation{}, validationError("Mutation payload is invalid.")
			}
			payload[key] = decoded
		}
	}
	return V1Mutation{ID: id, Seq: seq, Timestamp: timestamp, Type: mutationType, Payload: payload}, nil
}

func normalizeMutationType(value string) string {
	switch value {
	case "SetFlag":
		return "flag"
	case "SetEssayText":
		return "SetEssayText"
	case "ClearEssayText":
		return "ClearEssayText"
	case "SetSlot", "ClearSlot", "SetScalar", "ClearScalar", "SetChoice", "ClearChoice":
		return value
	default:
		return value
	}
}

func supportedMutationType(value string) bool {
	switch value {
	case "answer", "writing_answer", "flag", "violation", "position", "precheck", "network", "heartbeat", "device_fingerprint", "sync", "SetSlot", "ClearSlot", "SetScalar", "ClearScalar", "SetChoice", "ClearChoice", "SetEssayText", "ClearEssayText":
		return true
	default:
		return false
	}
}

// ApplyMutationBatch persists a V1 batch in one attempt-locked transaction.
func (s *Service) ApplyMutationBatch(ctx context.Context, req V1MutationBatchRequest) (V1MutationBatchResponse, error) {
	if s.db == nil {
		return V1MutationBatchResponse{}, apperrors.New(apperrors.CodeServiceUnavailable, "Student service is unavailable.")
	}
	// B1: attempt-locked batch write on one PK row + idempotency probes
	// (RC-safe; serialization comes from the attempt FOR UPDATE, not RR).
	sqlTx, err := s.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return V1MutationBatchResponse{}, err
	}
	defer func() { _ = sqlTx.Rollback() }()
	if _, err := sqlTx.ExecContext(ctx, "SET time_zone = '+00:00'"); err != nil {
		return V1MutationBatchResponse{}, err
	}
	out, err := s.ApplyMutationBatchInTx(ctx, sqlTx, req)
	if err != nil {
		return V1MutationBatchResponse{}, err
	}
	if err := sqlTx.Commit(); err != nil {
		return V1MutationBatchResponse{}, err
	}
	return out, nil
}

// ApplyMutationBatchInTx is exposed for callers that need to compose a V1
// flush with another transaction-local operation. The attempt row is the
// serialization boundary for both idempotency and aggregate updates.
func (s *Service) ApplyMutationBatchInTx(ctx context.Context, q tx.Tx, req V1MutationBatchRequest) (V1MutationBatchResponse, error) {
	if strings.TrimSpace(req.AttemptID) == "" || strings.TrimSpace(req.ScheduleID) == "" {
		return V1MutationBatchResponse{}, validationError("Attempt and schedule are required.")
	}
	if len(req.Mutations) == 0 {
		return V1MutationBatchResponse{}, validationError("Mutation batch must contain at least one mutation.")
	}
	row, err := loadV1AttemptForUpdate(ctx, q, req.AttemptID, req.ScheduleID)
	if err != nil {
		return V1MutationBatchResponse{}, err
	}
	if err := authorizeV1Attempt(ctx, q, &row, req.StudentKey, req.ActorUserID); err != nil {
		return V1MutationBatchResponse{}, err
	}
	if row.ProtocolVersion != 1 {
		return V1MutationBatchResponse{}, apperrors.New(apperrors.CodeConflict, "Attempt uses the V2 response protocol.")
	}
	clientSessionID, err := ensureV1ClientSession(ctx, q, row, req.ClientSessionID)
	if err != nil {
		return V1MutationBatchResponse{}, err
	}

	var existingMaxSeq int64
	if err := q.QueryRowContext(ctx, "SELECT COALESCE(MAX(mutation_seq), 0) FROM student_attempt_mutations WHERE attempt_id = ?", row.ID).Scan(&existingMaxSeq); err != nil {
		return V1MutationBatchResponse{}, err
	}

	answers, err := objectFromJSON(row.Answers)
	if err != nil {
		return V1MutationBatchResponse{}, err
	}
	writingAnswers, err := objectFromJSON(row.WritingAnswers)
	if err != nil {
		return V1MutationBatchResponse{}, err
	}
	flags, err := objectFromJSON(row.Flags)
	if err != nil {
		return V1MutationBatchResponse{}, err
	}
	violations := append(json.RawMessage(nil), row.Violations...)
	recovery, err := objectFromJSON(row.Recovery)
	if err != nil {
		return V1MutationBatchResponse{}, err
	}

	resultByID := make(map[string]V1MutationResult, len(req.Mutations))
	newMutations := make([]V1Mutation, 0, len(req.Mutations))
	for _, mutation := range req.Mutations {
		storedType, storedPayload, storedSeq, storedRevision, found, err := loadExistingMutation(ctx, q, row.ID, mutation.ID)
		if err != nil {
			return V1MutationBatchResponse{}, err
		}
		payloadJSON, err := json.Marshal(mutation.Payload)
		if err != nil {
			return V1MutationBatchResponse{}, err
		}
		if found {
			if storedType != mutation.Type || !sameJSON(storedPayload, payloadJSON) {
				return V1MutationBatchResponse{}, &apperrors.Error{Code: apperrors.CodeValidation, Message: "Mutation id already exists with different contents.", HTTPStatus: 422}
			}
			resultByID[mutation.ID] = V1MutationResult{MutationID: mutation.ID, Status: "duplicate", ServerSeq: storedSeq, AppliedRevision: nullableInt64(storedRevision)}
			continue
		}
		newMutations = append(newMutations, mutation)
	}

	if len(newMutations) > 0 && attemptIsTerminal(row) {
		return V1MutationBatchResponse{}, &apperrors.Error{
			Code:       apperrors.CodeConflict,
			Message:    "Attempt is already sealed and no longer accepts new mutations.",
			HTTPStatus: 409,
			Details:    map[string]any{"reason": "ATTEMPT_SUBMITTED", "latestRevision": row.Revision, "serverAcceptedThroughSeq": existingMaxSeq},
		}
	}
	if len(newMutations) == 0 {
		return V1MutationBatchResponse{
			Attempt:                  attemptProjection(row),
			AppliedMutationCount:     0,
			ServerAcceptedThroughSeq: existingMaxSeq,
			Revision:                 row.Revision,
			MutationResults:          orderedMutationResults(req.Mutations, resultByID),
		}, nil
	}

	originalAnswers := cloneMap(answers)
	originalWritingAnswers := cloneMap(writingAnswers)
	originalFlags := cloneMap(flags)
	objectiveChanged := false
	appliedCount := 0
	for _, mutation := range newMutations {
		applied, objective, err := applyV1Mutation(mutation, answers, writingAnswers, flags, &violations, recovery)
		if err != nil {
			return V1MutationBatchResponse{}, err
		}
		if applied {
			appliedCount++
		}
		objectiveChanged = objectiveChanged || objective
	}

	// applyV1Mutation works on maps in place; compare the resulting values to
	// the snapshots before encoding the aggregate columns.
	objectiveChanged = objectiveChanged || !reflect.DeepEqual(originalAnswers, answers) || !reflect.DeepEqual(originalWritingAnswers, writingAnswers) || !reflect.DeepEqual(originalFlags, flags)
	serverAcceptedThroughSeq := existingMaxSeq + int64(len(newMutations))
	now := time.Now().UTC()
	recovery["lastPersistedAt"] = now
	recovery["pendingMutationCount"] = 0
	recovery["syncState"] = "saved"
	recovery["serverAcceptedThroughSeq"] = serverAcceptedThroughSeq
	recovery["clientSessionId"] = clientSessionID

	for index, mutation := range newMutations {
		nextSeq := existingMaxSeq + int64(index) + 1
		payloadJSON, _ := json.Marshal(mutation.Payload)
		appliedRevision := row.Revision + 1
		if _, err := q.ExecContext(ctx, `INSERT INTO student_attempt_mutations (id, attempt_id, schedule_id, client_session_id, mutation_type, client_mutation_id, mutation_seq, payload, client_timestamp, server_received_at, applied_revision, applied_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(6), ?, UTC_TIMESTAMP(6))`, uuid.NewString(), row.ID, row.ScheduleID, clientSessionID, mutation.Type, mutation.ID, nextSeq, string(payloadJSON), mutation.Timestamp, appliedRevision); err != nil {
			return V1MutationBatchResponse{}, err
		}
		resultByID[mutation.ID] = V1MutationResult{MutationID: mutation.ID, Status: "applied", ServerSeq: nextSeq, AppliedRevision: &appliedRevision}
	}

	answersJSON, _ := json.Marshal(answers)
	writingJSON, _ := json.Marshal(writingAnswers)
	flagsJSON, _ := json.Marshal(flags)
	recoveryJSON, _ := json.Marshal(recovery)
	update, err := q.ExecContext(ctx, `UPDATE student_attempts SET answers = ?, writing_answers = ?, flags = ?, violations_snapshot = ?, recovery = ?, answer_revision = answer_revision + ?, revision = revision + 1, updated_at = UTC_TIMESTAMP(6) WHERE id = ? AND schedule_id = ? AND revision = ? AND submitted_at IS NULL AND COALESCE(proctor_status, 'active') <> 'terminated' AND COALESCE(delivery_status, 'running') NOT IN ('submitted', 'terminated', 'locked', 'cancelled')`, string(answersJSON), string(writingJSON), string(flagsJSON), string(violations), string(recoveryJSON), boolInt(objectiveChanged), row.ID, row.ScheduleID, row.Revision)
	if err != nil {
		return V1MutationBatchResponse{}, err
	}
	rows, err := update.RowsAffected()
	if err != nil {
		return V1MutationBatchResponse{}, err
	}
	if rows != 1 {
		return V1MutationBatchResponse{}, &apperrors.Error{Code: apperrors.CodeConflict, Message: "Attempt changed or is already terminal.", HTTPStatus: 409, Details: map[string]any{"reason": "ATTEMPT_SUBMITTED"}}
	}

	row, err = loadV1AttemptForUpdate(ctx, q, row.ID, row.ScheduleID)
	if err != nil {
		return V1MutationBatchResponse{}, err
	}
	if _, err := q.ExecContext(ctx, `INSERT INTO session_audit_logs (id, schedule_id, actor, action_type, target_student_id, payload, created_at) VALUES (?, ?, ?, 'STUDENT_MUTATION_BATCH', ?, ?, UTC_TIMESTAMP(6))`, uuid.NewString(), row.ScheduleID, firstNonEmpty(req.ActorUserID, row.StudentKey), row.ID, fmt.Sprintf(`{"requestedCount":%d,"appliedCount":%d,"seqTo":%d,"clientSessionId":%q}`, len(req.Mutations), appliedCount, serverAcceptedThroughSeq, clientSessionID)); err != nil {
		return V1MutationBatchResponse{}, err
	}
	return V1MutationBatchResponse{
		Attempt:                    attemptProjection(row),
		AppliedMutationCount:       appliedCount,
		ServerAcceptedThroughSeq:   serverAcceptedThroughSeq,
		Revision:                   row.Revision,
		MutationResults:            orderedMutationResults(req.Mutations, resultByID),
		RefreshedAttemptCredential: nil,
	}, nil
}

// PrepareSubmitInTx applies the optional final answer patch and returns the
// server-owned final submission payload. The caller must invoke the shared
// terminalization boundary before commit.
func (s *Service) PrepareSubmitInTx(ctx context.Context, q tx.Tx, req V1SubmitRequest) (V1SubmitPreparation, error) {
	if strings.TrimSpace(req.SubmissionID) == "" || len(req.SubmissionID) > 255 {
		return V1SubmitPreparation{}, validationError("submissionId is required and must be at most 255 characters.")
	}
	row, err := loadV1AttemptForUpdate(ctx, q, req.AttemptID, req.ScheduleID)
	if err != nil {
		return V1SubmitPreparation{}, err
	}
	if err := authorizeV1Attempt(ctx, q, &row, req.StudentKey, req.ActorUserID); err != nil {
		return V1SubmitPreparation{}, err
	}
	if row.ProtocolVersion != 1 {
		return V1SubmitPreparation{}, apperrors.New(apperrors.CodeConflict, "Attempt uses the V2 response protocol.")
	}
	if _, err := ensureV1ClientSession(ctx, q, row, req.ClientSessionID); err != nil {
		return V1SubmitPreparation{}, err
	}
	if attemptIsTerminal(row) {
		storedID := storedSubmissionID(row.FinalSubmission)
		if storedID != "" && storedID != req.SubmissionID {
			return V1SubmitPreparation{}, &apperrors.Error{Code: apperrors.CodeSubmissionReplayMisuse, Message: "Submission identity already used.", HTTPStatus: 409, Details: map[string]any{"existingSubmissionId": storedID}}
		}
		return V1SubmitPreparation{Attempt: attemptProjection(row), AlreadyTerminal: true, StoredSubmissionID: storedID}, nil
	}
	if req.LastSeenRevision != nil && row.Revision != *req.LastSeenRevision {
		return V1SubmitPreparation{}, &apperrors.Error{Code: apperrors.CodeConflict, Message: "Attempt revision is stale.", HTTPStatus: 409, Details: map[string]any{"reason": "BASE_REVISION_MISMATCH", "latestRevision": row.Revision}}
	}

	answers, err := objectFromJSON(row.Answers)
	if err != nil {
		return V1SubmitPreparation{}, err
	}
	writingAnswers, err := objectFromJSON(row.WritingAnswers)
	if err != nil {
		return V1SubmitPreparation{}, err
	}
	flags, err := objectFromJSON(row.Flags)
	if err != nil {
		return V1SubmitPreparation{}, err
	}
	if len(req.FinalAnswerPatch) > 0 && strings.TrimSpace(string(req.FinalAnswerPatch)) != "null" {
		var patch map[string]json.RawMessage
		if err := json.Unmarshal(req.FinalAnswerPatch, &patch); err != nil || patch == nil {
			return V1SubmitPreparation{}, validationError("finalAnswerPatch must be a JSON object.")
		}
		if err := mergePatchObject(patch["answers"], answers); err != nil {
			return V1SubmitPreparation{}, err
		}
		if err := mergePatchObject(patch["writingAnswers"], writingAnswers); err != nil {
			return V1SubmitPreparation{}, err
		}
		if err := mergePatchObject(patch["flags"], flags); err != nil {
			return V1SubmitPreparation{}, err
		}
	}

	changed := !reflect.DeepEqual(answers, mustObject(row.Answers)) || !reflect.DeepEqual(writingAnswers, mustObject(row.WritingAnswers)) || !reflect.DeepEqual(flags, mustObject(row.Flags))
	recovery := mustObject(row.Recovery)
	now := time.Now().UTC()
	recovery["lastPersistedAt"] = now
	recovery["pendingMutationCount"] = 0
	recovery["syncState"] = "saved"
	answersJSON, _ := json.Marshal(answers)
	writingJSON, _ := json.Marshal(writingAnswers)
	flagsJSON, _ := json.Marshal(flags)
	recoveryJSON, _ := json.Marshal(recovery)
	if _, err := q.ExecContext(ctx, `UPDATE student_attempts SET answers = ?, writing_answers = ?, flags = ?, recovery = ?, answer_revision = answer_revision + ?, revision = revision + 1, updated_at = UTC_TIMESTAMP(6) WHERE id = ? AND schedule_id = ? AND revision = ? AND submitted_at IS NULL AND COALESCE(proctor_status, 'active') <> 'terminated' AND COALESCE(delivery_status, 'running') NOT IN ('submitted', 'terminated', 'locked', 'cancelled')`, string(answersJSON), string(writingJSON), string(flagsJSON), string(recoveryJSON), boolInt(changed), row.ID, row.ScheduleID, row.Revision); err != nil {
		return V1SubmitPreparation{}, err
	}
	row, err = loadV1AttemptForUpdate(ctx, q, row.ID, row.ScheduleID)
	if err != nil {
		return V1SubmitPreparation{}, err
	}
	finalSubmission, err := json.Marshal(map[string]any{
		"submissionId":   req.SubmissionID,
		"answers":        answers,
		"writingAnswers": writingAnswers,
		"flags":          flags,
		"finalFlush": map[string]any{
			"clientFinalSeq":           req.ClientFinalSeq,
			"serverAcceptedThroughSeq": req.ServerAcceptedThroughSeq,
			"finalPatchApplied":        len(req.FinalAnswerPatch) > 0,
		},
	})
	if err != nil {
		return V1SubmitPreparation{}, err
	}
	return V1SubmitPreparation{Attempt: attemptProjection(row), FinalSubmission: finalSubmission}, nil
}

func orderedMutationResults(mutations []V1Mutation, byID map[string]V1MutationResult) []V1MutationResult {
	results := make([]V1MutationResult, 0, len(mutations))
	for _, mutation := range mutations {
		if result, ok := byID[mutation.ID]; ok {
			results = append(results, result)
		}
	}
	return results
}

func loadV1AttemptForUpdate(ctx context.Context, q tx.Tx, attemptID, scheduleID string) (v1AttemptRow, error) {
	const query = `SELECT id, schedule_id, student_key, user_id, exam_id, published_version_id, exam_title, candidate_id, candidate_name, candidate_email, phase, current_module, current_question_id, CAST(answers AS CHAR), CAST(writing_answers AS CHAR), CAST(flags AS CHAR), CAST(violations_snapshot AS CHAR), CAST(integrity AS CHAR), CAST(recovery AS CHAR), CAST(final_submission AS CHAR), submitted_at, created_at, updated_at, revision, answer_revision, COALESCE(protocol_version, 1), COALESCE(delivery_status, 'running'), COALESCE(lease_epoch, 1), COALESCE(control_epoch, 1), COALESCE(response_revision, 0), deadline_at, closing_grace_until, final_response_digest, active_client_session_id, COALESCE(proctor_status, 'active') FROM student_attempts WHERE id = ? AND schedule_id = ? FOR UPDATE`
	var row v1AttemptRow
	err := q.QueryRowContext(ctx, query, attemptID, scheduleID).Scan(
		&row.ID, &row.ScheduleID, &row.StudentKey, &row.UserID, &row.ExamID, &row.PublishedVersionID,
		&row.ExamTitle, &row.CandidateID, &row.CandidateName, &row.CandidateEmail, &row.Phase,
		&row.CurrentModule, &row.CurrentQuestionID, rawJSON(&row.Answers), rawJSON(&row.WritingAnswers), rawJSON(&row.Flags), rawJSON(&row.Violations), rawJSON(&row.Integrity), rawJSON(&row.Recovery), &row.FinalSubmission,
		&row.SubmittedAt, &row.CreatedAt, &row.UpdatedAt, &row.Revision, &row.AnswerRevision, &row.ProtocolVersion, &row.DeliveryStatus,
		&row.LeaseEpoch, &row.ControlEpoch, &row.ResponseRevision, &row.DeadlineAt, &row.ClosingGraceUntil, &row.FinalResponseDigest, &row.ActiveClientSessionID, &row.ProctorStatus,
	)
	if err == sql.ErrNoRows {
		return v1AttemptRow{}, apperrors.New(apperrors.CodeNotFound, "Attempt not found.")
	}
	return row, err
}

// GetAttemptProjection returns the compatibility-shaped attempt after a
// committed V1 write. It is also used by the submit response so clients never
// receive the pre-terminal snapshot.
func (s *Service) GetAttemptProjection(ctx context.Context, attemptID string) (map[string]any, error) {
	if s.db == nil {
		return nil, apperrors.New(apperrors.CodeServiceUnavailable, "Student service is unavailable.")
	}
	var scheduleID string
	if err := s.db.QueryRowContext(ctx, "SELECT schedule_id FROM student_attempts WHERE id = ?", attemptID).Scan(&scheduleID); err != nil {
		if err == sql.ErrNoRows {
			return nil, apperrors.New(apperrors.CodeNotFound, "Attempt not found.")
		}
		return nil, err
	}
	row, err := loadV1AttemptForUpdate(ctx, s.db, attemptID, scheduleID)
	if err != nil {
		return nil, err
	}
	return attemptProjection(row), nil
}

func authorizeV1Attempt(ctx context.Context, q tx.Tx, row *v1AttemptRow, studentKey, actorUserID string) error {
	if studentKey != "" && studentKey != row.StudentKey {
		return apperrors.New(apperrors.CodeForbidden, "Attempt does not belong to this student.")
	}
	if actorUserID != "" {
		if row.UserID.Valid && row.UserID.String != actorUserID {
			return apperrors.New(apperrors.CodeForbidden, "Attempt does not belong to this student.")
		}
		if !row.UserID.Valid || row.UserID.String == "" {
			if _, err := q.ExecContext(ctx, "UPDATE student_attempts SET user_id = ? WHERE id = ? AND user_id IS NULL", actorUserID, row.ID); err != nil {
				return err
			}
			row.UserID = sql.NullString{String: actorUserID, Valid: true}
		}
	}
	return nil
}

func ensureV1ClientSession(ctx context.Context, q tx.Tx, row v1AttemptRow, requested string) (string, error) {
	clientSessionID := strings.TrimSpace(requested)
	if clientSessionID == "" {
		sum := sha256.Sum256([]byte("v1:" + row.ID + ":" + row.StudentKey))
		clientSessionID = hex.EncodeToString(sum[:])[:36]
	}
	if len(clientSessionID) > 36 {
		return "", validationError("clientSessionId must be at most 36 characters.")
	}
	if row.ActiveClientSessionID.Valid && row.ActiveClientSessionID.String != "" && row.ActiveClientSessionID.String != clientSessionID {
		return "", &apperrors.Error{Code: apperrors.CodeActiveSessionSuperseded, Message: "Attempt write credential has been superseded by a newer student session.", HTTPStatus: 409, Details: map[string]any{"activeSessionId": row.ActiveClientSessionID.String}}
	}
	if !row.ActiveClientSessionID.Valid || row.ActiveClientSessionID.String == "" {
		if _, err := q.ExecContext(ctx, "UPDATE student_attempts SET active_client_session_id = ? WHERE id = ? AND active_client_session_id IS NULL", clientSessionID, row.ID); err != nil {
			return "", err
		}
	}
	return clientSessionID, nil
}

func loadExistingMutation(ctx context.Context, q tx.Tx, attemptID, mutationID string) (string, []byte, int64, sql.NullInt64, bool, error) {
	var typ string
	var payload []byte
	var seq int64
	var revision sql.NullInt64
	err := q.QueryRowContext(ctx, "SELECT mutation_type, payload, mutation_seq, applied_revision FROM student_attempt_mutations WHERE attempt_id = ? AND client_mutation_id = ? FOR UPDATE", attemptID, mutationID).Scan(&typ, &payload, &seq, &revision)
	if err == sql.ErrNoRows {
		return "", nil, 0, sql.NullInt64{}, false, nil
	}
	return typ, payload, seq, revision, err == nil, err
}

func applyV1Mutation(mutation V1Mutation, answers, writingAnswers, flags map[string]any, violations *json.RawMessage, recovery map[string]any) (bool, bool, error) {
	questionID := payloadString(mutation.Payload, "questionId")
	taskID := payloadString(mutation.Payload, "taskId")
	switch mutation.Type {
	case "answer", "SetScalar", "SetChoice":
		if questionID == "" {
			return false, false, validationError("Answer mutation requires questionId.")
		}
		value, ok := mutation.Payload["value"]
		if !ok {
			return false, false, validationError("Answer mutation requires value.")
		}
		changed := !reflect.DeepEqual(answers[questionID], value)
		answers[questionID] = value
		return true, changed, nil
	case "ClearScalar", "ClearChoice":
		if questionID == "" {
			return false, false, validationError("Clear mutation requires questionId.")
		}
		changed := !reflect.DeepEqual(answers[questionID], nil)
		answers[questionID] = nil
		return true, changed, nil
	case "SetSlot", "ClearSlot":
		if questionID == "" {
			return false, false, validationError("Slot mutation requires questionId.")
		}
		index, ok := payloadInt(mutation.Payload, "slotIndex")
		if !ok || index < 0 || index > 1000 {
			return false, false, validationError("slotIndex must be a non-negative integer.")
		}
		slots, _ := answers[questionID].([]any)
		for len(slots) <= index {
			slots = append(slots, nil)
		}
		var value any
		if mutation.Type == "SetSlot" {
			var present bool
			value, present = mutation.Payload["value"]
			if !present {
				return false, false, validationError("SetSlot mutation requires value.")
			}
		}
		changed := !reflect.DeepEqual(slots[index], value)
		slots[index] = value
		answers[questionID] = slots
		return true, changed, nil
	case "writing_answer", "SetEssayText":
		if taskID == "" {
			return false, false, validationError("Writing mutation requires taskId.")
		}
		value, ok := mutation.Payload["value"]
		if !ok {
			return false, false, validationError("Writing mutation requires value.")
		}
		if value != nil {
			if _, ok := value.(string); !ok {
				return false, false, validationError("Writing answers must be strings or null.")
			}
		}
		changed := !reflect.DeepEqual(writingAnswers[taskID], value)
		writingAnswers[taskID] = value
		return true, changed, nil
	case "ClearEssayText":
		if taskID == "" {
			return false, false, validationError("Clear essay mutation requires taskId.")
		}
		changed := !reflect.DeepEqual(writingAnswers[taskID], nil)
		writingAnswers[taskID] = nil
		return true, changed, nil
	case "flag":
		if questionID == "" {
			return false, false, validationError("Flag mutation requires questionId.")
		}
		value, ok := mutation.Payload["value"].(bool)
		if !ok {
			return false, false, validationError("Flag values must be boolean.")
		}
		changed := !reflect.DeepEqual(flags[questionID], value)
		flags[questionID] = value
		return true, changed, nil
	case "violation":
		value, ok := mutation.Payload["violations"]
		if ok {
			if _, ok := value.([]any); !ok {
				return false, false, validationError("violations must be an array.")
			}
			encoded, _ := json.Marshal(value)
			*violations = encoded
		}
		return true, false, nil
	case "position":
		recovery["clientPosition"] = map[string]any{
			"phase":             mutation.Payload["phase"],
			"currentModule":     mutation.Payload["currentModule"],
			"currentQuestionId": mutation.Payload["currentQuestionId"],
			"at":                mutation.Timestamp,
		}
		return true, false, nil
	case "precheck", "network", "heartbeat", "device_fingerprint", "sync":
		// Telemetry mutations remain durably ledgered but do not alter the
		// answer aggregate. Their dedicated endpoints own authoritative data.
		return false, false, nil
	default:
		return false, false, validationError(fmt.Sprintf("Mutation type %q is not supported.", mutation.Type))
	}
}

func mergePatchObject(raw json.RawMessage, target map[string]any) error {
	if len(raw) == 0 || strings.TrimSpace(string(raw)) == "null" {
		return nil
	}
	var patch map[string]any
	if err := json.Unmarshal(raw, &patch); err != nil || patch == nil {
		return validationError("Final answer patch fields must be JSON objects.")
	}
	for key, value := range patch {
		target[key] = value
	}
	return nil
}

func attemptIsTerminal(row v1AttemptRow) bool {
	return row.SubmittedAt.Valid || row.Phase == "post-exam" || row.DeliveryStatus == "submitted" || row.DeliveryStatus == "terminated" || row.DeliveryStatus == "locked" || row.DeliveryStatus == "cancelled" || row.ProctorStatus == "terminated"
}

func storedSubmissionID(raw sql.NullString) string {
	if !raw.Valid || strings.TrimSpace(raw.String) == "" {
		return ""
	}
	var object map[string]any
	if json.Unmarshal([]byte(raw.String), &object) != nil {
		return ""
	}
	value, _ := object["submissionId"].(string)
	return value
}

func attemptProjection(row v1AttemptRow) map[string]any {
	projection := map[string]any{
		"id": row.ID, "scheduleId": row.ScheduleID, "studentKey": row.StudentKey,
		"examId": row.ExamID, "publishedVersionId": row.PublishedVersionID, "examTitle": row.ExamTitle,
		"candidateId": row.CandidateID, "candidateName": row.CandidateName, "candidateEmail": row.CandidateEmail,
		"phase": row.Phase, "currentModule": row.CurrentModule, "answers": rawValue(row.Answers),
		"writingAnswers": rawValue(row.WritingAnswers), "flags": rawValue(row.Flags),
		"violationsSnapshot": rawValue(row.Violations), "integrity": rawValue(row.Integrity), "recovery": rawValue(row.Recovery),
		"revision": row.Revision, "protocolVersion": row.ProtocolVersion, "deliveryStatus": row.DeliveryStatus,
		"leaseEpoch": row.LeaseEpoch, "controlEpoch": row.ControlEpoch, "responseRevision": row.ResponseRevision,
		"proctorStatus": row.ProctorStatus,
	}
	if row.CurrentQuestionID.Valid {
		projection["currentQuestionId"] = row.CurrentQuestionID.String
	} else {
		projection["currentQuestionId"] = nil
	}
	if row.FinalSubmission.Valid {
		projection["finalSubmission"] = rawValue(json.RawMessage(row.FinalSubmission.String))
	} else {
		projection["finalSubmission"] = nil
	}
	if row.SubmittedAt.Valid {
		projection["submittedAt"] = row.SubmittedAt.Time.UTC()
	} else {
		projection["submittedAt"] = nil
	}
	if row.DeadlineAt.Valid {
		projection["deadlineAt"] = row.DeadlineAt.Time.UTC()
	}
	if row.ClosingGraceUntil.Valid {
		projection["closingGraceUntil"] = row.ClosingGraceUntil.Time.UTC()
	}
	if row.FinalResponseDigest.Valid {
		projection["finalResponseDigest"] = row.FinalResponseDigest.String
	}
	if row.ActiveClientSessionID.Valid {
		projection["activeClientSessionId"] = row.ActiveClientSessionID.String
	}
	if row.CreatedAt.Valid {
		projection["createdAt"] = row.CreatedAt.Time.UTC()
	}
	if row.UpdatedAt.Valid {
		projection["updatedAt"] = row.UpdatedAt.Time.UTC()
	}
	return projection
}

func rawValue(raw json.RawMessage) any {
	var value any
	if len(raw) == 0 || json.Unmarshal(raw, &value) != nil {
		return map[string]any{}
	}
	return value
}

func objectFromJSON(raw json.RawMessage) (map[string]any, error) {
	var object map[string]any
	if len(raw) == 0 || strings.TrimSpace(string(raw)) == "" || string(raw) == "null" {
		return map[string]any{}, nil
	}
	if err := json.Unmarshal(raw, &object); err != nil || object == nil {
		return nil, validationError("Attempt aggregate is not a JSON object.")
	}
	return object, nil
}

func mustObject(raw json.RawMessage) map[string]any {
	object, err := objectFromJSON(raw)
	if err != nil {
		return map[string]any{}
	}
	return object
}

func cloneMap(source map[string]any) map[string]any {
	encoded, _ := json.Marshal(source)
	return mustObject(encoded)
}

func sameJSON(left, right []byte) bool {
	var a, b any
	if json.Unmarshal(left, &a) != nil || json.Unmarshal(right, &b) != nil {
		return string(left) == string(right)
	}
	return reflect.DeepEqual(a, b)
}

func nullableInt64(value sql.NullInt64) *int64 {
	if !value.Valid {
		return nil
	}
	return &value.Int64
}

func boolInt(value bool) int {
	if value {
		return 1
	}
	return 0
}

func payloadString(payload map[string]any, key string) string {
	value, _ := payload[key].(string)
	return strings.TrimSpace(value)
}

func payloadInt(payload map[string]any, key string) (int, bool) {
	switch value := payload[key].(type) {
	case float64:
		return int(value), value == float64(int(value))
	case int:
		return value, true
	case int64:
		return int(value), true
	default:
		return 0, false
	}
}

func validationError(message string) *apperrors.Error {
	return &apperrors.Error{Code: apperrors.CodeValidation, Message: message, HTTPStatus: 422}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}
