# Phase 04 — Authoring Canvas (the question becomes the hero)

## 1. Objective

Rebuild the authoring column so the **question content** is the interface and the chrome defers to it:

1. Delete the 6-stage navigation and the numbered uppercase steps. The canvas becomes: **Question header → Question → Supporting material → Answer → Explanation**.
2. Remove container soup: no `spine-card` on sections. Grouping comes from typography (section heading) + a single hairline rule + spacing.
3. Add a **computed readiness control** in the question header that lists exactly what is missing and jumps to each field.
4. Replace the standalone Validation card with **inline field errors + the readiness control** (validation becomes a system behaviour, not a destination).
5. Fix the supporting-material control: one concept (Type), no verb/noun mixing, destructive change confirmed.
6. Neutral `Required`/`Optional` markers (no blue).
7. Empty states for Supporting material and Explanation that collapse to a single affordance.
8. Question overflow menu (`···`) hosting Duplicate / Move / Delete / Preview, replacing the persistent Preview + Duplicate + Save now buttons.
9. Wire the navigator row-menu handlers that Phase 03 left disabled (Duplicate / Delete per row).

## 2. Dependencies

- Requires: Phase 01 (tokens), Phase 02 (header contract, `Save now` already gone from the header).
- Blocks: Phase 05 (inspector takes classification off this canvas).
- Owns: `spine/SpineQuestionView.tsx`, new `spine/QuestionHeader.tsx`, `spine/SectionRule.tsx`, `spine/ReadinessControl.tsx`, `spine/CanvasFooter.tsx`, `spine/AnswerKeyField.tsx` (labels only), `spine/SpineFieldLabel.tsx`, `spine/SpineStep.tsx` (deleted), `spine/SpineStageNav.tsx` (deleted), `spine/ValidationChecklist.tsx` (retired), `AuthoringWorkspace.tsx` (**canvas wiring window**), canvas tests.
- Does **not** own: `ClassificationFieldset.tsx` (Phase 05 moves it), `RichQuestionComposer.tsx` (Phase 06), `spine.css` token block (Phase 01).

## 3. Current state (verified)

```text
SpineQuestionView.tsx (415 lines) renders, in order:
  <header>  h2 "Question N" (22px)  +  [saved-time text] [Preview] [Duplicate] [Save now (primary)]
  <SpineStageNav/>   6 sticky stage buttons + readiness pill          <-- DELETE
  SpineStep "01" "Prompt"            -> SpineFieldLabel + FastQuestionComposer
  SpineStep "02" "Supporting material" -> SpineSupportingStarters (Quick start | Replace + 3 starters)
                                          + FastQuestionComposer
  SpineStep "03" "Classification"    -> ClassificationFieldset (card)  <-- Phase 05 moves
  SpineStep "04" "Answer key"        -> AuthoringSegmented + AnswerKeyField | SatStudentResponseEditor
  SpineStep "05" "Rationale"         -> <details> wrapper + FastQuestionComposer
  SpineStep "06" "Validation"        -> ValidationChecklist (card)     <-- RETIRE
  <SpineSaveFooter/>  SaveCluster + Carry metadata + "Save & Next"

Pinned tests and what they assert:
  SpineStages.test.tsx        navigation landmark "Question stages"; stage buttons; collapsed stage with
                              a blocker still badges; clicking a stage toggles collapse
  StageJumpExpands.test.tsx   collapsing a stage then selecting its blocker re-expands the stage
  CoachingLayer.test.tsx      ValidationChecklist heading "What's needed to release this question",
                              role=status with blocking count, "Ready to release", issue click forwards
  SpineCard.test.tsx          ValidationChecklist/ClassificationFieldset/ReleaseGateCard/SpineSaveFooter
                              render with class "spine-card"
  SaveTruth.test.tsx          exactly one "Saved" span inside the question view
  AnswerKeyField.test.tsx     radiogroup, 44px targets, key payload shape, arrow-key movement
  AnswerKeyIdentity.test.tsx  key follows the option id when options reorder
  ClassificationFieldset.test.tsx  visible labels, domain change clears skill, inline errors
  SpineOverlays.test.tsx      workspace-level: preview sheet opens from the question view

Workspace contracts that must survive:
  onIssueSelect(field) -> resolveAuthoringField(path) -> setFocusField -> scroll + flash
  [data-authoring-field] anchors: prompt, stimulus, answer, domain, skill, rationale
  useStageCollapse / stageForField  (used only by the stage nav + steps)
  useOverlayStack (max one dialog + one sheet)
```

