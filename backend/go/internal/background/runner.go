// Command worker runs background jobs: outbox drain, runtime/SAT
// reconciliation, terminal repairs + audits, grading projection, retention
// and media cleanup.
//
// Hot cycle (every worker fallback interval): bounded outbox drain (at most
// 20 claim batches of at most OUTBOX_BATCH_SIZE rows under a 60s lease) plus
// the grading projection when GRADING_PROJECTION_ENABLED. SAT timeout
// reconciliation runs independently every five seconds; slow cycle (every
// worker maintenance interval) handles repairs, audits, retention and media.
package background

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"strings"
	"sync"
	"time"

	"example.com/ielts-proctoring/internal/act"
	shared "example.com/ielts-proctoring/internal/app"
	"example.com/ielts-proctoring/internal/attempts"
	"example.com/ielts-proctoring/internal/liveupdates"
	"example.com/ielts-proctoring/internal/maintenance"
	"example.com/ielts-proctoring/internal/outbox"
	"example.com/ielts-proctoring/internal/platform/config"
	"example.com/ielts-proctoring/internal/platform/db"
	"example.com/ielts-proctoring/internal/platform/telemetry"
	"example.com/ielts-proctoring/internal/proctor"
	"example.com/ielts-proctoring/internal/sat"
	"example.com/ielts-proctoring/internal/student"
	"example.com/ielts-proctoring/internal/terminalization"
)

// Jobs enumerates the background job set (hot outbox+projection, independent
// SAT timeout reconciliation, and the slower maintenance pass).
var Jobs = []string{
	"DrainOutbox",
	"ReconcileSATTimeouts",
	"ReconcileExpiredSections",
	"ReconcileSATProvisionalCompletion",
	"RepairSATTerminalResults",
	"RepairMissingTerminalReceipts",
	"RunTerminalInvariantAudit",
	"RunGradingProjection",
	"RunRetention",
	"RunMediaCleanup",
	"NormalizeMediaDownloadURLs",
	"RepairACTCanonicalResults",
}

// SAT timeout finalization is a correctness owner, so it runs independently
// of the slower best-effort maintenance cadence.
const satTimeoutReconcileInterval = 5 * time.Second

// worker carries the handles every background job needs. Dependencies are
// wired once in main and passed explicitly; there is no package-level state.
// terminalSealer is the Terminalize surface executeOutboxEvent needs.
// *terminalization.Service satisfies it; tests inject a capture fake via
// setTerminalSealer. Production wiring (main) keeps the concrete service.
type terminalSealer interface {
	Terminalize(ctx context.Context, cmd terminalization.SealCommand) (*terminalization.SealResult, error)
}

type Runner struct {
	cfg      config.Config
	db       *sql.DB
	outbox   *outbox.Repository
	sat      *sat.Service
	act      *act.Service
	delivery deliveryService
	proctor  *proctor.Service
	student  *student.Service
	terminal *terminalization.Service
	// sealer overrides terminal when set (tests only; nil = production).
	sealer   terminalSealer
	liveBus  *liveupdates.Bus
	liveHub  *liveupdates.Hub
	workerID string
}

// deliveryService is the delivery surface the worker drives: the maintenance
// timeout sweep plus the per-attempt reconcile the section-reconcile family
// runs. *delivery.Service satisfies it (production assigns it directly); tests
// substitute a fake.
type deliveryService interface {
	ReconcileTimeouts(ctx context.Context, asOf time.Time, batchSize int64) (int64, error)
	ReconcilePersonalTimeouts(ctx context.Context, asOf time.Time, batchSize int64) (int64, error)
	ReconcileAttemptTimeout(ctx context.Context, scheduleID, attemptID string, asOf time.Time) (bool, error)
}

// setTerminalSealer injects a fake sealer (tests only).
func (w *Runner) setTerminalSealer(s terminalSealer) *Runner {
	w.sealer = s
	return w
}

// sealerFor resolves the effective sealer: the test fake when set,
// otherwise the production terminalization service.
func (w *Runner) sealerFor() terminalSealer {
	if w.sealer != nil {
		return w.sealer
	}
	return w.terminal
}

// New builds the same job graph for a standalone worker or an embedded runner.
func New(cfg config.Config, pool *sql.DB, deps shared.Deps) *Runner {
	workerID := newWorkerID()
	deps.LiveBus = liveupdates.NewBus(pool, workerID)
	if deps.LiveHub == nil {
		deps.LiveHub = liveupdates.NewHub()
	}
	svc := shared.Build(cfg, pool, deps)
	claimMode := outbox.ClaimUpdate
	if cfg.OutboxClaimMode == config.OutboxClaimSkipLocked {
		claimMode = outbox.ClaimSkipLocked
	}
	return &Runner{
		cfg: cfg, db: pool,
		outbox: outbox.NewRepository(pool).WithClaim(cfg.WorkerClaimPartitions, 0, claimMode),
		sat:    svc.SAT, act: svc.ACT, delivery: svc.Delivery,
		proctor: svc.Proctor, student: svc.Student, terminal: svc.Terminal,
		liveBus: deps.LiveBus, liveHub: deps.LiveHub, workerID: workerID,
	}
}

// WithPresence shares the API's map while retaining the worker's database pool.
func (w *Runner) WithPresence(p *student.PresenceMap) *Runner {
	w.student.SetPresence(p)
	return w
}

