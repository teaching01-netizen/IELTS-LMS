# Phase 03 -- Client durability, rendering & exam UX

Wave: B (parallel with Phase 02 and Phase 04, after Phase 01).
Sources: docs/optimize.md WP03 + WP08 + WP09; optimization-plan/overall-plan.md sections 4-7.
Owners: client durability owner (sole authority: shared engine + storage format) + client performance owner (WP08) + client experience owner (WP09).
Provider-adapter implementers are assigned by L0 only after C01/C02/C08 freeze.
Status: planning only. No application code, migration, deployment, or production data is changed by this file. Every implementation checkbox starts unchecked.

---

## 1. Objective

Make the browser a trustworthy first custodian of student intent without ever lying about durability, and keep the exam UI responsive, legible, and operable under fault and load:

1. Durability first: every keystroke or selection becomes visible input instantly, is checkpointed synchronously in a bounded record, journaled asynchronously, sent as an immutable issued write, and only reported as saved on exact server acknowledgement of that write identity. No silent overwrite of newer intent by older snapshots (I01), no false saved (I02), no silent loss of unacknowledged work inside the documented browser-storage fault model (I03), no write across a stale lease and no silent erasure on control change (I06).
2. Ordering and conflict honesty: coalesce only unissued superseded intent; never mutate an issued payload; archive conflicts before destructive removal; reconcile control-epoch stalls only on fresh writable state; surface blocked and quarantined work at submit time with confirmed discard.
3. Rendering and experience: typing, navigation, timers, rosters, and grading stay within C09 budgets on representative devices; question-local subscriptions and timer isolation prevent whole-workspace rerenders; IME, focus, selection, undo, and keyboard survive state changes; every critical action has a complete operational state (loading, empty, offline, denied, conflict, degraded, submitting, recoverable); a11y is release-blocking on exam paths; heavy work (exports, rosters, media, calculator) is bounded, cancelable, and isolated from answer state.

User-visible outcome: a student can type before bootstrap resolves, lose network, storage, or lease, reload offline, race a takeover or pause, and hit submit with unresolved work -- and at every point sees truthful status, keeps recoverable intent, and can complete or safely discard with an audit trail. Staff can supervise, author, and grade large cohorts without frozen UI or lost edits.

Acceptance spine: AC01, AC02, AC03, AC04, AC07, AC08, AC17, AC19, AC20. I12 applies throughout: performance work must not weaken I01, I02, I03, or I06.

---

## 2. Scope and out of scope

### 2.1 In scope -- WP03 browser durability, ordering, conflict recovery

- Single durability-engine ownership: issued write identity, ack matching, pending intent, replay, conflict handling.
- Readiness barrier: preserve pre-bootstrap input; overlay newer local intent after authoritative hydration.
- Bounded synchronous checkpoints: measure the sync path before choosing representation; never rewrite a whole attempt per keystroke.
- Explicit milestones: visible input, local checkpoint, async journal, in-flight request, exact server acknowledgement (see section 6.3).
- Coalesce-only-unissued rule plus immutable issued payloads (exact-replay versus new-write discipline per C02).
- Conflict archive lifecycle: archive-before-delete, quarantine ledger rehydration, tombstones, prune on explicit resolution, archive-failure semantics.
- Control-epoch reconcile only on fresh writable state; never auto-replay across stale lease or terminal state.
- Quota, denial, corrupt-record, upgrade, account-switch, and lifecycle handling; no blanket localStorage clearing.
- Submission blocked-work exposure plus confirmed discard with approved audit behavior.

### 2.2 In scope -- WP08 React ownership, measured rendering

- Profile typing, question navigation, timers, roster updates, and grading on representative devices and fixtures.
- Question-local subscriptions; timer isolation (shared precise/coarse clocks already exist -- verify and extend, do not duplicate).
- Derived-state dedup; removal of effect-driven mirrors that race or over-render.
- Identity and context stabilization only where traces prove waste.
- Responsibility-based controller extraction (no line-count quotas) with characterization tests first.
- Synchronous typing path plus background deferral discipline.
- Selective memo and virtualization that never unmounts active editors or destroys undo and selection.

### 2.3 In scope -- WP09 operational UI, a11y, heavy workloads

- Full operational states for critical actions: loading, empty, offline, denied, conflict, degraded, submitting, recoverable-error.
- IME, focus, selection, undo, and keyboard preservation through state changes.
- Timer-versus-overlay, break, pause, expiry, and module-transition semantics (server-clock authority respected; display only).
- A11y audit: labels, focus order, dialogs, live announcements, contrast, reduced motion, touch targets, screen-reader flows.
- Lazy-load and prefetch bounds for heavy editors, calculator, and export code.
- Export and roster virtualization plus server paging with progress, cancel, and recoverable errors.
- Media, calculator, and rich-content failure isolation from answer state.

### 2.4 Out of scope -- respect these contracts, do not implement here

- Server terminalization and scoring (Phase 02): provisional versus terminal, submission-ID ownership, outcome compatibility, response digest, SAT provisional-to-final seal, response-source resolver. Phase 03 consumes C01 and C03 semantics; it never invents terminal facts.
- API envelopes and status codes (Phase 04): wire codes, SUBMISSION_ID_MISUSE wire name versus Go identifier, acknowledgements wire field versus internal acks shorthand, CSRF, origin, and rate-limit envelopes, conditional-read (ETag and 304) semantics, bootstrap POST and 304 review. Phase 03 consumes C07 and C05; it never renames wire fields.
- Server budgets, indexes, and pools (Phases 05 and 06): hot-query tuning, pool sizing, k6 SLO calibration, telemetry pipeline ownership. Phase 03 produces client-side measurements and privacy-safe counters that Phase 06 aggregates; it does not set server SLOs.
- Also out of scope: timing, scoring, grading-permission, and admission business-rule changes; rewrites or blanket upgrades; new queue infrastructure (no Redis); microservices and sharding; compat-path removal (WP16-gated); any production load test, deployment, data repair, or credential access.

---

## 3. Dependencies

- Phase 01 contract freeze (HARD GATE): frozen C01 (response ownership and scoring authority per provider), C02 (durable write and replay), C07 (error and retry vocabulary), C08 (client storage) with exact version numbers; AC01-AC04, AC07, AC08, AC17, AC19, AC20 fixtures plus owning-phase map; confirmed current state of SAT V2 versus legacy divergence, bootstrap HTTP semantics, and supported devices and networks (C09 browser matrix). No provider-adapter implementation starts before C01, C02, C08 are frozen. Engine-hardening work that does not change shared semantics may prepare against the draft, but any semantic change waits for the freeze.
- Phase 01 invariants (hard reference): I01, I02, I03, I06 normative text plus discriminating-test design (same-ID same-payload, same-ID different-payload, different-ID same-version, stale lease, stale control, terminal replay; missing versus blank versus not-administered versus pretest versus pending versus incorrect). Do not reinterpret invariants locally.
- Phase 02, parallel: C01 routing, key-revision, and pretest semantics per provider; C02 server ack, revision, and canonical-payload behavior; C03 terminal vocabulary the client surfaces (provisional receipt versus terminal). Coordinate via frozen contracts only -- no direct edits to the terminalization resolver or scoring services.
- Phase 04, parallel: C07 exact wire codes and envelopes; C04 revocation and token-binding semantics the takeover path surfaces; C05 server-clock authority, poll hints, and pause and extension semantics the timer display consumes. Single-retry-owner rule: the engine owns response-write retries; React Query and API client layers must not add a second retry layer on the same operation.
- Phases 05 and 06, downstream plus early lanes: WP10 baseline measurement harness (budgets in section 12); WP13 deterministic fixtures (fake clocks, network interception, controlled storage faults). Phase 03 contributes client traces plus privacy-safe durability counters; Phase 05 tunes server queries after query-shape freeze; Phase 06 hardens gates as Phase 03 lands.
- Phase 07, consumer: Phase 03 delivers an integrated, checked client candidate plus evidence-ledger entries for AC01-AC04, AC07, AC08, AC17, AC19, AC20; Phase 07 runs all 20 AC against the frozen integrated candidate.
- Ownership sequencing (overall-plan section 7): the client durability owner is sole authority for the shared engine plus storage format while Phase 03 is active. Provider adapters (IELTS mutation-outbox path, SAT persistence path) get assigned provider owners by L0 after the freeze; until assignment, adapter files are read-only for everyone except the durability owner. Same-file needs with Phase 02 and 04 (transport, gateway) are sequenced or explicitly transferred -- worktrees isolate edits, not contracts.

---

## 4. Affected files -- rediscovered, confirm at implementation start

Paths were re-enumerated from the working tree during planning. Treat as navigation starting points; confirm each file's current contents before editing (historical line numbers and test artifacts may be stale per overall-plan section 5).

### 4.1 Durability core -- SOLE AUTHORITY: client durability owner

- src/shared/durability/DurableResponseEngine.ts (about 2300 lines): the engine. Owns write identity (writeId, clientVersion, order accept-sequence), outbox versus in-flight versus issued maps, sync checkpoint (localStorage, synchronous), async journal (IndexedDB via durableDraftStore), ack matching, coalescing, quarantine and tombstone lifecycle, epoch fences, submit guard, lifecycle listeners. No second engine, no forked status literals.
- src/shared/durability/types.ts: domain plus contract types -- ResponsePayload, PendingResponseState, QuestionResponseState, ResponseCommandV2, ResponseBatchRequestV2 and Response, ResponseSnapshotV2, SubmitAttemptV2Request and Response, DurabilitySyncStatus, QuarantinedWrite. Changes here are contract changes and need L0 and contract-owner approval (C02 and C08 surface).
- src/shared/durability/useResponseDurabilityStatus.ts: single owner of display vocabulary plus mapEngineStatus plus blockedSubmitGateMessage plus ReconcileBlockedResult. Both IELTS and SAT providers import from here; do not fork.
- src/shared/durability/__tests__/useResponseDurabilityStatus.test.ts: mapper-contract tests (full status by blocked-count matrix). Extend, do not duplicate.
- src/shared/durability/__tests__/DurableResponseEngine.test.ts, DurableResponseEngine.debounce.test.ts, DurableResponseEngine.preservation.test.ts, durabilityTelemetry.test.ts: existing behavioral coverage (fences, archive-before-delete, durability_fault, blocked_attention). Add failing tests first for each confirmed defect; keep green tests green.

