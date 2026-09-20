// Command api serves the IELTS proctoring HTTP API (chi router).
//
// Wiring: config.Load + ValidateForRuntime, db.Open, tx.Runner, BuildApp,
// chi router with /healthz /readyz + /api/v1/* + /api/v2/*, middleware in
// spec order, and graceful shutdown via platform/shutdown (stop HTTP,
// drain 30s, close pool).
package main

import (
	"context"
	"crypto/subtle"
	"database/sql"
	"log"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"example.com/ielts-proctoring/internal/accesslinks"
	"example.com/ielts-proctoring/internal/act"
	"example.com/ielts-proctoring/internal/answerhistory"
	shared "example.com/ielts-proctoring/internal/app"
	"example.com/ielts-proctoring/internal/attempts"
	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/authoring"
	"example.com/ielts-proctoring/internal/authoringcoedit"
	"example.com/ielts-proctoring/internal/authoringrealtime"
	"example.com/ielts-proctoring/internal/authz"
	"example.com/ielts-proctoring/internal/delivery"
	"example.com/ielts-proctoring/internal/exams"
	"example.com/ielts-proctoring/internal/grading"
	"example.com/ielts-proctoring/internal/library"
	"example.com/ielts-proctoring/internal/liveupdates"
	"example.com/ielts-proctoring/internal/media"
	"example.com/ielts-proctoring/internal/outbox"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/config"
	"example.com/ielts-proctoring/internal/platform/crypto"
	"example.com/ielts-proctoring/internal/platform/db"
	"example.com/ielts-proctoring/internal/platform/httpx"
	"example.com/ielts-proctoring/internal/platform/shutdown"
	"example.com/ielts-proctoring/internal/platform/telemetry"
	"example.com/ielts-proctoring/internal/platform/tx"
	"example.com/ielts-proctoring/internal/proctor"
	"example.com/ielts-proctoring/internal/release"
	"example.com/ielts-proctoring/internal/results"
	"example.com/ielts-proctoring/internal/runtime"
	"example.com/ielts-proctoring/internal/sat"
	"example.com/ielts-proctoring/internal/schedules"
	"example.com/ielts-proctoring/internal/student"
	"example.com/ielts-proctoring/internal/terminalization"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// SessionResolver loads a session actor from the request's session cookie.
// The concrete auth helper accepts a broader auth.Querier surface, so the
// composition root adapts it to the API's *sql.DB dependency for test seams.
type SessionResolver func(context.Context, *sql.DB, *auth.SessionCache, config.Config, string, time.Time) (*auth.Session, error)

func defaultSessionResolver(ctx context.Context, db *sql.DB, cache *auth.SessionCache, cfg config.Config, token string, now time.Time) (*auth.Session, error) {
	return auth.LookupSessionWithCache(ctx, db, cache, cfg, token, now)
}

// App is the interface-free composition root. Domain services hang off
// this struct explicitly (no globals); handlers nil-check only for
// dependency outages and return the stable 503 envelope when required.
type App struct {
	Config        config.Config
	DB            *sql.DB
	Tx            *tx.Runner
	Limiter       *httpx.BucketStore
	ExportLimiter *httpx.DBRateLimiter
	Tiers         *httpx.TierSet
	Attempts      *attempts.Service
	Exams         *exams.Service
	Schedules     *schedules.Service
	Student       *student.Service
	Proctor       *proctor.Service
	Grading       *grading.Service
	Results       *results.Service
	Media         *media.Service
	Library       *library.Service
	AnswerHistory *answerhistory.Service
	Authoring     *authoring.Service
	AccessLinks   *accesslinks.Service
	SAT           *sat.Service
	ACT           *act.Service
	Delivery      *delivery.Service
	Release       *release.Service
	Runtime       *runtime.Service
	Terminal      *terminalization.Service
	LiveBus       *liveupdates.Bus
	LiveHub       *liveupdates.Hub
	// AuthoringExamLoader, when set, overrides the exam-backed loader used by
	// the authoring realtime ACL. Production leaves it nil (the handler falls
	// back to app.Exams); tests inject a fake to exercise the socket with no DB.
	AuthoringExamLoader authoringrealtime.ExamLoader
	// AuthoringBarrier, when set, overrides the live bus as the source of the
	// replay/live barrier cursor. Production leaves it nil (the handler uses
	// app.LiveBus); tests inject a fixed watermark for deterministic handoffs.
	AuthoringBarrier authoringrealtime.BarrierSource
	// AuthoringDisplayNames, when set, overrides the DB-backed display-name
	// lookup that stamps presence frames. Cosmetic only: a lookup failure
	// yields an empty name and never fails a subscription.
	AuthoringDisplayNames authoringrealtime.DisplayNameResolver
	// AuthoringPresence is the process-local Phase 05 presence registry.
	// Production leaves it nil and a default-configured hub is created on
	// first use; tests inject a hub with a tiny TTL for deterministic expiry.
	AuthoringPresence     *authoringrealtime.PresenceHub
	authoringPresenceOnce sync.Once
	// AuthoringConfigErr is a fail-closed startup check from app.Build:
	// non-nil means AUTHORING_REALTIME_EVENTS was enabled without a live
	// bus, so main refuses to boot instead of silently degrading.
	AuthoringConfigErr error
	// CoeditTokens mints short-lived browser co-edit tokens. Nil when the
	// AUTHORING_REALTIME_COEDITING flag is off (or misconfigured: see
	// CoeditConfigErr).
	CoeditTokens *authoringcoedit.TokenIssuer
	// CoeditSigner verifies private Hocuspocus -> Go calls and signs the
	// Go -> Hocuspocus control calls.
	CoeditSigner *authoringcoedit.ServiceSigner
	// CoeditControl is the private control client for the singleton service
	// (freeze/flush/close). Nil when service admission is off.
	CoeditControl *authoringcoedit.ControlClient
	// CoeditConfigErr is a fail-closed startup check: non-nil means
	// AUTHORING_REALTIME_COEDITING was enabled with a missing or short
	// secret, so main refuses to boot instead of issuing unsigned tokens.
	CoeditConfigErr error
	Leases          *liveupdates.LeaseRepository
	// Admission is the plan-C2 in-memory WS gate. Always non-nil (db mode
	// leaves it unused; memory mode serves acquires with zero SQL).
	Admission       *liveupdates.Admission
	Outbox          *outbox.Repository
	Secret          []byte
	LiveForwardOnce sync.Once
	// LiveForwardMu guards stopLiveForward (start/stop cross goroutines).
	LiveForwardMu sync.Mutex
	// stopLiveForward halts the bus poll loop; nil when never started.
	stopLiveForward context.CancelFunc
	// SessionCache is the plan-A2 in-process session LRU. Always non-nil
	// (disabled cache = never stores, never hits = today's behavior).
	// Wired in BuildApp so authMiddleware serves hits with zero SQL.
	SessionCache *auth.SessionCache
	// SessionResolver is injected so middleware-order tests can prove that a
	// pre-auth rejection avoids session database work.
	SessionResolver SessionResolver
	// EntryGate is the plan-D3 per-schedule check-in bucket. Always non-nil
	// (off = present-but-unused, today's shape untouched). Wired in BuildApp
	// from ENTRY_PER_SEC_PER_SCHEDULE/ENTRY_BURST.
	EntryGate *entryGate
	// Versions is the plan-D1 versionID -> assembled-tree VersionCache.
	Versions *delivery.VersionCache
	// RuntimeSnapshots is the plan-B2 schedule -> runtime SnapshotCache.
	// Always non-nil (off = present-but-unused, today's FOR UPDATE path
	// untouched). Wired in BuildApp so V2 handlers share one TTL view.
	RuntimeSnapshots *runtime.SnapshotCache
}

// RowFirst reports the plan-B3 row-first posture (config-derived, so it is
// assertable without a pool; services are wired from the same flag in
// BuildApp when a pool is present).
func (a *App) RowFirst() bool {
	return a != nil && a.Config.RowFirstWrites
}

// RuntimeLockerFor returns the RuntimeLocker for V2 writes under the
// RUNTIME_SNAPSHOT posture: on = shared snapshotLocker (committed-read
// pre-gate, zero SQL on fresh+live TTL hits; exactly one sync refresh +
// retry on stale, then today's 422/409); off = v2Locker (today's
// runtime + section FOR UPDATE path). Never nil.
// RuntimeLockerFor selects the V2 write gate. Both implementations read the
// runtime + active section on the caller's transaction, so both are
// authoritative for the write that commits there; RUNTIME_SNAPSHOT only chooses
// whether those reads take the runtime/section row locks (v2Locker, off) or not
// (snapshotLocker, on). The RuntimeSnapshots cache serves student polls and is
// deliberately not part of this decision.
func (a *App) RuntimeLockerFor() attempts.RuntimeLocker {
	if a != nil && a.Config.RuntimeSnapshotEnabled && a.DB != nil {
		return snapshotLocker{}
	}
	return v2Locker{}
}

// AttemptVerifyMode surfaces the plan-A3 bearer-verification posture so all
// attempt-bearer handlers route identically through verifyAttemptBearer:
// strict = HMAC + expiry + attempt_sessions DB binding (ship default);
// stateless = HMAC + expiry only, zero SQL (binding enforced against the
// locked attempt row in-tx + URL params at the edge).
func (a *App) AttemptVerifyMode() auth.AttemptVerifyMode {
	if a == nil {
		return auth.AttemptVerifyStrict
	}
	if a.Config.AttemptVerifyStateless() {
		return auth.AttemptVerifyStateless
	}
	return auth.AttemptVerifyStrict
}

// verifyAttemptBearer is the single bearer-verification choke point for all
// attempt-bearer handlers (delivery x5, v1 identity, domain wire, v2
// snapshot). One call site to audit; posture flips via ATTEMPT_VERIFY.
// Strict performs the attempt_sessions DB binding; stateless verifies HMAC +
// expiry only (zero SQL) and relies on downstream binding checks (attempt
// row in-tx + URL params at the edge, which every caller already performs).
func verifyAttemptBearer(app *App, r *http.Request, bearer string) (crypto.AttemptClaims, error) {
	return auth.VerifyAttemptTokenRouted(r.Context(), app.DB, app.Config, app.AttemptVerifyMode(), time.Now().UTC(), bearer)
}

// BuildApp composes the application from validated config + open pool.
// It never panics: a nil pool yields an App whose handlers degrade to
// 503 on DB-dependent probes (readiness) instead of crashing.
func BuildApp(cfg config.Config, pool *sql.DB) *App {
	maxKeys := cfg.RateLimitMaxKeys
	if maxKeys <= 0 {
		maxKeys = cfg.RateLimitBucketCap
	}
	if maxKeys <= 0 {
		maxKeys = 10000
	}
	app := &App{Config: cfg, DB: pool, Limiter: httpx.NewBucketStore(maxKeys), SessionResolver: defaultSessionResolver, SessionCache: auth.NewSessionCache(auth.SessionCacheConfig{
		Enabled:           cfg.SessionCacheEnabled,
		MaxEntries:        cfg.SessionCacheMax,
		TouchCoalesceSecs: cfg.SessionTouchCoalesce(),
	}), RuntimeSnapshots: runtime.NewSnapshotCache(runtime.SnapshotTTL),
		// Plan D1: always non-nil (off = present-but-unused, today's N+1
		// path untouched). Wired into Delivery when VERSION_CACHE=on.
		Versions: delivery.NewVersionCache(delivery.VersionCacheMaxVersions),
		// Plan D3: always non-nil (off = present-but-unused). Wired from
		// ENTRY_PER_SEC_PER_SCHEDULE/ENTRY_BURST (clamped in config).
		EntryGate: newEntryGate(entryGateConfig{PerSec: cfg.EntryPerSec, Burst: cfg.EntryBurst}),
		// Plan C2: always non-nil (db mode leaves it unused; memory mode
		// serves acquires with zero SQL). Built once here — never inside
		// the pool branch — so no second reaper leaks.
		Admission: liveupdates.NewAdmission(liveupdates.AdmissionCaps{
			Total:       cfg.WSCapTotal,
			PerUser:     cfg.WSCapUser,
			PerSchedule: cfg.WSCapSchedule,
			TTL:         liveupdates.LeaseTTL,
		})}
	if pool != nil {
		app.ExportLimiter = httpx.NewDBRateLimiter(pool, "results_export", cfg.RateLimitExportPerUser, time.Duration(cfg.RateLimitExportPerUserWindowSecs)*time.Second)
		// WS-04b: domain services come from the shared graph so the
		// SAT/ACT provider switch, presence posture, and terminal scorer
		// cannot drift from the worker's copy. HTTP-edge state (bus, hub,
		// leases, admission) is per-process by design and stays here.
		bus := liveupdates.NewBus(pool, uuid.NewString())
		hub := liveupdates.NewHub()
		svc := shared.Build(cfg, pool, shared.Deps{
			Versions:         app.Versions,
			RuntimeSnapshots: app.RuntimeSnapshots,
			LiveBus:          bus,
			LiveHub:          hub,
			Leases:           liveupdates.NewLeaseRepository(pool),
			Admission:        app.Admission,
		})
		app.Tx = svc.Tx
		app.Secret = svc.Secret
		app.Outbox = svc.Outbox
		app.Terminal = svc.Terminal
		app.Attempts = svc.Attempts
		app.Exams = svc.Exams
		app.Schedules = svc.Schedules
		app.Student = svc.Student
		app.Proctor = svc.Proctor
		app.Grading = svc.Grading
		app.Results = svc.Results
		app.Media = svc.Media
		app.Library = svc.Library
		app.AnswerHistory = svc.AnswerHistory
		app.Authoring = svc.Authoring
		app.AccessLinks = svc.AccessLinks
		app.SAT = svc.SAT
		app.ACT = svc.ACT
		app.Release = svc.Release
		app.Runtime = svc.Runtime
		app.Delivery = svc.Delivery
		app.LiveBus = bus
		app.LiveHub = hub
		app.Leases = liveupdates.NewLeaseRepository(pool)
		app.AuthoringConfigErr = svc.AuthoringConfigErr
		if app.Authoring != nil {
			app.Authoring.SetCoeditEnabled(cfg.AuthoringRealtimeCoediting)
		}
	}
	wireCoedit(app, cfg)

	return app
}

// wireCoedit resolves the co-edit posture. It never partially configures: a
// short secret leaves CoeditConfigErr set and CoeditTokens nil, so the handler
// reports the capability as off rather than minting a weak token.
func wireCoedit(app *App, cfg config.Config) {
	if !cfg.AuthoringRealtimeCoediting {
		return
	}
	issuer, err := authoringcoedit.NewTokenIssuer(cfg.AuthoringCoeditTokenSecret)
	if err != nil {
		app.CoeditConfigErr = err
		return
	}
	app.CoeditTokens = issuer
	signer, err := authoringcoedit.NewServiceSigner(cfg.AuthoringCoeditServiceSecret)
	if err != nil {
		app.CoeditConfigErr = err
		return
	}
	app.CoeditSigner = signer
	if !cfg.AuthoringCoeditServiceEnabled {
		return
	}
	control, err := authoringcoedit.NewControlClient(cfg.AuthoringCoeditServiceURL, signer)
	if err != nil {
		app.CoeditConfigErr = err
		return
	}
	app.CoeditControl = control
}

// CoeditCapability reports whether browsers may be told co-editing is
// available. It is the AND of both flags and a fully wired client: telling a
// browser to connect to a service that will refuse admission is a broken
// state, so the capability is never advertised on half a configuration.
func (a *App) CoeditCapability() bool {
	if a == nil {
		return false
	}
	return a.Config.AuthoringRealtimeCoediting &&
		a.Config.AuthoringCoeditServiceEnabled &&
		a.CoeditTokens != nil && a.CoeditSigner != nil && a.CoeditControl != nil
}

func main() {
	cfg := config.Load()
	// Round 75: unknown-error hook logs the raw error server-side so
	// masking bugs (raw driver errors escaping as silent 500s) self-
	// report in the deploy log. The client envelope stays INTERNAL
	// (no internals leak); only the route + error text are logged.
	httpx.SetUnknownHook(func(r *http.Request, err error) {
		log.Printf(`{"level":"error","msg":"unknown error masked as 500","route":%q,"err":%q}`, r.URL.Path, err.Error())
	})
	if err := cfg.ValidateForRuntime(); err != nil {
		log.Fatalf("api: invalid config: %v", err)
	}
	if err := httpx.SetTrustedProxies(cfg.TrustedProxyCIDRs); err != nil {
		log.Fatalf("api: invalid trusted proxy configuration: %v", err)
	}
	pool, err := db.OpenRole(cfg, db.RoleAPI)
	if err != nil {
		log.Fatalf("api: open db: %v", err)
	}
	defer func() { _ = pool.Close() }()
	// Fail closed on a half-migrated database: refuse to serve traffic when
	// durability-critical columns/indexes are missing (mirrors the migrate
	// gate; same check the Rust startup runs before listening).
	if verr := db.VerifyRuntimeSchema(context.Background(), pool); verr != nil {
		log.Fatalf("api: runtime schema guard: %v", verr)
	}

	app := BuildApp(cfg, pool)
	// Phase 02: a flag-on process with no live bus must not start, or the
	// authoring realtime capability would be silently disabled at runtime.
	if app.AuthoringConfigErr != nil {
		log.Fatalf("api: authoring realtime misconfigured: %v", app.AuthoringConfigErr)
	}
	// Prompt co-editing fails closed the same way: a flag-on process with a
	// missing or short secret must not start, or it would advertise a
	// collaborative editor whose tokens nobody can verify.
	if app.CoeditConfigErr != nil {
		log.Fatalf("api: prompt co-editing misconfigured: %v", app.CoeditConfigErr)
	}
	// Recover expired durable freezes before admitting HTTP traffic, then keep
	// the idempotent pass running while the API is alive. Token handlers repeat
	// the pass immediately before issuing a room token as a request-path guard.
	if app.CoeditCapability() {
		if err := recoverExpiredCoeditFreezes(context.Background(), app); err != nil {
			log.Printf("api: co-edit freeze recovery unavailable at startup: %v", err)
		}
	}
	stopCoeditRecovery := startCoeditRecoveryLoop(context.Background(), app)
	// Plan E3: report absorbed tx transients on db_deadlocks_total{kind}.
	defer installTxRetryHook()()
	srvCfg := httpx.DefaultServerConfig()
	// Plan-E conn lever (round 137): HTTP_WRITE_TIMEOUT_SECS lengthens the
	// write bound for saturated waves; default 30 = today's behavior.
	if cfg.HTTPWriteTimeoutSecs > 0 {
		srvCfg.WriteTimeout = time.Duration(cfg.HTTPWriteTimeoutSecs) * time.Second
	}
	srv := &http.Server{
		Addr:              cfg.Addr(),
		Handler:           BuildRouter(app),
		ReadHeaderTimeout: srvCfg.ReadHeaderTimeout, // 5s
		ReadTimeout:       srvCfg.ReadTimeout,       // 15s
		WriteTimeout:      srvCfg.WriteTimeout,
		IdleTimeout:       srvCfg.IdleTimeout,    // 120s
		MaxHeaderBytes:    srvCfg.MaxHeaderBytes, // 1MB
	}

	go func() {
		log.Printf("api: listening on %s", cfg.Addr())
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("api: serve: %v", err)
		}
	}()

	// Graceful shutdown: stop accepting HTTP, drain in-flight bounded by
	// shutdown.DrainTimeout (30s), then close the pool.
	shutdown.Wait(context.Background())
	// Stop background loops before draining HTTP: no new hub publishes
	// (forwarder) and no reaper ticks (admission) while in-flight
	// requests finish.
	app.stopLiveForwarder()
	stopCoeditRecovery()
	if app.Admission != nil {
		app.Admission.Stop()
	}
	log.Printf("api: shutting down, draining up to %s", shutdown.DrainTimeout)
	ctx, cancel := context.WithTimeout(context.Background(), shutdown.DrainTimeout)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Printf("api: shutdown: %v", err)
	}
	if err := pool.Close(); err != nil {
		log.Printf("api: close pool: %v", err)
	}
}

