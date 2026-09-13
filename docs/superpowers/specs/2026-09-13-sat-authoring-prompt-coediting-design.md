# SAT Authoring Prompt Co-editing Design

**Status:** Approved on 2026-09-13

## Purpose

Add character-level, real-time collaboration to the SAT question prompt while
preserving the existing question revision, publishing, authorization, local
draft recovery, and rollback guarantees.

The first production slice covers only the prompt. Supporting material,
rationale, choices, answer-key structure, metadata, accessibility, imports that
replace multiple fields, and question structure remain on their current paths.
They may move into collaboration only after this slice passes its production
gates.

## Constraints

- Hocuspocus is self-hosted. Tiptap Cloud and other paid collaboration APIs are
  not used.
- Existing MySQL is the only shared infrastructure.
- Redis is unavailable.
- Exactly one Hocuspocus process may be active for an environment.
- Active `Y.Doc` instances live in Hocuspocus memory.
- Yjs binary state is persisted in MySQL and reloaded after a process restart.
- The Go API remains the only owner of authoring authorization, domain
  validation, question revisions, durable authoring events, and publishing.
- The existing `/api/v1/ws/authoring` protocol remains receive-only. Co-editing
  uses a separate WebSocket endpoint and protocol.
- All new feature flags default to off.

## Success criteria

The slice is successful when:

1. Two or more authorized authors can edit one prompt concurrently and
   converge without whole-field conflicts.
2. Remote carets identify collaborators without trusting browser-supplied
   identity.
3. A Hocuspocus restart reloads the latest state acknowledged as saved.
4. A second Hocuspocus process cannot become ready while the singleton owns the
   environment lock.
5. Metadata and other non-collaborative changes cannot overwrite a collaborative
   prompt, and prompt persistence cannot overwrite those fields.
6. Delete, draft replacement, workbook replacement/undo, and publish freeze or
   close affected rooms before stale mutations can be persisted.
7. Publish cannot complete until active collaborative state is frozen,
   persisted, and materialized into the question revision.
8. Disabling co-editing restores the existing editor from the materialized HTTP
   revision without a data migration.
9. No question content enters logs, metrics, awareness identity, or authoring
   event payloads.

## Non-goals

- Horizontal scaling of Hocuspocus.
- Redis, a Redis-compatible service, or cross-instance CRDT fan-out.
- Collaborative stimulus, rationale, choice text, choice ordering, answer keys,
  metadata, accessibility, or question type.
- Per-keystroke MySQL writes.
- Replacing the existing authoring event socket.
- Replacing HTTP question revisions as the publishable domain representation.
- Collaborative comments, suggestions, or version history UI.

## Approaches considered

### Standalone singleton with Go-owned persistence — selected

A small TypeScript Hocuspocus service owns live Yjs documents and calls private
Go endpoints to load, initialize, persist, materialize, freeze, and close them.
Go commits the Yjs binary and prompt projection in the same MySQL transaction as
the question revision bump and durable authoring event.

This keeps collaboration protocol logic in a Yjs-aware server and keeps domain
integrity in the existing Go service.

### Hocuspocus writing MySQL plus a browser persistence leader — rejected

This has fewer Go endpoints, but a browser becomes responsible for translating
and persisting the canonical prompt. Leader loss, stale projections, and the
existing whole-question save endpoint create a larger consistency surface.

### Hocuspocus sidecar in every Go deployment — rejected

Without Redis, multiple sidecars can open independent copies of the same room.
Even with one replica, coupling both runtimes makes health, deploy, and restart
behavior harder to reason about than a separately supervised singleton.

## Authority model

Three representations have distinct responsibilities:

| Representation | Authority |
|---|---|
| Active `Y.Doc` in Hocuspocus | Current collaborative prompt while the room is open |
| Binary Yjs state in MySQL | Durable collaborative history and restart source |
| `assessment_question_revisions.prompt` | Materialized domain projection used by existing reads, validation, preview, and publish |

The binary state and materialized prompt are committed atomically. A client may
show `Saved` only after receiving an acknowledgement for the exact state-vector
hash of its current `Y.Doc`.

Local render, WebSocket delivery, provider synchronization, and MySQL durability
are different states:

```text
local edit
  -> visible locally: Unsaved
  -> accepted by Hocuspocus: Syncing
  -> binary + prompt committed by Go/MySQL: Saved for this state hash
```

