# SAT Phase 03 - Dirty-Guard Dialogs + Interaction Safety (PLAN ONLY)

> Scope: src/products/sat/ui/ConfirmDialog.tsx + SatSessionsRoute.tsx New Session sheet + SatExamLibraryRoute.tsx New SAT dialog. No .sat-ui diff. No behavior change except mandated dirty-guard.

## Objective

Add confirm-on-dirty to both SAT creation dialogs so staff never lose typed input to accidental overlay click, Escape, Cancel, or Close. Preserve every contract: pristine dialogs close immediately on all dismissal paths; one modal visible at a time; focus returns to the trigger that opened the dialog; a save in flight can never be discarded. No token, type-scale, copy, search, roster, or dark-mode work - those belong to Phases 01, 02, 04, 05.

## Dependencies

- Phase 01 (Type floor + contrast + density) REQUIRED first. Frozen inputs consumed verbatim: 6-step type scale (floor 11px medium, control-hint 12px semibold); sat-dialog-overlay and sat-dialog-center plus .sat-product portal-scope contract; focus-visible ring tokens (--sat-staff-accent-ring, --sat-staff-accent-ring-soft); 44px primaries. Phase 03 changes no class, token, hex, or scale value Phase 01 owns. If Phase 01 renames a dialog class, adopt the renamed value verbatim.
- Phases 02 and 04 are parallel with disjoint files. Do not edit SatResultsRoute, SatResultDetailRoute, SatSessionRoomRoute, SatRoot, or SatPage in this phase. Do not rename New SAT or Create (Phase 02 owns action names). Do not touch roster rows (Phase 04).
- Phase 05 (dark appearance) is downstream. Use existing semantic tokens only, no new hex literals, so dark mode restyles for free.
- Import baseline: SatSessionsRoute line 12 already imports SatConfirmDialog and SatFormDialog. SatExamLibraryRoute line 10 imports SatFormDialog only and must add SatConfirmDialog.

## Affected / new files (with line refs where known)

1. src/products/sat/ui/ConfirmDialog.tsx (208 lines). SatConfirmDialogProps type L14-22. OVERLAY_CLASS L24 = sat-dialog-overlay sat-product. CONFIRM_CLASS L25 = sat-dialog sat-dialog-center sat-product w-[calc(100vw-40px)] max-w-[390px] p-5. FORM_CLASS L26 = sat-dialog sat-dialog-center sat-product w-[calc(100vw-40px)] max-w-[480px] overflow-hidden. CANCEL_BUTTON_CLASS L28-29, CONFIRM_BUTTON_CLASS L30-31, DESTRUCTIVE_BUTTON_CLASS L32-33. StaticConfirmDialog L35-84 (Cancel autofocus L43-56, alertdialog markup L58-83). SatConfirmDialog L86-133 (Radix AlertDialog.Root L109, Cancel-first focus). SatFormDialogProps L140-146. StaticFormDialog L151-178 (Escape to onClose L154-160, Close button L170-172). SatFormDialog L180-208 (Dialog.Root onOpenChange L186, Dialog.Close L197-201). Change in this phase: additive helper export only, no visual or class change.
2. src/products/sat/routes/SatSessionsRoute.tsx (248 lines). NewSatSessionSheet L192-248. confirmDiscard state L193. Fields: examId L200, cohort L202, institution L203, start L204, end L205, saving prop L192, selectedExam L208. SatFormDialog onClose L232, Cancel L240, Schedule submit L241, discard alert L245 with title Discard this session? and description The session name and details you entered will be lost. and confirmLabel Discard plus destructive. Gap today: dirty check covers only cohort and institution (L232, L240); start and end and exam drift are the gap.
3. src/products/sat/routes/SatExamLibraryRoute.tsx (184 lines). createOpen L53, title L55, creating L52, createError L56, inputRef L57 plus autofocus effect L73-77. openCreate reset L79-83. createExam submit L85-106 (early return when blank or creating L88, setCreating true L89, success close plus navigate L98-100). SatFormDialog L167 with onClose setCreateOpen false unconditional (the bug). Cancel L177 unconditional. Create submit L178 disabled when blank title or creating. No SatConfirmDialog import or discard state today.
4. Tests only, no new source files. Extend src/products/sat/ui/__tests__/Dialogs.test.tsx (223 lines today), src/products/sat/routes/__tests__/SatSessionsRoute.test.tsx (168 lines, dirty test L103-114 today), src/products/sat/routes/__tests__/SatExamLibraryRoute.test.tsx (126 lines). No new store, network, auth, route, or CSS file.

