# Implementation plan: SAT module lifecycle proof and 1,000-candidate verification

**Status:** Plan only. No application or test changes have been made; no tests or Lean proofs have been run for this scope.

## 0. Context and current behavior

- **Goal:** Establish a rigorous correctness argument and production-representative evidence for autosave, Module 1 close and scoring, adaptive Module 2 routing, Module 2 autosave and close, and final SAT attempt submission under a 1,000-candidate sitting.
- **Current → desired:** The repository already implements the workflow and has targeted integration tests, k6 scenarios, a handoff runbook, and a separate Lean proof for SAT access-code admission. The desired result is a lifecycle-specific Lean model with audited assumptions, adversarial DB/API tests, and a measured 1,000-candidate full-flow rehearsal.
- **Interpretation:** “1,000 concurrency” means 1,000 distinct, concurrently active candidate attempts in one sitting, including synchronized final-save/close/routing waves. The safety theorem is quantified over arbitrary candidate IDs and action interleavings; a 1,000-user run is capacity evidence, not a formal proof.
- **Verified behavior:**

  | Behavior | Evidence | Status |
  | --- | --- | --- |
  | SAT response batches lock the attempt, use `READ COMMITTED` with bounded transient retry, fence leases/control epochs, deduplicate by write ID, and update the canonical response projection and ledger in the transaction. | `backend/go/internal/attempts/service.go`: `SaveResponses`, `saveInTx`, `exactReplay`; migration `0049_response_durability_v2.sql` | Verified in source |
  | Personal SAT close requires expiry and an exact durable-write manifest; close, score, route decision, selected-module attempt and close receipt are committed within the close transaction. | `backend/go/internal/delivery/close_module.go`: `CloseModule`, `pendingCloseWritesTx`; `backend/go/internal/delivery/start_submit.go`: `finalizeModuleWithBasisTx`, `nextModuleTx` | Verified in source |
  | Timeout reconciliation also finalizes modules and routes; personal and cohort timing/handoff paths differ. | `backend/go/internal/delivery/reconcile.go`; `start_submit.go`; migration `0074_sat_module_handoff.sql` | Verified in source |
  | Adaptive policy uses persisted `minimumCorrectForHigher`; `rawCorrect >= threshold` selects higher, otherwise lower. The route row and selected module identity are checked together. | `backend/go/internal/delivery/start_submit.go`: `chooseAdaptiveRoute`, `nextModuleTx`, `assertAdaptiveRouteIntegrity` | Verified in source |
  | Candidate module-level submit is disabled. Timer or authorized proctor closes modules; final attempt submit requires all required module rows to be terminal and stores a replayable receipt. | `start_submit.go`: `finalizeModuleWithBasisTx`; `backend/go/internal/attempts/submit.go`: `submitInTx`; `sat_modules.go`: `ensureSATModuleTopologyTx` | Verified in source |
  | Full SAT load script covers both Reading & Writing and Math M1→M2 paths, response writes, and final attempt submission; a targeted handoff script covers close-manifest and boundary-write behavior. | `k6/sat-exam-day.js`, `k6/sat-m1-m2-handoff.js` | Verified in source |
  | Current working tree already has broad uncommitted changes, including SAT backend, load-test, and `verification/` changes. | `git status` at planning time; inspected baseline commit `d1bf8cceb3f0f6c5325b3359963c80a6def8ec0c` | Verified |

- **Adjacent evidence, not lifecycle certification:** `verification/lean/sat-access-code-start/` records a Lean 4.19.0 check and local MySQL access-code start waves. Its report records 1,061 successful starts and 939 cooldown responses in a 2,000-candidate direct-service wave. This is start-admission evidence only; it does not prove lifecycle behavior or capacity for the proposed 1,000-candidate sitting.
- **Scope:** Full SAT unscoped sitting (Reading & Writing and Math), with any schedule-declared section scope honored; one adaptive M1→M2 decision per included section; durable answer writes and final attempt receipt. Verify both personal and cohort lifecycle semantics in deterministic tests where those modes remain supported; measure capacity using the production timing/handoff profile once identified.
- **Non-goals:** Replacing the response or delivery APIs, changing adaptive policy, promising inclusion of edits never received by the server, proving MySQL/TiDB internals from Lean, certifying unlimited capacity, or directing synthetic load at a live exam.

### Scope boundary and acceptance time

An answer typed or clicked in a browser is not yet an accepted answer. The guarantee is about the server-authoritative write path and the durable transaction, under the backend's DB-time writability gate and attempt-row serialization. Before proof work, record the exact ordering contract for a save racing module close: the existing integration tests establish that a save serialized before finalization can affect the route and one serialized after finalization is refused. The model will not claim that an offline or unsent click is included.

The lifecycle scripts require an isolated staging schedule. In particular, `k6/sat-exam-day.js` contains an explicit guard against a live exam. The 1,000-candidate qualification will use synthetic candidates in an isolated production-equivalent environment.

## 1. Requirements

### Functional

