# Phase 05 — Inspector (classification and settings leave the canvas)

## 1. Objective

Move every non-authoring property off the canvas into a **contextual inspector** that opens only when asked:

- Classification (domain · skill · difficulty · tags) → inspector panel.
- Item settings (question type, pretest flag if exposed, accessibility long description) → inspector panel.
- The canvas becomes pure content (Phase 04 already removed classification's *card*; this phase removes it entirely).
- Issue jumps for classification fields open the inspector and focus the field.
- The inspector animates in without covering the canvas and preserves the editing position.

## 2. Dependencies

- Requires: Phase 02 (shell slots), Phase 04 (canvas no longer owns classification presentation).
- Blocks: Phase 07 (keyboard/palette includes "Go to classification").
- Owns: new `spine/Inspector.tsx`, `spine/ClassificationInspector.tsx`, `spine/ItemSettingsInspector.tsx`, `spine/SpineLayout.tsx` (inspector slot), `AuthoringWorkspace.tsx` (**inspector wiring window**), inspector tests.
- Does **not** own: `ClassificationFieldset.tsx` internals (reused as-is; only its wrapper/labels may be adjusted), `spine/readinessFamilies.ts` (Phase 04).

## 3. Current state (verified)

```text
ClassificationFieldset.tsx
  - <fieldset> with <legend> "Classification"
  - data-authoring-field="domain" and ="skill" wrappers
  - Domain <select>, Skill <select>, Difficulty radiogroup, Tags input
  - Renders inline blocking issues for domain/skill (from props.issues)
  - class: spine-card (a bordered card)      <-- the container Phase 04 kept, Phase 05 removes
  - Behaviour contracts pinned by tests:
      "pairs every control with a visible label" (getByLabelText Domain / Skill / Tags, radiogroup Difficulty)
      "clears an incompatible skill when the domain changes" (onChange called once, skill null)
      "keeps a compatible skill when the domain still contains it"
      "surfaces blocking domain/skill issues inline"

SpineLayout.tsx
  <div className="sat-spine">
    {header} {banner}
    <div className="sat-spine__body">
      <div className="sat-spine__queue">{queue}</div>
      <main className="sat-spine__main"><div className="sat-spine__column">{children}</div></main>
    </div>
    {footer}
  </div>
  -> no inspector slot today; .sat-spine__body is a 2-column flex (queue + main)

spine.css
  .sat-spine__body { display: flex; ... }
  .sat-spine__queue { flex: 0 0 var(--spine-rail-width); }
  .sat-spine__main  { flex: 1; overflow-y: auto; }
  (Phase 01 adds --spine-inspector-width: 304px)

Accessibility metadata: QuestionRevision.accessibility = { longDescription: string | null }
  — persisted in the contract, currently editable nowhere in the spine.
  Item "pretest": AssessmentQuestionSummary.isPretest exists (read-only in the rail today).
```

## 4. Behavioral contract

- `ClassificationFieldset` keeps every control, label, behaviour and inline-error rule it has today. Only its container and surrounding chrome change.
- `data-authoring-field="domain"` and `data-authoring-field="skill"` must resolve **whenever the inspector is open**. When it is closed and an issue jump targets them, the jump must open the inspector **first**, then focus. Implementation: the workspace's focus effect already runs after render; it must set inspector state before `setFocusField`, or the anchor lookup retries on the next frame.
  - **Decision: make the focus effect retry-aware** — extract a tiny helper `focusAuthoringField(field, attempts = 3)` that rAF-retries up to 3 frames. Rationale: opening an animated panel means the anchor may not exist on the first frame; a bounded retry is simpler and more honest than guessing animation timing. This helper is additive and used only by the inspector path.
- No new persistence: `longDescription` already exists in the contract; the editor writes it through the existing `onChange` → autosave path. No contract change (AC-19).
- Opening/closing the inspector never changes the selected question, the draft, or the scroll position of the canvas.
- Escape closes the inspector when focus is inside it and no other overlay is open (`useOverlayStack` contract: the inspector is a **panel**, not a dialog, so it does not consume the dialog slot).
- The inspector is not a modal: the canvas stays interactive (direct manipulation).

## 5. Design decisions

- **5.1 Panel, not dialog.** A 304px right-hand column inside `.sat-spine__body` with `role="region"` + `aria-label="Inspector"`. Rationale: spec §2 (three-zone layout) and §29 (canvas adapts, inspector slides in). Rejected: a Radix Sheet (modal, blocks the canvas, uses the overlay stack).
- **5.2 Animation.** Width + opacity, 220ms, `ease-out` entering / `ease-in` leaving, using the existing `authoringMotion.panel` token. The canvas column width animates via the flex layout (the panel is a sibling), so the text reflows rather than being covered — that is the "canvas adapts" requirement.
  - **Decision: do not animate the canvas content's opacity.** Reflow already communicates the change; animating text opacity hurts readability.
  - Reduced motion: instant show/hide (existing `MotionConfig reducedMotion="user"` at the SAT root + the CSS reduced-motion block).
- **5.3 Entry points (all four must work).**
  ```text
  1. Canvas question header  ···  menu  -> "Question settings"
  2. Canvas question header          -> a small "Settings" text button (visible, quiet) on >=1024px
  3. Readiness popover item "Difficulty is missing" -> opens inspector + focuses domain/skill/difficulty
  4. Keyboard: Cmd/Ctrl + Shift + S (documented in Phase 07's shortcut help)
  ```
  - **Decision: two visible entry points (menu + text button).** Rationale: the spec asks for progressive disclosure, not for hiding configuration so thoroughly that nobody finds it. The text button is 12px muted, right-aligned next to `···` — quiet but discoverable.
  - ⚠️ Keyboard conflict: ⌘S is "flush autosave" (existing, AC-14). `⌘⇧S` is unused today (grep confirms). Document it in Phase 07.
- **5.4 Content.** Two stacked groups with hairline separation:
  ```text
  Inspector
  ───────────────────────────────
  Classification
    Domain        [select]
    Skill         [select]
    Difficulty    [Easy | Medium | Hard]
    Tags          [input]
  ───────────────────────────────
  Question settings
    Response type  [Multiple choice | Student-produced response]   (read-only summary)
    Accessibility
      Long description   [textarea]
  ```
  - **Decision: the response-type control stays on the canvas (Answer section), and the inspector shows a read-only summary.** Rationale: switching response type is a content decision that belongs next to the answer (spec §17), and duplicating a destructive control in two places is exactly the duplication the spec removes. The inspector states the current type so the panel is not surprising.
  - **Decision: the difficulty radiogroup keeps its existing 44px control geometry** (it is already a radiogroup with visible labels).
  - **Decision: the long-description editor is added here.** Rationale: the field is persisted, validated nowhere, and currently unreachable — an accessibility field that cannot be edited is a defect. Adding it in the inspector keeps the canvas clean (spec §2/§11) and does not change the contract.
    - Guard: it must NOT introduce new blocking validation (that would change publish gating). It is written as optional with helper text. Rationale: AC-17 (release gate unchanged).
- **5.5 Inspector header.** Title "Inspector" is replaced by a **contextual title**: "Question settings" — one heading, plus a close button (`X`, `aria-label="Close inspector"`). No tabs, no second-level navigation (spec §1).
- **5.6 Width behaviour.** `--spine-inspector-width: 304px`; at ≤1280px the inspector **overlays** the navigator (it replaces the queue column) instead of squeezing the canvas; at ≤1024px it becomes a full-height overlay sheet on the right with a scrim. Rationale: spec §39 (do not squeeze three panels into narrow widths).
  - **Decision: implement the responsive behaviour with CSS only** (media queries in `spine.css` toggling `position`/`z-index`), so the component tree stays simple and there is no JS breakpoint state to test.
- **5.7 Issue visibility.** When the inspector is closed and a classification issue exists, the canvas still communicates it (the readiness control counts it, and the inline error row appears in the **canvas header area**, not in a section). Rationale: AC-06 — the user must never have to open a panel to discover a blocking problem.
  - Implementation: `SpineQuestionView` renders a "Classification needs attention" inline row (one line + a button "Open settings") when any `metadata.*` issue is blocking. This is a small Phase-04 component reuse (`SectionRule` is not needed; a simple row is enough).

## 6. Detailed TODOs

### 6.1 Layout slot

- [ ] **5.1** Extend `SpineLayout`:
  ```tsx
  export interface SpineLayoutProps {
    header: ReactNode;
    queue: ReactNode;
    banner?: ReactNode | undefined;
    inspector?: ReactNode | undefined;   // NEW — rendered only when provided
    children: ReactNode;
    footer?: ReactNode | undefined;
  }
  ```
  Render order inside `.sat-spine__body`: queue → main → inspector. Add `data-inspector-open={inspector ? "true" : undefined}` on the body for CSS hooks.
- [ ] **5.2** `spine.css` additions (append-only):
  ```css
  .sat-spine__inspector {
    flex: 0 0 var(--spine-inspector-width);
    width: var(--spine-inspector-width);
    border-left: 1px solid var(--color-au-separator);
    background: var(--color-au-surface);
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  @media (max-width: 1280px) {
    .sat-spine[data-inspector-open="true"] .sat-spine__queue { display: none; }
  }
  @media (max-width: 1024px) {
    .sat-spine__inspector {
      position: fixed; inset-block: 0; inset-inline-end: 0; z-index: 40;
      box-shadow: var(--au-elevation-sheet);
    }
  }
  ```

### 6.2 Inspector components

- [ ] **5.3** `spine/Inspector.tsx` — shell only:
  ```tsx
  export interface InspectorProps {
    title: string;                 // "Question settings"
    onClose: () => void;
    children: ReactNode;
  }
  ```
  Renders header (title + close) + scrollable body. `role="region" aria-label={title}`. Escape handling: a keydown listener that calls `onClose` only when the event target is inside the panel and no `[role="dialog"],[role="menu"]` is open.
- [ ] **5.4** `spine/ClassificationInspector.tsx` — thin wrapper that renders the **existing** `ClassificationFieldset` plus a hairline group heading:
  ```tsx
  export interface ClassificationInspectorProps {
    question: QuestionRevision;
    issues: AssessmentValidationIssue[];
    onChange: (question: QuestionRevision) => void;
  }
  ```
  - Remove the `spine-card` wrapper from `ClassificationFieldset` and let the inspector provide the surface (one container, not two). Keep the `fieldset`/`legend` semantics; the legend may become `sr-only` if the inspector already shows "Classification" as a visual heading — **decision: keep the visible legend and skip a duplicate heading.** Simplest, least test churn (`ClassificationFieldset.test.tsx` asserts a visible legend selector).
- [ ] **5.5** `spine/ItemSettingsInspector.tsx`:
  ```tsx
  export interface ItemSettingsInspectorProps {
    question: QuestionRevision;
    onChange: (question: QuestionRevision) => void;
    /** Optional: workspace may pass the module's pretest policy later. Omit if unknown. */
  }
  ```
  Content: read-only response-type summary + Accessibility group with the long-description textarea (`aria-label="Long description"`, `maxLength` generous, helper text "Optional. Used by assistive technology in place of the image.").
  - Writes `{...question, accessibility: { ...question.accessibility, longDescription: value || null }}`.

### 6.3 Workspace wiring

- [ ] **5.6** Add inspector state: `const [inspectorOpen, setInspectorOpen] = useState(false)` and a memoized node:
  ```tsx
  const inspector = inspectorOpen ? (
    <Inspector title="Question settings" onClose={() => setInspectorOpen(false)}>
      <ClassificationInspector question={draft} issues={issues} onChange={handleChange} />
      <ItemSettingsInspector question={draft} onChange={handleChange} />
    </Inspector>
  ) : undefined;
  ```
  - Guard: `draft` may be null → render nothing (inspector closes automatically when no question is selected).
  - **Decision: keep the inspector open across question switches** (it is a workspace mode, not question state). Rationale: spec §29 (preserve editing position/context).
- [ ] **5.7** Focus retry helper (4):
  ```ts
  function focusAuthoringField(field: string, attempts = 3): void {
    const run = (left: number) => {
      const target = document.querySelector<HTMLElement>('[data-authoring-field="' + CSS.escape(field) + '"]');
      if (target) { target.scrollIntoView({ block: "center" }); target.focus?.(); flashAuthoringField(field); return; }
      if (left > 0) requestAnimationFrame(() => run(left - 1));
    };
    run(attempts);
  }
  ```
- Use it in the existing focus effect (`AuthoringWorkspace.tsx:242-256`).
  - The existing effect does four things and **all four must survive**: `scrollIntoView({ behavior: "smooth", block: "center" })`, `flashAuthoringField(field)`, focus resolution (`target.matches(...) ? target : target.querySelector(...)`) and `setFocusField(null)`. The helper replaces only the *lookup*, adding the bounded retry; keep the rest byte-identical and keep clearing `focusField` so the reveal signal stays one-shot (Phase 04 §5.7 depends on that).
  - Keep the existing `requestAnimationFrame` + `cancelAnimationFrame` cleanup shape; the retry chain must be cancelled on cleanup too.
- [ ] **5.8** Issue jump for classification: when `resolveAuthoringField(path)` returns `domain` or `skill` (or the path starts with `metadata.`), set `setInspectorOpen(true)` **before** setting `focusField`.
- [ ] **5.9** Canvas "Open settings" row (5.7): pass a prop to `SpineQuestionView` — `onOpenSettings: () => void` and `hasClassificationIssue: boolean`. Render the row only when `hasClassificationIssue`.
- [ ] **5.10** Remove the "Question settings" entry from the canvas `···` menu? **Decision: no — keep it there too** (5.3 lists it as entry point 1). The menu item calls the same `onOpenSettings`.

## 7. File-by-file plan

- **ADD** `spine/Inspector.tsx`, `spine/ClassificationInspector.tsx`, `spine/ItemSettingsInspector.tsx`
- **CHANGE** `spine/SpineLayout.tsx` (inspector slot), `spine/spine.css` (append inspector block), `spine/ClassificationFieldset.tsx` (drop the card wrapper), `spine/SpineQuestionView.tsx` (remove the classification section, add the settings row + menu item), `AuthoringWorkspace.tsx` (inspector state + focus retry + jump routing)
- **ADD** tests: `Inspector.test.tsx`, `ClassificationInspector.test.tsx`, `ItemSettingsInspector.test.tsx`
- **CHANGE** tests: `ClassificationFieldset.test.tsx` (card class assertion if present), `SpineCard.test.tsx` (drop the classification card entry), `ui/__tests__/AuthoringWorkspace.test.tsx` (add: settings opens inspector; classification issue opens inspector then focuses)

## 8. Test changes (explicit, with reasons)

| Test | Change | Why |
|---|---|---|
| `ClassificationFieldset.test.tsx` | Keep all behaviour assertions; drop any `spine-card` class assertion | Container moved to the inspector |
| `SpineCard.test.tsx` | Remove the ClassificationFieldset entry | No longer a card |
| `AuthoringWorkspace.test.tsx` | Add: opening settings renders the inspector; a `metadata.domain` issue jump opens the inspector and focuses the select; closing restores the canvas | New contract |
| new `ItemSettingsInspector.test.tsx` | Long description writes `accessibility.longDescription` through `onChange` with the exact payload shape; empty string → `null` | New field editor |
| new `Inspector.test.tsx` | Escape closes only from inside; close button restores focus to the opener | Overlay discipline |

## 9. Error / edge matrix

| Condition | Expected | Handling |
|---|---|---|
| Inspector open, no question selected | inspector not rendered | 5.6 guard |
| Issue jump to `domain` while inspector closed | inspector opens, then field focuses within 3 frames | 5.7 + 5.8 |
| Inspector open at 1280px | navigator hidden, canvas keeps its measure | CSS 5.2 |
| Inspector open at 1024px | overlays with a scrim; Escape closes | CSS 5.2 + Escape handler |
| Escape pressed inside the long-description textarea | closes the inspector? **No** — first Escape blurs the field, second closes | implement: if the event target is a text field, do not close |
| Draft switches while inspector is open | inspector re-renders with the new question; stays open | 5.6 |
| Autosave pending while the inspector edits | same autosave path; no separate flush | `onChange` → `scheduleAutosave` |
| Classification has an issue while the inspector is closed | canvas shows the "Open settings" row + readiness count | 5.9 |
| Reduced motion | panel appears instantly | MotionConfig + CSS |

## 10. Test strategy & gate

```bash
npx vitest run src/features/exam-authoring
npx eslint src/features/exam-authoring
npx vite build
grep -rn "spine-card" src/features/exam-authoring/ui/spine        # expect only ReleaseGateCard + ExamOverviewPane (the overview summary keeps its cards)
grep -n "spine-inspector" src/features/exam-authoring/ui/spine/spine.css
grep -rn "accessibility.longDescription" src/features/exam-authoring | head   # expect the new editor + tests
```

## 11. Definition of done

- [ ] Classification and item settings render only inside the inspector; the canvas has zero classification chrome.
- [ ] Inspector is a non-modal 304px panel; the canvas stays interactive; layout adapts at 1280/1024.
- [ ] All four entry points work; ⌘⇧S documented for Phase 07.
- [ ] Classification issue jumps open the inspector and focus the field via the bounded retry.
- [ ] Long description is editable and writes through the existing autosave path; no new validation.
- [ ] No `spine-card` remains on the authoring canvas; the only remaining users are `ReleaseGateCard` and `ExamOverviewPane` (both are summary surfaces, not sections of the editing column).
- [ ] Tests added/updated as listed; suite green; eslint clean; build passes.
- [ ] `plans/authoring-redesign/phase-05-verification-log.md` written.

