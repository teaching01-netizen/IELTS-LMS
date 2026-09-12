# Phase 02 - Scoring chain, terminalization and job ownership

Wave B (parallel with Phase 03 and Phase 04 after Phase 01). Sources: WP02 + WP04 (docs/optimize.md). Owner: Integrity / worker owner. Depends on: Phase 01. Coordinates shared runtime/worker files with Phase 04.
Status: Planning only - no code changes by this file. All paths and symbols below were rediscovered from the current tree and must be re-confirmed at implementation start (WP00 rule: historical paths are hypotheses until re-inspected).

---

## 1. Objective

Make the authoritative path response - routing - score - result and the terminal path submit - receipt - projection - enqueue - worker - seal correct, deterministic, and recoverable for IELTS, SAT, and ACT under crashes, races, retries, and API/worker process separation:

1. One authoritative response source per provider with one explicit source resolver (V2-only SAT confirm-or-resolve; no uncontrolled dual writes), adaptive routing that scores what was administered, and pinned-revision scoring inputs.
2. Correct scores: administered-set only, pinned content/key/policy revisions, pretest excluded, unadministered/null/pending/invalidated never coerced to incorrect, client-supplied scores never authoritative, missing keys/policies fail closed with approved behavior (never fabricated zero or interpolation).
3. One terminalization authority with outcome-only replay compatibility, immutable terminal facts, SAT provisional vs final seal separation with abandoned-client recovery, and audited result repair (never silent overwrite).
4. Durable job ownership: every autosubmit/provisional/retry unit stays owned until finished, permanently classified, or dead-lettered; parent fan-out completes only under the completion predicate; transient/permanent classification, poison isolation, idempotent claim/requeue, lease expiry, and post-commit side-effect safety hold across the API/worker process boundary and across binary rollback.
5. Close AC05, AC06, AC09, AC10, AC11, AC12 with real-DB, two-process, crash, duplicate-delivery, and partial-fan-out evidence that Phase 07 can rerun unchanged against the integrated candidate.

Preserve: version pinning, wire compatibility, server-side timing and permissions, response fencing, immutable terminal facts, grading-release intent. Investigate before repairing: reproduce or benchmark first, add a failing behavioral test for confirmed defects, apply the smallest complete repair; close already-satisfied requirements with evidence, not churn.

Invariants owned here: I04 (one compatible terminal outcome), I05 (administered/key/policy agreement across scoring, review, export), I08 (pinned published version), I09 (retry without duplicate effects, no ownerless work), I10 (partial failure leaves a valid prior state or a durable observable recovery path).

---

## 2. Scope and out of scope

### 2.1 In scope (WP02 + WP04)

- S1. Authoritative response source per provider + adaptive routing (SAT base to lower/higher; ACT science key order; IELTS objective/writing split). Anchors AC05, AC06.
- S2. V2-only SAT confirm-or-resolve: prove current state; if V2-only already works, add or strengthen the missing regression evidence instead of another bridge; else implement ONE explicit source resolver with documented fallback precedence and corruption handling. Anchors AC05.
- S3. Administered-set and pinned-revision scoring; pretest, unadministered, null, blank, invalid, pending-vs-incorrect semantics; legacy fallback only where C01 allows. Anchors AC05, AC06, AC12.
- S4. Non-authoritative client scores; missing-key and missing-policy fail-closed behavior; no fabricated scores. Anchors AC06.
- S5. Result repair as a separate authorized audited operation (never overwrite immutable issued results to hide a deployment failure). Anchors AC06, AC12.
- S6. Single terminalization authority + compatible replay rules; enumerate every caller and legacy path including the compatibility trigger. Anchors AC09.
- S7. SAT provisional vs final seal + result readiness; define recovery ownership when the client disappears after provisional success (watchdog). Anchors AC11.
- S8. Transaction boundaries for receipt, terminal projection, scoring snapshot, audit, and durable work enqueue; short deterministic transactions; no external calls inside transactions. Anchors AC09, AC10, AC11.
- S9. Autosubmit fan-out completion predicate; cursor-batched fan-out; late-arrival rescan + follow-up enqueue. Anchors AC10.
- S10. Durable retry ownership using the existing job model first; a child-work table ONLY if demonstrated requirements cannot be met simply (requires written proof + WP12 gate). Anchors AC10.
- S11. Transient vs permanent classification, poison isolation (per-attempt DLQ), idempotent requeue, lease expiry, claim correctness (update vs skiplocked modes, partitions). Anchors AC10.
- S12. Post-commit side-effect safety: no duplicated external effects from transaction retries; durability-required post-commit work enqueued transactionally; live fan-out best-effort only. Anchors AC11.

### 2.2 Out of scope - consume contracts, do not own

- Phase 03 (client durability): durability engine, write identity and ack matching, pending intent, replay, conflict archive, storage faults (C02/C08). Phase 02 owns the server receipt/replay contract; Phase 03 owns the browser side. Coordinate on SUBMISSION_ID_MISUSE and ack vocabulary (C07 read-only).
- Phase 04 (auth, API semantics, runtime): authentication and authorization, admission, session/token binding, revocation, API envelope and serialization, bootstrap POST/304 semantics, runtime clocks/caches/poll freshness, WS/live process-boundary transport (C04/C05/C07). Phase 02 sequences shared files (see section 16).
- Phase 05 (data/MySQL): index design, pool sizing, EXPLAIN calibration, migration authoring/execution, backup/restore rehearsal (WP11/WP12). Phase 02 freezes query shapes and gates ALL DDL through WP12.
- Phase 06: telemetry schema, SLOs, CI gates (read WP10/WP13 budgets; emit only already-defined counters).
- Phase 07: integrated AC01-AC20 rehearsal, rollout, cleanup decisions (Phase 02 hands off evidence + commands).

Explicit non-goals: rewrite; new queue infrastructure (no Redis, no second queue); microservices; sharding; blanket dependency upgrades; guessed index DDL; timeout increases as a diagnosis substitute; V1-write and compatibility retirement (WP16, evidence-gated, Phase 07); any scoring/timing/grading-permission/admission business-rule change without an approved spec; production data repair, migration execution, deployment, credential access (not authorized by the plan alone).

---

## 3. Dependencies

### 3.1 Required from Phase 01 before starting (BLOCKING)

Do not start implementation until Phase 01 freezes these at versioned revisions. Record the exact contract version numbers (for example C01v3) at kickoff:

- C01 Response ownership and scoring: per-provider authoritative store (V2 rows vs legacy blobs/columns), administered-question identifiers, answer-key revision and pinning rule, pretest flag source, unadministered/null semantics, legacy fallback conditions, immutable result inputs. Phase 02 must not invent fallback precedence - implement exactly C01.
- C02 Durable write and replay: attempt identity, lease epoch, control epoch, write ID, client version, canonical payload shape, acknowledgements, revision, retryability, exact-replay behavior. Distinguish a transport retry of an issued write from a new reconciled write under a newer control epoch. No replay across device ownership or terminal boundaries. Phase 02 consumes this for the submit receipt and FinalCommands fencing.
- C03 Terminalization: provisional versus terminal states, submission-ID ownership, request hashing, outcome compatibility, response digest, server submission time, result availability. Preserve existing supported wire shapes unless a versioned change is approved.
- C05 Runtime and read freshness: server-clock authority, revision ordering, ETag and conditional-read semantics, poll hints, pause/extension behavior, cache keys, invalidation, worker-originated change visibility bound and mechanism (durable bus, invalidation signal, or bounded authoritative refresh - never shared memory). Phase 02 SAT-final visibility and autosubmit observability tests assert exactly this bound.
- C06 Work ownership and projection: identity, owner/lease, eligible retry state, idempotency rule, completion condition, failure classification, recovery command per durable job and child work item. An unfinished attempt must not become ownerless because a sibling succeeded. Phase 02 implements exactly this - no second retry owner.
- AC matrix + fixtures: AC05/06/09/10/11/12 skeletons, deterministic IELTS, SAT-adaptive, and ACT-science fixtures, sanitized scoring policies and keys, administered/unadministered/pretest fixtures, pinned-vs-draft fixtures. Reuse them - do not fork.
- Contract test harnesses: OpenAPI DTO snapshots for submit/seal/results paths, error-envelope vocabulary (SUBMISSION_ID_MISUSE wire code vs Go identifier, acknowledgements vs internal acks - reverify serialization per C07 read-only).

If any C01/C02/C03/C05/C06 version changes mid-phase: stop, re-baseline affected steps, invalidate only producer/consumer scopes per overall-plan decision 2. Never silently change a frozen interface mid-wave.

### 3.2 What Phase 07 needs from Phase 02 (handoff contract)

