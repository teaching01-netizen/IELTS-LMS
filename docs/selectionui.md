Yes. I checked the current `selection-v2` implementation in `teaching01-netizen/IELTS-LMS`, and your screenshot exposes a specific mismatch with native iOS behavior.

The selection **logic is already mostly snapping to text**. The thing that is still moving freely is primarily the **loupe/caret presentation**.

### What is wrong right now

Your current path is effectively:

```text
finger clientX/clientY
        ↓
lastPointer
        ↓
SelectionOverlay
        ↓
SelectionLoupe(point={raw finger})
        ↓
pictureTranslation(... raw finger ...)
        ↓
marker fixed at lens center
```

In `useStudentSelectionGesture.ts`, you keep:

```ts
lastPointer.current = {
  x: event.clientX,
  y: event.clientY,
  pointerId: event.pointerId
}
```

and eventually expose:

```ts
pointer: lastPointer.current
  ? { x: lastPointer.current.x, y: lastPointer.current.y }
  : null
```

Then `SelectionOverlay.tsx` gives that raw coordinate directly to:

```tsx
<SelectionLoupe
  open
  point={pointer}
  sourceRef={loupe.sourceRef}
/>
```

And `SelectionLoupe.tsx` does:

```ts
pictureTranslation(picture, point, lens, magnification)
```

while `.selection-v2-loupe-marker` is permanently placed at `50% / 50%`.

So the blue `|` represents:

> **where the finger physically is**

rather than:

> **which actual text caret position the selection engine resolved**

That explains what you are seeing.

Native iOS behaves much closer to this:

```text
Finger
   │ continuous movement
   ▼
Hit testing
   │
   ▼
nearest valid text caret
   │
   ├── character boundary
   ├── character boundary
   ├── character boundary
   ▼
SNAPPED caret
   │
   ├── selection endpoint
   └── magnifier content / caret
```

The finger can move freely. **The caret cannot.**

It should feel like the caret is magnetically attached to the text.

---

## Change the architecture slightly

Do **not** modify your actual selection algorithm to follow a fake grid. Your `caretPositionAtPoint()` already returns a discrete `TextPoint`, and `nearestTextPointIn()` already falls back to actual glyph geometry.

Instead, introduce two different coordinates:

```ts
interface SelectionPointerState {
  finger: {
    x: number;
    y: number;
  };

  caret: {
    x: number;
    y: number;
    height: number;
  } | null;
}
```

They have completely different jobs.

```text
finger.x / finger.y
    ↓
position the entire loupe above the finger

caret.x / caret.y
    ↓
choose what part of the text appears
at the centre of the loupe
```

This is the important change.

### Add `caretGeometryFromTextPoint()`

Put this in something like:

```text
src/shared/ui/selection-v2/engine/selectionGeometry.ts
```

Input:

```ts
TextPoint {
  node: Text;
  offset: number;
}
```

Output:

```ts
interface CaretGeometry {
  x: number;
  y: number;
  height: number;
  top: number;
  bottom: number;
}
```

Measure the actual caret boundary from the DOM. Prefer a collapsed `Range`; have an adjacent-character fallback for browsers that return unusable geometry.

Conceptually:

```ts
function caretGeometryFromTextPoint(
  point: TextPoint
): CaretGeometry | null {
  const doc = point.node.ownerDocument;
  const range = doc.createRange();

  range.setStart(point.node, point.offset);
  range.collapse(true);

  // Try collapsed caret rect first.
  // Otherwise measure the preceding/following character
  // and use its actual glyph edge.
}
```

Don't calculate this using:

```ts
fontSize * characterIndex
```

That will break with proportional fonts, Thai, punctuation, RTL, emoji, ligatures, and mixed styling.

Use DOM geometry.

---

## Then change the frame pipeline

Your `runFrame()` currently resolves this:

```ts
const point =
  resolveCaretAtPoint(pointer.x, pointer.y, root)
```

That is exactly the moment you know:

```text
raw finger coordinate
        ↓
actual TextPoint
```

After the session adopts the point, derive the snapped visual caret:

```ts
const caret = caretGeometryFromTextPoint(point);
```

Keep it in something such as:

```ts
resolvedCaret.current = caret;
```

Then expose both:

```ts
return {
  ...presentation,

  pointer: {
    finger: lastPointer.current
      ? {
          x: lastPointer.current.x,
          y: lastPointer.current.y,
        }
      : null,

    caret: resolvedCaret.current,
  },

  ...
};
```

Ideally the session exposes the **effective moving endpoint**, and you calculate geometry from that instead of the candidate point. That keeps the existing "one owner per fact" philosophy in your `selection-v2/README.md`.

---

# This changes the loupe feel dramatically

Today:

```ts
const { left, top } =
  lensPlacement(point, lens, offset);

const content =
  pictureTranslation(picture, point, lens, magnification);
```

Both use the finger.

Change it to conceptually:

```ts
// Physical instrument follows finger.
const placement = lensPlacement(
  fingerPoint,
  lens,
  offset,
);

// What the lens is looking at follows TEXT.
const content = pictureTranslation(
  picture,
  caretPoint,
  lens,
  magnification,
);
```

So imagine the finger moves:

```text
121px → 122px → 123px → 124px → 125px
```

but all five coordinates still resolve to:

```text
"contains| dozens"
          ↑
       offset 8
```

