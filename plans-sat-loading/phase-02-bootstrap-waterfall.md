# Phase 02 — Bootstrap waterfall (SAT-skinned first paint + seed/dedupe child bootstrap)

> Stage: PLAN ONLY — do not implement. Inspect-only plan against the real codebase.
> Depends on Phase 01 contract. Owns ONLY bootstrap props/seed in SatStudentSessionRoute.
> Must NOT touch host/branch wrapping (Phase 03 seam), preview, IELTS, or backend contracts.

## 1. Objective

Eliminate the R1 double-take on the SAT student cold open:

- Today: parent StudentSessionRoute blocks on isLoading and renders the admin
  LoadingSurface -> AppLoadingSkeleton (grey bg-gray-50, skeleton rows), then mounts
  SatStudentSessionRoute with data === null, whose child useSatExamController
  bootstrap effect fires a 3rd fetch and the !data branch renders a second, visually
  different SatLoadingSurface (SAT .sat-ui spinner). Skeleton -> unmount -> spinner.
- After Phase 02: a SAT cold open shows exactly ONE loader skin (SAT) from the moment
  the provider is known as sat through delivery bootstrap; the child initial
  bootstrap() fires at most once per identity generation, reuses the parent seed
  (identity, epochs, ETag) and never refires on parent re-render / StrictMode remount /
  unrelated prop churn; errors remain reachable exactly once (parent errors in parent skin,
  delivery errors in SAT skin).

Non-objectives: no backend contract change, no IELTS / staff / preview behavior change,
no spinner visual redesign (Phase 01 owns the surface), no host/prewarm gating (Phase 03),
no runner convergence or polling-calm changes beyond the bootstrap effect (Phase 04).

## 2. Dependencies — what Phase 02 assumes from the Phase 01 contract

Phase 02 does not redefine loading visuals. It assumes Phase 01 has landed and imports
from it verbatim. If any item below is missing, Phase 02 is blocked (do not reinvent it here):

1. SatLoadingKind type exists (expected: student-delivery/ui/feedback/SatStateSurfaces
   or adjacent contract file) with at least 'initial' | 'module-refresh' | 'finalizing'.
   Phase 02 uses 'initial' for the bootstrap window only.
2. Single-surface rule: SatLoadingSurface (SAT .sat-ui tokens, role=status, single live
   region) is the ONLY full-screen loader permitted on the SAT student path past auth.
   LoadingSurface / AppLoadingSkeleton (grey admin skin,
   src/components/ui/LoadingSurface.tsx:7-10 -> AppLoadingSkeleton.tsx:7-39, also role=status)
   MUST NOT appear for providerKey === 'sat' once the provider is known.
3. Props contract: SatLoadingSurface accepts at minimum { label: string } (verified today at
   SatStateSurfaces.tsx:47-67); Phase 02 assumes Phase 01 final prop shape (e.g. optional
   kind?: SatLoadingKind) and passes kind=initial where supported, falling back to label-only
   if Phase 01 kept the current signature. Phase 02 MUST NOT change SatStateSurfaces itself.
4. Hidden-prewarm silence: Phase 01 guarantees hidden Desmos prewarm emits no role=status
   (so the exactly-one-loader assertion is meaningful without touching calculator host code).
5. No new stores / no payload change: the seed in section 4 is a frontend-only handoff struct.

If Phase 01 renamed tokens, moved the surface file, or changed the label API, adapt the import
sites in section 5 to the new path/signature without altering visual output.

## 3. Verified current state (file:line refs — the exact code Phase 02 changes)

### 3.1 Parent route — src/features/student/routes/StudentSessionRoute.tsx (135 lines)

- 49-51: `if (isLoading) return <LoadingSurface label="Loading Exam..." />` — unconditional
  admin skeleton for ALL providers, including SAT. This is the first skin.
- 53-78: parent error branch (invalid access code / session expired / generic). Must be
  preserved verbatim for SAT (Back to Check-in vs Retry mapping).
- 80-89: `!state` -> Exam Not Found + Back to Check-in. Preserved.
- 91-117: SAT branch. Gated on `providerKey === 'sat'` + `scheduleId` +
  `attemptSnapshot?.id`; missing attempt -> SAT attempt unavailable + Back to
  Check-in (92-101). On success mounts SatStudentSessionRoute with scheduleId, attemptId
  (= attemptSnapshot.id), candidateId, attemptSnapshot, runtimeSnapshot, liveSocketConnected,
  attemptUpdateToken (= satAttemptUpdateToken), leaseEpoch, controlEpoch, onExit (103-116).
  Today this mount happens only after `isLoading === false`, i.e. after static + live settle.
- 119-134: IELTS path renders StudentAppWrapper — MUST stay byte-identical in behavior
  (constraint: keep StudentAppWrapper path identical).

### 3.2 Parent data hook — src/features/student/hooks/useStudentSessionRouteData.ts (962 lines)

- Return interface StudentSessionRouteData (51-64): attemptSnapshot, error, isLoading,
  providerKey ('ielts'|'sat'|'act'|'unknown'), runtimeSnapshot, liveSocketConnected,
  satAttemptUpdateToken, schedule, state, refreshRuntime, retry. attemptSnapshot /
  runtimeSnapshot today seed only session identity + epochs (no delivery bootstrap payload).
- providerKeyFromVersion (81-95): derives provider from version.contentSnapshot.providerKey;
  default state is 'ielts' (109), so a true cold open reads 'ielts' until
  loadStaticSessionSnapshot sets it to 'sat' (190-193).
- loadStaticSessionSnapshot (185-229): fetch #1 (static schedule+version via
  sessionBootstrap?.loadStatic() ?? studentSessionFacade.loadStaticSession), sets
  schedule/state/providerKey/staticVersionIdRef; throws on 'unknown' provider.
