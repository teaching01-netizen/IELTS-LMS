# SAT Calculator touch resize — E2E test plan (iPad / mobile first)

Status: **executed** 2026-11-01. Suite `e2e/sat-calculator-touch-resize.spec.ts`
(config `playwright.sat-calculator-touch.config.ts`, script
`bun run e2e:sat-calculator-touch`) is green on all 17 projects:
**275 passed, 371 skipped (per-project gating), 0 failed** (~6.5 min).
Bugs found while executing are listed in §10; they are fixed in the same change.

## 1. Change under test

`src/index.css`, `@media (pointer: coarse)` block after the `.sat-tool-calculator .sat-tool-resize-edge-*::after` rules:

- Every calculator resize target is moved into a 20px band **outside** the window
  (`--sat-tool-edge-zone: 0`, `--sat-tool-edge-outside: 20px`), and the window is `overflow: visible`.
- Corners (NE, NW, SW edge layers + SE `role="separator"` handle) are 48px L-shapes
  (`clip-path`) wrapping the outside of each corner, with 28px arms.
- A visible 4px bracket is drawn outside all four corners. It turns `--sat-focus` while pressed or focused.
- Edge feedback `::after` lines sit outside the window and have `pointer-events: none`.
- Fine pointer (desktop mouse) and the Reference sheet are out of scope and must stay unchanged.

## 2. Where the feature exists (drives the device matrix)

`SatFloatingTool` switches to the compact bottom sheet at
`(max-width: 639px), (max-height: 560px)`. The compact sheet has **no** drag or resize.

| Device class | Viewport (CSS px) | Layout | Resize handles |
|---|---|---|---|
| iPad (gen 7) landscape | 1080×810 | floating | yes, **primary target** |
| iPad (gen 7) portrait | 810×1080 | floating | yes, **primary target** |
| iPad mini portrait | 744×1133 | floating | yes |
| iPad Pro 11 landscape | 1194×834 | floating | yes |
| iPad in Split View / Stage Manager (narrow) | e.g. 507×810 | compact | no |
| iPhone 13 portrait / landscape | 390×844 / 844×390 | compact | no |
| Pixel 7 portrait / landscape | 412×915 / 915×412 | compact | no |
| Desktop Chrome / Safari (fine pointer) | 1280×800 | floating | unchanged legacy handles |

So "mobile" means: resize behaviour on iPad-class screens, plus a **no regression** check on phones (compact sheet).

## 3. Invariants (each test maps to one or more)

| ID | Invariant |
|---|---|
| I1 | **Zero interior capture.** No point inside the calculator's padding box resolves (`elementFromPoint`) to `[data-sat-resize-edge]` or `[data-sat-resize-handle]`. The 1px window border is allowed. |
| I2 | **All 8 directions resize** from the outside band. The opposite edge or corner stays fixed (±1px). |
| I3 | **Four corner brackets are visible**, drawn fully outside the window, each with ≥ 3:1 contrast against the page behind. |
| I4 | **Touch targets are big enough.** Each corner's hit region is ≥ 44×44 effective (L-shape: ≥ 44px along both arms). Each edge band is ≥ 20px deep. |
| I5 | **Desmos owns its corners.** A touch-drag that starts 1–8px inside any window corner pans or interacts with Desmos and leaves the window geometry unchanged. |
| I6 | **Header controls win.** Close, Graphing/Scientific tabs and the grabber respond to taps at their edges; the NE corner no longer steals them. |
| I7 | **Phones unchanged.** Compact sheet renders no resize nodes, no brackets, no outside overflow. |
| I8 | **Desktop unchanged.** Existing `e2e/sat-math-tools.spec.ts` passes on `chromium` and `webkit` with no edits. |
| I9 | **Geometry contract.** A touch resize persists to `localStorage` key `sat-tool-geometry:v2:…:calculator:*` only on release, honours min 400×480 and the max fractions, and survives reload. |
| I10 | **Reachable at screen edges.** With the window placed at each safe-area edge, every bracket and at least 12px of each band are inside the viewport. |
| I11 | **The band costs the page as little as possible.** A tap ≥ 24px outside the window reaches the page (answer choice selects). A tap with no movement inside the band changes no geometry and writes no storage. |
| I12 | **Gesture safety.** `pointercancel` / lost capture (iOS edge swipe, a second finger) restores the pre-gesture rect. Page does not scroll while dragging in a band (`touch-action: none`). |
| I13 | **Exam state gating.** Paused/blocked (`?paused=1`): window inert, no resize from any band, brackets non-interactive. |
| I14 | **Accessibility is preserved.** SE separator keeps role, name, `aria-value*`, arrow-key resize (iPad + hardware keyboard). Focus-visible turns the SE bracket the focus colour. The discovery hint still reads "Drag a corner or edge to resize". |
| I15 | **Holds under Display zoom.** Invariants I1–I4 hold at Display 50%, 100%, 150%, 200%. |
| I16 | **Reference sheet unaffected.** On coarse pointer it still renders no edge layers (`!(isReference && coarsePointer)`). |