| ID | Behavior | Acceptance criterion |
| --- | --- | --- |
| FR-1 [P0] | Save an answer through the current SAT V2 response-batch contract. | An acknowledged write exists in the durable mutation ledger and canonical projection after commit. An identical retry returns its stored outcome without a second effect. Reuse of an ID with different content conflicts. An older lease/version cannot replace a newer projection. |
| FR-2 [P0] | Close Module 1 under its server-owned timing mode and score the durable answer snapshot. | For personal client-confirmed close, every declared final write resolves to its exact durable ID/version/hash and pending writes refuse close. For cohort/reconciled close, the authoritative deadline/save-grace path scores its durable rows. In both cases closure and score serialize with saves; pre-expiry close is refused and a post-close save cannot change the canonical route input. |
| FR-3 [P0] | Select and create exactly one adaptive Module 2 for each included SAT section. | The selected route equals the persisted policy applied to the close-time score snapshot; one route decision and one selected module attempt exist. Replays and concurrent timeout/close workers preserve the same choice. |
| FR-4 [P0] | Keep unselected adaptive content unavailable and allow the selected Module 2 to start and save. | Bootstrap, content, and relevant delivery reads omit the unselected branch; selected content is returned only through the authorized lifecycle. A selected Module 2 accepts durable writes under the same save invariants. |
| FR-5 [P0] | Complete and submit the full SAT attempt. | Final submission is refused while any required section/module is missing or nonterminal. Once valid, the final digest/receipt is durable and identical on replay with the same submission intent. |

### Non-functional

| ID | Constraint | Target or threshold | Validation |
| --- | --- | --- | --- |
| NFR-1 | Concurrent correctness across API instances and worker reconciliation. | Zero lost acknowledged writes, duplicate route/module effects, route drift, unselected-content leaks, or duplicate final receipts in the target profile. | Barrier-controlled DB races, process-kill/restart replay, and 1,000-candidate invariant queries. |
| NFR-2 | 1,000-candidate throughput and latency. | **Production SLO is UNKNOWN.** The current k6 harness has configured response-ack p95 <2s / p99 <5s, handoff p99 <5s, and submit p99 <30s; treat these as existing harness thresholds, not approved production SLOs. Confirm or replace before a release verdict. | Measure p50/p95/p99/max, completed candidates, errors/retries, DB waits, and route latency in the pinned environment. |
| NFR-3 | Durable recovery after ambiguous acknowledgments and process failure. | Same write/close/submission identity recovers the committed result without duplicate effects; aborted/uncommitted work is not reported as successful. | Kill API after commit-before-ack and before commit, retry through a different process, compare persisted state and receipts. |
| NFR-4 | Timing and branch confidentiality. | DB time and persisted policy/route remain authoritative; unsent browser state is never treated as canonical; unselected branch identifiers/questions do not leak in student delivery responses. | Deadline boundary tests and raw-body/content-fence scans for both higher and lower outcomes. |
| NFR-5 | Reproducibility and honest proof boundary. | Pinned Lean toolchain/dependencies, `lake build`, audited theorem axioms, recorded code/schema/env profile. | Proof report and test/load artifacts identify commit, toolchains, database, migration head, topology, and commands. |

### Capacity estimate

The SAT exam-day harness describes 98 delivered question slots across the four adaptive modules in a full two-section sitting. At one baseline committed answer per slot, 1,000 candidates imply **98,000 baseline answer writes** (`1,000 × 98`), before answer edits, retries, polling, and module lifecycle operations. This is a workload estimate, not a peak request-rate or capacity guarantee. The profile must be calibrated against the target client behavior and available production telemetry.

## 2. Core entities and invariants

| Entity | Source of truth | Relevant invariants |
| --- | --- | --- |
| Attempt / active writer | `student_attempts`; verified bearer and persisted lease/control epochs | Candidate identity is not body-selected; terminal attempt cannot accept new work; final receipt belongs to one attempt. |
| Response mutation ledger | `attempt_mutations_v2` | `(attempt_id, client_write_id)` identifies at most one immutable logical write; same ID/different payload is conflict. |
| Canonical answer projection | `attempt_responses_v2` plus compatibility reads | At most one canonical answer per attempt/module/question; applied version is monotonic by lease epoch then client version. |
| Module attempt | `assessment_module_attempts` | Only valid lifecycle transitions; a terminal M1 snapshot cannot be mutated by a later save. Final SAT submit requires all required rows terminal and resolvable. |
| Adaptive route | `assessment_route_decisions` | At most one decision per `(attempt_id, section_id)`; decision route, selected module ID, authored role, score, and persisted policy agree. |
| Module content | Published immutable version plus attempt route | Candidate-visible content contains base and selected branch only; unselected branch is excluded from student-visible outputs. |
| Final submission | `attempt_submissions_v2` / terminalization receipt | Stable request ID and digest; at most one logical final submission per attempt; exact replay returns the same receipt. |
| Timing and close manifest | DB timestamps, module clock fields, client close ID and exact answer manifest | Deadline/extension/pause interpretation is server-owned; close is idempotent for the same close identity and payload. A manifest is evidence of the latest writes the browser reports, not proof about edits never sent. |

### Safety invariants to formalize

- **INV-1 — Mutation uniqueness:** for every attempt and write ID, there is at most one committed ledger effect.
- **INV-2 — Projection monotonicity:** a committed answer projection never regresses to an older `(leaseEpoch, clientVersion)` for its question key.
- **INV-3 — Acknowledgment durability:** every successful save acknowledgment corresponds to a committed ledger entry and its stored canonical outcome; lost acknowledgments may be retried safely.
- **INV-4 — Close/score atomicity:** a module becomes terminal and its score snapshot/route consequences are committed as one database transaction; no accepted answer can interleave between scoring and terminalization under the modeled attempt lock.
- **INV-5 — Route uniqueness/correctness:** at most one route decision and one candidate Module 2 attempt exist for an included section; `higher` iff `rawCorrect >= minimumCorrectForHigher`, after validated policy configuration; otherwise `lower`.
- **INV-6 — Route immutability:** post-close late evidence may be recorded for review but cannot change the canonical route or selected module.
- **INV-7 — Branch confidentiality:** every student-visible adaptive module/question belongs to the base module or the selected route; no unselected branch content is returned.
- **INV-8 — Completion/receipt safety:** final submit is enabled only for the required terminal module topology; same-intent replay returns the original durable receipt/digest.

