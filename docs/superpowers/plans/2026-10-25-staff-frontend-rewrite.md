# SAT and IELTS Internal Frontend Rewrite Plan

> **For implementation:** Use the executing-plans workflow to deliver the checked tasks in order. This document authorizes no implementation; it is the requested architecture and migration plan. Start each correctness change with the named regression scenario, then make the smallest complete change and verify it.

**Goal:** Make SAT and IELTS staff workflows reliable and maintainable while preserving their current rendered UI.

**Architecture:** Rewrite state and orchestration incrementally behind the existing views. Reuse feature APIs, TanStack Query, typed domain rules, durable autosave, and SAT collaboration ownership. Keep server snapshots, editable drafts, URL state, and temporary interaction state distinct.

**Tech stack inspected:** React 19.2.5, React Router 7.14.1, TanStack Query 5.99.0, Zustand 5.0.12, Radix UI 1.4.3, Tailwind 4.2.2, Vite 6.4.2; strict TypeScript; Vitest, Testing Library, Playwright. Versions above are installed versions, not just package ranges. Bun is the package manager.

**Baseline:** Commit `61c5ed26`; clean working tree before planning. Inspection started 2026-10-25 and plan completed 2026-10-26, Asia/Bangkok. All paths below are relative to `/Users/rd-cream/Downloads/remix_-ielts-proctoring-system`.

## 1. Scope and preservation contract

“Internal” is interpreted as staff administration and operations:

| Area | Existing entry points | Included paths |
|---|---|---|
| SAT workspace | `src/products/sat/`, router `sat` branch | Exams, authoring, preview, settings, access/rooms, live monitoring, forms, responses, results, score conversion |
| IELTS administration | `src/features/admin/`, feature routes, `src/components/admin/` | Exams, library, scheduling, preferences, grading, results, answer history |
| IELTS authoring | `src/features/builder/`, provider routes | Configuration, builder, review, preview, answer keys, publication |
| IELTS proctoring | `src/features/proctor/`, `src/components/proctor/` | Cohort and student controls, alerts, notes, rules, presence, recovery |
| Shared staff foundations | Auth, API client, query client, existing UI primitives | Identity, cancellation, contracts, error handling, cache invalidation, overlay behavior |

Student exam delivery, backend architecture rewrites, new product features, ACT-specific redesign, framework migration, and dependency upgrades are outside scope. Shared changes must still pass existing student and ACT regression gates.

The preservation contract is explicit:

- Keep layout, DOM styling hooks, Tailwind classes, CSS/tokens, typography, spacing, colors, icons, control placement, responsive breakpoints, visible copy, and animation appearance.
- Keep route compatibility, permissions, focus return, scroll position, keyboard behavior, and existing confirmation flows. URL parameters may persist existing selections without changing the screen design.
- Correct false success, stale content, lost edits, and duplicate requests using the existing status/error/confirmation surfaces. Those behavior corrections are intended.
- Do not replace shadcn/Radix primitives or regenerate components during state work. `components.json` says `base-nova`, but installed `sheet.tsx` uses Radix. Installed source determines the API.
- No silent visual baseline updates. A legitimate dynamic-data difference must be explained; a design difference fails the slice.

## 2. Evidence: problems to fix first

These are source-backed failure paths, not a claim that every scenario has been reproduced in a real browser. Existing passing tests do not exercise every timing interleaving below.

| ID | Priority / confidence | Evidence and failure sequence | Required result |
|---|---|---|---|
| F1 | P1 / high | `src/components/admin/StudentReviewWorkspace.tsx:372`: save captures a review draft, awaits the server, then unconditionally installs `result.data`. Editing feedback while save is pending can be replaced by the older acknowledgement. The save button alone is disabled; editable fields remain active. | Acknowledging edit N never erases N+1 or clears its dirty status. An acknowledgement for submission A never populates submission B. |
| F2 | P1 / high | The same workspace reads and installs the review draft twice during `loadData`, at lines 219 and 280. After the first draft becomes editable, slow section/writing reads can finish and trigger a second server draft installation. The sequence guard tracks submission loads, not edits within the current load. | One initial draft adoption. Independent answers/metadata refreshes cannot replace local review edits. |
| F3 | P1 / high | `src/features/builder/hooks/useConfigRouteController.ts:46`: exam and version reads have no cancellation or request-generation fence. A slow A load may install exam A/config A after navigation to B. A missing B leaves old exam/config/refs installed. Post-save `loadExam()` also resets config and dirty state. | Entity identity is checked after awaits. Missing/loading B cannot expose A as B. Save acknowledgement preserves edits made after submission. |
| F4 | P1 / high | `src/features/proctor/hooks/useProctorRouteController.ts:767` and `:788` set an error on business rejection but resolve normally; `:810` ignores the completion result. `src/components/proctor/ProctorDashboard.tsx:674` shows success when the callback resolves. | Rejected end/extend/complete commands cannot produce a success toast. Confirmed command and failed refresh are separate outcomes. |
| F5 | P2 / verified key behavior | `refreshSchedule` at controller line 660 refetches `proctorKeys.sessions()` = `['proctoring','sessions','all']`; SAT subscribes to `['proctoring','sessions','sat']`. A local QueryClient probe confirms these match different cache entries. A selected-room event can refresh detail while leaving the SAT overview stale until polling. | Event refresh targets the subscribed provider or an intentional shared prefix. |
| F6 | P2 / high | Controller line 581 claims an `updatedAt` merge, but alert/note/rule mapping does not supply `updatedAt`; both values become `''`, so incoming rows win ties. Missing IDs are always retained. An older read can undo a local acknowledgement; a deleted rule can remain locally. The endpoint also bounds alerts/audit, so replacing every collection wholesale would be incorrect. | Explicit confirmed snapshot plus pending operations. Distinguish full collections from bounded windows and tombstones. Never infer deletion from an incomplete window. |
| F7 | P2 / high | `src/features/grading/api/gradingQueries.ts:65`: `filters` changes the query function result but is absent from `gradingKeys.submissions(sessionId)`. | Cache the unfiltered response and filter via a pure selector, or include normalized filters when the request actually depends on them. Existing service filtering is client-side, so prefer the first. |
| F8 | P2 / high | `src/features/admin/hooks/useAdminRootController.ts:118` updates defaults immediately and drops the persistence promise. Save failure has no returned result or rollback. `src/services/adminPreferencesRepository.ts:80` reloads a 409 revision and retries the old full config without comparing the remote content. | Draft/pending/confirmed defaults are distinct; failed saves are reported; conflicting remote edits are not silently overwritten. |

