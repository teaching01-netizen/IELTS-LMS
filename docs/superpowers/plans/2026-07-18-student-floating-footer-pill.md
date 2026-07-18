# Student Floating Footer Pill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the in-flow full-width student exam footer with one CSS-owned floating navigation pill across Reading, Listening, and Writing.

**Architecture:** Keep both existing footer renderers and their behavior, but give their shared `.student-exam-footer` class one fixed overlay contract. Reduce the exam shell to header/workspace rows and reserve bottom space on the workspace so the overlay cannot cover the final answer controls. Do not introduce JavaScript geometry, keyboard detection, portals, or browser-specific branches.

**Tech Stack:** React 18, TypeScript, Tailwind CSS 4, CSS Grid/fixed positioning, Vitest/Testing Library, Playwright

---

## File Map

- Modify `src/index.css`: define the two-row shell, floating-pill placement, safe-area insets,
  bottom content reserve, and stepper clearance.
- Modify `src/components/student/StudentFooter.tsx`: remove full-width bar presentation utilities
  now owned by the shared footer CSS contract while retaining objective navigation behavior.
- Modify `src/components/student/StudentWriting.tsx`: apply the same presentation contract to the
  Writing footer without changing draft commits or submission behavior.
- Modify `src/components/student/__tests__/StudentViewportCss.test.ts`: encode the fixed pill and
  prohibit restoration of an in-flow footer track.
- Modify `src/components/student/__tests__/StudentFooterRepresentative.test.tsx`: preserve the
  objective footer landmark, shared class, navigation, and horizontal row contract.
- Modify `src/components/student/__tests__/StudentWriting.a11y.test.tsx`: preserve the Writing
  footer landmark and shared class.
- Modify `e2e/student-ipad-layout.spec.ts`: assert inset pill geometry in the real exam layout.
- Modify `docs/ux-invariants.md`: replace the in-flow footer invariant with the overlay contract.
- Modify `docs/failure-cases.md`: record why a floating footer replaced the footer grid row.

## Must Not Break

- Header rendering and positioning are unchanged.
- Reading, Listening, and Writing navigation actions retain their current handlers and labels.
- Writing task switches still commit the active editor draft before navigation.
- Answer persistence, autosave, submit review, timers, integrity events, and audits are untouched.
- Footer contents remain horizontally reachable at narrow widths.
- The workspace reserves enough bottom space that the final answer control is not obscured.

### Task 1: Encode the Floating Footer Contract

**Files:**
- Modify: `src/components/student/__tests__/StudentViewportCss.test.ts`
- Modify: `src/components/student/__tests__/StudentFooterRepresentative.test.tsx`
- Modify: `src/components/student/__tests__/StudentWriting.a11y.test.tsx`

- [ ] **Step 1: Change the structural CSS expectation to a two-row shell and fixed pill**

Update the viewport CSS test so it requires:

```ts
expect(shellRule).toMatch(
  /grid-template-rows:\s*auto\s+minmax\(0,\s*1fr\)\s*;/,
);
expect(shellRule).not.toMatch(/minmax\(0,\s*1fr\)\s+auto/);
expect(mainRule).toMatch(/padding-block-end:\s*var\(--student-exam-footer-reserve\)\s*;/);
expect(footerRule).toMatch(/position:\s*fixed\s*;/);
expect(footerRule).toMatch(/border-radius:\s*9999px\s*;/);
expect(footerRule).toMatch(/safe-area-inset-bottom/);
expect(footerRule).not.toMatch(/position:\s*sticky\s*;/);
```

- [ ] **Step 2: Require the shared footer row contract in both renderers**

In the objective representative test, retain the existing `.student-exam-footer` landmark
assertion and require the row to have horizontal overflow:

```ts
expect(screen.getByTestId('student-footer-row')).toHaveClass('overflow-x-auto');
```

In the Writing accessibility test, retain the shared `.student-exam-footer` class assertion and
require its navigation row by test id:

```ts
expect(within(footer).getByTestId('student-writing-footer-row')).toHaveClass('overflow-x-auto');
```

- [ ] **Step 3: Run the focused tests and verify RED**

Run:

```bash
npx vitest run \
  src/components/student/__tests__/StudentViewportCss.test.ts \
  src/components/student/__tests__/StudentFooterRepresentative.test.tsx \
  src/components/student/__tests__/StudentWriting.a11y.test.tsx
```

