package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"example.com/ielts-proctoring/internal/accesslinks"
	"example.com/ielts-proctoring/internal/attempts"
	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/outbox"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/httpx"
	"example.com/ielts-proctoring/internal/platform/tx"
	"example.com/ielts-proctoring/internal/schedules"
	"example.com/ielts-proctoring/internal/terminalization"
)

// bearerOf extracts the attempt bearer token. Scheme match is
// case-insensitive; empty when absent.
func bearerOf(r *http.Request) string {
	h := r.Header.Get("Authorization")
	if len(h) > 7 && strings.EqualFold(h[:6], "bearer") && h[6] == ' ' {
		return strings.TrimSpace(h[7:])
	}
	return ""
}

// v2Resolver maps a V2 question id to module/section ownership within the
// attempt's published exam version.
type v2Resolver struct{}

var _ attempts.QuestionResolver = v2Resolver{}

func (v2Resolver) Resolve(ctx context.Context, q tx.Tx, attemptID, questionID string) (attempts.QuestionOwner, error) {
	const sel = `SELECT m.id, s.section_key, COALESCE(ma.state, ''), e.provider_key` +
		` FROM assessment_exam_questions eq` +
		` JOIN assessment_modules m ON m.id = eq.module_id` +
		` JOIN assessment_sections s ON s.id = m.section_id` +
		` JOIN exam_versions v ON v.id = s.exam_version_id` +
		` JOIN exam_entities e ON e.id = v.exam_id` +
		` LEFT JOIN assessment_module_attempts ma ON ma.module_id = m.id AND ma.attempt_id = ?` +
		` WHERE (eq.id = ? OR eq.question_id = ?)` +
		` AND s.exam_version_id = (SELECT published_version_id FROM student_attempts WHERE id = ?)` +
		` ORDER BY CASE WHEN eq.id = ? THEN 0 ELSE 1 END LIMIT 1`
	var owner attempts.QuestionOwner
	var state string
	var providerKey sql.NullString
	err := q.QueryRowContext(ctx, sel, attemptID, questionID, questionID, attemptID, questionID).Scan(&owner.ModuleID, &owner.SectionKey, &state, &providerKey)
	if err == sql.ErrNoRows {
		owner, fallbackErr := resolveSnapshotQuestionForProvider(ctx, q, attemptID, questionID)
		if fallbackErr != nil {
			return attempts.QuestionOwner{}, fallbackErr
		}
		return owner, nil
	}
	if err != nil {
		return attempts.QuestionOwner{}, err
	}
	// Exam-day P1: a normalized question row without an assigned module
	// attempt for this attempt (unassigned adaptive branch, future module)
	// must NOT resolve as writable. Report it as unassigned so the write
	// gate rejects with ATTEMPT_NOT_WRITABLE; snapshot-backed questions
	// (no normalized row) still resolve active via resolveSnapshotQuestion.
	if state == "" {
		owner.ModuleState = "unassigned"
		return owner, nil
	}
	owner.ModuleState = state
	return owner, nil
}

// resolveSnapshotQuestionForProvider keeps V2 response durability usable
// for the published IELTS/ACT content trees that predate the normalized
// assessment tables. SAT authoring normally has canonical assessment rows,
// while legacy snapshot-backed exams still need the same V2 write contract
// during drain.
//
// Exam-day re-audit defect 6: the snapshot path is provider-gated. A SAT
// question id that happens to appear in a snapshot tree (stale snapshot,
// version skew, forged branch id) must NOT resolve active through this path
// — SAT writes require a normalized row + assigned module attempt.
func resolveSnapshotQuestionForProvider(ctx context.Context, q tx.Tx, attemptID, questionID string) (attempts.QuestionOwner, error) {
	if isSATAttempt(ctx, q, attemptID) {
		return attempts.QuestionOwner{}, apperrors.New(apperrors.CodeNotFound, "Question is not part of the attempt exam.")
	}
	return resolveSnapshotQuestion(ctx, q, attemptID, questionID)
}

// isSATAttempt reports whether the attempt belongs to a SAT exam. Unknown
// or unreadable provider defaults to non-SAT (legacy snapshot behavior
// preserved) — the strict rule only ever narrows SAT writes.
func isSATAttempt(ctx context.Context, q tx.Tx, attemptID string) bool {
	var provider sql.NullString
	err := q.QueryRowContext(ctx, `SELECT e.provider_key FROM student_attempts sa JOIN exam_schedules s ON s.id = sa.schedule_id JOIN exam_entities e ON e.id = s.exam_id WHERE sa.id = ?`, attemptID).Scan(&provider)
	if err != nil || !provider.Valid {
		return false
	}
	return provider.String == string(attempts.ProviderSAT)
}

