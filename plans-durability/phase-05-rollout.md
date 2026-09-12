# Phase 05 — Staged Rollout: dogfood → pilot → full (runbook-driven)

> Lane: student-answer durability close-out · Stage: PLAN ONLY (no code changes)
> Overall plan: `plans-durability/overall-plan.md` (goal, blockers B1/B2/B3, phases, ownership, standing rules)
> Runbook source of truth: `docs/runbooks/student-answer-durability.md`
> Ownership: runbook + rollout config ONLY. No edits to `src/`, `backend/`, `e2e/`, `docs/`, `k6/`.
> Depends on: Phase 04 complete (L4-A + L4-B re-run 0 BLOCKING, final gate green-or-waived, goal resumed).
> Wave: Wave 3 (after Phase 04). Rollout reports back as follow-up; the roadmap goal is already complete in Phase 04.

## 1. Objective

Execute the staged client-bundle rollout defined in runbook §1–§6
(`docs/runbooks/student-answer-durability.md:10-25`) with monitors watched at
every stage, rollback staged before stage 1, and triage/support briefed.
Backend contract is unchanged (fencing, version uniqueness, writeId
idempotency, monotonic projection, superseded acks — pinned by
`backend/go/internal/attempts/durability_contract_test.go`, not changed per
runbook :4-8), so every stage deploys the same API with a NEW client bundle;
rollback is a previous-bundle redeploy with no migration to reverse (runbook
:8, :12-16, :39-40; overall plan §6 standing rules).

Success = all three stages entered in order with exit criteria evidenced from
monitors + support-ticket watch, zero skipped stages, rollback path confirmed
staged before dogfood entry, and a rollout report filed as follow-up (goal
already complete — this phase does not re-complete it).

## 2. Dependencies

| Dependency | State required before Phase 05 starts | Evidence |
|---|---|---|
| Phase 04 | L4-A + L4-B re-run 0 BLOCKING on final tree; final gate recorded (02/03 green-or-waived); goal resumed then marked complete | Phase 04 gate record + goal rev |
| Phase 01 output | `e2e/student-durability.spec.ts` 5/5 + `smoke` control green (rollout confidence) | Playwright output pasted in Phase 01 record |
| Rollback bundle | Previous production client bundle built, tagged, staged for one-command redeploy (§5 below) | Bundle tag + redeploy dry-run log |
| Dashboards | §3 monitor queries (below) live with dogfood baselines recorded at stage entry | Dashboard screenshots/links + baseline numbers |
| On-call + support | Briefed on §4 triage (preserve-evidence-first) and status vocabulary (§6) | Briefing note + attendee list |

Do NOT enter stage 1 until all five rows hold. Re-entry after any rollback
restarts at stage 1 (runbook :24-25).

## 3. Affected / new files (ownership boundary)

Allowed to create/edit in this phase (runbook + rollout config ONLY):

| File | Action | Purpose |
|---|---|---|
| `docs/runbooks/student-answer-durability.md` | READ ONLY in this phase (already landed; L4-B runbook-accuracy OK per runbook :46-53 — flag prod-settable, alerting slices quarantine_failed by reason) | Source of truth for stages, triggers, triage, vocabulary. Do not rewrite mid-rollout; file corrections as follow-up |
| Rollout tracker (new, suggested `plans-durability/phase-05-rollout-log.md`) | CREATE | Per-stage entry/exit record: dates, cohort, baseline numbers, monitor snapshots, support-ticket count, rollback-drill result, sign-off |
| Rollout config (deploy pipeline / release flags OUTSIDE this repo — e.g. hosting/CDN release record) | UPDATE (config only) | Cohort selection (staff/synthetic → single schedule → all), bundle tags per stage. No code, no schema migration, no server flag flip (runbook :39-40) |

Explicitly OUT OF SCOPE (any defect found → rollback + file fix against the
engine lane, re-enter at stage 1; never hot-patch during a stage):

