// Package config loads and validates process configuration once at startup.
// It mirrors the behavior-bearing surface of the Rust config catalogue
// (backend/crates/infrastructure/src/config.rs) so the Go rewrite keeps
// identical env names, defaults and validation semantics.
package config

import (
	"fmt"
	"log"
	"net"
	"net/url"
	"os"
	"strconv"
	"strings"
)

// Prompt co-editing is a product default. These development-only fallbacks
// let the local API and the sidecar agree without requiring rollout flags or
// secret plumbing in every developer shell. Production-like deployments still
// need to provide their own dedicated secrets; wireCoedit fails closed when
// they are absent or too short.
const (
	defaultCoeditServiceURL    = "http://127.0.0.1:1235"
	defaultCoeditTokenSecret   = "local-coedit-token-secret-not-for-production-2026"
	defaultCoeditServiceSecret = "local-coedit-service-secret-not-for-production-2026"
)

var defaultTrustedProxyCIDRs = []string{"127.0.0.0/8", "::1/128"}

// AttemptVerifyMode selects the attempt-bearer verification posture (A3).
// Strict keeps today's DB binding; stateless drops the per-request SELECT.
// Unknown values fail closed at ValidateForRuntime (never silently
// stateless, which would drop the DB binding without operator intent).
type AttemptVerifyMode string

const (
	AttemptVerifyStrict    AttemptVerifyMode = "strict"
	AttemptVerifyStateless AttemptVerifyMode = "stateless"
)

// parseAttemptVerify normalizes ATTEMPT_VERIFY: empty = strict (ship
// state), case-insensitive, trimmed; anything else is preserved verbatim
// so ValidateForRuntime can reject it fail-closed.
func parseAttemptVerify(raw string) AttemptVerifyMode {
	imported := AttemptVerifyMode(strings.ToLower(strings.TrimSpace(raw)))
	switch imported {
	case "", AttemptVerifyStrict:
		return AttemptVerifyStrict
	case AttemptVerifyStateless:
		return AttemptVerifyStateless
	default:
		return AttemptVerifyMode(strings.TrimSpace(raw))
	}
}

// AttemptVerifyStateless reports whether bearer verify skips the DB binding.
func (c Config) AttemptVerifyStateless() bool { return c.AttemptVerify == AttemptVerifyStateless }

// LiveBusMode selects the live-update path (plan C1): db = today's behavior
// (AppendInTx INSERT inside business tx + forwarder poll into the hub);
// direct = hot paths publish Hub-only post-commit with zero live-bus SQL
// (single-deploy: no peers to forward to). Unknown values fail closed.
type LiveBusMode string

const (
	LiveBusDB     LiveBusMode = "db"
	LiveBusDirect LiveBusMode = "direct"
)

// parseLiveBusMode normalizes LIVE_BUS: empty = db (ship state),
// case-insensitive, trimmed; anything else preserved verbatim so
// ValidateForRuntime can reject it fail-closed.
func parseLiveBusMode(raw string) LiveBusMode {
	switch LiveBusMode(strings.ToLower(strings.TrimSpace(raw))) {
	case "", LiveBusDB:
		return LiveBusDB
	case LiveBusDirect:
		return LiveBusDirect
	default:
		return LiveBusMode(strings.TrimSpace(raw))
	}
}

// IsDirect reports the Hub-only posture (zero live-bus SQL on hot paths).
func (c Config) IsDirect() bool { return c.LiveBus == LiveBusDirect }

// LiveBusSinkMode selects the optional async debug sink (plan C1): off =
// no live_update_events writes at all; sample = ~1:1000 sampled rows for
// debugging (retention still purges). Unknown values fail closed.
type LiveBusSinkMode string

const (
	LiveBusSinkOff    LiveBusSinkMode = "off"
	LiveBusSinkSample LiveBusSinkMode = "sample"
)

func parseLiveBusSink(raw string) LiveBusSinkMode {
	switch LiveBusSinkMode(strings.ToLower(strings.TrimSpace(raw))) {
	case "", LiveBusSinkOff:
		return LiveBusSinkOff
	case LiveBusSinkSample:
		return LiveBusSinkSample
	default:
		return LiveBusSinkMode(strings.TrimSpace(raw))
	}
}

// WSAdmissionMode selects the websocket admission gate (plan C2): db =
// today's singleton-row lease tx (ship state, behavior-preserving); memory =
// the zero-SQL in-process gate (single-deploy target). Unknown values fail
// closed at ValidateForRuntime (never silently permissive).
type WSAdmissionMode string

const (
	WSAdmissionDB     WSAdmissionMode = "db"
	WSAdmissionMemory WSAdmissionMode = "memory"
)

// parseWSAdmissionMode normalizes WS_ADMISSION: empty = db (ship state),
// case-insensitive, trimmed; anything else preserved verbatim so
// ValidateForRuntime can reject it fail-closed.
func parseWSAdmissionMode(raw string) WSAdmissionMode {
	switch WSAdmissionMode(strings.ToLower(strings.TrimSpace(raw))) {
	case "", WSAdmissionDB:
		return WSAdmissionDB
	case WSAdmissionMemory:
		return WSAdmissionMemory
	default:
		return WSAdmissionMode(strings.TrimSpace(raw))
	}
}

// WSAdmissionMemory reports the zero-SQL in-process posture.
func (c Config) WSAdmissionMemory() bool { return c.WSAdmission == WSAdmissionMemory }

// StudentWSMode gates student sockets (plan C3): allow = dual-serve ship
// state (students may hold WS while clients migrate); gone = student WS
// attempts get 410 GONE + {use: runtime-poll}. Staff WS is unaffected.
// Unknown values fail closed at ValidateForRuntime.
type StudentWSMode string

const (
	StudentWSAllow StudentWSMode = "allow"
	StudentWSGone  StudentWSMode = "gone"
)

// parseStudentWSMode normalizes STUDENT_WS: empty = allow (ship state),
// case-insensitive, trimmed; anything else preserved verbatim so
// ValidateForRuntime can reject it fail-closed.
func parseStudentWSMode(raw string) StudentWSMode {
	switch StudentWSMode(strings.ToLower(strings.TrimSpace(raw))) {
	case "", StudentWSAllow:
		return StudentWSAllow
	case StudentWSGone:
		return StudentWSGone
	default:
		return StudentWSMode(strings.TrimSpace(raw))
	}
}

// StudentWSGone reports whether student sockets are retired.
func (c Config) StudentWSGone() bool { return c.StudentWS == StudentWSGone }

// ShedMode selects the load-shedding posture (plan E2): off = ship tier
// budgets; exam = rebalance toward submit/seal/autosave/bootstrap at the
// expense of runtime-poll/heartbeat/proctor-list/admin. Submits are NEVER
// shed in any mode. Unknown values fail closed at ValidateForRuntime.
type ShedMode string