// Run runs continuously until shutdown. The CLI retains its timeout-only mode
// for operator compatibility; activity-driven deployments embed the full runner.
func (w *Runner) Run(ctx context.Context, timeoutOnly bool) {
	w.run(ctx, ctx, timeoutOnly)
}

// RunUntil stops scheduling when stop is cancelled, and joins all current jobs.
// Work retains the process context so parking does not interrupt a transaction.
func (w *Runner) RunUntil(stop, work context.Context) {
	w.run(stop, work, false)
}

func (w *Runner) run(stop, work context.Context, timeoutOnly bool) {
	fallback := time.Duration(w.cfg.WorkerFallbackIntervalSecs) * time.Second
	if fallback <= 0 {
		fallback = 5 * time.Second
	}
	slowEvery := time.Duration(w.cfg.WorkerMaintenanceIntervalSecs) * time.Second
	if slowEvery <= 0 {
		slowEvery = 5 * time.Minute
	}
	hot := time.NewTicker(fallback)
	defer hot.Stop()
	slow := time.NewTicker(slowEvery)
	defer slow.Stop()
	var jobs sync.WaitGroup
	jobs.Add(2)
	go func() { defer jobs.Done(); w.runTimeoutReconcileLoop(stop, work) }()
	go func() { defer jobs.Done(); w.runPersonalTimeoutReconcileLoop(stop, work) }()
	defer jobs.Wait()
	if timeoutOnly {
		<-stop.Done()
		return
	}
	// Recovery and bounded maintenance run once on each activation.
	runBounded(work, func(ctx context.Context) { w.runHotCycle(ctx, time.Now().UTC()) })
	if stop.Err() == nil {
		runBounded(work, func(ctx context.Context) { w.runMaintenanceCycle(ctx, time.Now().UTC()) })
	}
	for {
		select {
		case <-stop.Done():
			return
		case t := <-hot.C:
			if stop.Err() == nil {
				runBounded(work, func(ctx context.Context) { w.runHotCycle(ctx, t) })
			}
		case t := <-slow.C:
			if stop.Err() == nil {
				runBounded(work, func(ctx context.Context) { w.runMaintenanceCycle(ctx, t) })
			}
		}
	}
}

func (w *Runner) runTimeoutReconcileLoop(ctx, work context.Context) {
	// One initial sweep avoids waiting a full interval on process start; the
	// ticker runs independently of outbox and maintenance work thereafter.
	if ctx.Err() != nil {
		return
	}
	runBounded(work, func(ctx context.Context) { w.runTimeoutReconcileCycle(ctx, time.Now().UTC()) })
	ticker := time.NewTicker(satTimeoutReconcileInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if ctx.Err() != nil {
				return
			}
			runBounded(work, func(ctx context.Context) { w.runTimeoutReconcileCycle(ctx, time.Now().UTC()) })
		}
	}
}

func (w *Runner) runPersonalTimeoutReconcileLoop(ctx, work context.Context) {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case at := <-ticker.C:
			if ctx.Err() != nil {
				return
			}
			started := time.Now()
			jobCtx, cancel := context.WithTimeout(work, time.Minute)
			n, err := w.delivery.ReconcilePersonalTimeouts(jobCtx, at.UTC(), maintenance.SATRepairBatch)
			cancel()
			if err != nil {
				log.Printf("worker: SATPersonalTimeoutReconcile failed error=%v duration=%s", err, time.Since(started))
				telemetry.IncCounter(telemetry.MJobFailures, "job", "sat_personal_timeout_reconcile")
			} else if n > 0 {
				log.Printf("worker: SATPersonalTimeoutReconcile finalized=%d duration=%s", n, time.Since(started))
			}
		}
	}
}

// A database outage must not make parking wait forever for an old cycle.
func runBounded(parent context.Context, job func(context.Context)) {
	ctx, cancel := context.WithTimeout(parent, time.Minute)
	defer cancel()
	job(ctx)
}

// newWorkerID identifies this process in outbox claimed_by so concurrent
// workers hold disjoint leases.
func newWorkerID() string {
	host, err := os.Hostname()
	if err != nil || host == "" {
		host = "worker"
	}
	return fmt.Sprintf("%s-%d", host, os.Getpid())
}

// observeWorkerPoolStats reports the worker pool snapshot on the role-labeled
// pool gauges (plan E3/§7: pool waits split API/worker). Nil-safe; called
// once per hot cycle so the worker half of the split is always fresh.
// The *sql.DB concrete type satisfies the minimal interface implicitly.
func observeWorkerPoolStats(pool interface{ Stats() sql.DBStats }) {
	if pool == nil {
		return
	}
	db.ReportPoolStats(db.RoleWorker, pool.Stats())
}

// observeJobDuration records a worker cycle's wall-clock duration in seconds.
// Callers capture start with time.Now and defer this helper so every return
// path reports; emission happens outside any business transaction.
func observeJobDuration(job string, start time.Time) {
	telemetry.SetGauge(telemetry.MJobDuration, time.Since(start).Seconds(), "job", job)
}