- `src/shared/durability/DurableResponseEngine.ts` (engine, telemetry emission, submit guard)
- `src/shared/durability/useResponseDurabilityStatus.ts` (mapper + gate copy — single owner)
- `src/shared/durability/types.ts` (engine/display status types)
- `src/components/student/providers/StudentAttemptProvider.tsx`, `src/features/student-delivery/hooks/useSatResponsePersistence.ts`
- `src/components/student/answerMutationDebug.ts` (redaction/sanitizer)
- `backend/`, `e2e/`, `k6/`, any migration or new dependency

## 4. Contracts / interfaces (read-only grounding — do not reimplement)

Implementation agents execute this runbook WITHOUT redesigning. Every monitor
and triage step below is grounded in these real tree locations:

### 4.1 Telemetry emission points (engine → onDurabilityEvent hook)

Best-effort reason-coded hook, never throws, never carries payload content
(`src/shared/durability/DurableResponseEngine.ts:2276-2279`;
option declared at :46-50, wired at :296-308). Providers forward to the
telemetry pipeline; dashboards query the forwarded series.

| Event | Emission site(s) | Fields | Runbook meaning |
|---|---|---|---|
| `intent_queued_during_recovery` | `DurableResponseEngine.ts:467` | `attemptId, scheduleId` | Input during unseeded recovery (runbook :56-58) |
| `checkpoint_sync_failed` | `:551` | — | Sync-intent checkpoint failure; page storage triage on sustained rise (:72-73) |
| `control_epoch_blocked` | `:580, :859, :1702, :1772` | `reason: CONTROL_EPOCH_STALE, controlEpoch` | Batch fenced by pause/resume boundary; reconcile should follow (:63-65) |
| `version_collision` | `:1235, :1432, :1235(submit :1235)` | `reason: VERSION_COLLISION` | Reused client version under different writeId; fence working (:59-62) |
| `reconcile_succeeded` | `:1935` | — | Blocked draft re-issued under new epoch as NEW writeId/version (:66-68) |
| `reconcile_failed` | `:1825, :1834, :1847, :1852-1857, :1859, :1866-1867, :1872, :1912-1913, :1918` | `reason:` `reconcile_in_progress \| engine_not_writable \| snapshot_fetch_failed \| blocked_superseded \| snapshot_not_authoritative \| attempt_terminal \| lease_changed \| server_newer` | Slice by `reason` (see §7 monitor queries) |
| `quarantine_archived` | `:2124` | `reason` (fence reason) | Archive-before-delete success (:69-71) |
| `quarantine_failed` | `:2118, :2161` | `reason: quarantine_archive_failed` | Archive-before-delete fault — slice by `reason`; sustained > 0 is rollback-trigger candidate (runbook :69-71, :86-88) |
| `quarantine_pruned` | `:2052` (via `pruneQuarantined` :2040-2058) | `reason: ack-superseded \| discard, questionId, count` | ONLY prune triggers (spec-exact, :2032-2039). No silent eviction — ledger may exceed 50 until prune fires (see §8 edge case) |
| `durability_fault` | NOT an event — engine STATUS via `getStatus()` (`types.ts:116-123`; set at engine :548, :1115, :1280, :2115, :2158) | — | Alert on `quarantine_failed` / `checkpoint_sync_failed` counter movement; use `durability_fault` status for CORRELATION, not as thresholded count (runbook :86-91) |

### 4.2 Status vocabulary (what the UI may say — runbook §6, :128-146)

- Engine statuses (`src/shared/durability/types.ts:116-123`): `synced | saving | saved_locally | blocked_attention | durability_fault | conflict_fenced | conflict_terminal`.
- Display vocabulary, BOTH providers via shared mapper
  (`src/shared/durability/useResponseDurabilityStatus.ts:17-22, :63-82`,
  single-owner rule :8-15): `saving | saved_locally | blocked_attention | conflict | saved | error`.
