# Bluebook Design System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the SAT exam-mode surface into a Bluebook-faithful, production-grade design system (document + OS + instrument, not SaaS dashboard) without changing exam behavior, persistence, timing, or accessibility contracts.

**Architecture:** Evolve the existing `--sat-*` CSS-variable system in `src/index.css` through three layers (primitives -> semantic -> component tokens), then converge the SAT shell components onto those tokens one vertical slice at a time. No renames of CSS variables consumed by logic, no new stores, no persistence migration, no interaction-machine redesign. Each phase ships working, tested UI.

**Tech Stack:** React 19 + TypeScript (`tsc --noEmit`), Tailwind v4 (`@theme` + arbitrary `var()` utilities), vitest + @testing-library/react + jsdom, Playwright (`playwright.sat-a11y.config.ts`), eslint, lucide-react icons only, Radix Dialog (via `SatCenterModal`).

---

## 0. Context the worker needs

0.1. The Bluebook values in the spec are a high-fidelity reconstruction, not College Board tokens. Implement them as **semantic intentions** (chrome / action / progress / annotation / review / attention / scrim), never as hex literals scattered in components.

0.2. Scope is **SAT exam mode only**: everything under `src/features/student-delivery/` rendered inside `.sat-ui` / `.sat-exam-shell`, plus the SAT block of `src/index.css`. Pre-test, lobby, dashboard, builder, admin, and proctor screens stay as they are.

0.3. Current state (verified 2026-09-10): a coherent `.sat-ui` token block already exists in `src/index.css` (~lines 1150-1500) with overlay z-contract (`satOverlayZ.ts`), interaction machine, floating tools, Help modal, Line Reader, review page, and a serif prose class (`.sat-exam-prose`) used for passage/question bodies. Gaps vs the spec: Apple-blue accent instead of royal blue, white shell instead of pale-blue chrome, 40% modal scrim instead of 72%, light line-reader mask instead of ~90% dark, 7px radii instead of the 6/8/10/12/pill ladder, blue Help Close instead of yellow attention, answer borders keyed to text-black instead of a mid-contrast answer border, no active-tool underline indicator, no token-contract tests.

0.4. Read these before starting Phase 1: `src/index.css` SAT block (offset ~1100, limit ~400), `src/features/student-delivery/ui/SatExamShell.tsx`, `ui/shell/SatExamTopBar.tsx`, `ui/shell/SatExamFooter.tsx`, `ui/question/SatSingleChoiceAnswer.tsx`, `ui/question/SatQuestionHeader.tsx`, `ui/primitives/SatCenterModal.tsx`, `ui/help/SatHelpModal.tsx`, `ui/reading/SatLineReader.tsx`, `ui/tools/SatFloatingTool.tsx`, `domain/satCopy.ts`, `ui/primitives/satOverlayZ.ts`.

0.5. Commands (repo root): typecheck `npx tsc --noEmit`, unit `npm run test:run -- <path>`, lint `npx eslint <paths>`, a11y `npm run e2e:sat-a11y`. Full suite is slow; always scope vitest to touched paths per phase, then run the SAT delivery folder before the final commit of each phase.

---

## Decisions locked (do not relitigate during implementation)

