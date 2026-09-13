package main

// Phase 05 presence integration suite. Drives REAL gorilla sockets against the
// authoring handler so the relay is exercised end to end: capability
// negotiation, server-stamped identity, exam scoping, join snapshots, refusal
// when presence was not negotiated, and peer retirement on disconnect.
//
// DB-free by construction, exactly like the Phase 03 suite: the exam loader and
// display-name resolver are injected, admission is the memory gate, and a fresh
// subscribe never touches the replay path.

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/authoringrealtime"
)

// fakeDisplayNames is a DB-free DisplayNameResolver.
type fakeDisplayNames map[string]string

func (f fakeDisplayNames) DisplayNameForActor(_ context.Context, actorID string) (string, error) {
	return f[actorID], nil
}

func authoringPresenceExam(examID string) map[string]authoringrealtime.ExamView {
	return map[string]authoringrealtime.ExamView{
		examID: {
			ID:                    examID,
			CurrentDraftVersionID: astStrptr("draft-7"),
			ProviderKey:           "sat",
		},
	}
}

// presenceIntegrationApp enables delivery + presence and injects a registry
// with a generous TTL (so a slow CI never expires a live peer mid-assertion)
// plus deterministic display names.
func presenceIntegrationApp(t *testing.T, examIDs ...string) *App {
	t.Helper()
	views := map[string]authoringrealtime.ExamView{}
	for _, id := range examIDs {
		for k, v := range authoringPresenceExam(id) {
			views[k] = v
		}
	}
	app, _ := authoringIntegrationApp(t, fakeExamLoader{views: views})
	app.Config.AuthoringRealtimePresence = true
	app.AuthoringDisplayNames = fakeDisplayNames{"user-alice": "Alice", "user-bob": "Bob"}
	app.AuthoringPresence = authoringrealtime.NewPresenceHub(authoringrealtime.PresenceHubOptions{TTL: time.Minute})
	return app
}

func presenceFrameMap(t *testing.T, frame map[string]any) map[string]any {
	t.Helper()
	if frame["type"] != authoringrealtime.FrameTypePresence {
		t.Fatalf("want %s, got %v", authoringrealtime.FrameTypePresence, frame["type"])
	}
	body, ok := frame["presence"].(map[string]any)
	if !ok {
		t.Fatalf("presence frame must carry an object payload, got %T", frame["presence"])
	}
	return body
}

func writePresence(t *testing.T, conn *websocket.Conn, selected any, state string) {
	t.Helper()
	writeAuthoringJSON(t, conn, map[string]any{
		"type": authoringrealtime.FrameTypePresence,
		"v":    authoringrealtime.ProtocolVersion,
		"presence": map[string]any{
			"selectedQuestionId": selected,
			"state":              state,
		},
	})
}

// connectAuthoring consumes the subscribed + capabilities handshake and returns
// the CAPABILITIES frame. It deliberately does not reuse the shared helper:
// that one returns the subscribed frame, which is the wrong half for asserting
// the negotiated posture.
func connectAuthoring(t *testing.T, conn *websocket.Conn) map[string]any {
	t.Helper()
	subscribed := readAuthoringJSON(t, conn, 2*time.Second)
	if subscribed["type"] != authoringrealtime.FrameTypeSubscribed {
		t.Fatalf("want authoring.subscribed, got %v", subscribed["type"])
	}
	caps := readAuthoringJSON(t, conn, 2*time.Second)
	if caps["type"] != authoringrealtime.FrameTypeCapabilities {
		t.Fatalf("want authoring.capabilities, got %v", caps["type"])
	}
	return caps
}

// --- capability negotiation -------------------------------------------------

