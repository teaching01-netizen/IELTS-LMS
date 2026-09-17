# SAT Mobile Layout and Accessibility Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the SAT student delivery experience responsive, keyboard-safe, touch-safe, and accessible across phone, tablet, desktop, and 200% text enlargement, with objective evidence for a 10/10 result.

**Architecture:** Keep the SAT shell and its direct children responsible for width containment and responsive reflow. Reuse the existing student visual-viewport, page-lock, and focused-control visibility primitives at the SAT route boundary instead of creating a second keyboard policy. Repair ARIA relationships and floating-tool geometry at the component boundaries that own them, then prove every change with unit tests, cross-browser geometry checks, axe-core scans, and manual mobile assistive-technology checks.

**Tech Stack:** Bun, React 19, TypeScript, Tailwind utility classes, SAT CSS custom properties, Vitest/Testing Library, Playwright Chromium/WebKit/touch-Chromium, and axe-core.

---

## 1. Scope and evidence

This plan implements the findings from the evidence-driven SAT audit. It is limited to the SAT student UI and its browser acceptance harness; it does not duplicate the separate SAT answer-durability plan at docs/superpowers/plans/2026-09-16-sat-answer-durability-10-10.md.

The current evidence to preserve as the baseline is:

- The focused SAT delivery suite passes 90 files and 566 tests.
- At viewport widths 640, 700, and 768, the shell expands to an approximately 812px min-content width. The More trigger and Next control can render outside the viewport even though the document itself is clipped.
- At 390px with 200% SAT text tokens, the footer navigator visibly truncates the compact position label from “1 of 3” to “1 of”.
- The SAT route does not currently use useStudentExamViewport, useStudentExamPageLock, or useStudentFocusedControlVisibility.
- The student-produced-response field uses inputMode="decimal" while its help text requires slash-based fractions such as a/b.
- axe-core reported no confirmed violations, but identified a generic div with aria-label="Question N" and closed triggers whose aria-controls targets are absent or point to an inner child rather than the dialog root.
- Reference Sheet collapse and close controls measure approximately 32px by 32px on the desktop floating-tool header, below the 44px preferred SAT touch target.
- The root typecheck and lint failures currently include unrelated user-owned browser-probe and test-fixture changes. They must not be silently overwritten during this work.

## 2. Definition of “10/10”

“10/10” is an acceptance gate, not a visual promise. The SAT result may be rerated 10/10 only after all of the following are true:

| Area | 10/10 acceptance gate |
|---|---|
| Layout | At 320, 375, 390, 639, 640, 700, 768, 834, 1024, and 1194 CSS pixels, no visible SAT shell, pane, footer, or enabled primary control has a rectangle outside the viewport. No document or shell horizontal overflow is used to hide a defect. |
| Responsive behavior | Reading/Writing and Math both work at phone, tablet, and desktop widths. Reading panes remain usable, split controls do not become unreachable, and compact tool rows wrap or collapse without overlap. |
| Typography | Default and 200% SAT text-scale settings preserve visible content, labels, focus rings, and actions. No tested text node is clipped by its containing control. |
| Viewport and input | The SAT route freezes the shell height while the software keyboard is open, keeps document scroll locked, scrolls only the nearest SAT content pane to reveal the focused field, and restores the normal footer after keyboard close. |
| Touch | Every enabled SAT button, menu item, dialog close control, navigator control, and reference-sheet header control is at least 44px by 44px. |
| Semantics | Question headings use semantic structure; every open trigger points to an existing dialog/menu root; closed triggers do not expose dangling aria-controls; menu keyboard navigation works with Escape, arrows, Home, End, and Tab. |
| State surfaces | Directions, module, break, review, complete, error, loading, paused, and terminated surfaces remain contained and operable at the same mobile matrix. |
| Verification | SAT unit tests, SAT-scoped lint, build, deterministic Playwright Chromium/WebKit/touch runs, and axe-core scans pass. Manual VoiceOver/Safari iOS and TalkBack/Chrome Android checks pass for focus, zoom, keyboard, and touch. |

The unrelated root typecheck/lint failures remain a separate repository baseline gate. A release claim for the whole repository must additionally resolve those user-owned failures; this SAT plan does not erase or rewrite them.

## 3. Change map

### Modify

- src/features/student-delivery/ui/SatExamShell.tsx — accept the stable exam height and keyboard state, own SAT shell containment, and expose the keyboard state to CSS.
- src/features/student-delivery/ui/shell/SatExamTopBar.tsx — use a tablet-safe two-row layout below the desktop breakpoint, wrap tools, and keep all tool controls inside the viewport.
- src/features/student-delivery/ui/shell/SatExamFooter.tsx — reflow below desktop, keep the compact question position fully visible at 200%, and preserve the full accessible name.
- src/features/student-delivery/ui/question/SatQuestionWorkspace.tsx — add explicit SAT scroll-owner markers and preserve min-width/min-height containment.
- src/features/student-delivery/ui/question/SatQuestionHeader.tsx — replace the labelled generic div with a semantic question heading.
- src/features/student-delivery/ui/question/SatStudentProducedAnswer.tsx — expose a keyboard/input mode that supports the documented fraction syntax.
- src/features/student-delivery/ui/primitives/SatPopoverShell.tsx — allow the dialog root to receive its public id.
- src/features/student-delivery/ui/shell/SatDirectionsPopover.tsx — place the trigger target id on the dialog root.
- src/features/student-delivery/ui/shell/SatQuestionNavigator.tsx — keep its id on the dialog root and retain focus-safe closed behavior.
- src/features/student-delivery/ui/shell/SatMoreMenu.tsx — implement complete menu-keyboard navigation and stable roving focus.
- src/features/student-delivery/ui/review/SatReviewPage.tsx — apply the stable viewport contract and mobile footer/header reflow.
- src/features/student-delivery/ui/transitions/SatDirectionsScreen.tsx — harden narrow-width wrapping and action containment.
- src/features/student-delivery/ui/transitions/SatBreakScreen.tsx — harden narrow-width wrapping and action containment.
- src/features/student-delivery/ui/transitions/SatCompleteScreen.tsx — harden narrow-width wrapping and action containment.
- src/features/student-delivery/routes/SatStudentSessionRoute.tsx — compose the existing viewport/page-lock/focused-control hooks and pass their state to module/review surfaces.
- src/app/router/dev/SatAccessibilityDebugRoute.tsx — add student-produced-response and non-module surface fixtures for deterministic browser tests.
- src/components/student/layout/useStudentFocusedControlVisibility.ts — recognize explicit SAT scroll owners.
- src/features/student-delivery/domain/satToolSizePolicy.ts — make the reference header geometry 44px.
- src/features/student-delivery/ui/tools/SatFloatingTool.tsx — update reference header hit areas and collapsed-height fallback.
- src/features/student-delivery/ui/tools/SatReferenceSheetPanel.tsx — keep content geometry aligned with the 44px header.
- src/features/student-delivery/ui/tools/satToolPlacementRuntime.ts — measure actual SAT chrome before falling back to CSS token heights.
- src/index.css — define the compact/desktop breakpoint contract, SAT stable-height behavior, keyboard footer behavior, and reference header tokens.
- e2e/sat-student-accessibility.spec.ts — add viewport-containment, visible-text, touch, keyboard, ARIA, surface, and cross-browser acceptance checks.
- playwright.sat-a11y.config.ts — keep core layout tests deterministic and separate any network-dependent tool checks from the offline SAT harness.

