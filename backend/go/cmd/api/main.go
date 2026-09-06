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
	Outbox          *outbox.Repository
	Secret          []byte
	LiveForwardOnce sync.Once
}

// BuildApp composes the application from validated config + open pool.
// It never panics: a nil pool yields an App whose handlers degrade to
// 503 on DB-dependent probes (readiness) instead of crashing.
func BuildApp(cfg config.Config, pool *sql.DB) *App {
	cap := cfg.RateLimitBucketCap
	if cap <= 0 {
		cap = 10000
	}
	app := &App{Config: cfg, DB: pool, Limiter: httpx.NewBucketStore(cap)}
	if pool != nil {
		app.Tx = tx.NewRunner(pool)
		secret := []byte(cfg.AuthSecret)
		app.Secret = secret
		outbx := outbox.NewRepository(pool)
		app.Outbox = outbx
		app.Terminal = terminalization.NewService(app.Tx, nil, nil)
		app.Attempts = attempts.NewService(app.Tx, clock.System{}, secret)
		app.Exams = exams.NewService(pool, app.Tx)
		app.Schedules = schedules.NewService(pool, app.Tx)
		app.Student = student.NewService(pool, nil)
		assign := proctor.SQLAssignmentChecker{}
		app.Proctor = proctor.NewService(app.Tx, pool, app.Terminal, nil, assign)
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
		app.Runtime = runtime.NewService(app.Tx, nil)
		// Each API process needs a distinct bus origin so the forwarder can
		// distinguish local post-commit fanout from events written by peers.
		app.LiveBus = liveupdates.NewBus(pool, uuid.NewString())
		app.LiveHub = liveupdates.NewHub()
		app.Delivery = delivery.NewService(pool, app.Tx).SetLive(app.LiveBus.Origin(), app.LiveHub).SetCompleter(func(ctx context.Context, scheduleID, attemptID string) error {
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
	}
	return app
}

func main() {
	cfg := config.Load()
	if err := cfg.ValidateForRuntime(); err != nil {
		log.Fatalf("api: invalid config: %v", err)
	}
	pool, err := db.Open(cfg)
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
//	auth > CSRF > rate limit > authorization > handler > access log
//
// AccessLog is registered last (innermost) so its JSON line emits after
// the handler returns, satisfying the trailing "handler > access log"
// step. Denials from outer layers (body-limit 413, rate-limit 429,
// CSRF 403, recovery 500) render the stable error envelope but bypass
// the access line; observability for those denials comes from the
// status code + request id in the envelope, scraped via /metrics
// counters once the metrics endpoint lands.
func BuildRouter(app *App) http.Handler {
	r := chi.NewRouter()
	startLiveBusForwarder(app)

	globalLimit := app.Config.RateLimitGlobalPerMin
	if globalLimit <= 0 {
		globalLimit = 600
	}
	globalBurst := app.Config.RateLimitBucketCap
	if globalBurst <= 0 {
		globalBurst = 120
	}

	r.Use(httpx.Recovery)
	r.Use(httpx.RequestID)
	r.Use(httpx.Trace)
	r.Use(httpx.SecurityHeaders)
	// Global ceiling is the largest tier (workbook 64MiB); tighter tiers
	// re-wrap per group below (a smaller inner cap always wins).
	r.Use(httpx.BodyLimit(httpx.MaxWorkbookBodyBytes))
	r.Use(authMiddleware(app))
	r.Use(csrfMiddleware(app))
	// Distributed fallback shares one ceiling across instances (round 75):
	// local buckets stay the fast path; the DB verdict only adds denials.
	var dbLimited func(ctx context.Context, key string) (bool, time.Duration, error)
	if app.DB != nil {
		fallback := httpx.NewDBRateLimiter(app.DB, "global", globalLimit, time.Minute)
		dbLimited = fallback.Check
	}
	r.Use(app.Limiter.RateLimit(
		httpx.RateLimitConfig{MaxRequests: globalLimit, Window: time.Minute, Burst: globalBurst},
		httpx.ClientIPKey,
		dbLimited,
	))
	r.Use(authorizationPlaceholder)
	r.Use(httpx.AccessLog)

	r.Get("/healthz", healthz(app))
	r.Get("/readyz", readyz(app))
	r.Get("/metrics", telemetry.DefaultRegistry.Handler())

	studentLimit := httpx.BodyLimit(httpx.MaxStudentBodyBytes) // 256KiB
	adminLimit := httpx.BodyLimit(httpx.MaxAdminBodyBytes)     // 2MiB

	r.Route("/api/v1", func(r chi.Router) {
		r.With(adminLimit).Route("/auth", func(r chi.Router) {
			route(r, "POST", "/login", loginHandler(app))
			route(r, "POST", "/student/entry", studentEntryHandler(app))
			route(r, "GET", "/student/schedules/{id}", studentEntryScheduleHandler(app))
			route(r, "GET", "/session", sessionHandler(app))
			route(r, "POST", "/logout", logoutHandler(app))
			route(r, "POST", "/logout-all", logoutAllHandler(app))
			route(r, "POST", "/activate", activateHandler(app))
			route(r, "POST", "/password/reset-request", passwordResetRequestHandler(app))
			route(r, "POST", "/password/reset-complete", passwordResetCompleteHandler(app))
		})
		r.With(adminLimit).Route("/exams", func(r chi.Router) {
			route(r, "GET", "/", examsListHandler(app))
			route(r, "POST", "/", examsCreateHandler(app))
			route(r, "GET", "/{id}", examsGetHandler(app))
			route(r, "PATCH", "/{id}", examsUpdateHandler(app))
			route(r, "DELETE", "/{id}", examsDeleteHandler(app))
			route(r, "PATCH", "/{id}/draft", examsDraftHandler(app))
			route(r, "POST", "/{id}/publish", examsPublishHandler(app))
			route(r, "GET", "/{id}/events", examsEventsHandler(app))
			route(r, "GET", "/{id}/validation", examsValidationHandler(app))
			route(r, "GET", "/{id}/versions", examsVersionsHandler(app))
			route(r, "GET", "/{id}/versions/summary", examsVersionSummariesHandler(app))
		})
		r.With(adminLimit).Route("/assessment-access", func(r chi.Router) {
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
		route(r, "GET", "/public/access-links/{linkID}", publicLinkGet(app))
		route(r, "POST", "/public/access-links/{linkID}/resolve-entry", publicLinkResolveEntry(app))
		r.With(adminLimit).Get("/assessment-release/exams/{examID}", releaseStateHandler(app))
		r.Route("/assessment-authoring", func(r chi.Router) {
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
		r.With(studentLimit).Route("/assessment-delivery", func(r chi.Router) {
			route(r, "POST", "/schedules/{scheduleID}/bootstrap", deliveryBootstrapHandler(app))
			route(r, "PATCH", "/schedules/{scheduleID}/responses/{examQuestionID}", deliverySaveResponseHandler(app))
			route(r, "POST", "/schedules/{scheduleID}/modules/start", deliveryStartModuleHandler(app))
			route(r, "POST", "/schedules/{scheduleID}/modules/submit", deliverySubmitModuleHandler(app))
			route(r, "POST", "/schedules/{scheduleID}/submit", deliverySubmitAssessmentHandler(app))
		})
		route(r, "GET", "/versions/{versionID}", versionSummaryHandler(app))
		r.With(adminLimit).Route("/schedules", func(r chi.Router) {
			route(r, "GET", "/", schedulesListHandler(app))
			route(r, "POST", "/", schedulesCreateHandler(app))
			route(r, "GET", "/{id}", schedulesGetHandler(app))
			route(r, "PATCH", "/{id}", schedulesUpdateHandler(app))
			route(r, "DELETE", "/{id}", schedulesDeleteHandler(app))
			route(r, "GET", "/{id}/runtime", schedulesRuntimeHandler(app))
			route(r, "POST", "/{id}/runtime/commands", schedulesRuntimeCommandHandler(app))
			route(r, "POST", "/{id}/register", schedulesRegisterHandler(app))
		})
		// Tight student tier: mutations, heartbeats, audits, submits.
		r.With(studentLimit).Route("/student/sessions", func(r chi.Router) {
			route(r, "GET", "/{scheduleID}", v1SessionHandler(app))
			route(r, "GET", "/{scheduleID}/static", v1StaticHandler(app))
			route(r, "GET", "/{scheduleID}/live", v1LiveHandler(app))
			route(r, "POST", "/{scheduleID}/precheck", v1PrecheckHandler(app))
			route(r, "POST", "/{scheduleID}/bootstrap", v1BootstrapHandler(app))
			r.Method("POST", "/{scheduleID}/mutations:batch", httpx.WithRoute(v1MutationHandler(app), "POST /{scheduleID}/mutations:batch"))
			route(r, "POST", "/{scheduleID}/heartbeat", v1HeartbeatHandler(app))
			route(r, "POST", "/{scheduleID}/audit", v1AuditHandler(app))
			r.Method("POST", "/{scheduleID}/submit", httpx.WithRoute(v1SubmitHandler(app), "POST /{scheduleID}/submit"))
		})
		r.With(adminLimit).Route("/proctor", func(r chi.Router) {
			route(r, "GET", "/sessions", proctorSessionsHandler(app))
			route(r, "GET", "/sessions/{scheduleID}", proctorSessionHandler(app))
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
			route(r, "POST", "/sessions/{scheduleID}/presence", proctorPresenceHandler(app))
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
		r.With(adminLimit).Route("/library", func(r chi.Router) {
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
		r.With(adminLimit).Route("/settings", func(r chi.Router) {
			route(r, "GET", "/exam-defaults", settingsExamDefaultsGetHandler(app))
			route(r, "PUT", "/exam-defaults", settingsExamDefaultsPutHandler(app))
			route(r, "GET", "/export-profiles", settingsExportProfilesListHandler(app))
			route(r, "POST", "/export-profiles", settingsExportProfilesCreateHandler(app))
		})
		r.With(adminLimit).Route("/grading", func(r chi.Router) {
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
		r.With(adminLimit).Route("/results", func(r chi.Router) {
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
		r.With(adminLimit).Route("/media", func(r chi.Router) {
			route(r, "POST", "/uploads", mediaUploadHandler(app))
			route(r, "PUT", "/uploads/{assetID}", mediaUploadBytesHandler(app))
			route(r, "POST", "/uploads/{assetID}/complete", mediaCompleteHandler(app))
			route(r, "GET", "/assets/{assetID}", mediaDownloadHandler(app))
			route(r, "GET", "/{assetID}", mediaGetHandler(app))
		})
		r.With(adminLimit).Route("/answer-history", func(r chi.Router) {
			route(r, "GET", "/submissions/{submissionID}/overview", answerHistoryOverviewHandler(app))
			route(r, "GET", "/submissions/{submissionID}/targets/{targetID}", answerHistoryTargetDetailHandler(app))
			route(r, "GET", "/submissions/{submissionID}/export", answerHistoryExportHandler(app))
			route(r, "GET", "/attempts/{attemptID}/overview", answerHistoryOverviewByAttemptHandler(app))
			route(r, "GET", "/attempts/{attemptID}/targets/{targetID}", answerHistoryTargetDetailByAttemptHandler(app))
		})
		route(r, "GET", "/ws/live", liveWebSocketHandler(app))
	})

	// V2 student response protocol (tight student tier).
	for _, prefix := range []string{"/api/v2", "/v2"} {
		prefix := prefix
		r.With(studentLimit).Route(prefix+"/student/attempts", func(r chi.Router) {
			route(r, "POST", "/{attemptID}/responses:batch", v2BatchHandler(app))
			route(r, "POST", "/{attemptID}/submit", v2SubmitHandler(app))
			route(r, "POST", "/{attemptID}/takeover", v2TakeoverHandler(app))
			route(r, "GET", "/{attemptID}/responses", v2SnapshotHandler(app))
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

// readyz is the readiness probe: DB ping + schema version.
func readyz(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if app.DB == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Database not configured."))
			return
		}
		ctx := r.Context()
		if err := app.DB.PingContext(ctx); err != nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Database unreachable."))
			return
		}
		version, err := db.SchemaVersion(ctx, app.DB)
		if err != nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Schema version unknown."))
			return
		}
		st := app.DB.Stats()
		telemetry.SetGauge(telemetry.MPoolOpen, float64(st.OpenConnections))
		telemetry.SetGauge(telemetry.MPoolInUse, float64(st.InUse))
		telemetry.SetGauge(telemetry.MPoolWait, float64(st.WaitCount))
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
			sess, err := auth.LookupSession(ctx, app.DB, app.Config, cookie.Value, time.Now().UTC())
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
