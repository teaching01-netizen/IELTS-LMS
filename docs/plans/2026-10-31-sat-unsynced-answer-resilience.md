# SAT unsynced-answer resilience — implementation plan

Date: 2026-10-31
Status: implemented (phases 0–4 and 1b); phase 5 (clock offset) deferred by design
Incident reference: attempt `1ca99032-04c9-4eb1-87f2-afcceed4b810` (DB/UTC times)

Implementation evidence:
- Engine: `getUnsyncedSince`, `flush({ forceRetry })`, lifecycle `pageshow`, close settlement for quarantined acks.
- Hook/UI: `unsyncedSince`, two-stage dismissible notice, `stalled` save state, banner close audit.
- Server: non-recovery closes return compact `settledWrites` identities; recovery keeps `finalAcks`.
- Client close: settles the manifest identities from local payloads, force-flushes before/after close, and delays evidence 3 s.
- Proctor review: `SatLateEvidenceDialog` wired into the room inspector, with `alreadyScored` returned by the proctor list endpoint; read-only dispositions only.
- Tests: `DurableResponseEngine.unsynced.test.ts`, `satUnsyncedNotice.test.ts`, route/staff panel/room-entry/late-evidence dialog tests, `settledManifestWrites` Go test, updated finalization-recovery test, `e2e/sat-unsynced-answers.spec.ts`, banner-gallery dismiss audit.
- Verification run: 2057 Vitest tests passed (2 skipped) across 202 files, Go `internal/proctor` + `internal/delivery` packages passed, `bun run typecheck` passed, `bun run build` passed, and the banner gallery passed with the new unsynced screenshots and dismiss audit.

## 1. What actually happened (evidence)

| UTC | Event |
|---|---|
| 07:38:42 | M1 (Reading & Writing base, 32:00) starts |
| 07:38:56 / 07:38:57 | Last two M1 writes reach the server (`attempt_responses_v2`, q `e7c4fd47…` v1→v2) |
| 07:39:13 | Underline annotation created on the device (timestamp inside the evidence payload) |
| 07:39 → 08:10 | **No server writes from this device** (32 min) |
| 08:10:42.396 | M1 visible deadline |
| 08:10:57.853 | Server closes M1 with `route_basis = window_closed` — deadline + 15.45 s, the backstop for a browser that never confirmed |
| 08:11:00.276 | Client quarantines two M1 drafts |
| 08:11:00.486 | Late evidence uploaded |
| 08:11:00.566 | Client starts M2 (2.7 s after it became available) |
| 08:54:17 | Staff device-transfer grant issued (target Math); first session revoked `device_transfer` |
| 08:54:58 | New session; M3 starts |

Evidence comparison:

| Question | Server | Evidence | Meaning |
|---|---|---|---|
| `e7c4fd47…` | v2 at 07:38:57, no underline | later annotation created 07:39:13 | newer edit never delivered |
| `b86413c8…` | **no row** | answer `A` | never scored |

`would_change_route = 0` for both. Route decision: `lower`, `raw_correct 0/27`.

Conclusions:
- The banner was **true**: the device held real, unsent answers.
- The device transfer happened **43 minutes later**; it is not the cause.
- The prior IELTS use on the physical device is **not represented** in this account or any server-side write path; per-attempt credentials, locks and IndexedDB keys isolate attempts.
- The 32-minute silent gap is the defect to address: **not “saves are unreliable” but “the product did not make the unreliable state visible, and had no forced last-chance flush.”**

## 2. Problem statement

A live SAT module can accumulate answer changes that never reach the server for tens of minutes while the exam UI shows nothing actionable. When the module expires, the work is preserved as evidence but never scored, and the student learns only after the window is gone. Separately, a lost save acknowledgement at M1→M2 can be mistaken for a late answer and produce false evidence.

## 3. Goals, non-goals, invariants

Goals:
1. Make an unsynced window visible during the module within 10 s (p95), and clear it within 2 s of a confirmed save.
2. Force a pending retry at lifecycle boundaries (`visibilitychange` hidden, `pagehide`, `freeze`, `pageshow`).
3. Stop treating an already-scored write as late evidence when a successful close proves it durable.
4. Give proctors a way to review the evidence that still occurs.
5. Instrument the rate and duration of unsynced windows.

