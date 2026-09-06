// Package answerhistory serves read-only answer-history projections.
//
// It mirrors backend/crates/application/src/answer_history.rs read surface:
// resolve the submission for an attempt, load the submission+attempt context,
// replay V1 mutation rows (student_attempt_mutations) into per-target
// overviews/details, and export a target as JSON or CSV. All results are
// returned as json.RawMessage projections: the Go API owns no answer-history
// domain objects, only the wire contract (plan section 5: share the wire
// contract through generated API schemas, never Go domain objects).
//
// Reads are plain pool queries (no transactions): nothing here mutates, so
// there is no lock ordering and no retry beyond the driver's. Missing rows
// surface NOT_FOUND; malformed caller input surfaces VALIDATION_ERROR.
package answerhistory

import (
	"context"
	"database/sql"
	"encoding/json"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"fmt"
	"sort"
	"strings"
	"time"
)

// Target types carried on the wire (snake_case, matching the Rust enum).
const (
	TargetObjective = "objective"
	TargetWriting   = "writing"
)

// Export formats carried on the wire (snake_case, matching the Rust enum).
const (
	FormatJSON = "json"
	FormatCSV  = "csv"
)

func validationError(msg string) error {
	return &apperrors.Error{Code: apperrors.CodeBadRequest, Message: msg, HTTPStatus: 400}
}

func notFoundError() error {
	return apperrors.New(apperrors.CodeNotFound, "Answer history not found.")
}

// Service wires answer-history reads explicitly.
type Service struct {
	db *sql.DB
}

// NewService wires dependencies explicitly.
func NewService(db *sql.DB) *Service {
	return &Service{db: db}
}

// contextRow is the submission+attempt join every projection starts from.
type contextRow struct {
	SubmissionID    sql.NullString
	AttemptID       string
	ScheduleID      string
	ExamID          string
	ExamTitle       string
	ContentSnapshot json.RawMessage
	ConfigSnapshot  json.RawMessage
	Answers         json.RawMessage
	WritingAnswers  json.RawMessage
	FinalSubmission json.RawMessage
	FinalValid      bool
	CandidateID     string
	CandidateName   string
	CandidateEmail  string
	StartedAt       time.Time
	SubmittedAt     sql.NullTime
}

// mutationRow is one student_attempt_mutations row in replay order.
type mutationRow struct {
	ID               string
	MutationType     string
	MutationSeq      int64
	Payload          json.RawMessage
	ClientTimestamp  time.Time
	ServerReceivedAt time.Time
	AppliedRevision  sql.NullInt64
}

func scanContext(row *sql.Row) (contextRow, error) {
	var c contextRow
	var content, config, answers, writing []byte
	var finalSub sql.NullString
	var submitted sql.NullTime
	var started sql.NullTime
	err := row.Scan(
		&c.SubmissionID, &c.AttemptID, &c.ScheduleID, &c.ExamID, &c.ExamTitle,
		&content, &config, &answers, &writing, &finalSub,
		&c.CandidateID, &c.CandidateName, &c.CandidateEmail,
		&started, &submitted,
	)
	if err != nil {
		return c, err
	}
	c.ContentSnapshot = append(json.RawMessage(nil), content...)
	c.ConfigSnapshot = append(json.RawMessage(nil), config...)
	c.Answers = append(json.RawMessage(nil), answers...)
	c.WritingAnswers = append(json.RawMessage(nil), writing...)
	if finalSub.Valid && strings.TrimSpace(finalSub.String) != "" && finalSub.String != "null" {
		c.FinalSubmission = json.RawMessage(finalSub.String)
		c.FinalValid = true
	}
	if started.Valid {
		c.StartedAt = started.Time.UTC()
	}
	c.SubmittedAt = submitted
	return c, nil
}

// ResolveSubmissionIDFromAttempt maps an attempt to its submission id.
func (s *Service) ResolveSubmissionIDFromAttempt(ctx context.Context, attemptID string) (string, error) {
	if strings.TrimSpace(attemptID) == "" {
		return "", validationError("Attempt id is required.")
	}
	var id sql.NullString
	err := s.db.QueryRowContext(ctx, "SELECT id FROM student_submissions WHERE attempt_id = ? LIMIT 1", attemptID).Scan(&id)
	if err == sql.ErrNoRows || !id.Valid {
		return "", notFoundError()
	}
	if err != nil {
		return "", err
	}
	return id.String, nil
}