- loadStudentData (672-828): orchestrates static (fetch #1, 697) then live (fetch #2, 707-708),
  then maybeRebootstrapStaticOnVersionMismatch (231-241; re-fetches static + live on
  publishedVersionId drift, 712-723), then freshness-gated apply + attempt reconcile/create
  (725-808), then applyLoadTransition(source, succeeded|failed) driving isLoading/error via
  evaluateLoadTransition in studentSessionStateMachine.ts:166-214.
- Auth gate: returns early while authStatus === 'loading' (682-684); mount effect (835-845) keys on
  scheduleId::candidateId::authStatus and only fires when authStatus === 'authenticated'.
  Retry is loadStudentData('retry') (960).
- refreshBackendSessionSnapshot (343-544): poll/refresh path; bails while isLoading (348) — load vs
  refresh are separate epochs (refreshEpochRef, inFlightRefreshCountRef, freshness refs). Phase 02 is
  read-mostly here: it only reads staticVersionIdRef-equivalent info and attempt/runtime revisions
  for the seed; it MUST NOT change refresh cadence, debounce (546-557), poll loop (847-945), or
  socket-disabled policy (634-659, enabled: false).
- Re-export shim src/features/student-delivery/routes/StudentSessionRoute.tsx:1 just re-exports the
  parent — edits go in src/features/student/routes/StudentSessionRoute.tsx.

### 3.3 Child route — src/features/student-delivery/routes/SatStudentSessionRoute.tsx (502 lines)

- Props interface SatStudentSessionRouteProps (34-45): identity + snapshots + epochs + onExit.
  Phase 02 owns ONLY additions to this interface (seed / initial-loading hint); it MUST NOT alter
  branch wrapping or host code (Phase 03 seam, section 9).
- Controller instantiation (63-73) forwards props straight into useSatExamController.
- 107-117: `error && !data` -> SAT-skinned SatErrorSurface (Exit). Preserved; Phase 02 keeps the
  child-error-surfaces-once-in-SAT-skin invariant.
- 118-122: `!data` -> `<SatLoadingSurface label="Loading Digital SAT..." />`. This is the second
  skin. Phase 02 keeps this branch as the single SAT bootstrap surface but ensures it is the FIRST
  and ONLY loader the SAT user sees (parent no longer shows admin first), and threads the Phase 01
  kind=initial prop through if available.
- 133-197+: calculator warm-module resolution + withCalculatorHost wrapping every branch
  (204,213,231,255,270,301,308,318,331,370,400) — Phase 03 owns this; Phase 02 MUST NOT touch it,
  not even to bare the loading branch.

### 3.4 Child controller — src/features/student-delivery/hooks/useSatExamController.ts (1052 lines)

- Options UseSatExamControllerOptions (46-56): scheduleId, attemptId, candidateId, attemptSnapshot?,
  runtimeSnapshot?, liveSocketConnected?, attemptUpdateToken?, leaseEpoch?, controlEpoch?.
  Phase 02 extends ONLY this options struct (+ bootstrap-seed fields).
- Identity generation (85-106): identityKey = schedule:attempt:candidate, identityGenerationRef bump
  on change, full local reset (setData(null) + recover(createSatRunnerState)). The generation guard is
  the existing dedupe primitive — Phase 02 reuses it, does not replace it.
- applyPayload (137-168): generation check + schedule/attempt match (139-145), stale-bootstrap guard on
  timing.runtimeRevision (148-160), then setData/setSnapshotReceivedAt/setResult/setError(null)/
  hydrateBootstrap. Untouched except that the bootstrap effect keeps funneling through it.
- refresh(surfaceError, ifNoneMatch) (170-187): single gateway call with ETag passthrough, 304 as null
  (177), conditional error surfacing. Untouched.
- Bootstrap effect (189-207) — the 3rd fetch and the core Phase 02 edit site: unconditional
  satDeliveryGateway.bootstrap(scheduleId, attemptId) on [applyPayload, attemptId, scheduleId], no seed
  awareness, no ETag, mounted-flag only (no generation capture at call time), dispatches bootstrapLoaded
  on success and setError on any failure (including offline). Every parent mount of the child refires it
  even when the parent already holds a fresh attempt/runtime.
- Polling (226-289): ETag ref (225), backoff cadence, offline-event handoff, revision / attemptUpdateToken
  triggers calling refresh(false). Read-mostly for Phase 02; Phase 04 owns calm-polling. Phase 02 MUST NOT
  change poll intervals or deps.

### 3.5 Delivery API + ETag cache (read-mostly)

- src/features/student-delivery/api/assessmentDeliveryApi.ts:176-192: bootstrap(scheduleId,
  attemptId, ifNoneMatch?) already sends If-None-Match when given (Plan C4 comment). No change
  needed; Phase 02 only passes a cached ETag (when available) instead of null.
- src/features/student-delivery/infrastructure/satDeliveryGateway.ts:7: satDeliveryGateway =
  assessmentDeliveryApi thin alias. No change.
- src/features/student-delivery/bootstrapEtag.ts:62-106 (createBootstrapCache): memory + sessionStorage
  ETag cache with 304-reuse and corrupt-entry drop. The controller poll path keeps its own pollEtagRef;
  Phase 02 MUST NOT rewire this cache into the gateway — it only reads the cached ETag (if trivially
  available) to seed the first bootstrap() call, falling back to null (= full fetch) when absent.
- Writer identity: configureSatDeliveryAttempt(scheduleId, attemptId, candidateId,
  snapshot recovery/integrity clientSessionId) (controller 108-118) already runs on mount from
  attemptSnapshot. The seed preserves this flow; Phase 02 adds no new identity.

### 3.6 Boundary — preview (MUST NOT change behavior)

- src/features/student-delivery/routes/SatPreviewRoute.tsx:25-47 +
  src/features/student-delivery/hooks/useSatPreviewController.ts:64+: preview loads via
  assessmentAuthoringApi (authoring draft projection), NOT assessmentDeliveryApi.bootstrap, with its own
  preview.loading / preview.error / preview.projection states. Phase 02 touches neither file nor the
  useSatPreviewController hook; grep for bootstrap( in student-delivery must show no preview call-site
  after Phase 02. Note this boundary in the PR description.

### 3.7 Loader skins (why the flash is visible)

- Admin: src/components/ui/LoadingSurface.tsx:7-10 renders AppLoadingSkeleton.tsx:7-39 — grey bg-gray-50,
  header bar + pulsing rows, role=status.
- SAT: SatStateSurfaces.tsx:47-67 renders .sat-ui centered spinner + pulse bars on var(--sat-background),
  role=status. Different backgrounds, different DOM — a cold open today exposes both back-to-back, and
  (until Phase 01 lands) both expose competing live regions.

## 4. Contracts / interfaces (exact shapes Phase 02 introduces)

All new types live in ONE new file so the seam with Phase 03 stays clean and the child route diff
stays props-only. New file: src/features/student-delivery/bootstrap/satBootstrapSeed.ts (new; no backend
change; plain data, no store, no fetch inside).

```ts
// Frontend-only handoff: parent static+live snapshot -> child delivery bootstrap.
// NEVER carries exam content; delivery content still comes ONLY from
// assessmentDeliveryApi.bootstrap (different endpoint/payload family).
export interface SatBootstrapSeed {
  readonly scheduleId: string;
  readonly attemptId: string;
  readonly candidateId: string;
  /** Identity snapshot the parent reconciled (durability owner). Null only when the parent
      mounted the child early while live was still pending — child still bootstraps. */
  readonly attemptSnapshot: StudentAttempt | null;
  readonly runtimeSnapshot: ExamSessionRuntime | null;
  /** Wall-clock ms when the parent applied the live snapshot (staleness display only). */
  readonly liveSnapshotReceivedAt: number | null;
  /** Parent static version id (staticVersionIdRef) — lets the child detect a republish
      without refetching static itself. */
  readonly staticVersionId: string | null;
  /** Attempt/runtime revisions at seed time — lets the child skip a redundant bootstrap
      when nothing moved (dedupe fast-path is ETag/304, NOT byte reuse). */
  readonly attemptRevision: number | null;
  readonly runtimeRevision: number | null;
  /** Cached delivery ETag for If-None-Match, when the session cache already holds one.
      Null = first fetch (full bytes). */
  readonly deliveryEtag: string | null;
  /** Parent load epoch at seed time; child echoes it for observability correlation only. */
  readonly seedGeneration: number;
}

export function seedMatchesIdentity(
  seed: SatBootstrapSeed | null | undefined,
  input: { scheduleId: string; attemptId: string; candidateId: string },
): boolean;

export function buildSatBootstrapSeed(input: {
  scheduleId: string; attemptId: string; candidateId: string;
  attemptSnapshot: StudentAttempt | null; runtimeSnapshot: ExamSessionRuntime | null;
  liveSnapshotReceivedAt: number | null; staticVersionId: string | null;
  deliveryEtag: string | null; seedGeneration: number;
}): SatBootstrapSeed;
```

Dedupe rule for the 3rd fetch (normative — implement exactly this):

1. The child fires satDeliveryGateway.bootstrap() at most once per identity generation
   (scheduleId:attemptId:candidateId, the existing identityGenerationRef in
   useSatExamController.ts:85-92).
2. A second invocation with the same identity generation is allowed ONLY if one of these changed
   since the in-flight/completed call: staticVersionId (republish), attemptRevision forward move that
   the current data.timing.runtimeRevision does not already cover, or an explicit user retry
   (retryBootstrap / refresh(true)). Parent re-renders, runtimeSnapshot object churn with equal
   revision, attemptUpdateToken bumps with no payload change, and React StrictMode double-effects MUST
   NOT refire it (in-flight singleflight + generation capture).
3. The first call passes seed.deliveryEtag ?? null as ifNoneMatch; a 304 is success with no payload
   (existing refresh() 304 path, controller :177) and MUST NOT set error or clear a seed-provided
   loading label.
4. Bytes are NEVER reused from the seed: the parent static/live payloads (ExamState / ExamSessionRuntime /
   StudentAttempt) are a different family from AssessmentDeliveryBootstrap (sections, modules, timing,
   delivery attempt). The seed only serializes timing (child waits for parent live-settle OR mounts early
   with the seed marked pending) and carries identity/epochs/ETag so the one bootstrap call is correctly
   scoped. Any plan that claims the seed eliminates the bootstrap network call on cold open is wrong — it
   dedupes re-fires and ETag-hits it.

Who owns isLoading for providerKey === 'sat' (normative):

- Parent owns auth + static: authStatus ('loading'|'authenticated'|'unauthenticated',
  src/features/auth/authSession.tsx:25) and static schedule/version resolution. While
  authStatus === 'loading' the parent may render the admin skeleton (provider-agnostic, out of scope
  for the flicker assertion).
- Once providerKey === 'sat' AND static has resolved (schedule + state non-null), the parent MUST NOT
  render LoadingSurface anymore. It either mounts the child immediately (passing initialIsLoading when
  live is still pending) or renders SatLoadingSurface (SAT skin, Phase 01 kind=initial) directly — never
  the admin skin.
- Child owns delivery bootstrap: data === null means SAT loading (existing !data branch, route :118-122).
  Live-pending-after-static is expressed as the child loading state, not as parent isLoading. Parent
  isLoading for SAT therefore means static not yet resolved only; see section 5 step 2 for the flag split.
- IELTS/unknown paths keep today's semantics exactly (StudentAppWrapper branch untouched).

Props extensions (additive, optional, backwards-compatible):

```ts
// SatStudentSessionRouteProps — ADD (existing fields unchanged):
  bootstrapSeed?: SatBootstrapSeed | null;
  initialIsLoading?: boolean;

// UseSatExamControllerOptions — ADD (existing fields unchanged):
  bootstrapSeed?: SatBootstrapSeed | null;
  initialIsLoading?: boolean;
```

The route forwards both verbatim into useSatExamController (route :63-73 call site gains two lines;
nothing else in the route file changes — Phase 03 seam).

Error/retry handoff (exactly-once rule):

- Parent errors (invalid access code, session expired/unauthorized, unsupported provider, missing
  schedule, !state, SAT attempt missing) render in the parent branch and the child is NEVER mounted, so
  child error state stays null. Parent retry() (loadStudentData('retry')) is reachable only from parent
  error surfaces.
- Child errors (bootstrap throw incl. offline first paint, 401-after-refresh, version-mismatch rebootstrap
  failure) render in SatErrorSurface paths (route :107-117 and later data-present banners) with the child
  own retry (refresh(true) / commands.retryFinalization); the parent MUST NOT overlay its error surface on
  top (parent error is null once the child is mounted — enforce by construction: the parent SAT-mounted
  branch does not consult parent error after mount, and parent refresh failures are benign-silent per hook
  :526-534).
- Offline first paint: child bootstrap failure with navigator.onLine === false renders the SAT error surface
  with retry (NOT a bare spinner, NOT the admin skeleton); the existing recovery poller (218-274) keeps
  retrying underneath per current behavior.

## 5. Step-by-step implementation (do in this order; no source edits outside listed files)

### Step 1 — Add the seed struct (new file, no behavior change)

1. Create src/features/student-delivery/bootstrap/satBootstrapSeed.ts with SatBootstrapSeed +
   seedMatchesIdentity + a buildSatBootstrapSeed pure helper (parent hook calls it; unit-testable
   without React).
2. Export it from the delivery feature barrel ONLY if the feature uses barrels; otherwise import by
   path. Do not add a store, context, or fetch helper in this file.

### Step 2 — Expose the SAT seed from the parent hook (read-mostly, additive)

File: src/features/student/hooks/useStudentSessionRouteData.ts. Additive only; do not alter fetch order,
freshness gates, debounce, poll loop, or machine adapters.

1. Track two extra refs alongside existing ones: liveReceivedAtRef: number | null (set to Date.now()
   wherever the hook today calls setAttemptSnapshot / setRuntimeSnapshot on the load path, 747-807) and
   reuse the existing staticVersionIdRef (221) + refreshEpochRef (117) — no new epoch system.
2. Derive and return (memoized) two new fields on StudentSessionRouteData:
   - satBootstrapSeed: SatBootstrapSeed | null — non-null iff providerKey === 'sat' && scheduleId &&
     attemptSnapshot?.id && candidateId; built from attemptSnapshot, runtimeSnapshot,
     staticVersionIdRef.current, deliveryEtag (see 4), refreshEpochRef.current.
   - isSatStaticReady: boolean — true iff providerKey === 'sat' && schedule && state (static resolved,
     regardless of live/attempt pending). This is the flag that lets the parent stop showing the admin
     skeleton before live settles.
3. Read the cached delivery ETag WITHOUT importing gateway internals into the student feature: expose a
   tiny getter from the delivery feature (e.g. getCachedDeliveryEtag(scheduleId, attemptId) reading the
   same sessionStorage key sat-bootstrap-etag:scheduleId:attemptId defined in bootstrapEtag.ts:22-23,
   wrapped in try/catch, returning string | null). If even that import is deemed layer-crossing, default
   deliveryEtag: null (full fetch) — the dedupe rule still holds via singleflight; the ETag is an
   optimization, not correctness.
4. Keep isLoading semantics for IELTS/unknown EXACTLY as today (machine-driven, applyLoadTransition). For
   SAT, isLoading continues to mean load not succeeded (static OR live pending) — the parent route
   (Step 3), not the hook, decides to stop rendering the admin skeleton once isSatStaticReady is true.
   This keeps StudentAppWrapper + IELTS tests green while giving the SAT branch its early-mount flag.

### Step 3 — Gate the parent admin skeleton for the SAT branch (the flash fix)

File: src/features/student/routes/StudentSessionRoute.tsx. SAT-branch only; IELTS branch (119-134)
untouched.

1. Destructure the two new hook fields (satBootstrapSeed, isSatStaticReady) — no other hook-signature
   changes. Also read status from the already-imported useAuthSession() (logoutAll source) for the auth
   window.
2. Replace the unconditional loader (49-51) with provider-aware gating (pseudocode in section 6.1).
   Normative behavior table:
   - authStatus loading (hook early-return path) -> keep <LoadingSurface> (provider-agnostic auth window;
     excluded from flicker assert).
   - isLoading && providerKey === 'sat' && isSatStaticReady -> render SatLoadingSurface SAT skin, NOT admin.
   - isLoading && providerKey === 'sat' && !isSatStaticReady (static still in flight) -> SAT skin as well;
     the only admin-skeleton window for SAT is before the provider is known at all.
   - isLoading && providerKey !== 'sat' -> <LoadingSurface> unchanged (IELTS/unknown; on a true first-ever
     SAT cold open the provider still reads the hook default 'ielts' until static resolves — this residual
     admin flash is accepted ONLY for the static window; see Step 3.4 mitigation. IELTS identical either way).
   - Parent error / !state / attempt-missing branches: unchanged, still first (error supersedes loading
     exactly as today).
3. Change the SAT mount condition (91-117) so the child mounts as soon as static is ready, NOT after live
   settles — with one hard constraint: attemptId is required (string). Implement Option A (recommended):
   keep the attemptSnapshot?.id hard-require for mounting, but render the SAT skin (not admin) while waiting
   for it. Simplest, no placeholder id, preserves Back to Check-in attempt-missing semantics (92-101 moves to
   AFTER live settles: while isLoading && sat && !attemptSnapshot show SAT loader; only when !isLoading &&
   sat && !attemptSnapshot?.id show SAT attempt unavailable). The remaining waterfall
   (static->live->bootstrap = 3 serial fetches) is accepted; the FIX is single-skin + single bootstrap fire,
   not fetch parallelism. REJECTED Option B (early-mount with provisional id): writer identity
   (configureSatDeliveryAttempt), ETag keys, and gateway paths all key on the real attempt id; a provisional
   id risks a bootstrap against the wrong key. Do not implement Option B in Phase 02.
4. Accepted residual + mitigation (document in PR, do not gold-plate): on a true first-ever cold open with
   empty storage, the static window (providerKey still default 'ielts') shows the admin skeleton for ~1 RTT
   before flipping to SAT skin. Mitigation WITHOUT changing IELTS semantics: NONE in Phase 02 (a provider hint
   cache would add storage coupling; defer to a follow-up if e2e deems the static-window flash unacceptable).
   The flicker assertion (section 8) therefore scopes to from provider-known-sat onward, exactly one skin +
   child bootstrap fires once. Cold-open e2e should assert: no AppLoadingSkeleton DOM (grey bg-gray-50
   skeleton) present at any point AFTER the SAT skin first appears, and exactly one role=status loader visible
   at a time.
5. Pass bootstrapSeed={satBootstrapSeed} initialIsLoading={isLoading} into SatStudentSessionRoute (103-116
   call site). leaseEpoch/controlEpoch/onExit pass-through unchanged.

### Step 4 — Accept (not rewrap) the seed in the child route (props-only seam)

File: src/features/student-delivery/routes/SatStudentSessionRoute.tsx. PROPS ONLY.

1. Extend SatStudentSessionRouteProps (34-45) with the two optional fields from section 4 (import type
   SatBootstrapSeed from ../bootstrap/satBootstrapSeed).
2. Destructure + forward them into useSatExamController({ ..., bootstrapSeed, initialIsLoading }) (63-73). No
   other line in this file changes — in particular do NOT touch 107-122 branches, calculator warm-module
   computation (133-170), withCalculatorHost (177-197), or any phase branch below. If the Phase 01 kind prop
   exists, thread kind=initial into the !data SatLoadingSurface (118-122) in the same edit ONLY if it is a
   one-prop addition with zero wrapping change; otherwise leave even that to Phase 01 and note it.
3. Keep the attempt missing -> Back to Check-in equivalent: the child still requires a real attemptId
   (parent guarantees it per Step 3 Option A); no placeholder ids.

### Step 5 — Seed/dedupe the controller bootstrap effect (the 3rd-fetch fix)

File: src/features/student-delivery/hooks/useSatExamController.ts. Only the bootstrap effect (189-207) +
options struct (46-56) change; applyPayload, refresh, polling, submit/finalize paths untouched.

1. Extend UseSatExamControllerOptions with bootstrapSeed?: SatBootstrapSeed | null; initialIsLoading?:
   boolean (destructure with = null / = false defaults).
2. Rewrite the effect per the sketch in section 6.2 (generation-captured singleflight, seed ETag,
   seed/identity validation via seedMatchesIdentity, version-mismatch rebootstrap through the existing
   refresh(false, etag) path, error surfacing only when surfaceError-appropriate — i.e. keep today setError
   on initial-bootstrap failure so the error && !data SAT error surface (route :107-117) stays reachable,
   but skip error-setting for a superseded generation).
3. Keep dispatching { type: bootstrapLoaded, assessmentId: payload.versionId } on success exactly as today
   (195). Keep the identity-reset effect (94-106) as the generation owner; the bootstrap effect observes
   generations, never mints them.
4. Do NOT import the parent hook, facade, or student-session gateway into the controller. The only new import
   is the seed type + matcher (pure, no React, no fetch).

### Step 6 — Verify the seam: preview, IELTS, backend untouched

1. git grep for assessmentDeliveryApi.bootstrap / satDeliveryGateway.bootstrap must show call-sites ONLY in
   useSatExamController.ts (+ tests); SatPreviewRoute / useSatPreviewController must not appear.
2. git diff --stat for Phase 02 must contain ONLY: NEW bootstrap/satBootstrapSeed.ts;
   useStudentSessionRouteData.ts (additive seed derivation); StudentSessionRoute.tsx (SAT-branch gating +
   seed pass); SatStudentSessionRoute.tsx (props/forward only); useSatExamController.ts (options + bootstrap
   effect); tests (see section 8). Any other source file in the diff is a seam violation — revert it.

## 6. Important code / pseudocode (copy-adapt, do not invent new patterns)

### 6.1 Parent SAT-branch gating sketch (replaces route :49-51 unconditional skeleton)

```tsx
// StudentSessionRoute.tsx — ADD SatLoadingSurface import (Phase 01 path/signature);
// ADD status to the existing useAuthSession() destructure.
import { SatLoadingSurface } from '../../student-delivery/ui/feedback/SatStateSurfaces';

const hookData = useStudentSessionRouteData(scheduleId, studentId);
const { attemptSnapshot, error, isLoading, providerKey, runtimeSnapshot,
  liveSocketConnected, satAttemptUpdateToken, state, refreshRuntime, retry,
  satBootstrapSeed, isSatStaticReady } = hookData; // last two NEW from Step 2

// Auth window stays provider-agnostic (excluded from the flicker assertion).
if (authStatus === 'loading' && isLoading) {
  return <LoadingSurface label="Loading Exam..." />;
}

// SAT-known window: NEVER the admin skeleton again.
if (isLoading && providerKey === 'sat') {
  // Static resolving OR live/attempt pending (Option A): single SAT skin.
  return <SatLoadingSurface label="Loading Digital SAT..." />;
  // Add kind="initial" here iff Phase 01 defined SatLoadingKind + the prop.
}

if (isLoading) {
  return <LoadingSurface label="Loading Exam..." />; // IELTS / unknown / pre-provider: unchanged
}

// error (53-78), !state (80-89): UNCHANGED, still after loading, error supersedes.

if (providerKey === 'sat') {
  // Attempt id is the mount gate (Option A). While live still pending we already
  // returned the SAT loader above, so reaching here with no attempt id means the
  // load settled with no attempt -> Back to Check-in (existing copy preserved).
  if (!scheduleId || !attemptSnapshot?.id) {
    return (
      <ErrorSurface
        title="SAT attempt unavailable"
        description="Digital SAT delivery requires a schedule-backed attempt."
        actionLabel="Back to Check-in"
        onAction={navigateToStudentCheckIn}
      />
    );
  }
  return (
    <SatStudentSessionRoute
      scheduleId={scheduleId}
      attemptId={attemptSnapshot.id}
      candidateId={attemptSnapshot.candidateId}
      attemptSnapshot={attemptSnapshot}
      runtimeSnapshot={runtimeSnapshot}
      liveSocketConnected={liveSocketConnected}
      attemptUpdateToken={satAttemptUpdateToken}
      leaseEpoch={attemptSnapshot.leaseEpoch}
      controlEpoch={attemptSnapshot.controlEpoch}
      bootstrapSeed={satBootstrapSeed} // NEW
      initialIsLoading={false}         // mounted post-load under Option A
      onExit={navigateToStudentCheckIn}
    />
  );
}
// IELTS StudentAppWrapper branch: UNCHANGED 119-134.
```

Note: isSatStaticReady is used inside the hook-derived seed validity and, if the team prefers
early-mount later, inside the mount condition — under Option A the route does not need to branch on it
separately because providerKey === 'sat' while isLoading already implies static resolving or live pending
and both render the same SAT skin. Keep the flag (hook still returns it) for the e2e/test hooks and Phase 04.

### 6.2 Controller bootstrap effect sketch (replaces controller :189-207)

```ts
// useSatExamController.ts — extend options (defaults preserve old call-sites incl. tests):
//   bootstrapSeed: SatBootstrapSeed | null = null, initialIsLoading = false (forwarded for Phase 04).

const bootstrapSeedRef = useRef(bootstrapSeed);
bootstrapSeedRef.current = bootstrapSeed;
// Singleflight per (identity, version): StrictMode double-invoke + parent re-render collapse here.
const bootstrapInflightRef = useRef(new Map<string, Promise<AssessmentDeliveryBootstrap>>());

useEffect(() => {
  const generationAtCall = identityGenerationRef.current;
  // Validate the seed belongs to THIS identity; a stale seed (identity rotated while the
  // parent re-rendered) must never scope the fetch.
  const seed = bootstrapSeedRef.current;
  const seedOk = seedMatchesIdentity(seed, { scheduleId, attemptId, candidateId });
  const ifNoneMatch = seedOk ? (seed?.deliveryEtag ?? null) : null;
  const requestKey = identityKey + '::' + (seedOk ? (seed?.staticVersionId ?? '') : '');

  let cancelled = false;
  const inFlight = bootstrapInflightRef.current.get(requestKey);
  const run = inFlight ?? satDeliveryGateway.bootstrap(scheduleId, attemptId, ifNoneMatch);
  if (!inFlight) bootstrapInflightRef.current.set(requestKey, run);

  void run.then(
    (payload) => {
      bootstrapInflightRef.current.delete(requestKey);
      if (cancelled || identityGenerationRef.current !== generationAtCall) return; // superseded: silent
      if (!applyPayload(payload)) return; // revision/identity loser: silent
      dispatch({ type: 'bootstrapLoaded', assessmentId: payload.versionId });
    },
    (loadError: unknown) => {
      bootstrapInflightRef.current.delete(requestKey);
      if (cancelled || identityGenerationRef.current !== generationAtCall) return;
      if (hasBackendStatusCode(loadError, 304)) return; // not-modified: not a failure
      setError(loadError instanceof Error ? loadError.message : 'Unable to load the SAT attempt.');
    },
  );
  return () => { cancelled = true; };
  // Deps: identityKey (covers schedule/attempt/candidate rotation) + seed staticVersionId
  // (republish rebootstrap) — NOT the whole seed object (it churns with runtimeSnapshot).
}, [applyPayload, identityKey, scheduleId, attemptId, candidateId,
    bootstrapSeed?.staticVersionId, bootstrapSeed?.deliveryEtag]);
```

Rules encoded above: one network call per (identityKey, staticVersionId); ETag passed only from a matching
seed; 304 silent; superseded-generation failures silent (the owning generation surfaces its own); initial
failure still setError so error && !data stays reachable; success path identical to today (apply +
bootstrapLoaded).

### 6.3 Seed builder sketch (pure helper in the new file; hook calls it)

```ts
export function buildSatBootstrapSeed(input: {
  scheduleId: string; attemptId: string; candidateId: string;
  attemptSnapshot: StudentAttempt | null; runtimeSnapshot: ExamSessionRuntime | null;
  liveSnapshotReceivedAt: number | null; staticVersionId: string | null;
  deliveryEtag: string | null; seedGeneration: number;
}): SatBootstrapSeed {
  return {
    scheduleId: input.scheduleId,
    attemptId: input.attemptId,
    candidateId: input.candidateId,
    attemptSnapshot: input.attemptSnapshot,
    runtimeSnapshot: input.runtimeSnapshot,
    liveSnapshotReceivedAt: input.liveSnapshotReceivedAt,
    staticVersionId: input.staticVersionId,
    attemptRevision: input.attemptSnapshot?.revision ?? null,
    runtimeRevision: input.runtimeSnapshot?.revision ?? null,
    deliveryEtag: input.deliveryEtag,
    seedGeneration: input.seedGeneration,
  };
}
```

### 6.4 Cache / ETag handling (what the implementer wires, what they MUST NOT rewire)

- First bootstrap for a session: deliveryEtag === null -> bootstrap(scheduleId, attemptId, null) -> full
  fetch (bytes unavoidable; the win is single-fire + SAT-only skin).
- Reconnect / remount with a cached entry: the getter returns the stored ETag
  (sat-bootstrap-etag:scheduleId:attemptId, cf. bootstrapEtag.ts:22-23) -> If-None-Match sent (existing API
  support, :189) -> 304 -> refresh() null-path, no error, no spinner restart.
- Corrupt/missing storage entry -> null -> full fetch (fail-open to correct exam, per bootstrapEtag.ts:4-5).
- Do NOT instantiate createBootstrapCache inside the controller or route; do NOT change
  assessmentDeliveryApi.bootstrap signature; do NOT share the poll pollEtagRef with the seed path (polling
  stays Phase 04 property).

## 7. Edge cases (each must be handled + covered by at least one test in section 8)

1. Auth loading (authStatus === 'loading', hook :682-684, mount gate :835-845): parent shows admin
   skeleton; no SAT skin, no child mount, no bootstrap fire. No assertion counts this window as a skin.
2. Invalid access code (no candidateId -> hook throws 'Invalid access code...' 689-691; route maps invalid
   wcode/access code -> Back to Check-in 55-56,70-74): unchanged; child never mounts; seed stays null.
3. Session expired / unauthorized (authentication is required / unauthorized -> Back to Check-in 57-59):
   unchanged; same never-mount guarantee.
4. Unsupported provider (providerKey === 'unknown' throws 194-198): parent error surface; no SAT skin,
   no bootstrap.
5. Version mismatch rebootstrap (live publishedVersionId != static, hook 231-241,712-723): parent
   re-resolves static, bumps seed staticVersionId + generation; child effect refires exactly once for the
   new version (requestKey includes version) via the same singleflight; stale in-flight bootstrap for the
   old version is discarded by the generation guard (applyPayload identity/revision checks).
6. Offline first paint (navigator.onLine === false or bootstrap rejects with network error): child renders
   SAT error surface with retry (existing error && !data branch + recovery poller underneath); parent does
   NOT overlay admin error/skeleton. Retry calls the deduped bootstrap again (new attempt allowed:
   explicit-retry exception in section 4 rule 2).
7. Attempt missing after settled load (!isLoading && sat && !attemptSnapshot?.id): SAT attempt unavailable +
   Back to Check-in (existing copy, route 92-101); no child mount, no bootstrap fire. Distinguish from
   live-pending (still isLoading -> SAT loader).
8. Attempt exists only in durability cache (hook 770-784 cached-attempt fallback): seed carries the cached
   attempt; child bootstraps normally (delivery attempt id is real).
9. StrictMode / parent re-render churn (runtimeSnapshot object identity churn, satAttemptUpdateToken bumps,
   token-only live updates): effect deps EXCLUDE the seed object identity and runtime objects (depend on
   staticVersionId/deliveryEtag scalars + identityKey only) + singleflight map -> no refire. Test with
   double-effect + rerender.
10. Identity rotation (schedule/attempt/candidate change -> identityKey change, reset effect :94-106): old
    bootstrap resolves late -> discarded by generation capture; new generation fires once with the new seed.
    No cross-identity ETag reuse (requestKey + seedMatchesIdentity).
11. Preview untouched: no import of seed/bootstrap files in SatPreviewRoute / useSatPreviewController;
    preview tests green without modification.
12. IELTS identical: StudentAppWrapper branch + all non-sat hook behavior unchanged; IELTS route tests green
    without modification; no SAT imports execute on the IELTS path beyond the render-only SatLoadingSurface
    import (never rendered for IELTS — if bundle-splitting is a concern, note it but do not lazy-load here).

## 8. Tests (implementation must add/update these; Phase 02 lands with them green)

Scope: route tests, hook tests with fake timers + fetch mocks, e2e flicker assertion. No visual redesign
tests (Phase 01/05 own them).

1. Parent route tests — extend src/features/student/routes/__tests__/StudentSessionRoute.test.tsx (mock
   useStudentSessionRouteData as today, 20-22):
   - isLoading=true, providerKey='sat' -> SAT skin present (Loading Digital SAT... / .sat-ui) AND admin
     skeleton absent (absence of bg-gray-50 h-screen skeleton DOM / absence of Loading Exam... sr-only label).
     This is the flash-kill test.
   - isLoading=true, providerKey='ielts' -> admin skeleton present, SAT skin absent (IELTS unchanged guard).
   - !isLoading, sat, attemptSnapshot=null -> SAT attempt unavailable + Back to Check-in preserved.
   - SAT mounted case asserts SatStudentSessionRoute receives bootstrapSeed with the attempt id + epochs
     (mock the child module and inspect props).
2. Hook tests — extend src/features/student/hooks/__tests__/ (useStudentSessionRouteData.backend.test.tsx
   pattern, fetch mocks + fake timers):
   - SAT load emits satBootstrapSeed non-null with { scheduleId, attemptId, staticVersionId, attemptRevision,
     runtimeRevision } matching the mocked static/live payloads; isSatStaticReady flips true at static resolve
     even while live pending (assert via staged resolve: resolve static fetch, hold live fetch, check
     intermediate render).
   - retry() re-emits a fresh seed generation; errors keep seed null-safe (no throw on missing attempt).
3. Controller tests — extend src/features/student-delivery/hooks/__tests__/useSatExamController.identity.test.tsx
   (existing gateway-mock pattern, 9-47 + deferred helper 49-55):
   - Bootstrap fires exactly once across mount + StrictMode double-effect + three parent re-renders with
     churning runtimeSnapshot objects at equal revision (assert gatewayMocks.bootstrap toHaveBeenCalledTimes(1)).
   - Matching seed ETag is forwarded as ifNoneMatch (assert 3rd arg); mismatched-identity seed -> ETag null
     (no cross-identity reuse).
   - Version-bump (bootstrapSeed.staticVersionId change) refires exactly once more; late resolution of the old
     request does not clobber (generation guard).
   - Initial failure sets error with data === null (error surface reachable); 304 rejection sets neither error
     nor data-loss.
4. Seed unit tests — new src/features/student-delivery/bootstrap/__tests__/satBootstrapSeed.test.ts:
   seedMatchesIdentity true/false matrix + buildSatBootstrapSeed revision extraction (null-safe).
5. E2E flicker assertion (extend e2e/sat-student-accessibility.spec.ts harness or add
   e2e/sat-bootstrap-waterfall.spec.ts; SAT student path with mocked session endpoints):
   - Cold open with provider-known-sat: from first SAT-skin paint until exam interactive, assert (a) zero nodes
     matching the admin skeleton (selector for AppLoadingSkeleton root), (b) at most one visible [role=status]
     loader at any sample, (c) bootstrap network call count === 1 (route interception). Keep it deterministic:
     intercept + hold the bootstrap response, sample mid-flight, then release (no timing-flake).
   - Error case: force bootstrap 500 -> exactly one SAT error surface, Exit reachable, no admin error overlay.

## 9. Verification (commands the implementer runs; all must pass)

```bash
# Types + lint on touched areas (must be clean)
npx tsc --noEmit
npx eslint src/features/student/routes/StudentSessionRoute.tsx \
  src/features/student/hooks/useStudentSessionRouteData.ts \
  src/features/student-delivery/routes/SatStudentSessionRoute.tsx \
  src/features/student-delivery/hooks/useSatExamController.ts \
  src/features/student-delivery/bootstrap/satBootstrapSeed.ts

# Unit suites for the touched seams
npx vitest run src/features/student/routes/__tests__/StudentSessionRoute.test.tsx
npx vitest run src/features/student/hooks/__tests__/useStudentSessionRouteData.backend.test.tsx
npx vitest run src/features/student-delivery/hooks/__tests__/useSatExamController.identity.test.tsx
npx vitest run src/features/student-delivery/bootstrap/__tests__/satBootstrapSeed.test.ts
npx vitest run src/features/student-delivery/__tests__/bootstrapEtag.test.ts

# Guard rails: preview + IELTS-adjacent suites unmodified-and-green
npx vitest run src/features/student-delivery/routes/__tests__/SatPreviewRoute.test.tsx
npx vitest run src/features/student-delivery/hooks/__tests__/useSatPreviewController.test.tsx
npx vitest run src/components/student/__tests__/StudentApp.test.tsx

# Seam audit (must hold before merge)
git diff --stat
git grep -n "satDeliveryGateway.bootstrap" -- src
git grep -n "assessmentDeliveryApi.bootstrap" -- src
git grep -n "withCalculatorHost" -- src/features/student-delivery/routes/SatStudentSessionRoute.tsx
# withCalculatorHost grep diff vs main must be EMPTY (Phase 03 seam intact)

# E2E flicker (CI config as repo defines)
npx playwright test --config playwright.sat-a11y.config.ts e2e/sat-student-accessibility.spec.ts
# and/or the new e2e/sat-bootstrap-waterfall.spec.ts if added
```

Package scripts reference: typecheck: tsc --noEmit, lint: eslint ., test:run: vitest run,
e2e:sat-a11y: playwright test --config playwright.sat-a11y.config.ts (all from root package.json:6-24).

## 10. Definition of done (Phase 02 complete iff ALL hold)

1. One SAT skin: from provider-known-sat through bootstrap settle, a SAT cold open renders exactly one loader
   skin (SAT SatLoadingSurface, Phase 01 kind=initial); no AppLoadingSkeleton DOM appears in that window (route
   test + e2e flicker test green).
2. No admin flash for sat: with providerKey === 'sat' the parent never returns <LoadingSurface> (grep the SAT
   branch: only SatLoadingSurface / SatErrorSurface / child mount; auth-loading window excepted and documented).
3. Single bootstrap fire: child bootstrap() fires at most once per identity generation (singleflight +
   generation capture proven by the controller tests); ETag from a matching seed is forwarded, 304 is silent
   success; stale-generation resolutions never clobber or error.
4. Errors still reachable: parent errors (invalid code / expired / unknown provider / missing state /
   attempt-missing -> Back to Check-in or Retry) and child bootstrap errors (SAT error surface + retry, offline
   included) each render exactly once with no overlay from the other layer.
5. Seam with Phase 03 respected: the SatStudentSessionRoute diff is props/forward ONLY (two optional props + two
   forward lines + type import); the host/prewarm grep diff vs main is empty; no preview, IELTS,
   backend-contract, or visual-token changes.
6. Verification green: section 9 commands pass (tsc, eslint on touched files, all listed vitest suites incl.
   unmodified preview/IELTS guards, e2e flicker); git diff --stat contains only the files section 5 Step 6 allows.

## 11. Risks / explicit non-goals (so reviewers do not re-litigate)

- True first-ever cold-open static window still shows the admin skeleton for ~1 RTT because the hook defaults
  providerKey to 'ielts' until static resolves and Phase 02 adds no provider-hint cache (Option A + no hint).
  Accepted residual; the guarantee starts at provider-known-sat. A hint cache is a documented follow-up, NOT
  Phase 02 scope.
- Fetch parallelism (static->live->bootstrap serial chain) is NOT shortened by Phase 02 — the seed dedupes
  re-fires, it does not fuse endpoint families. Wall-clock improvement comes from Phases 04-05; Phase 02 win is
  single-skin + single-fire correctness.
- No polling-cadence, freshness-gate, reducer, submitting-copy, or Desmos changes in this phase — any diff
  outside section 5 Step 6 is a seam violation even if obviously correct.

## 12. Affected / new files (normative allow-list)

- NEW: src/features/student-delivery/bootstrap/satBootstrapSeed.ts (+ its __tests__/satBootstrapSeed.test.ts)
- EDIT: src/features/student/hooks/useStudentSessionRouteData.ts (additive: liveReceivedAtRef + satBootstrapSeed
  + isSatStaticReady derivation; nothing else)
- EDIT: src/features/student/routes/StudentSessionRoute.tsx (SAT-branch gating + seed pass-through; IELTS branch
  119-134 untouched)
- EDIT: src/features/student-delivery/routes/SatStudentSessionRoute.tsx (props interface + forward only; Phase 03
  seam — no branch/host/prewarm edits)
- EDIT: src/features/student-delivery/hooks/useSatExamController.ts (options + bootstrap effect 189-207 only)
- TESTS: route/hook/controller/seed tests + e2e flicker spec listed in section 8
- READ-ONLY (must appear unchanged in git diff): assessmentDeliveryApi.ts, satDeliveryGateway.ts,
  bootstrapEtag.ts, SatStateSurfaces.tsx (Phase 01 owns), SatCalculatorPanel / SatFloatingTool / DesmosCalculator,
  satRunnerReducer.ts, SatPreviewRoute.tsx, useSatPreviewController.ts, StudentAppWrapper.tsx,
  studentSessionStateMachine.ts + adapters, backend gateway.