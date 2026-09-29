package delivery

// Save-gate boundary contract.
//
// Two live SAT write paths admit answers against the same module row: the
// delivery single-response PATCH (ensureSaveModuleAdmitted, reached from
// SaveResponse/SubmitModule on the legacy/personal gate) and the V2 batch
// endpoint (attempts.ensureQuestionAdmittedForProvider). The reconciler closes
// a module only after deadline + attempts.SATSaveGrace, so both gates have to
// end at that same instant. If the delivery gate ended at the bare deadline it
// would reject a write the runner had already been told was admitted, inside
// the very window the reconciler leaves open.

import (
	"errors"
	"testing"
	"time"

	"example.com/ielts-proctoring/internal/attempts"
	"example.com/ielts-proctoring/internal/platform/apperrors"
)

func saveGateReason(err error) string {
	var appErr *apperrors.Error
	if !errors.As(err, &appErr) || appErr.Details == nil {
		return ""
	}
	reason, _ := appErr.Details["reason"].(string)
	return reason
}

func TestEnsureSaveModuleAdmittedHonoursTheSaveGraceWindow(t *testing.T) {
	started := time.Date(2026, 3, 1, 12, 0, 0, 0, time.UTC)
	deadline := started.Add(60 * time.Second)
	module := saveActiveModule{
		id: "ma-1", moduleID: "mod-1", state: "active",
		startedAt: &started, allocatedSeconds: 60,
	}

	for _, test := range []struct {
		name string
		now  time.Time
		want string
	}{
		{"one second inside the window", deadline.Add(-time.Second), ""},
		{"exactly on the visible deadline", deadline, ""},
		{"inside the save grace", deadline.Add(attempts.SATSaveGrace - time.Millisecond), ""},
		{"exactly on the grace edge", deadline.Add(attempts.SATSaveGrace), ""},
		{"past the grace window", deadline.Add(attempts.SATSaveGrace + time.Millisecond), "DEADLINE_EXPIRED"},
	} {
		t.Run(test.name, func(t *testing.T) {
			err := ensureSaveModuleAdmitted(module, test.now)
			if got := saveGateReason(err); got != test.want {
				t.Fatalf("reason = %q, want %q (err %v)", got, test.want, err)
			}
		})
	}
}

// The other gates on the same function are unchanged: a module that is not
// active, was never started, or is proctor-paused is still refused inside the
// grace window.
func TestEnsureSaveModuleAdmittedKeepsItsOtherGates(t *testing.T) {
	started := time.Date(2026, 3, 1, 12, 0, 0, 0, time.UTC)
	inside := started.Add(30 * time.Second)
	paused := started.Add(10 * time.Second)
	base := saveActiveModule{
		id: "ma-1", moduleID: "mod-1", state: "active",
		startedAt: &started, allocatedSeconds: 60,
	}

	locked := base
	locked.state = "locked"
	if err := ensureSaveModuleAdmitted(locked, inside); saveGateReason(err) != "MODULE_NOT_ACTIVE" {
		t.Fatalf("a locked module must stay refused, got %v", err)
	}

	unstarted := base
	unstarted.startedAt = nil
	if err := ensureSaveModuleAdmitted(unstarted, inside); saveGateReason(err) != "RUNTIME_NOT_LIVE" {
		t.Fatalf("an unstarted module must stay refused, got %v", err)
	}

	pausedModule := base
	pausedModule.pausedAt = &paused
	if err := ensureSaveModuleAdmitted(pausedModule, inside); saveGateReason(err) != "RUNTIME_PAUSED" {
		t.Fatalf("a proctor-paused module must stay refused, got %v", err)
	}
}
