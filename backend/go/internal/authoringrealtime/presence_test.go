package authoringrealtime

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

// --- ParsePresenceFrame -----------------------------------------------------

func TestParsePresenceFrameAcceptsClientIntent(t *testing.T) {
	raw := []byte(`{"type":"authoring.presence","v":1,"presence":{"selectedQuestionId":"eq-7","state":"editing"}}`)
	env, err := ParsePresenceFrame(raw)
	if err != nil {
		t.Fatalf("valid frame rejected: %v", err)
	}
	if env.State != PresenceStateEditing {
		t.Fatalf("state = %q, want editing", env.State)
	}
	if env.SelectedQuestionID == nil || *env.SelectedQuestionID != "eq-7" {
		t.Fatalf("selectedQuestionId = %v, want eq-7", env.SelectedQuestionID)
	}
}

func TestParsePresenceFrameAllowsNoSelection(t *testing.T) {
	raw := []byte(`{"type":"authoring.presence","v":1,"presence":{"selectedQuestionId":null,"state":"idle"}}`)
	env, err := ParsePresenceFrame(raw)
	if err != nil {
		t.Fatalf("null selection must be valid: %v", err)
	}
	if env.SelectedQuestionID != nil {
		t.Fatalf("null selection must stay nil, got %v", *env.SelectedQuestionID)
	}
	// An all-whitespace id is a client bug, not a real selection: it must not
	// become a phantom question that no row can ever match.
	blank := []byte(`{"type":"authoring.presence","v":1,"presence":{"selectedQuestionId":"   ","state":"viewing"}}`)
	if env, err := ParsePresenceFrame(blank); err != nil || env.SelectedQuestionID != nil {
		t.Fatalf("blank selection must normalize to nil: env=%v err=%v", env, err)
	}
}

// Identity is never client-supplied. A hostile frame may name any user, exam,
// draft, or connection; all of it must be discarded so the caller stamps the
// values from the session and binding.
func TestParsePresenceFrameIgnoresClientSuppliedIdentity(t *testing.T) {
	raw := []byte(`{"type":"authoring.presence","v":1,"presence":{` +
		`"connectionId":"forged-conn","userId":"victim-user","displayName":"Victim",` +
		`"examId":"other-exam","draftVersionId":"other-draft",` +
		`"selectedQuestionId":"eq-1","state":"viewing","lastSeenAt":"2999-01-01T00:00:00Z"}}`)
	env, err := ParsePresenceFrame(raw)
	if err != nil {
		t.Fatalf("frame with extra fields must parse: %v", err)
	}
	if env.ConnectionID != "" || env.UserID != "" || env.DisplayName != "" ||
		env.ExamID != "" || env.DraftVersionID != "" || env.LastSeenAt != "" {
		t.Fatalf("client-supplied identity must be discarded, got %+v", env)
	}
}

func TestParsePresenceFrameRejectsBadFrames(t *testing.T) {
	cases := map[string]string{
		"not json":     `{`,
		"wrong type":   `{"type":"authoring.subscribe","v":1,"presence":{"state":"viewing"}}`,
		"wrong ver":    `{"type":"authoring.presence","v":2,"presence":{"state":"viewing"}}`,
		"missing ver":  `{"type":"authoring.presence","presence":{"state":"viewing"}}`,
		"bad state":    `{"type":"authoring.presence","v":1,"presence":{"state":"typing"}}`,
		"empty state":  `{"type":"authoring.presence","v":1,"presence":{"state":""}}`,
		"absent state": `{"type":"authoring.presence","v":1,"presence":{"selectedQuestionId":"eq-1"}}`,
	}
	for name, raw := range cases {
		if _, err := ParsePresenceFrame([]byte(raw)); err == nil {
			t.Fatalf("%s: expected rejection", name)
		}
	}
}

func TestParsePresenceFrameBoundsSelectionLength(t *testing.T) {
	long, _ := json.Marshal(map[string]any{
		"type": "authoring.presence", "v": 1,
		"presence": map[string]any{"state": "viewing", "selectedQuestionId": strings.Repeat("x", MaxIDLength+1)},
	})
	if _, err := ParsePresenceFrame(long); err == nil {
		t.Fatal("an over-long selection id must be rejected")
	}
}