## 4. Harness

- **Route:** `/__dev/sat-accessibility?mode=math` (and `&tool=calculator`, `&paused=1`). It is dev-only (`import.meta.env.DEV`) and mounts the real `SatExamShell` + `SatCalculatorHost` + Desmos. No backend or DB is needed. Same `ROUTE` and `displayZoom` helpers as `e2e/helpers/satReference.ts`.
- **New config:** `playwright.sat-calculator-touch.config.ts`. Modelled on `playwright.sat-a11y.config.ts`: Vite-only `webServer`, `retries: 0`, `trace: retain-on-failure`, `screenshot: only-on-failure`.
  - Projects: `ipad-landscape` (iPad gen 7 + 1080×810), `ipad-portrait`, `ipad-mini-portrait`, `ipad-pro-landscape`, `ipad-split` (507×810, touch), `iphone-portrait`, `iphone-landscape`, `pixel-landscape`, `desktop-chromium` (I8 guard).
  - Run each touch project in **Chromium** (CDP native touch) and **WebKit** (Safari engine rendering). Name them `*-chromium` / `*-webkit`.
- **New script:** `"e2e:sat-calculator-touch": "playwright test --config playwright.sat-calculator-touch.config.ts"`.
- **New spec:** `e2e/sat-calculator-touch-resize.spec.ts`.
- **Desmos needs network** (`www.desmos.com`). Wait for `.sat-tool-calculator .dcg-container` before any I5 test. If Desmos is unreachable, fail with a clear message instead of skipping silently.

### Precondition gate (first test in every touch project)

Assert `matchMedia('(pointer: coarse)').matches === true` and that the window has `data-sat-tool-resizable="true"`. If WebKit emulation does not report a coarse pointer, the project must **fail loudly**: every other assertion would otherwise silently test the desktop CSS. Resolve by checking Playwright's WebKit `hasTouch` behaviour before writing the rest. If it can't be emulated, WebKit projects cover rendering only, and real-device QA (§7) covers WebKit input.

**Resolved (execution):** WebKit with `isMobile: true, hasTouch: true` reports
`(pointer: coarse) === true`, so WebKit projects cover the CSS *and* the pointer
handlers. WebKit has no CDP, so its drags use Playwright pointer input
(`page.mouse`, `page.touchscreen.tap`); Chromium uses `Input.dispatchTouchEvent`
for the native multi-point path.

### Helpers (in `e2e/helpers/satCalculatorTouch.ts`)

| Helper | Purpose |
|---|---|
| `openCalculator(page)` | Click the toolbar `Calculator` button, return `getByRole("dialog", { name: "Calculator", exact: true })`. |
| `hitScan(page, panel, { step, dense })` | Run `elementFromPoint` over the padding box. Use a 4px grid everywhere, plus a 1px grid in the outer 48px ring. Return the offending points. |
| `bandProbe(page, panel)` | Return the hit target for 16 named outside points: each corner (diagonal, along each arm at 10px and 40px) and each edge midpoint at 10px out. |
| `touchDrag(session, from, to, steps)` | CDP `Input.dispatchTouchEvent` start → N moves → end, same as the existing pattern in `sat-math-tools.spec.ts`. |
| `touchCancel(session, from, to)` | Start → moves → `touchCancel`. |
| `readGeometry(page)` | Parse the calculator key in `localStorage`. Returns `null` when nothing is persisted. |
| `bracketBoxes(page, panel)` | `getComputedStyle(el, '::after')` + element rect → absolute bracket rects, colours and `opacity`. |
| `placeWindow(page, rect)` | Seed `localStorage` geometry, then reload. Used to put the window at the viewport edges. |

