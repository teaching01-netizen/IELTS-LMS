# IELTS Shared Clock and Offline Continuity Implementation Plan

> **For agentic workers:** Use the executing-plans skill to implement this plan task by task. Track the checkboxes. Preserve all unrelated working-tree changes, including the existing personal-timing transition work. This document authorizes no source implementation by itself.

**Goal:** A student losing their connection or crashing during an IELTS section transition cannot delay anyone else; a prepared device can continue the same room schedule offline, recover durable work after restart, and reconcile safely when it reconnects.

**Architecture:** The server commits one room timetable with absolute section windows. The room and each prepared browser independently derive the current section from that timetable. The existing response durability engine remains the answer owner; expired or conflicting offline writes enter the existing unscored evidence ledger instead of bypassing server deadline or writer checks.

**Tech stack:** Existing Go services, MySQL transactions and outbox, React/TypeScript, Bun, IndexedDB, browser Cache Storage and a narrowly scoped service worker. No new queue, separate application, or personal timer service.

**Status:** Implemented 2026-10-30. Task evidence and the operator runbook
live in `docs/operations/ielts-offline-continuity.md`. New names and fields
below are proposed unless explicitly marked verified.

---

## 1. Change boundary and repository evidence

### Verified current behavior

| Existing owner/file | Observed behavior and consequence |
| --- | --- |
| `backend/go/internal/runtime/cohort_readiness.go`, `ReadyCohortSection` | The current working-tree patch removes the `RemainingStudents > 0` start barrier. The first prepared requester with measured RTT can arm a released shared section. Requests after activation return the stored start. This is a useful partial fix, not an offline timetable. |
| `backend/go/internal/runtime/cohort_readiness_test.go` | Working-tree tests cover missing students, preparation failures, pauses, and replay of an existing start. |
| `backend/go/cmd/api/ielts_shared_transition_mysql_test.go` | A working-tree integration test races two devices while a third is absent. It was skipped in the preceding implementation turn because `TEST_MYSQL_DSN` was unset. |
| `backend/go/internal/runtime/service.go` | Owns room start, pause/resume and shared attempt deadline projection through `SyncV2TimingInTx`. Runtime mutations use existing schedule/attempt/runtime/section transaction ordering. |
| `backend/go/internal/proctor/reconcile.go` | `planSectionAdvance` and `startSectionEffect` materialize section transitions. The IELTS preparation path currently opens a successor locked with no actual start; a browser subsequently starts its clock. |
| `backend/go/internal/runtime/timingmodel.go` | Defines legacy, SAT cohort/personal, and IELTS personal variants. Existing stored choices must keep their meaning. |
| `backend/go/internal/schedules/service.go` | `PersistIeltsTimingChoice` opts new IELTS schedules into personal timing only when `IELTS_PERSONAL_TIMING` is enabled. Do not enable this flag to solve continuity. |
| `src/features/student/hooks/useIeltsSectionPreparation.ts` | Preparation is ephemeral: checks already delivered content and answer storage. It does not persist a complete exam package or media bytes. |
| `src/features/student/hooks/useStudentSessionRouteData.ts` | Owns bootstrap/live snapshot reconciliation and monotonic freshness guards. It cannot be replaced by unrestricted cached admission. |
| `src/features/student/application/exam-session/studentSessionBootstrap.ts` | Static/live bootstrap uses fresh network requests and an in-memory query cache. An offline hard reload needs a separate explicit path. |
| `src/features/student/infrastructure/studentSessionGateway.ts` | Maps session payloads and hydrates exam content through existing adapters. Reuse those mappings when restoring a package. |
| `src/components/student/providers/StudentRuntimeProvider.tsx` | Computes a display countdown from `currentSectionDeadlineAt` and a server clock offset, but does not independently traverse a future timetable offline. |
| `src/features/student/domain/exam-session/blockingPolicy.ts` | Offline, reconnecting and heartbeat status are already log-only. A cached locked section or expired deadline still blocks; removing the offline label alone cannot implement offline transitions. |
| `src/shared/durability/DurableResponseEngine.ts` | Owns checkpointing, response versions, lease/control fencing, pending writes, quarantine, scoped freezing, and `recordRetainedEvidence`. Extend this owner; do not add a parallel answer outbox. |
| `src/utils/durableDraftStore.ts` | Provides serialized durable JSON writes, IndexedDB with localStorage fallback, loading/listing and explicit clearing. It is not suitable for large audio blobs. |
| `src/features/student/infrastructure/audioCheckpointGateway.ts` | Checkpoints identify part, media revision, writer lease and recovery run generation. Preserve those boundaries for cached audio. |
| `backend/go/internal/attempts/service.go` | `SaveResponses`, `ensureWritable` and question admission enforce authoritative writer, section and deadline checks. An offline manifest must not bypass them. |
| `backend/go/internal/attempts/draft_evidence.go` | `RecordDraftEvidence` stores immutable retained drafts separately. Client timestamps are provenance, never proof. Staff classification does not apply answers or change scores. |
| `backend/go/cmd/api/handlers_draft_evidence.go`, `main.go` | Student evidence ingestion and staff list/review routes already exist. |
| `backend/go/internal/runtime/recovery.go` and `backend/go/internal/exams/recovery.go` | Staff recovery retains the original deadline unless an explicit time award is made; existing controls fence writer transfer. Reuse this for actual lost working time. |
| `src/main.tsx`, `vite.config.ts` | Inspected entry/build wiring has no offline shell installation. A normal browser HTTP cache is not a hard-reload guarantee. |

The previous turn reported passing runtime/proctor/delivery tests, 11 readiness frontend tests, TypeScript and targeted lint. Those results describe the partial readiness patch; none prove the full design in this document.

### Scope

Included: a new opt-in shared schedule model; room progress without any readiness dependency; durable authorized content/media; same-browser offline reload; offline section transitions and local completion; safe answer reconciliation; proctor visibility; rollout and failure tests.

