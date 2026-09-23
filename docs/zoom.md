Yes. I re-checked the current SAT delivery architecture. I would treat this as a **zoom architecture correction**, not as a CSS patch, because the current implementation allows content, overlays, selection, and the loupe to disagree about what “50%” means.

# SAT Screen Zoom V2 — Implementation Plan

## 1. Problem context

Current zoom state itself is mostly correct:

* `SatReadingPopover.tsx` changes `examZoom`.
* `satReadingPreferences.ts` supports `0.5 → 2.0`.
* preferences persist correctly.
* auto-fit can choose a zoom.
* the Display panel correctly says `50%`, `75%`, etc.

The defect is in rendering.

Today `SatExamShell.tsx` applies:

```tsx
style={{
  zoom: screenZoom,
  width: '100%',
  height: '100%',
}}
```

only around the inner question content.

But these remain outside or independent of that coordinate system:

* SAT top bar
* footer/navigation
* Display/Directions/More UI
* some floating tools
* annotation toolbar
* selection handles
* selection loupe
* body-portalled selection layer

The selection engine is particularly important because `SelectionFloatingLayer.tsx` portals to `document.body`, while `selection.css` uses viewport-fixed geometry. The loupe additionally clones the source DOM into that unscaled body-level layer.

Therefore the current system effectively has:

```text
screenZoom = 50%

Question subtree       maybe 50%
Top bar                 100%
Footer                  100%
Selection handles       100%
Annotation toolbar      100%
Loupe clone             100%-layout assumptions
Browser viewport        100%
```

That is the root problem.

---

# 2. Required behavioral contract

Before changing code, lock this contract into tests.

**Screen Zoom means one coherent exam visual scale.**

At `50%`:

```text
logical exam viewport ≈ 2× physical viewport
visual rendering       = 0.5×
```

At `200%`:

```text
logical exam viewport ≈ 0.5× physical viewport
visual rendering       = 2×
```

The following exam-owned presentation must respond to the same scale:

| Surface                                     | Screen zoom       |
| ------------------------------------------- | ----------------- |
| Passage                                     | Yes               |
| Question/stem                               | Yes               |
| Answer choices                              | Yes               |
| Question header                             | Yes               |
| SAT top bar                                 | Yes               |
| Footer/navigation                           | Yes               |
| Notes UI                                    | Yes               |
| Directions / Display / More                 | Yes               |
| Navigator                                   | Yes               |
| Highlight/underline visual geometry         | Yes               |
| Selection handles visually                  | Yes               |
| Annotation contextual toolbar               | Yes               |
| Line reader                                 | Yes               |
| SAT floating exam tools                     | Yes               |
| Browser Safari UI                           | No                |
| Proctor/integrity/submission emergency veil | Keep outside zoom |

The last category should stay physical-size because it is a safety/blocking layer rather than ordinary exam presentation.

Also keep these two settings independent:

```text
Text size = changes reading typography only
Screen zoom = scales the exam presentation

effective visual text size
  = normal typography
  × textScale
  × screenZoom
```

Changing one must never mutate the other.

---

# 3. Architecture

Do **not** fix this with individual:

```css
transform: scale(...)
```

rules on the top bar, footer, handles, toolbar, etc.

Create one zoom authority.

I would introduce:

```text
SatExamViewport
└── SatExamZoomProvider
    └── SatExamZoomPlane
        ├── SatExamTopBar
        ├── Main
        │   ├── Passage
        │   ├── Notes
        │   └── Question
        ├── SatExamFooter
        └── exam-space overlays
```

And keep a separate explicit viewport overlay space for components whose geometry comes from browser viewport APIs:

```text
document.body
└── viewport overlay layer
    ├── owned selection paint
    ├── selection hit targets
    └── safety/blocking overlays
```

The important difference from today is that this separation becomes **intentional and governed by one zoom context**, rather than components independently assuming 100%.

---

# 4. Implementation tasks

## Phase 0 — Write failing acceptance tests first

Before changing production code, add regression tests proving the photos are currently reproducible.

Add tests that demonstrate:

1. `examZoom=0.5` changes the passage but does **not** currently scale all exam chrome.
2. selection handles remain 100%-sized at 50%.
3. selection/action toolbar presentation does not respond to screen zoom.
4. loupe source geometry diverges when its source belongs to a zoomed subtree.

Do not make `data-sat-screen-zoom="0.5"` the acceptance criterion. That proves state, not rendering.

The test must measure actual browser geometry with `getBoundingClientRect()`.

---

## Phase 1 — Add a single zoom model

Create something like:

```text
src/features/student-delivery/ui/zoom/
  SatExamZoomContext.tsx
  SatExamZoomPlane.tsx
  satExamZoomGeometry.ts
  __tests__/
```