## 5. Test cases

`[iPad]` = all iPad-class projects; `[phone]` = compact projects; `[desktop]` = desktop guard.

### A. Interior is never captured (I1, I15) `[iPad]`

| # | Steps | Assert |
|---|---|---|
| A1 | Open the calculator (graphing). Run `hitScan` with `dense` on. | 0 offending points. |
| A2 | Switch to Scientific and rescan. | 0 offending points. |
| A3 | Resize to minimum (400×480) via the SE band and rescan. | 0 (narrow windows must not let bands meet inside). The panel's real content minimum is 400×400 (it passes `minSize` explicitly), so the test asserts 400×400. |
| A4 | Resize to maximum and rescan. | 0. |
| A5 | Repeat A1 at Display 50/150/200% (`displayZoom`). | 0 at every zoom. The window is closed while changing Display: at 810px portrait it covers the toolbar row. |
| A6 | Rescan at the existing interior points `(x+6, y+6)`, `(right-6, bottom-6)` and `(right-6, top+6)` (close button). | Each resolves to Desmos content / iframe or a header control, never a resize node. |

### B. Eight directions resize from outside (I2, I4) `[iPad]` × `{chromium (CDP touch), webkit (pointer events)}`

For each direction `n, s, e, w, ne, nw, se, sw`:

| # | Steps | Assert |
|---|---|---|
| B1-dir | Read the starting rect. Drag with `touchDrag` from the band point 10px outside that edge or corner, outward 60px (and 60px inward for a second run). | Size changes by ±60 on the moving axis or axes (±1). The opposite edge or corner is fixed (±1). `data-sat-resizing` is set during the drag and removed after. |
| B2 | For each corner, start the drag at the far end of each arm (10px outside, 40px along the edge from the corner). | It still resolves to the *corner* direction (both axes change). This shows the L-shape works. |
| B3 | Read the size of each corner's hit region via `bandProbe`. | ≥ 44px along both arms; edge band depth ≥ 20px. |
| B4 | Drag the SE band below the minimum size. | Clamps to 400×480; NW corner fixed. |
| B5 | Drag the NW band below the minimum size. | Clamps; SE corner fixed (regression for the west/north min-pin logic in `commitResizePoint`). |
| B6 | Drag the SE band past the viewport. | Clamps to the max fractions or safe area; no part of the window is off-screen. |

### C. Visible affordance (I3) `[iPad]`

| # | Steps | Assert |
|---|---|---|
| C1 | Read `bracketBoxes` at rest. | 4 brackets, `opacity: 1`, every rect fully outside the window rect and fully inside the viewport. |
| C2 | Check bracket contrast: sample the page pixel behind each bracket from a screenshot. | Contrast ≥ 3:1 (WCAG 1.4.11 non-text). |
| C3 | During B1-se (touch held). | SE bracket colour = `--sat-focus`; others unchanged. |
| C4 | Focus the SE separator with Tab (keyboard on). | SE bracket colour = `--sat-focus`. |
| C5 | Visual snapshot per iPad project at rest (graphing + scientific). | `toHaveScreenshot` with a threshold, masking the Desmos canvas and the timer. Reviewed by a human once, then a baseline. |
| C6 | First open (clear `sat-tool-view` storage). | Discovery hint visible with text "Drag a corner or edge to resize"; with `prefers-reduced-motion: no-preference` the teach pulse runs without error. |

### D. Desmos and header keep their pixels (I5, I6) `[iPad]` chromium

