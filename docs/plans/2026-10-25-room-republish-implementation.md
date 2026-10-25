# Republish an existing room — low-level implementation plan

Date: 2026-10-25. Status: plan only; no application changes or tests executed.

## 1. Change boundary and repository evidence

Current behavior: creating a room captures or reuses an immutable exam release. Later authoring changes do not update existing rooms. Desired behavior: an explicit **Republish** action updates one existing room to the latest saved exam, preserving the student URL and room configuration, before the exam starts.

Scope inference: the requested Rooms surfaces are the existing SAT exam workspace and SAT room page. These are implemented by `SatAccessRoute` / `StudentLinksDashboard` and `SatSessionRoomRoute`. The repository name includes IELTS, but the inspected one-action room workflow is SAT-only. Do not silently extend this operation to IELTS or ACT.

Verified implementation boundaries, paths relative to the repository root:

| File / symbol | Verified behavior and implication |
| --- | --- |
| `src/products/sat/routes/SatAccessRoute.tsx`, `StudentLinksDashboard.tsx` under `src/features/exam-authoring/ui/access-links/` | The exam's Rooms tab uses the access distribution overview. Dashboard owns row actions, pending feedback, shared workspace values, and room creation. |
| `src/features/exam-authoring/ui/access-links/AccessLinkRow.tsx` | Whole-row button opens the room. Overflow actions are siblings, avoiding nested buttons. Add Republish as a sibling control and retain this interaction contract. |
| `src/products/sat/routes/SatSessionRoomRoute.tsx`, `src/products/sat/ui/room/SatRoomHeader.tsx` | The room header accepts action elements. The route gets a reduced access-link projection through `useSatRoomEntryInfo` and reloads its controller after writes. |
| `src/features/exam-authoring/ui/publish/useCreateSatRoom.ts` | Flushes local coedit work, reads the committed shell and exam revision, submits once, retains an operation key, and recovers uncertain outcomes. Reuse this protocol for republish. |
| `backend/go/cmd/api/handlers_satrooms.go`, `backend/go/internal/satrooms/service.go` | Existing HTTP/domain boundary for release capture. `NeedsSeal`, `loadExam`, `loadDraft`, `loadRelease`, `covers`, `CreateRoom`, and receipt helpers already exist. |
| `backend/go/internal/exams/service.go` | `PreflightSATPublish` and `PublishDraftInTx` validate and seal content; `PublishEmission.Flush` runs after transaction outcome. Never publish with a separate committed request before rebinding the room. |
| `backend/go/internal/accesslinks/service.go` | Link and schedule are separate rows. `hasParticipation` includes registrations, and `metrics.started` counts all attempts. Neither means a student actually started. |
| `backend/go/internal/accesslinks/entry.go` | Admission locks the access link before the schedule. Preserve this order for republish. |
| `backend/go/internal/schedules/service.go:CreateScheduleAttempt` | Check-in creates a `lobby` attempt with `published_version_id` copied from the schedule. Waiting attempts must be rebound along with the room. |
| `backend/go/internal/runtime/service.go:Start` | Room start locks schedule, attempts, runtime, then reads exam state for planning. Its schedule/version/revision CAS already serializes start against schedule edits. |
| `backend/go/internal/delivery/sat_code_entry.go:codeStartTx` | Code start locks link, schedule, then attempt. It rejects attempt/schedule version mismatches. Preserve IDs and start-code state while updating waiting attempt pins. |
| `backend/go/internal/delivery/service.go:ensureBaseModuleAttempt` | Bootstrap can create a `not_started` module attempt before exam start. Current seeding reads and inserts without an encompassing version-fenced transaction. Republish needs a fence here. |
| `backend/go/migrations/0088_sat_room_operations.sql`, `0089_sat_room_response_snapshot.sql` | Existing per-actor operation receipts store exact JSON responses and survive room deletion. Reuse this table; no new migration is planned. |
| `backend/go/internal/exams/sat_route_policy.go:PersistSATSession` | Validates practice/classroom plans and forced routes against a version. Revalidate the existing session choice against the new release. |
| `backend/go/internal/assessmentforms/service.go`, migration `0101_assessment_forms.sql` | Registration answers can exist before exam start and are interpreted through the attempt's pinned version. They must not be deleted or silently reinterpreted. |
| `src/features/student/hooks/useStudentSessionRouteData.ts` | Existing live version mismatch handling reloads static context. |
| `src/features/student-delivery/hooks/useSatExamController.ts` | Bootstrap is keyed by identity and static version; polling retains content and compares revisions. Verify a version switch replaces old module identities and cannot be undone by a delayed old response. |

