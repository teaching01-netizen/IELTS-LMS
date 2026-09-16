# SAT Answer Durability, Delivery Integrity, and Quality-Gate Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair the audited SAT answer read/write/recovery contract, close the currently failing verification gates, and establish measurable evidence for a 10/10 result across frontend, backend, database, and delivery quality.

**Architecture:** Keep the V2 response aggregate as the single write and scoring authority. Fix the incomplete V2-to-bootstrap projection at the backend read boundary, keep the shared durability engine authoritative during recovery, normalize malformed or legacy metadata at every external boundary, and prove the end-to-end contract with SQLMock, real MySQL, Vitest, and Playwright.

**Tech Stack:** React 19, TypeScript 5.8, Bun/Vitest/Testing Library, Playwright, Go, MySQL 8.4, SQLMock, existing migration and CI tooling.

---

## 1. Goal, scope, and definition of “10/10”

This plan covers two deliberately separated workstreams:

1. **Critical SAT durability workstream:** preserve the complete answer aggregate from controlled input through V2 persistence, bootstrap, reload/recovery, scoring, submit, and seal.
2. **Repository quality workstream:** remove the current typecheck failure, stabilize the order-sensitive frontend tests, and resolve the separately failing authoring-shell test without weakening its contract.

“10/10” is defined as a measurable release gate, not a subjective promise:

- no known P0/P1 defect in the audited SAT path;
- every contract invariant below has a named automated acceptance test;
- full V2 metadata survives bootstrap and recovery without null arrays or lost annotations;
- V2-only scoring, legacy fallback, dual-identity deduplication, authorization, fencing, and idempotency remain green;
- frontend typecheck, lint, build, full Vitest, backend unit/race tests, real-MySQL integration, migration validation, OpenAPI/static analysis, and Playwright pass in the same verification sequence;
- no database migration is introduced unless implementation evidence proves the existing schema cannot satisfy the contract.

### Explicitly out of scope

- Replacing the V2 durability engine, transport, or mutation-ledger protocol.
- A general authoring redesign; the authoring workstream is limited to the observed FT-04b classification failure and its direct test/implementation boundary.
- Visual redesign or unrelated product refactors.
- Changing expected user-facing copy merely to make a flaky test pass.
- Deleting the untracked browser probes without first determining whether they are intended audit evidence; they must be either made type-safe and owned or explicitly removed by the repository owner.

## 2. Current-system understanding

The audited SAT chain is:

~~~text
controlled SAT input
  -> useSatExamController.setAnswer / interaction reducer
  -> useSatResponsePersistence full V2 envelope
  -> responseDurabilityTransport
  -> attempts.SaveResponses
  -> attempt_responses_v2 + attempt_mutations_v2
  -> delivery.Bootstrap legacy/V2 response merge
  -> useSatExamController module hydration
  -> scoring / result detail
  -> terminalization seal projection
~~~

The high-confidence defect is in backend/go/internal/delivery/service.go:loadResponsesV2: it reads the canonical V2 JSON and projects answer plus markedForReview, but leaves ResponseSnapshot.EliminatedOptions and ResponseSnapshot.Annotations nil. Because those fields are serialized without omitempty, bootstrap can return null instead of the established [] and {} shapes.

The frontend then assumes the bootstrap contract at src/features/student-delivery/hooks/useSatExamController.ts:541-574; spreading response.eliminatedOptions or passing null to normalizeSatAnnotations can throw during module hydration. The V2 engine snapshot itself already contains the complete envelope, so the fix belongs at the backend bootstrap projection boundary, with frontend defensive normalization as a compatibility guard.

The audited baseline also contains:

- full Go tests passing;
- Vite build passing;
- focused SAT durability tests passing;
- full frontend Vitest with 3 failing files / 4 failing tests, although the two SAT transition files pass in isolation;
- root TypeScript failure limited to two untracked browser probe files;
- one unrelated authoring-shell lifecycle test expecting conflict but receiving unknown.

These baseline facts must be rerun in the implementation worktree before changes are judged, because the worktree was already dirty and contains user-owned edits.

## 3. Behavioral contract and invariants

The implementation must preserve these invariants:

1. **Full aggregate invariant:** every V2 write and every V2-derived bootstrap response represents answer, markedForReview, eliminatedOptions, and annotations together.
2. **Canonical ownership:** V2 is authoritative for questions with a V2 row; legacy rows only fill questions absent from V2.
3. **Bootstrap shape invariant:** eliminatedOptions is always a JSON array and annotations is always a JSON object at the candidate-facing ResponseSnapshot boundary. Missing or malformed metadata defaults safely; it never becomes JSON null.
4. **SAT annotation mapping:** the V2 annotations envelope may contain the sat-annotations entry. Bootstrap must expose the inner SAT annotation object expected by the frontend, not the outer transport array.
5. **Visible-draft precedence:** a local pending or confirmed draft must not be overwritten by a stale bootstrap or delayed snapshot response.
6. **No metadata erasure:** changing an answer after hydration must send the complete current envelope, not an answer-only patch that clears elimination or annotation state.
7. **Fencing and idempotency:** stale lease/control/client versions remain rejected or quarantined according to the existing protocol; replaying the same write is harmless; reusing a write ID with different content remains a conflict.
8. **Scoring compatibility:** V2-only rows score, legacy-only rows still score through the existing fallback, and dual V2 identity rows deduplicate deterministically.
9. **Submit durability:** module submit/finalize flushes the current V2 draft before scoring or sealing; a transient recovery failure does not silently turn a typed answer into unanswered.
10. **Security boundary:** authorization, schedule/attempt binding, published-version identity, and module identity checks remain server-owned and fail closed.
11. **Observability safety:** diagnostics may record state, revisions, outcomes, and error classes, but never answer content, annotation text, tokens, or other candidate-sensitive payloads.