| # | Steps | Assert |
|---|---|---|
| D1 | Touch-drag inside the graph from 6px inside each of the 4 window corners (where the graph or list reaches the corner), moving 80px inward. | Window geometry is unchanged and storage is not written. For corners over the graph, the Desmos viewport moved: read the axis labels / `Calc.graphpaperBounds` from the harness, or diff screenshots of the graph region. |
| D2 | Tap the expression list 4px from the left border. | The expression gains focus (Desmos keypad / MathQuill cursor present). |
| D3 | Tap the close `X` at its rightmost and top 4px. | Calculator closes. |
| D4 | Tap the Graphing/Scientific tabs at their outer 4px. | Mode switches. |
| D5 | Pinch with two fingers inside the graph (CDP two `touchPoints`). | Desmos zooms; window geometry unchanged. |

### E. Page outside the window (I11, I12) `[iPad]`

| # | Steps | Assert |
|---|---|---|
| E1 | Place the calculator next to the answer choices. Tap an answer choice 24px+ outside the window. | Choice becomes selected. |
| E2 | Tap (no movement) inside each band. | Geometry unchanged, `readGeometry` unchanged, no `data-sat-resizing` left behind. **Decision:** the band consumes the tap (it is a resize target, not a pass-through); the plan accepts that only within 20px of the window, and E1 proves a tap 24px out still reaches the answer choice. |
| E3 | Drag in the S band while the page is scrollable (`?long=1`). | `document.scrollingElement.scrollTop` and the question pane scroll stay unchanged. |
| E4 | `touchCancel` mid-resize for each of 4 corners. | Rect restored to the pre-gesture value; storage unchanged. |
| E5 | Mid-resize, add a second touch point elsewhere. | No jump; ending either finger finishes or cancels cleanly; geometry is consistent with I2 or restored. |
| E6 | Mid-resize, fire `visibilitychange` (hidden) and window `blur`. | Gesture cancelled (`interrupt` path); rect restored. |

### F. Screen edges and rotation (I10, I12) `[iPad]`

| # | Steps | Assert |
|---|---|---|
| F1 | Default first-open placement (`body.x + 8`). | Left brackets and W/NW/SW bands are ≥ 12px inside the viewport. **Resolved:** the window now opens with a 20px touch gutter (`safeArea.left + 20`, same on the other three edges), and the drag/zoom clamp carries the same gutter, so every band and bracket is fully on screen. |
| F2 | Drag the window to each of the 4 safe-area edges (alignment snap engages) via the grabber. | The bracket nearest that edge is fully visible; resizing from it works (B1 on that corner). |
| F3 | Rotate landscape → portrait → landscape (`page.setViewportSize` + `orientationchange`). | Window clamped inside the viewport, I1 = 0, C1 holds after each rotation. |
| F4 | Window near the bottom: the exam footer bar overlaps the S band. | **Resolved:** the 20px gutter also applies at the bottom, so the first-open window ends above the footer and the S band never covers it. F4 asserts `window.bottom + 20 ≤ footer.top` and that Next still advances. |
| F5 | Window near the top: header toolbar (Calculator/Reference buttons). | **Resolved:** the N band sits in the 8–28px strip on the left; the toolbar controls are on the right and above it (`elementFromPoint` at the Calculator button is the button). Asserted directly. |

### G. Persistence (I9) `[iPad]`

| # | Steps | Assert |
|---|---|---|
| G1 | During a touch resize (before release). | `readGeometry` is `null` / unchanged. |
| G2 | After release. | `readGeometry` equals the rendered rect (±1). |
| G3 | Reload. | Same rect restored; brackets render; I1 = 0. |
| G4 | Switch graphing ↔ scientific after a resize. | Follows the existing per-mode size rule (no regression against the current behaviour on `main`). |

### H. Exam state, a11y, other tools (I13, I14, I16) `[iPad]`

| # | Steps | Assert |
|---|---|---|
| H1 | `?paused=1&tool=calculator`: touch-drag every band. | No geometry change; window `inert`. |
| H2 | SE separator: `aria-valuemin/max/now`, `aria-valuetext`, arrow keys ±8px. | Matches the existing desktop test; axe has no new violations on the dialog. |
| H3 | Open the Reference sheet on coarse pointer. | `[data-sat-resize-edge]` count inside the reference window = 0; its layout is the same as on `main` (screenshot). |
| H4 | Calculator and Reference both open and overlapping. | Calculator's outside bands do not capture taps on the Reference header controls when Reference is on top (z-order follows `sat-tool-active`). |