### 4.2 Transports and adapters -- durability owner until provider-owner assignment

- src/features/student/infrastructure/responseDurabilityTransport.ts: real V2 HTTP adapter (sendBatch, submit, fetchSnapshot, credential-refresh wrapper, takeOverResponseDurabilityLease). Deliberately UI-stateless. Retry ownership lives in engine drain only (retries: 0 at bridge layer).
- src/features/student/api/responseDurabilityTransport.ts: re-export shim. Keep as shim; do not fork logic into it.
- src/utils/durableDraftStore.ts: IndexedDB warwick_durable_drafts_v1 plus localStorage fallback warwick_durable_draft_v1 prefix, per-key write chains, newer-record-wins reconciliation. Async tier of the milestone chain.
- src/services/studentMutationOutbox.ts: IELTS-side outbox -- coalesce keys, PendingMutationDurabilityMirror, answer sync checkpoint ielts_student_answer_checkpoint_v1 colon attemptId, debounce disciplines. Coalescing rules here must obey the engine coalesce-only-unissued invariant once unified.
- src/features/student/infrastructure/exam-session/studentAttemptDurabilityAdapter.ts: StudentDurabilityPort over studentAttemptRepository (pending-mutation persistence seam).
- src/features/student/infrastructure/exam-session/studentMutationOutboxAdapter.ts: StudentMutationOutbox seam (enqueue, flush, pendingCount).
- src/features/student-delivery/infrastructure/satResponseOutboxStore.ts: legacy SAT outbox, checkpoint, and tombstone store (sat-response-outbox:v1, sat-response-checkpoint:v1, schema v1 to v2, MAX_TOMBSTONES 200). Migration or retirement of this path is WP16-gated; Phase 03 must preserve compat and prove equivalence before any consolidation.
- src/features/student/contracts/exam-session/StudentDurabilityPort.ts, StudentMutationOutbox.ts, StudentAttemptStore.ts, DraftCommitPort.ts: port seams the adapters implement. Interface changes are contract-adjacent -- freeze with L0.

### 4.3 Session route data, persistence hooks, controllers, stores -- shared ownership, sequence edits

- src/features/student/hooks/useStudentSessionRouteData.ts (about 960 lines): bootstrap plus live-snapshot application, freshness and revision guards (highestSeenAttemptRevisionRef, appliedFreshnessRef), realtime coordinator plus poll loop wiring, candidate storage, diagnostics. Readiness-barrier primary site for the IELTS path.
- src/features/student/hooks/studentSessionRouteUtils.ts, studentSessionStateMachine.ts, studentSessionMachineAdapters.ts, studentCandidateStorage.ts, studentSessionDiagnostics.ts: route-data helpers, load and live transition evaluators, candidate profile storage, diagram-snapshot diagnostics.
- src/features/student-delivery/hooks/useSatResponsePersistence.ts (about 610 lines): SAT persistence provider -- engine lifecycle, publishV2EngineState (pending, visible, blocked drafts), hydrateRevisions and hydrateBootstrap, save, flush, submit, retry, takeover. Readiness-barrier primary site for the SAT path.
- src/features/student-delivery/hooks/useSatExamController.ts (about 1050 lines): SAT exam controller -- bootstrap application plus stale-bootstrap guard, runner reducer, persistence wiring, tool policy, calculator and reading-preference cleanup, auto-start and finalization. First candidate for responsibility-based extraction (WP08) -- behavior preserved via characterization tests.
- src/features/student-delivery/hooks/useSatInteractionController.ts, useSatIntegrityControl.ts, useSatPreviewController.ts, useSatShortcuts.ts, useSatReadingPreferences.ts, src/features/student-delivery/ui/useSatMediaQuery.ts: interaction, integrity, preview, shortcut, preference, and media slices. Timer, shortcut, and media failure isolation lives partly here.
- src/features/student/application/exam-session/StudentAttemptController.ts: enqueue and flushPending over store plus durability port plus outbox. Retry-ownership touchpoint (must not double-retry under the engine).
- src/features/student/application/exam-session/studentExamStore.ts plus studentExamStoreFactory.ts: exam session store (state plus actions plus persistence flags pendingMutationCount and syncState). Selector and identity stability work happens here.
- src/features/student/application/exam-session/createStudentExamSession.ts, answerCommands.ts, submissionCommands.ts, navigationCommands.ts, reconcileServerSnapshot.ts, studentSessionBootstrap.ts, studentSubmissionCoordinator.ts, studentPlatformEventPolicy.ts, examSessionSelectors.ts: command, selection, reconciliation, and coordination layer. Snapshot-reconcile ordering (I01) and submit coordination (AC08) live here.
- src/features/student/application/studentAttemptFacade.ts, studentExamContentFacade.ts, studentIntegrityFacade.ts, studentSessionFacade.ts: facades over the above; keep thin, do not add universal abstractions.
- src/features/student/hooks/exam-session/StudentExamSessionProvider.tsx plus useAttemptSyncStatus.ts, useCurrentModule.ts, useCurrentQuestion.ts, useExamBlocking.ts, useExamCommands.ts, useExamPhase.ts, useExamTimer.ts, useQuestionAnswer.ts, useQuestionFlag.ts: question-local subscription surface (WP08 core). useExamTimer.ts is a one-line selector over selectDisplayTimeRemaining -- the isolation pattern to replicate.
- src/shared/hooks/useAuthoritativeDeadlineClock.ts: shared precise (1 s) plus coarse (15 s) clocks over useSyncExternalStore; server-authoritative remaining-seconds math. Do not create a second clock. Isolate consumers by band (coarse true for far-from-deadline roster rows).
- src/app/hooks/useAsyncPolling.ts to src/shared/hooks/useAsyncPolling.ts; src/app/hooks/useLiveUpdates.ts to src/shared/hooks/useLiveUpdates.ts; src/features/student/infrastructure/exam-session/studentRuntimePoll.ts, studentRuntimePollLoop.ts, studentRealtimeCoordinator.ts: poll and websocket runtime channels. Retry and backoff ownership per C07; worker-originated change visibility bound per C05 (Phase 04 owns semantics, Phase 03 owns non-destructive UI application).
- src/app/data/examQueries.ts, gradingQueries.ts, proctorQueries.ts; src/features/scheduling/api/scheduleQueries.ts; src/features/exam-authoring/api/assessmentQueries.ts; src/features/answer-history/api/answerHistoryQueries.ts: React Query surfaces. Audit for duplicate retries over engine-owned writes; stabilize query keys and selectors; never let cache silently overwrite newer intent.

### 4.4 Heavy UI surfaces -- WP08 and WP09, experience plus performance owners

- src/components/proctor/ProctorDashboard.tsx (about 1365 lines, React.memo) plus src/components/proctor/StudentCard.tsx, StudentDetailPanel.tsx, AlertPanel.tsx (Virtuoso), ExamGroupCard.tsx, ViolationRulePanel.tsx, src/components/proctor/hooks/useStudentFilters.ts: roster scale surface -- filter, sort, paging, per-row clock bands, alert virtualization, cohort controls (start, pause, resume, extend, end, complete). Timer isolation plus virtualization plus paging core site.
- src/components/admin/StudentReviewWorkspace.tsx (about 1919 lines) plus GradingSessionDetail and List, AdminGrading, gradingExportBuilder folder, gradingPerStudentExport folder, GradingExportButtons.tsx, PerStudentZipPdfExportDialog.tsx, QuestionTracebackPanel.tsx, WritingAnnotationCanvas.tsx: grading, review, and export surface -- large-submission navigation, annotation canvases, per-student ZIP and PDF export (bounded, cancelable). Export virtualization plus worker and offload decision lives here.
- src/features/exam-authoring/ui/AuthoringWorkspace.tsx (about 1469 lines) plus spine folder (SpineLayout, SpineHeader, SpineQuestionView, QuestionQueueRail, ExamOverviewPane, SaveCluster), src/features/exam-authoring/hooks/useQuestionAutosave.ts, src/features/builder/hooks/useBuilderAutosave.ts: authoring surface -- queue rail, overview pane, autosave (durability-tested), import sheets, undo banners. Autosave coalescing plus focus preservation plus lazy-editor loading.
- src/components/student/StudentQuestionPanel.tsx (Virtuoso block list), src/components/ui/VirtualizedList.tsx, src/components/admin/AdminExams.tsx (Virtuoso): existing virtualization sites. Reuse; audit for active-editor unmounting.
- src/components/student shells and tools (highlight V2, zoom and scroll anchoring, drag-to-pan, split-pane resize, viewport lock, translation guard, auto-submit boundary, submission orchestration, warning visibility), src/products/sat/routes/SatSessionRoomRoute.tsx: timer-versus-overlay, break, pause, expiry, IME, focus, calculator, media, and autosubmit boundary semantics.
- Route loading and error surfaces, ConfirmModal, Toast, LoadingMark, authoring state surfaces (SatAuthoringLoadingSurface, SatAuthoringErrorSurface): operational-state components to standardize (see section 10 step 10.1).

### 4.5 Explicitly not owned here -- read-only or coordinated

Backend Go services, worker orchestration, migration lineage, telemetry pipeline, k6 profiles, CI workflows -- read for contract understanding; edits belong to Phases 02, 04, 05, 06. If a client change requires a wire or contract change, file it with the contract owner (L0) instead of inventing semantics.