END-PART-1

## Contracts / interfaces (frozen inputs from Phase 01 if relevant; what you must not break)

1. SatConfirmDialog alert contract (frozen, reuse verbatim, no signature or visual change). Props: open, title, description, confirmLabel, destructive?, onCancel, onConfirm. Renders role=alertdialog named by title. Cancel owns initial focus. Escape routes to onCancel. Overlay pointerDown never dismisses. Portal overlay and content carry .sat-product scope classes. Destructive confirm uses DESTRUCTIVE_BUTTON_CLASS. Phase 03 reuses this component for both discard alerts; no new alert component, no prop rename, no class change.
2. SatFormDialog sheet contract (frozen, interception-free primitive). Props: open, eyebrow, title, onClose, children. Renders role=dialog named by title. Escape and Close-X both route to single onClose. open false renders nothing. Stacked sheets keep unique aria-labelledby via useId. Callers own dirty interception by passing a guarded onClose. Existing Dialogs.test.tsx assertions keep passing unchanged.
3. Dirty helper contract (new, additive, pure, no JSX, no hooks). Export isSatCreationDirty from ConfirmDialog.tsx with frozen signature isSatCreationDirty(fields: { title: string; cohort?: string; exam?: string; start?: string; end?: string }): boolean. Returns title.trim not empty OR cohort trimmed not empty OR exam trimmed not empty OR start trimmed not empty OR end trimmed not empty. Whitespace-only counts as pristine. Safe to call on every render.
4. One-modal-at-a-time plus focus-return contract. Form sheet and discard alert are never co-interactive: when the alert opens the sheet is inert behind it via the Radix AlertDialog trap; Cancel owns autofocus; confirming discard unmounts both; cancelling the alert returns focus into the sheet. Closing the sheet returns focus to the trigger (New Session or New SAT) via Radix automatic return-focus. No new focus library; keep existing rAF focus-first-field effects.
5. Save-in-flight contract. While saving or creating is true the draft is not discardable: dismissal paths that would abandon the save are suppressed via early return; the Discard confirm path also early-returns if the flag flips mid-alert. Submit buttons keep existing disabled expressions including the in-flight flag. Success close bypasses the guard; failure keeps the draft with values intact and role=alert error.
6. Must-not-break list. Filtering, 4000ms SAT polling, proctor actions, routing, validation messages (End time must be after the start time. / Start time is in the past. / Sessions must be at least 15 minutes long.), skeleton-XOR loading, empty-state next actions, SAT-only provider boundary (useExamListQuery true plus sat, IELTS never offered), Title-Case labels (Phase 02 owns), type classes and tokens (Phase 01 owns), .sat-ui (never diff).

END-PART-2

## Step-by-step implementation (ordered, each step names exact file + exact change: old class/token → new class/token, old string → new string)