func resolveSnapshotQuestion(ctx context.Context, q tx.Tx, attemptID, questionID string) (attempts.QuestionOwner, error) {
	var raw string
	err := q.QueryRowContext(ctx, `SELECT CAST(v.content_snapshot AS CHAR) FROM student_attempts a JOIN exam_versions v ON v.id = a.published_version_id WHERE a.id = ?`, attemptID).Scan(&raw)
	if err == sql.ErrNoRows {
		return attempts.QuestionOwner{}, apperrors.New(apperrors.CodeNotFound, "Question is not part of the attempt exam.")
	}
	if err != nil {
		return attempts.QuestionOwner{}, err
	}
	var root map[string]any
	if err := json.Unmarshal([]byte(raw), &root); err != nil {
		return attempts.QuestionOwner{}, err
	}
	if nested, ok := root["contentSnapshot"].(map[string]any); ok {
		root = nested
	}
	for _, candidate := range snapshotQuestionRoots(root) {
		if snapshotContainsQuestion(candidate.value, questionID) {
			return attempts.QuestionOwner{ModuleID: candidate.moduleKey, SectionKey: candidate.sectionKey, ModuleState: "active"}, nil
		}
	}
	return attempts.QuestionOwner{}, apperrors.New(apperrors.CodeNotFound, "Question is not part of the attempt exam.")
}

type snapshotQuestionRoot struct {
	sectionKey string
	moduleKey  string
	value      any
}

