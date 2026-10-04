package delivery

import (
	"testing"
	"time"
)

// A routed module waiting for the browser (client_start) is delivered as
// metadata only: its questions travel with the StartModule that starts its
// clock, so no content is readable on time the module was not charged for.
// The pre-start deadline its row would project is cleared, and the shared
// cached tree is never mutated.
func TestWithholdAwaitingModuleContent(t *testing.T) {
	now := time.Date(2026, 10, 4, 10, 0, 0, 0, time.UTC)
	autoStart := now.Add(time.Minute)
	started := now.Add(-time.Minute)
	deadline := now.Add(31 * time.Minute)
	cached := []DeliverySection{{ID: "rw", Modules: []DeliveryModule{
		{ID: "m1", AdaptiveRole: "base", Questions: []DeliveredQuestion{{ExamQuestionID: "q1"}}},
		{ID: "m2", AdaptiveRole: "higher_branch", Questions: []DeliveredQuestion{{ExamQuestionID: "h1"}, {ExamQuestionID: "h2"}}},
	}}}
	attempts := []ModuleAttempt{
		{ID: "ma-1", ModuleID: "m1", State: "locked", StartedAt: &started},
		{ID: "ma-2", ModuleID: "m2", State: "not_started", AllocatedSeconds: 1920, AvailableAt: &now, AutoStartAt: &autoStart, DeadlineAt: &deadline},
	}

	out := withholdAwaitingModuleContent(cached, attempts)

	m2 := out[0].Modules[1]
	if !m2.ContentWithheld || len(m2.Questions) != 0 {
		t.Fatalf("awaiting module must be metadata only, got withheld=%v questions=%d", m2.ContentWithheld, len(m2.Questions))
	}
	if out[0].Modules[0].ContentWithheld || len(out[0].Modules[0].Questions) != 1 {
		t.Fatal("a closed module keeps its content")
	}
	if attempts[1].DeadlineAt != nil || attempts[1].RemainingSeconds == nil || *attempts[1].RemainingSeconds != 1920 {
		t.Fatalf("awaiting module must project its full allotment and no deadline, got deadline=%v remaining=%v", attempts[1].DeadlineAt, attempts[1].RemainingSeconds)
	}
	if len(cached[0].Modules[1].Questions) != 2 || cached[0].Modules[1].ContentWithheld {
		t.Fatal("the shared cached tree must not be mutated")
	}

	// Once started (by the browser or the backstop) the content is delivered.
	attempts[1].State = "active"
	attempts[1].StartedAt = &now
	if delivered := withholdAwaitingModuleContent(cached, attempts); delivered[0].Modules[1].ContentWithheld {
		t.Fatal("a started module must be delivered with its content")
	}
}
