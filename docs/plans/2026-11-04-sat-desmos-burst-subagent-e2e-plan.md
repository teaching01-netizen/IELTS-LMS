# SAT Desmos Burst — Sub-Agent Implementation Plan (E2E-gated)

> **Goal:** make SAT Math + Desmos safe when **500–2000 students open at the same time** on school WiFi.
> **Method:** 2 parallel sub-agent tracks (frontend / backend) + 1 E2E gate track. No track merges without green E2E.
> **Prior audits:** production-auditor (SEV-1 ×4: infinite-spinner, 2× fan-out, start-herd, single-preconnect) + business-logic-edge-case-auditor (7 confirmed: spinner, locale leak, blocked-toggle, prewarm fork, skew-hold, etc.). No SEV-0 score corruption — answer path is `writeId`-idempotent with identical submit replay.

- Date: 2026-11-04
- Scope: `src/features/student-delivery/**` (Desmos/tools/route) + `backend/go/**` (delivery/start/entry/pool/outbox) + `k6/sat-exam-day.js` + `e2e/**` + `playwright.sat-*.config.ts`
- Non-goals: Desmos self-host / proxy; scoring change; timing-model change; new timing UI copy beyond retry/queue states.

---

## 1. Change boundary & repository evidence

### 1.1 Current behavior → desired → non-goals

| # | Current (Verified) | Desired | Non-goal |
|---|---|---|---|
| F1 | `DesmosCalculator.tsx:39-40,46-55,95` mounts BOTH `scientific+graphing` eager; only `onLoad:99` signals ready; no `onError`/timeout. `activeReady=false:66` → spinner forever `:104-121`, `data-desmos-ready="false":74`. | Bounded load: eager active mode only; 12–15s watchdog per mode → error + Retry (remount); exam never blocked. | No Desmos JS API integration; iframe embed stays. |
| F2 | `SatCalculatorHost.tsx:35` forces `prewarmWhenClosed`; `SatCalculatorPanel.tsx:146` passes `prewarmWhenClosed\|\|open`; route `:312-364,379` mounts host as early as directions/break with synthetic `prewarm:<moduleId>:341-347`. 500 students = 1000 docs, 2000 = 4000 docs. | Lazy second mode + jittered prewarm (0–10s) + `saveData/slow-2g` defer; ≤1 doc/student during burst minute. | Keep `keepAlive` node-identity guarantee (prewarm.test pins it). |
| F3 | `ensureDesmosPreconnect():426-428` adds one `link[rel=preconnect desmos.com]` (`desmosPreconnect.ts:1-17`). Real asset hosts unlisted. | Preconnect + `dns-prefetch` for enumerated HAR host set + timing beacon. | No extra origins without measurement. |
| F4 | `toggleTool` checks capability only (`satRunnerReducer.ts:151`, `satTools.ts:57`); shell (`SatExamShell.tsx:549-554`) + `useSatExamController.ts:2450` dispatch with no blocked-guard. Pause = inert-DOM only. | Command-layer blocked-guard mirroring `satInteractionGuards.ts:53-55`; auto-`closeAllTools` on block (recommend; pin in spec). | No server tool-state; view-only stays client-local. |
| F5 | `satCalculatorWorkspace.ts:48-96` locale layer half-dead: `saveCalculatorLocale` zero prod callers, `clearCalculatorLocaleForAttempt` test-only, `clearAttemptClientState (useSatExamController.ts:1146-1151)` clears workspaces not locales. Seeded `en-US` flips embed to `lang=en-US` vs frozen `en` (`desmosTypes.ts:4-21`). | Freeze read to `SAT_EXAM_LOCALE` + sweep locales on finalize (or delete layer — decision SG-04). | No per-module locale feature in this plan. |
| F6 | Prewarm key `prewarm:<moduleId>` swaps to real `moduleAttemptId` without remount (same Host key `schedule:attempt:moduleId :33`); Panel `useEffect [storageKey]:88-91` silently reloads default. Skew-hold caches host props up to 1500ms (`route:852-861`). | Prewarm read-only (no writes under `prewarm:`) + held-frame `inert` + frozen `disabled=true` re-resolve. | No Host key change (would break identity tests). |
| B1 | Ship defaults OFF: `ENTRY_GATE:false:1047`, `VERSION_CACHE:false:1050`, `RUNTIME_SNAPSHOT:false:1052`, pool `DB_POOL_MAX_CONNECTIONS=20:894` split 20/20 fallback `:1020-1021`, `OUTBOX_CLAIM_MODE=update:284`, partitions `1`. Entry `1.5s` / read `10s` budgets (`query_timeout.go:24-53`) → 503+`Retry-After:1` + tier 429 (`student-checkin 1200/min:1035` < 2000/min). | Exam-day preset + visible queue + bounded start-retry honoring `Retry-After` (reuse `satPollCadence.ts:28-42` pattern). | No pool auto-tune; explicit preset + rehearsal. |
| B2 | Zero Desmos signal: `emitStudentObservabilityMetric` = `CustomEvent` only (`studentObservability.ts:86-106`); only `sat_media_load_failed` emitted. 429s bypass `AccessLog` (`cmd/api/main.go:492-494`). | `sat_desmos_load_total{outcome,mode,scheduleId}` + `ready_ms` histogram + Math-window board + ready-rate alert. | No full OTel trace in this slice; beacon + counters first. |

