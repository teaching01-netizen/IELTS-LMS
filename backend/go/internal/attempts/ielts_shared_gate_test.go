package attempts

import (
	"testing"
	"time"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	examruntime "example.com/ielts-proctoring/internal/runtime"
)

func sharedGate(t *testing.T, now time.Time) RuntimeGate {
	t.Helper()
	start := time.Date(2026, 10, 30, 3, 0, 0, 0, time.UTC)
	s, err := examruntime.BuildIELTSSharedSchedule(start, []examruntime.PlanEntry{
		{SectionKey: "reading", Order: 1, DurationMinutes: 60},
		{SectionKey: "writing", Order: 2, DurationMinutes: 60},
	}, examruntime.ResponseSaveGrace)
	if err != nil {
		t.Fatal(err)
	}
	// The projection is deliberately stale: the rows still say Reading is live.
	return RuntimeGate{Status: "live", TimingModel: examruntime.TimingModelIELTSSharedSchedule, ActiveSectionKey: "reading",
		SectionLive: true, SectionStarted: true, SharedSchedule: &s, Now: now}
}

func reasonOf(err error) string {
	if e, ok := apperrors.As(err); ok {
		if r, ok := e.Details["reason"].(string); ok {
			return r
		}
	}
	return ""
}

func TestSharedGateUsesTimetableOverStaleProjection(t *testing.T) {
	now := time.Date(2026, 10, 30, 4, 10, 0, 0, time.UTC) // Writing is working.
	gate := sharedGate(t, now)
	a := AttemptState{ProviderKey: "ielts", DeliveryStatus: "running", Phase: "exam"}
	if err := ensureWritable(a, gate, now); err != nil {
		t.Fatalf("attempt gate: %v", err)
	}
	err := ensureQuestionAdmittedForProvider(QuestionOwner{SectionKey: "reading", ModuleState: "active"}, gate, "q-r1", "ielts")
	if reasonOf(err) != ReasonIELTSSectionClosed {
		t.Fatalf("stale Reading write: %v", err)
	}
	if e, _ := apperrors.As(err); e.Code != apperrors.CodeDeadlineExpired || e.Details["sectionKey"] != "reading" || e.Details["questionId"] != "q-r1" {
		t.Fatalf("refusal is not section-scoped: %+v", e)
	}
	// A Writing write passes even though its row is still locked.
	if err := ensureQuestionAdmittedForProvider(QuestionOwner{SectionKey: "writing", ModuleState: "not_started"}, gate, "q-w1", "ielts"); err != nil {
		t.Fatalf("writing write refused: %v", err)
	}
}

func TestSharedGateBoundaries(t *testing.T) {
	reading := QuestionOwner{SectionKey: "reading", ModuleState: "active"}
	cases := []struct {
		at     time.Time
		reason string
	}{
		{time.Date(2026, 10, 30, 2, 59, 59, 0, time.UTC), ReasonIELTSSectionNotOpen},
		{time.Date(2026, 10, 30, 3, 0, 0, 0, time.UTC), ""},
		{time.Date(2026, 10, 30, 4, 0, 2, 0, time.UTC), ""}, // save-only drain
		{time.Date(2026, 10, 30, 4, 0, 3, 0, time.UTC), ReasonIELTSSectionClosed},
	}
	for _, c := range cases {
		err := ensureQuestionAdmittedForProvider(reading, sharedGate(t, c.at), "q", "ielts")
		if reasonOf(err) != c.reason || (c.reason == "" && err != nil) {
			t.Fatalf("at %s: %v", c.at.Format(time.TimeOnly), err)
		}
	}
	a := AttemptState{ProviderKey: "ielts", DeliveryStatus: "running", Phase: "exam"}
	end := time.Date(2026, 10, 30, 5, 0, 6, 0, time.UTC)
	if reasonOf(ensureWritable(a, sharedGate(t, end), end)) != ReasonIELTSSectionClosed {
		t.Fatal("writes accepted after the final drain")
	}
	paused := sharedGate(t, end)
	paused.Status = "paused"
	if reasonOf(ensureWritable(a, paused, end)) != "SAVE_PAUSED" {
		t.Fatal("paused room accepted a write")
	}
	missing := sharedGate(t, end)
	missing.SharedSchedule = nil
	if ensureWritable(a, missing, end) == nil {
		t.Fatal("missing timetable must fail closed")
	}
}
