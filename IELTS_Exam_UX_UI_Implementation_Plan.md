# IELTS Student Exam — Accessible UX/UI Implementation Plan

**Project:** `teaching01-netizen/IELTS-LMS`  
**Audience:** Frontend engineers, QA, product/design  
**Review baseline:** `main` at [`26423cedbc08408dbc9d2ea3803a56bdf258476d`](https://github.com/teaching01-netizen/IELTS-LMS/tree/26423cedbc08408dbc9d2ea3803a56bdf258476d), inspected 18 October 2026  
**Status:** Source-code review and proposed implementation; **not** a live-browser audit and **not** proof that the current tests pass  
**Primary devices:** iPad mini, standard iPad, iPad Air, iPad Pro, iPhone/Android phones, Android tablets, and tablets with physical keyboards or mouse/trackpad  
**Scope:** IELTS **Reading**, **Writing**, shared student exam shell, objective-answer controls, question navigation, accessibility, save/recovery and submission feedback  
**Explicitly out of scope:** Listening **player** redesign, staff authoring UI, proctor UI, grading algorithms, SAT/ACT styling, backend schema redesign

---

## 1. Executive design decision

**Design for the task, not for the device.** The primary job is to read exam material and enter an answer reliably. Follow Apple Human Interface Guidelines as an interaction-quality reference—quiet hierarchy, intentional spacing, touch affordances, discoverable state, accessibility, restrained motion—**not** as an instruction to imitate iOS or Safari. The application remains a cross-platform responsive **web** application.

### Non-negotiable outcomes

1. A student always knows **which section/task/question** is active, **what is answered**, **whether it has been saved**, and **what action comes next**.
2. Passage or prompt text is comfortable to read; no hidden paragraph, clipped answer, or off-screen input is required to complete the exam.
3. Every question type works with **finger, stylus, mouse, keyboard, and assistive technology** where its interaction model permits.
4. Changing orientation, browser viewport, zoom, font size, active task/pane, or opening the software keyboard **never loses an answer or changes an answer identity**.
5. Never report **“Saved”** until the existing authoritative durability workflow supports that claim. Offline/queued, syncing, and error states are distinguishable.
6. Finish/submit is deliberate, unambiguous, and protected against retries or accidental navigation. The UI must respect server-authoritative terminal state.
7. Reading/Writing improvements do not regress IELTS Listening, ACT, SAT, proctoring, or admin routes.

### Preserve the foundations already in the repository

- Geometry-aware `phone | compact | standard | wide` layout with pane-fit rules: `src/components/student/layout/studentLayoutMode.ts`.
- Stable exam-height/soft-keyboard policy and page scroll ownership: `StudentExamShell.tsx`, `studentExamViewportPolicy.ts`, `useStudentExamViewport.ts`, and the corresponding CSS.
- Reading compact panes that remain mounted with `hidden` + `inert`: `StudentMaterialWithQuestionPane.tsx`.
- Writing’s existing native-draft capture, task ownership, composition/blur/unmount commits, and response reconciliation: `StudentWriting.tsx`.
- Answer-specific components and mutation mechanisms: `QuestionRenderer.tsx`, `ProtectedInput.tsx`, the student attempt/runtime providers.
- Existing question navigator view model, accessibility preferences, split-resizer keyboard alternatives, and Playwright regression suites.

**Do not rewrite the exam state machine to accomplish a visual redesign.** Separate presentation-only changes from answer mutation and submission logic.

---

## 2. Code-level findings and prioritized opportunities

These findings are **observations from source code**. A risk marked *verify* is not a demonstrated production bug.

| ID | Priority | Source observation | Student impact / action |
|---|---|---|---|
| F01 | **P0 — verify/harden** | `StudentWriting.tsx` conditionally renders `WritingPromptPane` or `WritingResponsePane` in compact mode, whereas Reading keeps both panes mounted and inert when inactive. Writing also uses an uncontrolled textarea, draft refs and a commit-on-tab-switch path. Existing unit tests cover compact switching. | Regression risk around native composition, focus, scroll, draft hydration and rapid switches. Preserve existing draft guards; expand browser-level cases before deciding whether to keep both panes mounted. |
| F02 | **P0 — verify** | `StudentApp.tsx` applies `zoom` to the exam shell and also passes the same `contentZoom` into `StudentExamWorkspace`. `StudentReading.tsx` applies another `zoom`/scale to reading material in tablet mode. | Possible compounded zoom on Reading subpanes. Measure **actual rendered scale** at 85%, 100%, 125%, 150% on tablet Chrome and Safari. Consolidate to one predictable magnification policy if doubled. |
| F03 | **P0 accessibility** | In `StudentReading.tsx`, an inline passage `<img>` is opened via an `onClick` handler on a wrapping `<div>`. | The image viewer trigger needs an explicit keyboard-operable, labeled control without breaking selection/highlighting of adjacent text. |
| F04 | **P1** | `StudentWritingPanes.tsx` textarea uses `text-base md:text-lg` instead of the existing `--student-writing-editor-font-size` / `--student-writing-editor-line-height` variables populated by `StudentApp.tsx`. | Text-size preference might not propagate consistently to the writing editor. Tie the editor’s typography to the student-specific tokens. |
| F05 | **P1** | `QuestionRenderer.tsx` already uses padded radio/checkbox labels; table completion uses a minimum-width table inside `overflow-x-auto`. | Keep large answer-row hit areas; audit every other answer variant. For legitimate two-dimensional tables, keep scrolling *local*, add a discoverable scroll hint, and retain headers/labels. |
| F06 | **P1** | `StudentFooter.tsx` has a global navigator; Writing has a separate task footer. Compact navigation also has a distinct implementation. | Standardize wording, save state, position, and tactile behavior across Reading and Writing **without** forcing Writing to use question-number navigation. |
| F07 | **P1** | The CSS already has touch-size variables (44–48 CSS px), safe-area rules, forced-colors support and reduced-motion support. Some controls use one-off sizes and there are broad descendant selectors. | Avoid layering more global `!important` rules. Audit computed hit regions and make tokenized variants for exam controls. |
| F08 | **P1** | Accessibility settings already offer text sizes, passage density, high contrast and zoom; `StudentApp.tsx` owns corresponding tokens. | Make accessibility choices consistent in every reading, question, writing, dialogue and navigator surface. Make all states testable. |
| F09 | **P2** | `WritingResponsePane` uses a strong shadow/rounded card/slide-in animation within a larger exam shell; elsewhere multiple banners/outlined cards appear. | Simplify the visual language to quieter surfaces; preserve focus and interaction stability. |
| F10 | **P0 reliability / P1 clarity** | Save status exists in `CompactStudentHeader.tsx`; attempt/runtime providers own asynchronous answer state. | Test that user-visible status tracks actual pending/sync/offline/rejected states and that visual transitions never imply persistence prematurely. |

**Important:** Existing tests (`StudentWriting.lifecycle.test.tsx`, `student-ipad-layout.spec.ts`, `student-viewport-layout.spec.ts`, `student-durability.spec.ts`) reduce risk but do **not** establish that all physical devices, browser versions, zoom states and failure sequences are covered or passing. In particular, **`student-ipad-layout.spec.ts` opens the builder preview** (`/builder/.../preview`) for its Reading/Writing cases, so those assertions cannot substitute for a test of the actual candidate attempt route and its live runtime/persistence behavior. Run and record results.

---

## 3. Desired exam experience

### 3.1 Persistent exam chrome (all active sections)

**Top bar:** quiet and compact. Show `IELTS · Reading` or `IELTS · Writing`, active part/task, remaining time, save state, and one **Tools** button. The header must not compete with the passage. Put rarely used controls—highlight colors, accessibility, navigator—behind a clear, keyboard-accessible tools menu. A red timer treatment is reserved for the existing urgent threshold; do not flash every second.

**Main canvas:** white or near-white content, dark high-contrast text, deliberate column spacing, no decorative cards around every paragraph, no unnecessary shadows, no surprise hover-only actions.

**Bottom navigation:** one predictable place to move within the current unit and find the finish action. Reading: previous/current/next and access to question overview. Writing: task switcher and review/finish. Never make **Next** secretly submit. Avoid hiding the only route to Finish behind a horizontal overflow region.

**Feedback:** changes should feel immediate, stable and unsurprising. A response option visibly becomes selected instantly; saving is reported independently of selection. Confirmations explain consequences rather than simply asking “Are you sure?”.

### 3.2 Reading: wide/standard mode

```
┌──────────────────────────────────────────────────────────────────────┐
│ IELTS  Reading · Passage 2          Time 34:12    Saved       Tools │
├────────────────────────────────┬─────────────────────────────────────┤
│ Passage title                  │ Questions 14–26                    │
│                                │                                     │
│ Comfortable reading width      │ Question 14                         │
│ Consistent leading/paragraphs  │ ○ Option A (entire row tappable)    │
│ Scroll independently           │ ○ Option B                          │
│ Highlight or open image        │                                     │
│                                │ Answer fields remain visible       │
├────────────────────────────────┴─────────────────────────────────────┤
│ Part 1 / Part 2 / Part 3       14 of 40       Previous   Next       │
└──────────────────────────────────────────────────────────────────────┘
```

- Two **independently scrollable** panes only when both meet measured minimum readable widths and useful heights. Existing source thresholds are normal-size material ~380px, question ~430px plus rail; enlarged text increases pane minimums.
- Passage starts at a comfortable, bounded text measure, ideally near 60–72 characters per line. Keep user-configurable passage measure; **do not hardcode width to an iPad model**.
- Resizer remains optional and has visible grip, keyboard alternatives, and reset behavior. It cannot shrink a pane below readable bounds.
- Switching question within the same passage should not needlessly reset passage scroll. Moving to another passage should establish a sensible heading/focus anchor without losing selected answers.
- Content images can be enlarged through a semantic control; zoom overlay includes close, descriptive labeling and accessible navigation.

### 3.3 Reading: compact/phone mode

```
┌──────────────────────────────────┐
│ IELTS · Reading    34:12  Tools │
├──────────────────────────────────┤
│ [ Passage ]     [ Questions ]   │
├──────────────────────────────────┤
│ One readable, full-width pane   │
│ (with stable preserved state)    │
│                                  │
├──────────────────────────────────┤
│ Previous    14 of 40     Next   │
└──────────────────────────────────┘
```

- Use an explicit two-tab **Passage / Questions** control; no cramped 50/50 columns in portrait simply because the hardware is an iPad.
- Match existing Reading approach: inactive pane remains mounted when possible but is `hidden`/`inert` and removed from sequential focus order.
- Preserve answer text, flag state, question selection, passage scroll, question scroll, and the student’s chosen tab after orientation/viewport change.
- When a question references a passage paragraph, offer a **View passage** shortcut and a **Back to question** return path without discarding drafts. Do not auto-switch while a student is typing.
- Put selection and navigation controls well away from device swipe edges and safe-area insets.

### 3.4 Writing: wide/standard mode

```
┌──────────────────────────────────────────────────────────────────────┐
│ IELTS  Writing · Task 2          Time 28:30    Saved         Tools │
├────────────────────────────────┬─────────────────────────────────────┤
│ Task 2 prompt                  │ Your response                       │
│ Reference image if present     │                                     │
│ Instructions remain legible    │ Editable text with clear caret      │
│ Scroll independently           │ and natural paragraph wrapping      │
│                                │                                     │
│                                │                  Word count: 184    │
├────────────────────────────────┴─────────────────────────────────────┤
│ Task 1          Task 2                       Review and Finish      │
└──────────────────────────────────────────────────────────────────────┘
```

- **Editing is the main action.** Allocate generous width to the answer editor and avoid card-in-card presentation.
- Keep plain-text textarea and its existing composition/durability mechanics. Never replace it with a rich-text editor merely for visual polish.
- Display word count as informational, not an unexpected submission blocker. Use configured task requirements, not an inferred universal minimum. The timer remains section-authoritative.
- Reuse the text-size and spacing tokens in the editor. Make selection, cursor, multi-paragraph editing and scroll-to-caret stable with iPad/Android software keyboards and external keyboards.
- Highlighting applies to the prompt, **not** the editable answer text. Ensure highlighting cannot intercept textarea touch/drag interactions.

### 3.5 Writing: compact/phone mode

- Explicit **Task / Response** tabs, with **Response** prominent once writing begins; include a quick **View task** control in the response view.
- The active writing draft must survive immediate tab switches, rotation, background/foreground, task switches, IME composition, and an offline transition.
- Avoid focus being sent to a hidden pane. Restore the intended scroll/caret when returning to Response; focus the textarea only as a result of user intent to edit.
- Word count remains visible inside the editor pane (or in its small header), not consuming a second sticky toolbar.
- When the keyboard opens, do not hide the caret behind it, scroll the document, or cause the whole UI to jump. Keep the existing stable-shell and internal-scroll design; refine via measured viewport tests.

---

## 4. Detailed implementation work packages

### P0.1 — Writing draft and compact-pane invariants

**Owner:** Student exam UI + QA  
**Files:** `StudentWriting.tsx`, `StudentWritingPanes.tsx`, `src/components/student/__tests__/StudentWriting.lifecycle.test.tsx`, relevant Playwright Writing tests.

1. Record the existing state transitions for `activeTaskId`, `activeCompactPane`, native `editorRef`, `draftRecordsByTaskRef`, `writingAnswers`, pending debounce and `registerLiveWritingAnswer`.
2. Add browser regression tests for rapid Response→Task→Response transitions, including switching **during IME composition**, a pending debounce, keyboard opening, and a parent prop echo arriving late.
3. **Preferred implementation after tests:** keep prompt and response instances mounted in compact mode and apply `hidden` + `inert` as already done in Reading. Do not duplicate textarea instances; keep exactly one textarea per active writing task. If performance or composition behavior makes this unsafe, retain conditional mounting but explicitly rehydrate the DOM on reattachment through a stable callback ref and identity-aware draft snapshot.
4. Before hiding an active editor, commit by outgoing task ID. Do not allow a delayed event to write a prior task’s text into the newly selected task.
5. On return, restore scroll and selection where valid; do not blindly overwrite the native editor from an older server echo.
6. Keep the existing `pagehide`, visibility, blur, freeze and submission flush paths. **Do not** replace them with localStorage as the canonical answer store.

**Acceptance:** No character loss, duplication, cross-task contamination, focus on inert nodes or unexpected keyboard reopening across transitions. Existing writing reconciliation tests stay green.

### P0.2 — One magnification policy

**Files:** `StudentApp.tsx`, `StudentReading.tsx`, `StudentQuestionPanel.tsx`, `AccessibilitySettings.tsx`, `useZoomScrollAnchoring.ts`, `src/index.css`.

1. Instrument computed font sizes, bounding rectangles and `getComputedStyle(...).zoom` at 85/100/125/150% in Chromium and WebKit, in compact and split modes.
2. Investigate the observed shell `zoom` plus nested Reading `zoom`/`transform` path. For a 125% setting, visual text scaling should be predictably **one 125% user setting**, not accidentally 156% due to nested transformations.
3. Choose exactly one owner of global exam magnification. Use the existing font-scale and pane-minimum policy for reading comfort. Keep browser pinch/page zoom available.
4. When zoom makes both panes unreadable, collapse to compact mode **without changing answer state**.
5. Check that enlarged display does not clip tool sheets, timers, submit buttons, reference figures or table-answer controls.

**Acceptance:** Measured visual scale is monotonic and within defined tolerance, no compounded zoom, no loss of controls at maximum preference. Do not change `user-scalable` to `no`.

### P0.3 — Answer interaction correctness

**Files:** `QuestionRenderer.tsx`, `StudentQuestionBlockSection.tsx`, `ProtectedInput.tsx`, `ProtectedSelect.tsx`, `ProtectedExamSelect.tsx`, `TableCompletionSlotCell.tsx`, `StudentQuestionPanel.tsx`.

For **every IELTS question type** (single choice, multi-choice, TFNG/YNNG, short answer, cloze, sentence/note/table completion, matching, matching features, classification, diagram/map labeling, flow chart):

- Whole option row is an operable target; separate visual checkbox/radio glyph size from the row’s interactive region.
- Selected, unanswered, disabled and focus states are visible without relying only on color. Use native `<label>`/`<fieldset>`/`<legend>`/`input` where semantics fit.
- A single tap changes exactly one intended answer, never an adjacent answer. Scroll gestures must not activate options.
- Avoid nested interactive controls within a clickable label. Audit drag/select widgets for pointer-cancel behavior and a non-drag alternative.
- Text inputs honor composition events, focus, caret/selection, change and blur semantics, including fast taps between inputs and virtual keyboard actions.
- Multiple sub-answer slots have independent, stable identifiers and accessible names. Keyboard Tab order follows visual reading order.
- Answer mutation goes through existing revision/durability mechanisms. Do not send a second save from a new visual component.
- For disabled multi-select options at the selection limit, explain the limit with an accessible description, and make deselection obvious.
- For completion tables that genuinely require horizontal scrolling, keep scrolling **inside the table**, show an unobtrusive scroll affordance and preserve row/column relationships for assistive tech.

**Acceptance:** No double taps, phantom answers, dropped keystrokes, wrong-slot saves, scroll/tap collisions or mismatched screen-reader descriptions in the test matrix.

### P0.4 — Keyboard-operable images and safe overlays

**Files:** `StudentReading.tsx`, `StudentZoomableMedia.tsx`, `StudentWritingPanes.tsx`, possibly `sanitizeReadingPassageHtml.ts`.

- Replace the click-only inline-image activation route with a semantic focusable trigger (`button` where valid), accessible name and Enter/Space activation.
- **Do not wrap the entire highlighted paragraph in a button.** Convert only eligible inline image nodes into image-view triggers. Preserve sanitized HTML, copy/highlighting and noninteractive document text.
- In image viewer: meaningful alt/caption, visible close button, Escape dismissal, trapped focus while modal, focus return to actual originating image, bounded zoom/pan, no accidental background answer activation.
- Provide a textual description or staff-content warning when a question-critical image lacks useful alternative content. Do not hallucinate descriptions.

**Acceptance:** VoiceOver, TalkBack, keyboard and touch can open/close figures; focus returns to the correct trigger; no accidental highlight or answer mutation.

### P0.5 — Save, offline, recovery and submission clarity

**Files:** `CompactStudentHeader.tsx`, `StudentHeader.tsx`, `StudentApp.tsx`, `SubmitConfirmation.tsx`, `StudentWriting.tsx`, existing student attempt/runtime providers.

Use **one** presentational save-state view model from existing authoritative attempt state:

| Underlying state | Copy | Behavioral rule |
|---|---|---|
| Acknowledged durable | `Saved` | Only once acknowledged under the existing durability contract. |
| Local edit being sent | `Saving…` | Not synonymous with Saved. |
| Disconnected with local pending work | `Offline · changes pending` | Indicate risk clearly; never imply a server acknowledgement. |
| Reconnecting/reconciling | `Syncing…` | Resolve on server response and revision semantics. |
| Failed/rejected mutation | `Not saved · action needed` | Explain the recovery path; do not silently clear. |

- Save state must not be the same UI element as question-selection state. Avoid a toast per keystroke or a noisy `aria-live` update.
- On Review and Finish, commit live inputs, enter the **existing** flush/retry/terminalization path, and show progress or a recoverable error—not unconditional instant success.
- Use explicit counts (`Answered 32 of 40`, `8 unanswered`) and identify what can still be changed. Do not reveal scoring or correctness before the allowed phase.
- Disable duplicate submission activation while a submit is truly in-flight, while keeping safe retry/status lookup if the response times out. Do not invent a new frontend terminal state independent of the backend.
- If a staff-controlled lock/timeout arrives, resolve via authoritative status and preserve any accepted last-second input contract.

**Acceptance:** Retry, offline, slow ACK, rejected save, app background/restore and double submit produce truthful copy and no double effect.

### P1.1 — Reading typography and content hierarchy

**Files:** `StudentReading.tsx`, `StudentQuestionPanel.tsx`, `StudentQuestionText.tsx`, `AccessibilitySettings.tsx`, `accessibilityScale.ts`, `src/index.css`.

- Keep the existing bounded text measure rather than stretching paragraphs to full tablet width. Default body text around 17–19 CSS px where practical; apply user preferences and avoid overriding content semantics.
- Aim for comfortable line height (~1.5–1.7 for prose), consistent paragraph spacing and clearly differentiated passage headings/instructions/questions.
- Avoid labels/counters below a legible practical minimum; captions may be smaller but must pass contrast checks.
- Distinguish passage content from exam instructions without heavy boxes everywhere. Use a subtle background/border for instructions only when required.
- Preserve authored paragraphs, list ordering, emphasis, equations and line breaks. Sanitization must not silently merge paragraphs.
- Make question-number and answer-control hierarchy consistent across block types. Prefer natural text wrapping; do not allow labels to overlap long options.
- Support font-size and text-spacing overrides without cutting off content or hiding the final answer slot.

### P1.2 — Shared exam design tokens and components

**Files:** `src/components/student/styles/exam.css`, limited exam-scoped sections of `src/index.css`, new `src/components/student/ui/*` where useful.

Introduce **small** primitives only where duplication warrants them:

| Primitive | Purpose | Contract |
|---|---|---|
| `ExamIconButton` | Tools/close/image utility | At least 44×44 CSS px target on touch, accessible name, visible active/focus state. |
| `ExamSegmentedTabs` | Passage/Questions; Task/Response | Stable identity; `aria-pressed` or appropriate tab pattern; no render-tree reset. |
| `ExamAnswerChoice` | Radio/checkbox full row | Uses native input and label; no nested actions; semantic states. |
| `ExamSaveStatus` | Reused header state | Dedicated save-state view model; quiet live announcements. |
| `ExamSurfaceHeader` | Section/task name, time, tools | Compact without hiding essential state. |
| `ExamSectionFooter` | Consistent navigation treatment | Reading and Writing use distinct content but common spacing/touch/focus. |

Design tokens (suggested targets, **not** final measured CSS values):

```css
.student-exam-shell {
  --exam-content-bg: #ffffff;
  --exam-canvas-bg: #f7f8fa;
  --exam-ink: #17202b;
  --exam-muted-ink: #465363;
  --exam-border: #d6dce3;
  --exam-accent: #2457a7;
  --exam-focus: #175cd3;
  --exam-touch-size: 3rem; /* 48 CSS px intended touch hit area */
  --exam-control-radius: 0.5rem;
  --exam-panel-gap: clamp(0.75rem, 1.5vw, 1.5rem);
}
```

**Implementation constraint:** Reuse and consolidate the existing `--student-*` and exam variables rather than replacing them wholesale or adding conflicting global `!important` descendants. The snippet illustrates intent; validate contrast before shipping, including state combinations.

### P1.3 — Writing editor readability

**Files:** `StudentWritingPanes.tsx`, `StudentWriting.tsx`, `src/index.css`.

- Use the already-computed `--student-writing-editor-font-size` and `--student-writing-editor-line-height` instead of only fixed Tailwind `text-base md:text-lg` styles.
- Remove decorative editor slide-in on every task switch; avoid animation of large typing surfaces. Keep reduced-motion behavior.
- Minimize nested borders/shadows; use one subtle divider and a clearly defined text region.
- Retain visible caret and OS text-selection handles; no global selection suppression on the textarea.
- Keep word count stable during every input and composition update; do not rerender the entire exam on every keystroke.
- Ensure spelling/autocorrect/copy/paste behavior is determined by **current exam security policy**, not silently changed by this design project.

### P1.4 — Responsive shell, touch, and keyboard

**Files:** `studentLayoutMode.ts`, `StudentExamShell.tsx`, `useStudentExamViewport.ts`, `useStudentFocusedControlVisibility.ts`, `StudentSplitPaneResizer.tsx`, `StudentFooter.tsx`.

- Keep breakpoints as geometry rules, not `navigator.userAgent` checks. Preserve the current approximate policy: phone under 600 CSS px; compact 600–899; standard at 900+ only if min pane sizes and height fit; wide at 1180+ only if all requirements fit.
- Keep width/height checks based on actual **available exam container** and measured pane fit, not only physical screen dimensions.
- Test iPad mini and Pro **portrait/landscape**, Split View/Stage Manager, Chrome Android, Samsung Internet and physical keyboard combinations. A large tablet can legitimately choose compact when zoom is enlarged.
- Touch visual hit area target: generally **44–48 CSS px** for primary exam actions. This is a product usability target inspired by Apple’s 44-point guidance, **not** a claim that CSS pixels and Apple points are identical or that WCAG AA requires 44px. Meet applicable WCAG 2.2 target-spacing rules at minimum.
- Do not depend on hover for core actions. Pointer capture must release cleanly on cancel, navigation, scroll intent and orientation changes.
- Don’t disable browser zoom, standard back accessibility behavior or hardware-keyboard focus outlines for the sake of an “app-like” appearance.
- On keyboard opening, preserve stable shell, hide nonessential/footer chrome only per established policy, and guarantee the active input is visible within its scroll owner.

### P1.5 — Navigator, review, and accessibility dialogs

**Files:** `QuestionNavigator.tsx`, `CompactQuestionNavigation.tsx`, `StudentFooter.tsx`, `WritingTaskNavigator.tsx`, `SubmitConfirmation.tsx`, `AccessibilitySettings.tsx`.

- Navigator indicates **current**, **answered**, **unanswered** and **flagged** with text/icon/shape in addition to color. Its statuses reflect the same view model as footer chips.
- A tap on a question tile goes directly to the correct question; focus settles near its prompt and does not accidentally select an answer.
- Dialogs have an accessible title, appropriate dialog role, working Escape/back dismissal, logical initial focus, focus containment and focus return.
- Keep secondary settings (highlight color, layout preferences) discoverable under Tools rather than filling permanent exam space.
- Review page warns clearly about unanswered questions but never requires users to answer every question unless this is an explicit exam requirement.

### P2 — Visual polish after correctness

- Normalize surface radii, separator weights, and selected-state colors to one visual recipe.
- Prefer quick color/opacity transitions over translate/scale animations on answering controls; retain `prefers-reduced-motion` and forced-colors support.
- Reduce unneeded uppercase meta labels; increase useful whitespace around prose and answer controls without wasting compact-screen height.
- Avoid excessive floating action buttons, nested sticky toolbars, scroll-jacking, page-level carousels or automatic panel switches.
- Use **actual** student sessions to validate whether the Passage/Questions and Task/Response labels are discoverable and whether the save indicator is understood.

---

## 5. Device and accessibility acceptance matrix

Device classes below are **viewport examples in CSS pixels**, not hardcoded model/OS detection. Test actual visual viewport, viewport scaling, safe area and browser chrome. Expand the existing `e2e/support/studentViewportMatrix.ts` rather than replacing it.

| Profile | Baseline viewport(s) to test | Expected adaptation / critical assertions |
|---|---|---|
| Small phone | 360×800, 390×844 | One-pane mode; no text clipping; keyboard/caret visible; bottom navigation reachable. |
| Large phone / landscape phone | 430×932, 844×390 | No narrow split; compact nav and accessible tools; short height handled. |
| iPad mini portrait | 744×1133 or supported simulator nearest | Full-width compact panes; tap targets, scrolling and selection reliable. |
| iPad mini landscape | 1133×744 | Split if measured min widths and heights fit; otherwise compact; no arbitrary forced split. |
| Standard iPad | 768×1024 and 1024×768 | Portrait compact, landscape split when geometry permits; writing editor stays usable. |
| iPad Air / Pro | 820×1180, 834×1194, 1032×1376, plus rotations | Correct compact/standard/wide transitions; preserved answer and scroll; no clipping at 150% zoom. |
| Android tablet | 800×1280, 1200×800, 1280×800 | Same geometry decisions as equivalent iPad; Chrome and Samsung Internet touch behavior. |
| Split window / multitasking | 320, 600, 899, 900, 1179, 1180 CSS px widths with short heights | Correct layout downgrade; no state loss or desktop-only overflow. |
| Keyboard + trackpad | Several tablet sizes | Full keyboard path, visible focus, no hover dependency, no footer covering focused input. |
| Screen reader | iPad Safari VoiceOver, Android Chrome TalkBack; desktop keyboard/screen reader spot checks | Correct labels, questions, answer states, dialogs, image controls, save status. |

**Include** 200% browser/text zoom and WCAG 1.4.10 reflow scenarios at an effective 320 CSS px where applicable. Genuine data tables may scroll in two dimensions **within their own local region** if their semantics require it. Also test `prefers-reduced-motion`, OS high contrast/forced colors where supported and user text-spacing overrides.

### Minimum automated test additions

**Vitest / Testing Library**

- Writing compact pane transition while an IME composition is active; slow parent prop ACK; same-length correction; delete-to-empty; task switch while editor unmounted; foreground/background; captured editor state across show/hide.
- One zoom owner; font-size tokens applied to textarea; pane minimum calculations at increased font size.
- Keyboard-operable figure triggers; focus return after image dialog; aria status and action naming for all answer controls.
- Navigation status derivation; no hidden/inert controls in tab order.
- No extra answer mutation triggered by purely presentational state changes.

**Playwright E2E**

- Reuse `e2e/student-ipad-layout.spec.ts`, `student-viewport-layout.spec.ts`, `student-durability.spec.ts`, `student-input-durability.spec.ts`, `student-interaction-motion.spec.ts`, `student-writing-draft.spec.ts` and `student-accessibility.spec.ts`.
- Add a **real student-attempt Reading interaction matrix** (single choice, multiple choice, TFNG, text, select, matching, table, diagram/map); tap, scroll, rotate, switch pane, refresh/reconnect, verify correct answer IDs. Keep builder-preview checks but do not treat them as candidate-session coverage.
- Add a **real student-attempt Writing cross-browser matrix** with sustained typing, composition/emoji/non-Latin IME, switching Task/Response, tab/task changes, 150% zoom and rapid keyboard open/close.
- Verify bounding boxes for all core touch targets and that the element hit at the center corresponds to the intended action.
- Verify keyboard focus remains visible in active pane after toolbar/dialog interactions, and after zoom and orientation transitions.
- Verify save-status visual labels against stubbed authoritative ACK/offline/retry response sequences—not against locally optimistic change events.
- Verify no horizontal *document* scroll, no hidden submit/next control, no overlap with safe areas, and no clipped final question/editor lines.

**Real-device smoke (release-blocking for P0)**

- At least one current iPad Safari device, one small iPad, one Android tablet with Chrome, one Android phone and one tablet with external keyboard/stylus where available.
- Browsers on iPad must be checked individually for UI issues, but do not assume changing iPad browser brand changes the underlying browser engine.
- Simulate slow/offline network and app backgrounding during a live answer. Confirm the actual server-side stored answer after reconnect, not just the textarea’s visual value.

---

## 6. Implementation sequence and PR boundaries

Keep changes small, reviewable and reversible. **No single giant exam redesign PR.**

| PR | Order | Deliverables | Exit gate |
|---|---|---|---|
| **PR 01 — Baseline and invariants** | First | Capture screenshots/computed styles on the device matrix; record current tests; add Writing compact + Reading image activation reproductions; establish answer/save invariants. | Reproductions and baseline evidence committed; no production behavior changed. |
| **PR 02 — Interaction safety** | P0 | Harden Writing compact lifecycle as needed, accessible inline figures, critical input/focus fixes. | No lost/duplicated/misattributed responses; key E2E suites pass. |
| **PR 03 — Zoom and viewport** | P0 | Fix compounded scale if verified; stable pane fit; keyboard visibility and short-height issues. | Tablet/web zoom and orientation test matrix pass. |
| **PR 04 — Exam typography** | P1 | Reading prose and question hierarchy, writing editor token consistency, accessible table affordances. | Contrast, text spacing and reflow audits pass. |
| **PR 05 — Shared visual controls** | P1 | Exam-scoped tokens, tabs, navigation, header/save presentation, dialog polish. | Same answer IDs and submit behavior as before; accessibility regression passes. |
| **PR 06 — Polish and production soak** | P2 | Lower visual noise, restrained motion, final screenshots, cross-device usability sessions. | Production metrics and rollback plan reviewed. |

### Each PR must include

1. **Behavioral contract:** what user-facing action is affected and what is explicitly unchanged.
2. **Risk review:** focus/IME, pointer cancellation, pending save, active answer identity, orientation/viewport changes, stale network response, and cross-exam CSS scope.
3. **Tests:** direct unit regression plus browser E2E; include a concrete failure case, not just a snapshot.
4. **Evidence:** screenshot/video at relevant viewport and exact browser, accessibility checks, before/after user flow, and a test-result log.
5. **Rollback:** keep new visual primitives/behavior behind a narrow feature flag if a change touches active exam flow; be able to revert without losing answers or changing stored data shape.

### Guardrails for the lead engineer

- Existing runtime/attempt providers remain the source of truth. Display changes cannot own timer, scoring, response revision, terminalization or section admission.
- No page reload when changing exam presentation. No new browser local state as a replacement for durable server answers.
- No `setTimeout`-only method of assuring last-second answer durability; preserve the existing flush and authoritative submit path.
- No `userAgent`-based iPad branch as the primary responsive rule; use pointer capabilities + measured layout facts.
- No unrestricted body scroll as a workaround for an exam-pane keyboard bug; fix scroll owner and focus visibility.
- Avoid new broad `html`, `body` or `.student-exam-shell *` styles that leak across modules.
- No new dependencies for basic tabs, buttons or small dialogs unless the existing implementation demonstrably cannot meet semantics/focus requirements.

---

## 7. Release criteria and measurable success

### Hard gates — zero known critical failures

- Zero confirmed lost, duplicated or cross-question / cross-task answers in target regression scenarios.
- Zero unreachable active answer fields or essential navigation/submit controls at supported test viewports.
- Zero unlabelled essential actions, keyboard-inaccessible question-critical images, or focus trapped behind a hidden pane.
- Zero cases where the UI claims “Saved” against an unacknowledged/rejected answer in tested failure paths.
- No regression in published exam timing, submission authorization, IELTS content structure or supported security rules.

### UX measures to capture against baseline

- **Task success:** proportion of students who can read a passage, answer, flag, return and revise without assistance.
- **Interaction errors:** accidental answer activations per test session, missed taps, repeated taps and wrong-slot saves.
- **Navigation friction:** number of unintended pane switches and number of taps to revisit a passage from an answer.
- **Readability:** user-rated passage legibility and observed clipping/scroll confusion on small tablets.
- **Save trust:** proportion of test participants correctly understanding Saved / Saving / Offline pending / Not saved.
- **Performance:** typing responsiveness, stable editor caret and no long-frame regressions on lower-end tablets.

Do not claim KPI improvements until baseline and post-change sessions are measured. Collect telemetry that counts technical outcomes without logging the student's actual exam response text.

---

## 8. Implementation checklist / definition of done

- [ ] Read existing student-layout and attempt persistence contracts before editing.
- [ ] Baseline the existing unit/Playwright suites and save results.
- [ ] Prove Writing compact pane and task-switch invariants under real async race scenarios.
- [ ] Verify and, if needed, fix nested zoom across Reading UI and shell.
- [ ] Make embedded passage image enlargement independently keyboard-operable.
- [ ] Audit all answer types with actual touch, keyboard and screen-reader semantics.
- [ ] Apply text preferences consistently to the Writing textarea.
- [ ] Keep Reading prose comfortable; prevent accidental two-axis document scrolling.
- [ ] Harmonize navigation and finish actions without altering module semantics.
- [ ] Validate save-state copy against authoritative durability states.
- [ ] Test iPad mini / iPad Air / iPad Pro / Android tablet / mobile profile classes.
- [ ] Test orientation, multitasking, IME, software keyboard, zoom, slow network, offline and reconnect.
- [ ] Run RTL/long-label, reduced-motion, forced-colors, contrast and font-spacing checks as applicable.
- [ ] Verify no breakage in IELTS Listening functional shell, SAT/ACT, staff or proctor routes.
- [ ] Complete device-specific visual/functional sign-off and document rollback.

---

## 9. Source map and external standards

### Repository locations (commit-pinned)

- [StudentApp and exam-level zoom/save state](https://github.com/teaching01-netizen/IELTS-LMS/blob/26423cedbc08408dbc9d2ea3803a56bdf258476d/src/components/student/StudentApp.tsx)
- [Reading passage/pane behavior](https://github.com/teaching01-netizen/IELTS-LMS/blob/26423cedbc08408dbc9d2ea3803a56bdf258476d/src/components/student/StudentReading.tsx)
- [Reading compact/split pane component](https://github.com/teaching01-netizen/IELTS-LMS/blob/26423cedbc08408dbc9d2ea3803a56bdf258476d/src/components/student/StudentMaterialWithQuestionPane.tsx)
- [Writing draft and pane lifecycle](https://github.com/teaching01-netizen/IELTS-LMS/blob/26423cedbc08408dbc9d2ea3803a56bdf258476d/src/components/student/StudentWriting.tsx)
- [Writing prompt/editor panes](https://github.com/teaching01-netizen/IELTS-LMS/blob/26423cedbc08408dbc9d2ea3803a56bdf258476d/src/components/student/StudentWritingPanes.tsx)
- [IELTS objective question types](https://github.com/teaching01-netizen/IELTS-LMS/blob/26423cedbc08408dbc9d2ea3803a56bdf258476d/src/components/student/QuestionRenderer.tsx)
- [Geometry layout policy](https://github.com/teaching01-netizen/IELTS-LMS/blob/26423cedbc08408dbc9d2ea3803a56bdf258476d/src/components/student/layout/studentLayoutMode.ts)
- [Viewport policy](https://github.com/teaching01-netizen/IELTS-LMS/blob/26423cedbc08408dbc9d2ea3803a56bdf258476d/src/components/student/layout/studentExamViewportPolicy.ts)
- [Student CSS](https://github.com/teaching01-netizen/IELTS-LMS/blob/26423cedbc08408dbc9d2ea3803a56bdf258476d/src/index.css)
- [Existing tablet test suite](https://github.com/teaching01-netizen/IELTS-LMS/blob/26423cedbc08408dbc9d2ea3803a56bdf258476d/e2e/student-ipad-layout.spec.ts)
- [Existing viewport acceptance tests](https://github.com/teaching01-netizen/IELTS-LMS/blob/26423cedbc08408dbc9d2ea3803a56bdf258476d/e2e/student-viewport-layout.spec.ts)
- [Existing Writing lifecycle tests](https://github.com/teaching01-netizen/IELTS-LMS/blob/26423cedbc08408dbc9d2ea3803a56bdf258476d/src/components/student/__tests__/StudentWriting.lifecycle.test.tsx)

### Reference design and accessibility criteria

- [Apple HIG — Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility) — touch reachability, spacing, contrast and interaction accessibility principles.
- [Apple HIG — Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons) — clear hit regions and press feedback.
- [WCAG 2.2](https://www.w3.org/TR/WCAG22/) — target Level AA for the exam surface, including keyboard focus, reflow, contrast and target sizing.
- [W3C Understanding 2.5.8 — Target Size Minimum](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum) — 24×24 CSS px AA rule with defined spacing and other exceptions; our 44–48 CSS px core-touch target is a stricter *design goal*, not that rule.
- [W3C Understanding 1.4.10 — Reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html) — preserve information/function at narrow effective widths, with exceptions for genuinely two-dimensional content.
- [W3C Understanding 1.4.3 — Contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) — normal text contrast 4.5:1 and large text 3:1 for Level AA.

**Final recommendation:** Do **PR 01–03 first**: establish regressions, preserve native writing and answer behavior, resolve zoom/keyboard risks, and make question-critical images accessible. Only then perform the cleaner, Apple-inspired visual refinement. **Interaction reliability is the visual system’s foundation.**
