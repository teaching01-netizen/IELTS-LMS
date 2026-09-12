# Phase 04 — L4 Re-run + Final Gate + Goal Completion (verify-only, NO code edits)

> Lane: student-answer durability close-out · Stage: PLAN ONLY (no implementation)
> Overall plan: `plans-durability/overall-plan.md` (goal, blockers B1/B2/B3, phases, ownership, standing rules) — READ FIRST.
> Phase position: Wave 2 — runs AFTER Phase 01 green + Phase 02 green-or-waived + Phase 03 green-or-waived. Gates Phase 05 (rollout).
> Ownership: no code edits by anyone in this phase (verify-only). Re-dispatched L4 reviewers are read-only.
> Output of this phase: L4-A + L4-B 0 BLOCKING on the final tree + final-gate evidence bundle + goal completion recorded.

## 1. Objective

Re-run independent review gates L4-A (general durability) + L4-B (security) as fresh-eyes, read-only audits on the FINAL tree (post-Phase-01/02/03), require 0 BLOCKING on both, assemble the final-gate evidence bundle (vitest + go uncached + diff-check + eslint + Playwright + tsc + k6, each with pasted command + output + owner + date), then — only after the user resumes paused goal `goal-0f4ac4a3` (rev 4, model cannot resume) — mark the goal complete with limitations disclosed.

Non-objectives (explicit):
- No `src/`, `backend/` (except read), `e2e/`, `docs/`, `k6/` modifications in this phase. Any repair exits this phase back to the owning lane.
- No new deps, schema migrations, prod k6 runs, SAT staff UI work (`plans/` lane), or unrelated token/session prod diffs.
- No claiming green without pasted output (standing rule from overall plan).

## 2. Entry criteria (dependencies — ALL must hold before dispatching L4)

| # | Criterion | Owner | Evidence required |
|---|---|---|---|
| E1 | Phase 01 landed: `backend/go/cmd/e2e_seed/main.go` FK fix only, fresh `e2e_seed` run done, `e2e/student-durability.spec.ts` 5/5 green on chromium + `e2e/smoke.spec.ts` control green | Phase 01 owner | Playwright reporter output pasted (5 passed + smoke passed), manifest date |
| E2 | Phase 02 resolved: tsc full green-with-evidence OR toolchain-issue waiver signed (owner + date + scoped-clean evidence `tsc --noEmit --skipLibCheck e2e/student-durability.spec.ts` exit 0) | Toolchain owner | `tsc --noEmit` output OR waiver doc reference |
| E3 | Phase 03 resolved: k6 storm against staging green OR explicit waiver signed (owner + date + staging plan; never prod) | Load owner | k6 summary output OR waiver doc reference |
| E4 | Final tree frozen + identified: `git rev-parse HEAD` + `git status --porcelain` clean (or drift list recorded), freeze hash written to bundle header | Phase 04 runner | Paste of both commands |
| E5 | Vitest 62/62 + go uncached still green on the final tree at gate time (tree-drift guard, see §8) | Phase 04 runner | Pasted outputs (commands in §6) |

If any E1–E3 is missing, DO NOT dispatch L4. Record which entry criterion blocks and return to the owning phase.

## 3. Starting state carried forward (deltas the L4 re-dispatch MUST name)