### Create

- src/features/student-delivery/ui/tools/satToolPlacementRuntime.test.ts — verify measured header/footer safe areas and fallback behavior.
- src/features/student-delivery/ui/__tests__/satAccessibilityContracts.test.tsx — verify semantic question headings, conditional aria-controls, and minimum SAT target contracts without relying on browser layout.

### Do not change

- SAT response durability, scoring, API, database, migration, or proctoring state logic.
- Existing user-owned changes unrelated to the SAT UI.
- Assertions that are already correct merely to make a test pass.

## 4. Implementation tasks

### Task 0 — Reproduce the baseline and protect the dirty worktree

**Files:** no production files; implementation notes only.

- [x] Run git status --short, git diff --stat, and git diff --check from the repository root. Preserve every existing user change.
- [x] Run the focused baseline:

~~~bash
bunx vitest run src/features/student-delivery --reporter=dot
bun run build
bunx eslint src/features/student-delivery/ui src/features/student-delivery/routes/SatStudentSessionRoute.tsx
~~~

- [x] Run the current focused browser evidence with one worker:

~~~bash
bunx playwright test --config=playwright.sat-a11y.config.ts --project=chromium --workers=1 -g "actual 200 percent|320px mobile|mobile reading"
~~~

- [x] Record the pre-existing root failures separately if they still occur:

~~~bash
bun run typecheck
bun run lint
~~~

- [x] Do not run reset, checkout, clean, or broad deletion commands. The implementation branch must start with a reproducible baseline and an unchanged user-owned diff.

**Task 0 baseline recorded on 2026-09-16:**

- Focused SAT delivery suite: 90 files passed, 566 tests passed.
- Production build: passed; Vite transformed 3,503 modules.
- SAT-scoped ESLint: 0 errors, 1 pre-existing warning at src/features/student-delivery/ui/tools/SatFloatingTool.tsx:549.
- Focused Chromium browser baseline: 3 tests passed; Vite logged expected ECONNREFUSED errors for the unavailable backend session endpoint at 127.0.0.1:4000.
- Root typecheck: failed only in the untracked src/test/studentAnswerLoss.browser-probe.tsx and src/test/studentAnswerLoss.browser-runner.ts files, with 8 reported errors.
- Root lint: 2 errors and 1,055 warnings; failures are outside the SAT UI, with the untracked browser probes among the warnings.
- git diff --check: 6 pre-existing blank-line-at-EOF errors in unrelated user-owned files.
- No reset, checkout, clean, deletion, or production source edit was performed.

### Task 1 — Add failing geometry and visible-content acceptance tests

**Files:**

- Modify e2e/sat-student-accessibility.spec.ts.

- [x] Add a helper that measures actual rectangles, not only document scrollWidth:

~~~ts
async function expectSatViewportContained(page: Page) {
  const failures = await page.evaluate(() => {
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const selectors = [
      '.sat-exam-shell',
      '.sat-exam-topbar',
      '#sat-question-content',
      '.sat-exam-footer',
      '[data-sat-focus="topbar-more"]',
      '[data-sat-focus="footer-navigator"]',
    ];
    return selectors.flatMap((selector) =>
      Array.from(document.querySelectorAll<HTMLElement>(selector)).flatMap((element) => {
        const rect = element.getBoundingClientRect();
        const visible = getComputedStyle(element).visibility !== 'hidden';
        if (!visible || rect.width === 0 || rect.height === 0) return [];
        return rect.left >= -1 && rect.top >= -1 &&
          rect.right <= viewport.width + 1 && rect.bottom <= viewport.height + 1
          ? []
          : [{ selector, left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }];
      }),
    );
  });
  expect(failures).toEqual([]);
}
~~~

- [x] Add a Math and a Reading/Writing width matrix for 639, 640, 700, and 768 pixels. Assert shell containment, visible enabled buttons at least 44px, and no pairwise button overlap. The test must fail at the current 640px layout because the shell is approximately 812px wide and More/Next can be outside the viewport.
- [x] Add a 200% test at 320, 390, 640, 700, and 768 pixels that finds the visible footer position label and asserts its scrollWidth is no greater than its clientWidth. Assert the label text is complete, not merely present in the accessibility tree.
- [x] Add an enabled-control rectangle assertion to the reference-tool regression test so desktop collapse and close controls are measured as well as compact controls.
- [x] Run the new tests and verify they fail for the known geometry defects before changing production classes.

