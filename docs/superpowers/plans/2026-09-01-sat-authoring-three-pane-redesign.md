# SAT authoring three-pane workspace redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize the Digital SAT authoring UI into a clear question rail, active-question canvas, and contextual inspector without changing question data, scoring, autosave, import, preview, or release behavior.

**Architecture:** Keep `AuthoringWorkspace` as the orchestration boundary and preserve existing question editors. Add a focused inspector presentation around the existing `QuestionProperties` and validation contracts, while moving the current inline metadata treatment into the inspector. The center pane continues to render one selected `QuestionRevision`; the left rail remains responsible for navigation and bulk operations.

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4, Motion, Radix primitives already present in the repository, Lucide icons, Vitest, Testing Library, Playwright where needed.

---

## File map before implementation

- Modify `src/features/exam-authoring/ui/AuthoringWorkspace.tsx`: compose the three panes, own inspector open/section UI state, and pass existing callbacks/data.
- Modify `src/features/exam-authoring/ui/QuestionEditor.tsx`: make the center canvas the primary editing surface and remove duplicated metadata presentation from the canvas header.
- Modify `src/features/exam-authoring/ui/QuestionListPane.tsx`: refine rail hierarchy and preserve existing search, filtering, selection, reorder, and bulk actions.
- Modify `src/features/exam-authoring/ui/QuestionProperties.tsx`: reuse its field controls in the inspector with accessible labels and existing update behavior.
- Create `src/features/exam-authoring/ui/QuestionInspectorPane.tsx`: render Content, Answer key, and Validation sections for the selected question.
- Modify `src/index.css`: add only scoped layout/responsive rules that Tailwind utilities cannot express cleanly; reuse current SAT authoring tokens.
- Add tests beside the affected UI files under `src/features/exam-authoring/ui/__tests__/`.

Before touching code, use AST tooling (`ast-grep` or TypeScript/LSP indexer) to map definitions and call sites for `AuthoringWorkspace`, `QuestionEditor`, `QuestionListPane`, `QuestionProperties`, and `AssessmentValidationIssue`. Record the result in the implementation notes or PR description. Do not change exported signatures until all consumers are identified.

## Task 1: Add failing tests for the three-pane contract

**Files:**
- Create: `src/features/exam-authoring/ui/__tests__/QuestionInspectorPane.test.tsx`
- Create: `src/features/exam-authoring/ui/__tests__/AuthoringWorkspace.test.tsx`.

- [ ] **Step 1: Create a representative SAT `QuestionRevision` fixture using the existing assessment contract.**

The fixture must include a prompt, four single-choice options, a selected correct option, section metadata, and a missing domain so the inspector can show both answer and validation states. Import the real types; do not duplicate a parallel type.

- [ ] **Step 2: Write failing tests for inspector sections and accessible state.**

Cover these behaviors:

```tsx
it('renders content, answer key, and validation sections for the active question', () => {
  render(<QuestionInspectorPane question={fixture} onChange={vi.fn()} issues={issues} />);
  expect(screen.getByRole('region', { name: /question inspector/i })).toBeInTheDocument();
  expect(screen.getByText('Content')).toBeInTheDocument();
  expect(screen.getByText('Answer key')).toBeInTheDocument();
  expect(screen.getByText('Validation')).toBeInTheDocument();
});

it('announces blocking issues with text and an icon', () => {
  render(<QuestionInspectorPane question={fixture} onChange={vi.fn()} issues={[blockingIssue]} />);
  expect(screen.getByText(/answer key missing/i)).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent(/needs attention/i);
});
```

- [ ] **Step 3: Write failing workspace tests for inspector visibility.**

Mock the existing authoring queries at the same boundary used by current tests. Assert that desktop rendering includes `QuestionListPane`, the active editor, and the inspector; assert that an inspector toggle has an accessible name and changes `aria-expanded`.

- [ ] **Step 4: Run the focused tests and verify they fail for the missing inspector/layout behavior.**

Run:

```bash
npx vitest run src/features/exam-authoring/ui/__tests__/QuestionInspectorPane.test.tsx src/features/exam-authoring/ui/__tests__/AuthoringWorkspace.test.tsx
```

Expected: FAIL because the inspector component and workspace integration are not yet implemented.

## Task 2: Build the inspector as a focused composition component

**Files:**
- Create: `src/features/exam-authoring/ui/QuestionInspectorPane.tsx`
- Modify: `src/features/exam-authoring/ui/QuestionProperties.tsx` only if shared props/labels need extraction.