- Frozen candidate identity (source revision + dirty-tree hashes, schema version, config fingerprint, lockfiles) for every claim.
- Passing AC05/06/09/10/11/12 evidence runnable by the L4/integration owner without Phase 02 authors (commands + isolated-DB setup + two-process topology, section 14).
- Resolver precedence doc + terminal state machine + job-ownership schema + repair audit procedure (operator-usable, sections 6 and 11).
- Query-shape freeze notice for Phase 05 (which SQL changed, which predicates are load-bearing).
- Known limitations, residual risks, stop conditions (sections 12 and 15).

### 3.3 WP12 gate for any DDL (BLOCKING for schema)

Every schema mutation in Phase 02 (including a proposed child-work table, DLQ columns, or index tweaks presented as a fix) requires the WP12 gate BEFORE DDL: centrally allocated migration filename (never assume the next number, historical 0058 does not imply 0059), fresh-install + representative-upgrade + interrupted-rerun + old/new binary compatibility rehearsal, DDL implicit-commit and metadata-lock and disk-space assessment, expand/contract preference with deferred contraction, dry-run counts + audit output + backup + reconciliation checks for any backfill or dedup. Binary rollback must keep queued payload versions readable; never purge backlog as recovery. If the gate cannot be met, do the work without DDL on the existing job model and record the deferral.

---

## 4. Affected files (rediscovered - re-confirm symbols at start)

Ownership key: O = Phase 02 mutates (sole owner while active); R = read-only dependency; S = shared with Phase 04 - sequence or transfer explicitly (section 16). One mutation owner per file at a time.

4.1 backend/go/internal/assessscore/score.go [O]. Symbols: SATResponseCorrect, SATCorrectAnswer, responseMatches; stdlib-only read-path scorer mirroring delivery.responseIsCorrect. Action: pin the null-vs-incorrect display rule at callers (scorer false does not imply incorrect); add the missing-key, blank, malformed-definition matrix tests.

4.2 backend/go/internal/assessscore/v2read.go [O]. Symbols: V2ResponseToScorerInput, V2MarkedForReview; canonical-envelope to scorer-input conversion; parity anchor with attempts.payloadAnswer, mergeProjection CanonicalJSON, and answerblobs.Project. Action: own the read/write extraction parity; any canonical-shape change goes through here plus C01.

4.3 backend/go/internal/delivery/service.go plus reconcile.go, start_submit.go, versioncache.go [O for scoring/routing; S for live/cache wiring]. Symbols: Service.finalizeModuleTx (V2 scoring + adaptive route + assessment_route_decisions INSERT), responseIsCorrect, score_scoring_rows, VersionCache, SetLive / SetLiveDirect / SetLiveSink, completer AssessmentCompleter. Action: implement or verify V2-only plus resolver precedence; keep the live/cache posture byte-identical unless Phase 04 transfers ownership.

4.4 backend/go/internal/sat/service.go [O]. Symbols: Service.CompleteAssessment, scoreAndPersist, ReconcileProvisional and ReconcileProvisionalBatch, repairOne, ReconcileModuleTimeouts, OldestProvisionalAgeSeconds, PolicyScorer and DeterministicScorer (test fixture only), routeFromAdaptiveRole, sealAttemptTx, lockedSubmissionID, loadModules, loadPolicy. Action: provisional-to-final seal, watchdog recovery, policy fail-closed, module-timeout finalization.

4.5 backend/go/internal/act/service.go [O]. Symbols: ComputeScienceScore, SealScienceScore, answersEqual, answerKeyFromContent, weightsFromConfig, orderedQuestions; ExamTypeACT and SectionScience constants from the 0050 lineage. Action: server-authoritative science scoring; client-score ignore by construction; zero-scorable-question fail-closed.

4.6 backend/go/internal/grading/service.go plus projection.go, review_read.go, result_read.go, sessions.go [O on the scoring-source side; R on release mutations]. Symbols: GradeObjective with key precedence (schedule override wins, else sealed answer_definition), submission/section/result lifecycles, state_test/source_test/sessions_test/result_read_test. Action: verify key precedence and override path agree with C01; wire the audited repair path (release mutations stay grading-owned).

4.7 backend/go/internal/results/service.go [O on read-path parity]. Symbols: Service (reads only; release mutations live in grading.Service), OutcomeScored/Pending/InvalidatedProctor/InvalidatedTimeout, ReleaseDraft through ReleaseInvalidated, snapshot re-materialization (released results rebuilt from the persisted student_results snapshot, never recomputed from live answers). Action: prove seal-time vs detail vs export agreement (I05) and released-snapshot immutability.

4.8 backend/go/internal/attempts/service.go + types.go + validate.go + canonicaljson.go + materialize.go [O on submit-adjacent fencing; R on the save path shared with Phase 03]. Symbols: Service.SaveResponses and saveInTx, FinalDigest, commandToAny, QuestionResolver and RuntimeLocker ports, RowFirst posture. Action: keep the submit preamble fencing identical to save fencing; own the FinalCommands path through saveInTx.

4.9 backend/go/internal/attempts/submit.go [O - load-bearing]. Symbols: Service.Submit and submitInTx, Sealer interface with SealSubmitted (terminalization boundary, avoids an import cycle), receipt replay via loadSubmissionReceipt and insertSubmissionReceipt, global submission-ID ownership via attempt_submissions_v2, lease/control/revision fencing, runtime gate lock, SAT provisional claim (sets delivery_status submitted and phase post-exam, persists digest, NEVER sets submitted_at or final_submission), IELTS/ACT seal-first-then-digest, ComputeDigestInTx over projection hashes, submitRequestShape and HashResponse. Action: the single submit authority (non-SAT) and provisional authority (SAT); transaction-boundary proof.

4.10 backend/go/internal/terminalization/service.go [O - sole authority, load-bearing]. Symbols: Service.Terminalize, TerminalizeInTx, sealAttemptInTx, SealCommand, SealResult (Created=false is an outcome-compatible replay), Receipt (attempt_id PK), TerminalizationRepository (FindByAttemptID + Insert ONLY), OutboxEnqueuer (EnqueueInTx), AttemptScorer port, OutcomeCompat, SATOutcomeStatus, ClaimPredicate, ValidateSealCommand, outcome/reason/actor vocabularies, materializeBlobsForSeal (protocol-2 only; V1 blobs never touched), buildServerSnapshot, buildFinalSubmission, materializeProviderResult, materializeSATResult, materializeACTResult, RepairMissingReceipts (stragglerSweepSQL), RepairSATResults (satGapSweepSQL), conflict codes TERMINALIZATION_CONFLICT / BASE_REVISION_MISMATCH / ATTEMPT_PROCTOR_BLOCKED. Action: own receipt-first seal, compatibility, snapshot/projection/enqueue atomicity, audited repairs.

4.11 backend/go/internal/outbox/outbox.go + dlq.go + metrics.go [O]. Symbols: Repository and ClaimBatch, claimBatchUpdate and claimBatchSkipLocked, duePredicate, ClaimMode update vs skiplocked, WithClaim partitions with MOD(CRC32(aggregate_id), N) disjoint leases, BackoffFor (5s times 2 to the n-1, capped 300s, terminal at 8 or more attempts), markTerminal and MarkFailed, QuarantineAttempt, RequeueDeadLetter, IsExecutable and SkipEnqueue, families (auto_submit_schedule_attempts_requested is executable; attempt_terminalized, runtime_changed, roster_changed are wakeups), ClaimLimit 100, ClaimLeaseSecs 60, PurgeAfterHours 72. Action: own claim/retry/DLQ/requeue semantics per C06; no new queue infrastructure.

4.12 backend/go/cmd/worker/main.go [O on orchestration/fan-out; S with Phase 04 on process wiring]. Symbols: Jobs list (DrainOutbox, ReconcileRuntimeTimeouts, ReconcileExpiredSections, ReconcileSATModules, ReconcileSATProvisionalCompletion, RepairSATTerminalResults, RepairMissingTerminalReceipts, RunTerminalInvariantAudit, RunGradingProjection, RunRetention, RunMediaCleanup), worker struct with sealer override for tests, drainOutbox, runHotCycle, runMaintenanceCycle, executeOutboxEvent (per-attempt try/continue), sealAutoSubmitAttempt (RequestID reuses event.ID), rescanAutoSubmitDelta, enqueueAutoSubmitFollowUp, listAutoSubmitAttempts (cursor batch 500), markFailed, allPermanent, hasTransientFailure, isTerminalConflict, publishWakeup, runRequeueDeadLetter and requeueDeadLetterID. Action: own fan-out completion, poison isolation, rescan, requeue CLI.

4.13 backend/go/internal/app/app.go [S - integrity/integration owner; Phase 04 touches the same graph]. Symbols: Services, Deps, Build(cfg, pool, deps), Completer(pool, s) - the single SAT/ACT provider switch shared by API and worker. Action: submit wiring changes as diffs to the integration owner; never edit concurrently with Phase 04.