- Mapping pins (`mapEngineStatus`, :67-82): blocked wins over everything
  (even `synced` + blocked → `blocked_attention`); `conflict_fenced/terminal` → `conflict`; `durability_fault` → `error`; `saved_locally` → `saved_locally`; ONLY `synced` → `saved` (I4: server-acked ONLY, :79-81). BANNED: unacked/blocked → "saved".
- Null engine → `"saving"` (never `"saved"`, :130-135, :140-143).
- Recovery surface providers expose (runbook §6, :150-155):
  `blockedQuestionIds: string[]` (`StudentAttemptProvider.tsx:68, :276, :2131`),
  `quarantinedCount: number` (:70, :277, :2132),
  `reconcileBlockedResponse(questionId): Promise<ReconcileBlockedResult>` (:103, :2066-2120;
  results `"reconciled" | "not-blocked" | "refusal" | "error:*"` per
  `useResponseDurabilityStatus.ts:55-61`).

### 4.3 Submit gate (two layers)

1. Provider layer (user-facing): throws `blockedSubmitGateMessage(blockedCount, quarantinedCount)`
   (`useResponseDurabilityStatus.ts:46-52`) — blocked copy vs quarantine-only
   copy, byte-identical across IELTS + SAT (mapper-contract test pins both
   import sites). Gate fires ONLY when blocked/quarantined present.
2. Engine backstop (`DurableResponseEngine.ts:1203-1207`): `submit()` throws
   `"Blocked drafts need attention before submit. Reconcile or discard them first."`
   when `getBlockedCount() > 0` — defense-in-depth so submit can never
   silently drop visible work (pinned by engine test :799
   `rejects.toThrow(/Blocked drafts need attention/)`).

### 4.4 Debug-log privacy envelope (L4-B runbook-accuracy basis)

`src/components/student/answerMutationDebug.ts:1-140` — default-deny +
allowlist sanitizer, IDs-only contract; gated by `student.answerMutationDebug`
localStorage OR sessionStorage `1/true/on` (:63-78); flag IS settable in
prod so safety rests on the sanitizer, not a build gate (runbook :46-53).
Redaction proven by
`src/components/student/__tests__/answerMutationDebug.redaction.test.ts`
(62/62 durability suites include 8 redaction). Rollout implication: support
may ask for the debug flag on an affected machine ONLY with the sanitizer
unchanged; never paste unsanitized storage into tickets.

## 5. Step-by-step implementation (runbook-driven)

### Step 0 — Pre-stage checklist (before dogfood entry)

1. Confirm Phase 04 record: L4 re-run 0 BLOCKING, final gate, goal complete.
2. Tag previous production client bundle as rollback bundle (record tag in rollout log).
3. Bring §7 dashboards live; verify each query returns data (even if zero) over the last 24h.
4. Record dogfood baselines for every series in §7 (numbers, not "looks fine").
5. Brief on-call + support on §9 triage + evidence-preservation order + status vocabulary card (§9.4).
6. Dry-run rollback redeploy against a non-prod slot; record wall time + verification output.
7. Open rollout log (`plans-durability/phase-05-rollout-log.md`) with stage-1 entry block.

### Step 1 — Stage 1: Dogfood (internal staff / synthetic attempts)

- Entry criteria (runbook :20): focused suites green (engine/provider tests,
  `go test ./internal/attempts ./internal/runtime`); redaction test green.
  All already evidenced in Phase 04 — copy the evidence links into the log.
- Deploy new client bundle to dogfood cohort only (same API, namespaced keys
  `response-checkpoint:v2:*`, `v2_attempt_*`, `v2_quarantine:*` per runbook
  :13-16 — old cached bundles ignore them).
- Watch §7 monitors continuously; record snapshots at entry, +24h, exit.
- Support-ticket watch: ANY "answer disappeared / answer changed itself /
  flagged as saved but lost" = P1 until §4 triage rules out loss (runbook :82-84).
