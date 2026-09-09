// Command worker runs background jobs: outbox drain, runtime/SAT
// reconciliation, terminal repairs + audits, grading projection, retention
// and media cleanup.
//
// Hot cycle (every worker fallback interval): bounded outbox drain (at most
// 20 claim batches of at most OUTBOX_BATCH_SIZE rows under a 60s lease) plus
// the grading projection when GRADING_PROJECTION_ENABLED. Slow cycle (every
// worker maintenance interval): SAT reconciliation, terminal repairs,
// invariant audit, retention and media cleanup.
package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strings"
	"sync"
	"time"

	"example.com/ielts-proctoring/internal/act"
	"example.com/ielts-proctoring/internal/attempts"
	"example.com/ielts-proctoring/internal/delivery"
	"example.com/ielts-proctoring/internal/liveupdates"
	"example.com/ielts-proctoring/internal/maintenance"
	"example.com/ielts-proctoring/internal/outbox"
	"example.com/ielts-proctoring/internal/platform/clock"
	"example.com/ielts-proctoring/internal/platform/config"
	"example.com/ielts-proctoring/internal/platform/db"
	"example.com/ielts-proctoring/internal/platform/shutdown"
	"example.com/ielts-proctoring/internal/platform/telemetry"
	"example.com/ielts-proctoring/internal/platform/tx"
	"example.com/ielts-proctoring/internal/proctor"
	"example.com/ielts-proctoring/internal/sat"
	"example.com/ielts-proctoring/internal/student"
	"example.com/ielts-proctoring/internal/terminalization"
)

// Jobs enumerates the background job set (mirrors the Rust worker cycles:
// hot outbox+projection pass plus slower maintenance pass).
var Jobs = []string{
	"DrainOutbox",
	"ReconcileRuntimeTimeouts",
	"ReconcileExpiredSections",
	"ReconcileSATModules",
	"ReconcileSATProvisionalCompletion",
	"RepairSATTerminalResults",
	"RepairMissingTerminalReceipts",
	"RunTerminalInvariantAudit",
	"RunGradingProjection",
	"RunRetention",
	"RunMediaCleanup",
}

// worker carries the handles every background job needs. Dependencies are
// wired once in main and passed explicitly; there is no package-level state.
type worker struct {
	cfg      config.Config
	db       *sql.DB
	outbox   *outbox.Repository
	sat      *sat.Service
	delivery *delivery.Service
	proctor  *proctor.Service
	student  *student.Service
	terminal *terminalization.Service
	liveBus  *liveupdates.Bus
	workerID string
}