Step 1 - src/products/sat/ui/ConfirmDialog.tsx: add pure dirty helper, change nothing else. After the SatConfirmDialogProps type block (after L22, before OVERLAY_CLASS L24) insert the documented helper isSatCreationDirty with the frozen signature from Contracts item 3 plus the doc comment Returns true when a creation form holds user-typed content worth confirming before discard. Whitespace-only counts as pristine. No class edit, no token edit, no string edit, no prop change to either dialog primitive.
Step 2 - src/products/sat/routes/SatSessionsRoute.tsx L12: extend the import. Old: import { SatConfirmDialog, SatFormDialog } from ../ui/ConfirmDialog. New: import { SatConfirmDialog, SatFormDialog, isSatCreationDirty } from ../ui/ConfirmDialog. No other import change.
Step 3 - src/products/sat/routes/SatSessionsRoute.tsx NewSatSessionSheet: derive one shared dirty flag before return (after L208 selectedExam line). Set const dirty = isSatCreationDirty({ title: cohort, cohort: empty, exam: empty, start: default-compared start, end: default-compared end }) OR institution.trim() not empty. Mapping rationale: cohort is the session-name field and fills the helper title slot; institution is optional metadata OR-ed explicitly; exam passes empty because the select always has a preselected value that must never alone mark the sheet dirty; start and end use default comparison per Step 4.
Step 4 - src/products/sat/routes/SatSessionsRoute.tsx: compare start and end against prefilled defaults so prefill is not dirty. Capture defaults once with const initialRef = useRef(initial) next to L194 initial (useRef already imported L1). Pass start only when start differs from initialRef.current.start else empty, and likewise for end. Net effect: untouched open is pristine; typing non-whitespace into Session name or Institution is dirty; changing either datetime away from its prefilled default is dirty; whitespace-only typing stays pristine via helper trim.
Step 5 - src/products/sat/routes/SatSessionsRoute.tsx: single guarded closer plus lock during save. Add const requestClose = () => { if (saving) return; if (dirty) setConfirmDiscard(true); else onClose(); }. Replace L232 onClose arrow (which tests only cohort or institution) with onClose={requestClose}. Replace L240 Cancel onClick arrow with onClick={requestClose}. The Radix overlay and onOpenChange path funnels into SatFormDialog onClose so it is covered with no extra code. While saving is true every dismissal path (Escape, X, Cancel, overlay) is a no-op until save settles.
Step 6 - src/products/sat/routes/SatSessionsRoute.tsx L245 discard alert: keep mounted strings byte-identical (title Discard this session?, description The session name and details you entered will be lost., confirmLabel Discard, destructive present, Cancel from primitive). Change onConfirm to early-return when saving, then setConfirmDiscard false and onClose. The Step 5 early return already prevents opening the alert mid-save; the onConfirm guard covers the race where save starts after the alert opened. Do not add a disabled prop to SatConfirmDialog; do not hide the alert with a saving condition that strands the user; do not change any class or token on this line.
Step 7 - src/products/sat/routes/SatSessionsRoute.tsx focus: make no source change beyond Steps 2-6. Radix Dialog already returns focus to the focused trigger (New Session button) on close. Add only a regression test pinning document.activeElement back on New Session after pristine Cancel (see Tests). Do not invent a new focus utility, do not pass ref into SatPrimaryButton (it takes no ref prop), do not add querySelector focus hacks.
Step 8 - src/products/sat/routes/SatExamLibraryRoute.tsx L10: extend the import. Old: import { SatFormDialog } from ../ui/ConfirmDialog. New: import { SatConfirmDialog, SatFormDialog, isSatCreationDirty } from ../ui/ConfirmDialog. No other import change.
Step 9 - src/products/sat/routes/SatExamLibraryRoute.tsx: add discard state plus guarded closer and wire all paths. After L53 createOpen state insert const [confirmDiscardExam, setConfirmDiscardExam] = useState(false). After the state block insert const examDirty = isSatCreationDirty({ title }) and const requestExamClose = () => { if (creating) return; if (examDirty) setConfirmDiscardExam(true); else setCreateOpen(false); }. Replace L167 onClose setCreateOpen false with onClose={requestExamClose}. Replace L177 Cancel onClick setCreateOpen false with onClick={requestExamClose}. Keep autofocus effect L73-77 and openCreate reset L79-83 unchanged. While creating is true Escape, X, Cancel, overlay all no-op.
Step 10 - src/products/sat/routes/SatExamLibraryRoute.tsx: render the discard alert after closing SatFormDialog L181 and before closing SatContainer L182. Insert conditional confirmDiscardExam ? SatConfirmDialog open with title Discard this SAT?, description The name you entered will be lost., confirmLabel Discard, destructive, onCancel setConfirmDiscardExam false, onConfirm early-return when creating then setConfirmDiscardExam false and setCreateOpen false. Sheet stays inert while alert is open via Radix trap; alert Cancel autofocuses via primitive; confirming unmounts both. Do not rename dialog title New SAT L167 or Create L178; action names belong to Phase 02.
Step 11 - Both routes: audit dismissal paths. Allowed unguarded setCreateOpen false occurrences after this phase are exactly the discard-alert onConfirm handlers and the post-save success paths (Sessions L181 onCreate wrapper after mutateAsync; Library L99 after successful create plus navigate). Success paths must NOT route through requestClose or requestExamClose. Library openCreate L79-83 keeps resetting title and createError so a reopened dialog starts pristine.