4.14 backend/go/cmd/api handlers (handlers_v2.go, handlers_delivery.go, submit/terminal edges) [R]. Action: read-only for Phase 02; supply required DTO/wiring diffs to the contract owner (Phase 04 applies).

4.15 api/openapi/openapi.yaml [R]. Action: read-only; change only via the contract owner plus a versioned approval.

4.16 backend/go/cmd/migrate lineage [R, database owner]. Action: allocate filenames centrally via WP12; never assume the next number.

Rediscovery checklist at phase start (record evidence): search for finalizeModuleTx, SATResponseCorrect, V2ResponseToScorerInput, Submit and submitInTx, ComputeDigestInTx, Terminalize, OutcomeCompat, scoreAndPersist, ReconcileProvisional, ComputeScienceScore, ClaimBatch, BackoffFor, executeOutboxEvent, sealAutoSubmitAttempt, and app Build across backend/go; confirm the SQL predicates in section 6 still match the tree; confirm OpenAPI submit/seal/result shapes byte-for-byte.

---

## 5. New files (proposed - prefer extending current tests when they already own the behavior)

- NEW backend/go/internal/delivery/source_resolver.go [Phase 02]. The ONE explicit source resolver for WP02: ResolveScoringSource returns source (v2_only, legacy_only, mixed_v2_authoritative), the administered set, key revision, and warnings, plus precedence and corruption handling. Pure and deterministic; no HTTP; no ad-hoc dual reads elsewhere. If V2-only already holds, this file documents and enforces it (fail closed on unexpected legacy rows) instead of adding a bridge.
- NEW backend/go/internal/delivery/source_resolver_test.go [Phase 02]. Resolver unit matrix: V2-only, legacy-only inside the allowed compat window, mixed (V2 wins plus warning), corrupt V2 envelope, missing key, pretest-only, unadministered-only. sqlmock level, no live DB.
- NEW backend/go/internal/terminalization/repair_audit.go, or an audited repair path in the existing service [Phase 02, DDL via WP12]. Authorized result-repair operation: permission-check hook, before/after snapshot capture, reason + actor + ticket reference, append-only audit row, never mutates the attempt_terminalizations PK row; repairs only materialized result tables plus the re-release state machine.
- NEW backend/go/internal/terminalization/terminal_state_machine.md, proposed under docs/production-hardening/ [Phase 02]. Human-readable terminal state machine plus compatibility table plus SAT provisional diagram (evidence pointer, not a second implementation).
- NEW backend/go/internal/sat/provisional_recovery_test.go [Phase 02]. AC11: kill-after-provisional, restart, watchdog to final seal; asserts no fabricated score when policy or modules are incomplete (stays provisional). Requires an isolated live DB.
- NEW backend/go/internal/terminalization/seal_race_test.go [Phase 02]. AC09: real-DB barrier submit-vs-terminate, submit-vs-submit, worker-vs-API races; both-winners matrix; outcome-only replay. Isolated live DB.
- NEW backend/go/cmd/worker/autosubmit_completion_test.go [Phase 02]. AC10: partial fan-out (success + transient + poison), completion predicate, rescan delta, overflow follow-up, DLQ evidence, idempotent retry. sqlmock plus one isolated-DB crash test.
- NEW backend/go/internal/delivery/scoring_parity_test.go [Phase 02]. AC05/06/12: V2-only plus mixed-compat plus pinned-vs-draft plus pretest/unadministered/null matrix across seal-time vs results-detail vs export.
- NEW docs/production-hardening/scoring-terminalization-evidence.md, proposed [Phase 02]. Per-AC evidence ledger rows (section 11 template style from docs/optimize.md): candidate identity, commands, exit statuses, artifacts, limitations.

All new test files follow WP13 isolation: separate disposable databases/schemas/accounts/ports; no shared-state collisions; DB tests never run against a shared dev database.

---

## 6. Interfaces and contracts

### 6.1 Consumed frozen versions (record exact C-v numbers from Phase 01 at kickoff)

- C01 response ownership and scoring: authoritative store per provider; administered-set identifier source (enrollment/routing vs content tree); key-revision pinning (published_version_id at issuance, I08); pretest flag field; unadministered/null/blank/invalid/pending-vs-incorrect verdict table; legacy fallback window plus metric; immutable result inputs (digest + snapshot + policy version). Phase 02 implements exactly this table - any sensible default beyond C01 is a defect.
- C02 durable write and replay: attempt, lease, and control epochs; submission-ID uniqueness scope (global, attempt_submissions_v2.submission_id); request-hash input shape (submitRequestShape); exact-replay condition (same attempt + same submission ID + same request hash returns the stored receipt; lease still validated); misuse code SUBMISSION_ID_MISUSE (409) for same-ID/different-payload and cross-attempt reuse. No replay across terminal boundaries or device-ownership changes.
- C03 terminalization: vocabularies (outcome submitted or terminated; reason student_submit, sat_complete, time_expired, auto_stop, proctor_complete, proctor_end, proctor_force_submit, proctor_terminate, legacy_unknown; actor student, proctor, system); outcome-only compatibility; SAT outcome_status mapping; receipt immutability; result-availability rule (provisional is not releasable).
- C05 runtime and read freshness: worker-to-API visibility mechanism plus bound; server-clock authority (UTC_TIMESTAMP(6) / dbTime); which reads may be cached and which must be authoritative (submit, seal, and receipt paths are always authoritative).
- C06 work ownership and projection: identity, lease, idempotency, completion, failure classes, recovery commands (operator requeue) per durable unit; fan-out completion predicate; backoff, terminal, DLQ, and requeue rules; claim modes. Phase 02 implements exactly this - no second retry owner.

### 6.2 Source-resolver precedence spec (implements C01; WP02 S2-S3)

Pseudocode for delivery/source_resolver.go. All scoring paths call this; no second ad-hoc V2-vs-legacy branch anywhere (CI grep blocks reintroduction). V2-only steady state means the legacy arm is a metric plus compat path, never a tie-breaker:

```text
ResolveScoringSource(attempt, module):
  administered = administeredSet(attempt.published_version_id, module)  # pinned at issuance (I08)
  FOR q IN administered ORDER BY question_id:
    v2  = readV2(attempt, q)       # attempt_responses_v2 canonical envelope
    leg = readLegacy(attempt, q)   # legacy response column or question_responses
    IF q.is_pretest: EXCLUDE from aggregation; review/export only per C01
    ELIF v2 present and valid: USE v2.answer (authoritative).
      IF leg present and leg != v2.answer: emit source_warning metric only, never score leg.
    ELIF v2 present but corrupt: verdict = pending (never incorrect); emit corrupt_source;
      continue module scoring for healthy questions; seal only if C01 permits partial, else fail closed.
    ELIF v2 absent and leg present and C01 fallback window open: USE leg + legacy_source metric;
      record fallback in snapshot provenance.
    ELIF v2 absent and leg present and window closed: verdict = pending (fail closed).
    ELSE (both absent): verdict per C01 null table (blank vs never-administered vs invalidated;
      never incorrect by default).
    Questions NOT IN administered (unadministered branch or adaptive non-taken path):
      EXCLUDE from scoring entirely (not even as incorrect).
  key = pinnedKey(administered.revision, policy_version)  # NEVER live draft (AC12)
  provenance = {source per question, key_revision, policy_version, fallback_used}
  RETURN (verdicts, provenance)
```

Hard rules: one resolver; seal-time, detail, and export share it through the assessscore parity helpers; V2ResponseToScorerInput is the envelope-to-answer extraction both sides use.

### 6.3 Terminal state machine (implements C03; invariants I04/I10)

```text
States (student_attempts projection + receipt):
  RUNNING:            submitted_at NULL, final_submission NULL, phase != post-exam
  PROVISIONAL (SAT):  delivery_status = submitted, phase = post-exam,
                      submitted_at NULL, final_submission NULL, receipt(provisional=true) EXISTS
  SEALED_SUBMITTED:   receipt EXISTS outcome = submitted
                      + submitted_at/final_submission SET + results materialized
  SEALED_TERMINATED:  receipt EXISTS outcome = terminated + ditto
                      (SAT outcome_status invalidated_*; results reflect invalidation,
                       never a fabricated score)

Transitions (ONLY via sealAttemptInTx, SAT scoreAndPersist, or the worker seal path):
  RUNNING --student submit (non-SAT)--> SEALED_SUBMITTED   [seal-first-then-digest, one tx]
  RUNNING --student submit (SAT)-----> PROVISIONAL         [provisional claim, one tx; NO seal]
  PROVISIONAL --CompleteAssessment--> SEALED_SUBMITTED (sat_complete) [score+seal, one tx]
  PROVISIONAL --watchdog repairOne--> SEALED_SUBMITTED (sat_complete, actor=system)
  ANY --proctor/terminate/deadline/worker--> SEALED_*      [ClaimPredicate-guarded claim]
  SEALED_x --same-outcome request--> SEALED_x (replay, created=false; reason/actor ignored)
  SEALED_x --cross-outcome request--> REJECT TERMINALIZATION_CONFLICT (never overwrite; I04)
```