Structural risks that justify staged refactoring, rather than proving bugs by file size:

- The 1,040-line proctor controller copies query data into schedules, runtimes, students, alerts, notes, rules, metrics, and separate loading/error fields; WebSocket handlers mutate another path through that state. UI receives broad setters for server entities.
- `StudentReviewWorkspace.tsx` is 1,971 lines; `AuthoringWorkspace.tsx` is 1,762 lines; `ProctorDashboard.tsx` is 1,369 lines. Split orchestration from current markup by responsibility, not by arbitrary line count.
- The proctor hook executes automatic warn/pause/terminate rules using a component-local `Set` at line 822. That cannot establish deduplication across tabs/operators or after reload. Backend rule storage was found, but server evaluation/deduplication was not established by this inspection. This is an explicit server-contract dependency, not something a React reducer can guarantee.
- `tsconfig.json` is strict, but excludes test files. ESLint treats effect-dependency and explicit-any findings as warnings. Existing architecture tests pass with an empty violation baseline; retain them and extend scope only where needed.

## 3. Facts, assumptions, and unknowns

| Category | Statement | Consequence |
|---|---|---|
| Fact | Query, form, validation, and durable-save libraries already exist. No React Compiler plugin was found in Vite configuration. | No new state library or blanket memoization is required. |
| Fact | `useAuthoringDraft`, `useAuthoringSaveRouting`, `useAuthoringPersistence`, collaboration boundaries, and durable builder autosave already encode important safety rules. | Reuse these owners and preserve their tests; do not replace them with a generic form store. |
| Fact | Shared transport accepts `AbortSignal`; proctor/exam query functions shown do not consistently forward it. | Wire cancellation through existing adapters instead of inventing a second HTTP client. |
| Assumption | Existing visual design and supported browser behavior are the acceptance reference. | Capture fixtures and screenshots before each migration; do not invent a new design system. |
| Unknown | Exact field revision, idempotency, acknowledgement, and pagination completeness contracts for every staff endpoint. | Inspect OpenAPI plus Go handlers per slice; implement no guarantee unsupported by the server. |
| Unknown | Production failure rate, real device mix, and interaction performance. | Establish measurements before setting optimization targets. Bundle size alone does not prove slow interaction. |
| Unknown | Whether all current staff paths have reliable real-backend browser coverage. | Mocked browser tests and real-backend journeys are separate release evidence. |

## 4. Target state ownership

| State | Single owner | Rule |
|---|---|---|
| Exams, room details, schedules, submissions, results | Feature TanStack Query API | Cache keys encode response identity; no effect copies into parallel component arrays. |
| Accepted live room projection | One feature reconciliation boundary writing the selected room cache | Poll, socket, and command snapshots share identity/revision rules. Summary cards do not overwrite detailed room plans. |
| Review/configuration edits | Entity-scoped draft controller/reducer | Track acknowledged base and local edit sequence. Refetch updates the base only when safe; never resets dirty work implicitly. |
| SAT collaborative document | Existing Yjs/Hocuspocus owner | Preserve field-writer routing. Never introduce a concurrent HTTP writer for room-owned fields. |
| Editor crash recovery | Existing durable autosave/storage adapters | Actor/entity/version-scoped recovery; acknowledgement and durability determine saved status. |
| Search, filters, selected grading session/submission, meaningful tabs | Router URL where existing behavior benefits from back/refresh | Parse at the route boundary, validate IDs/enums, retain existing paths and unrelated params. |
| Dialog, drawer, hover, focus trigger | Nearest view or existing local UI owner | No server entities in global UI stores; exclusive surfaces use a tagged union when needed. |
| Protected operation | Server | Browser pending state prevents ordinary duplicates, but does not replace server authorization, revisions, or idempotency. |
| Clock | Existing authoritative deadline/room-clock hooks | One accepted server instant per room; preserve revision and monotonic-clock guards. |

Architecture direction remains `route → feature hooks/public API → infrastructure`, with pure domain reducers/selectors below hooks. Shared primitives know nothing about exam APIs. Reuse existing feature folders; do not reorganize the entire monolith or duplicate all components into a new tree.

### Draft acknowledgement contract

Use this behavior in grading and config owners; share implementation only if the resulting behavior and types truly match:

1. Start from `{ entityId, baseRevision, acknowledgedValue, localValue, editSequence }`.
2. Every local edit increments `editSequence` and updates `localValue` immutably.
3. Save captures entity identity, base revision, edit sequence, operation identity, and payload. Only one overlapping noncommutative save for that entity may run locally.
4. An acknowledgement updates only its entity's confirmed base. Adopt server-normalized fields into the displayed draft only if the save still represents the current local sequence, or through an explicit safe field reconciliation.
5. If newer edits exist, keep them dirty against the new base. Do not display Saved for them.
6. Rejection preserves local edits. A 409 retains both versions for existing conflict/reload handling. An uncertain write is reconciled before resubmission.
7. Entity changes invalidate pending UI adoption. Cache updates for an old entity may complete, but cannot change the current screen's draft or feedback.

### Command contract

Use a typed outcome distinguishing `confirmed`, `rejected`, `uncertain`, and `confirmed_refresh_failed`. Keep typed errors available to the existing toast/banner adapters.

- Pending identity includes actor/session, room or attempt, operation, and the target section/module revision when required.
- Commands capture targets when the existing confirmation opens; selection changes cannot retarget them.
- Related writes serialize at the relevant room/attempt boundary. Unrelated students' reversible operations remain independent.
- Returned `success: false` is a rejection even with HTTP 200. Never infer confirmation from a resolved Promise alone.
- TanStack `refetchQueries` swallows query errors by default in the installed source. Required reconciliation uses `throwOnError: true` and inspects offline/paused state or returned authoritative data; promise resolution alone is insufficient.
- Do not abort a write and assume it did not happen. Cancel obsolete reads; reconcile uncertain writes.

## 5. Delivery order and concrete work packages

Each package is a small series of reviewable commits. Preserve the view props initially through adapters; remove each adapter when its callers are migrated. Do not run both old and new mutation owners for one entity. Correctness patches can ship before the structural package is complete.

### Package 0 — Freeze behavior and visual references

**Existing files:** `e2e/sat-staff-room-ux.spec.ts`, `e2e/sat-staff-results-ux.spec.ts`, `e2e/sat-product-workspace.spec.ts`, `e2e/staff-draft-durability.spec.ts`, `e2e/grading-workflow.spec.ts`, `e2e/exam-builder-workflow.spec.ts`, `e2e/scheduling-workflow.spec.ts`.

**Create:** `playwright.staff-parity.config.ts`, `e2e/staff-ui-parity.spec.ts`, and Playwright-generated screenshot references for that spec. Keep a dedicated fixture configuration without database seeding for pure visual references.

- [ ] Inventory the route/role matrix from `src/app/router/createRouter.tsx`; record every staff entry and legacy redirect, including SAT release aliases and IELTS `/builder/:examId` variants.
- [ ] Add deterministic fixture states for SAT library/authoring/settings/room/forms/responses and IELTS library/config/builder/scheduling/proctor/grading/results. Pin data, fonts, clock, timezone, browser, and reduced-motion preference.
- [ ] Capture full-page and critical-dialog screenshots at 390, 768, and 1440 CSS pixels; separately cover 200% zoom/reflow and keyboard focus where a visual reference matters.
- [ ] Record current network calls, mutation counts, visible status, selected IDs, scroll return, and focus for each critical journey.
- [ ] Triage the three existing SAT fixture-browser failures recorded below. Correct stale locators/expectations to the existing latest-saved-exam behavior; do not change the UI to satisfy obsolete publication assumptions. Recheck contrast after the sheet's entry animation settles before attributing the measured colors to final tokens.
- [ ] Run the first meaningful regression tests below against the old owners and observe failures before implementing fixes. A passing new test must be examined for whether it exercises the timing window.

**Gate:** Current rendered design and intended behavior have reproducible references; baseline defects are identified separately from intended behavior.

### Package 1 — Fix the highest-impact state races in place

**Modify:** `src/components/admin/StudentReviewWorkspace.tsx`, `src/features/builder/hooks/useConfigRouteController.ts`, `src/features/proctor/hooks/useProctorRouteController.ts`, `src/features/proctor/api/proctorQueries.ts`, `src/features/grading/api/gradingQueries.ts`, `src/features/admin/hooks/useAdminRootController.ts`, `src/services/adminPreferencesRepository.ts`.

**Extend tests:** Existing `StudentReviewWorkspace.core.test.tsx`, `useConfigRouteController.test.tsx`, `useProctorRouteController.backend.test.tsx`, `useProctorRouteController.live-update.test.tsx`, `gradingQueries.test.tsx`, `AdminSettings.test.tsx`, and `adminPreferencesRepository.backend.test.ts` in their current `__tests__` directories.

- [ ] Reproduce F1/F2 with deferred section reads and save promises. Remove duplicate draft initialization; prevent obsolete acknowledgements from replacing newer edits or another submission.
- [ ] Reproduce F3 with A/B reads resolved in reverse order, B missing, and edit-during-save. Fence loads/acknowledgements by entity and sequence, clear stale identity on a real entity transition, and retain existing draft/published fallback.
- [ ] Reproduce F4 with `{ success: false }` end/extend/complete responses through the real controller-to-dashboard path. Propagate rejection and preserve the existing error surface.
- [ ] Reproduce F5 using a real QueryClient with both SAT and all-provider observers. Correct provider targeting and verify required refresh failure propagation.
- [ ] Reproduce F7 by rerendering filtered submission queries within their stale window. Cache the current service's unfiltered result and derive filtered views without changing other observers' data.
- [ ] Reproduce F8 with persistence failure and two conflicting preference writers. Expose pending/error confirmation to the current settings owner, preserve the draft, and avoid blind full-document conflict retry.
- [ ] Commit each corrected failure path with its regression test; run the relevant package tests and parity scenario before proceeding.

