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

## Verification

| Command | Result |
|---|---|
| `bunx vitest run src/features/student-delivery` | **96 files / 635 tests passed** |
| `bunx vitest run` | 4567 passed, 8 failed — all 8 in other workstreams' files (`src/components/admin/*`, `src/features/exam-authoring/editor/ingestion/*`) and the two architecture baselines that flag exactly those files; none import anything changed here |
| `bun run typecheck` (`tsc --noEmit`) | clean apart from one pre-existing error in `services/authoring-coedit/src/persistence.ts` (untouched by this work) |
| `cd backend/go && go test ./internal/attempts/...` | **ok** |
| `bunx playwright test --config playwright.sat-a11y.config.ts --project chromium` | **33 passed, 2 skipped, 4 failed** — the four are the calculator/Reference/Desmos tests (network-bound Desmos embed plus the already-recorded Reference-header hit-area finding); no annotation surface is involved and none of those sources were touched |
| Guard probe (temporary, deleted after the run) | selection gesture + activation on the option's text in the same task → **refused, and nothing committed** (state survived a forced re-render); activation after the window, a real click, and keyboard `Space` → **all accepted** |
| `eslint src/features/student-delivery` | 0 errors; the 7 remaining warnings are pre-existing in files this work did not author |
| `… -g "selected text raises labeled highlight controls\|axe: the selection toolbar"` | **2 passed** — the rewritten selection-first journey and the new axe scan of the toolbar + edit dock, in a real browser over the dev harness |

## Open items

- `e2e/sat-answer-recovery.spec.ts` (rewritten for the selection-first flow) still needs a live backend + MySQL stack; it is the only changed spec that could not be executed here.
- iPad hardware pass for §5/§34: the guard is now proven with synthetic-but-realistic input in Chromium (`GUARD_BLOCKS_MISTAP`, `GUARD_NOT_COMMITTED`), but a real finger on glass is still the acceptance test the brief asked for.
- Keyboard-only initiation of a selection is still impossible: plain passage text is not focusable, so `Shift+Arrow` produces nothing and `Ctrl+A` spans multiple blocks (correctly rejected). The keyboard path is now complete *from* a selection — the toolbar takes the caret, arrow keys walk it, Enter applies — and marks themselves are reachable and activatable by keyboard. Whether to add a keyboard-only way to create a selection is a product decision the brief did not make.
- The four pre-existing calculator/Reference/Desmos failures in `sat-student-accessibility.spec.ts` belong to the floating-tool workstream, not this one.