Compatibility predicate (load-bearing, pinned by tests): OutcomeCompat(existing, requested) returns true if and only if existing equals requested (reason ignored on replay; cross-outcome always conflicts). SAT materialization maps through SATOutcomeStatus(outcome, actor): submitted maps to pending; terminated+proctor maps to invalidated_proctor; terminated+other maps to invalidated_timeout.

Claim guard (conditional UPDATE, exactly-once claim). Both branches include the provisional OR-arm so rows written by the legacy/student path as submitted/post-exam with a NULL projection can still be claimed exactly once:

```sql
-- ClaimPredicate from terminalization/service.go
((submitted_at IS NULL AND phase <> 'post-exam')
 OR (delivery_status = 'submitted' AND phase = 'post-exam' AND final_submission IS NULL))
```

### 6.4 Job-ownership schema (implements C06; current tables - confirm against the migration head)

- outbox_events: id (UUID), aggregate_kind/id, revision, event_family. Lease: claim_token, claimed_by, claimed_at, claim_expires_at (60s lease), publish_attempts bumped at claim. Completion: published_at (ack), next_attempt_at (backoff), failed_at + last_error (terminal park). Due predicate: published_at IS NULL AND failed_at IS NULL AND (next_attempt_at IS NULL OR next_attempt_at <= NOW()) AND (claimed_at IS NULL OR claim_expires_at < NOW()).
- outbox_dead_letters: id, source_event_id + aggregate_id UNIQUE, requeue_token CHAR(64) UNIQUE. INSERT IGNORE makes per-attempt quarantine idempotent; the resolved_at guard makes requeue exactly-once. Operator requeue-dead-letter inserts a fresh event with the same idempotency key. Missing or unresolvable IDs fail closed (no invented work).
- attempt_terminalizations: attempt_id PK, terminalization_id UNIQUE. Plain INSERT (duplicate key means a race - re-read and apply the compatibility check); request_id carries the autosubmit event.ID reuse. Repository surface is Find + Insert only (no UPDATE/DELETE).
- attempt_submissions_v2: attempt_id (1:1 receipt), submission_id global UNIQUE. request_hash gates exact replay; lease/control/expected/attempt_revision columns record fencing; receipt JSON carries submissionId, provisional flag, digest; final_response_digest plus submitted_at on the DB clock.
- assessment_results, student_results, student_submissions: attempt_id and submission_id keys plus provider_key. Snapshot content-addressed by digest + key/policy revision. Release state machine draft to released; released snapshots immutable; repair means a new audited version, never an in-place edit.

Backoff: BackoffFor(n): n >= 8 gives Terminal; else 5s times 2^(n-1) capped at 300s. Claim: ClaimLimit 100 per batch, ClaimLeaseSecs 60; modes update (ship default, single UPDATE with ORDER BY and LIMIT) vs skiplocked (SELECT FOR UPDATE SKIP LOCKED + UPDATE by id; less InnoDB over-locking under multi-consumer claiming); partitions MOD(CRC32(aggregate_id), N) = i. Unknown modes fail closed. Purge of published rows older than 72h is retention-owned; Phase 02 must not widen it.

---

## 7. Step-by-step implementation

General protocol per step (freeze/review/repair): (a) trace current behavior with logs and DB reads, record; (b) reproduce the suspected defect deterministically, or mark already-satisfied with evidence; (c) add the failing behavioral test FIRST; (d) apply the smallest complete repair across producer, consumer, persistence, error states, and tests; (e) run producer checks with real commands and logs; (f) hand the diff plus evidence to the integrator. Order is acceptance-driven; do not reorder across the SAT-provisional dependency (steps 5-6 before step 7).

Step 1 - Trace authoritative sources per provider (S1; supports all AC). For IELTS, SAT, and ACT, trace the read path (detail/export) and the write path (save/seal) to exact tables and columns: attempt_responses_v2 canonical vs legacy blobs (answers, writing_answers, flags) vs assessment_question_responses; assessment_exam_questions + revisions (administered set + answer_definition); routing tables (assessment_routing_policies, assessment_route_decisions); policy tables (assessment_scoring_policies). Record which path each consumer uses today, where dual reads exist, and what materializeBlobsForSeal rebuilds and when (protocol-2 only; V1 blobs never touched). Produce a source map table (provider x consumer x table/column x revision pinned?) as evidence. Divergence from C01 is a candidate defect for Step 2; agreement closes with evidence.

Step 2 - V2-only SAT confirm-or-resolve plus the single resolver (S2; AC05). Run the existing V2 pins (TestFinalizeModuleScoresV2AnswersWithoutLegacyRows, TestFinalizeModuleLegacyFallbackWithoutV2Rows) plus a live-DB probe: seal one V2-only attempt with zero legacy rows; assert the correct adaptive route (higher/lower) and the correct count. If V2-only already works, strengthen the regression (mixed-divergence warning assertion, corrupt-envelope pending assertion) - no new bridge code. If divergence exists, implement source_resolver.go per section 6.2, rewire finalizeModuleTx plus scoreAndPersist aggregation plus the assessscore read path to call it, delete or gate the second branch (CI grep blocks reintroduction), and document fallback precedence, corruption handling, and metric names. Producer checks: resolver unit matrix (sqlmock) plus live-DB V2-only and mixed-compat fixtures; consumer parity (seal vs detail vs export agree). Handoff: resolver doc plus metric names to Phase 06; query shapes to Phase 05.

Step 3 - Administered-set, pinned-revision, and verdict semantics (S3-S4; AC05/AC06/AC12). Fixtures: one attempt containing an administered branch, an unadministered adaptive branch, a pretest question, a blank, a missing key, an invalidated item, and a pending score. Failing tests first: unadministered excluded (not incorrect); pretest excluded from aggregation; blank/missing-key/invalidated map to the null/pending display (never incorrect); SATResponseCorrect returns false but the caller renders null (pin the caller rule, not just the scorer). Pinned-revision test (AC12): issue an attempt on draft vN; publish draft vN+1 mid-exam (new key/threshold/weights); complete the attempt; assert score, snapshot, and release used vN inputs and the released snapshot is byte-identical after a later draft edit. Client-score ignore: submit ACT/IELTS with a forged client score field; assert ComputeScienceScore and GradeObjective never read it; missing key/policy follows the approved C01 failure (explicit error plus pending, never zero-fill). Smallest repair: scoring aggregation filters plus key/policy loaders pinned to published_version_id; V2ResponseToScorerInput parity (envelope-to-answer extraction identical to payloadAnswer and Project).

Step 4 - Result repair as an audited operation (S5; AC06/AC12). Trace current repair surfaces: RepairMissingReceipts, RepairSATResults, grading re-release, any direct UPDATE of issued results. Classify which mutate immutable facts (defect) vs append new versions (correct). Implement the repair_audit.go path: authorization hook (Phase 04 role check consumed, not reimplemented), before/after snapshot capture, reason + actor + ticket, append-only audit row (WP12 DDL if a new table is needed), state-machine transition (reopened to re-graded to re-released), telemetry event. attempt_terminalizations rows are never UPDATED or DELETED. Test: issue, release, authorized repair - assert the old snapshot is preserved, the new version is released, the audit row is present, and unauthorized repair is denied (consumes the Phase 04 matrix as read-only).

Step 5 - Single terminalization authority plus replay rules (S6, S8; AC09 plus the AC03/AC08 server side). Enumerate every seal caller: student submit (IELTS/ACT direct), SAT scoreAndPersist, worker sealAutoSubmitAttempt, proctor terminate/complete, deadline path via Completer, legacy trigger and compat rows, repair sweeps. Each must funnel to Terminalize, TerminalizeInTx, or sealAttemptInTx (or be deleted with evidence). Real-DB barrier tests on an isolated DB: submit-vs-terminate, submit-vs-submit, worker-vs-API same-attempt races with explicit ordering control; assert exactly one receipt, cross-outcome gives TERMINALIZATION_CONFLICT (wire 409 + envelope), same-outcome gives replay created=false (reason ignored). Same-ID matrix: same-ID/same-payload returns the stored receipt replay (lease still checked); same-ID/different-payload gives SUBMISSION_ID_MISUSE 409; cross-attempt submission-ID reuse gives 409 with existingAttemptId; terminal replay after seal follows the outcome rule, never a new receipt. Lost-receipt behavior (AC08 server side): committed but response lost, client retries the identical write, server returns the compatible ack with no duplicate mutation or payload change - prove with the crash-after-commit test in section 13 T5. Transaction-boundary proof: in one transaction - attempt lock, receipt probe, fencing, projection/digest, seal (receipt INSERT + submitted_at/final_submission projection + scoring snapshot + audit row + attempt_terminalized outbox INSERT). No external calls, no Hub publish, no scorer I/O inside the transaction. Post-commit only: best-effort live fan-out plus metrics.

