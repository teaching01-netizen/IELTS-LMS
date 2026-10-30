# IELTS Offline Download Silent Failure — Low-Level Implementation Plan

**Status:** Implemented 2026-10-31. Verification evidence is in section 9.

**Supersedes for student-facing failure behavior:** the download-failure notice and
manual retry described in
`2026-10-30-ielts-shared-clock-offline-continuity.md` (section 4.4 and Task 6).
The shared timetable, package contents and answer-durability rules are unchanged.

**Product decision:** a failed offline download is a background cache miss, not an
exam event. It must never produce student-visible text, a button, a modal, a
toast, or a live-region announcement. The student continues online.

---

## 1. Change boundary and repository evidence

### Verified current behavior

| File / symbol | Current behavior |
| --- | --- |
| `src/features/student/ui/IeltsOfflineStatusNotice.tsx` | Failure branch at lines 41–49 adds “This device isn’t ready…” / audio failure text. Lines 59–63 render a **Try again** button calling `continuity.retryPreparation`. |
| `src/features/student/hooks/useIeltsOfflineContinuity.ts` | `IeltsOfflinePackageStatus` has `failed` (line 40). `retryPreparation` is public (line 53) and only works by incrementing `retryToken` (line 95). Preparation effect lines 129–171 runs once per identity and sets `failed` on any failure (line 168). No automatic retry. |
| `src/features/student/application/ieltsOfflinePreparation.ts` | Failure reasons: `manifest_invalid`, `identity_mismatch`, `shell_unavailable`, `media_failed`, `audio_unavailable`, `quota`, `storage_failed`, `cancelled`. Returns a typed result; normal failures do not throw. |
| `src/features/student/infrastructure/ieltsOfflineMediaCache.ts` | Media reuses verified Cache Storage bytes on retry (lines 88–116); maximum concurrency is 2. |
| `src/features/student/routes/IeltsStudentDeliveryBranch.tsx` | Only consumer of `IeltsOfflineStatusNotice`; passes `continuity` and `attemptSnapshot`. |
| `src/features/student/application/__tests__/ieltsOfflinePreparation.test.ts` | Covers all preparation failure reasons; no retry/backoff tests. |
| `docs/operations/ielts-offline-continuity.md` | Records preparation failures as an operator metric; no student failure policy. |
| `docs/superpowers/plans/2026-10-30-ielts-shared-clock-offline-continuity.md` | Line 246 says “explicit retry”; line 415 says “accessible recovery text”. This decision supersedes those student-facing parts. |

### Assumption to confirm

“Do not show anything” applies to **download failure**. Actual offline/save-status
text (“You’re offline… saved on this device”) remains because it is not a download
error and is needed for answer honesty. If the intent is zero offline-related UI,
that is a separate change and must update the save-status contract.

**Out of scope:** new proctor incident UI, server changes, manual download button,
pre-start package distribution, CDN migration.

---

## 2. Requirements and invariants

### Functional

- **FR-1** A package-preparation failure updates internal status only; it never
  renders text, a button, a live-region message, a toast or a modal.
- **FR-2** A transient failure is retried automatically with bounded attempts,
  exponential backoff and jitter, while online.
- **FR-3** A terminal failure stops retrying for that package identity until the
  identity changes or the page reloads.
- **FR-4** A retry downloads only missing resources; verified media bytes are
  reused.
- **FR-5** Retries never alter `runtimeSnapshot`, blocking state, the room
  timetable, answer saves or navigation.
- **FR-6** Every attempt and terminal state emits a reason-coded telemetry event.
- **FR-7** No retry starts after the attempt is submitted, the runtime is
  completed/cancelled, or the component unmounts.

### Rules

- **RULE-1** Only shared-timetable IELTS rooms use this path.
- **RULE-2** Retry only while `navigator.onLine` is true.
- **RULE-3** Maximum 4 total preparation attempts per package identity
  (1 initial + 3 retries).
- **RULE-4** The retry budget resets only when `identityKey` changes
  (attempt/version/session/lease/recovery/digest), not on every live snapshot.
- **RULE-5** Manual retry is removed. There is no student action.

### Failure classification

| Reason | Retry? | Why |
| --- | --- | --- |
| `shell_unavailable` | Yes | Deployment/network may recover |
| `media_failed` | Yes | Missing/corrupt/HTTP failure may be transient |
| `storage_failed` | Yes | IndexedDB may be temporarily unavailable |
| `quota` | No | Retry cannot create storage |
| `audio_unavailable` | No | Decode failure is deterministic |
| `identity_mismatch` | No | Wrong package; wait for a new manifest |
| `manifest_invalid` | No | Bad descriptor; wait for a new manifest |
| `cancelled` | No | Deliberate abort |
| `unexpected` | No | Unknown exception; do not loop |

