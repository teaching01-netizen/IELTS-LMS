# SAT Access Code Start — Solution and Delivery Plan

**Goal:** Register normally, enter a six-digit session code, and begin an individual SAT exam without a proctor clicking Start.

**Confirmed requirements:** Individual starts; one shared session code; exactly six random numeric digits; the proctor can see and present the code in Internal or distribute it in advance.

**Architecture:** Keep the existing Go API, MySQL, attempt credentials and SAT personal clocks. First entry is one server-owned transaction that validates the code, opens the personal session runtime if necessary, and starts only the credential owner's first delivered module.

**Status:** Revised engineering proposal, 2026-10-09. Repository behavior below was inspected; proposed behavior has not been implemented or exercised. Application code remains unchanged.

**Delivery Framework:** Requirements → Core Entities → API / Interface → Data Flow → High-Level Design → Deep Dives. Section 7 translates the design into dependency-ordered delivery and measurable acceptance gates.

## 1. Requirements

### 1.1 Functional requirements and boundaries

1. Preserve the current registration information, candidate identifier, admission rules and writer ownership. Registration succeeds before the code screen appears.
2. A correct code starts only that candidate's exam. No additional start confirmation or proctor presence is required. Existing module routing, breaks, response durability, accommodations, pause/extension rules and results continue afterward.
3. Admins and assigned proctors can reveal, copy and present the code in SAT Internal. Presenting or revealing the code has no effect on session or student clocks.

Use **Exam start code** for the shared secret. The registration **Student ID / access code** remains a different identity field. Do not replace the identity field with the shared secret.

**Included:** SAT session creation, admission-to-entry handoff, first-module activation, Internal presentation, protected content, recovery, expiry, audit and safe rollout.

**Excluded:** A whole-room start, per-student start codes, a new identity system, instructions between every module, offline starts, new timing models, or unrelated IELTS/ACT redesign. Builder previews retain their existing isolated start behavior and must explicitly select the preview/proctor mode.

### 1.2 Product decisions

| Topic | Decision |
| --- | --- |
| Code format | Uniform random value from `000000`–`999999`, formatted as six characters. Leading zeros and repeated digits are valid. No letters, separators or integer JSON values. |
| Code scope | One code per session; all admitted students in that session reuse it. Different sessions may coincidentally generate the same value; the code never establishes session identity. |
| Student action | One field and **Enter code and begin exam**. Submit explicitly; typing the sixth digit does not start a timer. |
| New-start window | Use existing schedule/link availability; no separate second calendar. Evaluate against database UTC time. |
| Boundary | Open is inclusive; close is exclusive: `opensAt <= DB now < closesAt`. For a linked schedule, intersect schedule and link windows. An anytime link still honors its backing schedule's end. |
| Link lifecycle | Active permits first start. Paused/revoked blocks new starts. Link availability governs admission and first start, not the continued timing of already-started students. Room pause/termination controls active students. |
| Closing the window | Reject new starts. Already-started students retain their personal deadline and may finish after the cutoff. |
| Rotation | Admin/assigned proctor may rotate while new starts remain possible. Replace the displayed value and increment its generation; keep started attempts running. Do not promise that a historical numeric value can never recur. |
| Changes to release/scope | Freeze pinned version, delivered section scope and start mode once a candidate is admitted. Reject conflicts rather than silently rebinding an attempt. Existing link scope freezes at participation remain in force. |
| Adoption | New normal SAT sessions default to code start only after rollout enablement. Existing sessions remain proctor start. Opt-in requires no participation, no runtime, and a compatible personal timing choice. |
| Code compromise | Rotation stops use of the current code for new starts. It cannot undo committed starts; staff use existing pause/termination controls for those attempts. |

The start mode is immutable after participation. Closing or cancelling a session does not reactivate an old attempt when the window is later edited; create a new session for a new sitting.

### 1.3 Invariants

- **I1 — Authority:** Only the verified attempt owner/current writer can redeem; neither code, email, URL nor client-supplied attempt ID is identity.
- **I2 — Independence:** Starting A changes no module state, phase, deadline or code acceptance for B.
- **I3 — Atomicity:** Durable acceptance and first-module activation commit together. There is no accepted-but-unstarted intermediate state.
- **I4 — Time:** Start time comes from the database after eligibility locks. Retry, reload, code rotation and credential refresh never create a later start time.
- **I5 — Confidentiality:** Before first start, no student transport exposes gated exam questions/instructions/media. Codes never appear in student payloads, URLs, persistent browser storage or logs.
- **I6 — Lifecycle:** A closed window, invalid code, wrong writer, terminal attempt or committed pause/cancellation cannot be bypassed through another endpoint or worker.
- **I7 — Completion:** Unstarted candidates are represented as never started, without scored/zero-score results; they cannot keep a room alive forever.
- **I8 — Compatibility:** Persisted start/timing choices keep their meaning through deployments, previews and creation/duplication paths.

### 1.4 Quality targets

Correctness/security gates require zero violations, not a percentage success rate. Qualify both 200- and 2,000-candidate synchronized entry workloads, using the repository's existing SAT load-test scale as a test target, not evidence that a deployment supports it.

Proposed entry targets on a documented deployment profile:

- p95 HTTP start response, including its required response body: under 2 seconds.
- p95 submit-to-first-interactive-question: under 2.5 seconds; p99 under 4 seconds.
- No timer reset, cross-candidate activation, lost acceptance or hidden transaction retry storm.
- A dropped response can be recovered without a new timer; loss of realtime delivery is recovered through existing polling.

