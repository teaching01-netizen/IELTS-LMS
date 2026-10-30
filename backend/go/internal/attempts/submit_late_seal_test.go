package attempts

import (
	"testing"
	"time"

	examdomain "example.com/ielts-proctoring/internal/exams"
	examruntime "example.com/ielts-proctoring/internal/runtime"
)

// The late-seal branch may only finalize an open IELTS attempt after the
// whole room's time ran out. Every other refusal keeps its owner.
func TestIELTSRoomTimeExpired(t *testing.T) {
	now := time.Date(2026, 10, 30, 17, 45, 4, 0, time.UTC)
	open := AttemptState{DeliveryStatus: "running", Phase: "exam", ProctorStatus: "active"}
	ended := RuntimeGate{Status: "completed", CompletionReason: "time_expired"}

	shared := func(startAgo time.Duration) RuntimeGate {
		s, err := examruntime.BuildIELTSSharedSchedule(now.Add(-startAgo), []examruntime.PlanEntry{
			{SectionKey: "listening", Order: 1, DurationMinutes: 30},
			{SectionKey: "reading", Order: 2, DurationMinutes: 60},
		}, 10*time.Second)
		if err != nil {
			t.Fatal(err)
		}
		return RuntimeGate{Status: "live", TimingModel: examruntime.TimingModelIELTSSharedSchedule, SharedSchedule: &s}
	}

	submitted := now
	cases := []struct {
		name     string
		provider Provider
		attempt  AttemptState
		gate     RuntimeGate
		want     bool
	}{
		{"room ended by time", ProviderIELTS, open, ended, true},
		{"shared timetable past final save window", ProviderIELTS, open, shared(2 * time.Hour), true},
		{"shared timetable still in final section", ProviderIELTS, open, shared(80 * time.Minute), false},
		{"shared timetable between sections", ProviderIELTS, open, shared(30*time.Minute + time.Minute), false},
		{"room ended by proctor", ProviderIELTS, open, RuntimeGate{Status: "completed", CompletionReason: "proctor_end"}, false},
		{"room paused", ProviderIELTS, open, RuntimeGate{Status: "paused"}, false},
		{"room still live, cohort", ProviderIELTS, open, RuntimeGate{Status: "live"}, false},
		{"SAT", ProviderSAT, open, ended, false},
		{"ACT", ProviderACT, open, ended, false},
		{"personal timing owns its end", ProviderIELTS, open, RuntimeGate{Status: "completed", CompletionReason: "time_expired", TimingModel: personalIELTSTimingModel}, false},
		{"already submitted", ProviderIELTS, AttemptState{DeliveryStatus: "submitted", Phase: "post-exam", ProctorStatus: "active", SubmittedAt: &submitted}, ended, false},
		{"proctor terminated", ProviderIELTS, AttemptState{DeliveryStatus: "running", Phase: "exam", ProctorStatus: "terminated"}, ended, false},
		{"proctor paused", ProviderIELTS, AttemptState{DeliveryStatus: "running", Phase: "exam", ProctorStatus: "paused"}, ended, false},
		{"attempt paused", ProviderIELTS, AttemptState{DeliveryStatus: "paused", Phase: "exam", ProctorStatus: "active"}, ended, false},
		{"device recovery owns the end", ProviderIELTS, AttemptState{DeliveryStatus: "running", Phase: "exam", ProctorStatus: "active", RecoveryControl: &examdomain.RecoveryControl{}}, ended, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := ieltsRoomTimeExpired(tc.provider, tc.attempt, tc.gate, now); got != tc.want {
				t.Fatalf("got %v, want %v", got, tc.want)
			}
		})
	}
}
