package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"example.com/ielts-proctoring/internal/assessmentforms"
	"net/http"
	"sort"
	"strconv"
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
	"example.com/ielts-proctoring/internal/runtime"
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
	const sel = `SELECT m.id, s.section_key, COALESCE(ma.state, ''), e.provider_key,` +
		` ma.started_at, ma.allocated_seconds, ma.extension_seconds, ma.accumulated_paused_seconds,` +
		` COALESCE(r.timing_model, ''), ma.entry_confirmed_at, ma.entry_entered_at,` +
		` COALESCE(its.state, ''), its.started_at, its.deadline_at, its.paused_at` +
		` FROM assessment_exam_questions eq` +
		` JOIN assessment_modules m ON m.id = eq.module_id` +
		` JOIN assessment_sections s ON s.id = m.section_id` +
		` JOIN exam_versions v ON v.id = s.exam_version_id` +
		` JOIN exam_entities e ON e.id = v.exam_id` +
		` JOIN student_attempts sa ON sa.id = ?` +
		` LEFT JOIN exam_session_runtimes r ON r.schedule_id = sa.schedule_id` +
		` LEFT JOIN assessment_module_attempts ma ON ma.module_id = m.id AND ma.attempt_id = ?` +
		` LEFT JOIN ielts_attempt_section_timelines its ON its.attempt_id = sa.id AND its.section_key = s.section_key` +
		` WHERE (eq.id = ? OR eq.question_id = ?)` +
		` AND s.exam_version_id = sa.published_version_id` +
		` ORDER BY CASE WHEN eq.id = ? THEN 0 ELSE 1 END LIMIT 1`
	var owner attempts.QuestionOwner
	var state string
	var providerKey sql.NullString
	var startedAt, entryConfirmedAt, entryEnteredAt, timelineStartedAt, timelineDeadlineAt, timelinePausedAt sql.NullTime
	var allocated, extension, accumulatedPaused sql.NullInt64
	var timelineState string
	err := q.QueryRowContext(ctx, sel, attemptID, attemptID, questionID, questionID, questionID).Scan(
		&owner.ModuleID, &owner.SectionKey, &state, &providerKey,
		&startedAt, &allocated, &extension, &accumulatedPaused,
		&owner.TimingModel, &entryConfirmedAt, &entryEnteredAt,
		&timelineState, &timelineStartedAt, &timelineDeadlineAt, &timelinePausedAt,
	)
	if err == sql.ErrNoRows {
		owner, fallbackErr := resolveSnapshotQuestionForProvider(ctx, q, attemptID, questionID)
		if fallbackErr != nil {
			return attempts.QuestionOwner{}, fallbackErr
		}
		if fallbackErr = attachIELTSTimeline(ctx, q, attemptID, &owner); fallbackErr != nil {
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
	owner.SectionTimelineState = timelineState
	owner.SectionTimelineStartedAt = studentNullTimePtr(timelineStartedAt)
	owner.SectionTimelineDeadlineAt = studentNullTimePtr(timelineDeadlineAt)
	owner.SectionTimelinePausedAt = studentNullTimePtr(timelinePausedAt)
	if startedAt.Valid {
		value := startedAt.Time.UTC()
		owner.ModuleStartedAt = &value
	}
	if entryConfirmedAt.Valid {
		value := entryConfirmedAt.Time.UTC()
		owner.EntryConfirmedAt = &value
	}
	_ = entryEnteredAt // the first accepted response itself closes the rearm window below
	owner.ModuleDeadlineAt = satModuleDeadline(providerKey, state, startedAt, allocated, extension, accumulatedPaused)
	return owner, nil
}

func satModuleDeadline(providerKey sql.NullString, state string, startedAt sql.NullTime, allocated, extension, accumulatedPaused sql.NullInt64) *time.Time {
	if !providerKey.Valid || providerKey.String != string(attempts.ProviderSAT) ||
		(state != "active" && state != "review") || !startedAt.Valid {
		return nil
	}
	allotted := allocated.Int64 + extension.Int64
	if allotted < 0 {
		allotted = 0
	}
	paused := accumulatedPaused.Int64
	if paused < 0 {
		paused = 0
	}
	deadline := startedAt.Time.UTC().Add(time.Duration(allotted+paused) * time.Second)
	return &deadline
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
	root, err := loadAttemptSnapshotRoot(ctx, q, attemptID)
	if err != nil {
		return attempts.QuestionOwner{}, err
	}
	owner, ok := snapshotOwnerFor(root, questionID)
	if !ok {
		return attempts.QuestionOwner{}, errQuestionNotInExam()
	}
	return owner, nil
}

// loadAttemptSnapshotRoot loads and unwraps the attempt's published content
// snapshot. One load serves every question of a batch (ResolveMany), which is
// what keeps a legacy flush from re-reading and re-parsing the whole tree per
// answer.
func loadAttemptSnapshotRoot(ctx context.Context, q tx.Tx, attemptID string) (map[string]any, error) {
	var raw string
	err := q.QueryRowContext(ctx, `SELECT CAST(v.content_snapshot AS CHAR) FROM student_attempts a JOIN exam_versions v ON v.id = a.published_version_id WHERE a.id = ?`, attemptID).Scan(&raw)
	if err == sql.ErrNoRows {
		return nil, errQuestionNotInExam()
	}
	if err != nil {
		return nil, err
	}
	var root map[string]any
	if err := json.Unmarshal([]byte(raw), &root); err != nil {
		return nil, err
	}
	if nested, ok := root["contentSnapshot"].(map[string]any); ok {
		root = nested
	}
	return root, nil
}

// snapshotOwnerFor reports the snapshot section/module owning a question.
func snapshotOwnerFor(root map[string]any, questionID string) (attempts.QuestionOwner, bool) {
	for _, candidate := range snapshotQuestionRoots(root) {
		if snapshotContainsQuestion(candidate.value, questionID) {
			return attempts.QuestionOwner{ModuleID: candidate.moduleKey, SectionKey: candidate.sectionKey, ModuleState: "active"}, true
		}
	}
	return attempts.QuestionOwner{}, false
}

// snapshotOwnersFor is the batch form of snapshotOwnerFor: one walk of the
// eligible roots, in snapshotQuestionRoots order, resolves every requested ID,
// so the first root containing an ID owns it exactly as in the per-question
// walk. IDs absent from the snapshot are absent from the result. The result is
// static content membership only; callers attach current timeline state and
// the write gate still decides writability.
func snapshotOwnersFor(root map[string]any, questionIDs []string) map[string]attempts.QuestionOwner {
	walker := snapshotOwnerWalker{
		wanted: make(map[string]struct{}, len(questionIDs)),
		owners: make(map[string]attempts.QuestionOwner, len(questionIDs)),
	}
	for _, id := range questionIDs {
		walker.wanted[id] = struct{}{}
	}
	for _, candidate := range snapshotQuestionRoots(root) {
		if len(walker.wanted) == 0 {
			break
		}
		walker.owner = attempts.QuestionOwner{ModuleID: candidate.moduleKey, SectionKey: candidate.sectionKey, ModuleState: "active"}
		walker.visit(candidate.value)
	}
	return walker.owners
}

type snapshotOwnerWalker struct {
	wanted map[string]struct{}
	owners map[string]attempts.QuestionOwner
	owner  attempts.QuestionOwner
}

func (w *snapshotOwnerWalker) visit(value any) {
	if len(w.wanted) == 0 {
		return
	}
	switch node := value.(type) {
	case map[string]any:
		snapshotResponseIDs(node, func(id string) {
			if _, needed := w.wanted[id]; needed {
				w.owners[id] = w.owner
				delete(w.wanted, id)
			}
		})
		for _, child := range node {
			w.visit(child)
		}
	case []any:
		for _, child := range node {
			w.visit(child)
		}
	}
}

// errQuestionNotInExam is the shared not-found verdict for an unknown question.
func errQuestionNotInExam() error {
	return apperrors.New(apperrors.CodeNotFound, "Question is not part of the attempt exam.")
}

var _ attempts.BulkQuestionResolver = v2Resolver{}

// ResolveMany resolves a whole batch of questions in one statement and shares
// the legacy snapshot load across the questions that need it (audit finding 4:
// a multi-answer flush used to pay one normalized lookup — plus one full
// content-snapshot load for legacy exams — per answer while holding the attempt
// row lock). Verdicts are per question, so the write loop still reports each
// unresolvable question at the command that owns it.
func (v2Resolver) ResolveMany(ctx context.Context, q tx.Tx, attemptID string, questionIDs []string) (map[string]attempts.QuestionVerdict, error) {
	verdicts := make(map[string]attempts.QuestionVerdict, len(questionIDs))
	if len(questionIDs) == 0 {
		return verdicts, nil
	}
	normalized, err := normalizedQuestionOwners(ctx, q, attemptID, questionIDs)
	if err != nil {
		return nil, err
	}
	missing := make([]string, 0, len(questionIDs))
	for _, questionID := range questionIDs {
		if owner, ok := normalized[questionID]; ok {
			verdicts[questionID] = attempts.QuestionVerdict{Owner: owner}
			continue
		}
		missing = append(missing, questionID)
	}
	if len(missing) == 0 {
		return verdicts, nil
	}
	// Snapshot fallback, exactly as the per-question path: SAT questions never
	// resolve through a snapshot tree (defect 6), and the provider gate plus
	// the snapshot read happen once for the whole batch.
	if isSATAttempt(ctx, q, attemptID) {
		for _, questionID := range missing {
			verdicts[questionID] = attempts.QuestionVerdict{Err: errQuestionNotInExam()}
		}
		return verdicts, nil
	}
	root, err := loadAttemptSnapshotRoot(ctx, q, attemptID)
	if err != nil {
		return nil, err
	}
	model, timelines, err := loadIELTSTimelines(ctx, q, attemptID)
	if err != nil {
		return nil, err
	}
	// One traversal of the snapshot for the whole batch; a single fallback ID
	// keeps the short-circuiting per-question walk and builds no lookup maps.
	var owners map[string]attempts.QuestionOwner
	if len(missing) > 1 {
		owners = snapshotOwnersFor(root, missing)
	}
	for _, questionID := range missing {
		var owner attempts.QuestionOwner
		var ok bool
		if owners != nil {
			owner, ok = owners[questionID]
		} else {
			owner, ok = snapshotOwnerFor(root, questionID)
		}
		if ok {
			if runtime.IsIELTSPersonal(model) {
				owner.TimingModel = model
				applyIELTSTimeline(&owner, timelines[owner.SectionKey])
			}
			verdicts[questionID] = attempts.QuestionVerdict{Owner: owner}
			continue
		}
		verdicts[questionID] = attempts.QuestionVerdict{Err: errQuestionNotInExam()}
	}
	return verdicts, nil
}

type ieltsTimelineOwner struct {
	state                           string
	startedAt, deadlineAt, pausedAt sql.NullTime
}

func attachIELTSTimeline(ctx context.Context, q tx.Tx, attemptID string, owner *attempts.QuestionOwner) error {
	model, timelines, err := loadIELTSTimelines(ctx, q, attemptID)
	if err != nil {
		return err
	}
	if runtime.IsIELTSPersonal(model) {
		owner.TimingModel = model
		applyIELTSTimeline(owner, timelines[owner.SectionKey])
	}
	return nil
}

func loadIELTSTimelines(ctx context.Context, q tx.Tx, attemptID string) (string, map[string]ieltsTimelineOwner, error) {
	var model string
	if err := q.QueryRowContext(ctx, `SELECT COALESCE(rt.timing_model, '')
		FROM student_attempts a LEFT JOIN exam_session_runtimes rt ON rt.schedule_id = a.schedule_id
		WHERE a.id = ?`, attemptID).Scan(&model); err != nil {
		return "", nil, err
	}
	rowsBySection := make(map[string]ieltsTimelineOwner)
	if !runtime.IsIELTSPersonal(model) {
		return model, rowsBySection, nil
	}
	rows, err := q.QueryContext(ctx, `SELECT section_key, state, started_at, deadline_at, paused_at
		FROM ielts_attempt_section_timelines WHERE attempt_id = ?`, attemptID)
	if err != nil {
		return "", nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var key string
		var timeline ieltsTimelineOwner
		if err := rows.Scan(&key, &timeline.state, &timeline.startedAt, &timeline.deadlineAt, &timeline.pausedAt); err != nil {
			return "", nil, err
		}
		rowsBySection[key] = timeline
	}
	return model, rowsBySection, rows.Err()
}

func applyIELTSTimeline(owner *attempts.QuestionOwner, timeline ieltsTimelineOwner) {
	owner.SectionTimelineState = timeline.state
	owner.SectionTimelineStartedAt = studentNullTimePtr(timeline.startedAt)
	owner.SectionTimelineDeadlineAt = studentNullTimePtr(timeline.deadlineAt)
	owner.SectionTimelinePausedAt = studentNullTimePtr(timeline.pausedAt)
}

func (v2Resolver) CanonicalizeQuestions(ctx context.Context, q tx.Tx, attemptID string, questionIDs []string) (map[string]attempts.QuestionOwner, error) {
	return normalizedQuestionOwners(ctx, q, attemptID, questionIDs)
}

// normalizedQuestionOwners resolves pinned sitting-slot IDs. A reusable bank
// question alias is accepted only when exactly one pinned slot uses it.
func normalizedQuestionOwners(ctx context.Context, q tx.Tx, attemptID string, questionIDs []string) (map[string]attempts.QuestionOwner, error) {
	query := `SELECT eq.id, eq.question_id, m.id, s.section_key, COALESCE(ma.state, ''), e.provider_key,` +
		` ma.started_at, ma.allocated_seconds, ma.extension_seconds, ma.accumulated_paused_seconds,` +
		` COALESCE(r.timing_model, ''), ma.entry_confirmed_at, ma.entry_entered_at,` +
		` COALESCE(its.state, ''), its.started_at, its.deadline_at, its.paused_at` +
		` FROM assessment_exam_questions eq` +
		` JOIN assessment_modules m ON m.id = eq.module_id` +
		` JOIN assessment_sections s ON s.id = m.section_id` +
		` JOIN exam_versions v ON v.id = s.exam_version_id` +
		` JOIN exam_entities e ON e.id = v.exam_id` +
		` JOIN student_attempts sa ON sa.id = ?` +
		` LEFT JOIN exam_session_runtimes r ON r.schedule_id = sa.schedule_id` +
		` LEFT JOIN assessment_module_attempts ma ON ma.module_id = m.id AND ma.attempt_id = ?` +
		` LEFT JOIN ielts_attempt_section_timelines its ON its.attempt_id = sa.id AND its.section_key = s.section_key` +
		` WHERE (eq.id IN (` + sqlPlaceholders(len(questionIDs)) + `) OR eq.question_id IN (` + sqlPlaceholders(len(questionIDs)) + `))` +
		` AND s.exam_version_id = sa.published_version_id`
	args := make([]any, 0, 2*len(questionIDs)+2)
	args = append(args, attemptID, attemptID)
	for _, id := range questionIDs {
		args = append(args, id)
	}
	for _, id := range questionIDs {
		args = append(args, id)
	}
	rows, err := q.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	owners := make(map[string]attempts.QuestionOwner, len(questionIDs))
	exact := make(map[string]attempts.QuestionOwner, len(questionIDs))
	aliases := make(map[string]attempts.QuestionOwner, len(questionIDs))
	ambiguous := make(map[string]bool)
	for rows.Next() {
		var examQuestionID, questionID, moduleID, sectionKey, state string
		var providerKey sql.NullString
		var startedAt, entryConfirmedAt, entryEnteredAt, timelineStartedAt, timelineDeadlineAt, timelinePausedAt sql.NullTime
		var allocated, extension, accumulatedPaused sql.NullInt64
		var ownerTimingModel string
		var timelineState string
		if err := rows.Scan(
			&examQuestionID, &questionID, &moduleID, &sectionKey, &state, &providerKey,
			&startedAt, &allocated, &extension, &accumulatedPaused,
			&ownerTimingModel, &entryConfirmedAt, &entryEnteredAt,
			&timelineState, &timelineStartedAt, &timelineDeadlineAt, &timelinePausedAt,
		); err != nil {
			return nil, err
		}
		owner := attempts.QuestionOwner{CanonicalQuestionID: examQuestionID, ModuleID: moduleID, SectionKey: sectionKey, TimingModel: ownerTimingModel}
		owner.SectionTimelineState = timelineState
		owner.SectionTimelineStartedAt = studentNullTimePtr(timelineStartedAt)
		owner.SectionTimelineDeadlineAt = studentNullTimePtr(timelineDeadlineAt)
		owner.SectionTimelinePausedAt = studentNullTimePtr(timelinePausedAt)
		if startedAt.Valid {
			value := startedAt.Time.UTC()
			owner.ModuleStartedAt = &value
		}
		if entryConfirmedAt.Valid {
			value := entryConfirmedAt.Time.UTC()
			owner.EntryConfirmedAt = &value
		}
		// Exam-day P1: a normalized question without an assigned module attempt
		// for this attempt (unassigned adaptive branch, future module) must not
		// resolve as writable.
		if state == "" {
			owner.ModuleState = "unassigned"
		} else {
			owner.ModuleState = state
		}
		owner.ModuleDeadlineAt = satModuleDeadline(providerKey, state, startedAt, allocated, extension, accumulatedPaused)
		exact[examQuestionID] = owner
		if prior, ok := aliases[questionID]; ok && prior.CanonicalQuestionID != examQuestionID {
			ambiguous[questionID] = true
		} else {
			aliases[questionID] = owner
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for _, questionID := range questionIDs {
		if owner, ok := exact[questionID]; ok {
			owners[questionID] = owner
			continue
		}
		if ambiguous[questionID] {
			return nil, &apperrors.Error{Code: apperrors.CodeBadRequest, HTTPStatus: 400, Message: "Question alias identifies multiple pinned sitting slots; use the exam-question ID.", Details: map[string]any{"reason": "AMBIGUOUS_QUESTION_ALIAS", "questionId": questionID}}
		}
		if owner, ok := aliases[questionID]; ok {
			owners[questionID] = owner
		}
	}
	return owners, nil
}

// sqlPlaceholders renders n comma-separated binds for an IN (...) list.
func sqlPlaceholders(n int) string {
	if n <= 0 {
		return "NULL"
	}
	return strings.TrimSuffix(strings.Repeat("?,", n), ",")
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

// snapshotResponseIDs includes the composite keys generated by the student
// exam adapter for per-slot flags and sub-answer responses. Construct keys only
// from actual parent/child relationships in the pinned snapshot.
func snapshotResponseIDs(node map[string]any, visit func(string)) {
	for _, key := range [...]string{"id", "questionId", "questionID", "taskId", "taskID"} {
		if id, ok := node[key].(string); ok {
			visit(id)
		}
	}
	// Legacy writing is hydrated from these fields without stored task IDs.
	for _, taskID := range [...]string{"task1", "task2"} {
		if _, ok := node[taskID+"Prompt"].(string); ok {
			visit(taskID)
		}
	}
	id, _ := node["id"].(string)
	if id == "" {
		return
	}
	// Match normalizeSingleMcqBlock's deterministic IDs for older snapshots.
	if node["type"] == "SINGLE_MCQ" {
		questions, _ := node["questions"].([]any)
		for index, raw := range questions {
			question, _ := raw.(map[string]any)
			questionID, _ := question["id"].(string)
			questionID = strings.TrimSpace(questionID)
			if questionID == "" {
				questionID = id
				if index > 0 {
					questionID += ":q" + strconv.Itoa(index+1)
				}
			}
			visit(questionID)
		}
	}
	field := "blanks" // Sentence/note questions store slots under their own ID.
	switch node["type"] {
	case "CLASSIFICATION":
		field = "items"
	case "MATCHING_FEATURES":
		field = "features"
	case "TABLE_COMPLETION":
		field = "cells"
	case "DIAGRAM_LABELING":
		field = "labels"
	case "FLOW_CHART":
		field = "steps"
	}
	children, _ := node[field].([]any)
	for _, child := range children {
		if slot, ok := child.(map[string]any); ok {
			if slotID, ok := slot["id"].(string); ok && slotID != "" {
				visit(id + ":" + slotID)
			}
		}
	}
	if node["subAnswerModeEnabled"] == true {
		roots, _ := node["answerTree"].([]any)
		for _, raw := range roots {
			if root, ok := raw.(map[string]any); ok {
				if rootID, ok := root["id"].(string); ok && rootID != "" {
					snapshotTreeResponseIDs(root, id+"::tree::"+rootID+"::", visit)
				}
			}
		}
	}
}

func snapshotTreeResponseIDs(node map[string]any, prefix string, visit func(string)) {
	children, _ := node["children"].([]any)
	if len(children) == 0 {
		if id, ok := node["id"].(string); ok && id != "" {
			visit(prefix + id)
		}
		return
	}
	for _, raw := range children {
		if child, ok := raw.(map[string]any); ok {
			snapshotTreeResponseIDs(child, prefix, visit)
		}
	}
}

func snapshotContainsQuestion(value any, questionID string) bool {
	switch node := value.(type) {
	case map[string]any:
		found := false
		snapshotResponseIDs(node, func(id string) { found = found || id == questionID })
		if found {
			return true
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

// v2Locker share-locks the exam runtime + active section after the attempt.
// FOR SHARE (not FOR UPDATE): this path only reads both rows, and only
// runtime/proctor commands write them. A share lock still holds those writers
// off until commit, but no longer serializes every student of the schedule
// behind one slow save or seal.
// A missing runtime row is an open gate (schedules without a runtime yet).
type v2Locker struct{}

var _ attempts.RuntimeLocker = v2Locker{}

func (v2Locker) Lock(ctx context.Context, q tx.Tx, scheduleID string) (attempts.RuntimeGate, error) {
	var gate attempts.RuntimeGate
	var id string
	var status sql.NullString
	var timingModel sql.NullString
	var active sql.NullString
	var waiting sql.NullBool
	var completionReason sql.NullString
	err := q.QueryRowContext(ctx, `SELECT id, status, timing_model, active_section_key, waiting_for_next_section, COALESCE(completion_reason, '') FROM exam_session_runtimes WHERE schedule_id = ? FOR SHARE`, scheduleID).Scan(&id, &status, &timingModel, &active, &waiting, &completionReason)
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
	if timingModel.String == runtime.TimingModelPersonal {
		if err := q.QueryRowContext(ctx, "SELECT COALESCE(sat_handoff_mode, 'server_start') FROM exam_session_runtimes WHERE schedule_id = ?", scheduleID).Scan(&gate.HandoffMode); err != nil {
			return attempts.RuntimeGate{}, err
		}
	}
	gate.Now = now
	gate.CompletionReason = completionReason.String
	if timingModel.Valid {
		gate.TimingModel = timingModel.String
	}
	if runtime.IsIELTSSharedSchedule(gate.TimingModel) {
		shared, ok, err := runtime.LoadIELTSSharedScheduleInTx(ctx, q, id, " FOR SHARE")
		if err != nil {
			return attempts.RuntimeGate{}, err
		}
		if ok {
			gate.SharedSchedule = &shared
		}
	}
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
		serr := q.QueryRowContext(ctx, `SELECT CASE WHEN actual_start_at > UTC_TIMESTAMP(6) THEN 'locked' ELSE status END AS status FROM exam_session_runtime_sections WHERE runtime_id = ? AND section_key = ? FOR SHARE`, id, active.String).Scan(&secStatus)
		if serr != nil && serr != sql.ErrNoRows {
			return attempts.RuntimeGate{}, serr
		}
		if serr == nil && secStatus.Valid {
			// SectionLiveness is the single owner of status -> liveness, shared
			// with the snapshot gate (runtime.LoadSnapshot) so an unopened or
			// completed section is refused identically in both modes.
			gate.SectionStarted, gate.SectionLive, gate.SectionPaused = runtime.SectionLiveness(secStatus.String)
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
	// No provider fence here: this value now arrives from the resolver that ran
	// on THIS transaction after the attempt lock (attempts.submitInTx), so it is
	// already the single authoritative decision rather than a pre-tx guess to be
	// re-checked.
	var existing string
	err := q.QueryRowContext(ctx, `SELECT outcome FROM attempt_terminalizations WHERE attempt_id = ? AND terminal_generation = (SELECT terminal_generation FROM student_attempts WHERE id = attempt_terminalizations.attempt_id) FOR UPDATE`, attemptID).Scan(&existing)
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
	var terminalGeneration uint64
	var org sql.NullString
	if err := q.QueryRowContext(ctx, `SELECT answer_revision, revision, organization_id, terminal_generation FROM student_attempts WHERE id = ?`, attemptID).Scan(&answerRev, &revision, &org, &terminalGeneration); err != nil {
		return err
	}
	eff := effectiveAt.UTC()
	tid := uuid.NewString()
	reqID := submissionID
	if _, perr := uuid.Parse(reqID); perr != nil {
		reqID = uuid.NewString()
	}
	snapshotFields := map[string]any{"attemptId": attemptID, "scheduleId": scheduleID, "digest": digest, "submissionId": submissionID, "terminalGeneration": terminalGeneration}
	// Seal-time answer authority, resolved once: ACT scoring (which needs it
	// first) and the compatibility projection read the same materialized answers.
	var storedAnswers, storedWriting, storedFlags sql.NullString
	sealed := false
	if provider == "act" && s.scorer != nil {
		if storedAnswers, storedWriting, storedFlags, err = sealAnswerBlobs(ctx, q, attemptID); err != nil {
			return err
		}
		sealed = true
		answers := json.RawMessage(storedAnswers.String)
		if !storedAnswers.Valid {
			answers = nil
		}
		var versionID string
		if err := q.QueryRowContext(ctx, `SELECT published_version_id FROM student_attempts WHERE id = ?`, attemptID).Scan(&versionID); err != nil {
			return err
		}
		fields, err := s.scorer.ScoreAttempt(ctx, q, attemptID, versionID, answers)
		if err != nil {
			return err
		}
		for key, value := range fields {
			snapshotFields[key] = value
		}
		if detailed, ok := s.scorer.(terminalization.DetailedAttemptScorer); ok {
			details, err := detailed.ScoreAttemptDetails(ctx, q, attemptID, versionID, answers)
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
	if !sealed {
		if storedAnswers, storedWriting, storedFlags, err = sealAnswerBlobs(ctx, q, attemptID); err != nil {
			return err
		}
	}
	answers, writingAnswers, flags, err := decodeSealAnswerMaps(storedAnswers, storedWriting, storedFlags)
	if err != nil {
		return err
	}
	snapshotFields["answers"] = answers
	snapshotFields["writingAnswers"] = writingAnswers
	snapshotFields["flags"] = flags
	snapshotFields["providerKey"] = provider
	snap, _ := json.Marshal(snapshotFields)
	var orgArg any
	if org.Valid {
		orgArg = org.String
	}
	var actorArg any
	if actorID != "" {
		actorArg = actorID
	}
	const ins = `INSERT INTO attempt_terminalizations (attempt_id, organization_id, terminalization_id, schedule_id, outcome, reason, actor_kind, actor_id, effective_at, recorded_at, answer_revision, final_snapshot, request_id, terminal_generation) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(6), ?, ?, ?, terminal_generation FROM student_attempts WHERE id = ?`
	if _, err := q.ExecContext(ctx, ins, attemptID, orgArg, tid, scheduleID, terminalization.OutcomeSubmitted, terminalization.ReasonStudentSubmit, terminalization.ActorStudent, actorArg, eff, answerRev, string(snap), reqID, attemptID); err != nil {
		return err
	}
	projectionFields := map[string]any{"terminalizationId": tid, "attemptId": attemptID, "scheduleId": scheduleID, "outcome": terminalization.OutcomeSubmitted, "reason": terminalization.ReasonStudentSubmit, "digest": digest, "submissionId": submissionID, "effectiveAt": eff}
	for key, value := range snapshotFields {
		if key == "score" || key == "providerKey" || key == "section" {
			projectionFields[key] = value
		}
	}
	// The compatibility final_submission IS the IELTS grading projection's
	// input: it reads answers/writingAnswers from it. A student V2 submit used
	// to stamp receipt fields only, so every section projected as an empty
	// answer map and a fully answered exam read as "answers were not saved" in
	// review — for every question type, because the loss was the whole map.
	// Publish the same sealed answer maps the terminalization seal publishes.
	projectionFields["answers"] = answers
	projectionFields["writingAnswers"] = writingAnswers
	projectionFields["flags"] = flags
	projectionFields["providerKey"] = provider
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
	payload, _ := json.Marshal(map[string]any{"terminalizationId": tid, "attemptId": attemptID, "scheduleId": scheduleID, "outcome": terminalization.OutcomeSubmitted, "reason": terminalization.ReasonStudentSubmit, "answerRevision": answerRev, "terminalGeneration": terminalGeneration})
	return outbox.EnqueueInTx(ctx, q, "attempt_terminalization", attemptID, revision+1, "attempt_terminalized", json.RawMessage(payload))
}

// sealAnswerBlobs returns the answer blobs a seal publishes. Protocol-2
// (row-first) attempts rebuild the legacy blob columns from
// attempt_responses_v2 rows — the seal-time correctness point, so scoring and
// grading never see a stale blob — and protocol-1 attempts keep their
// authoritative V1 blobs untouched.
func sealAnswerBlobs(ctx context.Context, q tx.Tx, attemptID string) (storedAnswers, storedWriting, storedFlags sql.NullString, err error) {
	var protocolVersion int
	if err = q.QueryRowContext(ctx,
		`SELECT COALESCE(protocol_version, 1), answers, writing_answers, flags FROM student_attempts WHERE id = ? FOR UPDATE`,
		attemptID).Scan(&protocolVersion, &storedAnswers, &storedWriting, &storedFlags); err != nil {
		return
	}
	if protocolVersion >= 2 {
		blobs, merr := attempts.MaterializeBlobs(ctx, q, attemptID)
		if merr != nil {
			err = merr
			return
		}
		if _, err = q.ExecContext(ctx,
			`UPDATE student_attempts SET answers=?, writing_answers=?, flags=? WHERE id=?`,
			blobs.Answers, blobs.WritingAnswers, blobs.Flags, attemptID); err != nil {
			return
		}
		storedAnswers = sql.NullString{String: blobs.Answers, Valid: true}
		storedWriting = sql.NullString{String: blobs.WritingAnswers, Valid: true}
		storedFlags = sql.NullString{String: blobs.Flags, Valid: true}
	}
	return
}

// decodeSealAnswerMaps decodes the sealed blobs into the answer maps the
// compatibility final_submission carries.
func decodeSealAnswerMaps(storedAnswers, storedWriting, storedFlags sql.NullString) (map[string]any, map[string]any, map[string]any, error) {
	decode := func(raw sql.NullString) (map[string]any, error) {
		out := map[string]any{}
		if !raw.Valid || strings.TrimSpace(raw.String) == "" {
			return out, nil
		}
		if err := json.Unmarshal([]byte(raw.String), &out); err != nil {
			return nil, err
		}
		return out, nil
	}
	answers, err := decode(storedAnswers)
	if err != nil {
		return nil, nil, nil, err
	}
	writingAnswers, err := decode(storedWriting)
	if err != nil {
		return nil, nil, nil, err
	}
	flags, err := decode(storedFlags)
	if err != nil {
		return nil, nil, nil, err
	}
	return answers, writingAnswers, flags, nil
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
			LeaseEpoch   uint64                               `json:"leaseEpoch"`
			ControlEpoch uint64                               `json:"controlEpoch"`
			Commands     []attempts.ResponseCommand           `json:"commands"`
			ModuleClose  *attempts.SATModuleCloseWriteContext `json:"moduleClose,omitempty"`
		}
		if err := httpx.DecodeLimited(r, httpx.MaxStudentBodyBytes, &body); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if app.Attempts == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Attempt service is unavailable."))
			return
		}
		if err := startCodeGateForBearer(r, app, bearer, chi.URLParam(r, "attemptID")); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		// B2: locker routes via RUNTIME_SNAPSHOT (snapshot pre-gate when on,
		// today's FOR UPDATE path when off). Rollback = off.
		res, err := app.Attempts.SaveResponses(r.Context(), bearer, attempts.SaveResponsesCommand{AttemptID: chi.URLParam(r, "attemptID"), LeaseEpoch: body.LeaseEpoch, ControlEpoch: body.ControlEpoch, Commands: body.Commands, ModuleClose: body.ModuleClose}, v2Resolver{}, app.RuntimeLockerFor())
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
		if app.Attempts == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Attempt service is unavailable."))
			return
		}
		if err := startCodeGateForBearer(r, app, bearer, attemptID); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		cmd := attempts.SubmitCommand{AttemptID: attemptID, LeaseEpoch: body.LeaseEpoch, ExpectedControlEpoch: body.ControlEpoch, SubmissionID: body.SubmissionID, FinalCommands: body.FinalCommands, ActorKind: "student"}
		if body.ExpectedAttemptRevision > 0 {
			v := body.ExpectedAttemptRevision
			cmd.ExpectedRevision = &v
		}
		// The provider is resolved by v2ProviderResolver on the submit
		// transaction itself (attempts.ProviderResolver), never here.
		res, err := app.Attempts.Submit(r.Context(), bearer, cmd, v2Resolver{}, app.RuntimeLockerFor(), v2ProviderResolver{}, terminalSealer{scorer: app.ACT, materializer: app.Terminal, outboxExecOnly: app.Config.OutboxExecOnly})
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

// v2AckColumns is the acknowledgement projection shared by the batched and
// the single-id lookup.
const v2AckColumns = `SELECT client_write_id, question_id, client_version, outcome, server_revision, response_hash, CAST(canonical_response AS CHAR) FROM attempt_mutations_v2 WHERE attempt_id = ? AND `

// loadV2Acknowledgements returns the stored ack for each write id, in the
// given order, skipping ids with no ledger row. The immutable ledger rows are
// read with one IN statement per attempts.MaxBatchCommands distinct ids
// (a validated submit carries at most that many) instead of one per id.
func loadV2Acknowledgements(ctx context.Context, db *sql.DB, attemptID string, writeIDs []string) ([]attempts.Ack, error) {
	acks := make([]attempts.Ack, 0, len(writeIDs))
	if len(writeIDs) == 0 {
		return acks, nil
	}
	unique := make([]string, 0, len(writeIDs))
	seen := make(map[string]struct{}, len(writeIDs))
	for _, writeID := range writeIDs {
		if _, ok := seen[writeID]; !ok {
			seen[writeID] = struct{}{}
			unique = append(unique, writeID)
		}
	}
	stored := make(map[string]v2StoredAck, len(unique))
	for start := 0; start < len(unique); start += attempts.MaxBatchCommands {
		chunk := unique[start:min(start+attempts.MaxBatchCommands, len(unique))]
		args := make([]any, 0, len(chunk)+1)
		args = append(args, attemptID)
		for _, writeID := range chunk {
			args = append(args, writeID)
		}
		if err := scanV2Acks(ctx, db, v2AckColumns+"client_write_id IN ("+sqlPlaceholders(len(chunk))+")", args, stored); err != nil {
			return nil, err
		}
	}
	for _, writeID := range writeIDs {
		row, ok := stored[writeID]
		if !ok {
			// client_write_id compares under utf8mb4_unicode_ci, so a stored id
			// may differ in bytes from the requested one; the single-id lookup
			// keeps that collation-equal match exactly as before.
			var found bool
			var err error
			row, found, err = loadV2AckByWriteID(ctx, db, attemptID, writeID)
			if err != nil {
				return nil, err
			}
			if !found {
				continue
			}
		}
		ack := row.ack
		if err := json.Unmarshal([]byte(row.raw), &ack.CanonicalResponse); err != nil {
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

// v2StoredAck is one ledger row before its canonical response is decoded.
type v2StoredAck struct {
	ack attempts.Ack
	raw string
}

func scanV2Acks(ctx context.Context, db *sql.DB, query string, args []any, into map[string]v2StoredAck) error {
	rows, err := db.QueryContext(ctx, query, args...)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var row v2StoredAck
		if err := rows.Scan(&row.ack.WriteID, &row.ack.QuestionID, &row.ack.ClientVersion, &row.ack.Outcome, &row.ack.ServerRevision, &row.ack.ContentHash, &row.raw); err != nil {
			return err
		}
		into[row.ack.WriteID] = row
	}
	return rows.Err()
}

func loadV2AckByWriteID(ctx context.Context, db *sql.DB, attemptID, writeID string) (v2StoredAck, bool, error) {
	var row v2StoredAck
	err := db.QueryRowContext(ctx, v2AckColumns+"client_write_id = ?", attemptID, writeID).
		Scan(&row.ack.WriteID, &row.ack.QuestionID, &row.ack.ClientVersion, &row.ack.Outcome, &row.ack.ServerRevision, &row.ack.ContentHash, &row.raw)
	if err == sql.ErrNoRows {
		return row, false, nil
	}
	return row, err == nil, err
}

// v2ProviderResolver implements attempts.ProviderResolver: the provider
// identity decision is taken inside the submit transaction, on the same
// connection that holds the attempt row lock.
type v2ProviderResolver struct{}

var _ attempts.ProviderResolver = v2ProviderResolver{}

func (v2ProviderResolver) ResolveProvider(ctx context.Context, q tx.Tx, attemptID string) (attempts.Provider, error) {
	return loadSubmitProvider(ctx, q, attemptID)
}

// loadSubmitProvider reads the attempt's exam identity and applies the central
// effective-provider rule. It takes a tx.Tx (not a pool) on purpose: provider
// identity is only ever decided under the attempt row lock. A missing attempt is
// a 404; an unrecognised provider_key is refused (422).
func loadSubmitProvider(ctx context.Context, q tx.Tx, attemptID string) (attempts.Provider, error) {
	var provider, examType sql.NullString
	err := q.QueryRowContext(ctx, `SELECT e.provider_key, e.exam_type FROM student_attempts a JOIN exam_entities e ON e.id = a.exam_id WHERE a.id = ?`, attemptID).Scan(&provider, &examType)
	if err == sql.ErrNoRows {
		return "", apperrors.New(apperrors.CodeNotFound, "Attempt not found.")
	}
	if err != nil {
		return "", err
	}
	return effectiveProviderForSubmit(provider.String, examType.String)
}

// effectiveProviderForSubmit mirrors exams.EffectiveProviderKey without
// importing the exams package at the HTTP edge: exam_type ACT always wins, so
// legacy ACT rows (provider_key='ielts', exam_type='ACT') route to the ACT
// direct-seal path instead of the IELTS path (Phase 02 blocker 4).
//
// A blank/NULL provider_key is the legacy IELTS identity, not an unresolvable
// row: older schemas declared provider_key nullable and predate sat/act, so
// those exams previously submitted through the IELTS path and still must. (Data
// check: the only blank rows in any local database carry exam_type='Academic'.)
// Only an unrecognised NON-BLANK key is refused — that is the genuinely
// unresolvable case, and it used to be forwarded verbatim into the terminal
// write, sealing an unscored attempt.
func effectiveProviderForSubmit(providerKey, examType string) (attempts.Provider, error) {
	if strings.EqualFold(strings.TrimSpace(examType), "ACT") {
		return attempts.ProviderACT, nil
	}
	switch key := strings.ToLower(strings.TrimSpace(providerKey)); key {
	case "":
		return attempts.ProviderIELTS, nil
	case string(attempts.ProviderIELTS):
		return attempts.ProviderIELTS, nil
	case string(attempts.ProviderSAT):
		return attempts.ProviderSAT, nil
	case string(attempts.ProviderACT):
		return attempts.ProviderACT, nil
	default:
		return "", apperrors.New(apperrors.CodeUnsupportedProvider, "The exam provider identity is unknown; refusing to submit.")
	}
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
			writeAttemptVerificationError(w, r, verr)
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
		snapshot, err := app.DB.BeginTx(r.Context(), &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		defer snapshot.Rollback()
		var (
			proto, lease, control     sql.NullInt64
			delivery, schedID, userID sql.NullString
			respRev                   sql.NullInt64
			deadline, grace           sql.NullTime
		)
		err = snapshot.QueryRowContext(r.Context(), `SELECT protocol_version, delivery_status, lease_epoch, control_epoch, response_revision, deadline_at, closing_grace_until, schedule_id, user_id FROM student_attempts WHERE id = ?`, attemptID).Scan(&proto, &delivery, &lease, &control, &respRev, &deadline, &grace, &schedID, &userID)
		if err == sql.ErrNoRows {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeNotFound, "Attempt not found."))
			return
		}
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		rows, err := snapshot.QueryContext(r.Context(), `SELECT question_id, client_write_id, client_version, server_revision, response_hash, CAST(response AS CHAR) FROM attempt_responses_v2 WHERE attempt_id = ? ORDER BY question_id`, attemptID)
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
			Wcode           string  `json:"wcode"`
			Email           string  `json:"email"`
			StudentName     string  `json:"studentName"`
			ScheduleID      string  `json:"scheduleId"`
			AccessLinkID    string  `json:"accessLinkId"`
			LinkToken       string  `json:"linkToken"`
			CaptchaToken    string  `json:"captchaToken"`
			EntrySession    string  `json:"entrySession"`
			ClientSessionID string  `json:"clientSessionId"`
			Nickname        *string `json:"nickname"`
			IELTSCourse     *string `json:"ieltsCourse"`
			// Configurable SAT registration answers; omitted on legacy forms.
			RegistrationForm *assessmentforms.RegistrationSubmission `json:"registrationForm"`
		}
		if err := httpx.DecodeLimited(r, httpx.MaxAdminBodyBytes, &body); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if strings.TrimSpace(body.ClientSessionID) != "" {
			clientSessionID, parseErr := uuid.Parse(strings.TrimSpace(body.ClientSessionID))
			if parseErr != nil {
				httpx.WriteError(w, r, apperrors.New(apperrors.CodeValidation, "clientSessionId must be a UUID."))
				return
			}
			body.ClientSessionID = clientSessionID.String()
		}
		if (strings.TrimSpace(body.Wcode) == "" && strings.TrimSpace(body.AccessLinkID) == "") || strings.TrimSpace(body.Email) == "" || strings.TrimSpace(body.StudentName) == "" {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeBadRequest, "Student ID/WCODE, email and student name are required."))
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
		entryKey := "entry:" + strings.ToLower(strings.TrimSpace(body.Email)) + "|" + httpx.ClientIPKey(r)
		if res := studentEntryBucket(entryKey); !res.Allowed {
			httpx.WriteRateLimitExceeded(w, r, "student-entry", "ip", res.RetryAfter)
			return
		}
		owned, recoveryErr := lookupOwnEntry(r, app, scheduleID, linkID, body.EntrySession, body.Wcode, body.ClientSessionID)
		if recoveryErr != nil {
			httpx.WriteError(w, r, MapDBError(recoveryErr))
			return
		}
		if owned != nil {
			writeStudentEntry(w, r, app, *owned)
			return
		}
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
				httpx.WriteError(w, r, apperrors.New(apperrors.CodeBadRequest, "Student ID/WCODE is required for this Student Link."))
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
		email := strings.ToLower(strings.TrimSpace(body.Email))
		var userID, displayName string
		proof := auth.SessionProof{Source: auth.SessionSourcePractice, PracticeScheduleID: scheduleID}
		// Existing-account association requires an independently authenticated
		// student session and CSRF proof; public display email is never authority.
		if sess := SessionOf(r.Context()); sess != nil && sess.Role == auth.RoleStudent && sess.Proof.Source == auth.SessionSourceAccount {
			var accountEmail, state string
			err := app.DB.QueryRowContext(r.Context(), "SELECT email, state, COALESCE(display_name, '') FROM users WHERE id = ?", sess.UserID).Scan(&accountEmail, &state, &displayName)
			if err != nil {
				httpx.WriteError(w, r, MapDBError(err))
				return
			}
			if strings.EqualFold(accountEmail, email) && state == "active" {
				if err := auth.VerifyCSRF(r, sess.CSRFToken); err != nil {
					httpx.WriteError(w, r, err)
					return
				}
				userID = sess.UserID
				proof = auth.SessionProof{Source: auth.SessionSourceAccount}
			}
		}
		if userID == "" {
			var err error
			userID, displayName, err = practiceEntryPrincipal(r.Context(), app.DB, scheduleID, body.EntrySession, body.StudentName)
			if err != nil {
				httpx.WriteError(w, r, MapDBError(err))
				return
			}
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
		clientSessionID := strings.TrimSpace(body.ClientSessionID)
		if clientSessionID == "" {
			clientSessionID = uuid.NewString()
		}
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
		writeStudentEntry(w, r, app, studentEntryIdentity{
			UserID: userID, DisplayName: displayName, Email: email, ScheduleID: scheduleID,
			Code: wcode, AttemptID: att.AttemptID, ClientSessionID: clientSessionID, Proof: proof,
			Registration: body.RegistrationForm,
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
		out, err := app.Schedules.GetStudentEntry(r.Context(), chi.URLParam(r, "id"))
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		var form *assessmentforms.PublicRegistrationForm
		if app.DB != nil {
			if form, err = assessmentforms.ScheduleRegistrationForm(r.Context(), app.DB, out.ID); err != nil {
				httpx.WriteError(w, r, MapDBError(err))
				return
			}
		}
		httpx.WriteJSON(w, http.StatusOK, struct {
			schedules.Schedule
			RegistrationForm *assessmentforms.PublicRegistrationForm `json:"registrationForm"`
		}{out, form})
	}
}