Prior verdicts (falsification baselines — L4 must attempt to overturn, not rubber-stamp):
- **L4-A CONDITIONAL PASS, 0 BLOCKING, 1 IMPORTANT**: co-located token/session prod diffs in `service/submit/types.go` — freeze scoped to `durability_contract_test.go`. L4-A reviewers must re-check: (a) whether those diffs grew/shrank since the last run, (b) whether any durability-relevant semantic leaked through them, (c) that the freeze scope statement is still accurate.
- **L4-B 0 BLOCKING, 3 non-blocking hardening notes** (carried forward as checklist items — confirm each is still non-blocking or disposition if worsened).
- **Frozen set (V1 L4-prep, re-verify byte-identity or record drift)**:
  - `src/shared/durability/DurableResponseEngine.ts` (~2298 lines at plan time; overall plan cites engine ~2270 lines — runner records actual `wc -l` at gate time)
  - `src/shared/durability/types.ts` (132 lines), `src/shared/durability/useResponseDurabilityStatus.ts` (177 lines)
  - Mapper: `useResponseDurabilityStatus.ts` (single-owner contract — `mapEngineStatus`, `blockedSubmitGateMessage`, `ReconcileBlockedResult` union)
  - Providers: `src/components/student/providers/StudentAttemptProvider.tsx`, `src/features/student-delivery/hooks/useSatResponsePersistence.ts` (blocked-surface: `blockedQuestionIds`/`blockedDrafts`, `quarantinedCount`, `reconcileBlockedResponse`), plus `StudentRuntimeProvider.tsx` / `StudentUIProvider.tsx` read-only
  - Transport: `src/components/student/answerMutationDebug.ts` (default-deny + allowlist sanitizer, `student.answerMutationDebug` storage flag) + outbox/ledger paths (`src/features/student-delivery/infrastructure/satResponseOutboxStore.ts`)
  - `src/utils/durableDraftStore.ts` (237 lines; IndexedDB `warwick_durable_drafts_v1` + `localStorage` fallback prefix `warwick_durable_draft_v1:`)
  - Backend fence: `backend/go/internal/attempts/service.go` (697), `submit.go` (414), `types.go` (139), `validate.go`, `materialize.go`, `canonicaljson.go` + contract pins `durability_contract_test.go` (843), `envelope_vocab_test.go`, `fencing_order_test.go`, `outcome_wire_test.go`, `outcome_vocab_test.go`, `outcome_retry_test.go`, `submit_envelope_test.go`, `submit_receipt_compat_test.go`, `submit_replay_emit_test.go`, `writability_test.go`, `revocation_test.go`, `rowfirst_test.go`, `sat_annotations_test.go`, `contention_test.go`, `retry_test.go` + `backend/go/internal/runtime/fence_test.go`, `service.go`, `snapshot*.go`, `poll.go`
  - Tests: 54 vitest durability pins + 8 redaction (total gate claim 62/62 — see §6 G1 for exact selector); new e2e spec `e2e/student-durability.spec.ts` (672 lines, 5 scenarios a–e, real backend bumps, fail-loud probes)
- **Gate table states at plan time**: vitest 62/62, go uncached ok (`internal/attempts` + `internal/runtime`), lane diff-check clean, eslint 0 errors on engine/mapper/spec, Playwright per Phase 01 (0/5 harness-blocked → must be 5/5 before this phase), tsc per Phase 02 (full OOM → green-or-waiver), k6 per Phase 03 (never run → staging-green-or-waiver).
- **Deltas since last L4 run that the re-dispatch prompt MUST list explicitly** (runner fills in at dispatch time; placeholders rejected):
  1. Seed fix diff: `git diff <old-freeze>..HEAD -- backend/go/cmd/e2e_seed/main.go` (expected: `cleanup()` handles `exam_versions` self-FK `parent_version_id` NO ACTION from `backend/go/migrations/0003_exam_core.sql:62-73`, order: terminalizations → exam_versions leaf-first → schedules → events → entities → users).
  2. Any tsc outcome (full green output OR waiver + scoped-clean evidence).
  3. Any k6 outcome (staging summary OR waiver; confirm prod target never hit, `K6_CONFIRM_PROD` never set against prod).
  4. Any other tree drift between Phase 01 landing and L4 start (`git log --oneline <l4-last-tree>..HEAD` + diff stat) — L4 scope is the FINAL tree, not the remembered tree.

## 4. Contracts / interfaces (read-only reference — L4 verifies, never edits)