## 4. Acceptance scenarios (ATDD)

Each scenario must have a named automated test and must be linked to the phase that implements it.

| ID | Scenario | Acceptance evidence |
|---|---|---|
| AT-01 | A controlled SAT answer, review flag, eliminated option, and text annotation update the UI immediately. | React/controller test proves state update and one complete V2 request envelope. |
| AT-02 | An authorized active-module V2 batch persists the full aggregate. | Go attempts test proves canonical row, mutation ledger, revision, and complete canonical response. |
| AT-03 | Replaying the same write is idempotent; reusing its ID with changed content conflicts. | Existing attempts durability tests remain green; add/extend assertions for metadata-bearing payloads. |
| AT-04 | A stale lease, control epoch, or client version cannot overwrite the visible current draft. | Existing fencing tests plus a frontend convergence test prove no silent local data loss. |
| AT-05 | V2-only SAT answers score; legacy-only answers still score; duplicate V2 identities do not double-count. | sat_v2_scoring_test.go suite remains green with a metadata-bearing fixture. |
| AT-06 | Bootstrap projects V2 answer, review, eliminations, and the inner SAT annotation object, with []/{} defaults when metadata is missing. | delivery/service_test.go SQLMock test asserts all four fields and default behavior. |
| AT-07 | A reload while V2 snapshot recovery is delayed or unavailable does not crash module entry and does not lose metadata. | Controller convergence test plus Playwright recovery test. |
| AT-08 | An answer edit after hydration preserves existing elimination and annotation metadata in the next write. | Persistence/controller test inspects the outgoing batch payload. |
| AT-09 | Submit/finalize flushes the pending V2 write and produces the expected result/seal. | Existing finalization tests plus real-MySQL/Playwright path. |
| AT-10 | Existing legacy attempts and pre-V2 response rows remain readable and scoreable. | Delivery fallback tests and a real-MySQL compatibility fixture. |
| AT-11 | Full frontend suite is order-stable; SAT directions and between-section tests pass both isolated and in the full suite. | Targeted combined run and full bun run test:run pass without changing correct copy assertions. |
| AT-12 | Authoring-shell 404/403/409/unknown errors retain their documented classifications. | authoringShellLifecycle.test.tsx passes in isolation and in the full suite. |
| AT-13 | Repository quality gates pass with no temporary type errors. | bun run typecheck, lint, build, full Vitest, Go race, MySQL integration, OpenAPI/static checks, and Playwright all pass. |

## 5. Change-surface and dependency map

| Surface | Label | File(s) | Responsibility |
|---|---|---|---|
| Backend V2 bootstrap projection | CHANGE | backend/go/internal/delivery/service.go | Decode and project the complete canonical envelope at the delivery boundary. |
| Backend projection regression coverage | CHANGE | backend/go/internal/delivery/service_test.go | Prove answer/review/eliminations/annotations and safe defaults. |
| V2 write/scoring path | VERIFY | backend/go/internal/attempts/service.go, backend/go/internal/delivery/start_submit.go, backend/go/internal/results/service.go | Confirm the fix does not change authoritative write, scoring, or result behavior. |
| Database schema and materialization | VERIFY | backend/go/migrations/0049_response_durability_v2.sql, backend/go/internal/attempts/materialize.go, backend/go/internal/terminalization/service.go | Confirm existing NOT NULL V2 envelope and seal projection are sufficient; no migration by default. |
| Frontend hydration boundary | CHANGE | src/features/student-delivery/hooks/useSatExamController.ts | Defensively normalize bootstrap metadata and preserve visible-draft precedence. |
| Frontend SAT normalizer | CHANGE if required | src/features/student-delivery/domain/satResponses.ts | Accept unknown/null boundary input safely while keeping the strict normalized output type. |
| Frontend recovery tests | CHANGE | src/features/student-delivery/hooks/__tests__/useSatExamController.convergence.test.tsx, src/features/student-delivery/application/__tests__/useSatResponsePersistence.v2.test.tsx, src/features/student-delivery/domain/satAnnotationsV2.test.ts | Prove delayed snapshot, reload, and metadata round-trip behavior. |
| Real database integration | ADD | backend/go/integration/sat_response_durability_test.go | Prove MySQL constraints, V2 persistence, bootstrap projection, and legacy compatibility on the CI database. |
| Browser acceptance | ADD | e2e/sat-answer-recovery.spec.ts | Prove the actual student flow across answer, metadata, reload/recovery, and submit. |
| SAT transition suite stability | CHANGE/VERIFY | src/features/student-delivery/ui/transitions/SatDirectionsScreen.test.tsx, src/features/student-delivery/ui/transitions/SatTransitionScreens.test.tsx, vitest.config.ts, shared test setup | Remove order leakage or shared mutable state; preserve correct product copy and timing behavior. |
| Authoring classification | CHANGE only after diagnosis | src/features/exam-authoring/api/assessmentQueries.ts, src/features/exam-authoring/api/__tests__/authoringShellLifecycle.test.tsx | Restore the 409 -> conflict contract without broad authoring changes. |
| Audit browser probes | CHANGE | src/test/studentAnswerLoss.browser-probe.tsx, src/test/studentAnswerLoss.browser-runner.ts | Either formalize as type-safe owned test harnesses or document and remove them through an explicit owner decision. |
| CI commands | VERIFY, CHANGE only if coverage is missing | .github/workflows/ci.yml, package.json, tsconfig.json | Keep existing gates authoritative; add only the smallest named script/config needed for new coverage. |
| Database migration | N/A by default | backend/go/migrations/ | Do not alter schema unless a failing real-MySQL test proves a schema invariant is absent. |

## 6. Design decisions

### D1 — Fix the backend projection at its owner boundary