// runHotCycle drains the outbox (bounded to OutboxDrainMaxRounds claim
// batches) and runs the grading projection when enabled.
// drainOutbox claims + handles up to OutboxDrainMaxRounds batches through one
// repository (one partition when B4.3 is on). Returns claimed/published/failed
// + rounds run. Extracted so the single-consumer path and each partition
// consumer share the exact per-event handling.
func (w *Runner) drainOutbox(ctx context.Context, repo *outbox.Repository, limit int) (claimed, published, failed int64, rounds int, drainErr error) {
	for ; rounds < maintenance.OutboxDrainMaxRounds; rounds++ {
		token, events, err := repo.ClaimBatch(ctx, limit, w.workerID, outbox.ClaimLeaseSecs)
		if err != nil {
			drainErr = err
			log.Printf("worker: DrainOutbox claim failed (round %d): %v", rounds, err)
			telemetry.IncCounter(telemetry.MJobFailures, "job", "drain_outbox")
			break
		}
		if len(events) == 0 {
			break
		}
		claimed += int64(len(events))
		for range events {
			telemetry.IncCounter(telemetry.MOutboxClaimed)
		}
		for _, e := range events {
			if !outbox.IsExecutable(e.Family) {
				// Wakeup-only families are relayed through the durable live bus
				// before acknowledgement. This makes the outbox the retryable
				// cross-process handoff instead of silently dropping the event.
				if err := w.publishWakeup(ctx, e); err != nil {
					failed++
					w.markFailed(ctx, token, e, err.Error())
					continue
				}
				if _, err := w.outbox.MarkPublished(ctx, token, []string{e.ID}); err != nil {
					failed++
					w.markFailed(ctx, token, e, err.Error())
					continue
				}
				published++
				telemetry.IncCounter(telemetry.MOutboxAcked, "family", e.Family)
				continue
			}
			// WS-09: per-attempt try/continue lives inside executeOutboxEvent
			// (poison attempts land in their own DLQ rows while good attempts
			// seal). An error here means zero seals + transient failure —
			// retry with backoff, never a whole-batch burn.
			if err := w.executeOutboxEvent(ctx, e); err != nil {
				log.Printf("worker: DrainOutbox executable event id=%s aggregate=%s/%s revision=%d attempts=%d failed: %v",
					e.ID, e.AggregateKind, e.AggregateID, e.Revision, e.PublishAttempts, err)
				failed++
				w.markFailed(ctx, token, e, err.Error())
				continue
			}
			if _, err := w.outbox.MarkPublished(ctx, token, []string{e.ID}); err != nil {
				failed++
				w.markFailed(ctx, token, e, err.Error())
				continue
			}
			published++
			telemetry.IncCounter(telemetry.MOutboxAcked, "family", e.Family)
		}
	}
	if failed > 0 {
		drainErr = errors.Join(drainErr, fmt.Errorf("outbox processing failed for %d events", failed))
	}
	return claimed, published, failed, rounds, drainErr
}

func (w *Runner) runHotCycle(ctx context.Context, at time.Time) (cycleErr error) {
	defer observeJobDuration("hot", time.Now())
	if w.db != nil {
		observeWorkerPoolStats(w.db)
	}
	if w.proctor != nil {
		var serverNow time.Time
		if err := w.db.QueryRowContext(ctx, "SELECT UTC_TIMESTAMP(6)").Scan(&serverNow); err != nil {
			cycleErr = errors.Join(cycleErr, err)
			log.Printf("worker: ReconcileExpiredSections clock query failed: %v", err)
			telemetry.IncCounter(telemetry.MJobFailures, "job", "reconcile_expired_sections")
		} else if outcomes, err := w.proctor.ReconcileExpiredSections(ctx, serverNow, maintenance.SATRepairBatch, w.workerID); err != nil {
			cycleErr = errors.Join(cycleErr, err)
			log.Printf("worker: ReconcileExpiredSections error: %v", err)
			telemetry.IncCounter(telemetry.MJobFailures, "job", "reconcile_expired_sections")
		} else if len(outcomes) > 0 {
			log.Printf("worker: ReconcileExpiredSections advanced=%d", len(outcomes))
		}
	}
	limit := w.cfg.OutboxBatchSize
	if limit < 1 {
		limit = outbox.ClaimLimit
	}
	if limit > outbox.ClaimLimit {
		limit = outbox.ClaimLimit
	}
	partitions := w.cfg.WorkerClaimPartitions
	if partitions < 1 {
		partitions = 1
	}
	var claimed, published, failed int64
	rounds := 0
	if partitions == 1 {
		var drainErr error
		claimed, published, failed, rounds, drainErr = w.drainOutbox(ctx, w.outbox, limit)
		cycleErr = errors.Join(cycleErr, drainErr)
	} else {
		// B4.3: N in-process consumers with disjoint MOD(CRC32) leases +
		// smaller batches each (limit/N, min 1). Goroutines share only the
		// pool; MarkPublished/MarkFailed are token-scoped (no cross-talk).
		// No golang.org/x/sync in go.mod — plain WaitGroup + mutex.
		perLimit := limit / partitions
		if perLimit < 1 {
			perLimit = 1
		}
		mode := outbox.ClaimUpdate
		if w.cfg.OutboxClaimMode == config.OutboxClaimSkipLocked {
			mode = outbox.ClaimSkipLocked
		}
		var mu sync.Mutex
		var wg sync.WaitGroup
		for i := 0; i < partitions; i++ {
			wg.Add(1)
			go func(index int) {
				defer wg.Done()
				part := outbox.NewRepository(w.db).WithClaim(partitions, index, mode)
				c, p, f, r, err := w.drainOutbox(ctx, part, perLimit)
				mu.Lock()
				cycleErr = errors.Join(cycleErr, err)
				claimed += c
				published += p
				failed += f
				rounds += r
				mu.Unlock()
			}(i)
		}
		wg.Wait()
	}
	_ = rounds
	projMsg := "disabled"
	if w.cfg.GradingProjectionEnabled {
		rep, err := maintenance.RunGradingProjection(ctx, w.db, true)
		if err != nil {
			cycleErr = errors.Join(cycleErr, err)
			projMsg = fmt.Sprintf("error: %v", err)
			if _, ferr := maintenance.RecordProjectionFailure(ctx, w.db); ferr != nil {
				log.Printf("worker: RunGradingProjection failure counter: %v", ferr)
			}
		} else {
			projMsg = fmt.Sprintf("schedules=%d submissions=%d sections=%d writing=%d lag=%ds",
				rep.SchedulesSynced, rep.SubmissionsSynced, rep.SectionsSynced, rep.WritingSynced, rep.LagSeconds)
			telemetry.SetGauge(telemetry.MProjectionLag, float64(rep.LagSeconds))
		}
	}
	pending := claimed - published
	if pending < 0 {
		pending = 0
	}
	telemetry.SetGauge(telemetry.MOutboxPending, float64(pending))
	if age, aerr := w.outbox.OldestPendingAgeSeconds(ctx); aerr != nil {
		log.Printf("worker: OutboxOldestAge probe: %v", aerr)
	} else {
		telemetry.SetGauge(telemetry.MOutboxOldestAge, float64(age))
	}
	log.Printf("worker: hot cycle at %s (DrainOutbox claimed=%d published=%d failed=%d rounds=%d, RunGradingProjection %s)",
		at.UTC().Format(time.RFC3339), claimed, published, failed, rounds, projMsg)
	return cycleErr
}