### I. Phones and narrow iPad (I7) `[phone]` + `ipad-split`

| # | Steps | Assert |
|---|---|---|
| I1-p | Open the calculator. | Compact sheet (`data-sat-tool-compact-header`); `[data-sat-resize-handle]` and `[data-sat-resize-edge]` counts = 0; no `::after` brackets; window `overflow` stays `hidden`. |
| I2-p | Rotate the phone portrait ↔ landscape. | Stays compact; Desmos usable (tap expression, focus works). |
| I3-p | Screenshot per phone project. | Same as on `main` (baseline taken on `main` first). |

### J. Desktop guard (I8) `[desktop]`

| # | Steps | Assert |
|---|---|---|
| J1 | Run `e2e/sat-math-tools.spec.ts` unmodified on `chromium` + `webkit`. | Green. |
| J2 | On `desktop-chromium`, run `hitScan`. | Records the legacy interior capture (24px corners) without failing. This documents that the desktop behaviour is unchanged by design. |

## 6. Optional live-route smoke (one test, behind `E2E_LIVE_SAT=1`)

Runs on `tablet-landscape` against the real `/student/...` SAT practice session, with the backend from `playwright.config.ts` on a **dedicated** test DB. Per [[e2e-test-database-isolation]], pin every DB env var; never `ielts_prod_clone`. Checks: A1, B1-se, D1-se, G3. This proves the harness matches real delivery (zoom plane, safe area, footer height).

## 7. Real-device QA (manual, required before release)

Emulation doesn't reproduce Safari's touch heuristics, iOS edge gestures, or Pencil. Run on the LAN dev server (`bun run dev`, open `http://<mac-ip>:3000/__dev/sat-accessibility?mode=math&tool=calculator`).

| Device | iPadOS / iOS | Checks |
|---|---|---|
| iPad (9th/10th gen) | 17.x and 18.x | A6, B1 (all 8), C1, D1–D5, E1–E4, F1–F3 |
| iPad mini | 17+ | B1-se/nw, F1, F3 |
| iPad Pro + Apple Pencil | 18 | B1 with Pencil, D1 with Pencil, hover (Pencil hover = fine pointer?) |
| iPad + Magic Keyboard / trackpad | 18 | Trackpad: does `pointer: coarse` still match? (any-pointer). Arrow-key resize (H2). |
| iPad Split View / Slide Over | 18 | I1-p (compact) |
| iPhone 13–16 | 17+ | I1-p, I2-p |
| Android tablet (Chrome) | 14 | B1-se, D1, F3 |

For each device, record: pass/fail per check ID, a screen recording of one full resize per corner, and any accidental Desmos interaction during resizing.

## 8. Exit criteria

- Every `[iPad]` case green on both engines (WebKit cases for input marked per the §4 gate decision). **Met.**
- A1–A5 return exactly 0 offending points on every iPad project and zoom level. **Met.**
- `[phone]` and `[desktop]` show no diff from `main` baselines. **Met for behaviour** (no resize nodes, overflow hidden, sheet on screen; desktop legacy capture unchanged). Pixel baselines against `main` are deferred (§10).
- `sat-math-tools.spec.ts`, `sat-reference-ipad.spec.ts`, `sat-screen-zoom.spec.ts` stay green. **`sat-reference-ipad` and `sat-screen-zoom` are green on tablet-landscape and show the same single pre-existing failure there with this change stashed. `sat-math-tools` has 8 pre-existing failures in the dev harness, identical with the change stashed (desktop behaviour unchanged).**
- Real-device matrix (§7) signed off. Open decisions in F1/F4/F5 are resolved and written back into this plan. **Decisions resolved in §9; §7 is still a manual release gate.**
- 3 consecutive green runs (`--repeat-each=3`) on the touch config with no retries. **Met on `ipad-landscape-chromium` + `ipad-landscape-webkit` (195 passed, 0 failed).**

## 9. Open questions / risks — resolved during execution