END-PART-3

## Key code / pseudocode (dirty-guard logic, token blocks, row markup — only what your phase needs)

Helper - ConfirmDialog.tsx additive only:
```ts
export function isSatCreationDirty(fields: { title: string; cohort?: string; exam?: string; start?: string; end?: string }): boolean {
  return fields.title.trim() !== "" || (fields.cohort ?? "").trim() !== "" || (fields.exam ?? "").trim() !== "" || (fields.start ?? "").trim() !== "" || (fields.end ?? "").trim() !== "";
}
```
Sessions sheet - derived dirty plus guarded closer (Steps 3-6):
```tsx
const initialRef = useRef(initial);
const dirty = isSatCreationDirty({
  title: cohort,
  cohort: "",
  exam: "",
  start: start !== initialRef.current.start ? start : "",
  end: end !== initialRef.current.end ? end : "",
}) || institution.trim() !== "";
const requestClose = () => {
  if (saving) return;
  if (dirty) setConfirmDiscard(true);
  else onClose();
};
// usage: <SatFormDialog open eyebrow="Digital SAT" title="New Session" onClose={requestClose}>
// Cancel: <button type="button" onClick={requestClose}>Cancel</button>
// alert keeps frozen strings: title Discard this session?, description The session name and details you entered will be lost., confirmLabel Discard, destructive; onConfirm early-returns when saving.
```
Library dialog - dirty guard (Steps 9-10):
```tsx
const [confirmDiscardExam, setConfirmDiscardExam] = useState(false);
const examDirty = isSatCreationDirty({ title });
const requestExamClose = () => {
  if (creating) return;
  if (examDirty) setConfirmDiscardExam(true);
  else setCreateOpen(false);
};
// usage: <SatFormDialog open={createOpen} eyebrow="Digital SAT" title="New SAT" onClose={requestExamClose}>
// Cancel: <button type="button" onClick={requestExamClose}>Cancel</button>
// alert: {confirmDiscardExam ? <SatConfirmDialog open title="Discard this SAT?" description="The name you entered will be lost." confirmLabel="Discard" destructive onCancel={() => setConfirmDiscardExam(false)} onConfirm={() => { if (creating) return; setConfirmDiscardExam(false); setCreateOpen(false); }} /> : null}
```
No token block, no row markup, no CSS in this phase. All classes, tokens, hex values, and copy outside the two frozen discard strings stay exactly as Phase 01 and current code leave them.

END-PART-4

## Edge cases (empty states, loading/error, polling refresh, keyboard, reduced-motion/transparency/contrast, forced-colors, 320px, 200% text)