// The payload ban is structural: there is nowhere to put content. This pins
// that so a future field addition cannot quietly make frames content-bearing.
func TestPresenceEnvelopeCarriesNoContentFields(t *testing.T) {
	raw, err := json.Marshal(PresenceFrameV1{Type: FrameTypePresence, V: ProtocolVersion,
		Presence: PresenceEnvelope{State: PresenceStateEditing, SelectedQuestionID: strPtr("eq-1")}})
	if err != nil {
		t.Fatal(err)
	}
	for _, banned := range []string{"stimulus", "prompt", "answer", "rationale", "metadata",
		"accessibility", "choices", "correctOptionId", "preview", "content", "tags"} {
		if strings.Contains(strings.ToLower(string(raw)), strings.ToLower(banned)) {
			t.Fatalf("presence frame must never carry %q: %s", banned, raw)
		}
	}
}

// --- PresenceHub ------------------------------------------------------------

type hubFixture struct {
	hub *PresenceHub
	now time.Time
}

func newHubFixture(t *testing.T, opts PresenceHubOptions) *hubFixture {
	t.Helper()
	f := &hubFixture{now: time.Date(2026, 9, 13, 12, 0, 0, 0, time.UTC)}
	if opts.Now == nil {
		opts.Now = func() time.Time { return f.now }
	}
	f.hub = NewPresenceHub(opts)
	return f
}

func (f *hubFixture) advance(d time.Duration) { f.now = f.now.Add(d) }

// drainAll collects every queued frame without blocking.
func drainAll(ch <-chan PresenceFrameV1) []PresenceFrameV1 {
	var out []PresenceFrameV1
	for {
		select {
		case f := <-ch:
			out = append(out, f)
		default:
			return out
		}
	}
}

func TestPresenceJoinAnnouncesBothDirections(t *testing.T) {
	f := newHubFixture(t, PresenceHubOptions{})
	alice, err := f.hub.Join("exam-1", nil, "user-alice", "Alice", "draft-7")
	if err != nil {
		t.Fatal(err)
	}
	if got := drainAll(alice.Frames()); len(got) != 0 {
		t.Fatalf("the first peer has nobody to hear about, got %d frames", len(got))
	}

	bob, err := f.hub.Join("exam-1", nil, "user-bob", "Bob", "draft-7")
	if err != nil {
		t.Fatal(err)
	}
	// Bob's snapshot: he learns about Alice immediately, without waiting for
	// her next throttled refresh.
	snapshot := drainAll(bob.Frames())
	if len(snapshot) != 1 {
		t.Fatalf("newcomer must receive a one-entry snapshot, got %d", len(snapshot))
	}
	if snapshot[0].Presence.UserID != "user-alice" || snapshot[0].Presence.State != PresenceStateViewing {
		t.Fatalf("snapshot must describe Alice as viewing, got %+v", snapshot[0].Presence)
	}
	// Alice learns about Bob.
	intro := drainAll(alice.Frames())
	if len(intro) != 1 || intro[0].Presence.UserID != "user-bob" {
		t.Fatalf("existing peer must be told about the newcomer, got %+v", intro)
	}
}

func TestPresencePublishFansOutToOthersButNotSelf(t *testing.T) {
	f := newHubFixture(t, PresenceHubOptions{})
	alice, _ := f.hub.Join("exam-1", nil, "user-alice", "Alice", "draft-7")
	bob, _ := f.hub.Join("exam-1", nil, "user-bob", "Bob", "draft-7")
	drainAll(alice.Frames())
	drainAll(bob.Frames())

	f.advance(time.Second)
	f.hub.Publish(alice, strPtr("eq-14"), PresenceStateEditing, f.now)

	got := drainAll(bob.Frames())
	if len(got) != 1 {
		t.Fatalf("Bob must receive exactly Alice's update, got %d", len(got))
	}
	p := got[0].Presence
	if p.UserID != "user-alice" || p.State != PresenceStateEditing ||
		p.SelectedQuestionID == nil || *p.SelectedQuestionID != "eq-14" {
		t.Fatalf("unexpected fan-out payload: %+v", p)
	}
	if p.ConnectionID == "" || p.ExamID != "exam-1" || p.DraftVersionID != "draft-7" {
		t.Fatalf("server must stamp connection/exam/draft: %+v", p)
	}
	if p.LastSeenAt == "" {
		t.Fatal("lastSeenAt is the TTL anchor and must always be stamped")
	}
	if p.DisplayName != "Alice" {
		t.Fatalf("displayName must be stamped from the binding, got %q", p.DisplayName)
	}
	if frames := drainAll(alice.Frames()); len(frames) != 0 {
		t.Fatalf("a peer must never receive its own presence, got %d", len(frames))
	}
}

