# Code review baseline — 2026-09-12

## Review boundary

Reviewed the four supplied design notes, the React student layout/module/control code, the existing session architecture, selected durability/security boundaries, ACT scope/reconciliation plan, and test/CI configuration. No skills or sub-agents were used. After the user's instruction, investigation stayed entirely in code/tools without browser inspection. No authenticated student runtime, visual comparison, actual mobile keyboard, deployment, load test, or full security audit was performed.

The baseline was recorded at HEAD `6ae5ccb1` with substantial existing staged/unstaged/untracked work. The inspection includes current working-tree code, not only that commit. Findings must be rechecked against the resolved integration commit before implementation.

## Inputs

- [Exam identity and overall geometry](/Users/rd-cream/.codex/attachments/fdb25ad8-dcc2-4f0f-8c6f-d977368559cb/pasted-text.txt)
- [Interaction quality](/Users/rd-cream/.codex/attachments/099b7a41-5738-4a58-9897-33a01947ea8b/pasted-text.txt)
- [Typography](/Users/rd-cream/.codex/attachments/52cb7b2d-2fa2-4cda-b048-7163d9173bc1/pasted-text.txt)
- [Responsive behavior](/Users/rd-cream/.codex/attachments/bf8a7065-721b-42b5-b37a-7f25a27ae001/pasted-text.txt)

## Existing foundations to reuse

| Responsibility | Current owner / evidence |
| --- | --- |
| Viewport/page lock/safe areas | `src/components/student/layout/StudentExamShell.tsx`, `StudentExamViewport.tsx`, `useStudentExamPageLock.ts`, viewport observer/policy |
| Capability and layout policy | `layout/studentCapabilities.ts`, `studentLayoutMode.ts`, `useStudentLayoutEnvironment.ts` |
| Scoped exam state and commands | `src/features/student/application/exam-session/` and selector hooks in `hooks/exam-session/` |
| Existing architecture invariants | `src/features/student/exam-session-architecture.md` documents local intent, revision checks, submission barriers, and migration boundaries |
| Protected control recovery | `ProtectedInput.tsx`, `ProtectedSelect.tsx`, `ProtectedChoiceInput.tsx`, `protectedAnswerControlLifecycle.ts` |
| Writing plain-text draft handling | `StudentWriting.tsx`, `StudentWritingPanes.tsx`; current textarea, live drafts, 300ms draft commit, composition/blur/transition handling |
| Durable response and retry infrastructure | `src/shared/durability/DurableResponseEngine.ts`, existing attempt adapter/provider, `src/services/studentMutationOutbox.ts` |
| Authoritative time | `src/shared/hooks/useAuthoritativeDeadlineClock.ts`, isolated student clock components |
| Annotation offsets and validation | `highlightV2Engine.ts`, `highlightV2Persistence.tsx`, `highlight/` modules |
| HTML safety | `src/utils/sanitizeHtml.ts` uses DOMPurify, URL normalization, and re-sanitization after rewrites |
| Backend security | `backend/go/cmd/api/main.go` wires auth/CSRF/rate limits/authorization; `student_context.go` redacts student snapshots |
| ACT scope | `src/features/exam-authoring/contracts/provider.ts` declares preset `ACT Science`; shared workspace routes Science to `StudentScience.tsx` |
| Existing release infrastructure | `.github/workflows/ci.yml`, `playwright.config.ts`, k6 scripts, backup rehearsal workflow |

These files show implemented foundations. Their existence is not proof that every execution path is correct or fully tested.

## Concrete gaps

1. `layout/studentLayoutMode.ts:6` uses a 768px compact threshold and only considers width. `layout/README.md` still documents 700px. `e2e/support/studentViewportMatrix.ts` expects 844×390 to be medium and 768px portrait to be medium. The new notes require a different policy and coordinated test updates.
2. `browserParityPolicy.ts:10` onward sets all minimum pane widths to 48px. `useSplitPaneResize.ts:14` defaults to 40%. `splitPaneDimensions.ts` declares a 16px desktop divider, while the desktop resizer uses `w-6/min-w-6`. These are distinct source-level geometry inconsistencies.
3. `useSplitPaneResize.ts` uses document mouse/touch listeners and stores split preference through a state-change effect. The inspected cleanup handles mouseup/touchend, without corresponding pointercancel/unmount handling for an in-progress drag. `StudentSplitPaneResizer.tsx:46` uses slider semantics rather than a window separator.
4. `StudentMaterialWithQuestionPane.tsx:264` conditionally mounts the selected compact pane. Split and compact also use separate branches. Stored answer state reduces risk but does not preserve DOM selection, editor identity, or all transient control state.
5. `studentExamViewportPolicy.ts` intentionally freezes shell height while the probable keyboard is open. `useStudentFocusedControlVisibility.ts` runs on the keyboard-open flag and measures the whole active control; it does not by itself prove long-text caret visibility or focus changes while the keyboard stays open. This is a code-identified verification gap, not a reproduced device failure.
6. `accessibilityScale.ts` uses viewport-dependent `clamp()` values. `StudentWritingPanes.tsx:230` creates a rounded, shadowed animated card; lines 261/281 use a serif editor/placeholder and responsive text sizes.
7. `StudentHeader.tsx` and pane/navigation controls contain active scale recipes. `StudentInteractionMotion*` tests assert those recipes, 200ms entrances, and timer animation. These tests must change intentionally with the new design contract.
8. `ProtectedSelect.tsx` is an HTML select with native change/blur rescue and registered durability lifecycle. Replacing only its JSX would remove meaningful recovery behavior.
9. `StudentWriting.tsx:585` unconditionally blocks clipboard/drop/context-menu interactions; the undo test explicitly expects keyboard undo to be blocked. The supplied native-editing preference conflicts with tested behavior and requires an explicit policy decision, not an incidental style fix.
10. The inspected annotation model persists highlights locally with canonical text hashes. Underline/note tools were not found in the inspected student annotation/header code. Storage writes currently suppress failures. Extending the model requires compatibility and truthful persistence states.
11. `StudentWritingPanes.tsx` memo-compares prompt text but omits task ID in `areWritingPromptPanePropsEqual`, despite task ID affecting the highlight surface. Add an identical-prompt/different-task regression when modifying it.
12. `StudentSpeaking.tsx` requests desktop splitter behavior, exposes disabled proctor call controls, and uses local preparation/speaking counters. Responsive propagation and accurate timing labels belong in scope; a new recording/video subsystem does not.
13. `e2e/student-accessibility.spec.ts:67` returns successfully when the navigator is absent and only checks Escape if a dialog is visible. Parts of `e2e/frontend-performance.spec.ts` similarly assert only when metrics/monitoring exist. Required behaviors need non-vacuous tests.
14. `.github/workflows/ci.yml:357` deploys after `quality-gates` and `go-backend`, without depending on `e2e-tests` or `performance-check`. Line 353 enables temporary public Lighthouse artifact storage. The post-deploy command runs unit tests, which is not deployed UI/API verification.
15. A direct package-manifest/lockfile root comparison found `dependencies.dompurify = "3.4.15"` in `package.json` but no corresponding npm-lock root dependency. `pnpm-lock.yaml` is also present and modified. No clean install was attempted during this review; reproducibility is an unresolved check.