1. **Keep `--sat-*` variable names.** Remap their *values* to Bluebook intentions and add the missing names (`--sat-chrome`, `--sat-action-*`, `--sat-attention-*`, `--sat-scrim-*`, `--sat-answer-*`, `--sat-note-*`). Renaming would churn 100+ call sites for zero visual gain.
2. **Chrome split:** `--sat-chrome: #EAF2FD` becomes the header/footer/topbar background; `--sat-background` stays white for the exam body. This is the single highest-leverage Bluebook cue (pale-blue brackets around a white document).
3. **Royal-blue action:** `--sat-accent: #3154D7`, hover `#2947BA`, pressed/active `#223A98`, soft tint `#E4EAFB`. Replaces the current Apple blue `#0071e3 / #0067b8` in exam scope only.
4. **Progress stays black:** navigator pill and question-number badge stay near-black (`#191919 / #171717`); never blue. Move (blue) vs inspect-progress (black) separation is load-bearing.
5. **Attention yellow is rare:** `#FFD718` (+hover `#F2C900`, fg `#171717`, border `#44484C`) is used for Help Close and destructive/irreversible confirms only. A lint-test forbids it elsewhere.
6. **Paper highlight:** `--sat-highlight-background: #FFF2B3` (from current `#fff1a8`); note header `#FFF9D9`; review red `#C9475C` (from current `#b51d4f`); scrim `rgb(0 0 0 / 72%)`; reader mask `rgb(20 20 20 / 92%)`; focus `#005FCC`; split divider 2px `#777B80`; answer border `#74787D`; subtle border `#D5D9DE`; strong divider `#24272A`; floating-tool border `#5D6268`.
7. **Type split:** UI stays sans (system stack starting Arial/Helvetica); exam material (passage, stem, answer content) uses `Georgia, "Noto Serif", serif` via `.sat-exam-prose`. Never Inter-everywhere. Body/answer/prompt 18px, section title 20 semibold sans, timer 22-24 medium sans, tool label 13-14, button 15 semibold, question number 16 bold, modal title 28 (Help-grade dialogs only), modal body 17, caption 13.
8. **Compact Hide vs touch target:** the visual Hide/Show pill may read ~26px tall, but the *button* keeps the 44px touch target (inner-pill pattern already in `SatExamTopBar`). Same for tool buttons. Never shrink touch targets to hit a visual spec.
9. **No spring in exam scope:** replace `satMotion.detent` spring usage on exam surfaces with 80/120/180ms `cubic-bezier(.2,0,0,1)`; keep the export (staff/builder surfaces may use it) but stop importing it in student-delivery.
10. **Opacity over blur:** modal scrim is flat 72% black; remove `backdrop-blur` anywhere in SAT exam scope. Popover backdrops stay light (20%) or transparent — they are not modals.
11. **Borders over shadows:** exam surfaces get borders, not shadows. Shadows exist only as `--sat-shadow-floating` (tools/menus) and `--sat-shadow-modal` (center modal).
12. **Copy stays in `satCopy.ts`:** no hardcoded user-visible strings in restyled components; strings-only values (no HTML) so there is no injection seam.
13. **IELTS path untouched:** `src/components/student/**`, non-SAT sections of `src/index.css`, backend, outbox/persistence, Desmos internals, and interaction-machine logic are out of scope except where a phase explicitly says otherwise.

---

## File map

**Token foundation (1 file, every phase touches it):**

- Modify: `src/index.css` — SAT block only (between the `SAT delivery accessibility system` comment and the closing of the `.sat-ui` rules + the `.sat-exam-prose/type/touch/pressable/state` utilities).

**Modify (components, phased):**

- `src/features/student-delivery/ui/SatExamShell.tsx` — shell grid rows, chrome wiring, nothing else.
- `src/features/student-delivery/ui/shell/SatExamTopBar.tsx` — 3-anchor grid, chrome bg, timer, tool buttons, More trigger.
- `src/features/student-delivery/ui/shell/SatExamFooter.tsx` — chrome bg, dark top border, 70px rhythm, pill classes via tokens.
- `src/features/student-delivery/ui/question/SatQuestionWorkspace.tsx` — content padding 40/32, 2px divider, prose widths.
- `src/features/student-delivery/ui/question/SatQuestionRenderer.tsx` — serif answer content wiring (classes only).
- `src/features/student-delivery/ui/question/SatSingleChoiceAnswer.tsx` — answer tokens (border/radius/min-height/marker/selected).
- `src/features/student-delivery/ui/question/SatQuestionHeader.tsx` — 34px square number badge, review red.
- `src/features/student-delivery/ui/primitives/SatCenterModal.tsx` — 650px / 740px caps, 10px radius, 72% scrim, modal-title variant.
- `src/features/student-delivery/ui/primitives/SatPopoverShell.tsx` — radius + border + shadow tokens.
- `src/features/student-delivery/ui/help/SatHelpModal.tsx` — accordion 78px/18px rows, yellow Close.
- `src/features/student-delivery/ui/shell/SatDirectionsPopover.tsx`, `SatReadingPopover.tsx`, `ui/question/SatNotesPanel.tsx` — popover radius/border, no scrim darkening.
- `src/features/student-delivery/ui/shell/SatMoreMenu.tsx` — low-weight trigger contract (mostly already correct; tokenize).
- `src/features/student-delivery/ui/tools/SatFloatingTool.tsx` — border/radius/header/shadow tokens.
- `src/features/student-delivery/ui/tools/SatCalculatorPanel.tsx`, `SatReferenceSheetPanel.tsx` — header-height + chrome hooks only.
- `src/features/student-delivery/ui/reading/SatLineReader.tsx` — dark mask, dark header, white controls.
- `src/features/student-delivery/ui/question/SatNotesPanel.tsx`, `ui/annotations/SatAnnotationNoteEditor.tsx` — note card tokens.
- `src/features/student-delivery/ui/shell/SatQuestionNavigator.tsx`, `ui/review/SatReviewPage.tsx` — pill/grid radius + review-red wiring.
- `src/features/student-delivery/ui/motion/satMotion.ts` — document exam motion values; remove exam imports of `detent`.
- `src/features/student-delivery/domain/satCopy.ts` — only if a phase needs a named aria label (no rewording of stable copy).