- **Decision:** Decode the full V2 envelope inside the delivery read path and populate every ResponseSnapshot field there.
- **Reason:** Every bootstrap caller crosses this boundary, and the V2 snapshot path is already authoritative. This prevents duplicated partial fixes in each frontend caller.
- **Rejected alternative:** Only defaulting null in React. That avoids one crash but still loses real eliminations/annotations and can cause later writes to erase metadata.
- **Invariant:** A valid V2 row produces a complete candidate-facing response snapshot.

### D2 — Preserve the existing candidate-facing shape

- **Decision:** Keep ResponseSnapshot.Response as the scorer input, expose EliminatedOptions as the raw JSON array, and expose the inner sat-annotations object as Annotations.
- **Reason:** Existing frontend and legacy response consumers already expect this shape; no API-wide contract rewrite is needed.
- **Rejected alternative:** Exposing the raw V2 annotations array would force every client to understand the persistence envelope and would break normalizeSatAnnotations.
- **Invariant:** Existing legacy and V2 clients receive compatible field names and JSON types.

### D3 — Use safe defaults, not silent data fabrication

- **Decision:** Missing or malformed V2 metadata becomes [] for eliminations and {} for annotations; malformed answer data retains the current fail-safe scoring behavior.
- **Reason:** The API must not emit null into a contract that the frontend treats as iterable/object data.
- **Rejected alternative:** Rejecting the entire bootstrap on optional metadata corruption. That would turn recoverable display metadata into a candidate-blocking outage.
- **Invariant:** Optional metadata corruption cannot crash module entry or erase a valid answer.

### D4 — Keep frontend normalization as defense in depth

- **Decision:** Normalize unknown/null bootstrap metadata before spreading or passing it to strict SAT domain functions.
- **Reason:** Older deployments, partial mocks, and degraded responses can still violate the ideal server shape during rollout.
- **Invariant:** The frontend always stores a typed string[] and SatQuestionAnnotations value.

### D5 — No schema migration unless real evidence requires one

- **Decision:** First prove the existing 0049_response_durability_v2.sql schema and V2 writer already persist the required envelope; default path is code plus tests only.
- **Reason:** The audit found the defect in projection, not storage. Avoiding a migration reduces rollout and rollback risk.
- **Invariant:** attempt_responses_v2.response remains NOT NULL and keyed by (attempt_id, question_id); attempt_mutations_v2 idempotency and version constraints remain unchanged.

### D6 — Diagnose order-sensitive tests before changing assertions

- **Decision:** Reproduce SAT transition failures in the same file order and inspect shared setup/timers/DOM cleanup before changing product copy or expected timing.
- **Reason:** The isolated rerun passed all ten transition tests, which strongly indicates suite interaction rather than a stable product failure.
- **Invariant:** The final suite passes in isolation, combined order, and full-suite execution.

### D7 — Treat the authoring failure as a separate contract

- **Decision:** Investigate toEnsureDraftShellErrorInfo and its mocked status shape independently of SAT work.
- **Reason:** The failure is unrelated to SAT response durability; mixing fixes would obscure causality.
- **Invariant:** 404, 403, 409, and unknown errors retain explicit classifications and no automatic write retry is introduced.

## 7. Detailed implementation TODOs

### Phase 0 — Baseline, worktree safety, and test inventory

- [x] **0.1 Record the implementation baseline without modifying user work.**
  - Inspect git status --short and git diff --stat; preserve all existing user changes.
  - Run git diff --check.
  - Run the audited baseline commands: bun run typecheck, bun run test:run, bun run build, and cd backend/go && go test -count=1 ./....
  - Record exact failing files, test names, and counts in the implementation task notes.
  - **Exit condition:** baseline is reproducible and no user-owned change was reset or overwritten.

- [x] **0.2 Establish the contract fixtures before changing production code.**
  - Use the canonical metadata-bearing envelope already represented by backend/go/internal/attempts.ResponsePayload and backend/go/internal/attempts/sat_annotations_test.go.
  - Include one answer, one review flag, one eliminated option, and one valid SAT annotation entry.
  - Include missing-field and malformed-field fixtures for default behavior.
  - **Depends on:** 0.1.

- [x] **0.3 Decide the disposition of the untracked browser probes.**
  - Inspect src/test/studentAnswerLoss.browser-probe.tsx and src/test/studentAnswerLoss.browser-runner.ts as user-owned untracked files.
  - If retained, make their test doubles and indexed access type-safe and include them in the intended verification command.
  - If they are temporary audit artifacts, remove them only through an explicit owner-approved change and preserve their useful assertions in the supported Vitest/Playwright suites.
  - **Exit condition:** root typecheck has no unexplained red files.

### Phase 0 execution record — 2026-09-16

- **Worktree safety:** executed in the existing `feat/sat-bluebook-overlays-tools` checkout; no sub-agent, worktree, reset, clean, checkout, or production-code edit was used. The checkout was already dirty and all user-owned changes were preserved.
- **Whitespace baseline:** `git diff --check` remains red only for new blank lines at EOF in `services/authoring-coedit/src/documentIdentity.ts`, `services/authoring-coedit/src/telemetry.ts`, `src/features/exam-authoring/realtime/coedit/__tests__/coeditSession.test.ts`, `src/features/exam-authoring/realtime/coedit/documentIdentity.ts`, `src/features/exam-authoring/realtime/coedit/workspaceProvider.ts`, and `src/features/student-delivery/application/satRuntimeSelectors.ts`. These are existing user changes and were not normalized in Phase 0.
- **Type baseline and disposition:** the first root typecheck identified existing coedit/workspace-seed errors plus type errors in the two untracked browser probes. The probes were retained as audit-only artifacts and made type-safe: valid `WritingTaskType` values, an explicit audit-harness type, and bracket notation for `dataset` access. A fresh `bun run typecheck` now passes.
- **Frontend full-suite baseline:** `bun run test:run` completed with `599 passed / 5 failed` test files and `4,374 passed / 5 failed` tests. The five failures were:
  - `src/test/architecture/forbidden-browser-boundaries.test.ts` — clipboard ingestion still reaches the browser `document` boundary.
  - `src/components/admin/__tests__/StudentReviewWorkspace.answers.test.tsx` — backend bundle-map reading test timed out.
  - `src/features/student-delivery/routes/__tests__/SatPreviewRoute.test.tsx` — real SAT shell inspection test timed out.
  - `src/features/exam-authoring/editor/ingestion/testing/baselinePaste.behavior.test.tsx` — unfiltered choice-composer paste test timed out.
  - `src/features/exam-authoring/api/__tests__/authoringShellLifecycle.test.tsx` — 409 recovery classified as `unknown` instead of `conflict`.