## Checks actually run

### Focused Vitest baseline: passed

```sh
npm run test:run -- src/components/student/layout/__tests__/studentLayoutMode.test.ts src/components/student/layout/__tests__/studentExamViewportPolicy.test.ts src/components/student/__tests__/StudentMaterialWithQuestionPane.test.tsx src/components/student/__tests__/ProtectedSelect.test.tsx src/components/student/__tests__/StudentWriting.lifecycle.test.tsx src/components/student/__tests__/StudentWriting.undo.test.tsx src/features/student/application/exam-session/__tests__/submissionCommands.test.ts src/shared/durability/__tests__/DurableResponseEngine.preservation.test.ts
```

Result: **8 files passed; 53 tests passed; 10.45 seconds.** One existing test emitted a React warning:

```text
stderr | src/components/student/__tests__/StudentWriting.lifecycle.test.tsx > StudentWriting lifecycle durability > commits blur draft and allows a subsequent edit after refocus
An update to StudentWriting inside a test was not wrapped in act(...).

When testing, code that causes React state updates should be wrapped into act(...):

act(() => {
  /* fire events that update state */
});
/* assert on the output */

This ensures that you're testing the behavior the user would see in the browser. Learn more at https://react.dev/link/wrap-tests-with-act
```

The suite verifies existing behavior, including the current undo restriction. It does not validate the proposed design.

### Global TypeScript baseline: failed

Command: `npm run typecheck`. Exit code: 1. Exact diagnostics:

```text
src/features/exam-authoring/ui/spine/QuestionQueueRail.tsx(128,13): error TS2304: Cannot find name 'ReactKeyboardEvent'.
src/features/student-delivery/application/satBootstrapEquality.ts(61,16): error TS18048: 'n' is possibly 'undefined'.
src/features/student-delivery/application/satBootstrapEquality.ts(62,22): error TS18048: 'n' is possibly 'undefined'.
src/features/student-delivery/application/satBootstrapEquality.ts(63,19): error TS18048: 'n' is possibly 'undefined'.
src/features/student-delivery/application/satBootstrapEquality.ts(64,22): error TS18048: 'n' is possibly 'undefined'.
src/features/student-delivery/application/satBootstrapEquality.ts(65,23): error TS18048: 'n' is possibly 'undefined'.
src/features/student-delivery/application/satBootstrapEquality.ts(66,22): error TS18048: 'n' is possibly 'undefined'.
src/features/student-delivery/application/satBootstrapEquality.ts(67,30): error TS18048: 'n' is possibly 'undefined'.
src/features/student-delivery/application/satBootstrapEquality.ts(68,24): error TS18048: 'n' is possibly 'undefined'.
src/features/student-delivery/application/satBootstrapEquality.ts(69,25): error TS18048: 'n' is possibly 'undefined'.
src/features/student-delivery/application/satBootstrapEquality.ts(70,30): error TS18048: 'n' is possibly 'undefined'.
src/features/student-delivery/application/satBootstrapEquality.ts(83,36): error TS2532: Object is possibly 'undefined'.
src/features/student-delivery/application/satBootstrapEquality.ts(83,74): error TS2532: Object is possibly 'undefined'.
src/products/sat/routes/SatSessionsRoute.tsx(248,4056): error TS2304: Cannot find name 'navigate'.
```

These 14 errors in three files predate this planning task's document additions.

### Git integration baseline: unresolved

`git diff --name-only --diff-filter=U` returned:

```text
backend/crates/application/src/grading.rs
backend/tests/contracts/grading_contract.rs
backend/tests/support/mysql.rs
```

The checkout also contains substantial ACT, SAT, delivery, grading, and CSS modifications. No conflict resolution or product source edit was performed by this planning task.

## Not established by this review

Full lint/build/coverage status, clean install success, full Go/MySQL integration results, browser parity, WCAG conformance, real-device usability, production concurrency capacity, deployed headers/CSP, operational recovery times, and official live-test visual equivalence remain unverified. Phase 0 and the release matrix identify the required evidence rather than implying these checks passed.
