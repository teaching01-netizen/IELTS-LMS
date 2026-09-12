# Phase 07 — Command Palette · Keyboard · Motion · Loading & Empty Polish · A11y Pass

## 1. Objective

Close the loop on "quiet interface, full capability":

1. **Command palette** (⌘K) becomes the power-user surface so the visible UI can stay minimal. It absorbs "Jump to question" and adds the exam/question commands.
2. **Keyboard map** is audited, documented and completed (⌘⇧S settings, ⌥↑/⌥↓ question navigation, ⌘K palette, ⌘/ shortcut help alias, Esc discipline).
3. **Motion** is normalized to the spec's durations and restricted to causal transitions.
4. **Loading states**: shell-first skeletons; no layout collapse; question switches are instant for cached questions.
5. **Empty states**: one clear affordance per empty surface, no dead ends.
6. **A11y pass**: focus order, live regions, non-colour status, 44px targets, reduced motion, and an axe-style audit over the authoring routes.

## 2. Dependencies

- Requires: Phases 02–06 (every surface this phase touches must exist).
- Blocks: Phase 08 (final verification).
- Owns: `spine/QuestionJumpPalette.tsx` → `spine/CommandPalette.tsx`, `spine/ShortcutHelpDialog.tsx`, `src/shared/motion.ts`, `AuthoringWorkspace.tsx` (**keyboard/palette window**), `spine/SatAuthoringStateSurfaces.tsx` (skeletons), `spine.css` (motion block, append-only).
- Does **not** own: any canvas/navigator/editor component (Phases 03–06), `src/index.css` token blocks (Phase 01/06).

## 3. Current state (verified)

```text
Keyboard (AuthoringWorkspace.tsx:757-880, one keydown listener on document):
  guard: ignores events inside dialogs/menus/popper, and inside inputs/contenteditable
         (except Escape, which blurs and focuses the selected row)
  Cmd/Ctrl+S        -> handleSaveNow (flush)
  Cmd/Ctrl+K        -> open jump palette (build mode) OR focus the search input
  ?                 -> shortcut help
  Cmd/Ctrl+Enter    -> Save & Next
  Cmd/Ctrl+1..4     -> set answer key (single choice drafts)
  Cmd/Ctrl+D        -> duplicate
  ArrowUp/ArrowDown, j/k -> previous/next question
  Space             -> toggle preview sheet
  Escape (in input) -> blur + focus selected row
QuestionJumpPalette.tsx (cmdk-based)  -> question list with prompt/domain/skill text
ShortcutHelpDialog.tsx                -> a static table of the bindings above
Skeletons: SatAuthoringLoadingSurface / SatAuthoringErrorSurface
  (used for the whole-route loading state)
Motion: src/shared/motion.ts tokens; authoringMotion.press/hoverLift/fast/question/state/panel/surface
        + spring/settle/snap. Components already reference tokens (RULE: no inline durations).
Empty states today:
  queue: "No matching questions" (Phase 03 adds Clear filter)
  supporting material / explanation: giant empty editors (Phase 04 adds "+ Add …" states)
```

## 4. Behavioral contract

- Every existing binding keeps working with the same scope guards. The listener must remain a single document-level handler (no per-component listeners that can double-fire).
- New bindings must not fire while focus is in an input/contenteditable, inside a menu, or inside a dialog — same guard as today.
- ⌘K keeps its current behaviour when no palette command matches (falls back to focusing the navigator search). **Decision: always open the palette; the palette itself focuses the search box as its input, and its first section is "Jump to question".** Rationale: one mental model, and the existing test "opens the jump palette with Ctrl+K in the spine branch" keeps passing if the palette's accessible name is preserved (see 5.1).
- The shortcut help dialog lists **every** binding it claims, with accurate scope notes (no aspirational rows).
- Skeletons never replace a rendered shell; they fill the canvas slot only.

## 5. Design decisions

