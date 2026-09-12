# Phase 03 — Question Navigator (scan, don't administer)

## 1. Objective

Turn the 384px, six-control-per-row rail into a 272px **scannable worklist**:

- row = number + title + at most **one** trailing token (answer letter, or an issue mark, or nothing);
- contextual actions (Duplicate / Move / Delete) live behind a per-row `···`;
- bulk selection becomes a **mode** entered from the navigator header, not a permanent checkbox on every row;
- the filter becomes a **menu with counts that appear only when non-zero**;
- the navigator's header, search and filter are **fixed**; only the list scrolls;
- the navigator header carries the authored/target progress that left the app header in Phase 02.

## 2. Dependencies

- Requires: Phase 01 (272px rail token + type scale).
- Parallel with: Phase 06 (editor) — disjoint files, neither edits `AuthoringWorkspace.tsx`.
- Blocks: nothing directly; Phase 07 polishes keyboard/motion on top.
- Owns: `spine/QuestionQueueRail.tsx`, `spine/queueModel.ts`, new `spine/QuestionRowMenu.tsx`, new `spine/QuestionFilterMenu.tsx`, navigator tests.
- Does **not** own: `AuthoringWorkspace.tsx` (call-site props are preserved; if a new prop is unavoidable, stop and report to the Main Agent), `spine.css` token block.

## 3. Current state (verified)

```text
QuestionQueueRail.tsx (417 lines) structure:
  header (px-3 pb-3 pt-2.5):
    ModuleScopePicker (min-h-11)  +  "Add"/"Replace" split button  +  "+ Question" primary
    search input (h-9)
    AuthoringSegmented: All 27 | Ready 27 | Needs work 0 | Errors 0     <-- permanent zero states
  list (overflow-y-auto):
    QueueRow (min-h-[64px], mx-2 my-px):
      [checkbox 20px] [position w-5] [readiness dot] [title truncate] [answer letter] [Current]
      + hover-revealed [up][down]
    QueueEmptyRow (dashed, min-h-[48px])
  footer: QueueBulkToolbar (appears when selection non-empty)

Data helpers already extracted and reusable:
  buildQueueRows(module, searchQuery, filter) -> SpineQueueRow[]
  countQueueReadiness(module) -> { ready, incomplete, error }
  matchesQueueSearch / normalizeQueueSearch

Tests pinning current behaviour:
  QuestionQueueRail.test.tsx:
    "announces the current question with text, not color alone"   (asserts literal "Current")
    "keeps reorder buttons discoverable without hover"            (asserts opacity-40 parent)
    "pads empty slots only in the unfiltered view"
    "issues a single create on rapid double-click of the empty slot"
    "disables the header Question button while mutating"
    "clears the active search with Escape"
    "selects the question when any area of the row is clicked"
  QueueWorklist.test.tsx:
    "surfaces difficulty at a glance in every row"                (aria-label must match /medium/i)
    "makes bulk selection keyboard-operable with a visible checkbox"
```

## 4. Behavioral contract

- `[data-question-list-row="<examQuestionId>"]` stays on the row root: the workspace Esc handler focuses `[data-question-list-row="<id>"] button` (`AuthoringWorkspace.tsx:795`) and the auto-scroll effect queries the same attribute (`QuestionQueueRail.tsx:98`).
- Row accessible name keeps the shape `Question N: <title>, <difficulty>[, current]` — `QueueWorklist.test.tsx` asserts difficulty is present, `QuestionQueueRail.test.tsx` asserts `question 1.*current`.
- Selection state keeps a **non-colour** cue (AT-09 / AC-08). The literal word `Current` is removed (spec §15); the cue becomes `aria-current="true"` + accent bar + semibold position (weight is not colour).
- `onSelectQuestion` fires when any non-interactive area of the row is clicked (pinned by test).
- Search Escape clears the query (pinned).
- Empty-slot rows appear only in the unfiltered view (pinned).
- `isMutating` disables create/reorder/bulk controls (pinned).
- Filter ids and semantics stay: `all | ready | incomplete | error` (`queueModel` meaning unchanged).
- Bulk actions keep `operationKey` + `expectedRevisions` fences (workspace-owned; untouched).
- The navigator header renders `{authored} of {target} questions authored` so `e2e/sat-product-workspace.spec.ts:296` keeps a real string to assert.