// BuildRouter mounts health probes plus versioned API handlers behind the
// spec middleware order:
//
//	panic recovery > request id > trace > security headers > body limit >
//	pre-auth IP guard > auth > CSRF > rate limit (tiers) > authorization >
//	handler > access log
//
// Rate limiting is tiered: auth-critical, anon-auth, authed-reads, polling,
// heartbeat, writes, each with an independent per-minute quota keyed by user
// (cookie session), attempt hash (student/V2 bearer), or IP (anonymous).
// A loose local-only backstop runs globally as an abuse floor. Tier denials
// render 429 RATE_LIMIT_EXCEEDED with an additive tier detail and are
// observable via the http_ratelimit_denied_total counter plus a deny log
// line (AccessLog never sees 429s: it is innermost by design).
//
// AccessLog is registered last (innermost) so its JSON line emits after
// the handler returns, satisfying the trailing "handler > access log"
// step. Denials from outer layers (body-limit 413, rate-limit 429,
// CSRF 403, recovery 500) render the stable error envelope but bypass
// the access line.
func BuildRouter(app *App) http.Handler {
	r := chi.NewRouter()
	startLiveBusForwarder(app)

	buildTierSet(app)

	// WS-13.6 CORS decision (behavior-pinned): same-origin-only. The
	// middleware is mounted explicitly (outermost) with no extra origins:
	// same-origin/non-browser pass, cross-origin preflights 403, and the
	// posture is code rather than the absence of a mount.
	r.Use(httpx.CORS(httpx.CORSOptions{}))
	r.Use(httpx.Recovery)
	r.Use(httpx.RequestID)
	r.Use(httpx.Trace)
	r.Use(httpx.SecurityHeaders)
	// Global ceiling is the largest tier (workbook 64MiB); tighter tiers
	// re-wrap per group below (a smaller inner cap always wins).
	r.Use(httpx.BodyLimit(httpx.MaxWorkbookBodyBytes))
	// Loose local-only backstop across all traffic (abuse floor). It never
	// touches the distributed counters, so it cannot couple tiers together;
	// it must run before auth so rejected cookie traffic does not touch the
	// session store.
	r.Use(app.Tiers.Middleware(httpx.TierBackstop, httpx.ClientIPKey))
	r.Use(authMiddleware(app))
	r.Use(csrfMiddleware(app))
	// authorize wraps one route handler with the authz first-layer gate
	// for its exact table key: Public/Bearer entries passthrough to
	// their handler credential checks, session entries 401 anon and 403
	// wrong-role, and anything unlisted denies closed (403). Scope
	// (assignment/attempt-ownership/builder-preview) stays in handlers.
	// The annotation (+route helper below) is load-bearing: it emits
	// both the httpx route template (low-cardinality access logs) and
	// the exact authz lookup key, so every gated route carries exactly
	// one key and no wrapped route ever falls to path-match/404.
	authorize := func(key string, h http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			authz.MiddlewareFor(authz.Table, key, authzSessionOf)(httpx.WithRoute(h, key)).ServeHTTP(w, r)
		}
	}
	authzRoute := func(r chi.Router, method, pattern string, h http.HandlerFunc) {
		route(r, method, pattern, authorize(method+" "+pattern, h))
	}
	r.Use(httpx.AccessLog)

	r.Get("/healthz", authorize("GET /healthz", healthz(app)))
	r.Get("/readyz", authorize("GET /readyz", readyz(app)))
	// WS-10a: /metrics is private by default. METRICS_PUBLIC=1 exposes it
	// (trusted-network scrapes); otherwise a bearer token is required
	// (Authorization: Bearer $METRICS_TOKEN, constant-time compare). An
	// empty METRICS_TOKEN with METRICS_PUBLIC unset denies every scrape
	// (403 + log, never open): fail closed over fail open.
	r.Get("/metrics", authorize("GET /metrics", metricsHandler(app)))

	studentLimit := httpx.BodyLimit(httpx.MaxStudentBodyBytes) // 256KiB
	adminLimit := httpx.BodyLimit(httpx.MaxAdminBodyBytes)     // 2MiB

	r.Route("/api/v1", func(r chi.Router) {
		// Auth routes split by cost class: session/logout reads get a generous
		// per-user quota isolated from bulk traffic (unrelated polling can
		// never starve session bootstrap), while credential-bearing attempts
		// stay on a strict per-IP quota (abuse surface).
		r.With(adminLimit).Route("/auth", func(r chi.Router) {
			r.With(limitTier(app, httpx.TierAuthCritical, userKey())).Group(func(r chi.Router) {
				authzRoute(r, "GET", "/session", sessionHandler(app))
				authzRoute(r, "POST", "/logout", logoutHandler(app))
				authzRoute(r, "POST", "/logout-all", logoutAllHandler(app))
			})
			r.With(limitTier(app, httpx.TierAnonAuth, ipKey())).Group(func(r chi.Router) {
				authzRoute(r, "POST", "/login", loginHandler(app))
				authzRoute(r, "POST", "/student/entry", studentEntryHandler(app))
				authzRoute(r, "GET", "/student/schedules/{id}", studentEntryScheduleHandler(app))
				authzRoute(r, "POST", "/activate", activateHandler(app))
				authzRoute(r, "POST", "/password/reset-request", passwordResetRequestHandler(app))
				authzRoute(r, "POST", "/password/reset-complete", passwordResetCompleteHandler(app))
			})
		})
		r.With(limitTier(app, httpx.TierAnonAuth, ipKey())).Group(func(r chi.Router) {
			authzRoute(r, "POST", "/public/access-links/{linkID}/resolve-entry", publicLinkResolveEntry(app))
		})
		r.With(limitTier(app, httpx.TierAuthedReads, userKey())).With(adminLimit).Route("/exams", func(r chi.Router) {
			authzRoute(r, "GET", "/", examsListHandler(app))
			authzRoute(r, "POST", "/", examsCreateHandler(app))
			authzRoute(r, "GET", "/{id}", examsGetHandler(app))
			authzRoute(r, "PATCH", "/{id}", examsUpdateHandler(app))
			authzRoute(r, "DELETE", "/{id}", examsDeleteHandler(app))
			authzRoute(r, "PATCH", "/{id}/draft", coeditScopeCloseGuard(app, authoringcoedit.CloseDraftReplaced, "id", examsDraftHandler(app)))
			authzRoute(r, "POST", "/{id}/draft/reopen", examsDraftReopenHandler(app))
			authzRoute(r, "POST", "/{id}/publish", coeditPublishGuard(app, examsPublishHandler(app)))
			authzRoute(r, "GET", "/{id}/events", examsEventsHandler(app))
			authzRoute(r, "GET", "/{id}/validation", examsValidationHandler(app))
			authzRoute(r, "GET", "/{id}/versions", examsVersionsHandler(app))
			authzRoute(r, "GET", "/{id}/versions/summary", examsVersionSummariesHandler(app))
		})
		r.With(limitTier(app, httpx.TierAuthedReads, userKey())).With(adminLimit).Route("/assessment-access", func(r chi.Router) {
			authzRoute(r, "GET", "/exams/{examID}/overview", accessLinkOverview(app))
			authzRoute(r, "GET", "/exams/{examID}/links", examLinksList(app))
			authzRoute(r, "POST", "/exams/{examID}/links", examLinkCreate(app))
			authzRoute(r, "GET", "/links/{linkID}", linkGet(app))
			authzRoute(r, "PATCH", "/links/{linkID}", linkUpdate(app))
			authzRoute(r, "POST", "/links/{linkID}/lifecycle", linkLifecycle(app))
			authzRoute(r, "POST", "/links/{linkID}/duplicate", linkDuplicate(app))
			authzRoute(r, "GET", "/links/{linkID}/members", linkMembers(app))
			authzRoute(r, "GET", "/links/{linkID}/activity", linkActivity(app))
		})
		r.With(limitTier(app, httpx.TierAnonAuth, ipKey())).Group(func(r chi.Router) {
			authzRoute(r, "GET", "/public/access-links/{linkID}", publicLinkGet(app))
		})
		r.With(limitTier(app, httpx.TierAuthedReads, userKey())).With(adminLimit).Get("/assessment-release/exams/{examID}", authorize("GET /api/v1/assessment-release/exams/{examID}", releaseStateHandler(app)))
		r.With(limitTier(app, httpx.TierWrites, userKey())).Route("/assessment-authoring", func(r chi.Router) {
			r.With(adminLimit).Get("/exams/{examID}/shell", authorize("GET /api/v1/assessment-authoring/exams/{examID}/shell", authorShellHandler(app)))
			r.With(adminLimit).Post("/exams/{examID}/shell", authorize("POST /api/v1/assessment-authoring/exams/{examID}/shell", authorOpenShellHandler(app)))
			r.With(adminLimit).Get("/exams/{examID}/preview", authorize("GET /api/v1/assessment-authoring/exams/{examID}/preview", authorPreviewHandler(app)))
			r.With(adminLimit).Post("/exams/{examID}/load-sample", authorize("POST /api/v1/assessment-authoring/exams/{examID}/load-sample", authorSampleHandler(app)))
			r.With(adminLimit).Get("/exams/{examID}/sat-workbook-template", authorize("GET /api/v1/assessment-authoring/exams/{examID}/sat-workbook-template", authorSatWorkbookTemplateHandler(app)))
			// Workbook import tiers keep the 64MiB global ceiling.
			authzRoute(r, "POST", "/exams/{examID}/sat-workbook-preview", authorPreviewImportHandler(app))
			authzRoute(r, "POST", "/exams/{examID}/sat-workbook-commit", coeditScopeCloseGuard(app, authoringcoedit.CloseWorkbookReplaced, "examID", authorCommitImportHandler(app)))
			r.With(adminLimit).Get("/exams/{examID}/sat-workbook-undo", authorize("GET /api/v1/assessment-authoring/exams/{examID}/sat-workbook-undo", authorUndoStateHandler(app)))
			r.With(adminLimit).Post("/exams/{examID}/sat-workbook-imports/{importID}/undo", authorize("POST /api/v1/assessment-authoring/exams/{examID}/sat-workbook-imports/{importID}/undo", authorUndoImportHandler(app)))
			r.With(adminLimit).Get("/modules/{moduleID}/questions", authorize("GET /api/v1/assessment-authoring/modules/{moduleID}/questions", authorListQuestionsHandler(app)))
			r.With(adminLimit).Post("/modules/{moduleID}/questions", authorize("POST /api/v1/assessment-authoring/modules/{moduleID}/questions", authorCreateQuestionHandler(app)))
			r.With(adminLimit).Post("/modules/{moduleID}/questions/batch", authorize("POST /api/v1/assessment-authoring/modules/{moduleID}/questions/batch", authorBatchQuestionsHandler(app)))
			r.With(adminLimit).Patch("/modules/{moduleID}/question-order", authorize("PATCH /api/v1/assessment-authoring/modules/{moduleID}/question-order", authorReorderHandler(app)))
			r.With(adminLimit).Get("/exam-questions/{examQuestionID}", authorize("GET /api/v1/assessment-authoring/exam-questions/{examQuestionID}", authorGetQuestionHandler(app)))
			r.With(adminLimit).Patch("/exam-questions/{examQuestionID}", authorize("PATCH /api/v1/assessment-authoring/exam-questions/{examQuestionID}", authorUpdateQuestionHandler(app)))
			r.With(adminLimit).Delete("/exam-questions/{examQuestionID}", authorize("DELETE /api/v1/assessment-authoring/exam-questions/{examQuestionID}", coeditQuestionDeleteGuard(app, authorDeleteQuestionHandler(app))))
			r.With(adminLimit).Post("/exam-questions/{examQuestionID}/coedit-token", authorize("POST /api/v1/assessment-authoring/exam-questions/{examQuestionID}/coedit-token", authorCoeditTokenHandler(app)))
			r.With(adminLimit).Post("/exams/{examID}/coedit-token", authorize("POST /api/v1/assessment-authoring/exams/{examID}/coedit-token", authorWorkspaceCoeditTokenHandler(app)))
			r.With(adminLimit).Patch("/question-revisions/{revisionID}/fields", authorize("PATCH /api/v1/assessment-authoring/question-revisions/{revisionID}/fields", authorRevisionFieldsHandler(app)))
			r.With(adminLimit).Post("/exam-questions/{examQuestionID}/duplicate", authorize("POST /api/v1/assessment-authoring/exam-questions/{examQuestionID}/duplicate", authorDuplicateHandler(app)))
			r.With(adminLimit).Post("/questions/bulk", authorize("POST /api/v1/assessment-authoring/questions/bulk", authorBulkHandler(app)))
			r.With(adminLimit).Patch("/question-revisions/{revisionID}", authorize("PATCH /api/v1/assessment-authoring/question-revisions/{revisionID}", authorSaveRevisionHandler(app)))
			r.With(adminLimit).Patch("/exams/{examID}/sections/{sectionID}/delivery-settings", authorize("PATCH /api/v1/assessment-authoring/exams/{examID}/sections/{sectionID}/delivery-settings", authorDeliverySettingsHandler(app)))
			r.With(adminLimit).Post("/exams/{examID}/validate", authorize("POST /api/v1/assessment-authoring/exams/{examID}/validate", authorValidateHandler(app)))
		})
		r.With(limitTier(app, httpx.TierWrites, attemptKey())).With(studentLimit).Route("/assessment-delivery", func(r chi.Router) {
			authzRoute(r, "POST", "/schedules/{scheduleID}/bootstrap", deliveryBootstrapHandler(app))
			authzRoute(r, "PATCH", "/schedules/{scheduleID}/responses/{examQuestionID}", deliverySaveResponseHandler(app))
			authzRoute(r, "POST", "/schedules/{scheduleID}/modules/start", deliveryStartModuleHandler(app))
			authzRoute(r, "POST", "/schedules/{scheduleID}/modules/submit", deliverySubmitModuleHandler(app))
			authzRoute(r, "POST", "/schedules/{scheduleID}/submit", deliverySubmitAssessmentHandler(app))
		})
		r.With(limitTier(app, httpx.TierAuthedReads, userKey())).Group(func(r chi.Router) {
			authzRoute(r, "GET", "/versions/{versionID}", versionSummaryHandler(app))
		})
		r.With(limitTier(app, httpx.TierAuthedReads, userKey())).With(adminLimit).Route("/schedules", func(r chi.Router) {
			authzRoute(r, "GET", "/", schedulesListHandler(app))
			authzRoute(r, "POST", "/", schedulesCreateHandler(app))
			authzRoute(r, "GET", "/{id}", schedulesGetHandler(app))
			authzRoute(r, "PATCH", "/{id}", schedulesUpdateHandler(app))
			authzRoute(r, "DELETE", "/{id}", schedulesDeleteHandler(app))
			authzRoute(r, "GET", "/{id}/runtime", schedulesRuntimeHandler(app))
			authzRoute(r, "POST", "/{id}/runtime/commands", schedulesRuntimeCommandHandler(app))
			authzRoute(r, "POST", "/{id}/register", schedulesRegisterHandler(app))
		})
		// Student sessions split by cost class: session/static reads stay in
		// authed-reads, the polled live view gets its own polling budget,
		// heartbeats get a cheap high-frequency budget, and mutations/submits
		// are writes — so no student traffic class can starve the others.
		r.With(studentLimit).Route("/student/sessions", func(r chi.Router) {
			r.With(limitTier(app, httpx.TierAuthedReads, attemptKey())).Group(func(r chi.Router) {
				authzRoute(r, "GET", "/{scheduleID}", v1SessionHandler(app))
				authzRoute(r, "GET", "/{scheduleID}/static", v1StaticHandler(app))
				authzRoute(r, "POST", "/{scheduleID}/precheck", v1PrecheckHandler(app))
				authzRoute(r, "POST", "/{scheduleID}/bootstrap", v1BootstrapHandler(app))
			})
			r.With(limitTier(app, httpx.TierPolling, attemptKey())).Group(func(r chi.Router) {
				authzRoute(r, "GET", "/{scheduleID}/live", v1LiveHandler(app))
				// Plan C3: versioned runtime poll (the 1M enabler). 304 on
				// steady state; adaptive pollAfterSecs (2s fast-lane 60s
				// after control commands, 25s steady). Visibility bound:
				// control effects land within pollAfterSecs; write gates
				// enforce regardless of poll lag.
				authzRoute(r, "GET", "/{scheduleID}/runtime", runtimePollHandler(app))
			})
			r.With(limitTier(app, httpx.TierHeartbeat, attemptKey())).Group(func(r chi.Router) {
				authzRoute(r, "POST", "/{scheduleID}/heartbeat", v1HeartbeatHandler(app))
			})
			r.With(limitTier(app, httpx.TierWrites, attemptKey())).Group(func(r chi.Router) {
				authzRoute(r, "POST", "/{scheduleID}/mutations:batch", v1MutationHandler(app))
				authzRoute(r, "POST", "/{scheduleID}/audit", v1AuditHandler(app))
				authzRoute(r, "POST", "/{scheduleID}/submit", v1SubmitHandler(app))
			})
		})
		r.With(limitTier(app, httpx.TierAuthedReads, userKey())).With(adminLimit).Route("/proctor", func(r chi.Router) {
			authzRoute(r, "GET", "/sessions", proctorSessionsHandler(app))
			authzRoute(r, "GET", "/sessions/{scheduleID}", proctorSessionHandler(app))
			// Plan D4: paginated roster (?cursorUpdatedAt, ?cursorID,
			// ?limit, ?status). Additive; the full detail endpoint stays.
			authzRoute(r, "GET", "/sessions/{scheduleID}/roster", proctorRosterHandler(app))
			authzRoute(r, "GET", "/notes", proctorAllSessionNotesHandler(app))
			authzRoute(r, "DELETE", "/notes/{noteID}", proctorSessionNoteDeleteByIDHandler(app))
			authzRoute(r, "GET", "/sessions/{scheduleID}/notes", proctorSessionNotesListHandler(app))
			authzRoute(r, "POST", "/sessions/{scheduleID}/notes", proctorSessionNoteCreateHandler(app))
			authzRoute(r, "PUT", "/sessions/{scheduleID}/notes/{noteID}", proctorSessionNoteSaveHandler(app))
			authzRoute(r, "PATCH", "/sessions/{scheduleID}/notes/{noteID}", proctorSessionNoteSaveHandler(app))
			authzRoute(r, "DELETE", "/sessions/{scheduleID}/notes/{noteID}", proctorSessionNoteDeleteHandler(app))
			authzRoute(r, "GET", "/sessions/{scheduleID}/violation-rules", proctorViolationRulesListHandler(app))
			authzRoute(r, "DELETE", "/violation-rules/{ruleID}", proctorViolationRuleDeleteByIDHandler(app))
			authzRoute(r, "POST", "/sessions/{scheduleID}/violation-rules", proctorViolationRuleCreateHandler(app))
			authzRoute(r, "PUT", "/sessions/{scheduleID}/violation-rules/{ruleID}", proctorViolationRuleSaveHandler(app))
			authzRoute(r, "PATCH", "/sessions/{scheduleID}/violation-rules/{ruleID}", proctorViolationRuleSaveHandler(app))
			authzRoute(r, "DELETE", "/sessions/{scheduleID}/violation-rules/{ruleID}", proctorViolationRuleDeleteHandler(app))
			authzRoute(r, "POST", "/sessions/{scheduleID}/presence", withHeartbeatTier(app, proctorPresenceHandler(app)))
			authzRoute(r, "POST", "/sessions/{scheduleID}/control/end-section-now", proctorEndSectionHandler(app))
			authzRoute(r, "POST", "/sessions/{scheduleID}/control/extend-section", proctorExtendSectionHandler(app))
			authzRoute(r, "POST", "/sessions/{scheduleID}/control/complete-exam", proctorCompleteExamHandler(app))
			authzRoute(r, "POST", "/sessions/{scheduleID}/attempts/{attemptID}/warn", proctorWarnHandler(app))
			authzRoute(r, "POST", "/sessions/{scheduleID}/attempts/{attemptID}/pause", proctorPauseAttemptHandler(app))
			authzRoute(r, "POST", "/sessions/{scheduleID}/attempts/{attemptID}/resume", proctorResumeAttemptHandler(app))
			authzRoute(r, "POST", "/sessions/{scheduleID}/attempts/{attemptID}/extend", proctorExtendAttemptHandler(app))
			authzRoute(r, "POST", "/sessions/{scheduleID}/attempts/{attemptID}/terminate", proctorTerminateHandler(app))
			authzRoute(r, "POST", "/alerts/{alertID}/ack", proctorAckAlertHandler(app))
			authzRoute(r, "GET", "/live-mode", proctorLiveModeHandler(app))
		})
		r.With(limitTier(app, httpx.TierAuthedReads, userKey())).With(adminLimit).Route("/library", func(r chi.Router) {
			authzRoute(r, "GET", "/passages", libraryPassagesListHandler(app))
			authzRoute(r, "POST", "/passages", libraryPassageCreateHandler(app))
			authzRoute(r, "GET", "/passages/{id}", libraryPassageGetHandler(app))
			authzRoute(r, "PATCH", "/passages/{id}", libraryPassageUpdateHandler(app))
			authzRoute(r, "DELETE", "/passages/{id}", libraryPassageDeleteHandler(app))
			authzRoute(r, "POST", "/passages/{id}/increment-usage", libraryPassageIncrementUsageHandler(app))
			authzRoute(r, "PATCH", "/passages/{id}/increment-usage", libraryPassageIncrementUsageHandler(app))
			authzRoute(r, "GET", "/questions", libraryQuestionsListHandler(app))
			authzRoute(r, "POST", "/questions", libraryQuestionCreateHandler(app))
			authzRoute(r, "GET", "/questions/{id}", libraryQuestionGetHandler(app))
			authzRoute(r, "PATCH", "/questions/{id}", libraryQuestionUpdateHandler(app))
			authzRoute(r, "DELETE", "/questions/{id}", libraryQuestionDeleteHandler(app))
			authzRoute(r, "POST", "/questions/{id}/increment-usage", libraryQuestionIncrementUsageHandler(app))
			authzRoute(r, "PATCH", "/questions/{id}/increment-usage", libraryQuestionIncrementUsageHandler(app))
		})
		r.With(limitTier(app, httpx.TierAuthedReads, userKey())).With(adminLimit).Route("/settings", func(r chi.Router) {
			authzRoute(r, "GET", "/exam-defaults", settingsExamDefaultsGetHandler(app))
			authzRoute(r, "PUT", "/exam-defaults", settingsExamDefaultsPutHandler(app))
			authzRoute(r, "GET", "/export-profiles", settingsExportProfilesListHandler(app))
			authzRoute(r, "POST", "/export-profiles", settingsExportProfilesCreateHandler(app))
		})
		r.With(limitTier(app, httpx.TierAuthedReads, userKey())).With(adminLimit).Route("/grading", func(r chi.Router) {
			authzRoute(r, "GET", "/sessions", gradingSessionsHandler(app))
			authzRoute(r, "GET", "/sessions/{sessionID}", gradingSessionHandler(app))
			authzRoute(r, "GET", "/schedules/{scheduleID}/objective-overrides", gradingOverridesHandler(app))
			authzRoute(r, "GET", "/schedules/{scheduleID}/objective-grading-source", gradingSourceHandler(app))
			authzRoute(r, "GET", "/schedules/{scheduleID}/objective-integrity", gradingIntegrityHandler(app))
			authzRoute(r, "PUT", "/schedules/{scheduleID}/objective-overrides/{questionID}", gradingOverridePutHandler(app))
			authzRoute(r, "DELETE", "/schedules/{scheduleID}/objective-overrides/{questionID}", gradingOverrideDeleteHandler(app))
			authzRoute(r, "POST", "/schedules/{scheduleID}/objective-regrade-latest-draft", gradingRegradeHandler(app))
			authzRoute(r, "GET", "/submissions/{submissionID}", gradingSubmissionHandler(app))
			authzRoute(r, "GET", "/submissions/{submissionID}/sections", gradingSectionsHandler(app))
			authzRoute(r, "PUT", "/submissions/{submissionID}/sections/{section}/questions/{questionID}/override", gradingOverrideQuestionHandler(app))
			authzRoute(r, "GET", "/submissions/{submissionID}/writing-tasks", gradingWritingTasksHandler(app))
			authzRoute(r, "POST", "/export", gradingProfileExportHandler(app))
			authzRoute(r, "POST", "/submissions/{submissionID}/start-review", gradingStartReviewHandler(app))
			authzRoute(r, "GET", "/submissions/{submissionID}/review-draft", gradingReviewDraftGetHandler(app))
			authzRoute(r, "PUT", "/submissions/{submissionID}/review-draft", gradingReviewDraftPutHandler(app))
			authzRoute(r, "POST", "/submissions/{submissionID}/mark-grading-complete", gradingMarkCompleteHandler(app))
			authzRoute(r, "POST", "/submissions/{submissionID}/mark-ready-to-release", gradingMarkReadyHandler(app))
			authzRoute(r, "POST", "/submissions/{submissionID}/release-now", gradingReleaseNowHandler(app))
			authzRoute(r, "POST", "/submissions/{submissionID}/schedule-release", gradingScheduleReleaseHandler(app))
			authzRoute(r, "POST", "/submissions/{submissionID}/reopen-review", gradingReopenHandler(app))
			authzRoute(r, "GET", "/results/{resultID}/events", gradingResultEventsHandler(app))
		})
		r.With(limitTier(app, httpx.TierAuthedReads, userKey())).With(adminLimit).Route("/results", func(r chi.Router) {
			authzRoute(r, "GET", "/", resultsListHandler(app))
			authzRoute(r, "GET", "/dashboard", resultsDashboardHandler(app))
			authzRoute(r, "GET", "/analytics", resultsAnalyticsHandler(app))
			authzRoute(r, "POST", "/export", resultsExportHandler(app))
			// Deprecated compatibility alias for pre-parity Go profile clients.
			authzRoute(r, "POST", "/export-profile", gradingProfileExportHandler(app))
			authzRoute(r, "GET", "/sat", resultsSATListHandler(app))
			authzRoute(r, "GET", "/sat/{resultID}", resultsSATGetHandler(app))
			authzRoute(r, "GET", "/act-science", resultsACTScienceHandler(app))
			authzRoute(r, "GET", "/act-science/{attemptID}", resultsACTScienceDetailHandler(app))
			authzRoute(r, "GET", "/{resultID}/events", resultsEventsHandler(app))
			authzRoute(r, "GET", "/{resultID}", resultsGetHandler(app))
		})
		r.With(limitTier(app, httpx.TierWrites, userKey())).With(adminLimit).Route("/media", func(r chi.Router) {
			authzRoute(r, "POST", "/uploads", mediaUploadHandler(app))
			authzRoute(r, "POST", "/import-url", mediaImportURLHandler(app))
			authzRoute(r, "PUT", "/uploads/{assetID}", mediaUploadBytesHandler(app))
			authzRoute(r, "POST", "/uploads/{assetID}/complete", mediaCompleteHandler(app))
			authzRoute(r, "GET", "/assets/{assetID}", withAuthedReadsTier(app, mediaDownloadHandler(app)))
			authzRoute(r, "GET", "/{assetID}/content", withAuthedReadsTier(app, mediaDownloadContentHandler(app)))
			authzRoute(r, "GET", "/{assetID}", withAuthedReadsTier(app, mediaGetHandler(app)))
		})
		r.With(limitTier(app, httpx.TierAuthedReads, userKey())).With(adminLimit).Route("/answer-history", func(r chi.Router) {
			authzRoute(r, "GET", "/submissions/{submissionID}/overview", answerHistoryOverviewHandler(app))
			authzRoute(r, "GET", "/submissions/{submissionID}/targets/{targetID}", answerHistoryTargetDetailHandler(app))
			authzRoute(r, "GET", "/submissions/{submissionID}/export", answerHistoryExportHandler(app))
			authzRoute(r, "GET", "/attempts/{attemptID}/overview", answerHistoryOverviewByAttemptHandler(app))
			authzRoute(r, "GET", "/attempts/{attemptID}/targets/{targetID}", answerHistoryTargetDetailByAttemptHandler(app))
		})
		r.With(limitTier(app, httpx.TierAuthedReads, userKey())).Group(func(r chi.Router) {
			authzRoute(r, "GET", "/ws/live", liveWebSocketHandler(app))
			// Phase 03: SAT authoring realtime. Same tier as the runtime socket;
			// the handler applies the authoring read ACL before upgrading.
			authzRoute(r, "GET", "/ws/authoring", authoringRealtimeHandler(app))
		})
	})

	// V2 student response protocol (tight student tier).
	for _, prefix := range []string{"/api/v2", "/v2"} {
		prefix := prefix
		r.With(studentLimit).Route(prefix+"/student/attempts", func(r chi.Router) {
			r.With(limitTier(app, httpx.TierWrites, attemptKey())).Group(func(r chi.Router) {
				authzRoute(r, "POST", "/{attemptID}/responses:batch", v2BatchHandler(app))
				authzRoute(r, "POST", "/{attemptID}/submit", v2SubmitHandler(app))
				authzRoute(r, "POST", "/{attemptID}/takeover", v2TakeoverHandler(app))
			})
			r.With(limitTier(app, httpx.TierAuthedReads, attemptKey())).Group(func(r chi.Router) {
				authzRoute(r, "GET", "/{attemptID}/responses", v2SnapshotHandler(app))
			})
		})
	} // Private Hocuspocus -> Go surface. Same router, but these routes are
	// authenticated by the service signature only (the authz table marks them
	// public so the session layer passes through); a browser cannot reach them
	// because it never has AUTHORING_COEDIT_SERVICE_SECRET.
	r.With(httpx.BodyLimit(coeditPrivateMaxBodyBytes)).Route("/internal/authoring-coedit", func(r chi.Router) {
		r.Post("/load", authorize("POST /internal/authoring-coedit/load", coeditLoadHandler(app)))
		r.Post("/initialize", authorize("POST /internal/authoring-coedit/initialize", coeditInitializeHandler(app)))
		r.Post("/store", authorize("POST /internal/authoring-coedit/store", coeditStoreHandler(app)))
		r.Post("/final-store", authorize("POST /internal/authoring-coedit/final-store", coeditFinalStoreHandler(app)))
		r.Post("/rebase", authorize("POST /internal/authoring-coedit/rebase", coeditRebaseHandler(app)))
		r.Post("/recover", authorize("POST /internal/authoring-coedit/recover", coeditRecoverHandler(app)))
	})
	if app.Config.AuthoringCoeditProxyEnabled {
		// The browser-facing Hocuspocus socket shares the Go API's public port;
		// the child process itself remains bound to the container loopback.
		r.Get(coeditPublicProxyPath, coeditWebSocketProxy(app))
	}
	if frontendDir := strings.TrimSpace(app.Config.FrontendDistDir); frontendDir != "" {
		// Railway deploys the Vite bundle in this same image. Keep API-owned
		// paths on the JSON router while serving browser routes from the SPA.
		frontend := frontendHandler(frontendDir)
		route(r, http.MethodGet, "/", frontend)
		route(r, http.MethodGet, "/*", frontend)
		route(r, http.MethodHead, "/", frontend)
		route(r, http.MethodHead, "/*", frontend)
	}

	r.NotFound(func(w http.ResponseWriter, r *http.Request) {
		httpx.WriteError(w, r, apperrors.New(apperrors.CodeNotFound, "Route not found."))
	})
	mux := r
	r.MethodNotAllowed(func(w http.ResponseWriter, req *http.Request) {
		w.Header().Set("Allow", allowedMethodsFor(mux, req.URL.Path))
		httpx.WriteError(w, req, apperrors.New(apperrors.CodeMethodNotAllowed, "Method not allowed."))
	})
	return r
}