- Empty states: guard is orthogonal. Empty-library New SAT and empty-sessions flows open the same dialogs with identical pristine and dirty semantics. No empty-state markup change.
- Loading: Sessions sheet examsLoading branch shows role=status Loading published SAT exams... Loading never marks dirty because the guard reads only text and datetime state; Schedule stays disabled while no selectedExam. Library dialog has no loading branch.
- Error: field role=alert validation messages and save-failure messages keep exact text with the form mounted and values intact. Validation errors never open the discard alert and never clear a field. Save failure leaves the sheet open and dirty so retry is possible.
- Polling refresh: 4s session-summary polling updates the list behind the open sheet. Sheet state is local only; refresh never resets cohort, institution, start, or end and never force-closes dialog or alert. Bucket auto-switch does not touch dialog state.
- Keyboard: Tab reaches every field, Cancel, Schedule or Create, X, and alert Cancel and Discard in trap order. Enter submits. Escape on pristine sheet closes immediately. Escape on dirty sheet opens the discard alert instead of closing. Escape inside the alert cancels the alert only and returns focus to the sheet. Alert Cancel autofocuses, never Discard. No new key handler; reuse existing Radix plus static-branch Escape wiring.
- Focus return: pristine Cancel, X, Escape, overlay returns focus to New Session or New SAT trigger via Radix automatic return-focus. Alert Cancel returns focus into the sheet. Discard confirm unmounts both and returns focus to the trigger. Pin with tests; add no new focus utility.
- Reduced motion, transparency, contrast, forced colors: no new motion, transparency, or color in this phase. Both alerts reuse frozen primitive classes so the existing route-fade reduced-motion guard, glass collapse, contrast remaps, and forced-colors mappings apply unchanged. New tests assert no pixel motion.
- 320px narrow: sheet already docks via sat-dialog-center plus max-w-480px w-calc-100vw-40px; alert caps at max-w-390px w-calc-100vw-40px. Guard adds no width or overflow or new element. Manual resize check only.
- 200 percent text: discard strings are short single sentences that wrap inside the capped alert width; buttons stay min-h-10 targets; no truncation CSS added.
- Save-in-flight race: if save starts after the alert opened, onConfirm early return suppresses discard; alert stays open but inert until save settles; success then closes everything via post-mutateAsync setCreateOpen false. Never trap: pristine close and post-save close always succeed; guard adds at most one explicit Discard step on the dirty path.
- Whitespace-only input: helper trims so spaces, tabs, newlines alone equal pristine and close immediately. Dedicated unit case required.
- Exam-select preselect: Sessions examId defaults to exams[0].id; preselected value never marks dirty because exam slot passes empty; only free text and datetime edits count. Library has no select.

END-PART-5

## Tests (which existing tests must pass; which new unit/contract tests to add, with file paths and assertion sketches)

Existing tests that must keep passing unchanged (edit none unless Phase 01 renames a pinned class or token):
- src/products/sat/ui/__tests__/Dialogs.test.tsx: all 11 cases (alert name plus description plus answers, Cancel answer, Escape cancel, closed-renders-nothing x2, named dialog plus Escape close, Close-button close, portal scope x2, stacked unique ids x2, backdrop pointerDown never dismisses, Cancel autofocus). Add new describe blocks only.
- src/products/sat/routes/__tests__/SatSessionsRoute.test.tsx: all 11 cases including L103-114 dirty and pristine, D2 time policies, skeleton, count announcement, composition guard, 10px hierarchy guard. L103-114 passes unmodified because its dirty input is Session-name text (dirty under old and new predicates) and its pristine input is untouched defaults (pristine under both via default comparison).
- src/products/sat/routes/__tests__/SatExamLibraryRoute.test.tsx: all 9 cases including provider boundary, direct create, skeleton, count, Clear search, archived toggle, disabled-until-typed, composition guard, row-chrome guard.
- src/products/sat/ui/__tests__/satContractsCss.test.ts: F-A6 search-clear and F-A12 route-fade; untouched because this phase adds no CSS.

New tests to add in existing files, no new infra:
- Dialogs.test.tsx new describe isSatCreationDirty (6 assertions): import isSatCreationDirty from ../ConfirmDialog; empty title is false; whitespace-only title is false; October Practice title is true; empty title plus cohort Morning is true; empty title plus start 2099-09-01T10:00 plus end 2099-09-01T13:00 is true; all slots empty is false.
- SatSessionsRoute.test.tsx new its reusing renderRoute plus mocks: edited start and end with empty name opens Discard this session? on Cancel then Discard closes both; pristine Escape closes sheet with no alertdialog; saving pending keeps sheet mounted on Cancel attempt (mock useSaveScheduleMutation to pending mutateAsync); pristine Cancel returns focus to New Session trigger (document.activeElement is New Session button).
- SatExamLibraryRoute.test.tsx new its reusing renderRoute plus createProviderExamMock: pristine Cancel closes with no alertdialog; dirty Cancel opens Discard this SAT? with description The name you entered will be lost., alert Cancel keeps sheet open with typed value intact, X Close reopens alert, dirty Escape reopens alert, Discard unmounts both; creating pending keeps sheet mounted on Cancel; failed create shows role=alert boom with input value intact and Cancel still opens the discard alert.