## 5. Design decisions

- **5.1 Row anatomy (52px):**
  ```text
  [position  20px] [title flex-1 truncate] [trailing token 20px]
  trailing token precedence:  issue mark (!)  >  answer letter (A/B/C/D)  >  SPR  >  nothing
  selected:  bg-primary/[0.07] + inset ring primary/20 + 2px left accent bar + aria-current
  hover:     trailing token is replaced by the row menu trigger
  issue row: only the mark is red; the row is never red
  ```
  - **Decision: drop the readiness dot.** It is a third status channel in a three-element row and duplicates the mark. Silence means fine. (Spec §6.)
  - **Decision: keep exactly one answer token.** It is the highest-value glanceable fact for a builder checking key coverage (spec §6).
  - **Decision: the issue mark is `!` in a 20px cell with `aria-label="Needs attention"`.** Colour alone never carries state.
- **5.2 Bulk selection becomes a mode.**
  - Navigator header gains a `Select` toggle (`aria-pressed`). When active: checkboxes appear (20px, left of the position), the header shows `n selected` + `Clear`, and the existing `QueueBulkToolbar` docks at the bottom as today.
  - **Decision: keep the checkbox implementation identical** (role="checkbox", Space/Enter handling, shift-range via `onToggleSelection(id, event.shiftKey)`). Only its *visibility* becomes conditional — the win is removing it from the default view, not rewriting the a11y contract.
  - **Decision: exit selection mode automatically** when the selection becomes empty. Prevents a stuck mode.
  - Selection mode is **local state inside the rail** (nothing outside needs it) — this keeps Phase 03 from editing the workspace.
- **5.3 Non-colour selection cue.** `aria-current="true"` + 2px accent bar (the pattern the code already uses via `layoutId="rail-accent"`) + position rendered at `font-semibold text-foreground` instead of muted. The literal `Current` text is deleted.
  - Update `QuestionQueueRail.test.tsx`: replace `expect(screen.getByText("Current"))` with assertions on `aria-current` and a `data-selected-bar` element — reason: the spec forbids describing in words what the UI already shows.
- **5.4 Filter menu.**
  ```text
  27 questions                                    Filter ⌄
  ─────────────────────────────────────────────────────────
  Show
    ✓ All questions
      Ready
      Needs attention
      Has errors
  ```
  - Trigger label: `{module.questions.length} questions` plus `· N shown` when a filter or search is active, so the user is never confused about why the list is short.
  - Menu item labels carry counts **only when non-zero** (AC-07).
  - **Decision: implement with `SatMenu`** (Radix + static fallback, roving focus, Escape restore) rather than `AuthoringSegmented`. Reason: spec §7 asks for a menu; `SatMenu` is the house primitive and works in the jsdom/static fallback environment the tests run in. The active item uses `current`.
  - The `AuthoringSegmented` import is removed from this file. **Do not delete `AuthoringSegmented.tsx`** — `SpineQuestionView` still uses it for response type until Phase 04.
  - **Decision: "Needs attention" = `incomplete`, "Has errors" = `error`.** Internal filter ids stay unchanged so `queueModel` and the workspace state machine are untouched.