func TestPresenceNeverCrossesExams(t *testing.T) {
	f := newHubFixture(t, PresenceHubOptions{})
	alice, _ := f.hub.Join("exam-1", nil, "user-alice", "Alice", "draft-7")
	other, _ := f.hub.Join("exam-2", nil, "user-carol", "Carol", "draft-9")
	drainAll(alice.Frames())
	drainAll(other.Frames())

	f.advance(time.Second)
	f.hub.Publish(alice, strPtr("eq-1"), PresenceStateEditing, f.now)

	if frames := drainAll(other.Frames()); len(frames) != 0 {
		t.Fatalf("presence must not leak across exams, got %d frames", len(frames))
	}
}

// A refresh with unchanged state still broadcasts: lastSeenAt is the TTL
// anchor, so suppressing the frame would let a live collaborator expire.
func TestPresenceRefreshBroadcastsEvenWhenUnchanged(t *testing.T) {
	f := newHubFixture(t, PresenceHubOptions{MinPublishInterval: time.Second})
	alice, _ := f.hub.Join("exam-1", nil, "user-alice", "Alice", "draft-7")
	bob, _ := f.hub.Join("exam-1", nil, "user-bob", "Bob", "draft-7")
	drainAll(alice.Frames())
	drainAll(bob.Frames())

	f.advance(time.Second)
	f.hub.Publish(alice, strPtr("eq-1"), PresenceStateEditing, f.now)
	first := drainAll(bob.Frames())
	f.advance(time.Second)
	f.hub.Publish(alice, strPtr("eq-1"), PresenceStateEditing, f.now)
	second := drainAll(bob.Frames())

	if len(first) != 1 || len(second) != 1 {
		t.Fatalf("both refreshes must broadcast, got %d then %d", len(first), len(second))
	}
	if first[0].Presence.LastSeenAt == second[0].Presence.LastSeenAt {
		t.Fatal("a refresh must advance lastSeenAt")
	}
}

// The throttle window exists to bound amplification, never to hide a peer. The
// FIRST publish is always accepted, even moments after connecting: a
// collaborator who selects a question immediately must be seen.
func TestPresenceFirstPublishIsNeverThrottled(t *testing.T) {
	f := newHubFixture(t, PresenceHubOptions{MinPublishInterval: time.Minute})
	alice, _ := f.hub.Join("exam-1", nil, "user-alice", "Alice", "draft-7")
	bob, _ := f.hub.Join("exam-1", nil, "user-bob", "Bob", "draft-7")
	drainAll(alice.Frames())
	drainAll(bob.Frames())

	// Same instant as the join, with a one-minute throttle window.
	f.hub.Publish(alice, strPtr("eq-1"), PresenceStateEditing, f.now)
	frames := drainAll(bob.Frames())
	if len(frames) != 1 {
		t.Fatalf("the first publish must always be accepted, got %d frames", len(frames))
	}
	if *frames[0].Presence.SelectedQuestionID != "eq-1" {
		t.Fatalf("unexpected first frame: %+v", frames[0].Presence)
	}
}

func TestPresenceThrottleDropsTooFrequentPublishes(t *testing.T) {
	f := newHubFixture(t, PresenceHubOptions{MinPublishInterval: time.Second})
	alice, _ := f.hub.Join("exam-1", nil, "user-alice", "Alice", "draft-7")
	bob, _ := f.hub.Join("exam-1", nil, "user-bob", "Bob", "draft-7")
	drainAll(alice.Frames())
	drainAll(bob.Frames())

	// The first lands; the three that follow inside the window are shed.
	f.hub.Publish(alice, strPtr("eq-1"), PresenceStateEditing, f.now)
	if frames := drainAll(bob.Frames()); len(frames) != 1 {
		t.Fatalf("the first publish must land, got %d", len(frames))
	}
	for i := 0; i < 3; i++ {
		f.hub.Publish(alice, strPtr("eq-2"), PresenceStateEditing, f.now)
	}
	if frames := drainAll(bob.Frames()); len(frames) != 0 {
		t.Fatalf("frames inside the min interval must be shed, got %d", len(frames))
	}

	// The next accepted frame carries the FULL current state, never a delta the
	// receiver would have had to reconstruct from a frame it never saw.
	f.advance(2 * time.Second)
	f.hub.Publish(alice, strPtr("eq-2"), PresenceStateEditing, f.now)
	frames := drainAll(bob.Frames())
	if len(frames) != 1 {
		t.Fatalf("the next accepted frame carries full state, got %d", len(frames))
	}
	if frames[0].Presence.SelectedQuestionID == nil || *frames[0].Presence.SelectedQuestionID != "eq-2" {
		t.Fatalf("unexpected coalesced payload: %+v", frames[0].Presence)
	}
}

