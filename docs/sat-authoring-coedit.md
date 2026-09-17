# SAT authoring co-editing

The design record for live co-editing in the SAT authoring workspace: note the
sections by name, because comments in the code cite them (`design 2026-09-13,
"Single ownership per field"` and friends refer to this document).

This is a record of what the build does, not a plan. Every claim below names the
file that enforces it, so a claim that stops being true is a bug in a specific
place rather than a stale sentence. The guards in the last section exist because
prose cannot be executed.

## Deployment topology

The production backend image embeds the Hocuspocus process from
`services/authoring-coedit/` and supervises it beside the Go API and worker via
`backend/Dockerfile`. It is therefore one deployable backend service, while
the co-edit runtime remains a separate child process with its own singleton
room lock. The Go API exposes `/authoring-coedit` and reverse-proxies the
browser WebSocket to the loopback child, so `AUTHORING_COEDIT_PUBLIC_URL` must
be the public API URL plus `/authoring-coedit`; `AUTHORING_COEDIT_SERVICE_URL`
stays loopback-only for private control calls. Set the `AUTHORING_COEDIT_*`
variables in the backend deployment; the Go API and embedded process must
share the two dedicated secrets.

Run exactly one backend replica when authoring co-editing is enabled. The
singleton lock intentionally prevents two containers from serving the same
rooms. `backend/Dockerfile` is the ONLY image that carries this service, and
`services/authoring-coedit/src/__tests__/imageContents.test.ts` refuses a build
whose COPY list is missing a file the runtime imports — the image is built from
the repository root, and every cross-package module has to be named there
explicitly. Operate the co-edit runtime separately by running this same image,
not by maintaining a second Dockerfile: a list that no deployment builds can be
kept up to date while the deployed one rots, and the container then fails to
resolve a module at startup.

## Where things live

| Concern | Owner |
| --- | --- |
| Field ownership, rooms, save truth, presence, projection | `src/features/exam-authoring/realtime/coedit/` |
| Workspace snapshot + Yjs write API | `src/features/exam-authoring/realtime/coedit/workspaceProvider.ts` |
| Save state shown to the author | `saveState.ts` (derivation), `ui/spine/coeditSaveTruth.ts` (UI projection) |
| The room itself (Hocuspocus, MySQL, control API) | `services/authoring-coedit/` |
| Room lifecycle decisions, authorization, materialization | `backend/go/internal/authoring/coedit.go`, `backend/go/cmd/api/authoring_coedit_orchestration.go` |
| Freeze/flush/close client | `backend/go/internal/authoringcoedit/control.go` |

## Single ownership per field

One question's columns have exactly one writer, chosen once by
`resolveFieldWriter({ workspaceRoomActive, promptRoomActive })` in
`realtime/coedit/fieldWriter.ts`:

| Writer | When | Owns |
| --- | --- | --- |
| `workspace` | the exam-level v2 room is open | every field: the rich roots (prompt, stimulus, rationale, choice content) and the scalar record (questionType, answer, metadata, accessibility, isPretest) |
| `prompt-room` | the question-scoped v1 room is open, no v2 room | the prompt only |
| `legacy` | no room | the full revision over HTTP |

Two writers for one column is a lost update decided by wall-clock: the room
stores the CRDT and an HTTP write stores a stale full-column snapshot of it. So
`saveDraft` returns before any HTTP call while the writer is `workspace`, and
`handleChange` — which lives in the workspace (`ui/AuthoringWorkspace.tsx`) and
calls the save routing — projects scalar edits into the room
(`ui/useAuthoringSaveRouting.ts` resolves the writer for both call sites). The
rule is a pure function with a unit-tested matrix, not a `useRef` a future edit
can forget to update.

Structural actions stay on HTTP in every mode: create, duplicate, delete,
reorder, bulk change, workbook import/undo, publishing, and access links. The
API owns their authorization, revision fencing, and persistence. After one
succeeds, the room relays a stateless `coedit.command` envelope so other open
surfaces invalidate their local view (`realtime/coedit/workspaceCommands.ts`) —
a notification, never a write.

## Frontend ownership

The collaborative transport is confined to `realtime/coedit/`. Editors receive
an opaque `Extensions` array from `editorBinding.ts`; they never hold a `Y.Doc`,
a provider, or an awareness object.

- **History**: in collaborative mode the composer registers no undo/redo
  (`richTextSchemaExtensions({ history: false })`). Yjs owns history once
  `Collaboration` is bound, and two independent stacks corrupt each other's undo.