// publishWakeup relays only the event families that are part of the live
// update contract. Other non-executable outbox families (for example password
// reset notifications) are intentionally acknowledged without becoming live
// frames.
func (w *Runner) publishWakeup(ctx context.Context, event outbox.Event) error {
	if event.Family != outbox.FamilyAttemptTerminalized &&
		event.Family != outbox.FamilyRuntimeChanged &&
		event.Family != outbox.FamilyRosterChanged &&
		event.Family != "attempt_changed" {
		return nil
	}
	if w.liveBus == nil {
		return fmt.Errorf("live-update bus is not configured")
	}
	kind := ""
	switch event.AggregateKind {
	case "schedule_runtime":
		kind = liveupdates.KindScheduleRuntime
	case "schedule_roster":
		kind = liveupdates.KindScheduleRoster
	case "attempt", "attempt_terminalization":
		kind = liveupdates.KindAttempt
	default:
		return fmt.Errorf("unsupported live wake-up aggregate %q for family %q", event.AggregateKind, event.Family)
	}
	var payload any
	if len(event.Payload) > 0 {
		payload = json.RawMessage(event.Payload)
	}
	if w.cfg.IsDirect() && w.liveHub != nil {
		w.liveHub.Publish(liveupdates.Event{Kind: kind, ID: event.AggregateID, Revision: event.Revision, Name: event.Family, Payload: event.Payload})
		return nil
	}
	return w.liveBus.Append(ctx, kind, event.AggregateID, event.Revision, event.Family, payload)
}

// isTerminalConflict classifies settled terminalization conflicts as
// permanent fan-out failures: TERMINALIZATION_CONFLICT (cross-outcome seal
// raced and lost) and ATTEMPT_PROCTOR_BLOCKED (the claim fence refused a
// stale submitted seal after a proctor termination) both mean the attempt
// already owns its terminal fact. Anything else (load errors, transient
// seal failures, validation) stays retryable.
func isTerminalConflict(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return strings.Contains(msg, terminalization.ReasonTerminalizationConflict) ||
		strings.Contains(msg, terminalization.ReasonAttemptProctorBlocked)
}

// markFailed records a publish failure; the retry disposition and delay come
// from BackoffFor via MarkFailed (terminal at >= MaxAttempts).
func (w *Runner) markFailed(ctx context.Context, token string, e outbox.Event, msg string) {
	disp, delay := outbox.BackoffFor(e.PublishAttempts)
	name := "retry"
	if disp == outbox.Terminal {
		name = "terminal"
	}
	if _, err := w.outbox.MarkFailed(ctx, token, e.ID, e.PublishAttempts, msg); err != nil {
		log.Printf("worker: DrainOutbox MarkFailed id=%s: %v", e.ID, err)
		return
	}
	log.Printf("worker: DrainOutbox publish failed id=%s family=%s disposition=%s backoff=%s err=%s",
		e.ID, e.Family, name, delay, msg)
}

type autoSubmitEvent struct {
	ScheduleID string   `json:"scheduleId"`
	AttemptIDs []string `json:"attemptIds"`
	ActorID    string   `json:"actorId"`
	Reason     string   `json:"reason"`
}