- Exit criteria (runbook :20, ALL must hold):
  1. Zero confirmed loss events (§6 trigger 1 definition).
  2. No archive-fault spike (§6 trigger 2 vs baseline).
  3. No submit-gate anomaly (§6 trigger 3).
  4. No new "answer disappeared" support reports (or all triaged to non-loss with evidence).
- On exit: sign stage-1 block in log, carry baselines forward to pilot.

### Step 2 — Stage 2: Pilot (one small live cohort — single schedule)

- Entry criteria (runbook :21): dogfood exit met (link log) + §7 dashboards
  live + on-call briefed on §4 triage (link briefing note).
- Deploy to the single pilot schedule only. Confirm cohort scoping (no bleed
  into other schedules) before opening the exam window.
- Watch §7 monitors for the whole pilot window; add baseline-parity check on
  `version_collision` / `control_epoch_blocked` (timing-only reconcile
  noise, not loss — runbook :21-22).
- Exit criteria (runbook :21, ALL must hold, sustained over the pilot window):
  same four as dogfood + baseline parity on `version_collision` /
  `control_epoch_blocked`.
- On exit: sign stage-2 block; confirm rollback bundle STILL staged (§6 action).

### Step 3 — Stage 3: Full (all schedules)

- Entry criteria (runbook :22): pilot exit met + rollback bundle staged.
- Deploy to all schedules. Sustain parity for ONE FULL exam window (runbook :22).
- Any rollback trigger (§6) pulls back IMMEDIATELY — no "watch one more window".
- On sustained parity: sign stage-3 block, file rollout report (follow-up),
  close Phase 05 per §11 DoD.

### Step 4 — Rollback drill (once, before or during dogfood)

- Redeploy previous bundle to a non-prod slot, verify old bundle boots against
  current API (contract unchanged — expected to interoperate, runbook :39-40).
- Record: redeploy command, wall time, verification output. This is the
  rollback-path confirmation required by DoD.

## 6. Rollback triggers + procedure

### 6.1 Triggers — ANY ONE rolls back (runbook §2, :29-37)

Concrete thresholds (instantiate against the dogfood baseline recorded in Step 0;
thresholds below are defaults — the rollout log may tighten, never loosen):

1. **Confirmed new loss** (threshold: ≥ 1): a visibly accepted
   answer/flag/elimination/annotation is replaced, dropped, or relabeled
   "saved" without a server ack (invariant I4 violated). Only the "permanent
   loss" / "replaced confirmed answer" triage classes (§9) meet this trigger.
   UI rollback / rejected-write-surfaced do NOT (runbook :110-117).
2. **Archive-fault spike** (threshold: `quarantine_failed{reason="quarantine_archive_failed"}`
   sustained > 0 over a 15-min window, OR any rise in `checkpoint_sync_failed`
   correlated with `durability_fault` status reports above the dogfood
   baseline): sustained rise in `quarantine_archive_failed` or
   `durability_fault` above baseline (runbook :34-35). Single transient
   blip → triage first; sustained → roll back.
3. **Submit-gate anomaly** (threshold: ≥ 1 confirmed case EITHER WAY):
   blocked/quarantined drafts silently excluded from submit, OR the gate
   refuses to engage when blocked drafts exist (runbook :36-37).

### 6.2 Procedure (runbook :39-42)

1. Redeploy the PREVIOUS client bundle (tag from Step 0). No migration to
   reverse, no data backfill, no server flag flip. Old and new bundles
   interoperate against the same API.
2. BEFORE any storage clearing on incident machines: preserve evidence per
   §9.1 (storage export, ledger, acks, control events). Clearing destroys the
   tombstones/checkpoints that distinguish loss from honest blocking (runbook :99-101).