**Create (tests + docs, phased):**

- `src/features/student-delivery/ui/__tests__/bluebookTokens.test.ts` — THE token contract (Phase 0; extended in Phases 1-2).
- `src/features/student-delivery/ui/__tests__/bluebookBans.test.ts` — forbidden-pattern guard (Phase 0 skeleton, enforced Phase 10).
- `src/features/student-delivery/ui/__tests__/bluebookShell.test.tsx` — header/footer chrome + grid landmarks (Phase 3).
- `src/features/student-delivery/ui/__tests__/bluebookAnswers.test.tsx` — answer/number/review states (Phase 6; may fold into existing `SatSingleChoiceAnswer.test.tsx` / `SatQuestionHeader.test.tsx` extensions instead — prefer extending).
- `src/features/student-delivery/ui/__tests__/bluebookOverlays.test.tsx` — scrim/radius/accordion/yellow-close (Phase 8).
- Docs: update `docs/sat-hardening.md` + `docs/runbooks/sat-student-tools-exam-day.md` ONLY in Phase 11 (values table + verification matrix).

**Extend (existing tests, prefer over new files):**

- `ui/SatExamShell.test.tsx`, `ui/question/SatSingleChoiceAnswer.test.tsx`, `ui/question/SatQuestionHeader.test.tsx`, `ui/help/SatHelpModal.test.tsx`, `ui/primitives/SatCenterModal.test.tsx`, `ui/reading/SatLineReader.test.tsx`, `ui/tools/SatFloatingCoexistence.test.tsx`, `ui/review/SatReviewPage.test.tsx`, `ui/shell/SatMoreMenu.test.tsx`.