func snapshotQuestionRoots(root map[string]any) []snapshotQuestionRoot {
	const knownSectionsKey = "sections"
	orderedKeys := []string{"listening", "reading", "writing", "speaking", "science", "reading-writing", "readingWriting", "math"}
	seen := make(map[string]bool, len(orderedKeys))
	var roots []snapshotQuestionRoot
	appendRoot := func(rawKey string, value any) {
		sectionKey := normalizeSnapshotSectionKey(rawKey)
		if sectionKey == "" || seen[sectionKey] {
			return
		}
		seen[sectionKey] = true
		roots = append(roots, snapshotQuestionRoot{sectionKey: sectionKey, moduleKey: sectionKey, value: value})
	}
	for _, key := range orderedKeys {
		if value, ok := root[key]; ok {
			appendRoot(key, value)
		}
	}
	if sections, ok := root[knownSectionsKey].(map[string]any); ok {
		keys := make([]string, 0, len(sections))
		for key := range sections {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		for _, key := range keys {
			appendRoot(key, sections[key])
		}
	}
	for _, key := range []string{"content", "exam"} {
		if value, ok := root[key].(map[string]any); ok {
			for _, nested := range snapshotQuestionRoots(value) {
				if !seen[nested.sectionKey] {
					seen[nested.sectionKey] = true
					roots = append(roots, nested)
				}
			}
		}
	}
	return roots
}

func normalizeSnapshotSectionKey(raw string) string {
	switch strings.ToLower(strings.ReplaceAll(strings.TrimSpace(raw), "_", "-")) {
	case "listening", "reading", "writing", "speaking", "science", "math":
		return strings.ToLower(strings.ReplaceAll(strings.TrimSpace(raw), "_", "-"))
	case "reading-writing", "readingwriting":
		return "reading-writing"
	default:
		return ""
	}
}

func snapshotContainsQuestion(value any, questionID string) bool {
	switch node := value.(type) {
	case map[string]any:
		// Writing tasks in the legacy IELTS snapshot use taskId rather than
		// questionId. Treat that stable task identifier as the V2 response key
		// so snapshot-backed writing remains writable during the migration drain.
		for _, key := range []string{"id", "questionId", "questionID", "taskId", "taskID"} {
			if id, ok := node[key].(string); ok && id == questionID {
				return true
			}
		}
		for _, child := range node {
			if snapshotContainsQuestion(child, questionID) {
				return true
			}
		}
	case []any:
		for _, child := range node {
			if snapshotContainsQuestion(child, questionID) {
				return true
			}
		}
	}
	return false
}

// v2Locker locks the exam runtime + active section after the attempt.
// A missing runtime row is an open gate (schedules without a runtime yet).
type v2Locker struct{}

var _ attempts.RuntimeLocker = v2Locker{}

func (v2Locker) Lock(ctx context.Context, q tx.Tx, scheduleID string) (attempts.RuntimeGate, error) {
	var gate attempts.RuntimeGate
	var id string
	var status sql.NullString
	var active sql.NullString
	var waiting sql.NullBool
	err := q.QueryRowContext(ctx, `SELECT id, status, active_section_key, waiting_for_next_section FROM exam_session_runtimes WHERE schedule_id = ? FOR UPDATE`, scheduleID).Scan(&id, &status, &active, &waiting)
	now, terr := dbNow(ctx, q)
	if terr != nil {
		return attempts.RuntimeGate{}, terr
	}
	if err == sql.ErrNoRows {
		return attempts.RuntimeGate{Status: "live", ActiveSectionKey: "*", SectionLive: true, SectionStarted: true, Now: now}, nil
	}
	if err != nil {
		return attempts.RuntimeGate{}, err
	}
	gate.Now = now
	if status.Valid {
		gate.Status = status.String
	}
	if waiting.Valid {
		gate.WaitingForNextSection = waiting.Bool
	}
	gate.ActiveSectionKey = "*"
	if active.Valid && active.String != "" {
		gate.ActiveSectionKey = active.String
	}
	if active.Valid && active.String != "" {
		var secStatus sql.NullString
		serr := q.QueryRowContext(ctx, `SELECT status FROM exam_session_runtime_sections WHERE runtime_id = ? AND section_key = ? FOR UPDATE`, id, active.String).Scan(&secStatus)
		if serr != nil && serr != sql.ErrNoRows {
			return attempts.RuntimeGate{}, serr
		}
		if serr == nil && secStatus.Valid {
			gate.SectionStarted = true
			switch secStatus.String {
			case "live":
				gate.SectionLive = true
			case "paused":
				gate.SectionPaused = true
			}
		}
	} else {
		gate.SectionLive = true
		gate.SectionStarted = true
	}
	return gate, nil
}

func dbNow(ctx context.Context, q tx.Tx) (time.Time, error) {
	var t time.Time
	if err := q.QueryRowContext(ctx, `SELECT UTC_TIMESTAMP(6)`).Scan(&t); err != nil {
		return time.Time{}, err
	}
	return t.UTC(), nil
}

// terminalSealer implements attempts.Sealer with direct in-tx SQL mirroring
// the terminalization submitted claim. It must run inside the caller's tx
// (a separate Terminalize tx would deadlock on the locked attempt row).
type terminalSealer struct {
	scorer       terminalization.AttemptScorer
	materializer *terminalization.Service
	// outboxExecOnly skips the wakeup attempt_terminalized INSERT (B4.1).
	outboxExecOnly bool
}

var _ attempts.Sealer = terminalSealer{}

func (s terminalSealer) SealSubmitted(ctx context.Context, q tx.Tx, attemptID, scheduleID, submissionID, digest, provider, actorID string, effectiveAt time.Time) error {
	var existing string
	err := q.QueryRowContext(ctx, `SELECT outcome FROM attempt_terminalizations WHERE attempt_id = ? FOR UPDATE`, attemptID).Scan(&existing)
	switch {
	case err == nil:
		if existing == terminalization.OutcomeSubmitted {
			return nil
		}
		return apperrors.New(apperrors.CodeTerminalConflict, "Attempt is already terminalized.")
	case err != sql.ErrNoRows:
		return err
	}
	var answerRev int64
	var revision int64
	var org sql.NullString
	if err := q.QueryRowContext(ctx, `SELECT answer_revision, revision, organization_id FROM student_attempts WHERE id = ?`, attemptID).Scan(&answerRev, &revision, &org); err != nil {
		return err
	}
	eff := effectiveAt.UTC()
	tid := uuid.NewString()
	reqID := submissionID
	if _, perr := uuid.Parse(reqID); perr != nil {
		reqID = uuid.NewString()
	}
	snapshotFields := map[string]any{"attemptId": attemptID, "scheduleId": scheduleID, "digest": digest, "submissionId": submissionID}
	if provider == "act" && s.scorer != nil {
		var answers []byte
		var versionID string
		if err := q.QueryRowContext(ctx, `SELECT answers, published_version_id FROM student_attempts WHERE id = ? FOR UPDATE`, attemptID).Scan(&answers, &versionID); err != nil {
			return err
		}
		fields, err := s.scorer.ScoreAttempt(ctx, q, attemptID, versionID, json.RawMessage(answers))
		if err != nil {
			return err
		}
		for key, value := range fields {
			snapshotFields[key] = value
		}
		if detailed, ok := s.scorer.(terminalization.DetailedAttemptScorer); ok {
			details, err := detailed.ScoreAttemptDetails(ctx, q, attemptID, versionID, json.RawMessage(answers))
			if err != nil {
				return err
			}
			for key, value := range details {
				snapshotFields[key] = value
			}
			for _, key := range []string{"score", "providerKey", "section"} {
				if value, present := details[key]; present {
					fields[key] = value
				}
			}
		}
	}
	snap, _ := json.Marshal(snapshotFields)
	var orgArg any
	if org.Valid {
		orgArg = org.String
	}
	var actorArg any
	if actorID != "" {
		actorArg = actorID
	}
	const ins = `INSERT INTO attempt_terminalizations (attempt_id, organization_id, terminalization_id, schedule_id, outcome, reason, actor_kind, actor_id, effective_at, recorded_at, answer_revision, final_snapshot, request_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(6), ?, ?, ?)`
	if _, err := q.ExecContext(ctx, ins, attemptID, orgArg, tid, scheduleID, terminalization.OutcomeSubmitted, terminalization.ReasonStudentSubmit, terminalization.ActorStudent, actorArg, eff, answerRev, string(snap), reqID); err != nil {
		return err
	}
	projectionFields := map[string]any{"terminalizationId": tid, "attemptId": attemptID, "scheduleId": scheduleID, "outcome": terminalization.OutcomeSubmitted, "reason": terminalization.ReasonStudentSubmit, "digest": digest, "submissionId": submissionID, "effectiveAt": eff}
	for key, value := range snapshotFields {
		if key == "score" || key == "providerKey" || key == "section" {
			projectionFields[key] = value
		}
	}
	proj, _ := json.Marshal(projectionFields)
	const claim = `UPDATE student_attempts SET phase = 'post-exam', delivery_status = 'submitted', final_submission = ?, submitted_at = COALESCE(submitted_at, ?), updated_at = UTC_TIMESTAMP(6), revision = revision + 1, control_epoch = control_epoch + 1 WHERE id = ? AND schedule_id = ? AND ((submitted_at IS NULL AND phase <> 'post-exam') OR (delivery_status = 'submitted' AND phase = 'post-exam' AND final_submission IS NULL)) AND COALESCE(proctor_status, 'active') <> 'terminated'`
	res, err := q.ExecContext(ctx, claim, string(proj), eff, attemptID, scheduleID)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n != 1 {
		return apperrors.New(apperrors.CodeConflict, "Attempt is blocked by proctor termination.")
	}
	if s.materializer != nil {
		if err := s.materializer.MaterializeProviderResultInTx(ctx, q, attemptID, provider, terminalization.OutcomeSubmitted, terminalization.ReasonStudentSubmit, terminalization.ActorStudent, tid, eff, json.RawMessage(snap), json.RawMessage(proj)); err != nil {
			return err
		}
	}
	// B4.1: exec-only mode skips the wakeup INSERT (live moves to Hub in C).
	if s.outboxExecOnly {
		return nil
	}
	payload, _ := json.Marshal(map[string]any{"terminalizationId": tid, "attemptId": attemptID, "scheduleId": scheduleID, "outcome": terminalization.OutcomeSubmitted, "reason": terminalization.ReasonStudentSubmit, "answerRevision": answerRev})
	return outbox.EnqueueInTx(ctx, q, "attempt_terminalization", attemptID, revision+1, "attempt_terminalized", json.RawMessage(payload))
}

func requireBearer(w http.ResponseWriter, r *http.Request) (string, bool) {
	b := bearerOf(r)
	if b == "" {
		httpx.WriteError(w, r, apperrors.New(apperrors.CodeAttemptTokenInvalid, "Attempt credential is required."))
		return "", false
	}
	return b, true
}

func v2BatchHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		bearer, ok := requireBearer(w, r)
		if !ok {
			return
		}
		var body struct {
			LeaseEpoch   uint64                     `json:"leaseEpoch"`
			ControlEpoch uint64                     `json:"controlEpoch"`
			Commands     []attempts.ResponseCommand `json:"commands"`
		}
		if err := httpx.DecodeLimited(r, httpx.MaxStudentBodyBytes, &body); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if app.Attempts == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Attempt service is unavailable."))
			return
		}
		// B2: locker routes via RUNTIME_SNAPSHOT (snapshot pre-gate when on,
		// today's FOR UPDATE path when off). Rollback = off.
		res, err := app.Attempts.SaveResponses(r.Context(), bearer, attempts.SaveResponsesCommand{AttemptID: chi.URLParam(r, "attemptID"), LeaseEpoch: body.LeaseEpoch, ControlEpoch: body.ControlEpoch, Commands: body.Commands}, v2Resolver{}, app.RuntimeLockerFor())
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]any{
			"attemptRevision":  res.ResponseRevision,
			"serverTime":       res.ServerTime,
			"acknowledgements": res.Acks,
		})
	}
}