func (s *Service) loadContext(ctx context.Context, submissionID string) (contextRow, error) {
	var zero contextRow
	if strings.TrimSpace(submissionID) == "" {
		return zero, validationError("Submission id is required.")
	}
	row := s.db.QueryRowContext(ctx, "SELECT submissions.id AS submission_id, submissions.attempt_id AS attempt_id, submissions.schedule_id AS schedule_id, submissions.exam_id AS exam_id, submissions.cohort_name AS exam_title, versions.content_snapshot AS content_snapshot, versions.config_snapshot AS config_snapshot, attempts.answers AS answers, attempts.writing_answers AS writing_answers, attempts.final_submission AS final_submission, attempts.candidate_id AS candidate_id, attempts.candidate_name AS candidate_name, attempts.candidate_email AS candidate_email, attempts.created_at AS started_at, submissions.submitted_at AS submitted_at FROM student_submissions submissions JOIN student_attempts attempts ON attempts.id = submissions.attempt_id JOIN exam_versions versions ON versions.id = submissions.published_version_id WHERE submissions.id = ? LIMIT 1", submissionID)
	c, err := scanContext(row)
	if err == sql.ErrNoRows {
		return zero, notFoundError()
	}
	return c, err
}

func (s *Service) loadContextByAttempt(ctx context.Context, attemptID string) (contextRow, error) {
	var zero contextRow
	if strings.TrimSpace(attemptID) == "" {
		return zero, validationError("Attempt id is required.")
	}
	row := s.db.QueryRowContext(ctx, "SELECT NULL AS submission_id, attempts.id AS attempt_id, attempts.schedule_id AS schedule_id, attempts.exam_id AS exam_id, attempts.exam_title AS exam_title, versions.content_snapshot AS content_snapshot, versions.config_snapshot AS config_snapshot, attempts.answers AS answers, attempts.writing_answers AS writing_answers, attempts.final_submission AS final_submission, attempts.candidate_id AS candidate_id, attempts.candidate_name AS candidate_name, attempts.candidate_email AS candidate_email, attempts.created_at AS started_at, attempts.submitted_at AS submitted_at FROM student_attempts attempts JOIN exam_versions versions ON versions.id = attempts.published_version_id WHERE attempts.id = ? LIMIT 1", attemptID)
	c, err := scanContext(row)
	if err == sql.ErrNoRows {
		return zero, notFoundError()
	}
	return c, err
}

func (s *Service) loadMutations(ctx context.Context, attemptID string) ([]mutationRow, error) {
	rows, err := s.db.QueryContext(ctx, "SELECT id, mutation_type, mutation_seq, payload, client_timestamp, server_received_at, applied_revision FROM student_attempt_mutations WHERE attempt_id = ? ORDER BY server_received_at ASC, mutation_seq ASC, id ASC", attemptID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []mutationRow
	for rows.Next() {
		var m mutationRow
		var payload []byte
		if err := rows.Scan(&m.ID, &m.MutationType, &m.MutationSeq, &payload, &m.ClientTimestamp, &m.ServerReceivedAt, &m.AppliedRevision); err != nil {
			return nil, err
		}
		m.Payload = append(json.RawMessage(nil), payload...)
		m.ClientTimestamp = m.ClientTimestamp.UTC()
		m.ServerReceivedAt = m.ServerReceivedAt.UTC()
		out = append(out, m)
	}
	return out, rows.Err()
}

// resolveHistoryAttemptID prefers the context attempt when it carries
// mutations, else falls back to the nearest sibling attempt in the same
// schedule for the same candidate (submitted-first, closest anchor time,
// most mutations, latest receipt).
func (s *Service) resolveHistoryAttemptID(ctx context.Context, c contextRow) (string, error) {
	var n int64
	if err := s.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM student_attempt_mutations WHERE attempt_id = ?", c.AttemptID).Scan(&n); err != nil {
		return "", err
	}
	if n > 0 {
		return c.AttemptID, nil
	}
	anchor := c.StartedAt
	if c.SubmittedAt.Valid {
		anchor = c.SubmittedAt.Time.UTC()
	}
	var fallback sql.NullString
	err := s.db.QueryRowContext(ctx, "SELECT attempts.id FROM student_attempts attempts JOIN student_attempt_mutations mutations ON mutations.attempt_id = attempts.id WHERE attempts.schedule_id = ? AND attempts.candidate_id = ? GROUP BY attempts.id, attempts.submitted_at, attempts.updated_at ORDER BY CASE WHEN attempts.submitted_at IS NULL THEN 1 ELSE 0 END ASC, ABS(TIMESTAMPDIFF(SECOND, COALESCE(attempts.submitted_at, attempts.updated_at), ?)) ASC, COUNT(mutations.id) DESC, MAX(mutations.server_received_at) DESC LIMIT 1", c.ScheduleID, c.CandidateID, anchor).Scan(&fallback)
	if err != nil && err != sql.ErrNoRows {
		return "", err
	}
	if fallback.Valid && fallback.String != "" {
		return fallback.String, nil
	}
	return c.AttemptID, nil
}

