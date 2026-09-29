1. Both branches' questions are exposed. Confirmed.

assembleBootstrap (backend/go/internal/delivery/start_submit.go, ~L802) calls LoadSections(versionID). That returns every module of every section, with questions.
The only narrowing is by section scope (deliverySectionsForScope). It never narrows by module, so Lower and Higher Module 2 both go to every student.
Answer keys are already redacted by the deliveredAnswer allowlist. What leaks is the stimulus, prompt and options, not the correct answers.
The client keeps current.sections after the first load. But refresh() in useSatExamController.ts (~L400) already falls back to a full bootstrap when the state endpoint shows a module the client doesn't know. That makes the fix cheap.

2. Stale handoff state. Confirmed.

The client's stale guard (acceptPayloadAndRoute, useSatExamController.ts ~L317–322) compares only timing.runtimeRevision. That is a schedule-wide revision.
In personal timing, the M1→M2 transition changes module-attempt state, not the runtime revision. Two payloads with the same runtime revision can therefore be applied in either order.
isEquivalentBootstrap has the same weakness. Server-side, student_attempts.revision and per-module revision already exist, and there is a maxModuleRevisionTx event revision. I haven't checked whether every transition bumps one attempt-level counter that the payload exposes.
All paths (poll, state, startModule hint) go through acceptPayloadAndRoute, and there is a commitForTest seam. So the fix is localized and easy to test.

3. Last-second answer and wrong branch: mostly handled already.

Saves and finalization serialize on the same assessment_module_attempts … FOR UPDATE row.
The deadline comes from DB time inside the transaction, plus a 3 s SATSaveGrace. The worker only closes modules past deadline + grace.
Finalization is a compare-and-set. The route decision is inserted in the same transaction, and assertAdaptiveRouteIntegrity plus a result-level fence check it. Bootstrap also reconciles expired modules before reading.
Residual I found: after a module closes, a late save can still be accepted through ensureTimeoutResponseRecoveryTx, which rescores raw_correct via repairTimeoutFinalizedModuleTx.
In personal timing, M2 is inserted active in the same transaction, so recovery closes.
In cohort timing, the next module is inserted not_started, and the recovery check ignores that state. Recovery therefore stays open until M2 starts.
Nothing updates assessment_route_decisions, so the module's score can move while the stored route stays fixed.
I haven't reproduced this, and I don't know whether it is the scenario your earlier finding described.

4. Timeout capacity.

The personal-timeout worker runs every 1 s, pages by 250, and sweeps at most 2,500 candidates per tick (reconcile.go, personalTimeoutSweepLimit).
Students' own polls also close their modules lazily, so the worker is a backstop.
A synchronized load test already exists: k6/sat-module-entry-2000.js in adaptive mode. It expires a module at K6_WAVE_AT_MS and checks the branch and response count per student. So the work is extending and running it, not building a new one.

I'll read the remaining code the plan depends on (client section usage, the state endpoint, and where the attempt revision is bumped) so each step names exact files and functions.I'm still reading client code that consumes `sections`, so the plan's filtering step doesn't break module ordering or the on-demand content path. After that I'll write the full plan.I'm nearly done reading. One more check on the existing client tests and the cohort-mode recovery path, and then I'll write the full plan.Last check before writing: whether the lazy timeout close inside `Bootstrap` honors the 3 s save grace. That decides how I frame the last-second-answer step.# Implementation plan: branch filtering, monotonic client state, and last-second-answer closure

I read the code in `backend/go` and `src/features/student-delivery` before writing this. I did not run any tests or builds. This plan is narrower than my last one, because two things I had planned turned out to be unnecessary. It edits existing files only, with no flags, no v2 paths, and no rollout steps.

## Corrections to my earlier plan

**No new revision column or API field is needed.** I re-checked every `UPDATE assessment_module_attempts` in the backend with a script. My earlier grep missed multi-line SQL and wrongly flagged some as not bumping the revision. All 17 statements do bump `revision = revision + 1`. Rows are never deleted, so per-row revisions already give a monotonic order. The stale-screen fix is therefore client-side.