~~~bash
bunx playwright test --config=playwright.sat-a11y.config.ts --project=chromium --workers=1 -g "viewport containment|footer position|reference header"
~~~

- [x] Commit only the test changes if the branch policy requires incremental commits (not required for this inline task):

~~~bash
git add e2e/sat-student-accessibility.spec.ts playwright.sat-a11y.config.ts
git commit -m "test: expose SAT mobile geometry regressions"
~~~

**Task 1 red baseline recorded on 2026-09-16:**

- The focused Chromium command exits 1 with 2 expected failures and 1 passing test.
- Viewport containment fails at the 640px breakpoint with the top bar, question content, and footer measuring 812px wide; the More control is outside the viewport.
- The reference header touch-target test fails because the current control width is 32px instead of the required 44px.
- The 200% footer position test passes at 320, 390, 640, 700, and 768px with complete rendered text and no label overflow.
- SAT test-file ESLint passes with no output, and the scoped diff check passes.
- No production source file was changed; the existing user-owned worktree changes remain untouched.

### Task 2 — Repair SAT shell width containment and responsive chrome

**Files:**

- Modify src/features/student-delivery/ui/SatExamShell.tsx.
- Modify src/features/student-delivery/ui/shell/SatExamTopBar.tsx.
- Modify src/features/student-delivery/ui/shell/SatExamFooter.tsx.
- Modify src/features/student-delivery/ui/question/SatQuestionWorkspace.tsx.
- Modify src/index.css.
- Modify src/features/student-delivery/ui/SatExamShell.test.tsx.
- Modify src/features/student-delivery/ui/question/SatQuestionWorkspace.test.tsx.

- [x] Add min-w-0 to the SAT shell root, its blocked-region grid boundary, top-bar/footer max-width wrappers, main content, and the zoom wrapper. Keep the shell as the only horizontal containment boundary; do not hide an oversized child with overflow-hidden and call it fixed.
- [x] Move the three-anchor desktop top bar from the current sm breakpoint to the lg breakpoint. Below 1024px, use a two-row layout: section/timer in the first row and a wrapping tool group in the second row. The tool group must have min-w-0, flex-wrap, and no horizontal scrolling.
- [x] Remove the forced 96px height from the compact/tablet top bar. Keep 96px only at the desktop breakpoint, let the compact header grow to the wrapped content, and keep each tool button at least 44px high. At short viewports, retain the existing icon-only behavior rather than allowing the row to grow beyond the viewport.
- [x] Move the desktop three-column footer from sm to lg. Below 1024px, hide the candidate/save cluster, keep Previous/navigator/Next in a minmax(0,1fr) grid, and allow the footer row to grow around safe-area padding.
- [x] Change the SAT padding media rule in src/index.css from min-width 640px to min-width 1024px so the tablet layout does not consume the desktop gutters before it has desktop geometry.
- [x] Keep the reading workspace split breakpoint at its existing 767px behavior unless the new geometry test proves a specific regression. Add min-w-0 to both split pane roots and preserve overflow-y:auto on the actual panes.
- [x] Add the following CSS contract for compact chrome, using the actual class names after the JSX reflow:

~~~css
.sat-ui.sat-exam-shell {
  min-width: 0;
  width: 100%;
  height: var(--student-exam-height, 100dvh);
  max-height: var(--student-exam-height, 100dvh);
}

@media (max-width: 1023px) {
  .sat-exam-topbar > div,
  .sat-exam-footer > div {
    min-width: 0;
    width: 100%;
  }
}
~~~

- [x] Update component tests to assert the new breakpoint classes/attributes and that long section labels remain contained without removing their accessible text.
- [x] Run the focused unit and geometry gates. Expected result: the new 640/700/768 tests pass in Chromium and the existing 320/390 tests remain green.

~~~bash
bunx vitest run src/features/student-delivery/ui/SatExamShell.test.tsx src/features/student-delivery/ui/question/SatQuestionWorkspace.test.tsx --reporter=dot
bunx playwright test --config=playwright.sat-a11y.config.ts --project=chromium --workers=1 -g "viewport containment|320px mobile|mobile reading"
~~~

- [x] Commit the shell-only change set (not required for this inline task):

~~~bash
git add src/features/student-delivery/ui/SatExamShell.tsx src/features/student-delivery/ui/shell/SatExamTopBar.tsx src/features/student-delivery/ui/shell/SatExamFooter.tsx src/features/student-delivery/ui/question/SatQuestionWorkspace.tsx src/index.css src/features/student-delivery/ui/SatExamShell.test.tsx src/features/student-delivery/ui/question/SatQuestionWorkspace.test.tsx
git commit -m "fix: contain SAT chrome on tablet widths"
~~~

**Task 2 verification recorded on 2026-09-16:**

- Focused component gates passed: 2 files, 21 tests.
- Focused Chromium geometry gates passed: 3 tests, including mobile Reading/Writing and 320px reachability.
- Modified SAT source/test ESLint passed with no output.
- Scoped diff check passed.
- Production build passed with 3,504 modules transformed.
- Changes remain inline and uncommitted as requested; unrelated dirty-worktree changes were preserved.

### Task 3 — Make the footer position indicator readable at 200%

**Files:**

- Modify src/features/student-delivery/ui/shell/SatExamFooter.tsx.
- Modify src/features/student-delivery/ui/SatExamShell.test.tsx for the footer assertions.
- Modify e2e/sat-student-accessibility.spec.ts.

- [x] Keep the full accessible name exactly descriptive: “Open question navigator. Question N of M”. The visible compact label must be a complete short form that can fit at 200%; use “N/M” below 420px and “Question N of M” at the wider presentation.
- [x] Remove the nested truncate behavior that clips the only visible compact label. Use whitespace-nowrap on the short label and min-w-0 only on the outer grid track; the button itself must be allowed to size to its complete short label.
- [x] Use a compact “Prev” visual label below 420px while keeping aria-label="Previous question"; retain “Previous” at wider widths. Keep Next and the last-question Review action visibly distinct.
- [x] Add a component test that renders a three-question footer and asserts the short text is “1/3”, the full aria-label is present, and no visible label uses an overflow-hidden/truncate class.
- [x] Run the 200% browser matrix and require clientWidth >= scrollWidth for the visible position label.