No redesign of room creation, no new room, link, schedule, roster, or start code, no updates to other rooms, and no changes to an immutable release in place.

## 2. Requirements and invariants

| ID | Acceptance criterion | Authoritative owner |
| --- | --- | --- |
| FR-1 | Each room in the exam's Rooms tab and the room page offers Republish to authorized exam editors. | Shared frontend flow; server authorization |
| FR-2 | Republish captures the latest saved draft, or reuses the current published release when no capture is needed. Only the selected room changes. | `satrooms.Service` and existing exam publishing functions |
| FR-3 | Confirmation reads: “Update this room to the latest saved exam? The student link and room settings will stay the same.” Cancel performs no mutation. | Shared confirmation component |
| FR-4 | With no saved changes for this room, the button is disabled with visible “Already up to date” explanation. An untouched reopened draft does not count as an update. | Server-derived advisory status; transaction recheck |
| RULE-1 | Waiting students may remain checked in. Reuse their registration, attempt ID, candidate identity, session credentials, and writer lease. Their next content load uses the new release. | Republish transaction; bootstrap refresh |
| RULE-2 | Once any start has committed, reject republish even if confirmation opened earlier. Submitted/terminated/cancelled attempts are never reset. | Locked schedule/runtime/attempt guard |
| RULE-3 | Selected sections and their effective delivered set remain unchanged. Reject a new release that would narrow or widen that set. | Republish compatibility check |
| RULE-4 | Preserve name, link ID, schedule ID, audience, roster, availability window, lifecycle state, timing/start mode, start code and generation, classroom mode, and route policy. | Narrow SQL updates |
| ERR-1 | Stale exam, draft, room, or schedule fences produce a conflict; refresh and reconfirm rather than publishing newer unseen changes. | Domain transaction |
| ERR-2 | Invalid exam/media/section/session compatibility produces an actionable refusal, leaving both room and exam publication state unchanged. | Existing publish checks plus room compatibility checks |
| INV-1 | The link, schedule, and every rebound waiting attempt reference the same release after commit. Every referenced module belongs to that release. | One database transaction and seeder fence |
| INV-2 | Same actor/key/body replays the original receipt, even if students subsequently start. Same key with a different action, link, or body conflicts. | Existing operation ledger, action-specific request hash |
| INV-3 | Publication, room rebinding, waiting-attempt changes, wakeups, and receipt commit together. Any failure rolls everything back. | `tx.Runner` |
| INV-4 | No accepted exam answer, form answer, result, audit evidence, or started module is deleted to make republish succeed. | Eligibility guard and constrained cleanup |
| INV-5 | A delayed old bootstrap cannot seed old modules after rebinding or replace newer client state. | Delivery seeder and frontend revision/version gates |

Safety interpretation: room-wide Start counts as the exam having started even if no candidates are present, because it creates a live runtime with a fixed plan. Only a `scheduled` schedule without an actual runtime is eligible. A UI `not_started` snapshot is not proof of this condition. Do not reset an already opened runtime.

Derived content, including authored questions, durations, score-report settings, and forms, follows the captured release. These are exam content, distinct from preserved room configuration. Compatibility failures must explain the affected setting.

## 3. Entities, ownership, and transitions

| Owner / state | Responsibility |
| --- | --- |
| `satrooms.Service` | Orchestrates capture/reuse, authoritative eligibility, room compatibility, atomic rebinding, and receipt replay. |
| Existing exam entity/draft/version rows | Authoring head and immutable released content. Existing publish owner retains validation and lifecycle events. |
| `assessment_access_links` and `exam_schedules` | Room identity/configuration; only their version pins and revisions/timestamps change. |
| Existing `student_attempts` | Waiting candidate identity/credential authority; version pin, revision, and control epoch change during rebind. |
| Existing `assessment_module_attempts` | Release-specific module IDs. Only empty, never-started seeds may be removed and recreated by the normal delivery seeder. |
| Existing `sat_room_operations` | Durable acknowledgement/recovery; no new persistence owner. |
| Proposed shared `useRepublishSatRoom` / `SatRepublishRoomDialog` | One submission/recovery state owner consumed by both staff surfaces. |