The loupe can physically track the finger, but the text/caret **doesn't move at all**.

Then the finger crosses the midpoint of the next character:

```text
"contains |dozens"
           ↑
        offset 9
```

and the loupe content snaps there.

That is the behavior you are looking for.

---

# The `|` itself should not float through whitespace

Your current marker:

```css
.selection-v2-loupe-marker {
  top: 50%;
  left: 50%;
}
```

isn't inherently wrong.

You can actually keep the marker at the exact center.

The important difference is that **the image beneath it must now be centred on the resolved caret rather than the raw finger position**.

This produces:

```text
finger moves 1px
     ↓
loupe moves 1px

but

text inside loupe:
        stays
        stays
        stays
        SNAP
        stays
        SNAP
```

That alone will make it feel much more like iOS.

---

# Add the small iOS-like "tick" / สั่น

Yes, I would add this too.

Your current motion already includes:

```ts
gripEnterScale: 0.6
gripHeldScale: 1.14
loupeEnterScale: 0.94
```

but that is mostly **entrance animation**.

What is missing is **feedback caused by a caret boundary changing**.

Create something like:

```ts
snapRevision
```

or:

```ts
caretKey = `${nodeId}:${offset}`
```

Whenever:

```text
previous TextPoint !== current TextPoint
```

emit a `selection-snap` event/presentation state.

Then animate only the precision indicators, not the selection geometry.

For example:

```text
caret changes
    ↓
marker
scaleY 1 → 1.08 → 1

grip
scale 1.14 → 1.18 → 1.14

duration
~70–100 ms
```

Very subtle.

Do **not** shake the whole loupe left/right by 5–10 px. That will look artificial.

I would use roughly:

```ts
selectionMotion.caretSnap = {
  type: 'spring',
  stiffness: 900,
  damping: 60,
  mass: 0.35,
};
```

with only around:

```ts
scaleX: 1 → 1.08 → 1
// or
scaleY: 1 → 1.06 → 1
```

The important part is causality:

```text
finger moving inside same character
→ nothing

caret crosses to another text position
→ tiny tick

new line
→ tiny tick

grab handle
→ grip responds

release
→ grip settles
```

That's much closer to Apple's interaction language than a looping wobble.

---

## And actual physical haptic?

On Android Chrome/Samsung you can progressively enhance it with:

```ts
navigator.vibrate?.(8);
```

but it needs throttling and should fire only when the resolved caret position actually changes.

For example:

```ts
function selectionTick() {
  if ('vibrate' in navigator) {
    navigator.vibrate(8);
  }
}
```

The standard Vibration API is supported in Chrome for Android and Samsung Internet, but Safari/iOS still does not expose it, so a normal Safari/iPhone web app cannot access Apple's Taptic Engine this way. ([MDN Web Docs][1])

So:

```text
Samsung / Android Chrome
    → visual snap + optional tiny vibration

iPhone Safari / Chrome
    → visual snap only
```

For a native `WKWebView` wrapper you could bridge to `UISelectionFeedbackGenerator`, but not from the normal web app.

---

## Implementation checklist for your developer

1. **Separate raw finger geometry from resolved caret geometry.** Keep `lastPointer` for lens placement; introduce `resolvedCaret` for the content shown by the lens.

2. **Add `caretGeometryFromTextPoint()`** to `selectionGeometry.ts`. Measure real DOM caret/glyph geometry; don't estimate character width.

3. **Resolve caret geometry in the existing scheduled frame**, immediately after `resolveCaretAtPoint()`. Do not add another independent `pointermove` reader.

4. **Prefer the session's effective endpoint** after `active.move()` as the source of truth, so crossing handles, boundary clamping, and word expansion cannot make the visual caret disagree with the selected range.

5. **Change `SelectionLoupe` to accept `fingerPoint` + `caretPoint`.** `fingerPoint` controls `lensPlacement()`. `caretPoint` controls `pictureTranslation()`. The centre marker stays fixed.

6. **Add a snap revision/key.** Increment only when `{node, offset}` changes. Use that to drive a tiny marker/grip spring.

7. **Keep the handle itself unsmoothed.** Your current rule is correct: the 44×44 hit target must immediately occupy the measured endpoint. Never tween it toward the text.

8. **Add progressive haptic feedback.** `navigator.vibrate(8)` only when supported, only on a new caret offset, and throttle it. Do not expect it on iOS Safari.

9. **Add regression tests** for: 3–5px finger motion inside one glyph leaves loupe content unchanged; crossing the glyph midpoint snaps once; moving vertically through inter-line whitespace never leaves the caret floating there; dragging across selection endpoints preserves the grabbed endpoint; RTL/Thai remain based on actual DOM geometry; `prefers-reduced-motion` disables the visual bounce but not snapping; Android vibration is feature-detected and never fires continuously.

The target behavior should be:

```text
Finger = analog
Caret = discrete
Selection = discrete
Loupe position = analog
Loupe content = discrete
Snap feedback = event-driven
```

That is the main thing missing from the current implementation. Your existing selection engine is already structured well enough that **you don't need to rewrite it**; the biggest fix is stopping `SelectionLoupe` from treating `lastPointer` as both the physical finger and the resolved text caret.

[1]: https://developer.mozilla.org/en-US/docs/Web/API/Vibration_API?utm_source=chatgpt.com "Vibration API - Web APIs | MDN"