Step 6 - SAT provisional vs final plus abandoned-client recovery (S7; AC11). Prove separation: SAT student submit parks PROVISIONAL (delivery submitted/post-exam, digest persisted, submitted_at and final_submission stay NULL so the legacy attempt_terminalizations compatibility trigger cannot manufacture a terminal fact); the result is NOT releasable; CompleteAssessment and scoreAndPersist perform the final seal (sat_complete) with the full snapshot. Kill-after-provisional test (two-process, section 13 T6): provisional commit, kill worker (and/or API), restart, ReconcileProvisionalBatch seals via repairOne (actor system, fresh submission and request IDs, re-lock plus re-check of the predicate, no fabricated score when modules are incomplete or policy is missing - stays provisional plus the OldestProvisionalAgeSeconds alert fires). Raced-completion rule: if student completion lands first (lockedSubmissionID present), the watchdog stands down (returns nil, no double seal) - pin with a race test. API-observes-worker proof: after the worker seal, the API process reads authoritative state within the C05 bound without shared memory (consumes the Phase 04 mechanism as read-only; Phase 02 asserts the bound).

Step 7 - Autosubmit fan-out completion plus rescan (S9; AC10 core). Pin current semantics with sqlmock tests before touching: TestExecuteOutboxEventReusesID (RequestID = event.ID reuse so reseal replays the same receipt), poison-mid-batch, late-arrival rescan, requeue-flag parsing, terminal-conflict matrix. Enforce the completion predicate (section 8): acknowledge the event (mark published) if and only if every target is sealed OR permanently-conflicted OR individually quarantined; zero-sealed plus any-transient returns an error and the event retries with backoff. Never whole-batch burn for one poison attempt; never acknowledge with silently unowned stragglers. Cursor-batched fan-out (listAutoSubmitAttempts, 500 per batch, WHERE id > ? ORDER BY id), per-attempt try/continue, QuarantineAttempt per poison, one-shot rescanAutoSubmitDelta for late arrivals in the same claim, enqueueAutoSubmitFollowUp on overflow. Keep the reason vocabulary fixed (proctor_complete default; degrade unknown legacy free-text to the vocabulary, never fail the batch). Producer checks: partial-fan-out matrix (success + transient + poison + terminal-conflict) plus rescan plus overflow follow-up, all asserting per-attempt DLQ rows and exactly-once seals.

Step 8 - Durable retry ownership: existing model first; child-work table only if proven (S10-S11; AC10). Attempt the full AC10 matrix on the existing model: outbox claim (update and skiplocked paths), 60s lease plus expiry reclaim, BackoffFor schedule, terminal park at 8 or more attempts with DLQ evidence (markTerminal single-transaction park+INSERT), per-attempt quarantine (INSERT IGNORE idempotent), operator requeue-dead-letter (resolved_at guard, same idempotency key). Decision gate: a child-work table is authorized ONLY with a written proof that a requirement cannot be met by the existing model (for example per-attempt backoff independence inside a shared-revision batch that per-attempt DLQ plus follow-up scan cannot express), plus the WP12 DDL gate plus Phase 05 review. Default outcome: no new table; document why. Lease-expiry plus multi-consumer tests: stale claim_token reclaimed; partitioned claims MOD(CRC32...) disjoint; unknown claim mode fails closed; claim-token miss on mark is a no-op success (historical behavior preserved). Idempotent requeue: requeue the same DLQ twice gives exactly one fresh event; resolved DLQ never re-resolves; an incompatible-rollback worker stops claiming (payload-version guard) rather than corrupting.

Step 9 - Post-commit safety plus process-boundary hardening (S12; AC11). Audit every post-commit effect in seal and worker paths: Hub.Publish, bus appends, rollup refreshes, metrics must be best-effort AFTER commit, never in-transaction, never gating the receipt. Transaction retries must not duplicate external effects (idempotent seals plus outbox dedup carry the guarantee). Exec-only posture (OUTBOX_EXEC_ONLY, SetOutboxExecOnly): the executable family is always enqueued; wakeup families are skipped only when execOnly is on; unknown families fail open (never silently dropped - update IsExecutable when adding one). Pin with unit tests. Binary-rollback compatibility: the old worker ignores or safely skips new payload versions; queued rows stay readable; no purge-shortcut recovery anywhere.

Step 10 - Integration handoff plus query-shape freeze. Deliver wiring diffs for app.go and worker/main.go (if any) as patches to the integration owner, never direct concurrent edits; run the OpenAPI drift check (no wire change unless the contract owner approved); file any migration allocation request via the database owner. Freeze query shapes for Phase 05: list every changed SQL predicate (claim, rescan, provisional sweep, seal guards) with cardinality notes; hand EXPLAIN inputs to the database owner. Update the evidence ledger (scoring-terminalization-evidence.md) per AC with candidate identity plus raw logs; mark already-satisfied items with evidence, not code.

---

## 8. Code and pseudocode (illustrative - implement against the frozen contracts, not these sketches)

### 8.1 Source resolver (WP02; enforced single call site)

```go
// delivery/source_resolver.go - the ONE resolver. All scoring paths call this.
// Administered set is pinned at issuance (I08). Unadministered questions are never scored.
func ResolveScoringSource(admin []Question, v2 map[string]string, leg map[string]string, policy Policy) []ResolvedQuestion {
    var out []ResolvedQuestion
    for _, q := range admin {
        if q.IsPretest {
            out = append(out, ResolvedQuestion{q.ID, PendingNull, SourceV2})
            continue
        }
        raw, ok := v2[q.ID]
        if ok {
            ans, valid := assessscore.V2ResponseToScorerInput(raw) // parity anchor
            if !valid {
                out = append(out, ResolvedQuestion{q.ID, PendingNull, SourcePending}) // corrupt -> pending
                continue
            }
            key, hasKey := policy.Key(q.ID)
            if !hasKey {
                out = append(out, ResolvedQuestion{q.ID, PendingNull, SourcePending})
                continue
            }
            // Divergence metric only: if leg[q.ID] differs from ans, emit source_warning, never score leg.
            correct := assessscore.SATResponseCorrect(key, true, ans) // or ACT/IELTS equivalent
            out = append(out, ResolvedQuestion{q.ID, boolVerdict(correct), SourceV2})
            continue
        }
        if l, ok := leg[q.ID]; ok && policy.FallbackWindowOpen() {
            _ = l // score legacy + meter legacy_source; record fallback in provenance
            continue
        }
        out = append(out, ResolvedQuestion{q.ID, PendingNull, SourcePending})
    }
    return out // unadministered questions are never appended
}
```

### 8.2 Terminal compatibility check (C03/I04; mirrors OutcomeCompat + SATOutcomeStatus)

```go
// Outcome-only compatibility: the same outcome replays regardless of reason;
// a different outcome conflicts. Reason and actor are ignored on replay.
func OutcomeCompat(existingOutcome, requestedOutcome string) bool {
    return existingOutcome == requestedOutcome
}
// Seal path (receipt-first, under the attempt lock):
//   existing := FindByAttemptID(attempt) // SELECT ... FOR UPDATE
//   if existing != nil {
//       if OutcomeCompat(existing.Outcome, cmd.Outcome) { return &SealResult{Created:false, ...} }
//       return TerminalConflict // TERMINALIZATION_CONFLICT, 409 - never overwrite (I04)
//   }
//   Insert(receipt) // duplicate key -> re-read + compatibility check (race-winner path)
// SAT materialization: SATOutcomeStatus(outcome, actor):
// submitted -> pending; terminated+proctor -> invalidated_proctor;
// terminated+other -> invalidated_timeout.
```

### 8.3 Fan-out completion predicate (C06/I09; mirrors executeOutboxEvent)

```go
// Returns nil -> acknowledge the event (mark published). Returns error -> backoff retry.
func fanoutDone(sealed int, failures []failureDetail) error {
    // Failures are quarantined individually BEFORE this check (per-attempt DLQ rows).
    if sealed == 0 && hasTransientFailure(failures) {
        return fmt.Errorf("0 sealed with transient failures - retry")
    }
    return nil // sealed > 0 (poison quarantined) OR all failures permanent (settled conflicts)
}
// Rescan (same claim): seal the delta WHERE id > max(seen); overflow enqueues
// a bounded follow-up scan event (enqueueAutoSubmitFollowUp).
// RequestID reuse: every seal in the batch uses event.ID, so a reseal replays
// the same receipt instead of minting a second terminal fact (load-bearing, pinned).
```

### 8.4 Idempotent claim (C06; mirrors ClaimBatch + duePredicate)