// buildTierSet wires the per-tier quotas for BuildRouter. Each tier gets its
// own distributed-counter namespace (route_key = tier name), so bulk traffic
// in one tier can never starve another. The backstop has no DB checker: it
// is a local-only abuse floor. A nil DB (tests without a pool) yields a
// local-only TierSet that still isolates tiers in-memory.
//
// Plan A1 (RATE_LIMIT_MODE): local skips wiring DB checkers entirely (zero
// per-request DB verdicts — single-deploy: local IS global); dual preserves
// today's wiring. buildTierSet also mirrors the mode onto the TierSet flag
// so tests and future admin endpoints can flip posture without rewiring.
func buildTierSet(app *App) {
	cfg := app.Config
	burst := cfg.RateLimitBurst
	if burst < 0 {
		burst = 0
	}
	// Plan E2: exam windows rebalance budgets toward submit/seal/autosave
	// (writes never shed) at the expense of poll/heartbeat/admin reads.
	// Off = ship budgets (rollback = flip + redeploy).
	perMin := config.ApplyShedMode(cfg.ShedMode, map[string]int{
		httpx.TierWrites:      cfg.RateLimitWritesPerMin,
		httpx.TierPolling:     cfg.RateLimitPollingPerMin,
		httpx.TierHeartbeat:   cfg.RateLimitHeartbeatPerMin,
		httpx.TierAuthedReads: cfg.RateLimitAuthedReadsPerMin,
	})
	perMin[httpx.TierAuthCritical] = cfg.RateLimitAuthCriticalPerMin
	perMin[httpx.TierAnonAuth] = cfg.RateLimitAnonAuthPerMin
	perMin[httpx.TierBackstop] = cfg.RateLimitBackstopPerMin
	budgets := httpx.TierBudgetsFromConfig(perMin, burst)
	dbs := map[string]httpx.DBChecker{}
	if app.DB != nil && !cfg.RateLimitLocalOnly() {
		for tier := range budgets {
			if tier == httpx.TierBackstop {
				continue
			}
			limiter := httpx.NewDBRateLimiter(app.DB, tier, budgets[tier].PerMin, time.Minute)
			dbs[tier] = limiter.Check
		}
	}
	maxKeys := cfg.RateLimitMaxKeys
	if maxKeys <= 0 {
		maxKeys = cfg.RateLimitBucketCap
	}
	if maxKeys <= 0 {
		maxKeys = 10000
	}
	app.Tiers = httpx.NewTierSet(budgets, dbs, maxKeys)
	app.Tiers.SetLocalOnly(cfg.RateLimitLocalOnly())
	// Plan E2 dashboard slice: denials served under exam budgets count
	// separately from ship-budget denials.
	httpx.SetShedExam(cfg.ShedMode == config.ShedExam)
}