// failureDetail is one poisoned fan-out attempt: it is quarantined to the
// DLQ individually so the rest of the batch still seals. Permanent
// terminalization conflicts (outcome decided elsewhere) are business facts,
// not operational failures — they are recorded without the error text.
type failureDetail struct {
	attemptID string
	permanent bool
	err       error
}

// executeOutboxEvent applies executable application work before the outbox
// row is acknowledged. Sealing is idempotent, so a retry after a worker
// crash replays the receipt instead of creating a second terminal fact.
//
// WS-09 per-attempt semantics: every attempt gets its own try/continue —
// the per-attempt error list is collected, failed attempts are quarantined
// to individual DLQ rows (never whole-batch burn), good attempts seal, and
// nil is returned whenever at least one attempt sealed OR every failure is
// permanent (a terminal conflict means the attempt already has its terminal
// fact; failing the event would pointlessly retry it to the terminal park).
// Only a batch with zero seals and at least one transient failure returns
// an error, so the event retries with backoff.
func (w *Runner) executeOutboxEvent(ctx context.Context, event outbox.Event) error {
	if event.Family == outbox.FamilySectionAttemptsReconcile {
		return w.executeSectionAttemptReconcileEvent(ctx, event)
	}
	if event.Family != outbox.FamilyAutoSubmitScheduleAttempts {
		return fmt.Errorf("unsupported executable outbox family %q", event.Family)
	}
	var payload autoSubmitEvent
	if len(event.Payload) > 0 {
		if err := json.Unmarshal(event.Payload, &payload); err != nil {
			return fmt.Errorf("decode auto-submit payload: %w", err)
		}
	}
	if payload.ScheduleID == "" {
		payload.ScheduleID = event.AggregateID
	}
	if payload.ScheduleID == "" {
		return fmt.Errorf("auto-submit event has no schedule id")
	}
	if len(payload.AttemptIDs) == 0 {
		// B4.4: cursor-batched fan-out (500/batch, WHERE id > ?) instead of
		// one unbounded SELECT: bounded memory + bounded lock footprint per
		// batch; progress logged per page.
		ids, err := w.listAutoSubmitAttempts(ctx, payload.ScheduleID, autoSubmitCursorBatch)
		if err != nil {
			return err
		}
		payload.AttemptIDs = ids
	}
	// Defense in depth: the seal reason must be terminalization vocabulary.
	// CompleteExam now always enqueues proctor_complete, but rows written by
	// older builds (or a future free-text regression) must degrade to the
	// fixed vocabulary instead of failing validation on every retry until
	// the outbox event goes terminal with students unsubmitted.
	reason := terminalization.ReasonProctorComplete
	switch payload.Reason {
	case terminalization.ReasonProctorComplete, terminalization.ReasonProctorEnd,
		terminalization.ReasonTimeExpired, terminalization.ReasonAutoStop,
		terminalization.ReasonProctorForceSub:
		reason = payload.Reason
	}
	sealed := 0
	var failures []failureDetail
	for _, attemptID := range payload.AttemptIDs {
		if serr := w.sealAutoSubmitAttempt(ctx, event, payload, reason, attemptID); serr != nil {
			failures = append(failures, *serr)
			continue
		}
		sealed++
		if sealed%autoSubmitCursorBatch == 0 {
			log.Printf("worker: auto-submit schedule=%s sealed=%d (progress)", payload.ScheduleID, sealed)
		}
	}
	for _, f := range failures {
		if qerr := w.outbox.QuarantineAttempt(ctx, event, f.attemptID, "seal", f.err); qerr != nil {
			log.Printf("worker: auto-submit schedule=%s attempt=%s quarantine failed: %v", payload.ScheduleID, f.attemptID, qerr)
		}
	}
	log.Printf("worker: auto-submit schedule=%s sealed=%d failed=%d done", payload.ScheduleID, sealed, len(failures))
	// One-shot fan-out: attempts that arrived mid-seal must not be left
	// behind on a consumed event. Re-list eligible IDs and seal the delta
	// in the same claim; overflow beyond one delta page enqueues a
	// follow-up scan event.
	if sealed > 0 || allPermanent(failures) {
		if rerr := w.rescanAutoSubmitDelta(ctx, event, payload, reason, payload.AttemptIDs); rerr != nil {
			log.Printf("worker: auto-submit schedule=%s rescan: %v", payload.ScheduleID, rerr)
		}
	}
	if sealed == 0 && hasTransientFailure(failures) {
		first := failures[0]
		return fmt.Errorf("auto-submit schedule %s: 0 sealed, %d transient failure(s); first attempt %s: %w", payload.ScheduleID, len(failures), first.attemptID, first.err)
	}
	return nil
}

// allPermanent reports whether every collected failure is a settled
// terminalization conflict (the attempt already owns its terminal fact).
func allPermanent(failures []failureDetail) bool {
	if len(failures) == 0 {
		return true
	}
	for _, f := range failures {
		if !f.permanent {
			return false
		}
	}
	return true
}

// hasTransientFailure reports whether any collected failure deserves a
// retry (anything that is not a settled terminalization conflict).
func hasTransientFailure(failures []failureDetail) bool {
	for _, f := range failures {
		if !f.permanent {
			return true
		}
	}
	return false
}

