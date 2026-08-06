# FEX-070/071/072 Coverage Audit: Keyboard/Screen-Reader Flow, Tablet/Mobile Viewport, Readability Controls (F-11)

Audit date: 2026-08-06. Produced during F-11. Coverage is split into three buckets:
(a) jsdom test(s) pinning the bullet, (b) Playwright e2e spec/test covering it, or (c) GAP.

> **e2e specs were NOT modified in F-11.** The Playwright suites under `e2e/` require
> MySQL/TiDB backend infrastructure (`readBackendE2EManifest`, seeded schedules) and cannot
> run in this environment; the e2e-required todos (e-1..e-8) run later. The gaps below are
> the concrete additions to make when that infrastructure is available.

---

## FEX-070 — Keyboard and screen-reader flow

| Bullet | jsdom pin (a) | e2e (b) | Verdict |
|---|---|---|---|
| Skip link reaches the main exam content | NEW (F-11): the focus-move **enabler** is pinned in jsdom — all four `main#main-content` targets carry `tabIndex={-1}` and each shell renders the skip link with `href="#main-content"` (`StudentApp.test.tsx` F-11 describe "kept a focusable skip-link target..." for briefing/lobby/exam shells; `StudentPostExamView.test.tsx` "kept a focusable skip-link target on the post-exam main content"). Fragment-navigation *focus movement itself* is a browser behavior jsdom cannot exercise — see e2e gap 1. Production fixed in F-11: `tabIndex={-1}` on `StudentApp.tsx:526`, `:549`, `StudentExamWorkspace.tsx:96-101`, `StudentPostExamView.tsx:24`. | GAP — no e2e presses Tab to the skip link and asserts `document.activeElement` becomes `main#main-content`. | jsdom covered (enabler pinned); e2e GAP (focus movement) |
| Question controls have meaningful labels | `StudentApp.test.tsx` (pervasive `getByLabelText('Answer for question 1')` / `getByRole('textbox', { name: /writing response/i })`); `StudentWriting.a11y.test.tsx` "renders an accessible writing editor"; `StudentListening.a11y.test.tsx` "adds aria-labels to rewind/forward icon buttons"; `StudentSpeaking.a11y.test.tsx` "adds aria-labels to speaking control icon buttons". | `e2e/student-accessibility.spec.ts` "answer fields have proper ARIA labels" (`:85-103`). | Covered |
| Waiting and blocking changes use an appropriate live announcement | NEW (F-11): `StudentApp.test.tsx:6114` — blocking overlay's context label/title/message sit in a `role="status"` + `aria-live="polite"` region; the "Remaining mm:ss" chip and badge are outside it. | GAP — no e2e drives a pause/advance and asserts a live-region announcement (Playwright can assert `aria-live` presence and text mutation). | jsdom covered; e2e GAP |
| Modal focus is trapped and restored | NEW (F-11): `SubmitConfirmation.test.tsx:199` (role/aria-modal/name), `:229` (initial focus), `:245` (Tab/Shift+Tab trap incl. stray-focus pull-back), `:308` (focus restore), plus "kept focus trapped when the parent re-rendered with a new onClose identity" (regression: the effect is keyed on `isOpen` only via an `onClose` ref, so the per-second parent re-render cannot restore focus mid-open) and "wrapped Shift+Tab from the dialog container to the last control". | GAP — no e2e asserts focus moves into the confirmation and returns to the Finish button after cancel. | jsdom covered; e2e GAP |
| Submission confirmation is operable without a pointer | NEW (F-11): `SubmitConfirmation.test.tsx:245` (Tab-only navigation across Close/Review/Submit), `:292` (Escape closes), existing button tests; `StudentApp.test.tsx:6207` (Finish → dialog → Escape in-app). | `e2e/student-accessibility.spec.ts` "submit confirmation dialog is accessible" (`:105-144`) — **was vacuous pre-F-11** (`getByRole('dialog')` matched nothing because the component had no dialog role; the whole block was skipped). The F-11 dialog-role fix makes this test real. | Covered (e2e becomes real post-fix) |
| Timer is not announced every second | NEW (F-11): `StudentApp.test.tsx:6154` — timer has `role="timer"` and neither it nor any ancestor up to and including the banner carries `aria-live`. Pre-existing presence pins at `:470`/`:493`; post-exam absence at `:4948`/`:4964`/`:5090`. | GAP — no e2e asserts the ticking countdown text is not inside an `aria-live` region. | jsdom covered; e2e GAP |

## FEX-071 — Tablet and mobile viewport

