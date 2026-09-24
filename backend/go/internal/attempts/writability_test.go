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
		// Section liveness (audit finding 3): these flags are read on the write's
		// own transaction, so a planned-but-locked, paused or completed section
		// refuses in both locker modes instead of being ignored.
		{"section-not-started", func(a *AttemptState, g *RuntimeGate) { g.SectionStarted = false; g.SectionLive = false }, apperrors.CodeAttemptNotWritable},
		{"section-paused", func(a *AttemptState, g *RuntimeGate) { g.SectionPaused = true; g.SectionLive = false }, apperrors.CodeAttemptNotWritable},
		{"section-completed", func(a *AttemptState, g *RuntimeGate) { g.SectionLive = false }, apperrors.CodeAttemptNotWritable},
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

func TestEnsureQuestionAdmittedEnforcesSATPersonalModuleDeadline(t *testing.T) {
	now := time.Now().UTC()
	deadline := now
	owner := QuestionOwner{ModuleState: "active", SectionKey: "reading-writing", ModuleDeadlineAt: &deadline}
	gate := liveGate(now)
	err := ensureQuestionAdmitted(owner, gate, "q-1")
	appErr, ok := apperrors.As(err)
	if !ok || appErr.Code != apperrors.CodeDeadlineExpired || appErr.HTTPStatus != 422 {
		t.Fatalf("a fresh write at the personal module deadline must fail: %v", err)
	}

	gate.Now = now.Add(-time.Nanosecond)
	if err := ensureQuestionAdmitted(owner, gate, "q-1"); err != nil {
		t.Fatalf("a write immediately before the module deadline must remain admissible: %v", err)
	}
}

func TestEnsureWritablePersonalSATIgnoresCohortSectionState(t *testing.T) {
	now := time.Date(2026, 9, 24, 2, 0, 0, 0, time.UTC)
	attempt := openAttempt()
	gate := RuntimeGate{TimingModel: "sat_personal_v1", Status: "live", WaitingForNextSection: true, SectionStarted: false, SectionLive: false, Now: now}
	if err := ensureWritable(attempt, gate, now); err != nil {
		t.Fatalf("personal attempt should not be restricted by the cohort section cursor: %v", err)
	}
	gate.Status = "paused"
	if err := ensureWritable(attempt, gate, now); err == nil {
		t.Fatal("personal attempt must still be frozen when the room is paused")
	}
}

// The single-operation offer flow (StartModuleOfferAck) sets the module to
// active with started_at = DB NOW and never writes entry_confirmed_at. An
// active personal module with a started_at in the past and a live deadline is
// writable even when entry_confirmed_at is NULL; only a missing or future
// started_at refuses.
func TestEnsurePersonalQuestionWritableOnStartedModuleWithoutEntryConfirmation(t *testing.T) {
	now := time.Date(2026, 9, 24, 2, 0, 10, 0, time.UTC)
	started := now.Add(-time.Second)
	deadline := now.Add(time.Minute)
	gate := RuntimeGate{TimingModel: "sat_personal_v1", Status: "live", ActiveSectionKey: "math", SectionLive: false, Now: now}
	owner := QuestionOwner{
		ModuleState: "active", SectionKey: "reading-writing", TimingModel: "sat_personal_v1",
		ModuleStartedAt: &started, ModuleDeadlineAt: &deadline, EntryConfirmedAt: nil,
	}
	if err := ensureQuestionAdmittedForProvider(owner, gate, "q-1", string(ProviderSAT)); err != nil {
		t.Fatalf("active module with started_at and deadline must accept a response without entry confirmation: %v", err)
	}

	owner.ModuleStartedAt = nil
	if err := ensureQuestionAdmittedForProvider(owner, gate, "q-1", string(ProviderSAT)); err == nil {
		t.Fatal("module without started_at must not accept a response")
	}

	future := now.Add(time.Second)
	owner.ModuleStartedAt = &future
	if err := ensureQuestionAdmittedForProvider(owner, gate, "q-1", string(ProviderSAT)); err == nil {
		t.Fatal("module with a future started_at must not accept a response")
	}
}