### 1.2 Verified files/symbols (sub-agents must re-read before edit)

```
Frontend (track A):
 src/features/student-delivery/ui/tools/DesmosCalculator.tsx
 src/features/student-delivery/ui/tools/SatCalculatorPanel.tsx
 src/features/student-delivery/ui/tools/SatCalculatorHost.tsx
 src/features/student-delivery/ui/tools/SatFloatingTool.tsx:901-904 (keepAlive)
 src/features/student-delivery/infrastructure/desmos/desmosTypes.ts
 src/features/student-delivery/infrastructure/desmos/desmosPreconnect.ts
 src/features/student-delivery/infrastructure/satCalculatorWorkspace.ts
 src/features/student-delivery/routes/SatStudentSessionRoute.tsx:312-364,379,426-428,848-861
 src/features/student-delivery/domain/satToolPolicy.ts:72-93
 src/features/student-delivery/domain/satInteractionGuards.ts:53-55
 src/features/student-delivery/application/satRunnerReducer.ts:147-203
 src/features/student-delivery/application/satPollCadence.ts
 src/features/student-delivery/hooks/useSatExamController.ts:1146-1161,2450-2453
 src/utils/studentObservability.ts:86-106

Backend (track B):
 backend/go/internal/platform/config/config.go:660-670,690-708,894-916,976,981-983,1020-1052
 backend/go/cmd/api/query_timeout.go:24-53
 backend/go/cmd/api/main.go:439-440,485-494
 backend/go/cmd/api/frontend.go:54
 backend/go/internal/delivery/service.go:740-761,2028-2173,2289-2368
 backend/go/internal/delivery/versioncache.go:48-169,188-196
 backend/go/internal/delivery/start_submit.go:157-213
 backend/go/cmd/worker/main.go:33-69
 backend/go/internal/platform/telemetry/telemetry.go (MPool*, MVersionCache*, MQueryTimeout*, MSATTimeoutFinalize*)

Load/E2E (track C):
 k6/sat-exam-day.js (thresholds :167-172; 429 loop :98-114,472-483 — k6-only)
 e2e/helpers/satCalculatorTouch.ts:56-62
 e2e/sat-math-tools.spec.ts:17,77
 playwright.sat-calculator-touch.config.ts / playwright.sat-calculator-desktop-guard.config.ts
```

**Assumptions:** `Verified` = paths above read in prior audits. `Inferred` = Desmos per-IP throttle exists (uncontracted — needs vendor statement + single-egress load test). `Unknown` = prod flag values at exam time — track B must dump `prod env + MPool*` before rehearsal.

---

## 2. Requirements & invariants

### 2.1 Functional

```text
FR-01 (Desmos bounded): Math-eligible student sees working calculator or explicit error+Retry within 15s of Math open, even if desmos.com blocked/slow. Exam answering never blocked on calculator.
  Accept: Playwright desmos-blackhole → error UI ≤15s; Retry with network restored → data-desmos-ready="true".

FR-02 (1-doc burst): During first 60s of Math open, ≤1 Desmos document per student (active mode eager; inactive deferred).
  Accept: 500-headless burst harness doc-count mean ≤1.2; time-to-activeReady p95 improves on Fast-3G vs baseline.

FR-03 (Start under burst): 2000 VU bell-burst (60s, single schedule) meets backend thresholds (bootstrap p99<5s, ack p95<2s, submit p99<30s) with shed only as bounded 429/503+Retry-After.
  Accept: k6 sat-exam-day 2000/60s green on prod-like DB with preset ON.

FR-04 (Visible queue): Shed shows "waiting — retrying in Ns" (server Retry-After + jitter), not bare spinner.
  Accept: forced-429 run shows queue UI + honored Retry-After (beacon asserts).

FR-05 (Pause integrity): toggleTool while blocked refused or queued (specified); pause auto-closes tools (recommended); unpause state pinned by test.
  Accept: reducer+route tests (see §8).

FR-06 (Locale freeze): embed URL always lang=en regardless of seeded storage; no locale keys survive finalize.
  Accept: seeded en-US test + finalize-sweep test.

FR-07 (Prewarm/hold safety): no writes under prewarm: prefix; skew-hold frame inert + disabled re-resolved.
  Accept: prefix-assertion + hold-interaction tests.
```

### 2.2 Rules / errors