## 3. API / interface changes

No API contract change is planned unless verification finds a concrete correctness gap that cannot be fixed within the existing contract.

| Existing interface | Caller / owner | Planned contract evidence |
| --- | --- | --- |
| `POST /api/v2/student/attempts/{attemptId}/responses:batch` | Student delivery → attempts service | Test positive acknowledgment only after transaction commit; same write IDs/content for ambiguous retries; validate lease, control epoch, module ownership, and server-time writability. |
| `POST /api/v1/assessment-delivery/schedules/{scheduleId}/modules/close` | Personal SAT client → delivery service | Require module/attempt identity, stable close ID, and exact final-write manifest; preserve `CLOSE_WRITES_PENDING` and not-expired behavior; same-intent replay has same route/result. Cohort close remains reconciler/section-clock owned. |
| `POST .../modules/start` and delivery bootstrap/content reads | Student delivery → delivery service | Route selected by server; selected module identity and content fence agree; no client-selected branch authority. |
| `POST /api/v2/student/attempts/{attemptId}/submit` | Student delivery → attempts/terminalization | Require SAT module topology complete; persist terminalization and receipt; identical request replay returns same receipt. |

Authentication remains from verified attempt claims and writer binding. There is no new client-supplied candidate, route, score, deadline, or accepted-at timestamp.

## 4. Critical data flow

1. Student edits an answer. The SAT controller queues a V2 response command with a stable write ID and increasing client version.
2. `SaveResponses` validates the envelope and token, starts a retryable transaction, locks the attempt, resolves module/question ownership, checks lease/control/deadline gates, and checks the immutable mutation ledger.
3. A new command conditionally updates the canonical projection and inserts its ledger record in that transaction. The service emits an acknowledgment only after transaction success. On timeout/connection loss, the client cannot infer whether commit occurred; it retries the same write identity or reads an authoritative snapshot.
4. At M1 end, timer reconciliation or (personal mode) client close enters the close transaction. The close path verifies expiry and the exact manifest against projection plus ledger; it scores durable rows, terminalizes M1, writes one route decision and the selected M2 attempt, and persists a close receipt. These changes roll back together on transaction failure.
5. A student-visible state/content read is derived from the authoritative selected route. The unselected M2 branch remains absent. The selected module is started by its server-defined timing/handoff mode and accepts V2 writes.
6. M2 closes under the same module lifecycle rules. Once all required sections/modules are terminal, final submit locks the attempt, validates topology, computes the final response digest, seals/materializes terminal state, and stores a replayable submission receipt.

The model distinguishes request arrival, database gate time, transaction commit, acknowledgment delivery/loss, and later replay. In particular, it will not equate browser click time with server acceptance.

## 5. Recommended design

### Lean project and state model

Create `verification/lean/sat-module-lifecycle/` with the already used Lean 4.19.0 toolchain, a minimal Lake project, no external package unless a proof requires it, and modules such as `Spec.lean`, `Model.lean`, `Safety.lean`, `Refinement.lean`, and `Examples.lean`. Generate and retain `lake-manifest.json`. The existing access-code proof remains separate because its state machine and claims are different.

The model will keep **candidate-visible branch attempts and route decisions as lists**, not encode them as a single optional branch. That allows the uniqueness theorem to detect a state containing both lower and higher branches instead of making that state impossible by construction. Published branch definitions are modeled separately from candidate-visible module attempts.

The state will contain:

- durable mutation ledger entries and canonical answer projections;
- module-attempt rows and their states;
- route-decision rows with score, policy threshold/revision, selected branch and selected module;
- final submission receipts;
- pending transactions/operation identities and observed acknowledgments, so commit and ACK loss are distinct;
- candidate-visible delivery outputs for branch-leak properties;
- DB-authoritative deadline/config snapshot and lock ownership needed to model interleavings.

Events will include save begin/commit/reject, acknowledgment/lost acknowledgment, duplicate retry, stale write, close/reconcile begin and commit, transaction abort/deadlock retry, process crash/restart, content read, module start, final submit, and receipt replay. A database commit is one atomic model step only for writes the inspected production transaction actually groups. Concurrent requests remain independently schedulable before that step; the lock behavior is represented and then treated as a code/DB refinement obligation.

### Intended Lean math and theorem statements

The following is the **design-level theorem shape**, not checked Lean source. Final definitions and proof terms must compile in the pinned project. No theorem is `PROVED` until `lake build` succeeds and its axiom dependencies are printed and reviewed.