1. **Backend contract (unchanged)**: `backend/go/internal/attempts/service.go` fencing, version uniqueness, writeId idempotency, monotonic projection, superseded acks — pinned by `durability_contract_test.go`, NOT changed. Rollback = client-bundle redeploy; no migration to reverse (runbook §1–§2).
2. **Engine contract** (`e2e/student-durability.spec.ts:12-26` header): answers/flags survive recovery + control-only epoch bumps (blocked → `reconcileBlocked` with NEW writeId/version/epoch); lease bump quarantines (strict fence, NO auto-resend); blocked submit throws provider gate error (shared gate copy), never silent exclusion; tombstones same-key; `quarantine_pruned` on ack-supersede/discard only.
3. **Status vocabulary** (runbook §5; both providers via shared mapper): `saving` | `saved_locally` (never display as "saved") | `blocked_attention` | `conflict` | `saved` (server-ack ONLY, I4) | `error`. Any "saved"-for-unacked copy = must-fix defect.
4. **Telemetry privacy** (runbook §3): reason-coded counters only, never answer text/PII; `emitAnswerMutationDebugLog` redacts default-deny + allowlist; debug flag `student.answerMutationDebug` is settable in prod so safety rests on the sanitizer. Backend outcome vocabulary: `accepted`, `exact_replay`, `retried_accepted`, `lease_fenced`, `control_epoch_stale`, `version_collision`, `write_id_conflict`, `not_writable`, `rejected`.
5. **Recovery-panel scope**: providers expose `blockedQuestionIds` / `quarantinedCount` / `reconcileBlockedResponse` + submit gate; panel UI is follow-up, out of scope.

## 5. Step-by-step implementation (verify-only — numbered, no redesign latitude)

> Runner = Phase 04 implementer (human or implementation agent). L4-A / L4-B = freshly dispatched independent reviewers (fresh-eyes: not the Phase 01–03 implementers where possible).

- **Step 0 — Confirm entry criteria E1–E5 (§2).** If any fails, stop: record the blocking criterion, notify the owning phase, do not dispatch L4. Paste `git rev-parse HEAD` + `git status --porcelain` into the bundle header.
- **Step 1 — Tree-drift guard (re-run at gate time even if Phase 01 just landed).** Run G1 (vitest 62) + G2 (go uncached) exactly per §6 BEFORE dispatching L4. If either regresses vs Phase 01 landing, stop and route to owning lane (§8 edge E-DRIFT). Record wall time + exit codes.
- **Step 2 — Assemble delta packet for L4.** Produce: (a) freeze hash + `git log --oneline` since last L4 tree, (b) seed-fix diff (§3 delta 1), (c) tsc outcome (§3 delta 2), (d) k6 outcome (§3 delta 3), (e) full drift stat (§3 delta 4), (f) Phase 01 Playwright outputs. L4 prompts MUST embed this packet — reviewers audit the final tree WITH deltas, not from memory.
- **Step 3 — Dispatch L4-A (general durability) with prompt P-A (§7).** Read-only, fresh-eyes, falsification checklist + delta packet + IMPORTANT triage rule (§7 rule I). Reviewer returns verdict: PASS / CONDITIONAL PASS / FAIL with BLOCKING/IMPORTANT lists + file:line evidence for every claim.
- **Step 4 — Dispatch L4-B (security) with prompt P-B (§7).** Same mechanics, security lens (sanitizer default-deny+allowlist, storage-flag prod-settability, quarantine/archive-before-delete, PII in logs/artifacts, creds handling in `e2e/prod-data/prod-creds.json` untracked vs `prod-creds.example.json`). Returns verdict in same format.
- **Step 5 — Triage L4 findings per §7 rule T.** 0 BLOCKING on BOTH = proceed to Step 6. Any BLOCKING = repair loop (§8 edge E-BLOCK): exit Phase 04 immediately, file the finding with the owning lane (engine/backend-transport/e2e/toolchain/load owner per overall-plan ownership), re-freeze, re-verify owning gates, then RESTART Phase 04 at Step 0 (new freeze hash). IMPORTANT items: repair if cheap and in-owning-lane, else disposition explicitly with evidence (§7 rule I) — never silently drop.
- **Step 6 — Assemble final-gate evidence bundle (§6).** One markdown file (suggested `plans-durability/phase-04-evidence-bundle.md`, created by the runner at execution time — NOT part of this plan file): per-check command + FULL pasted output (or tail + spill path for long outputs) + owner + date + exit code. Required rows: G1 vitest, G2 go uncached, G3 diff-check, G4 eslint, G5 Playwright (Phase 01 outputs, re-confirmed at gate time if drift), G6 tsc (green OR waiver), G7 k6 (staging green OR waiver), L4-A verdict, L4-B verdict, freeze hash. Checklist in §6; every box must be ticked or the gate is not met.
- **Step 7 — Goal mechanics (§9).** Runner verifies bundle complete + both L4 0 BLOCKING, then STOPS and asks the USER to resume goal `goal-0f4ac4a3` (paused rev 4 — ONLY the user resumes; the model cannot call resume). After the user confirms resume, runner marks the goal complete with limitations disclosed (template in §9: tsc/waiver state, k6/waiver state, L4-A IMPORTANT disposition, L4-B notes, rollout not yet run — Phase 05 pending).
- **Step 8 — Handoff to Phase 05.** Record bundle path + freeze hash + goal completion reference in the handoff line; rollout stays runbook-driven (dogfood → pilot → full, rollback bundle staged).