Excluded: automatic compensation for crash time; automatic acceptance of browser-claimed late answers; offline admission of a new student; offline device transfer; instant delivery of room controls to a disconnected device; changing SAT/ACT behavior; migrating running personal-clock rooms.

### Product assumptions and explicit limits

1. **Proposed policy:** use a precommitted timetable in rooms that enable offline continuity. A proctor may start the room, pause it, or amend it, but disconnected devices cannot learn amendments immediately.
2. **Proposed safe grading policy:** ordinary valid writes are scored through the existing API. Writes rejected after expiry, section change, control change, or finalization are retained as unscored evidence. This plan does not promise automatic grading of an entire exam uploaded after it ended.
3. **Content exposure limit:** caching future sections makes their bytes available on the device before their UI opens. A browser cannot both hold the content offline and guarantee a determined device owner cannot inspect it. Restrict rollout to exams permitting this exposure or managed devices. If future-content secrecy is mandatory, permit offline work only in already released sections.
4. **Control delivery limit:** an offline device may temporarily continue on the last authorized timetable after a room pause/end. The server enforces the new control immediately on reconnect and preserves conflicting work as evidence. Instant offline revocation is not a promised invariant.
5. **Durability limit:** preserve writes whose durable transaction/checkpoint completed. A crash before any persistence completes, cleared site data, disk failure, private-mode eviction, or moving to another computer cannot be repaired from local storage.
6. **Clock limit:** native browser clocks are not trusted grading evidence. During a live process use a server anchor and monotonic elapsed time; after a fully offline browser restart use the persisted wall-clock anchor only for provisional display/work. Mark that run clock-unverified and require reconciliation. Do not claim tamper-proof timing.

These limits must appear in the operator rollout documentation. A stricter grading or confidentiality policy changes scope and must be resolved before enabling offline continuity, not hidden in a frontend workaround.

## 2. Requirements and invariants

| ID | Observable acceptance criterion | Enforcement owner |
| --- | --- | --- |
| FR-1 | Student B never needs Student A's readiness, heartbeat, answer upload or reconnect to start a scheduled section. Even zero connected devices does not hold the room timetable. | Runtime schedule and proctor reconciler |
| FR-2 | A prepared device can cross each authorized section boundary without network access. It uses the exact same start/end timestamps as the room. | Schedule resolver and runtime provider |
| FR-3 | The readiness UI reports prepared only after content, required media, shell assets and durable answer storage are verified. Failure affects that device only. | Package preparation owner |
| FR-4 | A same-browser offline reload restores the pinned exam version and durable drafts without restarting any deadline. | Offline bootstrap and durability engine |
| FR-5 | Answers remain visible/durable while offline; reconnect retry cannot duplicate writes or replace a newer answer with an older one. | Existing response engine/server versions |
| FR-6 | A closed-section or stale-control write is retained and uploaded as evidence when authorized; it is not silently discarded or silently scored. | Existing evidence ledger and response engine |
| FR-7 | Local completion says saved on this device / pending sync, not submitted, until a server receipt exists. | Submission orchestration |
| FR-8 | Room pause, extension, early end and device transfer are visible after reconnect. Known terminal, pause and transfer controls always outrank cached permission. | Runtime reconciliation and server authorization |
| FR-9 | Proctors can distinguish disconnected, not prepared, locally saved and server-confirmed states without blocking the room. | Existing session projection/UI |
| INV-1 | One room schedule; all ordinary students share identical section windows for its revision. No per-student start offsets or reconnect extensions. | Runtime schedule JSON |
| INV-2 | A stored timing model never changes meaning or switches mid-exam. | Timing model resolution |
| INV-3 | No content/package for another attempt, user, version, browser lease or recovery run is used for editing. | Offline package identity validation |
| INV-4 | A local projection never increments server runtime revision, control epoch or lease epoch. | Client resolver |
| INV-5 | No pending write is relabeled into a newer writer/control era simply to make upload succeed. | Durability engine |
| INV-6 | A server acknowledgement clears only the exact write it acknowledges. Evidence acknowledgement is not an answer-save or submission receipt. | Durability engine |
| INV-7 | Schedule amendments and runtime projections commit with the control change and outbox event, or all roll back. | Existing transaction boundary |
| INV-8 | Cache failure, reconnect or service-worker update cannot delete pending or evidence-only answers. | Storage lifecycle |

## 3. Entities, data and ownership

### Proposed server model

Add `TimingModelIELTSSharedSchedule = "ielts_shared_schedule_v1"`. Only new explicitly enabled IELTS rooms select it. Keep the existing first-ready partial fix for legacy shared rooms and preserve existing personal room semantics.

Add one nullable JSON column `exam_session_runtimes.ielts_shared_schedule`. Choose the next migration number at implementation time; the inspected latest numeric migration is `0113`. Do not reuse or rename the existing `plan_snapshot` or projected section times: neither is a committed offline authorization contract.

Proposed persisted value:

```ts
type IeltsSharedSchedule = {
  schemaVersion: 1;
  scheduleRevision: number;       // increments only when authorized windows/control change
  status: 'active' | 'paused' | 'ended';
  windows: Array<{
    sectionKey: 'listening' | 'reading' | 'writing';
    order: number;
    startAt: string;             // absolute UTC, inclusive
    deadlineAt: string;          // absolute UTC, exclusive for editing
    saveUntil: string;           // existing provider save grace; never additional working time
  }>;
};
```

Go owns the persisted equivalent in a proposed `internal/runtime/ielts_shared_schedule.go`. Use `time.Time`, bounded slices and validation, not raw map traversal throughout callers.

`actual_start_at`, section status and per-attempt `deadline_at` remain existing online projections. For this model they are derived from the schedule, not independent authorities. The response gate must derive effective section/window from committed JSON at server transaction time even if the background projector is late. Do not create one timetable row per student.

`runtime.revision` continues tracking ordinary runtime lifecycle events. Do not use it as `scheduleRevision`: a section projector advancing normally must not invalidate every cached timetable.

### Proposed manifest and local package