Record API/DB versions, instance count, pool sizes, network conditions, content size and actual successful room size. Start with measured results; do not advertise an unqualified capacity. Separate registration load from pre-registered entry load, then run the combined journey.

## 2. Core Entities

### 2.1 Minimal data model

| Entity / owner | Proposed data and constraints |
| --- | --- |
| `exam_schedules` / schedules | `sat_start_mode` with allowed values `proctor` / `access_code`, default `proctor` for existing rows. Code mode requires provider SAT and persisted `sat_personal_v1`. Published version remains pinned. |
| Session code / scheduling domain | One row per schedule: schedule PK/FK, AEAD ciphertext/nonce, key ID, positive generation, timestamps and actor. No plaintext or duplicate client-visible hash. Created in the schedule creation transaction; deleted with its schedule. |
| `student_attempts` / delivery | Nullable `sat_start_code_accepted_at` and `sat_start_code_generation`. Both null or both present. Write only in the first-start transaction; never clear on reload, reissue or transfer. Advance attempt revision and existing control epoch through the current start helper. |
| `assessment_module_attempts` / delivery | Reuse unique attempt/module rows, state CAS, authored allocation, `started_at`, pause/extension accounting and revision. No second deadline column or client timer authority. |
| `assessment_access_links` / accesslinks | Existing unique `schedule_id` is sufficient to resolve the associated link server-side. Do not add a client-controlled source-link selector or duplicate source-link field to every attempt. |
| `attempt_terminalizations` / terminalization | Extend the reason allowlist with `start_window_closed`; use existing `terminated` outcome and system actor for unstarted expiry, with a no-start snapshot. Its result projection must explicitly skip scoring/materialization for this reason. |
| Audit / existing audit owner | Append code creation/reveal/rotation and first start/expiry facts. Include actor, scope, generation, timestamp and request ID; never include code/ciphertext. |
| Verification guard / database limiter | Stable attempt/principal request quotas using existing distributed fixed-window counters; a generation-scoped schedule failure budget plus short-lived comparison reservations. Persist across instances/token refresh; never key by raw code. Reservations are abuse-control facts, not accepted-code grants. |

Participation is a credential/admission fact, not merely an unowned pre-provisioned registration. Preserve the stronger existing restriction wherever section scope or release identity already freezes earlier.

### 2.2 Generation and encryption

Generate with Go `crypto/rand.Int` below 1,000,000 and format `%06d`. Rotation redraws if it equals the immediately previous value. Trim surrounding whitespace, then require `^[0-9]{6}$`; preserve leading zeros. Compare validated strings in constant time.

Proctors must retrieve the value again, so use authenticated encryption rather than hash-only storage. Use standard AES-GCM, a fresh nonce per encryption, and associated data binding schedule ID plus generation. Reject ciphertext copied across schedules or generations.

Use a dedicated versioned keyring configured at the composition root; never reuse attempt-token secrets. All API processes reading/creating codes require the active key; retain previous decrypt keys until their rows are re-encrypted. Key rotation re-encrypts the same code and does **not** advance its generation. Code rotation changes the code and generation. Backup/restore must retain the matching keyring. Validate configuration without printing secrets.

No in-process plaintext code cache is needed. Missing/corrupt key material returns a safe service-unavailable error and an operational alert; it never silently generates a new code, changes a student's timer or falls back to proctor start.

### 2.3 Evidence from this repository

| Inspected source | Evidence / consequence |
| --- | --- |
| `backend/go/internal/schedules/service.go`, `PersistSatTimingChoice` | New SAT schedules normally select personal timing through `SAT_PERSONAL_TIMING`; old null choices default differently. Code mode must reject conflicting rollout settings rather than silently use cohort timing. |
| `backend/go/internal/runtime/service.go`, `Start` | Locks schedule → all attempts → runtime, bulk-syncs attempt phase, and derives the pinned plan in transaction. Do not reuse the whole operation for individual redemption. |
| `backend/go/internal/accesslinks/service.go`, `Update`; `entry.go` | Link updates/admission lock link before schedule. A new schedule-first-then-link start path would introduce a lock inversion. |
| `backend/go/migrations/0034_assessment_access_links.sql` | Unique link per schedule. Durable schedule binding already resolves the source policy. |
| `backend/go/internal/delivery/start_submit.go` | Idempotent activation, epoch/writer fences, server time, compact ACK and phase/revision updates already exist. |
| `backend/go/internal/delivery/media.go`; `cmd/api/student_context.go` | Seeded base modules may be treated as readable before start. Assigned-module filtering alone is insufficient for the new gate. |
| `backend/go/cmd/api/handlers_media.go` | Cookie-based student media fallback permits role-based reads and public caching. The code-gate tests must cover this path as well as bearer reads. |
| `backend/go/internal/platform/httpx/ratelimit_tiers.go` | General attempt quota uses a bearer hash and can fall back to process-local limits. Neither is sufficient for six-digit guessing protection across token refresh/instances. |
| `backend/go/internal/proctor/reconcile.go` | Personal completion candidate scan already excludes rooms containing open attempts. Unstarted cleanup must run **before** that selection and cover sessions with no runtime. |
| `backend/go/migrations/0043_attempt_terminalizations.sql`; `internal/terminalization/service.go` | Terminal reason constraints and SAT result repair exist. Setting a compatibility flag alone is not a complete expiry design. |