**Explicitly NOT touched:** `src/components/student/**`, `src/components/ui/**`, backend/`, outbox/persistence (`useSatResponsePersistence`, `satResponseOutboxStore`), `satToolPolicy.ts`, interaction-machine logic files, Desmos internals, e2e fixtures. If a change seems to need these, stop and replan that slice.

---

## Phase 0 — Baselines and guardrails (ship: failing-contract harness, zero visuals)

- [ ] Step 1: Write `ui/__tests__/bluebookTokens.test.ts` reading `src/index.css` as text and asserting the CURRENT values (document reality: accent #0071e3, scrim bg-black/40, highlight #fff1a8, no --sat-chrome). It must PASS on first run (baseline lock, not TDD yet).
- [ ] Step 2: Run it: `npm run test:run -- src/features/student-delivery/ui/__tests__/bluebookTokens.test.ts`.
- [ ] Step 3: Write `ui/__tests__/bluebookBans.test.ts` skeleton asserting the ban list as SCOPED grep checks over `src/features/student-delivery` (no `backdrop-blur`, no `shadow-2xl`, no `gradient`, no hardcoded Bluebook hexes outside `src/index.css`). Mark Bluebook-value assertions as `it.todo` for later phases.
- [ ] Step 4: Run it and confirm green skeleton.
- [ ] Step 5: Capture baseline evidence: run `npm run test:run -- src/features/student-delivery` and record pass/fail counts in the commit message body; screenshot the SAT preview route at 1440px + 390px (manual, no fixture changes).
- [ ] Step 6: Commit: `test(sat): lock Bluebook baseline token + ban harness`.

Verify: both new test files green; no source file modified (`git status --short` shows only the two test files).

---

## Phase 1 — Primitive tokens (spec sections 1-8, 33, 35, 39)

Goal: single source of truth for color / type / space / radius / shadow / motion / focus / shell numbers. Components only re-point in later phases, so this phase is visually near-silent except value remaps that flow through existing `var()` references (accent, highlight, review — expected and desired).

- [ ] Step 1: Extend `bluebookTokens.test.ts` with FAILING assertions for the new primitive values: `--sat-chrome #EAF2FD`, `--sat-accent #3154D7`, `--sat-accent-strong #223A98` (pressed) + hover `#2947BA`, `--sat-highlight-background #FFF2B3`, `--sat-review #C9475C`, `--sat-attention #FFD718` + hover `#F2C900`, `--sat-scrim: rgb(0 0 0 / 72%)`, `--sat-reader-mask: rgb(20 20 20 / 92%)`, `--sat-focus #005FCC`, `--sat-divider-strong #24272A`, `--sat-answer-border #74787D`, `--sat-chrome` used by topbar/footer (assert the CSS rule references, not pixels).
- [ ] Step 2: Run it, watch it fail.
- [ ] Step 3: Implement in `src/index.css` SAT block: add `--sat-chrome`, `--sat-canvas`, `--sat-action: #3154D7 / hover / pressed` (wire `--sat-accent` family to them), attention pair, scrim + reader-mask, answer/subtle/strong borders, tool-chrome `#5D6268`, note surfaces (`#FFF9D9` header), exam-navy `#202B78` (practice band reserve), spacing ladder comment (8/12/16/24/32), radius ladder (4/6/8/10-12/pill), shadows (floating + modal only), motion (80/120/180ms + standard ease), focus width 3px offset 2px, shell heights (header 96px / footer 70px), max-width 1440px, content padding 40/32. Keep high-contrast + forced-colors + prefers-contrast overrides in sync (remap, do not delete).
- [ ] Step 4: Update the two contrast overrides: high-contrast accent/focus move to the darker royal (`#003f87`-grade stays valid — keep, do not regress AA); forced-colors stays system keywords.
- [ ] Step 5: Run token test green; run `npx tsc --noEmit` (CSS-only change — must stay green).
- [ ] Step 6: Run the SAT delivery suite scoped: `npm run test:run -- src/features/student-delivery`; record any snapshot fallout (accent-dependent assertions may need value updates — update assertions, never loosen them).
- [ ] Step 7: Commit: `feat(sat): add Bluebook primitive tokens (chrome/action/attention/scrim/mask)`.

Edge cases: AA contrast — royal #3154D7 on white passes 4.5:1 for 14px+ semibold; attention #FFD718 MUST pair with #171717 text (never white); highlight #FFF2B3 keeps inherited text color. The token test asserts these pairings as comments + the high-contrast block keeps darker variants.

---

## Phase 2 — Semantic + component token layers (spec sections 40-41)

Goal: stop consuming primitives directly in components. Add the semantic bridge and the first two component-token groups (answer + primary button) so later phases are mechanical.

- [ ] Step 1: Add FAILING assertions: semantic aliases exist (`--sat-shell-bg: var(--sat-chrome)`, `--sat-body-bg`, `--sat-control-primary-bg/fg`, `--sat-answer-bg/border`, `--sat-progress-bg/fg`, `--sat-review-active`, `--sat-annotation-bg`, `--sat-modal-bg/scrim`) and component tokens (`--sat-answer-min-height: 52px`, `--sat-answer-radius: 8px`, `--sat-button-height: 44px`, `--sat-button-radius: pill`).
- [ ] Step 2: Run, watch fail.
- [ ] Step 3: Implement the two token blocks in `src/index.css` directly below the primitives (comment headers: PRIMITIVES / SEMANTIC / COMPONENT). Component tokens reference semantic tokens, never literals.
- [ ] Step 4: Re-point ONLY `SatSingleChoiceAnswer` (answer tokens) and `SatExamFooter` primary-button class (button tokens) to the new component tokens. Two components, nothing else.
- [ ] Step 5: Token test green + scoped component tests green (`SatSingleChoiceAnswer.test.tsx`, `SatExamShell.test.tsx`).
- [ ] Step 6: Commit: `feat(sat): add semantic + answer/button component tokens`.

---

## Phase 3 — Shell chrome: header / footer / body grid (spec sections 7-9, 21, 31)

Goal: pale-blue brackets around a white document; rigid 96/70 shell; 3-anchor header; 1fr/auto/1fr footer; 2px split divider.