func TestAuthoringPresenceCapabilityIsNarrowed(t *testing.T) {
	// Delivery on, presence off: presence must not be advertised.
	app, _ := authoringIntegrationApp(t, fakeExamLoader{views: authoringPresenceExam("exam-1")})
	app.Config.AuthoringRealtimePresence = true
	srv := authoringIntegrationServer(app)
	defer srv.Close()

	deliveryOnly, _ := authoringIntegrationApp(t, fakeExamLoader{views: authoringPresenceExam("exam-1")})
	deliverySrv := authoringIntegrationServer(deliveryOnly)
	defer deliverySrv.Close()

	conn := dialAuthoring(t, deliverySrv, "user-alice", authoringrealtime.RoleBuilder, "exam-1")
	subscribeAuthoring(t, conn, "exam-1", nil)
	caps := connectAuthoring(t, conn)
	if caps["presence"] != false {
		t.Fatalf("presence must be withheld when its flag is off, got %v", caps["presence"])
	}

	onConn := dialAuthoring(t, srv, "user-alice", authoringrealtime.RoleBuilder, "exam-1")
	subscribeAuthoring(t, onConn, "exam-1", nil)
	onCaps := connectAuthoring(t, onConn)
	if onCaps["presence"] != true {
		t.Fatalf("presence must be advertised when both flags are on, got caps=%v", onCaps)
	}
}

// --- relay ------------------------------------------------------------------

func TestAuthoringPresenceRelaysBetweenSubscribers(t *testing.T) {
	app := presenceIntegrationApp(t, "exam-1")
	srv := authoringIntegrationServer(app)
	defer srv.Close()

	alice := dialAuthoring(t, srv, "user-alice", authoringrealtime.RoleBuilder, "exam-1")
	subscribeAuthoring(t, alice, "exam-1", nil)
	connectAuthoring(t, alice)

	bob := dialAuthoring(t, srv, "user-bob", authoringrealtime.RoleBuilder, "exam-1")
	subscribeAuthoring(t, bob, "exam-1", nil)
	connectAuthoring(t, bob)

	// Both directions of the join announcement are delivered before either
	// publishes: Alice learns Bob arrived, and Bob's snapshot already knows
	// Alice. Drain them so the assertions below are about the UPDATE.
	intro := presenceFrameMap(t, readAuthoringJSON(t, alice, 2*time.Second))
	if intro["userId"] != "user-bob" {
		t.Fatalf("Alice must see Bob's arrival, got %v", intro["userId"])
	}
	snapshot := presenceFrameMap(t, readAuthoringJSON(t, bob, 2*time.Second))
	if snapshot["userId"] != "user-alice" || snapshot["state"] != authoringrealtime.PresenceStateViewing {
		t.Fatalf("Bob's snapshot must describe Alice watching, got %+v", snapshot)
	}

	writePresence(t, alice, "eq-14", authoringrealtime.PresenceStateEditing)

	got := presenceFrameMap(t, readAuthoringJSON(t, bob, 2*time.Second))
	if got["userId"] != "user-alice" {
		t.Fatalf("userId must be server-stamped as Alice, got %v", got["userId"])
	}
	if got["displayName"] != "Alice" {
		t.Fatalf("displayName must come from the resolver, got %v", got["displayName"])
	}
	if got["state"] != authoringrealtime.PresenceStateEditing {
		t.Fatalf("state = %v, want editing", got["state"])
	}
	if got["selectedQuestionId"] != "eq-14" {
		t.Fatalf("selectedQuestionId = %v, want eq-14", got["selectedQuestionId"])
	}
	if got["examId"] != "exam-1" || got["draftVersionId"] != "draft-7" {
		t.Fatalf("exam/draft must be stamped from the binding, got %v/%v", got["examId"], got["draftVersionId"])
	}
	if connID, _ := got["connectionId"].(string); connID == "" {
		t.Fatal("connectionId must be server-minted")
	}
	if seen, _ := got["lastSeenAt"].(string); seen == "" {
		t.Fatal("lastSeenAt is the TTL anchor and must be stamped")
	}

	// A peer never receives its own presence.
	expectAuthoringSilence(t, alice, 200*time.Millisecond)
}

func TestAuthoringPresenceSnapshotReachesNewcomer(t *testing.T) {
	app := presenceIntegrationApp(t, "exam-1")
	srv := authoringIntegrationServer(app)
	defer srv.Close()

	alice := dialAuthoring(t, srv, "user-alice", authoringrealtime.RoleBuilder, "exam-1")
	subscribeAuthoring(t, alice, "exam-1", nil)
	connectAuthoring(t, alice)
	writePresence(t, alice, "eq-3", authoringrealtime.PresenceStateEditing)

	// Bob arrives after Alice is already working: his snapshot must already
	// describe her, without waiting for her next throttled refresh.
	bob := dialAuthoring(t, srv, "user-bob", authoringrealtime.RoleBuilder, "exam-1")
	subscribeAuthoring(t, bob, "exam-1", nil)
	connectAuthoring(t, bob)

	got := presenceFrameMap(t, readAuthoringJSON(t, bob, 2*time.Second))
	if got["userId"] != "user-alice" || got["state"] != authoringrealtime.PresenceStateEditing {
		t.Fatalf("snapshot must describe Alice editing, got %+v", got)
	}
	if got["selectedQuestionId"] != "eq-3" {
		t.Fatalf("snapshot must carry her selection, got %v", got["selectedQuestionId"])
	}
}

