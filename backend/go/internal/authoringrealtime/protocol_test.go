package authoringrealtime

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestParseSubscribeFrameAcceptsValid(t *testing.T) {
	raw := []byte(`{"type":"authoring.subscribe","v":1,"examId":"exam-1"}`)
	frame, err := ParseSubscribeFrame(raw, "exam-1")
	if err != nil {
		t.Fatal(err)
	}
	if frame.ExamID != "exam-1" || frame.LastSeenCursor != nil {
		t.Fatalf("unexpected frame: %+v", frame)
	}
	// The cursor field is "lastSeenCursor" (opaque position), never a
	// "sequenceId" the client might do arithmetic on.
	if strings.Contains(string(raw), "sequenceId") || strings.Contains(string(raw), "lastSeenSequenceId") {
		t.Fatal("the wire vocabulary must use cursor, not sequenceId")
	}
}

func TestParseSubscribeFrameAcceptsCursor(t *testing.T) {
	raw := []byte(`{"type":"authoring.subscribe","v":1,"examId":"exam-1","lastSeenCursor":42}`)
	frame, err := ParseSubscribeFrame(raw, "exam-1")
	if err != nil {
		t.Fatal(err)
	}
	if frame.LastSeenCursor == nil || *frame.LastSeenCursor != 42 {
		t.Fatalf("cursor lost: %+v", frame)
	}
}

// TestParseSubscribeFrameIgnoresUnknownOptionalFields pins the additive v1
// evolution rule: a newer client may send fields this server does not know.
func TestParseSubscribeFrameIgnoresUnknownOptionalFields(t *testing.T) {
	raw := []byte(`{"type":"authoring.subscribe","v":1,"examId":"exam-1","futureHint":"x","nested":{"a":1}}`)
	if _, err := ParseSubscribeFrame(raw, "exam-1"); err != nil {
		t.Fatalf("unknown optional fields must be ignored, got %v", err)
	}
}

func TestParseSubscribeFrameRejects(t *testing.T) {
	cases := []struct {
		name string
		raw  string
	}{
		{"empty examId", `{"type":"authoring.subscribe","v":1,"examId":""}`},
		{"missing examId", `{"type":"authoring.subscribe","v":1}`},
		{"whitespace examId", `{"type":"authoring.subscribe","v":1,"examId":"   "}`},
		{"wrong type", `{"type":"authoring.publish","v":1,"examId":"exam-1"}`},
		{"missing type", `{"v":1,"examId":"exam-1"}`},
		{"bad version", `{"type":"authoring.subscribe","v":2,"examId":"exam-1"}`},
		{"zero version", `{"type":"authoring.subscribe","examId":"exam-1"}`},
		{"negative cursor", `{"type":"authoring.subscribe","v":1,"examId":"exam-1","lastSeenCursor":-1}`},
		{"non-integer cursor", `{"type":"authoring.subscribe","v":1,"examId":"exam-1","lastSeenCursor":"x"}`},
		{"not an object", `[]`},
		{"truncated json", `{"type":`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := ParseSubscribeFrame([]byte(tc.raw), "exam-1"); err == nil {
				t.Fatalf("expected rejection for %s", tc.name)
			}
		})
	}
}

// TestParseSubscribeFrameRejectsConfusedDeputy pins the post-upgrade identity
// check: a socket authorized for exam A must never be rebound to exam B.
func TestParseSubscribeFrameRejectsConfusedDeputy(t *testing.T) {
	raw := []byte(`{"type":"authoring.subscribe","v":1,"examId":"exam-B"}`)
	if _, err := ParseSubscribeFrame(raw, "exam-A"); err == nil {
		t.Fatal("a frame naming another exam must be rejected")
	}
}

func TestParseSubscribeFrameBoundsExamID(t *testing.T) {
	long := strings.Repeat("a", MaxIDLength+1)
	raw := []byte(`{"type":"authoring.subscribe","v":1,"examId":"` + long + `"}`)
	if _, err := ParseSubscribeFrame(raw, long); err == nil {
		t.Fatal("an over-long examId must be rejected")
	}
}

