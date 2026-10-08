# SAT robustness assessment — 8 October 2026

## Implementation follow-up — same day

The confirmed release and rehearsal gaps below have been addressed directly in the existing checkout. No worktree, sub-agent, or skill was used for implementation.

- Staff time grants now require the current module identity and a valid runtime revision. Missing identities refuse the grant with a visible recovery message. Type checking and the production build pass.
- Numeric-response publishing fixtures now use Math. CI runs the SAT API database contracts after migration and rejects skipped tests; the final local selection passed **35 top-level tests with zero skips**.
- SAT exam-day, handoff, and contention scripts now use V2 response routes. Shared assertions check exact write identity, canonical answer content, and persisted final state. Conflicts no longer count as saved answers. The full exam script also waits for authoritative terminal modules and verifies V2 submission replay. Its complete long-duration sitting was not run in this pass.
- The real HTTP regression kills an API process after a save commits but before acknowledgement. Two fresh API processes recover the write, race eight close replays, retain one route and receipt, and continue saving in Module 2. A 20-candidate shared-runtime wave also passes. The regression passed under Go's race detector.
- The actual k6 handoff script passed through the two API processes with 20 synthetic candidates and final packets delayed until 250 ms after zero. It issued 200 HTTP requests with **zero HTTP failures, lost final writes, duplicate branches, content leaks, or boundary rejections**. This local correctness rehearsal does not establish production capacity, browser rendering behavior, or MySQL 8.4/TiDB parity.
- The limiter rehearsal exposed and fixed an additional production defect in [DBRateLimiter.Check](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/platform/httpx/ratelimit_fallback.go): a fresh counter inherited an unrelated pooled connection's `LAST_INSERT_ID`, causing a false 429. Both upsert arms now set the returned count. A real-MySQL regression deliberately sets the prior value to 999; it failed before the fix and passes afterward. CI executes this regression as well.
- The SAT handoff and transfer runbooks have been restored. Cleanup now retains complete fixtures that have immutable terminal receipts, avoiding attempted deletion of their referenced parents. **Correction to the original audit:** those terminal rows cannot simply be deleted in dependency order; receipt immutability requires disposing of the isolated test schema instead.

Verification also includes the **47 passing SAT integration tests**, the focused frontend suite (**543 passed, 2 existing skips**) and a later **43-test** rerun covering the newly added missing-module guard and shared rehearsal contract (overlapping the larger suite). Targeted lint, Go vet, selected Go race suites, syntax checks for the load scripts, and diff whitespace checks pass. The generic proctor file has one pre-existing unused-variable lint warning. No deployment or production load run was performed.

Reproduce the process-kill and optional k6 rehearsal using the commands in [the handoff runbook](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/docs/runbooks/sat-module-handoff.md). The original assessment below is preserved as the pre-implementation baseline.

---

**Verdict: the SAT delivery core has strong consistency safeguards, but the current working tree is not ready to be called production robust.** The exercised paths preserve answers and select one adaptive branch under concurrency. Release checks, the SAT load harnesses, and deployment failure proof still have gaps.

This assessment applies the failure scenarios in the supplied “Step 6” text to the actual implementation. The backend uses MySQL-compatible SQL, not the illustrative PostgreSQL architecture in that text. I assessed the working tree based on commit `50b614db`, including its existing uncommitted and untracked changes. I made no application, configuration, or test changes; this report is the only repository file added by the audit.

## Scope and evidence

Traced student answer acceptance and browser recovery, V2 persistence, attempt ownership and transfer, server clocks, module closure and adaptive routing, terminal submission, publishing, worker reconciliation, monitoring, and the relevant CI and load scripts. This was a focused robustness assessment, not a complete security or UI audit.

Evidence labels: **Executed** means an existing test or command ran; **Static** means the conclusion follows from the inspected code; **Inference** identifies an unexercised operational risk.