const (
	ShedOff  ShedMode = "off"
	ShedExam ShedMode = "exam"
)

// parseShedMode normalizes SHED_MODE: empty = off (ship state),
// case-insensitive, trimmed; anything else preserved verbatim so
// ValidateForRuntime can reject it fail-closed.
func parseShedMode(raw string) ShedMode {
	switch ShedMode(strings.ToLower(strings.TrimSpace(raw))) {
	case "", ShedOff:
		return ShedOff
	case ShedExam:
		return ShedExam
	default:
		return ShedMode(strings.TrimSpace(raw))
	}
}

// ApplyShedMode rebalances per-minute tier budgets. Off = identity
// (rollback shape). Exam raises writes/authed-path budgets modestly and
// crushes polling/heartbeat/admin budgets; writes never drop below base.
func ApplyShedMode(mode ShedMode, base map[string]int) map[string]int {
	out := make(map[string]int, len(base))
	for k, v := range base {
		out[k] = v
	}
	if mode != ShedExam {
		return out
	}
	// Keys are the httpx tier names ("polling", "heartbeat", "authed-reads",
	// "writes"); unknown keys pass through untouched.
	if v, ok := out["polling"]; ok {
		out["polling"] = v / 4
	}
	if v, ok := out["heartbeat"]; ok {
		out["heartbeat"] = v / 4
	}
	if v, ok := out["authed-reads"]; ok {
		out["authed-reads"] = v / 2
	}
	return out
}

// PresenceMode selects the heartbeat write posture (plan D2): inline = the
// per-beat tx ship state (RecordHeartbeat: FOR UPDATE + INSERT + integrity
// RMW every beat); memory = PresenceMap touch with zero SQL steady-state +
// 60s batched flush (events multi-INSERT, integrity UPDATE only on status
// transitions). Unknown values fail closed at ValidateForRuntime.
type PresenceMode string

const (
	PresenceInline PresenceMode = "inline"
	PresenceMemory PresenceMode = "memory"
)

// parsePresenceMode normalizes PRESENCE_MODE: empty = inline (ship state),
// case-insensitive, trimmed; anything else preserved verbatim so
// ValidateForRuntime can reject it fail-closed.
func parsePresenceMode(raw string) PresenceMode {
	switch PresenceMode(strings.ToLower(strings.TrimSpace(raw))) {
	case "", PresenceInline:
		return PresenceInline
	case PresenceMemory:
		return PresenceMemory
	default:
		return PresenceMode(strings.TrimSpace(raw))
	}
}

// PresenceMemory reports the zero-SQL steady-state posture.
func (c Config) PresenceMemory() bool { return c.PresenceMode == PresenceMemory }

// In-memory admission caps (plan C2): total conns, per-user, per-schedule.
// Defaults keep today's per-user discipline (5) while raising the global
// ceilings for the single-deploy shape (30000/20000).
const (
	DefaultWSCapTotal    = 30000
	DefaultWSCapUser     = 5
	DefaultWSCapSchedule = 20000

	// DefaultAuthoringWSMaxFrameBytes bounds one inbound authoring frame.
	// Client frames are tiny (a subscribe with an optional cursor); 64 KiB is
	// generous headroom while still refusing a hostile payload.
	DefaultAuthoringWSMaxFrameBytes = 64 * 1024

	// DefaultAuthoringWSReplayBound caps rows streamed per subscribe. Kept in
	// lockstep with authoringrealtime.ReplayBound (asserted by a test) rather
	// than imported, so this package keeps its zero-internal-dependency rule.
	DefaultAuthoringWSReplayBound = 200
)

// wsCapFromEnv reads a cap env with default fallback: unset/unparseable/
// non-positive values clamp to the default (never unbounded, never deny-all).
func wsCapFromEnv(key string, def int) int {
	n := getenvInt(key, def)
	if n <= 0 {
		return def
	}
	return n
}

// OutboxClaimMode selects the claim SQL posture (plan B4.3): update = the
// single UPDATE ... ORDER BY ... LIMIT claim (ship state); skiplocked =
// SELECT ... FOR UPDATE SKIP LOCKED + UPDATE by id (less over-locking under
// multi-consumer claiming). Unknown values fail closed at ValidateForRuntime.
type OutboxClaimMode string

const (
	OutboxClaimUpdate     OutboxClaimMode = "update"
	OutboxClaimSkipLocked OutboxClaimMode = "skiplocked"
)

// parseOutboxClaimMode normalizes OUTBOX_CLAIM_MODE: empty = update (ship
// state), case-insensitive, trimmed; anything else is preserved verbatim
// so ValidateForRuntime can reject it fail-closed.
func parseOutboxClaimMode(raw string) OutboxClaimMode {
	switch OutboxClaimMode(strings.ToLower(strings.TrimSpace(raw))) {
	case "", OutboxClaimUpdate:
		return OutboxClaimUpdate
	case OutboxClaimSkipLocked:
		return OutboxClaimSkipLocked
	default:
		return OutboxClaimMode(strings.TrimSpace(raw))
	}
}

// RateLimitMode selects the distributed-verdict posture (plan A1).
// Dual keeps today's behavior (local prefilter + authoritative DB verdict);
// Local drops the per-request DB verdict (single-deploy: local IS global).
// Unknown values fail closed at ValidateForRuntime (never silently local).
type RateLimitMode string

const (
	RateLimitModeDual  RateLimitMode = "dual"
	RateLimitModeLocal RateLimitMode = "local"
)

// parseRateLimitMode normalizes RATE_LIMIT_MODE: empty = dual (ship state),
// case-insensitive, trimmed; anything else is preserved verbatim so
// ValidateForRuntime can reject it fail-closed.
func parseRateLimitMode(raw string) RateLimitMode {
	switch RateLimitMode(strings.ToLower(strings.TrimSpace(raw))) {
	case "", RateLimitModeDual:
		return RateLimitModeDual
	case RateLimitModeLocal:
		return RateLimitModeLocal
	default:
		return RateLimitMode(strings.TrimSpace(raw))
	}
}

// RateLimitLocalOnly reports whether the distributed DB verdict is off.
func (c Config) RateLimitLocalOnly() bool { return c.RateLimitMode == RateLimitModeLocal }

// Session cache bounds (plan A2). Defaults keep memory bounded (~45MB at
// ~300 bytes/entry x 150k) and collapse touch UPDATEs ~60-600x.
const (
	DefaultSessionCacheMax          = 150000
	DefaultSessionTouchCoalesceSecs = 300
)

func sessionCacheMaxFromEnv() int {
	n := getenvInt("SESSION_CACHE_MAX", DefaultSessionCacheMax)
	if n <= 0 {
		return DefaultSessionCacheMax
	}
	return n
}

