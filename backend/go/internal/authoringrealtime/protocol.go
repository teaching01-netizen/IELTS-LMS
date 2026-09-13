package authoringrealtime

import (
	"encoding/json"
	"fmt"
	"strings"
)

// Phase 03 transport protocol. These frames travel over the SAME WebSocket
// transport as the runtime/proctor socket (same upgrade lifecycle, lease,
// admission, ping/lease heartbeats), but they use their OWN "type" strings:
// runtime frames are never reused or overloaded.
//
// Versioning rule (mixed-version deploys): every frame carries "v": 1.
// Receivers IGNORE unknown optional fields and REJECT unknown types. Event
// payloads additionally keep the Phase 01 rule: unknown future KINDS are
// tolerated and resolve to an authoritative refetch, never to interpretation.
//
// The transport cursor is NOT part of the domain envelope (Phase 01 rule).
// It travels on the frame, sourced from live_update_events.sequence_id.

// ProtocolVersion is the only frame version Phase 03 defines.
const ProtocolVersion = 1

// Frame type strings. Frozen vocabulary; additions need a version review.
const (
	FrameTypeSubscribe        = "authoring.subscribe"
	FrameTypeSubscribed       = "authoring.subscribed"
	FrameTypeEvent            = "authoring.event"
	FrameTypeSnapshotRequired = "authoring.snapshot_required"
	FrameTypeError            = "authoring.error"
	FrameTypeCapabilities     = "authoring.capabilities"
)

// SnapshotReason explains why a client must refetch authoritatively. The
// reason is truthful: a client (and Phase 06 telemetry) must be able to tell a
// genuinely expired cursor from a queue overflow or an unreadable event.
type SnapshotReason string

const (
	// ReasonCursorTooOld: the cursor predates the global retention watermark,
	// so the events it needs are definitely gone.
	ReasonCursorTooOld SnapshotReason = "cursor_too_old"
	// ReasonReplayTooLarge: more history exists than the bounded replay is
	// willing to stream. No partial stream is ever sent.
	ReasonReplayTooLarge SnapshotReason = "replay_too_large"
	// ReasonDeliveryGap: this socket fell behind and the hub dropped at least
	// one event for it (queue overflow).
	ReasonDeliveryGap SnapshotReason = "delivery_gap"
	// ReasonUnsupportedEvent: a retained event could not be safely interpreted
	// (malformed, or a version this server must not execute). Refetch rather
	// than guess.
	ReasonUnsupportedEvent SnapshotReason = "unsupported_event"
)

// SubscribeFrame is the ONLY client -> server frame Phase 03 defines.
// examId is the only client-supplied identity: org, draft, and actor are
// always server-derived. lastSeenCursor absent = fresh subscribe (no replay);
// present = resume from that cursor.
//
// The cursor is deliberately named "cursor", not "sequenceId": a client MUST
// treat it as an opaque, non-contiguous position (skipped values belong to
// other exams and kinds) and must never do arithmetic on it.
type SubscribeFrame struct {
	Type           string `json:"type"`
	V              int    `json:"v"`
	ExamID         string `json:"examId"`
	LastSeenCursor *int64 `json:"lastSeenCursor,omitempty"`
}

// SubscribedFrame is the handshake ack. draftVersionId and barrierCursor are
// SERVER-resolved at subscribe time; a client can never pick either.
//
// barrierCursor splits ownership: replay covers (lastSeenCursor, barrierCursor]
// and live delivery covers (barrierCursor, ...]. Exactly one side owns every
// event, so a resume can neither duplicate nor skip.
type SubscribedFrame struct {
	Type           string `json:"type"`
	V              int    `json:"v"`
	ExamID         string `json:"examId"`
	DraftVersionID string `json:"draftVersionId"`
	BarrierCursor  int64  `json:"barrierCursor"`
	// ConnectionID is this socket's presence identity, stamped only when
	// presence is negotiated. Additive + optional, so a v1 reader that does not
	// know about presence simply ignores it. A client needs it to exclude
	// ITSELF from presence while still seeing the same user's other tabs, which
	// arrive under different connection ids.
	ConnectionID string `json:"connectionId,omitempty"`
}

// EventFrameV1 carries one durable authoring event plus its transport cursor.
// The cursor lives ONLY here, never inside the domain event: the envelope is
// transport-agnostic (Phase 01 boundary rule).
type EventFrameV1 struct {
	Type   string `json:"type"`
	V      int    `json:"v"`
	Cursor int64  `json:"cursor"`
	Event  Event  `json:"event"`
}

// SnapshotRequiredFrameV1 tells the client its cursor is unrecoverable: it
// must refetch via authoritative HTTP. The connection STAYS OPEN for new
// events; only a slow-client drop closes it.
type SnapshotRequiredFrameV1 struct {
	Type           string         `json:"type"`
	V              int            `json:"v"`
	ExamID         string         `json:"examId"`
	DraftVersionID string         `json:"draftVersionId"`
	Reason         SnapshotReason `json:"reason"`
}

// ErrorFrameV1 uses the stable error-code vocabulary (details.authoringReason
// values plus BAD_REQUEST for malformed frames).
type ErrorFrameV1 struct {
	Type    string `json:"type"`
	V       int    `json:"v"`
	Code    string `json:"code"`
	Message string `json:"message"`
}