func main() {
	cfg := config.Load()
	if err := cfg.ValidateForRuntime(); err != nil {
		log.Fatalf("worker: invalid config: %v", err)
	}
	pool, err := db.OpenRole(cfg, db.RoleWorker)
	if err != nil {
		log.Fatalf("worker: open db: %v", err)
	}
	defer func() { _ = pool.Close() }()

	// Plan E3: report absorbed tx transients on db_deadlocks_total{kind}.
	defer tx.SetRetryHook(func(err error) {
		kind := "conntransient"
		lower := strings.ToLower(err.Error())
		if strings.Contains(lower, "deadlock") {
			kind = "deadlock"
		} else if strings.Contains(lower, "lock wait timeout") || strings.Contains(lower, "try restarting transaction") {
			kind = "lockwait"
		}
		telemetry.IncCounter(telemetry.MDeadlocks, "kind", kind)
	})()
	runner := tx.NewRunner(pool)
	actService := act.NewService(pool, runner)
	satService := sat.NewService(pool, runner, clock.System{}, nil)
	terminal := terminalization.NewService(runner, nil, nil).SetAttemptScorer(actService).SetOutboxExecOnly(cfg.OutboxExecOnly)
	workerID := newWorkerID()
	claimMode := outbox.ClaimUpdate
	if cfg.OutboxClaimMode == config.OutboxClaimSkipLocked {
		claimMode = outbox.ClaimSkipLocked
	}
	w := &worker{
		cfg:    cfg,
		db:     pool,
		outbox: outbox.NewRepository(pool).WithClaim(cfg.WorkerClaimPartitions, 0, claimMode),
		sat:    satService,
		delivery: delivery.NewService(pool, runner).SetCompleter(func(ctx context.Context, scheduleID, attemptID string) error {
			var providerKey string
			if err := pool.QueryRowContext(ctx, "SELECT e.provider_key FROM student_attempts a JOIN exam_entities e ON e.id = a.exam_id WHERE a.id = ? AND a.schedule_id = ?", attemptID, scheduleID).Scan(&providerKey); err != nil {
				return err
			}
			switch providerKey {
			case "sat":
				return satService.ReconcileAdapter()(ctx, scheduleID, attemptID)
			case "act":
				_, err := terminal.Terminalize(ctx, terminalization.SealCommand{
					AttemptID: attemptID, ScheduleID: scheduleID,
					Outcome: terminalization.OutcomeTerminated, Reason: terminalization.ReasonTimeExpired,
					ActorKind: terminalization.ActorSystem,
					RequestID: "timeout-" + attemptID,
				})
				return err
			default:
				return nil
			}
		}),
		proctor:  proctor.NewService(runner, pool, terminal, nil, proctor.SQLAssignmentChecker{}).SetOutboxExecOnly(cfg.OutboxExecOnly),
		student:  student.NewService(pool, nil).SetPresence(student.NewPresenceMap(student.DefaultPresenceTTL)),
		terminal: terminal,
		liveBus:  liveupdates.NewBus(pool, workerID),
		workerID: workerID,
	}

	log.Printf("worker: starting job set=%v fallback_interval=%ds maintenance_interval=%ds",
		Jobs, cfg.WorkerFallbackIntervalSecs, cfg.WorkerMaintenanceIntervalSecs)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() {
		shutdown.Wait(ctx)
		log.Printf("worker: shutdown signal received, draining")
		cancel()
	}()

	fallback := time.Duration(cfg.WorkerFallbackIntervalSecs) * time.Second
	if fallback <= 0 {
		fallback = 5 * time.Second
	}
	slowEvery := time.Duration(cfg.WorkerMaintenanceIntervalSecs) * time.Second
	if slowEvery <= 0 {
		slowEvery = 5 * time.Minute
	}
	hot := time.NewTicker(fallback)
	defer hot.Stop()
	slow := time.NewTicker(slowEvery)
	defer slow.Stop()

	for {
		select {
		case <-ctx.Done():
			log.Printf("worker: stopped")
			return
		case t := <-hot.C:
			w.runHotCycle(ctx, t)
		case t := <-slow.C:
			w.runMaintenanceCycle(ctx, t)
		}
	}
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
func (w *worker) drainOutbox(ctx context.Context, repo *outbox.Repository, limit int) (claimed, published, failed int64, rounds int) {
	for ; rounds < maintenance.OutboxDrainMaxRounds; rounds++ {
		token, events, err := repo.ClaimBatch(ctx, limit, w.workerID, outbox.ClaimLeaseSecs)
		if err != nil {
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
	return claimed, published, failed, rounds
}

func (w *worker) runHotCycle(ctx context.Context, at time.Time) {
	defer observeJobDuration("hot", time.Now())
	if w.db != nil {
		observeWorkerPoolStats(w.db)
	}
	if w.proctor != nil {
		var serverNow time.Time
		if err := w.db.QueryRowContext(ctx, "SELECT UTC_TIMESTAMP(6)").Scan(&serverNow); err != nil {
			log.Printf("worker: ReconcileExpiredSections clock query failed: %v", err)
			telemetry.IncCounter(telemetry.MJobFailures, "job", "reconcile_expired_sections")
		} else if outcomes, err := w.proctor.ReconcileExpiredSections(ctx, serverNow, maintenance.SATRepairBatch, w.workerID); err != nil {
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
		claimed, published, failed, rounds = w.drainOutbox(ctx, w.outbox, limit)
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
				c, p, f, r := w.drainOutbox(ctx, part, perLimit)
				mu.Lock()
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
}

// publishWakeup relays only the event families that are part of the live
// update contract. Other non-executable outbox families (for example password
// reset notifications) are intentionally acknowledged without becoming live
// frames.
func (w *worker) publishWakeup(ctx context.Context, event outbox.Event) error {
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
	return w.liveBus.Append(ctx, kind, event.AggregateID, event.Revision, event.Family, payload)
}

// markFailed records a publish failure; the retry disposition and delay come
// from BackoffFor via MarkFailed (terminal at >= MaxAttempts).
func (w *worker) markFailed(ctx context.Context, token string, e outbox.Event, msg string) {
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

// executeOutboxEvent applies executable application work before the outbox
// row is acknowledged. Sealing is idempotent, so a retry after a worker
// crash replays the receipt instead of creating a second terminal fact.
func (w *worker) executeOutboxEvent(ctx context.Context, event outbox.Event) error {
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
	for _, attemptID := range payload.AttemptIDs {
		var providerKey, proctorStatus string
		if err := w.db.QueryRowContext(ctx, `
			SELECT e.provider_key, COALESCE(a.proctor_status, 'active')
			FROM student_attempts a JOIN exam_entities e ON e.id = a.exam_id
			WHERE a.id = ? AND a.schedule_id = ?`, attemptID, payload.ScheduleID).Scan(&providerKey, &proctorStatus); err != nil {
			if sealed > 0 {
				log.Printf("worker: auto-submit schedule=%s sealed=%d then error (resume on retry): %v", payload.ScheduleID, sealed, err)
			}
			return fmt.Errorf("load auto-submit attempt %s: %w", attemptID, err)
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
		if _, err := w.terminal.Terminalize(ctx, terminalization.SealCommand{
			AttemptID: attemptID, ScheduleID: payload.ScheduleID,
			Outcome: outcome, Reason: reason,
			ActorKind: actorKind, ActorID: actorID, FinalSubmission: finalSubmission,
			RequestID: event.ID,
		}); err != nil {
			if sealed > 0 {
				log.Printf("worker: auto-submit schedule=%s sealed=%d then error (resume on retry): %v", payload.ScheduleID, sealed, err)
			}
			return fmt.Errorf("auto-submit attempt %s: %w", attemptID, err)
		}
		sealed++
		if sealed%autoSubmitCursorBatch == 0 {
			log.Printf("worker: auto-submit schedule=%s sealed=%d (progress)", payload.ScheduleID, sealed)
		}
	}
	log.Printf("worker: auto-submit schedule=%s sealed=%d done", payload.ScheduleID, sealed)
	return nil
}

// autoSubmitCursorBatch bounds one fan-out page (plan B4.4).
const autoSubmitCursorBatch = 500

// listAutoSubmitAttempts pages eligible attempts by id cursor
// (WHERE schedule_id = ? AND ... AND a.id > ? ORDER BY a.id LIMIT ?),
// logging progress per page. The table alias keeps the predicate stable
// if the eligibility shape changes; the cursor column (PK id) is indexed
// so pages stay point-ranged, not offset-scanned.
func (w *worker) listAutoSubmitAttempts(ctx context.Context, scheduleID string, batch int) ([]string, error) {
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
func (w *worker) refreshRollups(ctx context.Context) {
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

// runMaintenanceCycle runs reconciliation, repair, audit, retention, media.
func (w *worker) runMaintenanceCycle(ctx context.Context, at time.Time) {
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
	// Plan D2: presence flush runs FIRST (60s cadence). Single-deploy runs
	// api+worker as SEPARATE processes (start.sh supervises both), so the
	// API-owned PresenceMap is NOT visible here — this drain only covers a
	// same-process embedding. The durable path stays correct regardless:
	// transitions are integrity-relevant only, and the 60s DB staleness for
	// presence analytics is the documented plan risk. A future step can
	// move the flush into the API process (in-process ticker) to close the
	// loop; until then PRESENCE_MODE=memory is exam-day-only with the
	// inline tx as rollback. Gated on memory; inline has nothing to flush.
	if w.cfg.PresenceMemory() && w.student != nil && w.student.PresenceMap() != nil {
		if dirty := w.student.PresenceMap().DrainDirty(); len(dirty) > 0 {
			if err := w.student.FlushPresence(ctx, dirty); err != nil {
				log.Printf("worker: FlushPresence error: %v", err)
			} else {
				log.Printf("worker: FlushPresence flushed=%d", len(dirty))
			}
		}
	}
	// Plan D4: rollup refresh (ROLLUP=on): GROUP BY per live schedule every
	// 5s into shared_cache_entries (bounded: live schedules only, one
	// query each). Off keeps the full roster path.
	if w.cfg.RollupEnabled {
		w.refreshRollups(ctx)
	}
	if n, err := w.delivery.ReconcileTimeouts(ctx, time.Now().UTC(), maintenance.SATRepairBatch); err != nil {
		log.Printf("worker: ReconcileRuntimeTimeouts error: %v", err)
	} else {
		log.Printf("worker: ReconcileRuntimeTimeouts reconciled=%d", n)
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
	if n, err := w.sat.ReconcileModuleTimeouts(ctx, time.Now().UTC(), maintenance.SATRepairBatch); err != nil {
		log.Printf("worker: ReconcileSATModules error: %v", err)
	} else {
		log.Printf("worker: ReconcileSATModules finalized=%d", n)
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
		log.Printf("worker: RunRetention total=%d cache=%d idempotency=%d sessions=%d heartbeats=%d mutations=%d outbox=%d ratelimit=%d live=%d leases=%d",
			rep.Total(), rep.CacheRows, rep.IdempotencyRows, rep.UserSessionRows, rep.HeartbeatRows,
			rep.MutationRows, rep.OutboxRows, rep.RateLimitRows, rep.LiveUpdateRows, rep.LeaseRows)
	}
	if rep, err := maintenance.RunMedia(ctx, w.db); err != nil {
		log.Printf("worker: RunMediaCleanup error: %v", err)
	} else {
		log.Printf("worker: RunMediaCleanup total=%d orphaned=%d deleted=%d", rep.Total(), rep.OrphanedRows, rep.DeletedRows)
	}
	log.Printf("worker: maintenance cycle at %s done", at.UTC().Format(time.RFC3339))
}