| Check | Result |
| --- | --- |
| Focused frontend durability, application policy, controller, resume, and timing suite | **Executed:** 37 files passed; 476 tests passed, 2 skipped. Some React tests emitted `act(...)` warnings. |
| Backend delivery, attempts, SAT, transactions, terminalization, authentication, authorization, and exam packages | **Executed:** all selected packages passed. Lifecycle receipts have no standalone package tests, but their callers were exercised. |
| Go race detector on delivery, attempts, SAT, transactions, and terminalization | **Executed:** passed with `-race -count=1`. This checks Go memory races; the database tests below check SQL interleavings. |
| Background worker, runtime, proctor, access-link, and scoring packages | **Executed:** passed with `-count=1`. |
| Fresh isolated database | **Executed:** all 79 migrations applied successfully on local MySQL **9.6.0**. The repository CI uses MySQL 8.4; this audit does not establish 8.4 or TiDB parity. |
| SAT integration suite with real MySQL | **Executed:** 47 top-level tests passed, including concurrency, deadline, transfer, routing, and completion cases; 87 test results including subtests passed. |
| Selected SAT API database suite | **Executed:** 19 of 21 top-level tests passed; 2 publishing tests failed because their fixtures put numeric-response questions in Reading & Writing. |
| Targeted critical API database suite | **Executed:** 8 top-level tests passed, covering handoff, evidence, pause union, extension receipts, pinned question identity, raw content fences, completion races, and rollback. Seven overlap the preceding API selection. |
| Frontend type checking | **Executed:** failed with two errors, reproduced below. |
| Browser E2E, production traffic, saturation, process kills, rolling deployment, backup restore | **Not executed.** No claim about these outcomes or production capacity is supported by this audit. |

The database tests used a new temporary local MySQL process and schema, not an existing application database. Test cleanup logged foreign-key failures and left fixture rows in that disposable schema; those warnings do not invalidate the passing assertions, but are a test-maintenance defect.

Representative commands actually run, from the repository root or `backend/go` as appropriate:

```sh
bun run test:run src/shared/durability src/features/student-delivery/application src/features/student-delivery/hooks/__tests__/sat src/features/student-delivery/hooks/__tests__/useSatExamController src/features/student-delivery/infrastructure/__tests__ src/features/student-delivery/domain/satTiming.test.ts
bun run typecheck
go test ./internal/delivery ./internal/attempts ./internal/sat ./internal/lifecycle ./internal/platform/tx ./internal/terminalization ./internal/auth ./internal/authz ./internal/exams
go test -race -count=1 ./internal/delivery ./internal/attempts ./internal/sat ./internal/platform/tx ./internal/terminalization
go test -count=1 ./internal/background ./internal/runtime ./internal/proctor ./internal/accesslinks ./internal/assessscore
# The following commands had TEST_MYSQL_DSN set to the isolated schema:
go test ./integration -run 'SAT|AdmitRefuses|TakeoverReplay' -count=1 -json
go test ./cmd/api -count=1 -run 'SAT.*MySQL|SAT.*ProductionSealer|SATTimeoutSealFailure|SATSessionDetailRoute|SATV2SubmitAndTimeout|SATV2SubmitWithout|StudentBranchRaw|Student.*Admission' -json
go test ./cmd/api -count=1 -run 'TestStudentRawContentRoutesFenceUnassignedBranch|TestSATClientStartHandoffMySQL|TestSATLateEvidenceMySQL|TestSATPauseUnionMySQL|TestSATExtensionReceiptMySQL|TestSATPinnedQuestionIdentityMySQL|TestSATV2SubmitAndTimeoutReconcileRaceWithProductionSealer|TestSATTimeoutSealFailureRollsBackFinalModule' -json
```

## What is already protected

| Guarantee | Mechanism and evidence | Assessment |
| --- | --- | --- |
| A save acknowledged by the API is committed before success is returned | The V2 transaction writes the mutation ledger and response projection together. The transaction runner commits before returning success. Database tests verify the resulting stored answers. | Strong boundary; an actual API crash after commit was not injected. |
| An older update cannot overwrite a newer accepted answer | Stable write IDs, request hashes, version-collision checks, and ordering by writer lease plus question version in [saveInTx](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/attempts/service.go:224). | Covered by the focused service tests. |
| An attempt gets one authoritative branch per section | Answer saving and closure share the attempt row lock. Scoring, module locking, route persistence, and successor creation occur transactionally. The database also has a unique `(attempt_id, section_id)` route constraint. | Real database tests passed, including concurrent closes and save-versus-finalize races. |
| A close confirms the exact final writes | [pendingCloseWritesTx](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/delivery/close_module.go:280) matches write IDs and versions and checks ledger/projection provenance and hashes. Close receipts bind the operation ID to its request. | Real database handoff tests passed. |
| The browser does not confuse local intent with server persistence | The durability engine checkpoints intent, recovers it, retries with jitter, validates acknowledgement identities, and blocks submission while visible intent is unsettled. | Frontend tests passed; browser storage and network failures were simulated. |
| A late answer cannot silently rewrite a branch already administered | Closed-module answers become separate immutable evidence. The review path records route risk without changing canonical responses or routing. | Real database evidence and review tests passed. |
| Duplicate completion does not create conflicting terminal state | Completion takes the attempt lock, checks required module topology, and uses terminalization. Failure of final sealing rolls back the final module closure. | Real database completion races and rollback tests passed. |
| Unassigned branch questions stay private | Delivery filtering, assigned-module checks, pinned question identity, and restricted raw student projections. | Real database raw-payload canary tests passed for higher/lower routing and client-start handoff. |
| An old device cannot continue writing after transfer | Server-owned writer leases, active sessions, revocation checks, and transactional transfer. Same-browser tabs additionally use an exclusive Web Lock before mounting the exam. | Real database transfer tests passed; Web Lock implementation inspected. |
| Disconnected attempts eventually advance | Request-side reconciliation plus bounded background sweeps; steady completed attempts avoid repeated finalization. | Worker/service tests passed; outage and backlog recovery time remain unmeasured. |