If another local or remote edit advances the state vector before the
acknowledgement arrives, the editor remains `Unsaved`.

## Runtime architecture

```text
Browser
  React + Tiptap
  Y.Doc field: prompt
  HocuspocusProvider
  IndexedDB local Yjs cache
          |
          | dedicated co-edit WebSocket
          v
Singleton Hocuspocus service
  authentication hook
  read-only enforcement
  in-memory Y.Doc rooms
  awareness/carets
  schema transformer
  persistence hook
  lifecycle control API
          |
          | signed private HTTP
          v
Go API
  existing authoring ACL
  co-edit token issuance
  seed/load/store endpoints
  partial non-collaborative patch endpoint
  freeze/publish orchestration
  authoring event emission
          |
          v
Existing MySQL
  assessment_question_revisions
  authoring_coedit_documents
```

The existing authoring event socket remains mounted once at
`AuthoringWorkspace`. It continues to deliver question revision, structural,
and draft lifecycle events. Hocuspocus awareness supplies field-level caret
positions; the existing exam-level presence channel continues to supply the
workspace roster until it is deliberately replaced in a separate change.

## Service layout

The new service lives outside the Vite browser bundle:

```text
services/authoring-coedit/
  package.json
  tsconfig.json
  Dockerfile
  src/
    main.ts
    config.ts
    singletonLock.ts
    authToken.ts
    goAuthoringClient.ts
    documentIdentity.ts
    richTextSchema.ts
    documentCodec.ts
    persistence.ts
    lifecycleControl.ts
    telemetry.ts
```

Responsibilities:

- `main.ts`: process lifecycle and Hocuspocus construction.
- `config.ts`: validated environment configuration; invalid or missing secrets
  fail startup.
- `singletonLock.ts`: one dedicated MySQL connection holding the named lock.
- `authToken.ts`: verification of short-lived tokens issued by Go.
- `goAuthoringClient.ts`: bounded, authenticated calls to private Go endpoints.
- `documentIdentity.ts`: parse and compare opaque document names and token
  claims.
- `richTextSchema.ts`: server-side Tiptap schema matching the browser schema.
- `documentCodec.ts`: seed/serialize the `prompt` fragment and compute state
  vectors and hashes.
- `persistence.ts`: initialize/store hooks and committed acknowledgement.
- `lifecycleControl.ts`: authenticated freeze, unfreeze, flush, and close
  operations used by Go.
- `telemetry.ts`: content-free metrics and allow-listed structured logs.

## Singleton enforcement

The service opens a dedicated MySQL connection and acquires one environment-
scoped named lock before listening:

```text
authoring-coedit:<deployment-environment>
```

Rules:

- Readiness is false until the lock is held.
- A second process waits up to 30 seconds and then exits non-zero.
- The lock connection is not part of an application pool.
- If the lock connection closes or ownership cannot be confirmed, readiness
  becomes false, all WebSocket connections close with a retryable reason, and
  the process exits.
- Deployments use stop-before-start or tolerate a short period while the new
  process waits for the old process to release the lock.
- Liveness does not claim healthy after lock loss.

This prevents blue/green overlap and accidental replica scaling from creating
split rooms.

## Document identity

The browser never constructs a room name from raw identifiers. Go creates or
loads an `authoring_coedit_documents` row and returns:

```text
coedit:v1:<opaque-document-uuid>
```

The row binds the UUID to:

```text
organizationId
examId
draftVersionId
examQuestionId
questionRevisionId
schemaVersion = 1
fieldSet = prompt
```

The unique logical key is `(draft_version_id, exam_question_id, schema_version)`.
Question revision counters are metadata and never part of room identity.

A new working draft receives a new document. Historical documents are never
reopened for a different draft, even if a canonical question is shared.

## MySQL data model

Add one table through the existing migration system:

```sql
CREATE TABLE authoring_coedit_documents (
  id CHAR(36) NOT NULL PRIMARY KEY,
  organization_id CHAR(36) NULL,
  exam_id CHAR(36) NOT NULL,
  draft_version_id CHAR(36) NOT NULL,
  exam_question_id CHAR(36) NOT NULL,
  question_revision_id CHAR(36) NOT NULL,
  schema_version SMALLINT UNSIGNED NOT NULL,
  field_set VARCHAR(32) NOT NULL,
  lifecycle_state VARCHAR(16) NOT NULL,
  seed_revision INT NOT NULL,
  materialized_revision INT NOT NULL,
  ydoc_state LONGBLOB NULL,
  state_vector VARBINARY(4096) NULL,
  state_hash BINARY(32) NULL,
  previous_state_hash BINARY(32) NULL,
  last_actor_id CHAR(36) NULL,
  closed_reason VARCHAR(32) NULL,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  closed_at DATETIME(6) NULL,
  UNIQUE KEY uq_authoring_coedit_scope
    (draft_version_id, exam_question_id, schema_version),
  KEY ix_authoring_coedit_exam_draft (exam_id, draft_version_id),
  KEY ix_authoring_coedit_updated (lifecycle_state, updated_at)
);
```

Allowed lifecycle states are enforced in Go:

```text
initializing -> active -> freezing -> frozen -> closed
                         \-> active when an operation aborts
```

Allowed close reasons are a closed vocabulary:

```text
question_deleted
draft_replaced
exam_published
workbook_replaced
feature_disabled
```

`ydoc_state` is the full output of `Y.encodeStateAsUpdate(document)`. JSON is
never used to reconstruct collaboration history. `state_vector` is the output
of `Y.encodeStateVector(document)`. `state_hash` is SHA-256 over that state
vector and identifies the exact state acknowledged to clients.

Binary state is capped at 4 MiB, the materialized prompt JSON at 1 MiB, and one
WebSocket message at 2 MiB. Exceeding a limit rejects the change, preserves the
last committed state, and shows a size-specific editor error.

## Authentication and authorization

The public token endpoint is owned by Go:

```text
POST /api/v1/assessment-authoring/exam-questions/{examQuestionId}/coedit-token
```

It uses the same session and tenant checks as the current authoring routes. It
creates or finds the co-edit document only when the selected question belongs
to the current editable draft.

Go returns a five-minute HMAC-SHA256 token with these claims:

```text
version
documentName
actorId
displayName
organizationId
examId
draftVersionId
examQuestionId
questionRevisionId
mode = write | read
issuedAt
expiresAt
```

The token uses a dedicated `AUTHORING_COEDIT_TOKEN_SECRET`, not the general
application authentication secret. Both services require at least 32 bytes.

Hocuspocus `onAuthenticate`:

1. Verifies signature, version, and expiry.
2. Requires the requested document name to equal the signed name.
3. Stores only server-signed identity in connection context.
4. Sets `connection.readOnly = true` for read tokens.
5. Rejects a closed document.

The provider refreshes the token before expiry. Hocuspocus requests a token
refresh every 60 seconds and closes a connection whose refresh is missing,
expired, or changes document identity.

Awareness accepts only caret/selection state. Before broadcasting awareness,
Hocuspocus replaces name, actor id, and color with server-derived values.
Question content and arbitrary browser-defined properties are removed.

Private Go/Hocuspocus calls use a separate
`AUTHORING_COEDIT_SERVICE_SECRET`. Each request carries an HMAC over method,
path, timestamp, and body hash. Timestamps outside a 30-second window are
rejected. Store and lifecycle requests are idempotent, so a replay cannot apply
the same state twice.

## Shared rich-text schema

Server conversion must accept the same node and mark vocabulary as the browser.
The existing editor extensions are split into:

```text
src/features/exam-authoring/editor/schema/
  richTextSchema.ts
  mathNodes.ts
  imageNode.ts

src/features/exam-authoring/editor/
  EditableMathExtension.tsx
  SatImageExtension.tsx
```

The schema files contain no DOM or React node-view code and are importable by
the Hocuspocus service. Browser-only files add node views to the same node names
and attributes.

Seed and serialization property tests cover paragraphs, headings, marks,
lists, code, inline and block math, images, and tables. For every supported
document:

```text
HTTP JSON -> Y.Doc prompt fragment -> HTTP JSON
```

must preserve the canonical structured-content projection.

## Load and initialization flow

1. The browser requests a co-edit token from Go.
2. Go resolves the current draft and question under the existing ACL, creates
   or loads the document row, and returns token plus document name and service
   URL.
3. The provider connects to Hocuspocus with that token.
4. Hocuspocus authenticates before loading content.
5. Hocuspocus asks the private Go load endpoint for the document.
6. If `ydoc_state` exists, Hocuspocus returns it unchanged.
7. If the row is `initializing`, Go returns the current prompt and revision.
8. Hocuspocus converts the prompt into the `prompt` Yjs fragment.
9. Hocuspocus calls the initialize endpoint with binary state, state vector,
   hash, and canonical prompt JSON.