## 4. Behavioral contract

- Every `data-authoring-field` anchor that exists today still exists with the same value: `prompt`, `stimulus`, `answer`, `rationale` (`domain`/`skill` move with the inspector in Phase 05 — **Phase 04 must keep them working when classification is still on the canvas**, and Phase 05 re-hosts them).
- `onIssueSelect(issue)` keeps its signature and keeps receiving the raw issue (`ValidationChecklist` calls it with the issue object; the workspace reads `issue.field ?? issue.path`).
- Issue jumps must still: expand whatever hides the target, scroll, focus, and flash.
- Autosave semantics unchanged. `Save now` disappears from the question view (⌘S still flushes).
- Answer editing payload shapes unchanged: `{...answer, correctOptionId}` for the key, `{...answer, options: next}` for reorder, SPR unchanged.
- The choice↔SPR switch keeps its confirm dialog (data loss is possible).
- `Save & Next` keeps its flush-then-advance contract and the "carry metadata" option.
- `role="radiogroup"` stays a radiogroup; 44px targets stay 44px (`min-h-[44px] min-w-[44px]` class strings are asserted).
- Exactly one `Saved` status region inside the question view (`SaveTruth.test.tsx`).

## 5. Design decisions

- **5.1 Canvas composition.**
  ```text
  QuestionHeader      "Question 1"  (28px/600)      [readiness control]  [···]
  ── 64px of whitespace ──
  Question            label 14px/600 + neutral "Required"    (no card)
  [editor]
  ── 40px ──
  Supporting material label + neutral "Optional"  + Type selector
  [editor]  |  [empty state: + Add supporting material]
  ── 40px ──
  Answer              label + response-type control + AnswerKeyField | SPR editor
  ── 40px ──
  Explanation         label + neutral "Optional"
  [editor]  |  [empty state: + Add an explanation…]
  ── 48px ──
  CanvasFooter        Save & Next (primary) · Carry metadata · quiet save line
  ```
  - **Decision: no card, no border on any section.** Grouping = heading + hairline + 40px gaps. Rationale: spec §2/§25/§48 and AC-02. The hairline is a `SectionRule` component: a 1px `border-border` line under the heading row, exactly one per section.
  - **Decision: section headings are Title Case, not uppercase.** "Supporting material", "Explanation". Rationale: spec §9/§23 and AC-13.
  - **Decision: the question title is 28px semibold** (spec §23) — the single largest text on the screen, larger than any chrome.
- **5.2 `SpineStep` is deleted.** Its job (anchor + label) is absorbed by `SectionRule` + the section wrapper. Numbered steps are removed because there is no longer a sequence to number — the sections are a stable structure, not a wizard. Rationale: spec §1/§9/§48.
- **5.3 `SpineStageNav` is deleted.** Rationale: spec §1 (one navigation model) and §48 (remove duplicated navigation). Consequences handled:
  - collapse/expand capability is dropped. Rationale: with cards gone the column is much shorter; collapse existed to fight vertical bloat that no longer exists. `useStageCollapse` is deleted with it (grep for other consumers first).
  - the readiness pill is replaced by the readiness control (5.4).
  - "a collapsed stage with a blocker still badges" is no longer a state that can exist — its test is replaced by the readiness-control tests.