**The timeout close already honors the 3 s save grace.** Both the worker sweep and the lazy reconcile inside `Bootstrap()` use `dbNow - SATSaveGrace`. That step is now "prove it with race tests, then close the remaining gap" instead of a redesign.

## Step 0: failing tests first

Write these before touching production code, and confirm each fails for the right reason.

1. **Go, `internal/delivery/branch_content_test.go`:** unit tests for the new filter function (Step 1).
2. **Go, `backend/go/integration/sat_adaptive_routing_test.go`:** real MySQL. Drive a candidate through Module 1 to Higher, then to Lower. Marshal the `Bootstrap` to JSON and assert the other branch's module ID, question IDs and canary text appear nowhere. Give the fixture questions unique canary strings.
3. **Vitest, `hooks/__tests__/useSatExamController.adaptiveHandoff.test.tsx`:** call `commitForTest(newer)` then `commitForTest(older)`. The second call must return `false` and leave `dataRef` unchanged. Add a case with two deferred `bootstrap` promises resolved in reverse order.
4. **Go, `internal/delivery/revision_contract_test.go`:** a source-scanning test in the style of `cmd/api/delivery_bootstrap_contract_test.go`. It fails if any `UPDATE assessment_module_attempts` or `UPDATE assessment_attempt_breaks` statement lacks a revision bump. I audited the module-attempt sites but not the 8 break sites, so this test does that audit and guards it afterwards.
5. **Go integration, real MySQL:** a race test for saves against timeout finalization (Step 3).

The existing `adaptiveHandoff.test.tsx` fixture deliberately carries both branches in one payload. After Step 1 the server never sends that shape. Change the fixture to the real shape: only the assigned branch has an attempt and appears in `sections`. Keep the "never open Lower" assertions.

## Step 1: filter question content by assigned module (SEV-1)

**Current behavior:**
- `Bootstrap()` (`service.go` ~L300) and `assembleBootstrap()` (`start_submit.go` ~L802) both send every module of every in-scope section, including both branches.
- The answer key is already stripped by `deliveredAnswer`. What leaks is the stimulus, prompt and options.
- The module attempt row for a branch is inserted only for the selected module, in the same transaction as the route decision (`nextModuleTx`). "Has an attempt row" is therefore exactly "was assigned".

**Edits:**

1. **`internal/delivery/service.go`**, next to `deliverySectionsForScope`. Add this function:

```go
func deliverySectionsForAttempt(sections []DeliverySection, attempts []ModuleAttempt) []DeliverySection {
	opened := make(map[string]bool, len(attempts))
	for _, a := range attempts { opened[a.ModuleID] = true }
	out := make([]DeliverySection, 0, len(sections))
	for _, s := range sections {
		mods := make([]DeliveryModule, 0, len(s.Modules))
		for _, m := range s.Modules {
			isBranch := m.AdaptiveRole == "lower_branch" || m.AdaptiveRole == "higher_branch"
			if isBranch && !opened[m.ID] { continue }
			mods = append(mods, m)
		}
		s.Modules = mods // s is a copy; the shared cache tree is never mutated
		out = append(out, s)
	}
	return out
}
```

2. **Call sites.** In both `Bootstrap()` and `assembleBootstrap()`, call it right after `loadModuleAttempts` and before `filterModuleAttemptsForSections`. `ensureBaseModuleAttempt` keeps using the scope-filtered tree, because it needs the base module.
3. **`sat_entry_state.go` `selectedModuleSection`.** Add an `attemptID` parameter. Require a row in `assessment_module_attempts` for `(attempt_id, module_id)` before returning content, otherwise the existing 404. `StartModule` already locks that row, so this is defense in depth. Update the one caller in `StartModuleOfferAck`.
4. **`media.go` `CanAttemptReadMedia`.** It currently scans every module in the version, so a student can fetch an image of the other branch by asset ID. Load the attempt's module IDs and skip branch modules with no attempt row, using the same predicate.

**Client:**
- No production change is needed. `refresh()` already falls back to a full bootstrap when the state endpoint shows a module the client lacks. `startPendingModule` already sends `needContent`.
- The client's section-boundary logic (`modulesInExamOrder`, `moduleStartsNewSection`) compares section identity. Base modules are always kept, so it stays correct.