func sessionTouchCoalesceFromEnv() int {
	n := getenvInt("SESSION_TOUCH_COALESCE_SECS", DefaultSessionTouchCoalesceSecs)
	if n <= 0 {
		return DefaultSessionTouchCoalesceSecs
	}
	return n
}

// SessionTouchCoalesce returns the effective coalesce window (always > 0).
func (c Config) SessionTouchCoalesce() int {
	if c.SessionTouchCoalesceSecs <= 0 {
		return DefaultSessionTouchCoalesceSecs
	}
	return c.SessionTouchCoalesceSecs
}

// BackgroundMode selects the background topology.
type BackgroundMode string

const (
	BackgroundContinuous     BackgroundMode = "continuous"
	BackgroundActivityDriven BackgroundMode = "activity_driven"
)

// Config is the validated process configuration. Loaded once, passed explicitly.
type Config struct {
	APIHost string
	APIPort int

	// TrustedProxyCIDRs controls which direct peers may supply a trusted
	// X-Forwarded-For chain. Empty environment uses loopback only.
	TrustedProxyCIDRs []string

	DatabaseURL       string
	DatabaseDirectURL string
	DBPoolMax         int
	DBPoolMaxIdle     int

	BackgroundMode BackgroundMode
	IdleGraceSecs  int

	RuntimeAutoAdvanceEnabled bool
	RuntimeAutoAdvanceTickMs  int

	// NOTE (round 74): the RESPONSE_DURABILITY_V2_ENABLED rollout flag was
	// removed — V2 is the product (plan 127/139); new attempts are always V2
	// (schedules.ProtocolVersionV2) and the V2 engine rejects protocol != 2.
	LiveModeEnabled           bool
	GradingProjectionEnabled  bool
	GradingSyncOnReadFallback bool
	StormAdmissionEnabled     bool
	MasterKeyEnabled          bool
	MasterKeyUsername         string
	MasterKeyPassword         string
	PrometheusEnabled         bool
	// MetricsPublic gates /metrics exposure (WS-10a): false (default) =
	// private, bearer-token required; true = public (no auth). Fail closed:
	// an empty MetricsToken with MetricsPublic=false denies every scrape.
	MetricsPublic bool
	// MetricsToken is the bearer secret for private /metrics scrapes.
	// Never logged; compared in constant time at the edge.
	MetricsToken           string
	FrontendDistDir        string
	ObjectStorageLocalRoot string

	AuthSecret             string
	SessionCookieName      string
	CsrfCookieName         string
	CookieSecure           bool
	SessionIdleStaffMins   int
	SessionIdleStudentMins int
	SessionAbsoluteHours   int
	AttemptTokenTTLMins    int

	MaxMutationsPerBatch  int
	MaxWritingAnswerChars int
	MaxTextAnswerChars    int
	AutoSubmitBatchSize   int
	HeartbeatMinWriteSecs int

	WorkerFallbackIntervalSecs    int
	WorkerMaintenanceIntervalSecs int
	LiveUpdatePollIntervalMs      int
	OutboxBatchSize               int
	OutboxMaxAttempts             int
	GradingProjectionIntervalSecs int

	// StudentWS selects the plan-C3 student-socket posture (default allow).
	StudentWS StudentWSMode

	// RollupEnabled gates the plan-D4 worker refresh (ROLLUP=on: GROUP BY
	// per live schedule every 5s into shared_cache_entries). Off (default)
	// = dashboard keeps the full roster path. Rollback = off.
	RollupEnabled bool

	// PresenceMode selects the plan-D2 heartbeat posture (default inline =
	// per-beat tx; memory = PresenceMap + 60s flush). Rollback = inline.
	PresenceMode PresenceMode

	// ShedMode selects the plan-E2 exam-window budget posture (default off).
	ShedMode ShedMode

	// WSAdmission selects the plan-C2 gate (default db = lease tx).
	WSAdmission WSAdmissionMode
	// WSCapTotal/User/Schedule bound the memory gate (defaults
	// 30000/5/20000; non-positive env values clamp to defaults).
	WSCapTotal    int
	WSCapUser     int
	WSCapSchedule int

	// Authoring realtime WS knobs (Phase 03, additive). ReplayBound caps
	// rows streamed per subscribe; MaxFrameBytes caps one inbound frame.
	// Non-positive env values clamp to the defaults (mirrors WSCap*).
	AuthoringWSReplayBound  int
	AuthoringWSMaxFrameSize int

	// RateLimitBucketCap is the deprecated compatibility alias for
	// RateLimitMaxKeys. It is never used as burst capacity.
	RateLimitBucketCap               int
	RateLimitMaxKeys                 int
	RateLimitBurst                   int
	RateLimitExportPerUser           int
	RateLimitExportPerUserWindowSecs int

	// Per-tier per-minute budgets (0 = derive from the legacy globals).
	// New tiers share one distributed-counter table via distinct route_key
	// values, so no schema migration is needed to add or retune a tier.
	RateLimitAuthCriticalPerMin int
	RateLimitAnonAuthPerMin     int
	RateLimitAuthedReadsPerMin  int
	RateLimitPollingPerMin      int
	RateLimitHeartbeatPerMin    int
	RateLimitWritesPerMin       int
	// Local-only loose backstop per IP across all traffic (abuse floor).
	// It never touches the distributed counters.
	RateLimitBackstopPerMin int

	// RateLimitMode selects the distributed-verdict posture (plan A1):
	// dual = local prefilter + DB verdict (ship state, behavior-preserving);
	// local = local-only, zero DB verdicts (single-deploy target: local IS
	// global when exactly one app process serves traffic).
	RateLimitMode RateLimitMode

	// SessionCacheEnabled gates the in-process session LRU (plan A2).
	// Off (default) = today's behavior: SELECT + UPDATE touch per lookup.
	// On = cache hit serves with zero SQL; touch UPDATEs coalesce to at
	// most one per SessionTouchCoalesceSecs per session via write-behind.
	SessionCacheEnabled bool
	// SessionCacheMax bounds LRU entries (default 150000, ~45MB).
	// Non-positive values fall back to the default (never unbounded).
	SessionCacheMax int
	// SessionTouchCoalesceSecs bounds touch UPDATEs per session
	// (default 300). Non-positive values fall back to the default
	// (never a zero-window hot UPDATE loop).
	SessionTouchCoalesceSecs int

	// AttemptVerify selects the attempt-bearer verification posture
	// (plan A3): strict = HMAC + expiry + attempt_sessions DB binding
	// (ship default, behavior-preserving); stateless = HMAC + expiry only
	// (zero SQL) on the WRITE fast-path edge verify ONLY. Reads
	// (v2 snapshot, runtime poll, delivery bootstrap) always take the
	// session-table touch via auth.VerifyAttemptRead in both modes, and
	// writes keep the in-tx session/lease fence — stateless never skips
	// the session-table touch on reads.
	AttemptVerify AttemptVerifyMode

	// RowFirstWrites gates the plan-B3 row-first write path. Off (default) =
	// today's mergeProjection (re-SELECT + rewrite full blobs per answer).
	// On = rows-only UPSERT per answer cell + narrow revision UPDATE; legacy
	// blob columns become read views via attempts.MaterializeBlobs (lazy on
	// read, worker flush, synchronous at seal). Rollback = off.
	RowFirstWrites bool

	// LiveBus selects the plan-C1 live path (default db = today's bus SQL +
	// forwarder; direct = Hub-only post-commit, zero live SQL on hot paths).
	LiveBus LiveBusMode
	// LiveBusSink selects the async debug sink (default off = no writes).
	LiveBusSink LiveBusSinkMode
	// AuthoringRealtimeEvents gates the Phase 02 SAT authoring realtime
	// event rows on the durable live-update bus (AUTHORING_REALTIME_EVENTS,
	// default off). Off = byte-identical legacy authoring behavior: no bus
	// INSERT and no extra read. Rollback = unset/off.
	AuthoringRealtimeEvents bool
	// AuthoringRealtimeDelivery gates the Phase 03 SAT authoring realtime
	// WebSocket delivery (AUTHORING_REALTIME_DELIVERY, default off). Off =
	// subscriptions are refused as subscription_forbidden; HTTP authoring is
	// completely unaffected (progressive degradation: the flag disables a
	// capability, it never degrades correctness). Rollback = unset/off.
	AuthoringRealtimeDelivery bool
	// AuthoringRealtimePresence gates the Phase 05 ephemeral presence channel
	// on the authoring socket (AUTHORING_REALTIME_PRESENCE, default off). It
	// is a NARROWING flag only: the capability is advertised as false unless
	// delivery is also on, because presence rides the delivery socket. Off =
	// the capabilities frame says presence:false and any client presence
	// frame is refused as an unsupported frame. Rollback = unset/off.
	AuthoringRealtimePresence bool
	// AuthoringRealtimeConflictCompare advertises whether clients may run the
	// Phase 05 field-level Compare/ConflictResolver affordance
	// (AUTHORING_REALTIME_CONFLICT_COMPARE, default off). The comparison is
	// computed entirely client-side from HTTP-fetched revisions; this flag only
	// lets the server withhold the affordance during rollout. Rollback =
	// unset/off.
	AuthoringRealtimeConflictCompare bool

	// AuthoringRealtimeCoediting is retained as a compatibility field for the
	// SAT prompt co-editing capability. The application posture is always on;
	// the old environment gate no longer controls it.
	AuthoringRealtimeCoediting bool
	// AuthoringCoeditServiceEnabled is retained for compatibility. The
	// Hocuspocus admission posture is always on in the application build.
	AuthoringCoeditServiceEnabled bool
	// AuthoringCoeditServiceURL is the private base URL of the singleton
	// Hocuspocus service (AUTHORING_COEDIT_SERVICE_URL).
	AuthoringCoeditServiceURL string
	// AuthoringCoeditTokenSecret signs short-lived browser co-edit tokens
	// (AUTHORING_COEDIT_TOKEN_SECRET). It is deliberately NOT the general
	// application authentication secret. Minimum 32 bytes.
	AuthoringCoeditTokenSecret string
	// AuthoringCoeditServiceSecret signs private Go <-> Hocuspocus calls
	// (AUTHORING_COEDIT_SERVICE_SECRET). Minimum 32 bytes.
	AuthoringCoeditServiceSecret string
	// AuthoringCoeditPublicURL is the browser-facing co-edit WebSocket origin
	// (AUTHORING_COEDIT_PUBLIC_URL). In the embedded topology it points to the
	// Go reverse-proxy route, while AUTHORING_COEDIT_SERVICE_URL remains the
	// loopback-only control URL.
	AuthoringCoeditPublicURL string
	// AuthoringCoeditProxyEnabled exposes the embedded Hocuspocus process through
	// the Go API's /authoring-coedit WebSocket route.
	AuthoringCoeditProxyEnabled bool
	// AuthoringCoeditPublicWSScheme is the scheme the browser should use for
	// the co-edit socket (ws or wss). Empty derives it from the request.
	AuthoringCoeditPublicWSScheme string

	// EntryGateEnabled gates the plan-D3 per-schedule check-in bucket. Off
	// (default) = today's shape (only the email+IP limiter). On = in-memory
	// token bucket per schedule (ENTRY_PER_SEC_PER_SCHEDULE sustained,
	// ENTRY_BURST absorbency); over-limit check-ins get 429 with
	// {retryAfterSeconds} + Retry-After instead of a DB conflict storm.
	// Rollback = off.
	EntryGateEnabled bool
	// EntryPerSec/EntryBurst tune the D3 bucket (defaults 500/2000).
	// Non-positive values clamp to defaults (never unbounded/deny-all).
	EntryPerSec float64
	EntryBurst  float64

	// VersionCacheEnabled gates the plan-D1 immutable version cache. Off
	// (default) = today's N+1 LoadSections per bootstrap. On = published
	// trees served from the shared LRU (revision-probed, singleflight on
	// miss). Rollback = off.
	VersionCacheEnabled bool

	// OutboxExecOnly gates the plan-B4.1 executable-only outbox. Off (default)
	// = today's behavior: wakeup families (attempt_terminalized,
	// runtime_changed, roster_changed) enqueue for worker relay. On = wakeup
	// enqueueing stops (live publish moves to the in-process Hub in Phase C);
	// only auto_submit_schedule_attempts_requested (+ future executable
	// families) enqueue. Rollback = off.
	OutboxExecOnly bool
	// DBPoolMaxAPI/DBPoolMaxWorker split the pool by role from one DSN
	// (plan B4.2, e.g. 40/10). Non-positive values fall back to DBPoolMax.
	DBPoolMaxAPI    int
	DBPoolMaxWorker int
	// WorkerClaimPartitions selects partitioned claiming consumers
	// (plan B4.3, default 1 = today's single consumer). Values < 1 fall
	// back to 1.
	WorkerClaimPartitions int
	// OutboxClaimMode selects the claim SQL posture (default update).
	OutboxClaimMode OutboxClaimMode

	// RuntimeSnapshotEnabled gates the plan-B2 lock-free runtime pre-gate.
	// Off (default) = today's behavior: every V2 write locks
	// exam_session_runtimes + section rows FOR UPDATE in-tx. On = the
	// v2Locker pre-checks writability against a ~1s-TTL committed-read
	// snapshot before the write tx and only takes the locks on mismatch
	// (one synchronous refresh + retry, then today's 422/409 codes).
	// Seal, runtime commands, and reconcile keep FOR UPDATE locking.
	RuntimeSnapshotEnabled bool

	StorageWarningBytes  int64
	StorageCriticalBytes int64

	// HTTPWriteTimeoutSecs tunes the plan-E conn-layer lever (round 137):
	// saturated entry handlers ran up to ~38s in the 5k wave while the
	// 30s WriteTimeout severed slow-but-healthy admissions (EOF class).
	// Default 30 = today's behavior (behavior-preserving ship default);
	// non-positive values clamp to 30 (never unbounded, never deny-all).
	// Rollback = unset.
	HTTPWriteTimeoutSecs int

	ResourceProfile string
	Environment     string // development | preview | staging | production
}