```text
RULE-01: Desmos + reference stay Math-only + module-policy-gated (INV-001). Live uses stored toolCapabilities; pending re-resolves via resolveSatExamToolPolicy — all three call sites converge on single selector (new).
RULE-02: Bare branches mount ZERO hidden Desmos iframes (INV-002, C1–C13 matrix extended with C14 form-boundary case).
RULE-03: Review never shows calculator dialog (open = phase==module && flag); return-from-review keeps closed (pin).
RULE-04: Watchdog ≤3 retries, backoff+jitter, user-click or single auto-retry only (no reload amplifier).
ERR-01: Desmos timeout/blocked → error state {mode, durationMs} + Retry + metric; NOT spinner.
ERR-02: Start shed 429/503+Retry-After → queue UI; 5xx without Retry-After → fault UI + stop.
ERR-03: Unknown/missing section → fail-closed R&W + log/notice (SPEC SG-02).
SCOPE-OUT: scoring, timing model, Desmos proxy, server tool-state.
```

### 2.3 Invariants (owner in brackets)

```text
INV-001 Math-only calculator [domain/satToolPolicy + route gating + reducer] — must hold under concurrency/skew/republish.
INV-002 Bare-branch zero iframes [route stageHost gating] — holds under form/directions/break skew.
INV-004 Mode isolated per moduleAttempt [satCalculatorWorkspace key schedule:attempt:moduleAttempt] — no M1→M2 leak.
INV-005 Blocked/paused cannot operate calculator [NEW: runner command guard + DOM inert] — TOCTOU closed.
INV-010 Desmos failure distinguishable [NEW: DesmosCalculator watchdog] — no eternal spinner.
INV-011 Workspace/locale released at attempt end [useSatExamController.clearAttemptClientState + NEW locale sweep].
INV-012 Prewarm→real identity stable, no fork [Panel read-only prewarm].
INV-020 Start idempotency: one logical start → one moduleAttempt; submit replay identical receipt [backend start_submit + submit] — already holds; must hold at 2000/60s.
INV-021 Pool/queue bounded: shed is explicit 429/503+Retry-After, never unbounded wait [ENTRY_GATE + timeouts].
```

---

## 3. Entities, ownership & relationships

| Owner (single writer) | State (authoritative vs derived) | Lifecycle | Relationships | Mutability |
|---|---|---|---|---|
| `DesmosCalculator` (track A) | `mountedModes: Set<mode>` (auth, monotonic ≤2); `loadedModes: Set<mode>` (auth, onLoad only); `desmosStatus: loading\|ready\|timeout\|blocked\|error` (NEW auth); `retrySeq: number` (NEW, remount key) | `unmounted → loading → ready \| timeout/error → retrying → ready` | renders ≤2 iframes; emits `sat_desmos_*` | Only itself mutates; parent passes `mode,disabled,eagerInactive` |
| `SatCalculatorPanel` (track A) | `mode` (auth per storageKey); `eagerInactive: boolean` (NEW derived: `activeReady \|\| hoverIntent \|\| idle30s`) | `prewarm-hidden → open` (keepAlive identity preserved) | owns storageKey/localeKey; hosts DesmosCalculator | Ignores `saveCalculatorWorkspace` return today → MUST check (quota) |
| `SatCalculatorHost` (track A) | `moduleId` key `schedule:attempt:moduleId` (identity — DO NOT CHANGE) | remount per module handoff | forces `prewarmWhenClosed` | read-only wrapper |
| `satRunnerReducer` (track A) | `activeTools{calculator,referenceSheet}` (auth) | `closed ⇄ open` via toggle/close/closeAll; `reviewModule`/`routeToModule` force EMPTY | only `closeAllTools` on block-entry (NEW) | add blocked-guard in command layer, not reducer alone |
| `satCalculatorWorkspace` (track A) | `sessionStorage sat-desmos-embed:v1:* / sat-desmos-locale:v1:*` (per-tab) | created on open → cleared on finalize | keyed `schedule:attempt:moduleAttempt` | prewarm keys READ-ONLY (NEW rule) |
| `Delivery bootstrap/start` (track B) | `exam_session_runtimes` row (hot), `attempt/module FOR UPDATE` rows | `start → started → submitted/locked → terminalized` | singleflight `VersionCache`; `RUNTIME_SNAPSHOT` pre-check; `ENTRY_GATE` queue | tx-bounded; reconcile worker concurrency 4 |
| `Outbox + worker` (track B) | `outbox pending/oldest` | `enqueued → claimed → done/DLQ` | `--sat-timeouts-only` sweeps timeouts | `skiplocked + partitions≥2` (preset) |

### State transition tables

**Desmos status (NEW):**

| Current | Event/guard | Next | Owner | Side effect |
|---|---|---|---|---|
| loading | onLoad(mode) ≤15s | ready | DesmosCalculator | emit ready+durationMs; mount deferred inactive |
| loading | watchdog fires, no onLoad | timeout/error | DesmosCalculator | error UI + metric; exam usable |
| timeout/error | Retry click (≤3) | retrying→loading | DesmosCalculator | key-bump remount that mode |
| any | unmount/disabled | (frozen, inert) | Panel/Host | no metric spam |

**Tool open (amended):**