Return an additive `offlineManifest` from the authenticated live session projection once the schedule is committed. Use existing student-filtered static content/version delivery; avoid another full content endpoint. Do not package answer keys, staff-only configuration or raw authoring snapshots.

```ts
type IeltsOfflineManifest = {
  schemaVersion: 1;
  runtimeId: string;
  scheduleId: string;
  attemptId: string;
  publishedVersionId: string;
  clientSessionId: string;
  leaseEpoch: number;
  controlEpoch: number;
  recoveryRunGeneration: number | null;
  schedule: IeltsSharedSchedule;
  serverNow: string;
  contentDigest: string;
  media: Array<{
    resourceId: string;
    kind: 'audio' | 'image';
    partId: string | null;
    mediaRevision: string;
    url: string;
    sha256: string;
    bytes: number;
  }>;
};
```

This is a server-issued descriptor delivered under existing authentication, **not a new bearer token**. A copy in IndexedDB is untrusted input; never authorize server saves using its contents. Digests detect incomplete/wrong-version packages, not malicious browser tampering. Do not cache login cookies, private signing keys or raw credentials inside this record.

Proposed `IeltsOfflinePackage` additionally stores the matching existing static payload, a minimal attempt bootstrap snapshot without credentials, preparation status, shell build ID and clock anchor. Scope its key by user/attempt/version/client session/lease/recovery generation. Answer payloads stay in the existing durability store, not duplicated into the package.

Media includes required listening audio, passage images and question/diagram images, including assets referenced inside rich text. Media bytes belong in an attempt-scoped Cache Storage namespace; metadata and package commit markers belong in durable JSON storage. Write a package `ready` marker only after every resource is verified. A crash midway leaves an incomplete package that cannot authorize offline transitions.

### State transitions

| Current state | Event | Next state and effect |
| --- | --- | --- |
| No package | Authenticated manifest/content received | Preparing; cache resources and probe answer storage |
| Preparing | All bytes/digests/storage/shell pass | Prepared; persist final commit marker |
| Preparing | Missing audio, quota or bad digest | Failed locally; preserve drafts; room continues |
| Prepared | Network lost | Offline working under cached schedule; show local-save status |
| Offline working | Deadline reached | Freeze outgoing section locally, persist frontier, enter gap/next authorized section |
| Offline working | Browser restarts | Validate same-device package, restore drafts and provisional clock; never re-award duration |
| Offline working | Last deadline reached | Locally completed, pending server reconciliation |
| Any local state | Authoritative pause/termination/lease change received | Apply control, freeze/reconcile affected drafts; no fallback to stale cached permission |
| Reconnecting | Snapshot/credentials agree and window open | Drain normal eligible writes through existing API |
| Reconnecting | Section/control/lease conflict or deadline passed | Preserve rejected writes as evidence; continue other eligible scopes |
| Any state | Server submission receipt received | Server-confirmed completion; retain evidence until its own acknowledgement |

## 4. Function-level design and algorithms

### 4.1 Build and resolve the committed timetable

Proposed Go contracts, owned by `internal/runtime/ielts_shared_schedule.go`:

```go
func BuildIELTSSharedSchedule(startAt time.Time, plan []PlanEntry, saveGrace time.Duration) (IELTSSharedSchedule, error)
func ResolveIELTSSharedWindow(schedule IELTSSharedSchedule, now time.Time) (IELTSSharedPosition, error)
func ValidateIELTSSharedSchedule(schedule IELTSSharedSchedule) error
```

`IELTSSharedPosition` is a proposed discriminated result: `before_start`, `working`, `save_only`, `gap`, `paused`, `complete`, with an optional window and next start. Validation rejects unsupported schemas, empty/duplicate section keys, non-positive duration, unordered/overlapping windows, invalid timestamps and unsupported IELTS sections. Speaking is excluded unless the authored delivery plan already supports it and explicit tests are added.

Build algorithm:

```text
start = server-authorized future room start
for each enabled PlanEntry in authored order:
    deadline = start + DurationMinutes * one minute
    saveUntil = deadline + existing IELTS ResponseSaveGrace
    append [start, deadline, saveUntil]
    start = saveUntil + GapAfterMinutes * one minute
```

Reuse the existing provider grace rule; do not turn `closing_grace_until` into extra working time. Confirm `ResponseSaveGrace` aliasing when implementing: the current working-tree policy file specifies 3 seconds, while other contracts also have a 30-second closing grace. Tests must pin which gate/window is used and prevent these from drifting.

For half-open working windows, `start <= now < deadline` permits edits. At exact deadline stop edits; save grace drains already accepted writes. During authored gaps no section is editable. After the last deadline, no new answers are accepted locally.

At room Start, select a future start using a proposed fixed 10-second delivery lead, persist the full timetable in the existing transaction, project initial section/attempt clocks and emit the outbox wakeup. The lead is a room-wide constant, never computed from the slowest student. Missing readiness must not postpone it. Validate positive authored durations before committing anything.

### 4.2 Make all server readers use the same schedule

For the new model only:

- `ReadyCohortSection`: authenticate and record device preparation; return the scheduled window. It does not allocate, re-arm or extend a clock.
- `reconcileDueSectionsSQL`: select due new-model rooms from committed schedule windows even if the projected active row is locked, has no actual start, or has not advanced. Preserve the old query predicates for other timing models.
- `planSectionAdvance` / `startSectionEffect`: materialize schedule timestamps exactly, including catch-up after worker downtime. Never substitute reconciler `asOf` for a scheduled start, and never put a scheduled successor back behind a readiness barrier.
- Runtime snapshot and `student_context.go`: resolve the effective section at server time, even if the background row projection is behind.
- `v2Locker` and `attempts.RuntimeGate`: carry committed schedule authority into the normal response transaction. `ensureWritable` and `ensureQuestionAdmitted` validate the server-resolved window for this model. They must not rely on a stale projected current section/deadline when a worker is late.
- `SyncV2TimingInTx`: maintain the existing attempt projection, epochs and compatibility fields. A projection retry must not bump epochs repeatedly for the same transition; guard by the already materialized section/revision under locks.
- Completion: normal room completion cannot wait for missing device uploads. Late local work remains eligible for evidence ingestion under existing authorization, never for implicit reopening.