The strongest part of the design is its ownership boundary: the database, rather than a browser clock or a process-local mutex, arbitrates accepted answers and lifecycle transitions. Shared runtime read locks let different candidates save concurrently while timing changes still serialize with affected attempts.

**Timing policy has a deliberate ceiling.** `SATSaveGrace` is 3 seconds; personal `client_start` sessions use the configured close window, 15 seconds by default. These windows admit qualifying server-arrived saves; they cannot prove when an unsent browser click occurred. A disconnected answer can remain evidence without affecting the selected branch. “Every pre-zero click counts” would therefore be a stronger promise than this implementation can establish.

**Completion and grading are separate.** Current SAT completion creates a pending, unscored result. Adaptive routing uses raw module correctness. Passing completion tests is not proof of official scaled SAT score generation or student score release.

## Finding 1 — High: the current frontend fails its release type check

**Executed.** `bun run typecheck` exits nonzero:

```text
src/components/proctor/ProctorDashboard.tsx(469,48): error TS2554: Expected 4 arguments, but got 3.
src/products/sat/routes/SatSessionRoomRoute.tsx(271,587): error TS2322: Type 'number | null | undefined' is not assignable to type 'number'.
  Type 'undefined' is not assignable to type 'number'.
```

The [generic proctor extension caller](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/src/components/proctor/ProctorDashboard.tsx:469) omits the required `moduleId` accepted by [extendStudentAttempt](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/src/services/examDeliveryService.ts:388). The [SAT room confirmation](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/src/products/sat/routes/SatSessionRoomRoute.tsx:271) passes an optional runtime revision into a required revision field.

These are reachable staff control surfaces, and the repository's CI typecheck cannot pass on this tree. The missing module argument also leaves the extension request without its explicit module target. Smallest fix: update the caller with the authoritative target and refuse an extension confirmation until its required runtime revision is available. Preserve the server fences; do not suppress the type errors. This finding does not claim the Vite build command was run or failed.

## Finding 2 — High for capacity validation: SAT load scripts do not exercise the current answer protocol

**Static.** [saveResponseOrFail](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/k6/sat-exam-day.js:372) still PATCHes the retired assessment-delivery response endpoint. The script explicitly fails on `PROTOCOL_UPGRADE_REQUIRED`, which is the server's protection against acknowledging compatibility saves that V2 scoring would ignore.

The narrower [handoff harness](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/k6/sat-m1-m2-handoff.js:77) reads and writes `/api/v1/attempts/...`. The [actual router](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/cmd/api/main.go:820) registers the response protocol under `/api/v2/student/attempts/...` and `/v2/student/attempts/...`. The contention harness also retains a retired-transport failure check.

Consequently, these scripts cannot establish the capacity of the current student answer path. Their latency thresholds are targets, not measured production results. Smallest fix: use the current snapshot and V2 batch endpoints, preserve exact write IDs and question versions through retries, carry authoritative epochs, and assert acknowledgements and final database state. Then run a synchronized finish wave. This is a confirmed validation defect, not evidence that the production service necessarily fails at a particular student count.

## Finding 3 — Medium: CI skips important SAT API database tests, concealing failing fixtures

