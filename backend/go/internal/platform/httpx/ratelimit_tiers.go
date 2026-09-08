package httpx

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"log"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"example.com/ielts-proctoring/internal/platform/telemetry"
)

// Rate-limit tier names. Each tier is an independent quota namespace backed
// by its own distributed-counter route_key, so a burst in one tier can never
// starve another (previously every route shared route_key "global").
const (
	TierAuthCritical = "auth-critical"
	TierAnonAuth     = "anon-auth"
	TierAuthedReads  = "authed-reads"
	TierPolling      = "polling"
	TierHeartbeat    = "heartbeat"
	TierWrites       = "writes"
	// TierBackstop is the loose local-only abuse floor applied globally.
	// It has no distributed counter and never appears as a DB route_key.
	TierBackstop = "backstop"
)

// TierBudget is the authoritative per-minute budget for one tier.
type TierBudget struct {
	PerMin int
	Window time.Duration
	Burst  int
}

// PrefilterMultiple scales the in-memory flood prefilter relative to the
// authoritative DB budget. The local bucket sheds floods without a DB
// roundtrip; the DB verdict is the single authority that can add denials.
const PrefilterMultiple = 2

// DBChecker is the distributed verdict func (DBRateLimiter.Check shape).
type DBChecker func(ctx context.Context, key string) (allowed bool, retryAfter time.Duration, err error)

// SessionLookup resolves the authenticated user for keying. It is injected
// (rather than importing the api package, which would be an import cycle)
// by BuildRouter from SessionOf.
type SessionLookup func(r *http.Request) (userID string, ok bool)

// UserOrIPKey keys authenticated traffic by user and anonymous traffic by IP.
// Anonymous requests can never mint a user key: the class derives strictly
// from verified session material supplied by the lookup.
func UserOrIPKey(lookup SessionLookup) KeyFunc {
	return func(r *http.Request) string {
		if lookup != nil {
			if userID, ok := lookup(r); ok && strings.TrimSpace(userID) != "" {
				return "user:" + strings.TrimSpace(userID)
			}
		}
		return ClientIPKey(r)
	}
}

// AttemptOrUserOrIPKey keys student/attempt-bearer traffic by a truncated
// hash of the bearer, falling back to user then IP. The raw bearer never
// appears in the bucket key (and therefore never in counters or logs).
func AttemptOrUserOrIPKey(lookup SessionLookup) KeyFunc {
	return func(r *http.Request) string {
		if lookup != nil {
			if userID, ok := lookup(r); ok && strings.TrimSpace(userID) != "" {
				return "attempt-user:" + strings.TrimSpace(userID)
			}
		}
		if h := bearerHash(r); h != "" {
			return "attempt:" + h
		}
		return ClientIPKey(r)
	}
}

func bearerHash(r *http.Request) string {
	auth := r.Header.Get("Authorization")
	if auth == "" {
		return ""
	}
	parts := strings.SplitN(auth, " ", 2)
	if len(parts) != 2 || !strings.EqualFold(strings.TrimSpace(parts[0]), "bearer") {
		return ""
	}
	token := strings.TrimSpace(parts[1])
	if token == "" {
		return ""
	}
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])[:16]
}

// TierSet is a named collection of per-tier limiters sharing one BucketStore
// cap namespace but independent token buckets per (tier, key). Each request
// passing through a tier middleware produces at most one DB verdict (zero
// in local-only mode, exactly one in dual mode when a checker is wired).
type TierSet struct {
	budgets map[string]TierBudget
	local   *BucketStore
	dbs     map[string]DBChecker
	// localOnly drops the distributed verdict (plan A1 single-deploy:
	// local IS global when exactly one app process serves traffic).
	// Default false = dual (behavior-preserving). Guarded by mutex so
	// tests and future admin endpoints can flip without a restart.
	mu        sync.RWMutex
	localOnly bool
}

// NewTierSet builds a tier set. A nil db map entry means local-only (used
// for the loose global backstop, which never touches distributed counters).
func NewTierSet(budgets map[string]TierBudget, dbs map[string]DBChecker, storeCap int) *TierSet {
	if storeCap <= 0 {
		storeCap = 10000
	}
	return &TierSet{
		budgets: budgets,
		local:   NewBucketStore(storeCap),
		dbs:     dbs,
	}
}

// Middleware enforces one tier with the given key func. An empty key bypasses
// limiting (used for health-probe exemption).
func (t *TierSet) Middleware(tier string, keyFn KeyFunc) func(http.Handler) http.Handler {
	budget := t.budgets[tier]
	if budget.PerMin <= 0 {
		budget.PerMin = 1
	}
	if budget.Window <= 0 {
		budget.Window = time.Minute
	}
	localCfg := RateLimitConfig{
		MaxRequests: budget.PerMin * PrefilterMultiple,
		Window:      budget.Window,
		Burst:       budget.Burst * PrefilterMultiple,
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			key := ""
			if keyFn != nil {
				key = keyFn(r)
			}
			if key == "" {
				next.ServeHTTP(w, r)
				return
			}
			namespaced := tier + "|" + key
			if res := t.local.Allow(localCfg, namespaced); !res.Allowed {
				denyTierRateLimit(w, r, tier, keyClassOf(key), res.RetryAfter)
				return
			}
			// Per-request read (one RLock): SetLocalOnly flips apply to
			// already-mounted middleware without a restart.
			t.mu.RLock()
				localOnly := t.localOnly
				t.mu.RUnlock()
			dbCheck := t.dbs[tier]
			if localOnly {
				dbCheck = nil
			}
			if dbCheck != nil {
				allowed, retryAfter, err := dbCheck(r.Context(), namespaced)
				if err != nil {
					// Fail-safe (existing invariant): a DB outage must not
					// open the gate nor fail the request — keep the
					// local prefilter verdict (allowed here).
					_ = err
				} else if !allowed {
					denyTierRateLimit(w, r, tier, keyClassOf(key), retryAfter)
					return
				}
			}
			next.ServeHTTP(w, r)
		})
	}
}