## 6. Final-gate evidence bundle checklist (per-check command + expected output + owner + date)

> Runner pastes FULL output per row (long outputs: tail + spill-file path). "Green" without pasted output = not green (standing rule). Expected outputs below are the PASS shapes; any deviation = fail, route per §8.

| ID | Check | Exact command (run from repo root unless noted) | Expected output (PASS shape) | Owner | Date |
|---|---|---|---|---|---|
| G0 | Freeze identity | `git rev-parse HEAD && git status --porcelain` | 40-char SHA + empty porcelain (or listed drift files carried as §3 delta 4) | Phase 04 runner | _fill_ |
| G1 | Vitest durability 62/62 | `npx vitest run src/shared/durability src/components/student/__tests__/answerMutationDebug.redaction.test.ts src/components/student/providers/__tests__/StudentAttemptProvider.preservation.test.tsx src/features/student-delivery/application/__tests__/useSatResponsePersistence.v2.test.tsx` (scope = 54 durability + 8 redaction pins; if the selector drifts, record the exact selector used + `Test Files` / `Tests` counts) | `Test Files  <n> passed` + `Tests  62 passed` (0 failed). Note: `vitest.config.ts` excludes `e2e/**`; do NOT use bare `npx vitest run` as gate evidence (runs whole suite). | Phase 04 runner | _fill_ |
| G2 | Go uncached | `cd backend/go && go test -count=1 ./internal/attempts ./internal/runtime` | `ok  <pkg>  (cached explicitly disabled by -count=1)` for BOTH packages, 0 FAIL | Phase 04 runner | _fill_ |
| G3 | Lane diff-check | `git status --porcelain -- src/shared/durability backend/go/internal/attempts backend/go/internal/runtime src/utils/durableDraftStore.ts src/components/student/answerMutationDebug.ts e2e/student-durability.spec.ts` + `git diff --stat HEAD -- <same paths>` | Empty status on frozen set except the recorded Phase 01 seed fix + Phase 02/03 scoped files; any other diff = drift, explain in §3 delta 4 | Phase 04 runner | _fill_ |
| G4 | ESLint | `npx eslint src/shared/durability/DurableResponseEngine.ts src/shared/durability/types.ts src/shared/durability/useResponseDurabilityStatus.ts src/utils/durableDraftStore.ts src/components/student/answerMutationDebug.ts e2e/student-durability.spec.ts` | 0 errors (warnings allowed only if listed; `eslint.config.js` keeps jsx-a11y as warn, react-hooks exhaustive-deps warn) | Phase 04 runner | _fill_ |
| G5 | Playwright (per Phase 01) | `npx playwright test e2e/student-durability.spec.ts --project=chromium` + `npx playwright test e2e/smoke.spec.ts --project=chromium` (default `playwright.config.ts`: testDir `./e2e`, globalSetup `./e2e/global-setup.ts` runs `cmd/migrate` + `cmd/e2e_seed`, webServers boot Go API :4000 + worker + `npm run dev` :3000; needs backend `DATABASE_URL` (+ DIRECT/MIGRATOR/WORKER variants) prefixed — root `.env` shadows it, see overall-plan B1) | `5 passed` (durability a–e) + smoke control passed; 0 flaky-retried-hidden (report retries). If webServers already running, `reuseExistingServer: !CI` applies — record which path was taken. | Phase 01 owner (re-confirmed by Phase 04 runner if drift) | _fill_ |
| G6 | tsc (per Phase 02) | Full: `NODE_OPTIONS=--max-old-space-size=4096 npx tsc --noEmit` (known OOM shape: V8 OOM ~4GB ~470s wall, or larger-heap `flags` crash — either = toolchain, not prod code); Scoped evidence always: `npx tsc --noEmit --skipLibCheck e2e/student-durability.spec.ts` | Full exit 0 (green) OR waiver: owner + date + scoped exit 0 pasted + OOM log tail. Scoped exit 0 alone is NOT full-green — label it correctly. | Toolchain owner | _fill_ |
| G7 | k6 (per Phase 03) | Staging only, e.g. `K6_CONFIRM_PROD=true K6_STUDENTS=200 K6_CHECKED_IN_THRESHOLD=200 k6 run k6/prod-submit-storm-200.js` with `K6_TARGET_PATH`/`K6_CREDS_PATH` pointed at STAGING (never `e2e/prod-data/prod-target.json` as committed — placeholder prod target). Thresholds: `submit_request_ms p(95) < 2000`, `max < 10000` (+ scenario thresholds in `k6/README.md`). | Staging summary `checks passed` + thresholds green, OR waiver: owner + date + staging plan. `K6_CONFIRM_PROD=true` against prod = forbidden, gate fails automatically. | Load owner | _fill_ |
| L4A | L4-A verdict | Prompt P-A (§7) on final tree + delta packet | 0 BLOCKING (PASS or CONDITIONAL PASS with only dispositioned IMPORTANTs) | L4-A reviewer (fresh-eyes) | _fill_ |
| L4B | L4-B verdict | Prompt P-B (§7) on final tree + delta packet | 0 BLOCKING (hardening notes dispositioned) | L4-B reviewer (fresh-eyes) | _fill_ |