## 5. New files (additive only; no rewrites, no blanket moves)

All new files live beside their owners. Prefer extending existing tests where they already own the behavior; create new files only for the listed gaps.

- src/shared/durability/__tests__/readinessBarrier.test.ts -- AC01: pre-bootstrap typing preserved; older snapshot cannot clobber newer intent; ordering (accept-sequence) survives hydration. Owner: durability.
- src/shared/durability/__tests__/storageFaults.test.ts -- AC02/AC04: quota, denial, corrupt-record, delayed-async matrix; never false-saved; in-memory intent preserved; recovery limits visible. Owner: durability.
- src/shared/durability/__tests__/epochFences.test.ts -- AC07: stale lease cannot write; control-bump blocks (not deletes); takeover versus pause distinct recoveries; no auto-replay across stale lease or terminal. Owner: durability.
- src/shared/durability/__tests__/submitGate.test.ts -- AC08: blocked and quarantined submit gate, stable idempotency identity across lost-receipt retry, no false complete screen, confirmed-discard audit. Owner: durability.
- src/shared/durability/__tests__/syncCheckpointBudget.test.ts -- sync-path measurement: per-keystroke checkpoint cost (small-record bound), whole-attempt-rewrite detector (fails if the acceptResponse path serializes the full attempt). Owner: durability + performance.
- src/shared/durability/storageNamespaces.ts (tiny, additive) -- single source of truth for C08 key namespaces, prefixes, and versions (re-exported constants; engine plus stores import it; no behavior change on introduction -- constants moved verbatim). Owner: durability.
- src/shared/durability/__tests__/storageNamespaces.contract.test.ts -- namespace, version, and compat contract: exact prefixes, per-attempt isolation, old-bundle forward-read rule, no blanket-clear rule. Owner: durability.
- e2e/student-input-durability.spec.ts (extend if present) -- AC01-AC04 browser flows including reload-offline plus delayed-IndexedDB. Owner: experience (engine asserts owned by durability).
- e2e/student-takeover-lease.spec.ts (new, or extend student-multi-device.spec.ts) -- AC07 old-device-after-takeover plus stale-control-after-pause races, both winners where valid. Owner: experience.
- e2e/student-submit-blocked.spec.ts (new, or extend student-submit-flow.spec.ts) -- AC08 submit-with-blocked plus lost-receipt retry. Owner: experience.
- e2e/sat-student-accessibility.spec.ts (extend; config playwright.sat-a11y.config.ts) -- AC17 keyboard, IME, focus, screen-reader, and timer-overlay flows. Owner: experience.
- src/components/proctor/__tests__/ProctorDashboard.virtualization.test.tsx -- roster paging plus virtualization: bounded mounts, coarse-clock rows, accessible navigation preserved. Owner: performance.
- src/components/admin/__tests__/gradingExport.bounded.test.ts -- export memory and main-thread bound, progress, cancel, failure isolation. Owner: experience.
- src/features/student-delivery/hooks/__tests__/satTimerSemantics.test.tsx -- timer versus overlay, break, pause, expiry, and module-transition truth table. Owner: experience.
- docs: no new docs files in this phase except evidence-ledger entries (overall-plan section 11). Update component and test comments in place.

Naming rule: if a proposed test file already exists under a nearby name (student-input-durability.spec.ts, student-multi-device.spec.ts, student-recovery.spec.ts), extend it instead of creating a near-duplicate.

---

## 6. Interfaces and contracts (frozen versions consumed, not invented)

### 6.1 Contract versions consumed (Phase 01 output -- copy exact versions here at implementation start)

- C01 Response ownership and scoring authority per provider (adaptive routing, key revision, pretest and unadministered and null semantics, legacy fallback). Phase 03 consumption: determines which answers the client may send and how review and export interpret them; provider adapters branch on it. Client never dual-writes to resolve ambiguity. Frozen version: C01 v___ (Phase 01).
- C02 Durable write and replay (attempt, lease, and control epochs, write ID, client version, canonical payload, ack and revision, retry-versus-new-write, exact-replay identity). Phase 03 consumption: normative for section 7 steps 3-6 and section 8 ack-matcher and journal-coalescer. Transport retry (same writeId, same payload) versus reconciled new write (new writeId, newer control epoch) is the central distinction. Frozen version: C02 v___.
- C07 Error and retry vocabulary (exact wire codes and envelopes including SUBMISSION_ID_MISUSE, acknowledgements field name; single retry owner per operation; budgets, jitter, cancellation). Phase 03 consumption: engine owns response-write retries; React Query and API client retries on the same operation must be disabled (retries: 0 at bridge, as the current transport already does). Submit-gate copy and failure-kind mapping (offline, retryable, terminal, superseded) derive from C07. Frozen version: C07 v___.
- C08 Client storage (versioned namespaces, per-attempt isolation, milestones, quota and denial, compaction, account switching, terminal cleanup, old-bundle compat). Phase 03 consumption: normative for section 6.2 namespace schema and section 7 steps 2, 8, 9. No blanket clearing; namespaced upgrades only. Frozen version: C08 v___.

If any C01, C02, C07, C08 text is ambiguous at implementation start, stop and return the question to L0 and the contract owner. A contract change invalidates only its producer and consumer steps -- do not work around it locally.

### 6.2 Storage namespace schema (C08 implementation -- current tree plus freeze rule)

The engine is the sole authority for the first three rows. The remaining rows are owned by their feature stores but must follow the same C08 rules (versioned, per-attempt isolated, never blanket-cleared). Introducing storageNamespaces.ts (section 5) moves these literals verbatim -- it does not rename them (rename equals contract change).

- Sync checkpoint (per-question, synchronous): key response-checkpoint:v2 colon enc(attemptId) colon enc(questionId), value JSON PendingResponseState (payload plus writeId plus leaseEpoch plus controlEpoch plus clientVersion plus durability checkpoint plus receivedAt plus order plus optional blocked including engine-local originLeaseEpoch). Written synchronously in acceptResponse (CAS-guarded); cleared only on exact ack of that writeId or explicit archive and discard; tombstone record replaces live record on quarantine (same key, tombstone marker -- never silent delete). Owner: engine.
- Async journal (IndexedDB, per-question): DB warwick_durable_drafts_v1, store drafts, key v2_attempt_<attemptId>_<questionId>; fallback localStorage key warwick_durable_draft_v1 colon v2_attempt_<attemptId>_<questionId> with newer-updatedAt-wins reconciliation. Async durability tier (durability indexeddb ranking in comparePendingResponses); fallback promotion and cleanup per store logic; delayed-async resolution must not fabricate ack status (AC04). Owner: engine via durableDraftStore.
- Quarantine archive (per-write): key v2_quarantine colon attemptId colon writeId, value archived payload plus reason plus quarantinedAt plus origin epochs. Archive-before-delete; rehydrated into quarantine ledger on recover(); pruned only on explicit discardBlocked (emits quarantine_pruned with reason discard) or ack-superseded replacement; bounded (tombstone cap precedent: 200). Archive failure yields durability_fault, never false recoverability. Owner: engine.
- IELTS answer sync checkpoint: key ielts_student_answer_checkpoint_v1 colon attemptId, value attemptId, savedAt, mutationVersion, mutations array (answer, writing_answer, and flag only). Whole-checkpoint write is acceptable only because it stores eligible mutations (not full attempt state); keep eligible-type filter; removal only when empty. Unification with engine journal is WP16-gated -- do not merge in this phase. Owner: IELTS outbox mirror.
- SAT legacy outbox and checkpoint: key sat-response-outbox:v1 colon enc(scheduleId) colon enc(attemptId) (schema v1 and v2 plus tombstones capped at 200); per-question key sat-response-checkpoint:v1 colon enc(scheduleId) colon enc(attemptId) colon enc(questionId). Compat-preserved; forward-read v1 to v2; retirement only with equivalence tests plus adoption evidence (WP16). Owner: SAT store (legacy).
- Candidate profile: per (scheduleId, candidateId) via studentCandidateStorage.ts. Account-switch isolation: switching candidate must not expose or replay the previous candidate's pending work (C08 account-switching rule). Owner: route data.
- Calculator workspace: calculatorWorkspaceKey(attempt) via satCalculatorWorkspace.ts. Attempt-scoped; clear on attempt close and switch; calculator failure must not touch answer keys. Owner: SAT controller.
- Reading preferences: satReadingPreferencesStore keys. Device-local UI prefs only; never gate durability on them. Owner: SAT prefs.
- Staff and authoring drafts: buildStaffDraftKey plus builder and autosave keys. Staff autosave coalescing follows the same quota and denial visibility rule; never share namespaces with student attempt keys. Owner: authoring and builder.

C08 freeze rules (normative): per-attempt isolation (no cross-attempt reads); versioned prefixes with forward-read shims for old records (legacy order 0 and missing receivedAt sort as oldest, never by wall-clock alone); quota and denial yield visible durability_fault, never silent; terminal cleanup only after acknowledged terminal fact plus retention window (Phase 05 retention boundary respected); account switch isolates, never replays across ownership; old and new bundle compat tested both directions; no blanket localStorage.clear() or prefix-wipe anywhere (a prefix-wipe helper found in review is a BLOCKING finding).

### 6.3 Milestone vocabulary (normative -- status mapping is exact)