**Gate:** F1–F5, F7, and F8 regressions fail before their change and pass after; no visual change. F6 is handled with the explicit collection semantics in Package 4, not an unsafe blanket replacement.

### Package 2 — Make feature API ownership and contracts consistent

**Modify:** Existing feature query modules under `src/features/exam-authoring/api/`, `src/features/proctor/api/`, `src/features/grading/api/`, `src/features/results/api/`, `src/features/scheduling/api/`; their infrastructure gateways; `src/services/backendBridge.ts` only where adapter support is actually missing. Reuse `src/shared/api/apiClient.ts`, `src/shared/api/queryClient.ts`, and existing validation conventions.

**Create only where missing:** `src/features/proctor/contracts/monitoringSchemas.ts`, `src/features/grading/contracts/reviewSchemas.ts`; feature-local API tests. Extend existing exam/settings/form contracts instead of duplicating them.

- [ ] Trace each migrated read to its actual Go/OpenAPI payload and define one runtime parser at the feature boundary. Preserve required identity, revision, deadline, nullable score, and provider fields; accept additive fields.
- [ ] Pass TanStack query context `signal` through feature functions and existing transport configuration. Test cancellation at the actual fetch boundary; retain entity fencing even when cancellation arrives too late.
- [ ] Reuse feature key factories. Include server query parameters in identity; keep purely local filters in selectors. Do not merge legacy and feature cache families merely because their names look similar.
- [ ] Inventory mutation-to-read dependencies and make invalidation explicit: exam/config → affected list/detail/validation; room lifecycle → provider summaries/detail/entry state; grading save/release → draft/submission/queue/results; schedule change → schedule list and affected room overview.
- [ ] Preserve the existing no-blind-mutation-retry policy, rate-limit handling, cookies/CSRF, and auth cache cleanup. Retain domain result codes when normalizing failures.
- [ ] Test malformed payload, 401, 403, 409, 429/Retry-After, canceled read, network failure, and uncertain write response at each changed boundary. Do not log answers, access codes, names, email, tokens, or draft content.

**Gate:** One checked contract per migrated resource, request identity and cancellation work, and mutations refresh every affected current view without global invalidation.

### Package 3 — Rewrite IELTS grading behind its existing view

**Create:** `src/features/grading/domain/reviewDraftState.ts`, `src/features/grading/hooks/useReviewWorkspaceController.ts`, and corresponding domain/hook tests.

**Modify:** `src/components/admin/StudentReviewWorkspace.tsx`, `src/features/grading/routes/GradingRoute.tsx`, `src/features/grading/api/gradingQueries.ts`, and `src/components/admin/providers/AdminShellProvider.tsx` only after checking its other consumers.

- [ ] Move submission, section, writing, and published-version reads into existing/extended feature queries. Load independent resources concurrently where the current backend bundle cache permits it; retain independent partial-failure presentation.
- [ ] Move editable review state into the entity-scoped draft reducer using the acknowledgement contract. Preserve annotations, drawings, rubric bands, feedback, checklist, teacher summary, objective overrides, and current save/release business rules.
- [ ] Make review initialization one operation per submission, with the server deciding idempotency. Preserve current auto-start behavior; the loading phase must not become a second writer during Strict Mode or refetch.
- [ ] Compose save, finalize, ready-to-release, release, reopen, and override mutations in the controller. Release uses a successfully persisted current draft and authoritative result; failures retain local edits.
- [ ] Give the existing JSX a typed view model and named commands; remove direct service/repository calls from that JSX. Keep markup/classes and print/report rendering intact.
- [ ] Persist selected grading session/submission in validated search parameters on `/admin/grading`; retain the current breadcrumb/back design. The URL replaces `gradingLevel` plus independent nullable IDs as navigation authority. Avoid changing unrelated AdminShell consumers.

**Gate:** Edit/save/edit, switch-student during load/save, two-grader 409, partial answer load failure, release rejection, keyboard/back/refresh, and published-version traceback all pass. No draft loss or false release confirmation.

### Package 4 — Rewrite shared proctor monitoring and commands

**Create:** `src/features/proctor/domain/proctorSnapshot.ts`, `src/features/proctor/api/proctorMutations.ts`, `src/features/proctor/hooks/useProctorMonitoring.ts`, `src/features/proctor/hooks/useProctorCommands.ts`, and corresponding tests.

**Modify/reuse:** `useProctorRouteController.ts` as a temporary compatibility adapter; `src/features/proctor/domain/mergeProctorRuntime.ts`; `src/features/proctor/api/proctorQueries.ts`; `ProctorRoot.tsx`; `ProctorDashboard.tsx`; `src/products/sat/routes/SatSessionRoomRoute.tsx`; authoritative clock and live-update hooks.

