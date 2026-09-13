// Phase 02: transactional persistence of the Phase 01 domain contract.
// This file is the ONLY place that knows how an Event maps onto the generic
// live-update bus. event.go (Phase 01) stays transport-agnostic: it owns the
// envelope, vocabulary, validation, and ordering helpers and is not modified
// by persistence work.
package authoringrealtime

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"example.com/ielts-proctoring/internal/liveupdates"
	"example.com/ielts-proctoring/internal/platform/tx"
)

// BusEventKind is the live_update_events.event_kind value for authoring rows.
// The generic bus treats kind as data, so no liveupdates change is needed.
const BusEventKind = "authoring"

// MaxPayloadBytes bounds one authoring payload. Real events are hundreds of
// bytes (ids + revisions only); the cap fails a runaway producer fast.
const MaxPayloadBytes = 4096

// EventInput carries everything one authoring event needs. There is
// deliberately no content field: prompt/stimulus/answer/rationale VALUES can
// never enter the envelope by construction.
type EventInput struct {
	Kind Kind

	// OrganizationID is nil for platform-scope exams (exam_entities
	// .organization_id IS NULL). Never pass "" to mean platform scope: an
	// empty string would also match a missing field or a failed query.
	OrganizationID *string

	ExamID         string
	DraftVersionID string

	// DraftRevision is the working-draft generation AFTER the in-tx bump.
	// It becomes the bus row's event_revision. State hint only: Undo can
	// move it backwards, so it must NEVER order events (sequence_id does).
	DraftRevision int

	// Revision is the affected entity's fencing revision when applicable
	// (e.g. the question revision after a save); 0 for draft/exam events.
	Revision int

	// ActorID is the server-resolved staff user. Never from a request body.
	ActorID string

	Entity Entity

	ChangedFields           []string
	AffectedExamQuestionIDs []string
	CausationID             string

	// EventID and OccurredAt are injectable so tests stay deterministic.
	// Empty/zero values are filled with uuid + now(UTC).
	EventID    string
	OccurredAt time.Time
}

// NewEvent validates producer semantics and returns the domain event.
// Construction (domain) and transport adaptation (AppendInTx) are separate
// responsibilities on purpose.
//
// The transport cursor is NOT set here: it is added when the frame is
// constructed (Phase 03) from live_update_events.sequence_id.
func NewEvent(in EventInput) (Event, error) {
	eventID := strings.TrimSpace(in.EventID)
	if eventID == "" {
		eventID = uuid.NewString()
	}
	occurredAt := in.OccurredAt
	if occurredAt.IsZero() {
		occurredAt = time.Now()
	}
	evt := Event{
		Version:    Version,
		Kind:       in.Kind,
		EventID:    eventID,
		OccurredAt: occurredAt.UTC(),
		Actor:      Actor{ID: in.ActorID, Kind: "staff"},
		Scope: Scope{
			OrganizationID: in.OrganizationID,
			ExamID:         in.ExamID,
			DraftVersionID: in.DraftVersionID,
		},
		Entity:                  in.Entity,
		Revision:                in.Revision,
		DraftRevision:           in.DraftRevision,
		ChangedFields:           in.ChangedFields,
		AffectedExamQuestionIDs: in.AffectedExamQuestionIDs,
		CausationID:             in.CausationID,
	}
	if err := evt.ValidateForEmit(); err != nil {
		return Event{}, err
	}
	raw, err := json.Marshal(evt)
	if err != nil {
		return Event{}, fmt.Errorf("authoringrealtime: marshal envelope: %w", err)
	}
	if len(raw) > MaxPayloadBytes {
		return Event{}, fmt.Errorf("authoringrealtime: payload %d bytes exceeds %d", len(raw), MaxPayloadBytes)
	}
	return evt, nil
}

// AppendInTx inserts one authoring bus row inside the caller's business
// transaction, so the domain mutation, the bus row, and the operation-key
// result commit or roll back together.
//
// Bus mapping (EXAM-scoped routing):
//
//	event_kind      = "authoring"
//	event_target_id = examId         (the durable collaboration scope)
//	event_revision  = draftRevision  (state hint, not an ordering key)
//	event_name      = event.Kind
//
// Routing at exam scope rather than draft scope is deliberate: a draft is
// replaceable state. Undo can swap the working draft (7 -> 4) while
// collaborators stay subscribed, and a draft-scoped stream would silently
// deliver nothing to them exactly when the replacement must be announced.
// Subscribers receive the event and compare scope.draftVersionId against
// their own draft to choose content vs lifecycle reconciliation.
func AppendInTx(ctx context.Context, q tx.Tx, origin string, event Event) error {
	if err := event.ValidateForEmit(); err != nil {
		return err
	}
	return liveupdates.AppendInTx(
		ctx, q, origin, BusEventKind,
		event.Scope.ExamID, int64(event.DraftRevision), string(event.Kind),
		event,
	)
}

// ValidateEmitterConfig fails closed at startup when the events flag is on
// but no live bus origin was resolved. The flag must disable the capability
// deliberately; it must never mask broken wiring by silently degrading to
// flag-off behavior.
func ValidateEmitterConfig(eventsEnabled bool, origin string) error {
	if eventsEnabled && strings.TrimSpace(origin) == "" {
		return fmt.Errorf("authoringrealtime: %s is enabled but the live bus is not configured; refusing to start with events silently disabled", EnvEvents)
	}
	return nil
}

// PublishError marks an in-tx event-append failure. Callers classify it as
// outcome=publish_failed (distinct from a fence collision or validation
// rejection) without changing any HTTP status contract.
type PublishError struct{ Err error }

func (e *PublishError) Error() string {
	return "authoringrealtime: event publish failed: " + e.Err.Error()
}

// Unwrap exposes the cause to errors.Is/As chains.
func (e *PublishError) Unwrap() error { return e.Err }

// IsPublishError reports whether err (or a wrapper) is an append failure.
func IsPublishError(err error) bool {
	var target *PublishError
	return errors.As(err, &target)
}

// WrapPublishError classifies a builder/append error for the caller.
func WrapPublishError(err error) error {
	if err == nil {
		return nil
	}
	return &PublishError{Err: err}
}