10. Go compares the seed revision and current question mapping under row locks.
    It stores the binary and hash without bumping the question revision because
    the materialized prompt is unchanged.
11. A uniqueness race returns the already-stored document; no second seed is
    applied.
12. The browser mounts the editor only after the provider reports initial sync.

An empty Yjs document is never rendered as an editable prompt while seed status
is unresolved.

## Edit and persistence flow

1. A Tiptap transaction changes the `prompt` fragment.
2. Yjs applies it locally and Hocuspocus broadcasts it to room peers.
3. Browser IndexedDB records the update for local crash/offline recovery.
4. Hocuspocus coalesces store work with `debounce = 250ms` and
   `maxDebounce = 1000ms`.
5. The store hook snapshots the binary state, state vector, state hash, and
   prompt projection from the same `Y.Doc` turn.
6. It calls the private Go store endpoint with the previous committed hash.
7. Go locks the co-edit row, current draft, exam-question mapping, and question
   revision.
8. Go rejects a closed/frozen document, a replaced draft, a deleted question,
   a changed revision mapping, or a previous-hash mismatch.
9. If the incoming state hash is already current, Go returns the existing
   acknowledgement without a revision bump.
10. Otherwise one transaction updates only the `prompt` column, increments the
    question and draft revisions, stores Yjs binary/vector/hash, and appends the
    existing content-free `question.changed` event. Its `causationId` is a
    bounded `coedit:<state-hash-prefix>` correlation value.
11. After commit, Hocuspocus broadcasts a stateless acknowledgement containing
    document name, state hash, and question revision.
12. Each browser marks `Saved` only when that hash equals its current state
    vector hash.

Throwing from the Hocuspocus store hook keeps the document dirty and retries;
it never converts a failed store into a saved acknowledgement.

## Frontend ownership

Create an isolated package:

```text
src/features/exam-authoring/realtime/coedit/
  contracts.ts
  tokenApi.ts
  documentIdentity.ts
  provider.ts
  indexedDbPersistence.ts
  presence.ts
  saveState.ts
  usePromptCoediting.ts
```

Only this package imports Yjs and Hocuspocus types. UI components consume a
domain-facing value containing provider state, `Y.Doc`, prompt field name,
collaborators, save state, and recovery actions.

`RichQuestionComposer` gains an optional collaboration configuration. In
collaborative mode it:

- adds Tiptap Collaboration bound to field `prompt`;
- adds the collaboration-caret extension;
- disables StarterKit undo/redo;
- does not pass initial `content` after the provider has seeded the document;
- disables the `value -> editor.commands.setContent` effect;
- retains the current non-collaborative behavior byte-for-byte when the option
  is absent;
- continues to emit a structured prompt projection for preview and validation,
  but that projection does not schedule legacy whole-question autosave.

`AuthoringWorkspace` remains the composition owner. It mounts one provider for
the selected question and destroys it only after pending provider output has
been flushed or safely retained in IndexedDB.

## Non-collaborative field saves

The legacy full-revision endpoint remains unchanged for flag-off sessions.

Co-edit sessions use a new partial endpoint for fields outside the prompt:

```text
PATCH /api/v1/assessment-authoring/question-revisions/{revisionId}/fields
```

The request contains `revision` plus an allow-listed set drawn from:

```text
questionType
stimulus
answer
rationale
metadata
accessibility
```

`prompt` is structurally absent from this request type. Go updates only present
fields. On a stale revision, the client fetches the latest revision, performs
the existing field-level three-way classification, and retries only when the
fields being saved were not changed remotely. A genuine same-field collision
uses the current conflict UI.

This endpoint prevents an old or mixed-version client from overwriting an
active prompt. While an active co-edit row exists for the question, the legacy
full-revision endpoint rejects prompt-bearing writes with a typed
`COEDIT_ACTIVE` conflict. It does not silently strip the prompt.

## Programmatic prompt mutations

Every prompt-only operation must enter through a ProseMirror transaction so it
becomes a Yjs update. This includes typing, normal paste, smart paste, drop,
math edits, image changes, table operations, undo, redo, and toolbar commands.