| Current | Event/guard | Next | Owner | Side effect |
|---|---|---|---|---|
| open | block-entry (proctor pause) | closed (NEW auto-close) | command layer | closeAllTools |
| closed | toggle while blocked | closed (refused, NEW) | command layer | queue-or-refuse + beacon |
| open | reviewModule/routeToModule | closed (existing) | reducer | cleared (pinned) |

---

## 4. Exact function-level design

### Track A — frontend (sub-agent A)

```text
Location: src/features/student-delivery/ui/tools/DesmosCalculator.tsx (Verified)
Owns: mountedModes, loadedModes, NEW desmosStatusByMode, retrySeq
Reads: mode, locale (= SAT_EXAM_LOCALE frozen), disabled, NEW props { watchdogMs=14000, eagerInactive=false, onDesmosOutcome }
Writes: iframe(s) (≤2), data-desmos-ready/both-modes-ready/desmos-status/desmos-error attrs, beacon via onDesmosOutcome
Signature: DesmosCalculator({mode, locale=SAT_EXAM_LOCALE, disabled, prewarmInactiveModes, silenceLiveRegions, watchdogMs, eagerInactive, onDesmosOutcome}: Props) -> JSX
Pre: Math-eligible host mounted; mode ∈ {graphing,scientific}.
Post: activeMode eager; inactive mounted iff (prewarmInactiveModes && eagerInactive); watchdog resolves ready|timeout.
Error: timeout|blocked|error → error UI + Retry (key bump), distinct data attrs; never blocks answering.
Invariant: INV-010 (bounded), INV-002 (bare-branch: parent returns null).
Callers: SatCalculatorPanel (must pass eagerInactive + handler); tests DesmosCalculator.test.tsx.
```

```text
Location: SatCalculatorPanel.tsx (Verified)
Owns: mode, eagerInactive derivation, storageKey/localeKey, prewarm read-only rule
Reads: loadCalculatorWorkspace(storageKey), SAT_EXAM_LOCALE (FROZEN — stop reading seeded locale until SG-04 designed)
Writes: saveCalculatorWorkspace (CHECK return; quota → beacon + keep in-memory mode); NEW beacon sat_desmos_*
Signature: handleModeChange(next) — no-op if disabled or prewarm: prefix write attempted (assert + beacon).
Pre: storageKey derived from moduleAttemptId (real or prewarm:).
Post: prewarm:* keys never written (NEW guard isPrewarmKey()).
Error: storage throws → in-memory fallback + beacon.
```

```text
Location: NEW src/features/student-delivery/infrastructure/desmos/desmosWatchdog.ts (Proposed; verify path)
Owns: per-mode timer + outcome classification
Signature: startDesmosWatchdog({mode, mountAt, timeoutMs, onFired}: ...) -> cancel(): void
Signature: classifyDesmosOutcome({loaded: boolean, elapsedMs, cspBlocked?: boolean}) -> 'ready'|'timeout'|'blocked'|'error'
```

```text
Location: desmosPreconnect.ts (Verified) — extend, do not replace
Owns: preconnect/dns-prefetch set + timing beacon
Signature: ensureDesmosPreconnect(doc=window.document, hosts: string[] = DESMOS_ASSET_HOSTS) -> void (idempotent per host)
Pre: hosts pinned from HAR (track A enumerates + records in comment).
```

```text
Location: NEW src/features/student-delivery/domain/satCalculatorAvailability.ts (Proposed)
Owns: single calculator-availability selector (fixes 3-call-site fork: route live :312-317, pending :323-327, shell-notes :1045)
Signature: selectCalculatorAvailable(state, data) -> { eligibleModule, moduleAttemptId } | null
Reads: runner toolCapabilities + fresh resolveSatExamToolPolicy(pendingSectionKey, pending.toolPolicy)
Callers: all three sites (compat: identical outputs for current fixtures; C13 must stay green).
```

```text
Location: hooks/useSatExamController.ts:2450-2453 + satRunnerReducer.ts (Verified)
Owns: blocked-guard (command layer) + auto-close on block-entry
Signature: toggleCalculatorCmd(ctx: {blocked, isSubmitting, persistenceBlocked}) -> refused | dispatched
Pre: mirrors satInteractionGuards.openCalculator.
Post: blocked → activeTools unchanged + beacon; block-entry → closeAllTools dispatched.
```

```text
Location: infrastructure/satCalculatorWorkspace.ts (Verified) — minimal edits
- loadCalculatorLocale(): FROZEN — always return SAT_EXAM_LOCALE (keep signature; ignore seeded value + beacon once).
- clearCalculatorLocaleForAttempt(): wire into clearAttemptClientState (useSatExamController.ts:1146-1151).
- saveCalculatorWorkspace callers: check boolean return.
```

```text
Location: routes/SatStudentSessionRoute.tsx (Verified)
- stageHost gating :379 UNCHANGED (bare-branch); fix comment :329 ("including preparation" → document form-phase bare + preconnect-only warm).
- skew-hold render :852-861: wrap retainedFrame.element with inert + override held calculatorHost disabled=true (re-resolve at hold-render time).
- prewarm jitter: setTimeout 0–10s before mounting pending host when navigator on saveData/slow-2g → defer inactive (track A implements in Panel via eagerInactive).
```