- **Remote vs author transactions**: `isCollaborativeTransaction(transaction)`
  in `editorBinding.ts` answers whether a transaction came from a collaborator.
  Undo/redo is marked as change-origin too, but is an author action that must be
  persisted, so only the non-undo branch is filtered.
- **Cursors**: each rich field gets its own awareness cursor key
  (`cursor:<field>`; the legacy v1 prompt room keeps `cursor`) through
  `createScopedCaretProvider`, so a caret in a prompt is never read as a caret in
  a choice.
- **Awareness is not content**: publications are tagged `content`, `presence`, or
  `status` (`CoeditChangeReason`). Projections of rich fields are cached per root
  and invalidated by `observeDeep`, so a caret move costs no re-projection and no
  React re-render, and an awareness frame that changes nothing visible is not
  published at all.

## Save truth: the state vector

**Saved means the server's committed state vector equals mine.** The identity is
Yjs's state vector, base64 encoded (`realtime/coedit/stateVector.ts`), not a
digest of it. Two states with the same vector hold the same content, and Yjs
writes vectors deterministically, so byte equality is a sound identity across
browser, service, and Go.

No digest is involved because one was, and it broke: an earlier build hashed the
vector in the browser and compared it against the service's `node:crypto`
SHA-256. The two agreed for most lengths and silently disagreed for others, so a
room could commit every edit while the author watched "Saving…" forever, with no
way to tell whether their work was safe. A digest is a second implementation
that can be wrong; the vector cannot.

`deriveSaveState` (`saveState.ts`) resolves, in order: a lifecycle issue, then a
transport error, then not-connected, then "no vector yet" (syncing), then
equality (saved), then an in-flight store (syncing), then unsaved. An
acknowledgement is only accepted when it names this room and carries a non-empty
vector (`provider.ts`), and revisions are monotonic, so a late or duplicate ack
cannot move an editor backwards.

`stateHash` still travels in the ack and is still stored by Go. It is durable
provenance and manifest material, and it **never** decides Saved.

The author-facing status combines this with the legacy field autosave by taking
the least advanced of the two (`ui/spine/coeditSaveTruth.ts`): a prompt
acknowledgement can never mark a pending field patch saved, and a field save can
never mark an unacknowledged prompt saved.

## Rooms, leases, freeze / flush / close

One singleton Hocuspocus process holds the rooms; a second process refuses to
start (`services/authoring-coedit/src/singletonLock.ts`), `/readyz` is false
until the lock is held, and lock loss closes every room and exits rather than
serving a split brain.

Publishing and destructive scope changes need the rooms to stop moving, and
`coeditFreeze` is the same sequence for both:

1. Go marks the affected rows `freezing`, on the v1 documents table and the v2
   workspace table.
2. Go calls `POST /control/freeze`, which flushes pending stores, makes the rooms
   read-only, and returns a manifest of the committed state.
3. **Publishing verifies that manifest against MySQL** (`CoeditVerifyManifest`)
   before the mutation may commit: the service's own belief about a room is never
   the authority for a durable draft. A destructive scope change verifies
   nothing, because there the mutation itself is the authority and the rooms are
   being torn down rather than snapshotted.
4. On success the rooms close with a reason; on any failure — a failed freeze, a
   manifest mismatch — Go reopens the rows and calls `POST /control/unfreeze` so
   authors keep working.

If the unfreeze call never arrives, the freeze token expires after
`FreezeLeaseSeconds` (30s, `authoringcoedit/identity.go`) so a failed publish
cannot wedge authoring. `POST /control/flush` runs pending stores without
freezing, for scope changes and shutdown. Every control path requires the
service secret's signature, so a browser cannot invoke one even if it can reach
the port.

Client-side phases are `active | freezing | frozen` (`CoeditLifecyclePhase`):
freezing displays "Finishing changes…", frozen is view-only. An author's work is
never discarded by a freeze.

## Offline and recovery behavior

Local state is cached in IndexedDB (`y-indexeddb`), so a reload or a dropped
socket does not lose edits and reconnection merges them.

A room that cannot continue says so, and offers export before it offers a
replacement (`CoeditRecoverySurface.tsx`). The vocabulary is closed
(`CoeditLifecycleIssue`): `none`, `closed`, `replaced`, `frozen`, `offline`,
`service_unavailable`, `token_expired`, `oversized`, `rejected`. Recovery
affordances are `canExport` / `exportPrompt`, `discardLocal`, and `reload` — the
local prompt is exportable before a replacement draft opens and is never silently
thrown away.