### Invariants

- **INV-1** A failure cannot change the projected runtime or the exam clock.
- **INV-2** A retry cannot delete pending answers, drafts or evidence.
- **INV-3** At most one preparation request and one retry timer exist per hook
  instance.
- **INV-4** No state update occurs after unmount or after an aborted attempt.
- **INV-5** Terminal package status is never surfaced to the student.

---

## 3. Ownership and state model

| Unit | Responsibility | State |
| --- | --- | --- |
| `ieltsOfflinePreparation.ts` | Owns failure taxonomy and retry policy | None |
| `useIeltsOfflineContinuity` | Owns per-device preparation attempt lifecycle and timer | `packageStatus`, retry ref (`identityKey`, attempts, timer) |
| `IeltsOfflineStatusNotice` | Shows only actual offline/save state | None; no failure rendering |
| `ieltsOfflineMediaCache` | Owns verified media reuse | Cache Storage |
| `ieltsOfflinePackageStore` | Owns durable package commit | IndexedDB |

### Status transition table

| Current | Event / guard | Next | Side effect |
| --- | --- | --- | --- |
| `unavailable` | Manifest + identity + online | `preparing` | Start attempt |
| `preparing` | Prepared | `prepared` | Pin shell, emit metric |
| `preparing` | Retryable failure, attempts < 4 | `deferred` | Schedule timer; emit metric |
| `preparing` | Retryable failure, attempts = 4 | `deferred` | No timer; emit exhausted metric |
| `preparing` | Terminal failure | `deferred` | No timer; emit metric |
| `deferred` | Timer/online event | `preparing` | Next attempt |
| `deferred` | Identity changes | `unavailable` → `preparing` | Reset attempts |
| Any | Submitted/completed/cancelled | unchanged | Clear timer; stop |

### Proposed status type

```ts
export type IeltsOfflineDeferredReason =
  | IeltsOfflinePreparationFailure
  | 'unexpected';

export type IeltsOfflinePackageStatus =
  | { state: 'unavailable' }
  | { state: 'preparing' }
  | { state: 'prepared'; record: IeltsOfflinePackage }
  | {
      state: 'deferred';
      reason: IeltsOfflineDeferredReason;
      attempts: number;
      retryAt: number | null; // internal only
    };
```

`failed` disappears. `deferred` remains on `IeltsOfflineContinuity` only so the
notice can keep its “no projection and unavailable” guard. It is never rendered.

---

## 4. Function-level design

### 4.1 Retry policy (new, in `ieltsOfflinePreparation.ts`)

```ts
export const IELTS_OFFLINE_MAX_ATTEMPTS = 4;

const OFFLINE_RETRY_DELAYS_MS = [5_000, 20_000, 60_000] as const;

export function isRetryableIeltsOfflineFailure(
  reason: IeltsOfflinePreparationFailure,
): boolean;

/** failedAttempt is 1-based; null means the retry budget is spent. */
export function nextIeltsOfflineRetryDelayMs(
  failedAttempt: number,
  random?: () => number,
): number | null;
```

Behavior:

- attempt 1 fails → `5s ± 20%`
- attempt 2 fails → `20s ± 20%`
- attempt 3 fails → `60s ± 20%`
- attempt 4 fails → `null`

`random` is injectable for deterministic tests. This function is the single owner
of delay/budget policy.

### 4.2 Hook changes

Remove from `IeltsOfflineContinuity`:

```ts
retryPreparation: () => void;
```

Remove `retryToken`. Add:

```ts
const [retrySignal, setRetrySignal] = useState(0);
const retryRef = useRef<{
  identityKey: string | null;
  attempts: number;
  timer: ReturnType<typeof setTimeout> | null;
}>({ identityKey: null, attempts: 0, timer: null });
```

Add `online` via `useSyncExternalStore` so reconnect resumes preparation and an
offline transition aborts the active attempt.

Preparation effect:

```ts
const terminal =
  Boolean(attemptSnapshot?.submittedAt) ||
  runtimeSnapshot?.status === 'completed' ||
  runtimeSnapshot?.status === 'cancelled';

useEffect(() => {
  if (!shared || !manifest || !userId || !candidateId || !attemptId || !hasStatic || terminal) {
    clearRetryTimer();
    return undefined;
  }
  if (!online) return undefined; // reconnect changes the online dep

  if (retryRef.current.identityKey !== identityKey) {
    clearRetryTimer();
    retryRef.current = { identityKey, attempts: 0, timer: null };
  }

  const current = latest.current;
  if (
    current.record?.key === ieltsOfflinePackageKey(userId, manifest) &&
    current.record.manifest.contentDigest === manifest.contentDigest
  ) {
    return undefined;
  }

  const attempt = retryRef.current.attempts + 1;
  retryRef.current.attempts = attempt;
  const controller = new AbortController();
  const startedAt = Date.now();

  setPackageStatus({ state: 'preparing' });
  void prepareIeltsOfflinePackage({ ... })
    .then((result) => {
      if (controller.signal.aborted) return;
      emitStudentObservabilityMetric('ielts_offline_preparation', {
        reason: result.status === 'prepared' ? 'prepared' : result.reason,
        attempt,
        latencyMs: Date.now() - startedAt,
      });

      if (result.status === 'prepared') {
        retryRef.current.attempts = 0;
        setPackageStatus({ state: 'prepared', record: result.record });
        if (result.record.shellBuildId) void pinIeltsOfflineShell(...);
        return;
      }

      const delay = isRetryableIeltsOfflineFailure(result.reason)
        ? nextIeltsOfflineRetryDelayMs(attempt)
        : null;
      setPackageStatus({
        state: 'deferred',
        reason: result.reason,
        attempts: attempt,
        retryAt: delay === null ? null : Date.now() + delay,
      });
      if (delay !== null) {
        retryRef.current.timer = setTimeout(() => {
          retryRef.current.timer = null;
          setRetrySignal((value) => value + 1);
        }, delay);
      } else if (isRetryableIeltsOfflineFailure(result.reason)) {
        emitStudentObservabilityMetric('ielts_offline_preparation_exhausted', {
          reason: result.reason,
          attempt,
        });
      }
    })
    .catch(() => {
      if (controller.signal.aborted) return;
      setPackageStatus({
        state: 'deferred',
        reason: 'unexpected',
        attempts: attempt,
        retryAt: null,
      });
      emitStudentObservabilityMetric('ielts_offline_preparation', {
        reason: 'unexpected',
        attempt,
      });
    });

  return () => controller.abort();
}, [
  shared, identityKey, userId, candidateId, attemptId, hasStatic,
  retrySignal, online, terminal,
]);
```

Rules enforced here:

- `setPackageStatus` never contains student text.
- The timer is cleared on unmount, identity change, offline, or terminal.
- `controller.signal.aborted` prevents stale results.
- `attempts` is a ref, not state, so changing it does not restart the effect.
- `packageStatus` is deliberately **not** in the dependency array; otherwise the
  effect would abort itself.

### 4.3 Notice changes

In `src/features/student/ui/IeltsOfflineStatusNotice.tsx`:

- Delete the failure message block (lines 41–49).
- Delete the Try again button (lines 59–63).
- Keep the existing `online`, projection, and clock messages.
- Remove `retryPreparation` usage.
- Keep the early return:

```ts
if (!projection && packageStatus.state === 'unavailable') return null;
```

A `deferred` package with no projection produces no messages online, so no element
renders.

### 4.4 Media download priority

In `ieltsOfflineMediaCache.fetchInit`, add:

```ts
priority: 'low',
```

if supported by the TypeScript DOM lib; otherwise set it via a typed `RequestInit`
cast. This reduces competition with answer-save requests. The existing 2-request
cap stays.

### 4.5 Telemetry

- Keep `ielts_offline_preparation`; add `attempt` and `latencyMs`.
- Add `ielts_offline_preparation_exhausted` for retryable failures that run out
  of budget.
- Do not include media URLs, answer content, candidate names or credentials.
- No new server route or DB field.

---

## 5. Implementation sequence

