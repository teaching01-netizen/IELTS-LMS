package attempts

import (
	"testing"
	"time"

	"example.com/ielts-proctoring/internal/platform/apperrors"
)

func liveGate(now time.Time) RuntimeGate {
	return RuntimeGate{Status: "live", ActiveSectionKey: "*", SectionLive: true, SectionStarted: true, Now: now}
}

func openAttempt() AttemptState {
	return AttemptState{ID: "a", ScheduleID: "s", UserID: "u", ProtocolVersion: 2, DeliveryStatus: "running", Phase: "exam", LeaseEpoch: 1, ControlEpoch: 1, ProctorStatus: "active"}
}

func TestEnsureWritableMatrix(t *testing.T) {
	now := time.Now().UTC()
	cases := []struct {
		name string
		mut  func(*AttemptState, *RuntimeGate)
		code apperrors.Code
	}{
		{"open", func(a *AttemptState, g *RuntimeGate) {}, ""},
		{"submitted", func(a *AttemptState, g *RuntimeGate) { a.DeliveryStatus = "submitted" }, apperrors.CodeAttemptNotWritable},
		{"terminated", func(a *AttemptState, g *RuntimeGate) { a.DeliveryStatus = "terminated" }, apperrors.CodeAttemptNotWritable},
		{"locked", func(a *AttemptState, g *RuntimeGate) { a.DeliveryStatus = "locked" }, apperrors.CodeAttemptNotWritable},
		{"cancelled", func(a *AttemptState, g *RuntimeGate) { a.DeliveryStatus = "cancelled" }, apperrors.CodeAttemptNotWritable},
		{"paused", func(a *AttemptState, g *RuntimeGate) { a.DeliveryStatus = "paused" }, apperrors.CodeAttemptNotWritable},
		{"post-exam", func(a *AttemptState, g *RuntimeGate) { a.Phase = "post-exam" }, apperrors.CodeAttemptNotWritable},
		{"submittedAt", func(a *AttemptState, g *RuntimeGate) { t := now; a.SubmittedAt = &t }, apperrors.CodeAttemptNotWritable},
		{"proctor-terminated", func(a *AttemptState, g *RuntimeGate) { a.ProctorStatus = "terminated" }, apperrors.CodeAttemptProctorBlocked},
		{"proctor-paused", func(a *AttemptState, g *RuntimeGate) { a.ProctorStatus = "paused" }, apperrors.CodeAttemptProctorBlocked},
		{"runtime-not-live", func(a *AttemptState, g *RuntimeGate) { g.Status = "paused" }, apperrors.CodeAttemptNotWritable},
		{"runtime-waiting", func(a *AttemptState, g *RuntimeGate) { g.WaitingForNextSection = true }, apperrors.CodeAttemptNotWritable},
		{"past-grace", func(a *AttemptState, g *RuntimeGate) { t := now.Add(-time.Microsecond); a.ClosingGraceUntil = &t }, apperrors.CodeDeadlineExpired},
		{"at-grace-inclusive", func(a *AttemptState, g *RuntimeGate) { t := now; a.ClosingGraceUntil = &t }, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			a, g := openAttempt(), liveGate(now)
			tc.mut(&a, &g)
			err := ensureWritable(a, g, now)
			if tc.code == "" {
				if err != nil {
					t.Fatalf("expected writable, got %v", err)
				}
				return
			}
			if err == nil {
				t.Fatalf("expected error code")
			}
			appErr, ok := apperrors.As(err)
			if !ok || appErr.Code != tc.code {
				t.Fatalf("expected code, got %v", err)
			}
		})
	}
}

