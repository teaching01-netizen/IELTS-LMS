// Phase 05 presence: ephemeral, TTL-bounded, content-free collaboration
// signals over the Phase 03 authoring socket.
//
// Presence is deliberately NOT a durable bus event. It is high-frequency,
// worthless once stale, and must never touch MySQL: a durable row per
// selection change would dwarf the authoring event volume and force retention
// decisions on data with a 15-second useful life. It therefore lives in this
// process-local registry instead of the DB-backed liveupdates bus.
//
// Consequences, stated plainly:
//
//   - Presence is SINGLE-INSTANCE. Durable authoring events reach every
//     instance through live_update_events; presence does not. Behind a load
//     balancer, two collaborators on different instances will not see each
//     other's presence (they still receive each other's saved changes).
//   - Presence is ADVISORY. Nothing in the correctness path (fencing,
//     divergence, recovery) reads it, so a dropped frame is never a bug:
//     it self-heals on the next refresh or TTL sweep.
//
// The payload ban is structural, not a convention: PresenceEnvelope has no
// field that can carry stimulus, prompt, choices, answer key, rationale,
// metadata, or accessibility content. There is nowhere to put them.
package authoringrealtime

import (
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"
)

// Presence frame type + state vocabulary. Frozen: additions need a version
// review, matching the rest of the Phase 03 frame set.
const (
	FrameTypePresence = "authoring.presence"

	PresenceStateViewing = "viewing"
	PresenceStateEditing = "editing"
	PresenceStateIdle    = "idle"
)

// Presence bounds. Every one of these exists to keep an advisory channel from
// becoming a resource problem: a peer cap bounds memory per exam, a queue cap
// bounds per-peer buffering, and a minimum publish interval bounds broadcast
// amplification from a hostile or buggy client (a compliant client throttles
// itself to 2s, so it never reaches this floor).
const (
	DefaultPresenceTTL             = 30 * time.Second
	DefaultPresenceMaxPeersPerExam = 64
	DefaultPresenceQueueCap        = 32
	DefaultPresenceMinInterval     = 250 * time.Millisecond
)

// ValidPresenceState reports whether state is in the frozen vocabulary.
func ValidPresenceState(state string) bool {
	switch state {
	case PresenceStateViewing, PresenceStateEditing, PresenceStateIdle:
		return true
	default:
		return false
	}
}

// PresenceEnvelope is the single wire shape for both directions of
// authoring.presence. Fields are OMITTED when the server has not stamped them
// (connectionId/displayName/lastSeenAt on the client's way in) so the same
// struct serves both directions without a second type to keep in sync.
//
// userId/displayName/examId/draftVersionId exist ONLY so the server can stamp
// them on the way out. ParsePresenceFrame discards every one of them on the
// way in: identity is never client-supplied.
type PresenceEnvelope struct {
	ConnectionID       string  `json:"connectionId,omitempty"`
	UserID             string  `json:"userId,omitempty"`
	DisplayName        string  `json:"displayName,omitempty"`
	ExamID             string  `json:"examId,omitempty"`
	DraftVersionID     string  `json:"draftVersionId,omitempty"`
	SelectedQuestionID *string `json:"selectedQuestionId"`
	State              string  `json:"state"`
	LastSeenAt         string  `json:"lastSeenAt,omitempty"`
}

// PresenceFrameV1 wraps one presence envelope.
type PresenceFrameV1 struct {
	Type     string           `json:"type"`
	V        int              `json:"v"`
	Presence PresenceEnvelope `json:"presence"`
}

// ParsePresenceFrame validates a CLIENT presence frame and returns only the
// fields a client is allowed to influence: the selection and the state.
//
// Security rule: userId, displayName, examId, draftVersionId, connectionId,
// and lastSeenAt are all ignored here and stamped by the server from the
// session + binding. A client cannot impersonate another author, claim another
// exam, or forge a TTL.
func ParsePresenceFrame(raw []byte) (PresenceEnvelope, error) {
	var frame PresenceFrameV1
	if err := json.Unmarshal(raw, &frame); err != nil {
		return PresenceEnvelope{}, fmt.Errorf("authoring.presence must be a JSON object")
	}
	if strings.TrimSpace(frame.Type) != FrameTypePresence {
		return PresenceEnvelope{}, fmt.Errorf("expected type %s", FrameTypePresence)
	}
	if frame.V != ProtocolVersion {
		return PresenceEnvelope{}, fmt.Errorf("unsupported protocol version %d", frame.V)
	}
	state := strings.TrimSpace(frame.Presence.State)
	if !ValidPresenceState(state) {
		return PresenceEnvelope{}, fmt.Errorf("presence state must be %s, %s, or %s", PresenceStateViewing, PresenceStateEditing, PresenceStateIdle)
	}
	var selected *string
	if raw := frame.Presence.SelectedQuestionID; raw != nil {
		trimmed := strings.TrimSpace(*raw)
		if len(trimmed) > MaxIDLength {
			return PresenceEnvelope{}, fmt.Errorf("selectedQuestionId is too long")
		}
		if trimmed != "" {
			selected = &trimmed
		}
	}
	return PresenceEnvelope{SelectedQuestionID: selected, State: state}, nil
}

