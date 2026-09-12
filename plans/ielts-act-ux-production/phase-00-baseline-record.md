# Phase 0 baseline record — 2026-09-12

Records the resolved integration state and the pinned behavior matrix required by
[phase-00-baseline.md](phase-00-baseline.md). The original [code review](code-review-baseline.md)
is retained as dated evidence; entries below supersede it where they conflict.

## P0.1 — Checkout revalidation

| Item | Result |
| --- | --- |
| Unmerged entries | 3 delete/modify conflicts (`backend/crates/application/src/grading.rs`, `backend/tests/contracts/grading_contract.rs`, `backend/tests/support/mysql.rs`) |
| Resolution | Files deleted (kept our branch's deletion). The repository's backend authority is Go (`backend/go/…` with all current work and CI; CI references no cargo/crates); the Rust files were incoming remnants of an obsolete authority with no Cargo build system. `git diff --name-only --diff-filter=U` now returns 0 entries. |
| Unrelated work | Preserved unstaged: all ACT reconciliation, SAT tools, delivery, grading, and migration changes remain untouched. |

## P0.2 — Type errors

All 14 historical errors rechecked against the resolved tree: unchanged. Repaired in three
minimal changes; no strictness setting weakened, no `any`, no blanket assertions:

1. `QuestionQueueRail.tsx` — imported `type KeyboardEvent as ReactKeyboardEvent` from react.
2. `satBootstrapEquality.ts` — guarded indexed elements (`b[i]` / `other === undefined`) in
   `sameAttempts`/`sameResponseRevisions`; ordered comparison semantics unchanged.
3. `SatSessionsRoute.tsx` — `NewSatSessionSheet` now receives `onGoToExamLibrary` from the
   owner that binds `useNavigate`; no module-global navigate.

`npm run typecheck`: exit 0. `satBootstrapEquality.test.ts`: 9/9 pass.

## P0.3 — Installation reproducibility

| Item | Result |
| --- | --- |
| Root cause | `package.json` added `dompurify: 3.4.15` (uncommitted prior work) without an npm-lock root entry; lock only carried dompurify 3.4.0 as jspdf's optional dep → `npm ci` failed. |
| Fix | `npm install --package-lock-only --ignore-scripts`: exactly one root dep + one node_modules entry (3.4.0→3.4.15, `optional` removed). No other upgrades. |
| pnpm lock | Kept — it was actively maintained in the same change set (same dompurify entry, already at 3.4.15). CI is the npm workflow and stays authoritative; both locks now agree. |
| Evidence | Isolated checkout `/tmp/ielts-lock-check` (only package.json + package-lock.json): `npm ci --ignore-scripts` succeeded; installed dompurify 3.4.15 verified. |

## P0.4 — Fixture manifest

`src/components/student/__tests__/support/examFixtures.ts` (+ gate test, 8 passing):
all 14 `QuestionType` blocks; identical prompts on distinct task IDs; 1,000+ word draft;
IME samples (kana/CJK/combining diacritics); broken media references; ACT Science with a
non-40 count (35); Academic/General Training variants; deterministic namespaced IDs.
Runtime/E2E fixtures remain in `e2e/support/actFixtures.ts`.

## P0.5 — Pinned behavior matrix (current defaults, to preserve)

| Behavior | Current code owner | Pinned default |
| --- | --- | --- |
| Writing clipboard/drop/context menu | `StudentWriting.tsx` `blockWritingEditorInteraction` | Blocked + `PASTE_BLOCKED` audit event; no student bypass |
| Writing undo/redo | `StudentWriting.tsx` undo/redo signals | Blocked with `UNDO_BLOCKED`/`REDO_BLOCKED` audit |
| Listening playback | `StudentListening.tsx` | `audioPlaybackEnabled ?? true`; rate changes via `StudentPlaybackRate`; transcript only when authored (`transcript`/`transcriptUrl`) |
| Submission availability | `StudentApp.tsx` + delivery policy | `unansweredSubmissionPolicy ?? "confirm"`; next/previous never submits |
| Pause | `config.progression.allowPause` | Default false (ACT fixtures: false) |
| Flags/elimination | Question navigator + ACT Science | Independent of answer selection |
| Proctor authority | `delivery.launchMode: "proctor_start"` | Candidate cannot self-start/unlock; transitions `auto_with_proctor_override` |

Provider identity (IELTS/ACT labels) may vary per provider; permissions come only from
authorized delivery configuration — never from theme or client preference.

## P0.6 — Quality/capacity inputs (recorded, pending measurement)

- Commands recorded from `package.json`: `typecheck` (passing), `test:run`, `lint`, `build`, `test:performance`, k6 presets (`k6:start-exam-200` etc.), `e2e:prod-smoke`.
- Capacity inputs (concurrent candidates, start-window burst, staging environment) remain explicit release inputs from deployment docs; nothing invented here.
- Browser/device checks prepared for Phase 7 but NOT executed under the current code-only restriction.

## Validation commands run this phase

```sh
git diff --name-only --diff-filter=U   # → 0 entries
npm run typecheck                      # → exit 0
npm run test:run -- src/features/student-delivery/application/__tests__/satBootstrapEquality.test.ts  # 9 pass
npm run test:run -- src/components/student/__tests__/support/examFixtures.test.ts                    # 8 pass
# isolated checkout: npm ci --ignore-scripts → success (dompurify 3.4.15)
```

Not yet run at this point: full `lint`, `build`, coverage — recorded before Phase 7.