- M1 Visible input: UI reflects intent synchronously (character, choice, flag). Not yet durable. Signal: in-memory state plus getVisibleResponse() (pending, else confirmed).
- M2 Local checkpoint: intent checkpointed synchronously in a small per-question record. Survives reload but not yet journaled or acked. Display: saved_locally at best -- never saved. Signal: response-checkpoint:v2 sync write (CAS-guarded).
- M3 Async journal: intent journaled to IndexedDB (or explicit fallback). Survives broader faults. Still not server-acked. Signal: durableDraftStore write; recovery ranking memory below checkpoint below indexeddb only as tiebreak within the same version chain (never across versions).
- M4 In-flight: one immutable command (ResponseCommandV2 frozen at issue) sent under current epochs. Display: saving. Signal: inFlight plus issuedCommands maps; payload deep-cloned at accept (clonePayload) and never mutated after.
- M5 Exact ack: server acknowledged that exact (writeId, clientVersion) with compatible outcome (applied or duplicate) and canonical revision. Only here may UI report saved or synced. Signal: installServerResponse; clears checkpoint and journal for that write; advances serverRevision plus contentHash.

Derived states (not milestones): blocked_attention (visible, never sent without decision), conflict (fenced and terminal -- conflict_fenced and conflict_terminal), error (durability_fault including archive and quota failure). Blocked wins over every raw status in mapEngineStatus -- even a synced engine with blocked drafts shows needs attention, never saved. A null engine shows saving, never saved.

### 6.4 Error vocabulary (C07 consumption -- exact wire codes preserved)

- Wire (do not rename): SUBMISSION_ID_MISUSE (wire) versus Go identifier (internal); acknowledgements (wire) versus acks (internal shorthand) -- reverify serialization at implementation start per optimize.md section 3.2; preserve exact status codes, envelopes, and field names for CSRF, origin, malformed-input, expired-bearer, and rate-limit paths. Blind retry storms are forbidden.
- Engine and client failure kinds (SatResponseFailureKind): offline (transport unreachable -- keep pending, scheduled drain), retryable (bounded drain retries, jitter, max 8 per drain), terminal (fenced or terminal -- stop auto-replay, surface conflict), superseded (coalesced before issue -- not an error, no retry).
- Blocked reasons (engine-local, telemetry-safe): EPOCH_STALE, control-bump stall, version collision, stale hydration, lease fence, terminal fence. Telemetry carries reason, epoch, and count only -- never answer or payload content (I11).
- Submit-gate copy (single owner): blockedSubmitGateMessage(blocked, quarantined) -- byte-identical IELTS and SAT strings; engine guard (Blocked drafts need attention before submit...) stays a provider-independent backstop and is never surfaced verbatim to students.

### 6.5 Key interface sketches (existing -- normative signatures, do not reshape without L0)

Engine (sole owner). Illustrative excerpt -- see source for full body:

  class DurableResponseEngine:
    constructor(o: DurableResponseEngineOptions) -- scheduleId, attemptId, leaseEpoch, controlEpoch, transport, drainDebounceMs?, onStatusChange?, onStateChange?, onDurabilityEvent?
    acceptResponse(questionId, payload): Promise<void> -- sync visible plus sync checkpoint, async journal, schedule drain
    recover(): Promise<void> -- load checkpoints plus journal plus tombstones plus quarantine ledger, seed versions
    flush(): Promise<void> -- immediate drain (lifecycle, visibility, submit paths)
    submit(req): Promise<SubmitAttemptV2Response> -- guarded: rejects on blocked and quarantined without confirmed discard
    updateEpochs(leaseEpoch, controlEpoch): void -- monotonic adopt; lease-change quarantines, control-only bump blocks in place
    discardBlocked(questionId): boolean -- explicit confirmed discard, emits quarantine_pruned with reason discard
    reconcileBlockedResponse(questionId): Promise<ReconcileBlockedResult> -- fresh-state-only reconcile
    getStatus(): DurabilitySyncStatus; getBlockedQuestionIds(): string[]; getQuarantined(): readonly QuarantinedWrite[]; destroy(): void

Transport (UI-stateless):

  interface TransportClient:
    sendBatch(attemptId, req: ResponseBatchRequestV2): Promise<ResponseBatchResponseV2>
    submit(attemptId, req: SubmitAttemptV2Request): Promise<SubmitAttemptV2Response>
    fetchSnapshot(attemptId): Promise<ResponseSnapshotV2 or ResponseAcknowledgementV2 array> -- 15 s timeout raced, hung fetch treated as offline


---

## 7. Step-by-step implementation (ordered by AC -- reproduce and measure first, then smallest complete repair)

Global discipline (overall-plan section 3): investigate before repairing. Each step: (a) reproduce or benchmark against the frozen contract, (b) add the failing behavioral test, (c) make the smallest complete repair across producer, consumer, persistence, error states, tests, and operations, (d) close already-satisfied items with evidence, not churn. One mutation owner per file at a time.

### Step 0 -- Freeze intake plus baseline (prerequisite, no semantics changed)

0.1. Copy frozen C01, C02, C07, C08 version numbers into section 6.1 and into each evidence-ledger entry. Record candidate identity (source revision plus dirty-tree hashes, schema version, config fingerprint, lockfiles) per overall-plan section 7 and BEFORE-RELEASE.
0.2. Run the current durability plus a11y suites to establish the green baseline (see section 14). Record which AC already pass with evidence; only open code tasks for confirmed gaps.
0.3. Confirm provider-adapter assignments with L0 (IELTS outbox path versus SAT persistence path). Until assigned, adapters are read-only except for the durability owner.
0.4. Confirm C09 device and network profiles for the browser matrix (representative lower-powered device, mobile browsers, background-throttle conditions) with Phase 06; do not invent budgets locally.

### Step 1 -- AC01: pre-bootstrap input plus snapshot ordering (I01) -- readiness barrier

Contracts: C02 (epochs, write-ID, version), C08 (namespaces), C05 (freshness hints; server-clock authority for timing only -- never for answer ordering).
Files: DurableResponseEngine.ts (acceptResponse, recover and recoverInternal, comparePendingResponses, recovery waiters), useStudentSessionRouteData.ts (IELTS hydration), useSatResponsePersistence.ts (hydrateBootstrap and hydrateRevisions), reconcileServerSnapshot.ts, studentSessionBootstrap.ts.

1.1. Reproduce: failing test types before bootstrap resolves (engine not yet recovery-initialized), then releases an older server snapshot; assert newer local intent plus accept-sequence ordering survive (no clobber). Cover both IELTS (route-data hydration) and SAT (hydrateBootstrap) paths.
1.2. Barrier rule (normative): acceptResponse before recovery-initialization still checkpoints synchronously (M2) and queues async journaling; version allocation waits for seeding. Hydration applies the authoritative snapshot to confirmed state only, then overlays newer local pending intent by (order, then receivedAt, then version-chain), never by wall-clock alone; legacy order==0 records fall through to the version chain. updateEpochs never rolls back on a delayed snapshot (monotonic max).
1.3. Stale-bootstrap guards: keep and verify the identityKey (schedule colon attempt colon candidate) generation checks and timing runtimeRevision regression-drop in the SAT controller; audit the equivalent attempt-identity plus highestSeenAttemptRevisionRef monotonic guard on the IELTS route-data path (no behavior change if already correct -- close with evidence).
1.4. Done when: AC01 engine plus browser tests pass on both providers; traces show zero whole-attempt rewrites on the hydration path.

### Step 2 -- AC02: quota and denial during editing (I03) -- visible fault, preserved intent

Contracts: C08 (quota and denial behavior), C07 (no false success codes).
Files: engine (checkpointIntentSync, persistAcceptedResponse, status transitions), durableDraftStore.ts, studentMutationOutbox.ts (mirror error path), status mapper, submit and orchestration banners.

2.1. Reproduce: deny and quota-fail both tiers (sync checkpoint throws plus async journal rejects, fallback also fails) during editing; assert status is durability_fault (display error), never saved_locally, synced, or saved; in-memory intent preserved and still visible; retry remains possible.
2.2. Repair rule: checkpoint and journal failures reject the acceptance chain (or hold it in explicit fault) -- they must not resolve as durable. setStorageDurabilityBlocking-style signals and the engine durability_fault must agree through the single mapper; providers surface recovery limits (kept in memory on this device; copy your answer; do not close the tab; ask proctor) without claiming local or server save.
2.3. Limits honesty: implement the WP03 limit text -- browser eviction, destruction, or denial can destroy unacked work; the UI reports available evidence and recovery bounds rather than promising impossible durability.
2.4. Done when: storage-fault matrix tests pass (quota, denial, corrupt record, fallback-unavailable); no path claims save without a durable tier succeeding.

### Step 3 -- AC03: lost-ack exact retry (I02) -- ack matcher plus immutable issued payloads

Contracts: C02 (ack, revision, exact-replay), C07 (single retry owner).
Files: engine (collectPendingCommands, drain, installServerResponse, issuedCommands and inFlight), transport (retries 0), IELTS and SAT flush paths, DB-integration consumer (Phase 02 owns server side; Phase 03 owns client exactness).

3.1. Reproduce: server commits batch but ack is lost (transport drops response once); retry must send the identical command (same writeId, same payload bytes, same epochs) and accept a compatible ack (applied or duplicate) with no duplicate mutation and no changed payload. Separately cover same-ID and different-payload (must not silently overwrite -- conflict path) and different-ID and same-version.
3.2. Repair rules: freeze (deep-clone) the payload at issue; coalescePendingMutations-style merging applies only to unissued outbox entries -- issuedCommands and inFlight entries are never merged, patched, or relabeled. Retry ownership is engine-drain only; verify React Query and API-client layers add no second retry on response-write operations.
3.3. Done when: lost-ack integration test (with real Phase-02 server semantics) shows one effective mutation plus compatible ack; payload-immutability unit test (mutate-after-issue attempt) passes.

### Step 4 -- AC04: reload-offline with checkpoint and journal plus delayed async storage

Contracts: C08 (milestones, compaction, per-attempt isolation), C02 (no fabricated ack).
Files: engine recover, loadRecoveredPending, rehydrateQuarantineLedger, surfaceTombstonedDraft; durableDraftStore (newer-updatedAt-wins, fallback promotion); SAT outbox store recovery; IELTS checkpoint read path.