- [ ] **Step 1: Define the component contract using existing assessment types.**

Use this shape:

```ts
export interface QuestionInspectorPaneProps {
  question: QuestionRevision;
  issues: AssessmentValidationIssue[];
  activeSection: 'content' | 'answers' | 'validation';
  onSectionChange: (section: 'content' | 'answers' | 'validation') => void;
  onChange: (question: QuestionRevision) => void;
  onClose?: () => void;
}
```

Do not add question persistence or fetching to this component.

- [ ] **Step 2: Compose the Content section from `QuestionProperties`.**

Keep domain, skill, difficulty, tags, and SAT section behavior identical. Use the existing segmented control and field tokens. The section must have a real heading and a semantic region.

- [ ] **Step 3: Add the Answer key section using the existing answer contract.**

For `single_choice`, render choices A–D as buttons with `aria-pressed`, the current key, and an explicit “Correct answer” label. For `student_produced_response`, render accepted responses through the existing `SatStudentResponseEditor` or an existing shared answer editor path. All mutations must call `onChange` and remain compatible with autosave in `AuthoringWorkspace`.

- [ ] **Step 4: Add the Validation section.**

Render blocking errors before warnings. Each issue must show an icon and text, and actionable issues must be buttons that call an optional field-focus callback or use the existing workspace issue-navigation path. Empty state text must be `No blocking issues` when there are no blocking issues. Use `role="status"` for the summary only when it is not redundant with an existing live region.

- [ ] **Step 5: Add responsive and keyboard behavior.**

Use a semantic `aside`/region, a labeled close button on compact layouts, visible focus rings, and the existing `sat-dialog`/Radix pattern if the inspector becomes a sheet. Avoid custom focus traps. Respect reduced motion and forced colors through existing scoped rules.

- [ ] **Step 6: Run inspector tests and typecheck.**

Run:

```bash
npx vitest run src/features/exam-authoring/ui/__tests__/QuestionInspectorPane.test.tsx
npm run typecheck
```

Expected: focused inspector tests PASS and TypeScript reports no new errors.

- [ ] **Step 7: Commit the isolated inspector composition.**

```bash
git add src/features/exam-authoring/ui/QuestionInspectorPane.tsx src/features/exam-authoring/ui/QuestionProperties.tsx src/features/exam-authoring/ui/__tests__/QuestionInspectorPane.test.tsx
git commit -m "feat: add SAT authoring question inspector"
```

## Task 3: Integrate the inspector and clarify the three-pane hierarchy

**Files:**
- Modify: `src/features/exam-authoring/ui/AuthoringWorkspace.tsx`
- Modify: `src/features/exam-authoring/ui/QuestionEditor.tsx`
- Modify: `src/features/exam-authoring/ui/QuestionListPane.tsx`
- Modify: `src/features/exam-authoring/ui/__tests__/AuthoringWorkspace.test.tsx`
- Create: `src/features/exam-authoring/ui/__tests__/QuestionEditor.test.tsx`
- Create: `src/features/exam-authoring/ui/__tests__/QuestionListPane.test.tsx`

- [ ] **Step 1: Add UI-only inspector state to `AuthoringWorkspace`.**

Add:

```ts
const [inspectorOpen, setInspectorOpen] = useState(true);
const [activeInspectorSection, setActiveInspectorSection] = useState<'content' | 'answers' | 'validation'>('content');
```

Reset the active inspector section to `content` when the selected question changes. Do not put this in the server-backed question state.

- [ ] **Step 2: Derive selected-question issues from the existing validation contract.**

Use the current question validation/readiness data and existing `validateSatQuestion` helper. Filter issues by the selected question id/path before passing them to the inspector. Do not run a second network validation request for every selection.

- [ ] **Step 3: Render the inspector as the third pane.**

Place it after the editor canvas in the existing `authoring-workspace` flex layout. The editor remains `min-w-0 flex-1`; the inspector gets a stable desktop width and can collapse. Add a labeled toggle in the workspace top bar or inspector header with `aria-expanded` and `aria-controls`.

- [ ] **Step 4: Remove duplicated metadata emphasis from `QuestionEditor`.**

Keep question number, readiness, save state, and primary editing controls in the center canvas. Move domain, skill, difficulty, and tags emphasis to the inspector. Preserve the existing `data-authoring-field` anchors used by issue deep links; if a field moves, retain the anchor on the inspector control.