// targetKey identifies one answer target.
type targetKey struct {
	typ string
	id  string
}

// targetMutation is a mutation classified to one target.
type targetMutation struct {
	module string
	key    targetKey
	row    mutationRow
}

// classifyTargetMutation maps a mutation row to its target using the catalog
// index; unmapped rows are dropped (same as the Rust classifier returning None).
func classifyTargetMutation(row mutationRow, index map[string]targetKey) *targetMutation {
	var payload map[string]any
	if err := json.Unmarshal(row.Payload, &payload); err != nil {
		return nil
	}
	candidates := []string{}
	for _, k := range []string{"targetId", "target_id", "questionId", "question_id", "taskId", "task_id"} {
		if v, ok := payload[k].(string); ok && strings.TrimSpace(v) != "" {
			candidates = append(candidates, strings.TrimSpace(v))
		}
	}
	// Slot-style payloads: objective targets may arrive as section+index.
	if len(candidates) == 0 {
		if slot, ok := payload["slotIndex"]; ok {
			if section, ok := payload["section"].(string); ok {
				candidates = append(candidates, fmt.Sprintf("%s:%v", section, slot))
			}
		}
	}
	if len(candidates) == 0 {
		return nil
	}
	cand := candidates[0]
	if key, ok := index[cand]; ok {
		return &targetMutation{module: payloadString(payload, "module", "currentModule", "current_module", key.typ), key: key, row: row}
	}
	// Unmapped but addressed targets still surface under their own id.
	if row.MutationType == "writing" || strings.Contains(strings.ToLower(cand), "task") {
		return &targetMutation{module: payloadString(payload, "module", "currentModule", "current_module", TargetWriting), key: targetKey{typ: TargetWriting, id: cand}, row: row}
	}
	return &targetMutation{module: payloadString(payload, "module", "currentModule", "current_module", TargetObjective), key: targetKey{typ: TargetObjective, id: cand}, row: row}
}