4.1. Reproduce: checkpoint plus journal populated, reload with offline transport and slow or hung IndexedDB (delayed async tier); assert ordered pending work recovers from the sync tier promptly, async tier merges by (updatedAt and version chain, never wall-clock alone), and status is saved_locally or saving -- never a fabricated synced or saved. Include mobile-browser profile (slower storage, background-throttle risk).
4.2. Repair rules: recovery seeds versions before allocating new ones (recoveryInitialized plus waiters); snapshot fetch races a ~15 s timeout and a hung fetch resolves as offline (keep drafts, stay retryable). Tombstone and quarantine ledger rehydrate so post-reload state matches pre-reload (blocked stays blocked, quarantined stays quarantined).
4.3. Done when: engine plus mobile-browser reload tests pass; no test asserts ack status without an ack.

### Step 5 -- AC07: stale lease, takeover, stale control after pause (I06)

Contracts: C02 (lease and control epochs), C04 and C05 (takeover auth, pause and extension semantics -- consumed, not implemented).
Files: engine (updateEpochs, quarantineCommandsOutsideCurrentEpoch, blockPendingOnControlBump, lease-takeover call), useSatResponsePersistence.takeOverLease, IELTS provider takeover path, studentAttemptGateway credential rotation, banners and recovery copy.

5.1. Reproduce (both winners where valid): (a) old device writes after takeover (stale lease) -- must be fenced, never applied, pending preserved as blocked or quarantined with distinct recovery; (b) stale control epoch after proctor pause or extend -- unsent work stays visible in place as blocked (timing-only bump), never quarantined-away, never auto-replayed; (c) lease change -- strict fence, quarantine-outside-epoch, conflict persists across drains and epochs until explicit reconcile, discard, or fresh ack.
5.2. Repair rules: epochs adopted monotonically (delayed snapshot cannot roll back); lease-change versus control-only-bump paths stay distinct (see section 8.3 sketch); reconcile runs only after a fresh authoritative state permits writing; never auto-replay across stale lease or terminal state; takeover rotates clientSessionId and credential without forking a second writer identity.
5.3. Done when: race plus browser tests show no unauthorized writes, no silent deletions, and clearly distinct takeover versus pause recoveries.

### Step 6 -- AC08: submit with blocked and quarantined work plus lost receipt (I04 and I10 consumed)

Contracts: C02 and C03 (submission-ID ownership, outcome compatibility -- server side is Phase 02), C07 (SUBMISSION_ID_MISUSE preserved).
Files: engine submit, submitInternal, submissionPromise; studentSubmissionCoordinator.ts; submissionCommands.ts; useStudentSubmissionOrchestration.ts; useSatExamController finalization; gate copy in mapper module.

6.1. Reproduce: submit with blocked or quarantined drafts present yields no false complete screen; gate throws or returns the shared copy with counts; explicit discard requires confirmation and emits the approved audit event; lost receipt response means retry reuses the stable idempotency identity (same submissionId) and reconciles to one compatible outcome.
6.2. Repair rules: submit guard reads blocked plus quarantined counts on the submit path (not a cached render value); single in-flight submission promise per attempt (no double-submit); receipt loss never fabricates success -- retain recovery choices (retry with same ID, stay and resolve blocked work, confirmed discard with audit).
6.3. Done when: integration plus browser tests prove no false-complete, stable idempotency, and audited discard.

### Step 7 -- AC17: input integrity under timers, overlays, IME, keyboard, nav (WP08 plus WP09 joint)

Contracts: C05 (server-clock authority -- display consumes, never redefines), C08 (autosave durability during nav).
Files: question inputs plus useQuestionAnswer and useCurrentQuestion, timer hook plus clock, overlay stack (useOverlayStack), shortcuts (useSatShortcuts), exam-session provider and selectors, authoring and grading editors.

7.1. Reproduce: timer ticks (precise plus coarse), overlay open and close, IME composition (CJK and VI fixtures), keyboard nav (roving tabindex, arrows, Enter and Space, Esc), focus, selection, undo, question switching -- assert zero edit loss and unchanged clock semantics (deadline math untouched; only tick cadence and display band change).
7.2. Repair rules (order matters): (a) question-local subscriptions first (editing one answer never re-renders unrelated questions); (b) timer isolation second (content subscribes to no tick; header and detail subscribe precise, roster rows coarse); (c) derived-state dedup third (remove effect-mirrors that race); (d) identity and context stabilization only where traces prove waste; (e) controller extraction by responsibility with characterization tests (never line-count quotas); (f) memo and virtualization last, never unmounting active editors. IME composition events (compositionstart, update, end) gate autosave and coalescing so intermediate compositions are not committed as answers.
7.3. Done when: browser plus a11y tests (including sat-a11y config) pass; React traces show isolated renders; IME, focus, and undo preservation asserted.

### Step 8 -- Storage hardening: corrupt, upgrade, account-switch, lifecycle (C08 remainder)

8.1. Corrupt records (bad JSON, schema mismatch, cross-attempt key): quarantine-or-ignore with visible durability_fault or blocked state plus telemetry; never crash the session, never silently drop sibling keys.
8.2. Upgrades: namespaced prefixes plus schema versions (SAT outbox v1 to v2 precedent); old bundles forward-read new records conservatively (unknown fields ignored, known semantics preserved); new bundles read old records via shims (legacy order==0 rule). Test old-client and new-server plus new-client and compatible-old-server.
8.3. Account switching (candidate change): new identityKey generation resets engine and store state for the prior candidate; prior pending work is isolated (never replayed under the new identity); prior quarantine ledger is not surfaced to the new candidate (privacy, I11).
8.4. Lifecycle: visibility_hidden, pagehide, freeze, and beforeunload flush paths call flush() best-effort without blocking unload; destroy() bumps generation so late async archive work aborts; enqueueKeyWrite chains prevent same-key races.
8.5. Compaction and retention: tombstone and quarantine bounds (200-entry precedent) plus journal compaction that never removes unacked work; terminal cleanup only after acknowledged terminal fact plus approved retention window (coordinate Phase 05).

### Step 9 -- WP08 profiling plus rendering repair (measured, AC19 client slice)

9.1. Profile first (WP10 harness): typing latency, question-nav cost, timer-tick fan-out, roster update (300-row room), grading navigation -- on the C09 lower-powered device plus desktop slice. Capture React traces (commit counts, commit durations, re-rendered question cards per keystroke) before changing code.
9.2. Apply step 7.2 repairs in trace order; re-measure after each. Keep typing synchronous (M1 to M2 path has no await on the visible update); defer nonurgent work (telemetry, prefetch, export prep) to idle and background without undermining storage correctness (drain debounce delays network only -- accepted edits are still checkpointed immediately).
9.3. Stabilize React Query keys, selectors, and context boundaries evidenced as wasteful; remove duplicated derived state; keep handlers thin and stores explicit. No universal state machines, generic repositories, or plugin frameworks.

### Step 10 -- WP09 operational states plus a11y plus heavy workloads (AC19 and AC20 client slice)

10.1. Operational-state matrix: for each critical action (bootstrap and load, answer save, submit, takeover, export, roster load, media and calculator init) implement all applicable states: loading (skeleton, SrLoadingText), empty (actionable next step), offline (queued intent plus retry), denied (no data leak, request-access path), conflict (fenced and terminal copy plus reconcile and discard), degraded (partial data with banner), submitting (single-flight, disabled controls, idempotency note), recoverable-error (retry plus copy-answer plus proctor-escalation). Reuse ConfirmModal, Toast, LoadingMark, and authoring state surfaces -- do not invent a second design system.
10.2. Timer semantics truth table (with Phase 04 for C05 meaning; Phase 03 owns display plus non-destruction): overlays do not pause clocks; student break, proctor pause, extension, expiry, and module transition each have an explicit, tested display plus write-permission pairing; background-tab throttling never advances or rewinds authoritative time (server clock plus offset math is the authority; local tick is display only).
10.3. A11y audit (release-blocking on exam paths): labels and names, focus order plus visible focus, dialogs (focus trap plus return focus plus Esc), live announcements for durability, submit, and conflict changes (aria-live polite, never per-keystroke assertive), contrast, reduced-motion (useReducedMotion plus authoring motion tokens), touch targets (44 px minimum on exam controls), screen-reader end-to-end (NVDA and VoiceOver minimum) for answer to save-status to submit flows.

10.4. Lazy and prefetch bounds: lazy-load heavy editors, calculator, and export dialogs by route; prefetch only bounded likely-next content (next question and module assets, not whole libraries); measure route plus interaction budgets before and after.

10.5. Exports and rosters: server paging plus Virtuoso-based virtualization (reuse VirtualizedList); export runs bounded (chunked main-thread work, or Worker and server export only if measured payloads justify the boundary) with progress, cancellation, and recoverable errors; active editors stay mounted during export; export failure never corrupts persisted answer state.

10.6. Media and calculator isolation: media load failure and calculator init failure render degraded-tool states; answer state, timer, and durability pipeline are untouched (AC20).

### Step 11 -- Cross-cutting: single-retry audit plus telemetry hygiene (with Phase 06)

11.1. Walk every response-write-adjacent retry (engine drain, bridge retries, React Query retry, poll-loop backoff, credential-refresh single retry) and prove exactly one owner per operation (C07). Document the retry table in the evidence ledger.

11.2. Durability telemetry emits reason-coded counters only (onDurabilityEvent with name plus reason, epoch, count); assert no answer, payload, or token content in events, logs, or metric labels (I11). Bounded label sets; IDs only in controlled diagnostic context when justified.

### Step 12 -- Evidence plus handoff packaging