`SatExamZoomContext` should expose something similar to:

```ts
interface SatExamVisualSpace {
  scale: number;

  viewportElement: HTMLElement | null;
  zoomPlaneElement: HTMLElement | null;

  viewportToLogicalPoint(point: Point): Point;
  logicalToViewportPoint(point: Point): Point;

  viewportToLogicalLength(value: number): number;
  logicalToViewportLength(value: number): number;
}
```

Do not let components independently read `readingPreferences.examZoom`.

The provider is the only rendering owner.

`satReadingPreferences.ts` remains the domain owner of the allowed zoom values.

---

## Phase 2 — Replace the existing inner CSS `zoom`

Remove this architecture from `SatExamShell.tsx`:

```tsx
<div
  data-sat-screen-zoom={screenZoom}
  style={{ zoom: screenZoom }}
>
```

Create an outer **physical viewport** and an inner **logical zoom plane**.

Conceptually:

```tsx
<div
  data-sat-exam-viewport
  className="overflow-hidden"
>
  <div
    data-sat-zoom-plane
    style={{
      width: `${100 / screenZoom}%`,
      height: `${100 / screenZoom}%`,
      transform: `scale(${screenZoom})`,
      transformOrigin: '0 0',
    }}
  >
    <div className="sat-exam-shell">
      <SatExamTopBar />
      <main />
      <SatExamFooter />
    </div>
  </div>
</div>
```

The physical viewport remains the iPad/window size.

The logical plane gets more room when zooming out.

For example:

```text
1024 × 768 physical viewport

100%
logical = 1024 × 768

50%
logical = 2048 × 1536
transform = 0.5

200%
logical = 512 × 384
transform = 2
```

This is much more deterministic than relying on CSS `zoom` behavior across Safari/WebKit.

Keep:

```html
data-sat-screen-zoom="0.5"
```

or rename it to:

```html
data-sat-screen-zoom="0.5"
```

for diagnostics, but it must reflect the zoom authority rather than being the implementation.

---

## Phase 3 — Move the whole normal SAT shell into the zoom plane

Move these under `SatExamZoomPlane`:

```text
SatExamTopBar
main
SatNotesSurfaceHost
SatExamFooter
SatQuestionNavigator
Directions
Display
More
Help / normal exam modals
Line reader
```

Audit every SAT component using:

```css
position: fixed
```

or a body portal.

Do not depend on the browser-specific behavior of `position: fixed` beneath a transformed ancestor.

Introduce an exam overlay host:

```tsx
<div data-sat-exam-overlay-root />
```

inside the zoom plane.

Normal exam popovers should render there.

Use the outside viewport layer only for things intentionally not affected by screen zoom.

---

## Phase 4 — Fix selection as a coordinate-space feature

Do **not** multiply every Range coordinate by `screenZoom`.

This is critical.

`Range.getClientRects()` already describes the **rendered viewport geometry** after the source element has been transformed.

Therefore this would be wrong:

```ts
rect.left * zoom
```

and would double-scale it.

Keep selection geometry in viewport coordinates.

Pass the zoom scale into the presentation layer explicitly.

Modify the shared selection API generically rather than introducing SAT-specific code in it:

```ts
interface SelectionVisualSpace {
  visualScale: number;
}
```

Relevant files:

```text
src/shared/ui/selection-v2/react/SelectionOverlay.tsx
src/shared/ui/selection-v2/react/SelectionHandle.tsx
src/shared/ui/selection-v2/react/SelectionLoupe.tsx
src/shared/ui/selection-v2/react/SelectionFloatingLayer.tsx
src/shared/ui/selection-v2/styles/selection.css
```

### Selection paint

`SelectionHighlight` already receives browser-measured range rectangles.

Those rectangles should remain unchanged.

Acceptance:

```text
selection overlay rect ≈ browser Range rect
```

at every zoom.

Tolerance should be around 1–2 px.

### Handles

Separate the **visual grip** from the **touch hit target**.

At 50%, the visible stem/dot should respond to the exam zoom, but do not turn the student's touch target into an impossible 22px target.

Keep:

```text
physical acquisition area ≈ 44 × 44
```

while scaling the inner visual grip.

For example:

```css
.selection-v2-handle {
  width: 44px;
  height: 44px;
}

.selection-v2-grip {
  transform: scale(var(--selection-visual-scale));
}
```

Geometry/hit-testing remains usable while the visible selection UI no longer looks stuck at 100%.

---

## Phase 5 — Correct the loupe

`loupePicture.ts` needs special treatment.

Currently it copies computed typography and uses the source's viewport bounding box. Once the source is transformed, those values are no longer sufficient to reproduce the exact layout.

Extend `LoupePicture` with its source visual scale.

Prefer using:

```ts
source.offsetWidth
```

for the untransformed logical source width and:

```ts
source.getBoundingClientRect()
```

for viewport placement.

The relationship becomes:

```text
logical source coordinate
    ↓ × screenZoom
viewport coordinate
    ↓ × loupeMagnification
loupe picture
```

The loupe must never assume:

```text
logical CSS pixel === viewport pixel
```

after screen zoom.

Add explicit tests for:

```text
0.50
0.75
1.00
1.25
1.50
2.00
```

The center marker must correspond to the same character boundary the selection engine resolved.

---

## Phase 6 — Fix annotation toolbar placement

Relevant files:

```text
SatSelectionActionsPanel.tsx
useSatAnnotationPlacement.ts
satAnnotationPlacementRuntime.ts
satSelectionAnchor.ts
```

Anchor geometry comes from Range measurements and is therefore viewport geometry.

Keep it viewport-based.

But change toolbar size measurement from assumptions such as:

```ts
offsetWidth
offsetHeight
```

when transforms are involved.

Use rendered geometry:

```ts
const rect = container.getBoundingClientRect();

{
  width: rect.width,
  height: rect.height
}
```

when comparing the toolbar against viewport anchor geometry.

Do not mix:

```text
anchor     = physical viewport px
toolbar    = logical unscaled px
```

That is exactly the class of bug we are fixing.

---

## Phase 7 — Make auto-fit compatible with Zoom V2

Keep the domain policy in:

```text
satExamFit.ts
useSatExamFitZoom.ts
satExamFitProbe.ts
```

but make sure it measures the new logical pane geometry.

A transform itself doesn't change `scrollHeight`, but the zoom plane's:

```text
width  = viewport / zoom
height = viewport / zoom
```

does.

Therefore each candidate must render first:

```text
100%
↓ measure
75%
↓ measure
50%
↓ measure
```

exactly as the current hook intends.

Do not compute:

```ts
newZoom = availableHeight / scrollHeight
```

Keep the candidate walk because content reflows at each logical viewport size.

---

# 5. File impact

| File / area                        | Change                                                    |
| ---------------------------------- | --------------------------------------------------------- |
| `satReadingPreferences.ts`         | Keep zoom domain/range                                    |
| `useSatReadingPreferences.ts`      | Mostly unchanged                                          |
| `SatExamShell.tsx`                 | Major restructuring into viewport + zoom plane            |
| new `ui/zoom/*`                    | Own scale and coordinate conversions                      |
| `SatReadingPopover.tsx`            | Continue writing preference; no rendering logic           |
| `SatExamTopBar.tsx`                | Must live in plane                                        |
| `SatExamFooter.tsx`                | Must live in plane                                        |
| `SatQuestionNavigator.tsx`         | Move to proper exam overlay space                         |
| `SatMoreMenu.tsx`                  | Remove implicit unscaled/fixed assumption                 |
| `SatDirectionsPopover.tsx`         | Same                                                      |
| `SatAnnotatedContent.tsx`          | Give selection presentation visual-space context          |
| `SelectionOverlay.tsx`             | Consume scale without scaling measured coordinates twice  |
| `SelectionHandle.tsx`              | Scale visible grip, preserve usable acquisition           |
| `SelectionLoupe.tsx`               | Scale-aware picture mapping                               |
| `loupePicture.ts`                  | Separate logical source geometry from viewport geometry   |
| `satAnnotationPlacementRuntime.ts` | Physical rendered menu measurement                        |
| `useSatAnnotationPlacement.ts`     | Re-measure when zoom changes                              |
| `satExamFitProbe.ts`               | Validate against new logical pane model                   |
| `SatStudentSessionRoute.tsx`       | Ensure route-owned SAT tools receive zoom-space ownership |

---

# 6. Test strategy

## Unit tests

Add:

```text
satExamZoomGeometry.test.ts
```

Cover:

```text
zoom 0.5 → logical dimensions = physical × 2
zoom 1   → equal
zoom 2   → logical dimensions = physical ÷ 2

viewport → logical → viewport round-trip
logical → viewport → logical round-trip
```

Also test all supported zoom values.

For selection:

```text
selection geometry must not double-scale Range rectangles
handle visual scale follows zoom
handle acquisition remains physically usable
```

For loupe:

```text
viewport character position
→ logical clone coordinate
→ loupe center
```

must round-trip at 50%, 75%, 100%, 150%, and 200%.

For annotation placement:

```text
anchor and surface measurements use same coordinate space
```

---

## Component tests

Extend:

```text
SatExamShell.test.tsx
satAccessibilityContracts.test.tsx
SelectionOverlay.test.tsx
SelectionLoupe.test.tsx
SatAnnotationSurfacePlacement.test.tsx
```

Assert that:

```text
one zoom provider owns rendering
top/body/footer are descendants of the zoom plane
Display changes the same zoom authority
Reset returns exactly to 100%
text size doesn't mutate screen zoom
screen zoom doesn't mutate text size
normal SAT overlays use the correct overlay owner
blocking/safety overlays remain outside zoom
```

---

## Browser/E2E tests

This is where the bug must actually be closed.

Extend:

```text
e2e/sat-student-accessibility.spec.ts
e2e/sat-auto-fit.spec.ts
e2e/sat-annotation-placement.spec.ts
```

Run especially under Playwright **WebKit**, because the reported failure is on iPad Safari.

Use at least:

```text
1024 × 768   iPad-style landscape
768 × 1024   portrait
1194 × 834   larger landscape iPad
390 × 844    compact regression
```

Test this matrix:

```text
50%
75%
100%
125%
150%
200%
```

For every relevant zoom, verify actual rendered geometry.

### Critical 50% regression test

At 100%, record the bounding boxes of:

```text
top-bar icon
passage text Range
question text Range
answer card visual
footer label
```

Switch to 50%.

Verify visual dimensions decrease appropriately.

Also verify:

```text
zoom plane still fills the viewport
no white gutter
no document-level horizontal scroll
more content is visible
```

Do **not** expect the whole plane's bounding width to halve; the plane is deliberately expanded before scaling.

---

# 7. Selection E2E acceptance test

This should become the most important regression test for this bug.

At `50%` on touch/WebKit:

1. Enable **Highlights & Notes**.
2. Drag-select text.
3. Assert highlight rects overlap the browser/source text rectangles.
4. Assert start handle sits at the first selected character boundary.
5. Assert end handle sits at the final selected character boundary.
6. Drag only the start handle.
7. Confirm the end boundary does not move.
8. Drag only the end handle.
9. Confirm the start boundary does not move.
10. Confirm the loupe shows the character surrounding the active boundary.
11. Confirm the contextual annotation UI is anchored beside the selection and uses the zoomed visual language.
12. Scroll the passage while dragging near an edge.
13. Confirm selection stays attached.
14. Change to 75%, then 150%, and repeat without reloading.

This should also cover Thai/emoji/grapheme-cluster content already supported by the debug harness because coordinate bugs are much easier to expose there.

---

# 8. Combination tests

The bug should also be tested with settings combined:

```text
Text 100% + Screen 50%
Text 150% + Screen 50%
Text 200% + Screen 75%
Text 100% + Screen 200%
Relaxed line spacing + Screen 50%
High contrast + Screen 50%
Notes open + Screen 50%
Split ratio changed + Screen 50%
```

Check that changing screen zoom does not corrupt:

* selected text
* existing highlights
* notes
* answer state
* split ratio
* scroll location
* persistence

---

# 9. Persistence tests

Existing persistence should remain.

Verify:

```text
choose 50%
reload
→ 50%

navigate question
→ 50%

module boundary
→ same value

Fit to screen chooses 75%
reload
→ 75%

Reset
reload
→ 100%
```

Do not introduce a second persisted zoom state for Zoom V2.

`readingPreferences.examZoom` remains the single domain value.

---

# 10. Real-device release gate

Because this is specifically an iPad/Safari issue, Playwright WebKit should **not be the only release gate**.

Before merging, run one physical-iPad smoke test:

```text
Landscape
100% → 50% → 75% → 150% → 100%

select text
drag both handles
use loupe
open highlight toolbar
highlight
add note
open Display
open navigator
Next / Previous
rotate portrait → landscape
reload
```

Pass criteria: no offset, no 100%-sized selection artifact, no blank bands, no clipped footer/top bar, and no selection coordinate jump.

---

# Definition of Done

This bug is **not done** merely when the Display panel says `50%`.

It is done when all of these are true:

```text
✓ 50% visibly changes the whole normal SAT exam UI
✓ zooming out reveals materially more usable exam space
✓ top bar, body and footer share one scale
✓ text-only sizing remains independent
✓ Range selection remains aligned
✓ handles remain attached to exact character boundaries
✓ dragging one endpoint never moves the other
✓ loupe shows the actual character under the resolved caret
✓ annotation toolbar stays correctly anchored
✓ notes/split panes reflow correctly
✓ Fit to screen still works
✓ zoom survives reload/module navigation
✓ 50–200% work in Chromium + WebKit
✓ physical iPad smoke passes
✓ no per-component zoom hacks or duplicated zoom state
```

The key engineering rule for the implementation is: **one zoom value, one visual-space owner, explicit conversions at coordinate-space boundaries, and geometry tests instead of state-only tests.** This fixes the current defect and prevents the same class of bug from reappearing in selection, notes, popovers, or future SAT tools.