Mutation order stays the existing schedule -> attempts -> runtime -> sections order used by these flows. Readiness, worker, proctor and response transactions must serialize on the same existing owner rows. Do not introduce a process-local lock as a correctness mechanism.

### 4.3 Pause, resume, extension and early end

Add proposed pure helpers beside the timetable owner, then call them only inside existing control transactions:

```go
func PauseIELTSSharedSchedule(schedule IELTSSharedSchedule, now time.Time) (IELTSSharedSchedule, error)
func ResumeIELTSSharedSchedule(schedule IELTSSharedSchedule, pausedAt, now time.Time) (IELTSSharedSchedule, error)
func ExtendIELTSSharedSection(schedule IELTSSharedSchedule, sectionKey string, extra time.Duration, now time.Time) (IELTSSharedSchedule, error)
```

Pause records the existing server-owned pause instant and changes schedule status/revision; resume shifts the unfinished active deadline and all future windows by the credited pause duration. A pause before the first start shifts every window. Completed windows never change. Extension adjusts the active deadline/save window and every successor by the same positive duration. Early end uses the existing proctor command: freeze/end the current section, explicitly recompute successors or mark the schedule ended, and increment schedule revision atomically.

Duplicate commands must use existing revision fences and return existing conflict/idempotency behavior; do not shift windows twice. Write schedule, section/attempt projection, audit and outbox in one transaction. Disconnected devices continue their previous revision provisionally; reconciliation detects disagreement. Proctor UI must show that offline devices may still be following the old timetable.

### 4.4 Prepare a durable package

Proposed `prepareIeltsOfflinePackage(manifest, staticPayload, identity, signal)` lives in `src/features/student/application/ieltsOfflinePreparation.ts` and calls proposed infrastructure `ieltsOfflinePackageStore.ts` / `ieltsOfflineMediaCache.ts`.

```text
validate schema, identity, pinned version, schedule, media bounds and server-issued descriptors
write incomplete package record
ensure required shell build assets are installed
persist mapped static content and minimal attempt bootstrap, excluding credentials
for every required media resource:
    fetch with existing authorized delivery mechanism while online
    require successful, readable response; verify byte count and SHA-256
    cache bytes under version/revision-bound key
read back JSON and media, verify digests and answer-store probe
write ready marker last
return prepared(packageKey) or failed(reason); never mutate the room schedule
```

Use bounded concurrent media fetches (proposed maximum 2), cancellation, per-resource failure messages and an explicit retry. Do not cache opaque responses as verified audio. A signed URL expiring after download must not invalidate already verified cached bytes; cached identity uses media revision/digest rather than URL alone. Determine maximum package bytes from authored resource sizes and available storage estimate; quota refusal leaves the student online-only and informs the proctor.

### 4.5 Resolve the local section without inventing authority

Proposed `resolveIeltsOfflinePosition(schedule, estimatedServerNowMs)` is a pure TypeScript equivalent of the server resolver. Feed both resolvers the same test vectors.

Proposed clock anchor:

```ts
type IeltsClockAnchor = {
  serverNowMs: number;
  receivedWallMs: number;
  monotonicAtReceiptMs: number;
  lastEstimatedServerNowMs: number;
};
```

Within one page lifetime, estimate server time from anchor + `performance.now()` delta, clamp so it never moves backward, and account for elapsed wall time across suspension without awarding extra time. Compare wall and monotonic deltas; a material disagreement (proposed 5 seconds) marks clock uncertainty rather than resetting a deadline. An offline full restart cannot reuse a previous process's monotonic origin: estimate from persisted wall elapsed time, clamp against the persisted last estimate and mark clock-unverified. A backward wall clock must not add time. Forward uncertainty may force local completion; staff recovery handles actual lost working time.

`StudentRuntimeProvider` consumes a derived effective runtime for the new model instead of maintaining a separate mutable current-section counter. Keep the last authoritative snapshot and offline projection visibly distinct. Local transitions never impersonate a newer server revision. Stale incoming snapshots must not rewind section progress within the same schedule revision; a newer schedule/control revision requires explicit reconciliation.

Add a proposed network-independent engine contract, `checkpointScopeLocally(scopeId): Promise<{ durable: true } | { durable: false; reason: string }>`, beside existing scope methods. It waits for accepted edits in that scope to finish checkpoint/durable persistence and verifies their recoverable frontier without fetching a snapshot or calling network drain. Do not use `flush()` as this barrier: it can wait on network work, and returning from flush does not itself prove every visible answer is durable.

At a boundary, synchronously freeze the old scope, call `checkpointScopeLocally` and verify durable persistence. Do not require network acknowledgement before opening a prepared authorized successor. If local persistence fails, block only this device with `storage_unavailable`; everyone else follows the schedule.

### 4.6 Offline bootstrap and app shell

Store the package while still authenticated/online. On reload, use offline fallback only for a network failure, matching previously admitted local identity and valid prepared package. Explicit server 401/403/404, terminal/transfer responses or successful reads withholding admission must never turn into cached exam access.

A proposed service worker handles only student exam navigations (`/student/:scheduleId/:studentId`) and immutable app build assets needed by that route. It must never cache API, login, staff HTML, credentials or generic authenticated fetch responses. Generate an explicit student asset manifest during the Vite build; include all chunks, CSS, fonts and dynamic assets reachable from the exam entry. Audit the auth/router shell dependencies: an offline reload cannot wait for a network-only auth bootstrap before selecting the already admitted offline package.

Install/verify the package's build before showing prepared. Keep its worker/assets pinned while an exam is active; do not call `skipWaiting` or delete the active build during an exam. If the exact shell build is unavailable, show recovery guidance and preserve drafts; do not silently boot an incompatible build.