Operations that replace or split several question fields, including
whole-question smart-paste acceptance, remain unavailable while prompt
co-editing is active. The UI explains that the author can dismiss the
suggestion and paste into the prompt normally. Supporting-material starters,
question-type replacement, and choice reorder remain enabled because they use
the partial non-collaborative save path and cannot write the prompt.

## Offline and recovery behavior

The browser attaches `y-indexeddb` using the opaque document name. Local edits
continue while the network is unavailable.

On reconnect:

- the same document identity merges through normal Yjs synchronization;
- a closed or replaced document never accepts the old state;
- if the server reports a lifecycle replacement, the client freezes the old
  editor and offers copy/export of the prompt before opening the new draft;
- local IndexedDB state is deleted only after a matching committed state hash or
  an explicit user discard.

The known reliability ceiling is explicit: a hard Hocuspocus crash can lose
updates that have not reached its bounded store hook. Those updates recover
from any surviving browser's IndexedDB. Simultaneous loss of the server before
store and every browser copy is not recoverable, and such state was never
labelled `Saved`.

## Publish and destructive lifecycle

### Publish

Publish is a freeze/flush/commit protocol:

1. Go asks the Hocuspocus control API to freeze every open document in the
   current draft.
2. Hocuspocus switches those connections to read-only, flushes provider output,
   runs every pending store hook, and returns a freeze token plus the committed
   document-hash manifest.
3. The freeze token expires after 30 seconds and automatically unfreezes rooms
   if no decision arrives.
4. Go verifies every manifest hash against MySQL and runs the existing publish
   transaction.
5. On commit, Go tells Hocuspocus to close the frozen rooms with
   `exam_published`.
6. On failure, Go tells Hocuspocus to unfreeze. If that call fails, the lease
   expiry performs the unfreeze.
7. If Hocuspocus is unavailable, publish fails closed with a retryable service
   error whenever the draft has an active co-edit document.

No HTTP revision can be published while a room is accepting newer edits.

### Delete

Go freezes and flushes the target document, performs the existing fenced delete,
then closes the room with `question_deleted`. A failed delete unfreezes it.

### Draft replacement and workbook replacement/undo

The mutation freezes all documents in the current draft, executes the existing
transaction, then closes them with the matching reason. The existing
`draft.replaced` event remains the browser's durable lifecycle signal.

### Service shutdown

On `SIGTERM` or `SIGINT`, readiness becomes false, new connections stop, rooms
become read-only, pending stores flush, sockets close with a retryable reason,
the singleton lock releases, and the process exits. Shutdown has a 20-second
deadline; timeout exits non-zero and leaves clients in unsaved/reconnecting
state rather than claiming persistence.

## Mixed-version and rollback safety

Server capability, not a Vite variable alone, decides whether a draft uses
co-editing. Once a prompt co-edit document becomes active, that draft-question
pair remains in co-edit mode until it is explicitly drained or its draft ends.

Flags:

```text
AUTHORING_REALTIME_COEDITING
VITE_AUTHORING_REALTIME_COEDITING
AUTHORING_COEDIT_SERVICE_ENABLED
```

Effective browser enablement requires all of:

```text
existing authoring events
existing authoring delivery
server co-edit capability
frontend co-edit flag
active editable draft
write-capable authoring role
```

Rollback sequence:

1. Stop new co-edit document creation.
2. Freeze and flush active rooms.
3. Verify every active row has a committed state hash and materialized revision.
4. Close rooms with `feature_disabled`.
5. Disable Hocuspocus service admission.
6. Clients refetch the HTTP question revision and mount the existing editor.

The legacy full-save guard remains enabled for rows not yet drained, preventing
mixed writers during a staggered frontend deployment.

## Failure behavior

| Failure | Required behavior |
|---|---|
| Hocuspocus unavailable before connect | Keep HTTP draft visible read-only; offer retry; do not silently open a legacy prompt writer for an active room |
| Hocuspocus disconnect | Keep local Y.Doc and IndexedDB state; show reconnecting/unsaved |
| Go store endpoint unavailable | Continue live local/peer editing in memory; never send persisted acknowledgement; retry bounded store |
| MySQL store failure | Roll back Yjs state and prompt materialization together; retain dirty in-memory document |
| Previous-hash mismatch | Close room, reload authoritative binary, require explicit recovery for unmatched local state |
| Token expiry | Request refreshed token; close read-only on failure |
| Singleton lock loss | Fail readiness, close sockets, exit |
| Oversized update/document | Reject without changing committed state; show size error |
| Draft replaced or question deleted | Freeze immediately; reject stores; preserve local copy for export |
| Publish freeze timeout | Abort publish and automatically unfreeze |