// The attempt-level closing grace is the ROOM's section clock. A personal SAT
// attempt owns its module deadline, so a past room grace must not freeze its
// answers — while a cohort attempt keeps the existing refusal (plan 2026-09-24
// full-entry-time: Student B's second subject runs long after the room's first
// section clock has expired).
func TestEnsureWritablePersonalSATHasNoRoomClosingGrace(t *testing.T) {
	now := time.Date(2026, 9, 24, 2, 0, 0, 0, time.UTC)
	roomGraceOver := now.Add(-time.Minute)

	personal := openAttempt()
	personal.ProviderKey = string(ProviderSAT)
	personal.TimingModel = personalTimingModel
	personal.ClosingGraceUntil = &roomGraceOver
	personalGate := RuntimeGate{TimingModel: personalTimingModel, Status: "live", SectionLive: true, SectionStarted: true, Now: now}
	if err := ensureWritable(personal, personalGate, now); err != nil {
		t.Fatalf("personal SAT attempt must ignore the room section grace: %v", err)
	}

	// The row is the durable carrier: a gate that lost the model mid-transition
	// still reads personal from the locked attempt.
	runtimeGate := RuntimeGate{Status: "live", SectionLive: true, SectionStarted: true, Now: now}
	if err := ensureWritable(personal, runtimeGate, now); err != nil {
		t.Fatalf("personal SAT attempt must ignore the room section grace from the row alone: %v", err)
	}

	cohort := openAttempt()
	cohort.ProviderKey = string(ProviderSAT)
	cohort.TimingModel = "cohort_section_v3"
	cohort.ClosingGraceUntil = &roomGraceOver
	cohortGate := liveGate(now)
	cohortGate.TimingModel = "cohort_section_v3"
	err := ensureWritable(cohort, cohortGate, now)
	if err == nil {
		t.Fatal("cohort attempt past its section grace must stay refused")
	}
	if appErr, ok := apperrors.As(err); !ok || appErr.Code != apperrors.CodeDeadlineExpired {
		t.Fatalf("cohort past-grace refusal = %v, want DEADLINE_EXPIRED", err)
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

func TestEnsureWritableAllowsOnlyClosingGraceAfterBreakIsPublished(t *testing.T) {
	now := time.Now().UTC()
	graceUntil := now.Add(30 * time.Second)
	a, g := openAttempt(), liveGate(now)
	a.ClosingGraceUntil = &graceUntil
	g.WaitingForNextSection = true
	g.SectionLive = false

	if err := ensureWritable(a, g, now); err != nil {
		t.Fatalf("a write inside the response grace must remain writable: %v", err)
	}

	afterGrace := graceUntil.Add(time.Nanosecond)
	err := ensureWritable(a, g, afterGrace)
	appErr, ok := apperrors.As(err)
	if !ok || appErr.Code != apperrors.CodeAttemptNotWritable || appErr.Message != "Exam runtime is waiting." {
		t.Fatalf("after grace want waiting rejection, got %v", err)
	}
}

func TestEnsureWritableSATSaveOnlyGrace(t *testing.T) {
	now := time.Now().UTC()
	deadline := now.Add(-time.Second)
	graceUntil := now.Add(29 * time.Second)
	a, g := openAttempt(), liveGate(now)
	a.ProviderKey = string(ProviderSAT)
	a.DeadlineAt = &deadline
	a.ClosingGraceUntil = &graceUntil
	g.WaitingForNextSection = true
	g.SectionLive = false

	if err := ensureWritable(a, g, now); err != nil {
		t.Fatalf("SAT response inside save-only grace must remain writable: %v", err)
	}
	err := ensureWritable(a, g, deadline.Add(SATSaveGrace))
	appErr, ok := apperrors.As(err)
	if !ok || appErr.Code != apperrors.CodeDeadlineExpired || appErr.HTTPStatus != 422 {
		t.Fatalf("fresh SAT write after save-only grace must expire, got %v", err)
	}
}

func TestEnsureQuestionAdmittedSATSaveOnlyGrace(t *testing.T) {
	now := time.Now().UTC()
	deadline := now.Add(-time.Second)
	owner := QuestionOwner{ModuleState: "active", SectionKey: "reading-writing", ModuleDeadlineAt: &deadline}
	gate := liveGate(now)
	gate.ActiveSectionKey = "math"
	if err := ensureQuestionAdmittedForProvider(owner, gate, "q-1", string(ProviderSAT)); err != nil {
		t.Fatalf("closing SAT module must accept its queued answer: %v", err)
	}
	gate.Now = deadline.Add(SATSaveGrace)
	if err := ensureQuestionAdmittedForProvider(owner, gate, "q-1", string(ProviderSAT)); err == nil {
		t.Fatal("SAT module must reject a fresh answer after save-only grace")
	}
	gate.Now = now
	if err := ensureQuestionAdmittedForProvider(owner, gate, "q-1", string(ProviderACT)); err == nil {
		t.Fatal("ACT must not inherit the SAT closing window")
	}
}

// The section verdicts carry distinct messages, so a client can tell "the
// proctor paused your section" from "your section has not opened yet".
func TestEnsureWritableSectionMessages(t *testing.T) {
	now := time.Now().UTC()
	cases := []struct {
		name    string
		mut     func(*RuntimeGate)
		message string
	}{
		{"not started", func(g *RuntimeGate) { g.SectionStarted = false; g.SectionLive = false }, "Exam section has not started."},
		{"paused", func(g *RuntimeGate) { g.SectionPaused = true; g.SectionLive = false }, "Exam section is paused."},
		{"completed", func(g *RuntimeGate) { g.SectionLive = false }, "Exam section is not live."},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			a, g := openAttempt(), liveGate(now)
			tc.mut(&g)
			err := ensureWritable(a, g, now)
			appErr, ok := apperrors.As(err)
			if !ok || appErr.Code != apperrors.CodeAttemptNotWritable || appErr.HTTPStatus != 422 {
				t.Fatalf("want 422 NOT_WRITABLE, got %v", err)
			}
			if appErr.Message != tc.message {
				t.Fatalf("want %q, got %q", tc.message, appErr.Message)
			}
		})
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