| Current state | Event / guard | Outcome |
| --- | --- | --- |
| Eligible, older room release | Confirm using current fences | Capture/reuse latest content and atomically rebind the room and waiting attempts. |
| Already current, no edited draft | Advisory status or new POST | Disable in UI; server returns current receipt without changing pins/revisions or minting a release. Record a replayable no-op acknowledgement if a POST reached the server. |
| Eligibility changed after confirmation | Start or terminal state wins | Reject; no publication or rebinding survives. |
| Same operation committed | Retry or recovery lookup | Return stored acknowledgement without rerunning start/validation checks. |
| Transport outcome unknown | Retry/status lookup | Keep the original key and exact request. Never mint a new update automatically. |

## 4. Function-level design

All new names and routes below are **proposed**. Listed existing files and symbols above were inspected.

### Backend contracts and reads

Add `backend/go/internal/satrooms/republish.go` and TypeScript `src/features/exam-authoring/contracts/satRepublishRoom.ts`.

Proposed command:

```ts
interface RepublishSatRoomRequest {
  operationKey: string;
  expectedRoomRevision: number;
  expectedScheduleRevision: number;
  expectedPublishedVersionId: string;
  expectedExamRevision: number;
  expectedDraftVersionId: string; // empty asserts no draft
  expectedDraftRevision?: number;
}
```

No caller-supplied target version, section list, roster, or replacement room settings. The server derives these from the locked room and committed exam head. Mirror this shape in Go, using pointers for required revision fields so omission cannot be mistaken for zero.

Proposed routes under the existing `/api/v1/sat` group:

- `GET /exams/{id}/rooms/republish-status`: one authorized, bounded-by-existing-room-list query for all this exam's rooms; both screens share the query by exam ID. Return a map keyed by link ID, exam/draft fences, each room's pin and room/schedule revision, `ready | up_to_date | started | incompatible | unavailable`, and an explanation. Avoid a GET per row and avoid object-store/media validation during polling.
- `POST /exams/{id}/rooms/{linkID}/republish`: required fences and operation key; returns the existing `satrooms.Result` / `SatRoomReceipt` shape. Successful fresh and replay requests return 200.
- Reuse `GET /room-operations/{operationKey}` for lost-response recovery; the stored receipt shape is compatible.

Proposed methods:

```go
func (s *Service) RepublishStatuses(ctx context.Context, examID string) (RepublishStatuses, error)
func (s *Service) RepublishRoom(ctx context.Context, actorID, examID, linkID string, req RepublishRequest) (Result, error)
```

`RepublishStatuses` is advisory and never mutates or seals. Its no-change decision uses the existing clean-draft definition: a revision-zero draft cloned from the current release can reuse that release. Comparing `isCurrentRelease` alone is insufficient when an edited draft exists. Share a private decision helper between status and write preparation; re-evaluate authoritative state under locks for POST.

HTTP handlers in `handlers_satrooms.go` require Admin/Builder, validate the exam through `Exams.GetForActor`, and verify the link belongs to that exam before invoking the command. Register exact policies in `internal/authz/table_fullpath.go` and the completeness list in `authz_policy_test.go`. Retain existing room-page restrictions: Admin receives the button there; proctors and observers cannot republish. Builders use the authoring Rooms surface unless existing router permissions already admit them to the room page.

GET belongs under the authenticated-read rate tier. The existing `/sat` route group applies a writes tier; move or locally register this read without inheriting that write budget. Preserve current routes' limits.

### Release capture and durable recovery

In `satrooms/service.go`, extract the existing locked release-resolution branches of `CreateRoom` into a private helper used by both commands. Preserve create behavior, create request hashes, existing operation keys, and exact stored responses. Preflight remains outside the transaction; check preflight version/revision under draft lock. Keep `AllowSeal` fail-closed when coediting was not frozen.