Bundle file: `plans-durability/phase-04-evidence-bundle.md` (runner-created at execution time) with header (freeze SHA, date, runner) + one section per row above + L4 verdicts pasted verbatim + goal completion reference (§9).

## 7. L4 re-dispatch prompts (copy-paste skeletons — runner fills [BRACKETED] slots, no other edits)

### Common standing orders (prepend to BOTH prompts)

```text
You are an INDEPENDENT read-only reviewer. Stage: VERIFY ONLY — do NOT modify
src/, backend/ (except read), e2e/, docs/, k6/. Do not propose redesigns; judge
the tree as built. Ground EVERY claim in the real tree: cite file:line for each
finding, read the files you cite, never invent APIs. Attempt FALSIFICATION:
your job is to overturn the prior verdicts below, not to confirm them. Severity:
BLOCKING (must-fix before DONE — loss, fence bypass, false-saved, privacy leak,
silent draft exclusion) vs IMPORTANT (repair or explicitly disposition with
evidence) vs note (non-blocking observation). Output format: verdict line
(PASS / CONDITIONAL PASS / FAIL) + numbered findings each labeled
[BLOCKING]/[IMPORTANT]/[note] with file:line evidence + a final gate-table
restatement (which gates you re-checked, which you took on record).
Final tree freeze: [SHA]. Delta packet since your last run: [PASTE §3 DELTAS
1–4 + Phase 01 Playwright outputs]. Prior verdicts you must try to overturn:
L4-A CONDITIONAL PASS 0 BLOCKING (1 IMPORTANT: co-located token/session prod
diffs in service/submit/types.go, freeze scoped to durability_contract_test.go)
+ L4-B 0 BLOCKING (3 non-blocking hardening notes, pasted below for L4-B).
```

### P-A — L4-A general durability (falsification checklist)

