# Durability Close-Out — Next-Step Overall Plan (Wave 3 remainder + rollout)

> Workflow: ai-planning-workflow · Stage: PLAN ONLY (no implementation yet)
> Lane: student-answer durability repair, frozen V2 candidate (E1+E2+C1+P1+S1+T1 complete, L4-A + L4-B 0 BLOCKING).
> Out of scope: SAT staff UI (`plans/`), unrelated token/session prod diffs, any new deps / schema migration.
> Plans dir note: `plans/` belongs to SAT-UI work — this lane uses `plans-durability/` to avoid collision.

## 1. Goal

Promote the frozen V2 durability candidate to production-grade DONE: turn the three
recorded non-green gates (Playwright harness-blocked, tsc-full OOM, k6 waived) into
either green-with-evidence or owner-signed waivers, re-run L4 on the final tree,
run the staged rollout per runbook, then complete the roadmap goal.

## 2. Starting state (evidence, not assumptions)

- Durability suites 62/62 green (54 durability + 8 redaction, re-run by L0 2026-09-11).
- Go uncached `internal/attempts` + `internal/runtime` ok.
- Lane diff-check clean; eslint 0 errors on engine/mapper/spec.
- `e2e/student-durability.spec.ts` exists (672 lines, 5 scenarios, real backend bumps,
  probes fail loud) but 0/5 green — harness-blocked.
- L4-A general CONDITIONAL PASS 0 BLOCKING; L4-B security 0 BLOCKING.
- Roadmap goal `goal-0f4ac4a3` paused rev 4 — only the user can resume it.

## 3. Known blockers (grounded in tree)

### B1 — e2e_seed cleanup FK 1451 (blocks ALL backend-backed specs)
- `backend/go/cmd/e2e_seed/main.go` `cleanup()` (:297-334) deletes
  terminalizations → schedules → events → entities → users, but never handles
  `exam_versions` rows.
- `exam_versions.parent_version_id` self-FK (`backend/go/migrations/0003_exam_core.sql:62-73`,
  no ON DELETE clause → NO ACTION) raises Error 1451 on cleanup.
- Seed tool only (`cmd/e2e_seed`), NOT prod logic — fixable inside this lane.
- Second layer: 2026-09-09 manifest schedule row absent from `ielts_go_fresh`
  → fresh `e2e_seed` run required after the fix.
- Third layer: root `.env` `DATABASE_URL` shadows `backend/.env`; local runs must
  prefix `DATABASE_URL` (+ DIRECT/MIGRATOR/WORKER variants) with the backend value
  (V1 run 2 proved API boots with correct env).
- Control proof: `e2e/smoke.spec.ts` fails identically at the same global-setup line.

### B2 — tsc full OOM (toolchain, pre-existing scale issue)
- `NODE_OPTIONS=--max-old-space-size=4096 npx tsc --noEmit` → V8 OOM at ~4GB, ~470s wall.
- History also records a larger-heap internal crash (`flags` of undefined).
- Scoped `tsc --noEmit --skipLibCheck e2e/student-durability.spec.ts` exits 0.

### B3 — k6 never run (no staging target)
- Binary present; `k6/prod-submit-storm-200.js` requires `K6_CONFIRM_PROD=true` +
  target/creds paths; checked-in prod target is a placeholder. Never hit prod.

## 4. Phases

```text
Phase 01 — Harness unblock (seed FK + fresh seed + Playwright green)
   ↓ (unlocks L4 re-run + rollout confidence)
Phase 04 — L4 re-run + final gate + goal completion  ← ALSO needs 02/03-or-waiver

Parallelizable at any time (no dependency on 01):
Phase 02 — tsc OOM investigation (toolchain owner)
Phase 03 — staging provision + k6 run (load owner)

After 04:
Phase 05 — staged rollout dogfood → pilot → full (runbook-driven)
```

| Phase | Objective | Depends on | File ownership (single owner) |
|---|---|---|---|
| 01 | Seed FK fix, fresh seed, `student-durability` + `smoke` green on chromium | none | `backend/go/cmd/e2e_seed/main.go` only |
| 02 | tsc green-with-evidence OR toolchain-issue with owner+date waiver | none | repo/tsconfig scope only; no prod edits to fix the tool |
| 03 | k6 storm against staging green OR explicit waiver | none | `k6/` + staging creds (new files, never prod target) |
| 04 | L4-A + L4-B re-run 0 BLOCKING, final gate, resume + complete goal | 01, 02-or-waiver, 03-or-waiver | no code edits (verify-only) |
| 05 | Staged rollout + observability watch + rollback readiness | 04 | runbook + rollout config only |

Execution waves (implementation, after plan approval):
Wave 1: Phase 01 + Phase 02 + Phase 03 (disjoint ownership, parallel).
Wave 2: Phase 04 (verify-only, after 01 green + 02/03 green-or-waived).
Wave 3: Phase 05 (rollout, after 04).

## 5. Completion criteria (final gate)

- [ ] Playwright `e2e/student-durability.spec.ts` green on chromium (5/5) + `smoke` control green, outputs recorded.
- [ ] tsc full green-with-evidence OR toolchain waiver (owner + date + scoped-clean evidence).
- [ ] k6 staging run green OR explicit waiver (owner + date + staging plan).
- [ ] L4-A + L4-B re-run on final tree: 0 BLOCKING.
- [ ] Vitest 62/62 + go uncached still green on final tree; lane diff-check clean.
- [ ] Staged rollout entered per runbook with monitors watched; rollback path confirmed.
- [ ] Goal resumed by user, then marked complete with limitations disclosed.

## 6. Standing rules (carried forward)

- One mutable owner per file at a time; engine file untouched unless a gate proves loss.
- Backend prod logic (`service.go`/`submit.go`/`types.go`) stays out; seed-tool fix is allowed (test infra).
- Never run k6 against prod; never claim green without pasted output.
- Repair-locally: same failure twice → root-cause escalation, never blind re-patch.