- [ ] Step 1: Write FAILING `bluebookShell.test.tsx`: topbar has `role=banner` with chrome bg class/token, 3-region structure (context | timer | tools), footer has `role=contentinfo` with chrome bg + candidate + navigator + back/next, shell grid rows `auto minmax(0,1fr) auto`.
- [ ] Step 2: Run, watch fail.
- [ ] Step 3: `SatExamShell.tsx`: grid rows + `background: var(--sat-shell-bg)` on chrome regions only; body stays white. Max width 1440 (down from 1600) via shell container classes.
- [ ] Step 4: `SatExamTopBar.tsx`: chrome bg class, desktop grid `minmax(280px,1fr) 180px minmax(280px,1fr)` (left/context, center/timer, right/tools), timer independently centered; mobile keeps current 2-row stacking (no regression).
- [ ] Step 5: `SatExamFooter.tsx`: chrome bg, top border `1px solid #232629`-grade token, min-height 70px rhythm, padding-x 32 desktop, grid `1fr auto 1fr` (candidate | navigator | back-next).
- [ ] Step 6: `SatQuestionWorkspace.tsx`: split uses `minmax(0,1fr) 2px minmax(0,1fr)` + divider color `#777B80`; content padding desktop 40px-x / 32px-y; reading/question max-widths 660/650ch stay.
- [ ] Step 7: Run shell test + `SatExamShell.test.tsx` + typecheck + lint on touched files.
- [ ] Step 8: Manual check at 320px width / 200% zoom: header wraps without overlap, footer navigator stays reachable, no horizontal scroll.
- [ ] Step 9: Commit: `feat(sat): Bluebook shell chrome + header/footer grids + 2px split`.

Failure states: blocked/paused shells keep chrome but inert (existing `inert` region untouched); timer-hidden state keeps center column width stable (no layout shift — assert via existing timer tests, add one if missing).

---

## Phase 4 — Typography split + type scale (spec sections 3-5)

Goal: sans UI, serif material, 18px reading endurance, narrow weight band (400/500/600/700 only).

- [ ] Step 1: Add FAILING assertions (extend token test or shell test): `.sat-ui` font-family starts with Arial/Helvetica stack; `.sat-exam-prose` is Georgia-first serif; answer-content wrapper carries prose class; timer uses tabular-nums at 22-24px; tool labels 13-14px; weights used in SAT scope never exceed 700 (grep-based assertion over touched components).
- [ ] Step 2: Run, watch fail.
- [ ] Step 3: CSS: set `--font-ui` / `--font-content` intentions on `.sat-ui` (sans) + `.sat-exam-prose` (Georgia, Noto Serif, serif — drop Charter/Palatino-first ordering); type ramp: body/answer/prompt 18px (1.125rem) lh 1.45-1.6, section title 20/600/sans, timer 22-24/500/sans tabular, tool label 13-14/500, button 15/600, question number 16/700, modal title 28 (Help-grade only — see Phase 8), modal body 17, caption 13.
- [ ] Step 4: Components: ensure passage + stem + answer-content render inside prose (extend the prose wrapper in `SatQuestionWorkspace` question pane + `SatQuestionRenderer` option content); UI chrome (topbar/footer/navigator/buttons) stays sans (remove any prose leakage).
- [ ] Step 5: Run token + renderer + answer tests; typecheck.
- [ ] Step 6: Manual readability pass: 1440px passage line-length <= ~68ch, question <= ~74ch; 200% zoom keeps prose readable without horizontal scroll.
- [ ] Step 7: Commit: `feat(sat): Bluebook typography split + reading type scale`.

Accessibility: serif change must not drop contrast (inherits text color — assert); high-contrast keeps same families; no 300-weight or 800/900 anywhere in SAT scope (ban test covers).

---

## Phase 5 — Navigation + progress controls (spec sections 13-16, 32)

Goal: blue pills move, black pills inspect, tiny Hide recedes, square number badge authorizes.