## 3. API / Interface

### 3.1 Contracts

| Route | Authorization and contract |
| --- | --- |
| `GET /api/v1/proctor/sessions/{scheduleID}/start-code` | Admin in organization or assigned proctor. Return code, generation and safe effective window/status. Audit reveal. `Cache-Control: private, no-store`. No code in roster, lists or background polling. |
| `POST /api/v1/proctor/sessions/{scheduleID}/start-code/rotate` | Same scope plus existing staff session/CSRF rules. Body `{ "expectedGeneration": 2 }`. Return replacement/generation; stale generation is 409. Exact retry with old generation conflicts and causes a refetch, not a second rotation. |
| `POST /api/v1/assessment-delivery/schedules/{scheduleID}/start-with-code` | Verified attempt bearer/current writer. Body `{ "code": "004827", "controlEpoch": 3 }`; `controlEpoch` is required and must be a nonnegative integer. Use bounded request decoding; reject unknown security-sensitive identity/module selectors. Derive attempt from claims and module from delivered order. |

Start returns HTTP 200 with a discriminated union:

- `{ kind: "started", entry: AssessmentModuleEntryStateAck }` for initial activation; include only the selected first module's content needed to render.
- `{ kind: "resume", bootstrap: AssessmentDeliveryBootstrap }` for an already-started nonterminal attempt, routed to its **current** module/break. Never route a progressed candidate back to the first module.

Replays with a rotated code do not revalidate that secret after start. Verify principal, writer, revocation and current controls first. A terminal attempt returns the authoritative terminal conflict/state and cannot reopen. The existing recovery GET/bootstrap paths remain usable without a code for owners.

No new idempotency-key table is needed: the locked attempt, unique module row, immutable acceptance and original `started_at` provide natural idempotency.

### 3.2 Safe entry state

Expose a single server-derived entry object in bootstrap/state:

```ts
type SatStartPolicy = { mode: "proctor" } | {
  mode: "access_code";
  state: "code_required" | "started" | "closed";
  opensAt: string | null;
  closesAt: string | null;
  serverNow: string;
  blockedReason: "not_open" | "paused" | "revoked" | "rate_limited" | null;
  retryAfterSeconds: number | null;
};
```

Include existing attempt/runtime revisions; do not expose code, ciphertext, guess counts or encryption keys. Missing policy fields are accepted only for a persisted proctor-mode session. Unrecognized/missing policy for a known code-mode session fails closed.

Controller decisions read this object, not separate guesses based on room `live`, `phase` or local storage. State refresh never clears the form unless the attempt/session identity changes, entry succeeds or the user exits.

### 3.3 Failure semantics

| Condition | HTTP / reason | Action and mutation |
| --- | --- | --- |
| Malformed six-digit string / numeric JSON | 400 `START_CODE_FORMAT_INVALID` | Inline format message; no code comparison or clock mutation. |
| Well-formed mismatch | 403 `START_CODE_INVALID` | Commit invalid-attempt counters; do not create runtime/acceptance/module activation. |
| Legacy/direct start without approval | 409 `START_CODE_REQUIRED` | Show code form; no mutation. |
| Before open / at or after close | 409 `START_WINDOW_NOT_OPEN` / `START_WINDOW_CLOSED` | Display authoritative window/closed state. No delayed automatic redemption. |
| Paused/revoked access or runtime | Existing 409 gate plus safe reason | Stay registered; retain code in memory where retry is possible. |
| Wrong writer / stale epoch | Existing typed conflict | Refresh/adopt current state or use existing device transfer; do not retry with an invented epoch. |
| Wrong scope / unassigned staff | Existing 403/404 collapse | Do not expose existence, roster or code. |
| Verification limit | 429 with `Retry-After` | Show cooldown, no automatic repeated guesses. |
| DB/key/counter unavailable | 503 | No fallback start. Query state before replay when commit outcome is uncertain. |
| Request response lost after commit | Recovery GET/state | Resume original deadline and current module. |

Business rejection must not roll back the failed-guess counter. Settle the verification reservation in a short committed guard transaction, then map the typed result to the HTTP error. A failed start transaction has no partial start/acceptance. A failed post-commit ACK/content read does not imply rollback.

## 4. Data Flow

```mermaid
sequenceDiagram
    participant P as Internal / Proctor
    participant S as Student
    participant A as Existing Go API
    participant D as MySQL
    P->>A: Reveal assigned session's code
    A-->>P: Six digits + session/window
    P-->>S: Display or distribute before exam
    S->>A: Register normally
    A-->>S: Existing credential + code-required policy
    S->>A: Submit six-digit code
    A->>D: Validate owner, window, code and controls; start only this attempt in one transaction
    D-->>A: Commit acceptance, clock, revisions and existing durable events
    A-->>S: Start ACK + selected content
    S->>S: Adopt ACK; show first interactive question
    A-->>P: Existing roster update / poll fallback
    Note over S,A: Lost response: authoritative read resumes original start
```

The staff browser may be closed or offline. Copy/presentation never sends a runtime command. No student needs code re-entry at Module 2 or the section break.

Warm immutable content **on the server** before the activation timestamp; return it only after successful authorization/commit. Preload public shell assets and safe metadata in the browser, not gated question/media bodies. Do not add a future-start offer protocol to this feature.