// sectionAttemptReconcileEvent is the outbox payload for
// FamilySectionAttemptsReconcile: the module attempts left open when a cohort
// section ended.
type sectionAttemptReconcileEvent struct {
	ScheduleID string   `json:"scheduleId"`
	SectionKey string   `json:"sectionKey"`
	AttemptIDs []string `json:"attemptIds"`
	Reason     string   `json:"reason"`
}

// executeSectionAttemptReconcileEvent runs the delivery reconciler for the
// module attempts left open when a cohort section ended. Delivery owns module
// finalization (adaptive routing + the follow-up module row), so the section
// reconciler hands the work over instead of finalizing inline. Each attempt is
// reconciled independently: one transient failure must not stop the rest of
// the cohort from closing, and the event retries with backoff only when no
// attempt progressed.
func (w *Runner) executeSectionAttemptReconcileEvent(ctx context.Context, event outbox.Event) error {
	if w.delivery == nil {
		return nil
	}
	var payload sectionAttemptReconcileEvent
	if len(event.Payload) > 0 {
		if err := json.Unmarshal(event.Payload, &payload); err != nil {
			return fmt.Errorf("decode section reconcile payload: %w", err)
		}
	}
	if payload.ScheduleID == "" {
		payload.ScheduleID = event.AggregateID
	}
	if payload.ScheduleID == "" {
		return fmt.Errorf("section reconcile event has no schedule id")
	}
	if len(payload.AttemptIDs) == 0 {
		return nil
	}
	asOf := time.Now().UTC()
	changed, failed := 0, 0
	var firstErr error
	for _, attemptID := range payload.AttemptIDs {
		ok, err := w.delivery.ReconcileAttemptTimeout(ctx, payload.ScheduleID, attemptID, asOf)
		if err != nil {
			failed++
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		if ok {
			changed++
		}
	}
	if changed == 0 && failed > 0 {
		return fmt.Errorf("section reconcile schedule %s section %s: %d attempt(s) failed; first: %w",
			payload.ScheduleID, payload.SectionKey, failed, firstErr)
	}
	log.Printf("worker: section reconcile schedule=%s section=%s attempts=%d changed=%d failed=%d",
		payload.ScheduleID, payload.SectionKey, len(payload.AttemptIDs), changed, failed)
	return nil
}

// sealAutoSubmitAttempt seals one fan-out attempt. The terminalization
// RequestID reuses the batch-shared event.ID (idempotency key): every
// reseal of this event replays the same receipt instead of minting a second
// terminal fact. Load-bearing — pinned by TestExecuteOutboxEventReusesID.
func (w *Runner) sealAutoSubmitAttempt(ctx context.Context, event outbox.Event, payload autoSubmitEvent, reason, attemptID string) *failureDetail {
	var providerKey, proctorStatus string
	if err := w.db.QueryRowContext(ctx, `
		SELECT e.provider_key, COALESCE(a.proctor_status, 'active')
		FROM student_attempts a JOIN exam_entities e ON e.id = a.exam_id
		WHERE a.id = ? AND a.schedule_id = ?`, attemptID, payload.ScheduleID).Scan(&providerKey, &proctorStatus); err != nil {
		return &failureDetail{attemptID: attemptID, err: fmt.Errorf("load auto-submit attempt %s: %w", attemptID, err)}
	}
	actorKind := terminalization.ActorSystem
	var actorID *string
	if payload.ActorID != "" {
		actorKind = terminalization.ActorProctor
		id := payload.ActorID
		actorID = &id
	}
	outcome := terminalization.OutcomeSubmitted
	if providerKey == "sat" || proctorStatus == "terminated" {
		outcome = terminalization.OutcomeTerminated
	}
	finalSubmission, _ := json.Marshal(map[string]any{
		"autoSubmission":   true,
		"completionReason": reason,
		"proctorStatus":    proctorStatus,
	})
	if _, err := w.sealerFor().Terminalize(ctx, terminalization.SealCommand{
		AttemptID: attemptID, ScheduleID: payload.ScheduleID,
		Outcome: outcome, Reason: reason,
		ActorKind: actorKind, ActorID: actorID, FinalSubmission: finalSubmission,
		RequestID: event.ID,
	}); err != nil {
		return &failureDetail{attemptID: attemptID, permanent: isTerminalConflict(err), err: fmt.Errorf("auto-submit attempt %s: %w", attemptID, err)}
	}
	return nil
}

// rescanAutoSubmitDelta seals late arrivals that became eligible mid-seal
// (compare max seen id, then seal the delta in this claim). A delta page
// that itself overflows enqueues one bounded follow-up scan event so no
// eligible attempt is left behind on a consumed event.
func (w *Runner) rescanAutoSubmitDelta(ctx context.Context, event outbox.Event, payload autoSubmitEvent, reason string, seen []string) error {
	maxSeen := ""
	for _, id := range seen {
		if id > maxSeen {
			maxSeen = id
		}
	}
	rows, err := w.db.QueryContext(ctx, `
		SELECT a.id FROM student_attempts a
		WHERE schedule_id = ? AND submitted_at IS NULL
		  AND COALESCE(delivery_status, 'running') NOT IN ('submitted', 'terminated', 'locked', 'cancelled')
		  AND COALESCE(proctor_status, 'active') <> 'terminated'
		  AND a.id > ?
		ORDER BY a.id LIMIT ?`, payload.ScheduleID, maxSeen, autoSubmitCursorBatch+1)
	if err != nil {
		return fmt.Errorf("rescan eligible: %w", err)
	}
	var delta []string
	func() {
		defer rows.Close()
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				return
			}
			delta = append(delta, id)
		}
	}()
	if err := rows.Err(); err != nil {
		return fmt.Errorf("rescan eligible: %w", err)
	}
	if len(delta) == 0 {
		return nil
	}
	overflow := false
	if len(delta) > autoSubmitCursorBatch {
		overflow = true
		delta = delta[:autoSubmitCursorBatch]
	}
	sealed := 0
	for _, attemptID := range delta {
		if serr := w.sealAutoSubmitAttempt(ctx, event, payload, reason, attemptID); serr != nil {
			if qerr := w.outbox.QuarantineAttempt(ctx, event, attemptID, "rescan", serr.err); qerr != nil {
				log.Printf("worker: auto-submit schedule=%s rescan attempt=%s quarantine failed: %v", payload.ScheduleID, attemptID, qerr)
			}
			continue
		}
		sealed++
	}
	log.Printf("worker: auto-submit schedule=%s rescan sealed=%d overflow=%v", payload.ScheduleID, sealed, overflow)
	if overflow {
		return w.enqueueAutoSubmitFollowUp(ctx, payload.ScheduleID, payload.ActorID, reason)
	}
	return nil
}