### Track B — backend (sub-agent B)

```text
Location: backend/go/internal/platform/config/config.go (Verified)
Owns: exam-day preset (env only, no code default change — ship stays off; runbook flips at exam):
  ENTRY_GATE=1 (bucket 500/2000 per room), DB_POOL_MAX_API=40 / DB_POOL_MAX_WORKER=10 (or measured),
  OUTBOX_CLAIM_MODE=skiplocked, WorkerClaimPartitions≥2, VERSION_CACHE=1, RUNTIME_SNAPSHOT=1, HTTPWriteTimeoutSecs≥30.
Pre: values dumped + recorded (close Unknown).
Post: rehearsal deltas recorded (pool wait, hit ratio, shed rate).
```

```text
Location: delivery/service.go + start_submit.go (Verified) — NO logic change in this plan
Owns: singleflight (versioncache.go:48-157) + fail-closed GetChecked + FOR SHARE/UPDATE tx order.
Track B verifies (not rewrites): lock order attempt→runtime→module consistent; reconcile bypass seeded-only (:171-179); late-entry clamp preserved.
```

```text
Location: cmd/api start/entry handlers (Verified) — thin retry-honoring contract
Owns: 429/503 MUST carry Retry-After (already); NEW: queue-position header/body {queueDepth?, retryAfterSeconds} for UI (small additive field, backward-compat).
```

```text
Location: telemetry (Verified names) — NEW counters (track B adds; track C asserts):
  sat_desmos_* emitted FROM FRONTEND beacon endpoint (track A→B contract: POST /api/v1/sat/desmos-outcome {scheduleId,attemptId,moduleAttemptId,mode,outcome,durationMs,buildSHA}).
  Backend: MVersionCacheHit/Miss ratio, MPoolWait, MQueryTimeout, entry 503 + tier-429 w/ honored-Retry-After, MOutboxPending/oldest, MSATTimeoutFinalize.
```

### Track A→B contract (both sub-agents pin)

```text
POST /api/v1/sat/desmos-outcome (NEW, Proposed; verify router pattern)
Body: { scheduleId, attemptId, moduleAttemptId, mode: 'scientific'|'graphing', outcome: 'ready'|'timeout'|'blocked'|'error', durationMs: number, buildSHA: string }
Auth: attempt bearer (same as responses:batch). Errors: 400 invalid, 429 shed (client drops, no retry storm).
```

---

## 5. Algorithm / control flow

### 5.1 Happy path (Math open, burst minute)

```text
1. Route resolves selectCalculatorAvailable() → eligibleModule + moduleAttemptId (real or prewarm:).
2. ensureDesmosPreconnect(hosts) idempotent; jitter 0–10s if pending-prewarm && (saveData || slow-2g).
3. Host mounts (keepAlive). Panel derives storageKey; isPrewarmKey → read-only (no writes).
4. DesmosCalculator mounts ACTIVE mode eager; starts watchdog(14s). Inactive deferred until activeReady || hover/focus || Math-start+30s idle.
5. onLoad(mode) → loadedModes.add → ready: emit outcome{ready,durationMs}; mount deferred inactive (same watchdog).
6. Backend (parallel): entry (gate queue) → V1 bootstrap → delivery bootstrap (VersionCache singleflight) → modules/start tx → V2 batches (exact-ack) → handoff poll → submit (identical replay receipt).
```

### 5.2 Failure branches (each = E2E case)

```text
F-slow/blocked Desmos: watchdog fires → status=timeout → error UI + Retry + metric; answering unaffected. Retry ≤3, backoff+jitter; key-bump remount one mode.
F-CSP block: same as timeout, outcome=blocked (heuristic: instant error + header probe) + runbook line (allowlist frame-src).
F-pause during open: block-entry → closeAllTools; toggle-while-blocked → refused + beacon; unpause → closed (pinned).
F-pause during skew-hold: held tree inert + disabled=true re-resolved → no stale interaction (BUG-006 closed).
F-quota/private-mode: save returns false → in-memory mode + beacon; no throw.
B-shed: 429/503+Retry-After → queue UI "waiting — retrying in Ns" (satPollDelayMs pattern); 5xx w/o Retry-After → fault UI + stop.
B-deploy/publish mid-Math: freeze violated → hosts remount → 2-doc herd (rehearse; runbook forbids).
```

### 5.3 Concurrency notes (for §7 traces)

- Frontend JS single-threaded: reducer flips need no lock; multi-tab same-attempt diverged activeTools acceptable (view-only, lease governs writers).
- Backend: shared rows (exam_session_runtimes FOR SHARE + attempt/module FOR UPDATE) = convoy; singleflight leader/follower; outbox skiplocked partitions; worker concurrency 4.

---

## 6. Concrete implementation sequence (sub-agent split)

### Track A — frontend sub-agent (owns `src/**`, no backend edits)