There is an unavoidable download/render interval after server acceptance. The product promise is a full authored duration from database start, not zero latency before first paint. Measure that interval; if the target fails, optimize delivery before release rather than resetting clocks on reload.

## 5. High-Level Design

### 5.1 Ownership and dependency direction

- **Scheduling domain:** Own start mode, code creation/rotation and code persistence. Share a small focused helper between schedule and access-link creation so those packages do not import delivery or duplicate generation.
- **Schedules/runtime:** Schedules owns pinned plan derivation; runtime owns transaction-scoped runtime/section creation. Expose the existing planner through an injected port/callback; do not create a schedules ↔ runtime import cycle.
- **Delivery:** Own per-attempt eligibility, code redemption, content policy and first-module CAS. Reuse/extract the existing module activation helper; do not call a public transaction-starting service from inside another transaction.
- **Terminalization:** Own durable never-started closure and result exclusion. Proctor/worker invokes it; HTTP handlers do not invent terminal flags.
- **Composition root:** Wire dependencies in `backend/go/internal/app/app.go`; API handlers perform decoding/auth/error mapping only.
- **Frontend:** Keep registration in the existing route. SAT controller owns code submission/recovery and uses its current monotonic ACK/commit path.

Use a focused scheduling helper file, such as `backend/go/internal/schedules/sat_start_code.go`, and a focused delivery orchestration file, such as `backend/go/internal/delivery/sat_code_entry.go`. These are proposed new files, not existing capabilities.

### 5.2 First start: two transaction paths with one activation owner

Do not attempt to upgrade a shared schedule lock to exclusive after locking an attempt.

**Existing-runtime path:** Use READ COMMITTED and the existing bounded transient retry runner. Lock the associated link, if any, FOR SHARE → schedule FOR SHARE → code/configuration FOR SHARE → target attempt FOR UPDATE → runtime FOR SHARE → selected module FOR UPDATE. Read current window/lifecycle/code generation under those locks; validate owner, active writer, proctor status and epoch. Activate through the shared helper; atomically store acceptance, phase, revisions and existing events. Do not update the room runtime revision for every student's start.

**No-runtime path:** An unlocked existence hint chooses this path, but does not authorize it. Begin a new transaction with associated link FOR SHARE → schedule FOR UPDATE → code FOR SHARE → target attempt FOR UPDATE → runtime creation/check → module FOR UPDATE. Recheck every predicate and runtime existence. Derive the plan from the locked version and use the unique runtime schedule constraint. Another first starter that loses the race reuses the committed runtime; it does not restart the room or receive a runtime-exists error merely because it raced.

Only the first-runtime transaction serializes on the schedule; later starts share policy/runtime reads. Do not lock all students or call `SyncV2TimingInTx` for code-driven initialization. First creation changes room state only, and sets the phase/clock only for the redeeming attempt. Reuse scope planning and runtime invariants with this explicitly different synchronization policy. Existing pause/resume synchronization must also leave code-required candidates in their pre-exam phase; it may change their paused/running status, but cannot mark their exam started.

**Lock graph obligations:** Access-link edits already acquire link → schedule. Rotation acquires schedule FOR SHARE → code FOR UPDATE. Staff room commands keep schedule → attempts → runtime. The new paths must never acquire a link after a schedule, a schedule after an attempt, or code after holding an attempt while another code writer waits for that attempt. Reserve comparison capacity in its own short transaction before the start transaction; settle it afterward with conservative timeout accounting. Do not hold a global verification-counter write lock during runtime planning/content loading/module activation. Audit writes must follow the documented order. Test actual InnoDB interleavings and count absorbed retries; a successful response after repeated deadlocks is not proof of a sound order.

Recheck pinned version equality between schedule, attempt and content immediately before mutation. If it differs, fail closed with a staff configuration conflict. The earliest delivered base module can be Math; never hardcode Reading or display order zero.

### 5.3 Shared gates and content fencing

Code authorization is required for **every mutating student path before first entry**, including deprecated entry, break actions, submit/finalize, V1 submit/batch mutations and worker auto-start. Normal answer saving still requires an active owned module. Keep initial module `available_at` / `auto_start_at` unset until authorized; add the acceptance predicate to worker activation so a seeded timestamp cannot bypass the gate.

Share a delivery read policy across:

1. SAT bootstrap/state and selected-module content.
2. V1 session/static/version projections in `student_context.go`.
3. Attempt-bearer media authorization in `delivery/media.go`.
4. Student-cookie media fallback and metadata/download routes in `handlers_media.go`.
5. Entry/bootstrap seeds and frontend prewarming.

Before approval, retain exam title, candidate identity, section/module IDs and safe timing metadata; remove question prompts, options, stimulus, sensitive instructions and protected asset references/bytes. Apply attempt-specific filtering to a fresh tree; never mutate the shared immutable version cache.

For cookie media access, either resolve a proven owned attempt and apply the same policy or deny protected SAT assets. A student role alone is not sufficient. Protected SAT media must not be publicly cached even when a staff member reads it. Audit CDN/cache configuration and invalidate existing public cached copies where necessary; merely adding a new response header cannot recall bytes already cached.

Preserve current adaptive branch and handed-off-module fences after first start. The start code is not an authorization grant for every module in the pinned version.

### 5.4 Student and staff state machines

