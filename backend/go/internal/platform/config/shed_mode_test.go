package config

import (
	"testing"
)

// E2 RED: SHED_MODE defaults off (ship budgets); exam rebalances toward
// submit/seal/autosave/bootstrap at the expense of poll/heartbeat/admin.
// Unknown fails closed (never silently crushes admin or sheds submits).
func TestShedModeDefaultsOff(t *testing.T) {
	t.Setenv("SHED_MODE", "")
	if cfg := Load(); cfg.ShedMode != ShedOff {
		t.Fatalf("SHED_MODE must default off, got %q", cfg.ShedMode)
	}
}

func TestShedModeExamParses(t *testing.T) {
	t.Setenv("SHED_MODE", "exam")
	if cfg := Load(); cfg.ShedMode != ShedExam {
		t.Fatalf("SHED_MODE=exam must parse, got %q", cfg.ShedMode)
	}
}

func TestShedModeUnknownFailsClosed(t *testing.T) {
	t.Setenv("SHED_MODE", "turbo")
	if err := Load().ValidateForRuntime(); err == nil {
		t.Fatalf("unknown SHED_MODE must fail closed")
	}
}

// E2 RED: exam budgets never shed submits/writes; poll/heartbeat/admin drop.
func TestShedExamBudgetsProtectSubmits(t *testing.T) {
	base := map[string]int{
		"writes": 120, "polling": 240, "heartbeat": 120, "authed-reads": 300,
	}
	out := ApplyShedMode(ShedExam, base)
	if out["writes"] < base["writes"] {
		t.Fatalf("exam must not shed writes: %v", out)
	}
	if out["polling"] >= base["polling"] || out["heartbeat"] >= base["heartbeat"] {
		t.Fatalf("exam must crush poll/heartbeat: %v", out)
	}
	if out["authed-reads"] >= base["authed-reads"] {
		t.Fatalf("exam must crush admin-heavy reads: %v", out)
	}
}

// Round 66 doc↔code parity: the runbook quotes exact exam-window figures
// (poll 240->60, heartbeat 120->30, authed-reads 300->150). Relative
// assertions above would pass a /3 or /8 drift the runbook contradicts.
// This test pins the documented numbers so code or doc drift fails here.
func TestShedExamRunbookFigures(t *testing.T) {
	base := map[string]int{
		"writes": 120, "polling": 240, "heartbeat": 120, "authed-reads": 300,
	}
	out := ApplyShedMode(ShedExam, base)
	if out["polling"] != 60 || out["heartbeat"] != 30 || out["authed-reads"] != 150 {
		t.Fatalf("runbook figures drifted (want poll=60/beat=30/reads=150), got %v", out)
	}
	if out["writes"] != 120 {
		t.Fatalf("writes must hold at 120 under exam, got %v", out)
	}
}

// E2 RED: off is identity (rollback = flip + redeploy).
func TestShedOffIsIdentity(t *testing.T) {
	base := map[string]int{"writes": 120, "polling": 240}
	out := ApplyShedMode(ShedOff, base)
	if out["writes"] != 120 || out["polling"] != 240 {
		t.Fatalf("off must be identity: %v", out)
	}
}