func v2SubmitHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		bearer, ok := requireBearer(w, r)
		if !ok {
			return
		}
		var body struct {
			SubmissionID            string                     `json:"submissionId"`
			LeaseEpoch              uint64                     `json:"leaseEpoch"`
			ControlEpoch            uint64                     `json:"controlEpoch"`
			FinalCommands           []attempts.ResponseCommand `json:"finalCommands"`
			ExpectedAttemptRevision uint64                     `json:"expectedAttemptRevision"`
		}
		if err := httpx.DecodeLimited(r, httpx.MaxStudentBodyBytes, &body); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		attemptID := chi.URLParam(r, "attemptID")
		provider := scheduleProvider(r.Context(), app, attemptID)
		if app.Attempts == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Attempt service is unavailable."))
			return
		}
		cmd := attempts.SubmitCommand{AttemptID: attemptID, LeaseEpoch: body.LeaseEpoch, ExpectedControlEpoch: body.ControlEpoch, SubmissionID: body.SubmissionID, FinalCommands: body.FinalCommands, ActorKind: "student"}
		if body.ExpectedAttemptRevision > 0 {
			v := body.ExpectedAttemptRevision
			cmd.ExpectedRevision = &v
		}
		res, err := app.Attempts.Submit(r.Context(), bearer, cmd, v2Resolver{}, app.RuntimeLockerFor(), attempts.Provider(provider), terminalSealer{scorer: app.ACT, materializer: app.Terminal, outboxExecOnly: app.Config.OutboxExecOnly})
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		out, err := loadV2SubmitResponse(r.Context(), app.DB, attemptID, res, body.FinalCommands)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