func getenv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func productionLike(environment string) bool {
	switch strings.ToLower(strings.TrimSpace(environment)) {
	case "production", "prod", "staging", "stage", "preview":
		return true
	default:
		return false
	}
}

func trustedProxyCIDRsFromEnv() []string {
	raw := strings.TrimSpace(os.Getenv("TRUSTED_PROXIES"))
	if raw == "" {
		return append([]string(nil), defaultTrustedProxyCIDRs...)
	}
	parts := strings.Split(raw, ",")
	for i := range parts {
		parts[i] = strings.TrimSpace(parts[i])
	}
	return parts
}

// coeditSecret keeps local development zero-config while preserving the
// dedicated-secret requirement anywhere that could be a shared deployment.
func coeditSecret(key, fallback, environment string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	if productionLike(environment) {
		return ""
	}
	return fallback
}

// resourceDefault mirrors Rust's base/low-resource profile behavior while
// keeping explicit environment values authoritative at the call site.
func resourceDefault(profile string, normal, low int) int {
	if strings.EqualFold(strings.TrimSpace(profile), "low") {
		return low
	}
	return normal
}

// deriveTierLimit reads an explicit per-tier budget, falling back to the
// provided default when the env var is unset or unparsable. Per-tier values
// are authoritative; RATE_LIMIT_GLOBAL is not consulted.
func deriveTierLimit(key string, def int) int {
	v := getenvInt(key, -1)
	if v >= 0 {
		return v
	}
	return def
}