```lean
namespace SATLifecycle

abbrev AttemptId := Nat
abbrev QuestionId := Nat
abbrev WriteId := Nat
abbrev ModuleId := Nat
abbrev SectionId := Nat
abbrev TransactionId := Nat

inductive Branch where
  | lower
  | higher
  deriving DecidableEq, Repr

inductive ModuleState where
  | notStarted | active | review | locked | submitted
  deriving DecidableEq, Repr

inductive MutationOutcome where
  | applied | superseded
  deriving DecidableEq, Repr

structure Mutation where
  attempt : AttemptId
  module : ModuleId
  question : QuestionId
  writeId : WriteId
  leaseEpoch : Nat
  clientVersion : Nat
  payloadHash : Nat
  serverRevision : Nat
  outcome : MutationOutcome
  deriving DecidableEq, Repr

structure Projection where
  attempt : AttemptId
  module : ModuleId
  question : QuestionId
  writeId : WriteId
  leaseEpoch : Nat
  clientVersion : Nat
  payloadHash : Nat
  deriving DecidableEq, Repr

-- Scoring facts are a compact abstraction of the pinned published answer key
-- and canonical response payload. Refinement must show that Go's scorer maps
-- to this relation, including operational-question filtering and SAT SPR.
structure ScoredProjection where
  projection : Projection
  operational : Bool
  correct : Bool
  deriving DecidableEq, Repr

structure ModuleAttempt where
  attempt : AttemptId
  section : SectionId
  module : ModuleId
  role : String
  state : ModuleState
  deriving DecidableEq, Repr

structure RouteDecision where
  attempt : AttemptId
  section : SectionId
  baseModule : ModuleId
  selectedModule : ModuleId
  selected : Branch
  rawCorrect : Nat
  operationalCount : Nat
  threshold : Nat
  policyRevision : Nat
  deriving DecidableEq, Repr

structure FinalReceipt where
  attempt : AttemptId
  submissionId : Nat
  requestHash : Nat
  finalDigest : Nat
  deriving DecidableEq, Repr

structure PendingOperation where
  transaction : TransactionId
  attempt : AttemptId
  payloadHash : Nat
  deriving DecidableEq, Repr

structure Acknowledgment where
  attempt : AttemptId
  writeId : WriteId
  payloadHash : Nat
  deriving DecidableEq, Repr

structure CandidateDelivery where
  attempt : AttemptId
  module : ModuleId
  question : QuestionId
  branch : Option Branch
  deriving DecidableEq, Repr

structure Durable where
  mutations : List Mutation
  projections : List Projection
  scoringView : List ScoredProjection
  moduleAttempts : List ModuleAttempt
  routes : List RouteDecision
  -- Final receipts retain enough request identity to define exact replay.
  receipts : List FinalReceipt

structure State where
  durable : Durable
  pending : List PendingOperation
  acknowledgments : List Acknowledgment
  deliveries : List CandidateDelivery

inductive Event
  | beginSave | commitSave | rejectSave | deliverAck | loseAck | retrySave
  | beginClose | commitClose | abortTx | crash | restart
  | readContent | startSelectedModule | finalSubmit | replaySubmit

-- Define Init and Step over the full state above. In particular, Step has
-- nondeterministic retry/abort/ACK-loss cases and can represent duplicate rows
-- in its list-valued durable state, so the theorems must rule them out.
inductive Reachable : State → Prop
  | init {s : State} : Init s → Reachable s
  | step {s s' : State} {e : Event} :
      Reachable s → Step s e s' → Reachable s'

def Safe (s : State) : Prop :=
  MutationIdsUnique s.durable
    ∧ ProjectionIsVersionMaximal s.durable
    ∧ AcknowledgmentsAreCommitted s
    ∧ RouteRowsUnique s.durable
    ∧ OneSelectedBranchAttempt s.durable
    ∧ RouteMatchesCloseSnapshot s.durable
    ∧ NoUnselectedBranchInDelivery s
    ∧ FinalReceiptsAreStable s.durable

theorem init_safe (s : State) (h : Init s) : Safe s := by ...

theorem step_preserves_safe
    (s s' : State) (e : Event)
    (hs : Safe s) (hstep : Step s e s') : Safe s' := by ...

theorem reachable_safe (s : State) (h : Reachable s) : Safe s := by ...

theorem route_matches_policy_snapshot
    (s : State) (h : Reachable s) (r : RouteDecision)
    (hr : r ∈ s.durable.routes) :
    (r.selected = .higher ↔ r.rawCorrect ≥ r.threshold)
      ∧ r.operationalCount > 0
      ∧ 1 ≤ r.threshold ∧ r.threshold ≤ r.operationalCount := by ...

theorem one_candidate_branch_per_section
    (s : State) (h : Reachable s) (a : AttemptId) (sec : SectionId) :
    (branchAttempts s.durable a sec).length ≤ 1 := by ...

theorem committed_ack_survives_replay
    (s s' : State) (a : AttemptId) (w : WriteId)
    (h : Reachable s) (hcommit : CommittedWrite s a w)
    (hretry : SameLogicalWriteRetried s s' a w) :
    CanonicalOutcome s' a w = CanonicalOutcome s a w := by ...

theorem submit_requires_terminal_topology
    (s s' : State) (a : AttemptId)
    (h : Reachable s) (hsubmit : SubmitCommitted s s' a) :
    RequiredSectionsPresent s' a ∧ AllModulesTerminal s' a := by ...

end SATLifecycle
```

The ellipses above are theorem-proof placeholders in this planning document only; none may enter the proof files. `Init`, `Step`, and the safety predicates will be defined concretely. The list-valued durable model intentionally allows duplicate writes/routes/module attempts so the invariant is not guaranteed by the data type. It will admit a normal full lifecycle trace and model rejected/aborted operations as well as successful ones. There will be no `sorry`, `admit`, project axiom, custom unsound constant, or unchecked native-evaluation dependency.

The core predicates will have explicit definitions equivalent to:

```lean
def mutationCount (d : Durable) (a : AttemptId) (w : WriteId) : Nat :=
  (d.mutations.filter fun m => m.attempt == a && m.writeId == w).length

def MutationIdsUnique (d : Durable) : Prop :=
  ∀ a w, mutationCount d a w ≤ 1

def routeCount (d : Durable) (a : AttemptId) (sec : SectionId) : Nat :=
  (d.routes.filter fun r => r.attempt == a && r.section == sec).length

def RouteRowsUnique (d : Durable) : Prop :=
  ∀ a sec, routeCount d a sec ≤ 1

def newer (m : Mutation) (p : Projection) : Prop :=
  p.leaseEpoch < m.leaseEpoch ∨
    (p.leaseEpoch = m.leaseEpoch ∧ p.clientVersion < m.clientVersion)

def ProjectionIsVersionMaximal (d : Durable) : Prop :=
  ∀ p ∈ d.projections, ∀ m ∈ d.mutations,
    sameAnswerKey p m → m.outcome = .applied → ¬ newer m p

def routePolicy (rawCorrect threshold : Nat) : Branch :=
  if threshold ≤ rawCorrect then .higher else .lower
```

