package authoringrealtime

import (
	"strings"
)

// Env names as operators actually set them, documented in .env.example and
// pinned by config/runbookflags_test.go.
//
// Phase 06 removed a second, competing vocabulary from this file. There used to
// be an `AUTHORING_PRESENCE` / `AUTHORING_CONFLICT_COMPARE` pair plus a
// LoadFromEnv reader here, none of which any call site used: the runtime reads
// the config package. Keeping them was not merely dead code, it was a trap for
// whoever wrote the rollout runbook — flipping `AUTHORING_PRESENCE` would have
// done nothing while looking exactly like the right command.
const (
	EnvEvents   = "AUTHORING_REALTIME_EVENTS"
	EnvDelivery = "AUTHORING_REALTIME_DELIVERY"
)

// Flags is the resolved realtime posture. Zero value = all OFF (safe).
type Flags struct {
	Events          bool
	Delivery        bool
	Presence        bool
	ConflictCompare bool
}

// Off returns the default posture.
func Off() Flags { return Flags{} }

func parseBool(raw string) bool {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}

// Accessors (call sites read intent, not raw bools).
func (f Flags) EventsEnabled() bool          { return f.Events }
func (f Flags) DeliveryEnabled() bool        { return f.Delivery }
func (f Flags) PresenceEnabled() bool        { return f.Presence }
func (f Flags) ConflictCompareEnabled() bool { return f.ConflictCompare }