| State | Student surface | Allowed transition |
| --- | --- | --- |
| Registered / code required | Code form and authoritative availability | Explicit submission only. Wrong code returns here with inline feedback. |
| Submitting | Same mounted form, busy status; one in-flight request | Success to exam, typed refusal to form/closed, uncertainty to read-first recovery. |
| Recovering uncertain start | Same surface with progress/retry feedback | Read may discover started/current module; retry only after a read proves no start. |
| Started | Existing exam or break surface | Existing progression and controls; never return to code entry. |
| Closed without start | “The start window has closed” | Exit/help; no exam score and no start/reopen action. |
| Terminal after start | Existing completed/terminated surface | Owner may read final state; no start. |

Reuse one text field with `inputMode="numeric"`, label “6-digit exam start code”, leading-zero preservation, paste/Enter and inline announced errors. Validate the trimmed value without silently stripping letters or separators. Disable duplicate submit only while a request/recovery is in flight; keep registration and answers intact. Clear the secret on successful entry, identity change and exit.

In Internal, replace Start exam for code sessions with Reveal / Copy / Present. Presentation contains code, session name and window; the QR link remains registration-only. Refetch current generation when presenting/returning to the tab. On rotation, update all local views and existing safe metadata notifications without broadcasting plaintext. Say “Anyone with this session code who is admitted can begin.”

Roster distinguishes Waiting for code / In progress / Finished / Never started. Personal timers belong in rows/inspector; room `live` is not a shared candidate clock. Reject manual/automated room `start` commands for code-mode sessions with a typed start-mode conflict, and keep their `auto_start` disabled; individual redemption owns runtime initialization. Existing pause/resume/extension/termination/completion controls continue to work.

### 5.5 Window expiry and terminal records

Run an independent, indexed, bounded unstarted-expiry scan before personal completion selection. It must scan code-mode schedules even when no runtime was ever created; do not hang it off the existing already-drained-runtime candidate query.

For each eligible attempt, acquire link/schedule policy locks before the attempt, re-read database time, and prove acceptance is null and **no module has ever started**. Close only if the effective window has ended or the schedule is irreversibly cancelled. A temporary pause is not expiry. If first start commits first, cleanup becomes a no-op; if expiry commits first, first start must see terminal state.

Extend the existing terminalization boundary/DB reason check for `start_window_closed`, using an immutable no-start receipt before compatibility updates. Project `delivery_status = terminated` and post-exam state consistently; render the new safe disposition as Never started. Explicit staff room completion closes the new-start window immediately: seal its unstarted code-mode attempts without scoring, and preserve existing terminal/scoring behavior for attempts that started. Per-attempt staff termination before first start likewise records a no-start disposition.

The terminal snapshot must retain start mode, acceptance and whether any module ever started. A shared result-materialization predicate must skip **all** never-started code-mode receipts, including staff termination/completion and same-outcome replay, not just the automatic expiry reason. Result-repair scans, scoring/release metrics and grading work queues use that same disposition. Preserve legacy proctor-mode result semantics. An unexpected started module/answer under an automatic no-start reason is an integrity error, not a reason to erase evidence.

Then the current room-drain sweep can finish once new starts are closed and all attempts are terminal. For expired scheduled code sessions with no runtime, close the schedule without fabricating a live runtime. Permanent cancellation uses existing lifecycle semantics; test unstarted handling there as well.

## 6. Deep Dives

### 6.1 Six-digit threat model and limits

There are only 1,000,000 possible codes. The code is a shared start permission for an already-admitted candidate, not proof of identity or a strong standalone password. Public practice admission can create fresh principals; a per-attempt limit alone cannot bound guessing.

Add a **mandatory distributed verification guard** keyed by verified stable IDs, independent of raw bearer hashes and `RATE_LIMIT_MODE=local`:

- Reuse fixed-window distributed counters for at most five new verification requests per attempt per 60 seconds and twenty per stable student principal per 10 minutes. Correct new submissions count here; started-attempt recovery bypasses verification entirely. Token refresh/device transfer cannot reset keys. Fixed-window boundaries can allow adjacent-window bursts; do not describe these as rolling limits.
- Add a generation-scoped schedule guard row with a 10-minute database-time window, a maximum of 200 failed or unresolved comparisons, and a short-lived reservation row per request. This bounds fresh-principal guessing before any code comparison is performed.
- Reserve one slot atomically only while `failed + pending < 200`; use a unique request ID and bind it to schedule, generation and attempt. One active reservation per attempt prevents duplicate tabs from consuming a room's capacity. Reserve before decrypt/compare, then release the guard-row lock before runtime planning or module writes. A valid request waiting on transient capacity gets a retryable busy response, not an incorrect-code message.
- A reservation binds one request's immutable six-digit candidate to its reserved generation. Read/decrypt authoritative code under the start transaction's code lock. An internal transaction retry may repeat that same candidate/generation comparison, never test a different guess under the same reservation. A generation change invalidates the reservation; reserve again for a new user submission. Do not expose reservation IDs as a reusable public validation endpoint.
- After mismatch, atomically move pending to failed and return the typed refusal. After a committed valid start, release the pending slot in a short independent transaction. A crash/failed settlement leaves the slot pending; after its 30-second lease, the guard worker conservatively counts it as failed. The start transaction must check the lease before comparison; an expired ticket authorizes no comparison. Started-attempt recovery is never denied because settlement failed.
- Expired pending slots count against the window in which they were reserved. Cleanup is idempotent. Outstanding reservations must not be dropped at a window boundary or rotation in a way that authorizes extra comparisons; carry them until settled/expired and retain generation binding. Rotation creates a new failure budget for a different code, while old-generation reservations cannot compare the replacement. Clock skew cannot reset the guard because its windows/leases use DB time.
- At 200 failures/unresolved slots, new unstarted verification waits for capacity/cooldown or an authorized code rotation. Started attempts are unaffected. Return `Retry-After`; distinguish transient reservations from failure cooldown in Internal. Alert at 75%/100% of the failed budget, not on a normal wave of pending valid starts.
- Counter/reservation-store failure returns 503 for new verification; never fall back to process-local counting. Correct starts incur short reservation/settlement writes, but do not hold a schedule-wide write lock during the exam-start transaction. Include this unavoidable shared-counter cost in load qualification.
- Do not permanently ban an attempt or automatically rotate the code during normal student entry. A bounded retry may reuse a still-valid reservation for the same request after read-first recovery; a new candidate code requires a new reservation.

