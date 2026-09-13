package authoring

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	"example.com/ielts-proctoring/internal/authoringrealtime"
	"example.com/ielts-proctoring/internal/platform/telemetry"
	"example.com/ielts-proctoring/internal/platform/tx"
)

// SetLive wires this instance's bus origin id (chainable, nil-safe).
func (s *Service) SetLive(origin string) *Service {
	if s != nil {
		s.liveOrigin = origin
	}
	return s
}

// SetEventsEnabled wires the AUTHORING_REALTIME_EVENTS gate (chainable).
func (s *Service) SetEventsEnabled(on bool) *Service {
	if s != nil {
		s.eventsEnabled = on
	}
	return s
}

// eventsOn reports whether this service appends authoring events.
//
// Startup validation (ValidateEmitterConfig) refuses to boot a flag-on
// process whose bus origin is empty, so this predicate is a wiring check for
// tests and non-API entrypoints, never a silent production fallback.
func (s *Service) eventsOn() bool {
	return s != nil && s.eventsEnabled && strings.TrimSpace(s.liveOrigin) != ""
}

// maxAffectedIDsPerEvent bounds the coarse-event id hint list so one payload
// stays far below authoringrealtime.MaxPayloadBytes (ids are ~39 JSON bytes
// each; 64 ids ≈ 2.5 KiB). The list is a hint: receivers refetch the
// authoritative shell regardless, so truncation never loses correctness.
const maxAffectedIDsPerEvent = 64

// boundedIDs truncates an id hint list to the per-event bound.
func boundedIDs(ids []string) []string {
	if len(ids) <= maxAffectedIDsPerEvent {
		return ids
	}
	return ids[:maxAffectedIDsPerEvent]
}

// strPtr is the nullable-string helper for entity refs (questionId/moduleId).
func strPtr(v string) *string { return &v }

// orgPtr converts a nullable organization_id into the envelope's explicit
// platform-vs-tenant signal: NULL -> nil (platform scope). An empty string is
// never produced, so "" cannot be confused with a missing field or a failed
// query.
func orgPtr(v sql.NullString) *string {
	if !v.Valid {
		return nil
	}
	s := v.String
	return &s
}

// authoringScope is the server-resolved tuple for one event. Every field
// comes from locked rows, never from the request body.
//
// Two revisions, deliberately separate:
//
//	Revision      = fencing revision of the affected entity (question
//	                revision after a save); 0 when not applicable.
//	DraftRevision = working-draft generation (exam_versions.revision after
//	                the in-tx bump). A state hint, never an ordering key:
//	                Undo restores an older checkpoint and can move it
//	                backwards, so events are ordered by sequence_id alone.
type authoringScope struct {
	OrganizationID *string
	ExamID         string
	DraftVersionID string
	DraftRevision  int
}

// resolveModuleScopeTx resolves the authoring scope from a module id. Call it
// AFTER touchModuleDraft so DraftRevision is the post-bump generation.
func resolveModuleScopeTx(ctx context.Context, q tx.Tx, moduleID string) (authoringScope, error) {
	var scope authoringScope
	var org sql.NullString
	err := q.QueryRowContext(ctx, `SELECT e.organization_id, e.id, v.id, v.revision
    FROM assessment_modules m
    JOIN assessment_sections s ON s.id = m.section_id
    JOIN exam_versions v ON v.id = s.exam_version_id
    JOIN exam_entities e ON e.id = v.exam_id
    WHERE m.id = ?`, moduleID).Scan(&org, &scope.ExamID, &scope.DraftVersionID, &scope.DraftRevision)
	if err == sql.ErrNoRows {
		return authoringScope{}, notFoundError("Module not found.")
	}
	if err != nil {
		return authoringScope{}, err
	}
	scope.OrganizationID = orgPtr(org)
	return scope, nil
}