- **5.1 Palette (`CommandPalette.tsx`).**
  - **Decision: extend `QuestionJumpPalette` in place and rename the file**, exporting both `QuestionJumpPalette` (compat alias) and `CommandPalette`. Rationale: the existing tests and the workspace import stay valid, and the rename documents the widened role. Rejected: a brand-new component + deleting the old one (needless churn, breaks an import that Phase 07 does not otherwise need to touch).
  - Keep the `cmdk` primitive (already a dependency) and the existing accessible name so pinned tests keep passing. Add sections:
    ```text
    Jump to question      (existing question list)
    Question              Duplicate question · Move up · Move down · Preview as student · Delete question
    Exam                  Preview exam · Review issues · Exam overview · Release exam · Open settings
    View                  Toggle navigator (≤900px) · Open keyboard shortcuts
    ```
  - Commands call the **same handlers** the visible UI calls. No new mutation paths.
  - Disabled commands render with a reason subtitle (e.g. "Save the current question first") — never silently missing.
- **5.2 Keyboard map (final).**
  ```text
  Cmd/Ctrl+S            Flush autosave                     (existing)
  Cmd/Ctrl+Shift+S      Open question settings (inspector) (NEW)
  Cmd/Ctrl+Enter        Save & next question               (existing)
  Cmd/Ctrl+K            Command palette                    (existing, widened)
  Cmd/Ctrl+D            Duplicate question                 (existing)
  Cmd/Ctrl+1..4         Set answer key A-D                 (existing)
  Cmd/Ctrl+/            Keyboard shortcuts                 (NEW alias; ? still works)
  Alt+ArrowUp/Down      Previous / next question           (NEW; arrows and j/k stay)
  ArrowUp/Down, j/k     Previous / next question           (existing)
  Space                 Toggle student preview             (existing)
  Esc                   Close overlay / leave editor       (existing + inspector)
  ```
  - **Decision: add ⌥↑/⌥↓ but keep plain ↑/↓ and j/k.** Rationale: spec §31 asks for a modified pair; the existing plain bindings are relied on by tests and muscle memory. Document all three in the help dialog with their scope notes.
  - **Decision: do NOT add ⌘/Ctrl+Shift+Z as a new binding** — Tiptap already owns redo inside the editor (⌘⇧Z / ⌘Y) and a global handler would fight it. Document it as "inside the editor".