~~~bash
bunx vitest run src/features/student-delivery/ui/SatExamShell.test.tsx --reporter=dot
bunx playwright test --config=playwright.sat-a11y.config.ts --project=chromium --workers=1 -g "200 percent|footer position"
~~~

- [x] Commit the footer change (not required for this inline task):

~~~bash
git add src/features/student-delivery/ui/shell/SatExamFooter.tsx src/features/student-delivery/ui/SatExamShell.test.tsx e2e/sat-student-accessibility.spec.ts
git commit -m "fix: preserve SAT footer position text at 200 percent"
~~~

**Task 3 verification recorded on 2026-09-16:**

- SAT shell component suite passed: 20 tests.
- The 200% Chromium matrix passed: 4 tests, including the footer-position matrix at 320, 390, 640, 700, and 768px.
- The adjacent viewport-containment, mobile Reading/Writing, and 320px reachability gate passed: 3 tests.
- Modified SAT footer/test/e2e ESLint passed with no output, and the scoped diff check passed.
- The navigator retains the full accessible name while rendering 1/3 below 420px; the position label has no horizontal overflow.
- Changes remain inline and uncommitted as requested; unrelated dirty-worktree changes were preserved.

### Task 4 — Integrate the existing visual-viewport keyboard policy

**Files:**

- Modify src/features/student-delivery/routes/SatStudentSessionRoute.tsx.
- Modify src/features/student-delivery/ui/SatExamShell.tsx.
- Modify src/features/student-delivery/ui/review/SatReviewPage.tsx.
- Modify src/features/student-delivery/ui/question/SatQuestionWorkspace.tsx.
- Modify src/components/student/layout/useStudentFocusedControlVisibility.ts.
- Modify src/index.css.
- Modify src/components/student/layout/__tests__/useStudentExamViewport.test.ts.
- Modify src/features/student-delivery/ui/SatExamShell.test.tsx.
- Modify src/features/student-delivery/ui/question/SatQuestionWorkspace.test.tsx.
- Modify e2e/sat-student-accessibility.spec.ts.
- Modify src/app/router/dev/SatAccessibilityDebugRoute.tsx for the deterministic SPR viewport fixture.

- [x] At the route boundary, compose the existing primitives for module and review phases:

~~~tsx
const examViewportActive = state.phase === 'module' || state.phase === 'review';
const examViewport = useStudentExamViewport(examViewportActive);
useStudentExamPageLock(examViewportActive);
useStudentFocusedControlVisibility(examViewportActive && examViewport.keyboardOpen);
~~~

- [x] Pass examViewport.stableExamHeight and examViewport.keyboardOpen into SatExamShell. Add matching optional props to SatReviewPage so review remains a stable, document-locked exam surface.
- [x] Make the SAT shell use --student-exam-height with a 100dvh fallback and add data-sat-keyboard-open="true|false". While true, hide the SAT footer with visibility:hidden and pointer-events:none while preserving its grid row; never use display:none, which would reflow the exam while the keyboard is open.
- [x] Add data-student-exam-scroll-owner to the Reading/Writing passage and question panes and to the single-pane question surface. Extend useStudentFocusedControlVisibility.ts to recognize that explicit marker before its generic overflow-owner fallback.
- [x] Preserve document scroll at zero while editing. The focus-visibility hook must adjust only the nearest SAT pane and must leave the answer value, timer, and controller state untouched.
- [x] Extend the existing viewport-hook tests for focus-in, visualViewport resize, keyboard close, orientation change, and inactive cleanup. Add shell assertions for the stable-height style and keyboard data attribute.
- [x] Add an init-script visualViewport shim to the browser test. Focus the SPR input, shrink the fake visual viewport, dispatch resize, and assert: keyboard state is true; the shell height remains at its pre-keyboard value; document scrollY remains zero; the focused input is above the fake visual viewport bottom after pane scrolling; and the footer becomes visible again after restoring the viewport height.
- [x] Run the focused hook, shell, and browser tests in Chromium and WebKit.

~~~bash
bunx vitest run src/components/student/layout/__tests__/useStudentExamViewport.test.ts src/features/student-delivery/ui/SatExamShell.test.tsx --reporter=dot
bunx playwright test --config=playwright.sat-a11y.config.ts --project=chromium --project=webkit --workers=1 -g "software keyboard|visual viewport|SPR"
~~~

- [ ] Commit the viewport integration (not run; the user requested inline, uncommitted changes):

~~~bash
git add src/features/student-delivery/routes/SatStudentSessionRoute.tsx src/features/student-delivery/ui/SatExamShell.tsx src/features/student-delivery/ui/review/SatReviewPage.tsx src/features/student-delivery/ui/question/SatQuestionWorkspace.tsx src/features/student-delivery/ui/question/SatQuestionWorkspace.test.tsx src/components/student/layout/useStudentFocusedControlVisibility.ts src/index.css src/components/student/layout/__tests__/useStudentExamViewport.test.ts src/features/student-delivery/ui/SatExamShell.test.tsx src/app/router/dev/SatAccessibilityDebugRoute.tsx e2e/sat-student-accessibility.spec.ts
git commit -m "fix: apply SAT visual viewport keyboard policy"
~~~

**Task 4 verification recorded on 2026-09-16:**