func TestEnsureQuestionAdmittedMatrix(t *testing.T) {
	gate := liveGate(time.Now().UTC())
	cases := []struct {
		name    string
		owner   QuestionOwner
		code    apperrors.Code
		message string
	}{
		{"active", QuestionOwner{ModuleState: "active", SectionKey: "rw"}, "", ""},
		{"review", QuestionOwner{ModuleState: "review", SectionKey: "rw"}, "", ""},
		{"unassigned", QuestionOwner{ModuleState: "unassigned", SectionKey: "rw"}, apperrors.CodeAttemptNotWritable, "Question is not in an assigned module for this attempt."},
		{"submitted", QuestionOwner{ModuleState: "submitted", SectionKey: "rw"}, apperrors.CodeAttemptNotWritable, "Question module is not active."},
		{"locked", QuestionOwner{ModuleState: "locked", SectionKey: "rw"}, apperrors.CodeAttemptNotWritable, "Question module is not active."},
		{"not_started", QuestionOwner{ModuleState: "not_started", SectionKey: "rw"}, apperrors.CodeAttemptNotWritable, "Question module is not active."},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := ensureQuestionAdmitted(tc.owner, gate, "q-1")
			if tc.code == "" {
				if err != nil {
					t.Fatalf("expected admitted, got %v", err)
				}
				return
			}
			appErr, ok := apperrors.As(err)
			if !ok || appErr.Code != tc.code || appErr.Message != tc.message {
				t.Fatalf("expected %s %q, got %v", tc.code, tc.message, err)
			}
			if appErr.HTTPStatus != 422 {
				t.Fatalf("expected 422, got %d", appErr.HTTPStatus)
			}
		})
	}
	// Section mismatch stays a distinct BAD_REQUEST.
	sectionGate := gate
	sectionGate.ActiveSectionKey = "math"
	err := ensureQuestionAdmitted(QuestionOwner{ModuleState: "active", SectionKey: "reading-writing"}, sectionGate, "q-1")
	appErr, ok := apperrors.As(err)
	if !ok || appErr.Code != apperrors.CodeBadRequest || appErr.HTTPStatus != 400 {
		t.Fatalf("expected section BAD_REQUEST, got %v", err)
	}
}

// Between sections: the runtime is live but waiting for the next section. The
// gate must refuse with the explicit waiting message (not a generic liveness
// refusal) so the client can tell "the room is on its break" from "your exam
// is paused". This is the flag the section reconciler now actually sets.
func TestEnsureWritableBetweenSections(t *testing.T) {
	now := time.Now().UTC()
	a, g := openAttempt(), liveGate(now)
	g.WaitingForNextSection = true
	err := ensureWritable(a, g, now)
	appErr, ok := apperrors.As(err)
	if !ok {
		t.Fatalf("expected an app error, got %v", err)
	}
	if appErr.Code != apperrors.CodeAttemptNotWritable || appErr.HTTPStatus != 422 {
		t.Fatalf("expected 422 NOT_WRITABLE, got %s/%d", appErr.Code, appErr.HTTPStatus)
	}
	if appErr.Message != "Exam runtime is waiting." {
		t.Fatalf("expected the waiting message, got %q", appErr.Message)
	}
}

func TestFencingErrorCodes(t *testing.T) {
	if e := leaseFenced(); e.Code != apperrors.CodeLeaseFenced || e.HTTPStatus != 403 {
		t.Fatalf("leaseFenced wrong: %+v", e)
	}
	if e := controlStale(4, 5); e.Code != apperrors.CodeControlEpochStale || e.HTTPStatus != 409 {
		t.Fatalf("controlStale wrong: %+v", e)
	}
}

func TestCommandHashDeterministic(t *testing.T) {
	c := ResponseCommand{WriteID: "w1", QuestionID: "q1", ClientVersion: 2, Response: ResponsePayload{Answer: map[string]any{"b": 1, "a": 2}, EliminatedOptions: []string{"B"}}}
	h1, err := commandHash(c)
	if err != nil {
		t.Fatal(err)
	}
	h2, err := commandHash(c)
	if err != nil {
		t.Fatal(err)
	}
	if h1 != h2 || h1 == "" {
		t.Fatal("command hash not deterministic")
	}
	c2 := c
	c2.ClientVersion = 3
	h3, _ := commandHash(c2)
	if h3 == h1 {
		t.Fatal("version change did not affect hash")
	}
}
