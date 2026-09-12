# Phase 0 — Integration baseline and fixtures

Status: planned. Depends on: none. Next: [Phase 1](phase-01-design-system.md).

## Result

A reproducible checkout and fixture set that lets subsequent changes demonstrate behavior preservation. The 53 passing tests and 14 type errors in the earlier review are historical observations; recheck them before editing. Do not repair an issue that another in-progress change has already resolved.

## File ownership

| Area | Existing files |
| --- | --- |
| Dependency installation | `package.json`, `package-lock.json`, `pnpm-lock.yaml`, `.github/workflows/ci.yml` |
| Historical type errors | `src/features/exam-authoring/ui/spine/QuestionQueueRail.tsx`, `src/features/student-delivery/application/satBootstrapEquality.ts`, `src/products/sat/routes/SatSessionsRoute.tsx` |
| Historical conflicts | `backend/crates/application/src/grading.rs`, `backend/tests/contracts/grading_contract.rs`, `backend/tests/support/mysql.rs` |
| Runtime-backed fixtures | `e2e/support/backendE2e.ts`, `e2e/support/actFixtures.ts`, `e2e/support/studentUi.ts`, `e2e/global-setup.ts` |
| Canonical question families | `src/types.ts`, `src/features/exam-authoring/contracts/provider.ts` |
| Existing ACT work | `plans/act-reconciliation/overall-plan.md` and the implementation it tracks |

## Ordered tasks

### P0.1 — Revalidate the checkout

1. Record current HEAD, staged/unstaged changes, and unmerged paths. Inspect the conflicting index stages before resolving a delete/modify conflict; file absence alone is not the intended resolution.
2. Establish the intended integration of current Go/ACT/SAT work. Preserve edits outside this initiative. Do not merge an obsolete Rust authority back into Go to silence Git.
3. Re-run typecheck. Group failures by owning module and repair them separately from student UX work.
4. Store the new baseline result alongside the plan, including which prior findings are now closed. Keep the original review as dated evidence.

Done when: the starting state is explicit, conflicts are resolved intentionally, and unrelated work remains intact.

### P0.2 — Close type errors without weakening the model

- `QuestionQueueRail`: import the React keyboard event type under the alias its handler actually uses, if the missing alias persists.
- `satBootstrapEquality`: guard indexed array elements before property access, retaining ordered comparison semantics. Unequal lengths, absent entries, changed revisions, and changed attempt fields return unequal; equivalent ordered inputs return equal. Extend `application/__tests__/satBootstrapEquality.test.ts` only for meaningful missing cases.
- `SatSessionsRoute`: resolve the navigation callback in the component that owns the action. An outer component's hook binding is not available to a separate child function. Pass an explicit callback or use the routing hook in the actual component; do not introduce a module-global navigate function.
- Re-run typecheck. Do not disable indexed-access checking, use `any`, or add blanket assertions.

Done when: global TypeScript succeeds and the affected existing tests pass.

### P0.3 — Prove installation reproducibility

1. Use the CI npm workflow as the default owner. Synchronize the npm lock with the manifest using the repository's Node/npm versions, including the declared DOMPurify pin.
2. Inspect the lock diff for unintended dependency upgrades. Do not run a blanket upgrade to repair one missing declaration.
3. Decide whether the pnpm lock is maintained by an active supported workflow. If it is, synchronize it using that workflow; otherwise remove it in a documented package-manager cleanup. Do not silently alternate installers.
4. Run `npm ci`, typecheck, and build in an isolated resolved checkout. Record versions and commands. A successful install using existing `node_modules` is insufficient evidence.

Done when: CI can recreate the same dependency graph without relying on the current workstation cache.

### P0.4 — Create a fixture coverage manifest

Extend current fixture builders rather than copying entire exams. Add a small shared fixture module only if the existing owners cannot serve component and integration tests.

| Fixture group | Required cases |
| --- | --- |
| All 14 question types | TFNG, CLOZE, MATCHING, MAP, MULTI_MCQ, SINGLE_MCQ, SHORT_ANSWER, SENTENCE_COMPLETION, DIAGRAM_LABELING, FLOW_CHART, TABLE_COMPLETION, NOTE_COMPLETION, CLASSIFICATION, MATCHING_FEATURES |
| Answer identity | Empty/cleared value, repeated permitted choice, grouped/root IDs, multiple slots, partial completion, selected+flagged |
| Reading | Long passage, paragraph markers, repeated phrases, authored emphasis, General Training and Academic |
| Writing | Two different task IDs with identical prompt text, 1,000+ words, whitespace-only draft, Unicode, IME composition, chart prompt |
| ACT Science | Stimulus/question/option images, tables/graphs, text options, elimination, variable question count, missing image |
| Runtime | Preview, live proctored, pause, extension, offline checkpoint, storage failure, pending/verified completion |

Each fixture needs stable IDs and a label explaining the invariant it exercises. No production candidate information, credentials, copied private essays, or live API URLs.

### P0.5 — Pin the existing policy before changing presentation

Record current configured behavior for clipboard/cut/paste, undo/redo, context menu, transcript, audio speed/seek/replay, flags/elimination, submission availability, and proctor actions. Default to preserving existing rules. Record unsupported features honestly instead of filling gaps with a visual mock.

Separate provider identity from permission: ACT/IELTS presentation can choose labels, but the authorized delivery configuration determines permitted actions. The candidate cannot toggle into a more permissive mode.

### P0.6 — Establish quality and capacity inputs

Record baseline static/unit/build/coverage results and the current critical test selection. Identify the expected concurrent candidates, start-window burst, supported browsers, and staging environment from existing deployment documentation/configuration. Unknown capacity inputs remain explicit release inputs; do not invent a scalability guarantee.

Prepare visual/real-device test cases for Phase 7. Under the current user restriction, perform no browser interaction; code-based preparation can proceed.

## Validation

From the repository root, after resolving the integration state:

```sh
git diff --name-only --diff-filter=U
npm run typecheck
npm run test:run -- src/features/student-delivery/application/__tests__/satBootstrapEquality.test.ts
npm run lint
npm run build
git diff --check
```

Clean-install validation belongs in the isolated checkout. Full baseline tests/coverage are recorded once; subsequent phases run targeted checks until their changes justify broader testing.

## Commit boundaries and exit gate

Suggested commits: integration repairs; type repairs; lockfile reproducibility; fixture/policy manifest. Keep them separate so a reviewer can distinguish pre-existing defects from UX changes.

- No unresolved Git entries and no known required type/build/install failure.
- Fixture manifest covers each family and failure state above.
- Current policy and ACT contract ownership are documented.
- No product UX change, permission change, or database migration is hidden in baseline repairs.

Do not progress through a failed install/type gate by lowering correctness checks. Unrelated test debt may be recorded, but relevant behavior failures remain blockers and all required release checks must eventually pass.
