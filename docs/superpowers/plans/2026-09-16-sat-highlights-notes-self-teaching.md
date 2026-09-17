# SAT Highlights & Notes: Self-Teaching UX Implementation Plan (delivered)

**Goal:** Make SAT Highlights & Notes understandable to a first-time student with no tutorial, no onboarding, no documentation — the interface teaches through cause and effect.

**Architecture:** Annotations stop being an armed *tool mode*. Selecting text is the only affordance: the selection is captured into the interaction machine (`state.annotation.selection`), and the shell raises a contextual toolbar (desktop) or bottom dock (touch) whose controls are always written labels, never bare glyphs. Every mutation (ink, underline, note, removal) is applied by the shell, which owns the response write, so the renderer stays a renderer. A first-use *education* layer (passive hint, one `Highlighted` confirmation, empty-notes coach, polite announcements) is a separate, locally-persisted, deletable concern.

**Tech Stack:** React 19, vitest + Testing Library, Playwright (SAT a11y profile), Go (annotation validator), CSS custom properties in `src/index.css`, Bun.

---

## Contracts discovered (must not regress)

| Contract | Location | Effect of this change |
|---|---|---|
| Annotation payload shape `{ version: 2, annotations: [...], legacyQuestionNote }` | `src/features/student-delivery/domain/satResponses.ts`, `backend/go/internal/attempts/sat_annotations.go` | Extended: each annotation gains optional `color`; **absent means yellow**, so every previously stored payload stays valid |
| Go validator rejects any annotation kind other than `highlight` / `underline` | `backend/go/internal/attempts/validate.go` | Unchanged for `kind`; `color` validated against the three inks |
| Note cap 200 per question and 2000 characters per note | `satResponses.ts`, `SAT_ANNOTATION_NOTE_LIMIT` | Unchanged |
| Top-bar note entry opened a "Question note" panel | `ui/shell/SatExamTopBar.tsx`, `ui/question/SatNotesPanel.tsx` | Entry is now the single labeled `Highlights & Notes`; the panel keeps its title and gains the anchored-note list plus an empty-state coach |
| Freeform per-question note (`legacyQuestionNote`) still persists through the panel | `SatNotesPanel`, `onSaveNote` | Unchanged; the panel now also lists notes anchored to selected text |
| Legacy student highlight UI (`src/components/student/*`, `e2e/student-highlight-selection.spec.ts`, `e2e/student-ipad-layout.spec.ts`) | separate system | **Untouched** |
| 44px minimum touch targets in the SAT shell | `e2e/sat-student-accessibility.spec.ts` (`expectVisibleButtonsAtLeast44`) | Preserved: every annotation control is `min-h-[44px] min-w-[44px]` with an 18–22px swatch inside |
| Answer choice reading is not annotation | `ui/question/SatSingleChoiceAnswer.tsx`, `ui/annotations/satSelectionDragGuard.ts` | A selection gesture that ends on the label no longer chooses the answer; the activation itself is what the guard judges, so label text, keyboard, and pointer paths are all covered |

---

## File structure

**New — domain / infrastructure / hooks**

- `src/features/student-delivery/domain/satAnnotationEducation.ts` — education state (`sawHighlightHint`, `createdFirstHighlight`, `createdFirstNote`, `lastHighlightColor`), its normalizer, and `shouldShowSatAnnotationHint`.
- `src/features/student-delivery/infrastructure/satAnnotationEducationStore.ts` — localStorage persistence keyed per schedule/candidate, tolerant of junk.
- `src/features/student-delivery/hooks/useSatAnnotationEducation.ts` — read/write façade used by the shell.
- `src/features/student-delivery/ui/education/SatAnnotationEducationCues.tsx` — `SatAnnotationFirstUseHint`, `SatAnnotationFirstHighlightFeedback`, `SatAnnotationEmptyNotesCoach`, `SatAnnotationSelectTextCoach`. Deleting this file (plus the `useSatAnnotationEducation` call) removes teaching without breaking annotation.

**New — annotation UI**