// sessionUserLookup adapts SessionOf for tier keying without an import cycle
// (httpx cannot import main): authenticated cookie sessions key by user ID,
// anonymous requests fall back to IP inside the key func.
func sessionUserLookup(r *http.Request) (string, bool) {
	sess := SessionOf(r.Context())
	if sess == nil || sess.UserID == "" {
		return "", false
	}
	return sess.UserID, true
}

// limitTier is a chi group middleware applying one rate-limit tier.
func limitTier(app *App, tier string, keyFn httpx.KeyFunc) func(http.Handler) http.Handler {
	return app.Tiers.Middleware(tier, keyFn)
}

// withHeartbeatTier re-tiers a single handler inside an otherwise
// authed-reads group (e.g. proctor presence heartbeats).
func withHeartbeatTier(app *App, h http.HandlerFunc) http.HandlerFunc {
	mw := app.Tiers.Middleware(httpx.TierHeartbeat, userKey())
	return mw(h).ServeHTTP
}

// withAuthedReadsTier keeps cheap GETs in authed-reads inside an otherwise
// writes group (e.g. media downloads inside the media upload group).
func withAuthedReadsTier(app *App, h http.HandlerFunc) http.HandlerFunc {
	mw := app.Tiers.Middleware(httpx.TierAuthedReads, userKey())
	return mw(h).ServeHTTP
}