- **Passing gates:** `bun run build` passed; `go test -count=1 ./...` passed; the two retained audit probe suites passed with `11/11` tests.
- **Canonical valid fixture:** use the existing metadata-bearing envelope in `backend/go/internal/attempts/sat_annotations_test.go`: answer `A`, `markedForReview: false`, one eliminated-options array entry, and one version-2 `sat-annotations` envelope containing a valid `highlight` annotation with `nodeId`, offsets, exact text, and timestamps.
- **Minimal valid fixture:** `{"answer":"B","markedForReview":false,"eliminatedOptions":[],"annotations":[]}`.
- **Default-behavior fixtures:** carry these into Phase 1 projection tests: omit both optional fields; set both optional fields to JSON `null`; and provide wrong-shaped optional values. Every case must project to `eliminatedOptions: []` and `annotations: {}` without dropping the answer or review flag.
- **Phase 0 result:** baseline evidence and fixture ownership are established. The five full-suite failures and the six whitespace findings remain explicitly scoped inputs to later phases; no unrelated cleanup was folded into this phase.

### Phase 1 — Write failing acceptance tests first

- [x] **1.1 Add the backend projection regression test.**
  - Extend backend/go/internal/delivery/service_test.go with a focused test for loadResponsesV2/loadResponses.
  - Return a canonical V2 row containing all four envelope fields and assert the projected ResponseSnapshot has the answer, review flag, eliminated option array, inner SAT annotation object, resolved identity, and revision.
  - Add a second case for missing or malformed optional metadata and assert []/{} rather than nil/null.
  - Run cd backend/go && go test ./internal/delivery -run 'TestLoadResponsesV2' -count=1 and confirm the new test fails before the production fix for the missing fields.
  - **Depends on:** 0.2.

- [x] **1.2 Add the frontend null/shape boundary tests.**
  - Extend src/features/student-delivery/domain/satAnnotationsV2.test.ts or the closest existing domain test to cover null, arrays, and malformed records at the public normalizer boundary.
  - Extend src/features/student-delivery/hooks/__tests__/useSatExamController.convergence.test.tsx with a bootstrap response whose metadata is complete, delayed, missing, and null-like.
  - Assert module entry does not throw, a metadata-bearing response hydrates correctly, and a local visible draft wins over a later bootstrap response.
  - **Depends on:** 1.1.

- [x] **1.3 Add the no-metadata-erasure persistence test.**
  - Extend src/features/student-delivery/application/__tests__/useSatResponsePersistence.v2.test.tsx with a hydrated response followed by an answer edit.
  - Inspect the batch command and assert it contains the current answer, review flag, eliminations, and annotations together.
  - **Depends on:** 1.2.

- [x] **1.4 Add the real-MySQL integration acceptance test skeleton.**
  - Add backend/go/integration/sat_response_durability_test.go using the existing integration setup in backend/go/integration/integration_test.go and backend/go/integration/act_grading_export_test.go as the fixture/cleanup pattern.
  - Cover a V2-only response with metadata, bootstrap projection, replay, and a legacy-only compatibility row.
  - Run it against the existing CI MySQL 8.4 service; do not substitute SQLite or an in-memory fake for this contract.
  - **Depends on:** 1.1.

- [x] **1.5 Add the browser acceptance test skeleton.**
  - Add e2e/sat-answer-recovery.spec.ts using existing helpers from e2e/support/studentUi.ts, e2e/support/backendE2e.ts, and the current student recovery/input durability specs.
  - Cover answer + elimination + annotation, persistence confirmation, reload during delayed/failed V2 recovery, visible hydration, subsequent edit, and submit/result.
  - Use request routing only to simulate delay/failure; never assert on candidate answer text in telemetry.
  - **Depends on:** 1.3 and the existing E2E fixture contract.

### Phase 1 execution record — 2026-09-16

- **Backend regression:** `cd backend/go && go test ./internal/delivery -run 'TestLoadResponsesV2ProjectsCompleteEnvelopeAndSafeMetadataDefaults' -count=1` fails at `service_test.go:153` because the current projection returns empty JSON for `EliminatedOptions`/`Annotations`. This is the intended red test for Phase 2; the fixture also proves the answer, review flag, resolved identity, and revision are available at the boundary.
- **Frontend boundary/convergence:** the combined targeted run passes the complete-envelope hydration and visible-local-draft precedence cases, plus all four persistence tests. It intentionally fails the null normalizer case with `Cannot read properties of null (reading 'version')` and the missing/null hydration cases with `startPendingModule()` returning `failed`; those failures identify the exact Phase 2/3 production owners.
- **Persistence aggregate:** `sends the complete hydrated aggregate when only the answer changes` passes and asserts answer, review, eliminated options, and SAT annotation envelope are sent together.
- **Real MySQL:** added `backend/go/integration/sat_response_durability_test.go`. It is gated by the existing `TEST_MYSQL_DSN`; without that environment it skips, while `go test ./integration -run 'TestSATResponseDurabilityV2BootstrapAndLegacyCompatibility' -count=1` compiles and exits successfully. The fixture covers V2 + legacy bootstrap merge, JSON shape assertions, and mutation-ledger duplicate replay at the database boundary.
- **Browser acceptance:** added `e2e/sat-answer-recovery.spec.ts`. It creates a disposable SAT sample exam, exercises answer + option elimination + highlight + question note, delays V2 snapshot recovery across reload, checks the recovered metadata, edits the answer while retaining that metadata, and submits the first module. The existing `sat-product-workspace.spec.ts` remains the full branch/result journey; Phase 2 will share its fixture instead of duplicating the 147-question result leg. An isolated TypeScript check with Node and Playwright types passes; the live Playwright scenario was not run in Phase 1.
- **Phase 1 result:** acceptance tests and scaffolds are complete and intentionally red at the known production defects. No production code or database migration was changed.