func TestAuthoringPresenceIsExamScoped(t *testing.T) {
	app := presenceIntegrationApp(t, "exam-1", "exam-2")
	app.AuthoringDisplayNames = fakeDisplayNames{"user-alice": "Alice", "user-carol": "Carol"}
	srv := authoringIntegrationServer(app)
	defer srv.Close()

	alice := dialAuthoring(t, srv, "user-alice", authoringrealtime.RoleBuilder, "exam-1")
	subscribeAuthoring(t, alice, "exam-1", nil)
	connectAuthoring(t, alice)

	carol := dialAuthoring(t, srv, "user-carol", authoringrealtime.RoleBuilder, "exam-2")
	subscribeAuthoring(t, carol, "exam-2", nil)
	connectAuthoring(t, carol)

	writePresence(t, alice, "eq-1", authoringrealtime.PresenceStateEditing)

	// Alice must hear nothing from Bob's exam, and Carol must hear nothing at
	// all: presence is scoped to the exam that was authorized.
	expectAuthoringSilence(t, alice, 200*time.Millisecond)
	expectAuthoringSilence(t, carol, 200*time.Millisecond)
}

// --- security ---------------------------------------------------------------

// The frame may name any user, exam, or draft it likes. The server must stamp
// the real ones from the session and binding so presence can never be used to
// impersonate another author or to touch another tenant's room.
func TestAuthoringPresenceIdentityIsServerStamped(t *testing.T) {
	app := presenceIntegrationApp(t, "exam-1", "exam-2")
	srv := authoringIntegrationServer(app)
	defer srv.Close()

	bob := dialAuthoring(t, srv, "user-bob", authoringrealtime.RoleBuilder, "exam-1")
	subscribeAuthoring(t, bob, "exam-1", nil)
	connectAuthoring(t, bob)

	alice := dialAuthoring(t, srv, "user-alice", authoringrealtime.RoleBuilder, "exam-1")
	subscribeAuthoring(t, alice, "exam-1", nil)
	connectAuthoring(t, alice)
	// Drain Bob's view of Alice's arrival.
	_ = readAuthoringJSON(t, bob, 2*time.Second)

	writeAuthoringJSON(t, alice, map[string]any{
		"type": authoringrealtime.FrameTypePresence,
		"v":    authoringrealtime.ProtocolVersion,
		"presence": map[string]any{
			"selectedQuestionId": "eq-9",
			"state":              authoringrealtime.PresenceStateViewing,
			// Forged identity: every one of these must be ignored.
			"userId":         "user-bob",
			"displayName":    "Bob",
			"examId":         "exam-2",
			"draftVersionId": "draft-99",
			"connectionId":   "forged-conn",
			"lastSeenAt":     "2999-01-01T00:00:00Z",
		},
	})

	got := presenceFrameMap(t, readAuthoringJSON(t, bob, 2*time.Second))
	if got["userId"] != "user-alice" || got["displayName"] != "Alice" {
		t.Fatalf("forged identity must be overwritten, got %v/%v", got["userId"], got["displayName"])
	}
	if got["examId"] != "exam-1" || got["draftVersionId"] != "draft-7" {
		t.Fatalf("forged exam/draft must be overwritten, got %v/%v", got["examId"], got["draftVersionId"])
	}
	if got["connectionId"] == "forged-conn" {
		t.Fatal("a client must not be able to choose its connectionId")
	}
	if seen, _ := got["lastSeenAt"].(string); seen == "2999-01-01T00:00:00Z" {
		t.Fatal("a client must not be able to forge its TTL anchor")
	}
}