```sql
-- Ship posture: single UPDATE with ORDER BY and LIMIT (update mode).
UPDATE outbox_events
SET claimed_at = NOW(),
    claim_expires_at = DATE_ADD(NOW(), INTERVAL 60 SECOND),
    claimed_by = :worker, claim_token = :token,
    publish_attempts = publish_attempts + 1
WHERE published_at IS NULL AND failed_at IS NULL
  AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
  AND (claimed_at IS NULL OR claim_expires_at < NOW())
-- plus partition predicate when N > 1: AND MOD(CRC32(aggregate_id), N) = i
ORDER BY created_at ASC LIMIT :limit;
-- Then SELECT the rows WHERE claim_token = :token AND published_at IS NULL.
-- skiplocked mode: SELECT ... FOR UPDATE SKIP LOCKED + UPDATE by id
-- (same due predicate + token guard; less InnoDB over-locking).
-- Backoff: attempts >= 8 -> park terminal (markTerminal: UPDATE failed_at
-- + INSERT DLQ evidence in ONE transaction). Requeue inserts a fresh event
-- with the same idempotency key behind the resolved_at guard (exactly once).
```

---

## 9. Data and state flow

### 9.1 Response to routing to score to result (WP02)

```text
Student write (C02 envelope)
 -> attempt_responses_v2.canonical {answer, markedForReview, ...}  [authoritative per C01]
 -> source_resolver (administered set at published_version_id + key/policy revision pin)
 -> per-question verdicts (correct / incorrect / pendingNull;
    pretest + unadministered excluded)
 -> SAT: finalizeModuleTx aggregates -> routing policy (threshold -> lower/higher)
    -> assessment_route_decisions
 -> SAT final: scoreAndPersist aggregates terminal modules
    -> PolicyScorer(section, route, normalized, max)
    -> assessment_results (scored/ready_to_release) + section rows -> seal sat_complete
 -> ACT: ComputeScienceScore(config, sealed content, answers)
    -> SealScienceScore -> final_submission.score (server-authoritative)
 -> IELTS: GradeObjective (override > sealed answer_definition) -> section states
    -> submission grading_status -> results release states
 -> results.Service reads (detail/export/review) REPLAY the same resolver+scorer
    over the SEALED snapshot (never live draft, never client score)
 -> released snapshot immutable (student_results); later draft edits cannot move it (AC12)
 -> correction = audited repair op (new version + audit row), never in-place overwrite
```

Key pinning (I05/I08): every arrow above carries published_version_id + key_revision + policy_version; live-draft reads are a defect.

### 9.2 Submit to receipt to projection to enqueue to worker to seal (WP04)

```text
Submit(cmd{submissionID, leaseEpoch, controlEpoch, expectedRevision, finalCommands})
  validate envelope -> verify bearer -> BEGIN (READ COMMITTED, bounded retry <= 3)
  lockAttempt FOR UPDATE -> receipt probe (attempt_submissions_v2 FOR UPDATE)
    same ID + same hash -> return stored receipt (lease still checked) [exact replay]
    same ID + different hash OR cross-attempt ID -> 409 SUBMISSION_ID_MISUSE
  global submission-ID ownership check -> lease/control/revision fencing
  -> runtime gate lock (authoritative clock)
  finalCommands via saveInTx (same fencing) -> re-lock -> ComputeDigestInTx
  SAT: provisional UPDATE (delivery submitted/post-exam, digest, revision bump;
       NEVER submitted_at/final_submission) + receipt INSERT -> COMMIT -> provisional ack
  IELTS/ACT: sealer.SealSubmitted -> [sealAttemptInTx, same tx]:
       attempt lock -> FindByAttemptID FOR UPDATE -> compat check
       -> snapshot build (pinned inputs) -> receipt INSERT
       + submitted_at/final_submission projection + scoring snapshot + audit row
       + outbox INSERT (attempt_terminalized, exec-only aware) -> COMMIT -> seal ack
  post-commit ONLY: Hub/bus fan-out (best-effort), metrics, rollups

Worker (separate process, no shared memory):
  drainOutbox (claim <= 100, 60s lease) -> executeOutboxEvent (auto-submit family only)
  -> per-attempt seal (RequestID = event.ID) -> poison -> QuarantineAttempt (per-attempt DLQ)
  -> rescan delta -> overflow -> follow-up event
  -> all-sealed-or-permanent -> mark published; else -> backoff retry
     (5s * 2^(n-1) capped 300s; n >= 8 -> terminal park + DLQ)
  -> SAT watchdog ReconcileProvisionalBatch (abandoned provisionals -> scoreAndPersist)
  -> API observes via durable state within the C05 bound
     (bus/invalidation/bounded refresh - the Phase 04 mechanism)
```

Transaction-boundary invariants (I10): receipt + projection + snapshot + audit + enqueue commit atomically; any failure before COMMIT leaves the prior valid state; any crash after COMMIT converges by replay or reclaim (never by re-minting a second fact).

---

## 10. Edge cases (each needs an explicit test or evidence pointer)

- E1. Submit-vs-terminate race, both orders (student seal wins vs proctor terminate wins): exactly one receipt; the loser gets TERMINALIZATION_CONFLICT; no overwrite; no partial projection (I04). Test both winners with a DB barrier.
- E2. Worker-autosubmit vs student-submit race: one seal; the worker path reuses the compat check; the conflict is permanent (no retry storm); no duplicate result rows.
- E3. Same submission ID + same payload (transport retry / lost ack): stored receipt replay, Replayed=true, same digest; no new mutation; lease still validated.
- E4. Same submission ID + different payload (same or different attempt): SUBMISSION_ID_MISUSE 409 with existingSubmissionId or existingAttemptId; no state change.
- E5. Stale lease epoch (takeover / old device): fenced; no write; distinct recovery (re-auth/takeover flow owned by Phase 03/04; the server never silently deletes pending work).
- E6. Stale control epoch (pause/resume racing submit; FinalCommands): fenced on the client-supplied expected control epoch; submit fails loudly with a refresh directive; no silent pending-data loss (I06).
- E7. Terminal replay (any write/submit/seal after seal): rejected per the outcome rule (replay-if-same, conflict-if-cross); never replays across a terminal boundary (C02).
- E8. Missing key or missing policy: fail closed with pending plus an explicit error/alert; never zero-fill or interpolate; the watchdog leaves the attempt provisional (AC11 negative arm).
- E9. Blank answer vs missing vs invalidated vs pending-score vs true incorrect: five-way distinction preserved end-to-end (scorer false + caller null-rule + review/export labels); no coercion to incorrect.
- E10. Unadministered adaptive branch: excluded from numerator AND denominator; routing decision recorded; review shows not-administered (AC05).
- E11. Pretest question: excluded from the score; included in review/export only per C01.
- E12. Stale lease on the receipt replay path: replay still validates the current lease (no bypass).
- E13. Provisional row from the legacy path (submitted/post-exam, NULL projection): claimable exactly once via the ClaimPredicate OR-arm; never double-sealed.
- E14. Late arrival mid-fan-out: sealed by the same-claim rescan; overflow enqueues a bounded follow-up (no stranded eligible attempt).
- E15. Poison attempt mid-batch (bad payload, missing exam, constraint): quarantined to its per-attempt DLQ row; the batch continues; the event acknowledges if and only if the completion predicate holds.
- E16. Crash between business commit and outbox ack, or between claim and seal: reclaim by lease expiry replays the idempotent seal (RequestID reuse) to the same receipt; no duplicate fact (I09).
- E17. Duplicate outbox delivery (redelivered claim): idempotent - seals replay, quarantine INSERT IGNOREs, the requeue guard holds.
- E18. Draft publish mid-exam (AC12): the in-flight attempt stays pinned; new attempts take the new version; released snapshots are byte-stable.
- E19. Unknown claim mode or unknown outbox family: unknown mode fails closed (claim error); unknown family fails open (never silently drop a future executable family - update IsExecutable).
- E20. Rollback with a new payload version queued: the old worker stops claiming incompatible work (version guard); the backlog is preserved; no purge.

---

## 11. Errors (failure classes, DLQ rules, lost-receipt behavior)

### 11.1 Failure classes (C06 vocabulary - implement exactly; do not invent a parallel taxonomy)

- Validation and fencing (non-retryable in-transaction): bad envelope, stale lease/control, revision collision, unwritable state, SUBMISSION_ID_MISUSE, settled TERMINALIZATION_CONFLICT. Immediate 4xx with the exact wire code and envelope (C07 read-only); terminal conflicts are permanent (recorded without error text in fan-out; never retried to the terminal park).
- Transient infrastructure (retryable): deadlock and connection transients (READ COMMITTED retry <= 3 in submit/seal), claim races, DB slowdown, worker crash mid-batch. Bounded retries with a jitter budget and a single retry owner per operation (C06/C07); backoff 5s * 2^(n-1) capped at 300s; lease-expiry reclaim.
- Poison and permanent data: un-decodable autosubmit payload with no schedule ID, persistently failing attempts (constraint or missing exam that survives re-read), attempts >= 8. Per-attempt quarantine (DLQ evidence row) or event terminal park + DLQ; operator requeue path; never whole-batch burn; never silent drop (the evidence row is mandatory).
- Policy or key missing (fail-closed business): no scoring policy for the version, zero scorable questions, incomplete modules at watchdog time. Not an error to retry blindly: leave provisional or pending plus the OldestProvisionalAgeSeconds alert plus an explicit API error on direct completion. No fabricated score.
- Post-commit fan-out loss: Hub/bus publish fails, rollup refresh fails. Best-effort only: log plus metric; authoritative state is already committed; the C05 bounded-refresh path converges. Never fail the receipt for a fan-out failure.