- The viewport, SAT shell, and workspace suites passed: 3 files, 33 tests, including explicit scroll-owner markers and inactive-listener cleanup.
- The production build passed with 3,506 modules transformed.
- The focused Chromium/WebKit keyboard acceptance passed 2/2. It verifies that the real debug SPR control retains its value and timer, the shell height stays stable, document scroll remains zero, the pane scrolls the focused control into the visual viewport, the footer is hidden without `display:none`, and the footer returns after viewport restoration.
- SAT-scoped lint and the scoped diff check passed with no new findings. The expected harness log still reports `ECONNREFUSED 127.0.0.1:4000` for the unavailable auth-session backend.
- The debug-only SPR fixture/query was added as the prerequisite for this viewport acceptance test; SPR keyboard `inputMode`/validation behavior remains intentionally deferred to Task 5.
- Changes remain inline and uncommitted as requested; unrelated dirty-worktree changes were preserved.

### Task 5 — Make student-produced responses match the documented input contract

**Files:**

- Modify src/features/student-delivery/ui/question/SatStudentProducedAnswer.tsx.
- Modify src/features/student-delivery/ui/question/SatStudentProducedAnswer.test.tsx.
- Modify src/app/router/dev/SatAccessibilityDebugRoute.tsx.
- Modify e2e/sat-student-accessibility.spec.ts.

- [x] Add an SPR fixture to the debug route using the existing DeliveredQuestion contract:

~~~ts
const sprQuestion: DeliveredQuestion = {
  ...readingQuestion,
  examQuestionId: 'debug-spr-q1',
  questionId: 'debug-spr-question',
  questionType: 'student_produced_response',
  answer: {
    kind: 'student_produced_response',
    normalizeFraction: true,
    normalizeDecimal: true,
    numericTolerance: null,
  },
};
~~~

- [x] Add mode=spr selection in the harness, use sprQuestion when selected, initialize its response with debug-spr-question, and preserve the existing reading/math fixtures.
- [x] Change the SPR input to inputMode="text" so slash entry is available on mobile keyboards, add enterKeyHint="done", retain maxLength=6, and keep the wrapping label, help text, aria-invalid, and aria-describedby contract.
- [x] Add unit coverage for decimal, fraction, leading-minus, empty, and invalid blur states. Assert the input remains at least 44px high and that its accessible name is “Enter your answer”.
- [x] Add the browser check that a mobile SPR field accepts “1/2” without losing the slash or showing a false validation error. The acceptance test must not depend on a specific vendor keyboard layout; it verifies the browser input contract and the documented fraction behavior.
- [x] Run the focused tests on Chromium and touch-Chromium.

~~~bash
bunx vitest run src/features/student-delivery/ui/question/SatStudentProducedAnswer.test.tsx --reporter=dot
bunx playwright test --config=playwright.sat-a11y.config.ts --project=touch-chromium --workers=1 -g "SPR"
~~~

- [ ] Commit the SPR change (not run; the user requested inline, uncommitted changes):

~~~bash
git add src/features/student-delivery/ui/question/SatStudentProducedAnswer.tsx src/features/student-delivery/ui/question/SatStudentProducedAnswer.test.tsx src/app/router/dev/SatAccessibilityDebugRoute.tsx e2e/sat-student-accessibility.spec.ts
git commit -m "fix: make SAT SPR fraction entry mobile-safe"
~~~

**Task 5 verification recorded on 2026-09-16:**

- `SatStudentProducedAnswer.test.tsx` passed: 1 file, 7 tests covering decimal, fraction, leading-minus, empty, invalid blur, accessible name, input attributes, and the 48px height class.
- The new fraction acceptance passed in Chromium (1/1) and touch-Chromium (1/1). The touch-Chromium `-g "SPR"` run passed both SPR scenarios (2/2), including the keyboard-preservation regression.
- `bun run typecheck` passed and `bun run build` passed with 3,506 modules transformed.
- SAT-scoped ESLint and the scoped `git diff --check` passed with no new findings. The full dirty-tree diff check still reports unrelated existing blank lines at EOF in six other files.
- Browser runs emitted the expected `ECONNREFUSED 127.0.0.1:4000` auth-session proxy log because the optional auth backend is not running; the deterministic debug route remained usable and all targeted assertions passed.
- Changes remain inline and uncommitted as requested; unrelated dirty-worktree changes were preserved.

### Task 6 — Repair semantic question and dialog relationships

**Files:**

- Modify src/features/student-delivery/ui/question/SatQuestionHeader.tsx.
- Modify src/features/student-delivery/ui/primitives/SatPopoverShell.tsx.
- Modify src/features/student-delivery/ui/shell/SatDirectionsPopover.tsx.
- Modify src/features/student-delivery/ui/shell/SatExamTopBar.tsx.
- Modify src/features/student-delivery/ui/shell/SatExamFooter.tsx.
- Modify src/features/student-delivery/ui/shell/SatQuestionNavigator.tsx.
- Modify src/features/student-delivery/ui/SatPopoverShell.test.tsx.
- Create src/features/student-delivery/ui/__tests__/satAccessibilityContracts.test.tsx.
- Modify the existing SatQuestionHeader, SatPopoverShell, SatMoreMenu, and SatExamShell tests.
- Modify e2e/sat-student-accessibility.spec.ts.

- [x] Replace the question-number div with an h2 that exposes “Question N” through real heading text. Keep the visible number styling and do not retain aria-label on a generic div.
- [x] Add panelId?: string to SatPopoverShellProps and apply it to the role=dialog SatPresenceSurface root. Keep the close control and focus return behavior unchanged.
- [x] Pass the directions id as panelId and remove the id from the inner scrollable instruction div. The Directions button must control the dialog root, not a descendant.
- [x] Set aria-controls conditionally on the Directions and navigator triggers:

~~~tsx
aria-controls={open ? panelId : undefined}
~~~

Closed triggers must not expose a target that is not mounted. Open targets must have exactly one element with the id and the expected dialog role.
- [x] Keep the navigator id on its role=dialog root and assert its title relationship. Do not add a hidden duplicate target just to satisfy a closed aria-controls attribute.
- [x] Create a contract test that renders each closed and open state and asserts no dangling aria-controls, exactly one target when open, semantic heading text, and focus return to the trigger after Escape, outside click, and close-button activation.
- [x] Run axe-core against Directions, Display, Notes, Navigator, More, Reference, paused, and SPR states. Treat critical/serious violations as failures; record color-contrast as a manual token check if axe cannot resolve a custom property.