```text
[COMMON STANDING ORDERS above, with freeze + delta packet filled.]

Scope (read-only): src/shared/durability/DurableResponseEngine.ts,
src/shared/durability/types.ts, src/shared/durability/useResponseDurabilityStatus.ts
(mapEngineStatus single path, blockedSubmitGateMessage copy, ReconcileBlockedResult
union), providers StudentAttemptProvider.tsx + useSatResponsePersistence.ts
(blockedQuestionIds/blockedDrafts, quarantinedCount, reconcileBlockedResponse,
submit gate), transport src/components/student/answerMutationDebug.ts +
satResponseOutboxStore.ts + src/utils/durableDraftStore.ts (IndexedDB +
localStorage fallback), backend fence backend/go/internal/attempts/{service,
submit, types, validate, materialize, canonicaljson}.go + durability_contract_test.go
and its sibling contract tests + backend/go/internal/runtime/{service,snapshot,poll}.go,
e2e/student-durability.spec.ts (5 scenarios a–e, probe-fails-loud honesty notes).

Falsification checklist (try to BREAK each claim; cite file:line):
 F1. Engine ~2270-line freeze still holds: no durability-semantic change outside
     the recorded seed-fix diff; version/lease/control-epoch fencing order intact.
 F2. Control-only bump → blocked + reconcile-via-NEW-writeId/version/epoch; lease
     bump → quarantine with NO auto-resend (grep for resend-after-fence paths).
 F3. Submit gate never silently excludes blocked/quarantined drafts (gate throws
     shared copy; spec scenario (d) clicks the real Finish/Review&Submit surface).
 F4. Tombstones same-key; quarantine_pruned fires on ack-supersede/discard only.
 F5. Status vocabulary: nothing renders "saved" for unacked work (I4); saved_locally
     never displayed as saved (runbook §5).
 F6. Recovery seeding: reload-during-recovery preserves answer+flag (spec (a));
     intent_queued_during_recovery semantics sane.
 F7. IMPORTANT carried forward: co-located token/session prod diffs in
     service/submit/types.go — did they grow/shrink? Any durability-relevant
     semantic leak? Is the durability_contract_test.go freeze scope still accurate?
     Rule I: 0-BLOCKING required; IMPORTANT must be REPAIRED (route to owning lane
     per §8) or EXPLICITLY DISPOSITIONED with evidence (diff range + why
     durability-irrelevant + reviewer sign-off). Silence = FAIL.
 F8. Deltas since last run (seed fix, tsc/k6 outcomes in packet): does any delta
     invalidate a prior L4-A conclusion? Say so explicitly per delta.
Return: verdict + findings + gate-table restatement.
```

### P-B — L4-B security (falsification checklist + 3 hardening notes)

```text
[COMMON STANDING ORDERS above, with freeze + delta packet filled.]

Scope (read-only): same tree as L4-A, security lens: answerMutationDebug.ts
sanitizer (default-deny + allowlist, IDs-only contract), storage flag
student.answerMutationDebug settable in prod (safety rests on sanitizer, not
build gate), quarantine/archive-before-delete paths, durability_fault status vs
quarantine_failed/checkpoint_sync_failed counters (runbook §3 alerting note),
PII/answer-text in telemetry/logs/artifacts (e2e/.generated/*, k6 logs),
creds handling (e2e/prod-data/prod-creds.json untracked vs .example.json),
k6/prod-* K6_CONFIRM_PROD gate (never prod), CSRF/session cookie handling in
playwright.config.ts + e2e/global-setup.ts env chain.

Falsification checklist:
 S1. Exfiltrate answer text or student PII through any telemetry/debug/counter/
     log/artifact path (reason-coded counters only — prove or break).
 S2. Bypass the sanitizer via a non-allowlisted field name or the prod-settable
     storage flag (read answerMutationDebug.ts + redaction test, attack it).
 S3. Lose or mislabel a quarantined draft (silent exclusion, wrong status copy,
     archive-failure swallowed instead of durability_fault + counter).
 S4. Revisit the 3 prior non-blocking hardening notes [PASTE THEM VERBATIM]:
     each is still non-blocking, worsened (→ escalate to IMPORTANT/BLOCKING with
     evidence), or fixed (cite the diff). None may be silently dropped.
 S5. Deltas since last run: does the seed fix, tsc/k6 outcome, or any drift widen
     any attack or privacy surface? Explicit per-delta answer.
Rule I (same as L4-A): 0-BLOCKING required; IMPORTANT = repair or explicitly
disposition with evidence + sign-off. Return: verdict + findings + gate-table
restatement.
```