**Explicit tradeoff:** A distributed attack can force a temporary session cooldown. Six-digit codes cannot simultaneously guarantee unlimited legitimate attempts, bounded distributed guessing and no shared lockout. This design chooses bounded guessing and visible recovery; staff may rotate during an incident, while the normal flow needs no staff start action.

For a fixed code and window, at most 200 failed/unresolved guesses before cooldown gives an idealized chance around 200/1,000,000 = 0.02%; successful authorized starts do not consume that failure budget. This is not an overall security guarantee: adjacent windows, old pending reservations, multiple sessions, disclosure and weak identity checks remain relevant. Verify the exact comparison bound with concurrent fault tests, not just counter totals. Avoid a global per-IP classroom lockout; keep existing NAT-sized admission budgets separate.

### 6.2 Races, failures and their decisive facts

| Interleaving / failure | Required proof |
| --- | --- |
| A redeems; B polls live room | B remains code-required; no phase/clock/content release. |
| Two first starters race | One runtime and one consistent pinned plan; both get their own original module start. |
| Duplicate request / token refresh | One acceptance/start fact. Failed-guess quota remains tied to stable identity. |
| Rotation vs start | Locks choose the generation accepted. Started attempt remains valid; rotation updates only later redemptions. |
| Link edit/revoke vs start | Link/schedule ordering gives coherent policy at commit; no bypass using direct schedule entry. |
| Pause/cancel/expiry vs start | First committed eligible transition wins; no start after authoritative blocked/terminal state. |
| Writer transfer vs start | Old writer cannot activate after transfer; approved writer resumes the same fact/deadline. |
| Publish/version edit vs start | Plan and attempt version agree; otherwise conflict with no mutation. |
| Backend restarts after commit | Database state is enough to recover; code keys decrypt across instances. |
| ACK assembly/realtime fails after commit | Start remains committed; read recovers current state. Polling is sufficient without staff browser. |
| DB fails before commit / during uncertain commit | No blind declaration of success/failure; query authoritative state before replay. |
| Window closes while student is taking exam | No truncation of their personal timer. |
| No student ever starts | Unstarted attempts and no-runtime schedule close without fake scores/runtime. |
| Old client/server/worker remains | Code mode is not enabled until all enforcement paths are compatible. |

A deadline is not reset to compensate for a late response; latency is measured and addressed in delivery. A code mismatch never creates a runtime. A replay never requests a different module by client input.

### 6.3 Observability and operating actions

Reuse existing telemetry and audit conventions. Add low-cardinality counters for verification outcomes (invalid, blocked, accepted, replay, unavailable), start latency and commit-to-visible latency; track transaction retry count, expiry backlog/oldest age and media-policy denials. Never use schedule/attempt IDs, code or generation as metric labels. Correlate request/attempt/session IDs only in scoped structured audit records without payload bodies.

Distinguish new starts from replays in successful-start metrics. Notify staff on aggregate cooldown and operational alerts on key/counter failures, repeated deadlocks or stalled expiry. Dashboard/roster status must remain usable when code reveal is unavailable.

Runbook actions: reveal/copy; rotate leaked code; wait/rotate during cooldown; inspect a lost-response attempt before intervention; restore the correct keyring; stop new code-session creation; retain started attempts. No manual timestamp edits or automatic fallback to proctor mode.

### 6.4 Migration, mixed versions and rollback

1. Apply additive schema and terminal-reason constraints first, keeping existing rows in proctor mode. Add necessary indexed scan paths and schema-guard verification; validate CHECK behavior on the supported DB.
2. Deploy API and worker enforcement, secret configuration and frontend support with creation rollout disabled. Update preview/provisioning paths explicitly.
3. Verify all serving instances and workers support persisted code mode. An old API/worker could bypass the new gate; do not enable code-mode rows during an incompatible rolling overlap.
4. Enable creation for one controlled SAT session; test through completion/expiry, then increase traffic. Persist each session's choice.
5. Roll back by disabling creation of additional code-mode sessions. Keep code-aware APIs/workers and decryption keys serving existing code-mode/started attempts until drained. Rolling back to an old binary or dropping columns/keys while those rows exist is unsafe.

