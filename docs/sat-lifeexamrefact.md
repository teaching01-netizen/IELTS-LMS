# Assessment Authoring — Production Remediation Plan

## Goal

Bring the assessment-authoring feature to a maintainable production state across:

```text
SPEC        target: 10/10
DESIGN      target: 10/10
CORRECTNESS target: 10/10
QUALITY     target: 10/10
```

Primary user-facing bug to fix:

```text
GET /v1/assessment-authoring/exams/:examId/shell
→ 404 NOT_FOUND
→ QueryCache treats it as an error
→ console shows ApiClientError / stack
→ UI guesses every 404 means "No editable draft"
```

The system must instead distinguish:

```text
exam exists + draft exists    → READY
exam exists + no draft        → NO_DRAFT
exam does not exist           → EXAM_NOT_FOUND
permission denied             → FORBIDDEN
unexpected backend failure    → ERROR
```

Refreshing must never create a draft.

Draft creation/opening remains an explicit user mutation.

---

# Phase 1 — Fix the Domain Contract

## Outcome

Remove HTTP-status guessing from the frontend.

The shell read becomes an explicit lifecycle query.

### Backend contract

Change the shell read contract so an existing exam without a draft is not represented as a generic `NOT_FOUND`.

Preferred API:

```http
GET /v1/assessment-authoring/exams/:examId/shell
```

Ready:

```json
{
  "state": "READY",
  "shell": {
    "examId": "...",
    "versionId": "...",
    "versionRevision": 12,
    "sections": []
  }
}
```

Existing exam without editable draft:

```json
{
  "state": "NO_DRAFT",
  "shell": null
}
```

Missing exam:

```http
404
```

```json
{
  "code": "EXAM_NOT_FOUND",
  "message": "Exam not found."
}
```

Forbidden:

```http
403
```

Unexpected failures remain real errors.

Do not use:

```text
404 + "Draft version not found."
```

as a normal lifecycle state anymore.

### Backend changes

Primary files:

```text
backend/go/internal/authoring/
  service.go
  bulk_read.go

backend/go/internal/http/...authoring handlers...
```

Introduce a domain result such as:

```go
type ShellState string

const (
    ShellStateReady   ShellState = "READY"
    ShellStateNoDraft ShellState = "NO_DRAFT"
)

type ShellResult struct {
    State ShellState `json:"state"`
    Shell *Shell     `json:"shell"`
}
```

Split current identity resolution into explicit outcomes:

```text
exam row absent
    → EXAM_NOT_FOUND

exam exists but draft pointer null
    → NO_DRAFT

draft pointer exists but referenced draft is invalid/missing
    → invariant/data-integrity error
    → do NOT silently convert to NO_DRAFT

valid current draft
    → READY
```

This distinction is important.

A missing draft pointer is legitimate domain state.

A dangling `current_draft_version_id` is corrupted state.

They must not produce the same behavior.

---

# Phase 2 — Make Draft Opening an Explicit Command

Keep:

```http
POST /v1/assessment-authoring/exams/:examId/shell
```

or rename later to:

```http
POST /v1/assessment-authoring/exams/:examId/draft:open
```

Do not mix this naming cleanup with the lifecycle fix unless migration cost is trivial.

Required semantics:

```text
existing editable draft
    → return same existing draft

no draft + published version
    → clone published → editable draft

no draft + no continuation source
    → typed 422 domain error

missing exam
    → EXAM_NOT_FOUND

forbidden
    → 403

concurrent draft open
    → all callers converge onto one editable draft
```

### Concurrency

The database remains the final authority.

Preserve row locking/CAS behavior.

Add a database-level invariant where possible:

```text
one current editable draft pointer per exam
```

If the schema already guarantees this structurally through `current_draft_version_id`, document that explicitly.

The frontend's disabled button is UX protection only.

It is not concurrency protection.

---

# Phase 3 — Introduce a Typed Frontend Lifecycle

Create:

```text
src/features/exam-authoring/application/
  authoringShellLifecycle.ts
```

Define:

```ts
type AuthoringShellState =
  | {
      kind: "ready";
      shell: AssessmentAuthoringShell;
    }
  | {
      kind: "no-draft";
    }
  | {
      kind: "exam-not-found";
    }
  | {
      kind: "forbidden";
    }
  | {
      kind: "error";
      error: Error;
    };
```

Transport mapping happens once.

UI must never contain logic such as:

```ts
isBackendNotFound(error)
```

to infer lifecycle state.

Remove logic like:

```ts
const isNoDraft =
  !shell &&
  isBackendNotFound(shellQuery.error);
```

from `AuthoringWorkspace.tsx`.

Replace with:

```ts
switch (shellState.kind) {
  case "ready":
  case "no-draft":
  case "exam-not-found":
  case "forbidden":
  case "error":
}
```