func warnLegacyRateLimitGlobalEnv() {
	if strings.TrimSpace(os.Getenv("RATE_LIMIT_GLOBAL")) != "" {
		log.Printf("config: RATE_LIMIT_GLOBAL is deprecated and ignored; use per-tier RATE_LIMIT_*_PER_MIN values")
	}
}

func rateLimitMaxKeysFromEnv() (maxKeys, legacyCap int) {
	legacyCap = getenvInt("RATE_LIMIT_BUCKET_CAP", 10000)
	if strings.TrimSpace(os.Getenv("RATE_LIMIT_BUCKET_CAP")) != "" {
		log.Printf("config: RATE_LIMIT_BUCKET_CAP is deprecated; use RATE_LIMIT_MAX_KEYS")
	}
	if strings.TrimSpace(os.Getenv("RATE_LIMIT_MAX_KEYS")) != "" {
		return getenvInt("RATE_LIMIT_MAX_KEYS", 10000), legacyCap
	}
	return legacyCap, legacyCap
}

// poolMaxOr falls back to the shared pool max when a role split is unset
// or non-positive (plan B4.2: unset split = today's single pool sizing).
func poolMaxOr(shared, role int) int {
	if role <= 0 {
		return shared
	}
	return role
}

// claimPartitionsFromEnv reads WORKER_CLAIM_PARTITIONS (default 1 = today's
// single consumer); values < 1 fall back to 1 (never zero consumers).
func claimPartitionsFromEnv() int {
	n := getenvInt("WORKER_CLAIM_PARTITIONS", 1)
	if n < 1 {
		return 1
	}
	return n
}

// entryRateFromEnv reads a D3 bucket rate; empty/unparseable/non-positive
// values clamp to the plan default (never unbounded, never deny-all).
// Unparseable values log loudly (same silent-coerce ratchet as getenvInt).
func entryRateFromEnv(key string, def float64) float64 {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return def
	}
	n, err := strconv.ParseFloat(v, 64)
	if err != nil || n <= 0 {
		log.Printf("config: %s=%q invalid (must be a positive number); using default %v", key, v, def)
		return def
	}
	return n
}

func getenvInt(key string, def int) int {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		// Loud-not-silent: a typo'd budget must self-report in the deploy
		// log instead of booting with a wrong default invisibly.
		log.Printf("config: %s=%q invalid (must be a base-10 integer); using default %d", key, v, def)
		return def
	}
	return n
}

func getenvInt64(key string, def int64) int64 {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return def
	}
	n, err := strconv.ParseInt(v, 10, 64)
	if err != nil {
		log.Printf("config: %s=%q invalid (must be a base-10 integer); using default %d", key, v, def)
		return def
	}
	return n
}

func getenvBool(key string, def bool) bool {
	v := strings.ToLower(strings.TrimSpace(os.Getenv(key)))
	switch v {
	case "", "unset":
		return def
	case "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	default:
		log.Printf("config: %s=%q invalid (must be a boolean); using default %v", key, os.Getenv(key), def)
		return def
	}
}

