package attempts

import (
	"sync/atomic"
	"time"
)

// SAT module handoff policy (docs/sat-m1-m2-handoff-plan.md).
//
// HandoffModeServerStart is the deployed behavior: the reconciler opens the
// routed Module 2 already running at finalization time. HandoffModeClientStart
// inserts the routed Module 2 not_started; its clock starts when the browser
// receives it (StartModule) or at the auto-start backstop, so routing and
// delivery latency are never charged to Module 2.
const (
	HandoffModeServerStart = "server_start"
	HandoffModeClientStart = "client_start"
)

// Module-scoped rejection reasons carried in apperrors Details["reason"]. A
// client may confine these to the one module they name; any rejection without
// one of them keeps its attempt-wide meaning.
const (
	ReasonModuleUnassigned      = "MODULE_UNASSIGNED"
	ReasonModuleClosed          = "MODULE_CLOSED"
	ReasonModuleNotStarted      = "MODULE_NOT_STARTED"
	ReasonModuleDeadlineExpired = "MODULE_DEADLINE_EXPIRED"
)

// SATHandoffConfig is the process-wide handoff policy. One owner: the write
// gates, the reconciler, and the close endpoint all read it through
// SATHandoff/ModuleCloseWindow so their boundaries cannot drift.
type SATHandoffConfig struct {
	Mode string
	// CloseWindow is the LONGEST a personal module stays writable after its
	// deadline when no browser confirms its final answers. A confirmed close
	// routes immediately; this is only the backstop for silent browsers.
	CloseWindow time.Duration
	// AutoStart is how long a routed, not-yet-started Module 2 waits for the
	// browser before the server starts its clock anyway.
	AutoStart time.Duration
}

// Defaults keep today's behavior: server_start, so the close window stays at
// SATSaveGrace and no Module 2 waits for a browser.
const (
	DefaultSATPersonalCloseWindow = 15 * time.Second
	DefaultSATM2AutoStart         = 60 * time.Second
)

var satHandoff atomic.Pointer[SATHandoffConfig]

func init() {
	satHandoff.Store(&SATHandoffConfig{
		Mode:        HandoffModeServerStart,
		CloseWindow: DefaultSATPersonalCloseWindow,
		AutoStart:   DefaultSATM2AutoStart,
	})
}

// ConfigureSATHandoff installs the policy at the composition root. Values are
// normalized: an unknown mode is server_start, the close window is never
// shorter than SATSaveGrace, and auto-start is at least one second.
func ConfigureSATHandoff(cfg SATHandoffConfig) {
	if cfg.Mode != HandoffModeClientStart {
		cfg.Mode = HandoffModeServerStart
	}
	if cfg.CloseWindow < SATSaveGrace {
		cfg.CloseWindow = SATSaveGrace
	}
	if cfg.AutoStart < time.Second {
		cfg.AutoStart = time.Second
	}
	satHandoff.Store(&cfg)
}

// SATHandoff returns the active handoff policy.
func SATHandoff() SATHandoffConfig {
	return *satHandoff.Load()
}

// ClientStartHandoff reports whether routed Module 2 attempts are opened by
// the browser (with the server auto-start backstop).
func ClientStartHandoff() bool {
	return SATHandoff().Mode == HandoffModeClientStart
}

// ModuleCloseWindow is the save-only window after a SAT module deadline: the
// write gates admit answers inside it and the reconciler routes only after it.
// It widens to the configured close window only for the personal model under
// client_start, where waiting costs no Module 2 time. Every other model keeps
// SATSaveGrace because the cohort section clock keeps running meanwhile.
func ModuleCloseWindow(timingModel string, runtimeMode ...string) time.Duration {
	cfg := SATHandoff()
	mode := HandoffModeServerStart
	if len(runtimeMode) > 0 {
		mode = runtimeMode[0]
	}
	if isPersonalTimingModel(timingModel) && mode == HandoffModeClientStart {
		return cfg.CloseWindow
	}
	return SATSaveGrace
}