- **5.3 Motion (spec §28).**
  ```text
  hover           120ms  ease-out      (already --authoring-motion-fast)
  focus           150ms  ease-out
  popover/menu    170ms  ease-out entering, ease-in leaving
  inspector       220ms  ease-out entering, ease-in leaving
  dialog          220ms
  question switch 120ms opacity 0.96 -> 1 (no slide)
  save state      fade 160ms
  ```
  - **Decision: no spring on the authoring canvas.** `authoringMotion.spring/settle/snap` stay exported (other surfaces use them) but the canvas stops using springs for layout-affecting transitions; the segmented thumb and press feedback may keep `snap`/press` because they are local and non-structural. Rationale: spec §28 (authoring software should feel stable).
  - **Decision: add the two missing ease tokens** (`AUTHORING_EASE_IN` for leaving) rather than inlining cubic-beziers. RULE preserved: components reference tokens.
- **5.4 Loading (spec §34).**
  - The route already renders a shell-first skeleton (`SatAuthoringLoadingSurface`). Phase 07 adds: the skeleton mirrors the **final layout** (navigator column + canvas column + a header line) so nothing shifts when data arrives.
  - **Decision: cached question switches render instantly; uncached switches keep the previous question visible with a subtle `aria-busy` on the canvas and a 2px indeterminate bar under the header.** No full-canvas spinner.
  - Implementation note: the workspace already holds `draft` for the selected question; when `useExamQuestion` is pending for a **new** id, keep the previous draft rendered until the new one resolves, and mark the canvas `aria-busy="true"`. Careful: this must not let the user edit the previous question while it is stale — **decision: set the editors read-only (`disabled`) during the transition** and show the progress bar. This preserves "never collapse the layout" without risking an edit against the wrong revision.
- **5.5 Empty states (spec §46).**
  ```text
  Supporting material empty   -> "Add passage, notes, table, or paired text."  + [+ Add supporting material]
  Explanation empty           -> "Add an explanation…"                        + [+ Add an explanation…]
  Navigator: no results       -> "No questions match" + Clear filter/search
  Navigator: empty module     -> "No questions yet" + [Create question]
  Readiness popover: all clear-> "Ready to publish" + the family checklist (never an empty popover)
  ```
- **5.6 A11y pass (AC-18).**
  - Tab order audit: header → navigator header → rows → canvas → footer → inspector; the inspector comes last in DOM order (it is the last child of `.sat-spine__body`).
  - Live regions: exactly one `role="status"` for save truth per view (`SaveTruth.test.tsx` pins this), one for validation (readiness), and `role="alert"` only for blocking field errors.
  - Non-colour status: selection (accent bar + weight), readiness (text label), issue rows (text), save states (text).
  - Targets: every interactive control ≥ 44px in the authoring scope (existing rule; the new `···` triggers are 32px — **decision: 32px visual with a 44px hit area via `padding` + `-m-1.5` on the button wrapper**; assert in a test where feasible).
  - Reduced motion: verify the `@media (prefers-reduced-motion: reduce)` block covers the inspector and palette.
  - Run the axe-style audit through the existing Playwright a11y config if the runner is available; otherwise record the static checklist in the log (runner status is documented in the overall plan §6).

## 6. Detailed TODOs

### 6.1 Palette

- [ ] **7.1** Rename `QuestionJumpPalette.tsx` → `CommandPalette.tsx`; export `CommandPalette` and keep `QuestionJumpPalette` as a re-export alias so the workspace import keeps working until Phase 07 updates it (it will, in the same phase — the alias is for tests).
- [ ] **7.2** Add the Question/Exam/View sections per 5.1, wired to the workspace handlers passed in as props:
  ```tsx
  export interface CommandPaletteProps {
    open: boolean;
    onClose: () => void;
    questions: AssessmentQuestionSummary[];
    currentQuestionId: string | null;
    onSelectQuestion: (id: string) => void;
    onDuplicateQuestion: () => void;
    onMoveUp: () => void;
    onMoveDown: () => void;
    onPreviewQuestion: () => void;
    onDeleteQuestion: () => void;
    onOpenOverview: () => void;
    onOpenIssues: () => void;
    onOpenSettings: () => void;
    onOpenRelease: () => void;
    onToggleNavigator: () => void;
    onOpenShortcuts: () => void;
    commandsDisabled?: { duplicate?: boolean; moveUp?: boolean; moveDown?: boolean; delete?: boolean } | undefined;
  }
  ```
- [ ] **7.3** Add palette tests: sections render; disabled commands show a reason; Enter runs the command and closes; Escape closes and restores focus.

### 6.2 Keyboard

- [ ] **7.4** Extend the document keydown handler (same guard block):
  ```ts
  // Cmd/Ctrl+Shift+S -> open inspector
  if (command && event.shiftKey && event.key.toLowerCase() === "s") { event.preventDefault(); setInspectorOpen(true); return; }
  // Cmd/Ctrl+/ -> shortcuts
  if (command && event.key === "/") { event.preventDefault(); setShortcutHelpOpen(true); return; }
  // Alt+ArrowUp/Down -> prev/next
  if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) { …same as arrows… }
  ```
  - ⚠️ Ordering: the `⌘S` branch must come **after** the `⌘⇧S` branch, otherwise ⇧S is swallowed. Add a comment stating this.
- [ ] **7.5** Update `ShortcutHelpDialog` rows to the final map (5.2), including scope notes ("outside inputs", "inside the editor", "not while a menu is open").
- [ ] **7.6** Verify the guard still ignores events inside `[role="dialog"],[role="menu"],[data-radix-popper-content-wrapper]` and inside inputs — add a regression test that presses ⌘K while the palette is open and asserts no second palette.

### 6.3 Motion

- [ ] **7.7** Extend `src/shared/motion.ts` with `AUTHORING_EASE_IN` and `authoringMotion.popover` (170ms) + `authoringMotion.switch` (120ms opacity-only), documented in the same style as the existing tokens.
- [ ] **7.8** Apply: question-switch opacity transition on the canvas (`authoringMotion.switch`), inspector panel (`authoringMotion.panel`), menus (existing), save-state fade (`state`).
- [ ] **7.9** Grep for inline transition durations in the authoring scope and replace with tokens (report the count before/after in the log).

### 6.4 Loading & empty states

- [ ] **7.10** Rework `SatAuthoringLoadingSurface` into a layout-mirroring skeleton (header line + 272px column + canvas block).
- [ ] **7.11** Implement the stale-while-switching behaviour (5.4) with `aria-busy` + read-only editors + a 2px indeterminate bar. Test: switching questions keeps the previous content mounted until the new draft resolves (mock the query to stay pending).
- [ ] **7.12** Implement the empty states in 5.5 (the canvas ones already exist from Phase 04 — verify wording and that the navigator ones exist).

### 6.5 A11y

- [ ] **7.13** Tab-order test: render the workspace and assert the DOM order of landmarks (header, navigator, canvas, inspector).
- [ ] **7.14** Assert one `role="status"` for save and one for readiness; assert blocking errors use `role="alert"`.
- [ ] **7.15** Hit-area fix for `···` triggers (44px target, 32px visual).
- [ ] **7.16** Reduced-motion audit: grep the new classes and confirm they are covered by the existing reduced-motion block; add entries if not.

## 7. File-by-file plan

- **ADD** `spine/CommandPalette.tsx`; **DELETE** `spine/QuestionJumpPalette.tsx` (re-export kept inside CommandPalette.tsx)
- **CHANGE** `spine/ShortcutHelpDialog.tsx`, `spine/SatAuthoringStateSurfaces.tsx`, `src/shared/motion.ts`, `spine/spine.css` (append motion/skeleton classes), `AuthoringWorkspace.tsx` (keyboard/palette/loading wiring)
- **CHANGE** tests: `QuestionJumpPalette.test.tsx` → `CommandPalette.test.tsx`, `ui/__tests__/AuthoringWorkspace.test.tsx` (keyboard + loading), `spine/__tests__/SpineOverlays.test.tsx` (palette name if asserted)
- **ADD** tests: `CommandPalette.test.tsx`, `a11y.test.tsx` (tab order + live regions)

## 8. Test changes (explicit, with reasons)

| Test | Change | Why |
|---|---|---|
| `QuestionJumpPalette.test.tsx` | Rename + extend with the new sections | The palette widened |
| "opens the jump palette with Ctrl+K in the spine branch" | Keep (name preserved) | No user-visible regression |
| "opens shortcut help with ? in the spine branch" | Keep; add ⌘/ alias | New binding |
| new: stale-while-switching | Previous question stays mounted, `aria-busy` true, editors read-only | Loading contract |
| new: tab order | Landmark order asserted | A11y |
| new: palette guard | ⌘K while the palette is open does not stack | Guard regression |

## 9. Error / edge matrix

| Condition | Expected | Handling |
|---|---|---|
| ⌘K while a dialog is open | ignored | existing guard |
| ⌘⇧S inside a text field | ignored (typing) | existing guard |
| Alt+↑ inside a select | browser default wins? | guard ignores events inside form controls (existing) |
| Question switch fails (network) | previous content stays, error surfaces via navigationError | existing error path + aria-busy |
| Palette command disabled | rendered with a reason, not hidden | 5.1 |
| Reduced motion | all transitions collapse | MotionConfig + CSS |
| 200% zoom | no clipped controls | 44px targets + flow layout |
| Empty module | create affordance | 5.5 |

## 10. Test strategy & gate

```bash
npx vitest run src/features/exam-authoring
npx eslint src/features/exam-authoring
npx vite build
grep -rn "QuestionJumpPalette" src/features/exam-authoring        # expect only the compat alias
grep -rn "duration: 0\.\|ms'" src/features/exam-authoring/ui/spine | head   # inline-duration audit
```

## 11. Definition of done

- [ ] ⌘K opens a sectioned command palette whose commands call the same handlers as the UI.
- [ ] Keyboard map complete and documented; every binding scope-accurate in the help dialog.
- [ ] Motion normalized to tokens; no new inline durations; no springs on structural canvas transitions.
- [ ] Skeletons mirror the final layout; question switches keep the previous content mounted with `aria-busy` and read-only editors.
- [ ] Empty states exist for every empty surface with one clear affordance.
- [ ] A11y checks: landmark order, live regions, 44px targets, reduced motion, non-colour status.
- [ ] Suite green; eslint clean; build passes.
- [ ] `plans/authoring-redesign/phase-07-verification-log.md` written.