// loadV2SubmitResponse adapts the provider-neutral submit receipt to the
// frontend durability contract. SAT deliberately returns a provisional
// receipt here; its provider completion endpoint scores and seals later after
// all module attempts are submitted.
func loadV2SubmitResponse(ctx context.Context, db *sql.DB, attemptID string, result attempts.SubmitResult, finalCommands []attempts.ResponseCommand) (map[string]any, error) {
	if db == nil {
		return nil, apperrors.New(apperrors.CodeServiceUnavailable, "Database not configured.")
	}
	var status string
	var attemptRevision uint64
	var digest sql.NullString
	var submittedAt sql.NullTime
	if err := db.QueryRowContext(ctx, `SELECT COALESCE(delivery_status, 'running'), response_revision, final_response_digest, submitted_at FROM student_attempts WHERE id = ?`, attemptID).Scan(&status, &attemptRevision, &digest, &submittedAt); err != nil {
		if err == sql.ErrNoRows {
			return nil, apperrors.New(apperrors.CodeNotFound, "Attempt not found.")
		}
		return nil, err
	}
	writeIDs := make([]string, 0, len(finalCommands))
	for _, command := range finalCommands {
		writeIDs = append(writeIDs, command.WriteID)
	}
	acks, err := loadV2Acknowledgements(ctx, db, attemptID, writeIDs)
	if err != nil {
		return nil, err
	}
	if !digest.Valid {
		digest.String = result.FinalDigest
	}
	var submitted any
	if submittedAt.Valid {
		submitted = submittedAt.Time.UTC()
	}
	return map[string]any{
		"attemptId":           attemptID,
		"submissionId":        result.SubmissionID,
		"status":              status,
		"attemptRevision":     attemptRevision,
		"finalResponseDigest": digest.String,
		"submittedAt":         submitted,
		"acknowledgements":    acks,
	}, nil
}

func loadV2Acknowledgements(ctx context.Context, db *sql.DB, attemptID string, writeIDs []string) ([]attempts.Ack, error) {
	acks := make([]attempts.Ack, 0, len(writeIDs))
	for _, writeID := range writeIDs {
		var ack attempts.Ack
		var raw string
		if err := db.QueryRowContext(ctx, `SELECT client_write_id, question_id, client_version, outcome, server_revision, response_hash, CAST(canonical_response AS CHAR) FROM attempt_mutations_v2 WHERE attempt_id = ? AND client_write_id = ?`, attemptID, writeID).Scan(&ack.WriteID, &ack.QuestionID, &ack.ClientVersion, &ack.Outcome, &ack.ServerRevision, &ack.ContentHash, &raw); err != nil {
			if err == sql.ErrNoRows {
				continue
			}
			return nil, err
		}
		if err := json.Unmarshal([]byte(raw), &ack.CanonicalResponse); err != nil {
			return nil, err
		}
		if ack.CanonicalResponse.EliminatedOptions == nil {
			ack.CanonicalResponse.EliminatedOptions = []string{}
		}
		if ack.CanonicalResponse.Annotations == nil {
			ack.CanonicalResponse.Annotations = []attempts.Annotation{}
		}
		acks = append(acks, ack)
	}
	return acks, nil
}

// scheduleProvider resolves the V2 submit provider for an attempt via the
// central effective-provider rule: legacy ACT rows (provider_key='ielts',
// exam_type='ACT') route to the ACT direct-seal path, never the IELTS path
// (Phase 02 blocker 4). Unknown/unreadable rows fail closed to IELTS — the
// pre-existing default — so the submit preamble never misroutes on DB
// uncertainty.
func scheduleProvider(ctx context.Context, app *App, attemptID string) string {
	if app.DB == nil {
		return string(attempts.ProviderIELTS)
	}
	var provider, examType sql.NullString
	if err := app.DB.QueryRowContext(ctx, `SELECT e.provider_key, e.exam_type FROM student_attempts a JOIN exam_entities e ON e.id = a.exam_id WHERE a.id = ?`, attemptID).Scan(&provider, &examType); err != nil || !provider.Valid || provider.String == "" {
		return string(attempts.ProviderIELTS)
	}
	return effectiveProviderForSubmit(provider.String, examType.String)
}

// effectiveProviderForSubmit mirrors exams.EffectiveProviderKey without
// importing the exams package at the HTTP edge (cmd/api already depends on
// it transitively; the local mirror keeps the submit preamble dependency
// surface minimal and is pinned by TestScheduleProviderHealsLegacyACT).
func effectiveProviderForSubmit(providerKey, examType string) string {
	if strings.EqualFold(strings.TrimSpace(examType), "ACT") {
		return string(attempts.ProviderACT)
	}
	p := strings.ToLower(strings.TrimSpace(providerKey))
	if p == "" {
		return string(attempts.ProviderIELTS)
	}
	return p
}

func v2TakeoverHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		bearer, ok := requireBearer(w, r)
		if !ok {
			return
		}
		var body struct {
			ClientSessionID string `json:"clientSessionId"`
			Reason          string `json:"reason"`
		}
		if err := httpx.DecodeLimited(r, httpx.MaxStudentBodyBytes, &body); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if app.Attempts == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Attempt service is unavailable."))
			return
		}
		res, err := app.Attempts.Takeover(r.Context(), bearer, chi.URLParam(r, "attemptID"), body.ClientSessionID, body.Reason)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, res)
	}
}