### Phase 2 — Repair backend V2 projection

- [ ] **2.1 Implement one private delivery-boundary decoder for V2 bootstrap metadata.**
  - Update backend/go/internal/delivery/service.go near loadResponsesV2.
  - Reuse the existing assessscore.V2ResponseToScorerInput and assessscore.V2MarkedForReview semantics for answer/review.
  - Decode only the optional projection fields needed by ResponseSnapshot: a string array for eliminatedOptions and the sat-annotations object from the outer V2 annotations array.
  - Keep decoder ownership in delivery unless an existing shared helper can be extended without introducing an import cycle or a broader public API.
  - **Invariant:** valid canonical metadata is preserved byte-for-byte where the candidate-facing contract expects raw JSON; absent/malformed optional metadata becomes []/{}.
  - **Depends on:** 1.1.

- [ ] **2.2 Populate non-nil defaults for every V2 ResponseSnapshot.**
  - Initialize the snapshot projection with JSON [] and {} before parsing the canonical payload.
  - Overwrite them only after successful type-checked extraction.
  - Preserve the current answer and review behavior, question identity normalization, module-attempt resolution, and server revision.
  - Do not change scoring or write behavior in this phase.
  - **Depends on:** 2.1.

- [ ] **2.3 Finish the backend unit acceptance tests.**
  - Make the tests from Phase 1 pass for full metadata, missing metadata, malformed metadata, V2-over-legacy merge, and legacy-only rows.
  - Add explicit assertions that serialized ResponseSnapshot fields are never JSON null for optional metadata.
  - Run gofmt on touched Go files and cd backend/go && go test ./internal/delivery ./internal/assessscore ./internal/attempts -count=1.
  - **Depends on:** 2.2.

- [ ] **2.4 Re-verify the database contract without changing the schema.**
  - Inspect backend/go/migrations/0049_response_durability_v2.sql and the V2 writer/materializer paths.
  - Confirm attempt_responses_v2.response is NOT NULL, the question identity key is unchanged, and the mutation ledger still enforces idempotency/version behavior.
  - If a real-MySQL test fails because of an actual schema mismatch, stop and document the exact migration need before adding one; otherwise mark the database phase code-only.
  - **Depends on:** 2.3.

### Phase 3 — Harden frontend hydration and recovery

- [ ] **3.1 Normalize bootstrap metadata at the frontend boundary.**
  - Update src/features/student-delivery/hooks/useSatExamController.ts at hydrateModuleResponses so an absent/non-array eliminatedOptions becomes [] before spreading.
  - Update src/features/student-delivery/domain/satResponses.ts or a local boundary helper so normalizeSatAnnotations can safely receive unknown/null-like input while still returning strict SatQuestionAnnotations.
  - Keep the normalized output versioned and bounded by existing annotation limits.
  - **Depends on:** 2.3.

- [ ] **3.2 Preserve local visible-draft precedence during bootstrap/recovery.**
  - Use the existing durability engine/controller state rather than making the bootstrap response authoritative over pending/confirmed local drafts.
  - Add or adjust convergence tests for initial bootstrap, delayed snapshot, failed snapshot, reload, provider-control epoch replacement, and answer edit after hydration.
  - Assert the server recovery response cannot replace a newer locally visible response.
  - **Depends on:** 3.1.

- [ ] **3.3 Prove full-envelope writes after hydration.**
  - Make the test from 1.3 pass through the real controller/persistence seam.
  - Assert an answer-only UI action does not emit an answer-only payload when the response already has eliminations or annotations.
  - Verify src/features/student-delivery/hooks/useSatResponsePersistence.ts continues to normalize and serialize the complete V2 payload at its existing serialization boundary.
  - **Depends on:** 3.2.

- [ ] **3.4 Re-run focused SAT tests before broad tests.**
  - Run the focused persistence, controller convergence/identity/auto-entry, SAT annotation, transition, and durability probe suites.
  - Expected result: all focused tests pass with no new warnings or unhandled rejections.
  - **Depends on:** 3.3.

### Phase 4 — Prove storage, scoring, submit, and seal behavior

- [ ] **4.1 Complete the real-MySQL SAT durability test.**
  - Seed the minimum published SAT version, attempt, module attempt, and question identity required by the existing integration helpers.
  - Save a full V2 response, read it through the delivery/bootstrap service or HTTP path used by integration tests, and assert all metadata fields and non-null defaults.
  - Replay the same write and assert no additional mutation/revision; send a changed payload with the same write ID and assert conflict.
  - Add a legacy-only response case and verify it remains readable/scorable.
  - **Depends on:** 2.4 and 3.3.

- [ ] **4.2 Re-run scoring and result regressions with metadata-bearing fixtures.**
  - Run backend/go/internal/delivery/sat_v2_scoring_test.go, relevant result tests, and terminalization/materialization tests.
  - Confirm V2-first scoring, legacy fallback, dual-ID deduplication, zero-answer routing, and seal projection remain unchanged.
  - **Depends on:** 4.1.