```text
A0 Re-read: DesmosCalculator, Panel, Host, FloatingTool keepAlive, route gating, satPollCadence, studentObservability. Record HAR asset hosts.
A1 DesmosCalculator watchdog+retry (INV-010):
    - add desmosStatusByMode + retrySeq + watchdogMs/eagerInactive/onDesmosOutcome props;
    - onError + timeout paths; error UI + Retry (per-mode key bump); data-desmos-status/error attrs; keep answering unblocked.
    - unit: DesmosCalculator.test.tsx (failure/timeout/retry/attrs).
A2 Lazy second mode (CF-2):
    - eager active only; defer inactive until activeReady || mode-switch hover/focus || +30s idle; gate saveData/slow-2g.
    - prewarm jitter 0–10s on pending path.
    - unit+component: SatCalculatorPanel.test.tsx (single-doc default; deferred mount).
A3 Preconnect expansion (CF-4): hosts list + dns-prefetch + idempotent per-host + mount→ready beacon timing.
A4 Blocked-guard + auto-close (BUG-003/SG-01): command-layer gate + closeAllTools on block-entry; shell notes converge on selectCalculatorAvailable (NEW file).
    - reducer+route tests (blocked toggle refused; pause/unpause pin).
A5 Locale freeze + cleanup (BUG-002): loadCalculatorLocale→frozen; wire clearCalculatorLocaleForAttempt into clearAttemptClientState; check save returns; fix stale "shared across presentations" comment (BUG-005).
A6 Prewarm read-only + hold inert (BUG-004/006): isPrewarmKey guard + prefix-assertion test; hold-render inert + disabled re-resolve + test.
A7 Docs: update phase verification log (locale fallback claim) + runbook (site probe, allowlist, stagger).
Gate: track C E2E-A/B green before handoff.
```

### Track B — backend sub-agent (owns `backend/go/**`, `k6/**`, manifests; no `src/**` edits)

```text
B0 Dump prod env + pool stats (close Unknown); record in rehearsal log.
B1 Exam-day preset runbook + manifests (env only): ENTRY_GATE/VERSION_CACHE/RUNTIME_SNAPSHOT/pools/OUTBOX/partitions/timeouts. No ship-default flip in code.
B2 Queue-position signal (additive, compat): 429/503 bodies include {retryAfterSeconds, queueDepth?}; AccessLog exemption stays; counters per scheduleId top-N.
B3 Beacon endpoint POST /sat/desmos-outcome (contract §4) + dashboards/alerts (Math-window board; ready-rate <99%/5m page, <95% incident; pool/outbox alerts).
B4 Rehearsals: k6 bell-burst 500 + 2000 VU/60s/single-schedule on prod-like DB, preset ON vs OFF; assert §2 thresholds + pool/outbox signals; record deltas.
B5 Freeze policy: deploy/publish freeze windows + audit log + config-fingerprint per instance.
Gate: track C E2E-C green before handoff.
```

### Track C — E2E gate (owns `e2e/**`, `playwright.*.config.ts`, `k6/**` additions; runs last per slice)

```text
C1 E2E-A Desmos chaos (Playwright, throttled Fast-3G + 300ms RTT):
    - desmos-blackhole (route abort *desmos.com*) → error ≤15s, Retry recovers, answering intact.
    - desmos-503 + CSP-block (frame-src self) → blocked outcome + runbook hint.
    - single-mode burst: doc-count ≤1 during first 60s; both-modes-ready only after defer.
C2 E2E-B frontend regression: C1–C13 matrix + NEW C14 (form-boundary bare: directions + pending-Math + section-form → zero iframes) + blocked/hold/prewarm/locale/return-from-review pins.
C3 E2E-C bell-burst (k6 2000 VU/60s/single schedule + 500-headless real-route Desmos harness): backend thresholds + desmos ready-rate p95 + egress doc-count.
C4 Soak + failover: 90-min Math dual→single on 2GB Chromebook profile (no tab discard); kill --sat-timeouts-only mid-rehearsal → finalize lands via API path.
Merge rule: A/B slices merge only on C green (3 consecutive runs incl. 1 throttled).
```

### Dependencies & compat

```text
A1 → A2 (watchdog before lazy; shared status) → A4/A5/A6 (parallel after A1) → C1/C2.
B1 → B4 (preset before rehearsal) → B2/B3 (parallel) → C3.
A∩B: beacon contract §4 agreed before A3/B3; no breaking changes (additive attrs/fields only; Host key + keepAlive identity preserved; toolPolicy/result shapes unchanged).
```

---

## 7. Worked traces (normal + adversarial)

### T1 — Normal Math open (happy path)

```text
Initial: Math M1 started; storageKey s:a:ma-m1 empty; mountedModes={}; loadedModes={}.
1. Panel loads mode=graphing(default); mounts graphing eager + watchdog(14s).
2. onLoad(graphing, t=1.2s) → loadedModes={graphing} → ready; beacon {ready,1200ms}; eagerInactive=true → mount scientific + watchdog.
3. onLoad(scientific, t=2.0s) → both-modes-ready; mode-switch reveals cached frame (no reload).
Final: data-desmos-ready="true"; docs=2 but spread post-burst (inactive deferred ≥ activeReady).
Invariant: INV-004 (per-moduleAttempt), INV-010 (bounded ready).
```