- [ ] Step 1: Extend existing footer/navigator tests with FAILING assertions: Next/Back are pills (rounded-full), exactly one filled accent control per bar, Back is quiet treatment, navigator pill is near-black with `Question X of Y` + chevron, Hide/Show is an inner pill inside a 44px button, question badge is square (radius 0-2) near-black 34px.
- [ ] Step 2: Run, watch fail.
- [ ] Step 3: `SatExamFooter.tsx`: primary pill height 44 padding-x 24 via tokens; quiet Back; navigator pill radius 6px black; disabled state readable (never opacity-alone — keep border+text tokens).
- [ ] Step 4: `SatExamTopBar.tsx`: Hide/Show keeps 44px button with visual ~26px inner pill (already the pattern — tokenize, do not restructure).
- [ ] Step 5: `SatQuestionHeader.tsx`: badge 34px square near-black white text radius 0; label stays adjacent, never red.
- [ ] Step 6: Focus rings on all five controls: 3px `--sat-focus` offset 2 (replace ring-2 utilities in SAT scope).
- [ ] Step 7: Run footer + header + shell tests; typecheck; lint.
- [ ] Step 8: Commit: `feat(sat): Bluebook nav pills + progress pill + number badge`.

Icons: chevrons stay lucide 16-20px, stroke 1.5-2, neutral color; no new icon library.

---

## Phase 6 — Answers + mark-for-review + eliminator (spec sections 10-12, 17-18, 32, 36)

Goal: bordered-not-shadowed answers, unmistakable-but-calm selection, red-only-as-signal review, strikethrough elimination intact.

- [ ] Step 1: Extend `SatSingleChoiceAnswer.test.tsx` + `SatQuestionHeader.test.tsx` with FAILING assertions: answer row min-height 52, radius 8, 1px answer-border, no shadow class, 28px circle marker with 2px border, selected = stronger border + subtle tint (not flooded blue), hover = subtle bg, eliminated = strikethrough whole content + sr status, review-on = review-red fill + aria-pressed true with black label.
- [ ] Step 2: Run, watch fail.
- [ ] Step 3: `SatSingleChoiceAnswer.tsx`: apply answer component tokens; selected ring becomes `border-2 accent + accent-soft tint`; eliminated keeps whole-content line-through + sr text (existing behavior — tokenize only); focus-visible 3px outline via `:has(input:focus-visible)` upgrade.
- [ ] Step 4: `SatQuestionHeader.tsx`: review button red fill only on the bookmark icon when marked; label color stays text; eliminator toggle keeps static ABC-strikethrough label + fill/aria-pressed state (existing — tokenize).
- [ ] Step 5: Remove any shadow utilities from answer rows; confirm borders carry the structure (ban test assists).
- [ ] Step 6: Run answer + header + renderer + interaction-reducer tests; typecheck; lint.
- [ ] Step 7: Keyboard pass: radio group arrow-key behavior unchanged; eliminator buttons reachable at 44px; reduced-motion keeps instant state change.
- [ ] Step 8: Commit: `feat(sat): Bluebook answer system + review signal`.

---

## Phase 7 — Annotation surfaces (spec sections 19-20)

Goal: paper-yellow marks, document-like note cards, zero SaaS chrome.

- [ ] Step 1: Add FAILING assertions to annotation tests (`SatAnnotatedContent.test.tsx` / `SatAnnotationFlow.test.tsx`): highlight bg is paper token (not neon), underline uses text token, note card width 260 radius 8 border answer-grade with pale-yellow header 38px + 12px padding, no large shadow.
- [ ] Step 2: Run, watch fail.
- [ ] Step 3: CSS: highlight token already Phase 1 — now wire underline + note-header/surface tokens + selection-color preview var.
- [ ] Step 4: `SatAnnotationNoteEditor.tsx` + `SatNotesPanel.tsx`: header/body split, tokenized borders, small/no shadow; eraser flow untouched (regression-run the eraser tests from 2026-09-09 plan).
- [ ] Step 5: Run annotation + eraser + round-trip tests; typecheck.
- [ ] Step 6: Commit: `feat(sat): Bluebook paper highlight + note cards`.

---

## Phase 8 — Modals, popovers, More (spec sections 25-28)

Goal: white panel + 72% scrim + document-like accordion + rare yellow Close.