12.1. Fill the evidence ledger per overall-plan section 11 for each AC (requirement, WP and owner, contract versions, files, candidate identity, producer commands plus exit statuses, reviewer evidence, PASS or FAIL or NOT RUN or BLOCKED, residual risk, rollback evidence, next action).

12.2. Package the Phase 03 candidate: source revision, dirty-tree hashes, schema version, config fingerprint, lockfiles, build artifact identity.

12.3. Send the section 16 handoff to L0 and Phase 07; flag any contract question that arose as a contract-change request (not a local workaround).

---

## 8. Code and pseudocode (illustrative -- follow the source, do not copy-paste)

These sketches convey the normative control flow. The source of truth is the frozen contracts plus current implementation; sketches omit validation, logging redaction, and accessibility wiring for brevity (which the implementation must include).

### 8.1 Readiness barrier (AC01 -- pre-bootstrap input preserved, newer intent overlaid)

    // ILLUSTRATIVE -- readiness barrier shape (engine + provider hydration).
    // M2 checkpoint is synchronous; versions seed from recovery;
    // overlay orders by (order, receivedAt, version-chain).
    async function acceptBeforeBootstrap(engine, questionId, payload) {
      // Even when recovery is not initialized: visible update + sync checkpoint happen NOW.
      await engine.acceptResponse(questionId, payload);
      // Internally: setVisible sync, checkpointIntentSync sync, journal async, versions deferred.
    }
    function hydrateAuthoritativeSnapshot(engine, snapshot, localPendingByQuestion) {
      // 1. Never roll epochs back on a delayed snapshot.
      engine.updateEpochs(Math.max(engine.getLeaseEpoch(), snapshot.leaseEpoch),
        Math.max(engine.getControlEpoch(), snapshot.controlEpoch));
      // 2. Install authoritative CONFIRMED state only.
      for (const ack of snapshot.responses) engine.installServerResponse(ack);
      // 3. Overlay newer local intent: pending newer than the acked version survives.
      for (const entry of localPendingByQuestion) {
        if (isNewerThanConfirmed(entry.pending, engine.getConfirmed(entry.q))) engine.keepPending(entry.q, entry.pending);
        else engine.clearSupersededPending(entry.q, entry.pending);
      }
      engine.markRecoveryInitialized(); // unblock version allocation + drain
    }

Provider wiring: IELTS applies this inside the route-data load and live transitions (evaluateLoadTransition and evaluateLiveSnapshotTransition plus freshness and revision guards); SAT applies it in hydrateBootstrap and hydrateRevisions with the identityKey generation plus runtimeRevision regression-drop. Both paths share the engine rule above -- no forked barrier logic.

### 8.2 Ack matcher (AC03 -- exact ack, immutable issued payload)

    // ILLUSTRATIVE -- drain + exact-ack matching.
    async function drainOutbox(engine, transport) {
      if (engine.isDraining || engine.isTerminal() || engine.hasBlockedGate()) return;
      const commands = engine.collectPendingCommands(); // unissued only; deep-frozen at issue
      for (const cmd of commands) {
        engine.moveToInFlight(cmd); // issuedCommands.set(cmd.writeId, frozenClone(cmd))
        try {
          const res = await transport.sendBatch(engine.attemptId, {
            leaseEpoch: engine.getLeaseEpoch(),
            controlEpoch: engine.getControlEpoch(),
            commands: [cmd],
          });
          for (const ack of res.acknowledgements) {
            if (ack.writeId !== cmd.writeId) continue; // exact identity match, never questionId alone
            if (ack.outcome === 'applied' || ack.outcome === 'duplicate') engine.commitAck(cmd.questionId, ack);
            else if (ack.outcome === 'superseded') engine.archiveAndReplace(cmd.questionId, ack, 'ack-superseded');
            else engine.fence(cmd.questionId, ack); // fenced and terminal outcomes go to conflict path
          }
        } catch (e) {
          engine.returnInFlightToOutbox(cmd); // identical retry later: same writeId + same bytes
          engine.scheduleBoundedRetry({ maxAttemptsPerDrain: 8, jitter: true });
        }
      }
    }

### 8.3 Journal coalescer (AC03 and AC17 -- coalesce only unissued)

    // ILLUSTRATIVE -- coalescing boundary.
    function onTyping(unissued, issued, next) {
      const key = coalesceKey(next); // answer QID, writing_answer taskId, flag QID
      if (issued.has(key)) {
        // An issued write exists for this key: queue next as NEWER unissued intent
        // (new writeId, bumped clientVersion). Never patch issued payload bytes.
        return enqueueUnissued({ ...next, writeId: newWriteId(), clientVersion: issued.get(key).clientVersion + 1 });
      }
      // No issued write: replace superseded unissued intent for the same key (typing coalescing).
      return replaceUnissuedSameKey(key, next);
    }

Epoch interaction: updateEpochs(lease, control) adopts monotonically. Lease increase goes to quarantineCommandsOutsideCurrentEpoch with reason EPOCH_STALE (strict fence; conflict persists until explicit resolution). Control-only increase (pause, resume, extend with lease unchanged) goes to blockPendingOnControlBump (unsent work stays visible in place as blocked, I04-safe). Never auto-replay across either fence.

### 8.4 Timer isolation (AC17 and AC19 -- clocks tick, content sleeps)

    // ILLUSTRATIVE -- banded clock consumption (existing hook is the only clock).
    function StageHeader({ deadlineAt, serverNow }) {
      const remaining = useAuthoritativeDeadlineClock({ deadlineAt, serverNow, fallbackSeconds: 0, running: true });
      return timerDiv(formatCountdown(remaining)); // precise band; role timer; aria-live off
    }
    function RosterRow({ deadlineAt, serverNow, student }) {
      // 15 s band: row re-renders about 4x per min, not 60x per min.
      const remaining = useAuthoritativeDeadlineClock({ deadlineAt, serverNow, fallbackSeconds: 0, running: true, coarse: true });
      return spanEl(formatCountdown(remaining));
    }
    function QuestionInput() {
      const answer = useCurrentQuestion((s) => s.question && s.question.draft); // question-local, no clock subscription
      return textArea(answer, onChange); // typing never re-renders on tick
    }

Rules: content components subscribe to question-local selectors only; urgent surfaces use the precise band; idle roster rows use coarse true; aria-live stays off per-tick (announce thresholds, not seconds); server-clock math (deadline minus now plus offset) is never redefined locally.

### 8.5 Virtualized roster (AC19 -- bounded mounts, accessible nav preserved)

    // ILLUSTRATIVE -- paging + virtualization + coarse clocks (reuse VirtualizedList and Virtuoso).
    function ProctorRoster({ scheduleId }) {
      const { page, filters, setPage } = useStudentFilters(); // server-paged query, stable keys
      const { data } = useProctorRosterPage(scheduleId, filters, page); // bounded page size, e.g. 50-100
      return VirtuosoList(data.students, (s) => StudentRow(s, true), RosterEmpty, PagingControls);
    }
    // Never virtualize away the focused or active row; preserve roving tabindex + aria-rowindex.

Rules: server paging bounds the dataset; virtualization bounds mounted rows; active and focused rows stay mounted; aria-rowindex and keyboard nav survive virtualization; alert lists reuse the same pattern (existing AlertPanel Virtuoso).

---

## 9. Data and state flow

    Student intent
      |  (M1 visible input -- sync render, question-local)
      v
    acceptResponse(q, payload)
      |  +- sync: setVisible + checkpointIntentSync (M2, CAS-guarded, small per-question record)
      |  +- async (never blocks typing): journal write M3 via IndexedDB or fallback + version allocation (post-recovery) + drain schedule (debounced network only)
      v
    Outbox (unissued, coalescible) --coalesce-only-unissued--> In-flight (issued, FROZEN: writeId + payload + epochs)
      |                                                              |  sendBatch { leaseEpoch, controlEpoch, commands[] }
      |                                                              v
      |                                              Server (Phase 02): commit + ack { writeId, clientVersion, outcome, serverRevision, canonicalResponse, contentHash }
      |                                                              |  (ack lost -> identical retry: same writeId + same bytes)
      |                                                              v
      |                                              installServerResponse: exact (writeId, clientVersion) match
      |                                                                +- applied or duplicate -> M5 exact ack -> clear checkpoint and journal, advance serverRevision
      |                                                                +- superseded -> archive + replace (ack-superseded)
      |                                                                +- fenced or terminal -> conflict_fenced or conflict_terminal + quarantine and archive
      v
    Hydration (bootstrap, live snapshot, poll, socket)
      +- monotonic updateEpochs (never roll back) -> install CONFIRMED acks -> overlay newer local pending (order, receivedAt, version-chain)
      +- lease increase -> quarantine-outside-epoch (strict fence); control-only bump -> block-in-place
      +- stale or terminal -> fence, never auto-replay
      v
    Submit: guard(blocked==0 and quarantined==0) else shared gate copy + counts
      +- single submissionPromise, stable submissionId across receipt-loss retry (Phase 02 outcome-compat)
      +- confirmed discard (explicit + audit) -> quarantine_pruned with reason discard
      v
    Status pipeline: engine DurabilitySyncStatus -> mapEngineStatus(+blockedCount) -> UnifiedDurabilityDisplay
      (saving | saved_locally | blocked_attention | conflict | saved | error) -> banners, badges, live-announcements
      Telemetry: onDurabilityEvent(reason, epoch, count only -- never content)

Cross-provider note: IELTS (route-data plus outbox mirror plus store) and SAT (persistence hook plus controller plus outbox store) both feed the same engine flow. The IELTS legacy checkpoint (ielts_student_answer_checkpoint_v1) and SAT legacy outbox (sat-response-outbox:v1) remain as compat tiers in this phase; unification is WP16-gated on equivalence evidence.

---

## 10. Edge cases (each needs a test or an explicit NOT-RUN entry -- never silent PASS)