// Load reads the environment with production defaults.
func Load() Config {
	profile := strings.ToLower(strings.TrimSpace(os.Getenv("RESOURCE_PROFILE")))
	poolMax := getenvInt("DB_POOL_MAX_CONNECTIONS", 20)
	if v := strings.TrimSpace(os.Getenv("DB_POOL_MAX_CONNECTIONS")); v == "" && profile == "low" {
		poolMax = 3
	}
	mode := BackgroundMode(strings.ToLower(strings.TrimSpace(os.Getenv("BACKGROUND_RUNTIME_MODE"))))
	if mode == "" {
		mode = BackgroundContinuous
	}
	environment := getenv("APP_ENV", getenv("ENVIRONMENT", "development"))
	rateLimitMaxKeys, legacyBucketCap := rateLimitMaxKeysFromEnv()
	warnLegacyRateLimitGlobalEnv()
	return Config{
		APIHost: getenv("API_HOST", "0.0.0.0"),
		// Platforms such as Railway inject PORT at runtime. Keep API_PORT as
		// the local/development fallback, but never let it override the
		// platform-assigned listener port.
		APIPort:           getenvInt("PORT", getenvInt("API_PORT", 4000)),
		TrustedProxyCIDRs: trustedProxyCIDRsFromEnv(),

		DatabaseURL:       os.Getenv("DATABASE_URL"),
		DatabaseDirectURL: os.Getenv("DATABASE_DIRECT_URL"),
		DBPoolMax:         poolMax,
		DBPoolMaxIdle:     getenvInt("DB_POOL_MAX_IDLE", 5),

		BackgroundMode: mode,
		IdleGraceSecs:  getenvInt("IDLE_GRACE_SECS", 60),

		RuntimeAutoAdvanceEnabled: getenvBool("RUNTIME_AUTO_ADVANCE_ENABLED", true),
		RuntimeAutoAdvanceTickMs:  getenvInt("RUNTIME_AUTO_ADVANCE_TICK_MS", 1000),

		LiveModeEnabled:           getenvBool("LIVE_MODE_ENABLED", true),
		GradingProjectionEnabled:  getenvBool("GRADING_PROJECTION_ENABLED", true),
		GradingSyncOnReadFallback: getenvBool("GRADING_SYNC_ON_READ_FALLBACK", false),
		StormAdmissionEnabled:     getenvBool("STORM_ADMISSION_ENABLED", false),
		// Master-key emergency admin login (mirrors Rust AppConfig
		// master_key_*: username defaults to "master" like Rust; blank
		// username/password env values fall back to the defaults so an
		// explicitly empty password never silently locks the key out).
		MasterKeyEnabled:  getenvBool("MASTER_KEY_ENABLED", false),
		MasterKeyUsername: getenv("MASTER_KEY_USERNAME", "master"),
		MasterKeyPassword: os.Getenv("MASTER_KEY_PASSWORD"),
		PrometheusEnabled: getenvBool("PROMETHEUS_ENABLED", true),
		// NOTE (WS-10a): the OTEL_EXPORTER_OTLP_ENDPOINT surface was dead —
		// no OTel SDK is vendored (trace is X-Trace-Id echo only), so the
		// endpoint string was parsed and never consumed. Removed; use the
		// X-Trace-Id echo + access-log trace_id field for correlation.
		MetricsPublic:          getenvBool("METRICS_PUBLIC", false),
		MetricsToken:           os.Getenv("METRICS_TOKEN"),
		FrontendDistDir:        os.Getenv("FRONTEND_DIST_DIR"),
		ObjectStorageLocalRoot: getenv("OBJECT_STORAGE_LOCAL_ROOT", ".data/object-store"),

		AuthSecret:             os.Getenv("AUTH_SECRET"),
		SessionCookieName:      getenv("SESSION_COOKIE_NAME", "__Host-session"),
		CsrfCookieName:         getenv("CSRF_COOKIE_NAME", "__Host-csrf"),
		CookieSecure:           getenvBool("COOKIE_SECURE", defaultCookieSecure(environment)),
		SessionIdleStaffMins:   getenvInt("SESSION_IDLE_STAFF_MINS", 30),
		SessionIdleStudentMins: getenvInt("SESSION_IDLE_STUDENT_MINS", 60),
		SessionAbsoluteHours:   getenvInt("SESSION_ABSOLUTE_HOURS", 12),
		AttemptTokenTTLMins:    getenvInt("ATTEMPT_TOKEN_TTL_MINUTES", 15),

		MaxMutationsPerBatch:  getenvInt("MAX_MUTATIONS_PER_BATCH", 200),
		MaxWritingAnswerChars: getenvInt("MAX_WRITING_ANSWER_CHARS", 50000),
		MaxTextAnswerChars:    getenvInt("MAX_TEXT_ANSWER_CHARS", 512),
		AutoSubmitBatchSize:   getenvInt("AUTO_SUBMIT_BATCH_SIZE", 50),
		HeartbeatMinWriteSecs: getenvInt("HEARTBEAT_PRESENCE_MIN_WRITE_INTERVAL_SECS", 5),

		WorkerFallbackIntervalSecs:       getenvInt("WORKER_FALLBACK_INTERVAL_SECS", resourceDefault(profile, 10, 60)),
		WorkerMaintenanceIntervalSecs:    getenvInt("WORKER_MAINTENANCE_INTERVAL_SECS", 300),
		LiveUpdatePollIntervalMs:         getenvInt("LIVE_UPDATE_POLL_INTERVAL_MS", resourceDefault(profile, 250, 500)),
		OutboxBatchSize:                  getenvInt("OUTBOX_BATCH_SIZE", 100),
		LiveBus:                          parseLiveBusMode(os.Getenv("LIVE_BUS")),
		StudentWS:                        parseStudentWSMode(os.Getenv("STUDENT_WS")),
		ShedMode:                         parseShedMode(os.Getenv("SHED_MODE")),
		WSAdmission:                      parseWSAdmissionMode(os.Getenv("WS_ADMISSION")),
		WSCapTotal:                       wsCapFromEnv("WS_CAP_TOTAL", DefaultWSCapTotal),
		AuthoringWSReplayBound:           wsCapFromEnv("AUTHORING_WS_REPLAY_BOUND", DefaultAuthoringWSReplayBound),
		AuthoringWSMaxFrameSize:          wsCapFromEnv("AUTHORING_WS_MAX_FRAME_BYTES", DefaultAuthoringWSMaxFrameBytes),
		WSCapUser:                        wsCapFromEnv("WS_CAP_USER", DefaultWSCapUser),
		WSCapSchedule:                    wsCapFromEnv("WS_CAP_SCHEDULE", DefaultWSCapSchedule),
		LiveBusSink:                      parseLiveBusSink(os.Getenv("LIVE_BUS_SINK")),
		AuthoringRealtimeEvents:          getenvBool("AUTHORING_REALTIME_EVENTS", false),
		AuthoringRealtimeDelivery:        getenvBool("AUTHORING_REALTIME_DELIVERY", false),
		AuthoringRealtimePresence:        getenvBool("AUTHORING_REALTIME_PRESENCE", false),
		AuthoringRealtimeConflictCompare: getenvBool("AUTHORING_REALTIME_CONFLICT_COMPARE", false),
		// Prompt co-editing is always on. The old rollout variables remain
		// accepted by the process environment for mixed-version deployments but
		// no longer decide whether the capability is advertised.
		AuthoringRealtimeCoediting:    true,
		AuthoringCoeditServiceEnabled: true,
		AuthoringCoeditServiceURL:     getenv("AUTHORING_COEDIT_SERVICE_URL", defaultCoeditServiceURL),
		AuthoringCoeditTokenSecret:    coeditSecret("AUTHORING_COEDIT_TOKEN_SECRET", defaultCoeditTokenSecret, environment),
		AuthoringCoeditServiceSecret:  coeditSecret("AUTHORING_COEDIT_SERVICE_SECRET", defaultCoeditServiceSecret, environment),
		AuthoringCoeditPublicURL:      strings.TrimRight(strings.TrimSpace(os.Getenv("AUTHORING_COEDIT_PUBLIC_URL")), "/"),
		AuthoringCoeditProxyEnabled:   getenvBool("AUTHORING_COEDIT_PROXY_ENABLED", false),
		AuthoringCoeditPublicWSScheme: strings.ToLower(getenv("AUTHORING_COEDIT_PUBLIC_WS_SCHEME", "ws")),
		RollupEnabled:                 getenvBool("ROLLUP", false),
		PresenceMode:                  parsePresenceMode(os.Getenv("PRESENCE_MODE")),
		OutboxExecOnly:                getenvBool("OUTBOX_EXEC_ONLY", false),
		DBPoolMaxAPI:                  poolMaxOr(poolMax, getenvInt("DB_POOL_MAX_API", 0)),
		DBPoolMaxWorker:               poolMaxOr(poolMax, getenvInt("DB_POOL_MAX_WORKER", 0)),
		WorkerClaimPartitions:         claimPartitionsFromEnv(),
		OutboxClaimMode:               parseOutboxClaimMode(os.Getenv("OUTBOX_CLAIM_MODE")),
		OutboxMaxAttempts:             getenvInt("OUTBOX_MAX_ATTEMPTS", 10),
		GradingProjectionIntervalSecs: getenvInt("GRADING_PROJECTION_INTERVAL_SECS", 5),

		RateLimitBucketCap:               legacyBucketCap,
		RateLimitMaxKeys:                 rateLimitMaxKeys,
		RateLimitBurst:                   getenvInt("RATE_LIMIT_BURST", 0),
		RateLimitExportPerUser:           getenvInt("RATE_LIMIT_EXPORT_PER_USER", 3),
		RateLimitExportPerUserWindowSecs: getenvInt("RATE_LIMIT_EXPORT_PER_USER_WINDOW_SECS", 300),

		RateLimitAuthCriticalPerMin: deriveTierLimit("RATE_LIMIT_AUTH_CRITICAL_PER_MIN", 120),
		RateLimitAnonAuthPerMin:     deriveTierLimit("RATE_LIMIT_ANON_AUTH_PER_MIN", 30),
		RateLimitAuthedReadsPerMin:  deriveTierLimit("RATE_LIMIT_AUTHED_READS_PER_MIN", 300),
		RateLimitPollingPerMin:      deriveTierLimit("RATE_LIMIT_POLLING_PER_MIN", 240),
		RateLimitHeartbeatPerMin:    deriveTierLimit("RATE_LIMIT_HEARTBEAT_PER_MIN", 120),
		RateLimitWritesPerMin:       deriveTierLimit("RATE_LIMIT_WRITES_PER_MIN", 120),
		RateLimitBackstopPerMin:     deriveTierLimit("RATE_LIMIT_BACKSTOP_PER_MIN", 3000),

		RateLimitMode: parseRateLimitMode(os.Getenv("RATE_LIMIT_MODE")),

		AttemptVerify: parseAttemptVerify(os.Getenv("ATTEMPT_VERIFY")),

		RowFirstWrites:      getenvBool("ROW_FIRST_WRITES", false),
		EntryGateEnabled:    getenvBool("ENTRY_GATE", false),
		EntryPerSec:         entryRateFromEnv("ENTRY_PER_SEC_PER_SCHEDULE", 500),
		EntryBurst:          entryRateFromEnv("ENTRY_BURST", 2000),
		VersionCacheEnabled: getenvBool("VERSION_CACHE", false),

		RuntimeSnapshotEnabled: getenvBool("RUNTIME_SNAPSHOT", false),

		SessionCacheEnabled:      getenvBool("SESSION_CACHE", false),
		SessionCacheMax:          sessionCacheMaxFromEnv(),
		SessionTouchCoalesceSecs: sessionTouchCoalesceFromEnv(),

		StorageWarningBytes:  getenvInt64("STORAGE_WARNING_BYTES", 10<<30),
		StorageCriticalBytes: getenvInt64("STORAGE_CRITICAL_BYTES", 50<<30),

		HTTPWriteTimeoutSecs: httpWriteTimeoutSecsFromEnv(),

		ResourceProfile: profile,
		Environment:     environment,
	}
}