**Tests to add or extend:**
- Unit: pre-routing keeps base only; routed Higher keeps Higher only; routed Lower keeps Lower only; `none` modules always kept; the input slice is unchanged.
- Integration: the raw-JSON canary scan from Step 0, `CanAttemptReadMedia` returning false for the other branch's asset, and `selectedModuleSection` returning 404 for the other module.
- Client: a state payload with a new module attempt missing from `sections` triggers exactly one full bootstrap.
- Playwright (`playwright.sat-transition.config.ts`): intercept every network response through the routing handoff and scan for the other branch's IDs.
- k6 `sat-module-entry-2000.js` (adaptive mode): credentials already carry `otherModuleId`, and line 141 checks the entry state for it. Add an assertion that the Bootstrap response body does not contain that ID or the other branch's question IDs.

**Still to audit:**
- Any other student-facing route that serializes content. The raw-response test must enumerate every route registered under the attempt-bearer middleware in `cmd/api` (including `handlers_v2.go` and `internal/student/readthrough.go`), not just Bootstrap.
- Student result and review endpoints.

## Step 2: monotonic candidate state on the client

**Current behavior:** `acceptPayloadAndRoute` (`useSatExamController.ts` ~L317) drops a payload only when `timing.runtimeRevision` regresses. In personal timing, Module 1 → Module 2 changes module-attempt rows, not the runtime revision. Two payloads with equal runtime revision can be applied in either order, and `isEquivalentBootstrap` has the same blind spot.

**Edits:**

1. **`application/satBootstrapEquality.ts`** (same pure-function home as `isEquivalentBootstrap`). Add and export:

```ts
export function regressesAttemptState(prev: AssessmentDeliveryBootstrap, next: AssessmentDeliveryBootstrap): boolean {
  if (prev.attempt.id !== next.attempt.id) return false; // the identity guard owns this
  const isFinal = (s: string) => s === "submitted" || s === "locked";
  const nextById = new Map(next.attempt.moduleAttempts.map((m) => [m.id, m]));
  for (const p of prev.attempt.moduleAttempts) {
    const n = nextById.get(p.id);
    if (!n || n.revision < p.revision) return true;          // dropped row or older row
    if (isFinal(p.state) && !isFinal(n.state)) return true;  // final state never reverts
  }
  const nextBreaks = new Map((next.attempt.personalBreaks ?? []).map((b) => [b.id, b]));
  for (const p of prev.attempt.personalBreaks ?? []) {
    const n = nextBreaks.get(p.id);
    if (!n || n.revision < p.revision) return true;
  }
  return prev.result != null && next.result == null;         // result never disappears
}
```

2. **`useSatExamController.ts` `acceptPayloadAndRoute`.** Right after the runtime-revision guard, add `if (current && regressesAttemptState(current, payload)) return false;`. Every path goes through this function: poll, state, full bootstrap, and the start-module hint (via `applyEntryAck`). One guard covers them all, and a rejected payload already reports "no change" and stays retryable.
3. **No server change.** The guard test from Step 0 keeps the server invariant from regressing.

**Tests:**
- Table-driven unit tests for `regressesAttemptState`. Cover: same payload, Module 2 row missing, older module revision, final state reverting, break revision regression, result disappearing.
- A permutation test: take snapshots [M1 active] → [M1 locked + M2 created] → [M2 entered] → [M2 locked] and apply every ordering. The final accepted state must always be the last snapshot.
- The two vitest cases from Step 0.
- Playwright: delay the first handoff response so it arrives after the second, and assert the screen never regresses.

## Step 3: last-second answer and route correctness

Verify first, then patch only what a test shows is broken.

**Facts from the code:**
- `SaveResponse` and `finalizeModuleTx` serialize on the same `assessment_module_attempts … FOR UPDATE` row.
- Finalization scores from the rows it reads under that lock and inserts the route decision in the same transaction, with `assertAdaptiveRouteIntegrity` as a fence.
- The 3 s grace is applied in the worker sweep and in the lazy reconcile.
- The non-recovery save path uses in-transaction DB time (`moduleTimingGateTx`). The recovery path uses the API host's pre-transaction wall clock.