### 11.2 DLQ rules (mirror the dlq.go contract)

- Park + evidence commit in ONE transaction (markTerminal): a terminal row never exists without a queryable outbox_dead_letters row; the parked outbox row is kept as-is (no move-semantics change).
- Per-attempt quarantine is idempotent: INSERT IGNORE behind UNIQUE(source_event_id, aggregate_id).
- Requeue is exactly-once: RequeueDeadLetter behind the resolved_at guard with the same idempotency key and a fresh event ID; a double requeue is a no-op success with the original token.
- Operator CLI (worker requeue-dead-letter, both flag spellings pinned): a missing or unresolvable ID fails closed (no invented work).
- Retention and purge of DLQ rows is a Phase 05/retention-owner decision; Phase 02 never purges evidence as recovery.

### 11.3 Lost-receipt behavior (AC08 server half; the client half is Phase 03)

- Server commits the receipt but the ack is lost: the identical retry returns the compatible stored ack (same submission ID + request hash + digest + provisional flag). The payload never changes under the client.
- Client retries with a NEW submission ID after a successful commit (for example a regenerated UUID on retry - a client bug): the second receipt is a distinct submission; the outcome rule still prevents a second terminal fact (replay-or-conflict), but the misuse is surfaced. Phase 02 documents this; Phase 03 owns not regenerating IDs on retry (C02).

---

## 12. Performance and security

### 12.1 Performance (no new infrastructure; bounded deterministic work)

- Short deterministic transactions: submit, seal, and repair-one each hold one attempt lock (plus runtime/section per the global order attempt -> runtime -> section) and a bounded batch (claim <= 100, autosubmit page 500, watchdog batch 250, rescan page 500+1). No unbounded SELECTs; cursor pagination (WHERE id > ? ORDER BY id LIMIT ?) everywhere a fan-out or sweep lists attempts.
- No external calls in transactions: no Hub/bus publish, no scorer I/O beyond locked-row SQL, no network policy fetch, no blocking metrics. Post-commit effects are best-effort and order-safe.
- No hot-path whole-attempt rewrites unless row-first semantics plus terminal materialization are proven (coordinate measurement with Phase 05; the RowFirst posture stays as configured - Phase 02 does not flip it without evidence).
- Isolation: READ COMMITTED plus bounded retry (3) on submit/seal hot paths (absorbed transients counted, not hidden); FOR UPDATE only on the owned attempt and receipt rows; candidate sweeps read outside the transaction and re-check under lock.
- Budgets consumed (C09 via Phase 06, read-only): terminal receipt p95 <= 2s with ordinary seal vs SAT provisional vs SAT final-readiness measured separately; the autosave-ack path is untouched; worker drain plus oldest-eligible-work age alert thresholds come from expected load, not universal constants. Any performance claim cites workload, resources, config, distribution, plus raw evidence.

### 12.2 Security (consume the Phase 04 matrix; enforce the server-side rules here)

- No fabricated scores: missing, blank, unadministered, pretest, invalid, and pending never become incorrect-or-zero by default; a missing policy or key never interpolates. Every fail-closed path emits an auditable error plus a metric (I11-safe: no answers or tokens in labels).
- Client scores are non-authoritative by construction: scorers take no client-score parameter (the ACT ComputeScienceScore signature is the pattern); any client score field present is ignored-or-audited, never aggregated.
- No authorization bypass in repair or requeue: result repair and DLQ requeue are authorized operations (role check consumed from Phase 04/C04 - Phase 02 adds the hook call and denies by default when the checker is absent in tests, never allows by default).
- No PII or answer leakage in telemetry: bounded labels only (outcome, reason, family - never attempt, user, or question IDs in metric labels); redacted diagnostic context only where justified; answer content never logged (I11).
- Fencing is safety, not UX: stale lease, control, and terminal rejections are enforced at write time even when the browser is stale (I06/I07 consumed; Phase 02 owns the server check).
- Audit on result repair: every repair writes who, when, and why plus a before/after snapshot reference; audit rows are append-only and retention-protected (coordinate the retention boundary with Phase 05 so replay, terminal, and incident evidence is never prematurely cleaned).

---

## 13. Tests (AC05/06/09/10/11/12 plus discriminating designs)

Test-employment rule: failing behavioral test first for confirmed defects; already-satisfied requirements closed with fresh passing evidence (never historical artifacts). DB-backed tests need isolated DBs (WP13). sqlmock pins unit predicates; live DB proves races and crashes; two processes prove the boundary.

- T1. source_resolver_test.go matrix (NEW, section 5), sqlmock unit. V2-only wins; legacy-only allowed only inside the window; mixed gives V2 plus the warning metric; corrupt V2 gives pending (not incorrect); pretest and unadministered excluded. Guards the single-resolver rule (grep: no second V2/legacy branch).
- T2. SAT V2-only plus adaptive routing (extend sat_v2_scoring_test.go; NEW scoring_parity_test.go), sqlmock plus live-DB provider integration. AC05: V2-saved correct routes higher, incorrect routes lower; counts correct; seal-time equals detail equals export; unadministered and pretest semantics hold.
- T3. IELTS objective + writing + ACT science (extend act/scoring_test.go, grading/source_test.go, results/service_test.go), service plus E2E fixture. AC06: override precedence; answersEqual weights and tolerance; forged client score ignored; missing key/policy fail-closed; release-state gating.
- T4. Pinned-revision and publish-during-exam (NEW in scoring_parity_test.go), live-DB integration. AC12: mid-exam draft publish does not move in-flight scoring inputs or the released snapshot (byte-compare); new attempts take the new version (I08).
- T5. Submit/terminate and submit/submit races (NEW seal_race_test.go; extend seal_concurrency_test.go and seal_deadline_race_test.go), REAL-DB BARRIER with two goroutines/processes ordered both ways. AC09: one compatible terminal outcome; cross-outcome gives conflict; same-outcome gives replay created=false; includes crash-after-commit (kill between COMMIT and ack, identical retry replays the same receipt with no duplicate mutation - the AC03/AC08 server half).
- T6. SAT abandon-after-provisional (NEW provisional_recovery_test.go), TWO-PROCESS API/worker plus watchdog. AC11: provisional commit, kill client/worker, restart, ReconcileProvisionalBatch seals final (actor system); the API observes without shared memory within the C05 bound; incomplete-modules or missing-policy stays provisional plus the age alert (negative arm).
- T7. Autosubmit partial fan-out (NEW autosubmit_completion_test.go; extend autosubmit_fanout_test.go and autosubmit_cursor_test.go), sqlmock matrix plus live-DB crash. AC10: success + transient + poison + terminal-conflict in one batch gives per-attempt DLQ, good seals persist, predicate-driven ack/retry; late-arrival rescan seals the delta; overflow enqueues the follow-up; crash mid-batch with lease-expiry reclaim replays idempotently (RequestID reuse).
- T8. Claim, retry, DLQ, requeue (extend outbox test files and worker outbox_drain_emit_test.go), unit plus live-DB. C06: update vs skiplocked claim equivalence; partition disjointness; unknown mode fails closed; backoff vector (1 gives 5s through 7 capped at 300s, 8 gives terminal); markTerminal atomicity; QuarantineAttempt idempotence; requeue exactly-once; duplicate delivery safe.
- T9. Verdict-semantics matrix (extend assessscore tests and sat/scoring_edges_test.go), unit. Missing key vs blank vs unadministered vs pretest vs invalidated vs pending vs incorrect - seven-way distinction with display-rule assertions (null, never incorrect except true incorrect).
- T10. Wire and contract sentinels (extend attempts outcome_wire_test.go, envelope_vocab_test.go, submit_receipt_compat_test.go; api openapi_drift_test.go read-only), contract. SUBMISSION_ID_MISUSE code, acknowledgements field name, outcome/reason/actor vocabulary, provisional flag shape - byte-level wire stability; old/new consumer matrix noted for Phase 04.
- T11. Repair audit (NEW, following the repair_emit_test.go pattern), live-DB integration. Authorized repair appends the audit plus a new version, preserves the receipt plus the old snapshot; unauthorized repair denied; retention boundary respected.