// userKey tiers authenticated traffic by user, anonymous by IP.
func userKey() httpx.KeyFunc {
	return httpx.UserOrIPKey(sessionUserLookup)
}

// attemptKey tiers student/attempt-bearer traffic by attempt hash, then user, then IP.
func attemptKey() httpx.KeyFunc {
	return httpx.AttemptOrUserOrIPKey(sessionUserLookup)
}

// ipKey tiers strictly anonymous endpoints (login, entry) by client IP.
func ipKey() httpx.KeyFunc {
	return httpx.ClientIPKey
}

// route registers one wired handler with its route-template annotation.
func route(r chi.Router, method, pattern string, h http.HandlerFunc) {
	r.Method(method, pattern, httpx.WithRoute(h, method+" "+pattern))
}

// allowedMethodsFor lists the registered methods for path by walking the
// route tree (WS-06b: 405 responses carry an Allow header per RFC 9110
// Section 15.5.6). Pattern segments in braces ({id}, {scheduleID}) match
// any single path segment; everything else compares literally. A 405 is a
// rare client error, so a per-405 walk is acceptable (never on hot paths).
// It returns "" when no route matches (caller still renders 405, just
// without a useful Allow value — never 404 from this path).
func allowedMethodsFor(r chi.Router, path string) string {
	seen := map[string]bool{}
	var ordered []string
	_ = chi.Walk(r, func(method, pattern string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		if !sameRouteShape(pattern, path) {
			return nil
		}
		if !seen[method] {
			seen[method] = true
			ordered = append(ordered, method)
		}
		return nil
	})
	sort.Strings(ordered)
	return strings.Join(ordered, ", ")
}

