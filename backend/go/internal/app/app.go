// Package app is the shared domain-service graph (WS-04b). Both cmd/api
// and cmd/worker build SAT/ACT/terminal/delivery services from here, so
// the provider switch, the presence posture, and the terminal scorer
// wiring live in exactly one place and cannot drift between processes.
//
// The package owns DOMAIN construction only: cmd/api keeps its App struct
// (HTTP-edge state: limiter, caches, gates, hub) and embeds Services.
package app

import (
	"context"
	"database/sql"

	"example.com/ielts-proctoring/internal/accesslinks"
	"example.com/ielts-proctoring/internal/act"
	"example.com/ielts-proctoring/internal/answerhistory"
	"example.com/ielts-proctoring/internal/attempts"
	"example.com/ielts-proctoring/internal/authoring"
	"example.com/ielts-proctoring/internal/authoringrealtime"
	"example.com/ielts-proctoring/internal/delivery"
	"example.com/ielts-proctoring/internal/exams"
	"example.com/ielts-proctoring/internal/grading"
	"example.com/ielts-proctoring/internal/library"
	"example.com/ielts-proctoring/internal/liveupdates"
	"example.com/ielts-proctoring/internal/media"
	"example.com/ielts-proctoring/internal/outbox"
	"example.com/ielts-proctoring/internal/platform/clock"
	"example.com/ielts-proctoring/internal/platform/config"
	"example.com/ielts-proctoring/internal/platform/objectstore"
	"example.com/ielts-proctoring/internal/platform/tx"
	"example.com/ielts-proctoring/internal/proctor"
	"example.com/ielts-proctoring/internal/release"
	"example.com/ielts-proctoring/internal/results"
	"example.com/ielts-proctoring/internal/runtime"
	"example.com/ielts-proctoring/internal/sat"
	"example.com/ielts-proctoring/internal/schedules"
	"example.com/ielts-proctoring/internal/student"
	"example.com/ielts-proctoring/internal/terminalization"
)

// Services is the shared domain graph: every stateful domain service both
// processes need, wired once from validated config + open pool.
type Services struct {
	Tx            *tx.Runner
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
	Outbox        *outbox.Repository
	Secret        []byte
	// AuthoringConfigErr is a fail-closed startup check: non-nil means the
	// events flag was enabled without a configured live bus. Entrypoints must
	// refuse to boot rather than silently serve flag-off authoring.
	AuthoringConfigErr error
}

// Deps are the process-edge hooks Build takes so domain wiring stays
// identical while each process keeps its own HTTP/worker state:
// version/snapshot caches, live bus/hub/leases/admission, bus origin.
type Deps struct {
	Versions         *delivery.VersionCache
	RuntimeSnapshots *runtime.SnapshotCache
	LiveBus          *liveupdates.Bus
	LiveHub          *liveupdates.Hub
	Leases           *liveupdates.LeaseRepository
	Admission        *liveupdates.Admission
}