3. Record the incident evidence + trigger class in the rollout log.
4. Re-entry restarts at STAGE 1 with a fix (runbook :24-25). Do not skip stages.

## 7. Monitoring — concrete queries per stage (runbook §3, :44-91)

All counters reason-coded, never answer text or student PII (runbook :46-49).
Adapt the metric prefix to the pipeline (examples use `durability_` prefix
and PromQL-style; LogQL/Analytics equivalents in comments). Baselines recorded
at each stage entry; alerts compare against the CURRENT stage baseline.

### Q1 — quarantine_failed sliced by reason (rollback-trigger candidate)

```promql
# Archive-before-delete faults, separable from other quarantine outcomes (runbook :86-88)
sum by (reason) (rate(durability_quarantine_failed_total[15m]))
# Expected: 0 sustained. Alert: > 0 for 15m on reason="quarantine_archive_failed".
# Log equivalent: count(name="quarantine_failed") GROUP BY fields.reason
```

Complementary health series on the same panel:

```promql
sum by (reason) (rate(durability_quarantine_archived_total[15m]))
sum by (reason) (rate(durability_quarantine_pruned_total[15m]))
# pruned reasons MUST be only "ack-superseded" | "discard" (engine :2040-2058).
# Any other reason value = unexpected emitter → triage as defect, not noise.
```

### Q2 — durability_fault STATUS rate (correlation, NOT a counter — runbook :88-91)

`durability_fault` is `DurableResponseEngine.getStatus()`, not a counter.
Do NOT threshold-count it. Correlate instead:

```promql
# Fault-adjacent counter movement (alert on THESE):
sum(rate(durability_quarantine_failed_total[15m]))
sum(rate(durability_checkpoint_sync_failed_total[15m]))
# Correlate with: status reports / session flags where getStatus()=="durability_fault"
# (provider-published error display; support-ticket join key).
# Expected: flat at dogfood baseline. Alert: sustained rise on either counter
# + any session reporting durability_fault status → storage triage (runbook :72-73).
```

Watch rule: a `durability_fault` status WITHOUT a matching
`quarantine_failed`/`checkpoint_sync_failed` movement is still triaged
(tombstone-write failure path, engine :2155-2162) — do not dismiss for lack
of counter movement.

### Q3 — reconcile success/failure ratio (with reason slice)

```promql
sum(rate(durability_reconcile_succeeded_total[15m]))
  /
(clamp_min(sum(rate(durability_reconcile_succeeded_total[15m]))
  + sum(rate(durability_reconcile_failed_total[15m])), 1))
# Expected: ~1.0 outside proctor-action windows. Alert: reconcile_failed > 0
# sustained needs triage (runbook :67-68).

sum by (reason) (rate(durability_reconcile_failed_total[15m]))
# reason ∈ reconcile_in_progress | engine_not_writable | snapshot_fetch_failed
#   | blocked_superseded | snapshot_not_authoritative | attempt_terminal
#   | lease_changed | server_newer (engine :1825-1918).
# Benign-leaning: lease_changed / attempt_terminal / server_newer after a
#   takeover or submit (refusals by design — never replay across a lease
#   change or terminal fence, runbook :124-126). Still logged; spike → triage.
# Actionable: snapshot_fetch_failed / snapshot_not_authoritative sustained
#   (snapshot pipeline, not student behavior).
```

### Q4 — blocked_attention dwell (per-question attention backlog)

Derived from provider-published `blockedQuestionIds` / engine
`control_epoch_blocked` events (NOT a raw counter — dwell needs state):

```promql
# Arrival: timing-only fences per question
sum by (questionId) (rate(durability_control_epoch_blocked_total[15m]))
# Departure: successful reconciles
sum(rate(durability_reconcile_succeeded_total[15m]))
# Panel rule: join arrivals − departures per cohort; alert when
# distinct blocked questionIds with no reconcile_* event within 30m grows
# above the stage baseline (stuck reconcile path, not normal attention).
```