// sameRouteShape reports whether a chi route pattern (with {param}
// segments) matches a concrete request path.
func sameRouteShape(pattern, path string) bool {
	if pattern == path {
		return true
	}
	trimmedPattern := strings.Trim(pattern, "/")
	trimmedPath := strings.Trim(path, "/")
	if trimmedPattern == "" || trimmedPath == "" {
		return trimmedPattern == trimmedPath
	}
	patternSegs := strings.Split(trimmedPattern, "/")
	pathSegs := strings.Split(trimmedPath, "/")
	if len(patternSegs) != len(pathSegs) {
		return false
	}
	for i, ps := range patternSegs {
		if len(ps) >= 2 && ps[0] == '{' && ps[len(ps)-1] == '}' {
			if pathSegs[i] == "" {
				return false
			}
			continue
		}
		if ps != pathSegs[i] {
			return false
		}
	}
	return true
}

// metricsHandler gates the Prometheus exposition (WS-10a): public only
// when METRICS_PUBLIC=1, otherwise bearer-gated on METRICS_TOKEN. Denials
// render the stable 403 envelope and log the scrape source without ever
// logging the token (fail closed; missing/empty token config denies all).
func metricsHandler(app *App) http.HandlerFunc {
	inner := telemetry.DefaultRegistry.Handler()
	return func(w http.ResponseWriter, r *http.Request) {
		if app != nil && app.Config.MetricsPublic {
			inner.ServeHTTP(w, r)
			return
		}
		configured := ""
		if app != nil {
			configured = app.Config.MetricsToken
		}
		got := ""
		if auth := r.Header.Get("Authorization"); strings.HasPrefix(auth, "Bearer ") {
			got = strings.TrimPrefix(auth, "Bearer ")
		}
		if configured == "" || got == "" || subtle.ConstantTimeCompare([]byte(got), []byte(configured)) != 1 {
			log.Printf(`{"level":"warn","msg":"metrics scrape denied","remote":%q}`, r.RemoteAddr)
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeForbidden, "Metrics are not publicly exposed."))
			return
		}
		inner.ServeHTTP(w, r)
	}
}