- E1 Type before bootstrap resolves; older snapshot arrives after: input preserved (M2 sync checkpoint pre-recovery); overlay keeps newer intent by accept-sequence; epochs never roll back. AC01.
- E2 Bootstrap never resolves (offline or hung fetch): drafts stay visible plus saved_locally or saving; fetch timeout (~15 s) resolves as offline; retryable, no fabricated ack. AC01 and AC04.
- E3 Quota exhausted mid-typing: durability_fault visible; in-memory intent preserved; no save claim; recovery limits shown. AC02.
- E4 Storage denied (private mode or policy) on both tiers: same as E3 plus explicit storage-unavailable-on-this-device guidance. AC02.
- E5 Corrupt checkpoint or journal record (bad JSON, wrong schema, cross-attempt key): isolate the bad record (quarantine or ignore plus fault signal); sibling keys unaffected; session continues. AC02 and C08.
- E6 Reload while offline with checkpoint plus journal: ordered recovery from sync tier, async merge without ack fabrication; tombstone and quarantine ledger rehydrated. AC04.
- E7 Delayed or hung IndexedDB on reload (slow async tier): sync tier recovers promptly; async merges when ready (newer-wins); status never claims ack. AC04.
- E8 Old device writes after takeover (stale lease): fenced; no write applied; pending preserved as blocked or quarantined; distinct takeover recovery (re-auth, fresh state, explicit reconcile or discard). AC07.
- E9 Stale control epoch after proctor pause or extend: unsent work blocked in place (visible), not quarantined or deleted; resumes on fresh writable state. AC07.
- E10 Pause plus takeover combined (control bump then lease change): lease fence dominates; control-blocked work transitions to quarantine path with audit continuity. AC07.
- E11 Submit with blocked or quarantined work: no complete screen; gate copy plus counts; confirmed discard with audit; stable submissionId across receipt-loss retry. AC08.
- E12 Lost submit receipt (response dropped post-commit): identical retry (same ID) reconciles to one compatible outcome; no duplicate terminal fact. AC08.
- E13 IME composition (CJK and VI fixtures) during autosave plus nav: intermediate compositions not committed; final composition saved once; focus and selection preserved. AC17.
- E14 Timer tick during typing, overlay open, break, pause, expiry, or module transition: zero edit loss; clock display follows server authority; overlay never pauses authoritative time; expiry triggers the approved autosubmit path (Phase 02 and 04 coordination). AC17.
- E15 Keyboard-only flow (Tab, arrows, Enter, Space, Esc, roving tabindex, dialogs): full task completion; focus trap plus return-focus; no keyboard traps. AC17.
- E16 Background-tab throttle (timers clamped, storage deferred): authoritative time unaffected (server math); pending work flushed on visibility and pagehide best-effort; no duplicate sends on refocus. AC17 and AC19.
- E17 Stale server offset (clock skew correction jumps): remaining-seconds math uses server offset; display steps without touching answer state or fabricating expiry. AC17.
- E18 300-row roster plus alert storm on lower-powered device: bounded mounts (paging plus virtualization plus coarse clocks); interaction budgets met; backlog drains after storm. AC19.
- E19 Large export (per-student ZIP and PDF, hundreds of submissions): chunked and bounded work, progress plus cancel, recoverable errors; active editors stay mounted; no answer-state corruption. AC20.
- E20 Media (diagram or audio) or calculator fails to load: degraded-tool state; answer, timer, and durability untouched; retry plus proctor-escalation path. AC20.
- E21 Account switch mid-attempt (candidate A to B on shared device): A pending isolated (never replayed under B); B sees only B state; no cross-user exposure (I11). C08.
- E22 Old bundle versus new storage format (both directions): forward-read shims; unknown fields ignored; legacy ordering rule; no blanket wipe; compat tests both ways. C08.
- E23 Engine destroyed (unmount or nav) with archive in flight: generation bump aborts late async archive and tombstone writes; no post-destroy state mutation. Robustness.
- E24 Rapid typing burst (debounce boundary): sync checkpoint per acceptance (bounded small record); network drain debounced; first keystroke visible within budget; no whole-attempt rewrite. AC19.

---

## 11. Errors (handling rules -- never hide, never weaken)

- Storage faults (QuotaExceededError, SecurityError denied, InvalidStateError, corrupt JSON, fallback-unavailable): status durability_fault maps to display error; preserve in-memory intent; show recovery limits; telemetry quarantine_failed and persistence-failure counters (no content). Acceptance chain rejects or holds in explicit fault -- never resolves as durable.
- Transport failures (offline, timeout, 5xx, hung snapshot fetch): keep pending; bounded drain retries (8 max per drain, jitter); snapshot timeout (~15 s) takes the offline path; failureKind offline or retryable; retryable UI (retry button, auto-drain on reconnect).
- Fences (stale lease, control stall, version collision, stale hydration, terminal state): status conflict_fenced, conflict_terminal, or blocked_attention; writes rejected with fenced or terminal message; pending preserved; reconcile only on fresh writable state; explicit confirmed discard.
- Submit gate (blocked or quarantined present, SUBMISSION_ID_MISUSE, lost receipt): no complete screen; shared gate copy plus counts; stable idempotency retry; misuse code surfaced per C07 without blind retry.
- Auth and takeover (401 credential expired, takeover conflict, account switch): single credential-refresh attempt then surface; takeover rotates identity without forking writers; switch isolates prior pending.
- Validation and input (empty question ID, malformed payload, cross-attempt key): reject fast with typed error; never checkpoint invalid records; malformed wire input retains exact C07 status and envelope.
- Export, roster, and media (export OOM risk, page-load failure, media 404, calculator init throw): bounded plus cancelable plus recoverable-error state; isolation from answer store (no shared mutable state); export failure never clears checkpoints.
- Telemetry and logging (hook throws, metric pipeline down): best-effort only (engine onDurabilityEvent never throws); durability and status paths do not depend on telemetry success.

Forbidden: swallowing errors to turn tests green; growing timeouts instead of diagnosing; mapping unacked or blocked work to saved; silent discard (every destructive removal is archived first plus confirmed plus audited, or it does not happen).

---

## 12. Performance and security

### 12.1 Performance (measure first -- initial gates are calibration proposals from optimize.md section 8, finalized with C09)

- Answer input responsiveness: proposal p95 input-to-visible 100 ms or less on the named lower-powered device, including sync checkpoint work. Phase 03 boundary M1 to M2 path: sync only, small per-question record, no IndexedDB await, no whole-attempt serialize. Measure per-keystroke cost in syncCheckpointBudget.test.ts; whole-attempt-rewrite detector fails the build.
- General interaction (INP): proposal p75 200 ms or less where supported, real sessions with device and browser slices. Question-local subscriptions plus timer isolation plus selective memo; compare traces against WP10 budgets.
- Autosave ack: proposal p95 1 s or less client-send to exact-ack within the defined network profile. Drain debounce plus bounded retries plus single retry owner; report send-to-ack distribution, not just mean.
- Terminal receipt: proposal p95 2 s or less (separate: ordinary seal versus SAT provisional versus final result readiness). Submit single-flight plus stable ID; Phase 02 owns server seal cost.
- Roster and grading scale: 300-row room at rest about 20 renders per second (coarse band), not 300; export bounded plus cancelable. Paging plus virtualization plus clock bands; post-storm backlog returns to baseline (AC19).
- Regression rule I12: faster is not better if any invariant regresses. Before-and-after correctness plus load evidence for every optimization.

Method: profile typing, nav, timers, rosters, and grading with representative fixtures before repairing; keep typing synchronous and responsive; defer background work (telemetry, prefetch, export prep, journal compaction) off the input path via idle, debounce, and worker boundaries without undermining storage correctness; lazy-load heavy code by route with bounded prefetch; choose Worker or server-export boundary only on measured payload evidence.

### 12.2 Security and privacy (I11 plus C04 and C07 consumed)

- Telemetry and logs carry reason, epoch, and count only -- no answers, tokens, passwords, or unnecessary student identifiers in events, logs, metric labels, or error messages. Audit every new onDurabilityEvent call site plus log statement (redaction and cardinality check with Phase 06).
- Storage keys are per-attempt isolated; account switch never leaks prior pending; quarantine and conflict archives are same-attempt, same-user only.
- Answer content never appears in metric label sets; IDs only in controlled diagnostic context when justified.
- Authorization is server-enforced (C04); client fences are UX honesty, not security boundaries -- stale-browser writes are still rejected server-side, and the client surfaces the rejection without bypass or silent retry.
- No answer or token leakage into export filenames, toast copy, document titles, or snapshot diagnostics.

---

## 13. Tests (AC01-AC04, AC07, AC08, AC17, AC19, AC20 -- deterministic, no arbitrary sleeps)

Extend current tests where they own the behavior. Use deterministic clocks, transaction barriers, network interception, and controlled storage faults. Distinguish PASS, FAIL, SKIPPED, QUARANTINED, NOT RUN -- a skipped critical test is not a pass.