---

# Phase 4 — Fix the Exact Production Bug

Current failure:

```text
GET shell
404
ApiClientError
QueryCache error
large production console stack
"No editable draft" UI
```

After the lifecycle contract change:

```text
GET shell
200
{
  state: "NO_DRAFT",
  shell: null
}
```

Expected browser behavior:

```text
Network:
GET /shell → 200

Console:
no error
no QueryCache warning
no ApiClientError
no React stack

UI:
No editable draft
[Open draft]
```

Click:

```text
POST /shell
→ READY shell

React Query cache:
shell lifecycle → READY

UI:
authoring workspace appears
```

Refresh:

```text
GET /shell only

zero POST requests
```

This is the mandatory regression test for the bug that triggered this work.

---

# Phase 5 — Make React Query a Transport Layer, Not a Domain Layer

Refactor:

```text
src/features/exam-authoring/api/assessmentQueries.ts
```

Current problem:

It owns too much domain interpretation and repeated cache policy.

Target responsibility:

```text
query HTTP
parse contract
call centralized cache effects
return typed application result
```

Introduce:

```text
authoringQueryEffects.ts
```

Example responsibilities:

```ts
authoringEffects.shellChanged(queryClient, examId)

authoringEffects.questionChanged(
  queryClient,
  examId,
  questionId
)

authoringEffects.deliveryChanged(
  queryClient,
  examId
)

authoringEffects.accessChanged(
  queryClient,
  examId,
  linkId
)

authoringEffects.published(
  queryClient,
  examId
)
```

Internally these own:

```text
shell invalidation
readiness invalidation
release invalidation
question invalidation
access invalidation
exam-detail invalidation
```

Mutation hooks call semantic effects.

Do not repeat:

```ts
invalidateQueries(shell)
invalidateQueries(readiness)
invalidateQueries(release)
```

throughout the feature.

---

# Phase 6 — Remove Cache Policy From CollaborationBoundary

Current:

```text
SatAuthoringCollaborationBoundary
```

owns both:

```text
collaboration boundary
+
domain query invalidation policy
```

Split them.

Target:

```text
SatAuthoringCollaborationBoundary
    ↓
workspace event received
    ↓
authoringEffects.applyWorkspaceCommand(...)
```

The boundary should own:

```text
provider lifetime
event subscription
deduplication
collaboration live-region
```

It should not know the React Query dependency graph.

Move:

```text
invalidateForWorkspaceCommand
invalidateForWorkspaceAcknowledgement
```

into the centralized domain-effects layer.

One mutation/event should have exactly one obvious place defining affected projections.

---

# Phase 7 — Break Apart `AuthoringWorkspace.tsx`

This is the biggest DESIGN/QUALITY pass.

Do not perform a cosmetic file split.

Split by ownership.

Target:

```text
AuthoringWorkspace
│
├── useAuthoringLifecycle
├── useAuthoringSelection
├── useAuthoringDraft
├── useAuthoringQuestionCommands
├── useAuthoringNavigationGuard
├── useAuthoringOverlays
├── useAuthoringKeyboard
├── useAuthoringWorkbook
└── useAuthoringCollaborationBridge
```

`AuthoringWorkspace.tsx` should primarily become composition.

Target shape:

```tsx
export function AuthoringWorkspace(props) {
  const lifecycle = useAuthoringLifecycle(...)

  if (lifecycle.state !== "ready") {
    return <AuthoringLifecycleSurface ... />
  }

  const workspace = useAuthoringWorkspaceController(...)

  return (
    <SpineLayout
      header={...}
      queue={...}
      editor={...}
      inspector={...}
    />
  )
}
```

Target responsibility of `AuthoringWorkspace.tsx`:

```text
assemble existing UI
select major state surface
pass controllers to child surfaces
```

It should no longer directly own:

```text
HTTP lifecycle classification
workbook import transaction logic
autosave routing
coedit persistence routing
query invalidation
navigation durability
keyboard command implementation
20+ overlay booleans
question CRUD orchestration
```

---

# Phase 8 — Establish One Owner for Draft Persistence

The existing implementation has several persistence concepts:

```text
legacy autosave
workspace Yjs persistence
prompt room persistence
local/device recovery
HTTP save
manual save
navigation flush
```

Formalize them.

Introduce:

```ts
type QuestionPersistenceMode =
  | "http"
  | "prompt-room"
  | "workspace-room";
```

Create:

```text
useAuthoringPersistence.ts
```

It owns:

```text
which writer owns each field
save scheduling
manual save
navigation flush
pending status
conflict status
offline status
durability before route changes
```

UI should receive:

```ts
{
  status,
  saveNow,
  flushBeforeNavigation,
  canNavigate,
  conflict,
}
```

rather than reading/writing multiple persistence refs.