- **5.4 ReadinessControl (new).** A button in the question header:
  ```text
  ready:        ✓ Ready                       (green text + check; no pill fill)
  1-2 issues:   ! 2 issues                    (red text + count)
  warning only: ✓ Ready                       (warnings listed inside the popover)
  ```
  Popover content (a non-modal popover with `role="region"` + `aria-label="Readiness"`):
  ```text
  Ready to publish
  ✓ Question text
  ✓ Answer configured
  ✓ Classification
  ✓ Explanation
  ─────────────────
  Warnings
  • Explanation is unusually short.        (only when present)
  ```
  or, when blocked:
  ```text
  2 issues
  • Correct answer hasn't been selected      Question · Answer
  • Difficulty level is missing              Question · Classification
  ```
  - Each issue is a button that calls `onIssueSelect(issue)` — the existing plumbing does the jump.
  - **Decision: implement the checklist from the SAME issue list the canvas already computes** (`validateSatQuestion` output passed in as `issues`). No new validation logic, no new fetch. Rationale: AC-06 forbids a second source of truth, and `releaseSelectors` stays the only publish-gating authority (AC-17).
  - **Decision: the checklist groups by *field family*, not by raw issue path.** Mapping (single function, unit-tested) — verified against every `path:` emitted by `validateSatQuestion` in `providers/sat/satProvider.ts:186-321`:
    ```text
    Question text        path startsWith "prompt"
    Supporting material  path startsWith "stimulus"
    Explanation          path startsWith "rationale"
    Answer               path startsWith "answer" | path === "questionType"
    Classification       path startsWith "metadata."
    Other                anything else (never silently dropped)
    ```
    Notes: `answer.acceptedResponses*` paths are covered by the `answer` prefix; `questionType` (top-level path for `sat.spr.math_only` / `sat.rw.question_type`) belongs to Answer because the response-type control lives in the Answer section. There is deliberately no Accessibility family — no such path prefix exists in the validator.
    A family shows ✓ when it has no blocking issue. Families with only warnings still show ✓ and list the warnings below.
  - Verified subtlety: image alt-text issues (`sat.accessibility.alt.required`, paths like `prompt.document.content.0.attrs.alt`) resolve **inside** the content family that contains the image, and `resolveAuthoringField` already routes them to the owning anchor (`prompt`/`stimulus`/`rationale` by prefix). No resolver change is needed; do not invent a separate accessibility destination.
  - **Decision: when a family has no issues but is empty-by-design (e.g. Supporting material optional), it still shows ✓.** Rationale: the checklist answers "can I publish?", not "did you fill every field?".
  - Positioning: right-aligned in the question header, immediately left of `···`. On ≤900px it collapses to an icon button with the same accessible name.
- **5.5 ValidationChecklist is retired from the canvas.** Rationale: spec §19 (validation is not a destination) + AC-01.
  - **Field-level errors replace it**: any blocking issue whose family matches the section is rendered inline under that section's heading as a compact red row with the issue message, `role="alert"`. This is the "errors appear next to the actual offending field" requirement (spec §1).
  - `ValidationChecklist.tsx` is **kept on disk** if any other file imports it (grep first). Today only `SpineQuestionView` imports it. **Decision: delete the file and its two tests** (`CoachingLayer.test.tsx`, and the `SpineCard.test.tsx` block that asserts it), replacing them with ReadinessControl tests. Rationale: dead code is a maintenance tax and the spec explicitly removes this surface.
  - `ValidationChecklist`'s readiness language ("Ready to release", "N blocking issue(s)") is preserved inside ReadinessControl so nothing is lost in translation.
- **5.6 Supporting material — one concept (Type).**
  ```text
  Supporting material                              Optional
  ────────────────────────────────────────────────────────────
  Type   [ Passage ▾ ]      (existing content)
  ```
  - **Decision: replace the three starter buttons with a `Type` select** whose options map 1:1 onto the existing starter templates:
    ```text
    Passage            -> empty (no template; the default)
    Paired texts       -> createSatSupportingMaterial("paired_texts")
    Student notes      -> createSatSupportingMaterial("student_notes")
    Data table         -> createSatSupportingMaterial("data_table")
    ```
    (`createSatSupportingMaterial` in `providers/sat/contentTemplates.ts` is unchanged and reused.)
  - Selecting a type when the editor already has content opens the **existing** replace confirmation (`pendingStarter` state + `AuthoringConfirmDialog`) — keep that dialog verbatim; only its trigger changes.
  - **Decision: no verb in the control group.** "Replace" is gone; the confirm dialog already explains the consequence. (Spec §11.)
  - **Decision: the type select is presentational state, not persisted data.** The model has no "type" field (`StructuredContent` only). The select's value is derived from the current content shape where possible (heading "Text 1"/"Text 2" → Paired texts; a `table` node → Data table; a "notes" paragraph → Student notes; else Passage) and otherwise shows "Passage". Document this clearly: **the control is a template picker, not a schema field.** Rationale: adding a persisted type would require contract + backend changes, which are out of scope (AC-19).
    - Detection helper lives in `contentTemplates.ts` as `detectSatSupportingMaterial(content): SatSupportingMaterialStarter | null` with unit tests. `null` renders as "Passage".