Reuse `claimReceipt`, receipt lookup, `recordedResult`, and response snapshot persistence. Republish's canonical hash includes `action: "republish"`, exam ID, link ID, and all request fences. Exclude the internal `AllowSeal` flag, as creation already does. Existing create hashes remain byte-for-byte compatible. Replay verifies command identity/hash before returning a stored receipt. No schema change or new ledger is needed.

The handler uses stored effective sections when deciding whether `coeditPublishGuard` is needed. A race between that hint and the transaction must produce a revision conflict; never seal without the guard. Use the same preflight and guard behavior as creation rather than implementing another publisher.

Use existing `CONFLICT` with `details.reason` for proposed room-specific refusals: `ROOM_STARTED`, `ROOM_REVISION_CHANGED`, `ROOM_CONFIGURATION_INCOMPATIBLE`, `ROOM_FORM_INCOMPATIBLE`, and `ROOM_ATTEMPT_NOT_REPUBLISHABLE`. Reuse `EXAM_REVISION_CHANGED`, `EXAM_NOT_READY`, `EXAM_SCOPE_UNAVAILABLE`, and operation-key codes. Map new reasons to republish-specific copy; creation's “Room not created” messages must not leak into this flow.

### Locked eligibility and mutations

Use explicit single-table lock queries for the existing room. Do not reuse the current joined `lockLinkTx` query unchanged: its joined exam/version locks can acquire those rows earlier than the established start order.

Lock order: receipt claim, link, backing schedule, attempts in stable ID order, existing runtime/section state as needed, exam entity, draft. Both admission and code start take link before schedule. Room-wide start takes schedule before attempts. Do not acquire link locks after holding schedule/attempt locks.

While holding the schedule and attempt locks:

1. Require matching exam/link/schedule relationship, all expected revisions, and expected source pin. Reject a non-SAT room, corrupt stored section scope, or non-`scheduled` schedule.
2. Require no runtime and no actual start evidence. Waiting attempts must be `lobby`, unsubmitted, nonterminal, without accepted start code, active/previously started modules, deadlines indicating start, or accepted exam responses. Do not use attempt count, `metrics.started`, or `hasParticipation` for this decision.
3. Guard module seeds and associated state: only pristine `not_started` modules with no timing/entry/route/boundary/response evidence are replaceable. Unexpected persisted work produces a refusal, not a cascade delete. Check both legacy question responses and V2 accepted-response storage before cleanup.
4. Resolve capture scope from the room's **effective old section set**, not `ScopeForSections(nil)` unconditionally. A legacy null selection on a narrow release must not demand a full exam or gain a new section accidentally.
5. Resolve/validate the candidate release through existing publishing functions. Require the raw preserved selection to deliver exactly the old effective section set under the new release; reject any automatic narrowing/widening. Revalidate existing practice/classroom/route choices through `PersistSATSession` with their existing values. Never change modes or force a new route to accommodate a changed exam.
6. Preserve registration form responses. If waiting students have stored answers, require the old/new applicable registration definition to be unchanged before rebinding. A changed definition could relabel sealed answers or bypass new required fields; return `ROOM_FORM_INCOMPATIBLE` rather than erasing answers or requiring a hidden re-check-in. Expose this specific restriction in the UI. Use the existing forms definition parser and section applicability helpers; no new form answer format.
7. Delete only verified-empty prestart module seeds; no attempt, credential, registration, form answer, or submission is deleted. The ordinary seeder recreates the new entry module on refresh.
8. Update the link's `published_version_id`, `revision`, and `updated_at`. Update only the schedule's matching pin, revision, and timestamp. Fence schedule update on prior status/version/revision and require one affected row. Preserve window, duration/window configuration, start mode/code, route settings, and names.
9. Update waiting attempts' `published_version_id`, revision, control epoch, and timestamp. Preserve attempt IDs, user/candidate identity, registration IDs, writer lease/session bindings, and credentials. The epoch rejects pre-republish client commands; do not rotate leases or expel students.
10. Enqueue existing `attempt_changed` and `roster_changed` wakeups with the new authoritative revisions in the same transaction via `outbox.EnqueueInTx`. Respect `outbox.SkipEnqueue` / `OUTBOX_EXEC_ONLY`; wire the existing config in `internal/app/app.go` as other services do. Do not emit a runtime-start event or create a runtime merely to refresh clients. Existing polling remains the fallback.
11. Read the final link projection, persist the exact receipt snapshot, commit, then flush publication emissions. Cache/query refresh failures after the receipt cannot turn a committed update into a failed operation.