If `SAT_PERSONAL_TIMING` is off while code-session creation is requested, return a configuration error; do not silently downgrade timing. Keep preview sessions out of code mode, and cloned normal code sessions get a new code, generation 1 and no acceptance history.

## 7. Delivery Sequence and Verification Gates

### 7.1 Implementation ownership map

| Work | Existing owners / proposed additions |
| --- | --- |
| Schema/contracts/config | New next-free migration under `backend/go/migrations/`; `internal/platform/db/schema.go`, `internal/platform/config/config.go`; schedule DTO/validators, verification-guard/reservation tables and indexes. |
| Code lifecycle and creation | `internal/schedules/service.go`, new `internal/schedules/sat_start_code.go`, `internal/accesslinks/service.go`; shared transaction helper. |
| Runtime plan and wiring | `internal/runtime/service.go`, schedules planner boundary and `internal/app/app.go`; separate code-init synchronization policy. |
| Redemption/gates/content | New `internal/delivery/sat_code_entry.go`; `start_submit.go`, `service.go`, `media.go`, `reconcile.go`; existing attempt writer/epoch gates. |
| HTTP/auth/media | `cmd/api/main.go`, `handlers_delivery.go`, `handlers_media.go`, `student_context.go`, `student_admission_gate.go`, focused staff code handler; `internal/authz/`. |
| Expiry/result exclusion | `internal/proctor/reconcile.go`, `internal/terminalization/service.go`, affected result/grading queries, worker invocation. |
| Student contracts/controller | `src/features/student-delivery/contracts/assessmentDelivery.ts`, `api/assessmentDeliveryApi.ts`, `application/ports/SatDeliveryGateway.ts`, `application/satEntry.ts`, `hooks/useSatExamController.ts`, `routes/SatStudentSessionRoute.tsx`, pre-start surface. |
| Internal/create/preview UI | `src/products/sat/routes/SatSessionRoomRoute.tsx`, `ui/SatWaitingRoomPanel.tsx`, `ui/SatStudentLink.tsx`; creation forms/DTOs and `src/features/builder/services/previewRuntimeSessionService.ts`. |
| Integration/E2E/load | Existing MySQL fixtures and SAT raw-content canary tests; new `e2e/sat-access-code-start.spec.ts` and focused config; adapt existing SAT load harness for code entry without a staff Start call. |

All backend paths above are relative to `backend/go/`. Do not create a new general workflow engine, generic secret platform or second SAT controller.

### 7.2 Dependency-ordered tasks

**Phase A — Model, migration and configuration (I1/I8)**

- [ ] Encode enums, six-digit string validation, acceptance-field pairing and no-start terminal reason; verify defaults against a production-like migrated DB.
- [ ] Wire dedicated encryption keyring; implement CSPRNG/AEAD/generation lifecycle and test leading zeros, cross-schedule ciphertext tampering, key rotation/restart and corrupt/missing keys.
- [ ] Update all normal SAT creation/duplication paths atomically; freeze incompatible settings at admission. Preview explicitly stays preview/proctor mode.
- [ ] **Gate A:** No normal code-mode schedule can commit without a code and personal timing; existing SAT/IELTS/ACT/preview modes retain behavior.

**Phase B — Entry transaction, distributed guard and protected reads (I1–I6)**

- [ ] Extract existing activation helper and transaction-scoped runtime init with injected pinned planner; implement the two ordered transaction paths.
- [ ] Add stable distributed request quotas, comparison reservations, failure budget and lease cleanup; test exact comparison counts across concurrency/crashes/window boundaries, separate instances, refreshed bearers and fresh principals.
- [ ] Implement auth-scoped staff reveal/rotate and student redemption contracts; enforce code requirement on alternate mutations and worker activation.
- [ ] Apply shared confidentiality policy to all SAT/V1/media/cookie/cache paths before rendering any student response.
- [ ] **Gate B:** Real MySQL tests prove independent starts, races and rollback/replay; canary route probes find zero unauthorized question/media bytes. No hidden schedule-wide mutation on later starts.

**Phase C — Expiry and result semantics (I6/I7)**

- [ ] Add bounded unstarted candidate scan that runs before drained-runtime selection and covers no-runtime schedules.
- [ ] Add terminalization receipt/reason, no-start projection and exclusion from scoring, repair, grading/export/release metrics.
- [ ] Race expiry against start/cancellation with actual DB locks; test workers disabled then restarted, duplicate workers and same-outcome replay.
- [ ] **Gate C:** Waiting candidates cannot keep a closed session alive; legitimate started candidates finish normally; no-start candidates never gain a score on repair.

**Phase D — Student and Internal experience (I2/I4/I5)**

- [ ] Add safe entry policy and typed response union; reuse existing ACK/revision adoption and current-state resume.
- [ ] Build accessible code form and uncertain-commit recovery; test stale polling, double submit, paste/Enter, code rotation and device transfer.
- [ ] Replace Internal Start with scoped reveal/copy/presentation, safe roster states and personal clocks. Verify proctor assignment independently of admin-only access overview.
- [ ] **Gate D:** Two real student browsers start at different times without a staff Start call; reload preserves deadlines; Module 2/break/math-only progression needs no code.

**Phase E — Qualification and rollout (all invariants)**