func payloadString(payload map[string]any, keys ...string) string {
	last := ""
	if len(keys) > 0 {
		last = keys[len(keys)-1]
	}
	for _, k := range keys[:len(keys)-1] {
		if v, ok := payload[k].(string); ok && strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return last
}

// buildTargetCatalog indexes objective + writing targets from the content and
// config snapshots. Catalog entries carry module + label; the index maps every
// known id spelling to its key.
func buildTargetCatalog(content, config json.RawMessage) ([]catalogEntry, map[string]targetKey) {
	entries := []catalogEntry{}
	index := map[string]targetKey{}
	add := func(typ, id, module, label string) {
		if strings.TrimSpace(id) == "" {
			return
		}
		if _, ok := index[id]; ok {
			return
		}
		index[id] = targetKey{typ: typ, id: id}
		entries = append(entries, catalogEntry{typ: typ, id: id, module: module, label: label})
	}
	var contentDoc map[string]any
	if err := json.Unmarshal(content, &contentDoc); err == nil {
		if sections, ok := contentDoc["sections"].([]any); ok {
			for _, s := range sections {
				m, _ := s.(map[string]any)
				if m == nil {
					continue
				}
				module, _ := m["key"].(string)
				if module == "" {
					module, _ = m["module"].(string)
				}
				questions, _ := m["questions"].([]any)
				for i, q := range questions {
					qm, _ := q.(map[string]any)
					if qm == nil {
						continue
					}
					for _, k := range []string{"questionId", "question_id", "id"} {
						if id, ok := qm[k].(string); ok && id != "" {
							add(TargetObjective, id, module, fmt.Sprintf("Question %d", i+1))
							break
						}
					}
				}
			}
		}
		if questions, ok := contentDoc["questions"].([]any); ok {
			for i, q := range questions {
				qm, _ := q.(map[string]any)
				if qm == nil {
					continue
				}
				for _, k := range []string{"questionId", "question_id", "id"} {
					if id, ok := qm[k].(string); ok && id != "" {
						add(TargetObjective, id, defaultModule(TargetObjective), fmt.Sprintf("Question %d", i+1))
						break
					}
				}
			}
		}
	}
	var configDoc map[string]any
	if err := json.Unmarshal(config, &configDoc); err == nil {
		tasks := []any{}
		for _, k := range []string{"writingTasks", "writing_tasks", "tasks"} {
			if v, ok := configDoc[k].([]any); ok {
				tasks = v
				break
			}
		}
		for i, t := range tasks {
			tm, _ := t.(map[string]any)
			id := ""
			if tm != nil {
				for _, k := range []string{"taskId", "task_id", "id"} {
					if v, ok := tm[k].(string); ok && v != "" {
						id = v
						break
					}
				}
			}
			if id == "" {
				id = fmt.Sprintf("task-%d", i+1)
			}
			add(TargetWriting, id, defaultModule(TargetWriting), fmt.Sprintf("Task %d", i+1))
		}
	}
	return entries, index
}

type catalogEntry struct {
	typ    string
	id     string
	module string
	label  string
}

func defaultModule(typ string) string {
	if typ == TargetWriting {
		return "writing"
	}
	return "objective"
}

// applyMutationToState folds one mutation payload into the running state.
// Objective answers replace; writing deltas append text when present.
func applyMutationToState(prev json.RawMessage, row mutationRow) json.RawMessage {
	var payload map[string]any
	if err := json.Unmarshal(row.Payload, &payload); err != nil {
		return prev
	}
	for _, k := range []string{"answer", "value", "response", "text"} {
		if v, ok := payload[k]; ok {
			if k == "text" {
				var base string
				_ = json.Unmarshal(prev, &base)
				if s, ok := v.(string); ok {
					out, _ := json.Marshal(base + s)
					return out
				}
			}
			out, _ := json.Marshal(v)
			return out
		}
	}
	return prev
}

func isAnswered(raw json.RawMessage) bool {
	s := strings.TrimSpace(string(raw))
	switch s {
	case "", "null", "[]":
		return false
	}
	if len(s) == 2 && s[0] == 34 && s[1] == 34 {
		return false
	}
	return true
}

// GetOverview returns the per-target revision overview for a submission.
func (s *Service) GetOverview(ctx context.Context, submissionID string) (json.RawMessage, error) {
	c, err := s.loadContext(ctx, submissionID)
	if err != nil {
		return nil, err
	}
	return s.buildOverview(ctx, c)
}

// GetOverviewByAttempt returns the overview addressed by attempt id.
func (s *Service) GetOverviewByAttempt(ctx context.Context, attemptID string) (json.RawMessage, error) {
	c, err := s.loadContextByAttempt(ctx, attemptID)
	if err != nil {
		return nil, err
	}
	return s.buildOverview(ctx, c)
}

func (s *Service) buildOverview(ctx context.Context, c contextRow) (json.RawMessage, error) {
	historyAttemptID, err := s.resolveHistoryAttemptID(ctx, c)
	if err != nil {
		return nil, err
	}
	_, index := buildTargetCatalog(c.ContentSnapshot, c.ConfigSnapshot)
	mutations, err := s.loadMutations(ctx, historyAttemptID)
	if err != nil {
		return nil, err
	}
	counts := map[targetKey]int64{}
	finals := map[targetKey]json.RawMessage{}
	modules := map[targetKey]string{}
	ordered := []targetMutation{}
	for _, row := range mutations {
		tm := classifyTargetMutation(row, index)
		if tm == nil {
			continue
		}
		ordered = append(ordered, *tm)
		counts[tm.key]++
		modules[tm.key] = tm.module
		prev := finals[tm.key]
		if len(prev) == 0 {
			prev = json.RawMessage("null")
		}
		finals[tm.key] = applyMutationToState(prev, tm.row)
	}
	type summary struct {
		TargetID      string          `json:"targetId"`
		Label         string          `json:"label"`
		Module        string          `json:"module"`
		TargetType    string          `json:"targetType"`
		RevisionCount int64           `json:"revisionCount"`
		Answered      bool            `json:"answered"`
		FinalValue    json.RawMessage `json:"finalValue"`
	}
	keys := make([]targetKey, 0, len(counts))
	for k := range counts {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool {
		if modules[keys[i]] != modules[keys[j]] {
			return modules[keys[i]] < modules[keys[j]]
		}
		return keys[i].id < keys[j].id
	})
	summaries := []summary{}
	sectionRevs := map[string]int64{}
	sectionTargets := map[string]map[string]struct{}{}
	for _, k := range keys {
		final := finals[k]
		if len(final) == 0 {
			final = json.RawMessage("null")
		}
		sectionRevs[modules[k]] += counts[k]
		if sectionTargets[modules[k]] == nil {
			sectionTargets[modules[k]] = map[string]struct{}{}
		}
		sectionTargets[modules[k]][k.typ+":"+k.id] = struct{}{}
		summaries = append(summaries, summary{
			TargetID: k.id, Label: k.id, Module: modules[k],
			TargetType: k.typ, RevisionCount: counts[k],
			Answered: isAnswered(final), FinalValue: final,
		})
	}
	type sectionStat struct {
		Module         string `json:"module"`
		TotalRevisions int64  `json:"totalRevisions"`
		EditedTargets  int64  `json:"editedTargets"`
	}
	stats := []sectionStat{}
	for module, revs := range sectionRevs {
		stats = append(stats, sectionStat{Module: module, TotalRevisions: revs, EditedTargets: int64(len(sectionTargets[module]))})
	}
	sort.Slice(stats, func(i, j int) bool { return stats[i].Module < stats[j].Module })
	signals, err := s.buildGlobalSignals(ctx, c.ScheduleID, historyAttemptID, ordered, c.SubmittedAt)
	if err != nil {
		return nil, err
	}
	var submissionID *string
	if c.SubmissionID.Valid {
		v := c.SubmissionID.String
		submissionID = &v
	}
	projection := map[string]any{
		"submissionId": submissionID, "attemptId": historyAttemptID,
		"scheduleId": c.ScheduleID, "examId": c.ExamID, "examTitle": c.ExamTitle,
		"candidateId": c.CandidateID, "candidateName": c.CandidateName, "candidateEmail": c.CandidateEmail,
		"startedAt": c.StartedAt.UTC(), "submittedAt": nullTimePtr(c.SubmittedAt),
		"totalRevisions": len(ordered), "totalTargetsEdited": len(counts),
		"questionSummaries": summaries, "sectionStats": stats, "signals": signals,
	}
	return json.Marshal(projection)
}

func nullTimePtr(t sql.NullTime) *time.Time {
	if !t.Valid {
		return nil
	}
	v := t.Time.UTC()
	return &v
}

// GetTargetDetail returns the checkpoint replay for one target.
func (s *Service) GetTargetDetail(ctx context.Context, submissionID, targetType, targetID string, cursor *int64, limit int) (json.RawMessage, error) {
	c, err := s.loadContext(ctx, submissionID)
	if err != nil {
		return nil, err
	}
	return s.buildTargetDetail(ctx, c, targetType, targetID, cursor, limit)
}

// GetTargetDetailByAttempt returns the checkpoint replay addressed by attempt id.
func (s *Service) GetTargetDetailByAttempt(ctx context.Context, attemptID, targetType, targetID string, cursor *int64, limit int) (json.RawMessage, error) {
	c, err := s.loadContextByAttempt(ctx, attemptID)
	if err != nil {
		return nil, err
	}
	return s.buildTargetDetail(ctx, c, targetType, targetID, cursor, limit)
}

func (s *Service) buildTargetDetail(ctx context.Context, c contextRow, targetType, targetID string, cursor *int64, limit int) (json.RawMessage, error) {
	if targetType != TargetObjective && targetType != TargetWriting {
		return nil, validationError("target_type must be objective or writing.")
	}
	if strings.TrimSpace(targetID) == "" {
		return nil, validationError("target_id is required.")
	}
	historyAttemptID, err := s.resolveHistoryAttemptID(ctx, c)
	if err != nil {
		return nil, err
	}
	_, index := buildTargetCatalog(c.ContentSnapshot, c.ConfigSnapshot)
	mutations, err := s.loadMutations(ctx, historyAttemptID)
	if err != nil {
		return nil, err
	}
	type checkpoint struct {
		ID               string          `json:"id"`
		Index            int64           `json:"index"`
		MutationID       string          `json:"mutationId"`
		MutationType     string          `json:"mutationType"`
		Timestamp        time.Time       `json:"timestamp"`
		ClientTimestamp  time.Time       `json:"clientTimestamp"`
		ServerReceivedAt time.Time       `json:"serverReceivedAt"`
		MutationSeq      int64           `json:"mutationSeq"`
		DeltaChars       int64           `json:"deltaChars"`
		Summary          string          `json:"summary"`
		StateSnapshot    json.RawMessage `json:"stateSnapshot"`
	}
	matching := []mutationRow{}
	for _, row := range mutations {
		tm := classifyTargetMutation(row, index)
		if tm == nil {
			continue
		}
		if tm.key.typ == targetType && tm.key.id == targetID {
			matching = append(matching, row)
		}
	}
	cursorSeq := int64(-1 << 62)
	if cursor != nil {
		cursorSeq = *cursor
	}
	if limit < 1 {
		limit = 200
	}
	checkpoints := []checkpoint{}
	state := json.RawMessage("null")
	var idx int64
	for _, row := range matching {
		if row.MutationSeq <= cursorSeq {
			continue
		}
		if len(checkpoints) >= limit {
			break
		}
		idx++
		prevLen := len(strings.Trim(string(state), "\""))
		_ = prevLen
		state = applyMutationToState(state, row)
		checkpoints = append(checkpoints, checkpoint{
			ID: fmt.Sprintf("%s-%d", row.ID, idx), Index: idx,
			MutationID: row.ID, MutationType: row.MutationType,
			Timestamp: row.ServerReceivedAt, ClientTimestamp: row.ClientTimestamp,
			ServerReceivedAt: row.ServerReceivedAt, MutationSeq: row.MutationSeq,
			DeltaChars: int64(len(string(state))), Summary: row.MutationType,
			StateSnapshot: state,
		})
	}
	final := state
	var submissionID *string
	if c.SubmissionID.Valid {
		v := c.SubmissionID.String
		submissionID = &v
	}
	signals := buildTargetSignals()
	projection := map[string]any{
		"submissionId": submissionID, "attemptId": historyAttemptID,
		"scheduleId": c.ScheduleID, "targetId": targetID, "targetLabel": targetID,
		"module": defaultModule(targetType), "targetType": targetType,
		"finalState": final, "checkpoints": checkpoints,
		"replaySteps": checkpoints, "technicalLogs": checkpoints, "signals": signals,
	}
	return json.Marshal(projection)
}

// buildGlobalSignals flags late-final-edits and operational audit rows.
func (s *Service) buildGlobalSignals(ctx context.Context, scheduleID, historyAttemptID string, ordered []targetMutation, submittedAt sql.NullTime) ([]map[string]any, error) {
	signals := []map[string]any{}
	if submittedAt.Valid && len(ordered) > 0 {
		latest := ordered[0].row.ServerReceivedAt
		lastID := ordered[0].row.ID
		for _, tm := range ordered[1:] {
			if tm.row.ServerReceivedAt.After(latest) {
				latest = tm.row.ServerReceivedAt
				lastID = tm.row.ID
			}
		}
		if diff := submittedAt.Time.UTC().Sub(latest).Seconds(); diff >= 0 && diff <= 60 {
			signals = append(signals, map[string]any{
				"signalType": "LATE_FINAL_EDIT", "severity": "medium",
				"message":  "Final change happened shortly before submission.",
				"evidence": map[string]any{"secondsBeforeSubmission": int64(diff), "mutationId": lastID},
			})
		}
	}
	rows, err := s.db.QueryContext(ctx, "SELECT action_type, payload, created_at FROM session_audit_logs WHERE schedule_id = ? AND target_student_id = ? ORDER BY created_at DESC LIMIT 100", scheduleID, historyAttemptID)
	if err != nil {
		return signals, nil
	}
	defer rows.Close()
	for rows.Next() {
		var action string
		var payload []byte
		var at sql.NullTime
		if err := rows.Scan(&action, &payload, &at); err != nil {
			return signals, rows.Err()
		}
		switch action {
		case "NETWORK_DISCONNECTED", "HEARTBEAT_LOST", "DEVICE_CONTINUITY_FAILED":
			var ts time.Time
			if at.Valid {
				ts = at.Time.UTC()
			}
			signals = append(signals, map[string]any{
				"signalType": action, "severity": "high",
				"message":  "Operational integrity signal recorded during session.",
				"evidence": map[string]any{"at": ts, "payload": json.RawMessage(append([]byte(nil), payload...))},
			})
		}
	}
	return signals, rows.Err()
}

func buildTargetSignals() []map[string]any {
	return []map[string]any{}
}

// ExportTarget renders one target detail as JSON (pretty) or CSV.
func (s *Service) ExportTarget(ctx context.Context, submissionID, targetType, targetID, format string) (filename, contentType, content string, err error) {
	if format != FormatJSON && format != FormatCSV {
		return "", "", "", validationError("format must be json or csv.")
	}
	detailRaw, err := s.GetTargetDetail(ctx, submissionID, targetType, targetID, nil, 1<<30)
	if err != nil {
		return "", "", "", err
	}
	if format == FormatJSON {
		var pretty any
		_ = json.Unmarshal(detailRaw, &pretty)
		out, merr := json.MarshalIndent(pretty, "", "  ")
		if merr != nil {
			return "", "", "", merr
		}
		return fmt.Sprintf("answer-history-%s.json", targetID), "application/json", string(out), nil
	}
	var detail struct {
		Checkpoints []struct {
			Index            int64           `json:"index"`
			MutationID       string          `json:"mutationId"`
			MutationType     string          `json:"mutationType"`
			MutationSeq      int64           `json:"mutationSeq"`
			ClientTimestamp  time.Time       `json:"clientTimestamp"`
			ServerReceivedAt time.Time       `json:"serverReceivedAt"`
			DeltaChars       int64           `json:"deltaChars"`
			Summary          string          `json:"summary"`
			StateSnapshot    json.RawMessage `json:"stateSnapshot"`
		} `json:"checkpoints"`
	}
	if uerr := json.Unmarshal(detailRaw, &detail); uerr != nil {
		return "", "", "", uerr
	}
	var b strings.Builder
	b.WriteString("checkpointIndex,mutationId,mutationType,mutationSeq,clientTimestamp,serverReceivedAt,deltaChars,summary,stateSnapshot\n")
	for _, cp := range detail.Checkpoints {
		state, _ := json.Marshal(cp.StateSnapshot)
		quote := string([]byte{34})
		escaped := quote + quote
		q := func(s string) string { return quote + strings.ReplaceAll(s, quote, escaped) + quote }
		b.WriteString(fmt.Sprintf("%d,%s,%s,%d,%s,%s,%d,%s,%s\n", cp.Index, q(cp.MutationID), q(cp.MutationType), cp.MutationSeq, q(cp.ClientTimestamp.Format(time.RFC3339)), q(cp.ServerReceivedAt.Format(time.RFC3339)), cp.DeltaChars, q(cp.Summary), q(string(state))))
	}
	return fmt.Sprintf("answer-history-%s.csv", targetID), "text/csv", b.String(), nil
}
