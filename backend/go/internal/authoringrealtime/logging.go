// Phase 06 structured logging for the authoring realtime paths.
//
// The risk this file exists to remove: realtime debugging is exactly the
// situation where someone reaches for "just log the event so I can see it",
// and the event carries question text. So the field set is ALLOW-LISTED (the
// type has no way to hold content) and every value passes a shape guard, which
// rejects prose, JSON blobs, and anything else that is not an identifier-like
// token. A stem, a rationale, or a serialized draft therefore cannot be logged
// even by a caller that tries.
//
// The companion test (logging_test.go) pushes a complete, realistic question
// draft through every field and asserts no content token survives.
package authoringrealtime

import (
	"fmt"
	"log"
	"regexp"
	"strings"
)

// Log components. Closed set: a component name is a dashboard grouping key.
const (
	ComponentPublish    = "authoring-publish"
	ComponentSubscribe  = "authoring-subscribe"
	ComponentForwarder  = "authoring-forwarder"
	ComponentReconciler = "authoring-reconciler"
	ComponentRetention  = "authoring-retention"
	ComponentPresence   = "authoring-presence"
)

// Log events. Closed set, so the same condition always has the same name.
const (
	EventSubscribeAccepted = "subscribe_accepted"
	EventReplayStarted     = "replay_started"
	EventDelivered         = "event_delivered"
	EventGapDetected       = "gap_detected"
	EventSnapshotRecovery  = "snapshot_recovery"
	EventRevisionFenced    = "revision_fenced"
	EventConflictSurfaced  = "conflict_surfaced"
	EventPresenceBeat      = "presence_beat"
	EventRetentionPurge    = "retention_purge"
	EventPublishFailed     = "publish_failed"
	EventDisconnected      = "disconnected"
	EventFrameRejected     = "frame_rejected"
)

// maxFieldLen bounds one logged value. Ids and enums are far shorter; the cap
// is what stops a runaway value from ever reaching a log line.
const maxFieldLen = 64

// fieldShape accepts identifier-like tokens only: ids, enums, uuids, kinds,
// paths, timestamps. Prose fails it (spaces and punctuation), and so does a
// JSON blob. This is the redaction control, and it is deliberately a SHAPE test
// rather than a block-list of words: a block-list only ever catches the leakage
// someone already thought of.
//
// Note what is NOT in the charset: `@`. An email address is identifier-shaped
// in every other respect, and the guard test caught exactly that hole — a
// student address sailed through as `component=stu_...@example.com`.
var fieldShape = regexp.MustCompile(`^[A-Za-z0-9._:/-]{1,` + fmt.Sprint(maxFieldLen) + `}$`)

// fieldHasLetter rejects values that are purely numeric. No allow-listed field
// is a bare number: cursors and revisions travel in the integer fields, so a
// digit-only string is either a mistake or an id someone should not be logging
// as free text. A phone number or a numeric identifier therefore degrades to
// `other` instead of being emitted.
var fieldHasLetter = regexp.MustCompile(`[A-Za-z]`)

// SafeField returns value when it is identifier-shaped and `other` otherwise.
// An empty input stays empty so optional fields do not print a bogus `other`.
func SafeField(value string) string {
	if value == "" {
		return ""
	}
	if !fieldShape.MatchString(value) {
		return ReasonOther
	}
	if !fieldHasLetter.MatchString(value) {
		return ReasonOther
	}
	// A URL is identifier-shaped too (the charset allows `:` and `/`), but no
	// authoring field is ever a URL, and media paths are exactly the kind of
	// thing that should not be in a log line.
	if strings.Contains(value, "://") {
		return ReasonOther
	}
	return value
}

// LogFields is the complete, allow-listed field set for one authoring line.
// Adding a field to this struct is the only way to log something new, which is
// what makes "no content creep" a code-review-visible event.
type LogFields struct {
	Component      string
	Event          string
	RequestID      string
	ConnectionID   string
	OrganizationID string
	ExamID         string
	DraftVersionID string
	EventKind      string
	Cursor         int64
	Revision       int
	Result         string
	DurationMS     int64
}

// String renders the fields as ordered key=value pairs. Only non-empty fields
// appear, so a line stays short enough to read during an incident.
func (f LogFields) String() string {
	var parts []string
	add := func(key, value string) {
		if value == "" {
			return
		}
		parts = append(parts, key+"="+SafeField(value))
	}
	add("component", f.Component)
	add("event", f.Event)
	add("request_id", f.RequestID)
	add("connection_id", f.ConnectionID)
	add("organization_id", f.OrganizationID)
	add("exam_id", f.ExamID)
	add("draft_version_id", f.DraftVersionID)
	add("event_kind", f.EventKind)
	if f.Cursor != 0 {
		parts = append(parts, fmt.Sprintf("cursor=%d", f.Cursor))
	}
	if f.Revision != 0 {
		parts = append(parts, fmt.Sprintf("revision=%d", f.Revision))
	}
	add("result", f.Result)
	if f.DurationMS != 0 {
		parts = append(parts, fmt.Sprintf("duration_ms=%d", f.DurationMS))
	}
	return strings.Join(parts, " ")
}

// LogAuthoring writes one redaction-safe authoring line. The prefix keeps the
// existing `api:`/`worker:` log-grep conventions intact.
func LogAuthoring(prefix string, f LogFields) {
	log.Printf("%s: %s", prefix, f.String())
}