func v2SnapshotHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		bearer, ok := requireBearer(w, r)
		if !ok {
			return
		}
		attemptID := chi.URLParam(r, "attemptID")
		// Snapshot must bind the bearer to the server session row (revoked
		// or rotated tokens fail closed) and to THIS attempt ID: a bare
		// crypto.VerifyAttemptToken check would accept any valid token.
		// Reads have no in-tx fence, so the session-bound read verify runs
		// in BOTH verify modes (terminated-bearer and post-takeover replays
		// render 401 even when ATTEMPT_VERIFY=stateless).
		claims, verr := verifyAttemptReadBearer(app, r, bearer)
		if verr != nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeAttemptTokenInvalid, "Invalid attempt credential."))
			return
		}
		if claims.AttemptID != attemptID {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeAttemptTokenInvalid, "Attempt credential mismatch."))
			return
		}
		if app.DB == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Database not configured."))
			return
		}
		var (
			proto, lease, control     sql.NullInt64
			delivery, schedID, userID sql.NullString
			respRev                   sql.NullInt64
			deadline, grace           sql.NullTime
		)
		err := app.DB.QueryRowContext(r.Context(), `SELECT protocol_version, delivery_status, lease_epoch, control_epoch, response_revision, deadline_at, closing_grace_until, schedule_id, user_id FROM student_attempts WHERE id = ?`, attemptID).Scan(&proto, &delivery, &lease, &control, &respRev, &deadline, &grace, &schedID, &userID)
		if err == sql.ErrNoRows {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeNotFound, "Attempt not found."))
			return
		}
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		rows, err := app.DB.QueryContext(r.Context(), `SELECT question_id, client_write_id, client_version, server_revision, response_hash, CAST(response AS CHAR) FROM attempt_responses_v2 WHERE attempt_id = ? ORDER BY question_id`, attemptID)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		defer rows.Close()
		type snapRow struct {
			WriteID           string         `json:"writeId"`
			QuestionID        string         `json:"questionId"`
			ClientVersion     uint64         `json:"clientVersion"`
			Outcome           string         `json:"outcome"`
			ServerRevision    uint64         `json:"serverRevision"`
			Replayed          bool           `json:"replayed"`
			ContentHash       string         `json:"contentHash"`
			CanonicalResponse map[string]any `json:"canonicalResponse"`
		}
		resp := []snapRow{}
		for rows.Next() {
			var qid, writeID string
			var cv, rev uint64
			var hash string
			var raw string
			if err := rows.Scan(&qid, &writeID, &cv, &rev, &hash, &raw); err != nil {
				httpx.WriteError(w, r, err)
				return
			}
			var canon map[string]any
			if err := json.Unmarshal([]byte(raw), &canon); err != nil {
				httpx.WriteError(w, r, err)
				return
			}
			if canon["eliminatedOptions"] == nil {
				canon["eliminatedOptions"] = []string{}
			}
			if canon["annotations"] == nil {
				canon["annotations"] = []any{}
			}
			resp = append(resp, snapRow{WriteID: writeID, QuestionID: qid, ClientVersion: cv, Outcome: "applied", ServerRevision: rev, Replayed: true, ContentHash: hash, CanonicalResponse: canon})
		}
		if err := rows.Err(); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		out := map[string]any{"attemptId": attemptID, "protocolVersion": proto.Int64, "deliveryStatus": delivery.String, "leaseEpoch": lease.Int64, "controlEpoch": control.Int64, "attemptRevision": respRev.Int64, "deadlineAt": nil, "closingGraceUntil": nil, "responses": resp}
		if deadline.Valid {
			out["deadlineAt"] = deadline.Time.UTC()
		}
		if grace.Valid {
			out["closingGraceUntil"] = grace.Time.UTC()
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

// studentEntryRateLimiter bounds anonymous entry creation per email+IP
// (unauthenticated minting of users/registrations/attempts+tokens must not
// be unbounded). Local-only inner gate: the anon-auth tier middleware adds
// the single distributed verdict on top, so entry still produces exactly
// one distributed-counter write per request.
var studentEntryRateLimiter = httpx.NewBucketStore(10000)

// studentEntryBucket allows 30 entry attempts per minute per email+IP key.
func studentEntryBucket(key string) httpx.RateLimitResult {
	return studentEntryRateLimiter.Allow(httpx.RateLimitConfig{MaxRequests: 30, Window: time.Minute, Tier: "student-entry"}, key)
}

// isStudentEntryAccountAllowed gates entry on account state only: any ACTIVE
// account may check in once the schedule/code gate passes. Link-backed entry
// still verifies its link lifecycle and window through ResolveEntry.
// Disabled / locked / pending_activation stay blocked; the role never
// gates. The passwordless entry flow only ever mints a student-scoped
// session (see studentEntryHandler), so allowing staff emails here grants
// exam access, never staff privileges.
func isStudentEntryAccountAllowed(role, state string) bool {
	_ = role
	return state == "active"
}

// studentEntryNotFound is the 404-collapse envelope for student entry:
// unknown/closed schedules and unknown/expired/paused links render
// identically so probes cannot distinguish them (same message as the
// proctor live-assignment miss).
func studentEntryNotFound() error {
	return apperrors.New(apperrors.CodeNotFound, "Resource not found.")
}

// verifyDirectEntry keeps the legacy direct schedule entry flow open. The
// candidate code is an identifier for the attempt, not an invitation or
// roster credential: every non-empty format is accepted. The schedule is
// checked before user/registration/attempt minting so an unknown or closed
// schedule cannot create a student account as a side effect.
func verifyDirectEntry(ctx context.Context, app *App, scheduleID, wcode string) error {
	scheduleID = strings.TrimSpace(scheduleID)
	code := schedules.NormalizeAccessCode(wcode)
	if code == "" || scheduleID == "" {
		return studentEntryNotFound()
	}
	if app == nil || app.DB == nil {
		return apperrors.New(apperrors.CodeServiceUnavailable, "Entry service is unavailable.")
	}
	var status string
	if err := app.DB.QueryRowContext(ctx, `SELECT status FROM exam_schedules WHERE id = ?`, scheduleID).Scan(&status); err != nil {
		if err == sql.ErrNoRows {
			return studentEntryNotFound()
		}
		return MapDBError(err)
	}
	if status == "scheduled" || status == "live" {
		return nil
	}
	return studentEntryNotFound()
}

func studentEntryHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Wcode        string  `json:"wcode"`
			Email        string  `json:"email"`
			StudentName  string  `json:"studentName"`
			ScheduleID   string  `json:"scheduleId"`
			AccessLinkID string  `json:"accessLinkId"`
			AccessCode   string  `json:"accessCode"`
			LinkToken    string  `json:"linkToken"`
			CaptchaToken string  `json:"captchaToken"`
			EntrySession string  `json:"entrySession"`
			Nickname     *string `json:"nickname"`
			IELTSCourse  *string `json:"ieltsCourse"`
		}
		if err := httpx.DecodeLimited(r, httpx.MaxAdminBodyBytes, &body); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if (strings.TrimSpace(body.Wcode) == "" && strings.TrimSpace(body.AccessLinkID) == "") || strings.TrimSpace(body.Email) == "" || strings.TrimSpace(body.StudentName) == "" {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeBadRequest, "Code, email and student name are required."))
			return
		}
		// Round 64 fail-fast: malformed email 400s here, before link
		// resolution + rate-limit buckets + user lookup (no DB burned
		// on a shape the registration gate would reject anyway).
		if verr := schedules.ValidateEmail(body.Email); verr != nil {
			httpx.WriteError(w, r, verr)
			return
		}
		// Direct schedule entry keeps the existing `/student/:scheduleId`
		// flow: the code is a free-form attempt identifier. Link-backed entry
		// remains separately gated by the selected link's lifecycle/window.
		scheduleID := strings.TrimSpace(body.ScheduleID)
		linkID := strings.TrimSpace(body.AccessLinkID)
		var linkMode string
		if linkID != "" {
			if app.AccessLinks == nil {
				httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Access-links service is unavailable."))
				return
			}
			resolved, err := app.AccessLinks.ResolveEntry(r.Context(), linkID, body.Wcode, body.StudentName, body.Email)
			if err != nil {
				// 404-collapse: wrong code, unknown/expired/paused link,
				// and identity mismatch render identically (never
				// propagate the underlying reason — it oracles link
				// roster state). The pre-existing ModeStudentCode
				// empty-code 400 below stays (client-visible shape).
				httpx.WriteError(w, r, studentEntryNotFound())
				return
			}
			scheduleID = resolved.ScheduleID
			linkMode = string(resolved.AccessMode)
			if linkMode == string(accesslinks.ModeStudentCode) && strings.TrimSpace(body.Wcode) == "" {
				httpx.WriteError(w, r, apperrors.New(apperrors.CodeBadRequest, "Student code is required for this Student Link."))
				return
			}
		}
		if scheduleID == "" {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeBadRequest, "Schedule is required."))
			return
		}
		if app.DB == nil || app.Schedules == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Entry service is unavailable."))
			return
		}
		// Per-email+IP rate limit for anonymous entry (30/min per key,
		// mirroring the Rust per-IP/per-schedule student-entry tiers).
		entryKey := "entry:" + strings.ToLower(strings.TrimSpace(body.Email)) + "|" + httpx.ClientIPKey(r)
		if res := studentEntryBucket(entryKey); !res.Allowed {
			httpx.WriteRateLimitExceeded(w, r, "student-entry", "ip", res.RetryAfter)
			return
		}
		// Plan D3: per-schedule check-in bucket (ENTRY_GATE=on). Over-limit
		// check-ins get a bounded 429 + Retry-After instead of a DB conflict
		// storm on the schedule row. Off (default) = skipped.
		if app.Config.EntryGateEnabled && app.EntryGate != nil && scheduleID != "" {
			if gres := app.EntryGate.Allow(scheduleID, time.Now().UTC()); !gres.Allowed {
				httpx.WriteRateLimitExceeded(w, r, "student-entry", "schedule", time.Duration(gres.RetryAfterSecs)*time.Second)
				return
			}
		}
		// Direct entry only verifies that the schedule is open and the code is
		// non-empty before minting. The code is intentionally not checked
		// against a roster or access link; this restores the original
		// copy-link-and-check-in flow. Link-backed entry was already verified
		// above via ResolveEntry.
		if linkID == "" {
			if verr := verifyDirectEntry(r.Context(), app, scheduleID, body.Wcode); verr != nil {
				httpx.WriteError(w, r, verr)
				return
			}
		}
		// Case-insensitive email lookup + normalization (mirrors login's
		// TrimSpace+ToLower): without it `ALICE@x` and `alice@x` mint
		// duplicate user rows and the second INSERT 500s.
		email := strings.ToLower(strings.TrimSpace(body.Email))
		var userID, role, state, displayName string
		err := app.DB.QueryRowContext(r.Context(), `SELECT id, role, state, COALESCE(display_name, '') FROM users WHERE LOWER(email) = ?`, email).Scan(&userID, &role, &state, &displayName)
		if err == sql.ErrNoRows {
			userID = uuid.NewString()
			if _, err := app.DB.ExecContext(r.Context(), `INSERT INTO users (id, email, display_name, role, state) VALUES (?, ?, ?, 'student', 'active')`, userID, email, strings.TrimSpace(body.StudentName)); err != nil {
				// Round 159: unguarded user-mint is a bare-cancel 500 source
				// (r159: 91 x bare `context canceled` after all auth sites
				// mapped) — client-gone maps to retryable 503.
				httpx.WriteError(w, r, MapDBError(err))
				return
			}
			role, state, displayName = auth.RoleStudent, "active", strings.TrimSpace(body.StudentName)
		} else if err != nil {
			httpx.WriteError(w, r, MapDBError(err))
			return
		}
		if !isStudentEntryAccountAllowed(role, state) {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeUnauthorized, "Student account is not available."))
			return
		}
		if strings.TrimSpace(displayName) == "" {
			displayName = strings.TrimSpace(body.StudentName)
		}
		wcode := schedules.NormalizeAccessCode(body.Wcode)
		if wcode == "" {
			if linkID == "" {
				// Closed-by-default: empty codes on direct entry never
				// mint. Unreachable in practice (the presence check
				// 400s and verifyDirectEntry 404-collapses
				// first) — fail closed, never synthesize a key.
				httpx.WriteError(w, r, studentEntryNotFound())
				return
			}
			// Open links still need a stable registration key so retries for the
			// same browser/user replay the existing attempt instead of minting a
			// second registration. Reachable only via the ResolveEntry-verified
			// link branch (ModeOpen links admit without a per-student code).
			wcode = "OPEN-" + strings.ToUpper(strings.ReplaceAll(userID, "-", ""))
		}
		reg, err := app.Schedules.CreateRegistration(r.Context(), scheduleID, schedules.RegistrationRequest{Wcode: wcode, Email: email, StudentName: body.StudentName, Nickname: body.Nickname, IELTSCourse: body.IELTSCourse, UserID: userID})
		if err != nil {
			// Round 153: a client gone inside the mint tx returns bare
			// context-canceled (never wrapped) — map to retryable 503
			// at the boundary instead of unknown-500 (E1 honesty).
			httpx.WriteError(w, r, MapDBError(err))
			return
		}
		clientSessionID := uuid.NewString()
		// Plan D3 unique-key-first fast path: pre-provisioned attempts (or
		// check-in retries that already minted one) skip the mint tx
		// entirely — 1 unlocked SELECT. Misses fall through to the mint tx
		// whose registration lock + replay stays the correctness backstop.
		att, err := app.fastPathAttempt(r.Context(), scheduleID, reg.ID)
		if err != nil {
			httpx.WriteError(w, r, MapDBError(err))
			return
		}
		if att == nil {
			minted, merr := app.Schedules.CreateScheduleAttempt(r.Context(), scheduleID, reg.ID, reg.StudentKey, wcode, strings.TrimSpace(body.StudentName), email, clientSessionID)
			if merr != nil {
				httpx.WriteError(w, r, MapDBError(merr))
				return
			}
			att = &minted
		}
		now := time.Now().UTC()
		lease := uint64(1)
		token, attemptExpiresAt, err := auth.IssueAttemptToken(r.Context(), app.DB, app.Config, userID, scheduleID, att.AttemptID, clientSessionID, nil, &lease, now)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		_, sessionToken, csrfToken, err := auth.CreateSession(r.Context(), app.DB, app.Config, userID, auth.RoleStudent, nil, nil, now)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		setSessionCookies(w, app, sessionToken, csrfToken)
		sessionExpiresAt, idleTimeoutAt := auth.SessionExpiry(app.Config, auth.RoleStudent, now)
		httpx.WriteJSON(w, http.StatusOK, map[string]any{
			"user":             map[string]any{"id": userID, "email": email, "displayName": displayName, "role": auth.RoleStudent, "state": "active"},
			"csrfToken":        csrfToken,
			"expiresAt":        sessionExpiresAt,
			"idleTimeoutAt":    idleTimeoutAt,
			"scheduleId":       scheduleID,
			"studentCode":      wcode,
			"attemptToken":     token,
			"attemptId":        att.AttemptID,
			"attemptExpiresAt": attemptExpiresAt.UTC(),
		})
	}
}

// studentEntryScheduleHandler exposes only the schedule metadata needed to
// render the public check-in form. It deliberately does not require a
// session: the registration POST is the operation that establishes the
// student's authenticated session.
func studentEntryScheduleHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if app.Schedules == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Schedule service is unavailable."))
			return
		}
		out, err := app.Schedules.Get(r.Context(), chi.URLParam(r, "id"))
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}