No-op when already current: skip version capture, cleanup, row revision bumps, and wakeups. Persist only the operation acknowledgement. Replayed receipts can be older than the current room state; display the replay as acknowledgement and refresh current state rather than overwriting a newer cached row with an old receipt.

### Delivery seeding and student refresh

Change the existing `ensureBaseModuleAttempt` boundary in `internal/delivery/service.go`, covering its callers in `Bootstrap`, `EnsureBaseModuleAttemptForSchedule`, and `assembleBootstrap` in `start_submit.go`:

- Insert under a short transaction holding the attempt row. Check the attempt's current version equals the caller's prepared version before the existence check or insert.
- Use the transaction-bound querier for existence, plan validation, and insertion. The transaction locks only attempt and its module rows; do not acquire schedule/link locks after taking the attempt lock.
- Republish already holds schedule then attempt, so seed and rebind serialize. An old request arriving after rebind returns a typed version-change conflict without inserting anything. A new bootstrap must reread the version; never loop with the old prepared sections.
- Preserve the `(attempt_id, module_id)` uniqueness/idempotent insert behavior. New current-version requests seed normally. Adjust `seeder_contract_test.go` and bootstrap statement-budget assertions for the justified locked write.
- Ensure bootstrap snapshot assembly compares its prepared version with the current attempt version; restart the whole read once on version skew or return an explicit retriable version conflict. Do not return mixed old sections/new attempt metadata as a successful payload.

Frontend: reuse `maybeRebootstrapStaticOnVersionMismatch`, static-version bootstrap keys, and ordinary polling in the inspected student hooks. Test before adding another refresh channel. Extend `useSatExamController.acceptPayloadAndRoute` only where needed to order payloads across republish: compare monotonic attempt/control revision as well as runtime revision, and reject an old-version payload after a newer version/control epoch has been accepted. Clear retained old content/module selections on an accepted version switch while retaining the same identity and writer lock. Do not remount into student check-in.

## 5. Algorithm and failure branches

```go
// Proposed structure; helper names are illustrative until implemented.
func RepublishRoom(ctx, actor, examID, linkID, req) (Result, error) {
    validateEnvelope(req)
    hash := hashRepublish(examID, linkID, req)
    if committed := lookupActorReceipt(actor, req.OperationKey); committed != nil {
        return replayMatchingCommand(committed, examID, hash)
    }
    prepared := prepareAgainstCommittedRoomAndExam(examID, linkID, req)
    preflight := preflightOnlyIfSealNeeded(prepared)
    err := runner.WithTx(ctx, func(ctx, q) error {
        claimOrReplayReceipt(q, actor, req.OperationKey, hash)
        room := lockLinkThenSchedule(q, examID, linkID)
        waiting := lockAttemptsInIDOrder(q, room.ScheduleID)
        rejectStartedOrTerminalState(q, room, waiting)
        checkRoomAndScheduleFences(room, req)
        head := lockExamAndDraft(q, examID)
        checkHeadFences(head, req)
        target := resolveReleaseInTx(q, head, prepared, preflight)
        checkPreservedConfigurationAndForms(q, room, waiting, target)
        if target.ID != room.PublishedVersionID {
            removeVerifiedEmptySeeds(q, waiting)
            rebindPinsAndBumpRevisions(q, room, waiting, target)
            enqueueExistingWakeups(q, room, waiting)
        }
        return storeExactReceiptInTx(q, room, target)
    })
    emission.Flush(err)
    return committedResultOrError(err)
}
```

All helper failures propagate and roll back. Media preflight has no room write. Object-store failure, invalid questions, stale coedit head, incompatible route/form/sections, failed CAS, failed seed cleanup, failed outbox insert, or failed receipt storage leaves original pins intact and does not publish a new release.

Two independent keys for the same room serialize at the link. The loser fails its expected room revision instead of silently applying a different update. Same-key callers serialize at the receipt claim and replay. A lost response followed by a later draft edit still resolves to the original receipt; it must not publish the newer draft under the old key.