**Static CI finding; failures confirmed by execution.** The [normal Go test step](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/.github/workflows/ci.yml:84) runs before migrations and without `TEST_MYSQL_DSN`. Database-gated API tests skip. After migration, the [API database selection](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/.github/workflows/ci.yml:118) names only four capacity/authoring tests. The separate integration job does run the integration package, but does not substitute for the API-package SAT tests.

Running the SAT API selection with MySQL exposed:

```text
TestSATPublishUsesConfiguredQuestionCountsMySQL:
  publish valid SAT draft with custom target: VALIDATION_ERROR: SAT publish requirements are not met: Reading & Writing questions must be multiple choice.
TestSATPublishStrictSPRValidationMySQL/long_canonical_numeric_key:
  representable canonical key rejected: VALIDATION_ERROR: SAT publish requirements are not met: Reading & Writing questions must be multiple choice.
```

The [fixture builder](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/cmd/api/sat_publish_mysql_test.go:73) puts a student-produced response in the first Reading & Writing module; the [numeric-key case](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/cmd/api/sat_publish_mysql_test.go:617) does the same. The validator correctly rejects that section/question-type combination. These failures show stale tests, not a demonstrated production publishing defect.

Smallest fix: place numeric-response fixtures in Math, then add SAT API database tests after migration in CI with an explicit no-skip check. This closes the gap for handoff receipts, rollback, question identity, and raw content protection as well as publishing.

## Smaller confirmed defects

- **Low, operational recovery:** SAT handoff alerts still point to `docs/runbooks/sat-module-handoff.md`, which is deleted in the assessed working tree. The device-transfer runbook is also deleted. Restore or retarget the operational instructions before relying on these alerts during an exam incident.
- **Low, test hygiene:** adaptive and stale-ETag fixture cleanup omits terminalization rows, causing foreign-key failures. The isolated schema held 36 fixture attempts at inspection. Clean up dependent rows in the right order; passing tests should not accumulate fixtures.
- **Test limitation:** two auto-entry tests remain explicitly skipped. Other executed tests cover entry retries, so the skip alone is not proof that retry behavior is broken.

## Scores

Scores concern the assessed implementation and evidence, not a production availability SLA.

| Dimension | Score | Rationale |
| --- | --- | --- |
| SPEC | 7/10 | Main delivery invariants are present; last-click and scaled-score promises require the narrower policy described above. |
| DESIGN | 8/10 | Clear database authority, transactional transitions, durable receipts, writer fencing, and separated browser policy. Some timing configuration remains process-owned. |
| CORRECTNESS | 7/10 | Strong focused and real-database results; typechecking fails, and real process interruption, browser E2E, and mixed-version behavior were not exercised. |
| QUALITY | 6/10 | Substantial regression coverage and telemetry, reduced by skipped CI boundaries, stale publishing fixtures, outdated load paths, and missing runbooks. |

## The most valuable next pass

**Prove the real V2 answer-save → module-close boundary under a synchronized finish wave.** Repair the SAT harness transport rather than adding infrastructure. Run multiple API processes and the worker against an isolated production-matching database; delay final packets, lose acknowledgements, and restart an API process after commit. Assert one branch, correct stored final answers, stable close replay, continued next-module saving, and bounded route latency. An HTTP 200 count alone is insufficient.

Make the durable-state assertions a repeatable regression: a save commits, its response is lost, a different API process handles the retry, and concurrent closure selects exactly one branch from the committed answers.

## Follow-ups supported by this review

1. Restore a green release gate: fix the two TypeScript contracts, repair the two publishing fixtures, and run SAT API database tests in CI.
2. Execute the V2 synchronized-boundary rehearsal above and publish measured answer-save p95/p99, route lag, pool wait, error rate, and persisted invariants at the intended cohort size.
3. Test database outage and recovery, browser reload/offline storage failures through the real UI, worker restart, and lost submit responses.
4. Test rolling deployment explicitly. **Inference:** `sat_handoff_mode` is captured in the runtime, but the close-window duration comes from process configuration through `ModuleCloseWindow`. Different API/worker values can produce different acceptance and reconciliation windows. Keep them identical during active sittings or capture the duration at the sitting boundary if it must change safely.
5. Restore incident runbooks and rehearse recovery from backup separately. Inspect the deployed metrics and alert delivery; repository definitions alone do not prove they are active.

The existing database architecture is a suitable foundation for these guarantees. The next improvement is stronger release and failure evidence at the boundaries students actually use.