**Race tests (real MySQL, many iterations, in `backend/go/integration`):**
1. A save committed before finalization is in the score, and the route equals `chooseAdaptiveRoute` on that score.
2. A save after finalization is rejected, or takes the recovery path.
3. Route consistency: for every finalized base module, recompute the route from the stored answers and compare it with `assessment_route_decisions.selected_route`.
4. A save at deadline + grace + 1 s while the module is still `active` (worker behind). If this is accepted, add a deadline-plus-grace check for the personal gate in `SaveResponse`, using `gated.now`. Today only `timingGateLegacy` calls `ensureSaveModuleAdmitted`.

**Known gap, patch regardless (`service.go`, `ensureTimeoutResponseRecoveryTx`):**
- Recovery rescores a locked module through `repairTimeoutFinalizedModuleTx`, but nothing updates `assessment_route_decisions`.
- The "downstream started" check ignores `not_started` rows. In cohort timing the next module is inserted `not_started`, so recovery stays open after routing.
- **Fix:** if the module is a base module and a row exists in `assessment_route_decisions` with `base_module_attempt_id` equal to this module attempt, return `TIMEOUT_RECOVERY_CLOSED`.
- **Trade-off:** an answer that arrived just in time but lost the lock race is rejected with an explicit error instead of silently making the score and the route disagree. Keep that as the default unless you want the opposite.
- Confirm the client shows an unsaved-answer error for `TIMEOUT_RECOVERY_CLOSED`. I did not check.

**Not changing, but flagging:** the recovery deadline check uses the API host clock against DB-derived deadlines, so host/DB clock skew directly changes what recovery admits. Keep time sync between hosts and the database monitored.

**Also unverified:** `attempts.SaveResponses` in `internal/attempts` is a second, batch save path with its own grace logic. Confirm which endpoints the student client actually calls. Every one of them must enforce the deadline by in-transaction DB time.

## Step 4: synchronized timeout capacity (release gate)

**Current behavior:**
- The personal-timeout sweep runs every 1 s, pages by 250, and handles at most 2,500 candidates per tick (`personalTimeoutSweepLimit`).
- The batch is handed to `reconcileTimeoutCandidateBatch`. I did not read that function, so read it first to confirm whether it is sequential or parallel.
- Students' own polls also close their modules lazily.

**Extend `k6/sat-module-entry-2000.js` (adaptive mode):**
1. Record expiry → branch visible per candidate against `K6_WAVE_AT_MS`. Report p50/p95/p99/max.
2. Add a scenario where each candidate keeps saving answers and polling until zero. Lazy-close and worker contention only appear with concurrent traffic.
3. Per candidate, check that the route equals the score of the saved answers, that no saved answer was lost, and (from Step 1) that no other-branch content appears.
4. Run against staging with real MySQL, at 1× and 2× your largest cohort. Also run once with the worker killed mid-burst and once with two workers, to check idempotency.
5. Collect worker tick duration and backlog (existing `poolstats` and job-duration metrics), lock waits and deadlocks from MySQL, and API error rate.

**Proposed pass bar, to agree with the exam team:** p99 under 10 s, max under 30 s, zero misroutes, zero lost accepted answers, and worker tick duration under its 1 s interval or a backlog that drains within the target.

**If it fails:** the usual fixes are a drain loop until no candidates remain (instead of stopping at 2,500) and concurrent processing with `SELECT … FOR UPDATE SKIP LOCKED`. Choose after reading the batch function.

## Done criteria

Run these, and expect a clean pass before calling the work finished:
- `cd backend/go && go test ./internal/delivery/... ./internal/attempts/... ./cmd/api/...`, plus the integration suite per `backend/go/integration/README.md`
- `bunx vitest run src/features/student-delivery`, `bun run typecheck`, `bun run lint`
- Playwright sat-transition, and the k6 adaptive run meeting the Step 4 bar

Separately, past exams already exposed both branches to every student. Whether that affects item security is a decision for the exam owners, not a code change.1. Both branches' questions are exposed. Confirmed.