- [ ] Separate query subscription, snapshot reconciliation, staff commands, and local selection. Remove parallel local arrays only after their writers have moved to the cache boundary.
- [ ] Make the selected detail cache the room projection owner. Poll/detail responses and socket patches use one pure reconciliation function; do not create another broad Zustand store. Summary cards keep their summary query. Any summary contribution to the selected room passes through the same revision checks and cannot replace detail-only fields.
- [ ] Preserve `mergeProctorRuntime`/session identity fences: runtime revision, attempt revision, module attempt identity/revision, server timestamp, and one room clock anchor. Older poll responses cannot reverse newer socket or command state.
- [ ] Define completeness per collection using actual endpoint behavior. Full notes/rules snapshots remove confirmed missing records; bounded alert/audit windows update their covered window or use explicit deletion information. Pending local mutations are separate overlays, not undocumented synthetic timestamps.
- [ ] Remove broad setters such as `setSessions`/`setAlerts` from public view contracts. Expose typed acknowledge, note/rule CRUD, pause/resume, warn, terminate, extend, recovery, and room commands.
- [ ] Bind pending/feedback to the captured room/attempt/operation. Ignore stale UI completion after route changes while reconciling the original entity's cache.
- [ ] Preserve poll floors/jitter, presence cleanup, rate-limit behavior, reconnect fallback, and current timing models. Coalesce burst invalidations at the existing live-update boundary instead of creating unbounded parallel reads.
- [ ] Resolve automatic-rule authority before changing it: demonstrate server-side idempotent execution across two operators, or record a backend prerequisite with rule/attempt/trigger identity. Do not remove current behavior until its replacement passes the same scenarios; do not claim frontend-only dedupe is production-safe.

**Gate:** Shared hook works for both IELTS and SAT; older snapshots never regress active module/time/status; deletion/acknowledgement behavior is correct; command rejection never shows success; room changes leak no commands or feedback. Automatic-rule cross-operator guarantees remain a release blocker until demonstrated.

**Automatic-rule authority (resolved):** Warn and pause accept an `operationId` that the server applies once per attempt under the attempt lock (`internal/proctor/service.go` `withOperationReceipt`, receipts in `assessment_lifecycle_receipts`); the request hash excludes the actor. Automatic rules derive the id from the rule, attempt, and the violation that crossed the threshold, so every operator's browser sends the same id and the second enforcement is a replay. `TestAutoRuleEnforcementIsIdempotentAcrossOperatorsMySQL` demonstrates two operators warning once and a replayed pause not re-pausing a resumed student. A second terminate is refused as already terminal, so terminate needs no id.

**Existing audit limitation:** The note repository's `saveAuditLog` method is a no-op, and the Go note upsert does not insert an audit event. The removed frontend call never recorded one. If note creation must appear in the audit log, the server must record it with the note write; a client-side follow-up cannot make those writes atomic.

### Package 5 — Rewrite IELTS config, builder orchestration, and preferences

**Create:** `src/features/builder/domain/configDraftState.ts` and tests; `src/features/admin/api/adminPreferencesQueries.ts` and tests.

**Modify/reuse:** `useConfigRouteController.ts`, `useBuilderRouteController.ts`, `useReviewRouteController.ts`, `BuilderRoot.tsx`, existing route components and `useBuilderAutosave.ts`; `src/hooks/useDurableLatestAutosave.ts`; `src/components/admin/AdminSettings.tsx`; admin defaults controller/context and preferences repository.

- [ ] Apply query-owned exam/version loading plus entity-scoped config drafts. Keep `syncConfigWithStandards` as the current normalization owner.
- [ ] Preserve full content/config coherence and expected revisions when saving. Configuration must not silently overwrite newer question content or vice versa; verify the service/Go save contract for the shared version.
- [ ] Retain durable latest-wins autosave, actor-scoped recovery, serialized writes, `flushNow`/`isLatest`, and existing navigation blocking. Use a named controller command to flush before preview/review/publication; a late earlier save never unlocks navigation for newer unsaved work.
- [ ] Move defaults into a query plus explicit draft/save mutation. Commit confirmed defaults only after acknowledgement; retain failed local input. Resolve a conflict through current settings feedback instead of retrying a stale entire configuration automatically.
- [ ] Extract nonvisual orchestration from `BuilderRoot` only where ownership becomes clearer. Do not rewrite question blocks, rich content, answer keys, or preview rendering without a reproduced defect.

**Gate:** Rapid edits, save failure, offline/reload recovery, A→B→missing config navigation, version conflict, and edit-during-flush all preserve correct content. Existing builder/preview/review UI matches references.

**Backend prerequisite (resolved):** The draft-save endpoint now accepts `expectedDraftVersionId` and compares it with the revision under the same draft row lock (`internal/exams/service.go` `SaveDraft`). Fenced config saves send the loaded or reopened draft version ID, so a draft pointer that moves to another version with the same revision returns 409 instead of overwriting it.

### Package 6 — Consolidate SAT authoring without replacing its safety model

**Modify/reuse:** `src/features/exam-authoring/ui/AuthoringWorkspace.tsx`, existing `useAuthoringDraft.ts`, `useAuthoringPersistence.ts`, `useAuthoringSaveRouting.ts`, `useAuthoringSelection.ts`, `useAuthoringOverlays.ts`, `useWorkspaceProjectionWrites.ts`, collaboration hooks, `ui/settings/FormsSettingsPanel.tsx`, access-link and room-creation owners.

**Tests:** Existing authoring hook tests, `AuthoringWorkspace.test.tsx`, `AuthoringWorkspaceCoedit.test.tsx`, `src/features/exam-authoring/realtime/coedit/__tests__/`, question autosave durability tests, and `e2e/coedit-live/` for actual collaborative-service verification.