### Triage rules (binding on the runner)

- **Rule 0 (0-BLOCKING)**: DONE requires BOTH L4-A and L4-B at 0 BLOCKING on the FINAL tree. One BLOCKING anywhere = gate fails.
- **Rule I (IMPORTANT triage)**: every IMPORTANT must be either (a) REPAIRED via the owning lane (exit Phase 04 → repair → re-freeze → re-verify → restart Phase 04 at Step 0), or (b) EXPLICITLY DISPOSITIONED in the bundle: quote the finding, state accept/defer with reason, cite evidence (diff range / test output / reviewer sign-off + date). A finding that is neither repaired nor dispositioned blocks the gate.
- **Rule R (repair-locally)**: same failure twice → root-cause escalation, never blind re-patch (overall-plan standing rule). Second occurrence of the same BLOCKING after a repair attempt escalates to root-cause analysis owned by the relevant file owner before any further patch.

## 8. Edge cases

| ID | Case | Handling |
|---|---|---|
| E-BLOCK | L4 finds new BLOCKING | Exit Phase 04 immediately. File finding (verdict quote + file:line) with owning lane: engine `src/shared/durability/` owner / mapper+provider owner / transport+store owner / backend fence `internal/attempts`+`internal/runtime` owner / e2e spec owner / toolchain (tsc) / load (k6). Repair → re-freeze (new SHA) → re-verify owning gates → restart Phase 04 at Step 0 with a fresh delta packet. Same-failure-twice → Rule R escalation. |
| E-DRIFT | Tree drift between Phase 01 landing and L4 start (or between L4 dispatch and verdict) | G1+G2 re-run at gate time is MANDATORY (Step 1), not optional. Record `git log --oneline` + diff stat as §3 delta 4. If drift touches the frozen set beyond the recorded seed fix, L4 scope note must acknowledge it; if drift is large (reviewer's judgment, e.g. engine/fence semantics touched), re-freeze and re-dispatch L4 on the new tree. |
| E-COND | L4 returns CONDITIONAL PASS with only IMPORTANTs | Allowed IFF every IMPORTANT is dispositioned per Rule I (repaired or explicitly dispositioned with evidence + sign-off). CONDITIONAL PASS with an undispositioned IMPORTANT = gate fails. |
| E-WAIVER | Phase 02/03 arrived as waivers, L4 questions the waiver | L4 may flag a waiver as insufficient (→ IMPORTANT or BLOCKING with evidence). Runner routes back to Phase 02/03 owners; Phase 04 does not rewrite waivers itself. |
| E-FLAKY | Playwright or vitest flake at gate time | No silent retry-to-green. Record retry count, report both runs, investigate (harness env? seed state? DATABASE_URL shadowing per B1?). Same flake twice → Rule R escalation. |
| E-GOAL | User does not resume the goal / resumes then pauses again | Phase 04 work product (bundle + verdicts) stands as-is. Runner does NOT mark complete, does NOT call resume (model cannot). Record "awaiting user resume" with date; Phase 05 stays gated. |
| E-ROLLBACK-EVIDENCE | Post-gate incident before rollout | Preserve browser storage keys `response-checkpoint:v2:*`, `v2_attempt_*`, `v2_quarantine:*` + ledger/outbox BEFORE clearing (runbook §4), then triage; rollback trigger = previous client bundle redeploy, re-enter at stage 1. |

## 9. Goal mechanics (goal-0f4ac4a3, paused rev 4)

1. The roadmap goal `goal-0f4ac4a3` is PAUSED at revision 4. ONLY the user can resume it — the model MUST NOT attempt `resume` (rejected: non-human authority). Any plan step phrased as "model resumes the goal" is wrong; the runner's job is to ASK.
2. Runner posts the resume request to the user ONLY after bundle complete (all §6 rows ticked) + both L4 0 BLOCKING verified. Request text: "Phase 04 gate is met (bundle [path], freeze [SHA], L4-A [verdict] + L4-B [verdict], 0 BLOCKING). Please resume goal-0f4ac4a3 so I can mark it complete."
3. After the user confirms resume (goal active again), runner marks COMPLETE with limitations disclosed. Suggested completion note (fill brackets, keep all limitation lines — do not delete an unfavorable one):
```text
Durability close-out DONE per plans-durability/overall-plan.md final gate:
vitest 62/62 [date], go -count=1 attempts+runtime ok [date], diff-check [state],
eslint 0 errors [date], Playwright student-durability 5/5 + smoke [date, Phase 01],
tsc [full-green date | waiver owner+date + scoped-clean date],
k6 [staging-green date | waiver owner+date], L4-A [verdict+date] + L4-B
[verdict+date] 0 BLOCKING on freeze [SHA]. IMPORTANT dispositions: [list or
"none outstanding"]. Limitations: [tsc-full state] / [k6-staging vs prod — never
run against prod] / [L4-A IMPORTANT disposition] / [rollout Phase 05 not yet run].
Evidence: plans-durability/phase-04-evidence-bundle.md.
```
4. If the goal was resumed but new BLOCKING arrived before completion, do NOT mark complete — return to §8 E-BLOCK loop first.

## 10. Definition of Done (ALL must hold — no partial DONE)

- [ ] Entry criteria E1–E5 (§2) met and recorded (Phase 01 green + 02/03 green-or-waived on record).
- [ ] G1 vitest 62/62 + G2 go uncached green ON THE FINAL TREE at gate time (Step 1 re-run pasted).
- [ ] L4-A + L4-B re-run ON THE FINAL TREE with delta packet: BOTH 0 BLOCKING (PASS or CONDITIONAL PASS with all IMPORTANTs dispositioned per Rule I).
- [ ] Evidence bundle complete: all §6 rows (G0–G7, L4A, L4B) with command + pasted output + owner + date; freeze SHA recorded.
- [ ] Same-failure-twice escalation rule honored (no blind re-patch occurred without root-cause escalation).
- [ ] Goal resumed BY THE USER, then marked complete with limitations disclosed (§9 note preserved).
- [ ] Handoff line to Phase 05 recorded (bundle path + freeze SHA + goal completion reference). No code edits occurred in this phase (verify-only honored; any repair went through the owning lane + re-freeze).

## 11. Key files reference (read-only in this phase — do NOT edit)

- Overall plan: `plans-durability/overall-plan.md`
- This plan (ONLY output of the phase-planning task): `plans-durability/phase-04-l4-gate.md`
- Runner-created at execution time (NOT now): `plans-durability/phase-04-evidence-bundle.md`
- Engine + mapper: `src/shared/durability/DurableResponseEngine.ts`, `src/shared/durability/types.ts`, `src/shared/durability/useResponseDurabilityStatus.ts`
- Providers (read): `src/components/student/providers/StudentAttemptProvider.tsx`, `src/features/student-delivery/hooks/useSatResponsePersistence.ts`
- Transport + store (read): `src/components/student/answerMutationDebug.ts`, `src/features/student-delivery/infrastructure/satResponseOutboxStore.ts`, `src/utils/durableDraftStore.ts`
- Backend fence (read): `backend/go/internal/attempts/service.go`, `submit.go`, `types.go`, `validate.go`, `materialize.go`, `canonicaljson.go`, `durability_contract_test.go` (+ sibling contract tests), `backend/go/internal/runtime/`
- E2E (read/run, not edit): `e2e/student-durability.spec.ts`, `e2e/smoke.spec.ts`, `e2e/global-setup.ts`, `playwright.config.ts`
- Seed fix context (read): `backend/go/cmd/e2e_seed/main.go` `cleanup()`, `backend/go/migrations/0003_exam_core.sql:62-73`
- Runbook: `docs/runbooks/student-answer-durability.md` (§1 rollout, §2 rollback, §3 monitoring, §4 triage, §5 vocabulary)
- Load: `k6/prod-submit-storm-200.js`, `k6/README.md`, `k6/prod-load-helpers.js` (staging only; never prod)
- Configs: `package.json` (scripts), `vitest.config.ts`, `eslint.config.js`, `tsconfig.json`