Non-goals:
- Guaranteeing delivery from a suspended/offline device. Impossible from the browser.
- Auto-rescoring late evidence or changing the M1→M2 route (violates INV-5).
- Blocking the exam with a modal on every failed save.
- Replacing the durable engine or adding a new queue.

Invariants:
- An answer is never silently discarded: confirmed, pending, or evidence.
- Healthy saving stays silent (no “Saved”/“Saving…” narration).
- Evidence is immutable and never auto-scored.
- No answer content or student PII in metrics/logs.
- Every dismissible notice or banner has a visible close control (X). Dismissal is per message generation and never suppresses the underlying state or action.
- Persistent status indicators (Live data, Reconnecting, Overrun) and blocking state surfaces (proctor pause, time-up, integrity hold) are not dismissible banners: closing them would hide a condition the student must act on.

## 4. Current critical path and failure points

`accept` (400 ms debounce) → `responses:batch` (15 s timeout) → ack → confirmed.

| Stage | Code | Failure today |
|---|---|---|
| Local acceptance | `DurableResponseEngine.acceptResponse` | Works; drafts are durable |
| Delivery | `responseDurabilityTransport.ts:71-79` | 15 s timeout, retries with ≤3 s backoff |
| Visibility | `SatSaveStatus` renders only `failed`/`superseded` (`SatSaveStatus.tsx:39`) | A 32-min unsynced window is invisible |
| Lifecycle flush | `DurableResponseEngine.ts:3738-3748` | **Exists**, but `flush()` returns immediately when `retryTimer` is set (`:1658`) — the last-chance flush can be a no-op |
| Close | `useSatExamController.ts:695-891` | `flush()` before close; non-recovery close returns no `finalAcks` (`close_module.go:224-227`), client only applies acks when `preparedClose` exists (`:819-825`) |
| Seal | `hydrateBootstrap` → `sealScope` (`useSatResponsePersistence.ts:440-444`) | Quarantines every pending write for a closed module, including accepted-but-unacked writes |
| Evidence upload | `useSatResponsePersistence.ts:449-503` | Starts immediately; a late ack can prune local quarantine after the row was already POSTed |

## 5. Options

| Option | Change | Fixes visibility | Fixes false evidence | Cost/risk |
|---|---|---|---|---|
| A. Minimal | unsynced notice + force flush | yes | no | small |
| **B. Recommended** | A + close settlement + evidence settle delay | yes | yes | medium; no schema change |
| C. Product-level | auto-rescore late evidence / re-route | n/a | n/a | rejected: breaks route/scoring invariants |
| D. Transport redesign | per-answer request or WS ack per keystroke | no better | no | more load, still fails on suspension |

**Recommendation: B.** It addresses the observed failure without weakening the one-route/scoring invariants.

## 6. Design

### 6.1 Unsynced window (engine)

Add:

```ts
private unsyncedSince: number | null = null;

/** Time the oldest unconfirmed change first became pending, or null when synced. */
public getUnsyncedSince(): number | null { ... }
```

Rules:
- Set on the first accepted command that is not immediately acknowledged (per attempt, not per keystroke). **Do not reset on every keystroke** — otherwise a student typing continuously never sees the warning.
- Clear on any acknowledgement that leaves no pending writes, on scope seal, and on engine reset.
- Expose it from `useSatResponsePersistence` as `unsyncedSince`.

Route:
- Tick once per second only while `unsyncedSince != null`.
- Render a warning in the notice row below the timer:
  - 10 s: “Still saving your last answers — keep this screen open.”
  - 30 s or an explicit network failure: “Your last answers are only on this device. Reconnect to send them.”
- Dismissible with the same X used by every other notice banner. Dismissal is keyed to the current window and severity:
  `dismissKey = ${unsyncedSince}:${severity}` where `severity` is `slow` (10 s) or `offline` (30 s / explicit network failure).
  It reopens when the severity escalates and for a new unsynced window; new keystrokes in the same window do not reopen it. It disappears on a confirmed ack regardless of dismissal.
- Copy lives in `SAT_COPY` (`notice.unsyncedSlow`, `notice.unsyncedOffline`, `notice.dismiss`).
- `data-testid="sat-unsynced-notice"` and `data-sat-unsynced="true"` for tests.
- Map `saveState` to `stalled` so `SatSaveStatus`/diagnostics agree.