The service worker only makes the app shell available. The route still performs package/identity validation. First-time offline entry and another user's package must fail closed.

### 4.7 Answer recovery and reconnect

Reuse `DurableResponseEngine`; extend its existing optional scope support to IELTS section keys. Keep the original `writeId`, payload, clientVersion, lease and control provenance. Add optional persisted offline provenance (`scheduleRevision`, section key and clock confidence) to local records/evidence metadata; do not change normal V2 command identity or trust client timestamps.

Reconnect sequence:

```text
stop automatic draining while authoritative recovery is in progress
fetch current credential/session/runtime/response snapshots with existing renewal flow
apply known terminal/pause/transfer controls before enabling edits
recover pending writes and merge acknowledgements by exact write identity/version
for each scope/write:
    if its original era is still authorized and normal server gates permit it:
        drain with existing response batch API
    else:
        retain/quarantine it with a reason and offer existing evidence ingestion
continue eligible current scopes even if a previous scope needs review
persist acknowledgement/tombstone before clearing that exact local record
```

For the new model only, return scoped structured refusals from the normal gate: proposed `details.reason` values `IELTS_SECTION_CLOSED` and `IELTS_SECTION_NOT_OPEN`, carrying `sectionKey` and `questionId`, while retaining the applicable existing error code/status. An expired window uses the existing deadline-expired code plus scope details. Add a client classifier that quarantines only the named section and does not interpret arbitrary bad requests as safe evidence conflicts. The currently inspected section-mismatch branch is a generic 400 without these details; extending engine scoping alone is insufficient.

Use existing `recordRetainedEvidence()` / `RecordDraftEvidence`. Evidence ingestion requires a valid credential; a 401 retains data and requests reauthentication, a 403/fenced credential retains data and requests staff help, and a transient failure retries without clearing data. Never mint a new attempt or transfer writer ownership offline. Do not use SAT's frozen-module close endpoints for IELTS without an independently specified server authority contract.

At final local deadline, record a durable local completion marker and stop edits. On reconnect reconcile first, then request ordinary submission only if its invariants hold. If a server auto-submission already exists, display that receipt plus any pending-review evidence; never overwrite the sealed answer set. A pending-evidence state is not a submission failure requiring the room to remain open.

### 4.8 Audio and recovery

Cached audio is usable only for the matching part/media revision and current attempt/lease/run generation. Restore local playback checkpoints bound to those identities. Reuse existing listening playback policy; caching does not grant replay, seeking, restarting the track, or extra section time. Persist checkpoints locally during disconnection, reconcile against server checkpoints on reconnect, and retain a monotonic sequence/position consistent with the existing allowed-seek policy.

Browser autoplay restrictions can require a resume gesture after restart. Show that action and report the incident to the proctor; do not declare a device ready solely because an `<audio>` element once had buffered data.

Same-browser crash recovery restores local data. Different-device recovery follows existing staff grants and writer fencing; absent browser storage cannot magically transfer unsynced answers. Explicit staff compensation may use existing recovery clock machinery, but ordinary room students still share one timetable and no automatic disconnect-based compensation is added.

## 5. File map and implementation sequence

Paths below are repository-relative for execution. Existing owners are verified above; every **Create** entry is proposed. Resolve the next migration number before creating it.

### Task 1: Lock down contracts and timing-model compatibility

**Modify:** `backend/go/internal/runtime/timingmodel.go`, `backend/go/internal/schedules/service.go`, `src/types/domain.ts`, `src/services/backendBridge.ts`.

**Create:** `backend/go/internal/runtime/ielts_shared_schedule.go`, its `_test.go`; `src/features/student/domain/exam-session/ieltsSharedSchedule.ts`, its test under `__tests__`.

- [ ] Add failing Go/TypeScript table tests for exact start/deadline/save-only/gap/final boundaries, malformed schedules and identical shared windows.
- [ ] Add the proposed model and schedule types; define server/client validation and pure resolution.
- [ ] Add an explicit new-room rollout choice, proposed `IELTS_SHARED_SCHEDULE`, default off. Reject conflicting shared/personal flags when creating a new IELTS room; do not silently choose one.
- [ ] Extend the TypeScript timing-model union and backend mapping deliberately; unknown models must not silently become legacy on new clients.
- [ ] Verify old null, legacy, IELTS personal v1/v2 and all SAT selections still resolve identically. Reject selecting the IELTS model for SAT/ACT.
- [ ] Run `go test ./internal/runtime ./internal/schedules` from `backend/go`; run the new pure resolver test with `bunx vitest run` from the repository root.

Representative shared test vector to implement in both languages:

```json
{"sectionKey":"reading","startAt":"2026-10-30T03:00:00Z","deadlineAt":"2026-10-30T04:00:00Z","saveUntil":"2026-10-30T04:00:03Z"}
```

At 02:59:59 -> before_start; 03:00:00 -> working; 04:00:00 -> save_only; 04:00:03 -> next section if its start equals that instant, otherwise gap/complete. Edit allowance never includes the save-only interval.

### Task 2: Persist and activate the room timetable

**Create:** next migration `ielts_shared_schedule` adding nullable JSON on runtime; proposed `backend/go/internal/runtime/ielts_shared_schedule_mysql_test.go`.

**Modify:** `backend/go/internal/runtime/service.go`, `cohort_readiness.go`, `snapshot.go`; `backend/go/internal/proctor/reconcile.go` and relevant reconciliation tests.

- [ ] Add an integration scenario: proctor starts a room, no students call `/ready`, database time crosses a boundary, and room/student snapshots still resolve to the scheduled successor.
- [ ] Persist the timetable at Start in the existing fenced transaction. Use the same timestamps in section/attempt projections.
- [ ] Make readiness read/report the committed schedule for this model only; remove clock allocation from that branch.
- [ ] Extend due-room selection for schedule-backed rooms, including locked/stale projections. Materialize due transitions idempotently from absolute schedule windows. Catch up across multiple elapsed sections without granting fresh durations.
- [ ] Make snapshot reads derive the effective window when the worker is delayed; preserve lifecycle audit/outbox behavior.
- [ ] Inject a transaction failure after schedule persistence and prove schedule/start/projections/events all roll back.
- [ ] Run runtime/proctor tests and real-MySQL tests with an isolated migrated `TEST_MYSQL_DSN`. A skipped MySQL test is not acceptance evidence.