- [ ] **Step 5: Reduce rail competition.**

Preserve search, readiness filters, add question, import, reorder, and bulk operations. Keep `Add question` as the only filled creation action. Move infrequent actions behind existing menus where possible. Do not remove functionality or change mutation callbacks.

- [ ] **Step 6: Implement compact-width behavior.**

At the existing responsive breakpoint, collapse the inspector into a sheet/drawer or an explicitly toggled panel while leaving the question editor usable. Do not create a new modal primitive; compose the existing Radix/dialog pattern if a sheet is required.

- [ ] **Step 7: Run workspace tests.**

Run:

```bash
npx vitest run src/features/exam-authoring/ui/__tests__/AuthoringWorkspace.test.tsx src/features/exam-authoring/ui/__tests__/QuestionEditor.test.tsx src/features/exam-authoring/ui/__tests__/QuestionListPane.test.tsx
```

Expected: existing behavior tests and new pane tests PASS.

- [ ] **Step 8: Commit the layout integration.**

```bash
git add src/features/exam-authoring/ui/AuthoringWorkspace.tsx src/features/exam-authoring/ui/QuestionEditor.tsx src/features/exam-authoring/ui/QuestionListPane.tsx src/features/exam-authoring/ui/__tests__/
git commit -m "feat: establish SAT authoring three-pane hierarchy"
```

## Task 4: Apply scoped visual polish and accessibility verification

**Files:**
- Modify: `src/index.css` only for rules not expressible with existing Tailwind utilities.
- Create: `src/features/exam-authoring/ui/__tests__/AuthoringAccessibility.test.tsx`.

- [ ] **Step 1: Add scoped pane rules using existing SAT authoring tokens.**

Define only `.sat-authoring` rules for inspector width, pane separators, compact sheet behavior, and canvas/rail overflow. Reuse `--au-*`, `--authoring-*`, and existing elevation variables. Do not introduce gradients, new accent colors, or global selectors.

- [ ] **Step 2: Verify accessibility states in tests.**

Cover:

```tsx
it('marks the selected question as current', () => {
  expect(screen.getByRole('button', { name: /question 3/i })).toHaveAttribute('aria-current', 'true');
});

it('keeps inspector toggle keyboard discoverable', () => {
  const toggle = screen.getByRole('button', { name: /question inspector/i });
  expect(toggle).toHaveAttribute('aria-controls', 'sat-question-inspector');
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
});
```

Also verify issue states include text, focus rings are not disabled, and coarse-pointer controls preserve the existing 44px minimum through the SAT product rules.

- [ ] **Step 3: Run formatting, lint, typecheck, and focused tests.**

Run:

```bash
npm run lint
npm run typecheck
npx vitest run src/features/exam-authoring/ui src/features/exam-authoring/hooks
npm run build
```

Expected: all commands exit 0. If the repository has pre-existing failures, capture the exact baseline failure and ensure the changed files add no new failures.

- [ ] **Step 4: Perform AST and dependency audit.**

Re-run symbol queries for `QuestionInspectorPane`, `QuestionEditor`, `QuestionProperties`, and `AuthoringWorkspace`. Confirm exports/imports resolve, no old metadata prop is dangling, and no new circular dependency was introduced.

- [ ] **Step 5: Inspect the responsive surface manually.**

Run the development server and inspect at wide desktop, medium width, and narrow mobile widths. Verify the active question remains visible, inspector collapse is reversible, and no horizontal scroll is introduced except where intentionally supported.

- [ ] **Step 6: Commit the verified polish.**

```bash
git add src/index.css src/features/exam-authoring/ui/__tests__/
git commit -m "test: verify SAT authoring hierarchy and accessibility"
```

## Final verification checklist

- [ ] Three panes are visually distinct: navigation, active editor, inspector.
- [ ] Only the selected question is the primary editing surface.
- [ ] Add question is the dominant creation action.
- [ ] Content, answer key, and validation are available in the inspector.
- [ ] Existing autosave, import, preview, release, duplicate, delete, reorder, and bulk actions still work.
- [ ] Selected question has `aria-current` and visible non-color selection treatment.
- [ ] Validation states use icon plus text and preserve inline field focus behavior.
- [ ] Responsive, keyboard, reduced-motion, reduced-transparency, forced-colors, and touch behavior remain supported.
- [ ] No unrelated files are staged or committed; preserve the repository's existing uncommitted work.