~~~bash
bunx vitest run src/features/student-delivery/ui/__tests__/satAccessibilityContracts.test.tsx src/features/student-delivery/ui/question/SatQuestionHeader.test.tsx src/features/student-delivery/ui/SatPopoverShell.test.tsx --reporter=dot
bunx playwright test --config=playwright.sat-a11y.config.ts --project=chromium --workers=1 -g "ARIA|axe|focus return"
~~~

- [ ] Commit the semantic contract:

~~~bash
git add src/features/student-delivery/ui/question/SatQuestionHeader.tsx src/features/student-delivery/ui/primitives/SatPopoverShell.tsx src/features/student-delivery/ui/shell/SatDirectionsPopover.tsx src/features/student-delivery/ui/shell/SatExamTopBar.tsx src/features/student-delivery/ui/shell/SatExamFooter.tsx src/features/student-delivery/ui/shell/SatQuestionNavigator.tsx src/features/student-delivery/ui/__tests__/satAccessibilityContracts.test.tsx src/features/student-delivery/ui/question/SatQuestionHeader.test.tsx src/features/student-delivery/ui/SatPopoverShell.test.tsx src/features/student-delivery/ui/shell/SatMoreMenu.test.tsx src/features/student-delivery/ui/SatExamShell.test.tsx e2e/sat-student-accessibility.spec.ts
git commit -m "fix: repair SAT question and dialog semantics"
~~~

**Task 6 verification recorded on 2026-09-16:**

- Semantic heading: the question-number cell is now an `h2` whose accessible name is “Question N” from real text (sr-only “Question ” prefix, visible glyph unchanged, no `aria-label` on a generic div). Every e2e query that used the removed `aria-label` (`page.getByLabel("Question N")`) was migrated to `getByRole("heading", { level: 2, name: "Question N" })`.
- Dialog relationships: `SatPopoverShell` accepts `panelId` and puts it on the `role=dialog` root; `SatDirectionsPopover` moved the public id from the inner scroll body to that root; the Directions and navigator triggers now set `aria-controls` only while open. The navigator id stays on its own dialog root and its `aria-labelledby` resolves to the visible `h2`.
- Focus-return gap closed: the shell documented “focus returns on EVERY close path” but only Escape and the close button restored it. Outside presses on non-interactive chrome now return focus to the trigger after the native focus change; presses on another control keep that control's focus (`satAccessibilityContracts.test.tsx` pins both).
- Contract suite added: `src/features/student-delivery/ui/__tests__/satAccessibilityContracts.test.tsx` (7 tests) covers semantic heading text, no dangling `aria-controls` while closed, exactly one target with the dialog role while open, the navigator title relationship, and focus return after Escape / outside press / close-button for both the popover shell and the navigator.
- axe gate: the offline harness now injects the installed `node_modules/axe-core/axe.min.js` (transitive via `eslint-plugin-jsx-a11y`; a missing build is an explicit harness failure) and fails on `critical`/`serious` impacts only. `color-contrast` stays a documented manual token check because SAT colors resolve through `var()` chains.
- axe finding (fixed): the focusable resize grip in `SatFloatingTool` was `role="separator"` with no `aria-valuenow`/`aria-valuemin`/`aria-valuemax` — a critical `aria-required-attr` violation. The grip now publishes `aria-orientation`, its min/max width bounds and `aria-valuenow`/`aria-valuetext` (width/height rect). Owning file: `src/features/student-delivery/ui/tools/SatFloatingTool.tsx`.
- axe finding (recorded, not fixed — Task 8 owner): the 24px `ne` corner resize zone covers the centre of the Reference Sheet's 32px close control. Measured 2026-09-16 at 1024x768 and 1194x834: close control 32x32, header 32px tall, `ne` zone 24x24 starting 20px from the window's right edge, and `document.elementFromPoint(centre)` returns the `ne` edge. A real click at the control's centre starts a resize instead of closing the sheet, and idle Escape on the Reference sheet is a deliberate no-op, so the toolbar trigger is currently the only reliable close path. Task 8's `SAT_REFERENCE_HEADER_HEIGHT` 32→44 change and 44px header controls move both the centre and the header out of that zone; re-verify with the close-button click in the Task 8/9 matrix.
- Gates: `satAccessibilityContracts.test.tsx`, `SatQuestionHeader.test.tsx`, `SatPopoverShell.test.tsx` and `SatExamShell.test.tsx` passed 4 files / 40 tests. The focused `ARIA|axe|focus return` command passed 3/3 in Chromium **and** 3/3 in WebKit. SAT-scoped ESLint reported 0 errors and only the pre-existing `SatFloatingTool.tsx:549` hook-dependency warning. `bun run typecheck` reports one unrelated pre-existing error in `services/authoring-coedit/src/persistence.ts` (user-owned coedit service, outside the SAT UI).
- Harness robustness added while verifying (kept inline, uncommitted): the axe scan retries once when a Vite HMR reload destroys the execution context, and `openSatHarness` allows 15s for the cold first mount (previously the first WebKit test of a run timed out at the default 5s).
- Full focused feature suite: `bunx vitest run src/features/student-delivery` reports 89 of 91 files passing (586 of 589 tests). The three failures live in user-owned in-flight work committed in `cb01e192` — `hooks/useSatExamController.ts` (+ the new untracked `useSatModuleEntry.ts`) failing two convergence tests, and `domain/satAnnotationsV2.test.ts` failing its null-like boundary repair — and none of the files Task 6 touched import them. They are reported here as a separate baseline, not folded into the SAT semantics result.
- Not touched on purpose: `shell/SatMoreMenu.test.tsx` — Task 6 changes no More-menu semantics; Task 7 owns that file, its roving tab index, and its browser keyboard coverage.
- Scope note: `src/features/student-delivery/ui/SatQuestionNavigator.tsx` needed no source change (its id was already on the dialog root); only assertions were added.