Proposed migration core (use the repository's migration format and actual next number):

```sql
ALTER TABLE exam_session_runtimes ADD COLUMN ielts_shared_schedule JSON NULL;
```

Add only schema changes actually required by inspected timing-model constraints. Do not add a shadow schedule table or per-student deadlines.

### Task 3: Enforce the same schedule on answer writes and controls

**Modify:** `backend/go/cmd/api/handlers_v2.go` (`v2Locker`); `backend/go/internal/attempts/service.go` and its gate tests; `backend/go/internal/runtime/service.go`; `backend/go/internal/proctor/service.go`, `reconcile.go`.

**Create:** proposed shared-schedule control/gate integration tests under `backend/go/cmd/api`.

- [ ] Add a failing test where section projection is deliberately stale but the committed schedule is in Writing: Reading writes are refused and valid Writing writes pass under the normal credential/epoch contract.
- [ ] Add the structured IELTS section-refusal details specified in section 4.7 and contract-test their section/question ownership.
- [ ] Pass committed schedule data through the existing transaction gate and use the pure resolver at database/server decision time. Do not let this model accidentally enter the personal-clock SQL lists.
- [ ] Implement pause/resume/extension/early-end schedule amendment helpers and invoke them inside existing fenced control transactions.
- [ ] Prove every connected ordinary student's amended deadline is identical, completed windows are unchanged, and duplicate controls cannot add time twice.
- [ ] Race readiness/response/projector/proctor operations on InnoDB with deterministic start barriers; assert one committed transition, no extra epoch bump and no post-terminal writes.
- [ ] Preserve existing `SaveResponses` replay semantics and immutable submitted answers. Run attempts/runtime/proctor/delivery unit suites plus real-DB gate tests.

### Task 4: Deliver the authenticated manifest and durable package

**Modify:** `backend/go/cmd/api/student_context.go`; `src/services/backendBridge.ts`; `src/features/student/hooks/useStudentSessionRouteData.ts`; `src/features/student/hooks/useIeltsSectionPreparation.ts`; `src/components/student/StudentApp.tsx`.

**Create:** `src/features/student/application/ieltsOfflinePreparation.ts`; `src/features/student/infrastructure/ieltsOfflinePackageStore.ts`; `ieltsOfflineMediaCache.ts`; colocated unit tests for all three.

- [ ] Add contract tests that manifest identity/version/windows agree with the authoritative runtime and that unauthorized sessions receive no package/content.
- [ ] Add the manifest to authenticated live reads; include pinned content/media digests and byte sizes from trusted published content/media metadata. Never accept a client-provided media URL as server authority.
- [ ] Implement incomplete -> prepared commit ordering and read-back verification. Use `saveDurableDraft` for JSON and Cache Storage for media; keep answer ownership untouched.
- [ ] Exercise quota failure, partial download, corrupt bytes, expired URL, cancellation, wrong version/lease/user and crash before the commit marker.
- [ ] Make preparation status device-specific. A failed package never changes the room's start/end times or another student's readiness.
- [ ] Verify required audio is fully cached/decodable, rather than merely reporting a nonempty URL or a buffered first frame.
- [ ] Run preparation/storage/manifest tests and TypeScript. Only report prepared after every prerequisite succeeds.

### Task 5: Make offline reload possible

**Modify:** `vite.config.ts`, `src/main.tsx`, `src/features/student/routes/StudentSessionRoute.tsx`, `src/features/student/application/exam-session/studentSessionBootstrap.ts`, `src/features/student/hooks/useStudentSessionRouteData.ts`; inspect/update the existing auth bootstrap boundary in `src/features/auth/authSession.tsx` as needed.

**Create:** `public/ielts-offline-sw.js`; proposed `src/features/student/infrastructure/ieltsOfflineShell.ts`; offline bootstrap and worker tests.

- [ ] Write a production-build browser test: install prepared exam package, close the page, disable network, reopen the same student URL, and render restored exam content/drafts.
- [ ] Emit and install a versioned asset manifest for the student route graph. Restrict fetch interception to exam navigations and listed immutable assets.
- [ ] Add explicit package-based offline bootstrap only after a network failure and local identity validation. Treat known server denials as authoritative even if a cache exists.
- [ ] Ensure auth bootstrap does not block the authorized offline route indefinitely; cached exam access must not grant access to staff routes or general account data.
- [ ] Test expired/no package, another user's browser identity, explicit 401/403/404, first-time offline entry, unavailable shell build and a new deployment during an active exam.
- [ ] Verify worker update does not activate over the active exam or evict its build. API responses must remain absent from worker caches.

### Task 6: Traverse shared sections locally and restore audio

**Modify:** `src/components/student/providers/StudentRuntimeProvider.tsx`; `src/features/student/domain/exam-session/runtimeReconciliation.ts`, `blockingPolicy.ts`; `src/components/student/StudentApp.tsx`, `StudentListening.tsx`; `src/features/student/infrastructure/audioCheckpointGateway.ts` and `src/features/student/hooks/useListeningCheckpoint.ts` at the playback/checkpoint boundary.

**Create:** proposed `src/features/student/application/ieltsOfflineRuntime.ts`, pure clock tests and provider integration tests.

- [ ] Add fake-clock tests for disconnect immediately before a boundary; assert the prepared next section opens at the committed timestamp with no `/ready` dependency.
- [ ] Implement the anchored clock and shared resolver projection. Do not decrement an independent per-student allocation or persist a restartable remaining-seconds timer.
- [ ] Freeze/checkpoint the outgoing scope locally, enter save-only/gap correctly, and open the successor only when content/media/store are prepared.
- [ ] Resume from a cached same-browser package with clock confidence marked provisional after full offline restart. Test backward/forward clock changes, hidden tabs and OS sleep.
- [ ] Integrate offline media source selection/checkpoint restore through existing listening components without granting extra replays or seeking rights.
- [ ] Ensure stale socket/poll snapshots cannot rewind a locally projected section; newer control revisions enter reconciliation.
- [ ] Test missing audio or a storage failure blocks only that student, with accessible recovery text and a proctor-visible incident.

### Task 7: Reconcile answers and local completion without losing work

**Modify:** `src/shared/durability/DurableResponseEngine.ts`, `types.ts`; `src/features/student/infrastructure/responseDurabilityTransport.ts`; `src/components/student/providers/StudentAttemptProvider.tsx`; `src/components/student/useStudentSubmissionOrchestration.ts`.

**Reuse:** `backend/go/internal/attempts/draft_evidence.go`, `backend/go/cmd/api/handlers_draft_evidence.go`. Change these only if bounded offline provenance requires an additive, validated field; do not alter scoring semantics.

- [ ] Add a durability test with a pending Reading answer, offline transition to Writing, then reconnect under a newer control epoch. Reading remains preserved/evidence-only; Writing recovery is not permanently fenced by Reading's closure.
- [ ] Implement/test the network-independent `checkpointScopeLocally` barrier with a deliberately hung transport; local section advancement must not wait for it.
- [ ] Add section scoping/provenance, structured IELTS refusal classification and wire the reconnect sequence from section 4.7 into the existing engine. Respect original versions/epochs and exact acknowledgement identity.
- [ ] On deadline/section conflict, quarantine retained data with a stable reason and upload evidence via the existing endpoint. No automatic promotion from evidence into scored answers.
- [ ] Persist local completion separately from a server receipt. If the room auto-submits before reconnect, show its receipt and outstanding evidence status without reopening the attempt.
- [ ] Test ack lost after commit, duplicate evidence upload, old answer arriving after newer answer, stale lease, expired credentials, server termination, storage failure during ack cleanup and a crash during replay.
- [ ] Confirm ordinary online submissions, SAT scoped response behavior and existing personal IELTS paths remain unchanged.

### Task 8: Proctor visibility, cleanup and operational verification

**Modify:** existing proctor session projection in `backend/go/internal/proctor`; existing session roster/details under `src/features/proctor`; `backend/go/internal/platform/telemetry/telemetry.go`; existing `src/utils/studentObservability.ts`.

**Create:** `docs/operations/ielts-offline-continuity.md`; proposed `e2e/ielts-shared-offline.spec.ts` and a production-preview Playwright configuration based on the current project conventions.

- [ ] Find the existing roster status writer/readers before editing; report per-device preparation/last-seen/pending-evidence without making them transition guards.
- [ ] Show “Saved on this device”, “Syncing”, “Saved to server”, and “Needs review” as distinct states. Never announce successful submission from a local marker.
- [ ] Before room control changes, display that disconnected students may still follow the old schedule; do not claim remote pause delivery has been confirmed.
- [ ] Add reason-coded metrics for preparation failures, transition lag, cache restore, clock uncertainty, evidence counts and delayed projection. No answer content, candidate names or signed URLs in telemetry.
- [ ] Cleanup package/content/media after server-confirmed completion and acknowledged evidence under the institution's retention policy. Pending drafts/evidence are never purged by age or room completion. On logout block old-package access, but do not silently delete unsent work; require the existing authenticated/staff recovery path to recover it.
- [ ] Run the full multi-browser acceptance matrix below against the production build and real API/database. Record test artifacts and deployment flag values in the operations document.

Each task should finish with a focused reviewable commit when executing in a clean implementation branch. The current checkout has unrelated edits; do not bulk-stage or commit them. No commits are created in this planning turn.

## 6. Worked scenarios

### A. Normal scheduled transition

Initial: timetable revision 1 commits Reading 10:00-11:00, save-only until 11:00:03, Writing 11:00:03-12:00:03. All times refer to the same room date/time zone; wire timestamps are UTC.

1. A and B prepare their packages online. Both display the same windows.
2. At 10:59:58 A disconnects. B stays online.
3. At 11:00 both freeze Reading edits and durably retain the latest accepted write. No new Reading answer can use the save-only interval as extra work time.
4. At 11:00:03 B opens Writing from the live schedule and A opens Writing from its cached schedule. The server projects the same start regardless of readiness messages.
5. A reconnects at 11:02. The current authorized response snapshot is loaded before drain. Eligible writes use the normal API; expired Reading writes are uploaded as evidence.
6. Final: B never waited; A's saved work exists either as ordinary acknowledged answers or explicitly reviewable evidence; neither received a new duration on reconnect.

### B. Crash during the boundary, then offline reload

1. A has prepared resources and completed a durable answer checkpoint at 10:59:59, then the browser process crashes.
2. A opens the same URL at 11:05 without network. The pinned shell loads; identity/package validation succeeds.
3. The previous monotonic origin is discarded; provisional server time is estimated from the persisted anchor and marked clock-unverified. Writing opens with approximately 55 minutes remaining, not 60.
4. Cached answers restore under their original write identities. If the package or shell is incomplete, show local recovery guidance and retain drafts; B and the room are unaffected.
5. After reconnect, authoritative time/control wins. Actual crash time is not automatically credited.

### C. Room pause while A is offline

1. A disconnects under revision 1. Proctor pauses the room online, committing paused revision 2 and fencing ordinary writes.
2. B pauses immediately. A cannot observe the event and continues provisionally under revision 1.
3. On reconnect A receives paused revision 2 before drain. Editing stops; conflicting writes remain evidence, not accepted by fabricated timestamps or a relabeled epoch.
4. Resume commits revision 3 with a common shifted timetable for all normal students. Staff handles any fairness exception explicitly.

### D. Lost acknowledgement and delayed projector

1. The server commits a response; its acknowledgement is lost. The device retains that exact write.
2. A worker is delayed across the next boundary, so section projection rows still describe Reading.
3. Live reads/write gates resolve Writing from committed schedule JSON at server time. No late Reading editing becomes permitted because of the stale rows.
4. Replayed exact writes follow existing idempotency behavior. A stale payload cannot overwrite a newer response. The eventual projector writes the scheduled times and bumps each transition once.

## 7. Acceptance and verification matrix

All new tests below are planned, not executed by writing this document.

| Scenario | Layer | Required evidence |
| --- | --- | --- |
| Missing one/all readiness reports | Go integration + two browser contexts | Room and B use scheduled start; A's absence adds zero schedule delay |
| Two readiness requests race | InnoDB integration | One shared start/transition; identical returned timestamps and no repeated epoch bump |
| Worker/API restart across boundaries | Go integration | Effective reads/gates correct before materialization; catch-up uses original windows |
| Disconnect 2s before section change | Browser production build | Prepared A and online B advance to identical window; no online gate on A |
| Hard reload offline | Browser process/page restart | Shell, exact version and durable answers restore; remaining time not reset |
| Missing/corrupt/partial audio | Unit + browser | Not prepared on A; B/room progresses; no unverified media plays |
| Audio autoplay/checkpoint recovery | Browser | Required gesture shown, revision/lease/run preserved, no new playback allowance |
| IndexedDB/Cache Storage quota/failure | Fault injection | Honest local failure state; pending writes preserved; no room hold |
| Duplicate/out-of-order response/evidence | API + engine | Exact replay dedupes; old version cannot replace newer; changed payload under same write conflicts |
| Room pause/extend/end while offline | API + browser | Known controls apply before drain; old schedule work retained, never silently scored |
| Stale lease/device transfer | Security regression | Cached package cannot authorize the new writer or replay old-lease writes |
| Explicit auth denial with cached package | Route/security | No cached admission fallback; no staff-route access |
| Wall-clock change/suspend/restart | Pure clock + browser | No fresh allocation; uncertainty marked; server timestamps remain grading authority |
| Local exam complete after server auto-submit | Browser + DB | Pending-review status retained; sealed answers unchanged; server receipt distinguished |
| New deployment/worker update | Browser production build | Active build kept until safe switch; no lost cache/drafts |
| SAT/ACT and old IELTS room | Existing regression suites | No changed timing model, response gate or submission behavior |

### Commands for execution

From `backend/go`:

```bash
go test ./internal/runtime ./internal/schedules ./internal/proctor ./internal/attempts ./internal/delivery ./cmd/api
```

Run the new MySQL tests using a separately provisioned, fully migrated isolated database and `TEST_MYSQL_DSN`; never point them at an exam database. Existing tests skip without that variable. Run the new concurrency tests with `-race` where supported; race-detector success does not prove InnoDB interleavings.

From repository root:

```bash
bun run typecheck
bunx vitest run src/shared/durability src/features/student src/components/student/providers/__tests__ src/components/student/__tests__/useStudentSubmissionOrchestration.test.tsx
bun run build
bun run test:student-bundle
bunx playwright test e2e/ielts-shared-offline.spec.ts --config playwright.ielts-offline.config.ts
```

The E2E test and dedicated config are proposed Task 8 artifacts. Use a production preview on a service-worker-capable origin, not Vite development HMR, and at least two independent browser contexts. Include actual full navigation/reload while network is disabled; an in-memory React remount is insufficient.

Run ESLint on files changed by the implementation. If baseline failures exist, report exact files/errors and compare against the baseline; do not silently waive a failing changed path.

## 8. Rollout, rollback and completion gates

1. Deploy additive schema and server readers first, with new-room selection off. Old servers must not serve rooms using an unknown timing model; keep compatible routing during rollout.
2. Deploy client/package/worker support. Require an explicit supported-client capability for creating/starting new-model rooms; older clients get a clear update-required outcome, never a fallback into legacy clocks.
3. Enable an internal rehearsal room. Confirm the evidence-review staffing/policy, future-content exposure policy and target-browser media/storage behavior before expanding.
4. Enable only newly created IELTS rooms selected for the shared timetable. Keep personal-timing flags disabled for these rooms. Existing rooms retain their stored models until finished.
5. Observe transition lag for online B, preparation failures, clock uncertainty, unsynced/evidence backlog and server gate rejections. Compare against an online control room with the same authored durations; do not invent throughput or delay claims.
6. Roll back new-room selection if any student gets a reset deadline, an unauthorized cache is opened, acknowledged work disappears, evidence overwrites scored answers, or an offline device delays the room. Preserve compatible server/client support for already active new-model rooms until they finish.
7. Never roll back an active room by rewriting it to legacy or personal clocks, dropping the schedule column, or deleting cached drafts. Stop new admissions/enable staff intervention if an active-room issue occurs.

**Completion gates:** all FR/INV rows have passing evidence at the stated layer; real-MySQL concurrency runs are not skipped; production-build offline restart and missing-audio cases pass; grading/review and future-content policies are documented; operations can recover one student without pausing the room.

## 9. Extensibility and remaining risks

A later change to room delivery lead or authored gap calculation belongs in `BuildIELTSSharedSchedule` and shared fixtures, not every browser. A future institution-approved automatic late-upload policy would require a separate trusted ingestion/receipt design; it must not be implemented by loosening `ensureWritable`, accepting client timestamps, or changing the evidence ledger into scored answers.

Implementation-time checks still required: exact media digest/size availability and CORS behavior; existing listening player's checkpoint/seek policy; target browser support/storage limits; auth bootstrap offline selection; timing-model constraints in migrations/readers; and the existing proctor UI location for evidence review. Each has an owning task above. Until these checks pass, the corresponding capability stays off; no unsupported guarantee is inferred from the partial readiness patch.

The central separation is permanent: **the room timetable controls progression; device health controls only that device's preparation/recovery; server authorization controls which uploaded answers become official.**