Why not the save-status row only: the row below the exam body is easy to miss on an iPad; the incident’s notice slot below the timer is the correct place. Why dismissible: the product rule for this change is that every banner has a close control; safety is preserved by reopening on escalation and on the next unsynced window, and by never stopping retries or evidence preservation when dismissed.

### 6.2 Lifecycle flush (engine)

```ts
public async flush(options: { forceRetry?: boolean } = {}): Promise<void>
```

- `forceRetry`: clear `retryTimer` and drain immediately.
- Lifecycle listeners call `flush({ forceRetry: true })`; `pageshow` also calls it.
- Keep it bounded: one drain pass; never loop from a lifecycle event.
- Do not add `sendBeacon` in phase 1. Evaluate later only if cookies/CSRF allow it; a half-working beacon is worse than none.

Close path:
- Call `flush({ forceRetry: true })` before the first close and on each retry.
- This directly fixes the “retryTimer makes flush a no-op” hole.

### 6.3 Close settlement (server + client)

Server (`close_module.go`):
- Non-recovery close returns `SatModuleCloseAck.SettledWrites`: the manifest entries the server holds under the exact write id and client version. This is **identity only**, not full canonical acks — at a synchronized transition a 200-question manifest must not ship 200 answers back to every browser.
- A normal close that passed `pendingCloseWritesTx` returns `req.Answers` as the settled set without another query.
- The `alreadyClosed` and lifecycle-replay paths query only `(question_id, client_write_id, client_version)` and return the matches; missing entries remain genuinely unsent.
- Recovery closes keep the existing `finalAcks` path.

Client (`useSatExamController.closeTimedOutModule`):
- Call `persistence.settleScopeClose(moduleAttemptId, ack.settledWrites)` before `acceptPayloadAndRoute`; the engine promotes the **local** pending payload to confirmed for matching identities and prunes quarantine.
- Recovery mode keeps `acknowledgeScopeClose(finalAcks)`.
- This clears pending/outbox/inflight before `hydrateBootstrap` seals the module.

Acceptance: a lost HTTP ack + successful close produces **zero** evidence and **zero** quarantine; the write is confirmed; the close reply stays identity-sized.

### 6.4 Evidence settle delay

- Delay the evidence POST by 3 s after a scope closes.
- On the timer, re-check `engine.getQuarantined()` and upload only entries that still exist.
- A late close ack prunes the quarantine during the delay, so no duplicate row is written.
- The quarantine is already durable; if the page dies inside the delay, the next load uploads it.

### 6.5 Proctor review (follow-up)

- Add a review panel/route using the existing backend endpoints:
  `GET /sessions/{schedule}/attempts/{attempt}/late-evidence`,
  `POST /sessions/{schedule}/attempts/{attempt}/late-evidence/review`.
- Show module, question, response, client/server receive times, `would_change_route`, and a duplicate marker when `write_id` exists in `attempt_responses_v2`.
- No rescore action in this iteration.

### 6.6 Clock offset (deferred)

`satClockOffsetMs = serverNow − receivedAt` ignores request transit. With the 15 s personal close window it did not cause this incident. Track as a separate change using send/receive midpoint; do not bundle it with the reliability fix.

### 6.7 Banner dismissal policy (global)

Policy: **every notice or banner the student or staff can see carries a close control.**

Scope:
- Student notice row: proctor message, exam error, lease conflict, save failed/superseded, **unsynced warning** (new), late/module-closed notice (only if reintroduced).
- Staff room notices: room created, stale data, action success, action failure.
- Inline panel warnings that read as a banner: Module 2 queue load failure, join-room details failure, answers-poll failure.
- Already-done baseline: `SatControlBanner` and `SatRoomNotices` expose a close in the right slot; the remaining audit is the inline panel warnings.

Control:
- X glyph at the right edge, 44×44 target, `aria-label="Dismiss message"`; focus-visible ring; never steals focus; Escape does not dismiss (prevents an accidental close while using the keyboard).
- Visually consistent with the existing `SatControlBanner` close (`SatControlFeedback.tsx`).

Semantics:
- Dismissal is keyed to the message generation (`text + severity/state + window id`), not to the component lifetime.
- A new message, a severity escalation, or a new unsynced window reopens the banner.
- Dismissal never stops retries, evidence preservation, or the underlying action.
- If a banner is the only place an action lives, the action must remain reachable elsewhere before the banner is made dismissible (e.g. save retry still exists in the timeout surface; take-over still exists in `SatSaveStatus`).
- Staff action banners keep their action available on the relevant student/panel control after dismissal.