- [ ] Run backend/frontend checks and real route security tests, including student cookie and guessed media IDs.
- [ ] Run 200/2,000 synchronized valid starts, first-runtime creation, mixed wrong/correct traffic, registration plus entry, token refresh and shared-NAT scenarios; collect latency, DB waits, retry count and exact state counts.
- [ ] Exercise missing-key/counter/DB/realtime failures and restart recovery in an isolated environment.
- [ ] Validate mixed-version enforcement and rollback with creation off while existing code attempts continue.
- [ ] **Gate E:** Attach passing artifacts for every acceptance ID below and a capacity report for the actual deployment; then enable a controlled session.

### 7.3 Acceptance matrix

| ID | Scenario and assertion | Evidence surface |
| --- | --- | --- |
| AT01 | `004827`, `000000`, repeated digits; reject wrong lengths/non-ASCII digits/numeric JSON; no silent numeric coercion | Unit + real HTTP contract |
| AT02 | Register A/B normally; A starts while B polls room live; only A has acceptance/start/content | Real DB + two browser E2E |
| AT03 | A/B start seven minutes apart; original authored allocation and distinct deadlines, including Math-only | DB timestamps + UI timers |
| AT04 | Concurrent duplicate clicks/tabs; lost response; reload after rotation and progression resumes current module | DB counts + browser trace |
| AT05 | First runtime creation races with registration/version edits; one coherent runtime; no bulk B phase/epoch changes | Controlled InnoDB locks/retry hook |
| AT06 | Rotation, link edit/revoke, pause, expiry and writer transfer race first start | Controlled barriers + final receipts/epochs |
| AT07 | Probe bootstrap/state/V1 static/session/media metadata/download with bearer, student cookie, absent attempt and guessed ID | Canary bytes absent + cache headers |
| AT08 | Direct/deprecated start, break, early submit, V1 mutation and seeded worker auto-start without approval | Real route/worker refusals, no clocks/results |
| AT09 | Failed budgets survive refresh/instances/fresh principals; counter failure blocks verification; shared cooldown recovers | Distributed counter rows + 429/503 contracts |
| AT10 | No first start, admission cutoff exact equality, window edit, worker restart; expiry without fake runtime/score | Terminal receipt + result/repair/query assertions |
| AT11 | Admin/assigned proctor reveal/copy/present/rotate; observer/grader/unassigned/cross-org denied; no proctor tab needed | Staff route tests + UI traces |
| AT12 | M1→M2, break→Math, pause/extension, accommodation, device transfer, response saving and SAT completion | Existing integration/transition regressions |
| AT13 | AES-GCM integrity, key rollover/re-encryption, missing keys, restore; never replace code silently | Unit + multi-process fault rehearsal |
| AT14 | Existing proctor-mode SAT, IELTS/ACT, preview; old-instance overlap prevented; creation rollback drains safely | Compatibility/deploy rehearsal |
| AT15 | 200/2,000 synchronized waves and realistic shared NAT; targets and correctness counts checked | Load artifact with profile/latency/retries |

For each race, assert both legal commit orders and the absence of illegal intermediate state; do not rely on arbitrary sleeps or a successful retry alone.

### 7.4 Verification commands and artifact rules

Use an isolated migrated MySQL test DB. Go tests gated on `TEST_MYSQL_DSN` must actually execute; skip output is not a passing concurrency gate. Browser SAT transition tests require `TEST_DATABASE_URL`, a running compatible API and seeded fixture. Do not print connection strings or use production data.

From `backend/go/`:

```sh
go test ./internal/schedules ./internal/accesslinks ./internal/runtime ./internal/delivery ./internal/terminalization ./internal/proctor ./internal/authz ./internal/platform/httpx ./cmd/api
go test -race ./internal/schedules ./internal/runtime ./internal/delivery
go test -tags integration ./integration/...
```

From repository root:

```sh
bun run typecheck
bun run build
bunx vitest run src/features/student-delivery/application/__tests__ src/features/student-delivery/hooks/__tests__ src/products/sat/routes/__tests__
bun run e2e:sat-transition
bun run e2e:sat-a11y
bunx playwright test --config playwright.sat-code-start.config.ts
```

`playwright.sat-code-start.config.ts` is a proposed implementation artifact: select the new real-API code-entry test explicitly so generic testMatch rules cannot silently omit it. The existing accessibility harness alone does not prove the real code form; include accessibility checks in AT02/AT11 too.

Run lint on changed files, migration/schema-guard tests, affected result/grading tests and creation/preview regressions during their owning phases. Final artifacts include the revision, executed/skipped test counts, race traces, redacted canary checks, E2E screenshots/traces, load summary and rollback rehearsal. This plan edit itself has not run application tests.

## 8. Decision Record and Remaining Release Inputs

**Chosen:** A shared six-digit code plus individual existing personal clocks, lazy room initialization, natural attempt idempotency, encrypted staff retrieval and enforced distributed verification limits.

**Rejected for this request:** Per-student codes add distribution/support work; a room-wide code start contradicts individual starts; a new service/queue/offer handshake adds failure boundaries without meeting a missing requirement.

**Inputs to record before release:** Actual deployment capacity profile; supported MySQL/TiDB schema behavior; keyring delivery/backup owner; cache/CDN invalidation result; measured existing timer/content latency; designated operator for code compromise/cooldown. These are release gates, not hidden assumptions about verified production behavior.

**Completion:** The feature is accepted only when every relevant acceptance ID has executed evidence, code-mode sessions survive rollback/recovery safely, and two students can complete SAT at independent start times without any routine proctor Start action.