- [ ] **4.3 Complete the Playwright recovery path.**
  - In e2e/sat-answer-recovery.spec.ts, answer a real SAT item, toggle an eliminated option, create a valid annotation, wait for the existing save acknowledgement, and verify the outbound batch includes all fields.
  - Delay or fail the V2 snapshot request during reload, then restore it and assert the module opens without a hydration exception and the visible response is intact.
  - Edit the answer and assert the next request still includes the prior elimination/annotation metadata.
  - Submit and verify the existing result/seal success path.
  - **Depends on:** 1.5, 4.1, and the existing E2E environment.

### Phase 5 — Close the independent repository quality failures

- [ ] **5.1 Make the untracked browser probes type-safe or formally retire them.**
  - For src/test/studentAnswerLoss.browser-probe.tsx, use the actual WritingTaskType and StudentWriting controller prop contracts instead of task1/task2 and incompatible mock callbacks.
  - For src/test/studentAnswerLoss.browser-runner.ts, replace invalid dot access on the indexed task object with type-safe bracket access and explicit narrowing.
  - If these probes are not intended to be part of the repository, preserve their behavior in the supported Vitest/Playwright tests and remove the untracked files only with explicit owner approval.
  - Run bun run typecheck; expected result is zero TypeScript diagnostics.
  - **Depends on:** 0.3.

- [ ] **5.2 Diagnose and fix the order-sensitive SAT transition failures.**
  - Reproduce the original full-suite failures with the same test ordering, then run the two transition files together and under the full suite.
  - Inspect src/test/setup.ts, fake timers, DOM cleanup, module-level state, and any shared mocks before touching assertions.
  - If a leak exists, scope/reset it in the owning test setup or component; do not weaken the correct assertions about “Starting your module…”, initial disabled state, auto-entry, or the 0:00 break boundary.
  - Verify isolated, combined, and full-suite runs.
  - **Depends on:** 0.1 and 3.4.

- [ ] **5.3 Diagnose and fix the authoring FT-04b classification failure.**
  - Run src/features/exam-authoring/api/__tests__/authoringShellLifecycle.test.tsx alone and in the full suite.
  - Trace the mocked 409 error through src/features/exam-authoring/api/assessmentQueries.ts:toEnsureDraftShellErrorInfo and the test’s mockedStatusCode helper.
  - Correct the smallest boundary responsible for the mismatch, preserving retry:false, explicit CTA ownership, and the documented 404/403/409/unknown classification.
  - Add a regression assertion for the exact error shape that previously returned unknown.
  - **Depends on:** 0.1 and 5.2 diagnosis if shared test state is implicated.

- [ ] **5.4 Keep the quality-gate changes isolated from SAT behavior.**
  - Review the diff so authoring/test-harness changes do not alter SAT runtime code or expected copy.
  - Run the focused authoring and transition suites before the full frontend suite.
  - **Depends on:** 5.1-5.3.

### Phase 6 — Observability, rollout safety, and final verification

- [ ] **6.1 Add narrowly scoped diagnostics if the repository’s existing telemetry supports them.**
  - Backend: count V2 bootstrap projection success, optional-metadata defaulting, and canonical decode failure by safe error class; do not log response content.
  - Frontend: use the existing student observability mechanism for a hydration-defaulted or hydration-error event with attempt/module/question identifiers only when those identifiers are already considered safe by the project contract.
  - Add tests for event emission without asserting or recording answer/annotation content.
  - If an existing telemetry sink is not available at the boundary, keep structured error classification in the normal logger and do not invent a parallel system.
  - **Depends on:** 2.3 and 3.1.

- [ ] **6.2 Run the complete verification sequence in dependency order.**
  - Frontend: bun run typecheck, bun run lint, focused Vitest, full bun run test:run, coverage command used by CI, and bun run build.
  - Backend: cd backend/go && gofmt on touched Go files, go test -count=1 ./..., go test -race ./internal/..., migration validation, OpenAPI lint, staticcheck, and real-MySQL go test ./integration/ -v -count=1 using the CI service.
  - Browser: bunx playwright test e2e/sat-answer-recovery.spec.ts, the existing student durability/recovery suites, then the full Playwright command used by CI.
  - Expected result: all commands pass in the same clean verification run; any environment-only skip must be documented with the exact command and reason.
  - **Depends on:** all prior phases.

- [ ] **6.3 Perform the final invariant and diff review.**
  - Review git diff --check, changed-file list, API JSON shapes, and migration status.
  - Verify no null optional metadata can be emitted by V2 bootstrap, no candidate content appears in logs, no user-owned unrelated changes were reverted, and no temporary test artifact remains unexplained.
  - **Depends on:** 6.2.

## 8. File-by-file change plan

### Existing files to change

- backend/go/internal/delivery/service.go
  - Add the V2 bootstrap metadata projection/defaulting at loadResponsesV2.
  - Preserve existing answer/review/identity/revision behavior.

- backend/go/internal/delivery/service_test.go
  - Add full-envelope, missing-field, malformed-field, and V2-over-legacy projection assertions.

- src/features/student-delivery/hooks/useSatExamController.ts
  - Normalize bootstrap metadata before spread/strict-domain calls.
  - Preserve local visible-draft precedence during delayed recovery.

- src/features/student-delivery/domain/satResponses.ts
  - Widen only the external input boundary if necessary; keep normalized output strict and bounded.

- src/features/student-delivery/hooks/__tests__/useSatExamController.convergence.test.tsx
  - Add delayed/failed snapshot, reload, metadata hydration, and no-clobber scenarios.

- src/features/student-delivery/application/__tests__/useSatResponsePersistence.v2.test.tsx
  - Add full-envelope-after-hydration assertions.