- [ ] Inventory current writers by field: collaborative rich document, scalar metadata, queue/shell projection, settings/forms, and recovery. Record the existing owner before extracting any code.
- [ ] Keep `useAuthoringDraft` as the editable document owner and `resolveFieldWriter`/save routing as persistence authority. Strengthen command interfaces only where broad draft setters cross ownership boundaries.
- [ ] Move remaining request orchestration out of markup into the existing cohesive owners; split presentational sections without remounting editors or changing element identity.
- [ ] Preserve dirty-draft adoption protection, recovery choices, publication/deletion freezes, divergence resolution, room acknowledgement truth, and flush-before-route-change.
- [ ] Test settings/form section saves against concurrent question edits, import/reorder/bulk-delete revision changes, room creation after latest saved content, remote deletion/publication, reconnect, and entity switching.

**Gate:** One writer per field; no query/HTTP snapshot clobbers collaborative or dirty local content. Existing authoring and real collaboration lifecycle tests pass. A large file alone is not a reason to replace these working rules.

### Package 7 — Complete staff lists, scheduling, results, and overlay contracts

**Modify:** `src/features/exam-authoring/routes/ExamsRoute.tsx`, `src/components/admin/AdminExams.tsx`, library feature/routes, `src/features/scheduling/routes/SchedulingRoute.tsx`, `src/features/scheduling/ui/Scheduling/Scheduling.tsx`, `src/components/admin/AdminResults.tsx`, SAT route controllers, and existing list-parameter/return helpers.

- [ ] Apply the established query/mutation contracts to create/clone/archive/delete/bulk operations; return individual outcomes for partial failure. Selection reconciles against current IDs and is not silently assigned to reordered rows.
- [ ] Preserve list filter/search/sort/page and return position through existing URL helpers; add equivalent route-owned state where an existing staff view loses its place on back/refresh.
- [ ] Keep schedule recurrence, timezone, pinned version, entry/start modes, and validation in their current domain owners. A rejected start does not look like a successful navigation.
- [ ] Keep results nullable, pending, invalidated, released, and saved-answer states distinct. Preserve existing SAT unscored response review and IELTS published-version detail semantics.
- [ ] Consolidate overlay ownership only for affected staff surfaces. Reuse current Radix-backed or existing tested primitive contracts with the same styles; test nested confirmation, Escape, focus return, scroll lock, and sheet-close during pending save. Avoid a global primitive replacement affecting student delivery.

**Gate:** Every included route is accounted for; back/refresh and partial bulk failures work; no selected entity survives under the wrong ID; results and exports reflect server data; screenshots and keyboard flows remain consistent.

### Package 8 — Enforce boundaries, measure, and remove migration adapters

**Modify:** Existing `src/test/architecture/` guards, `eslint.config.js`, `.github/workflows/ci.yml`, and existing observability/performance owners. Remove only proven unused compatibility code and imports after caller migration.

- [ ] Extend the existing architecture guard to migrated staff feature boundaries where necessary. The current empty baseline must remain empty; do not widen baselines to accept a new bypass.
- [ ] Resolve effect-dependency and explicit-any findings in migrated owners; ratchet those rules to errors by migrated path once clean. Do not disable them or turn all 1,124 existing warnings into a prerequisite unrelated cleanup.
- [ ] Add a test TypeScript configuration following current aliases to typecheck the changed test files without weakening application strictness. Expand only as existing test debt is resolved.
- [ ] Profile representative authoring, large-room monitoring, and grading interactions. Compare route transfer size, commit duration/count, long tasks, input responsiveness, and requests per action to Package 0; optimize only demonstrated regressions/bottlenecks.
- [ ] Reuse existing privacy-safe error/action instrumentation. Record operation outcome and entity/trace identity where permitted; exclude document/answer content and personal fields.
- [ ] Remove old state arrays, compatibility setters/controllers, duplicate key exports, and redundant repository caches only when call-site search and tests show the new owner covers all callers.

**Gate:** No unexplained correctness, visual, accessibility, request-volume, or measured interaction regression; dependencies and lockfile unchanged unless a separately justified need arises.

## 6. Required regression scenarios

Use deferred promises/fake timers and real QueryClient instances for timing tests; use browser routes for navigation/focus/visual behavior. Test observable outcomes rather than hook implementation details.