### T2 — Desmos blackhole at burst (CF-1/A)

```text
Initial: 500 students pending-Math; egress NAT shared.
1. Route mounts 500 active-modes eager (inactive deferred — NEW) → 500 docs (was 1000).
2. Desmos stalls: no onLoad in 14s → status=timeout → error UI + metric {timeout} per student; answering continues.
3. Teacher: "don't reload" → 0 reload amplifiers (vs old: reload → 2 docs each → herd).
4. Network restores → student Retry → key-bump remount → ready + {ready} beacon.
Final: calculator degraded 14s, not minutes; no extra herd.
```

### T3 — CONC-01 Start-herd convoy (P1, High conf) — rigorous interleaving

```text
Location: delivery/service.go bootstrap + start_submit.go:187-213. Shared: exam_session_runtimes row (FOR SHARE) + attempt/module rows (FOR UPDATE); pool 20.
Actors: A/B = two students' modules/start txs (representing 2000/60s); W = reconcile worker (concurrency 4).
Invariant INV-020/021: every starter starts within seconds; shed explicit+bounded.
Current: caches OFF → full N+1 tree per bootstrap; same-row FOR SHARE queues; pool wait → 1.5s/10s budgets → 503/Retry-After:1 + tier 429.
Interleaving:
  A1 BEGIN; SELECT runtime FOR SHARE (holds S)
  B1 BEGIN; SELECT runtime FOR SHARE (queues behind A — hot row)
  A2 SELECT attempt FOR UPDATE; MODULE FOR UPDATE; timing check; COMMIT (holds row locks ~10s of ms × N+1 reads)
  B2 (waits lock + pool slot; pool 20 exhausted by 2000-way fan-in) → pool-wait >1.5s → entry 503+Retry-After:1
  B3 client retries in lockstep (Retry-After:1 synchronizes hundreds) → thundering retry
  W1 reconcile sweep (2s fallback) contends same rows → lag grows
Result: tail "not started" minutes; late-entry clamp compresses timed Math; synchronized retries sustain shed after trigger clears (metastable).
Root: check-then-act + hot-row + unbounded fan-in + synchronized retry (no queue).
Fix (§4B/§6B): ENTRY_GATE visible queue + VERSION_CACHE singleflight + RUNTIME_SNAPSHOT off hot path + skiplocked/partitions + jittered start-retry honoring Retry-After + position UI.
Why correct: gate bounds concurrency (admission), singleflight coalesces revision probe (1 leader), snapshot removes FOR SHARE from critical path, jitter desynchronizes retries; invariant restored by construction + verified by 2000/60s rehearsal.
Acceptance: k6 2000/60s preset-ON green (p99s + zero lock-wait 503 beyond shed budget + outbox drained).
```

### T4 — CONC-02 Desmos reload amplifier (P1, High conf)

```text
Actors: S1..S500 browsers; D = desmos.com (+ school filter); no server coordination (cross-origin opaque).
Invariant INV-010: bounded failure + no herd regrowth.
Current: 2 eager docs/student; no timeout/backoff; human reload = immediate 2× retry (unbounded, synchronized by bell).
Interleaving:
  S*1 mount 2 docs → D slow/tail-throttled → no onLoad → spinner (all 500)
  S*2 users reload within 30s (correlated) → 1000 NEW docs → D worse → more timeouts → more reloads
Result: self-sustaining brownout after bell minute (metastable; autoscale irrelevant).
Root: missing backoff + 2× fan-out + opaque failure (can't distinguish slow/blocked).
Fix: lazy-1 + watchdog + ≤3 bounded retries + site probe + wave starts. Acceptance: burst harness doc-count + ready-rate (E2E-A/C).
```

### T5 — CONC-03 Pause TOCTOU via toggle/skew-hold (P2, High conf)

```text
Actors: P = proctor pause (blocked=true); S = student toggle/held-frame click; R = reducer (sync in-memory).
Invariant INV-005: blocked student cannot operate calculator.
Current: guard = DOM inert only; reducer ignores blocked.
Interleaving:
  S1 click toggle (in-flight dispatch) || P1 set blocked=true → R applies toggle (capability-only check) → activeTools.calculator=true while blocked → overlay-only protection; unpause reveals open dialog. Hold variant: cached frame pre-pause stays interactive 1500ms.
Result: exam-integrity bypass (view-tool, no score impact — P2 not P0).
Fix: command-layer gate + auto-closeAllTools on block-entry + hold inert. Acceptance: blocked-toggle + hold tests (§8).
```

---

## 8. Verification (E2E style — commands + cases)

### 8.1 Commands (Bun toolchain — AGENTS.md)