func TestPresenceExpiresSilentPeers(t *testing.T) {
	f := newHubFixture(t, PresenceHubOptions{TTL: 15 * time.Second})
	alice, _ := f.hub.Join("exam-1", nil, "user-alice", "Alice", "draft-7")
	if _, err := f.hub.Join("exam-1", nil, "user-bob", "Bob", "draft-7"); err != nil {
		t.Fatal(err)
	}
	if got := f.hub.PeerCount("exam-1"); got != 2 {
		t.Fatalf("PeerCount = %d, want 2", got)
	}

	// Bob keeps refreshing inside the TTL; Alice goes silent past it. Her entry
	// must be swept, which is the SAME path an unclean disconnect takes.
	bob, _ := f.hub.Join("exam-1", nil, "user-bob2", "Bob2", "draft-7")
	drainAll(alice.Frames())
	drainAll(bob.Frames())
	f.advance(10 * time.Second)
	f.hub.Publish(bob, nil, PresenceStateViewing, f.now)
	f.advance(10 * time.Second)
	f.hub.Publish(bob, nil, PresenceStateViewing, f.now)
	if got := f.hub.PeerCount("exam-1"); got != 1 {
		t.Fatalf("silent peers must expire, PeerCount = %d, want 1", got)
	}
}

func TestPresenceLeaveRemovesWithoutBroadcasting(t *testing.T) {
	f := newHubFixture(t, PresenceHubOptions{})
	alice, _ := f.hub.Join("exam-1", nil, "user-alice", "Alice", "draft-7")
	bob, _ := f.hub.Join("exam-1", nil, "user-bob", "Bob", "draft-7")
	drainAll(alice.Frames())
	drainAll(bob.Frames())

	f.hub.Leave(alice)
	if got := f.hub.PeerCount("exam-1"); got != 1 {
		t.Fatalf("PeerCount after leave = %d, want 1", got)
	}
	// Retirement is not announced: peers expire the entry on TTL, so there is
	// exactly one way for a collaborator to disappear from a view.
	if frames := drainAll(bob.Frames()); len(frames) != 0 {
		t.Fatalf("leave must not broadcast, got %d frames", len(frames))
	}
	// A publish from a retired peer is a no-op, never a panic or a broadcast.
	f.advance(time.Second)
	f.hub.Publish(alice, strPtr("eq-1"), PresenceStateEditing, f.now)
	if frames := drainAll(bob.Frames()); len(frames) != 0 {
		t.Fatalf("a retired peer must not publish, got %d frames", len(frames))
	}
}

func TestPresencePeerCapDegradesInsteadOfGrowing(t *testing.T) {
	f := newHubFixture(t, PresenceHubOptions{MaxPeersPerExam: 2})
	if _, err := f.hub.Join("exam-1", nil, "u1", "A", "draft-7"); err != nil {
		t.Fatal(err)
	}
	if _, err := f.hub.Join("exam-1", nil, "u2", "B", "draft-7"); err != nil {
		t.Fatal(err)
	}
	if _, err := f.hub.Join("exam-1", nil, "u3", "C", "draft-7"); err != ErrPresenceFull {
		t.Fatalf("third join err = %v, want ErrPresenceFull", err)
	}
	// The cap is per exam, not global.
	if _, err := f.hub.Join("exam-2", nil, "u4", "D", "draft-7"); err != nil {
		t.Fatalf("a different exam must still admit peers: %v", err)
	}
}

func TestPresenceSlowPeerIsShedNotBlocking(t *testing.T) {
	f := newHubFixture(t, PresenceHubOptions{QueueCap: 1, MinPublishInterval: time.Millisecond})
	alice, _ := f.hub.Join("exam-1", nil, "user-alice", "Alice", "draft-7")
	slow, _ := f.hub.Join("exam-1", nil, "user-slow", "Slow", "draft-7")
	drainAll(alice.Frames())
	// slow never drains. Every broadcast past its queue cap must be counted and
	// dropped rather than blocking Alice's publish.
	for i := 0; i < 5; i++ {
		f.advance(10 * time.Millisecond)
		f.hub.Publish(alice, strPtr("eq-1"), PresenceStateEditing, f.now)
	}
	if slow.Dropped() == 0 {
		t.Fatal("a congested peer must have sheds counted")
	}
}

func TestPresenceEmptyExamIsNotTracked(t *testing.T) {
	f := newHubFixture(t, PresenceHubOptions{})
	if _, err := f.hub.Join("   ", nil, "u1", "A", "draft-7"); err == nil {
		t.Fatal("a blank exam id must be refused")
	}
	if got := f.hub.PeerCount(""); got != 0 {
		t.Fatalf("no exam should be tracked, got %d", got)
	}
}

func strPtr(s string) *string { return &s }