## Observability and privacy

The service exposes content-free health and Prometheus metrics:

```text
authoring_coedit_singleton_lock
authoring_coedit_connections_current
authoring_coedit_documents_current
authoring_coedit_auth_total{outcome}
authoring_coedit_store_total{outcome}
authoring_coedit_store_duration_seconds{le}
authoring_coedit_state_bytes{le}
authoring_coedit_reconnect_total{outcome}
authoring_coedit_freeze_total{outcome}
authoring_coedit_shutdown_flush_total{outcome}
authoring_coedit_lifecycle_close_total{reason}
```

All label values come from closed vocabularies. User, organization, exam,
draft, question, document, revision, state hash, and content never become metric
labels.

Structured logs allow identifiers only in protected fields and never include
binary state, state vectors, prompt JSON, awareness payloads, or tokens. Tokens
and service signatures are redacted at ingress.

## Testing strategy

### Go unit and integration tests

- token claims, expiry, signature, tenant scope, and role mapping;
- document creation uniqueness and current-draft binding;
- initialization compare-and-set;
- atomic binary/prompt/revision/event store;
- idempotent same-hash store;
- previous-hash mismatch;
- partial field updates preserving prompt;
- legacy save rejection while co-edit is active;
- freeze-manifest verification and publish fencing;
- delete and draft-replacement closure;
- service-signature validation and replay idempotency;
- size limits and content-free event/log behavior.

### Hocuspocus service tests

- configuration validation;
- singleton acquisition, contention, and lock loss;
- token verification and read-only connections;
- requested-name mismatch rejection;
- first seed and binary reload;
- schema round trips for every supported rich node;
- store retry without false acknowledgement;
- stateless acknowledgement hash;
- freeze, lease expiry, unfreeze, and close;
- graceful shutdown flush;
- awareness identity sanitation.

### Frontend tests

- provider lifecycle and StrictMode double mount;
- editor waits for initial sync;
- collaborative mode disables prop-driven `setContent` and independent history;
- non-collaborative mode remains unchanged;
- current-hash save-state transitions;
- remote caret accessibility and reduced-motion behavior;
- IndexedDB reconnect and closed-document recovery;
- whole-question split is unavailable while co-editing;
- partial non-prompt autosave never includes prompt;
- feature flags and capability narrowing.

### Browser and failure tests

Use independent Alice, Bob, and observer browser contexts:

- concurrent insert/delete/format operations converge;
- large paste, math, image, and table operations converge;
- remote carets show server-derived identities;
- observer updates are rejected;
- metadata save races prompt persistence without overwrite;
- leaderless browser behavior does not affect server persistence;
- offline author reconnects and converges;
- Hocuspocus graceful restart preserves saved state;
- hard restart recovers from MySQL and surviving IndexedDB state;
- a second singleton never becomes ready;
- publish freezes all authors and includes the acknowledged prompt;
- publish failure unfreezes authors;
- delete and draft replacement close the correct document;
- flag-off legacy workflow matches the current behavior.

### Property and stress tests

- randomized Yjs operations across three clients with delay, duplication,
  reorder, disconnect, and reconnect;
- repeated binary encode/load cycles produce convergent state;
- state acknowledgements never move a newer client state to `Saved`;
- reconnect storm at expected peak multiplied by the existing safety factor;
- bounded memory across repeated room open/close cycles;
- store latency and MySQL pool headroom remain inside rollout budgets.

## Rollout

1. Ship schema and code with every flag off.
2. Run the service in staging and verify singleton contention and shutdown.
3. Enable token issuance for developer-only exams.
4. Run automated multi-browser and restart scenarios.
5. Enable an internal-staff cohort for prompt-only editing.
6. Expand gradually using the existing authoring rollout gates.
7. Halt on any false saved acknowledgement, materialization mismatch, split-room
   evidence, stale overwrite, publish omission, or unrecoverable saved state.

The next collaborative field is planned only after the prompt slice completes
this rollout. Expansion reuses the same document and adds explicitly versioned
field names; it does not dynamically invent fragments in UI components.