Operational shorthand when per-question join is unavailable: track
`max(blockedCount)` / `p95(blockedCount dwell minutes)` from provider state
snapshots + support "needs attention before submit" message volume
(`blockedSubmitGateMessage` firings). A rising dwell with flat
`reconcile_succeeded` = reconcile path broken → triage before it becomes a
submit-gate anomaly (§6 trigger 3).

### Q5 — baseline-parity pair (pilot/full exit evidence)

```promql
sum by (reason) (rate(durability_version_collision_total[15m]))
sum(rate(durability_control_epoch_blocked_total[15m]))
# Expected: occasional version_collision = fence working; spike from a single
# client build = version-seeding regression (:59-62). control_epoch_blocked
# expected around proctor actions with reconcile following (:63-65).
# Pilot/full exit requires parity with dogfood baseline, not zero.
```

### Q6 — support-ticket watch (alert posture, runbook :80-84)

Any "answer disappeared / answer changed itself / flagged as saved but lost"
report = P1 until §4 triage rules out loss. Track ticket count per stage in
the rollout log alongside the monitor snapshots; zero-ticket stages still
record "0 reports in window [from–to]".

## 8. Edge-case watches (must-monitor, not must-fix-in-phase)

These are KNOWN behaviors that look like anomalies to an unbriefed on-call.
Each has a grounded expectation; deviation from the expectation is triaged as
a regression, not dismissed as noise.

### E1 — False-'saved' regression watch (unacked must NEVER read saved)

- Invariant: ONLY `synced` maps to display `"saved"`
  (`useResponseDurabilityStatus.ts:79-82`); blocked wins over everything
  (:72-74); null engine → `"saving"` (:135, :140-143). Engine test pins
  storage-total-failure → `durability_fault`, never `saved_locally`
  (`DurableResponseEngine.test.ts:1075-1112`).
- Watch: any UI copy or ticket claiming "saved" for checkpointed-but-unacked
  work (`saved_locally` displayed as "saved", runbook :133-135, :145-146) =
  must-fix defect → rollback trigger 1 candidate. Grep the bundle's user-facing
  strings for "saved" during stage entry; confirm each maps to acked state.

### E2 — Submit-gate annoyance watch (gate fires ONLY with blocked present)

- Invariant: provider gate throws `blockedSubmitGateMessage` only when
  `blockedCount > 0 || quarantinedCount > 0`; engine backstop throws only
  when `getBlockedCount() > 0` (engine :1205-1207). Gate copy has two forms
  (blocked-count vs quarantine-only, :46-52) — support must quote which form
  fired.
- Watch: gate firing with ZERO blocked/quarantined (stale badge — provider
  refreshes ids on every reconcile outcome, :2099-2112) = defect, triage;
  gate NOT firing with blocked present = rollback trigger 3. Track gate-fire
  volume vs `blockedCount>0` sessions; divergence either way is actionable.

### E3 — Quarantine growth watch (no silent eviction — ledger MAY exceed 50)

- Invariant: the 50-ledger cap counts DURABLE IDB keys; the ledger shrinks
  ONLY via `pruneQuarantined` on (a) server ack of a replacement write
  (`reason: ack-superseded`) or (b) explicit discard (`reason: discard`) —
  each with durable delete + `quarantine_pruned` event (engine :2032-2058).
  `quarantineEntry` NEVER `shift()`s (engine :2075-2079); telemetry test
  pins "ledger fills past 50 without ack/discard → no prune, nothing evicted"
  (`durabilityTelemetry.test.ts:265-281`).
- Watch: quarantine count > 50 is EXPECTED under ack/discard drought — do NOT
  "fix" by clearing; DO triage the drought (why are acks/discards not
  arriving?). Missing `quarantine_pruned` with shrinking count, or any prune
  reason other than the two allowed = defect. Alert on growth RATE change, not
  absolute > 50.