1. **WebKit coarse-pointer emulation** (§4 gate). **Resolved:** WebKit reports
   `(pointer: coarse)` with a touch device profile, so the WebKit projects cover
   rendering and pointer handlers. Input there is Playwright pointer input;
   Chromium covers native `Input.dispatchTouchEvent`.
2. **F1 left-edge reachability.** **Resolved:** the calculator now reserves a
   20px gutter on all four edges whenever `(pointer: coarse)` matches, both for
   first open and for the drag/zoom clamp. Bands and brackets stay fully on
   screen, and the iOS edge-gesture strip is no longer the only place to grab.
3. **F4/F5 stacking.** **Resolved:** the bottom gutter keeps the S band above the
   footer; the N band sits left of the toolbar controls. Both are asserted with
   a real tap (Next advances, Calculator toggles).
4. **E2 tap-through.** **Decision:** a no-move tap inside the band is consumed
   by the resize layer. That is the cost of a 20px hit target; E1 proves the
   page still receives taps 24px away, and the unaffected gap is documented.
5. **Trackpad / Pencil on iPad** may report `pointer: fine`, which selects the
   desktop CSS. **Left open deliberately:** `any-pointer: coarse` would also
   switch a hybrid iPad into outside bands, where the Pencil user expects the
   old inside grip. This stays a real-device decision (§7).
6. **Zoom-plane units (new, found while executing).** The touch band used CSS px
   inside the zoom plane, so it scaled with Display zoom: 10px at 50%, 40px at
   200%, and it crept ~3px inside Desmos above 100%. Fixed by keying every
   touch length to `--sat-tool-unit` (1/scale), which keeps 20px/28px/4px
   physical at every zoom. A5 + B3 now prove it.

## 10. Execution results and fixes (2026-11-01)

Suite: `bun run e2e:sat-calculator-touch` — **275 passed, 371 skipped, 0 failed**
across 17 projects (8 device profiles × 2 engines + desktop guard).

Bugs / edge cases found by the tests and fixed in the same change:

1. **Bands scaled with Display zoom** (I4, I15). Every touch length is now
   `calc(n * var(--sat-tool-unit))`, so the band is 20px physical at 50–200%.
2. **First open put the band half off-screen** (F1). A 20px touch gutter is now
   part of the first-open rect and the clamp area (`SatCalculatorPanel`).
3. **Rotation left the window off-screen** (F3). The clamp-on-resize listener was
   Reference-only; every open tool now re-clamps on `resize` (Calculator does not
   persist the clamped rect, so a later open restores the student's own size).
4. **Backgrounding did not cancel a gesture** (E6). `visibilitychange → hidden`
   now runs the same interrupt as `window.blur`.
5. **The resize separator was unreachable by keyboard** (C4). The Desmos iframe
   sat between the header and the `role="separator"` in DOM order, so Tab could
   never reach it. The separator now precedes the content in DOM order (absolute
   positioning unchanged, `z-10` keeps it painted above the iframe).

Deviations from the written plan, all deliberate:

- A3/B4/B5 assert the panel's real minimum, **400×400**, not 480 height: the
  panel passes an explicit `minSize` (`400/scale`) and the 480 came from a
  fallback that production never uses.
- E3 asserts `touch-action: none` plus "the page never scrolls"; the math
  harness has no scrollable question pane, so "scrollTop unchanged" is checked on
  the document only.
- I3-p (phone screenshot vs `main`) is not automated: cross-branch pixel
  baselines would need a `main` checkout in CI. The compact assertions (no resize
  nodes, no outside overflow, rotated sheet still on screen) are automated.
- C5 baselines are generated per iPad chromium project (Desmos and the timer are
  masked) and are a human-reviewed artifact, not a CI pixel gate.
- J1: `sat-math-tools.spec.ts` has **8 pre-existing failures** in this dev-only
  harness (the four Display-zoom cases × 2 engines assert first-open placement
  relative to `#sat-question-content`, while the panel opens at the 8px shell
  inset). The same 8 fail with this change stashed, so desktop behaviour is
  unchanged; the comparison is repeatable with
  `playwright.sat-calculator-desktop-guard.config.ts`.