The final Lean code will also define the route's applied-score snapshot and candidate-visible branch-item relation. The invariant predicates will quantify over all candidate and section IDs, not only two hard-coded candidates. Duplicate checking uses explicit counts over the lists; list order is not treated as a lock or as a uniqueness guarantee.

The formal score view will define `operationalCount` as the count of operational rows and `rawCorrect` as the count of those rows marked correct for the canonical response under the attempt's pinned published version. `RouteMatchesCloseSnapshot` will require the route decision's stored counts to equal those pure counts for the closed base module, and its threshold/route to equal the persisted validated policy. `ScoredProjection` is a proof abstraction, not a proposed database column; its Go correspondence is a separate obligation against `loadScoringRowsTx` and `scoreScoringRows`.

The key induction theorem's checked proof shape should reduce to:

```lean
theorem reachable_safe {s : State} (h : Reachable s) : Safe s := by
  induction h with
  | init hInit => exact init_safe _ hInit
  | step hPrevious hStep =>
      exact step_preserves_safe _ _ _ (reachable_safe hPrevious) hStep
```

Each `step_preserves_safe` case must then discharge the actual constructor-specific facts; the induction script alone is not the proof argument.

The key routing math is the code's configuration-derived rule, not a hardcoded sample threshold:

`higher(rawCorrect, threshold) ⇔ rawCorrect ≥ threshold`, with `1 ≤ threshold ≤ operationalQuestionCount`.

The persisted route decision must use the exact close-time `(rawCorrect, operationalCount, policyConfig, policyRevision)` tuple. The model will additionally prove a route cannot be changed by post-close evidence. Unit-level edge examples will cover `threshold - 1`, `threshold`, zero/invalid count, and invalid threshold, using the implementation's validated input domain.

### Proof obligations and method

1. Prove **initiation** for all allowed initial states, including an active M1 attempt with no answer, both published branches, no route row, existing committed answers, and valid section-scope variants.
2. Prove **consecution** separately for every `Event` case. `commitSave`, `commitClose`, route insertion, module start, final submit, abort, and replay each get named preservation lemmas.
3. Prove `reachable_safe` by induction over the actual inductive closure, then prove user-visible corollaries from `Safe`; do not merely restate assumptions.
4. Include an explicit non-vacuity trace that saves M1, loses an ACK, retries it, closes/routs, starts M2, saves/closes M2, and submits. Include hostile traces showing how an unlocked read-check-write close or a non-idempotent retry violates the corresponding invariant.
5. Model liveness separately. Any “eventually routed/submitted” theorem must state scheduler fairness, database availability, retry continuation, and finite-failure conditions. If these cannot be connected to production evidence, mark liveness `INCOMPLETE` and report measured route/submit latency only as empirical evidence.
6. Build every proof module with Lake and print transitive axioms for each exported theorem. Record exact Lean version, command, exit status, project dependency hashes, source commit, theorem names, and axiom output.

## 6. Production and failure-mode deep dives

| Failure | Consequence | Safeguard / enforcement location | Verification | Residual risk |
| --- | --- | --- | --- | --- |
| Commit succeeds but save ACK is lost | Candidate retries an answer that may already be stored | Mutation ledger keyed by attempt/write ID; same request replays stored result | Kill API after commit before ACK; replay via a second API process; compare ledger/projection and client outcome | Commit durability and cross-node DB configuration remain environment obligations |
| Older write arrives after newer version | Newer answer is overwritten | Lease/version ordering in `saveInTx` and canonical projection | Barrier-controlled reversed arrival order for same question | Correctness assumes every production writer uses the same fencing boundary |
| Save races deadline close or reconciliation | Answer omitted from score or included inconsistently | Attempt-row serialization, server DB time, exact close manifest, module CAS | Force save-first and close-first interleavings at the boundary; assert route snapshot equals persisted rows | Browser edits never sent to server cannot be guaranteed included |
| Two close/reconcile workers race | Duplicate routes or M2 attempts | Module conditional update, unique `(attempt_id, section_id)` route row, shared transaction | Run multiple API/worker processes against the actual DB engine with a barrier | Isolation/locking semantics differ across DB products and versions |
| Transaction deadlock/connection loss | Partial state or ambiguous retry | Atomic transaction plus bounded retry and immutable operation IDs | Inject deadlock/abort and connection termination before and after commit | Durable commit depends on DB engine settings and failover behavior |
| Late write after M1 closes | Scores/routes drift after M2 has started | Terminal module write gate; separate late-answer evidence path; no reroute | Retry a previously unseen late write and inspect response, projection, evidence, and route rows | Operators need existing evidence review process for meaningful late answers |
| Wrong branch content leaks | Exposure of unassigned SAT content | Server-side selected-module narrowing, including delivery/media reads | Scan raw responses for both module IDs and question IDs under both route outcomes | Any additional delivery endpoint must be included in reader audit |
| Final submit races unfinished module or is replayed | Attempt closes early or duplicate terminal effects | Attempt lock, SAT topology gate, terminalization transaction and receipt key | Race submit with M2 terminalization; replay same and conflicting submission IDs | External side effects are safe only if they follow the persisted receipt/outbox path |
| Synchronized 1,000-user wave overloads pools/workers | Rejections, retries, route lag or cascading timeouts | No new queue/lock proposed; measure existing pools, bounded retries, DB waits, and worker throughput first | Staged 100/500/1,000 rehearsal with synchronized boundaries and soak | Production SLO, topology, and database capacity are unknown until supplied/verified |