- src/features/student-delivery/domain/satAnnotationsV2.test.ts
  - Add malformed/null input normalization assertions if the normalizer boundary changes.

- src/features/student-delivery/ui/transitions/SatDirectionsScreen.test.tsx
- src/features/student-delivery/ui/transitions/SatTransitionScreens.test.tsx
- src/test/setup.ts or the smallest owning test fixture
  - Only change after reproducing the suite leak; preserve product behavior and correct assertions.

- src/features/exam-authoring/api/assessmentQueries.ts
- src/features/exam-authoring/api/__tests__/authoringShellLifecycle.test.tsx
  - Only change the smallest 409 classification boundary after reproducing FT-04b.

- src/test/studentAnswerLoss.browser-probe.tsx
- src/test/studentAnswerLoss.browser-runner.ts
  - Make type-safe if retained; otherwise replace their evidence in supported tests and remove only by explicit owner decision.

- package.json, tsconfig.json, vitest.config.ts
  - Change only if a dedicated audit-test command or test isolation fix is demonstrably required. Preserve the production typecheck scope and existing CI commands.

### New files

- backend/go/integration/sat_response_durability_test.go
  - Real-MySQL V2 persistence/bootstrap/replay/legacy compatibility acceptance coverage.

- e2e/sat-answer-recovery.spec.ts
  - Browser-level SAT answer, metadata, reload/recovery, edit, and submit coverage.

- No new migration file by default.

## 9. Data and state lifecycle

1. **Input:** SatQuestionRenderer receives a controlled response and emits an interaction event.
2. **Controller:** useSatExamController.setAnswer derives the next complete response and delegates to persistence.
3. **Local durability:** useSatResponsePersistence and the durable response engine checkpoint the complete aggregate before/while transport is pending.
4. **Transport:** responseDurabilityTransport sends V2 command identity, client version, epochs, and full response payload.
5. **Database write:** attempts.SaveResponses validates authorization/identity/epochs, writes attempt_responses_v2, and records idempotency/version state in attempt_mutations_v2.
6. **Bootstrap read:** delivery.Bootstrap loads legacy and V2 rows; V2 wins per question; the V2 projection emits candidate-facing non-null metadata.
7. **Hydration:** the controller normalizes boundary values, then applies bootstrap only where no newer visible local draft exists.
8. **Recovery:** delayed/failed V2 snapshot recovery may update confirmed state, but cannot clobber a newer pending/visible draft.
9. **Submit:** the controller flushes pending writes before submit/finalize; backend scores V2 first and uses legacy fallback only where no V2 row exists.
10. **Seal:** terminalization materializes the V2 canonical response into legacy result/detail fields without changing the source aggregate.

## 10. Error and edge-case matrix

| Condition | Required behavior | Owner/test |
|---|---|---|
| Valid V2 envelope with all metadata | Project all fields; preserve revision and identity. | Delivery decoder; AT-06. |
| V2 envelope omits optional metadata | Emit []/{}; keep answer/review. | Delivery decoder; AT-06. |
| V2 envelope contains malformed optional metadata | Default optional fields; do not block bootstrap or erase answer. | Delivery decoder; AT-06. |
| V2 answer is null/empty | Preserve existing scorer-input semantics; score as unanswered where contract says so. | assessscore/scoring tests; AT-05. |
| Legacy row only | Return legacy response and metadata unchanged. | loadResponses merge tests; AT-10. |
| Legacy and V2 row for same question | V2 wins all projected fields, not only answer. | Delivery merge test; AT-06. |
| V2 duplicate identity aliases | Existing deterministic dedup remains unchanged. | SAT scoring tests; AT-05. |
| Snapshot delayed during reload | Keep visible local draft; hydrate safely when response arrives. | Controller + Playwright; AT-07. |
| Snapshot unavailable | Do not crash; keep checkpointed/pending data and expose existing recovery state. | Controller + Playwright; AT-07. |
| Answer edit after metadata hydration | Send complete aggregate; never clear metadata accidentally. | Persistence test; AT-08. |
| Stale lease/control epoch | Reject/quarantine according to existing protocol; never silently overwrite. | Attempts fencing tests; AT-04. |
| Duplicate write ID/same content | Idempotent replay, no duplicate revision. | Attempts tests; AT-03. |
| Duplicate write ID/different content | Conflict response; no projection overwrite. | Attempts tests; AT-03. |
| Unauthorized attempt/schedule/module | Fail closed before data mutation. | Existing API/delivery auth tests; AT-10. |
| Existing legacy client receives bootstrap | Compatible field names and non-null JSON types. | Integration compatibility test; AT-10. |
| Telemetry path sees candidate content | Must be prevented; inspect payload fields in tests/review. | Observability review; invariant 11. |
| Full suite runs after another test file | No shared timer/mock/DOM state leakage. | Vitest combined/full runs; AT-11. |

## 11. Compatibility and migration

- The existing V2 schema in backend/go/migrations/0049_response_durability_v2.sql already stores the complete canonical envelope and enforces a non-null response. The default implementation is therefore migration-free.
- Existing V2 rows remain readable because the decoder accepts the current outer annotation-array format and extracts the sat-annotations entry.
- Existing legacy rows remain the fallback for questions without V2 rows.
- Candidate-facing bootstrap improves nullable metadata from null to the established []/{} shapes; this is backward-compatible for clients that already handle the fields and safer for clients that iterate/object-read them.
- During rollout, frontend defensive normalization protects against an older backend or partial fixture that still emits null-like fields.
- No client score, answer, annotation, or token data is added to logs.
- If implementation evidence requires a migration, add it only after documenting the failing invariant, forward migration, backfill/default strategy, deployment order, and rollback impossibility/mitigation.

## 12. Test strategy and exact verification commands

### Fast feedback