## 6. Concrete implementation sequence

1. **Contracts and tests:** add proposed `satrooms/republish.go` types, status/command cases, and `contracts/satRepublishRoom.ts`. Reuse `SatRoomReceipt`. Add unit tests beside `satrooms/service_test.go` for eligibility, no-change detection, section semantics, and typed reasons.
2. **Release helper:** extract only shared release resolution in `satrooms/service.go`; prove existing creation/replay tests unchanged before adding rebinding. Keep existing request hash bytes and stored snapshots compatible.
3. **Delivery fence:** update `delivery/service.go:ensureBaseModuleAttempt` and bootstrap version consistency; extend the inspected seeder tests. This must ship with republish because the current unlocked seeder would otherwise race cleanup.
4. **Transaction:** implement `RepublishRoom`, narrowly scoped pin updates, prestart seed cleanup, form/session compatibility, operation hash, receipt persistence, and existing outbox families. Add `SetOutboxExecOnly` configuration only if needed for consistency with current service wiring. No migration.
5. **HTTP/security:** add status and republish handlers in `handlers_satrooms.go`; register routes/rate tiers in `cmd/api/main.go`, policies in `internal/authz/table_fullpath.go`, and completeness coverage in `authz_policy_test.go`. Add request, tenant, membership, role, and missing-revision tests.
6. **Shared frontend flow:** add proposed `api/satRepublishRoomApi.ts`, `ui/publish/useRepublishSatRoom.ts`, and `ui/publish/SatRepublishRoomDialog.tsx`. Reuse `AuthoringConfirmDialog`, coedit flush helpers, committed shell refresh, and issue rendering. State union: `idle | preparing | confirming | submitting | succeeded | invalid | conflict | unknown | failed`; the unresolved state owns its frozen request/key. Add republish-scoped storage functions in existing `infrastructure/satRoomPendingAttempt.ts` without changing create-room keys; scope by actor/exam/link/action. Store only recovery key in session storage, retain body in memory, as creation does.
7. **Queries and reconciliation:** extend `api/accessLinkKeys.ts` and `api/authoringQueryEffects.ts` with a shared republish-status key and a targeted success effect. Refresh overview, room entry info (`['sat-room-entry-info', scheduleId]`), public link/version label, exam release/head when captured, status, and current schedule/controller. Receipt establishes success; refresh is best effort. Existing creation's error classifier is creation-specific; add a republish mapper reusing only shared envelope/issue parsing.
8. **Exam Rooms surface:** mount one shared flow in `StudentLinksDashboard.tsx`, use one status query for the exam, and add a visible Republish button beside each row through `AccessLinkRow` props. Update memo equality, reserved action space, pending label, and keyboard behavior. Keep the room-opening button and all action buttons as siblings. Disable on loading/unknown eligibility, already-current, incompatible, started, or in-flight state; give a visible reason. Only editor capability enables the action. Update shared workspace projection/reconciliation for version fields and monotonic revisions so an older shared `access/{id}` value cannot overwrite a new receipt/query result. Reuse an existing accepted workspace command after commit; no speculative new coedit protocol.
9. **Room page:** mount the same dialog/hook in `SatSessionRoomRoute.tsx` and add a Republish `SatButton` through the existing header action slot. Obtain command fences from republish status, not the reduced `SatRoomEntryLink`. Refresh entry info and `controller.reload()` after success. Do not offer for non-link-backed sessions or read-only roles. Disable conflicting Start/Republish actions locally while the request is pending; server locks remain authoritative.
10. **Copy and student regressions:** update inspected copy in `AuthoringWorkspace.tsx`, `SatCreateRoomFlow.tsx`, `AccessLinkEditorSheet.tsx`, and access-links README so the rule becomes “Existing rooms keep their exam until you republish them before the exam starts.” Add student version-switch/out-of-order regressions and only the smallest fixes they demonstrate.
11. **Real database and browser verification:** run the scenarios and commands below. Do not mark transaction safety proven by mocked frontend or sqlmock tests.

## 7. Worked traces

### Successful republish with waiting students

Initial: room R and schedule S point to V3; both candidates A/B are in lobby on V3 with valid credentials. A has an empty V3 module seed. Draft D4 contains saved edits; R's selected section is Math.