assembleBootstrap (backend/go/internal/delivery/start_submit.go, ~L802) calls LoadSections(versionID). That returns every module of every section, with questions.
The only narrowing is by section scope (deliverySectionsForScope). It never narrows by module, so Lower and Higher Module 2 both go to every student.
Answer keys are already redacted by the deliveredAnswer allowlist. What leaks is the stimulus, prompt and options, not the correct answers.
The client keeps current.sections after the first load. But refresh() in useSatExamController.ts (~L400) already falls back to a full bootstrap when the state endpoint shows a module the client doesn't know. That makes the fix cheap.

2. Stale handoff state. Confirmed.

The client's stale guard (acceptPayloadAndRoute, useSatExamController.ts ~L317–322) compares only timing.runtimeRevision. That is a schedule-wide revision.
In personal timing, the M1→M2 transition changes module-attempt state, not the runtime revision. Two payloads with the same runtime revision can therefore be applied in either order.
isEquivalentBootstrap has the same weakness. Server-side, student_attempts.revision and per-module revision already exist, and there is a maxModuleRevisionTx event revision. I haven't checked whether every transition bumps one attempt-level counter that the payload exposes.
All paths (poll, state, startModule hint) go through acceptPayloadAndRoute, and there is a commitForTest seam. So the fix is localized and easy to test.

3. Last-second answer and wrong branch: mostly handled already.

Saves and finalization serialize on the same assessment_module_attempts … FOR UPDATE row.
The deadline comes from DB time inside the transaction, plus a 3 s SATSaveGrace. The worker only closes modules past deadline + grace.
Finalization is a compare-and-set. The route decision is inserted in the same transaction, and assertAdaptiveRouteIntegrity plus a result-level fence check it. Bootstrap also reconciles expired modules before reading.
Residual I found: after a module closes, a late save can still be accepted through ensureTimeoutResponseRecoveryTx, which rescores raw_correct via repairTimeoutFinalizedModuleTx.
In personal timing, M2 is inserted active in the same transaction, so recovery closes.
In cohort timing, the next module is inserted not_started, and the recovery check ignores that state. Recovery therefore stays open until M2 starts.
Nothing updates assessment_route_decisions, so the module's score can move while the stored route stays fixed.
I haven't reproduced this, and I don't know whether it is the scenario your earlier finding described.

4. Timeout capacity.

The personal-timeout worker runs every 1 s, pages by 250, and sweeps at most 2,500 candidates per tick (reconcile.go, personalTimeoutSweepLimit).
Students' own polls also close their modules lazily, so the worker is a backstop.
A synchronized load test already exists: k6/sat-module-entry-2000.js in adaptive mode. It expires a module at K6_WAVE_AT_MS and checks the branch and response count per student. So the work is extending and running it, not building a new one.

I'll read the remaining code the plan depends on (client section usage, the state endpoint, and where the attempt revision is bumped) so each step names exact files and functions.I'm still reading client code that consumes `sections`, so the plan's filtering step doesn't break module ordering or the on-demand content path. After that I'll write the full plan.I'm nearly done reading. One more check on the existing client tests and the cohort-mode recovery path, and then I'll write the full plan.Last check before writing: whether the lazy timeout close inside `Bootstrap` honors the 3 s save grace. That decides how I frame the last-second-answer step.# Implementation plan: branch filtering, monotonic client state, and last-second-answer closure

I read the code in `backend/go` and `src/features/student-delivery` before writing this. I did not run any tests or builds. This plan is narrower than my last one, because two things I had planned turned out to be unnecessary. It edits existing files only, with no flags, no v2 paths, and no rollout steps.

## Corrections to my earlier plan

**No new revision column or API field is needed.** I re-checked every `UPDATE assessment_module_attempts` in the backend with a script. My earlier grep missed multi-line SQL and wrongly flagged some as not bumping the revision. All 17 statements do bump `revision = revision + 1`. Rows are never deleted, so per-row revisions already give a monotonic order. The stale-screen fix is therefore client-side.