// SetLocalOnly flips the distributed verdict at runtime (plan A1): true =
// local-only (zero DB verdicts), false = dual (behavior-preserving). It is
// safe for concurrent use; in-flight requests observe the flip on their
// next per-request read.
func (t *TierSet) SetLocalOnly(localOnly bool) {
	if t == nil {
		return
	}
	t.mu.Lock()
	t.localOnly = localOnly
	t.mu.Unlock()
}

// LocalOnly reports the current distributed-verdict posture.
func (t *TierSet) LocalOnly() bool {
	if t == nil {
		return false
	}
	t.mu.RLock()
	defer t.mu.RUnlock()
	return t.localOnly
}

// DBCheckerCount reports how many tiers have a distributed checker wired.
// Tests use it to assert buildTierSet's RATE_LIMIT_MODE posture without a DB.
func (t *TierSet) DBCheckerCount() int {
	if t == nil {
		return 0
	}
	t.mu.RLock()
	defer t.mu.RUnlock()
	return len(t.dbs)
}

// HasTier reports whether a tier has a budget configured.
func (t *TierSet) HasTier(tier string) bool {
	if t == nil {
		return false
	}
	t.mu.RLock()
	defer t.mu.RUnlock()
	_, ok := t.budgets[tier]
	return ok
}

// ---- TierSet construction from process config ----

// TierBudgetsFromConfig maps the process config onto per-tier budgets.
// Zero values fall back to the same defaults as Load, so a TierSet built
// from a zero Config (notably in tests) stays usable.
func TierBudgetsFromConfig(perMin map[string]int, burst int) map[string]TierBudget {
	b := func(explicit, def int) int {
		if explicit > 0 {
			return explicit
		}
		return def
	}
	return map[string]TierBudget{
		TierAuthCritical: {PerMin: b(perMin[TierAuthCritical], 120), Window: time.Minute, Burst: burst},
		TierAnonAuth:     {PerMin: b(perMin[TierAnonAuth], 30), Window: time.Minute, Burst: burst},
		TierAuthedReads:  {PerMin: b(perMin[TierAuthedReads], 300), Window: time.Minute, Burst: burst},
		TierPolling:      {PerMin: b(perMin[TierPolling], 240), Window: time.Minute, Burst: burst},
		TierHeartbeat:    {PerMin: b(perMin[TierHeartbeat], 120), Window: time.Minute, Burst: burst},
		TierWrites:       {PerMin: b(perMin[TierWrites], 120), Window: time.Minute, Burst: burst},
		TierBackstop:     {PerMin: b(perMin[TierBackstop], 3000), Window: time.Minute, Burst: burst},
	}
}

// keyClassOf reduces a bucket key to its low-cardinality class for metrics
// and logs. Raw user/attempt identifiers never leave this function.
func keyClassOf(key string) string {
	switch {
	case strings.HasPrefix(key, "user:"),
		strings.HasPrefix(key, "attempt-user:"):
		return "user"
	case strings.HasPrefix(key, "attempt:"):
		return "attempt"
	default:
		return "ip"
	}
}

// denyTierRateLimit renders the stable 429 envelope with an additive tier
// detail, records the per-tier denial counter, and logs one structured line
// (429s bypass AccessLog by design, so this is their observability path).
// SetShedExam marks requests served under exam shed budgets (plan E2
// dashboard slice). The tier set is rebuilt at startup, so this is a
// process-wide flag set once by BuildApp — not per-request state.
var shedExamActive atomic.Int32

// SetShedExam records the exam-shed posture for observability.
func SetShedExam(on bool) {
	shedExamActive.Store(1)
	if !on {
		shedExamActive.Store(0)
	}
}

func denyTierRateLimit(w http.ResponseWriter, r *http.Request, tier, keyClass string, retryAfter time.Duration) {
	secs := int(retryAfter.Seconds())
	if secs < 1 {
		secs = 1
	}
	telemetry.DefaultRegistry.IncCounter(telemetry.MRatelimitDeniedTotal, "tier", tier, "key_class", keyClass)
	if shedExamActive.Load() == 1 {
		telemetry.DefaultRegistry.IncCounter(telemetry.MShedExam)
	}
	route := routeOf(r)
	if route == "" || strings.HasPrefix(route, "/") && strings.Contains(route, "{") == false && len(route) > 64 {
		route = r.URL.Path
		if len(route) > 64 {
			route = route[:64]
		}
	}
	log.Printf(`{"level":"warn","msg":"rate limit denied","tier":%q,"key_class":%q,"route":%q,"method":%q,"retry_after":%d}`,
		tier, keyClass, route, r.Method, secs)
	denyRateLimitWithTier(w, r, tier, retryAfter)
}