// healthz is the liveness probe: alive, no dependencies (never touches DB).
func healthz(_ *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		httpx.WriteJSON(w, http.StatusOK, map[string]any{
			"status":    "ok",
			"requestId": httpx.RequestIDOf(w, r),
		})
	}
}

// readyz is the readiness probe: DB ping + schema version, both under a
// bounded budget (plan E1). A wedged MySQL must fail the probe fast so
// the orchestrator restarts/reroutes instead of piling up handlers.
func readyz(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if app.DB == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Database not configured."))
			return
		}
		ctx, cancel := QueryContext(r, 5*time.Second)
		defer cancel()
		if err := app.DB.PingContext(ctx); err != nil {
			httpx.WriteError(w, r, MapDBError(err))
			return
		}
		version, err := db.SchemaVersion(ctx, app.DB)
		if err != nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Schema version unknown."))
			return
		}
		// Plan E3/§7: pool gauges with role label (API/worker split is
		// queryable; single-pool callers report role=single).
		db.ReportPoolStats(db.RoleAPI, app.DB.Stats())
		httpx.WriteJSON(w, http.StatusOK, map[string]any{
			"status":        "ready",
			"database":      "ready",
			"schemaVersion": version,
			"requestId":     httpx.RequestIDOf(w, r),
		})
	}
}