- AC01 engine unit: DurableResponseEngine.preservation.test.ts (extend) plus new readinessBarrier.test.ts. Assertions: pre-bootstrap accept then older snapshot means newer intent plus order survive; epochs never roll back; both providers hydration paths.
- AC01 browser: extend e2e/student-input-durability.spec.ts. Type before bootstrap spinner resolves; assert visible plus recovered ordering post-hydration.
- AC02 engine: new storageFaults.test.ts (quota, denial, corrupt-record, fallback-dead matrix). Never saved_locally or synced; durability_fault plus in-memory intent preserved plus recovery limits surfaced.
- AC02 browser: extend input-durability plus recovery specs with storage-fault injection. Denied-storage editing banner; no save claim; copy-answer guidance.
- AC03 engine plus DB integration: engine drain and ack tests (extend) plus Phase-02-backed integration (Phase 03 asserts client exactness). Lost-ack yields identical retry (same writeId plus bytes) to compatible ack; same-ID and different-payload goes to conflict, not overwrite; issued payload immutability.
- AC04 engine: DurableResponseEngine.test.ts recovery sections (extend) plus storageFaults.test.ts delayed-async case. Reload-offline ordered recovery; tombstone and quarantine rehydration; no fabricated ack.
- AC04 mobile browser: Playwright mobile project (Pixel 5 and touch-chromium in sat-a11y config plus main config mobile project) with throttled storage. Same as above on slower storage; background-throttle variant.
- AC07 engine race: new epochFences.test.ts. Stale-lease write rejected plus preserved; control-bump blocks in place; lease-change quarantines; conflict persists across drains and epochs until explicit resolution; no auto-replay across stale or terminal.
- AC07 browser: new or extend student-takeover-lease.spec.ts (or student-multi-device.spec.ts). Old-device-after-takeover versus stale-control-after-pause distinct recoveries, both winners where valid.
- AC08 engine plus integration: new submitGate.test.ts plus submission-coordinator tests. Blocked and quarantined gate; stable submissionId across lost receipt; no false complete; audited discard.
- AC08 browser: new or extend student-submit-blocked.spec.ts (or student-submit-flow.spec.ts). Submit-with-blocked UI; receipt-loss retry; confirmed-discard modal plus audit.
- AC17 browser plus a11y: extend e2e/sat-student-accessibility.spec.ts (sat-a11y config) plus student-accessibility.spec.ts plus new satTimerSemantics.test.tsx. Timer, overlay, IME, keyboard, focus, selection, undo, and question-switch matrix; timer-versus-break, pause, and expiry truth table; live-announcement discipline.
- AC17 unit and render: question-local plus clock-band trace tests (extend studentExamStore.rendering.test.tsx, controller identity tests). One-answer edit does not re-render unrelated content; content unsubscribed from ticks.
- AC19 perf, trace, plus load: syncCheckpointBudget.test.ts plus frontend-performance spec plus roster virtualization test plus k6 and Playwright storm evidence (Phase 07 owns integrated load; Phase 03 owns client slice). Input and interaction budgets; 300-row bounded mounts; post-storm backlog drain.
- AC20 browser plus service: new gradingExport.bounded.test.ts plus export and roster specs plus media and calculator isolation tests. Export progress, cancel, and recoverable-error; active editors mounted; media and calculator failure isolated from answers.
- Cross-cutting contract: new storageNamespaces.contract.test.ts plus mapper-contract test (extend). Namespaces, versions, compat, and no-wipe rules; full status by blocked matrix including null-engine yields saving.

IME specifics: composition-event tests with CJK and VI fixtures (compositionstart, then intermediate updates not committed, then compositionend commits once); selection and focus assertions around autosave flushes.

A11y specifics: axe checks plus manual screen-reader flows (NVDA plus VoiceOver minimum), focus-trap and return-focus tests, contrast plus reduced-motion plus touch-target audits, keyboard-only completion of answer to status to submit.

Old and new compat: old-client and new-server plus new-client and compatible-old-server storage-format cases in the namespace contract test.

---

## 14. Verification commands (confirm actual scripts and environment in WP00 -- historical names below)

Run from the repo root after confirming scripts in package.json. Never run remote or production-targeting configs without explicit authorization.

    npm run typecheck
    npm run lint
    npm run test:run
    npx vitest run src/shared/durability/__tests__/DurableResponseEngine.test.ts
    npx vitest run src/shared/durability/__tests__/DurableResponseEngine.preservation.test.ts
    npx vitest run src/shared/durability/__tests__/DurableResponseEngine.debounce.test.ts
    npx vitest run src/shared/durability/__tests__/durabilityTelemetry.test.ts
    npx vitest run src/shared/durability/__tests__/useResponseDurabilityStatus.test.ts
    npx vitest run src/features/student-delivery/application/__tests__/useSatResponsePersistence.v2.test.tsx
    npx vitest run src/features/student-delivery/hooks/__tests__/useSatExamController.identity.test.tsx
    npx vitest run src/features/student/hooks/__tests__/useStudentSessionRouteData.backend.test.tsx
    npm run e2e:sat-a11y
    npx playwright test --config playwright.config.ts e2e/student-input-durability.spec.ts
    npx playwright test --config playwright.config.ts e2e/student-recovery.spec.ts
    npx playwright test --config playwright.config.ts e2e/student-submit-flow.spec.ts
    npx playwright test --config playwright.config.ts e2e/student-multi-device.spec.ts
    npx playwright test --config playwright.config.ts e2e/frontend-performance.spec.ts
    npx playwright test --config playwright.config.ts e2e/proctor-dashboard.spec.ts
    npm run build

Notes: npm run typecheck is tsc --noEmit; npm run lint is eslint; npm run test:run is vitest run over jsdom excluding e2e; npm run e2e:sat-a11y is playwright with playwright.sat-a11y.config.ts (chromium plus webkit plus touch-chromium Pixel 5); npm run build is vite build. Unavailable required checks are recorded NOT RUN or BLOCKED -- never substituted with weaker evidence.

---

## 15. Completion checklist (all unchecked at plan delivery -- check only with evidence)

- [ ] C01, C02, C07, C08 frozen versions recorded in section 6.1 plus every ledger entry; provider-adapter assignments confirmed with L0.
- [ ] AC01: readiness barrier on both providers; older snapshot cannot clobber newer intent; ordering survives (engine plus browser green).
- [ ] AC02: quota and denial matrix; no false save claim; in-memory intent preserved; recovery limits visible (engine plus browser green).
- [ ] AC03: lost-ack identical retry; compatible ack; no duplicate mutation; issued payloads immutable; single retry owner proven.
- [ ] AC04: reload-offline ordered recovery including delayed async plus mobile profile; quarantine and tombstone rehydration; no fabricated ack.
- [ ] AC07: stale-lease fence plus takeover recovery distinct from control-bump block-in-place; no auto-replay across stale or terminal; no silent deletion.
- [ ] AC08: blocked and quarantined submit gate; stable idempotency across lost receipt; no false complete; confirmed plus audited discard.
- [ ] Sync checkpoint bounded (small per-question records; no whole-attempt rewrite per keystroke) with measurement evidence.
- [ ] Milestones exact (M1-M5 plus derived states) through the single mapper; null engine never reports saved.
- [ ] Coalesce-only-unissued plus archive-before-delete plus bounded quarantine and compaction plus namespaced upgrades plus no blanket clearing (contract test green).
- [ ] Account-switch isolation; lifecycle flush (visibility, pagehide, freeze) best-effort; destroy-generation abort proven.
- [ ] WP08: traces show question-local renders plus timer isolation (precise and coarse) plus no effect-mirror races; identities and contexts stabilized only with evidence; responsibility-based extraction with characterization tests; typing stays sync; memo and virtualization never unmount active editors.
- [ ] WP09: operational-state matrix complete on critical actions; IME, focus, selection, undo, and keyboard preserved; timer-versus-overlay, break, pause, and expiry truth table green; a11y audit (labels, focus, dialogs, live-regions, contrast, motion, targets, screen-reader flows) release-blocking clean; lazy and prefetch bounds measured; export and roster paging plus virtualization plus progress and cancel; media and calculator isolated.
- [ ] I11: no answer, token, or secret leakage in telemetry, logs, labels, exports, or filenames (redaction check green).
- [ ] I12: before-and-after correctness plus load evidence for every optimization; no invariant weakened.
- [ ] Evidence ledger entries (overall-plan section 11) complete for AC01-AC04, AC07, AC08, AC17, AC19, AC20 with candidate identity plus producer commands and exit statuses plus reviewer evidence.
- [ ] Rollback verified: old and new bundle compat both directions; namespaced storage preserved across rollback; no data-loss path introduced.

---

## 16. Handoff to Phase 07 (integrated rehearsal, rollout and cleanup)

Delivered to L0 and Phase 07:

1. Candidate identity: source revision plus dirty-tree hashes, schema version, config fingerprint, lockfiles, build artifact (per section 12.2 and section 14 green runs).
2. Evidence ledger pack for AC01-AC04, AC07, AC08, AC17, AC19, AC20: each entry links requirement to WP and owner to contract versions to files to producer commands (command plus environment plus exit status plus artifact) to reviewer evidence to PASS, FAIL, NOT RUN, or BLOCKED to residual risk to rollback evidence to next action.
3. Contract questions: any C01, C02, C07, C08 ambiguity met during implementation, filed as contract-change requests (never locally worked around), with affected steps flagged for recheck.
4. Known limits disclosed: browser-eviction, destruction, and denial bounds; supported device and browser matrix actually tested (including mobile plus touch-chromium); capacity slice measured (interaction, API, and resource distributions plus raw traces) with workload, resources, and config attached -- no extrapolation to untested concurrency.
5. Rollback package: old and new bundle compat evidence, namespaced-storage preservation proof, UI-bundle rollback preserving persistence compat.
6. Residual risks: quarantined and flaky tests with owner plus deadline (never permanently hidden); any IMPORTANT finding needing authorized acceptance.
7. Cleanup explicitly NOT done: V1 writes, duplicate stores (IELTS checkpoint versus engine journal; SAT legacy outbox), redundant gateways and flags remain until WP16 equivalence plus adoption evidence -- Phase 07 must not retire them on looks alone.

Phase 07 entry criteria from this phase: all section 15 boxes checked or explicitly closed as already-satisfied with evidence; no BLOCKING findings; AC01-AC04, AC07, AC08, AC17, AC19, AC20 fresh-passing against the frozen Phase 03 candidate; telemetry redaction plus a11y gates green on exam paths.

---

*Planning handoff: this file is the plan only. It changes no production behavior. All implementation work, test execution, deployment evidence, and independent review remain future work owned per the registry in section 3.*