| Scenario | Test action | Required observable outcome |
|---|---|---|
| Load A, navigate B | Resolve B then A; repeat with missing B | Only B or B's error is displayed; A cannot become B's save target. |
| Review draft loaded twice | Resolve initial draft, edit feedback, then resolve slow writing/section reads | The edit remains; no second initialization resets it. |
| Edit during save | Submit sequence 4, type sequence 5, resolve save 4 | Sequence 5 remains visible and unsaved; next save carries it. |
| Switch during save | Save A, open B, acknowledge A | B's draft, save status, dialog, and feedback remain B-scoped. |
| Provider event refresh | Activate SAT and all-provider caches, emit SAT room event | Correct provider summary and room detail refresh; request counts remain bounded. |
| Old poll after socket | Receive revision 12 over socket, then revision 11 poll | Runtime, active module identity, and clock do not regress. |
| Alert/rule reconciliation | Acknowledge/delete during delayed poll; include bounded alerts/audit | No resurrected confirmed deletion or stale acknowledgement rollback; unreturned window data is not treated as a deletion. |
| Business rejection | Return HTTP 200 `{success:false}` for end/extend/complete | Existing error feedback; no success toast or fake completed state. |
| Command accepted, read fails | Confirm command, fail/ pause reconciliation read | Confirmed action is distinguished from stale view; no blind repeat command. |
| Two operators/tabs | Concurrent conflicting commands and same auto-rule trigger | Server accepts/rejects deterministically; no duplicate automatic enforcement. |
| Filter observers | Two grading observers with different local filters | Each shows its own filtered view; cached raw submissions remain correct. |
| Settings conflict | Remote change between local edit and save | Local input retained; no silent overwrite with fresh revision and stale content. |
| Auth transition | Logout/session expiry during read or save, then another staff login | No prior user's cache/recovery content appears for the new actor; server permission remains authoritative. |
| Recovery | Edit, lose network, reload/reconnect, recover | Current recovery flow retains edits and truthful saved status. |
| Collaborative authoring | Two editors plus HTTP refetch and route switch | Exactly one persistence owner per field; no remount/overwrite or false saved status. |
| Keyboard/parity | Open nested overlay, cancel/confirm, navigate back at reference sizes | Existing design, focus, scroll, Escape, and accessible names preserved. |

## 7. Verification and rollout

**Per package:** Run its changed regression tests, application typecheck, targeted lint, and relevant fixture parity tests. Review the diff for unintended JSX/CSS changes and retained obsolete state. Commit a complete passing slice before continuing.

**Integration gate:**

```bash
bun run typecheck
bun run lint
bun run test:run
bun run build
bun run test:student-bundle
bunx playwright test --config playwright.staff-parity.config.ts
bunx playwright test --config playwright.sat-staff-ux.config.ts
```

For real-backend lifecycle coverage, use an explicitly dedicated test database: the existing default Playwright setup can seed fixture rows. Do not run it against an operational database. Reuse `e2e/grading-workflow.spec.ts`, `e2e/scheduling-workflow.spec.ts`, `e2e/proctor-student-interventions.spec.ts`, `e2e/staff-draft-durability.spec.ts`, `e2e/sat-authoring-lifecycle.spec.ts`, and `e2e/ielts-personal-timing.spec.ts` under the appropriate existing fixture setup. Run `bun run coedit:test` and the existing coedit live configuration for the collaboration slice.

Roll out by workflow: bounded correctness patches → IELTS grading → shared proctor monitoring → IELTS builder/settings → SAT authoring/settings → remaining lists/results. Use the project's existing staging/release mechanism. If a runtime flag is needed, scope it to a read/controller cutover; never execute both mutation owners. Avoid switching owners while an active dirty draft is mounted.

Rollback is a code release to the previous workflow owner; this frontend plan requires no schema migration. Retain recovery-key compatibility throughout. A rollback must not discard newer durable drafts or reconnect a retired writer beside the collaborative owner.

Stop a slice on lost edits, cross-entity data, unauthorized access, false confirmation, regressed deadline/module identity, duplicate consequential enforcement, failed critical browser journey, or unexplained visual diffs. Do not label the frontend production-ready until these gates and real-backend contracts are verified.

## 8. Verification performed for this planning pass

| Check | Result |
|---|---|
| `bun run typecheck` | PASS, exit 0. |
| `bun run lint` | PASS with debt: 0 errors, 1,124 warnings. This is not a clean lint baseline. |
| `bun run build` | PASS, 39.69s; generated output only. |
| Proctor hooks/domain, SAT route tests, grading/scheduling API tests, builder config test, architecture guards | PASS: 29 files, 242 tests. |
| Review workspace core/answers, config fallback, review controller, authoring draft/save-routing tests | PASS: 6 files, 45 tests. |
| Real QueryClient provider-key probe | Verified `sessions/all` does not match `sessions/sat`. |
| `bunx playwright test --config playwright.sat-staff-ux.config.ts` | FAIL: 13 passed, 3 failed, 33.0s. Failure classification below. Mock HTTP fixtures; no live backend verification. |
| Full unit suite, coverage, real-backend staff E2E, real collaborative sessions, production performance | NOT RUN for this plan. |
| Manual rendered IELTS/SAT visual audit | NOT PERFORMED; screenshot preservation remains Package 0 work. |

Browser failure classification:

1. `e2e/sat-staff-results-ux.spec.ts:156`: axe reports serious `color-contrast` failures in the response inspector, including measured 3.46:1 secondary text and 2.75:1 status text against a required 4.5:1. The audit runs directly after sheet visibility; entry-animation timing may affect the measured blended colors and needs confirmation. Preserve the failure and trace; do not disable the audit or change colors under this UI-preservation scope. Filter assertions after that audit were not reached.
2. `e2e/sat-staff-room-ux.spec.ts:655`: `getByLabel("Exam")` is ambiguous between the select and the region named “Exam content for this room.” This is a test locator failure; scope it to the select or use an exact label. Later create-room assertions were not reached.
3. `e2e/sat-staff-room-ux.spec.ts:694`: expects `SAT Practice 03 · Version 3` in the room dialog, but the current UI and `SatCreateRoomFlow.tsx` deliberately describe “the latest saved exam.” This is an obsolete expectation, not evidence that the current UI must be changed back. Actual creation/pinning still needs current-contract coverage.