Explicit exceptions (not banners):
- Blocking surfaces: proctor pause, time-up, integrity hold — they have exactly one required action and no close.
- Persistent status text: Live data / Reconnecting, Overrun, Needs attention counts. Closing them would hide a condition the proctor is expected to act on; they are not notice strips.
- Confirmation boxes: rotate start code, recovery decision, terminate attempt. They already have Cancel/close semantics; keep them as confirmations, not dismissible notices.

Accessibility and telemetry:
- One live region per banner; dismissal does not re-announce the banner.
- Emit `sat_banner_dismissed_total{id}` (no answer content) so the team can see whether safety notices are being dismissed and whether the escalation re-open is doing its job.

## 7. Phased implementation

### Phase 0 — instrumentation (0.5 day)
- Emit `sat_unsynced_window_started` / `sat_unsynced_window_cleared` with duration, pending count, reason (`hidden`, `pagehide`, `ack`, `close`).
- Emit `sat_close_settled_pending_total` and `sat_evidence_upload_skipped_total` (settled by ack).
- Dashboard: unsynced windows per 100 sittings, p95 duration, evidence rows per 100 sittings.
- Flag: `VITE_SAT_UNSYNCED_NOTICE` (default on after rollout; off = old behavior).

### Phase 1 — visible unsynced notice (1–2 days)
Files: `DurableResponseEngine.ts`, `useSatResponsePersistence.ts`, `SatStudentSessionRoute.tsx`, `satCopy.ts`, `SatSaveStatus.tsx` (state union), tests.
Acceptance:
- Notice appears at ≥10 s of a continuous unsynced window and clears on ack.
- Notice carries a close control (X) and can be dismissed.
- Dismissal hides it for the current severity; the 30 s escalation reopens it; a new unsynced window reopens it; new keystrokes in the same window do not.
- Dismissal never stops retries or evidence preservation.
- No notice while healthy saving.
- No notice for blocked/terminal states (they have their own copy).
- Screen-reader announcement once per state transition, not per tick.

### Phase 1b — banner dismissal audit (0.5–1 day)
Files: `SatStaffRoutePanel.tsx`, `SatRoomEntryPanel.tsx`, `SatAttemptAnswersRoute.tsx`, plus a grep/audit test.
Acceptance:
- Every notice-strip/banner component exposes a close control, matching 6.7.
- The inline Module 2, join-room, and answers-poll warnings have a close whose dismissal resets on a new error.
- The exceptions in 6.7 are documented in the audit test (blocking overlays, status text, confirmations).
- No action-required banner becomes dismissible without keeping its action reachable.
- `e2e/sat-banners.spec.ts` asserts a dismiss control for every gallery notice banner and skips only the documented exceptions.

### Phase 2 — lifecycle flush (0.5–1 day)
Files: `DurableResponseEngine.ts`, `useSatExamController.ts`.
Acceptance:
- With a scheduled retry, `pagehide` triggers a batch request immediately.
- No more than one drain attempt per lifecycle event.
- Existing `DurabilityEngine.debounce` tests remain green; add force-retry tests.

### Phase 3 — close settlement (implemented)
Files: `backend/go/internal/delivery/close_module.go`, `close_module_test.go`, `useSatExamController.ts`, `useSatResponsePersistence.ts`, `DurableResponseEngine.ts`, vitest.
Acceptance (met):
- Non-recovery close ack carries `settledWrites` for every manifest entry that is durable (identity only).
- Client settles those identities from its local payload before the module is sealed.
- Lost-ACK scenario: no evidence row, no quarantine, `data-sat-save-state="idle"`.
- `alreadyClosed` close still settles what exists.

### Phase 4 — evidence review UI (implemented)
Files: `backend/go/internal/proctor/late_evidence.go` (`alreadyScored`), `src/products/sat/api/lateEvidence.ts`, `src/products/sat/ui/SatLateEvidenceDialog.tsx`, `SatSessionRoomStudents.tsx`.
Acceptance (met):
- Proctor can list evidence from the selected-student inspector and record `acknowledged`/`investigated` with an optional note.
- Rows whose exact `writeId` is already canonical are marked “Already scored”.
- `wouldChangeRoute` and provenance conflicts are visible.
- No scoring or route mutation exists in the surface.