Discriminating-input checklist (must appear across T1-T11): both race winners; same-ID/same-payload vs same-ID/different-payload vs different-ID/same-version; stale lease vs stale control vs terminal replay separately; exact deadline/grace boundaries consumed from Phase 04 (Phase 02 asserts seal-side writability only); old-worker/new-payload and new-worker/old-payload compatibility.

---

## 14. Verification commands

Confirm actual scripts and targets in WP00 first (names below are the current-tree candidates - never run a remote or production-targeting config by name alone). Record command + environment + exit status + artifact for every claim.

```bash
# 0. Baseline identity (every evidence row starts here)
git rev-parse HEAD && git status --porcelain=v1 && go version && mysql --version
# schema head + config fingerprint (values, never secrets)
ls backend/go/cmd/migrate/ | tail -5

# 1. Static + unit (fast gate; sqlmock pins, no live DB)
go vet ./backend/go/...
go test ./backend/go/internal/assessscore/... ./backend/go/internal/terminalization/... ./backend/go/internal/outbox/... ./backend/go/internal/attempts/... -count=1
go test ./backend/go/internal/delivery/... ./backend/go/internal/sat/... ./backend/go/internal/act/... ./backend/go/internal/grading/... ./backend/go/internal/results/... -count=1
go test ./backend/go/cmd/worker/... -count=1 -run 'TestExecuteOutboxEvent|TestPoison|TestLateArrival|TestRequeue|TestIsTerminalConflict'

# 2. Isolated-DB integration (one disposable DB per worker per WP13 - never a shared dev DB)
# Adapt DSN variable names to the WP00-discovered harness before running.
go test ./backend/go/internal/terminalization/ -count=1 -run 'TestSealRace|TestSubmitVsTerminate' -v
go test ./backend/go/internal/sat/ -count=1 -run 'TestProvisionalRecovery' -v
go test ./backend/go/cmd/worker/ -count=1 -run 'TestAutosubmitCompletion|TestCrashRecovery' -v
go test ./backend/go/internal/delivery/ -count=1 -run 'TestScoringParity|TestPinnedRevision' -v

# 3. Two-process boundary (AC11; API + worker as separate processes, no shared memory).
# Terminal 1 runs the API on a disposable DB/port; terminal 2 runs the worker on the same DB;
# drive: provisional submit, kill worker, restart, assert final seal + API visibility within C05 bound.
go run ./backend/go/cmd/api
go run ./backend/go/cmd/worker

# 4. Contract sentinels (read-only unless the contract owner approves a change)
go test ./backend/go/cmd/api/ -count=1 -run 'TestOpenAPIDrift|TestResponseContract|TestOutcomeWire|TestEnvelopeVocab'

# 5. Race detector on touched packages only (bounded; not a substitute for DB races)
go test -race -count=1 ./backend/go/internal/assessscore/... ./backend/go/internal/terminalization/... ./backend/go/cmd/worker/...
```

Evidence bar per claim: candidate identity (revision + dirty hashes + schema + config fingerprint + lockfiles) + exact command + exit status + artifact path + PASS / FAIL / NOT RUN / BLOCKED. Skipped critical tests are NOT RUN, never PASS. Unavailable required checks stay BLOCKED with the concrete blocker.

---

## 15. Completion checklist

- [ ] C01/C02/C03/C05/C06 frozen versions recorded; all implementation cites them; no invented shared semantics.
- [ ] Source map (provider x consumer x table/column x pinning) delivered; V2-only state confirmed with live-DB evidence; resolver (or V2-enforcement) landed with precedence + corruption handling + metric names.
- [ ] Administered-set, pinned-revision, pretest, unadministered, null-vs-incorrect matrix passes across seal-time, detail, export (AC05/AC06).
- [ ] Client scores proven non-authoritative (forgery test); missing key/policy fail-closed with approved behavior (no fabricated scores).
- [ ] Single terminalization authority proven: caller enumeration complete; legacy/compat paths funneled or retained-with-evidence; receipt-first + outcome-only replay pinned (AC09).
- [ ] SAT provisional/final separation + watchdog recovery + API-observes-worker bound proven two-process (AC11, including the negative arm).
- [ ] Receipt/projection/snapshot/audit/enqueue atomicity proven; no external calls in transactions; post-commit effects best-effort only.
- [ ] Fan-out completion predicate + rescan + overflow follow-up + per-attempt DLQ proven including crash mid-batch and duplicate delivery (AC10).
- [ ] Existing-job-model-first decision recorded; child-work table either rejected with proof or gated through WP12 + Phase 05.
- [ ] Transient/permanent classification, backoff vector, lease expiry, partitioned/skiplocked claims, idempotent requeue proven (C06).
- [ ] Result-repair audited path landed (or the current path proven sufficient); receipt immutability holds; unauthorized repair denied.
- [ ] AC12 pinned-snapshot test passes; released snapshots byte-stable across later draft edits.
- [ ] Query shapes frozen and handed to Phase 05; any DDL gated through WP12 (allocation + rehearsal evidence) with rollback compatibility.
- [ ] Producer checks logged (commands + exit statuses + artifacts); evidence ledger updated; shared-file diffs handed to the integration owner (no concurrent edits with Phase 04).
- [ ] Known limitations, residual risks, stop conditions written (section 12 + handoff); no hidden TODOs in critical flows.

---

## 16. Handoff to Phase 07 and shared-file coordination with Phase 04

### 16.1 Handoff to Phase 07 (integration/rehearsal owner)

Deliver: (1) the frozen candidate identity for this file; (2) the evidence ledger docs/production-hardening/scoring-terminalization-evidence.md with per-AC rows (AC05/06/09/10/11/12) linking fresh artifacts; (3) the resolver precedence doc + terminal state machine (sections 6.2-6.3) + job-ownership schema (section 6.4) + repair/requeue runbook excerpts (section 11); (4) the isolated-DB + two-process reproduction commands (section 14) runnable without Phase 02 authors; (5) the query-shape freeze note plus any WP12 migration IDs; (6) the residual-risk list (for example legacy-fallback window still open, exec-only posture, claim mode in effect, oldest-provisional alert threshold rationale). Phase 07 reruns T4-T8 against the integrated candidate plus fault injection (API restart, worker restart, DB slowdown, lost ack, deadline storm) and soak coverage of lease and provisional intervals. Stop conditions from section 12 ride along: conflicting terminal facts, unexplained score divergence, unowned unfinished work, or unsafe migration behavior stop expansion immediately.

### 16.2 Shared-file coordination with Phase 04 (one mutation owner per file)

- terminalization/* + resolver (delivery/source_resolver.go, scoring/routing paths): Phase 02 is the sole authority (integrity owner). Phase 04 is read-only and files questions only.
- cmd/worker/main.go (fan-out/orchestration vs process wiring): Phase 02 owns fan-out, completion, rescan, DLQ/requeue, job handlers. Phase 04 owns process wiring, presence posture, live bus/hub wiring, config plumbing. Sequence: Phase 02 lands fan-out semantics first, then transfers the file to Phase 04 for wiring - or vice versa per the L0 schedule. Transfer is an explicit message (owner to L0 to next owner) with a clean tree; no overlapping edits; the integration owner reviews the seam.
- internal/app/app.go (service graph): both phases submit patches to the integration owner, who applies them serially. Phase 02 contributes domain-construction diffs (scorer wiring, completer switch, terminal/outbox construction). Phase 04 contributes process-edge deps (caches, buses, leases, admission). Phase 02 never edits concurrently with Phase 04.
- internal/delivery/* (live/cache vs scoring): split by function - scoring hunks are Phase 02, live/cache hunks (SetLive, SetLiveDirect, SetLiveSink, VersionCache, poll/invalidation behavior, C05) are Phase 04. Same-file work is sequenced hunk-by-hunk with a transfer note; joint review of delivery/service.go before Wave B exit.
- internal/runtime/*, liveupdates/*, student/*: Phase 04 is the sole authority. Phase 02 is read-only (consumes gate and clock values) and asserts authoritative-clock + visibility-bound behavior in tests but never changes cache/bus semantics.
- api/openapi/openapi.yaml + handler DTOs: Phase 02 is a read-only consumer. Phase 02 files DTO needs as versioned change requests; no direct edits. The contract owner (via Phase 04) applies them.
- Migrations: Phase 02 is the requestor via WP12; the database owner authors. Phase 02 provides the requirement plus dry-run criteria only.
- Cross-feature integration tests: the integration test owner assembles; Phase 02 produces the AC05/06/09/10/11/12 cases and keeps them green in isolation first; Phase 04 consumes the C05/C07 interplay.

Worktrees isolate edits, not contracts: even with separate checkouts, the frozen C01/C02/C03/C05/C06 versions are the single source of truth, and any contract doubt escalates to the contract owner (L0 designates) before code. DB-backed work across Phase 02 and Phase 04 uses separate disposable databases or scheduled exclusive access - different files do not guarantee runtime isolation.