- `satAnnotationPalette.ts` — the three inks (label, swatch, mark style) in one place.
- `SatAnnotationControls.tsx` — shared labeled swatch/underline/note/remove controls and the `Highlight` heading.
- `SatSelectionActionsPanel.tsx` — the controls raised by a selection, in both placements (`floating` desktop toolbar, `docked` iPad sheet quoting the selection), arrow-key walkable.
- `SatAnnotationEditDock.tsx` — edit controls for an existing mark (recolor, underline, note, remove).
- `SatAnnotationViewContext.ts` — the narrow bridge that lets the renderer report selections and open editors without importing shell state.
- `useSatAnnotationPlacement.ts`, `satSelectionGeometry.ts` — placement/measurement for toolbar and dock.
- `satSelectionDragGuard.ts` — remembers that a gesture was a text selection so an answer choice is not chosen by accident.

**Rewritten / modified**

- `ui/annotations/SatAnnotatedContent.tsx` — renderer plus selection gesture; marks are `role="button"` spans that open their editor.
- `hooks/useSatAnnotationSurface.ts` — the single owner of annotation state, mutation, chrome, undo, announcements, and cues.
- `ui/SatExamShell.tsx` — renders the surfaces and reports gestures; no annotation mutation of its own.
- `ui/question/SatQuestionRenderer.tsx`, `ui/shell/SatExamTopBar.tsx`, `ui/question/SatNotesPanel.tsx`, `ui/annotations/SatAnnotationNoteEditor.tsx` — one labeled entry, anchored-note list, empty state, quick-note placeholder with idle autosave and a transient `Saved`.
- `domain/satInteraction{State,Intents,Escape,Selectors}.ts`, `hooks/useSatInteractionController.ts` — armed modes replaced by a captured selection.
- `domain/satCopy.ts` — every new string; `src/index.css` — annotation tokens and the one entrance animation.
- **Deleted:** `ui/annotations/SatAnnotationModeBar.test.tsx`, `ui/annotations/SatAnnotationModeContext.ts` and the eraser tool (removal is now tap-a-mark → `Remove`, with `Undo`).

---

## Phases (all delivered)

- [x] **1 — Color-aware annotation model.** `SatHighlightColor` + `color` on every annotation, `defaultSatHighlightColor = 'yellow'`, palette table, CSS ink tokens; absent color normalizes to yellow so v2 payloads written before this change still render.
- [x] **2 — Backend parity.** `types.go` gains `Color`, `validate.go` rejects unknown inks, `sat_annotations_test.go` covers present/absent/invalid.
- [x] **3 — Selection-first interaction machine.** `TEXT_SELECTION_CAPTURED` / `SELECTION_CLEARED` replace `ANNOTATION_MODE_CHANGED`, Escape ordering keeps the edit dock innermost, selectors and guards updated with the reducer.
- [x] **4 — Contextual controls.** Desktop toolbar, touch dock, edit dock, placement helper, rewritten annotated content; no bare dots anywhere.
- [x] **5 — One labeled top-bar entry.** `🖍 Highlights & Notes` (never shortened), with the anchored-note list and question note in one panel.
- [x] **6 — Notes teach themselves.** Empty state, `Add a quick note…`, caret in the field on open, idle autosave, transient `Saved`, ink dot tying note to source.
- [x] **7 — Forgiveness.** Removal never asks "are you sure?": `Remove highlight` sits on its own row under a divider, the removal is undoable for a few seconds, and recolor is one tap.
- [x] **8 — Education layer.** One passive hint (delayed, auto-dismissed, retired by the first selection or answer), one `Highlighted` confirmation, `aria-live` announcements, once-per-attempt local memory.
- [x] **9 — Copy + tests.** Copy table entries for every new string; unit suites updated and extended (palette, controls, geometry, drag guard, education, store); SAT e2e specs rewritten for the selection-first flow.
- [ ] **10 — First-time usability testing (not automatable).** Per spec §41: give a student only "Highlight the sentence you think is important." If they ask *where to click*, fix the affordance — do not add documentation.

---

## Follow-up pass: closing the audit findings

A four-dimension audit (SPEC / DESIGN / CORRECTNESS / QUALITY) probed the feature in a real browser and found four defects that the green suite could not see. All are fixed:

- [x] **The answer-drag guard was inert.** It armed from `onPointerDown` on the `sr-only` radio input, which a pointer landing on the option's *text* never touches, so `ignoredEcho` was never set — and my e2e assertion that "dragging an option does not choose it" passed only because Chromium suppresses `click` after a drag-select. It now reads `isSatSelectionGestureEcho()` at activation time, so every activation path (label click, option text, keyboard) is covered, and the shared per-widget ref is gone. The gesture also arms the guard for ANY completed selection, including one that cannot be anchored. New `SatSingleChoiceAnswer.guard.test.tsx` activates the option the way a student does, which is the test that was missing.
- [x] **The selection toolbar never took focus.** `FOCUS_CALLS` showed `focus(BUTTON:Highlight Yellow) visibility=hidden`, and the effect was keyed on the anchor only, so it never retried: `Tab` went to the split divider and the documented one-keystroke keyboard path did not exist. `useSatAnnotationAutofocus` now focuses the first action once per anchor *after placement lands*, for the toolbar/dock and for the edit dock (so a tap or an Enter on a mark leaves the caret inside the editor).
- [x] **A drag inside an existing highlight could not start a selection** (measured: toolbar 0, edit dock 1), contradicting the `allowAnnotationControls` intent. `isSatDragRelease` compares the release point with the recorded pointer origin, so a drag over a mark is a new selection and only a real tap opens the editor.
- [x] **The selection tint followed an unrequested rule.** The last-used-ink preview (`previewColor`) was a behavior nobody asked for; it is removed, leaving the pre-existing paper-token preview contract untouched.

Design and quality work in the same pass:

- [x] **`useSatAnnotationSurface`** now owns annotation state, mutation, chrome, undo, announcements, and the teaching cues. `SatExamShell.tsx` dropped from 784 to 597 lines and no longer holds five pieces of annotation chrome state beside the interaction machine; `editingMarkId`, the note editor id, and the undo entry have one owner.
- [x] **One panel for both placements:** `SatSelectionActionsPanel` with `variant: 'floating' | 'docked'` replaced `SatSelectionToolbar` + `SatTouchAnnotationDock`.
- [x] **One markup branch per mark** in `SatAnnotatedContent` (interactive attributes are added, not duplicated), and the dead `data-sat-annotation-mode` attribute plus the view's `selection` field are gone.
- [x] **Every label and accessible name comes from `SAT_COPY`** — the eight annotation keys that had no production reader (`highlight`, `underline`, `selectedTextActions`, `editAnnotation`, `addNote`, `editNote`, `removeHighlight`, `removeUnderline`) are now the single source for the visible words and the aria names.
- [x] **Dead production code deleted:** `removeSatAnnotationsInRange`, `findSatAnnotationAtAnchor`, `countSatTextAnnotations`, `clearSatAnnotationEducation`, and the replaced hand-rolled trash/highlighter SVGs (lucide `Trash2` / `Highlighter` instead).

---

## Iteration 2: notes as a structural column (the layout explains the model)

The first delivery taught the feature through labels and behaviour, but the notes
still lived in overlays: a `fixed right-4 z-70` panel for the question note and a
`Dialog` note card with a `bg-black/20` scrim for the selected-text note. A
review of the running app named the consequence — the student had to travel the
whole viewport to connect a note to its source, the exam dimmed as if they had
left it, and two note concepts ("Question note", "Note on selected text") asked
them to work out which was which. This iteration makes the layout itself explain
the model:

```
select something -> mark it -> the note appears beside what I marked
```

- **`SatNotesColumn`** replaces both overlays. It is one list: anchored notes
  quoting their source with the ink dot of their mark, plus the question's own
  note as the same card with a different source line. No scrim, no dialog, no
  Save button (idle autosave, commit on blur/close, transient "Saved"), no
  always-visible `0/2000` (the count appears at 1,600 and turns into a warning at
  1,900 — `domain/satNoteEntry.ts`), and removal only exists once there is a note
  to remove.