// authMiddleware loads the session cookie actor when present and annotates
// the request (actor class for access logs + session for downstream CSRF).
// Unknown/expired sessions stay anonymous here; per-route authorization
// (require_one_of at the data boundary) enforces access once handlers land.
func authMiddleware(app *App) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx := r.Context()
			if app.DB == nil {
				next.ServeHTTP(w, r.WithContext(context.WithValue(ctx, httpx.CtxActorClass, "anonymous")))
				return
			}
			cookie, err := r.Cookie(app.Config.EffectiveSessionCookieName())
			if err != nil || cookie.Value == "" {
				next.ServeHTTP(w, r.WithContext(context.WithValue(ctx, httpx.CtxActorClass, "anonymous")))
				return
			}
			resolver := app.SessionResolver
			if resolver == nil {
				resolver = defaultSessionResolver
			}
			sess, err := resolver(ctx, app.DB, app.SessionCache, app.Config, cookie.Value, time.Now().UTC())
			if err != nil {
				// DB failure must not authenticate nor masquerade as
				// anonymous (which downstream maps to 401): report 503
				// SERVICE_UNAVAILABLE so clients retry instead of
				// re-authenticating against a down database.
				log.Printf("api: session lookup failed: %v", err)
				httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Session store is unavailable."))
				return
			}
			if sess == nil {
				next.ServeHTTP(w, r.WithContext(context.WithValue(ctx, httpx.CtxActorClass, "anonymous")))
				return
			}
			ctx = context.WithValue(ctx, httpx.CtxActorClass, sess.Role)
			ctx = context.WithValue(ctx, sessionCtxKey, sess)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

type ctxKey string

const sessionCtxKey ctxKey = "session"

// SessionOf returns the authenticated session annotated by authMiddleware,
// or nil for anonymous requests.
func SessionOf(ctx context.Context) *auth.Session {
	if s, ok := ctx.Value(sessionCtxKey).(*auth.Session); ok {
		return s
	}
	return nil
}

// csrfMiddleware enforces cookie + x-csrf-token binding with origin check
// for state-changing methods on authenticated sessions (403 CSRF_REJECTED
// on mismatch). Anonymous requests pass through to per-route
// authorization, which fails closed once handlers land.
func csrfMiddleware(_ *App) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			switch r.Method {
			case http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete:
			// enforced below
			default:
				next.ServeHTTP(w, r)
				return
			}
			sess := SessionOf(r.Context())
			if sess == nil {
				next.ServeHTTP(w, r)
				return
			}
			if err := auth.VerifyCSRF(r, sess.CSRFToken); err != nil {
				httpx.WriteError(w, r, err)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// authzSessionOf adapts SessionOf for authz.Middleware: authz cannot
// import cmd/api (cycle) and stays dependency-free (stdlib only), so the
// caller injects session resolution here. It runs after authMiddleware,
// so the session is already loaded and cached on the request context.
func authzSessionOf(r *http.Request) (string, string, bool) {
	sess := SessionOf(r.Context())
	if sess == nil || sess.UserID == "" {
		return "", "", false
	}
	return sess.UserID, sess.Role, true
}

// init bridges the authz template key to httpx.CtxRouteTemplate once so
// the middleware can read route() annotations without importing httpx
// from the authz package (which must stay dependency-free).
func init() {
	authz.TemplateKey = httpx.CtxRouteTemplate
}