// PresencePeer is one subscribed connection's presence identity. It is safe
// for concurrent use: the write pump drains Frames() while the read pump
// publishes.
type PresencePeer struct {
	hub            *PresenceHub
	examID         string
	orgID          *string
	connectionID   string
	userID         string
	displayName    string
	draftVersionID string

	mu            sync.Mutex
	selected      *string
	state         string
	lastSeen      time.Time
	lastPublished time.Time
	closed        bool
	dropped       int64

	out chan PresenceFrameV1
}

// ConnectionID is the server-minted identity of this peer.
func (p *PresencePeer) ConnectionID() string { return p.connectionID }

// Frames is the outbound presence channel for this connection. It is never
// closed: the connection's teardown path closes the socket, and a closed
// channel would be indistinguishable from "the pump should exit" for a reader
// that is still mid-handshake.
func (p *PresencePeer) Frames() <-chan PresenceFrameV1 { return p.out }

// Dropped reports presence frames shed for this peer because its queue was
// full. Advisory only: a slow socket loses presence, never correctness.
func (p *PresencePeer) Dropped() int64 {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.dropped
}

// frameLocked renders this peer's current presence. lastSeenAt is the TTL
// anchor receivers expire against, so every broadcast refreshes it even when
// the selection and state are unchanged.
func (p *PresencePeer) frameLocked() PresenceFrameV1 {
	return PresenceFrameV1{
		Type: FrameTypePresence,
		V:    ProtocolVersion,
		Presence: PresenceEnvelope{
			ConnectionID:       p.connectionID,
			UserID:             p.userID,
			DisplayName:        p.displayName,
			ExamID:             p.examID,
			DraftVersionID:     p.draftVersionID,
			SelectedQuestionID: p.selected,
			State:              p.state,
			LastSeenAt:         p.lastSeen.UTC().Format(time.RFC3339Nano),
		},
	}
}

func (p *PresencePeer) enqueue(frame PresenceFrameV1) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.closed {
		return
	}
	select {
	case p.out <- frame:
	default:
		// Non-blocking by design: one congested peer must never stall the
		// publisher or its other peers.
		p.dropped++
	}
}

// PresenceHubOptions tunes the registry. Zero values fall back to the
// Default* constants, so tests can shrink TTL artificially and production can
// run with no options at all.
type PresenceHubOptions struct {
	TTL                time.Duration
	MaxPeersPerExam    int
	QueueCap           int
	MinPublishInterval time.Duration
	// Now is injectable so TTL expiry is deterministic in tests.
	Now func() time.Time
}

// PresenceHub is the process-local presence registry and fan-out.
type PresenceHub struct {
	mu    sync.Mutex
	exams map[string]map[*PresencePeer]struct{}
	seq   uint64
	opts  PresenceHubOptions
}

// NewPresenceHub builds a registry, filling in defaults.
func NewPresenceHub(opts PresenceHubOptions) *PresenceHub {
	if opts.TTL <= 0 {
		opts.TTL = DefaultPresenceTTL
	}
	if opts.MaxPeersPerExam <= 0 {
		opts.MaxPeersPerExam = DefaultPresenceMaxPeersPerExam
	}
	if opts.QueueCap <= 0 {
		opts.QueueCap = DefaultPresenceQueueCap
	}
	if opts.MinPublishInterval <= 0 {
		opts.MinPublishInterval = DefaultPresenceMinInterval
	}
	if opts.Now == nil {
		opts.Now = time.Now
	}
	return &PresenceHub{exams: make(map[string]map[*PresencePeer]struct{}), opts: opts}
}

// ErrPresenceFull is returned when an exam has reached its peer cap. The
// caller degrades to no-presence for that connection rather than refusing the
// subscription: presence is advisory, collaboration without it still works.
var ErrPresenceFull = fmt.Errorf("authoringrealtime: presence capacity exceeded")