## 8. Test plan

### 8.1 Vitest (engine/controller/UI)

| Test | File | Assertion |
|---|---|---|
| unsyncedSince starts once and does not reset per keystroke | `DurableResponseEngine.unsynced.test.ts` (new) | two accepts while failing → one timestamp |
| unsyncedSince clears on ack | same | pending null, timestamp null |
| force flush clears retryTimer and drains | `DurableResponseEngine.debounce.test.ts` | `sendBatch` called on `pagehide` even with a retry scheduled |
| close ack settles in-flight pending | `DurableResponseEngine.moduleScope.test.ts` | `applyScopeCloseAcknowledgement` → quarantined empty, pending null |
| close ack prevents later seal | same | `sealScope` after settlement adds no quarantine |
| non-recovery close settles from `settledWrites` | `useSatExamController` test | `settleScopeClose` called with the compact identities |
| manifest settlement promotes the local payload | `DurableResponseEngine.unsynced.test.ts` | no quarantine, pending null, confirmed answer |
| notice appears at threshold and clears | `SatStudentSessionRoute` test | notice visible/hidden |
| notice dismisses, reopens on escalation, and does not reopen per keystroke | same | X hides; 10 s→30 s reopens; a new window reopens; typing in the same window does not |
| every banner has a close control | `satBannerDismissal.test.ts` (new audit) | all notice components render `Dismiss message`; documented exceptions only |
| inline warning dismissal resets on a new error | staff panel tests | close hides; new `loadError` text reopens |
| healthy save stays silent | existing shell test | no notice, `saveState` idle |

### 8.2 Go

| Test | Assertion |
|---|---|
| `TestSettledManifestWritesMatchExactWriteAndVersion` (sqlmock) | settled identities match the exact stored write/version; a mismatched write is omitted |
| `TestSATCloseAlreadyClosedSettlesManifest` (future MySQL integration) | locked module close returns settled identities for existing manifest entries and no error for missing ones |
| `TestSATCloseManifestPendingStillRefused` | a genuinely unsent write still returns `CLOSE_WRITES_PENDING` |
| Existing `SATLateEvidenceMySQL` | unchanged; evidence still records genuinely late writes |

### 8.3 Playwright E2E (real Go API + MySQL, existing harness)

Use `e2e/support/satStudentSession.ts:createRunningSatSession` (admin creates a live SAT room, student context joins). Add `e2e/sat-unsynced-answers.spec.ts`. Set the test thresholds via `VITE_SAT_UNSYNCED_NOTICE_MS=1500` and `VITE_SAT_UNSYNCED_OFFLINE_MS=4500` in the E2E webServer env; production defaults are 10 s and 30 s.

1. **Unsynced notice appears and clears**
   - `studentPage.route('**/v2/student/attempts/*/responses:batch', route => route.abort('failed'))`.
   - Answer a question.
   - `expect(page.getByTestId('sat-unsynced-notice')).toBeVisible({ timeout: 10_000 })`.
   - Assert text + `role="status"` + `data-sat-save-state="stalled"`.
   - `unroute`; wait for `data-sat-save-state="idle"` and notice hidden.
   - Staff Results shows the answer (no loss).

2. **Close control dismisses, escalation reopens**
   - Fail batches; answer; wait for the slow notice.
   - Click `Dismiss message`; notice hidden.
   - Wait for the 30 s/offline escalation (`VITE_SAT_UNSYNCED_OFFLINE_MS=4500` in E2E); notice reopens.
   - Click dismiss again; typing another answer in the same window does not reopen it.
   - `unroute`; notice stays hidden after sync; assert idle.
   - This is the acceptance test for the “all banners have a close” policy.

3. **Reload recovers an unsynced draft**
   - Fail batches, answer, wait notice.
   - Reload; fail batches still; assert the answer is still selected and the notice returns after recovery.
   - Unroute; assert idle and the staff side has the answer.

4. **True late evidence, not a false duplicate**
   - Answer A; wait idle (confirmed).
   - Fail batches; answer B.
   - Shorten M1 via `executeUpdate` (`attempt_id = <created>`; `allocated_seconds = elapsed + 5`).
   - Wait for M1 locked / M2 visible.
   - Call the staff late-evidence endpoint for the attempt; assert exactly B, never A.
   - Assert `attempt_responses_v2` has A and not B.
   - Unroute, answer in M2, assert M2 remains usable; evidence stays one row after reconnect.