// CapabilitiesFrame is the negotiated posture. The frontend kill switch can
// only DISABLE a granted capability, never enable a withheld one.
type CapabilitiesFrame struct {
	Type            string `json:"type"`
	V               int    `json:"v"`
	Delivery        bool   `json:"delivery"`
	Presence        bool   `json:"presence"`
	ConflictCompare bool   `json:"conflictCompare"`
}

// ErrorCodeBadRequest is the only code Phase 03 mints itself; every other
// code comes from the Phase 01 DomainCode vocabulary.
const ErrorCodeBadRequest = "BAD_REQUEST"

// MaxIDLength bounds client-supplied identifiers (matches the zod contract).
const MaxIDLength = 128

// ParseSubscribeFrame validates one client subscribe frame.
//
// Strictness: examId must be non-empty after trimming, the cursor must be a
// non-negative integer, the type must match exactly, and (when expectedExamID
// is supplied) examId must equal the identity already authorized BEFORE the
// upgrade. That last check is a confused-deputy defense: a socket authorized
// for exam A must never be rebound to exam B by a post-upgrade frame.
//
// Unknown optional fields are ignored (additive v1 evolution).
func ParseSubscribeFrame(raw []byte, expectedExamID string) (SubscribeFrame, error) {
	var frame SubscribeFrame
	if err := json.Unmarshal(raw, &frame); err != nil {
		return SubscribeFrame{}, fmt.Errorf("authoring.subscribe must be a JSON object")
	}
	if strings.TrimSpace(frame.Type) != FrameTypeSubscribe {
		return SubscribeFrame{}, fmt.Errorf("expected type %s", FrameTypeSubscribe)
	}
	if frame.V != ProtocolVersion {
		return SubscribeFrame{}, fmt.Errorf("unsupported protocol version %d", frame.V)
	}
	examID := strings.TrimSpace(frame.ExamID)
	if examID == "" {
		return SubscribeFrame{}, fmt.Errorf("examId is required")
	}
	if len(examID) > MaxIDLength {
		return SubscribeFrame{}, fmt.Errorf("examId is too long")
	}
	if expectedExamID != "" && examID != strings.TrimSpace(expectedExamID) {
		return SubscribeFrame{}, fmt.Errorf("examId does not match the authorized subscription")
	}
	if frame.LastSeenCursor != nil && *frame.LastSeenCursor < 0 {
		return SubscribeFrame{}, fmt.Errorf("lastSeenCursor must be >= 0")
	}
	frame.ExamID = examID
	return frame, nil
}

// Subscribed builds the handshake ack.
func Subscribed(b Binding, barrierCursor int64) SubscribedFrame {
	return SubscribedFrame{
		Type:           FrameTypeSubscribed,
		V:              ProtocolVersion,
		ExamID:         b.ExamID,
		DraftVersionID: b.DraftVersionID,
		BarrierCursor:  barrierCursor,
	}
}

// EventFrame wraps one bus event. The payload is the Phase 01 envelope; the
// cursor is the bus sequence. A payload that no longer parses is returned as
// an error so the caller can drop it rather than forward garbage.
func EventFrame(cursor int64, payload []byte) (EventFrameV1, error) {
	evt, err := Parse(payload)
	if err != nil {
		return EventFrameV1{}, err
	}
	return EventFrameV1{Type: FrameTypeEvent, V: ProtocolVersion, Cursor: cursor, Event: evt}, nil
}

// SnapshotRequired builds the cursor-unrecoverable frame.
func SnapshotRequired(b Binding, reason SnapshotReason) SnapshotRequiredFrameV1 {
	return SnapshotRequiredFrameV1{
		Type:           FrameTypeSnapshotRequired,
		V:              ProtocolVersion,
		ExamID:         b.ExamID,
		DraftVersionID: b.DraftVersionID,
		Reason:         reason,
	}
}

// ErrorFrame builds one protocol error frame from a domain code.
func ErrorFrame(code DomainCode, message string) ErrorFrameV1 {
	return ErrorFrameV1{Type: FrameTypeError, V: ProtocolVersion, Code: string(code), Message: message}
}

// BadRequestFrame builds a malformed-frame error.
func BadRequestFrame(message string) ErrorFrameV1 {
	return ErrorFrameV1{Type: FrameTypeError, V: ProtocolVersion, Code: ErrorCodeBadRequest, Message: message}
}

// CapabilitiesFrameFor renders the negotiated posture for one binding.
func CapabilitiesFrameFor(b Binding) CapabilitiesFrame {
	return CapabilitiesFrame{
		Type:            FrameTypeCapabilities,
		V:               ProtocolVersion,
		Delivery:        b.DeliveryEnabled,
		Presence:        b.PresenceEnabled,
		ConflictCompare: b.ConflictCompareEnabled,
	}
}

// IsLifecycleRebind reports whether an event invalidates the bound draft, so
// the connection must forward it once and then close. The client re-subscribes
// against the new draft; HTTP writes against the stale draft already fail 409.
//
// draft.replaced covers Undo, workbook commit / sample load, and Publish
// (which removes the working draft with no successor); exam.published is
// included explicitly so a publisher path that ever stops emitting
// draft.replaced still rebinds clients.
func IsLifecycleRebind(evt Event) bool {
	switch evt.Kind {
	case KindDraftReplaced, KindExamPublished:
		return true
	default:
		return false
	}
}