| Bullet | jsdom pin (a) | e2e (b) | Verdict |
|---|---|---|---|
| iPad Safari portrait and landscape | `tabletMode.test.ts` (touch-enabled 768×1024 → tablet mode; desktop excluded). Layout itself is CSS/e2e territory. | `e2e/student-ipad-layout.spec.ts`: "Reading keeps split panes in iPad portrait..." (`:120`), "Reading uses split panes in iPad landscape..." (`:143`), "Question Navigator stays centered in both iPad orientations" (`:258`), "Writing remains usable in both iPad orientations" (`:271`). | Covered |
| Software keyboard open and closed | `examPageZoomGuard.test.ts` "resamples the visual viewport after the keyboard focus transition settles"; `StudentApp.test.tsx:499` "never writes shell geometry during reused-tab and keyboard viewport events" (editor focus/blur with `visualViewport` height/offset changes); `StudentViewportCss.test.ts` (footer anchored to dynamic viewport shell). | GAP — no e2e simulates a real software keyboard (iOS `window.visualViewport` shrink / `scrollIntoViewOnFocus`) and asserts the focused input stays visible. The writing test blurs the editor and re-checks chrome alignment, but does not simulate keyboard geometry. | jsdom covered; e2e GAP |
| Footer remains reachable | `StudentViewportCss.test.ts` (absolute footer inside dynamic viewport shell, floating pill); `StudentFooterOverlayLayout.test.ts`; `StudentFooterRepresentative.test.tsx` (shared footer class contract, question row, Finish button omission). | `e2e/student-ipad-layout.spec.ts` `expectExamChromeAlignedToViewport` (`:12-40`) asserts the footer is visible, absolutely positioned, inside the viewport, and below the workspace in both orientations (used by portrait/landscape + writing tests). | Covered |
| Current input is not hidden behind navigation | Partial: `StudentViewportCss.test.ts` pins footer/pill geometry; `StudentQuestionExperience.test.tsx` pins header controls wiring. No jsdom test can prove in-viewport visibility of the focused control. | GAP — no e2e focuses an input, opens the navigator/footer navigation, and asserts the input's bounding box stays within the visual viewport. | GAP |
| Browser zoom and visual viewport changes do not remove controls | `StudentApp.test.tsx:333` "guards native page zoom only during the exam lifecycle" (viewport meta content + `student-exam-active` classes restored on unmount); `StudentApp.test.tsx:499` (visualViewport resize/scroll geometry writes refused); `examPageZoomGuard.test.ts` (viewport policy install/restore, dvh authority, multi-touch/gesture blocking). | GAP — no e2e changes `visualViewport`/page zoom and asserts highlight/footer/navigator controls remain visible and clickable. | jsdom covered; e2e GAP |
| Rotation preserves answer and scroll position | Not jsdom-testable (no layout/rotation in jsdom). Highlight persistence across remount is pinned (`StudentAppWrapperHighlightPersistence.test.tsx`), but that is not rotation. | GAP — "Writing remains usable in both iPad orientations" rotates the viewport and reloads, but asserts only that the split workspace and editor are visible — it does NOT assert the typed answer or scroll position survived. | GAP |

## FEX-072 — Readability controls

| Bullet | jsdom pin (a) | e2e (b) | Verdict |
|---|---|---|---|
| Font scaling | `accessibilityScale.test.ts` (progressively larger typography tokens); `StudentExamPreview.test.tsx` "updates the preview shell font size when the accessibility setting changes" + "shows accessibility controls without zoom controls"; `AccessibilitySettings.test.tsx` (font-size option `aria-pressed`, clamp previews); `StudentReadingReadabilityControls.test.tsx` "normalizes passage html typography to the standard reading font settings". | Not e2e-pinned (presentation-only; jsdom pins the contract). | Covered |
| Passage readability levels | `StudentReadingReadabilityControls.test.tsx` (level props wired, in-pane controls deliberately absent — pinned absent on reading/listening/writing stimulus by `StudentStimulusReadabilityControls.test.tsx`); `normalizeReadingPassageText.test.ts` (readable plain-text extraction with paragraph separators + emphasis markers); `StudentUIProvider.test.tsx:33` (increase/decrease/reset actions). Note: the visible level controls were removed by design (pinned absent); the level flows through CSS typography vars. | Not e2e-pinned. | Covered |
| Zoom | `StudentQuestionExperience.test.tsx` "wires zoom controls from the header" (125% display); `StudentZoomableMedia.test.tsx` (fit-to-viewport baseline, reset returns to fit, zoom-only viewer fallback); `StudentExamPreview.test.tsx` "uses the same image zoom fit contract in preview mode"; `StudentApp.test.tsx:333` (native page-zoom guard). | Not e2e-pinned. | Covered |
| High contrast | NEW (F-11): `StudentApp.test.tsx:6180` — `.student-exam-shell` has no `high-contrast` class by default, gains it via the accessibility panel switch, loses it when toggled back. | `e2e/student-accessibility.spec.ts` "accessibility toggle button is visible in exam header" (`:33-52`) — weak (only asserts the toggle button exists). No e2e toggles high contrast and asserts the class/colors. | jsdom covered; e2e GAP (assert class application) |
| Highlight and erase modes | `StudentUIProviderHighlight.test.tsx` (mode toggling symmetry); `StudentApp.test.tsx:459`/`:482` (persistent header highlight tools, no floating toolbar, in Reading and Writing); `StudentReadingReadabilityControls.test.tsx` (highlightable passage pane, no static highlight button on tablet/desktop); `StudentWriting.a11y.test.tsx` (prompt highlight without highlightable editor); `StudentListening.a11y.test.tsx` (block highlight persistence); `highlightSelectionManager.state.test.tsx` / `highlightSelectionPort.test.tsx` / `highlightV2Engine.test.ts` / `RichTextHighlighter.test.tsx`; `StudentHeaderHighlightHint.test.tsx` (44px targets, palette + erase mode, disclosure focus). | `e2e/student-ipad-layout.spec.ts`: "Reading highlight tool applies repeatedly, switches color, erases, and survives scrolling" (`:164`), "Reading question copy highlights and erases without changing answer controls" (`:217`). | Covered |
| Controls cannot make navigation or answers inaccessible | `StudentReadingReadabilityControls.test.tsx` ("keeps question pane sizing unchanged", "does not auto-scroll question panel while passage text selection is active", "creates and erases a mark in question copy while keeping the answer input excluded"); `StudentWriting.a11y.test.tsx` (editor never highlightable, pane resize bounds); `StudentQuestionCalloutCss.test.ts`; `StudentFooterRepresentative.test.tsx` (footer navigation stays usable); `StudentViewportCss.test.ts` (previous/next controls above the footer pill). | `e2e/student-ipad-layout.spec.ts` "Reading question copy highlights and erases without changing answer controls" (`:216`) — answer-control value/checked snapshot identical before/after highlight+erase. | Covered |
| Preferences do not alter persisted answer content | `StudentAppWrapperHighlightPersistence.test.tsx` (real highlight survives surface remount under the same attempt namespace; no state carry-over between attempt A and B); highlight persistence under owning block id (`StudentReadingReadabilityControls.test.tsx`, `StudentListening.a11y.test.tsx`); a11y settings live only in `StudentUIProvider` local state (no attempt payload writes — `StudentUIProvider.test.tsx`). Answer immutability itself is pinned by the F-6/F-7 suites. | Not e2e-pinned. | Covered |