- **`SatNotesSurfaceContext`** carries the shell-composed column into
  `SatQuestionWorkspace`, which owns the grid: `Passage | Notes | Question` at
  ≥1024px (`320px` fixed for notes, the rest split by the student's ratio), and a
  full-width row under the question below that — a row, never an overlay.
- **Teaching moved into the passage.** The floating "Select any text" pill and
  the top-right first-use hint are gone; one quiet line with a highlighter glyph
  renders at the top of the passage text it is talking about.
- **Both directions of the highlight ↔ note link** now work: choosing a note
  scrolls the passage pane (only that pane, centred, reduced-motion aware) to its
  mark, and tapping a mark scrolls its card into view and rings it.
- **Removed:** `ui/question/SatNotesPanel.tsx`, `ui/annotations/SatAnnotationNoteEditor.tsx`,
  `SatAnnotationEmptyNotesCoach`, `SatAnnotationSelectTextCoach`,
  `SatAnnotationFirstUseHint`, the `--sat-note-header` token, and the copy keys
  for the two-concept model. `satAnnotatedNotes` gained an `editingId` so a mark
  chosen for its first note appears as a card immediately.

Two deliberate trade-offs, both recorded rather than hidden:

- A completely empty column shows guidance only: the freeform note about the
  question is reachable once the column has any content, because a note with no
  source is outside the model this layout teaches.
- Below 1024px the column stacks under the question. Three panes at 768–1023px
  would leave the passage and question ~224px each, and readable text beats a
  strict three-column rule.

---

## Iteration 3: one state, three placements, and a close that returns the caret

The audit of iteration 2 found three things worth fixing, all of them structural.

**One state.** "Is the column open, which card is active, which field is open" was
answered in three places — the interaction machine's surface kind, the shell's own
derivation, and the annotation being edited. `domain/satNotesUi.ts` now holds the
one union:

```ts
{ kind: 'idle' } | { kind: 'selection' } | { kind: 'notes'; editorId; activeId }
```

`satNotesUiFromSurface` is the single translation from the machine, and the
sentinel `SAT_QUESTION_NOTE_EDITOR` is why writing about the question is a *state*
rather than a flag: the machine gained a `question-note-editor` surface, so Escape,
close, and focus return need no special case. `SatNotesSurfaceHost` owns the
chrome and the placement decision; the workspace only renders the placement it is
handed, and no component re-derives it.

**Three placements, one rule.** `satNotesPlacement({ open, compact, threeColumn })`
returns `none | column | pair | row`:

- `column` (≥1024px) — `Passage | Notes | Question`, the column at
  `clamp(280px, 20%, 340px)`;
- `pair` (768–1023px) — **`Passage | Notes` while notes are open**, exactly what the
  review asked for at narrower widths: three panes here would leave both reading
  panes ~224px, so the note takes the question's place and the close control says so
  ("Close notes and show the question") and brings it back;
- `row` (phone) — notes stack full width beneath both panes.

**Closing is a return.** Every close path (the button, Escape, a question change)
runs through the hook's `closeNotes`, which hands focus back to the mark the note
was about, else the row for the question's own note, else the trigger — and reports
whether the target actually took focus, so an unfocusable element falls back
instead of leaving the caret on `<body>`.

Two smaller corrections came out of the same pass: the column is keyed by question
again (`questionKey` on the host), which is what makes a half-typed draft commit to
its own question and never onto the next one; and the question's own note is a row
in the same list — a card once written, a quiet dashed "Write a note about this
question" until then — so the capability the empty state had quietly removed is
reachable in every state without a permanently open textarea.

The note field, its idle autosave, its progressive counter, and its conditional
Remove were extracted to `SatNoteField.tsx`, used by both cards, so the two can no
longer drift apart.

---

## Verification

| Command | Result |
|---|---|
| `bunx vitest run src/features/student-delivery` | **100 files / 685 tests passed** (iteration 3: + `satNotesUi`, `SatNotesSurfaceHost`, the two focus-return helpers, the three placement tiers, the draft-across-questions case) |
| `bunx vitest run` | **627 files / 4625 tests passed, 0 failed** — the whole repository, including the admin and exam-ingestion failures that were red before this pass (the missing `gradingErrorMessage` in five test mocks plus a `document` shadowing a DOM global); three unhandled `presence`-polling log lines remain and are unrelated console noise |
| `bun run typecheck` (`tsc --noEmit`) | clean apart from one pre-existing error in `services/authoring-coedit/src/persistence.ts` (untouched by this work) |
| `cd backend/go && go test ./internal/attempts/...` | **ok** |
| `bunx playwright test --config playwright.sat-a11y.config.ts` (full profile, iteration 3) | **104 passed, 12 failed** — 3× Desmos embed (network-bound), 3× Reference-header hit-area (recorded finding), 3× floating-calculator geometry, 3× landscape-iPad calculator touch targets (sub-pixel iframe settle); every remaining failure is a calculator/Reference/Desmos test and none touches an annotation surface |
| `… -g "closing a note returns the caret"` (iteration 3) | **3 passed** — the regression the audit found: closing a note returns focus to the marked span, and Escape after writing about the question returns it to the entry that opens the column; the anchored text was committed on the way out |
| `… -g "abandoned by navigating"` (iteration 3) | **3 passed** — a half-typed note survives Next → Previous (chrome does not follow the student, the draft does) |
| `… -g "at tablet widths notes take the question's place"` (iteration 3) | **3 passed** — `pair` tier: the column sits beside the passage, the question's box is gone, and the labeled close control brings it back with focus |
| Guard probe (temporary, deleted after the run) | selection gesture + activation on the option's text in the same task → **refused, and nothing committed** (state survived a forced re-render); activation after the window, a real click, and keyboard `Space` → **all accepted** |
| `… -g "notes open as a column beside the exam"` (iteration 2) | **3 passed** (chromium, touch-chromium, webkit) — opening the entry yields a column, no dialog and no backdrop, passage and question both still visible, Escape returns focus to the trigger, and the column's box sits **between** the passage and the question (320px wide) — the layout claim, asserted as geometry in three engines |
| `… -g "notes column report no"` (iteration 2) | **3 passed** — new axe scan of the notes column with the caret in a note field |
| `… -g "Reading text at 200 percent"` (iteration 2) | **1 passed** — caught a real bug: the note field had lost `sat-reading-copy`, so the student's text size did not apply to their own notes until this run |
| `eslint src/features/student-delivery` | 0 errors; the 7 remaining warnings are pre-existing in files this work did not author |
| `… -g "selected text raises labeled highlight controls\|axe: the selection toolbar"` | **2 passed** — the rewritten selection-first journey and the axe scan of the toolbar + edit dock, in a real browser over the dev harness |
| `bunx eslint src/features/student-delivery` (iteration 2) | 0 errors |

## Open items

- **Iteration 3:** the column's width is a band (`clamp(280px, 20%, 340px)`), not a
  handle. A draggable notes width (or a ratio token) would let a student trade
  reading width for note width on a wide screen; today only the passage/question
  ratio is adjustable.
- **Iteration 3:** on the `pair` tier the question is genuinely off screen while a
  note is written. The close control says so and restores it, but a student who
  needs to re-read the question mid-note has to close the column to do it. A
  collapse-to-strip affordance (or a peek) is the obvious next experiment.

- `e2e/sat-answer-recovery.spec.ts` (rewritten for the selection-first flow) still needs a live backend + MySQL stack; it is the only changed spec that could not be executed here.
- iPad hardware pass for §5/§34: the guard is now proven with synthetic-but-realistic input in Chromium (`GUARD_BLOCKS_MISTAP`, `GUARD_NOT_COMMITTED`), but a real finger on glass is still the acceptance test the brief asked for.
- Keyboard-only initiation of a selection is still impossible: plain passage text is not focusable, so `Shift+Arrow` produces nothing and `Ctrl+A` spans multiple blocks (correctly rejected). The keyboard path is now complete *from* a selection — the toolbar takes the caret, arrow keys walk it, Enter applies — and marks themselves are reachable and activatable by keyboard. Whether to add a keyboard-only way to create a selection is a product decision the brief did not make.
- The nine remaining failures in the full `sat-a11y` profile belong to the
  calculator/Reference/Desmos workstream (network-bound embed, sub-pixel iframe
  settling, the recorded Reference hit-area finding); none touches an annotation
  surface, and the notes/citations geometry assertions run green in three engines.
- A real finger on iPad glass is still the acceptance test nobody has run: the
  column's touch behaviour, the dock-to-column transition after "Add note", and
  the answer-gesture guard are all only proven with synthetic input here.