- **5.7 Explanation section.**
  - Label becomes **Explanation** (spec §18). The field stays `question.rationale` — no contract change.
  - Rendered **open by default** (the `<details>` wrapper is removed). Rationale: spec §47 wants the start of the explanation visible without scrolling; the empty state keeps it cheap.
  - Empty state: `+ Add an explanation…` button that reveals the editor and focuses it. When non-empty, the editor renders directly. Rationale: spec §46 (don't show empty giant editor boxes).
  - **Decision: keep the `data-authoring-field="rationale"` anchor on the section wrapper at all times** (even in the empty state) so an issue jump can always find it and reveal the editor.
  - Implementation (exact): the section holds `const [expanded, setExpanded] = useState(false)` and renders the editor when `contentNonEmpty || expanded`. A `useEffect` watching `revealField` calls `setExpanded(true)` **and records it locally** when `revealField === "rationale"`.
  - ⚠️ The workspace clears `focusField` to `null` inside the same `requestAnimationFrame` that scrolls/focuses (`AuthoringWorkspace.tsx:242-256`). So `revealField` is a **one-shot signal**, not a persistent state: the section must latch it locally (`setExpanded(true)`) rather than deriving visibility from the prop on every render, otherwise the editor would collapse again the moment `focusField` resets.
  - The same latch pattern applies to Supporting material (5.6).
  - **Decision: expose a prop `revealField?: string | null` on the question view, sourced from the workspace's existing `focusField` state (a one-line workspace change).** Rationale: the alternative (a ref + effect inside the section) duplicates the focus plumbing.
  - Add a regression test: set `revealField="rationale"`, assert the editor appears **and stays** after `revealField` returns to `null`.
- **5.8 Answer section.**
  - Heading "Answer", neutral requirement marker, response-type control unchanged (`AuthoringSegmented`, still the only consumer after Phase 03 removed it from the rail — so it stays).
  - `AnswerKeyField`: keep the radiogroup, the 44px letter buttons, the key payload, the arrow-key movement, the reorder buttons, and the "Key" tag. **Change only the label row**: `Required` pill becomes neutral (5.9) and the helper sentence is shortened to one line ("Select the one correct choice."). Rationale: spec §17 wants the answer configuration directly under the question, simple and calm.
  - **Decision: keep the per-option reorder buttons exactly as Phase 06 delivered them** (`aria-label="Move choice A earlier"` / `"Move choice A later"`, inside a `role="group" aria-label="Reorder choice A"`, revealed on hover/focus). This phase changes **only the label row** of `AnswerKeyField` (the neutral requirement marker). Do not re-add permanent visibility and do not rename the controls — the accessible names are the only keyboard path for reordering.
- **5.9 Requirement markers.** `SpineFieldLabel` becomes:
  ```tsx
  <div className="mb-2 flex items-baseline justify-between gap-3">
    <span className="text-sm font-semibold text-foreground">{label}</span>
    <span className="shrink-0 text-xs text-muted-foreground">{required ? "Required" : "Optional"}</span>
  </div>
  ```
  No pill, no colour. Rationale: spec §10/§22 and AC-12 (blue means interactive).
  - Update `AnswerKeyField.tsx`'s own label row to the same neutral treatment (it has its own copy of the pill).
- **5.10 Question overflow menu.**
  ```text
  Preview as student            (opens the existing SpinePreviewSheet)
  Duplicate question
  Move up / Move down           (reorder within the module)
  ─────────────
  Delete question
  ```
  - Implemented with `SatMenu compact` (same primitive as the navigator row menu and the app header).
  - **Decision: "Replace question…" is omitted** (same reasoning as Phase 03 — no single-question replace flow exists).
  - **Decision: Preview stays keyboard-reachable** via Space (existing binding) and via the menu item; the persistent button is removed. Rationale: spec §16/§48.
  - **Decision: Move up/down call the existing `onReorder` with the same single-flight guard.** The question view gains optional props `onMoveUp/onMoveDown`; when absent the items are disabled with an explanatory title (same pattern as Phase 03).
- **5.11 CanvasFooter.**
  - Keeps `SaveCluster` (non-transient, quiet) + "Carry metadata" + primary **Save & Next**.
  - Loses the `spine-card` wrapper (becomes a plain row with a top hairline).
  - Rationale: spec §47 (density) — the footer stays in flow, never floating (AT-10 zoom requirement from the spine plan).
- **5.12 Inline error rows.** For each section, render at most **one** error row (the first blocking issue in that family) to avoid a wall of red; the readiness control lists all of them. Rationale: spec §20 (three severities only) + §46 (density).

## 6. Detailed TODOs

### 6.1 New primitives

- [ ] **4.1** `spine/SectionRule.tsx`:
  ```tsx
  export interface SectionRuleProps {
    id?: string;                 // heading id for aria-labelledby
    title: string;
    requirement?: "required" | "optional" | null;
    field?: string;              // data-authoring-field anchor
    actions?: ReactNode;         // right-aligned slot (e.g. the Type select label)
    children: ReactNode;
  }
  ```
  Renders: `<section data-authoring-field={field} className="scroll-mt-20">` → heading row (`text-xl font-semibold` + neutral marker + actions) → hairline → `mt-4` children.
  - Heading level: `h3` (the question title is `h2`).
  Verify: unit test asserts the anchor, the heading level, the marker text, and the hairline element.
- [ ] **4.2** `spine/ReadinessControl.tsx`:
  ```tsx
  export interface ReadinessControlProps {
    issues: AssessmentValidationIssue[];
    onIssueSelect: (issue: AssessmentValidationIssue) => void;
  }
  ```
  - Internals: `groupIssuesByFamily(issues)` (exported for tests), a trigger button, and a popover (reuse the existing popover primitive `src/components/ui/popover.tsx` if it fits; otherwise a `SatMenu`-style panel — **decision: use `src/components/ui/popover.tsx`** so focus/Escape behaviour is not re-invented).
  - Trigger: ready → `✓ Ready` (green-800 text); blocked → `! N issues` (destructive text). Both are real buttons with `aria-expanded`.
  - Popover: list of families with ✓/•, then blocking issues as buttons, then warnings.
  Verify: unit tests for the family mapping, the trigger label for 0/1/2/5 issues, and that clicking an issue calls `onIssueSelect` with the same object.
- [ ] **4.3** `spine/QuestionHeader.tsx`:
  ```tsx
  export interface QuestionHeaderProps {
    questionNumber?: number | undefined;
    issues: AssessmentValidationIssue[];
    onIssueSelect: (issue: AssessmentValidationIssue) => void;
    onPreview: () => void;
    onDuplicate: () => void;
    onMoveUp?: (() => void) | undefined;
    onMoveDown?: (() => void) | undefined;
    canMoveUp: boolean;
    canMoveDown: boolean;
    onDelete: () => void;
    questionsButton?: ReactNode;   // ≤900px navigator escape hatch (from Phase 02's retained prop)
  }
  ```
  Renders `h2` 28px + ReadinessControl + `SatMenu compact label="Question actions"`.
- [ ] **4.4** `spine/CanvasFooter.tsx`: **rename `spine/SpineSaveFooter.tsx` → `spine/CanvasFooter.tsx`** (the footer already lives in its own file; do not re-implement it), drop the `spine-card` wrapper in favour of a top hairline, keep the exported props and the `SaveCluster` + "Carry metadata" + "Save & Next" behaviour byte-identical.
  - Update every import of `SpineSaveFooter` (today: `SpineQuestionView.tsx` and `spine/__tests__/SpineCard.test.tsx`).
  - Keep the accessible names `Carry metadata` and the Save & Next label unchanged (pinned by `SaveTruth`/`SpineCard` tests).

### 6.2 Retire / delete

- [ ] **4.5** Delete `spine/SpineStageNav.tsx`, `spine/SpineStep.tsx`, `spine/useStageCollapse.ts`, `spine/ValidationChecklist.tsx`.
  - Before deleting each: `grep -rn "<name>" src/features/exam-authoring` and confirm the only consumers are the files this phase rewrites.
  - Delete/replace the tests: `SpineStages.test.tsx`, `StageJumpExpands.test.tsx`, `CoachingLayer.test.tsx`, `ValidationChecklist.test.tsx` (or rewrite the last as `ReadinessControl.test.tsx`).
  - Update `SpineCard.test.tsx`: remove the ValidationChecklist and SpineSaveFooter card assertions; keep ClassificationFieldset (Phase 05) and ReleaseGateCard.
- [ ] **4.6** Grep for imports of the deleted modules across `src/**` (not just exam-authoring) before deleting; if any exist outside scope, stop and report.

### 6.3 SpineQuestionView rewrite

- [ ] **4.7** Rebuild the component around the 5.1 composition. New prop surface (superset of today's, minus the save controls that move):
  ```tsx
  export interface SpineQuestionViewProps {
    question: QuestionRevision;
    questionNumber?: number | undefined;
    saveStatus: QuestionSaveStatus;
    lastSavedAt: Date | null;
    issues: AssessmentValidationIssue[];
    keepMetadataForNext: boolean;
    onKeepMetadataForNextChange: (value: boolean) => void;
    onChange: (question: QuestionRevision) => void;
    onSaveAndNext: () => void;
    onRetrySave: () => void;
    onReviewConflict?: (() => void) | undefined;
    onDuplicate: () => void;
    onDelete: () => boolean | Promise<boolean>;
    onPreview: () => void;
    onIssueSelect: (field: string | null) => void;   // NOTE: unchanged signature
    /* NEW */
    revealField?: string | null;                     // opens an empty-state editor for issue jumps
    onMoveUp?: (() => void) | undefined;
    onMoveDown?: (() => void) | undefined;
    canMoveUp?: boolean;
    canMoveDown?: boolean;
    questionsButton?: ReactNode;
    /* REMOVED */
    // onSaveNow — the control is gone (⌘S still flushes through the workspace)
  }
  ```
  - ⚠️ Signature tension: `onIssueSelect` today takes a **field string**, while `ReadinessControl` wants the issue object. **Decision: `SpineQuestionView` keeps taking the field string and adapts internally** (`onIssueSelect={(issue) => props.onIssueSelect(issue.field ?? issue.path)}`). Rationale: the workspace's `resolveAuthoringField` + anchor plumbing expects a path string, and Phase 04 must not change the workspace contract beyond the small additions. Document this adapter explicitly so a later phase does not "fix" it into a breaking change.
- [ ] **4.8** Supporting material section per 5.6: Type select + editor + empty state + replace confirm. Remove `SpineSupportingStarters`.
- [ ] **4.9** Explanation section per 5.7 with the reveal logic.
- [ ] **4.10** Answer section per 5.8 (labels only; keep `AnswerKeyField`/`SatStudentResponseEditor` behaviour).
- [ ] **4.11** Inline error rows per 5.12: one per section, `role="alert"`, message text from the first blocking issue in that family.
- [ ] **4.12** Delete the `Save now` button and the "saved at HH:MM" header text (the footer + header slots carry save truth).

### 6.4 Workspace wiring (this phase's window)

- [ ] **4.13** Pass the new props to `SpineQuestionView`:
  - `revealField={focusField}` (the state already exists),
  - `onMoveUp/onMoveDown` → `handleReorder` with a single-swap array (reuse the same expected-ids fence the rail uses),
  - `canMoveUp/canMoveDown` from `selectedModuleIndex`,
  - `questionsButton`: a ≤900px button with `aria-label="Open question navigator"` that calls `setQuestionListOpen(true)` (replaces the deleted `onOpenQueue` header prop; remove that prop from `SpineHeader` in the same edit),
  - `onDuplicateQuestion` on `QuestionQueueRail` → pass the row id straight into the existing mutation path (`duplicateQuestion.mutateAsync({ examQuestionId: rowId, ... })`, same payload shape as `handleDuplicate`): **no selection change, no extra flush**.
  - `onRequestDelete` on `QuestionQueueRail` → ⚠️ **do not implement as "select the row, then call `handleDelete()`"** (see the wiring contract in Phase 03 §5.6: `selectQuestion` flushes, then `handleDelete` flushes again, with a wasted `setDraft(null)` + refetch in between — a real regression on a dirty draft). Instead: flush once, call `assessmentAuthoringApi.deleteQuestion(rowId)` directly, then run the same invalidation chain `handleDelete` runs (`removeQueries(question(rowId))`, `invalidateQueries(shell)`, `invalidateQueries(release)`, `invalidateQueries(readinessRoot)`) with the deterministic `selectionAfterDelete` fallback computed over the current list minus the row. Extract the shared post-delete block into a workspace-local helper so the two paths cannot drift.
- [ ] **4.14** Remove `onSaveNow` from the workspace's `SpineQuestionView` usage (the workspace still keeps `handleSaveNow` for ⌘S).
- [ ] **4.15** Do **not** add a readiness control to the app header. Phase 02 deliberately ships no readiness slot; readiness lives only in the canvas question header (5.4). Verify with `grep -rn "readinessSlot" src/features/exam-authoring` -> 0.
- [ ] **4.16** Retire the two props that earlier phases deprecated (both were kept only to avoid mid-initiative breakage):
  - `SpineHeader.onOpenQueue` - delete the prop and its call site; the canvas-level Questions button (4.13) is the replacement.
  - `QuestionQueueRail.onOpenWorkbookImport` - delete the prop and its call site; Phase 02 moved workbook import into the app-header overflow menu.
  - Verify: `grep -rn "onOpenQueue\|onOpenWorkbookImport" src/features/exam-authoring` returns only the app-header menu wiring.

## 7. File-by-file plan

- **ADD** `spine/SectionRule.tsx`, `spine/ReadinessControl.tsx`, `spine/QuestionHeader.tsx`, `spine/CanvasFooter.tsx`
- **ADD** `spine/readinessFamilies.ts` (family mapping, exported for tests) — or export from ReadinessControl; **decision: separate file** so Phase 05 can reuse it when classification leaves the canvas.
- **RENAME** `spine/SpineSaveFooter.tsx` → `spine/CanvasFooter.tsx` (drop the card, keep the API)
- **CHANGE** `spine/SpineQuestionView.tsx` (rewrite), `spine/SpineFieldLabel.tsx`, `spine/AnswerKeyField.tsx` (label row only — Phase 06 owns the option rows), `providers/sat/contentTemplates.ts` (add `detectSatSupportingMaterial`)
- **DELETE** `spine/SpineStageNav.tsx`, `spine/SpineStep.tsx`, `spine/useStageCollapse.ts`, `spine/ValidationChecklist.tsx`
- **CHANGE** `AuthoringWorkspace.tsx` (canvas wiring window)
- **CHANGE** tests: `SpineStages.test.tsx` (delete), `StageJumpExpands.test.tsx` (delete), `CoachingLayer.test.tsx` (delete), `ValidationChecklist.test.tsx` (delete), `SpineCard.test.tsx` (trim), `SaveTruth.test.tsx` (verify), `SpineOverlays.test.tsx` (update), `ui/__tests__/AuthoringWorkspace.test.tsx` (update)
- **ADD** tests: `ReadinessControl.test.tsx`, `SectionRule.test.tsx`, `QuestionHeader.test.tsx`, `contentTemplates.detect.test.ts`

## 8. Test changes (explicit, with reasons)

| Test | Change | Why |
|---|---|---|
| `SpineStages.test.tsx` | **Delete** | The stage nav no longer exists (AC-01) |
| `StageJumpExpands.test.tsx` | **Delete** | Collapse no longer exists; issue jumps are covered by ReadinessControl tests |
| `CoachingLayer.test.tsx` | **Delete** | ValidationChecklist retired; readiness language moves into ReadinessControl tests |
| `ValidationChecklist.test.tsx` | **Delete** | Same |
| `SpineCard.test.tsx` | Trim to ClassificationFieldset + ReleaseGateCard | Sections are no longer cards |
| `SaveTruth.test.tsx` | Keep; verify the single status region still holds after the footer extraction | Save truth must not fork |
| `AnswerKeyField.test.tsx` | Keep all; only the label-row change may touch class assertions — verify none pin the pill. Do **not** duplicate the reorder-visibility test Phase 06 already added | 44px + radiogroup contract |
| `SpineOverlays.test.tsx` | Update the preview assertion (now opened from the `···` menu) | Preview moved |
| `AuthoringWorkspace.test.tsx` | Add: readiness control renders; clicking an issue focuses the field; explanation empty state reveals on `revealField` | New canvas contract |
| new `ReadinessControl.test.tsx` | Family mapping; trigger labels; issue click forwards | AC-06 |

## 9. Error / edge matrix

| Condition | Expected | Handling |
|---|---|---|
| Issue jump targets the Explanation while it is empty | section reveals + focuses | `revealField` prop |
| Issue jump targets Supporting material while empty | section reveals + focuses | same |
| Issue jump targets `domain`/`skill` (Phase 05 moves them) | Phase 04: still on canvas, jump works; Phase 05: opens the inspector then focuses | documented handover |
| Two blocking issues in one family | one inline row + both in the readiness list | 5.12 |
| Only warnings | trigger shows ✓ Ready; warnings listed in the popover | spec §20 |
| `questionNumber` undefined | heading renders "Edit question" | existing behaviour kept |
| Reorder at the first/last position | Move up/down disabled with a title | 5.10 |
| Choice → SPR with content | existing confirm dialog | unchanged |
| Supporting-material type change with content | existing replace confirm | unchanged |
| ≤900px | `questionsButton` visible; readiness collapses to icon | 4.13 |
| 200% zoom | no clipped primary action; footer in flow | AT-10 preserved |

## 10. Test strategy & gate

```bash
npx vitest run src/features/exam-authoring
npx eslint src/features/exam-authoring
npx vite build
grep -rn "SpineStageNav\|SpineStep\|useStageCollapse\|ValidationChecklist" src/features/exam-authoring   # expect 0
grep -rn "spine-card" src/features/exam-authoring/ui/spine                                               # expect only ClassificationFieldset (Phase 05), ReleaseGateCard, ExamOverviewPane
grep -rn "Save now" src/features/exam-authoring                                                          # expect 0
grep -rn "text-primary\">\s*Required" src/features/exam-authoring                                        # expect 0
grep -c "data-authoring-field" src/features/exam-authoring/ui/spine/SpineQuestionView.tsx                # expect >= 4 (prompt, stimulus, answer, rationale)
```

## 11. Definition of done

- [ ] Canvas order is Question header → Question → Supporting material → Answer → Explanation → Footer; no stage nav, no numbered steps, no cards.
- [ ] Readiness control is computed, lists families, and every issue jumps to its field (including empty-state reveals).
- [ ] Validation is inline + readiness only; `ValidationChecklist` is gone.
- [ ] Supporting material uses a single Type control; the replace confirmation is preserved.
- [ ] `Required`/`Optional` are neutral; no blue requirement markers anywhere.
- [ ] Question `···` menu hosts Preview / Duplicate / Move / Delete; no persistent Preview/Duplicate/Save now.
- [ ] Navigator row menu Duplicate/Delete are wired (no longer disabled).
- [ ] All four `data-authoring-field` anchors intact; the jump path works end-to-end.
- [ ] Tests updated/deleted/added exactly as listed; suite green; eslint clean; build passes.
- [ ] `plans/authoring-redesign/phase-04-verification-log.md` written.