- **5.5 Navigator header carries progress.**
  ```text
  Questions                                   Select   Add   +
  27 of 27 questions authored                        (12px muted metadata)
  Search questions…
  27 questions                                Filter ⌄
  ```
  - **Decision: always render `{authored} of {target} questions authored`**, styled as quiet metadata rather than a progress statement. Rationale: (a) it preserves the e2e selector at `sat-product-workspace.spec.ts:296`; (b) it is real information (how many exist); (c) a conditional render would create a special case with no user benefit. AC-07 is about *zero-information* states (like "Errors 0"); a question count is not zero-information.
- **5.6 Row menu (`QuestionRowMenu.tsx`).**
  ```text
  Duplicate
  Move up
  Move down
  ─────────────
  Delete
  ```
  - **Decision: reorder moves into the row menu** as Move up / Move down (disabled at the ends), calling the existing `onReorder(next, expected)` with the same single-flight guard (`reorderPending`). Reason: spec §6/§48 removes permanent arrows while keeping the capability keyboard-reachable.
  - **Decision: omit "Replace…"** (replace a single question's content from an import). No existing single-question flow exists; inventing one is out of scope for a hierarchy redesign. Documented omission.
  - **Decision: omit per-row "Preview"** in this phase. It would require a new workspace prop to set selection then open `SpinePreviewSheet`; the canvas header owns Preview. Documented as a follow-up.
  - **Delete and Duplicate depend on workspace-level selection semantics** (`handleDelete`/`handleDuplicate` act on the selected question). To respect the ownership rule (Phase 03 must not edit `AuthoringWorkspace.tsx`), the menu accepts optional props:
    ```tsx
    onDuplicateQuestion?: ((id: string) => void) | undefined;
    onRequestDelete?: ((id: string) => void) | undefined;
    ```
    When absent, the item renders **disabled** with an explanatory `title` ("Select the question to duplicate it"). **Phase 04 wires both** (it owns the workspace edit window). Phase 03 ships the shape; Phase 04 enables the actions.
  - ⚠️ Wiring contract for Phase 04. `handleDuplicate` takes `examQuestionId` as a mutation argument, so Phase 04 can pass the row id directly with **no selection change and no extra flush**. `handleDelete()` reads `selectedExamQuestionId` from closure, so a non-selected row **cannot** reuse it as-is: implementing Delete as "select the row, then call `handleDelete`" would flush twice (`selectQuestion` flushes, then `handleDelete` flushes again) and force a wasted `setDraft(null)` + question refetch in between — a real regression on a dirty draft, not a semantic no-op. Phase 04 must either parameterize `handleDelete` with an optional `examQuestionId` argument or call `assessmentAuthoringApi.deleteQuestion(id)` + the same invalidation chain (`removeQueries(question(id))`, `invalidateQueries(shell)`, `invalidateQueries(release)`, `invalidateQueries(readinessRoot)`, deterministic `selectionAfterDelete` fallback) for the given row. This constraint is repeated in Phase 04 §6.4 — both copies must agree.
  - The trigger is `SatMenu compact label={"Question " + position + " actions"} icon={MoreHorizontal}`. Visibility: `opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100` — never removed from the tab order (AC-18).
  - The trailing token cell reserves the trigger's width so hover does not reflow the row.
- **5.7 Row geometry:** `min-h-[52px]`, `mx-1.5`, `px-3`, `rounded-[var(--spine-radius-md)]`.
- **5.8 Scroll containment:** header + search + filter live in a `shrink-0` block; the list is the only `overflow-y-auto` child. The existing `data-queue-scroll-region` attribute stays (used by the `scrollbar-gutter` CSS).
- **5.9 "Add" affordances.** Today there are three: the "Add" half of the split button (paste import), the "Replace" half (workbook import), and the primary "+ Question".
  - **Decision:** keep **one** primary add path — a compact `+` button whose accessible name stays `Create question` (name preserved so the pinned `/question$/i` selector keeps passing; see §8) — plus a quiet `Add` text button for the paste/import sheet. Delete the "Replace" half here, because Phase 02 already moved "Import from workbook" into the app-header overflow menu. Rationale: spec §1 (competing actions) and §48.
  - The rail keeps `onOpenWorkbookImport` in its prop interface but stops rendering it, to avoid a workspace diff in this phase. Mark with a TODO naming Phase 04 as the removal owner.

## 6. Detailed TODOs

### 6.1 queueModel

- [ ] **3.1** Add a single-place token rule:
  ```ts
  export type QueueRowToken =
    | { kind: "issue"; label: string }
    | { kind: "answer"; label: string }
    | { kind: "spr"; label: string }
    | null;
  export function queueRowToken(question: AssessmentQuestionSummary): QueueRowToken;
  ```
  Precedence: blocking/incomplete-with-blockers → issue; single-choice with `answerKeyPreview` → answer; SPR → spr; else null.
  - An `incomplete` question with **zero** blocking issues must NOT show the mark (normal mid-authoring state).
  Verify: extend `queueModel.test.ts` with all branches.
- [ ] **3.2** Add `filterLabel(filter)` and `filterCountLabel(count)` helpers so label/count visibility is unit-testable without rendering.

### 6.2 Row

- [ ] **3.3** Rewrite the row body per 5.1 while keeping the outer element contract byte-identical in behaviour:
  ```tsx
  <div
    data-question-list-row={question.examQuestionId}
    role="button"
    tabIndex={disabled ? -1 : 0}
    aria-current={selected ? "true" : undefined}
    aria-disabled={disabled || undefined}
    aria-busy={reorderPending || undefined}
    aria-label={"Question " + position + ": " + (title || "Empty question") + ", " + question.difficulty + (selected ? ", current" : "")}
    className="group relative mx-1.5 my-px flex min-h-[52px] cursor-pointer items-center gap-2 rounded-[var(--spine-radius-md)] px-3 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ..."
  >
    {selected ? <span data-selected-bar aria-hidden="true" className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-primary" /> : null}
    {selectionMode ? <checkbox/> : null}
    <span className={selected ? "w-5 shrink-0 text-xs font-semibold tabular-nums text-foreground" : "w-5 shrink-0 text-xs tabular-nums text-muted-foreground"}>{position}</span>
    <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">{title}</span>
    <span className="flex w-5 shrink-0 items-center justify-end">{token ?? menuTrigger}</span>
  </div>
  ```
- [ ] **3.4** Keep the click/keydown handlers unchanged (they encode "click anywhere selects, except on a nested control").
- [ ] **3.5** Remove the permanent ↑↓ pair; reorder is menu-driven (5.6).
- [ ] **3.6** Render the checkbox only when `selectionMode` is true; handlers/aria-label unchanged.

### 6.3 Navigator header + filter

- [ ] **3.7** Restructure the header per 5.5/5.9. Sources for the progress line: `props.module.questions.length` and `props.module.targetQuestionCount` — no new props.
- [ ] **3.8** Create `spine/QuestionFilterMenu.tsx`:
  ```tsx
  export interface QuestionFilterMenuProps {
    filter: SpineQueueFilter;
    counts: SpineQueueCounts;
    onFilterChange: (filter: SpineQueueFilter) => void;
  }
  ```
  Items: All questions (always) · Ready (count when > 0) · Needs attention (count when > 0) · Has errors (count when > 0). Active item uses `current`.
- [ ] **3.9** Empty list state: keep the existing message; add a "Clear filter" button when a filter or search is active (no dead ends).

### 6.4 Row menu

- [ ] **3.10** Create `spine/QuestionRowMenu.tsx` per 5.6, including the disabled-with-title fallback for Duplicate/Delete when their optional handlers are absent.

## 7. File-by-file plan

- **CHANGE** `spine/QuestionQueueRail.tsx`
- **CHANGE** `spine/queueModel.ts`
- **ADD** `spine/QuestionFilterMenu.tsx`
- **ADD** `spine/QuestionRowMenu.tsx`
- **CHANGE** `spine/__tests__/QuestionQueueRail.test.tsx`, `spine/__tests__/QueueWorklist.test.tsx`, `spine/__tests__/queueModel.test.ts`
- **ADD** `spine/__tests__/QuestionFilterMenu.test.tsx`, `spine/__tests__/QuestionRowMenu.test.tsx`
- **VERIFY (no change)** `AuthoringWorkspace.tsx` — the rail must render with today's props.

## 8. Test changes (explicit, with reasons)

| Test | Change | Why |
|---|---|---|
| "announces the current question with text, not color alone" | Replace `getByText("Current")` with `aria-current` + `data-selected-bar` assertions | Spec §15: do not describe what the UI already shows |
| "keeps reorder buttons discoverable without hover" | Replace with row-menu Move up/down assertions (including end-state disabling) | Reorder moved into the menu |
| "makes bulk selection keyboard-operable with a visible checkbox" | Enter selection mode first | Checkboxes are mode-gated |
| "surfaces difficulty at a glance in every row" | Unchanged | Contract preserved |
| "pads empty slots only in the unfiltered view" | Unchanged | Behaviour preserved |
| "disables the header Question button while mutating" | Unchanged — verify: the compact `+` keeps accessible name `Create question`, which still matches the pinned `/question$/i` selector; empty-slot buttons (`Add question N`) do not match it | Name preserved by design |
| "selects the question when any area of the row is clicked" | Unchanged | Contract preserved |
| new: filter menu counts | Zero-count buckets render without numbers; non-zero render with numbers | AC-07 |
| new: progress line | Navigator header shows `N of M questions authored` | e2e selector preservation |

## 9. Error / edge matrix

| Condition | Expected | Handling |
|---|---|---|
| 147 questions, no filter | all rows are cheap (52px, no editor) | virtualisation deferred to Phase 07 if measurement demands it |
| Search with no match | "No matching questions" + Clear filter when a filter is active | 3.9 |
| Filter active + module complete | zero buckets hidden | AC-07 |
| Selection mode + filter change | selection preserved across filtering | `selectedIds` untouched by filter |
| Row menu open + row scrolled away | menu closes | Radix; static fallback closes on pointerdown |
| Keyboard: Tab to row → Enter | selects question | unchanged handler |
| Keyboard: row menu | focus enters menu; Escape restores the trigger | `SatMenu` contract |
| `isMutating` | row menu items, empty slots, Add disabled | existing behaviour extended |
| Duplicate/Delete before Phase 04 | rendered disabled with an explanatory title | documented, not silent |

## 10. Test strategy & gate

```bash
npx vitest run src/features/exam-authoring/ui/spine
npx eslint src/features/exam-authoring
npx vite build
grep -n "AuthoringSegmented" src/features/exam-authoring/ui/spine/QuestionQueueRail.tsx   # expect 0
grep -rn 'getByText("Current")' src/features/exam-authoring                              # expect 0
grep -c "data-question-list-row" src/features/exam-authoring/ui/spine/QuestionQueueRail.tsx  # expect >= 1
```

## 11. Definition of done

- [ ] Rows are 52px with number + title + one token; no dot, no Current text, no permanent checkboxes, no arrows.
- [ ] Selection shows accent bar + tint + `aria-current` + semibold position; no literal "Current".
- [ ] Filter is a menu; zero-count buckets render without numbers; module count always visible.
- [ ] Navigator header/search/filter fixed; only the list scrolls.
- [ ] `{authored} of {target} questions authored` renders in the navigator header (e2e string preserved).
- [ ] Row menu exposes Duplicate / Move up / Move down / Delete with documented disabled states pending Phase 04.
- [ ] Rail renders at 272px with the **existing** workspace props (no workspace diff).
- [ ] Updated + new tests green; eslint clean; build passes.
- [ ] `plans/authoring-redesign/phase-03-verification-log.md` written.