## 7. Ordered implementation phases

| Phase | Files / components | Specific work | Coverage | Done when |
| --- | --- | --- | --- | --- |
| 1. Freeze evidence and assumptions | New plan artifacts under `verification/lean/sat-module-lifecycle/`; existing backend/k6 paths listed below | Record DB engine/version, isolation, timing/handoff mode, replica/worker counts, pool sizes, feature flags, load profile, accepted cutoff semantics, and approved SLOs. Inventory all writers/readers for V2 answers, route rows, content, and receipts. | FR-1–5, NFR-1–5 | Every production-specific claim is `Verified`, `Inferred`, or `Unknown`; no inferred topology appears as fact. |
| 2. Specify and model lifecycle | New Lean `Spec.lean`, `Model.lean`, and `Examples.lean` | Define entities, permitted initial states, transitions and observable outputs. Include arbitrary candidates/interleavings, retries, transaction aborts, ACK loss, crash/restart, both route outcomes, and branch-content reads. | INV-1–8 | Normal trace and hostile traces are represented; no property is true merely because transitions/states were omitted. |
| 3. Prove safety and audit assumptions | New Lean `Safety.lean`, `Refinement.lean`; `lean-toolchain`; Lake project files | Prove init/consecution/reachability and route/ACK/completion corollaries. Add route-policy arithmetic lemmas and axiom audit. Document DB/transaction/clock/worker bridge obligations; do not call these implementation proofs. | FR-1–5, INV-1–8, NFR-5 | `lake build` succeeds; all exported theorem axiom sets are reviewed; no placeholders; proof report records actual output. |
| 4. Close deterministic implementation gaps | Existing Go tests under `backend/go/internal/attempts`, `backend/go/internal/delivery`, `backend/go/integration`, and `backend/go/cmd/api`; add only uncovered tests | Reuse existing save replay, exact manifest, late answer, concurrent route, content fence, completion gate, and API-kill coverage. Add missing multi-process/retry boundary or projection/receipt assertions only when the matrix shows a gap. | FR-1–5, INV-1–8, NFR-1/NFR-3 | Tests run against the pinned production-equivalent SQL engine; each P0 invariant has a DB-backed oracle. |
| 5. Complete end-to-end 1,000-user rehearsal | `k6/sat-exam-day.js`, `k6/sat-m1-m2-handoff.js`, `scripts/sat-answer-comparator.mjs`, disposable DB/API deployment | Reuse the full SAT journey for both sections and final receipt; use the handoff scenario for synchronized final writes and close. Extend only missing branch-score oracle, M2 close/final-submit checks, or high-concurrency boundaries. Run synthetic 100, then 500, then 1,000; then a 1,000-user synchronized close wave and representative soak. | FR-1–5, NFR-1–4 | 1,000 distinct attempts complete within agreed time/SLO; no invariant violations; artifacts include exact workload, build/schema, DB and deployment profile. |
| 6. Publish verdict and remediation | `SPEC.md`, `ASSUMPTIONS.md`, `TRACEABILITY.md`, `PROOF_REPORT.md`, `PRODUCTION_TEST_PLAN.md`, `RECOMMENDATIONS.md` in the verification directory | Separate theorem, correspondence, and production-evidence statuses. Rank any concrete code/SQL/infra mismatch and define regression coverage before making a readiness statement. | All | Every P0 requirement traces to implementation, theorem, and test; unresolved refinement obligations are named; no blanket “production safe” claim remains unsupported. |

### Existing code/test anchors to preserve and map

- Frontend SAT flow: `src/features/student-delivery/hooks/useSatExamController.ts`, `src/features/student-delivery/api/assessmentDeliveryApi.ts`, and SAT student-session routes.
- V2 persistence: `backend/go/internal/attempts/service.go`; schema/constraints in `backend/go/migrations/0049_response_durability_v2.sql`.
- Adaptive route and content narrowing: `backend/go/internal/delivery/start_submit.go`, `service.go`, `reconcile.go`; policy validation in `chooseAdaptiveRoute`.
- Module and final submission gates: `backend/go/internal/delivery/close_module.go`, `backend/go/internal/attempts/submit.go`, `sat_modules.go`; route uniqueness in `backend/go/migrations/0033_sat_runtime_authoring_hardening.sql`; handoff/timing in `0074_sat_module_handoff.sql`.
- Existing database/API evidence: `backend/go/integration/sat_response_durability_test.go`, `sat_last_second_answer_test.go`, `sat_adaptive_routing_test.go`, `sat_shared_row_contention_test.go`, `sat_completion_race_test.go`; `backend/go/cmd/api/sat_failure_rehearsal_mysql_test.go`, `sat_handoff_mysql_test.go`, and `sat_v2_completion_mysql_test.go`.
- Existing load/evidence operations: `k6/sat-exam-day.js`, `k6/sat-m1-m2-handoff.js`, `k6/sat-module-entry-2000.js`, `docs/runbooks/sat-module-handoff.md`.

Do not overwrite or revert existing dirty changes in these paths. First inspect the current diff before extending any script or test.

## 8. Test matrix