END-PART-6

## Verification (exact commands: vitest paths, tsc, eslint, grep gates, contrast recompute)

Run from repo root in order; all must be green (or documented-skip for e2e) before done:
1. npx vitest run src/products/sat/ui/__tests__/Dialogs.test.tsx src/products/sat/routes/__tests__/SatSessionsRoute.test.tsx src/products/sat/routes/__tests__/SatExamLibraryRoute.test.tsx — owned suites including all new dirty and pristine cases.
2. npx vitest run src/products/sat — full SAT staff slice (routes plus ui plus contracts) to catch composition and hierarchy guard regressions.
3. npx tsc --noEmit — type gate for helper export, new state, guarded closers.
4. npx eslint src/products/sat/ui/ConfirmDialog.tsx src/products/sat/routes/SatSessionsRoute.tsx src/products/sat/routes/SatExamLibraryRoute.tsx src/products/sat/ui/__tests__/Dialogs.test.tsx src/products/sat/routes/__tests__/SatSessionsRoute.test.tsx src/products/sat/routes/__tests__/SatExamLibraryRoute.test.tsx — lint gate on every touched file.
5. Grep gates: rg -n setCreateOpen-false in SatExamLibraryRoute.tsx shows exactly discard-confirm plus success close and no other unguarded close; rg -n requestClose plus requestExamClose plus isSatCreationDirty plus confirmDiscard in src/products/sat shows hits only in the 3 owned files plus owned tests with zero hits in SatResultsRoute, SatSessionRoomRoute, SatRoot, SatPage; rg -n text-8px and text-9px in src/products/sat is informational for Phase 01 (Phase 03 must add none); git diff --stat over src/features/student-delivery and index.css is empty (no .sat-ui or token diff; allowed diff is exactly the 3 owned source files plus 3 owned test files).
6. npm run build (vite build) — production bundle gate.
7. npm run e2e:sat-a11y (playwright test --config playwright.sat-a11y.config.ts) — run when browsers exist; otherwise record skip with reason and keep vitest plus tsc plus eslint plus build as binding signal. No contrast recompute required for this phase (no color, token, or type change); contrast table stays as Phase 01 leaves it.

## Definition of done (checklist, measurable)

- [ ] isSatCreationDirty exported from ConfirmDialog.tsx, pure, trims all slots, covered by 6 unit assertions; no other line in that file changed.
- [ ] New Session sheet: pristine overlay, Escape, Cancel, X closes immediately with zero alertdialog; dirty name, institution, or non-default start and end on any of those four paths opens exactly one Discard this session? alert with byte-identical strings; one modal at a time with sheet inert behind alert.
- [ ] New SAT dialog: pristine Cancel, X, Escape, overlay closes immediately; dirty non-blank title opens exactly one Discard this SAT? alert with byte-identical strings; alert Cancel returns to sheet with typed name intact; Discard unmounts both.
- [ ] Save-in-flight never discardable: saving and creating suppress all four dismissal paths and the Discard confirm race; success close bypasses guard with no second alert; failure keeps draft plus role=alert with values intact.
- [ ] Focus: alert Cancel autofocuses; Escape in alert cancels alert only; close returns focus to New Session or New SAT trigger; no new focus utility; keyboard-only open, dirty, guard, discard completes with no pointer.
- [ ] No behavior change beyond guard: filtering, polling, validation texts, skeleton and empty states, provider boundary, routing, Phase-01 classes and tokens untouched; git diff --name-only shows at most the 3 owned source files plus 3 owned test files.
- [ ] Gates green: owned vitest suites plus full vitest run src/products/sat plus tsc --noEmit plus scoped eslint plus vite build (plus e2e:sat-a11y or documented skip); grep gates confirm single-guard routing and no cross-phase bleed.