The fixture run also logged WebSocket proxy `ECONNREFUSED 127.0.0.1:4000`, so its passing checks establish mocked HTTP/recovery behavior rather than a healthy live socket. Failure contexts and traces are in the corresponding `test-results/sat-staff-*/` directories; command logs were captured in `/tmp/ielts-staff-rewrite-*.log` for this planning session.

The 287 passing existing unit/integration tests provide a baseline, not evidence that the newly identified races are fixed. No application source, styling, dependencies, or UI was changed in this planning pass.

## 8a. Implementation verification (2026-10-28)

| Check | Result |
|---|---|
| `bun run typecheck`, `bun run typecheck:staff-tests` | PASS |
| `bun run lint` | PASS: 0 errors, 1,104 warnings (baseline 1,124). `react-hooks/exhaustive-deps` and `no-explicit-any` are errors for every migrated owner: admin, grading, proctor, results and scheduling features; builder api/domain/hooks and `BuilderRoot`; exam-authoring realtime and save routing; `components/proctor`; `AdminExams`, `AdminResults`, `AdminSettings`, `StudentReviewWorkspace`; `SatSessionRoomRoute`; `useFocusTrap`. |
| `bun run test:run` | PASS: 838 files, 7,254 tests (2 skipped). |
| `bun run build`, `bun run test:student-bundle` | PASS; student provider bundle isolation verified. |
| `playwright.staff-parity.config.ts` | PASS: 112/112, references unchanged (no `--update-snapshots`). Includes the network-baseline request counts (no request-volume regression) and a smoke pass over the 9 staff routes with no reference screenshot, so every route in the route matrix is accounted for. |
| `playwright.sat-staff-ux.config.ts` | PASS: 16/16 (the three planning-time failures are resolved). |
| `playwright.coedit-live.config.ts` (own Go API, Hocuspocus service, MySQL) | PASS: 2/2. Found and fixed a composer crash on room close and an unbounded token re-mint loop after a clean close. |
| Go: `internal/exams`, `internal/proctor`, OpenAPI drift, MySQL receipt suites | PASS, including `TestAutoRuleEnforcementIsIdempotentAcrossOperatorsMySQL`. |

| `bun run coedit:test` | PASS: 128 tests. |
| Real-backend journeys on an isolated database (`grading-workflow`, `scheduling-workflow`, `proctor-student-interventions`, `staff-draft-durability`, `sat-authoring-lifecycle`, `ielts-personal-timing`, chromium) | PASS: 22/22, including 500 concurrent IELTS candidates. Found and fixed: a closed IELTS accessibility dialog rendering over the exam, and a malformed forms response crashing the SAT workspace. Publish-then-create SAT tests for the removed release workflow were retired; the current single-operation room creation is covered by unit tests and `sat-staff-room-ux`. |

`playwright.staff-perf.config.ts` profiles the three representative interactions on a production build at 4x CPU throttling with the fixture transport. The same spec ran three times on the Package 0 commit (`7e00687e`) and on HEAD. Medians:

| Interaction | Long tasks (ms) P0 → HEAD | Slowest input event (ms) P0 → HEAD | Requests per action |
|---|---|---|---|
| SAT authoring: type 51 characters | 0 → 0 | 64 → 72 | 0 → 0 |
| Proctor room, 300 students: search and clear | 553 → 521 | 376 → 408 | 0 → 0 |
| Grading review: type 51 characters of feedback | 0 → 0 | 24 → 24 | 0 → 0 |

Run-to-run ranges overlap (proctor events: 376–400 on P0, 384–456 on HEAD), so there is no demonstrated regression and no optimization was made. Filtering a 300-student room costs about 400 ms per keystroke under throttling on both commits. That is a pre-existing bottleneck, recorded here for future work.

Other Package 7 and 8 gates:

- Overlays: every hand-rolled staff modal now has dialog semantics, `useFocusTrap` focus containment, Escape, and focus return. These are the `AdminExams` create, clone, bulk and version-history dialogs; `ScheduleSessionModal`; `StudentReportPreview`; `VersionCompareView`; and the co-edit `CollisionWarning`. The AdminRoot mobile sidebar backdrop is non-modal and stays as it is.
- Architecture guard: `feature-internal-boundary` now covers `src/features/proctor` as well as assessment authoring. Every proctor consumer goes through `features/proctor/api`, and the baseline is still empty.
- Instrumentation: `apiClient` already logs every failed operation with endpoint (entity IDs), request ID and attempt count, and no payload or personal content. Typed `CommandOutcome`s carry the outcome to callers. No new telemetry was needed.
- Compatibility removal: the unused SAT room path constants and the old authoring-internal layer list were removed after call-site search. Grading list views (`GradingSessionList`, `GradingSessionDetail`, objective panels) and `AdminScheduling` were not named for rewrite. They still read their existing services, which are not unused, so they stay.

## 9. Reference basis

The recommendation follows React's guidance to derive render data and reserve effects for external synchronization: [You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect). Cache identity and read cancellation follow [TanStack Query keys](https://tanstack.com/query/v5/docs/framework/react/guides/query-keys) and [query cancellation](https://tanstack.com/query/v5/docs/framework/react/guides/query-cancellation). These are architectural references, not a recommendation to upgrade; installed package types/source remain the API reference for implementation.

**Recommended first deliverable:** Package 0 plus the F1/F2 grading-draft regression and correction, followed by F3 config identity and F4 command rejection. This makes the rewrite immediately useful while preserving the current UI and limiting the first review's scope.