**The timeout close already honors the 3 s save grace.** Both the worker sweep and the lazy reconcile inside `Bootstrap()` use `dbNow - SATSaveGrace`. That step is now "prove it with race tests, then close the remaining gap" instead of a redesign.

## Step 0: failing tests first

Write these before touching production code, and confirm each fails for the right reason.

1. **Go, `internal/delivery/branch_content_test.go`:** unit tests for the new filter function (Step 1).
2. **Go, `backend/go/integration/sat_adaptive_routing_test.go`:** real MySQL. Drive a candidate through Module 1 to Higher, then to Lower. Marshal the `Bootstrap` to JSON and assert the other branch's module ID, question IDs and canary text appear nowhere. Give the fixture questions unique canary strings.
3. **Vitest, `hooks/__tests__/useSatExamController.adaptiveHandoff.test.tsx`:** call `commitForTest(newer)` then `commitForTest(older)`. The second call must return `false` and leave `dataRef` unchanged. Add a case with two deferred `bootstrap` promises resolved in reverse order.
4. **Go, `internal/delivery/revision_contract_test.go`:** a source-scanning test in the style of `cmd/api/delivery_bootstrap_contract_test.go`. It fails if any `UPDATE assessment_module_attempts` or `UPDATE assessment_attempt_breaks` statement lacks a revision bump. I audited the module-attempt sites but not the 8 break sites, so this test does that audit and guards it afterwards.
5. **Go integration, real MySQL:** a race test for saves against timeout finalization (Step 3).

The existing `adaptiveHandoff.test.tsx` fixture deliberately carries both branches in one payload. After Step 1 the server never sends that shape. Change the fixture to the real shape: only the assigned branch has an attempt and appears in `sections`. Keep the "never open Lower" assertions.

## Step 1: filter question content by assigned module (SEV-1)

**Current behavior:**
- `Bootstrap()` (`service.go` ~L300) and `assembleBootstrap()` (`start_submit.go` ~L802) both send every module of every in-scope section, including both branches.
- The answer key is already stripped by `deliveredAnswer`. What leaks is the stimulus, prompt and options.
- The module attempt row for a branch is inserted only for the selected module, in the same transaction as the route decision (`nextModuleTx`). "Has an attempt row" is therefore exactly "was assigned".

**Edits:**

1. **`internal/delivery/service.go`**, next to `deliverySectionsForScope`. Add this function:

```go
func deliverySectionsForAttempt(sections []DeliverySection, attempts []ModuleAttempt) []DeliverySection {
	opened := make(map[string]bool, len(attempts))
	for _, a := range attempts { opened[a.ModuleID] = true }
	out := make([]DeliverySection, 0, len(sections))
	for _, s := range sections {
		mods := make([]DeliveryModule, 0, len(s.Modules))
		for _, m := range s.Modules {
			isBranch := m.AdaptiveRole == "lower_branch" || m.AdaptiveRole == "higher_branch"
			if isBranch && !opened[m.ID] { continue }
			mods = append(mods, m)
		}
		s.Modules = mods // s is a copy; the shared cache tree is never mutated
		out = append(out, s)
	}
	return out
}
```

2. **Call sites.** In both `Bootstrap()` and `assembleBootstrap()`, call it right after `loadModuleAttempts` and before `filterModuleAttemptsForSections`. `ensureBaseModuleAttempt` keeps using the scope-filtered tree, because it needs the base module.
3. **`sat_entry_state.go` `selectedModuleSection`.** Add an `attemptID` parameter. Require a row in `assessment_module_attempts` for `(attempt_id, module_id)` before returning content, otherwise the existing 404. `StartModule` already locks that row, so this is defense in depth. Update the one caller in `StartModuleOfferAck`.
4. **`media.go` `CanAttemptReadMedia`.** It currently scans every module in the version, so a student can fetch an image of the other branch by asset ID. Load the attempt's module IDs and skip branch modules with no attempt row, using the same predicate.

**Client:**
- No production change is needed. `refresh()` already falls back to a full bootstrap when the state endpoint shows a module the client lacks. `startPendingModule` already sends `needContent`.
- The client's section-boundary logic (`modulesInExamOrder`, `moduleStartsNewSection`) compares section identity. Base modules are always kept, so it stays correct.