// Join registers one connection and returns its peer.
//
// The new peer immediately receives a snapshot of the peers already in the
// exam, and those peers receive the newcomer, so the first paint needs no
// waiting for the next throttled tick.
func (h *PresenceHub) Join(examID string, orgID *string, actorID, displayName, draftVersionID string) (*PresencePeer, error) {
	exam := strings.TrimSpace(examID)
	if exam == "" {
		return nil, ErrPresenceFull
	}
	now := h.opts.Now()
	h.mu.Lock()
	defer h.mu.Unlock()
	h.pruneLocked(now)

	peers := h.exams[exam]
	if peers == nil {
		peers = make(map[*PresencePeer]struct{})
		h.exams[exam] = peers
	}
	if len(peers) >= h.opts.MaxPeersPerExam {
		return nil, ErrPresenceFull
	}

	h.seq++
	peer := &PresencePeer{
		hub:            h,
		examID:         exam,
		orgID:          orgID,
		connectionID:   fmt.Sprintf("ap-%d", h.seq),
		userID:         actorID,
		displayName:    displayName,
		draftVersionID: draftVersionID,
		state:          PresenceStateViewing,
		lastSeen:       now,
		// Deliberately ZERO, not `now`: the throttle window exists to bound
		// amplification, and a peer's FIRST real update (selecting a question
		// moments after connecting) must never be swallowed by a window that
		// started before it said anything.
		lastPublished: time.Time{},
		out:           make(chan PresenceFrameV1, h.opts.QueueCap),
	}
	peers[peer] = struct{}{}

	// Snapshot the room for the newcomer, then announce the newcomer.
	for other := range peers {
		if other == peer {
			continue
		}
		other.mu.Lock()
		frame := other.frameLocked()
		other.mu.Unlock()
		peer.enqueue(frame)
	}
	peer.mu.Lock()
	intro := peer.frameLocked()
	peer.mu.Unlock()
	for other := range peers {
		if other == peer {
			continue
		}
		other.enqueue(intro)
	}
	return peer, nil
}

// Publish records this peer's selection/state and fans it out to the rest of
// the exam.
//
// Frames that arrive inside MinPublishInterval are dropped and counted: that
// window exists to bound amplification, and a compliant client (2s throttle)
// never hits it. A drop is harmless because the next accepted frame carries
// the full current state, not a delta.
func (h *PresenceHub) Publish(peer *PresencePeer, selected *string, state string, now time.Time) {
	if peer == nil || !ValidPresenceState(state) {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	h.pruneLocked(now)
	if _, ok := h.exams[peer.examID][peer]; !ok {
		return
	}
	peer.mu.Lock()
	if peer.closed {
		peer.mu.Unlock()
		return
	}
	if now.Sub(peer.lastPublished) < h.opts.MinPublishInterval {
		peer.mu.Unlock()
		return
	}
	peer.selected = selected
	peer.state = state
	peer.lastSeen = now
	peer.lastPublished = now
	frame := peer.frameLocked()
	peer.mu.Unlock()

	for other := range h.exams[peer.examID] {
		if other == peer {
			continue
		}
		other.enqueue(frame)
	}
}

// Leave retires a peer. It does NOT broadcast a removal: receivers expire the
// entry on TTL, which is the same path an unclean disconnect takes, so there is
// exactly one way for a peer to disappear from a collaborator's view instead of
// two that could disagree.
func (h *PresenceHub) Leave(peer *PresencePeer) {
	if peer == nil {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if peers, ok := h.exams[peer.examID]; ok {
		delete(peers, peer)
		if len(peers) == 0 {
			delete(h.exams, peer.examID)
		}
	}
	peer.mu.Lock()
	peer.closed = true
	peer.mu.Unlock()
}

// PeerCount reports live peers for an exam (test/telemetry aid).
func (h *PresenceHub) PeerCount(examID string) int {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.pruneLocked(h.opts.Now())
	return len(h.exams[strings.TrimSpace(examID)])
}

// pruneLocked drops peers that have not refreshed inside the TTL. Callers must
// hold h.mu. Lazy sweeping (rather than a background goroutine) keeps the hub
// free of lifecycle management: an idle exam costs nothing and needs no timer.
func (h *PresenceHub) pruneLocked(now time.Time) {
	for exam, peers := range h.exams {
		for peer := range peers {
			peer.mu.Lock()
			stale := now.Sub(peer.lastSeen) > h.opts.TTL
			if stale {
				peer.closed = true
			}
			peer.mu.Unlock()
			if stale {
				delete(peers, peer)
			}
		}
		if len(peers) == 0 {
			delete(h.exams, exam)
		}
	}
}