| ID | Setup / action | Expected persisted and external outcome | Level | Coverage |
| --- | --- | --- | --- | --- |
| TC-01 | Lean: enumerate each permitted initial state and prove `Init → Safe`. | Empty-active and partially answered attempts are allowed; safety predicates hold without assuming the desired invariant as a precondition. | Model/proof | INV-1–8 |
| TC-02 | Lean: apply every `Step` action to a safe state; include abort, retry, duplicate, stale write, crash, restart, close, route, content read and submit. | Every action preserves safety; rejected/aborted actions do not create durable effects. | Model/proof | INV-1–8 |
| TC-03 | Lean: explicit normal full-flow trace with save, lost ACK, exact replay, M1 close/route, selected M2 start/save/close, final submit. | Trace reaches meaningful terminal state; ACK and route corollaries are derived from invariants. | Model/example | FR-1–5 |
| TC-04 | Lean: construct naïve counterexample traces: duplicate close without CAS/unique key; stale projection write without version order; retry without write ID. | The naïve model reaches duplicate route, regressed answer, or duplicate effect, respectively. | Model/example | INV-1, 2, 5 |
| TC-05 | Same write ID/content submitted concurrently, then one ACK dropped and retried through another process. | One ledger effect and stable stored ACK; projection matches the winning accepted version. | DB integration + API failure rehearsal | FR-1, INV-1–3 |
| TC-06 | Same write ID with different payload; two versions of one question arrive in reverse order. | Reused ID conflicts; lower version is recorded as duplicate/superseded or rejected per current contract and never replaces the newer projection. | Go unit + DB integration | FR-1, INV-1–2 |
| TC-07 | Barrier save transaction versus M1 close/reconciler at deadline; run both serialization orders. | Save serialized first is reflected in the score; close serialized first prevents canonical late mutation; only one close/route outcome commits. | DB integration | FR-2–3, INV-2, 4–6 |
| TC-08 | Close request contains absent, wrong write ID, wrong version/hash, duplicate question, or question outside module. | Close is rejected as pending/invalid; module stays writable only if still within allowed window; no route decision commits. | DB integration + API | FR-2, INV-4 |
| TC-09 | Two API instances and timeout workers close the same M1 simultaneously; inject transient deadlock/retry. | Exactly one route decision and selected module attempt; retry/replay returns same route; no partial terminalization. | Multi-process DB integration | FR-3, INV-4–6 |
| TC-10 | Route data at threshold−1, threshold, invalid 0/count, and invalid threshold; test higher and lower sections. | Persisted decision matches the configured `>=` rule; invalid policy fails closed; route row and module adaptive role agree. | Go unit + DB integration + Lean examples | FR-3, INV-5 |
| TC-11 | For both lower and higher outcomes, query bootstrap, module content, question/media access before and after selected M2 start. | No response contains unselected module/question/media identity; selected content is available only under the selected attempt and authorization. | API integration/e2e | FR-4, INV-7 |
| TC-12 | Submit while M2 missing, active, unresolved, or one required section absent; then submit after all modules terminal. | Incomplete shapes conflict; valid shape seals once; final digest reflects canonical durable responses; same submission replay returns identical receipt. | DB integration + API | FR-5, INV-8 |
| TC-13 | Crash before transaction commit, during commit ambiguity, and after commit before response; restart/retry. | Pre-commit attempt leaves no partial effects; post-commit retry discovers original ledger/close/submission result. | API failure rehearsal | NFR-1/NFR-3 |
| TC-14 | Run current existing regression suites for response durability, last-second save, route race, branch filtering, final topology, close ACK and final seal. | No regressions; existing behavior/statuses remain compatible. | Go unit/integration | FR-1–5 |
| TC-15 | Full 1,000-candidate SAT run: 1,000 distinct attempts; realistic answer writes, both section M1→M2 flows, terminal modules and final submit. | 1,000/1,000 reach intended outcome within confirmed bounds; independent DB comparator finds no missing/changed acknowledged answers, wrong score/route, duplicate branches or receipts. | k6 + DB invariant query | FR-1–5, NFR-1–4 |
| TC-16 | Synchronized 1,000-candidate M1 last-answer/close/handoff burst; exercise both branch outcomes and near-threshold scores. | Zero lost acknowledged final writes, duplicate route rows, wrong branch, unselected-content leak, or unexplained terminal failure; report tail latencies, retries and pool/lock pressure. | k6 + API + DB integration | FR-1–4, NFR-1–2 |
| TC-17 | Soak at 1,000 active attempts using observed/declared save and read mix; include one API restart and worker catch-up. | Backlog and transaction latency recover; invariant queries stay clean; errors and throttling meet approved SLO and all accepted writes remain durable. | Production-equivalent load/soak | NFR-1–4 |

Every row above is **planned**, not evidence that it has been executed. Property tests/bounded exploration can find counterexamples but do not replace the universal Lean induction theorem or the unbounded claim boundary.

## 9. Assumptions, rollout, and recovery

### Assumption register