Remove state-order comments that exist only because hook declaration order currently matters.

A principal engineer should be able to answer:

> "Who owns saving this field?"

from one module.

---

# Phase 9 — Model Workspace State Explicitly

Replace clusters of related booleans/refs where they represent one state machine.

Examples:

```text
workspace mode
selected module
selected question
row mutation busy
navigation failure
draft recovery
remote deletion
mutation frozen
divergence
collaboration lifecycle
```

Do not convert everything into one enormous reducer.

Use bounded state machines only where states are mutually dependent.

Examples:

```ts
type DraftLifecycle =
  | { state: "loading" }
  | { state: "editing"; question: QuestionRevision }
  | { state: "saving"; question: QuestionRevision }
  | { state: "conflicted"; local: QuestionRevision; remote: QuestionRevision }
  | { state: "deleted-remotely"; localCopy: QuestionRevision }
  | { state: "published-readonly"; localCopy?: QuestionRevision };
```

This removes impossible combinations such as:

```text
deleted remotely
+
editable
+
network saving
+
published
```

existing simultaneously across independent refs.

---

# Phase 10 — Simplify Architectural Indirection

Audit:

```text
api/
application/
infrastructure/
services/
```

Do not preserve a layer merely because it exists.

Delete/pass through wrappers that add no policy.

Examples to evaluate:

```text
api/examAuthoringFacade.ts
application/examAuthoringFacade.ts
infrastructure/examAuthoringGateway.ts
api/examAuthoringBackendGateway.ts
```

A valid layer must own at least one of:

```text
domain transformation
policy
dependency inversion
transport
persistence
cross-cutting behavior
```

If a file only does:

```ts
export { x } from "../somewhere";
```

and it is not a deliberate public package boundary, collapse it.

Target dependency direction:

```text
UI
 ↓
application
 ↓
domain/contracts
 ↓
infrastructure
 ↓
HTTP/services
```

Never:

```text
UI → infrastructure
UI → legacy services
application → UI
```

---

# Phase 11 — Backend Service Decomposition

Do not rewrite the backend.

Move bounded behavior out of the ~93 KB `service.go`.

Target:

```text
authoring/
  shell.go
  shell_open.go
  question_commands.go
  publish.go
  delivery_settings.go
  preview.go
  readiness.go
  workbook.go
  coedit.go
  events.go
```

`Service` remains the dependency container.

Do not introduce interfaces unless two implementations or a meaningful test boundary require them.

Keep SQL near the domain operation that owns it.

Avoid repository abstraction purely for abstraction's sake.

---

# Phase 12 — Contract Tests

Add backend tests proving lifecycle semantics:

```text
existing exam + draft
→ 200 READY

existing exam + no draft
→ 200 NO_DRAFT

nonexistent exam
→ 404 EXAM_NOT_FOUND

dangling draft pointer
→ integrity/internal failure, not NO_DRAFT

wrong permissions
→ 403
```

Add command tests:

```text
NO_DRAFT → POST open → READY

READY → POST open → same draft

two concurrent opens → one resulting draft

twenty concurrent opens → one resulting draft

refresh never creates draft
```

The current concurrency suite is useful, but add the real:

```text
published exam
+
no editable draft
+
N concurrent POST open
```

fixture.

The current documented test that has neither draft nor published source does not prove the real cloning race.

---

# Phase 13 — Frontend Contract Tests

Test the actual API adapter, not mocked status helpers.

Required:

```text
200 READY
→ ready state

200 NO_DRAFT
→ no-draft state

404 EXAM_NOT_FOUND
→ exam-not-found

403
→ forbidden

500
→ error
```

Delete tests whose primary purpose is proving:

```text
404 === no draft
```

because that assumption must no longer exist.

---

# Phase 14 — Workspace Integration Tests

Use real QueryClient + real authoring application adapter.

Mock only the network boundary.

Critical regression:

```text
initial GET:
200 NO_DRAFT

expect:
"No editable draft"
"Open draft"

expect:
zero POST

click Open draft

expect:
one POST

POST returns READY

expect:
workspace visible

rerender/remount/focus/refetch

expect:
GET only
zero additional POST
```

Also verify:

```text
double click
→ one effective mutation

POST 409
→ recoverable conflict message
→ no loop

POST 403
→ permission message

404 EXAM_NOT_FOUND
→ no Open draft CTA

preview-only role + NO_DRAFT
→ no Open draft CTA
```

---

# Phase 15 — Real Browser E2E

Add Playwright/Cypress coverage against the actual running stack.

Mandatory flows:

```text
create/open authoring
refresh
create question
edit question
autosave
navigate question
preview
return to editor
publish
continue editing from published version
two tabs editing
offline/reconnect
conflict/recovery
workbook import
undo import
```

For the original production bug, assert:

```text
page refresh on NO_DRAFT

browser console:
0 unexpected error messages

network:
GET shell = 200

POST shell count = 0
```

Then:

```text
click Open draft

POST shell count = 1
workspace opens
```

---

# Phase 16 — Add Executed CI Gates

Current source contains significant testing machinery, but correctness cannot be considered 10/10 when it is not automatically executed for every relevant commit.

CI must run:

```text
frontend typecheck
frontend lint
frontend unit tests
frontend integration tests

Go format/static checks
Go unit tests
Go authoring integration tests

database-backed authoring tests
authoring shell concurrency suite

browser authoring smoke suite
```

The MySQL-backed tests must not silently disappear from the normal production confidence story.

Provide CI with a disposable MySQL service.

Tests may skip only capabilities that truly cannot run in CI.

---

# Phase 17 — Observability Without Treating Expected State as Failure

Expected:

```text
NO_DRAFT
```

must not produce:

```text
console.error
error telemetry
server exception logs
QueryCache error
```

Useful telemetry:

```text
authoring.shell.ready
authoring.shell.no_draft
authoring.draft.open.started
authoring.draft.open.succeeded
authoring.draft.open.conflicted
authoring.draft.open.failed
```

Record:

```text
exam id
request id
actor id where permitted
duration
result
```

Do not log question content.

Unexpected dangling draft pointers should generate high-priority operational telemetry because they represent integrity violations.

---

# Phase 18 — Remove Dead Compatibility Code

Only after behavior is proven.

Search for:

```text
old shell POST-on-load behavior
404-no-draft special casing
duplicate invalidation helpers
legacy facade re-exports
obsolete Phase 03/04 compatibility comments
unused realtime flag paths
dead autosave branches
duplicate error mappers
```

Delete them.

Do not retain old and new lifecycle models simultaneously.

---

# Final Intended Architecture

```text
Route
 ↓
AuthoringWorkspace
 ↓
useAuthoringLifecycle
 ↓
Authoring Application API
 ↓
Authoring HTTP Gateway
 ↓
Backend Authoring Handler
 ↓
Authoring Service
 ↓
DB
```

Realtime:

```text
Collaboration Transport
 ↓
Collaboration Boundary
 ↓
Workspace Domain Event
 ↓
Authoring Effects
 ↓
Query projections
```

Persistence:

```text
Question edit
 ↓
Persistence Controller
 ├── HTTP writer
 ├── prompt-room writer
 └── workspace-room writer
```

No UI component should choose between persistence implementations itself.

---

# Definition of Done

SPEC 10/10 requires:

```text
refresh never creates drafts
draft opening is explicit
no-draft is rendered intentionally
missing exam is rendered differently
permissions are correct
full authoring workflow remains intact
no unintended feature expansion
```

DESIGN 10/10 requires:

```text
AuthoringWorkspace is orchestration/composition only
one owner for shell lifecycle
one owner for cache effects
one owner for persistence routing
one owner for collaboration transport
clear UI → application → infrastructure direction
no meaningless pass-through layers
```

CORRECTNESS 10/10 requires:

```text
backend lifecycle tests passing
frontend contract tests passing
workspace integration tests passing
real MySQL concurrency tests passing
browser E2E critical paths passing
zero unexpected console errors in normal flows
CI proves all of the above on the exact commit
```

QUALITY 10/10 requires:

```text
no duplicate cache invalidation matrices
no HTTP-status domain inference
no duplicated error classification
no obsolete compatibility branches
no giant controller owning unrelated behavior
no unnecessary abstractions
no dead code
comments explain invariants, not compensate for confusing structure
```

# Implementation Order

Execute in this dependency order:

```text
1. Backend shell lifecycle contract
2. Backend lifecycle + integrity tests
3. Frontend transport contract
4. useAuthoringLifecycle
5. Fix production NO_DRAFT bug
6. Integration regression tests
7. Centralize query/cache effects
8. Simplify collaboration invalidation
9. Extract persistence controller
10. Extract selection/navigation/command controllers
11. Reduce AuthoringWorkspace to composition
12. Collapse meaningless architecture wrappers
13. Split oversized backend service by bounded behavior
14. Add real MySQL no-draft clone concurrency proof
15. Add browser E2E
16. Add mandatory CI gates
17. Delete compatibility/dead code
18. Final Four-Dimension Audit
```

Do not start the large `AuthoringWorkspace` refactor before phases 1–6 are green. First lock the external behavior with tests; then simplify the internals without changing behavior.

# Final Audit Gate

Do not declare completion from code inspection.

Run the Four-Dimension Audit again against the completed implementation.

The pass is complete only when there is executed evidence for every important authoring lifecycle and the final implementation has no remaining critical ownership ambiguity, lifecycle-status guessing, duplicate cache policy, or production console error on expected states.