### Task 7 — Complete More-menu keyboard behavior

**Files:**

- Modify src/features/student-delivery/ui/shell/SatMoreMenu.tsx.
- Modify src/features/student-delivery/ui/shell/SatMoreMenu.test.tsx.
- Modify e2e/sat-student-accessibility.spec.ts.

- [ ] Keep role=menu and the existing disabled-state behavior. Add a roving tab index over enabled menu items: one item has tabIndex=0, the others have tabIndex=-1.
- [ ] Handle ArrowDown and ArrowUp with wraparound, Home to the first enabled item, End to the last enabled item, and Escape to close. Skip disabled Line Reader/Break items without moving focus onto them.
- [ ] Keep compact-only Tab wrapping and desktop non-modal Tab exit. On close, return focus to the More trigger on every close path.
- [ ] Add unit tests for initial focus, each navigation key, disabled-item skipping, Escape, compact Tab wrapping, desktop Tab exit, and focus return.
- [ ] Add a browser test at 390px and 1194px that exercises the menu entirely from the keyboard and verifies that no disabled menu item receives focus.

~~~bash
bunx vitest run src/features/student-delivery/ui/shell/SatMoreMenu.test.tsx --reporter=dot
bunx playwright test --config=playwright.sat-a11y.config.ts --project=chromium --workers=1 -g "More menu keyboard"
~~~

- [ ] Commit the menu behavior:

~~~bash
git add src/features/student-delivery/ui/shell/SatMoreMenu.tsx src/features/student-delivery/ui/shell/SatMoreMenu.test.tsx e2e/sat-student-accessibility.spec.ts
git commit -m "fix: make SAT More menu keyboard complete"
~~~

### Task 8 — Raise Reference Sheet header controls to the SAT touch target

**Files:**

- Modify src/features/student-delivery/domain/satToolSizePolicy.ts.
- Modify src/features/student-delivery/ui/tools/SatFloatingTool.tsx.
- Modify src/features/student-delivery/ui/tools/SatReferenceSheetPanel.tsx.
- Modify src/features/student-delivery/ui/tools/satToolPlacementRuntime.ts.
- Create src/features/student-delivery/ui/tools/satToolPlacementRuntime.test.ts.
- Modify src/index.css.
- Modify src/features/student-delivery/ui/tools/reference/SatReferenceSheet.test.tsx.
- Modify src/features/student-delivery/ui/tools/SatFloatingCoexistence.test.tsx.
- Modify e2e/sat-student-accessibility.spec.ts.

- [ ] Change the reference-only geometry constants from 32px to 44px: SAT_REFERENCE_HEADER_HEIGHT, the CSS --sat-ref-header-height token, and --sat-ref-control-hit. Keep Calculator on its existing 48px header contract.
- [ ] Change the reference header and both collapse/close buttons to h-11/min-h-11/w-11. The visual glyph may remain 16px or 24px; the hit area must be 44px.
- [ ] Change the collapsed-height fallback in SatFloatingTool.tsx from 32 to 44. Keep measured header height authoritative when available.
- [ ] Resolve the existing SAT-scoped SatFloatingTool hook-dependency warning while touching the component. Prefer a stable dependency; if the intentional identity boundary must remain, add the narrow reason at the hook site and cover the behavior with the placement tests.
- [ ] Keep the reference content-stage height calculation subtracting the same exported header-height constant so collapse/expand and fit calculations remain synchronized.
- [ ] Make readSatToolSafeArea measure .sat-exam-topbar and .sat-exam-footer rectangles first, then use the CSS token fallbacks when those elements are unavailable. This prevents a wrapped tablet header from placing a floating tool beneath the real chrome.
- [ ] Add pure runtime tests for measured chrome, token fallback, invalid measurements, and safe-area sums. Add browser assertions for 44px collapse/close rectangles at 640, 768, 1024, and 1194 pixels.
- [ ] Run reference unit and browser tests, including open/close, collapse/expand, resize, and persisted geometry.

~~~bash
bunx vitest run src/features/student-delivery/ui/tools/satToolPlacementRuntime.test.ts src/features/student-delivery/ui/tools/reference/SatReferenceSheet.test.tsx src/features/student-delivery/ui/tools/SatFloatingCoexistence.test.tsx --reporter=dot
bunx playwright test --config=playwright.sat-a11y.config.ts --project=chromium --project=webkit --workers=1 -g "reference header|Reference Sheet"
~~~

- [ ] Commit the touch-target and placement changes:

~~~bash
git add src/features/student-delivery/domain/satToolSizePolicy.ts src/features/student-delivery/ui/tools/SatFloatingTool.tsx src/features/student-delivery/ui/tools/SatReferenceSheetPanel.tsx src/features/student-delivery/ui/tools/satToolPlacementRuntime.ts src/features/student-delivery/ui/tools/satToolPlacementRuntime.test.ts src/index.css src/features/student-delivery/ui/tools/reference/SatReferenceSheet.test.tsx src/features/student-delivery/ui/tools/SatFloatingCoexistence.test.tsx e2e/sat-student-accessibility.spec.ts
git commit -m "fix: raise SAT reference controls to touch target"
~~~

### Task 9 — Exercise every SAT state surface at mobile sizes

**Files:**

- Modify src/app/router/dev/SatAccessibilityDebugRoute.tsx.
- Modify src/features/student-delivery/ui/review/SatReviewPage.tsx.
- Modify src/features/student-delivery/ui/transitions/SatDirectionsScreen.tsx.
- Modify src/features/student-delivery/ui/transitions/SatBreakScreen.tsx.
- Modify src/features/student-delivery/ui/transitions/SatCompleteScreen.tsx.
- Modify src/features/student-delivery/ui/transitions/SatDirectionsScreen.test.tsx.
- Modify src/features/student-delivery/ui/transitions/SatTransitionScreens.test.tsx.
- Modify src/features/student-delivery/ui/review/SatReviewPage.test.tsx.
- Modify e2e/sat-student-accessibility.spec.ts.