// httpWriteTimeoutSecsFromEnv reads HTTP_WRITE_TIMEOUT_SECS (default 30 =
// today's WriteTimeout). Non-positive values clamp to 30: the lever only
// ever lengthens the bound, never disables it.
func httpWriteTimeoutSecsFromEnv() int {
	n := getenvInt("HTTP_WRITE_TIMEOUT_SECS", 30)
	if n <= 0 {
		return 30
	}
	return n
}

// offcut: __Host- cookies require Secure; without it browsers drop the
// cookie on http, so the prefix is stripped for insecure issuers.
func effectiveCookieName(configured string, secure bool) string {
	if secure {
		return configured
	}
	return strings.TrimPrefix(configured, "__Host-")
}

// EffectiveSessionCookieName is the cookie name browsers will actually store.
func (c Config) EffectiveSessionCookieName() string {
	return effectiveCookieName(c.SessionCookieName, c.CookieSecure)
}

// EffectiveCsrfCookieName is the cookie name browsers will actually store.
func (c Config) EffectiveCsrfCookieName() string {
	return effectiveCookieName(c.CsrfCookieName, c.CookieSecure)
}

func defaultCookieSecure(environment string) bool {
	switch strings.ToLower(strings.TrimSpace(environment)) {
	case "production", "prod":
		return true
	default:
		return false
	}
}

