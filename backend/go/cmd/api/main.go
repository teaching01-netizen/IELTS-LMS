// Command api serves the IELTS proctoring HTTP API (chi router).
//
// Wiring: config.Load + ValidateForRuntime, db.Open, tx.Runner, BuildApp,
// chi router with /healthz /readyz + /api/v1/* + /api/v2/*, middleware in
// spec order, and graceful shutdown via platform/shutdown (stop HTTP,
// drain 30s, close pool).
package main

import (
	"context"
	"database/sql"
	"log"
	"net/http"
	"sync"
	"time"

	"example.com/ielts-proctoring/internal/accesslinks"
	"example.com/ielts-proctoring/internal/act"
	"example.com/ielts-proctoring/internal/answerhistory"
	"example.com/ielts-proctoring/internal/attempts"
	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/authoring"
	"example.com/ielts-proctoring/internal/delivery"
	"example.com/ielts-proctoring/internal/exams"
	"example.com/ielts-proctoring/internal/grading"
	"example.com/ielts-proctoring/internal/library"
	"example.com/ielts-proctoring/internal/liveupdates"
	"example.com/ielts-proctoring/internal/media"
	"example.com/ielts-proctoring/internal/outbox"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/clock"
	"example.com/ielts-proctoring/internal/platform/config"
	"example.com/ielts-proctoring/internal/platform/crypto"
	"example.com/ielts-proctoring/internal/platform/db"
	"example.com/ielts-proctoring/internal/platform/httpx"
	"example.com/ielts-proctoring/internal/platform/objectstore"
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

// App is the interface-free composition root. Domain services hang off
// this struct explicitly (no globals); handlers nil-check only for
// dependency outages and return the stable 503 envelope when required.
type App struct {
	Config          config.Config
	DB              *sql.DB
	Tx              *tx.Runner
	Limiter         *httpx.BucketStore
	Tiers           *httpx.TierSet
	Attempts        *attempts.Service
	Exams           *exams.Service
	Schedules       *schedules.Service
	Student         *student.Service
	Proctor         *proctor.Service
	Grading         *grading.Service
	Results         *results.Service
	Media           *media.Service
	Library         *library.Service
	AnswerHistory   *answerhistory.Service
	Authoring       *authoring.Service
	AccessLinks     *accesslinks.Service
	SAT             *sat.Service
	ACT             *act.Service
	Delivery        *delivery.Service
	Release         *release.Service
	Runtime         *runtime.Service
	Terminal        *terminalization.Service
	LiveBus         *liveupdates.Bus
	LiveHub         *liveupdates.Hub
	Leases          *liveupdates.LeaseRepository
	// Admission is the plan-C2 in-memory WS gate. Always non-nil (db mode
	// leaves it unused; memory mode serves acquires with zero SQL).
	Admission *liveupdates.Admission
	Outbox          *outbox.Repository
	Secret          []byte
	LiveForwardOnce sync.Once
	// SessionCache is the plan-A2 in-process session LRU. Always non-nil
	// (disabled cache = never stores, never hits = today's behavior).
	// Wired in BuildApp so authMiddleware serves hits with zero SQL.
	SessionCache *auth.SessionCache
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
func (a *App) RuntimeLockerFor() attempts.RuntimeLocker {
	if a != nil && a.Config.RuntimeSnapshotEnabled && a.DB != nil && a.RuntimeSnapshots != nil {
		return snapshotLocker{db: a.DB, cache: a.RuntimeSnapshots}
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
	cap := cfg.RateLimitBucketCap
	if cap <= 0 {
		cap = 10000
	}
	app := &App{Config: cfg, DB: pool, Limiter: httpx.NewBucketStore(cap), SessionCache: auth.NewSessionCache(auth.SessionCacheConfig{
		Enabled:           cfg.SessionCacheEnabled,
		MaxEntries:        cfg.SessionCacheMax,
		TouchCoalesceSecs: cfg.SessionTouchCoalesce(),
	}), RuntimeSnapshots: runtime.NewSnapshotCache(runtime.SnapshotTTL),
		// Plan D1: always non-nil (off = present-but-unused, today's N+1
		// path untouched). Wired into Delivery when VERSION_CACHE=on.
		Versions: delivery.NewVersionCache(delivery.VersionCacheMaxVersions),
		// Plan D3: always non-nil (off = present-but-unused). Wired from
		// ENTRY_PER_SEC_PER_SCHEDULE/ENTRY_BURST (clamped in config).
		EntryGate: newEntryGate(entryGateConfig{PerSec: cfg.EntryPerSec, Burst: cfg.EntryBurst})}
	if pool != nil {
		app.Tx = tx.NewRunner(pool)
		secret := []byte(cfg.AuthSecret)
		app.Secret = secret
		outbx := outbox.NewRepository(pool)
		app.Outbox = outbx
		app.Terminal = terminalization.NewService(app.Tx, nil, nil).SetOutboxExecOnly(cfg.OutboxExecOnly)
		app.Attempts = attempts.NewService(app.Tx, clock.System{}, secret).SetRowFirst(cfg.RowFirstWrites)
		app.Exams = exams.NewService(pool, app.Tx)
		app.Schedules = schedules.NewService(pool, app.Tx)
		app.Student = student.NewService(pool, nil).SetRowFirst(cfg.RowFirstWrites)
		// Plan D2: memory presence (off/inline = untouched per-beat tx).
		if cfg.PresenceMemory() {
			app.Student.SetPresence(student.NewPresenceMap(student.DefaultPresenceTTL))
		}
		assign := proctor.SQLAssignmentChecker{}
		app.Proctor = proctor.NewService(app.Tx, pool, app.Terminal, nil, assign).SetOutboxExecOnly(cfg.OutboxExecOnly)
		app.Grading = grading.NewService(pool, app.Tx)
		app.Results = results.NewService(pool)
		app.Media = media.NewService(pool, app.Tx, objectstore.NewLocalStore(cfg.ObjectStorageLocalRoot))
		app.Library = library.NewService(pool, app.Tx)
		app.AnswerHistory = answerhistory.NewService(pool)
		app.Authoring = authoring.NewService(pool, app.Tx)
		app.AccessLinks = accesslinks.NewService(pool, app.Tx)
		app.SAT = sat.NewService(pool, app.Tx, clock.System{}, nil)
		app.ACT = act.NewService(pool, app.Tx)
		app.Terminal.SetAttemptScorer(app.ACT)
		app.Release = release.NewService(pool)
		app.Runtime = runtime.NewService(app.Tx, nil).SetOutboxExecOnly(cfg.OutboxExecOnly).SetSnapshotCache(app.RuntimeSnapshots)
		// Each API process needs a distinct bus origin so the forwarder can
		// distinguish local post-commit fanout from events written by peers.
		app.LiveBus = liveupdates.NewBus(pool, uuid.NewString())
		app.LiveHub = liveupdates.NewHub()
		deliverySvc := delivery.NewService(pool, app.Tx).SetLive(app.LiveBus.Origin(), app.LiveHub).SetLiveDirect(cfg.IsDirect()).SetLiveSink(app.LiveBus, cfg.LiveBusSink)
		if cfg.VersionCacheEnabled {
			deliverySvc.SetVersionCache(app.Versions)
		}
		app.Delivery = deliverySvc.SetCompleter(func(ctx context.Context, scheduleID, attemptID string) error {
			var providerKey string
			if err := pool.QueryRowContext(ctx, "SELECT e.provider_key FROM student_attempts a JOIN exam_entities e ON e.id = a.exam_id WHERE a.id = ? AND a.schedule_id = ?", attemptID, scheduleID).Scan(&providerKey); err != nil {
				return err
			}
			switch providerKey {
			case "sat":
				return app.SAT.ReconcileAdapter()(ctx, scheduleID, attemptID)
			case "act":
				_, err := app.Terminal.Terminalize(ctx, terminalization.SealCommand{
					AttemptID: attemptID, ScheduleID: scheduleID,
					Outcome: terminalization.OutcomeTerminated, Reason: terminalization.ReasonTimeExpired,
					ActorKind: terminalization.ActorSystem,
					RequestID: "timeout-" + attemptID,
				})
				return err
			default:
				return nil
			}
		})
		app.Leases = liveupdates.NewLeaseRepository(pool)
		app.Admission = liveupdates.NewAdmission(liveupdates.AdmissionCaps{
			Total:       cfg.WSCapTotal,
			PerUser:     cfg.WSCapUser,
			PerSchedule: cfg.WSCapSchedule,
			TTL:         liveupdates.LeaseTTL,
		})
	}
	return app
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
	// Plan E3: report absorbed tx transients on db_deadlocks_total{kind}.
	defer installTxRetryHook()()
	srvCfg := httpx.DefaultServerConfig()
	srv := &http.Server{
		Addr:              cfg.Addr(),
		Handler:           BuildRouter(app),
		ReadHeaderTimeout: srvCfg.ReadHeaderTimeout, // 5s
		ReadTimeout:       srvCfg.ReadTimeout,       // 15s
		WriteTimeout:      srvCfg.WriteTimeout,      // 30s
		IdleTimeout:       srvCfg.IdleTimeout,       // 120s
		MaxHeaderBytes:    srvCfg.MaxHeaderBytes,    // 1MB
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
//	auth > CSRF > rate limit (tiers) > authorization > handler > access log
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

	r.Use(httpx.Recovery)
	r.Use(httpx.RequestID)
	r.Use(httpx.Trace)
	r.Use(httpx.SecurityHeaders)
	// Global ceiling is the largest tier (workbook 64MiB); tighter tiers
	// re-wrap per group below (a smaller inner cap always wins).
	r.Use(httpx.BodyLimit(httpx.MaxWorkbookBodyBytes))
	r.Use(authMiddleware(app))
	r.Use(csrfMiddleware(app))
	// Loose local-only backstop across all traffic (abuse floor). It never
	// touches the distributed counters, so it cannot couple tiers together;
	// per-tier quotas below are each independently authoritative.
	r.Use(app.Tiers.Middleware(httpx.TierBackstop, httpx.ClientIPKey))
	r.Use(authorizationPlaceholder)
	r.Use(httpx.AccessLog)

	r.Get("/healthz", healthz(app))
	r.Get("/readyz", readyz(app))
	r.Get("/metrics", telemetry.DefaultRegistry.Handler())

	studentLimit := httpx.BodyLimit(httpx.MaxStudentBodyBytes) // 256KiB
	adminLimit := httpx.BodyLimit(httpx.MaxAdminBodyBytes)     // 2MiB

	r.Route("/api/v1", func(r chi.Router) {
		// Auth routes split by cost class: session/logout reads get a generous
		// per-user quota isolated from bulk traffic (unrelated polling can
		// never starve session bootstrap), while credential-bearing attempts
		// stay on a strict per-IP quota (abuse surface).
		r.With(adminLimit).Route("/auth", func(r chi.Router) {
			r.With(limitTier(app, httpx.TierAuthCritical, userKey())).Group(func(r chi.Router) {
				route(r, "GET", "/session", sessionHandler(app))
				route(r, "POST", "/logout", logoutHandler(app))
				route(r, "POST", "/logout-all", logoutAllHandler(app))
			})
			r.With(limitTier(app, httpx.TierAnonAuth, ipKey())).Group(func(r chi.Router) {
				route(r, "POST", "/login", loginHandler(app))
				route(r, "POST", "/student/entry", studentEntryHandler(app))
				route(r, "GET", "/student/schedules/{id}", studentEntryScheduleHandler(app))
				route(r, "POST", "/activate", activateHandler(app))
				route(r, "POST", "/password/reset-request", passwordResetRequestHandler(app))
				route(r, "POST", "/password/reset-complete", passwordResetCompleteHandler(app))
			})
		})
		r.With(limitTier(app, httpx.TierAnonAuth, ipKey())).Group(func(r chi.Router) {
			route(r, "POST", "/public/access-links/{linkID}/resolve-entry", publicLinkResolveEntry(app))
		})
		r.With(limitTier(app, httpx.TierAuthedReads, userKey())).With(adminLimit).Route("/exams", func(r chi.Router) {
			route(r, "GET", "/", examsListHandler(app))
			route(r, "POST", "/", examsCreateHandler(app))
			route(r, "GET", "/{id}", examsGetHandler(app))
			route(r, "PATCH", "/{id}", examsUpdateHandler(app))
			route(r, "DELETE", "/{id}", examsDeleteHandler(app))
			route(r, "PATCH", "/{id}/draft", examsDraftHandler(app))
			route(r, "POST", "/{id}/draft/reopen", examsDraftReopenHandler(app))
			route(r, "POST", "/{id}/publish", examsPublishHandler(app))
			route(r, "GET", "/{id}/events", examsEventsHandler(app))
			route(r, "GET", "/{id}/validation", examsValidationHandler(app))
			route(r, "GET", "/{id}/versions", examsVersionsHandler(app))
			route(r, "GET", "/{id}/versions/summary", examsVersionSummariesHandler(app))
		})
		r.With(limitTier(app, httpx.TierAuthedReads, userKey())).With(adminLimit).Route("/assessment-access", func(r chi.Router) {
			route(r, "GET", "/exams/{examID}/overview", accessLinkOverview(app))
			route(r, "GET", "/exams/{examID}/links", examLinksList(app))
			route(r, "POST", "/exams/{examID}/links", examLinkCreate(app))
			route(r, "GET", "/links/{linkID}", linkGet(app))
			route(r, "PATCH", "/links/{linkID}", linkUpdate(app))
			route(r, "POST", "/links/{linkID}/lifecycle", linkLifecycle(app))
			route(r, "POST", "/links/{linkID}/duplicate", linkDuplicate(app))
			route(r, "GET", "/links/{linkID}/members", linkMembers(app))
			route(r, "GET", "/links/{linkID}/activity", linkActivity(app))
		})
		r.With(limitTier(app, httpx.TierAnonAuth, ipKey())).Group(func(r chi.Router) {
			route(r, "GET", "/public/access-links/{linkID}", publicLinkGet(app))
		})
		r.With(limitTier(app, httpx.TierAuthedReads, userKey())).With(adminLimit).Get("/assessment-release/exams/{examID}", releaseStateHandler(app))
		r.With(limitTier(app, httpx.TierWrites, userKey())).Route("/assessment-authoring", func(r chi.Router) {
			r.With(adminLimit).Get("/exams/{examID}/shell", authorShellHandler(app))
			r.With(adminLimit).Post("/exams/{examID}/shell", authorOpenShellHandler(app))
			r.With(adminLimit).Get("/exams/{examID}/preview", authorPreviewHandler(app))
			r.With(adminLimit).Post("/exams/{examID}/load-sample", authorSampleHandler(app))
			r.With(adminLimit).Get("/exams/{examID}/sat-workbook-template", authorSatWorkbookTemplateHandler(app))
			// Workbook import tiers keep the 64MiB global ceiling.
			route(r, "POST", "/exams/{examID}/sat-workbook-preview", authorPreviewImportHandler(app))
			route(r, "POST", "/exams/{examID}/sat-workbook-commit", authorCommitImportHandler(app))
			r.With(adminLimit).Get("/exams/{examID}/sat-workbook-undo", authorUndoStateHandler(app))
			r.With(adminLimit).Post("/exams/{examID}/sat-workbook-imports/{importID}/undo", authorUndoImportHandler(app))
			r.With(adminLimit).Get("/modules/{moduleID}/questions", authorListQuestionsHandler(app))
			r.With(adminLimit).Post("/modules/{moduleID}/questions", authorCreateQuestionHandler(app))
			r.With(adminLimit).Post("/modules/{moduleID}/questions/batch", authorBatchQuestionsHandler(app))
			r.With(adminLimit).Patch("/modules/{moduleID}/question-order", authorReorderHandler(app))
			r.With(adminLimit).Get("/exam-questions/{examQuestionID}", authorGetQuestionHandler(app))
			r.With(adminLimit).Patch("/exam-questions/{examQuestionID}", authorUpdateQuestionHandler(app))
			r.With(adminLimit).Delete("/exam-questions/{examQuestionID}", authorDeleteQuestionHandler(app))
			r.With(adminLimit).Post("/exam-questions/{examQuestionID}/duplicate", authorDuplicateHandler(app))
			r.With(adminLimit).Post("/questions/bulk", authorBulkHandler(app))
			r.With(adminLimit).Patch("/question-revisions/{revisionID}", authorSaveRevisionHandler(app))
			r.With(adminLimit).Patch("/exams/{examID}/sections/{sectionID}/delivery-settings", authorDeliverySettingsHandler(app))
			r.With(adminLimit).Post("/exams/{examID}/validate", authorValidateHandler(app))
		})
		r.With(limitTier(app, httpx.TierWrites, attemptKey())).With(studentLimit).Route("/assessment-delivery", func(r chi.Router) {
			route(r, "POST", "/schedules/{scheduleID}/bootstrap", deliveryBootstrapHandler(app))
			route(r, "PATCH", "/schedules/{scheduleID}/responses/{examQuestionID}", deliverySaveResponseHandler(app))
			route(r, "POST", "/schedules/{scheduleID}/modules/start", deliveryStartModuleHandler(app))
			route(r, "POST", "/schedules/{scheduleID}/modules/submit", deliverySubmitModuleHandler(app))
			route(r, "POST", "/schedules/{scheduleID}/submit", deliverySubmitAssessmentHandler(app))
		})
		r.With(limitTier(app, httpx.TierAuthedReads, userKey())).Group(func(r chi.Router) {
			route(r, "GET", "/versions/{versionID}", versionSummaryHandler(app))
		})
		r.With(limitTier(app, httpx.TierAuthedReads, userKey())).With(adminLimit).Route("/schedules", func(r chi.Router) {
			route(r, "GET", "/", schedulesListHandler(app))
			route(r, "POST", "/", schedulesCreateHandler(app))
			route(r, "GET", "/{id}", schedulesGetHandler(app))
			route(r, "PATCH", "/{id}", schedulesUpdateHandler(app))
			route(r, "DELETE", "/{id}", schedulesDeleteHandler(app))
			route(r, "GET", "/{id}/runtime", schedulesRuntimeHandler(app))
			route(r, "POST", "/{id}/runtime/commands", schedulesRuntimeCommandHandler(app))
			route(r, "POST", "/{id}/register", schedulesRegisterHandler(app))
		})
		// Student sessions split by cost class: session/static reads stay in
		// authed-reads, the polled live view gets its own polling budget,
		// heartbeats get a cheap high-frequency budget, and mutations/submits
		// are writes — so no student traffic class can starve the others.
		r.With(studentLimit).Route("/student/sessions", func(r chi.Router) {
			r.With(limitTier(app, httpx.TierAuthedReads, attemptKey())).Group(func(r chi.Router) {
				route(r, "GET", "/{scheduleID}", v1SessionHandler(app))
				route(r, "GET", "/{scheduleID}/static", v1StaticHandler(app))
				route(r, "POST", "/{scheduleID}/precheck", v1PrecheckHandler(app))
				route(r, "POST", "/{scheduleID}/bootstrap", v1BootstrapHandler(app))
			})
			r.With(limitTier(app, httpx.TierPolling, attemptKey())).Group(func(r chi.Router) {
				route(r, "GET", "/{scheduleID}/live", v1LiveHandler(app))
				// Plan C3: versioned runtime poll (the 1M enabler). 304 on
				// steady state; adaptive pollAfterSecs (2s fast-lane 60s
				// after control commands, 25s steady). Visibility bound:
				// control effects land within pollAfterSecs; write gates
				// enforce regardless of poll lag.
				route(r, "GET", "/{scheduleID}/runtime", runtimePollHandler(app))
			})
			r.With(limitTier(app, httpx.TierHeartbeat, attemptKey())).Group(func(r chi.Router) {
				route(r, "POST", "/{scheduleID}/heartbeat", v1HeartbeatHandler(app))
			})
			r.With(limitTier(app, httpx.TierWrites, attemptKey())).Group(func(r chi.Router) {
				r.Method("POST", "/{scheduleID}/mutations:batch", httpx.WithRoute(v1MutationHandler(app), "POST /{scheduleID}/mutations:batch"))
				route(r, "POST", "/{scheduleID}/audit", v1AuditHandler(app))
				r.Method("POST", "/{scheduleID}/submit", httpx.WithRoute(v1SubmitHandler(app), "POST /{scheduleID}/submit"))
			})
		})
		r.With(limitTier(app, httpx.TierAuthedReads, userKey())).With(adminLimit).Route("/proctor", func(r chi.Router) {
			route(r, "GET", "/sessions", proctorSessionsHandler(app))
			route(r, "GET", "/sessions/{scheduleID}", proctorSessionHandler(app))
			// Plan D4: paginated roster (?cursorUpdatedAt, ?cursorID,
			// ?limit, ?status). Additive; the full detail endpoint stays.
			route(r, "GET", "/sessions/{scheduleID}/roster", proctorRosterHandler(app))
			route(r, "GET", "/notes", proctorAllSessionNotesHandler(app))
			route(r, "DELETE", "/notes/{noteID}", proctorSessionNoteDeleteByIDHandler(app))
			route(r, "GET", "/sessions/{scheduleID}/notes", proctorSessionNotesListHandler(app))
			route(r, "POST", "/sessions/{scheduleID}/notes", proctorSessionNoteCreateHandler(app))
			route(r, "PUT", "/sessions/{scheduleID}/notes/{noteID}", proctorSessionNoteSaveHandler(app))
			route(r, "PATCH", "/sessions/{scheduleID}/notes/{noteID}", proctorSessionNoteSaveHandler(app))
			route(r, "DELETE", "/sessions/{scheduleID}/notes/{noteID}", proctorSessionNoteDeleteHandler(app))
			route(r, "GET", "/sessions/{scheduleID}/violation-rules", proctorViolationRulesListHandler(app))
			route(r, "DELETE", "/violation-rules/{ruleID}", proctorViolationRuleDeleteByIDHandler(app))
			route(r, "POST", "/sessions/{scheduleID}/violation-rules", proctorViolationRuleCreateHandler(app))
			route(r, "PUT", "/sessions/{scheduleID}/violation-rules/{ruleID}", proctorViolationRuleSaveHandler(app))
			route(r, "PATCH", "/sessions/{scheduleID}/violation-rules/{ruleID}", proctorViolationRuleSaveHandler(app))
			route(r, "DELETE", "/sessions/{scheduleID}/violation-rules/{ruleID}", proctorViolationRuleDeleteHandler(app))
			route(r, "POST", "/sessions/{scheduleID}/presence", withHeartbeatTier(app, proctorPresenceHandler(app)))
			route(r, "POST", "/sessions/{scheduleID}/control/end-section-now", proctorEndSectionHandler(app))
			route(r, "POST", "/sessions/{scheduleID}/control/extend-section", proctorExtendSectionHandler(app))
			route(r, "POST", "/sessions/{scheduleID}/control/complete-exam", proctorCompleteExamHandler(app))
			route(r, "POST", "/sessions/{scheduleID}/attempts/{attemptID}/warn", proctorWarnHandler(app))
			route(r, "POST", "/sessions/{scheduleID}/attempts/{attemptID}/pause", proctorPauseAttemptHandler(app))
			route(r, "POST", "/sessions/{scheduleID}/attempts/{attemptID}/resume", proctorResumeAttemptHandler(app))
			route(r, "POST", "/sessions/{scheduleID}/attempts/{attemptID}/extend", proctorExtendAttemptHandler(app))
			route(r, "POST", "/sessions/{scheduleID}/attempts/{attemptID}/terminate", proctorTerminateHandler(app))
			route(r, "POST", "/alerts/{alertID}/ack", proctorAckAlertHandler(app))
			route(r, "GET", "/live-mode", proctorLiveModeHandler(app))
		})
		r.With(limitTier(app, httpx.TierAuthedReads, userKey())).With(adminLimit).Route("/library", func(r chi.Router) {
			route(r, "GET", "/passages", libraryPassagesListHandler(app))
			route(r, "POST", "/passages", libraryPassageCreateHandler(app))
			route(r, "GET", "/passages/{id}", libraryPassageGetHandler(app))
			route(r, "PATCH", "/passages/{id}", libraryPassageUpdateHandler(app))
			route(r, "DELETE", "/passages/{id}", libraryPassageDeleteHandler(app))
			route(r, "POST", "/passages/{id}/increment-usage", libraryPassageIncrementUsageHandler(app))
			route(r, "PATCH", "/passages/{id}/increment-usage", libraryPassageIncrementUsageHandler(app))
			route(r, "GET", "/questions", libraryQuestionsListHandler(app))
			route(r, "POST", "/questions", libraryQuestionCreateHandler(app))
			route(r, "GET", "/questions/{id}", libraryQuestionGetHandler(app))
			route(r, "PATCH", "/questions/{id}", libraryQuestionUpdateHandler(app))
			route(r, "DELETE", "/questions/{id}", libraryQuestionDeleteHandler(app))
			route(r, "POST", "/questions/{id}/increment-usage", libraryQuestionIncrementUsageHandler(app))
			route(r, "PATCH", "/questions/{id}/increment-usage", libraryQuestionIncrementUsageHandler(app))
		})
		r.With(limitTier(app, httpx.TierAuthedReads, userKey())).With(adminLimit).Route("/settings", func(r chi.Router) {
			route(r, "GET", "/exam-defaults", settingsExamDefaultsGetHandler(app))
			route(r, "PUT", "/exam-defaults", settingsExamDefaultsPutHandler(app))
			route(r, "GET", "/export-profiles", settingsExportProfilesListHandler(app))
			route(r, "POST", "/export-profiles", settingsExportProfilesCreateHandler(app))
		})
		r.With(limitTier(app, httpx.TierAuthedReads, userKey())).With(adminLimit).Route("/grading", func(r chi.Router) {
			route(r, "GET", "/sessions", gradingSessionsHandler(app))
			route(r, "GET", "/sessions/{sessionID}", gradingSessionHandler(app))
			route(r, "GET", "/schedules/{scheduleID}/objective-overrides", gradingOverridesHandler(app))
			route(r, "GET", "/schedules/{scheduleID}/objective-grading-source", gradingSourceHandler(app))
			route(r, "GET", "/schedules/{scheduleID}/objective-integrity", gradingIntegrityHandler(app))
			route(r, "PUT", "/schedules/{scheduleID}/objective-overrides/{questionID}", gradingOverridePutHandler(app))
			route(r, "DELETE", "/schedules/{scheduleID}/objective-overrides/{questionID}", gradingOverrideDeleteHandler(app))
			route(r, "POST", "/schedules/{scheduleID}/objective-regrade-latest-draft", gradingRegradeHandler(app))
			route(r, "GET", "/submissions/{submissionID}", gradingSubmissionHandler(app))
			route(r, "GET", "/submissions/{submissionID}/sections", gradingSectionsHandler(app))
			route(r, "PUT", "/submissions/{submissionID}/sections/{section}/questions/{questionID}/override", gradingOverrideQuestionHandler(app))
			route(r, "GET", "/submissions/{submissionID}/writing-tasks", gradingWritingTasksHandler(app))
			route(r, "POST", "/submissions/{submissionID}/start-review", gradingStartReviewHandler(app))
			route(r, "GET", "/submissions/{submissionID}/review-draft", gradingReviewDraftGetHandler(app))
			route(r, "PUT", "/submissions/{submissionID}/review-draft", gradingReviewDraftPutHandler(app))
			route(r, "POST", "/submissions/{submissionID}/mark-grading-complete", gradingMarkCompleteHandler(app))
			route(r, "POST", "/submissions/{submissionID}/mark-ready-to-release", gradingMarkReadyHandler(app))
			route(r, "POST", "/submissions/{submissionID}/release-now", gradingReleaseNowHandler(app))
			route(r, "POST", "/submissions/{submissionID}/schedule-release", gradingScheduleReleaseHandler(app))
			route(r, "POST", "/submissions/{submissionID}/reopen-review", gradingReopenHandler(app))
			route(r, "GET", "/results/{resultID}/events", gradingResultEventsHandler(app))
		})
		r.With(limitTier(app, httpx.TierAuthedReads, userKey())).With(adminLimit).Route("/results", func(r chi.Router) {
			route(r, "GET", "/", resultsListHandler(app))
			route(r, "GET", "/dashboard", resultsDashboardHandler(app))
			route(r, "GET", "/analytics", resultsAnalyticsHandler(app))
			route(r, "POST", "/export", resultsExportHandler(app))
			route(r, "GET", "/sat", resultsSATListHandler(app))
			route(r, "GET", "/sat/{resultID}", resultsSATGetHandler(app))
			route(r, "GET", "/act-science", resultsACTScienceHandler(app))
			route(r, "GET", "/{resultID}/events", resultsEventsHandler(app))
			route(r, "GET", "/{resultID}", resultsGetHandler(app))
		})
		r.With(limitTier(app, httpx.TierWrites, userKey())).With(adminLimit).Route("/media", func(r chi.Router) {
			route(r, "POST", "/uploads", mediaUploadHandler(app))
			route(r, "PUT", "/uploads/{assetID}", mediaUploadBytesHandler(app))
			route(r, "POST", "/uploads/{assetID}/complete", mediaCompleteHandler(app))
			route(r, "GET", "/assets/{assetID}", withAuthedReadsTier(app, mediaDownloadHandler(app)))
			route(r, "GET", "/{assetID}", withAuthedReadsTier(app, mediaGetHandler(app)))
		})
		r.With(limitTier(app, httpx.TierAuthedReads, userKey())).With(adminLimit).Route("/answer-history", func(r chi.Router) {
			route(r, "GET", "/submissions/{submissionID}/overview", answerHistoryOverviewHandler(app))
			route(r, "GET", "/submissions/{submissionID}/targets/{targetID}", answerHistoryTargetDetailHandler(app))
			route(r, "GET", "/submissions/{submissionID}/export", answerHistoryExportHandler(app))
			route(r, "GET", "/attempts/{attemptID}/overview", answerHistoryOverviewByAttemptHandler(app))
			route(r, "GET", "/attempts/{attemptID}/targets/{targetID}", answerHistoryTargetDetailByAttemptHandler(app))
		})
		r.With(limitTier(app, httpx.TierAuthedReads, userKey())).Group(func(r chi.Router) {
			route(r, "GET", "/ws/live", liveWebSocketHandler(app))
		})
	})

	// V2 student response protocol (tight student tier).
	for _, prefix := range []string{"/api/v2", "/v2"} {
		prefix := prefix
		r.With(studentLimit).Route(prefix+"/student/attempts", func(r chi.Router) {
			r.With(limitTier(app, httpx.TierWrites, attemptKey())).Group(func(r chi.Router) {
				route(r, "POST", "/{attemptID}/responses:batch", v2BatchHandler(app))
				route(r, "POST", "/{attemptID}/submit", v2SubmitHandler(app))
				route(r, "POST", "/{attemptID}/takeover", v2TakeoverHandler(app))
			})
			r.With(limitTier(app, httpx.TierAuthedReads, attemptKey())).Group(func(r chi.Router) {
				route(r, "GET", "/{attemptID}/responses", v2SnapshotHandler(app))
			})
		})
	}

	r.NotFound(func(w http.ResponseWriter, r *http.Request) {
		httpx.WriteError(w, r, apperrors.New(apperrors.CodeNotFound, "Route not found."))
	})
	r.MethodNotAllowed(func(w http.ResponseWriter, r *http.Request) {
		httpx.WriteError(w, r, apperrors.New(apperrors.CodeBadRequest, "Method not allowed."))
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
	burst := cfg.RateLimitBucketCap
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
	cap := cfg.RateLimitBucketCap
	if cap <= 0 {
		cap = 10000
	}
	app.Tiers = httpx.NewTierSet(budgets, dbs, cap)
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
			sess, err := auth.LookupSessionWithCache(ctx, app.DB, app.SessionCache, app.Config, cookie.Value, time.Now().UTC())
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

// authorizationPlaceholder marks the authorization layer position in the
// chain. Real routes must re-check ActorContext at the data boundary via
// (auth.ActorContext).RequireOneOf — no DB RLS — so this stays a
// pass-through until per-route policies land with their handlers.
func authorizationPlaceholder(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		next.ServeHTTP(w, r)
	})
}