// enqueueAutoSubmitFollowUp enqueues one bounded scan event so a rescan
// overflow is drained by a later claim instead of growing this one.
func (w *Runner) enqueueAutoSubmitFollowUp(ctx context.Context, scheduleID, actorID, reason string) error {
	payload, err := json.Marshal(map[string]any{
		"scheduleId": scheduleID,
		"actorId":    actorID,
		"reason":     reason,
	})
	if err != nil {
		return err
	}
	_, err = w.db.ExecContext(ctx, `
		INSERT INTO outbox_events
			(id, aggregate_kind, aggregate_id, revision, event_family, payload, created_at, publish_attempts)
		VALUES (UUID(), 'schedule_runtime', ?, 0, 'auto_submit_schedule_attempts_requested', ?, NOW(), 0)`,
		scheduleID, string(payload))
	return err
}

// autoSubmitCursorBatch bounds one fan-out page (plan B4.4).
const autoSubmitCursorBatch = 500

// listAutoSubmitAttempts pages eligible attempts by id cursor
// (WHERE schedule_id = ? AND ... AND a.id > ? ORDER BY a.id LIMIT ?),
// logging progress per page. The table alias keeps the predicate stable
// if the eligibility shape changes; the cursor column (PK id) is indexed
// so pages stay point-ranged, not offset-scanned.
func (w *Runner) listAutoSubmitAttempts(ctx context.Context, scheduleID string, batch int) ([]string, error) {
	if batch < 1 {
		batch = autoSubmitCursorBatch
	}
	var out []string
	after := ""
	for {
		rows, err := w.db.QueryContext(ctx, `
			SELECT a.id FROM student_attempts a
			WHERE schedule_id = ? AND submitted_at IS NULL
			  AND COALESCE(delivery_status, 'running') NOT IN ('submitted', 'terminated', 'locked', 'cancelled')
			  AND COALESCE(proctor_status, 'active') <> 'terminated'
			  AND a.id > ?
			ORDER BY a.id LIMIT ?`, scheduleID, after, batch)
		if err != nil {
			return nil, err
		}
		var page []string
		func() {
			defer rows.Close()
			for rows.Next() {
				var id string
				if err := rows.Scan(&id); err != nil {
					return
				}
				page = append(page, id)
			}
		}()
		if err := rows.Err(); err != nil {
			return nil, err
		}
		if len(page) == 0 {
			break
		}
		out = append(out, page...)
		after = page[len(page)-1]
		log.Printf("worker: auto-submit fan-out schedule=%s page=%d total=%d cursor=%s", scheduleID, len(page), len(out), after)
		if len(page) < batch {
			break
		}
	}
	return out, nil
}

// refreshRollups recomputes the D4 dashboard header for live schedules.
// Schedules are discovered via the proctor live-schedule list; per-schedule
// failures log and continue (one hot schedule must not stall the rest).
func (w *Runner) refreshRollups(ctx context.Context) {
	if w.proctor == nil {
		return
	}
	schedules, err := w.proctor.LiveScheduleIDs(ctx)
	if err != nil {
		log.Printf("worker: RollupSchedules error: %v", err)
		return
	}
	for _, id := range schedules {
		if _, err := w.proctor.RefreshRollup(ctx, id); err != nil {
			log.Printf("worker: RefreshRollup schedule=%s error: %v", id, err)
		}
	}
}

// runTimeoutReconcileCycle is called on a bounded cadence in both continuous
// and activity-driven deployments. The success log doubles as a worker-health
// heartbeat; errors are visible even when the student is disconnected.
func (w *Runner) runTimeoutReconcileCycle(ctx context.Context, at time.Time) error {
	started := time.Now()
	n, err := w.delivery.ReconcileTimeouts(ctx, at.UTC(), maintenance.SATRepairBatch)
	if err != nil {
		log.Printf("worker: SATTimeoutReconcile failed error=%v duration=%s", err, time.Since(started))
		telemetry.IncCounter(telemetry.MJobFailures, "job", "sat_timeout_reconcile")
		return err
	}
	log.Printf("worker: SATTimeoutReconcile healthy finalized=%d duration=%s", n, time.Since(started))
	return nil
}