## 9. Triage playbook pointers (runbook §4, :93-126 — summarize, don't fork)

Full procedure lives in the runbook; this phase adds the operator card.

### 9.1 Preserve evidence FIRST (before clearing ANYTHING — runbook :95-101)

1. Export browser storage keys `response-checkpoint:v2:*`, `v2_attempt_*`,
   `v2_quarantine:*` (+ quarantine list, mutation ledger/outbox if reachable).
2. Do NOT clear site data first — clearing destroys tombstones/checkpoints
   that distinguish loss from honest blocking.
3. Capture: server acks, control events (pause/resume/extend/takeover bumps),
   client ledger (writeId/version/epoch per question vs seeded snapshot versions).

### 9.2 Correlate, in order (runbook :102-109)

Server acks (`VERSION_COLLISION`, `CONTROL_EPOCH_STALE`, `LEASE_FENCED`,
`superseded` = canonical current, `duplicate` = exact writeId replay) →
control events (lease vs control epoch separates takeover from timing-only) →
client mutation ledger (writeId/version/epoch vs seeded snapshot versions).

### 9.3 Classify — what each state means for support

| Class | What it is | Support action |
|---|---|---|
| `blocked_attention` (blocked) | Draft visible but must never send without reconcile/discard (control-epoch stall, version collision, stale hydration). Expected UX: blocked banner + reconcile path, NOT resend under old epoch (runbook :113-117) | Guide student to re-check with exam (reconcile) or proctor; NEVER advise resend under old epoch |
| Quarantined | Rejected write archived-before-delete; draft visible, non-sendable until resolved (runbook :136-138). Count via `quarantinedCount` | Same as blocked + reassure "kept safely on this device" (quarantine-only gate copy); escalate if count grows without prune (§8 E3) |
| `conflict` (fenced/terminal/superseded) | Canonical server state shown alongside kept local draft (runbook :139-140); submit-time `CONTROL_EPOCH_STALE` is terminal (`conflict_terminal`, engine :1225-1232) | Show canonical + local; lease-change conflicts NEVER replay (runbook :124-126) |
| `error` (durability_fault) | Storage/archival failure; work kept on device, last copy retained, fault raised instead of loss (engine :2114-2119, :2155-2162) | Page storage triage; preserve device; do not clear storage |
| UI rollback (NOT loss) | Visible draft replaced by older local draft during recovery; checkpoints show newer intent never queued (runbook :111-113) | Fix is recovery seeding, not storage; no rollback trigger |
| Rejected-write surfaced (NOT loss if visible) | Ack fenced + draft visible in blocked/conflict/quarantine (runbook :113-117) | Expected banner + reconcile; no rollback trigger |
| Replaced confirmed answer (P1) | Server-acked write later shows different content (runbook :118-119) | Capture ledger + projection rows; rollback trigger 1 candidate |
| Permanent loss (PAGE + ROLLBACK) | Accepted intent: no checkpoint, no ledger, no quarantine, no ack (runbook :120-122) | Page immediately; ONLY this (and replaced-confirmed) meets trigger 1 |

Reconcile rule (runbook :124-126): timing-only control changes reconcile via
fresh snapshot + fresh version as NEW writeId/version under the new epoch.
Never replay across a lease change or terminal fence.

### 9.4 Status-vocabulary card for support (runbook §6)

`saving` = in flight, no ack · `saved_locally` = on THIS device, NOT
server-acked, NEVER "saved" · `blocked_attention` = needs student action,
visible + non-sendable · `conflict` = canonical server shown + local kept ·
`saved` = server-acked ONLY · `error` = durable failure, retry/support.
Any "saved" claim for unacked work = must-fix defect (runbook :145-146).

## 10. Verification (exact commands + expected outputs)

Runbook/config phase — verification is evidence collection, not test suites.
(Run from the repo root unless noted; commands are READ-ONLY except the
rollout-log write.)