**Tests to add or extend:**
- Unit: pre-routing keeps base only; routed Higher keeps Higher only; routed Lower keeps Lower only; `none` modules always kept; the input slice is unchanged.
- Integration: the raw-JSON canary scan from Step 0, `CanAttemptReadMedia` returning false for the other branch's asset, and `selectedModuleSection` returning 404 for the other module.
- Client: a state payload with a new module attempt missing from `sections` triggers exactly one full bootstrap.
- Playwright (`playwright.sat-transition.config.ts`): intercept every network response through the routing handoff and scan for the other branch's IDs.
- k6 `sat-module-entry-2000.js` (adaptive mode): credentials already carry `otherModuleId`, and line 141 checks the entry state for it. Add an assertion that the Bootstrap response body does not contain that ID or the other branch's question IDs.

**Still to audit:**
- Any other student-facing route that serializes content. The raw-response test must enumerate every route registered under the attempt-bearer middleware in `cmd/api` (including `handlers_v2.go` and `internal/student/readthrough.go`), not just Bootstrap.
- Student result and review endpoints.

## Step 2: monotonic candidate state on the client

**Current behavior:** `acceptPayloadAndRoute` (`useSatExamController.ts` ~L317) drops a payload only when `timing.runtimeRevision` regresses. In personal timing, Module 1 → Module 2 changes module-attempt rows, not the runtime revision. Two payloads with equal runtime revision can be applied in either order, and `isEquivalentBootstrap` has the same blind spot.

**Edits:**

1. **`application/satBootstrapEquality.ts`** (same pure-function home as `isEquivalentBootstrap`). Add and export:

```ts
export function regressesAttemptState(prev: AssessmentDeliveryBootstrap, next: AssessmentDeliveryBootstrap): boolean {
  if (prev.attempt.id !== next.attempt.id) return false; // the identity guard owns this
  const isFinal = (s: string) => s === "submitted" || s === "locked";
  const nextById = new Map(next.attempt.moduleAttempts.map((m) => [m.id, m]));
  for (const p of prev.attempt.moduleAttempts) {
    const n = nextById.get(p.id);
    if (!n || n.revision < p.revision) return true;          // dropped row or older row
    if (isFinal(p.state) && !isFinal(n.state)) return true;  // final state never reverts
  }
  const nextBreaks = new Map((next.attempt.personalBreaks ?? []).map((b) => [b.id, b]));
  for (const p of prev.attempt.personalBreaks ?? []) {
    const n = nextBreaks.get(p.id);
    if (!n || n.revision < p.revision) return true;
  }
  return prev.result != null && next.result == null;         // result never disappears
}
```

2. **`useSatExamController.ts` `acceptPayloadAndRoute`.** Right after the runtime-revision guard, add `if (current && regressesAttemptState(current, payload)) return false;`. Every path goes through this function: poll, state, full bootstrap, and the start-module hint (via `applyEntryAck`). One guard covers them all, and a rejected payload already reports "no change" and stays retryable.
3. **No server change.** The guard test from Step 0 keeps the server invariant from regressing.

**Tests:**
- Table-driven unit tests for `regressesAttemptState`. Cover: same payload, Module 2 row missing, older module revision, final state reverting, break revision regression, result disappearing.
- A permutation test: take snapshots [M1 active] → [M1 locked + M2 created] → [M2 entered] → [M2 locked] and apply every ordering. The final accepted state must always be the last snapshot.
- The two vitest cases from Step 0.
- Playwright: delay the first handoff response so it arrives after the second, and assert the screen never regresses.

## Step 3: last-second answer and route correctness

Verify first, then patch only what a test shows is broken.

**Facts from the code:**
- `SaveResponse` and `finalizeModuleTx` serialize on the same `assessment_module_attempts … FOR UPDATE` row.
- Finalization scores from the rows it reads under that lock and inserts the route decision in the same transaction, with `assertAdaptiveRouteIntegrity` as a fence.
- The 3 s grace is applied in the worker sweep and in the lazy reconcile.
- The non-recovery save path uses in-transaction DB time (`moduleTimingGateTx`). The recovery path uses the API host's pre-transaction wall clock.

