package authoringcoedit

import "strings"

// Env names as operators set them (documented in .env.example). There is no
// frontend kill switch: the browser posture is always on and the tokens it
// needs are minted only when the server gates below admit the caller. The
// server gates are:
//
//	AUTHORING_REALTIME_COEDITING        server capability (token issuance +
//	                                    co-edit admission + legacy prompt guard)
//	AUTHORING_COEDIT_SERVICE_ENABLED    Hocuspocus service admission
//
// The application enables both postures by default. The fields and environment
// names remain for compatibility with older deployments and focused tests.
const (
	EnvFeatureEnabled = "AUTHORING_REALTIME_COEDITING"
	EnvServiceEnabled = "AUTHORING_COEDIT_SERVICE_ENABLED"
	EnvTokenSecret    = "AUTHORING_COEDIT_TOKEN_SECRET"
	EnvServiceSecret  = "AUTHORING_COEDIT_SERVICE_SECRET"
	EnvServiceURL     = "AUTHORING_COEDIT_SERVICE_URL"
	EnvPublicWSScheme = "AUTHORING_COEDIT_PUBLIC_WS_SCHEME"
)

// MinSecretBytes is the minimum secret length both services enforce. Anything
// shorter fails startup rather than silently weakening the HMAC.
const MinSecretBytes = 32

// Flags is the resolved co-editing posture. Zero value remains OFF so focused
// tests can model an unavailable deployment.
type Flags struct {
	// FeatureEnabled is the server capability gate.
	FeatureEnabled bool
	// ServiceEnabled is the Hocuspocus admission gate.
	ServiceEnabled bool
	// ServiceURL is the private control endpoint used by freeze/flush/close.
	ServiceURL string
}

// Off returns an explicit unavailable posture for tests and compatibility code.
func Off() Flags { return Flags{} }

// CapabilityEnabled reports whether this explicitly supplied posture is ready
// for browser admission. Production application wiring supplies the always-on
// posture from config.Load.
func (f Flags) CapabilityEnabled() bool {
	return f.FeatureEnabled && f.ServiceEnabled && strings.TrimSpace(f.ServiceURL) != ""
}

// Enabled reports the feature gate alone (token issuance + legacy guard).
func (f Flags) Enabled() bool { return f.FeatureEnabled }

// ParseBool accepts the operator spellings used across this codebase.
func ParseBool(raw string) bool {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}