- [ ] Step 1: Extend `SatCenterModal.test.tsx` + `SatHelpModal.test.tsx` with FAILING assertions: overlay uses scrim-72 token (no blur), panel max-width 650 (wide) / 560, max-height min(740px, 100vh-80), radius 10, divider token, Help Close is yellow attention pill h-12 (48px) px-7 (28px) with dark text+border, accordion rows min-height 78px font 18 with 24px icons, Expand/Collapse All are blue text buttons.
- [ ] Step 2: Run, watch fail.
- [ ] Step 3: `SatCenterModal.tsx`: overlay `background: var(--sat-scrim)` (remove bg-black/40), panel caps/radius/shadow-modal tokens, header/body/footer padding 28, add `titleSize: "dialog" | "help"` (help = 28px title; default dialogs keep current 17px to avoid reshaping every small confirm).
- [ ] Step 4: `SatHelpModal.tsx`: accordion row sizing + dividers, yellow Close wiring via new attention token classes; timer keeps running + answers untouched (existing — assert, do not rework).
- [ ] Step 5: `SatPopoverShell` + Directions/Display/Notes popovers: radius 6-8, subtle border, floating shadow, light/transparent backdrop (NOT the 72% modal scrim); anchored-top positioning untouched.
- [ ] Step 6: `SatMoreMenu.tsx`: tokenize trigger (52px, low weight, icon+label); menu items unchanged.
- [ ] Step 7: Run modal + popover + shell + single-modal-contract tests; typecheck; lint.
- [ ] Step 8: Escape/focus contract pass: focus into panel on open, Escape closes, focus returns to opener on every path (existing Radix wiring — regression test, no redesign).
- [ ] Step 9: Commit: `feat(sat): Bluebook modals + 72pc scrim + yellow Close`.

Security/reliability: modal never touches exam state (presentational only — keep); blocked shells keep Help/Shortcuts reachable read-only (existing BlockingOverlay contract — regression test).

---

## Phase 9 — Floating tools + Line Reader (spec sections 29-30)

Goal: OS-window tools (move/title/close obvious) + maximum-contrast reading band.

- [ ] Step 1: Extend `SatFloatingCoexistence.test.tsx` + `SatLineReader.test.tsx` with FAILING assertions: tool border `#5D6268`, radius 6, header 44px with grip/title/close, floating shadow token, Line Reader mask uses reader-mask-92 token with white window + white controls + dark header, slider aria (valuemin/max/now/text) intact.
- [ ] Step 2: Run, watch fail.
- [ ] Step 3: `SatFloatingTool.tsx`: tokenize border/radius/header/shadow; drag (pointer + arrow-key grip) + persist-geometry untouched.
- [ ] Step 4: Calculator/Reference panels: header-height hookup only; Desmos iframe + prewarm untouched.
- [ ] Step 5: `SatLineReader.tsx`: dark mask + header restyle via tokens; drag/keys/reset/close behavior untouched; More-launch + shell-Escape arbitration untouched.
- [ ] Step 6: Run floating + reader + shell-Escape tests; typecheck.
- [ ] Step 7: Compact viewports: bottom-sheet behavior unchanged (no drag by design — assert).
- [ ] Step 8: Commit: `feat(sat): Bluebook floating tools + Line Reader contrast`.

---

## Phase 10 — Tool buttons, icons, regions, states, motion, elevation (spec sections 22-24, 32-38, 42)

Goal: calm icon-over-label tools with underline-active, single icon language, semantic regions, full state matrix, restrained motion, 4-level elevation, ban enforcement.

