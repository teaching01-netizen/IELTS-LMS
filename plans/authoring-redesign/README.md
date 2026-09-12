# Authoring Redesign — plan tree index & dispatch guide

Workflow: `ai-planning-workflow` (Main Agent → phase planning → implementation agents → verification).

## Files

| File | Role |
|---|---|
| `overall-plan.md` | Goal, verified current state, target architecture, phases, waves, ownership, AC-01…AC-20, gate, risks, DoD |
| `phase-01-design-foundation.md` | Tokens, measure, contract tests, baseline manifest |
| `phase-02-shell-header.md` | Header reduction, overflow menu, ambient save, sample-load repair |
| `phase-03-question-navigator.md` | Navigator rows, filter menu, row menu, selection mode |
| `phase-04-authoring-canvas.md` | Typographic canvas, readiness control, ambient validation, empty states |
| `phase-05-inspector.md` | Classification/settings inspector |
| `phase-06-editor.md` | Toolbar progressive disclosure, contextual toolbars, editor surface |
| `phase-07-command-keyboard-motion-a11y.md` | Command palette, keyboard map, motion, loading, a11y |
| `phase-08-final-integration.md` | Verification + AC audit + repair routing |
| `phase-NN-verification-log.md` | Written **by** each phase with raw gate output (not present until the phase runs) |
| `baseline-manifest.txt` | Created by Phase 01; consumed by Phase 08 for the scope proof |

## Dispatch order

```text
Wave 1  Phase 01
Wave 2  Phase 02
Wave 3  Phase 03 ║ Phase 06     (the only parallel pair; file-disjoint)
Wave 4  Phase 04
Wave 5  Phase 05
Wave 6  Phase 07
Wave 7  Phase 08
```

A phase is **ready** only when every dependency phase has a written verification log with a green gate. Never dispatch a phase whose dependency log is missing.

## Implementation-agent brief (paste into each agent)

```text
You are the implementation agent for <PHASE FILE>.

Read, in this order:
  1. plans/authoring-redesign/overall-plan.md        (goal, invariants, AC table, ownership rules)
  2. plans/authoring-redesign/<PHASE FILE>           (your complete instructions)
  3. the real files listed under "File-by-file plan" in your phase doc

Rules:
  - Implement ONLY this phase. Do not start, plan, or partially implement later phases.
  - Touch ONLY the files your phase owns. AuthoringWorkspace.tsx is single-owner per wave.
  - Preserve every behaviour listed under "Behavioral contract". The invariants in
    overall-plan §2.1 (autosave, flush-before-navigation, idempotency keys, focus anchors,
    overlay stack, release gating, a11y) are non-negotiable.
  - Change a pinned test only for the reasons listed in your phase's "Test changes" table,
    and add at least one new assertion for each new behaviour.
  - Do not run git commit. This worktree has hundreds of unrelated in-flight changes.
  - Run the gate commands in your phase's §10 and fix failures caused by your work.
    Do not fix unrelated pre-existing failures; note them instead.

Finish by writing plans/authoring-redesign/phase-NN-verification-log.md containing:
  - every gate command with its raw output and exit code;
  - the test delta (added / changed / deleted, with the reason for each);
  - the definition-of-done checklist, each item marked with the evidence that satisfies it;
  - any deviation from the plan and why it was necessary;
  - anything the next phase must know.
```

## Main-agent verification (after each phase)

```text
1. Read the phase's verification log; confirm raw output, not claims.
2. Re-run the phase gate yourself (vitest + eslint + vite build, scoped).
3. Check the ownership diff:  git diff --stat -- <owned paths>
4. Confirm the dependency graph: only then mark the phase complete and dispatch the next wave.
5. On failure: route back to the owning phase (table in phase-08 §4). Do not patch a
   phase's file from another phase.
```

## Known environment limitations (do not "fix" these)

- `npx tsc --noEmit` heap-OOMs (exit 134) on this repo — pre-existing. Type safety is asserted by vitest + eslint + `vite build`.
- The Playwright runner is blocked by an unrelated backend compile error (`e2e/TEST_STATUS.md` §1). E2E is **static-audited** in this initiative.
- `plans*/` directories are not gitignored; plan files are untracked work products. Do not commit them unless the operator asks.

## Operator decisions still open

1. **Delete vs keep the release page's own header** — out of scope here; the release route keeps its chrome (`ReleaseHeader.tsx`) until a separate pass.
2. **Dark appearance tuning for the new surfaces** — Phase 01 reuses existing tokens, so dark mode works, but the new inspector/readiness/palette surfaces were not explicitly reviewed in dark. Flag for a follow-up pass.
3. **Virtualising the 147-row navigator** — deferred to Phase 07's measurement; the rows are cheap (52px, no editor), so virtualisation may not be needed. Phase 07 must record the measured paint time either way.
4. **Per-row Replace / per-row Preview** — deliberately omitted (documented in Phase 03 §5.6). Say the word and they become a Phase 09.