**Race tests (real MySQL, many iterations, in `backend/go/integration`):**
1. A save committed before finalization is in the score, and the route equals `chooseAdaptiveRoute` on that score.
2. A save after finalization is rejected, or takes the recovery path.
3. Route consistency: for every finalized base module, recompute the route from the stored answers and compare it with `assessment_route_decisions.selected_route`.
4. A save at deadline + grace + 1 s while the module is still `active` (worker behind). If this is accepted, add a deadline-plus-grace check for the personal gate in `SaveResponse`, using `gated.now`. Today only `timingGateLegacy` calls `ensureSaveModuleAdmitted`.

**Known gap, patch regardless (`service.go`, `ensureTimeoutResponseRecoveryTx`):**
- Recovery rescores a locked module through `repairTimeoutFinalizedModuleTx`, but nothing updates `assessment_route_decisions`.
- The "downstream started" check ignores `not_started` rows. In cohort timing the next module is inserted `not_started`, so recovery stays open after routing.
- **Fix:** if the module is a base module and a row exists in `assessment_route_decisions` with `base_module_attempt_id` equal to this module attempt, return `TIMEOUT_RECOVERY_CLOSED`.
- **Trade-off:** an answer that arrived just in time but lost the lock race is rejected with an explicit error instead of silently making the score and the route disagree. Keep that as the default unless you want the opposite.
- Confirm the client shows an unsaved-answer error for `TIMEOUT_RECOVERY_CLOSED`. I did not check.

**Not changing, but flagging:** the recovery deadline check uses the API host clock against DB-derived deadlines, so host/DB clock skew directly changes what recovery admits. Keep time sync between hosts and the database monitored.

**Also unverified:** `attempts.SaveResponses` in `internal/attempts` is a second, batch save path with its own grace logic. Confirm which endpoints the student client actually calls. Every one of them must enforce the deadline by in-transaction DB time.

## Step 4: synchronized timeout capacity (release gate)

**Current behavior:**
- The personal-timeout sweep runs every 1 s, pages by 250, and handles at most 2,500 candidates per tick (`personalTimeoutSweepLimit`).
- The batch is handed to `reconcileTimeoutCandidateBatch`. I did not read that function, so read it first to confirm whether it is sequential or parallel.
- Students' own polls also close their modules lazily.

**Extend `k6/sat-module-entry-2000.js` (adaptive mode):**
1. Record expiry → branch visible per candidate against `K6_WAVE_AT_MS`. Report p50/p95/p99/max.
2. Add a scenario where each candidate keeps saving answers and polling until zero. Lazy-close and worker contention only appear with concurrent traffic.
3. Per candidate, check that the route equals the score of the saved answers, that no saved answer was lost, and (from Step 1) that no other-branch content appears.
4. Run against staging with real MySQL, at 1× and 2× your largest cohort. Also run once with the worker killed mid-burst and once with two workers, to check idempotency.
5. Collect worker tick duration and backlog (existing `poolstats` and job-duration metrics), lock waits and deadlocks from MySQL, and API error rate.

**Proposed pass bar, to agree with the exam team:** p99 under 10 s, max under 30 s, zero misroutes, zero lost accepted answers, and worker tick duration under its 1 s interval or a backlog that drains within the target.

**If it fails:** the usual fixes are a drain loop until no candidates remain (instead of stopping at 2,500) and concurrent processing with `SELECT … FOR UPDATE SKIP LOCKED`. Choose after reading the batch function.

## Done criteria

Run these, and expect a clean pass before calling the work finished:
- `cd backend/go && go test ./internal/delivery/... ./internal/attempts/... ./cmd/api/...`, plus the integration suite per `backend/go/integration/README.md`
- `bunx vitest run src/features/student-delivery`, `bun run typecheck`, `bun run lint`
- Playwright sat-transition, and the k6 adaptive run meeting the Step 4 bar

Separately, past exams already exposed both branches to every student. Whether that affects item security is a decision for the exam owners, not a code change.