~~~text
cd /Users/rd-cream/Downloads/remix_-ielts-proctoring-system
bun run typecheck
cd backend/go && go test ./internal/delivery ./internal/assessscore ./internal/attempts -count=1
~~~

Do not pass Go package paths to Vitest; use the existing frontend file paths for frontend tests and Go commands for backend tests.

### Focused frontend commands

~~~text
bun run test:run -- src/features/student-delivery/hooks/__tests__/useSatExamController.convergence.test.tsx src/features/student-delivery/application/__tests__/useSatResponsePersistence.v2.test.tsx src/features/student-delivery/domain/satAnnotationsV2.test.ts
bun run test:run -- src/features/student-delivery/ui/transitions/SatDirectionsScreen.test.tsx src/features/student-delivery/ui/transitions/SatTransitionScreens.test.tsx
~~~

### Focused backend commands

~~~text
cd /Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go
go test ./internal/delivery -run 'TestLoadResponsesV2|TestFinalizeModule' -count=1
go test ./internal/attempts -run 'Durability|SaveResponses|Materialize' -count=1
~~~

Use the repository’s exact test names after implementation if the focused regex needs refinement; do not silently omit a failing package.

### Full gates

Run the existing CI-equivalent commands from .github/workflows/ci.yml in their documented order.

Frontend quality gate:

~~~text
bun install --frozen-lockfile
bun run typecheck
bun run lint
bun run test:coverage
bun run build
~~~

The coverage threshold check must use the same 75% product-source calculation in .github/workflows/ci.yml; do not replace it with a test-only percentage.

Backend quality gate from backend/go:

~~~text
gofmt -l .
go vet ./...
go test -count=1 -coverprofile=/tmp/ielts-go-coverage.out ./...
go build ./cmd/api ./cmd/worker ./cmd/migrate
go test -race -count=1 ./internal/...
go run ./cmd/migrate
go run ./cmd/migrate --validate-only
TEST_MYSQL_DSN='root:root@tcp(127.0.0.1:3306)/ielts?parseTime=true&multiStatements=true&charset=utf8mb4' go test ./integration/ -v -count=1
bunx @redocly/cli lint ../../api/openapi/openapi.yaml
go run honnef.co/go/tools/cmd/staticcheck@v0.8.1 ./...
go run ./cmd/migrate --validate-only
~~~

The MySQL service must be MySQL 8.4 with the CI credentials and must be migrated before the integration test. A nonzero output from gofmt -l is a formatting failure.

Browser quality gate:

~~~text
bunx playwright install --with-deps
bunx playwright test e2e/sat-answer-recovery.spec.ts
bunx playwright test
~~~

Expected result for each gate is exit code 0, with no unhandled rejection, race report, migration drift, or unexplained skip.

## 13. Observability requirements

- Emit only safe dimensions: provider (sat), operation (bootstrap_v2_projection/hydrate), outcome, error class, attempt/module/question identifiers where the existing privacy policy permits, and revision/epoch numbers.
- Do not record answer values, eliminated option IDs if considered candidate content, annotation text, authorization tokens, raw canonical JSON, or request bodies.
- Add counters only through the existing backend/frontend telemetry abstractions; do not create a new logging system for this fix.
- Test the positive/error/defaulted paths using spies or structured event assertions that verify sensitive fields are absent.
- Treat a rise in V2 projection default/decode-failure counts after rollout as a rollback signal even if HTTP success remains high.

## 14. Rollout and rollback

### Rollout

1. Deploy backend projection/defaulting first; it is backward-compatible and makes bootstrap safer for old clients.
2. Deploy frontend defensive normalization and recovery tests next.
3. Run the real-MySQL smoke and SAT Playwright recovery path against the deployed build.
4. Monitor projection-default/decode-failure and recovery-error counters before broad rollout.

### Rollback

- Backend-only rollback is safe because the canonical V2 rows and mutation ledger are unchanged; reverting the decoder restores old projection behavior but may reintroduce the known null/metadata-loss defect, so rollback is a temporary containment action.
- Frontend rollback is safe because the defensive normalizer accepts both old and new bootstrap shapes.
- Do not roll back by deleting or rewriting V2 rows, mutation ledger rows, or legacy materializations.
- If a migration is unexpectedly required, document that it is not automatically reversible and use an additive compatibility/feature-flag strategy before deployment.

## 15. Final acceptance checklist

- [ ] The backend V2 bootstrap projection returns answer, review, eliminations, and inner SAT annotations for a metadata-bearing row.
- [ ] Missing/malformed optional metadata returns []/{}, never null, and does not block module entry.
- [ ] Frontend hydration accepts degraded payloads and preserves the newest visible local draft.
- [ ] An answer edit after hydration preserves metadata in the outgoing V2 envelope.
- [ ] V2-only scoring, legacy fallback, dual-ID deduplication, zero-answer handling, result detail, and seal tests remain green.
- [ ] Real MySQL proves persistence, constraints, replay, conflict, bootstrap, and legacy compatibility.
- [ ] Playwright proves answer + metadata + reload/recovery + edit + submit on the real student path.
- [ ] The untracked browser probes are either type-safe and intentionally owned or explicitly retired with their evidence preserved.
- [ ] SAT transition tests pass isolated, combined, and in the full suite without weakened assertions.
- [ ] Authoring FT-04b is fixed at the correct error-classification boundary and remains green in the full suite.
- [ ] bun run typecheck, lint, full Vitest, coverage, and build pass.
- [ ] Backend unit, race, migration, integration, OpenAPI, and static analysis gates pass.
- [ ] No schema migration was added without a documented failing invariant and rollout/rollback plan.
- [ ] git diff --check passes; no user-owned unrelated changes were reverted.
- [ ] Observability contains no candidate answer, annotation text, token, or raw response payload.
- [ ] The final report lists exact commands, exit statuses, test counts, known limitations, and any environment-only skips.