- [ ] Step 1: Turn the `bluebookBans.test.ts` todos into FAILING assertions: no `backdrop-blur`/gradient/glow/`shadow-2xl`/rounded-16-32 utilities in SAT scope; no hardcoded hex outside `src/index.css`; weights <= 700; attention-yellow only in Help Close + confirm dialogs (allowlist paths); motion durations only 80/120/180 (or the 40ms press exception) + standard ease; no `detent` import in student-delivery.
- [ ] Step 2: Run, watch fail; fix by tokenizing (no visual redesign — mostly class swaps).
- [ ] Step 3: `SatExamTopBar.tsx` tool buttons: min-width 72 / height 58, icon 20 + label 13 stacked (icon-above-label on sm, inline on narrow — keep responsive pattern), transparent rest, subtle hover, **2px bottom active indicator** in text color (new, calm — not a blue fill).
- [ ] Step 4: Icons: pin lucide sizes (tool 20, accordion 24, chevron 16, close 20), stroke default, neutral color; remove any emoji/duotone/gradient usage found by the ban test.
- [ ] Step 5: Regions: add missing landmark labels — TestTimer (`role=timer` exists — verify label), TestTools (nav aria-label on tool group), Passage/Source (`aria-label=Passage` exists — verify), Question+Answer + Answer Options (fieldset legend exists — verify), Question Navigation (footer label exists — verify). Markup-only, no visual change; extend shell test with landmark assertions.
- [ ] Step 6: State matrix sweep per interactive component (rest/hover/focus-visible/pressed/selected/disabled): disabled readable via border+text tokens (never opacity alone); error states keep icon+text (never color alone); keyboard reaches everything pointer reaches; loading avoids layout shift (fixed shell heights already).
- [ ] Step 7: Motion: replace exam-scope spring imports with state/surface durations; confirm `prefers-reduced-motion` kills all SAT animation (existing media query — regression test, extend to new indicator/accordion).
- [ ] Step 8: Elevation: document the 4 levels as comments on `satOverlayZ.ts` (blocking 100 > modal 88-96 > tools 70 > chrome/surface 0-65); delete any stray z-value outside the contract (ban test assists). No numeric changes expected.
- [ ] Step 9: Full SAT suite + typecheck + lint + `npm run e2e:sat-a11y`.
- [ ] Step 10: Commit: `feat(sat): Bluebook tool buttons + icons + states + motion discipline`.

---

## Phase 11 — Production hardening + rollout (ship: evidence, docs, gates)

- [ ] Step 1: Contrast audit: assert AA pairs in the token test (action-on-white, text-on-chrome, attention-dark-on-yellow, disabled-text, review-on-white, focus-on-white). Fix values, not assertions, if anything fails.
- [ ] Step 2: Environment matrix (manual, record results in commit body): default + high-contrast + forced-colors + prefers-contrast-more + prefers-reduced-motion + 320px/200% + touch + keyboard-only + blocked/paused + Math (no-notes) + R&W (notes).
- [ ] Step 3: Performance: confirm no layout shift (fixed header/footer heights, stable timer column), theme switch is var-only (no reflow), animations <= 180ms; note results in `docs/sat-hardening.md`.
- [ ] Step 4: Update `docs/sat-hardening.md` (token values table + what-changed + what-did-not-change) and `docs/runbooks/sat-student-tools-exam-day.md` (only if tool visuals changed operator-visible behavior — likely a 3-line note).
- [ ] Step 5: Gates green: `npx tsc --noEmit`, `npx eslint src/features/student-delivery src/index.css` (scoped), `npm run test:run -- src/features/student-delivery`, `npm run e2e:sat-a11y`.
- [ ] Step 6: Rollout note: CSS+class-only change, no migration, no flag; rollback = revert. Verify SAT preview route + session route + review + Help + calculator/reference + line reader on staging before merge.
- [ ] Step 7: Commit: `docs(sat): Bluebook hardening evidence + rollout notes`. Merge phases as a stacked PR series (0-2, 3-4, 5-7, 8-9, 10-11) for reviewable diffs.

---

## Definition of done

- Token contract + ban tests green; SAT delivery suite green; typecheck + eslint + sat-a11y green.
- Every visible Bluebook element communicates exam state; white/neutral dominates, pale-blue brackets, royal blue only on primary moves, black on progress, yellow/red/highlight each under ~2% of pixels by inspection.
- No hex outside `src/index.css`; no spring/blur/gradient/glow/giant-radius in SAT scope; touch targets >= 44px; focus 3px offset 2; reduced-motion + forced-colors + high-contrast verified.
- Exam behavior unchanged: timing, persistence/outbox, navigation, annotations/eraser, calculator/reference, line reader, review/submit, blocked/pause, shortcuts, announcements — all covered by pre-existing tests still passing unmodified (except value updates with justification in the commit body).
- Docs updated (Phase 11); IELTS + backend + builder untouched (`git status` proves it).

## Risks

- Timer column shift when introducing the fixed 180px center: mitigate by keeping min-widths and testing hidden-timer state (Phase 3 Step 8).
- Help title 28px reshaping small dialogs: mitigated by the `titleSize` variant (Phase 8 Step 3) — default dialogs unchanged.
- Accent change rippling into staff/builder surfaces: mitigated by scoping every remap under `.sat-ui` / `.sat-product` (never `:root` globals); Phase 1 Step 3 asserts scope.
- Snapshot churn on value updates: allowed only as assertion-value updates with before/after noted; never delete coverage.