---

## E2E gaps to add when the infrastructure is available (e-1..e-8 todos)

Concrete additions, all under `e2e/` (none were modified in F-11):

1. **Skip-link focus movement** (`student-accessibility.spec.ts`): Tab to the skip link,
   Enter, assert `document.activeElement` is `main#main-content` (works post-F-11 because the
   targets are now focusable), then Shift+Tab returns to the link.
2. **Software keyboard open/closed** (`student-ipad-layout.spec.ts`): in the Writing module,
   focus the editor, shrink the visual viewport (`page.evaluate` on `window.visualViewport`
   height / dispatch resize) or use an iPad-emulated context, and assert the focused editor
   and the footer remain within the visual viewport; repeat after dismissal.
3. **Current input not hidden behind navigation**: with an answer control focused, open the
   Question Navigator and the footer question chips; assert the control's bounding box stays
   within the visual viewport and the control still receives keystrokes after closing.
4. **Browser zoom / visual viewport changes do not remove controls**: change page zoom
   (e.g. `document.body.style.zoom` / CDP `Emulation.setPageScaleFactor`), dispatch
   `visualViewport` resize/scroll; assert highlight tools, footer, and navigator remain
   visible and operable, and the exam shell geometry is not rewritten (mirror of
   `StudentApp.test.tsx:499`).
5. **Rotation preserves answer and scroll position**: in the Writing module, type an answer,
   scroll the prompt/editor panes, rotate portrait → landscape (setViewportSize), assert the
   typed value, caret position, and pane scroll offsets survive without reload; extend the
   existing "Writing remains usable in both iPad orientations" test which currently only
   checks visibility after reload.
6. **Live-announcement verification**: drive a proctor pause (or blocking copy) and assert a
   `role="status"` region exists on the blocking overlay, contains the title/message, and
   never contains the ticking "Remaining mm:ss" text (mirror of `StudentApp.test.tsx:6114`).
7. **Modal focus trap/restore**: after Finish, assert focus is inside the confirmation
   dialog, Tab cycles only within it, Escape closes it, and focus returns to the Finish
   button (mirror of `SubmitConfirmation.test.tsx`).
8. **High contrast**: toggle the accessibility switch and assert `.student-exam-shell`
   gains/loses `high-contrast` and that question text remains readable/visible.

## Verification note

The jsdom suite pins the structure (roles, aria attributes, focus movement, class
application) but cannot prove visual-viewport geometry, fragment-navigation focus, or
software-keyboard behavior — those are exactly the e2e gaps above. The existing
`student-ipad-layout.spec.ts` (6 tests) and `student-accessibility.spec.ts` (4 tests) were
re-audited; the "submit confirmation dialog is accessible" e2e test is no longer vacuous
after the F-11 dialog-role fix, and its cancel-button branch (`/cancel|go back|continue
exam/i`) still does not match "Review Answers", which is fine (it skips gracefully).