// resolveQuestionScopeTx resolves the authoring scope from an exam-question
// id. Used by question-scoped mutations after touchQuestionDraft.
func resolveQuestionScopeTx(ctx context.Context, q tx.Tx, examQuestionID string) (authoringScope, error) {
	var scope authoringScope
	var org sql.NullString
	err := q.QueryRowContext(ctx, `SELECT e.organization_id, e.id, v.id, v.revision
    FROM assessment_exam_questions eq
    JOIN assessment_modules m ON m.id = eq.module_id
    JOIN assessment_sections s ON s.id = m.section_id
    JOIN exam_versions v ON v.id = s.exam_version_id
    JOIN exam_entities e ON e.id = v.exam_id
    WHERE eq.id = ?`, examQuestionID).Scan(&org, &scope.ExamID, &scope.DraftVersionID, &scope.DraftRevision)
	if err == sql.ErrNoRows {
		return authoringScope{}, notFoundError("Question not found.")
	}
	if err != nil {
		return authoringScope{}, err
	}
	scope.OrganizationID = orgPtr(org)
	return scope, nil
}

// resolveDraftScopeTx resolves the authoring scope from a draft version id
// (commit / undo / open / publish paths).
func resolveDraftScopeTx(ctx context.Context, q tx.Tx, draftVersionID string) (authoringScope, error) {
	var scope authoringScope
	var org sql.NullString
	err := q.QueryRowContext(ctx, `SELECT e.organization_id, e.id, v.id, v.revision
    FROM exam_versions v
    JOIN exam_entities e ON e.id = v.exam_id
    WHERE v.id = ?`, draftVersionID).Scan(&org, &scope.ExamID, &scope.DraftVersionID, &scope.DraftRevision)
	if err == sql.ErrNoRows {
		return authoringScope{}, notFoundError("Draft version not found.")
	}
	if err != nil {
		return authoringScope{}, err
	}
	scope.OrganizationID = orgPtr(org)
	return scope, nil
}

// eventEmission records what one mutation appended so telemetry is emitted
// only AFTER the transaction commits.
//
// Metrics must describe committed outcomes, not attempted statements: an
// append that succeeds and is then rolled back (a later statement fails, or
// COMMIT itself fails) must not be counted as published, or the series would
// claim events that do not exist in the table.
type eventEmission struct {
	operation string
	appended  bool
}

// flush reports the outcome of the finished transaction. Call it once, after
// WithTx returns, with that error.
func (e *eventEmission) flush(err error) {
	if e == nil || e.operation == "" {
		return
	}
	if err != nil {
		// Only append failures are publish failures. A fence collision or a
		// validation rejection is a client outcome, not a bus problem.
		if authoringrealtime.IsPublishError(err) {
			// This is the PERSISTENCE failure series, and it stays separate from
			// delivery failures on purpose: the mutation rolled back with it, so
			// it is correctness-adjacent, while a socket write failure leaves
			// canonical state correct. One alert must not cover both.
			telemetry.IncCounter(telemetry.MAuthoringEventPublishFailures, "operation", e.operation)
		}
		return
	}
	if e.appended {
		telemetry.IncCounter(telemetry.MAuthoringEventPublishTotal,
			"operation", e.operation, "outcome", telemetry.OutcomeAccepted)
	}
}

// appendAuthoringEventTx is the single place authoring mutations emit events.
// It runs on the caller's tx handle, so the domain write, the bus row, and
// the operation-key result commit atomically; a rollback leaves no event.
//
// Callers gate on eventsOn() BEFORE calling, so a flag-off service never
// touches the bus and never issues the extra scope read. Append failures are
// classified as publish_failed and returned, failing the mutation: a
// committed mutation with no event would silently fork editors until the next
// poll, which is worse than a clean retryable error.
func (s *Service) appendAuthoringEventTx(ctx context.Context, q tx.Tx, emission *eventEmission, operation string, scope authoringScope, input authoringrealtime.EventInput) error {
	input.OrganizationID = scope.OrganizationID
	input.ExamID = scope.ExamID
	input.DraftVersionID = scope.DraftVersionID
	input.DraftRevision = scope.DraftRevision
	evt, err := authoringrealtime.NewEvent(input)
	if err == nil {
		err = authoringrealtime.AppendInTx(ctx, q, s.liveOrigin, evt)
	}
	if err != nil {
		if emission != nil {
			emission.operation = operation
		}
		return authoringrealtime.WrapPublishError(err)
	}
	if emission != nil {
		emission.operation = operation
		emission.appended = true
	}
	return nil
}

// eventScopeDebug renders a scope for logs without leaking content (ids only).
func eventScopeDebug(scope authoringScope) string {
	return fmt.Sprintf("exam=%s draft=%s draftRev=%d", scope.ExamID, scope.DraftVersionID, scope.DraftRevision)
}