1. Staff opens Republish. The shared flow flushes acknowledged local edits, reads authoritative status/head, and shows confirmation for R. Cancel would leave all records unchanged.
2. Confirm mints key K and freezes R/S/head revisions. Media preflight validates Math. Coediting is frozen only if a seal is required.
3. Transaction claims K, locks R, S, A/B, verifies no runtime/start/answers, and locks the exam/draft. It seals D4 as V4 and validates the preserved Math and session settings.
4. Empty V3 seeds are removed. R/S/A/B pins become V4; appropriate revisions/control epochs increase. Names, roster, windows, credential and code state remain unchanged. Wakeups and exact receipt K commit together.
5. A's normal refresh notices the newer version/control epoch, replaces the old tree, and seeds the V4 entry module. A and B remain checked in under their original identities.
6. The HTTP response is lost. Retrying K replays V4's stored receipt even if B starts meanwhile. A later saved D5 is not captured by K.

Final: same URL, same R/S/A/B IDs, consistent V4 pins, no old module references, no timer started by republish, no duplicate release on retry.

### Start versus republish

Initial: staff confirmation is open; R/S are V3 and the student has not started.

- **Code start wins:** it takes link/schedule/attempt locks, accepts the code, creates/opens runtime and commits. Republish then sees start evidence or stale schedule revision, rejects with `ROOM_STARTED`/conflict, and rolls back its operation claim and any attempted publication.
- **Republish wins:** it holds link/schedule/attempt locks through V4 commit. Code start resumes against V4 and the rebound attempt; its old prepared module/revision cannot activate V3. It refreshes/retries against current state without requiring re-check-in.
- **Proctor Start:** the same schedule lock serializes both operations. Start after republish plans from V4; Start before republish makes republish refuse. No runtime deletion/replanning.

### Old bootstrap versus republish

Initial: bootstrap prepared V3 sections but has not seeded. Republish commits V4 and clears empty V3 seeds. Bootstrap then locks A and finds A pinned to V4, so it inserts nothing and retries from a fresh version read. Conversely, if the seed transaction runs first, republish waits, verifies the empty seed, and removes it before rebinding. An old response delivered after a new V4/control-epoch response is ignored on the client.

## 8. Verification matrix and commands

All tests below are **planned, not executed**.

| Layer / target | Required evidence |
| --- | --- |
| `internal/satrooms` unit tests | Clean reopened draft is up to date; edited draft is ready; older room can reuse current release; wrong/missing/negative fences rejected; status never seals; null/partial/full scope cases preserve exact effective sections. |
| New `cmd/api/sat_room_republish_mysql_test.go` | Release reuse/capture, multiple rooms unchanged except target, waiting attempts/credentials preserved, only pristine seeds replaced, invariant pin equality, exact receipt replay, cross-action key conflict, and no-op behavior. Reuse `satRoomsHarness` / `newSATPublishFixture`. |
| MySQL transaction failure tests | Inject failure after sealing, after link update, during attempt updates, outbox, and receipt write. Every write including publication rolls back. Assert original settings/answers byte-for-byte preserved. |
| MySQL concurrency tests | Deterministic barriers with separate connections/service instances for republish versus admission, proctor Start, code start, old seeder, same-key replay, and two different keys. Verify winners/losers and final durable pins, not elapsed sleeps. |
| Configuration/data regressions | Reject incompatible selected sections, practice/classroom plan, forced route, or changed applicable registration schema with sealed answers. Allow identical forms and retain answers. Reject terminal/history-bearing attempts and malformed stored scope without deleting evidence. |
| Handler/authz tests | Admin/Builder permissions; proctor/observer/student denied; wrong tenant or link/exam pair rejected; GET uses read tier; missing fields distinguishable from zero; no credential/roster secrets in status. |
| `delivery/seeder_contract_test.go`, bootstrap tests | Seed validates current attempt version under a lock; stale callers cannot insert; unique seed remains idempotent; consistent bootstrap snapshot; appropriate statement budget change; ACT delivery unaffected. |
| New `useRepublishSatRoom` tests | One POST per confirm, cancel zero writes, flush failure zero POSTs, stale confirmation conflicts, immutable retry body/key, unknown outcome retained across navigation/reload, permission changes retain uncertainty, old receipt cannot regress current cache. |
| Dashboard/row/room tests | Both button placements; loading/current/started/incompatible disabled explanations; pending feedback at pressed room; confirmation, error, retry and success; no nested buttons; focus restoration and status announcement; roles; viewport layout. Extend existing Dashboard interaction, AccessLinkRow, and SatSessionRoomRoute tests. |
| Shared workspace tests | New pin/revision propagates; stale shared values cannot restore old version or revision; another room remains unchanged. |
| Student hooks/browser | Open student waits through update, retains credentials and candidate, receives new version/entry module, rejects delayed old payload, starts normally with same code. Existing version-mismatch and bootstrap-seed behavior remains intact. |
| Real browser E2E | Authoring Rooms → republish → same copied URL/QR → existing waiting browser → new exam. Also room-page action and a start during confirmation. Use real Go/MySQL for correctness; existing mocked staff UX suite covers accessibility/visual interactions only. |