Expected: FAIL because the shell still has a footer track, the footer is not fixed/pill-shaped, and
the objective and Writing footer rows do not yet expose the required overflow contracts.

### Task 2: Implement the Shared Floating Pill

**Files:**
- Modify: `src/index.css`
- Modify: `src/components/student/StudentFooter.tsx`
- Modify: `src/components/student/StudentWriting.tsx`

- [ ] **Step 1: Remove component-local full-width bar presentation**

Keep `.student-exam-footer`, role, labels, handlers, and maximum-height rules. Remove `border-t`,
`bg-white`, and the full-width bar shadow utilities from both footer class lists because CSS now
owns the shared surface.

- [ ] **Step 2: Make both navigation rows natively horizontally scrollable**

Give the objective row:

```tsx
className={`flex items-center gap-2 overflow-x-auto overscroll-x-contain ...`}
```

Give the Writing row:

```tsx
data-testid="student-writing-footer-row"
className="flex w-full items-center gap-2 overflow-x-auto overscroll-x-contain ..."
```

Do not reorder interactive controls.

- [ ] **Step 3: Replace the footer grid row with the fixed pill contract**

In `src/index.css`, define footer sizing variables on `.student-exam-shell`, change the grid to two
rows, reserve bottom space on `.student-exam-main`, and style `.student-exam-footer` with fixed
positioning, logical/physical safe-area insets, bounded width, opaque white background, full rounded
corners, border, clipping, and elevation. Raise `.student-question-stepper` above the pill reserve.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run the Task 1 Vitest command. Expected: all selected test files pass.

### Task 3: Add Browser Geometry Regression and Memory

**Files:**
- Modify: `e2e/student-ipad-layout.spec.ts`
- Modify: `docs/ux-invariants.md`
- Modify: `docs/failure-cases.md`

- [ ] **Step 1: Assert inset pill geometry in the iPad layout test**

For the visible student footer, use `boundingBox()` and the page viewport to assert:

```ts
expect(footerBox).not.toBeNull();
expect(footerBox!.x).toBeGreaterThan(0);
expect(viewport!.width - footerBox!.x - footerBox!.width).toBeGreaterThan(0);
expect(viewport!.height - footerBox!.y - footerBox!.height).toBeGreaterThanOrEqual(0);
```

Keep existing header, pane, and orientation assertions unchanged.

- [ ] **Step 2: Update UX invariants**

Document that the shell is now two rows, the footer is the only fixed bottom navigation overlay,
the workspace owns the corresponding reserve, and no JavaScript may publish footer geometry.

- [ ] **Step 3: Record the failure case**

Add a dated failure note describing why an in-flow footer track was vulnerable after keyboard
dismissal and why fixed CSS placement was selected instead of another viewport state machine.

### Task 4: Verify the Footer-Only Change

**Files:**
- Test: `src/components/student/__tests__/StudentViewportCss.test.ts`
- Test: `src/components/student/__tests__/StudentFooterRepresentative.test.tsx`
- Test: `src/components/student/__tests__/StudentWriting.a11y.test.tsx`
- Test: `src/components/student/__tests__/StudentExamWorkspace.test.tsx`
- Test: `src/components/student/__tests__/StudentApp.test.tsx`
- Test: `e2e/student-ipad-layout.spec.ts`

- [ ] **Step 1: Run the focused footer and workspace suite**

```bash
npx vitest run \
  src/components/student/__tests__/StudentViewportCss.test.ts \
  src/components/student/__tests__/StudentFooterRepresentative.test.tsx \
  src/components/student/__tests__/StudentWriting.a11y.test.tsx \
  src/components/student/__tests__/StudentExamWorkspace.test.tsx
```

Expected: all selected tests pass.

- [ ] **Step 2: Run the StudentApp integration suite**

```bash
npx vitest run src/components/student/__tests__/StudentApp.test.tsx
```

Expected: no new failures. If the known unrelated sibling-slot fixture failure remains, reproduce it
on unchanged `main` and report it separately.

- [ ] **Step 3: Run static and production checks**

```bash
npm run lint
npm run build
```

Expected: ESLint exits with zero errors and the production build exits zero.

- [ ] **Step 4: Run the iPad browser test when its environment is available**

```bash
npx playwright test e2e/student-ipad-layout.spec.ts
```

Expected: the layout scenario passes. If required environment configuration is unavailable, report
the exact missing prerequisite without claiming browser verification.