func TestFrameConstructorsCarryVersion(t *testing.T) {
	b := Binding{ExamID: "exam-1", DraftVersionID: "draft-7"}
	for name, frame := range map[string]any{
		"subscribed":       Subscribed(b, 99),
		"snapshotRequired": SnapshotRequired(b, ReasonCursorTooOld),
		"error":            ErrorFrame(CodePermissionDenied, "no"),
		"badRequest":       BadRequestFrame("bad"),
		"capabilities":     CapabilitiesFrameFor(b),
	} {
		raw, err := json.Marshal(frame)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		var wire map[string]any
		if err := json.Unmarshal(raw, &wire); err != nil {
			t.Fatal(err)
		}
		if wire["v"] != float64(ProtocolVersion) {
			t.Fatalf("%s must carry v:%d, got %v", name, ProtocolVersion, wire["v"])
		}
		if !strings.HasPrefix(wire["type"].(string), "authoring.") {
			t.Fatalf("%s must use an authoring.* type, got %v", name, wire["type"])
		}
	}
}

// TestFrameTypesNeverCollideWithRuntime pins the no-overload rule.
func TestFrameTypesNeverCollideWithRuntime(t *testing.T) {
	runtime := []string{"connected", "runtime_snapshot", "schedule_runtime", "attempt"}
	ours := []string{FrameTypeSubscribe, FrameTypeSubscribed, FrameTypeEvent, FrameTypeSnapshotRequired, FrameTypeError, FrameTypeCapabilities}
	for _, o := range ours {
		for _, r := range runtime {
			if o == r {
				t.Fatalf("frame type %q collides with a runtime frame", o)
			}
		}
	}
}

// TestSubscribedCarriesBarrierCursor pins the handshake field name and that the
// ack exposes NO write authority (the socket is receive-only).
func TestSubscribedCarriesBarrierCursor(t *testing.T) {
	b := Binding{ExamID: "exam-1", DraftVersionID: "draft-7"}
	raw, err := json.Marshal(Subscribed(b, 512))
	if err != nil {
		t.Fatal(err)
	}
	var wire map[string]any
	if err := json.Unmarshal(raw, &wire); err != nil {
		t.Fatal(err)
	}
	if wire["barrierCursor"] != float64(512) {
		t.Fatalf("want barrierCursor 512, got %v", wire["barrierCursor"])
	}
	for _, forbidden := range []string{"sequenceId", "canWrite"} {
		if _, ok := wire[forbidden]; ok {
			t.Fatalf("subscribed frame must not carry %q: %s", forbidden, raw)
		}
	}
}

// TestSnapshotReasonsAreDistinct pins that a slow client and an expired cursor
// are not reported as the same failure.
func TestSnapshotReasonsAreDistinct(t *testing.T) {
	seen := map[SnapshotReason]bool{}
	for _, r := range []SnapshotReason{ReasonCursorTooOld, ReasonReplayTooLarge, ReasonDeliveryGap, ReasonUnsupportedEvent} {
		if seen[r] {
			t.Fatalf("duplicate snapshot reason %q", r)
		}
		seen[r] = true
	}
	if len(seen) != 4 {
		t.Fatalf("want 4 distinct reasons, got %d", len(seen))
	}
}

func TestEventFrameCarriesCursorAndEnvelope(t *testing.T) {
	evt, err := NewEvent(EventInput{
		Kind:           KindQuestionChanged,
		ExamID:         "exam-1",
		DraftVersionID: "draft-7",
		DraftRevision:  194,
		ActorID:        "actor-1",
		Entity:         Entity{Kind: EntityQuestion, ExamQuestionID: "eq-1"},
	})
	if err != nil {
		t.Fatal(err)
	}
	payload, _ := json.Marshal(evt)
	frame, err := EventFrame(777, payload)
	if err != nil {
		t.Fatal(err)
	}
	if frame.Cursor != 777 {
		t.Fatalf("cursor lost: %d", frame.Cursor)
	}
	if frame.Event.Scope.DraftVersionID != "draft-7" {
		t.Fatal("envelope scope lost")
	}
}

// TestEventFrameRejectsGarbagePayload pins that an unparseable payload is an
// error, never a forwarded frame.
func TestEventFrameRejectsGarbagePayload(t *testing.T) {
	if _, err := EventFrame(1, []byte("not json")); err == nil {
		t.Fatal("garbage payload must not become a frame")
	}
}

func TestIsLifecycleRebind(t *testing.T) {
	if !IsLifecycleRebind(Event{Kind: KindDraftReplaced}) {
		t.Fatal("draft.replaced must force a rebind")
	}
	if !IsLifecycleRebind(Event{Kind: KindExamPublished}) {
		t.Fatal("exam.published must force a rebind")
	}
	if IsLifecycleRebind(Event{Kind: KindQuestionChanged}) {
		t.Fatal("an ordinary edit must not close the socket")
	}
}