```bash
# V1 — runbook + overall plan present and stages unskipped
ls plans-durability/ && sed -n '10,25p' docs/runbooks/student-answer-durability.md
# Expected: overall-plan.md + phase-05-rollout.md listed; staged-rollout table
# (dogfood → pilot → full) with entry/exit criteria printed.

# V2 — telemetry emission points cited in §4.1 exist (read-only grep)
grep -rn 'emitDurabilityEvent' src/shared/durability/DurableResponseEngine.ts | cut -c1-120
# Expected: intent_queued_during_recovery, checkpoint_sync_failed,
# control_epoch_blocked (×4), version_collision (×2+submit), reconcile_succeeded,
# reconcile_failed (multiple reasons), quarantine_archived, quarantine_failed
# (reason quarantine_archive_failed ×2), quarantine_pruned — matching §4.1 table.

# V3 — fault-is-status contract (no counter named durability_fault)
grep -rn 'durability_fault' src/shared/durability/types.ts src/shared/durability/DurableResponseEngine.ts | head -20
# Expected: types.ts SyncStatus union member + engine syncStatus assignments;
# NO emitDurabilityEvent("durability_fault") line (it is getStatus(), not an event).

# V4 — status vocabulary + gate copy single-owner
grep -n 'blockedSubmitGateMessage\|mapEngineStatus' src/shared/durability/useResponseDurabilityStatus.ts | head
grep -n 'Blocked drafts need attention' src/shared/durability/DurableResponseEngine.ts
# Expected: mapper + gate copy defined once in useResponseDurabilityStatus.ts
# (:46-52, :67-82); engine backstop throw at DurableResponseEngine.ts:1205-1206.

# V5 — quarantine prune-only contract (no silent shift)
sed -n '2032,2058p;2074,2080p' src/shared/durability/DurableResponseEngine.ts
# Expected: pruneQuarantined comment (ack-superseded | discard ONLY) + "NO silent
# drop-oldest shift()" comment. Ledger may exceed 50 until prune triggers.

# V6 — rollback = bundle redeploy, no migration (no-op check)
grep -n -i 'no migration\|redeploy.*previous.*bundle\|interoperate' docs/runbooks/student-answer-durability.md
# Expected: :8 (no migration to reverse), :12-16 (same API + namespaced keys),
# :39-40 (redeploy previous bundle; interoperate).
```

Stage-entry/exit verification is the rollout log itself: each stage block
records entry date + evidence links, baseline numbers, monitor snapshots
(Q1–Q6), ticket count, and signed exit — reviewed before the next stage opens.

## 11. Definition of Done

- [ ] Pre-stage checklist (§5 Step 0) complete: Phase 04 record linked, rollback bundle tagged, dashboards live, dogfood baselines recorded, on-call/support briefed, rollback dry-run logged.
- [ ] Stage 1 (dogfood) entered, monitors watched per §7 Q1–Q6, exit criteria evidenced in rollout log.
- [ ] Stage 2 (pilot, single schedule) entered, sustained-window parity on `version_collision` / `control_epoch_blocked` evidenced, exit signed.
- [ ] Stage 3 (full) entered, one full exam window of sustained parity evidenced.
- [ ] Rollback path confirmed: previous bundle staged before stage 1 + §5 Step 4 dry-run recorded (redeploy command + wall time + verification output).
- [ ] Zero skipped stages; any trigger hit → rollback executed per §6.2 + re-entry restarted at stage 1 (logged).
- [ ] Edge watches E1–E3 evaluated per stage and recorded (false-'saved' scan, gate-fire parity, quarantine growth-rate note).
- [ ] Rollout report filed as FOLLOW-UP (goal already complete in Phase 04 — this phase does not touch the goal).
- [ ] No code/config drift: lane diff-check clean on `src/ backend/ e2e/ docs/ k6/` (only `plans-durability/phase-05-rollout-log.md` added).