// ValidateForRuntime rejects unsafe production configuration.
func (c Config) ValidateForRuntime() error {
	if c.DatabaseURL == "" {
		return fmt.Errorf("DATABASE_URL is required")
	}
	// Master key is an emergency credential: enabling it without a password
	// is a misconfiguration in every environment (fail closed), matching the
	// Rust posture where an empty password never authenticates.
	if c.MasterKeyEnabled && strings.TrimSpace(c.MasterKeyPassword) == "" {
		return fmt.Errorf("MASTER_KEY_PASSWORD must be set when MASTER_KEY_ENABLED is true")
	}
	if c.AuthoringCoeditProxyEnabled {
		publicURL := strings.TrimSpace(c.AuthoringCoeditPublicURL)
		parsed, err := url.Parse(publicURL)
		if publicURL == "" || err != nil || parsed.Host == "" {
			return fmt.Errorf("AUTHORING_COEDIT_PUBLIC_URL must be an absolute URL when AUTHORING_COEDIT_PROXY_ENABLED is true")
		}
		switch strings.ToLower(parsed.Scheme) {
		case "http", "https", "ws", "wss":
		default:
			return fmt.Errorf("AUTHORING_COEDIT_PUBLIC_URL must use http, https, ws, or wss")
		}
	}
	// AUTH_SECRET signs attempt tokens + session-adjacent HMACs: require a
	// non-default secret with minimum entropy in every environment (fail
	// closed). Tests that never sign tokens must set a throwaway value.
	if strings.TrimSpace(c.AuthSecret) == "" || c.AuthSecret == "dev-secret-change-me" || len(c.AuthSecret) < 32 {
		return fmt.Errorf("AUTH_SECRET must be set to a strong value of at least 32 characters")
	}
	if c.BackgroundMode != BackgroundContinuous && c.BackgroundMode != BackgroundActivityDriven {
		return fmt.Errorf("invalid BACKGROUND_RUNTIME_MODE %q", c.BackgroundMode)
	}
	if c.APIPort <= 0 || c.APIPort > 65535 {
		return fmt.Errorf("invalid API port %d", c.APIPort)
	}
	if c.DBPoolMax <= 0 {
		return fmt.Errorf("DB_POOL_MAX_CONNECTIONS must be positive")
	}
	for _, cidr := range c.TrustedProxyCIDRs {
		cidr = strings.TrimSpace(cidr)
		if cidr == "" {
			continue
		}
		if _, _, err := net.ParseCIDR(cidr); err != nil {
			return fmt.Errorf("invalid TRUSTED_PROXIES CIDR %q: %w", cidr, err)
		}
	}
	if c.RateLimitMaxKeys <= 0 {
		return fmt.Errorf("RATE_LIMIT_MAX_KEYS must be positive")
	}
	if c.RateLimitBurst < 0 {
		return fmt.Errorf("RATE_LIMIT_BURST must be non-negative")
	}
	for name, value := range map[string]int{
		"RATE_LIMIT_AUTH_CRITICAL_PER_MIN": c.RateLimitAuthCriticalPerMin,
		"RATE_LIMIT_ANON_AUTH_PER_MIN":     c.RateLimitAnonAuthPerMin,
		"RATE_LIMIT_AUTHED_READS_PER_MIN":  c.RateLimitAuthedReadsPerMin,
		"RATE_LIMIT_POLLING_PER_MIN":       c.RateLimitPollingPerMin,
		"RATE_LIMIT_HEARTBEAT_PER_MIN":     c.RateLimitHeartbeatPerMin,
		"RATE_LIMIT_WRITES_PER_MIN":        c.RateLimitWritesPerMin,
		"RATE_LIMIT_BACKSTOP_PER_MIN":      c.RateLimitBackstopPerMin,
	} {
		if value <= 0 {
			return fmt.Errorf("%s must be positive", name)
		}
	}
	if c.RateLimitExportPerUser <= 0 || c.RateLimitExportPerUserWindowSecs <= 0 {
		return fmt.Errorf("RATE_LIMIT_EXPORT_PER_USER and RATE_LIMIT_EXPORT_PER_USER_WINDOW_SECS must be positive")
	}
	// Unknown rate-limit modes fail closed: dual|local are the only
	// deployable postures (an unknown value must never silently degrade
	// to local and drop the distributed verdict).
	if c.RateLimitMode != RateLimitModeDual && c.RateLimitMode != RateLimitModeLocal {
		return fmt.Errorf("invalid RATE_LIMIT_MODE %q (want dual|local)", string(c.RateLimitMode))
	}
	// Unknown attempt-verify modes fail closed: strict|stateless are the
	// only deployable postures (an unknown value must never silently drop
	// the attempt_sessions DB binding).
	if c.AttemptVerify != AttemptVerifyStrict && c.AttemptVerify != AttemptVerifyStateless {
		return fmt.Errorf("invalid ATTEMPT_VERIFY %q (want strict|stateless)", string(c.AttemptVerify))
	}
	// Unknown live-bus modes fail closed: db|direct only (an unknown value
	// must never silently drop the durable bus relay).
	if c.LiveBus != LiveBusDB && c.LiveBus != LiveBusDirect {
		return fmt.Errorf("invalid LIVE_BUS %q (want db|direct)", string(c.LiveBus))
	}
	// Unknown sink modes fail closed: off|sample only.
	if c.LiveBusSink != LiveBusSinkOff && c.LiveBusSink != LiveBusSinkSample {
		return fmt.Errorf("invalid LIVE_BUS_SINK %q (want off|sample)", string(c.LiveBusSink))
	}
	// Unknown student-WS modes fail closed: allow|gone only (an unknown value
	// must never silently retire student sockets).
	if c.StudentWS != StudentWSAllow && c.StudentWS != StudentWSGone {
		return fmt.Errorf("invalid STUDENT_WS %q (want allow|gone)", string(c.StudentWS))
	}
	// Unknown shed modes fail closed: off|exam only (an unknown value must
	// never silently crush admin budgets or shed submits).
	if c.ShedMode != ShedOff && c.ShedMode != ShedExam {
		return fmt.Errorf("invalid SHED_MODE %q (want off|exam)", string(c.ShedMode))
	}
	// Unknown admission modes fail closed: db|memory only (an unknown value
	// must never silently drop the lease gate and go permissive).
	if c.WSAdmission != WSAdmissionDB && c.WSAdmission != WSAdmissionMemory {
		return fmt.Errorf("invalid WS_ADMISSION %q (want db|memory)", string(c.WSAdmission))
	}
	// Unknown presence modes fail closed: inline|memory only (an unknown
	// value must never silently reroute beats away from the durable tx).
	if c.PresenceMode != PresenceInline && c.PresenceMode != PresenceMemory {
		return fmt.Errorf("invalid PRESENCE_MODE %q (want inline|memory)", string(c.PresenceMode))
	}
	if c.WSCapTotal <= 0 || c.WSCapUser <= 0 || c.WSCapSchedule <= 0 {
		return fmt.Errorf("WS caps must be positive (total=%d user=%d schedule=%d)", c.WSCapTotal, c.WSCapUser, c.WSCapSchedule)
	}
	// Direct mode has no forwarder and no peers: wakeup rows claimed by the
	// worker could never reach the API hub, so direct REQUIRES exec-only
	// (no wakeup rows exist). Fail closed rather than silently dropping live
	// frames in a mixed deploy.
	if c.LiveBus == LiveBusDirect && !c.OutboxExecOnly {
		return fmt.Errorf("LIVE_BUS=direct requires OUTBOX_EXEC_ONLY=on (wakeup rows have no relay without the forwarder)")
	}
	// Unknown claim modes fail closed: update|skiplocked only (an unknown
	// value must never silently change claim locking semantics).
	if c.OutboxClaimMode != OutboxClaimUpdate && c.OutboxClaimMode != OutboxClaimSkipLocked {
		return fmt.Errorf("invalid OUTBOX_CLAIM_MODE %q (want update|skiplocked)", string(c.OutboxClaimMode))
	}
	if c.DBPoolMaxAPI <= 0 || c.DBPoolMaxWorker <= 0 || c.WorkerClaimPartitions <= 0 {
		return fmt.Errorf("pool/partition tunables must be positive (api=%d worker=%d partitions=%d)", c.DBPoolMaxAPI, c.DBPoolMaxWorker, c.WorkerClaimPartitions)
	}
	return nil
}

// Addr returns host:port.
func (c Config) Addr() string { return fmt.Sprintf("%s:%d", c.APIHost, c.APIPort) }
