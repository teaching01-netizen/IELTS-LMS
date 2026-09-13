package exams

import (
	"database/sql"
	"strings"

	"example.com/ielts-proctoring/internal/authoringrealtime"
	"example.com/ielts-proctoring/internal/platform/telemetry"
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

// eventsOn reports whether this service appends authoring events. Startup
// validation refuses to boot a flag-on process with no bus origin, so this is
// a wiring check for tests, never a silent production fallback.
func (s *Service) eventsOn() bool {
	return s != nil && s.eventsEnabled && strings.TrimSpace(s.liveOrigin) != ""
}

// eventEmission records what one mutation appended so telemetry is emitted
// only AFTER the transaction commits. Counting inside the tx would report
// events that a later rollback (or a failed COMMIT) erased.
type eventEmission struct {
	operation string
	appended  bool
}

// flush reports the outcome of the finished transaction.
func (e *eventEmission) flush(err error) {
	if e == nil || e.operation == "" {
		return
	}
	if err != nil {
		if authoringrealtime.IsPublishError(err) {
			telemetry.IncCounter(telemetry.MAuthoringEventPublishFailures, "operation", e.operation)
		}
		return
	}
	if e.appended {
		telemetry.IncCounter(telemetry.MAuthoringEventPublishTotal,
			"operation", e.operation, "outcome", telemetry.OutcomeAccepted)
	}
}

// orgPtr converts a nullable organization_id into the envelope's explicit
// platform-vs-tenant signal: NULL -> nil (platform scope). An empty string is
// never produced, so "" cannot be confused with a missing field.
func orgPtr(v sql.NullString) *string {
	if !v.Valid {
		return nil
	}
	s := v.String
	return &s
}