| Step | File | Change | Depends on |
| --- | --- | --- | --- |
| 1 | `src/features/student/application/ieltsOfflinePreparation.ts` | Add `IELTS_OFFLINE_MAX_ATTEMPTS`, `isRetryableIeltsOfflineFailure`, `nextIeltsOfflineRetryDelayMs` | — |
| 2 | `src/features/student/application/__tests__/ieltsOfflinePreparation.test.ts` | Table tests for classification and delay/budget | 1 |
| 3 | `src/features/student/hooks/useIeltsOfflineContinuity.ts` | Replace `failed`/`retryToken` with `deferred` + bounded auto-retry; remove `retryPreparation`; add online/terminal guards | 1 |
| 4 | `src/features/student/ui/IeltsOfflineStatusNotice.tsx` | Remove failure text and Try again | 3 |
| 5 | `src/features/student/ui/__tests__/IeltsOfflineStatusNotice.test.tsx` | New: deferred status renders nothing; offline message still works | 4 |
| 6 | `src/features/student/hooks/__tests__/useIeltsOfflineContinuity.test.tsx` | New: retry, exhaustion, terminal, unmount, offline | 3 |
| 7 | `src/features/student/infrastructure/ieltsOfflineMediaCache.ts` | Low-priority fetch | — |
| 8 | `docs/operations/ielts-offline-continuity.md` | Record silent-failure policy and operator-only telemetry | 3–4 |
| 9 | Verification commands | Typecheck, target tests, lint | all |

### Compatibility

- No API, DB, auth, or serialized-contract change.
- Older clients keep the old failure notice; new clients are silent. This is
  acceptable because this is a client-only UX change.
- `IeltsOfflinePackageStatus.failed` is internal to the hook/notice; no external
  consumer was found.

---

## 6. Worked traces

### Trace A — transient media failure

```text
Initial: manifest M, online, static payload loaded, attempts=0
t0    effect: attempt=1, status=preparing
t0+   cacheOne fails on one image -> reason=media_failed
      status=deferred{attempts:1, retryAt:t0+5s}; no UI
t5    timer -> retrySignal -> effect: attempt=2
      9 verified media reused; missing image fetched
      status=prepared; shell pinned; no UI
Final: package ready, attempts reset, no student-visible change
```

### Trace B — quota failure

```text
t0 attempt=1 -> reason=quota
quota is terminal -> status=deferred{retryAt:null}
no timer, no retry, no UI, no exception
Final: online-only device; exam unaffected
```

### Trace C — identity changes during backoff

```text
status=deferred{identityKey:A, attempts:2, timer:T}
new manifest -> identityKey:B
effect cleanup clears T; attempts reset to 0
attempt=1 under B
Final: no retry carries the old package's budget
```

### Trace D — terminal room state

```text
attemptSnapshot.submittedAt set / runtime completed
effect cleanup clears timer, aborts request, returns
Final: no further preparation or network traffic
```

---

## 7. Verification matrix

| Test | Layer | Assertion |
| --- | --- | --- |
| Retry policy table | Unit | Correct classification; delays bounded; attempt 4 returns null; jitter within ±20% |
| Transient failure retries | Hook | First failure schedules exactly one timer; second call after delay; `deferred` then `prepared`; no failure UI |
| Exhausted budget | Hook | Exactly 4 calls, then no further calls after extended time; one exhausted metric |
| Terminal failure | Hook | One call; no timer; `retryAt: null` |
| Offline | Hook | No attempt while offline; attempt after online transition |
| Unmount | Hook | Timer cleared; no state update; no extra call |
| Identity change | Hook | Timer cleared and attempts reset |
| Terminal runtime | Hook | No attempt after submitted/completed |
| Notice | Component | `deferred`/`failed` produces no text, no `Try again`, no status element |
| Actual offline | Component | Existing “You’re offline…” message still appears |
| Answer impact | Regression | Package failure does not change projected runtime or the attempt save flow |
| Media reuse | Existing unit | Already covered; remains green |
| E2E failure injection | Browser | Block shell/media; exam still renders and saves; no “not ready” or “Try again” text |

Commands:

```bash
bunx vitest run \
  src/features/student/application/__tests__/ieltsOfflinePreparation.test.ts \
  src/features/student/hooks/__tests__/useIeltsOfflineContinuity.test.tsx \
  src/features/student/ui/__tests__/IeltsOfflineStatusNotice.test.tsx \
  src/features/student/infrastructure/__tests__/ieltsOfflineMediaCache.test.ts
bun run typecheck
bunx eslint <changed files>
```

---

## 8. Extensibility and remaining risks

### Extension probe

A future **manual “Download for offline”** button would add a public trigger and
progress state, but it must not alter the failure policy or the exam clock. The
retry-policy module already owns the budget/classification; a manual trigger can
call the same attempt function without duplicating rules.

A future **early pre-start download** changes when `manifest` is available, not
this failure state machine. The hook already gates on manifest identity and can
accept an earlier manifest without redesign.