Two failures were silent and are now announced:

- **Oversized.** A document the service cannot encode used to be rejected before
  any frame reached the browser, so `issue: "oversized"` existed with nothing to
  produce it. Now the refusal arrives as `coedit.save_failed` with reason
  `coedit_oversized` and produces the export surface.
- **Refused writes.** Hocuspocus decrements its unsynced counter only on an
  applied sync, so a write dropped by a read-only room left the editor
  indistinguishable from a slow one. The service announces it from `beforeSync`
  on a read-only connection (reason `coedit_write_refused`), and the client shows
  the refusal with export. There are no timers and no heuristics in this path.

Go deliberately closes a room with a `coedit:<label>` reason
(`LIFECYCLE_CLOSE_REASON_PREFIX` in the service,
`COEDIT_LIFECYCLE_CLOSE_PREFIX` in the browser); a close without it is a
transport event and stays on the reconnecting path. Close reasons are a frozen vocabulary
(`authoringcoedit.AllCloseReasons`): `question_deleted`, `draft_replaced`,
`exam_published`, `workbook_replaced`, `feature_disabled`.

## Capacity

Yjs state grows with the number of client ids a document has ever seen, and
every document lives in a `VARBINARY` column, so capacity is a design concern
rather than an operational one.

| Limit | Value | Where |
| --- | --- | --- |
| State vector column | `VARBINARY(8192)` | migration `0063` |
| `MaxStateVectorBytes` | 8192 | `authoringcoedit/identity.go` |
| Ydoc state | 4 MiB | `MaxYdocStateBytes` |
| Materialized prompt JSON | 1 MiB | `MaxPromptJSONBytes` |
| Workspace recovery JSON | 4 MiB | `MaxWorkspaceJSONBytes` |
| WebSocket frame | 2 MiB | `MaxFrameBytes` |

An idle load whose vector exceeds 2 KiB is compacted before any client syncs:
the document is rebuilt from the durable projections (`workspace_json`, and the
materialized prompt Go returns) under a new client id, and counted as
`authoring_coedit_compaction_total{outcome=accepted|skipped}`. A compaction that
cannot prove itself smaller is skipped, and a skipped compaction keeps the
committed binary — a maintenance path never turns into a failed load.

The residual, stated rather than implied: clients reconnecting with older local
history re-add their client ids, so compaction **bounds** growth instead of
eliminating it. Elimination means per-session rooms, which is a non-goal below.

## Non-goals

Deliberate, so a future reader does not read a limitation as an oversight:

- **Per-session rooms.** They are the only real fix for state-vector growth, and
  they cost a room, a lease, and a row per session plus a rewrite of the
  exam-level invalidation relay. Compaction is the chosen mitigation for now.
- **Conflict UI for the v2 room.** The CRDT merges text; when two authors edit
  *different fields* the room does not attempt to merge intent and shows no
  conflict surface. Field-level ownership (above) is what keeps that safe.
- **Offline editing as a first-class mode.** IndexedDB is a cache for reloads and
  dropped sockets, not an offline authoring mode with its own queue.
- **A browser-side kill switch.** There isn't one. The posture is always on, and
  the gates are `AUTHORING_REALTIME_COEDITING` and
  `AUTHORING_COEDIT_SERVICE_ENABLED`, which stop token issuance — the client then
  degrades to the legacy editor rather than showing a disabled feature.

## What enforces this document

| Claim | Guard |
| --- | --- |
| Only the coedit package imports `yjs`, `y-prosemirror`, `y-indexeddb`, `y-protocols`, `@hocuspocus/*`, Tiptap's collaboration extensions | `src/test/architecture/coedit-transport-boundary.test.ts` |
| A field has one writer | `fieldWriter.test.ts` (matrix) + the duplicate-writer spy in `ui/__tests__/AuthoringWorkspaceCoedit.test.tsx` |
| Saved requires an ack for the exact current vector | `coeditSession.test.ts`, `spine/__tests__/coeditSaveTruth.test.ts` |
| Awareness never re-projects rich content | `realtime/coedit/__tests__/workspaceProjection.test.ts` |
| An active room blocks a legacy prompt write, on both the documents and the workspace table | `backend/go/internal/authoring/coedit_service_test.go` |
| Oversized and refused writes reach the author | `services/authoring-coedit/src/__tests__/*.test.ts`, `AuthoringWorkspaceCoedit.test.tsx` |
| The runtime image contains every file the service imports across the boundary | `services/authoring-coedit/src/__tests__/imageContents.test.ts` |