// runMaintenanceCycle runs reconciliation, repair, audit, retention, media.
func (w *Runner) runMaintenanceCycle(ctx context.Context, at time.Time) {
	defer observeJobDuration("maintenance", time.Now())
	// B3.2b: row-first blob flush for recently-active V2 attempts (bounded
	// batch; seal already materializes synchronously so this only bounds
	// read-view staleness for lazy readers). Gated on ROW_FIRST_WRITES.
	if w.cfg.RowFirstWrites {
		if n, err := attempts.FlushStaleBlobs(ctx, w.db, 50); err != nil {
			log.Printf("worker: FlushStaleBlobs error: %v", err)
		} else if n > 0 {
			log.Printf("worker: FlushStaleBlobs flushed=%d", n)
		}
	}
	if err := w.FlushPresence(ctx); err != nil {
		log.Printf("worker: FlushPresence error: %v", err)
	}
	// Plan D4: rollup refresh (ROLLUP=on): GROUP BY per live schedule every
	// 5s into shared_cache_entries (bounded: live schedules only, one
	// query each). Off keeps the full roster path.
	if w.cfg.RollupEnabled {
		w.refreshRollups(ctx)
	}
	if n, err := w.sat.ReconcileProvisional(ctx); err != nil {
		log.Printf("worker: ReconcileSATProvisionalCompletion error: %v", err)
	} else {
		log.Printf("worker: ReconcileSATProvisionalCompletion repaired=%d", n)
		if age, aerr := w.sat.OldestProvisionalAgeSeconds(ctx); aerr != nil {
			log.Printf("worker: SATProvisionalAge probe: %v", aerr)
		} else {
			telemetry.SetGauge(telemetry.MSATPendingAge, float64(age))
		}
	}
	if n, err := terminalization.RepairSATResults(ctx, w.db, maintenance.SATRepairBatch); err != nil {
		log.Printf("worker: RepairSATTerminalResults error: %v", err)
	} else {
		log.Printf("worker: RepairSATTerminalResults repaired=%d", n)
		if n > 0 {
			telemetry.IncCounter(telemetry.MRepairMissing)
		}
	}
	if n, err := terminalization.RepairMissingReceipts(ctx, w.db, maintenance.SATRepairBatch); err != nil {
		log.Printf("worker: RepairMissingTerminalReceipts error: %v", err)
	} else {
		log.Printf("worker: RepairMissingTerminalReceipts repaired=%d", n)
		if n > 0 {
			telemetry.IncCounter(telemetry.MRepairMissing)
		}
	}
	if issues, err := maintenance.AuditInvariants(ctx, w.db); err != nil {
		log.Printf("worker: RunTerminalInvariantAudit error: %v", err)
	} else {
		for _, iss := range issues {
			// Each finding counts toward terminal_invariant_violation_total.
			log.Printf("worker: invariant violated metric=%s name=%s count=%d detail=%s",
				telemetry.MInvariantViol, iss.Name, iss.Count, iss.Detail)
			telemetry.IncCounter(telemetry.MInvariantViol, "name", iss.Name)
		}
		log.Printf("worker: RunTerminalInvariantAudit issues=%d", len(issues))
	}
	if rep, err := maintenance.RunRetention(ctx, w.db, maintenance.BudgetNormal); err != nil {
		log.Printf("worker: RunRetention error: %v", err)
	} else {
		log.Printf("worker: RunRetention total=%d cache=%d idempotency=%d authoringKeys=%d sessions=%d heartbeats=%d mutations=%d outbox=%d ratelimit=%d live=%d leases=%d",
			rep.Total(), rep.CacheRows, rep.IdempotencyRows, rep.AuthoringOpKeyRows, rep.UserSessionRows, rep.HeartbeatRows,
			rep.MutationRows, rep.OutboxRows, rep.RateLimitRows, rep.LiveUpdateRows, rep.LeaseRows)
	}
	if rep, err := maintenance.RunMedia(ctx, w.db); err != nil {
		log.Printf("worker: RunMediaCleanup error: %v", err)
	} else {
		log.Printf("worker: RunMediaCleanup total=%d orphaned=%d deleted=%d", rep.Total(), rep.OrphanedRows, rep.DeletedRows)
	}
	if rep, err := maintenance.NormalizeMediaDownloadURLs(ctx, w.db, maintenance.MediaBatch); err != nil {
		log.Printf("worker: NormalizeMediaDownloadURLs error: %v", err)
	} else {
		log.Printf("worker: NormalizeMediaDownloadURLs normalized=%d legacy_before=%d", rep.NormalizedURLRows, rep.LegacyRouteRows)
	}
	if w.act != nil {
		if n, err := w.act.RepairCanonicalRows(ctx, maintenance.ACTRepairBatch); err != nil {
			log.Printf("worker: RepairACTCanonicalResults repaired=%d error=%v", n, err)
		} else {
			log.Printf("worker: RepairACTCanonicalResults repaired=%d", n)
		}
	}
	log.Printf("worker: maintenance cycle at %s done", at.UTC().Format(time.RFC3339))
}