### Risks

- **Silent permanent failure** means some students have no offline reload ability
  and do not know. Accept this by product decision; monitor
  `ielts_offline_preparation` / exhausted metrics and preparation coverage per
  room.
- **Reconnect burst:** including `online` in the effect retries immediately after
  reconnect. Attempts are capped and media bytes are reused, but a large
  simultaneous reconnect can still generate load. If measurements show this,
  add a 0–5s jitter before the post-reconnect attempt.
- **No student notification** may conflict with the earlier plan’s “accessible
  recovery text” requirement. The plan/docs must record the superseding
  decision.
- **Unexpected exceptions** are treated as non-retryable `deferred` and never
  shown; this is deliberate.
- **Online/offline detection** is advisory (`navigator.onLine`); a false
  “online” simply causes one failed attempt, which is bounded.

**Key design rule:** the offline package is a cache-like capability. Its failure
is a cache miss for the device, not an exam event. The student sees nothing; the
system retries within a budget and records the outcome for operators.

---

## 9. Implementation evidence (2026-10-31)

| Step | File | Delivered |
| --- | --- | --- |
| 1 | `src/features/student/application/ieltsOfflinePreparation.ts` | `IELTS_OFFLINE_MAX_ATTEMPTS` (derived from the delay table), `IeltsOfflineDeferredReason`, `isRetryableIeltsOfflineFailure`, `nextIeltsOfflineRetryDelayMs` (5s/20s/60s, ±20%, clamped, injectable `random`) |
| 2 | `src/features/student/application/__tests__/ieltsOfflinePreparation.test.ts` | Classification, budget and jitter-band table tests |
| 3 | `src/features/student/hooks/useIeltsOfflineContinuity.ts` | `deferred` replaces `failed`; `retryPreparation`/`retryToken` removed; bounded timer-based retry; online, terminal, identity and unmount guards; `attempt`/`latencyMs` telemetry |
| 4 | `src/features/student/hooks/useBrowserOnline.ts` | Shared `useSyncExternalStore` connectivity hook (hook + notice) |
| 5 | `src/features/student/ui/IeltsOfflineStatusNotice.tsx` | Failure text and **Try again** removed; offline/save/clock messages unchanged |
| 6 | `src/features/student/ui/__tests__/IeltsOfflineStatusNotice.test.tsx` | `unavailable`/`preparing`/`deferred` render and announce nothing; offline message still works |
| 7 | `src/features/student/hooks/__tests__/useIeltsOfflineContinuity.test.tsx` | Retry, exhaustion, deterministic failure, unexpected exception, offline, unmount, identity change, terminal state, aborted-attempt budget |
| 8 | `src/features/student/infrastructure/ieltsOfflineMediaCache.ts` | `priority: 'low'` on every media fetch; 2-request cap unchanged |
| 9 | `docs/operations/ielts-offline-continuity.md` | Silent-failure policy, retry budget, operator-only telemetry, updated acceptance row |
| 10 | `e2e/ielts-shared-offline.spec.ts` | Asserts no failure copy and no retry control during the offline reload |

Verification run:

```text
bun run typecheck                                            -> passed (no output)
bunx eslint src/features/student/                            -> 0 errors (2 pre-existing warnings
                                                                in untouched files)
bunx vitest run \
  .../application/__tests__/ieltsOfflinePreparation.test.ts \
  .../hooks/__tests__/useIeltsOfflineContinuity.test.tsx \
  .../ui/__tests__/IeltsOfflineStatusNotice.test.tsx \
  .../infrastructure/__tests__/ieltsOfflineMediaCache.test.ts
                                                             -> 4 files, 38 tests passed
bunx vitest run src/features/student src/components/student   -> 326 files, 2894 passed, 2 skipped
```

Not run here: `bunx playwright test e2e/ielts-shared-offline.spec.ts --config
playwright.ielts-offline.config.ts`. It needs an isolated `TEST_DATABASE_URL`,
the seeded `ieltsSharedScheduleId` fixture and a `vite preview` build with the
service worker; that run remains the exam-day acceptance gate.

Behavioural notes beyond the plan:

- An attempt aborted by an offline transition or a StrictMode remount returns
  its budget, so a flapping connection cannot exhaust the four attempts without
  ever completing one.
- The retry-budget identity includes the user and candidate, so switching
  accounts on one device never inherits another student's budget.
- `retryAt` is internal/diagnostic only; nothing renders or polls it.