From repository root, after implementation:

```bash
bun run typecheck
bun run lint
bunx vitest run src/features/exam-authoring/ui/publish src/features/exam-authoring/ui/access-links/__tests__ src/features/exam-authoring/api/assessmentAccessLinkQueries.test.tsx src/features/exam-authoring/api/__tests__/authoringQueryEffects.test.ts src/products/sat/routes/__tests__/SatSessionRoomRoute.test.tsx src/features/student/hooks/__tests__/useStudentSessionRouteData.backend.test.tsx src/features/student-delivery/routes/__tests__/SatStudentSessionRoute.bootstrap.test.tsx
bun run build
bunx playwright test --config playwright.sat-staff-ux.config.ts e2e/sat-staff-room-ux.spec.ts
```

From `backend/go`:

```bash
go test ./internal/satrooms ./internal/accesslinks ./internal/exams ./internal/delivery ./internal/runtime ./internal/assessmentforms ./internal/authz
go test ./cmd/api -run 'TestSatRoom|TestSatRooms'
```

The API MySQL fixtures skip without `TEST_MYSQL_DSN`; supply an isolated migrated database and confirm tests actually run. Run the new republish concurrency cases with `-count=10` once deterministic barriers exist. Add a proposed `e2e/sat-room-republish.spec.ts` to the real default Go-backed suite and run `bunx playwright test e2e/sat-room-republish.spec.ts` against isolated fixtures. The inspected authoring-only and staff-UX configurations use mocked transport and cannot establish database/start serialization.

## 9. Extensibility, rollout, and remaining risks

- **Additional staff surface:** it consumes the same status query, hook, confirmation, and command. No new policy, SQL, or version capture logic belongs in its component.
- **Future support for updating started rooms:** a different feature with explicit migration/grading/clock semantics; changing one eligibility condition would be unsafe. Current implementation must not add reset machinery in anticipation.
- **Applicable registration changes after check-in:** deliberately fail closed under this plan. Supporting them later belongs in the forms/admission owner with explicit answer-version semantics, not an ad hoc delete in republish.
- **Mixed server rollout:** the write algorithm depends on all bootstrap seed writers using the new fence. Deploy the seeder change to all serving instances before exposing the republish POST/UI; a single old binary could recreate an old module seed. A frontend-only hidden button is not an API rollout guard. Use deployment sequencing or a disabled-by-default endpoint feature gate if the deployment cannot guarantee that sequence.
- **Unknown until implementation/verification:** exact post-republish student payload ordering, prestart auxiliary rows that need compatibility checks, and statement-budget impact. Required resolution: inspect the touched writer/reader when implementing, add the concrete interleaving tests above, and refuse to enable the endpoint if any writer bypasses the shared fence. Do not label these verified based on this document.
- **No migration currently needed:** existing receipts can represent the operation with a distinct request hash and the existing result. If implementation evidence disproves that, document the exact incompatibility before proposing schema changes.

Completion gate: both UI actions work, a waiting student starts the updated exam through the same link and credential, every preserved field is asserted, all start/rebind/seed interleavings preserve version consistency, same-key recovery is exact, and required checks run with actual database coverage. A skipped MySQL suite or mocked browser alone does not satisfy this gate.