| Assumption / unknown | Current status | Owner and validation |
| --- | --- | --- |
| Production timing model and SAT handoff mode (`cohort_section_v3`/other cohort model versus `sat_personal_v1`, server-start versus client-start) | Unknown; code has distinct paths | Deployment/SAT operations: inspect the active schedule runtime and pin it into test fixture. Capacity verdict applies to the actual production profile. |
| Production DB product/version, transaction isolation, durability/failover settings, and whether student reads use replicas | Unknown. Local Compose uses `pingcap/tidb:latest`; adjacent report used local MySQL 9.6. Neither establishes production DB. | Platform/database owner: capture runtime DB and configuration; run locking, transaction, restart tests on the same engine/version or approved equivalent. |
| API/worker instance count, pool limits, autoscaling and worker scheduler/fairness | Unknown | Operations: capture deployment manifests/metrics; use same or explicitly scaled topology for the rehearsal. |
| Candidate-answer frequency/payload and production p95/p99 SLO | Unknown beyond current harness defaults | Product/operations: derive from client telemetry and exam SLO; approve numerical pass criteria before load verdict. |
| Candidate edits not sent before close | Not realizable by backend guarantee | Product contract: communicate only server-accepted/durable response inclusion; do not promise click-time inclusion. |
| Transaction commit is atomic across response/ledger or close/score/route rows | Supported by source transaction boundaries but DB behavior is a refinement obligation | Backend/database: verify statements share the transaction and DB integration exercises commit/abort/restart behavior on target engine. |

### Rollout / execution order

1. Create and migrate a disposable isolated staging schema using the same migration head and DB version/config intended for the rehearsal.
2. Deploy the exact candidate build and worker/API configuration; capture commit SHA, image/build identity, feature flags, pool sizing, replica count, and timing/handoff settings.
3. Provision synthetic candidates and schedule data; ensure both adaptive outcomes and threshold edges are represented. Keep credentials/answer payloads out of ordinary logs; retain only restricted run artifacts and hashed identifiers where possible.
4. Run deterministic DB/API race coverage first, then 100-user smoke, 500-user rehearsal, 1,000-user full flow, synchronized 1,000-user handoff wave, and soak. Stop on any invariant violation rather than retrying it into a green aggregate.
5. Query the database independently for duplicate route rows, branch attempts, mutation/projection disagreement, terminal topology, result/receipt count, and missing expected answer hashes; compare against the k6 action journal.
6. Archive run artifacts and clean up only the disposable fixture according to the existing runbook. Do not mutate a shared or live schedule for cleanup.

No production deployment or schema migration is proposed in this verification-only scope. If a test finds a correctness defect, make the smallest focused code/constraint change in a separate implementation step, add the reproducing test first where practical, rerun the full regression matrix, and update the proof refinement map. Any migration requires its own compatibility, lock-duration, rollout, and rollback plan.

## 10. Traceability, verdict rules, and open decisions

| Requirement | Lean theorem / property | Code path | Planned test oracle |
| --- | --- | --- | --- |
| FR-1 save durability/idempotency/order | `MutationIdsUnique`, `ProjectionIsVersionMaximal`, `AcknowledgmentsAreCommitted`, `committed_ack_survives_replay` | `attempts.SaveResponses` / `saveInTx`; migration `0049` | TC-05, TC-06, TC-13, TC-15 |
| FR-2 cutoff and exact close snapshot | `CloseOnlyAfterDeadline`, `ManifestNamesDurableWrites`, `CloseScoreAtomic` | `delivery.CloseModule`, `pendingCloseWritesTx`, `reconcile` | TC-07, TC-08, TC-16 |
| FR-3 one correct adaptive route | `RouteRowsUnique`, `OneSelectedBranchAttempt`, `route_matches_policy_snapshot` | `finalizeModuleWithBasisTx`, `nextModuleTx`, route uniqueness migration | TC-09, TC-10, TC-16 |
| FR-4 branch confidentiality and M2 progress | `NoUnselectedBranchInDelivery`, selected module transition | delivery bootstrap/content/media filtering and `StartModule` | TC-11, TC-15, TC-16 |
| FR-5 final attempt safety | `submit_requires_terminal_topology`, `FinalReceiptsAreStable` | `Submit.submitInTx`, `ensureSATModuleTopologyTx`, terminalization | TC-12–TC-15 |

**Status vocabulary:** For each theorem use `PROVED`, `FAILED`, `NOT_RUN`, or `INCOMPLETE`; for correspondence use `MECHANIZED`, `REVIEWED_WITH_TESTS`, `UNVERIFIED`, or `MISMATCH`; for environment evidence use `VALIDATED_IN_STATED_PROFILE`, `PARTIAL`, `NOT_TESTED`, or `FAILED`. A checked Lean model alone cannot yield a production-ready result. Any critical unverified database, deployment, timing, content-reader, or scheduler assumption leaves production correctness `NOT ESTABLISHED`.

**Actual unresolved decisions before the 1,000-user verdict:** production timing/handoff profile, database product/version and topology, official error/latency SLO, and whether the target is exactly 1,000 active candidates or 1,000 simultaneous admission attempts as well. Default recommendation: qualify the 1,000 active-candidate lifecycle from already admitted synthetic attempts; test admission bursts separately because they exercise a different subsystem and prior access-code capacity evidence is not lifecycle evidence.

### Anti-vacuity review checklist

- Initialization includes active attempts, both published adaptive branches, no selected route, existing durable responses, and permitted section-scope variants.
- Route decisions and module attempts are collections, so the model can represent duplicates and prove they are unreachable under `Step`.
- Save, close, retry, ACK loss, abort, crash/restart, late evidence, content read, module start, and final submit are modeled; transaction atomicity is limited to verified SQL boundaries.
- The M1→M2→final-submit normal trace is executable in the model and each preservation proof quantifies over every `Step` case.
- Score policy uses validated persisted threshold data, not a chosen safe constant; both lower and higher outcomes and exact threshold boundary are included.
- No offline click is silently equated with accepted/durable data, and no liveness claim omits fairness/availability assumptions.
- Proof output includes actual `#print axioms` transitive audit; model testing/bounded exploration is labeled as testing rather than proof.
- The 1,000-user result is tied to an explicit deployment profile and workload. It is never described as arbitrary or infinite capacity.