- [ ] Add a surface query to the debug route for directions, break, review, complete, error, loading, and terminated fixtures. Keep the existing default shell fixture and do not add production-only state branches outside the dev route.
- [ ] Make the review root use min-width:0 and the stable height prop. Allow its header to wrap below 420px, keep the timer cluster from shrinking, and stack footer actions when the available inline size cannot contain both buttons.
- [ ] Make Directions, Break, Complete, and Terminated content wrappers use w-full/min-w-0, safe-area padding, break-words, and flex-wrap actions. Buttons must remain visible, focusable, and at least 44px high when the H1/body text reaches the 200% test scale.
- [ ] Extend the existing transition/review unit tests for narrow labels, long module names, paused/error copy, no action callback, and safe focus order.
- [ ] Add a browser matrix over all surfaces at 320x568, 390x844, 640x900, 768x1024, and 1024x768. Apply the same 200% SAT token scale used by the existing test, then assert viewport containment, no document horizontal overflow, visible focus, enabled targets >=44px, and axe-core no critical/serious violations.
- [ ] Run the surface suite in Chromium, WebKit, and touch-Chromium. Any failure must be fixed in the owning surface component rather than by weakening the shared geometry helper.

~~~bash
bunx vitest run src/features/student-delivery/ui/review/SatReviewPage.test.tsx src/features/student-delivery/ui/transitions/SatDirectionsScreen.test.tsx src/features/student-delivery/ui/transitions/SatTransitionScreens.test.tsx --reporter=dot
bunx playwright test --config=playwright.sat-a11y.config.ts --project=chromium --project=webkit --project=touch-chromium --workers=1 -g "state surface|directions|break|review|complete"
~~~

- [ ] Commit the state-surface hardening:

~~~bash
git add src/app/router/dev/SatAccessibilityDebugRoute.tsx src/features/student-delivery/ui/review/SatReviewPage.tsx src/features/student-delivery/ui/transitions/SatDirectionsScreen.tsx src/features/student-delivery/ui/transitions/SatBreakScreen.tsx src/features/student-delivery/ui/transitions/SatCompleteScreen.tsx src/features/student-delivery/ui/transitions/SatDirectionsScreen.test.tsx src/features/student-delivery/ui/transitions/SatTransitionScreens.test.tsx src/features/student-delivery/ui/review/SatReviewPage.test.tsx e2e/sat-student-accessibility.spec.ts
git commit -m "fix: harden SAT state surfaces on mobile"
~~~

### Task 10 — Make the browser harness deterministic

**Files:**

- Modify e2e/sat-student-accessibility.spec.ts.
- Modify playwright.sat-a11y.config.ts.

- [ ] Route the AuthSessionProvider session request in the offline accessibility harness to the exact unauthenticated/fixture response shape already consumed by src/features/auth/authSession.tsx. Do not rely on a backend at 127.0.0.1:4000 for pure layout, semantics, or input tests.
- [ ] Keep external Desmos/network-dependent checks out of the offline geometry profile, or explicitly route them into a separately named network profile. The core profile must not fail because an iframe vendor is unavailable.
- [ ] Run each browser project with workers=1 for the final deterministic signal. Do not treat the previous concurrent full-suite 45-pass/35-fail result as a product verdict; it was contaminated by proxy, external URL, and overloaded-server failures.
- [ ] Add a test failure message that distinguishes viewport geometry, accessibility semantics, network fixture, and external-tool failures. This is required so future audits do not mask a product failure behind harness noise.
- [ ] Run the entire deterministic profile:

~~~bash
bunx playwright test --config=playwright.sat-a11y.config.ts --project=chromium --project=webkit --project=touch-chromium --workers=1
~~~

- [ ] Commit only harness/config changes:

~~~bash
git add e2e/sat-student-accessibility.spec.ts playwright.sat-a11y.config.ts src/app/router/dev/SatAccessibilityDebugRoute.tsx
git commit -m "test: make SAT accessibility browser checks deterministic"
~~~

### Task 11 — Run the final scorecard and manual mobile acceptance

**Files:** no new production files; update the implementation notes or release checklist with actual results.

- [ ] Run the complete SAT unit suite and SAT-scoped lint/build:

~~~bash
bunx vitest run src/features/student-delivery --reporter=dot
bunx eslint --max-warnings=0 src/features/student-delivery/ui src/features/student-delivery/routes/SatStudentSessionRoute.tsx
bun run build
~~~

- [ ] Run the deterministic cross-browser profile:

~~~bash
bunx playwright test --config=playwright.sat-a11y.config.ts --project=chromium --project=webkit --project=touch-chromium --workers=1
~~~

- [ ] Run git diff --check and confirm all new tests are included in the intended SAT profile. Run bun run typecheck and bun run lint again; if the unrelated user-owned failures remain, report their exact files and keep them separate from the SAT score.
- [ ] Test manually on iOS Safari with VoiceOver and Android Chrome with TalkBack:
  - enter and edit an SPR answer, including a/b;
  - open and close Directions, Display, Notes, Navigator, More, and Reference;
  - navigate More with arrows and Escape;
  - use 200% text or OS text enlargement;
  - rotate portrait/landscape;
  - open the software keyboard and confirm the focused field stays visible;
  - verify focus rings, announcements, button names, and return focus;
  - confirm no page-level horizontal scroll or off-screen action exists.
- [ ] Complete the scorecard with measured evidence. Mark an area 10/10 only when its automated and manual gates pass; retain any failed area with the exact failing selector, viewport, browser, and owner file.

## 5. Final handoff

The implementation is complete only when the saved plan is fully checked off, all SAT-scoped gates pass, the cross-browser evidence is reproducible, and the manual mobile assistive-technology checks are recorded. If a root repository gate remains red because of the pre-existing user-owned browser probes or unrelated fixtures, state that limitation explicitly rather than claiming whole-repository 10/10.
