# SAT Student Loading — Execution Graph

> Companion to plans-sat-loading/overall-plan.md. Scheduling + dependency + verification view.
> Status: PLAN COMPLETE — no implementation agents spawned yet. Spawn only after user approval.

## 1. Plan set (all present, all PLAN ONLY)

| File | Lines | Verdict |
|---|---|---|
| overall-plan.md | 139 | root: goal/arch/phases/DAG/waves/DoD |
| phase-01-loading-contract.md | 503 | OK: 10 sections through DoD + 5-point handoff |
| phase-02-bootstrap-waterfall.md | 717 | OK: 12 sections through normative allow-list |
| phase-03-prewarm-gating.md | 277 | OK: 11 sections through DoD |
| phase-04-runner-convergence.md | 718 | OK: 11 sections + line index + divergences appendix |
| phase-05-submitting-verification.md | 449 | OK: sections 0-10, gates G1-G7 + repair routing |

## 2. Waves (dispatch order)

Wave 1: Phase 01 (contract, no deps).
Wave 2: Phase 02 + Phase 03 (parallel, seam-disciplined, see section 4).
Wave 3: Phase 04 (needs 02 bootstrap shape + 03 host scoping).
Wave 4: Phase 05 (needs 01-04; closes R6 + repo-wide proof).

Never parallel: 04 with 02/03 (same controller/route truth); 05 with anything.
Gate between waves: implementation done, tests/typecheck/lint green, phase DoD holds,
Main Agent verifies diff + test output, then unlock next wave. Failure returns to the
owning implementation agent; no premature unlock.

## 3. Ownership (no two agents edit the same lines)

Phase 01 WRITES: feedback/SatStateSurfaces (kind+labels), tools/DesmosCalculator
(silence prop), tools/SatCalculatorPanel (wire silence). SatFloatingTool expected untouched.
Phase 02 WRITES: student/routes/StudentSessionRoute (SAT branch),
student/hooks/useStudentSessionRouteData (additive seed), NEW bootstrap/satBootstrapSeed,
child route props-forward ONLY, controller bootstrap effect ONLY.
Phase 03 WRITES: delivery/routes/SatStudentSessionRoute predicate + wrap/unwrap ONLY.
Panel/Desmos/Floating/Reference read-only.
Phase 04 WRITES: useSatExamController (commit/equality/poll/identity),
satRunnerReducer comment/identity note, route gate 307-319 ONLY,
NEW application/satBootstrapEquality. Timing frozen, selectors read-only.
Phase 05 WRITES: route submitting branch 265-306 copy ONLY, SatControlFeedback overlay
labels ONLY, domain/satCopy submit block (verbatim moves + additive keys).

Seam proofs (each implementation agent pastes these in its report):
- 02: diff-stat contains ONLY its allow-list; withCalculatorHost grep diff vs main EMPTY.
- 03: route diff has NO props/seed/controller changes; reference/backend untouched.
- 04: no timing-math, gateway, persistence, or payload diff; pollEtagRef dead-store documented-not-fixed.
- 05: diff contains ONLY its section-2.1 files; none of the behavior tokens outside tests.

## 4. Seams verified coherent (planner cross-checks, all pass)

S1 contract chain: 01 handoff items 1-5 consumed verbatim by 02 section 2 (5 assumptions),
03 section 2 (A2 silence, panel-internal, no passthrough), 04 Assumes-from-01, 05 A01/A02.
No redefinition anywhere; 02 adapts to 01 path/signature without altering visuals.
S2 host seam: 02 props-only vs 03 wrap-only in the same route file — disjoint line ranges,
explicit grep-diff proofs both sides. 04 gate-only at 307-319 defers to 03 final rule
for the fallback Refreshing wrapper (no assumption baked in).
S3 commit seam: 02 successor-name-tolerant (applyPayload or commitBootstrap); 04 funnels both seed
and gateway paths through one atomic helper, records the real name in its Divergences
appendix; 05 greps the real name. 04-not-done if appendix blank AND symbol missing.
S4 equality/ETag split: 02 owns seed ETag + singleflight + 304-silent; 04 owns poll equality
skip via NEW satBootstrapEquality (timing frozen) + stable snapshotReceivedAt + poll-dep fix;
poll pollEtagRef dead-store documented-not-fixed in 04 (02 must not share poll ref).
S5 submitting boundary: 04 makes arrival atomic, changes no copy; 05 changes copy only, keeps
retryFinalization/singleflight/submissionId semantics frozen with repair routing to 04 on violation.
S6 test-file allocation disjoint: 01 two new files, 02 route+hook+seed+e2e, 03 prewarm matrix,
04 convergence+equality, 05 copy-matrix+live-region. Shared keep-green suites listed read-only
in each phase; no two phases create the same file.

## 5. Known risks (accepted, not blockers)

R-a pre-provider skeleton residual (02 finding): first static window still flashes admin
skeleton (~1 RTT, provider defaults ielts). Guarantee scopes from provider-known-sat.
Consequence: 05 G1 E2E must scope the flicker assertion from provider-known (auth excluded).
R-b commit-helper rename tolerance (04 Step 7 + section 11): 05 greps the Divergences appendix.
R-c fallback-vs-host rule: 04 defers to 03 final rule; if 03 changes its branch table during
implementation, 04 must re-check C2.
R-d silence prop naming: 01 silenceLiveRegions-style vs 03 panel-internal — 03 needs no
passthrough, so any 01 name composes unchanged.

## 6. Coordination (Main Agent per wave)

01 done: verify 5-point handoff, unlock 02 + 03.
02 + 03 done: verify both seam proofs, unlock 04.
04 done: verify seam symbols + scope commands green, unlock 05.
05 done: full command list + no-regression spot-checks + sign-off, close program.
Track live as: 01 pending/active/done, 02 pending/active/done, and so on.
After each phase: verify diff, update repo state, dispatch newly-ready phases,
keep conflicting agents off the same files per section 3.

## 7. Implementation-agent dispatch kit (copy per spawn)

Give each implementation agent: overall-plan.md + its ONE phase file + current repo state.
Rules: implement ONLY your phase. Respect ownership and seam proofs. Inspect the real
codebase, follow conventions, land phase tests green, run phase verification commands,
fix failures from your work, report diff-stat + test output + seam proof.
Do NOT implement future phases. Record renames in Divergences notes.
Verification pointers live in each phase file: tsc, scoped eslint, scoped vitest,
full student-delivery scope, then (05 only) full repo + Playwright sat-a11y +
prod-smoke SAT slice + zero-tolerance greps. Each phase runs its own scope;
Wave 4 runs the full matrix once.