```bash
bun run typecheck
bunx tsc --noEmit
bun run lint
bun run test:run -- src/features/student-delivery/ui/tools/DesmosCalculator.test.tsx src/features/student-delivery/ui/tools/SatCalculatorPanel.test.tsx
bun run test:run -- src/features/student-delivery/routes/__tests__/SatStudentSessionRoute.prewarm.test.tsx
# E2E (track C):
bunx playwright test --config playwright.sat-calculator-touch.config.ts
bunx playwright test --config playwright.sat-calculator-desktop-guard.config.ts
# k6 (track B/C, isolated staging schedule only):
K6_CONFIRM_SAT=true K6_BASE_URL=... K6_SCHEDULE_ID=... k6 run k6/sat-exam-day.js
```

### 8.2 Test matrix (every FR/INV → test)

| ID | Layer | Case (Given/When/Then) | Owner |
|---|---|---|---|
| FR-01 | E2E-A component | Given Math+calculator; When desmos.com aborted; Then error ≤15s + distinct data-desmos-status; Retry restores ready + metric | A |
| FR-01 | unit | onError/timeout → error; ≤3 retries; key-bump remounts one mode | A |
| FR-02 | E2E-A | 500-headless burst: doc-count mean ≤1.2 in 60s; p95 ready improves on Fast-3G | A+C |
| FR-03 | k6 | 2000 VU/60s/single-schedule: bootstrap p99<5s, handoff p99<5s, ack p95<2s, submit p99<30s | B+C |
| FR-04 | E2E-C | forced-429: queue UI + Retry-After honored (beacon) | B+C |
| FR-05 | reducer+route | blocked toggle → unchanged; pause→auto-close; unpause→closed (pin SG-01) | A |
| FR-06 | component+unit | seeded en-US → embed still lang=en; finalize sweeps locale keys | A |
| FR-07 | route | no save under prewarm: prefix; hold+pause → overlay + inert | A |
| INV-001/002/003 | route | C1–C13 + NEW C14 form-boundary bare (zero iframes) + malformed policy/section (fail-closed, no throw) | A+C |
| INV-004 | route | M1 mode ⇏ M2 (isolation); return-from-review stays closed | A |
| CONC-01 | k6+stress | 2000/60s preset-ON green + pool/outbox signals; barrier variant (N starts same ms) | B |
| CONC-02 | E2E chaos | blackhole/503/CSP/slow-2g matrix; reload-amplifier absent (doc-count bounded) | A+C |
| CONC-03 | concurrency | double-toggle determinism; toggle\|\|pause race → closed+refused | A |
| Recovery | E2E | kill timeout-worker mid-run → finalize via API; tab-crash → drafts intact (durability) | B+C |
| Regression | existing | Math-only, bare-branch, keepAlive identity, submit-replay identical receipt | A+B |

---

## 9. Extensibility & remaining risks

**Probe (one realistic change):** College Board ships a third Desmos mode (e.g. `four-function` for accommodated Math).

```text
Change point: DesmosCalculator DESMOS_MODES + desmosEmbedUrl + Panel calculatorModes + workspace default (all mode-keyed).
Untouched: route gating, Host identity, reducer, backend, beacon shape (mode is a label).
Why ready: watchdog/retry/defer keyed by mode, not hardcoded to 2; doc-budget rule ("≤1 eager + defer rest") already covers N modes.
```

**Remaining risks / rollout:**

1. Desmos per-IP throttle uncontracted (Inferred) → single-egress 2000-doc test + vendor statement before claiming headroom.
2. Prod flag values Unknown → B0 dump mandatory; preset is env/runbook, NOT code default flip.
3. School filters break desmos.com per-site → 24h+1h site probe + allowlist runbook + wave starts (>N seats/AP) as backpressure.
4. Deploy/publish during Math re-herds → freeze windows + audit log; rollback itself re-herds (freeze > rollback).
5. Metric cardinality → scheduleId top-N + hashed room key; sample full dims.
6. If beacon endpoint 429s itself → client drops (no retry storm) + dashboard notes gap.

**Remediation order:** watchdog+lazy+preset+probe+board (P1, before next mass Math) → blocked-guard/locale/hold/prewarm (P1 correctness) → queue UI/selector/docs (P2) → comment/test hardening (P3) → locale-layer delete-vs-wire + guard-vs-truth deprecation (P4).

---

## 10. Sub-agent handoff checklist (lead merges)

- [ ] A: files changed list + `typecheck/lint/test:run` output + E2E-A/B logs.
- [ ] B: preset values + rehearsal logs (ON vs OFF) + dashboard links + beacon sample rows.
- [ ] C: 3 consecutive greens (1 throttled) + doc-count + ready-rate + pool/outbox snapshots.
- [ ] Lead: Math-only + bare-branch + submit-replay regressions green; freeze + probe runbook published; ready-rate alert live.

*Method note: this plan follows low-level-implementation-engineer Phases 0–5 (boundary → requirements → ownership → function design → traces → verification → extensibility) and treats every `await`/I/O/tx/queue-ACK as a scheduling boundary per the concurrency auditor. Interleavings above are the acceptance bar, not background.*