// Build wires every domain service identically for API and worker: the
// SAT/ACT provider switch (Completer), the presence posture, and the
// terminal scorer live here, not pasted per-main. Callers pass process
// caches/buses via deps; a nil pool yields zero services (callers 503 /
// refuse to claim) instead of crashing.
func Build(cfg config.Config, pool *sql.DB, deps Deps) *Services {
	s := &Services{}
	if pool == nil {
		return s
	}
	s.Tx = tx.NewRunner(pool)
	s.Secret = []byte(cfg.AuthSecret)
	s.Outbox = outbox.NewRepository(pool)
	s.Terminal = terminalization.NewService(s.Tx, nil, nil).SetOutboxExecOnly(cfg.OutboxExecOnly)
	s.Attempts = attempts.NewService(s.Tx, clock.System{}, s.Secret).SetRowFirst(cfg.RowFirstWrites)
	s.Exams = exams.NewService(pool, s.Tx)
	s.Schedules = schedules.NewService(pool, s.Tx)
	s.Student = student.NewService(pool, nil).SetRowFirst(cfg.RowFirstWrites)
	// Plan D2: memory presence (off/inline = untouched per-beat tx).
	// Conditional per the code-comment prescription: the worker used to
	// force presence on unconditionally, diverging from the API.
	if cfg.PresenceMemory() {
		s.Student.SetPresence(student.NewPresenceMap(student.DefaultPresenceTTL))
	}
	assign := proctor.SQLAssignmentChecker{}
	s.Proctor = proctor.NewService(s.Tx, pool, s.Terminal, nil, assign).SetOutboxExecOnly(cfg.OutboxExecOnly)
	s.Grading = grading.NewService(pool, s.Tx)
	s.Results = results.NewService(pool)
	s.Media = media.NewServiceWithRemoteFetcher(
		pool,
		s.Tx,
		objectstore.NewLocalStore(cfg.ObjectStorageLocalRoot),
		media.NewHTTPRemoteImageFetcher(media.RemoteImageFetcherOptions{}),
	)
	s.Library = library.NewService(pool, s.Tx)
	s.AnswerHistory = answerhistory.NewService(pool)
	s.AccessLinks = accesslinks.NewService(pool, s.Tx)
	s.SAT = sat.NewService(pool, s.Tx, clock.System{}, nil)
	s.ACT = act.NewService(pool, s.Tx)
	s.Terminal.SetAttemptScorer(s.ACT)
	s.Release = release.NewService(pool)
	s.Runtime = runtime.NewService(s.Tx, nil).SetOutboxExecOnly(cfg.OutboxExecOnly).SetSnapshotCache(deps.RuntimeSnapshots)
	deliverySvc := delivery.NewService(pool, s.Tx)
	liveOrigin := ""
	if deps.LiveBus != nil {
		liveOrigin = deps.LiveBus.Origin()
	}
	deliverySvc.SetLive(liveOrigin, deps.LiveHub).SetLiveDirect(cfg.IsDirect()).SetLiveSink(deps.LiveBus, cfg.LiveBusSink)
	if cfg.VersionCacheEnabled {
		deliverySvc.SetVersionCache(deps.Versions)
	}
	s.Delivery = deliverySvc.SetCompleter(Completer(pool, s))
	// Authoring Preview reuses the SAME delivery service + revision-keyed
	// cache (single-build, no bare per-request service). Cache off
	// (VERSION_CACHE unset or nil Versions) leaves a nil cache: Preview
	// bulk-loads directly, which is the kill-switch posture.
	s.Authoring = authoring.NewService(pool, s.Tx).SetDeliveryService(deliverySvc).SetPreviewCache(previewCacheOrNil(cfg, deps)).
		SetLive(liveOrigin).SetEventsEnabled(cfg.AuthoringRealtimeEvents)
	// Phase 02: the publish path emits through the same gate.
	s.Exams = s.Exams.SetLive(liveOrigin).SetEventsEnabled(cfg.AuthoringRealtimeEvents)
	// Fail startup when the flag is on but no bus origin resolved: the flag
	// must disable the capability deliberately, never mask broken wiring by
	// silently degrading to flag-off authoring.
	s.AuthoringConfigErr = authoringrealtime.ValidateEmitterConfig(cfg.AuthoringRealtimeEvents, liveOrigin)
	return s
}

// previewCacheOrNil returns the shared revision-keyed cache only when the
// VERSION_CACHE kill-switch is on AND a cache was actually provided; every
// other combination yields nil (Preview bulk-loads directly, still correct).
func previewCacheOrNil(cfg config.Config, deps Deps) *delivery.VersionCache {
	if !cfg.VersionCacheEnabled {
		return nil
	}
	return deps.Versions
}

// Completer is the single SAT/ACT provider switch: timeout-driven
// completions route to the SAT reconciler or the ACT terminalizer by the
// attempt's effective provider key. Both API (delivery service) and worker
// share it, so provider routing cannot diverge between processes. Legacy ACT
// rows (provider_key='ielts', exam_type='ACT') heal to act here via the
// central exams.EffectiveProviderKey rule (Phase 02 blocker 4); stored
// identity is healed forward by migration 0054.
func Completer(pool *sql.DB, s *Services) func(ctx context.Context, scheduleID, attemptID string) error {
	return func(ctx context.Context, scheduleID, attemptID string) error {
		var providerKey, examType string
		if err := pool.QueryRowContext(ctx, "SELECT e.provider_key, e.exam_type FROM student_attempts a JOIN exam_entities e ON e.id = a.exam_id WHERE a.id = ? AND a.schedule_id = ?", attemptID, scheduleID).Scan(&providerKey, &examType); err != nil {
			return err
		}
		providerKey = exams.EffectiveProviderKey(providerKey, examType)
		switch providerKey {
		case "sat":
			return s.SAT.ReconcileAdapter()(ctx, scheduleID, attemptID)
		case "act":
			_, err := s.Terminal.Terminalize(ctx, terminalization.SealCommand{
				AttemptID: attemptID, ScheduleID: scheduleID,
				Outcome: terminalization.OutcomeTerminated, Reason: terminalization.ReasonTimeExpired,
				ActorKind: terminalization.ActorSystem,
				RequestID: "timeout-" + attemptID,
			})
			return err
		default:
			return nil
		}
	}
}