func TestAuthoringPresenceRejectedWhenNotNegotiated(t *testing.T) {
	// Delivery on, presence off: a presence frame is an unsupported frame and
	// closes the socket, exactly like any other junk the server does not speak.
	app, _ := authoringIntegrationApp(t, fakeExamLoader{views: authoringPresenceExam("exam-1")})
	srv := authoringIntegrationServer(app)
	defer srv.Close()

	conn := dialAuthoring(t, srv, "user-alice", authoringrealtime.RoleBuilder, "exam-1")
	subscribeAuthoring(t, conn, "exam-1", nil)
	caps := connectAuthoring(t, conn)
	if caps["presence"] != false {
		t.Fatalf("precondition: presence must be withheld, got %v", caps["presence"])
	}

	writePresence(t, conn, "eq-1", authoringrealtime.PresenceStateViewing)

	errFrame := readAuthoringJSON(t, conn, 2*time.Second)
	if errFrame["type"] != authoringrealtime.FrameTypeError ||
		errFrame["code"] != authoringrealtime.ErrorCodeBadRequest {
		t.Fatalf("want a typed BAD_REQUEST error, got %v", errFrame)
	}
	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	if _, _, err := conn.ReadMessage(); err == nil {
		t.Fatal("an unnegotiated presence frame must close the socket")
	}
}

func TestAuthoringPresenceInvalidStateClosesSocket(t *testing.T) {
	app := presenceIntegrationApp(t, "exam-1")
	srv := authoringIntegrationServer(app)
	defer srv.Close()

	conn := dialAuthoring(t, srv, "user-alice", authoringrealtime.RoleBuilder, "exam-1")
	subscribeAuthoring(t, conn, "exam-1", nil)
	connectAuthoring(t, conn)

	writePresence(t, conn, "eq-1", "typing")

	errFrame := readAuthoringJSON(t, conn, 2*time.Second)
	if errFrame["type"] != authoringrealtime.FrameTypeError ||
		errFrame["code"] != authoringrealtime.ErrorCodeBadRequest {
		t.Fatalf("an invalid state must be refused, got %v", errFrame)
	}
	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	if _, _, err := conn.ReadMessage(); err == nil {
		t.Fatal("an invalid presence frame must close the socket")
	}
}

// --- lifecycle --------------------------------------------------------------

func TestAuthoringPresencePeerRetiredOnDisconnect(t *testing.T) {
	app := presenceIntegrationApp(t, "exam-1")
	srv := authoringIntegrationServer(app)
	defer srv.Close()

	alice := dialAuthoring(t, srv, "user-alice", authoringrealtime.RoleBuilder, "exam-1")
	subscribeAuthoring(t, alice, "exam-1", nil)
	connectAuthoring(t, alice)

	bob := dialAuthoring(t, srv, "user-bob", authoringrealtime.RoleBuilder, "exam-1")
	subscribeAuthoring(t, bob, "exam-1", nil)
	connectAuthoring(t, bob)

	if got := app.AuthoringPresence.PeerCount("exam-1"); got != 2 {
		t.Fatalf("PeerCount = %d, want 2", got)
	}
	_ = bob.Close()

	// The peer must be retired promptly rather than lingering until the TTL,
	// or a reconnecting collaborator would see itself twice.
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if app.AuthoringPresence.PeerCount("exam-1") == 1 {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("disconnect must retire the peer, PeerCount = %d", app.AuthoringPresence.PeerCount("exam-1"))
}

// A subscription that is refused BEFORE the upgrade must never register a peer.
func TestAuthoringPresenceDeniedSubscriptionLeavesNoPeer(t *testing.T) {
	app := presenceIntegrationApp(t, "exam-1")
	srv := authoringIntegrationServer(app)
	defer srv.Close()

	// A student is outside the authoring read set: the handler must refuse
	// before upgrading, so no presence peer exists for the exam.
	wsURL := "ws" + srv.URL[len("http"):] + "/api/v1/ws/authoring?examId=exam-1"
	header := http.Header{}
	header.Set("X-Test-User", "user-alice")
	header.Set("X-Test-Role", auth.RoleStudent)
	conn, resp, err := websocket.DefaultDialer.Dial(wsURL, header)
	if err == nil {
		_ = conn.Close()
		t.Fatal("a student must not be able to upgrade")
	}
	if resp == nil {
		t.Fatal("expected an HTTP response for the refusal")
	}
	if got := app.AuthoringPresence.PeerCount("exam-1"); got != 0 {
		t.Fatalf("a refused subscription must leave no presence peer, got %d", got)
	}
}