5. **Lost ACK at M1→M2 (integration-level substitute)**
   - Playwright cannot reliably drop a single response mid-flight; cover this with the Vitest + Go tests above.
   - If we add a dev-only transport fault injector, use it to delay the ack past the close and assert no evidence POST.

6. **No false positive for a scored write**
   - Confirm A; close M1 normally; assert the late-evidence endpoint is empty.
   - This is the regression guard for the non-recovery close gap.

7. **Banner gallery close audit (extends `e2e/sat-banners.spec.ts`)**
   - For every captured notice banner, assert `getByRole("button", { name: "Dismiss message" })` is visible.
   - Assert the documented exceptions have no close: integrity hold, paused overlay, time-up overlay, overrun/reconnecting status text.
   - Click one representative close and assert the banner is hidden; reload and confirm it returns only if its state is still live.

Anti-flake rules:
- Wait on `data-sat-save-state` and network responses, never arbitrary sleeps.
- One test per DB mutation; `describe.configure({ mode: 'serial' })` where the harness shares DB state.
- Use a unique attempt per test (the harness already does).
- Threshold override only via test env; product behavior covered by unit tests.

### 8.4 Fault/load (non-gating)
- 5% `responses:batch` aborts for a 2-minute sitting; assert the notice appears and clears, no console errors, no duplicate evidence.
- Report p95 notice-detection time and evidence count per 100 sittings.

## 9. Observability and rollout

Metrics:
- `sat_unsynced_notice_shown_total` / `sat_unsynced_window_seconds` (histogram), reason labels only.
- `sat_close_settled_pending_total`, `sat_evidence_upload_skipped_total`.
- Existing `sat_late_answer_evidence_total`, `sat_module_close_total`.

Gates:
- p95 time from first unsynced pending to notice ≤ threshold + 2 s.
- Evidence rate for attempts with a successful ack in the prior 10 minutes ≈ 0 (lost-ACK signal).
- No increase in `CLOSE_WRITES_PENDING` rate.

Rollout:
1. Server ack field first (additive; old clients ignore it).
2. Client UI behind `VITE_SAT_UNSYNCED_NOTICE` (`off` hides the notice and the `stalled` diagnostic).
3. Force flush and the evidence settle delay ship unconditionally: they have no user-visible effect on a healthy connection, are bounded to one lifecycle/close edge, and are covered by unit/integration tests.
4. 5% → 25% → 100% of SAT schedules.
5. Rollback: disable the UI flag; server acks are harmless to old clients; no schema migration.

Implemented metric names: `sat_unsynced_window_started`, `sat_unsynced_window_cleared`, `sat_unsynced_notice_dismissed`, `sat_close_settled_pending`, `sat_evidence_upload_skipped`.

## 10. Risks and open questions

- **False alarm from slow-but-successful requests** (15 s timeout): use two-stage copy; “Still saving” at 10 s is not an error claim.
- **Notice fatigue**: the unsynced notice is dismissible per window, but it reopens on the 30 s escalation and on a new unsynced window; it clears on sync. Telemetry `sat_banner_dismissed_total` measures whether students dismiss it and whether the escalation reopens it.
- **Dismissed safety warning hides a live risk**: mitigated by escalation/new-window reopening and by keeping retries/evidence active; the banner is never the only control that matters.
- **Lifecycle flush cannot complete on iOS**: keepalive is not guaranteed; the notice/evidence path remains the safety net.
- **Should evidence allow awarding the point?** Product/legal decision outside this plan; current system intentionally does not rescore.
- **Dismissal vs accessibility**: the close control is 44×44, labelled, focus-visible, and never steals focus; Escape is not a dismiss shortcut, so keyboard users do not close a banner while navigating.
- **Threshold**: validate against production save-latency p99 before hard-coding 10 s/30 s.

## 11. Key engineering insight

You cannot make a suspended browser deliver. The achievable guarantees are: **know quickly**, **flush once at the lifecycle edge**, **preserve without scoring**, and **reconcile duplicates**. The incident was not a delivery failure the code could have prevented; it was a **visibility failure** the code can eliminate.
